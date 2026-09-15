import { createHash } from "node:crypto";
import type { NormalizedAnnouncement } from "../../engine/types";
import { allowedHostsOf, fetchBoardAll, pagelessSource, pagingParamsOf, type BoardDeps } from "./engine";
import { GTP_ARCHIVE_COLLECTION_REVISION, gtpArchiveWindowConfig } from "./gtp-archive";
import { parseHtml, type HTMLElement } from "./html";
import type { BoardConfig, BoardRow } from "./types";
import { extractBySelector } from "./layers/selector";
import { isAuthChallengeHtml, isJsonListPageWithinRange, isProvenEmptyBoardPage, listBoundContainers } from "./page-end";
import { validateRows } from "./validate";

export { isProvenEmptyBoardPage };

/** GTP 지난 공고 날짜 복원만 출처 해시에 넣는다. 다른 출처는 커서를 그대로 둔다. */
export function archiveCollectionRevisionOf(cfg: BoardConfig): string | null {
  return cfg.id === "gtp" ? GTP_ARCHIVE_COLLECTION_REVISION : null;
}

export type BoardWindowOptions = {
  startPage: number;
  pageBudget: number;
  signal?: AbortSignal;
  endStreak?: number;
  lastPageKey?: string | null;
};

export type BoardWindowResult = {
  announcements: NormalizedAnnouncement[];
  nextPage: number;
  complete: boolean;
  reason: "page-budget" | "incomplete" | "empty-list" | "source-end" | "no-pagination" | "beyond-last-page" | "repeated-page";
  lastPageRead: number;
  endStreak: number;
  lastPageKey: string | null;
};

/** 원본 types 에는 없다. 있으면 쪽 번호만 절대값으로 옮겨 싣는다. */
type WindowConfig = BoardConfig & {
  validationParse?: (html: string, page: number) => BoardRow[];
};

function throwIfAborted(signal?: AbortSignal): void {
  signal?.throwIfAborted();
}

function requireWindowOptions(startPage: number, pageBudget: number): void {
  if (!Number.isSafeInteger(startPage) || startPage < 1) {
    throw new Error("시작 쪽은 1 이상의 정수여야 합니다");
  }
  if (!Number.isInteger(pageBudget) || pageBudget < 1 || pageBudget > 40) {
    throw new Error("쪽 예산은 1 이상 40 이하의 정수여야 합니다");
  }
  if (!Number.isSafeInteger(startPage + pageBudget)) throw new Error("시작 쪽이 허용 범위를 넘었습니다");
}

