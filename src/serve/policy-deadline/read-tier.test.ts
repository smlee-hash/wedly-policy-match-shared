// 정책별 고객사 「맞을 확률」 읽기(NO.789) — 저장된 단계로 정렬·단계 수·거르기·해당 없음·옛 줄 계산·설정 글자·동시 읽기·엑셀 칸.
import { describe, expect, it, vi } from "vitest";
import {
  isUnstructuredMatch,
  readAnnouncementList,
  readBucketCompanies,
  readCompanyAnnouncements,
  readContacts,
  readExport,
  readSummary,
  readTierConfig,
} from "./read";
import type { DeadlineScope } from "./scope";
import { DEFAULT_TIER_CONFIG, nextActionOf, tierOf, type CheckItem, type DeadlineTier } from "./tier";
import {
  CONTACTS_DEFAULT_DAYS,
  CONTACTS_INCLUDE_UNSTRUCTURED_DEFAULT,
  DISMISS_REASONS,
  EXPORT_BUCKET_CHUNK,
  type DeadlineBucket,
  type DeadlineVerdict,
  type ReadCompany,
  type ReadMatch,
  type ReadSource,
  type StoredDismissal,
  type StoredProgress,
} from "./types";

// 2026-11-12 10:00 KST
const NOW = new Date("2026-11-12T01:00:00Z");
const ALL: DeadlineScope = { kind: "all" };
const U1: DeadlineScope = { kind: "reader", readerId: "u1" };

function bucket(bucketKey: string, applyEnd: string | null, category: string): DeadlineBucket {
  return {
    bucketKey,
    repAnnouncementId: `ann-${bucketKey}`,
    announcementIds: [`ann-${bucketKey}`],
    title: `공고 ${bucketKey}`,
    agency: "중소벤처기업부",
    category,
    url: `https://example.com/${bucketKey}`,
    applyEnd: applyEnd ? new Date(applyEnd) : null,
  };
}

const BUCKETS: DeadlineBucket[] = [
  bucket("T3", "2026-11-15T05:00:00Z", "정책자금"), // D-3
  bucket("TU", "2026-11-16T05:00:00Z", "기타"), // D-4 — 조건 정리 전 줄만
  bucket("T5", "2026-11-17T05:00:00Z", "무상지원금"), // D-5
  bucket("T7", "2026-11-19T05:00:00Z", "정책자금"), // D-7
  bucket("T10", "2026-11-22T05:00:00Z", "R&D"), // D-10
  bucket("TA1", null, "무상지원금"), // 상시
  bucket("TA2", null, "정책자금"), // 상시
];

function company(customerKey: string, companyName: string, readConsultantIds: string[]): ReadCompany {
  return {
    customerKey,
    companyName,
    consultant: `담당 ${companyName}`,
    consultantNames: [`담당 ${companyName}`],
    readConsultantIds,
    statusText: "계약 완료",
    profileGaps: [],
  };
}

const COMPANIES: ReadCompany[] = [
  company("b:11", "가온식품", ["u1"]),
  company("b:12", "나래전자", ["u1"]),
  company("b:13", "다온상사", ["u1"]),
  company("b:14", "라온기계", ["u2"]),
  company("b:15", "마루정밀", ["u1"]),
  company("b:16", "바다물산", ["u1"]),
  company("b:17", "사랑상회", ["u1"]),
];

// 대조 때 저장한 확인 항목(tierOf 가 내는 모양 그대로).
const TAX: CheckItem = {
  label: "체납 여부 입력", what: "세금 체납", group: "company", rank: 7, field: "taxArrears", where: "기업상태표 › 국세 체납여부", current: "비어 있음",
};
const CALL: CheckItem = { label: "고용보험 가입 여부", what: "고용보험 가입 여부", group: "notice", rank: 5, where: "고객 통화로 확인" };
const RAW: CheckItem = {
  label: "조건 확인: 수출 실적이 있는 기업", what: "공고 원문 조건", group: "notice", rank: 8, where: "공고 원문", evidence: "수출 실적이 있는 기업",
};
const REF: CheckItem = {
  label: "조건 확인: 출품 신청서 제출", what: "출품 신청서 제출", group: "ref", rank: 9, where: "공고 원문", evidence: "출품 신청서 제출",
};

/** 단계가 저장된 판정 줄 — 근거 글은 저장 값을 그대로 쓰는지 보려고 일부러 계산과 다른 글로 둔다. */
function stored(
  customerKey: string,
  bucketKey: string,
  tier: DeadlineTier,
  tierScore: number,
  checkItems: CheckItem[],
  extra: Partial<ReadMatch> = {},
): ReadMatch {
  return {
    customerKey,
    bucketKey,
    repAnnouncementId: `ann-${bucketKey}`,
    verdict: checkItems.length === 0 ? "fit" : "unverified",
    fitLabels: ["업종", "지역"],
    toCheck: checkItems.map((c) => c.label),
    gaps: [],
    tier,
    tierScore,
    tierReason: `저장된 근거 ${customerKey} ${bucketKey}`,
    checkItems,
    amountMaxWon: null,
    ...extra,
  };
}

