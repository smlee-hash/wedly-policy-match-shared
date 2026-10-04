// 재무제표·부가세 신고서·과세표준증명에서 매출(원 단위)과 귀속 연도를 뽑는다 — 순수 함수(저장·네트워크·AI 없음).
//  - 재무제표: 손익계산서의 「매출액」 첫 숫자(당기)
//  - 부가세 신고서·과세표준증명: 「과세표준 합계」 첫 숫자
// ★「(단위: 천원)」「백만원」 같은 단위 표기를 원으로 바꾼다. 표기가 없으면 원으로 본다.
//   금액 바로 뒤에 단위(「1,000천원」)가 적혀 있으면 머리글·본문의 단위보다 그것이 앞선다(표 칸·글 줄 모두 같은 규칙).
// ★괄호 안이 숫자뿐인 값(「(1,234)」)·앞에 △·-가 붙은 값은 음수 금액 토큰으로 읽는다(줄을 통째로 버리지 않는다).
//   머리글에서 당기 열을 고를 수 있으면 그 열 값만 본다(전기가 음수여도 당기가 양수면 읽고, 당기가 음수면 정하지 않는다).
//   머리글이 없으면 라벨 뒤 첫 금액이 음수일 때 그 줄의 매출은 정하지 않는다.
// ★귀속 연도는 사업연도·과세기간의 **끝 해**다. 못 읽으면 비워 둔다(지어내지 않는다).
// ★상호·사업자번호·대표자는 읽지 않는다. 읽은 칸은 lastYearRevenueKrw 하나뿐이다.

import { splitTableRow, tableLines, type DocumentBody, type ParsedDocument } from "./parse-common";

export type FinancialDocType = "financial-statement" | "vat-return";

const MAX_KRW = 1e15;

/**
 * 매출 줄 찾는 말(라벨만). 라벨 뒤 금액은 읽을 때 따로 본다 — 앞 칸이 음수(「(1,234)」)여도 줄을 못 찾는 일이 없게.
 * 이 식은 글자 위치를 찾는 데만 쓰고, 줄마다 새 식(g)을 만들어 되풀이해 찾는다.
 */
const REVENUE_RE: Record<FinancialDocType, RegExp> = {
  "financial-statement": /매\s*출\s*액/,
  "vat-return": /과\s*세\s*표\s*준\s*합\s*계/,
};

/** 괄호 안이 숫자뿐인 모양(「1,234」·「△1,234」) — 풀이가 아니라 음수 금액이다. */
const NEGATIVE_PAREN_INNER = String.raw`[\s△▲\-−,.]*\d[\s\d,.]*`;
/** 라벨 바로 뒤의 괄호 풀이(「(주석 3)」)와 점·콜론을 건너뛴다. 숫자뿐인 괄호는 풀이가 아니니 건너뛰지 않는다. */
const AFTER_LABEL_RE = new RegExp(String.raw`^(?:\s*[(（](?!${NEGATIVE_PAREN_INNER}[)）])[^)）]{0,10}[)）])?[\s:：.…·|]*`);

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

/** 한 줄에서 금액을 찾아볼 매출 라벨 수 상한 — 라벨을 수만 번 되풀이한 줄이 처리 시간을 잡아먹지 않게. */
const MAX_LABELS_PER_LINE = 4;

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
// 「당기순이익」 같은 계정 이름은 금액 열 머리글이 아니다. 코드 열 머리글은 칸 전체가 「코드」·「계정코드」·「번호」 꼴일 때만 본다.
const AMOUNT_HEADER_RE = /^(?:당기(?!순)|금액)/;
const CODE_HEADER_RE = /^(?:계정|과목|항목)?(?:코드|번호)$/;
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

