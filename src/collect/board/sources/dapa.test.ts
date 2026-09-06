import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { dapaConfig, isDapaDropTitle, parseDapaList } from "./dapa";

/**
 * ★손으로 쓴 HTML 대신 **실사이트 고정본**으로 잰다.
 * 창원 사고: 지어낸 HTML 로 시험하면 선택자 오타가 그대로 통과한다.
 * 고정본: 2026-09-03 실측 공지사항 1·2쪽
 * (`/dapa/doc/selectDocList.do?menuSeq=3031&bbsSeq=443&currentPageNo=1|2`).
 */
const listHtml = readFileSync(join(__dirname, "../__fixtures__/dapa-list.html"), "utf-8");
const listP2Html = readFileSync(join(__dirname, "../__fixtures__/dapa-list-p2.html"), "utf-8");
const rows = parseDapaList(listHtml);
const rowsP2 = parseDapaList(listP2Html);
const combined = parseDapaList(listHtml + listP2Html);

describe("방위사업청 공지 목록 읽기 — 실사이트 고정본", () => {
  it("1쪽 10줄에서 거르개를 지난 4건을 읽고 첫 행이 맞다", () => {
    expect(rows).toHaveLength(4);
    expect(rows.length).toBeGreaterThanOrEqual(dapaConfig.expectMinRows ?? 0);
    expect(rows[0]).toMatchObject({
      title: "『지휘통제정보공유체계(R&D) 사업』예비설명회 안내_수정",
      detailUrl: "https://www.dapa.go.kr/dapa/doc/selectDoc.do?docSeq=59095&menuSeq=3031&bbsSeq=443",
      dateText: "2026-09-01 ~",
      agency: "방위사업청",
    });
    expect(rows[0].title).not.toMatch(/새\s*글/);
  });

  it("★상세 주소는 onclick 번호로 조립하고 쪽 번호가 안 섞인다", () => {
    expect(rows.every((r) => !r.detailUrl.includes("currentPageNo"))).toBe(true);
    expect(rowsP2.every((r) => !r.detailUrl.includes("currentPageNo"))).toBe(true);
    expect(
      rows.every((r) =>
        /^https:\/\/www\.dapa\.go\.kr\/dapa\/doc\/selectDoc\.do\?docSeq=\d+&menuSeq=3031&bbsSeq=443$/.test(
          r.detailUrl,
        ),
      ),
    ).toBe(true);
  });

  it("등록일은 개시형 YYYY-MM-DD ~ 이다 — 마감일이 없다", () => {
    expect(rows.every((r) => r.dateText === "" || /^20\d{2}-\d{2}-\d{2} ~$/.test(r.dateText))).toBe(
      true,
    );
    expect(rows.some((r) => r.dateText !== "")).toBe(true);
  });

  it("날짜는 칸(td)에서만 집는다 — 행 전체 글자면 번호·조회수와 붙는다", () => {
    const r = rows.find((x) => x.detailUrl.includes("docSeq=59095"));
    expect(r?.dateText).toBe("2026-09-01 ~");
    expect(r?.dateText).not.toMatch(/232/);
    expect(r?.dateText).not.toMatch(/223/);
  });

  it("DROP 낱말 행이 빠진다 — 입찰·합격자·임기제공무원·자체점검·소장 모집", () => {
    const titles = combined.map((r) => r.title);
    expect(titles.some((t) => t.includes("입찰"))).toBe(false);
    expect(titles.some((t) => t.includes("합격자"))).toBe(false);
    expect(titles.some((t) => t.includes("임기제공무원"))).toBe(false);
    expect(titles.some((t) => t.includes("자체점검"))).toBe(false);
    expect(titles.some((t) => t.includes("소장 모집"))).toBe(false);
    expect(isDapaDropTitle("무기체계 연구개발사업 업체선정 입찰공고_해양정보함-Ⅲ 통합임무체계 체계개발")).toBe(
      true,
    );
    expect(
      isDapaDropTitle(
        "(합격자 발표) 제5차 방위사업청 임기제공무원 서류전형 합격자 및 면접시험 일정 공고",
      ),
    ).toBe(true);
    expect(
      isDapaDropTitle("2026년 제6차 방위사업청 임기제공무원(전문임기제 나급 및 다급 각 1명) 채용 공고"),
    ).toBe(true);
    expect(isDapaDropTitle("2026년 방위사업청 고정형 영상정보처리기기(CCTV) 운영 자체점검 결과")).toBe(
      true,
    );
    expect(isDapaDropTitle("국방기술품질원 부설 국방기술진흥연구소 소장 모집 공고")).toBe(true);
  });

  it("「채용」을 통째로 버리지 않는다 — 채용 지원사업은 고용보조금이다", () => {
    expect(isDapaDropTitle("청년 채용 지원금 참여기업 모집")).toBe(false);
    expect(
      parseDapaList(
        listHtml.replace(
          "『지휘통제정보공유체계(R&D) 사업』예비설명회 안내_수정",
          "2026년 방위산업 중소기업 신규직원 채용 지원사업 참여기업 모집공고",
        ),
      ).some((r) => r.title.includes("채용 지원사업")),
    ).toBe(true);
  });

  it("살아남아야 할 지원사업·설명회는 남는다", () => {
    const titles = combined.map((r) => r.title);
    expect(titles.some((t) => t.includes("방산 중소수출길 지원사업"))).toBe(true);
    expect(titles.some((t) => t.includes("방위산업 계약학과 지원사업"))).toBe(true);
    expect(titles.some((t) => t.includes("컨설팅 참여기업"))).toBe(true);
    expect(titles.some((t) => t.includes("예비설명회"))).toBe(true);
  });

  it("1·2쪽을 합쳐도 중복이 없고 8건이다", () => {
    expect(rowsP2).toHaveLength(4);
    expect(rowsP2[0]).toMatchObject({
      title: "방위사업청 전입희망 5급 이하 공무원 모집 공고",
      detailUrl: "https://www.dapa.go.kr/dapa/doc/selectDoc.do?docSeq=58961&menuSeq=3031&bbsSeq=443",
      dateText: "2026-08-07 ~",
    });
    const urls = combined.map((r) => r.detailUrl);
    expect(new Set(urls).size).toBe(urls.length);
    expect(combined).toHaveLength(8);
    expect(rows.map((r) => r.detailUrl)).not.toEqual(rowsP2.map((r) => r.detailUrl));
  });

  it("★1년 넘게 붙어 있는 붙박이는 아예 안 담는다 — 날짜를 비우면 90일간 되살아난다", () => {
    const aged = listHtml.replace(">232<", ">공지<").replace(">2026-09-01<", ">2024-01-01<");
    const old = parseDapaList(aged, 1, Date.parse("2026-09-03T00:00:00Z"));
    expect(old.some((r) => r.detailUrl.includes("docSeq=59095"))).toBe(false);
    const recentPinned = listHtml.replace(">232<", ">공지<");
    const kept = parseDapaList(recentPinned, 1, Date.parse("2026-09-03T00:00:00Z"));
    const row = kept.find((r) => r.detailUrl.includes("docSeq=59095"));
    expect(row).toBeDefined();
    expect(row!.dateText).toBe("");
  });
});

