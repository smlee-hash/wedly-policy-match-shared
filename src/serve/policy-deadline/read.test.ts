// 정책별 고객사·연락 예정 읽기 — 보는 범위(scope)·마감 거르기·조건 정리 전·진행 빼기·엑셀 자르기.
// ERP 원본 시험을 옮기되 「누가 보나」는 로그인 사용자가 아니라 앱이 정한 범위(all·reader·keys)로 넘긴다.
import { describe, expect, it, vi } from "vitest";
import {
  bucketMetaOf,
  inDays,
  isUnstructuredMatch,
  progressInfoOf,
  readAnnouncementList,
  readBucketCompanies,
  readCompanyAnnouncements,
  readContacts,
  readExport,
  readSummary,
} from "./read";
import type { DeadlineScope } from "./scope";
import {
  CONTACTS_DEFAULT_DAYS,
  CONTACTS_INCLUDE_UNSTRUCTURED_DEFAULT,
  EXPORT_BUCKET_CHUNK,
  EXPORT_MAX_ROWS,
  type ContactCompanyRow,
  type DeadlineBucket,
  type ReadCompany,
  type ReadMatch,
  type ReadSource,
  type RunSummary,
  type StoredProgress,
} from "./types";

// 2026-11-12 10:00 KST
const NOW = new Date("2026-11-12T01:00:00Z");
const ALL: DeadlineScope = { kind: "all" };
const U1: DeadlineScope = { kind: "reader", readerId: "u1" };
const NOBODY: DeadlineScope = { kind: "reader", readerId: "u9" };

function bucket(bucketKey: string, applyEnd: string | null, category: string): DeadlineBucket {
  return {
    bucketKey,
    repAnnouncementId: `ann-${bucketKey}`,
    announcementIds: [`ann-${bucketKey}`, `ann-${bucketKey}-2`],
    title: `공고 ${bucketKey}`,
    agency: "중소벤처기업부",
    category,
    url: `https://example.com/${bucketKey}`,
    applyEnd: applyEnd ? new Date(applyEnd) : null,
  };
}

const BUCKETS: DeadlineBucket[] = [
  bucket("B7", "2026-11-19T05:00:00Z", "정책자금"), // D-7
  bucket("B3", "2026-11-15T05:00:00Z", "무상지원금"), // D-3
  bucket("B20", "2026-12-02T05:00:00Z", "R&D"), // D-20
  bucket("B0", "2026-11-12T14:00:00Z", ""), // 11/12 23:00 KST → D-0
  bucket("BPAST", "2026-11-11T05:00:00Z", "정책자금"), // D-1 지남
  bucket("BALW", null, "무상지원금"), // 상시
  bucket("B40", "2026-12-22T05:00:00Z", "정책자금"), // D-40
  bucket("BEMPTY", "2026-11-17T05:00:00Z", "기타"), // D-5, 판정 줄 없음
];

function company(customerKey: string, companyName: string, readConsultantIds: string[]): ReadCompany {
  return {
    customerKey,
    companyName,
    consultant: `담당 ${companyName}`,
    consultantNames: [`담당 ${companyName}`],
    readConsultantIds,
    statusText: "계약 완료",
    profileGaps: ["상시근로자 수"],
  };
}

const COMPANIES: ReadCompany[] = [
  company("b:1", "삼영식품", ["u1"]),
  company("b:2", "가나상사", ["u2"]),
  company("p:3", "다라테크", ["u1", "u2"]),
];

function match(customerKey: string, bucketKey: string, verdict: "fit" | "unverified", toCheck: string[] = []): ReadMatch {
  return {
    customerKey,
    bucketKey,
    repAnnouncementId: `ann-${bucketKey}`,
    verdict,
    fitLabels: verdict === "fit" ? ["업력"] : [],
    toCheck,
    gaps: verdict === "fit" ? [] : ["매출액"],
  };
}

const MATCHES: ReadMatch[] = [
  match("b:1", "B7", "fit"),
  match("b:1", "B3", "unverified", ["공고 원문 확인(조건 정리 전)"]),
  match("b:1", "B20", "unverified", ["매출 10억 이상"]),
  match("b:1", "BALW", "fit"),
  match("b:1", "B0", "fit"),
  match("b:2", "B7", "unverified", ["자격 조건 원문 확인"]),
  match("b:2", "B40", "fit"),
  match("p:3", "B7", "fit"),
  match("p:3", "BPAST", "fit"),
  match("p:3", "B3", "unverified", ["업력 3년 이상"]),
];

