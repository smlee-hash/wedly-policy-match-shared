// 올린 서류들을 읽어 회사 정보 칸 후보를 만든다 — 서류 읽기의 들어가는 곳. 서버 전용이라 화면(src/ui)은 부르지 않는다.
//
// 흐름: 제한 검사 → 파일마다 글자 꺼내기(extract-text) → 종류 가르기(classify) → 종류별 칸 뽑기(parse-*) → 칸별 합치기(merge).
// ★파일 하나가 실패해도(깨짐·모르는 형식·AI 읽기 오류) 나머지는 계속 읽는다. 이 함수는 예외를 밖으로 던지지 않는다.
// ★사진·스캔본은 앱이 넘긴 aiReader 로만 읽는다. 없으면(랩) 「글자 있는 PDF로 올려 주세요」 안내만 한다.
// ★aiReader 가 돌려준 값도 믿지 않고 걸러 쓴다 — 주소는 시도+시군구까지만, 주민번호 모양 글자·모르는 칸은 버린다.
// ★주민번호·대표자 이름·도로명은 결과 어디에도 내보내지 않는다(파일 이름에 든 주민번호 모양도 가린다).
// ★업종 글의 이름은 짐작해 지우지 않는다. 서류(대표자·성명 칸)와 AI(personNames)가 알려 준 이름을 묶음 전체에서 모아 그것만 지운다.
// ★이름 지우기·업종 40자 자르기·파일 이름 가리기와 100자 자르기는 합친 뒤 돌려주기 직전 한 곳(redactKnownNames)에서 한다. 앞단은 자르지 않는다.
// ★고용보험 명부에서 읽은 직원 이름도 지우기 목록에 들어간다(인원 수만 세고 이름은 결과로 나가지 않는다).

import { canonicalRegion } from "../engine/match-engine";
import { CERT_TYPE_NAMES } from "../engine/profile-derive";
import { sigunguSido } from "../engine/sigungu";
import { classifyDocument } from "./classify";
import {
  cleanAiPersonNames,
  cleanCompanyScale,
  RRN_LIKE_GLOBAL,
  screenIndustryText,
  uniquePersonNames,
} from "./clean-text";
import { extractDocumentText } from "./extract-text";
import { DOCUMENT_FIELD_KEYS, mergeDocumentFields, type MergeInput } from "./merge";
import { readBizRegistration } from "./parse-biz-registration";
import { parseCompanyStatus } from "./parse-company-status";
import { addressFields, normalizeDate, type DocumentBody, type ParsedWithNames } from "./parse-common";
import { parseEmploymentWithNames } from "./parse-employment";
import { parseFinancial } from "./parse-financial";
import { cutFileName, redactKnownNames } from "./redact-names";
import {
  DOCUMENT_UPLOAD_LIMITS,
  type AiReaderResult,
  type DocumentFields,
  type DocumentFileResult,
  type DocumentPrefillResult,
  type DocumentType,
} from "./types";

export * from "./types";

/** 올린 파일 하나. */
export interface DocumentInputFile {
  name: string;
  bytes: Uint8Array;
}

export interface ReadDocumentsOptions {
  /**
   * 사진·스캔본을 AI 로 읽어 칸을 돌려주는 함수(ERP·컨설턴트 앱이 넘긴다). 없으면 사진은 읽지 않고 안내만 한다.
   * 사진에서 본 사람 이름은 칸이 아니라 `personNames` 에만 담게 한다 — 업종에서 그 이름을 지우는 데만 쓴다.
   */
  aiReader?: (file: DocumentInputFile) => Promise<AiReaderResult>;
}

const MB = 1024 * 1024;
const NO_NAME = "이름 없는 파일";

const COUNT_MAX = 100_000;
const KRW_MAX = 1e15;
const BIZNO_RE = /^(\d{3})-?(\d{2})-?(\d{5})$/;

