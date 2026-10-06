"use client";

// 상세 칸 「매칭 결과」 첫 탭의 구조화된 구역들 — 요약 숫자 3칸 · 신청 자격 대조표 · 지원 대상·내용 표 ·
// 접수 일정 막대 · 첨부 파일 줄 · 칸 아래 고정 줄(승인 시안 「바꾼 뒤 ② 매칭 결과」 오른쪽 칸).
// 값 계산은 순수 함수로 따로 두고(그려서·값으로 잴 수 있게), 그리는 부품은 값을 받아 그리기만 한다.
// DetailPanel 이 자료를 받아 이 부품들에 넘긴다 — 없는 자료는 지어내지 않고 「공고 원문 확인」으로 둔다.
import { useState, type ReactNode } from "react";
import { Check, Clock, Coins, Paperclip, type LucideIcon } from "lucide-react";
import type { PolicyAttachment } from "../../engine/types";
import { formatPolicyDate } from "../../engine/types";
import type { ConditionCheck, ConditionVerdict } from "../../engine/structure-types";
import { conditionLabelOf } from "../../engine/structure-types";
import type { VerdictResult } from "../../ai/verdict";
import { dDayOf } from "../../funding/funding-map";

/** 값이 없을 때 쓰는 말 — 칸을 비우지도, 값을 지어내지도 않는다. */
export const CHECK_ORIGINAL = "공고 원문 확인";

const SECTION_TITLE = "text-base font-semibold leading-6 text-wedly-t1";
const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-wedly-accent focus-visible:ring-offset-2";

// ── 값 계산(순수 함수) ──────────────────────────────────────────────────

/** 월.일 두 자리 — 「2026.10.17」 → 「10.17」. 못 읽으면 빈 글자. */
function monthDay(value: string | null): string {
  const full = formatPolicyDate(value);
  return full ? full.slice(5) : "";
}

function validDate(value: string | null): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

const ALWAYS_RE = /상시|수시|연중/;

/**
 * 지원 금액 원문의 앞부분 — 첫 쉼표·괄호·줄바꿈 앞까지, 길면 줄인다. 큰 숫자 칸에 들어갈 만큼만.
 * 숫자 사이 천 단위 쉼표(「5,000만 원」)에서는 자르지 않는다 — 자르면 「최대 5」만 남는다(독립 리뷰 10/7).
 */