const PROGRESS: StoredProgress[] = [
  { customerKey: "b:1", bucketKey: "B7", trackId: "t-1", byUserId: "u1", byName: "김컨설", via: "web", createdAt: new Date("2026-11-11T02:00:00Z") },
];

const LAST_RUN: RunSummary = {
  kind: "full", startedAt: "2026-11-12T00:20:00.000Z", finishedAt: "2026-11-12T00:24:00.000Z",
  companies: 3, buckets: 8, upserts: 10, deletes: 0, errors: 0,
};

function memorySource(data: {
  companies?: ReadCompany[];
  buckets?: DeadlineBucket[];
  matches?: ReadMatch[];
  progress?: StoredProgress[];
} = {}) {
  const companies = data.companies ?? COMPANIES;
  const buckets = data.buckets ?? BUCKETS;
  const matches = data.matches ?? MATCHES;
  const progress = data.progress ?? PROGRESS;
  const inKeys = (keys: string[] | null, key: string) => keys === null || keys.includes(key);
  const src = {
    companies: vi.fn(async (f: { readerId?: string; customerKeys?: string[] }) =>
      companies.filter((c) => (f.readerId === undefined || c.readConsultantIds.includes(f.readerId))
        && (f.customerKeys === undefined || f.customerKeys.includes(c.customerKey)))),
    buckets: vi.fn(async (keys?: string[]) => buckets.filter((b) => !keys || keys.includes(b.bucketKey))),
    matchCounts: vi.fn(async (keys: string[] | null) => {
      const counts = new Map<string, { bucketKey: string; verdict: "fit" | "unverified"; count: number }>();
      for (const m of matches) {
        if (!inKeys(keys, m.customerKey)) continue;
        const id = `${m.bucketKey}|${m.verdict}`;
        const row = counts.get(id) ?? { bucketKey: m.bucketKey, verdict: m.verdict, count: 0 };
        row.count += 1;
        counts.set(id, row);
      }
      return [...counts.values()];
    }),
    matches: vi.fn(async (f: { customerKeys: string[] | null; bucketKeys?: string[] }) =>
      matches.filter((m) => inKeys(f.customerKeys, m.customerKey) && (!f.bucketKeys || f.bucketKeys.includes(m.bucketKey)))),
    matchKeys: vi.fn(async (f: { customerKeys: string[] | null; bucketKeys?: string[] }) =>
      matches.filter((m) => inKeys(f.customerKeys, m.customerKey) && (!f.bucketKeys || f.bucketKeys.includes(m.bucketKey)))
        .map(({ customerKey, bucketKey, verdict, toCheck }) => ({ customerKey, bucketKey, verdict, toCheck }))),
    progress: vi.fn(async (f: { customerKeys: string[] | null; bucketKeys?: string[] }) =>
      progress.filter((p) => inKeys(f.customerKeys, p.customerKey) && (!f.bucketKeys || f.bucketKeys.includes(p.bucketKey)))),
    lastRun: vi.fn(async () => LAST_RUN),
  } satisfies ReadSource;
  return src;
}

const keysOf = (rows: { bucketKey: string }[]) => rows.map((r) => r.bucketKey);

/** 연락 예정 줄 중 그 분야 공고가 하나라도 있는 업체 수 — 요약 카드 숫자가 이것과 같아야 한다. */
const withKind = (rows: ContactCompanyRow[], category: string) => rows.filter((r) => r.kinds.some((k) => k.category === category)).length;
const withOtherKind = (rows: ContactCompanyRow[]) =>
  rows.filter((r) => r.kinds.some((k) => k.category !== "정책자금" && k.category !== "무상지원금")).length;

