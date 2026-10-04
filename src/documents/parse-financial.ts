// 재무제표·부가세 신고서·과세표준증명에서 매출(원 단위)과 귀속 연도를 뽑는다 — 순수 함수(저장·네트워크·AI 없음).
//  - 재무제표: 손익계산서의 「매출액」 첫 숫자(당기)
//  - 부가세 신고서·과세표준증명: 「과세표준 합계」 첫 숫자
// ★「(단위: 천원)」「백만원」 같은 단위 표기를 원으로 바꾼다. 표기가 없으면 원으로 본다.
// ★귀속 연도는 사업연도·과세기간의 **끝 해**다. 못 읽으면 비워 둔다(지어내지 않는다).
// ★상호·사업자번호·대표자는 읽지 않는다. 읽은 칸은 lastYearRevenueKrw 하나뿐이다.

import { bodyLines, type DocumentBody, type ParsedDocument } from "./parse-common";

export type FinancialDocType = "financial-statement" | "vat-return";

const MAX_KRW = 1e15;

/** 매출 줄 찾는 말. 라벨 뒤(괄호 풀이·점·콜론 건너뛰고)에 숫자가 이어져야 한다. */
const NUMBER_AFTER = String.raw`(?:\s*[(（][^)）]{0,10}[)）])?[\s:：.…·]*(\d[\d,]*(?:\.\d+)?)`;
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

/** 재무제표·부가세 신고서·과세표준증명에서 매출과 귀속 연도를 뽑는다. 못 읽으면 빈 결과 + 안내. */
export function parseFinancial(body: DocumentBody, docType: FinancialDocType): ParsedDocument {
  const lines = bodyLines(body);
  const text = lines.join("\n");
  const re = REVENUE_RE[docType];

  let offset = 0;
  for (const line of lines) {
    const m = re.exec(line);
    if (m) {
      const value = Number(m[1].replace(/,/g, ""));
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
