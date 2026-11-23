"use client";

// 정책별 고객사 공고 목록 — 지원정책 매칭 「정책별 업체」 탭과 컨설팅 업무 현황 「정책별 고객사」 탭이 같은 부품을 쓴다.
// 목록은 공고별 업체 수만 받고, 줄을 펼칠 때 그 공고의 업체 표를 읽는다. 부를 주소는 `endpoints` 로 받는다.
import { useCallback, useEffect, useRef, useState } from "react";
import { Download } from "lucide-react";
import { Checkbox } from "@wedly/ui-shared/ui";
import CustomSelect from "../CustomSelect";
import type { CheckField, DeadlineTier } from "../../serve/policy-deadline/tier";
import type {
  AnnouncementListRow,
  AnnouncementListView,
  BucketCompaniesView,
  CompanyMatchRow,
  DaysFilter,
  DismissReason,
  ScopeFilter,
  SortOrder,
} from "../../serve/policy-deadline/types";
import { fetchAnnouncementList, fetchBucketCompanies, fetchExport, postDismiss, postProgress } from "./deadline-api";
import { DDayBadge, DeadlineToast, KindButtons, KindChip, Seg, noticeMs, type DeadlineNotice } from "./DeadlineBits";
import { CompanyTable } from "./DeadlineTables";
import { FoldGroup, SortSeg, TierFilter } from "./TierBits";
import { buttonClass, sectionCardClass } from "./classes";
import type { DeadlineEndpoints, DeadlineFeatures } from "./endpoints";
import {
  EXPORT_HEADERS,
  dateLabel,
  exportBody,
  filterAnnouncements,
  lastRunLabel,
  progressToastText,
  visibleCount,
} from "./deadline-view";
import {
  DEFAULT_TIERS,
  TIER_ORDER,
  dismissedTitle,
  hiddenHint,
  markProgressed,
  partitionAnnouncements,
  partitionLines,
  sortCompanyLines,
  tierCountLine,
  unstructuredTitle,
  type TierChipCounts,
} from "./tier-view";

const DAY_OPTIONS: { value: DaysFilter; label: string }[] = [
  { value: 7, label: "7일" },
  { value: 14, label: "14일" },
  { value: 30, label: "30일" },
  { value: "all", label: "전체" },
];
const FIELD = "h-8 rounded-lg border border-wedly-bd bg-white py-0 pl-2 pr-8 text-wedly-sub text-wedly-navy";
const FLASH_MS = 1600;
// 넓은 화면 공고 줄 격자 — 마감 · 공고 · 핵심 내용 · 대상 기업 · ▶. 머리줄이 같은 문자열을 쓴다(대상 기업 칸은 고정 폭이라 줄마다 칸 위치가 같다).
const ROW_GRID_MD = "md:grid-cols-[64px_minmax(0,1.2fr)_minmax(0,1fr)_132px_20px]";

export type BucketState = { status: "loading" } | { status: "error"; message: string } | { status: "ok"; view: BucketCompaniesView };

export interface AnnouncementBoardProps {
  /** 읽을 담당 범위(내 담당·전체). 없으면 서버(앱의 scopeOf)가 정한 범위로 읽는다 — 요청에 싣지도 않는다. */
  scope?: ScopeFilter;
  /** 있으면 거르기 줄에 「담당」 구간 단추를 그린다(지원정책 매칭). 없으면 화면 위 범위 단추를 따른다. */
  onScopeChange?: (scope: ScopeFilter) => void;
  canSeeAll?: boolean;
  defaultDays: DaysFilter;
  /** 있으면 바깥이 마감 거르기를 쥔다(위쪽 카드와 함께 도는 화면). 없으면 자체 상태로 돈다(지원정책 매칭). */
  days?: DaysFilter;
  /** days 를 쥔 쪽이 받는다 — 「마감」 구간 단추가 눌릴 때 부른다. */
  onDaysChange?: (days: DaysFilter) => void;
  /** 슬랙 「공고 보기」로 들어온 공고 — 마감 「전체」로 그 공고를 펼치고 그 줄로 옮겨 잠깐 강조한다. */
  initialBucket?: string;
  /** 값이 바뀌면 목록과 펼친 업체 표를 처음부터 다시 읽는다(업체 상세창에서 저장한 뒤). */
  revision?: number;
  /**
   * 그 업체 상세를 연다 — 상호명·확인할 것의 업체 항목·「업무 현황 보기」가 부른다. 없으면 상호명은 글자이고 「업무 현황 보기」도 그리지 않는다.
   * 알림 「업무 현황 보기」에서는 방금 만든 업무 번호(`trackId`)도, 확인할 것의 업체 항목 이름에서는 채울 칸(`field`)도 넘긴다.
   */
  onDetail?: (customerKey: string, companyName: string, trackId?: string, field?: CheckField) => void;
  onProgressed?: () => void;
  /** 부를 주소 — 모듈 상수 하나로 넘긴다(DEADLINE_ENDPOINTS 를 그대로 또는 `export` 를 더해). */
  endpoints: DeadlineEndpoints;
  /** 앱이 가진 기능 — `saveSheet` 가 없으면 「엑셀 내려받기」를 그리지 않는다. */
  features?: DeadlineFeatures;
  /** 업체 표에 「담당」 칸을 그린다. 기본 true — 자기 담당만 보는 화면은 끈다(어차피 전부 자기 업체라서). */
  showConsultant?: boolean;
  /**
   * 펼친 업체 표에 「업무 현황에 추가」 단추를 그린다. 기본 true — 업무 현황(정책 진행)을 만들 권한이 없는 사람에게는 앱이 끈다
   * (눌러도 권한 오류만 난다). 이미 넣은 업체의 「업무 현황에 있음」은 꺼도 그대로 보인다.
   */
  canProgress?: boolean;
}