/** 매출 줄 위쪽에서 가장 가까운 머리글(당기·금액 열이나 코드 열이 있는 줄). 없으면 null. */
function headerAbove(lines: string[], at: number): AmountHeader | null {
  for (let i = at - 1; i >= 0 && i >= at - LOOK_BACK_LINES; i--) {
    const cells = cellsOf(lines[i]);
    if (cells.length < 2) continue;
    const names = cells.map((c) => c.replace(/\s/g, ""));
    const amountAt = names.findIndex((n) => AMOUNT_HEADER_RE.test(n));
    const codeAt = names.flatMap((n, k) => (CODE_HEADER_RE.test(n) ? [k] : []));
    if (amountAt < 0 && codeAt.length === 0) continue;
    return { cells, amountAt, codeAt };
  }
  return null;
}

/** 고른 금액 글자. unit 은 금액 바로 뒤에 적힌 단위(「원」「천원」「백만원」)의 곱 — 있으면 머리글·본문의 「단위: …」 대신 이것을 쓴다. */
interface PickedAmount {
  amount: string;
  unit?: number;
  /** 괄호 숫자(「(1,234)」)나 △·- 가 붙은 음수 금액. 매출로 쓰지 않는다. */
  negative?: true;
}

/**
 * 금액 글자와 그 바로 뒤 단위 이름으로 PickedAmount 를 만든다 — 칸 값(amountCell)과 라벨 뒤 숫자(numbersAfterLabel)가
 * 단위를 환산하는 **같은 규칙**이다. 단위 이름이 없거나 모르는 이름이면 unit 을 비워 머리글·본문 단위를 따르게 한다.
 */
function amountWithUnit(amount: string, unitName: string | undefined): PickedAmount {
  const unit = unitName === undefined ? undefined : UNIT_MULTIPLIER[unitName];
  return unit === undefined ? { amount } : { amount, unit };
}

/** 금액 바로 뒤 단위 이름. 긴 이름이 먼저 와야 「천만원」이 「만원」으로 읽히지 않는다. */
const UNIT_NAMES = "천만원|백만원|억원|천원|만원|원";

/**
 * 금액 토큰 하나: 괄호 숫자(1번 묶음, 음수) / 앞에 △▲-− 가 붙은 숫자(2·3번, 음수) / 그냥 숫자(4번) + 바로 뒤 단위(5번).
 * 단위 뒤에 한글이 이어 붙으면(「원가」) 단위가 아니라 낱말이다.
 */
const AMOUNT_TOKEN_RE = new RegExp(
  String.raw`^(?:[(（](${NEGATIVE_PAREN_INNER})[)）]|([△▲\-−])\s*(\d[\d,]*(?:\.\d+)?)|(\d[\d,]*(?:\.\d+)?))(?:\s*(${UNIT_NAMES})(?![가-힣]))?[\s:：.…·|]*`,
);

/** 라벨 뒤에 이어지는 금액들(공백·`|`·콜론으로 이어진 것만) — 음수 표시와 금액 바로 뒤 단위도 함께. m 은 라벨이 찾은 결과. */
function numbersAfterLabel(scan: string, m: RegExpExecArray): PickedAmount[] {
  let rest = scan.slice(m.index + m[0].length);
  rest = rest.slice((AFTER_LABEL_RE.exec(rest) as RegExpExecArray)[0].length);
  const out: PickedAmount[] = [];
  for (;;) {
    const t = AMOUNT_TOKEN_RE.exec(rest);
    if (!t) break;
    const negative = t[1] !== undefined || t[2] !== undefined;
    const picked = amountWithUnit(t[4] ?? t[3] ?? t[1].replace(/[^\d.]/g, ""), t[5]);
    out.push(negative ? { ...picked, negative: true } : picked);
    rest = rest.slice(t[0].length);
  }
  return out;
}

/** 금액 칸 값 끝의 단위 표시. */
const CELL_AMOUNT_RE = new RegExp(String.raw`^(\d+(?:\.\d+)?)(${UNIT_NAMES})?$`);

/**
 * 금액 열의 칸 값을 읽는다. 「123,456」「123,456원」「123,456천원」은 값(+단위), 괄호 음수 「(1,234)」·빈 칸·글자는 null.
 * 매출은 0 이상이어야 하니 괄호 음수는 금액으로 보지 않는다.
 */
