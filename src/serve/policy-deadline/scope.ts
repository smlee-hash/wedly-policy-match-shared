/**
 * 정책별 고객사·연락 예정 — 「누구 눈으로 보나」를 앱이 정해 넘기는 모양.
 *
 * 로그인·권한·역할은 앱 몫이다. 앱은 요청한 담당 범위(「내 담당」·「전체」·없음)를 보고 아래 셋 중 하나를 만들어 넘기고,
 * 막을 때는 `DeadlineReadError`(403 등)를 던진다. 이 폴더의 계산은 역할 이름(관리자 등)을 모른다.
 */
import type { ReadCompany, ReadSource } from "./types";

export type DeadlineScope =
  /** 거르지 않음 — 모든 업체. */
  | { kind: "all" }
  /** 업체의 readConsultantIds 에 readerId 가 든 곳만. */
  | { kind: "reader"; readerId: string }
  /** 앱이 정한 업체 열쇠만. 빈 배열이면 DB 를 부르지 않고 빈 결과. */
  | { kind: "keys"; customerKeys: string[] };

/** 읽기 통로의 거절 — 통로가 status·code·message 그대로 응답한다. */
export class DeadlineReadError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "DeadlineReadError";
  }
}

/**
 * 범위 안 업체와, 판정·진행을 거르는 열쇠(`all` 이면 null = 거르지 않음).
 * 모든 read* 가 이 함수로 시작한다.
 */
export async function readScope(
  scope: DeadlineScope,
  src: ReadSource,
): Promise<{ companies: ReadCompany[]; keys: string[] | null }> {
  if (scope.kind === "all") {
    return { companies: await src.companies({}), keys: null };
  }
  // 빈 열쇠 목록은 어떤 업체도 맞을 수 없다 — 읽는 자리에 묻지 않는다(빈 목록을 「거르지 않음」으로 읽는 자리가 없게).
  if (scope.kind === "keys" && scope.customerKeys.length === 0) return { companies: [], keys: [] };
  const companies =
    scope.kind === "reader"
      ? await src.companies({ readerId: scope.readerId })
      : await src.companies({ customerKeys: scope.customerKeys });
  return { companies, keys: companies.map((c) => c.customerKey) };
}

/** 업체 한 곳을 이 범위에서 봐도 되나 — 막히면 읽기 함수가 null 을 돌려 「없는 업체」와 같게 보인다. */
export function scopeAllows(scope: DeadlineScope, company: Pick<ReadCompany, "customerKey" | "readConsultantIds">): boolean {
  if (scope.kind === "all") return true;
  if (scope.kind === "reader") return company.readConsultantIds.includes(scope.readerId);
  return scope.customerKeys.includes(company.customerKey);
}
