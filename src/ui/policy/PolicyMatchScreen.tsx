"use client";

// 지원정책 매칭 — 상태 관리와 배치만 맡는다(그리는 일은 조각들이 나눠 한다).
// 화면의 주인공은 「사업자 정보 입력 → 매칭」이다(2026-08-22 사장님 결정 2번).
// 두 단계다(2026-10-05 사장님 승인) — ① 회사 정보 → ② 매칭 결과. 회사 없이 전체 공고를 둘러보는 판은 없다.
//  · ① 회사 정보 — 본문 가운데 넓은 폼(ProfileForm layout="wide"). 「매칭 결과 보기 →」가 진단을 돌린다.
//  · ② 매칭 결과 — 진단이 성공해야만 열린다. 위에 회사 요약 줄, 아래에 요약 탭·「모름 → 확인 필요」 띠·도구 줄과
//    「한눈에」(전폭 자금 조달 지도 + 서랍) / 「목록」(묶음별 접기·펴기)이다(결과 본문은 다음 묶음에서 바뀐다).
// 단계는 주소의 `?step=result` 에, 입력한 회사 정보는 sessionStorage 에만 둔다(step-state.ts) —
// 결과 단계에서 새로 고침하면 저장해 둔 값으로 진단을 다시 돌리고, 값이 없거나 깨졌으면 ① 로 돌아간다.
// 폼은 단계를 오가도 **계속 그려 두고** 숨기기만 한다 — 「회사 정보 고치기」로 돌아와도 입력값이 남는다.
// 목록의 행을 누르면 오른쪽 서랍(820px 이하는 아래에서 올라오는 창)에 공고 상세(DetailPanel)가 열린다 —
// 정밀 판정·돌파구·피드백·강사 문의가 전부 그 안에 그대로 있다. 닫기·Esc·바깥 누르기로 닫는다.
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
// 거르개(칩)·펼침을 한 자리에서 옮기는 규칙 — 상세창 레일(FundingRecommendPanel)과 **같은 함수**를
// 쓴다. 이 규칙을 여기 다시 적으면 두 화면이 갈라진다(레일에서 이미 겪은 결함).
import { nextFundingState } from "../FundingRecommendPanel";
import type { BusinessProfile } from "../../engine/match-engine";
import type { FundingFilters, FundingItem, FundingSort } from "../../funding/funding-map";
import type { FundingGroup } from "../../funding/funding-group";
import ProfileForm, { type ProfileFormStatus } from "./ProfileForm";
import ResultGroupList, { SearchCutNotice } from "./ResultGroupList";
import { CompanySummaryBar, StepBar } from "./StepHeader";
import {
  bootPlanOf, clearStoredProfile, searchWithStep, sessionStorageOrNull, stepOfSearch, writeStoredProfile,
  readStoredProfile, type Step,
} from "./step-state";
import ResultDrawer from "./ResultDrawer";
import ResultSummaryBar from "./ResultSummaryBar";
import {
  FUNDING_QUERY_DELAY_MS, WIDE_TOP_N_MAX, clipQuery, filterFundingData, fundingSearchOf, reviewCountOf,
  searchCutOf,
  type SummaryTab,
} from "./result-conditions";
import DetailPanel from "./DetailPanel";
import SourceDirectoryPanel from "./SourceDirectoryPanel";
import FundingMap, { type FundingMapPayload } from "../FundingMap";
import FundingDrawer from "../FundingDrawer";
import type {
  PolicyMatchEndpoints, PolicyMatchFeatures, PolicyMatchSlots, VerdictFeedbackContext,
} from "./endpoints";
import { SCREEN_PROFILE_SOURCE } from "./endpoints";

/** 전체 공고 목록 한 줄 — announcements 통로 응답 그대로. 이 화면은 더 부르지 않는다(`ResultList` 를 따로 쓰는 쪽을 위해 남긴다). */
export interface Row {
  id: string;
  source: string;
  title: string;
  agency: string;
  category: string;
  region: string;
  summary: string;
  targetText: string;
  applyStart: string | null;
  applyEnd: string | null;
  applyPeriodText: string;
  url: string;
  status: string;
  dedupKey: string;
  firstSeenAt: string;
  /** 같은 공고 묶음 크기(서버 묶음). 없으면 1로 취급. */
  groupCount?: number;
  /** 묶음 구성원 id(정렬순, 최대 50). 숨은 행이 선택된 상태의 대표 강조에 쓴다. */
  groupIds?: string[];
}

export type GradeKey = "possible" | "uncertain" | "impossible";

/** 진단 결과 한 줄 — diagnose 통로 응답 그대로. */
export interface DiagnoseItem {
  announcementId: string;
  title: string;
  agency: string;
  category: string;
  applyEnd: string | null;
  applyPeriodText: string;
  grade: GradeKey;
  needsReview: boolean;
  /** 아직 AI 로 안 읽음. 읽었는데 애매함(needsReview)과 화면에서 가른다. */
  unanalyzed?: boolean;
  /** AI 없이 규칙(글자 패턴)만으로 판정했다 — 공짜지만 AI 만큼 촘촘하지 않다. */
  ruleOnly?: boolean;
  failSummary: string;
  checks: { total: number; pass: number; fail: number; unknown: number; humanCheck: number };
}

export interface StructureProgress {
  total: number;
  done: number;
  pending: number;
  needsReview: number;
  failed: number;
}

export interface Diagnosis {
  possible: DiagnoseItem[];
  uncertain: DiagnoseItem[];
  impossible: DiagnoseItem[];
  structureProgress: StructureProgress;
  analyzedCount?: number;
  candidateCount?: number;
  /** 사전필터가 소재지 불일치로 뺀 수 — 「왜 그 공고가 안 보이냐」에 답할 숫자. */
  droppedByRegion?: number;
}

/**
 * 목록 판 이름. 이 화면은 이제 「진단」 판(diagnosed)만 쓴다 — 전체 공고 탐색(browse)은 두 단계 개편에서 없어졌다.
 * 타입은 `ResultList`·`DetailPanel` 이 쓰고 있어 그대로 남긴다.
 */
