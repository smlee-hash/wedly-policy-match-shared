// 프로필 vs 구조화 조건 순수 대조 — AI 없음, 저장소 접근 없음(설계서 §3, 계획 Task 4).
// 「모름」은 절대 통과로 치지 않는다 — 값이 없으면 unknown → 등급은 최고 uncertain 까지만 간다.
import {
  AnnouncementStructure,
  ConditionCheck,
  MatchGrade,
  StructuredCondition,
  gradeOf,
  opFitsKey,
} from "./structure-types";

/** 진단 입력 — 무상지원금 표 칸과 대응(free-subsidy/columns.ts). 빈 값 = 모름(unknown 처리). */
export interface BusinessProfile {
  companyName?: string; bizno?: string;
  industry?: string;          // 주업종(텍스트)
  region?: string;            // 소재지 시도
  foundedDate?: string;       // YYYY-MM-DD
  lastYearRevenueKrw?: number;
  employeeCount?: number;
  companyScale?: string;      // 중소기업|소상공인|중견|예비창업자 …
  taxDelinquent?: boolean;
  hasCert?: boolean; hasPatent?: boolean;
  // ── 자금 조달 지도(2026-09-03) — 상시 상품 판정에만 쓰는 두 칸.
  creditScore?: number;       // 개인 신용점수(NICE/KCB 300~1000). 사람이 입력한다 — 자동 조회하지 않는다
  hasExistingLoan?: boolean;  // 기존 사업자대출 유무. 대환 상품이 「있어야」를 요구한다
}

/* ───────── 법인/개인 판정 ─────────
 * 사업자번호 가운데 두 자리가 법인·개인을 가른다: 81·82·83·84·85·86·87·88 = 법인,
 * 01~79 = 개인(과세·면세·법인 아닌 단체). 89·90 처럼 그 밖은 **모름**으로 둔다 —
 * 지어내어 false 로 채우면 「법인만」 상품이 개인사업자에게 「가능」으로 보인다. */
export function isCorporationByBizno(bizno: string | undefined): boolean | null {
  const digits = (bizno ?? "").replace(/\D/g, "");
  if (digits.length !== 10) return null;
  const middle = Number(digits.slice(3, 5));
  if (!Number.isFinite(middle)) return null;
  if (middle >= 81 && middle <= 88) return true;
  if (middle >= 1 && middle <= 79) return false;
  return null;
}

/* ───────── 지역 표기 사전 ─────────
 * 공고는 「충청북도」, 우리 프로필은 「충북」처럼 같은 곳을 다른 이름으로 적는다.
 * 글자 포함으로만 대조하면 이 둘이 안 걸려 **자격이 되는 회사에 「안 됨」이 나온다**
 * (2026-08-22 수정). 그래서 양쪽을 표준형(줄임말)으로 바꾼 뒤 대조한다.
 * ★「전남광주」처럼 앞 두 글자가 다른 시도와 겹치는 표기가 있어 **긴 별칭부터** 맞춰 본다. */
export const REGION_ALIASES: Record<string, string[]> = {
  서울: ["서울", "서울특별시", "서울시"],
  부산: ["부산", "부산광역시"],
  대구: ["대구", "대구광역시"],
  인천: ["인천", "인천광역시"],
  광주: ["광주", "광주광역시", "전남광주"],
  대전: ["대전", "대전광역시"],
  울산: ["울산", "울산광역시"],
  세종: ["세종", "세종특별자치시"],
  경기: ["경기", "경기도"],
  강원: ["강원", "강원도", "강원특별자치도"],
  충북: ["충북", "충청북도"],
  충남: ["충남", "충청남도"],
  전북: ["전북", "전라북도", "전북특별자치도"],
  전남: ["전남", "전라남도"],
  경북: ["경북", "경상북도"],
  경남: ["경남", "경상남도"],
  제주: ["제주", "제주도", "제주특별자치도"],
};

/** 전국 대상 공고 표기 — 지역 조건을 따지지 않는다. */
const NATIONWIDE = "전국";

/** 별칭 → 표준형. 긴 것부터 본다(「전남광주」가 「전남」에 먼저 걸리면 광주가 전남이 된다). */
const ALIAS_ENTRIES: Array<[string, string]> = Object.entries(REGION_ALIASES)
  .flatMap(([canon, list]) => list.map((a) => [a.replace(/\s/g, ""), canon] as [string, string]))
  .sort((a, b) => b[0].length - a[0].length);

