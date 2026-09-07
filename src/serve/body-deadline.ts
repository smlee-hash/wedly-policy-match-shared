import { endOfKstDay, startOfKstDay } from "../collect/board/engine";

export interface BodyDeadline {
  applyStart: Date | null;
  applyEnd: Date | null;
  evidence: string;
}

const MONEY_UNIT = String.raw`(?!\s*(?:억|천만|백만|만|원|%|퍼센트|배|명|개|건|년|주|시간|kg|㎡))`;
const M = String.raw`(1[0-2]|0?[1-9])`;
const D = String.raw`(3[01]|[12]\d|0?[1-9])`;
const DATE_RE = new RegExp(
  String.raw`(20\d{2})\s*[.\-/년]\s*${M}\s*[.\-/월]\s*${D}(?!\d)\s*일?${MONEY_UNIT}` +
    String.raw`|(?<!\d)(\d{2})\s*[.\-/]\s*${M}\s*[.\-/]\s*${D}(?!\d)\s*일?${MONEY_UNIT}` +
    String.raw`|(?<!\d)${M}\s*[./월]\s*${D}(?!\d)\s*일?${MONEY_UNIT}`,
  "g",
);

// 「공고일정」은 수원도시재단 상세의 접수기간 라벨이다(실측 「공고일정 : 2026.08.27 9시 ~ 2026.09.17 18시」).
// 목록에 날짜 칸이 없는 출처라 이 줄이 유일한 마감 근거다 — 라벨을 모르면 마감이 영영 안 선다.
const PERIOD_LABEL = /신청\s*[·ㆍ・]\s*접수기간|접수기간|신청기간|모집기간|접수 기간|신청 기간|공모기간|공고일정/g;
const KEYWORD = /접수마감|신청마감|마감|기한|까지/g;
const TILDE = /[~～〜∼]/;
const OPEN_ENDED = /예산\s*소진|상시|선착순/;

type FoundDate = { year: number | null; month: number; day: number; index: number };
let nowForYearWrap = Date.now();
const NOW_FOR_YEAR_WRAP = () => nowForYearWrap;

function clip(s: string): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length <= 80 ? t : t.slice(0, 80);
}

function kstYearOf(d: Date): number {
  return new Date(d.getTime() + 9 * 3_600_000).getUTCFullYear();
}

function findDates(text: string): FoundDate[] {
  const out: FoundDate[] = [];
  for (const m of text.matchAll(DATE_RE)) {
    const index = m.index ?? 0;
    if (m[1] != null) {
      out.push({ year: Number(m[1]), month: Number(m[2]), day: Number(m[3]), index });
    } else if (m[4] != null) {
      out.push({ year: 2000 + Number(m[4]), month: Number(m[5]), day: Number(m[6]), index });
    } else if (m[7] != null) {
      out.push({ year: null, month: Number(m[7]), day: Number(m[8]), index });
    }
  }
  return out;
}

function toStart(d: FoundDate | undefined, fallbackYear: number): Date | null {
  if (!d) return null;
  return startOfKstDay(d.year ?? fallbackYear, d.month, d.day);
}

function toEnd(d: FoundDate, fallbackYear: number, start: Date | null): Date | null {
  const year = d.year ?? fallbackYear;
  let end = endOfKstDay(year, d.month, d.day);
  if (end == null) return null;
  if (d.year == null && start != null && end.getTime() < start.getTime()) {
    end = endOfKstDay(year + 1, d.month, d.day);
  } else if (d.year == null && start == null && end.getTime() < NOW_FOR_YEAR_WRAP() - 30 * 86_400_000) {
    // 「신청마감 1월 15일」을 12월에 읽으면 올해가 아니라 다음 해다(적대 리뷰 중간).
    end = endOfKstDay(year + 1, d.month, d.day);
  }
  return end;
}

function yearsShift(d: Date, years: number): Date {
  const x = new Date(d.getTime());
  x.setUTCFullYear(x.getUTCFullYear() + years);
  return x;
}

function validate(r: BodyDeadline, now: Date): BodyDeadline | null {
  if (r.applyStart != null && r.applyEnd != null && r.applyStart.getTime() > r.applyEnd.getTime()) {
    return null;
  }
  if (r.applyEnd != null) {
    if (r.applyEnd.getTime() > yearsShift(now, 3).getTime()) return null;
    if (r.applyEnd.getTime() < yearsShift(now, -2).getTime()) return null;
  }
  return r;
}