function unstructured(customerKey: string, bucketKey: string): ReadMatch {
  return {
    customerKey,
    bucketKey,
    repAnnouncementId: `ann-${bucketKey}`,
    verdict: "unverified",
    fitLabels: [],
    toCheck: ["공고 원문 확인(조건 정리 전)"],
    gaps: [],
    tier: "low",
    tierScore: 0,
    tierReason: "공고 조건 정리 전",
    checkItems: [],
    amountMaxWon: null,
  };
}

const MATCHES: ReadMatch[] = [
  stored("b:11", "T7", "high", 100, []),
  stored("b:11", "T3", "mid", 85, [CALL]), // 진행 중
  stored("b:11", "TA2", "high", 100, []),
  stored("b:12", "T7", "high", 92, [TAX], { amountMaxWon: 300_000_000 }), // 해당 없음
  stored("b:12", "T10", "mid", 77, [CALL, TAX]),
  stored("b:13", "T7", "mid", 80, [RAW]),
  stored("b:13", "T5", "high", 92, [TAX]),
  stored("b:14", "T7", "low", 57, [CALL, TAX, RAW]),
  stored("b:14", "T5", "high", 100, []),
  stored("b:15", "T7", "mid", 85, [CALL, REF]),
  stored("b:15", "TA1", "mid", 80, [RAW]), // 해당 없음(상시)
  unstructured("b:16", "T7"),
  unstructured("b:16", "TU"),
  stored("b:17", "T5", "high", 100, []), // 해당 없음
];

const PROGRESS: StoredProgress[] = [
  { customerKey: "b:11", bucketKey: "T3", trackId: "t-11", byUserId: "u1", byName: "김컨설", via: "web", createdAt: new Date("2026-11-11T02:00:00Z") },
];

const DISMISSALS: StoredDismissal[] = [
  { customerKey: "b:12", bucketKey: "T7", reason: "이미 신청함", byUserId: "u1", byName: "김컨설", createdAt: new Date("2026-11-11T03:00:00Z") },
  { customerKey: "b:17", bucketKey: "T5", reason: "고객이 원하지 않음", byUserId: "u1", byName: "김컨설", createdAt: new Date("2026-11-11T04:00:00Z") },
  { customerKey: "b:15", bucketKey: "TA1", reason: "기타", byUserId: "u1", byName: "김컨설", createdAt: new Date("2026-11-11T05:00:00Z") },
];

type KeyFilter = { customerKeys: string[] | null; bucketKeys?: string[] };

function tierSource(data: {
  companies?: ReadCompany[];
  buckets?: DeadlineBucket[];
  matches?: ReadMatch[];
  progress?: StoredProgress[];
  dismissals?: StoredDismissal[];
  config?: unknown;
} = {}) {
  const companies = data.companies ?? COMPANIES;
  const buckets = data.buckets ?? BUCKETS;
  const matches = data.matches ?? MATCHES;
  const progress = data.progress ?? PROGRESS;
  const dismissals = data.dismissals ?? DISMISSALS;
  const inKeys = (keys: string[] | null, key: string) => keys === null || keys.includes(key);
  const inFilter = (f: KeyFilter, row: { customerKey: string; bucketKey: string }) =>
    inKeys(f.customerKeys, row.customerKey) && (!f.bucketKeys || f.bucketKeys.includes(row.bucketKey));
  const src = {
    companies: vi.fn(async (f: { readerId?: string; customerKeys?: string[] }) =>
      companies.filter((c) => (f.readerId === undefined || c.readConsultantIds.includes(f.readerId))
        && (f.customerKeys === undefined || f.customerKeys.includes(c.customerKey)))),
    buckets: vi.fn(async (keys?: string[]) => buckets.filter((b) => !keys || keys.includes(b.bucketKey))),
    // DB 의 groupBy(묶음, 판정, 단계, 조건 정리 전)와 같은 모양.
    matchCounts: vi.fn(async (keys: string[] | null) => {
      type Count = { bucketKey: string; verdict: DeadlineVerdict; tier: DeadlineTier | null; unstructured: boolean; count: number };
      const counts = new Map<string, Count>();
      for (const m of matches) {
        if (!inKeys(keys, m.customerKey)) continue;
        const tier = m.tier ?? null;
        const flat = isUnstructuredMatch(m);
        const id = `${m.bucketKey}|${m.verdict}|${tier}|${flat}`;
        const row = counts.get(id) ?? { bucketKey: m.bucketKey, verdict: m.verdict, tier, unstructured: flat, count: 0 };
        row.count += 1;
        counts.set(id, row);
      }
      return [...counts.values()];
    }),
    matches: vi.fn(async (f: KeyFilter) => matches.filter((m) => inFilter(f, m))),
    matchKeys: vi.fn(async (f: KeyFilter) =>
      matches.filter((m) => inFilter(f, m)).map(({ customerKey, bucketKey, verdict, toCheck, fitLabels, tier }) => ({
        customerKey, bucketKey, verdict, toCheck, fitLabels, ...(tier !== undefined ? { tier } : {}),
      }))),
    progress: vi.fn(async (f: KeyFilter) => progress.filter((p) => inFilter(f, p))),
    dismissals: vi.fn(async (f: KeyFilter) => dismissals.filter((d) => inFilter(f, d))),
    tierConfig: vi.fn(async (): Promise<unknown> => data.config ?? null),
    lastRun: vi.fn(async () => null),
  } satisfies ReadSource;
  return src;
}