describe("작은 판정", () => {
  it("조건 정리 전 = 확인 필요이고 확인할 조건이 공용 두 문구뿐(빈 목록 포함)", () => {
    expect(isUnstructuredMatch({ verdict: "unverified", toCheck: [] })).toBe(true);
    expect(isUnstructuredMatch({ verdict: "unverified", toCheck: ["공고 원문 확인(조건 정리 전)"] })).toBe(true);
    expect(isUnstructuredMatch({ verdict: "unverified", toCheck: ["자격 조건 원문 확인", "공고 원문 확인(조건 정리 전)"] })).toBe(true);
    expect(isUnstructuredMatch({ verdict: "unverified", toCheck: ["자격 조건 원문 확인", "업력 3년 이상"] })).toBe(false);
    expect(isUnstructuredMatch({ verdict: "fit", toCheck: [] })).toBe(false);
  });

  it("묶음 → 표시 칸 — KST 날짜·공용 D-n, 상시는 null", () => {
    expect(bucketMetaOf(BUCKETS[0], NOW)).toEqual({
      bucketKey: "B7", repAnnouncementId: "ann-B7", title: "공고 B7", agency: "중소벤처기업부",
      category: "정책자금", url: "https://example.com/B7", applyEnd: "2026-11-19", dDay: 7,
    });
    expect(bucketMetaOf(BUCKETS[3], NOW)).toMatchObject({ applyEnd: "2026-11-12", dDay: 0 });
    expect(bucketMetaOf(BUCKETS[4], NOW)).toMatchObject({ applyEnd: "2026-11-11", dDay: -1 });
    expect(bucketMetaOf(BUCKETS[5], NOW)).toMatchObject({ applyEnd: null, dDay: null });
  });

  it("마감 거르기 — 0 ≤ D-n ≤ days, 상시·지난 마감은 빠진다", () => {
    expect(inDays(0, 7)).toBe(true);
    expect(inDays(7, 7)).toBe(true);
    expect(inDays(8, 7)).toBe(false);
    expect(inDays(30, 30)).toBe(true);
    expect(inDays(400, "all")).toBe(true);
    expect(inDays(-1, "all")).toBe(false);
    expect(inDays(null, "all")).toBe(false);
    expect(inDays(null, 30)).toBe(false);
  });

  it("진행 줄 → 표시 칸", () => {
    expect(progressInfoOf(PROGRESS[0])).toEqual({ trackId: "t-1", byName: "김컨설", via: "web", at: "2026-11-11T02:00:00.000Z" });
  });
});

describe("readAnnouncementList — 정책별 고객사 목록", () => {
  it("내 담당(reader) 30일 — 범위 안 업체만 세고, 마감 가까운 순, 빈 줄 숨김, 상시는 따로", async () => {
    const src = memorySource();
    const view = await readAnnouncementList(U1, { days: 30, hideEmpty: true }, NOW, src);
    expect(src.companies).toHaveBeenCalledWith(expect.objectContaining({ readerId: "u1" }));
    expect([...(src.matchCounts.mock.calls[0][0] ?? [])].sort()).toEqual(["b:1", "p:3"]);
    expect(view.lastRun).toEqual(LAST_RUN);
    expect(view.companyCount).toBe(2);
    expect(view.bucketCount).toBe(8);
    expect(view.categories).toEqual(["R&D", "기타", "무상지원금", "정책자금"]);
    expect(view.dated.map((r) => [r.bucketKey, r.fit, r.unverified])).toEqual([
      ["B0", 1, 0],
      ["B3", 0, 2],
      ["B7", 2, 0],
      ["B20", 0, 1],
    ]);
    expect(view.dated[0]).toMatchObject({ applyEnd: "2026-11-12", dDay: 0, title: "공고 B0", category: "" });
    expect(view.always.map((r) => [r.bucketKey, r.fit, r.unverified])).toEqual([["BALW", 1, 0]]);
  });

  it("빈 줄 보이기·7일 — 판정 없는 묶음도 0으로, 지난 마감·D-8 이상은 빠진다", async () => {
    const view = await readAnnouncementList(U1, { days: 7, hideEmpty: false }, NOW, memorySource());
    expect(keysOf(view.dated)).toEqual(["B0", "B3", "BEMPTY", "B7"]);
    expect(view.dated[2]).toMatchObject({ bucketKey: "BEMPTY", fit: 0, unverified: 0 });
  });

  it("전체(all) — 업체로 거르지 않고(null) 전부 센다", async () => {
    const src = memorySource();
    const view = await readAnnouncementList(ALL, { days: "all", hideEmpty: true }, NOW, src);
    expect(src.matchCounts).toHaveBeenCalledWith(null);
    expect(view.companyCount).toBe(3);
    expect(view.dated.find((r) => r.bucketKey === "B7")).toMatchObject({ fit: 2, unverified: 1 });
    expect(keysOf(view.dated)).toEqual(["B0", "B3", "B7", "B20", "B40"]);
  });

  it("앱이 정한 업체 열쇠(keys) — 그 업체만 센다", async () => {
    const src = memorySource();
    const view = await readAnnouncementList({ kind: "keys", customerKeys: ["b:2"] }, { days: "all", hideEmpty: true }, NOW, src);
    expect(src.companies).toHaveBeenCalledWith({ customerKeys: ["b:2"] });
    expect(src.matchCounts).toHaveBeenCalledWith(["b:2"]);
    expect(view.companyCount).toBe(1);
    expect(view.dated.find((r) => r.bucketKey === "B7")).toMatchObject({ fit: 0, unverified: 1 });
  });

  it("범위 안 업체가 0곳이면 판정 수를 읽지 않는다", async () => {
    const src = memorySource();
    const view = await readAnnouncementList(NOBODY, { days: 30, hideEmpty: true }, NOW, src);
    expect(src.matchCounts).not.toHaveBeenCalled();
    expect(view.companyCount).toBe(0);
    expect(view.dated).toEqual([]);
    expect(view.always).toEqual([]);
  });

  it("열쇠 목록이 빈 배열이면 DB 읽기 자리를 아예 부르지 않는다", async () => {
    const src = memorySource();
    const view = await readAnnouncementList({ kind: "keys", customerKeys: [] }, { days: 30, hideEmpty: true }, NOW, src);
    expect(src.companies).not.toHaveBeenCalled();
    expect(src.matchCounts).not.toHaveBeenCalled();
    expect(view.companyCount).toBe(0);
  });
});

