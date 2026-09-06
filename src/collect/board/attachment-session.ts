// 첨부 내려받기에 상세 세션(쿠키)·Referer 가 필요한 게시판을 위한 요청 감싸개.
import type { AttachmentFetch } from "../attachment-text";
import { allowedHostsOf } from "./engine";
import { markProxyTransportError } from "./proxy";
import { cookieHeaderFor, cookieJarAbsorb, mergeCookieHeader, setCookieValuesOf, type CookieJar } from "./registry";
import type { BoardConfig } from "./types";

/**
 * 부르는 쪽이 자기 시간 상한을 안 줬을 때만 쓰는 예비값.
 * 평소엔 첨부 내려받기(`downloadBytes`)가 만든 **하나의 30초 신호**를 그대로 물려받는다 —
 * 홉마다 새 신호를 만들면 상세가 홉마다 14초씩 끌 때 부르는 쪽 상한을 넘긴다(2026-09-06 독립 리뷰 5번).
 */
const WARMUP_TIMEOUT_MS = 15_000;
/** 데우기가 따라갈 리다이렉트 홉 수. `downloadBytes` 와 **같이** `hop <= 3`(요청 네 번)이다(독립 리뷰 6번). */
const WARMUP_MAX_HOPS = 3;
/**
 * CSRF 토큰을 찾느라 읽는 상세 본문의 상한(바이트). 실측 상세는 4만 바이트 안쪽이라
 * (여성기업센터 39,548바이트) 넉넉하고, 사이트가 끝없는 본문을 흘려도 메모리가 안 찬다.
 */
const WARMUP_HTML_MAX_CHARS = 400_000;

/** 데우기 결과 — 쿠키 항아리 + (토큰이 필요할 때만) 상세 HTML. */
type Warmup = { jar: CookieJar; html: string };

/**
 * 응답 글자를 **상한까지만** 읽고 나머지는 끊는다.
 *
 * ★`res.text()` 를 쓰면 안 된다(2026-09-06 보안 리뷰 4번): 그건 본문을 **끝까지 다 받은 뒤**
 *  잘라 낸다. 상대 서버가(또는 중간의 경유가) 끝없는 본문을 흘리면 우리 서버 메모리가 그대로 찬다.
 *  토큰은 상세 머리쪽 `<form>` 에 있어 앞부분만 읽으면 충분하다.
 * 읽다 실패하면 빈 글자다 — 토큰만 못 얻고, 쿠키는 이미 항아리에 있어 데우기 자체는 성공으로 둔다.
 */
async function readCapped(res: Response, maxBytes: number): Promise<string> {
  const body = res.body;
  if (!body) {
    // 스트림이 없는 응답(시험용 가짜 등)은 예전 길로 — 그때도 글자 수를 잘라 둔다.
    try {
      return (await res.text()).slice(0, maxBytes);
    } catch {
      return "";
    }
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;
      chunks.push(value);
      total += value.byteLength;
    }
  } catch {
    return "";
  } finally {
    // 상한에서 멈췄으면 **남은 본문을 끊는다** — 안 끊으면 연결이 남는다.
    await reader.cancel().catch(() => {});
  }
  const buf = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    buf.set(c, at);
    at += c.byteLength;
  }
  return new TextDecoder("utf-8").decode(buf);
}

/** 감싸개를 안 쓸 때의 기본 통로. 경유가 필요한 출처는 부르는 쪽이 `proxiedAttachmentFetch` 를 넘긴다. */
const DEFAULT_FETCH: AttachmentFetch = (url, init) => fetch(url, init);

/** `RequestInit.headers` 세 가지 모양(Headers·배열·객체)을 평평한 객체로. 이름의 대소문자는 그대로 둔다. */
function normalizeHeaders(h: RequestInit["headers"]): Record<string, string> {
  if (!h) return {};
  if (typeof Headers !== "undefined" && h instanceof Headers) return Object.fromEntries(h.entries());
  if (Array.isArray(h)) return Object.fromEntries(h);
  return { ...(h as Record<string, string>) };
}

