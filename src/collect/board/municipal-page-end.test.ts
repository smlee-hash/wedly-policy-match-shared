import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isProvenMunicipalEnd } from "./municipal-page-end";
import { gopaConfig } from "./sources/gopa";
import { hanamConfig } from "./sources/hanam";
import type { BoardConfig } from "./types";

const gopaLive = readFileSync(join(__dirname, "__fixtures__/gopa-list.html"), "utf-8");
const hanamLive = readFileSync(join(__dirname, "__fixtures__/hanam-list.html"), "utf-8");

const otherConfig: BoardConfig = {
  ...gopaConfig,
  id: "kotra",
};

function gopaEnd(opts: {
  total?: string;
  extraLi?: string;
  extraList?: string;
  emptyText?: string;
  includeList?: boolean;
  includeTot?: boolean;
  includeUl?: boolean;
  extraTotSpan?: string;
} = {}): string {
  const tot = opts.includeTot === false
    ? ""
    : `<div class="tot"><strong>총 <span>${opts.total ?? "100"}</span>개의 게시물 검색${opts.extraTotSpan ?? ""}</strong></div>`;
  const empty = `<li>${opts.emptyText ?? "검색된 내용이 없습니다."}</li>`;
  const ul = opts.includeUl === false
    ? ""
    : `<ul>${empty}${opts.extraLi ?? ""}</ul>`;
  if (opts.includeList === false) return `${tot}${ul}${opts.extraList ?? ""}`;
  return `<div class="list list2">${tot}${ul}${opts.extraList ?? ""}</div>`;
}

function hanamHref(pageIndex: number, query: {
  extra?: string;
  pageUnit?: string;
  searchKrwd?: string;
  path?: string;
  origin?: string;
} = {}): string {
  const pageUnit = query.pageUnit ?? "10";
  const searchKrwd = query.searchKrwd ?? "";
  const path = query.path ?? "./selectBbsNttList.do";
  const origin = query.origin ?? "";
  return `${origin}${path}?key=6003&bbsNo=1632&searchCtgry=&pageUnit=${pageUnit}&searchCnd=all&searchKrwd=${searchKrwd}&integrDeptCode=&selectPageUnit=&pageIndex=${pageIndex}${query.extra ?? ""}`;
}

