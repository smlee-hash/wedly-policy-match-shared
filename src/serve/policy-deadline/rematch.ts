/**
 * 「다시 맞추기」(NO.789) — 상세창에서 업체 정보를 고치고 닫으면 그 업체를 미리 대조 줄에 넣고, 앱의 대조 시계가 그 업체를
 * 다시 판정해 줄에서 뺄 때까지(상한 25초) 기다린다. 판정은 시계가 하고 이 코어는 넣고 기다리기만 한다 —
 * 화면은 이 통로의 답을 받은 뒤 목록을 다시 읽는다.
 *
 * 담당 확인·오류는 진행(`./progress`)과 같다: 담당 확인(`isAssigned`)은 앱이 정하고, 오류는 `DeadlineProgressError` 로 던져
 * 통로가 status·code·message 그대로 응답한다. 업체 열쇠는 별칭이 와도 업체 본 열쇠(company.customerKey)로 넣는다.
 */
import { DeadlineProgressError, NOT_ASSIGNED_MESSAGE, type ProgressActor, type ProgressCompany } from "./progress";
import { isCustomerKey } from "./query";

/** 줄이 빠지기를 기다리는 상한(밀리초). */
export const REMATCH_WAIT_MS = 25_000;
/** 줄을 다시 보는 간격(밀리초). */
export const REMATCH_POLL_MS = 1_000;

export interface RematchDeps {
  readCompany(customerKey: string): Promise<ProgressCompany | null>;
  /**
   * 이 사람이 이 업체를 다시 맞춰도 되나 — 진행·해당 없음과 같은 앱 주입이다. 업체가 없으면 company 가 null 로 온다.
   * 거짓이면 403 FORBIDDEN NOT_ASSIGNED_MESSAGE(없는 업체도 같은 403 — 있는지조차 알리지 않는다).
   */
  isAssigned(actor: ProgressActor, company: ProgressCompany | null): boolean | Promise<boolean>;
  /** 업체를 미리 대조 줄에 넣는다(이미 있으면 넣은 때만 새로). 실패하면 던진다. */
  enqueue(customerKey: string, now: Date): Promise<void>;
  /** 그 업체 줄이 아직 있나 — 앱의 대조 시계가 판정을 마치면 줄에서 빠진다. */
  isQueued(customerKey: string): Promise<boolean>;
  sleep(ms: number): Promise<void>;
  /** 기다림 시간을 재는 시계(밀리초). */
  nowMs(): number;
}

/**
 * 「다시 맞추기」. 순서:
 * 1) readCompany. isAssigned 가 거짓이면 DeadlineProgressError(403, "FORBIDDEN", NOT_ASSIGNED_MESSAGE).
 *    통과했는데 업체가 없으면 (404, "NOT_FOUND", "업체를 찾지 못했습니다.").
 * 2) enqueue(업체 customerKey, now). 실패하면 그 오류를 그대로 던진다(기다리지 않는다).
 * 3) 시작 시각을 재고(enqueue 뒤), 한 번 쉰 뒤 isQueued 를 본다 — 넣자마자 보지 않는다. 줄이 빠졌으면 { rematched: true },
 *    아니고 상한(waitMs)에 닿았으면 { rematched: false }, 아니면 다시 쉰다. 마지막 확인에서 줄이 빠졌으면 상한에 닿았어도 true.
 *    상한에 닿아도 줄은 지우지 않는다 — 대조 시계가 곧 맞춘다.
 */
export async function requestDeadlineRematch(
  input: { customerKey: string; actor: ProgressActor },
  now: Date,
  deps: RematchDeps,
  opts: { waitMs?: number; pollMs?: number } = {},
): Promise<{ rematched: boolean }> {
  const waitMs = opts.waitMs ?? REMATCH_WAIT_MS;
  const pollMs = opts.pollMs ?? REMATCH_POLL_MS;

  const company = await deps.readCompany(input.customerKey);
  // 담당이 아니면 업체가 있는지도 알리지 않는다 — 없는 업체도 같은 403.
  if (!(await deps.isAssigned(input.actor, company))) {
    throw new DeadlineProgressError(403, "FORBIDDEN", NOT_ASSIGNED_MESSAGE);
  }
  if (!company) throw new DeadlineProgressError(404, "NOT_FOUND", "업체를 찾지 못했습니다.");
  const { customerKey } = company;

  await deps.enqueue(customerKey, now);

  const startedAt = deps.nowMs();
  for (;;) {
    await deps.sleep(pollMs);
    if (!(await deps.isQueued(customerKey))) return { rematched: true };
    if (deps.nowMs() - startedAt >= waitMs) return { rematched: false };
  }
}

/** 「다시 맞추기」 POST 본문이 맞지 않을 때의 글자 — 400 BAD_REQUEST. */
export const REMATCH_BAD_BODY_MESSAGE = "업체를 골라 주세요.";

/**
 * 「다시 맞추기」 POST 본문 해석(`await req.json().catch(() => null)` 결과를 그대로 넘긴다).
 * 업체 열쇠 규칙은 `readProgressBody` 와 같다(앞뒤 빈칸은 다듬지 않고 isCustomerKey 가 거른다). 다른 칸은 버린다.
 * 맞지 않으면 DeadlineProgressError(400, "BAD_REQUEST", REMATCH_BAD_BODY_MESSAGE).
 */
export function readRematchBody(body: unknown): { customerKey: string } {
  const bad = () => new DeadlineProgressError(400, "BAD_REQUEST", REMATCH_BAD_BODY_MESSAGE);
  if (typeof body !== "object" || body === null) throw bad();
  const { customerKey } = body as { customerKey?: unknown };
  if (typeof customerKey !== "string" || !isCustomerKey(customerKey)) throw bad();
  return { customerKey };
}