function todayKst(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
}

/**
 * 보이는 목록이 어느 거르기의 답인지 — 거르기를 바꾼 첫 화면부터 「불러오는 중」이다(ContactsBoard 와 같은 까닭).
 * 효과 안에서 「불러오는 중」을 켜면 그 갱신이 다음 일감으로 밀려, 그 사이 옛 목록이 다 불러온 것처럼(aria-busy=false) 보인다.
 * 그래서 화면을 그릴 때 `settledKey !== announcementListKey(...)` 로 바로 셈한다.
 * 순서(sort)도 열쇠에 든다 — 순서를 바꾸면 목록을 다시 읽는다. 맞을 확률 단계 거르기는 화면 안에서만 거르므로 열쇠에 넣지 않는다.
 */
export function announcementListKey(
  scope: ScopeFilter | undefined,
  days: DaysFilter,
  hideEmpty: boolean,
  revision: number,
  sort: SortOrder = "tier",
): string {
  return `${scope ?? "-"}|${days}|${hideEmpty}|${revision}|${sort}`;
}

const sumCounts = (a: TierChipCounts, b: TierChipCounts): TierChipCounts => ({
  high: a.high + b.high,
  mid: a.mid + b.mid,
  low: a.low + b.low,
  unstructured: a.unstructured + b.unstructured,
});

/**
 * 공고 하나를 펼친 안쪽 — 읽는 중 · 오류(다시 불러오기) · 맞을 확률 순 업체 표 · 「원문 확인 필요」·「해당 없음」 접힌 묶음 · 안내 줄.
 * 지원 금액은 공고 줄(분야 딱지 옆)에 이미 있어 안쪽에 다시 그리지 않는다(2026-11-23).
 * 고른 단계(tiers)에 없는 업체는 숨기고 몇 곳인지만 알린다. 상태는 갖지 않는다.
 */