describe("readBucketCompanies — 묶음 하나 펼치기", () => {
  it("범위 안 업체만 맞음·확인 필요로 나누고 업체명 순, 진행을 붙인다", async () => {
    const view = await readBucketCompanies(U1, { bucketKey: "B7" }, NOW, memorySource());
    expect(view?.bucket).toMatchObject({ bucketKey: "B7", applyEnd: "2026-11-19", dDay: 7 });
    expect(view?.fit.map((r) => r.companyName)).toEqual(["다라테크", "삼영식품"]);
    expect(view?.unverified).toEqual([]);
    expect(view?.fit[1]).toEqual({
      customerKey: "b:1", companyName: "삼영식품", consultant: "담당 삼영식품", consultantNames: ["담당 삼영식품"],
      statusText: "계약 완료", fitLabels: ["업력"], toCheck: [], gaps: [],
      progress: { trackId: "t-1", byName: "김컨설", via: "web", at: "2026-11-11T02:00:00.000Z" },
    });
    expect(view?.fit[0].progress).toBeNull();
  });

  it("전체는 다른 담당 업체도 보인다", async () => {
    const view = await readBucketCompanies(ALL, { bucketKey: "B7" }, NOW, memorySource());
    expect(view?.unverified.map((r) => [r.companyName, r.toCheck])).toEqual([["가나상사", ["자격 조건 원문 확인"]]]);
  });

  it("같은 이름이면 customerKey 순", async () => {
    const src = memorySource({
      companies: [company("p:9", "같은상호", ["u1"]), company("b:8", "같은상호", ["u1"])],
      matches: [match("p:9", "B7", "fit"), match("b:8", "B7", "fit")],
      progress: [],
    });
    const view = await readBucketCompanies(U1, { bucketKey: "B7" }, NOW, src);
    expect(view?.fit.map((r) => r.customerKey)).toEqual(["b:8", "p:9"]);
  });

  it("없는 묶음이면 null", async () => {
    expect(await readBucketCompanies(ALL, { bucketKey: "NOPE" }, NOW, memorySource())).toBeNull();
  });
});