/** 「충청북도 청주시」·「충북」 → "충북". 사전에 없는 표기(수도권·청주시 등)는 null. */
export function canonicalRegion(value: string | undefined | null): string | null {
  const t = (value ?? "").replace(/\s/g, "");
  if (!t) return null;
  for (const [alias, canon] of ALIAS_ENTRIES) if (t.startsWith(alias)) return canon;
  return null;
}

/** 글자 안에 든 표준 시도를 **전부** 찾는다 — 「대구경북」처럼 붙여 쓴 복수 시도를
 *  canonicalRegion(startsWith)이 앞쪽만 돌려주고 뒤쪽을 삼키던 것을 막는다(적대 리뷰 치명1). */
export function sidosInText(value: string | undefined | null): string[] {
  const t = (value ?? "").replace(/\s/g, "");
  if (!t) return [];
  const found = new Set<string>();
  for (const [alias, canon] of ALIAS_ENTRIES) if (t.includes(alias)) found.add(canon);
  return [...found];
}

/** 소재지를 「전국」으로 둔 프로필 — 어디인지 안 정한 것이라 지역 조건은 판정하지 않는다. */
function profileRegionIsNationwide(region: string): boolean {
  return region.replace(/\s/g, "").startsWith(NATIONWIDE);
}

export function businessAgeYears(foundedDate: string | undefined, now: Date): number | null {
  if (!foundedDate) return null;
  const t = Date.parse(foundedDate);
  if (!Number.isFinite(t)) return null;
  return (now.getTime() - t) / (365.25 * 86_400_000);
}

