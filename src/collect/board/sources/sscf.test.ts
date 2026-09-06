import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { harvestBoardAttachments, p2w5AttachmentHref, p2w5SkipsEmbeddedFiles } from "../detail-fill";
import { pagingParamsOf } from "../engine";
import { parseHtml } from "../html";
import { isSscfClosedState, isSscfDropTitle, parseSscfList, sscfConfig } from "./sscf";

/**
 * ★손으로 쓴 HTML 대신 **실사이트 고정본**으로 잰다.
 * 고정본: 2026-09-06 실측 「지원사업공고」 1쪽 · 상세 `ACV_CNT_BOARD_NUM=202608271728400217`.
 */
const listHtml = readFileSync(join(__dirname, "../__fixtures__/sscf-list.html"), "utf-8");
const detailHtml = readFileSync(join(__dirname, "../__fixtures__/sscf-detail.html"), "utf-8");
const rows = parseSscfList(listHtml);
const scopeOf = (html: string) =>
  parseHtml(html)
    .querySelectorAll(sscfConfig.attachmentsScopeSelector!)
    .map((el) => el.outerHTML)
    .join("\n");

const FIRST = {
  title: "『2026년 제3회 창업지원센터 청년관 신규 1인창조기업 모집』공고",
  detailUrl: "https://sscf2016.or.kr/entry_view.do?mn_key=04010000&ACV_CNT_BOARD_NUM=202608120821490404",
  dateText: "",
  category: "창업지원센터 · 시설·공간 · 오늘마감",
  agency: "수원도시재단",
} as const;

describe("수원도시재단 지원사업공고 목록 읽기 — 실사이트 고정본", () => {
  it("★`<form>` 이 `<tbody>` 안에 끼어 있는 표에서 14행을 잡고 DROP 4 + 마감 8을 뺀 2건이 남는다", () => {
    expect(parseHtml(listHtml).querySelectorAll(sscfConfig.list.rowSelector)).toHaveLength(14);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject(FIRST);
  });

  /**
   * ★★이 출처의 가장 위험한 자리(2026-09-06 적대 리뷰).
   * 목록에 날짜 칸이 없어서 **마감된 줄을 담으면 날짜 없는 공고로 저장되고 영영 「모집중」으로 굳는다.**
   * 상태 칸이 두 이름(`p.bbs_term` 진행 · `p.bbs_term2` 마감)이라 한쪽만 읽으면 이 판정이 통째로 헛돈다.
   */
  it("★「마감」 줄 8건을 담지 않는다 — 담으면 날짜 없이 저장돼 모집중으로 굳는다", () => {
    expect(parseHtml(listHtml).querySelectorAll("p.bbs_term2")).toHaveLength(10);
    expect(parseHtml(listHtml).querySelectorAll("p.bbs_term")).toHaveLength(4);
    // 마감 10건 중 2건은 DROP 에도 걸린다 → 마감만으로 빠지는 것은 8건.
    expect(rows.every((r) => !(r.category ?? "").endsWith("· 마감"))).toBe(true);
    expect(rows.some((r) => r.title.includes("사회적경제 사업화 지원"))).toBe(false);
    expect(rows.some((r) => r.title.includes("창업오디션"))).toBe(false);
  });

  it("★「오늘마감·마감N일전」은 아직 접수 중이라 담고 상태를 분류에 싣는다", () => {
    expect(isSscfClosedState("마감")).toBe(true);
    expect(isSscfClosedState(" 마 감 ")).toBe(true);
    expect(isSscfClosedState("오늘마감")).toBe(false);
    expect(isSscfClosedState("마감5일전")).toBe(false);
    expect(isSscfClosedState("모집중")).toBe(false);
    expect(isSscfClosedState("")).toBe(false);
    expect(rows[0].category).toContain("오늘마감");
    expect(rows[1].category).toContain("모집중");
  });

  it("★제목에 href 가 없다 — onclick 의 글 번호로 상세 주소를 조립한다", () => {
    expect(rows.every((r) => /ACV_CNT_BOARD_NUM=\d{18}$/.test(r.detailUrl))).toBe(true);
    const urls = rows.map((r) => r.detailUrl);
    expect(new Set(urls).size).toBe(urls.length);
    // 한 쪽 고정이라 쪽 변수는 상세 주소에 들어갈 일이 없다.
    expect(rows.every((r) => !/srch_page/.test(r.detailUrl))).toBe(true);
    expect(pagingParamsOf(sscfConfig)).toContain("srch_page");
  });

  it("★목록에 날짜 칸이 없다 — 오늘 날짜를 지어내지 않고 비운 채로 담는다", () => {
    expect(rows.every((r) => r.dateText === "")).toBe(true);
    expect(sscfConfig.allowUndatedRows).toBe(true);
  });

  it("지원부서·유형·상태를 분류로 남긴다", () => {
    expect(rows[1].category).toBe("창업지원센터 · 컨설팅 · 모집중");
    expect(rows[0].category).toBe("창업지원센터 · 시설·공간 · 오늘마감");
  });

  it("★부서로 거르지 않는다 — 주거복지센터가 올린 기업 공고도 제목 거르개만 통과하면 살아 있다", () => {
    // 실측 「새빛 청년존(Zone) 입주기업 모집 공고」(주거복지센터)는 제목 거르개에 안 걸린다.
    expect(isSscfDropTitle("새빛 청년존(Zone) 입주기업 모집 공고")).toBe(false);
  });
});