export function BucketPanel({
  state,
  fitOnly,
  tiers,
  url,
  bucketKey,
  busyKey,
  showConsultant = true,
  canProgress = true,
  onDetail,
  onProgress,
  onDismiss,
  onRetry,
}: {
  state: BucketState | undefined;
  fitOnly: boolean;
  /** 고른 맞을 확률 단계 — 이 밖의 단계 업체는 표에서 숨긴다. */
  tiers: readonly DeadlineTier[];
  /** 공고 원문 주소 — 없으면 「공고 원문 보기」 링크를 그리지 않는다. */
  url: string;
  bucketKey: string;
  busyKey: string;
  showConsultant?: boolean;
  canProgress?: boolean;
  onDetail?: (row: CompanyMatchRow, field?: CheckField) => void;
  onProgress: (row: CompanyMatchRow) => void;
  /** 없으면 「해당 없음」 단추를 그리지 않는다(남긴 기록은 그대로 보인다). */
  onDismiss?: (row: CompanyMatchRow, reason: DismissReason | null) => void;
  onRetry: () => void;
}) {
  const view = state?.status === "ok" ? state.view : null;
  // 서버가 맞을 확률 순으로 준 줄을 그대로 쓴다 — 「맞음만」이면 맞음 줄만.
  const rows = view ? (fitOnly ? view.rows.filter((r) => r.verdict === "fit") : view.rows) : [];
  const parts = partitionLines(rows, tiers);
  const hint = hiddenHint(parts.hidden, "업체");
  const table = (list: CompanyMatchRow[]) => (
    <div className="mt-2.5">
      <CompanyTable
        rows={list}
        busyKey={busyKey}
        bucketKey={bucketKey}
        showConsultant={showConsultant}
        canProgress={canProgress}
        onDetail={onDetail}
        onProgress={onProgress}
        onDismiss={onDismiss}
      />
    </div>
  );
  const sourceLink = url && <a href={url} target="_blank" rel="noopener noreferrer" className="text-wedly-accent-ink underline">공고 원문 보기</a>;
  return (
    <>
      {(!state || state.status === "loading") && <p className="py-3 text-wedly-sub text-wedly-muted" role="status">업체를 불러오고 있습니다.</p>}
      {state?.status === "error" && (
        <p className="flex flex-wrap items-center gap-2 py-3 text-wedly-sub text-wedly-red-ink" role="alert">
          {state.message}
          <button type="button" className={buttonClass("secondary", "xs")} onClick={onRetry}>다시 불러오기</button>
        </p>
      )}
      {view && (
        <>
          {parts.main.length > 0 && table(parts.main)}
          {hint && <p className="mt-2 text-wedly-hint text-wedly-t2">{hint}</p>}
          {parts.unstructured.length > 0 && (
            <div className="mt-2.5">
              <FoldGroup key="unstructured" title={unstructuredTitle(parts.unstructured.length, "업체")} defaultOpen={parts.main.length === 0}>
                {table(parts.unstructured)}
              </FoldGroup>
            </div>
          )}
          {parts.dismissed.length > 0 && (
            <div className="mt-2.5">
              <FoldGroup key="dismissed" title={dismissedTitle(parts.dismissed.length, "업체")}>
                {table(parts.dismissed)}
              </FoldGroup>
            </div>
          )}
          {rows.length === 0 && <p className="py-3 text-wedly-sub text-wedly-t2">지금 거르기 조건에서 맞는 업체가 없습니다.</p>}
        </>
      )}
      <p className="mt-2 text-wedly-hint text-wedly-muted">안 맞는 업체는 보이지 않습니다. {sourceLink}</p>
    </>
  );
}

