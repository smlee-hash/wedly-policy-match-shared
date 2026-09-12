// 과기부 사업공고 어댑터.
// 호출: GET apis.data.go.kr/1721000/msitannouncementinfo/businessAnnouncMentList
//   ?serviceKey=DATA_GO_KR_API_KEY&pageNo=n&numOfRows=100
// 응답(2026-08-26 실측 고정본): XML response/header/body/items/item — 태그명 구조(col name 아님).
// 실측(2026-09-13): numOfRows=100 요청에도 선언 numOfRows=10, totalCount=4251. 쪽 종료는 요청 크기가 아니라 실수신 건수.
// 게시물형: 신청기간·대상은 추정하지 않는다. applyEnd 는 항상 null.
import { XMLParser } from "fast-xml-parser";
import {
  attachmentKindOf,
  type NormalizedAnnouncement,
  type PolicyAttachment,
  type PolicySource,
} from "../types";

const BASE = "https://apis.data.go.kr/1721000/msitannouncementinfo/businessAnnouncMentList";
const PAGE_UNIT = 100;
const SAFETY_MAX_PAGES = 500; // 넘으면 미완료. 잘린 목록을 성공으로 돌리지 않는다.
const MS_365_DAYS = 365 * 24 * 60 * 60 * 1000;
export const FETCH_TIMEOUT_MS = 30_000;
const AGENCY = "과학기술정보통신부";

const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");

type XmlObject = Record<string, unknown>;

function invalidXml(): never {
  throw new Error("과기부 응답 형식이 올바르지 않습니다");
}

function xmlObject(value: unknown, allowEmpty = false): XmlObject {
  if (allowEmpty && value === "") return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) invalidXml();
  return value as XmlObject;
}

function xmlText(value: unknown): string {
  if (value === undefined) return "";
  if (typeof value !== "string") invalidXml();
  return value.trim();
}

const XML_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

/** 파서가 실제 문자 노드에만 호출한다. CDATA와 해독 결과를 다시 해독하지 않는다. */
function decodeXmlText(text: string): string {
  return text.replace(/&([^;]*);/g, (_reference, name: string) => {
    if (Object.hasOwn(XML_ENTITIES, name)) return XML_ENTITIES[name];
    const decimal = /^#[0-9]+$/.test(name);
    if (!decimal && !/^#x[0-9a-fA-F]+$/.test(name)) invalidXml();
    const point = Number.parseInt(name.slice(decimal ? 1 : 2), decimal ? 10 : 16);
    // XML 1.0 Char 범위. NUL·서로게이트·범위를 벗어난 값은 원문을 훼손해 저장하지 않는다.
    if (!(point === 0x9 || point === 0xa || point === 0xd
      || (point >= 0x20 && point <= 0xd7ff) || (point >= 0xe000 && point <= 0xfffd)
      || (point >= 0x10000 && point <= 0x10ffff))) invalidXml();
    return String.fromCodePoint(point);
  });
}

/** 메타데이터·항목은 실제 XML 자식으로 읽는다. 주석·CDATA 안의 태그 문자열은 구조가 아니다. */
function readXml(xml: string): XmlObject {
  try {
    return xmlObject(new XMLParser({
      parseTagValue: false,
      trimValues: true,
      ignoreDeclaration: true,
      ignorePiTags: true,
      entityDecoder: {
        decode: decodeXmlText,
        // 실제 DTD를 파서가 만났을 때만 거부한다. 주석·CDATA·PI의 글자는 선언이 아니다.
        addInputEntities: invalidXml,
        setExternalEntities: entities => { if (Object.keys(entities).length) invalidXml(); },
        reset: () => {},
        setXmlVersion: () => {},
      },
    }).parse(xml, true));
  } catch {
    // 파서 오류에 응답 원문이나 키를 포함하지 않는다.
    invalidXml();
  }
}

function itemTags(item: XmlObject): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(item)) {
    if (name !== "files" && name !== "#text") out[name] = xmlText(value);
  }
  return out;
}

