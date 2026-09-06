import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseHtml } from "../html";
import { gbsinboConfig, isGbsinboDropTitle, parseGbsinboList } from "./gbsinbo";

/**
 * ★손으로 쓴 HTML 대신 **실사이트 고정본**으로 잰다.
 * 창원 사고: 지어낸 HTML 로 시험하면 선택자 오타가 그대로 통과한다.
 * 고정본: 2026-09-03 실측 공지사항 1·2쪽 (`/page/10052/10005.tc` · `pageIndex=1|2`).
 */
const listHtml = readFileSync(join(__dirname, "../__fixtures__/gbsinbo-list.html"), "utf-8");
const listP2Html = readFileSync(join(__dirname, "../__fixtures__/gbsinbo-list-p2.html"), "utf-8");
const NOW = Date.parse("2026-09-03T00:00:00Z");
const rows = parseGbsinboList(listHtml, 1, NOW);
const rowsP2 = parseGbsinboList(listP2Html, 2, NOW);
const combined = parseGbsinboList(listHtml + listP2Html, 1, NOW);

const FIRST = {
  title: "태풍피해(힌남노) 재해소상공인 경북 버팀금융 특례보증 안내",
  detailUrl:
    "https://gbsinbo.co.kr/page/10052/10005.tc?pageDtlOrdrNo=1&boardNo=135&boardMngNo=2&importUrl=%2Fboard%2Fview.tc",
  dateText: "2022-09-28 ~",
  agency: "경북신용보증재단",
} as const;

