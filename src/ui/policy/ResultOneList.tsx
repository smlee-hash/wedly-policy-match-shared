"use client";

// ② 매칭 결과 본문 — 「목록 칸 + 상세 칸」 두 칸(승인 시안 「바꾼 뒤 ② 매칭 결과」).
// 위 도구줄(판정 탭 3개·찾기·정렬) · 돈의 성격 칩 · 모름 칸 안내, 그 아래 두 칸이다.
// 목록 자료는 fundingMap 응답 하나(`flattenFundingItems`) — 탭·칩·찾기·정렬·쪽 넘김은 전부 받아 둔 배열을 거르는 일이라
// 서버를 다시 부르지 않는다(서버에 다시 묻는 것은 찾기어가 바뀔 때뿐 — 부모가 한다).
// 거르는 규칙은 `result-one-list.ts`(순수 함수)에 있다. 이 파일은 그리기와, 눌림을 그 규칙에 잇는 일만 한다.
// `ResultOneListView` 는 상태를 밖에서 받아 그리기만 한다(그려서 잴 수 있다) · `ResultOneList` 가 상태를 쥔다.
import { useEffect, useMemo, useReducer, type ReactNode } from "react";
import { Skeleton } from "@wedly/ui-shared/ui";
import { FUNDING_QUERY_MAX, type FundingItem } from "../../funding/funding-map";
import CustomSelect from "../CustomSelect";
import { GROUP_TONE_TILE, cardFooterOf, type FundingMapPayload } from "../FundingMap";
import { staleErrorText } from "./ResultGroupList";
import {
  INITIAL_ONE_LIST_STATE, ONE_LIST_SORTS, VERDICT_TABS, ddayBadgeOf, defaultVerdictTab, flattenFundingItems,
  cutNoticeOf, groupTagOf, kindTagOf, lineTextOf, oneListReducer, oneListViewOf, searchItems, serverVerdictCountsOf, sourceNameOf, unknownNoticeOf,
  verdictCountsOf, verdictTabOf,
  type ChipKey, type OneListSort, type OneListState, type ServerVerdictCounts, type VerdictTab,
} from "./result-one-list";

const FIELD =
  "h-9 rounded-[10px] border border-wedly-bd bg-white px-3 text-wedly-sub text-wedly-t1 transition-colors " +
  "placeholder:text-wedly-muted focus:border-wedly-accent focus:outline-none focus:ring-2 focus:ring-wedly-accent/40";
const BTN_SMALL =
  "inline-flex h-8 items-center justify-center rounded-[10px] border border-wedly-bd bg-white px-4 text-wedly-hint " +
  "font-semibold text-wedly-t1 transition-colors hover:bg-wedly-bg-gray focus-visible:outline-none " +
  "focus-visible:ring-2 focus-visible:ring-wedly-accent focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";
const FOCUS_RING = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-wedly-accent focus-visible:ring-offset-2";

const TAB_BASE = `inline-flex h-9 items-center rounded-full border px-4 text-wedly-sub font-semibold transition-colors ${FOCUS_RING}`;
const TAB_ON = "border-wedly-t1 bg-wedly-t1 text-white";
const TAB_OFF = "border-wedly-bd bg-white text-wedly-t1 hover:bg-wedly-bg-gray";

const CHIP_BASE = `inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-wedly-hint font-semibold transition-colors ${FOCUS_RING}`;
const CHIP_ON = "border-wedly-accent bg-wedly-bg-blue text-wedly-accent-ink";
const CHIP_OFF = "border-wedly-bd bg-white text-wedly-t1 hover:bg-wedly-bg-gray";
/** 0건 칩 — 흐리게 두고 누를 수 없다(disabled). */
const CHIP_ZERO = "cursor-not-allowed border-wedly-bd bg-white text-wedly-t2 opacity-50";

/** 판정 이름표 — 목록 줄·탭과 같은 낱말, 색은 기존 판정 알약(`verdictPillOf`)과 같은 톤. */
const VERDICT_TAG: Record<VerdictTab, { label: string; className: string }> = {
  fit: { label: "지원 가능", className: "bg-wedly-bg-green text-wedly-green-ink" },
  unverified: { label: "확인 필요", className: "bg-wedly-bg-yellow text-wedly-t1" },
  excluded: { label: "어려움", className: "bg-wedly-bg-red text-wedly-red-ink" },
};

