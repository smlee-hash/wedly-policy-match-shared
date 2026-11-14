"use client";

// 정책별 고객사·연락 예정 화면 — ERP 와 컨설턴트 앱이 같은 화면을 쓴다.
// 위에서 아래로: 설명 한 줄 · 요약 카드 두 장 · 탭 둘(+ 오른쪽 「보기」「담당」) · 탭 안쪽 목록/캘린더.
// 화면 이름(제목)은 앱 위 띠가 그린다 — 이 화면은 본문에 제목을 그리지 않는다.
// 앱이 넘기는 것: 통로 주소(`endpoints`) · 담당 범위 단추(`scopeToggle`) · 업체 열기(`onOpenCompany`) · 엑셀 저장(`features`).
import { useEffect, useState } from "react";
import type { DaysFilter, ScopeFilter, SummaryView } from "../../serve/policy-deadline/types";
import AnnouncementBoard from "./AnnouncementBoard";
import ContactsBoard, { type ContactsBoardView } from "./ContactsBoard";
import { Seg } from "./DeadlineBits";
import SummaryCards, { type SummaryTab } from "./SummaryCards";
import { fetchSummary } from "./deadline-api";
import type { DeadlineEndpoints, DeadlineFeatures } from "./endpoints";
import {
  DEFAULT_DAYS,
  DEFAULT_SCREEN_STATE,
  completeSummary,
  descriptionLine,
  parseScreenSearch,
  screenSearch,
  type ScreenState,
} from "./screen-state";

/** 업체 하나를 가리키는 값 — 업체 열기·업무 현황 보기 연결이 받는다. */
export interface DeadlineCompanyRef {
  customerKey: string;
  companyName: string;
}

export interface PolicyCompaniesScreenProps {
  /** 부를 통로 주소 — 모듈 상수 하나로 넘긴다(`DEADLINE_ENDPOINTS` 를 그대로 또는 `export` 를 더해). */
  endpoints: DeadlineEndpoints;
  /** 켜면 「담당: 내 담당·전체」를 그리고 `scope` 를 보낸다(ERP). 꺼진 앱은 서버가 정한 범위로 읽는다. */
  scopeToggle?: boolean;
  /** `scopeToggle` 이 꺼진 앱에서 「담당」 칸·「모든 고객사」 설명을 보일지(컨설턴트 앱 최고 관리자). */
  seesAll?: boolean;
  /** 앱이 가진 기능 — `saveSheet`(엑셀 저장)가 없으면 「엑셀 내려받기」를 그리지 않는다. */
  features?: DeadlineFeatures;
  /** 업체명을 누르면 그 업체를 연다. 없으면 업체명은 글자다. */
  onOpenCompany?: (row: DeadlineCompanyRef) => void;
  /** 알림 「업무 현황 보기」를 누르면 부른다. 보통 `onOpenCompany` 와 같은 함수 — 둘 중 먼저 있는 쪽을 쓴다. */
  onViewProgress?: (row: DeadlineCompanyRef) => void;
  /** 캘린더의 「오늘」 — 시험에서 날짜를 고정할 때만. */
  now?: Date;
  /** 값이 바뀌면 지금 탭과 요약 카드를 다시 읽는다(업체 상세창에서 저장한 뒤 앱이 올린다). */
  revision?: number;
}

const TABS: { value: SummaryTab; label: string }[] = [
  { value: "companies", label: "정책별 고객사" },
  { value: "contacts", label: "연락 예정 업체" },
];

const VIEW_OPTIONS: { value: ContactsBoardView; label: string }[] = [
  { value: "list", label: "목록" },
  { value: "calendar", label: "캘린더" },
];

const SCOPE_OPTIONS: { value: ScopeFilter; label: string }[] = [
  { value: "mine", label: "내 담당" },
  { value: "all", label: "전체" },
];

const TAB_ID = (value: SummaryTab) => `pdl-tab-${value}`;
const PANEL_ID = "pdl-panel";

