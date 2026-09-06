import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bssinboConfig, isBssinboDropTitle, parseBssinboList } from "./bssinbo";

/**
 * ★손으로 쓴 HTML 대신 **실사이트 고정본**으로 잰다.
 * 창원 사고: 지어낸 HTML 로 시험하면 선택자 오타가 그대로 통과한다.
 * 고정본: 2026-09-03 실측 공지사항 1·2쪽 (`bcIdx=565&mid=0301010000&page=1|2`).
 */
const listHtml = readFileSync(join(__dirname, "../__fixtures__/bssinbo-list.html"), "utf-8");
const listP2Html = readFileSync(join(__dirname, "../__fixtures__/bssinbo-list-p2.html"), "utf-8");
const NOW = Date.parse("2026-09-03T00:00:00Z");
const rows = parseBssinboList(listHtml, 1, NOW);
const p2 = parseBssinboList(listP2Html, 2, NOW);
const combined = parseBssinboList(listHtml + listP2Html, 1, NOW);

describe("부산신용보증재단 공지사항 목록 읽기 — 실사이트 고정본", () => {
  it("1쪽 고정본에서 DROP·중복을 뺀 2건을 읽고 첫 행이 맞다", () => {
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows.length).toBeLessThanOrEqual(10);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      title: "「프랜차이즈 창업 기초 교육」수강생 모집 홍보",
      detailUrl:
        "https://www.busansinbo.or.kr/portal/board/post/view.do?bcIdx=565&mid=0301010000&idx=8124",
      dateText: "2026-08-10 ~",
      agency: "부산신용보증재단",
    });
  });

  it("★상세 주소에 쪽 번호를 넣지 않는다 — 넣으면 같은 글이 쪽마다 다른 줄이 된다", () => {
    expect(rows.every((r) => !/[?&]page=/.test(r.detailUrl))).toBe(true);
    expect(p2.every((r) => !/[?&]page=/.test(r.detailUrl))).toBe(true);
  });

  it("등록일은 개시형 YYYY-MM-DD ~ 이다 — 마감일이 없다", () => {
    expect(rows.every((r) => r.dateText === "" || /^20\d{2}-\d{2}-\d{2} ~$/.test(r.dateText))).toBe(
      true,
    );
    expect(rows.some((r) => r.dateText !== "")).toBe(true);
  });

  it("날짜는 td.date 칸에서만 집는다 — 행 전체 글자면 번호·조회수와 붙는다", () => {
    const r = rows.find((x) => x.detailUrl.includes("idx=8124"));
    expect(r?.dateText).toBe("2026-08-10 ~");
    expect(r?.dateText).not.toMatch(/685|95/);
  });

  it("1쪽+2쪽을 합쳐 파싱해도 상세 열쇠 중복이 없고 7건이다", () => {
    const urls = combined.map((r) => r.detailUrl);
    expect(new Set(urls).size).toBe(urls.length);
    expect(combined).toHaveLength(7);
    expect(p2).toHaveLength(5);
    expect(rows.map((r) => r.detailUrl)).not.toEqual(p2.map((r) => r.detailUrl));
  });

  it("2쪽 첫 담기는 글은 1쪽과 다른 idx 다", () => {
    expect(p2[0]).toMatchObject({
      title: "「프랜차이즈 창업 기초 교육」수강생 모집 홍보",
      detailUrl:
        "https://www.busansinbo.or.kr/portal/board/post/view.do?bcIdx=565&mid=0301010000&idx=8000",
      dateText: "2026-05-27 ~",
    });
  });

  it("DROP 거르개가 실측 제목을 실제로 버린다", () => {
    const titles = combined.map((r) => r.title);
    expect(titles.some((t) => t.includes("사기"))).toBe(false);
    expect(titles.some((t) => t.includes("설문조사"))).toBe(false);
    expect(titles.some((t) => t.includes("환경산업조사"))).toBe(false);
    expect(titles.some((t) => t.includes("실천과제"))).toBe(false);
    expect(titles.some((t) => t.includes("업무제안"))).toBe(false);
    expect(titles.some((t) => t.includes("통행료"))).toBe(false);
    expect(titles.some((t) => t.includes("만족도"))).toBe(false);
    expect(titles.some((t) => t.includes("특강"))).toBe(false);
    expect(titles.some((t) => t.includes("이벤트"))).toBe(false);
    expect(titles.some((t) => t.includes("GBSI"))).toBe(false);
    expect(titles.some((t) => t.includes("합동구매"))).toBe(false);
    expect(isBssinboDropTitle("공무원 및 공공기관 사칭 대리구매 사기 범죄 주의")).toBe(true);
    expect(isBssinboDropTitle("소상공인 대상 온라인 설문조사 홍보")).toBe(true);
    expect(isBssinboDropTitle("2025년 기준 부산환경산업조사 홍보")).toBe(true);
    expect(isBssinboDropTitle("시민참여형 온실가스 감축 8월 실천과제(단짝친구, 텀블러)홍보 알림")).toBe(
      true,
    );
    expect(isBssinboDropTitle("2026년 신용보증재단중앙회 특별 업무제안 공모")).toBe(true);
    expect(isBssinboDropTitle("광안대교 출퇴근시간 통행료 무료화 시행에 따른 홍보")).toBe(true);
    expect(isBssinboDropTitle("지역신보 보증사업평가 고객만족도 조사 안내")).toBe(true);
    expect(isBssinboDropTitle("「2026년 상반기 전문가 특강」 개최")).toBe(true);
    expect(isBssinboDropTitle("2026년 탄소중립포인트 에너지분야 신규 가입 이벤트 알림")).toBe(true);
    expect(isBssinboDropTitle("2026년 2분기 보증기업 경기실사지수(GBSI) 설문조사 안내")).toBe(true);
    expect(isBssinboDropTitle("「2026 지역상품 합동구매 상담회」참가업체 모집 홍보")).toBe(true);
  });

  it("지원사업·채용 지원은 살린다 — 「채용」을 통째로 버리지 않는다", () => {
    expect(rows.some((r) => r.title.includes("온실가스 감축활동 지원사업"))).toBe(true);
    expect(combined.some((r) => r.title.includes("서비스 강소기업 육성 지원사업"))).toBe(true);
    expect(isBssinboDropTitle("2026 BEF 중소기업 온실가스 감축활동 지원사업 홍보")).toBe(false);
    expect(isBssinboDropTitle("청년 채용 지원금 참여기업 모집")).toBe(false);
    expect(isBssinboDropTitle("직원 채용 공고")).toBe(true);
  });
});