/** 원본 설정의 유효 삭제 변수. 절대 쪽으로 옮긴 url(1)·url(2) 로 다시 추론하지 않는다. */
function frozenDropUrlParams(cfg: BoardConfig): string[] {
  const inferred = cfg.keepPagingParamsInDetail ? [] : pagingParamsOf(cfg);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const key of [...(cfg.dropUrlParams ?? []), ...inferred]) {
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

/** fetchBoardAll 은 상대 1쪽만 부르므로, 그 1쪽을 절대 쪽으로 대응시킨다. */
function bindAbsolutePage(cfg: WindowConfig, absolutePage: number): WindowConfig {
  const at = (rel: number) => absolutePage + rel - 1;
  const bound: WindowConfig = {
    ...cfg,
    expectMinRows: 1,
    dropUrlParams: frozenDropUrlParams(cfg),
    keepPagingParamsInDetail: true,
    list: {
      ...cfg.list,
      maxPages: 1,
      url: (rel) => cfg.list.url(at(rel)),
    },
  };
  if (cfg.list.init) bound.list.init = (rel) => cfg.list.init!(at(rel));
  if (cfg.customParse) bound.customParse = (html, rel) => cfg.customParse!(html, at(rel));
  if (cfg.feed) bound.feed = { ...cfg.feed, url: (rel) => cfg.feed!.url(at(rel)) };
  if (absolutePage > 1 && cfg.feed && cfg.feed.url(1) === cfg.feed.url(2) && !pagelessSource(cfg)) bound.feed = undefined;
  if (cfg.validationParse) bound.validationParse = (html, rel) => cfg.validationParse!(html, at(rel));
  return bound;
}

function hasValidFilteredOutRows(html: string, cfg: BoardConfig, page: number): boolean {
  if (!cfg.customParse || cfg.validationParse) return false;
  try {
    if (cfg.customParse(html, page).length !== 0) return false;
    const raw = extractBySelector(html, cfg);
    const hosts = new Set(allowedHostsOf(cfg));
    if (!raw.length || raw.some(row => {
      try { const url = new URL(row.detailUrl); return !["https:", "http:"].includes(url.protocol) || !hosts.has(url.host); }
      catch { return true; }
    })) return false;
    return validateRows(raw, { expectMinRows: 1, prevCount: 0, allowUndated: cfg.allowUndatedRows }).ok;
  } catch { return false; }
}

function looksLikeJson(text: string): boolean {
  const trimmed = text.replace(/^\uFEFF/, "").trim();
  return trimmed.startsWith("{") || trimmed.startsWith("[");
}

function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** 출처 URL 의 쪽 번호. POST 본문 변수는 링크 비교에 쓰지 않는다. */
function sitePageOf(cfg: BoardConfig, page: number): number | null {
  const name = pagingParamsOf(cfg)[0];
  if (!name) return null;
  try {
    const url = new URL(cfg.list.url(page));
    if (name === "/path") {
      const parts = url.pathname.split("/").filter(Boolean);
      for (let i = parts.length - 1; i >= 0; i--) {
        if (!/^\d+$/.test(parts[i]!)) continue;
        const n = Number(parts[i]);
        return Number.isSafeInteger(n) ? n : null;
      }
      return null;
    }
    const raw = url.searchParams.get(name);
    if (raw === null || raw === "") return null;
    const n = Number(raw);
    return Number.isSafeInteger(n) ? n : null;
  } catch {
    return null;
  }
}

const PAGINATION_BOX = /pag(e|ing|ination)?/i;

function addLinkPageNums(el: HTMLElement, pages: Set<number>): void {
  const tag = (el.tagName ?? "").toLowerCase();
  if (tag === "a" || tag === "button") {
    const text = el.text.trim();
    if (/^\d{1,5}$/.test(text)) pages.add(Number(text));
  }
  for (const node of el.querySelectorAll("a")) {
    const text = node.text.trim();
    if (/^\d{1,5}$/.test(text)) pages.add(Number(text));
  }
  for (const node of el.querySelectorAll("button")) {
    const text = node.text.trim();
    if (/^\d{1,5}$/.test(text)) pages.add(Number(text));
  }
}

function paginationLinkPages(html: string): number[] {
  const root = parseHtml(html);
  const pages = new Set<number>();
  const visit = (el: HTMLElement) => {
    const id = el.getAttribute("id") ?? "";
    const cls = el.getAttribute("class") ?? "";
    if (PAGINATION_BOX.test(id) || PAGINATION_BOX.test(cls)) addLinkPageNums(el, pages);
    for (const node of el.childNodes) {
      if (node.nodeType === 1) visit(node as HTMLElement);
    }
  };
  visit(root);
  return [...pages];
}

/** 쪽 번호형만 마지막 쪽을 넘었다고 본다. offset 형은 링크 숫자와 비교하지 않는다. */
function isBeyondLastPage(html: string, cfg: BoardConfig, page: number): boolean {
  try {
    if (sitePageOf(cfg, 1) !== 1 || sitePageOf(cfg, 2) !== 2) return false;
    const sitePage = sitePageOf(cfg, page);
    if (sitePage === null) return false;
    const nums = paginationLinkPages(html);
    if (nums.length === 0) return false;
    return Math.max(...nums) < sitePage && !nums.includes(sitePage);
  } catch {
    return false;
  }
}

function pageKeyOf(html: string, cfg: BoardConfig): string | null {
  try {
    const rows = extractBySelector(html, cfg);
    if (rows.length >= 1) {
      return sha256Hex(rows.map((row) => `${row.detailUrl}\n${row.title}`).sort().join("\n"));
    }
    const containers = listBoundContainers(html, cfg);
    if (!containers) return null;
    const text = containers.map((node) => node.text.replace(/\s+/g, "")).join("");
    if (!text) return null;
    return sha256Hex(text);
  } catch {
    return null;
  }
}

function isRowlessListPage(html: string, cfg: BoardConfig): boolean {
  try {
    if (looksLikeJson(html) || isAuthChallengeHtml(html)) return false;
    if (listBoundContainers(html, cfg) === null) return false;
    const rows = extractBySelector(html, cfg);
    return rows.length === 0 || rows.every((row) => {
      const date = row.dateText.trim();
      return date === "" || /^0000/.test(date);
    });
  } catch {
    return false;
  }
}

function guardFetch(fetchText: BoardDeps["fetchText"], signal?: AbortSignal): BoardDeps["fetchText"] {
  if (!signal) return fetchText;
  return async (url, charset, init) => {
    throwIfAborted(signal);
    return new Promise<string>((resolve, reject) => {
      const finish = (error: unknown, text?: string) => {
        signal.removeEventListener("abort", aborted);
        if (error !== undefined) reject(error); else resolve(text!);
      };
      const aborted = () => finish(signal.reason ?? new Error("수집이 중단됐습니다"));
      signal.addEventListener("abort", aborted, { once: true });
      // 중단을 지원하지 않는 어댑터도 대기를 끝낸다. 늦은 실패 역시 처리한다.
      Promise.resolve().then(() => {
        throwIfAborted(signal);
        return fetchText(url, charset, init);
      }).then(text => signal.aborted ? aborted() : finish(undefined, text), error => finish(error));
    });
  };
}

/**
 * 절대 쪽 창. 엔진 전역 40쪽 상한을 우회해 41쪽 이후를 이어 읽고,
 * 빈 쪽·오류·반복만으로 수집 끝을 단정하지 않는다.
 */
export async function fetchBoardWindow(
  cfg: BoardConfig,
  deps: BoardDeps,
  options: BoardWindowOptions,
): Promise<BoardWindowResult> {
  const { startPage, pageBudget, signal } = options;
  requireWindowOptions(startPage, pageBudget);

  const announcements = new Map<string, NormalizedAnnouncement>();
  let lastPageRead = startPage - 1;
  let endStreak = Number.isSafeInteger(options.endStreak) && options.endStreak! >= 0 ? options.endStreak! : 0;
  let lastPageKey: string | null = options.lastPageKey ?? null;
  let prevKey: string | null = options.lastPageKey ?? null;
  const endAfter = cfg.emptyStreakStop ?? 2;
  const guarded = guardFetch(deps.fetchText, signal);
  const session = gtpArchiveWindowConfig(cfg).createListSession?.((url, init) => guarded(url, cfg.charset, init));
  const result = (nextPage: number, complete: boolean, reason: BoardWindowResult["reason"]): BoardWindowResult => ({
    announcements: [...announcements.values()], nextPage, complete, reason, lastPageRead, endStreak, lastPageKey,
  });

  const limit = startPage + pageBudget;
  for (let page = startPage; page < limit; page++) {
    if (signal?.aborted) return result(page, false, "incomplete");
    let primaryHtml: string | undefined;
    let sourceEnd = false;
    const bound = bindAbsolutePage(cfg, page);
    if (session) bound.createListSession = () => async rel => {
      try { primaryHtml = await session(page + rel - 1); return primaryHtml; }
      catch (error) { sourceEnd = cfg.isListEndError?.(error) === true; throw error; }
    };
    const cache = new Map<string, Promise<string>>();
    const pageDeps: BoardDeps = {
      ...deps, prevOpenCount: 0, onPageCap: undefined, onAllFailed: () => {}, onHealedRule: undefined,
      askModel: async () => { throw new Error("소급 수집에서는 자동 추측 규칙을 만들지 않습니다"); },
      fetchText: async (url, charset, init) => {
        const key = JSON.stringify([url, charset, init]);
        if (!cache.has(key)) cache.set(key, guarded(url, charset, init));
        const html = await cache.get(key)!;
        if (url === cfg.list.url(page)) primaryHtml = html;
        return html;
      },
    };
    try {
      const rows = await fetchBoardAll(bound, pageDeps);
      throwIfAborted(signal);
      for (const row of rows) announcements.set(`${row.source}\n${row.sourceId}`, row);
      lastPageRead = page;
      const key = primaryHtml !== undefined ? pageKeyOf(primaryHtml, cfg) : null;
      if (key) lastPageKey = key;
      if (page > 1 && key && prevKey && key === prevKey) {
        endStreak += 1;
        if (endStreak >= endAfter) return result(page + 1, true, "repeated-page");
      } else {
        endStreak = 0;
      }
      if (key) prevKey = key;
      if (page === 1 && rows.length > 0 && pagelessSource(cfg)) return result(2, true, "no-pagination");
    } catch {
      if (signal?.aborted) return result(page, false, "incomplete");
      if (sourceEnd) return result(page, true, "source-end");
      if (primaryHtml !== undefined && isProvenEmptyBoardPage(primaryHtml, cfg, page)) {
        lastPageRead = page;
        endStreak += 1;
        if (endStreak >= endAfter) return result(page + 1, true, "empty-list");
        continue;
      }
      if (primaryHtml !== undefined) {
        if (isJsonListPageWithinRange(primaryHtml, page)) {
          lastPageRead = page;
          endStreak = 0;
          continue;
        }
        if (page > 1 && isBeyondLastPage(primaryHtml, cfg, page)) {
          return result(page, true, "beyond-last-page");
        }
        const key = pageKeyOf(primaryHtml, cfg);
        if (page > 1 && key && prevKey && key === prevKey) {
          lastPageRead = page;
          endStreak += 1;
          lastPageKey = key;
          prevKey = key;
          if (endStreak >= endAfter) return result(page + 1, true, "repeated-page");
          continue;
        }
        if (page > 1 && isRowlessListPage(primaryHtml, cfg)) {
          lastPageRead = page;
          endStreak += 1;
          if (key) {
            lastPageKey = key;
            prevKey = key;
          }
          if (endStreak >= endAfter) return result(page + 1, true, "empty-list");
          continue;
        }
      }
      if (primaryHtml !== undefined && hasValidFilteredOutRows(primaryHtml, cfg, page)) {
        lastPageRead = page;
        endStreak = 0;
        continue;
      }
      return result(page, false, "incomplete");
    }
  }

  return result(limit, false, "page-budget");
}
