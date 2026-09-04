"use client";

/**
 * 통합 상세창 레일의 「추천 정책」 탭 — 2026-09-03 부터 `/policy-match` 와 **같은 부품**으로 그린다.
 *
 * 옛 모양(카테고리 칩 + 공고 카드 목록, `RecommendList`)은 지웠다. 같은 고객을 두 화면에서 볼 때
 * 갈래·숫자·글자가 달라 어느 쪽을 믿을지 알 수 없었기 때문이다 — 이제 두 곳 다
 * `FundingMap`(compact) 하나이고, 자료도 통로 하나(`/api/policy-match/funding-map`)에서 온다.
 *
 * ★거르기(칩)·줄 세우기(정렬)는 **서버 몫**이다(계획서 리뷰 대장 #11). 이 파일은 상태만 쥐고,
 *  바뀌면 통로를 다시 부른다 — 받은 자료를 화면에서 또 거르면 「한눈에 4칸」(전체 기준)과
 *  갈래 카드(상위 N건)의 숫자가 어긋난다.
 * ★공고를 누르면 이 상세창이 **이미 가진** 상세(`onOpenDetail` → `swapDetail`)로 보낸다 —
 *  상세창 위에 서랍을 또 겹치지 않는다. 상세 화면이 없는 상시 상품만 `FundingDrawer` 가 맡는다.
 */
import { useEffect, useState } from "react";
import { Info, RotateCw } from "lucide-react";
import FundingDrawer from "./FundingDrawer";
import FundingMap, { type FundingMapPayload } from "./FundingMap";
import { profileBandWords, type FundingFilters, type FundingItem, type FundingSort } from "../funding/funding-map";
import type { FundingGroup } from "../funding/funding-group";

/** `GET /api/policy-match/funding-map` 응답 = 지도 자료 + 「누구로 대조했는지」. */
export type RecommendFundingData = FundingMapPayload & {
  /** 통합 고객에서 찾은 상호. 못 찾으면 null — 조건 대조 없는 목록이라는 뜻이다. */
  matchedCompany?: string | null;
  /** 대조에 실제로 쓴 회사 정보의 사람 말 요약(`usedProfileSummary`). */
  usedProfile?: string[];
};

/** 상세창 레일은 자리가 좁다 — 갈래마다 상위 3건만 받는다(계획서 리뷰 대장 #22 응답 크기). */
export const COMPACT_TOP_N = 3;

export const LOAD_ERROR = "추천을 불러오지 못했습니다 — 「다시 추천」으로 다시 시도하세요.";

const NO_FILTERS: FundingFilters = { openOnly: false, soonOnly: false, includeExcluded: false };

const REFRESH_BTN =
  "inline-flex items-center gap-1 rounded-lg border border-wedly-bd bg-white px-2.5 py-1 text-xs " +
  "text-wedly-t2 transition-colors duration-150 ease-out hover:text-wedly-t1 " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-wedly-accent";

/**
 * 통로 주소 한 줄. 칩·정렬·상위 N 을 **서버에** 넘긴다 — 화면이 받은 자료를 다시 거르지 않는다.
 * 꺼진 칩은 아예 안 싣는다(통로가 없는 값을 기본값으로 다루게).
 *
 * ★재설계 계약 G1①·G3(2026-09-04) — 예전 `filters.fitOnly`(맞는 것만 좁히기, `fit=1`)를
 *  `filters.includeExcluded`(안 맞음도 보이기, `excluded=1`)로 바꿨다. 뜻이 정반대다: 예전엔 켜면
 *  좁아졌고, 지금은 켜면 넓어진다(통로 GET 의 `readQueryFilters` 와 같은 이름·같은 뜻).
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
  p.set("topN", String(a.topN ?? COMPACT_TOP_N));
  return p.toString();
}

/**
 * 갈래 하나만 뒤집는다 — 「안 맞아서 뺀 항목 보기」 집합(showExcluded) 손잡이를 순수 함수로 뗀다
 * (계약 §G2·§G3 — `PolicyMatchClient.tsx` 의 `toggleGroupSet` 과 같은 규칙, 화면 밖에서도 잴 수
 * 있게). ErpPolicyRecommendSection 은 별도 페이지 부품(PolicyMatchClient)을 끌어오지 않고 이 파일
 * 안에 같은 규칙을 자체로 둔다 — 두 화면이 서로의 화면 부품 파일을 참조하게 만들지 않는다.
 */
export function toggleExcludedGroup(set: ReadonlySet<FundingGroup>, group: FundingGroup): Set<FundingGroup> {
  const next = new Set(set);
  if (next.has(group)) next.delete(group);
  else next.add(group);
  return next;
}

