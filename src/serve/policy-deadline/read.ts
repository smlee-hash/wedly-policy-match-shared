/**
 * 정책별 고객사·연락 예정(미리 대조 결과 읽기) — 「정책별 고객사」·「연락 예정 업체」 탭과 엑셀이 쓰는 읽기 계산.
 * 판정 줄이 업체 300곳 × 공고 묶음 수천 개라 목록은 (묶음, 판정)별 수만 세고, 업체 줄은 펼칠 때 묶음 하나·업체 하나씩 읽는다.
 *
 * ERP `services/policy-deadline/read.ts` 를 그대로 옮기되 「누가 보나」만 주입으로 바꿨다:
 * 첫 인자가 `viewer`(로그인 사용자) 가 아니라 `scope`(앱이 정한 보는 범위 — `./scope`) 이고, 읽는 자리(`src`)는 필수다.
 * 마감 순서·숫자 규칙은 바꾸지 않았다. 맞을 확률(NO.789)은 줄마다 단계·근거·확인 항목·다음 할 일·해당 없음 칸을 더하고,
 * sort 를 "tier" 로 줄 때만 맞을 확률 순(`./order`)으로 줄 세운다.
 */
import { dDayOf } from "../../funding/funding-map";
import { kstDateKey } from "./kst";
import { compareByTier, type TierOrderKey } from "./order";
import { readScope, scopeAllows, type DeadlineScope } from "./scope";
import {
  DEFAULT_TIER_CONFIG,
  TIER_RANK,
  isPreStructureJudgement,
  isUnjudgedJudgement,
  mergeTierConfig,
  nextActionOf,
  tierOf,
  type TierConfig,
  type TierResult,
} from "./tier";
import {
  CONTACTS_DEFAULT_DAYS,
  CONTACTS_INCLUDE_UNSTRUCTURED_DEFAULT,
  EXPORT_BUCKET_CHUNK,
  EXPORT_MAX_ROWS,
  type AnnouncementListRow,
  type AnnouncementListView,
  type BucketCompaniesView,
  type BucketMeta,
  type CompanyAnnouncementRow,
  type CompanyAnnouncementsView,
  type CompanyMatchRow,
  type ContactBest,
  type ContactCompanyRow,
  type ContactKind,
  type ContactsView,
  type DaysFilter,
  type DeadlineBucket,
  type DeadlineJudgement,
  type DeadlineTier,
  type DismissInfo,
  type ExportRow,
  type ExportView,
  type ProgressInfo,
  type ReadCompany,
  type ReadMatch,
  type ReadMatchKey,
  type ReadSource,
  type SortOrder,
  type StoredDismissal,
  type StoredProgress,
  type SummaryView,
  type TierCounts,
  type TierView,
} from "./types";

/** 단계 높은 순 — 가장 높은 단계를 고르는 데 쓴다. */
const TIER_ORDER: readonly DeadlineTier[] = ["high", "mid", "low"];

/** 묶음 조각을 한 번에 읽는 수 — 조각끼리 기다릴 까닭이 없어 겹쳐 읽되, DB 연결을 다 쓰지 않게 막는다. */
const READ_CONCURRENCY = 4;

/**
 * 「판단 전」 판정 줄인가 — 확인 필요(unverified)이고 확인할 조건이 모두 공용 GENERIC_TO_CHECK
 * (「공고 원문 확인(조건 정리 전)」·「자격 조건 원문 확인」) 안에 든다(빈 목록도 해당). 맞음(fit)은 늘 false.
 * 연락 예정의 「판단 전 포함」이 꺼져 있으면 이 줄을 뺀다(요약 카드 수가 같은 기준).
 */
export function isUnstructuredMatch(m: Pick<DeadlineJudgement, "verdict" | "toCheck">): boolean {
  return isUnjudgedJudgement(m);
}

/**
 * 「조건 정리 전」 판정 줄인가 — 판단 전이거나, 확인할 것에 「공고 원문 확인(조건 정리 전)」이 섞인 확인 필요 줄.
 * 단계는 낮음·다음 할 일 「공고 조건 정리 대기」, 단계 수에 넣지 않고 따로 세며 맨 뒤 접기로 간다. 저장 칸 unstructured 가 이 뜻이다.
 */
export function isPreStructureMatch(m: Pick<DeadlineJudgement, "verdict" | "toCheck">): boolean {
  return isPreStructureJudgement(m);
}

/**
 * 묶음 → 표시 칸. applyEnd 가 있으면 kstDateKey(applyEnd)·공용 dDayOf(applyEnd, now), 상시면 둘 다 null.
 */
export function bucketMetaOf(bucket: DeadlineBucket, now: Date): BucketMeta {
  const { applyEnd } = bucket;
  return {
    bucketKey: bucket.bucketKey,
    repAnnouncementId: bucket.repAnnouncementId,
    title: bucket.title,
    agency: bucket.agency,
    category: bucket.category,
    url: bucket.url,
    applyEnd: applyEnd ? kstDateKey(applyEnd) : null,
    dDay: applyEnd ? dDayOf(applyEnd, now) : null,
  };
}

/** 날짜 마감 D-n 이 거르기 안인가 — 0 ≤ dDay 이고 days 가 「all」이거나 dDay ≤ days. 상시(null)는 false. */
export function inDays(dDay: number | null, days: DaysFilter): boolean {
  return dDay !== null && dDay >= 0 && (days === "all" || dDay <= days);
}

/** 진행 줄 → 표시 칸(at = createdAt ISO). */
export function progressInfoOf(row: StoredProgress): ProgressInfo {
  return { trackId: row.trackId, byName: row.byName, via: row.via, at: row.createdAt.toISOString() };
}

/** 해당 없음 줄 → 표시 칸(at = createdAt ISO). */
function dismissInfoOf(row: StoredDismissal): DismissInfo {
  return { reason: row.reason, byName: row.byName, at: row.createdAt.toISOString() };
}

/** 맞을 확률 설정 — 자리가 없으면 기본값, 있으면 맞는 값만 기본값 위에 덮는다. 읽다가 던져도 기본값(목록 읽기를 막지 않는다). */
export async function readTierConfig(src: Pick<ReadSource, "tierConfig">): Promise<TierConfig> {
  if (!src.tierConfig) return DEFAULT_TIER_CONFIG;
  try {
    return mergeTierConfig(await src.tierConfig());
  } catch {
    return DEFAULT_TIER_CONFIG;
  }
}

