import { describe, expect, it } from "vitest";
import { rulesToConditions } from "../funding/products/rules-to-conditions";
import * as engine from "./index";
import { loanProgramConditions, loanProgramOf } from "./loan-program";
import { checkCondition, conditionPassIsFitGrade, type BusinessProfile, type LoanUse } from "./match-engine";
import { withRegionConditions } from "./region-augment";
import type { AnnouncementStructure, StructuredCondition } from "./structure-types";

// NO.714 — 상품 이름·공고 제목으로 전환보증(guaranteeInUse)·대환(hasExistingLoan) 조건을 붙인다.
// 제목은 운영 자료(2026-11-10 읽기 전용 조회)에서 그대로 옮겼다.
const NOW = new Date("2026-11-11T00:00:00.000Z");

const st = (conditions: StructuredCondition[]): AnnouncementStructure => ({
  conditions,
  humanCheck: [],
  aiSummary: { scale: "", target: "", purpose: "", scaleItems: [] },
  benefitSummary: "",
  supportAmountText: "",
  documents: [],
  verified: false,
});

const GYEONGGI: LoanUse = {
  agency: "지역신용보증재단", name: "경기신용보증재단", sido: "경기", status: "in-use", balanceManwon: 700, source: "기업상태표",
};
const CHUNGNAM: LoanUse = { ...GYEONGGI, name: "충남신용보증재단", sido: "충남" };
const KODIT: LoanUse = { agency: "신용보증기금", name: "신용보증기금", status: "in-use", balanceManwon: 10000, source: "기업상태표" };

const REFINANCE: StructuredCondition = {
  key: "hasExistingLoan", op: "eq", value: true, rawText: "기존 대출 이용 중(대환)", machineReadable: true,
};
const conversion = (g: string): StructuredCondition => ({
  key: "guaranteeInUse", op: "in", value: [g], rawText: `${g} 보증 이용 중(전환보증)`, machineReadable: true,
});

describe("loanProgramOf — 이름으로 전환보증·대환 알아보기", () => {
  it.each([
    ["소기업·소상공인 전환보증", "중소벤처기업부", "지역신용보증재단"],
    ["소기업 소상공인 전환보증(대환자금)", "서민금융진흥원", "지역신용보증재단"],
    ["보증통합 전환대출 안내", "충남신용보증재단", "충남신용보증재단"],
    ["(중앙회) 소기업·소상공인 전환보증", "인천신용보증재단", "인천신용보증재단"],
    ["경기신용보증재단 보증전환 특례보증", "경기도", "경기신용보증재단"],
    ["충청남도신용보증재단 보증 통합 안내", "", "충남신용보증재단"],
    ["전환보증 안내", "신용보증기금", "신용보증기금"],
    ["기보 전환 보증", "기술보증기금", "기술보증기금"],
    ["경기신보 전환보증 안내", "", "경기신용보증재단"],
    ["신보 전환보증", "", "신용보증기금"],
    ["기술혁신보증 전환보증", "", "지역신용보증재단"],
  ])("%s(%s) → 전환보증, 원하는 보증 %s", (title, agency, guarantor) => {
    expect(loanProgramOf(title, agency)).toEqual({ kind: "conversion", guarantor });
  });

  it.each([
    ["대환대출", "소상공인시장진흥공단"],
    ["[제주] 소상공인 저금리 대환대출 특별보증 한시적 이차보전금 지원 공고", "제주특별자치도"],
    ["사잇돌Ⅱ대출_대환형", "서민금융진흥원"],
    ["원큐자동차담보대출(대환)", "하나캐피탈㈜"],
    ["장비대출 중고건기상용 대환운영", "㈜아이엠캐피탈"],
    ["ONE신용대출 자영업자대출 -소상공인 고금리 대환 신용대출", "부산은행"],
    ["코로나피해 소상공인 분할상환 특례보증(대환보증) 신청 안내", "서울신용보증재단"],
    ["햇살론 차환대출", ""],
    ["안전망 전환대출", "서민금융진흥원"],
    ["햇살론 전환대출", "광주신용보증재단"],
  ])("%s(%s) → 대환", (title, agency) => {
    expect(loanProgramOf(title, agency)).toEqual({ kind: "refinance" });
  });

  it.each([
    ["전통시장 주차환경개선 지원", "중소벤처기업부"],
    ["노후 자동차환경 개선 지원", "환경부"],
    ["녹색 공정전환 보증", "신용보증기금"],
    ["ESG녹색기업 특례보증 (저탄소 공정 전환 대상 기업)", "서민금융진흥원"],
    ["원화전환대출", "중소기업은행"],
    ["AI대전환도약대출", "중소기업은행"],
    ["충북형 오프라인 소상공인 디지털 전환’ 특별보증", "서민금융진흥원"],
    ["사업전환자금", "중소벤처기업진흥공단"],
    ["사업전환 보증 지원", "신용보증기금"],
    ["업종전환 보증", ""],
    ["2026 업종전환 지원사업", "부산경제진흥원"],
    ["참가기업 대환영 창업 박람회", "서울시"],
    ["일반 운전자금", "신용보증기금"],
    ["", ""],
  ])("%s(%s) → 붙이지 않는다", (title, agency) => {
    expect(loanProgramOf(title, agency)).toBeNull();
  });
});

