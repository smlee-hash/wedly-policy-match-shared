/**
 * 「해당 없음」(NO.789) — 담당이 「이 업체에는 이 공고가 해당 없다」고 사유와 함께 남긴다(사유를 비우면 되돌린다).
 * 해당 없음 줄은 목록·연락 예정에서 빠지고, 업체를 펼치면 따로 보인다. 같은 (업체, 공고 묶음)은 한 줄 — 다시 남기면 덮어쓴다.
 *
 * 담당 확인·오류는 진행(`./progress`)과 같다: 담당 확인(`isAssigned`)은 앱이 정하고, 오류는 `DeadlineProgressError` 로 던져
 * 통로가 status·code·message 그대로 응답한다. 업체 열쇠는 별칭이 와도 업체 본 열쇠(company.customerKey)로 저장한다.
 */
import { DeadlineProgressError, NOT_ASSIGNED_MESSAGE, type ProgressActor, type ProgressCompany } from "./progress";
import { isCustomerKey } from "./query";
import { DISMISS_REASONS, type DismissInfo, type DismissReason, type StoredDismissal } from "./types";

export interface DismissDeps {
  readCompany(customerKey: string): Promise<ProgressCompany | null>;
  /**
   * 이 사람이 이 업체의 해당 없음을 눌러도 되나 — 진행과 같은 앱 주입이다. 업체가 없으면 company 가 null 로 온다.
   * 거짓이면 403 FORBIDDEN NOT_ASSIGNED_MESSAGE(없는 업체도 같은 403 — 있는지조차 알리지 않는다).
   */
  isAssigned(actor: ProgressActor, company: ProgressCompany | null): boolean | Promise<boolean>;
  /** 그 업체 × 묶음 판정 줄이 있나(맞음·확인 필요만 저장된다). */
  hasMatch(customerKey: string, bucketKey: string): Promise<boolean>;
  /** 같은 (업체, 묶음) 줄이 있으면 덮어쓴다. */
  upsertDismiss(row: StoredDismissal): Promise<void>;
  deleteDismiss(customerKey: string, bucketKey: string): Promise<void>;
}

/**
 * 「해당 없음」 남기기·되돌리기. 순서:
 * 1) readCompany. isAssigned 가 거짓이면 DeadlineProgressError(403, "FORBIDDEN", NOT_ASSIGNED_MESSAGE).
 *    통과했는데 업체가 없으면 (404, "NOT_FOUND", "업체를 찾지 못했습니다.").
 * 2) reason 이 null(되돌리기)이면 deleteDismiss(업체 customerKey, bucketKey) 하고 { dismissed: null } —
 *    판정 줄이 없어졌어도 되돌릴 수 있게 hasMatch 는 보지 않는다.
 * 3) hasMatch(업체 customerKey, bucketKey)가 거짓이면 (404, "NOT_FOUND", "이 업체에 맞는 공고가 아닙니다.").
 * 4) upsertDismiss({ customerKey, bucketKey, reason, byUserId: actor.id, byName: actor.name, createdAt: now }) 하고
 *    { dismissed: { reason, byName: actor.name, at: now ISO } }.
 */
export async function setDeadlineDismiss(
  input: { customerKey: string; bucketKey: string; reason: DismissReason | null; actor: ProgressActor },
  now: Date,
  deps: DismissDeps,
): Promise<{ dismissed: DismissInfo | null }> {
  const { bucketKey, reason, actor } = input;

  const company = await deps.readCompany(input.customerKey);
  // 담당이 아니면 업체가 있는지도 알리지 않는다 — 없는 업체도 같은 403.
  if (!(await deps.isAssigned(actor, company))) {
    throw new DeadlineProgressError(403, "FORBIDDEN", NOT_ASSIGNED_MESSAGE);
  }
  if (!company) throw new DeadlineProgressError(404, "NOT_FOUND", "업체를 찾지 못했습니다.");
  const { customerKey } = company;

  if (reason === null) {
    await deps.deleteDismiss(customerKey, bucketKey);
    return { dismissed: null };
  }

  if (!(await deps.hasMatch(customerKey, bucketKey))) {
    throw new DeadlineProgressError(404, "NOT_FOUND", "이 업체에 맞는 공고가 아닙니다.");
  }
  await deps.upsertDismiss({ customerKey, bucketKey, reason, byUserId: actor.id, byName: actor.name, createdAt: now });
  return { dismissed: { reason, byName: actor.name, at: now.toISOString() } };
}

/** 「해당 없음」 POST 본문이 맞지 않을 때의 글자 — 400 BAD_REQUEST. */
export const DISMISS_BAD_BODY_MESSAGE = "업체·공고·사유를 골라 주세요.";

function isDismissReason(value: unknown): value is DismissReason {
  return typeof value === "string" && (DISMISS_REASONS as readonly string[]).includes(value);
}

/**
 * 「해당 없음」 POST 본문 해석(`await req.json().catch(() => null)` 결과를 그대로 넘긴다).
 * 업체·공고 열쇠 규칙은 `readProgressBody` 와 같다. reason 키는 꼭 있어야 하고 DISMISS_REASONS 중 하나이거나 null(되돌리기).
 * 맞지 않으면 DeadlineProgressError(400, "BAD_REQUEST", DISMISS_BAD_BODY_MESSAGE).
 */
export function readDismissBody(body: unknown): { customerKey: string; bucketKey: string; reason: DismissReason | null } {
  const bad = () => new DeadlineProgressError(400, "BAD_REQUEST", DISMISS_BAD_BODY_MESSAGE);
  if (typeof body !== "object" || body === null) throw bad();
  const { customerKey, bucketKey, reason } = body as { customerKey?: unknown; bucketKey?: unknown; reason?: unknown };
  if (typeof customerKey !== "string" || !isCustomerKey(customerKey)) throw bad();
  if (typeof bucketKey !== "string") throw bad();
  const key = bucketKey.trim();
  if (!key || key.length > 300) throw bad();
  if (reason === null) return { customerKey, bucketKey: key, reason: null };
  if (!isDismissReason(reason)) throw bad();
  return { customerKey, bucketKey: key, reason };
}