/** 대조 전 옛 줄의 단계 — 맞은 조건(fitLabels)은 모두 pass, 확인할 것(toCheck)은 그대로 tierOf 에 넣어 계산한다. */
function calculatedTierOf(m: Pick<DeadlineJudgement, "verdict" | "fitLabels" | "toCheck">, config: TierConfig): TierResult {
  return tierOf(
    { verdict: m.verdict, fit: m.fitLabels.map((label) => ({ label, verdict: "pass" as const, note: "" })), toCheck: m.toCheck },
    config,
  );
}

/**
 * 판정 줄 → 맞을 확률 칸. 단계와 확인 항목이 둘 다 저장돼 있으면 저장 값 그대로, 하나라도 없는 옛 줄은 읽을 때 계산한다.
 * 단계만 저장된 줄은 단계(와 저장된 점수·이유)는 저장 값, 확인 항목만 계산한다 — 거르기·수(lineTierOf)가 저장된 단계로 세므로 표시도 같게.
 * inProgress 는 다음 할 일(「업무 현황에서 진행 중」)을 정한다.
 */
export function tierViewOf(m: DeadlineJudgement, inProgress: boolean, config: TierConfig): TierView {
  const unstructured = isPreStructureMatch(m);
  let tier: DeadlineTier;
  let tierScore: number;
  let tierReason: string;
  let checkItems: TierView["checkItems"];
  if (m.tier !== undefined && m.checkItems !== undefined) {
    tier = m.tier;
    tierScore = m.tierScore ?? 0;
    tierReason = m.tierReason ?? "";
    checkItems = m.checkItems;
  } else {
    const t = calculatedTierOf(m, config);
    tier = m.tier ?? t.tier;
    tierScore = m.tier !== undefined ? (m.tierScore ?? t.score) : t.score;
    tierReason = m.tier !== undefined ? (m.tierReason ?? t.reason) : t.reason;
    checkItems = t.checkItems;
  }
  return {
    tier,
    tierScore,
    tierReason,
    checkItems,
    checkCount: checkItems.filter((c) => c.group !== "ref").length,
    nextAction: nextActionOf({ tier, checkItems, unstructured, inProgress }, config),
    unstructured,
  };
}

/** 줄의 단계만 — 저장된 단계가 있으면 그것, 없는 옛 줄은 계산한 단계. 거르기 칸만 읽은 줄(요약)도 쓴다. */
export function lineTierOf(m: ReadMatchKey, config: TierConfig): DeadlineTier {
  return m.tier ?? calculatedTierOf(m, config).tier;
}

/** 글자 순 비교 — 로케일 비교는 맥 로케일(LANG=ko)에 따라 순서가 달라져 기본 비교로 고정한다. */
function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** 목록을 size 개씩 나눈다 — 큰 `in` 조건과 수만 줄이 한꺼번에 올라오지 않게. */
function chunked<T>(items: T[], size: number): T[][] {
  const parts: T[][] = [];
  for (let i = 0; i < items.length; i += size) parts.push(items.slice(i, i + size));
  return parts;
}

/** items 를 한 번에 limit 개까지 겹쳐 처리하고 결과는 items 순서대로 돌려준다. 하나가 던지면 아직 시작하지 않은 것은 더 읽지 않는다. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  let next = 0;
  let failed = false;
  const work = async (): Promise<void> => {
    while (!failed && next < items.length) {
      const i = next;
      next += 1;
      try {
        results[i] = await fn(items[i]);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, work));
  return results;
}

/** items 를 키 글자로 묶는다 — 묶음 안 순서는 들어온 순서 그대로. */
function groupedBy<T>(items: T[], keyOf: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }
  return groups;
}

/** compareByTier 가 보는 칸 — 맞을 확률 칸에 해당 없음·마감·이름·열쇠를 붙인다. */
function orderKeyOf(view: TierView, dismissed: boolean, applyEnd: string | null, name: string, key: string): TierOrderKey {
  return { dismissed, unstructured: view.unstructured, tier: view.tier, checkCount: view.checkCount, applyEnd, tierScore: view.tierScore, name, key };
}

/** compareByTier 순으로 새로 줄 세운다 — 줄마다 칸을 한 번만 만든다. */
function sortedByTier<T>(items: T[], orderOf: (item: T) => TierOrderKey): T[] {
  return items
    .map((item) => ({ item, order: orderOf(item) }))
    .sort((a, b) => compareByTier(a.order, b.order))
    .map(({ item }) => item);
}

/** 마감 가까운 순(같으면 bucketKey 순) — applyEnd 는 YYYY-MM-DD 글자라 글자 순이 곧 날짜 순이다. */
function compareByApplyEnd(a: Pick<BucketMeta, "applyEnd" | "bucketKey">, b: Pick<BucketMeta, "applyEnd" | "bucketKey">): number {
  return compareText(a.applyEnd ?? "", b.applyEnd ?? "") || compareText(a.bucketKey, b.bucketKey);
}

/** 업체명 글자 순(같으면 customerKey 순). */
function compareByCompany(a: { companyName: string; customerKey: string }, b: { companyName: string; customerKey: string }): number {
  return compareText(a.companyName, b.companyName) || compareText(a.customerKey, b.customerKey);
}

/** 거르기 안 날짜 마감 묶음(마감 가까운 순) 다음 상시 묶음(bucketKey 순) — 목록과 엑셀이 같은 순서를 쓴다. */
function splitBuckets<T extends BucketMeta>(rows: T[], days: DaysFilter): { dated: T[]; always: T[] } {
  const dated = rows.filter((r) => inDays(r.dDay, days)).sort(compareByApplyEnd);
  const always = rows.filter((r) => r.applyEnd === null).sort((a, b) => compareText(a.bucketKey, b.bucketKey));
  return { dated, always };
}

/** 가장 높은 단계 — 셀 곳이 하나도 없으면 null. */
function bestTierOf(tiers: { high: number; mid: number; low: number }): DeadlineTier | null {
  return TIER_ORDER.find((t) => tiers[t] > 0) ?? null;
}

