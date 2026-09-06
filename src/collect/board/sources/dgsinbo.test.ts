import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseHtml } from "../html";
import { dgsinboConfig, isDgsinboDropTitle, parseDgsinboList } from "./dgsinbo";

/**
 * ★손으로 쓴 HTML 대신 **실사이트 고정본**으로 잰다.
 * 창원 사고: 지어낸 HTML 로 시험하면 선택자 오타가 그대로 통과한다.
 * 1쪽: 2026-09-03 실측 `boardMngNo=2` 목록(조사 고정본).
 * 2쪽: 조사 경로의 p2 는 천안과학산업진흥원 페이지가 섞여 있어, 같은 날 실사이트
 *     `?pageIndex=2&boardMngNo=2` GET 원문을 그대로 쓴다.
 */
const listHtml = readFileSync(join(__dirname, "../__fixtures__/dgsinbo-list.html"), "utf-8");
const listP2Html = readFileSync(join(__dirname, "../__fixtures__/dgsinbo-list-p2.html"), "utf-8");
const NOW = Date.parse("2026-09-03T00:00:00Z");
const rows = parseDgsinboList(listHtml, 1, NOW);
const combined = parseDgsinboList(listHtml + listP2Html, 1, NOW);

const FIRST = {
  title: "2026년도 대구광역시 중소기업경영안정자금 지원계획 변경 공고(이자지원)(26.03.16.)",
  detailUrl:
    "https://www.dgsinbo.or.kr/page/10065/10006.tc?pageDtlOrdrNo=1&boardNo=84431&boardMngNo=2&importUrl=%2Fboard%2Fview.tc",
  dateText: "",
  agency: "대구신용보증재단",
} as const;

describe("대구신용보증재단 목록 읽기 — 실사이트 고정본", () => {
  it("1쪽 고정본에서 DROP·중복을 뺀 2건을 읽고 첫 행이 맞다", () => {
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject(FIRST);
  });

  it("★붙박이(공지) 행은 등록일을 개시일로 넘기지 않는다 — 넘기면 90일 규칙에 걸려 저장 즉시 마감된다", () => {
    expect(rows[0].dateText).toBe("");
    const normal = rows.find((r) => r.detailUrl.includes("boardNo=84464"));
    expect(normal).toMatchObject({
      title: "「2026년 유통플랫폼 MD 상담회」 소상공인 모집 공고",
      detailUrl:
        "https://www.dgsinbo.or.kr/page/10065/10006.tc?pageDtlOrdrNo=1&boardNo=84464&boardMngNo=2&importUrl=%2Fboard%2Fview.tc",
      dateText: "2026-07-14 ~",
    });
  });

  it("★상세 주소에 pageIndex 를 넣지 않는다 — 넣으면 같은 글이 쪽마다 다른 줄로 저장된다", () => {
    expect(rows.every((r) => !/[?&]pageIndex=/.test(r.detailUrl))).toBe(true);
    expect(combined.every((r) => !/[?&]pageIndex=/.test(r.detailUrl))).toBe(true);
  });

  it("같은 글번호(붙박이+본문 두 줄)는 한 번만 담는다", () => {
    const urls = rows.map((r) => r.detailUrl);
    expect(new Set(urls).size).toBe(urls.length);
    expect(urls.filter((u) => u.includes("boardNo=84431"))).toHaveLength(1);
  });

  it("일반 행은 등록일을 개시형으로 넘긴다 — 위 규칙이 전부를 비우면 안 된다", () => {
    const normal = rows.filter((r) => r.dateText !== "");
    expect(normal.length).toBeGreaterThan(0);
    for (const r of normal) expect(r.dateText).toMatch(/^\d{4}-\d{2}-\d{2} ~$/);
  });

  it("1쪽+2쪽을 합쳐 파싱해도 상세 열쇠 중복이 없고 7건이다", () => {
    const urls = combined.map((r) => r.detailUrl);
    expect(new Set(urls).size).toBe(urls.length);
    expect(combined).toHaveLength(7);
  });

  it("2쪽 고정본은 1쪽과 다른 글이다 — pageIndex 가 진짜 먹는다", () => {
    const p2 = parseDgsinboList(listP2Html, 2, NOW);
    expect(p2.some((r) => r.detailUrl.includes("boardNo=84304"))).toBe(true);
    expect(p2.some((r) => r.title.includes("1인 자영업자 고용보험"))).toBe(true);
    expect(rows.map((r) => r.detailUrl)).not.toEqual(p2.map((r) => r.detailUrl));
  });

  it("날짜는 4번째 td 칸에서만 집는다 — 행 전체 글자면 조회수와 붙는다", () => {
    const r = rows.find((x) => x.detailUrl.includes("boardNo=84464"));
    expect(r?.dateText).toBe("2026-07-14 ~");
    expect(r?.dateText).not.toMatch(/252|2744/);
  });
});

