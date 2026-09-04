/**
 * 대조에 실제로 쓴 회사 정보를 사람 말로 — 「왜 이 결과인지」를 화면에 투명하게 보여 준다.
 *
 * 추천 통로(recommend)와 자금 조달 지도 통로(funding-map)가 **같은 문장**을 써야 한다 —
 * 두 화면이 같은 회사에 다른 근거를 적으면 어느 쪽을 믿어야 할지 알 수 없다(적대 리뷰 중요10).
 * 프로필 통째는 응답에 싣지 않는다(노출면 축소) — 대조에 쓴 칸의 요약만 나간다.
 */
import { isCorporationByBizno, type BusinessProfile } from "./match-engine";

export function usedProfileSummary(p: BusinessProfile): string[] {
  const out: string[] = [];
  if (p.region) out.push(`지역 ${p.region}`);
  if (p.industry) out.push(`업종 ${p.industry}`);
  if (typeof p.employeeCount === "number") out.push(`직원수 ${p.employeeCount}명`);
  if (typeof p.lastYearRevenueKrw === "number") {
    const krw = p.lastYearRevenueKrw;
    // 1억 미만을 반올림하면 「매출 0억」이 된다(적대 리뷰 사소) — 만 단위로 내려 표기.
    out.push(krw >= 1e8 ? `매출 ${Math.round((krw / 1e8) * 10) / 10}억` : `매출 ${Math.round(krw / 1e4).toLocaleString()}만`);
  }
  if (p.foundedDate) out.push(`설립일 ${p.foundedDate}`);
  if (typeof p.taxDelinquent === "boolean") out.push(`체납 ${p.taxDelinquent ? "있음" : "없음"}`);
  // ── 자금 조달 지도(2026-09-03) — 상시 상품 판정에만 쓰는 세 칸도 근거에 반영한다(코덱스 지적:
  // 대조엔 쓰면서 「왜 이 결과인지」요약엔 안 보이면 화면을 믿을 수 없다). 값이 있을 때만 붙인다 —
  // 사업자번호 가운데 자리가 법인·개인 어디에도 안 걸리면(모름) 지어내지 않고 아예 안 붙인다.
  const isCorp = isCorporationByBizno(p.bizno);
  if (isCorp !== null) out.push(`법인 여부 ${isCorp ? "법인" : "개인"}`);
  if (typeof p.creditScore === "number") out.push(`신용점수 ${p.creditScore}`);
  if (typeof p.hasExistingLoan === "boolean") out.push(`기존 대출 ${p.hasExistingLoan ? "있음" : "없음"}`);
  return out;
}