/** <item> 안 태그명 → 값. files 블록은 빼고 직접 자식만. */
export function xmlTagsOfItem(itemXml: string): Record<string, string> {
  return itemTags(xmlObject(readXml(`<item>${itemXml}</item>`).item, true));
}

function parseFiles(item: XmlObject): PolicyAttachment[] {
  if (item.files === undefined) return [];
  const block = xmlObject(item.files, true);
  if (block.file === undefined) return [];
  const files = Array.isArray(block.file) ? block.file : [block.file];
  const out: PolicyAttachment[] = [];
  for (const value of files) {
    const file = xmlObject(value);
    const name = xmlText(file.fileName);
    const url = xmlText(file.fileUrl);
    if (!url) throw incomplete("첨부 주소");
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
  const [year, month, day] = m.slice(1).map(Number);
  const t = Date.UTC(year, month - 1, day);
  const d = new Date(t);
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day ? t : null;
}

function isOlderThan365Days(pressDt: string, now: Date): boolean {
  const t = pressDtUtcMs(pressDt);
  if (t == null) return false;
  return t < now.getTime() - MS_365_DAYS;
}

export function normalizeMsitItem(itemXml: string): NormalizedAnnouncement {
  return normalizeParsedItem(xmlObject(readXml(`<item>${itemXml}</item>`).item, true));
}

function normalizeParsedItem(item: XmlObject): NormalizedAnnouncement {
  const tags = itemTags(item);
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
    attachments: parseFiles(item),
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

function assertResultCode(header: XmlObject): void {
  const code = xmlText(header.resultCode);
  if (code !== "00") {
    throw new Error(`과기부 응답 오류(resultCode=${/^\d{2}$/.test(code) ? code : "확인 불가"})`);
  }
}

function keepRecent(items: NormalizedAnnouncement[], now: Date): NormalizedAnnouncement[] {
  const kept: NormalizedAnnouncement[] = [];
  for (const a of items) {
    const pressDt = s((a.raw as Record<string, string>).pressDt);
    if (isOlderThan365Days(pressDt, now)) continue;
    kept.push(a);
  }
  return keepIdentifiable(kept);
}

export function announcementsFromMsitXml(xml: string, now = new Date()): NormalizedAnnouncement[] {
  return keepRecent(readResponse(xml).items, now);
}

function incomplete(reason: string): Error {
  return new Error(`과기부 수집이 끝나지 않았습니다(${reason})`);
}

function redactSecrets(text: string, key: string): string {
  let out = text;
  if (key) {
    out = out.split(key).join("[redacted]");
    const enc = encodeURIComponent(key);
    if (enc !== key) out = out.split(enc).join("[redacted]");
  }
  return out.replace(/serviceKey=[^&\s"'\\]+/gi, "serviceKey=[redacted]");
}

function throwSafe(message: string, key: string): never {
  throw new Error(redactSecrets(message, key));
}

function readMetaInt(containers: XmlObject[], tag: string, reason: string): number | null {
  const values = containers.filter(container => Object.hasOwn(container, tag)).map(container => container[tag]);
  if (values.length === 0) return null;
  if (values.length !== 1 || typeof values[0] !== "string") throw incomplete(reason);
  const raw = values[0].trim();
  if (!/^(0|[1-9]\d*)$/.test(raw)) throw incomplete(reason);
  const n = Number(raw);
  if (!Number.isSafeInteger(n)) throw incomplete(reason);
  return n;
}

function itemId(a: NormalizedAnnouncement): string {
  return a.sourceId || a.url;
}

function readResponse(xml: string): { items: NormalizedAnnouncement[]; metadata: XmlObject[] } {
  const document = readXml(xml);
  if (Object.hasOwn(document, "OpenAPI_ServiceResponse")) {
    throw new Error("과기부 문지기 오류(OpenAPI_ServiceResponse)");
  }
  if (Object.keys(document).length !== 1 || !Object.hasOwn(document, "response")) invalidXml();
  const response = xmlObject(document.response);
  assertResultCode(xmlObject(response.header));
  const body = xmlObject(response.body);
  const container = xmlObject(body.items, true);
  const values = container.item === undefined ? [] : Array.isArray(container.item) ? container.item : [container.item];
  return {
    items: values.map(value => normalizeParsedItem(xmlObject(value, true))),
    metadata: [body, container],
  };
}

function parseMsitPage(xml: string, requestedPage: number): {
  items: NormalizedAnnouncement[];
  totalCount: number | null;
} {
  const { items, metadata } = readResponse(xml);
  const pageNo = readMetaInt(metadata, "pageNo", "쪽");
  const numOfRows = readMetaInt(metadata, "numOfRows", "건수");
  const totalCount = readMetaInt(metadata, "totalCount", "건수");
  if (pageNo !== null && pageNo !== requestedPage) throw incomplete("쪽");
  for (const a of items) {
    if (!s(a.title) || !itemId(a)) throw incomplete("항목");
    let url: URL;
    try { url = new URL(a.url); } catch { throw incomplete("상세 주소"); }
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) throw incomplete("상세 주소");
  }
  if (totalCount !== null && items.length > totalCount) throw incomplete("건수");
  if (numOfRows !== null && items.length > numOfRows) throw incomplete("건수");
  if (totalCount !== null && numOfRows !== null) {
    if (numOfRows === 0 && totalCount > 0) throw incomplete("건수");
    const remaining = Math.max(0, totalCount - (requestedPage - 1) * numOfRows);
    if (items.length !== Math.min(numOfRows, remaining)) throw incomplete("쪽 일부 누락");
  }
  return { items, totalCount };
}

async function fetchMsitPageXml(page: number, key: string): Promise<string> {
  const url = `${BASE}?serviceKey=${encodeURIComponent(key)}&pageNo=${page}&numOfRows=${PAGE_UNIT}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) throwSafe(`과기부 호출 실패(${res.status})`, key);
    return await res.text();
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("과기부")) {
      throwSafe(err.message, key);
    }
    throwSafe("과기부 호출에 실패했습니다", key);
  }
}

export async function fetchMsitAll(now = new Date()): Promise<NormalizedAnnouncement[]> {
  const key = process.env.DATA_GO_KR_API_KEY;
  if (!key) throw new Error("DATA_GO_KR_API_KEY 없음");
  const out: NormalizedAnnouncement[] = [];
  const seen = new Set<string>();
  const outSeen = new Set<string>();
  let received = 0;
  let advertisedTotal: number | null = null;
  let consecutiveAllCut = 0;

  for (let page = 1; page <= SAFETY_MAX_PAGES; page++) {
    const parsed = parseMsitPage(await fetchMsitPageXml(page, key), page);
    if (parsed.totalCount !== null) advertisedTotal = parsed.totalCount;
    if (advertisedTotal !== null && received + parsed.items.length > advertisedTotal) {
      throw incomplete("전체 건수 변경");
    }

    if (parsed.items.length === 0) {
      if (advertisedTotal !== null && received < advertisedTotal) {
        throw incomplete("조기종료");
      }
      return out;
    }

    const ids = parsed.items.map(itemId);
    if (new Set(ids).size !== ids.length) throw incomplete("반복");
    const fresh = ids.filter((id) => !seen.has(id));
    // 한 건만 겹쳐도 실수신 누적이 부풀어 마지막 공고 전에 totalCount에 닿을 수 있다.
    if (fresh.length !== ids.length) throw incomplete("반복");
    for (const id of ids) seen.add(id);
    received += parsed.items.length;

    for (const a of keepRecent(parsed.items, now)) {
      const id = itemId(a);
      if (!id || outSeen.has(id)) continue;
      outSeen.add(id);
      out.push(a);
    }

    const allCut = parsed.items.every((a) =>
      isOlderThan365Days(s((a.raw as Record<string, string>).pressDt), now),
    );
    consecutiveAllCut = allCut ? consecutiveAllCut + 1 : 0;
    if (consecutiveAllCut >= 2) return out;
    if (advertisedTotal !== null && received >= advertisedTotal) return out;
  }

  throw incomplete("쪽상한");
}
