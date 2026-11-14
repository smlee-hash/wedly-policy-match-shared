"use client";

// 「연락 예정 업체」 탭 — 마감이 다가오는 맞음·확인 필요 공고가 있는 업체를 가장 가까운 마감 순으로 보인다.
// 목록과 캘린더 두 가지 보기(`view`)가 같은 거르기·같은 자료를 쓴다. 줄(칩)을 열면 그 업체의 공고를 읽고,
// 「업무 현황에 추가」하면 그 공고가 빠진다(「진행 중 포함」이면 「업무 현황에 있음」으로 남는다).
import { useCallback, useEffect, useRef, useState } from "react";
import { Checkbox } from "@wedly/ui-shared/ui";
import type { CompanyAnnouncementRow, ContactCompanyRow, ContactsView, DaysFilter, ScopeFilter } from "../../serve/policy-deadline/types";
import ContactsCalendar from "./ContactsCalendar";
import { fetchCompanyAnnouncements, fetchContacts, postProgress } from "./deadline-api";
import { DDayBadge, DeadlineToast, KindButtons, KindChip, Seg, noticeMs, type DeadlineNotice } from "./DeadlineBits";
import { CompanyAnnouncementsPanel, type CompanyState } from "./DeadlineTables";
import { sectionCardClass } from "./classes";
import type { DeadlineEndpoints } from "./endpoints";
import {
  FREE_GRANT,
  OTHER_KINDS,
  POLICY_FUND,
  contactRowsFor,
  progressToastText,
  rebuildContactRow,
  type ContactListRow,
} from "./deadline-view";

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
  /** 그 업체 상세를 연다 — 「업무 현황 보기」가 부른다. 없으면 그 단추는 그리지 않는다. */
  onDetail?: (customerKey: string, companyName: string) => void;
  onProgressed?: () => void;
  /** 부를 주소 — 모듈 상수 하나로 넘긴다. */
  endpoints: DeadlineEndpoints;
  /** 보기 — 목록(기본)·캘린더. 거르기 줄과 읽은 자료는 두 보기가 같다. */
  view?: ContactsBoardView;
  /** 업체 줄에 「담당」을 보인다. 기본 true — 자기 담당만 보는 화면은 끈다(어차피 전부 자기 업체라서). */
  showConsultant?: boolean;
  /** 캘린더의 「오늘」 — 시험에서 날짜를 고정할 때만 넘긴다. */
  now?: Date;
}

/**
 * 보이는 목록이 어느 거르기의 답인지 — 거르기를 바꾼 첫 화면부터 「불러오는 중」이다.
 * 효과 안에서 켜면 그 갱신이 다음 일감으로 밀려, 그 사이 옛 목록이 다 불러온 것처럼(aria-busy=false) 보인다.
 */
export function contactsListKey(scope: ScopeFilter | undefined, days: DaysFilter, includeUnstructured: boolean, includeProgress: boolean, revision: number): string {
  return `${scope ?? "-"}|${days}|${includeUnstructured}|${includeProgress}|${revision}`;
}