describe("readContacts — 연락 예정 업체", () => {
  it("조건 정리 전 기본값은 「넣지 않음」", () => {
    expect(CONTACTS_INCLUDE_UNSTRUCTURED_DEFAULT).toBe(false);
    expect(CONTACTS_DEFAULT_DAYS).toBe(14);
  });

  it("기본 — 조건 정리 전·진행한 공고·상시를 빼고, 남은 공고가 없는 업체는 뺀다", async () => {
    const src = memorySource();
    const view = await readContacts(U1, { days: 14, includeUnstructured: false, includeProgress: false }, NOW, src);
    expect(view.companies).toEqual([
      {
        customerKey: "b:1", companyName: "삼영식품", consultant: "담당 삼영식품", consultantNames: ["담당 삼영식품"], statusText: "계약 완료",
        nearestApplyEnd: "2026-11-12", nearestDDay: 0,
        kinds: [{ category: "", count: 1, nearestDDay: 0 }],
        announcementCount: 1, progressCount: 0,
      },
      {
        customerKey: "p:3", companyName: "다라테크", consultant: "담당 다라테크", consultantNames: ["담당 다라테크"], statusText: "계약 완료",
        nearestApplyEnd: "2026-11-15", nearestDDay: 3,
        kinds: [{ category: "정책자금", count: 1, nearestDDay: 7 }, { category: "무상지원금", count: 1, nearestDDay: 3 }],
        announcementCount: 2, progressCount: 0,
      },
    ]);
    const bucketKeys = src.matches.mock.calls.flatMap((c) => c[0].bucketKeys ?? ["(전부)"]);
    expect(bucketKeys).not.toContain("BALW");
    expect(bucketKeys).not.toContain("B40");
    expect(bucketKeys).not.toContain("BPAST");
    expect(bucketKeys).not.toContain("(전부)");
  });

  it("조건 정리 전·진행 포함 30일 — 분야 순서 = 정책자금, 무상지원금, 그 밖 글자 순, 빈 분류 맨 끝", async () => {
    const view = await readContacts(U1, { days: 30, includeUnstructured: true, includeProgress: true }, NOW, memorySource());
    const c1 = view.companies.find((c) => c.customerKey === "b:1");
    expect(c1?.kinds).toEqual([
      { category: "정책자금", count: 1, nearestDDay: 7 },
      { category: "무상지원금", count: 1, nearestDDay: 3 },
      { category: "R&D", count: 1, nearestDDay: 20 },
      { category: "", count: 1, nearestDDay: 0 },
    ]);
    expect(c1?.announcementCount).toBe(4);
    expect(c1?.progressCount).toBe(1);
  });

  it("전체 — 조건 정리 전만 있는 업체(가나상사)는 기본에서 빠진다", async () => {
    const base = await readContacts(ALL, { days: 14, includeUnstructured: false, includeProgress: false }, NOW, memorySource());
    expect(base.companies.map((c) => c.companyName)).toEqual(["삼영식품", "다라테크"]);
    const wide = await readContacts(ALL, { days: 14, includeUnstructured: true, includeProgress: false }, NOW, memorySource());
    expect(wide.companies.map((c) => c.companyName)).toEqual(["삼영식품", "다라테크", "가나상사"]);
  });

  it("가장 가까운 마감이 같으면 업체명 순", async () => {
    const src = memorySource({
      companies: [company("b:5", "하나", ["u1"]), company("b:6", "가람", ["u1"])],
      matches: [match("b:5", "B7", "fit"), match("b:6", "B7", "fit")],
      progress: [],
    });
    const view = await readContacts(U1, { days: 14, includeUnstructured: false, includeProgress: false }, NOW, src);
    expect(view.companies.map((c) => c.companyName)).toEqual(["가람", "하나"]);
  });
});

