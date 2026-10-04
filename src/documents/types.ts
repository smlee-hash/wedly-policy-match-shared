/**
 * 서류 올려 회사 정보 채우기 — 서버(서류 읽기)와 화면(ProfileForm)이 함께 쓰는 결과 모양.
 * 화면 쪽은 이 파일의 타입만 가져온다(서류 읽기 코드는 서버 전용이라 화면에서 import 하지 않는다).
 */
import type { BusinessProfile } from "../engine/match-engine";

/**
 * 서류에서 채울 수 있는 칸. BusinessProfile 칸 이름을 그대로 쓴다. 신용점수·기존 대출·상호는 서류로 채우지 않는다.
 * - hasCert·hasPatent 는 서류가 「없음」을 분명히 말할 때만 채운다(있는 쪽은 certTypes·patentCount 가 알려 준다).
 * - businessAddress 는 **시도 + 시군구까지만**(예: 「경기 화성시」). 도로명·번지·건물명은 결과에 담지 않는다.
 */
export type DocumentFieldKey =
  | "bizno"
  | "industry"
  | "region"
  | "regionSigungu"
  | "businessAddress"
  | "foundedDate"
  | "lastYearRevenueKrw"
  | "employeeCount"
  | "companyScale"
  | "isCorporation"
  | "taxDelinquent"
  | "hasCert"
  | "certTypes"
  | "hasPatent"
  | "patentCount";

/** 서류에서 읽은 칸 값 묶음. */
export type DocumentFields = Partial<Pick<BusinessProfile, DocumentFieldKey>>;

/**
 * aiReader(사진·스캔본을 AI 로 읽는 함수)가 돌려주는 값 — 칸 값 묶음 + 선택 값 personNames.
 * - personNames: AI 가 사진에서 본 대표자·직원 이름. **결과 칸에는 넣지 않고** 같은 서류 묶음 모든 서류의
 *   업종 글에서 그 이름을 지우는 데만 쓴다. 앱의 AI 지시문은 이름을 여기에만 담게 한다(업종 칸에 적지 않게).
 */
export type AiReaderResult = DocumentFields & { personNames?: string[] };

/** 읽을 수 있는 서류 종류. unknown = 어떤 서류인지 못 가림. */
export type DocumentType =
  | "company-status"        // 기업상태표(엑셀)
  | "biz-registration"      // 사업자등록증·사업자등록증명
  | "financial-statement"   // 재무제표(표준재무제표증명 포함)
  | "vat-return"            // 부가가치세 신고서·과세표준증명
  | "employment-insurance"  // 고용·산재보험 신고서·가입자명부
  | "unknown";

/** 화면에 보여 줄 서류 종류 이름. */
export const DOCUMENT_TYPE_LABEL: Record<DocumentType, string> = {
  "company-status": "기업상태표",
  "biz-registration": "사업자등록증",
  "financial-statement": "재무제표",
  "vat-return": "부가세 신고서",
  "employment-insurance": "고용보험 신고서",
  unknown: "모르는 서류",
};

/**
 * 파일 하나를 읽은 결과.
 * - read: 글자를 읽어 칸을 하나 이상 찾았다
 * - no-fields: 읽었지만 채울 칸이 없었다
 * - needs-text-pdf: 사진·스캔본인데 이 앱은 AI로 읽지 않는다(랩) — 「글자 있는 PDF로 올려 주세요」
 * - read-by-ai: 사진·스캔본을 앱이 넘긴 AI 읽기로 읽었다(ERP·컨설턴트 앱)
 * - unsupported: 읽을 수 없는 형식(hwp 등)
 * - too-large: 크기 제한 초과
 * - failed: 읽다가 실패
 */
export type DocumentFileStatus =
  | "read"
  | "no-fields"
  | "needs-text-pdf"
  | "read-by-ai"
  | "unsupported"
  | "too-large"
  | "failed";

export interface DocumentFileResult {
  /** 올린 파일 이름(화면 표시용, 경로 없이 이름만) */
  name: string;
  docType: DocumentType;
  status: DocumentFileStatus;
  /** 서류 기준 연도(재무제표·부가세 등). 모르면 없음 */
  year?: number;
  /** 사람에게 보여 줄 짧은 한국어 안내(상태가 read 가 아닐 때) */
  message?: string;
  /** 이 파일에서 찾은 칸 이름들 */
  fields: DocumentFieldKey[];
}

/** 한 칸의 값과 그 값을 준 서류. */
export interface DocumentFieldSource {
  /** 값을 준 파일 이름들(같은 값을 준 서류가 여럿이면 모두) */
  files: string[];
  docTypes: DocumentType[];
}

/** 서류끼리 값이 다른 칸. options 는 서로 다른 값마다 하나, recommended 는 처음 골라 둘 값의 순번. */
export interface DocumentFieldConflict<K extends DocumentFieldKey = DocumentFieldKey> {
  field: K;
  options: { value: NonNullable<BusinessProfile[K]>; files: string[]; docTypes: DocumentType[]; year?: number }[];
  recommended: number;
}

/** 서버 응답 data 모양: POST {documentPrefill} → { success: true, data: DocumentPrefillResult } */
export interface DocumentPrefillResult {
  /** 충돌 없는 칸은 값, 충돌 칸은 recommended 값 */
  fields: DocumentFields;
  sources: Partial<Record<DocumentFieldKey, DocumentFieldSource>>;
  conflicts: DocumentFieldConflict[];
  files: DocumentFileResult[];
  /** 고객 자료에 원본을 붙였으면 true(ERP·컨설턴트 앱에서 고객을 불러온 상태일 때만) */
  attachedToCustomer?: boolean;
}

/** 서류 올리기 제한 — 서버와 화면이 같은 값을 쓴다. */
export const DOCUMENT_UPLOAD_LIMITS = {
  maxFiles: 10,
  maxFileBytes: 20 * 1024 * 1024,
  maxTotalBytes: 50 * 1024 * 1024,
  acceptExtensions: [".pdf", ".xlsx", ".xls", ".csv", ".docx", ".hwpx", ".pptx", ".txt", ".jpg", ".jpeg", ".png", ".webp"],
} as const;
