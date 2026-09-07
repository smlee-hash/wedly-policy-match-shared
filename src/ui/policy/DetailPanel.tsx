"use client";

// 우측 상세 — 고른 공고 한 건. 「이 사업자가 되는 이유」(조건 체크리스트)가 첫 탭이다.
// 대조는 서버와 **같은 순수 함수**(match-engine)로 한다 — 두 곳이 다르게 판정하면 안 된다.
import { useEffect, useRef, useState, type ReactNode } from "react";
// 소제목 앞 색 아이콘 — 이 저장소 유일 아이콘 부품(lucide). 이모지는 쓰지 않는다(DESIGN.md).
import {
  AlertTriangle,
  Check,
  ClipboardCheck,
  Coins,
  Copy,
  FileText,
  HelpCircle,
  History,
  MessageCircleQuestion,
  Paperclip,
  Phone,
  Send,
  Sparkles,
  Target,
  Users,
  Wrench,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { IoBulb } from "react-icons/io5";
import { Modal } from "./Modal";
import { type PolicyAttachment, type PolicyAttachmentKind } from "../../engine/types";
import {
  matchAnnouncement,
  readStoredStructure,
  UNREADABLE_STRUCTURE_NOTE,
  type BusinessProfile,
} from "../../engine/match-engine";
import { conditionLabelOf, type ConditionVerdict } from "../../engine/structure-types";
import type { VerdictResult, VerdictStatus } from "../../ai/verdict";
import {
  blockedConditionsOf,
  breakthroughCapNote,
  sourceBadgeBox,
  sourceKindOf,
  type BreakthroughItem,
} from "../../ai/breakthrough";
import { buildInstructorQuestion } from "./ask-instructor-text";
import { nextPollAction, type PollAction } from "./detail-poll";
import type { PolicyMatchEndpoints, PolicyMatchFeatures, VerdictFeedbackContext } from "./endpoints";
import type { DiagnoseItem, GradeKey, ListMode } from "./PolicyMatchScreen";
import {
  BTN_SECONDARY, clipRegion, daysLeft, ddayBadge, deadlineMetricLabel, periodLabel, PILL, PILL_NEUTRAL,
} from "./ResultList";

/**
 * 상세가 부르는 통로는 넷이다. **`verdict`·`breakthrough`·`askInstructor` 가 없으면
 * 그 단추와 그 문구를 아예 안 그린다** — 랩(`wedly-policy-lab`)엔 상담 자료실이 없어서
 * 「자료실에 질문 저장」 같은 사내 전제 문구가 외부 전문가 화면에 나오면 안 된다.
 */
export type DetailEndpoints = Pick<
  PolicyMatchEndpoints,
  "announcement" | "verdict" | "breakthrough" | "askInstructor"
>;

/** 응답 오류를 사람 말로 바꾸는 앱별 규약. 안 넘기면 ERP 규약(`body.error.message`) 그대로. */
type ParseError = NonNullable<PolicyMatchFeatures["parseError"]>;

interface Detail {
  id: string;
  source: string;
  title: string;
  agency: string;
  category: string;
  region: string;
  summary: string;
  targetText: string;
  applyStart: string | null;
  applyEnd: string | null;
  applyPeriodText: string;
  url: string;
  status: string;
  attachments: PolicyAttachment[];
  structure: unknown;
  structureStatus: string;
  structuredAt: string | null;
  applyMethod: string;
  contact: string;
  receiptSiteUrl: string;
}

type TabKey = "match" | "summary" | "info" | "source";

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "match", label: "매칭 결과" },
  { key: "summary", label: "AI 요약" },
  { key: "info", label: "공고 정보" },
  { key: "source", label: "원공고" },
];

const CHECK_FACE: Record<ConditionVerdict, { mark: string; cls: string; label: string }> = {
  pass: { mark: "✓", cls: "text-wedly-green", label: "충족" },
  fail: { mark: "✗", cls: "text-wedly-red", label: "미충족" },
  unknown: { mark: "?", cls: "text-wedly-gold-ink", label: "확인 필요" },
};

const AI_STATUS_CLASS: Record<VerdictStatus, string> = {
  충족: "text-wedly-green",
  미충족: "text-wedly-red",
  확인필요: "text-wedly-gold-ink",
};

const GRADE_LABEL: Record<GradeKey, string> = {
  possible: "받을 수 있음",
  uncertain: "애매함",
  impossible: "안 됨",
};

const GRADE_CLASS: Record<GradeKey, string> = {
  possible: "bg-wedly-bg-green text-wedly-green-ink",
  uncertain: "bg-wedly-bg-yellow text-wedly-t1",
  impossible: "bg-wedly-bg-gray text-wedly-t2",
};

/** 구조화가 덜 됐거나 어긋난 공고 — 조건이 빠져 있을 수 있다고 정직하게 알린다. */
const INCOMPLETE_STATUS = new Set(["needs_review", "failed", "pending"]);

/**
 * 아직 공고를 읽는 중인 상태. 이때는 「구조화 결과를 읽지 못했습니다」가 아니라
 * **「읽는 중」**이 사실이다 — AI 요약 탭과 같은 말로 통일한다(2026-08-22 독립 화면 검사 2번).
 */
const READING_STATUS = new Set(["pending", "working"]);
const READING_MESSAGE = "공고 읽는 중 — 잠시 후 제공됩니다";
/** 다 기다려도 안 끝났을 때. 「잠시 후」라고만 두면 화면이 영영 안 바뀌어 거짓말이 된다. */
const READING_TIMEOUT_MESSAGE = "공고 읽는 중 — 잠시 뒤 다시 열어 보세요";
/** 아직 읽는 중이면 이 간격으로 이만큼만 다시 물어본다(약 30초). */
const READ_RETRY_GAP_MS = 5_000;
const READ_RETRY_MAX = 6;

const AI_FAIL_MESSAGE = "AI 확인 실패 — 기계 판정 결과를 참고하세요";

/**
 * 첨부 형식 뱃지 — 글자만 형식별로 두고 **색은 회색 한 톤**으로 통일한다.
 * 형식은 「분류」이지 상태가 아니다. 색을 형식마다 달리 주면 한 화면에 뱃지 색이 예닐곱 톤이 되어
 * 정작 뜻이 있는 색(마감 임박 빨강·확인 필요 금색·가능 초록)이 묻힌다(DESIGN.md §4 뱃지 3톤 규칙).
 */
const KIND_FACE: Record<PolicyAttachmentKind, { label: string; cls: string }> = {
  pdf: { label: "PDF", cls: PILL_NEUTRAL },
  hwp: { label: "HWP", cls: PILL_NEUTRAL },
  hwpx: { label: "HWPX", cls: PILL_NEUTRAL },
  zip: { label: "ZIP", cls: PILL_NEUTRAL },
  etc: { label: "기타", cls: PILL_NEUTRAL },
};
const KIND_FALLBACK = KIND_FACE.etc;

/**
 * 사람이 눌러도 되는 바깥 주소인지. 원 응답에는 주소가 아닌 글자(「기관 문의」 등)나
 * `javascript:` 같은 것이 들어올 수 있어 **http(s) 로 시작하는 것만** 단추로 만든다.
 */
function isHttpUrl(v: string): boolean {
  return /^https?:\/\//i.test(v.trim());
}

// ── 화면 계약(DESIGN.md) ────────────────────────────────────────────────
// 글자 4층: 구역 소제목·공고 제목 16/600 · 본문 14/400(줄간 22) · 메타·뱃지 12/400(줄간 18).
// 여백 계단: 4·6·8·16·24·32. 그림자는 바깥 카드 한 겹만.
const sectionTitle = "text-base font-semibold leading-6 text-wedly-t1";
// break-keep: 한국어 어절을 낱말 중간에서 끊지 않는다. break-words 는 공백 없는 긴 토큰만 예외로 끊어 넘침을 막는다.
const bodyText = "mt-2 whitespace-pre-wrap break-keep break-words text-sm leading-[22px] text-wedly-t2";
/** 주 행동 — 「바로 신청하러 가기」. 파랑 채움 44px, 화면당 하나. */
const BTN_PRIMARY =
  "inline-flex h-11 items-center justify-center rounded-[10px] bg-wedly-accent px-6 text-sm " +
  "font-semibold text-white transition-colors hover:bg-wedly-accent/90 focus-visible:outline-none " +
  "focus-visible:ring-2 focus-visible:ring-wedly-accent focus-visible:ring-offset-2";
