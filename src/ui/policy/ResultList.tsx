"use client";

// 좌측 목록 — 진단 결과(3묶음)와 전체 공고 탐색(1단계)을 겸한다.
// 어느 쪽이든 「고르면 오른쪽 상세가 바뀐다」 — 목록에서 바로 원문으로 나가지 않는다.
import { useEffect, useState, type ReactNode } from "react";
import { formatPolicyDate } from "../../engine/types";
import type { BusinessProfile } from "../../engine/match-engine";
import type { VerdictFeedbackContext } from "./endpoints";
import type { DiagnoseItem, Diagnosis, GradeKey, ListMode, Row } from "./PolicyMatchScreen";

const SOURCE_LABEL: Record<string, string> = {
  bizinfo: "기업마당",
  bojo24: "보조금24",
  kstartup: "K-Startup",
  msit: "과기부",
  work24: "고용24",
  "tp-busan": "부산테크노파크",
  "tp-chungnam": "충남테크노파크",
  ulsan: "울산 기업지원플랫폼",
  "tp-daejeon": "대전테크노파크",
  "tp-jeonbuk": "전북테크노파크",
  jbba: "전북경제통상진흥원",
  djbea: "대전일자리경제진흥원",
  "tp-gyeongbuk": "경북테크노파크",
  "tp-gyeongnam": "경남테크노파크",
  bizok: "인천 비즈OK",
  mss: "중소벤처기업부",
  semas: "소상공인시장진흥공단",
  // 이 게시판엔 중기부·산업통상부 사업이 섞여 있어 부처를 못 박지 않는다(독립 검사 3차 지적).
  exportvoucher: "수출바우처",
  "riia-gn": "경남지역산업진흥원",
  "riia-jn": "전남지역산업진흥원",
  // 이름표는 기관 정식 명칭으로 — 「서울TP」처럼 줄이면 같은 열의 다른 테크노파크와 규칙이 어긋난다(독립 검사 4차).
  seoultp: "서울테크노파크",
  gepa: "경상북도경제진흥원",
  khidi: "한국보건산업진흥원",
  gcgf: "경기신용보증재단",
  smartfactory: "스마트공장 통합공고",
};

const NEW_MS = 72 * 60 * 60 * 1000;
const DAY_MS = 86_400_000;
const PAGE_SIZE = 50;

// ── 화면 계약(DESIGN.md) ────────────────────────────────────────────────
// 뱃지는 전부 알약형 12/600 이고 **한 화면 3톤**만 쓴다 —
//   ① D-day(빨강·금색·회색 3단계) ② 등급(가능 초록·애매 금색·불가 회색)
//   ③ 나머지(출처·분야·형식)는 **회색 한 톤**. 연파랑은 「선택 강조」에만 쓴다.
/** 뱃지 알약 뼈대 — 색은 붙이는 쪽이 정한다. */
export const PILL = "inline-flex items-center rounded-full px-2 py-1 text-xs font-semibold leading-[18px]";
/** 분류 뱃지(출처·분야·형식) — 회색 한 톤. */
export const PILL_NEUTRAL = `${PILL} bg-wedly-bg-gray text-wedly-t2`;
/** 확인 필요 뱃지 — 금색. 등급 톤과 같은 색을 쓴다(새 톤을 늘리지 않는다). */
const PILL_WARN = `${PILL} bg-wedly-bg-yellow text-wedly-t1`;

/** 보조 행동 — 테두리형 40px. */
export const BTN_SECONDARY =
  "inline-flex h-10 items-center justify-center rounded-[10px] border border-wedly-bd bg-white px-4 " +
  "text-sm text-wedly-t2 transition-colors hover:bg-wedly-bg-gray focus-visible:outline-none " +
  "focus-visible:ring-2 focus-visible:ring-wedly-accent focus-visible:ring-offset-2 disabled:opacity-50";

/** 입력칸·선택칸 — 높이 40, 모서리 10, 초점에 파란 테두리+반지. */
const FIELD =
  "h-10 rounded-[10px] border border-wedly-bd bg-white px-4 text-sm text-wedly-t1 transition-colors " +
  "placeholder:text-wedly-muted focus:border-wedly-accent focus:outline-none focus:ring-2 focus:ring-wedly-accent/40";

