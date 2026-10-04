import { describe, expect, it, vi } from "vitest";
import { parseBusinessProfile } from "../engine/match-engine";
import type { AnnouncementStructure, StructuredCondition } from "../engine/structure-types";
import { runDiagnose } from "./diagnose";
import { CURRENT_STRUCTURE_VERSION } from "./structure-status";

// 독립 리뷰(Astra) AF1-11 — 서류에서 늘어난 프로필 칸이 서버 경계(parseBusinessProfile)에서 빠지지 않는다.
// 특히 isCorporation 이 빠지면 법인 전용 조건이 계속 「모름」으로 남는다.

const CORP_ONLY: StructuredCondition = {
  key: "isCorporation",
  op: "eq",
  value: true,
  rawText: "법인사업자만 신청 가능",
  machineReadable: true,
};

function structure(conditions: StructuredCondition[]): AnnouncementStructure {
  return {
    benefitSummary: "자금 지원",
    supportAmountText: "1억원",
    aiSummary: { purpose: "", target: "", scale: "", scaleItems: [] },
    conditions,
    humanCheck: [],
    documents: [],
    verified: true,
    industryScope: "all",
    regionScope: "all",
  };
}

function makeQ(conditions: StructuredCondition[]) {
  const row = {
    id: "a",
    title: "공고 a",
    agency: "중기부",
    category: "금융",
    applyEnd: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
    applyPeriodText: "상시",
    structure: structure(conditions),
    structureStatus: "done",
    structureVersion: CURRENT_STRUCTURE_VERSION,
    region: "서울",
  };
  return {
    findAnnouncements: vi.fn(async () => [row]),
    groupAnnouncementsByStructure: vi.fn(async () => []),
  } as never;
}

/** 공고 하나(법인 전용 조건)를 이 프로필로 진단해 그 공고 한 줄을 돌려준다. */
async function diagnoseOne(profile: unknown) {
  const r = await runDiagnose(profile, makeQ([CORP_ONLY]));
  if (!r.ok) throw new Error("진단이 실패했다");
  const all = [...r.data.possible, ...r.data.uncertain, ...r.data.impossible];
  expect(all).toHaveLength(1);
  return all[0];
}

describe("runDiagnose — 법인 여부(isCorporation)가 서버 경계를 넘는다", () => {
  it("법인 전용 조건: isCorporation:true 면 통과, 안 보내면 모름이다", async () => {
    const unknown = await diagnoseOne({});
    const corp = await diagnoseOne({ isCorporation: true });
    expect(corp.checks.pass - unknown.checks.pass).toBe(1);
    expect(corp.checks.fail).toBe(0);
    expect(corp.checks.unknown).toBe(unknown.checks.unknown - 1);
  });

  it("isCorporation:false 면 법인 전용 조건에서 불가", async () => {
    const solo = await diagnoseOne({ isCorporation: false });
    expect(solo.grade).toBe("impossible");
    expect(solo.checks.fail).toBe(1);
    expect(solo.failSummary).toContain("법인");
  });

  it("boolean 이 아닌 값(\"true\")은 복사하지 않는다 — 모름으로 남는다", async () => {
    const unknown = await diagnoseOne({});
    const text = await diagnoseOne({ isCorporation: "true" });
    expect(text.checks).toEqual(unknown.checks);
  });
});

describe("parseBusinessProfile — 서류 읽기로 늘어난 칸", () => {
  it("형식이 맞는 값은 그대로 복사한다", () => {
    expect(
      parseBusinessProfile({
        isCorporation: true,
        businessAddress: "경기 화성시",
        certTypes: ["벤처", "이노비즈", "벤처"],
        patentCount: 3,
        existingLoanBalanceManwon: 5000,
        creditScoreNice: 850,
        creditScoreKcb: 900,
      }),
    ).toEqual({
      isCorporation: true,
      businessAddress: "경기 화성시",
      certTypes: ["벤처", "이노비즈"],
      patentCount: 3,
      existingLoanBalanceManwon: 5000,
      creditScoreNice: 850,
      creditScoreKcb: 900,
    });
  });

  it("형식이 안 맞는 값은 모름으로 둔다(번지가 든 주소·모르는 인증·소수 건수·범위 밖 점수)", () => {
    expect(
      parseBusinessProfile({
        isCorporation: "예",
        businessAddress: "서울 강남구 테헤란로 123",
        certTypes: ["엉터리"],
        patentCount: 1.5,
        existingLoanBalanceManwon: -1,
        creditScoreNice: 5000,
        creditScoreKcb: 100,
      }),
    ).toEqual({});
    expect(parseBusinessProfile({ patentCount: 1_000_000 })).toEqual({});
    expect(parseBusinessProfile({ existingLoanBalanceManwon: "많음" })).toEqual({});
  });
});