const keysOf = (rows: { bucketKey: string }[]) => rows.map((r) => r.bucketKey);
const namesOf = (rows: { companyName: string }[]) => rows.map((r) => r.companyName);
const CONTACT_14 = { days: 14, includeUnstructured: false, includeProgress: false } as const;

const ASK_TAX = "고객에게 연락해 신청 안내 · 통화 때 세금 체납 확인";
const ASK_CALL = "고객에게 연락해 고용보험 가입 여부 확인";

describe("readTierConfig — 맞을 확률 설정", () => {
  it("설정 자리가 없으면 기본값, 있으면 맞는 값만 기본값 위에 덮는다", async () => {
    expect(await readTierConfig({})).toEqual(DEFAULT_TIER_CONFIG);
    const merged = await readTierConfig({ tierConfig: async () => ({ text: { contact: "바로 연락하기" }, highMin: "높게" }) });
    expect(merged.text.contact).toBe("바로 연락하기");
    expect(merged.text.checkFirst).toBe(DEFAULT_TIER_CONFIG.text.checkFirst);
    expect(merged.highMin).toBe(DEFAULT_TIER_CONFIG.highMin);
  });

  it("설정을 읽다가 던지면 기본값 — 목록 읽기를 막지 않는다", async () => {
    const config = await readTierConfig({ tierConfig: async () => { throw new Error("설정 표 없음"); } });
    expect(config).toEqual(DEFAULT_TIER_CONFIG);
  });
});

describe("readBucketCompanies — 묶음 하나를 맞을 확률 순으로", () => {
  it("rows = 높음 → 보통(확인 적은 순 → 점수 높은 순) → 낮음 → 조건 정리 전 → 해당 없음, 단계별 수", async () => {
    const view = await readBucketCompanies(ALL, { bucketKey: "T7" }, NOW, tierSource());
    expect(view?.rows.map((r) => r.customerKey)).toEqual(["b:11", "b:15", "b:13", "b:14", "b:16", "b:12"]);
    expect(view?.tierCounts).toEqual({ high: 1, mid: 2, low: 1, unstructured: 1, dismissed: 1 });
    // 맞음·확인 필요 칸은 지금처럼 업체명 순(해당 없음 줄도 든다).
    expect(namesOf(view?.fit ?? [])).toEqual(["가온식품"]);
    expect(namesOf(view?.unverified ?? [])).toEqual(["나래전자", "다온상사", "라온기계", "마루정밀", "바다물산"]);
  });

  it("업체 줄 = 저장한 단계·점수·근거·확인 항목 그대로 + 확인 수(참고 뺌)·다음 할 일·지원 금액·해당 없음", async () => {
    const view = await readBucketCompanies(ALL, { bucketKey: "T7" }, NOW, tierSource());
    const row = (key: string) => view?.rows.find((r) => r.customerKey === key);
    expect(row("b:12")).toEqual({
      customerKey: "b:12", companyName: "나래전자", consultant: "담당 나래전자", consultantNames: ["담당 나래전자"], statusText: "계약 완료",
      fitLabels: ["업종", "지역"], toCheck: ["체납 여부 입력"], gaps: [], progress: null,
      verdict: "unverified",
      tier: "high", tierScore: 92, tierReason: "저장된 근거 b:12 T7", checkItems: [TAX], checkCount: 1,
      nextAction: ASK_TAX, unstructured: false,
      amountMaxWon: 300_000_000,
      dismissed: { reason: "이미 신청함", byName: "김컨설", at: "2026-11-11T03:00:00.000Z" },
    });
    expect(row("b:15")).toMatchObject({ checkItems: [CALL, REF], checkCount: 1, nextAction: ASK_CALL, dismissed: null, amountMaxWon: null });
    expect(row("b:13")).toMatchObject({ nextAction: "공고 원문에서 자격 먼저 확인" });
    expect(row("b:11")).toMatchObject({ tier: "high", checkCount: 0, nextAction: "고객에게 연락해 신청 안내" });
    expect(row("b:16")).toMatchObject({ unstructured: true, tier: "low", nextAction: "공고 조건 정리 대기" });
  });

  it("진행 중인 줄의 다음 할 일은 「업무 현황에서 진행 중」", async () => {
    const view = await readBucketCompanies(ALL, { bucketKey: "T3" }, NOW, tierSource());
    expect(view?.rows[0]).toMatchObject({ customerKey: "b:11", tier: "mid", nextAction: "업무 현황에서 진행 중" });
    expect(view?.rows[0].progress).toMatchObject({ trackId: "t-11" });
  });

  it("범위 안 업체만 — 내 담당이면 다른 담당 업체(라온기계)는 rows·수 모두에서 빠진다", async () => {
    const view = await readBucketCompanies(U1, { bucketKey: "T7" }, NOW, tierSource());
    expect(view?.rows.map((r) => r.customerKey)).toEqual(["b:11", "b:15", "b:13", "b:16", "b:12"]);
    expect(view?.tierCounts).toEqual({ high: 1, mid: 2, low: 0, unstructured: 1, dismissed: 1 });
  });

  it("해당 없음은 그 묶음 것만 읽는다", async () => {
    const src = tierSource();
    await readBucketCompanies(ALL, { bucketKey: "T7" }, NOW, src);
    expect(src.dismissals).toHaveBeenCalledTimes(1);
    expect(src.dismissals.mock.calls[0][0]).toEqual({ customerKeys: null, bucketKeys: ["T7"] });
    expect(src.tierConfig).toHaveBeenCalledTimes(1);
  });

  it("해당 없음 읽기 자리가 없는 앱 — 해당 없음 줄이 없는 것으로 읽는다", async () => {
    const src: ReadSource = tierSource();
    delete src.dismissals;
    const view = await readBucketCompanies(ALL, { bucketKey: "T7" }, NOW, src);
    expect(view?.tierCounts).toEqual({ high: 2, mid: 2, low: 1, unstructured: 1, dismissed: 0 });
    expect(view?.rows.every((r) => r.dismissed === null)).toBe(true);
  });
});

