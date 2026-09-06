import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseHtml } from "../html";
import { djsinboConfig, isDjsinboDropTitle, parseDjsinboList } from "./djsinbo";

/**
 * ★손으로 쓴 HTML 대신 **실사이트 고정본**으로 잰다.
 * 창원 사고: 지어낸 HTML 로 시험하면 선택자 오타가 그대로 통과한다.
 * 고정본: 2026-09-03 실측 `https://www.sinbo.or.kr/sub04_01_01` 1쪽 + `/index/page/2` 2쪽.
 */
const listHtml = readFileSync(join(__dirname, "../__fixtures__/djsinbo-list.html"), "utf-8");
const listP2Html = readFileSync(join(__dirname, "../__fixtures__/djsinbo-list-p2.html"), "utf-8");
const rows = parseDjsinboList(listHtml);
const rowsP2 = parseDjsinboList(listP2Html);
const combined = parseDjsinboList(listHtml + listP2Html);

describe("대전신용보증재단 공지사항 목록 읽기 — 실사이트 고정본", () => {
  it("1쪽 고정본에서 DROP·중복을 뺀 4건을 읽고 첫 행이 맞다", () => {
    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatchObject({
      title: "대전 소상공인 상권분석 경영컨설팅 지원사업 하반기 모집 공고",
      detailUrl: "https://www.sinbo.or.kr/sub04_01_01/view/id/4588",
      dateText: "2026-08-24 ~",
      agency: "대전신용보증재단",
    });
  });

  it("★상세 주소에 쪽 번호를 넣지 않는다 — 넣으면 같은 글이 쪽마다 다른 줄이 된다", () => {
    expect(rows.every((r) => !r.detailUrl.includes("/page/"))).toBe(true);
    expect(rowsP2.every((r) => !r.detailUrl.includes("/page/"))).toBe(true);
    expect(rowsP2.every((r) => /^https:\/\/www\.sinbo\.or\.kr\/sub04_01_01\/view\/id\/\d+$/.test(r.detailUrl))).toBe(
      true,
    );
  });

  it("붙박이도 등록일을 개시형으로 넘긴다 — 날짜를 비우면 관문이 추측 단계로 내려간다", () => {
    const pinned = rows.filter((r) =>
      ["/id/4588", "/id/4503", "/id/4318"].some((id) => r.detailUrl.includes(id)),
    );
    expect(pinned).toHaveLength(3);
    expect(pinned.map((r) => r.dateText)).toEqual(["2026-08-24 ~", "2026-06-04 ~", "2026-01-06 ~"]);
  });

  it("★1년 넘게 붙어 있는 붙박이는 아예 안 담는다 — 날짜를 비우면 90일간 되살아난다", () => {
    const old = parseDjsinboList(listHtml, 1, Date.parse("2030-01-01T00:00:00Z"));
    expect(old.some((r) => r.detailUrl.includes("/id/4588"))).toBe(false);
    expect(old.some((r) => r.detailUrl.includes("/id/4503"))).toBe(false);
    expect(old.some((r) => r.detailUrl.includes("/id/4318"))).toBe(false);
    expect(old.some((r) => r.detailUrl.includes("/id/4482"))).toBe(true);
    expect(old.every((r) => r.dateText !== "")).toBe(true);
  });

  it("일반 행은 등록일을 개시형으로 넘긴다", () => {
    const r = rows.find((x) => x.detailUrl.includes("/id/4482"));
    expect(r).toMatchObject({
      title: "대전 소상공인 상권분석 경영컨설팅 지원사업 모집 공고",
      dateText: "2026-05-11 ~",
    });
    for (const row of [...rows, ...rowsP2]) {
      expect(row.dateText).toMatch(/^\d{4}-\d{2}-\d{2} ~$/);
    }
  });

  it("1쪽+2쪽을 합쳐 파싱해도 상세 열쇠 중복이 없고 11건이다", () => {
    const urls = combined.map((r) => r.detailUrl);
    expect(new Set(urls).size).toBe(urls.length);
    expect(combined).toHaveLength(11);
  });

  it("2쪽 첫 살아남은 행이 1쪽과 다르고 쪽 번호가 주소에 없다", () => {
    expect(rowsP2).toHaveLength(7);
    expect(rowsP2[0]).toMatchObject({
      title: "2026년 소상공인 경영지도 종합지원 패키지 사업 추가모집 공고(1차)",
      detailUrl: "https://www.sinbo.or.kr/sub04_01_01/view/id/4382",
      dateText: "2026-02-26 ~",
    });
    expect(rowsP2[0].detailUrl).not.toBe(rows[0].detailUrl);
  });

  it("DROP 거르개가 실측 제목을 실제로 버린다", () => {
    const titles = combined.map((r) => r.title);
    expect(titles.some((t) => t.includes("설문조사"))).toBe(false);
    expect(titles.some((t) => t.includes("고객만족도"))).toBe(false);
    expect(titles.some((t) => t.includes("GBSI"))).toBe(false);
    expect(titles.some((t) => t.includes("실태조사"))).toBe(false);
    expect(titles.some((t) => t.includes("컨설턴트 모집"))).toBe(false);
    expect(titles.some((t) => t.includes("방침 변경"))).toBe(false);
    expect(titles.some((t) => t.includes("화재관련"))).toBe(false);
    expect(isDjsinboDropTitle("2026년 보증이용기업 금융실태 및 신용보증 지원 효과 설문조사 안내")).toBe(true);
    expect(isDjsinboDropTitle("지역신보 보증사업평가 고객만족도 조사 안내")).toBe(true);
    expect(isDjsinboDropTitle("2026년 2분기 보증기업 경기실사지수(GBSI) 설문조사 안내")).toBe(true);
    expect(isDjsinboDropTitle("2026년 지역신보 보증이용기업의 폐업 실태조사 안내")).toBe(true);
    expect(isDjsinboDropTitle("대전 소상공인 상권분석 경영컨설팅 컨설턴트 모집공고")).toBe(true);
    expect(isDjsinboDropTitle("고정형 영상정보처리기기 운영·관리 방침 변경 안내")).toBe(true);
    expect(isDjsinboDropTitle("국가정보자원관리원 화재관련 보증 서비스  안내")).toBe(true);
    expect(isDjsinboDropTitle("이사장 공개모집 공고")).toBe(true);
  });

  it("「채용」을 통째로 버리지 않는다 — 채용 지원사업이 죽으면 안 된다", () => {
    expect(isDjsinboDropTitle("대전 소상공인 채용 지원사업 모집 공고")).toBe(false);
    expect(isDjsinboDropTitle("직원 채용 공고")).toBe(true);
  });

  it("컨설팅 지원사업은 살리고 컨설턴트 모집만 버린다", () => {
    expect(rows.some((r) => r.title.includes("경영컨설팅 지원사업"))).toBe(true);
    expect(isDjsinboDropTitle("대전 소상공인 상권분석 경영컨설팅 지원사업 하반기 모집 공고")).toBe(false);
  });

  it("날짜는 작성일 칸에서만 집는다 — 행 전체 글자면 번호·조회수와 붙는다", () => {
    const r = rows.find((x) => x.detailUrl.includes("/id/4482"));
    expect(r?.dateText).toBe("2026-05-11 ~");
    expect(r?.dateText).not.toMatch(/568/);
    expect(r?.dateText).not.toMatch(/287/);
  });
});

