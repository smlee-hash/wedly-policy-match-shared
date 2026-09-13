import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isProvenAdditionalSourceEnd } from "./additional-page-end";
import { isProvenEmptyBoardPage } from "./page-end";
import { gjsinboConfig } from "./sources/gjsinbo";
import { pipaConfig } from "./sources/pipa";
import type { BoardConfig } from "./types";

const pipaLive = readFileSync(join(__dirname, "__fixtures__/pipa-list.html"), "utf-8");
const pipaLiveP2 = readFileSync(join(__dirname, "__fixtures__/pipa-list-p2.html"), "utf-8");
const gjsinboLive = readFileSync(join(__dirname, "__fixtures__/gjsinbo-list.html"), "utf-8");
const gjsinboLiveP2 = readFileSync(join(__dirname, "__fixtures__/gjsinbo-list-p2.html"), "utf-8");

const otherConfig: BoardConfig = {
  ...pipaConfig,
  id: "kotra",
};

function pipaPinned(id: string, title: string, onclick?: string): string {
  const call = onclick ?? `fn_goView('${id}', 'notice')`;
  return `<li class="tr">
    <div class="board_num notice"><span>공지</span></div>
    <div class="board_tit"><a href="#none" onclick="${call}"><span>${title}</span></a></div>
  </li>`;
}

function pipaOrdinary(id: string, title: string, date?: string): string {
  const dateCell = date === undefined
    ? ""
    : `<div class="board_date"><span>${date}</span></div>`;
  return `<li class="tr">
    <div class="board_num"><span>1</span></div>
    <div class="board_tit"><a href="#none" onclick="fn_goView('${id} ')"><span>${title}</span></a></div>
    ${dateCell}
  </li>`;
}

function pipaEnd(opts: {
  last?: string;
  extraRows?: string;
  notice?: string;
  includeTable?: boolean;
  includePaginate?: boolean;
  includeThead?: boolean;
  includePinned?: boolean;
} = {}): string {
  const last = opts.last ?? "11";
  const notice = opts.notice ?? "<div>등록된 게시물이 없습니다.</div>";
  const thead = opts.includeThead === false
    ? ""
    : `<li class="tr thead"><div class="board_num"><span>NO</span></div><div class="board_tit"><span>제목</span></div></li>`;
  const pinned = opts.includePinned === false
    ? ""
    : `${pipaPinned("851", "2026년 안내책자 자료")}${pipaPinned("962", "[모집] 2026년 제조 AI 실무 활용 재직자 무료교육 교육생 모집 안내")}`;
  const table = opts.includeTable === false
    ? ""
    : `<ul class="table">${thead}${pinned}${opts.extraRows ?? ""}${notice}</ul>`;
  const paginate = opts.includePaginate === false
    ? ""
    : `<div class="paginate"><ul>
        <li class="first"><a href="#none" onclick="fn_egov_link_page(1); return false;"></a></li>
        <li class="last"><a href="#none" onclick="fn_egov_link_page(${last}); return false;"></a></li>
      </ul></div>`;
  return `${table}${paginate}`;
}

function gjsinboEnd(opts: {
  total?: string;
  rows?: string;
  firstHref?: string;
  prevHref?: string;
  extraLinks?: string;
  bbsId?: string;
  viewMod?: string;
  includeCount?: boolean;
  includeForm?: boolean;
  includeBasic?: boolean;
  includeRows?: boolean;
  includePage?: boolean;
  includeList?: boolean;
  firstText?: string;
  prevText?: string;
} = {}): string {
  const bbsId = opts.bbsId ?? "1";
  const firstHref = opts.firstHref ?? `/index?d=notification1&search_page=1&bbs_id=${bbsId}`;
  const prevHref = opts.prevHref ?? `/index?d=notification1&search_page=10&bbs_id=${bbsId}`;
  const rowsInner = opts.rows ?? "\n\t\t";
  const rows = opts.includeRows === false ? "" : `<div class="rows">${rowsInner}</div>`;
  const basic = opts.includeBasic === false ? rows : `<div class="bbs-basic-list">${rows}</div>`;
  const page = opts.includePage === false
    ? ""
    : `<div class="page"><a href="${firstHref}">${opts.firstText ?? "&lt;&lt;"}</a> <a href="${prevHref}">${opts.prevText ?? "&lt;"}</a>${opts.extraLinks ?? ""}</div>`;
  const form = opts.includeForm === false
    ? `${basic}${page}`
    : `<form name="bbs_form" method="post">
        <input type="hidden" name="post_view_mod" value="${opts.viewMod ?? "list"}">
        <input type="hidden" name="bbs_id" value="${bbsId}">
        ${basic}${page}
      </form>`;
  const count = opts.includeCount === false
    ? ""
    : `<div class="r-count">총 <strong>${opts.total ?? "192"}</strong>건의 게시물이 있습니다.</div>`;
  if (opts.includeList === false) return `${count}${form}`;
  return `<div class="bbs-list">${count}${form}</div>`;
}