export function checkCondition(c: StructuredCondition, p: BusinessProfile, now: Date): ConditionCheck {
  if (!c.machineReadable) return { condition: c, verdict: "unknown", note: "기계로 판정할 수 없는 조건 — 원문 확인" };
  // 「3년 이하」인데 op 가 gte 로 오면 대조가 거꾸로 돈다 — 읽기 단계에서 이미 걸러지지만 여기서도 막는다.
  if (!opFitsKey(c.key, c.op)) {
    return { condition: c, verdict: "unknown", note: "비교 방식이 조건과 맞지 않음 — 원문 확인" };
  }
  const unknown = (why: string): ConditionCheck => ({ condition: c, verdict: "unknown", note: why });
  const pass = (): ConditionCheck => ({ condition: c, verdict: "pass", note: "" });
  const fail = (why: string): ConditionCheck => ({ condition: c, verdict: "fail", note: why });
  switch (c.key) {
    case "region": {
      if (!p.region) return unknown("소재지 미입력");
      const list = c.value as string[];
      if (list.some((r) => r.includes(NATIONWIDE))) return pass();
      if (profileRegionIsNationwide(p.region)) return unknown("소재지가 「전국」 — 지역 조건은 원문 확인");
      const mine = canonicalRegion(p.region);
      // ★fail 은 「확신 있을 때만」 낸다(적대 리뷰 2026-08-30 치명1 — 추천이 fail 을 목록
      // 제외로 격상한 뒤로, 확신 없는 fail 은 자격 있는 회사에게서 공고를 영영 지운다).
      //  · 항목에서 표준 시도가 하나라도 읽히면(「부산」·「대구경북」) 사전 대조 — 미일치는 확신 fail.
      //  · 시도를 못 읽는 표기(「청주시」·「수도권」)는 글자 포함으로만 대조하고,
      //    미일치여도 fail 이 아니라 「확인 필요」로 남긴다(도시·광역권이 내 시도를 품는지 모른다).
      let sawDictionary = false;
      for (const r of list) {
        const theirs = sidosInText(r);
        if (theirs.length > 0 && mine) {
          sawDictionary = true;
          if (theirs.includes(mine)) return pass();
        } else if (p.region.includes(r) || r.includes(p.region)) {
          return pass();
        }
      }
      return sawDictionary
        ? fail(`대상 지역: ${list.join("·")}`)
        : unknown(`지역 표기를 확정하지 못해 원문 확인 필요 — 대상 지역: ${list.join("·")}`);
    }
    case "industry": {
      if (!p.industry) return unknown("업종 미입력");
      const list = c.value as string[];
      // 업종은 같은 일을 다른 이름으로 적는다(「소프트웨어 개발업」 vs 「정보통신업」).
      // 글자가 안 겹친다고 「안 됨」을 내면 자격 있는 회사를 떨어뜨린다 — 확인 필요로 둔다.
      return list.some((k) => p.industry!.includes(k))
        ? pass()
        : unknown(`업종 표기가 달라 확인 필요 — 대상 업종: ${list.join("·")}`);
    }
    case "businessAgeMaxYears": {
      const age = businessAgeYears(p.foundedDate, now);
      if (age == null) return unknown("설립일 미입력");
      if (age < 0) return unknown("설립일 확인 — 미래 날짜로 적혀 있음");
      return age <= (c.value as number) ? pass() : fail(`업력 ${c.value}년 이하만`);
    }
    case "businessAgeMinYears": {
      const age = businessAgeYears(p.foundedDate, now);
      if (age == null) return unknown("설립일 미입력");
      if (age < 0) return unknown("설립일 확인 — 미래 날짜로 적혀 있음");
      return age >= (c.value as number) ? pass() : fail(`업력 ${c.value}년 이상만`);
    }
    case "revenueMaxKrw":
      if (p.lastYearRevenueKrw == null) return unknown("연매출 미입력");
      return p.lastYearRevenueKrw <= (c.value as number) ? pass() : fail("매출 상한 초과");
    case "revenueMinKrw":
      if (p.lastYearRevenueKrw == null) return unknown("연매출 미입력");
      return p.lastYearRevenueKrw >= (c.value as number) ? pass() : fail("매출 하한 미달");
    case "employeeMax":
      if (p.employeeCount == null) return unknown("직원 수 미입력");
      return p.employeeCount <= (c.value as number) ? pass() : fail(`직원 ${c.value}명 이하만`);
    case "employeeMin":
      if (p.employeeCount == null) return unknown("직원 수 미입력");
      return p.employeeCount >= (c.value as number) ? pass() : fail(`직원 ${c.value}명 이상만`);
    case "companyScale": {
      if (!p.companyScale) return unknown("기업 규모 미입력");
      const list = c.value as string[];
      return list.some((s) => p.companyScale!.includes(s) || s.includes(p.companyScale!)) ? pass() : fail(`대상: ${list.join("·")}`);
    }
    case "noTaxDelinquency":
      if (p.taxDelinquent == null) return unknown("체납 여부 미입력");
      return p.taxDelinquent ? fail("세금 체납 시 신청 불가") : pass();
    // 우리 칸은 「있다/없다」만 안다 — 공고가 요구하는 종류(벤처·이노비즈·직무발명 …)까지는 모른다.
    // 그래서 보유는 통과로 올리지 않고 확인 필요로 둔다. 미보유는 어떤 종류든 안 되므로 그대로 불가.
    case "certRequired":
      if (p.hasCert == null) return unknown("인증 보유 미입력");
      return p.hasCert ? unknown("공고가 요구하는 종류와 맞는지 확인") : fail("요구 인증 미보유");
    case "patentRequired":
      if (p.hasPatent == null) return unknown("특허 보유 미입력");
      return p.hasPatent ? unknown("공고가 요구하는 종류와 맞는지 확인") : fail("특허 미보유");
    // ── 자금 조달 지도(2026-09-03) — 상시 상품 조건 4종.
    case "creditScoreMin": {
      if (p.creditScore == null) return unknown("신용점수 미입력");
      return p.creditScore >= (c.value as number) ? pass() : fail(`신용점수 ${c.value} 이상 필요`);
    }
    case "creditScoreMax": {
      if (p.creditScore == null) return unknown("신용점수 미입력");
      return p.creditScore <= (c.value as number) ? pass() : fail(`신용점수 ${c.value} 이하 대상`);
    }
    case "hasExistingLoan": {
      if (p.hasExistingLoan == null) return unknown("기존 대출 유무 미입력");
      return p.hasExistingLoan === (c.value as boolean)
        ? pass()
        : fail(c.value ? "기존 대출이 있어야 함(대환)" : "기존 대출 없는 사업자만");
    }
    case "isCorporation": {
      const mine = isCorporationByBizno(p.bizno);
      if (mine === null) return unknown("사업자번호로 법인 여부를 알 수 없음");
      return mine === (c.value as boolean) ? pass() : fail(c.value ? "법인만" : "개인사업자만");
    }
    default:
      return unknown("사전에 없는 조건");
  }
}

