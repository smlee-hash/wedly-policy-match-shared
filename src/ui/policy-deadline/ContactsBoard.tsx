"use client";

// 「연락 예정 업체」 탭 — 마감이 다가오는 맞음·확인 필요 공고가 있는 업체를 맞을 확률 순(높음 → 보통 → 낮음)으로 보인다.
// 단계 단추는 화면 안에서만 거르고(다시 읽지 않는다), 순서(맞을 확률 순·마감 순)는 서버가 정해서 바꾸면 다시 읽는다.
// 공고 조건을 아직 정리하지 않은 「판단 전」 업체는 목록 끝 접힌 묶음에 둔다. 접은 줄은 업체 하나당 가장 좋은 공고 한 줄과 근거 한 줄을 보인다.
// 목록과 캘린더 두 가지 보기(`view`)가 같은 거르기·같은 자료를 쓴다. 줄(칩)을 열면 그 업체의 공고를 읽고,
// 「업무 현황에 추가」하면 그 공고가 빠진다(「진행 중 포함」이면 「업무 현황에 있음」으로 남는다).
// 「해당 없음」으로 사유를 남기면 그 공고가 해당 없음 묶음으로 내려가고, 되돌리면 제자리로 돌아온다.
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Checkbox } from "@wedly/ui-shared/ui";
import type { CheckField, DeadlineTier } from "../../serve/policy-deadline/tier";
import type {
  CompanyAnnouncementRow,
  ContactCompanyRow,
  ContactsView,
  DaysFilter,
  DismissReason,
  ScopeFilter,
  SortOrder,
} from "../../serve/policy-deadline/types";
import ContactsCalendar from "./ContactsCalendar";
import { fetchCompanyAnnouncements, fetchContacts, postDismiss, postProgress } from "./deadline-api";
import { DDayBadge, DeadlineToast, KindButtons, KindChip, Seg, noticeMs, type DeadlineNotice } from "./DeadlineBits";
import { CompanyAnnouncementsPanel, type CompanyState } from "./DeadlineTables";
import { FoldGroup, SortSeg, TierBadge, TierFilter } from "./TierBits";
import { sectionCardClass } from "./classes";
import type { DeadlineEndpoints } from "./endpoints";
import {
  FREE_GRANT,
  OTHER_KINDS,
  POLICY_FUND,
  contactRowsFor,
  dDayLabel,
  progressToastText,
  rebuildContactRow,
  type ContactListRow,
} from "./deadline-view";
import {
  DEFAULT_TIERS,
  amountLabel,
  firstCheckText,
  hiddenHint,
  partitionContactRows,
  sortAnnouncementLines,
  unstructuredTitle,
} from "./tier-view";

const DAY_OPTIONS: { value: DaysFilter; label: string }[] = [
  { value: 7, label: "7일" },
  { value: 14, label: "14일" },
  { value: 30, label: "30일" },
];
const KIND_OPTIONS = [
  { value: "", label: "전체" },
  { value: POLICY_FUND, label: POLICY_FUND },
  { value: FREE_GRANT, label: FREE_GRANT },
  { value: OTHER_KINDS, label: "그 밖의 분야" },
];

/** 연락 예정 업체의 보기 — 목록 · 캘린더. */
export type ContactsBoardView = "list" | "calendar";

