import { extractConditions, titleRegionConditions } from "./rule-extract";
import type { AnnouncementStructure } from "./structure-types";

/**
 * 무료 추출 규칙 판본. 규칙을 넓히면 올린다 — 이미 저장된 공고를 어디까지 다시 뽑아야
 * 하는지 이 숫자로 가린다(소급 통로 `/api/policy-match/rule-reextract`).
 *  1: 업력·직원수·매출·기업규모·체납 (2026-08-25)
 *  2: 업종·지역 추가 (2026-08-30 — 표본 150건에서 조건 0건이던 것의 49%가 조건을 갖게 됨)
 *  3: 제목 앞머리 「[광역] 시군구」 (2026-09-01 — 시군구 전용 공고 656건이 지역 무관하게
 *     「조건 충족」으로 뜨던 것. 그중 471건은 본문에 지역 문구가 없어 조건이 하나도 없었다)
 */
export const RULE_EXTRACT_VERSION = 3;

/**
 * 무료 규칙 추출 → 저장용 AnnouncementStructure. AI 0콜.
 * verified 는 언제나 false — AI 검산을 거치지 않았다는 사실을 그대로 둔다(화면 신뢰 표시와 연결).
 */
export function buildRuleStructure(
  targetText: string,
  summary: string,
  title: string,
  /** 소관기관. 제목 앞머리 광역이 기관과 어긋날 때 판정용 조건을 만들지 않는 데 쓴다(원본 표기 오류 방어). */
  agency = "",
): AnnouncementStructure {
  const body = extractConditions([targetText, summary, title].filter(Boolean).join("\n"));
  // 제목 앞머리는 본문과 따로 읽는다 — 합친 글에서는 「[광역] 시군구」가 맨 앞이 아니라 못 잡는다.
  const fromTitle = titleRegionConditions(title, agency);
  // 본문에서 이미 판정용 지역을 얻었으면 제목 광역은 버린다(같은 축 조건이 둘이면 화면이 헷갈린다).
  const hasMachineRegion = body.some((c) => c.key === "region" && c.machineReadable);
  const conditions = [...body, ...fromTitle.filter((c) => !(hasMachineRegion && c.machineReadable))];
  return {
    // 요약은 이미 summary 컬럼에 있다 — JSONB 에 또 넣으면 행마다 저장·조회가 요약만큼 두 배(적대 리뷰 사소).
    benefitSummary: "",
    supportAmountText: "",
    aiSummary: { purpose: "", target: "", scale: "", scaleItems: [] },
    conditions,
    humanCheck: [],
    documents: [],
    verified: false,
    // 판본을 함께 담아 둔다 — 규칙이 넓어졌을 때 다시 뽑을 대상을 고르는 열쇠.
    ruleVersion: RULE_EXTRACT_VERSION,
  } as AnnouncementStructure & { ruleVersion: number };
}