describe("isProvenAdditionalSourceEnd — 평택산업진흥원", () => {
  it("목록 안의 알 수 없는 텍스트와 페이지 호출을 무시하지 않는다", () => {
    expect(isProvenAdditionalSourceEnd(pipaEnd({ extraRows: "불러오는 중" }), pipaConfig, 12)).toBe(false);
    expect(isProvenAdditionalSourceEnd(pipaEnd().replace('fn_egov_link_page(1); return false;', 'unknownPage(1)'), pipaConfig, 12)).toBe(false);
  });
  it("관측된 12·13쪽 고정 공지와 빈 표식만 끝으로 본다", () => {
    const html = pipaEnd();
    expect(isProvenAdditionalSourceEnd(html, pipaConfig, 12)).toBe(true);
    expect(isProvenAdditionalSourceEnd(html, pipaConfig, 13)).toBe(true);
    expect(isProvenEmptyBoardPage(html, pipaConfig, 12)).toBe(true);
    expect(isProvenEmptyBoardPage('<form action="/login"><input type="password"></form>' + html, pipaConfig, 12)).toBe(false);
  });

  it("검색 폼이 있어도 관측된 끝 모양이면 끝이다", () => {
    const html = `<form action="/search"><input name="keyword"><button>검색</button></form>${pipaEnd()}`;
    expect(isProvenAdditionalSourceEnd(html, pipaConfig, 12)).toBe(true);
  });

  it("머리글의 로그인 링크만으로는 관측된 끝을 뒤집지 않는다", () => {
    const html = `<a href="/web/contents/webLogin.do"><span>로그인</span></a>${pipaEnd()}`;
    expect(isProvenAdditionalSourceEnd(html, pipaConfig, 12)).toBe(true);
  });

  it("요청 쪽이 표시된 마지막 쪽과 같거나 더 앞이면 끝이 아니다", () => {
    expect(isProvenAdditionalSourceEnd(pipaEnd(), pipaConfig, 11)).toBe(false);
    expect(isProvenAdditionalSourceEnd(pipaEnd(), pipaConfig, 1)).toBe(false);
  });

  it("고정 공지 반복만 있고 빈 표식이 없으면 끝이 아니다", () => {
    expect(isProvenAdditionalSourceEnd(pipaEnd({ notice: "" }), pipaConfig, 12)).toBe(false);
  });

  it("날짜 있는 일반 행이나 날짜 없는 정책 행이 있으면 끝이 아니다", () => {
    const dated = pipaEnd({ extraRows: pipaOrdinary("857", "참여기업 모집 공고", "2026-02-27") });
    const undated = pipaEnd({ extraRows: pipaOrdinary("857", "참여기업 모집 공고") });
    expect(isProvenAdditionalSourceEnd(dated, pipaConfig, 12)).toBe(false);
    expect(isProvenAdditionalSourceEnd(undated, pipaConfig, 12)).toBe(false);
  });

  it("고정 공지 행의 호출·제목이 깨지면 끝이 아니다", () => {
    const noNoticeArg = pipaEnd({
      includePinned: false,
      extraRows: pipaPinned("851", "안내책자 자료", "fn_goView('851')"),
    });
    const badId = pipaEnd({
      includePinned: false,
      extraRows: pipaPinned("x", "안내책자 자료", "fn_goView('abc', 'notice')"),
    });
    const emptyTitle = pipaEnd({
      includePinned: false,
      extraRows: pipaPinned("851", "   "),
    });
    const noLink = pipaEnd({
      includePinned: false,
      extraRows: `<li class="tr"><div class="board_num notice"><span>공지</span></div><div class="board_tit"><span>안내</span></div></li>`,
    });
    expect(isProvenAdditionalSourceEnd(noNoticeArg, pipaConfig, 12)).toBe(false);
    expect(isProvenAdditionalSourceEnd(badId, pipaConfig, 12)).toBe(false);
    expect(isProvenAdditionalSourceEnd(emptyTitle, pipaConfig, 12)).toBe(false);
    expect(isProvenAdditionalSourceEnd(noLink, pipaConfig, 12)).toBe(false);
  });

  it("마지막 쪽이 없거나 정수 형태가 아니면 끝이 아니다", () => {
    expect(isProvenAdditionalSourceEnd(pipaEnd({ last: "11.5" }), pipaConfig, 12)).toBe(false);
    expect(isProvenAdditionalSourceEnd(pipaEnd({ last: "0" }), pipaConfig, 12)).toBe(false);
    expect(isProvenAdditionalSourceEnd(
      pipaEnd().replace('class="last"', 'class="next"'),
      pipaConfig,
      12,
    )).toBe(false);
    expect(isProvenAdditionalSourceEnd(
      pipaEnd().replace("fn_egov_link_page(11)", "fn_egov_link_page('11')"),
      pipaConfig,
      12,
    )).toBe(false);
  });

  it("목록·쪽넘김 상자가 빠지면 끝이 아니다", () => {
    expect(isProvenAdditionalSourceEnd(pipaEnd({ includeTable: false }), pipaConfig, 12)).toBe(false);
    expect(isProvenAdditionalSourceEnd(pipaEnd({ includePaginate: false }), pipaConfig, 12)).toBe(false);
    expect(isProvenAdditionalSourceEnd(pipaEnd({ includeThead: false }), pipaConfig, 12)).toBe(false);
    expect(isProvenAdditionalSourceEnd(
      `<ul><li class="last"><a href="#none" onclick="fn_egov_link_page(11); return false;"></a></li></ul>${pipaEnd({ includePaginate: false })}`,
      pipaConfig,
      12,
    )).toBe(false);
  });

  it("1·2쪽 실측 고정본은 요청 12쪽이어도 끝이 아니다", () => {
    expect(isProvenAdditionalSourceEnd(pipaLive, pipaConfig, 12)).toBe(false);
    expect(isProvenAdditionalSourceEnd(pipaLiveP2, pipaConfig, 12)).toBe(false);
  });
});