describe("readCompanyAnnouncements — 연락 예정 업체 펼치기", () => {
  it("같은 거르기를 업체 하나에 — 마감 가까운 순, 진행 붙임", async () => {
    const base = await readCompanyAnnouncements(U1, { customerKey: "b:1", days: 14, includeUnstructured: false, includeProgress: false }, NOW, memorySource());
    expect(base?.company.companyName).toBe("삼영식품");
    expect(keysOf(base?.announcements ?? [])).toEqual(["B0"]);

    const wide = await readCompanyAnnouncements(U1, { customerKey: "b:1", days: 14, includeUnstructured: true, includeProgress: true }, NOW, memorySource());
    expect(keysOf(wide?.announcements ?? [])).toEqual(["B0", "B3", "B7"]);
    expect(wide?.announcements[2]).toMatchObject({
      bucketKey: "B7", verdict: "fit", applyEnd: "2026-11-19", dDay: 7, fitLabels: ["업력"],
      progress: { trackId: "t-1", byName: "김컨설", via: "web" },
    });
    expect(wide?.announcements[1]).toMatchObject({ verdict: "unverified", toCheck: ["공고 원문 확인(조건 정리 전)"], progress: null });
  });

  it("범위 밖 업체·없는 업체는 null — 전체 범위는 다른 담당 업체도 본다", async () => {
    const q = { days: 30 as const, includeUnstructured: true, includeProgress: true };
    expect(await readCompanyAnnouncements(U1, { customerKey: "b:2", ...q }, NOW, memorySource())).toBeNull();
    expect(await readCompanyAnnouncements(U1, { customerKey: "b:999", ...q }, NOW, memorySource())).toBeNull();
    expect(await readCompanyAnnouncements(ALL, { customerKey: "b:999", ...q }, NOW, memorySource())).toBeNull();
    const all = await readCompanyAnnouncements(ALL, { customerKey: "b:2", ...q }, NOW, memorySource());
    expect(keysOf(all?.announcements ?? [])).toEqual(["B7"]);
  });

  it("keys 범위 — 열쇠에 든 업체만 볼 수 있다", async () => {
    const q = { days: 30 as const, includeUnstructured: true, includeProgress: true };
    const scope: DeadlineScope = { kind: "keys", customerKeys: ["b:2"] };
    expect(await readCompanyAnnouncements(scope, { customerKey: "b:1", ...q }, NOW, memorySource())).toBeNull();
    const own = await readCompanyAnnouncements(scope, { customerKey: "b:2", ...q }, NOW, memorySource());
    expect(own?.company.companyName).toBe("가나상사");
  });
});