export default function AnnouncementBoard({
  scope,
  onScopeChange,
  canSeeAll = false,
  defaultDays,
  days: controlledDays,
  onDaysChange,
  initialBucket,
  revision = 0,
  onDetail,
  onProgressed,
  endpoints,
  features,
  showConsultant = true,
  canProgress = true,
}: AnnouncementBoardProps) {
  const [ownDays, setOwnDays] = useState<DaysFilter>(initialBucket ? "all" : defaultDays);
  const days = controlledDays ?? ownDays;
  const setDays = (next: DaysFilter) => {
    if (controlledDays === undefined) setOwnDays(next);
    onDaysChange?.(next);
  };
  const [category, setCategory] = useState("");
  const [fitOnly, setFitOnly] = useState(false);
  const [hideEmpty, setHideEmpty] = useState(true);
  const [sort, setSort] = useState<SortOrder>("tier");
  // 맞을 확률 단계 거르기 — 화면 안에서만 거른다(목록·묶음을 다시 읽지 않고 엑셀에도 싣지 않는다). 슬랙으로 들어오면 그 공고가 보이게 모두 켠다.
  const [tiers, setTiers] = useState<DeadlineTier[]>(() => (initialBucket ? [...TIER_ORDER] : [...DEFAULT_TIERS]));
  const [list, setList] = useState<AnnouncementListView | null>(null);
  const [error, setError] = useState("");
  const listKey = announcementListKey(scope, days, hideEmpty, revision, sort);
  const [settledKey, setSettledKey] = useState("");
  const loading = settledKey !== listKey;
  const [open, setOpen] = useState<Set<string>>(() => new Set(initialBucket ? [initialBucket] : []));
  const [alwaysOpen, setAlwaysOpen] = useState(false);
  const [buckets, setBuckets] = useState<Record<string, BucketState>>({});
  const [busyKey, setBusyKey] = useState("");
  const [notice, setNotice] = useState<DeadlineNotice | null>(null);
  const [flash, setFlash] = useState("");
  const [exporting, setExporting] = useState(false);
  const pendingFlash = useRef(initialBucket ?? "");
  const loadedBuckets = useRef<Record<string, BucketState>>({});
  loadedBuckets.current = buckets;
  const generation = useRef(0);
  // 주소 객체가 그리는 자리에서 새로 만들어져도 다시 읽지 않도록 읽기 주소 글자만 효과 값으로 쓴다.
  const readUrl = endpoints.read;
  const saveSheet = endpoints.export ? features?.saveSheet : undefined;

  // 범위·새로고침이 바뀌면 펼친 업체 표를 처음부터 다시 읽는다 — 앞 범위로 늦게 온 답은 버린다.
  useEffect(() => {
    generation.current += 1;
    setBuckets({});
  }, [scope, revision, readUrl]);

  useEffect(() => {
    const controller = new AbortController();
    fetchAnnouncementList(endpoints, { scope, days, hideEmpty, sort }, controller.signal)
      .then((data) => {
        setList(data);
        setError("");
      })
      .catch((e: unknown) => {
        if (controller.signal.aborted) return;
        setError(e instanceof Error ? e.message : "공고를 불러오지 못했습니다.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setSettledKey(listKey);
      });
    return () => controller.abort();
  }, [scope, days, hideEmpty, sort, revision, listKey, readUrl]);

  const loadBucket = useCallback(
    (bucketKey: string) => {
      const asked = generation.current;
      setBuckets((current) => ({ ...current, [bucketKey]: { status: "loading" } }));
      fetchBucketCompanies(endpoints, { scope, bucketKey })
        .then((view) => {
          if (asked === generation.current) setBuckets((current) => ({ ...current, [bucketKey]: { status: "ok", view } }));
        })
        .catch((e: unknown) => {
          const message = e instanceof Error ? e.message : "업체를 불러오지 못했습니다.";
          if (asked === generation.current) setBuckets((current) => ({ ...current, [bucketKey]: { status: "error", message } }));
        });
    },
    [scope, readUrl],
  );

  // 펼친 줄 중 아직 안 읽은 공고를 읽는다(처음 펼칠 때·범위가 바뀐 뒤).
  useEffect(() => {
    for (const key of open) if (!loadedBuckets.current[key]) loadBucket(key);
  }, [open, buckets, loadBucket]);

  // 슬랙에서 들어온 공고 — 목록이 그려진 뒤 그 줄로 옮기고 잠깐 강조한다.
  useEffect(() => {
    const key = pendingFlash.current;
    if (!key || !list) return;
    pendingFlash.current = "";
    if (list.always.some((row) => row.bucketKey === key)) setAlwaysOpen(true);
    setFlash(key);
  }, [list]);

  useEffect(() => {
    if (!flash) return;
    // 상시 묶음을 여는 것과 같은 그리기 뒤에 돈다 — 그 줄이 이미 화면에 있다.
    document.getElementById(`pdl-${flash}`)?.scrollIntoView({ block: "center" });
    const timer = window.setTimeout(() => setFlash(""), FLASH_MS);
    return () => window.clearTimeout(timer);
  }, [flash]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), noticeMs(notice));
    return () => window.clearTimeout(timer);
  }, [notice]);

  const toggle = (bucketKey: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(bucketKey)) next.delete(bucketKey);
      else next.add(bucketKey);
      return next;
    });

  const progress = async (row: CompanyMatchRow, bucketKey: string) => {
    const key = `${row.customerKey}|${bucketKey}`;
    if (busyKey) return;
    setBusyKey(key);
    try {
      const result = await postProgress(endpoints, row.customerKey, bucketKey);
      const done = { trackId: result.trackId, ...result.progress };
      setBuckets((current) => {
        const state = current[bucketKey];
        if (state?.status !== "ok") return current;
        const mark = (rows: CompanyMatchRow[]) => rows.map((r) => (r.customerKey === row.customerKey ? markProgressed(r, done) : r));
        return {
          ...current,
          [bucketKey]: { status: "ok", view: { ...state.view, fit: mark(state.view.fit), unverified: mark(state.view.unverified), rows: mark(state.view.rows) } },
        };
      });
      setNotice({ tone: "success", text: progressToastText(result), customerKey: row.customerKey, companyName: row.companyName, trackId: result.trackId });
      onProgressed?.();
    } catch (e) {
      setNotice({ tone: "error", text: e instanceof Error ? e.message : "업무 현황에 넣지 못했습니다." });
    } finally {
      setBusyKey("");
    }
  };

  // 「해당 없음」 남기기·되돌리기(reason 이 null) — 줄은 그 자리에서 기록만 바꾸고, 맞을 확률 순으로 다시 세워 해당 없음 묶음으로 옮긴다.
  const dismiss = async (row: CompanyMatchRow, bucketKey: string, reason: DismissReason | null) => {
    const key = `${row.customerKey}|${bucketKey}`;
    if (busyKey) return;
    setBusyKey(key);
    try {
      const result = await postDismiss(endpoints, row.customerKey, bucketKey, reason);
      setBuckets((current) => {
        const state = current[bucketKey];
        if (state?.status !== "ok") return current;
        const mark = (rows: CompanyMatchRow[]) => rows.map((r) => (r.customerKey === row.customerKey ? { ...r, dismissed: result.dismissed } : r));
        return {
          ...current,
          [bucketKey]: {
            status: "ok",
            view: { ...state.view, fit: mark(state.view.fit), unverified: mark(state.view.unverified), rows: sortCompanyLines(mark(state.view.rows)) },
          },
        };
      });
      setNotice({
        tone: "success",
        text: reason ? `${row.companyName} · 「${reason}」 — 해당 없음으로 옮겼습니다` : `${row.companyName} · 해당 없음을 되돌렸습니다`,
      });
      // 오늘 연락할 곳 수가 바뀐다 — 위 카드를 다시 읽게 한다.
      onProgressed?.();
    } catch (e) {
      setNotice({ tone: "error", text: e instanceof Error ? e.message : "해당 없음으로 남기지 못했습니다." });
    } finally {
      setBusyKey("");
    }
  };

  const exportRows = async () => {
    if (!saveSheet) return;
    setExporting(true);
    try {
      const data = await fetchExport(endpoints, { scope, days, fitOnly, category, sort });
      await saveSheet({ fileName: `정책별고객사_${todayKst()}.xlsx`, sheetName: "정책별 고객사", headers: EXPORT_HEADERS, body: exportBody(data.rows) });
      if (data.truncated) setNotice({ tone: "success", text: `줄이 많아 앞 ${data.rows.length.toLocaleString("ko-KR")}줄만 담았습니다` });
    } catch (e) {
      setNotice({ tone: "error", text: e instanceof Error ? e.message : "엑셀 파일을 만들지 못했습니다." });
    } finally {
      setExporting(false);
    }
  };

  const filter = { category, fitOnly, hideEmpty };
  const datedParts = partitionAnnouncements(list ? filterAnnouncements(list.dated, filter) : [], tiers);
  const alwaysParts = partitionAnnouncements(list ? filterAnnouncements(list.always, filter) : [], tiers);
  const datedMain = datedParts.main;
  const alwaysMain = alwaysParts.main;
  // 원문 확인 필요 공고는 마감 있는 줄 먼저, 상시 줄 뒤로 한 묶음에 모은다. 숨긴 수·단추 숫자는 둘을 더한다.
  const unstructuredRows = [...datedParts.unstructured, ...alwaysParts.unstructured];
  const hidden = datedParts.hidden + alwaysParts.hidden;
  const counts = sumCounts(datedParts.counts, alwaysParts.counts);
  const hiddenText = hiddenHint(hidden, "공고");
  // 업체 상세 열기 — 상호명은 칸 없이, 확인할 것의 업체 항목은 그 칸과 함께 연다.
  const openCompany = onDetail
    ? (r: CompanyMatchRow, field?: CheckField) => {
        if (field) onDetail(r.customerKey, r.companyName, undefined, field);
        else onDetail(r.customerKey, r.companyName);
      }
    : undefined;

  const announcement = (row: AnnouncementListRow) => {
    const isOpen = open.has(row.bucketKey);
    const shown = visibleCount(row, fitOnly);
    const tierLine = tierCountLine(row.tiers, tiers);
    const state = buckets[row.bucketKey];
    return (
      <div key={row.bucketKey} id={`pdl-${row.bucketKey}`} className="border-b border-wedly-bd last:border-b-0">
        <button
          type="button"
          aria-expanded={isOpen}
          onClick={() => toggle(row.bucketKey)}
          className={`grid w-full grid-cols-[56px_minmax(0,1fr)_16px] items-center gap-3 px-3.5 py-3 text-left transition-colors duration-200 hover:bg-wedly-bg-page focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-wedly-accent ${ROW_GRID_MD} ${flash === row.bucketKey ? "bg-wedly-bg-yellow" : "bg-white"}`}
        >
          <DDayBadge dDay={row.dDay} />
          <span className="min-w-0">
            <span className="block break-keep text-wedly-section font-semibold text-wedly-navy">{row.title || "이름 없는 공고"}</span>
            <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-wedly-hint text-wedly-t2">
              {row.agency && <span>{row.agency}</span>}
              <KindChip category={row.category} />
              {/* 지원 금액 — 묶음 저장 때 지은 글(자금 지도 「얼마」 칸과 같은 규칙). 모르면 그리지 않는다(2026-11-23 대표 요청). */}
              {row.amountText && <span className="font-semibold text-wedly-t1">{row.amountText}</span>}
              <span>{row.applyEnd ? `마감 ${dateLabel(row.applyEnd)}` : "상시 모집"}</span>
            </span>
          </span>
          {row.summary ? (
            <span title={row.summary} className="col-start-2 line-clamp-2 min-w-0 break-keep text-wedly-sub text-wedly-t2 md:col-start-auto">{row.summary}</span>
          ) : (
            <span className="col-start-2 min-w-0 text-wedly-hint text-wedly-muted md:col-start-auto">아직 요약 전</span>
          )}
          {/* 업체 수는 딱지 하나 — 펼치면 나오는 업체 수(맞음 + 확인 필요, 「맞음만」이면 맞음만)(2026-11-16 대표 요청). 단계별 곳 수는 딱지 아래 한 줄이 알린다(고른 단계만, 「맞음만」이면 없음). */}
          <span className="col-start-2 flex flex-col items-start gap-1 md:col-start-auto md:items-end">
            {shown === 0 ? (
              <span className="whitespace-nowrap rounded-full bg-wedly-bg-gray px-2.5 py-0.5 text-wedly-hint text-wedly-t2">대상 기업 없음</span>
            ) : (
              <span className="whitespace-nowrap rounded-full bg-wedly-bg-gray px-2.5 py-0.5 text-wedly-hint font-semibold text-wedly-t1">대상 기업 {shown}곳</span>
            )}
            {!fitOnly && tierLine && <span className="break-keep text-wedly-hint text-wedly-t2 md:text-right">{tierLine}</span>}
          </span>
          <span aria-hidden className={`col-start-3 row-start-1 text-wedly-hint text-wedly-muted transition-transform duration-150 md:col-start-auto md:row-start-auto ${isOpen ? "rotate-90" : ""}`}>▶</span>
        </button>
        {isOpen && (
          <div className="border-t border-wedly-bd bg-wedly-bg-page px-3.5 pb-3.5 pt-1">
            <BucketPanel
              state={state}
              fitOnly={fitOnly}
              tiers={tiers}
              url={row.url}
              bucketKey={row.bucketKey}
              busyKey={busyKey}
              showConsultant={showConsultant}
              canProgress={canProgress}
              onDetail={openCompany}
              onProgress={(r) => void progress(r, row.bucketKey)}
              onDismiss={canProgress && endpoints.dismiss ? (r, reason) => void dismiss(r, row.bucketKey, reason) : undefined}
              onRetry={() => loadBucket(row.bucketKey)}
            />
          </div>
        )}
      </div>
    );
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <span className="text-wedly-sub text-wedly-t2">
          마지막 대조 <b className="font-semibold text-wedly-navy">{list ? lastRunLabel(list.lastRun) : "…"}</b>
          {list && ` · 계약 업체 ${list.companyCount.toLocaleString("ko-KR")}곳 × 모집 중 공고 ${list.bucketCount.toLocaleString("ko-KR")}건`} · 평일 아침마다 다시 대조합니다
        </span>
        {saveSheet && (
          <button type="button" className={buttonClass("secondary", "sm")} onClick={() => void exportRows()} disabled={exporting || !list}>
            <Download size={14} />엑셀 내려받기
          </button>
        )}
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-x-3.5 gap-y-2.5 rounded-xl border border-wedly-bd bg-white px-3.5 py-2.5" role="group" aria-label="거르기">
        <Seg label="마감" value={days} onChange={setDays} options={DAY_OPTIONS} />
        <span className="inline-flex items-center gap-1.5">
          <span className="text-wedly-hint text-wedly-muted">분야</span>
          <CustomSelect
            aria-label="분야"
            className="w-36"
            controlClassName={FIELD}
            value={category}
            onChange={setCategory}
            options={[{ value: "", label: "전체" }, ...(list?.categories ?? []).map((c) => ({ value: c, label: c }))]}
          />
        </span>
        <KindButtons value={category} onChange={setCategory} />
        {onScopeChange && scope !== undefined && (
          <Seg
            label="담당"
            value={scope}
            onChange={onScopeChange}
            options={[
              { value: "mine", label: "내 담당" },
              { value: "all", label: "전체", disabledReason: canSeeAll ? undefined : "관리자만 전체를 봅니다" },
            ]}
          />
        )}
        <span className="inline-flex items-center gap-1.5">
          <span className="text-wedly-hint text-wedly-muted">맞을 확률</span>
          <TierFilter value={tiers} counts={counts} unit="건" onChange={setTiers} />
        </span>
        <SortSeg value={sort} onChange={setSort} />
        <Checkbox label="맞음만" checked={fitOnly} onChange={(e) => setFitOnly(e.target.checked)} />
        <Checkbox label="0곳 숨기기" checked={hideEmpty} onChange={(e) => setHideEmpty(e.target.checked)} />
      </div>
      {error && (
        <p role="alert" className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-wedly-bd-red bg-wedly-bg-red px-3.5 py-2.5 text-wedly-sub text-wedly-red-ink">
          {error}
        </p>
      )}
      {loading && !list ? (
        <p className="py-6 text-wedly-sub text-wedly-muted" role="status">공고를 불러오고 있습니다.</p>
      ) : list && !datedMain.length && !alwaysMain.length && !unstructuredRows.length ? (
        <div className={sectionCardClass("lg", "text-center")} aria-busy={loading}>
          <p className="text-wedly-section font-semibold text-wedly-navy">조건에 맞는 공고가 없습니다</p>
          <p className="mt-1 text-wedly-sub text-wedly-t2">
            {hidden > 0 ? `${hiddenText} — 「맞을 확률」에서 단계를 더 골라 보세요.` : "마감 기간을 넓히거나 「0곳 숨기기」를 꺼 보세요."}
          </p>
        </div>
      ) : list ? (
        <>
          <div className={sectionCardClass("none")} aria-busy={loading}>
            {(datedMain.length > 0 || (alwaysOpen && alwaysMain.length > 0)) && (
              <div aria-hidden className={`hidden gap-3 border-b border-wedly-bd bg-wedly-bg-page px-3.5 py-2 text-wedly-hint text-wedly-muted md:grid ${ROW_GRID_MD}`}>
                <span>마감</span>
                <span>공고</span>
                <span>핵심 내용</span>
                <span className="text-right">대상 기업</span>
                <span />
              </div>
            )}
            {datedMain.map(announcement)}
            {alwaysMain.length > 0 && (
              <>
                <button
                  type="button"
                  aria-expanded={alwaysOpen}
                  onClick={() => setAlwaysOpen((v) => !v)}
                  className="flex w-full items-center gap-2 border-b border-wedly-bd bg-wedly-bg-gray px-3.5 py-2.5 text-left text-wedly-sub font-bold text-wedly-navy last:border-b-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-wedly-accent"
                >
                  <DDayBadge dDay={null} />
                  마감일이 없는 상시 모집 {alwaysMain.length}건
                  <span className="ml-auto font-normal text-wedly-t2">{alwaysOpen ? "접기" : "펼치기"}</span>
                </button>
                {alwaysOpen && alwaysMain.map(announcement)}
              </>
            )}
            {unstructuredRows.length > 0 && (
              <FoldGroup
                key="unstructured"
                title={unstructuredTitle(unstructuredRows.length, "공고")}
                defaultOpen={initialBucket !== undefined && unstructuredRows.some((r) => r.bucketKey === initialBucket)}
              >
                {unstructuredRows.map(announcement)}
              </FoldGroup>
            )}
          </div>
          {hiddenText && <p className="mt-2 text-wedly-hint text-wedly-t2">{hiddenText}</p>}
        </>
      ) : null}
      <DeadlineToast
        notice={notice}
        onOpen={
          onDetail
            ? (customerKey, companyName, trackId) => {
                setNotice(null);
                onDetail(customerKey, companyName, trackId);
              }
            : undefined
        }
      />
    </div>
  );
}
