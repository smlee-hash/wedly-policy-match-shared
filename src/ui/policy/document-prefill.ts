// 서류 올리기 칸의 글자·계산 모음 — 화면(ProfileForm·DocumentUploadBox)과 시험이 같은 함수를 쓴다. 저장·통신은 없다.
// 서버가 돌려준 읽은 결과(DocumentPrefillResult)를 화면 칸에 합치는 규칙이 여기 있다.
import type { BusinessProfile } from "../../engine/match-engine";
import {
  DOCUMENT_TYPE_LABEL,
  DOCUMENT_UPLOAD_LIMITS,
  type DocumentFieldConflict,
  type DocumentFieldKey,
  type DocumentFileResult,
  type DocumentPrefillResult,
  type DocumentType,
} from "../../documents/types";
import { manwonToKorean } from "./profile-field-format";

type Value = NonNullable<BusinessProfile[DocumentFieldKey]>;

/** 화면 칸 열쇠 — ProfileForm 의 data-k 와 같다(서류 칸 이름이 아니라 화면에 보이는 칸 단위). */
export type FormFieldKey =
  | "bizno" | "corp" | "industry" | "address" | "founded" | "revenue"
  | "employees" | "scale" | "tax" | "cert" | "patent";

/** 서류 칸 이름 → 그 값이 들어가는 화면 칸. 주소(세 칸)·인증(두 칸)·특허(두 칸)는 화면에서 한 칸이다. */
const FORM_FIELD_OF: Record<DocumentFieldKey, FormFieldKey> = {
  bizno: "bizno",
  industry: "industry",
  region: "address",
  regionSigungu: "address",
  businessAddress: "address",
  foundedDate: "founded",
  lastYearRevenueKrw: "revenue",
  employeeCount: "employees",
  companyScale: "scale",
  isCorporation: "corp",
  taxDelinquent: "tax",
  hasCert: "cert",
  certTypes: "cert",
  hasPatent: "patent",
  patentCount: "patent",
};

export function formFieldOf(key: DocumentFieldKey): FormFieldKey {
  return FORM_FIELD_OF[key];
}

/** 화면 칸 이름표 — 고르는 상자 제목에 쓴다. */
const FORM_FIELD_LABEL: Record<FormFieldKey, string> = {
  bizno: "사업자번호",
  corp: "법인·개인",
  industry: "주업종",
  address: "사업장 주소",
  founded: "설립일(개업일)",
  revenue: "작년 연매출",
  employees: "직원 수",
  scale: "기업 규모",
  tax: "세금·4대보험 체납",
  cert: "보유 인증",
  patent: "특허·지재권",
};

export function fieldLabelOf(key: DocumentFieldKey): string {
  return FORM_FIELD_LABEL[FORM_FIELD_OF[key]];
}

/**
 * 「있다·없다」 한 줄만 말해 주는 칸 — 칸이 비어 있을 때만 채우고, 이미 값이 있으면 건드리지도 충돌로 보이지도 않는다.
 * 시도·시군구는 주소 글자가 정하고, hasCert·hasPatent 는 종류·건수 칸이 정한다.
 */
const WEAK_KEYS: readonly DocumentFieldKey[] = ["region", "regionSigungu", "hasCert", "hasPatent"];

/** 서류 값 모양 끼리 같은가 — 배열은 순서 없이, 매출은 만원 단위로(화면 칸이 만원이라) 견준다. */
export function sameFieldValue(key: DocumentFieldKey, a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && [...a].sort().join("\u0000") === [...b].sort().join("\u0000");
  }
  if (key === "lastYearRevenueKrw" && typeof a === "number" && typeof b === "number") {
    return Math.round(a / 10_000) === Math.round(b / 10_000);
  }
  return a === b;
}

/** 칸이 비어 있는가 — 주소가 있으면 시도·시군구도, 종류·건수가 있으면 있음·없음도 채워진 것으로 본다. */
function isEmptyField(key: DocumentFieldKey, current: BusinessProfile): boolean {
  switch (key) {
    case "region":
    case "regionSigungu":
      return current[key] === undefined && current.businessAddress === undefined;
    case "hasCert":
      return current.hasCert === undefined && current.certTypes === undefined;
    case "hasPatent":
      return current.hasPatent === undefined && current.patentCount === undefined;
    default:
      return current[key] === undefined;
  }
}

