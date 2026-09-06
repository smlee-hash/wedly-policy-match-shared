import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { pagingParamsOf } from "../engine";
import { isGjsinboDropTitle, parseGjsinboList, gjsinboConfig } from "./gjsinbo";

/**
 * ★손으로 쓴 HTML 대신 **실사이트 고정본**으로 잰다.
 * 창원 사고: 지어낸 HTML 로 시험하면 선택자 오타가 그대로 통과한다.
 * 고정본: 2026-09-03 실측 새소식 1·2쪽 (`?d=notification1` · `search_page=2`).
 */
const listHtml = readFileSync(join(__dirname, "../__fixtures__/gjsinbo-list.html"), "utf-8");
const listP2Html = readFileSync(join(__dirname, "../__fixtures__/gjsinbo-list-p2.html"), "utf-8");
const rows = parseGjsinboList(listHtml);
const rowsP2 = parseGjsinboList(listP2Html);
const combined = parseGjsinboList(listHtml + listP2Html);

describe("광주신용보증재단 새소식 목록 읽기 — 실사이트 고정본", () => {
  it("1쪽 고정본에서 DROP·중복을 뺀 4건을 읽고 첫 행이 맞다", () => {
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows.length).toBeLessThanOrEqual(20);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatchObject({
      title: "광주시-전남도-무안군-대통령실-정부, '광주 민·군공항 통합이전' 전격 합의",
      detailUrl: "https://www.gjsinbo.or.kr/index?d=notification1&action=view&bbs_id=1&data_id=4540",
      dateText: "2025-12-18 ~",
      agency: "광주신용보증재단",
    });
  });

  it("★상세 주소에 쪽 번호를 넣지 않는다 — 넣으면 같은 글이 쪽마다 다른 줄이 된다", () => {
    expect(rows.every((r) => !r.detailUrl.includes("search_page"))).toBe(true);
    expect(rowsP2.every((r) => !r.detailUrl.includes("search_page"))).toBe(true);
  });

  it("일반 행은 등록일을 개시형으로 넘긴다", () => {
    expect(rows.every((r) => r.dateText !== "")).toBe(true);
    for (const r of rows) expect(r.dateText).toMatch(/^\d{4}-\d{2}-\d{2} ~$/);
  });

  it("1쪽+2쪽을 합쳐 파싱해도 상세 열쇠 중복이 없고 8건이다", () => {
    const urls = combined.map((r) => r.detailUrl);
    expect(new Set(urls).size).toBe(urls.length);
    expect(combined).toHaveLength(8);
    const concat = [...rows, ...rowsP2];
    expect(new Set(concat.map((r) => r.detailUrl)).size).toBe(concat.length);
  });

  it("2쪽 고정본은 1쪽과 다른 글이다 — search_page 가 진짜 먹는다", () => {
    expect(rowsP2).toHaveLength(4);
    expect(rowsP2[0]).toMatchObject({
      title: "2025년 제2차 채무감면 캠페인 시행 안내",
      detailUrl: "https://www.gjsinbo.or.kr/index?d=notification1&action=view&bbs_id=1&data_id=4018",
      dateText: "2025-05-30 ~",
    });
    expect(rows.map((r) => r.detailUrl)).not.toEqual(rowsP2.map((r) => r.detailUrl));
  });

  it("지원사업 글은 살아남는다", () => {
    expect(rows.some((r) => r.title.includes("서구 소상공인 특례보증 지원사업"))).toBe(true);
    expect(rows.some((r) => r.title.includes("보증지원 우수사례 공모전"))).toBe(true);
  });

  it("날짜는 작성일 칸에서만 집는다 — 행 전체 글자면 번호·조회수와 붙는다", () => {
    const r = rows.find((x) => x.detailUrl.includes("data_id=4366"));
    expect(r?.dateText).toBe("2025-10-22 ~");
    expect(r?.dateText).not.toMatch(/21200|조회/);
  });
});

