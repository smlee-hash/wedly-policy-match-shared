"use client";

/**
 * 통합 상세창 레일의 「추천 정책」 탭 — 정책매칭 결과 화면(`ResultOneList`)과 **같은 부품**으로 그린다.
 *
 * 2026-09-03 에는 두 곳 다 `FundingMap` 하나였는데, 정책매칭 화면이 판정 탭·돈의 성격 칩·찾기·쪽 넘김이 있는
 * 목록(`ResultOneList`)으로 바뀌면서 상세창만 옛 지도(compact)로 남아 같은 고객을 두 화면에서 볼 때 모양과 숫자가 달랐다.
 * 이제 상세창도 `ResultOneList layout="inline"`(좁은 자리용 한 열)이다 — 줄을 누르면 그 줄 바로 아래로 요약이 펼쳐지고
 * (`InlineFundingSummary`), 다시 누르면 접힌다. 자료는 예전과 같은 통로 하나(`/api/policy-match/funding-map`, GET)에서 온다.
 *
 * ★조건이 확실히 안 맞는 공고(판정 excluded)는 **아예 안 보인다**(2026-10-07 사장님 결정) — 통로에 안 맞음을 달라고도 하지 않는다
 *  (`includeExcluded` 는 늘 false). 「안 맞아서 뺀 N건 보기」 펼침 집합·그 재조회 손잡이는 그래서 지웠다.
 * ★탭·칩·정렬·쪽은 받아 둔 배열을 화면이 거른다(서버를 다시 부르지 않는다). 찾기도 마찬가지다 — GET 통로는 찾기어를 받지
 *  않으므로 받아 둔 갈래마다 앞쪽 80건 안에서만 찾는다(그래서 잘림 안내가 「찾으면 나머지도」를 말하지 않는다 — `searchReachesAll`).
 * ★위쪽 머리(판정에 쓴 회사 정보 띠 · 피드백과 다른 칸 알림 · 「다시 추천」)는 지도의 머리 카드 부품(`FundingHeaderCard`)을 그대로 쓴다.
 * ★공고의 「공고 상세 열기」는 이 상세창이 **이미 가진** 상세(`onOpenDetail` → `swapDetail`)로 보낸다 —
 *  상세창 위에 서랍을 또 겹치지 않는다. 상세 화면이 없는 상시 상품만 `FundingDrawer` 가 맡는다.
 */
import { useEffect, useRef, useState } from "react";
import { RotateCw } from "lucide-react";
import FundingDrawer from "./FundingDrawer";
import { FundingHeaderCard, type FundingMapPayload } from "./FundingMap";
import InlineFundingSummary from "./policy/InlineFundingSummary";
import ResultOneList from "./policy/ResultOneList";
import { FUNDING_TOP_N } from "./policy/result-one-list";
import { FUNDING_QUERY_DELAY_MS, clipQuery } from "./policy/result-conditions";
import type { FundingFilters, FundingItem, FundingSort } from "../funding/funding-map";
import type { FundingGroup } from "../funding/funding-group";
import type { FeedbackDiff } from "../engine/feedback-diff";

/** `GET /api/policy-match/funding-map` 응답 = 지도 자료 + 「누구로 대조했는지」. */
export type RecommendFundingData = FundingMapPayload & {
  /** 통합 고객에서 찾은 상호. 못 찾으면 null — 조건 대조 없는 목록이라는 뜻이다. */
  matchedCompany?: string | null;
  /** 대조에 실제로 쓴 회사 정보의 사람 말 요약(`usedProfileSummary`). */
  usedProfile?: string[];
  /**
   * 피드백 최신 회차와 기업상태표의 다른 칸 알림 — 판정에는 안 쓴다. **선택 칸**이라 옛 통로 응답은 그대로 그린다.
   * 머리 카드가 그리기 전에 `isFeedbackDiff` 로 모양을 확인하고, 아니면 없는 것으로 본다.
   */
  feedbackDiff?: FeedbackDiff | null;
  /**
   * 화면에 보이는 가장 늦은 피드백 회차의 기업 사실 뽑기가 아직 안 끝났다(서버가 응답 뒤에 뽑는 중이거나 다시 시도할 차례).
   * true 면 패널이 `FACTS_POLL_MS` 마다 다시 불러와 끝나는 대로 알림을 채운다. **선택 칸** — 없으면 다시 부르지 않는다.
   */
  feedbackFactsPending?: boolean;
};

