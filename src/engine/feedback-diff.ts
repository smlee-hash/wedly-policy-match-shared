/**
 * 피드백 최신 회차와 기업상태표(판정에 쓰는 값)가 **다른 칸**만 골라 내는 순수 함수 — React·DB 없음.
 *
 * ★판정에는 안 쓴다(사장님 2026-10-06 결정): 판정은 기업상태표·기본정보로만 한다. 피드백에서 읽은 값은
 *  「이 칸이 다릅니다」 알림으로만 보여 주고, 맞으면 사람이 상태표를 고친다. 그래서 이 파일은
 *  match-engine 의 판정 함수를 하나도 부르지 않고, 프로필 값을 읽기만 한다.
 * ★인용문(원문 글)은 타입에 넣지 않는다 — 값과 칸 이름만 화면으로 나간다.
 *
 * 비교는 **같은 글자 형식**으로 바꾼 뒤 글자끼리 한다 — 매출 3.2억과 3.21억처럼 화면에 같게 보이는 값을
 * 「다르다」고 알리면 사람이 헛걸음한다. 매출 형식은 요약(profile-summary.ts)과 같은 함수를 쓴다.
 */
import type { BusinessProfile } from "./match-engine";
import { revenueWords } from "./profile-summary";

/** 피드백 회차에서 읽은 사실 하나. 칸(axis)마다 값 모양이 다르다. */
export type FeedbackDiffFact =
  | { axis: "revenue"; value: number; year: number }
  | { axis: "employeeCount"; value: number }
  | { axis: "companyScale"; value: string }
  | { axis: "hasCert"; value: boolean }
  | { axis: "hasPatent"; value: boolean }
  | { axis: "patentCount"; value: number }
  | { axis: "creditScore"; value: number; agency?: "NICE" | "KCB" }
  | { axis: "hasExistingLoan"; value: boolean }
  | { axis: "taxDelinquent"; value: boolean };

/** 화면에 나가는 한 줄. `current` 가 null 이면 상태표에 그 칸이 비어 있다는 뜻이다. */
export type FeedbackDiffRow = { field: string; label: string; current: string | null; feedback: string };

/** 화면에 나가는 알림 전체 — 회차 번호와 그 회차 시각(ISO 글자)을 함께 싣는다. */
export type FeedbackDiff = { round: number; at: string; rows: FeedbackDiffRow[] };

/** 입력 쪽 — 피드백 한 회차가 가진 사실 목록. */
export type FeedbackDiffRound = { round: number; at: string; facts: FeedbackDiffFact[] };

/** 줄 순서(= 화면 순서). 직원수 → 매출(작년) → 신용점수 3종 → 기업 규모 → 인증 → 특허 → 특허 건수 → 기존 대출 → 체납. */
const FIELD_ORDER = [
  "employeeCount",
  "revenue",
  "creditScoreNice",
  "creditScoreKcb",
  "creditScore",
  "companyScale",
  "hasCert",
  "hasPatent",
  "patentCount",
  "hasExistingLoan",
  "taxDelinquent",
] as const;

/** 통로를 건너온 알림이 이보다 줄이 많으면 모양이 틀린 것으로 본다(칸이 열한 가지뿐이라 넉넉한 상한이다). */
const MAX_ROWS = 20;

const KST_OFFSET_MS = 9 * 3_600_000;

/** `now` 를 한국 시각(UTC+9)으로 옮긴 연도 — 보는 컴퓨터의 시간대에 흔들리면 안 된다. */
function kstYear(now: Date): number {
  return new Date(now.getTime() + KST_OFFSET_MS).getUTCFullYear();
}

/** 유한한 숫자만 숫자로 친다 — NaN·Infinity 는 통로 값 방어로 버린다. */
function isNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

const yesNo = (b: boolean): string => (b ? "있음" : "없음");

/** 판정 쪽 값 → 글자. 값이 없으면(undefined·null·빈 문자열·숫자 아님) null. */
const numText = (v: unknown, fmt: (n: number) => string): string | null => (isNum(v) ? fmt(v) : null);
const boolText = (v: unknown): string | null => (typeof v === "boolean" ? yesNo(v) : null);
const textOf = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);

/** 비교 후보 하나 — 같은 칸이 여럿이면 마지막 것만 남기려고 칸 이름(field)으로 모은다. */
type Candidate = { field: string; label: string; current: string | null; feedback: string };

const people = (n: number): string => `${n}명`;
const plain = (n: number): string => String(n);
const cases = (n: number): string => `${n}건`;

/**
 * 사실 하나를 후보로 바꾼다. 알 수 없는 칸·값 모양이 틀린 것·(매출이면) 작년이 아닌 해는 null 로 버린다.
 * 사실은 통로를 건너온 값일 수 있어 타입을 믿지 않고 하나씩 확인한다.
 */
