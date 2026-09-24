/**
 * 보증 상품 3곳(무역보험·서울신보·경기신보)의 대상 조건 — 대상 글은 기계 조건으로 풀지 않고 「신청 전 확인」
 * 한 항목으로만 넣는다(설계 공통 규칙 3). 지역만 기계 조건.
 *
 * ★대상 글을 못 읽은 상품에도 확인 항목을 **반드시** 단다 — 조건이 비거나 지역만 남으면 판정기
 * (rulesToConditions → fitVerdictOf)가 「맞음」을 준다. 표 본문이 빠진 응답 한 번에 자격을 모르는 상품이
 * 맞음으로 올라왔다(2026-09-24 공용 리뷰 P1).
 */
import type { ProductTargetRules } from "../types";

/** 확인 항목 한 줄 길이(설계 공통 규칙 3). */
const HUMAN_CHECK_CHARS = 80;
export const UNREAD_TARGET_NOTE = "지원대상 원문을 읽지 못했습니다 — 기관 안내에서 직접 확인하세요";

export function guaranteeTargetRules(targetText: string, region?: string[]): ProductTargetRules {
  const humanCheck = [targetText ? targetText.slice(0, HUMAN_CHECK_CHARS) : UNREAD_TARGET_NOTE];
  return region ? { region, humanCheck } : { humanCheck };
}
