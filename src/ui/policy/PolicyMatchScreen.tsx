"use client";

// 지원정책 매칭 — 상태 관리와 배치만 맡는다(그리는 일은 조각들이 나눠 한다).
// 화면의 주인공은 「사업자 정보 입력 → 매칭」이다(2026-08-22 사장님 결정 2번).
// 위: 사업자 정보(접이식) / 아래는 두 판이 갈린다.
//  · 탐색(browse) — 좌 결과 목록 / 우 공고 상세. **여기는 바뀌지 않는다**(탐색 회귀 금지).
//  · 진단(diagnosed) — 「지도」는 전폭 자금 조달 지도 + 서랍, 「목록·상세」는 위 두 컬럼 그대로.
//    두 판은 알약(SegmentedControl)으로 갈아탄다.
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
// 거르개(칩)·펼침을 한 자리에서 옮기는 규칙 — 상세창 레일(FundingRecommendPanel)과 **같은 함수**를
// 쓴다. 이 규칙을 여기 다시 적으면 두 화면이 갈라진다(레일에서 이미 겪은 결함).
import { nextFundingState } from "../FundingRecommendPanel";
import { SegmentedControl } from "@wedly/ui-shared/ui";
import { syncUserMessage } from "../../engine/types";
import type { BusinessProfile } from "../../engine/match-engine";
import type { FundingFilters, FundingItem, FundingSort } from "../../funding/funding-map";
import type { FundingGroup } from "../../funding/funding-group";
import ProfileForm from "./ProfileForm";
import ResultList from "./ResultList";
import DetailPanel from "./DetailPanel";
import SourceDirectoryPanel from "./SourceDirectoryPanel";
import FundingMap, { type FundingMapPayload } from "../FundingMap";
import FundingDrawer from "../FundingDrawer";
import type {
  PolicyMatchEndpoints, PolicyMatchFeatures, PolicyMatchSlots, VerdictFeedbackContext,
} from "./endpoints";

/** 탐색(1단계) 목록 한 줄 — announcements 통로 응답 그대로. */
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

export type ListMode = "browse" | "diagnosed";

/** 진단 결과를 보는 두 판 — 「지도」(전폭 자금 조달 지도)와 「목록·상세」(기존 두 컬럼). */
export type DiagnosedView = "map" | "list";

const NARROW_MAX_PX = 1024; // lg 미만 = 세로로 쌓인 화면 — 고르면 상세로 데려간다

// ── 자금 조달 지도 배선 ────────────────────────────────────────────────
// 거르기(칩)·줄 세우기(정렬)·상위 N 은 **서버가** 한다(리뷰 대장 #11) — 화면이 다시 거르면
// 「한눈에 4칸」(전체 기준)과 지도·표(상위 N)의 숫자가 어긋난다. 그래서 칩·정렬은 여기(부모)가 쥐고,
// 바뀔 때마다 통로를 다시 부른다.

/** 갈래 한 칸에 받아 올 최대 건수 — 통로가 1~80 으로 죈다(`funding-map` GROUP_TOP_N). */
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

export interface FundingRequest {
  profile: BusinessProfile;
  filters: FundingFilters;
  sort: FundingSort;
}

export type FundingOutcome = { ok: true; data: FundingMapPayload } | { ok: false; message: string };

