// 읽기 통로 본문 — 보기 여섯 가지 응답·400 글자·앱이 정한 범위(403)·엑셀 막기·없는 것(404)·예상 밖 오류(500).
import { afterEach, describe, expect, it, vi } from "vitest";
import { handleDeadlineGet, type DeadlineGetDeps, type RequestedScope } from "./handler";
import { parseDeadlineQuery } from "./query";
import { DeadlineReadError, type DeadlineScope } from "./scope";
import type { CheckItem, DeadlineBucket, ReadCompany, ReadMatch, ReadSource } from "./types";

// 2026-11-12 10:00 KST
const NOW = new Date("2026-11-12T01:00:00Z");

const BUCKET: DeadlineBucket = {
  bucketKey: "B7", repAnnouncementId: "ann-B7", announcementIds: ["ann-B7"], title: "공고 B7", agency: "기관",
  category: "정책자금", url: "https://example.com/B7", applyEnd: new Date("2026-11-19T05:00:00Z"),
};
const COMPANY: ReadCompany = {
  customerKey: "b:1", companyName: "삼영식품", consultant: "김컨설", consultantNames: ["김컨설"], readConsultantIds: ["u1"], statusText: "계약 완료", profileGaps: [],
};
const MATCH: ReadMatch = { customerKey: "b:1", bucketKey: "B7", repAnnouncementId: "ann-B7", verdict: "fit", fitLabels: ["업력"], toCheck: [], gaps: [] };

function memorySource(): ReadSource {
  return {
    companies: async (f) => (f.customerKeys === undefined || f.customerKeys.includes("b:1") ? [COMPANY] : []),
    buckets: async (keys) => (keys === undefined || keys.includes("B7") ? [BUCKET] : []),
    matchCounts: async () => [{ bucketKey: "B7", verdict: "fit", count: 1 }],
    matches: async () => [MATCH],
    matchKeys: async () => [{ customerKey: "b:1", bucketKey: "B7", verdict: "fit", toCheck: [], fitLabels: ["업력"] }],
    progress: async () => [],
    lastRun: async () => null,
  };
}

// 맞을 확률이 갈리는 두 공고 — B7(D-7) 높음 · B3(D-3) 낮음. 마감 순이면 B3 가, 맞을 확률 순이면 B7 이 먼저다.
const B3: DeadlineBucket = {
  ...BUCKET, bucketKey: "B3", repAnnouncementId: "ann-B3", announcementIds: ["ann-B3"], title: "공고 B3",
  url: "https://example.com/B3", applyEnd: new Date("2026-11-15T05:00:00Z"),
};
const AGE_ITEM: CheckItem = { label: "업력 3년 이상", what: "업력", group: "company", rank: 4, field: "foundedDate", where: "기본정보 · 설립일" };
const TIERED: ReadMatch[] = [
  { ...MATCH, tier: "high", tierScore: 100, tierReason: "조건 1개 모두 맞음", checkItems: [], amountMaxWon: null },
  {
    ...MATCH, bucketKey: "B3", repAnnouncementId: "ann-B3", verdict: "unverified", fitLabels: [], toCheck: ["업력 3년 이상"],
    tier: "low", tierScore: 40, tierReason: "업력 확인", checkItems: [AGE_ITEM], amountMaxWon: null,
  },
];

function tieredSource(): ReadSource {
  return {
    ...memorySource(),
    buckets: async (keys) => [BUCKET, B3].filter((b) => keys === undefined || keys.includes(b.bucketKey)),
    matchCounts: async () => [
      { bucketKey: "B7", verdict: "fit", tier: "high", unstructured: false, count: 1 },
      { bucketKey: "B3", verdict: "unverified", tier: "low", unstructured: false, count: 1 },
    ],
    matches: async (f) => TIERED.filter((m) => (f.customerKeys === null || f.customerKeys.includes(m.customerKey))
      && (f.bucketKeys === undefined || f.bucketKeys.includes(m.bucketKey))),
    matchKeys: async () => TIERED.map((m) => ({
      customerKey: m.customerKey, bucketKey: m.bucketKey, verdict: m.verdict, toCheck: m.toCheck, fitLabels: m.fitLabels, tier: m.tier,
    })),
  };
}