function parsePeriodWindow(window: string, now: Date, evidence: string): BodyDeadline | null {
  const nowYear = kstYearOf(now);
  const tildeAt = window.search(TILDE);
  if (tildeAt < 0) {
    if (OPEN_ENDED.test(window) && findDates(window).length === 0) {
      return { applyStart: null, applyEnd: null, evidence };
    }
    return null;
  }
  const left = window.slice(0, tildeAt);
  const right = window.slice(tildeAt + 1);
  const leftDates = findDates(left);
  const rightDates = findDates(right);
  const startRaw = leftDates[leftDates.length - 1];
  const endRaw = rightDates[0];
  if (endRaw == null && OPEN_ENDED.test(right)) {
    const start = toStart(startRaw, startRaw?.year ?? nowYear);
    return { applyStart: start, applyEnd: null, evidence };
  }
  if (endRaw == null) return null;
  const contextYear = startRaw?.year ?? endRaw.year ?? nowYear;
  const start = toStart(startRaw, contextYear);
  const end = toEnd(endRaw, start != null ? kstYearOf(start) : contextYear, start);
  if (end == null) return null;
  return validate({ applyStart: start, applyEnd: end, evidence }, now);
}

function closestDate(dates: FoundDate[], keywordIndexInWindow: number): FoundDate {
  let best = dates[0];
  let bestDist = Math.abs(dates[0].index - keywordIndexInWindow);
  for (const d of dates) {
    const dist = Math.abs(d.index - keywordIndexInWindow);
    if (dist < bestDist || (dist === bestDist && d.index < best.index)) {
      best = d;
      bestDist = dist;
    }
  }
  return best;
}

function fromKeyword(text: string, now: Date): BodyDeadline | null {
  let openEnded: BodyDeadline | null = null;
  const nowYear = kstYearOf(now);
  for (const m of text.matchAll(KEYWORD)) {
    const idx = m.index ?? 0;
    const from = Math.max(0, idx - 40);
    const to = Math.min(text.length, idx + m[0].length + 40);
    const window = text.slice(from, to);
    const evidence = clip(window);
    const dates = findDates(window);
    // 「2026.09.01부터 예산 소진 시까지」처럼 열린 표현이 같은 창에 있으면 그 날짜는 마감이 아니다(적대 리뷰 치명).
    if (OPEN_ENDED.test(window)) { openEnded = { applyStart: null, applyEnd: null, evidence }; continue; }
    if (dates.length > 0) {
      const picked = closestDate(dates, idx - from);
      const end = toEnd(picked, picked.year ?? nowYear, null);
      if (end != null) {
        const v = validate({ applyStart: null, applyEnd: end, evidence }, now);
        if (v) return v;
      }
    }
    if (OPEN_ENDED.test(window)) {
      openEnded = { applyStart: null, applyEnd: null, evidence };
    }
  }
  return openEnded;
}

export function extractDeadlineFromText(text: string, now?: Date): BodyDeadline | null {
  if (!text.trim()) return null;
  const at = now ?? new Date();
  nowForYearWrap = at.getTime();
  // 라벨이 여럿이면(「기존 접수기간 … / 연장 접수기간 …」) 가장 늦은 마감을 택한다(적대 리뷰 높음).
  // 창 안에 열린 표현(상시·예산 소진·선착순)이 있으면 그 창은 마감으로 읽지 않는다.
  let best: BodyDeadline | null = null;
  for (const m of text.matchAll(PERIOD_LABEL)) {
    const startIdx = m.index ?? 0;
    const after = startIdx + m[0].length;
    const window = text.slice(after, after + 120);
    if (OPEN_ENDED.test(window)) {
      // 열린 기간이라도 시작일은 살린다(「2026.09.01 ~ 예산 소진 시까지」 → 개시형).
      const first = findDates(window)[0];
      const start = first ? toStart(first, first.year ?? kstYearOf(at)) : null;
      if (!best) best = { applyStart: start, applyEnd: null, evidence: clip(text.slice(startIdx, after + 120)) };
      continue;
    }
    const evidence = clip(text.slice(startIdx, after + 120));
    const parsed = parsePeriodWindow(window, at, evidence);
    if (!parsed) continue;
    if (!best || !best.applyEnd || (parsed.applyEnd && parsed.applyEnd.getTime() > best.applyEnd.getTime())) best = parsed;
  }
  if (best) return best;
  return fromKeyword(text, at);
}
