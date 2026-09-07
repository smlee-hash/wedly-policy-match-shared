/** AI 호출 오류 중 「돈·열쇠·권한」 탓(예산 환불 대상)을 가른다 — ERP·랩 공용. 원문: ERP structurize.ts */
export function isBillingOrAuthError(err: unknown): boolean {
  const m = (err instanceof Error ? err.message : String(err)).toLowerCase();
  if (m.includes("credit balance is too low")) return true;
  if (m.includes("authentication_error")) return true;
  if (m.includes("permission_error")) return true;
  if (m.includes("invalid x-api-key")) return true;
  if (m.includes("organization has been disabled")) return true;
  const status = (err as { status?: unknown })?.status;
  if (status === 401 || status === 403) return true;
  return false;
}