describe("옛 줄(대조 전 — 단계 칸 없음)은 읽을 때 계산한다", () => {
  const old = (over: Partial<ReadMatch>): ReadMatch => ({
    customerKey: "b:11", bucketKey: "T7", repAnnouncementId: "ann-T7", verdict: "fit", fitLabels: ["업종", "지역"], toCheck: [], gaps: [], ...over,
  });

  it("단계·확인 항목이 없으면 맞은 조건(fitLabels)·확인할 것(toCheck)으로 tierOf 를 부른 것과 같다", async () => {
    const view = await readBucketCompanies(ALL, { bucketKey: "T7" }, NOW, tierSource({ matches: [old({})], dismissals: [], progress: [] }));
    expect(view?.rows[0]).toMatchObject({
      tier: "high", tierScore: 100, tierReason: "조건 2개 모두 맞음", checkItems: [], checkCount: 0,
      nextAction: "고객에게 연락해 신청 안내", unstructured: false, amountMaxWon: null, dismissed: null,
    });
  });

  it("확인할 것이 있으면 그 갈래로 계산 — 저장 칸 둘(단계·확인 항목) 중 하나만 있어도 계산한다", async () => {
    const m = old({ verdict: "unverified", fitLabels: ["업종"], toCheck: ["체납 여부 입력"], tier: "low" });
    const want = tierOf({ verdict: "unverified", fit: [{ label: "업종", verdict: "pass", note: "" }], toCheck: ["체납 여부 입력"] });
    const view = await readBucketCompanies(ALL, { bucketKey: "T7" }, NOW, tierSource({ matches: [m], dismissals: [], progress: [] }));
    expect(view?.rows[0]).toMatchObject({
      tier: want.tier, tierScore: want.score, tierReason: want.reason, checkItems: want.checkItems, checkCount: 1,
      nextAction: nextActionOf({ tier: want.tier, checkItems: want.checkItems, unstructured: false, inProgress: false }),
    });
    expect(want.tier).toBe("high");
  });

  it("옛 줄 계산도 설정을 쓴다 — 칸 채우기 무게를 50으로 올리면 92점 높음이 50점 낮음", async () => {
    const m = old({ verdict: "unverified", fitLabels: ["업종"], toCheck: ["체납 여부 입력"] });
    const view = await readBucketCompanies(ALL, { bucketKey: "T7" }, NOW,
      tierSource({ matches: [m], dismissals: [], progress: [], config: { weights: { fieldGap: 50 } } }));
    expect(view?.rows[0]).toMatchObject({ tier: "low", tierScore: 50 });
  });

  it("다음 할 일 글자는 설정 글자를 쓴다", async () => {
    const view = await readBucketCompanies(ALL, { bucketKey: "T7" }, NOW,
      tierSource({ config: { text: { contact: "바로 연락하기", waitStructure: "공고 정리 기다림" } } }));
    const row = (key: string) => view?.rows.find((r) => r.customerKey === key);
    expect(row("b:11")?.nextAction).toBe("바로 연락하기");
    expect(row("b:16")?.nextAction).toBe("공고 정리 기다림");
  });

  it("설정을 읽다가 던져도 기본 글자로 읽는다", async () => {
    const src = tierSource();
    src.tierConfig.mockRejectedValueOnce(new Error("설정 표 없음"));
    const view = await readBucketCompanies(ALL, { bucketKey: "T7" }, NOW, src);
    expect(view?.rows[0].nextAction).toBe("고객에게 연락해 신청 안내");
  });
});

