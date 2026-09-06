export interface AlertStore { get: (id: string) => Promise<number>; set: (id: string, n: number) => Promise<void> }
export interface AlertDeps { send: (text: string) => Promise<boolean>; store: { get: () => Promise<number>; set: (n: number) => Promise<void> } }

const THRESHOLD = 3;

/** 연속 실패를 세고, 임계에 닿으면 1회 알린 뒤 성공 시에만 리셋. */
export async function noteFailureAndMaybeAlert(id: string, reason: string, deps: AlertDeps): Promise<void> {
  const n = Math.min(THRESHOLD, (await deps.store.get()) + 1);
  await deps.store.set(n);
  if (n < THRESHOLD) return;
  try {
    const ok = await deps.send(`[정책매칭 수집] ${id} 연속 ${n}회 실패 — ${reason}. 자가수리도 실패, 사람 점검 필요.`);
    if (ok) await deps.store.set(0);
  } catch {
    /* send 실패 시 THRESHOLD 유지 — 다음 실패 때 재시도 */
  }
}

/** 한 번 성공하면 실패 카운트 리셋. */
export async function noteSuccess(_id: string, deps: { store: { get: () => Promise<number>; set: (n: number) => Promise<void> } }): Promise<void> {
  await deps.store.set(0);
}
