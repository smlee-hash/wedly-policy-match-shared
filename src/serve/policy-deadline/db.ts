/**
 * 정책별 고객사 읽기의 DB 창구 — 표 여섯 개(해당 없음 표 포함)를 **구조형**으로만 안다(Prisma 클라이언트를 가져오지 않는다).
 *
 * 앱은 자기 Prisma 클라이언트를 `deadlineReadSource(prisma)` 로 그대로 넘긴다. 아래 형은 ERP·컨설턴트 앱
 * 두 곳의 Prisma 로 형 검사를 통과한 모양이라 **바꾸지 않는다**(칸이 더 필요하면 두 앱을 함께 확인한다).
 * 동작은 ERP 운영 읽기 자리(`prismaReadSource`)와 같다: 열쇠 목록이 빈 배열이면 DB 를 부르지 않고 빈 결과를 낸다.
 */
import { readLastRun } from "./store";
import type { CheckItem, DeadlineTier, DeadlineVerdict, ReadCompany, ReadSource, StoredDismissal, StoredProgress } from "./types";

type In = { in: string[] };

export interface CompanyReadRow {
  customerKey: string;
  companyName: string;
  consultant: string;
  consultantNames: string[];
  readConsultantIds: string[];
  statusText: string;
  profileGaps: string[];
}

/** 표 다섯 개를 읽는 자리 — Prisma 클라이언트가 그대로 맞는다. */
export interface DeadlineReadDb {
  policyDeadlineCompany: {
    findMany(args: {
      where: { readConsultantIds?: { has: string }; customerKey?: In };
      select: {
        customerKey: true;
        companyName: true;
        consultant: true;
        consultantNames: true;
        readConsultantIds: true;
        statusText: true;
        profileGaps: true;
      };
    }): PromiseLike<CompanyReadRow[]>;
  };
  policyDeadlineBucket: {
    findMany(args: { where: { bucketKey?: In } }): PromiseLike<
      Array<{
        bucketKey: string;
        repAnnouncementId: string;
        announcementIds: string[];
        title: string;
        agency: string;
        category: string;
        url: string;
        applyEnd: Date | null;
        /** 칸이 없는 옛 Prisma 클라이언트도 맞게 선택 칸 — select 를 쓰지 않아 칸이 있으면 함께 온다. */
        summary?: string;
        /** 지원 금액 한 줄 — summary 와 같은 까닭으로 선택 칸(2026-11-23). */
        amountText?: string;
      }>
    >;
  };
  policyDeadlineMatch: {
    groupBy(args: {
      by: ["bucketKey", "verdict", "tier", "unstructured"];
      where: { customerKey?: In };
      _count: { _all: true };
    }): PromiseLike<unknown>;
    findMany(args: { where: { customerKey?: In; bucketKey?: In } }): PromiseLike<
      Array<{
        customerKey: string;
        bucketKey: string;
        repAnnouncementId: string;
        verdict: string;
        fitLabels: string[];
        toCheck: string[];
        gaps: string[];
        /** 대조 때 저장한 칸 — 칸이 없는 옛 Prisma 클라이언트도 맞게 선택 칸. select 를 쓰지 않아 칸이 있으면 함께 온다. */
        tier?: string | null;
        tierScore?: number | null;
        tierReason?: string | null;
        /** Prisma Json 칸 — 모양은 읽을 때 줄마다 확인한다. */
        checkItems?: unknown;
        amountMaxWon?: number | bigint | null;
      }>
    >;
  };
  policyDeadlineProgress: {
    findMany(args: { where: { customerKey?: In; bucketKey?: In } }): PromiseLike<
      Array<{
        customerKey: string;
        bucketKey: string;
        trackId: string;
        byUserId: string | null;
        byName: string;
        via: string;
        createdAt: Date;
      }>
    >;
  };
  jsonCache: {
    findUnique(args: { where: { key: string } }): PromiseLike<{ value: unknown } | null>;
  };
}