function OneListRow({ item, selected, onSelect, footer }: {
  item: FundingItem;
  selected: boolean;
  onSelect: (id: string) => void;
  footer: ReactNode;
}) {
  const group = groupTagOf(item);
  const dday = ddayBadgeOf(item);
  const verdict = VERDICT_TAG[verdictTabOf(item)];
  return (
    // 판정 피드백(랩)은 줄 **안** 아래에 붙인다 — 단추 안에 또 단추를 넣을 수 없어 단추와 형제로 둔다.
    <div
      data-row-wrap={item.id}
      className={`rounded-[14px] border transition-colors ${
        selected ? "border-wedly-accent bg-wedly-bg-gray" : "border-transparent hover:bg-wedly-bg-gray"
      }`}
    >
      <button
        type="button"
        data-row={item.id}
        aria-current={selected ? "true" : undefined}
        onClick={() => onSelect(item.id)}
        className="block w-full rounded-[14px] px-3 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-wedly-accent"
      >
        <span className="mb-1 flex flex-wrap items-center gap-1.5">
          <span className="max-w-[10rem] truncate rounded-full border border-wedly-bd bg-white px-2 py-0.5 text-wedly-hint text-wedly-t1">
            {sourceNameOf(item)}
          </span>
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
      {footer && <div className="px-3 pb-3">{footer}</div>}
    </div>
  );
}

export interface ResultOneListViewProps {
  /** 평평하게 편 자료. 아직 못 받았으면 null(불러오는 중 뼈대 · 오류 상자). */
  items: FundingItem[] | null;
  /** 서버가 자르기 전에 센 판정별 개수 — 탭·칩 숫자와 「앞쪽 N건만」 안내에 쓴다. 없으면 받은 줄로 센다. */
  serverCounts?: ServerVerdictCounts | null;
  state: OneListState;
  /** 찾기 칸에 보이는 글 · 거르기에 쓰는(서버에 물은) 글 — 입력이 멈춘 뒤 따라간다. */
  query: string;
  askedQuery: string;
  loading: boolean;
  error: string;
  /** 폼이 센 모름 칸 수. 모르면 null. */
  unknownCount: number | null;
  onRetry: () => void;
  onTab: (tab: VerdictTab) => void;
  onChip: (chip: ChipKey) => void;
  onQuery: (q: string) => void;
  onSort: (sort: OneListSort) => void;
  onPage: (page: number) => void;
  onSelect: (id: string) => void;
  /** 「그 칸 채우기」 — ① 로 돌아가 첫 빈 칸에 초점을 준다. */
  onFill: () => void;
  /** 빈 상태의 「← 회사 정보 고치기」. */
  onEdit: () => void;
  /** 줄 안에 끼울 판정 피드백(랩만, place:"card"). 공고 줄에만 그린다(`cardFooterOf`). */
  renderRowFooter?: (item: FundingItem) => ReactNode;
  /** 오른쪽 상세 칸 본문 — 고른 항목을 받아 그린다. */
  renderDetail: (item: FundingItem) => ReactNode;
}

