import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseHtml } from "../html";
import { cnsinboConfig, isCnsinboDropTitle, parseCnsinboList } from "./cnsinbo";

/**
 * ★손으로 쓴 HTML 대신 **실사이트 고정본**으로 잰다.
 * 창원 사고: 지어낸 HTML 로 시험하면 선택자 오타가 그대로 통과한다.
 * 고정본: 2026-09-03 실측 정보광장 공지사항 `boardID=134` 1·2쪽 원문.
 */
const listHtml = readFileSync(join(__dirname, "../__fixtures__/cnsinbo-list.html"), "utf-8");
const listP2Html = readFileSync(join(__dirname, "../__fixtures__/cnsinbo-list-p2.html"), "utf-8");
const NOW = Date.parse("2026-09-03T00:00:00Z");
const rows = parseCnsinboList(listHtml, 1, NOW);
const rowsP2 = parseCnsinboList(listP2Html, 2, NOW);
const combined = parseCnsinboList(listHtml + listP2Html, 1, NOW);

const FIRST = {
  title: "[모집중] 9월 동네창업학교 교육생 모집 공고",
  detailUrl:
    "https://www.cnsinbo.co.kr/boardCnts/view.do?m=030101&action=view&boardID=134&boardSeq=33897&viewBoardID=134&lev=0&s=cnsinbo",
  dateText: "2026-08-14 ~",
} as const;