/** 기업 사실 뽑기를 기다리며 다시 부르는 간격 — 뽑기 한 번은 최대 3분(원문 읽기 2분 + AI 1분)이다. */
export const FACTS_POLL_MS = 30_000;
/** 한 번의 기다림(회사가 바뀌거나 저장 신호·「다시 추천」이 오기 전까지)에서 다시 부르는 횟수 상한 — 30초 × 20 = 10분. */
export const FACTS_POLL_MAX = 20;

/**
 * 다음 자동 재조회까지 기다릴 시간(ms). 다시 부르지 않으면 null.
 * 서버가 「아직 뽑는 중」이라고 했고(`feedbackFactsPending === true`) 상한 안일 때만 부른다 — 칸이 없거나
 * 다른 값이면(옛 통로·다른 앱) 다시 부르지 않는다. 조회 중(loading)에는 앞 자료로 판단하지 않는다.
 */
export function nextFactsPollMs(data: RecommendFundingData | null, loading: boolean, polls: number): number | null {
  if (loading || !data || data.feedbackFactsPending !== true) return null;
  return polls < FACTS_POLL_MAX ? FACTS_POLL_MS : null;
}

export const LOAD_ERROR = "추천을 불러오지 못했습니다 — 「다시 추천」으로 다시 시도하세요.";

/** 칩은 없다 — 안 맞음(`includeExcluded`)도 늘 끈다(통로에 달라고 하지 않는다). 늘 같은 객체다. */
const NO_FILTERS: FundingFilters = { openOnly: false, soonOnly: false, includeExcluded: false };
/** 서버가 갈래마다 앞쪽 N건을 고르는 차례 — 추천순. 화면 정렬(마감 임박·추천)은 받은 뒤에 목록이 따로 한다. */
const SERVER_SORT: FundingSort = "rec";

const REFRESH_BTN =
  "inline-flex items-center gap-1 rounded-lg border border-wedly-bd bg-white px-2.5 py-1 text-xs " +
  "text-wedly-t2 transition-colors duration-150 ease-out hover:text-wedly-t1 " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-wedly-accent";

/**
 * 통로 주소 한 줄. 정렬·상위 N 을 **서버에** 넘긴다. 꺼진 칩은 아예 안 싣는다(통로가 없는 값을 기본값으로 다루게).
 * 상위 N 의 기본은 정책매칭 화면과 같은 80(`FUNDING_TOP_N`)이다 — 두 화면이 같은 건수로 같은 목록을 그린다.
 *
 * ★재설계 계약 G1①·G3(2026-09-04) — 예전 `filters.fitOnly`(맞는 것만 좁히기, `fit=1`)를
 *  `filters.includeExcluded`(안 맞음도 보이기, `excluded=1`)로 바꿨다. 뜻이 정반대다: 예전엔 켜면
 *  좁아졌고, 지금은 켜면 넓어진다(통로 GET 의 `readQueryFilters` 와 같은 이름·같은 뜻).
 *  이 패널은 안 맞음을 안 보이기로 해서 늘 끈 채로 부른다 — 이 함수는 다른 부르는 쪽을 위해 켜는 길을 남긴다.
 */
export function fundingMapQuery(a: {
  bizno?: string;
  companyName?: string;
  filters: FundingFilters;
  sort: FundingSort;
  topN?: number;
}): string {
  const p = new URLSearchParams();
  // 번호·상호를 **둘 다** 보낸다 — 번호만 보내면 번호가 이상할 때(자릿수 모자람 등) 서버의
  // 상호 폴백이 아예 못 돈다(옛 추천 통로에서 겪은 일).
  if (a.bizno) p.set("bizno", a.bizno);
  if (a.companyName) p.set("name", a.companyName);
  if (a.filters.openOnly) p.set("open", "1");
  if (a.filters.soonOnly) p.set("soon", "1");
  if (a.filters.includeExcluded) p.set("excluded", "1");
  p.set("sort", a.sort);
  p.set("topN", String(a.topN ?? FUNDING_TOP_N));
  return p.toString();
}

/**
 * 거르개가 바뀔 때 **두 상태를 한 자리에서** 다음 값으로 옮긴다 — 거르개(`filters`)와 갈래별
 * 펼침(`showExcluded`)이 서로 어긋나지 않게.
 *
 * ★이 패널은 더는 안 쓴다(안 맞음을 안 보이기로 하면서 펼침 집합을 지웠다). 전폭 지도 쪽 배선 시험
 *  (`funding-wiring.test.ts`)이 이 순수 함수를 직접 불러 재므로 남긴다.
 *
 * 규칙은 하나뿐이다: **`includeExcluded` 가 참 → 거짓으로 바뀌는 순간 펼침을 비운다.** 스위치를
 * 껐다는 건 「안 맞는 건 안 보겠다」는 뜻이라, 갈래마다 펼쳐 둔 것도 함께 접히는 것이 그 말의 뜻이다.
 * 반대 방향(거짓 → 참)과 다른 칩만 뒤집힐 때는 손대지 않는다. 바꿀 것이 없으면 **받은 집합을 그대로** 돌려준다.
 */
