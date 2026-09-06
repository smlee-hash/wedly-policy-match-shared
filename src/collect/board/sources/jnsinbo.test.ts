import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { pagingParamsOf } from "../engine";
import { isJnsinboDropTitle, parseJnsinboList, jnsinboConfig } from "./jnsinbo";

/**
 * ★손으로 쓴 HTML 대신 **실사이트 고정본**으로 잰다.
 * 창원 사고: 지어낸 HTML 로 시험하면 선택자 오타가 그대로 통과한다.
 * 고정본: 2026-09-03 실측 공지사항 1·2쪽 (`/jnsinbo/operation/news/notice.do`,
 * 2쪽은 GET `?PageIndex=2` — POST+CSRF 와 같은 15행).
 */
const listHtml = readFileSync(join(__dirname, "../__fixtures__/jnsinbo-list.html"), "utf-8");
const listP2Html = readFileSync(join(__dirname, "../__fixtures__/jnsinbo-list-p2.html"), "utf-8");
const NOW = Date.parse("2026-09-03T00:00:00Z");
const rows = parseJnsinboList(listHtml, 1, NOW);
const rowsP2 = parseJnsinboList(listP2Html, 2, NOW);
const combined = parseJnsinboList(listHtml + listP2Html, 1, NOW);

describe("전남신용보증재단 공지사항 목록 읽기 — 실사이트 고정본", () => {
  it("1쪽 고정본에서 DROP·묵은 붙박이를 뺀 8건을 읽고 첫 행이 맞다", () => {
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows.length).toBeLessThanOrEqual(15);
    expect(rows).toHaveLength(8);
    expect(rows[0]).toMatchObject({
      title: "2026년 자영업자 고용보험료 지원사업 모집 공고",
      detailUrl: "https://www.jnsinbo.or.kr/jnsinbo/Board/8769/detailView.do",
      dateText: "2026-03-17 ~",
      agency: "전남신용보증재단",
    });
  });

  it("★상세 주소에 쪽 번호를 넣지 않는다 — 넣으면 같은 글이 쪽마다 다른 줄이 된다", () => {
    expect(rows.every((r) => !/[?&]PageIndex=/i.test(r.detailUrl))).toBe(true);
    expect(rowsP2.every((r) => !/[?&]PageIndex=/i.test(r.detailUrl))).toBe(true);
    expect(rows.every((r) => /^https:\/\/www\.jnsinbo\.or\.kr\/jnsinbo\/Board\/\d+\/detailView\.do$/.test(r.detailUrl))).toBe(
      true,
    );
  });

  it("등록일은 개시형 YYYY-MM-DD ~ 이다 — 목록에 마감일이 없다", () => {
    expect(rows.every((r) => r.dateText !== "")).toBe(true);
    for (const r of rows) expect(r.dateText).toMatch(/^\d{4}-\d{2}-\d{2} ~$/);
  });

  it("날짜는 td.date 칸에서만 집는다 — 행 전체 글자면 번호·조회수와 붙는다", () => {
    const r = rows.find((x) => x.detailUrl.includes("/Board/8818/"));
    expect(r?.dateText).toBe("2026-04-10 ~");
    expect(r?.dateText).not.toMatch(/224|1088/);
  });

  it("1쪽+2쪽을 합쳐 파싱해도 상세 열쇠 중복이 없고 12건이다", () => {
    const urls = combined.map((r) => r.detailUrl);
    expect(new Set(urls).size).toBe(urls.length);
    expect(combined).toHaveLength(12);
    const concat = [...rows, ...rowsP2];
    expect(new Set(concat.map((r) => r.detailUrl)).size).toBe(12);
  });

  it("2쪽 고정본은 1쪽과 다른 글이다 — PageIndex 가 진짜 먹는다", () => {
    expect(rowsP2).toHaveLength(6);
    expect(rowsP2.some((r) => r.detailUrl.includes("/Board/8637/"))).toBe(true);
    expect(rowsP2.some((r) => r.title.includes("소상공인 지원사업」 통합 공고"))).toBe(true);
    expect(rows.map((r) => r.detailUrl)).not.toEqual(rowsP2.map((r) => r.detailUrl));
  });

  it("지원사업 글은 살아남는다", () => {
    expect(rows.some((r) => r.title.includes("고용보험료 지원사업"))).toBe(true);
    expect(rows.some((r) => r.title.includes("창업교실"))).toBe(true);
    expect(rows.some((r) => r.title.includes("WINGz"))).toBe(true);
    expect(rows.some((r) => r.title.includes("광양시 소상공인 경영혁신"))).toBe(true);
    expect(rows.some((r) => r.title.includes("라이브커머스"))).toBe(true);
  });
});

