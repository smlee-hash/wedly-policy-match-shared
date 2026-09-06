import type { BoardConfig, BoardFetchInit, BoardRow, ExtractLayerName } from "./types";
import type { NormalizedAnnouncement } from "@/lib/policy-match/types";
import { parseApplyPeriod } from "@/lib/policy-match/types";
import { parseHtml, normalizeDateText } from "./html";
import { validateRows } from "./validate";
import { extractBySelector } from "./layers/selector";
import { extractByHeuristic } from "./layers/heuristic";
import { extractFromRss, extractFromJson } from "./layers/feed";
import { selfHeal, type HealedRule } from "./layers/selfheal";
import type { PageCapInfo } from "./page-cap";
import { withDeadline } from "@/lib/policy-match/with-deadline";

/** 장부 쓰기가 풀 고갈로 멈추면 회차 전체를 붙잡지 않는다. 넘긴 약속은 withDeadline 이 삼킨다. */
export const PAGE_CAP_WRITE_TIMEOUT_MS = 5_000;
/**
 * 한 회차에 한 게시판을 읽는 쪽수의 절대 상한. 30 이던 것을 40 으로(2026-09-03) — 중소벤처24 가 접수중 1,630건을
 * 50건씩 33쪽으로 주어 30 에서는 880건이 영영 누락됐다(코덱스 지적). 설정 maxPages 가 이보다 커도 여기서 자른다.
 */
export const PAGE_HARD_CAP = 40;

export interface BoardDeps {
  fetchText: (url: string, charset?: "utf-8" | "euc-kr", init?: BoardFetchInit) => Promise<string>;
  prevOpenCount: number;
  askModel: (prompt: string) => Promise<string>;
  onAllFailed: (cfg: BoardConfig, reason: string) => void | Promise<void>;
  /** ③ 자가수리 규칙을 채택했을 때만. persist 는 등록부가 맡는다. */
  onHealedRule?: (rule: HealedRule) => Promise<void>;
  /**
   * 쪽수 상한 판정. 반환 타입을 { rows, cap } 로 바꾸면 fetchBoardAll 호출처
   * (출처 시험 30여 곳)가 전부 깨진다. onHealedRule 과 같이 선택적 콜백으로 옆길로 알린다.
   * 값은 이미 받아 온 마지막 쪽의 신규 건수라 추가 요청이 없다.
   */
  onPageCap?: (info: PageCapInfo) => void | Promise<void>;
}

type PageExtract = (page: number) => Promise<BoardRow[]>;

/**
 * UTC 자정(그 날짜). 달력에 없는 날짜는 null.
 * 공용 kstDay / parseApplyPeriod 는 건드리지 않는다(E2).
 */
function utcMidnightIfValid(y: number, m: number, d: number): number | null {
  const utcMidnight = Date.UTC(y, m - 1, d);
  const probe = new Date(utcMidnight);
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) return null;
  return utcMidnight;
}

/** KST 하루 시작 = UTC 전날 15:00. 달력에 없는 날짜는 null. */
export function startOfKstDay(y: number, m: number, d: number): Date | null {
  const utcMidnight = utcMidnightIfValid(y, m, d);
  if (utcMidnight == null) return null;
  return new Date(utcMidnight - 9 * 3_600_000);
}

/** KST 하루 끝 = UTC 같은 날 14:59:59. 달력에 없는 날짜는 null. */
export function endOfKstDay(y: number, m: number, d: number): Date | null {
  const utcMidnight = utcMidnightIfValid(y, m, d);
  if (utcMidnight == null) return null;
  return new Date(utcMidnight + (14 * 3_600_000 + 59 * 60_000 + 59_000));
}