/** 고르는 상자 하나 — 서류끼리 다르거나, 사람이 고친 값과 서류 값이 다른 칸. */
export interface DocumentChoice {
  field: DocumentFieldKey;
  /** 사람이 직접 넣은(고친) 값. 서류끼리만 다른 칸이면 없다 */
  hand?: Value;
  /** 서류가 말한 값들(서류끼리 다르면 값마다 하나) */
  options: DocumentFieldConflict["options"];
  /** 처음 골라 둔 값의 순번. 사람이 고친 칸이라 아무것도 안 골랐으면 -1 */
  recommended: number;
}

export interface DocumentApplyOutcome {
  /** 칸을 채운 새 프로필 — 입력 객체는 바꾸지 않는다 */
  next: BusinessProfile;
  /** 이번에 서류 값으로 채우거나 바꾼 칸 */
  filled: DocumentFieldKey[];
  /** 채운 칸의 출처 서류 종류(칸 옆 출처 칩) */
  origins: Partial<Record<DocumentFieldKey, DocumentType[]>>;
  /** 어느 값을 쓸지 물어볼 칸 */
  choices: DocumentChoice[];
}

/**
 * 서류를 읽은 결과를 현재 칸에 합친다 — 순수 함수.
 *  · 비어 있던 칸은 서류 값으로 채운다(서류끼리 다른 칸은 추천 값).
 *  · 사람이 손으로 고친 칸(touched)은 덮지 않는다. 서류 값이 다르면 고르는 상자(choices)로 돌려준다.
 *    화면에 쓰던 글자가 진단용 값으로는 덜 찼어도(10자리 못 채운 사업자번호) `current` 에 원문으로 담아 오면 그 값을 지킨다.
 *    다시 비워 둔 칸(담긴 값 없음)은 빈 칸이라 채운다.
 *  · 서류끼리 다른 칸은 서버가 준 conflicts 를 그대로 고르는 상자로 돌려준다.
 *  · 서류에 없는 칸은 건드리지 않는다. 기존 값을 비우지 않는다.
 *  · 손으로 고치지 않았는데 값이 있는 칸(불러온 고객 값·앞 서류 값)은 더 나중에 읽은 서류 값으로 바뀐다.
 */