export function nextFundingState(
  prevFilters: FundingFilters,
  prevShowExcluded: ReadonlySet<FundingGroup>,
  nextFilters: FundingFilters,
): { filters: FundingFilters; showExcluded: ReadonlySet<FundingGroup> } {
  const turnedOff = prevFilters.includeExcluded && !nextFilters.includeExcluded;
  return {
    filters: nextFilters,
    showExcluded: turnedOff && prevShowExcluded.size > 0 ? new Set<FundingGroup>() : prevShowExcluded,
  };
}

/**
 * 항목을 눌렀을 때 어디로 보내는지. 공고는 이 상세창이 이미 가진 상세 화면으로, 상시 상품은
 * 상세 화면이 없으니 서랍으로. 상세 손잡이가 없으면 공고도 서랍이 받는다 —
 * 눌러도 아무 일도 안 하는 단추를 두지 않는다.
 */
export function openTargetOf(item: FundingItem, canOpenDetail: boolean): "detail" | "drawer" {
  return item.kind === "announcement" && canOpenDetail ? "detail" : "drawer";
}

/**
 * 요약의 「공고 상세 열기」를 눌렀을 때 — `openTargetOf` 가 가린 곳으로 보낸다. 공고는 이 상세창이 이미 가진 상세로
 * (`onOpenDetail(refId)`), 상세 화면이 없는 상품은 서랍으로(`openDrawer`). 눌림 배선을 순수 함수로 떼어 눌러 보지 않고도 잰다.
 */
export function openRecommendItem(
  item: FundingItem,
  opts: { onOpenDetail?: (announcementId: string) => void; openDrawer: (item: FundingItem) => void },
): void {
  if (openTargetOf(item, Boolean(opts.onOpenDetail)) === "detail") opts.onOpenDetail?.(item.refId);
  else opts.openDrawer(item);
}

/**
 * 모름 칸 수 — 응답의 `profileGaps` 길이. 칸이 없거나 배열이 아니면(옛 통로·통로를 건너온 값) 모른다(null) —
 * 0 으로 지어내지 않는다. 목록 위 「모르는 N칸 때문에 …」 안내가 이 값을 쓴다.
 */
export function unknownCountOf(data: RecommendFundingData | null): number | null {
  return data && Array.isArray(data.profileGaps) ? data.profileGaps.length : null;
}

/** 한 번의 조회 결과 — 「어느 통로·어느 회사·어느 요청」 것인지를 함께 담는다. */
export interface FundingFetchResult {
  /** 통로·회사·정렬·다시추천 회차까지 담은 요청 열쇠. 지금 열쇠와 다르면 아직 도는 중이다. */
  requestKey: string;
  /** 통로|사업자번호|상호. 통로나 회사가 바뀌면 앞 자료를 절대 안 보여 준다. */
  companyKey: string;
  data: RecommendFundingData | null;
  error: string;
}

/**
 * 조회 열쇠 두 개를 한 자리에서 만든다 — **통로(`endpoint`)까지 섞는다**(코덱스 3차 #3, 2026-09-04).
 *
 * ★왜 통로가 열쇠에 들어가나: 같은 사업자번호·같은 칩인 채 통로만 `/api/a` → `/api/b` 로 바뀌면
 *  (앱마다 통로가 다르다) 예전엔 두 열쇠가 그대로라 **재조회가 아예 안 돌고, 앞 통로에서 받은 자료가
 *  새 통로 결과인 척** 계속 보였다. 통로를 회사 열쇠에 섞으면 세 가지가 한꺼번에 풀린다:
 *   ① 열쇠가 달라지니 조회 효과가 다시 돈다(새 통로로 나간다),
 *   ② `viewState` 가 앞 통로 자료를 「남의 것」으로 가려낸다(빈 화면 + 로딩),
 *   ③ 늦게 도착한 앞 통로 응답도 열쇠가 달라 새 화면에 못 앉는다.
 */
