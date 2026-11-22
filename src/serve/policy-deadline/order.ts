/**
 * 정책별 고객사 「맞을 확률 순」 비교(NO.789) — 서버 읽기와 화면(종류로 거를 때 다시 줄 세우기)이 같은 순서를 쓰도록 한 곳에 둔다.
 * 순수 함수다. 다른 모듈은 tier.ts 만 가져온다.
 */
import { TIER_RANK, type DeadlineTier } from "./tier";

/** 줄 세울 때 보는 칸 — applyEnd 는 YYYY-MM-DD 글자(상시 null). checkCount 는 참고(ref)를 뺀 확인 항목 수. */
export interface TierOrderKey {
  dismissed: boolean;
  unstructured: boolean;
  tier: DeadlineTier;
  checkCount: number;
  applyEnd: string | null;
  tierScore: number;
  name: string;
  key: string;
}

/** 글자 순 비교 — 로케일 비교는 맥 로케일(LANG=ko)에 따라 순서가 달라져 기본 비교로 고정한다. */
function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** 마감 가까운 순 — 상시(null)는 날짜 마감 뒤. YYYY-MM-DD 글자라 글자 순이 곧 날짜 순이다. */
function compareApplyEnd(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return compareText(a, b);
}

/**
 * 맞을 확률 순 — 해당 없음은 뒤 → 조건 정리 전은 뒤 → 단계(높음 먼저) → 확인 항목 적은 순 → 마감 가까운 순(상시는 뒤)
 * → 점수 높은 순 → 이름 글자 순 → 열쇠 글자 순. 모든 칸이 같으면 0.
 */
export function compareByTier(a: TierOrderKey, b: TierOrderKey): number {
  return (
    Number(a.dismissed) - Number(b.dismissed) ||
    Number(a.unstructured) - Number(b.unstructured) ||
    TIER_RANK[a.tier] - TIER_RANK[b.tier] ||
    a.checkCount - b.checkCount ||
    compareApplyEnd(a.applyEnd, b.applyEnd) ||
    b.tierScore - a.tierScore ||
    compareText(a.name, b.name) ||
    compareText(a.key, b.key)
  );
}