export interface ContactsBoardProps {
  /** 읽을 담당 범위(내 담당·전체). 없으면 서버(앱의 scopeOf)가 정한 범위로 읽는다 — 요청에 싣지도 않는다. */
  scope?: ScopeFilter;
  /** 값이 바뀌면 목록과 펼친 업체의 공고를 처음부터 다시 읽는다(업체 상세창에서 저장한 뒤). */
  revision?: number;
  /** 있으면 바깥이 종류 거르기를 쥔다(위쪽 카드와 함께 도는 화면). 빈 글자 = 전체. 없으면 자체 상태로 돈다. */
  kind?: string;
  /** kind 를 쥔 쪽이 받는다 — 종류 단추가 눌릴 때 부른다. */
  onKindChange?: (kind: string) => void;
  /**
   * 그 업체 상세를 연다 — 「업체 상세 열기」·확인할 것의 업체 항목·「업무 현황 보기」가 부른다. 없으면 이 단추들은 그리지 않는다.
   * 알림 「업무 현황 보기」에서는 방금 만든 업무 번호(`trackId`)도, 확인할 것의 업체 항목 이름에서는 채울 칸(`field`)도 넘긴다.
   */
  onDetail?: (customerKey: string, companyName: string, trackId?: string, field?: CheckField) => void;
  onProgressed?: () => void;
  /** 부를 주소 — 모듈 상수 하나로 넘긴다. */
  endpoints: DeadlineEndpoints;
  /** 보기 — 목록(기본)·캘린더. 거르기 줄과 읽은 자료는 두 보기가 같다(순서 단추만 목록에서만). */
  view?: ContactsBoardView;
  /** 업체 줄에 「담당」을 보인다. 기본 true — 자기 담당만 보는 화면은 끈다(어차피 전부 자기 업체라서). */
  showConsultant?: boolean;
  /** 캘린더의 「오늘」 — 시험에서 날짜를 고정할 때만 넘긴다. */
  now?: Date;
  /**
   * 펼친 공고 표(목록·캘린더 「고른 업체」)에 「업무 현황에 추가」·「해당 없음」 단추를 그린다. 기본 true — 업무 현황(정책 진행)을 만들 권한이
   * 없는 사람에게는 앱이 끈다(눌러도 권한 오류만 난다). 이미 넣은 공고의 「업무 현황에 있음」·남긴 「해당 없음」 기록은 꺼도 그대로 보인다.
   */
  canProgress?: boolean;
}

/**
 * 보이는 목록이 어느 거르기의 답인지 — 거르기를 바꾼 첫 화면부터 「불러오는 중」이다.
 * 효과 안에서 켜면 그 갱신이 다음 일감으로 밀려, 그 사이 옛 목록이 다 불러온 것처럼(aria-busy=false) 보인다.
 * 순서(sort)도 열쇠에 든다 — 순서를 바꾸면 목록과 펼친 업체를 다시 읽는다. 맞을 확률 단계 거르기는 화면 안에서만 거르므로 열쇠에 넣지 않는다.
 */
export function contactsListKey(
  scope: ScopeFilter | undefined,
  days: DaysFilter,
  includeUnstructured: boolean,
  includeProgress: boolean,
  revision: number,
  sort: SortOrder = "tier",
): string {
  return `${scope ?? "-"}|${days}|${includeUnstructured}|${includeProgress}|${revision}|${sort}`;
}

/**
 * 연락 예정 업체 목록 카드 — 맞을 확률 순 줄마다 가장 좋은 공고 한 줄과 근거 한 줄을 보이고, 펼치면 그 업체의 공고 표.
 * 「판단 전」 업체는 카드 안 끝 접힌 묶음(본 목록이 비면 처음부터 펼침). 상태는 갖지 않는다.
 */
