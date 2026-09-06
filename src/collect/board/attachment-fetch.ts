// 첨부를 내려받는 두 길(`sync.fillBodiesFromAttachments`·`structurize.ensureAttachmentText`)이
// **함께 쓰는 한 줄 훅**. 게시판마다 필요한 감싸개를 여기서만 골라 겹친다.
import type { AttachmentFetch } from "../attachment-text";
import { pacedAttachmentFetch, sessionAttachmentFetch } from "./attachment-session";
import { tokenAttachmentFetch } from "./attachment-token";
import type { BoardConfig } from "./types";

/** 감싸개를 안 쓸 때의 기본 통로. 경유가 필요한 출처는 부르는 쪽이 `proxiedAttachmentFetch` 를 넘긴다. */
const DEFAULT_FETCH: AttachmentFetch = (url, init) => fetch(url, init);

/**
 * 그 공고의 첨부를 받을 요청 함수. 붙일 것이 하나도 없으면 `undefined` —
 * 부르는 쪽은 예전 통로(전역 fetch 또는 국내 경유)를 그대로 쓴다.
 *
 * 왜 이 파일이 따로 있나: 첨부를 여는 열쇠가 게시판마다 다르다(상세 세션 쿠키 · Referer ·
 * 1회용 토큰 …). 배선을 두 호출부에 흩뿌리면 한쪽만 새 열쇠를 타는 일이 생긴다. 호출부는
 * **이 함수 한 줄만** 부르고, 새 갈래는 여기서 겹쳐 쌓는다.
 *
 * 겹치는 차례(안쪽 → 바깥쪽):
 *   ① `baseFetch`(경유 또는 전역 fetch)
 *   ② **간격**(`opts.gapMs`) — ★가장 안쪽이어야 세션 데우기·열쇠 발급까지 그 간격을 탄다.
 *      바깥에 두면 감싸개들이 만드는 **앞선 요청**이 간격 없이 나간다.
 *   ③ **상세 세션**(쿠키·Referer) — 데우기 요청이 ②를 타고 나간다.
 *   ④ **1회용 열쇠** — 발급 POST 가 ②·③을 타고 나간다.
 * 각 감싸개는 설정이 없으면 그대로 통과한다(같은 함수를 되돌려 준다).
 */
export function wrapAttachmentFetch(
  cfg: BoardConfig | undefined,
  detailUrl: string,
  baseFetch?: AttachmentFetch,
  opts: { gapMs?: number } = {},
): AttachmentFetch | undefined {
  const inner: AttachmentFetch | undefined =
    opts.gapMs === undefined ? baseFetch : pacedAttachmentFetch(baseFetch ?? DEFAULT_FETCH, opts.gapMs);
  const session = sessionAttachmentFetch(cfg, detailUrl, inner) ?? inner;
  return tokenAttachmentFetch(cfg, session) ?? session;
}
