"use client";

// 「연락 예정 업체」 캘린더 보기 — 목록과 같은 응답(ContactsView.companies)으로 그린다. 새 통로는 없다.
// 업체 하나는 가장 가까운 마감일 칸에 칩으로 한 번만 나온다. 칩을 누르면 캘린더 아래 「고른 업체」 판이 열린다.
// 날짜 셈은 전부 순수 함수(서울 날짜 글자 YYYY-MM-DD 로만 셈한다)라 그려서·값으로 잴 수 있다.
import { useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ContactCompanyRow } from "../../serve/policy-deadline/types";
import { buttonClass, sectionCardClass } from "./classes";
import { dateLabel, type ContactListRow } from "./deadline-view";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

/** 칩 색 — D-n 7일 안 빨강 · 14일 안 금색 · 그 뒤 파랑(목록 D-n 딱지와 같은 구간·같은 토큰 계열). */
export type ChipTone = "red" | "gold" | "blue";

export function chipTone(dDay: number): ChipTone {
  if (dDay <= 7) return "red";
  return dDay <= 14 ? "gold" : "blue";
}

const CHIP_TONE_CLASS: Record<ChipTone, string> = {
  red: "border-l-wedly-red-ink",
  gold: "border-l-wedly-gold-ink",
  blue: "border-l-wedly-accent",
};
const LEGEND_DOT_CLASS: Record<ChipTone, string> = {
  red: "bg-wedly-red-ink",
  gold: "bg-wedly-gold-ink",
  blue: "bg-wedly-accent",
};

/** 오늘(서울 날짜) YYYY-MM-DD. */
export function kstDay(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(now);
}

/** YYYY-MM-DD 에 날수를 더한다(음수 가능). 형식이 다르면 받은 글자 그대로. */
export function shiftDay(day: string, delta: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return day;
  const moved = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + delta));
  return `${moved.getUTCFullYear()}-${String(moved.getUTCMonth() + 1).padStart(2, "0")}-${String(moved.getUTCDate()).padStart(2, "0")}`;
}

export interface MonthRef {
  year: number;
  /** 1~12 */
  month: number;
}

/** YYYY-MM-DD 가 속한 달. */
export function monthOf(day: string): MonthRef {
  return { year: Number(day.slice(0, 4)), month: Number(day.slice(5, 7)) };
}

