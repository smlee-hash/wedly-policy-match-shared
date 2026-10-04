// 재무제표·부가세 신고서·과세표준증명에서 매출(원 단위)과 귀속 연도를 뽑는다 — 순수 함수(저장·네트워크·AI 없음).
//  - 재무제표: 손익계산서의 「매출액」 첫 숫자(당기)
//  - 부가세 신고서·과세표준증명: 「과세표준 합계」 첫 숫자
// ★「(단위: 천원)」「백만원」 같은 단위 표기를 원으로 바꾼다. 표기가 없으면 원으로 본다.
// ★귀속 연도는 사업연도·과세기간의 **끝 해**다. 못 읽으면 비워 둔다(지어내지 않는다).
// ★상호·사업자번호·대표자는 읽지 않는다. 읽은 칸은 lastYearRevenueKrw 하나뿐이다.

import { bodyLines, splitTableRow, type DocumentBody, type ParsedDocument } from "./parse-common";

export type FinancialDocType = "financial-statement" | "vat-return";

const MAX_KRW = 1e15;

/** 매출 줄 찾는 말. 라벨 뒤(괄호 풀이·점·콜론 건너뛰고)에 숫자가 이어져야 한다. */
const NUMBER_AFTER = String.raw`(?:\s*[(（][^)）]{0,10}[)）])?[\s:：.…·|]*(\d[\d,]*(?:\.\d+)?)`;
const REVENUE_RE: Record<FinancialDocType, RegExp> = {
  "financial-statement": new RegExp(String.raw`매\s*출\s*액${NUMBER_AFTER}`),
  "vat-return": new RegExp(String.raw`과\s*세\s*표\s*준\s*합\s*계${NUMBER_AFTER}`),
};

/** 단위 표기. 긴 이름이 먼저 와야 「천만원」이 「만원」으로 잘못 읽히지 않는다. */
const UNIT_RE = /단\s*위\s*[:：]?\s*(천\s*만\s*원|백\s*만\s*원|억\s*원|천\s*원|만\s*원|원)/g;
const UNIT_MULTIPLIER: Record<string, number> = {
  원: 1,
  천원: 1_000,
  만원: 10_000,
  백만원: 1_000_000,
  천만원: 10_000_000,
  억원: 100_000_000,
};

/** 「2025.01.01 ~ 2025.12.31」「2025년 7월 1일 ~ 2025년 12월 31일」 — 끝 해를 잡는다. */
const PERIOD_RE =
  /\d{4}\s*[.\-/년]\s*\d{1,2}\s*[.\-/월]\s*\d{1,2}\s*일?\s*[~∼～-]\s*(\d{4})\s*[.\-/년]\s*\d{1,2}\s*[.\-/월]\s*\d{1,2}/;
const PERIOD_LABEL_RE = /사업\s*연도|사업\s*년도|과세\s*기간|귀속/;
/** 기간 모양이 아니고 「사업연도 2025」처럼 해만 적힌 경우 */
const YEAR_ONLY_RE = /(?:사업\s*연도|사업\s*년도|귀속\s*(?:연도|년도)?)\s*[:：]?\s*(\d{4})\s*년?(?!\s*[.\-/\d])/;

const NOTHING_FOUND = "매출을 찾지 못했습니다. 손익계산서의 매출액이나 부가세 신고서의 과세표준 합계가 보이는 글자 있는 PDF·엑셀로 올려 주세요.";

function validYear(y: number): number | undefined {
  return y >= 1990 && y <= 2100 ? y : undefined;
}

function yearOf(text: string): number | undefined {
  const labelAt = text.search(PERIOD_LABEL_RE);
  // 라벨 뒤에서 먼저 찾고, 없으면 글 전체에서 찾는다.
  const scopes = labelAt >= 0 ? [text.slice(labelAt), text] : [text];
  for (const scope of scopes) {
    const period = PERIOD_RE.exec(scope);
    if (period) return validYear(Number(period[1]));
  }
  const single = YEAR_ONLY_RE.exec(text);
  return single ? validYear(Number(single[1])) : undefined;
}

/** 매출 줄의 위치 앞에서 가장 가까운 단위. 앞에 없으면 글에서 처음 나온 단위. 표기가 없으면 원(1). */
function multiplierAt(text: string, at: number): number {
  const units = [...text.matchAll(UNIT_RE)].map((m) => ({ index: m.index ?? 0, name: m[1].replace(/\s+/g, "") }));
  if (units.length === 0) return 1;
  const before = units.filter((u) => u.index <= at);
  const pick = before.length > 0 ? before[before.length - 1] : units[0];
  return UNIT_MULTIPLIER[pick.name] ?? 1;
}

/* ───────── 금액 열 고르기 — 계정 코드 열이 금액으로 읽히지 않게 ───────── */

