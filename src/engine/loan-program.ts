/**
 * 상품 이름·공고 제목이 말하는 **전환보증·대환**을 기존 보증(guaranteeInUse)·기존 대출(hasExistingLoan) 조건으로 옮긴다(NO.714).
 * 이름만 그렇게 붙고 조건이 비어 있으면 대출·보증이 없는 고객에게도 「맞음」이 떴다.
 *
 * 알아보는 글은 **제목만**이다. 기관은 전환보증이 원하는 보증 기관을 고를 때만 본다.
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
 * 붙일 조건 한 개(없으면 빈 목록). 구조·규칙에 같은 칸이 이미 있으면 붙이지 않는다 —
 * AI·어댑터가 원문에서 읽은 조건이 이름 추정보다 정확하다. origin 은 부르는 쪽이 붙인다.
 */
export function loanProgramConditions(
  title: string,
  agency: string,
  existing: readonly StructuredCondition[],
): StructuredCondition[] {
  const program = loanProgramOf(title, agency);
  if (!program) return [];
  const cond: StructuredCondition =
    program.kind === "conversion"
      ? {
          key: "guaranteeInUse",
          op: "in",
          value: [program.guarantor],
          rawText: `${program.guarantor} 보증 이용 중(전환보증)`,
          machineReadable: true,
        }
      : { key: "hasExistingLoan", op: "eq", value: true, rawText: "기존 대출 이용 중(대환)", machineReadable: true };
  return existing.some((c) => c.key === cond.key) ? [] : [cond];
}
