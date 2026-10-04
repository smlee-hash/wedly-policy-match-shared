// 결과 위 요약 탭·검색·정렬이 목록을 거르는 규칙 — 화면 밖에서도 잴 수 있게 순수 함수로 뗀다.
// 건수는 지도 자료(서버가 센 값)에서 그대로 읽는다 — 화면이 다시 세어 지어내지 않는다.
import { FUNDING_GROUP_META, type FundingGroup } from "../../funding/funding-group";
import {
  FUNDING_QUERY_MAX,
  isSoon,
  matchesFundingQuery,
  matchesFundingTab,
  type FundingItem,
  type FundingSort,
} from "../../funding/funding-map";
import type { FundingMapPayload } from "../FundingMap";
import { daysLeft } from "./ResultList";
import type { Diagnosis, DiagnoseItem } from "./PolicyMatchScreen";

/** 요약 탭에 올리는 묶음 — 승인 시안의 네 갈래(급할 때·투자 받기는 「전체」에서만 보인다). */
export const SUMMARY_GROUPS: readonly FundingGroup[] = ["grant", "policy", "guarantee", "bank"];

export type SummaryTab = "all" | "now" | "soon" | FundingGroup;

export interface ResultConditions {
  tab: SummaryTab;
  query: string;
}

export interface SummaryTabInfo {
  key: SummaryTab;
  label: string;
  /** 아직 자료가 없으면 null — 0 으로 지어내지 않는다. */
  count: number | null;
}

/** 정렬 칸의 선택지 — 값은 지도 통로의 줄 세우기 열쇠와 같다. */
export const SORT_CHOICES: ReadonlyArray<{ value: FundingSort; label: string }> = [
  { value: "dead", label: "마감 빠른 순" },
  { value: "amt", label: "금액 큰 순" },
  { value: "rec", label: "맞는 조건 많은 순" },
];

/**
 * 탭 일곱 개와 건수. 전체 = 갈래 건수 합 + 종류 미확인(서버 계약), 지금 신청 가능·7일 안 마감 =
 * 한눈에 칸이 센 값(칩에 따라 움직이지 않는다), 묶음 = 그 갈래 카드 딱지와 같은 수.
 */
export function summaryTabs(data: FundingMapPayload | null): SummaryTabInfo[] {
  const blockTotal = (g: FundingGroup) => data?.groups.find((b) => b.group === g)?.total ?? 0;
  return [
    {
      key: "all",
      label: "전체",
      count: data ? data.groups.reduce((n, b) => n + b.total, 0) + data.unclassified : null,
    },
    { key: "now", label: "지금 신청 가능", count: data ? data.glance.open : null },
    { key: "soon", label: "7일 안 마감", count: data ? data.glance.soon : null },
    ...SUMMARY_GROUPS.map((g) => ({
      key: g as SummaryTab,
      label: FUNDING_GROUP_META[g].name,
      count: data ? blockTotal(g) : null,
    })),
  ];
}

/**
 * 검색어 — 띄어 쓴 낱말이 모두 들어 있어야 한다. 비어 있으면 모두 통과.
 * 규칙은 서버(`groupBlocks`)와 한 벌(`matchesFundingQuery`)이라 두 곳이 갈라지지 않는다.
 */
export const matchesQuery = matchesFundingQuery;

/** 검색 입력 칸에 담아 두는 글 — 100자까지만 남긴다(공백은 그대로: 낱말 사이에 띄어 쓰는 중일 수 있다). */
export function clipQuery(query: string): string {
  return Array.from(query).slice(0, FUNDING_QUERY_MAX).join("");
}

/**
 * 검색어를 거르는 쪽(화면)과 묻는 쪽(서버 요청)이 **똑같이 쓰는 한 값** — 앞뒤 공백을 걷고 100자까지.
 * 두 곳이 따로 자르면 103자 검색어를 화면은 103자로 거르고 서버는 100자로 걸러, 서버가 보낸 100자 접두사 공고를
 * 화면이 다시 걸러 0건이 된다.
 */
export function normalizeQuery(query: string): string {
  return clipQuery(query.trim());
}

/** 지도 요청에 실을 검색 조건 — 걸린 것만 담는다(검색어는 `normalizeQuery` 한 값). */
export function fundingSearchOf(c: ResultConditions): { query?: string; tab?: SummaryTab } {
  const query = normalizeQuery(c.query);
  return { ...(query ? { query } : {}), ...(c.tab !== "all" ? { tab: c.tab } : {}) };
}

/** 검색어를 입력이 멈춘 뒤 이만큼(밀리초) 기다렸다가 서버에 다시 묻는다. */
export const FUNDING_QUERY_DELAY_MS = 300;