export interface MatchResult { grade: MatchGrade; checks: ConditionCheck[]; humanCheck: string[] }

export function matchAnnouncement(s: AnnouncementStructure, p: BusinessProfile, now = new Date()): MatchResult {
  const checks = s.conditions.map((c) => checkCondition(c, p, now));
  // humanCheck 는 등급에 넣지 않는다(칩으로 개수만 보인다) — 결과에는 그대로 실어 보낸다.
  return { grade: gradeOf(checks), checks, humanCheck: s.humanCheck };
}

/* ───────── 저장된 구조화 JSON → 대조 가능한 모양 (통로 두 곳이 같은 해석을 쓰게) ─────────
 * 저장된 값은 AI 산출물이라 모양이 어긋날 수 있다. 어긋난 조건을 **조용히 버리면**
 * 「못 받는 공고」가 「받을 수 있음」으로 둔갑한다 — 그래서 못 읽은 조건은 반드시
 * humanCheck(사람 확인 필요)로 옮겨 등급이 애매 아래로 못 내려가게 한다. */

export const UNREADABLE_STRUCTURE_NOTE = "구조화 결과를 읽지 못했습니다 — 공고 원문을 직접 확인하세요";

const OPS: readonly string[] = ["in", "lte", "gte", "eq"];

/** key 와 value 모양이 안 맞으면 기계대조 금지(structurize 의 저장 규칙과 같은 판단). */
function valueFitsKey(key: string, value: unknown): boolean {
  switch (key) {
    case "region":
    case "industry":
    case "companyScale":
      return Array.isArray(value) && value.every((v) => typeof v === "string");
    case "businessAgeMaxYears":
    case "businessAgeMinYears":
    case "revenueMaxKrw":
    case "revenueMinKrw":
    case "employeeMax":
    case "employeeMin":
    case "creditScoreMin":
    case "creditScoreMax":
      return typeof value === "number" && Number.isFinite(value);
    case "noTaxDelinquency":
    case "certRequired":
    case "patentRequired":
    case "hasExistingLoan":
    case "isCorporation":
      return typeof value === "boolean";
    default:
      return false; // other 를 포함한 사전 밖 조건
  }
}

function readCondition(raw: unknown): StructuredCondition | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const key = typeof o.key === "string" ? o.key : "";
  const op = typeof o.op === "string" && OPS.includes(o.op) ? o.op : "";
  const rawText = typeof o.rawText === "string" ? o.rawText.trim() : "";
  if (!key || !op || !rawText) return null;
  const value = o.value;
  const usable =
    Array.isArray(value) || typeof value === "number" || typeof value === "boolean" ? value : null;
  if (usable === null) return null;
  return {
    key: key as StructuredCondition["key"],
    op: op as StructuredCondition["op"],
    value: usable as StructuredCondition["value"],
    rawText,
    // 값 모양이나 비교 방식이 어긋나면 대조하지 않는다 — 대조하면 판정이 아니라 오류·뒤집힘이 된다.
    machineReadable: o.machineReadable === true && valueFitsKey(key, usable) && opFitsKey(key, op),
  };
}

