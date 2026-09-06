import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { pagingParamsOf } from "../engine";
import { parseHtml } from "../html";
import { gnsinboConfig, isGnsinboDropTitle, parseGnsinboList } from "./gnsinbo";

/**
 * ★손으로 쓴 HTML 대신 **실사이트 고정본**으로 잰다.
 * 창원 사고: 지어낸 HTML 로 시험하면 선택자 오타가 그대로 통과한다.
 * 고정본: 2026-09-03 실측 공지사항(공고/기업) 1·2쪽 (`bo_table=04_01` · `page=1|2`).
 */
const listHtml = readFileSync(join(__dirname, "../__fixtures__/gnsinbo-list.html"), "utf-8");
const listP2Html = readFileSync(join(__dirname, "../__fixtures__/gnsinbo-list-p2.html"), "utf-8");
const NOW = Date.parse("2026-09-03T00:00:00Z");
const rows = parseGnsinboList(listHtml, 1, NOW);
const rowsP2 = parseGnsinboList(listP2Html, 2, NOW);
const combined = parseGnsinboList(listHtml + listP2Html, 1, NOW);

const FIRST = {
  title: "공고/기업 2026-5호 2026년 함께가게 멘토링 지원사업 공고",
  detailUrl: "https://dream.gnsinbo.or.kr/bbs/board.php?bo_table=04_01&wr_id=142",
  dateText: "",
  agency: "경남신용보증재단",
} as const;

describe("경남신용보증재단 소상공인지원 목록 읽기 — 실사이트 고정본", () => {
  it("1쪽 고정본에서 DROP·중복을 뺀 14건을 읽고 첫 행이 맞다", () => {
    expect(rows.length).toBeGreaterThanOrEqual(7);
    expect(rows.length).toBeLessThanOrEqual(15);
    expect(rows).toHaveLength(14);
    expect(rows[0]).toMatchObject(FIRST);
    expect(rows[0].title).not.toMatch(/NEW|새글/i);
  });

  it("★상세 주소에 쪽 번호를 넣지 않는다 — 넣으면 같은 글이 쪽마다 다른 줄이 된다", () => {
    expect(rows.every((r) => !/[?&]page=/.test(r.detailUrl))).toBe(true);
    expect(rowsP2.every((r) => !/[?&]page=/.test(r.detailUrl))).toBe(true);
    expect(combined.every((r) => !/[?&]page=/.test(r.detailUrl))).toBe(true);
  });

  it("★붙박이(bo_notice) 행은 등록일을 개시일로 넘기지 않는다 — 넘기면 90일 규칙에 걸려 저장 즉시 마감된다", () => {
    expect(rows[0].dateText).toBe("");
    const normal = rows.find((r) => r.detailUrl.includes("wr_id=170"));
    expect(normal).toMatchObject({
      title: "(공고/ 기업2026 -28호)2026년 경상남도 소상공인 생애주기별 맞춤지원사업 추가공고",
      detailUrl: "https://dream.gnsinbo.or.kr/bbs/board.php?bo_table=04_01&wr_id=170",
      dateText: "2026-09-02 ~",
    });
  });

  it("일반 행은 등록일을 개시형으로 넘긴다 — 위 규칙이 전부를 비우면 안 된다", () => {
    const normal = rows.filter((r) => r.dateText !== "");
    expect(normal.length).toBeGreaterThan(0);
    for (const r of normal) expect(r.dateText).toMatch(/^\d{4}-\d{2}-\d{2} ~$/);
  });

  it("1쪽+2쪽을 합쳐 파싱해도 상세 열쇠 중복이 없고 24건이다", () => {
    const urls = combined.map((r) => r.detailUrl);
    expect(new Set(urls).size).toBe(urls.length);
    expect(combined).toHaveLength(24);
    const concat = [...rows, ...rowsP2];
    expect(new Set(concat.map((r) => r.detailUrl)).size).toBe(concat.length);
  });

  it("2쪽 고정본은 1쪽과 다른 글이다 — page 가 진짜 먹는다", () => {
    expect(rowsP2).toHaveLength(10);
    expect(rowsP2[0]).toMatchObject({
      title: "(공고/기업 제2026-15호) 2026년 밀양시 「소상공인 맟춤 컨설팅 지원 사업」시행 공고",
      detailUrl: "https://dream.gnsinbo.or.kr/bbs/board.php?bo_table=04_01&wr_id=153",
      dateText: "2026-03-09 ~",
    });
    expect(rows.map((r) => r.detailUrl)).not.toEqual(rowsP2.map((r) => r.detailUrl));
  });

  it("날짜는 td.td_datetime 칸에서만 집는다 — 행 전체 글자면 번호·조회수와 붙는다", () => {
    const r = rows.find((x) => x.detailUrl.includes("wr_id=170"));
    expect(r?.dateText).toBe("2026-09-02 ~");
    expect(r?.dateText).not.toMatch(/157|707|5/);
  });
});

