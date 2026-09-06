// 첨부를 내려받기 **전에 1회용 열쇠를 발급받아야** 하는 게시판을 위한 요청 감싸개.
import type { AttachmentFetch } from "../attachment-text";
import { allowedHostsOf } from "./engine";
import { markProxyTransportError } from "./proxy";
import type { BoardAttachmentToken, BoardConfig } from "./types";

/** 부르는 쪽이 시간 상한을 안 걸어 왔을 때만 쓰는 예비값. 실측 0.3초 안이라 넉넉하다. */
const TOKEN_TIMEOUT_MS = 15_000;
/**
 * 열쇠 응답을 받아 둘 최대 크기. 발급처가 장애 화면을 몇백 MB 씩 흘려보내도 여기서 끊는다
 * (2026-09-06 독립 리뷰 4번 — 첨부 내려받기의 10MB 상한은 이 **앞선** 요청에 안 걸린다).
 * 실측 응답은 51바이트다.
 */
const TOKEN_BODY_MAX_BYTES = 64 * 1024;
/** 열쇠 값에 허용하는 글자. 주소에 그대로 붙는 값이라 좁게 받는다(실측 값은 16자 영숫자). */
const TOKEN_VALUE = /^[A-Za-z0-9._~:-]{1,128}$/;
/** 감싸개를 안 쓸 때의 기본 통로. 경유가 필요한 출처는 부르는 쪽이 `proxiedAttachmentFetch` 를 넘긴다. */
const DEFAULT_FETCH: AttachmentFetch = (url, init) => fetch(url, init);

/** http(s) 이고 명부가 허락한 호스트인가. 저장된 첨부 주소를 그대로 믿지 않는다. */
function isAllowedUrl(url: string, allowed: Set<string>): boolean {
  if (!/^https?:\/\//i.test(url.trim())) return false;
  try {
    return allowed.has(new URL(url).host);
  } catch {
    return false;
  }
}

/** 주소에 그 변수가 이미 붙어 있나(리다이렉트 홉에서 열쇠를 두 번 붙이지 않으려고). */
function hasParam(url: string, param: string): boolean {
  const esc = param.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`[?&]${esc}=`).test(url);
}

/**
 * 주소 끝에 `&<변수>=<값>` 을 **글자로** 붙인다.
 *
 * ★`new URL()` + `searchParams.set()` 을 쓰면 안 된다 — 그 길은 쿼리 전체를 UTF-8 기준으로
 *  다시 인코딩해서, euc-kr 게시판을 위해 공들여 만든 `%BA%D9…` 를 망가뜨린다
 *  (`attachment-url.ts` 참고). 값만 `encodeURIComponent` 로 감싸 구분자 주입을 막는다.
 */
function withParam(url: string, param: string, value: string): string {
  return `${url}${url.includes("?") ? "&" : "?"}${encodeURIComponent(param)}=${encodeURIComponent(value)}`;
}

/** 응답 본문을 **상한까지만** 흘려 읽는다. 넘으면 던진다 — content-length 는 믿지 않는다. */
async function readCapped(res: Response, maxBytes: number): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) throw new Error(`열쇠 응답이 ${maxBytes}바이트를 넘는다`);
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf-8");
}

/**
 * 열쇠를 한 번 받아 온다.
 *
 * ★실패하면 **통로 탓 표식을 단 오류로 던진다**(2026-09-06 독립 리뷰 1번).
 *  예전엔 빈 문자열로 삼켜 열쇠 없는 GET 으로 떨어졌는데, 시흥 서버는 그 GET 에
 *  **200 + 안내 HTML** 을 준다 — 뒷단계는 「파일을 못 읽었다」로 적고 수집 틱은 **7일 도장**,
 *  구조화는 첨부 없는 판정을 `needs_review` 로 굳혀 버린다. 발급처가 몇 분 뒤 살아나도
 *  그 결과는 다시 안 읽힌다. 표식이 붙으면 `fetchAttachmentTexts` 가 `proxyFailed` 로 세어
 *  수집 틱은 **1시간 짧은 도장**, 구조화는 값을 저장하지 않고 `skipped` 로 접는다.
 */
