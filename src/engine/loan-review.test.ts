import { describe, expect, it } from "vitest";
import { judgeRequirementText, REGION_SCOPE_UNKNOWN, reviewEligibility } from "./eligibility-review";
import { guarantorsIn, withoutGuarantors } from "./loan-program";
import { matchAnnouncement, readStoredStructure, type BusinessProfile, type LoanUse } from "./match-engine";
import { withRegionConditions } from "./region-augment";
import type { ConditionCheck, StructuredCondition } from "./structure-types";

// NO.714 — 검토(reviewEligibility)가 기존 보증·대출 조건을 고객 기록으로 같은 말로 판정한다.
// 공고 구조는 운영 자료(2026-11-10 읽기 전용 조회)에서 판정에 쓰는 칸만 옮겼다. 고객은 지어낸 값이다.
const NOW = new Date("2026-11-11T00:00:00.000Z");

const GYEONGGI: LoanUse = {
  agency: "지역신용보증재단", name: "경기신용보증재단", sido: "경기", status: "in-use", balanceManwon: 700, source: "기업상태표",
};
const CHUNGNAM: LoanUse = { ...GYEONGGI, name: "충남신용보증재단", sido: "충남" };
const KODIT: LoanUse = { agency: "신용보증기금", name: "신용보증기금", status: "in-use", balanceManwon: 10000, source: "기업상태표" };
const SEMAS: LoanUse = {
  agency: "소상공인시장진흥공단", name: "소상공인시장진흥공단", status: "in-use", balanceManwon: 3000, source: "기업상태표",
};
const REPAID: LoanUse = { ...GYEONGGI, status: "unknown", balanceManwon: undefined };

/** 경기 소상공인(도소매 3명) — 기록만 바꿔 쓴다. */
const SHOP: BusinessProfile = {
  bizno: "123-45-67890",
  region: "경기",
  industry: "도소매업",
  employeeCount: 3,
  foundedDate: "2018-03-01",
  lastYearRevenueKrw: 300_000_000,
  taxDelinquent: false,
};

const GUARANTEE_LABELS = ["기존 보증 이용 여부", "보증 재단 지역 확인"];
const isRawLabel = (t: string) => t.startsWith("조건 확인:");

type Row = { title: string; agency: string; region: string; source: string };

function review(raw: unknown, row: Row, p: BusinessProfile) {
  const stored = readStoredStructure(raw);
  if (!stored) throw new Error("구조를 못 읽음");
  const s = withRegionConditions(stored, { title: row.title, agency: row.agency, region: row.region });
  const m = matchAnnouncement(s, p, NOW);
  return reviewEligibility({
    kind: "announcement",
    group: "policy",
    title: row.title,
    source: row.source,
    profile: p,
    now: NOW,
    checks: m.checks,
    humanCheckTexts: s.humanCheck,
    structure: s,
    placeOrgs: [row.agency],
  });
}

const EMPTY_SUMMARY = { scale: "", target: "", purpose: "", scaleItems: [] };

/** 보조24 「소기업·소상공인 전환보증」(cmt9twakz003k9s29nnnysu0q). */
const CONVERSION_ROW: Row = { title: "소기업·소상공인 전환보증", agency: "중소벤처기업부", region: "", source: "bojo24" };
const conversionStructure = (regionScope: string) => ({
  verified: true,
  aiSummary: EMPTY_SUMMARY,
  documents: [],
  conditions: [
    { op: "eq", key: "other", value: true, rawText: "재단의 보증을 이용 중인 기업", machineReadable: false },
    {
      op: "in", key: "companyScale", value: ["소기업", "소상공인"],
      rawText: "소기업·소상공인에게 만기상환 구조 전환을 통해 경영 안정을 지원", machineReadable: true,
    },
  ],
  humanCheck: ["재단의 보증을 이용 중인 기업", "소기업·소상공인에게 만기상환 구조 전환을 통해 경영 안정을 지원"],
  regionScope,
  industryScope: "all",
  benefitSummary: "",
  supportAmountText: "",
});

/** 충남신용보증재단 「보증통합 전환대출 안내」(cmtldo21g006mwmca346fse3r) — 본문이 비어 조건이 없다. */
const CHUNGNAM_ROW: Row = { title: "보증통합 전환대출 안내", agency: "충남신용보증재단", region: "충남", source: "cnsinbo" };
const CHUNGNAM_STRUCTURE = {
  verified: false,
  aiSummary: EMPTY_SUMMARY,
  documents: [],
  conditions: [],
  humanCheck: ["자격조건을 본문에서 못 찾음 — 원문·첨부 확인"],
  regionScope: "unknown",
  industryScope: "unknown",
  benefitSummary: "",
  supportAmountText: "",
};

