// 기업마당(bizinfo.go.kr) 지원사업정보 어댑터.
// 호출: GET /uss/rss/bizinfoApi.do?crtfcKey=..&dataType=json&pageUnit=100&pageIndex=n
// 응답 칸(2026-08-22 실측 표본 확정): jsonArray, pblancId, pblancNm, pblancUrl(절대주소),
//   jrsdInsttNm, excInsttNm, pldirSportRealmLclasCodeNm, trgetNm(지원대상),
//   reqstBeginEndDe("YYYY-MM-DD ~ YYYY-MM-DD"), hashtags(소문자), printFlpthNm(절대주소 그림),
//   bsnsSumryCn(HTML). 조사 초안의 link/hashTags/flpthNm 는 폴백만 둔다.
import {
  attachmentKindOf,
  parseApplyPeriod,
  type NormalizedAnnouncement,
  type PolicyAttachment,
} from "../types";

const BASE = "https://www.bizinfo.go.kr/uss/rss/bizinfoApi.do";
const ORIGIN = "https://www.bizinfo.go.kr";
const PAGE_UNIT = 100;
const MAX_PAGES = 50; // 안전 상한 — 넘으면 로그로 알린다(조용한 잘림 금지)
export const FETCH_TIMEOUT_MS = 30_000;

type Raw = Record<string, unknown>;
const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");

function decodeEntities(v: string): string {
  return v
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/gi, "&");
}

const stripTags = (v: string) =>
  decodeEntities(v.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

function splitJoined(v: string): string[] {
  return v.split("@").map((x) => x.trim()).filter(Boolean);
}

/** getImageFile.do 와 fileDown.do 는 같은 파일(해시 일치 실측) — 내려받기는 fileDown 으로 통일. */
function toFileDownUrl(raw: string): string {
  let u = raw.trim();
  if (!u) return "";
  u = u.replace(/getImageFile\.do/i, "fileDown.do");
  if (u.startsWith("http://") || u.startsWith("https://")) return u;
  if (u.startsWith("/")) return `${ORIGIN}${u}`;
  return `${ORIGIN}/${u}`;
}

function nameFromUrl(url: string): string {
  const path = url.split("?")[0] || url;
  const seg = path.split("/").filter(Boolean).pop() || "";
  return seg || url;
}

function pairAttachments(paths: string, names: string): PolicyAttachment[] {
  const urls = splitJoined(paths).map(toFileDownUrl).filter(Boolean);
  const fileNames = splitJoined(names);
  return urls.map((url, i) => {
    const name = fileNames[i] || nameFromUrl(url);
    return { name, url, kind: attachmentKindOf(name, url) };
  });
}

/** print* 와 일반 첨부를 합치고, 같은 주소는 한 번만 남긴다. */
export function parseBizinfoAttachments(item: Raw): PolicyAttachment[] {
  const print = pairAttachments(s(item.printFlpthNm), s(item.printFileNm));
  const files = pairAttachments(s(item.flpthNm), s(item.fileNm));
  const seen = new Set<string>();
  const out: PolicyAttachment[] = [];
  for (const a of [...print, ...files]) {
    if (seen.has(a.url)) continue;
    seen.add(a.url);
    out.push(a);
  }
  return out;
}

/** 응답 겉모양이 어떤 키로 감싸여 있어도 공고 배열을 찾아낸다(표본으로 확정, 방어적 유지). */
export function extractBizinfoItems(json: unknown): Raw[] {
  if (Array.isArray(json)) return json as Raw[];
  if (json && typeof json === "object") {
    for (const key of ["jsonArray", "items", "item", "list"]) {
      const v = (json as Raw)[key];
      if (Array.isArray(v)) return v as Raw[];
    }
    for (const v of Object.values(json as Raw)) {
      if (Array.isArray(v) && v.length > 0 && typeof v[0] === "object") return v as Raw[];
    }
  }
  return [];
}

export function normalizeBizinfoItem(item: Raw): NormalizedAnnouncement {
  const periodText = s(item.reqstBeginEndDe);
  const { start, end } = parseApplyPeriod(periodText);
  const link = s(item.pblancUrl) || s(item.link);
  return {
    source: "bizinfo",
    sourceId: s(item.pblancId) || link,
    title: stripTags(s(item.pblancNm) || s(item.title)),
    agency: s(item.jrsdInsttNm) || s(item.excInsttNm),
    category: s(item.pldirSportRealmLclasCodeNm),
    region: s(item.hashtags) || s(item.hashTags),
    summary: stripTags(s(item.bsnsSumryCn)),
    targetText: stripTags(s(item.trgetNm)),
    applyStart: start, applyEnd: end, applyPeriodText: periodText,
    url: link.startsWith("http") ? link : link ? `${ORIGIN}${link}` : "",
    attachments: parseBizinfoAttachments(item),
    raw: item,
  };
}

/** 공고번호·링크가 둘 다 비면 저장하지 않는다. 거른 수는 로그로 남긴다. */
export function keepIdentifiable(list: NormalizedAnnouncement[]): NormalizedAnnouncement[] {
  const kept = list.filter((a) => a.sourceId || a.url);
  const dropped = list.length - kept.length;
  if (dropped > 0) console.warn(`[policy-match] 기업마당 식별불가 ${dropped}건 제외 (공고번호·링크 둘 다 없음)`);
  return kept;
}

/** 전 페이지 수집. 실패는 상태코드+본문 일부를 담아 던진다(olcademy sheet-client 관행). */
export async function fetchBizinfoAll(): Promise<NormalizedAnnouncement[]> {
  const key = process.env.BIZINFO_API_KEY;
  if (!key) throw new Error("BIZINFO_API_KEY 없음 — 환경변수를 등록하세요");
  const out: NormalizedAnnouncement[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await fetch(
      `${BASE}?crtfcKey=${encodeURIComponent(key)}&dataType=json&pageUnit=${PAGE_UNIT}&pageIndex=${page}`,
      { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) },
    );
    if (!res.ok) throw new Error(`기업마당 호출 실패(${res.status}) ${(await res.text().catch(() => "")).slice(0, 200)}`);
    const items = extractBizinfoItems(await res.json());
    out.push(...items.map(normalizeBizinfoItem));
    if (items.length < PAGE_UNIT) return keepIdentifiable(out);
  }
  console.warn(`[policy-match] 기업마당 ${MAX_PAGES}쪽 상한 도달 — 이후 쪽은 다음 주기에`);
  return keepIdentifiable(out);
}
