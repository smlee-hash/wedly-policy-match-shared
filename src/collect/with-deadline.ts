/**
 * 기다리기에만 마감을 건다. 원래 작업은 취소하지 않는다 —
 * 서버에서 계속 돌아 끝나면 캐시에 남고, 다음 진단·열람에 반영된다.
 *
 * 한 건 구조화의 코드상 최대치는 570초라, 다음 건 시작 여부만 보는
 * 벽시계 예산으로는 이미 시작한 건이 응답을 붙잡고 늘어진다.
 */
export const DEADLINE_TIMEOUT = "timeout" as const;

export async function withDeadline<T>(
  promise: Promise<T>,
  ms: number,
): Promise<T | typeof DEADLINE_TIMEOUT> {
  // 마감 뒤에 이 약속이 실패해도 아무도 안 받으면 Node 가 서버를 시끄럽게 한다.
  // 구독만 추가한다 — 아직 기다리는 쪽의 성공/실패는 그대로 흐른다.
  promise.catch(() => {});

  if (!Number.isFinite(ms) || ms <= 0) return DEADLINE_TIMEOUT;

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<typeof DEADLINE_TIMEOUT>((resolve) => {
    timer = setTimeout(() => resolve(DEADLINE_TIMEOUT), ms);
  });
  try {
    return await Promise.race([promise, timedOut]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