/** 통로 계약: `POST {endpoints.fundingMap} { profile, filters, sort, topN }`. */
export async function postFundingMap(req: FundingRequest, url: string): Promise<FundingOutcome> {
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        profile: req.profile,
        filters: req.filters,
        sort: req.sort,
        topN: FUNDING_TOP_N,
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
  // ── 탐색(1단계) 상태 — 회귀 금지 ──────────────────────────────────────
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("open");
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState("");
  const [reloadNonce, setReloadNonce] = useState(0);
  const loadSeq = useRef(0);

  // ── 진단(2단계) 상태 ─────────────────────────────────────────────────
  const [mode, setMode] = useState<ListMode>("browse");
  const [profile, setProfile] = useState<BusinessProfile>({});
  // 진단 회차. 진단을 다시 돌릴 때마다 올라간다 — 상세의 AI 판정이 앞 회차 값을 물고 있지 않게 한다.
  const [profileNonce, setProfileNonce] = useState(0);
  const [diagnosis, setDiagnosis] = useState<Diagnosis | null>(null);
  const [diagnosing, setDiagnosing] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const detailRef = useRef<HTMLDivElement | null>(null);

  // ── 자금 조달 지도(3단계) 상태 ────────────────────────────────────────
  const [fundingData, setFundingData] = useState<FundingMapPayload | null>(null);
  const [fundingLoading, setFundingLoading] = useState(false);
  const [fundingError, setFundingError] = useState("");
  const [fundingSort, setFundingSort] = useState<FundingSort>("rec");
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
      { setLoading: setFundingLoading, setData: setFundingData, setError: setFundingError },
      (req) => postFundingMap(req, endpoints.fundingMap),
    ),
  );
  /** 지도 → 목록·상세로 건너간 뒤 좁은 화면에서 상세로 데려갈지(그 순간엔 상세가 아직 안 그려져 있다). */
  const scrollAfterList = useRef(false);

  const load = useCallback(async (pageToUse: number, qToUse: string, statusToUse: string) => {
    const seq = ++loadSeq.current;
    setLoading(true);
    try {
      const p = new URLSearchParams({ q: qToUse, status: statusToUse, page: String(pageToUse) });
      const j = await fetch(`${endpoints.announcements}?${p}`).then((r) => r.json());
      if (seq !== loadSeq.current) return;
      if (j?.success) {
        setNotice(""); // 성공하면 이전 실패 문구를 지운다 — 안 지우면 일시 오류 문구가 영영 남는다(QA 발견)
        setRows(j.data);
        setTotal(j.total);
        setLastSyncAt(j.lastSyncAt);
      } else {
        setNotice(j?.error?.message ?? "불러오기 실패");
      }
    } catch {
      if (seq !== loadSeq.current) return;
      setNotice("불러오기 실패 — 잠시 뒤 다시 시도하세요");
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  }, [endpoints.announcements]);

  useEffect(() => { void load(page, q, status); }, [load, page, q, status, reloadNonce]);

  // 진단이 끝났거나(회차가 오르거나) 칩·정렬이 바뀌면 지도를 서버에서 다시 받는다.
  useEffect(() => {
    if (profileNonce === 0) return; // 아직 진단 전 — 부를 것이 없다
    void loadFunding({ profile, filters: fundingFilters, sort: fundingSort });
  }, [loadFunding, profileNonce, profile, fundingFilters, fundingSort]);

  // 목록·상세 판이 그려진 뒤에 데려간다 — 건너뛰던 순간엔 상세 자리가 없어 스크롤이 먹지 않는다.
  useEffect(() => {
    if (!scrollAfterList.current || mapUi.view !== "list") return;
    scrollAfterList.current = false;
    if (typeof window !== "undefined" && window.innerWidth < NARROW_MAX_PX) {
      detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [mapUi.view, selectedId]);

  const submitSearch = useCallback(() => {
    setPage(1);
    setQ(qInput);
    setReloadNonce((n) => n + 1);
  }, [qInput]);

  const refresh = useCallback(async () => {
    if (!endpoints.sync) return; // 수집기가 없는 앱에는 이 단추 자체가 없다
    setRefreshing(true);
    setNotice("");
    try {
      const j = await fetch(endpoints.sync, { method: "POST" }).then((r) => r.json());
      if (j?.success && j.data?.running) {
        // 회차가 20초 안에 안 끝나면 서버가 「돌고 있다」로 답한다(통로가 요청을 붙들다 끊기던 것을 막음).
        // 결과는 잠시 뒤 목록에 반영되므로, 다 됐다고 속이지 말고 사실대로 알린다.
        setNotice("자료를 받아오는 중입니다 — 몇 분 걸립니다. 잠시 뒤 새로고침하면 반영된 결과가 보입니다");
      } else if (j?.success) {
        setNotice(syncUserMessage(j.data?.perSource ?? []));
        setPage(1);
        setReloadNonce((n) => n + 1);
      } else {
        setNotice(j?.error?.message ?? "새로고침 실패");
      }
    } catch {
      setNotice("새로고침 실패");
    } finally {
      setRefreshing(false);
    }
  }, [endpoints.sync]);

  /** 좁은 화면은 목록과 상세가 위아래로 쌓인다 — 고른 공고가 화면 밖이면 데려간다. */
  const select = useCallback((id: string) => {
    setSelectedId(id);
    if (id && typeof window !== "undefined" && window.innerWidth < NARROW_MAX_PX) {
      detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, []);

  /** 매칭 진단 — 성공하면 진단 모드로 바꾸고 첫 공고를 열어 둔다. 성공 여부를 입력 카드에 알린다. */
  const runDiagnose = useCallback(async (p: BusinessProfile): Promise<boolean> => {
    setDiagnosing(true);
    setNotice("");
    try {
      const j = await fetch(endpoints.diagnose, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile: p }),
      }).then((r) => r.json());
      if (!j?.success) {
        setNotice(j?.error?.message ?? "진단에 실패했습니다");
        return false;
      }
      const data = j.data as Diagnosis;
      setProfile(p);
      setProfileNonce((n) => n + 1); // 이 회차 이후로는 앞 회차의 AI 판정을 쓰지 않는다
      setDiagnosis(data);
      setMode("diagnosed");
      const first = data.possible[0] ?? data.uncertain[0] ?? data.impossible[0];
      setSelectedId(first?.announcementId ?? "");
      // 지도는 새 회차 것부터 — 다른 회사의 지도를 흐리게 남겨 두지 않는다(자료를 비우면 뼈대가 뜬다).
      setFundingData(null);
      setFundingError("");
      // 이전 회사에서 펼쳐 뒀던 「안 맞아서 뺀 항목」도 새 회차로 넘어가지 않는다(훅의 같은 규칙).
      resetFundingForCompany();
      dispatchMapUi({ type: "diagnosed" });
      return true;
    } catch {
      setNotice("진단에 실패했습니다 — 잠시 뒤 다시 시도하세요");
      return false;
    } finally {
      setDiagnosing(false);
    }
  }, [endpoints.diagnose, resetFundingForCompany]);

  /** 서랍의 「상세·AI 판정 열기」 — 목록·상세 판으로 건너가며 그 공고를 고른다(서랍은 닫힌다). */
  const openDetailFromMap = useCallback((announcementId: string) => {
    scrollAfterList.current = true;
    dispatchMapUi({ type: "detail" });
    select(announcementId);
  }, [select]);

  /** 지도의 「전체 공고 탐색」 — 탐색 판으로. 서랍을 덮어 둔 채 넘어가지 않는다. */
  const browseAll = useCallback(() => {
    setMode("browse");
    dispatchMapUi({ type: "close" });
  }, []);

  /** 지도 오류 상자의 「다시 시도」 — 같은 조건으로 다시 부른다. */
  const retryFunding = useCallback(() => {
    if (profileNonce === 0) return;
    void loadFunding({ profile, filters: fundingFilters, sort: fundingSort });
  }, [loadFunding, profileNonce, profile, fundingFilters, fundingSort]);

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

  const selectedItem =
    diagnosis && selectedId
      ? [...diagnosis.possible, ...diagnosis.uncertain, ...diagnosis.impossible]
          .find((x) => x.announcementId === selectedId) ?? null
      : null;

  return (
    // 여백 계단(DESIGN.md §5): 구역 사이 24(space-y-6), 카드 사이 16(gap-4).
    <div className="space-y-6 p-6">
      <ProfileForm onDiagnose={runDiagnose} diagnosing={diagnosing} prefillEndpoint={endpoints.prefill} />

      {notice && (
        // 안내 띠 — 상하 8·좌우 16, 본문 14/22.
        <div className="rounded-xl border border-wedly-bd bg-wedly-bg-gray px-4 py-2 text-sm leading-[22px] text-wedly-t2">
          {notice}
        </div>
      )}

      {mode === "diagnosed" && (
        // 진단 결과를 어느 판으로 볼지 — 지도 안의 「카드로 보기/표로 보기」(같은 자료의 다른 모양)와
        // 층이 다르므로 앞에 이름을 붙여 무엇을 고르는 알약인지 5초 안에 읽히게 한다.
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-wedly-label text-wedly-muted">결과 보기</span>
          <SegmentedControl
            options={[
              { value: "map", label: "지도" },
              { value: "list", label: "목록·상세" },
            ]}
            value={mapUi.view}
            onChange={(v) => dispatchMapUi({ type: "view", view: v === "list" ? "list" : "map" })}
          />
        </div>
      )}

      {showsMap(mode, mapUi.view) ? (
        <FundingMap
          data={fundingData}
          loading={fundingLoading}
          error={fundingError}
          filters={fundingFilters}
          sort={fundingSort}
          onFiltersChange={changeFundingFilters}
          onSortChange={setFundingSort}
          onOpen={(item) => dispatchMapUi({ type: "open", item })}
          onOpenDetail={openDetailFromMap}
          onBrowseAll={browseAll}
          onRetry={retryFunding}
          selectedId={mapUi.openItem?.id ?? ""}
          showExcluded={showExcluded}
          onToggleExcluded={toggleExcluded}
          renderCardFooter={mapCardFooter}
        />
      ) : (
        /* 큰 화면(lg+) master-detail — 오른쪽 상세가 「내용 높이」로 자라 그 높이가 두 컬럼의 높이를
           정한다(align stretch 기본값). 상세는 안쪽 스크롤 없이 다 펼쳐지고(길면 페이지가 스크롤),
           왼쪽 목록은 그 높이에 맞춰지고 목록이 더 길면 목록 안에서만 스크롤한다.
           min-h 36rem = 상세가 아주 짧아도 목록칸이 쓸 만한 최소 높이를 갖게 하는 바닥값.
           좁은 화면(lg 미만)은 고정 높이 없이 세로로 쌓인다(모바일 잘림 방지). */
        <div className="gap-4 space-y-4 lg:grid lg:min-h-[36rem] lg:grid-cols-12 lg:space-y-0">
          {/* 왼쪽 컬럼은 relative — 안의 목록(ResultList)을 absolute inset-0 로 깔아 컬럼을 꽉 채운다.
              그래야 「목록 길이」가 행 높이를 밀어 올리지 않고, 오른쪽 상세 높이에 맞춰 채워진다. */}
          <div className="lg:col-span-5 lg:relative">
            <ResultList
              mode={mode}
              onModeChange={setMode}
              diagnosis={diagnosis}
              selectedId={selectedId}
              onSelect={select}
              browse={{
                rows, total, page, q, qInput, status, loading, refreshing, lastSyncAt,
                setQInput, submitSearch, setStatus, setPage,
              }}
              announcementsEndpoint={endpoints.announcements}
              onManualSync={endpoints.sync ? refresh : undefined}
              verdictFeedback={verdictFeedback}
              profile={profile}
            />
          </div>
          <div className="lg:col-span-7" ref={detailRef}>
            <DetailPanel
              endpoints={endpoints}
              parseError={features?.parseError}
              verdictFeedback={verdictFeedback}
              announcementId={selectedId}
              mode={mode}
              profile={profile}
              profileNonce={profileNonce}
              item={selectedItem}
              hasDiagnosis={diagnosis !== null}
              serverStructurizes={features?.serverStructurizes ?? true}
            />
          </div>
        </div>
      )}
      <SourceDirectoryPanel
        endpoint={endpoints.sources}
        onExport={features?.exportSources}
        actions={slots?.sourcesActions}
        header={slots?.sourcesHeader}
        trailingPaddingClass={features?.sourcesTrailingPaddingClass ?? ""}
      />

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
