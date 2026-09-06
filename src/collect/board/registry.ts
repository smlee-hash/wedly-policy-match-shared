import type { BoardConfig, BoardFetchInit } from "./types";
import type { AnnouncementSyncSource, CollectDeps } from "../types";
import { allowedHostsOf, fetchBoardAll, type BoardDeps } from "./engine";
import { decodeBody } from "./html";
import { sanitizeHealedRule } from "./layers/selfheal";
import { noteSuccess } from "./alert";
import { boardCapKey, notePageCap, parseBoardCap, type BoardCapRecord } from "./page-cap";
import { BOARD_SOURCES } from "./source-list";
import { proxyDispatcher, boardFetch, boardProxyUrl } from "./proxy";

export { BOARD_SOURCES } from "./source-list";

const FETCH_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
// 목록 페이지(표 몇 줄)는 그대로 좁게 — 이 값을 상세에도 같이 올리면 게시판 30여 곳
// 전부의 모든 요청이 느려져, 회차 최악 시간이 자물쇠 상한(2시간)에 다가간다(fable 리뷰 중요3).
const FETCH_TIMEOUT_MS = 15_000;
const FETCH_BODY_MAX_BYTES = 3 * 1024 * 1024;
/** 네트워크 계층 오류 시 한 번 더 치기 전 대기. 시험이 fake timer 로 넘긴다. */
export const RETRY_DELAY_MS = 700;
// 경북TP 상세는 본문에 이미지를 그대로 박아 넣어 15.3MB 까지 나온다(실측 2026-08-31,
// nttNo=11458) — 3MB 로는 정상 공고까지 매번 "3MB 초과"로 잘려 자격조건을 영영 못 읽는다.
// **상세 페이지 fetch 에만** 적용한다 — 목록 페이지는 원래 상한 그대로.
export const DETAIL_FETCH_TIMEOUT_MS = 30_000;
export const DETAIL_FETCH_BODY_MAX_BYTES = 20 * 1024 * 1024;
const HEAL_COOLDOWN_MS = 24 * 3600 * 1000;
const PREV_OPEN_WINDOW_MS = 26 * 3600 * 1000;

