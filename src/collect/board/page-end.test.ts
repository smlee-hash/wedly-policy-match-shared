import { describe, expect, it } from "vitest";
import { isProvenEmptyBoardPage } from "./page-end";
import { ansanConfig } from "./sources/ansan";
import { gtpConfig } from "./sources/gtp";
import { gwsinboConfig } from "./sources/gwsinbo";
import { irisConfig } from "./sources/iris";
import { kosmesConfig } from "./sources/kosmes";
import { kotraConfig } from "./sources/kotra";
import { seoultpConfig } from "./sources/seoultp";
import { smartfactoryConfig } from "./sources/smartfactory";
import { tpGyeongnamConfig } from "./sources/tp-gyeongnam";
import type { BoardConfig } from "./types";

const fields = {
  title: { selector: "td.subject a" },
  detailUrl: { selector: "td.subject a", attr: "href" },
  date: { selector: "td.date" },
};

function board(rowSelector: string, extra: Partial<BoardConfig> = {}): BoardConfig {
  return {
    id: "tp-x",
    label: "X테크노파크",
    agency: "X테크노파크",
    region: "부산",
    baseUrl: "https://x.kr/b/",
    list: {
      url: (p) => `https://x.kr/b/list?p=${p}`,
      maxPages: 99,
      rowSelector,
      fields,
    },
    expectMinRows: 3,
    ...extra,
  };
}

const KOTRA_EMPTY = `<div class="card"><div class="card-inner"><div class="card-body">조회된 데이터가 없습니다.</div></div></div>
<input type="hidden" id="limtTotCnt" value="91"><div class="pagination">1</div>`;
const IRIS_EMPTY = `<ul class="dbody"><li><div class="form-row" style="text-align:center;"><div class="group"><span class="title">데이터가 존재하지 않습니다.</span></div></div></li></ul>`;
const ANSAN_EMPTY = `<table class="p-table simple"><tbody><tr><td colspan="5">등록된 게시글이 존재하지 않습니다.</td></tr></tbody></table>`;
const GWSINBO_EMPTY = `<table class="basic_board"><tbody><tr><td colspan="4">등록된 게시글이 없습니다.</td></tr></tbody></table>`;
const SEOULTP_EMPTY = `<table class="board-list"><tbody><tr><td colspan="5">조회결과가 존재하지 않습니다.</td></tr></tbody></table>`;
const GYEONGNAM_EMPTY = `<table><tbody id="gridData"><tr class="table-contents"><td>해당되는 결과가 존재하지 않습니다.</td></tr></tbody></table>`;

const KOSMES_END = {
  pageInfo: {
    rowMax: 44, pageCount: 10, startPage: 1, startRowNum: 51, scopeRow: 50,
    endRowNum: 61, rowCount: 10, endPage: 5, maxPage: 5, nowPage: 6,
  },
  ds_infoList: [],
};

const SF_PAGE = {
  blockPage: "10", pageBasic: "1", startNumber: "60", showPage: "10",
  totalPageCount: "6", endNumber: "51", currentPage: "7", totalCount: "51",
};

const SMARTFACTORY_END = {
  paginationInfo: SF_PAGE,
  pbancList: [],
  key: "list",
  modelAndView: {
    model: { pbancList: [], paginationInfo: SF_PAGE, key: "list" },
    modelMap: { pbancList: [], paginationInfo: SF_PAGE, key: "list" },
  },
};

describe("isProvenEmptyBoardPage — 목록 상자", () => {
  it("관측된 8곳 빈 표식을 선택자 상자 안에서만 인정한다", () => {
    expect(isProvenEmptyBoardPage(KOTRA_EMPTY, kotraConfig)).toBe(true);
    expect(isProvenEmptyBoardPage(IRIS_EMPTY, irisConfig)).toBe(true);
    expect(isProvenEmptyBoardPage(ANSAN_EMPTY, ansanConfig)).toBe(true);
    expect(isProvenEmptyBoardPage(GWSINBO_EMPTY, gwsinboConfig)).toBe(true);
    expect(isProvenEmptyBoardPage(SEOULTP_EMPTY, seoultpConfig)).toBe(true);
    expect(isProvenEmptyBoardPage(GYEONGNAM_EMPTY, tpGyeongnamConfig)).toBe(true);
  });

  it("상자가 없으면 같은 문구도 빈 목록이 아니다", () => {
    const footer = `<footer>데이터가 존재하지 않습니다.</footer>`;
    expect(isProvenEmptyBoardPage(footer, irisConfig)).toBe(false);
    expect(isProvenEmptyBoardPage(`<p>해당되는 결과가 존재하지 않습니다.</p>`, tpGyeongnamConfig)).toBe(false);
    expect(isProvenEmptyBoardPage(`<html><form>로그인</form><p>조회된 데이터가 없습니다.</p></html>`, kotraConfig)).toBe(false);
  });

  it("채워진 목록 옆 바닥글 빈 문구를 끝으로 보지 않는다", () => {
    const irisPopulated = `<ul class="dbody"><li><strong class="title"><a href="" onclick="f_bsnsAncmBtinSituListForm_view('023757','ancmIng')">공고</a></strong></li></ul><footer>데이터가 존재하지 않습니다.</footer>`;
    expect(isProvenEmptyBoardPage(irisPopulated, irisConfig)).toBe(false);
    const gyeongnamPopulated = `<table><tbody id="gridData"><tr class="table-contents"><td><a class="color-fix" onclick="goPage('S', null, '/biz/applyInfo/1')">공고</a></td></tr></tbody></table><footer>해당되는 결과가 존재하지 않습니다.</footer>`;
    expect(isProvenEmptyBoardPage(gyeongnamPopulated, tpGyeongnamConfig)).toBe(false);
  });

  it("경기TP 마감 10줄은 빈 목록이 아니다", () => {
    const rows = Array.from({ length: 10 }, (_, i) =>
      `<tr><td class="subject"><a href="#none" onclick="fn_goView('${172000 + i}'); return false;" title="2026 지원사업 공고 ${i + 1}번">2026 지원사업 공고 ${i + 1}번</a></td><td class="last">마감</td></tr>`,
    ).join("");
    expect(isProvenEmptyBoardPage(`<table class="t01"><tbody>${rows}</tbody></table>`, gtpConfig)).toBe(false);
  });

  it("빈 본문·오류 HTML·임의 낱말은 끝이 아니다", () => {
    const generic = board("tbody tr");
    expect(isProvenEmptyBoardPage("", generic)).toBe(false);
    expect(isProvenEmptyBoardPage("<div>없음</div>", generic)).toBe(false);
    expect(isProvenEmptyBoardPage("<html><body>오류</body></html>", generic)).toBe(false);
    expect(isProvenEmptyBoardPage("<html><p>검색 결과가 없습니다. 접근이 제한되었습니다.</p></html>", generic)).toBe(false);
  });
});

