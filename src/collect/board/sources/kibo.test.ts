import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { pagingParamsOf } from "../engine";
import { isKiboDropTitle, kiboConfig, parseKiboList } from "./kibo";

/**
 * ★손으로 쓴 HTML 대신 **실사이트 고정본**으로 잰다.
 * 창원 사고: 지어낸 HTML 로 시험하면 선택자 오타가 그대로 통과한다.
 * 고정본: 2026-09-03 실측 공지사항 1·2쪽
 * (`boardType01.do?mode=list` · `article.offset=0|10&articleLimit=10`).
 */
const listHtml = readFileSync(join(__dirname, "../__fixtures__/kibo-list.html"), "utf-8");
const listP2Html = readFileSync(join(__dirname, "../__fixtures__/kibo-list-p2.html"), "utf-8");
const NOW = Date.parse("2026-09-03T00:00:00Z");
const rows = parseKiboList(listHtml, 1, NOW);
const p2 = parseKiboList(listP2Html, 2, NOW);
const combined = parseKiboList(listHtml + listP2Html, 1, NOW);

describe("기술보증기금 공지 목록 읽기 — 실사이트 고정본", () => {
  it("1쪽 고정본에서 DROP·중복을 뺀 4건을 읽고 첫 행이 맞다", () => {
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows.length).toBeLessThanOrEqual(10);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatchObject({
      title: "2026년도 중소기업 기술거래 기반조성사업 시행계획 수정 공고",
      detailUrl: "https://www.kibo.or.kr/main/board/boardType01.do?mode=view&articleNo=65470",
      dateText: "2026-08-24 ~",
      agency: "기술보증기금",
    });
  });

  it("★상세 주소에 article.offset·articleLimit 을 넣지 않는다 — 넣으면 같은 글이 쪽마다 다른 줄이 된다", () => {
    expect(rows.every((r) => !r.detailUrl.includes("article.offset"))).toBe(true);
    expect(rows.every((r) => !r.detailUrl.includes("articleLimit"))).toBe(true);
    expect(p2.every((r) => !r.detailUrl.includes("article.offset"))).toBe(true);
    expect(p2.every((r) => !r.detailUrl.includes("articleLimit"))).toBe(true);
  });

  it("등록일은 개시형 YYYY-MM-DD ~ 이다 — 마감일이 없다", () => {
    expect(rows.every((r) => r.dateText === "" || /^20\d{2}-\d{2}-\d{2} ~$/.test(r.dateText))).toBe(
      true,
    );
    expect(rows.some((r) => r.dateText !== "")).toBe(true);
  });

  it("날짜는 3번째 td 칸에서만 집는다 — 행 전체 글자면 번호·조회수와 붙는다", () => {
    const r = rows.find((x) => x.detailUrl.includes("articleNo=65470"));
    expect(r?.dateText).toBe("2026-08-24 ~");
    expect(r?.dateText).not.toMatch(/2647|조회/);
  });

  it("1쪽+2쪽을 합쳐 파싱해도 상세 열쇠 중복이 없고 7건이다", () => {
    const urls = combined.map((r) => r.detailUrl);
    expect(new Set(urls).size).toBe(urls.length);
    expect(combined).toHaveLength(7);
    expect(p2).toHaveLength(3);
    expect(rows.map((r) => r.detailUrl)).not.toEqual(p2.map((r) => r.detailUrl));
  });

  it("2쪽 첫 담기는 글은 1쪽과 다른 articleNo 다", () => {
    expect(p2[0]).toMatchObject({
      title: "「모두의 창업:사회혁신 소셜벤처 리그」모집공고",
      detailUrl: "https://www.kibo.or.kr/main/board/boardType01.do?mode=view&articleNo=65092",
      dateText: "2026-07-30 ~",
    });
  });
});

