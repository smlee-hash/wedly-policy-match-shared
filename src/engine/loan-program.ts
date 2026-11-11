/**
 * 상품 이름·공고 제목이 말하는 **전환보증·대환**을 기존 보증(guaranteeInUse)·기존 대출(hasExistingLoan) 조건으로 옮긴다(NO.714).
 * 이름만 그렇게 붙고 조건이 비어 있으면 대출·보증이 없는 고객에게도 「맞음」이 떴다.
 *
 * 갈래는 **제목**으로 알아본다. 기관은 전환보증이 원하는 보증 기관을 고를 때만 본다.
 * 상품은 제목이 갈래를 말하지 않아도 대상 글이 기존 대출·보증을 **반드시 요구하면**(「기업대출 이용하는 개인사업자」)
 * 그 문장을 조건으로 옮긴다 — 이름·대상 글에 대환·전환·차환·갈아타기가 든 상품만 본다.
 * region-augment(공고)·rules-to-conditions(상품)가 이 파일을 부르므로 그 둘이나 rule-extract 를 부르지 않는다(순환).
 */
import { REGION_ALIASES, canonicalRegion } from "./match-engine";
import type { StructuredCondition } from "./structure-types";

export type LoanProgram = { kind: "conversion"; guarantor: string } | { kind: "refinance" };

// 보증을 갈아타는 말. 전환보증은 대환보다 먼저 본다 — 「전환보증(대환자금)」은 기존 보증을 요구하는 상품이다.
const CONVERSION_TITLE: RegExp[] = [
  /(?:^|[^가-힣])전환\s*보증/, // 「공정전환 보증」·「사업전환 보증」·「업종전환 보증」처럼 앞에 한글이 붙은 전환 제외
  /보증\s*전환/,
  /보증\s*통합/,
];

// 빚을 갈아타는 말.
const REFINANCE_TITLE: RegExp[] = [
  /대환(?![영경])/, // 「대환영」 박람회 제외
  /차환(?![영경])/, // 「주차환경」·「자동차환경」 제외
  /(?:^|[^가-힣])전환\s*대출/, // 「원화전환대출」 제외. 「안전망 전환대출」·「햇살론 전환대출」은 대환
];

// 지역 재단 이름. 별칭은 긴 것부터 이어야 「충청남도」가 「충남」에 잘리지 않는다.
const REGION_ALIAS_PATTERN = Object.values(REGION_ALIASES)
  .flat()
  .sort((a, b) => b.length - a.length)
  .join("|");
const REGIONAL_FOUNDATION = new RegExp(`(${REGION_ALIAS_PATTERN})\\s*(?:신용보증재단|신보)`);
const KODIT_SHORT = /(?:^|[^가-힣])신보(?!증)/; // 「기술혁신보증」의 「신보」 제외
const KIBO_SHORT = /(?:^|[^가-힣])기보(?!증)/;
// 문장 속 기관을 전부 찾고(guarantorsIn)·지울(withoutGuarantors) 전역 판.
const REGIONAL_FOUNDATION_ALL = new RegExp(REGIONAL_FOUNDATION.source, "g");
const KODIT_SHORT_ALL = new RegExp(KODIT_SHORT.source, "g");
const KIBO_SHORT_ALL = new RegExp(KIBO_SHORT.source, "g");
const FOUNDATION_WORD = /(?:신용\s*)?(?:보증\s*)?재단/g;

/** 글에 든 지역 재단 이름 → 「경기신용보증재단」. 없으면 null. */
function regionalFoundationIn(text: string): string | null {
  const m = REGIONAL_FOUNDATION.exec(text);
  const sido = m && canonicalRegion(m[1]);
  return sido ? `${sido}신용보증재단` : null;
}