/** 안내 띠 — 상하 8·좌우 16. 노란 띠는 대비가 낮아 테두리를 반드시 함께 둔다. */
const BANNER_WARN =
  "rounded-xl border border-[var(--wedly-gold)]/30 bg-wedly-bg-yellow px-4 py-2 text-xs leading-[18px] text-wedly-t1";

/** 빈 상태·로딩 — 가운데 정렬, 위아래 32, 본문 14. */
const EMPTY_BOX = "py-8 text-center";
const EMPTY_TEXT = "text-sm leading-[22px] text-wedly-muted";
const EMPTY_HINT = "mt-2 text-xs leading-[18px] text-wedly-muted";

function isNew(firstSeenAt: string): boolean {
  const t = new Date(firstSeenAt).getTime();
  if (Number.isNaN(t)) return false;
  return Date.now() - t < NEW_MS;
}

// 우측 상세(DetailPanel)와 **한 벌만** 둔다 — 두 곳이 다르게 기간을 쓰면 안 된다.
// fallback 은 상세에서 「확인 필요」를 넘기려는 용도(목록은 기본 "" 로 빈 문자열).
export function periodLabel(start: string | null, end: string | null, fallback = ""): string {
  const a = formatPolicyDate(start);
  const b = formatPolicyDate(end);
  if (a && b) return `${a} ~ ${b}`;
  return a || b || fallback;
}

export function clipRegion(region: string): string {
  const t = region.trim();
  if (!t) return "";
  return t.length > 60 ? `${t.slice(0, 60)}…` : t;
}

/** 마감까지 남은 날. 마감일이 없거나 못 읽으면 null. */
export function daysLeft(applyEnd: string | null): number | null {
  if (!applyEnd) return null;
  const end = new Date(applyEnd).getTime();
  if (Number.isNaN(end)) return null;
  return Math.ceil((end - Date.now()) / DAY_MS);
}

/**
 * D-day 뱃지. 색 3단계는 화면 기준 메모(2026-08-22) 그대로 —
 * 좌 목록과 우 상세가 **같은 규칙**을 쓰도록 여기에 한 벌만 둔다.
 */
export function ddayBadge(applyEnd: string | null, applyPeriodText: string): { label: string; className: string } {
  const diff = daysLeft(applyEnd);
  if (diff === null) {
    // 「2026-07-08 ~」처럼 개시일만 있는 원문은 물결로 끝나 잘린 것처럼 읽힌다(독립 검사 3차) — 완결된 말로.
    const label = /~\s*$/.test(applyPeriodText)
      ? `${applyPeriodText.replace(/\s*~\s*$/, "")} 시작`
      : applyPeriodText || "기간 확인";
    return { label, className: `${PILL} bg-wedly-bg-gray text-wedly-t2` };
  }
  if (diff < 0) return { label: "마감", className: `${PILL} bg-wedly-bg-gray text-wedly-t2` };
  const label = diff === 0 ? "D-DAY" : `D-${diff}`;
  if (diff <= 7) return { label, className: `${PILL} bg-wedly-bg-red text-wedly-red-ink` };
  if (diff <= 30) return { label, className: `${PILL} bg-wedly-bg-yellow text-wedly-t1` };
  return { label, className: `${PILL} bg-wedly-bg-gray text-wedly-t2` };
}

/**
 * 상세창 「마감」 칸 전용. 목록 뱃지와 달리 **라벨이 이미 「마감」**이라,
 * 마감일이 없을 때 개시일을 그대로 쓰면 시작일이 마감일로 읽힌다(독립 검사 4차).
 * 알약을 쓰지 않는 이유: 지표 상자 배경과 알약 배경이 같은 색이라 안 보이면서
 * 값만 8px 안으로 밀려 네 칸의 정렬이 깨진다(독립 검사 5차 실측 대비 1.00).
 */
