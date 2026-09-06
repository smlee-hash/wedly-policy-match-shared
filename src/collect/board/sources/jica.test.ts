import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseHtml } from "../html";
import { jicaConfig, parseJicaList } from "./jica";

/**
 * ★손으로 쓴 HTML 대신 **실사이트 고정본**으로 잰다(적대 리뷰 지적) — 손으로 쓴 고정본은
 * 실제 마크업과 어긋난 선택자를 그대로 통과시킨다(창원에서 실제로 겪었다).
 * 고정본: 2026-09-01 배포본 `/2025/inner.php?sMenu=A1000` 1쪽 + `pno=2` 2쪽 + 상세 no=847.
 */
const listHtml = readFileSync(join(__dirname, "../__fixtures__/jica-list.html"), "utf-8");
const listP2Html = readFileSync(join(__dirname, "../__fixtures__/jica-list-p2.html"), "utf-8");
const detailHtml = readFileSync(join(__dirname, "../__fixtures__/jica-detail.html"), "utf-8");
const rows = parseJicaList(listHtml);
const rowsP2 = parseJicaList(listP2Html);

const KEEP = [
  "[공고 제2026-066호] 버추얼 프로덕션 사전시각화 심화 교육과정 교육생 모집",
  "[공고 제2026-34호] 2026년 소상공인 제품상세페이지 제작지원사업 소상공인 모집공고",
  "[공고 제2026-13호] 전주ICT이노베이션스퀘어 기업협력프로젝트 참여기업 모집 공고",
  "[공고 제2026-068호] 전주형 가상융합 얼라이언스 프로젝트 그룹 모집 재공고",
] as const;

