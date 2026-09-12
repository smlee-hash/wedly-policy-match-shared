import { attachmentKindOf } from "../../../engine/types";
import { absolutize, decodeHtmlEntities, parseHtml } from "../html";
import type { BoardConfig, BoardRow, PolicyAttachmentRequest } from "../types";

/**
 * 성남산업진흥원 전체사업공고.
 *
 * 왜 연결했나(2026-09-02 실측): 최신 5건을 기업마당·보조금24 포함 우리 DB 와 제목으로
 * 대조했더니 진짜 겹침은 0건(오탐 1) — 통합 수집원으로는 안 들어온다.
 *
 * 구조: `table.board-list > tbody > tr` 10건. **접수기간을 목록에서 준다**
 * (`td.term` = `2026-08-31~2026-09-17`) — 등록일만 주는 게시판보다 마감 정리가 정확하다.
 * 쪽넘김은 `?page=n` GET. `pageIndex`·`pageNo`·`currentPage` 는 안 먹는다(실측).
 * 총 3,627건. 마감일을 주므로 깊이 파도 끝난 공고가 「모집중」으로 안 섞인다 — `maxPages: 10`.
 *
 * ⚠️ 상세 링크가 다른 호스트다 — `https://portal.snip.or.kr:8443/portal/snip/...`.
 *    `allowedHosts` 에 포트를 포함한 `portal.snip.or.kr:8443` 을 반드시 적는다
 *    (`allowedHostsOf` 는 `new URL().host` 로 대조하므로 포트가 열쇠에 들어간다).
 *
 * 목록에 저장되는 주소는 사업신청 껍데기(`application.page`)다. 익명으로 열리는 본문은
 * `/user/snip/busin/businDetail.face`(실측 HTTP 200). 껍데기·비밀번호 iframe 은 요청하지 않는다.
 */
const BASE = "https://www.snip.or.kr";
const LIST = "/SNIP/contents/Business1.do";
const YMD = /(20\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})/g;

