import { describe, expect, it } from "vitest";
import { CONDITION_KEYS, CONDITION_LABEL, EXPECTED_OP, type StructuredCondition } from "./structure-types";
import {
  checkCondition,
  conditionPassIsFitGrade,
  foundationSido,
  parseBusinessProfile,
  readStoredStructure,
  type BusinessProfile,
  type LoanUse,
} from "./match-engine";

// NO.714 — 고객이 쓰는 보증·대출을 기관별로 읽어 전환보증(guaranteeInUse)·대환(hasExistingLoan) 조건을 판정한다.
const NOW = new Date("2026-11-11T00:00:00.000Z");

function guarantee(value: string[]): StructuredCondition {
  return { key: "guaranteeInUse", op: "in", value, rawText: `${value[0]} 보증 이용 중(전환보증)`, machineReadable: true };
}
const REFINANCE: StructuredCondition = {
  key: "hasExistingLoan", op: "eq", value: true, rawText: "기존 대출 이용 중(대환)", machineReadable: true,
};
const ANY_FOUNDATION = guarantee(["지역신용보증재단"]);

const GYEONGGI: LoanUse = {
  agency: "지역신용보증재단", name: "경기신용보증재단", sido: "경기", status: "in-use", balanceManwon: 700, source: "기업상태표",
};
const KODIT: LoanUse = { agency: "신용보증기금", name: "신용보증기금", status: "in-use", balanceManwon: 10000, source: "기업상태표" };
const SEMAS: LoanUse = { agency: "소상공인시장진흥공단", name: "소상공인시장진흥공단", status: "in-use", source: "기업상태표" };

const verdictOf = (c: StructuredCondition, p: BusinessProfile) => checkCondition(c, p, NOW);

describe("기존 보증 조건 칸(guaranteeInUse)", () => {
  it("조건 사전에 있고 비교 방식은 in, 이름표는 「기존 보증」", () => {
    expect(CONDITION_KEYS).toContain("guaranteeInUse");
    expect(EXPECTED_OP.guaranteeInUse).toBe("in");
    expect(CONDITION_LABEL.guaranteeInUse).toBe("기존 보증");
  });

  it("저장된 구조에서 값이 글자 목록일 때만 기계 대조한다", () => {
    const s = readStoredStructure({
      conditions: [ANY_FOUNDATION, { ...ANY_FOUNDATION, value: true }, { ...ANY_FOUNDATION, value: [1] }],
      humanCheck: [],
    });
    expect(s.conditions.map((c) => c.machineReadable)).toEqual([true, false, false]);
  });
});

describe("재단 이름 → 시도(foundationSido)", () => {
  it("「<시도>신용보증재단」만 시도를 돌려준다", () => {
    expect(foundationSido("경기신용보증재단")).toBe("경기");
    expect(foundationSido("충청남도신용보증재단")).toBe("충남");
    expect(foundationSido("지역신용보증재단")).toBeNull();
    expect(foundationSido("신용보증기금")).toBeNull();
    expect(foundationSido("")).toBeNull();
  });
});

describe("전환보증 판정(checkCondition guaranteeInUse)", () => {
  it("지역 재단 보증을 쓰면 맞음 — 근거에 재단 이름과 출처", () => {
    const r = verdictOf(ANY_FOUNDATION, { hasExistingLoan: true, loanUses: [GYEONGGI] });
    expect(r.verdict).toBe("pass");
    expect(r.note).toBe("경기신용보증재단 보증 이용 중(기업상태표) → 전환보증 대상");
  });

  it("같은 지역 재단을 원하면 맞음, 다른 지역 재단이면 「보증 재단 지역 확인」", () => {
    expect(verdictOf(guarantee(["경기신용보증재단"]), { loanUses: [GYEONGGI] }).verdict).toBe("pass");
    const other = verdictOf(guarantee(["충남신용보증재단"]), { loanUses: [GYEONGGI] });
    expect(other.verdict).toBe("unknown");
    expect(other.note).toBe("보증 재단 지역 확인");
  });

  it("고객 재단의 시도를 모르면 특정 재단 조건은 「보증 재단 지역 확인」", () => {
    const noSido: LoanUse = { ...GYEONGGI, name: "신용보증재단", sido: undefined };
    const r = verdictOf(guarantee(["경기신용보증재단"]), { loanUses: [noSido] });
    expect(r.verdict).toBe("unknown");
    expect(r.note).toBe("보증 재단 지역 확인");
    // 어느 재단이든 되는 조건은 시도를 몰라도 맞음이다.
    expect(verdictOf(ANY_FOUNDATION, { loanUses: [noSido] }).verdict).toBe("pass");
  });

  it("「신보 1억」만 있고 기록이 완전하면 불가 — 근거에 가진 기관", () => {
    const r = verdictOf(ANY_FOUNDATION, { hasExistingLoan: true, loanUses: [KODIT], loanUsesComplete: true });
    expect(r.verdict).toBe("fail");
    expect(r.note).toBe("지역 신용보증재단 보증 없음(기업상태표: 신용보증기금)");
  });

  it("「신보」만 있어도 기록이 완전하지 않으면 확인 필요", () => {
    const r = verdictOf(ANY_FOUNDATION, { hasExistingLoan: true, loanUses: [KODIT] });
    expect(r.verdict).toBe("unknown");
    expect(r.note).toBe("기존 보증 이용 여부");
  });

  it("신보 전환 조건은 신보 이용으로 맞음", () => {
    const r = verdictOf(guarantee(["신용보증기금"]), { loanUses: [KODIT, GYEONGGI] });
    expect(r.verdict).toBe("pass");
    expect(r.note).toBe("신용보증기금 보증 이용 중(기업상태표) → 전환보증 대상");
  });

  it("재단 기록이 「상환 완료」·「확인 필요」(모름)뿐이면 확인 필요", () => {
    const repaid: LoanUse = { ...GYEONGGI, status: "unknown" };
    const r = verdictOf(ANY_FOUNDATION, { hasExistingLoan: true, loanUses: [repaid], loanUsesComplete: true });
    expect(r.verdict).toBe("unknown");
    expect(r.note).toBe("기존 보증 이용 여부");
  });

  it("칸이 비면 「기존 보증 이용 여부」 확인 필요", () => {
    expect(verdictOf(ANY_FOUNDATION, {})).toMatchObject({ verdict: "unknown", note: "기존 보증 이용 여부" });
    expect(verdictOf(ANY_FOUNDATION, { hasExistingLoan: true })).toMatchObject({ verdict: "unknown", note: "기존 보증 이용 여부" });
  });

  it("대출 없음이 확인되면 불가", () => {
    expect(verdictOf(ANY_FOUNDATION, { hasExistingLoan: false })).toMatchObject({ verdict: "fail", note: "기존 보증·대출 없음" });
  });

  it("이용 중 기록이 있으면 대출 없음 표시보다 기록을 믿는다", () => {
    expect(verdictOf(ANY_FOUNDATION, { hasExistingLoan: false, loanUses: [GYEONGGI] }).verdict).toBe("pass");
  });

  it("맞음은 「가능」 근거가 된다(원문 낱말이 조건으로 설명된다)", () => {
    const r = verdictOf(ANY_FOUNDATION, { loanUses: [GYEONGGI] });
    expect(conditionPassIsFitGrade(r, { loanUses: [GYEONGGI] })).toBe(true);
    const named = verdictOf(guarantee(["경기신용보증재단"]), { loanUses: [GYEONGGI] });
    expect(conditionPassIsFitGrade(named, { loanUses: [GYEONGGI] })).toBe(true);
  });
});