/** 보조24 소상공인시장진흥공단 「대환대출」(cmt9u1p9y00qz9s291c3mj2pi). */
const REFINANCE_ROW: Row = { title: "대환대출", agency: "소상공인시장진흥공단", region: "", source: "bojo24" };
const REFINANCE_STRUCTURE = {
  verified: true,
  aiSummary: EMPTY_SUMMARY,
  documents: [],
  conditions: [
    { op: "lte", key: "creditScoreMax", value: 919, rawText: "①(중․저신용) 대표(이사)의 NCB개인신용평점 919점 이하", machineReadable: true },
    {
      op: "in", key: "companyScale", value: ["소상공인"],
      rawText: "②(소상공인) ｢소상공인기본법｣제2조 및 같은 법 시행령 제3조의 소상공인 요건을 충족하는 개인사업자 또는 법인기업",
      machineReadable: true,
    },
    { op: "eq", key: "other", value: true, rawText: "대출금 상환에 어려움을 겪는 ①중․저신용 ②소상공인", machineReadable: false },
  ],
  humanCheck: ["대출금 상환에 어려움을 겪는 ①중․저신용 ②소상공인"],
  regionScope: "all",
  industryScope: "all",
  benefitSummary: "",
  supportAmountText: "",
};

describe("전환보증 공고 — 고객 보증 기록으로 판정", () => {
  it("경기 재단 보증을 쓰는 고객 → 보증 확인이 남지 않는다(지역 범위 모름만 남음)", () => {
    const r = review(conversionStructure("unknown"), CONVERSION_ROW, { ...SHOP, loanUses: [GYEONGGI] });
    expect(r.verdict).toBe("unverified");
    expect(r.toCheck).toEqual([REGION_SCOPE_UNKNOWN]);
  });

  it("지역 범위가 전국인 같은 공고 → 「가능」", () => {
    const r = review(conversionStructure("all"), CONVERSION_ROW, { ...SHOP, loanUses: [GYEONGGI] });
    expect(r.verdict).toBe("fit");
    expect(r.toCheck).toEqual([]);
  });

  it("「신보 1억」만(기업상태표 정책자금 칸을 다 읽음) → 불가", () => {
    const r = review(conversionStructure("all"), CONVERSION_ROW, {
      ...SHOP, hasExistingLoan: true, loanUses: [KODIT], loanUsesComplete: true,
    });
    expect(r.verdict).toBe("excluded");
    expect(r.excludeReason).toBe("지역 신용보증재단 보증 없음(기업상태표: 신용보증기금)");
  });

  it("「신보 1억」만인데 못 읽은 조각이 있으면 → 확인 필요(가능 아님)", () => {
    const r = review(conversionStructure("all"), CONVERSION_ROW, { ...SHOP, hasExistingLoan: true, loanUses: [KODIT] });
    expect(r.verdict).toBe("unverified");
    expect(r.toCheck).toEqual(["기존 보증 이용 여부"]);
  });

  it("기록이 비었거나 상환 완료 → 「기존 보증 이용 여부」 한 줄(원문 줄 없음)", () => {
    for (const p of [SHOP, { ...SHOP, loanUses: [REPAID] }]) {
      const r = review(conversionStructure("all"), CONVERSION_ROW, p);
      expect(r.verdict).toBe("unverified");
      expect(r.toCheck).toEqual(["기존 보증 이용 여부"]);
    }
  });

  it("대출 없음이 확인된 고객 → 불가", () => {
    const r = review(conversionStructure("all"), CONVERSION_ROW, { ...SHOP, hasExistingLoan: false });
    expect(r.verdict).toBe("excluded");
    expect(r.excludeReason).toBe("기존 보증·대출 없음");
  });
});

