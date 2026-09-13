import { parseHtml, type HTMLElement } from "./html";
import type { BoardConfig } from "./types";

/**
 * 평택산업진흥원·광주신용보증재단의 관측된 마지막 쪽 너머 응답만 인정한다.
 * 일반 행·날짜 없는 정책 행·고정 공지 반복만으로는 끝이 아니다.
 * 최종 완료는 기존 연속 두 쪽 규칙이 맡는다.
 */
const PIPA_PINNED_CALL = /^\s*fn_goView\(\s*'(\d+)\s*'\s*,\s*'notice'\s*\)\s*(?:;\s*return\s+false\s*)?;?\s*$/;
const PIPA_PAGE_CALL = /^\s*fn_egov_link_page\(\s*([1-9]\d*)\s*\)\s*(?:;\s*return\s+false\s*)?;?\s*$/;
const PIPA_EMPTY_NOTICE = /^등록된게시물이없습니다\.?$/;
const GJSINBO_PAGE_SIZE = 20;
const GJSINBO_BOARD = "notification1";
const GJSINBO_BBS_ID = "1";

function isPositiveSafeInt(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function parsePositiveSafeIntText(text: string): number | null {
  const trimmed = text.trim();
  if (!/^[1-9]\d*$/.test(trimmed)) return null;
  const n = Number(trimmed);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
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

function namedForm(root: HTMLElement, name: string): HTMLElement | null {
  for (const form of root.querySelectorAll("form")) {
    if ((form.getAttribute("name") ?? "") === name) return form;
  }
  return null;
}

function hiddenInputValue(form: HTMLElement, name: string): string | null {
  for (const input of form.querySelectorAll("input")) {
    if ((input.getAttribute("name") ?? "") !== name) continue;
    if ((input.getAttribute("type") ?? "").toLowerCase() !== "hidden") continue;
    return input.getAttribute("value") ?? "";
  }
  return null;
}

function directRows(parent: HTMLElement): HTMLElement[] {
  return elementChildren(parent).filter(
    (kid) => tagNameOf(kid) === "div" && classTokens(kid).includes("rows"),
  );
}

function isPipaThead(li: HTMLElement): boolean {
  if (tagNameOf(li) !== "li") return false;
  const tokens = classTokens(li);
  return tokens.includes("tr") && tokens.includes("thead");
}

function isPipaPinnedRow(li: HTMLElement): boolean {
  if (tagNameOf(li) !== "li") return false;
  const tokens = classTokens(li);
  if (!tokens.includes("tr") || tokens.includes("thead")) return false;
  const num = li.querySelector("div.board_num");
  if (!num || !classTokens(num).includes("notice")) return false;
  const a = li.querySelector("div.board_tit a");
  const call = a?.getAttribute("onclick") ?? "";
  if (!PIPA_PINNED_CALL.test(call)) return false;
  const title = (a?.text ?? "").replace(/\s+/g, " ").trim();
  return title.length > 0;
}

function isPipaEmptyNotice(el: HTMLElement): boolean {
  if (tagNameOf(el) !== "div") return false;
  if (el.querySelector("a")) return false;
  return PIPA_EMPTY_NOTICE.test(compactText(el));
}

function looksLikeFirstPageLink(text: string): boolean {
  return text === "<<" || text === "«" || text === "처음" || text === "&lt;&lt;" || text === "&lt&lt";
}

function looksLikePreviousPageLink(text: string): boolean {
  if (looksLikeFirstPageLink(text)) return false;
  return text === "<" || text === "‹" || text === "이전" || text === "&lt;" || text === "&lt";
}

function gjsinboPageFromHref(href: string, baseUrl: string): number | null {
  const raw = href.trim();
  if (!raw || raw === "#" || /^javascript:/i.test(raw)) return null;
  let url: URL;
  try {
    url = new URL(raw, baseUrl || "https://www.gjsinbo.or.kr/");
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.origin !== new URL(baseUrl).origin || url.pathname !== "/index") return null;
  const keys = Array.from(url.searchParams.keys());
  if (keys.length !== 3 || keys.some(key => !["d", "search_page", "bbs_id"].includes(key))) return null;
  if (url.searchParams.getAll("d").length !== 1) return null;
  if (url.searchParams.getAll("search_page").length !== 1) return null;
  if (url.searchParams.getAll("bbs_id").length !== 1) return null;
  if (url.searchParams.get("d") !== GJSINBO_BOARD) return null;
  if (url.searchParams.get("bbs_id") !== GJSINBO_BBS_ID) return null;
  return parsePositiveSafeIntText(url.searchParams.get("search_page") ?? "");
}

function isStrictlyEmpty(el: HTMLElement): boolean {
  for (const node of el.childNodes) {
    if (node.nodeType === 1) return false;
    if (node.nodeType === 3 && node.text.trim() !== "") return false;
  }
  return true;
}

function isPipaProvenEnd(html: string, requestedPage: number): boolean {
  const root = parseHtml(html);
  const table = root.querySelector("ul.table");
  const paginate = root.querySelector(".paginate");
  if (!table || !paginate) return false;
  if (table.childNodes.some(node => node.nodeType !== 1 && node.text.trim())) return false;

  const lastA = paginate.querySelector("li.last a");
  const lastMatch = (lastA?.getAttribute("onclick") ?? "").match(PIPA_PAGE_CALL);
  if (!lastMatch) return false;
  const lastPage = parsePositiveSafeIntText(lastMatch[1] ?? "");
  if (lastPage === null || requestedPage <= lastPage) return false;

  let sawPageCall = false;
  for (const a of paginate.querySelectorAll("a")) {
    const match = (a.getAttribute("onclick") ?? "").match(PIPA_PAGE_CALL);
    if (!match) return false;
    const n = parsePositiveSafeIntText(match[1] ?? "");
    if (n === null || n > lastPage) return false;
    sawPageCall = true;
  }
  if (!sawPageCall) return false;

  let thead = 0;
  let pinned = 0;
  let emptyNotice = 0;
  for (const kid of elementChildren(table)) {
    if (isPipaThead(kid)) {
      thead += 1;
      continue;
    }
    if (isPipaPinnedRow(kid)) {
      pinned += 1;
      continue;
    }
    if (isPipaEmptyNotice(kid)) {
      emptyNotice += 1;
      continue;
    }
    return false;
  }
  return thead >= 1 && pinned >= 1 && emptyNotice === 1;
}

function isGjsinboProvenEnd(html: string, cfg: BoardConfig, requestedPage: number): boolean {
  const root = parseHtml(html);
  const list = root.querySelector(".bbs-list");
  if (!list) return false;

  const countWrap = list.querySelector(".r-count");
  const strong = countWrap
    ? elementChildren(countWrap).find((el) => tagNameOf(el) === "strong")
    : null;
  const total = parsePositiveSafeIntText(strong?.text ?? "");
  if (total === null) return false;
  const lastPage = Math.floor((total + GJSINBO_PAGE_SIZE - 1) / GJSINBO_PAGE_SIZE);
  if (!isPositiveSafeInt(lastPage) || requestedPage <= lastPage) return false;

  const form = namedForm(list, "bbs_form");
  if (!form) return false;
  if (hiddenInputValue(form, "bbs_id") !== GJSINBO_BBS_ID) return false;
  if (hiddenInputValue(form, "post_view_mod") !== "list") return false;

  const basic = form.querySelector("div.bbs-basic-list") ?? form.querySelector(".bbs-basic-list");
  if (!basic) return false;
  const rows = directRows(basic);
  const rowBox = rows.length === 1 ? rows[0] : undefined;
  if (!rowBox || !isStrictlyEmpty(rowBox)) return false;

  const pageBox = form.querySelector("div.page");
  if (!pageBox) return false;
  const anchors = pageBox.querySelectorAll("a");
  if (anchors.length < 2) return false;

  let sawFirst = false;
  let sawPrevious = false;
  for (const a of anchors) {
    const page = gjsinboPageFromHref(a.getAttribute("href") ?? "", cfg.baseUrl);
    if (page === null) return false;
    const text = (a.text ?? "").replace(/\s+/g, "");
    if (page === 1) sawFirst = true;
    if (looksLikePreviousPageLink(text)) {
      if (page !== lastPage) return false;
      sawPrevious = true;
    } else if (looksLikeFirstPageLink(text) && page !== 1) {
      return false;
    }
  }
  return sawFirst && sawPrevious;
}

export function isProvenAdditionalSourceEnd(
  html: string,
  cfg: BoardConfig,
  requestedPage: number,
): boolean {
  if (!isPositiveSafeInt(requestedPage)) return false;
  try {
    if (cfg.id === "pipa") return isPipaProvenEnd(html, requestedPage);
    if (cfg.id === "gjsinbo") return isGjsinboProvenEnd(html, cfg, requestedPage);
    return false;
  } catch {
    return false;
  }
}
