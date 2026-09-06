import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { harvestBoardAttachments } from "../detail-fill";
import { pagingParamsOf } from "../engine";
import { parseHtml } from "../html";
import { hanamConfig, hanamRegionOf, isHanamDropTitle, parseHanamList } from "./hanam";

/**
 * ★손으로 쓴 HTML 대신 **실사이트 고정본**으로 잰다.
 * 고정본: 2026-09-06 실측 공지사항(`bbsNo=1632`) 1쪽 · 상세 `nttNo=501713`.
 */
const listHtml = readFileSync(join(__dirname, "../__fixtures__/hanam-list.html"), "utf-8");
const detailHtml = readFileSync(join(__dirname, "../__fixtures__/hanam-detail.html"), "utf-8");
const rows = parseHanamList(listHtml);

const FIRST = {
  title: "2026년 하남시 스타트업 육성 지원사업(이루다+)",
  detailUrl: "https://www.hanam.go.kr/biz/selectBbsNttView.do?key=6003&bbsNo=1632&nttNo=501713",
  dateText: "2026-08-04 ~",
  agency: "하남시",
  region: "경기",
} as const;

describe("하남시 기업지원포털 목록 읽기 — 실사이트 고정본", () => {
  it("1쪽 고정본에서 10행을 잡고 DROP 뒤 4건이 남는다", () => {
    expect(parseHtml(listHtml).querySelectorAll(hanamConfig.list.rowSelector)).toHaveLength(10);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatchObject(FIRST);
  });

  it("모든 행이 작성일 개시형(YYYY-MM-DD ~)이다", () => {
    expect(rows.every((r) => /^20\d{2}-\d{2}-\d{2} ~$/.test(r.dateText))).toBe(true);
    // 행 전체 글자에서 찾으면 번호(161)·조회수가 날짜처럼 보이는 자리를 만든다.
    expect(rows[0].dateText).not.toContain("161");
  });

  it("★상세 주소를 key+bbsNo+nttNo 셋으로만 조립한다 — 검색 인자·쪽 번호를 남기면 쪽마다 다른 줄이 된다", () => {
    expect(rows.every((r) => !/[?&]pageIndex=/.test(r.detailUrl))).toBe(true);
    expect(rows.every((r) => !/search/i.test(r.detailUrl))).toBe(true);
    expect(rows.every((r) => /[?&]nttNo=\d+$/.test(r.detailUrl))).toBe(true);
    expect(pagingParamsOf(hanamConfig)).toContain("pageIndex");
    const urls = rows.map((r) => r.detailUrl);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it("★거울 메뉴(기업마당 재게시)는 주소에 한 번도 안 나온다", () => {
    expect(hanamConfig.list.url(1)).not.toContain("selectEntrprsSportBsnsApiList");
    expect(rows.every((r) => !r.detailUrl.includes("selectEntrprsSportBsnsApiList"))).toBe(true);
    expect(rows.every((r) => !r.detailUrl.includes("bizinfo.go.kr"))).toBe(true);
    expect(rows.every((r) => r.detailUrl.includes("bbsNo=1632"))).toBe(true);
  });
});

describe("★재게시 공고는 지역을 비운다 · 게시판 번호를 링크에서 확인한다", () => {
  it("제목 앞머리 기관이 하남이 아니면 region 이 비고, 자체 공고는 경기다", () => {
    expect(hanamRegionOf("[경기도경제과학진흥원]2026년 …")).toBe("");
    expect(hanamRegionOf("[경기도시장상권진흥원] 2026년 …")).toBe("");
    expect(hanamRegionOf("[하남시 평생교육과]2026년 …")).toBe("경기");
    expect(hanamRegionOf("2026년 하남시 스타트업 육성 지원사업(이루다+)")).toBe("경기");
    expect(rows.find((r) => r.title.startsWith("[경기도시장상권진흥원]"))?.region).toBe("");
    expect(rows[0].region).toBe("경기");
    expect(hanamConfig.region).toBe("경기");
  });

  it("★게시판 번호가 1632 가 아닌 줄은 담지 않는다 — 거울 메뉴 글이 섞여 들어와도 막는다", () => {
    // 고정본 raw 는 `&amp;` 로 이어져 있다.
    const planted = listHtml.replace("bbsNo=1632&amp;nttNo=501713", "bbsNo=9999&amp;nttNo=501713");
    const out = parseHanamList(planted);
    expect(out.some((r) => r.detailUrl.includes("nttNo=501713"))).toBe(false);
    expect(out).toHaveLength(3);
    // 게시판 번호가 아예 없는 링크도 담지 않는다.
    expect(parseHanamList(listHtml.replaceAll("bbsNo=1632&amp;", ""))).toHaveLength(0);
  });
});

describe("상세 — 본문·첨부", () => {
  it("본문 선택자가 모집 내용을 집는다", () => {
    const body = parseHtml(detailHtml).querySelector(hanamConfig.detailContentSelector!)?.text ?? "";
    expect(body).toContain("모집기간");
    expect(body).toContain("신청대상");
    expect(body.length).toBeGreaterThan(200);
  });

  it("첨부 다섯 건을 상자 안에서만 수확하고 「미리보기」는 담지 않는다", () => {
    const scope = parseHtml(detailHtml)
      .querySelectorAll(hanamConfig.attachmentsScopeSelector!)
      .map((el) => el.outerHTML)
      .join("\n");
    expect(scope).not.toBe("");
    const atts = harvestBoardAttachments(scope, hanamConfig.baseUrl, detailHtml, hanamConfig.charset);
    expect(atts).toHaveLength(5);
    expect(atts.every((a) => !a.url.includes("previewHtml.do"))).toBe(true);
    expect(atts[0].url).toBe("https://www.hanam.go.kr/biz/downloadBbsFile.do?atchmnflNo=140582");
    expect(atts[0].name).toContain("사업 참여기업 모집공고문.hwp");
    // 공고문이 맨 앞으로 온다 — 첨부에서 본문을 뽑는 단계가 앞 파일부터 읽는다.
    expect(atts[0].kind).toBe("hwp");
  });

  it("첨부에 세션·Referer 가 필요 없다(실측) — 옵션을 켜지 않는다", () => {
    expect(hanamConfig.attachmentSession).toBeUndefined();
    expect(hanamConfig.attachmentToken).toBeUndefined();
  });
});

describe("거르개 — 버릴 것만 지정한다", () => {
  it("교육생·수강생 모집과 설문조사·총조사가 빠진다", () => {
    const titles = rows.map((r) => r.title);
    expect(titles.some((t) => t.includes("교육생 모집"))).toBe(false);
    expect(titles.some((t) => t.includes("수강생 모집"))).toBe(false);
    expect(titles.some((t) => t.includes("설문조사"))).toBe(false);
    expect(titles.some((t) => t.includes("경제총조사"))).toBe(false);
    expect(
      isHanamDropTitle("[경기도경제과학진흥원]2026년 경기 스타트업 아카데미「창업기초 및 투자유치 교육(하반기)」 교육생 모집 안내"),
    ).toBe(true);
    expect(isHanamDropTitle("2025년 기준 하남시 경제총조사 실시")).toBe(true);
  });

  it("심은 DROP 제목이 실제로 빠진다", () => {
    for (const planted of ["2026년 청사 물품 입찰 공고", "직원 채용 공고", "2026년 평가위원 모집"]) {
      const html = listHtml.replace(FIRST.title, planted);
      const out = parseHanamList(html);
      expect(out.some((r) => r.title === planted), planted).toBe(false);
      expect(out, planted).toHaveLength(3);
      expect(isHanamDropTitle(planted), planted).toBe(true);
    }
  });

  it("★`교육` 을 통째로 버리지 않는다 — 교육비를 대 주는 지원사업이 죽으면 안 된다", () => {
    expect(rows.some((r) => r.title.includes("경영 안정화 교육지원 사업"))).toBe(true);
    expect(
      isHanamDropTitle("[경기도시장상권진흥원] 2026년 생애 최초 경영 안정화 교육지원 사업 모집 공고"),
    ).toBe(false);
    expect(isHanamDropTitle("2026년 하남시 스타트업 육성 지원사업(이루다+)")).toBe(false);
  });
});

describe("하남시 기업지원포털 설정", () => {
  it("쪽넘김은 GET pageIndex + bbsNo=1632", () => {
    expect(hanamConfig.list.url(1)).toBe(
      "https://www.hanam.go.kr/biz/selectBbsNttList.do?bbsNo=1632&key=6003&pageIndex=1",
    );
    expect(hanamConfig.list.url(2)).toBe(
      "https://www.hanam.go.kr/biz/selectBbsNttList.do?bbsNo=1632&key=6003&pageIndex=2",
    );
    expect(hanamConfig.list.maxPages).toBe(3);
  });

  it("이름·지역·추측 끄기·서식 변경 감지", () => {
    expect(hanamConfig.id).toBe("hanam");
    expect(hanamConfig.region).toBe("경기");
    expect(hanamConfig.agency).toBe("하남시");
    expect(hanamConfig.skipHeuristic).toBe(true);
    expect(hanamConfig.expectMinRows).toBeGreaterThanOrEqual(2);
    expect(hanamConfig.expectMinRows).toBe(2);
  });
});

/** ★판정기를 망가뜨려 본다 — 안 하면 위 시험들이 「그냥 통과하는 글」일 뿐이다. */
describe("망가뜨려 보기", () => {
  it("표 껍데기 이름이 바뀌면 한 줄도 못 읽는다", () => {
    expect(parseHanamList(listHtml.replaceAll("p-table", "p-table-x"))).toHaveLength(0);
  });

  it("제목 칸 이름이 바뀌면 한 줄도 못 읽는다", () => {
    expect(parseHanamList(listHtml.replaceAll("text_left", "text_left-x"))).toHaveLength(0);
  });

  it("작성일 칸 이름이 바뀌면 날짜를 비운다(오늘 날짜를 지어내지 않는다)", () => {
    const broken = parseHanamList(listHtml.replaceAll('class="last"', 'class="last-x"'));
    expect(broken.length).toBeGreaterThan(0);
    expect(broken.every((r) => r.dateText === "")).toBe(true);
  });

  it("첨부 상자 이름이 바뀌면 첨부를 지어내지 않는다", () => {
    const html = detailHtml.replaceAll("p-attach", "p-attach-x");
    const scope = parseHtml(html)
      .querySelectorAll(hanamConfig.attachmentsScopeSelector!)
      .map((el) => el.outerHTML)
      .join("\n");
    expect(scope).toBe("");
    expect(harvestBoardAttachments(scope, hanamConfig.baseUrl, html, hanamConfig.charset)).toHaveLength(0);
  });
});