export function shortAmountOf(text: string): string {
  const first = text.trim().split(/[\n(（;·]|,(?!\d{3})/)[0].trim();
  if (!first) return "";
  return first.length > 16 ? `${first.slice(0, 16)}…` : first;
}

export interface SummaryCell {
  label: string;
  value: string;
  /** 값 아래 작은 글. */
  sub: string;
  /** 마감 7일 이내 — 값을 빨간 토큰 글자로. */
  hot?: boolean;
}

/** 요약 숫자 3칸 — 지원 금액 · 접수 마감 · 신청 기간. 값이 없으면 「공고 원문 확인」. */
export function summaryCellsOf(input: {
  supportAmountText: string;
  applyStart: string | null;
  applyEnd: string | null;
  applyPeriodText: string;
  now: Date;
}): [SummaryCell, SummaryCell, SummaryCell] {
  const { supportAmountText, applyStart, applyEnd, applyPeriodText, now } = input;
  const amount = shortAmountOf(supportAmountText);

  const end = validDate(applyEnd);
  const start = validDate(applyStart);
  let deadline: SummaryCell;
  if (end) {
    const left = dDayOf(end, now);
    deadline = {
      label: "접수 마감",
      value: left < 0 ? "마감" : left === 0 ? "D-DAY" : `D-${left}`,
      sub: formatPolicyDate(applyEnd),
      hot: left >= 0 && left <= 7,
    };
  } else if (ALWAYS_RE.test(applyPeriodText)) {
    deadline = { label: "접수 마감", value: "상시", sub: "마감일 없음" };
  } else {
    deadline = { label: "접수 마감", value: CHECK_ORIGINAL, sub: "" };
  }

  let period: SummaryCell;
  if (start && end && dDayOf(end, start) >= 0) {
    period = {
      label: "신청 기간",
      value: `${dDayOf(end, start) + 1}일`,
      sub: `${monthDay(applyStart)} ~ ${monthDay(applyEnd)}`,
    };
  } else {
    period = { label: "신청 기간", value: CHECK_ORIGINAL, sub: "" };
  }

  return [
    { label: "지원 금액", value: amount || CHECK_ORIGINAL, sub: amount ? "공고 원문 금액 글" : "" },
    deadline,
    period,
  ];
}

export type RowVerdict = ConditionVerdict;

export interface ConditionRow {
  /** 이름표(조건 종류) — AI 판정에서만 온 줄은 없다. */
  label: string;
  /** 공고 조건 — 원문 그대로. */
  condition: string;
  verdict: RowVerdict;
  /** 이 회사 값 · 근거. */
  evidence: string;
}

const AI_TO_VERDICT: Record<string, RowVerdict> = { 충족: "pass", 미충족: "fail", 확인필요: "unknown" };

/** 같은 조건인지 가르는 열쇠 — 공백·표점을 걷어 낸 글자. */
function conditionKey(text: string): string {
  return text.replace(/[\s.,:;·()（）「」"'-]/g, "");
}

/** 두 조건이 같은 말인가 — 같거나, 한쪽이 다른 쪽을 품으면(짧은 쪽이 6글자 이상일 때) 같은 조건으로 본다. */
function sameCondition(a: string, b: string): boolean {
  const x = conditionKey(a);
  const y = conditionKey(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.length >= 6 && long.includes(short);
}

/**
 * 기계 대조 결과(맞는 이유·조건 체크리스트)와 AI 판정 체크리스트를 한 표로 합친다 — 같은 조건이 두 번 나오지 않게.
 * 같은 조건이면 한 줄로 합친다: 기계가 「확인 필요」인데 AI 가 맞음/안 맞음을 말했으면 AI 쪽 판정을 쓰고,
 * 근거 글은 둘 다 있으면 잇는다. AI 에만 있는 조건은 뒤에 덧붙인다.
 */
export function mergeConditionRows(
  checks: readonly ConditionCheck[],
  aiChecklist: VerdictResult["checklist"] | null | undefined,
): ConditionRow[] {
  const rows: ConditionRow[] = checks.map((c) => ({
    label: conditionLabelOf(c.condition.key),
    condition: c.condition.rawText,
    verdict: c.verdict,
    evidence: c.note,
  }));
  for (const ai of aiChecklist ?? []) {
    const aiVerdict = AI_TO_VERDICT[ai.status] ?? "unknown";
    const note = ai.note ?? "";
    const same = rows.find((r) => sameCondition(r.condition, ai.condition));
    if (same) {
      if (same.verdict === "unknown" && aiVerdict !== "unknown") same.verdict = aiVerdict;
      if (note && !same.evidence.includes(note)) {
        same.evidence = same.evidence ? `${same.evidence} · ${note}` : note;
      }
    } else {
      rows.push({ label: "", condition: ai.condition, verdict: aiVerdict, evidence: note });
    }
  }
  return rows;
}

export interface RowCounts {
  total: number;
  pass: number;
  fail: number;
  unknown: number;
}

export function countRows(rows: readonly ConditionRow[]): RowCounts {
  const counts: RowCounts = { total: rows.length, pass: 0, fail: 0, unknown: 0 };
  for (const r of rows) counts[r.verdict] += 1;
  return counts;
}

/** 「5개 중 4개 맞음 · 1개 확인 필요」 — 0개인 갈래(확인 필요·안 맞음)는 말하지 않는다. */
export function conditionSummaryOf(counts: RowCounts): string {
  const parts = [`${counts.total}개 중 ${counts.pass}개 맞음`];
  if (counts.unknown > 0) parts.push(`${counts.unknown}개 확인 필요`);
  if (counts.fail > 0) parts.push(`${counts.fail}개 안 맞음`);
  return parts.join(" · ");
}

export type ScheduleView =
  | { kind: "bar"; startText: string; endText: string; todayText: string; percent: number }
  | { kind: "line"; text: string };

/** 접수 일정 — 시작·마감 날짜가 둘 다 있으면 막대, 상시·날짜 모름이면 한 줄. */
export function scheduleOf(input: {
  applyStart: string | null;
  applyEnd: string | null;
  applyPeriodText: string;
  now: Date;
}): ScheduleView {
  const { applyStart, applyEnd, applyPeriodText, now } = input;
  const start = validDate(applyStart);
  const end = validDate(applyEnd);
  if (start && end) {
    const total = dDayOf(end, start);
    if (total >= 0) {
      const passed = dDayOf(now, start);
      const left = dDayOf(end, now);
      const percent = total === 0 ? 100 : Math.min(100, Math.max(0, Math.round((passed / total) * 100)));
      const today = monthDay(now.toISOString());
      return {
        kind: "bar",
        startText: monthDay(applyStart),
        endText: monthDay(applyEnd),
        todayText: left < 0 ? `오늘 ${today} · 접수 마감` : `오늘 ${today} · 마감까지 ${left}일`,
        percent,
      };
    }
  }
  if (!end && ALWAYS_RE.test(applyPeriodText)) return { kind: "line", text: "상시 접수 — 마감일이 없어요." };
  if (end) {
    const left = dDayOf(end, now);
    return {
      kind: "line",
      text: left < 0 ? `마감 ${monthDay(applyEnd)} · 접수가 끝났어요.` : `마감 ${monthDay(applyEnd)} · 마감까지 ${left}일`,
    };
  }
  return { kind: "line", text: "접수 일정은 공고 원문에서 확인하세요." };
}

/** 첨부 종류 표시 — 파일 이름 끝의 확장자(대문자). 확장자가 없으면 분류값, 그것도 모르면 「파일」. */
export function attachmentKindOf(a: PolicyAttachment): string {
  // 글자로 시작하는 확장자만 — 「공고 v1.2」 같은 이름의 「2」를 종류로 읽지 않는다.
  const ext = /\.([A-Za-z][A-Za-z0-9]{0,4})$/.exec(a.name.trim())?.[1];
  if (ext) return ext.toUpperCase();
  return a.kind && a.kind !== "etc" ? a.kind.toUpperCase() : "파일";
}

/** 「첨부 모두 받기」는 첨부가 2개 이상일 때만 둔다(하나면 그 줄의 「받기」로 충분하다). */
export function showsDownloadAll(attachments: readonly PolicyAttachment[]): boolean {
  return attachments.length >= 2;
}

/** 한 번에 받는 첨부 수 — 서버 통로가 사람 한 명에게 1분에 6개까지만 내준다(`ATTACHMENT_RATE_PER_MIN`). */
export const DOWNLOAD_ALL_MAX = 6;

export interface DownloadAllResult {
  saved: number;
  failed: number;
  /** 한 번에 받는 수를 넘어 이번에 받지 않은 개수. */
  skipped: number;
}

/** `Content-Disposition` 의 파일 이름(filename* 우선). 없으면 null. */
export function fileNameFromDisposition(header: string | null): string | null {
  if (!header) return null;
  const star = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (star) {
    try {
      return decodeURIComponent(star[1].trim());
    } catch {
      /* 아래 일반 이름으로 */
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(header);
  return plain ? plain[1].trim() : null;
}

/**
 * 우리 통로(같은 출처)인가 — 상대 경로(`/api/...`, `//` 로 시작하는 것은 제외)이거나 지금 페이지와 출처가 같은 주소만.
 * 외부 출처 주소는 「모두 받기」가 요청 자체를 보내지 않는다(독립 리뷰 10/7) — 그 줄의 「받기」로 연다.
 */
export function isOwnAttachmentUrl(url: string, origin: string | null): boolean {
  const u = url.trim();
  if (u.startsWith("/") && !u.startsWith("//")) return true;
  if (!origin) return false;
  try {
    return new URL(u).origin === origin;
  } catch {
    return false;
  }
}

/** 파일이 아닌 답(오류 페이지·JSON 오류) — 200 이어도 저장하지 않고 실패로 센다. */
const NOT_A_FILE_RE = /html|json/i;

/**
 * 첨부를 차례로 받아 저장한다 — 새 창을 연달아 열면 브라우저가 첫 창 뒤를 막고 막힌 줄도 모르므로,
 * 같은 주소(우리 통로)를 하나씩 불러 파일로 저장하고 성공·실패 개수를 돌려준다.
 * 통로가 원래 사이트로 넘겨 보내는 출처(302)나 오류 답은 실패로 센다 — 그 줄의 「받기」로 받으면 된다.
 */
export async function downloadAttachmentsInOrder(
  attachments: readonly PolicyAttachment[],
  deps: {
    fetchFn?: typeof fetch;
    save?: (blob: Blob, name: string) => void;
    /** 지금 페이지 출처 — 시험에서 넣는다. 기본은 브라우저의 `location.origin`. */
    origin?: string | null;
  } = {},
): Promise<DownloadAllResult> {
  const fetchFn = deps.fetchFn ?? fetch;
  const origin = deps.origin !== undefined ? deps.origin : (globalThis.location?.origin ?? null);
  const save = deps.save ?? saveBlob;
  const targets = attachments.slice(0, DOWNLOAD_ALL_MAX);
  let saved = 0;
  let failed = 0;
  for (const a of targets) {
    if (!isOwnAttachmentUrl(a.url, origin)) {
      failed += 1;
      continue;
    }
    try {
      // redirect:"manual" — 통로가 원래 사이트로 넘기면(302) 따라가지 않고 opaqueredirect 로 멈춘다.
      const res = await fetchFn(a.url, { credentials: "same-origin", redirect: "manual" });
      const type = res.headers.get("content-type") ?? "";
      if (!res.ok || res.type === "opaqueredirect" || res.redirected || NOT_A_FILE_RE.test(type)) {
        failed += 1;
        continue;
      }
      save(await res.blob(), fileNameFromDisposition(res.headers.get("content-disposition")) ?? a.name);
      saved += 1;
    } catch {
      failed += 1;
    }
  }
  return { saved, failed, skipped: attachments.length - targets.length };
}

function saveBlob(blob: Blob, name: string): void {
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(href), 60_000);
}

/** 받기 결과 한 줄 — 다 받았으면 짧게, 못 받은 것이 있으면 어떻게 하면 되는지까지. */
export function downloadAllMessageOf(r: DownloadAllResult): string {
  const rest = r.failed + r.skipped;
  if (rest === 0) return `${r.saved}개를 받았어요`;
  return `${r.saved}개를 받았어요 · ${rest}개는 위 목록의 「받기」로 받아 주세요`;
}

// ── 그리는 부품 ─────────────────────────────────────────────────────────

/** 구역 제목 — 색 타일 아이콘 + 소제목(16/600) + 오른쪽 작은 글. */
function BlockTitle({ icon: Icon, tile, ink, title, aside }: {
  icon: LucideIcon;
  tile: string;
  ink: string;
  title: string;
  aside?: ReactNode;
}) {
  return (
    <div className="mb-2 flex items-center gap-2.5">
      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${tile}`}>
        <Icon className={`h-4 w-4 ${ink}`} />
      </span>
      <h3 className={SECTION_TITLE}>{title}</h3>
      {aside !== undefined && <span className="ml-auto text-xs leading-[18px] text-wedly-t2">{aside}</span>}
    </div>
  );
}

/** 요약 숫자 3칸 — 한 줄 grid. 좁은 화면에서도 세 칸을 유지하되 값이 길면 줄바꿈한다. */
export function SummaryCells({ cells }: { cells: readonly SummaryCell[] }) {
  return (
    <dl className="mt-4 grid grid-cols-3 gap-2">
      {cells.map((c) => (
        <div key={c.label} className="min-w-0 rounded-[14px] border border-wedly-bd/60 bg-wedly-bg-gray p-3">
          <dt className="text-xs leading-[18px] text-wedly-t2">{c.label}</dt>
          <dd
            className={`mt-0.5 break-keep break-words text-base font-semibold leading-6 tabular-nums ${
              c.hot ? "text-wedly-red-ink" : "text-wedly-t1"
            }`}
          >
            {c.value}
          </dd>
          {c.sub && <dd className="break-keep break-words text-xs leading-[18px] text-wedly-t2">{c.sub}</dd>}
        </div>
      ))}
    </dl>
  );
}

const VERDICT_FACE: Record<RowVerdict, { label: string; dot: string; text: string }> = {
  pass: { label: "맞음", dot: "bg-wedly-green", text: "text-wedly-green-ink" },
  unknown: { label: "확인 필요", dot: "bg-wedly-gold-ink", text: "text-wedly-t1" },
  fail: { label: "안 맞음", dot: "bg-wedly-red", text: "text-wedly-red-ink" },
};

/** 신청 자격 대조표 — 열: 공고 조건 | 판정 | 이 회사 값 · 근거. 판정은 색 점 + 글자를 함께 쓴다. */
export function ConditionTable({ rows, emptyNote }: { rows: readonly ConditionRow[]; emptyNote: string }) {
  return (
    <section aria-label="신청 자격 대조" className="mt-6">
      <BlockTitle
        icon={Check}
        tile="bg-wedly-bg-green"
        ink="text-wedly-green-ink"
        title="신청 자격 대조"
        aside={rows.length > 0 ? conditionSummaryOf(countRows(rows)) : undefined}
      />
      {rows.length === 0 ? (
        <div className="rounded-[14px] border border-wedly-bd/60 px-4 py-3 text-sm leading-[22px] text-wedly-t2">
          {emptyNote}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-[14px] border border-wedly-bd/60">
          <table className="w-full border-collapse text-left text-sm leading-[22px]">
            <thead>
              <tr className="bg-wedly-bg-gray text-xs leading-[18px] text-wedly-t2">
                <th scope="col" className="px-3 py-2 font-semibold">공고 조건</th>
                <th scope="col" className="w-24 px-3 py-2 font-semibold">판정</th>
                <th scope="col" className="px-3 py-2 font-semibold">이 회사 값 · 근거</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const face = VERDICT_FACE[r.verdict];
                return (
                  <tr key={`${r.condition}-${i}`} className="border-t border-wedly-bd/60 align-top">
                    <td className="break-keep break-words px-3 py-2.5 text-wedly-t1">
                      {r.label && <span className="font-semibold">{r.label}: </span>}
                      {r.condition}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5">
                      <span className={`inline-flex items-center gap-1.5 text-xs font-semibold leading-[18px] ${face.text}`}>
                        <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${face.dot}`} />
                        {face.label}
                      </span>
                    </td>
                    <td className="break-keep break-words px-3 py-2.5 tabular-nums text-wedly-t2">
                      {r.evidence || "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** 지원 대상·내용 표 — 이름표 칸 | 값 칸, 줄마다 구분선. 지원 금액은 원문 그대로(긴 글 전체). */
export function SupportTable({ target, benefit, amountText }: {
  target: string;
  benefit: string;
  amountText: string;
}) {
  const rows: Array<[string, string]> = [
    ["지원 대상", target],
    ["지원 내용", benefit],
    ["지원 금액", amountText],
  ];
  return (
    <section aria-label="지원 대상·내용" className="mt-6">
      <BlockTitle icon={Coins} tile="bg-wedly-bg-blue" ink="text-wedly-accent-ink" title="지원 대상·내용" />
      <dl className="overflow-hidden rounded-[14px] border border-wedly-bd/60">
        {rows.map(([name, value], i) => (
          <div
            key={name}
            className={`grid grid-cols-[6.5rem_minmax(0,1fr)] gap-3 px-4 py-2.5 text-sm leading-[22px] ${
              i > 0 ? "border-t border-wedly-bd/60" : ""
            }`}
          >
            <dt className="text-wedly-t2">{name}</dt>
            <dd className="whitespace-pre-wrap break-keep break-words text-wedly-t1">{value.trim() || CHECK_ORIGINAL}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** 접수 일정 — 시작~마감 막대 위에 오늘 위치 점. 상시·날짜 모름이면 막대 대신 한 줄. 평가·발표 일정은 원문 안내만. */
export function ScheduleBlock({ view }: { view: ScheduleView }) {
  return (
    <section aria-label="접수 일정" className="mt-6">
      <BlockTitle icon={Clock} tile="bg-wedly-bg-gray" ink="text-wedly-t2" title="접수 일정" />
      <div className="rounded-[14px] border border-wedly-bd/60 px-4 py-3">
        {view.kind === "bar" ? (
          <>
            <div className="flex items-center justify-between gap-2 text-xs leading-[18px]">
              <span className="text-wedly-t2">
                <span className="font-semibold text-wedly-t1">접수 시작</span> {view.startText}
              </span>
              <span className="font-semibold text-wedly-accent-ink">{view.todayText}</span>
              <span className="text-wedly-t2">
                <span className="font-semibold text-wedly-t1">마감</span> {view.endText}
              </span>
            </div>
            <div className="relative mt-3 h-2 rounded-full bg-wedly-bg-gray" data-schedule-bar="">
              <div className="h-full rounded-full bg-wedly-accent" style={{ width: `${view.percent}%` }} />
              <span
                aria-hidden="true"
                data-today-dot=""
                className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-wedly-accent-ink"
                style={{ left: `${view.percent}%` }}
              />
            </div>
          </>
        ) : (
          <div className="text-sm leading-[22px] text-wedly-t1">{view.text}</div>
        )}
        <p className="mt-2 text-xs leading-[18px] text-wedly-t2">평가·발표 일정은 공고 원문에서 확인하세요.</p>
      </div>
    </section>
  );
}

/** 첨부 파일 줄 — 종류(확장자)·이름·받기. 첨부가 없으면 아무것도 안 그린다. */
export function AttachmentRows({ attachments }: { attachments: readonly PolicyAttachment[] }) {
  if (attachments.length === 0) return null;
  return (
    <section aria-label="첨부 파일" className="mt-6">
      <BlockTitle
        icon={Paperclip}
        tile="bg-wedly-bg-purple"
        ink="text-wedly-purple-ink"
        title="첨부 파일"
        aside={`${attachments.length}개`}
      />
      <ul className="space-y-1.5">
        {attachments.map((a, i) => (
          <li
            key={`${a.url}-${i}`}
            className="flex items-center gap-3 rounded-[14px] border border-wedly-bd/60 px-3 py-2"
          >
            <span className="inline-flex h-9 w-11 shrink-0 items-center justify-center rounded-lg bg-wedly-bg-gray text-xs font-semibold text-wedly-t2">
              {attachmentKindOf(a)}
            </span>
            {/* 원본 파일명 그대로 — 줄여서 무슨 서류인지 못 알아보게 하지 않는다. */}
            <span className="min-w-0 flex-1 break-keep break-words text-sm leading-[22px] text-wedly-t1">{a.name}</span>
            <a
              href={a.url}
              target="_blank"
              rel="noreferrer"
              className={`inline-flex h-8 shrink-0 items-center rounded-[10px] border border-wedly-bd bg-white px-3 text-xs font-semibold text-wedly-t1 transition-colors hover:bg-wedly-bg-gray ${FOCUS_RING}`}
            >
              받기
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * 칸 아래 고정 줄 — 「공고 원문 보기」(주소가 있을 때) · 「첨부 모두 받기」(첨부 2개 이상일 때).
 * 둘 다 없으면 줄 자체를 그리지 않는다. `urlPrimary` 가 거짓이면 원문 단추를 보조 모양으로 둔다
 * (위에 「바로 신청하러 가기」 주 단추가 있을 때 — 화면당 주 단추는 하나).
 */
export function DetailActionBar({ url, attachments, urlPrimary, primaryClass, secondaryClass, edge = "card" }: {
  url: string;
  attachments: readonly PolicyAttachment[];
  urlPrimary: boolean;
  primaryClass: string;
  secondaryClass: string;
  /** `card`: 상세 카드(p-4) 안 · `pane`: 결과 화면 오른쪽 칸(바닥 여백 없는 스크롤 칸) 안 — 칸 바닥에 붙는다. */
  edge?: "card" | "pane";
}) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const hasUrl = /^https?:\/\//i.test(url.trim());
  const hasAll = showsDownloadAll(attachments);
  if (!hasUrl && !hasAll) return edge === "pane" ? <div aria-hidden="true" className="h-4 shrink-0 min-[821px]:h-6" /> : null;
  const bar =
    edge === "pane"
      ? "sticky bottom-0 z-10 -mx-4 mt-auto flex flex-wrap items-center gap-2 border-t border-wedly-bd bg-white px-4 py-3 min-[821px]:-mx-6 min-[821px]:px-6"
      : "sticky bottom-0 z-10 -mx-4 -mb-4 mt-4 flex flex-wrap items-center gap-2 rounded-b-2xl border-t border-wedly-bd bg-white px-4 py-3";
  return (
    <>
    {edge === "pane" && <div aria-hidden="true" className="h-6 shrink-0" />}
    <div className={bar}>
      {hasUrl && (
        <a href={url} target="_blank" rel="noreferrer" className={urlPrimary ? primaryClass : secondaryClass}>
          공고 원문 보기
        </a>
      )}
      {hasAll && (
        <button
          type="button"
          disabled={busy}
          aria-busy={busy}
          onClick={async () => {
            setBusy(true);
            setNote("");
            const r = await downloadAttachmentsInOrder(attachments);
            setNote(downloadAllMessageOf(r));
            setBusy(false);
          }}
          className={`${secondaryClass} disabled:cursor-wait disabled:opacity-60`}
        >
          {busy ? "받는 중…" : "첨부 모두 받기"}
        </button>
      )}
      {note && (
        <span role="status" className="text-wedly-hint text-wedly-t2">
          {note}
        </span>
      )}
    </div>
    </>
  );
}