/**
 * 회사가 바뀔 때 거르개를 처음으로 되돌린다 — 「안 맞아서 뺀 항목」 펼침만(다른 칩은 그대로).
 *
 * ★코덱스 11차 #10(2026-09-04) — 상세창 레일에서 다른 회사로 갈아타도 이 펼침이 남아 있어,
 *  새 회사를 `excluded=1` 로 물으면서 앞 회사에서 펼쳐 둔 갈래가 계속 열려 있었다. 갈래 이름은
 *  같아도 「무엇이 안 맞는지」는 회사마다 다르다.
 *
 * **이미 꺼져 있으면 받은 객체를 그대로 돌려준다** — 새 객체를 만들면 조회 열쇠(`fundingMapQuery`)가
 * 달라져 회사를 바꿀 때마다 같은 조회가 한 번 더 돈다.
 */
export function resetExcludedForCompany(f: FundingFilters): FundingFilters {
  return f.includeExcluded ? { ...f, includeExcluded: false } : f;
}

/**
 * 항목을 눌렀을 때 어디로 보내는지. 공고는 이 상세창이 이미 가진 상세 화면으로, 상시 상품은
 * 상세 화면이 없으니 서랍으로. 상세 손잡이가 없으면 공고도 서랍이 받는다 —
 * 눌러도 아무 일도 안 하는 카드를 두지 않는다.
 */
export function openTargetOf(item: FundingItem, canOpenDetail: boolean): "detail" | "drawer" {
  return item.kind === "announcement" && canOpenDetail ? "detail" : "drawer";
}

/** 한 번의 조회 결과 — 「어느 회사·어느 요청」 것인지를 함께 담는다. */
export interface FundingFetchResult {
  /** 회사·칩·정렬·다시추천 회차까지 담은 요청 열쇠. 지금 열쇠와 다르면 아직 도는 중이다. */
  requestKey: string;
  /** 사업자번호|상호. 회사가 바뀌면 앞 회사 자료를 절대 안 보여 준다. */
  companyKey: string;
  data: RecommendFundingData | null;
  error: string;
}

/**
 * 그릴 것을 **그리는 순간에 가려낸다** — 효과 안에서 상태를 지우면 쓸데없는 다시 그리기가 한 번 더 돌고,
 * 그 사이 한 프레임 동안 앞 회사 지도가 이 회사 것처럼 보인다.
 *  · 회사가 바뀌면 앞 회사의 자료·오류는 없는 셈 친다(남의 회사 자금을 이 회사 것으로 읽지 않게).
 *  · 칩·정렬만 바꾼 재조회 중에는 **앞 자료를 그대로 둔다**(지도가 사라졌다 나타나지 않게 — 흐려질 뿐).
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
 * 「왜 이 결과인지」 한 줄 — 대조에 쓴 회사 정보를 투명하게(사장님 2026-08-30).
 * 고객을 못 찾았거나 대조에 쓸 칸이 하나도 없으면 **조건 대조 없는 목록**이라고 먼저 밝힌다
 * (그 말이 없으면 「이 회사엔 맞는 자금이 없다」로 잘못 읽힌다).
 * ※ 빠진 칸 안내는 지도(`FundingMap`)의 판정 기준 띠가 이미 말한다 — 여기서 겹쳐 적지 않는다.
 *
 * ★재설계 계약 §G3(2026-09-04) — 옛 「대조에 쓴 정보: …」 문장을 `profileBandWords`(G1)로
 *  통일했다. 「대조 기준」 낱말은 계약 낱말 규칙이 금지하고, 지도(FundingMap)의 위 띠와 서랍이
 *  같은 도우미로 같은 문장을 쓰므로 이 안내도 같은 말을 써야 「왜 이 결과인지」가 화면마다
 *  안 갈린다.
 */
export function ProfileNotice({
  matchedCompany,
  usedProfile,
}: {
  matchedCompany: string | null;
  usedProfile: string[];
}) {
  const noAxes = matchedCompany !== null && usedProfile.length === 0;
  if (matchedCompany === null || noAxes) {
    return (
      <p className="mb-2 break-keep rounded-lg border border-wedly-bd bg-wedly-bg-yellow px-3 py-2 text-xs text-wedly-t1">
        {noAxes
          ? "대조에 쓸 회사 정보(지역·업종·직원수 등)가 비어 있어, 조건 대조 없이 지금 열려 있는 자금 수단만 보여 드립니다 — 정보를 채우면 맞춤 대조가 시작됩니다."
          : "통합 고객에서 이 사업장을 찾지 못해, 조건 대조 없이 지금 열려 있는 자금 수단만 보여 드립니다."}
      </p>
    );
  }
  return (
    <p className="mb-2 break-keep rounded-lg bg-wedly-bg-gray px-3 py-2 text-xs text-wedly-t2">
      <Info className="mr-1 inline h-3.5 w-3.5 text-wedly-accent" />
      <span className="text-wedly-t1">{profileBandWords(usedProfile)}</span>
    </p>
  );
}

