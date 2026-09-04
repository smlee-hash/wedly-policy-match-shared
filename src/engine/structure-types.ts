// 공고 구조화 결과 — AI 산출물의 모양. 원문 병기·사람확인필요 보존이 1급 요구(설계서 §3).
export const CONDITION_KEYS = [
  "region",          // 소재지 (value: 시도명 배열, op in)
  "industry",        // 업종 (value: 업종 키워드 배열, op in — 텍스트 포함 대조)
  "businessAgeMaxYears", "businessAgeMinYears",   // 업력 (설립일로 계산)
  "revenueMaxKrw", "revenueMinKrw",               // 작년 연매출
  "employeeMax", "employeeMin",                   // 상시 근로자 수
  "companyScale",    // 기업 규모 (중소기업|소상공인|중견|예비창업자 등, op in)
  "noTaxDelinquency",// 체납 없어야 함 (value true)
  "certRequired", "patentRequired",               // 인증·특허 보유 요구
  // ── 자금 조달 지도(2026-09-03) — 상시 상품(은행 사업자대출·서민금융·대환)의
  //    targetRules 가 낳는 키. 공고 구조화(AI)도 같은 키를 뽑을 수 있고, 판정은 같은 자리에서 한다.
  "creditScoreMin", "creditScoreMax",             // 개인 신용점수(NICE/KCB 300~1000) 하한·상한
  "hasExistingLoan",                              // 기존 대출 유무 (대환 상품은 true 를 요구)
  "isCorporation",                                // 법인 여부 (사업자번호 가운데 두 자리로 판정)
] as const;
export type ConditionKey = (typeof CONDITION_KEYS)[number];
export type ConditionOp = "in" | "lte" | "gte" | "eq";

/* ───────── 키별로 기대하는 비교 방식 ─────────
 * AI 가 key 는 맞게 뽑고 op 를 거꾸로 적으면(예: 「업력 3년 이하」에 gte)
 * 대조가 조용히 뒤집혀 **자격이 안 되는 회사에 「가능」이 나온다**(2026-08-22 리뷰 6번).
 * 그래서 키가 기대하는 op 와 다르면 기계대조를 끄고 사람 확인으로 넘긴다. */
export const EXPECTED_OP: Record<ConditionKey, ConditionOp> = {
  region: "in",
  industry: "in",
  companyScale: "in",
  businessAgeMaxYears: "lte",
  businessAgeMinYears: "gte",
  revenueMaxKrw: "lte",
  revenueMinKrw: "gte",
  employeeMax: "lte",
  employeeMin: "gte",
  noTaxDelinquency: "eq",
  certRequired: "eq",
  patentRequired: "eq",
  creditScoreMin: "gte",
  creditScoreMax: "lte",
  hasExistingLoan: "eq",
  isCorporation: "eq",
};

/** 기대 op. 사전에 없는 키(other 등)는 기대치가 없다 → null. */
export function expectedOpOf(key: string): ConditionOp | null {
  return (EXPECTED_OP as Record<string, ConditionOp>)[key] ?? null;
}

/** 키가 기대하는 비교 방식과 맞는가. 사전 밖 키는 따지지 않는다(이미 기계대조 대상이 아니다). */
export function opFitsKey(key: string, op: string): boolean {
  const expected = expectedOpOf(key);
  return expected === null || expected === op;
}

/* ───────── 키별 화면 라벨 ─────────
 * 두 조건이 같은 원문(rawText)을 공유하는 공고가 있다 — 예를 들어 「업력 3년 이하 서울 소재」
 * 한 문장에서 region 과 businessAgeMaxYears 를 함께 뽑으면 원문이 같다.
 * 화면이 원문만 그리면 **똑같은 줄이 두 번 나와 무엇을 재는 줄인지 구분할 수 없다**
 * (2026-08-22 독립 재검사 1번). 그래서 체크리스트는 「라벨: 원문」으로 그린다. */
export const CONDITION_LABEL: Record<ConditionKey, string> = {
  region: "지역",
  industry: "업종",
  businessAgeMaxYears: "업력 상한",
  businessAgeMinYears: "업력 하한",
  revenueMaxKrw: "연매출 상한",
  revenueMinKrw: "연매출 하한",
  employeeMax: "직원 수 상한",
  employeeMin: "직원 수 하한",
  companyScale: "기업 규모",
  noTaxDelinquency: "세금 체납",
  certRequired: "인증",
  patentRequired: "특허",
  creditScoreMin: "신용점수 하한",
  creditScoreMax: "신용점수 상한",
  hasExistingLoan: "기존 대출",
  isCorporation: "법인 여부",
};

/** 사전에 없는 키(other 등)에 붙일 라벨. */
export const OTHER_CONDITION_LABEL = "기타";

/** 조건 키 → 화면 라벨. 사전 밖 키는 「기타」. */
export function conditionLabelOf(key: string): string {
  return (CONDITION_LABEL as Record<string, string>)[key] ?? OTHER_CONDITION_LABEL;
}

export interface StructuredCondition {
  key: ConditionKey | "other";   // 사전에 없는 조건은 other + 기계불가
  op: ConditionOp;
  value: string[] | number | boolean;
  rawText: string;               // ★원문 문장 그대로 — 절대 비우지 않는다
  machineReadable: boolean;      // false 면 대조에서 「확인 필요」로만 쓰인다
}

export interface AnnouncementStructure {
  benefitSummary: string;                       // 혜택 한 줄
  supportAmountText: string;                    // 지원금액 원문 표현 ("" 허용)
  aiSummary: { purpose: string; target: string; scale: string; scaleItems: string[] };  // 3덩이 + 규모 세부(하위 호환: 없으면 빈 배열)
  conditions: StructuredCondition[];
  humanCheck: string[];                         // 기계로 못 바꾼 조건 원문 — 버리지 않는다
  documents: string[];
  verified: boolean;                            // 2차 검산 통과 여부
}

export type ConditionVerdict = "pass" | "fail" | "unknown";
export interface ConditionCheck { condition: StructuredCondition; verdict: ConditionVerdict; note: string }
export type MatchGrade = "possible" | "uncertain" | "impossible";

/**
 * 대조 결과 묶음 → 등급.
 * fail 1개라도 있으면 불가, 모르는 조건(unknown)이 있으면 애매, 기계 조건이 전부 통과면 가능.
 *
 * ★사람이 직접 볼 조건(humanCheck)은 **등급을 내리지 않는다**(2026-08-22 독립 화면 검사 1번).
 *  실공고는 거의 전부 우대사항 같은 서술 조건을 한 줄은 갖고 있어, 그걸로 강등하면
 *  「받을 수 있음」이 영원히 0 이 된다. 감추는 게 아니라 개수를 「직접 확인 조건 N건」 칩으로
 *  카드·상세에 그대로 싣는다.
 *
 * ★단 **기계 조건이 하나도 없으면 애매**다 — 통과를 말할 근거 자체가 없다.
 *  (구조화가 깨져 조건을 하나도 못 읽은 공고가 「받을 수 있음」으로 둔갑하던 자리다.
 *   저장 단계의 needs_review 표시와 별개로 여기서도 막는다.)
 */
export function gradeOf(checks: ConditionCheck[]): MatchGrade {
  if (checks.some((c) => c.verdict === "fail")) return "impossible";
  if (checks.length === 0) return "uncertain";
  return checks.every((c) => c.verdict === "pass") ? "possible" : "uncertain";
}