const LIMIT_MESSAGE = {
  tooMany: `한 번에 올릴 수 있는 파일은 최대 ${DOCUMENT_UPLOAD_LIMITS.maxFiles}개입니다. 이 파일은 읽지 않았습니다. 나눠서 올려 주세요.`,
  tooLarge: `파일이 너무 큽니다(한 파일 최대 ${Math.round(DOCUMENT_UPLOAD_LIMITS.maxFileBytes / MB)}MB). 필요한 부분만 남겨 다시 올려 주세요.`,
  totalTooLarge: `한 번에 올릴 수 있는 전체 크기(최대 ${Math.round(DOCUMENT_UPLOAD_LIMITS.maxTotalBytes / MB)}MB)를 넘어 읽지 않았습니다. 나눠서 올려 주세요.`,
} as const;
const NEEDS_TEXT_PDF = "사진·스캔본은 글자 있는 PDF로 올려 주세요.";
const AI_FAILED = "사진·스캔본을 읽다가 문제가 생겼습니다. 글자 있는 PDF로 올려 주세요.";
const AI_EMPTY = "사진·스캔본에서 채울 수 있는 칸을 찾지 못했습니다.";
const UNKNOWN_DOC = "어떤 서류인지 알 수 없어 읽지 않았습니다. 사업자등록증·재무제표·부가세 신고서·고용보험 서류·기업상태표를 올려 주세요.";
const NO_FIELDS = "읽었지만 회사 정보 칸에 채울 값을 찾지 못했습니다.";
const COMPANY_STATUS_NEEDS_EXCEL = "기업상태표는 엑셀 파일(.xlsx)로 올려 주세요.";
const READ_FAILED = "이 파일을 읽다가 문제가 생겨 건너뛰었습니다.";

/* ───────── 파일 이름 ───────── */

/** 경로를 떼고 이름만 남긴다. 확장자 판별·종류 가르기에는 이 이름을 쓴다. */
function baseNameOf(name: string): string {
  const clean = name.normalize("NFC").replace(/[\u0000-\u001f\u007f]/g, "");
  return (clean.split(/[\\/]/).pop() ?? "").trim();
}

/**
 * 결과 안에서 파일을 가리키는 이름 — 주민번호 모양은 가린다. 100자로 자르는 일은 여기서 하지 않는다:
 * 먼저 자르면 이름이 반으로 잘려(「김지」) 뒤의 이름 지우기가 못 찾는다. 자르기는 이름을 지운 뒤 redactKnownNames 가 한다.
 */
function displayNameOf(base: string): string {
  return base.replace(RRN_LIKE_GLOBAL, "●●●●●●-●●●●●●●") || NO_NAME;
}

/* ───────── AI 읽기 결과 거르기 ───────── */

/**
 * 서류 파서가 돌려준 글자 칸(업종·규모)을 한 번 더 거른다 — AI 읽기와 같은 거르개를 쓴다.
 * 업종은 다음 항목 이름(성명·대표자 …)에서 자르고, 주민번호·주소 모양이 있으면 칸을 버린다(40자로는 자르지 않는다).
 * 규모는 정해진 값만 남긴다. 사람 이름 지우기는 묶음 전체의 이름이 모인 뒤 redactKnownNames 가 한다.
 */
function scrubFields(fields: DocumentFields): DocumentFields {
  const out: DocumentFields = { ...fields };
  if (out.industry !== undefined) {
    const industry = screenIndustryText(out.industry);
    if (industry) out.industry = industry;
    else delete out.industry;
  }
  if (out.companyScale !== undefined) {
    const scale = cleanCompanyScale(out.companyScale);
    if (scale) out.companyScale = scale;
    else delete out.companyScale;
  }
  return out;
}

function cleanCount(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= COUNT_MAX ? value : null;
}

/** aiReader 가 돌려준 값에서 칸 이름·모양·값 범위가 맞는 것만 남긴다. */
function sanitizeAiFields(raw: unknown): DocumentFields {
  if (typeof raw !== "object" || raw === null) return {};
  const src = raw as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  for (const key of DOCUMENT_FIELD_KEYS) {
    const value = src[key];
    switch (key) {
      case "bizno": {
        const m = typeof value === "string" ? BIZNO_RE.exec(value.trim()) : null;
        if (m) out.bizno = `${m[1]}-${m[2]}-${m[3]}`;
        break;
      }
      case "industry": {
        const text = screenIndustryText(value);
        if (text) out.industry = text;
        break;
      }
      case "companyScale": {
        const scale = cleanCompanyScale(value);
        if (scale) out.companyScale = scale;
        break;
      }
      case "region": {
        const region = typeof value === "string" ? canonicalRegion(value) : null;
        if (region) out.region = region;
        break;
      }
      case "regionSigungu": {
        const hit = typeof value === "string" ? sigunguSido(value) : null;
        if (hit) out.regionSigungu = hit.name;
        break;
      }
      case "businessAddress": {
        // 긴 주소가 와도 시도+시군구까지만 남기고 나머지는 버린다. 시도를 못 읽으면 이 칸은 버린다.
        if (typeof value !== "string") break;
        const short = addressFields(value);
        if (!short.businessAddress) break;
        out.businessAddress = short.businessAddress;
        if (short.region) out.region ??= short.region;
        if (short.regionSigungu) out.regionSigungu ??= short.regionSigungu;
        break;
      }
      case "foundedDate": {
        const date = typeof value === "string" ? normalizeDate(value) : null;
        if (date) out.foundedDate = date;
        break;
      }
      case "lastYearRevenueKrw": {
        if (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= KRW_MAX) {
          out.lastYearRevenueKrw = Math.round(value);
        }
        break;
      }
      case "employeeCount":
      case "patentCount": {
        const n = cleanCount(value);
        if (n !== null) out[key] = n;
        break;
      }
      case "isCorporation":
      case "taxDelinquent":
      case "hasCert":
      case "hasPatent": {
        if (typeof value === "boolean") out[key] = value;
        break;
      }
      case "certTypes": {
        const known: readonly string[] = CERT_TYPE_NAMES;
        const kinds = Array.isArray(value)
          ? [...new Set(value.filter((v): v is string => typeof v === "string" && known.includes(v)))]
          : [];
        if (kinds.length > 0) out.certTypes = kinds;
        break;
      }
    }
  }
  return out as DocumentFields;
}

