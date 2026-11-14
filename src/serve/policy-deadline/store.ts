/**
 * 마지막 대조 요약 읽기 — JsonCache 에 남긴 값을 화면의 「마지막 대조」로 읽는다.
 * 대조를 **쓰는** 쪽(배치)은 앱 한 곳에만 있어 여기에 없다.
 */
import type { DeadlineReadDb } from "./db";
import type { RunSummary } from "./types";

/** 마지막 대조 요약을 두는 JsonCache 열쇠 — 화면의 「마지막 대조」가 읽는다. */
export const LAST_RUN_KEY = "policy-deadline:last";

/** JSON 값이 배열 아닌 객체인지 — 저장된 JSON 은 어떤 모양이든 들어 있을 수 있다. */
function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** JsonCache 값이 RunSummary 모양이면 그 값, 아니면 null — skipped 는 글자일 때만 싣는다. */
export function runSummaryOf(value: unknown): RunSummary | null {
  if (!isJsonObject(value)) return null;
  const { kind, startedAt, finishedAt, companies, buckets, upserts, deletes, errors, skipped } = value;
  if (kind !== "full" && kind !== "dirty") return null;
  if (typeof startedAt !== "string" || typeof finishedAt !== "string") return null;
  if (typeof companies !== "number" || typeof buckets !== "number") return null;
  if (typeof upserts !== "number" || typeof deletes !== "number" || typeof errors !== "number") return null;
  const summary: RunSummary = { kind, startedAt, finishedAt, companies, buckets, upserts, deletes, errors };
  if (typeof skipped === "string") summary.skipped = skipped;
  return summary;
}

export async function readLastRun(db: Pick<DeadlineReadDb, "jsonCache">): Promise<RunSummary | null> {
  const row = await db.jsonCache.findUnique({ where: { key: LAST_RUN_KEY } });
  return row ? runSummaryOf(row.value) : null;
}
