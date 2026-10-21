// 공고 첨부(pdf·hwpx·hwp·hml)에서 글자를 뽑아 구조화 입력으로 쓴다.
// 네트워크는 주입 가능한 fetch — 시험은 가짜, 운영만 실호출.
import { parse as parseCfb, find as findCfb } from "cfb";
import iconv from "iconv-lite";
import { getDocumentProxy, extractText } from "unpdf";
import {
  ATTACHMENT_KINDS,
  attachmentKindOf,
  type PolicyAttachment,
  type PolicyAttachmentKind,
} from "./types";
import {
  attachmentNameRole,
  attachmentRequestKey,
  effectiveAttachmentKind,
  isSiteCommonAttachment,
  sameDocumentKey,
} from "./attachment-order";
import { BOARD_SOURCES } from "./board/source-list";
import type { PolicyAttachmentRequest } from "./board/types";
import { allowedHostsOf } from "./board/engine";
import { repairStoredAttachmentUrl } from "./board/attachment-url";
import { isProxyTransportError } from "./board/proxy";
import { withBrowserIdentity } from "./board/fetch-identity";
import { cookieHeaderFor, cookieJarAbsorb, mergeCookieHeader, setCookieValuesOf, type CookieJar } from "./board/registry";
import { extractHwpText, isProtectedHwp } from "./hwp-text";
import { extractHmlText } from "./hml-text";
import { classifyOleDocument, classifyZipDocument, extractOdtText } from "./office-text";
import { archiveEntryNameKind, listArchiveEntries } from "./archive-entries";
import { extractDocumentText } from "../documents/extract-text";
import {
  renderAttachmentBlocks,
  type RenderBlock,
  type TextPiece,
} from "./attachment-render";

export const EXTRACTABLE_KINDS = ["pdf", "hwp", "hwpx"] as const;
export type ExtractableKind = (typeof EXTRACTABLE_KINDS)[number];
/** 안쪽에서 글자를 뽑는 형식 — hml·docx·xlsx·pptx·odt·xls 는 이름·저장 형식으로는 안 오고 받은 바이트로만 알아본다. */
type ReadKind = ExtractableKind | "hml" | "docx" | "xlsx" | "pptx" | "odt" | "xls";

/**
 * AI 에게 보내는 글자의 95%가 첨부 원문이다(2026-08-25 실측: 첨부 평균 5,925자 vs 본문 324자).
 * 파일 1개·8,000자로 줄여 값을 낮춘다 — 중앙값이 3,603자라 대부분은 온전히 들어간다.
 * 못 읽은 첨부는 「확인 필요」로 남아 「가능」으로 올라가지 않는다.
 */
export const DEFAULT_MAX_FILES = 1;
export const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;
export const DEFAULT_TIMEOUT_MS = 30_000;
export const DEFAULT_CHAR_CAP = 8_000;

/**
 * 내려받기를 허용하는 호스트. 주소는 기업마당 API 가 주지만 그 값도 바깥에서 온 입력이다 —
 * 그대로 부르면 서버가 내부망(169.254.x.x 등)이나 남의 서버를 대신 불러 주는 통로가 된다.
 */
export const ALLOWED_ATTACHMENT_HOSTS = ["www.bizinfo.go.kr", "bizinfo.go.kr"] as const;
/** 옛 정적 목록(2026-08-30~). 명부에서 자동으로 뽑으므로 새 게시판을 여기 적을 필요가 없다 — 남겨 두는 건 되돌림 대비. */
const BOARD_ATTACHMENT_HOSTS = [
  "www.btp.or.kr",
  "ctp.or.kr",
  "www.djtp.or.kr",
  "www.jbtp.or.kr",
  "platform.utp.or.kr",
  "www.jbba.kr",
  "www.djbea.or.kr",
  "www.gbtp.or.kr",
  "www.gntp.or.kr",
  "bizok.incheon.go.kr",
  "www.mss.go.kr",
  "www.semas.or.kr",
  "www.exportvoucher.com",
  "gn.riia.or.kr",
  "jn.riia.or.kr",
  "www.khidi.or.kr",
  "www.gcgf.or.kr",
  "www.gepa.kr",
  "www.smart-factory.kr",
  "www.seoultp.or.kr",
  // 2026-08-30 추가 — 이 두 곳은 상세 페이지에 표지문만 있고 자격 조건이 첨부에만 있다
  // (과기정통부 표본 26건: 페이지 132~473자·지원대상 문단 0건 vs 같은 공고 hwpx 3,559자).
  "www.msit.go.kr",
  "www.cba.ne.kr",
] as const;

let allowedHostCache: Set<string> | null = null;
/** 첨부를 내려받아도 되는 호스트(소문자). 기업마당 2 + 옛 목록 + 게시판 명부 전 항목. 포트가 적힌 호스트는 포트째 들어간다. */
function allowedAttachmentHosts(): Set<string> {
  if (allowedHostCache) return allowedHostCache;
  const set = new Set<string>([...ALLOWED_ATTACHMENT_HOSTS, ...BOARD_ATTACHMENT_HOSTS].map((h) => h.toLowerCase()));
  for (const cfg of BOARD_SOURCES) for (const h of allowedHostsOf(cfg)) set.add(h.toLowerCase());
  allowedHostCache = set;
  return set;
}

const CFB_SIG = [0xd0, 0xcf, 0x11, 0xe0];
const KIND_SET = new Set<string>(ATTACHMENT_KINDS);
const EXTRACTABLE_SET = new Set<string>(EXTRACTABLE_KINDS);
/** 「기타」 첨부도 내려받아 볼 후보에 넣는다 — 이름은 없어도 내용은 pdf·hwp 일 때가 많다(중기중앙회·창조경제혁신센터 실측). */
const CANDIDATE_KINDS = new Set<string>([...EXTRACTABLE_KINDS, "etc"]);
/** 전문을 뽑을 수 있는 형식(pdf·hwpx)을 먼저 읽는다 — 호환을 위해 hwp 순위는 그대로 뒤. etc 는 맨 뒤. */
const KIND_RANK: Record<string, number> = { pdf: 0, hwpx: 0, hwp: 1, etc: 2, zip: 3 };
/** zip 안 항목은 많아야 20개만 보이고 나머지는 「외 N개」 한 줄 — 목록이 표시 글자를 차지하지 않게. */
const MAX_ARCHIVE_SHOWN = 20;

/** POST 첨부에 수집기가 머리글을 안 적었을 때 붙는 기본 형식(브라우저 form 제출과 같다). */
export const FORM_CONTENT_TYPE = "application/x-www-form-urlencoded; charset=UTF-8";

const PDF_SIG = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
const OLE_SIG = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const ZIP_SIG = [0x50, 0x4b, 0x03, 0x04];