const ALL: DeadlineScope = { kind: "all" };
const deps = (over: Partial<DeadlineGetDeps> = {}): DeadlineGetDeps => ({ now: NOW, src: memorySource(), allowExport: true, ...over });
type ScopeOf = (requested: RequestedScope) => DeadlineScope | Promise<DeadlineScope>;
const call = (query: string, scopeOf: ScopeOf = () => ALL, over: Partial<DeadlineGetDeps> = {}) =>
  handleDeadlineGet(new URLSearchParams(query), scopeOf, deps(over));

function failure(result: Awaited<ReturnType<typeof call>>): { status: number; code: string; message: string } {
  if (result.body.success) throw new Error("실패 응답이어야 한다");
  return { status: result.status, ...result.body.error };
}

afterEach(() => vi.restoreAllMocks());

describe("보기 여섯 가지", () => {
  it("list(기본) — 날짜 마감 줄과 요약 숫자", async () => {
    const result = await call("");
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ success: true, data: { companyCount: 1, bucketCount: 1, dated: [{ bucketKey: "B7", fit: 1 }] } });
  });

  it("bucket — 그 공고의 업체", async () => {
    const result = await call("view=bucket&bucket=B7");
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ success: true, data: { bucket: { bucketKey: "B7" }, fit: [{ customerKey: "b:1" }] } });
  });

  it("contacts — 연락 예정 업체", async () => {
    const result = await call("view=contacts&days=14");
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ success: true, data: { companies: [{ customerKey: "b:1", nearestDDay: 7 }] } });
  });

  it("company — 업체 하나의 공고", async () => {
    const result = await call("view=company&customerKey=b:1");
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ success: true, data: { company: { companyName: "삼영식품" }, announcements: [{ bucketKey: "B7" }] } });
  });

  it("summary — 요약 카드 숫자", async () => {
    const result = await call("view=summary");
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ success: true, data: { within7Companies: 1, contacts: 1 } });
  });

  it("export — 엑셀 줄", async () => {
    const result = await call("view=export&days=30");
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ success: true, data: { total: 1, truncated: false, rows: [{ companyName: "삼영식품" }] } });
  });
});