describe("readAnnouncementList — 공고 줄의 단계별 수·맞을 확률 순", () => {
  it("단계별 수(조건 정리 전 따로)·가장 높은 단계 — 해당 없음 줄도 센다", async () => {
    const view = await readAnnouncementList(ALL, { days: 14, hideEmpty: true }, NOW, tierSource());
    const row = (key: string) => [...view.dated, ...view.always].find((r) => r.bucketKey === key);
    expect(row("T7")).toMatchObject({ fit: 1, unverified: 5, tiers: { high: 2, mid: 2, low: 1 }, unstructured: 1, bestTier: "high" });
    expect(row("T5")).toMatchObject({ tiers: { high: 3, mid: 0, low: 0 }, unstructured: 0, bestTier: "high" });
    expect(row("TU")).toMatchObject({ tiers: { high: 0, mid: 0, low: 0 }, unstructured: 1, bestTier: null });
    expect(row("TA1")).toMatchObject({ tiers: { high: 0, mid: 1, low: 0 }, bestTier: "mid" });
  });

  it("정렬 없음·마감 순 = 지금 순서, 맞을 확률 순 = 가장 높은 단계 순(같으면 마감 순, 단계 없음은 뒤) — 줄 수는 같다", async () => {
    const plain = await readAnnouncementList(ALL, { days: 14, hideEmpty: true }, NOW, tierSource());
    expect(keysOf(plain.dated)).toEqual(["T3", "TU", "T5", "T7", "T10"]);
    expect(keysOf(plain.always)).toEqual(["TA1", "TA2"]);
    const byDeadline = await readAnnouncementList(ALL, { days: 14, hideEmpty: true, sort: "deadline" }, NOW, tierSource());
    expect(keysOf(byDeadline.dated)).toEqual(keysOf(plain.dated));
    const byTier = await readAnnouncementList(ALL, { days: 14, hideEmpty: true, sort: "tier" }, NOW, tierSource());
    expect(keysOf(byTier.dated)).toEqual(["T5", "T7", "T3", "T10", "TU"]);
    expect(keysOf(byTier.always)).toEqual(["TA2", "TA1"]);
  });

  it("단계 칸이 빈 수 줄(대조 전 옛 줄)은 낮음으로 센다", async () => {
    const old: ReadMatch = { customerKey: "b:11", bucketKey: "T7", repAnnouncementId: "ann-T7", verdict: "fit", fitLabels: [], toCheck: [], gaps: [] };
    const view = await readAnnouncementList(ALL, { days: 14, hideEmpty: true }, NOW, tierSource({ matches: [old] }));
    expect(view.dated[0]).toMatchObject({ bucketKey: "T7", fit: 1, tiers: { high: 0, mid: 0, low: 1 }, unstructured: 0, bestTier: "low" });
  });
});