describe("대전신용보증재단 설정", () => {
  it("쪽넘김은 경로형 /index/page/{n} — 쿼리스트링 ?page= 이 아니다", () => {
    expect(djsinboConfig.list.url(1)).toBe("https://www.sinbo.or.kr/sub04_01_01");
    expect(djsinboConfig.list.url(2)).toBe("https://www.sinbo.or.kr/sub04_01_01/index/page/2");
    expect(djsinboConfig.list.url(2)).not.toContain("?page=");
    expect(djsinboConfig.list.url(1)).not.toBe(djsinboConfig.list.url(2));
    expect(djsinboConfig.list.maxPages).toBe(10);
  });

  it("지역은 대전", () => {
    expect(djsinboConfig.region).toBe("대전");
    expect(djsinboConfig.id).toBe("djsinbo");
    expect(djsinboConfig.agency).toBe("대전신용보증재단");
  });

  it("서식 변경 감지가 살아 있다 — 1은 검사를 끈 것과 같다", () => {
    expect(djsinboConfig.expectMinRows).toBeGreaterThanOrEqual(2);
  });

  it("★본문·첨부 선택자가 실측 상세와 같다", () => {
    expect(djsinboConfig.detailContentSelector).toBe("#board_content_zone");
    expect(djsinboConfig.attachmentsScopeSelector).toBe("div.board_downloader");
  });
});

/**
 * ★판정기를 망가뜨려 본다 — 안 하면 위 시험들이 「그냥 통과하는 글」일 뿐이다.
 */
describe("망가뜨려 보기", () => {
  it("행 선택자가 한 글자 틀리면 0행이다", () => {
    expect(parseDjsinboList(listHtml.replaceAll('class="bbs"', 'class="bbs-x"'))).toHaveLength(0);
  });

  it("제목 링크 경로가 바뀌면 한 줄도 못 읽는다", () => {
    expect(parseDjsinboList(listHtml.replaceAll("/sub04_01_01/view", "/sub04_01_01/xview"))).toHaveLength(0);
  });

  it("작성일 칸이 비면 날짜를 비운다(오늘 날짜를 지어내지 않는다)", () => {
    const blanked = listHtml.replaceAll(/\d{4}\/\d{2}\/\d{2}/g, "");
    const parsed = parseDjsinboList(blanked);
    expect(parsed.length).toBeGreaterThan(0);
    expect(parsed.every((r) => r.dateText === "")).toBe(true);
  });
});

describe("상세 본문·첨부 자리 — 선택자 한 글자", () => {
  it("목록 고정본에는 본문 칸이 없다 — 선택자를 목록에 들이대면 안 잡힌다", () => {
    const doc = parseHtml(listHtml);
    expect(doc.querySelector(djsinboConfig.detailContentSelector!)).toBeNull();
    expect(doc.querySelector("div.board_downloader-x")).toBeNull();
  });
});
