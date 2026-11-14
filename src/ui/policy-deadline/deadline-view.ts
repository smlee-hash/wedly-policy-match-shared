// 정책별 고객사 화면의 순수 계산 — 「정책별 업체」·「정책별 고객사」·「연락 예정 업체」 탭이 함께 쓴다.
// 서버 읽기 함수는 마감·범위만 거르고, 분야·종류·「맞음만」·「0곳 숨기기」는 받은 목록을 여기서 거른다.
import { GENERIC_TO_CHECK } from "../../funding/funding-map";
import type {
  AnnouncementListRow,
  CompanyAnnouncementRow,
  ContactCompanyRow,
  ContactKind,
  ExportRow,
  RunSummary,
} from "../../serve/policy-deadline/types";

export const POLICY_FUND = "정책자금";
export const FREE_GRANT = "무상지원금";
/** 「연락 예정 업체」 종류 거르기의 「그 밖의 분야」. 분류 이름과 겹치지 않는 값이다. */
export const OTHER_KINDS = "__other";

export type DDayTone = "today" | "soon" | "later" | "always";
export type KindTone = "fund" | "grant" | "other";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

/** 마감 딱지 글자 — 상시 · 오늘 마감 · D-n. */
export function dDayLabel(dDay: number | null): string {
  if (dDay === null) return "상시";
  return dDay === 0 ? "오늘 마감" : `D-${dDay}`;
}

/** 마감 딱지 색 — 오늘(빨강) · 7일 안(노랑) · 그 뒤(회색) · 상시(보라). */
export function dDayTone(dDay: number | null): DDayTone {
  if (dDay === null) return "always";
  if (dDay === 0) return "today";
  return dDay <= 7 ? "soon" : "later";
}

/** YYYY-MM-DD → 「MM/DD(요일)」. 형식이 다르면 받은 글자 그대로. */
export function dateLabel(day: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return day;
  const weekday = WEEKDAYS[new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay()];
  return `${m[2]}/${m[3]}(${weekday})`;
}

/** 마지막 대조 시각 — 「11/11(수) 오전 9:20」(서울 시각). 기록이 없으면 「아직 대조 전」. */
export function lastRunLabel(run: Pick<RunSummary, "finishedAt"> | null): string {
  const ms = run ? Date.parse(run.finishedAt) : Number.NaN;
  if (!Number.isFinite(ms)) return "아직 대조 전";
  const kst = new Date(ms + 9 * 3_600_000);
  const day = `${kst.getUTCFullYear()}-${String(kst.getUTCMonth() + 1).padStart(2, "0")}-${String(kst.getUTCDate()).padStart(2, "0")}`;
  const hour = kst.getUTCHours();
  const minute = String(kst.getUTCMinutes()).padStart(2, "0");
  return `${dateLabel(day)} ${hour < 12 ? "오전" : "오후"} ${hour % 12 || 12}:${minute}`;
}

/** 종류 색 — 정책자금 · 무상지원금 · 그 밖. 세 탭과 종류 단추가 같은 색을 쓴다. */
export function kindTone(category: string): KindTone {
  if (category === POLICY_FUND) return "fund";
  return category === FREE_GRANT ? "grant" : "other";
}

/** 종류 이름 — 분류가 빈 공고는 「분류 없음」. */
export function kindLabel(category: string): string {
  return category || "분류 없음";
}

/** 공고 줄에 보이는 업체 수 — 「맞음만」이면 확인 필요를 세지 않는다. */
export function visibleCount(row: Pick<AnnouncementListRow, "fit" | "unverified">, fitOnly: boolean): number {
  return row.fit + (fitOnly ? 0 : row.unverified);
}

/** 분야(빈 글자 = 전체)·「맞음만」·「0곳 숨기기」로 공고 줄을 거른다. 순서는 받은 그대로. */
export function filterAnnouncements(
  rows: readonly AnnouncementListRow[],
  f: { category: string; fitOnly: boolean; hideEmpty: boolean },
): AnnouncementListRow[] {
  return rows.filter((row) => {
    if (f.category !== "" && row.category !== f.category) return false;
    return !(f.hideEmpty && visibleCount(row, f.fitOnly) === 0);
  });
}

/** 종류 거르기에 맞는가 — 빈 글자 = 전체, OTHER_KINDS = 정책자금·무상지원금이 아닌 분야(분류 없음 포함). */
export function matchesKind(category: string, kind: string): boolean {
  if (kind === "") return true;
  if (kind === OTHER_KINDS) return category !== POLICY_FUND && category !== FREE_GRANT;
  return category === kind;
}

export interface ContactListRow {
  row: ContactCompanyRow;
  /** 종류 거르기 안 분야만 — 서버가 준 순서 그대로. */
  kinds: ContactKind[];
  /** 그 분야들 중 가장 가까운 D-n. */
  nearestDDay: number;
}