function hanamEnd(opts: {
  page?: number;
  total?: string;
  currentLast?: string;
  includeTable?: boolean;
  includeEmpty?: boolean;
  includeCount?: boolean;
  includePagination?: boolean;
  includeGroup?: boolean;
  includeFirst?: boolean;
  includeLast?: boolean;
  includePrevOne?: boolean;
  emptyInner?: string;
  extraEmpty?: string;
  extraCountEm?: string;
  extraGroup?: string;
  extraNav?: string;
  extraQuery?: string;
  firstHref?: string;
  lastHref?: string;
  prevOneHref?: string;
  numericPages?: number[];
  pageUnit?: string;
  searchKrwd?: string;
  path?: string;
  origin?: string;
  duplicateEmpty?: boolean;
  duplicateCount?: boolean;
  duplicatePagination?: boolean;
} = {}): string {
  const page = opts.page ?? 18;
  const total = opts.total ?? "162";
  const totalNum = Number(total);
  const last = Number.isSafeInteger(totalNum) && totalNum > 0
    ? Math.floor((totalNum + 9) / 10)
    : 17;
  const currentLast = opts.currentLast ?? `${page}/${last}`;
  const hrefOpts = {
    extra: opts.extraQuery,
    pageUnit: opts.pageUnit,
    searchKrwd: opts.searchKrwd,
    path: opts.path,
    origin: opts.origin,
  };
  const emptyInner = opts.emptyInner ?? `등록된 <span class="p-empty_word">게시물</span>이 없습니다.`;
  const empty = opts.includeEmpty === false
    ? ""
    : `<div class="p-empty nofile"><div class="p-empty_box"><div class="p-empty_text">${emptyInner}</div></div></div>`;
  const duplicateEmpty = opts.duplicateEmpty
    ? `<div class="p-empty nofile"><div class="p-empty_box"><div class="p-empty_text">등록된 게시물이 없습니다.</div></div></div>`
    : "";
  const table = opts.includeTable
    ? `<table class="p-table simple"><tbody class="text_center"><tr><td class="text_left"><a href="./selectBbsNttView.do?key=6003&bbsNo=1632&nttNo=1">날짜 없는 공고</a></td><td class="last"></td></tr></tbody></table>`
    : "";
  const countInner = `<div class="count">총게시물 <em class="em_count">${total}</em>건 페이지 : <em class="em_count">${currentLast}</em>${opts.extraCountEm ?? ""}</div>`;
  const count = opts.includeCount === false
    ? ""
    : `<div class="p-page">${countInner}${opts.duplicateCount ? countInner : ""}</div>`;
  const numericPages = opts.numericPages ?? (last >= 11
    ? Array.from({ length: last - 10 }, (_, i) => i + 11)
    : Array.from({ length: last }, (_, i) => i + 1));
  const group = opts.includeGroup === false
    ? ""
    : `<div class="p-page__link-group">${numericPages.map((n) =>
      `<a href="${hanamHref(n, hrefOpts)}" title="${n}페이지 이동" class="p-page__link">${n}</a>`,
    ).join("")}<strong title="현재 ${page}페이지" class="p-page__link active">${page}</strong>${opts.extraGroup ?? ""}</div>`;
  const first = opts.includeFirst === false
    ? ""
    : `<a href="${opts.firstHref ?? hanamHref(1, hrefOpts)}" class="p-page__link prev-end"><span class="skip">처음 페이지</span></a>`;
  const prev = `<a href="${hanamHref(11, hrefOpts)}" class="p-page__link prev"><span class="skip">이전 10 페이지</span></a>`;
  const prevOne = opts.includePrevOne === false
    ? ""
    : `<a href="${opts.prevOneHref ?? hanamHref(page - 1, hrefOpts)}" class="p-page__link prev-one">이전 페이지</a>`;
  const nextOne = `<a href="${hanamHref(page + 1, hrefOpts)}" class="p-page__link next-one">다음 페이지</a>`;
  const next = `<a href="${hanamHref(21, hrefOpts)}" class="p-page__link next"><span class="skip">다음 10 페이지</span></a>`;
  const lastLink = opts.includeLast === false
    ? ""
    : `<a href="${opts.lastHref ?? hanamHref(last, hrefOpts)}" class="p-page__link next-end"><span class="skip">끝 페이지</span></a>`;
  const paginationInner = `<div class="p-page__control">${first}${prev}${prevOne}</div>${group}<div class="p-page__control">${nextOne}${next}${lastLink}</div>${opts.extraNav ?? ""}`;
  const pagination = opts.includePagination === false
    ? ""
    : `<div class="p-pagination">${paginationInner}</div>`;
  const duplicatePagination = opts.duplicatePagination
    ? `<div class="p-pagination">${paginationInner}</div>`
    : "";
  return `${count}${table}${empty}${opts.extraEmpty ?? ""}${duplicateEmpty}${pagination}${duplicatePagination}`;
}