describe("충남 재단 전환대출 공고 — 소재지만으로 맞음을 내지 않는다", () => {
  const CHUNGNAM_SHOP: BusinessProfile = { ...SHOP, region: "충남" };

  it("보증 기록이 없는 충남 고객 → 「기존 보증 이용 여부」", () => {
    const r = review(CHUNGNAM_STRUCTURE, CHUNGNAM_ROW, CHUNGNAM_SHOP);
    expect(r.toCheck).toContain("기존 보증 이용 여부");
  });

  it("충남 고객이 다른 시도 재단 보증만 쓰면 → 「보증 재단 지역 확인」", () => {
    const r = review(CHUNGNAM_STRUCTURE, CHUNGNAM_ROW, { ...CHUNGNAM_SHOP, loanUses: [GYEONGGI] });
    expect(r.toCheck).toContain("보증 재단 지역 확인");
    expect(r.toCheck).not.toContain("기존 보증 이용 여부");
  });

  it("충남 재단 보증을 쓰는 충남 고객 → 보증 확인이 남지 않는다", () => {
    const r = review(CHUNGNAM_STRUCTURE, CHUNGNAM_ROW, { ...CHUNGNAM_SHOP, loanUses: [CHUNGNAM] });
    expect(r.verdict).not.toBe("excluded");
    expect(r.toCheck.filter((t) => GUARANTEE_LABELS.includes(t) || isRawLabel(t))).toEqual([]);
  });
});

describe("대환대출 공고 — 기존 대출 조건", () => {
  it("소진공 대출을 쓰는 소상공인 → 대출 확인이 남지 않는다", () => {
    const r = review(REFINANCE_STRUCTURE, REFINANCE_ROW, { ...SHOP, hasExistingLoan: true, loanUses: [SEMAS] });
    expect(r.verdict).not.toBe("excluded");
    expect(r.toCheck.filter((t) => /대출/.test(t))).toEqual([]);
  });

  it("대출 없음이 확인된 고객 → 불가, 비면 「기존 대출 유무 입력」", () => {
    const none = review(REFINANCE_STRUCTURE, REFINANCE_ROW, { ...SHOP, hasExistingLoan: false });
    expect(none.verdict).toBe("excluded");
    expect(none.excludeReason).toBe("기존 대출이 있어야 함(대환)");
    expect(review(REFINANCE_STRUCTURE, REFINANCE_ROW, SHOP).toCheck).toContain("기존 대출 유무 입력");
  });
});

describe("판정 못 한 기존 보증 조건 — 메모를 그대로 확인할 것으로", () => {
  const SCALE_PASS: ConditionCheck = {
    condition: { key: "companyScale", op: "in", value: ["소상공인"], rawText: "소상공인", machineReadable: true },
    verdict: "pass",
    note: "",
  };
  const chungnamOnly: StructuredCondition = {
    key: "guaranteeInUse", op: "in", value: ["충남신용보증재단"], rawText: "충남신용보증재단 보증 이용 중(전환보증)", machineReadable: true,
  };
  const reviewOf = (note: string) =>
    reviewEligibility({
      kind: "product",
      group: "guarantee",
      title: "전환보증",
      profile: { ...SHOP, region: "충남" },
      now: NOW,
      checks: [SCALE_PASS, { condition: chungnamOnly, verdict: "unknown", note }],
    });

  it.each([
    ["보증 재단 지역 확인", "보증 재단 지역 확인"],
    ["기존 보증 이용 여부", "기존 보증 이용 여부"],
    ["", "기존 보증 이용 여부"],
  ])("메모 「%s」 → 「%s」(소재지가 같아도 맞음 아님)", (note, label) => {
    const r = reviewOf(note);
    expect(r.verdict).toBe("unverified");
    expect(r.toCheck).toEqual([label]);
  });
});

