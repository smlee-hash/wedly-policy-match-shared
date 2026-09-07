/**
 * 구조화 **상태 읽기 전용** 모듈 — AI 를 부르지 않는다.
 *
 * 왜 갈랐나(적대 리뷰 2026-08-29): 진단(diagnose)이 이 값들 때문에 AI 사슬 모듈
 * (structurize.ts — anthropic 클라이언트를 물고 있다)을 import 하고 있었다.
 * 그 상태로는 「AI 금지 관문」이 이름 하나 차이로 뚫린다 — 진단은 여기만 보고,
 * structurize 는 여기서 가져다 재수출해 옛 import 경로도 그대로 산다.
 */
import type { ServeQuery } from "./types";

export const CURRENT_STRUCTURE_VERSION = 3;

/** done·needs_review 이고 현재 버전이면 캐시 — 다시 읽지 않는다. */
export function isCurrentStructure(row: {
  structureStatus: string;
  structureVersion: number;
}): boolean {
  return (
    (row.structureStatus === "done" || row.structureStatus === "needs_review") &&
    row.structureVersion >= CURRENT_STRUCTURE_VERSION
  );
}

export interface StructureProgress {
  total: number;
  done: number;
  pending: number;
  needsReview: number;
  failed: number;
}

/**
 * 화면에 쓰는 진행률.
 * **첨부까지 읽은(structureVersion ≥ 2) 것만 done·needsReview 로 센다.**
 * 옛 버전으로 끝난 done·needs_review 는 아직 깊이 읽기를 기다리는 중이므로 pending 에 합친다 —
 * 안 그러면 첨부를 하나도 안 읽은 상태에서 진행률이 100%로 보인다(2026-08-22 리뷰 7번).
 * 칸 이름은 그대로 둔다 — 화면(ResultList 진행 띠)이 그대로 n/전체 로 읽는다.
 */
export async function structureProgress(
  q: Pick<ServeQuery, "groupAnnouncementsByStructure">,
): Promise<StructureProgress> {
  const rows = await q.groupAnnouncementsByStructure();
  let total = 0;
  let done = 0;
  let needsReview = 0;
  let failed = 0;
  let pending = 0;
  for (const r of rows) {
    const n = r.count;
    total += n;
    const deep = (r.structureVersion ?? 0) >= CURRENT_STRUCTURE_VERSION;
    if (r.structureStatus === "failed") {
      failed += n;
    } else if (r.structureStatus === "done" && deep) {
      done += n;
    } else if (r.structureStatus === "needs_review" && deep) {
      needsReview += n;
    } else {
      // 대기·붙잡은 중(working)에, 아직 깊이 읽기를 못 한 옛 버전 완료분까지 합친다.
      pending += n;
    }
  }
  return { total, done, pending, needsReview, failed };
}