/** 단계 순위 — 단계 없음(null)은 맨 뒤. */
function bestTierRank(tier: DeadlineTier | null): number {
  return tier === null ? TIER_ORDER.length : TIER_RANK[tier];
}

/** 가장 높은 단계 순으로 — 같은 단계는 들어온 순서(지금 순서) 그대로(정렬은 안정 정렬). */
function byBestTier<T>(rows: T[], bestOf: (row: T) => DeadlineTier | null): T[] {
  return [...rows].sort((a, b) => bestTierRank(bestOf(a)) - bestTierRank(bestOf(b)));
}

/** 묶음 하나의 판정 수 — 해당 없음 줄도 센다. 조건 정리 전(unstructured)은 단계 수에 넣지 않고 따로 센다. */
interface BucketCount {
  fit: number;
  unverified: number;
  tiers: { high: number; mid: number; low: number };
  unstructured: number;
}

function emptyBucketCount(): BucketCount {
  return { fit: 0, unverified: 0, tiers: { high: 0, mid: 0, low: 0 }, unstructured: 0 };
}

/** matchCounts 줄을 묶음별로 모은다. 단계 칸이 빈 옛 줄(tier 없음·null)이 하나라도 있으면 null — 부른 쪽이 줄을 읽어 단계를 계산해 센다. */
function countsByBucket(counts: Awaited<ReturnType<ReadSource["matchCounts"]>>): Map<string, BucketCount> | null {
  const countOf = new Map<string, BucketCount>();
  for (const c of counts) {
    if (c.tier === undefined || c.tier === null) return null;
    const row = countOf.get(c.bucketKey) ?? emptyBucketCount();
    row[c.verdict] += c.count;
    if (c.unstructured) row.unstructured += c.count;
    else row.tiers[c.tier] += c.count;
    countOf.set(c.bucketKey, row);
  }
  return countOf;
}

/** 거르기 칸 줄을 묶음별로 모은다 — 단계는 lineTierOf(저장된 단계, 없으면 계산), 조건 정리 전은 isPreStructureMatch 로 가린다. */
function countsByKeys(lines: ReadMatchKey[], config: TierConfig): Map<string, BucketCount> {
  const countOf = new Map<string, BucketCount>();
  for (const m of lines) {
    const row = countOf.get(m.bucketKey) ?? emptyBucketCount();
    row[m.verdict] += 1;
    if (isPreStructureMatch(m)) row.unstructured += 1;
    else row.tiers[lineTierOf(m, config)] += 1;
    countOf.set(m.bucketKey, row);
  }
  return countOf;
}

/**
 * 범위 안 묶음별 판정 수. 보통은 저장된 단계로 센 수(matchCounts) 그대로다. 단계 칸이 빈 옛 줄(배포 직후 다시 대조하기 전의 줄)이
 * 하나라도 있으면 거르기 칸(matchKeys)을 읽어 단계를 계산해 센다 — 옛 줄을 낮음으로 세면 기본 거르기(높음·보통)에서 공고가
 * 통째로 숨고, 펼친 표(계산한 단계)와 수가 어긋난다. 설정은 계산할 때만 읽는다.
 */
async function bucketCountsOf(src: ReadSource, keys: string[] | null, config: () => Promise<TierConfig>): Promise<Map<string, BucketCount>> {
  const counted = countsByBucket(await src.matchCounts(keys));
  if (counted) return counted;
  const [lines, tierConfig] = await Promise.all([src.matchKeys({ customerKeys: keys }), config()]);
  return countsByKeys(lines, tierConfig);
}

/** 묶음 전부를 표시 칸으로 — 마감 거르기는 호출한 쪽이 한다. */
async function readBucketMetas(now: Date, src: ReadSource): Promise<BucketMeta[]> {
  return (await src.buckets()).map((b) => bucketMetaOf(b, now));
}

/** 업체 표 — 판정·진행 줄을 업체로 이을 때 표에 없는 업체 줄(범위 밖)을 버리는 데 쓴다. */
function companiesByKey(companies: ReadCompany[]): Map<string, ReadCompany> {
  return new Map<string, ReadCompany>(companies.map((c): [string, ReadCompany] => [c.customerKey, c]));
}

function progressKey(customerKey: string, bucketKey: string): string {
  return `${customerKey}|${bucketKey}`;
}

/** 진행 줄을 (업체, 묶음)으로 찾게 한다. */
function progressByKey(rows: StoredProgress[]): Map<string, StoredProgress> {
  return new Map<string, StoredProgress>(rows.map((p): [string, StoredProgress] => [progressKey(p.customerKey, p.bucketKey), p]));
}

/** 해당 없음 줄을 (업체, 묶음)으로 찾게 한다. */
function dismissalsByKey(rows: StoredDismissal[]): Map<string, StoredDismissal> {
  return new Map<string, StoredDismissal>(rows.map((d): [string, StoredDismissal] => [progressKey(d.customerKey, d.bucketKey), d]));
}

/** 해당 없음 줄 읽기 — 읽는 자리가 없는 앱은 해당 없음 줄이 없는 것으로 읽는다. */
async function readDismissals(
  src: Pick<ReadSource, "dismissals">,
  filter: { customerKeys: string[] | null; bucketKeys?: string[] },
): Promise<StoredDismissal[]> {
  return src.dismissals ? src.dismissals(filter) : [];
}

function companyMatchRowOf(
  c: ReadCompany,
  m: DeadlineJudgement,
  p: StoredProgress | undefined,
  d: StoredDismissal | undefined,
  config: TierConfig,
): CompanyMatchRow {
  return {
    customerKey: c.customerKey,
    companyName: c.companyName,
    consultant: c.consultant,
    consultantNames: c.consultantNames,
    statusText: c.statusText,
    fitLabels: m.fitLabels,
    toCheck: m.toCheck,
    gaps: m.gaps,
    progress: p ? progressInfoOf(p) : null,
    verdict: m.verdict,
    ...tierViewOf(m, p !== undefined, config),
    amountMaxWon: m.amountMaxWon ?? null,
    dismissed: d ? dismissInfoOf(d) : null,
  };
}