describe("거르개 — 버릴 것만 지정한다", () => {
  it("DROP 거르개가 실측 제목을 실제로 버린다", () => {
    const titles = combined.map((r) => r.title);
    expect(titles.some((t) => t.includes("시상계획"))).toBe(false);
    expect(titles.some((t) => t.includes("강사 모집"))).toBe(false);
    expect(titles.some((t) => t.includes("컨설턴트 모집"))).toBe(false);
    expect(titles.some((t) => t.includes("서류전형 결과"))).toBe(false);
    expect(titles.some((t) => t.includes("합격자 결과"))).toBe(false);
    expect(titles.some((t) => t.includes("결과 공고"))).toBe(false);
    expect(titles.some((t) => t.includes("컨설턴트 신규모집"))).toBe(false);
    expect(
      isGnsinboDropTitle(
        "(공고/기업 제2026-26호)「동행 30년, 미래를 잇는 힘」 경남신보 30주년 기념 소상공인 대상 시상계획 공고",
      ),
    ).toBe(true);
    expect(isGnsinboDropTitle("공고/기업 2026-7호 2026년 강사 모집 최종 합격자 결과 공고")).toBe(true);
    expect(isGnsinboDropTitle("공고/기업 2026-6호 2026년 컨설턴트 모집 최종 합격자 결과 공고")).toBe(true);
    expect(isGnsinboDropTitle("공고/기업 2026-4호 2026년 컨설턴트 모집 1차 서류전형 결과 발표")).toBe(true);
    expect(isGnsinboDropTitle("공고/기업 2026-3호 2026년 강사 모집 1차 서류전형 결과 발표")).toBe(true);
    expect(isGnsinboDropTitle("공고/기업 2026-2호 2026년 경남신용보증재단 컨설턴트 신규모집 공고")).toBe(true);
  });

  it("지원사업·공고는 살린다", () => {
    const titles = combined.map((r) => r.title);
    expect(titles.some((t) => t.includes("함께가게 멘토링"))).toBe(true);
    expect(titles.some((t) => t.includes("맞춤지원사업"))).toBe(true);
    expect(titles.some((t) => t.includes("컨설팅 지원 사업"))).toBe(true);
    expect(titles.some((t) => t.includes("희망리턴패키지"))).toBe(true);
    expect(isGnsinboDropTitle("공고/기업 2026-5호 2026년 함께가게 멘토링 지원사업 공고")).toBe(false);
    expect(
      isGnsinboDropTitle("(공고/기업 제2026-23호) 2026년 산청군 「소상공인 맟춤 컨설팅 지원 사업」시행 공고"),
    ).toBe(false);
    expect(
      isGnsinboDropTitle("(공고/ 기업2026 -28호)2026년 경상남도 소상공인 생애주기별 맞춤지원사업 추가공고"),
    ).toBe(false);
  });

  it("「채용」을 통째로 버리지 않는다 — 채용 지원사업은 살아남는다", () => {
    expect(isGnsinboDropTitle("청년 채용 지원사업 참여기업 모집")).toBe(false);
    expect(isGnsinboDropTitle("직원 채용 지원사업")).toBe(false);
    expect(isGnsinboDropTitle("직원 채용 공고")).toBe(true);
  });
});