export function asFailCount(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

/** JsonCache `board-rule:<id>` 가 있으면 list.rowSelector·fields 를 덮어쓰고 customParse 를 끈다. */
export async function applyPersistedBoardRule(
  cfg: BoardConfig,
  deps: Pick<CollectDeps, "jsonCacheGet">,
): Promise<BoardConfig> {
  try {
    const rule = sanitizeHealedRule(await deps.jsonCacheGet(`board-rule:${cfg.id}`));
    if (!rule) return cfg;
    return {
      ...cfg,
      list: { ...cfg.list, rowSelector: rule.rowSelector, fields: rule.fields },
      customParse: undefined,
    };
  } catch {
    return cfg;
  }
}

function assertAllowedHost(url: string, allowed: Set<string>): void {
  let host = "";
  try { host = new URL(url).host; } catch { throw new Error("허용되지 않은 URL"); }
  if (!/^https?:\/\//i.test(url) || !allowed.has(host)) {
    throw new Error(`허용되지 않은 호스트: ${host || url}`);
  }
}

export type CookieRecord = { value: string; secure: boolean; path: string };
/**
 * 요청 한 번 안에서만 사는 쿠키 항아리(호스트 → 이름|path → 값+Secure+Path).
 * 왜(2026-09-02 실측): 수출입은행은 첫 응답에 JSESSIONID·WMONID 를 주며 같은 주소로 302 를 돌려준다.
 * 쿠키 없이 따라가면 302 를 되풀이하다 「3홉 초과」로 죽고, 쿠키를 들고 가면 200(591KB)이 바로 온다.
 * 항아리는 fetchBoardText 호출마다 새로 만든다 — 회차 사이에 남기지 않는다(세션이 낡아 또 302 가 오면 그때 새로 받는다).
 * Secure 는 https 에만, Path 는 RFC 6265 path-match 로 맞는 주소에만 싣는다 — 속성을 버리면 http 로 내려갈 때 세션이 샌다.
 * 같은 이름·다른 Path 는 둘 다 두고, 헤더로 실을 때 path 가 긴 것부터 전부 싣는다(브라우저와 같다).
 */
export type CookieJar = Map<string, Map<string, CookieRecord>>;

function cookieJarKey(name: string, path: string): string {
  return `${name}\n${path}`; // 줄바꿈은 쿠키 이름·경로에 올 수 없다("|" 는 이름에 올 수 있어 열쇠가 겹친다)
}

function cookieNameFromJarKey(key: string): string {
  const i = key.indexOf("\n");
  return i >= 0 ? key.slice(0, i) : key;
}

export function setCookieValuesOf(headers: { get(k: string): string | null; getSetCookie?: () => string[] }): string[] {
  if (typeof headers.getSetCookie === "function") return headers.getSetCookie();
  // getSetCookie 가 없는 옛 구현 — 합쳐진 한 줄에서 첫 쿠키만 안전하게 쓴다(Expires 의 쉼표 때문에 쪼개지 않는다).
  const one = headers.get("set-cookie");
  return one ? [one] : [];
}

/** RFC 6265 §5.1.4 default-path: 마지막 "/" 전까지. "/" 또는 슬래시 하나면 "/". */
function defaultCookiePath(pathname: string): string {
  const uriPath = pathname || "/";
  if (!uriPath.startsWith("/") || uriPath === "/") return "/";
  const last = uriPath.lastIndexOf("/");
  if (last <= 0) return "/";
  return uriPath.slice(0, last);
}

/**
 * `expired` = 서버가 **지우라고** 보낸 쿠키(RFC 6265 §5.2.1~2).
 * `Max-Age` 가 있으면 `Expires` 는 무시하고, 0 이하면 그 자리에서 만료다.
 * 안 보면 로그아웃·세션 폐기로 서버가 지운 값을 계속 되돌려 보내게 된다(2026-09-06 독립 리뷰 8번).
 */
function parseSetCookie(
  raw: string,
  defaultPath: string,
  now: number = Date.now(),
): { name: string; rec: CookieRecord; expired: boolean } | null {
  const parts = raw.split(";");
  const pair = parts[0] ?? "";
  const eq = pair.indexOf("=");
  if (eq <= 0) return null;
  const name = pair.slice(0, eq).trim();
  const value = pair.slice(eq + 1).trim();
  if (!name) return null;
  let secure = false;
  let path: string | undefined;
  let maxAge: number | null = null;
  let expires: number | null = null;
  for (const attr of parts.slice(1)) {
    const t = attr.trim();
    if (!t) continue;
    const colon = t.indexOf("=");
    const key = (colon >= 0 ? t.slice(0, colon) : t).trim().toLowerCase();
    const val = colon >= 0 ? t.slice(colon + 1).trim() : "";
    if (key === "secure") secure = true;
    else if (key === "path" && val.startsWith("/")) path = val; // "/" 로 시작하지 않는 Path 는 RFC 6265 대로 기본 경로를 쓴다
    else if (key === "max-age") {
      const n = Number(val);
      if (val !== "" && Number.isFinite(n)) maxAge = n;
    } else if (key === "expires") {
      const t2 = Date.parse(val);
      if (Number.isFinite(t2)) expires = t2;
    }
  }
  const expired = maxAge !== null ? maxAge <= 0 : expires !== null && expires <= now;
  return { name, rec: { value, secure, path: path ?? defaultPath }, expired };
}

/**
 * Set-Cookie 값들을 그 주소의 호스트 항아리에 담는다. Secure·Path 는 다음 홉 싣기에 쓴다.
 * 만료된 쿠키(`Max-Age<=0`·지난 `Expires`)는 담지 않고, 같은 이름·경로로 이미 있던 값도 **지운다**.
 *
 * ⚠️ 한계(고치지 않고 적어 둔다): `Domain=` 속성은 아직 안 본다 — 항아리가 **호스트 이름 그대로**
 *  묶여 있어서, 상세가 `Domain=.example.com` 으로 준 쿠키를 첨부 호스트가 다르면(`cdn.example.com`)
 *  브라우저와 달리 안 싣는다. 지금 쓰는 게시판(수출입은행·세종TP)은 상세와 첨부가 **같은 호스트**라
 *  실제로 걸리는 자리가 없다. 다른 호스트로 첨부를 주는 게시판이 생기면 그때 도메인 매칭을 넣는다.
 */
export function cookieJarAbsorb(jar: CookieJar, url: string, setCookies: string[]): void {
  let parsedUrl: URL;
  try { parsedUrl = new URL(url); } catch { return; }
  const host = parsedUrl.host.toLowerCase();
  const defaultPath = defaultCookiePath(parsedUrl.pathname);
  const bucket = jar.get(host) ?? new Map<string, CookieRecord>();
  for (const raw of setCookies) {
    const parsed = parseSetCookie(raw, defaultPath);
    if (!parsed) continue;
    const key = cookieJarKey(parsed.name, parsed.rec.path);
    if (parsed.expired) bucket.delete(key);
    else bucket.set(key, parsed.rec);
  }
  if (bucket.size > 0) jar.set(host, bucket);
  else jar.delete(host);
}

/** RFC 6265 §5.1.4 path-match: 같거나, R 이 P 로 시작하고 (P 가 "/" 로 끝나거나 R 의 다음 글자가 "/"). */
function pathMatches(cookiePath: string, requestPath: string): boolean {
  const P = cookiePath || "/";
  const R = requestPath || "/";
  if (P === R) return true;
  if (!R.startsWith(P)) return false;
  if (P.endsWith("/")) return true;
  return R.charAt(P.length) === "/";
}

function cookieMatchesUrl(rec: CookieRecord, u: URL): boolean {
  if (rec.secure && u.protocol !== "https:") return false;
  return pathMatches(rec.path, u.pathname || "/");
}

/** 그 주소의 호스트에 보낼 Cookie 헤더 값. Secure·Path 에 안 맞으면 안 싣는다. 맞는 것은 path 가 긴 순. */
export function cookieHeaderFor(jar: CookieJar, url: string): string | undefined {
  let u: URL;
  try { u = new URL(url); } catch { return undefined; }
  const bucket = jar.get(u.host.toLowerCase());
  if (!bucket || bucket.size === 0) return undefined;
  const matched: Array<{ name: string; rec: CookieRecord }> = [];
  for (const [key, rec] of bucket) {
    if (!cookieMatchesUrl(rec, u)) continue;
    matched.push({ name: cookieNameFromJarKey(key), rec });
  }
  matched.sort((a, b) => b.rec.path.length - a.rec.path.length);
  const parts = matched.map(({ name, rec }) => `${name}=${rec.value}`);
  return parts.length > 0 ? parts.join("; ") : undefined;
}

function cookiePairsOf(header: string): Array<{ name: string; value: string }> {
  const out: Array<{ name: string; value: string }> = [];
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (!name) continue;
    out.push({ name, value });
  }
  return out;
}

