import { parseHtml, type HTMLElement } from "./html";
import { isProvenCwipEnd } from "./cwip-page-end";
import { isProvenAdditionalSourceEnd } from "./additional-page-end";
import type { BoardConfig } from "./types";

/**
 * 목록 상자 안의 빈 표식. 공백만 지운 뒤 부분 일치한다.
 * 본문·바닥글·로그인 껍데기의 같은 글자는 상자가 없으면 인정하지 않는다.
 */
const EMPTY_LIST_TEXT =
  /(?:등록된|검색된|조회된)?(?:게시물|게시글|공고|자료|데이터)(?:이|가)?(?:없습니다|존재하지않습니다)|(?:검색|조회)결과가?(?:없습니다|존재하지않습니다)|해당되는결과가존재하지않습니다|등록된글이없습니다|데이터가존재하지않습니다/;

const LIST_ITEM_TAIL = /(?:\s*>\s*|\s+)(?:tr|li|a)(?:[.#][\w-]+)*$/;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function requiredNumbers(obj: Record<string, unknown>, keys: readonly string[]): Record<string, number> | null {
  const out: Record<string, number> = {};
  for (const key of keys) {
    const n = finiteNumber(obj[key]);
    if (n === null || !Number.isSafeInteger(n) || n < 0) return null;
    out[key] = n;
  }
  return out;
}

function looksLikeJson(text: string): boolean {
  const trimmed = text.replace(/^\uFEFF/, "").trim();
  return trimmed.startsWith("{") || trimmed.startsWith("[");
}

function hasAnnouncementLink(node: HTMLElement): boolean {
  return Boolean(node.querySelector("a[href]") || node.querySelector("a[onclick]"));
}

function isEmptyListText(text: string): boolean {
  return EMPTY_LIST_TEXT.test(text.replace(/\s+/g, ""));
}

const HIDDEN_TEXT_TAGS = new Set(["script", "style", "noscript", "template"]);

function isExplicitChallengeText(text: string): boolean {
  return /accessdenied/i.test(text) || /접근이제한/.test(text) || /500internalservererror/i.test(text);
}

function visibleCompactText(root: HTMLElement): string {
  const parts: string[] = [];
  const walk = (el: HTMLElement) => {
    if (HIDDEN_TEXT_TAGS.has((el.tagName ?? "").toLowerCase())) return;
    for (const node of el.childNodes) {
      if (node.nodeType === 3) parts.push(node.text);
      else if (node.nodeType === 1) walk(node as HTMLElement);
    }
  };
  walk(root);
  return parts.join("").replace(/\s+/g, "");
}

function formActionPath(form: HTMLElement): string {
  const action = (form.getAttribute("action") ?? "").trim();
  if (!action || action === "#" || /^javascript:/i.test(action)) return "";
  try {
    return new URL(action, "https://example.invalid/").pathname;
  } catch {
    return action.split(/[?#]/, 1)[0] ?? "";
  }
}

function pathLooksLikeLogin(path: string): boolean {
  return path.split("/").some((seg) => {
    if (!seg) return false;
    const name = seg.replace(/\.[^.]+$/, "").toLowerCase();
    return name.includes("login") || /^sign[-_]?in$/.test(name) || /^log[-_]?on$/.test(name);
  });
}

function formLooksLikeLogin(form: HTMLElement): boolean {
  if (form.querySelectorAll("input").some(
    (input) => (input.getAttribute("type") ?? "").toLowerCase() === "password",
  )) return true;
  if (pathLooksLikeLogin(formActionPath(form))) return true;
  const ident = `${form.getAttribute("name") ?? ""} ${form.getAttribute("id") ?? ""}`.trim();
  return /(?:^|\s)(?:frm)?login(?:form)?(?:\s|$)/i.test(ident);
}

/** 로그인 폼(암호 칸이 없어도)·보이는 접근 제한·500 제목은 빈 목록이 있어도 끝이 아니다. */
function isAuthChallengeHtml(html: string): boolean {
  const root = parseHtml(html);
  if (root.querySelectorAll("form").some(formLooksLikeLogin)) return true;
  return isExplicitChallengeText(visibleCompactText(root));
}

/** 행 선택자의 목록 상자. 콤마 선택자·상자 없음은 빈 목록으로 보지 않는다. */
function listBoundContainers(html: string, cfg: BoardConfig): HTMLElement[] | null {
  const selector = cfg.list.rowSelector.trim();
  if (!selector || selector.includes(",")) return null;
  const root = parseHtml(html);
  const parentSelector = selector.replace(LIST_ITEM_TAIL, "");
  if (parentSelector !== selector && parentSelector) {
    const parent = root.querySelector(parentSelector);
    return parent ? [parent] : null;
  }
  const items = root.querySelectorAll(selector);
  return items.length > 0 ? items : null;
}

function isProvenEmptyListHtml(html: string, cfg: BoardConfig, requestedPage?: number): boolean {
  try {
    if (isAuthChallengeHtml(html)) return false;
    if (isProvenAdditionalSourceEnd(html, cfg, requestedPage ?? 0)) return true;
    if (isProvenCwipEnd(html, cfg, requestedPage)) return true;
    if (cfg.id === "gwsinbo") {
      const table = parseHtml(html).querySelector("table.basic_board");
      const body = table?.querySelector("tbody");
      const notice = table?.nextElementSibling;
      // 실응답은 빈 tbody 뒤, 표 바로 바깥의 no_list_size에 안내를 둔다.
      if (table && body && !body.text.trim() && !body.childNodes.some(node => node.nodeType === 1) &&
          !hasAnnouncementLink(table) && notice?.classList.contains("no_list_size") &&
          !hasAnnouncementLink(notice) && /^등록된게시글이없습니다\.?$/.test(notice.text.replace(/\s+/g, ""))) return true;
    }
    const containers = listBoundContainers(html, cfg);
    if (!containers || containers.length === 0) return false;
    if (containers.some((node) => hasAnnouncementLink(node))) return false;
    return isEmptyListText(containers.map((node) => node.text).join(""));
  } catch {
    return false;
  }
}

const KOSMES_PAGE_KEYS = [
  "rowMax", "pageCount", "startPage", "startRowNum", "scopeRow",
  "endRowNum", "rowCount", "endPage", "maxPage", "nowPage",
] as const;

/** 중진공 notice_list.json — 빈 ds_infoList 와 요청 쪽이 마지막 쪽을 넘은 값. */
function isKosmesListEndJson(root: Record<string, unknown>): boolean {
  if ("resultCd" in root || "resultMsg" in root) return false;
  const pageInfo = asRecord(root.pageInfo);
  if (!pageInfo) return false;
  if ("resultCd" in pageInfo || "resultMsg" in pageInfo) return false;
  if (!Array.isArray(root.ds_infoList) || root.ds_infoList.length !== 0) return false;
  const n = requiredNumbers(pageInfo, KOSMES_PAGE_KEYS);
  if (!n) return false;
  if (n.nowPage < 1 || n.maxPage < 1 || n.rowMax < 1 || n.rowCount < 1) return false;
  if (n.nowPage <= n.maxPage || n.maxPage !== n.endPage) return false;
  if (n.pageCount !== n.rowCount) return false;
  if (Math.ceil(n.rowMax / n.rowCount) !== n.maxPage) return false;
  if (n.startRowNum !== (n.nowPage - 1) * n.rowCount + 1) return false;
  if (n.startRowNum <= n.rowMax) return false;
  if (n.scopeRow !== n.startRowNum - 1) return false;
  if (n.endRowNum !== n.startRowNum + n.rowCount) return false;
  if (n.startPage !== Math.floor((n.nowPage - 1) / n.pageCount) * n.pageCount + 1) return false;
  return true;
}

const SF_PAGE_KEYS = [
  "blockPage", "pageBasic", "startNumber", "showPage",
  "totalPageCount", "endNumber", "currentPage", "totalCount",
] as const;

function smartfactoryCopies(root: Record<string, unknown>): {
  lists: unknown[];
  pages: Record<string, unknown>[];
  keys: unknown[];
} {
  const lists: unknown[] = [];
  const pages: Record<string, unknown>[] = [];
  const keys: unknown[] = [];
  const add = (obj: Record<string, unknown> | null) => {
    if (!obj) return;
    if ("pbancList" in obj) lists.push(obj.pbancList);
    const page = asRecord(obj.paginationInfo);
    if (page) pages.push(page);
    if ("key" in obj) keys.push(obj.key);
  };
  add(root);
  const mav = asRecord(root.modelAndView);
  add(asRecord(mav?.model));
  add(asRecord(mav?.modelMap));
  return { lists, pages, keys };
}

/** 스마트공장 selectBsnsPbancPage — 빈 pbancList 와 쪽 메타가 서로 맞을 때만. */
function isSmartfactoryListEndJson(root: Record<string, unknown>): boolean {
  const { lists, pages, keys } = smartfactoryCopies(root);
  if (lists.length !== 3 || pages.length !== 3 || keys.length !== 3) return false;
  if (keys.some((key) => key !== "list")) return false;
  if (lists.some((list) => !Array.isArray(list) || list.length !== 0)) return false;
  const parsed = pages.map((page) => requiredNumbers(page, SF_PAGE_KEYS));
  if (parsed.some((page) => page === null)) return false;
  const first = parsed[0]!;
  if (parsed.some((page) => SF_PAGE_KEYS.some((key) => page![key] !== first[key]))) return false;
  if (first.currentPage < 1 || first.totalPageCount < 1 || first.totalCount < 1 || first.showPage < 1 || first.blockPage < 1) return false;
  if (first.currentPage <= first.totalPageCount) return false;
  if (Math.ceil(first.totalCount / first.showPage) !== first.totalPageCount) return false;
  if (first.startNumber !== (first.currentPage - 1) * first.showPage) return false;
  if (first.endNumber !== first.totalCount) return false;
  if (first.pageBasic !== Math.floor((first.currentPage - 1) / first.blockPage) * first.blockPage + 1) return false;
  return true;
}

function isProvenSourceJsonEnd(text: string, source: string, requestedPage?: number): boolean {
  if (!Number.isSafeInteger(requestedPage) || requestedPage! < 1) return false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.replace(/^\uFEFF/, "").trim());
  } catch {
    return false;
  }
  const root = asRecord(parsed);
  if (!root) return false;
  if ([root, asRecord(root.modelAndView), asRecord(asRecord(root.modelAndView)?.model),
    asRecord(asRecord(root.modelAndView)?.modelMap)].some(value => value &&
      (["error", "errors", "errorCode", "resultCd", "resultMsg"].some(key => key in value) || value.success === false))) return false;
  if (source === "kosmes") return finiteNumber(asRecord(root.pageInfo)?.nowPage) === requestedPage && isKosmesListEndJson(root);
  if (source === "smartfactory") return finiteNumber(asRecord(root.paginationInfo)?.currentPage) === requestedPage && isSmartfactoryListEndJson(root);
  return false;
}

/**
 * 빈 쪽의 출처 증거. 목록 상자 안 빈 표식, 또는 관측된 JSON 스키마의 빈 결과+쪽 메타.
 * 임의 본문 낱말·빈 200·오류 HTML·다른 JSON 배열은 끝이 아니다.
 */
export function isProvenEmptyBoardPage(html: string, cfg: BoardConfig, requestedPage?: number): boolean {
  if (looksLikeJson(html)) return isProvenSourceJsonEnd(html, cfg.id, requestedPage);
  return isProvenEmptyListHtml(html, cfg, requestedPage);
}