/** AI 가 사진에서 본 사람 이름(대표자·직원). 지우기 목록에만 쓰고 결과 칸에는 넣지 않는다. 개수 상한은 두지 않는다. */
function aiPersonNames(raw: unknown): string[] {
  if (typeof raw !== "object" || raw === null) return [];
  return cleanAiPersonNames((raw as Record<string, unknown>).personNames);
}

/* ───────── 파일 하나 읽기 ───────── */

interface ReadOne {
  result: DocumentFileResult;
  merge?: MergeInput;
  /** 이 파일이 알려 준 사람 이름(서류 라벨의 대표자·성명, AI 가 본 이름) — 묶음 전체의 결과에서 지우는 데만 쓴다. 결과에는 넣지 않는다. */
  names: string[];
  /** 명부에서 읽은 직원 이름. 따로 모아 라벨·AI 이름 뒤에 붙인다(많아도 앞 이름을 밀어내지 않게). */
  rosterNames?: string[];
}

const noNames = (result: DocumentFileResult): ReadOne => ({ result, names: [] });

function textOf(body: DocumentBody): string {
  return [body.text ?? "", ...(body.sheets ?? []).map((s) => s.text)].filter(Boolean).join("\n");
}

/** 서류 종류에 맞는 칸 뽑기를 부른다. 읽을 수 없는 종류(unknown)는 null. 이름을 알려 주는 서류는 이름 목록도 함께 돌려준다. */
function parseByType(docType: DocumentType, body: DocumentBody): ParsedWithNames | null {
  const plain = (parsed: ParsedWithNames["parsed"]): ParsedWithNames => ({ parsed, personNames: [] });
  switch (docType) {
    case "company-status":
      return plain(body.sheets ? parseCompanyStatus(body.sheets) : { fields: {}, note: COMPANY_STATUS_NEEDS_EXCEL });
    case "biz-registration":
      return readBizRegistration(textOf(body));
    case "financial-statement":
    case "vat-return":
      return plain(parseFinancial(body, docType));
    case "employment-insurance":
      return parseEmploymentWithNames(body); // 명부의 직원 이름도 함께(지우기 목록용)
    default:
      return null;
  }
}

function refused(name: string, status: DocumentFileResult["status"], message: string): DocumentFileResult {
  return { name, docType: "unknown", status, message, fields: [] };
}

async function readImage(
  display: string,
  bytes: Uint8Array,
  aiReader: ReadDocumentsOptions["aiReader"],
): Promise<ReadOne> {
  if (!aiReader) return noNames(refused(display, "needs-text-pdf", NEEDS_TEXT_PDF));
  let fields: DocumentFields;
  let names: string[];
  try {
    const raw = await aiReader({ name: cutFileName(display), bytes });
    fields = sanitizeAiFields(raw);
    names = aiPersonNames(raw);
  } catch {
    // 오류 글에 파일 속 정보가 섞일 수 있어 그대로 내보내지 않는다.
    return noNames(refused(display, "failed", AI_FAILED));
  }
  const keys = Object.keys(fields) as DocumentFileResult["fields"];
  if (keys.length === 0) return { result: refused(display, "no-fields", AI_EMPTY), names };
  return {
    result: { name: display, docType: "unknown", status: "read-by-ai", fields: keys },
    merge: { name: display, docType: "unknown", fields },
    names,
  };
}