/** 묶음 펼치기의 단계별 곳 수 — 해당 없음이면 dismissed, 아니고 조건 정리 전이면 unstructured, 아니면 단계별. */
function addTierCount(counts: TierCounts, row: Pick<CompanyMatchRow, "tier" | "unstructured" | "dismissed">): void {
  if (row.dismissed) counts.dismissed += 1;
  else if (row.unstructured) counts.unstructured += 1;
  else counts[row.tier] += 1;
}

/** 날짜 마감 묶음 — 연락 예정 줄은 마감이 늘 있어 applyEnd·dDay 가 null 이 아니다. */
type DatedBucket = BucketMeta & { applyEnd: string; dDay: number };

function isDated(b: BucketMeta): b is DatedBucket {
  return b.applyEnd !== null && b.dDay !== null;
}

/** 묶음 범위 안 판정 줄 한 벌 — 업체·묶음·판정·진행·해당 없음. 연락 예정에 남길지는 keepsContactLine 이 정한다. */
interface ContactLine<M extends ReadMatchKey = ReadMatch> {
  company: ReadCompany;
  bucket: DatedBucket;
  match: M;
  progress: StoredProgress | undefined;
  dismissed: StoredDismissal | undefined;
}

/** 「연락 예정」 거르기 — 마감 범위·조건 정리 전 포함·진행 포함·남길 단계(없으면 거르지 않음). */
interface ContactQuery {
  days: DaysFilter;
  includeUnstructured: boolean;
  includeProgress: boolean;
  tiers?: DeadlineTier[];
}

/** 거르기 안 날짜 마감 묶음만 bucketKey 로 — 상시·지난 마감·범위 밖 날짜는 뺀다. */
function datedBucketsWithin(buckets: BucketMeta[], days: DaysFilter): Map<string, DatedBucket> {
  const inRange = new Map<string, DatedBucket>();
  for (const b of buckets) {
    if (isDated(b) && inDays(b.dDay, days)) inRange.set(b.bucketKey, b);
  }
  return inRange;
}

/**
 * 「연락 예정」 거르기 한 곳 — readContacts·readCompanyAnnouncements·readSummary 가 모두 이 함수를 지나
 * 요약 숫자와 목록 수가 늘 같다. 해당 없음 줄은 늘 뺀다. 마감이 q.days 안이고, 판단 전·진행한 줄은 q 가 끄면 뺀다.
 * q.tiers 를 주면 그 단계 줄만 남긴다 — 조건 정리 전 줄(판단 전 포함)에는 걸지 않는다: 판단 전은 includeUnstructured 가 정하고,
 * 다른 확인이 섞인 조건 정리 전 줄은 늘 남아 맨 뒤 접기로 간다(요약 카드 수가 판단 전만 빼고 세므로 그대로).
 */
function keepsContactLine(line: ContactLine<ReadMatchKey>, q: ContactQuery, config: TierConfig): boolean {
  if (line.dismissed) return false;
  if (!inDays(line.bucket.dDay, q.days)) return false;
  if (isUnstructuredMatch(line.match)) {
    if (!q.includeUnstructured) return false;
  } else if (!isPreStructureMatch(line.match) && q.tiers && q.tiers.length > 0 && !q.tiers.includes(lineTierOf(line.match, config))) {
    return false;
  }
  return q.includeProgress || !line.progress;
}

/**
 * inRange 묶음의 판정·진행·해당 없음 줄을 업체·묶음으로 이어 읽는다(거르기는 하지 않는다). 업체가 0곳이거나 inRange 가 비면
 * 읽지 않고, 묶음 열쇠는 EXPORT_BUCKET_CHUNK 개씩 나눠 한 번에 READ_CONCURRENCY 조각씩 겹쳐 읽는다(줄 순서는 조각 순서 그대로).
 * 판정은 read 로 읽어 호출한 쪽이 칸 수를 고른다.
 */
async function readRangeLines<M extends ReadMatchKey>(
  companies: ReadCompany[],
  keys: string[] | null,
  inRange: Map<string, DatedBucket>,
  read: (filter: { customerKeys: string[] | null; bucketKeys: string[] }) => Promise<M[]>,
  src: ReadSource,
): Promise<ContactLine<M>[]> {
  if (companies.length === 0 || inRange.size === 0) return [];
  const known = companiesByKey(companies);
  const parts = chunked([...inRange.keys()], EXPORT_BUCKET_CHUNK);
  const partLines = await mapLimit(parts, READ_CONCURRENCY, async (part) => {
    const filter = { customerKeys: keys, bucketKeys: part };
    const [matches, progress, dismissals] = await Promise.all([read(filter), src.progress(filter), readDismissals(src, filter)]);
    const done = progressByKey(progress);
    const dismissed = dismissalsByKey(dismissals);
    const lines: ContactLine<M>[] = [];
    for (const match of matches) {
      const company = known.get(match.customerKey);
      const bucket = inRange.get(match.bucketKey);
      if (!company || !bucket) continue;
      const key = progressKey(match.customerKey, match.bucketKey);
      lines.push({ company, bucket, match, progress: done.get(key), dismissed: dismissed.get(key) });
    }
    return lines;
  });
  const lines: ContactLine<M>[] = [];
  return lines.concat(...partLines);
}

/**
 * readContacts·readCompanyAnnouncements 의 연락 예정 줄 — 거르기 안 날짜 마감 묶음의 열쇠만 넘겨 읽고(열쇠가 비면 읽지 않는다)
 * kept = keepsContactLine 을 지난 줄, dismissed = 그 묶음 범위 안의 해당 없음 줄(진행·조건 정리 전·단계 거르기와 상관없이).
 */
async function readContactLines(
  companies: ReadCompany[],
  keys: string[] | null,
  buckets: BucketMeta[],
  q: ContactQuery,
  config: TierConfig,
  src: ReadSource,
): Promise<{ kept: ContactLine[]; dismissed: ContactLine[] }> {
  const lines = await readRangeLines(companies, keys, datedBucketsWithin(buckets, q.days), (f) => src.matches(f), src);
  return {
    kept: lines.filter((l) => keepsContactLine(l, q, config)),
    dismissed: lines.filter((l) => l.dismissed !== undefined),
  };
}