describe("readContacts — 연락 예정 업체를 맞을 확률 순으로", () => {
  it("맞을 확률 순 = 업체의 가장 좋은 줄 기준(단계 → 확인 수 → 마감) — 해당 없음 줄은 늘 빠진다", async () => {
    const view = await readContacts(ALL, { ...CONTACT_14, sort: "tier" }, NOW, tierSource());
    expect(namesOf(view.companies)).toEqual(["라온기계", "가온식품", "다온상사", "마루정밀", "나래전자"]);
    const plain = await readContacts(ALL, CONTACT_14, NOW, tierSource());
    expect(namesOf(plain.companies)).toEqual(["다온상사", "라온기계", "가온식품", "마루정밀", "나래전자"]);
    const byDeadline = await readContacts(ALL, { ...CONTACT_14, sort: "deadline" }, NOW, tierSource());
    expect(namesOf(byDeadline.companies)).toEqual(namesOf(plain.companies));
  });

  it("업체 줄 = 지금 칸 + 가장 높은 단계·단계별 수·가장 좋은 줄(공고 칸 + 단계 칸)", async () => {
    const view = await readContacts(ALL, { ...CONTACT_14, sort: "tier" }, NOW, tierSource());
    expect(view.companies.find((c) => c.customerKey === "b:13")).toEqual({
      customerKey: "b:13", companyName: "다온상사", consultant: "담당 다온상사", consultantNames: ["담당 다온상사"], statusText: "계약 완료",
      nearestApplyEnd: "2026-11-17", nearestDDay: 5,
      kinds: [{ category: "정책자금", count: 1, nearestDDay: 7 }, { category: "무상지원금", count: 1, nearestDDay: 5 }],
      announcementCount: 2, progressCount: 0,
      bestTier: "high",
      tiers: { high: 1, mid: 1, low: 0, unstructured: 0 },
      best: {
        bucketKey: "T5", title: "공고 T5", category: "무상지원금", url: "https://example.com/T5", applyEnd: "2026-11-17", dDay: 5, amountMaxWon: null,
        tier: "high", tierScore: 92, tierReason: "저장된 근거 b:13 T5", checkItems: [TAX], checkCount: 1, nextAction: ASK_TAX, unstructured: false,
      },
    });
    // 나래전자 = 해당 없음(T7)을 뺀 T10 하나.
    expect(view.companies.find((c) => c.customerKey === "b:12")).toMatchObject({
      announcementCount: 1, bestTier: "mid", best: { bucketKey: "T10", checkCount: 2, nextAction: ASK_CALL },
    });
    // 사랑상회는 유일한 줄이 해당 없음이라 빠진다.
    expect(view.companies.find((c) => c.customerKey === "b:17")).toBeUndefined();
  });

  it("단계 거르기 — 그 단계 줄만 남기고, 남은 줄이 없는 업체는 뺀다", async () => {
    const high = await readContacts(ALL, { ...CONTACT_14, sort: "tier", tiers: ["high"] }, NOW, tierSource());
    expect(namesOf(high.companies)).toEqual(["라온기계", "가온식품", "다온상사"]);
    expect(high.companies.find((c) => c.customerKey === "b:13")).toMatchObject({
      announcementCount: 1, tiers: { high: 1, mid: 0, low: 0, unstructured: 0 }, best: { bucketKey: "T5" },
    });
  });

  it("단계 거르기는 조건 정리 전 줄에 걸지 않는다 — 조건 정리 전은 그 칸(includeUnstructured)이 정하고 늘 맨 뒤", async () => {
    const view = await readContacts(ALL, { days: 14, includeUnstructured: true, includeProgress: false, sort: "tier", tiers: ["high"] }, NOW, tierSource());
    expect(namesOf(view.companies)).toEqual(["라온기계", "가온식품", "다온상사", "바다물산"]);
    expect(view.companies[3]).toMatchObject({
      bestTier: "low", tiers: { high: 0, mid: 0, low: 0, unstructured: 2 }, best: { bucketKey: "TU", unstructured: true, nextAction: "공고 조건 정리 대기" },
    });
  });

  it("같은 단계·같은 확인 수면 마감 가까운 순, 같은 마감이면 점수 높은 순, 그다음 업체명 순", async () => {
    const view = await readContacts(ALL, { days: 14, includeUnstructured: false, includeProgress: true, sort: "tier", tiers: ["mid", "low"] }, NOW, tierSource());
    expect(namesOf(view.companies)).toEqual(["가온식품", "마루정밀", "다온상사", "나래전자", "라온기계"]);
    expect(view.companies[0]).toMatchObject({ best: { bucketKey: "T3", nextAction: "업무 현황에서 진행 중" }, progressCount: 1 });
  });

  it("해당 없음은 범위 안 업체·거르기 안 묶음 것만 읽는다", async () => {
    const src = tierSource();
    await readContacts(U1, CONTACT_14, NOW, src);
    for (const [f] of src.dismissals.mock.calls) {
      expect([...(f.customerKeys ?? [])].sort()).toEqual(["b:11", "b:12", "b:13", "b:15", "b:16", "b:17"]);
      expect(f.bucketKeys?.every((k) => ["T3", "TU", "T5", "T7", "T10"].includes(k))).toBe(true);
    }
    expect(src.dismissals).toHaveBeenCalled();
  });
});