/** 파일 하나의 결과에 붙는 이유 한 마디 — 못 받은 곳(내려받기·형식·글자)과 덜 읽힌 곳(미리보기·잘림·개수 상한). */
export type AttachmentFileReason =
  | "blocked_url"
  | "blocked_host"
  | "not_found"
  | "http_error"
  | "redirect_limit"
  | "too_big"
  | "empty"
  | "timeout"
  | "aborted"
  | "network"
  | "transport"
  | "unknown_format"
  | "image"
  | "html"
  | "image_pdf"
  | "protected"
  | "no_text"
  | "preview_only"
  | "over_limit"
  | "truncated"
  /** 문서가 아닌 압축 묶음(서식 모음 zip 등). */
  | "archive"
  /** zip 안에서 또 나온 압축 묶음 — 더 열지 않는다. */
  | "nested_archive"
  /** 읽을 도구가 없는 옛 워드(.doc)·옛 파워포인트(.ppt). */
  | "unsupported"
  /** 같은 문서를 다른 형식으로 이미 읽었다. */
  | "same_document";

/** 받은 바이트 앞머리로 알아본 형식. zip 은 속 항목으로 다시 가린다(hwpx·docx·xlsx·pptx·odt·압축 묶음 모두 PK). */
export type AttachmentFormat = "pdf" | "hwp" | "zip" | "hml" | "image" | "html";

export type AttachmentFileOutcome = {
  name: string;
  result: "read" | "failed" | "skipped" | "duplicate" | "ignored";
  reason?: AttachmentFileReason;
  /** 읽었을 때: 자르기 전 본문 글자 수. */
  chars?: number;
  /** 글자를 실제로 뽑은 형식(pdf·hwp·hwpx·hml·docx·xlsx·pptx·odt·xls). */
  kind?: string;
};

export type AttachmentTextResult = {
  text: string;
  readFiles: string[];
  failedFiles: string[];
  /** 개수 상한에 걸려 아예 안 읽은 첨부 — 존재만 알린다. */
  skippedFiles: string[];
  /** HWP 본문 대신 미리보기만 읽었다. 다른 완전한 본문이 없는 행은 자동 저장하지 않는다. */
  previewOnlyFiles?: string[];
  /**
   * 요청까지 간 첨부 중 **하나라도 경유 통로 탓으로** 실패했다
   * (프록시 호스트에 못 닿음·CONNECT 거부·프록시가 만든 401·403·500).
   * 사이트가 준 404·500 과 구분하려고 둔다 — 부르는 쪽이 7일 도장 대신 **1시간 짧은 도장**을 찍어
   * 프록시가 살아난 뒤 곧 다시 보게 한다. 경유를 안 쓰는 길에서는 늘 거짓이다.
   */
  proxyFailed?: boolean;
  /**
   * 자동 저장(`includeHwpPreview: false`)에서만 채운다.
   * 최종 문자열에 실제로 남은 정상 첨부 본문의 UTF-16 글자 수.
   * 머리글·경고·잘림·미확인 표식·미리보기·상한으로 사라진 본문은 넣지 않는다.
   */
  bodyTextChars?: number;
  /** 같은 문서 다른 형식이라 읽지 않은 첨부(`sameDocumentOnce` 를 켰을 때만). 비면 키를 넣지 않는다. */
  sameDocumentFiles?: string[];
  /** 파일마다 결과·못 읽은 이유(처리 순서). 표시 글자(text)와 별개다 — AI 에게 가는 글자는 이걸로 바뀌지 않는다. */
  files?: AttachmentFileOutcome[];
};

/**
 * 허용 호스트면 https 로 올린 주소를, 아니면 null 을 돌려준다.
 * `new URL` 이 호스트를 해석하므로 `https://www.bizinfo.go.kr.evil.com` · `https://evil.com/www.bizinfo.go.kr`
 * 같은 흉내 주소는 저절로 걸린다.
 */
export function safeAttachmentUrl(raw: string | null | undefined): string | null {
  const t = (raw ?? "").trim();
  if (!t) return null;
  let u: URL;
  try {
    u = new URL(t);
  } catch {
    return null; // 상대주소·형식 오류 — 호스트를 알 수 없으니 부르지 않는다
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (u.username || u.password) return null;
  const allowed = allowedAttachmentHosts();
  const hostWithPort = u.host.toLowerCase();
  const hostname = u.hostname.toLowerCase();
  if (u.port && allowed.has(hostWithPort)) {
    // 명부가 포트까지 적은 호스트(portal.snip.or.kr:8443) — 그 포트 그대로, 통신방식만 https 로.
    u.protocol = "https:";
    return u.toString();
  }
  if (u.port && u.port !== "80" && u.port !== "443") return null;
  if (!allowed.has(hostname)) return null;
  u.port = "";
  u.protocol = "https:";
  return u.toString();
}

export type AttachmentFetch = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * hwpx(한글 2014+)에서 글자를 뽑는 함수 — 앱이 넣어 준다(원문: 앱의 documents/extract-text
 * 의 `extractHwpx`, adm-zip 로 `Contents/section*.xml` 을 푼다). pdf 는 unpdf, hwp 는 본문(실패 시
 * 미리보기·미확인 표식)을 이 보관함이 직접 뽑지만, hwpx 추출기는 adm-zip 을 끌고 와 여기 두지 않고 주입으로 받는다.
 * ★**필수 주입**이다(P3 회귀 방어) — 안 넘기면 타입 오류다. 옛날엔 안 넘기면 조용히 빈 글로
 * 취급해서, hwpx 첨부에만 본문이 있는 공고가 빈 채로 저장되고 회차는 성공으로 끝나는 사고가 있었다.
 */
export type ExtractHwpx = (buf: Buffer) => string | Promise<string>;

export type FetchAttachmentTextsOptions = {
  maxFiles?: number;
  /** 못 읽은 파일 대신 더 시도할 수(읽은 수 상한 `maxFiles` 는 그대로). 기본 0. */
  extraAttempts?: number;
  maxBytes?: number;
  timeoutMs?: number;
  totalCharCap?: number;
  /** 자동 본문 저장은 false. HWP 미리보기 글자는 빼고 미확인 표식만 남긴다. 기본은 미리보기 보존. */
  includeHwpPreview?: boolean;
  /** 이름이 같은 문서(`공고.hwp`·`공고.pdf`·`공고.hwpx`…)는 한 번만 읽는다. 기본 false 는 지금과 같다. */
  sameDocumentOnce?: boolean;
  /** 받은 압축 묶음(zip)을 열어 안의 문서를 읽는다. 기본 false 는 예전과 같다. */
  readArchives?: boolean;
  fetch?: AttachmentFetch;
  /** hwpx 글자 추출기(앱 주입 — **필수**). 위 `ExtractHwpx` 주석 참조. */
  extractHwpx: ExtractHwpx;
  /**
   * 바깥에서 건 **예산** 표식. 파일 하나짜리 시간 상한(`timeoutMs`)과 **함께** 걸려,
   * 둘 중 먼저 끝나는 쪽이 요청을 끊는다.
   * 왜: 수집 꼬리의 4분 예산이 행 **사이**에서만 검사되면, 한 첨부가 10분 멈출 때
   * 자물쇠(20분)보다 오래 붙잡혀 두 실행이 겹친다(2026-09-06 독립 리뷰 5번).
   */
  signal?: AbortSignal;
};

function isExtractable(kind: string): kind is ExtractableKind {
  return EXTRACTABLE_SET.has(kind);
}

function startsWithSig(bytes: Uint8Array, sig: number[]): boolean {
  if (bytes.length < sig.length) return false;
  return sig.every((b, i) => bytes[i] === b);
}

/** 첫 바이트로 형식을 가른다. PK 는 hwpx 후보일 뿐이다(docx·zip 도 PK) — 뽑아서 비면 실패로 친다. */
export function sniffAttachmentKind(buf: Buffer | Uint8Array): ExtractableKind | null {
  const bytes = buf instanceof Uint8Array ? buf : Uint8Array.from(buf);
  if (startsWithSig(bytes, PDF_SIG)) return "pdf";
  if (startsWithSig(bytes, OLE_SIG)) return "hwp";
  if (startsWithSig(bytes, ZIP_SIG)) return "hwpx";
  return null;
}

const JPEG_SIG = [0xff, 0xd8, 0xff];
const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const GIF87_SIG = [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]; // GIF87a
const GIF89_SIG = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]; // GIF89a
const RIFF_SIG = [0x52, 0x49, 0x46, 0x46];
const WEBP_SIG = [0x57, 0x45, 0x42, 0x50];
const TIFF_LE_SIG = [0x49, 0x49, 0x2a, 0x00];
const TIFF_BE_SIG = [0x4d, 0x4d, 0x00, 0x2a];
/** 글자 앞머리를 볼 때 풀어 보는 바이트 수. */
const TEXT_HEAD_BYTES = 4096;
const HWPML_TAG = /<hwpml\b/i;
const HTML_START = /^<(?:!doctype\s+html|html|head|body|script|meta)\b/i;