export function deadlineMetricLabel(
  applyEnd: string | null,
  applyPeriodText: string,
  status?: string,
): { label: string; className: string } {
  if (daysLeft(applyEnd) === null) {
    // 마감일이 없어도 이미 닫힌 공고면 그 사실을 말한다. 그 밖에는 「모른다」로 —
    // 원문에 기간이 있는데 못 읽은 경우가 있어 「없음」으로 단정하지 않는다(독립 검사 5차).
    if (status === "closed") return { label: "마감", className: "text-wedly-t2" };
    return { label: "확인 필요", className: "text-wedly-t2" };
  }
  const badge = ddayBadge(applyEnd, applyPeriodText);
  return { label: badge.label, className: badge.className.replace(PILL, "").trim() };
}

const GRADE_TABS: Array<{ key: GradeKey; label: string; tone: string }> = [
  { key: "possible", label: "받을 수 있음", tone: "text-wedly-green" },
  { key: "uncertain", label: "애매함", tone: "text-wedly-t1" },
  { key: "impossible", label: "안 됨", tone: "text-wedly-muted" },
];

export interface BrowseBundle {
  rows: Row[];
  total: number;
  page: number;
  /** 서버에 실제로 적용된 검색어(입력 중인 qInput 과 다를 수 있다) — 펼침 조회가 같은 필터를 쓰기 위해. */
  q: string;
  qInput: string;
  status: string;
  loading: boolean;
  refreshing: boolean;
  lastSyncAt: string | null;
  setQInput: (v: string) => void;
  submitSearch: () => void;
  setStatus: (v: string) => void;
  setPage: (n: number) => void;
}

interface Props {
  mode: ListMode;
  onModeChange: (m: ListMode) => void;
  diagnosis: Diagnosis | null;
  selectedId: string;
  onSelect: (id: string) => void;
  browse: BrowseBundle;
  /** 묶음(「외 N건」) 구성원을 받아 올 통로 — 목록 통로와 같은 주소를 쓴다. */
  announcementsEndpoint: string;
  /**
   * 「지금 새로 받아오기」 — **없으면 단추 자체를 안 그린다.** 랩엔 수집기가 없어서
   * 눌러도 아무 일이 안 일어나는 단추를 보여 주면 안 된다.
   */
  onManualSync?: () => void;
  /** 판정 피드백 조각을 카드 아래에 끼운다(랩만). 없으면 아무것도 안 그린다. */
  verdictFeedback?: (ctx: VerdictFeedbackContext) => ReactNode;
  /** 위 조각에 함께 넘길 이번 회차 사업자 정보. */
  profile?: BusinessProfile | null;
}

/** 목록 행 — 안쪽 여백 16(상하좌우), 모서리 12. 행 사이는 8(space-y-2). */
const cardBase =
  "block w-full rounded-xl border p-4 text-left transition-colors focus-visible:outline-none " +
  "focus-visible:ring-2 focus-visible:ring-wedly-accent focus-visible:ring-offset-2";

function selectionClass(selected: boolean): string {
  // 선택은 연파랑 + 파란 테두리, 그냥 스칠 때는 조용한 회색 층.
  return selected
    ? "border-wedly-accent bg-wedly-bg-blue/40"
    : "border-wedly-bd/60 bg-white hover:bg-wedly-bg-gray";
}

export function GroupMembers({ repId, members, selectedId, onSelect }: {
  repId: string; members: Row[]; selectedId: string | null; onSelect: (id: string) => void;
}) {
  const rest = members.filter((m) => m.id !== repId);
  if (rest.length === 0) return null;
  return (
    <div className="ml-4 border-l-2 border-wedly-bd pl-3 py-1 space-y-1">
      {rest.map((m, i) => {
        const badge = ddayBadge(m.applyEnd, m.applyPeriodText);
        return (
          <button
            key={m.id}
            type="button"
            onClick={() => onSelect(m.id)}
            className={`block w-full rounded-lg px-3 py-2 text-left hover:bg-wedly-bg-gray ${selectionClass(selectedId === m.id)}`}
          >
            <div className="flex flex-wrap items-center gap-2">
              {/* 순번 — 같은 공고가 글자까지 똑같이 반복되는 묶음(울산형)에서 유일한 구별 단서다(독립 검사 지적). */}
              <span className={`${PILL_NEUTRAL} tabular-nums`}>{i + 1}</span>
              <span className={PILL_NEUTRAL}>{SOURCE_LABEL[m.source] ?? m.source}</span>
              {m.category && <span className={PILL_NEUTRAL}>{m.category}</span>}
              <span className={`ml-auto tabular-nums ${badge.className}`}>{badge.label}</span>
            </div>
            <div className="mt-1 min-w-0 line-clamp-1 break-keep text-sm leading-5 text-wedly-t2">{m.title}</div>
          </button>
        );
      })}
    </div>
  );
}

