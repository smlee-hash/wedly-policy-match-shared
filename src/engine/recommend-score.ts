import type { ConditionCheck } from "./structure-types";

/** 정렬 구획(설계서 §4 — 겹침 없음). status='open' 행만 들어온다는 전제. */
export type RecommendBucket = "open" | "always" | "upcoming";
const BUCKET_ORDER: Record<RecommendBucket, number> = { open: 0, always: 1, upcoming: 2 };

export function bucketOf(applyStart: Date | null, applyEnd: Date | null, now: Date): RecommendBucket {
  if (applyStart && applyStart.getTime() > now.getTime()) return "upcoming";
  if (applyEnd && applyEnd.getTime() > now.getTime()) return "open";
  return "always"; // 마감 없음(상시·기한없음). 마감 지난 행은 status='closed' 라 애초에 안 들어온다.
}

/** 일치 +15 · 불일치 -40 · 확인필요 0 · 기본 50. 조건 0개(추출 실패)는 40 — 정보 부족의 정직한 자리. */
export function scoreOf(checks: ConditionCheck[]): number {
  if (checks.length === 0) return 40;
  let s = 50;
  for (const c of checks) {
    if (c.verdict === "pass") s += 15;
    else if (c.verdict === "fail") s -= 40;
  }
  return s;
}

export interface RecommendSortKey { bucket: RecommendBucket; score: number; applyEnd: Date | null }

export function compareRecommend(a: RecommendSortKey, b: RecommendSortKey): number {
  const byBucket = BUCKET_ORDER[a.bucket] - BUCKET_ORDER[b.bucket];
  if (byBucket !== 0) return byBucket;
  if (a.score !== b.score) return b.score - a.score;
  const ae = a.applyEnd ? a.applyEnd.getTime() : Number.MAX_SAFE_INTEGER; // 상시는 뒤
  const be = b.applyEnd ? b.applyEnd.getTime() : Number.MAX_SAFE_INTEGER;
  return ae - be;
}

/** 사업장 조건 대조 구획 — fit(맞음)·unverified(확인 못 함)·excluded(안 맞음).
 *  「추천 = 전 공고 정렬」이 「모든 정책이 다 나온다」로 읽혀(사장님 2026-08-30) 필터로 바꿨다:
 *  불일치가 1개라도 있으면 탈락, 일치가 1개 이상이어야 「맞음」, 나머지(조건 미추출·확인
 *  필요뿐)는 「미확인」 — 기본 화면엔 맞음만, 미확인은 접기 뒤로. */
export type FitVerdict = "fit" | "unverified" | "excluded";

/** 「전국」 지역 pass — 사실상 아무 회사나 통과라 그것만으로 「맞음」을 주면
 *  실질 검증 0인 전국 공고가 fit 목록을 도로 채운다(적대 리뷰 중요4). */
function isNationwidePass(c: ConditionCheck): boolean {
  return (
    c.verdict === "pass" &&
    c.condition.key === "region" &&
    Array.isArray(c.condition.value) &&
    c.condition.value.some((v) => String(v).includes("전국"))
  );
}

/** 법인 여부(isCorporation) pass — 「전국」 pass 와 같은 이유로 단독 fit 근거가 못 된다(적대 리뷰).
 *  법인·개인사업자 여부만 맞은 것은 실질 검증이 아니다(대부분의 회사가 둘 중 하나에 걸린다) —
 *  다른 실질 조건(지역·업종 등)이 하나라도 pass 여야 「맞음」을 준다. */
function isCorporationOnlyPass(c: ConditionCheck): boolean {
  return c.verdict === "pass" && c.condition.key === "isCorporation";
}

/** 기업 규모(companyScale) pass — 「전국」·법인 여부 pass 와 같은 이유로 단독 fit 근거가 못 된다
 *  (F3, 2026-09-03 코덱스 리뷰: 희망리턴패키지처럼 「소상공인」 규모 조건 하나뿐인 상품이 그것만으로
 *  fit 목록에 오르던 자리). 「소상공인」「중소기업」 한 마디는 대부분의 회사가 걸리는 느슨한 조건이라
 *  다른 실질 조건(지역·업종 등)이 하나라도 pass 여야 「맞음」을 준다. */
function isCompanyScaleOnlyPass(c: ConditionCheck): boolean {
  return c.verdict === "pass" && c.condition.key === "companyScale";
}

/** 단독으로는 fit 근거가 못 되는 「약한 pass」 — 전국 지역·법인 여부·기업 규모가 여기 속한다. */
function isWeakPass(c: ConditionCheck): boolean {
  return isNationwidePass(c) || isCorporationOnlyPass(c) || isCompanyScaleOnlyPass(c);
}

export function fitVerdictOf(checks: ConditionCheck[]): FitVerdict {
  if (checks.some((c) => c.verdict === "fail")) return "excluded";
  if (checks.some((c) => c.verdict === "pass" && !isWeakPass(c))) return "fit";
  return "unverified";
}