function isBmpHead(bytes: Uint8Array): boolean {
  // `BM` + 크기 4바이트 + 예약 4바이트(0). 「BMW …」 같은 글과 가르려고 예약 칸을 본다.
  return bytes.length >= 10 && bytes[0] === 0x42 && bytes[1] === 0x4d && bytes.subarray(6, 10).every((b) => b === 0);
}

/** 앞머리 글자 — BOM 으로 UTF-8·UTF-16 을 알아보고, 없으면 latin1 로 본다(태그 글자만 필요하다). */
function textHeadOf(bytes: Uint8Array): string {
  const head = Buffer.from(bytes.subarray(0, TEXT_HEAD_BYTES));
  if (head.length >= 3 && head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf) return head.subarray(3).toString("utf8");
  if (head.length >= 2 && head[0] === 0xff && head[1] === 0xfe) return head.subarray(2).toString("utf16le");
  if (head.length >= 2 && head[0] === 0xfe && head[1] === 0xff) return iconv.decode(head.subarray(2), "utf-16be");
  return head.toString("latin1");
}

/**
 * 받은 바이트 앞머리로 형식을 가린다 — `sniffAttachmentKind` 보다 넓다(그림·HML·HTML 오류 쪽까지).
 * 2026-10-01 운영 실측: 해양수산부 `.hml` 이 형식을 몰라 하나도 안 읽혔고, 그림·HTML 오류 쪽은 「글자 없음」에 뭉쳤다.
 * 못 알아보면 null. 던지지 않는다.
 */
export function detectAttachmentFormat(buf: Buffer | Uint8Array): AttachmentFormat | null {
  try {
    const bytes = buf instanceof Uint8Array ? buf : Uint8Array.from(buf);
    if (startsWithSig(bytes, PDF_SIG)) return "pdf";
    if (startsWithSig(bytes, OLE_SIG)) return "hwp";
    if (startsWithSig(bytes, ZIP_SIG)) return "zip";
    if (
      startsWithSig(bytes, JPEG_SIG) ||
      startsWithSig(bytes, PNG_SIG) ||
      startsWithSig(bytes, GIF87_SIG) ||
      startsWithSig(bytes, GIF89_SIG) ||
      (startsWithSig(bytes, RIFF_SIG) && bytes.length >= 12 && startsWithSig(bytes.subarray(8), WEBP_SIG)) ||
      isBmpHead(bytes) ||
      startsWithSig(bytes, TIFF_LE_SIG) ||
      startsWithSig(bytes, TIFF_BE_SIG)
    ) {
      return "image";
    }
    const head = textHeadOf(bytes);
    const lead = head.trimStart();
    if (!lead.startsWith("<")) return null;
    if (HWPML_TAG.test(head)) return "hml";
    if (HTML_START.test(lead)) return "html";
    return null;
  } catch {
    return null;
  }
}

/**
 * 저장 JSON 의 머리글이 **글자 → 글자** 짝인 것만 남긴다.
 * 저장된 값은 바깥에서 온 입력이라 `{Cookie: {...}}` 같은 모양이 오면 fetch 가 그 자리에서 던진다.
 */
function safeAttachmentHeaders(raw: unknown): Record<string, string> | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof k !== "string" || !k.trim() || typeof v !== "string") continue;
    out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * 저장 JSON 이 옛 모양({name,url} only)이어도 kind 를 채워 돌려준다.
 * POST 첨부의 `method`·`body`·`headers` 는 **모양이 맞을 때만** 실어 나른다(위 도우미 참고).
 *
 * 저장 주소는 **읽을 때** 되살린다(`repairUrls` 기본 켬) — 본문이 찬 줄은 상세를 다시 안 읽어
 * 수확기 고침만으로는 저장 주소가 안 바뀐다. 첨부 글자 추출과 화면 내려받기 창구가 이 한 곳을 거친다.
 * 저장 글자 그대로 봐야 하는 비교(`repairUrls: false`)만 끈다.
 */
export function asPolicyAttachments(raw: unknown, opts: { repairUrls?: boolean } = {}): PolicyAttachmentRequest[] {
  if (!Array.isArray(raw)) return [];
  const out: PolicyAttachmentRequest[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const name = typeof o.name === "string" ? o.name.trim() : "";
    const stored = typeof o.url === "string" ? o.url.trim() : "";
    const url = opts.repairUrls !== false ? repairStoredAttachmentUrl(stored) : stored;
    if (!name && !url) continue;
    const kind: PolicyAttachmentKind = KIND_SET.has(String(o.kind ?? ""))
      ? (o.kind as PolicyAttachmentKind)
      : attachmentKindOf(name, url);
    const att: PolicyAttachmentRequest = { name, url, kind };
    // 방법은 POST 하나만 인정한다 — 저장된 글자를 그대로 fetch 에 넘기면 「DELETE」도 나갈 수 있다.
    if (typeof o.method === "string" && o.method.toUpperCase() === "POST") att.method = "POST";
    if (typeof o.body === "string" && o.body) att.body = o.body;
    const headers = safeAttachmentHeaders(o.headers);
    if (headers) att.headers = headers;
    out.push(att);
  }
  return out;
}