/** 판정 줄의 거르기 칸만 읽는 자리 — 요약 숫자용(수만 줄에서 라벨·빈 칸 배열을 싣지 않으려고 칸을 고른다). */
export interface DeadlineMatchKeysDb {
  policyDeadlineMatch: {
    findMany(args: {
      where: { customerKey?: In; bucketKey?: In };
      select: { customerKey: true; bucketKey: true; verdict: true; toCheck: true; fitLabels: true; tier: true };
    }): PromiseLike<
      Array<{ customerKey: string; bucketKey: string; verdict: string; toCheck: string[]; fitLabels: string[]; tier?: string | null }>
    >;
  };
}

/** 해당 없음 줄을 읽는 자리(PolicyDeadlineDismiss). */
export interface DeadlineDismissDb {
  policyDeadlineDismiss: {
    findMany(args: { where: { customerKey?: In; bucketKey?: In } }): PromiseLike<
      Array<{
        customerKey: string;
        bucketKey: string;
        reason: string;
        byUserId: string | null;
        byName: string;
        createdAt: Date;
      }>
    >;
  };
}

export type DeadlineDb = DeadlineReadDb & DeadlineMatchKeysDb & DeadlineDismissDb;

/** 열쇠 목록이 빈 배열이면 어떤 줄도 맞을 수 없다 — DB 를 부르지 않는다(null·undefined 는 「거르지 않음」). */
function isEmptyFilter(f: { customerKeys: string[] | null; bucketKeys?: string[] }): boolean {
  return f.customerKeys?.length === 0 || f.bucketKeys?.length === 0;
}

/** 판정·진행 줄 거르기 — customerKeys 가 null 이 아니면 업체 in, bucketKeys 가 있으면 묶음 in. */
function keyWhere(f: { customerKeys: string[] | null; bucketKeys?: string[] }): { customerKey?: In; bucketKey?: In } {
  return {
    ...(f.customerKeys !== null ? { customerKey: { in: f.customerKeys } } : {}),
    ...(f.bucketKeys !== undefined ? { bucketKey: { in: f.bucketKeys } } : {}),
  };
}

/** 저장 값이 "fit" 이 아니면 확인 필요로 읽는다(제외는 저장하지 않는다). */
function verdictOf(verdict: string): DeadlineVerdict {
  return verdict === "fit" ? "fit" : "unverified";
}

function viaOf(via: string): StoredProgress["via"] {
  return via === "slack" || via === "track" ? via : "web";
}

/** 저장 값이 high·mid·low 가 아니면 null(칸이 비었거나 모르는 값). */
function storedTierOf(tier: unknown): DeadlineTier | null {
  return tier === "high" || tier === "mid" || tier === "low" ? tier : null;
}

/** 확인 항목 한 줄의 필수 칸(label·what·group·rank·where)이 맞는가 — 선택 칸은 저장한 그대로 둔다. */
function isCheckItem(value: unknown): value is CheckItem {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.label === "string"
    && typeof r.what === "string"
    && (r.group === "company" || r.group === "notice" || r.group === "ref")
    && typeof r.rank === "number"
    && typeof r.where === "string"
  );
}

/** 저장한 확인 항목 — 배열이 아니면 null, 배열이면 모양이 맞는 줄만 남긴다. */
function checkItemsOf(value: unknown): CheckItem[] | null {
  return Array.isArray(value) ? value.filter(isCheckItem) : null;
}