/** 설정이 준 Cookie 와 항아리 Cookie 를 합친다 — 설정 것이 앞, 같은 이름은 항아리 값으로 덮는다. */
export function mergeCookieHeader(fromConfig: string | undefined, fromJar: string | undefined): string | undefined {
  if (!fromConfig && !fromJar) return undefined;
  if (!fromConfig) return fromJar;
  if (!fromJar) return fromConfig;
  // 설정 쌍은 순서대로 두고, 항아리 쌍은 같은 이름의 설정 쌍을 (한 번만) 교체하거나 뒤에 붙인다.
  // Map 으로 합치면 항아리의 같은 이름·다른 Path 쿠키(SID=guard; SID=root)가 하나로 뭉개진다.
  const out = cookiePairsOf(fromConfig);
  const configCount = out.length; // 교체 대상은 설정 쌍뿐 — 방금 붙인 항아리 쌍을 다시 교체하면 안 된다
  const replaced = new Set<number>();
  for (const p of cookiePairsOf(fromJar)) {
    const i = out.findIndex((c, idx) => idx < configCount && c.name === p.name && !replaced.has(idx));
    if (i >= 0) { out[i] = p; replaced.add(i); } else out.push(p);
  }
  return out.map(({ name, value }) => `${name}=${value}`).join("; ");
}

async function readBodyCapped(
  res: { body: { getReader: () => { read: () => Promise<{ done: boolean; value?: Uint8Array }>; cancel: () => Promise<void> } } | null },
  ac: AbortController,
  charset: BoardConfig["charset"],
  maxBytes: number,
): Promise<string> {
  if (!res.body) throw new Error("본문 없음");
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        ac.abort();
        throw new Error(`본문 ${Math.round(maxBytes / (1024 * 1024))}MB 초과`);
      }
      chunks.push(value);
    }
  } finally {
    try { await reader.cancel(); } catch { /* already closed */ }
  }
  // 조각마다 Buffer.from 으로 사본을 뜨지 않는다 — Buffer.concat 은 Uint8Array[] 를 그대로 받고,
  // total 을 미리 줘 결과를 정확히 그 길이로 한 번에 만든다(20MB 본문에서 사본 두 겹 제거 — fable 리뷰 중요4).
  const buf = Buffer.concat(chunks, total);
  return decodeBody(buf, charset);
}