/** 연락 예정 업체 목록 카드 — 줄마다 펼치면 그 업체의 공고 표. 상태는 갖지 않는다. */
export function ContactsList({
  rows,
  kind,
  open,
  companies,
  busyKey,
  includeProgress,
  showConsultant,
  loading,
  onToggle,
  onProgress,
  onRetry,
}: {
  rows: readonly ContactListRow[];
  kind: string;
  open: ReadonlySet<string>;
  companies: Record<string, CompanyState>;
  busyKey: string;
  includeProgress: boolean;
  showConsultant: boolean;
  /** 거르기를 바꿔 다시 읽는 동안엔 앞 목록이 남아 있어, 새 목록이 왔는지 aria-busy 로 알린다. */
  loading: boolean;
  onToggle: (customerKey: string) => void;
  onProgress: (company: ContactCompanyRow, announcement: CompanyAnnouncementRow) => void;
  onRetry: (customerKey: string) => void;
}) {
  return (
    <div className={sectionCardClass("none")} aria-busy={loading}>
      {rows.map(({ row, kinds, nearestDDay }) => {
        const isOpen = open.has(row.customerKey);
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
            {isOpen && (
              <div className="border-t border-wedly-bd bg-wedly-bg-page px-3.5 pb-3.5 pt-2.5">
                <CompanyAnnouncementsPanel
                  state={companies[row.customerKey]}
                  kind={kind}
                  customerKey={row.customerKey}
                  busyKey={busyKey}
                  onProgress={(a) => onProgress(row, a)}
                  onRetry={() => onRetry(row.customerKey)}
                />
              </div>
            )}
          </div>
        );
      })}
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
  const [data, setData] = useState<ContactsView | null>(null);
  const [error, setError] = useState("");
  const listKey = contactsListKey(scope, days, includeUnstructured, includeProgress, revision);
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
    fetchContacts(endpoints, { scope, days, includeUnstructured, includeProgress }, controller.signal)
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
  }, [scope, days, includeUnstructured, includeProgress, revision, listKey, readUrl]);

  const rows = data ? contactRowsFor(data.companies, kind) : [];

  const loadCompany = useCallback(
    (customerKey: string) => {
      const asked = generation.current;
      setCompanies((current) => ({ ...current, [customerKey]: { status: "loading" } }));
      fetchCompanyAnnouncements(endpoints, { customerKey, days, includeUnstructured, includeProgress })
        .then((next) => {
          if (asked === generation.current) setCompanies((current) => ({ ...current, [customerKey]: { status: "ok", rows: next.announcements } }));
        })
        .catch((e: unknown) => {
          const message = e instanceof Error ? e.message : "공고를 불러오지 못했습니다.";
          if (asked === generation.current) setCompanies((current) => ({ ...current, [customerKey]: { status: "error", message } }));
        });
    },
    [days, includeUnstructured, includeProgress, readUrl],
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
        setCompanies((current) => ({ ...current, [company.customerKey]: { status: "ok", rows: next } }));
        const rebuilt = rebuildContactRow(company, next);
        setData((current) =>
          current
            ? {
                companies: rebuilt
                  ? current.companies.map((c) => (c.customerKey === company.customerKey ? rebuilt : c))
                  : current.companies.filter((c) => c.customerKey !== company.customerKey),
              }
            : current,
        );
      }
      setNotice({ tone: "success", text: progressToastText(result), customerKey: company.customerKey, companyName: company.companyName });
      onProgressed?.();
    } catch (e) {
      setNotice({ tone: "error", text: e instanceof Error ? e.message : "업무 현황에 넣지 못했습니다." });
    } finally {
      setBusyKey("");
    }
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-x-3.5 gap-y-2.5 rounded-xl border border-wedly-bd bg-white px-3.5 py-2.5" role="group" aria-label="거르기">
        <Seg label="마감" value={days} onChange={setDays} options={DAY_OPTIONS} />
        <KindButtons value={kind} onChange={setKind} options={KIND_OPTIONS} />
        <Checkbox label="조건 정리 전 포함" checked={includeUnstructured} onChange={(e) => setIncludeUnstructured(e.target.checked)} />
        <Checkbox label="진행 중 포함" checked={includeProgress} onChange={(e) => setIncludeProgress(e.target.checked)} />
      </div>
      {error && (
        <p role="alert" className="mb-3 rounded-lg border border-wedly-bd-red bg-wedly-bg-red px-3.5 py-2.5 text-wedly-sub text-wedly-red-ink">
          {error}
        </p>
      )}
      {loading && !data ? (
        <p className="py-6 text-wedly-sub text-wedly-muted" role="status">연락 예정 업체를 불러오고 있습니다.</p>
      ) : data && !rows.length ? (
        <div className={sectionCardClass("lg", "text-center")} aria-busy={loading}>
          <p className="text-wedly-section font-semibold text-wedly-navy">연락할 업체가 없습니다</p>
          <p className="mt-1 text-wedly-sub text-wedly-t2">
            {includeUnstructured ? "마감 기간을 넓히거나 종류를 바꿔 보세요." : "마감 기간을 넓히거나 「조건 정리 전 포함」을 켜 보세요."}
          </p>
        </div>
      ) : data && view === "calendar" ? (
        <div aria-busy={loading}>
          <ContactsCalendar
            rows={rows}
            showConsultant={showConsultant}
            selectedKey={pick}
            onSelect={setPick}
            now={now}
            renderCompany={(company) => (
              <CompanyAnnouncementsPanel
                state={companies[company.customerKey]}
                kind={kind}
                customerKey={company.customerKey}
                busyKey={busyKey}
                onProgress={(a) => void progress(company, a)}
                onRetry={() => loadCompany(company.customerKey)}
              />
            )}
          />
        </div>
      ) : data ? (
        <ContactsList
          rows={rows}
          kind={kind}
          open={open}
          companies={companies}
          busyKey={busyKey}
          includeProgress={includeProgress}
          showConsultant={showConsultant}
          loading={loading}
          onToggle={toggle}
          onProgress={(company, a) => void progress(company, a)}
          onRetry={loadCompany}
        />
      ) : null}
      <DeadlineToast
        notice={notice}
        onOpen={
          onDetail
            ? (customerKey, companyName) => {
                setNotice(null);
                onDetail(customerKey, companyName);
              }
            : undefined
        }
      />
    </div>
  );
}
