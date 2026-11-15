import { attachmentKindOf } from "../../../engine/types";
import { absolutize, decodeHtmlEntities, parseHtml } from "../html";
import type { BoardConfig, BoardRow, PolicyAttachmentRequest } from "../types";

/**
 * 성남산업진흥원 전체사업공고.
 *
 * 왜 연결했나(2026-09-02 실측): 최신 5건을 기업마당·보조금24 포함 우리 DB 와 제목으로
 * 대조했더니 진짜 겹침은 0건(오탐 1) — 통합 수집원으로는 안 들어온다.
 *
 * 구조: `table.board-list > tbody > tr` 10건. **접수기간을 목록에서 준다**(`td.term`).
 * 쪽넘김은 `?page=n` GET. `pageIndex`·`pageNo`·`currentPage` 는 안 먹는다(실측).
 * 마감일을 주므로 깊이 파도 끝난 공고가 「모집중」으로 안 섞인다 — `maxPages: 10`.
 *
 * ⚠️ 2026-09 말 사이트 개편(2026-11-15 실측, NO.486).
 *    · 상세 링크가 포털(`portal.snip.or.kr:8443`)에서 **상대 주소** `?schM=view&snp=…` 로 바뀌었다.
 *      목록 주소에 붙여야 한다 — 사이트 뿌리에 붙이면 166바이트 넘김 화면만 와서 상세가 102건 빈 글로 실패했다.
 *    · 접수기간 칸이 `시작~끝` 에서 **마감일만**(`~2026-11-20`) 주는 꼴로 바뀌었다 — 시작일로 적으면 안 된다.
 *    · 옛 포털 공고 번호(portlet)가 새 사이트 snp 와 같다(2026-0253 실측). 포털은 닫혔다.
 */
const BASE = "https://www.snip.or.kr";
const LIST = "/SNIP/contents/Business1.do";
const LIST_URL = `${BASE}${LIST}`;
const YMD = /(20\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})/g;

/** 개편 전 저장 주소. 옛 줄을 다시 읽을 때 snp 로 옮긴다. */
const PORTAL_ORIGIN = "https://portal.snip.or.kr:8443";
const STORED_DETAIL_PATH = "/portal/snip/MainMenu/businessManagement/application.page";
/**
 * 개편 전 글 번호 `YYYY-NNNN`. ★연도 자리가 `1900` 인 번호도 받는다 — 2009년 「입주기업 모집」 글이 마감일 칸이
 * 「~ 1900-01-00」인 채 `1900-0001`~ 번호로 남아 있고, 새 사이트도 이 번호로 상세를 연다
 * (2026-11-15 실측 `snp=1900-0001` → 200·본문 있음). 20xx 만 받으면 이 글들이 빈 글로 실패에 남는다.
 * 그 밖의 19xx 는 본 적이 없어 계속 거절한다.
 */
const OLD_NO = /^(?:20\d{2}|1900)-\d+$/;
const PORTLET2 = /^[1-9]\d*$/;

/** 새 글은 32자리 16진수, 개편 전 글은 `YYYY-NNNN`(실측). */
const SNP_NEW = /^[0-9A-Fa-f]{32}$/;
const isSnp = (v: string) => SNP_NEW.test(v) || OLD_NO.test(v);
const FILE_ID = /^[0-9A-Za-z_-]{1,100}$/;
const FILE_LIST_PATH = "/afile/fileList.do";
const FILE_DOWNLOAD_PATH = /^\/afile\/fileDownload\/[0-9A-Za-z]+$/;
const IMAGE_PATH = /^\/data\/COMMON\/.+\.(?:png|jpe?g)$/i;
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

const canonicalOf = (snp: string) => `${LIST_URL}?schM=view&snp=${snp}`;
/**
 * 개편 뒤 2026-11 배포까지 저장된 주소 꼴(상대 주소를 뿌리에 붙인 값).
 * 중복 판정 열쇠(sourceId)로 그대로 쓴다 — 바꾸면 이미 쌓인 공고가 두 줄이 된다.
 */
const legacyKeyOf = (snp: string) => `${BASE}/?schM=view&snp=${snp}`;

function snpOf(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== "https:") return null;
  if (u.username || u.password) return null;
  if (u.origin === BASE) {
    if (u.pathname !== LIST && u.pathname !== "/") return null;
    if (u.searchParams.get("schM") !== "view") return null;
    const snp = u.searchParams.get("snp") ?? "";
    return isSnp(snp) ? snp : null;
  }
  if (u.origin === PORTAL_ORIGIN && u.pathname === STORED_DETAIL_PATH) {
    const portlet = u.searchParams.get("portlet") ?? "";
    const portlet2 = u.searchParams.get("portlet2") ?? "";
    return OLD_NO.test(portlet) && PORTLET2.test(portlet2) ? portlet : null;
  }
  return null;
}