async function issueToken(
  endpoint: string,
  token: BoardAttachmentToken,
  baseFetch: AttachmentFetch,
  signal: AbortSignal | null | undefined,
): Promise<string> {
  let res: Response;
  try {
    res = await baseFetch(endpoint, {
      method: token.method,
      body: token.body,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      // ★부르는 쪽 신호를 그대로 쓴다 — 안 그러면 바깥이 2초에 끊겨도 이 POST 는 자체 15초를
      //  다 기다린 뒤 **이미 취소된** 첨부 GET 을 부른다(독립 리뷰 6번).
      signal: signal ?? AbortSignal.timeout(TOKEN_TIMEOUT_MS),
      redirect: "manual",
    });
  } catch (e) {
    throw tokenFailure(e instanceof Error ? e.message : String(e));
  }
  if (!res.ok) {
    await res.body?.cancel().catch(() => {});
    throw tokenFailure(`HTTP ${res.status}`);
  }
  let value: string;
  try {
    value = (token.extract(await readCapped(res, TOKEN_BODY_MAX_BYTES)) ?? "").trim();
  } catch (e) {
    throw tokenFailure(e instanceof Error ? e.message : String(e));
  }
  // 값 모양이 바뀌었으면(발급처 개편·장애 화면) 그것도 「우리가 열쇠를 못 얻은 것」이다.
  if (!TOKEN_VALUE.test(value)) throw tokenFailure("열쇠 값을 못 읽었다");
  return value;
}

/** 발급 실패 오류. 사이트가 「그런 파일 없다」고 답한 것이 아니므로 **1시간 뒤 재시도** 갈래로 보낸다. */
function tokenFailure(reason: string): Error {
  return markProxyTransportError(new Error(`[board-token] 첨부 열쇠를 못 받았다: ${reason}`));
}

/**
 * 그 게시판의 첨부를 **1회용 열쇠와 함께** 받는 요청 함수. 설정이 없으면 `undefined` —
 * 부르는 쪽은 예전 통로(전역 fetch 또는 경유)를 그대로 쓴다.
 *
 * 왜 필요한가(2026-09-06 curl 실측 — 시흥산업진흥원 `uid=1144`):
 * 첨부 주소 `/config/download_home.php?filename=…` 를 그냥 부르면 200 인데 내용이
 * 「Undefined variable $ar_chk … 비정상적인 접근입니다」 164바이트다. 사이트 스크립트
 * `/js/program.js` 846행 `autoRchk()` 는 **POST `/program_process/ar_code.php`(`ar_create=Y`)**
 * 로 `{"0":{"id_status":"Y","ar_chk":"…"}}` 를 받아 주소에 `&ar_chk=<값>` 을 붙인다.
 * 그대로 하니 200 + `content-disposition: attachment` + HWP 904,704바이트(OLE `d0cf11e0`).
 * 쿠키는 필요 없다(위 실측은 쿠키 없이 성공).
 *
 * ★열쇠는 **첨부 1건마다 새로** 받는다(1회용). 그래서 감싸개가 아니라 매 요청에서 발급한다 —
 *  단, 리다이렉트 홉(`downloadBytes` 는 홉마다 같은 함수를 부른다)에서 또 붙이지 않도록
 *  이미 그 변수가 있는 주소는 그대로 흘려보낸다.
 *
 * `baseFetch` 위에 **겹친다** — 국내 경유가 필요한 출처는 `proxiedAttachmentFetch(dispatcher)` 를
 * 넘기면 열쇠 발급·첨부 요청이 전부 그 경유를 탄다.
 *
 * ★열쇠를 못 받으면 **던진다**(열쇠 없는 GET 으로 떨어지지 않는다) — 이유는 `issueToken` 주석.
 */
export function tokenAttachmentFetch(
  cfg: BoardConfig | undefined,
  baseFetch: AttachmentFetch = DEFAULT_FETCH,
): AttachmentFetch | undefined {
  const token = cfg?.attachmentToken;
  if (!cfg || !token) return undefined;
  const allowed = new Set(allowedHostsOf(cfg));
  let endpoint: string;
  try {
    endpoint = new URL(token.endpoint, cfg.baseUrl).toString();
  } catch {
    return undefined;
  }
  // 발급처가 명부 밖이면 감싸지 않는다 — 설정 오타 하나로 우리 서버가 남의 서버에 POST 를
  // 대신 보내는 통로가 된다(첨부 주소 검문과 같은 이유).
  if (!isAllowedUrl(endpoint, allowed)) return undefined;

  return async (url, init) => {
    if (!isAllowedUrl(url, allowed) || hasParam(url, token.param)) return baseFetch(url, init);
    const value = await issueToken(endpoint, token, baseFetch, init?.signal);
    return baseFetch(withParam(url, token.param, value), init);
  };
}
