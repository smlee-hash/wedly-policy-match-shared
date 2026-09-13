import { parseHtml, type HTMLElement } from "./html";
import type { BoardConfig } from "./types";

/**
 * 김포산업진흥원·하남시 기업지원포털에서 관측된 마지막 쪽 너머 빈 응답만 인정한다.
 * 쪽 예산·반복 행·바닥글 문구·모호한 쪽넘김만으로는 끝이 아니다.
 * 최종 완료는 기존 연속 두 쪽 규칙이 맡는다.
 */
const GOPA_PAGE_SIZE = 6;
const GOPA_EMPTY = /^검색된내용이없습니다\.?$/;
const HANAM_PAGE_SIZE = 10;
const HANAM_EMPTY = /^등록된게시물이없습니다\.?$/;
const HANAM_LIST_PATH = "/biz/selectBbsNttList.do";
const HANAM_QUERY = {
  key: "6003",
  bbsNo: "1632",
  searchCtgry: "",
  pageUnit: "10",
  searchCnd: "all",
  searchKrwd: "",
  integrDeptCode: "",
  selectPageUnit: "",
} as const;
const HANAM_QUERY_KEYS = new Set([...Object.keys(HANAM_QUERY), "pageIndex"]);

function isPositiveSafeInt(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function parsePositiveSafeIntText(text: string): number | null {
  const trimmed = text.trim();
  if (!/^[1-9]\d*$/.test(trimmed)) return null;
  const n = Number(trimmed);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

function lastPageOf(total: number, pageSize: number): number {
  return Math.floor((total + pageSize - 1) / pageSize);
}

function classTokens(el: HTMLElement): string[] {
  return (el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean);
}

function elementChildren(el: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (const node of el.childNodes) {
    if (node.nodeType === 1) out.push(node as HTMLElement);
  }
  return out;
}

function tagNameOf(el: HTMLElement): string {
  return el.tagName.toLowerCase();
}

function compactText(el: HTMLElement): string {
  return el.text.replace(/\s+/g, "");
}

function hasUnexpectedDirectContent(el: HTMLElement): boolean {
  for (const node of el.childNodes) {
    if (node.nodeType === 1) continue;
    if (node.nodeType === 3 && node.text.trim() === "") continue;
    return true;
  }
  return false;
}

function hasAnnouncementLink(node: HTMLElement): boolean {
  return Boolean(node.querySelector("a"));
}

function isUnder(el: HTMLElement, ancestor: HTMLElement): boolean {
  let cur: unknown = el.parentNode;
  while (cur) {
    if (cur === ancestor) return true;
    cur = (cur as { parentNode?: unknown }).parentNode;
  }
  return false;
}

function uniqueQueryMap(url: URL): Map<string, string> | null {
  const map = new Map<string, string>();
  for (const [key, value] of url.searchParams) {
    if (map.has(key)) return null;
    map.set(key, value);
  }
  return map;
}

function isGopaProvenEnd(html: string, requestedPage: number): boolean {
  const root = parseHtml(html);
  const lists = root.querySelectorAll("div.list.list2");
  if (lists.length !== 1) return false;
  const list = lists[0]!;
  if (hasAnnouncementLink(list) || hasUnexpectedDirectContent(list)) return false;

  const kids = elementChildren(list);
  if (kids.length !== 2) return false;
  const tot = kids[0]!;
  const ul = kids[1]!;
  if (tagNameOf(tot) !== "div" || !classTokens(tot).includes("tot")) return false;
  if (tagNameOf(ul) !== "ul" || hasUnexpectedDirectContent(ul)) return false;

  const spans = tot.querySelectorAll("strong span");
  if (spans.length !== 1) return false;
  const total = parsePositiveSafeIntText(spans[0]!.text);
  if (total === null) return false;
  const last = lastPageOf(total, GOPA_PAGE_SIZE);
  if (!isPositiveSafeInt(last) || requestedPage <= last) return false;

  const rows = elementChildren(ul);
  if (rows.length !== 1 || tagNameOf(rows[0]!) !== "li") return false;
  return GOPA_EMPTY.test(compactText(rows[0]!));
}

function isHanamEmptyContainer(empty: HTMLElement): boolean {
  if (hasAnnouncementLink(empty) || hasUnexpectedDirectContent(empty)) return false;
  const emptyKids = elementChildren(empty);
  if (emptyKids.length !== 1) return false;
  const box = emptyKids[0]!;
  if (tagNameOf(box) !== "div" || !classTokens(box).includes("p-empty_box") || hasUnexpectedDirectContent(box)) {
    return false;
  }
  const boxKids = elementChildren(box);
  if (boxKids.length !== 1) return false;
  const text = boxKids[0]!;
  if (tagNameOf(text) !== "div" || !classTokens(text).includes("p-empty_text")) return false;
  if (!HANAM_EMPTY.test(compactText(text))) return false;
  for (const inner of elementChildren(text)) {
    if (tagNameOf(inner) !== "span" || !classTokens(inner).includes("p-empty_word")) return false;
  }
  return true;
}

function hanamListPageIndex(href: string, cfg: BoardConfig): number | null {
  const raw = href.trim();
  if (!raw || raw === "#" || /^javascript:/i.test(raw)) return null;
  let url: URL;
  try {
    url = new URL(raw, cfg.baseUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.hash) return null;
  let origin: string;
  try {
    origin = new URL(cfg.baseUrl).origin;
  } catch {
    return null;
  }
  if (url.origin !== origin || url.pathname !== HANAM_LIST_PATH) return null;
  const map = uniqueQueryMap(url);
  if (!map || map.size !== HANAM_QUERY_KEYS.size) return null;
  for (const key of HANAM_QUERY_KEYS) {
    if (!map.has(key)) return null;
  }
  for (const [key, expected] of Object.entries(HANAM_QUERY)) {
    if (map.get(key) !== expected) return null;
  }
  return parsePositiveSafeIntText(map.get("pageIndex") ?? "");
}

function isHanamPagination(
  pagination: HTMLElement,
  cfg: BoardConfig,
  last: number,
  current: number,
): boolean {
  const groups = pagination.querySelectorAll(".p-page__link-group");
  if (groups.length !== 1) return false;
  const group = groups[0]!;
  const numericSeen = new Set<number>();
  let sawNumeric = false;
  for (const kid of elementChildren(group)) {
    if (!classTokens(kid).includes("p-page__link")) return false;
    const tag = tagNameOf(kid);
    if (tag === "strong") {
      const n = parsePositiveSafeIntText(kid.text);
      if (n === null || n !== current || kid.querySelector("a")) return false;
      continue;
    }
    if (tag !== "a") return false;
    const page = hanamListPageIndex(kid.getAttribute("href") ?? "", cfg);
    const label = parsePositiveSafeIntText(compactText(kid));
    if (page === null || label === null || page !== label || page > last || numericSeen.has(page)) {
      return false;
    }
    numericSeen.add(page);
    sawNumeric = true;
  }
  if (!sawNumeric) return false;

  let sawFirst = false;
  let sawLast = false;
  for (const a of pagination.querySelectorAll("a")) {
    if (isUnder(a, group)) continue;
    const tokens = classTokens(a);
    if (!tokens.includes("p-page__link")) return false;
    const page = hanamListPageIndex(a.getAttribute("href") ?? "", cfg);
    if (page === null) return false;
    if (tokens.includes("prev-end")) {
      if (page !== 1) return false;
      sawFirst = true;
    } else if (tokens.includes("next-end")) {
      if (page !== last) return false;
      sawLast = true;
    } else if (
      tokens.includes("prev-one") ||
      tokens.includes("next-one") ||
      tokens.includes("prev") ||
      tokens.includes("next")
    ) {
      continue;
    } else {
      return false;
    }
  }
  return sawFirst && sawLast;
}

function isHanamProvenEnd(html: string, cfg: BoardConfig, requestedPage: number): boolean {
  const root = parseHtml(html);
  if (root.querySelectorAll("table.p-table.simple").length !== 0) return false;
  const empties = root.querySelectorAll("div.p-empty.nofile");
  if (empties.length !== 1 || !isHanamEmptyContainer(empties[0]!)) return false;

  const counts = root.querySelectorAll(".p-page .count");
  if (counts.length !== 1) return false;
  const ems = counts[0]!.querySelectorAll("em.em_count");
  if (ems.length !== 2) return false;
  const total = parsePositiveSafeIntText(ems[0]!.text);
  const position = ems[1]!.text.trim().match(/^([1-9]\d*)\/([1-9]\d*)$/);
  if (total === null || !position) return false;
  const current = parsePositiveSafeIntText(position[1] ?? "");
  const last = parsePositiveSafeIntText(position[2] ?? "");
  if (current === null || last === null) return false;
  if (current !== requestedPage || current <= last) return false;
  if (last !== lastPageOf(total, HANAM_PAGE_SIZE)) return false;

  const paginations = root.querySelectorAll(".p-pagination");
  if (paginations.length !== 1) return false;
  return isHanamPagination(paginations[0]!, cfg, last, current);
}

export function isProvenMunicipalEnd(
  html: string,
  cfg: BoardConfig,
  requestedPage?: number,
): boolean {
  if (!isPositiveSafeInt(requestedPage)) return false;
  try {
    if (cfg.id === "gopa") return isGopaProvenEnd(html, requestedPage);
    if (cfg.id === "hanam") return isHanamProvenEnd(html, cfg, requestedPage);
    return false;
  } catch {
    return false;
  }
}
