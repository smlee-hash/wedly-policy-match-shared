import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { pagingParamsOf } from "../engine";
import { isJbsinboDropTitle, parseJbsinboList, jbsinboConfig } from "./jbsinbo";

/**
 * ★손으로 쓴 HTML 대신 **실사이트 고정본**으로 잰다.
 * 창원 사고: 지어낸 HTML 로 시험하면 선택자 오타가 그대로 통과한다.
 * 고정본: 2026-09-03 실측 공지사항 1·2쪽
 * (`/site/menu/MENU_000000000000090/board/list?site_assets=%2Fassets%2Fsite%2FLET` · `&pageIndex=2`).
 */
const listHtml = readFileSync(join(__dirname, "../__fixtures__/jbsinbo-list.html"), "utf-8");
const listP2Html = readFileSync(join(__dirname, "../__fixtures__/jbsinbo-list-p2.html"), "utf-8");
const NOW = Date.parse("2026-09-03T00:00:00Z");
const rows = parseJbsinboList(listHtml, 1, NOW);
const rowsP2 = parseJbsinboList(listP2Html, 2, NOW);
const combined = parseJbsinboList(listHtml + listP2Html, 1, NOW);

describe("전북신용보증재단 공지사항 목록 읽기 — 실사이트 고정본", () => {
  it("1쪽 고정본에서 DROP·중복을 뺀 2건을 읽고 첫 행이 맞다", () => {
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows.length).toBeLessThanOrEqual(10);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      title: "(카드뉴스) 2026 추석 명절 청탁금지법 선물 바로 알기",
      detailUrl: "https://www.jbcredit.or.kr/site/menu/MENU_000000000000090/board/view/NTT_005641",
      dateText: "2026-09-02 ~",
      agency: "전북신용보증재단",
    });
  });

  it("★상세 주소에 쪽 번호를 넣지 않는다 — 넣으면 같은 글이 쪽마다 다른 줄이 된다", () => {
    expect(rows.every((r) => !r.detailUrl.includes("pageIndex"))).toBe(true);
    expect(rowsP2.every((r) => !r.detailUrl.includes("pageIndex"))).toBe(true);
  });

  it("일반 행은 등록일을 개시형으로 넘긴다", () => {
    const dated = rows.filter((r) => r.dateText !== "");
    expect(dated.length).toBeGreaterThan(0);
    for (const r of dated) expect(r.dateText).toMatch(/^\d{4}-\d{2}-\d{2} ~$/);
  });

  it("1쪽+2쪽을 합쳐 파싱해도 상세 열쇠 중복이 없고 5건이다", () => {
    const urls = combined.map((r) => r.detailUrl);
    expect(new Set(urls).size).toBe(urls.length);
    expect(combined).toHaveLength(5);
    const concat = [...rows, ...rowsP2];
    expect(new Set(concat.map((r) => r.detailUrl)).size).toBe(concat.length);
  });

  it("2쪽 고정본은 1쪽과 다른 글이다 — pageIndex 가 진짜 먹는다", () => {
    expect(rowsP2).toHaveLength(3);
    expect(rowsP2[0]).toMatchObject({
      title: "2026년 모두의 창업 예비 창업자 모집",
      detailUrl: "https://www.jbcredit.or.kr/site/menu/MENU_000000000000090/board/view/NTT_005438",
      dateText: "2026-04-17 ~",
    });
    expect(rows.map((r) => r.detailUrl)).not.toEqual(rowsP2.map((r) => r.detailUrl));
  });

  it("지원사업 글은 살아남는다", () => {
    expect(rows.some((r) => r.title.includes("자영업자 사회보험료 지원사업"))).toBe(true);
    expect(rowsP2.some((r) => r.title.includes("희망리턴패키지"))).toBe(true);
  });

  it("날짜는 작성일 칸(두 번째 td.m_grey)에서만 집는다 — 행 전체 글자면 번호·조회수와 붙는다", () => {
    const r = rows.find((x) => x.detailUrl.includes("NTT_005641"));
    expect(r?.dateText).toBe("2026-09-02 ~");
    expect(r?.dateText).not.toMatch(/177|5$/);
  });
});