export function fundingFetchKeys(a: {
  endpoint: string;
  bizno?: string;
  companyName?: string;
  refreshKey: number;
  query: string;
}): { companyKey: string; requestKey: string } {
  const companyKey = `${a.endpoint}|${a.bizno ?? ""}|${a.companyName ?? ""}`;
  return { companyKey, requestKey: `${a.refreshKey}|${companyKey}|${a.query}` };
}

/**
 * 오류의 **모양**이 취소처럼 생겼는가 — `fetch` 는 `AbortError`(DOMException) 이름으로 거절한다.
 *
 * ★이 함수로 「우리가 취소했다」를 판정하면 안 된다(코덱스 3차 #A1, 2026-09-04).
 *  앱의 fetch 감싸개(프록시·계측 래퍼 등)가 **자체 시간 제한**으로 요청을 끊으면, 우리 controller 는
 *  취소한 적이 없는데도 이름이 같은 오류가 올라온다. 그때 결과 처리를 건너뛰면 `onResult` 가 영영
 *  안 불려 화면이 **영원한 로딩**(뼈대 또는 흐린 옛 자료)에 머문다.
 *  「우리가 취소했나」의 정본은 **`controller.signal.aborted`** 하나뿐이다.
 *  (이 함수는 오류를 분류해 기록하는 자리에서만 쓴다.)
 */
export function isAbortError(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { name?: unknown }).name === "AbortError";
}

/**
 * 한 번의 조회를 시작하고, **그 요청을 실제로 끊는** 정리 함수를 돌려준다(코덱스 2차 #5, 2026-09-04).
 *
 * ★예전엔 앞 요청을 **응답만 버렸다**(`alive` 깃발). 「다시 추천」을 연타하면 요청이 그만큼 쌓여
 *  서버·회선을 계속 먹었고, 마지막 것만 화면에 앉았다. 이제 `AbortController` 로 앞 요청을
 *  그 자리에서 끊는다 — 효과의 정리 함수가 이 함수를 부르므로 ⓐ 연타(요청 열쇠가 바뀜) ⓑ 회사 바뀜
 *  ⓒ 화면이 사라짐 세 경우 모두 같은 길로 취소된다.
 *
 * 깃발(`alive`)은 그대로 남긴다 — 취소가 걸린 뒤에도 이미 풀린 약속의 뒷단계가 한 번 더 돌 수 있다.
 * 취소로 난 오류는 **삼킨다**(사용자에게 「불러오지 못했습니다」를 띄우지 않는다).
 *
 * ★삼키는 기준은 **`controller.signal.aborted` 하나**다(코덱스 3차 #A1, 2026-09-04). 예전엔 오류
 *  **이름**(`AbortError`)만으로도 삼켰는데, 앱의 fetch 감싸개가 자체 시간 제한으로 끊으면 우리가
 *  취소한 적이 없어도 같은 이름이 온다 → `onResult` 가 안 불려 화면이 영원히 로딩에 머물렀다.
 *  우리가 안 끊었으면 이름이 무엇이든 **오류로 처리해 로딩을 끝낸다**.
 *
 * 조회 자체(`fetch`)는 전역에서 그때그때 찾는다 — 시험이 전역을 갈아 끼워 잴 수 있게.
 */
export function startFundingMapFetch(a: {
  url: string;
  requestKey: string;
  companyKey: string;
  parseError: (json: unknown) => string;
  onResult: (r: FundingFetchResult) => void;
}): () => void {
  const controller = new AbortController();
  let alive = true;
  const done = (over: { data?: RecommendFundingData | null; error?: string }) => {
    if (!alive) return;
    a.onResult({ requestKey: a.requestKey, companyKey: a.companyKey, data: over.data ?? null, error: over.error ?? "" });
  };
  fetch(a.url, { signal: controller.signal })
    .then((r) => r.json())
    .then((b) => {
      if (b?.success && b.data) done({ data: b.data as RecommendFundingData });
      else done({ error: a.parseError(b) });
    })
    .catch(() => {
      // 우리가 끊었을 때만 조용히 넘긴다 — 오류 이름은 보지 않는다(위 주석).
      if (controller.signal.aborted) return;
      done({ error: LOAD_ERROR });
    });
  return () => {
    alive = false;
    controller.abort();
  };
}