describe("대환 판정(checkCondition hasExistingLoan) 근거", () => {
  it("대출을 쓰면 맞음 — 근거에 기관과 출처", () => {
    const r = verdictOf(REFINANCE, { hasExistingLoan: true, loanUses: [SEMAS] });
    expect(r.verdict).toBe("pass");
    expect(r.note).toBe("소상공인시장진흥공단 대출 이용 중(기업상태표) → 대환 대상");
  });

  it("기관 기록이 없으면 근거 없이 맞음(종전과 같다)", () => {
    expect(verdictOf(REFINANCE, { hasExistingLoan: true })).toMatchObject({ verdict: "pass", note: "" });
  });

  it("대출 없음이 확인되면 불가, 비면 확인 필요(종전과 같다)", () => {
    expect(verdictOf(REFINANCE, { hasExistingLoan: false }).verdict).toBe("fail");
    expect(verdictOf(REFINANCE, {})).toMatchObject({ verdict: "unknown", note: "기존 대출 유무 미입력" });
  });

  it("「기존 대출 없어야」 조건의 맞음에는 근거를 붙이지 않는다", () => {
    const noLoan: StructuredCondition = { ...REFINANCE, value: false, rawText: "기존 대출 없어야 함" };
    expect(verdictOf(noLoan, { hasExistingLoan: false, loanUses: [] })).toMatchObject({ verdict: "pass", note: "" });
  });

  it("대환 맞음은 「가능」 근거가 된다", () => {
    const p: BusinessProfile = { hasExistingLoan: true, loanUses: [SEMAS] };
    expect(conditionPassIsFitGrade(verdictOf(REFINANCE, p), p)).toBe(true);
  });
});

describe("고객 기록 읽기(parseBusinessProfile loanUses)", () => {
  it("올바른 기록과 완전 표시를 읽는다 — 재단 시도는 이름에서 채운다", () => {
    const p = parseBusinessProfile({
      loanUses: [{ ...GYEONGGI, sido: undefined }, KODIT],
      loanUsesComplete: true,
    });
    expect(p.loanUses).toEqual([GYEONGGI, KODIT]);
    expect(p.loanUsesComplete).toBe(true);
  });

  it("모르는 기관·상태가 섞이면 그 기록을 버리고 완전 표시도 버린다", () => {
    const p = parseBusinessProfile({
      loanUses: [GYEONGGI, { ...KODIT, agency: "대부업" }, { ...KODIT, status: "repaid" }],
      loanUsesComplete: true,
    });
    expect(p.loanUses).toEqual([GYEONGGI]);
    expect(p.loanUsesComplete).toBeUndefined();
  });

  it("시도 칸이 이름과 다르면 이름 쪽 시도를 쓴다", () => {
    const p = parseBusinessProfile({ loanUses: [{ ...GYEONGGI, sido: "서울" }] });
    expect(p.loanUses?.[0].sido).toBe("경기");
  });

  it("빈 목록·목록 아님이면 칸을 만들지 않는다(빈 회사 정보 판단을 지킨다)", () => {
    expect(parseBusinessProfile({ loanUses: [], loanUsesComplete: true })).toEqual({});
    expect(parseBusinessProfile({ loanUses: "경기신용보증재단" })).toEqual({});
  });

  it("음수·너무 큰 잔액은 잔액만 버린다", () => {
    const p = parseBusinessProfile({ loanUses: [{ ...SEMAS, balanceManwon: -1 }, { ...KODIT, balanceManwon: 1e12 }] });
    expect(p.loanUses).toEqual([SEMAS, { ...KODIT, balanceManwon: undefined }]);
    expect(p.loanUses?.map((u) => "balanceManwon" in u)).toEqual([false, false]);
  });
});