function compareText(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/**
 * 「연락 예정 업체」 줄을 종류로 거른다 — 그 종류 공고가 없는 업체는 빼고,
 * 가장 가까운 마감을 그 종류 공고로 다시 잡아 가까운 순(같으면 업체명, 그다음 열쇠 순)으로 놓는다.
 */
export function contactRowsFor(companies: readonly ContactCompanyRow[], kind: string): ContactListRow[] {
  const out: ContactListRow[] = [];
  for (const row of companies) {
    const kinds = row.kinds.filter((k) => matchesKind(k.category, kind));
    if (kinds.length === 0) continue;
    out.push({ row, kinds, nearestDDay: Math.min(...kinds.map((k) => k.nearestDDay)) });
  }
  return out.sort(
    (a, b) =>
      a.nearestDDay - b.nearestDDay ||
      compareText(a.row.companyName, b.row.companyName) ||
      compareText(a.row.customerKey, b.row.customerKey),
  );
}

function kindRank(category: string): number {
  if (category === POLICY_FUND) return 0;
  if (category === FREE_GRANT) return 1;
  return category === "" ? 3 : 2;
}

/**
 * 「진행」으로 공고가 빠진 뒤 업체 줄을 남은 공고로 다시 센다 — 남은 공고가 없으면 null(업체가 목록에서 빠진다).
 * 분야 순서는 서버와 같다: 정책자금, 무상지원금, 그 밖은 분류 이름 글자 순, 빈 분류는 맨 끝.
 */
export function rebuildContactRow(row: ContactCompanyRow, announcements: readonly CompanyAnnouncementRow[]): ContactCompanyRow | null {
  const dated = announcements.filter((a): a is CompanyAnnouncementRow & { dDay: number; applyEnd: string } => a.dDay !== null && a.applyEnd !== null);
  if (dated.length === 0) return null;
  const byKind = new Map<string, ContactKind>();
  let nearest = dated[0];
  for (const a of dated) {
    if (a.dDay < nearest.dDay) nearest = a;
    const kind = byKind.get(a.category);
    if (kind) {
      kind.count += 1;
      kind.nearestDDay = Math.min(kind.nearestDDay, a.dDay);
    } else byKind.set(a.category, { category: a.category, count: 1, nearestDDay: a.dDay });
  }
  return {
    ...row,
    nearestApplyEnd: nearest.applyEnd,
    nearestDDay: nearest.dDay,
    kinds: [...byKind.values()].sort((a, b) => kindRank(a.category) - kindRank(b.category) || compareText(a.category, b.category)),
    announcementCount: dated.length,
    progressCount: dated.filter((a) => a.progress !== null).length,
  };
}

/** 업체 하나를 펼친 공고 목록을 종류로 거른다. */
export function announcementsFor(rows: readonly CompanyAnnouncementRow[], kind: string): CompanyAnnouncementRow[] {
  return rows.filter((row) => matchesKind(row.category, kind));
}

export const EXPORT_HEADERS = [
  "마감일",
  "남은 날",
  "공고명",
  "기관",
  "분야",
  "업체명",
  "담당",
  "진행상태",
  "판정",
  "맞은 조건",
  "확인할 조건",
  "채울 칸",
  "정책 진행",
  "공고 원문",
];

/** 엑셀 줄 — EXPORT_HEADERS 순서. */
export function exportBody(rows: readonly ExportRow[]): (string | number)[][] {
  return rows.map((r) => [
    r.applyEnd ?? "상시",
    dDayLabel(r.dDay),
    r.title,
    r.agency,
    kindLabel(r.category),
    r.companyName,
    r.consultant || "담당 없음",
    r.statusText,
    r.verdict === "fit" ? "맞음" : "확인 필요",
    r.fitLabels.join(" · "),
    r.toCheck.join(" · "),
    r.gaps.join(" · "),
    r.inProgress ? "진행 중" : "",
    r.url,
  ]);
}

/**
 * 「업무 현황에 추가」 뒤 알림 글 — 기한은 마감일(MM/DD(요일)), 상시면 「기한 없음」.
 * 이미 누가 넣은 공고면 넣은 사람을 알린다.
 */
export function progressToastText(r: {
  created: boolean;
  companyName: string;
  policyName: string;
  todo: string;
  due: string;
  progress: { byName: string };
}): string {
  if (!r.created) return `${r.companyName} · 「${r.policyName}」 · 이미 ${r.progress.byName} 님이 업무 현황에 추가했습니다`;
  return `${r.companyName} · 컨설팅 업무 현황에 「${r.policyName}」 추가 · 할 일 「${r.todo}」 · ${r.due ? `기한 ${dateLabel(r.due)}` : "기한 없음"}`;
}

/** 확인할 조건 중 업체마다 다른 것만 — 「공고 원문 확인(조건 정리 전)」처럼 공고 전체에 붙는 문구는 뺀다. */
export function specificToCheck(toCheck: readonly string[]): string[] {
  return toCheck.filter((label) => !GENERIC_TO_CHECK.has(label));
}

/** 조건을 아직 정리하지 않은 공고의 줄인가 — 공고 전체 문구가 하나라도 붙어 있다. */
export function needsSourceCheck(toCheck: readonly string[]): boolean {
  return toCheck.some((label) => GENERIC_TO_CHECK.has(label));
}

/**
 * 펼친 표에 그릴 조건 칸 — 줄 전부가 비는 칸은 머리부터 뺀다.
 * unstructuredInCell: 줄마다 「조건 정리 전」 표시를 확인할 조건 칸에 넣는가(연락 예정 업체 — 줄마다 공고가 다르다).
 */
export function conditionColumns(
  rows: readonly { fitLabels: readonly string[]; toCheck: readonly string[]; gaps: readonly string[] }[],
  unstructuredInCell: boolean,
): { fit: boolean; check: boolean } {
  return {
    fit: rows.some((r) => r.fitLabels.length > 0),
    check: rows.some((r) => specificToCheck(r.toCheck).length > 0 || r.gaps.length > 0 || (unstructuredInCell && needsSourceCheck(r.toCheck))),
  };
}

/** 업체 상세창(CompanyCard)에 넘길 신원 — 열쇠 b: 는 사업자번호, p: 는 연락처 숫자다. */
export function companyCardRowOf(customerKey: string, companyName: string): { companyName: string; bizno: string; phone: string } {
  return {
    companyName,
    bizno: customerKey.startsWith("b:") ? customerKey.slice(2) : "",
    phone: customerKey.startsWith("p:") ? customerKey.slice(2) : "",
  };
}