describe("거르개 — 버릴 것만 지정한다", () => {
  it("DROP 거르개가 실측 제목을 실제로 버린다", () => {
    const titles = combined.map((r) => r.title);
    expect(titles.some((t) => t.includes("금고 지정"))).toBe(false);
    expect(titles.some((t) => t.includes("재무감사"))).toBe(false);
    expect(titles.some((t) => t.includes("설문조사"))).toBe(false);
    expect(titles.some((t) => t.includes("실태조사"))).toBe(false);
    expect(titles.some((t) => t.includes("고객만족도"))).toBe(false);
    expect(titles.some((t) => t.includes("경영평가"))).toBe(false);
    expect(titles.some((t) => t.includes("개인정보"))).toBe(false);
    expect(titles.some((t) => t.includes("영업점 이전"))).toBe(false);
    expect(titles.some((t) => t.includes("시스템 개선"))).toBe(false);
    expect(titles.some((t) => t.includes("서비스 중단"))).toBe(false);
    expect(titles.some((t) => t.includes("브로커"))).toBe(false);
    expect(titles.some((t) => t.includes("업무제안"))).toBe(false);
    expect(titles.some((t) => t.includes("컨설턴트 모집"))).toBe(false);
    expect(titles.some((t) => t.includes("면접전형"))).toBe(false);
    expect(isJbsinboDropTitle("전북신용보증재단 금고 지정 공고")).toBe(true);
    expect(isJbsinboDropTitle("전북신용보증재단 재무감사 계획 안내")).toBe(true);
    expect(isJbsinboDropTitle("2026년 보증이용기업 금융실태 및 신용보증 지원 효과 설문조사 안내")).toBe(
      true,
    );
    expect(isJbsinboDropTitle("2026년 지역신보 보증이용기업의 폐업 실태조사 안내")).toBe(true);
    expect(isJbsinboDropTitle("지역신보 보증사업평가 고객만족도 조사 안내")).toBe(true);
    expect(
      isJbsinboDropTitle(
        '"2026년 전북특별자치도 출연기관 등 경영평가 고객만족도 조사" 관련 개인정보 제3자 제공사항 알림',
      ),
    ).toBe(true);
    expect(isJbsinboDropTitle("※고창지점 영업점 이전 안내")).toBe(true);
    expect(
      isJbsinboDropTitle("[안내] 시스템 개선 작업으로 인한 서비스 중단 안내(26.02.28~03.01)"),
    ).toBe(true);
    expect(isJbsinboDropTitle("※불법 보증브로커 주의 당부※")).toBe(true);
    expect(isJbsinboDropTitle("2026년 신용보증재단중앙회 특별 업무제안 공모")).toBe(true);
    expect(isJbsinboDropTitle("2026년 컨설턴트 모집공고")).toBe(true);
    expect(isJbsinboDropTitle("2026년 컨설턴트 모집 제1차 서류전형 결과 및 제2차 면접전형 안내")).toBe(
      true,
    );
    expect(isJbsinboDropTitle("직원 채용 공고")).toBe(true);
  });

  it("「채용」을 통째로 버리지 않는다 — 채용 지원사업은 살아남는다", () => {
    expect(isJbsinboDropTitle("청년 채용 지원사업 참여기업 모집")).toBe(false);
    expect(isJbsinboDropTitle("직원 채용 지원사업")).toBe(false);
    expect(isJbsinboDropTitle("2026년 전북특별자치도 자영업자 사회보험료 지원사업 안내")).toBe(false);
  });
});