describe("isProvenMunicipalEnd — 김포산업진흥원", () => {
  it("관측된 18·19쪽 빈 목록과 총 100건만 끝으로 본다", () => {
    const html = gopaEnd();
    expect(isProvenMunicipalEnd(html, gopaConfig, 18)).toBe(true);
    expect(isProvenMunicipalEnd(html, gopaConfig, 19)).toBe(true);
  });

  it("요청 쪽이 마지막 쪽과 같거나 더 앞이면 끝이 아니다", () => {
    expect(isProvenMunicipalEnd(gopaEnd(), gopaConfig, 17)).toBe(false);
    expect(isProvenMunicipalEnd(gopaEnd(), gopaConfig, 1)).toBe(false);
  });

  it("건수가 없거나 0·음수·소수이면 끝이 아니다", () => {
    expect(isProvenMunicipalEnd(gopaEnd({ includeTot: false }), gopaConfig, 18)).toBe(false);
    expect(isProvenMunicipalEnd(gopaEnd({ total: "0" }), gopaConfig, 18)).toBe(false);
    expect(isProvenMunicipalEnd(gopaEnd({ total: "-1" }), gopaConfig, 18)).toBe(false);
    expect(isProvenMunicipalEnd(gopaEnd({ total: "100.5" }), gopaConfig, 18)).toBe(false);
    expect(isProvenMunicipalEnd(gopaEnd({ total: "100개" }), gopaConfig, 18)).toBe(false);
  });

  it("총건수가 바뀌어 마지막 쪽이 요청 쪽 이상이면 끝이 아니다", () => {
    expect(isProvenMunicipalEnd(gopaEnd({ total: "108" }), gopaConfig, 18)).toBe(false);
    expect(isProvenMunicipalEnd(gopaEnd({ total: "96" }), gopaConfig, 16)).toBe(false);
  });

  it("빈 표식이 없거나 공고 링크·날짜 없는 행·알 수 없는 칸이 있으면 끝이 아니다", () => {
    expect(isProvenMunicipalEnd(gopaEnd({ emptyText: "" }), gopaConfig, 18)).toBe(false);
    expect(isProvenMunicipalEnd(gopaEnd({
      extraLi: `<li class="end"><a href="view.html?idx=113&curpage=18"><div class="txt"><strong>날짜 없는 공고</strong></div></a></li>`,
    }), gopaConfig, 18)).toBe(false);
    expect(isProvenMunicipalEnd(gopaEnd({
      extraLi: `<li>불러오는 중</li>`,
    }), gopaConfig, 18)).toBe(false);
    expect(isProvenMunicipalEnd(gopaEnd({ extraList: "불러오는 중" }), gopaConfig, 18)).toBe(false);
    expect(isProvenMunicipalEnd(gopaEnd({ extraList: "<div>안내</div>" }), gopaConfig, 18)).toBe(false);
  });

  it("목록 상자나 쪽 번호가 없거나 중복 건수면 끝이 아니다", () => {
    expect(isProvenMunicipalEnd(gopaEnd({ includeList: false }), gopaConfig, 18)).toBe(false);
    expect(isProvenMunicipalEnd(gopaEnd({ includeUl: false }), gopaConfig, 18)).toBe(false);
    expect(isProvenMunicipalEnd(gopaEnd({ extraTotSpan: "<span>100</span>" }), gopaConfig, 18)).toBe(false);
    expect(isProvenMunicipalEnd(
      gopaEnd() + gopaEnd(),
      gopaConfig,
      18,
    )).toBe(false);
  });

  it("1쪽 실측 고정본은 요청 18쪽이어도 끝이 아니다", () => {
    expect(isProvenMunicipalEnd(gopaLive, gopaConfig, 18)).toBe(false);
  });
});