describe("붙박이 공지 — 1년 넘은 것은 담지 않는다", () => {
  it("notice 줄이 1년을 넘으면 아예 안 담는다 — 날짜를 비우면 90일간 되살아난다", () => {
    const planted = listHtml.replace(
      /<tr >((?:(?!<tr >)[\s\S])*?data-req-get-p-idx="8089")/,
      '<tr class="notice">$1',
    );
    const old = parseBssinboList(planted, 1, Date.parse("2030-01-01T00:00:00Z"));
    expect(old.some((r) => r.detailUrl.includes("idx=8089"))).toBe(false);
    const fresh = parseBssinboList(planted, 1, Date.parse("2026-07-15T00:00:00Z"));
    const pinned = fresh.find((r) => r.detailUrl.includes("idx=8089"));
    expect(pinned).toBeDefined();
    expect(pinned!.dateText).toBe("");
  });
});

describe("부산신용보증재단 설정", () => {
  it("쪽넘김은 GET page — 쪽마다 주소가 달라야 중복이 안 생긴다", () => {
    expect(bssinboConfig.list.url(1)).toBe(
      "https://www.busansinbo.or.kr/portal/board/post/list.do?bcIdx=565&mid=0301010000&page=1",
    );
    expect(bssinboConfig.list.url(2)).toBe(
      "https://www.busansinbo.or.kr/portal/board/post/list.do?bcIdx=565&mid=0301010000&page=2",
    );
    expect(bssinboConfig.list.maxPages).toBe(10);
  });

  it("지역은 부산 — 지역 조건 없이 전국에 노출되면 안 된다", () => {
    expect(bssinboConfig.region).toBe("부산");
    expect(bssinboConfig.id).toBe("bssinbo");
    expect(bssinboConfig.agency).toBe("부산신용보증재단");
  });

  it("서식 변경 감지가 살아 있다 — 1은 검사를 끈 것과 같다", () => {
    expect(bssinboConfig.expectMinRows).toBeGreaterThanOrEqual(2);
  });

  it("목록 행에 첨부 파일 링크가 섞여 heuristic 을 끈다", () => {
    expect(bssinboConfig.skipHeuristic).toBe(true);
    expect(listHtml).toContain("file-download");
  });

  it("상세 주소 호스트가 baseUrl 과 같다", () => {
    expect(new URL(rows[0].detailUrl).host).toBe(new URL(bssinboConfig.baseUrl).host);
  });
});

/** ★판정기를 망가뜨려 본다 — 안 하면 위 시험들이 「그냥 통과하는 글」일 뿐이다. */
describe("망가뜨려 보기", () => {
  it("행 껍데기 이름이 바뀌면 한 줄도 못 읽는다", () => {
    expect(parseBssinboList(listHtml.replaceAll("board-table", "board-table-x"), 1, NOW)).toHaveLength(
      0,
    );
  });

  it("제목 칸 data-req-get-p-idx 가 바뀌면 한 줄도 못 읽는다", () => {
    expect(
      parseBssinboList(listHtml.replaceAll("data-req-get-p-idx", "data-req-get-p-idx-x"), 1, NOW),
    ).toHaveLength(0);
  });

  it("작성일 칸이 사라지면 날짜를 비운다(오늘 날짜를 지어내지 않는다)", () => {
    expect(
      parseBssinboList(listHtml.replaceAll('class="date"', 'class="date-x"'), 1, NOW).every(
        (r) => r.dateText === "",
      ),
    ).toBe(true);
  });
});