/**
 * 그릴 것을 **그리는 순간에 가려낸다** — 효과 안에서 상태를 지우면 쓸데없는 다시 그리기가 한 번 더 돌고,
 * 그 사이 한 프레임 동안 앞 회사 목록이 이 회사 것처럼 보인다.
 *  · 통로나 회사가 바뀌면 앞 자료·오류는 없는 셈 친다(남의 회사·앞 통로 자금을 지금 것으로 읽지 않게).
 *  · 「다시 추천」만 누른 재조회 중에는 **앞 자료를 그대로 둔다**(목록이 사라졌다 나타나지 않게 — 흐려질 뿐).
 */
export function viewState(
  result: FundingFetchResult | null,
  requestKey: string,
  companyKey: string,
): { data: RecommendFundingData | null; error: string; loading: boolean } {
  const mine = result && result.companyKey === companyKey ? result : null;
  return { data: mine?.data ?? null, error: mine?.error ?? "", loading: result?.requestKey !== requestKey };
}

/**
 * 「이 사업장을 못 찾았다」 안내 — **못 찾았을 때만** 뜬다(2026-09-04 승인 시안 A안).
 * 조건 판정 없는 목록이라고 먼저 밝히지 않으면 「이 회사엔 맞는 자금이 없다」로 잘못 읽힌다.
 *
 * ★예전엔 「찾았는데 쓸 정보가 0개」일 때도 같은 안내를 그렸는데, 그 말은 머리 카드의
 *  빈칸 힌트(`gapParts`)가 이미 한다 — 같은 말이 화면에 두 번 나왔다. 이제 이 안내는 「못 찾음」
 *  하나만 맡는다. (정책매칭식 목록으로 바꾼 뒤에는 「모르는 N칸 때문에 …」 안내가 그 말을 대신한다.)
 * ★찾은 고객의 「판정에 쓴 정보」도 머리 카드가 그린다 — 여기서 겹쳐 적지 않는다.
 *  (`usedProfile` 은 부르는 쪽 모양을 안 바꾸려고 그대로 받되 읽지 않는다.)
 * ★`matchedCompany` 는 **`null` 일 때만** 「못 찾음」이다(코덱스 2차 #3, 2026-09-04 — 5차 #1 의
 *  「undefined 도 null 과 같게」를 되돌린다). 이름을 **생략한 것**(undefined)과 **못 찾았다고 말한 것**
 *  (null)은 다른 사실이다: 이 칸을 아예 안 싣는 통로(옛 판·다른 앱)의 응답에 「이 사업장 정보를 찾지
 *  못했어요」를 띄우면, 멀쩡히 찾아 판정까지 한 목록을 「조건 판정 없는 목록」이라고 단정하게 된다.
 *  모르면 아무 말도 하지 않는다.
 */
export function ProfileNotice({
  matchedCompany,
}: {
  matchedCompany: string | null | undefined;
  usedProfile: string[];
}) {
  if (matchedCompany !== null) return null;
  return (
    <div className="mb-2 break-keep rounded-lg border border-wedly-bd bg-wedly-bg-yellow px-3 py-2 text-xs">
      <p className="font-semibold text-wedly-t1">이 사업장 정보를 찾지 못했어요</p>
      <p className="text-wedly-t2">조건 판정 없이 지금 열려 있는 자금만 보여 드립니다</p>
    </div>
  );
}

export interface RecommendPanelProps {
  /** 목록 줄의 출처 이름표와 서랍의 「같은 공고 N건(수집원별)」 — 관리자만(2026-10-07). 기본 false. */
  showSources?: boolean;
  data: RecommendFundingData | null;
  loading: boolean;
  error: string;
  /** 찾기 칸에 보이는 글 · 거르기에 쓰는 글(입력이 멈춘 뒤 따라간다). 받아 둔 줄을 화면에서 거른다. */
  query: string;
  askedQuery: string;
  onQuery: (q: string) => void;
  /** 목록 상태(탭·칩·정렬·쪽·펼친 줄)를 새로 만드는 열쇠 — 회사가 바뀌면 달라져 앞 회사의 상태가 안 남는다. */
  listKey?: string;
  /** 서랍에 열린 항목(상시 상품). 없으면 서랍을 안 그린다. */
  drawerItem: FundingItem | null;
  /** 요약의 「공고 상세 열기」 — 부모가 상세 화면으로 보낼지 서랍으로 보낼지 정한다(`openTargetOf`). */
  onOpen: (item: FundingItem) => void;
  onOpenDetail?: (announcementId: string) => void;
  /**
   * 「피드백과 다른 칸」 구역의 `기업상태표 열기` · 모름 칸 안내의 「그 칸 채우기」 · 빈 상태의 「← 회사 정보 고치기」 —
   * 안 넘기면 세 단추 모두 안 그린다(누르면 아무 일도 안 하는 단추를 두지 않는다).
   */
  onOpenCompanyStatus?: () => void;
  onCloseDrawer: () => void;
  onRefresh: () => void;
  /** 마감 계산 기준 시각 — 생략하면 지금. 시험이 고정값을 넣는다. */
  now?: Date;
}