export interface RecommendPanelProps {
  data: RecommendFundingData | null;
  loading: boolean;
  error: string;
  filters: FundingFilters;
  sort: FundingSort;
  /** 서랍에 열린 항목(상시 상품). 없으면 서랍을 안 그린다. */
  drawerItem: FundingItem | null;
  /**
   * 갈래별 「안 맞아서 뺀 항목 보기」 펼침 집합 — **부모(ErpPolicyRecommendSection)가 쥔다**
   * (계약 §G2·§G3, `FundingMap` 의 같은 이름 prop과 같은 규칙). 비어 있지 않으면 부모가
   * `filters.includeExcluded:true` 로 재조회해야 한다.
   */
  showExcluded: ReadonlySet<FundingGroup>;
  onFiltersChange: (filters: FundingFilters) => void;
  onSortChange: (sort: FundingSort) => void;
  onOpen: (item: FundingItem) => void;
  onOpenDetail?: (announcementId: string) => void;
  onCloseDrawer: () => void;
  onRefresh: () => void;
  onToggleExcluded: (group: FundingGroup) => void;
}

/**
 * 상태 없는 본체 — 손잡이·자료를 전부 밖에서 받는다. 이 저장소엔 jsdom 이 없어
 * 「눌러 본 뒤의 화면」은 상태를 밖에서 바꿔 다시 그려야만 잴 수 있다(전례: `funding-map-render.test.tsx`).
 */
export function RecommendPanel({
  data,
  loading,
  error,
  filters,
  sort,
  drawerItem,
  showExcluded,
  onFiltersChange,
  onSortChange,
  onOpen,
  onOpenDetail,
  onCloseDrawer,
  onRefresh,
  onToggleExcluded,
}: RecommendPanelProps) {
  return (
    <div>
      {/* 「다시 추천」은 **어느 상태에서도** 남는다 — 배포 교체 창의 일시 502 뒤 사용자가 복구할 길이
          상세창을 닫았다 여는 것뿐이었다(화면 독립 검사 2026-08-30 지적 F). */}
      <div className="mb-2 flex justify-end">
        <button type="button" onClick={onRefresh} className={REFRESH_BTN}>
          <RotateCw className="h-3 w-3" />
          다시 추천
        </button>
      </div>
      {data && (data.matchedCompany === null || (data.usedProfile ?? []).length === 0) && <ProfileNotice matchedCompany={data.matchedCompany ?? null} usedProfile={data.usedProfile ?? []} />}
      <FundingMap
        data={data}
        loading={loading}
        error={error}
        filters={filters}
        sort={sort}
        onFiltersChange={onFiltersChange}
        onSortChange={onSortChange}
        onOpen={onOpen}
        onOpenDetail={onOpenDetail}
        selectedId={drawerItem?.id ?? ""}
        compact
        showExcluded={showExcluded}
        onToggleExcluded={onToggleExcluded}
      />
      {data && (
        <p className="mt-3 break-keep text-xs text-wedly-muted">
          자동 대조 결과입니다 — 최종 자격은 공고 원문에서 확인하세요.
        </p>
      )}
      <FundingDrawer item={drawerItem} onClose={onCloseDrawer} onOpenDetail={onOpenDetail} />
    </div>
  );
}

