import type { NormalizedAnnouncement } from "../../engine/types";
import { allowedHostsOf, fetchBoardAll, pagelessSource, type BoardDeps } from "./engine";
import type { BoardConfig, BoardRow } from "./types";
import { parseHtml } from "./html";
import { extractBySelector } from "./layers/selector";
import { validateRows } from "./validate";

export type BoardWindowOptions = {
  startPage: number;
  pageBudget: number;
  signal?: AbortSignal;
  endStreak?: number;
};

export type BoardWindowResult = {
  announcements: NormalizedAnnouncement[];
  nextPage: number;
  complete: boolean;
  reason: "page-budget" | "incomplete" | "empty-list" | "source-end" | "no-pagination";
  lastPageRead: number;
  endStreak: number;
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

/** fetchBoardAll 은 상대 1쪽만 부르므로, 그 1쪽을 절대 쪽으로 대응시킨다. */
function bindAbsolutePage(cfg: WindowConfig, absolutePage: number): WindowConfig {
  const at = (rel: number) => absolutePage + rel - 1;
  const bound: WindowConfig = {
    ...cfg,
    expectMinRows: 1,
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

/** 기관의 목록 상자 안에 있는 명시적인 빈 목록 표시만 인정한다. */
export function isProvenEmptyBoardPage(html: string, cfg: BoardConfig): boolean {
  const selector = cfg.list.rowSelector.trim();
  if (selector.includes(",")) return false;
  const parentSelector = selector.replace(/(?:\s*>\s*|\s+)(?:tr|li|a)(?:[.#][\w-]+)*$/, "");
  if (parentSelector === selector || !parentSelector) return false;
  try {
    const parent = parseHtml(html).querySelector(parentSelector);
    if (!parent || parent.querySelector("a[href]")) return false;
    const text = parent.text.replace(/\s+/g, "");
    return /(?:등록된|검색된|조회된)?(?:게시물|게시글|공고|자료|데이터)(?:이|가)?없습니다|검색결과가?없습니다|등록된글이없습니다/.test(text);
  } catch { return false; }
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
  const endAfter = cfg.emptyStreakStop ?? 2;
  const guarded = guardFetch(deps.fetchText, signal);
  const session = cfg.createListSession?.((url, init) => guarded(url, cfg.charset, init));
  const result = (nextPage: number, complete: boolean, reason: BoardWindowResult["reason"]): BoardWindowResult => ({
    announcements: [...announcements.values()], nextPage, complete, reason, lastPageRead, endStreak,
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
      endStreak = 0;
      if (page === 1 && rows.length > 0 && pagelessSource(cfg)) return result(2, true, "no-pagination");
    } catch {
      if (signal?.aborted) return result(page, false, "incomplete");
      if (sourceEnd) return result(page, true, "source-end");
      if (primaryHtml !== undefined && isProvenEmptyBoardPage(primaryHtml, cfg)) {
        lastPageRead = page;
        endStreak += 1;
        if (endStreak >= endAfter) return result(page + 1, true, "empty-list");
        continue;
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
