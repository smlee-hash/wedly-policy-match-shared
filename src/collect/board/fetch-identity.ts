// 목록·상세·첨부가 사이트에 보이는 신원(UA·언어)을 한 곳에 둔다 — 아무것도 import 하지 않는 잎 모듈.
// 근거(2026-10-01 실측): 행정안전부·화성산업진흥원 첨부 서버는 노드 기본 UA 접속을 끊고, 이 UA 면 파일을 준다.

export const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
export const BROWSER_ACCEPT_LANGUAGE = "ko";

/** 부르는 쪽 머리글에 UA·언어가 없을 때만 더한 **새 평범한 객체**. 이름의 대소문자는 따지지 않고, 받은 객체는 안 바꾼다. */
export function withBrowserIdentity(headers?: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = { ...headers };
  const names = new Set(Object.keys(out).map((k) => k.toLowerCase()));
  if (!names.has("user-agent")) out["User-Agent"] = BROWSER_UA;
  if (!names.has("accept-language")) out["Accept-Language"] = BROWSER_ACCEPT_LANGUAGE;
  return out;
}
