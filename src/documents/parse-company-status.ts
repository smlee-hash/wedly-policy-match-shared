// 기업상태표(엑셀)에서 정책매칭 회사 정보 칸을 뽑는다 — 순수 함수(저장·네트워크·AI 없음).
//
// 칸 위치는 ERP 기업상태표 정본(company-status/fields.ts 의 excelCell)을 그대로 따른다:
//   F2 개업일 · B3 주업종 · B4 소재지 · C6 전년도 매출 · C10 4대보험 인원 · E26 특허 · E29 인증 · G30·G31 체납
// ★B2 업체명은 읽지 않는다. 정책자금 기대출(C32)·신용·대출 칸도 서류로 채우지 않는다(types.ts 의 약속).
// ★매출은 「전년도(C6)」만 쓴다. 「당해년도」 행(C5)은 연말까지 안 끝난 값이라 쓰지 않는다.
// ★소재지는 시도+시군구까지만 남긴다(도로명·건물명은 결과에 없다).
// ★모르는 칸은 채우지 않는다. hasCert·hasPatent 는 서류가 「없음」을 분명히 말할 때만 채운다.

import { COMPANY_STATUS_LABELS } from "./classify";
import type { SheetData } from "./extract-text";
import { addressFields, normalizeDate, parseKrwAmount, type ParsedDocument } from "./parse-common";
import type { DocumentFields } from "./types";

const CELL = {
  foundedDate: "F2",
  industry: "B3",
  address: "B4",
  lastYearRevenue: "C6",
  insuredCount: "C10",
  patent: "E26",
  cert: "E29",
  taxNational: "G30",
  taxInsurance: "G31",
} as const;

const MAX_INDUSTRY_LENGTH = 400;
const MAX_COUNT = 100_000;

/** 인증 종류. 서류에 적힌 순서와 상관없이 이 순서로 돌려준다(profile-derive 의 CERT_TYPE_NAMES 순서). */
const CERT_RULES: ReadonlyArray<readonly [string, RegExp]> = [
  ["벤처", /벤처(?:기업)?/],
  ["이노비즈", /이노비즈|innobiz/i],
  ["메인비즈", /메인비즈|mainbiz/i],
  ["ISO", /(?<![a-z])iso(?![a-z])\s*[-:]?\s*\d*/i],
  ["여성기업", /여성기업/],
  ["사회적기업", /사회적기업/],
];

/** 종류를 가린 뒤 남은 글에서 지울 군더더기 — 이것만 남으면 「기타」로 세지 않는다. */
const CERT_NOISE = /확인서?|인증서?|인증|보유|기업|등록|취득|획득|여부|있음|해당/g;

/** 「없음」을 뜻하는 글(공백을 뺀 뒤 통째로 비교). */
const NONE_RE = /^(?:없음|없다|x|×|해당없음|해당사항없음|미보유|무)$/i;

const PAREN_RE = /[(（][^)）]*[)）]/g;

function compact(s: string): string {
  return s.normalize("NFC").replace(/\s+/g, "");
}

/** 칸 이름이 가장 많이 보이는 시트. 하나도 안 보이면 null. */
function pickSheet(sheets: SheetData[]): SheetData | null {
  let best: SheetData | null = null;
  let bestCount = 0;
  for (const sheet of sheets) {
    const body = compact(Object.values(sheet.cells).join("\n"));
    const count = COMPANY_STATUS_LABELS.filter((label) => body.includes(label)).length;
    if (count > bestCount) {
      best = sheet;
      bestCount = count;
    }
  }
  return best;
}

/** 「Y」「N」「예」「아니오」 같은 칸. 모르는 글이면 null. */
function yesNo(text: string | undefined): boolean | null {
  const t = compact(text ?? "").toLowerCase();
  if (/^(?:y|yes|예|네|있음|o|○|●)$/.test(t)) return true;
  if (/^(?:n|no|아니오|아니요|없음|x|×|무)$/.test(t)) return false;
  return null;
}