export type ListMode = "browse" | "diagnosed";

/** 진단 결과를 보는 두 판 — 「지도」(전폭 자금 조달 지도)와 「목록·상세」(기존 두 컬럼). */
export type DiagnosedView = "map" | "list";

/** 주소 한 칸을 바꾼다 — 다른 쿼리·해시는 그대로 두고 `step` 만 만진다. 창이 없는 곳(서버 그리기·시험)은 아무것도 안 한다. */
function writeStepToAddress(step: Step, how: "push" | "replace"): void {
  if (typeof window === "undefined") return;
  const { pathname, search, hash } = window.location;
  const url = `${pathname}${searchWithStep(search, step)}${hash}`;
  // 앞 상태(window.history.state)를 그대로 넘긴다 — 틀(Next 라우터)이 거기에 표식을 달아 두기 때문이다.
  if (how === "push") window.history.pushState(window.history.state, "", url);
  else window.history.replaceState(window.history.state, "", url);
}

// ── 자금 조달 지도 배선 ────────────────────────────────────────────────
// 거르기(칩)·줄 세우기(정렬)·상위 N 은 **서버가** 한다(리뷰 대장 #11) — 화면이 다시 거르면
// 「한눈에 4칸」(전체 기준)과 지도·표(상위 N)의 숫자가 어긋난다. 그래서 칩·정렬은 여기(부모)가 쥐고,
// 바뀔 때마다 통로를 다시 부른다.

/**
 * 갈래 한 칸에 처음 받아 올 건수 — 통로가 1~80 으로 죈다(`funding-map` GROUP_TOP_N).
 * 검색어·탭은 서버가 이 건수로 자르기 **전에** 거른다(요청의 `query`·`tab`) — 그래서 80건 밖의 공고도 찾아진다.
 * 거른 결과가 그래도 상한을 넘으면 목록 위 안내(`SearchCutNotice`)가 잘렸다고 알린다.
 */
export const FUNDING_TOP_N = 80;

const NO_FUNDING_FILTERS: FundingFilters = { openOnly: false, soonOnly: false, includeExcluded: false };
const FUNDING_FAIL = "자금 조달 지도를 불러오지 못했습니다";

/**
 * 갈래 하나만 뒤집는다 — 「안 맞아서 뺀 항목 보기」 집합(showExcluded) 손잡이를 순수 함수로 뗀다
 * (계약 §G2 — 화면 밖에서도 잴 수 있게 `nextFilters`·`toggleGroupSet` 같은 자리에 둔다).
 */
export function toggleGroupSet(set: ReadonlySet<FundingGroup>, group: FundingGroup): Set<FundingGroup> {
  const next = new Set(set);
  if (next.has(group)) next.delete(group);
  else next.add(group);
  return next;
}

/**
 * 진단 결과를 **공고 번호로 찾을 표** — 지도 카드는 공고 번호(`refId`)만 아는데, 판정 피드백은
 * 그 공고의 규칙 판정(등급·검사 수)을 함께 실어야 한다(`VerdictFeedbackContext.item`).
 * 세 등급을 한 표로 합친다 — 어느 묶음에 있든 같은 공고면 같은 줄이다.
 */
export function diagnoseIndex(d: Diagnosis | null): Map<string, DiagnoseItem> {
  const byId = new Map<string, DiagnoseItem>();
  if (!d) return byId;
  for (const it of [...d.possible, ...d.uncertain, ...d.impossible]) byId.set(it.announcementId, it);
  return byId;
}

/**
 * 지도 카드 한 장의 판정 피드백 자료 — 순수 함수라 그리지 않고도 잰다.
 *
 * ★`item` 이 없으면 **null 로 넘긴다**(지어내지 않는다). 지도는 진단 결과와 **다른 통로**
 *  (`funding-map`)에서 오고 그쪽이 상품·상시 줄까지 함께 실으므로, 지도에 있는 공고가 진단
 *  묶음엔 없을 수 있다(진단은 상위 후보만 판정한다). 그때도 「맞음·틀림·애매」는 눌릴 수 있어야
 *  하니 단추를 숨기지 않고, 규칙 판정 칸만 비운다.
 * ★`aiVerdict` 는 언제나 null 이다 — AI 판정은 상세를 열어야 도는 일이고, 지도 카드는 그 값을
 *  가진 적이 없다(목록 카드도 같은 이유로 null 을 넘긴다 · `ResultList`).
 * ★`place:"map"` — 랩이 「어느 자리에서 눌렀나」로 자리별 통수를 가른다.
 */
export function mapVerdictContext(
  item: FundingItem,
  opts: { byId: ReadonlyMap<string, DiagnoseItem>; profile: BusinessProfile | null },
): VerdictFeedbackContext {
  return {
    announcementId: item.refId,
    title: item.title,
    item: opts.byId.get(item.refId) ?? null,
    aiVerdict: null,
    profile: opts.profile,
    place: "map",
  };
}

/** 목록 행 한 줄의 판정 피드백 자료 — 지도 카드와 같되 자리만 `"card"`(예전 목록 카드와 같은 통수에 센다). */
export function listVerdictContext(
  item: FundingItem,
  opts: { byId: ReadonlyMap<string, DiagnoseItem>; profile: BusinessProfile | null },
): VerdictFeedbackContext {
  return { ...mapVerdictContext(item, opts), place: "card" };
}

export interface FundingRequest {
  profile: BusinessProfile;
  filters: FundingFilters;
  sort: FundingSort;
  /** 갈래 한 칸에 받을 건수. 없으면 `FUNDING_TOP_N`(서버 상한은 80). */
  topN?: number;
  /**
   * 검색어(100자까지) — 서버가 갈래마다 앞쪽 N건으로 자르기 **전에** 이 글로 거른다. 비어 있으면 싣지 않는다.
   * 81번째 공고도 이 글로는 찾아진다.
   */
  query?: string;
  /** 요약 탭 — 「전체」가 아닐 때만 싣는다. 서버도 같은 규칙(`matchesFundingTab`)으로 거른다. */
  tab?: SummaryTab;
}