describe("readCompanyAnnouncements — 업체 펼치기", () => {
  it("해당 없음 줄은 announcements 에서 빼고 dismissed 에 따로(사유·누가·언제)", async () => {
    const view = await readCompanyAnnouncements(ALL, { customerKey: "b:12", ...CONTACT_14 }, NOW, tierSource());
    expect(keysOf(view?.announcements ?? [])).toEqual(["T10"]);
    expect(view?.announcements[0]).toMatchObject({
      verdict: "unverified", tier: "mid", tierScore: 77, checkItems: [CALL, TAX], checkCount: 2, nextAction: ASK_CALL, dismissed: null, amountMaxWon: null,
    });
    expect(view?.dismissed).toEqual([
      {
        bucketKey: "T7", repAnnouncementId: "ann-T7", title: "공고 T7", agency: "중소벤처기업부", category: "정책자금",
        url: "https://example.com/T7", applyEnd: "2026-11-19", dDay: 7,
        verdict: "unverified", fitLabels: ["업종", "지역"], toCheck: ["체납 여부 입력"], gaps: [], progress: null,
        tier: "high", tierScore: 92, tierReason: "저장된 근거 b:12 T7", checkItems: [TAX], checkCount: 1, nextAction: ASK_TAX, unstructured: false,
        amountMaxWon: 300_000_000,
        dismissed: { reason: "이미 신청함", byName: "김컨설", at: "2026-11-11T03:00:00.000Z" },
      },
    ]);
  });

  it("남은 줄이 없어도 해당 없음 줄은 보인다 · 상시 해당 없음은 싣지 않는다(마감 거르기 밖)", async () => {
    const only = await readCompanyAnnouncements(ALL, { customerKey: "b:17", ...CONTACT_14 }, NOW, tierSource());
    expect(only?.announcements).toEqual([]);
    expect(keysOf(only?.dismissed ?? [])).toEqual(["T5"]);
    const always = await readCompanyAnnouncements(ALL, { customerKey: "b:15", ...CONTACT_14 }, NOW, tierSource());
    expect(always?.dismissed).toEqual([]);
  });

  it("맞을 확률 순 · 마감 순 · 단계 거르기", async () => {
    const q = { customerKey: "b:11", days: 14, includeUnstructured: false, includeProgress: true } as const;
    const byTier = await readCompanyAnnouncements(ALL, { ...q, sort: "tier" }, NOW, tierSource());
    expect(keysOf(byTier?.announcements ?? [])).toEqual(["T7", "T3"]);
    const plain = await readCompanyAnnouncements(ALL, q, NOW, tierSource());
    expect(keysOf(plain?.announcements ?? [])).toEqual(["T3", "T7"]);
    const mid = await readCompanyAnnouncements(ALL, { ...q, tiers: ["mid"] }, NOW, tierSource());
    expect(keysOf(mid?.announcements ?? [])).toEqual(["T3"]);
    expect(mid?.announcements[0]).toMatchObject({ nextAction: "업무 현황에서 진행 중", progress: { trackId: "t-11" } });
  });
});

describe("readSummary — 오늘 할 일 줄", () => {
  it("7일 안·해당 없음 아님·조건 정리 전 아님: 연락할 곳 = 진행 전 높음 · 확인 후 연락 = 진행 전 보통(앞에 안 든) · 진행함 = 진행 줄", async () => {
    expect((await readSummary(ALL, NOW, tierSource())).today).toEqual({ contactNow: 3, checkFirst: 1, inProgress: 1 });
    expect((await readSummary(U1, NOW, tierSource())).today).toEqual({ contactNow: 2, checkFirst: 1, inProgress: 1 });
  });

  it("연락 예정 수·분야별 수 = 해당 없음을 뺀 연락 예정 목록과 같다 · 7일 안 업체 수는 규칙 그대로(해당 없음·조건 정리 전 포함)", async () => {
    for (const scope of [ALL, U1]) {
      const summary = await readSummary(scope, NOW, tierSource());
      const contacts = await readContacts(scope, {
        days: CONTACTS_DEFAULT_DAYS, includeUnstructured: CONTACTS_INCLUDE_UNSTRUCTURED_DEFAULT, includeProgress: false,
      }, NOW, tierSource());
      expect(summary.contacts).toBe(contacts.companies.length);
      const withKind = (category: string) => contacts.companies.filter((c) => c.kinds.some((k) => k.category === category)).length;
      expect(summary.contactKinds.policyFund).toBe(withKind("정책자금"));
      expect(summary.contactKinds.freeGrant).toBe(withKind("무상지원금"));
    }
    expect(await readSummary(ALL, NOW, tierSource())).toMatchObject({ within7Companies: 7, contacts: 5, contactKinds: { policyFund: 4, freeGrant: 2, other: 1 } });
  });

  it("거르기 칸만 읽는다 — 전체 칸(matches) 없이 저장된 단계(tier)로 센다", async () => {
    const src = tierSource();
    await readSummary(ALL, NOW, src);
    expect(src.matches).not.toHaveBeenCalled();
    expect(src.matchKeys).toHaveBeenCalledTimes(1);
    expect(src.dismissals).toHaveBeenCalledTimes(1);
  });

  it("단계 칸이 없는 옛 줄은 맞은 조건·확인할 것으로 계산해 센다", async () => {
    const old = (customerKey: string, bucketKey: string, over: Partial<ReadMatch>): ReadMatch => ({
      customerKey, bucketKey, repAnnouncementId: `ann-${bucketKey}`, verdict: "fit", fitLabels: ["업종"], toCheck: [], gaps: [], ...over,
    });
    const src = tierSource({
      matches: [
        old("b:11", "T5", {}), // 100점 높음
        old("b:12", "T5", { verdict: "unverified", toCheck: ["조건 확인: 수출 실적"] }), // 80점 보통
        old("b:13", "T5", { verdict: "unverified", fitLabels: [], toCheck: ["공고 원문 확인(조건 정리 전)"] }), // 조건 정리 전
      ],
      dismissals: [],
      progress: [],
    });
    expect((await readSummary(ALL, NOW, src)).today).toEqual({ contactNow: 1, checkFirst: 1, inProgress: 0 });
  });
});

