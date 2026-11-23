// 정책별 고객사 「맞을 확률」 화면 계산(NO.789) — 단계 글자·단계 고르기·확인 항목 묶기·금액 글·오늘 줄·목록 나누기.
// 순서·단계·확인 항목은 서버가 준 값(TierView·ContactBest·tiers)과 compareByTier 만 쓴다. 순수 계산이라 React 를 가져오지 않는다.
import { compareByTier } from "../../serve/policy-deadline/order";
import { DEFAULT_TIER_CONFIG, TIER_LABEL } from "../../serve/policy-deadline/tier";
import type {
  AnnouncementListRow,
  CheckItem,
  CompanyAnnouncementRow,
  CompanyMatchRow,
  DeadlineTier,
  DismissInfo,
  ProgressInfo,
  SortOrder,
  SummaryView,
  TierView,
} from "../../serve/policy-deadline/types";
import { UNSTRUCTURED_LABEL, dateLabel, type ContactListRow } from "./deadline-view";

export { UNSTRUCTURED_LABEL };

/**
 * 「업무 현황에 추가」한 줄 — 진행 기록을 붙이고 다음 할 일을 「업무 현황에서 진행 중」(서버 nextActionOf 의 기본 말)으로 바꾼다.
 * 다시 읽기 전까지 「고객에게 연락해 신청 안내」가 진행 표시 옆에 남지 않게.
 */
export function markProgressed<T extends { progress: ProgressInfo | null; nextAction: string }>(row: T, done: ProgressInfo): T {
  return { ...row, progress: done, nextAction: DEFAULT_TIER_CONFIG.text.inProgress };
}

/** 단계 순서 — 높음 → 보통 → 낮음. */
export const TIER_ORDER: readonly DeadlineTier[] = ["high", "mid", "low"];
/** 첫 화면에서 켜 두는 단계 — 컨설턴트 기본 보기(높음·보통). */
export const DEFAULT_TIERS: readonly DeadlineTier[] = ["high", "mid"];
/** 색 말고도 모양으로 가르는 딱지 표시. */
export const TIER_MARK: Record<DeadlineTier, string> = { high: "●", mid: "◐", low: "○" };

/** 딱지 글자 — AI 가 자격 조건을 확정하지 못한 줄(조건 정리 전)은 단계와 상관없이 「원문 확인 필요」. */
export function tierText(tier: DeadlineTier, unstructured: boolean): string {
  return unstructured ? UNSTRUCTURED_LABEL : TIER_LABEL[tier];
}

/** 화면 읽어 주는 글 — 「맞을 확률 높음」. */
export function tierAria(tier: DeadlineTier, unstructured: boolean): string {
  return `맞을 확률 ${tierText(tier, unstructured)}`;
}

/** 단계 단추를 누른 결과 — 있으면 빼고 없으면 넣되, 빼서 비게 되면 그대로 둔다(마지막 하나는 끌 수 없다). 결과는 늘 높음 → 보통 → 낮음 순. */
export function toggleTier(selected: readonly DeadlineTier[], tier: DeadlineTier): DeadlineTier[] {
  const next = selected.includes(tier) ? selected.filter((t) => t !== tier) : [...selected, tier];
  const ordered = TIER_ORDER.filter((t) => next.includes(t));
  return ordered.length > 0 ? ordered : TIER_ORDER.filter((t) => selected.includes(t));
}

function checkGroup(items: readonly CheckItem[], group: CheckItem["group"]): CheckItem[] {
  return items.filter((item) => item.group === group).sort((a, b) => a.rank - b.rank);
}

/** 확인 항목을 업체 칸 채우기 · 공고 원문 확인 · 참고로 나눈다 — 묶음마다 중요한 순(rank 작은 순, 같으면 받은 순서). */
export function checkGroupsOf(items: readonly CheckItem[]): { company: CheckItem[]; notice: CheckItem[]; ref: CheckItem[] } {
  return { company: checkGroup(items, "company"), notice: checkGroup(items, "notice"), ref: checkGroup(items, "ref") };
}

/** 펼치지 않아도 보이는 한 줄 — 확인할 것 개수(참고 뺌)와 두 묶음을 통틀어 가장 중요한 항목. */
export function firstCheckText({ checkItems, checkCount }: Pick<TierView, "checkItems" | "checkCount">): string {
  if (checkCount === 0) return "확인할 것 없음";
  let first: CheckItem | null = null;
  for (const item of checkItems) {
    if (item.group !== "ref" && (first === null || item.rank < first.rank)) first = item;
  }
  return first ? `확인할 것 ${checkCount}개 · ${first.what}` : `확인할 것 ${checkCount}개`;
}

const EOK = 100_000_000;
const MAN = 10_000;

