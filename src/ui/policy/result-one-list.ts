// ② 매칭 결과 「목록 하나」의 규칙 — 합치기·판정 탭·칩·찾기·정렬·쪽 넘김·줄 글자·상태 바뀜을 그리지 않는 순수 함수로 뗀다.
// 목록 자료는 fundingMap 응답 하나다(공고+상품+상시). 이 파일은 그 응답을 다시 부르지 않고, 받은 배열만 거른다.
// 브라우저 흉내(jsdom)가 없어도 시험으로 재려고, 상태 바뀜(`oneListReducer`)과 화면 모델(`oneListViewOf`)도 여기 둔다.
import { FUNDING_GROUP_META, FUNDING_GROUPS, type FundingGroup, type FundingGroupTone } from "../../funding/funding-group";
import { matchesFundingQuery, sortItems, type FundingItem } from "../../funding/funding-map";
import { ANNOUNCEMENT_SOURCE_LABELS } from "../../funding/source-labels";
import type { FitVerdict } from "../../engine/recommend-score";
import type { FundingMapPayload } from "../FundingMap";
import { normalizeQuery } from "./result-conditions";

/** 한 쪽에 보이는 건수. */
export const RESULT_PAGE_SIZE = 10;

/** 마감이 이 날수 안이면 D-day 를 빨간 글자로 보인다. */
const HOT_DAYS = 7;

/**
 * 지도 응답 → 평평한 배열. 갈래마다 정상 항목(items) 뒤에 안 맞아서 뺀 항목(excludedItems)을 붙이고,
 * 같은 id 는 처음 나온 한 줄만 둔다. 자료가 없으면 빈 배열.
 */
export function flattenFundingItems(data: FundingMapPayload | null): FundingItem[] {
  if (!data) return [];
  const seen = new Set<string>();
  const out: FundingItem[] = [];
  for (const block of data.groups) {
    for (const it of [...block.items, ...(block.excludedItems ?? [])]) {
      if (seen.has(it.id)) continue;
      seen.add(it.id);
      out.push(it);
    }
  }
  return out;
}

// ── 판정 탭 ─────────────────────────────────────────────────────────────
export type VerdictTab = "fit" | "unverified" | "excluded";

/** 세 탭 — 항목의 fitVerdict 를 그대로 따른다(fit→지원 가능 · unverified→확인 필요 · excluded→어려움). */
export const VERDICT_TABS: ReadonlyArray<{ key: VerdictTab; label: string }> = [
  { key: "fit", label: "지원 가능" },
  { key: "unverified", label: "확인 필요" },
  { key: "excluded", label: "어려움" },
];

const TAB_LABEL: Record<VerdictTab, string> = { fit: "지원 가능", unverified: "확인 필요", excluded: "어려움" };

export function verdictTabOf(it: { fitVerdict: FitVerdict }): VerdictTab {
  return it.fitVerdict;
}

export function verdictCountsOf(items: readonly FundingItem[]): Record<VerdictTab, number> {
  const counts: Record<VerdictTab, number> = { fit: 0, unverified: 0, excluded: 0 };
  for (const it of items) counts[verdictTabOf(it)] += 1;
  return counts;
}

/** 처음 보이는 탭 — 지원 가능, 그게 0건이면 확인 필요. */
export function defaultVerdictTab(counts: Record<VerdictTab, number>): VerdictTab {
  return counts.fit > 0 ? "fit" : "unverified";
}

// ── 찾기 ────────────────────────────────────────────────────────────────
/** 세 탭 전체를 뒤진다 — 낱말 규칙은 서버·예전 화면과 한 벌(`matchesFundingQuery`). 비어 있으면 그대로 돌려준다. */
export function searchItems(items: FundingItem[], query: string): FundingItem[] {
  const q = normalizeQuery(query);
  if (!q) return items;
  return items.filter((it) => matchesFundingQuery(it, q));
}

// ── 돈의 성격 칩 ────────────────────────────────────────────────────────
export type ChipKey = "all" | FundingGroup;

export interface ChipInfo {
  key: ChipKey;
  label: string;
  count: number;
  /** 점 색 — 「전체」는 없다. */
  tone?: FundingGroupTone;
}

/** 갈래를 못 붙인 줄(`unclassified`)은 임시로 grant 에 앉아 있다 — 갈래 칩에는 세지 않고 「전체」에서만 보인다. */
const inGroup = (it: FundingItem, g: FundingGroup) => it.group === g && !it.unclassified;

/** 「전체 N」 + 6갈래(이름은 `FUNDING_GROUP_META` 그대로). 숫자는 넘겨 받은 배열(= 지금 탭 안) 기준이다. */
export function chipsOf(tabItems: readonly FundingItem[]): ChipInfo[] {
  return [
    { key: "all", label: "전체", count: tabItems.length },
    ...FUNDING_GROUPS.map((g) => ({
      key: g as ChipKey,
      label: FUNDING_GROUP_META[g].name,
      count: tabItems.filter((it) => inGroup(it, g)).length,
      tone: FUNDING_GROUP_META[g].tone,
    })),
  ];
}

