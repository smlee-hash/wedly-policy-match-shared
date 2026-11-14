/**
 * 정책별 고객사·연락 예정(미리 대조 결과 읽기) — 「정책별 고객사」·「연락 예정 업체」 탭과 엑셀이 쓰는 읽기 계산.
 * 판정 줄이 업체 300곳 × 공고 묶음 수천 개라 목록은 (묶음, 판정)별 수만 세고, 업체 줄은 펼칠 때 묶음 하나·업체 하나씩 읽는다.
 *
 * ERP `services/policy-deadline/read.ts` 를 그대로 옮기되 「누가 보나」만 주입으로 바꿨다:
 * 첫 인자가 `viewer`(로그인 사용자) 가 아니라 `scope`(앱이 정한 보는 범위 — `./scope`) 이고, 읽는 자리(`src`)는 필수다.
 * 계산 글자·정렬·숫자 규칙은 바꾸지 않았다.
 */
import { GENERIC_TO_CHECK, dDayOf } from "../../funding/funding-map";
import { kstDateKey } from "./kst";
import { readScope, scopeAllows, type DeadlineScope } from "./scope";
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
  type ContactCompanyRow,
  type ContactKind,
  type ContactsView,
  type DaysFilter,
  type DeadlineBucket,
  type DeadlineJudgement,
  type ExportRow,
  type ExportView,
  type ProgressInfo,
  type ReadCompany,
  type ReadMatch,
  type ReadMatchKey,
  type ReadSource,
  type StoredProgress,
  type SummaryView,
} from "./types";

/** 공용 「조건 정리 전」 문구 모음 — 줄마다 배열을 훑지 않게 한 번만 Set 으로 만든다. */
const GENERIC_CHECKS = new Set<string>(GENERIC_TO_CHECK);

/**
 * 「조건 정리 전」 판정 줄인가 — 확인 필요(unverified)이고 확인할 조건이 모두 공용 GENERIC_TO_CHECK
 * (「공고 원문 확인(조건 정리 전)」·「자격 조건 원문 확인」) 안에 든다(빈 목록도 해당). 맞음(fit)은 늘 false.
 */
export function isUnstructuredMatch(m: Pick<DeadlineJudgement, "verdict" | "toCheck">): boolean {
  return m.verdict === "unverified" && m.toCheck.every((t) => GENERIC_CHECKS.has(t));
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

function companyMatchRowOf(c: ReadCompany, m: DeadlineJudgement, p: StoredProgress | undefined): CompanyMatchRow {
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
  };
}

/** 날짜 마감 묶음 — 연락 예정 줄은 마감이 늘 있어 applyEnd·dDay 가 null 이 아니다. */
type DatedBucket = BucketMeta & { applyEnd: string; dDay: number };

function isDated(b: BucketMeta): b is DatedBucket {
  return b.applyEnd !== null && b.dDay !== null;
}

/** 묶음 범위 안 판정 줄 한 벌 — 업체·묶음·판정·진행. 연락 예정에 남길지는 keepsContactLine 이 정한다. */
interface ContactLine<M extends ReadMatchKey = ReadMatch> {
  company: ReadCompany;
  bucket: DatedBucket;
  match: M;
  progress: StoredProgress | undefined;
}

