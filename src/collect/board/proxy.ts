import { ProxyAgent, fetch as undiciFetch } from "undici";

/**
 * 국내 IP 로만 열리는 게시판을 위한 **그 출처 전용** 경유.
 *
 * 왜 `NODE_USE_ENV_PROXY` 를 안 쓰나: 그 스위치는 **이 앱의 모든 통신**을 프록시로 보낸다
 * (2026-08-28 실측 — 127.0.0.1:9 로 두자 bizinfo 호출이 ECONNREFUSED 로 죽었다).
 * 그러면 앤트로픽·노션·운영 DB 까지 남의 서버를 거친다. 그래서 요청 하나하나에만 붙인다.
 *
 * 설정값 `POLICY_BOARD_PROXY_URL` 예: `http://아이디:비밀번호@1.2.3.4:3128`
 */
const ENV_KEY = "POLICY_BOARD_PROXY_URL";

let cached: { url: string; agent: ProxyAgent } | null = null;

let warnedBad = "";

/**
 * 설정값이 **쓸 수 있는 형태일 때만** 그 주소를, 아니면 null.
 *
 * 「있기만 하면 있다」로 보면 안 되는 이유 두 가지(적대 리뷰 지적):
 * ① 공백만 든 값이나 형식이 깨진 값이면, 출처는 수집 목록에 등록되는데 요청은 매번 실패해
 *    **12시간마다 실패 알림만 쌓인다** — 걸러내기가 막으려던 바로 그 상황이다.
 * ② 형식이 깨진 값을 `new ProxyAgent()` 에 넘기면 던지는 오류의 `input` 속성에
 *    **비밀번호가 그대로 들어간다**(실측). 그 오류 객체를 통째로 찍는 자리가 있으면 로그로 샌다.
 *    여기서 미리 걸러 아예 만들지 않는 것이 가장 확실하다.
 */
export function boardProxyUrl(): string | null {
  const raw = process.env[ENV_KEY]?.trim();
  if (!raw) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    // 원문을 찍지 않는다 — 형식이 깨졌어도 비밀번호가 들어 있을 수 있다.
    if (warnedBad !== raw) {
      warnedBad = raw;
      console.error(`[board-proxy] ${ENV_KEY} 형식이 잘못돼 경유를 쓰지 않는다: ${maskProxyUrl(raw)}`);
    }
    return null;
  }
  if ((u.protocol !== "http:" && u.protocol !== "https:") || !u.hostname) {
    if (warnedBad !== raw) {
      warnedBad = raw;
      console.error(`[board-proxy] ${ENV_KEY} 는 http/https 주소여야 한다: ${maskProxyUrl(raw)}`);
    }
    return null;
  }
  return raw;
}

/** 시험용 — 「같은 잘못된 값은 한 번만 경고」 상태를 지운다. */
export function resetProxyWarnForTest(): void {
  warnedBad = "";
  warnedUnavailable = false;
}

/**
 * 로그·오류에 그대로 못 쓰게 자격증명을 지운 형태.
 * 프록시 주소에는 비밀번호가 들어 있을 수 있다 — 절대 원문을 찍지 않는다.
 */
