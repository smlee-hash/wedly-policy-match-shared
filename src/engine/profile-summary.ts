/**
 * 대조에 실제로 쓴 회사 정보를 사람 말로 — 「왜 이 결과인지」를 화면에 투명하게 보여 준다.
 *
 * 추천 통로(recommend)와 자금 조달 지도 통로(funding-map)가 **같은 문장**을 써야 한다 —
 * 두 화면이 같은 회사에 다른 근거를 적으면 어느 쪽을 믿어야 할지 알 수 없다(적대 리뷰 중요10).
 * 프로필 통째는 응답에 싣지 않는다(노출면 축소) — 대조에 쓴 칸의 요약만 나간다.
 */
import { corporationOf, type BusinessProfile } from "./match-engine";

/**
 * 매출(원)을 억·만 글자로 — 앞의 「매출 」은 안 붙인 값만(예 `3.2억`, `8,000만`).
 * 요약(usedProfileSummary)과 피드백 비교(feedback-diff.ts)가 **같은 글자**를 써야 해서 한 곳에 둔다 —
 * 두 곳이 따로 만들면 같은 금액이 다른 글자로 보여 「다른 칸」으로 잘못 잡힌다.
 */
export function revenueWords(krw: number): string {
  // 1억 미만을 반올림하면 「0억」이 된다(적대 리뷰 사소) — 만 단위로 내려 표기.
  return krw >= 1e8 ? `${Math.round((krw / 1e8) * 10) / 10}억` : `${Math.round(krw / 1e4).toLocaleString()}만`;
}

export function usedProfileSummary(p: BusinessProfile): string[] {
  const out: string[] = [];
  if (p.region && p.regionSigungu) out.push(`지역 ${p.region} ${p.regionSigungu}`);
  else if (p.region) out.push(`지역 ${p.region}`);
  else if (p.regionSigungu) out.push(`시군구 ${p.regionSigungu}`);
  if (p.industry) out.push(`업종 ${p.industry}`);
  if (typeof p.employeeCount === "number") out.push(`직원수 ${p.employeeCount}명`);
  if (typeof p.lastYearRevenueKrw === "number") out.push(`매출 ${revenueWords(p.lastYearRevenueKrw)}`);
  if (p.foundedDate) out.push(`설립일 ${p.foundedDate}`);
  if (typeof p.taxDelinquent === "boolean") out.push(`체납 ${p.taxDelinquent ? "있음" : "없음"}`);
  // ── 자금 조달 지도(2026-09-03) — 상시 상품 판정에만 쓰는 세 칸도 근거에 반영한다(코덱스 지적:
  // 대조엔 쓰면서 「왜 이 결과인지」요약엔 안 보이면 화면을 믿을 수 없다). 값이 있을 때만 붙인다 —
  // 사업자번호 가운데 자리가 법인·개인 어디에도 안 걸리고 프로필의 isCorporation 도 없으면(모름) 지어내지 않고 아예 안 붙인다.
  const isCorp = corporationOf(p);
  if (isCorp !== null) out.push(`법인 여부 ${isCorp ? "법인" : "개인"}`);
  // NICE·KCB 점수가 하나라도 있으면 일반 신용점수 줄은 내지 않는다 — 아래 맨 끝 묶음이 대신 말한다
  // (같은 사람의 점수를 두 줄로 적으면 어느 쪽이 판정에 쓰였는지 헷갈린다).
  const hasAgencyScore = typeof p.creditScoreNice === "number" || typeof p.creditScoreKcb === "number";
  if (!hasAgencyScore && typeof p.creditScore === "number") out.push(`신용점수 ${p.creditScore}`);
  if (typeof p.hasExistingLoan === "boolean") out.push(`기존 대출 ${p.hasExistingLoan ? "있음" : "없음"}`);
  // ── 피드백과 다른 칸 알림(2026-10-06) — 기존 줄 순서·문구는 그대로 두고, 값이 있을 때만 맨 끝에 붙인다.
  if (typeof p.companyScale === "string" && p.companyScale.trim() !== "") out.push(`기업 규모 ${p.companyScale}`);
  if (typeof p.creditScoreNice === "number") out.push(`신용점수 NICE ${p.creditScoreNice}`);
  if (typeof p.creditScoreKcb === "number") out.push(`신용점수 KCB ${p.creditScoreKcb}`);
  if (typeof p.hasCert === "boolean") out.push(`인증 ${p.hasCert ? "있음" : "없음"}`);
  // 특허는 건수가 1 이상이면 건수를 먼저 말하고, 아니면(0건·건수 없음) 있음·없음으로 말한다.
  if (typeof p.patentCount === "number" && p.patentCount >= 1) out.push(`특허 ${p.patentCount}건`);
  else if (typeof p.hasPatent === "boolean") out.push(`특허 ${p.hasPatent ? "있음" : "없음"}`);
  return out;
}