function amountCell(raw: string): PickedAmount | null {
  const t = raw.normalize("NFC").replace(/[,\s]/g, "");
  const m = CELL_AMOUNT_RE.exec(t); // 괄호가 붙은 값은 이 모양이 아니라 여기서 걸러진다
  return m ? amountWithUnit(m[1], m[2]) : null;
}

/**
 * 매출 줄에서 금액 글자를 고른다. 머리글에 당기·금액 열이 있고 줄의 칸 수가 맞으면 그 열에서 읽는다.
 * 아니면 라벨 뒤 숫자 중 코드 모양(0으로 시작하는 6자리 이하)·코드 열을 뺀 첫 값. 하나도 없으면 null.
 */
function pickAmount(lines: string[], at: number, label: RegExp, m: RegExpExecArray): PickedAmount | null {
  const line = lines[at];
  // 라벨 바로 뒤에 금액 토큰(음수 포함)이 없으면 매출 줄이 아니다(「매출액 증가율 5.0」). 열로 읽기 전에도 같은 문을 지난다.
  if (numbersAfterLabel(line, m).length === 0) return null;
  const header = headerAbove(lines, at);
  const cells = cellsOf(line);
  const aligned = header !== null && cells.length === header.cells.length;
  if (header !== null && aligned && header.amountAt >= 0) {
    // 머리글에서 금액·당기 열을 찾았으면 그 열 칸만 읽는다. 칸이 비었거나 숫자가 아니면 옆의
    // 코드·전기·비고 값으로 대신하지 않는다 — 틀린 값의 매출보다 빈 칸이 낫다.
    return amountCell(cells[header.amountAt]);
  }
  let scan = line;
  let hit: RegExpExecArray | null = m;
  if (header !== null && aligned && header.codeAt.length > 0) {
    scan = cells.filter((_, k) => !header.codeAt.includes(k)).join("\t");
    hit = label.exec(scan);
  }
  if (!hit) return null;
  // 머리글로 열을 못 고른 줄: 코드 모양을 뺀 첫 금액을 본다. 그것이 음수이면 정하지 않는다(뒤의 양수로 대신하지 않는다).
  const picked = numbersAfterLabel(scan, hit).find(
    (t) => t.negative || t.amount.includes(",") || t.amount.includes(".") || !CODE_LIKE_RE.test(t.amount),
  );
  return picked && !picked.negative ? picked : null;
}

/** 재무제표·부가세 신고서·과세표준증명에서 매출과 귀속 연도를 뽑는다. 못 읽으면 빈 결과 + 안내. */
export function parseFinancial(body: DocumentBody, docType: FinancialDocType): ParsedDocument {
  // 빈 칸을 지키는 표 줄 — 머리글 열과 줄의 칸 자리가 맞아야 금액 열만 읽을 수 있다.
  const lines = tableLines(body);
  const text = lines.join("\n");
  const re = REVENUE_RE[docType];

  let offset = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // 한 줄에 라벨이 여럿이면 금액을 읽을 수 있는 첫 라벨을 쓴다.
    const labels = new RegExp(re.source, "g");
    let tried = 0;
    for (let m = labels.exec(line); m && tried < MAX_LABELS_PER_LINE; m = labels.exec(line), tried++) {
      const picked = pickAmount(lines, i, re, m);
      if (picked === null) continue;
      const value = Number(picked.amount.replace(/,/g, ""));
      // 칸 값에 단위가 적혀 있으면 그것을 쓰고, 없을 때만 머리글·본문의 「단위: …」를 곱한다(두 번 곱하지 않게).
      const krw = Math.round(value * (picked.unit ?? multiplierAt(text, offset + m.index)));
      if (Number.isFinite(krw) && krw >= 0 && krw <= MAX_KRW) {
        const year = yearOf(text);
        return year === undefined ? { fields: { lastYearRevenueKrw: krw } } : { fields: { lastYearRevenueKrw: krw }, year };
      }
    }
    offset += line.length + 1;
  }
  return { fields: {}, note: NOTHING_FOUND };
}