describe("거르개 — 버릴 것만 지정한다", () => {
  it("DROP 거르개가 실측 제목을 실제로 버린다", () => {
    const titles = combined.map((r) => r.title);
    expect(titles.some((t) => t.includes("합격자"))).toBe(false);
    expect(titles.some((t) => t.includes("설문조사"))).toBe(false);
    expect(titles.some((t) => t.includes("안내 동영상"))).toBe(false);
    expect(titles.some((t) => t.includes("화재"))).toBe(false);
    expect(titles.some((t) => t.includes("필기시험"))).toBe(false);
    expect(titles.some((t) => t.includes("채용시험"))).toBe(false);
    expect(titles.some((t) => t.includes("공개채용"))).toBe(false);
    expect(titles.some((t) => t.includes("선임공고"))).toBe(false);
    expect(isGjsinboDropTitle("2026 상반기 신입직원(6급) 최종합격자")).toBe(true);
    expect(isGjsinboDropTitle("2026년 보증이용기업 금융실태 및 신용보증 지원 효과 설문조사 안내")).toBe(true);
    expect(isGjsinboDropTitle("보증드림 이용 안내 동영상")).toBe(true);
    expect(isGjsinboDropTitle("광주신용보증재단 비상근임원 선임공고")).toBe(true);
    expect(isGjsinboDropTitle("국가정보자원관리원 화재 관련 안내 (2025.9.29. 11:10)")).toBe(true);
  });

  it("「채용」을 통째로 버리지 않는다 — 채용 지원사업은 살아남는다", () => {
    expect(isGjsinboDropTitle("청년 채용 지원사업 참여기업 모집")).toBe(false);
    expect(isGjsinboDropTitle("직원 채용 지원사업")).toBe(false);
    expect(isGjsinboDropTitle("2025 서구 소상공인 특례보증 지원사업")).toBe(false);
  });
});

describe("광주신용보증재단 설정", () => {
  it("쪽넘김은 GET search_page + bbs_id=1 — 새소식(notification1)만 붙인다", () => {
    expect(gjsinboConfig.list.url(1)).toBe(
      "https://www.gjsinbo.or.kr/index?d=notification1&search_page=1&bbs_id=1",
    );
    expect(gjsinboConfig.list.url(2)).toBe(
      "https://www.gjsinbo.or.kr/index?d=notification1&search_page=2&bbs_id=1",
    );
    expect(gjsinboConfig.list.maxPages).toBe(5);
  });

  it("★상세 주소의 search_page 는 엔진이 알아서 떼어 낸다 — 안 떼면 같은 글이 쪽마다 다른 주소가 된다", () => {
    expect(pagingParamsOf(gjsinboConfig)).toContain("search_page");
  });

  it("지역은 광주 — 광주신용보증재단 새소식이다", () => {
    expect(gjsinboConfig.region).toBe("광주");
    expect(gjsinboConfig.id).toBe("gjsinbo");
    expect(gjsinboConfig.agency).toBe("광주신용보증재단");
  });

  it("서식 변경 감지가 살아 있다 — 1은 검사를 끈 것과 같다", () => {
    expect(gjsinboConfig.expectMinRows).toBeGreaterThanOrEqual(2);
  });

  it("상세 본문·첨부 자리가 실측 선택자다", () => {
    expect(gjsinboConfig.detailContentSelector).toBe("div.cont_box");
    expect(gjsinboConfig.attachmentsScopeSelector).toBe("div.download_files");
  });
});

/** ★판정기를 망가뜨려 본다 — 안 하면 위 시험들이 「그냥 통과하는 글」일 뿐이다. */
describe("망가뜨려 보기", () => {
  it("행 껍데기 이름이 바뀌면 한 줄도 못 읽는다", () => {
    expect(parseGjsinboList(listHtml.replaceAll("bbs-basic-list", "bbs-basic-list-x"))).toHaveLength(0);
  });

  it("제목 칸(div.row-title)이 바뀌면 한 줄도 못 읽는다", () => {
    expect(parseGjsinboList(listHtml.replaceAll("row-title", "row-title-x"))).toHaveLength(0);
  });

  it("작성일 칸이 사라지면 날짜를 비운다(오늘 날짜를 지어내지 않는다)", () => {
    const broken = parseGjsinboList(listHtml.replaceAll("작성일 :", "게시 :"));
    expect(broken.every((r) => r.dateText === "")).toBe(true);
    expect(broken.length).toBeGreaterThan(0);
  });
});