describe("붙박이 공지 — 1년 넘은 것은 담지 않는다", () => {
  it("기준 시각을 2030년으로 옮기면 2026-02-02 붙박이가 빠진다", () => {
    const old = parseGnsinboList(listHtml, 1, Date.parse("2030-01-01T00:00:00Z"));
    expect(old.some((r) => r.detailUrl.includes("wr_id=142"))).toBe(false);
    expect(old.every((r) => r.dateText !== "")).toBe(true);
  });
});

describe("경남신용보증재단 소상공인지원 설정", () => {
  it("쪽넘김은 GET page + bo_table=04_01", () => {
    expect(gnsinboConfig.list.url(1)).toBe(
      "https://dream.gnsinbo.or.kr/bbs/board.php?bo_table=04_01&page=1",
    );
    expect(gnsinboConfig.list.url(2)).toBe(
      "https://dream.gnsinbo.or.kr/bbs/board.php?bo_table=04_01&page=2",
    );
    expect(gnsinboConfig.list.maxPages).toBe(10);
  });

  it("★상세 주소의 page 는 엔진이 알아서 떼어 낸다 — 안 떼면 같은 글이 쪽마다 다른 주소가 된다", () => {
    expect(pagingParamsOf(gnsinboConfig)).toContain("page");
  });

  it("지역은 경남 — 경남신용보증재단 소상공인종합지원 공고다", () => {
    expect(gnsinboConfig.region).toBe("경남");
    expect(gnsinboConfig.id).toBe("gnsinbo");
    expect(gnsinboConfig.agency).toBe("경남신용보증재단");
    expect(gnsinboConfig.label).toBe("경남신용보증재단 소상공인지원");
  });

  it("서식 변경 감지가 살아 있다 — 1은 검사를 끈 것과 같다", () => {
    expect(gnsinboConfig.expectMinRows).toBeGreaterThanOrEqual(2);
    expect(gnsinboConfig.expectMinRows).toBe(7);
  });

  it("행 선택자가 1쪽 고정본에서 실제 15줄을 잡는다", () => {
    expect(parseHtml(listHtml).querySelectorAll(gnsinboConfig.list.rowSelector)).toHaveLength(15);
  });

  it("상세 본문·첨부 자리가 실측 선택자다", () => {
    expect(gnsinboConfig.detailContentSelector).toBe("#bo_v_con");
    expect(gnsinboConfig.attachmentsScopeSelector).toBe("#bo_v_file");
  });
});

/** ★판정기를 망가뜨려 본다 — 안 하면 위 시험들이 「그냥 통과하는 글」일 뿐이다. */
describe("망가뜨려 보기", () => {
  it("행 껍데기 이름이 바뀌면 한 줄도 못 읽는다", () => {
    expect(parseGnsinboList(listHtml.replaceAll("tbl_wrap", "tbl_wrap-x"), 1, NOW)).toHaveLength(0);
  });

  it("제목 칸(.bo_tit)이 바뀌면 한 줄도 못 읽는다", () => {
    expect(parseGnsinboList(listHtml.replaceAll("bo_tit", "bo_tit-x"), 1, NOW)).toHaveLength(0);
  });

  it("작성일 칸이 사라지면 날짜를 비운다(오늘 날짜를 지어내지 않는다)", () => {
    const broken = parseGnsinboList(listHtml.replaceAll("td_datetime", "td_datetime-x"), 1, NOW);
    expect(broken.length).toBeGreaterThan(0);
    expect(broken.every((r) => r.dateText === "")).toBe(true);
  });
});
