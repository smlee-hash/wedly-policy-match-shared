// K-Startup 공고정보 어댑터.
// 호출: GET apis.data.go.kr/B552735/kisedKstartupService01/getAnnouncementInformation01
//   ?serviceKey=DATA_GO_KR_API_KEY&page=n&perPage=100
// 응답(2026-08-26 실측 고정본): XML <item><col name="...">. JSON 아님.
// 공고번호 내림차순(최신순). 모집중은 앞쪽에 몰림.
import { parseApplyPeriod, type NormalizedAnnouncement } from "../types";

const BASE = "https://apis.data.go.kr/B552735/kisedKstartupService01/getAnnouncementInformation01";
const PAGE_UNIT = 100;
const MAX_PAGES = 60; // 최신순 확정 — matchCount 쪽수 산수 대신 상한 + 모집중 0 조기 종료
export const FETCH_TIMEOUT_MS = 30_000;

const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** 이름 엔티티를 먼저, 숫자 엔티티는 나중에. 숫자부터 풀면 &#38;lt; 가 &lt; → < 로 이중 해독된다. */
export function decodeXml(v: string): string {
  return v
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)));
}

/** <item>…</item> 단위 분해. 닫히지 않은 조각은 버린다. */
export function splitXmlItems(xml: string): string[] {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].map((m) => m[1]);
}

/** <col name="x">v</col> → { x: decoded v }. 의존성 없이 항목 단위. */
export function xmlColsByName(itemXml: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of itemXml.matchAll(/<col\s+name="([^"]*)">([\s\S]*?)<\/col>/gi)) {
    out[m[1]] = decodeXml(m[2]).trim();
  }
  return out;
}

function readMatchCount(xml: string): number | null {
  const m = xml.match(/<matchCount>\s*(\d+)\s*<\/matchCount>/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

/** 문지기 XML·item 0개+matchCount 불가독은 빈 목록이 아니라 throw (출처 격리). */
function assertKstartupXml(xml: string): void {
  if (/<OpenAPI_ServiceResponse\b/i.test(xml)) {
    throw new Error("K-Startup 문지기 오류(OpenAPI_ServiceResponse)");
  }
  if (splitXmlItems(xml).length === 0 && readMatchCount(xml) == null) {
    throw new Error("K-Startup 응답에서 matchCount 를 읽을 수 없고 item 이 0개입니다");
  }
}

function parseOneBound(raw: string, kind: "start" | "end"): Date | null {
  const t = s(raw);
  if (!t) return null;
  const parsed = parseApplyPeriod(`${t} ~ ${t}`);
  return kind === "start" ? parsed.start : parsed.end;
}

function recruitingCount(xml: string): number {
  let n = 0;
  for (const itemXml of splitXmlItems(xml)) {
    if (s(xmlColsByName(itemXml).rcrt_prgs_yn) === "Y") n += 1;
  }
  return n;
}

export function normalizeKstartupItem(cols: Record<string, string>): NormalizedAnnouncement {
  const begin = s(cols.pbanc_rcpt_bgng_dt);
  const finish = s(cols.pbanc_rcpt_end_dt);
  const periodText = [begin, finish].filter(Boolean).join(" ~ ");
  const target = s(cols.aply_trgt_ctnt);
  const excl = s(cols.aply_excl_trgt_ctnt);
  const link = s(cols.detl_pg_url);
  return {
    source: "kstartup",
    sourceId: s(cols.pbanc_sn) || link,
    title: s(cols.biz_pbanc_nm) || s(cols.intg_pbanc_biz_nm),
    agency: s(cols.pbanc_ntrp_nm),
    category: s(cols.supt_biz_clsfc),
    region: s(cols.supt_regin),
    summary: s(cols.pbanc_ctnt),
    targetText: excl ? `${target}\n[제외대상]\n${excl}` : target,
    applyStart: parseOneBound(begin, "start"),
    applyEnd: parseOneBound(finish, "end"),
    applyPeriodText: periodText,
    url: link,
    attachments: [],
    raw: { ...cols, applyUrl: s(cols.biz_aply_url) },
  };
}

/** 공고번호·링크가 둘 다 비면 저장하지 않는다. 거른 수는 로그로 남긴다. */
export function keepIdentifiable(list: NormalizedAnnouncement[]): NormalizedAnnouncement[] {
  const kept = list.filter((a) => a.sourceId || a.url);
  const dropped = list.length - kept.length;
  if (dropped > 0) {
    console.warn(`[policy-match] K-Startup 식별불가 ${dropped}건 제외 (공고번호·링크 둘 다 없음)`);
  }
  return kept;
}

export function announcementsFromKstartupXml(xml: string): NormalizedAnnouncement[] {
  assertKstartupXml(xml);
  const out: NormalizedAnnouncement[] = [];
  let skipped = 0;
  for (const itemXml of splitXmlItems(xml)) {
    const cols = xmlColsByName(itemXml);
    if (s(cols.rcrt_prgs_yn) !== "Y") {
      skipped += 1;
      continue;
    }
    out.push(normalizeKstartupItem(cols));
  }
  if (skipped > 0) {
    console.warn(`[policy-match] K-Startup 모집중 아님 ${skipped}건 제외`);
  }
  return keepIdentifiable(out);
}

export async function fetchKstartupAll(): Promise<NormalizedAnnouncement[]> {
  const key = process.env.DATA_GO_KR_API_KEY;
  if (!key) throw new Error("DATA_GO_KR_API_KEY 없음");
  const out: NormalizedAnnouncement[] = [];
  let emptyRecruiting = 0;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await fetch(
      `${BASE}?serviceKey=${encodeURIComponent(key)}&page=${page}&perPage=${PAGE_UNIT}`,
      { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) },
    );
    if (!res.ok) {
      throw new Error(`K-Startup 호출 실패(${res.status}) ${(await res.text().catch(() => "")).slice(0, 200)}`);
    }
    const xml = await res.text();
    const rawCount = splitXmlItems(xml).length;
    out.push(...announcementsFromKstartupXml(xml));
    if (recruitingCount(xml) === 0) emptyRecruiting += 1;
    else emptyRecruiting = 0;
    if (emptyRecruiting >= 2) return out;
    if (rawCount < PAGE_UNIT) return out;
  }
  console.warn(`[policy-match] K-Startup ${MAX_PAGES}쪽 상한 도달 — 이후 쪽은 다음 주기에`);
  return out;
}