/** 안내 상자 — 상하 8·좌우 16, 모서리 12. 노란 상자는 대비가 낮아 테두리를 함께 둔다. */
const BOX = "rounded-xl px-4 py-2";
const BOX_WARN = `${BOX} border border-[var(--wedly-gold)]/30 bg-wedly-bg-yellow`;
/** 빈 상태·로딩 — 가운데 정렬, 위아래 32, 본문 14. */
const EMPTY = "py-8 text-center text-sm leading-[22px] text-wedly-muted";

/** 돌파구 주 단추 — 모바일 40 / PC 36. */
const ASK_BTN =
  "inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-xl bg-wedly-accent px-4 py-2 " +
  "text-wedly-sub font-semibold text-white transition-colors hover:bg-wedly-accent/90 " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-wedly-accent focus-visible:ring-offset-2 " +
  "disabled:opacity-50 disabled:pointer-events-none sm:min-h-[36px]";
const COPY_BTN =
  "inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-xl border border-wedly-bd bg-white px-4 py-2 " +
  "text-wedly-sub font-semibold text-wedly-t1 transition-colors hover:bg-wedly-bg-gray " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-wedly-accent focus-visible:ring-offset-2 " +
  "disabled:opacity-50 disabled:pointer-events-none sm:min-h-[36px]";

const SOURCE_FACE = {
  자료실: { label: "자료실", box: sourceBadgeBox("자료실"), Icon: FileText },
  고객이력: { label: "고객이력", box: sourceBadgeBox("고객이력"), Icon: History },
  통화: { label: "통화", box: sourceBadgeBox("통화"), Icon: Phone },
} as const;

/**
 * 라벨-값 셀 — 핵심 지표 그리드(dl)의 한 칸. dt 는 12/muted, dd 는 값.
 * strong 이면 값을 구역 소제목 층(16/600)으로 강조하고, tabular 면 숫자를 표 정렬한다.
 */
function Metric({
  label,
  value,
  strong,
  tabular,
  clampLong,
}: {
  label: string;
  value: ReactNode;
  strong?: boolean;
  tabular?: boolean;
  /** 값이 길면 두 줄만 보이고 「더 보기」로 펼친다(머리 구획 위계 보호). */
  clampLong?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const longText = clampLong && typeof value === "string" && value.length > 60;
  return (
    // min-w-0: 그리드 칸이 내용 최소폭 때문에 넘쳐 값이 오른쪽에서 잘리는 것을 막는다.
    <div className="min-w-0">
      <dt className="text-xs leading-[18px] text-wedly-muted">{label}</dt>
      <dd
        className={`mt-1 break-keep break-words ${
          strong ? "text-base font-semibold leading-6 text-wedly-t1" : "text-sm leading-[22px] text-wedly-t2"
        }${tabular ? " tabular-nums" : ""}${longText && !open ? " line-clamp-2" : ""}`}
      >
        {value}
      </dd>
      {longText && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="mt-1 text-xs leading-[18px] text-wedly-accent-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-wedly-accent"
        >
          {open ? "접기" : "전체 보기"}
        </button>
      )}
    </div>
  );
}

/**
 * 소제목+내용 행 — 소제목은 구역 소제목 층(16/600), 내용은 body(한 문장) 또는 children(점 목록 등).
 *
 * ★소제목 앞에 색 아이콘을 둬 「전부 같은 회색·구분선뿐」인 밋밋함을 없앤다(사장님 지적 2026-08-22).
 *   정본 패턴은 revenue-funnel/GoalProgressCard — 제목을 flex items-center 로 감싸고 앞에 아이콘.
 *   두 모양:
 *     · 색 타일(tileClass 지정) — 둥근 사각 배경(h-8 w-8) 안에 아이콘. 강조 섹션에.
 *     · 단색(tileClass 없음) — 타일 없이 아이콘만(기본 muted). 과하지 않게 나머지 섹션에.
 *   본문 배경은 칠하지 않는다(리드 그라데이션 1개 외 흰 배경 — DESIGN.md 색 남발 금지).
 */