describe("상세 — 본문·첨부", () => {
  it("★본문 범위를 표 전체로 잡아 접수기간(공고일정)까지 글자로 담는다 — 목록엔 날짜가 없다", () => {
    const body = parseHtml(detailHtml).querySelector(sscfConfig.detailContentSelector!)?.text ?? "";
    const flat = body.replace(/\s+/g, " ").trim();
    expect(flat).toContain("공고일정 : 2026.08.27 9시 ~ 2026.09.17 18시");
    expect(flat).toContain("수원도시재단공고");
    expect(flat).toContain("모집개요");
  });

  it("★`fn_getFile` 의 **두 번째 인자**로 실측 통로를 조립한다 — 갈래가 없으면 확인 안 된 경로가 잡힌다", () => {
    const scope = scopeOf(detailHtml);
    expect(scope).not.toBe("");
    const atts = harvestBoardAttachments(scope, sscfConfig.baseUrl, detailHtml, sscfConfig.charset);
    expect(atts).toHaveLength(1);
    expect(atts[0].url).toBe("https://sscf2016.or.kr/contest/fileDown.do?ACV_FIL_KEY=202608281726410207");
    expect(atts[0].name).toBe("2026 투자유치 프로그램 멘토링 참가기업 모집 공고.hwp");
    expect(atts[0].kind).toBe("hwp");
  });

  it("★확인 안 된 정적 경로(세 번째 인자)는 첨부로 담지 않는다 — 담으면 한 파일이 두 줄이 된다", () => {
    expect(p2w5SkipsEmbeddedFiles(sscfConfig.baseUrl)).toBe(true);
    expect(p2w5SkipsEmbeddedFiles("https://www.ikse.or.kr/")).toBe(false);
    const atts = harvestBoardAttachments(
      scopeOf(detailHtml),
      sscfConfig.baseUrl,
      detailHtml,
      sscfConfig.charset,
    );
    expect(atts.every((a) => !a.url.includes("sscf2019_files"))).toBe(true);
  });

  it("★갈래는 **호스트 한정**이다 — 다른 사이트에서 같은 함수 이름이 나와도 안 걸린다", () => {
    const call = "fn_getFile('file','202608281726410207','/sscf2019_files/contest/a.hwp')";
    expect(p2w5AttachmentHref(call, "https://sscf2016.or.kr/")).toBe(
      "/contest/fileDown.do?ACV_FIL_KEY=202608281726410207",
    );
    expect(p2w5AttachmentHref(call, "https://sscf2016.example.or.kr/")).toBeNull();
  });

  it("상세 본문·첨부 자리가 실측 선택자다", () => {
    expect(sscfConfig.detailContentSelector).toBe("table.b_view");
    expect(sscfConfig.attachmentsScopeSelector).toBe("table.b_view");
    expect(sscfConfig.detailFetch).toBeUndefined();
  });
});