describe("judgeRequirementText — 기존 보증을 이용 중인 기업만 받는 문장", () => {
  it.each<[string, BusinessProfile, unknown]>([
    ["재단의 보증을 이용 중인 기업", { loanUses: [GYEONGGI] }, { kind: "pass" }],
    ["재단의 보증을 이용 중인 기업", {}, { kind: "check", label: "기존 보증 이용 여부" }],
    ["재단의 보증을 이용 중인 기업", { hasExistingLoan: false }, { kind: "fail", reason: "기존 보증·대출 없음" }],
    [
      "재단의 보증을 이용 중인 기업",
      { hasExistingLoan: true, loanUses: [KODIT], loanUsesComplete: true },
      { kind: "fail", reason: "지역 신용보증재단 보증 없음(기업상태표: 신용보증기금)" },
    ],
    ["경기신용보증재단의 보증을 이용하고 있는 기업", { region: "경기" }, { kind: "check", label: "기존 보증 이용 여부" }],
    [
      "경기신용보증재단의 보증을 이용하고 있는 기업",
      { region: "충남", loanUses: [CHUNGNAM] },
      { kind: "check", label: "보증 재단 지역 확인" },
    ],
    ["신용보증기금 보증을 이용 중인 기업", { loanUses: [KODIT] }, { kind: "pass" }],
    [
      "기보 보증서를 보유 중인 기업",
      { hasExistingLoan: true, loanUses: [KODIT], loanUsesComplete: true },
      { kind: "fail", reason: "기술보증기금 보증 없음(기업상태표: 신용보증기금)" },
    ],
    ["신용보증재단 보증부 대출을 이용 중인 소상공인", { ...SHOP, loanUses: [GYEONGGI] }, { kind: "pass" }],
    ["신보·재단 보증을 이용 중인 기업", { hasExistingLoan: true, loanUses: [GYEONGGI], loanUsesComplete: true }, { kind: "pass" }],
  ])("%s → %j", (text, p, want) => {
    expect(judgeRequirementText(text, p, NOW)).toEqual(want);
  });

  // 보증이 맞아도 나머지 요건(규모·소재지·모르는 말)은 그대로 본다 — 기관 이름 속 지역 낱말만 소재지로 읽지 않는다.
  it.each<[string, BusinessProfile, unknown]>([
    ["신용보증재단 보증부 대출을 이용 중인 소상공인", { loanUses: [GYEONGGI] }, { kind: "check", label: "기업 규모: 소상공인" }],
    ["경기신용보증재단의 보증을 이용 중인 서울 소재 기업", { ...SHOP, region: "서울", loanUses: [GYEONGGI] }, { kind: "pass" }],
    [
      "경기신용보증재단의 보증을 이용 중인 부산 소재 기업",
      { ...SHOP, region: "서울", loanUses: [GYEONGGI] },
      { kind: "fail", reason: "다른 지역 대상(부산)" },
    ],
    ["재단 보증을 이용 중인 수출 기업", { ...SHOP, loanUses: [GYEONGGI] }, { kind: "check", label: "수출기업 해당 여부" }],
    [
      "재단 보증을 이용 중인 경영 위기 기업",
      { ...SHOP, loanUses: [GYEONGGI] },
      { kind: "check", label: "조건 확인: 재단 보증을 이용 중인 경영 위기 기업" },
    ],
  ])("%s → 나머지 요건 %j", (text, p, want) => {
    expect(judgeRequirementText(text, p, NOW)).toEqual(want);
  });

  // 바꾸기 전 판정 그대로(2026-11-11 측정) — 새 보증을 받는 문장·제외·우대·대환 세부 문장은 이 갈래가 아니다.
  it.each<[string, unknown]>([
    ["신용보증재단의 보증서 발급이 가능한 기업", { kind: "check", label: "조건 확인: 신용보증재단의 보증서 발급이 가능한 기업" }],
    ["재단 보증을 이용 중인 기업은 제외", { kind: "check", label: "지원 이력(같은 사업 수혜 여부)" }],
    ["재단 보증 이용 중인 기업 우대", { kind: "ignore" }],
    [
      "고금리(7%) 기업대출(신용대출에 한함)을 이용중인 중·저신용 도내 소상공인(법인 제외)",
      { kind: "check", label: "지원 이력(같은 사업 수혜 여부)" },
    ],
  ])("%s → 종전 그대로", (text, want) => {
    expect(judgeRequirementText(text, { loanUses: [GYEONGGI] }, NOW)).toEqual(want);
  });
});

describe("guarantorsIn — 문장이 말하는 보증 기관 전부", () => {
  it.each<[string, string[]]>([
    ["재단의 보증을 이용 중인 기업", ["지역신용보증재단"]],
    ["경기신용보증재단의 보증", ["경기신용보증재단"]],
    ["경기신보 보증", ["경기신용보증재단"]],
    ["충청남도신용보증재단과 신용보증기금", ["충남신용보증재단", "신용보증기금"]],
    ["신보·기보·재단 보증", ["지역신용보증재단", "신용보증기금", "기술보증기금"]],
    ["기술혁신보증 이용 중", []],
    ["", []],
  ])("%s → %j", (text, want) => {
    expect(guarantorsIn(text)).toEqual(want);
  });

  // 기관 이름을 뺀 나머지를 다시 판정한다 — 뺀 글에는 기관이 남지 않아야 한 번에 끝난다.
  it.each([
    ["경기신보·신용보증기금·기보 보증을 이용 중인 기업", "을 이용 중인 기업"],
    ["충청남도신용보증재단의 보증을 이용하고 있는 기업", "의 보증을 이용하고 있는 기업"],
    ["신용보증재단 보증부 대출을 이용 중인 소상공인", "보증부 대출을 이용 중인 소상공인"],
  ])("withoutGuarantors(%s)", (text, rest) => {
    const out = withoutGuarantors(text);
    expect(guarantorsIn(out)).toEqual([]);
    expect(out.replace(/\s+/g, " ").trim()).toContain(rest);
  });
});