describe("붙박이 공지 — 1년 넘은 것은 담지 않는다", () => {
  it("1년 넘게 붙어 있는 고정 공지는 아예 안 담는다 — 날짜를 비우면 90일간 되살아난다", () => {
    // 실측 붙박이 「신용보증 상담예약제」(2024-07-12, NTT_004430). DROP 에는 안 걸린다.
    expect(rows.some((r) => r.detailUrl.includes("NTT_004430"))).toBe(false);
    const young = parseJbsinboList(listHtml, 1, Date.parse("2024-08-01T00:00:00Z"));
    const pinned = young.find((r) => r.detailUrl.includes("NTT_004430"));
    expect(pinned).toBeDefined();
    expect(pinned!.dateText).toBe("");
  });
});

describe("전북신용보증재단 설정", () => {
  it("쪽넘김은 GET pageIndex + MENU_090 — 쪽마다 주소가 달라야 중복이 안 생긴다", () => {
    expect(jbsinboConfig.list.url(1)).toBe(
      "https://www.jbcredit.or.kr/site/menu/MENU_000000000000090/board/list?site_assets=%2Fassets%2Fsite%2FLET&pageIndex=1",
    );
    expect(jbsinboConfig.list.url(2)).toBe(
      "https://www.jbcredit.or.kr/site/menu/MENU_000000000000090/board/list?site_assets=%2Fassets%2Fsite%2FLET&pageIndex=2",
    );
    expect(jbsinboConfig.list.maxPages).toBe(8);
  });

  it("★상세 주소의 pageIndex 는 엔진이 알아서 떼어 낸다 — 안 떼면 같은 글이 쪽마다 다른 주소가 된다", () => {
    expect(pagingParamsOf(jbsinboConfig)).toContain("pageIndex");
  });

  it("지역은 전북 — 전북신용보증재단 공지사항이다", () => {
    expect(jbsinboConfig.region).toBe("전북");
    expect(jbsinboConfig.id).toBe("jbsinbo");
    expect(jbsinboConfig.agency).toBe("전북신용보증재단");
  });

  it("서식 변경 감지가 살아 있다 — 1은 검사를 끈 것과 같다", () => {
    expect(jbsinboConfig.expectMinRows).toBeGreaterThanOrEqual(2);
  });

  it("목록 행에 첨부 파일 링크가 섞여 heuristic 을 끈다", () => {
    expect(jbsinboConfig.skipHeuristic).toBe(true);
    expect(listHtml).toContain("/site/resource/file/FILE_");
  });

  it("상세 본문·첨부 자리가 실측 선택자다", () => {
    expect(jbsinboConfig.detailContentSelector).toBe("#writeContents");
    expect(jbsinboConfig.attachmentsScopeSelector).toBe("td.file");
  });

  it("상세 주소 호스트가 baseUrl 과 같다", () => {
    expect(new URL(rows[0].detailUrl).host).toBe(new URL(jbsinboConfig.baseUrl).host);
  });
});

/** ★판정기를 망가뜨려 본다 — 안 하면 위 시험들이 「그냥 통과하는 글」일 뿐이다. */
describe("망가뜨려 보기", () => {
  it("행 껍데기 이름이 바뀌면 한 줄도 못 읽는다", () => {
    expect(parseJbsinboList(listHtml.replaceAll("bbs_list", "bbs_list-x"), 1, NOW)).toHaveLength(0);
  });

  it("제목 칸(td.title)이 바뀌면 한 줄도 못 읽는다", () => {
    expect(parseJbsinboList(listHtml.replaceAll('class="title"', 'class="title-x"'), 1, NOW)).toHaveLength(
      0,
    );
  });

  it("작성일 칸이 사라지면 날짜를 비운다(오늘 날짜를 지어내지 않는다)", () => {
    const broken = parseJbsinboList(listHtml.replaceAll('class="m_grey"', 'class="m_grey-x"'), 1, NOW);
    expect(broken.length).toBeGreaterThan(0);
    expect(broken.every((r) => r.dateText === "")).toBe(true);
  });
});