export function ContactsList({
  main,
  unstructured,
  open,
  includeProgress,
  showConsultant,
  loading,
  onToggle,
  renderCompany,
}: {
  main: readonly ContactListRow[];
  unstructured: readonly ContactListRow[];
  open: ReadonlySet<string>;
  includeProgress: boolean;
  showConsultant: boolean;
  /** 거르기를 바꿔 다시 읽는 동안엔 앞 목록이 남아 있어, 새 목록이 왔는지 aria-busy 로 알린다. */
  loading: boolean;
  onToggle: (customerKey: string) => void;
  /** 펼친 업체의 안쪽(공고 표) — 캘린더 「고른 업체」와 같은 것을 넘긴다. */
  renderCompany: (row: ContactCompanyRow) => ReactNode;
}) {
  const line = ({ row, kinds, nearestDDay, best }: ContactListRow) => {
    const isOpen = open.has(row.customerKey);
    const amount = amountLabel(best.amountMaxWon);
    // 근거 · 다음 할 일 · 확인할 것 — 줄 전체가 단추라 확인할 것은 글만 둔다(펼치는 단추는 펼친 표 안에 있다).
    const reason = [best.tierReason, best.nextAction, firstCheckText(best)].filter((text) => text !== "").join(" · ");
    return (
      <div key={row.customerKey} className="border-b border-wedly-bd last:border-b-0">
        <button
          type="button"
          aria-expanded={isOpen}
          onClick={() => onToggle(row.customerKey)}
          className="grid w-full grid-cols-[56px_minmax(0,1fr)_16px] items-center gap-3 bg-white px-3.5 py-3 text-left transition-colors duration-200 hover:bg-wedly-bg-page focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-wedly-accent md:grid-cols-[64px_minmax(0,1fr)_auto_20px]"
        >
          <DDayBadge dDay={nearestDDay} />
          <span className="min-w-0">
            <span className="block break-keep text-wedly-section font-semibold text-wedly-navy">{row.companyName}</span>
            {showConsultant && (
              <span className="mt-0.5 block text-wedly-hint text-wedly-t2">
                담당 {row.consultant || <span className="text-wedly-red-ink">없음</span>}
              </span>
            )}
            <span className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1">
              <TierBadge tier={best.tier} unstructured={best.unstructured} />
              <span className="break-keep text-wedly-sub font-semibold text-wedly-t1">{best.title || "이름 없는 공고"}</span>
              <span className="text-wedly-hint text-wedly-t2">{dDayLabel(best.dDay)}</span>
              {amount && <span className="text-wedly-hint text-wedly-t2">{amount}</span>}
            </span>
            <span className="mt-0.5 block break-keep text-wedly-hint text-wedly-t2">{reason}</span>
          </span>
          <span className="col-start-2 flex flex-wrap gap-1.5 md:col-start-auto md:justify-end">
            {kinds.map((k) => (
              <KindChip key={k.category || "none"} category={k.category} count={k.count} />
            ))}
            {includeProgress && row.progressCount > 0 && (
              <span className="whitespace-nowrap rounded-full bg-wedly-bg-green px-2 text-wedly-hint font-semibold text-wedly-green-ink">진행 중 {row.progressCount}</span>
            )}
          </span>
          <span aria-hidden className={`col-start-3 row-start-1 text-wedly-hint text-wedly-muted transition-transform duration-150 md:col-start-auto md:row-start-auto ${isOpen ? "rotate-90" : ""}`}>▶</span>
        </button>
        {isOpen && <div className="border-t border-wedly-bd bg-wedly-bg-page px-3.5 pb-3.5 pt-2.5">{renderCompany(row)}</div>}
      </div>
    );
  };
  return (
    <div className={sectionCardClass("none")} aria-busy={loading}>
      {main.map(line)}
      {unstructured.length > 0 && (
        <FoldGroup key="unstructured" title={unstructuredTitle(unstructured.length, "업체")} defaultOpen={main.length === 0}>
          {unstructured.map(line)}
        </FoldGroup>
      )}
    </div>
  );
}