export type FundingOutcome = { ok: true; data: FundingMapPayload } | { ok: false; message: string };

/** 통로 계약: `POST {endpoints.fundingMap} { profile, filters, sort, topN, query?, tab? }`. */
export async function postFundingMap(req: FundingRequest, url: string): Promise<FundingOutcome> {
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        profile: req.profile,
        profileSource: SCREEN_PROFILE_SOURCE,
        filters: req.filters,
        sort: req.sort,
        topN: Math.min(Math.max(Math.floor(req.topN ?? FUNDING_TOP_N) || FUNDING_TOP_N, 1), WIDE_TOP_N_MAX),
        // 선택 칸 — 걸린 것만 싣는다(옛 통로는 모르는 칸을 무시한다).
        ...fundingSearchOf({ tab: req.tab ?? "all", query: req.query ?? "" }),
      }),
    });
    // 502 처럼 몸통이 웹문서면 여기서 터진다 — 아래 catch 가 사람 말 안내로 바꾼다.
    const j = (await r.json()) as { success?: boolean; data?: FundingMapPayload; error?: { message?: string } };
    if (j?.success && j.data) return { ok: true, data: j.data };
    const message = typeof j?.error?.message === "string" && j.error.message ? j.error.message : FUNDING_FAIL;
    return { ok: false, message };
  } catch {
    return { ok: false, message: `${FUNDING_FAIL} — 잠시 뒤 다시 시도해 주세요` };
  }
}

export interface FundingSink {
  setLoading: (v: boolean) => void;
  setData: (d: FundingMapPayload) => void;
  setError: (m: string) => void;
}

/**
 * 지도 자료 심부름꾼 — **마지막에 시작한 요청의 답만** 쓴다.
 * 칩을 켠 뒤 곧바로 정렬을 바꾸면 첫 요청의 답이 뒤늦게 도착할 수 있는데(응답 순서 역전),
 * 그걸 그대로 받으면 화면이 방금 고른 차례를 버리고 옛 답으로 되돌아간다.
 * 자료는 답이 올 때까지 **지우지 않는다** — 칩 하나 눌렀다고 화면이 비지 않게(FundingMap 이 흐리게 그린다).
 */
export function createFundingLoader(
  sink: FundingSink,
  /** 주소가 앱마다 달라 기본값을 두지 않는다 — 부르는 쪽이 `endpoints.fundingMap` 을 묶어 넘긴다. */
  post: (req: FundingRequest) => Promise<FundingOutcome>,
): (req: FundingRequest) => Promise<void> {
  let seq = 0;
  return async (req: FundingRequest) => {
    const mine = ++seq;
    sink.setLoading(true);
    sink.setError(""); // 앞선 실패 문구를 먼저 지운다 — 안 지우면 「다시 시도」가 먹통으로 보인다
    const out = await post(req);
    if (mine !== seq) return; // 늦게 온 앞선 요청 — 버린다
    if (out.ok) sink.setData(out.data);
    else sink.setError(out.message);
    sink.setLoading(false);
  };
}

/** 전폭 지도를 그릴 때 — 진단 모드에서 「지도」를 고른 때뿐이다(탐색은 언제나 기존 두 컬럼). */
export function showsMap(mode: ListMode, view: DiagnosedView): boolean {
  return mode === "diagnosed" && view === "map";
}

export interface MapUiState {
  view: DiagnosedView;
  /** 서랍에 펼친 항목. 서랍은 **지도의 것**이라 목록·상세로 건너가면 닫는다. */
  openItem: FundingItem | null;
}

export type MapUiAction =
  | { type: "open"; item: FundingItem }
  | { type: "close" }
  /** 서랍의 「상세·AI 판정 열기」 — 공고 고르기(selectedId)는 부모가 함께 한다. */
  | { type: "detail" }
  | { type: "view"; view: DiagnosedView }
  /** 진단을 새로 돌렸다 — 지도부터 보여 준다. */
  | { type: "diagnosed" };

const INITIAL_MAP_UI: MapUiState = { view: "map", openItem: null };

/** 지도 판·서랍의 상태 변화 규칙. 순수 함수라 브라우저 없이도 잴 수 있다(`funding-wiring.test.ts`). */
export function mapUiReducer(state: MapUiState, action: MapUiAction): MapUiState {
  switch (action.type) {
    case "open":
      return { ...state, openItem: action.item };
    case "close":
      // 바뀔 것이 없으면 있던 것을 그대로 돌려준다 — 뜻 없는 다시 그리기를 만들지 않는다.
      return state.openItem === null ? state : { ...state, openItem: null };
    case "detail":
      return { view: "list", openItem: null };
    case "view":
      // 지도로 돌아올 때 열려 있던 서랍을 되살리지 않는다 — 판을 갈아타면 서랍은 늘 닫힌 채로 시작한다.
      return state.view === action.view && state.openItem === null ? state : { view: action.view, openItem: null };
    case "diagnosed":
      return INITIAL_MAP_UI;
    default:
      return state;
  }
}

/**
 * 자금 조달 지도의 거르개(칩)·펼침(`showExcluded`)을 **한 자리에서** 쥔다 — 밖으로는 손잡이만
 * 돌려준다(상세창 레일 `FundingRecommendPanel` 의 `useFundingFilterState` 와 같은 결).
 *
 * ★왜 훅으로 감쌌나(2026-09-04 브라우저 독립 검사가 잡은 결함):
 *  예전엔 이 두 `useState` 가 부품 몸통에 있어서 JSX 자리에 `onFiltersChange={setFundingFilters}`
 *  처럼 **날 것 설정 함수를 그대로 넘길 수 있었다.** 그래서 「카드 보기에서 한 갈래 펼침 → 표로
 *  보기 → 「안 맞는 공고도 보기」 끄기 → 카드로 복귀」 하면 `showExcluded` 엔 그 갈래가 남았는데
 *  `includeExcluded` 는 꺼져 서버가 `excludedItems` 를 안 싣는다 — 갈래 단추가 「뺀 것 접기」인데
 *  아래가 텅 빈다. 이 저장소엔 브라우저 흉내 도구가 없어(jsdom 없음) 「부품이 어떤 손잡이를
 *  넘겼나」를 시험으로 잴 수 없으므로, 못 재는 것을 **아예 쓸 수 없게** 만들었다:
 *   · `setFundingFilters`·`setShowExcluded` 는 이 훅 안에만 있다 — 아래 부품 범위에 그 이름이
 *     없으니 옛 배선으로 되돌리면 타입 검사가 `TS2304: Cannot find name` 으로 막는다.
 *   · 칩·표 손잡이가 거르개를 바꾸는 길은 `onFiltersChange` **하나뿐**이고, 그 길은 반드시
 *     `nextFundingState` 를 지난다.
 *
 * 규칙은 옮기기 전과 한 글자도 같다 — 갈래 단추(`onToggleExcluded`)·회사 갈아타기
 * (`resetForCompany`)의 몸통도, 「바꿀 것이 없으면 같은 값을 돌려준다」는 성질도 그대로다.
 */
