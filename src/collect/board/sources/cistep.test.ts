import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cistepConfig, isCistepDropTitle, parseCistepList } from "./cistep";

/**
 * ★손으로 쓴 HTML 대신 **실사이트 고정본**으로 잰다.
 * 창원 사고: 지어낸 HTML 로 시험하면 선택자 오타가 그대로 통과한다.
 * 고정본: 2026-09-03 실측 공지사항 1·2쪽 (`/zboard/list.do?lmCode=notice&pageIndex=1|2`).
 */
const listHtml = readFileSync(join(__dirname, "../__fixtures__/cistep-list.html"), "utf-8");
const listP2Html = readFileSync(join(__dirname, "../__fixtures__/cistep-list-p2.html"), "utf-8");
const rows = parseCistepList(listHtml);
const rowsP2 = parseCistepList(listP2Html);
const combined = [...rows, ...rowsP2];

describe("천안과학산업진흥원 공지사항 목록 읽기 — 실사이트 고정본", () => {
  it("1쪽 10줄에서 거르개를 지난 5건을 읽고 첫 행이 맞다", () => {
    expect(rows).toHaveLength(5);
    expect(rows[0]).toMatchObject({
      title: "2026년 천안 전략산업 가치사슬 체계구축 지원사업 참여기업 모집 재공고",
      detailUrl: "https://www.cistep.re.kr/zboard/read.do?lmCode=notice&pd_pkid=14428",
      dateText: "2026-08-19 ~",
      agency: "천안과학산업진흥원",
    });
  });

  it("★상세 주소에 쪽 번호를 넣지 않는다 — 넣으면 같은 글이 쪽마다 다른 줄이 된다", () => {
    expect(rows.every((r) => !r.detailUrl.includes("pageIndex"))).toBe(true);
    expect(rowsP2.every((r) => !r.detailUrl.includes("pageIndex"))).toBe(true);
    expect(rows.every((r) => /[?&]pd_pkid=\d+$/.test(r.detailUrl))).toBe(true);
  });

  it("등록일은 개시형 YYYY-MM-DD ~ 이다 — 마감일이 없다", () => {
    expect(rows.every((r) => /^20\d{2}-\d{2}-\d{2} ~$/.test(r.dateText))).toBe(true);
    expect(rowsP2.every((r) => /^20\d{2}-\d{2}-\d{2} ~$/.test(r.dateText))).toBe(true);
  });

  it("날짜는 td.date 칸에서만 집는다 — 행 전체 글자면 번호·조회수와 붙는다", () => {
    const r = rows.find((x) => x.detailUrl.includes("pd_pkid=14428"));
    expect(r?.dateText).toBe("2026-08-19 ~");
    expect(r?.dateText).not.toMatch(/312/);
  });

  it("1쪽과 2쪽을 합쳐도 중복이 없고 12건이다", () => {
    const urls = combined.map((r) => r.detailUrl);
    expect(new Set(urls).size).toBe(urls.length);
    expect(combined).toHaveLength(12);
    expect(rowsP2).toHaveLength(7);
    expect(rowsP2[0].title).toContain("C-Star Awards");
    expect(rowsP2[0].detailUrl).toBe(
      "https://www.cistep.re.kr/zboard/read.do?lmCode=notice&pd_pkid=14038",
    );
  });

  it("DROP 거르개가 실측 제목을 실제로 버린다", () => {
    const titles = combined.map((r) => r.title);
    expect(titles.some((t) => t.includes("평가위원"))).toBe(false);
    expect(titles.some((t) => t.includes("평가 결과"))).toBe(false);
    expect(titles.some((t) => t.includes("제안서 평가"))).toBe(false);
    expect(
      isCistepDropTitle("(수정)SCEWC 2026 천안관 조성 및 운영 용역 평가위원 모집 공고"),
    ).toBe(true);
    expect(
      isCistepDropTitle(
        "「World Smart City Expo 2026 천안관 조성 및 운영 용역」 제안서 평가 결과 공고",
      ),
    ).toBe(true);
    expect(
      isCistepDropTitle(
        "천안시 거점형 스마트도시 조성사업 클라우드 인프라 구축 용역 제안서 평가위원 후보자 모집 공고",
      ),
    ).toBe(true);
  });

  it("「가치평가 지원사업」은 버리지 않는다 — 낱말 「평가」를 통째로 걸면 죽는다", () => {
    expect(rowsP2.some((r) => r.title.includes("가치평가 지원사업"))).toBe(true);
    expect(isCistepDropTitle("⌜2026년 천안 기술이전·가치평가 지원사업⌟ 참여기업 모집공고")).toBe(
      false,
    );
  });

  it("「채용」을 통째로 버리지 않는다 — 채용 지원사업은 고용보조금이다", () => {
    expect(isCistepDropTitle("청년 채용 지원금 참여기업 모집")).toBe(false);
    expect(isCistepDropTitle("직원 채용 공고")).toBe(true);
  });

  it("★1년 넘게 붙어 있는 붙박이는 아예 안 담는다 — 날짜를 비우면 90일간 되살아난다", () => {
    const aged = listHtml.replace("312", "공지").replace(">2026-08-19<", ">2024-01-01<");
    const old = parseCistepList(aged, 1, Date.parse("2026-09-03T00:00:00Z"));
    expect(old.some((r) => r.detailUrl.includes("pd_pkid=14428"))).toBe(false);
    const recentPinned = listHtml.replace("312", "공지");
    const kept = parseCistepList(recentPinned, 1, Date.parse("2026-09-03T00:00:00Z"));
    const row = kept.find((r) => r.detailUrl.includes("pd_pkid=14428"));
    expect(row).toBeDefined();
    expect(row!.dateText).toBe("");
  });
});