/** 달을 옮긴다 — 앞·뒤로 얼마든지(해가 넘어가도 맞다). */
export function addMonths(ref: MonthRef, delta: number): MonthRef {
  const index = ref.year * 12 + (ref.month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

/** 캘린더에 올릴 업체 한 줄 — 종류 거르기를 지난 뒤의 값이다. */
export interface CalendarEntry {
  customerKey: string;
  companyName: string;
  consultant: string;
  /** 칩이 놓이는 날(서울 날짜). */
  day: string;
  /** 그 날의 D-n. */
  dDay: number;
  /** 공고 수(종류 거르기 안). */
  count: number;
}

/**
 * 연락 예정 줄 → 캘린더 줄. 종류를 거른 목록(`contactRowsFor`)이면 가장 가까운 마감이 그 종류 공고 기준으로 다시 잡혀 있다.
 * 서버가 준 가장 가까운 마감일(nearestApplyEnd)에서 D-n 차이만큼 옮겨, 목록의 D-n 딱지와 같은 날에 놓는다.
 * (거르지 않았으면 차이가 0이라 nearestApplyEnd 그대로다.)
 */
export function calendarEntries(rows: readonly ContactListRow[]): CalendarEntry[] {
  return rows.map(({ row, kinds, nearestDDay }) => ({
    customerKey: row.customerKey,
    companyName: row.companyName,
    consultant: row.consultant,
    day: shiftDay(row.nearestApplyEnd, nearestDDay - row.nearestDDay),
    dDay: nearestDDay,
    count: kinds.reduce((sum, k) => sum + k.count, 0),
  }));
}

export interface CalendarCell {
  /** 그 달의 몇 일. */
  date: number;
  day: string;
  weekday: number;
  isToday: boolean;
  entries: CalendarEntry[];
}

export interface CalendarMonth {
  year: number;
  month: number;
  /** 1일 앞의 빈 칸 수(일요일 시작). */
  leading: number;
  cells: CalendarCell[];
  /** 이달에 칩이 있는 업체 수 · 이 달 앞(지난달 이전) · 이 달 뒤(다음 달 이후). */
  inMonth: number;
  before: number;
  after: number;
}

/** 한 달 칸 — 칩은 날짜별로, 같은 날 안에서는 받은 순서(마감 가까운 순·업체명 순) 그대로. */
export function buildMonth(entries: readonly CalendarEntry[], ref: MonthRef, today: string): CalendarMonth {
  const monthKey = `${ref.year}-${String(ref.month).padStart(2, "0")}`;
  const total = new Date(Date.UTC(ref.year, ref.month, 0)).getUTCDate();
  const byDay = new Map<string, CalendarEntry[]>();
  let before = 0;
  let after = 0;
  let inMonth = 0;
  for (const entry of entries) {
    const entryMonth = entry.day.slice(0, 7);
    if (entryMonth === monthKey) {
      inMonth += 1;
      byDay.set(entry.day, [...(byDay.get(entry.day) ?? []), entry]);
    } else if (entryMonth < monthKey) before += 1;
    else after += 1;
  }
  const cells: CalendarCell[] = [];
  for (let date = 1; date <= total; date += 1) {
    const day = `${monthKey}-${String(date).padStart(2, "0")}`;
    cells.push({
      date,
      day,
      weekday: new Date(Date.UTC(ref.year, ref.month - 1, date)).getUTCDay(),
      isToday: day === today,
      entries: byDay.get(day) ?? [],
    });
  }
  return { year: ref.year, month: ref.month, leading: new Date(Date.UTC(ref.year, ref.month - 1, 1)).getUTCDay(), cells, inMonth, before, after };
}

/** 머리 글 「이달 N곳 · 지난달에 N곳 · 다음 달에 N곳」 — 0곳인 조각은 뺀다(「이달」은 0이어도 둔다). */
export function monthHint(month: Pick<CalendarMonth, "inMonth" | "before" | "after">): string {
  return [
    `이달 ${month.inMonth}곳`,
    ...(month.before > 0 ? [`지난달에 ${month.before}곳`] : []),
    ...(month.after > 0 ? [`다음 달에 ${month.after}곳`] : []),
  ].join(" · ");
}

/** 좁은 화면 날짜 줄 글자 — 「11/17 (화)」. */
export function narrowDayLabel(month: number, date: number, weekday: number): string {
  return `${month}/${date} (${WEEKDAYS[weekday]})`;
}

const NAV = "inline-flex size-8 items-center justify-center rounded-lg border border-wedly-bd bg-white text-wedly-t1 hover:bg-wedly-bg-gray focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-wedly-accent";

function Chip({ entry, selected, onSelect }: { entry: CalendarEntry; selected: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      title={`${entry.companyName} · 공고 ${entry.count}건`}
      onClick={onSelect}
      className={`block w-full overflow-hidden text-ellipsis whitespace-nowrap rounded-md border border-l-4 border-wedly-bd px-1.5 py-0.5 text-left text-wedly-hint font-bold text-wedly-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-wedly-accent ${CHIP_TONE_CLASS[chipTone(entry.dDay)]} ${selected ? "bg-wedly-bg-blue ring-1 ring-wedly-accent" : "bg-white hover:bg-wedly-bg-gray"}`}
    >
      {entry.companyName}
      <span className="ml-1 font-semibold text-wedly-t2">{entry.count}건</span>
    </button>
  );
}

/** 캘린더 한 달 — 상태를 갖지 않는다. 달 옮기기·칩 고르기는 받은 함수를 부른다. */
export function CalendarView({
  entries,
  monthRef,
  today,
  selectedKey,
  onSelect,
  onMonth,
}: {
  entries: readonly CalendarEntry[];
  /** 보일 달. */
  monthRef: MonthRef;
  today: string;
  selectedKey: string | null;
  onSelect: (customerKey: string) => void;
  onMonth: (delta: number) => void;
}) {
  const model = buildMonth(entries, monthRef, today);
  return (
    <div className={sectionCardClass("sm", "p-3 sm:p-4")}>
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-2">
        <button type="button" className={NAV} aria-label="이전 달" onClick={() => onMonth(-1)}><ChevronLeft size={16} aria-hidden /></button>
        <h3 className="text-wedly-sub font-semibold text-wedly-navy">{model.year}년 {model.month}월</h3>
        <button type="button" className={NAV} aria-label="다음 달" onClick={() => onMonth(1)}><ChevronRight size={16} aria-hidden /></button>
        <span className="text-wedly-hint text-wedly-t2">{monthHint(model)}</span>
        <span className="inline-flex flex-wrap gap-x-2.5 gap-y-1 text-wedly-hint text-wedly-t2 sm:ml-auto" aria-label="색 설명">
          {(["red", "gold", "blue"] as const).map((tone, i) => (
            <span key={tone} className="inline-flex items-center gap-1">
              <i aria-hidden className={`size-2 rounded-full ${LEGEND_DOT_CLASS[tone]}`} />
              {["7일 안", "14일 안", "그 뒤"][i]}
            </span>
          ))}
        </span>
      </div>
      <div className="hidden grid-cols-7 rounded-t-lg bg-wedly-accent text-wedly-sub font-semibold text-white sm:grid" aria-hidden>
        {WEEKDAYS.map((w) => <span key={w} className="py-1.5 text-center">{w}</span>)}
      </div>
      {/* 좁은 화면(640px 아래)은 빈 날을 숨기고 업체가 있는 날만 「11/17 (화)」 줄로 보인다. */}
      <div className="mt-1 grid grid-cols-1 gap-1 sm:grid-cols-7">
        {Array.from({ length: model.leading }, (_, i) => <div key={`blank-${i}`} className="hidden sm:block" aria-hidden />)}
        {model.cells.map((cell) => (
          <div
            key={cell.day}
            data-day={cell.day}
            className={`min-w-0 flex-col gap-1 rounded-lg border p-1.5 sm:min-h-24 sm:flex ${cell.entries.length ? "flex" : "hidden"} ${cell.isToday ? "border-wedly-accent ring-1 ring-inset ring-wedly-accent" : "border-wedly-bd"}`}
          >
            <span className="flex items-baseline gap-1 text-wedly-hint font-bold text-wedly-t2">
              <span className="sm:hidden">{narrowDayLabel(model.month, cell.date, cell.weekday)}</span>
              <span className="hidden sm:inline">{cell.date}</span>
              {cell.isToday && <span className="text-wedly-hint font-bold text-wedly-accent-ink">오늘</span>}
            </span>
            {cell.entries.map((entry) => (
              <Chip key={entry.customerKey} entry={entry} selected={selectedKey === entry.customerKey} onSelect={() => onSelect(entry.customerKey)} />
            ))}
          </div>
        ))}
      </div>
      {model.inMonth === 0 && <p className="py-4 text-center text-wedly-sub text-wedly-t2">이달에는 연락할 업체가 없습니다</p>}
    </div>
  );
}

/** 「고른 업체」 판 — 업체 이름·(담당)·가장 가까운 마감·공고 수·닫기, 그 아래는 쓰는 쪽이 넘긴 공고 표. */
export function PickedCompany({
  entry,
  showConsultant,
  onClose,
  children,
}: {
  entry: CalendarEntry;
  showConsultant: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <section aria-label="고른 업체" className="mt-3 rounded-xl border border-wedly-accent bg-wedly-bg-page px-3 py-2.5">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="min-w-0">
          <b className="break-keep text-wedly-section font-semibold text-wedly-navy">{entry.companyName}</b>{" "}
          <span className="text-wedly-hint text-wedly-t2">
            {showConsultant && <>담당 {entry.consultant || <span className="text-wedly-red-ink">없음</span>} · </>}
            가장 가까운 마감 {dateLabel(entry.day)} · 공고 {entry.count}건
          </span>
        </span>
        <button type="button" className={buttonClass("secondary", "xs")} onClick={onClose}>닫기</button>
      </div>
      {children}
    </section>
  );
}

export interface ContactsCalendarProps {
  /** 종류를 거른 연락 예정 줄 — `contactRowsFor` 의 결과 그대로. */
  rows: readonly ContactListRow[];
  /** 담당 이름을 보일지 — 목록 보기와 같은 값. */
  showConsultant: boolean;
  /** 지금 고른 업체 열쇠 — 없거나 줄에 없으면 판을 열지 않는다. */
  selectedKey: string | null;
  onSelect: (customerKey: string | null) => void;
  /** 고른 업체 아래 공고 표(「업무 현황에 추가」 포함) — 목록 보기의 펼친 표와 같은 것을 넘긴다. */
  renderCompany: (row: ContactCompanyRow) => ReactNode;
  /** 「오늘」 — 시험에서 날짜를 고정할 때만 넘긴다. */
  now?: Date;
}

/** 첫 달은 오늘(서울 날짜)의 달 — ‹ › 로 앞뒤 어느 달이든 옮긴다. */
export default function ContactsCalendar({ rows, showConsultant, selectedKey, onSelect, renderCompany, now }: ContactsCalendarProps) {
  const [offset, setOffset] = useState(0);
  const today = kstDay(now ?? new Date());
  const entries = calendarEntries(rows);
  const picked = selectedKey === null ? undefined : entries.find((e) => e.customerKey === selectedKey);
  const pickedRow = picked ? rows.find((r) => r.row.customerKey === picked.customerKey)?.row : undefined;
  return (
    <div>
      <CalendarView
        entries={entries}
        monthRef={addMonths(monthOf(today), offset)}
        today={today}
        selectedKey={picked ? picked.customerKey : null}
        onSelect={(key) => onSelect(selectedKey === key ? null : key)}
        onMonth={(delta) => setOffset((current) => current + delta)}
      />
      {picked && pickedRow && (
        <PickedCompany entry={picked} showConsultant={showConsultant} onClose={() => onSelect(null)}>
          {renderCompany(pickedRow)}
        </PickedCompany>
      )}
    </div>
  );
}
