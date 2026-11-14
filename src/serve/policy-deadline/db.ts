/**
 * 정책별 고객사 읽기의 DB 창구 — 표 다섯 개를 **구조형**으로만 안다(Prisma 클라이언트를 가져오지 않는다).
 *
 * 앱은 자기 Prisma 클라이언트를 `deadlineReadSource(prisma)` 로 그대로 넘긴다. 아래 형은 ERP·컨설턴트 앱
 * 두 곳의 Prisma 로 형 검사를 통과한 모양이라 **바꾸지 않는다**(칸이 더 필요하면 두 앱을 함께 확인한다).
 * 동작은 ERP 운영 읽기 자리(`prismaReadSource`)와 같다: 열쇠 목록이 빈 배열이면 DB 를 부르지 않고 빈 결과를 낸다.
 */
import { readLastRun } from "./store";
import type { DeadlineVerdict, ReadCompany, ReadSource, StoredProgress } from "./types";

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
      }>
    >;
  };
  policyDeadlineMatch: {
    groupBy(args: { by: ["bucketKey", "verdict"]; where: { customerKey?: In }; _count: { _all: true } }): PromiseLike<unknown>;
    findMany(args: { where: { customerKey?: In; bucketKey?: In } }): PromiseLike<
      Array<{
        customerKey: string;
        bucketKey: string;
        repAnnouncementId: string;
        verdict: string;
        fitLabels: string[];
        toCheck: string[];
        gaps: string[];
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
      select: { customerKey: true; bucketKey: true; verdict: true; toCheck: true };
    }): PromiseLike<Array<{ customerKey: string; bucketKey: string; verdict: string; toCheck: string[] }>>;
  };
}

export type DeadlineDb = DeadlineReadDb & DeadlineMatchKeysDb;

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

interface CountRow {
  bucketKey: string;
  verdict: string;
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
 * matchCounts = policyDeadlineMatch.groupBy({ by: ["bucketKey", "verdict"], where(customerKeys 가 있으면 customerKey in), _count: { _all: true } }).
 * matchKeys = matches 와 같은 거르기로 customerKey·bucketKey·verdict·toCheck 네 칸만 읽는다(요약 숫자용).
 * companies·matchCounts·matches·matchKeys·progress 모두 customerKeys 가 빈 배열이면 DB 를 부르지 않고 [].
 * lastRun = ./store 의 readLastRun. 판정 줄의 verdict 가 "fit" 이 아니면 "unverified" 로 읽는다.
 */
export function deadlineReadSource(db: DeadlineDb): ReadSource {
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
      }));
    },

    async matchCounts(customerKeys) {
      if (customerKeys !== null && customerKeys.length === 0) return [];
      const rows: unknown = await db.policyDeadlineMatch.groupBy({
        by: ["bucketKey", "verdict"],
        where: customerKeys === null ? {} : { customerKey: { in: customerKeys } },
        _count: { _all: true },
      });
      return countRowsOf(rows).map((r) => ({ bucketKey: r.bucketKey, verdict: verdictOf(r.verdict), count: r._count._all }));
    },

    async matches(filter) {
      if (isEmptyFilter(filter)) return [];
      const rows = await db.policyDeadlineMatch.findMany({ where: keyWhere(filter) });
      return rows.map((r) => ({
        customerKey: r.customerKey,
        bucketKey: r.bucketKey,
        repAnnouncementId: r.repAnnouncementId,
        verdict: verdictOf(r.verdict),
        fitLabels: r.fitLabels,
        toCheck: r.toCheck,
        gaps: r.gaps,
      }));
    },

    async matchKeys(filter) {
      if (isEmptyFilter(filter)) return [];
      // 판정 줄이 수만 개라 거르기에 쓰는 네 칸만 고른다 — 라벨·빈 칸 배열을 싣지 않으려고.
      const rows = await db.policyDeadlineMatch.findMany({
        where: keyWhere(filter),
        select: { customerKey: true, bucketKey: true, verdict: true, toCheck: true },
      });
      return rows.map((r) => ({
        customerKey: r.customerKey,
        bucketKey: r.bucketKey,
        verdict: verdictOf(r.verdict),
        toCheck: r.toCheck,
      }));
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

    lastRun: () => readLastRun(db),
  };
}
