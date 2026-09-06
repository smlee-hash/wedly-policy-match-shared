// 공고 첨부(pdf·hwpx·hwp)에서 글자를 뽑아 구조화 입력으로 쓴다.
// 네트워크는 주입 가능한 fetch — 시험은 가짜, 운영만 실호출.
import { parse as parseCfb, find as findCfb } from "cfb";
import { getDocumentProxy, extractText } from "unpdf";
import {
  ATTACHMENT_KINDS,
  attachmentKindOf,
  type PolicyAttachment,
  type PolicyAttachmentKind,
} from "./types";
import { BOARD_SOURCES } from "./board/source-list";
import type { PolicyAttachmentRequest } from "./board/types";
import { allowedHostsOf } from "./board/engine";
import { isProxyTransportError } from "./board/proxy";

export const EXTRACTABLE_KINDS = ["pdf", "hwp", "hwpx"] as const;
export type ExtractableKind = (typeof EXTRACTABLE_KINDS)[number];

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
/** 전문을 뽑을 수 있는 형식(pdf·hwpx)을 먼저 읽는다 — hwp 는 미리보기 1,000자뿐이라 뒤로. etc 는 맨 뒤. */
const KIND_RANK: Record<string, number> = { pdf: 0, hwpx: 0, hwp: 1, etc: 2 };

/** POST 첨부에 수집기가 머리글을 안 적었을 때 붙는 기본 형식(브라우저 form 제출과 같다). */
export const FORM_CONTENT_TYPE = "application/x-www-form-urlencoded; charset=UTF-8";

const PDF_SIG = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
const OLE_SIG = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const ZIP_SIG = [0x50, 0x4b, 0x03, 0x04];

export type AttachmentTextResult = {
  text: string;
  readFiles: string[];
  failedFiles: string[];
  /** 개수 상한에 걸려 아예 안 읽은 첨부 — 존재만 알린다. */
  skippedFiles: string[];
  /**
   * 요청까지 간 첨부 중 **하나라도 경유 통로 탓으로** 실패했다
   * (프록시 호스트에 못 닿음·CONNECT 거부·프록시가 만든 401·403·500).
   * 사이트가 준 404·500 과 구분하려고 둔다 — 부르는 쪽이 7일 도장 대신 **1시간 짧은 도장**을 찍어
   * 프록시가 살아난 뒤 곧 다시 보게 한다. 경유를 안 쓰는 길에서는 늘 거짓이다.
   */
  proxyFailed?: boolean;
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
 * 의 `extractHwpx`, adm-zip 로 `Contents/section*.xml` 을 푼다). pdf·hwp 는 이 보관함이 이미
 * `unpdf`·`cfb` 로 직접 뽑지만, hwpx 추출기는 adm-zip 을 끌고 와 여기 두지 않고 주입으로 받는다.
 * 안 넘기면 hwpx 는 빈 글로 취급한다(앱은 반드시 넣어 준다).
 */
export type ExtractHwpx = (buf: Buffer) => string | Promise<string>;