export default function PolicyCompaniesScreen({
  endpoints,
  scopeToggle = false,
  seesAll = false,
  features,
  onOpenCompany,
  onViewProgress,
  now,
  revision = 0,
}: PolicyCompaniesScreenProps) {
  const [state, setState] = useState<ScreenState>(DEFAULT_SCREEN_STATE);
  // 주소를 읽어 상태에 옮긴 뒤에 요약과 두 목록을 부른다 — 기본 값으로 먼저 불렀다 끊으면 서버가 그 요약을 끝까지 센다.
  const [urlApplied, setUrlApplied] = useState(false);
  const [days, setDays] = useState<DaysFilter>(DEFAULT_DAYS);
  const [kind, setKind] = useState("");
  const [summary, setSummary] = useState<SummaryView | null>(null);
  const [summaryTick, setSummaryTick] = useState(0);
  // 카드 줄을 누를 때마다 올려, 지금 탭의 목록을 처음 상태(접힘·거르기 초기값)로 다시 연다.
  const [boardKey, setBoardKey] = useState(0);
  // 주소 객체가 그리는 자리에서 새로 만들어져도 다시 읽지 않도록 읽기 주소 글자만 효과 값으로 쓴다.
  const readUrl = endpoints.read;
  const scope: ScopeFilter | undefined = scopeToggle ? state.scope : undefined;
  const showConsultant = scopeToggle ? state.scope === "all" : seesAll;
  const onDetail = onOpenCompany ?? onViewProgress;

  // 처음 한 번 — 주소(?tab=…&view=…&bucket=…&scope=…)를 화면 상태로 옮긴다.
  useEffect(() => {
    const parsed = parseScreenSearch(window.location.search, scopeToggle);
    setState(parsed);
    if (parsed.bucket) setDays("all");
    setUrlApplied(true);
  }, []);

  // 상태가 바뀌면 주소에 맞춘다 — Next 라우터에 묶이지 않게 replaceState 로(뒤로 가기 칸을 늘리지 않는다).
  useEffect(() => {
    if (!urlApplied) return;
    const next = screenSearch(state, scopeToggle, window.location.search);
    if (next !== window.location.search) {
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${next}${window.location.hash}`);
    }
  }, [urlApplied, state, scopeToggle]);

  // 요약 카드 숫자 — 범위·새로고침(revision)·「업무 현황에 추가」 뒤에 다시 읽는다. 앞 범위로 늦게 온 답은 버린다.
  useEffect(() => {
    if (!urlApplied) return;
    const controller = new AbortController();
    fetchSummary(endpoints, scope, controller.signal)
      .then((view) => setSummary(completeSummary(view)))
      .catch(() => {
        if (!controller.signal.aborted) setSummary(null);
      });
    return () => controller.abort();
  }, [urlApplied, scope, revision, summaryTick, readUrl]);

  const selectTab = (tab: SummaryTab) => setState((current) => ({ ...current, tab, bucket: "" }));
  const afterProgress = () => setSummaryTick((value) => value + 1);

  return (
    <div className="min-w-0">
      <p className="mb-3.5 text-wedly-sub text-wedly-t2">{descriptionLine(showConsultant)}</p>
      <SummaryCards
        summary={summary}
        tab={state.tab}
        days={days}
        kind={kind}
        onDays={(value) => {
          setDays(value);
          setState((current) => ({ ...current, tab: "companies", bucket: "" }));
          setBoardKey((count) => count + 1);
        }}
        onKind={(value) => {
          setKind(value);
          setState((current) => ({ ...current, tab: "contacts", bucket: "" }));
          setBoardKey((count) => count + 1);
        }}
      />
      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div role="tablist" aria-label="보는 화면" className="flex flex-wrap gap-2">
          {TABS.map(({ value, label }) => {
            const on = state.tab === value;
            return (
              <button
                key={value}
                id={TAB_ID(value)}
                type="button"
                role="tab"
                aria-selected={on}
                aria-controls={PANEL_ID}
                onClick={() => selectTab(value)}
                className={`whitespace-nowrap rounded-[10px] border px-4 py-1.5 text-wedly-sub font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-wedly-accent focus-visible:ring-offset-2 ${on ? "border-wedly-navy bg-wedly-navy text-white" : "border-wedly-bd bg-white text-wedly-navy hover:bg-wedly-bg-gray"}`}
              >
                {label}
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2">
          {state.tab === "contacts" && (
            <Seg label="보기" value={state.view} onChange={(view) => setState((current) => ({ ...current, view }))} options={VIEW_OPTIONS} />
          )}
          {scopeToggle && (
            <Seg
              label="담당"
              value={state.scope}
              onChange={(next) => {
                setSummary(null);
                setState((current) => ({ ...current, scope: next, bucket: "" }));
              }}
              options={SCOPE_OPTIONS}
            />
          )}
        </div>
      </div>
      <div id={PANEL_ID} role="tabpanel" aria-labelledby={TAB_ID(state.tab)}>
        {urlApplied && state.tab === "companies" && (
          <AnnouncementBoard
            key={`companies-${boardKey}`}
            scope={scope}
            defaultDays={DEFAULT_DAYS}
            days={days}
            onDaysChange={(next) => {
              setDays(next);
              setState((current) => (current.bucket ? { ...current, bucket: "" } : current));
            }}
            initialBucket={state.bucket || undefined}
            revision={revision}
            onDetail={onDetail ? (customerKey, companyName) => onDetail({ customerKey, companyName }) : undefined}
            onProgressed={afterProgress}
            endpoints={endpoints}
            features={features}
            showConsultant={showConsultant}
          />
        )}
        {urlApplied && state.tab === "contacts" && (
          <ContactsBoard
            key={`contacts-${boardKey}`}
            scope={scope}
            kind={kind}
            onKindChange={setKind}
            revision={revision}
            onDetail={onDetail ? (customerKey, companyName) => onDetail({ customerKey, companyName }) : undefined}
            onProgressed={afterProgress}
            endpoints={endpoints}
            view={state.view}
            showConsultant={showConsultant}
            now={now}
          />
        )}
      </div>
    </div>
  );
}