describe("loanProgramConditions — 붙일 조건", () => {
  it("전환보증은 기존 보증 조건 하나", () => {
    expect(loanProgramConditions("보증통합 전환대출 안내", "충남신용보증재단", [])).toEqual([conversion("충남신용보증재단")]);
    expect(loanProgramConditions("소기업·소상공인 전환보증", "중소벤처기업부", [])).toEqual([conversion("지역신용보증재단")]);
  });

  it("대환은 기존 대출 조건 하나", () => {
    expect(loanProgramConditions("대환대출", "소상공인시장진흥공단", [])).toEqual([REFINANCE]);
  });

  it("같은 칸이 이미 있으면 붙이지 않는다", () => {
    const own: StructuredCondition = { ...REFINANCE, value: false, rawText: "기존 대출 없어야 함" };
    expect(loanProgramConditions("대환대출", "", [own])).toEqual([]);
    expect(loanProgramConditions("소기업·소상공인 전환보증", "", [conversion("경기신용보증재단")])).toEqual([]);
  });

  it("해당 없는 이름이면 빈 목록", () => {
    expect(loanProgramConditions("전통시장 주차환경개선 지원", "중소벤처기업부", [])).toEqual([]);
  });
});

describe("공고 — withRegionConditions 가 제목·기관으로 붙인다", () => {
  it("전환보증 공고에 「보탠」 기존 보증 조건이 붙는다", () => {
    const out = withRegionConditions(st([]), { title: "보증통합 전환대출 안내", agency: "충남신용보증재단", region: "충남" });
    const added = out.conditions.filter((c) => c.key === "guaranteeInUse");
    expect(added).toEqual([{ ...conversion("충남신용보증재단"), origin: "augmented" }]);
  });

  it("대환 공고에 기존 대출 조건이 붙고, 저장 구조에 이미 있으면 그대로 둔다", () => {
    const fresh = withRegionConditions(st([]), { title: "대환대출", agency: "소상공인시장진흥공단", region: "" });
    expect(fresh.conditions.filter((c) => c.key === "hasExistingLoan")).toEqual([{ ...REFINANCE, origin: "augmented" }]);
    const own: StructuredCondition = { ...REFINANCE, rawText: "고금리 대출 보유" };
    const kept = withRegionConditions(st([own]), { title: "대환대출", agency: "소상공인시장진흥공단", region: "" });
    expect(kept.conditions.filter((c) => c.key === "hasExistingLoan")).toEqual([own]);
  });

  it("오탐 제목에는 붙지 않고 받은 구조를 바꾸지 않는다", () => {
    const before = st([]);
    const out = withRegionConditions(before, { title: "전통시장 주차환경개선 지원", agency: "중소벤처기업부", region: "" });
    expect(out.conditions.some((c) => c.key === "hasExistingLoan" || c.key === "guaranteeInUse")).toBe(false);
    expect(before.conditions).toEqual([]);
  });
});