export function applyDocumentFields(
  current: BusinessProfile,
  result: DocumentPrefillResult,
  touched: ReadonlySet<DocumentFieldKey>,
): DocumentApplyOutcome {
  const next: BusinessProfile = { ...current };
  if (current.certTypes) next.certTypes = [...current.certTypes];
  if (current.orgTypes) next.orgTypes = [...current.orgTypes];

  const filled: DocumentFieldKey[] = [];
  const origins: Partial<Record<DocumentFieldKey, DocumentType[]>> = {};
  const choices: DocumentChoice[] = [];
  const conflictOf = new Map<DocumentFieldKey, DocumentFieldConflict>(result.conflicts.map((c) => [c.field, c] as const));

  const fill = (key: DocumentFieldKey, value: Value) => {
    (next as Record<string, unknown>)[key] = Array.isArray(value) ? [...value] : value;
    filled.push(key);
    const conflict = conflictOf.get(key);
    origins[key] = conflict
      ? [...(conflict.options[conflict.recommended]?.docTypes ?? [])]
      : [...(result.sources[key]?.docTypes ?? [])];
  };

  for (const key of Object.keys(result.fields) as DocumentFieldKey[]) {
    const docValue = result.fields[key] as Value | undefined;
    if (docValue === undefined) continue;
    const conflict = conflictOf.get(key);
    const weak = WEAK_KEYS.includes(key);

    // 손으로 만진 칸이 빈 칸 검사보다 먼저다 — 사람이 쓰던 칸이면 「비어 있다」로 보고 채우지 않는다.
    // 진단용 값이 덜 찬 입력(사업자번호 3자리 등)의 원문은 부르는 쪽이 current 에 담아 주므로 그 값을 지킨다.
    // 담긴 값이 아예 없으면 사람이 비워 둔 칸이라 아래에서 비어 있는 칸으로 채운다.
    const cur = current[key] as Value | undefined;
    if (touched.has(key)) {
      if (weak) continue; // 있다·없다 한 줄은 충돌로 보이지 않는다 — 사람이 만졌으면 건드리지도 않는다
      if (cur !== undefined) {
        // 덮지 않는다. 서류 값이 다르거나 서류끼리 다르면 고르게 한다.
        const options = conflict
          ? conflict.options
          : [{ value: docValue, files: result.sources[key]?.files ?? [], docTypes: result.sources[key]?.docTypes ?? [] }];
        const same = options.findIndex((o) => sameFieldValue(key, o.value, cur));
        if (!conflict && same >= 0) continue; // 서류도 같은 값이라 물을 것이 없다
        choices.push(
          same >= 0
            ? { field: key, options, recommended: same } // 손 값이 서류 값 하나와 같다 — 그 값이 골라진 것으로 본다
            : { field: key, hand: cur, options, recommended: -1 },
        );
        continue;
      }
    }

    if (isEmptyField(key, current)) {
      fill(key, docValue);
      if (conflict && !weak) choices.push({ field: key, options: conflict.options, recommended: conflict.recommended });
      continue;
    }
    if (weak) continue; // 이미 주소·종류·건수가 있다 — 있다·없다 한 줄은 거기에 맡긴다

    if (!sameFieldValue(key, cur, docValue)) fill(key, docValue);
    if (conflict) choices.push({ field: key, options: conflict.options, recommended: conflict.recommended });
  }

  return { next, filled, origins, choices };
}

// ── 값·서류 이름을 사람 말로 ────────────────────────────────────────────

/** 서류가 준 값을 사람이 읽는 말로 — 「8명」「12억 4,500만원」「법인」. */
export function fieldValueText(key: DocumentFieldKey, value: unknown): string {
  switch (key) {
    case "employeeCount":
      return `${value}명`;
    case "patentCount":
      return `${value}건`;
    case "lastYearRevenueKrw":
      return typeof value === "number" ? manwonToKorean(Math.round(value / 10_000)) : String(value);
    case "isCorporation":
      return value === true ? "법인" : "개인";
    case "taxDelinquent":
      return value === true ? "있음" : "없음";
    case "hasCert":
      return value === true ? "인증 있음" : "인증 없음";
    case "hasPatent":
      return value === true ? "특허 있음" : "특허 없음";
    case "certTypes":
      return Array.isArray(value) ? value.join(", ") : String(value);
    default:
      return String(value);
  }
}

/** 값 단추 글자 — 「8명 · 기업상태표(2026)」. 같은 값을 준 서류가 여럿이면 이름을 모두 보인다. */
export function choiceOptionLabel(key: DocumentFieldKey, option: DocumentFieldConflict["options"][number]): string {
  const names = [...new Set(option.docTypes.map((t) => DOCUMENT_TYPE_LABEL[t]))].join(", ");
  const source = names ? ` · ${names}${option.year ? `(${option.year})` : ""}` : "";
  return `${fieldValueText(key, option.value)}${source}`;
}

/** 칸 옆 출처 칩 글자 — 서류 종류 이름(여럿이면 가운뎃점으로). 출처를 모르면 빈 글자. */
export function originChipText(types: readonly DocumentType[] | undefined): string {
  return [...new Set((types ?? []).map((t) => DOCUMENT_TYPE_LABEL[t]))].join("·");
}

/** 고르는 상자 제목 — 「직원 수 서류마다 달라요 — 어느 값을 쓸까요?」. */
export function choiceTitle(choice: DocumentChoice): string {
  const label = fieldLabelOf(choice.field);
  return choice.options.length >= 2
    ? `${label} 서류마다 달라요 — 어느 값을 쓸까요?`
    : `${label} 서류와 직접 넣은 값이 달라요 — 어느 값을 쓸까요?`;
}

// ── 올리기 전 검사·올린 파일 목록 ───────────────────────────────────────