export type FetchAttachmentTextsOptions = {
  maxFiles?: number;
  maxBytes?: number;
  timeoutMs?: number;
  totalCharCap?: number;
  fetch?: AttachmentFetch;
  /** hwpx 글자 추출기(앱 주입). 위 `ExtractHwpx` 주석 참조. */
  extractHwpx?: ExtractHwpx;
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
 */
export function asPolicyAttachments(raw: unknown): PolicyAttachmentRequest[] {
  if (!Array.isArray(raw)) return [];
  const out: PolicyAttachmentRequest[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const name = typeof o.name === "string" ? o.name.trim() : "";
    const url = typeof o.url === "string" ? o.url.trim() : "";
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

async function extractByKind(
  kind: ExtractableKind,
  buf: Buffer,
  extractHwpx: ExtractHwpx,
): Promise<string> {
  const raw =
    kind === "pdf"
      ? await extractPdfBytes(Uint8Array.from(buf))
      : kind === "hwpx"
        ? await extractHwpx(buf)
        : await extractHwpPreview(buf);
  return stripUnstorableChars(raw);
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

function readBlock(name: string, body: string): string {
  return `[첨부: ${name}]\n${body}`;
}

/**
 * 글자 상한에 걸려 **뒷부분이 잘렸다**는 표식.
 *
 * 왜 필요한가(2026-08-25 적대적 리뷰 「치명 2」): 예전엔 상한을 넘으면 아무 말 없이 잘라 버렸다.
 * 그러면 12,000자 PDF 의 9,000자 지점에 있던 「지원 제외 대상」이 통째로 사라지는데도
 * 그 파일은 「읽은 파일」로 기록돼, AI 가 앞부분 조건 몇 개만 보고 **「가능」**을 내놓았다.
 * 표식을 남기면 기존 배선이 그대로 「첨부 원문 확인 필요」로 받아 「확인 필요」에 묶어 준다.
 */
function truncatedBlock(name: string): string {
  return `[첨부 잘림: ${name}]`;
}

function joinBlocks(out: string, block: string): string {
  return out ? `${out}\n\n${block}` : block;
}

function appendCapped(out: string, block: string, cap: number): string {
  if (!block) return out;
  const next = joinBlocks(out, block);
  return next.length <= cap ? next : next.slice(0, cap);
}

/**
 * 읽어 온 본문을 붙이되, 상한에 걸려 잘리면 잘림 표식을 **자리를 비워 두고** 끝에 남긴다.
 * 표식까지 잘려 나가면 아무도 잘린 줄 모르게 되므로 표식 길이를 먼저 확보한다.
 */
function appendReadBlock(
  out: string,
  name: string,
  body: string,
  cap: number,
): { text: string; truncated: boolean } {
  const next = joinBlocks(out, readBlock(name, body));
  if (next.length <= cap) return { text: next, truncated: false };
  const mark = truncatedBlock(name);
  const room = Math.max(0, cap - mark.length - 2);
  return { text: `${next.slice(0, room)}\n\n${mark}`, truncated: true };
}

/**
 * 응답을 통째로 메모리에 올리지 않고 흘려 읽으며 상한을 넘는 순간 끊는다.
 * content-length 는 참고도 하지 않는다 — 거짓으로 적어 보내면 그대로 속아 큰 본문을 다 받게 된다.
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
): Promise<Buffer | null> {
  // 리다이렉트는 손으로 따라간다 — 자동 추적은 허용 호스트 검사를 통과한 「뒤에」
  // 내부망 주소로 302 시켜 검사를 우회하는 길이 된다(적대 리뷰 치명 지적). 매 홉을 다시 검사한다.
  let target: string | null = url;
  let res: Response | null = null;
  // 한 번의 내려받기 = 한 번의 시간 상한. 홉마다 timeout 을 새로 만들면 리다이렉트 3번에 상한이 4배가 된다.
  const own = AbortSignal.timeout(timeoutMs);
  const signal = outer ? AbortSignal.any([own, outer]) : own;
  for (let hop = 0; hop <= 3; hop++) {
    if (!target) return null;
    // ★POST 는 **첫 요청에만** 싣는다. 302 를 따라갈 때 본문을 다시 보내면 같은 내려받기가 두 번
    //  일어나거나(1회용 열쇠 소모) 엉뚱한 주소로 본문이 새 나간다 — 브라우저도 303·302 뒤에는 GET 이다.
    const init: RequestInit = { signal, redirect: "manual" };
    if (hop === 0 && req?.method === "POST") {
      init.method = "POST";
      if (req.body !== undefined) init.body = req.body;
      // 게시판들이 쓰는 것은 전부 form 제출이다 — 수집기가 따로 안 적으면 그 형식을 기본으로 붙인다.
      const given = req.headers ?? {};
      const hasType = Object.keys(given).some((k) => k.toLowerCase() === "content-type");
      init.headers = hasType ? { ...given } : { ...given, "Content-Type": FORM_CONTENT_TYPE };
    } else if (hop === 0 && req?.headers) {
      init.headers = { ...req.headers };
    }
    const r = await fetchImpl(target, init);
    if (r.status >= 300 && r.status < 400) {
      const loc = r.headers.get("location");
      await r.body?.cancel().catch(() => {});
      if (!loc || hop === 3) return null;
      let next: string;
      try {
        next = new URL(loc, target).toString();
      } catch {
        return null;
      }
      target = safeAttachmentUrl(next);
      continue;
    }
    res = r;
    break;
  }
  if (!res) return null;
  if (!res.ok) {
    await res.body?.cancel().catch(() => {});
    return null;
  }
  if (!res.body) return null;
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
        return null;
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
  return Buffer.concat(chunks, total);
}

export type FetchAttachmentTextsFn = (
  attachments: PolicyAttachmentRequest[],
  opts?: FetchAttachmentTextsOptions,
) => Promise<AttachmentTextResult>;

export async function fetchAttachmentTexts(
  attachments: PolicyAttachmentRequest[],
  opts: FetchAttachmentTextsOptions = {},
): Promise<AttachmentTextResult> {
  const maxFiles = opts.maxFiles ?? DEFAULT_MAX_FILES;
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const totalCharCap = opts.totalCharCap ?? DEFAULT_CHAR_CAP;
  const fetchImpl = opts.fetch ?? fetch;
  const extractHwpx: ExtractHwpx = opts.extractHwpx ?? (() => "");

  const list = asPolicyAttachments(attachments).filter((a) => CANDIDATE_KINDS.has(a.kind));
  // 같은 등급 안에서는 원래 차례를 지킨다(안정 정렬) — 첫 첨부가 대개 본 공고문이다.
  const ordered = list
    .map((a, i) => ({ a, i }))
    .sort((x, y) => (KIND_RANK[x.a.kind] ?? 9) - (KIND_RANK[y.a.kind] ?? 9) || x.i - y.i)
    .map((x) => x.a);
  const take = Math.max(0, maxFiles);
  const targets = ordered.slice(0, take);
  const skipped = ordered.slice(take);

  const readFiles: string[] = [];
  const failedFiles: string[] = [];
  const skippedFiles: string[] = [];
  let text = "";
  // 경유 통로 탓으로 죽은 첨부 수. 하나라도 있으면 이번 결과는 사이트가 아니라 우리 통로 탓이다.
  let proxyFailures = 0;

  for (const a of targets) {
    const name = a.name || a.url;
    const url = safeAttachmentUrl(a.url);
    if (!url) {
      // 허용하지 않은 주소는 부르지 않는다. 존재는 남겨 사람이 원문을 확인하게 한다.
      failedFiles.push(name);
      text = appendCapped(text, blockedBlock(name), totalCharCap);
      continue;
    }
    try {
      const buf = await downloadBytes(url, fetchImpl, timeoutMs, maxBytes, opts.signal, a);
      if (!buf) {
        failedFiles.push(name);
        text = appendCapped(text, failBlock(name), totalCharCap);
        continue;
      }
      // 첫 바이트 냄새를 이름/주소 kind 보다 먼저. cover.pdf 인데 실제는 OLE(hwp)면
      // pdf 파서가 미끼 글자를 남길 수 있다. declaredKind 가 etc 이고 냄새도 없으면 실패.
      const declaredKind: ExtractableKind | null = isExtractable(a.kind) ? a.kind : null;
      const primary = sniffAttachmentKind(buf) ?? declaredKind;
      if (!primary) {
        failedFiles.push(name);
        text = appendCapped(text, failBlock(name), totalCharCap);
        continue;
      }
      let body = "";
      try {
        body = (await extractByKind(primary, buf, extractHwpx)).trim();
      } catch {
        body = "";
      }
      // 비거나 파서가 던지면 primary 와 다른 declaredKind 로 한 번 더 뽑는다.
      if (!body && declaredKind && declaredKind !== primary) {
        try {
          body = (await extractByKind(declaredKind, buf, extractHwpx)).trim();
        } catch {
          body = "";
        }
      }
      if (!body) {
        failedFiles.push(name);
        text = appendCapped(text, failBlock(name), totalCharCap);
        continue;
      }
      readFiles.push(name);
      const put = appendReadBlock(text, name, body, totalCharCap);
      text = put.text;
      // 뒷부분이 잘렸으면 「안 읽은 첨부」와 같은 무게로 남긴다 — 조건이 잘린 꼬리에 있을 수 있다.
      if (put.truncated) skippedFiles.push(name);
    } catch (e) {
      // 경유 통로가 죽어서 못 물어본 것이면 따로 센다 — 사이트가 준 404 와 재시도 값어치가 다르다.
      if (isProxyTransportError(e)) proxyFailures += 1;
      failedFiles.push(name);
      text = appendCapped(text, failBlock(name), totalCharCap);
    }
  }

  // 상한에 걸려 못 읽은 첨부도 끝에 이름을 남긴다 — 없는 셈 치면 AI 가 「원문에 없다」고 단정한다.
  for (const a of skipped) {
    const name = a.name || a.url;
    skippedFiles.push(name);
    text = appendCapped(text, skippedBlock(name), totalCharCap);
  }

  // ★마지막으로 한 번 더 손본다(2026-08-25 적대적 리뷰 「중요 1」 ②).
  // 위의 자르기(`slice`)는 걸러내기 **다음**에 일어난다 — 이모지 한가운데가 잘리면
  // 거기서 반쪽 글자가 생겨 저장이 거부된다. 나가는 글자는 반드시 이 길목을 지난다.
  return {
    text: stripUnstorableChars(text),
    readFiles,
    failedFiles,
    skippedFiles,
    // ★「전부」가 아니라 **하나라도**다(2026-09-06 적대 리뷰): a.pdf 가 사이트 404, b.pdf 가
    //  통로 죽음이면 b 는 물어보지도 못한 것인데 옛 규칙은 「사이트 탓」으로 뭉갰다.
    //  도장이 무기한 유예가 아니라 1시간짜리로 바뀌었으니 좁힐 이유가 없다.
    proxyFailed: proxyFailures > 0,
  };
}
