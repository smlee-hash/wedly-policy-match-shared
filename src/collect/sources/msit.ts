// 과기부 사업공고 어댑터.
// 호출: GET apis.data.go.kr/1721000/msitannouncementinfo/businessAnnouncMentList
//   ?serviceKey=DATA_GO_KR_API_KEY&pageNo=n&numOfRows=100
// 응답(2026-08-26 실측 고정본): XML response/header/body/items/item — 태그명 구조(col name 아님).
// 게시물형: 신청기간·대상은 추정하지 않는다. applyEnd 는 항상 null.
import { decodeXml, splitXmlItems } from "./kstartup";
import {
  attachmentKindOf,
  type NormalizedAnnouncement,
  type PolicyAttachment,
  type PolicySource,
} from "../types";

const BASE = "https://apis.data.go.kr/1721000/msitannouncementinfo/businessAnnouncMentList";
const PAGE_UNIT = 100;
const MAX_PAGES = 30; // 사용자 지시 — 초과 시 경고 로그(조용한 잘림 금지)
const MS_365_DAYS = 365 * 24 * 60 * 60 * 1000;
export const FETCH_TIMEOUT_MS = 30_000;
const AGENCY = "과학기술정보통신부";

const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");

function tagValue(xml: string, tag: string): string {
  const m = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "i"));
  return m ? decodeXml(m[1]).trim() : "";
}

/** <item> 안 태그명 → 값. files 블록은 빼고 직접 자식만. */
export function xmlTagsOfItem(itemXml: string): Record<string, string> {
  const withoutFiles = itemXml.replace(/<files>[\s\S]*?<\/files>/i, "");
  const out: Record<string, string> = {};
  for (const m of withoutFiles.matchAll(/<([A-Za-z][\w]*)>([\s\S]*?)<\/\1>/g)) {
    out[m[1]] = decodeXml(m[2]).trim();
  }
  return out;
}

function parseFiles(itemXml: string): PolicyAttachment[] {
  const block = itemXml.match(/<files>([\s\S]*?)<\/files>/i)?.[1] ?? "";
  const files = [...block.matchAll(/<file>([\s\S]*?)<\/file>/gi)].map((m) => m[1]);
  const out: PolicyAttachment[] = [];
  for (const f of files) {
    const name = tagValue(f, "fileName");
    const url = tagValue(f, "fileUrl");
    if (!url) continue;
    out.push({ name, url, kind: attachmentKindOf(name, url) });
  }
  return out;
}

function sourceIdFromViewUrl(viewUrl: string): string {
  if (!viewUrl) return "";
  try {
    const id = new URL(viewUrl).searchParams.get("nttSeqNo");
    if (id) return id;
  } catch {
    /* not a URL */
  }
  const m = viewUrl.match(/[?&]nttSeqNo=([^&]+)/);
  return m ? decodeURIComponent(m[1]) : viewUrl;
}

function pressDtUtcMs(pressDt: string): number | null {
  const m = s(pressDt).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function isOlderThan365Days(pressDt: string, now: Date): boolean {
  const t = pressDtUtcMs(pressDt);
  if (t == null) return false;
  return t < now.getTime() - MS_365_DAYS;
}

export function normalizeMsitItem(itemXml: string): NormalizedAnnouncement {
  const tags = xmlTagsOfItem(itemXml);
  const viewUrl = s(tags.viewUrl);
  return {
    source: "msit" as PolicySource,
    sourceId: sourceIdFromViewUrl(viewUrl),
    title: s(tags.subject),
    agency: AGENCY,
    // 도메인 연결표에 「R&D」 없음 — 자료실 대조는 기본+넓히기 경로를 타는 것이 의도.
    category: "R&D",
    region: "",
    summary: "",
    targetText: "",
    applyStart: null,
    applyEnd: null, // 공고 게시물형 — 신청 마감일 추정 금지
    applyPeriodText: "",
    url: viewUrl,
    attachments: parseFiles(itemXml),
    raw: tags,
  };
}

/** 공고번호·링크가 둘 다 비면 저장하지 않는다. 거른 수는 로그로 남긴다. */
export function keepIdentifiable(list: NormalizedAnnouncement[]): NormalizedAnnouncement[] {
  const kept = list.filter((a) => a.sourceId || a.url);
  const dropped = list.length - kept.length;
  if (dropped > 0) {
    console.warn(`[policy-match] 과기부 식별불가 ${dropped}건 제외 (공고번호·링크 둘 다 없음)`);
  }
  return kept;
}

function assertResultCode(xml: string): void {
  const code = tagValue(xml, "resultCode");
  if (code !== "00") {
    throw new Error(`과기부 응답 오류(resultCode=${code || "없음"})`);
  }
}

function totalCountOf(xml: string): number | null {
  const raw = tagValue(xml, "totalCount");
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function announcementsFromMsitXml(xml: string, now = new Date()): NormalizedAnnouncement[] {
  assertResultCode(xml);
  const kept: NormalizedAnnouncement[] = [];
  for (const itemXml of splitXmlItems(xml)) {
    const a = normalizeMsitItem(itemXml);
    const pressDt = s((a.raw as Record<string, string>).pressDt);
    if (isOlderThan365Days(pressDt, now)) continue;
    kept.push(a);
  }
  return keepIdentifiable(kept);
}

export async function fetchMsitAll(now = new Date()): Promise<NormalizedAnnouncement[]> {
  const key = process.env.DATA_GO_KR_API_KEY;
  if (!key) throw new Error("DATA_GO_KR_API_KEY 없음");
  const out: NormalizedAnnouncement[] = [];
  let received = 0;
  let consecutiveAllCut = 0;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await fetch(
      `${BASE}?serviceKey=${encodeURIComponent(key)}&pageNo=${page}&numOfRows=${PAGE_UNIT}`,
      { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) },
    );
    if (!res.ok) {
      throw new Error(`과기부 호출 실패(${res.status}) ${(await res.text().catch(() => "")).slice(0, 200)}`);
    }
    const xml = await res.text();
    const rawItems = splitXmlItems(xml);
    out.push(...announcementsFromMsitXml(xml, now));
    received += rawItems.length;
    if (rawItems.length === 0) return out;
    const allCut = rawItems.every((itemXml) =>
      isOlderThan365Days(s(xmlTagsOfItem(itemXml).pressDt), now),
    );
    consecutiveAllCut = allCut ? consecutiveAllCut + 1 : 0;
    if (consecutiveAllCut >= 2) return out;
    const total = totalCountOf(xml);
    if (total !== null && received >= total) return out;
  }
  console.warn(`[policy-match] 과기부 ${MAX_PAGES}쪽 상한 도달 — 이후 쪽은 다음 주기에`);
  return out;
}