describe("거르개 — 버릴 것만 지정한다", () => {
  it("DROP 거르개가 실측 제목을 실제로 버린다", () => {
    const titles = combined.map((r) => r.title);
    expect(titles.some((t) => t.includes("비상임이사"))).toBe(false);
    expect(titles.some((t) => t.includes("상임이사"))).toBe(false);
    expect(titles.some((t) => t.includes("퀴즈"))).toBe(false);
    expect(titles.some((t) => t.includes("아차사고"))).toBe(false);
    expect(titles.some((t) => t.includes("유공"))).toBe(false);
    expect(titles.some((t) => t.includes("포상"))).toBe(false);
    expect(titles.some((t) => t.includes("청렴도"))).toBe(false);
    expect(titles.some((t) => t.includes("논문 모집"))).toBe(false);
    expect(titles.some((t) => t.includes("사무지원인력"))).toBe(false);
    expect(titles.some((t) => t.includes("채용공고"))).toBe(false);
    expect(titles.some((t) => t.includes("체험단"))).toBe(false);
    expect(isKiboDropTitle("기술보증기금 비상임이사 공개모집 공고")).toBe(true);
    expect(isKiboDropTitle("기술보증기금과 함께 하는 북북 퀴즈쇼!")).toBe(true);
    expect(isKiboDropTitle("2026년 하반기 국민 아차사고 사례 집중 공모")).toBe(true);
    expect(
      isKiboDropTitle("2026년「중소기업 기술거래 사업화 촉진 유공 포상」 후보자 모집 공고"),
    ).toBe(true);
    expect(isKiboDropTitle("공공기관 종합청렴도 평가 관련 개인정보 제3자 제공사항 알림")).toBe(
      true,
    );
    expect(isKiboDropTitle("기술보증기금「기술금융연구」誌 게재 논문 모집")).toBe(true);
    expect(isKiboDropTitle("기술보증기금 사무지원인력 채용공고(구미지점)")).toBe(true);
    expect(isKiboDropTitle("기술보증기금 상임이사 모집 공고")).toBe(true);
    expect(isKiboDropTitle("2026년 기술보증기금 정규직 신입직원 채용공고")).toBe(true);
    expect(isKiboDropTitle("제9기 기보 청년 기술평가체험단 모집공고")).toBe(true);
  });

  it("지원사업은 살린다 — 「채용」·「공개모집」을 통째로 버리지 않는다", () => {
    expect(rows.some((r) => r.title.includes("기술거래 기반조성사업"))).toBe(true);
    expect(rows.some((r) => r.title.includes("컨설팅 지원사업"))).toBe(true);
    expect(combined.some((r) => r.title.includes("기보벤처캠프"))).toBe(true);
    expect(isKiboDropTitle("청년 채용 지원사업 참여기업 모집")).toBe(false);
    expect(isKiboDropTitle("2026년 기술보증 지원사업 공개모집 공고")).toBe(false);
    expect(isKiboDropTitle("2026년 RnD사업화 유동화회사보증 발행계획 공고")).toBe(false);
  });
});

describe("붙박이 공지 — 1년 넘은 것은 담지 않는다", () => {
  it("notice 줄이 1년을 넘으면 아예 안 담는다 — 날짜를 비우면 90일간 되살아난다", () => {
    const planted = listHtml.replaceAll('<tr class="">', '<tr class="notice">');
    const old = parseKiboList(planted, 1, Date.parse("2030-01-01T00:00:00Z"));
    expect(old).toHaveLength(0);
    const fresh = parseKiboList(planted, 1, Date.parse("2026-09-03T00:00:00Z"));
    expect(fresh).toHaveLength(4);
    expect(fresh.every((r) => r.dateText === "")).toBe(true);
  });
});

describe("기술보증기금 설정", () => {
  it("쪽넘김은 GET article.offset 10씩 + articleLimit=10", () => {
    expect(kiboConfig.list.url(1)).toBe(
      "https://www.kibo.or.kr/main/board/boardType01.do?mode=list&article.offset=0&articleLimit=10",
    );
    expect(kiboConfig.list.url(2)).toBe(
      "https://www.kibo.or.kr/main/board/boardType01.do?mode=list&article.offset=10&articleLimit=10",
    );
    expect(kiboConfig.list.maxPages).toBe(6);
  });

  it("★상세 주소의 article.offset 은 엔진이 알아서 떼어 낸다 — 안 떼면 같은 글이 쪽마다 다른 주소가 된다", () => {
    expect(pagingParamsOf(kiboConfig)).toContain("article.offset");
  });

  it("지역은 전국 — 기술보증기금 공지다", () => {
    expect(kiboConfig.region).toBe("전국");
    expect(kiboConfig.id).toBe("kibo");
    expect(kiboConfig.agency).toBe("기술보증기금");
    expect(kiboConfig.label).toBe("기술보증기금 공지");
  });

  it("서식 변경 감지가 살아 있다 — 1은 검사를 끈 것과 같다", () => {
    expect(kiboConfig.expectMinRows).toBeGreaterThanOrEqual(2);
  });

  it("상세 주소 호스트가 baseUrl 과 같다", () => {
    expect(new URL(rows[0].detailUrl).host).toBe(new URL(kiboConfig.baseUrl).host);
  });
});

/** ★판정기를 망가뜨려 본다 — 안 하면 위 시험들이 「그냥 통과하는 글」일 뿐이다. */
describe("망가뜨려 보기", () => {
  it("행 껍데기 이름이 바뀌면 한 줄도 못 읽는다", () => {
    expect(parseKiboList(listHtml.replaceAll("board-table", "board-table-x"), 1, NOW)).toHaveLength(
      0,
    );
  });

  it("제목 칸(b-td-title)이 바뀌면 한 줄도 못 읽는다", () => {
    expect(parseKiboList(listHtml.replaceAll("b-td-title", "b-td-title-x"), 1, NOW)).toHaveLength(0);
  });

  it("등록일 칸이 사라지면 날짜를 비운다(오늘 날짜를 지어내지 않는다)", () => {
    // 3번째 td 의 YYYY-MM-DD 만 지운다. 제목 칸 안 모바일 span.b-date 는 남긴다 —
    // 파서가 칸 위치(3번째 td)를 본다는 증거.
    const broken = parseKiboList(
      listHtml.replaceAll(/<td>(20\d{2}-\d{2}-\d{2})<\/td>/g, "<td></td>"),
      1,
      NOW,
    );
    expect(broken.length).toBeGreaterThan(0);
    expect(broken.every((r) => r.dateText === "")).toBe(true);
  });
});
