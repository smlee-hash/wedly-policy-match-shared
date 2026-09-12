import { attachmentKindOf } from "../../../engine/types";
import { decodeHtmlEntities, parseHtml, type HTMLElement } from "../html";
import type { BoardConfig, BoardFetchInit, BoardRow, PolicyAttachmentRequest } from "../types";

/**
 * 해양수산부 공지사항. 목록은 등록일만 주므로 개시형(`YYYY-MM-DD ~`)으로 넘긴다.
 * 상세 첨부가 HML 이면 짧은 HTML 본문만으로 끝내지 않고 같은 fetchText 로 공고문을 읽는다.
 *
 * 엔진(루트 통합): `fillBoardDetail` 은 `detailFetch` 반환값을 harvest/pageHtml 로 쓰고
 * 원문 상세를 따로 넘기지 않는다. 그래서 반환 HTML 에 `.attach-list` 를 남긴다.
 * `fetchBoardDetail` 은 `detailFetch` 를 타지 않는다. 등록은 `BOARD_SOURCES` 가 맡는다.
 * 실측 HML(67960)은 205,080바이트로 기존 상세 응답 상한 안에서 읽는다.
 */
const HOST = "www.mof.go.kr";
const BASE = `https://${HOST}`;
const LIST_PATH = "/doc/ko/selectDocList.do";
const DETAIL_PATH = "/doc/ko/selectDoc.do";
const DOWNLOAD_PATH = "/jfile/readDownloadFile.do";
const MENU_SEQ = "375";
const BBS_SEQ = "9";
const MAX_HML = 2;
const DOC_SEQ = /fn_selectDoc\(\s*'(\d+)'\s*\)/;
const TITLE_PREFIX = /^\s*\[게시글 바로가기\]\s*/;
const DROP =
  /(?:직원|공무원|계약직|기간제)\s*채용|채용\s*공고|공개\s*초빙|임원\s*모집|상임이사\s*(?:\([^)]*\))?\s*모집|고객만족도|제재처분|노사협의회|지형도면(?:\s*변경)?\s*고시|결과\s*발표|합격자\s*(?:발표|명단)/;

export function isMofDropTitle(title: string): boolean {
  return DROP.test(title);
}

function isRealDate(y: number, m: number, d: number): boolean {
  const probe = new Date(Date.UTC(y, m - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
}

/** `YYYY.MM.DD`·끝점. 달력에 없으면 "". */
export function mofYmd(text: string): string {
  const m = text.replace(/\s+/g, " ").trim().match(/^(20\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})\.?$/);
  if (!m) return "";
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!isRealDate(y, mo, d)) return "";
  return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
}

export function mofDetailUrl(docSeq: string): string {
  return `${BASE}${DETAIL_PATH}?docSeq=${docSeq}&menuSeq=${MENU_SEQ}&bbsSeq=${BBS_SEQ}`;
}

function docSeqOf(detailUrl: string): string {
  try {
    return new URL(detailUrl).searchParams.get("docSeq") ?? "";
  } catch {
    return "";
  }
}

function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