/**
 * AI 에게 보일 첨부 이름 목록 — 읽지 않은 첨부도 존재는 알려야 「원문에 없다」고 단정하지 않는다.
 * 저장 차례대로 돌며 사이트 공통 파일과 같은 요청(앞이 이긴다)은 뺀다. 형식은 거르지 않는다(zip·xlsx·etc 도 담는다).
 */
export function listedAttachmentNames(raw: unknown): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const a of asPolicyAttachments(raw)) {
    if (isSiteCommonAttachment(a.url)) continue;
    const key = attachmentRequestKey(a);
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(a.name || a.url);
  }
  return names;
}

/** 구형 hwp OLE 의 PrvText 스트림(UTF-16LE, 미리보기 ~1,000자). */
export function extractHwpPreview(buf: Buffer): string {
  if (!startsWithSig(buf, CFB_SIG)) return "";
  try {
    const cfb = parseCfb(Uint8Array.from(buf));
    const entry =
      findCfb(cfb, "PrvText") ??
      cfb.FileIndex.find((e) => /prvtext/i.test(e.name) && e.content) ??
      null;
    if (!entry?.content) return "";
    const bytes = Buffer.from(entry.content as Uint8Array | number[]);
    return bytes.toString("utf16le").replace(/\u0000/g, "").replace(/\r\n?/g, "\n").trim();
  } catch {
    return "";
  }
}

/**
 * unpdf(pdf.js)는 받은 버퍼를 작업 스레드로 이관해 원본이 빈다.
 * 같은 바이트를 다시 읽어야 하므로 반드시 복사본을 넘긴다.
 */
export async function extractPdfBytes(bytes: Uint8Array): Promise<string> {
  const pdf = await getDocumentProxy(bytes.slice());
  const read = await extractText(pdf, { mergePages: false });
  const pages = Array.isArray(read.text) ? read.text : [String(read.text ?? "")];
  return pages
    .map((p) => String(p ?? ""))
    .join("\n")
    .replace(/\r\n?/g, "\n")
    .trim();
}

/**
 * 저장소가 **거부하는 글자**를 걸러낸다.
 *
 * 왜 필요한가(2026-08-25 실측, 모집중 공고 28건이 이 병으로 못 읽혔다):
 * 첨부에서 뽑은 글자에 눈에 안 보이는 **빈 글자(0x00)** 가 섞여 들어오면 저장이 통째로 거부된다
 * (「인코딩에 맞지 않는 바이트」 오류). 그런데 그때는 **AI 를 이미 부른 뒤**라 값은 나가고
 * 결과는 안 남는다 — 가장 아까운 실패다. 게다가 실패로 기록돼 계속 다시 시도한다.
 *
 * 예전엔 한글 미리보기 갈래에서만 걸러냈다. PDF·한글(hwpx)로 뽑은 글자는 그냥 통과했다.
 * **뽑는 방법이 무엇이든 여기 한 곳을 지나가게** 해서 다시는 새는 갈래가 안 생기게 한다.
 */
export function stripUnstorableChars(text: string): string {
  // 빈 글자(0x00)와 저장·검색에서 문제를 일으키는 제어문자를 뺀다.
  // 줄바꿈(\n)·탭(\t)은 글의 짜임새라 남긴다.
  return (
    text
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
      // ★짝 잃은 반쪽 글자도 뺀다(2026-08-25 적대적 리뷰 「중요 1」).
      // 이모지·확장 한자는 **두 칸이 짝**을 이뤄 한 글자가 된다. 짝이 깨진 반쪽만 남으면
      // 저장소가 통째로 거부한다 — 빈 글자와 증상이 똑같고, AI 를 부른 뒤라 값도 날아간다.
      // 반쪽이 생기는 길이 둘 있다: ① 한글(hwpx) 속 XML 의 숫자 표기(`&#xD800;`)를 되살릴 때
      // ② 글자 상한에서 자를 때 하필 짝 한가운데가 잘릴 때.
      .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "")
  );
}

/** 뽑은 결과. 글자가 비면 `failReason` 이 못 읽은 이유를 말한다. */
type Extracted = { text: string; incomplete: boolean; failReason?: AttachmentFileReason };

/**
 * 첨부 하나를 시도한 값 — 확정(`commit`) 때 이대로 `files`·표시 블록·목록에 들어간다.
 * `complete` 는 미리보기가 아닌 온전한 read, `preview` 는 이유가 preview_only 인 것(미리보기를 남기는 모드의 read, 자동 저장 모드의 skipped 모두).
 */
type Trial = {
  name: string;
  outcome: AttachmentFileOutcome;
  block: RenderBlock;
  /** 확정 때 이름을 넣을 목록(`readFiles`·`failedFiles`·`skippedFiles`·`previewOnlyFiles` 중). */
  into: string[][];
  complete: boolean;
  preview: boolean;
};

function extractedOf(raw: string, emptyReason: AttachmentFileReason): Extracted {
  const text = stripUnstorableChars(raw);
  return text.trim() ? { text, incomplete: false } : { text: "", incomplete: false, failReason: emptyReason };
}

/** 던진 오류가 암호 때문인지 — pdf.js 는 빈 암호로 안 열리면 `PasswordException` 을 던진다. */
function isPasswordError(e: unknown): boolean {
  return (e as { name?: unknown } | null)?.name === "PasswordException";
}

/** 던지지 않는다 — 못 뽑으면 빈 글자와 이유를 돌려준다. */
async function extractByKind(kind: ReadKind, buf: Buffer, extractHwpx: ExtractHwpx): Promise<Extracted> {
  try {
    if (kind === "pdf") {
      let raw: string;
      try {
        raw = await extractPdfBytes(Uint8Array.from(buf));
      } catch (e) {
        return { text: "", incomplete: false, failReason: isPasswordError(e) ? "protected" : "no_text" };
      }
      return extractedOf(raw, "image_pdf"); // 열렸는데 글자가 없으면 그림만 든 PDF
    }
    if (kind === "hwpx") return extractedOf(await extractHwpx(buf), "no_text");
    if (kind === "hml") return extractedOf(extractHmlText(buf), "no_text");
    if (kind === "odt") return extractedOf(extractOdtText(buf), "no_text");
    if (kind === "docx" || kind === "xlsx" || kind === "pptx" || kind === "xls") {
      // 워드·엑셀·파워포인트·옛 엑셀은 documents 의 읽기를 그대로 쓴다(이름은 확장자 표지일 뿐 — 바이트는 이미 가렸다).
      const doc = await extractDocumentText(`attachment.${kind}`, buf);
      if (doc.kind === "text") return extractedOf(doc.text, "no_text");
      if (doc.kind === "spreadsheet") {
        // 값 있는 시트만 시트 차례대로 빈 줄 하나를 두고 잇는다. 하나도 없으면 no_text.
        const text = doc.sheets
          .filter((sheet) => Object.keys(sheet.cells).length > 0)
          .map((sheet) => sheet.text)
          .join("\n\n");
        return extractedOf(text, "no_text");
      }
      if (doc.kind === "image") return { text: "", incomplete: false, failReason: "image" };
      return { text: "", incomplete: false, failReason: "no_text" }; // 형식은 읽을 수 있는데 열지 못했다
    }
    const body = extractHwpText(buf);
    if (body) return extractedOf(body, "no_text");
    const preview = stripUnstorableChars(extractHwpPreview(buf));
    if (preview.trim()) return { text: preview, incomplete: true };
    return { text: "", incomplete: false, failReason: isProtectedHwp(buf) ? "protected" : "no_text" };
  } catch {
    return { text: "", incomplete: false, failReason: "no_text" };
  }
}