/** 두 마감 범위 중 넓은 것 — 하나라도 「all」이면 「all」. 한 번에 읽는 범위를 둘이 함께 덮게. */
function widerDays(a: DaysFilter, b: DaysFilter): DaysFilter {
  if (a === "all" || b === "all") return "all";
  return a >= b ? a : b;
}

const KINDS_FIRST = ["정책자금", "무상지원금"];

/** 분야 순서 — 정책자금, 무상지원금, 그 밖 분류 글자 순, 빈 분류 맨 끝. */
function kindRank(category: string): number {
  const i = KINDS_FIRST.indexOf(category);
  if (i >= 0) return i;
  return category === "" ? KINDS_FIRST.length + 1 : KINDS_FIRST.length;
}

/** 연락 예정 줄 + 맞을 확률 칸 + 줄 세우는 칸. 이름 자리는 공고 열쇠(한 업체 안에서 가리는 줄이라 업체 열쇠는 늘 같다). */
interface ScoredLine {
  line: ContactLine;
  view: TierView;
  order: TierOrderKey;
}

function scoredLineOf(line: ContactLine, config: TierConfig): ScoredLine {
  const view = tierViewOf(line.match, line.progress !== undefined, config);
  const { bucket, company } = line;
  return { line, view, order: orderKeyOf(view, line.dismissed !== undefined, bucket.applyEnd, bucket.bucketKey, company.customerKey) };
}

/** 가장 좋은 줄 = compareByTier 첫 줄. items 는 비어 있지 않다. */
function firstByTier(items: ScoredLine[]): ScoredLine {
  return items.reduce((best, item) => (compareByTier(item.order, best.order) < 0 ? item : best));
}

function contactBestOf({ line, view }: ScoredLine): ContactBest {
  const { bucket, match } = line;
  return {
    bucketKey: bucket.bucketKey,
    title: bucket.title,
    category: bucket.category,
    url: bucket.url,
    applyEnd: bucket.applyEnd,
    dDay: bucket.dDay,
    amountMaxWon: match.amountMaxWon ?? null,
    ...view,
  };
}

/** 펼친 공고 줄 — 공고 칸 + 판정·진행 + 맞을 확률 칸 + 해당 없음. */
function companyAnnouncementRowOf({ line, view }: ScoredLine): CompanyAnnouncementRow {
  const { bucket, match, progress, dismissed } = line;
  return {
    ...bucket,
    verdict: match.verdict,
    fitLabels: match.fitLabels,
    toCheck: match.toCheck,
    gaps: match.gaps,
    progress: progress ? progressInfoOf(progress) : null,
    ...view,
    amountMaxWon: match.amountMaxWon ?? null,
    dismissed: dismissed ? dismissInfoOf(dismissed) : null,
  };
}

/**
 * 남은 줄을 업체별로 묶어 연락 예정 업체 줄로. 업체 줄과 종류 칸마다 가장 좋은 줄(best)을 싣는다.
 * sort 가 "tier" 면 업체의 가장 좋은 줄 기준 맞을 확률 순(이름 = 업체명, 열쇠 = customerKey),
 * 아니면 가장 가까운 마감 순(같으면 업체명, customerKey 순).
 */
function contactRowsOf(lines: ContactLine[], config: TierConfig, sort: SortOrder | undefined): ContactCompanyRow[] {
  const byCompany = groupedBy(lines.map((line) => scoredLineOf(line, config)), (s) => s.line.company.customerKey);
  const rows: ContactCompanyRow[] = [];
  for (const list of byCompany.values()) {
    const { company } = list[0].line;
    const tiers = { high: 0, mid: 0, low: 0, unstructured: 0 };
    let nearest = list[0].line.bucket;
    let progressCount = 0;
    for (const { line, view } of list) {
      if (compareText(line.bucket.applyEnd, nearest.applyEnd) < 0) nearest = line.bucket;
      if (view.unstructured) tiers.unstructured += 1;
      else tiers[view.tier] += 1;
      if (line.progress) progressCount += 1;
    }
    const kinds = [...groupedBy(list, (s) => s.line.bucket.category).values()].map(
      (group): ContactKind => ({
        category: group[0].line.bucket.category,
        count: group.length,
        nearestDDay: group.reduce((min, s) => Math.min(min, s.line.bucket.dDay), Infinity),
        best: contactBestOf(firstByTier(group)),
      }),
    );
    const best = firstByTier(list);
    rows.push({
      customerKey: company.customerKey,
      companyName: company.companyName,
      consultant: company.consultant,
      consultantNames: company.consultantNames,
      statusText: company.statusText,
      nearestApplyEnd: nearest.applyEnd,
      nearestDDay: nearest.dDay,
      kinds: kinds.sort((a, b) => kindRank(a.category) - kindRank(b.category) || compareText(a.category, b.category)),
      announcementCount: list.length,
      progressCount,
      bestTier: best.view.tier,
      tiers,
      best: contactBestOf(best),
    });
  }
  if (sort === "tier") {
    return sortedByTier(rows, (r) => orderKeyOf(r.best, false, r.best.applyEnd, r.companyName, r.customerKey));
  }
  return rows.sort((a, b) => compareText(a.nearestApplyEnd, b.nearestApplyEnd) || compareByCompany(a, b));
}

/**
 * 「정책별 업체」·「정책별 고객사」 목록. 범위 안 업체 → matchCounts(그 업체 열쇠, 범위가 all 이면 null) →
 * 묶음 전부를 bucketMetaOf 로 바꿔 날짜 마감은 inDays(days) 안 것만 dated, 상시는 전부 always.
 * hideEmpty 면 fit + unverified 가 0인 줄을 뺀다(dated·always 모두). 범위 안 업체가 0곳이면 matchCounts 를 부르지 않고 수는 모두 0.
 * 줄마다 단계별 수(tiers)·조건 정리 전 수·가장 높은 단계(bestTier)를 싣는다 — 저장된 단계로 센다(옛 줄이 있으면 bucketCountsOf 가 계산해 센다).
 * sort 가 "tier" 면 dated·always 각각 가장 높은 단계 순(단계 없음은 뒤, 같으면 지금 순서), 없거나 "deadline" 이면 지금 순서.
 */