export default function ContactsBoard({
  scope,
  revision = 0,
  kind: controlledKind,
  onKindChange,
  onDetail,
  onProgressed,
  endpoints,
  view = "list",
  showConsultant = true,
  now,
  canProgress = true,
}: ContactsBoardProps) {
  const [days, setDays] = useState<DaysFilter>(14);
  const [ownKind, setOwnKind] = useState("");
  const kind = controlledKind ?? ownKind;
  const setKind = (next: string) => {
    if (controlledKind === undefined) setOwnKind(next);
    onKindChange?.(next);
  };
  // 기본은 서버 CONTACTS_INCLUDE_UNSTRUCTURED_DEFAULT(false)와 같다 — 위쪽 카드 숫자(요약)가 같은 기준으로 센다.
  const [includeUnstructured, setIncludeUnstructured] = useState(false);
  const [includeProgress, setIncludeProgress] = useState(false);
  const [sort, setSort] = useState<SortOrder>("tier");
  // 맞을 확률 단계 거르기 — 화면 안에서만 거른다(목록 열쇠에 넣지 않고 다시 읽지 않는다). 처음은 높음·보통.
  const [tiers, setTiers] = useState<DeadlineTier[]>(() => [...DEFAULT_TIERS]);
  const [data, setData] = useState<ContactsView | null>(null);
  const [error, setError] = useState("");
  const listKey = contactsListKey(scope, days, includeUnstructured, includeProgress, revision, sort);
  const [settledKey, setSettledKey] = useState("");
  const loading = settledKey !== listKey;
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  // 캘린더에서 고른 업체 — 목록의 펼친 줄과 같은 읽기 상태(companies)를 쓴다.
  const [pick, setPick] = useState<string | null>(null);
  const [companies, setCompanies] = useState<Record<string, CompanyState>>({});
  const [busyKey, setBusyKey] = useState("");
  const [notice, setNotice] = useState<DeadlineNotice | null>(null);
  const loaded = useRef<Record<string, CompanyState>>({});
  loaded.current = companies;
  const generation = useRef(0);
  // 주소 객체가 그리는 자리에서 새로 만들어져도 다시 읽지 않도록 읽기 주소 글자만 효과 값으로 쓴다.
  const readUrl = endpoints.read;

  // 거르기가 바뀌면 펼친 업체의 공고도 같은 거르기로 다시 읽는다 — 앞 거르기로 늦게 온 답은 버린다.
  useEffect(() => {
    generation.current += 1;
    setCompanies({});
    const controller = new AbortController();
    fetchContacts(endpoints, { scope, days, includeUnstructured, includeProgress, sort }, controller.signal)
      .then((next) => {
        setData(next);
        setError("");
      })
      .catch((e: unknown) => {
        if (controller.signal.aborted) return;
        setData(null);
        setError(e instanceof Error ? e.message : "연락 예정 업체를 불러오지 못했습니다.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setSettledKey(listKey);
      });
    return () => controller.abort();
  }, [scope, days, includeUnstructured, includeProgress, revision, sort, listKey, readUrl]);

  // 종류로 거르면 그 종류 안 가장 좋은 공고로 줄을 다시 세운다 — 순서는 서버가 정한 sort 를 따른다.
  const contactRows = data ? contactRowsFor(data.companies, kind, sort) : [];
  const { main, unstructured, hidden, counts } = partitionContactRows(contactRows, tiers);
  const hiddenText = hiddenHint(hidden, "업체");
  // 「해당 없음」은 업무 현황을 만들 수 있는 사람에게, 통로 주소가 있을 때만 — 없으면 단추는 그리지도 부르지도 않는다.
  const canDismiss = canProgress && !!endpoints.dismiss;

  const loadCompany = useCallback(
    (customerKey: string) => {
      const asked = generation.current;
      setCompanies((current) => ({ ...current, [customerKey]: { status: "loading" } }));
      fetchCompanyAnnouncements(endpoints, { customerKey, days, includeUnstructured, includeProgress, sort })
        .then((next) => {
          if (asked === generation.current) {
            setCompanies((current) => ({ ...current, [customerKey]: { status: "ok", rows: next.announcements, dismissed: next.dismissed } }));
          }
        })
        .catch((e: unknown) => {
          const message = e instanceof Error ? e.message : "공고를 불러오지 못했습니다.";
          if (asked === generation.current) setCompanies((current) => ({ ...current, [customerKey]: { status: "error", message } }));
        });
    },
    [days, includeUnstructured, includeProgress, sort, readUrl],
  );

  // 보이는 업체(목록은 펼친 줄·캘린더는 고른 칩)의 공고 중 아직 안 읽은 것을 읽는다.
  const wanted = view === "calendar" ? (pick ? [pick] : []) : [...open];
  useEffect(() => {
    for (const key of wanted) if (!loaded.current[key]) loadCompany(key);
  }, [wanted.join("\n"), companies, loadCompany]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), noticeMs(notice));
    return () => window.clearTimeout(timer);
  }, [notice]);

  const toggle = (customerKey: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(customerKey)) next.delete(customerKey);
      else next.add(customerKey);
      return next;
    });

  // 한 업체의 공고가 바뀐 뒤 — 읽어 둔 공고(rows·dismissed)를 갈아 끼우고, 업체 줄을 남은 공고로 다시 센다(없으면 그 업체가 목록에서 빠진다).
  const applyLines = (company: ContactCompanyRow, rows: CompanyAnnouncementRow[], dismissed: CompanyAnnouncementRow[]) => {
    setCompanies((current) => ({ ...current, [company.customerKey]: { status: "ok", rows, dismissed } }));
    const rebuilt = rebuildContactRow(company, rows);
    setData((current) =>
      current
        ? {
            companies: rebuilt
              ? current.companies.map((c) => (c.customerKey === company.customerKey ? rebuilt : c))
              : current.companies.filter((c) => c.customerKey !== company.customerKey),
          }
        : current,
    );
  };

  const progress = async (company: ContactCompanyRow, announcement: CompanyAnnouncementRow) => {
    const key = `${company.customerKey}|${announcement.bucketKey}`;
    if (busyKey) return;
    setBusyKey(key);
    try {
      const result = await postProgress(endpoints, company.customerKey, announcement.bucketKey);
      const state = loaded.current[company.customerKey];
      if (state?.status === "ok") {
        const done = { trackId: result.trackId, ...result.progress };
        const next = includeProgress
          ? state.rows.map((r) => (r.bucketKey === announcement.bucketKey ? { ...r, progress: done } : r))
          : state.rows.filter((r) => r.bucketKey !== announcement.bucketKey);
        applyLines(company, next, state.dismissed);
      }
      setNotice({ tone: "success", text: progressToastText(result), customerKey: company.customerKey, companyName: company.companyName, trackId: result.trackId });
      onProgressed?.();
    } catch (e) {
      setNotice({ tone: "error", text: e instanceof Error ? e.message : "업무 현황에 넣지 못했습니다." });
    } finally {
      setBusyKey("");
    }
  };

  // 「해당 없음」 남기기·되돌리기(reason 이 null) — 남기면 그 공고를 해당 없음 묶음(마감 순)으로, 되돌리면 지금 순서의 제자리로 옮긴다.
  const dismiss = async (company: ContactCompanyRow, announcement: CompanyAnnouncementRow, reason: DismissReason | null) => {
    const key = `${company.customerKey}|${announcement.bucketKey}`;
    if (busyKey) return;
    setBusyKey(key);
    try {
      const result = await postDismiss(endpoints, company.customerKey, announcement.bucketKey, reason);
      const state = loaded.current[company.customerKey];
      if (state?.status === "ok") {
        const moved = { ...announcement, dismissed: result.dismissed };
        const without = (lines: CompanyAnnouncementRow[]) => lines.filter((r) => r.bucketKey !== announcement.bucketKey);
        if (reason) applyLines(company, without(state.rows), sortAnnouncementLines([...without(state.dismissed), moved], "deadline"));
        else applyLines(company, sortAnnouncementLines([...without(state.rows), moved], sort), without(state.dismissed));
      }
      setNotice({
        tone: "success",
        text: reason ? `${company.companyName} · 「${reason}」 — 해당 없음으로 옮겼습니다` : `${company.companyName} · 해당 없음을 되돌렸습니다`,
      });
      // 오늘 연락할 곳 수가 바뀐다 — 위 카드를 다시 읽게 한다.
      onProgressed?.();
    } catch (e) {
      setNotice({ tone: "error", text: e instanceof Error ? e.message : "해당 없음으로 남기지 못했습니다." });
    } finally {
      setBusyKey("");
    }
  };

  // 펼친 업체의 안쪽 — 목록의 펼친 줄과 캘린더의 「고른 업체」가 같다. 업체 상세 열기는 상호 단추는 칸 없이, 확인할 것의 업체 항목은 그 칸과 함께 연다.
  const companyPanel = (company: ContactCompanyRow) => (
    <CompanyAnnouncementsPanel
      state={companies[company.customerKey]}
      kind={kind}
      customerKey={company.customerKey}
      busyKey={busyKey}
      tiers={tiers}
      canProgress={canProgress}
      onProgress={(a) => void progress(company, a)}
      onField={onDetail ? (field) => onDetail(company.customerKey, company.companyName, undefined, field) : undefined}
      onOpenCompany={onDetail ? () => onDetail(company.customerKey, company.companyName) : undefined}
      onDismiss={canDismiss ? (a, reason) => void dismiss(company, a, reason) : undefined}
      onRetry={() => loadCompany(company.customerKey)}
    />
  );

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-x-3.5 gap-y-2.5 rounded-xl border border-wedly-bd bg-white px-3.5 py-2.5" role="group" aria-label="거르기">
        <Seg label="마감" value={days} onChange={setDays} options={DAY_OPTIONS} />
        <KindButtons value={kind} onChange={setKind} options={KIND_OPTIONS} />
        <span className="inline-flex items-center gap-1.5">
          <span className="text-wedly-hint text-wedly-muted">맞을 확률</span>
          <TierFilter value={tiers} counts={counts} unit="곳" onChange={setTiers} />
        </span>
        {/* 캘린더는 업체가 날짜에 놓이니 순서가 없다. */}
        {view === "list" && <SortSeg value={sort} onChange={setSort} />}
        <Checkbox label="판단 전 포함" checked={includeUnstructured} onChange={(e) => setIncludeUnstructured(e.target.checked)} />
        <Checkbox label="진행 중 포함" checked={includeProgress} onChange={(e) => setIncludeProgress(e.target.checked)} />
      </div>
      {error && (
        <p role="alert" className="mb-3 rounded-lg border border-wedly-bd-red bg-wedly-bg-red px-3.5 py-2.5 text-wedly-sub text-wedly-red-ink">
          {error}
        </p>
      )}
      {loading && !data ? (
        <p className="py-6 text-wedly-sub text-wedly-muted" role="status">연락 예정 업체를 불러오고 있습니다.</p>
      ) : data && !main.length && !unstructured.length ? (
        <div className={sectionCardClass("lg", "text-center")} aria-busy={loading}>
          <p className="text-wedly-section font-semibold text-wedly-navy">연락할 업체가 없습니다</p>
          <p className="mt-1 text-wedly-sub text-wedly-t2">
            {hidden > 0
              ? `${hiddenText} — 「맞을 확률」에서 단계를 더 골라 보세요.`
              : includeUnstructured
                ? "마감 기간을 넓히거나 종류를 바꿔 보세요."
                : "마감 기간을 넓히거나 「판단 전 포함」을 켜 보세요."}
          </p>
        </div>
      ) : data && view === "calendar" ? (
        <div aria-busy={loading}>
          <ContactsCalendar
            rows={[...main, ...unstructured]}
            showConsultant={showConsultant}
            selectedKey={pick}
            onSelect={setPick}
            now={now}
            renderCompany={companyPanel}
          />
        </div>
      ) : data ? (
        <>
          <ContactsList
            main={main}
            unstructured={unstructured}
            open={open}
            includeProgress={includeProgress}
            showConsultant={showConsultant}
            loading={loading}
            onToggle={toggle}
            renderCompany={companyPanel}
          />
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
