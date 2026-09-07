// 공고 한 건의 전체 — 우측 상세 패널이 쓰는 통로의 **코어**.
// 목록 통로가 안 주는 것(사업개요 전문·구조화 결과·첨부)과, 원 응답에만 있던
// 신청방법·문의처·접수사이트를 함께 내려준다. 원문 보존 원칙(설계 §3-1)에 따라
// structure 는 저장된 JSON 그대로 보내고, 해석은 화면이 match-engine 으로 한다.
//
// ★AI 구조화 트리거(structurizeOne·예산 장부)는 여기 없다 — **앱 라우트에 남는다.**
//  랩은 자기 열쇠·자기 장부를 쓰므로 코어가 그 결정을 대신할 수 없다.
import {
  ATTACHMENT_KINDS,
  attachmentKindOf,
  type PolicyAttachment,
  type PolicyAttachmentKind,
} from "../engine/types";
import type { ServeQuery } from "./types";

/** 상세 한 건을 그 자리에서 읽는 기다리기 상한. */
export const DETAIL_STRUCTURE_WAIT_MS = 20_000;

const KNOWN_KINDS = new Set<string>(ATTACHMENT_KINDS);

/** POST 전용 첨부를 서버가 대신 받아 주는 통로의 기본 주소 — 두 앱이 같은 경로를 쓴다. */
export function defaultAttachmentHref(announcementId: string, index: number): string {
  return `/api/policy-match/announcements/${encodeURIComponent(announcementId)}/attachments/${index}`;
}

/**
 * 저장된 첨부 목록을 화면과 내려받기 통로가 쓰는 형태로 바꾼다.
 * 저장·수집은 여기서 하지 않는다 — **읽어서 모양만 바꾸는 순수 파서**다.
 */
export function readAttachments(
  raw: unknown,
  announcementId: string,
  attachmentHref: (announcementId: string, index: number) => string = defaultAttachmentHref,
): PolicyAttachment[] {
  if (!Array.isArray(raw)) return [];
  const out: PolicyAttachment[] = [];
  for (const [index, item] of raw.entries()) {
    if (!item || typeof item !== "object") continue;
    const value = item as Record<string, unknown>;
    const url = typeof value.url === "string" ? value.url.trim() : "";
    if (!url) continue;
    const name =
      typeof value.name === "string" && value.name.trim() ? value.name.trim() : "첨부파일";
    const stored = typeof value.kind === "string" ? value.kind.trim().toLowerCase() : "";
    const kind: PolicyAttachmentKind = KNOWN_KINDS.has(stored)
      ? (stored as PolicyAttachmentKind)
      : attachmentKindOf(name, url);
    const isPost = typeof value.method === "string" && value.method.toUpperCase() === "POST";
    const href = isPost && announcementId ? attachmentHref(announcementId, index) : url;
    out.push({ name, url: href, kind });
  }
  return out;
}

/**
 * AI 가 읽어 둔 요약이 **있기는 한가**. 판본은 보지 않는다.
 * 판본이 낡았다는 것은 「더 잘 읽는 방법이 생겼다」는 뜻이지 「지금 요약이 틀렸다」는 뜻이 아니다.
 * 다시 읽을지는 관리자가 배치로 정한다 — 사람이 공고를 여는 것으로 돈이 나가면 안 된다.
 */
export function hasStoredSummary(row: { structureStatus: string }): boolean {
  return row.structureStatus === "done" || row.structureStatus === "needs_review";
}

/** 원 응답에서 뽑을 칸 — 기업마당 실측 이름(2026-08-22 표본). 다른 출처가 늘면 후보를 덧붙인다. */
const RAW_FIELDS = {
  applyMethod: ["reqstMthPapersCn"], // 신청방법 및 제출서류
  contact: ["refrncNm"], // 문의처
  receiptSiteUrl: ["rceptEngnHmpgUrl", "applyUrl"], // 접수기관 홈페이지(기업마당) · 신청 주소(고용24)
} as const;

function decodeEntities(v: string): string {
  return v
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/gi, "&");
}