const MB = 1024 * 1024;

/**
 * 고른 파일이 제한을 넘는지 서버에 보내기 전에 화면에서 먼저 본다.
 * 넘으면 쉬운 한국어 안내를, 괜찮으면 null 을 돌려준다(고른 것이 없어도 null).
 */
export function checkUploadSelection(files: readonly { name: string; size: number }[]): string | null {
  const { maxFiles, maxFileBytes, maxTotalBytes } = DOCUMENT_UPLOAD_LIMITS;
  if (files.length === 0) return null;
  if (files.length > maxFiles) {
    return `한 번에 ${maxFiles}개까지 올릴 수 있어요. 지금 ${files.length}개를 골랐어요 — ${maxFiles}개 이하로 나눠서 올려 주세요`;
  }
  const big = files.filter((f) => f.size > maxFileBytes);
  if (big.length > 0) {
    const shown = big.slice(0, 3).map((f) => `「${f.name}」`).join(", ");
    const more = big.length > 3 ? ` 외 ${big.length - 3}개` : "";
    return `${shown}${more}은(는) 20MB가 넘어요 — 파일당 ${maxFileBytes / MB}MB까지 올릴 수 있어요. 파일을 줄이거나 빼고 올려 주세요`;
  }
  if (files.reduce((sum, f) => sum + f.size, 0) > maxTotalBytes) {
    return `합쳐서 ${maxTotalBytes / MB}MB가 넘어요 — 나눠서 올려 주세요`;
  }
  return null;
}

/** 올린 파일 목록의 형식 표식. */
export type FileKind = "PDF" | "XLS" | "HWP" | "DOC" | "IMG" | "FILE";

export function fileKindOf(name: string): FileKind {
  const ext = name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";
  if (ext === "pdf") return "PDF";
  if (["xlsx", "xls", "csv"].includes(ext)) return "XLS";
  if (["hwpx", "hwp"].includes(ext)) return "HWP";
  if (["docx", "pptx", "txt"].includes(ext)) return "DOC";
  if (["jpg", "jpeg", "png", "webp"].includes(ext)) return "IMG";
  return "FILE";
}

/** 올린 파일 한 줄의 상태 문구 — 읽었으면 「N칸 채움」, 아니면 서버 안내 문구(없으면 쉬운 기본 문구). */
export function fileStatusText(file: DocumentFileResult): string {
  if (file.status === "read" || file.status === "read-by-ai") return `${file.fields.length}칸 채움`;
  if (file.message) return file.message;
  switch (file.status) {
    case "needs-text-pdf":
      return "사진이라 못 읽어요 — 글자 있는 PDF로 올려 주세요";
    case "unsupported":
      return "읽을 수 없는 형식이에요";
    case "too-large":
      return `크기가 너무 커요 — 파일당 ${DOCUMENT_UPLOAD_LIMITS.maxFileBytes / MB}MB까지예요`;
    case "failed":
      return "읽지 못했어요 — 다시 올려 주세요";
    default:
      return file.docType === "unknown" ? "모르는 서류" : "채울 칸을 못 찾았어요";
  }
}

/** 올리는 칸에 보이는 형식 카드 다섯 — 시안 그대로. */
export const FORMAT_CARDS: readonly { kind: FileKind; name: string; exts: string }[] = [
  { kind: "PDF", name: "PDF", exts: ".pdf" },
  { kind: "XLS", name: "엑셀", exts: ".xlsx .xls" },
  { kind: "HWP", name: "한글", exts: ".hwpx" },
  { kind: "DOC", name: "워드", exts: ".docx" },
  { kind: "IMG", name: "사진", exts: ".jpg .png" },
];

/** 「이런 서류를 읽어요」 칩 다섯 — 읽을 수 있는 서류 종류 이름(모르는 서류는 뺀다). */
export const READABLE_DOCUMENT_LABELS: readonly string[] = (
  Object.keys(DOCUMENT_TYPE_LABEL) as DocumentType[]
)
  .filter((t) => t !== "unknown")
  .map((t) => DOCUMENT_TYPE_LABEL[t]);