describe("천안과학산업진흥원 설정", () => {
  it("쪽넘김은 GET pageIndex · 공지사항 판만 붙인다", () => {
    expect(cistepConfig.list.url(1)).toBe(
      "https://www.cistep.re.kr/zboard/list.do?lmCode=notice&pageIndex=1",
    );
    expect(cistepConfig.list.url(2)).toBe(
      "https://www.cistep.re.kr/zboard/list.do?lmCode=notice&pageIndex=2",
    );
    expect(cistepConfig.list.maxPages).toBe(10);
    expect(cistepConfig.region).toBe("충남");
    expect(cistepConfig.id).toBe("cistep");
  });

  it("서식 변경 감지가 살아 있다 — 1은 검사를 끈 것과 같다", () => {
    expect(cistepConfig.expectMinRows).toBeGreaterThanOrEqual(2);
  });

  it("상세 본문·첨부 칸을 실측 선택자로 박는다", () => {
    expect(cistepConfig.detailContentSelector).toBe("td.bbs_detail");
    expect(cistepConfig.attachmentsScopeSelector).toBe("td.file");
  });
});

/** ★판정기를 망가뜨려 본다 — 안 하면 위 시험들이 「그냥 통과하는 글」일 뿐이다. */
describe("망가뜨려 보기", () => {
  it("행 껍데기 이름이 바뀌면 한 줄도 못 읽는다", () => {
    expect(parseCistepList(listHtml.replaceAll("list_1", "list_1-x"))).toHaveLength(0);
  });

  it("제목 칸(td.subject)이 바뀌면 한 줄도 못 읽는다", () => {
    expect(parseCistepList(listHtml.replaceAll('class="subject"', 'class="subject-x"'))).toHaveLength(
      0,
    );
  });

  it("작성일 칸이 사라지면 날짜를 비운다(오늘 날짜를 지어내지 않는다)", () => {
    expect(
      parseCistepList(listHtml.replaceAll('class="date"', 'class="date-x"')).every(
        (r) => r.dateText === "",
      ),
    ).toBe(true);
  });
});