/** 전환보증이 원하는 보증 기관 — 제목의 지역 재단 → 기관의 지역 재단 → 신보 → 기보 → 재단 아무 곳. */
function guarantorOf(title: string, agency: string): string {
  const named = regionalFoundationIn(title) ?? regionalFoundationIn(agency);
  if (named) return named;
  const text = `${title} ${agency}`;
  if (text.includes("신용보증기금") || KODIT_SHORT.test(text)) return "신용보증기금";
  if (text.includes("기술보증기금") || KIBO_SHORT.test(text)) return "기술보증기금";
  return "지역신용보증재단";
}

/** 문장이 말하는 보증 기관 전부 — 「신보·재단 보증」이면 둘 다. 없으면 빈 목록. */
export function guarantorsIn(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(REGIONAL_FOUNDATION_ALL)) {
    const sido = canonicalRegion(m[1]);
    if (sido) found.add(`${sido}신용보증재단`);
  }
  // 시도가 붙은 재단을 지운 나머지의 「재단」은 어느 시도인지 모르는 재단이다.
  const rest = text.replace(REGIONAL_FOUNDATION_ALL, " ");
  if (/재단/.test(rest)) found.add("지역신용보증재단");
  if (rest.includes("신용보증기금") || KODIT_SHORT.test(rest)) found.add("신용보증기금");
  if (rest.includes("기술보증기금") || KIBO_SHORT.test(rest)) found.add("기술보증기금");
  return [...found];
}

/** guarantorsIn 이 읽는 기관 이름을 모두 공백으로 바꾼 글 — 다시 guarantorsIn 에 넣으면 빈 목록이다. */
export function withoutGuarantors(text: string): string {
  return text
    .replace(REGIONAL_FOUNDATION_ALL, " ")
    .replace(/신용보증기금/g, " ")
    .replace(/기술보증기금/g, " ")
    .replace(FOUNDATION_WORD, " ")
    .replace(KODIT_SHORT_ALL, " ")
    .replace(KIBO_SHORT_ALL, " ");
}

/** 제목이 전환보증·대환을 말하면 그 갈래. 아니면 null. */
export function loanProgramOf(title: string, agency: string): LoanProgram | null {
  if (CONVERSION_TITLE.some((re) => re.test(title))) return { kind: "conversion", guarantor: guarantorOf(title, agency) };
  if (REFINANCE_TITLE.some((re) => re.test(title))) return { kind: "refinance" };
  return null;
}

/**
 * 기존 보증을 이용 중인 기업만 받는 문장(전환보증). 새로 보증을 받는 문장(「보증서 발급이 가능한」)과
 * 보증을 쓰지 않는 기업을 받는 문장(「이용하고 있지 않은」·「이용 중이 아닌」)은 아니다.
 */
export const GUARANTEE_IN_USE =
  /(?:재단|신보|기보|기금)\s*(?:의\s*)?(?:신용\s*)?보증\s*(?:서|부\s*대출)?\s*(?:을|를)?\s*(?:이용|사용|보유)\s*(?:중(?!\s*이\s*아[니닌]|\s*이지\s*않)|하고\s*있(?!\s*지\s*않))/;
// 대출을 이용·보유 중인 사람만 받는 문장. 연체 대출을 가진 사람(「연체대출금을 보유 중인」)·
// 대출이 없는 사람(「보유하지 않은」·「보유기업이 아닌」)을 받는 문장은 아니다.
const LOAN_IN_USE =
  /(?<!연체)대출(?:금)?\s*(?:을|를)?\s*(?:이용\s*(?:하는|중인|하고\s*있는)|보유\s*(?:한|하는|중인|하고\s*있는|기업|고객|업체))(?!\s*(?:이|가)\s*아[니닌])/g;
// 빚·보증을 갈아타는 상품이라는 말 — 상품 이름이나 대상 글에 있어야 대상 글의 요구 문장을 읽는다.
// 같은 말이 요구 문장 바로 앞에 있으면 「-대환자금 : … 이용 중인」처럼 여러 쓰임 가운데 한 갈래라서 읽지 않는다.
const LOAN_PROGRAM_WORD = /대환(?![영경])|차환(?![영경])|전환|갈아\s*타/;
const TRACK_LOOKBACK = 60;
const CLAUSE_LOOKBACK = 30;
const CLAUSE_STOP = /[.,:()-]/;
const CLAUSE_TAIL = /^[^\s,.()]*(?:\s+[^\s,.()]+)?/;
const CLAUSE_MAX = 40;

