import type { BoardRow } from "./types";

export interface ValidateCtx {
  expectMinRows?: number;   // 목록 1쪽 최소 기대 행수
  prevCount: number;        // 직전 저장된 open 건수(급락 판정용)
  allowUndated?: boolean;   // 날짜 없는 행이 대부분이어도 통과(BoardConfig.allowUndatedRows)
}
export interface ValidateResult { ok: boolean; reason?: string }

const HEADER_WORDS = ["공지", "공지사항", "목록", "검색", "제목", "번호", "더보기", "전체", "리스트"];
const DATE_RE = /(20\d{2})[.\-/](1[0-2]|0?[1-9])[.\-/](3[01]|[12]\d|0?[1-9])(?!\d)/;

/** 어느 추출 단계 결과든 저장 전 반드시 통과. 하나라도 어기면 채택하지 않는다. */
export function validateRows(rows: BoardRow[], ctx: ValidateCtx): ValidateResult {
  if (rows.length === 0) return { ok: false, reason: "행 0개" };
  if (ctx.expectMinRows && rows.length < ctx.expectMinRows)
    return { ok: false, reason: `행 ${rows.length} < 기대 ${ctx.expectMinRows}` };
  if (ctx.prevCount >= 10 && rows.length < ctx.prevCount / 2)
    return { ok: false, reason: `급락 ${rows.length} < 직전 ${ctx.prevCount} 절반` };

  const titled = rows.filter((r) => r.title.trim().length >= 4 && !HEADER_WORDS.includes(r.title.trim()));
  if (titled.length < Math.max(1, Math.ceil(rows.length * 0.6)))
    return { ok: false, reason: "제목 대부분이 비었거나 머리글" };

  const linked = rows.filter((r) => /^https?:\/\/.+/.test(r.detailUrl));
  if (linked.length < Math.max(1, Math.ceil(rows.length * 0.6)))
    return { ok: false, reason: "링크가 상세 주소 모양 아님" };

  // E5: 비어있지 않은 detailUrl 고유값 비율 < 0.5 → 상세주소 퇴화(전 행이 같은 JS 해시 등)
  const nonemptyUrls = rows.map((r) => r.detailUrl.trim()).filter((u) => u.length > 0);
  const uniqueUrls = new Set(nonemptyUrls);
  if (uniqueUrls.size / rows.length < 0.5)
    return { ok: false, reason: "상세주소 퇴화" };

  const dated = rows.filter((r) => DATE_RE.test(r.dateText));
  if (!ctx.allowUndated && dated.length < Math.max(1, Math.ceil(rows.length * 0.3)))
    return { ok: false, reason: "날짜가 있는 행이 부족" };

  return { ok: true };
}

export { DATE_RE };
