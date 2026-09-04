import { describe, expect, it } from "vitest";
import { rulesToConditions } from "./rules-to-conditions";

describe("rulesToConditions — 상품 대상 규칙을 판정 엔진의 조건으로(설계 2026-09-03 §3)", () => {
  it("규칙을 조건 사전 키로 바꾼다 — 나이 상한은 기계 불가(other)", () => {
    const out = rulesToConditions({ region: ["서울"], bizAgeMinYears: 1, creditScoreMin: 600, representativeAgeMax: 39 }, "서울 소재 1년 이상 NICE 600 이상 39세 이하");
    expect(out.map((c) => [c.key, c.op, c.value, c.machineReadable])).toEqual([
      ["region", "in", ["서울"], true],
      ["businessAgeMinYears", "gte", 1, true],
      ["creditScoreMin", "gte", 600, true],
      ["other", "lte", 39, false],
    ]);
    expect(out.every((c) => c.rawText.length > 0)).toBe(true); // 원문 절대 비우지 않는다
  });
  it("빈 규칙은 빈 배열", () => { expect(rulesToConditions({}, "아무나")).toEqual([]); });

  it("나머지 키도 조건 사전의 이름으로 바뀐다", () => {
    const out = rulesToConditions(
      {
        industry: ["제조업"],
        scale: ["소상공인"],
        bizAgeMaxYears: 7,
        creditScoreMax: 839,
        revenueMaxKrw: 1_000_000_000,
        employeesMax: 10,
        isCorporation: false,
        hasExistingLoan: true,
      },
      "대상 원문",
    );
    expect(out.map((c) => [c.key, c.op, c.value])).toEqual([
      ["industry", "in", ["제조업"]],
      ["companyScale", "in", ["소상공인"]],
      ["businessAgeMaxYears", "lte", 7],
      ["creditScoreMax", "lte", 839],
      ["revenueMaxKrw", "lte", 1_000_000_000],
      ["employeeMax", "lte", 10],
      ["isCorporation", "eq", false],
      ["hasExistingLoan", "eq", true],
    ]);
    expect(out.every((c) => c.machineReadable)).toBe(true);
  });

  it("빈 배열·숫자 아닌 값은 조건을 만들지 않는다 — 아무에게나 통과를 주지 않기 위해서다", () => {
    expect(rulesToConditions({ region: [], industry: [], scale: [] }, "아무나")).toEqual([]);
    expect(rulesToConditions({ creditScoreMin: Number.NaN, bizAgeMinYears: Number.POSITIVE_INFINITY }, "아무나")).toEqual([]);
  });

  it("키별 원문은 사람이 읽을 한국어 한 줄이고, 못 지으면 대상 글 앞머리로 채운다", () => {
    const [region] = rulesToConditions({ region: ["서울", "경기"] }, "서울·경기 소재 소상공인");
    expect(region.rawText).toBe("소재지 서울, 경기");
    const [loan] = rulesToConditions({ hasExistingLoan: false }, "기존 대출이 없는 사업자");
    expect(loan.rawText).toBe("기존 대출 없어야 함");
    const long = "가".repeat(200);
    const [other] = rulesToConditions({ representativeAgeMax: 39 }, long);
    expect(other.rawText).toBe("대표 39세 이하");
    expect(rulesToConditions({ representativeAgeMax: 39 }, "")[0].rawText).toBe("대표 39세 이하");
  });

  it("만든 조건은 전부 판정 엔진의 기대 비교(EXPECTED_OP)와 맞는다 — 어긋나면 기계대조가 조용히 꺼진다", async () => {
    const { opFitsKey } = await import("../../engine/structure-types");
    const out = rulesToConditions(
      {
        region: ["서울"], industry: ["제조업"], scale: ["소상공인"],
        bizAgeMinYears: 1, bizAgeMaxYears: 7, creditScoreMin: 600, creditScoreMax: 839,
        revenueMaxKrw: 1_000_000_000, employeesMax: 10, isCorporation: true, hasExistingLoan: true,
      },
      "대상 원문",
    );
    expect(out).toHaveLength(11);
    expect(out.every((c) => opFitsKey(c.key, c.op))).toBe(true);
  });

  it("humanCheck(기계로 못 재는 필수조건 원문) 각 항목은 other 조건(machineReadable:false)으로 덧붙는다 — 버리지 않는다(F3)", () => {
    const out = rulesToConditions(
      { region: ["서울"], humanCheck: ["폐업(예정) 소상공인", "운영사 추천 필요", "신용평점 하위 20%"] },
      "서울 소재",
    );
    expect(out.map((c) => [c.key, c.op, c.value, c.rawText, c.machineReadable])).toEqual([
      ["region", "in", ["서울"], "소재지 서울", true],
      ["other", "eq", true, "폐업(예정) 소상공인", false],
      ["other", "eq", true, "운영사 추천 필요", false],
      ["other", "eq", true, "신용평점 하위 20%", false],
    ]);
  });

  it("humanCheck 가 빈 배열이거나 없으면 아무 조건도 안 붙인다", () => {
    expect(rulesToConditions({ humanCheck: [] }, "아무나")).toEqual([]);
    expect(rulesToConditions({ region: ["서울"], humanCheck: undefined }, "아무나")).toHaveLength(1);
  });
});