const NETWORK_ERR_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "UND_ERR_SOCKET",
]);

/** boardFetch 가 throw 한 네트워크 계층 오류. HTTP 응답(4xx·5xx)은 여기 안 온다. */
function isNetworkLayerError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  if (err instanceof TypeError && /fetch failed/i.test(err.message)) return true;
  const rec = err as { code?: unknown; cause?: unknown };
  const cause = rec.cause && typeof rec.cause === "object" ? (rec.cause as { code?: unknown }) : null;
  return [rec.code, cause?.code].some((c) => typeof c === "string" && NETWORK_ERR_CODES.has(c));
}

/** 재시도 대기 — 그사이 전체 시간초과(ac.abort)가 오면 700ms 를 다 기다리지 않고 바로 깬다(적대 리뷰). */
function waitRetryDelay(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) { resolve(); return; }
    const timer = setTimeout(done, RETRY_DELAY_MS);
    function done() { signal.removeEventListener("abort", done); clearTimeout(timer); resolve(); }
    signal.addEventListener("abort", done, { once: true });
  });
}

async function boardFetchWithNetworkRetry(
  url: string,
  init: Parameters<typeof boardFetch>[1],
  dispatcher: ReturnType<typeof proxyDispatcher>,
  ac: AbortController,
): Promise<Awaited<ReturnType<typeof boardFetch>>> {
  try {
    return await boardFetch(url, init, dispatcher);
  } catch (err) {
    if (ac.signal.aborted || !isNetworkLayerError(err)) throw err;
    await waitRetryDelay(ac.signal);
    if (ac.signal.aborted) throw err;
    try {
      return await boardFetch(url, init, dispatcher);
    } catch {
      throw err;
    }
  }
}

export async function fetchBoardText(
  url: string,
  charset: BoardConfig["charset"],
  cfg: BoardConfig,
  init?: BoardFetchInit,
  /**
   * `signal` — 바깥에서 건 **예산** 표식(수집 꼬리의 4분 예산 등). 이 함수 자신의 시간 상한과
   * 함께 걸려 둘 중 먼저 끝나는 쪽이 요청을 끊는다(2026-09-06 독립 리뷰 5번).
   */
  limits?: { timeoutMs: number; maxBytes: number; signal?: AbortSignal },
): Promise<string> {
  const allowed = new Set(allowedHostsOf(cfg));
  assertAllowedHost(url, allowed);
  // 국내 IP 로만 열리는 출처만 경유한다. 다른 26곳은 지금 그대로 직접 나간다 —
  // 전 통신을 프록시로 보내면 앤트로픽·노션·DB 까지 남의 서버를 거친다(proxy.ts 주석).
  const dispatcher = cfg.requiresProxy ? proxyDispatcher() : undefined;
  if (cfg.requiresProxy && !dispatcher) {
    // boardSyncSources 가 걸러 주므로 정상 경로에서는 여기까지 안 온다(상세 채우기 등 다른 길 대비).
    throw new Error(`${cfg.id}: 국내 경유 설정값이 없어 요청하지 않는다`);
  }
  const timeoutMs = limits?.timeoutMs ?? FETCH_TIMEOUT_MS;
  const maxBytes = limits?.maxBytes ?? FETCH_BODY_MAX_BYTES;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  // 바깥 예산이 먼저 지나면 그 자리에서 끊는다 — 이미 지났으면 요청을 아예 안 보낸다.
  const outer = limits?.signal;
  const onOuterAbort = () => ac.abort();
  if (outer) {
    if (outer.aborted) ac.abort();
    else outer.addEventListener("abort", onOuterAbort, { once: true });
  }
  try {
    let current = url;
    const jar: CookieJar = new Map();
    for (let hop = 0; hop <= 3; hop++) {
      const configHeaders: Record<string, string> = {
        "User-Agent": FETCH_UA,
        "Accept-Language": "ko",
        ...(init?.headers ?? {}),
      };
      const cookie = mergeCookieHeader(configHeaders.Cookie, cookieHeaderFor(jar, current));
      const headers: Record<string, string> = { ...configHeaders };
      if (cookie) headers.Cookie = cookie;
      else delete headers.Cookie;
      const fetchInit = {
        signal: ac.signal,
        redirect: "manual" as const,
        method: init?.method ?? "GET",
        body: init?.body,
        headers,
      };
      const res = await boardFetchWithNetworkRetry(current, fetchInit, dispatcher, ac);
      cookieJarAbsorb(jar, current, setCookieValuesOf(res.headers));
      if (res.status >= 300 && res.status < 400) {
        // 본문을 다시 보낼 수 없는 POST 만 막는다. 헤더만 얹은 GET(국기연 Referer)은 그대로 따라간다.
        if (init?.method === "POST") throw new Error("POST 리다이렉트 미지원");
        if (hop >= 3) throw new Error("리다이렉트 3홉 초과");
        const loc = res.headers.get("location");
        if (!loc) throw new Error("리다이렉트 Location 없음");
        const next = new URL(loc, current).toString();
        assertAllowedHost(next, allowed);
        current = next;
        continue;
      }
      if (!res.ok) throw new Error("HTTP " + res.status);
      return await readBodyCapped(res, ac, charset, maxBytes);
    }
    throw new Error("리다이렉트 3홉 초과");
  } finally {
    clearTimeout(timer);
    if (outer) outer.removeEventListener("abort", onOuterAbort);
  }
}