/**
 * 상태 없는 본체 — 손잡이·자료를 전부 밖에서 받는다. 이 저장소엔 jsdom 이 없어
 * 「눌러 본 뒤의 화면」은 상태를 밖에서 바꿔 다시 그려야만 잴 수 있다(전례: `funding-map-render.test.tsx`).
 * (목록 안의 탭·칩·정렬·쪽·펼친 줄은 `ResultOneList` 가 쥔다.)
 */
export function RecommendPanel({
  data,
  loading,
  error,
  query,
  askedQuery,
  onQuery,
  listKey,
  drawerItem,
  onOpen,
  onOpenDetail,
  onOpenCompanyStatus,
  onCloseDrawer,
  onRefresh,
  now,
  showSources = false,
}: RecommendPanelProps) {
  // 「다시 추천」은 **어느 상태에서도** 남는다 — 배포 교체 창의 일시 502 뒤 사용자가 복구할 길이
  // 상세창을 닫았다 여는 것뿐이었다(화면 독립 검사 2026-08-30 지적 F). 자료가 있으면 머리 카드 라벨 줄에,
  // 뼈대·오류에는 오른쪽 끝 한 줄로 둔다. 머리는 목록 밖이라 재조회 중 목록이 흐려져도 눌린다.
  const refresh = (
    <button type="button" onClick={onRefresh} className={REFRESH_BTN}>
      <RotateCw className="h-3 w-3" />
      다시 추천
    </button>
  );
  return (
    <div>
      {/* 「못 찾음」 판정은 `ProfileNotice` **한 곳에만** 둔다 — 여기서 같은 조건을 한 번 더 적으면
          두 곳이 갈릴 수 있는데 겉으로는 아무 차이가 안 나 시험으로도 못 잡는다(실측: 이 줄만
          옛 규칙으로 되돌려도 시험 39건이 전부 통과했다). */}
      {data && <ProfileNotice matchedCompany={data.matchedCompany} usedProfile={data.usedProfile ?? []} />}
      {/* 머리 — 판정에 쓴 회사 정보 띠 · 피드백과 다른 칸 알림 · 「다시 추천」. 지도의 머리 카드와 같은 부품이다.
          모름 칸 힌트는 목록 위 「모르는 N칸 때문에 …」 안내가 대신하므로 여기서는 안 그린다. */}
      <div className="mb-3">
        {data ? (
          <FundingHeaderCard
            data={data}
            compact
            headerAction={refresh}
            onOpenCompanyStatus={onOpenCompanyStatus}
            showGap={false}
          />
        ) : (
          <div className="flex justify-end">{refresh}</div>
        )}
      </div>
      <ResultOneList
        key={listKey}
        layout="inline"
        data={data}
        loading={loading}
        error={error}
        onRetry={onRefresh}
        query={query}
        askedQuery={askedQuery}
        onQuery={onQuery}
        // GET 통로는 찾기어를 받지 않는다 — 받아 둔 줄 안에서만 찾으므로 「찾으면 나머지도」를 약속하지 않는다.
        searchReachesAll={false}
        unknownCount={unknownCountOf(data)}
        onFill={onOpenCompanyStatus}
        onEdit={onOpenCompanyStatus}
        renderDetail={(item) => <InlineFundingSummary item={item} now={now} onOpen={onOpen} />}
        showSources={showSources}
      />
      {/* 발 안내 — ★「자동 대조 결과입니다」는 **확실히 아닐 때만** 뺀다(코덱스 3차 #C, 2026-09-04).
           앞선 두 판(요약 길이 → `evaluatedConditions` 판정 수)은 둘 다 근사치였다: 판정 엔진이
           「이 조건을 회사 정보와 견줘 봤다」를 기록하지 않아 어떤 셈도 사실을 못 말한다.
           이제 **회사 정보 자체가 비었을 때**(`profileEmpty === true`)만 이 말을 빼고, 그 밖에는
           예전처럼 그대로 둔다 — 응답에 칸이 없는 옛 통로도 「그 밖」이다(모르면 안 바꾼다). */}
      {data && (
        <p className="mt-3 break-keep text-xs text-wedly-muted">
          {data.profileEmpty === true
            ? "최종 자격은 공고 원문에서 확인하세요."
            : "자동 대조 결과입니다 — 최종 자격은 공고 원문에서 확인하세요."}
        </p>
      )}
      <FundingDrawer item={drawerItem} onClose={onCloseDrawer} onOpenDetail={onOpenDetail} showSources={showSources} />
    </div>
  );
}

