// 마지막 대조 요약 읽기 — JsonCache 값 모양 검사와 열쇠.
import { describe, expect, it, vi } from "vitest";
import type { DeadlineReadDb } from "./db";
import { LAST_RUN_KEY, readLastRun, runSummaryOf } from "./store";
import type { RunSummary } from "./types";

const SUMMARY: RunSummary = {
  kind: "full", startedAt: "2026-11-12T00:20:00.000Z", finishedAt: "2026-11-12T00:40:00.000Z",
  companies: 297, buckets: 3233, upserts: 10, deletes: 2, errors: 0,
};

function cacheDb(row: { value: unknown } | null) {
  const findUnique = vi.fn(async () => row);
  return { db: { jsonCache: { findUnique } } satisfies Pick<DeadlineReadDb, "jsonCache">, findUnique };
}

describe("runSummaryOf", () => {
  it("모양이 맞으면 그 값 그대로", () => {
    expect(runSummaryOf(SUMMARY)).toEqual(SUMMARY);
    expect(runSummaryOf({ ...SUMMARY, kind: "dirty" })).toMatchObject({ kind: "dirty" });
  });

  it("skipped 는 글자일 때만 싣는다", () => {
    expect(runSummaryOf({ ...SUMMARY, skipped: "점검 중" })).toEqual({ ...SUMMARY, skipped: "점검 중" });
    expect(runSummaryOf({ ...SUMMARY, skipped: 3 })).toEqual(SUMMARY);
  });

  it("객체가 아니거나 칸이 빠지거나 틀리면 null", () => {
    expect(runSummaryOf(null)).toBeNull();
    expect(runSummaryOf("글")).toBeNull();
    expect(runSummaryOf([SUMMARY])).toBeNull();
    expect(runSummaryOf({ kind: "full" })).toBeNull();
    expect(runSummaryOf({ ...SUMMARY, kind: "partial" })).toBeNull();
    expect(runSummaryOf({ ...SUMMARY, finishedAt: 5 })).toBeNull();
    expect(runSummaryOf({ ...SUMMARY, companies: "297" })).toBeNull();
    expect(runSummaryOf({ ...SUMMARY, errors: undefined })).toBeNull();
  });
});

describe("readLastRun", () => {
  it("정해진 열쇠로 읽는다", async () => {
    const { db, findUnique } = cacheDb({ value: SUMMARY });
    expect(await readLastRun(db)).toEqual(SUMMARY);
    expect(findUnique).toHaveBeenCalledWith({ where: { key: LAST_RUN_KEY } });
    expect(LAST_RUN_KEY).toBe("policy-deadline:last");
  });

  it("값이 없거나 모양이 틀리면 null", async () => {
    expect(await readLastRun(cacheDb(null).db)).toBeNull();
    expect(await readLastRun(cacheDb({ value: { kind: "full" } }).db)).toBeNull();
  });
});
