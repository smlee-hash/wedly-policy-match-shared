"use client";

// ② 매칭 결과 본문 — 모양이 둘이다(`layout`).
//  · "split"(기본) — 「목록 칸 + 상세 칸」 두 칸(승인 시안 「바꾼 뒤 ② 매칭 결과」). 정책매칭 화면이 쓴다.
//  · "inline" — 좁은 자리(통합 상세창 「추천 정책」)용 한 열. 줄을 누르면 그 줄 바로 아래로 상세가 펼쳐지고, 다시 누르면 접힌다.
// 위 도구줄(판정 탭 2개·찾기·정렬) · 돈의 성격 칩 · 모름 칸 안내는 두 모양이 같은 부품이다. 쪽 넘김·빈 상태·오류·뼈대도 같다.
// 판정 탭은 지원 가능·확인 필요 둘뿐이다 — 조건이 확실히 안 맞는 공고(excluded)는 탭도 숫자도 줄도 없다(2026-10-07 사장님 결정).
// 판정 색: 지원 가능=초록, 확인 필요=노랑(탭 앞 점·눌린 탭·줄 왼쪽 띠).
// 목록 자료는 fundingMap 응답 하나(`flattenFundingItems`) — 탭·칩·찾기·정렬·쪽 넘김은 전부 받아 둔 배열을 거르는 일이라
// 서버를 다시 부르지 않는다(서버에 다시 묻는 것은 찾기어가 바뀔 때뿐 — 부모가 한다).
// 거르는 규칙은 `result-one-list.ts`(순수 함수)에 있다. 이 파일은 그리기와, 눌림을 그 규칙에 잇는 일만 한다.
// `ResultOneListView` 는 상태를 밖에서 받아 그리기만 한다(그려서 잴 수 있다) · `ResultOneList` 가 상태를 쥔다.
import { useEffect, useMemo, useReducer, useRef, type ReactNode } from "react";
import { Skeleton } from "@wedly/ui-shared/ui";
import { FUNDING_QUERY_MAX, type FundingItem } from "../../funding/funding-map";
import CustomSelect from "../CustomSelect";
import { GROUP_TONE_TILE, cardFooterOf, type FundingMapPayload } from "../FundingMap";
import { staleErrorText } from "./ResultGroupList";
import {
  INITIAL_ONE_LIST_STATE, ONE_LIST_SORTS, VERDICT_TABS, ddayBadgeOf, defaultVerdictTab, flattenFundingItems,
  cutNoticeOf, groupTagOf, kindTagOf, lineTextOf, oneListReducer, oneListViewOf, serverCountsForQuery, sourceNameOf,
  toggleSelectedId, unknownNoticeOf, verdictTabOf,
  type ChipKey, type ListTab, type OneListSort, type OneListState, type ServerVerdictCounts,
} from "./result-one-list";

/** 목록 모양 — 두 칸(기본) 또는 좁은 자리용 한 열(줄 아래로 펼침). */
export type ResultOneListLayout = "split" | "inline";

const FIELD =
  "h-9 rounded-[10px] border border-wedly-bd bg-white px-3 text-wedly-sub text-wedly-t1 transition-colors " +
  "placeholder:text-wedly-muted focus:border-wedly-accent focus:outline-none focus:ring-2 focus:ring-wedly-accent/40";
const BTN_SMALL =
  "inline-flex h-8 items-center justify-center rounded-[10px] border border-wedly-bd bg-white px-4 text-wedly-hint " +
  "font-semibold text-wedly-t1 transition-colors hover:bg-wedly-bg-gray focus-visible:outline-none " +
  "focus-visible:ring-2 focus-visible:ring-wedly-accent focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";
const FOCUS_RING = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-wedly-accent focus-visible:ring-offset-2";