/** 첫 시도 — 이 형식으로 뽑아 본다(`read`), 또는 뽑지 않고 이 이유로 실패로 남긴다(`skip`). */
type FirstTry = { read: ReadKind } | { skip: "archive" | "unsupported" };

/**
 * 받은 바이트 → 첫 시도. 읽을 수 없는 형식(그림·HTML)과 못 알아본 것은 null.
 * 2026-10-01 운영 표본: zip 이면 모두 한글로 넣어 새 형식이 섞인 공고 1,108건을 못 읽었다 — 속 항목으로 다시 가린다.
 */
function firstTryOf(format: AttachmentFormat | null, buf: Buffer): FirstTry | null {
  if (format === "pdf") return { read: "pdf" };
  if (format === "hml") return { read: "hml" };
  if (format === "zip") {
    const zip = classifyZipDocument(buf);
    if (zip === "archive") return { skip: "archive" };
    return { read: zip ?? "hwpx" }; // 못 열면 예전처럼 한글 추출기에 맡긴다
  }
  if (format === "hwp") {
    const ole = classifyOleDocument(buf);
    if (ole === "doc" || ole === "ppt") return { skip: "unsupported" };
    return { read: ole ?? "hwp" }; // 모르는 OLE 는 예전처럼 한글로 읽어 본다
  }
  return null;
}

function failBlock(name: string): string {
  return `[읽지 못한 첨부: ${name}]`;
}

function blockedBlock(name: string): string {
  return `[허용되지 않은 첨부 주소: ${name}]`;
}

function skippedBlock(name: string): string {
  return `[미확인 첨부: ${name}]`;
}

function headingOf(name: string): string {
  return `[첨부: ${name}]`;
}

function noticeBlock(name: string, kind: "fail" | "blocked" | "skipped", text: string): RenderBlock {
  return { name, pieces: [{ kind, text }] };
}

function contentBlock(name: string, extra: TextPiece[]): RenderBlock {
  return { name, pieces: [{ kind: "heading", text: headingOf(name) }, ...extra] };
}

type DownloadResult =
  | { ok: true; buf: Buffer }
  | { ok: false; reason: "blocked_host" | "not_found" | "http_error" | "redirect_limit" | "too_big" | "empty" };

/**
 * 응답을 통째로 메모리에 올리지 않고 흘려 읽으며 상한을 넘는 순간 끊는다.
 * content-length 는 참고도 하지 않는다 — 거짓으로 적어 보내면 그대로 속아 큰 본문을 다 받게 된다.
 * 못 받은 이유는 값으로 돌려주고, 전송 오류(fetch 가 던짐·본문 읽다 던짐)는 던진다.
 */
async function downloadBytes(
  url: string,
  fetchImpl: AttachmentFetch,
  timeoutMs: number,
  maxBytes: number,
  /** 바깥 예산 — 파일 하나짜리 시간 상한과 함께 걸어 먼저 끝나는 쪽이 끊는다. */
  outer?: AbortSignal,
  /** POST 로만 주는 첨부의 요청 방법(`method`·`body`·`headers`). 없으면 예전대로 맨 GET 이다. */
  req?: Pick<PolicyAttachmentRequest, "method" | "body" | "headers">,
): Promise<DownloadResult> {
  // 리다이렉트는 손으로 따라간다 — 자동 추적은 허용 호스트 검사를 통과한 「뒤에」
  // 내부망 주소로 302 시켜 검사를 우회하는 길이 된다(적대 리뷰 치명 지적). 매 홉을 다시 검사한다.
  let target: string = url;
  let res: Response | null = null;
  // 한 번의 내려받기 = 한 번의 시간 상한. 홉마다 timeout 을 새로 만들면 리다이렉트 3번에 상한이 4배가 된다.
  const own = AbortSignal.timeout(timeoutMs);
  const signal = outer ? AbortSignal.any([own, outer]) : own;
  // 쿠키 항아리도 내려받기 한 번 동안만 산다 — 국토부·수출입은행처럼 쿠키를 주며 같은 주소로 되돌리는 곳이 있다(2026-10-01 실측).
  const jar: CookieJar = new Map();
  for (let hop = 0; hop <= 3; hop++) {
    // ★POST 는 **첫 요청에만** 싣는다. 302 를 따라갈 때 본문을 다시 보내면 같은 내려받기가 두 번
    //  일어나거나(1회용 열쇠 소모) 엉뚱한 주소로 본문이 새 나간다 — 브라우저도 303·302 뒤에는 GET 이다.
    const init: RequestInit = { signal, redirect: "manual" };
    // 수집기가 적은 머리글도 첫 요청에만 싣는다(같은 이유).
    const base: Record<string, string> = hop === 0 ? { ...req?.headers } : {};
    if (hop === 0 && req?.method === "POST") {
      init.method = "POST";
      if (req.body !== undefined) init.body = req.body;
      // 게시판들이 쓰는 것은 전부 form 제출이다 — 수집기가 따로 안 적으면 그 형식을 기본으로 붙인다.
      const hasType = Object.keys(base).some((k) => k.toLowerCase() === "content-type");
      if (!hasType) base["Content-Type"] = FORM_CONTENT_TYPE;
    }
    // 받아 둔 쿠키는 그 홉 주소에 맞는 것만 싣고, 수집기가 적은 Cookie 는 버리지 않고 합친다.
    const jarCookie = cookieHeaderFor(jar, target);
    if (jarCookie) {
      const cookieKey = Object.keys(base).find((k) => k.toLowerCase() === "cookie") ?? "Cookie";
      const merged = mergeCookieHeader(base[cookieKey], jarCookie);
      if (merged) base[cookieKey] = merged;
    }
    // 머리글은 늘 평범한 객체다 — 경유 층·감싸개가 객체 키로 읽는다.
    init.headers = withBrowserIdentity(base);
    const r = await fetchImpl(target, init);
    // 머리글 객체가 없는 응답 모양(시험용 가짜)이어도 깨지지 않게 있을 때만 읽는다.
    if (r.headers) cookieJarAbsorb(jar, target, setCookieValuesOf(r.headers));
    if (r.status >= 300 && r.status < 400) {
      const loc = r.headers?.get("location");
      await r.body?.cancel().catch(() => {});
      if (!loc) return { ok: false, reason: "http_error" };
      if (hop === 3) return { ok: false, reason: "redirect_limit" };
      let next: string;
      try {
        next = new URL(loc, target).toString();
      } catch {
        return { ok: false, reason: "http_error" };
      }
      const safe = safeAttachmentUrl(next);
      if (!safe) return { ok: false, reason: "blocked_host" };
      target = safe;
      continue;
    }
    res = r;
    break;
  }
  if (!res) return { ok: false, reason: "redirect_limit" };
  if (!res.ok) {
    await res.body?.cancel().catch(() => {});
    return { ok: false, reason: res.status === 404 || res.status === 410 ? "not_found" : "http_error" };
  }
  if (!res.body) return { ok: false, reason: "empty" };
  const reader = res.body.getReader();
  let chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        chunks = []; // 읽던 것은 버린다 — 상한을 넘은 파일은 쓰지 않는다
        await reader.cancel().catch(() => {});
        return { ok: false, reason: "too_big" };
      }
      chunks.push(value);
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* 이미 풀렸으면 그만 */
    }
  }
  if (total === 0) return { ok: false, reason: "empty" };
  return { ok: true, buf: Buffer.concat(chunks, total) };
}