function useFundingFilterState(): {
  filters: FundingFilters;
  showExcluded: ReadonlySet<FundingGroup>;
  /** 칩·표 손잡이가 거르개를 바꿀 때 — 거르개를 바꾸는 **유일한** 길. */
  onFiltersChange: (next: FundingFilters) => void;
  /** 갈래 카드의 「안 맞아서 뺀 N건 보기」. */
  onToggleExcluded: (group: FundingGroup) => void;
  /** 진단을 새로 돌려 회사가 바뀔 때 펼침을 접고 재조회 스위치를 끈다. 늘 같은 함수다. */
  resetForCompany: () => void;
} {
  const [fundingFilters, setFundingFilters] = useState<FundingFilters>(NO_FUNDING_FILTERS);
  // 갈래별 「안 맞아서 뺀 항목 보기」 — 비어 있지 않으면 fundingFilters.includeExcluded 를 함께 켠다
  // (계약 §G2). 이 값 자체가 네트워크 재조회를 부르므로(fundingFilters 변화로) FundingMap 안의
  // `expanded`(순수 UI, 재조회 없음)와 달리 부모가 쥔다.
  const [showExcluded, setShowExcluded] = useState<ReadonlySet<FundingGroup>>(() => new Set<FundingGroup>());

  /**
   * 칩·표 손잡이가 거르개를 바꿀 때 — 펼침까지 **한 자리에서** 옮긴다(`nextFundingState`).
   * 지금 렌더의 값을 그대로 읽는다 — 손잡이가 `next` 를 만들 때 본 거르개가 바로 이 렌더의
   * 것이라(FundingMap 은 `filters` prop 으로 만든다) 어긋날 자리가 없다.
   */
  const onFiltersChange = (next: FundingFilters) => {
    const s = nextFundingState(fundingFilters, showExcluded, next);
    setFundingFilters(s.filters);
    setShowExcluded(s.showExcluded);
  };

  /**
   * 갈래 카드의 「안 맞아서 뺀 N건 보기」 — 집합이 비어 있지 않아지면 `fundingFilters.includeExcluded`
   * 도 함께 켠다(계약 §G2: 하나라도 펼쳐 있으면 서버에 안 맞음까지 달라고 다시 물어야 한다).
   * 다시 전부 접으면(집합이 다시 비면) 꺼서 원래대로(안 맞음은 다시 서버에서부터 빠진다).
   */
  const onToggleExcluded = useCallback((group: FundingGroup) => {
    setShowExcluded((prev) => {
      const next = toggleGroupSet(prev, group);
      const wantIncludeExcluded = next.size > 0;
      setFundingFilters((f) => (f.includeExcluded === wantIncludeExcluded ? f : { ...f, includeExcluded: wantIncludeExcluded }));
      return next;
    });
  }, []);

  // 이전 회사에서 펼쳐 뒀던 「안 맞아서 뺀 항목」은 새 회차로 넘어가지 않는다 — 갈래는 같아도
  // 뜻은 회사마다 다르다(새 회차는 fundingFilters.includeExcluded 도 함께 꺼야 한다).
  // 설정 함수만 쓰므로 늘 같은 함수로 둔다(runDiagnose 의 의존 배열에 넣어도 헛돌지 않는다).
  const resetForCompany = useCallback(() => {
    setShowExcluded(new Set<FundingGroup>());
    setFundingFilters((f) => (f.includeExcluded ? { ...f, includeExcluded: false } : f));
  }, []);

  return { filters: fundingFilters, showExcluded, onFiltersChange, onToggleExcluded, resetForCompany };
}

export interface PolicyMatchScreenProps {
  /** 부를 통로 주소 묶음. 없는 주소의 단추·칸은 그리지 않는다. */
  endpoints: PolicyMatchEndpoints;
  /** 앱만 아는 조각을 끼워 넣는 자리(랩의 판정 피드백·수집원 신고). */
  slots?: PolicyMatchSlots;
  /** 앱이 대신 해 주는 일(엑셀 저장·오류 문구 읽기·여백). */
  features?: PolicyMatchFeatures;
}