describe("readSummary — 요약 카드·탭 옆 숫자", () => {
  it("7일 안 업체 수는 조건 정리·진행과 상관없이, 연락 예정 수는 기본 거르기와 같다", async () => {
    const mine = await readSummary(U1, NOW, memorySource());
    expect(mine.within7Companies).toBe(2);
    const contacts = await readContacts(U1, {
      days: CONTACTS_DEFAULT_DAYS, includeUnstructured: CONTACTS_INCLUDE_UNSTRUCTURED_DEFAULT, includeProgress: false,
    }, NOW, memorySource());
    expect(mine.contacts).toBe(contacts.companies.length);

    const all = await readSummary(ALL, NOW, memorySource());
    expect(all).toMatchObject({ within7Companies: 3, contacts: 2 });
  });

  it("마감 고르기별 공고 수 = 그 마감으로 연 「정책별 고객사」 목록(0곳 숨김)의 날짜 마감 줄 수 — 상시·지난 마감·0곳 공고는 세지 않는다", async () => {
    const cases = [
      { scope: U1, want: { d7: 3, d14: 3, d30: 4, all: 4 } },
      { scope: ALL, want: { d7: 3, d14: 3, d30: 4, all: 5 } },
    ];
    const days = { d7: 7, d14: 14, d30: 30, all: "all" } as const;
    for (const { scope, want } of cases) {
      const summary = await readSummary(scope, NOW, memorySource());
      expect(summary.buckets).toEqual(want);
      for (const key of ["d7", "d14", "d30", "all"] as const) {
        const list = await readAnnouncementList(scope, { days: days[key], hideEmpty: true }, NOW, memorySource());
        expect(summary.buckets[key]).toBe(list.dated.length);
      }
    }
  });

  it("연락 예정 분야별 업체 수 = 기본 거르기 연락 예정 목록에서 그 분야 공고가 있는 업체 수 — 한 업체가 여러 분야면 각 분야에 센다", async () => {
    for (const scope of [U1, ALL]) {
      const summary = await readSummary(scope, NOW, memorySource());
      // 삼영식품 = 분류 없음(그 밖) 하나, 다라테크 = 정책자금·무상지원금.
      expect(summary.contactKinds).toEqual({ policyFund: 1, freeGrant: 1, other: 1 });
      const contacts = await readContacts(scope, {
        days: CONTACTS_DEFAULT_DAYS, includeUnstructured: CONTACTS_INCLUDE_UNSTRUCTURED_DEFAULT, includeProgress: false,
      }, NOW, memorySource());
      expect(summary.contactKinds.policyFund).toBe(withKind(contacts.companies, "정책자금"));
      expect(summary.contactKinds.freeGrant).toBe(withKind(contacts.companies, "무상지원금"));
      expect(summary.contactKinds.other).toBe(withOtherKind(contacts.companies));
    }
  });

  it("판정 줄은 거르기 칸만 한 번 읽는다 — 14일 안 날짜 마감 묶음만, 전체 칸 읽기 없음", async () => {
    const src = memorySource();
    expect(await readSummary(ALL, NOW, src)).toMatchObject({ within7Companies: 3, contacts: 2 });
    expect(src.matches).not.toHaveBeenCalled();
    expect(src.matchCounts).toHaveBeenCalledTimes(1);
    expect(src.matchCounts.mock.calls[0][0]).toBeNull();
    expect(src.matchKeys).toHaveBeenCalledTimes(1);
    expect(src.matchKeys.mock.calls[0][0].customerKeys).toBeNull();
    expect([...(src.matchKeys.mock.calls[0][0].bucketKeys ?? [])].sort()).toEqual(["B0", "B3", "B7", "BEMPTY"]);
    expect(src.progress).toHaveBeenCalledTimes(1);
  });

  it("7일 안과 연락 예정은 같은 줄에서 따로 센다 — 8~14일만 있는 업체는 연락 예정에만, 7일 안 진행·조건 정리 전 줄만 있는 업체는 7일 안에만", async () => {
    const src = memorySource({
      companies: [company("b:7", "칠일", ["u1"]), company("b:8", "열흘", ["u1"]), company("b:9", "정리전", ["u1"])],
      buckets: [
        bucket("B7", "2026-11-19T05:00:00Z", "정책자금"), // D-7
        bucket("B10", "2026-11-22T05:00:00Z", "정책자금"), // D-10
        bucket("B15", "2026-11-27T05:00:00Z", "정책자금"), // D-15
      ],
      matches: [
        match("b:7", "B7", "fit"),
        match("b:8", "B10", "fit"),
        match("b:9", "B7", "unverified", ["공고 원문 확인(조건 정리 전)"]),
        match("b:9", "B15", "fit"),
      ],
      progress: [{ customerKey: "b:7", bucketKey: "B7", trackId: "t-7", byUserId: "u1", byName: "김컨설", via: "web", createdAt: NOW }],
    });
    expect(await readSummary(U1, NOW, src)).toMatchObject({
      within7Companies: 2, contacts: 1, buckets: { d7: 1, d14: 2, d30: 3, all: 3 }, contactKinds: { policyFund: 1, freeGrant: 0, other: 0 },
    });
    expect([...(src.matchKeys.mock.calls[0][0].customerKeys ?? [])].sort()).toEqual(["b:7", "b:8", "b:9"]);
    expect([...(src.matchKeys.mock.calls[0][0].bucketKeys ?? [])].sort()).toEqual(["B10", "B7"]);
  });

  it(`묶음 ${EXPORT_BUCKET_CHUNK}개씩 나눠 읽는다`, async () => {
    const companies = [company("b:1", "삼영식품", ["u1"])];
    const buckets = Array.from({ length: 150 }, (_, i) => bucket(`K${String(i).padStart(3, "0")}`, "2026-11-19T05:00:00Z", "정책자금"));
    const matches = buckets.map((b) => match("b:1", b.bucketKey, "fit"));
    const src = memorySource({ companies, buckets, matches, progress: [] });
    expect(await readSummary(U1, NOW, src)).toMatchObject({ within7Companies: 1, contacts: 1 });
    expect(src.matchKeys).toHaveBeenCalledTimes(2);
    for (const call of src.matchKeys.mock.calls) expect(call[0].bucketKeys?.length).toBeLessThanOrEqual(EXPORT_BUCKET_CHUNK);
  });

  it("범위 안 업체가 없으면 판정 줄을 읽지 않는다", async () => {
    const src = memorySource();
    expect(await readSummary(NOBODY, NOW, src)).toEqual({
      within7Companies: 0, contacts: 0, buckets: { d7: 0, d14: 0, d30: 0, all: 0 }, contactKinds: { policyFund: 0, freeGrant: 0, other: 0 },
    });
    expect(src.matchCounts).not.toHaveBeenCalled();
    expect(src.matchKeys).not.toHaveBeenCalled();
    expect(src.matches).not.toHaveBeenCalled();
  });
});