/** 요구 문장이 시작하는 자리 — 바로 앞 문장 부호 다음, 없으면 30자 안의 첫 낱말. */
function clauseStart(text: string, at: number): number {
  const from = Math.max(0, at - CLAUSE_LOOKBACK);
  const before = text.slice(from, at);
  for (let i = before.length - 1; i >= 0; i--) if (CLAUSE_STOP.test(before[i])) return from + i + 1;
  if (from === 0) return 0;
  const space = before.search(/\s/);
  return space >= 0 ? from + space + 1 : at;
}

/** 화면 근거로 보일 원문 조각 — 「경남신용보증재단 보증부대출을 이용 중인 소상공인」. */
function clauseText(text: string, start: number, end: number): string {
  const tail = CLAUSE_TAIL.exec(text.slice(end))?.[0] ?? "";
  return text.slice(start, end + tail.length).replace(/\s+/g, " ").trim().slice(0, CLAUSE_MAX);
}

function isTrack(text: string, at: number): boolean {
  return LOAN_PROGRAM_WORD.test(text.slice(Math.max(0, at - TRACK_LOOKBACK), at));
}

/** 대상 글이 반드시 요구하는 기존 보증(먼저)·기존 대출 조건 한 개. 없으면 null. */
function requiredByTarget(targetText: string): StructuredCondition | null {
  const text = targetText.replace(/\s+/g, " ");
  const guarantee = GUARANTEE_IN_USE.exec(text);
  if (guarantee && !isTrack(text, guarantee.index)) {
    const end = guarantee.index + guarantee[0].length;
    const start = clauseStart(text, guarantee.index);
    const guarantors = guarantorsIn(text.slice(start, end));
    if (guarantors.length > 0) {
      return {
        key: "guaranteeInUse",
        op: "in",
        value: guarantors,
        rawText: clauseText(text, start, end),
        machineReadable: true,
      };
    }
  }
  for (const loan of text.matchAll(LOAN_IN_USE)) {
    if (isTrack(text, loan.index)) continue;
    const start = clauseStart(text, loan.index);
    const rawText = clauseText(text, start, loan.index + loan[0].length);
    return { key: "hasExistingLoan", op: "eq", value: true, rawText, machineReadable: true };
  }
  return null;
}

/**
 * 붙일 조건 한 개(없으면 빈 목록). 구조·규칙에 같은 칸이 이미 있으면 붙이지 않는다 —
 * AI·어댑터가 원문에서 읽은 조건이 이름 추정보다 정확하다. origin 은 부르는 쪽이 붙인다.
 * 제목이 갈래를 말하면 제목을 따른다. 아니면 이름·대상 글에 갈아타는 말이 있는 상품만 대상 글의 요구 문장을 읽는다.
 */
export function loanProgramConditions(
  title: string,
  agency: string,
  existing: readonly StructuredCondition[],
  targetText = "",
): StructuredCondition[] {
  const program = loanProgramOf(title, agency);
  const cond: StructuredCondition | null = program
    ? program.kind === "conversion"
      ? {
          key: "guaranteeInUse",
          op: "in",
          value: [program.guarantor],
          rawText: `${program.guarantor} 보증 이용 중(전환보증)`,
          machineReadable: true,
        }
      : { key: "hasExistingLoan", op: "eq", value: true, rawText: "기존 대출 이용 중(대환)", machineReadable: true }
    : LOAN_PROGRAM_WORD.test(`${title} ${targetText}`)
      ? requiredByTarget(targetText)
      : null;
  if (!cond) return [];
  return existing.some((c) => c.key === cond.key) ? [] : [cond];
}