async function readOne(
  base: string,
  display: string,
  bytes: Uint8Array,
  aiReader: ReadDocumentsOptions["aiReader"],
): Promise<ReadOne> {
  const extracted = await extractDocumentText(base, bytes);
  if (extracted.kind === "unsupported") return noNames(refused(display, "unsupported", extracted.reason));
  if (extracted.kind === "image") return readImage(display, bytes, aiReader);

  // 쉼표 표(.csv)는 따옴표를 지키며 열을 나눠 읽도록 표시한다.
  const body: DocumentBody =
    extracted.kind === "text"
      ? {
          text: extracted.text,
          ...(/\.csv$/i.test(base) ? { csv: true } : {}),
          // 글자 상한(20만 자)으로 뒤가 잘렸으면 파서가 「전체 세기」를 하지 않게 알린다.
          ...(extracted.truncated ? { truncated: true } : {}),
        }
      : { sheets: extracted.sheets };
  const docType = classifyDocument({ fileName: base, ...body });
  const read = parseByType(docType, body);
  if (!read) return noNames({ ...refused(display, "no-fields", UNKNOWN_DOC), docType });

  // 사람 이름 지우기는 서류 묶음 전체의 이름이 모인 뒤(redactKnownNames)에 한다 — 다른 서류가 알려 준 이름도 지워야 해서.
  const { parsed } = read;
  // 고용보험 명부의 직원 이름은 라벨·AI 이름과 따로 모은다.
  const fromRoster = docType === "employment-insurance";
  const names = fromRoster ? [] : read.personNames;
  const rosterNames = fromRoster ? read.personNames : [];
  const fields = scrubFields(parsed.fields);
  const keys = Object.keys(fields) as DocumentFileResult["fields"];
  if (keys.length === 0) {
    return { result: { ...refused(display, "no-fields", parsed.note ?? NO_FIELDS), docType }, names, rosterNames };
  }
  const result: DocumentFileResult = { name: display, docType, status: "read", fields: keys };
  if (parsed.year !== undefined) result.year = parsed.year;
  const merge: MergeInput = { name: display, docType, fields };
  if (parsed.year !== undefined) merge.year = parsed.year;
  return { result, merge, names, rosterNames };
}

/**
 * 올린 파일들을 읽어 칸 후보와 합친 결과를 돌려준다. 파일 순서대로 files 에 한 줄씩 적는다.
 * 제한(개수·한 파일 크기·합계 크기)은 읽기 전에 먼저 검사한다.
 */
export async function readDocuments(
  files: DocumentInputFile[],
  opts: ReadDocumentsOptions = {},
): Promise<DocumentPrefillResult> {
  const limits = DOCUMENT_UPLOAD_LIMITS;
  const reads: ReadOne[] = [];
  let total = 0;

  for (let i = 0; i < files.length; i++) {
    const base = baseNameOf(String(files[i]?.name ?? ""));
    const display = displayNameOf(base);
    try {
      const bytes = files[i].bytes;
      const size = bytes.byteLength;
      if (i >= limits.maxFiles) {
        reads.push(noNames(refused(display, "failed", LIMIT_MESSAGE.tooMany)));
      } else if (size > limits.maxFileBytes) {
        reads.push(noNames(refused(display, "too-large", LIMIT_MESSAGE.tooLarge)));
      } else if (total + size > limits.maxTotalBytes) {
        reads.push(noNames(refused(display, "too-large", LIMIT_MESSAGE.totalTooLarge)));
      } else {
        total += size;
        reads.push(await readOne(base, display, bytes, opts.aiReader));
      }
    } catch {
      reads.push(noNames(refused(display, "failed", READ_FAILED)));
    }
  }

  const results = reads.map((r) => r.result);
  const inputs = reads.flatMap((r) => (r.merge ? [r.merge] : []));
  const merged: DocumentPrefillResult = { ...mergeDocumentFields(inputs), files: results };

  // 서류 묶음 전체가 알려 준 사람 이름(규칙 경로·AI 경로 모두)으로 돌려주기 직전에 결과 전체를 한 번에 지운다.
  // 이름은 여기서만 쓰고 결과에 넣지 않는다. 서류 라벨·AI 이름을 항상 먼저 두고, 명부 직원 이름은 그 뒤에 붙인다(개수 상한 없음).
  const names = uniquePersonNames([...reads.flatMap((r) => r.names), ...reads.flatMap((r) => r.rosterNames ?? [])]);
  return redactKnownNames(merged, names, (file) => (file.status === "read-by-ai" ? AI_EMPTY : NO_FIELDS));
}