describe("전주정보문화산업진흥원 목록 읽기 — 실사이트 고정본", () => {
  it("1쪽 고정본에서 행 9건을 읽고 첫 행의 제목·상세주소·날짜가 맞다", () => {
    expect(rows).toHaveLength(9);
    expect(rows[0]).toMatchObject({
      title: KEEP[0],
      detailUrl: "https://www.jica.or.kr/2025/inner.php?sMenu=A1000&mode=view&no=847",
      dateText: "2026-08-10 ~ 2026-09-04",
      agency: "전주정보문화산업진흥원",
    });
  });

  it("2쪽 고정본은 1쪽과 다른 글이다 — pno 가 진짜 먹는다", () => {
    expect(rowsP2.length).toBeGreaterThan(0);
    expect(rowsP2[0].title).toBe("2026년 전북 가상융합산업혁신센터 입주기업 모집 재공고");
    expect(rowsP2[0].detailUrl).toBe(
      "https://www.jica.or.kr/2025/inner.php?sMenu=A1000&mode=view&no=839",
    );
    expect(rows.map((r) => r.detailUrl)).not.toEqual(rowsP2.map((r) => r.detailUrl));
  });

  it("★접수일·마감일을 td.mview 위치로 가른다", () => {
    const both = rows.filter((r) => / ~ /.test(r.dateText));
    expect(both.length).toBe(9);
    for (const r of both) expect(r.dateText).toMatch(/^20\d{2}-\d{2}-\d{2} ~ 20\d{2}-\d{2}-\d{2}$/);
  });

  it("★제목에 날짜가 들어 있어도 접수일을 오염시키지 않는다 — 「날짜가 든 td」 함정", () => {
    // 칸 순서가 현황|제목|접수일|마감일|D-Day|조회수 라 제목이 접수일보다 앞이다.
    // 이 게시판 제목은 `[공고 제2026-066호]` 처럼 숫자를 달고, 날짜가 붙으면 첫 td 날짜가 된다.
    const polluted = listHtml.replaceAll(
      "[공고 제2026-066호] 버추얼 프로덕션 사전시각화 심화 교육과정 교육생 모집",
      "[공고 제2026-066호] (2026.01.05) 버추얼 프로덕션 사전시각화 심화 교육과정 교육생 모집",
    );
    const r = parseJicaList(polluted)[0];
    expect(r.dateText).toBe("2026-08-10 ~ 2026-09-04");
    expect(r.dateText).not.toContain("2026-01-05");
  });

  it("★접수중인데 마감일이 없으면 날짜를 비운다 — 개시형으로 넘기면 90일 뒤 자동 마감된다", () => {
    const noEnd = listHtml.replace('<td class="mview">2026.09.04</td>', '<td class="mview">-</td>');
    const r = parseJicaList(noEnd).find((x) => x.detailUrl.endsWith("no=847"));
    expect(r).toBeDefined();
    expect(r!.dateText).toBe("");
  });

  it("접수중이 아닌데 마감일만 없으면 「시작 ~」 개시형이다", () => {
    const noEnd = listHtml.replace('<td class="mview">2026.08.31</td>', '<td class="mview">-</td>');
    const r = parseJicaList(noEnd).find((x) => x.detailUrl.endsWith("no=820"));
    expect(r).toBeDefined();
    expect(r!.dateText).toBe("2026-05-20 ~");
  });

  it("한 자리 월·일도 두 자리로 채운다", () => {
    const one = listHtml.replace('<td class="mview">2026.08.10</td>', '<td class="mview">2026.8.10</td>');
    expect(parseJicaList(one)[0].dateText).toBe("2026-08-10 ~ 2026-09-04");
  });

  it("날짜가 없으면 빈 값 — 없는 마감일을 지어내지 않는다", () => {
    const none = listHtml
      .replace('<td class="mview">2026.08.10</td>', '<td class="mview">-</td>')
      .replace('<td class="mview">2026.09.04</td>', '<td class="mview">-</td>');
    expect(parseJicaList(none)[0].dateText).toBe("");
  });

  it("상세 주소에 /2025/ 경로가 들어간다 — 루트가 그리로 넘어간다", () => {
    for (const r of rows) {
      expect(r.detailUrl).toMatch(
        /^https:\/\/www\.jica\.or\.kr\/2025\/inner\.php\?sMenu=A1000&mode=view&no=\d+$/,
      );
    }
  });

  it("★「채용 지원사업」은 버리지 않는다 — 고용보조금은 제목에 「채용」을 쓴다", () => {
    expect(
      parseJicaList(
        listHtml.replaceAll(
          "버추얼 프로덕션 사전시각화 심화 교육과정 교육생 모집",
          "채용 지원사업",
        ),
      ).some((r) => r.title.includes("채용 지원사업")),
    ).toBe(true);
  });

  it("기관이 사람을 뽑는 글만 버린다", () => {
    expect(
      parseJicaList(
        listHtml.replaceAll("버추얼 프로덕션 사전시각화 심화 교육과정 교육생 모집", "직원 채용 공고"),
      ).some((r) => r.title.includes("채용 공고")),
    ).toBe(false);
  });

  it("카페 위탁운영업체 선정 모집은 버리고, 지원사업 4건은 살아남는다", () => {
    const cafe = listHtml.replaceAll(
      "[공고 제2026-066호] 버추얼 프로덕션 사전시각화 심화 교육과정 교육생 모집",
      "카페 위탁운영업체 선정 모집",
    );
    const cafeRows = parseJicaList(cafe);
    expect(cafeRows.some((r) => r.title.includes("카페 위탁운영업체"))).toBe(false);
    const titles = rows.map((r) => r.title);
    for (const t of KEEP) expect(titles).toContain(t);
    // 2쪽 고정본에 실제 카페 위탁 2건이 있다 — 용역 발주지 지원사업이 아니다.
    expect(rowsP2.filter((r) => r.title.includes("카페 위탁운영업체")).map((r) => r.title)).toEqual([]);
    expect(rowsP2).toHaveLength(7);
  });

  it("같은 글번호는 한 번만 담는다", () => {
    const ids = rows.map((r) => r.detailUrl);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("전주정보문화산업진흥원 설정", () => {
  /**
   * ★설정값이 자기 자신과 같은지만 재면 오타를 못 잡는다 — **상세 고정본에서 실제로 잡히는가**로 잰다.
   * 이 게시판은 본문이 대개 이미지라(실측 5건 중 3건 0자) 첨부 범위가 특히 중요하다.
   */
  it("★상세 본문·첨부 선택자가 상세 고정본에서 실제로 잡힌다", () => {
    const root = parseHtml(detailHtml);
    expect(root.querySelectorAll(jicaConfig.detailContentSelector!).length).toBeGreaterThan(0);
    const files = root.querySelectorAll(jicaConfig.attachmentsScopeSelector!);
    expect(files.length).toBeGreaterThan(0);
    expect(files.map((n) => n.innerHTML).join("")).toContain("filedown2.php");
  });

  /**
   * 처음엔 3쪽이었는데 적대 리뷰(코덱스)가 「한 번의 스냅샷으로 깊이를 정했다」고 짚어 7로 올렸다.
   * 신규 글이 쌓이면 장기 접수 공고가 4쪽 뒤로 밀려 영영 안 잡히고, 이미 저장된 것도 갱신이
   * 끊겨 stale 마감된다. 이 게시판은 **마감일을 직접 주므로** 깊이 파도 끝난 공고가 「모집중」으로
   * 안 섞인다 — 깊이의 대가가 없다. 2026-09-03 상한 올림으로 10(허용목록).
   */
  it("쪽넘김은 GET pno — 81쪽이라 maxPages 는 10(허용목록)", () => {
    expect(jicaConfig.list.maxPages).toBe(10);
    expect(jicaConfig.list.url(1)).toContain("pno=1");
    expect(jicaConfig.list.url(2)).toContain("pno=2");
    expect(jicaConfig.list.url(1)).not.toBe(jicaConfig.list.url(2));
  });

  it("2쪽 고정본에 pno=2 가 실제로 있다 — 위 판단의 근거", () => {
    expect(listP2Html).toMatch(/pno=2/);
    expect(listHtml).toMatch(/pno=2/);
  });

  it("지역은 전북 — 지역 조건 없이 전국에 노출되면 안 된다", () => {
    expect(jicaConfig.region).toBe("전북");
  });

  it("서식 변경 감지가 살아 있다 — 1은 검사를 끈 것과 같다", () => {
    expect(jicaConfig.expectMinRows).toBeGreaterThanOrEqual(2);
  });
});
