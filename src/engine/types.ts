// 지원정책 매칭 — 출처별 어댑터가 공통으로 내놓는 「공고 한 건」.
// 어댑터는 이 모양만 책임지고, DB 저장은 services/policy-match/store 가 맡는다.
// API 출처 5종은 이 union 유지(타입 안전). 게시판 출처는 동적 id 라 source 필드는 string.
export type PolicySource = "bizinfo" | "bojo24" | "kstartup" | "msit" | "work24";

export interface NormalizedAnnouncement {
  source: string;
  sourceId: string;
  title: string;
  agency: string;
  category: string;
  region: string;
  summary: string;
  targetText: string; // 지원대상(자격조건) 원문 — 2단계 구조화의 입력. 절대 요약·가공하지 않는다
  applyStart: Date | null;
  applyEnd: Date | null;
  applyPeriodText: string;
  url: string;
  attachments: PolicyAttachment[];
  raw: unknown; // 원 응답 통째 — 원문 보존 원칙(설계 §3-1)
}

export const ATTACHMENT_KINDS = ["pdf", "hwp", "hwpx", "zip", "etc"] as const;
export type PolicyAttachmentKind = (typeof ATTACHMENT_KINDS)[number];

export interface PolicyAttachment {
  name: string;
  url: string;
  kind: PolicyAttachmentKind;
}

function kindOfExt(ext: string): PolicyAttachmentKind | null {
  const e = ext.toLowerCase();
  if (e === "pdf") return "pdf";
  if (e === "hwpx") return "hwpx";
  if (e === "hwp") return "hwp";
  if (e === "zip") return "zip";
  return null;
}

/** 경로 마지막 조각의 확장자 → 없으면 물음표 뒤 값들(URL 디코딩) 중 확장자가 있는 첫 것. */
function kindByExtension(path: string): PolicyAttachmentKind | null {
  const [beforeQuery, afterQuery = ""] = (path.split("#")[0] || "").split("?", 2);
  const seg = beforeQuery.split("/").pop() || "";
  if (seg.includes(".")) {
    const k = kindOfExt(seg.split(".").pop() || "");
    if (k) return k;
  }
  for (const part of afterQuery.split("&")) {
    const rawVal = part.split("=").slice(1).join("=");
    if (!rawVal) continue;
    let val = rawVal;
    try { val = decodeURIComponent(rawVal); } catch { /* 깨진 인코딩은 원문 그대로 */ }
    const tail = val.split("/").pop() || "";
    if (!tail.includes(".")) continue;
    const k = kindOfExt(tail.split(".").pop() || "");
    if (k) return k;
  }
  return null;
}

/**
 * 파일명의 확장자로 형식을 정하고, 이름이 없거나 확장자가 없으면 주소를 본다.
 * 이름과 주소를 한 글자로 붙여 보면 안 된다 — 기업마당 주소는 늘 `fileDown.do` 로 끝나
 * 모든 첨부가 etc 로 떨어진다(2026-08-22 실측).
 */
export function attachmentKindOf(name: string, url = ""): PolicyAttachmentKind {
  return kindByExtension(name || "") ?? kindByExtension(url || "") ?? "etc";
}

/** 출처가 달라도 같은 공고를 묶기 위한 키 — 제목+기관에서 공백·기호를 걷어낸다. */
export function dedupKeyOf(a: { title: string; agency: string }): string {
  const norm = (s: string) =>
    s.replace(/\s+/g, "").replace(/[()\[\]〔〕『』「」·,.\-–—]/g, "").toLowerCase();
  return `${norm(a.title)}|${norm(a.agency)}`;
}

/** 신청기간 원문("20260801 ~ 20260930" 등) → 한국시간 하루의 시작·끝. 상시·예산소진·존재하지 않는 날짜는 null. */
export function parseApplyPeriod(text: string): { start: Date | null; end: Date | null } {
  const m = text.match(/(\d{4})-?(\d{2})-?(\d{2})\s*~\s*(\d{4})-?(\d{2})-?(\d{2})/);
  if (!m) return { start: null, end: null };
  return { start: kstDay(m[1], m[2], m[3], "start"), end: kstDay(m[4], m[5], m[6], "end") };
}

/** KST 00:00 = UTC 전날 15:00, KST 23:59:59 = UTC 같은 날 14:59:59. 달력에 없는 날짜는 null. */
function kstDay(y: string, mo: string, da: string, kind: "start" | "end"): Date | null {
  const Y = Number(y), M = Number(mo), D = Number(da);
  const utcMidnight = Date.UTC(Y, M - 1, D);
  const probe = new Date(utcMidnight);
  if (probe.getUTCFullYear() !== Y || probe.getUTCMonth() !== M - 1 || probe.getUTCDate() !== D) return null;
  if (kind === "start") return new Date(utcMidnight - 9 * 3_600_000);
  return new Date(utcMidnight + (14 * 3_600_000 + 59 * 60_000 + 59_000));
}

export const ALL_SOURCES_FAILED_MESSAGE = "출처 호출 실패 — 잠시 뒤 재시도";

export type SourceFetchOutcome = "ok" | "partial" | "all-failed";

export function sourceFetchOutcome(perSource: { error?: string }[]): SourceFetchOutcome {
  if (perSource.length === 0) return "all-failed";
  const failed = perSource.filter((s) => s.error).length;
  if (failed === 0) return "ok";
  if (failed === perSource.length) return "all-failed";
  return "partial";
}

/** 모든 출처가 실패하면 장부의 마지막 실행 시각을 이전 값으로 되돌려 다음 틱에 재시도되게 한다. */
export function ledgerLastRunAtAfterSync(
  previousLastRunAt: string | undefined,
  perSource: { error?: string }[],
  nowIso: string,
): string {
  return sourceFetchOutcome(perSource) === "all-failed" ? (previousLastRunAt ?? "") : nowIso;
}

export function syncUserMessage(perSource: { error?: string }[]): string {
  const o = sourceFetchOutcome(perSource);
  if (o === "all-failed") return ALL_SOURCES_FAILED_MESSAGE;
  if (o === "partial") return "새로 받아왔습니다 — 일부 출처 실패";
  return "새로 받아왔습니다";
}

const KST_OFFSET_MS = 9 * 3_600_000;

/** 저장된 신청기간 시각 → 한국 달력 날짜(YYYY.MM.DD). UTC 날짜를 그대로 찍으면 시작일이 하루 앞당겨진다. */
export function formatPolicyDate(value: Date | string | null | undefined): string {
  if (value == null || value === "") return "";
  const t = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(t)) return "";
  const ymd = new Date(t + KST_OFFSET_MS).toISOString().slice(0, 10);
  return `${ymd.slice(0, 4)}.${ymd.slice(5, 7)}.${ymd.slice(8, 10)}`;
}

/** 모집중은 마감 임박순, 마감·전체는 최근 수집순. */
export function announcementsOrderBy(status: string) {
  if (status === "open") {
    return [
      { applyEnd: { sort: "asc" as const, nulls: "last" as const } },
      { lastSeenAt: "desc" as const },
    ];
  }
  return [{ lastSeenAt: "desc" as const }];
}