/**
 * 본문과 **그 응답이 심어 준 쿠키**를 함께 돌려준다 — 자금 조달 지도의 상시 상품 수집기가 쓴다
 * (`src/lib/policy-match/products/fetch.ts`).
 *
 * 왜 fetchBoardText 로는 안 되나: 그쪽 쿠키 항아리는 **한 호출 안에서만** 살고 밖으로 안 나온다.
 * 금감원 개인사업자대출은 ① GET 으로 `WMONID` 를 받고 ② 같은 쿠키를 `Cookie` 헤더에 실어
 * **POST** 로 목록을 받아야 열린다. POST 는 리다이렉트를 못 따라가므로(본문 재전송 불가) 어댑터가
 * 쿠키를 직접 들고 가야 하고, 그러려면 첫 응답의 Set-Cookie 를 밖으로 내줘야 한다.
 *
 * fetchBoardText 와 다른 점은 **리다이렉트를 안 따라간다** 하나뿐이다 — 쿠키를 받으러 가는 첫 요청은
 * 한 홉이면 끝나고, 여러 홉을 따라가면 「어느 홉의 쿠키를 돌려줬는지」가 모호해진다. 3xx 면 오류로 세운다.
 * 검문(허용 호스트)·시간 상한·크기 상한·글자표·국내 경유는 **같은 함수**를 그대로 쓴다 —
 * 여기서 옮겨 적으면 상품 쪽만 방어선이 갈린다.
 */
export async function fetchBoardTextWithCookies(
  url: string,
  charset: BoardConfig["charset"],
  cfg: BoardConfig,
  init?: BoardFetchInit,
  limits?: { timeoutMs: number; maxBytes: number },
): Promise<{ text: string; cookie: string }> {
  const allowed = new Set(allowedHostsOf(cfg));
  assertAllowedHost(url, allowed);
  const dispatcher = cfg.requiresProxy ? proxyDispatcher() : undefined;
  if (cfg.requiresProxy && !dispatcher) {
    throw new Error(`${cfg.id}: 국내 경유 설정값이 없어 요청하지 않는다`);
  }
  const timeoutMs = limits?.timeoutMs ?? FETCH_TIMEOUT_MS;
  const maxBytes = limits?.maxBytes ?? FETCH_BODY_MAX_BYTES;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const headers: Record<string, string> = {
      "User-Agent": FETCH_UA,
      "Accept-Language": "ko",
      ...(init?.headers ?? {}),
    };
    const res = await boardFetchWithNetworkRetry(
      url,
      { signal: ac.signal, redirect: "manual" as const, method: init?.method ?? "GET", body: init?.body, headers },
      dispatcher,
      ac,
    );
    // 항아리에 담았다가 꺼낸다 — Secure·Path 규칙(RFC 6265)을 손으로 다시 쓰지 않기 위해서다.
    const jar: CookieJar = new Map();
    cookieJarAbsorb(jar, url, setCookieValuesOf(res.headers));
    if (res.status >= 300 && res.status < 400) throw new Error("쿠키 받기 요청은 리다이렉트를 따라가지 않는다");
    if (!res.ok) throw new Error("HTTP " + res.status);
    const text = await readBodyCapped(res, ac, charset, maxBytes);
    return { text, cookie: cookieHeaderFor(jar, url) ?? "" };
  } finally {
    clearTimeout(timer);
  }
}