export async function readAnnouncementList(
  scope: DeadlineScope,
  q: { days: DaysFilter; hideEmpty: boolean; sort?: SortOrder },
  now: Date,
  src: ReadSource,
): Promise<AnnouncementListView> {
  const { companies, keys } = await readScope(scope, src);
  // 업체가 0곳이면 세지 않는다 — 빈 범위를 「전체(열쇠 null)」로 세지 않게.
  const countOf = companies.length === 0 ? new Map<string, BucketCount>() : await bucketCountsOf(src, keys, () => readTierConfig(src));
  // 묶음 표는 한 번만 읽는다 — 요약 글(summary)·지원 금액 글(amountText)은 표시 칸(BucketMeta)이 아니라 이 목록 줄에만 붙인다.
  const rows: AnnouncementListRow[] = (await src.buckets()).map((b) => {
    const count = countOf.get(b.bucketKey) ?? emptyBucketCount();
    return {
      ...bucketMetaOf(b, now),
      fit: count.fit,
      unverified: count.unverified,
      tiers: count.tiers,
      unstructured: count.unstructured,
      bestTier: bestTierOf(count.tiers),
      summary: b.summary ?? "",
      amountText: b.amountText ?? "",
    };
  });
  const shown = q.hideEmpty ? rows.filter((r) => r.fit + r.unverified > 0) : rows;
  const { dated, always } = splitBuckets(shown, q.days);
  const tierFirst = q.sort === "tier";
  return {
    lastRun: await src.lastRun(),
    companyCount: companies.length,
    bucketCount: rows.length,
    categories: [...new Set(rows.map((b) => b.category))].filter((c) => c !== "").sort(compareText),
    dated: tierFirst ? byBestTier(dated, (r) => r.bestTier) : dated,
    always: tierFirst ? byBestTier(always, (r) => r.bestTier) : always,
  };
}

/**
 * 묶음 하나를 펼친 업체 표. 묶음이 없으면 null(통로가 404). 범위 안 업체의 그 묶음 판정 줄을 맞음·확인 필요로 나누고,
 * 그 묶음의 진행·해당 없음 줄을 (업체)로 붙인다. 판정 줄이 있어도 범위 밖 업체는 넣지 않는다.
 * rows = 모든 줄(해당 없음 포함)을 맞을 확률 순으로(같은 묶음이라 마감은 같다), tierCounts = 줄을 단계별로 센 수.
 */
export async function readBucketCompanies(
  scope: DeadlineScope,
  q: { bucketKey: string },
  now: Date,
  src: ReadSource,
): Promise<BucketCompaniesView | null> {
  const { companies, keys } = await readScope(scope, src);
  const [bucket] = await src.buckets([q.bucketKey]);
  if (!bucket) return null;
  const meta = bucketMetaOf(bucket, now);
  const view: BucketCompaniesView = {
    bucket: meta,
    fit: [],
    unverified: [],
    rows: [],
    tierCounts: { high: 0, mid: 0, low: 0, unstructured: 0, dismissed: 0 },
  };
  if (companies.length === 0) return view;
  const filter = { customerKeys: keys, bucketKeys: [q.bucketKey] };
  const [matches, progress, dismissals, config] = await Promise.all([
    src.matches(filter),
    src.progress(filter),
    readDismissals(src, filter),
    readTierConfig(src),
  ]);
  const known = companiesByKey(companies);
  const done = progressByKey(progress);
  const dismissed = dismissalsByKey(dismissals);
  const rows: CompanyMatchRow[] = [];
  for (const match of matches) {
    // 범위 all(열쇠 null)도 업체 표에 있는 줄만 싣는다.
    const company = known.get(match.customerKey);
    if (!company) continue;
    const key = progressKey(match.customerKey, match.bucketKey);
    const row = companyMatchRowOf(company, match, done.get(key), dismissed.get(key), config);
    (match.verdict === "fit" ? view.fit : view.unverified).push(row);
    rows.push(row);
    addTierCount(view.tierCounts, row);
  }
  view.fit.sort(compareByCompany);
  view.unverified.sort(compareByCompany);
  view.rows = sortedByTier(rows, (r) => orderKeyOf(r, r.dismissed !== null, meta.applyEnd, r.companyName, r.customerKey));
  return view;
}

/**
 * 「연락 예정 업체」. 범위 안 업체의 판정 줄 중 날짜 마감이 inDays(days) 안인 묶음 것만 본다(상시 빼기).
 * includeUnstructured 가 꺼져 있으면 isUnstructuredMatch 줄을 빼고, includeProgress 가 꺼져 있으면 진행 줄이 있는 (업체, 묶음)을 뺀다.
 * 해당 없음 줄은 늘 빼고, tiers 를 주면 조건 정리 전이 아닌 줄 중 그 단계 줄만 남긴다.
 * 남은 줄이 하나도 없는 업체는 넣지 않는다. 묶음 줄은 거르기 안 날짜 마감 묶음만 읽는다(matches 의 bucketKeys 도 그 묶음).
 * sort 가 "tier" 면 업체의 가장 좋은 줄(best) 기준 맞을 확률 순, 없거나 "deadline" 이면 가까운 마감 순.
 */
export async function readContacts(
  scope: DeadlineScope,
  q: { days: DaysFilter; includeUnstructured: boolean; includeProgress: boolean; tiers?: DeadlineTier[]; sort?: SortOrder },
  now: Date,
  src: ReadSource,
): Promise<ContactsView> {
  const { companies, keys } = await readScope(scope, src);
  const [buckets, config] = await Promise.all([readBucketMetas(now, src), readTierConfig(src)]);
  const { kept } = await readContactLines(companies, keys, buckets, q, config, src);
  return { companies: contactRowsOf(kept, config, q.sort) };
}

/**
 * 「연락 예정 업체」 줄을 펼친 공고 목록 — readContacts 와 같은 거르기를 업체 하나에.
 * 업체가 없거나 범위 밖(scopeAllows 가 거짓)이면 null(통로가 404 — 있는지조차 알리지 않는다).
 * announcements = 해당 없음이 아닌 남은 줄(sort 가 "tier" 면 맞을 확률 순, 아니면 마감 가까운 순),
 * dismissed = 그 업체의 거르기 안 날짜 마감 해당 없음 줄(진행·조건 정리 전·단계 거르기와 상관없이, 마감 가까운 순).
 */