/** 천 단위 쉼표 — 로케일을 쓰지 않고 손으로 넣는다. */
function withCommas(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** 지원 금액 글 — 「최대 1억 5,000만원」. 만원 아래 자투리는 버리고, 모르거나 0 이하면 null(그리지 않는다). */
export function amountLabel(won: number | null | undefined): string | null {
  if (won === null || won === undefined || !Number.isFinite(won)) return null;
  const whole = Math.floor(won);
  if (whole <= 0) return null;
  const eok = Math.floor(whole / EOK);
  const man = Math.floor((whole % EOK) / MAN);
  if (eok > 0 && man > 0) return `최대 ${withCommas(eok)}억 ${withCommas(man)}만원`;
  if (eok > 0) return `최대 ${withCommas(eok)}억원`;
  if (man > 0) return `최대 ${withCommas(man)}만원`;
  return `최대 ${withCommas(whole)}원`;
}

/** 오늘 할 일 한 줄. */
export function todayLine(today: SummaryView["today"]): string {
  return `오늘 연락할 곳 ${today.contactNow}곳 · 확인 후 연락 ${today.checkFirst}곳 · 진행함 ${today.inProgress}곳`;
}

export type TierNoun = "업체" | "공고";

/** 업체는 곳, 공고는 건. */
const unitOf = (noun: TierNoun) => (noun === "업체" ? "곳" : "건");

/** 고르지 않은 단계라 숨긴 수 안내 — 숨긴 것이 없으면 빈 글. */
export function hiddenHint(n: number, noun: TierNoun): string {
  return n === 0 ? "" : `고르지 않은 단계의 ${noun} ${n}${unitOf(noun)}은 숨겼습니다`;
}

/** 「원문 확인 필요」 묶음 제목. */
export function unstructuredTitle(n: number, noun: TierNoun): string {
  return `원문 확인 필요 ${noun} ${n}${unitOf(noun)} · AI가 공고 자격 조건을 확정하지 못해 맞을 확률 대신 확인할 것을 보여 줍니다`;
}

/** 「해당 없음」 묶음 제목. */
export function dismissedTitle(n: number, noun: TierNoun): string {
  return `해당 없음 ${noun} ${n}${unitOf(noun)}`;
}

/** 해당 없음 표시 — 「해당 없음 · 사유 · 표시한 사람 · MM/DD(요일)」(서울 날짜). 시각을 못 읽으면 날짜 없이. */
export function dismissedNoteText(d: DismissInfo): string {
  const head = `해당 없음 · ${d.reason} · ${d.byName}`;
  const ms = Date.parse(d.at);
  if (!Number.isFinite(ms)) return head;
  const kst = new Date(ms + 9 * 3_600_000);
  const day = `${kst.getUTCFullYear()}-${String(kst.getUTCMonth() + 1).padStart(2, "0")}-${String(kst.getUTCDate()).padStart(2, "0")}`;
  return `${head} · ${dateLabel(day)}`;
}

/** 단계 단추 숫자 — 고른 단계와 상관없이 전부 센다(원문 확인 필요는 따로). */
export interface TierChipCounts {
  high: number;
  mid: number;
  low: number;
  unstructured: number;
}

const emptyCounts = (): TierChipCounts => ({ high: 0, mid: 0, low: 0, unstructured: 0 });

/** 연락 예정 업체 줄을 가장 좋은 공고(best)의 단계로 나눈다 — 순서는 받은 그대로. */
export function partitionContactRows(
  rows: readonly ContactListRow[],
  tiers: readonly DeadlineTier[],
): { main: ContactListRow[]; unstructured: ContactListRow[]; hidden: number; counts: TierChipCounts } {
  const main: ContactListRow[] = [];
  const unstructured: ContactListRow[] = [];
  const counts = emptyCounts();
  let hidden = 0;
  for (const r of rows) {
    if (r.best.unstructured) {
      unstructured.push(r);
      counts.unstructured += 1;
      continue;
    }
    counts[r.best.tier] += 1;
    if (tiers.includes(r.best.tier)) main.push(r);
    else hidden += 1;
  }
  return { main, unstructured, hidden, counts };
}

/**
 * 정책별 공고 줄을 나눈다 — 고른 단계 줄이 하나라도 있으면 본 목록, 원문 확인 필요 줄만 있으면 원문 확인 필요 묶음.
 * 줄이 아예 없는 공고(bestTier 도 원문 확인 필요도 없음)는 본 목록에 둔다 — 「0곳 숨기기」가 정한다.
 * 단추 숫자는 업체·공고 짝 수를 더한다.
 */
export function partitionAnnouncements(
  rows: readonly AnnouncementListRow[],
  tiers: readonly DeadlineTier[],
): { main: AnnouncementListRow[]; unstructured: AnnouncementListRow[]; hidden: number; counts: TierChipCounts } {
  const main: AnnouncementListRow[] = [];
  const unstructured: AnnouncementListRow[] = [];
  const counts = emptyCounts();
  let hidden = 0;
  for (const row of rows) {
    counts.high += row.tiers.high;
    counts.mid += row.tiers.mid;
    counts.low += row.tiers.low;
    counts.unstructured += row.unstructured;
    if (row.bestTier === null) {
      if (row.unstructured > 0) unstructured.push(row);
      else main.push(row);
      continue;
    }
    if (tiers.reduce((sum, t) => sum + row.tiers[t], 0) > 0) main.push(row);
    else hidden += 1;
  }
  return { main, unstructured, hidden, counts };
}

/** 펼친 줄을 나눈다 — 해당 없음은 단계·원문 확인 필요와 상관없이 따로, 원문 확인 필요 따로, 나머지는 고른 단계만. 단추 숫자는 해당 없음을 뺀다. */
export function partitionLines<T extends Pick<TierView, "tier" | "unstructured"> & { dismissed: DismissInfo | null }>(
  rows: readonly T[],
  tiers: readonly DeadlineTier[],
): { main: T[]; unstructured: T[]; dismissed: T[]; hidden: number; counts: TierChipCounts } {
  const main: T[] = [];
  const unstructured: T[] = [];
  const dismissed: T[] = [];
  const counts = emptyCounts();
  let hidden = 0;
  for (const r of rows) {
    if (r.dismissed !== null) {
      dismissed.push(r);
      continue;
    }
    if (r.unstructured) {
      unstructured.push(r);
      counts.unstructured += 1;
      continue;
    }
    counts[r.tier] += 1;
    if (tiers.includes(r.tier)) main.push(r);
    else hidden += 1;
  }
  return { main, unstructured, dismissed, hidden, counts };
}

/** 공고 줄 「대상 기업」 아래 한 줄 — 고른 단계만 높음 → 보통 → 낮음 순으로 「높음 2곳 · 보통 1곳」, 0곳은 빼고 하나도 없으면 빈 글. */
export function tierCountLine(tiers: { high: number; mid: number; low: number }, selected: readonly DeadlineTier[]): string {
  return TIER_ORDER.filter((t) => selected.includes(t) && tiers[t] > 0)
    .map((t) => `${TIER_LABEL[t]} ${tiers[t]}곳`)
    .join(" · ");
}

/**
 * 펼친 줄을 서버와 같은 순서(compareByTier)로 새로 세운다 — 「해당 없음」을 남기거나 되돌린 뒤에 쓴다.
 * 줄 사이에서는 마감이 같은 묶음이라 마감은 비교하지 않고(null), 이름 자리는 업체명이다.
 */
export function sortCompanyLines(rows: readonly CompanyMatchRow[]): CompanyMatchRow[] {
  const orderOf = (r: CompanyMatchRow) => ({
    dismissed: r.dismissed !== null,
    unstructured: r.unstructured,
    tier: r.tier,
    checkCount: r.checkCount,
    applyEnd: null,
    tierScore: r.tierScore,
    name: r.companyName,
    key: r.customerKey,
  });
  return [...rows].sort((a, b) => compareByTier(orderOf(a), orderOf(b)));
}

/**
 * 업체 하나의 공고 줄을 서버(view=company)와 같은 순서로 새로 세운다 — 「해당 없음」을 되돌린 줄을 표에 다시 넣을 때 제자리를 찾는다.
 * "tier" 는 compareByTier(업체 안 공고끼리라 이름·열쇠 자리는 공고 열쇠), "deadline" 은 마감 글자 순(마감 없음은 맨 앞)에 같으면 공고 열쇠 순.
 */
export function sortAnnouncementLines(rows: readonly CompanyAnnouncementRow[], sort: SortOrder): CompanyAnnouncementRow[] {
  if (sort === "deadline") {
    return [...rows].sort((a, b) => {
      const endA = a.applyEnd ?? "";
      const endB = b.applyEnd ?? "";
      if (endA !== endB) return endA < endB ? -1 : 1;
      return a.bucketKey < b.bucketKey ? -1 : a.bucketKey > b.bucketKey ? 1 : 0;
    });
  }
  const orderOf = (r: CompanyAnnouncementRow) => ({
    dismissed: r.dismissed !== null,
    unstructured: r.unstructured,
    tier: r.tier,
    checkCount: r.checkCount,
    applyEnd: r.applyEnd,
    tierScore: r.tierScore,
    name: r.bucketKey,
    key: r.bucketKey,
  });
  return [...rows].sort((a, b) => compareByTier(orderOf(a), orderOf(b)));
}
