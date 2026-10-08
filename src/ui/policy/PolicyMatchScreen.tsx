"use client";

// 지원정책 매칭 — 상태 관리와 배치만 맡는다(그리는 일은 조각들이 나눠 한다).
// 화면의 주인공은 「사업자 정보 입력 → 매칭」이다(2026-08-22 사장님 결정 2번).
// 두 단계다(2026-10-05 사장님 승인) — ① 회사 정보 → ② 매칭 결과. 회사 없이 전체 공고를 둘러보는 판은 없다.
//  · ① 회사 정보 — 본문 가운데 넓은 폼(ProfileForm layout="wide"). 「매칭 결과 보기 →」가 진단을 돌린다.
//  · ② 매칭 결과 — 진단이 성공해야만 열린다. 위에 회사 요약 줄, 아래에 결과 「목록 칸 + 상세 칸」 두 칸이다(ResultOneList).
//    목록 자료는 fundingMap 응답 하나(조건이 확실히 안 맞는 공고는 서버에 달라고도 하지 않는다 — 화면에 아예 없다)이고,
//    판정 탭 2개·돈의 성격 칩·찾기·정렬·쪽 넘김은 받아 둔 배열을 거르는 일이라 서버를 다시 부르지 않는다(서버에 다시 묻는 것은 찾기어가 바뀔 때뿐).
//    「한눈에」 지도 보기와 목록/한눈에 전환은 없다(FundingMap 부품은 다른 곳이 쓰므로 파일·export 는 남는다).
// 단계는 주소의 `?step=result` 에, 입력한 회사 정보는 sessionStorage 에만 둔다(step-state.ts) —
// 결과 단계에서 새로 고침하면 저장해 둔 값으로 진단을 다시 돌리고, 값이 없거나 깨졌으면 ① 로 돌아간다.
// 폼은 단계를 오가도 **계속 그려 두고** 숨기기만 한다 — 「회사 정보 고치기」로 돌아와도 입력값이 남는다.
// 목록의 줄을 누르면 오른쪽 상세 칸에 열린다 — 공고는 DetailPanel(정밀 판정·돌파구·피드백·강사 문의가 전부 그 안에),
// 상시 상품은 FundingDrawer 본문이다(ResultDetail). 좁은 화면(820px 이하)에서는 목록 아래에 이어 쌓인다.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BusinessProfile } from "../../engine/match-engine";
import type { FundingFilters, FundingItem, FundingSort } from "../../funding/funding-map";
import type { FundingGroup } from "../../funding/funding-group";
import ProfileForm, { type ProfileFormStatus } from "./ProfileForm";
import { SearchCutNotice } from "./ResultGroupList";
import { CompanySummaryBar, StepBar } from "./StepHeader";
import {
  bootPlanOf, clearStoredProfile, dropUnscopedProfile, scopedProfileStorage, searchWithStep, sessionStorageOrNull,
  stepOfSearch, writeStoredProfile, readStoredProfile, type Step,
} from "./step-state";
import ResultOneList from "./ResultOneList";
import { FUNDING_TOP_N } from "./result-one-list";
import ResultDetail from "./ResultDetail";
import {
  FUNDING_QUERY_DELAY_MS, WIDE_TOP_N_MAX, clipQuery, fundingSearchOf, reviewCountOf, searchCutOf,
  type SummaryTab,
} from "./result-conditions";
import SourceDirectoryPanel from "./SourceDirectoryPanel";
import type { FundingMapPayload } from "../FundingMap";
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

/**
 * 진단 결과를 보는 두 판 — 「지도」(전폭 자금 조달 지도)와 「목록·상세」(기존 두 컬럼).
 * 이 화면은 이제 목록 하나만 쓴다(C2 — 지도 전환을 뺐다). 타입은 `showsMap`·`mapUiReducer` 가 쓰고 있어 그대로 남긴다.
 */
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

// ── 결과 목록 자료 배선 ────────────────────────────────────────────────
// 목록 자료는 fundingMap 응답 하나다. 진단 때 한 번 받고, 탭·칩·정렬·쪽은 받아 둔 배열을 화면이 거른다 —
// 서버에 다시 묻는 것은 찾기어가 바뀔 때뿐이다(서버가 갈래마다 앞쪽 N건으로 자르기 **전에** 거르므로 N건 밖의 공고도 찾아진다).