export default function FundingRecommendPanel({
  bizno,
  companyName,
  onOpenDetail,
  endpoint = "/api/policy-match/funding-map",
  buildQuery = fundingMapQuery,
  parseError = () => LOAD_ERROR,
  refreshEventName = "wedly:company-status-saved",
}: {
  bizno?: string;
  companyName?: string;
  onOpenDetail?: (id: string) => void;
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
}) {
  const [filters, setFilters] = useState<FundingFilters>(NO_FILTERS);
  const [sort, setSort] = useState<FundingSort>("rec");
  // 다시 대조 회차 — 「다시 추천」 단추와 기업상태표 저장 신호가 올린다(사장님 2026-08-30).
  const [refreshKey, setRefreshKey] = useState(0);
  // 조회 결과·서랍은 **누구 것인지**를 함께 담는다 — 회사가 바뀌면 그리는 순간 가려낸다.
  const [result, setResult] = useState<FundingFetchResult | null>(null);
  const [opened, setOpened] = useState<{ companyKey: string; item: FundingItem } | null>(null);
  // 갈래별 「안 맞아서 뺀 항목 보기」 — 비어 있지 않으면 filters.includeExcluded 를 함께 켠다
  // (계약 §G2·§G3, PolicyMatchClient.tsx 의 같은 배선과 같은 규칙). 이 값 자체가 네트워크
  // 재조회를 부르므로(filters 변화로) FundingMap 안의 `expanded`(순수 UI, 재조회 없음)와 달리
  // 여기(부모)가 쥔다.
  const [showExcluded, setShowExcluded] = useState<ReadonlySet<FundingGroup>>(() => new Set<FundingGroup>());

  const companyKey = `${bizno ?? ""}|${companyName ?? ""}`;
  const query = buildQuery({ bizno, companyName, filters, sort });
  const requestKey = `${refreshKey}|${query}`;
  const { data, error, loading } = viewState(result, requestKey, companyKey);
  const drawerItem = opened?.companyKey === companyKey ? opened.item : null;

  useEffect(() => {
    // 칸을 연달아 채우면 신호가 몰린다 — 600ms 로 묶어 재대조를 한 번만(적대 리뷰 사소1).
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onSaved = () => {
      clearTimeout(timer);
      timer = setTimeout(() => setRefreshKey((k) => k + 1), 600);
    };
    window.addEventListener(refreshEventName, onSaved);
    return () => {
      clearTimeout(timer);
      window.removeEventListener(refreshEventName, onSaved);
    };
  }, [refreshEventName]);

  // 회사가 바뀌면 앞 회사에서 펼쳐 둔 「안 맞아서 뺀 항목」을 접고 재조회 스위치도 끈다(11차 #10).
  // 둘 다 바꿀 것이 없으면 **같은 값**을 돌려주므로 다시 그리기·재조회가 헛돌지 않는다.
  useEffect(() => {
    setShowExcluded((prev) => (prev.size > 0 ? new Set<FundingGroup>() : prev));
    setFilters(resetExcludedForCompany);
  }, [companyKey]);

  useEffect(() => {
    if (!bizno && !companyName) return;
    // 레일이 다른 업체로 바뀐 뒤 도착한 옛 응답이 새 업체 화면을 덮지 않게 한다(코덱스 리뷰 중간5).
    let alive = true;
    const done = (over: { data?: RecommendFundingData | null; error?: string }) => {
      if (!alive) return;
      setResult({ requestKey, companyKey, data: over.data ?? null, error: over.error ?? "" });
    };
    fetch(`${endpoint}?${query}`)
      .then((r) => r.json())
      .then((b) => {
        if (b?.success && b.data) done({ data: b.data as RecommendFundingData });
        else done({ error: parseError(b) });
      })
      .catch(() => done({ error: LOAD_ERROR }));
    return () => {
      alive = false;
    };
  }, [bizno, companyName, companyKey, query, requestKey]);

  if (!bizno && !companyName) {
    return <p className="text-sm text-wedly-t2">사업자번호가 있어야 정책을 대조할 수 있습니다.</p>;
  }

  /**
   * 갈래 카드의 「안 맞아서 뺀 N건 보기」 — 집합이 비어 있지 않아지면 `filters.includeExcluded`
   * 도 함께 켠다(계약 §G2·§G3: 하나라도 펼쳐 있으면 서버에 안 맞음까지 달라고 다시 물어야 한다).
   * 다시 전부 접으면(집합이 다시 비면) 꺼서 원래대로(안 맞음은 다시 서버에서부터 빠진다).
   */
  const onToggleExcluded = (group: FundingGroup) => {
    setShowExcluded((prev) => {
      const next = toggleExcludedGroup(prev, group);
      const wantIncludeExcluded = next.size > 0;
      setFilters((f) => (f.includeExcluded === wantIncludeExcluded ? f : { ...f, includeExcluded: wantIncludeExcluded }));
      return next;
    });
  };

  return (
    <RecommendPanel
      data={data}
      loading={loading}
      error={error}
      filters={filters}
      sort={sort}
      drawerItem={drawerItem}
      showExcluded={showExcluded}
      onFiltersChange={setFilters}
      onSortChange={setSort}
      onOpen={(it) => {
        if (openTargetOf(it, Boolean(onOpenDetail)) === "detail") onOpenDetail?.(it.refId);
        else setOpened({ companyKey, item: it });
      }}
      onOpenDetail={onOpenDetail}
      onToggleExcluded={onToggleExcluded}
      onCloseDrawer={() => setOpened(null)}
      onRefresh={() => setRefreshKey((k) => k + 1)}
    />
  );
}