describe("isProvenMunicipalEnd — 하남시 기업지원포털", () => {
  it("관측된 18·19쪽 빈 안내와 162건·17쪽 링크만 끝으로 본다", () => {
    expect(isProvenMunicipalEnd(hanamEnd(), hanamConfig, 18)).toBe(true);
    expect(isProvenMunicipalEnd(hanamEnd({ page: 19 }), hanamConfig, 19)).toBe(true);
  });

  it("19쪽의 이전 한 쪽이 마지막을 넘어도 숫자 칸과 첫 링크만으로 끝이다", () => {
    expect(isProvenMunicipalEnd(hanamEnd({
      page: 19,
      prevOneHref: hanamHref(18),
    }), hanamConfig, 19)).toBe(true);
  });

  it("머리글에 다른 메뉴 주소가 있어도 관측된 빈 쪽이면 끝이다", () => {
    const html = `<a href="/biz/selectEntrprsSportBsnsApiList.do?key=5986">지원사업</a>${hanamEnd()}`;
    expect(isProvenMunicipalEnd(html, hanamConfig, 18)).toBe(true);
  });

  it("요청 쪽이 표시된 현재 쪽과 다르거나 마지막 쪽 이하이면 끝이 아니다", () => {
    expect(isProvenMunicipalEnd(hanamEnd(), hanamConfig, 19)).toBe(false);
    expect(isProvenMunicipalEnd(hanamEnd(), hanamConfig, 17)).toBe(false);
    expect(isProvenMunicipalEnd(hanamEnd({ currentLast: "17/17" }), hanamConfig, 17)).toBe(false);
    expect(isProvenMunicipalEnd(hanamEnd({ page: 17, currentLast: "17/17" }), hanamConfig, 17)).toBe(false);
  });

  it("건수·쪽 번호가 없거나 0·음수·소수이거나 서로 모순이면 끝이 아니다", () => {
    expect(isProvenMunicipalEnd(hanamEnd({ includeCount: false }), hanamConfig, 18)).toBe(false);
    expect(isProvenMunicipalEnd(hanamEnd({ total: "0" }), hanamConfig, 18)).toBe(false);
    expect(isProvenMunicipalEnd(hanamEnd({ total: "-1" }), hanamConfig, 18)).toBe(false);
    expect(isProvenMunicipalEnd(hanamEnd({ total: "162.5" }), hanamConfig, 18)).toBe(false);
    expect(isProvenMunicipalEnd(hanamEnd({ currentLast: "18/17.5" }), hanamConfig, 18)).toBe(false);
    expect(isProvenMunicipalEnd(hanamEnd({ currentLast: "18/16" }), hanamConfig, 18)).toBe(false);
    expect(isProvenMunicipalEnd(hanamEnd({ extraCountEm: `<em class="em_count">18/17</em>` }), hanamConfig, 18)).toBe(false);
    expect(isProvenMunicipalEnd(hanamEnd({ duplicateCount: true }), hanamConfig, 18)).toBe(false);
  });

  it("표준 표가 있거나 빈 칸이 없거나 중복·링크가 있으면 끝이 아니다", () => {
    expect(isProvenMunicipalEnd(hanamEnd({ includeTable: true }), hanamConfig, 18)).toBe(false);
    expect(isProvenMunicipalEnd(hanamEnd({ includeEmpty: false }), hanamConfig, 18)).toBe(false);
    expect(isProvenMunicipalEnd(hanamEnd({ duplicateEmpty: true }), hanamConfig, 18)).toBe(false);
    expect(isProvenMunicipalEnd(hanamEnd({
      extraEmpty: `<div class="p-empty nofile"><div class="p-empty_box"><div class="p-empty_text">등록된 게시물이 없습니다.</div></div></div>`,
    }), hanamConfig, 18)).toBe(false);
    expect(isProvenMunicipalEnd(hanamEnd({
      emptyInner: `등록된 <a href="./selectBbsNttView.do?key=6003&bbsNo=1632&nttNo=1">게시물</a>이 없습니다.`,
    }), hanamConfig, 18)).toBe(false);
    expect(isProvenMunicipalEnd(hanamEnd({
      emptyInner: `등록된 게시물이 없습니다.<span>공고</span>`,
    }), hanamConfig, 18)).toBe(false);
  });

  it("쪽넘김이 없거나 첫 링크·마지막 링크·숫자 칸이 관측과 다르면 끝이 아니다", () => {
    expect(isProvenMunicipalEnd(hanamEnd({ includePagination: false }), hanamConfig, 18)).toBe(false);
    expect(isProvenMunicipalEnd(hanamEnd({ includeFirst: false }), hanamConfig, 18)).toBe(false);
    expect(isProvenMunicipalEnd(hanamEnd({ includeLast: false }), hanamConfig, 18)).toBe(false);
    expect(isProvenMunicipalEnd(hanamEnd({ includeGroup: false }), hanamConfig, 18)).toBe(false);
    expect(isProvenMunicipalEnd(hanamEnd({ firstHref: hanamHref(2) }), hanamConfig, 18)).toBe(false);
    expect(isProvenMunicipalEnd(hanamEnd({ lastHref: hanamHref(16) }), hanamConfig, 18)).toBe(false);
    expect(isProvenMunicipalEnd(hanamEnd({ numericPages: [11, 18] }), hanamConfig, 18)).toBe(false);
    expect(isProvenMunicipalEnd(hanamEnd({ duplicatePagination: true }), hanamConfig, 18)).toBe(false);
  });

  it("다른 호스트·경로·보기 주소·중복 인자·검색어·쪽 단위는 믿지 않는다", () => {
    expect(isProvenMunicipalEnd(hanamEnd({
      origin: "https://example.org",
      path: "/biz/selectBbsNttList.do",
    }), hanamConfig, 18)).toBe(false);
    expect(isProvenMunicipalEnd(hanamEnd({
      origin: "http://www.hanam.go.kr",
      path: "/biz/selectBbsNttList.do",
    }), hanamConfig, 18)).toBe(false);
    expect(isProvenMunicipalEnd(hanamEnd({ path: "/biz/selectBbsNttView.do" }), hanamConfig, 18)).toBe(false);
    expect(isProvenMunicipalEnd(hanamEnd({ extraQuery: "&pageIndex=1" }), hanamConfig, 18)).toBe(false);
    expect(isProvenMunicipalEnd(hanamEnd({ extraQuery: "&nttNo=1" }), hanamConfig, 18)).toBe(false);
    expect(isProvenMunicipalEnd(hanamEnd({ searchKrwd: "지원" }), hanamConfig, 18)).toBe(false);
    expect(isProvenMunicipalEnd(hanamEnd({ pageUnit: "20" }), hanamConfig, 18)).toBe(false);
  });

  it("알 수 없는 쪽넘김 모양이면 끝이 아니다", () => {
    expect(isProvenMunicipalEnd(hanamEnd({
      extraNav: `<a href="${hanamHref(1)}" class="p-page__link jump">건너뛰기</a>`,
    }), hanamConfig, 18)).toBe(false);
    expect(isProvenMunicipalEnd(hanamEnd({
      extraGroup: `<div>17</div>`,
    }), hanamConfig, 18)).toBe(false);
    expect(isProvenMunicipalEnd(hanamEnd({
      firstHref: "javascript:;",
    }), hanamConfig, 18)).toBe(false);
  });

  it("1쪽 실측 고정본은 요청 18쪽이어도 끝이 아니다", () => {
    expect(isProvenMunicipalEnd(hanamLive, hanamConfig, 18)).toBe(false);
  });
});