export async function enforceHealCooldown(
  id: string,
  deps: Pick<CollectDeps, "jsonCacheGet" | "jsonCacheSet">,
  now = Date.now(),
): Promise<void> {
  const key = `board-heal-cooldown:${id}`;
  try {
    const last = asFailCount(await deps.jsonCacheGet(key));
    if (last > 0 && now - last < HEAL_COOLDOWN_MS) {
      throw new Error("자가수리 쿨다운 24시간 이내");
    }
  } catch (e) {
    if (e instanceof Error && e.message.includes("쿨다운")) throw e;
  }
  await deps.jsonCacheSet(key, now);
}

function alertStore(id: string, deps: Pick<CollectDeps, "jsonCacheGet" | "jsonCacheSet">) {
  const key = `board-alert:${id}`;
  return {
    get: async () => {
      try {
        return asFailCount(await deps.jsonCacheGet(key));
      } catch {
        return 0;
      }
    },
    set: async (n: number) => {
      await deps.jsonCacheSet(key, n);
    },
  };
}

function capStore(id: string, deps: Pick<CollectDeps, "jsonCacheGet" | "jsonCacheSet">) {
  const key = boardCapKey(id);
  return {
    get: async (): Promise<BoardCapRecord | null> => {
      try {
        return parseBoardCap(await deps.jsonCacheGet(key));
      } catch {
        return null;
      }
    },
    set: async (value: BoardCapRecord) => {
      await deps.jsonCacheSet(key, value);
    },
  };
}

async function realDeps(cfg: BoardConfig, deps: CollectDeps): Promise<BoardDeps> {
  let prevOpenCount = 0;
  try {
    prevOpenCount = await deps.countOpenAnnouncements(
      cfg.id,
      new Date(Date.now() - PREV_OPEN_WINDOW_MS),
    );
  } catch {
    prevOpenCount = 0;
  }
  const runAt = new Date().toISOString();
  return {
    prevOpenCount,
    fetchText: (url, charset, init) => fetchBoardText(url, charset, cfg, init),
    askModel: async (prompt) => {
      await enforceHealCooldown(cfg.id, deps);
      return deps.askModel(prompt);
    },
    onAllFailed: async (c, reason) => {
      const { noteFailureAndMaybeAlert } = await import("./alert");
      const { sendPolicyBoardAlert } = await import("./alert-slack");
      await noteFailureAndMaybeAlert(c.id, reason, {
        send: sendPolicyBoardAlert,
        store: alertStore(c.id, deps),
      });
    },
    onHealedRule: async (rule) => {
      await deps.jsonCacheSet(`board-rule:${cfg.id}`, rule);
    },
    onPageCap: async (info) => {
      await notePageCap(cfg.id, { ...info, runAt }, { store: capStore(cfg.id, deps) });
    },
  };
}

export function boardSyncSources(deps: CollectDeps): AnnouncementSyncSource[] {
  // 설정값 해석은 boardProxyUrl 하나로 통일한다. 여기서 process.env 를 직접 읽으면
  // 공백만 든 값(" ")을 「있다」로 보는데 proxy.ts 는 「없다」로 봐서, 출처가 등록만 되고
  // 매 회차 실패해 알림만 쌓인다 — 이 필터가 막으려던 바로 그 상황이다(적대 리뷰 지적).
  const proxied = boardProxyUrl() !== null;
  return BOARD_SOURCES
    // 국내 경유가 없으면 그 출처는 아예 돌리지 않는다 — 매번 실패해 알림만 쌓인다.
    .filter((cfg) => proxied || !cfg.requiresProxy)
    .map((cfg) => ({
      name: cfg.id,
      clockOnly: true as const,
      staleAfterDays: 30,
      fetchAll: async () => {
        const resolved = await applyPersistedBoardRule(cfg, deps);
        const list = await fetchBoardAll(resolved, await realDeps(resolved, deps));
        try { await noteSuccess(cfg.id, { store: alertStore(cfg.id, deps) }); } catch { /* 리셋 실패는 수집 성공을 막지 않음 */ }
        return list;
      },
    }));
}
