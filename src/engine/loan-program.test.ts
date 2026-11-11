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
    expect(rulesToConditions({}, "중소기업", "원화전환대출", "중소기업은행")).toEqual([]);
  });
});

describe("상품 대상 글 — 기존 대출·보증을 요구하는 문장", () => {
  // 대상 글은 운영 자료(2026-11-11 읽기 전용 조회)에서 그대로 옮겼다.
  const HANA = "기업대출 이용하는 개인사업자 중 기존 상품의 연장 · 대환이 불가하거나, 연체일수가 90일 이하인 자";
  const CHANGWON =
    "다음 각 호의 요건을 모두 만족하는 소상공인 1. 관내 내 사업자 등록 후 영업 중인 소상공인 2. 경남신용보증재단 보증부대출을 이용 중인 소상공인 3. 다음 각 호의 어느 하나에 해당하는 소상공인(경남신용보증재단 상담일 기준) ⓐ 저신용 : 대표자의 개인신용평점이 839점 이하인 업체 ⓓ 신용하락 : 신용평점 하락으로 대환대출 대상 건의 대출 당시보다 신용평점구간이 1구간 이상 하락한 업체";
  const GYEONGGI_FUND =
    "-재창업자금 : 경기도 소상공인 재창업지원사업을 수료한 자 -대환자금 : 기존 소상공인지원자금(소상공인대환자금, 점포임차보증금자금 제외)과 그 외 일반대출을 이용 중인 도내 소상공인 -e커머스 피해기업자금 : 티몬, 위메프 등에 입점하여 신청일 기준 해당 플랫폼의 판매대금 중 미정산내역을 보유한 소상공인";
  const THRESHOLD =
    "접수일 현재 강원특별자치도내에 사업자 등록을 완료하고 영업중인 중소기업, 소상공인 중 NICE 신용평가점수 865점 이하인 개인사업자 (대환자금의 경우 보증신청 접수일 현재 보증 신청인 명의로 대출일로부터 3개월이 경과한 신용대출을 보유하고 정상적으로 상환 중인 기업)";
  const SEOUL =
    "1) 중저신용자 - 시행규칙 별표1에 해당하는 서울 소재 중소기업 및 소상공인 중 신용평점 839점 이하인 기업 2) 이자비용절감대환 - 시행규칙 별표1에 해당하는 서울 소재 중소기업 및 소상공인 중 10% 이상 고금리 대출중인 채무 보유자 중 대출일로부터 2개월 경과한 기업";
  const fromTarget = (rawText: string): StructuredCondition => ({
    key: "hasExistingLoan", op: "eq", value: true, rawText, machineReadable: true,
  });
  const loanAndGuarantee = (out: StructuredCondition[]) =>
    out.filter((c) => c.key === "hasExistingLoan" || c.key === "guaranteeInUse");

  it("「기업대출 이용하는 개인사업자」 → 기존 대출 조건, 원문 조각을 그대로", () => {
    const out = rulesToConditions({ isCorporation: false }, HANA, "개인사업자 장기분할상환", "주식회사 하나은행");
    expect(loanAndGuarantee(out)).toEqual([fromTarget("기업대출 이용하는 개인사업자")]);
  });

  it("「경남신용보증재단 보증부대출을 이용 중인 소상공인」 → 경남 재단 기존 보증 조건", () => {
    const out = rulesToConditions({ humanCheck: [CHANGWON.slice(0, 80)] }, CHANGWON, "창원시 희망더드림 특별자금", "서민금융진흥원");
    expect(loanAndGuarantee(out)).toEqual([
      {
        key: "guaranteeInUse",
        op: "in",
        value: ["경남신용보증재단"],
        rawText: "경남신용보증재단 보증부대출을 이용 중인 소상공인",
        machineReadable: true,
      },
    ]);
  });

  it("이름이 전환인 상품 — 「외화대출 보유기업」 → 기존 대출 조건", () => {
    const out = rulesToConditions({}, "당행 및 타행 외화대출 보유기업", "원화전환대출", "중소기업은행");
    expect(out).toEqual([fromTarget("당행 및 타행 외화대출 보유기업")]);
  });

  it("이름이 갈아타기인 상품 — 괄호 속 「대출 보유고객」 → 기존 대출 조건", () => {
    const text = "연소득금액 10백만원 이상인 고객(개인사업자 대출이동제 대상 대출 보유고객)";
    expect(rulesToConditions({}, text, "WA사장님신용대출(갈아타기)", "광주은행")).toEqual([
      fromTarget("개인사업자 대출이동제 대상 대출 보유고객"),
    ]);
  });

  it("대환이 여러 쓰임 가운데 한 갈래뿐이면 붙이지 않는다", () => {
    const fund = "경기도 중소기업 육성자금(소상공인 지원_점포임차자금, 경영개선, (재)창업 등)";
    expect(loanAndGuarantee(rulesToConditions({}, GYEONGGI_FUND, fund, "서민금융진흥원"))).toEqual([]);
    expect(loanAndGuarantee(rulesToConditions({}, THRESHOLD, "문턱없애기Ⅱ 협약보증", "서민금융진흥원"))).toEqual([]);
    expect(loanAndGuarantee(rulesToConditions({}, SEOUL, "서울시 중소기업 육성자금 지원(운전_포용금융자금)", ""))).toEqual([]);
    expect(rulesToConditions({}, "일반자금대출(운전,시설,대환 대출)", "사업자신용대출(신한)", "신한저축은행")).toEqual([]);
  });

  it("대환·전환을 말하지 않는 상품은 대상 글이 대출을 요구해도 종전과 같다", () => {
    expect(rulesToConditions({}, "수협은행 부동산 담보대출을 보유한 개인사업자", "더해드림론", "수협은행")).toEqual([]);
  });

  it("연체 대출·대출이 없는 사람을 받는 문장은 요구가 아니다", () => {
    expect(rulesToConditions({}, "당행 연체대출금을 보유 중인 고객은 대환 불가", "사장님대출", "")).toEqual([]);
    expect(rulesToConditions({}, "기존 대출을 보유하지 않은 사업자의 대환 상담", "상담", "")).toEqual([]);
    expect(rulesToConditions({}, "재단 보증을 이용 중이 아닌 기업, 대환 불가", "새출발", "")).toEqual([]);
  });

  it("판정 — 기존 대출 있으면 맞음, 없음이 확인되면 불가, 비면 확인 필요 / 경남 재단 보증이면 맞음", () => {
    const [hana] = loanAndGuarantee(rulesToConditions({}, HANA, "개인사업자 장기분할상환", "주식회사 하나은행"));
    expect(checkCondition(hana, { hasExistingLoan: true }, NOW).verdict).toBe("pass");
    expect(checkCondition(hana, { hasExistingLoan: false }, NOW).verdict).toBe("fail");
    expect(checkCondition(hana, {}, NOW).verdict).toBe("unknown");
    const [changwon] = loanAndGuarantee(rulesToConditions({}, CHANGWON, "창원시 희망더드림 특별자금", ""));
    const gyeongnam: LoanUse = { ...GYEONGGI, name: "경남신용보증재단", sido: "경남" };
    expect(checkCondition(changwon, { loanUses: [gyeongnam] }, NOW)).toMatchObject({
      verdict: "pass",
      note: "경남신용보증재단 보증 이용 중(기업상태표) → 전환보증 대상",
    });
    expect(checkCondition(changwon, { hasExistingLoan: false }, NOW).verdict).toBe("fail");
    expect(checkCondition(changwon, { loanUses: [GYEONGGI] }, NOW).verdict).not.toBe("pass");
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