/** 원 응답에는 HTML 이 섞여 있다 — 화면에 그대로 뿌리지 않게 글자만 남긴다. */
function stripTags(v: string): string {
  return decodeEntities(v.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

/** raw 는 출처마다 겉모양이 다르다 — 맨 위와 한 겹 안쪽까지만 찾는다(깊이 무한 탐색은 안 한다). */
function pickRaw(raw: unknown, keys: readonly string[]): string {
  const read = (o: unknown): string => {
    if (!o || typeof o !== "object" || Array.isArray(o)) return "";
    const bag = o as Record<string, unknown>;
    for (const k of keys) {
      const v = bag[k];
      if (typeof v === "string" && v.trim()) return stripTags(v);
    }
    return "";
  };
  const top = read(raw);
  if (top) return top;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const v of Object.values(raw as Record<string, unknown>)) {
      const inner = read(v);
      if (inner) return inner;
    }
  }
  return "";
}

/** 상세가 읽는 칸 — ERP 원문과 같은 18칸. */
export const ANNOUNCEMENT_DETAIL_SELECT = {
  id: true, source: true, title: true, agency: true, category: true, region: true,
  summary: true, targetText: true, applyStart: true, applyEnd: true, applyPeriodText: true,
  url: true, status: true, attachments: true, raw: true,
  structure: true, structureStatus: true, structuredAt: true, structureVersion: true,
} as const;

export type AnnouncementDetailRow = {
  id: string;
  source: string;
  title: string;
  agency: string;
  category: string;
  region: string;
  summary: string;
  targetText: string;
  applyStart: Date | null;
  applyEnd: Date | null;
  applyPeriodText: string;
  url: string;
  status: string;
  attachments: unknown;
  raw: unknown;
  structure: unknown;
  structureStatus: string;
  structuredAt: Date | null;
  structureVersion: number;
};

export type AnnouncementDetail = {
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
};

/** 저장된 행 한 개를 상세 응답 모양으로 — 순수 함수(읽기 없음). */
export function toAnnouncementDetail(
  row: AnnouncementDetailRow,
  attachmentHref?: (announcementId: string, index: number) => string,
): AnnouncementDetail {
  return {
    id: row.id,
    source: row.source,
    title: row.title,
    agency: row.agency,
    category: row.category,
    region: row.region,
    summary: row.summary,
    targetText: row.targetText,
    applyStart: row.applyStart ? new Date(row.applyStart).toISOString() : null,
    applyEnd: row.applyEnd ? new Date(row.applyEnd).toISOString() : null,
    applyPeriodText: row.applyPeriodText,
    url: row.url,
    status: row.status,
    attachments: readAttachments(row.attachments, row.id, attachmentHref),
    structure: row.structure ?? null,
    structureStatus: row.structureStatus,
    structuredAt: row.structuredAt ? new Date(row.structuredAt).toISOString() : null,
    applyMethod: pickRaw(row.raw, RAW_FIELDS.applyMethod),
    contact: pickRaw(row.raw, RAW_FIELDS.contact),
    receiptSiteUrl: pickRaw(row.raw, RAW_FIELDS.receiptSiteUrl),
  };
}

/** 저장된 행 한 개 읽기 — 없으면 null. AI 트리거 앞뒤로 두 번 부를 수 있게 따로 뺐다. */
export function readAnnouncementDetailRow(
  q: Pick<ServeQuery, "findAnnouncement">,
  id: string,
): Promise<AnnouncementDetailRow | null> {
  return q.findAnnouncement<AnnouncementDetailRow>(id, ANNOUNCEMENT_DETAIL_SELECT);
}

export type AnnouncementDetailResult =
  | { status: "ok"; data: AnnouncementDetail }
  | { status: "not_found"; message: string };

/**
 * 한 번에 읽어 상세 모양으로 — AI 구조화를 끼워 넣지 않는 앱(랩)이 쓰는 지름길.
 * ERP 처럼 중간에 구조화를 넣어야 하면 `readAnnouncementDetailRow` → (구조화) →
 * `toAnnouncementDetail` 순서로 직접 부른다.
 */
export async function readAnnouncementDetail(
  q: Pick<ServeQuery, "findAnnouncement">,
  id: string,
  attachmentHref?: (announcementId: string, index: number) => string,
): Promise<AnnouncementDetailResult> {
  const announcementId = (id ?? "").trim();
  if (!announcementId) return { status: "not_found", message: "공고를 찾을 수 없습니다." };
  const row = await readAnnouncementDetailRow(q, announcementId);
  if (!row) return { status: "not_found", message: "공고를 찾을 수 없습니다." };
  return { status: "ok", data: toAnnouncementDetail(row, attachmentHref) };
}
