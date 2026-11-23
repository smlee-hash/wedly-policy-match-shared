// 읽기 DB 창구 — 구조형 가짜 DB(메모리)로: 빈 열쇠 목록은 DB 를 부르지 않고, 두 거르기를 함께 걸고, 판정·진행 값을 좁혀 읽는다.
import { describe, expect, it, vi } from "vitest";
import { deadlineReadSource, type DeadlineDb } from "./db";
import { LAST_RUN_KEY } from "./store";

const NOW = new Date("2026-11-12T01:00:00Z");

type Row = Record<string, unknown>;
// 대조 때 저장한 칸(단계·점수·근거·확인 항목·지원 금액)은 모양이 틀린 값도 넣어 보려고 unknown 으로 둔다.
type MatchRow = {
  customerKey: string; bucketKey: string; repAnnouncementId: string; verdict: string; fitLabels: string[]; toCheck: string[]; gaps: string[];
  tier?: unknown; tierScore?: unknown; tierReason?: unknown; checkItems?: unknown; amountMaxWon?: unknown;
};
type MatchKeyRow = { customerKey: string; bucketKey: string; verdict: string; toCheck: string[]; fitLabels: string[]; tier?: unknown };
type ProgressRow = {
  customerKey: string; bucketKey: string; trackId: string; byUserId: string | null; byName: string; via: string; createdAt: Date;
};
type DismissRow = { customerKey: string; bucketKey: string; reason: string; byUserId: string | null; byName: string; createdAt: Date };

const MATCH_BASE = { customerKey: "b:1", bucketKey: "B7", repAnnouncementId: "ann", verdict: "fit", fitLabels: ["업력"], toCheck: [], gaps: [] };
const TAX_ITEM = {
  label: "국세·지방세 체납 없음", what: "체납 여부", group: "company", rank: 7, field: "taxArrears", where: "기업상태표 · 체납", current: "모름",
};