export default function PolicyMatchScreen({ endpoints, slots, features }: PolicyMatchScreenProps) {
  // ── 단계 상태 — 첫 진입은 늘 ① 회사 정보다(주소·저장값 읽기는 아래 첫 그림 뒤 효과가 한다) ──
  const [step, setStep] = useState<Step>("company");
  const [notice, setNotice] = useState("");
  // 새로 고침 뒤 복원할 회사 정보 — 넓은 폼이 처음 한 번 칸에 채운다. 「다른 회사」는 폼을 새로 만든다(formKey).
  const [restoredProfile, setRestoredProfile] = useState<BusinessProfile | null>(null);
  const [formKey, setFormKey] = useState(0);

  // ── 진단(2단계) 상태 ─────────────────────────────────────────────────
  const [profile, setProfile] = useState<BusinessProfile>({});
  // 진단 회차. 진단을 다시 돌릴 때마다 올라간다 — 상세의 AI 판정이 앞 회차 값을 물고 있지 않게 한다.
  const [profileNonce, setProfileNonce] = useState(0);
  const [diagnosis, setDiagnosis] = useState<Diagnosis | null>(null);
  const [diagnosing, setDiagnosing] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  // 상세 서랍이 열려 있나 — 진단 목록·지도에서 공고를 눌렀을 때만 참이 된다.
  const [drawerOpen, setDrawerOpen] = useState(false);

  // ── 자금 조달 지도(3단계) 상태 ────────────────────────────────────────
  const [fundingData, setFundingData] = useState<FundingMapPayload | null>(null);
  const [fundingLoading, setFundingLoading] = useState(false);
  const [fundingError, setFundingError] = useState("");
  const [fundingSort, setFundingSort] = useState<FundingSort>("rec");
  // 검색어·탭을 **걸지 않고** 받은 마지막 자료 — 요약 탭의 건수·「확인 필요 M건」은 이 자료로 센다.
  // 서버가 검색어·탭으로 거른 자료는 건수도 거른 뒤의 수라 그대로 쓰면 다른 탭 건수가 0 으로 줄어든다.
  const [countData, setCountData] = useState<FundingMapPayload | null>(null);
  const requestedSearched = useRef(false); // 지금 들고 있는 자료를 받은 요청에 검색어·탭이 실렸나
  // 거르개·펼침은 짝이라 한 자리에서 쥔다 — 날 것 설정 함수는 이 범위에 없다(위 훅 주석 참고).
  const {
    filters: fundingFilters,
    showExcluded,
    onFiltersChange: changeFundingFilters,
    onToggleExcluded: toggleExcluded,
    resetForCompany: resetFundingForCompany,
  } = useFundingFilterState();
  const [mapUi, dispatchMapUi] = useReducer(mapUiReducer, INITIAL_MAP_UI);
  // 심부름꾼은 한 번만 만든다(useState 의 늦은 초기화). setState 손잡이는 늘 같은 것이라 다시 만들 이유가 없고,
  // 요청 차례(seq)를 그 안에 담고 있어 다시 만들면 「마지막 요청만 이긴다」가 풀린다.
  const [loadFunding] = useState(() =>
    createFundingLoader(
      {
        setLoading: setFundingLoading,
        // 답이 온 요청은 마지막에 시작한 요청뿐이라, 마지막에 시작한 요청이 이 자료를 받은 요청이다.
        setData: (d) => {
          setFundingData(d);
          if (!requestedSearched.current) setCountData(d);
        },
        setError: setFundingError,
      },
      (req) => {
        requestedSearched.current = Object.keys(fundingSearchOf({ tab: req.tab ?? "all", query: req.query ?? "" })).length > 0;
        return postFundingMap(req, endpoints.fundingMap);
      },
    ),
  );

  // ── 결과 위 요약 탭·검색·「지금 신청 가능」 — 목록과 한눈에(지도) 둘 다 같은 조건으로 거른다.
  // 정렬은 지도 통로의 줄 세우기(fundingSort)와 한 값이다 — 두 곳에서 따로 쥐면 어긋난다.
  const [resultTab, setResultTab] = useState<SummaryTab>("all");
  const [resultQuery, setResultQuery] = useState("");
  // 서버에 다시 묻는 검색어 — 입력이 멈춘 뒤 300ms 에 따라간다(글자마다 요청하지 않는다). 탭은 바로 따라간다.
  const [askedQuery, setAskedQuery] = useState("");
  useEffect(() => {
    if (resultQuery === askedQuery) return;
    const timer = setTimeout(() => setAskedQuery(resultQuery), FUNDING_QUERY_DELAY_MS);
    return () => clearTimeout(timer);
  }, [resultQuery, askedQuery]);
  const askedSearch = useMemo(() => fundingSearchOf({ tab: resultTab, query: askedQuery }), [resultTab, askedQuery]);
  // 왼쪽 폼이 알려 주는 칸 현황 → 「모름 N칸 → 확인 필요 M건」 띠. 「채우기」는 번호를 올려 폼에 알린다.
  const [formStatus, setFormStatus] = useState<ProfileFormStatus | null>(null);
  const [fillNonce, setFillNonce] = useState(0);

  // 진단이 끝났거나(회차가 오르거나) 칩·정렬·검색어·탭이 바뀌면 지도를 서버에서 다시 받는다.
  // 검색어·탭도 서버에 실어 보낸다 — 서버가 앞쪽 N건으로 자르기 전에 거르므로 N건 밖의 공고도 찾아진다.
  useEffect(() => {
    if (profileNonce === 0) return; // 아직 진단 전 — 부를 것이 없다
    void loadFunding({ profile, filters: fundingFilters, sort: fundingSort, ...askedSearch });
  }, [loadFunding, profileNonce, profile, fundingFilters, fundingSort, askedSearch]);
  // 새 진단이면 앞 진단에서 센 요약 탭 건수는 버린다(새 자료가 오기 전까지는 받은 자료로 센다).
  useEffect(() => {
    setCountData(null);
  }, [profileNonce]);

  /**
   * 매칭 진단 — **성공해야만** 결과 단계를 연다(첫 공고를 열어 두고, 주소에 step=result 를 올리고, 회사 정보를
   * sessionStorage 에 둔다). 실패하면 단계는 그대로다. 성공 여부를 입력 카드에 알린다.
   * 주소가 이미 결과 단계이면(새로 고침 복원·앞으로 가기) 주소는 다시 쌓지 않는다.
   */
  const runDiagnose = useCallback(async (p: BusinessProfile): Promise<boolean> => {
    setDiagnosing(true);
    setNotice("");
    try {
      const j = await fetch(endpoints.diagnose, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile: p, profileSource: SCREEN_PROFILE_SOURCE }),
      }).then((r) => r.json());
      if (!j?.success) {
        setNotice(j?.error?.message ?? "진단에 실패했습니다");
        return false;
      }
      const data = j.data as Diagnosis;
      setProfile(p);
      setProfileNonce((n) => n + 1); // 이 회차 이후로는 앞 회차의 AI 판정을 쓰지 않는다
      setDiagnosis(data);
      setStep("result");
      writeStoredProfile(sessionStorageOrNull(), p);
      if (typeof window !== "undefined" && stepOfSearch(window.location.search) !== "result") {
        writeStepToAddress("result", "push"); // 뒤로 가기로 ① 로 돌아올 수 있게 한 칸 쌓는다
      }
      const first = data.possible[0] ?? data.uncertain[0] ?? data.impossible[0];
      setSelectedId(first?.announcementId ?? "");
      setDrawerOpen(false); // 새 회차는 서랍을 닫은 채 시작한다 — 앞 회사의 상세를 덮어 두지 않는다
      // 지도는 새 회차 것부터 — 다른 회사의 지도를 흐리게 남겨 두지 않는다(자료를 비우면 뼈대가 뜬다).
      setFundingData(null);
      setFundingError("");
      // 이전 회사에서 펼쳐 뒀던 「안 맞아서 뺀 항목」도 새 회차로 넘어가지 않는다(훅의 같은 규칙).
      resetFundingForCompany();
      // 요약 탭 건수는 탭·검색어 없이 받은 전체 응답에서 센다 — 탭·검색어가 걸린 채 다시 진단하면 그 응답이
      // 오지 않아 건수가 걸러진 수로 줄어든다. 새 회차는 「전체」·빈 검색어에서 시작한다.
      setResultTab("all");
      setResultQuery("");
      setAskedQuery("");
      dispatchMapUi({ type: "diagnosed" });
      return true;
    } catch {
      setNotice("진단에 실패했습니다 — 잠시 뒤 다시 시도하세요");
      return false;
    } finally {
      setDiagnosing(false);
    }
  }, [endpoints.diagnose, resetFundingForCompany]);

  /** 지도 서랍의 「상세·AI 판정 열기」 — 목록 판으로 건너가며 그 공고의 상세 서랍을 연다(지도 서랍은 닫힌다). */
  const openDetailFromMap = useCallback((announcementId: string) => {
    dispatchMapUi({ type: "detail" });
    setSelectedId(announcementId);
    setDrawerOpen(true);
  }, []);

  /** 목록의 행 — 공고는 상세 서랍, 상시 상품은 상세 통로가 없어 지도의 항목 서랍을 그대로 쓴다. */
  const openRow = useCallback((item: FundingItem) => {
    if (item.kind === "announcement") {
      setSelectedId(item.refId);
      setDrawerOpen(true);
    } else {
      dispatchMapUi({ type: "open", item });
    }
  }, []);

  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  /**
   * 「← 회사 정보 고치기」 — ① 로 돌아간다. 입력값(폼은 계속 그려 둔다)도 받아 둔 결과도 그대로 둔다.
   * 다시 「매칭 결과 보기」를 누르면 그때 새로 진단한다. 서랍은 덮어 둔 채 넘어가지 않는다.
   */
  const goCompany = useCallback(() => {
    setStep("company");
    setDrawerOpen(false);
    dispatchMapUi({ type: "close" });
    writeStepToAddress("company", "replace");
  }, []);

  /** 저장해 둔 값으로 결과를 다시 만든다(새로 고침 복원·앞으로 가기). 실패하면 ① 로 돌아가고 주소에서 step 을 뗀다. */
  const rediagnose = useCallback((p: BusinessProfile) => {
    setStep("result");
    void runDiagnose(p).then((ok) => {
      if (ok) return;
      setStep("company");
      writeStepToAddress("company", "replace");
    });
  }, [runDiagnose]);

  /** 「다른 회사」 — 입력값·저장값·결과를 모두 비우고 ① 로. 폼은 새로 만든다(formKey). */
  const resetCompany = useCallback(() => {
    clearStoredProfile(sessionStorageOrNull());
    setRestoredProfile(null);
    setFormKey((k) => k + 1);
    setFormStatus(null);
    setProfile({});
    setProfileNonce(0); // 진단 전 상태로 — 지도 재조회 효과가 멈춘다
    setDiagnosis(null);
    setSelectedId("");
    setDrawerOpen(false);
    setFundingData(null);
    setCountData(null);
    setFundingError("");
    resetFundingForCompany();
    setResultTab("all");
    setResultQuery("");
    setAskedQuery("");
    setNotice("");
    dispatchMapUi({ type: "diagnosed" });
    setStep("company");
    writeStepToAddress("company", "replace");
  }, [resetFundingForCompany]);

  // 첫 그림 뒤 한 번 — 주소가 결과 단계이면 저장해 둔 값으로 진단을 다시 돌린다. 값이 없거나 깨졌으면 ① 에 머문다.
  // (첫 그림을 서버와 같게 두려고 창을 읽는 일은 효과에서 한다.)
  const booted = useRef(false);
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    const plan = bootPlanOf(window.location.search, sessionStorageOrNull());
    if (plan.kind === "rediagnose") {
      setRestoredProfile(plan.profile);
      rediagnose(plan.profile);
    } else if (stepOfSearch(window.location.search) === "result") {
      writeStepToAddress("company", "replace"); // 결과 주소인데 되살릴 값이 없다 — 주소를 ① 로 맞춘다
    }
  }, [rediagnose]);

  // 브라우저 뒤로·앞으로 가기 — 주소의 step 을 따라간다. 앞으로 가서 결과 단계가 되면 받아 둔 결과를 쓰고,
  // 없으면 저장값으로 다시 돌린다.
  const diagnosisRef = useRef<Diagnosis | null>(null);
  diagnosisRef.current = diagnosis;
  useEffect(() => {
    const onPop = () => {
      if (stepOfSearch(window.location.search) === "company") {
        setStep("company");
        setDrawerOpen(false);
        return;
      }
      if (diagnosisRef.current) {
        setStep("result");
        return;
      }
      const stored = readStoredProfile(sessionStorageOrNull());
      if (stored) rediagnose(stored);
      else {
        setStep("company");
        writeStepToAddress("company", "replace");
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [rediagnose]);

  /** 지도 오류 상자의 「다시 시도」 — 같은 조건으로 다시 부른다. */
  const retryFunding = useCallback(() => {
    if (profileNonce === 0) return;
    void loadFunding({ profile, filters: fundingFilters, sort: fundingSort, ...askedSearch });
  }, [loadFunding, profileNonce, profile, fundingFilters, fundingSort, askedSearch]);

  /**
   * 지도 공고 카드 바닥의 판정 피드백 — **조각을 안 받은 앱(ERP·일루아)에서는 `undefined`** 라
   * `FundingMap` 이 마디를 하나도 더하지 않는다. 승인 시안(2026-09-04 랩 미리보기 297·344~393줄)은
   * 지도 카드마다 이 단추를 두는데, 진단 결과의 **기본 보기가 지도**라 예전엔 랩의 핵심 기능이
   * 「목록·상세」 탭 뒤에 숨어 있었다(2026-09-07 독립 화면 검사 지적).
   * 상품 줄에는 안 그린다 — 그 판단은 `cardFooterOf`(FundingMap)가 한다.
   */
  const verdictFeedback = slots?.verdictFeedback;
  const diagnoseById = useMemo(() => diagnoseIndex(diagnosis), [diagnosis]);
  const mapCardFooter = useMemo(
    () =>
      verdictFeedback
        ? (item: FundingItem) => verdictFeedback(mapVerdictContext(item, { byId: diagnoseById, profile }))
        : undefined,
    [verdictFeedback, diagnoseById, profile],
  );

  /**
   * 진단 목록 행 바닥의 판정 피드백 — 예전 목록 카드(`ResultList`)와 같은 조각을 `place:"card"` 로 끼운다.
   * 조각을 안 받은 앱은 `undefined` 라 행이 마디를 하나도 더하지 않는다. 상품 줄에는 안 그린다(`cardFooterOf`).
   */
  const rowFooter = useMemo(
    () =>
      verdictFeedback
        ? (item: FundingItem) => verdictFeedback(listVerdictContext(item, { byId: diagnoseById, profile }))
        : undefined,
    [verdictFeedback, diagnoseById, profile],
  );

  const selectedItem =
    diagnosis && selectedId
      ? [...diagnosis.possible, ...diagnosis.uncertain, ...diagnosis.impossible]
          .find((x) => x.announcementId === selectedId) ?? null
      : null;

  // 요약 탭·검색·정렬로 거른 목록 — 지도 자료는 공고 번호 표(묶음 탭·금액 정렬이 갈래·금액을 찾는 곳)도 함께 만든다.
  const fundingByRef = useMemo(
    () => new Map((fundingData?.groups ?? []).flatMap((b) => b.items).map((it) => [it.refId, it] as const)),
    [fundingData],
  );
  // 거르는 조건은 서버에 물은 검색어(askedQuery)를 쓴다 — 받은 자료와 조건이 한 짝이라야
  // 입력 중에 「앞의 N건 안에서…」 안내가 잠깐 깜빡이지 않는다.
  const conditions = useMemo(() => ({ tab: resultTab, query: askedQuery }), [resultTab, askedQuery]);
  const shownFunding = useMemo(
    () => (fundingData ? filterFundingData(fundingData, conditions) : null),
    [fundingData, conditions],
  );

  // 검색어·탭은 서버가 앞쪽 N건으로 자르기 전에 걸러 주므로(위 요청) 화면이 넓게 다시 받을 일은 없다.
  // 거른 결과 자체가 한 갈래 상한(80건)을 넘을 때만 — 서버가 센 거른 뒤 건수가 실려 온 줄보다 많을 때만 알린다.
  const searchCut = fundingLoading ? null : searchCutOf(fundingData, conditions);

  return (
    // 여백 계단(DESIGN.md §5): 구역 사이 24(space-y-6), 카드 사이 16(gap-4).
    <div className="space-y-6 p-6">
      {notice && (
        // 안내 띠 — 상하 8·좌우 16, 본문 14/22. 두 단계가 함께 쓴다(진단 실패는 ① 에서도 보여야 한다).
        <div className="rounded-xl border border-wedly-bd bg-wedly-bg-gray px-4 py-2 text-sm leading-[22px] text-wedly-t2">
          {notice}
        </div>
      )}

      {/* ① 회사 정보 — 본문 가운데 넓은 폼(최대 880px). 폼은 ② 에서도 계속 그려 두고 숨기기만 한다 —
          「회사 정보 고치기」로 돌아왔을 때 입력값이 그대로 있게 하려는 것이다(폼의 입력 상태는 폼 안에 있다). */}
      <div
        data-area="company-panel"
        className={step === "company" ? "mx-auto w-full max-w-[880px] space-y-6" : "hidden"}
      >
        <StepBar step="company" />
        <div className="space-y-1">
          <h2 className="text-lg font-semibold leading-7 text-wedly-t1">어떤 회사의 지원정책을 찾을까요?</h2>
          <p className="text-sm leading-[22px] text-wedly-t2">
            아는 칸만 채워도 됩니다. 모르는 칸은 결과에서 「확인 필요」로 따로 모아 보여 드려요.
          </p>
        </div>
        <ProfileForm
          key={formKey}
          layout="wide"
          initialProfile={restoredProfile}
          onDiagnose={runDiagnose}
          diagnosing={diagnosing}
          prefillEndpoint={endpoints.prefill}
          documentPrefillEndpoint={endpoints.documentPrefill}
          documentPrefillMode={features?.documentPrefillMode}
          reviewCount={reviewCountOf(countData ?? fundingData, diagnosis)}
          onStatusChange={setFormStatus}
          focusUnknownNonce={fillNonce}
        />
      </div>

      {/* ② 매칭 결과 — 진단이 성공해야만 열린다. 결과 본문은 지금은 기존 진단 화면 그대로다. */}
      {step === "result" && (
        <section data-area="results" className="min-w-0 space-y-6">
          <StepBar step="result" />
          {diagnosis === null ? (
            // 새로 고침 뒤 저장해 둔 값으로 다시 돌리는 동안 — 결과가 오면 아래 본문으로 바뀐다.
            <div
              data-area="result-loading"
              className="rounded-2xl border border-wedly-bd bg-white p-6 text-sm leading-[22px] text-wedly-t2 shadow-sm"
            >
              매칭 결과를 불러오는 중입니다…
            </div>
          ) : (
            <>
              <CompanySummaryBar
                profile={profile}
                unknownCount={formStatus?.unknownCount ?? null}
                onEdit={goCompany}
                onOther={resetCompany}
              />

              {/* 결과 위 한 묶음 — 요약 탭·「모름 → 확인 필요」 띠·도구 줄(보기·검색·지금 신청 가능·정렬).
                  보기 단추(목록 / 한눈에)가 예전 「결과 보기」 알약 자리를 이어받는다(한눈에 = 기존 자금 조달 지도). */}
              <ResultSummaryBar
                data={countData ?? fundingData}
                tab={resultTab}
                onTab={setResultTab}
                unknownCount={formStatus?.unknownCount ?? null}
                reviewCount={reviewCountOf(countData ?? fundingData, diagnosis)}
                onFill={() => {
                  goCompany(); // 폼은 ① 에 있다 — 그리로 돌아가 첫 모름 칸으로 초점을 준다
                  setFillNonce((n) => n + 1);
                }}
                view={mapUi.view}
                onView={(v) => dispatchMapUi({ type: "view", view: v })}
                query={resultQuery}
                onQuery={(q) => setResultQuery(clipQuery(q))}
                nowOnly={fundingFilters.openOnly}
                onNowOnly={(v) => changeFundingFilters({ ...fundingFilters, openOnly: v })}
                sort={fundingSort}
                onSort={setFundingSort}
              />

              <SearchCutNotice cut={searchCut} />

              {/* 「전체 공고로 돌아가기」 길은 없다 — 두 부품 모두 onBrowseAll 을 안 받으면 그 단추를 안 그린다. */}
              {showsMap("diagnosed", mapUi.view) ? (
                <FundingMap
                  data={shownFunding}
                  loading={fundingLoading}
                  error={fundingError}
                  filters={fundingFilters}
                  sort={fundingSort}
                  onFiltersChange={changeFundingFilters}
                  onSortChange={setFundingSort}
                  onOpen={(item) => dispatchMapUi({ type: "open", item })}
                  onOpenDetail={openDetailFromMap}
                  onRetry={retryFunding}
                  selectedId={mapUi.openItem?.id ?? ""}
                  showExcluded={showExcluded}
                  onToggleExcluded={toggleExcluded}
                  renderCardFooter={mapCardFooter}
                />
              ) : (
                // 진단 「목록」 — 묶음별 접기·펴기. 행을 누르면 아래의 상세 서랍이 열린다(오른쪽 칸을 따로 차지하지 않는다).
                <ResultGroupList
                  data={shownFunding}
                  loading={fundingLoading}
                  error={fundingError}
                  onRetry={retryFunding}
                  diagnosis={diagnosis}
                  serverStructurizes={features?.serverStructurizes ?? true}
                  selectedKey={drawerOpen ? (fundingByRef.get(selectedId)?.id ?? "") : ""}
                  onOpen={openRow}
                  renderRowFooter={rowFooter}
                  showExcluded={showExcluded}
                  onToggleExcluded={toggleExcluded}
                />
              )}
            </>
          )}
        </section>
      )}

      {/* 수집원 자료는 통로를 넘긴 앱에만 — 랩·컨설턴트 앱은 안 넘기고, ERP는 관리자에게만 넘긴다. */}
      {endpoints.sources && (
        <SourceDirectoryPanel
          endpoint={endpoints.sources}
          onExport={features?.exportSources}
          actions={slots?.sourcesActions}
          header={slots?.sourcesHeader}
          trailingPaddingClass={features?.sourcesTrailingPaddingClass ?? ""}
        />
      )}

      {/* 상세 서랍 — 진단 목록에서 행을 눌렀을 때 DetailPanel(조건 맞춰 보기·AI 판정·돌파구·피드백·강사 문의)이
          그대로 열린다. 결과 단계일 때만 연다. */}
      <ResultDrawer
        open={drawerOpen && step === "result"}
        title={selectedItem?.title ?? fundingByRef.get(selectedId)?.title ?? "공고 상세"}
        onClose={closeDrawer}
      >
        <DetailPanel
          endpoints={endpoints}
          parseError={features?.parseError}
          verdictFeedback={verdictFeedback}
          announcementId={selectedId}
          mode="diagnosed"
          profile={profile}
          profileNonce={profileNonce}
          item={selectedItem}
          hasDiagnosis={diagnosis !== null}
          serverStructurizes={features?.serverStructurizes ?? true}
        />
      </ResultDrawer>

      {/* 서랍은 화면 위에 덮이는 판(SidePanel)이라 자리는 맨 끝이면 된다 — 좁은 화면에선 전폭이 된다.
          ★`aiVerdictAvailable` 은 다른 자리(「AI 판정」 단추·돌파구)와 **같은 규칙**이다 —
          통로가 없는 앱에서는 서랍도 AI 를 약속하지 않는다(2026-09-07 독립 리뷰 지적 3). */}
      <FundingDrawer
        item={mapUi.openItem}
        onClose={() => dispatchMapUi({ type: "close" })}
        onOpenDetail={openDetailFromMap}
        aiVerdictAvailable={!!endpoints.verdict}
      />
    </div>
  );
}

/**
 * ★기본 내보내기와 **같은 부품을 이름으로도** 내보낸다(2026-09-07 독립 리뷰 지적 4).
 *  낱개 주소(`…/ui/policy/PolicyMatchScreen`)에서 `{ PolicyMatchScreen }` 로 가져오는 코드가
 *  이미 문서·앱에 적혀 있었는데 기본 내보내기밖에 없어 소비 앱 빌드에서만 TS2724 로 터졌다.
 *  기본 내보내기는 그대로 둔다 — 기존 껍데기(`export { default } from …`)가 계속 돌아야 한다.
 *  README 예제가 실제로 되는지는 `src/readme-imports.test.ts` 가 불러서 잰다.
 */
export { PolicyMatchScreen };