describe("readExport — 엑셀 단계 칸", () => {
  it("줄 수는 그대로(해당 없음 포함) · 단계·근거·다음 할 일·조건 정리 전·해당 없음 사유 칸", async () => {
    const view = await readExport(ALL, { days: 14, fitOnly: false }, NOW, tierSource());
    expect(view).toMatchObject({ total: 14, truncated: false });
    expect(view.rows).toHaveLength(14);
    const row = (title: string, name: string) => view.rows.find((r) => r.title === title && r.companyName === name);
    expect(row("공고 T7", "나래전자")).toEqual({
      applyEnd: "2026-11-19", dDay: 7, title: "공고 T7", agency: "중소벤처기업부", category: "정책자금", url: "https://example.com/T7",
      companyName: "나래전자", consultant: "담당 나래전자", statusText: "계약 완료", verdict: "unverified",
      fitLabels: ["업종", "지역"], toCheck: ["체납 여부 입력"], gaps: [], inProgress: false,
      tier: "high", tierReason: "저장된 근거 b:12 T7", nextAction: ASK_TAX, unstructured: false, dismissedReason: "이미 신청함",
    });
    expect(row("공고 T3", "가온식품")).toMatchObject({ inProgress: true, nextAction: "업무 현황에서 진행 중", dismissedReason: "" });
    expect(row("공고 TU", "바다물산")).toMatchObject({ tier: "low", unstructured: true, nextAction: "공고 조건 정리 대기" });
    expect(row("공고 TA1", "마루정밀")).toMatchObject({ dismissedReason: "기타" });
  });

  it("정렬 없음 = 지금 순서(묶음 마감 순, 안은 맞음 먼저·업체명 순)", async () => {
    const view = await readExport(ALL, { days: 14, fitOnly: false }, NOW, tierSource());
    expect(view.rows.map((r) => [r.title, r.companyName])).toEqual([
      ["공고 T3", "가온식품"],
      ["공고 TU", "바다물산"],
      ["공고 T5", "라온기계"], ["공고 T5", "사랑상회"], ["공고 T5", "다온상사"],
      ["공고 T7", "가온식품"], ["공고 T7", "나래전자"], ["공고 T7", "다온상사"], ["공고 T7", "라온기계"], ["공고 T7", "마루정밀"], ["공고 T7", "바다물산"],
      ["공고 T10", "나래전자"],
      ["공고 TA1", "마루정밀"],
      ["공고 TA2", "가온식품"],
    ]);
  });

  it("맞을 확률 순 = 묶음은 목록과 같은 단계 순, 묶음 안은 맞을 확률 순(해당 없음 맨 뒤)", async () => {
    const view = await readExport(ALL, { days: 14, fitOnly: false, sort: "tier" }, NOW, tierSource());
    expect(view.rows.map((r) => [r.title, r.companyName])).toEqual([
      ["공고 T5", "라온기계"], ["공고 T5", "다온상사"], ["공고 T5", "사랑상회"],
      ["공고 T7", "가온식품"], ["공고 T7", "마루정밀"], ["공고 T7", "다온상사"], ["공고 T7", "라온기계"], ["공고 T7", "바다물산"], ["공고 T7", "나래전자"],
      ["공고 T3", "가온식품"],
      ["공고 T10", "나래전자"],
      ["공고 TU", "바다물산"],
      ["공고 TA2", "가온식품"],
      ["공고 TA1", "마루정밀"],
    ]);
  });
});

describe("해당 없음 사유", () => {
  it("고를 수 있는 사유 다섯 가지", () => {
    expect([...DISMISS_REASONS]).toEqual(["이미 신청함", "고객이 원하지 않음", "자격이 안 됨", "다른 정책으로 진행", "기타"]);
  });
});

describe("묶음 조각을 동시에 읽는다(한 번에 최대 4조각)", () => {
  it("연락 예정 — 600묶음(6조각)을 동시에 2~4조각씩 읽고 결과는 같다", async () => {
    const companies = [company("b:11", "가온식품", ["u1"])];
    const buckets = Array.from({ length: 600 }, (_, i) => bucket(`K${String(i).padStart(3, "0")}`, "2026-11-19T05:00:00Z", "정책자금"));
    const matches = buckets.map((b) => stored("b:11", b.bucketKey, "high", 100, []));
    const src = tierSource({ companies, buckets, matches, progress: [], dismissals: [] });
    let inFlight = 0;
    let most = 0;
    const read = src.matches.getMockImplementation();
    src.matches.mockImplementation(async (f: KeyFilter) => {
      inFlight += 1;
      most = Math.max(most, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
      return read ? read(f) : [];
    });
    const view = await readContacts(ALL, CONTACT_14, NOW, src);
    expect(view.companies).toHaveLength(1);
    expect(view.companies[0].announcementCount).toBe(600);
    expect(src.matches).toHaveBeenCalledTimes(600 / EXPORT_BUCKET_CHUNK);
    expect(most).toBeGreaterThanOrEqual(2);
    expect(most).toBeLessThanOrEqual(4);
  });
});