function isGroupTab(tab: SummaryTab): tab is FundingGroup {
  return tab !== "all" && tab !== "now" && tab !== "soon";
}

const noConditions = (c: ResultConditions) => c.tab === "all" && c.query.trim() === "";

/** 검색어나 「전체」가 아닌 탭이 걸려 있나. */
export const hasConditions = (c: ResultConditions) => !noConditions(c);

/** 넓게 다시 받을 때 서버에 요청할 건수의 상한 — 이보다 많이 달라고 하지 않는다. */
export const WIDE_TOP_N_MAX = 500;

/** 서버가 센 정상 건수 — 갈래 카드 건수의 합 + 종류 미확인(요약 탭 「전체」와 같은 셈). */
export function serverTotalOf(data: FundingMapPayload): number {
  return data.groups.reduce((n, b) => n + b.total, 0) + data.unclassified;
}

/**
 * 검색어·탭을 서버가 걸어 보낸 자료의 건수 — 갈래 건수의 합 + 종류 미확인 줄 수.
 * 자료 속 `unclassified` 는 거르기 전 전체 수라(검색에 안 맞는 줄까지 센다) 그대로 더하면 안 된다.
 * 미확인 줄은 **서버가 거른 뒤 센 수**(`unclassifiedTotal`)를 쓴다 — 실려 온 줄 수는 갈래마다 80건에서
 * 잘려 있어 그것으로 세면 잘림 안내가 사라진다. 그 칸이 없는 응답(옛 통로)만 실려 온 줄로 센다.
 */
export function filteredTotalOf(data: FundingMapPayload): number {
  return data.groups.reduce(
    (n, b) => n + b.total + (b.unclassifiedTotal ?? b.items.filter((it) => it.unclassified).length),
    0,
  );
}

/** 실려 온 줄 수 — 서버가 갈래마다 상한까지만 실어 보내므로 서버 전체 건수보다 적을 수 있다. */
export function receivedCountOf(data: FundingMapPayload): number {
  return data.groups.reduce((n, b) => n + b.items.length, 0);
}

export interface SearchCut {
  /** 실제로 거른 대상의 줄 수(받은 건수) */
  searched: number;
  /** 서버가 센 전체 건수 */
  total: number;
}

/**
 * 탭·검색어로 거르는데 받은 자료가 서버 전체보다 적으면 그 차이를 돌려준다(아니면 null).
 * 거를 조건이 없으면 처음부터 받은 만큼만 보이는 것이 정상이라 null 이다.
 */
export function searchCutOf(data: FundingMapPayload | null, c: ResultConditions): SearchCut | null {
  if (!data || noConditions(c)) return null;
  // 서버가 검색어·탭을 걸어 보내므로 서버 건수도 거른 뒤의 수다 — 거르기 전 전체(`unclassified`)를 더하지 않는다.
  const total = filteredTotalOf(data);
  const searched = receivedCountOf(data);
  return total > searched ? { searched, total } : null;
}

/**
 * 지도 자료를 한 번 더 넓게 받아야 하면 그때 요청할 건수(서버 전체 건수, 상한 WIDE_TOP_N_MAX), 아니면 null.
 * `current` 는 지금 받은 요청의 건수 — 이미 그만큼 요청했으면 더 부르지 않는다(서버가 상한으로 잘라도 되풀이하지 않게).
 */
export function widerTopN(data: FundingMapPayload | null, c: ResultConditions, current: number): number | null {
  const cut = searchCutOf(data, c);
  if (!cut) return null;
  const want = Math.min(cut.total, WIDE_TOP_N_MAX);
  return want > current ? want : null;
}

/** 넓게 받고도 잘려 있어 사람에게 알려야 할 때만 돌려준다 — 넓게 받는 중이면 아직 알리지 않는다. */
export function searchCutNoticeOf(data: FundingMapPayload | null, c: ResultConditions, current: number): SearchCut | null {
  return widerTopN(data, c, current) === null ? searchCutOf(data, c) : null;
}

/** 「앞의 80건 안에서 찾았어요 — 전체 81건」 */
export function searchCutText(cut: SearchCut): string {
  return `앞의 ${cut.searched.toLocaleString("ko-KR")}건 안에서 찾았어요 — 전체 ${cut.total.toLocaleString("ko-KR")}건`;
}

/**
 * 지도(한눈에) 자료를 탭·검색어로 거른다. 바꿀 것이 없으면 **같은 자료**를 돌려준다.
 * 묶음 탭은 그 묶음 카드만 남긴다(건수는 서버가 센 그대로). 시간 탭·검색어는 실려 온 줄만 거르므로
 * 그때는 카드 건수를 남은 줄로 다시 센다.
 */
