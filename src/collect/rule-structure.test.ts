import { describe, expect, it } from "vitest";
import { buildRuleStructure, RULE_EXTRACT_VERSION } from "./rule-structure";

describe("무료 조건 추출 조립", () => {
  it("rule-extract 조건을 AnnouncementStructure 모양으로 싼다", () => {
    const s = buildRuleStructure("지원 대상: 업력 3년 이내, 상시근로자 5인 이상 중소기업", "요약", "제목");
    expect(s.conditions.length).toBeGreaterThan(0);
    expect(s.verified).toBe(false); // AI 검산을 안 거쳤다 — 절대 true 로 두지 않는다
    expect(s.benefitSummary).toBe(""); // 요약은 컬럼에 있어 JSONB 에 복제하지 않는다
    for (const c of s.conditions) expect(c.rawText.length).toBeGreaterThan(0);
  });
  it("아무 조건도 못 뽑으면 conditions 빈 배열 — 지어내지 않는다", () => {
    const s = buildRuleStructure("문의: 063-000-0000", "", "제목");
    expect(s.conditions).toEqual([]);
  });
});

describe("buildRuleStructure — 제목 앞머리 지역(판본 3)", () => {
  it("제목의 광역은 판정용, 시군구는 확인용 조건으로 들어간다", () => {
    const rs = buildRuleStructure("", "", "[경남] 진주시 2026년 해외지사화 지원사업 공고", "경상남도");
    const regions = rs.conditions.filter((c) => c.key === "region");
    expect(regions.some((c) => c.machineReadable && (c.value as string[])[0] === "경남")).toBe(true);
    expect(regions.some((c) => !c.machineReadable && (c.value as string[])[0] === "진주시")).toBe(true);
  });

  it("본문에서 이미 판정용 지역을 얻었으면 제목 광역을 또 넣지 않는다(같은 축 중복 금지)", () => {
    const rs = buildRuleStructure("경남 소재 중소기업 대상", "", "[경남] 진주시 공고", "경상남도");
    const machine = rs.conditions.filter((c) => c.key === "region" && c.machineReadable);
    expect(machine).toHaveLength(1);
    // 확인용 시군구는 그대로 남는다
    expect(rs.conditions.some((c) => c.key === "region" && !c.machineReadable)).toBe(true);
  });

  it("agency 를 안 넘겨도 (기존 호출부 호환) 터지지 않는다", () => {
    const rs = buildRuleStructure("", "", "[경기] 수원시 2026년 중소기업육성자금 공고");
    expect(rs.conditions.some((c) => c.key === "region" && c.machineReadable)).toBe(true);
  });

  it("판본이 3 이다 — 소급 재추출 대상을 이 숫자로 고른다", () => {
    expect(RULE_EXTRACT_VERSION).toBe(3);
  });
});