describe("isProvenMunicipalEnd — 공통 거절", () => {
  it("다른 출처 설정이나 반대 출처 HTML은 끝이 아니다", () => {
    expect(isProvenMunicipalEnd(gopaEnd(), hanamConfig, 18)).toBe(false);
    expect(isProvenMunicipalEnd(hanamEnd(), gopaConfig, 18)).toBe(false);
    expect(isProvenMunicipalEnd(gopaEnd(), otherConfig, 18)).toBe(false);
    expect(isProvenMunicipalEnd(hanamEnd(), otherConfig, 18)).toBe(false);
    expect(isProvenMunicipalEnd(gopaEnd(), { ...gopaConfig, id: "hanam" }, 18)).toBe(false);
    expect(isProvenMunicipalEnd(hanamEnd(), { ...hanamConfig, id: "gopa" }, 18)).toBe(false);
  });

  it("쪽 번호가 없거나 정수가 아니거나 1보다 작으면 끝이 아니다", () => {
    for (const page of [undefined, 0, -1, 18.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
      expect(isProvenMunicipalEnd(gopaEnd(), gopaConfig, page)).toBe(false);
      expect(isProvenMunicipalEnd(hanamEnd(), hanamConfig, page)).toBe(false);
    }
  });

  it("바닥글·로그인·임의 빈 문구만 있으면 끝이 아니다", () => {
    expect(isProvenMunicipalEnd(
      `<footer>검색된 내용이 없습니다. 등록된 게시물이 없습니다. 162 18/17</footer>`,
      gopaConfig,
      18,
    )).toBe(false);
    expect(isProvenMunicipalEnd(
      `<footer>등록된 게시물이 없습니다.</footer>`,
      hanamConfig,
      18,
    )).toBe(false);
    expect(isProvenMunicipalEnd(
      `<form action="/login"><input type="password"><button>로그인</button></form>`,
      gopaConfig,
      18,
    )).toBe(false);
    expect(isProvenMunicipalEnd("", hanamConfig, 18)).toBe(false);
    expect(isProvenMunicipalEnd("[]", gopaConfig, 18)).toBe(false);
  });
});