/** 그 이름의 머리글이 이미 있으면 **그 키**를(대소문자 그대로), 없으면 undefined. */
function headerKeyOf(headers: Record<string, string>, name: string): string | undefined {
  const want = name.toLowerCase();
  return Object.keys(headers).find((k) => k.toLowerCase() === want);
}

/** http(s) 이고 명부가 허락한 호스트인가. 상세 주소는 **저장된 값**이라 그대로 믿지 않는다. */
function isAllowedUrl(url: string, allowed: Set<string>): boolean {
  if (!/^https?:\/\//i.test(url.trim())) return false;
  try {
    return allowed.has(new URL(url).host);
  } catch {
    return false;
  }
}

/** 데우기 실패는 **통로 탓**이다 — 원본 메시지는 안 쓴다(경유 주소·쿠키가 섞일 수 있다). */
function warmupFailed(reason: string): Error {
  return markProxyTransportError(new Error(`[attachment-session] 상세 세션을 받지 못했다: ${reason}`));
}

/** 원인 한 마디. DOMException 은 `code` 가 숫자라 `name`(TimeoutError·AbortError)을 쓴다. */
function reasonOf(e: unknown): string {
  const rec = (e ?? {}) as { code?: unknown; name?: unknown; cause?: { code?: unknown } };
  const code = typeof rec.code === "string" ? rec.code : rec.cause?.code;
  if (typeof code === "string" && code) return code;
  return typeof rec.name === "string" && rec.name ? rec.name : "요청 실패";
}

/**
 * 상세 주소를 GET 해 쿠키를 모은다. 본문은 읽지 않고 곧바로 닫는다.
 *
 * 리다이렉트는 **손으로** 따라간다 — 홉마다 허용 호스트를 다시 보고, 홉마다 받은 쿠키를 항아리에 쌓는다.
 * 항아리(`registry.ts`)를 그대로 쓰는 이유: Secure·Path·만료 규칙(RFC 6265)을 여기 다시 옮겨 적으면
 * 목록 쪽과 첨부 쪽의 쿠키 규칙이 갈린다.
 *
 * ★실패는 **삼키지 않고 던진다**(2026-09-06 독립 리뷰 3번). 예전엔 500·시간초과·연결 실패를 전부
 *  빈 항아리로 삼켰는데, 그러면 그 뒤 첨부가 「200 + 잘못된 접근 HTML」로 와서 **파일 형식 실패**로
 *  분류되고 7일 도장이 찍혔다 — 잠깐의 세션 발급 장애가 일주일짜리 누락이 된다.
 *  통로 탓 표식을 달아 던지면 `fetchAttachmentTexts` 가 `proxyFailed` 로 세고 1시간 도장이 찍힌다.
 */
async function warmupCookieJar(
  detailUrl: string,
  baseFetch: AttachmentFetch,
  referer: string,
  allowed: Set<string>,
  signal: AbortSignal,
  /** 1회용 CSRF 토큰이 필요하면 켠다 — 그때만 데우기 응답의 **글자**를 읽는다(평소엔 곧바로 닫는다). */
  readHtml = false,
): Promise<Warmup> {
  const jar: CookieJar = new Map();
  let target = detailUrl;
  for (let hop = 0; hop <= WARMUP_MAX_HOPS; hop++) {
    let res: Response;
    try {
      const headers: Record<string, string> = {};
      const cookie = cookieHeaderFor(jar, target);
      if (cookie) headers.Cookie = cookie;
      if (referer) headers.Referer = referer;
      res = await baseFetch(target, { signal, redirect: "manual", headers });
    } catch (e) {
      // 시간초과·연결 실패·경유 죽음 — 전부 「우리가 세션을 못 얻었다」다.
      throw warmupFailed(reasonOf(e));
    }
    cookieJarAbsorb(jar, target, setCookieValuesOf(res.headers));
    const ok = res.status >= 200 && res.status < 300;
    // 토큰이 필요한 마지막 홉에서만 글자를 읽는다. 그 밖엔 본문을 안 쓰므로 곧바로 닫는다(연결 남김 방지).
    let html = "";
    if (readHtml && ok) {
      html = await readCapped(res, WARMUP_HTML_MAX_CHARS);
    } else {
      await res.body?.cancel().catch(() => {});
    }
    if (ok) return { jar, html };
    if (res.status < 300 || res.status >= 400) throw warmupFailed(`HTTP ${res.status}`);
    const loc = res.headers.get("location");
    if (!loc) throw warmupFailed(`HTTP ${res.status} (다음 주소 없음)`);
    let next: string;
    try {
      next = new URL(loc, target).toString();
    } catch {
      throw warmupFailed(`HTTP ${res.status} (다음 주소가 형식 오류)`);
    }
    if (!isAllowedUrl(next, allowed)) throw warmupFailed(`HTTP ${res.status} (허용되지 않은 호스트로 이동)`);
    target = next;
  }
  throw warmupFailed("리다이렉트가 끝나지 않는다");
}

/**
 * 그 공고의 첨부를 **상세 세션으로** 받는 요청 함수. 설정이 없거나 쓸 수 없으면 `undefined` —
 * 부르는 쪽은 예전 통로(전역 fetch 또는 경유)를 그대로 쓴다.
 *
 * `baseFetch` 위에 **겹친다**. 국내 경유가 필요한 출처는 `proxiedAttachmentFetch(dispatcher)` 를
 * 넘기면 데우기·첨부 요청이 전부 그 경유를 탄다 — 경유는 우리가 붙인 머리글을 그대로 통과시킨다
 * (`proxy.ts` 의 `normalizeHeaders`).
 *
 * 쿠키는 **이 함수가 만든 감싸개 하나당 한 번만** 데운다. 부르는 쪽이 공고 한 줄마다 새로 만들므로
 * 곧 「한 줄에 한 번」이고, 그 줄의 첨부 여러 개는 같은 쿠키를 나눠 쓴다. 데우기가 실패하면
 * **그 줄의 첨부 요청이 전부** 통로 탓 오류로 떨어진다(재시도는 1시간 뒤).
 */
export function sessionAttachmentFetch(
  cfg: BoardConfig | undefined,
  detailUrl: string,
  baseFetch: AttachmentFetch = DEFAULT_FETCH,
): AttachmentFetch | undefined {
  const session = cfg?.attachmentSession;
  if (!cfg || !session) return undefined;
  const allowed = new Set(allowedHostsOf(cfg));
  const detail = (detailUrl ?? "").trim();
  // 상세 주소가 명부 밖이면 데우지도, Referer 로 쓰지도 않는다 — 저장된 값을 그대로 부르면
  // 남의 서버에 우리 요청을 대신 보내는 통로가 된다(첨부 주소 검문과 같은 이유).
  const safeDetail = isAllowedUrl(detail, allowed) ? detail : "";
  const referer = session.referer === "detail" ? safeDetail : (session.referer ?? "");
  const warmup = session.warmup === "detail" && !!safeDetail;
  // 붙일 것이 하나도 없으면 감싸지 않는다 — 예전 통로 그대로가 낫다.
  if (!warmup && !referer) return undefined;

  // 토큰은 **데우기가 켜져 있을 때만** 쓸 수 있다 — 쿠키와 같은 응답에서 나와야 짝이 맞는다.
  const csrf = warmup ? session.csrf : undefined;

  const empty: Warmup = { jar: new Map(), html: "" };
  let warming: Promise<Warmup> | null = null;
  /** ★상한은 **첫 첨부 요청이 들고 온 신호**를 그대로 쓴다 — 데우기와 내려받기가 한 예산을 나눈다. */
  const warmupOf = (signal?: AbortSignal): Promise<Warmup> => {
    if (!warmup) return Promise.resolve(empty);
    if (!warming) {
      warming = warmupCookieJar(
        safeDetail,
        baseFetch,
        referer,
        allowed,
        signal ?? AbortSignal.timeout(WARMUP_TIMEOUT_MS),
        !!csrf,
      );
    }
    return warming;
  };

  return async (url, init) => {
    const { jar, html } = await warmupOf(init?.signal instanceof AbortSignal ? init.signal : undefined);
    const headers = normalizeHeaders(init?.headers);
    const refKey = headerKeyOf(headers, "referer");
    if (referer && !refKey) headers.Referer = referer;
    // 쿠키는 **그 첨부 주소**에 맞는 것만 싣고(Secure·Path — 항아리가 판단한다),
    // 부르는 쪽이 이미 넣어 둔 쿠키가 있으면 **버리지 않고 합친다**(독립 리뷰 7번).
    const cookieKey = headerKeyOf(headers, "cookie");
    const merged = mergeCookieHeader(cookieKey ? headers[cookieKey] : undefined, cookieHeaderFor(jar, url));
    if (merged) headers[cookieKey ?? "Cookie"] = merged;
    let body: string | undefined;
    if (csrf) {
      const got = csrf.extract(html);
      if (!got?.token) {
        /**
         * ★조용히 넘어가지 않는다(2026-09-06 독립 리뷰 「중요」). 토큰 없이 보내면 사이트가
         * **404 + 95바이트 HTML** 을 주는데, 그건 뒷단계에서 「읽지 못한 첨부」= 파일 형식 실패로
         * 분류돼 **7일 도장**이 찍힌다 — 상세 서식이 잠깐 바뀐 날의 사고가 일주일 누락이 된다.
         * 통로 탓 표식을 달아 던지면 `fetchAttachmentTexts` 가 `proxyFailed` 로 세고 1시간 도장을 찍는다.
         */
        console.warn("[attachment-session] 상세에서 CSRF 토큰을 못 뽑았다", cfg.id, safeDetail);
        throw markProxyTransportError(new Error("[attachment-session] 상세에서 CSRF 토큰을 못 뽑았다"));
      }
      body = withCsrfField(init, got.field || csrf.field, got.token);
    }
    return baseFetch(url, body === undefined ? { ...init, headers } : { ...init, headers, body });
  };
}

/**
 * POST 본문 끝에 `field=token` 을 붙인다. 붙일 수 없으면 `undefined`(본문을 안 건드린다).
 *
 * 붙이지 않는 자리: GET · 본문이 글자가 아닌 요청(form-data·바이트) · 이미 같은 이름이 들어
 * 있을 때. **없는 본문을 새로 만들지도 않는다** — 토큰만 든 POST 는 그 게시판에서 어차피
 * 거부고, 조용히 모양을 바꾸면 다른 출처의 요청까지 달라진다.
 */
function withCsrfField(init: RequestInit | undefined, field: string, token: string): string | undefined {
  if (!token || !field) return undefined;
  const method = (init?.method ?? "GET").toUpperCase();
  if (method !== "POST") return undefined;
  const body = init?.body;
  if (typeof body !== "string" || !body) return undefined;
  const name = encodeURIComponent(field);
  // ★이름으로 **정규식을 만들지 않는다**(2026-09-06 보안 리뷰 6번). 사이트가 `#hdCsrfNm` 에
  //  짝 안 맞는 괄호 같은 글자를 넣으면 `new RegExp` 가 그 자리에서 던지는데, 그 예외에는
  //  통로 탓 표식이 없어 「파일 형식 실패」로 7일 도장이 찍힌다. 글자 비교로만 확인한다.
  if (body === `${name}=` || body.startsWith(`${name}=`) || body.includes(`&${name}=`)) return undefined;
  return `${body}&${name}=${encodeURIComponent(token)}`;
}

/**
 * 요청 **사이**에 간격을 두는 감싸개. 한 공고 안의 데우기→첨부1→첨부2 도 같은 서버를 연달아
 * 두드리는 것이라 간격이 필요하다(2026-09-06 독립 리뷰 4번 — 예전엔 공고 사이에만 있었다).
 *
 * 근거(2026-08-31 실측): 빠른 연속 217건 내려받기 뒤 정상 추출되던 10건이 갑자기 짧은 거부 문구만
 * 돌려줬고, 몇 분 뒤 같은 행을 다시 열면 그대로 성공했다 — 상대 서버 속도 제한이다.
 */
export function pacedAttachmentFetch(baseFetch: AttachmentFetch, gapMs: number): AttachmentFetch {
  let sent = 0;
  return async (url, init) => {
    if (sent > 0 && gapMs > 0) await new Promise((r) => setTimeout(r, gapMs));
    sent += 1;
    return baseFetch(url, init);
  };
}