export function filterByChip(items: FundingItem[], chip: ChipKey): FundingItem[] {
  return chip === "all" ? items : items.filter((it) => inGroup(it, chip));
}

// ── 정렬 ────────────────────────────────────────────────────────────────
export type OneListSort = "deadline" | "score";

export const ONE_LIST_SORTS: ReadonlyArray<{ value: OneListSort; label: string }> = [
  { value: "deadline", label: "마감 임박 순" },
  { value: "score", label: "추천 순" },
];

/**
 * 마감 임박 순 = 남은 날(dDay)이 적은 것부터, 상시·모름·마감됨은 뒤(서버 「마감 빠른 순」과 같은 규칙).
 * 추천 순 = score 내림차순. 원래 배열은 건드리지 않고, 같은 값은 받은 차례를 지킨다.
 */
export function sortOneList(items: readonly FundingItem[], sort: OneListSort): FundingItem[] {
  if (sort === "deadline") return sortItems([...items], "dead");
  return [...items].sort((a, b) => b.score - a.score);
}

// ── 쪽 넘김 ─────────────────────────────────────────────────────────────
/** 전체 쪽 수 — 0건이어도 1쪽이다. */
export function pageCountOf(total: number, size: number = RESULT_PAGE_SIZE): number {
  return Math.max(1, Math.ceil(total / size));
}

/** 1부터 세는 쪽의 줄들. 쪽 번호가 범위를 넘으면 가까운 쪽으로 맞춘다. */
export function pageSlice<T>(items: readonly T[], page: number, size: number = RESULT_PAGE_SIZE): T[] {
  const p = Math.min(Math.max(1, page), pageCountOf(items.length, size));
  return items.slice((p - 1) * size, p * size);
}

// ── 줄 글자 ─────────────────────────────────────────────────────────────
export type KindTag = "공고" | "상시" | "은행 상품";

/** 종류 이름표 — 은행 갈래의 상품은 「은행 상품」, 상시 접수(상품 포함)는 「상시」, 나머지는 「공고」. */
export function kindTagOf(it: FundingItem): KindTag {
  if (it.kind === "product" && it.group === "bank") return "은행 상품";
  if (it.deadline.kind === "always" || it.kind === "product") return "상시";
  return "공고";
}

/** 출처 이름표 — 명부에 없는 값은 그대로 보인다(지어내지 않는다). */
export function sourceNameOf(it: FundingItem): string {
  return ANNOUNCEMENT_SOURCE_LABELS[it.source] ?? it.source;
}

/** 갈래 이름표 — 종류를 못 가른 줄은 갈래 이름을 쓰지 않는다(서랍과 같은 규칙). */
export function groupTagOf(it: FundingItem): { label: string; tone?: FundingGroupTone } {
  if (it.unclassified) return { label: "종류 미확인" };
  const meta = FUNDING_GROUP_META[it.group];
  return { label: meta.name, tone: meta.tone };
}

/** 날짜 마감의 D-day 글자. 날짜 마감이 아니거나 이미 지났으면 null. 7일 안(오늘 포함)이면 빨강. */
export function ddayBadgeOf(it: FundingItem): { text: string; hot: boolean } | null {
  const d = it.deadline;
  if (d.kind !== "date" || d.dDay === null || d.dDay < 0) return null;
  return { text: d.dDay === 0 ? "D-day" : `D-${d.dDay}`, hot: d.dDay <= HOT_DAYS };
}

/** 기간 글자 — 상시는 「상시」, 그 밖에는 공고 원문 기간. 원문이 없으면 종류에 맞는 말. */
export function periodTextOf(it: FundingItem): string {
  const d = it.deadline;
  if (d.kind === "always") return "상시";
  const text = d.text?.trim();
  if (text) return text;
  if (d.kind === "date" && d.date) return `${d.date} 마감`;
  if (d.kind === "closed") return "마감됨";
  if (d.kind === "budget") return "예산 소진 시 마감";
  if (d.kind === "upcoming") return "접수 예정";
  return "기간 미기재";
}

const MONEY_MAX_CHARS = 24;

/** 금액(없으면 이자) 글자의 앞부분 — 줄이 길어지지 않게 자른다. 둘 다 없으면 빈 글자. */
export function moneyHintOf(it: FundingItem): string {
  const text = it.amountText?.trim() || it.rateText?.trim() || "";
  const chars = Array.from(text);
  return chars.length > MONEY_MAX_CHARS ? `${chars.slice(0, MONEY_MAX_CHARS).join("")}…` : text;
}

/** 아랫줄 「기관 · 기간 또는 상시 · 금액/이자 앞부분」 — 빈 칸은 건너뛴다. */
export function lineTextOf(it: FundingItem): string {
  return [it.agency?.trim(), periodTextOf(it), moneyHintOf(it)].filter(Boolean).join(" · ");
}