describe("isProvenAdditionalSourceEnd — 광주신용보증재단", () => {
  it("같은 게시판 변수라도 다른 호스트·경로·프로토콜의 링크는 믿지 않는다", () => {
    for (const prevHref of [
      'https://example.org/index?d=notification1&search_page=10&bbs_id=1',
      '/other?d=notification1&search_page=10&bbs_id=1',
      'ftp://www.gjsinbo.or.kr/index?d=notification1&search_page=10&bbs_id=1',
    ]) expect(isProvenAdditionalSourceEnd(gjsinboEnd({ prevHref }), gjsinboConfig, 11)).toBe(false);
  });
  it("관측된 11·12쪽 빈 목록과 192건·이전 10쪽만 끝으로 본다", () => {
    const html = gjsinboEnd();
    expect(isProvenAdditionalSourceEnd(html, gjsinboConfig, 11)).toBe(true);
    expect(isProvenAdditionalSourceEnd(html, gjsinboConfig, 12)).toBe(true);
  });

  it("검색 폼이 있어도 관측된 끝 모양이면 끝이다", () => {
    const html = gjsinboEnd().replace(
      '<div class="bbs-list">',
      `<div class="bbs-list"><form name="formSrc" method="get"><input type="hidden" name="d" value="notification1"><input name="search_txt"><button>검색</button></form>`,
    );
    expect(isProvenAdditionalSourceEnd(html, gjsinboConfig, 11)).toBe(true);
  });

  it("요청 쪽이 마지막 쪽과 같거나 더 앞이면 끝이 아니다", () => {
    expect(isProvenAdditionalSourceEnd(gjsinboEnd(), gjsinboConfig, 10)).toBe(false);
    expect(isProvenAdditionalSourceEnd(gjsinboEnd(), gjsinboConfig, 1)).toBe(false);
  });

  it("건수·쪽 번호가 없거나 정수가 아니거나 1보다 작으면 끝이 아니다", () => {
    expect(isProvenAdditionalSourceEnd(gjsinboEnd({ includeCount: false }), gjsinboConfig, 11)).toBe(false);
    expect(isProvenAdditionalSourceEnd(gjsinboEnd({ total: "0" }), gjsinboConfig, 11)).toBe(false);
    expect(isProvenAdditionalSourceEnd(gjsinboEnd({ total: "-1" }), gjsinboConfig, 11)).toBe(false);
    expect(isProvenAdditionalSourceEnd(gjsinboEnd({ total: "192.5" }), gjsinboConfig, 11)).toBe(false);
    expect(isProvenAdditionalSourceEnd(gjsinboEnd({ total: "abc" }), gjsinboConfig, 11)).toBe(false);
    expect(isProvenAdditionalSourceEnd(gjsinboEnd({ total: "192건" }), gjsinboConfig, 11)).toBe(false);
  });

  it("이전 쪽이 없거나 계산된 마지막 쪽과 다르면 끝이 아니다", () => {
    expect(isProvenAdditionalSourceEnd(
      gjsinboEnd({ prevHref: "/index?d=notification1&search_page=9&bbs_id=1" }),
      gjsinboConfig,
      11,
    )).toBe(false);
    expect(isProvenAdditionalSourceEnd(
      gjsinboEnd({ prevHref: "/index?d=notification1&search_page=11&bbs_id=1" }),
      gjsinboConfig,
      12,
    )).toBe(false);
    expect(isProvenAdditionalSourceEnd(gjsinboEnd({ includePage: false }), gjsinboConfig, 11)).toBe(false);
    expect(isProvenAdditionalSourceEnd(
      gjsinboEnd({ firstHref: "/index?d=notification1&search_page=2&bbs_id=1" }),
      gjsinboConfig,
      11,
    )).toBe(false);
  });

  it("다른 게시판 주소나 숨은 값이 어긋나면 끝이 아니다", () => {
    expect(isProvenAdditionalSourceEnd(
      gjsinboEnd({ prevHref: "/index?d=notification3&search_page=10&bbs_id=1" }),
      gjsinboConfig,
      11,
    )).toBe(false);
    expect(isProvenAdditionalSourceEnd(gjsinboEnd({ bbsId: "2" }), gjsinboConfig, 11)).toBe(false);
    expect(isProvenAdditionalSourceEnd(gjsinboEnd({ viewMod: "view" }), gjsinboConfig, 11)).toBe(false);
    expect(isProvenAdditionalSourceEnd(
      gjsinboEnd({ extraLinks: `<a href="/index?d=notification1&search_page=10">10</a>` }),
      gjsinboConfig,
      11,
    )).toBe(false);
  });

  it("상자·폼·행 칸이 빠지거나 행이 있으면 끝이 아니다", () => {
    expect(isProvenAdditionalSourceEnd(gjsinboEnd({ includeList: false }), gjsinboConfig, 11)).toBe(false);
    expect(isProvenAdditionalSourceEnd(gjsinboEnd({ includeForm: false }), gjsinboConfig, 11)).toBe(false);
    expect(isProvenAdditionalSourceEnd(gjsinboEnd({ includeBasic: false }), gjsinboConfig, 11)).toBe(false);
    expect(isProvenAdditionalSourceEnd(gjsinboEnd({ includeRows: false }), gjsinboConfig, 11)).toBe(false);
    expect(isProvenAdditionalSourceEnd(gjsinboEnd({ rows: "비어 있지 않음" }), gjsinboConfig, 11)).toBe(false);
    expect(isProvenAdditionalSourceEnd(gjsinboEnd({
      rows: `<a class="row" href="/index?d=notification1&action=view&bbs_id=1&data_id=4366"><div class="row-title">2025 서구 소상공인 특례보증 지원사업</div></a>`,
    }), gjsinboConfig, 11)).toBe(false);
  });

  it("숨은 링크나 숨은 칸이 행 상자에 있으면 끝이 아니다", () => {
    expect(isProvenAdditionalSourceEnd(gjsinboEnd({
      rows: `<a class="row" style="display:none" href="/index?d=notification1&action=view&bbs_id=1&data_id=1"><div class="row-title">숨김</div></a>`,
    }), gjsinboConfig, 11)).toBe(false);
    expect(isProvenAdditionalSourceEnd(gjsinboEnd({
      rows: `<span style="display:none">x</span>`,
    }), gjsinboConfig, 11)).toBe(false);
    expect(isProvenAdditionalSourceEnd(gjsinboEnd({
      extraLinks: `<a href="/other" style="display:none">숨김</a>`,
    }), gjsinboConfig, 11)).toBe(false);
  });

  it("1·2쪽 실측 고정본은 요청 11쪽이어도 끝이 아니다", () => {
    expect(isProvenAdditionalSourceEnd(gjsinboLive, gjsinboConfig, 11)).toBe(false);
    expect(isProvenAdditionalSourceEnd(gjsinboLiveP2, gjsinboConfig, 11)).toBe(false);
  });
});