describe("상품 — rulesToConditions 가 이름·기관으로 붙인다", () => {
  it("대환 상품에 기존 대출 조건", () => {
    const out = rulesToConditions({ scale: ["소상공인"] }, "중∙저신용 소상공인", "대환대출", "소상공인시장진흥공단");
    expect(out.filter((c) => c.key === "hasExistingLoan")).toEqual([REFINANCE]);
    expect(out[0].key).toBe("companyScale");
  });

  it("전환보증 상품에 기존 보증 조건(대환보다 먼저)", () => {
    const out = rulesToConditions({}, "재단의 보증을 이용 중인 기업", "소기업 소상공인 전환보증(대환자금)", "서민금융진흥원");
    expect(out).toEqual([conversion("지역신용보증재단")]);
  });

  it("규칙이 이미 기존 대출을 정했으면 그 규칙만 남는다", () => {
    const out = rulesToConditions({ hasExistingLoan: false }, "기존 대출이 없는 사업자", "대환대출", "");
    expect(out.filter((c) => c.key === "hasExistingLoan").map((c) => c.value)).toEqual([false]);
  });

  it("이름을 안 주거나 해당 없는 이름이면 종전과 같다", () => {
    expect(rulesToConditions({}, "아무나")).toEqual([]);
    expect(rulesToConditions({}, "외화대출 보유기업", "원화전환대출", "중소기업은행")).toEqual([]);
  });
});

describe("받아들임 — 붙인 조건을 고객 기록으로 판정", () => {
  const judge = (c: StructuredCondition, p: BusinessProfile) => checkCondition(c, p, NOW);

  it("지역 재단 보증을 쓰는 고객 → 전환보증 「가능」, 다른 시도 재단 전용이면 지역 확인", () => {
    const [anyFoundation] = loanProgramConditions("소기업·소상공인 전환보증", "중소벤처기업부", []);
    const p = { loanUses: [GYEONGGI] };
    const r = judge(anyFoundation, p);
    expect(r).toMatchObject({ verdict: "pass", note: "경기신용보증재단 보증 이용 중(기업상태표) → 전환보증 대상" });
    expect(conditionPassIsFitGrade(r, p)).toBe(true);
    const [chungnamOnly] = loanProgramConditions("보증통합 전환대출 안내", "충남신용보증재단", []);
    expect(judge(chungnamOnly, p)).toMatchObject({ verdict: "unknown", note: "보증 재단 지역 확인" });
    expect(judge(chungnamOnly, { loanUses: [CHUNGNAM] }).verdict).toBe("pass");
  });

  it("「신보 1억」만 있는 고객 → 전환보증 불가(기록 완전)·확인 필요(기록 불완전), 「가능」은 없다", () => {
    const [anyFoundation] = loanProgramConditions("소기업·소상공인 전환보증", "중소벤처기업부", []);
    expect(judge(anyFoundation, { hasExistingLoan: true, loanUses: [KODIT], loanUsesComplete: true }).verdict).toBe("fail");
    expect(judge(anyFoundation, { hasExistingLoan: true, loanUses: [KODIT] }).verdict).toBe("unknown");
  });

  it("대환 상품 — 대출 있으면 맞음, 없음이 확인되면 불가, 비면 확인 필요", () => {
    const [refinance] = rulesToConditions({}, "", "대환대출", "소상공인시장진흥공단");
    expect(judge(refinance, { hasExistingLoan: true }).verdict).toBe("pass");
    expect(judge(refinance, { hasExistingLoan: false }).verdict).toBe("fail");
    expect(judge(refinance, {})).toMatchObject({ verdict: "unknown", note: "기존 대출 유무 미입력" });
  });
});

describe("내보내기", () => {
  it("engine 묶음에서 두 함수를 꺼낼 수 있다", () => {
    expect(typeof engine.loanProgramOf).toBe("function");
    expect(typeof engine.loanProgramConditions).toBe("function");
  });
});
