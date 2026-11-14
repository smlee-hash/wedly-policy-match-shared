// 읽기 DB 창구 — 구조형 가짜 DB(메모리)로: 빈 열쇠 목록은 DB 를 부르지 않고, 두 거르기를 함께 걸고, 판정·진행 값을 좁혀 읽는다.
import { describe, expect, it, vi } from "vitest";
import { deadlineReadSource, type DeadlineDb } from "./db";
import { LAST_RUN_KEY } from "./store";

const NOW = new Date("2026-11-12T01:00:00Z");

type Row = Record<string, unknown>;
type MatchRow = {
  customerKey: string; bucketKey: string; repAnnouncementId: string; verdict: string; fitLabels: string[]; toCheck: string[]; gaps: string[];
};
type MatchKeyRow = { customerKey: string; bucketKey: string; verdict: string; toCheck: string[] };
type ProgressRow = {
  customerKey: string; bucketKey: string; trackId: string; byUserId: string | null; byName: string; via: string; createdAt: Date;
};

function fakeDb() {
  const calls = {
    company: vi.fn<(args: unknown) => Promise<Row[]>>(async () => []),
    bucket: vi.fn<(args: unknown) => Promise<Row[]>>(async () => []),
    matchFind: vi.fn<(args: unknown) => Promise<MatchRow[]>>(async () => [{
      customerKey: "b:1", bucketKey: "B7", repAnnouncementId: "ann", verdict: "이상한값", fitLabels: [], toCheck: [], gaps: [],
    }]),
    matchKeys: vi.fn<(args: unknown) => Promise<MatchKeyRow[]>>(async () => [{ customerKey: "b:1", bucketKey: "B7", verdict: "이상한값", toCheck: [] }]),
    groupBy: vi.fn<(args: unknown) => Promise<unknown>>(async () => [{ bucketKey: "B7", verdict: "fit", _count: { _all: 3 } }]),
    progress: vi.fn<(args: unknown) => Promise<ProgressRow[]>>(async () => [{
      customerKey: "b:1", bucketKey: "B7", trackId: "t", byUserId: null, byName: "김컨설", via: "이상함", createdAt: NOW,
    }]),
    cache: vi.fn<(args: unknown) => Promise<{ value: unknown } | null>>(async () => null),
  };
  // 판정 줄 표가 findMany 를 둘로 쓴다 — select 가 있으면 거르기 칸 읽기, 없으면 전체 칸 읽기로 가른다.
  const matchFindMany = (args: { select?: unknown }) => (args.select === undefined ? calls.matchFind(args) : calls.matchKeys(args));
  const db: DeadlineDb = {
    policyDeadlineCompany: { findMany: (args) => calls.company(args) as never },
    policyDeadlineBucket: { findMany: (args) => calls.bucket(args) as never },
    policyDeadlineMatch: {
      groupBy: (args) => calls.groupBy(args),
      findMany: matchFindMany as unknown as DeadlineDb["policyDeadlineMatch"]["findMany"],
    },
    policyDeadlineProgress: { findMany: (args) => calls.progress(args) },
    jsonCache: { findUnique: (args) => calls.cache(args) },
  };
  return { db, calls };
}

describe("deadlineReadSource — 거르기", () => {
  it("담당 거르기 = readConsultantIds has, 업체 거르기 = customerKey in — 둘 다 주면 둘 다 건다", async () => {
    const { db, calls } = fakeDb();
    await deadlineReadSource(db).companies({ readerId: "u1", customerKeys: ["b:1"] });
    expect(calls.company).toHaveBeenCalledWith(expect.objectContaining({
      where: { readConsultantIds: { has: "u1" }, customerKey: { in: ["b:1"] } },
    }));
  });

  it("거르기가 없으면 where 가 비어 모든 업체를 읽는다", async () => {
    const { db, calls } = fakeDb();
    await deadlineReadSource(db).companies({});
    expect(calls.company).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
  });

  it("업체 칸은 필요한 일곱 칸만 고른다(업체 정보 JSON 을 싣지 않는다)", async () => {
    const { db, calls } = fakeDb();
    await deadlineReadSource(db).companies({});
    expect(calls.company).toHaveBeenCalledWith(expect.objectContaining({
      select: {
        customerKey: true, companyName: true, consultant: true, consultantNames: true, readConsultantIds: true, statusText: true, profileGaps: true,
      },
    }));
  });

  it("묶음은 열쇠가 있을 때만 거르고, 빈 배열이면 DB 를 부르지 않는다", async () => {
    const { db, calls } = fakeDb();
    const src = deadlineReadSource(db);
    await src.buckets();
    expect(calls.bucket).toHaveBeenLastCalledWith({ where: {} });
    await src.buckets(["B7"]);
    expect(calls.bucket).toHaveBeenLastCalledWith({ where: { bucketKey: { in: ["B7"] } } });
    expect(await src.buckets([])).toEqual([]);
    expect(calls.bucket).toHaveBeenCalledTimes(2);
  });

  it("판정 줄·진행 줄은 업체 열쇠와 묶음 열쇠를 함께 건다 — null 은 거르지 않음", async () => {
    const { db, calls } = fakeDb();
    const src = deadlineReadSource(db);
    await src.matches({ customerKeys: ["b:1"], bucketKeys: ["B7"] });
    expect(calls.matchFind).toHaveBeenLastCalledWith({ where: { customerKey: { in: ["b:1"] }, bucketKey: { in: ["B7"] } } });
    await src.matches({ customerKeys: null, bucketKeys: ["B7"] });
    expect(calls.matchFind).toHaveBeenLastCalledWith({ where: { bucketKey: { in: ["B7"] } } });
    await src.progress({ customerKeys: ["b:1"] });
    expect(calls.progress).toHaveBeenLastCalledWith({ where: { customerKey: { in: ["b:1"] } } });
    await src.progress({ customerKeys: null });
    expect(calls.progress).toHaveBeenLastCalledWith({ where: {} });
  });
});