/**
 * 저장된 세 꼴(정식 주소·개편 뒤 뿌리 꼴·옛 포털 꼴)을 공개 상세 정식 주소로 옮긴다.
 * 틀리면 요청 전에 null.
 */
export function snipOfficialDetailUrl(storedUrl: string): string | null {
  const snp = snpOf(storedUrl);
  return snp ? canonicalOf(snp) : null;
}

export function parseSnipList(html: string): BoardRow[] {
  const out: BoardRow[] = [];
  const seen = new Set<string>();
  for (const tr of parseHtml(html).querySelectorAll("table.board-list > tbody > tr")) {
    const a = tr.querySelector("td.subject a");
    const href = decodeHtmlEntities(a?.getAttribute("href") ?? "").trim();
    if (!href || href === "#") continue;
    // 상대 주소 `?schM=view&snp=…` 는 목록 주소에 붙는다. 개편 전 고정본은 포털 절대 주소라 그대로다.
    const abs = absolutize(href, LIST_URL);
    const isView = abs.startsWith(`${BASE}/`);
    const snp = isView ? snpOf(abs) : null;
    const detailUrl = snp ? canonicalOf(snp) : abs;
    if (seen.has(detailUrl)) continue;
    const title = (a?.text ?? "").replace(/\s+/g, " ").trim();
    if (!title || DROP.test(title)) continue;
    seen.add(detailUrl);
    /**
     * 접수기간은 **`td.term` 칸을 직접** 집는다.
     * ⚠️ 행 전체 글자(`tr.text`)에서 찾으면 안 된다 — 칸이 띄어쓰기 없이 이어 붙어
     *    조회수 「142」 + 작성일 「2026-08-31」이 「1422026-08-31」이 된다(hsbiz 실측 함정).
     * ⚠️ `td.data`(작성일)로 떨어지면 안 된다 — 작성일은 접수 시작보다 하루 이를 수 있다.
     * ⚠️ 날짜가 하나면 앞의 `~` 를 본다 — `~2026-11-20` 은 마감일이다(개편 뒤 꼴).
     */
    const term = (tr.querySelector("td.term")?.text ?? "").replace(/\s+/g, " ").trim();
    const days = [...term.matchAll(YMD)].map(
      (m) => `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`,
    );
    const dateText =
      days.length >= 2
        ? `${days[0]} ~ ${days[1]}`
        : days.length === 1
          ? term.startsWith("~")
            ? `~ ${days[0]}`
            : `${days[0]} ~`
          : "";
    out.push({
      title,
      detailUrl,
      ...(snp ? { sourceId: legacyKeyOf(snp) } : {}),
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

/** 같은 사이트(https, 포트 없음)의 주소만 받는다. 쿼리·조각·`..`·자격 정보가 있으면 null. */
function sameSiteUrl(raw: string): URL | null {
  const s = decodeHtmlEntities(raw).trim();
  if (!s || s.includes("..") || /^\s*(?:javascript|data):/i.test(s)) return null;
  let u: URL;
  try {
    u = new URL(s, `${BASE}/`);
  } catch {
    return null;
  }
  if (u.username || u.password) return null;
  if (u.origin !== BASE) return null;
  if (u.search || u.hash) return null;
  return u;
}

function officialImageUrl(src: string): string | null {
  const u = sameSiteUrl(src);
  return u && IMAGE_PATH.test(u.pathname) ? `${BASE}${u.pathname}` : null;
}

function officialDownloadUrl(path: string): string | null {
  const u = sameSiteUrl(path);
  return u && FILE_DOWNLOAD_PATH.test(u.pathname) ? `${BASE}${u.pathname}` : null;
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

type SnipFile = { name: string; url: string };

/**
 * 첨부 목록 응답(JSON 배열). 배열이 아니면 던진다 — 점검 화면·오류를 「첨부 없음」으로 굳히지 않고
 * 다음 수집에서 다시 읽게 한다. 이상한 줄(바깥 주소·지우기 주소·이름 없음·같은 주소)은 버린다.
 */
function parseSnipFileList(text: string): SnipFile[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("성남산업진흥원 첨부 목록 응답이 JSON 이 아님");
  }
  if (!Array.isArray(data)) throw new Error("성남산업진흥원 첨부 목록 응답이 배열이 아님");
  const seen = new Set<string>();
  const out: SnipFile[] = [];
  for (const item of data) {
    if (!item || typeof item !== "object") continue;
    const { fileName, downloadPath } = item as { fileName?: unknown; downloadPath?: unknown };
    if (typeof fileName !== "string" || typeof downloadPath !== "string") continue;
    const name = fileName.replace(/\s+/g, " ").trim();
    if (!name) continue;
    const url = officialDownloadUrl(downloadPath);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push({ name, url });
  }
  return out;
}

function fileListHtml(files: SnipFile[]): string {
  if (!files.length) return "";
  const items = files
    .map((f) => `<li><a href="${escapeHtml(f.url)}" data-snip-name="${escapeHtml(f.name)}"></a></li>`)
    .join("");
  return `<ul class="snip-files">${items}</ul>`;
}

/** 본문 칸만 남긴다. 버튼·이전글·첨부 이름은 본문 글자에 섞지 않는다(첨부는 글자 없는 목록으로). */
function buildSnipDetailHtml(viewInner: string, files: SnipFile[]): string {
  const body = parseHtml(`<div>${viewInner.replace(PLACEHOLDER, "")}</div>`);
  body.querySelectorAll("script,style,noscript,iframe,form,object,embed").forEach((el) => el.remove());
  const inner = (body.querySelector("div")?.innerHTML ?? "").trim();
  return `<div id="${DETAIL_BODY_ID}">${inner}</div>${fileListHtml(files)}`;
}

export function snipDetailAttachments(html: string): PolicyAttachmentRequest[] {
  const root = parseHtml(html);
  const seen = new Set<string>();
  const out: PolicyAttachmentRequest[] = [];
  const push = (name: string, url: string) => {
    const n = name.replace(/\s+/g, " ").trim();
    if (!n || seen.has(url)) return;
    seen.add(url);
    out.push({ name: n, url, kind: attachmentKindOf(n, url) });
  };
  const body = root.querySelector(`#${DETAIL_BODY_ID}`);
  for (const img of body?.querySelectorAll("img") ?? []) {
    const url = officialImageUrl(img.getAttribute("src") ?? "");
    if (url) push(imageNameOf(img, url), url);
  }
  for (const a of root.querySelectorAll("ul.snip-files a")) {
    const url = officialDownloadUrl(a.getAttribute("href") ?? "");
    if (url) push(decodeHtmlEntities(a.getAttribute("data-snip-name") ?? ""), url);
  }
  return out;
}

export const snipConfig: BoardConfig = {
  id: "snip",
  label: "성남산업진흥원",
  agency: "성남산업진흥원",
  region: "경기",
  baseUrl: `${BASE}/`,
  /**
   * 개편 전에 저장된 첨부 주소가 포털(`portal.snip.or.kr:8443`)이다. 내려받기 허용은 남긴다
   * (`allowedHostsOf` 는 `new URL().host` 로 대조하므로 포트가 열쇠에 들어간다).
   */
  allowedHosts: ["portal.snip.or.kr:8443"],
  charset: "utf-8",
  list: {
    url: (p) => `${LIST_URL}?page=${p}`,
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
   * 저장 주소 세 꼴을 정식 상세 주소(`Business1.do?schM=view&snp=…`)로 옮긴 뒤에만 요청한다.
   * 본문은 `.board-view .view-content`. 이 칸이 없으면(없는 공고의 오류 화면) 빈 글이다.
   * 칸이 있으면 비어 있어도 상자를 돌려준다 — 진짜 공고를 실패로 되풀이하지 않는다.
   * 자리 표시 문장 「사업 공고문 내용을 입력합니다」는 공고문이 아니라 지운다. 글자를 지어내지 않는다.
   *
   * 첨부는 `.file-list input[name=fileId]` 값으로 `GET /afile/fileList.do?fileId=…`(JSON 배열)를 읽고
   * `downloadPath`(`/afile/fileDownload/<코드>`, 익명 200 실측)만 쓴다. fileId 가 비었거나 이상하면 요청하지 않는다.
   * 그림만 있는 공고는 본문의 같은 사이트 `/data/COMMON/…png|jpg` 를 원문 첨부로 남긴다.
   */
  detailContentSelector: `#${DETAIL_BODY_ID}`,
  detailFetch: async (detailUrl, fetchText) => {
    const official = snipOfficialDetailUrl(detailUrl);
    if (!official) return "";
    const page = parseHtml(await fetchText(official));
    const view = page.querySelector(".board-view .view-content");
    if (!view) return "";
    const fileId = (page.querySelector(".board-view .file-list input[name=fileId]")?.getAttribute("value") ?? "").trim();
    const files = FILE_ID.test(fileId)
      ? parseSnipFileList(await fetchText(`${BASE}${FILE_LIST_PATH}?fileId=${encodeURIComponent(fileId)}`))
      : [];
    return buildSnipDetailHtml(view.innerHTML ?? "", files);
  },
  detailAttachments: ({ html, pageHtml }) => snipDetailAttachments(html || pageHtml),
  expectMinRows: 2,
};