export function maskProxyUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.username ? "***@" : ""}${u.host}`;
  } catch {
    return "(형식이 잘못된 프록시 주소)";
  }
}

/**
 * 이 요청을 프록시로 보내야 하면 dispatcher 를, 아니면 undefined 를 준다.
 * 같은 주소면 agent 를 재사용한다 — 요청마다 새로 만들면 연결이 쌓인다.
 */
export function proxyDispatcher(): ProxyAgent | undefined {
  const url = boardProxyUrl();
  if (!url) return undefined;
  if (cached && cached.url === url) return cached.agent;
  try {
    cached = { url, agent: new ProxyAgent(url) };
  } catch (e) {
    // 두 겹째 방어. 여기 오는 오류의 `input` 속성에는 비밀번호가 들어 있으므로
    // **원본 오류를 그대로 흘려보내지 않는다** — 부르는 쪽이 객체째 로그에 찍는 자리가 있다.
    cached = null;
    throw new Error(
      `[board-proxy] 경유 통로를 만들지 못했다(${maskProxyUrl(url)}): ` +
        (e instanceof Error ? e.message : String(e)),
    );
  }
  return cached.agent;
}

/** 시험에서 캐시를 비운다. 운영 코드에서는 부르지 않는다. */
export function resetProxyCacheForTest(): void {
  cached = null;
}

let warnedUnavailable = false;

/**
 * 첨부 경유를 **실제로 쓸 수 있는가**. 변수만 보면 안 되는 이유(2026-09-06 적대 리뷰):
 * 형식이 깨진 값이면 `proxyDispatcher()` 가 **던진다** — 그 호출이 try 밖에 있으면
 * 수집 틱 한 회차가 통째로 죽는다(첨부뿐 아니라 다른 26개 출처까지).
 *
 * 줄서기(`attachmentFillQueueWhere`)와 실제 처리(`fillBodiesFromAttachments`)가
 * **이 함수 하나**를 같이 써야, 관리자 일괄 실행의 「남은 건수」와 처리 대상이 갈리지 않는다.
 * 던지지 않는다 — 못 만들면 경고 한 번(원문·자격증명은 이미 가려져 있다) 뒤 거짓.
 */
export function attachmentProxyAvailable(): boolean {
  if (boardProxyUrl() === null) return false;
  try {
    return proxyDispatcher() !== undefined;
  } catch (e) {
    if (!warnedUnavailable) {
      warnedUnavailable = true;
      console.warn(
        "[board-proxy] 경유 통로를 만들지 못해 국내 전용 출처를 건너뛴다: " +
          (e instanceof Error ? e.message : String(e)),
      );
    }
    return false;
  }
}

/** 수집기가 쓰는 응답의 최소 모양. 전역 fetch 와 설치판 undici 응답 둘 다 이 모양을 만족한다. */
export interface BoardResponse {
  status: number;
  ok: boolean;
  headers: { get: (name: string) => string | null };
  body: { getReader: () => { read: () => Promise<{ done: boolean; value?: Uint8Array }>; cancel: () => Promise<void> } } | null;
}

/**
 * 경유가 필요하면 **설치판 undici 의 fetch** 로, 아니면 전역 fetch 로 보낸다.
 *
 * 왜 갈라야 하나(2026-08-28 실측): 전역 `fetch` 는 **Node 안에 박힌 undici** 라서,
 * npm 으로 설치한 undici 의 `ProxyAgent` 를 넘기면 판이 달라 거부한다 —
 * `UND_ERR_INVALID_ARG invalid onRequestStart method`. 같은 agent 를 **설치판 fetch** 에 주면
 * 정상으로 돈다(전북TP 200·64KB·프록시 경유 확인). 경유가 없는 26곳은 전역 fetch 그대로다.
 */
export async function boardFetch(
  url: string,
  init: {
    signal: AbortSignal;
    redirect: "manual";
    method: string;
    body?: string;
    headers: Record<string, string>;
  },
  dispatcher?: ProxyAgent,
): Promise<BoardResponse> {
  if (dispatcher) {
    return (await undiciFetch(url, { ...init, dispatcher })) as unknown as BoardResponse;
  }
  return (await fetch(url, init)) as unknown as BoardResponse;
}

/**
 * 첨부 내려받기가 상한을 스스로 안 걸어 왔을 때만 쓰는 예비 시간 상한.
 * 지금 부르는 쪽(`attachment-text.ts`)은 늘 자기 `signal` 을 붙여 오므로 평소엔 쓰이지 않는다 —
 * 상한 없는 요청이 새 갈래로 생기지 않게 막아 두는 자리다.
 */
const ATTACHMENT_FALLBACK_TIMEOUT_MS = 30_000;

/**
 * **경유 통로 자체가 막힌** 실패에 붙이는 표식.
 *
 * 왜 갈라야 하나(2026-09-05 적대 리뷰 중간): 사이트가 「그런 파일 없다(404)」고 답한 것과,
 * 우리 경유가 죽어서(연결 거부·CONNECT 거부·프록시가 만든 401·403·500) 아예 못 물어본 것은
 * **다시 시도할 값어치가 다르다.** 구분 없이 7일 도장을 찍으면, 프록시가 한 시간 죽은 사이
 * 지나간 공고들이 그 7일 내내 재시도에서 빠진다.
 */
const PROXY_TRANSPORT_FAILURE = Symbol.for("wedly.policy-board.proxyTransportFailure");

/**
 * tinyproxy 는 **자기가 만든 응답에 전부** 이 머리글을 붙인다(2026-09-06 curl 실측, 1.11.1):
 * 허용 밖 호스트 `403 Filtered` · 허용 밖 포트 `403 Access violation` ·
 * 상대가 안 열리면 120초 뒤 `500 Unable to connect` · **인증 실패는 `401`(407 아니다)**.
 * 상태코드로는 사이트가 준 값과 구분이 안 되므로 **머리글**로 가른다.
 */
const PROXY_SERVER_HINT = "tinyproxy";

/** 프록시 **호스트 자체**에 못 닿은 것 — 사이트는 물어보지도 못했다. */
const PROXY_TRANSPORT_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ENOTFOUND",
  "EPIPE",
  "ETIMEDOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_SOCKET",
]);

/**
 * https 는 CONNECT 터널이라, 프록시가 CONNECT 를 거부하면 undici `ProxyAgent` 는 응답을 주지 않고
 * **이 문구로 던진다**(node_modules/undici/lib/dispatcher/proxy-agent.js:230).
 * `code` 는 `UND_ERR_ABORTED` 로 **우리가 건 시간 상한과 같아서**, 문구로만 갈린다.
 */
const TUNNEL_REFUSED_RE = /Proxy response \(\d{3}\) !== 200 when HTTP Tunneling/;

/**
 * 던져진 오류가 **통로 탓**인가.
 * ★abort·시간초과를 **맨 먼저** 걸러낸다 — `downloadBytes` 의 30초 상한이 프록시 자체 120초보다
 *  먼저 터져 `TimeoutError`(DOMException) 로 온다. 그건 **상대가 느리거나 막은 것**이라 사이트 탓이다.
 */
function isTransportThrow(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const rec = e as { name?: unknown; code?: unknown; cause?: { code?: unknown }; message?: unknown };
  if (rec.name === "AbortError" || rec.name === "TimeoutError") return false;
  const code = typeof rec.code === "string" ? rec.code : rec.cause?.code;
  if (typeof code === "string" && PROXY_TRANSPORT_CODES.has(code)) return true;
  return typeof rec.message === "string" && TUNNEL_REFUSED_RE.test(rec.message);
}

/** 그 실패가 **사이트 탓이 아니라 경유 통로 탓**인가. */
export function isProxyTransportError(e: unknown): boolean {
  return (
    !!e &&
    typeof e === "object" &&
    (e as Record<symbol, unknown>)[PROXY_TRANSPORT_FAILURE] === true
  );
}

/** 원인 코드만 남긴 오류 — 원본 메시지는 쓰지 않는다(경유 주소·자격증명이 섞여 있을 수 있다). */
function proxyTransportError(reason: string): Error {
  const err = new Error(`[board-proxy] 경유 통로가 응답하지 않는다: ${reason}`);
  Object.defineProperty(err, PROXY_TRANSPORT_FAILURE, { value: true });
  return err;
}

/**
 * 밖에서 만든 오류에 **통로 탓** 표식을 붙인다(표식 심볼 자체는 이 파일 밖으로 안 내보낸다).
 *
 * 쓰는 곳: 첨부 세션 데우기(`attachment-session.ts`). 상세 세션을 못 받으면 그 게시판 첨부는
 * **200 + 안내 HTML** 로 돌아온다 — 사이트가 「그런 파일 없다」고 답한 것이 아니라 **우리가 세션을
 * 못 얻은 것**이라, 7일 도장이 아니라 1시간 뒤 다시 봐야 한다(2026-09-06 독립 리뷰 3번).
 */
export function markProxyTransportError(err: Error): Error {
  Object.defineProperty(err, PROXY_TRANSPORT_FAILURE, { value: true });
  return err;
}

/** 통로 탓이 **아닌** 실패 — 표식은 안 붙이되 원본 메시지도 쓰지 않는다(같은 유출 이유). */
function siteFetchError(reason: string): Error {
  return new Error(`[board-proxy] 첨부를 받지 못했다: ${reason}`);
}

/**
 * 원인 한 마디.
 * ★`code` 가 문자열이 아닐 때(DOMException 은 `code` 가 **숫자** 23) `name` 을 쓴다 —
 *  안 그러면 시간초과·abort 가 전부 「요청 실패」로 뭉개져 로그로 원인을 못 가른다.
 */
function reasonCodeOf(e: unknown): string {
  const rec = (e ?? {}) as { code?: unknown; name?: unknown; cause?: { code?: unknown } };
  const code = typeof rec.code === "string" ? rec.code : rec.cause?.code;
  if (typeof code === "string" && code) return code;
  return typeof rec.name === "string" && rec.name ? rec.name : "요청 실패";
}

/** `RequestInit.headers` 세 가지 모양(Headers·배열·객체)을 boardFetch 가 받는 평평한 객체로. */
function normalizeHeaders(h: RequestInit["headers"]): Record<string, string> {
  if (!h) return {};
  if (typeof Headers !== "undefined" && h instanceof Headers) return Object.fromEntries(h.entries());
  if (Array.isArray(h)) return Object.fromEntries(h);
  return { ...(h as Record<string, string>) };
}

/**
 * 첨부(PDF·HWP) 내려받기를 **목록·상세와 같은 국내 경유**로 보내는 요청 함수를 만든다.
 *
 * 왜 필요한가(2026-09-05 적대 리뷰 P0 #4): `requiresProxy` 게시판은 목록·상세만 경유로 나가고
 * 첨부는 전역 fetch 로 나갔다. 미국 서버에서는 그 사이트의 첨부가 안 열려 본문이 빈 채로 남는다
 * (서울신보는 자격조건이 **첨부에만** 있다).
 *
 * 통로는 `boardFetch` 하나만 쓴다 — 여기서 undici 를 새로 부르면 「전역 fetch 에 설치판
 * ProxyAgent 를 넘겨 거부당하는」 함정(위 주석)을 갈래마다 다시 밟게 된다.
 *
 * `send` 는 시험이 통로를 갈아 끼우는 자리다 — 운영에서는 늘 기본값(boardFetch)이다.
 */
export function proxiedAttachmentFetch(
  dispatcher: ProxyAgent,
  send: typeof boardFetch = boardFetch,
): (url: string, init?: RequestInit) => Promise<Response> {
  return async (url: string, init?: RequestInit) => {
    const signal = init?.signal;
    let res: BoardResponse;
    try {
      res = await send(
        url,
        {
          signal: signal instanceof AbortSignal ? signal : AbortSignal.timeout(ATTACHMENT_FALLBACK_TIMEOUT_MS),
          // 리다이렉트는 부르는 쪽이 홉마다 허용 호스트를 다시 검사하며 손으로 따라간다.
          redirect: "manual",
          method: init?.method ?? "GET",
          // ★본문도 그대로 넘긴다 — 안 넘기면 경유가 필요한 게시판에서 열쇠 발급 POST 가
          //  **빈 몸으로** 나가 열쇠를 못 받는다(2026-09-06 독립 리뷰 3번). 첨부 GET 은 본문이 없어
          //  예전과 같다. 글자만 받는다 — 스트림 본문은 경유 통로에서 다시 읽을 수 없다.
          ...(typeof init?.body === "string" ? { body: init.body } : {}),
          // 부르는 쪽이 머리글을 붙였으면 그대로 넘긴다 — 빈 객체로 덮어 조용히 버리면
          // 나중에 Referer·쿠키를 붙이는 갈래가 생겼을 때 경유 길에서만 소리 없이 사라진다.
          headers: normalizeHeaders(init?.headers),
        },
        dispatcher,
      );
    } catch (e) {
      // 프록시 호스트에 못 닿았거나(ECONNREFUSED 등) CONNECT 를 거부당했으면 통로 탓,
      // 우리 30초 상한이 먼저 터진 것이면 **사이트 탓**이다.
      throw isTransportThrow(e) ? proxyTransportError(reasonCodeOf(e)) : siteFetchError(reasonCodeOf(e));
    }
    // 응답을 **프록시가 만들었으면** 상태코드와 무관하게 통로 탓이다(401·403·500 전부).
    // 407 만 특별 취급하던 옛 규칙은 여기에 흡수됐다 — 실측상 tinyproxy 인증 실패는 401 이다.
    if ((res.headers.get("server") ?? "").toLowerCase().includes(PROXY_SERVER_HINT)) {
      const body = res.body as { cancel?: () => Promise<unknown> } | null;
      if (body?.cancel) await body.cancel().catch(() => {});
      throw proxyTransportError(`HTTP ${res.status}`);
    }
    return res as unknown as Response;
  };
}