export function readStoredStructure(raw: unknown): AnnouncementStructure {
  const s: AnnouncementStructure = {
    benefitSummary: "",
    supportAmountText: "",
    aiSummary: { purpose: "", target: "", scale: "", scaleItems: [] },
    conditions: [],
    humanCheck: [],
    documents: [],
    verified: false,
  };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    s.humanCheck = [UNREADABLE_STRUCTURE_NOTE];
    return s;
  }
  const o = raw as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  s.benefitSummary = str(o.benefitSummary);
  s.supportAmountText = str(o.supportAmountText);
  const ai = o.aiSummary && typeof o.aiSummary === "object" ? (o.aiSummary as Record<string, unknown>) : {};
  s.aiSummary = {
    purpose: str(ai.purpose),
    target: str(ai.target),
    scale: str(ai.scale),
    scaleItems: Array.isArray(ai.scaleItems)
      ? ai.scaleItems.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean)
      : [],
  };
  s.documents = Array.isArray(o.documents) ? o.documents.filter((d): d is string => typeof d === "string") : [];
  s.verified = o.verified === true;

  const human: string[] = Array.isArray(o.humanCheck)
    ? o.humanCheck.filter((h): h is string => typeof h === "string" && h.trim() !== "")
    : [];
  if (!Array.isArray(o.conditions)) {
    human.push(UNREADABLE_STRUCTURE_NOTE);
  } else {
    for (const c of o.conditions) {
      const parsed = readCondition(c);
      if (parsed) {
        s.conditions.push(parsed);
        // 비교 방식이 뒤집힌 조건은 「대조 안 함」에 그치지 않고 사람 확인 목록에도 올린다
        // — 체크리스트의 물음표만으로는 등급이 「가능」으로 남을 수 있다.
        if (!opFitsKey(parsed.key, parsed.op)) human.push(parsed.rawText);
        continue;
      }
      const text = c && typeof c === "object" ? (c as { rawText?: unknown }).rawText : undefined;
      human.push(typeof text === "string" && text.trim() ? text.trim() : UNREADABLE_STRUCTURE_NOTE);
    }
  }
  s.humanCheck = [...new Set(human)];
  return s;
}

/* ───────── 바깥에서 들어온 값 → BusinessProfile (통로 두 곳이 같은 해석을 쓰게) ─────────
 * 판정 안전 원칙: 모르는 값은 undefined 로 남긴다. 억지로 0·false 로 채우면
 * 「모름」이 「충족」으로 둔갑해 고객에게 틀린 안내가 나간다. */

function textOf(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t || undefined;
}

/** 숫자 또는 숫자 문자열("1,000,000")만 받는다. 음수·NaN·글자는 모름. */
function numberOf(v: unknown): number | undefined {
  const n =
    typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v.replace(/[,\s]/g, "")) : Number.NaN;
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/** 참/거짓만 받는다 — "예"·"아니오" 같은 표기 해석은 값을 만드는 쪽(불러오기)에서 끝낸다. */
function boolOf(v: unknown): boolean | undefined {
  return typeof v === "boolean" ? v : undefined;
}

export function parseBusinessProfile(raw: unknown): BusinessProfile {
  if (!raw || typeof raw !== "object") return {};
  const o = raw as Record<string, unknown>;
  const p: BusinessProfile = {};
  const setText = (k: "companyName" | "bizno" | "industry" | "region" | "foundedDate" | "companyScale") => {
    const v = textOf(o[k]);
    if (v !== undefined) p[k] = v;
  };
  setText("companyName");
  setText("bizno");
  setText("industry");
  setText("region");
  setText("foundedDate");
  setText("companyScale");
  const revenue = numberOf(o.lastYearRevenueKrw);
  if (revenue !== undefined) p.lastYearRevenueKrw = revenue;
  const employees = numberOf(o.employeeCount);
  if (employees !== undefined) p.employeeCount = employees;
  const tax = boolOf(o.taxDelinquent);
  if (tax !== undefined) p.taxDelinquent = tax;
  const cert = boolOf(o.hasCert);
  if (cert !== undefined) p.hasCert = cert;
  const patent = boolOf(o.hasPatent);
  if (patent !== undefined) p.hasPatent = patent;
  // ── 자금 조달 지도(2026-09-03) — 신용점수·기존 대출.
  // 신용점수는 300~1000 밖이면 잘못 들어온 값이라 버린다(등급 850 을 점수로 적는 실수 등).
  const credit = numberOf(o.creditScore);
  if (credit !== undefined && credit >= 300 && credit <= 1000) p.creditScore = credit;
  // 화면 라디오가 "yes"/"no" 로 보내는 자리가 있어 두 표기만 추가로 읽는다.
  const loan =
    boolOf(o.hasExistingLoan) ??
    (o.hasExistingLoan === "yes" ? true : o.hasExistingLoan === "no" ? false : undefined);
  if (loan !== undefined) p.hasExistingLoan = loan;
  return p;
}
