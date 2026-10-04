// 돌려주기 직전에 결과 전체에서 서류 묶음이 알려 준 사람 이름을 지운다 — 이름 지우기의 맨 마지막 한 곳.
//
// 서류 파서·AI 거르개는 묶음의 이름을 다 모르는 채로 일하므로 업종을 40자로 자르지 않는다(자르면 이름 조각이 남는다).
// 이 함수가 묶음 전체의 이름이 모인 뒤 다음을 한다.
//  - 업종(fields·충돌 선택지): 이름을 지운 **뒤에** 40자로 자르고 앞뒤 구분표를 정리한다. 지우고 나면 같아지는 값은 한 값으로 합친다.
//  - 파일 이름(sources·충돌 선택지·files 의 name·message): 이름을 「○○○」로 바꾼다(파일 이름 자체는 남긴다).
//  - 이름을 지워 업종이 사라진 파일은 칸 목록에서 업종을 빼고, 칸이 하나도 안 남으면 「채울 값 없음」으로 바꾼다.
// ★입력 객체는 바꾸지 않는다.

import { cleanIndustryText, INDUSTRY_MAX_CHARS, personNameRegex } from "./clean-text";
import type {
  DocumentFieldConflict,
  DocumentFieldKey,
  DocumentFieldSource,
  DocumentFileResult,
  DocumentPrefillResult,
  DocumentType,
} from "./types";

/** 파일 이름 속 사람 이름을 바꾸는 글 */
export const NAME_MASK = "○○○";

interface IndustryGroup {
  value: string;
  files: string[];
  docTypes: DocumentType[];
  year?: number;
}

/**
 * 결과 전체에서 `names` 를 지운다. 이름이 하나도 없어도 업종 40자 자르기는 여기서 한다.
 * `emptyMessageOf` 는 이름을 지워 칸이 하나도 안 남은 파일에 보여 줄 안내를 정한다.
 */
export function redactKnownNames(
  result: DocumentPrefillResult,
  names: readonly string[],
  emptyMessageOf: (file: DocumentFileResult) => string,
): DocumentPrefillResult {
  const remover = personNameRegex(names);
  const mask = (text: string): string => (remover ? text.replace(remover, NAME_MASK) : text);
  const maskAll = (files: readonly string[]): string[] => [...new Set(files.map(mask))];

  // 업종 값 묶음: 충돌이면 선택지마다, 아니면 확정 값 하나(출처와 함께).
  const conflictAt = result.conflicts.findIndex((c) => c.field === "industry");
  const conflict = conflictAt >= 0 ? result.conflicts[conflictAt] : undefined;
  const confirmed = result.fields.industry;
  const source = result.sources.industry ?? { files: [], docTypes: [] };
  const groups: Array<Omit<IndustryGroup, "value"> & { value: unknown }> = conflict
    ? conflict.options
    : typeof confirmed === "string"
      ? [{ value: confirmed, files: source.files, docTypes: source.docTypes }]
      : [];

  const fields = { ...result.fields };
  const sources: Partial<Record<DocumentFieldKey, DocumentFieldSource>> = { ...result.sources };
  const conflicts: DocumentFieldConflict[] = result.conflicts.filter((c) => c.field !== "industry");
  const keptFiles = new Set<string>();
  const droppedFiles = new Set<string>();

  if (groups.length > 0) {
    const kept: IndustryGroup[] = [];
    // 처음 선택지 번호 → 합친 뒤 번호(이름만 남아 사라진 값은 -1)
    const keptIndex: number[] = [];
    for (const group of groups) {
      const text = cleanIndustryText(group.value, INDUSTRY_MAX_CHARS, names);
      if (text === null) {
        for (const f of group.files) droppedFiles.add(f);
        keptIndex.push(-1);
        continue;
      }
      for (const f of group.files) keptFiles.add(f);
      let at = kept.findIndex((k) => k.value === text);
      if (at < 0) {
        at = kept.length;
        kept.push({ value: text, files: [], docTypes: [] });
      }
      const into = kept[at];
      for (const f of group.files) if (!into.files.includes(f)) into.files.push(f);
      for (const t of group.docTypes) if (!into.docTypes.includes(t)) into.docTypes.push(t);
      if (group.year !== undefined) into.year = Math.max(into.year ?? group.year, group.year);
      keptIndex.push(at);
    }

    if (kept.length === 0) {
      delete fields.industry;
      delete sources.industry;
    } else {
      // 처음 추천 값이 남았으면 그 값, 사라졌으면 연도가 가장 최근인(없으면 먼저 온) 값.
      const first = keptIndex[conflict?.recommended ?? 0] ?? -1;
      const newest = kept.reduce((best, g, i) => ((g.year ?? -1) > (kept[best].year ?? -1) ? i : best), 0);
      const recommended = first >= 0 ? first : newest;
      fields.industry = kept[recommended].value;
      sources.industry = { files: [...kept[recommended].files], docTypes: [...kept[recommended].docTypes] };
      if (kept.length > 1) {
        conflicts.splice(conflictAt >= 0 ? conflictAt : conflicts.length, 0, {
          field: "industry",
          options: kept.map((g) => ({
            value: g.value,
            files: [...g.files],
            docTypes: [...g.docTypes],
            ...(g.year === undefined ? {} : { year: g.year }),
          })),
          recommended,
        });
      }
    }
  }

  // 파일 이름은 모든 출처·충돌 선택지에서 한꺼번에 바꾼다.
  for (const key of Object.keys(sources) as DocumentFieldKey[]) {
    const s = sources[key];
    if (s) sources[key] = { ...s, files: maskAll(s.files) };
  }
  const maskedConflicts = conflicts.map((c) => ({
    ...c,
    options: c.options.map((o) => ({ ...o, files: maskAll(o.files) })),
  })) as DocumentFieldConflict[];

  const files = result.files.map((file): DocumentFileResult => {
    const lostIndustry = file.fields.includes("industry") && droppedFiles.has(file.name) && !keptFiles.has(file.name);
    let out: DocumentFileResult = lostIndustry ? { ...file, fields: file.fields.filter((k) => k !== "industry") } : { ...file };
    if (lostIndustry && out.fields.length === 0) {
      out = { name: file.name, docType: file.docType, status: "no-fields", message: emptyMessageOf(file), fields: [] };
    }
    out.name = mask(out.name);
    if (out.message !== undefined) out.message = mask(out.message);
    return out;
  });

  return { ...result, fields, sources, conflicts: maskedConflicts, files };
}
