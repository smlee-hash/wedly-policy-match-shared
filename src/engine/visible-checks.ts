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

/** AI 가 읽어 둔 공고인가 — 대조는 이 공고만 AI 구조로 한다. */
export function readByAi(row: { structureStatus: string }): boolean {
  return row.structureStatus === "done" || row.structureStatus === "needs_review";
}

/**
 * 대조에 쓸 저장 구조 하나 고르기 — 목록 줄과 공고 상세가 같은 구조로 대조해야 같은 줄이 나온다.
 * ★적대 리뷰(2026-08-29 중요4): `structure ?? ruleStructure` 는 실패 스텁을 골라잡는다 — 상태로 판별한다.
 * 아직 못 읽었거나(pending·working) 읽기에 실패한 공고는 저장 때 자동으로 만든 무료 규칙 구조(ruleStructure)로 대조한다.
 * 상세 응답에 ruleStructure 칸이 아예 없으면(칸을 보태기 전 서버) 예전처럼 structure 를 쓴다.
 */
export function matchStructureOf(row: { structureStatus: string; structure: unknown; ruleStructure?: unknown }): unknown {
  if (readByAi(row)) return row.structure;
  return row.ruleStructure !== undefined ? row.ruleStructure : row.structure;
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
