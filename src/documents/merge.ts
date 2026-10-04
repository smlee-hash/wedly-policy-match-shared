// 서류마다 읽은 칸을 칸별로 합친다 — 순수 함수(저장·네트워크·AI 없음).
//
// 칸마다: 값이 모두 같으면 값 하나 + 출처(파일 이름·종류)를 모두 적는다.
//         값이 다르면 conflicts 에 값마다 한 줄을 적고, fields 에는 추천 값을 넣는다.
// 추천 = 연도가 가장 최근인 값. 연도가 같거나 없으면 서류 우선순위(사업자등록증 > 재무제표·부가세 > 고용보험 > 기업상태표).
//   연도가 있는 값은 연도 없는 값보다 앞선다. 우선순위도 같으면 먼저 올린 쪽.
// ★입력 객체는 바꾸지 않는다(배열 값은 복사해서 담는다).

import type {
  DocumentFieldConflict,
  DocumentFieldKey,
  DocumentFieldSource,
  DocumentFields,
  DocumentPrefillResult,
  DocumentType,
} from "./types";

/** 합칠 서류 하나: 어느 파일에서 무슨 종류로 읽은 칸들인가. year 는 서류 기준 연도. */
export interface MergeInput {
  name: string;
  docType: DocumentType;
  fields: DocumentFields;
  year?: number;
}

export type MergeResult = Pick<DocumentPrefillResult, "fields" | "sources" | "conflicts">;

/** DocumentFieldKey 를 하나라도 빠뜨리면 타입 검사가 막는다(satisfies). */
export const DOCUMENT_FIELD_KEYS = Object.keys({
  bizno: true,
  industry: true,
  region: true,
  regionSigungu: true,
  businessAddress: true,
  foundedDate: true,
  lastYearRevenueKrw: true,
  employeeCount: true,
  companyScale: true,
  isCorporation: true,
  taxDelinquent: true,
  hasCert: true,
  certTypes: true,
  hasPatent: true,
  patentCount: true,
} satisfies Record<DocumentFieldKey, true>) as DocumentFieldKey[];

/** 서류 우선순위 — 작을수록 앞선다. */
const DOC_RANK: Record<DocumentType, number> = {
  "biz-registration": 0,
  "financial-statement": 1,
  "vat-return": 1,
  "employment-insurance": 2,
  "company-status": 3,
  unknown: 4,
};

interface Group {
  value: unknown;
  files: string[];
  docTypes: DocumentType[];
  year?: number;
  rank: number;
  order: number;
}

function isEmpty(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "string") return value.trim() === "";
  return false;
}

/** 같은 값인지 가르는 열쇠. 배열은 순서를 무시하고, 글은 공백 차이를 무시한다. */
function keyOf(value: unknown): string {
  if (Array.isArray(value)) return `list:${JSON.stringify(value.map(String).sort())}`;
  if (typeof value === "string") return `text:${value.normalize("NFC").trim().replace(/\s+/g, " ")}`;
  return `${typeof value}:${JSON.stringify(value)}`;
}

function cloneValue<T>(value: T): T {
  return (Array.isArray(value) ? [...value] : value) as T;
}

function pushUnique<T>(list: T[], item: T) {
  if (!list.includes(item)) list.push(item);
}

/** a 가 b 보다 앞서면 음수. 연도(있는 쪽·최근 쪽) → 서류 우선순위 → 먼저 올린 쪽. */
function byRecommendation(a: Group, b: Group): number {
  if (a.year !== b.year) {
    if (a.year === undefined) return 1;
    if (b.year === undefined) return -1;
    return b.year - a.year;
  }
  return a.rank - b.rank || a.order - b.order;
}

export function mergeDocumentFields(inputs: MergeInput[]): MergeResult {
  const fields: DocumentFields = {};
  const sources: Partial<Record<DocumentFieldKey, DocumentFieldSource>> = {};
  const conflicts: DocumentFieldConflict[] = [];

  for (const key of DOCUMENT_FIELD_KEYS) {
    const groups = new Map<string, Group>();
    for (const input of inputs) {
      const value = (input.fields as Record<string, unknown>)[key];
      if (isEmpty(value)) continue;
      const k = keyOf(value);
      let group = groups.get(k);
      if (!group) {
        group = { value, files: [], docTypes: [], rank: DOC_RANK[input.docType], order: groups.size };
        groups.set(k, group);
      }
      pushUnique(group.files, input.name);
      pushUnique(group.docTypes, input.docType);
      group.rank = Math.min(group.rank, DOC_RANK[input.docType]);
      if (input.year !== undefined) group.year = Math.max(group.year ?? input.year, input.year);
    }
    if (groups.size === 0) continue;

    const list = [...groups.values()];
    const best = [...list].sort(byRecommendation)[0];
    (fields as Record<string, unknown>)[key] = cloneValue(best.value);
    sources[key] = { files: [...best.files], docTypes: [...best.docTypes] };

    if (list.length > 1) {
      conflicts.push({
        field: key,
        options: list.map((g) => ({
          value: cloneValue(g.value) as NonNullable<DocumentFields[DocumentFieldKey]>,
          files: [...g.files],
          docTypes: [...g.docTypes],
          ...(g.year === undefined ? {} : { year: g.year }),
        })),
        recommended: list.indexOf(best),
      });
    }
  }
  return { fields, sources, conflicts };
}