function toNormalized(rows: BoardRow[], cfg: BoardConfig): NormalizedAnnouncement[] {
  return rows.map((r) => {
    // customParse 는 config 책임이라 방어적으로 한 번 더. 이미 정규화된 값은 그대로(E1).
    const dateText = normalizeDateText(r.dateText);
    const { start, end } = parseApplyPeriod(dateText);
    let applyStart = start;
    let applyEnd = end;
    if (applyStart == null && applyEnd == null) {
      const dates = dateText.match(/20\d{2}-\d{2}-\d{2}/g) ?? [];
      if (dates.length === 1) {
        const date = dates[0];
        const [ys, ms, ds] = date.split("-");
        const y = Number(ys), mo = Number(ms), da = Number(ds);
        const after = dateText.slice(dateText.indexOf(date) + date.length);
        // "2026-08-28 ~ 예산 소진 시" / "2026-08-28~" → 시작일(상시). 그 외 단일 날짜는 마감.
        if (/^\s*~/.test(after) && !/20\d{2}-\d{2}-\d{2}/.test(after)) {
          applyStart = startOfKstDay(y, mo, da);
        } else {
          applyEnd = endOfKstDay(y, mo, da);
        }
      }
    }
    return {
      source: cfg.id,
      sourceId: r.detailUrl || `${cfg.id}:${r.title}`,
      title: r.title,
      agency: r.agency ?? cfg.agency,
      category: r.category ?? "",
      // 행이 지역을 직접 말하면 그 값 — 재게시(남의 공고)는 파서가 ""(지역 없음)로 준다(BoardRow.region 주석).
      region: r.region ?? cfg.region,
      // 목록이 자격 요약을 실어 주면 싣는다(창조경제혁신센터 ELIGIBILITY). targetText 가 아니라
      // 여기 담아야 뒷단계의 첨부 본문 뽑기(targetText === "" 조건)를 막지 않는다.
      summary: r.summary ?? "",
      // 목록이 요약을 실어 준 출처(소진공)는 그 값을 자격조건 원문으로 — 나머지는 lazy 채움(detail-fill).
      targetText: r.targetText ?? "",
      applyStart,
      applyEnd,
      applyPeriodText: dateText,
      url: r.detailUrl,
      attachments: [],
      raw: r,
    } satisfies NormalizedAnnouncement;
  });
}

export function allowedHostsOf(cfg: BoardConfig): string[] {
  const hosts = new Set<string>();
  try { hosts.add(new URL(cfg.baseUrl).host); } catch { /* baseUrl 파싱 실패는 추가 호스트만 */ }
  for (const h of cfg.allowedHosts ?? []) {
    if (h) hosts.add(h);
  }
  return [...hosts];
}