export default function ResultList({
  mode, onModeChange, diagnosis, selectedId, onSelect, browse, announcementsEndpoint,
  onManualSync, verdictFeedback, profile,
}: Props) {
  // 고른 묶음은 「어느 진단 결과에서 골랐는지」와 함께 기억한다.
  // 진단을 새로 돌리면 저절로 아래 기본값(결과가 들어 있는 첫 묶음)으로 돌아간다 — 빈 탭을 보여 주지 않는다.
  const [pick, setPick] = useState<{ from: Diagnosis; key: GradeKey } | null>(null);
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const [membersCache, setMembersCache] = useState<Record<string, Row[]>>({});
  const [loadingKeys, setLoadingKeys] = useState<Set<string>>(new Set());

  // 목록이 새로 그려지면(검색·상태 변경·쪽 이동·새로 받아오기) 펼침 상태와 구성원 캐시를 비운다 —
  // 안 비우면 「외 N건」 숫자는 새 값인데 펼친 내용은 옛것이 남는다(적대 리뷰 지적).
  useEffect(() => {
    setExpandedKeys(new Set());
    setMembersCache({});
  }, [browse.rows]);

  async function loadMembers(key: string) {
    if (membersCache[key] || loadingKeys.has(key)) return;
    setLoadingKeys((prev) => new Set(prev).add(key));
    try {
      const qs = new URLSearchParams({ dedupKey: key, q: browse.q, status: browse.status });
      const j = await fetch(`${announcementsEndpoint}?${qs}`).then((r) => r.json());
      if (j?.success) setMembersCache((prev) => ({ ...prev, [key]: j.data as Row[] }));
    } catch {
      // 실패하면 캐시에 안 넣는다 — 「다시 시도」가 이 함수를 다시 부른다
    } finally {
      setLoadingKeys((prev) => { const next = new Set(prev); next.delete(key); return next; });
    }
  }

  function toggleGroup(key: string) {
    if (!key) return;
    const willExpand = !expandedKeys.has(key);
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
    if (willExpand) void loadMembers(key);
  }

  const defaultGrade: GradeKey = diagnosis
    ? GRADE_TABS.find((t) => diagnosis[t.key].length > 0)?.key ?? "possible"
    : "possible";
  const grade: GradeKey = pick && pick.from === diagnosis ? pick.key : defaultGrade;

  const candidateCount = diagnosis?.candidateCount;
  const analyzedCount = diagnosis?.analyzedCount;
  const droppedByRegion = diagnosis?.droppedByRegion;
  const showAnalyzeBanner =
    typeof candidateCount === "number" &&
    typeof analyzedCount === "number" &&
    candidateCount > analyzedCount;
  // 제외 건수는 **분석이 다 끝나도** 보여야 한다 — 다 읽힌 뒤가 이 시스템이 지향하는 상태인데,
  // 그때 「왜 그 공고가 안 보이냐」에 답할 숫자가 함께 사라지면 안 된다(2026-08-24 화면 독립 검사 2번).
  const showDroppedBanner = typeof droppedByRegion === "number" && droppedByRegion > 0;
  const items: DiagnoseItem[] = diagnosis ? diagnosis[grade] : [];
  const pageCount = Math.max(1, Math.ceil(browse.total / PAGE_SIZE));

  return (
    // lg+ 에서는 relative 인 부모 컬럼을 absolute inset-0 로 꽉 채운다(오른쪽 상세 높이에 맞춤) —
    // 탭·검색 줄은 위에 고정되고 목록만 flex-1 로 남은 높이를 먹어 그 안에서 스크롤한다(아래 목록 div).
    <div className="rounded-2xl border border-wedly-bd bg-white p-4 shadow-sm lg:absolute lg:inset-0 lg:flex lg:flex-col lg:overflow-hidden">
      {diagnosis && (
        // 목록의 주 전환(진단 결과 ↔ 전체 공고)은 상세 탭과 같은 밑줄형으로 통일한다.
        <div className="mb-4 flex flex-wrap gap-6 border-b border-wedly-bd">
          {([
            ["diagnosed", "진단 결과"],
            ["browse", "전체 공고"],
          ] as Array<[ListMode, string]>).map(([m, label]) => (
            <button
              key={m}
              type="button"
              onClick={() => onModeChange(m)}
              className={`-mb-px border-b-2 pb-2 text-sm leading-[22px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-wedly-accent focus-visible:ring-offset-2 ${
                mode === m
                  ? "border-wedly-accent font-semibold text-wedly-t1"
                  : "border-transparent text-wedly-t2 hover:text-wedly-t1"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {mode === "diagnosed" && diagnosis ? (
        <>
          <div className="flex flex-wrap gap-2">
            {GRADE_TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => {
                  setPick({ from: diagnosis, key: t.key });
                  // 묶음을 바꾸면 오른쪽 상세도 그 묶음으로 옮긴다 —
                  // 안 그러면 「안 됨」 탭을 보면서 앞서 고른 「가능」 공고의 상세가 남아 헷갈린다.
                  onSelect(diagnosis[t.key][0]?.announcementId ?? "");
                }}
                className={`inline-flex h-10 items-center justify-center gap-1 rounded-[10px] border px-4 text-sm tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-wedly-accent focus-visible:ring-offset-2 ${
                  grade === t.key ? "border-wedly-bd bg-wedly-bg-gray font-semibold" : "border-transparent hover:bg-wedly-bg-gray"
                } ${t.tone}`}
              >
                {t.label} {diagnosis[t.key].length}
              </button>
            ))}
          </div>

          {(showAnalyzeBanner || showDroppedBanner) && (
            <div className={`mt-4 tabular-nums ${BANNER_WARN}`}>
              {showAnalyzeBanner && (
                /* 「잠시 뒤 다시 진단하면 반영」은 이제 거짓이다 — 뒤에서 읽어 주던 시계를 없앴다
                   (2026-08-25 비용 구조 전환). 오지 않을 반영을 기다리게 하지 않는다. */
                <>후보 {candidateCount}건 중 {analyzedCount}건은 AI 가 읽었습니다 — 나머지는 간이 판정이며, 공고를 열면 그 자리서 읽습니다</>
              )}
              {/* 지역이 안 맞아 빠진 수 — 「왜 그 공고가 안 보이냐」에 답할 유일한 숫자다. */}
              {showDroppedBanner && (
                <>{showAnalyzeBanner ? " · " : ""}소재지가 맞지 않아 {droppedByRegion}건 제외</>
              )}
            </div>
          )}

          <div className="mt-4 max-h-[calc(100vh-22rem)] space-y-2 overflow-y-auto pr-1 lg:max-h-none lg:min-h-0 lg:flex-1">
            {items.length === 0 && (
              <div className={EMPTY_BOX}>
                <div className={EMPTY_TEXT}>이 묶음에 해당하는 공고가 없습니다</div>
                <div className={EMPTY_HINT}>다른 묶음 탭을 눌러 보세요</div>
              </div>
            )}
            {items.map((it) => {
              const badge = ddayBadge(it.applyEnd, it.applyPeriodText);
              const card = (
                <button
                  key={it.announcementId}
                  type="button"
                  onClick={() => onSelect(it.announcementId)}
                  className={`${cardBase} ${selectionClass(selectedId === it.announcementId)}`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    {/* 분야는 분류일 뿐이라 회색 한 톤 — 연파랑은 「선택 강조」 전용이다. */}
                    {it.category && <span className={PILL_NEUTRAL}>{it.category}</span>}
                    {it.unanalyzed ? (
                      <span className={PILL_WARN}>아직 분석 안 됨</span>
                    ) : it.ruleOnly ? (
                      /* AI 없이 글자 패턴으로만 본 판정 — 공짜라 전량에 돌지만 촘촘함이 덜하다.
                         회색(분류 톤)이 아니라 금색(주의 톤)이다 — 정밀도가 가장 낮은 판정이
                         분야 칩처럼 보이면 안 된다(2026-08-25 적대적 리뷰). */
                      <span className={PILL_WARN}>간이 판정</span>
                    ) : (
                      it.needsReview && <span className={PILL_WARN}>조건 확인 필요</span>
                    )}
                    {/* 등급에서 뺀 「사람이 직접 볼 조건」의 개수 — 「받을 수 있음」 묶음에서도 보인다
                        (2026-08-22 독립 화면 검사 1번). */}
                    {it.checks.humanCheck > 0 && (
                      <span className={`${PILL_WARN} tabular-nums`}>직접 확인 조건 {it.checks.humanCheck}건</span>
                    )}
                    <span className={`ml-auto tabular-nums ${badge.className}`}>{badge.label}</span>
                  </div>
                  <div className="mt-2 line-clamp-2 break-keep text-base font-semibold leading-6 text-wedly-t1">{it.title}</div>
                  <div className="mt-1 truncate text-xs leading-[18px] text-wedly-muted">{it.agency}</div>
                  {it.failSummary && (
                    <div className="mt-1 truncate text-xs leading-[18px] text-wedly-muted">{it.failSummary}</div>
                  )}
                </button>
              );
              // 조각을 안 받은 앱(ERP)에서는 카드 하나만 그대로 그린다 — 마디를 하나도 더하지 않는다.
              // 단추 안에 또 단추를 넣을 수 없어(HTML 규칙) 피드백은 카드 **밖 아래**에 붙인다.
              if (!verdictFeedback) return card;
              return (
                <div key={it.announcementId} className="space-y-2">
                  {card}
                  {verdictFeedback({
                    announcementId: it.announcementId,
                    title: it.title,
                    item: it,
                    aiVerdict: null,
                    profile: profile ?? null,
                    place: "card",
                  })}
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-4">
            <span className="text-xs leading-[18px] text-wedly-muted">
              {browse.lastSyncAt ? `자료 기준: ${new Date(browse.lastSyncAt).toLocaleString("ko-KR")}` : "아직 수집 전"}
            </span>
            {onManualSync && (
              <button
                type="button"
                onClick={onManualSync}
                disabled={browse.refreshing}
                className={`ml-auto ${BTN_SECONDARY}`}
              >
                {browse.refreshing ? "받아오는 중…" : "지금 새로 받아오기"}
              </button>
            )}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <input
              value={browse.qInput}
              onChange={(e) => browse.setQInput(e.target.value)}
              onKeyDown={(e) => {
                // 한글을 조합하는 중(받침 입력 등)의 Enter 는 확정용이라 검색으로 치지 않는다.
                if (e.key === "Enter" && !e.nativeEvent.isComposing) browse.submitSearch();
              }}
              placeholder="공고명·기관·지원대상 검색"
              className={`${FIELD} w-56 max-w-full`}
            />
            <button type="button" onClick={browse.submitSearch} className={BTN_SECONDARY}>
              검색
            </button>
            <select
              value={browse.status}
              onChange={(e) => { browse.setStatus(e.target.value); browse.setPage(1); }}
              className={FIELD}
            >
              <option value="open">모집중</option>
              <option value="closed">마감</option>
              <option value="all">전체</option>
            </select>
            <span className="text-xs leading-[18px] tabular-nums text-wedly-muted">
              {browse.total.toLocaleString()}건
            </span>
          </div>

          <div className="mt-4 max-h-[calc(100vh-22rem)] space-y-2 overflow-y-auto pr-1 lg:max-h-none lg:min-h-0 lg:flex-1">
            {browse.loading && browse.rows.length === 0 && (
              <div className={EMPTY_BOX}>
                <div className={EMPTY_TEXT}>불러오는 중…</div>
              </div>
            )}
            {!browse.loading && browse.rows.length === 0 && (
              <div className={EMPTY_BOX}>
                <div className={EMPTY_TEXT}>조건에 맞는 공고가 없습니다</div>
                <div className={EMPTY_HINT}>검색어를 바꾸거나 모집 상태를 「전체」로 두고 다시 찾아 보세요</div>
              </div>
            )}
            {browse.rows.map((r) => {
              const badge = ddayBadge(r.applyEnd, r.applyPeriodText);
              // 카드엔 「딱 핵심」만 — 기관·기간만 남긴다. 지역 태그 나열·본문 요약·지원대상은
              // 고르면 오른쪽 상세에 다 나오므로 목록에서 빼서 카드를 짧게(스크롤 절약).
              const meta = [r.agency, periodLabel(r.applyStart, r.applyEnd)].filter(Boolean).join(" · ");
              const count = r.groupCount ?? 1;
              const ids = r.groupIds ?? [r.id];
              const expanded = expandedKeys.has(r.dedupKey);
              return (
                <div key={r.dedupKey || r.id}>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => onSelect(r.id)}
                    onKeyDown={(e) => {
                      if (e.key !== "Enter" && e.key !== " ") return;
                      // 안쪽 「외 N건」 버튼이 포커스일 때는 카드 선택이 아니라 그 버튼만 동작한다.
                      if (e.target !== e.currentTarget) return;
                      e.preventDefault();
                      onSelect(r.id);
                    }}
                    className={`${cardBase} cursor-pointer ${selectionClass(selectedId != null && ids.includes(selectedId))}`}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      {/* 출처·분야는 분류라 회색 한 톤 — 색이 뜻을 갖는 자리는 D-day 뿐이다. */}
                      <span className={PILL_NEUTRAL}>{SOURCE_LABEL[r.source] ?? r.source}</span>
                      {count >= 2 && (
                        <button
                          type="button"
                          aria-expanded={expanded}
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleGroup(r.dedupKey);
                          }}
                          className={`${PILL_NEUTRAL} tabular-nums`}
                        >
                          {expanded ? "접기" : `외 ${count - 1}건`}
                        </button>
                      )}
                      {r.category && <span className={PILL_NEUTRAL}>{r.category}</span>}
                      <span className={`ml-auto tabular-nums ${badge.className}`}>{badge.label}</span>
                    </div>
                    <div className="mt-2 flex items-start gap-1">
                      {isNew(r.firstSeenAt) && (
                        <span className="shrink-0 text-xs font-bold leading-6 text-wedly-red">N</span>
                      )}
                      <div className="min-w-0 line-clamp-2 break-keep text-base font-semibold leading-6 text-wedly-t1">{r.title}</div>
                    </div>
                    {meta && <div className="mt-1 truncate text-xs leading-[18px] text-wedly-muted">{meta}</div>}
                  </div>
                  {count >= 2 && expanded && (
                    loadingKeys.has(r.dedupKey)
                      ? <div className="pl-6 py-2 text-xs text-wedly-muted">묶음 불러오는 중…</div>
                      : membersCache[r.dedupKey] === undefined
                        ? (
                          // 실패는 로딩과 다른 톤(빨강)이어야 훑을 때 잡힌다(독립 검사 지적).
                          <div className="pl-6 py-2 text-xs text-wedly-red">
                            묶음을 불러오지 못했습니다 —{" "}
                            <button type="button" className="underline" onClick={() => void loadMembers(r.dedupKey)}>
                              다시 시도
                            </button>
                          </div>
                        )
                        : <GroupMembers repId={r.id} members={membersCache[r.dedupKey] ?? []} selectedId={selectedId} onSelect={onSelect} />
                  )}
                </div>
              );
            })}
          </div>

          {browse.total > PAGE_SIZE && (
            <div className="flex items-center justify-center gap-4 pt-4">
              <button
                type="button"
                disabled={browse.page <= 1}
                onClick={() => browse.setPage(browse.page - 1)}
                className={BTN_SECONDARY}
              >
                이전
              </button>
              <span className="text-sm leading-[22px] tabular-nums text-wedly-t2">
                {browse.page} / {pageCount}
              </span>
              <button
                type="button"
                disabled={browse.page >= pageCount}
                onClick={() => browse.setPage(browse.page + 1)}
                className={BTN_SECONDARY}
              >
                다음
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