describe("deadlineReadSource — 빈 열쇠 목록은 DB 를 부르지 않는다", () => {
  it("업체·판정 수·판정 줄·거르기 칸·진행 모두 빈 배열이면 빈 결과", async () => {
    const { db, calls } = fakeDb();
    const src = deadlineReadSource(db);
    expect(await src.companies({ customerKeys: [] })).toEqual([]);
    expect(await src.matchCounts([])).toEqual([]);
    expect(await src.matches({ customerKeys: [] })).toEqual([]);
    expect(await src.matches({ customerKeys: null, bucketKeys: [] })).toEqual([]);
    expect(await src.matchKeys({ customerKeys: [] })).toEqual([]);
    expect(await src.matchKeys({ customerKeys: null, bucketKeys: [] })).toEqual([]);
    expect(await src.progress({ customerKeys: [] })).toEqual([]);
    expect(await src.progress({ customerKeys: ["b:1"], bucketKeys: [] })).toEqual([]);
    for (const fn of Object.values(calls)) expect(fn).not.toHaveBeenCalled();
  });
});

describe("deadlineReadSource — 값 좁히기", () => {
  it("판정 수 = (묶음, 판정) groupBy 한 번, 업체 열쇠가 null 이면 where 가 비어 있다", async () => {
    const { db, calls } = fakeDb();
    const src = deadlineReadSource(db);
    expect(await src.matchCounts(null)).toEqual([{ bucketKey: "B7", verdict: "fit", count: 3 }]);
    expect(calls.groupBy).toHaveBeenLastCalledWith({ by: ["bucketKey", "verdict"], where: {}, _count: { _all: true } });
    await src.matchCounts(["b:1"]);
    expect(calls.groupBy).toHaveBeenLastCalledWith({ by: ["bucketKey", "verdict"], where: { customerKey: { in: ["b:1"] } }, _count: { _all: true } });
  });

  it("groupBy 결과 줄의 모양이 틀리면 그 줄을 버린다", async () => {
    const { db, calls } = fakeDb();
    calls.groupBy.mockResolvedValueOnce([{ bucketKey: "B7", verdict: "fit", _count: { _all: 2 } }, { bucketKey: "B3" }, null, "글", { bucketKey: "B1", verdict: "fit", _count: { _all: "5" } }]);
    expect(await deadlineReadSource(db).matchCounts(null)).toEqual([{ bucketKey: "B7", verdict: "fit", count: 2 }]);
    calls.groupBy.mockResolvedValueOnce("배열이 아님");
    expect(await deadlineReadSource(db).matchCounts(null)).toEqual([]);
  });

  it("판정 값이 fit 이 아니면 확인 필요(unverified)로 읽는다 — 수·줄·거르기 칸 모두", async () => {
    const { db, calls } = fakeDb();
    calls.groupBy.mockResolvedValueOnce([{ bucketKey: "B7", verdict: "excluded", _count: { _all: 1 } }]);
    const src = deadlineReadSource(db);
    expect(await src.matchCounts(null)).toEqual([{ bucketKey: "B7", verdict: "unverified", count: 1 }]);
    expect((await src.matches({ customerKeys: null }))[0]).toMatchObject({ customerKey: "b:1", bucketKey: "B7", verdict: "unverified" });
    expect(await src.matchKeys({ customerKeys: ["b:1"], bucketKeys: ["B7"] })).toEqual([
      { customerKey: "b:1", bucketKey: "B7", verdict: "unverified", toCheck: [] },
    ]);
    expect(calls.matchKeys).toHaveBeenLastCalledWith({
      where: { customerKey: { in: ["b:1"] }, bucketKey: { in: ["B7"] } },
      select: { customerKey: true, bucketKey: true, verdict: true, toCheck: true },
    });
  });

  it("진행 줄 via 가 슬랙·정책 진행이 아니면 web 으로 읽고, 둘은 그대로", async () => {
    const { db, calls } = fakeDb();
    const src = deadlineReadSource(db);
    expect((await src.progress({ customerKeys: null }))[0]).toMatchObject({ trackId: "t", byUserId: null, via: "web", createdAt: NOW });
    for (const via of ["slack", "track"] as const) {
      calls.progress.mockResolvedValueOnce([{ customerKey: "b:1", bucketKey: "B7", trackId: "t", byUserId: "u1", byName: "김", via, createdAt: NOW }]);
      expect((await src.progress({ customerKeys: null }))[0].via).toBe(via);
    }
  });

  it("마지막 대조는 정해진 열쇠로 읽고, 값이 없으면 null", async () => {
    const { db, calls } = fakeDb();
    const src = deadlineReadSource(db);
    expect(await src.lastRun()).toBeNull();
    expect(calls.cache).toHaveBeenCalledWith({ where: { key: LAST_RUN_KEY } });
    calls.cache.mockResolvedValueOnce({
      value: { kind: "full", startedAt: "a", finishedAt: "b", companies: 1, buckets: 2, upserts: 3, deletes: 4, errors: 0 },
    });
    expect(await src.lastRun()).toMatchObject({ kind: "full", companies: 1 });
  });
});