function isAllowedHttpUrl(url: string, allowed: Set<string>): boolean {
  if (!/^https?:\/\//i.test(url.trim())) return true;
  try { return allowed.has(new URL(url).host); } catch { return false; }
}

function stripDropParams(url: string, params: string[] | undefined): string {
  if (!url || !params?.length || !/^https?:\/\//i.test(url)) return url;
  try {
    const u = new URL(url);
    let changed = false;
    for (const p of params) {
      if (u.searchParams.has(p)) {
        u.searchParams.delete(p);
        changed = true;
      }
    }
    return changed ? u.toString() : url;
  } catch {
    return url;
  }
}

/**
 * 목록 주소에서 **쪽 번호를 담는 변수 이름**을 스스로 알아낸다 — `url(1)` 과 `url(2)` 를 견줘
 * 값이 달라지는 변수가 그것이다.
 *
 * 왜 필요한가(2026-09-01 운영 실측): 상세 주소가 곧 `sourceId` 인데, 여러 게시판이 목록의
 * 상세 링크에 **자기가 보던 쪽 번호를 그대로 달아 준다**(`…&policyno=7158&pgno=2`).
 * 그래서 같은 공고가 2쪽·3쪽에 걸치면 **다른 공고로 저장**됐다 — 열린 공고 291건 중 20묶음이
 * 이미 그 중복이었고, 쪽수를 더 파면 그만큼 늘어난다.
 *
 * 게시판마다 `dropUrlParams` 에 손으로 적는 길도 있지만(광주TP·대전TP만 적어 뒀다) 새 출처를
 * 붙일 때마다 잊는다 — 목록 주소가 이미 답을 갖고 있으니 거기서 뽑는다.
 */
const pagingParamCache = new WeakMap<BoardConfig, string[]>();
export function pagingParamsOf(cfg: BoardConfig): string[] {
  const hit = pagingParamCache.get(cfg);
  if (hit) return hit;
  let out: string[] = [];
  try {
    const a = new URL(cfg.list.url(1));
    const b = new URL(cfg.list.url(2));
    // 같은 이름인데 값이 달라지는 변수 = 쪽 번호. 이름이 한쪽에만 있는 것은 건드리지 않는다.
    out = [...a.searchParams.keys()].filter(
      (k) => b.searchParams.has(k) && a.searchParams.get(k) !== b.searchParams.get(k),
    );
    // 경로 조각으로 쪽을 넘기는 게시판(대전·세종신보 `/index/page/2`) — 변수 이름이 없으니
    // 「경로 쪽넘김」 표식을 돌려준다. 상세 주소엔 그 조각이 없어 지울 것도 없다(2026-09-03).
    if (out.length === 0 && a.pathname !== b.pathname && /\/\d+(?:\/|$)/.test(b.pathname)) out = ["/path"];
    // POST 본문으로 쪽을 넘기는 게시판(인천신보·중진공·경기TP) — 본문의 달라지는 변수 이름이 쪽 번호다.
    if (out.length === 0 && cfg.list.init) {
      const pa = new URLSearchParams(String(cfg.list.init(1)?.body ?? ""));
      const pb = new URLSearchParams(String(cfg.list.init(2)?.body ?? ""));
      const fromBody = [...pa.keys()].filter((k) => pb.has(k) && pa.get(k) !== pb.get(k));
      if (fromBody.length > 0) out = fromBody;
      else {
        // JSON 본문이면 최상위 값이 달라지는 열쇠
        try {
          const ja = JSON.parse(String(cfg.list.init(1)?.body ?? "{}")), jb = JSON.parse(String(cfg.list.init(2)?.body ?? "{}"));
          out = Object.keys(ja).filter((k) => k in jb && String(ja[k]) !== String(jb[k]));
        } catch { /* JSON 이 아니면 그대로 빈 목록 */ }
      }
    }
  } catch {
    out = [];
  }
  pagingParamCache.set(cfg, out);
  return out;
}

function dropUntrusted(rows: BoardRow[], cfg: BoardConfig): BoardRow[] {
  const allowed = new Set(allowedHostsOf(cfg));
  const drop = [...(cfg.dropUrlParams ?? []), ...(cfg.keepPagingParamsInDetail ? [] : pagingParamsOf(cfg))];
  const out: BoardRow[] = [];
  for (const r of rows) {
    let detailUrl = stripDropParams(r.detailUrl, drop);
    // 경로 쪽넘김 게시판은 상세 주소에 /page/N 이 섞일 수 있다(세종신보 /view/page/2/id/1130) — sourceId 가 쪽마다 갈리지 않게 지운다.
    if (drop.includes("/path")) detailUrl = detailUrl.replace(/\/page\/\d+(?=\/|$)/g, "");
    const trimmed = detailUrl.trim();
    if (trimmed && !/^https?:\/\//i.test(trimmed)) continue;
    if (!isAllowedHttpUrl(detailUrl, allowed)) continue;
    out.push(detailUrl === r.detailUrl ? r : { ...r, detailUrl });
  }
  return out;
}

function failSummary(reasons: string[]): string {
  return reasons.join(", ") || "검증 미통과";
}

type CollectedPages = {
  rows: BoardRow[];
  /** 설정된 상한 쪽을 실제로 읽었을 때 그 쪽의 신규 건수. 상한에 닿기 전에 멈추면 0. */
  lastPageNew: number;
  reachedCap: boolean;
  /**
   * 마지막 쪽을 정상 파싱했거나, 상한 전에 바닥을 본 경우만 true.
   * 0행·검증실패·HTTP 오류면 false — 이때는 장부를 건드리지 않는다.
   */
  lastPageOk: boolean;
};

function pageCapOf(c: CollectedPages): PageCapInfo {
  const lastPageNew = c.reachedCap ? c.lastPageNew : 0;
  return { hitCap: lastPageNew > 0, lastPageNew };
}

async function reportPageCap(deps: BoardDeps, collected: CollectedPages): Promise<void> {
  if (!deps.onPageCap) return;
  if (!collected.lastPageOk) return;
  const pending = Promise.resolve().then(() => deps.onPageCap!(pageCapOf(collected)));
  try {
    await withDeadline(pending, PAGE_CAP_WRITE_TIMEOUT_MS);
  } catch {
    /* 장부 쓰기가 채택을 막지 않음 — onHealedRule 과 같은 자리 */
  }
}

/**
 * 쪽을 넘길 자리가 없는 목록인가 — `url(1)` 과 `url(2)` 가 **같은 주소**면 그렇다.
 * 주소를 만들다 터지면(설정 실수) 「쪽이 있다」쪽으로 물러선다 — 오경보가 무경보보다 낫다.
 */
export function pagelessSource(cfg: BoardConfig): boolean {
  try {
    return cfg.list.url(1) === cfg.list.url(2);
  } catch {
    return false;
  }
}

/** 1페이지는 이미 채택됨. 2..maxPages 는 오류·행0·검증실패·이미 본 detailUrl 뿐이면 중단하고 그까지 유지. */
async function collectLaterPages(
  extract: PageExtract,
  page1: BoardRow[],
  maxPages: number,
  cfg: BoardConfig,
): Promise<CollectedPages> {
  const cap = Math.min(Math.max(0, maxPages), PAGE_HARD_CAP);
  const collected = [...page1];
  const seen = new Set(page1.map((r) => r.detailUrl).filter((u) => u.length > 0));
  if (cap < 2) {
    const lastPageNew = cap === 1 ? page1.filter((r) => r.detailUrl.length > 0).length : 0;
    /**
     * ★**쪽 개념이 아예 없는 출처**는 「상한 도달」이 아니다(2026-09-06 독립 리뷰 3번).
     *
     * `maxPages: 1` 이면 1쪽이 곧 상한이라 예전엔 내용만 있으면 **매 회차 hitCap** 이 찍혔다 —
     * 현황판이 「더 팔 게 남았다」로 잘못 알리는 오경보다. 실제로 그런 출처가 둘 생겼다:
     * 아산 헬스케어스파(JSON 통로가 전량 16건을 한 번에 준다)·울산신보(쪽 변수가 없다).
     * 판정은 **목록 주소로** 한다 — `url(1) === url(2)` 면 쪽을 넘길 자리가 원리적으로 없다.
     * 쪽이 있는데 1쪽만 보기로 한 출처(주소가 달라진다)는 예전대로 hitCap 을 남긴다.
     */
    const pageless = pagelessSource(cfg);
    return { rows: collected, lastPageNew, reachedCap: cap === 1 && !pageless, lastPageOk: true };
  }
  // 신규 0인 쪽 하나로 멈추면, 고정 공지가 쪽마다 되풀이되는 게시판에서 뒷쪽을 통째로 잃는다
  // (2026-09-01 사장님 「단 1건도 놓치면 안 된다」). 연속 두 쪽이 빌 때만 멈춘다 —
  // 헛걸음 비용은 요청 한 번뿐이고, 잃는 쪽은 영영 안 들어온다.
  // 분류·부서를 한 쪽씩 번갈아 도는 출처는 한 바퀴 길이만큼 올려 받는다(BoardConfig 주석).
  const EMPTY_STREAK_STOP = cfg.emptyStreakStop ?? 2;
  let emptyStreak = 0;
  let lastPageNew = 0;
  let reachedCap = false;
  let lastPageOk = true;
  for (let p = 2; p <= cap; p++) {
    try {
      const rows = dropUntrusted(await extract(p), cfg);
      // 0행도 「빈 쪽」으로 센다 — 제목 거르개를 지나 남는 게 없는 쪽이 중간에 끼면
      // 여기서 즉시 끊겨 뒷쪽을 통째로 잃었다(적대 리뷰 ②: 수출바우처 8쪽이 전부 「선정결과·수행기관」이라
      // 0행이 되어 9·10·11쪽의 공고 9건이 안 들어오고 있었다).
      if (rows.length === 0) {
        if (p === cap) lastPageOk = false;
        emptyStreak += 1;
        if (emptyStreak >= EMPTY_STREAK_STOP) break;
        continue;
      }
      if (!validateRows(rows, { prevCount: 0, allowUndated: cfg.allowUndatedRows }).ok) {
        lastPageOk = false;
        break;
      }
      let added = 0;
      for (const r of rows) {
        if (r.detailUrl && seen.has(r.detailUrl)) continue;
        collected.push(r);
        // lastPageNew 는 실제 상세 주소가 있는 행만. 빈 URL 은 seen 에 안 들어가
        // 쪽마다 새 건으로 잡혀 거짓 상한이 됐다.
        if (r.detailUrl) {
          seen.add(r.detailUrl);
          added += 1;
        }
      }
      if (p === cap) { reachedCap = true; lastPageNew = added; }
      emptyStreak = added === 0 ? emptyStreak + 1 : 0;
      if (emptyStreak >= EMPTY_STREAK_STOP) break;
    } catch {
      lastPageOk = false;
      break;
    }
  }
  return { rows: collected, lastPageNew, reachedCap, lastPageOk };
}

function feedExtract(cfg: BoardConfig, deps: BoardDeps): PageExtract {
  return async (page) => {
    const text = await deps.fetchText(cfg.feed!.url(page), cfg.charset);
    return cfg.feed!.kind === "rss"
      ? extractFromRss(text, cfg.feed!.map)
      : extractFromJson(text, cfg.feed!.itemPath ?? "data", cfg.feed!.map);
  };
}

function selectorExtract(cfg: BoardConfig, deps: BoardDeps): PageExtract {
  return async (page) => {
    const html = await deps.fetchText(cfg.list.url(page), cfg.charset, cfg.list.init?.(page));
    return cfg.customParse ? cfg.customParse(html, page) : extractBySelector(html, cfg);
  };
}

function heuristicExtract(cfg: BoardConfig, deps: BoardDeps): PageExtract {
  return async (page) => {
    const html = await deps.fetchText(cfg.list.url(page), cfg.charset, cfg.list.init?.(page));
    return extractByHeuristic(html, cfg.baseUrl);
  };
}

/** 단계 하강 + 검증 관문. 1페이지에서 채택한 단계로 뒤 페이지를 읽는다. 전부 실패면 onAllFailed 후 throw. */
export async function fetchBoardAll(cfg: BoardConfig, deps: BoardDeps): Promise<NormalizedAnnouncement[]> {
  // 1페이지 채택은 구조 검증만(prevCount 0). 급락은 합친 결과에서 본다.
  const page1Ctx = { expectMinRows: cfg.expectMinRows, prevCount: 0 };
  const finalCtx = { expectMinRows: cfg.expectMinRows, prevCount: deps.prevOpenCount };
  const reasons: string[] = [];

  const attempts: Array<{ layer: ExtractLayerName; extract: PageExtract }> = [];
  if (cfg.feed) attempts.push({ layer: "feed", extract: feedExtract(cfg, deps) });
  attempts.push({ layer: "selector", extract: selectorExtract(cfg, deps) });
  // customParse 는 사람이 확정한 구조다. heuristic 추측이 첨부 파일 링크를 공고로
  // 저장하면 다음 회차에 지워지지 않는다(2026-09-02 한국수출입은행 ECONNRESET).
  // 단 모든 customParse 게시판을 일괄로 막지는 않는다 — 광주TP 는 구조가 바뀌면 heuristic 이
  // 마지막 방어선이다(적대 리뷰). 첨부 링크가 섞여 추측이 쓰레기가 되는 곳만 설정으로 끈다.
  if (cfg.skipHeuristic) {
    reasons.push("heuristic: 설정(skipHeuristic)으로 건너뜀");
  } else {
    attempts.push({ layer: "heuristic", extract: heuristicExtract(cfg, deps) });
  }

  for (const a of attempts) {
    try {
      const page1 = dropUntrusted(await a.extract(1), cfg);
      const page1v = validateRows(page1, { ...page1Ctx, allowUndated: cfg.allowUndatedRows });
      if (!page1v.ok) {
        reasons.push(`${a.layer}: ${page1v.reason ?? "검증 미통과"}`);
        continue;
      }
      const collected = await collectLaterPages(a.extract, page1, cfg.list.maxPages, cfg);
      const finalv = validateRows(collected.rows, { ...finalCtx, allowUndated: cfg.allowUndatedRows });
      if (!finalv.ok) {
        reasons.push(`${a.layer}: ${finalv.reason ?? "합산 검증 미통과"}`);
        continue;
      }
      await reportPageCap(deps, collected);
      return toNormalized(collected.rows, cfg);
    } catch (e) {
      reasons.push(`${a.layer}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // ③ 자가수리 — 1페이지가 전 단계 실패일 때만 1페이지 HTML 로 시도. 구조 검증만(prevCount 0).
  if (cfg.customParse) {
    reasons.push("selfheal: customParse 게시판이라 건너뜀");
  } else {
    try {
      const html = await deps.fetchText(cfg.list.url(1), cfg.charset, cfg.list.init?.(1));
      const healed = await selfHeal(html, cfg, { prevCount: 0 }, deps.askModel);
      if (healed.ok && healed.rows && healed.rule) {
        const healedCfg: BoardConfig = {
          ...cfg,
          list: { ...cfg.list, rowSelector: healed.rule.rowSelector, fields: healed.rule.fields },
        };
        const extract: PageExtract = async (page) => {
          if (page === 1) return healed.rows!;
          const pageHtml = await deps.fetchText(cfg.list.url(page), cfg.charset, cfg.list.init?.(page));
          return extractBySelector(pageHtml, healedCfg);
        };
        const page1 = dropUntrusted(healed.rows, cfg);
        const collected = await collectLaterPages(extract, page1, cfg.list.maxPages, cfg);
        const finalv = validateRows(collected.rows, { ...finalCtx, allowUndated: cfg.allowUndatedRows });
        if (finalv.ok) {
          try { await deps.onHealedRule?.(healed.rule); } catch { /* persist 실패는 채택을 막지 않음 */ }
          await reportPageCap(deps, collected);
          return toNormalized(collected.rows, cfg);
        }
        reasons.push(`selfheal: ${finalv.reason ?? "합산 검증 미통과"}`);
      } else {
        reasons.push("selfheal: 채택 실패");
      }
    } catch (e) {
      reasons.push(`selfheal: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const summary = failSummary(reasons);
  try {
    await deps.onAllFailed(cfg, summary);
  } catch { /* 알림 실패가 추출 실패 throw 를 가리지 않음 */ }
  throw new Error(`게시판 추출 전 단계 실패: ${summary}`);
}

/** 상세(자격조건) lazy 읽기 — querySelectorAll 전부의 텍스트를 이어 붙인다(E8). */
export async function fetchBoardDetail(
  cfg: BoardConfig,
  url: string,
  deps: Pick<BoardDeps, "fetchText">,
): Promise<string> {
  const allowed = new Set(allowedHostsOf(cfg));
  let host = "";
  try { host = new URL(url).host; } catch { throw new Error("허용되지 않은 상세 주소"); }
  if (!/^https?:\/\//i.test(url) || !allowed.has(host)) {
    throw new Error(`허용되지 않은 상세 주소 호스트: ${host || url}`);
  }
  const html = await deps.fetchText(url, cfg.charset);
  if (!cfg.detailContentSelector) return "";
  const els = parseHtml(html).querySelectorAll(cfg.detailContentSelector);
  const text = els.map((el) => el.text.trim()).join("\n\n");
  if (text.length > 20_000) return `${text.slice(0, 20_000)}\n[상세 잘림]`;
  return text;
}