export async function readCompanyAnnouncements(
  scope: DeadlineScope,
  q: { customerKey: string; days: DaysFilter; includeUnstructured: boolean; includeProgress: boolean; tiers?: DeadlineTier[]; sort?: SortOrder },
  now: Date,
  src: ReadSource,
): Promise<CompanyAnnouncementsView | null> {
  const [company] = await src.companies({ customerKeys: [q.customerKey] });
  if (!company) return null;
  if (!scopeAllows(scope, company)) return null;
  const [buckets, config] = await Promise.all([readBucketMetas(now, src), readTierConfig(src)]);
  const { kept, dismissed } = await readContactLines([company], [company.customerKey], buckets, q, config, src);
  const byDeadline = (a: ScoredLine, b: ScoredLine) => compareByApplyEnd(a.line.bucket, b.line.bucket);
  const scored = kept.map((line) => scoredLineOf(line, config));
  const ordered = q.sort === "tier" ? sortedByTier(scored, (s) => s.order) : scored.sort(byDeadline);
  return {
    company,
    announcements: ordered.map(companyAnnouncementRowOf),
    dismissed: dismissed
      .map((line) => scoredLineOf(line, config))
      .sort(byDeadline)
      .map(companyAnnouncementRowOf),
  };
}

/** 연락 예정 업체를 분야별로 센다 — 한 업체가 여러 분야면 각 분야에 센다. 「그 밖」은 정책자금·무상지원금이 아닌 분류(빈 분류 포함)가 하나라도 있는 업체. */
function contactKindCounts(categoriesByCompany: Map<string, Set<string>>): SummaryView["contactKinds"] {
  const [fund, grant] = KINDS_FIRST;
  const counts = { policyFund: 0, freeGrant: 0, other: 0 };
  for (const names of categoriesByCompany.values()) {
    if (names.has(fund)) counts.policyFund += 1;
    if (names.has(grant)) counts.freeGrant += 1;
    if ([...names].some((n) => n !== fund && n !== grant)) counts.other += 1;
  }
  return counts;
}

/**
 * 「오늘 할 일」 — 마감 D-0~D-7 · 해당 없음 아님 · 조건 정리 전 아님인 줄을 업체별로 센다.
 * inProgress = 진행 줄이 하나라도 있는 업체, contactNow = 진행하지 않은 줄 중 높음이 있는 업체,
 * checkFirst = 진행하지 않은 줄 중 보통이 있고 contactNow 에 들지 않은 업체.
 */
function todayCountsOf(lines: ContactLine<ReadMatchKey>[], config: TierConfig): SummaryView["today"] {
  const inProgress = new Set<string>();
  const contactNow = new Set<string>();
  const hasMid = new Set<string>();
  for (const line of lines) {
    if (!inDays(line.bucket.dDay, 7) || line.dismissed || isPreStructureMatch(line.match)) continue;
    const key = line.company.customerKey;
    if (line.progress) {
      inProgress.add(key);
      continue;
    }
    const tier = lineTierOf(line.match, config);
    if (tier === "high") contactNow.add(key);
    else if (tier === "mid") hasMid.add(key);
  }
  const checkFirst = [...hasMid].filter((key) => !contactNow.has(key)).length;
  return { contactNow: contactNow.size, checkFirst, inProgress: inProgress.size };
}

/**
 * 요약 카드 두 장과 그 안 고르기 옆 숫자. contacts 는 readContacts(기본 거르기)의 업체 수와 같아야 한다 — 해당 없음 줄을 뺀 뒤 센다.
 * buckets 는 판정 수(matchCounts, 읽기 목록과 같은 방식)와 이미 읽은 묶음 표시 칸으로 센다 — readAnnouncementList 의 0곳 숨김 목록 줄 수와 늘 같다.
 * 판정 줄은 7일·연락 예정 기본 거르기 중 넓은 범위의 날짜 마감 묶음 것을 거르기 칸만 한 번 읽어 within7Companies·contacts·contactKinds·today 를 함께 센다
 * (matches 를 두 번 읽던 때는 범위 all 이 3초를 넘었다). 판정 수와 판정 줄은 서로 기다릴 까닭이 없어 함께 읽는다.
 */
export async function readSummary(
  scope: DeadlineScope,
  now: Date,
  src: ReadSource,
): Promise<SummaryView> {
  const { companies, keys } = await readScope(scope, src);
  const buckets = await readBucketMetas(now, src);
  const q0: ContactQuery = {
    days: CONTACTS_DEFAULT_DAYS,
    includeUnstructured: CONTACTS_INCLUDE_UNSTRUCTURED_DEFAULT,
    includeProgress: false,
  };
  const [counts, lines, config] = await Promise.all([
    // 업체가 0곳이면 세지 않는다 — 빈 범위를 「전체(열쇠 null)」로 세지 않게.
    companies.length === 0 ? [] : src.matchCounts(keys),
    readRangeLines(companies, keys, datedBucketsWithin(buckets, widerDays(q0.days, 7)), (f) => src.matchKeys(f), src),
    readTierConfig(src),
  ]);

  // 7일 안: 진행·조건 정리·해당 없음 여부와 상관없이 판정 줄이 하나라도 있는 업체.
  const within7 = new Set<string>();
  for (const line of lines) {
    if (inDays(line.bucket.dDay, 7)) within7.add(line.company.customerKey);
  }

  // 마감 고르기별 공고 수: 판정(맞음·확인 필요)이 하나라도 있는 날짜 마감 묶음만.
  const judged = new Set<string>();
  for (const c of counts) {
    if (c.count > 0) judged.add(c.bucketKey);
  }
  const bucketCounts = { d7: 0, d14: 0, d30: 0, all: 0 };
  for (const b of buckets) {
    if (!judged.has(b.bucketKey)) continue;
    if (inDays(b.dDay, 7)) bucketCounts.d7 += 1;
    if (inDays(b.dDay, 14)) bucketCounts.d14 += 1;
    if (inDays(b.dDay, 30)) bucketCounts.d30 += 1;
    if (inDays(b.dDay, "all")) bucketCounts.all += 1;
  }

  // 연락 예정: readContacts 와 같은 keepsContactLine 을 지나 탭 목록 수와 늘 같다 — 남은 업체와 그 업체의 분야만 모은다.
  const categoriesByCompany = new Map<string, Set<string>>();
  for (const line of lines) {
    if (!keepsContactLine(line, q0, config)) continue;
    const names = categoriesByCompany.get(line.company.customerKey);
    if (names) names.add(line.bucket.category);
    else categoriesByCompany.set(line.company.customerKey, new Set([line.bucket.category]));
  }
  return {
    within7Companies: within7.size,
    contacts: categoriesByCompany.size,
    buckets: bucketCounts,
    contactKinds: contactKindCounts(categoriesByCompany),
    today: todayCountsOf(lines, config),
  };
}