/**
 * 갈래 한 칸에 처음 받아 올 건수 — 통로가 1~80 으로 죈다(`funding-map` GROUP_TOP_N).
 * 검색어는 서버가 이 건수로 자르기 **전에** 거른다(요청의 `query`) — 그래서 80건 밖의 공고도 찾아진다.
 * 거른 결과가 그래도 상한을 넘으면 목록 위 안내(`SearchCutNotice`)가 잘렸다고 알린다.
 * 값은 `result-one-list.ts` 에 둔다 — 통합 상세창 「추천 정책」도 같은 건수를 받는데, 그쪽이 이 화면 파일을 통째로 끌어오지 않게.
 */
export { FUNDING_TOP_N };

/**
 * 결과 목록이 서버에 보내는 거르개 — 안 맞아서 뺀 항목(`excludedItems`)은 달라고 하지 않는다(`includeExcluded: false`).
 * 조건이 확실히 안 맞는 공고는 화면에 아예 안 보이기로 했다(2026-10-07 사장님 결정).
 * 시간 칩(지금 신청 가능·7일 안 마감)은 이 화면에 없다.
 */
export const ONE_LIST_FILTERS: FundingFilters = { openOnly: false, soonOnly: false, includeExcluded: false };
/** 서버가 갈래마다 앞쪽 N건을 고르는 차례 — 추천순(맞음 → 확인 필요). 화면 정렬(마감 임박·추천)은 받은 뒤에 따로 한다. */
const ONE_LIST_SERVER_SORT: FundingSort = "rec";
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
  // 회사 정보 저장소 — 로그인한 사용자마다 칸을 나눈다. 구분값이 없으면 저장·복원을 하지 않는다(null).
  const storageScope = features?.profileStorageScope;
  const profileStore = useCallback(() => scopedProfileStorage(sessionStorageOrNull(), storageScope), [storageScope]);

  // ── 진단(2단계) 상태 ─────────────────────────────────────────────────
  const [profile, setProfile] = useState<BusinessProfile>({});
  // 진단 회차. 진단을 다시 돌릴 때마다 올라간다 — 상세의 AI 판정이 앞 회차 값을 물고 있지 않게 한다.
  const [profileNonce, setProfileNonce] = useState(0);
  const [diagnosis, setDiagnosis] = useState<Diagnosis | null>(null);
  const [diagnosing, setDiagnosing] = useState(false);
  // 고른 줄·탭·칩·정렬·쪽은 목록(ResultOneList)이 쥔다 — 진단 회차마다 `key` 로 새로 만들어 앞 회사의 상태가 남지 않는다.

  // ── 결과 목록 자료(fundingMap 응답 하나) 상태 ───────────────────────────
  const [fundingData, setFundingData] = useState<FundingMapPayload | null>(null);
  const [fundingLoading, setFundingLoading] = useState(false);
  const [fundingError, setFundingError] = useState("");
  // 찾기어를 **걸지 않고** 받은 마지막 자료 — 폼 바닥의 「확인 필요 M건」은 이 자료로 센다.
  // 서버가 찾기어로 거른 자료는 건수도 거른 뒤의 수라 그대로 쓰면 줄어든다.
  const [countData, setCountData] = useState<FundingMapPayload | null>(null);
  const requestedSearched = useRef(false); // 지금 들고 있는 자료를 받은 요청에 찾기어가 실렸나
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

  // ── 찾기 — 두 탭 전체를 뒤진다. 탭·칩·정렬은 받아 둔 배열을 화면이 거르므로 서버 조건이 아니다(위 배선 주석).
  const [resultQuery, setResultQuery] = useState("");
  // 서버에 다시 묻는 찾기어 — 입력이 멈춘 뒤 300ms 에 따라간다(글자마다 요청하지 않는다).
  const [askedQuery, setAskedQuery] = useState("");
  useEffect(() => {
    if (resultQuery === askedQuery) return;
    const timer = setTimeout(() => setAskedQuery(resultQuery), FUNDING_QUERY_DELAY_MS);
    return () => clearTimeout(timer);
  }, [resultQuery, askedQuery]);
  const askedSearch = useMemo(() => fundingSearchOf({ tab: "all", query: askedQuery }), [askedQuery]);
  // 폼이 알려 주는 칸 현황 → 결과 위 「모르는 N칸 때문에 …」 한 줄. 「그 칸 채우기」는 번호를 올려 폼에 알린다.
  const [formStatus, setFormStatus] = useState<ProfileFormStatus | null>(null);
  const [fillNonce, setFillNonce] = useState(0);

  // 진단이 끝났거나(회차가 오르거나) 찾기어가 바뀌면 목록 자료를 서버에서 다시 받는다(ONE_LIST_FILTERS — 안 맞음은 안 받는다).
  // 찾기어는 서버에 실어 보낸다 — 서버가 앞쪽 N건으로 자르기 전에 거르므로 N건 밖의 공고도 찾아진다.
  useEffect(() => {
    if (profileNonce === 0) return; // 아직 진단 전 — 부를 것이 없다
    void loadFunding({ profile, filters: ONE_LIST_FILTERS, sort: ONE_LIST_SERVER_SORT, ...askedSearch });
  }, [loadFunding, profileNonce, profile, askedSearch]);
  // 새 진단이면 앞 진단에서 센 건수는 버린다(새 자료가 오기 전까지는 받은 자료로 센다).
  useEffect(() => {
    setCountData(null);
  }, [profileNonce]);

  /**
   * 매칭 진단 — **성공해야만** 결과 단계를 연다(주소에 step=result 를 올리고, 회사 정보를
   * sessionStorage 에 둔다). 실패하면 단계는 그대로다. 성공 여부를 입력 카드에 알린다.
   * 주소가 이미 결과 단계이면(새로 고침 복원·앞으로 가기) 주소는 다시 쌓지 않는다.
   */
  // 진단 회차 번호 — 「다른 회사」나 새 진단이 번호를 올리면, 그 전에 나간 진단 답은 늦게 와도 버린다.
  // 안 버리면 비운 결과·저장값·`?step=result` 가 늦은 답으로 되살아난다(독립 리뷰 10/7).
  const diagnoseGen = useRef(0);
  const runDiagnose = useCallback(async (p: BusinessProfile): Promise<boolean> => {
    const gen = ++diagnoseGen.current;
    setDiagnosing(true);
    setNotice("");
    try {
      const j = await fetch(endpoints.diagnose, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile: p, profileSource: SCREEN_PROFILE_SOURCE }),
      }).then((r) => r.json());
      if (gen !== diagnoseGen.current) return false;
      if (!j?.success) {
        setNotice(j?.error?.message ?? "진단에 실패했습니다");
        return false;
      }
      const data = j.data as Diagnosis;
      setProfile(p);
      setProfileNonce((n) => n + 1); // 이 회차 이후로는 앞 회차의 AI 판정을 쓰지 않는다
      setDiagnosis(data);
      setStep("result");
      writeStoredProfile(profileStore(), p);
      if (typeof window !== "undefined" && stepOfSearch(window.location.search) !== "result") {
        writeStepToAddress("result", "push"); // 뒤로 가기로 ① 로 돌아올 수 있게 한 칸 쌓는다
      }
      // 목록 자료는 새 회차 것부터 — 다른 회사의 목록을 흐리게 남겨 두지 않는다(자료를 비우면 뼈대가 뜬다).
      // 목록의 탭·칩·정렬·쪽·고른 줄은 `key={profileNonce}` 로 새로 만들어 처음(첫 항목 고름)부터 시작한다.
      setFundingData(null);
      setFundingError("");
      // 건수는 찾기어 없이 받은 전체 응답에서 센다 — 찾기어가 걸린 채 다시 진단하면 그 응답이 오지 않아
      // 건수가 걸러진 수로 줄어든다. 새 회차는 빈 찾기어에서 시작한다.
      setResultQuery("");
      setAskedQuery("");
      return true;
    } catch {
      if (gen === diagnoseGen.current) setNotice("진단에 실패했습니다 — 잠시 뒤 다시 시도하세요");
      return false;
    } finally {
      if (gen === diagnoseGen.current) setDiagnosing(false);
    }
  }, [endpoints.diagnose, profileStore]);

  /**
   * 「← 회사 정보 고치기」 — ① 로 돌아간다. 입력값(폼은 계속 그려 둔다)도 받아 둔 결과도 그대로 둔다.
   * 다시 「매칭 결과 보기」를 누르면 그때 새로 진단한다.
   * 주소는 **쌓는다**(push) — replace 로 덮으면 고친 뒤 다시 결과를 보고 뒤로 가기를 눌렀을 때 회사 정보 화면이
   * 두 번 연속 나온다. 이미 회사 정보 주소이면 다시 쌓지 않는다.
   */
  const goCompany = useCallback(() => {
    setStep("company");
    if (typeof window !== "undefined" && stepOfSearch(window.location.search) !== "company") {
      writeStepToAddress("company", "push");
    }
  }, []);

  /** 저장해 둔 값으로 결과를 다시 만든다(새로 고침 복원·앞으로 가기). 실패하면 ① 로 돌아가고 주소에서 step 을 뗀다. */
  const rediagnose = useCallback((p: BusinessProfile) => {
    setStep("result");
    const mine = diagnoseGen.current + 1; // runDiagnose 가 곧바로 올릴 번호
    void runDiagnose(p).then((ok) => {
      if (ok || diagnoseGen.current !== mine) return; // 그 사이 다른 회사·새 진단이면 손대지 않는다
      // 되살린 값으로 진단을 못 했으면(권한 없음 포함) 되살린 입력값·저장값도 지운다 — 남기면 화면에 앞의 고객 정보가 남는다.
      clearStoredProfile(profileStore());
      setRestoredProfile(null);
      setFormKey((k) => k + 1);
      setStep("company");
      writeStepToAddress("company", "replace");
    });
  }, [runDiagnose, profileStore]);

  /** 「다른 회사」 — 입력값·저장값·결과를 모두 비우고 ① 로. 폼은 새로 만든다(formKey). */
  const resetCompany = useCallback(() => {
    diagnoseGen.current += 1; // 나가 있던 진단 답은 버린다
    setDiagnosing(false);
    clearStoredProfile(profileStore());
    setRestoredProfile(null);
    setFormKey((k) => k + 1);
    setFormStatus(null);
    setProfile({});
    setProfileNonce(0); // 진단 전 상태로 — 목록 재조회 효과가 멈춘다
    setDiagnosis(null);
    setFundingData(null);
    setCountData(null);
    setFundingError("");
    setResultQuery("");
    setAskedQuery("");
    setNotice("");
    setStep("company");
    writeStepToAddress("company", "replace");
  }, [profileStore]);

  // 첫 그림 뒤 한 번 — 주소가 결과 단계이면 저장해 둔 값으로 진단을 다시 돌린다. 값이 없거나 깨졌으면 ① 에 머문다.
  // (첫 그림을 서버와 같게 두려고 창을 읽는 일은 효과에서 한다.)
  const booted = useRef(false);
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    dropUnscopedProfile(sessionStorageOrNull());
    const plan = bootPlanOf(window.location.search, profileStore());
    if (plan.kind === "rediagnose") {
      setRestoredProfile(plan.profile);
      rediagnose(plan.profile);
    } else if (stepOfSearch(window.location.search) === "result") {
      writeStepToAddress("company", "replace"); // 결과 주소인데 되살릴 값이 없다 — 주소를 ① 로 맞춘다
    }
  }, [rediagnose, profileStore]);

  // 브라우저 뒤로·앞으로 가기 — 주소의 step 을 따라간다. 앞으로 가서 결과 단계가 되면 받아 둔 결과를 쓰고,
  // 없으면 저장값으로 다시 돌린다.
  const diagnosisRef = useRef<Diagnosis | null>(null);
  diagnosisRef.current = diagnosis;
  useEffect(() => {
    const onPop = () => {
      if (stepOfSearch(window.location.search) === "company") {
        setStep("company");
        return;
      }
      if (diagnosisRef.current) {
        setStep("result");
        return;
      }
      const stored = readStoredProfile(profileStore());
      if (stored) rediagnose(stored);
      else {
        setStep("company");
        writeStepToAddress("company", "replace");
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [rediagnose, profileStore]);

  /** 목록 오류 상자의 「다시 시도」 — 같은 조건으로 다시 부른다. */
  const retryFunding = useCallback(() => {
    if (profileNonce === 0) return;
    void loadFunding({ profile, filters: ONE_LIST_FILTERS, sort: ONE_LIST_SERVER_SORT, ...askedSearch });
  }, [loadFunding, profileNonce, profile, askedSearch]);

  const verdictFeedback = slots?.verdictFeedback;
  const diagnoseById = useMemo(() => diagnoseIndex(diagnosis), [diagnosis]);

  /**
   * 결과 목록 줄 안의 판정 피드백 — 예전 목록 카드(`ResultList`)와 같은 조각을 `place:"card"` 로 끼운다.
   * **조각을 안 받은 앱(ERP·일루아)에서는 `undefined`** 라 줄이 마디를 하나도 더하지 않는다.
   * 상품 줄에는 안 그린다 — 그 판단은 `cardFooterOf`(FundingMap)가 한다.
   */
  const rowFooter = useMemo(
    () =>
      verdictFeedback
        ? (item: FundingItem) => verdictFeedback(listVerdictContext(item, { byId: diagnoseById, profile }))
        : undefined,
    [verdictFeedback, diagnoseById, profile],
  );

  /** 오른쪽 상세 칸 — 공고는 DetailPanel(진단 결과를 refId 로 이어 판정 근거를 넘긴다), 상품은 FundingDrawer 본문. */
  const renderDetail = (item: FundingItem) => (
    <ResultDetail
      item={item}
      endpoints={endpoints}
      features={features}
      verdictFeedback={verdictFeedback}
      profile={profile}
      profileNonce={profileNonce}
      diagnoseById={diagnoseById}
      hasDiagnosis={diagnosis !== null}
    />
  );

  // 찾기어를 걸어 받은 자료가 서버 상한(갈래마다 80건)보다 많을 때만 「앞의 N건 안에서 찾았어요」로 알린다.
  const conditions = useMemo(() => ({ tab: "all" as SummaryTab, query: askedQuery }), [askedQuery]);
  const searchCut = fundingLoading ? null : searchCutOf(fundingData, conditions);

  return (
    // 여백 계단(DESIGN.md §5): 구역 사이 24(space-y-6), 카드 사이 16(gap-4).
    <div className="policy-match-screen space-y-6">
      {notice && (
        // 안내 띠 — 상하 8·좌우 16, 본문 14/22. 두 단계가 함께 쓴다(진단 실패는 ① 에서도 보여야 한다).
        <div className="rounded-xl border border-wedly-bd bg-wedly-bg-gray px-4 py-2 text-sm leading-[22px] text-wedly-t2">
          {notice}
        </div>
      )}

      {/* ① 회사 정보 — 결과·수집원과 같은 전체 폭. 폼은 ② 에서도 계속 그려 두고 숨기기만 한다 —
          「회사 정보 고치기」로 돌아왔을 때 입력값이 그대로 있게 하려는 것이다(폼의 입력 상태는 폼 안에 있다). */}
      <div
        data-area="company-panel"
        className={step === "company" ? "policy-match-company w-full min-w-0" : "hidden"}
      >
        <div data-area="company-intro" className="policy-match-intro">
          <div className="policy-match-intro-copy">
            <h2 className="text-wedly-section font-semibold text-wedly-t1">어떤 회사의 지원정책을 찾을까요?</h2>
            <p className="text-sm leading-[22px] text-wedly-t2">
              아는 정보만 채워도 됩니다. 모르는 조건은 결과에서 ‘확인 필요’로 표시합니다.
            </p>
          </div>
          <StepBar step="company" />
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

      {/* ② 매칭 결과 — 진단이 성공해야만 열린다. 본문은 목록 칸 + 상세 칸(ResultOneList). */}
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

              <SearchCutNotice cut={searchCut} />

              {/* 결과 본문 — 판정 탭 2개·찾기·정렬·돈의 성격 칩·모름 칸 안내 + 목록 칸 + 상세 칸.
                  「그 칸 채우기」는 ① 로 돌아가(goCompany) 첫 모름 칸으로 초점을 준다(폼의 focusUnknownNonce).
                  진단 회차가 바뀌면 `key` 로 새로 만든다 — 앞 회사의 탭·쪽·고른 줄이 남지 않게. */}
              <ResultOneList
                key={profileNonce}
                data={fundingData}
                loading={fundingLoading}
                error={fundingError}
                onRetry={retryFunding}
                query={resultQuery}
                askedQuery={askedQuery}
                onQuery={(q) => setResultQuery(clipQuery(q))}
                unknownCount={formStatus?.unknownCount ?? null}
                onFill={() => {
                  goCompany();
                  setFillNonce((n) => n + 1);
                }}
                onEdit={goCompany}
                renderRowFooter={rowFooter}
                renderDetail={renderDetail}
                showSources={features?.showSourceNames ?? false}
              />
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