describe("readExport — 엑셀 줄", () => {
  it("목록 순서대로, 묶음 안은 맞음 먼저·업체명 순, 진행 여부 표시", async () => {
    const view = await readExport(U1, { days: 30, fitOnly: false }, NOW, memorySource());
    expect(view.rows.map((r) => [r.title, r.companyName, r.verdict, r.inProgress])).toEqual([
      ["공고 B0", "삼영식품", "fit", false],
      ["공고 B3", "다라테크", "unverified", false],
      ["공고 B3", "삼영식품", "unverified", false],
      ["공고 B7", "다라테크", "fit", false],
      ["공고 B7", "삼영식품", "fit", true],
      ["공고 B20", "삼영식품", "unverified", false],
      ["공고 BALW", "삼영식품", "fit", false],
    ]);
    expect(view.rows[1]).toEqual({
      applyEnd: "2026-11-15", dDay: 3, title: "공고 B3", agency: "중소벤처기업부", category: "무상지원금", url: "https://example.com/B3",
      companyName: "다라테크", consultant: "담당 다라테크", statusText: "계약 완료", verdict: "unverified",
      fitLabels: [], toCheck: ["업력 3년 이상"], gaps: ["매출액"], inProgress: false,
    });
    expect(view.rows[6]).toMatchObject({ applyEnd: null, dDay: null });
    expect(view).toMatchObject({ total: 7, truncated: false });
  });

  it("맞음만·분류 거르기 — 수(total)도 같은 거르기로", async () => {
    const fit = await readExport(U1, { days: 30, fitOnly: true }, NOW, memorySource());
    expect(fit.rows.map((r) => [r.title, r.companyName])).toEqual([
      ["공고 B0", "삼영식품"], ["공고 B7", "다라테크"], ["공고 B7", "삼영식품"], ["공고 BALW", "삼영식품"],
    ]);
    expect(fit.total).toBe(4);

    const fund = await readExport(U1, { days: 30, fitOnly: false, category: "정책자금" }, NOW, memorySource());
    expect(fund.rows.map((r) => r.title)).toEqual(["공고 B7", "공고 B7"]);
    expect(fund.total).toBe(2);

    const none = await readExport(U1, { days: 30, fitOnly: false, category: "" }, NOW, memorySource());
    expect(none.rows.map((r) => r.title)).toEqual(["공고 B0"]);
    expect(none.total).toBe(1);
  });

  it("범위 밖 업체 줄은 싣지 않는다", async () => {
    const view = await readExport(U1, { days: "all", fitOnly: false }, NOW, memorySource());
    expect(view.rows.map((r) => r.companyName)).not.toContain("가나상사");
  });

  it(`묶음 ${EXPORT_BUCKET_CHUNK}개씩 나눠 읽고 ${EXPORT_MAX_ROWS}줄에서 멈춘다`, async () => {
    const companies = Array.from({ length: 300 }, (_, i) => company(`b:${String(i).padStart(4, "0")}`, `업체${String(i).padStart(4, "0")}`, ["u1"]));
    const buckets = Array.from({ length: 250 }, (_, i) => bucket(`K${String(i).padStart(3, "0")}`, "2026-11-19T05:00:00Z", "정책자금"));
    const matches = buckets.flatMap((b) => companies.map((c) => match(c.customerKey, b.bucketKey, "fit")));
    const src = memorySource({ companies, buckets, matches, progress: [] });
    const view = await readExport(ALL, { days: 30, fitOnly: false }, NOW, src);
    expect(view.rows).toHaveLength(EXPORT_MAX_ROWS);
    expect(view.total).toBe(75_000);
    expect(view.truncated).toBe(true);
    expect(view.rows[0]).toMatchObject({ title: "공고 K000", companyName: "업체0000" });
    expect(src.matches).toHaveBeenCalledTimes(2);
    for (const call of src.matches.mock.calls) expect(call[0].bucketKeys?.length).toBeLessThanOrEqual(EXPORT_BUCKET_CHUNK);
  });
});
