// 결과 위 요약 탭·검색·정렬이 목록을 거르는 규칙 — 화면 밖에서도 잴 수 있게 순수 함수로 뗀다.
// 건수는 지도 자료(서버가 센 값)에서 그대로 읽는다 — 화면이 다시 세어 지어내지 않는다.
import { FUNDING_GROUP_META, type FundingGroup } from "../../funding/funding-group";
import { isOpen, isSoon, type FundingItem, type FundingSort } from "../../funding/funding-map";
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

/** 검색어 — 띄어 쓴 낱말이 모두 들어 있어야 한다. 비어 있으면 모두 통과. */
export function matchesQuery(
  it: { title: string; agency?: string; targetText?: string; category?: string },
  query: string,
): boolean {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const hay = [it.title, it.agency, it.targetText, it.category].filter(Boolean).join(" ").toLowerCase();
  return terms.every((t) => hay.includes(t));
}

function isGroupTab(tab: SummaryTab): tab is FundingGroup {
  return tab !== "all" && tab !== "now" && tab !== "soon";
}

const noConditions = (c: ResultConditions) => c.tab === "all" && c.query.trim() === "";

/**
 * 지도(한눈에) 자료를 탭·검색어로 거른다. 바꿀 것이 없으면 **같은 자료**를 돌려준다.
 * 묶음 탭은 그 묶음 카드만 남긴다(건수는 서버가 센 그대로). 시간 탭·검색어는 실려 온 줄만 거르므로
 * 그때는 카드 건수를 남은 줄로 다시 센다.
 */
export function filterFundingData(data: FundingMapPayload, c: ResultConditions): FundingMapPayload {
  if (noConditions(c)) return data;
  if (isGroupTab(c.tab) && c.query.trim() === "") {
    return { ...data, groups: data.groups.filter((b) => b.group === c.tab) };
  }
  const keep = (it: FundingItem) =>
    (c.tab === "now" ? isOpen(it) : c.tab === "soon" ? isSoon(it) : true) && matchesQuery(it, c.query);
  const groups = data.groups
    .filter((b) => !isGroupTab(c.tab) || b.group === c.tab)
    .map((b) => {
      const items = b.items.filter(keep);
      const normal = items.filter((it) => !it.unclassified);
      return {
        ...b,
        items,
        total: normal.length,
        fit: normal.filter((it) => it.fitVerdict === "fit").length,
        unverified: normal.filter((it) => it.fitVerdict === "unverified").length,
        soon: normal.filter(isSoon).length,
        excludedItems: b.excludedItems?.filter(keep),
      };
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
  c: ResultConditions,
  opts: DiagnosisViewOptions,
  byRefId: ReadonlyMap<string, FundingItem>,
): Diagnosis | null {
  if (!d) return d;
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
