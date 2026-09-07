/**
 * 돌파구 근거 조각의 형 두 가지 — **ERP `src/lib/services/policy-match/tacit-search.ts:7-13`
 * 원문과 글자 단위로 같다.** 그 파일은 `prisma`·상담 자료실 검색을 물고 있어 이 보관함이
 * 통째로 가져올 수 없다. 형만 여기로 떼어 두고, ERP 쪽은 이 파일을 재수출한다 —
 * 그래야 두 곳이 조용히 갈라지지 않는다(랩 앱엔 자료실이 아예 없다).
 */
export type TacitSourceKind = "자료실" | "고객이력" | "통화";
export interface TacitSnippet {
  kind: TacitSourceKind;
  ref: string;
  text: string;
  url?: string | null;
}