describe("방위사업청 공지 설정", () => {
  it("쪽넘김은 GET currentPageNo · 공지사항(bbsSeq=443) 판만 붙인다", () => {
    expect(dapaConfig.list.url(1)).toBe(
      "https://www.dapa.go.kr/dapa/doc/selectDocList.do?menuSeq=3031&bbsSeq=443&currentPageNo=1",
    );
    expect(dapaConfig.list.url(2)).toBe(
      "https://www.dapa.go.kr/dapa/doc/selectDocList.do?menuSeq=3031&bbsSeq=443&currentPageNo=2",
    );
    expect(dapaConfig.list.url(1)).not.toBe(dapaConfig.list.url(2));
    expect(dapaConfig.list.maxPages).toBe(8);
    expect(dapaConfig.region).toBe("전국");
    expect(dapaConfig.id).toBe("dapa");
    expect(dapaConfig.agency).toBe("방위사업청");
    expect(dapaConfig.charset).toBe("utf-8");
  });

  it("서식 변경 감지가 살아 있다 — 1은 검사를 끈 것과 같다", () => {
    expect(dapaConfig.expectMinRows).toBeGreaterThanOrEqual(2);
  });

  it("목록 행에 첨부 파일 링크가 섞여 heuristic 을 끈다", () => {
    expect(dapaConfig.skipHeuristic).toBe(true);
  });
});

/** ★판정기를 망가뜨려 본다 — 안 하면 위 시험들이 「그냥 통과하는 글」일 뿐이다. */
describe("망가뜨려 보기", () => {
  it("행 선택자가 틀리면 0행이다", () => {
    expect(parseDapaList(listHtml.replaceAll("list-table", "list-table-x"))).toHaveLength(0);
  });

  it("제목 칸(td.subject)이 바뀌면 한 줄도 못 읽는다", () => {
    expect(
      parseDapaList(listHtml.replaceAll('class="subject"', 'class="subject-x"')),
    ).toHaveLength(0);
  });

  it("게시일 칸이 사라지면 날짜를 비운다(오늘 날짜를 지어내지 않는다)", () => {
    expect(
      parseDapaList(listHtml.replaceAll(/<td>20\d{2}-\d{2}-\d{2}<\/td>/g, "<td></td>")).every(
        (r) => r.dateText === "",
      ),
    ).toBe(true);
  });
});