describe("isProvenEmptyBoardPage — 출처 JSON 스키마", () => {
  it("다른 출처나 요청하지 않은 쪽의 응답을 수집 끝으로 쓰지 않는다", () => {
    expect(isProvenEmptyBoardPage(JSON.stringify(KOSMES_END), smartfactoryConfig, 6)).toBe(false);
    expect(isProvenEmptyBoardPage(JSON.stringify(KOSMES_END), kosmesConfig, 1)).toBe(false);
    expect(isProvenEmptyBoardPage(JSON.stringify(SMARTFACTORY_END), smartfactoryConfig, 2)).toBe(false);
  });

  it("오류 표식이나 정수가 아닌 쪽 번호가 있으면 끝으로 쓰지 않는다", () => {
    expect(isProvenEmptyBoardPage(JSON.stringify({ ...SMARTFACTORY_END, error: "unavailable" }), smartfactoryConfig, 7)).toBe(false);
    expect(isProvenEmptyBoardPage(JSON.stringify({ ...KOSMES_END,
      pageInfo: { ...KOSMES_END.pageInfo, nowPage: 6.5 },
    }), kosmesConfig, 6)).toBe(false);
  });

  it("중진공·스마트공장 관측 빈 응답만 끝으로 본다", () => {
    expect(isProvenEmptyBoardPage(JSON.stringify(KOSMES_END), kosmesConfig, 6)).toBe(true);
    expect(isProvenEmptyBoardPage(JSON.stringify(SMARTFACTORY_END), smartfactoryConfig, 7)).toBe(true);
  });

  it("행이 있거나 오류·메타가 어긋나면 끝이 아니다", () => {
    expect(isProvenEmptyBoardPage(JSON.stringify({
      ...KOSMES_END,
      ds_infoList: [{ SLNO: "1", TITL_NM: "공고" }],
    }), kosmesConfig, 6)).toBe(false);
    expect(isProvenEmptyBoardPage(JSON.stringify({
      pageInfo: { resultCd: "999", resultMsg: "시스템 오류가 발생하였습니다." },
    }), kosmesConfig, 6)).toBe(false);
    expect(isProvenEmptyBoardPage(JSON.stringify({ ds_infoList: [] }), kosmesConfig, 6)).toBe(false);
    expect(isProvenEmptyBoardPage(JSON.stringify({
      ...KOSMES_END,
      pageInfo: { ...KOSMES_END.pageInfo, nowPage: 5 },
    }), kosmesConfig, 6)).toBe(false);
    expect(isProvenEmptyBoardPage(JSON.stringify({
      ...KOSMES_END,
      pageInfo: { ...KOSMES_END.pageInfo, maxPage: 3 },
    }), kosmesConfig, 6)).toBe(false);
    expect(isProvenEmptyBoardPage(JSON.stringify({
      paginationInfo: SF_PAGE,
      pbancList: [{ pbancId: "2026-N-0182", pbancSn: 1, dtlPbancNm: "공고" }],
      key: "list",
    }), smartfactoryConfig, 7)).toBe(false);
    expect(isProvenEmptyBoardPage(JSON.stringify({
      paginationInfo: { ...SF_PAGE, currentPage: "6" },
      pbancList: [],
      key: "list",
    }), smartfactoryConfig, 7)).toBe(false);
    expect(isProvenEmptyBoardPage(JSON.stringify({
      paginationInfo: SF_PAGE,
      pbancList: [],
      key: "list",
      modelAndView: { model: { pbancList: [{ pbancId: "x" }], paginationInfo: SF_PAGE, key: "list" } },
    }), smartfactoryConfig, 7)).toBe(false);
    expect(isProvenEmptyBoardPage(JSON.stringify({ items: [] }), kosmesConfig, 6)).toBe(false);
    expect(isProvenEmptyBoardPage("[]", smartfactoryConfig, 7)).toBe(false);
  });
});
