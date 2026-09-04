/**
 * 상시 상품의 대상 규칙(targetRules) → 판정 엔진이 아는 조건(StructuredCondition).
 * 공고는 AI 구조화가 조건을 뽑지만, 상품은 어댑터가 원천 글을 읽어 규칙으로 적어 두므로 AI 0콜이다.
 *
 * 두 가지를 지킨다.
 * ① **rawText 를 절대 비우지 않는다** — 화면 체크리스트가 「라벨: 원문」으로 그리는데
 *    원문이 비면 무엇을 재는 줄인지 알 수 없다(structure-types.ts 주석 참고).
 * ② **키가 기대하는 비교(EXPECTED_OP)와 어긋나지 않게** 짝을 코드에 못 박는다 — 어긋나면
 *    판정 엔진이 기계대조를 조용히 끄고 「확인 필요」로만 넘긴다.
 * 프로필에 없는 조건(대표 나이)은 key "other" + machineReadable:false 로 남겨 사람이 확인하게 한다.
 */
import type { StructuredCondition } from "../../engine/structure-types";
import type { ProductTargetRules } from "./types";

/** 「10억원」처럼 사람이 읽는 금액. 딱 떨어지지 않으면 쉼표 숫자로 적는다. */
function moneyLabel(won: number): string {
  if (won >= 100_000_000 && won % 100_000_000 === 0) return `${won / 100_000_000}억원`;
  if (won >= 10_000 && won % 10_000 === 0) return `${(won / 10_000).toLocaleString("ko-KR")}만원`;
  return `${won.toLocaleString("ko-KR")}원`;
}

/** 빈 값·글자만 있는 배열은 조건이 아니다 — 있으나 마나 한 조건으로 「가능」을 주면 안 된다. */
function cleanList(v: string[] | undefined): string[] | null {
  if (!Array.isArray(v)) return null;
  const list = v.map((s) => String(s).trim()).filter((s) => s.length > 0);
  return list.length > 0 ? list : null;
}

function num(v: number | undefined): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * 규칙 → 조건. 화면·판정 순서를 코드가 정한다(지역 → 업종/규모 → 업력 → 신용 → 매출/직원 → 형태).
 * @param rules 어댑터가 원천에서 읽어 적은 기계 대조용 규칙
 * @param targetText 사람이 읽는 대상 원문 — 키별 한국어를 못 지을 때의 대타
 */
export function rulesToConditions(rules: ProductTargetRules, targetText: string): StructuredCondition[] {
  const out: StructuredCondition[] = [];
  const fallback = targetText.trim().slice(0, 60);
  const add = (
    key: StructuredCondition["key"],
    op: StructuredCondition["op"],
    value: StructuredCondition["value"],
    label: string,
    machineReadable = true,
  ) => {
    out.push({ key, op, value, rawText: label || fallback || "상품 대상 조건", machineReadable });
  };

  const region = cleanList(rules.region);
  if (region) add("region", "in", region, `소재지 ${region.join(", ")}`);

  const industry = cleanList(rules.industry);
  if (industry) add("industry", "in", industry, `업종 ${industry.join(", ")}`);

  const scale = cleanList(rules.scale);
  if (scale) add("companyScale", "in", scale, `기업 규모 ${scale.join(", ")}`);

  const ageMin = num(rules.bizAgeMinYears);
  if (ageMin !== null) add("businessAgeMinYears", "gte", ageMin, `업력 ${ageMin}년 이상`);

  const ageMax = num(rules.bizAgeMaxYears);
  if (ageMax !== null) add("businessAgeMaxYears", "lte", ageMax, `업력 ${ageMax}년 이하`);

  const creditMin = num(rules.creditScoreMin);
  if (creditMin !== null) add("creditScoreMin", "gte", creditMin, `신용점수 ${creditMin} 이상`);

  const creditMax = num(rules.creditScoreMax);
  if (creditMax !== null) add("creditScoreMax", "lte", creditMax, `신용점수 ${creditMax} 이하`);

  const revenueMax = num(rules.revenueMaxKrw);
  if (revenueMax !== null) add("revenueMaxKrw", "lte", revenueMax, `연매출 ${moneyLabel(revenueMax)} 이하`);

  const employeesMax = num(rules.employeesMax);
  if (employeesMax !== null) add("employeeMax", "lte", employeesMax, `직원 ${employeesMax}명 이하`);

  if (typeof rules.isCorporation === "boolean") {
    add("isCorporation", "eq", rules.isCorporation, rules.isCorporation ? "법인만" : "개인사업자만");
  }
  if (typeof rules.hasExistingLoan === "boolean") {
    add(
      "hasExistingLoan",
      "eq",
      rules.hasExistingLoan,
      rules.hasExistingLoan ? "기존 대출 있어야 함(대환)" : "기존 대출 없어야 함",
    );
  }

  // 프로필에 대표 나이 칸이 없다 — 기계로 못 재니 「확인 필요」로만 쓰이게 other 로 둔다.
  const repAgeMax = num(rules.representativeAgeMax);
  if (repAgeMax !== null) add("other", "lte", repAgeMax, `대표 ${repAgeMax}세 이하`, false);

  // 어댑터가 원천 글에서 옮겨 적은, 기계로 아예 못 재는 필수조건 원문 — 항목마다 other 로 덧붙인다.
  // 값을 지어내지 않고 원문 그대로 rawText 에 실어 사람이 확인하게 한다(버리지 않는다).
  const humanCheck = cleanList(rules.humanCheck);
  if (humanCheck) for (const item of humanCheck) add("other", "eq", true, item, false);

  return out;
}