describe("거르개 — 버릴 것만 지정한다", () => {
  it("DROP 거르개가 실측 제목을 실제로 버린다", () => {
    const titles = combined.map((r) => r.title);
    expect(titles.some((t) => t.includes("GBSI"))).toBe(false);
    expect(titles.some((t) => t.includes("설문조사"))).toBe(false);
    expect(titles.some((t) => t.includes("당첨자"))).toBe(false);
    expect(titles.some((t) => t.includes("개인정보"))).toBe(false);
    expect(titles.some((t) => t.includes("비상근 이사"))).toBe(false);
    expect(titles.some((t) => t.includes("불용물품"))).toBe(false);
    expect(titles.some((t) => t.includes("보이스피싱"))).toBe(false);
    expect(titles.some((t) => t.includes("방문상담"))).toBe(false);
    expect(isJnsinboDropTitle("2026년 2분기 보증기업 경기실사지수(GBSI) 설문조사 안내")).toBe(true);
    expect(isJnsinboDropTitle("2026년 전라남도 소상공인 실태조사 커피 기프티콘 당첨자 발표")).toBe(true);
    expect(
      isJnsinboDropTitle(
        "2026년 전라남도 출자,출연기관 경영평가 고객만족도 조사 관련 개인정보 제3자 제공사실 알림",
      ),
    ).toBe(true);
    expect(isJnsinboDropTitle("[공고] 2026년 전남신용보증재단 비상근 이사 공개모집")).toBe(true);
    expect(isJnsinboDropTitle("(종료)전남신용보증재단 불용물품 무상양여 소요조회")).toBe(true);
    expect(isJnsinboDropTitle("(종료)(재공고)전남신용보증재단 사무용가구·기기 불용물품 매각")).toBe(true);
    expect(isJnsinboDropTitle("보이스피싱 피해 예방 안내")).toBe(true);
    expect(isJnsinboDropTitle("영업점 방문상담 예약안내 매뉴얼")).toBe(true);
    expect(isJnsinboDropTitle("※ 특례보증대상자 문자피싱 주의 및 피해발생 시 대처방안 안내 ※")).toBe(true);
  });

  it("「채용」을 통째로 버리지 않는다 — 채용 지원사업은 살아남는다", () => {
    expect(isJnsinboDropTitle("청년 채용 지원사업 참여기업 모집")).toBe(false);
    expect(isJnsinboDropTitle("직원 채용 지원사업")).toBe(false);
    expect(isJnsinboDropTitle("2026년 자영업자 고용보험료 지원사업 모집 공고")).toBe(false);
    expect(isJnsinboDropTitle("직원 채용 공고")).toBe(true);
  });
});

describe("붙박이 공지 — 1년 넘은 것은 담지 않는다", () => {
  it("기준 시각을 2030년으로 옮기면 2026-03-17 붙박이가 빠진다", () => {
    const old = parseJnsinboList(listHtml, 1, Date.parse("2030-01-01T00:00:00Z"));
    expect(old.some((r) => r.detailUrl.includes("/Board/8769/"))).toBe(false);
    expect(old.some((r) => r.detailUrl.includes("/Board/8667/"))).toBe(false);
    expect(old.some((r) => r.detailUrl.includes("/Board/8992/"))).toBe(true);
  });
});

describe("전남신용보증재단 설정", () => {
  it("쪽넘김은 GET PageIndex — 소문자 pageIndex 함정과 구분한다", () => {
    expect(jnsinboConfig.list.url(1)).toBe(
      "https://www.jnsinbo.or.kr/jnsinbo/operation/news/notice.do?PageIndex=1",
    );
    expect(jnsinboConfig.list.url(2)).toBe(
      "https://www.jnsinbo.or.kr/jnsinbo/operation/news/notice.do?PageIndex=2",
    );
    expect(jnsinboConfig.list.maxPages).toBe(8);
    expect(pagingParamsOf(jnsinboConfig)).toContain("PageIndex");
  });

  it("지역은 전남 — 전남신용보증재단 공지사항이다", () => {
    expect(jnsinboConfig.region).toBe("전남");
    expect(jnsinboConfig.id).toBe("jnsinbo");
    expect(jnsinboConfig.agency).toBe("전남신용보증재단");
  });

  it("서식 변경 감지가 살아 있다 — 1은 검사를 끈 것과 같다", () => {
    expect(jnsinboConfig.expectMinRows).toBeGreaterThanOrEqual(2);
  });

  it("상세 본문·첨부 자리가 실측 선택자다", () => {
    expect(jnsinboConfig.detailContentSelector).toBe("div.board_detail_content");
    expect(jnsinboConfig.attachmentsScopeSelector).toBe("div.board_detail_attach");
  });

  it("상세 주소 호스트가 baseUrl 과 같아 허용 호스트 검사를 통과한다", () => {
    expect(new URL(rows[0].detailUrl).host).toBe(new URL(jnsinboConfig.baseUrl).host);
  });
});

/** ★판정기를 망가뜨려 본다 — 안 하면 위 시험들이 「그냥 통과하는 글」일 뿐이다. */
describe("망가뜨려 보기", () => {
  it("행 껍데기 이름이 바뀌면 한 줄도 못 읽는다", () => {
    expect(parseJnsinboList(listHtml.replaceAll("tbl_Board_notice", "tbl_Board_notice_x"), 1, NOW)).toHaveLength(
      0,
    );
  });

  it("제목 칸(td.sbj)이 바뀌면 한 줄도 못 읽는다", () => {
    expect(parseJnsinboList(listHtml.replaceAll('class="sbj"', 'class="sbj-x"'), 1, NOW)).toHaveLength(0);
  });

  it("작성일 칸이 사라지면 날짜를 비운다(오늘 날짜를 지어내지 않는다)", () => {
    const broken = parseJnsinboList(listHtml.replaceAll('class="date"', 'class="date-x"'), 1, NOW);
    expect(broken.length).toBeGreaterThan(0);
    expect(broken.every((r) => r.dateText === "")).toBe(true);
  });
});
