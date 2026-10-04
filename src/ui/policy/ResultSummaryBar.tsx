"use client";

// 결과 위 한 묶음 — 요약 탭(누르면 그 조건으로 거른다) · 「모름 → 확인 필요」 띠 · 도구 줄.
// 상태는 전부 부모(PolicyMatchScreen)가 쥔다 — 이 부품은 그리기만 하고, 그래서 그려서 잴 수 있다.
import { SegmentedControl } from "@wedly/ui-shared/ui";
import { FUNDING_QUERY_MAX, type FundingSort } from "../../funding/funding-map";
import type { FundingMapPayload } from "../FundingMap";
import type { DiagnosedView } from "./PolicyMatchScreen";
import { SORT_CHOICES, summaryTabs, type SummaryTab } from "./result-conditions";

interface Props {
  /** 지도 자료 — 탭 건수의 출처. 아직 없으면 건수 자리는 「—」. */
  data: FundingMapPayload | null;
  tab: SummaryTab;
  onTab: (t: SummaryTab) => void;
  /** 왼쪽 회사 정보의 「모름」 칸 수. 없거나 0 이면 띠를 안 그린다. */
  unknownCount: number | null;
  /** 「확인 필요」 건수. 모르면 칸 수만 보인다. */
  reviewCount?: number;
  /** 「채우기」 — 왼쪽 첫 모름 칸으로 데려간다. */
  onFill: () => void;
  view: DiagnosedView;
  onView: (v: DiagnosedView) => void;
  query: string;
  onQuery: (q: string) => void;
  nowOnly: boolean;
  onNowOnly: (v: boolean) => void;
  sort: FundingSort;
  onSort: (s: FundingSort) => void;
}

const FIELD =
  "h-10 rounded-[10px] border border-wedly-bd bg-white px-4 text-sm text-wedly-t1 transition-colors " +
  "placeholder:text-wedly-muted focus:border-wedly-accent focus:outline-none focus:ring-2 focus:ring-wedly-accent/40";
const BTN_SMALL =
  "inline-flex h-8 items-center justify-center rounded-[10px] border border-wedly-bd bg-white px-4 text-xs " +
  "font-semibold text-wedly-t1 transition-colors hover:bg-wedly-bg-gray focus-visible:outline-none " +
  "focus-visible:ring-2 focus-visible:ring-wedly-accent focus-visible:ring-offset-2";
/** 노란 안내 상자 — 대비가 낮아 테두리를 함께 둔다(목록의 노란 띠와 같다). */
const BAND =
  "flex flex-wrap items-center gap-3 rounded-xl border border-[var(--wedly-gold)]/30 bg-wedly-bg-yellow px-4 py-2";

const TAB_BASE =
  "flex min-w-[7rem] flex-col items-start rounded-xl border px-4 py-2 text-left transition-colors " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-wedly-accent focus-visible:ring-offset-2";

export default function ResultSummaryBar({
  data, tab, onTab, unknownCount, reviewCount, onFill, view, onView, query, onQuery, nowOnly, onNowOnly, sort, onSort,
}: Props) {
  const tabs = summaryTabs(data);
  // 정렬 칸에 없는 값(지도 안 칩이 정한 이자 순 등)이면 첫 선택지처럼 보이지 않게 추천 쪽으로 둔다.
  const sortValue = SORT_CHOICES.some((c) => c.value === sort) ? sort : "rec";
  const showBand = unknownCount !== null && unknownCount > 0;

  return (
    <div className="space-y-4">
      <div data-area="summary-tabs" className="flex flex-wrap gap-2">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            aria-pressed={tab === t.key}
            onClick={() => onTab(t.key)}
            className={`${TAB_BASE} ${
              tab === t.key ? "border-wedly-accent bg-wedly-bg-blue" : "border-wedly-bd bg-white hover:bg-wedly-bg-gray"
            }`}
          >
            <span className="text-xs leading-[18px] text-wedly-muted">{t.label}</span>
            <span className="text-base font-semibold leading-6 tabular-nums text-wedly-t1">
              {t.count === null ? "—" : `${t.count.toLocaleString("ko-KR")}건`}
            </span>
          </button>
        ))}
      </div>

      {showBand && (
        <div data-area="unknown-band" className={BAND}>
          <span className="text-sm leading-[22px] tabular-nums text-wedly-t1">
            {reviewCount === undefined
              ? `모름 ${unknownCount}칸`
              : `모름 ${unknownCount}칸 → 확인 필요 ${reviewCount.toLocaleString("ko-KR")}건`}
          </span>
          <button type="button" onClick={onFill} className={BTN_SMALL}>
            채우기
          </button>
        </div>
      )}

      <div data-area="result-tools" className="flex flex-wrap items-center gap-2">
        <SegmentedControl
          options={[
            { value: "list", label: "목록" },
            { value: "map", label: "한눈에" },
          ]}
          value={view}
          onChange={(v) => onView(v === "map" ? "map" : "list")}
        />
        <input
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="공고명·기관·지원대상 검색"
          aria-label="공고 검색"
          maxLength={FUNDING_QUERY_MAX}
          className={`${FIELD} w-56 max-w-full`}
        />
        <label className="inline-flex items-center gap-2 text-sm leading-[22px] text-wedly-t2">
          <input type="checkbox" checked={nowOnly} onChange={(e) => onNowOnly(e.target.checked)} />
          지금 신청 가능한 것만
        </label>
        <select
          value={sortValue}
          onChange={(e) => onSort(e.target.value as FundingSort)}
          aria-label="정렬"
          className={`${FIELD} ml-auto`}
        >
          {SORT_CHOICES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