/** 지원 금액 — 수·bigint(Prisma BigInt)는 수로, 그 밖은 null(금액을 모름). */
function amountOf(value: unknown): number | null {
  if (typeof value === "bigint") return Number(value);
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

interface CountRow {
  bucketKey: string;
  verdict: string;
  tier?: unknown;
  unstructured?: unknown;
  _count: { _all: number };
}

function isCountRow(row: unknown): row is CountRow {
  if (typeof row !== "object" || row === null) return false;
  const r = row as Record<string, unknown>;
  const count = r._count;
  return (
    typeof r.bucketKey === "string"
    && typeof r.verdict === "string"
    && typeof count === "object"
    && count !== null
    && typeof (count as Record<string, unknown>)._all === "number"
  );
}

/** groupBy 결과 줄 — Prisma 의 groupBy 반환 타입이 까다로워 줄마다 모양을 확인해 좁힌다. */
function countRowsOf(rows: unknown): CountRow[] {
  const out: CountRow[] = [];
  if (!Array.isArray(rows)) return out;
  for (const row of rows) {
    if (isCountRow(row)) out.push(row);
  }
  return out;
}

/**
 * 읽기 자리. companies 의 readerId = readConsultantIds has, customerKeys = customerKey in(둘 다 주면 둘 다 건다).
 * matchCounts = policyDeadlineMatch.groupBy({ by: ["bucketKey", "verdict", "tier", "unstructured"], where(customerKeys 가 있으면 customerKey in), _count: { _all: true } }).
 * 결과 줄에는 늘 tier(high·mid·low 가 아니면 null)·unstructured(boolean 이 아니면 false)를 둔다 — 두 칸이 없는 옛 줄도 받는다.
 * matches 는 대조 때 저장한 단계·점수·근거·확인 항목을 모양이 맞을 때만 싣고(칸이 없거나 null 이면 키를 만들지 않는다), amountMaxWon 은 늘 싣는다(수 또는 null).
 * matchKeys = matches 와 같은 거르기로 customerKey·bucketKey·verdict·toCheck·fitLabels·tier 여섯 칸만 읽는다(요약 숫자용).
 * dismissals = policyDeadlineDismiss.findMany — progress 와 같은 거르기.
 * companies·matchCounts·matches·matchKeys·progress·dismissals 모두 customerKeys 가 빈 배열이면 DB 를 부르지 않고 [].
 * lastRun = ./store 의 readLastRun. 판정 줄의 verdict 가 "fit" 이 아니면 "unverified" 로 읽는다.
 * opts.tierConfig(맞을 확률 설정 원본을 읽는 함수 — 앱마다 저장 자리가 다르다)를 주면 ReadSource.tierConfig 로 내보낸다. 안 주면 키가 없다.
 */
export function deadlineReadSource(db: DeadlineDb, opts?: { tierConfig?: () => Promise<unknown> }): ReadSource {
  const tierConfig = opts?.tierConfig;
  return {
    async companies(filter): Promise<ReadCompany[]> {
      if (filter.customerKeys !== undefined && filter.customerKeys.length === 0) return [];
      const rows = await db.policyDeadlineCompany.findMany({
        where: {
          ...(filter.readerId !== undefined ? { readConsultantIds: { has: filter.readerId } } : {}),
          ...(filter.customerKeys !== undefined ? { customerKey: { in: filter.customerKeys } } : {}),
        },
        // 업체 정보(profile JSON)는 읽기에 필요 없다 — 업체 3천 곳 분량을 싣지 않게 칸을 고른다.
        select: {
          customerKey: true,
          companyName: true,
          consultant: true,
          consultantNames: true,
          readConsultantIds: true,
          statusText: true,
          profileGaps: true,
        },
      });
      return rows.map((r) => ({
        customerKey: r.customerKey,
        companyName: r.companyName,
        consultant: r.consultant,
        consultantNames: r.consultantNames,
        readConsultantIds: r.readConsultantIds,
        statusText: r.statusText,
        profileGaps: r.profileGaps,
      }));
    },

    async buckets(bucketKeys) {
      if (bucketKeys !== undefined && bucketKeys.length === 0) return [];
      const rows = await db.policyDeadlineBucket.findMany({
        where: bucketKeys === undefined ? {} : { bucketKey: { in: bucketKeys } },
      });
      return rows.map((r) => ({
        bucketKey: r.bucketKey,
        repAnnouncementId: r.repAnnouncementId,
        announcementIds: r.announcementIds,
        title: r.title,
        agency: r.agency,
        category: r.category,
        url: r.url,
        applyEnd: r.applyEnd,
        summary: r.summary ?? "",
        amountText: r.amountText ?? "",
      }));
    },

    async matchCounts(customerKeys) {
      if (customerKeys !== null && customerKeys.length === 0) return [];
      const rows: unknown = await db.policyDeadlineMatch.groupBy({
        by: ["bucketKey", "verdict", "tier", "unstructured"],
        where: customerKeys === null ? {} : { customerKey: { in: customerKeys } },
        _count: { _all: true },
      });
      return countRowsOf(rows).map((r) => ({
        bucketKey: r.bucketKey,
        verdict: verdictOf(r.verdict),
        tier: storedTierOf(r.tier),
        unstructured: r.unstructured === true,
        count: r._count._all,
      }));
    },

    async matches(filter) {
      if (isEmptyFilter(filter)) return [];
      const rows = await db.policyDeadlineMatch.findMany({ where: keyWhere(filter) });
      return rows.map((r) => {
        const tier = storedTierOf(r.tier);
        const checkItems = checkItemsOf(r.checkItems);
        return {
          customerKey: r.customerKey,
          bucketKey: r.bucketKey,
          repAnnouncementId: r.repAnnouncementId,
          verdict: verdictOf(r.verdict),
          fitLabels: r.fitLabels,
          toCheck: r.toCheck,
          gaps: r.gaps,
          ...(tier !== null ? { tier } : {}),
          ...(typeof r.tierScore === "number" ? { tierScore: r.tierScore } : {}),
          ...(typeof r.tierReason === "string" ? { tierReason: r.tierReason } : {}),
          ...(checkItems !== null ? { checkItems } : {}),
          amountMaxWon: amountOf(r.amountMaxWon),
        };
      });
    },

    async matchKeys(filter) {
      if (isEmptyFilter(filter)) return [];
      // 판정 줄이 수만 개라 거르기에 쓰는 여섯 칸만 고른다 — 라벨·빈 칸 배열·확인 항목을 싣지 않으려고.
      const rows = await db.policyDeadlineMatch.findMany({
        where: keyWhere(filter),
        select: { customerKey: true, bucketKey: true, verdict: true, toCheck: true, fitLabels: true, tier: true },
      });
      return rows.map((r) => {
        const tier = storedTierOf(r.tier);
        return {
          customerKey: r.customerKey,
          bucketKey: r.bucketKey,
          verdict: verdictOf(r.verdict),
          toCheck: r.toCheck,
          fitLabels: r.fitLabels,
          ...(tier !== null ? { tier } : {}),
        };
      });
    },

    async progress(filter) {
      if (isEmptyFilter(filter)) return [];
      const rows = await db.policyDeadlineProgress.findMany({ where: keyWhere(filter) });
      return rows.map((r) => ({
        customerKey: r.customerKey,
        bucketKey: r.bucketKey,
        trackId: r.trackId,
        byUserId: r.byUserId,
        byName: r.byName,
        via: viaOf(r.via),
        createdAt: r.createdAt,
      }));
    },

    async dismissals(filter): Promise<StoredDismissal[]> {
      if (isEmptyFilter(filter)) return [];
      const rows = await db.policyDeadlineDismiss.findMany({ where: keyWhere(filter) });
      return rows.map((r) => ({
        customerKey: r.customerKey,
        bucketKey: r.bucketKey,
        reason: r.reason,
        byUserId: r.byUserId,
        byName: r.byName,
        createdAt: r.createdAt,
      }));
    },

    ...(tierConfig !== undefined ? { tierConfig } : {}),

    lastRun: () => readLastRun(db),
  };
}