describe("경북신용보증재단 공지사항 목록 읽기 — 실사이트 고정본", () => {
  it("1쪽 고정본에서 DROP·중복·오래된 붙박이를 뺀 4건을 읽고 첫 행이 맞다", () => {
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows.length).toBeLessThanOrEqual(15);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatchObject(FIRST);
    expect(rows[0].title).not.toMatch(/NEW|새글/i);
  });

  it("★상세 주소에 pageIndex 를 넣지 않는다 — 넣으면 같은 글이 쪽마다 다른 줄로 저장된다", () => {
    expect(rows.every((r) => !/[?&]pageIndex=/.test(r.detailUrl))).toBe(true);
    expect(rowsP2.every((r) => !/[?&]pageIndex=/.test(r.detailUrl))).toBe(true);
    expect(combined.every((r) => !/[?&]pageIndex=/.test(r.detailUrl))).toBe(true);
  });

  it("같은 글번호(붙박이+본문 두 줄)는 한 번만 담는다", () => {
    const urls = rows.map((r) => r.detailUrl);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it("일반 행은 등록일을 개시형으로 넘긴다 — 위 규칙이 전부를 비우면 안 된다", () => {
    const normal = rows.filter((r) => r.dateText !== "");
    expect(normal.length).toBeGreaterThan(0);
    for (const r of normal) expect(r.dateText).toMatch(/^\d{4}-\d{2}-\d{2} ~$/);
  });

  it("1쪽+2쪽을 합쳐 파싱해도 상세 열쇠 중복이 없고 11건이다", () => {
    const urls = combined.map((r) => r.detailUrl);
    expect(new Set(urls).size).toBe(urls.length);
    expect(combined).toHaveLength(11);
    const concat = [...rows, ...rowsP2];
    expect(new Set(concat.map((r) => r.detailUrl)).size).toBe(concat.length);
  });

  it("2쪽 고정본은 1쪽과 다른 글이다 — pageIndex 가 진짜 먹는다", () => {
    expect(rowsP2).toHaveLength(7);
    expect(rowsP2[0]).toMatchObject({
      title: "「2022년 경북농식품산업대전」 안내",
      detailUrl:
        "https://gbsinbo.co.kr/page/10052/10005.tc?pageDtlOrdrNo=1&boardNo=129&boardMngNo=2&importUrl=%2Fboard%2Fview.tc",
      dateText: "2022-08-25 ~",
    });
    expect(rows.map((r) => r.detailUrl)).not.toEqual(rowsP2.map((r) => r.detailUrl));
  });

  it("날짜는 5번째 td 칸에서만 집는다 — 행 전체 글자면 조회수와 붙는다", () => {
    const r = rows.find((x) => x.detailUrl.includes("boardNo=135"));
    expect(r?.dateText).toBe("2022-09-28 ~");
    expect(r?.dateText).not.toMatch(/3934|173|248/);
  });
});

describe("거르개 — 버릴 것만 지정한다", () => {
  it("DROP 거르개가 실측 제목을 실제로 버린다", () => {
    const titles = combined.map((r) => r.title);
    expect(titles.some((t) => t.includes("설문조사"))).toBe(false);
    expect(titles.some((t) => t.includes("개인정보"))).toBe(false);
    expect(titles.some((t) => t.includes("청렴도"))).toBe(false);
    expect(titles.some((t) => t.includes("지점 개점"))).toBe(false);
    expect(titles.some((t) => t.includes("지점 이전"))).toBe(false);
    expect(titles.some((t) => t.includes("보이스피싱"))).toBe(false);
    expect(titles.some((t) => t.includes("브로커"))).toBe(false);
    expect(titles.some((t) => t.includes("생활체육"))).toBe(false);
    expect(titles.some((t) => t.includes("공모전"))).toBe(false);
    expect(titles.some((t) => t.includes("추모비"))).toBe(false);
    expect(titles.some((t) => t.includes("아동학대"))).toBe(false);
    expect(titles.some((t) => t.includes("컨설턴트 모집"))).toBe(false);
    expect(
      isGbsinboDropTitle("2026년 보증이용기업 금융실태 및 신용보증 지원 효과 설문조사 안내"),
    ).toBe(true);
    expect(
      isGbsinboDropTitle(
        "2026년 경상북도 출자출연·보조기관 등 종합청렴도 평가 관련 개인정보 제3자 제공사항 알림",
      ),
    ).toBe(true);
    expect(isGbsinboDropTitle("경북신용보증재단 칠곡지점 개점 안내")).toBe(true);
    expect(isGbsinboDropTitle("경북신용보증재단 구미지점 이전 안내")).toBe(true);
    expect(isGbsinboDropTitle("재단 사칭 보이스피싱 주의!!")).toBe(true);
    expect(isGbsinboDropTitle("[공지] 보증 브로커 주의 안내")).toBe(true);
    expect(isGbsinboDropTitle("제32회 경북도민 생활체육 대축전 안내")).toBe(true);
    expect(isGbsinboDropTitle("2022년 경상북도 인권작품 공모전 개최 안내")).toBe(true);
    expect(isGbsinboDropTitle("경상북도 순직공무원 추모비 디자인 공모전 안내")).toBe(true);
    expect(isGbsinboDropTitle("2022년 2차 아동학대 예방 징계권 폐지 안내")).toBe(true);
    expect(isGbsinboDropTitle("신용보증재단중앙회 재기 컨설턴트 모집공고")).toBe(true);
    expect(isGbsinboDropTitle("2022년도 보증지원 수기공모 안내")).toBe(true);
    expect(isGbsinboDropTitle("신용보증재단중앙회 특별 업무제안 공모 안내")).toBe(true);
  });

  it("지원사업·공고는 살린다", () => {
    const titles = combined.map((r) => r.title);
    expect(titles.some((t) => t.includes("특례보증"))).toBe(true);
    expect(titles.some((t) => t.includes("라이브커머스"))).toBe(true);
    expect(titles.some((t) => t.includes("창업사관학교"))).toBe(true);
    expect(titles.some((t) => t.includes("마이데이터"))).toBe(true);
    expect(isGbsinboDropTitle("태풍피해(힌남노) 재해소상공인 경북 버팀금융 특례보증 안내")).toBe(false);
    expect(isGbsinboDropTitle("지역신보 이용고객을 위한 라이브커머스 참여자 모집")).toBe(false);
    expect(isGbsinboDropTitle("2022년 대구 신사업창업사관학교 15기 교육생 모집안내")).toBe(false);
    expect(isGbsinboDropTitle("2022년도 마이데이터 생태계 활성화를 위한 종합기반 조성사업 공모")).toBe(
      false,
    );
  });

  it("「채용」을 통째로 버리지 않는다 — 채용 지원사업이 죽는다", () => {
    expect(isGbsinboDropTitle("청년 채용 지원사업 참여기업 모집")).toBe(false);
    expect(isGbsinboDropTitle("직원 채용 지원사업")).toBe(false);
    expect(isGbsinboDropTitle("직원 채용 공고")).toBe(true);
  });
});

describe("붙박이 공지 — 1년 넘은 것은 담지 않는다", () => {
  it("2016년 청탁금지법 붙박이는 2026 기준에서 빠지고, 게시 직후 기준에서는 담는다", () => {
    expect(rows.some((r) => r.detailUrl.includes("boardNo=80"))).toBe(false);
    const fresh = parseGbsinboList(listHtml, 1, Date.parse("2016-10-05T00:00:00Z"));
    const pinned = fresh.find((r) => r.detailUrl.includes("boardNo=80"));
    expect(pinned).toMatchObject({
      title: "청탁금지법 시행에 따른 적용대상자(공무수행사인) 안내",
      dateText: "",
    });
  });

  it("기준 시각을 2030년으로 옮기면 붙박이만 빠지고 일반 행 날짜는 남는다", () => {
    const old = parseGbsinboList(listHtml, 1, Date.parse("2030-01-01T00:00:00Z"));
    expect(old.some((r) => r.detailUrl.includes("boardNo=80"))).toBe(false);
    expect(old.every((r) => r.dateText !== "")).toBe(true);
  });
});

describe("경북신용보증재단 설정", () => {
  it("쪽넘김은 GET pageIndex — POST 본문이 아니다", () => {
    expect(gbsinboConfig.list.url(1)).toBe("https://gbsinbo.co.kr/page/10052/10005.tc?pageIndex=1");
    expect(gbsinboConfig.list.url(2)).toBe("https://gbsinbo.co.kr/page/10052/10005.tc?pageIndex=2");
    expect(gbsinboConfig.list.maxPages).toBe(6);
    expect(gbsinboConfig.list.init).toBeUndefined();
  });

  it("지역은 경북", () => {
    expect(gbsinboConfig.region).toBe("경북");
    expect(gbsinboConfig.id).toBe("gbsinbo");
    expect(gbsinboConfig.agency).toBe("경북신용보증재단");
    expect(gbsinboConfig.label).toBe("경북신용보증재단");
  });

  it("서식 변경 감지가 살아 있다 — 1은 검사를 끈 것과 같다", () => {
    expect(gbsinboConfig.expectMinRows).toBeGreaterThanOrEqual(2);
  });

  it("행 선택자가 1쪽 고정본에서 실제 21줄을 잡는다", () => {
    expect(parseHtml(listHtml).querySelectorAll(gbsinboConfig.list.rowSelector)).toHaveLength(21);
  });

  it("본문 선택자가 상세에서 쓸 칸이다 — 첨부는 GET 응답이 비어 JS 가 채운다", () => {
    expect(gbsinboConfig.detailContentSelector).toBe("div.board_view > div.text");
    expect(gbsinboConfig.attachmentsScopeSelector).toBeUndefined();
  });
});

/** ★판정기를 망가뜨려 본다 — 안 하면 위 시험들이 「그냥 통과하는 글」일 뿐이다. */
describe("망가뜨려 보기", () => {
  it("행 껍데기 이름이 바뀌면 한 줄도 못 읽는다", () => {
    expect(parseGbsinboList(listHtml.replaceAll("com_table", "com_table_x"), 1, NOW)).toHaveLength(0);
  });

  it("제목 칸(a.board_title)이 바뀌면 한 줄도 못 읽는다", () => {
    expect(
      parseGbsinboList(listHtml.replaceAll('class="board_title"', 'class="board_title_x"'), 1, NOW),
    ).toHaveLength(0);
  });

  it("작성일 칸을 비우면 날짜를 비운다(오늘 날짜를 지어내지 않는다)", () => {
    const broken = parseGbsinboList(listHtml.replaceAll("2022-09-28", ""), 1, NOW);
    const r = broken.find((x) => x.detailUrl.includes("boardNo=135"));
    expect(r?.dateText).toBe("");
  });
});