export default function FundingRecommendPanel({
  bizno,
  companyName,
  onOpenDetail,
  onOpenCompanyStatus,
  endpoint = "/api/policy-match/funding-map",
  buildQuery = fundingMapQuery,
  parseError = () => LOAD_ERROR,
  refreshEventName = "wedly:company-status-saved",
  showSources = false,
}: {
  bizno?: string;
  companyName?: string;
  onOpenDetail?: (id: string) => void;
  /** 「피드백과 다른 칸」 구역의 `기업상태표 열기` · 「그 칸 채우기」 · 「← 회사 정보 고치기」 손잡이 — 기업상태표를 여는 앱이 넘긴다. 안 넘기면 단추가 없다. */
  onOpenCompanyStatus?: () => void;
  /** 조회 통로 주소 — 앱마다 다를 수 있어 밖에서 받는다(기본은 지금 ERP 가 쓰는 주소). */
  endpoint?: string;
  /** 조회 문자열을 만드는 규칙 — 기본은 지금처럼 사업자번호+상호를 함께 싣는다(`fundingMapQuery`). */
  buildQuery?: (a: {
    bizno?: string;
    companyName?: string;
    filters: FundingFilters;
    sort: FundingSort;
    topN?: number;
  }) => string;
  /** 실패한 응답에서 사람이 읽을 오류 문구를 꺼낸다 — 기본은 지금 동작(고정 문구 `LOAD_ERROR`). */
  parseError?: (json: unknown) => string;
  /** 기업상태표 저장 신호 이름 — 기본은 ERP `COMPANY_STATUS_SAVED_EVENT` 와 같은 값. */
  refreshEventName?: string;
  /** 목록 줄의 출처 이름표와 서랍의 「같은 공고 N건(수집원별)」 — 수집원 자료는 관리자만 본다(2026-10-07). 기본 false. */
  showSources?: boolean;
}) {
  // 다시 대조 회차 — 「다시 추천」 단추와 기업상태표 저장 신호가 올린다(사장님 2026-08-30).
  const [refreshKey, setRefreshKey] = useState(0);
  // 조회 결과·서랍은 **누구 것인지**를 함께 담는다 — 회사가 바뀌면 그리는 순간 가려낸다.
  const [result, setResult] = useState<FundingFetchResult | null>(null);
  const [opened, setOpened] = useState<{ companyKey: string; item: FundingItem } | null>(null);
  // 찾기 — 칸에 보이는 글과, 입력이 멈춘 뒤(300ms) 거르기에 쓰는 글. 받아 둔 줄을 화면에서 거른다(통로는 찾기어를 안 받는다).
  const [searchText, setSearchText] = useState("");
  const [askedQuery, setAskedQuery] = useState("");
  // 안 맞음은 안 받는다(`NO_FILTERS`), 정렬은 늘 추천순, 건수는 정책매칭 화면과 같은 80 — 칩·정렬이 통로를 다시 부르지 않는다.
  const query = buildQuery({ bizno, companyName, filters: NO_FILTERS, sort: SERVER_SORT, topN: FUNDING_TOP_N });
  // 통로까지 섞은 열쇠 — 통로만 바뀌어도 재조회가 돌고 앞 통로 자료가 안 남는다(코덱스 3차 #3).
  const { companyKey, requestKey } = fundingFetchKeys({ endpoint, bizno, companyName, refreshKey, query });
  const { data, error, loading } = viewState(result, requestKey, companyKey);
  const drawerItem = opened?.companyKey === companyKey ? opened.item : null;
  // 기업 사실 뽑기를 기다리며 다시 부른 횟수 — 회사가 바뀌거나 저장 신호·「다시 추천」이 오면 0 으로 돌린다.
  const factsPollsRef = useRef(0);
  // 다음 자동 재조회 타이머 — 저장 신호가 오면 이것을 먼저 끊어, 저장 직후 요청과 겹쳐 두 번 부르지 않게 한다.
  const factsPollTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // 오류 문구 규칙은 **의존 배열에 넣지 않는다** — 부모가 화살표 함수를 그 자리에서 만들어 주면
  // 매 렌더마다 새 함수라 재조회가 끝없이 돈다. 대신 늘 최신 것을 쓰도록 ref 로 받는다
  // (이 저장소 관례: `StepDraftEditor.tsx`·`SkeletonStepEditor.tsx` 의 onChangeRef 와 같은 꼴).
  const parseErrorRef = useRef(parseError);
  useEffect(() => {
    parseErrorRef.current = parseError;
  }, [parseError]);

  useEffect(() => {
    // 칸을 연달아 채우면 신호가 몰린다 — 600ms 로 묶어 재대조를 한 번만(적대 리뷰 사소1).
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onSaved = () => {
      factsPollsRef.current = 0;
      clearTimeout(factsPollTimerRef.current);
      factsPollTimerRef.current = undefined;
      clearTimeout(timer);
      timer = setTimeout(() => setRefreshKey((k) => k + 1), 600);
    };
    window.addEventListener(refreshEventName, onSaved);
    return () => {
      clearTimeout(timer);
      window.removeEventListener(refreshEventName, onSaved);
    };
  }, [refreshEventName]);

  // 회사(또는 통로)가 바뀌면 사실 뽑기 재조회 횟수를 0 으로 돌리고, 앞 회사에서 입력한 찾기어를 비운다.
  // 같은 값("")으로 비우면 다시 그리기가 헛돌지 않는다. (목록 상태는 `listKey` 로 새로 만든다.)
  useEffect(() => {
    factsPollsRef.current = 0;
    setSearchText("");
    setAskedQuery("");
  }, [companyKey]);

  // 입력이 멈춘 뒤 거르기에 쓰는 글이 따라간다(글자마다 목록을 다시 거르지 않는다).
  useEffect(() => {
    if (searchText === askedQuery) return;
    const timer = setTimeout(() => setAskedQuery(searchText), FUNDING_QUERY_DELAY_MS);
    return () => clearTimeout(timer);
  }, [searchText, askedQuery]);

  // 피드백 회차의 기업 사실을 서버가 아직 뽑는 중이면 끝날 때까지 다시 부른다 — 끝나면(또는 상한이면) 멈춘다.
  // 다시 부르는 조회가 서버에 「다시 시도할 회차」를 또 맡기므로, 실패한 첫 시도의 재시도도 이 길로 돈다.
  useEffect(() => {
    const ms = nextFactsPollMs(data, loading, factsPollsRef.current);
    if (ms === null) return;
    const timer = setTimeout(() => {
      factsPollTimerRef.current = undefined;
      factsPollsRef.current += 1;
      setRefreshKey((k) => k + 1);
    }, ms);
    factsPollTimerRef.current = timer;
    return () => {
      clearTimeout(timer);
      if (factsPollTimerRef.current === timer) factsPollTimerRef.current = undefined;
    };
  }, [data, loading]);

  useEffect(() => {
    if (!bizno && !companyName) return;
    // 레일이 다른 업체로 바뀐 뒤 도착한 옛 응답이 새 업체 화면을 덮지 않게 한다(코덱스 리뷰 중간5).
    // ★앞 요청은 **실제로 끊는다**(코덱스 2차 #5) — 정리 함수가 abort 하므로, 「다시 추천」을 연타하면
    //  요청 열쇠가 바뀌며 효과가 다시 도는 그 순간 앞 요청이 취소된다(쌓이지 않는다).
    return startFundingMapFetch({
      url: `${endpoint}?${query}`,
      requestKey,
      companyKey,
      parseError: (b) => parseErrorRef.current(b),
      onResult: setResult,
    });
  }, [endpoint, bizno, companyName, companyKey, query, requestKey]);

  if (!bizno && !companyName) {
    return <p className="text-sm text-wedly-t2">사업자번호가 있어야 정책을 대조할 수 있습니다.</p>;
  }

  return (
    <RecommendPanel
      showSources={showSources}
      data={data}
      loading={loading}
      error={error}
      query={searchText}
      askedQuery={askedQuery}
      onQuery={(q) => setSearchText(clipQuery(q))}
      listKey={companyKey}
      drawerItem={drawerItem}
      onOpen={(it) => openRecommendItem(it, { onOpenDetail, openDrawer: (item) => setOpened({ companyKey, item }) })}
      onOpenDetail={onOpenDetail}
      onOpenCompanyStatus={onOpenCompanyStatus}
      onCloseDrawer={() => setOpened(null)}
      onRefresh={() => {
        factsPollsRef.current = 0;
        setRefreshKey((k) => k + 1);
      }}
    />
  );
}