function candidateOf(profile: BusinessProfile, raw: unknown, lastYear: number): Candidate | null {
  if (typeof raw !== "object" || raw === null) return null;
  const fact = raw as Record<string, unknown>;
  const value = fact.value;
  switch (fact.axis) {
    case "employeeCount":
      return isNum(value)
        ? { field: "employeeCount", label: "직원수", current: numText(profile.employeeCount, people), feedback: people(value) }
        : null;
    case "revenue":
      // 작년 매출만 상태표의 「작년 매출」 칸과 견준다 — 다른 해 값을 견주면 없는 차이를 알리게 된다.
      return isNum(value) && fact.year === lastYear
        ? {
            field: "revenue",
            label: "매출(작년)",
            current: numText(profile.lastYearRevenueKrw, revenueWords),
            feedback: revenueWords(value),
          }
        : null;
    case "creditScore": {
      if (!isNum(value)) return null;
      // 기관이 NICE·KCB 면 그 기관 칸과, 기관이 없으면 일반 신용점수 칸과 견준다.
      if (fact.agency === "NICE") {
        return { field: "creditScoreNice", label: "신용점수(NICE)", current: numText(profile.creditScoreNice, plain), feedback: plain(value) };
      }
      if (fact.agency === "KCB") {
        return { field: "creditScoreKcb", label: "신용점수(KCB)", current: numText(profile.creditScoreKcb, plain), feedback: plain(value) };
      }
      return { field: "creditScore", label: "신용점수", current: numText(profile.creditScore, plain), feedback: plain(value) };
    }
    case "companyScale":
      // 글자는 그대로 쓴다(앞뒤 공백도 안 다듬는다). 비어 있는 글자는 알릴 값이 아니라 버린다.
      return textOf(value) !== null
        ? { field: "companyScale", label: "기업 규모", current: textOf(profile.companyScale), feedback: String(value) }
        : null;
    case "hasCert":
      return typeof value === "boolean"
        ? { field: "hasCert", label: "인증", current: boolText(profile.hasCert), feedback: yesNo(value) }
        : null;
    case "hasPatent":
      return typeof value === "boolean"
        ? { field: "hasPatent", label: "특허", current: boolText(profile.hasPatent), feedback: yesNo(value) }
        : null;
    case "patentCount":
      return isNum(value)
        ? { field: "patentCount", label: "특허 건수", current: numText(profile.patentCount, cases), feedback: cases(value) }
        : null;
    case "hasExistingLoan":
      return typeof value === "boolean"
        ? { field: "hasExistingLoan", label: "기존 대출", current: boolText(profile.hasExistingLoan), feedback: yesNo(value) }
        : null;
    case "taxDelinquent":
      return typeof value === "boolean"
        ? { field: "taxDelinquent", label: "체납", current: boolText(profile.taxDelinquent), feedback: yesNo(value) }
        : null;
    default:
      return null;
  }
}

/**
 * 판정에 쓰는 프로필과 피드백 최신 회차를 견줘, **다르거나 상태표가 빈 칸**만 돌려준다.
 *
 *  · 같은 칸이 한 회차 안에 여러 번 나오면 (버려질 것을 버린 뒤) 배열의 **마지막** 하나만 쓴다.
 *  · 회차가 없거나(`null`) 다른 칸이 하나도 없으면 `null` — 화면은 알림 구역을 안 그린다.
 *  · `now` 는 「작년」을 정하는 기준이다(한국 시각 연도 − 1).
 */
export function feedbackDiffOf(profile: BusinessProfile, round: FeedbackDiffRound | null, now: Date): FeedbackDiff | null {
  if (!round || !Array.isArray(round.facts)) return null;
  const lastYear = kstYear(now) - 1;
  const byField = new Map<string, Candidate>();
  for (const raw of round.facts) {
    const c = candidateOf(profile, raw, lastYear);
    if (c) byField.set(c.field, c); // 같은 칸이면 뒤에 온 것이 앞 것을 덮어쓴다
  }
  const rows: FeedbackDiffRow[] = [];
  for (const field of FIELD_ORDER) {
    const c = byField.get(field);
    // 같은 글자 형식으로 바꿔 글자가 같으면 알릴 것이 없다.
    if (c && c.current !== c.feedback) rows.push({ field: c.field, label: c.label, current: c.current, feedback: c.feedback });
  }
  if (rows.length === 0) return null;
  return { round: round.round, at: round.at, rows };
}

function isFeedbackDiffRow(v: unknown): v is FeedbackDiffRow {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.field === "string" &&
    typeof r.label === "string" &&
    typeof r.feedback === "string" &&
    (r.current === null || typeof r.current === "string")
  );
}

/**
 * 통로를 건너온 값이 `FeedbackDiff` 모양인지 — round 는 정수, at 는 글자, rows 는 줄 배열(최대 20개).
 * 줄마다 field·label·feedback 은 글자, current 는 글자 또는 null 이어야 한다.
 * 화면은 그리기 전에 이 함수로 확인하고, 아니면 알림이 없는 것으로 본다.
 */
export function isFeedbackDiff(v: unknown): v is FeedbackDiff {
  if (typeof v !== "object" || v === null) return false;
  const d = v as Record<string, unknown>;
  const rows = d.rows;
  if (!Number.isInteger(d.round) || typeof d.at !== "string" || !Array.isArray(rows)) return false;
  if (rows.length > MAX_ROWS) return false;
  return rows.every((r: unknown) => isFeedbackDiffRow(r));
}