describe("isProvenAdditionalSourceEnd — 공통 거절", () => {
  it("다른 출처 설정이나 반대 출처 HTML은 끝이 아니다", () => {
    expect(isProvenAdditionalSourceEnd(pipaEnd(), gjsinboConfig, 12)).toBe(false);
    expect(isProvenAdditionalSourceEnd(gjsinboEnd(), pipaConfig, 11)).toBe(false);
    expect(isProvenAdditionalSourceEnd(pipaEnd(), otherConfig, 12)).toBe(false);
    expect(isProvenAdditionalSourceEnd(gjsinboEnd(), otherConfig, 11)).toBe(false);
  });

  it("쪽 번호가 없거나 정수가 아니거나 1보다 작으면 끝이 아니다", () => {
    expect(isProvenAdditionalSourceEnd(pipaEnd(), pipaConfig, 0)).toBe(false);
    expect(isProvenAdditionalSourceEnd(pipaEnd(), pipaConfig, -1)).toBe(false);
    expect(isProvenAdditionalSourceEnd(pipaEnd(), pipaConfig, 12.5)).toBe(false);
    expect(isProvenAdditionalSourceEnd(pipaEnd(), pipaConfig, Number.NaN)).toBe(false);
    expect(isProvenAdditionalSourceEnd(pipaEnd(), pipaConfig, Number.POSITIVE_INFINITY)).toBe(false);
    expect(isProvenAdditionalSourceEnd(gjsinboEnd(), gjsinboConfig, 11.2)).toBe(false);
    expect(isProvenAdditionalSourceEnd(pipaEnd(), pipaConfig, Number.MAX_SAFE_INTEGER + 1)).toBe(false);
  });

  it("바닥글·로그인·임의 빈 문구만 있으면 끝이 아니다", () => {
    expect(isProvenAdditionalSourceEnd(
      `<footer>등록된 게시물이 없습니다.</footer>`,
      pipaConfig,
      12,
    )).toBe(false);
    expect(isProvenAdditionalSourceEnd(
      `<form action="/login"><input type="password"><button>로그인</button></form>`,
      pipaConfig,
      12,
    )).toBe(false);
    expect(isProvenAdditionalSourceEnd(
      `<html><body>조회된 데이터가 없습니다.</body></html>`,
      gjsinboConfig,
      11,
    )).toBe(false);
    expect(isProvenAdditionalSourceEnd("", pipaConfig, 12)).toBe(false);
    expect(isProvenAdditionalSourceEnd("[]", gjsinboConfig, 11)).toBe(false);
  });
});