describe("충남신용보증재단 공지사항 목록 읽기 — 실사이트 고정본", () => {
  it("1쪽 고정본에서 DROP·붙박이(1년+)·중복을 뺀 7건을 읽고 첫 행이 맞다", () => {
    expect(rows).toHaveLength(7);
    expect(rows[0]).toMatchObject(FIRST);
  });

  it("★상세 주소에 쪽 번호를 넣지 않는다 — 넣으면 같은 글이 쪽마다 다른 줄로 저장된다", () => {
    expect(rows.every((r) => !/[?&]page=/.test(r.detailUrl))).toBe(true);
    expect(rowsP2.every((r) => !/[?&]page=/.test(r.detailUrl))).toBe(true);
    expect(combined.every((r) => !/[?&]page=/.test(r.detailUrl))).toBe(true);
  });

  it("table.mb(모바일 사본)는 읽지 않는다 — 제목이 잘리거나 같은 글이 두 줄이 된다", () => {
    expect(rows.every((r) => !r.title.includes("…") && !r.title.endsWith("..."))).toBe(true);
    expect(rows.every((r) => r.title !== "뷰화면이동")).toBe(true);
    const urls = rows.map((r) => r.detailUrl);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it("댓글 수 [n] 을 제목에 남기지 않는다", () => {
    expect(rows.every((r) => !/\[\d+\]/.test(r.title))).toBe(true);
    const gongju = rows.find((r) => r.detailUrl.includes("boardSeq=33819"));
    expect(gongju?.title).toBe("[모집중] 2026년도 공주시 상권 활성화 패키지 공고");
  });

  it("일반 행은 등록일을 개시형으로 넘긴다 — 마감일을 지어내지 않는다", () => {
    const normal = rows.filter((r) => r.dateText !== "");
    expect(normal.length).toBeGreaterThan(0);
    for (const r of normal) expect(r.dateText).toMatch(/^\d{4}-\d{2}-\d{2} ~$/);
  });

  it("날짜는 5번째 td(작성일) 칸에서만 집는다 — 행 전체 글자면 조회수와 붙는다", () => {
    expect(rows[0].dateText).toBe("2026-08-14 ~");
    expect(rows[0].dateText).not.toMatch(/305|6175/);
  });

  it("1쪽+2쪽을 합쳐 파싱해도 상세 열쇠 중복이 없고 14건이다", () => {
    const urls = combined.map((r) => r.detailUrl);
    expect(new Set(urls).size).toBe(urls.length);
    expect(combined).toHaveLength(14);
    expect(rows.map((r) => r.detailUrl)).not.toEqual(rowsP2.map((r) => r.detailUrl));
    expect(rowsP2).toHaveLength(7);
    expect(rowsP2[0]).toMatchObject({
      title: "[모집마감] 7월 동네창업학교 교육생 모집 공고",
      detailUrl:
        "https://www.cnsinbo.co.kr/boardCnts/view.do?m=030101&action=view&boardID=134&boardSeq=33801&viewBoardID=134&lev=0&s=cnsinbo",
      dateText: "2026-06-10 ~",
    });
  });
});

describe("거르개 — 버릴 것만 지정한다", () => {
  it("DROP 거르개가 실측 제목을 실제로 버린다", () => {
    const titles = combined.map((r) => r.title);
    expect(titles.some((t) => t.includes("이전 안내"))).toBe(false);
    expect(titles.some((t) => t.includes("출장사무소"))).toBe(false);
    expect(titles.some((t) => t.includes("확대운영"))).toBe(false);
    expect(titles.some((t) => t.includes("최종합격자"))).toBe(false);
    expect(titles.some((t) => t.includes("결과 안내"))).toBe(false);
    expect(titles.some((t) => t.includes("연구용역"))).toBe(false);
    expect(titles.some((t) => t.includes("개인정보"))).toBe(false);
    expect(isCnsinboDropTitle("충남신용보증재단 아산지점 이전 안내")).toBe(true);
    expect(isCnsinboDropTitle("출장사무소 확대운영 안내")).toBe(true);
    expect(isCnsinboDropTitle("26년 충남 로컬창업 네트워크 서류평가(최종합격자) 결과 안내")).toBe(true);
    expect(isCnsinboDropTitle("26년 충남 로컬창업 청년멘토 현장평가(최종합격자) 결과 안내")).toBe(true);
    expect(
      isCnsinboDropTitle(
        "2026년(2025년 실적) 충청남도 공공기관(장) 경영평가 연구용역 관련 개인정보 제3자 제공사항 알림",
      ),
    ).toBe(true);
  });

  it("지원사업·모집 공고는 살린다", () => {
    const titles = combined.map((r) => r.title);
    expect(titles.some((t) => t.includes("동네창업학교"))).toBe(true);
    expect(titles.some((t) => t.includes("공주시 상권 활성화"))).toBe(true);
    expect(titles.some((t) => t.includes("소상공인 교육생"))).toBe(true);
    expect(titles.some((t) => t.includes("재도전 사례 공모전"))).toBe(true);
    expect(titles.some((t) => t.includes("희망리턴패키지"))).toBe(true);
    expect(isCnsinboDropTitle("[모집중] 9월 동네창업학교 교육생 모집 공고")).toBe(false);
    expect(isCnsinboDropTitle("[모집중] 2026년도 공주시 상권 활성화 패키지 공고")).toBe(false);
    expect(isCnsinboDropTitle("충청남도 금융복지 지원사업 안내")).toBe(false);
  });

  it("「채용」을 통째로 버리지 않는다 — 채용 지원사업이 죽는다", () => {
    expect(isCnsinboDropTitle("청년 채용 지원금 참여기업 모집")).toBe(false);
    expect(isCnsinboDropTitle("중소기업 신규직원 채용 지원사업 참여기업 모집")).toBe(false);
    expect(isCnsinboDropTitle("직원 채용 공고")).toBe(true);
  });
});

describe("붙박이 공지 — 1년 넘은 것은 담지 않는다", () => {
  it("2026-09-03 기준 1년 넘은 필독(금융복지 2025-03-25)은 빠진다", () => {
    expect(rows.some((r) => r.detailUrl.includes("boardSeq=33158"))).toBe(false);
    expect(rows.some((r) => r.detailUrl.includes("boardSeq=32424"))).toBe(false);
  });

  it("기준 시각을 2025-09-01 로 옮기면 금융복지 필독은 담기되 등록일을 개시일로 넘기지 않는다", () => {
    const recent = parseCnsinboList(listHtml, 1, Date.parse("2025-09-01T00:00:00Z"));
    const welfare = recent.find((r) => r.detailUrl.includes("boardSeq=33158"));
    expect(welfare).toMatchObject({
      title: "충청남도 금융복지 지원사업 안내",
      dateText: "",
    });
  });

  it("기준 시각을 2030년으로 옮기면 2026-06-24 HOT 는 남고 필독만 빠진다", () => {
    const old = parseCnsinboList(listHtml, 1, Date.parse("2030-01-01T00:00:00Z"));
    expect(old.some((r) => r.detailUrl.includes("boardSeq=33158"))).toBe(false);
    expect(old.some((r) => r.detailUrl.includes("boardSeq=33819"))).toBe(true);
    expect(old.find((r) => r.detailUrl.includes("boardSeq=33819"))?.dateText).toBe("2026-06-24 ~");
  });
});

describe("충남신용보증재단 설정", () => {
  it("쪽넘김은 GET page + boardID=134", () => {
    expect(cnsinboConfig.list.url(1)).toBe(
      "https://www.cnsinbo.co.kr/boardCnts/list.do?boardID=134&m=030101&s=cnsinbo&type=default&page=1",
    );
    expect(cnsinboConfig.list.url(2)).toBe(
      "https://www.cnsinbo.co.kr/boardCnts/list.do?boardID=134&m=030101&s=cnsinbo&type=default&page=2",
    );
    expect(cnsinboConfig.list.maxPages).toBe(10);
  });

  it("지역은 충남", () => {
    expect(cnsinboConfig.region).toBe("충남");
    expect(cnsinboConfig.id).toBe("cnsinbo");
    expect(cnsinboConfig.agency).toBe("충남신용보증재단");
  });

  it("서식 변경 감지가 살아 있다 — 한 쪽 10건의 절반", () => {
    expect(cnsinboConfig.expectMinRows).toBe(5);
  });

  it("행 선택자가 1쪽 고정본에서 table.wb 의 10줄만 잡는다 — table.mb 는 제외", () => {
    expect(parseHtml(listHtml).querySelectorAll(cnsinboConfig.list.rowSelector)).toHaveLength(10);
    expect(parseHtml(listHtml).querySelectorAll("table.mb tbody tr")).toHaveLength(10);
  });

  it("본문 선택자는 비운다 — 실측 상세(boardSeq=33897)는 이미지뿐이라 채우면 첨부 PDF 길을 막는다", () => {
    expect(cnsinboConfig.detailContentSelector).toBeUndefined();
    expect(cnsinboConfig.attachmentsScopeSelector).toBe("div.fieldBox");
  });
});

/** ★판정기를 망가뜨려 본다 — 안 하면 위 시험들이 「그냥 통과하는 글」일 뿐이다. */
describe("망가뜨려 보기", () => {
  it("행 선택자 table.wb 를 바꾸면 한 줄도 못 읽는다", () => {
    expect(parseCnsinboList(listHtml.replaceAll("class='wb'", "class='wb_x'"), 1, NOW)).toHaveLength(0);
  });

  it("제목 칸 td.link 가 바뀌면 한 줄도 못 읽는다", () => {
    expect(parseCnsinboList(listHtml.replaceAll("class='link'", "class='link_x'"), 1, NOW)).toHaveLength(0);
  });

  it("작성일 칸을 비우면 날짜를 비운다(오늘 날짜를 지어내지 않는다)", () => {
    const broken = parseCnsinboList(listHtml.replaceAll("2026-08-14", ""), 1, NOW);
    const r = broken.find((x) => x.detailUrl.includes("boardSeq=33897"));
    expect(r?.dateText).toBe("");
  });
});