const PORTAL_ORIGIN = "https://portal.snip.or.kr:8443";
const STORED_DETAIL_PATH = "/portal/snip/MainMenu/businessManagement/application.page";
const OFFICIAL_DETAIL_PATH = "/user/snip/busin/businDetail.face";
/** 사이트 원문 철자가 attatch 이다. */
const FILE_DOWNLOAD_PATH = "/user/snip/attatchFileDownload.face";
const IMAGE_PATH = /^\/gwCustSnip\/.+\.(?:png|jpe?g)$/i;
const PORTLET = /^20\d{2}-\d+$/;
const PORTLET2 = /^[1-9]\d*$/;
const HEX = /^[0-9A-Fa-f]{32,128}$/;
const FILE_DOWN_CALL = /\bfn_fileDown\(\s*(['"])([0-9A-Fa-f]{32,128})\1\s*\)/;
const PLACEHOLDER = /사업\s*공고문\s*내용을\s*입력합니다\.?/g;
const DETAIL_BODY_ID = "snip-detail-body";

/**
 * 지원사업이 아닌 글. **버릴 것만** 지정한다 — 허용목록(KEEP)은 「~ 안내」형 지원사업을 죽인다(hsbiz).
 * 실측 1·2쪽 20건은 거의 전부 지원사업. 버린 건 「강사 인력 Pool 모집」 하나뿐.
 * ★`채용` 을 통째로 버리면 안 된다 — 고용보조금은 제목에 「채용」을 쓴다(cwip).
 */
const DROP = /강사\s*인력\s*(?:Pool|풀)/;

export function isSnipDropTitle(title: string): boolean {
  return DROP.test(title);
}

export function parseSnipList(html: string): BoardRow[] {
  const out: BoardRow[] = [];
  const seen = new Set<string>();
  for (const tr of parseHtml(html).querySelectorAll("table.board-list > tbody > tr")) {
    const a = tr.querySelector("td.subject a");
    const href = (a?.getAttribute("href") ?? "").trim();
    if (!href || href === "#") continue;
    const detailUrl = absolutize(href, `${BASE}/`);
    if (seen.has(detailUrl)) continue;
    const title = (a?.text ?? "").replace(/\s+/g, " ").trim();
    if (!title || DROP.test(title)) continue;
    seen.add(detailUrl);
    /**
     * 접수기간은 **`td.term` 칸을 직접** 집는다.
     * ⚠️ 행 전체 글자(`tr.text`)에서 찾으면 안 된다 — 칸이 띄어쓰기 없이 이어 붙어
     *    조회수 「142」 + 작성일 「2026-08-31」이 「1422026-08-31」이 된다(hsbiz 실측 함정).
     * ⚠️ `td.data`(작성일)로 떨어지면 안 된다 — 세 번째 행은 접수기간 08-28~09-04,
     *    작성일은 08-27 이라 끝이 하루 앞당겨진다.
     */
    const term = (tr.querySelector("td.term")?.text ?? "").replace(/\s+/g, " ").trim();
    const days = [...term.matchAll(YMD)].map(
      (m) => `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`,
    );
    const dateText =
      days.length >= 2 ? `${days[0]} ~ ${days[1]}` : days.length === 1 ? `${days[0]} ~` : "";
    out.push({
      title,
      detailUrl,
      dateText,
      category: "",
      agency: "성남산업진흥원",
    });
  }
  return out;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * 목록에 저장된 사업신청 주소만 공개 상세 주소로 옮긴다.
 * 틀리면 요청 전에 null — 껍데기 `application.page` 를 그대로 열지 않는다.
 */
export function snipOfficialDetailUrl(storedUrl: string): string | null {
  let u: URL;
  try {
    u = new URL(storedUrl);
  } catch {
    return null;
  }
  if (u.protocol !== "https:") return null;
  if (u.username || u.password) return null;
  if (u.origin !== PORTAL_ORIGIN) return null;
  if (u.pathname !== STORED_DETAIL_PATH) return null;
  const portlet = u.searchParams.get("portlet") ?? "";
  const portlet2 = u.searchParams.get("portlet2") ?? "";
  if (!PORTLET.test(portlet) || !PORTLET2.test(portlet2)) return null;
  return (
    `${PORTAL_ORIGIN}${OFFICIAL_DETAIL_PATH}` +
    `?pjtAnncSn=${encodeURIComponent(portlet)}&pjtCd=${encodeURIComponent(portlet2)}&stateChk=N`
  );
}

function officialImageUrl(src: string): string | null {
  const raw = decodeHtmlEntities(src).trim();
  if (!raw || /^\s*javascript:/i.test(raw) || raw.includes("..")) return null;
  let u: URL;
  try {
    u = new URL(raw, `${PORTAL_ORIGIN}/`);
  } catch {
    return null;
  }
  if (u.username || u.password) return null;
  if (u.origin !== PORTAL_ORIGIN) return null;
  if (u.search || u.hash) return null;
  if (!IMAGE_PATH.test(u.pathname)) return null;
  return `${PORTAL_ORIGIN}${u.pathname}`;
}

function officialDownloadUrl(hex: string): string | null {
  if (!HEX.test(hex)) return null;
  return `${PORTAL_ORIGIN}${FILE_DOWNLOAD_PATH}?comAtchFileId=${encodeURIComponent(hex)}&dataType=biz`;
}

function officialDownloadUrlOf(href: string): string | null {
  const raw = decodeHtmlEntities(href).trim();
  if (!raw || /^\s*javascript:/i.test(raw)) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.username || u.password) return null;
  if (u.origin !== PORTAL_ORIGIN) return null;
  if (u.pathname !== FILE_DOWNLOAD_PATH) return null;
  if (u.hash) return null;
  const hex = u.searchParams.get("comAtchFileId") ?? "";
  const dataType = u.searchParams.get("dataType") ?? "";
  if (!HEX.test(hex) || dataType !== "biz") return null;
  const keys = [...u.searchParams.keys()];
  if (keys.length !== 2 || !keys.includes("comAtchFileId") || !keys.includes("dataType")) return null;
  return officialDownloadUrl(hex);
}

function fileDownHex(call: string): string {
  return call.match(FILE_DOWN_CALL)?.[2] ?? "";
}

function imageNameOf(img: { getAttribute(name: string): string | undefined | null }, url: string): string {
  const titled = (img.getAttribute("title") || img.getAttribute("alt") || "").replace(/\s+/g, " ").trim();
  if (titled) return titled;
  const tail = url.split("/").pop() ?? "";
  try {
    return decodeURIComponent(tail);
  } catch {
    return tail;
  }
}

function summernoteMarkup(pageHtml: string): string {
  const ta = parseHtml(pageHtml).querySelector("textarea#summernote[name=content]");
  if (!ta) return "";
  return decodeHtmlEntities((ta.innerHTML ?? "").trim());
}

function collectSnipImages(html: string): { name: string; url: string }[] {
  const root = parseHtml(html);
  const chunks: string[] = [];
  const body = root.querySelector(`#${DETAIL_BODY_ID}`);
  if (body) chunks.push(body.innerHTML ?? "");
  const ta = root.querySelector("textarea#summernote[name=content]");
  if (ta) chunks.push(decodeHtmlEntities((ta.innerHTML ?? "").trim()));
  const seen = new Set<string>();
  const out: { name: string; url: string }[] = [];
  for (const chunk of chunks) {
    const doc = parseHtml(`<div>${chunk}</div>`);
    for (const img of doc.querySelectorAll("img")) {
      const url = officialImageUrl(img.getAttribute("src") ?? "");
      if (!url || seen.has(url)) continue;
      const name = imageNameOf(img, url);
      if (!name) continue;
      seen.add(url);
      out.push({ name, url });
    }
  }
  return out;
}

function collectSnipFiles(html: string): { name: string; url: string }[] {
  const root = parseHtml(html);
  const seen = new Set<string>();
  const out: { name: string; url: string }[] = [];
  const push = (name: string, url: string) => {
    const n = name.replace(/\s+/g, " ").trim();
    if (!n || seen.has(url)) return;
    seen.add(url);
    out.push({ name: n, url });
  };
  for (const a of root.querySelectorAll("a")) {
    const url = officialDownloadUrlOf(a.getAttribute("href") ?? "");
    if (!url) continue;
    push(a.getAttribute("data-snip-name") ?? a.text ?? "", url);
  }
  for (const tit of root.querySelectorAll(".titArea4 p.tit")) {
    let pending = "";
    for (const a of tit.querySelectorAll("a")) {
      const call = a.getAttribute("onclick") ?? "";
      const hex = fileDownHex(call);
      if (hex) {
        const url = officialDownloadUrl(hex);
        if (url && pending) push(pending, url);
        pending = "";
        continue;
      }
      if (/\bfn_Preview\s*\(/.test(call)) continue;
      const label = (a.text ?? "").replace(/\s+/g, " ").trim();
      if (label && label !== "다운로드" && label !== "바로보기") pending = label;
    }
  }
  return out;
}

function fileListHtml(files: { name: string; url: string }[]): string {
  if (!files.length) return "";
  const items = files
    .map((f) => `<li><a href="${escapeHtml(f.url)}" data-snip-name="${escapeHtml(f.name)}"></a></li>`)
    .join("");
  return `<ul class="snip-files">${items}</ul>`;
}

function buildSnipDetailHtml(pageHtml: string): string {
  const markup = summernoteMarkup(pageHtml).replace(PLACEHOLDER, "").trim();
  const files = collectSnipFiles(pageHtml);
  const body = parseHtml(`<div>${markup}</div>`);
  body.querySelectorAll("script,style,iframe,form").forEach(el => el.remove());
  const inner = body.querySelector("div")?.innerHTML ?? "";
  if (!inner.trim() && files.length === 0) return "";
  return `<div id="${DETAIL_BODY_ID}">${inner}</div>${fileListHtml(files)}`;
}

export function snipDetailAttachments(html: string): PolicyAttachmentRequest[] {
  const seen = new Set<string>();
  const out: PolicyAttachmentRequest[] = [];
  for (const item of [...collectSnipImages(html), ...collectSnipFiles(html)]) {
    if (seen.has(item.url)) continue;
    seen.add(item.url);
    out.push({ name: item.name, url: item.url, kind: attachmentKindOf(item.name, item.url) });
  }
  return out;
}

export const snipConfig: BoardConfig = {
  id: "snip",
  label: "성남산업진흥원",
  agency: "성남산업진흥원",
  region: "경기",
  baseUrl: `${BASE}/`,
  allowedHosts: ["portal.snip.or.kr:8443"],
  charset: "utf-8",
  list: {
    url: (p) => `${BASE}${LIST}?page=${p}`,
    maxPages: 10,
    rowSelector: "table.board-list > tbody > tr",
    fields: {
      title: { selector: "td.subject a" },
      detailUrl: { selector: "td.subject a", attr: "href" },
      date: { selector: "td.term" },
    },
  },
  customParse: parseSnipList,
  /**
   * 목록 저장 주소는 로그인 껍데기(`application.page`)다. 익명 공개 본문은
   * `businDetail.face`(실측 HTTP 200). `detailFetch` 가 저장 주소를 검사한 뒤에만
   * 그 공개 주소로 옮긴다 — 껍데기·비밀번호 iframe 은 요청하지 않는다.
   *
   * 본문은 `textarea#summernote[name=content]` 안의 HTML 이다. 자리 표시 문장
   * 「사업 공고문 내용을 입력합니다」는 공고문이 아니다. 그림만 있는 공고는 같은 호스트
   * `/gwCustSnip/…png|jpeg` 를 원문으로 남기고, 파일명·안내문을 본문에 넣지 않는다.
   * 본문을 비워 두어 첨부 내용 수집도 이어진다. 글자를 지어내지 않는다. 접수기간은 목록 값을 그대로 쓴다.
   *
   * 첨부는 `.titArea4 p.tit` 의 이름 다음 `fn_fileDown('HEX')` 만
   * `/user/snip/attatchFileDownload.face?comAtchFileId=HEX&dataType=biz` 로 바꾼다.
   * 미리보기·임의 스크립트 주소는 쓰지 않는다.
   */
  detailContentSelector: `#${DETAIL_BODY_ID}`,
  detailFetch: async (detailUrl, fetchText) => {
    const official = snipOfficialDetailUrl(detailUrl);
    if (!official) return "";
    return buildSnipDetailHtml(await fetchText(official));
  },
  detailAttachments: ({ html, pageHtml }) => snipDetailAttachments(html || pageHtml),
  expectMinRows: 2,
};