export function ResultOneListView({
  items, serverCounts = null, state, query, askedQuery, loading, error, unknownCount,
  onRetry, onTab, onChip, onQuery, onSort, onPage, onSelect, onFill, onEdit, renderRowFooter, renderDetail,
}: ResultOneListViewProps) {
  const hasData = items !== null;
  const view = oneListViewOf(items ?? [], state, askedQuery, serverCounts);
  const notice = hasData
    ? unknownNoticeOf({ unverifiedCount: view.counts.unverified, unknownFieldCount: unknownCount })
    : null;

  return (
    <div data-area="result-one-list" className="space-y-3" aria-busy={loading}>
      {/* 도구줄 — 판정 탭(찾기어가 있으면 숫자는 찾기 결과 개수) · 찾기(세 탭 전체) · 정렬 */}
      <div data-area="verdict-tabs" className="flex flex-wrap items-center gap-2">
        {VERDICT_TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            aria-pressed={view.tab === t.key}
            onClick={() => onTab(t.key)}
            className={`${TAB_BASE} ${view.tab === t.key ? TAB_ON : TAB_OFF}`}
          >
            {t.label}
            <em className="ml-1.5 font-semibold not-italic tabular-nums">
              {hasData ? view.counts[t.key].toLocaleString("ko-KR") : "—"}
            </em>
          </button>
        ))}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <input
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder="공고 이름으로 찾기 (세 탭 전체)"
            aria-label="공고 찾기"
            maxLength={FUNDING_QUERY_MAX}
            className={`${FIELD} w-56 max-w-full`}
          />
          <CustomSelect
            id="result-one-list-sort"
            aria-label="정렬"
            value={state.sort}
            onChange={(v) => onSort(v === "score" ? "score" : "deadline")}
            options={ONE_LIST_SORTS.map((o) => ({ value: o.value, label: o.label }))}
            className="w-40"
            controlClassName="h-9 text-wedly-sub"
          />
        </div>
      </div>

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
          <button type="button" onClick={onFill} className={BTN_SMALL}>
            그 칸 채우기
          </button>
        </div>
      )}

      {/* 두 칸 — 넓은 화면(>820px)은 같은 높이로 화면 아래까지(위치를 재지 않고 CSS 만으로), 좁은 화면은 위아래로 쌓고 높이 고정·안쪽 스크롤을 푼다.
          바깥 높이 = 100dvh − 위쪽 높이(--pm-top, 기본 280px) · 최소 400px. 각 칸은 flex 세로 · 본문 min-h-0 + 안쪽 스크롤 · 아래 줄 고정. */}
      <div
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
            {hasData && view.cut && (
              <p data-area="list-cut-notice" className="mx-1 mb-2 rounded-lg bg-wedly-bg-gray px-3 py-2 text-wedly-hint text-wedly-t2">
                {cutNoticeOf(view.cut)}
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
                  <button type="button" onClick={onEdit} className={BTN_SMALL}>
                    ← 회사 정보 고치기
                  </button>
                </div>
              </div>
            )}

            {view.pageItems.map((it) => (
              <OneListRow
                key={it.id}
                item={it}
                selected={view.selected?.id === it.id}
                onSelect={onSelect}
                footer={cardFooterOf(it, renderRowFooter)}
              />
            ))}
          </div>

          {/* 쪽 넘김 — 칸 아래 고정 줄. 탭·칩·찾기·정렬이 바뀌면 1쪽으로 돌아간다(상태 바뀜 규칙). */}
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
        </section>

        <section
          data-area="result-detail-pane"
          aria-label="공고 상세"
          className="flex flex-col overflow-hidden rounded-2xl border border-wedly-bd bg-white shadow-sm min-[821px]:min-h-0"
        >
          <div className="p-4 min-[821px]:min-h-0 min-[821px]:flex-1 min-[821px]:overflow-y-auto min-[821px]:p-6">
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
    </div>
  );
}

interface Props {
  /** fundingMap 응답. 아직 못 받았으면 null. */
  data: FundingMapPayload | null;
  loading: boolean;
  error: string;
  onRetry: () => void;
  query: string;
  /** 서버에 물은 찾기어 — 입력이 멈춘 뒤 따라간다. 이 글로 받아 둔 배열을 거른다. */
  askedQuery: string;
  onQuery: (q: string) => void;
  unknownCount: number | null;
  onFill: () => void;
  onEdit: () => void;
  renderRowFooter?: (item: FundingItem) => ReactNode;
  renderDetail: (item: FundingItem) => ReactNode;
}

/**
 * 상태(탭·칩·정렬·쪽·고른 줄)를 쥐는 쪽. 진단 회차마다 새로 만든다(부모가 `key` 로) — 앞 회사의 탭·쪽이 남지 않게.
 * 눌림은 전부 `oneListReducer`(순수 함수)를 지난다 — 탭을 바꾸면 칩은 「전체」·쪽은 1쪽 같은 규칙이 한 자리에 있다.
 */
export default function ResultOneList({
  data, loading, error, onRetry, query, askedQuery, onQuery, unknownCount, onFill, onEdit, renderRowFooter, renderDetail,
}: Props) {
  const [state, dispatch] = useReducer(oneListReducer, INITIAL_ONE_LIST_STATE);
  const items = useMemo(() => (data ? flattenFundingItems(data) : null), [data]);
  const serverCounts = useMemo(() => serverVerdictCountsOf(data), [data]);

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
      items={items}
      serverCounts={serverCounts}
      state={state}
      query={query}
      askedQuery={askedQuery}
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