function fakeDb() {
  const calls = {
    company: vi.fn<(args: unknown) => Promise<Row[]>>(async () => []),
    bucket: vi.fn<(args: unknown) => Promise<Row[]>>(async () => []),
    matchFind: vi.fn<(args: unknown) => Promise<MatchRow[]>>(async () => [{
      customerKey: "b:1", bucketKey: "B7", repAnnouncementId: "ann", verdict: "이상한값", fitLabels: [], toCheck: [], gaps: [],
    }]),
    matchKeys: vi.fn<(args: unknown) => Promise<MatchKeyRow[]>>(async () => [{ customerKey: "b:1", bucketKey: "B7", verdict: "이상한값", toCheck: [], fitLabels: ["업력"] }]),
    groupBy: vi.fn<(args: unknown) => Promise<unknown>>(async () => [{ bucketKey: "B7", verdict: "fit", tier: "high", unstructured: false, _count: { _all: 3 } }]),
    progress: vi.fn<(args: unknown) => Promise<ProgressRow[]>>(async () => [{
      customerKey: "b:1", bucketKey: "B7", trackId: "t", byUserId: null, byName: "김컨설", via: "이상함", createdAt: NOW,
    }]),
    cache: vi.fn<(args: unknown) => Promise<{ value: unknown } | null>>(async () => null),
    dismiss: vi.fn<(args: unknown) => Promise<DismissRow[]>>(async () => [{
      customerKey: "b:1", bucketKey: "B7", reason: "기타", byUserId: "u1", byName: "김컨설", createdAt: NOW,
    }]),
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
    policyDeadlineDismiss: { findMany: (args) => calls.dismiss(args) },
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

  it("묶음은 요약 글(summary)을 있으면 그대로, 줄에 칸이 없으면 빈 글로 읽고 select 를 쓰지 않는다", async () => {
    const { db, calls } = fakeDb();
    const base = { bucketKey: "B7", repAnnouncementId: "ann", announcementIds: ["ann"], title: "공고", agency: "기관", category: "정책자금", url: "", applyEnd: null };
    calls.bucket.mockResolvedValueOnce([{ ...base, summary: "운전자금 최대 5억 원" }, { ...base, bucketKey: "B3" }]);
    const rows = await deadlineReadSource(db).buckets();
    expect(rows.map((r) => [r.bucketKey, r.summary])).toEqual([["B7", "운전자금 최대 5억 원"], ["B3", ""]]);
    expect(calls.bucket).toHaveBeenLastCalledWith({ where: {} });
  });

  it("묶음은 지원 금액 글(amountText)도 있으면 그대로, 칸이 없는 옛 클라이언트면 빈 글(2026-11-23)", async () => {
    const { db, calls } = fakeDb();
    const base = { bucketKey: "B7", repAnnouncementId: "ann", announcementIds: ["ann"], title: "공고", agency: "기관", category: "정책자금", url: "", applyEnd: null };
    calls.bucket.mockResolvedValueOnce([{ ...base, amountText: "기업당 5,000만원" }, { ...base, bucketKey: "B3" }]);
    const rows = await deadlineReadSource(db).buckets();
    expect(rows.map((r) => [r.bucketKey, r.amountText])).toEqual([["B7", "기업당 5,000만원"], ["B3", ""]]);
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
  it("업체·판정 수·판정 줄·거르기 칸·진행·해당 없음 모두 빈 배열이면 빈 결과", async () => {
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
    expect(await src.dismissals?.({ customerKeys: [] })).toEqual([]);
    expect(await src.dismissals?.({ customerKeys: null, bucketKeys: [] })).toEqual([]);
    for (const fn of Object.values(calls)) expect(fn).not.toHaveBeenCalled();
  });
});

describe("deadlineReadSource — 값 좁히기", () => {
  it("판정 수 = (묶음, 판정, 단계, 조건 정리 전) groupBy 한 번, 업체 열쇠가 null 이면 where 가 비어 있다", async () => {
    const { db, calls } = fakeDb();
    const src = deadlineReadSource(db);
    expect(await src.matchCounts(null)).toStrictEqual([{ bucketKey: "B7", verdict: "fit", tier: "high", unstructured: false, count: 3 }]);
    expect(calls.groupBy).toHaveBeenLastCalledWith({ by: ["bucketKey", "verdict", "tier", "unstructured"], where: {}, _count: { _all: true } });
    await src.matchCounts(["b:1"]);
    expect(calls.groupBy).toHaveBeenLastCalledWith({
      by: ["bucketKey", "verdict", "tier", "unstructured"], where: { customerKey: { in: ["b:1"] } }, _count: { _all: true },
    });
  });

  it("groupBy 결과 줄의 모양이 틀리면 그 줄을 버린다 — 단계·조건 정리 전 칸이 없는 옛 줄은 받고 null·false 로", async () => {
    const { db, calls } = fakeDb();
    calls.groupBy.mockResolvedValueOnce([{ bucketKey: "B7", verdict: "fit", _count: { _all: 2 } }, { bucketKey: "B3" }, null, "글", { bucketKey: "B1", verdict: "fit", _count: { _all: "5" } }]);
    expect(await deadlineReadSource(db).matchCounts(null)).toStrictEqual([{ bucketKey: "B7", verdict: "fit", tier: null, unstructured: false, count: 2 }]);
    calls.groupBy.mockResolvedValueOnce("배열이 아님");
    expect(await deadlineReadSource(db).matchCounts(null)).toEqual([]);
  });

  it("groupBy 의 단계는 high·mid·low 만, 조건 정리 전은 boolean 만 그대로 — 그 밖은 null·false", async () => {
    const { db, calls } = fakeDb();
    calls.groupBy.mockResolvedValueOnce([
      { bucketKey: "B7", verdict: "fit", tier: "mid", unstructured: true, _count: { _all: 1 } },
      { bucketKey: "B7", verdict: "fit", tier: "이상함", unstructured: "yes", _count: { _all: 2 } },
      { bucketKey: "B3", verdict: "unverified", tier: null, unstructured: null, _count: { _all: 4 } },
      { bucketKey: "B3", verdict: "unverified", tier: "low", unstructured: false, _count: { _all: 5 } },
    ]);
    expect(await deadlineReadSource(db).matchCounts(null)).toStrictEqual([
      { bucketKey: "B7", verdict: "fit", tier: "mid", unstructured: true, count: 1 },
      { bucketKey: "B7", verdict: "fit", tier: null, unstructured: false, count: 2 },
      { bucketKey: "B3", verdict: "unverified", tier: null, unstructured: false, count: 4 },
      { bucketKey: "B3", verdict: "unverified", tier: "low", unstructured: false, count: 5 },
    ]);
  });

  it("판정 값이 fit 이 아니면 확인 필요(unverified)로 읽는다 — 수·줄·거르기 칸 모두", async () => {
    const { db, calls } = fakeDb();
    calls.groupBy.mockResolvedValueOnce([{ bucketKey: "B7", verdict: "excluded", _count: { _all: 1 } }]);
    const src = deadlineReadSource(db);
    expect(await src.matchCounts(null)).toEqual([{ bucketKey: "B7", verdict: "unverified", tier: null, unstructured: false, count: 1 }]);
    expect((await src.matches({ customerKeys: null }))[0]).toMatchObject({ customerKey: "b:1", bucketKey: "B7", verdict: "unverified" });
    expect(await src.matchKeys({ customerKeys: ["b:1"], bucketKeys: ["B7"] })).toStrictEqual([
      { customerKey: "b:1", bucketKey: "B7", verdict: "unverified", toCheck: [], fitLabels: ["업력"] },
    ]);
    expect(calls.matchKeys).toHaveBeenLastCalledWith({
      where: { customerKey: { in: ["b:1"] }, bucketKey: { in: ["B7"] } },
      select: { customerKey: true, bucketKey: true, verdict: true, toCheck: true, fitLabels: true, tier: true },
    });
  });

  it("거르기 칸의 단계는 high·mid·low 일 때만 키를 둔다", async () => {
    const { db, calls } = fakeDb();
    const key = { customerKey: "b:1", bucketKey: "B7", verdict: "fit", toCheck: [], fitLabels: [] };
    calls.matchKeys.mockResolvedValueOnce([{ ...key, tier: "mid" }, { ...key, tier: "모름" }, { ...key, tier: null }, key]);
    const rows = await deadlineReadSource(db).matchKeys({ customerKeys: null });
    expect(rows).toStrictEqual([
      { customerKey: "b:1", bucketKey: "B7", verdict: "fit", toCheck: [], fitLabels: [], tier: "mid" },
      { customerKey: "b:1", bucketKey: "B7", verdict: "fit", toCheck: [], fitLabels: [] },
      { customerKey: "b:1", bucketKey: "B7", verdict: "fit", toCheck: [], fitLabels: [] },
      { customerKey: "b:1", bucketKey: "B7", verdict: "fit", toCheck: [], fitLabels: [] },
    ]);
  });

  it("판정 줄의 저장 칸은 모양이 맞을 때만 싣고, 지원 금액은 늘 키를 둔다(수·bigint → 수, 그 밖 null)", async () => {
    const { db, calls } = fakeDb();
    const base = MATCH_BASE;
    calls.matchFind.mockResolvedValueOnce([
      {
        ...base, tier: "high", tierScore: 92, tierReason: "조건 1개 모두 맞음 · 체납 여부만 확인",
        checkItems: [TAX_ITEM, { ...TAX_ITEM, rank: "7" }, { label: "빈 칸" }, null, "글"], amountMaxWon: 500_000_000,
      },
      { ...base, bucketKey: "B3", tier: "이상함", tierScore: "92", tierReason: 3, checkItems: "글", amountMaxWon: BigInt(300_000_000) },
      { ...base, bucketKey: "B1", tier: null, tierScore: null, tierReason: null, checkItems: null, amountMaxWon: null },
      { ...base, bucketKey: "B0" },
      { ...base, bucketKey: "B9", amountMaxWon: "5억" },
    ]);
    const rows = await deadlineReadSource(db).matches({ customerKeys: null });
    const plain = { customerKey: "b:1", repAnnouncementId: "ann", verdict: "fit", fitLabels: ["업력"], toCheck: [], gaps: [] };
    expect(rows).toStrictEqual([
      {
        ...plain, bucketKey: "B7", tier: "high", tierScore: 92, tierReason: "조건 1개 모두 맞음 · 체납 여부만 확인",
        checkItems: [TAX_ITEM], amountMaxWon: 500_000_000,
      },
      { ...plain, bucketKey: "B3", amountMaxWon: 300_000_000 },
      { ...plain, bucketKey: "B1", amountMaxWon: null },
      { ...plain, bucketKey: "B0", amountMaxWon: null },
      { ...plain, bucketKey: "B9", amountMaxWon: null },
    ]);
  });

  it("해당 없음 줄은 업체·묶음 열쇠를 함께 걸어 읽고 그대로 옮긴다", async () => {
    const { db, calls } = fakeDb();
    const src = deadlineReadSource(db);
    expect(await src.dismissals?.({ customerKeys: ["b:1"], bucketKeys: ["B7"] })).toStrictEqual([
      { customerKey: "b:1", bucketKey: "B7", reason: "기타", byUserId: "u1", byName: "김컨설", createdAt: NOW },
    ]);
    expect(calls.dismiss).toHaveBeenLastCalledWith({ where: { customerKey: { in: ["b:1"] }, bucketKey: { in: ["B7"] } } });
    calls.dismiss.mockResolvedValueOnce([{ customerKey: "b:2", bucketKey: "B3", reason: "이미 신청함", byUserId: null, byName: "", createdAt: NOW }]);
    expect((await src.dismissals?.({ customerKeys: null }))?.[0]).toMatchObject({ customerKey: "b:2", byUserId: null, reason: "이미 신청함" });
    expect(calls.dismiss).toHaveBeenLastCalledWith({ where: {} });
  });

  it("맞을 확률 설정은 앱이 넘길 때만 내보낸다", async () => {
    const { db } = fakeDb();
    expect("tierConfig" in deadlineReadSource(db)).toBe(false);
    const raw = { weights: { fieldGap: 5 } };
    const src = deadlineReadSource(db, { tierConfig: async () => raw });
    expect(await src.tierConfig?.()).toBe(raw);
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