// ── 모름 칸 안내 ────────────────────────────────────────────────────────
/**
 * 목록 위 한 줄 — 확인 필요가 1건 이상이고 프로필에 비어 있는 칸이 있을 때만.
 * 숫자는 지금 자료로 셀 수 있는 것(확인 필요 건수·모름 칸 수)만 쓴다 — 「채우면 N건이 판정돼요」 같은 숫자는 셀 근거가 없어 쓰지 않는다.
 */
export function unknownNoticeOf(opts: { unverifiedCount: number; unknownFieldCount: number | null }): string | null {
  const { unverifiedCount, unknownFieldCount } = opts;
  if (unverifiedCount < 1 || unknownFieldCount === null || unknownFieldCount < 1) return null;
  return `모르는 ${unknownFieldCount}칸 때문에 ${unverifiedCount.toLocaleString("ko-KR")}건이 「확인 필요」입니다.`;
}

// ── 상태 바뀜 ───────────────────────────────────────────────────────────
export interface OneListState {
  /** 아직 안 골랐으면 null — 그때는 기본 탭(`defaultVerdictTab`)을 쓴다. */
  tab: VerdictTab | null;
  chip: ChipKey;
  sort: OneListSort;
  /** 1부터 센다. */
  page: number;
  /** 고른 줄의 id. 비었거나 지금 목록에 없으면 목록 첫 항목을 고른 것으로 본다. */
  selectedId: string;
}

export type OneListAction =
  /** 탭을 옮긴다 — 칩은 「전체」로, 쪽은 1쪽으로. */
  | { type: "tab"; tab: VerdictTab }
  /** 처음 받은 자료로 기본 탭을 못 박는다 — 이후 찾기로 숫자가 바뀌어도 탭이 저절로 움직이지 않게. */
  | { type: "pinTab"; tab: VerdictTab }
  | { type: "chip"; chip: ChipKey }
  | { type: "sort"; sort: OneListSort }
  /** 찾기어가 바뀌었다 — 1쪽으로. */
  | { type: "query" }
  | { type: "page"; page: number }
  | { type: "select"; id: string };

export const INITIAL_ONE_LIST_STATE: OneListState = { tab: null, chip: "all", sort: "deadline", page: 1, selectedId: "" };

export function oneListReducer(state: OneListState, action: OneListAction): OneListState {
  switch (action.type) {
    case "tab":
      return { ...state, tab: action.tab, chip: "all", page: 1 };
    case "pinTab":
      return state.tab === null ? { ...state, tab: action.tab } : state;
    case "chip":
      return { ...state, chip: action.chip, page: 1 };
    case "sort":
      return { ...state, sort: action.sort, page: 1 };
    case "query":
      return state.page === 1 ? state : { ...state, page: 1 };
    case "page":
      return { ...state, page: Math.max(1, action.page) };
    case "select":
      return { ...state, selectedId: action.id };
    default:
      return state;
  }
}

// ── 화면 모델 ───────────────────────────────────────────────────────────
export interface OneListView {
  /** 지금 보이는 탭(안 골랐으면 기본 탭). */
  tab: VerdictTab;
  /** 찾기 결과 기준 탭별 건수. */
  counts: Record<VerdictTab, number>;
  chips: ChipInfo[];
  /** 지금 칩(0건 칩이 골라져 있으면 「전체」로 본다). */
  chip: ChipKey;
  /** 탭·칩·정렬을 거친 전체(쪽 자르기 전). */
  list: FundingItem[];
  /** 맞춘 쪽 번호(1부터)와 전체 쪽 수. */
  page: number;
  pageCount: number;
  pageItems: FundingItem[];
  /** 고른 줄 — 없으면 쪽의 첫 항목, 목록이 비면 null. */
  selected: FundingItem | null;
  /** 지금 탭이 0건일 때 다른 탭에 찾은 건수(0건 탭은 뺀다). */
  otherTabs: Array<{ tab: VerdictTab; label: string; count: number }>;
}

/** 받은 배열 + 상태 + 서버에 물은 찾기어 → 그릴 모양. 순수 함수. */
export function oneListViewOf(items: FundingItem[], state: OneListState, askedQuery = ""): OneListView {
  const searched = searchItems(items, askedQuery);
  const counts = verdictCountsOf(searched);
  const tab = state.tab ?? defaultVerdictTab(counts);
  const tabItems = searched.filter((it) => verdictTabOf(it) === tab);
  const chips = chipsOf(tabItems);
  const chip: ChipKey = chips.some((c) => c.key === state.chip && (c.key === "all" || c.count > 0)) ? state.chip : "all";
  const list = sortOneList(filterByChip(tabItems, chip), state.sort);
  const pageCount = pageCountOf(list.length);
  const page = Math.min(Math.max(1, state.page), pageCount);
  const pageItems = pageSlice(list, page);
  const selected = list.find((it) => it.id === state.selectedId) ?? pageItems[0] ?? null;
  const otherTabs =
    tabItems.length === 0
      ? VERDICT_TABS.filter((t) => t.key !== tab && counts[t.key] > 0).map((t) => ({
          tab: t.key, label: TAB_LABEL[t.key], count: counts[t.key],
        }))
      : [];
  return { tab, counts, chips, chip, list, page, pageCount, pageItems, selected, otherTabs };
}