describe("거르개 — 버릴 것만 지정한다", () => {
  it("주거복지 프로그램과 위원 모집이 빠진다", () => {
    const titles = rows.map((r) => r.title);
    expect(titles.some((t) => t.includes("전세임대"))).toBe(false);
    expect(titles.some((t) => t.includes("집수리"))).toBe(false);
    expect(titles.some((t) => t.includes("위원 모집"))).toBe(false);
    expect(titles.some((t) => t.includes("평가위원"))).toBe(false);
    expect(isSscfDropTitle("[안심 집 찾기] 전세임대 선정자를 위한 주택물색 지원 서비스 안내")).toBe(true);
    expect(isSscfDropTitle("2026 창업활성화 전문가 멘토 위원 모집 공고")).toBe(true);
  });

  it("심은 DROP 제목이 실제로 빠진다", () => {
    for (const planted of ["2026년 청사 물품 입찰 공고", "직원 채용 공고", "지원사업 선정 결과 발표"]) {
      const html = listHtml.replace(FIRST.title, planted);
      const out = parseSscfList(html);
      expect(out.some((r) => r.title === planted), planted).toBe(false);
      expect(out, planted).toHaveLength(1);
      expect(isSscfDropTitle(planted), planted).toBe(true);
    }
  });

  it("기업·창업 공고는 살린다", () => {
    expect(rows.some((r) => r.title.includes("1인창조기업 모집"))).toBe(true);
    expect(rows.some((r) => r.title.includes("투자유치 프로그램"))).toBe(true);
    expect(isSscfDropTitle("「2026 투자유치 프로그램: 멘토링」 참가기업 모집 공고")).toBe(false);
    expect(isSscfDropTitle("[공고 제2026-078호]사회적경제 사업화 지원 참가기업 2차 모집 공고")).toBe(false);
  });
});

describe("수원도시재단 설정", () => {
  it("★쪽 변수는 붙이되 한 쪽만 읽는다 — srch_page=2 가 1쪽과 같은 14행을 돌려준다(실측)", () => {
    expect(sscfConfig.list.url(1)).toBe(
      "https://sscf2016.or.kr/entry_list.do?mn_key=04010000&brd_key=0&srch_page=1",
    );
    expect(sscfConfig.list.url(2)).toBe(
      "https://sscf2016.or.kr/entry_list.do?mn_key=04010000&brd_key=0&srch_page=2",
    );
    expect(sscfConfig.list.maxPages).toBe(1);
  });

  it("이름·지역·추측 끄기·서식 변경 감지", () => {
    expect(sscfConfig.id).toBe("sscf");
    expect(sscfConfig.region).toBe("경기");
    expect(sscfConfig.agency).toBe("수원도시재단");
    expect(sscfConfig.skipHeuristic).toBe(true);
    /**
     * ★하한이 1이다 — 마감 줄을 빼고 나면 접수 중이 원래 한 자리다(고정본 2건).
     * 서식이 바뀌면 파서가 0행을 내어 「행 0개」로 걸린다(`fn_goViewPage` + 칸 6개를 둘 다 요구).
     */
    expect(sscfConfig.expectMinRows).toBe(1);
  });
});

/** ★판정기를 망가뜨려 본다 — 안 하면 위 시험들이 「그냥 통과하는 글」일 뿐이다. */
describe("망가뜨려 보기", () => {
  it("표 껍데기 이름이 바뀌면 한 줄도 못 읽는다", () => {
    expect(parseSscfList(listHtml.replaceAll("b_list", "b_list-x"))).toHaveLength(0);
  });

  it("상세 열기 함수 이름이 바뀌면 한 줄도 못 읽는다(주소를 지어내지 않는다)", () => {
    expect(parseSscfList(listHtml.replaceAll("fn_goViewPage(", "fn_goViewPage_x("))).toHaveLength(0);
  });

  it("제목 칸 이름이 바뀌면 한 줄도 못 읽는다", () => {
    expect(parseSscfList(listHtml.replaceAll("txt_left", "txt_left-x"))).toHaveLength(0);
  });

  it("첨부 함수 이름이 바뀌면 첨부를 지어내지 않는다 — 정적 경로로도 안 새어 나온다", () => {
    const html = detailHtml.replaceAll("fn_getFile(", "fn_getFile_x(");
    expect(harvestBoardAttachments(scopeOf(html), sscfConfig.baseUrl, html, sscfConfig.charset)).toHaveLength(0);
  });
});
