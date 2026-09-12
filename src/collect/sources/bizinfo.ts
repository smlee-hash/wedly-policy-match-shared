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
const SAFETY_MAX_PAGES = 500; // 넘으면 미완료. 잘린 목록을 성공으로 돌리지 않는다.
const PAGE_ATTEMPTS = 3;
const BACKOFF_MS = 50;
const BACKOFF_CAP_MS = 200;
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

function incomplete(reason: string): Error {
  return new Error(`기업마당 수집이 끝나지 않았습니다(${reason})`);
}

function redactSecrets(text: string, key: string): string {
  let out = text;
  if (key) {
    out = out.split(key).join("[redacted]");
    const enc = encodeURIComponent(key);
    if (enc !== key) out = out.split(enc).join("[redacted]");
  }
  return out.replace(/crtfcKey=[^&\s"'\\]+/gi, "crtfcKey=[redacted]");
}

function throwSafe(message: string, key: string): never {
  throw new Error(redactSecrets(message, key));
}

function isTransientNetwork(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const name = String((err as { name?: string }).name ?? "");
  const code = String((err as { code?: string }).code ?? "");
  if (name === "TimeoutError" || name === "AbortError") return true;
  if (code === "ABORT_ERR" || code === "ETIMEDOUT" || code === "ECONNRESET") return true;
  if (/timeout/i.test(name)) return true;
  return err instanceof TypeError;
}

function backoffMs(attempt: number): number {
  return Math.min(BACKOFF_CAP_MS, BACKOFF_MS * attempt);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 있을 때만 읽는다. 값이 있으면 음이 아닌 정수만 받는다. */
function readTotCnt(value: unknown): number | null {
  if (value === undefined) return null;
  if (typeof value === "number") {
    if (!Number.isInteger(value) || value < 0 || !Number.isSafeInteger(value)) {
      throw incomplete("건수");
    }
    return value;
  }
  if (typeof value === "string") {
    const t = value.trim();
    if (!/^(0|[1-9]\d*)$/.test(t)) throw incomplete("건수");
    const n = Number(t);
    if (!Number.isSafeInteger(n)) throw incomplete("건수");
    return n;
  }
  throw incomplete("건수");
}

function expectedItemsOnPage(page: number, total: number): number {
  if (total === 0) return page === 1 ? 0 : -1;
  const pages = Math.ceil(total / PAGE_UNIT);
  if (page < 1 || page > pages) return -1;
  if (page < pages) return PAGE_UNIT;
  return total % PAGE_UNIT === 0 ? PAGE_UNIT : total % PAGE_UNIT;
}

function neededPages(total: number): number {
  return total === 0 ? 1 : Math.ceil(total / PAGE_UNIT);
}

/**
 * 수집 루프는 jsonArray 봉투만 인정한다.
 * extractBizinfoItems 는 정규화 시험용 호환 헬퍼이며 여기서 쓰지 않는다.
 */
function parseBizinfoPage(json: unknown): { items: Raw[]; declaredTotal: number | null } {
  if (json === null || typeof json !== "object" || Array.isArray(json)) {
    throw new Error("기업마당 응답 형식이 올바르지 않습니다");
  }
  const obj = json as Raw;
  if (!Array.isArray(obj.jsonArray)) {
    throw new Error("기업마당 응답 형식이 올바르지 않습니다");
  }
  const rawItems = obj.jsonArray as unknown[];
  const totals: number[] = [];
  const top = readTotCnt(obj.totCnt);
  if (top !== null) totals.push(top);

  const items: Raw[] = [];
  for (const raw of rawItems) {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      throw incomplete("항목");
    }
    const item = raw as Raw;
    const title = stripTags(s(item.pblancNm) || s(item.title));
    const idOrLink = s(item.pblancId) || s(item.pblancUrl) || s(item.link);
    if (!title || !idOrLink) throw incomplete("항목");
    const n = readTotCnt(item.totCnt);
    if (n !== null) totals.push(n);
    items.push(item);
  }

  let declaredTotal: number | null = null;
  if (totals.length > 0) {
    declaredTotal = totals[0]!;
    if (totals.some((n) => n !== declaredTotal)) throw incomplete("건수");
  }
  return { items, declaredTotal };
}

async function fetchPageJson(page: number, key: string): Promise<unknown> {
  const url = `${BASE}?crtfcKey=${encodeURIComponent(key)}&dataType=json&pageUnit=${PAGE_UNIT}&pageIndex=${page}`;
  for (let attempt = 1; attempt <= PAGE_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (res.ok) {
        try {
          return await res.json();
        } catch {
          throwSafe("기업마당 응답 형식이 올바르지 않습니다", key);
        }
      }
      const status = res.status;
      if (status === 429 || status >= 500) {
        if (attempt < PAGE_ATTEMPTS) {
          await sleep(backoffMs(attempt));
          continue;
        }
        throwSafe(`기업마당 호출 실패(${status})`, key);
      }
      throwSafe(`기업마당 호출 실패(${status})`, key);
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("기업마당")) {
        throwSafe(err.message, key);
      }
      if (isTransientNetwork(err) && attempt < PAGE_ATTEMPTS) {
        await sleep(backoffMs(attempt));
        continue;
      }
      if (isTransientNetwork(err)) throwSafe("기업마당 호출 시간 초과", key);
      throwSafe("기업마당 호출에 실패했습니다", key);
    }
  }
  throwSafe("기업마당 호출에 실패했습니다", key);
}

/** 전 페이지 수집. 잘림·키·주소·본문은 오류에 넣지 않는다. */
export async function fetchBizinfoAll(): Promise<NormalizedAnnouncement[]> {
  const key = process.env.BIZINFO_API_KEY;
  if (!key) throw new Error("BIZINFO_API_KEY 없음 — 환경변수를 등록하세요");
  const out: NormalizedAnnouncement[] = [];
  const seen = new Set<string>();
  let declaredTotal: number | null = null;

  for (let page = 1; page <= SAFETY_MAX_PAGES; page++) {
    const parsed = parseBizinfoPage(await fetchPageJson(page, key));

    if (parsed.declaredTotal !== null) {
      if (declaredTotal === null) {
        declaredTotal = parsed.declaredTotal;
        if (neededPages(declaredTotal) > SAFETY_MAX_PAGES) throw incomplete("쪽상한");
      } else if (parsed.declaredTotal !== declaredTotal) {
        throw incomplete("건수");
      }
    }

    if (declaredTotal !== null) {
      const expected = expectedItemsOnPage(page, declaredTotal);
      if (expected < 0 || parsed.items.length !== expected) {
        throw incomplete(parsed.items.length === 0 ? "조기종료" : "건수");
      }
    }

    for (const item of parsed.items) {
      const ann = normalizeBizinfoItem(item);
      const id = ann.sourceId || ann.url;
      if (!ann.title || !id) throw incomplete("항목");
      if (seen.has(id)) throw incomplete("반복");
      seen.add(id);
      out.push(ann);
    }

    if (declaredTotal !== null) {
      const pages = neededPages(declaredTotal);
      if (page === pages) {
        if (out.length !== declaredTotal) throw incomplete("건수");
        return out;
      }
      continue;
    }

    if (parsed.items.length < PAGE_UNIT) return out;
  }

  throw incomplete("쪽상한");
}
