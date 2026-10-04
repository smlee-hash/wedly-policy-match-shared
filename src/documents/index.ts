// 올린 서류들을 읽어 회사 정보 칸 후보를 만든다 — 서류 읽기의 들어가는 곳. 서버 전용이라 화면(src/ui)은 부르지 않는다.
//
// 흐름: 제한 검사 → 파일마다 글자 꺼내기(extract-text) → 종류 가르기(classify) → 종류별 칸 뽑기(parse-*) → 칸별 합치기(merge).
// ★파일 하나가 실패해도(깨짐·모르는 형식·AI 읽기 오류) 나머지는 계속 읽는다. 이 함수는 예외를 밖으로 던지지 않는다.
// ★사진·스캔본은 앱이 넘긴 aiReader 로만 읽는다. 없으면(랩) 「글자 있는 PDF로 올려 주세요」 안내만 한다.
// ★aiReader 가 돌려준 값도 믿지 않고 걸러 쓴다 — 주소는 시도+시군구까지만, 주민번호 모양 글자·모르는 칸은 버린다.
// ★주민번호·대표자 이름·도로명은 결과 어디에도 내보내지 않는다(파일 이름에 든 주민번호 모양도 가린다).

import { canonicalRegion } from "../engine/match-engine";
import { CERT_TYPE_NAMES } from "../engine/profile-derive";
import { sigunguSido } from "../engine/sigungu";
import { classifyDocument } from "./classify";
import { extractDocumentText } from "./extract-text";
import { DOCUMENT_FIELD_KEYS, mergeDocumentFields, type MergeInput } from "./merge";
import { parseBizRegistration } from "./parse-biz-registration";
import { parseCompanyStatus } from "./parse-company-status";
import { addressFields, normalizeDate, type DocumentBody, type ParsedDocument } from "./parse-common";
import { parseEmployment } from "./parse-employment";
import { parseFinancial } from "./parse-financial";
import {
  DOCUMENT_UPLOAD_LIMITS,
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
  /** 사진·스캔본을 AI 로 읽어 칸을 돌려주는 함수(ERP·컨설턴트 앱이 넘긴다). 없으면 사진은 읽지 않고 안내만 한다. */
  aiReader?: (file: DocumentInputFile) => Promise<DocumentFields>;
}

const MB = 1024 * 1024;
const NAME_MAX_CHARS = 100;
const NO_NAME = "이름 없는 파일";

const TEXT_MAX_CHARS = 400;
const COUNT_MAX = 100_000;
const KRW_MAX = 1e15;
/** 주민번호·법인등록번호 모양(13자리). 앞뒤에 다른 숫자가 붙어 있지 않을 때만 */
const RRN_LIKE = /(?<!\d)\d{6}\s*-?\s*\d{7}(?!\d)/;
const RRN_LIKE_GLOBAL = new RegExp(RRN_LIKE.source, "g");
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

/** 화면·결과에 내보낼 이름 — 주민번호 모양은 가리고 100자로 자른다. */
function displayNameOf(base: string): string {
  const masked = base.replace(RRN_LIKE_GLOBAL, "●●●●●●-●●●●●●●");
  return Array.from(masked).slice(0, NAME_MAX_CHARS).join("") || NO_NAME;
}

/* ───────── AI 읽기 결과 거르기 ───────── */

function cleanText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.normalize("NFC").replace(/\s+/g, " ").trim();
  return text !== "" && text.length <= TEXT_MAX_CHARS && !RRN_LIKE.test(text) ? text : null;
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
      case "industry":
      case "companyScale": {
        const text = cleanText(value);
        if (text) out[key] = text;
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

/* ───────── 파일 하나 읽기 ───────── */

interface ReadOne {
  result: DocumentFileResult;
  merge?: MergeInput;
}

function textOf(body: DocumentBody): string {
  return [body.text ?? "", ...(body.sheets ?? []).map((s) => s.text)].filter(Boolean).join("\n");
}

/** 서류 종류에 맞는 칸 뽑기를 부른다. 읽을 수 없는 종류(unknown)는 null. */
function parseByType(docType: DocumentType, body: DocumentBody): ParsedDocument | null {
  switch (docType) {
    case "company-status":
      return body.sheets ? parseCompanyStatus(body.sheets) : { fields: {}, note: COMPANY_STATUS_NEEDS_EXCEL };
    case "biz-registration":
      return parseBizRegistration(textOf(body));
    case "financial-statement":
    case "vat-return":
      return parseFinancial(body, docType);
    case "employment-insurance":
      return parseEmployment(body);
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
  if (!aiReader) return { result: refused(display, "needs-text-pdf", NEEDS_TEXT_PDF) };
  let fields: DocumentFields;
  try {
    fields = sanitizeAiFields(await aiReader({ name: display, bytes }));
  } catch {
    // 오류 글에 파일 속 정보가 섞일 수 있어 그대로 내보내지 않는다.
    return { result: refused(display, "failed", AI_FAILED) };
  }
  const keys = Object.keys(fields) as DocumentFileResult["fields"];
  if (keys.length === 0) return { result: refused(display, "no-fields", AI_EMPTY) };
  return {
    result: { name: display, docType: "unknown", status: "read-by-ai", fields: keys },
    merge: { name: display, docType: "unknown", fields },
  };
}

async function readOne(
  base: string,
  display: string,
  bytes: Uint8Array,
  aiReader: ReadDocumentsOptions["aiReader"],
): Promise<ReadOne> {
  const extracted = await extractDocumentText(base, bytes);
  if (extracted.kind === "unsupported") return { result: refused(display, "unsupported", extracted.reason) };
  if (extracted.kind === "image") return readImage(display, bytes, aiReader);

  const body: DocumentBody =
    extracted.kind === "text" ? { text: extracted.text } : { sheets: extracted.sheets };
  const docType = classifyDocument({ fileName: base, ...body });
  const parsed = parseByType(docType, body);
  if (!parsed) return { result: { ...refused(display, "no-fields", UNKNOWN_DOC), docType } };

  const keys = Object.keys(parsed.fields) as DocumentFileResult["fields"];
  if (keys.length === 0) {
    return { result: { ...refused(display, "no-fields", parsed.note ?? NO_FIELDS), docType } };
  }
  const result: DocumentFileResult = { name: display, docType, status: "read", fields: keys };
  if (parsed.year !== undefined) result.year = parsed.year;
  const merge: MergeInput = { name: display, docType, fields: parsed.fields };
  if (parsed.year !== undefined) merge.year = parsed.year;
  return { result, merge };
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
  const results: DocumentFileResult[] = [];
  const inputs: MergeInput[] = [];
  let total = 0;

  for (let i = 0; i < files.length; i++) {
    const base = baseNameOf(String(files[i]?.name ?? ""));
    const display = displayNameOf(base);
    try {
      const bytes = files[i].bytes;
      const size = bytes.byteLength;
      if (i >= limits.maxFiles) {
        results.push(refused(display, "failed", LIMIT_MESSAGE.tooMany));
      } else if (size > limits.maxFileBytes) {
        results.push(refused(display, "too-large", LIMIT_MESSAGE.tooLarge));
      } else if (total + size > limits.maxTotalBytes) {
        results.push(refused(display, "too-large", LIMIT_MESSAGE.totalTooLarge));
      } else {
        total += size;
        const read = await readOne(base, display, bytes, opts.aiReader);
        results.push(read.result);
        if (read.merge) inputs.push(read.merge);
      }
    } catch {
      results.push(refused(display, "failed", READ_FAILED));
    }
  }

  return { ...mergeDocumentFields(inputs), files: results };
}