/** 「연락 예정」 거르기 — 마감 범위·조건 정리 전 포함·진행 포함. */
interface ContactQuery {
  days: DaysFilter;
  includeUnstructured: boolean;
  includeProgress: boolean;
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
 * 요약 숫자와 목록 수가 늘 같다. 마감이 q.days 안이고, 조건 정리 전·진행한 줄은 q 가 끄면 뺀다.
 */
function keepsContactLine(line: ContactLine<ReadMatchKey>, q: ContactQuery): boolean {
  if (!inDays(line.bucket.dDay, q.days)) return false;
  if (!q.includeUnstructured && isUnstructuredMatch(line.match)) return false;
  return q.includeProgress || !line.progress;
}

/**
 * inRange 묶음의 판정·진행 줄을 업체·묶음으로 이어 읽는다(거르기는 하지 않는다). 업체가 0곳이거나 inRange 가 비면
 * 읽지 않고, 묶음 열쇠는 EXPORT_BUCKET_CHUNK 개씩 나눠 읽는다. 판정은 read 로 읽어 호출한 쪽이 칸 수를 고른다.
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
  const lines: ContactLine<M>[] = [];
  for (const part of chunked([...inRange.keys()], EXPORT_BUCKET_CHUNK)) {
    const [matches, progress] = await Promise.all([
      read({ customerKeys: keys, bucketKeys: part }),
      src.progress({ customerKeys: keys, bucketKeys: part }),
    ]);
    const done = progressByKey(progress);
    for (const match of matches) {
      const company = known.get(match.customerKey);
      const bucket = inRange.get(match.bucketKey);
      if (!company || !bucket) continue;
      lines.push({ company, bucket, match, progress: done.get(progressKey(match.customerKey, match.bucketKey)) });
    }
  }
  return lines;
}

/**
 * readContacts·readCompanyAnnouncements 의 연락 예정 줄 — 거르기 안 날짜 마감 묶음의 열쇠만 넘겨 읽고(열쇠가 비면 읽지 않는다)
 * keepsContactLine 을 지난 줄만 남긴다.
 */
async function readContactLines(
  companies: ReadCompany[],
  keys: string[] | null,
  buckets: BucketMeta[],
  q: ContactQuery,
  src: ReadSource,
): Promise<ContactLine[]> {
  const lines = await readRangeLines(companies, keys, datedBucketsWithin(buckets, q.days), (f) => src.matches(f), src);
  return lines.filter((l) => keepsContactLine(l, q));
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

/** 남은 줄을 업체별로 묶어 연락 예정 업체 줄로 — 가장 가까운 마감 순(같으면 업체명, customerKey 순). */
function contactRowsOf(lines: ContactLine<ReadMatchKey>[]): ContactCompanyRow[] {
  const byCompany = new Map<string, ContactLine<ReadMatchKey>[]>();
  for (const line of lines) {
    const list = byCompany.get(line.company.customerKey);
    if (list) list.push(line);
    else byCompany.set(line.company.customerKey, [line]);
  }
  const rows: ContactCompanyRow[] = [];
  for (const list of byCompany.values()) {
    const { company } = list[0];
    const kinds = new Map<string, ContactKind>();
    let nearest = list[0].bucket;
    let progressCount = 0;
    for (const { bucket, progress } of list) {
      if (compareText(bucket.applyEnd, nearest.applyEnd) < 0) nearest = bucket;
      const kind = kinds.get(bucket.category);
      if (kind) {
        kind.count += 1;
        kind.nearestDDay = Math.min(kind.nearestDDay, bucket.dDay);
      } else {
        kinds.set(bucket.category, { category: bucket.category, count: 1, nearestDDay: bucket.dDay });
      }
      if (progress) progressCount += 1;
    }
    rows.push({
      customerKey: company.customerKey,
      companyName: company.companyName,
      consultant: company.consultant,
      consultantNames: company.consultantNames,
      statusText: company.statusText,
      nearestApplyEnd: nearest.applyEnd,
      nearestDDay: nearest.dDay,
      kinds: [...kinds.values()].sort((a, b) => kindRank(a.category) - kindRank(b.category) || compareText(a.category, b.category)),
      announcementCount: list.length,
      progressCount,
    });
  }
  return rows.sort((a, b) => compareText(a.nearestApplyEnd, b.nearestApplyEnd) || compareByCompany(a, b));
}

/**
 * 「정책별 업체」·「정책별 고객사」 목록. 범위 안 업체 → matchCounts(그 업체 열쇠, 범위가 all 이면 null) →
 * 묶음 전부를 bucketMetaOf 로 바꿔 날짜 마감은 inDays(days) 안 것만 dated, 상시는 전부 always.
 * hideEmpty 면 fit + unverified 가 0인 줄을 뺀다(dated·always 모두). 범위 안 업체가 0곳이면 matchCounts 를 부르지 않고 수는 모두 0.
 */
export async function readAnnouncementList(
  scope: DeadlineScope,
  q: { days: DaysFilter; hideEmpty: boolean },
  now: Date,
  src: ReadSource,
): Promise<AnnouncementListView> {
  const { companies, keys } = await readScope(scope, src);
  // 업체가 0곳이면 세지 않는다 — 빈 범위를 「전체(열쇠 null)」로 세지 않게.
  const counts = companies.length === 0 ? [] : await src.matchCounts(keys);
  const countOf = new Map<string, { fit: number; unverified: number }>();
  for (const c of counts) {
    const row = countOf.get(c.bucketKey) ?? { fit: 0, unverified: 0 };
    row[c.verdict] += c.count;
    countOf.set(c.bucketKey, row);
  }
  const metas = await readBucketMetas(now, src);
  const rows: AnnouncementListRow[] = metas.map((b) => ({
    ...b,
    fit: countOf.get(b.bucketKey)?.fit ?? 0,
    unverified: countOf.get(b.bucketKey)?.unverified ?? 0,
  }));
  const shown = q.hideEmpty ? rows.filter((r) => r.fit + r.unverified > 0) : rows;
  const { dated, always } = splitBuckets(shown, q.days);
  return {
    lastRun: await src.lastRun(),
    companyCount: companies.length,
    bucketCount: metas.length,
    categories: [...new Set(metas.map((b) => b.category))].filter((c) => c !== "").sort(compareText),
    dated,
    always,
  };
}

/**
 * 묶음 하나를 펼친 업체 표. 묶음이 없으면 null(통로가 404). 범위 안 업체의 그 묶음 판정 줄을 맞음·확인 필요로 나누고,
 * 그 묶음의 진행 줄을 (업체)로 붙인다. 판정 줄이 있어도 범위 밖 업체는 넣지 않는다.
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
  const view: BucketCompaniesView = { bucket: bucketMetaOf(bucket, now), fit: [], unverified: [] };
  if (companies.length === 0) return view;
  const [matches, progress] = await Promise.all([
    src.matches({ customerKeys: keys, bucketKeys: [q.bucketKey] }),
    src.progress({ customerKeys: keys, bucketKeys: [q.bucketKey] }),
  ]);
  const known = companiesByKey(companies);
  const done = progressByKey(progress);
  for (const match of matches) {
    // 범위 all(열쇠 null)도 업체 표에 있는 줄만 싣는다.
    const company = known.get(match.customerKey);
    if (!company) continue;
    const row = companyMatchRowOf(company, match, done.get(progressKey(match.customerKey, match.bucketKey)));
    (match.verdict === "fit" ? view.fit : view.unverified).push(row);
  }
  view.fit.sort(compareByCompany);
  view.unverified.sort(compareByCompany);
  return view;
}

/**
 * 「연락 예정 업체」. 범위 안 업체의 판정 줄 중 날짜 마감이 inDays(days) 안인 묶음 것만 본다(상시 빼기).
 * includeUnstructured 가 꺼져 있으면 isUnstructuredMatch 줄을 빼고, includeProgress 가 꺼져 있으면 진행 줄이 있는 (업체, 묶음)을 뺀다.
 * 남은 줄이 하나도 없는 업체는 넣지 않는다. 묶음 줄은 거르기 안 날짜 마감 묶음만 읽는다(matches 의 bucketKeys 도 그 묶음).
 */
export async function readContacts(
  scope: DeadlineScope,
  q: { days: DaysFilter; includeUnstructured: boolean; includeProgress: boolean },
  now: Date,
  src: ReadSource,
): Promise<ContactsView> {
  const { companies, keys } = await readScope(scope, src);
  const lines = await readContactLines(companies, keys, await readBucketMetas(now, src), q, src);
  return { companies: contactRowsOf(lines) };
}

/**
 * 「연락 예정 업체」 줄을 펼친 공고 목록 — readContacts 와 같은 거르기를 업체 하나에.
 * 업체가 없거나 범위 밖(scopeAllows 가 거짓)이면 null(통로가 404 — 있는지조차 알리지 않는다).
 */
export async function readCompanyAnnouncements(
  scope: DeadlineScope,
  q: { customerKey: string; days: DaysFilter; includeUnstructured: boolean; includeProgress: boolean },
  now: Date,
  src: ReadSource,
): Promise<CompanyAnnouncementsView | null> {
  const [company] = await src.companies({ customerKeys: [q.customerKey] });
  if (!company) return null;
  if (!scopeAllows(scope, company)) return null;
  const lines = await readContactLines([company], [company.customerKey], await readBucketMetas(now, src), q, src);
  const announcements: CompanyAnnouncementRow[] = lines.map(({ bucket, match, progress }) => ({
    ...bucket,
    verdict: match.verdict,
    fitLabels: match.fitLabels,
    toCheck: match.toCheck,
    gaps: match.gaps,
    progress: progress ? progressInfoOf(progress) : null,
  }));
  return { company, announcements: announcements.sort(compareByApplyEnd) };
}

/** 연락 예정 업체 줄을 분야별로 센다 — 한 업체가 여러 분야면 각 분야에 센다. 「그 밖」은 정책자금·무상지원금이 아닌 분류(빈 분류 포함)가 하나라도 있는 업체. */
function contactKindCounts(rows: ContactCompanyRow[]): SummaryView["contactKinds"] {
  const [fund, grant] = KINDS_FIRST;
  const counts = { policyFund: 0, freeGrant: 0, other: 0 };
  for (const row of rows) {
    const names = row.kinds.map((k) => k.category);
    if (names.includes(fund)) counts.policyFund += 1;
    if (names.includes(grant)) counts.freeGrant += 1;
    if (names.some((n) => n !== fund && n !== grant)) counts.other += 1;
  }
  return counts;
}

/**
 * 요약 카드 두 장과 그 안 고르기 옆 숫자. contacts 는 readContacts(기본 거르기)의 업체 수와 같아야 한다.
 * buckets 는 판정 수(matchCounts, 읽기 목록과 같은 방식)와 이미 읽은 묶음 표시 칸으로 센다 — readAnnouncementList 의 0곳 숨김 목록 줄 수와 늘 같다.
 * 판정 줄은 7일·연락 예정 기본 거르기 중 넓은 범위의 날짜 마감 묶음 것을 거르기 칸만 한 번 읽어 within7Companies·contacts·contactKinds 를 함께 센다
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
  const [counts, lines] = await Promise.all([
    // 업체가 0곳이면 세지 않는다 — 빈 범위를 「전체(열쇠 null)」로 세지 않게.
    companies.length === 0 ? [] : src.matchCounts(keys),
    readRangeLines(companies, keys, datedBucketsWithin(buckets, widerDays(q0.days, 7)), (f) => src.matchKeys(f), src),
  ]);

  // 7일 안: 진행·조건 정리 여부와 상관없이 판정 줄이 하나라도 있는 업체.
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

  // 연락 예정: readContacts 와 같은 keepsContactLine 을 지나 탭 목록 수와 늘 같다.
  const contactRows = contactRowsOf(lines.filter((l) => keepsContactLine(l, q0)));
  return { within7Companies: within7.size, contacts: contactRows.length, buckets: bucketCounts, contactKinds: contactKindCounts(contactRows) };
}

/**
 * 엑셀 줄 — 지금 보이는 목록(readAnnouncementList 와 같은 dated 다음 always 순서)의 묶음마다 범위 안 업체 판정 줄,
 * 묶음 안에서는 맞음 먼저 그다음 확인 필요, 각각 업체명 글자 순(같으면 customerKey 순).
 * fitOnly 면 맞음만, category 를 주면(undefined 가 아니면) 그 분류 묶음만(빈 글자 = 분류 없음).
 * 묶음 EXPORT_BUCKET_CHUNK 개씩 matches·progress 를 읽고, EXPORT_MAX_ROWS 에 닿으면 더 읽지 않는다.
 * total = 거르기에 맞는 줄 수 전부(matchCounts 로 센다 — fitOnly 면 맞음 수만), truncated = total > rows.length.
 */
export async function readExport(
  scope: DeadlineScope,
  q: { days: DaysFilter; fitOnly: boolean; category?: string },
  now: Date,
  src: ReadSource,
): Promise<ExportView> {
  const { companies, keys } = await readScope(scope, src);
  if (companies.length === 0) return { rows: [], total: 0, truncated: false };

  const { dated, always } = splitBuckets(await readBucketMetas(now, src), q.days);
  const picked = [...dated, ...always].filter((b) => q.category === undefined || b.category === q.category);

  // total 은 줄을 읽지 않고 센다 — 잘려도 「전체 몇 줄」을 알려 주려고.
  const countOf = new Map<string, number>();
  for (const c of await src.matchCounts(keys)) {
    if (q.fitOnly && c.verdict !== "fit") continue;
    countOf.set(c.bucketKey, (countOf.get(c.bucketKey) ?? 0) + c.count);
  }
  const total = picked.reduce((sum, b) => sum + (countOf.get(b.bucketKey) ?? 0), 0);

  const known = companiesByKey(companies);
  const rows: ExportRow[] = [];
  for (const part of chunked(picked, EXPORT_BUCKET_CHUNK)) {
    const bucketKeys = part.map((b) => b.bucketKey);
    const [matches, progress] = await Promise.all([
      src.matches({ customerKeys: keys, bucketKeys }),
      src.progress({ customerKeys: keys, bucketKeys }),
    ]);
    const done = progressByKey(progress);
    const byBucket = new Map<string, ReadMatch[]>();
    for (const match of matches) {
      const list = byBucket.get(match.bucketKey);
      if (list) list.push(match);
      else byBucket.set(match.bucketKey, [match]);
    }
    for (const bucket of part) {
      const lines: { company: ReadCompany; match: ReadMatch }[] = [];
      for (const match of byBucket.get(bucket.bucketKey) ?? []) {
        const company = known.get(match.customerKey);
        if (!company || (q.fitOnly && match.verdict !== "fit")) continue;
        lines.push({ company, match });
      }
      // 묶음 안: 맞음 먼저, 그다음 확인 필요 — 각각 업체명·customerKey 순.
      lines.sort((a, b) => Number(a.match.verdict !== "fit") - Number(b.match.verdict !== "fit") || compareByCompany(a.company, b.company));
      for (const { company, match } of lines) {
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
        });
      }
    }
    // 최대 줄에 닿으면 다음 묶음 조각은 읽지 않는다.
    if (rows.length >= EXPORT_MAX_ROWS) break;
  }
  return { rows, total, truncated: total > rows.length };
}
