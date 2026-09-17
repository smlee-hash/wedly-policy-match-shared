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

  it("판본이 6 이다 — 소급 재추출 대상을 이 숫자로 고른다(5: 대상 분야, 6: 대상 유형)", () => {
    expect(RULE_EXTRACT_VERSION).toBe(6);
  });
});

describe("buildRuleStructure — 태그 없는 제목의 시군구(판본 4)", () => {
  const TITLE = "2026년 3차 영월군 청년 창업육성 지원사업 수정 공고";
  it("기관에서 시도가 읽히면 판정용 region [영월군] 을 저장한다", () => {
    const s = buildRuleStructure("", "", TITLE, "강원특별자치도");
    const r = s.conditions.filter((c) => c.key === "region");
    expect(r).toHaveLength(1);
    expect(r[0].value).toEqual(["영월군"]);
    expect(r[0].machineReadable).toBe(true);
    expect((s as unknown as { ruleVersion: number }).ruleVersion).toBe(6);
  });
  it("기관에 시도가 없으면 지역 조건을 저장하지 않는다 — 출처 지역 칸 폴백(②)이 그대로 산다", () => {
    const s = buildRuleStructure("", "", TITLE, "영월군");
    expect(s.conditions.filter((c) => c.key === "region")).toEqual([]);
  });
});

describe("buildRuleStructure — 대상 분야(targetSector)는 제목에서만", () => {
  it("제목이 「제약기업」이면 조건을 저장한다", () => {
    const s = buildRuleStructure("", "", "2026년 혁신형 제약기업 신규인증 공고", "보건복지부");
    const t = s.conditions.filter((c) => c.key === "targetSector");
    expect(t).toHaveLength(1);
    expect(t[0].value).toEqual(["제약바이오"]);
  });
  it("본문에만 「블록체인 기업」이 나오면 조건을 만들지 않는다 — 지나가는 말로 회사를 지우지 않는다", () => {
    const s = buildRuleStructure("블록체인 기업과 협력해 수행합니다", "", "2026년 중소기업 판로개척 지원사업", "중기부");
    expect(s.conditions.filter((c) => c.key === "targetSector")).toEqual([]);
  });
});

describe("buildRuleStructure — 대상 유형(targetOrg)는 제목에서만", () => {
  it("제목이 자격형(사회적기업 사업개발비)이면 조건을 저장한다", () => {
    const s = buildRuleStructure("", "", "[충남] 2026년 (예비)사회적기업 사업개발비 지원사업 참여기업 모집 공고", "충청남도");
    const t = s.conditions.filter((c) => c.key === "targetOrg");
    expect(t).toHaveLength(1);
    expect(t[0].value).toEqual(["사회적기업"]);
    expect(t[0].machineReadable).toBe(true);
  });
  it("「착한가격업소 신규모집」처럼 그 자격을 받으려는 공고는 저장하지 않는다(2차 리뷰 M-B)", () => {
    const s = buildRuleStructure("", "", "[전남광주] 목포시 2026년 착한가격업소 신규모집 공고", "목포시");
    expect(s.conditions.filter((c) => c.key === "targetOrg")).toEqual([]);
  });
  it("본문에만 「사회적기업과 협업」이 나오면 조건을 만들지 않는다 — 지나가는 말로 회사를 지우지 않는다", () => {
    const s = buildRuleStructure("사회적기업과 협업하는 중소기업을 찾습니다", "", "2026년 중소기업 판로개척 지원사업", "중기부");
    expect(s.conditions.filter((c) => c.key === "targetOrg")).toEqual([]);
  });
});