// 탭 — 테두리 두께·가로 여백은 켜짐/꺼짐이 각자 가진다(둘이 겹치면 어느 쪽이 이길지 CSS 차례에 맡기게 된다).
// 눌린 탭은 테두리가 2px 이라 가로 여백을 1px 줄여 탭 폭이 안 움직이게 한다.
const TAB_BASE = `inline-flex h-9 shrink-0 items-center rounded-full text-wedly-sub font-semibold transition-colors ${FOCUS_RING}`;
const TAB_OFF = "border border-wedly-bd bg-white px-4 text-wedly-t1 hover:bg-wedly-bg-gray";
/** 눌린 탭 — 판정 색(지원 가능=초록 · 확인 필요=노랑). 클래스는 글자 그대로 적어야 Tailwind 가 만들어 낸다. */
const TAB_ON: Record<ListTab, string> = {
  fit: "border-2 border-wedly-green bg-wedly-bg-green px-[15px] text-wedly-green-ink",
  unverified: "border-2 border-wedly-gold bg-wedly-bg-yellow px-[15px] text-wedly-t1",
};
/** 탭 글 앞의 8px 둥근 점. */
const TAB_DOT: Record<ListTab, string> = { fit: "bg-wedly-green", unverified: "bg-wedly-gold" };
/** 목록 줄 왼쪽 4px 판정 색 띠(`border-l-4` 와 함께 쓴다). */
const ROW_BAND: Record<ListTab, string> = { fit: "border-l-wedly-green", unverified: "border-l-wedly-gold" };

const CHIP_BASE = `inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-wedly-hint font-semibold transition-colors ${FOCUS_RING}`;
const CHIP_ON = "border-wedly-accent bg-wedly-bg-blue text-wedly-accent-ink";
const CHIP_OFF = "border-wedly-bd bg-white text-wedly-t1 hover:bg-wedly-bg-gray";
/** 0건 칩 — 흐리게 두고 누를 수 없다(disabled). */
const CHIP_ZERO = "cursor-not-allowed border-wedly-bd bg-white text-wedly-t2 opacity-50";

/** 판정 이름표 — 목록 줄·탭과 같은 낱말, 색은 기존 판정 알약(`verdictPillOf`)과 같은 톤. 안 맞음은 줄 자체가 없어 이름표도 없다. */
const VERDICT_TAG: Record<ListTab, { label: string; className: string }> = {
  fit: { label: "지원 가능", className: "bg-wedly-bg-green text-wedly-green-ink" },
  unverified: { label: "확인 필요", className: "bg-wedly-bg-yellow text-wedly-t1" },
};