/** 계정 코드처럼 보이는 숫자: 0으로 시작하는 두 자리 이상 6자리 이하(「001」「0101」). 금액은 0으로 시작하지 않는다(「0」 하나는 매출 0원). */
const CODE_LIKE_RE = /^0\d{1,5}$/;
const AMOUNT_HEADER_RE = /^(?:당기|금액)/;
const CODE_HEADER_RE = /코드|번호/;
const LOOK_BACK_LINES = 30;

/** 한 줄을 칸으로 나눈다 — 탭·`|` 가 있으면 그것으로, 없으면 공백 둘 이상으로(PDF 글은 칸 사이가 넓다). */
function cellsOf(line: string): string[] {
  if (line.includes("\t") || line.includes("|")) return splitTableRow(line).map((c) => c.trim());
  return line.trim().split(/\s{2,}/);
}

interface AmountHeader {
  cells: string[];
  /** 「당기」「금액」 열 자리. 없으면 -1 */
  amountAt: number;
  /** 「코드」「번호」 열 자리들 */
  codeAt: number[];
}

/** 매출 줄 위쪽에서 가장 가까운 머리글(당기·금액 열이 있는 줄). 없으면 null. */
function headerAbove(lines: string[], at: number): AmountHeader | null {
  for (let i = at - 1; i >= 0 && i >= at - LOOK_BACK_LINES; i--) {
    const cells = cellsOf(lines[i]);
    if (cells.length < 2) continue;
    const names = cells.map((c) => c.replace(/\s/g, ""));
    const amountAt = names.findIndex((n) => AMOUNT_HEADER_RE.test(n));
    if (amountAt < 0) continue;
    const codeAt = names.flatMap((n, k) => (CODE_HEADER_RE.test(n) ? [k] : []));
    return { cells, amountAt, codeAt };
  }
  return null;
}

/** 라벨 뒤에 이어지는 숫자들(공백·`|`·콜론으로 이어진 것만). m 은 REVENUE_RE 가 찾은 결과. */
function numbersAfterLabel(scan: string, m: RegExpExecArray): string[] {
  let rest = scan.slice(m.index + m[0].length - m[1].length);
  const out: string[] = [];
  for (;;) {
    const t = /^(\d[\d,]*(?:\.\d+)?)[\s:：.…·|]*/.exec(rest);
    if (!t) break;
    out.push(t[1]);
    rest = rest.slice(t[0].length);
  }
  return out;
}

/**
 * 매출 줄에서 금액 글자를 고른다. 머리글에 당기·금액 열이 있고 줄의 칸 수가 맞으면 그 열에서 읽는다.
 * 아니면 라벨 뒤 숫자 중 코드 모양(0으로 시작하는 6자리 이하)·코드 열을 뺀 첫 값. 하나도 없으면 null.
 */
function pickAmount(lines: string[], at: number, re: RegExp, m: RegExpExecArray): string | null {
  const line = lines[at];
  const header = headerAbove(lines, at);
  const cells = cellsOf(line);
  const aligned = header !== null && cells.length === header.cells.length;
  if (aligned) {
    const cell = cells[header.amountAt].replace(/[,\s]/g, "");
    if (/^\d+(?:\.\d+)?$/.test(cell)) return cell;
  }
  let scan = line;
  let hit: RegExpExecArray | null = m;
  if (aligned && header.codeAt.length > 0) {
    scan = cells.filter((_, k) => !header.codeAt.includes(k)).join("\t");
    hit = re.exec(scan);
  }
  if (!hit) return null;
  const amount = numbersAfterLabel(scan, hit).find((t) => t.includes(",") || t.includes(".") || !CODE_LIKE_RE.test(t));
  return amount ?? null;
}

/** 재무제표·부가세 신고서·과세표준증명에서 매출과 귀속 연도를 뽑는다. 못 읽으면 빈 결과 + 안내. */
export function parseFinancial(body: DocumentBody, docType: FinancialDocType): ParsedDocument {
  const lines = bodyLines(body);
  const text = lines.join("\n");
  const re = REVENUE_RE[docType];

  let offset = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = re.exec(line);
    const picked = m ? pickAmount(lines, i, re, m) : null;
    if (m && picked !== null) {
      const value = Number(picked.replace(/,/g, ""));
      const krw = Math.round(value * multiplierAt(text, offset + m.index));
      if (Number.isFinite(krw) && krw >= 0 && krw <= MAX_KRW) {
        const year = yearOf(text);
        return year === undefined ? { fields: { lastYearRevenueKrw: krw } } : { fields: { lastYearRevenueKrw: krw }, year };
      }
    }
    offset += line.length + 1;
  }
  return { fields: {}, note: NOTHING_FOUND };
}