/**
 * 엑셀 줄 — 지금 보이는 목록(readAnnouncementList 와 같은 dated 다음 always 순서)의 묶음마다 범위 안 업체 판정 줄,
 * 묶음 안에서는 맞음 먼저 그다음 확인 필요, 각각 업체명 글자 순(같으면 customerKey 순).
 * sort 가 "tier" 면 묶음은 목록과 같은 가장 높은 단계 순(fitOnly 와 상관없이 같은 셈), 묶음 안은 맞을 확률 순(해당 없음 맨 뒤).
 * fitOnly 면 맞음만, category 를 주면(undefined 가 아니면) 그 분류 묶음만(빈 글자 = 분류 없음).
 * 묶음 EXPORT_BUCKET_CHUNK 개씩 matches·progress·dismissals 를 읽고, EXPORT_MAX_ROWS 에 닿으면 더 읽지 않는다.
 * 해당 없음 줄도 싣는다(사유 칸) — 줄 수가 바뀌지 않게.
 * total = 거르기에 맞는 줄 수 전부(matchCounts 로 센다 — fitOnly 면 맞음 수만), truncated = total > rows.length.
 */
export async function readExport(
  scope: DeadlineScope,
  q: { days: DaysFilter; fitOnly: boolean; category?: string; sort?: SortOrder },
  now: Date,
  src: ReadSource,
): Promise<ExportView> {
  const { companies, keys } = await readScope(scope, src);
  if (companies.length === 0) return { rows: [], total: 0, truncated: false };

  const configP = readTierConfig(src);
  const [metas, countOf, config] = await Promise.all([readBucketMetas(now, src), bucketCountsOf(src, keys, () => configP), configP]);
  const split = splitBuckets(metas, q.days);
  const bestOf = (b: BucketMeta) => bestTierOf((countOf.get(b.bucketKey) ?? emptyBucketCount()).tiers);
  const { dated, always } = q.sort === "tier" ? { dated: byBestTier(split.dated, bestOf), always: byBestTier(split.always, bestOf) } : split;
  const picked = [...dated, ...always].filter((b) => q.category === undefined || b.category === q.category);

  // total 은 줄을 읽지 않고 센다 — 잘려도 「전체 몇 줄」을 알려 주려고.
  const total = picked.reduce((sum, b) => {
    const count = countOf.get(b.bucketKey);
    return count ? sum + count.fit + (q.fitOnly ? 0 : count.unverified) : sum;
  }, 0);

  const known = companiesByKey(companies);
  const rows: ExportRow[] = [];
  for (const part of chunked(picked, EXPORT_BUCKET_CHUNK)) {
    const filter = { customerKeys: keys, bucketKeys: part.map((b) => b.bucketKey) };
    const [matches, progress, dismissals] = await Promise.all([src.matches(filter), src.progress(filter), readDismissals(src, filter)]);
    const done = progressByKey(progress);
    const dismissed = dismissalsByKey(dismissals);
    const byBucket = new Map<string, ReadMatch[]>();
    for (const match of matches) {
      const list = byBucket.get(match.bucketKey);
      if (list) list.push(match);
      else byBucket.set(match.bucketKey, [match]);
    }
    for (const bucket of part) {
      const lines: { company: ReadCompany; match: ReadMatch; view: TierView; dismissed: StoredDismissal | undefined }[] = [];
      for (const match of byBucket.get(bucket.bucketKey) ?? []) {
        const company = known.get(match.customerKey);
        if (!company || (q.fitOnly && match.verdict !== "fit")) continue;
        const key = progressKey(company.customerKey, bucket.bucketKey);
        lines.push({ company, match, view: tierViewOf(match, done.has(key), config), dismissed: dismissed.get(key) });
      }
      // 묶음 안: 맞을 확률 순, 아니면 맞음 먼저 그다음 확인 필요 — 각각 업체명·customerKey 순.
      const ordered =
        q.sort === "tier"
          ? sortedByTier(lines, (l) => orderKeyOf(l.view, l.dismissed !== undefined, bucket.applyEnd, l.company.companyName, l.company.customerKey))
          : lines.sort((a, b) => Number(a.match.verdict !== "fit") - Number(b.match.verdict !== "fit") || compareByCompany(a.company, b.company));
      for (const { company, match, view, dismissed: dismissal } of ordered) {
        if (rows.length >= EXPORT_MAX_ROWS) break;
        rows.push({
          applyEnd: bucket.applyEnd,
          dDay: bucket.dDay,
          title: bucket.title,
          agency: bucket.agency,
          category: bucket.category,
          url: bucket.url,
          companyName: company.companyName,
          consultant: company.consultant,
          statusText: company.statusText,
          verdict: match.verdict,
          fitLabels: match.fitLabels,
          toCheck: match.toCheck,
          gaps: match.gaps,
          inProgress: done.has(progressKey(company.customerKey, bucket.bucketKey)),
          tier: view.tier,
          tierReason: view.tierReason,
          nextAction: view.nextAction,
          unstructured: view.unstructured,
          dismissedReason: dismissal ? dismissal.reason : "",
        });
      }
    }
    // 최대 줄에 닿으면 다음 묶음 조각은 읽지 않는다.
    if (rows.length >= EXPORT_MAX_ROWS) break;
  }
  return { rows, total, truncated: total > rows.length };
}