describe("추가 출처 끝 판정의 잘못된 호출·중복 구조", () => {
  it("고정 공지와 페이지 호출 앞뒤의 알 수 없는 코드를 거부한다", () => {
    for (const call of ["fn_goView('851', 'notice')", "fn_egov_link_page(1); return false;"]) {
      for (const mutated of [`unknown(); ${call}`, `${call}; unknown()`]) {
        expect(isProvenAdditionalSourceEnd(pipaEnd().replace(call, mutated), pipaConfig, 12)).toBe(false);
      }
    }
  });
  it("첫 행 상자가 비어 있어도 중복 행 상자의 내용을 무시하지 않는다", () => {
    const html = gjsinboEnd().replace('<div class="rows">', '<div class="rows"><span>불러오는 중</span></div><div class="rows">');
    const emptyFirst = gjsinboEnd().replace('<div class="bbs-basic-list">', '<div class="bbs-basic-list"><div class="rows"></div>');
    expect(isProvenAdditionalSourceEnd(html, gjsinboConfig, 11)).toBe(false);
    expect(isProvenAdditionalSourceEnd(emptyFirst, gjsinboConfig, 11)).toBe(false);
  });
  it("상세 동작과 중복 쿼리가 섞인 링크는 목록 쪽넘김 증거가 아니다", () => {
    for (const suffix of ['&action=view&data_id=7', '&d=notification3', '&bbs_id=2', '&search_page=99', '&search_page=10']) {
      const prevHref = '/index?d=notification1&search_page=10&bbs_id=1' + suffix;
      expect(isProvenAdditionalSourceEnd(gjsinboEnd({ prevHref }), gjsinboConfig, 11)).toBe(false);
    }
  });
});