describe("정렬(sort)·단계(tiers) 질의", () => {
  const parse = (query: string) => parseDeadlineQuery(new URLSearchParams(query));

  it("sort 기본값은 맞을 확률 순(tier) — list·contacts·company·export 만 읽는다", () => {
    expect(parse("view=list")).toStrictEqual({ view: "list", scope: null, days: 30, hideEmpty: true, sort: "tier" });
    expect(parse("view=list&sort=deadline")).toStrictEqual({ view: "list", scope: null, days: 30, hideEmpty: true, sort: "deadline" });
    expect(parse("view=contacts")).toStrictEqual({
      view: "contacts", scope: null, days: 14, includeUnstructured: false, includeProgress: false, sort: "tier",
    });
    expect(parse("view=company&customerKey=b:1&sort=deadline")).toStrictEqual({
      view: "company", customerKey: "b:1", days: 14, includeUnstructured: false, includeProgress: false, sort: "deadline",
    });
    expect(parse("view=export")).toStrictEqual({ view: "export", scope: null, days: 30, fitOnly: false, sort: "tier" });
    expect(parse("view=bucket&bucket=B7&sort=deadline")).toStrictEqual({ view: "bucket", scope: null, bucketKey: "B7" });
    expect(parse("view=summary&sort=nope")).toStrictEqual({ view: "summary", scope: null });
  });

  it("tiers 는 contacts·company 에서만 읽는다 — 쉼표로 잇고, 겹친 낱말은 한 번, 비면 키가 없다", () => {
    expect(parse("view=contacts&tiers=high,mid,high")).toMatchObject({ view: "contacts", tiers: ["high", "mid"] });
    expect(parse("view=company&customerKey=b:1&tiers=low")).toMatchObject({ view: "company", tiers: ["low"] });
    expect("tiers" in parse("view=contacts&tiers=")).toBe(false);
    expect("tiers" in parse("view=contacts")).toBe(false);
    expect("tiers" in parse("view=list&tiers=high")).toBe(false);
  });

  const bad: Array<[string, string]> = [
    ["view=list&sort=nope", "정렬 값이 올바르지 않습니다."],
    ["view=contacts&sort=TIER", "정렬 값이 올바르지 않습니다."],
    ["view=export&sort=1", "정렬 값이 올바르지 않습니다."],
    ["view=contacts&tiers=high,top", "단계 값이 올바르지 않습니다."],
    ["view=company&customerKey=b:1&tiers=HIGH", "단계 값이 올바르지 않습니다."],
  ];
  for (const [query, message] of bad) {
    it(`${query} → 400 ${message}`, async () => {
      expect(failure(await call(query))).toEqual({ status: 400, code: "BAD_REQUEST", message });
    });
  }

  it("정렬·단계를 각 읽기에 넘긴다 — 맞을 확률 순이면 높음(B7)이 마감 가까운 낮음(B3)보다 먼저", async () => {
    const src = tieredSource();
    const keysOf = (rows: Array<{ bucketKey: string }>) => rows.map((r) => r.bucketKey);
    const data = async (query: string): Promise<Record<string, unknown>> => {
      const result = await call(query, () => ALL, { src });
      if (!result.body.success) throw new Error(`실패: ${query}`);
      return result.body.data as Record<string, unknown>;
    };

    expect(keysOf((await data("view=list")).dated as Array<{ bucketKey: string }>)).toEqual(["B7", "B3"]);
    expect(keysOf((await data("view=list&sort=deadline")).dated as Array<{ bucketKey: string }>)).toEqual(["B3", "B7"]);

    expect(keysOf((await data("view=company&customerKey=b:1")).announcements as Array<{ bucketKey: string }>)).toEqual(["B7", "B3"]);
    expect(keysOf((await data("view=company&customerKey=b:1&sort=deadline")).announcements as Array<{ bucketKey: string }>)).toEqual(["B3", "B7"]);
    expect(keysOf((await data("view=company&customerKey=b:1&tiers=low")).announcements as Array<{ bucketKey: string }>)).toEqual(["B3"]);

    const contacts = (await data("view=contacts")).companies as Array<{ best: { bucketKey: string }; tiers: unknown }>;
    expect(contacts.map((c) => [c.best.bucketKey, c.tiers])).toEqual([["B7", { high: 1, mid: 0, low: 1, unstructured: 0 }]]);
    const onlyHigh = (await data("view=contacts&tiers=high")).companies as Array<{ tiers: unknown }>;
    expect(onlyHigh.map((c) => c.tiers)).toEqual([{ high: 1, mid: 0, low: 0, unstructured: 0 }]);

    // 엑셀 줄에는 묶음 열쇠가 없어 공고 제목으로 본다.
    const titlesOf = async (query: string) => ((await data(query)).rows as Array<{ title: string }>).map((r) => r.title);
    expect(await titlesOf("view=export")).toEqual(["공고 B7", "공고 B3"]);
    expect(await titlesOf("view=export&sort=deadline")).toEqual(["공고 B3", "공고 B7"]);
  });
});

describe("400 — 요청 글자가 틀림", () => {
  const cases: Array<[string, string]> = [
    ["days=5", "days 는 7·14·30·all 중 하나입니다."],
    ["hideEmpty=2", "거르기 값은 0 또는 1 입니다."],
    ["view=nope", "view 값이 올바르지 않습니다."],
    ["scope=team", "보기 범위가 올바르지 않습니다."],
    ["view=bucket", "공고를 골라 주세요."],
    ["view=bucket&bucket=" + "가".repeat(301), "공고를 골라 주세요."],
    ["view=company&customerKey=x:1", "업체를 골라 주세요."],
    ["view=company", "업체를 골라 주세요."],
    ["view=export&category=" + "가".repeat(101), "분류 값이 너무 깁니다."],
  ];
  for (const [query, message] of cases) {
    it(`${query.slice(0, 40)} → ${message}`, async () => {
      expect(failure(await call(query))).toEqual({ status: 400, code: "BAD_REQUEST", message });
    });
  }

  it("글자가 틀리면 범위(scopeOf)를 묻지도, 읽지도 않는다", async () => {
    const scopeOf = vi.fn<ScopeOf>(() => ALL);
    await call("days=5", scopeOf);
    expect(scopeOf).not.toHaveBeenCalled();
  });
});