function tagOf(el: { tagName?: string }): string {
  return (el.tagName ?? "").toUpperCase();
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function attachmentNameOf(a: HTMLElement): string {
  const blind = (a.querySelector(".blind")?.text ?? "").replace(/\s+/g, " ").trim();
  let name = (a.text ?? "").replace(/\s+/g, " ").trim();
  if (blind) name = name.replace(blind, "").trim();
  return name.replace(/^첨부파일\s*/, "").trim();
}

function isHmlName(name: string): boolean {
  return /\.hml(?:\s|$)/i.test(name) || /\.hml$/i.test(name.trim());
}

/**
 * 공식 호스트·경로·글번호가 맞는 내려받기만 허용한다. 바깥 주소는 null(호출하지 않음).
 */
export function safeMofDownloadUrl(href: string, docSeq: string): string | null {
  const raw = decodeHtmlEntities(href).trim();
  if (!raw || !docSeq || /^\s*(?:javascript:|#)/i.test(raw)) return null;
  let u: URL;
  try {
    u = new URL(raw, `${BASE}/`);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.host !== HOST || u.pathname !== DOWNLOAD_PATH) return null;
  if (u.searchParams.get("fileType") !== "MOF_ARTICLE") return null;
  if (u.searchParams.get("fileTypeSeq") !== docSeq) return null;
  const fileNum = u.searchParams.get("fileNum") ?? "";
  if (!/^\d+$/.test(fileNum)) return null;
  return `${BASE}${DOWNLOAD_PATH}?fileType=MOF_ARTICLE&fileTypeSeq=${docSeq}&fileNum=${fileNum}`;
}

function hwpmlOf(root: HTMLElement): HTMLElement | null {
  if (tagOf(root) === "HWPML") return root;
  return root.querySelector("HWPML, hwpml");
}

function closestP(el: HTMLElement): HTMLElement | null {
  let n = el.parentNode as HTMLElement | null;
  while (n) {
    if (tagOf(n) === "P") return n;
    n = n.parentNode as HTMLElement | null;
  }
  return null;
}

/** BODY 의 CHAR 를 문단 순으로 HTML 이스케이프. HEAD·BINDATA 는 버린다. 실패하면 throw. */
export function parseMofHmlToHtml(hml: string): string {
  const xml = stripBom(hml);
  if (!/<HWPML\b[^>]*>[\s\S]*<\/HWPML>/i.test(xml)) {
    throw new Error("해양수산부 공고문(HML)이 아닙니다");
  }
  // HTML 파서는 HML의 HEAD 안에 든 문단·스타일 태그를 HTML 머리말처럼
  // 보정하며 뒤 BODY까지 삼킬 수 있다. 원본 XML에서 본문 경계를 먼저 분리한다.
  const bodyXml = xml.match(/<BODY\b[^>]*>([\s\S]*?)<\/BODY>/i)?.[1];
  if (bodyXml === undefined) throw new Error("해양수산부 공고문(HML) 본문(BODY)이 없습니다");
  const body = parseHtml(`<div>${bodyXml}</div>`);
  for (const el of body.querySelectorAll("HEAD, head, BINDATA, bindata")) el.remove();
  const paras: string[] = [];
  let buf = "";
  let prev: HTMLElement | null | undefined;
  for (const ch of body.querySelectorAll("CHAR, char")) {
    const p = closestP(ch);
    if (prev !== undefined && p !== prev) {
      if (buf.trim()) paras.push(buf);
      buf = "";
    }
    buf += ch.text;
    prev = p;
  }
  if (buf.trim()) paras.push(buf);
  if (!paras.length) throw new Error("해양수산부 공고문(HML) 글자를 꺼내지 못했습니다");
  return paras.map((p) => `<p>${escapeHtml(p)}</p>`).join("");
}

function parseMofRows(html: string, filtered: boolean): BoardRow[] {
  const out: BoardRow[] = [];
  const seen = new Set<string>();
  for (const tr of parseHtml(html).querySelectorAll("table.bod-table-list tbody tr")) {
    const a = tr.querySelector("td.tit a.link-t");
    const call = `${a?.getAttribute("onclick") ?? ""} ${a?.getAttribute("href") ?? ""}`;
    const id = call.match(DOC_SEQ)?.[1] ?? "";
    if (!id || seen.has(id)) continue;
    const raw = ((a?.getAttribute("title") ?? "") || (a?.text ?? "")).replace(/\s+/g, " ").trim();
    const title = raw.replace(TITLE_PREFIX, "").trim();
    if (!title) continue;
    if (filtered && isMofDropTitle(title)) continue;
    seen.add(id);
    const ymd = mofYmd((tr.querySelector("td.t-date")?.text ?? "").replace(/\s+/g, " ").trim());
    out.push({
      title,
      detailUrl: mofDetailUrl(id),
      dateText: ymd ? `${ymd} ~` : "",
      category: (tr.querySelector("td.ts")?.text ?? "").replace(/\s+/g, " ").trim(),
      agency: "해양수산부",
    });
  }
  return out;
}

/** 거르개 없는 제목·번호·날짜 행. 동시 엔진 원문 검증용. */
export function parseMofValidationList(html: string): BoardRow[] {
  return parseMofRows(html, false);
}

export function parseMofList(html: string): BoardRow[] {
  return parseMofRows(html, true);
}

export function mofDetailAttachments(args: {
  html: string;
  pageHtml: string;
  detailUrl: string;
  baseUrl: string;
}): PolicyAttachmentRequest[] {
  const docSeq = docSeqOf(args.detailUrl);
  const out: PolicyAttachmentRequest[] = [];
  const seen = new Set<string>();
  for (const a of parseHtml(args.pageHtml || args.html).querySelectorAll(".attach-list a.down-i-btn")) {
    const url = safeMofDownloadUrl((a.getAttribute("href") ?? "").trim(), docSeq);
    if (!url || seen.has(url)) continue;
    const name = attachmentNameOf(a);
    if (!name) continue;
    seen.add(url);
    out.push({ name, url, kind: attachmentKindOf(name, url) });
  }
  return out;
}

export async function fetchMofDetail(
  detailUrl: string,
  fetchText: (url: string, init?: BoardFetchInit) => Promise<string>,
): Promise<string> {
  const html = await fetchText(detailUrl);
  const root = parseHtml(html);
  const view = root.querySelector(".bod-detail-view");
  const attach = root.querySelector(".attach-list");
  const attachHtml = attach?.outerHTML ?? "";
  const originalView = view?.outerHTML ?? '<div class="bod-detail-view"></div>';
  const docSeq = docSeqOf(detailUrl);
  const hmlUrls: string[] = [];
  for (const a of (attach ?? root).querySelectorAll("a.down-i-btn")) {
    if (!isHmlName(attachmentNameOf(a))) continue;
    const url = safeMofDownloadUrl((a.getAttribute("href") ?? "").trim(), docSeq);
    if (!url || hmlUrls.includes(url)) continue;
    hmlUrls.push(url);
    if (hmlUrls.length >= MAX_HML) break;
  }
  if (!hmlUrls.length) return `${originalView}${attachHtml}`;
  const parts: string[] = [];
  for (const url of hmlUrls) {
    const hml = await fetchText(url);
    parts.push(parseMofHmlToHtml(hml));
  }
  return `<div class="bod-detail-view">${parts.join("")}</div>${attachHtml}`;
}

export const mofConfig: BoardConfig = {
  id: "mof",
  label: "해양수산부",
  agency: "해양수산부",
  region: "전국",
  baseUrl: `${BASE}/`,
  charset: "utf-8",
  list: {
    url: (p) => `${BASE}${LIST_PATH}?menuSeq=${MENU_SEQ}&bbsSeq=${BBS_SEQ}&paginationInfo.currentPageNo=${p}`,
    maxPages: 5,
    rowSelector: "table.bod-table-list tbody tr",
    fields: {
      title: { selector: "td.tit a.link-t", attr: "title" },
      detailUrl: { selector: "td.tit a.link-t", attr: "onclick", regex: "fn_selectDoc\\(\\s*'(\\d+)'\\s*\\)" },
      date: { selector: "td.t-date" },
    },
  },
  customParse: parseMofList,
  validationParse: parseMofValidationList,
  skipHeuristic: true,
  expectMinRows: 2,
  detailContentSelector: ".bod-detail-view",
  attachmentsScopeSelector: ".attach-list",
  detailAttachments: mofDetailAttachments,
  detailFetch: fetchMofDetail,
};
