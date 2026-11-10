/**
 * 공고 한 건의 **보이는 조건 줄** — 결과 목록 줄(build/funding-map-build)과 공고 상세 「신청 자격 대조」 표
 * (ui/policy/DetailPanel)가 이 함수 하나만 부른다.
 *
 * 왜 한 곳인가(NO.585 후속, 2026-11-10 운영 실측): 목록은 지역 조건을 보탠 구조로 대조하고 displayChecks 로
 * 규모·지역·업종 줄을 판정 결과에 맞췄는데, 상세는 저장 구조를 그대로 대조했다. 그래서 직원 20명·매출 30억 회사의
 * S-OJT 공고가 목록에선 「기업 규모 맞음」, 상세에선 「기업 규모 미입력 · 5개 중 0개 맞음」이었다.
 */
import { matchAnnouncement, readStoredStructure, type BusinessProfile, type MatchResult } from "./match-engine";
import { withRegionConditions, type RegionSource } from "./region-augment";
import { displayChecks } from "./eligibility-review";
import type { AnnouncementStructure, ConditionCheck } from "./structure-types";

export interface VisibleChecks {
  /** 지역·대상 분야·대상 유형을 보탠 구조 — 판정(reviewEligibility)도 이 구조를 받는다. */
  structure: AnnouncementStructure;
  /** 원래 대조 결과 — 점수·판정은 이 줄로 센다. */
  match: MatchResult;
  /** 화면에 보일 줄 — 규모·지역·업종 줄은 판정이 정한 맞음·안 맞음을 따른다. */
  shown: ConditionCheck[];
}

/**
 * 저장된 구조(JSON) 하나와 공고 머리(제목·기관·지역 칸)로 보이는 조건 줄을 만든다.
 * 출처 지역 칸(regionFieldFallback)은 목록이 예전부터 쓰던 안전망이라 여기서도 켠다 — 상세는 줄만 보이고 등급을 주지 않는다.
 */
export function visibleConditionChecks(
  storedStructure: unknown,
  row: RegionSource,
  profile: BusinessProfile,
  now: Date,
): VisibleChecks {
  const structure = withRegionConditions(readStoredStructure(storedStructure), row, { regionFieldFallback: true });
  const match = matchAnnouncement(structure, profile, now, { title: row.title ?? "" });
  const shown = displayChecks(match.checks, profile, now, structure.industryScope);
  return { structure, match, shown };
}