describe("범위(scopeOf)", () => {
  it("요청한 담당 범위(mine·all·없음)를 그대로 넘긴다", async () => {
    const scopeOf = vi.fn<ScopeOf>(() => ALL);
    await call("view=summary&scope=mine", scopeOf);
    await call("view=summary&scope=all", scopeOf);
    await call("view=summary", scopeOf);
    expect(scopeOf.mock.calls.map((c) => c[0])).toEqual(["mine", "all", null]);
  });

  it("업체 보기(company)는 요청한 범위가 와도 null 로 부른다", async () => {
    const scopeOf = vi.fn<ScopeOf>(() => ALL);
    await call("view=company&customerKey=b:1&scope=mine", scopeOf);
    expect(scopeOf).toHaveBeenCalledTimes(1);
    expect(scopeOf.mock.calls[0][0]).toBeNull();
  });

  it("앱이 정한 범위로 읽는다 — keys 범위에 없는 업체는 안 보인다", async () => {
    const result = await call("view=summary", vi.fn<ScopeOf>(() => ({ kind: "keys", customerKeys: ["b:2"] })));
    expect(result.body).toMatchObject({ success: true, data: { within7Companies: 0, contacts: 0 } });
  });

  it("비동기 scopeOf 도 기다린다", async () => {
    const result = await call("view=summary", vi.fn<ScopeOf>(async () => ALL));
    expect(result.status).toBe(200);
  });

  it("scopeOf 가 DeadlineReadError 를 던지면 그 status·code·message 그대로 응답한다", async () => {
    const scopeOf = vi.fn<ScopeOf>(() => {
      throw new DeadlineReadError(403, "FORBIDDEN", "관리자만 전체를 봅니다.");
    });
    expect(failure(await call("view=list&scope=all", scopeOf))).toEqual({ status: 403, code: "FORBIDDEN", message: "관리자만 전체를 봅니다." });
  });
});

describe("엑셀 내려받기", () => {
  it("앱이 막았으면(allowExport=false) 403 — 읽기도 범위 확인도 하지 않는다", async () => {
    const scopeOf = vi.fn<ScopeOf>(() => ALL);
    const src = memorySource();
    const companies = vi.spyOn(src, "companies");
    const result = await call("view=export", scopeOf, { allowExport: false, src });
    expect(failure(result)).toEqual({ status: 403, code: "FORBIDDEN", message: "엑셀 내려받기를 쓸 수 없습니다." });
    expect(scopeOf).not.toHaveBeenCalled();
    expect(companies).not.toHaveBeenCalled();
  });

  it("엑셀을 막아도 다른 보기는 읽는다", async () => {
    expect((await call("view=summary", vi.fn(() => ALL), { allowExport: false })).status).toBe(200);
  });
});

describe("404 — 없는 것", () => {
  it("없는 공고 묶음", async () => {
    expect(failure(await call("view=bucket&bucket=NOPE"))).toEqual({ status: 404, code: "NOT_FOUND", message: "공고를 찾지 못했습니다." });
  });

  it("없는 업체", async () => {
    expect(failure(await call("view=company&customerKey=b:999"))).toEqual({ status: 404, code: "NOT_FOUND", message: "업체를 찾지 못했습니다." });
  });
});

describe("500 — 예상 밖 오류", () => {
  it("읽다가 던지면 쉬운 한국어 500 — 오류 내용은 응답에 싣지 않는다", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const src = memorySource();
    src.companies = async () => {
      throw new Error("연결 문자열 postgres://secret");
    };
    const result = await call("view=summary", vi.fn(() => ALL), { src });
    expect(failure(result)).toEqual({
      status: 500,
      code: "INTERNAL",
      message: "공고 대조 결과를 읽지 못했습니다. 잠시 후 다시 시도해 주세요.",
    });
    expect(JSON.stringify(result.body)).not.toContain("secret");
    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0])).not.toContain("secret");
  });

  it("scopeOf 가 예상 밖 오류를 던져도 500", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const scopeOf = vi.fn<ScopeOf>(() => {
      throw new Error("로그인 확인 실패");
    });
    expect(failure(await call("view=list", scopeOf)).status).toBe(500);
  });
});