describe("거르개 — 버릴 것만 지정한다", () => {
  it("DROP 거르개가 실측 제목을 실제로 버린다", () => {
    const titles = combined.map((r) => r.title);
    expect(titles.some((t) => t.includes("새출발기금"))).toBe(false);
    expect(titles.some((t) => t.includes("새도약기금"))).toBe(false);
    expect(titles.some((t) => t.includes("서포터즈"))).toBe(false);
    expect(titles.some((t) => t.includes("용역"))).toBe(false);
    expect(titles.some((t) => t.includes("만족도 조사"))).toBe(false);
    expect(titles.some((t) => t.includes("실태조사"))).toBe(false);
    expect(titles.some((t) => t.includes("설문조사"))).toBe(false);
    expect(titles.some((t) => t.includes("업무제안 공모"))).toBe(false);
    expect(titles.some((t) => t.includes("신년사"))).toBe(false);
    expect(isDgsinboDropTitle("2026년 08월 새출발기금 매각(채권양도)에 따른 개인(신용)정보 제공 사실 안내")).toBe(
      true,
    );
    expect(isDgsinboDropTitle("새도약기금 매각(채권양도)에 따른 개인(신용)정보 제공 사실 안내")).toBe(true);
    expect(isDgsinboDropTitle("2026년 제4기 대구신용보증재단 대학생 홍보 서포터즈 「재단지기」 모집")).toBe(true);
    expect(isDgsinboDropTitle("(게시내용 변경)대구신용보증재단 30주년 기념 및 홍보 영상 제작 용역")).toBe(true);
    expect(isDgsinboDropTitle("2025년 지역신보 보증사업평가 고객만족도 조사 실시 안내")).toBe(true);
    expect(isDgsinboDropTitle("2026년 지역신보 보증이용기업의 폐업 실태조사 안내")).toBe(true);
    expect(isDgsinboDropTitle("2025년 4분기 보증기업 경기실사지수(GBSI) 설문조사 안내")).toBe(true);
    expect(isDgsinboDropTitle("[신용보증재단중앙회] 2026년 특별 업무제안 공모 안내(일반국민/임직원)")).toBe(true);
    expect(isDgsinboDropTitle("2026년 신년사")).toBe(true);
  });

  it("지원사업·공고는 살린다", () => {
    const titles = combined.map((r) => r.title);
    expect(titles.some((t) => t.includes("유통플랫폼 MD 상담회"))).toBe(true);
    expect(titles.some((t) => t.includes("1인 자영업자 고용보험"))).toBe(true);
    expect(titles.some((t) => t.includes("달성군 중소기업 경영안정자금"))).toBe(true);
    expect(titles.some((t) => t.includes("한국가스공사"))).toBe(true);
    expect(isDgsinboDropTitle("「2026년 유통플랫폼 MD 상담회」 소상공인 모집 공고")).toBe(false);
    expect(isDgsinboDropTitle("「2026년 1인 자영업자 고용보험 지원사업 」공고")).toBe(false);
    expect(isDgsinboDropTitle("한국가스공사 대구지역 소상공인 맞춤형 지원사업 공고")).toBe(false);
  });

  it("「채용」을 통째로 버리지 않는다 — 채용 지원사업이 죽는다", () => {
    expect(isDgsinboDropTitle("청년 채용 지원금 참여기업 모집")).toBe(false);
    expect(isDgsinboDropTitle("직원 채용 공고")).toBe(true);
  });
});

describe("붙박이 공지 — 1년 넘은 것은 담지 않는다", () => {
  it("기준 시각을 2030년으로 옮기면 2026-06-01 붙박이가 빠진다", () => {
    const old = parseDgsinboList(listHtml, 1, Date.parse("2030-01-01T00:00:00Z"));
    expect(old.some((r) => r.detailUrl.includes("boardNo=84431"))).toBe(false);
    expect(old.every((r) => r.dateText !== "")).toBe(true);
  });
});

describe("대구신용보증재단 설정", () => {
  it("쪽넘김은 GET pageIndex + boardMngNo=2", () => {
    expect(dgsinboConfig.list.url(1)).toBe(
      "https://www.dgsinbo.or.kr/page/10065/10006.tc?pageIndex=1&boardMngNo=2",
    );
    expect(dgsinboConfig.list.url(2)).toBe(
      "https://www.dgsinbo.or.kr/page/10065/10006.tc?pageIndex=2&boardMngNo=2",
    );
    expect(dgsinboConfig.list.maxPages).toBe(10);
  });

  it("지역은 대구", () => {
    expect(dgsinboConfig.region).toBe("대구");
    expect(dgsinboConfig.id).toBe("dgsinbo");
    expect(dgsinboConfig.agency).toBe("대구신용보증재단");
  });

  it("서식 변경 감지가 살아 있다 — 1은 검사를 끈 것과 같다", () => {
    expect(dgsinboConfig.expectMinRows).toBeGreaterThanOrEqual(2);
  });

  it("행 선택자가 1쪽 고정본에서 실제 16줄을 잡는다", () => {
    expect(parseHtml(listHtml).querySelectorAll(dgsinboConfig.list.rowSelector)).toHaveLength(16);
  });

  it("본문 선택자가 상세에서 쓸 칸이다 — 첨부는 GET 응답이 비어 JS 가 채운다", () => {
    expect(dgsinboConfig.detailContentSelector).toBe("div.board_view > div.text");
    expect(dgsinboConfig.attachmentsScopeSelector).toBeUndefined();
  });
});

/** ★판정기를 망가뜨려 본다 — 안 하면 위 시험들이 「그냥 통과하는 글」일 뿐이다. */
describe("망가뜨려 보기", () => {
  it("행 껍데기 이름이 바뀌면 한 줄도 못 읽는다", () => {
    expect(parseDgsinboList(listHtml.replaceAll("com_table", "com_table_x"), 1, NOW)).toHaveLength(0);
  });

  it("제목 칸(a.board_title)이 바뀌면 한 줄도 못 읽는다", () => {
    expect(parseDgsinboList(listHtml.replaceAll('class="board_title"', 'class="board_title_x"'), 1, NOW)).toHaveLength(
      0,
    );
  });

  it("작성일 칸을 비우면 날짜를 비운다(오늘 날짜를 지어내지 않는다)", () => {
    const broken = parseDgsinboList(listHtml.replaceAll("2026-07-14", ""), 1, NOW);
    const r = broken.find((x) => x.detailUrl.includes("boardNo=84464"));
    expect(r?.dateText).toBe("");
  });
});