function OneListRow({ item, selected, onSelect, footer, showSource, inline = false, detail = null }: {
  item: FundingItem;
  showSource: boolean;
  /** 두 칸: 고른 줄 · 한 열: 펼친 줄. */
  selected: boolean;
  onSelect: (id: string) => void;
  footer: ReactNode;
  /** 한 열 모양 — 줄 단추가 펼침 단추(aria-expanded)가 되고, 펼친 줄은 단추 바로 아래에 `detail` 을 그린다. */
  inline?: boolean;
  detail?: ReactNode;
}) {
  const tab = verdictTabOf(item);
  // 안 맞음 줄은 목록에 못 들어오지만(`oneListViewOf`·`flattenFundingItems`), 어떻게든 들어와도 그리지 않는다.
  if (!tab) return null;
  const group = groupTagOf(item);
  const dday = ddayBadgeOf(item);
  const verdict = VERDICT_TAG[tab];
  return (
    // 판정 피드백(랩)은 줄 **안** 아래에 붙인다 — 단추 안에 또 단추를 넣을 수 없어 단추와 형제로 둔다.
    <div
      data-row-wrap={item.id}
      className={`rounded-[14px] border border-l-4 transition-colors ${ROW_BAND[tab]} ${
        selected ? "border-wedly-accent bg-wedly-bg-gray" : "border-transparent hover:bg-wedly-bg-gray"
      }`}
    >
      <button
        type="button"
        data-row={item.id}
        aria-current={!inline && selected ? "true" : undefined}
        aria-expanded={inline ? selected : undefined}
        onClick={() => onSelect(item.id)}
        className="block w-full rounded-[14px] px-3 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-wedly-accent"
      >
        <span className="mb-1 flex flex-wrap items-center gap-1.5">
          {showSource && (
            <span className="max-w-[10rem] truncate rounded-full border border-wedly-bd bg-white px-2 py-0.5 text-wedly-hint text-wedly-t1">
              {sourceNameOf(item)}
            </span>
          )}
          {/* 같은 공고가 여러 줄로 수집된 묶음 — 이름표가 잘려도 건수는 보이게 따로 둔다. 관리자만. */}
          {showSource && (item.groupCount ?? 0) >= 2 && (
            <span data-group-count className="shrink-0 text-wedly-hint tabular-nums text-wedly-t2">
              외 {(item.groupCount ?? 0) - 1}건
            </span>
          )}
          <span className="rounded-md bg-wedly-bg-gray px-1.5 py-0.5 text-wedly-hint font-bold text-wedly-t2">
            {kindTagOf(item)}
          </span>
          <span className="inline-flex items-center gap-1 text-wedly-hint text-wedly-t2">
            {group.tone && <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${GROUP_TONE_TILE[group.tone].dot}`} />}
            {group.label}
          </span>
          <span className={`ml-auto rounded-full px-2 py-0.5 text-wedly-hint font-semibold ${verdict.className}`}>
            {verdict.label}
          </span>
        </span>
        <span className="line-clamp-2 block break-keep text-wedly-sub font-bold text-wedly-t1">{item.title}</span>
        <span className="mt-1 flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-wedly-hint text-wedly-t2">{lineTextOf(item)}</span>
          {dday && (
            <span
              className={`shrink-0 text-wedly-hint font-semibold tabular-nums ${dday.hot ? "text-wedly-red-ink" : "text-wedly-t2"}`}
            >
              {dday.text}
            </span>
          )}
        </span>
      </button>
      {inline && selected && (
        <div data-area="row-detail" className="min-w-0 border-t border-wedly-bd px-3 pb-3 pt-3">
          {detail}
        </div>
      )}
      {footer && <div className="px-3 pb-3">{footer}</div>}
    </div>
  );
}


/** 두 칸 아래 남길 틈(px) — 화면 바닥에 칸이 딱 붙지 않게. 칸 아래 앱 여백이 이보다 크면 그 여백(최대 48)을 쓴다. */
const PANE_BOTTOM_GAP = 16;
const PANE_BOTTOM_GAP_MAX = 48;

/** 가장 가까운 세로 스크롤 조상. 없으면 null(= 창 자체가 스크롤한다). */
function scrollParentOf(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY;
    if ((oy === "auto" || oy === "scroll") && p.scrollHeight > p.clientHeight) return p;
  }
  return null;
}

/**
 * 두 칸의 위쪽 높이(`--pm-top`)를 실제로 재서 넣는다 — 앱마다 머리 띠·여백이 달라 고정값(280px)으로는
 * 칸이 화면 아래로 넘쳐 페이지가 한 번 더 스크롤됐다. 스크롤을 맨 위로 올렸을 때의 칸 위치 + 바닥 틈.
 * 위쪽 내용(안내 상자 등)이 생기거나 창 크기가 바뀌면 다시 잰다.
 * 한 열 모양(inline)은 두 칸 상자를 안 그려 ref 가 비어 있으므로 아무것도 재지 않는다.
 */
function usePaneTop(ref: { current: HTMLElement | null }) {
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof window === "undefined") return;
    const measure = () => {
      const parent = scrollParentOf(el);
      const rect = el.getBoundingClientRect();
      // 스크롤을 맨 위로 올렸을 때 화면 위에서 칸까지의 거리, 그리고 칸 아래에 남은 앱 여백.
      const scrolled = parent ? parent.scrollTop : window.scrollY;
      const top = rect.top + scrolled;
      const total = parent ? parent.scrollHeight : document.documentElement.scrollHeight;
      const originTop = parent ? parent.getBoundingClientRect().top : 0;
      const below = total - (rect.bottom - originTop + scrolled);
      const gap = Math.min(PANE_BOTTOM_GAP_MAX, Math.max(PANE_BOTTOM_GAP, below));
      el.style.setProperty("--pm-top", `${Math.max(0, Math.round(top + gap))}px`);
    };
    measure();
    window.addEventListener("resize", measure);
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    if (ro && el.parentElement) ro.observe(el.parentElement);
    return () => {
      window.removeEventListener("resize", measure);
      ro?.disconnect();
    };
  }, [ref]);
}

export interface ResultOneListViewProps {
  /**
   * 출처(수집원) 이름표와 「같은 공고 N건(수집원별)」을 그릴지 — 수집원 자료는 관리자만 본다
   * (2026-10-07 사장님 결정, 10/5 「수집원 현황」과 같은 기준). 기본 false: 앱이 관리자에게만 켠다.
   */
  showSources?: boolean;
  /** 모양 — "split"(기본, 목록 칸 + 상세 칸) · "inline"(좁은 자리, 한 열 + 줄 아래로 펼침). */
  layout?: ResultOneListLayout;
  /** 평평하게 편 자료. 아직 못 받았으면 null(불러오는 중 뼈대 · 오류 상자). */
  items: FundingItem[] | null;
  /** 서버가 자르기 전에 센 판정별 개수 — 탭·칩 숫자와 「앞쪽 N건만」 안내에 쓴다. 없으면 받은 줄로 센다. */
  serverCounts?: ServerVerdictCounts | null;
  state: OneListState;
  /** 찾기 칸에 보이는 글 · 거르기에 쓰는(서버에 물은) 글 — 입력이 멈춘 뒤 따라간다. */
  query: string;
  askedQuery: string;
  /**
   * 찾기가 서버에 다시 물어 나머지 공고까지 찾아 주는가 — 기본 true. false 면 받아 둔 줄 안에서만 찾으므로
   * 「앞쪽 N건만 불러왔어요」 안내가 「찾으면 나머지도 찾아져요」를 말하지 않는다.
   */
  searchReachesAll?: boolean;
  loading: boolean;
  error: string;
  /** 폼이 센 모름 칸 수. 모르면 null. */
  unknownCount: number | null;
  onRetry: () => void;
  onTab: (tab: ListTab) => void;
  onChip: (chip: ChipKey) => void;
  onQuery: (q: string) => void;
  onSort: (sort: OneListSort) => void;
  onPage: (page: number) => void;
  /** 줄을 눌렀다 — 한 열 모양은 이미 펼친 줄을 누르면 빈 id 로 부른다(접기). */
  onSelect: (id: string) => void;
  /** 「그 칸 채우기」 — 없으면 안내 문장만 보이고 단추는 숨긴다. */
  onFill?: () => void;
  /** 빈 상태의 「← 회사 정보 고치기」 — 없으면 단추를 숨긴다. */
  onEdit?: () => void;
  /** 줄 안에 끼울 판정 피드백(랩만, place:"card"). 공고 줄에만 그린다(`cardFooterOf`). */
  renderRowFooter?: (item: FundingItem) => ReactNode;
  /** 상세 본문 — 고른 항목을 받아 그린다. 두 칸은 오른쪽 칸에, 한 열은 줄 바로 아래에 그린다. */
  renderDetail: (item: FundingItem) => ReactNode;
}

export function ResultOneListView({
  items, serverCounts = null, state, query, askedQuery, loading, error, unknownCount,
  onRetry, onTab, onChip, onQuery, onSort, onPage, onSelect, onFill, onEdit, renderRowFooter, renderDetail, showSources = false,
  layout = "split", searchReachesAll = true,
}: ResultOneListViewProps) {
  const inline = layout === "inline";
  const hasData = items !== null;
  const view = oneListViewOf(items ?? [], state, askedQuery, serverCounts, { autoSelect: !inline });
  const twoPaneRef = useRef<HTMLDivElement | null>(null);
  usePaneTop(twoPaneRef);
  const notice = hasData
    ? unknownNoticeOf({ unverifiedCount: view.counts.unverified, unknownFieldCount: unknownCount })
    : null;
  // 한 열 모양: 펼친 줄을 다시 누르면 접는다(빈 id = 고른 줄 없음). 두 칸 모양은 그냥 고른다.
  const pickRow = inline ? (id: string) => onSelect(toggleSelectedId(view.selected?.id ?? "", id)) : onSelect;

  // ── 두 모양이 같이 쓰는 조각 ─────────────────────────────────────────
  const tabButtons = VERDICT_TABS.map((t) => {
    const on = view.tab === t.key;
    return (
      <button
        key={t.key}
        type="button"
        data-tab={t.key}
        aria-pressed={on}
        onClick={() => onTab(t.key)}
        className={`${TAB_BASE} ${on ? TAB_ON[t.key] : TAB_OFF}`}
      >
        <span aria-hidden="true" className={`mr-2 h-2 w-2 shrink-0 rounded-full ${TAB_DOT[t.key]}`} />
        {t.label}
        <em className="ml-1.5 font-semibold not-italic tabular-nums">
          {hasData ? view.counts[t.key].toLocaleString("ko-KR") : "—"}
        </em>
      </button>
    );
  });
  const searchInput = (className: string) => (
    <input
      value={query}
      onChange={(e) => onQuery(e.target.value)}
      placeholder="공고 이름으로 찾기 (두 탭 전체)"
      aria-label="공고 찾기"
      maxLength={FUNDING_QUERY_MAX}
      className={className}
    />
  );
  const sortSelect = (
    <CustomSelect
      id="result-one-list-sort"
      aria-label="정렬"
      value={state.sort}
      onChange={(v) => onSort(v === "score" ? "score" : "deadline")}
      options={ONE_LIST_SORTS.map((o) => ({ value: o.value, label: o.label }))}
      className="w-40"
      controlClassName="h-9 text-wedly-sub"
    />
  );

  /** 목록 본문 — 잘림 안내 · 오류 · 뼈대 · 빈 상태 · 줄들. */
  const listBody = (
    <>
      {hasData && view.cut && (
        <p data-area="list-cut-notice" className="mx-1 mb-2 rounded-lg bg-wedly-bg-gray px-3 py-2 text-wedly-hint text-wedly-t2">
          {cutNoticeOf(view.cut, searchReachesAll)}
        </p>
      )}
      {error && hasData && (
        // 옛 자료가 남아 있어도 새로 받기가 실패한 것은 알린다 — 안 알리면 낡은 목록을 최신으로 오해한다.
        <div
          role="alert"
          data-error-band="stale"
          className="mb-2 rounded-xl border border-wedly-bd bg-wedly-bg-yellow px-3 py-2 text-wedly-sub text-wedly-t1"
        >
          {staleErrorText(error)} — 아래는 이전에 받은 목록이에요{" "}
          <button type="button" className="underline" onClick={onRetry}>
            다시 시도
          </button>
        </div>
      )}

      {!hasData && error && (
        <div className="rounded-xl border border-wedly-bd bg-wedly-bg-gray px-4 py-3 text-wedly-sub text-wedly-t2">
          {error}{" "}
          <button type="button" className="underline" onClick={onRetry}>
            다시 시도
          </button>
        </div>
      )}

      {!hasData && !error && (
        <div data-area="result-skeleton" aria-busy="true" className="space-y-2">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} variant="block" className="h-24" />
          ))}
        </div>
      )}

      {hasData && view.pageItems.length === 0 && (
        <div data-area="result-empty" className="px-4 py-10 text-center">
          <div className="text-wedly-sub font-semibold text-wedly-t1">조건에 맞는 공고가 없어요</div>
          <div className="mt-1 text-wedly-hint text-wedly-t2">
            {askedQuery.trim()
              ? "찾는 말을 줄이거나 바꿔 보세요. 다른 탭에 있을 수도 있어요."
              : "다른 탭이나 돈의 성격 칩을 눌러 보거나, 회사 정보를 고쳐 보세요."}
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
            {view.otherTabs.map((o) => (
              <button key={o.tab} type="button" onClick={() => onTab(o.tab)} className={BTN_SMALL}>
                {`다른 탭에 ${o.count}건 있어요`}
                <span className="ml-1.5 font-normal text-wedly-t2">{o.label}</span>
              </button>
            ))}
            {onEdit && (
              <button type="button" onClick={onEdit} className={BTN_SMALL}>
                ← 회사 정보 고치기
              </button>
            )}
          </div>
        </div>
      )}

      {view.pageItems.map((it) => (
        <OneListRow
          key={it.id}
          item={it}
          selected={view.selected?.id === it.id}
          onSelect={pickRow}
          showSource={showSources}
          footer={cardFooterOf(it, renderRowFooter)}
          inline={inline}
          detail={inline && view.selected?.id === it.id ? renderDetail(it) : null}
        />
      ))}
    </>
  );

  /** 쪽 넘김 — 칸 아래 고정 줄. 탭·칩·찾기·정렬이 바뀌면 1쪽으로 돌아간다(상태 바뀜 규칙). */
  const pager = (
    <div
      data-area="result-pager"
      className="flex shrink-0 items-center justify-center gap-2 border-t border-wedly-bd bg-white p-2"
    >
      <button type="button" disabled={view.page <= 1} onClick={() => onPage(view.page - 1)} className={BTN_SMALL}>
        이전
      </button>
      <span className="text-wedly-hint tabular-nums text-wedly-t2">
        {`${view.page} / ${view.pageCount}`}
      </span>
      <button
        type="button"
        disabled={view.page >= view.pageCount}
        onClick={() => onPage(view.page + 1)}
        className={BTN_SMALL}
      >
        다음
      </button>
    </div>
  );

  return (
    <div
      data-area="result-one-list"
      data-layout={layout}
      className={inline ? "min-w-0 space-y-3" : "space-y-3"}
      aria-busy={loading}
    >
      {/* 도구줄 — 판정 탭(찾기어가 있으면 숫자는 찾기 결과 개수) · 찾기(두 탭 전체) · 정렬.
          한 열 모양은 좁아서 탭 한 줄 → 찾기 칸(전체 폭) → 정렬 순으로 쌓고, 380~460px 에서도 가로로 넘치지 않게 min-w-0·줄바꿈을 둔다. */}
      {inline ? (
        <div data-area="verdict-tabs" className="flex min-w-0 flex-col gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">{tabButtons}</div>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {searchInput(`${FIELD} min-w-0 flex-1 basis-48`)}
            {sortSelect}
          </div>
        </div>
      ) : (
        <div data-area="verdict-tabs" className="flex flex-wrap items-center gap-2">
          {tabButtons}
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {searchInput(`${FIELD} w-56 max-w-full`)}
            {sortSelect}
          </div>
        </div>
      )}

      {/* 돈의 성격 칩 — 숫자는 지금 탭 안 개수. 0건 칩은 흐리고 누를 수 없다. */}
      <div data-area="group-chips" className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-wedly-hint text-wedly-t2">돈의 성격</span>
        {view.chips.map((c) => {
          const zero = c.key !== "all" && c.count === 0;
          const on = view.chip === c.key;
          return (
            <button
              key={c.key}
              type="button"
              disabled={zero}
              data-chip={c.key}
              aria-pressed={on}
              onClick={() => onChip(c.key)}
              className={`${CHIP_BASE} ${zero ? CHIP_ZERO : on ? CHIP_ON : CHIP_OFF}`}
            >
              {c.tone && <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${GROUP_TONE_TILE[c.tone].dot}`} />}
              {c.label}
              <em className="font-medium not-italic tabular-nums">{hasData ? c.count.toLocaleString("ko-KR") : "—"}</em>
            </button>
          );
        })}
      </div>

      {notice && (
        <div
          data-area="unknown-notice"
          className="flex items-center gap-2.5 rounded-xl border border-wedly-bd bg-white px-3.5 py-2.5 shadow-sm"
        >
          <span
            aria-hidden="true"
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-wedly-gold font-bold text-wedly-navy"
          >
            !
          </span>
          <span className="min-w-0 flex-1 text-wedly-sub text-wedly-t1">
            <b className="font-semibold">{notice}</b>{" "}
            <span className="text-wedly-hint text-wedly-t2">채울수록 「확인 필요」가 줄어요.</span>
          </span>
          {onFill && (
            <button type="button" onClick={onFill} className={`${BTN_SMALL} shrink-0`}>
              그 칸 채우기
            </button>
          )}
        </div>
      )}

      {inline ? (
        // 한 열 — 두 칸 상자·높이 계산 없이 목록 하나. 상세는 줄 아래로 펼친다(`OneListRow`).
        <section
          data-area="result-list-pane"
          aria-label="결과 목록"
          className="min-w-0 overflow-hidden rounded-2xl border border-wedly-bd bg-white shadow-sm"
        >
          <div className={`min-w-0 space-y-1 p-2 ${loading ? "opacity-60" : ""}`}>{listBody}</div>
          {pager}
        </section>
      ) : (
        /* 두 칸 — 넓은 화면(>820px)은 같은 높이로 화면 아래까지(위치를 재지 않고 CSS 만으로), 좁은 화면은 위아래로 쌓고 높이 고정·안쪽 스크롤을 푼다.
           바깥 높이 = 100dvh − 위쪽 높이(--pm-top: `usePaneTop` 이 실제로 잰 칸 위치 + 바닥 틈, 재기 전 기본 280px) · 최소 400px. 각 칸은 flex 세로 · 본문 min-h-0 + 안쪽 스크롤 · 아래 줄 고정. */
        <div
          ref={twoPaneRef}
          data-area="result-two-pane"
          className="grid gap-4 min-[821px]:h-[calc(100dvh-var(--pm-top,280px))] min-[821px]:min-h-[400px] min-[821px]:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] min-[821px]:grid-rows-[minmax(0,1fr)]"
        >
          <section
            data-area="result-list-pane"
            aria-label="결과 목록"
            className="flex flex-col overflow-hidden rounded-2xl border border-wedly-bd bg-white shadow-sm min-[821px]:min-h-0"
          >
            <div
              className={`p-2 min-[821px]:min-h-0 min-[821px]:flex-1 min-[821px]:overflow-y-auto ${loading ? "opacity-60" : ""}`}
            >
              {listBody}
            </div>

            {pager}
          </section>

          <section
            data-area="result-detail-pane"
            aria-label="공고 상세"
            className="flex flex-col overflow-hidden rounded-2xl border border-wedly-bd bg-white shadow-sm min-[821px]:min-h-0"
          >
            {/* 바닥 여백은 두지 않는다 — 상세의 아래 고정 줄(sticky)이 칸 바닥에 붙게. 바닥 여백은 상세 쪽이 맡는다. */}
            <div className="px-4 pt-4 min-[821px]:min-h-0 min-[821px]:flex-1 min-[821px]:overflow-y-auto min-[821px]:px-6 min-[821px]:pt-6">
              {view.selected ? (
                renderDetail(view.selected)
              ) : (
                <div className="py-10 text-center text-wedly-sub text-wedly-muted">
                  {hasData ? "목록에서 공고를 고르면 여기에 상세가 열려요" : "목록을 불러오는 중이에요"}
                </div>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

interface Props {
  /**
   * 출처(수집원) 이름표와 「같은 공고 N건(수집원별)」을 그릴지 — 수집원 자료는 관리자만 본다
   * (2026-10-07 사장님 결정, 10/5 「수집원 현황」과 같은 기준). 기본 false: 앱이 관리자에게만 켠다.
   */
  showSources?: boolean;
  /** 모양 — 기본 "split"(두 칸). 통합 상세창처럼 좁은 자리는 "inline"(한 열, 줄 아래로 펼침). */
  layout?: ResultOneListLayout;
  /** fundingMap 응답. 아직 못 받았으면 null. */
  data: FundingMapPayload | null;
  loading: boolean;
  error: string;
  onRetry: () => void;
  query: string;
  /** 서버에 물은 찾기어 — 입력이 멈춘 뒤 따라간다. 이 글로 받아 둔 배열을 거른다. */
  askedQuery: string;
  onQuery: (q: string) => void;
  /** 찾기가 서버에 다시 묻는가(기본 true). 받아 둔 줄만 거르는 자리는 false — `ResultOneListViewProps.searchReachesAll`. */
  searchReachesAll?: boolean;
  unknownCount: number | null;
  onFill?: () => void;
  onEdit?: () => void;
  renderRowFooter?: (item: FundingItem) => ReactNode;
  renderDetail: (item: FundingItem) => ReactNode;
}

/**
 * 상태(탭·칩·정렬·쪽·고른 줄)를 쥐는 쪽. 진단 회차마다 새로 만든다(부모가 `key` 로) — 앞 회사의 탭·쪽이 남지 않게.
 * 눌림은 전부 `oneListReducer`(순수 함수)를 지난다 — 탭을 바꾸면 칩은 「전체」·쪽은 1쪽 같은 규칙이 한 자리에 있다.
 */
export default function ResultOneList({
  data, loading, error, onRetry, query, askedQuery, onQuery, unknownCount, onFill, onEdit, renderRowFooter, renderDetail, showSources = false,
  layout = "split", searchReachesAll = true,
}: Props) {
  const [state, dispatch] = useReducer(oneListReducer, INITIAL_ONE_LIST_STATE);
  const items = useMemo(() => (data ? flattenFundingItems(data) : null), [data]);
  const serverCounts = useMemo(() => serverCountsForQuery(data, askedQuery), [data, askedQuery]);

  // 처음 받은 자료로 기본 탭(지원 가능, 0건이면 확인 필요)을 못 박는다 — 이후 찾기로 숫자가 바뀌어도 탭이 저절로 움직이지 않는다.
  useEffect(() => {
    if (!items || state.tab !== null) return;
    dispatch({ type: "pinTab", tab: defaultVerdictTab(oneListViewOf(items, INITIAL_ONE_LIST_STATE, askedQuery, serverCounts).counts) });
  }, [items, serverCounts, state.tab, askedQuery]);

  // 찾기어가 바뀌면 1쪽으로.
  useEffect(() => {
    dispatch({ type: "query" });
  }, [askedQuery]);

  return (
    <ResultOneListView
      showSources={showSources}
      layout={layout}
      items={items}
      serverCounts={serverCounts}
      state={state}
      query={query}
      askedQuery={askedQuery}
      searchReachesAll={searchReachesAll}
      loading={loading}
      error={error}
      unknownCount={unknownCount}
      onRetry={onRetry}
      onTab={(tab) => dispatch({ type: "tab", tab })}
      onChip={(chip) => dispatch({ type: "chip", chip })}
      onQuery={onQuery}
      onSort={(sort) => dispatch({ type: "sort", sort })}
      onPage={(page) => dispatch({ type: "page", page })}
      onSelect={(id) => dispatch({ type: "select", id })}
      onFill={onFill}
      onEdit={onEdit}
      renderRowFooter={renderRowFooter}
      renderDetail={renderDetail}
    />
  );
}
