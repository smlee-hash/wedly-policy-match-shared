import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { BusinessProfile } from "./match-engine";
import { visibleConditionChecks } from "./visible-checks";

/**
 * 목록 줄과 공고 상세 「신청 자격 대조」 표가 **같은 조건 줄**을 보이는가(NO.585 후속, 2026-11-10 운영 실측).
 * 상세는 저장 구조를 그대로 대조해 직원 20명·매출 30억 회사에도 「기업 규모 미입력」을 남겼다
 * — 목록 줄은 같은 공고를 「기업 규모 맞음」으로 보였다.
 */

const NOW = new Date("2026-11-10T03:00:00.000Z");

// 운영 S-OJT 「체계적 현장훈련 …」(고용노동부) 저장 구조에서 조건 다섯 줄을 그대로 옮겼다.
const SOJT_STRUCTURE = {
  conditions: [
    {
      op: "in",
      key: "companyScale",
      value: ["우선지원대상기업", "중소기업"],
      rawText: "고용보험가입 사업장 중 고용보험법 시행령 제 12 조에서 우선지원대상기업 (= 중소기업 ) 이면 지원받을 수 있으나 일부 기업의 경우 지원이 제한됩니다 .",
      machineReadable: true,
    },
    {
      op: "eq",
      key: "other",
      value: true,
      rawText: "고용보험가입 사업장 중 고용보험법 시행령 제 12 조에서 우선지원대상기업 (= 중소기업 ) 이면 지원받을 수 있으나 일부 기업의 경우 지원이 제한됩니다 .",
      machineReadable: false,
    },
    { op: "eq", key: "noTaxDelinquency", value: true, rawText: "고용보험료를 신청일 기준으로 체납하지 않아야 합니다 .", machineReadable: true },
    { op: "eq", key: "other", value: true, rawText: "임금체불명단 공개 사업장 및 산재다발 사업장이 아니여야 합니다 .", machineReadable: false },
    {
      op: "in",
      key: "industry",
      value: ["풍속영업", "청소년 유해업종", "성매매알선", "공공기관", "지방공기업", "비영리사업자", "협회", "단체", "국제기관", "외국기관", "다단계 판매", "훈련기관"],
      rawText: "기타 아래의 업종은 제한되니 확인해보세요 . 「 풍속영업의 규제에 관한 법률 」 제 2 조에 따른 업종에 해당하는 기업 … 교육 · 훈련을 주 사업으로 하는 훈련기관",
      machineReadable: false,
    },
  ],
  industryScope: "restricted",
};
const SOJT_ROW = { title: "체계적 현장훈련 참여기업으로 선정되면 훈련 실시에 소요되는 훈련비와 훈련…", agency: "고용노동부(고용24)", region: "" };

const GG_MAKER: BusinessProfile = {
  industry: "제조업",
  region: "경기",
  regionSigungu: "김포시",
  employeeCount: 20,
  lastYearRevenueKrw: 3_000_000_000,
  foundedDate: "2015-03-01",
  taxDelinquent: true,
};

const verdictOf = (key: string, checks: ReturnType<typeof visibleConditionChecks>["shown"]) =>
  checks.filter((c) => c.condition.key === key).map((c) => c.verdict);

describe("visibleConditionChecks — 목록 줄과 상세 표가 같은 조건 줄", () => {
  it("직원 수·매출이 있으면 기업 규모는 「맞음」 — 「기업 규모 미입력」이 남지 않는다", () => {
    const { shown } = visibleConditionChecks(SOJT_STRUCTURE, SOJT_ROW, GG_MAKER, NOW);
    expect(verdictOf("companyScale", shown)).toEqual(["pass"]);
    expect(shown.some((c) => c.note.includes("기업 규모 미입력"))).toBe(false);
    const counts = { pass: 0, unknown: 0, fail: 0 };
    for (const c of shown) counts[c.verdict] += 1;
    // 운영 목록 줄: 기업 규모 맞음 · 기타 확인 · 세금 체납 안 맞음 · 기타 확인 · 업종 맞음.
    expect(shown.map((c) => c.verdict)).toEqual(["pass", "unknown", "fail", "unknown", "pass"]);
    expect(counts).toEqual({ pass: 2, unknown: 2, fail: 1 });
  });

  it("점수·판정에 쓰는 원래 줄(match.checks)은 그대로 둔다", () => {
    const { match } = visibleConditionChecks(SOJT_STRUCTURE, SOJT_ROW, GG_MAKER, NOW);
    expect(match.checks.find((c) => c.condition.key === "companyScale")?.verdict).toBe("unknown");
  });

  it("제목의 [광역] 은 지역 조건으로 보태 목록 줄과 같은 지역 줄을 보인다", () => {
    const row = { title: "[경기] 김포시 2026년 제조기업 현장 개선 지원", agency: "경기도", region: "" };
    const { shown, structure } = visibleConditionChecks({ conditions: [] }, row, GG_MAKER, NOW);
    expect(structure.conditions.some((c) => c.key === "region")).toBe(true);
    expect(verdictOf("region", shown)).toContain("pass");
  });

  it("출처 지역 칸도 목록 줄처럼 보탠다(지역 조건이 하나도 없을 때)", () => {
    const row = { title: "제조기업 현장 개선 지원", agency: "", region: "부산" };
    const { shown } = visibleConditionChecks({ conditions: [] }, row, GG_MAKER, NOW);
    expect(verdictOf("region", shown)).toEqual(["fail"]);
  });
});

describe("배선 — 목록과 상세가 같은 함수를 부른다", () => {
  const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

  it("목록(funding-map-build)은 visibleConditionChecks 의 shown 으로 줄을 만든다", () => {
    const src = read("../build/funding-map-build.ts");
    expect(src).toMatch(/visibleConditionChecks\(/);
    expect(src).toMatch(/fitsOf\(shown\)/);
  });

  it("상세(DetailPanel)는 visibleConditionChecks 의 shown 으로 대조표를 만든다 — match.checks 를 바로 쓰지 않는다", () => {
    const src = read("../ui/policy/DetailPanel.tsx");
    expect(src).toMatch(/visibleConditionChecks\(/);
    expect(src).toMatch(/mergeConditionRows\(shown,/);
    expect(src).not.toMatch(/mergeConditionRows\(match\.checks/);
  });
});