/** 전송 중 던져진 오류의 이유 한 마디(통로 탓 표식은 부르는 쪽이 먼저 가른다). */
function thrownReasonOf(e: unknown): AttachmentFileReason {
  const name = (e as { name?: unknown } | null)?.name;
  if (name === "TimeoutError") return "timeout";
  if (name === "AbortError") return "aborted";
  return "network";
}

export type FetchAttachmentTextsFn = (
  attachments: PolicyAttachmentRequest[],
  // opts 는 이제 필수다 — extractHwpx 를 반드시 넣어야 하기 때문(P3 회귀 방어).
  opts: FetchAttachmentTextsOptions,
) => Promise<AttachmentTextResult>;

export async function fetchAttachmentTexts(
  attachments: PolicyAttachmentRequest[],
  opts: FetchAttachmentTextsOptions,
): Promise<AttachmentTextResult> {
  const maxFiles = opts.maxFiles ?? DEFAULT_MAX_FILES;
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const totalCharCap = opts.totalCharCap ?? DEFAULT_CHAR_CAP;
  const fetchImpl = opts.fetch ?? fetch;
  // 조용한 기본값(() => "")을 없앴다 — 안 넘기면 타입 오류로 잡힌다(P3 회귀 방어).
  const extractHwpx: ExtractHwpx = opts.extractHwpx;
  const readArchives = opts.readArchives === true;

  const readFiles: string[] = [];
  const failedFiles: string[] = [];
  const skippedFiles: string[] = [];
  const previewOnlyFiles: string[] = [];
  const blocks: RenderBlock[] = [];
  // 파일마다 결과·이유. 표시 글자와 별개이고, 순서는 무시·중복(목록 차례) → 처리한 것(처리 차례) → 개수 상한으로 안 읽은 것.
  const files: AttachmentFileOutcome[] = [];
  // 경유 통로 탓으로 죽은 첨부 수. 하나라도 있으면 이번 결과는 사이트가 아니라 우리 통로 탓이다.
  let proxyFailures = 0;

  // 효과 kind 가 후보(pdf·hwp·hwpx·etc) 밖이면 조용히 뺀다. 저장 kind 가 etc 로 굳은 한글·zip 은 이름 꼬리를 떼고 다시 가린다.
  const candidates = asPolicyAttachments(attachments)
    .map((a) => ({ a, kind: effectiveAttachmentKind(a) }))
    .filter((x) => CANDIDATE_KINDS.has(x.kind) || (readArchives && x.kind === "zip"));
  // 사이트 공통 파일은 부르지 않고, 같은 요청이 앞에 있으면 한 번만 부른다(앞이 이긴다). 둘 다 개수 상한을 쓰지 않는다.
  const seenRequests = new Set<string>();
  const wanted: typeof candidates = [];
  for (const x of candidates) {
    const name = x.a.name || x.a.url;
    if (isSiteCommonAttachment(x.a.url)) {
      files.push({ name, result: "ignored" });
      continue;
    }
    const key = attachmentRequestKey(x.a);
    if (seenRequests.has(key)) {
      files.push({ name, result: "duplicate" });
      continue;
    }
    seenRequests.add(key);
    wanted.push(x);
  }
  // 공고문 쪽 이름(역할 0)을 먼저, 서식 쪽(2)을 나중에 → 같은 역할이면 형식 순 → 같으면 원래 차례(안정 정렬).
  // 첫 첨부가 대개 본 공고문이다.
  const ordered = wanted
    .map((x, i) => ({ ...x, role: attachmentNameRole(x.a.name), i }))
    .sort(
      (x, y) => x.role - y.role || (KIND_RANK[x.kind] ?? 9) - (KIND_RANK[y.kind] ?? 9) || x.i - y.i,
    );
  type Item = (typeof ordered)[number];
  // 읽은 수(maxReads)가 차거나 시도 수(maxReads + extra)가 차면 멈춘다. 기본(extra 0)은 앞에서부터 maxReads 개만 본다.
  const maxReads = Number.isNaN(maxFiles) ? 0 : Math.max(0, Math.floor(maxFiles));
  const extraRaw = opts.extraAttempts;
  const extra = typeof extraRaw === "number" && Number.isFinite(extraRaw) ? Math.max(0, Math.floor(extraRaw)) : 0;
  const maxTries = maxReads + extra;

  const failTrial = (
    name: string,
    reason: AttachmentFileReason,
    block: RenderBlock = noticeBlock(name, "fail", failBlock(name)),
  ): Trial => ({
    name,
    outcome: { name, result: "failed", reason },
    block,
    into: [failedFiles],
    complete: false,
    preview: false,
  });

  /** 받은 바이트를 읽어 확정 전 결과로 만든다. zip 항목도 같은 길을 지난다. */
  const fromBytes = async (name: string, buf: Buffer, declaredKind: ExtractableKind | null): Promise<Trial> => {
    const fail = (reason: AttachmentFileReason): Trial => failTrial(name, reason);
    try {
      // 첫 바이트 냄새를 이름/주소 kind 보다 먼저. cover.pdf 인데 실제는 OLE(hwp)면
      // pdf 파서가 미끼 글자를 남길 수 있다. declaredKind 가 etc 이고 냄새도 없으면 실패.
      const format = detectAttachmentFormat(buf);
      // 그림·HTML 오류 쪽은 뽑지 않는다 — 이름이 pdf 여도 선언 kind 로 다시 해 보지 않는다.
      if (format === "image" || format === "html") return fail(format);
      // 첫 시도: 속 형식으로 뽑거나(read), 뽑지 않고 이유만 남긴다(skip: 압축 묶음·옛 워드/파워포인트).
      // 못 알아본 바이트(null)는 선언 kind 로 뽑는다.
      const first = firstTryOf(format, buf);
      const primary: ReadKind | null = first === null ? declaredKind : "read" in first ? first.read : null;
      const skipReason = first !== null && "skip" in first ? first.skip : null;
      if (!primary && !skipReason) return fail("unknown_format");
      let usedKind: ReadKind | null = primary;
      let extracted: Extracted = primary
        ? await extractByKind(primary, buf, extractHwpx)
        : { text: "", incomplete: false, failReason: skipReason ?? "no_text" };
      // 비거나 파서가 던지면(뽑지 않은 실패 포함) primary 와 다른 declaredKind 로 한 번 더 뽑는다. 둘 다 못 읽으면 첫 시도의 이유를 남긴다.
      if (!extracted.text.trim() && declaredKind && declaredKind !== primary) {
        const second = await extractByKind(declaredKind, buf, extractHwpx);
        if (second.text.trim()) {
          usedKind = declaredKind;
          extracted = second;
        }
      }
      const body = extracted.text.trim();
      if (!body || !usedKind) return fail(extracted.failReason ?? "no_text");
      if (extracted.incomplete && opts.includeHwpPreview === false) {
        // 미리보기 글자는 빼고 미확인 표식만 남긴다. 정상 형제 첨부의 본문은 보존한다.
        return {
          name,
          outcome: { name, result: "skipped", reason: "preview_only", kind: usedKind },
          block: contentBlock(name, [{ kind: "unverified", text: skippedBlock(name) }]),
          into: [previewOnlyFiles, skippedFiles],
          complete: false,
          preview: true,
        };
      }
      // 미확인 표식은 본문 앞에 둔다. 출처를 조각으로 남겨 뒤 표식이 앞 본문을 밀면 앞 파일도 잘림으로 적는다.
      const pieces: TextPiece[] = extracted.incomplete
        ? [
            { kind: "unverified", text: skippedBlock(name) },
            { kind: "preview", text: body },
          ]
        : [{ kind: "body", text: body }];
      return {
        name,
        outcome: {
          name,
          result: "read",
          chars: body.length,
          kind: usedKind,
          ...(extracted.incomplete ? { reason: "preview_only" as const } : {}),
        },
        block: contentBlock(name, pieces),
        into: extracted.incomplete ? [readFiles, previewOnlyFiles, skippedFiles] : [readFiles],
        complete: !extracted.incomplete,
        preview: extracted.incomplete,
      };
    } catch {
      return fail("no_text");
    }
  };

  /**
   * 첨부 하나를 내려받아 읽는다(시도). 결과와 받은 바이트만 돌려주고 아직 확정하지 않는다.
   * 같은 문서 묶음은 구성원을 여럿 시도한 뒤 무엇을 남길지 정한다(`commit`).
   */
  const tryOne = async (
    a: PolicyAttachmentRequest,
    kind: PolicyAttachmentKind,
  ): Promise<{ trial: Trial; buf: Buffer | null }> => {
    const name = a.name || a.url;
    const url = safeAttachmentUrl(a.url);
    if (!url) {
      // 허용하지 않은 주소는 부르지 않는다. 존재는 남겨 사람이 원문을 확인하게 한다.
      return { trial: failTrial(name, "blocked_url", noticeBlock(name, "blocked", blockedBlock(name))), buf: null };
    }
    let got: DownloadResult;
    try {
      got = await downloadBytes(url, fetchImpl, timeoutMs, maxBytes, opts.signal, a);
    } catch (e) {
      // 경유 통로가 죽어서 못 물어본 것이면 따로 센다 — 사이트가 준 404 와 재시도 값어치가 다르다.
      const transport = isProxyTransportError(e);
      if (transport) proxyFailures += 1;
      return { trial: failTrial(name, transport ? "transport" : thrownReasonOf(e)), buf: null };
    }
    if (!got.ok) return { trial: failTrial(name, got.reason), buf: null };
    return { trial: await fromBytes(name, got.buf, isExtractable(kind) ? kind : null), buf: got.buf };
  };

  /** 시도한 값을 그대로 `files`·표시 블록·목록에 넣는다(확정). */
  const commit = (t: Trial): void => {
    files.push(t.outcome);
    blocks.push(t.block);
    for (const list of t.into) list.push(t.name);
  };

  /** 같은 문서 다른 형식 — 존재만 알린다. 못 읽은 첨부로 세지 않아 세 목록·미리보기 목록에는 넣지 않는다. */
  const commitVariant = (name: string): void => {
    files.push({ name, result: "duplicate", reason: "same_document" });
    blocks.push({ name, pieces: [{ kind: "variant", text: `[같은 문서 다른 형식: ${name}]` }] });
  };

  // 단위: 혼자면 [x], 같은 문서 묶음이면 읽기 좋은 형식 차례 구성원들. 묶음은 맨 앞 구성원 자리에서 한 번만 처리한다.
  // 이름(크기 꼬리를 뗀 확장자 앞부분)이 같은 항목이 둘 이상일 때만 묶고, `sameDocumentOnce` 가 꺼져 있으면 모두 혼자다.
  const units: Item[][] = [];
  if (opts.sameDocumentOnce) {
    const groups = new Map<string, Array<{ item: Item; rank: number }>>();
    const keyed = ordered.map((item) => {
      const k = sameDocumentKey(item.a.name);
      if (k) {
        const group = groups.get(k.key);
        if (group) group.push({ item, rank: k.rank });
        else groups.set(k.key, [{ item, rank: k.rank }]);
      }
      return k;
    });
    const placed = new Set<string>();
    ordered.forEach((item, idx) => {
      const k = keyed[idx];
      const group = k ? groups.get(k.key) : undefined;
      if (!k || !group || group.length < 2) {
        units.push([item]);
        return;
      }
      if (placed.has(k.key)) return;
      placed.add(k.key);
      // 안정 정렬 — 차례(rank)가 같으면 ordered 차례를 지킨다.
      units.push([...group].sort((x, y) => x.rank - y.rank).map((x) => x.item));
    });
  } else {
    for (const item of ordered) units.push([item]);
  }

  let reads = 0;
  let tries = 0;
  const readDocKeys = new Set<string>();
  // 개수 상한에 걸려 시도하지 못한 첨부(단위 차례, 묶음 안은 rank 차례).
  const tail: string[] = [];
  const nameOf = (m: Item): string => m.a.name || m.a.url;
  const commitFailed = (name: string, reason: AttachmentFileReason): void => commit(failTrial(name, reason));

  /** 최상위 압축 묶음만 한 번 연다. 첫 풀기는 내려받기가 쓴 시도 하나로 친다. */
  const openArchive = async (zipName: string, buf: Buffer, trial: Trial): Promise<void> => {
    const list = listArchiveEntries(buf);
    if (list === null) {
      commit(trial);
      return;
    }
    if (list.length === 0) {
      commitFailed(zipName, "no_text");
      return;
    }
    const sorted = list
      .map((e, i) => ({ e, i, role: attachmentNameRole(e.base), rank: KIND_RANK[attachmentKindOf(e.base)] ?? 9 }))
      .sort((x, y) => x.role - y.role || x.rank - y.rank || x.i - y.i);
    let freeLeft = true;
    for (const { e } of sorted.slice(0, MAX_ARCHIVE_SHOWN)) {
      const name = `${zipName} › ${e.path}`;
      const key = opts.sameDocumentOnce ? sameDocumentKey(e.base)?.key : undefined;
      if (key && readDocKeys.has(key)) {
        commitVariant(name);
        continue;
      }
      const nameKind = archiveEntryNameKind(e.base);
      if (nameKind === "image") { commitFailed(name, "image"); continue; }
      if (nameKind === "archive") { commitFailed(name, "nested_archive"); continue; }
      if (nameKind === "other") { commitFailed(name, "unknown_format"); continue; }
      if (e.encrypted) { commitFailed(name, "protected"); continue; }
      if (e.method !== 0 && e.method !== 8) { commitFailed(name, "unsupported"); continue; }
      if (e.size > maxBytes) { commitFailed(name, "too_big"); continue; }
      if (!(reads < maxReads && (freeLeft || tries < maxTries))) {
        tail.push(name);
        continue;
      }
      if (freeLeft) freeLeft = false;
      else tries += 1;
      const got = e.read(maxBytes);
      if (!got.ok) {
        commitFailed(name, got.reason === "broken" ? "no_text" : "too_big");
        continue;
      }
      const kind = attachmentKindOf(e.base);
      const t = await fromBytes(name, got.buf, isExtractable(kind) ? kind : null);
      if (t.outcome.result === "failed" && t.outcome.reason === "archive") t.outcome.reason = "nested_archive";
      commit(t);
      if (t.outcome.result === "read") reads += 1;
      if (key && t.complete) readDocKeys.add(key);
    }
    if (sorted.length > MAX_ARCHIVE_SHOWN) tail.push(`${zipName} › 외 ${sorted.length - MAX_ARCHIVE_SHOWN}개`);
  };

  for (const unit of units) {
    const key = opts.sameDocumentOnce ? sameDocumentKey(unit[0].a.name)?.key : undefined;
    if (key && readDocKeys.has(key)) {
      for (const m of unit) commitVariant(nameOf(m));
      continue;
    }
    // 읽은 수(maxReads)가 차거나 시도 수(maxReads + extra)가 차면 멈춘다 — 그 단위부터는 전부 개수 상한이다.
    if (!(reads < maxReads && tries < maxTries)) {
      tail.push(...unit.map(nameOf));
      continue;
    }
    if (unit.length === 1) {
      tries += 1;
      const { trial: t, buf } = await tryOne(unit[0].a, unit[0].kind);
      if (readArchives && buf && t.outcome.result === "failed" && t.outcome.reason === "archive") {
        await openArchive(nameOf(unit[0]), buf, t);
        continue;
      }
      commit(t);
      if (t.outcome.result === "read") reads += 1;
      if (key && t.complete) readDocKeys.add(key);
      continue;
    }
    // 묶음: 읽기 좋은 형식부터 시도 수가 남는 동안 하나씩, 온전히 읽힌 구성원이 나오면 멈춘다. 묶음 안에서는 읽은 수 상한을 보지 않는다.
    const trials: Array<{ m: Item; t: Trial }> = [];
    let k = 0;
    while (k < unit.length && tries < maxTries) {
      const m = unit[k];
      k += 1;
      tries += 1;
      const { trial: t } = await tryOne(m.a, m.kind);
      trials.push({ m, t });
      if (t.complete) break;
    }
    const won = trials.find((x) => x.t.complete);
    if (won) {
      // 온전히 읽힌 하나만 남기고(읽은 수 1), 나머지는 시도했든 안 했든 같은 문서 다른 형식이다. 버린 시도의 미리보기·표식은 남기지 않는다.
      commit(won.t);
      reads += 1;
      if (key) readDocKeys.add(key);
      for (const m of unit) if (m !== won.m) commitVariant(nameOf(m));
      continue;
    }
    // 온전한 본문이 없으면 첫 미리보기를 예전처럼 남기고, 다른 미리보기는 같은 문서 다른 형식으로, 실패는 실패대로 둔다.
    const lead = trials.find((x) => x.t.preview);
    if (lead) {
      commit(lead.t);
      if (lead.t.outcome.result === "read") reads += 1;
    }
    for (const x of trials) {
      if (x === lead) continue;
      if (x.t.preview) commitVariant(nameOf(x.m));
      else commit(x.t);
    }
    tail.push(...unit.slice(k).map(nameOf));
  }

  // 상한에 걸려 못 읽은 첨부도 끝에 이름을 남긴다 — 없는 셈 치면 AI 가 「원문에 없다」고 단정한다.
  for (const name of tail) {
    skippedFiles.push(name);
    blocks.push(noticeBlock(name, "skipped", skippedBlock(name)));
    files.push({ name, result: "skipped", reason: "over_limit" });
  }

  const rendered = renderAttachmentBlocks(blocks, totalCharCap);
  for (const name of rendered.truncatedNames) {
    if (!skippedFiles.includes(name)) skippedFiles.push(name);
  }
  // 글자 상한에 잘린 읽은 파일은 이유를 「잘림」으로 — 미리보기보다 우선한다. 다른 결과는 그대로 둔다.
  const truncated = new Set(rendered.truncatedNames);
  for (const f of files) {
    if (f.result === "read" && truncated.has(f.name)) f.reason = "truncated";
  }
  // 같은 문서 다른 형식으로 읽지 않은 첨부 — files 차례대로.
  const sameDocumentFiles = files.filter((f) => f.reason === "same_document").map((f) => f.name);
  // 본문 글자 수는 걸러낸 뒤의 실제 본문 조각 합. 완성 문자열을 정규식으로 추측하지 않는다.
  let bodyTextChars = 0;
  for (const part of rendered.retainedBodies) bodyTextChars += stripUnstorableChars(part).length;

  // ★마지막으로 한 번 더 손본다(2026-08-25 적대적 리뷰 「중요 1」 ②).
  // 위의 자르기(`slice`)는 걸러내기 **다음**에 일어난다 — 이모지 한가운데가 잘리면
  // 거기서 반쪽 글자가 생겨 저장이 거부된다. 나가는 글자는 반드시 이 길목을 지난다.
  return {
    text: stripUnstorableChars(rendered.text),
    readFiles,
    failedFiles,
    skippedFiles,
    ...(previewOnlyFiles.length > 0 ? { previewOnlyFiles } : {}),
    ...(sameDocumentFiles.length > 0 ? { sameDocumentFiles } : {}),
    // ★「전부」가 아니라 **하나라도**다(2026-09-06 적대 리뷰): a.pdf 가 사이트 404, b.pdf 가
    //  통로 죽음이면 b 는 물어보지도 못한 것인데 옛 규칙은 「사이트 탓」으로 뭉갰다.
    //  도장이 무기한 유예가 아니라 1시간짜리로 바뀌었으니 좁힐 이유가 없다.
    proxyFailed: proxyFailures > 0,
    ...(opts.includeHwpPreview === false ? { bodyTextChars } : {}),
    files,
  };
}