/** 「12명」「1,200」「없음」 → 정수. 모르면 null. */
function headcount(text: string): number | null {
  const t = compact(text).replace(/,/g, "");
  if (/^(?:없음|무)$/.test(t)) return 0;
  const m = /^(\d+)명?(?:[(（].*)?$/.exec(t);
  if (!m) return null;
  const n = Number(m[1]);
  return n <= MAX_COUNT ? n : null;
}

/**
 * 특허 글자에서 건수. 「등록 2건, 출원 1건」→ 3, 「특허 5건」→ 5, 「2」→ 2.
 * 「없음」·「X」·0건이면 0건 + hasPatent=false. 건수를 알 수 없으면(「있음」) 아무것도 채우지 않는다.
 * 괄호 속 풀이(「특허 3건 (등록 2건, 출원 1건)」)는 두 번 세지 않으려고 뺀다.
 */
export function parsePatentText(text: string): Pick<DocumentFields, "patentCount" | "hasPatent"> {
  const t = compact(text.replace(PAREN_RE, " "));
  if (t === "") return {};
  if (NONE_RE.test(t)) return { patentCount: 0, hasPatent: false };

  const counts = [...t.matchAll(/(\d+)건/g)].map((m) => Number(m[1]));
  let total: number | null = null;
  if (counts.length > 0) total = counts.reduce((a, b) => a + b, 0);
  else if (/^\d+$/.test(t)) total = Number(t);
  if (total === null || total > MAX_COUNT) return {};
  return total === 0 ? { patentCount: 0, hasPatent: false } : { patentCount: total };
}

/**
 * 인증 글자에서 종류. 벤처·이노비즈·메인비즈·ISO·여성기업·사회적기업, 그 밖의 글자는 「기타」.
 * 「없음」·「X」는 「없음」 + hasCert=false. 읽을 글이 없으면 아무것도 채우지 않는다.
 * 괄호 속 기간 표기(「벤처인증(2027.03까지)」)와 ISO 번호는 기타로 세지 않는다.
 */
export function parseCertText(text: string): Pick<DocumentFields, "certTypes" | "hasCert"> {
  const body = text.normalize("NFC").replace(PAREN_RE, " ");
  const t = compact(body);
  if (t === "") return {};
  if (NONE_RE.test(t)) return { certTypes: ["없음"], hasCert: false };

  const certTypes: string[] = [];
  let rest = body;
  for (const [name, re] of CERT_RULES) {
    if (!re.test(rest)) continue;
    certTypes.push(name);
    rest = rest.replace(new RegExp(re.source, `${re.flags}g`), " ");
  }
  const letters = rest.replace(CERT_NOISE, "").replace(/[^가-힣a-zA-Z]/g, "");
  if (letters.length >= 2) certTypes.push("기타");
  return certTypes.length > 0 ? { certTypes } : {};
}

/** 기업상태표 시트들에서 칸을 뽑는다. 기업상태표가 아니면(칸 이름이 하나도 없으면) 빈 결과. */
export function parseCompanyStatus(sheets: SheetData[]): ParsedDocument {
  const sheet = pickSheet(sheets);
  if (!sheet) return { fields: {} };
  const cell = (addr: string): string => (sheet.cells[addr] ?? "").trim();
  const fields: DocumentFields = {};

  const founded = normalizeDate(cell(CELL.foundedDate));
  if (founded) fields.foundedDate = founded;

  const industry = cell(CELL.industry).replace(/\s+/g, " ");
  if (industry && industry.length <= MAX_INDUSTRY_LENGTH) fields.industry = industry;

  const address = cell(CELL.address);
  if (address) Object.assign(fields, addressFields(address));

  const revenue = cell(CELL.lastYearRevenue);
  if (revenue) {
    const krw = parseKrwAmount(revenue);
    if (krw !== null) fields.lastYearRevenueKrw = krw;
  }

  const insured = cell(CELL.insuredCount);
  if (insured) {
    const n = headcount(insured);
    if (n !== null) fields.employeeCount = n;
  }

  Object.assign(fields, parsePatentText(cell(CELL.patent)), parseCertText(cell(CELL.cert)));

  // 체납 — 국세·4대보험료 중 하나라도 Y 면 체납. 국세가 N 이고 보험료가 Y 가 아니면 체납 아님. 국세를 모르면 모름.
  const national = yesNo(cell(CELL.taxNational));
  const insurance = yesNo(cell(CELL.taxInsurance));
  if (national === true || insurance === true) fields.taxDelinquent = true;
  else if (national === false) fields.taxDelinquent = false;

  return { fields };
}