export function filterFundingData(data: FundingMapPayload, raw: ResultConditions): FundingMapPayload {
  const c: ResultConditions = { ...raw, query: normalizeQuery(raw.query) }; // 서버에 보낸 값과 같은 검색어로 거른다
  if (noConditions(c)) return data;
  if (isGroupTab(c.tab) && c.query.trim() === "") {
    return { ...data, groups: data.groups.filter((b) => b.group === c.tab) };
  }
  const keep = (it: FundingItem) => matchesFundingTab(it, c.tab) && matchesQuery(it, c.query);
  const groups = data.groups
    .filter((b) => !isGroupTab(c.tab) || b.group === c.tab)
    .map((b) => {
      const items = b.items.filter(keep);
      const normal = items.filter((it) => !it.unclassified);
      const next: FundingMapPayload["groups"][number] = {
        ...b,
        items,
        total: normal.length,
        fit: normal.filter((it) => it.fitVerdict === "fit").length,
        unverified: normal.filter((it) => it.fitVerdict === "unverified").length,
        soon: normal.filter(isSoon).length,
        excludedItems: b.excludedItems?.filter(keep),
      };
      // 서버가 센 미확인 건수는 서버가 걸었던 조건의 수다 — 화면이 다시 거른 뒤에는 남은 줄로 다시 센다.
      delete next.unclassifiedTotal;
      return next;
    });
  return { ...data, groups };
}

export interface DiagnosisViewOptions {
  /** 「지금 신청 가능한 것만」 */
  nowOnly: boolean;
  sort: FundingSort;
}

function diagnoseOpen(it: DiagnoseItem): boolean {
  const left = daysLeft(it.applyEnd);
  return left === null || left >= 0;
}

function diagnoseSoon(it: DiagnoseItem): boolean {
  const left = daysLeft(it.applyEnd);
  return left !== null && left >= 0 && left <= 7;
}

/**
 * 진단 목록(세 등급)을 같은 조건으로 거른다. 묶음 탭은 지도 자료의 갈래(공고 번호로 찾는다)를 쓴다 —
 * 진단 줄에는 갈래가 없다. 지도 자료가 아직 없으면 묶음으로는 거르지 않는다.
 * 바꿀 것이 없으면 **같은 진단 객체**를 돌려준다(목록의 고른 등급 탭이 풀리지 않게).
 */
export function filterDiagnosis(
  d: Diagnosis | null,
  raw: ResultConditions,
  opts: DiagnosisViewOptions,
  byRefId: ReadonlyMap<string, FundingItem>,
): Diagnosis | null {
  if (!d) return d;
  const c: ResultConditions = { ...raw, query: normalizeQuery(raw.query) }; // 지도와 같은 검색어로 거른다
  const sortKept = opts.sort === "dead" || opts.sort === "amt";
  if (noConditions(c) && !opts.nowOnly && !sortKept) return d;

  const pass = (it: DiagnoseItem): boolean => {
    if ((c.tab === "now" || opts.nowOnly) && !diagnoseOpen(it)) return false;
    if (c.tab === "soon" && !diagnoseSoon(it)) return false;
    if (isGroupTab(c.tab) && byRefId.size > 0 && byRefId.get(it.announcementId)?.group !== c.tab) return false;
    return matchesQuery(it, c.query);
  };
  const rank = (it: DiagnoseItem): number => {
    if (opts.sort === "dead") {
      const left = daysLeft(it.applyEnd);
      return left === null || left < 0 ? Number.MAX_SAFE_INTEGER : left;
    }
    if (opts.sort === "amt") return -(byRefId.get(it.announcementId)?.amountMaxWon ?? -1);
    return 0;
  };
  const arrange = (list: DiagnoseItem[]) => {
    const kept = list.filter(pass);
    return sortKept ? [...kept].sort((a, b) => rank(a) - rank(b)) : kept;
  };
  return { ...d, possible: arrange(d.possible), uncertain: arrange(d.uncertain), impossible: arrange(d.impossible) };
}

/** 「확인 필요 M건」의 M — 지도 자료의 갈래별 확인 필요 합, 아직 없으면 진단의 애매함 건수, 둘 다 없으면 모른다. */
export function reviewCountOf(data: FundingMapPayload | null, diagnosis: Diagnosis | null): number | undefined {
  if (data) return data.groups.reduce((n, b) => n + b.unverified, 0);
  if (diagnosis) return diagnosis.uncertain.length;
  return undefined;
}