function SummaryRow({
  title,
  body,
  children,
  icon: Icon,
  iconClass,
  tileClass,
  pad = true,
}: {
  title: string;
  body?: string;
  children?: ReactNode;
  /** 소제목 앞 lucide 아이콘. 색·타일은 아래 두 prop 이 정한다. */
  icon?: LucideIcon;
  /** 아이콘 색 — 예: "text-wedly-accent-ink". 단색일 때 미지정이면 muted. */
  iconClass?: string;
  /** 색 타일 배경 — 예: "bg-wedly-bg-blue". 주면 둥근 사각 타일 안에 넣어 강조한다. */
  tileClass?: string;
  /** 구분선 카드 안 행이면 안쪽 여백(16), 세로 간격으로 나눈 독립 섹션이면 여백을 뺀다. */
  pad?: boolean;
}) {
  return (
    <div className={pad ? "p-4" : undefined}>
      <div className="flex items-center gap-2.5">
        {Icon &&
          (tileClass ? (
            <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${tileClass}`}>
              <Icon className={`h-4 w-4 ${iconClass ?? "text-wedly-t2"}`} />
            </span>
          ) : (
            <Icon className={`h-4 w-4 shrink-0 ${iconClass ?? "text-wedly-muted"}`} />
          ))}
        <div className={sectionTitle}>{title}</div>
      </div>
      {body !== undefined && <div className={bodyText}>{body}</div>}
      {children}
    </div>
  );
}

function BreakthroughCard({ item, onAsk }: { item: BreakthroughItem; onAsk: () => void }) {
  const fail = item.status === "미충족";
  const StatusIcon = fail ? XCircle : HelpCircle;
  const statusCls = fail ? "text-wedly-red" : "text-wedly-gold-ink";
  return (
    <article className="min-w-0 rounded-xl border border-wedly-bd/60 bg-wedly-bg-gray/70 p-4">
      <div className="flex items-start gap-2">
        <StatusIcon className={`mt-0.5 h-4 w-4 shrink-0 ${statusCls}`} aria-hidden="true" />
        <p className="min-w-0 break-keep text-wedly-sub font-semibold text-wedly-t1">{item.condition}</p>
      </div>
      <p className="mt-2 min-w-0 break-keep text-wedly-sub text-wedly-t2">{item.breakthrough}</p>
      {item.sources.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-2">
          {item.sources.map((s, i) => {
            const known = sourceKindOf(s.kind);
            const face = known
              ? SOURCE_FACE[known]
              : { label: s.kind || "출처", box: sourceBadgeBox(s.kind), Icon: FileText };
            const Icon = face.Icon;
            return (
              <li
                key={`${s.kind}-${s.ref}-${i}`}
                className={`inline-flex max-w-full items-center gap-1 rounded-full px-2 py-1 ${face.box}`}
              >
                <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
                <span className="min-w-0 truncate break-keep text-wedly-label font-semibold">
                  {face.label} · {s.ref}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {!item.hasInternalCase && (
        <div className="mt-3 flex items-start gap-3 rounded-xl border border-[var(--wedly-gold)]/40 bg-wedly-bg-yellow p-3 shadow-sm">
          <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-wedly-gold text-white shadow-sm">
            <HelpCircle className="h-3.5 w-3.5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="break-keep text-wedly-sub font-semibold text-wedly-t1">내부 사례 없음 — 강사 확인 필요</p>
            <p className="mt-1 break-keep text-wedly-sub text-wedly-t2">
              내부 자료에서 이 조건을 넘긴 사례를 찾지 못했습니다. 강사에게 물어보면 실무 우회 경로를 확인할 수 있습니다.
            </p>
          </div>
        </div>
      )}
      <button type="button" onClick={onAsk} className={`${ASK_BTN} mt-4`}>
        <MessageCircleQuestion className="h-4 w-4" aria-hidden="true" />
        강사에게 물어보기
      </button>
    </article>
  );
}

/**
 * 「돌파구 찾기」를 누르기 전 안내 — 찾은 뒤 나타나는 `BreakthroughSection` 과 **같은 얼굴**로
 * 둔다(아이콘 타일·제목·강조 바). 안 그러면 단추를 누르는 순간 같은 자리가 딴 화면으로 바뀐다
 * (독립 검사 지적 ②).
 *
 * ★이 구역은 「우리 자료실·고객이력」을 전제한 사내 문구를 담고 있다 — 그래서 상세는
 *  `endpoints.breakthrough` 가 있을 때만 그린다(랩엔 자료실이 없다).
 */
export function BreakthroughPrompt({ summary, onRun }: { summary: string; onRun: () => void }) {
  return (
    <section className="mt-4 min-w-0">
      <header className="flex items-center gap-3">
        <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-wedly-accent shadow-sm">
          <IoBulb className="h-4 w-4 text-white" aria-hidden="true" />
        </span>
        <h2 className="min-w-0 break-keep text-wedly-section font-semibold text-wedly-t1">돌파구 제안</h2>
      </header>
      <div className="mt-2 h-1 w-10 rounded-full bg-wedly-accent" aria-hidden="true" />
      {/* ★숫자는 위 체크리스트에서 세는 낱말 그대로 쓴다 — 「막힌」이라는 넷째 낱말을
          만들면 사용자가 화면과 대조할 수 없다(독립 검사 지적 ①). */}
      <p className="mt-2 break-keep text-wedly-hint text-wedly-muted">
        {summary} — 우리 자료실·고객이력에서 넘는 방법을 찾아봅니다
      </p>
      <button type="button" onClick={onRun} className={`${BTN_SECONDARY} mt-3`}>
        돌파구 찾기
      </button>
    </section>
  );
}

function BreakthroughSection({
  items,
  busy,
  error,
  analyzedCount,
  totalCount,
  onRetry,
  onAsk,
}: {
  items: BreakthroughItem[] | null;
  busy: boolean;
  error: string;
  analyzedCount?: number;
  totalCount?: number;
  onRetry: () => void;
  onAsk: (item: BreakthroughItem) => void;
}) {
  const capNote =
    typeof analyzedCount === "number" && typeof totalCount === "number"
      ? breakthroughCapNote(analyzedCount, totalCount)
      : null;
  return (
    <section className="min-w-0">
      <header className="flex items-center gap-3">
        <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-wedly-accent shadow-sm">
          <IoBulb className="h-4 w-4 text-white" aria-hidden="true" />
        </span>
        <h2 className="min-w-0 break-keep text-wedly-section font-semibold text-wedly-t1">돌파구 제안</h2>
      </header>
      <div className="mt-2 h-1 w-10 rounded-full bg-wedly-accent" aria-hidden="true" />
      <p className="mt-2 break-keep text-wedly-hint text-wedly-muted">
        안 되는 조건을 넘는 방법을 내부 사례에서 찾았습니다
      </p>
      {capNote && (
        <p className="mt-1 break-keep text-wedly-hint text-wedly-muted">{capNote}</p>
      )}

      {busy && (
        <div className="mt-4 flex items-start gap-3 rounded-xl border border-wedly-bd/60 bg-wedly-bg-gray/70 px-4 py-3 shadow-sm">
          <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-wedly-accent text-white shadow-sm">
            <Wrench className="h-3.5 w-3.5" aria-hidden="true" />
          </span>
          <p className="min-w-0 break-keep text-wedly-sub text-wedly-t2">돌파구를 내부 자료에서 찾는 중…</p>
        </div>
      )}

      {error && !busy && (
        <div className="mt-4 flex items-start gap-3 rounded-xl border border-wedly-bd-red bg-wedly-bg-red p-4 shadow-sm">
          <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-wedly-red text-white shadow-sm">
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="break-keep text-wedly-sub font-semibold text-wedly-red-ink">돌파구를 찾지 못했습니다</p>
            <p className="mt-1 break-keep text-wedly-sub text-wedly-t2">{error}</p>
            <button type="button" onClick={onRetry} className={`${COPY_BTN} mt-3`}>
              다시 찾기
            </button>
          </div>
        </div>
      )}

      {!busy && items && items.length > 0 && (
        <ul className="mt-4 space-y-4">
          {items.map((item, i) => (
            <li key={`${item.condition}-${i}`}>
              <BreakthroughCard item={item} onAsk={() => onAsk(item)} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function AskInstructorModal({
  policyTitle,
  category,
  condition,
  tried,
  company,
  onClose,
  saveEndpoint,
  parseError,
}: {
  policyTitle: string;
  category: string;
  condition: string;
  tried?: string;
  company?: { name?: string; industry?: string; region?: string };
  onClose: () => void;
  /**
   * 「자료실에 질문 저장」 통로. **없으면 저장 단추도, 자료실을 전제한 안내 문장도 안 그린다** —
   * 복사해서 쓰는 평문만 남는다.
   */
  saveEndpoint?: string;
  parseError?: ParseError;
}) {
  const [copied, setCopied] = useState(false);
  const [copyNote, setCopyNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveNote, setSaveNote] = useState("");
  const text = buildInstructorQuestion({ policyTitle, condition, tried, company });

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setCopyNote("카카오톡 대화창에 붙여넣으면 됩니다.");
    } catch {
      setCopied(false);
      setCopyNote("복사에 실패했습니다 — 아래 글을 직접 선택해 복사하세요.");
    }
  };

  const save = async () => {
    if (!saveEndpoint) return;
    setSaving(true);
    setSaveNote("");
    try {
      const res = await fetch(saveEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ policyTitle, category, condition, tried, company }),
      });
      const j = await res.json();
      if (j?.success) {
        setSaved(true);
        setSaveNote("상담 자료실의 확인 필요 카드에서 이어서 보세요.");
      } else {
        setSaved(false);
        setSaveNote(parseError ? parseError(res, j) : (j?.error?.message ?? "저장에 실패했습니다 — 다시 시도하세요."));
      }
    } catch {
      setSaved(false);
      setSaveNote("저장에 실패했습니다 — 다시 시도하세요.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="강사에게 물어보기"
      description={
        saveEndpoint
          ? "카카오톡에 붙여넣을 평문입니다. 자료실에도 같은 내용으로 질문 카드를 남길 수 있습니다."
          : "카카오톡에 붙여넣을 평문입니다."
      }
      footer={
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void copy()} className={COPY_BTN}>
            {copied ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
            {copied ? "복사됨" : "카카오톡용 복사"}
          </button>
          {saveEndpoint && (
            <button type="button" onClick={() => void save()} disabled={saving || saved} className={ASK_BTN}>
              <FileText className="h-4 w-4" aria-hidden="true" />
              {saving ? "저장 중…" : saved ? "자료실에 저장됨" : "자료실에 질문 저장"}
            </button>
          )}
        </div>
      }
    >
      <div className="min-w-0 whitespace-pre-wrap break-keep rounded-xl bg-wedly-bg-gray p-4 text-wedly-sub text-wedly-t2">
        {text}
      </div>
      {copyNote && (
        <p className={`mt-3 break-keep text-wedly-hint ${copied ? "text-wedly-green" : "text-wedly-t2"}`}>{copyNote}</p>
      )}
      {saveNote && (
        <p className={`mt-2 break-keep text-wedly-hint ${saved ? "text-wedly-green" : "text-wedly-red"}`}>{saveNote}</p>
      )}
    </Modal>
  );
}

interface Props {
  /** 이 부품이 부를 통로 넷. 없는 통로의 단추·문구는 그리지 않는다. */
  endpoints: DetailEndpoints;
  /** 응답 오류를 사람 말로 — 안 넘기면 ERP 규약 그대로. */
  parseError?: ParseError;
  /** 상세 머리에 끼울 판정 피드백 조각(랩만). 없으면 아무것도 안 그린다. */
  verdictFeedback?: (ctx: VerdictFeedbackContext) => ReactNode;
  announcementId: string;
  mode: ListMode;
  profile: BusinessProfile;
  /** 진단 회차. 사업자 정보를 고쳐 다시 진단하면 올라간다. */
  profileNonce: number;
  item: DiagnoseItem | null;
  /** 이번 세션에 진단을 한 번이라도 돌렸는가 — 대조 화면을 여는 열쇠는 「탭」이 아니라 이것이다. */
  hasDiagnosis: boolean;
  /** 서버 첫 열람 구조화(유료)까지 끄고 저장본만 받는다 — 상세창 추천 레일 전용(AI 0원). */
  noServerAi?: boolean;
  /** item 없는 「매칭 결과」 빈 상태 문구 — 진단 버튼이 없는 화면(레일)은 실행 가능한 안내로 바꾼다. */
  browseEmptyNote?: string;
}

/**
 * 「돌파구를 찾을 조건」을 화면에 쓰는 낱말 그대로 센다.
 * `blockedConditionsOf` 는 **미충족 + 확인필요**를 합쳐 준다. 그 합계를 「막힌 조건 N개」처럼
 * 넷째 낱말로 내보내면, 바로 위 체크리스트가 쓰는 충족/확인필요/미충족과 대조가 안 된다
 * (2026-08-25 독립 화면 검사 지적 ① — X 표시는 1개인데 「막힌 조건 4개」라 적혀 있었다).
 */
function blockedSummary(checklist: { condition: string; status: string; note?: string }[]): string {
  const blocked = blockedConditionsOf(checklist);
  const 미충족 = blocked.filter((c) => c.status === "미충족").length;
  const 확인필요 = blocked.filter((c) => c.status === "확인필요").length;
  const parts: string[] = [];
  if (미충족 > 0) parts.push(`미충족 ${미충족}건`);
  if (확인필요 > 0) parts.push(`확인필요 ${확인필요}건`);
  return parts.join(" · ");
}

export default function DetailPanel({
  endpoints, parseError, verdictFeedback,
  announcementId, mode, profile, profileNonce, item, hasDiagnosis, noServerAi, browseEmptyNote,
}: Props) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  /** 다시 물어보기를 다 썼는데도 아직 읽는 중 — 안내 문구를 바꾼다. */
  const [readWaitedOut, setReadWaitedOut] = useState(false);
  const [tab, setTab] = useState<TabKey>("match");
  const [verdict, setVerdict] = useState<VerdictResult | null>(null);
  const [verdictBusy, setVerdictBusy] = useState(false);
  const [verdictNote, setVerdictNote] = useState("");
  const [btItems, setBtItems] = useState<BreakthroughItem[] | null>(null);
  const [btAnalyzed, setBtAnalyzed] = useState<{ analyzedCount: number; totalCount: number } | null>(null);
  const [btBusy, setBtBusy] = useState(false);
  const [btNote, setBtNote] = useState("");
  const [btRetry, setBtRetry] = useState(0);
  const [askFor, setAskFor] = useState<BreakthroughItem | null>(null);
  const fetchSeq = useRef(0);
  const verdictSeq = useRef(0);
  const btSeq = useRef(0);

  // 진단을 새로 돌리면 매칭 결과부터 보여 준다.
  useEffect(() => {
    if (mode === "diagnosed") setTab("match");
  }, [mode]);

  // 공고를 바꾸거나 **사업자 정보를 고쳐 다시 진단하면** 앞서 받은 AI 판정을 지운다.
  // 지우지 않으면 바뀐 회사 화면에 옛 회사 판정이 그대로 붙어 있다(2026-08-22 리뷰 10번).
  useEffect(() => {
    verdictSeq.current += 1;
    btSeq.current += 1;
    setVerdict(null);
    setVerdictNote("");
    setVerdictBusy(false); // 앞 공고의 「판정 중」 표시를 물려받지 않는다
    setBtItems(null);
    setBtAnalyzed(null);
    setBtNote("");
    setBtBusy(false);
    setAskFor(null);
  }, [announcementId, profileNonce]);

  useEffect(() => {
    if (!announcementId) {
      setDetail(null);
      setError("");
      return;
    }
    const seq = ++fetchSeq.current;
    setLoading(true);
    setError("");
    setReadWaitedOut(false);
    // 서버가 20초만 기다렸다 「읽는 중」으로 돌려주므로, 그대로 두면 화면이 영영 그 문구다.
    // 아직 읽는 중이면 몇 초 간격으로 몇 번만 다시 물어본다(2026-08-24 재리뷰 7번).
    let timer: ReturnType<typeof setTimeout> | undefined;
    let left = READ_RETRY_MAX;
    /**
     * 첫 조회에 성공했나. **다시 물어보다 실패해도 보고 있던 내용을 지우지 않으려고** 둔다 —
     * 배포 교체 창처럼 몇 초 끊기는 일은 늘 있는데(실측: 다른 세션 배포로 502),
     * 그때 화면을 비우면 잘 보고 있던 공고가 「불러오지 못했습니다」로 사라진다
     * (2026-08-24 화면 독립 검사가 잡음).
     */
    let gotOnce = false;
    /** 규칙은 detail-poll 의 순수 함수가 정한다 — 화면 밖에서 시험으로 못 박아 둔 자리다. */
    const apply = (action: PollAction, failMessage: string) => {
      if (action === "retry") {
        left -= 1;
        timer = setTimeout(load, READ_RETRY_GAP_MS);
      } else if (action === "waited-out") {
        setReadWaitedOut(true);
      } else if (action === "fail") {
        setDetail(null);
        setError(failMessage);
      }
      // "show"·"keep" 은 아무것도 안 한다 — "keep" 이 보고 있던 내용을 지키는 자리다.
    };
    const load = async () => {
      try {
        const res = await fetch(endpoints.announcement(announcementId, { noAi: noServerAi }));
        const j = await res.json();
        if (seq !== fetchSeq.current) return;
        const ok = j?.success === true;
        if (ok) {
          const d = j.data as Detail;
          gotOnce = true;
          setDetail(d);
          setError("");
          // noServerAi 통로는 서버가 AI 를 안 부르므로 「읽는 중」 상태가 이 자리에서 변할 수 없다
          // — 재조회는 전부 헛통신이라 돌리지 않는다(독립 검사 2026-08-30: 카드 1클릭에 조회 7회).
          const reading = !noServerAi && READING_STATUS.has(d.structureStatus);
          apply(nextPollAction({ ok, reading, gotOnce, retriesLeft: left }), "");
        } else {
          apply(
            nextPollAction({ ok, reading: false, gotOnce, retriesLeft: left }),
            parseError ? parseError(res, j) : (j?.error?.message ?? "공고를 불러오지 못했습니다"),
          );
        }
      } catch {
        if (seq !== fetchSeq.current) return;
        apply(
          nextPollAction({ ok: false, reading: false, gotOnce, retriesLeft: left }),
          "공고를 불러오지 못했습니다 — 잠시 뒤 다시 시도하세요",
        );
      } finally {
        if (seq === fetchSeq.current) setLoading(false);
      }
    };
    void load();
    // 다른 공고로 옮기거나 화면을 닫으면 기다리던 것을 반드시 정리한다.
    return () => { if (timer !== undefined) clearTimeout(timer); };
  }, [announcementId]);

  const runVerdict = async () => {
    if (!detail || !endpoints.verdict) return;
    // AI 판정은 오래 걸린다 — 그 사이 다른 공고를 고르거나 사업자 정보를 고쳐 다시 진단하면
    // **엉뚱한 화면에 남의 판정이 붙는다.** 회차 번호로 늦게 온 답은 버린다.
    const seq = verdictSeq.current;
    setVerdictBusy(true);
    setVerdictNote("");
    try {
      const res = await fetch(endpoints.verdict, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ announcementId: detail.id, profile }),
      });
      const j = await res.json();
      if (seq !== verdictSeq.current) return;
      if (j?.success) {
        setVerdict(j.data as VerdictResult);
      } else {
        // ★서버가 사유를 알려 줬으면 그대로 보여 준다(2026-08-25 독립 화면 검사).
        // 예전엔 무조건 일반 문구로 덮어써, 「오늘 AI 사용 상한에 닿았습니다」 같은
        // **행동을 바꿀 안내**가 화면에 영영 안 나왔다. 돌파구 쪽은 이미 서버 문구를 쓴다.
        setVerdictNote(parseError ? parseError(res, j) : (j?.error?.message || AI_FAIL_MESSAGE)); // 기계 판정은 그대로 남긴다
      }
    } catch {
      if (seq !== verdictSeq.current) return;
      setVerdictNote(AI_FAIL_MESSAGE);
    } finally {
      if (seq === verdictSeq.current) setVerdictBusy(false);
    }
  };

  // 공고나 판정이 바뀌면 돌파구 결과를 비운다 — 남은 결과가 새 공고에 붙어 보이면 안 된다.
  useEffect(() => {
    setBtItems(null);
    setBtAnalyzed(null);
    setBtNote("");
    setBtBusy(false);
    btSeq.current += 1;
  }, [verdict, detail?.id]);

  /**
   * 돌파구 찾기 — **사람이 눌러야 돈다.**
   * 예전엔 정밀 판정이 끝나면 막힌 조건이 있는 한 **저절로** 한 번 더 AI 를 불렀다.
   * 단추 한 번에 AI 값이 두 번 나가는 구조라, 정작 돌파구가 필요 없을 때도 돈이 나갔다
   * (2026-08-25 사장님 「이 부분도 비용 개선」).
   */
  const runBreakthrough = () => {
    if (!verdict || !detail || !endpoints.breakthrough) return;
    const blocked = blockedConditionsOf(verdict.checklist);
    if (!blocked.length) {
      setBtItems([]);
      setBtAnalyzed(null);
      setBtNote("");
      return;
    }
    const seq = ++btSeq.current;
    const announcementIdForCall = detail.id;
    const url = endpoints.breakthrough;
    setBtBusy(true);
    setBtNote("");
    void (async () => {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            announcementId: announcementIdForCall,
            profile,
            bizno: profile.bizno ?? "",
            conditions: blocked,
          }),
        });
        const j = await res.json();
        if (seq !== btSeq.current) return;
        if (j?.success) {
          const items = (j.data?.items ?? []) as BreakthroughItem[];
          setBtItems(items);
          setBtAnalyzed({
            analyzedCount: typeof j.data?.analyzedCount === "number" ? j.data.analyzedCount : items.length,
            totalCount: typeof j.data?.totalCount === "number" ? j.data.totalCount : items.length,
          });
        } else {
          setBtItems(null);
          setBtAnalyzed(null);
          setBtNote(parseError ? parseError(res, j) : (j?.error?.message ?? "돌파구를 찾지 못했습니다 — 다시 시도하세요"));
        }
      } catch {
        if (seq !== btSeq.current) return;
        setBtItems(null);
        setBtAnalyzed(null);
        setBtNote("돌파구를 찾지 못했습니다 — 다시 시도하세요");
      } finally {
        if (seq === btSeq.current) setBtBusy(false);
      }
    })();
  };

  // 「다시 시도」 단추가 올리는 회차 — 사람이 누른 것이므로 그때만 다시 돈다.
  useEffect(() => {
    if (btRetry > 0) runBreakthrough();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [btRetry]);

  // lg+ 에서는 상세가 「내용 높이」로 자란다 — 안쪽 스크롤 없이 본문을 끝까지 펼치고(길면 페이지가
  // 스크롤), 이 높이가 왼쪽 목록 컬럼의 높이도 정한다(부모 grid 의 align stretch).
  // 그래서 h-full·overflow-hidden 을 주지 않는다(주면 예전처럼 본문에 안쪽 스크롤이 생긴다).
  // 빈/로딩/오류 상태도 이 껍데기를 쓴다.
  const shell = (children: ReactNode, center = false) => (
    // lg:h-full — 부모 컬럼(grid stretch 로 「상세 높이 = 좌우 공통 높이」를 받음)을 흰 카드가 꽉 채운다.
    // 이게 없으면 상세가 짧을 때(빈/짧은 공고) 카드가 내용 높이에 머물러 왼쪽 목록(바닥값 36rem)과 어긋난다.
    // overflow-hidden 은 넣지 않는다 — 넣으면 본문에 안쪽 스크롤이 다시 생긴다(본문은 lg:overflow-visible).
    // center=true 는 빈/로딩/오류 안내를 큰 카드 가운데에 둔다.
    <div
      className={`rounded-2xl border border-wedly-bd bg-white p-4 shadow-sm lg:flex lg:h-full lg:flex-col${
        center ? " lg:items-center lg:justify-center" : ""
      }`}
    >
      {children}
    </div>
  );

  if (!announcementId) {
    return shell(
      // 좁은 화면에서는 목록이 왼쪽이 아니라 위에 쌓인다 — 자리를 가리키지 않는다.
      <div className={EMPTY}>목록에서 공고를 선택하세요</div>,
      true,
    );
  }
  // ★다른 공고를 골랐으면 **앞 공고 내용을 계속 보여 주지 않는다**(2026-08-25 독립 화면 검사 지적 ③).
  // 상세 한 건이 20초까지 걸릴 수 있어, 예전엔 그 사이 오른쪽에 앞 공고의 조건·판정이 그대로 남았다.
  // 그 창에서 「AI 정밀 판정」을 누르면 **엉뚱한 공고에 값이 나간다.**
  const showingOther = detail !== null && detail.id !== announcementId;
  if (loading && (!detail || showingOther)) {
    return shell(<div className={EMPTY}>불러오는 중…</div>, true);
  }
  if (error || !detail) {
    return shell(<div className={EMPTY}>{error || "공고를 찾을 수 없습니다"}</div>, true);
  }

  const structure = readStoredStructure(detail.structure);
  const match = matchAnnouncement(structure, profile);
  // 아직 읽는 중인 공고의 「읽지 못했습니다」 줄은 사람이 확인할 조건이 아니다 — 안내로 갈음한다.
  const reading = READING_STATUS.has(detail.structureStatus);
  // noServerAi 통로에선 이 화면이 AI 읽기를 시작시키지 않는다 — 「잠시 후 제공됩니다」는 거짓이 된다.
  const readingMessage = noServerAi
    ? "AI 요약을 아직 만들지 않은 공고입니다 — 원공고 탭에서 원문을 확인하세요"
    : readWaitedOut ? READING_TIMEOUT_MESSAGE : READING_MESSAGE;
  const humanCheck = reading
    ? match.humanCheck.filter((h) => h !== UNREADABLE_STRUCTURE_NOTE)
    : match.humanCheck;
  const badge = ddayBadge(detail.applyEnd, detail.applyPeriodText);
  const deadlineMetric = deadlineMetricLabel(detail.applyEnd, detail.applyPeriodText, detail.status);
  const left = daysLeft(detail.applyEnd);
  // 마감일이 없는 채로 닫힌 공고(게시판 90일 규칙)도 마감으로 다룬다 — 안 그러면
  // 「마감」 목록에서 연 공고에 「바로 신청하러 가기」가 뜬다(독립 검사 5차).
  const isClosed = (left !== null && left < 0) || detail.status === "closed";
  const regionText = clipRegion(detail.region);
  // 규모 세부(scaleItems)만 채워진 공고도 요약을 보여 준다 — 「읽는 중」으로 남겨 두면 읽은 내용이 묻힌다.
  const summaryReady = !!(
    structure.aiSummary.purpose ||
    structure.aiSummary.target ||
    structure.aiSummary.scale ||
    structure.aiSummary.scaleItems.length > 0
  );
  // AI 요약 첫 칸 「요약」 — 이 공고가 무엇을 주는 사업인지 한눈에. 지어내지 않고 저장된 값만 쓴다.
  const headlineSummary = structure.benefitSummary || detail.summary;

  // 위쪽 노란 「직접 확인 조건 N건」 칩이 가리키는 **내용**. 진단 전에도 이 상자를 보여 준다
  // — 칩만 있고 볼 곳이 없으면 사람은 무엇을 확인해야 하는지 알 수 없다(2026-08-22 독립 재검사 2번).
  // 「첨부 원문 확인 필요: ○○.hwp」는 **사람이 확인할 자격 조건이 아니라** 기계가 그 파일을
  // 못 읽었다는 사정이다. 조건 목록에 섞이면 「가맹점 20개 이상」 같은 진짜 조건과 뒤엉켜
  // 한눈 판단을 방해한다(사장님 2026-08-30 「애초에 이게 안 나오게」) — 목록에서 빼고 아래 한 줄로.
  const unreadFiles = humanCheck
    .filter((h) => h.startsWith("첨부 원문 확인 필요"))
    .map((h) => h.replace(/^첨부 원문 확인 필요:\s*/, ""));
  const realHumanCheck = humanCheck.filter(
    (h) => !h.startsWith("첨부 원문 확인 필요") && h !== "첨부를 다 읽지 못함 — 조건이 빠졌을 수 있습니다",
  );
  const unreadNote = unreadFiles.length > 0 && (
    <p className="text-xs leading-[18px] text-wedly-muted break-keep">
      첨부 {unreadFiles.length}개는 기계가 못 읽었습니다({unreadFiles.slice(0, 2).join(", ")}
      {unreadFiles.length > 2 ? " 외" : ""}) — 조건이 더 있을 수 있으니 「원공고」 탭에서 확인하세요.
    </p>
  );
  /** 대조에 쓸 회사 정보가 하나라도 있는가 — 있으면 진단 없이도 체크리스트를 그린다. */
  const hasProfile = Object.values(profile ?? {}).some((v) => v !== undefined && v !== null && v !== "");
  /** 공고 원문 펼쳐 보기 — 세부 조건을 확인하려고 화면을 떠나지 않게(사장님 2026-08-30). */
  const originalText = (detail.targetText ?? "").trim();
  // 「창업벤처」 4자처럼 분류 꼬리표만 저장된 공고가 있다 — 그걸 「원문」이라 펼쳐 보이면
  // 오류로 읽힌다(사장님 2026-08-30). 문단이라 할 만한 길이일 때만 펼치기를 준다.
  const originalBlock = originalText.length >= 120 && (
    <details className="rounded-xl border border-wedly-bd/60 bg-wedly-bg-gray/40 p-4">
      <summary className="cursor-pointer text-sm font-semibold leading-[22px] text-wedly-t1">
        공고 원문 펼쳐 보기 <span className="font-normal text-wedly-muted">({originalText.length.toLocaleString()}자)</span>
      </summary>
      <p className="mt-3 max-h-96 overflow-y-auto whitespace-pre-wrap break-keep break-words text-sm leading-[22px] text-wedly-t2">
        {originalText}
      </p>
    </details>
  );
  const HUMAN_CHECK_PREVIEW = 5;
  const humanCheckBox = realHumanCheck.length > 0 && (
    // 노란 확인필요 상자 — 매칭 결과 탭의 형제 카드들과 안쪽 여백(16)을 맞춘다.
    <div className="rounded-xl border border-[var(--wedly-gold)]/30 bg-wedly-bg-yellow p-4">
      <div className="flex items-center gap-1.5">
        <HelpCircle className="h-4 w-4 shrink-0 text-wedly-t1" />
        <span className="text-sm font-semibold leading-[22px] text-wedly-t1">
          회사 정보로 자동 확인이 안 되는 조건 {realHumanCheck.length}건
        </span>
      </div>
      {/* 「무엇을 하라는 건지」를 먼저 말한다 — 개수만 있으면 사람이 행동을 못 정한다(사장님 2026-08-30). */}
      <p className="mt-1 text-xs leading-[18px] text-wedly-t2 break-keep">
        아래 문장은 공고에서 그대로 가져온 자격 요건입니다. 회사 자료(정관·등기부·매출자료 등)나 담당자 확인으로
        하나씩 맞춰 보세요 — 하나라도 어긋나면 신청이 반려될 수 있습니다.
      </p>
      {/* 두 줄 넘는 글은 본문색으로 — 노란 배경 위 금색 글자는 대비가 낮다(DESIGN.md §2). */}
      <ul className="mt-3 space-y-2">
        {realHumanCheck.slice(0, HUMAN_CHECK_PREVIEW).map((h, i) => (
          <li key={`${h}-${i}`} className="flex gap-2 break-keep break-words text-sm leading-[22px] text-wedly-t2">
            <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-wedly-t2" />
            <span className="min-w-0">{h}</span>
          </li>
        ))}
      </ul>
      {realHumanCheck.length > HUMAN_CHECK_PREVIEW && (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs font-medium leading-[18px] text-wedly-t2">
            나머지 {realHumanCheck.length - HUMAN_CHECK_PREVIEW}건 펼쳐 보기
          </summary>
          <ul className="mt-2 space-y-2">
            {realHumanCheck.slice(HUMAN_CHECK_PREVIEW).map((h, i) => (
              <li key={`${h}-${i}`} className="flex gap-2 break-keep break-words text-sm leading-[22px] text-wedly-t2">
                <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-wedly-t2" />
                <span className="min-w-0">{h}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );

  return shell(
    <>
      {/* ── 머리 3구획 ───────────────────────────────────────────────
          ① 정체 ② 핵심 지표(회색 층 라벨-값 그리드) ③ 상태 띠.
          여백: 제목→알약 8, 구획 사이 16, 탭 줄과는 24(탭이 정한다). */}

      {/* ① 정체 — 제목 + 등급 뱃지 1개, 그 아래 분야·지역·직접확인 알약 줄 */}
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1 break-keep text-base font-semibold leading-6 text-wedly-t1">{detail.title}</div>
        {item && (
          <span className={`${PILL} shrink-0 ${GRADE_CLASS[item.grade]}`}>{GRADE_LABEL[item.grade]}</span>
        )}
      </div>
      {/* 랩만 쓰는 자리 — 조각을 안 받은 앱(ERP)에서는 마디가 하나도 늘지 않는다. */}
      {verdictFeedback && (
        <div className="mt-3">
          {verdictFeedback({
            announcementId: detail.id,
            title: detail.title,
            item,
            aiVerdict: verdict,
            profile: profile ?? null,
            place: "detail",
          })}
        </div>
      )}
      {(detail.category || regionText || humanCheck.length > 0) && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {detail.category && <span className={PILL_NEUTRAL}>{detail.category}</span>}
          {regionText && <span className={PILL_NEUTRAL}>{regionText}</span>}
          {/* 등급에서 뺀 「사람이 직접 볼 조건」 개수 — 「받을 수 있음」에서도 보인다
              (2026-08-22 독립 화면 검사 1번). */}
          {humanCheck.length > 0 && (
            <span className={`${PILL} bg-wedly-bg-yellow tabular-nums text-wedly-t1`}>
              직접 확인 조건 {humanCheck.length}건
            </span>
          )}
        </div>
      )}

      {/* ② 핵심 지표 — 회색 층 안 라벨-값 그리드. 마감·금액·기간을 한데 모아 위계를 준다. */}
      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-4 rounded-xl bg-wedly-bg-gray p-4">
        <Metric label="주관기관" value={detail.agency || "확인 필요"} />
        <Metric
          label="마감"
          value={<span className={`tabular-nums ${deadlineMetric.className}`}>{deadlineMetric.label}</span>}
        />
        {/* 지자체 공고는 지원금액에 항목별 상한을 문단으로 적어 온다(양주시 예: 7줄).
            머리 구획이 본문에 잡아먹혀 위계가 무너지므로 두 줄만 보이고 나머지는 펼침으로. */}
        <Metric label="지원금액" value={structure.supportAmountText || "확인 필요"} strong tabular clampLong />
        <Metric
          label="신청기간"
          value={periodLabel(detail.applyStart, detail.applyEnd, detail.applyPeriodText || "확인 필요")}
          tabular
        />
      </dl>

      {/* ③ 상태 띠 — 오늘 마감/마감됨/구조화 미완만. 파란 「N일 남음」 상자는 뺐다
          (마감 셀과 겹치고, 연파랑은 목록 선택 강조 전용 — DESIGN.md §2). */}
      {left === 0 && (
        <div className={`mt-4 ${BOX} border border-wedly-bd-red bg-wedly-bg-red text-sm leading-[22px] text-wedly-red-ink`}>
          오늘이 접수 마감일입니다
        </div>
      )}
      {isClosed && (
        <div className={`mt-4 ${BOX} bg-wedly-bg-gray text-sm leading-[22px] text-wedly-t2`}>
          접수가 마감되었습니다
        </div>
      )}
      {INCOMPLETE_STATUS.has(detail.structureStatus) && (
        <div className={`mt-4 ${BOX_WARN} text-xs leading-[18px] text-wedly-gold-ink`}>
          조건 일부 직접 확인 필요 — 원문 대조 권장
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {/* 접수 사이트가 있으면 **신청하러 가는 길**을 먼저 보여 준다 — 원공고 읽기는 그 다음.
            주소가 없거나 주소 모양이 아니면 아무것도 늘지 않는다(현행 그대로). */}
        {isHttpUrl(detail.receiptSiteUrl) && !isClosed && (
          <a href={detail.receiptSiteUrl} target="_blank" rel="noreferrer" className={BTN_PRIMARY}>
            바로 신청하러 가기
          </a>
        )}
        {detail.url && (
          <a href={detail.url} target="_blank" rel="noreferrer" className={BTN_SECONDARY}>
            원공고 열기
          </a>
        )}
      </div>

      {/* 탭 줄은 밑줄형 — 고른 탭만 굵게(600) + 2px 파란 밑줄, 나머지는 400 보조색. */}
      <div className="mt-6 flex flex-wrap gap-6 border-b border-wedly-bd">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`-mb-px border-b-2 pb-2 text-sm leading-[22px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-wedly-accent focus-visible:ring-offset-2 ${
              tab === t.key
                ? "border-wedly-accent font-semibold text-wedly-t1"
                : "border-transparent text-wedly-t2 hover:text-wedly-t1"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="mt-4 max-h-[calc(100vh-24rem)] space-y-6 overflow-y-auto pr-1 lg:max-h-none lg:overflow-visible">
        {/* 대조 결과를 보여 줄지는 **어느 목록 탭을 보고 있는가가 아니라**
            「이 공고가 이번 진단에 들어 있는가」가 정한다 — 전체 공고 탭에서 골라도
            진단된 공고면 그대로 보여 준다(2026-08-22 독립 화면 검사 2번). */}
        {tab === "match" && (
          // 체크리스트는 `match`(순수 대조 함수)로 이 자리에서 계산한다 — 진단 회차에 들어 있는지와
          // 무관하다. 회사 정보만 있으면 보여 준다(사장님 2026-08-30 「이 부분만 보고 판단할 수 있어야」).
          // 진단 결과(item)는 AI 판정·돌파구 단추를 여는 열쇠일 뿐이다.
          !item && !hasProfile ? (
            <div className="space-y-4">
              {humanCheckBox}
              {unreadNote}
              {originalBlock}
              <div className={EMPTY}>
                {hasDiagnosis
                  ? "이 공고는 아직 이번 진단에 포함되지 않았습니다 — 다시 진단하면 반영됩니다"
                  : (browseEmptyNote ?? "진단을 실행하면 이 공고의 자격 대조 결과가 보입니다")}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {/* 조건 체크리스트 — 기계 판정을 구분선 카드로 격리한다. 제목에 아이콘 하나만(항목 기호 ✓✗?는 그대로). */}
              <div className="rounded-xl border border-wedly-bd/60">
                <SummaryRow title="조건 체크리스트" icon={ClipboardCheck} iconClass="text-wedly-accent">
                  {/* 5초 답 — 목록을 읽기 전에 「몇 개가 맞고 몇 개를 확인해야 하나」부터(심미 판정 ①). */}
                  {match.checks.length > 0 && (
                    <div className="mb-2 flex flex-wrap items-center gap-1.5 text-xs leading-[18px]">
                      <span className="rounded-md bg-wedly-bg-green px-2 py-0.5 font-semibold text-wedly-green-ink tabular-nums">
                        충족 {match.checks.filter((c) => c.verdict === "pass").length}
                      </span>
                      <span className="rounded-md bg-wedly-bg-yellow px-2 py-0.5 font-semibold text-wedly-t1 tabular-nums">
                        확인 필요 {match.checks.filter((c) => c.verdict === "unknown").length}
                      </span>
                      <span className="rounded-md bg-wedly-bg-red px-2 py-0.5 font-semibold text-wedly-red-ink tabular-nums">
                        미충족 {match.checks.filter((c) => c.verdict === "fail").length}
                      </span>
                    </div>
                  )}
                  {match.checks.length === 0 ? (
                    <div className={bodyText}>
                      {reading ? readingMessage : "기계로 대조할 조건이 없습니다 — 아래 원문을 확인하세요"}
                    </div>
                  ) : (
                    // 행 간격 8. 판정 기호는 폭을 고정해 이름표·원문이 한 줄에서 시작하게 맞춘다.
                    <ul className="mt-2 space-y-2">
                      {match.checks.map((c, i) => {
                        const face = CHECK_FACE[c.verdict];
                        return (
                          <li key={`${c.condition.rawText}-${i}`} className="flex gap-2">
                            <span
                              className={`w-4 shrink-0 text-center text-sm font-semibold leading-[22px] ${face.cls}`}
                            >
                              {face.mark}
                            </span>
                            <span className="min-w-0 break-keep break-words text-sm leading-[22px]">
                              {/* 같은 원문을 쓰는 조건이 둘 있어도 라벨로 구분된다. */}
                              <span className="font-semibold text-wedly-t2">
                                {conditionLabelOf(c.condition.key)}:
                              </span>{" "}
                              <span className="text-wedly-t1">{c.condition.rawText}</span>
                              <span className={`ml-1 text-xs leading-[18px] ${face.cls}`}>{face.label}</span>
                              {c.note && (
                                <span className="ml-1 text-xs leading-[18px] text-wedly-muted">— {c.note}</span>
                              )}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </SummaryRow>
              </div>

              {humanCheckBox}
              {unreadNote}
              {originalBlock}

              {/* ★AI 실행 단추는 **진단 화면에서만**(item 있음) 그린다.
                  상세창 추천 레일(noServerAi)은 「AI 0원」이 약속이라 단추가 보이면 안 된다 —
                  체크리스트를 진단 없이 여는 개편(2026-08-30) 때 이 단추까지 딸려 나왔다(사장님 지적). */}
              {item && !noServerAi && endpoints.verdict && (
              <div className="rounded-xl border border-wedly-bd/60">
                <div className="p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void runVerdict()}
                      disabled={verdictBusy}
                      className={BTN_SECONDARY}
                    >
                      {verdictBusy ? "AI 판정 중…" : "AI 정밀 판정"}
                    </button>
                    {verdictNote && (
                      <span className="text-xs leading-[18px] text-wedly-muted">{verdictNote}</span>
                    )}
                  </div>
                </div>
                {verdict && (
                  <div className="border-t border-wedly-bd/60 p-4">
                    <div className="flex items-center gap-2">
                      <span className={`${PILL} ${GRADE_CLASS[verdict.grade as GradeKey]}`}>
                        AI 판정 {GRADE_LABEL[verdict.grade as GradeKey]}
                      </span>
                    </div>
                    <div className={bodyText}>{verdict.explanation}</div>
                    {verdict.checklist.length > 0 && (
                      <ul className="mt-2 space-y-2">
                        {verdict.checklist.map((c, i) => (
                          <li key={`${c.condition}-${i}`} className="break-keep break-words text-sm leading-[22px] text-wedly-t2">
                            <span className={`font-semibold ${AI_STATUS_CLASS[c.status] ?? "text-wedly-t2"}`}>
                              {c.status}
                            </span>{" "}
                            {c.condition}
                            {c.note && (
                              <span className="text-xs leading-[18px] text-wedly-muted"> — {c.note}</span>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>

              )}

              {item && !noServerAi && endpoints.breakthrough && verdict && blockedConditionsOf(verdict.checklist).length > 0 && (
                btItems === null && !btBusy && !btNote ? (
                  /* 돌파구는 **누를 때만** 찾는다 — 예전엔 판정이 끝나면 저절로 한 번 더
                     AI 를 불러, 정작 필요 없을 때도 값이 나갔다(2026-08-25 비용 개선).
                     ★찾은 뒤 나타나는 「돌파구 제안」 구역과 **같은 얼굴**로 둔다(아이콘 타일·제목·강조 바)
                     — 안 그러면 단추를 누르는 순간 같은 자리가 딴 화면으로 바뀐다(독립 검사 지적 ②). */
                  <BreakthroughPrompt summary={blockedSummary(verdict.checklist)} onRun={runBreakthrough} />
                ) : (
                  <BreakthroughSection
                    items={btItems}
                    busy={btBusy}
                    error={btNote}
                    analyzedCount={btAnalyzed?.analyzedCount}
                    totalCount={btAnalyzed?.totalCount}
                    onRetry={() => setBtRetry((n) => n + 1)}
                    onAsk={setAskFor}
                  />
                )
              )}
            </div>
          )
        )}

        {tab === "summary" && (
          summaryReady ? (
            // 요약(리드+세부)이 전체 폭을 쓰고, 첨부 파일은 요약 맨 아래에 가로로 놓는다.
            <div>
              <div className="space-y-6">
                {/* 리드 — 이 사업이 무엇을 주는지 한눈에. 회색 층 대신 은은한 파랑→금 그라데이션 +
                    Sparkles 로 「AI가 요약했다」는 느낌을 준다(이 블록만 색을 쓴다 — 나머지는 흰 배경). */}
                <div className="rounded-xl border border-[var(--wedly-bd-blue)]/40 bg-gradient-to-br from-wedly-bg-blue to-wedly-bg-yellow p-4">
                  <div className="flex items-center gap-1.5 text-xs leading-[18px] text-wedly-muted">
                    <Sparkles className="h-3.5 w-3.5 shrink-0 text-wedly-accent" />
                    <span>이 사업이 주는 것</span>
                  </div>
                  <div className="mt-2 whitespace-pre-wrap break-keep break-words text-sm leading-[22px] text-wedly-t1">
                    {headlineSummary || "원문에 없음"}
                  </div>
                </div>
                {/* 세부 — 색 아이콘 타일 + 세로 간격으로 위계를 준다(구분선 제거, 흰 배경). */}
                <div className="space-y-7">
                  <SummaryRow
                    icon={Target}
                    tileClass="bg-wedly-bg-blue"
                    iconClass="text-wedly-accent-ink"
                    title="프로그램 목적"
                    body={structure.aiSummary.purpose || "원문에 없음"}
                    pad={false}
                  />
                  <SummaryRow
                    icon={Users}
                    tileClass="bg-wedly-bg-green"
                    iconClass="text-wedly-green-ink"
                    title="지원 대상 및 조건"
                    body={structure.aiSummary.target || "원문에 없음"}
                    pad={false}
                  />
                  <SummaryRow
                    icon={Coins}
                    tileClass="bg-wedly-bg-yellow"
                    iconClass="text-wedly-t1"
                    title="지원 규모"
                    pad={false}
                  >
                    {/* 첨부에서 뽑은 세부(예산·과제 수·한도·기간)가 있으면 점 목록으로, 없으면 한 문장으로. */}
                    {structure.aiSummary.scaleItems.length > 0 ? (
                      <ul className="mt-2 space-y-2">
                        {structure.aiSummary.scaleItems.map((s, i) => (
                          <li key={`${s}-${i}`} className="break-keep break-words text-sm leading-[22px] tabular-nums text-wedly-t2">
                            · {s}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <div className={bodyText}>{structure.aiSummary.scale || "원문에 없음"}</div>
                    )}
                  </SummaryRow>
                </div>
              </div>

              {/* 첨부 파일 — 요약 맨 아래(구역 사이 24), 넓으면 2열 가로 그리드. */}
              <div className="mt-6">
                <div className={sectionTitle}>첨부 파일</div>
                {detail.attachments.length > 0 ? (
                  <ul className="mt-2 grid gap-4 sm:grid-cols-2">
                    {detail.attachments.map((a, i) => {
                      const face = KIND_FACE[a.kind] ?? KIND_FALLBACK;
                      return (
                        <li key={`${a.url}-${i}`} className="rounded-xl border border-wedly-bd/60 p-4">
                          <div className="flex items-start gap-2">
                            <span className={`shrink-0 ${face.cls}`}>{face.label}</span>
                            {/* 원본 파일명 그대로 — 줄여서 무슨 서류인지 못 알아보게 하지 않는다. */}
                            <span className="min-w-0 break-keep break-words text-sm leading-[22px] text-wedly-t1">
                              {a.name}
                            </span>
                          </div>
                          <a
                            href={a.url}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-2 inline-block text-xs leading-[18px] text-wedly-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-wedly-accent focus-visible:ring-offset-2"
                          >
                            내려받기
                          </a>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <div className={bodyText}>첨부 파일이 없습니다</div>
                )}
              </div>
            </div>
          ) : (
            <div className={EMPTY}>{readingMessage}</div>
          )
        )}

        {tab === "info" && (
          // 공고 정보도 색 아이콘 + 세로 간격으로 위계를 준다(구분선 제거, 흰 배경).
          // 준비 서류만 색 타일(보라)로 강조하고 나머지는 단색 아이콘 — 과하지 않게(DESIGN.md 색 남발 금지).
          <div className="space-y-7">
            <SummaryRow icon={FileText} title="사업개요" body={detail.summary || "원문에 없음"} pad={false} />
            <SummaryRow icon={Users} title="지원대상 원문" body={detail.targetText || "원문에 없음"} pad={false} />
            <SummaryRow
              icon={Paperclip}
              tileClass="bg-wedly-bg-purple"
              iconClass="text-wedly-purple-ink"
              title="준비 서류"
              pad={false}
            >
              {structure.documents.length > 0 ? (
                <ul className="mt-2 space-y-2">
                  {structure.documents.map((d, i) => (
                    <li key={`${d}-${i}`} className="break-keep break-words text-sm leading-[22px] text-wedly-t2">· {d}</li>
                  ))}
                </ul>
              ) : (
                <div className={bodyText}>공고문에 서류 목록이 명시되지 않았습니다</div>
              )}
            </SummaryRow>
            <SummaryRow icon={Send} title="신청방법" body={detail.applyMethod || "원문에 없음"} pad={false} />
            <SummaryRow icon={Phone} title="문의처" body={detail.contact || "원문에 없음"} pad={false} />
          </div>
        )}

        {tab === "source" && (
          <>
            <div>
              <div className={sectionTitle}>원공고</div>
              {detail.url ? (
                <a
                  href={detail.url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 block break-all text-sm leading-[22px] text-wedly-accent hover:underline"
                >
                  {detail.url}
                </a>
              ) : (
                <div className={bodyText}>주소가 없습니다</div>
              )}
            </div>
            {detail.receiptSiteUrl && (
              <div>
                <div className={sectionTitle}>접수 사이트</div>
                <a
                  href={detail.receiptSiteUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 block break-all text-sm leading-[22px] text-wedly-accent hover:underline"
                >
                  {detail.receiptSiteUrl}
                </a>
              </div>
            )}
            {detail.attachments.length > 0 && (
              <div>
                <div className={sectionTitle}>첨부</div>
                <ul className="mt-2 space-y-2">
                  {detail.attachments.map((a, i) => (
                    <li key={`${a.url}-${i}`}>
                      <a
                        href={a.url}
                        target="_blank"
                        rel="noreferrer"
                        className="break-keep break-words text-sm leading-[22px] text-wedly-accent hover:underline"
                      >
                        {a.name}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className={`${BOX_WARN} text-xs leading-[18px] text-wedly-gold-ink`}>
              정확한 조건은 반드시 원문으로 확인하세요
            </div>
          </>
        )}
      </div>

      {askFor && (
        <AskInstructorModal
          policyTitle={detail.title}
          category={detail.category}
          condition={askFor.condition}
          tried={verdict?.checklist.find((c) => c.condition === askFor.condition)?.note}
          company={{
            name: profile.companyName,
            industry: profile.industry,
            region: profile.region,
          }}
          onClose={() => setAskFor(null)}
          saveEndpoint={endpoints.askInstructor}
          parseError={parseError}
        />
      )}
    </>,
  );
}
