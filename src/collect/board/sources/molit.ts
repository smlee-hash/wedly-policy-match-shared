import { attachmentKindOf } from "../../../engine/types";
import { decodeHtmlEntities, parseHtml } from "../html";
import type { BoardConfig, BoardRow, PolicyAttachmentRequest } from "../types";

/**
 * 국토교통부 공지사항(`/USR/BORD0201/m_69`, 게시판 `id=N01_B`).
 *
 * 왜 연결했나: 본청 공지에서 기업이 신청하는 공고가 실제로 나온다. 옛 제외 사유
 * 「본청 자체는 기업 대상 공고가 0건」은 틀렸다 — 공식 2026년 스마트도시 규제샌드박스
 * 공모(`idx=267090`)가 같은 판에 있다(고정본 `molit-business.html`·`molit-detail.html`).
 *
 * 목록 주소에 `search_regdate_s=1900-01-01&search_regdate_e=2099-12-31` 를 **반드시** 붙인다.
 * 이 인자를 빼면 사이트가 최근 1년만 보여 샌드박스처럼 한 해 지난 공모가 목록에서 사라진다.
 * 2099 는 **검색 구간**이지 공고 날짜를 지어 넣는 값이 아니다.
 *
 * `baseUrl` 은 `/m_69/` 로 끝나야 `./DTL.jsp` 가 같은 칸의 상세로 풀린다.
 *
 * 제목은 `td.bd_title a` 의 **글자**다. `title` 속성은 잘린 값이 올 수 있어 쓰지 않는다.
 * 등록일은 `td.bd_date` 칸의 `YYYY-MM-DD` 만 — 행 전체 글자에서 찾으면 조회수·번호와 붙는다.
 *
 * 첫 응답이 같은 주소로 307 을 주며 쿠키를 심는 것은 기존 `fetchBoardText` 쿠키 항아리가
 * 처리한다. 전역 쿠키·TLS 우회를 만들지 않는다.
 */
const HOST = "www.molit.go.kr";
const ORIGIN = `https://${HOST}`;
const BOARD_DIR = "/USR/BORD0201/m_69";
const BASE = `${ORIGIN}${BOARD_DIR}/`;
const LIST_FILE = "LST.jsp";
const DETAIL_FILE = "DTL.jsp";
const DETAIL_PATH = `${BOARD_DIR}/${DETAIL_FILE}`;
const BOARD_ID = "N01_B";
const RANGE_START = "1900-01-01";
const RANGE_END = "2099-12-31";
const ROW = "table.bd_tbl tbody tr";
const YMD_CELL = /^(20\d{2})-(\d{2})-(\d{2})$/;
const IDX = /^\d+$/;
const ATTACH_PATH = "/LCMS/DWN.jsp";
const ATTACH_FOLD = "/N01_B/";
const ATTACH_EXT = /\.(hwpx|hwp|pdf)$/i;
const SESSION_PATH = /;jsessionid=[^/?#]*/i;

/**
 * 지원 공고가 아닌 글. **버릴 것만** 좁게 지정한다 — 허용 낱말 목록은 드문 정책을 죽인다.
 * 해·건수·빈도로 자르지 않는다. 애매한 고시·인증·스마트도시 공모·혁신제품 지정은 남긴다.
 *
 * ★`채용` 을 통째로 버리면 안 된다 — 「채용 지원사업」·「근로자 지원사업」이 같이 죽는다.
 *   기관이 사람을 뽑는 글(`직원 채용 공고`)만 친다.
 */
const DROP =
  /징계|판결|소송|공시\s*송달|재판|(?:신규|경력|직원|공무원)\s*채용\s*(?:공고|안내|재공고)|채용\s*(?:공고|안내|재공고)|공개\s*채용\s*(?:공고|안내)|임용|인사\s*발령|입찰|낙찰|우선\s*협상|선정\s*결과|합격자|결과\s*(?:발표|공고)|명단/;

/** 통합 쪽 BoardConfig 에는 이미 있는 선택 필드. 이 격리 사본 types.ts 에는 아직 없다. */
export type MolitBoardConfig = BoardConfig & {
  validationParse?: (html: string, page: number) => BoardRow[];
};

export function isMolitDropTitle(title: string): boolean {
  return DROP.test(title);
}

function queryRaw(href: string, key: string): string | null {
  const cut = href.indexOf("?");
  if (cut < 0) return null;
  const query = (href.slice(cut + 1).split("#")[0] ?? "").replace(/&amp;/g, "&");
  for (const part of query.split("&")) {
    const eq = part.indexOf("=");
    const name = eq < 0 ? part : part.slice(0, eq);
    if (name === key) return eq < 0 ? "" : part.slice(eq + 1);
  }
  return null;
}

function decodeQuery(raw: string): string | null {
  try {
    return decodeURIComponent(raw.replace(/\+/g, " "));
  } catch {
    return null;
  }
}

/**
 * 상대·절대 href 를 같은 호스트 https 상세 주소로만 굳힌다.
 * 세션·검색·쪽 번호는 버리고 `id=N01_B&mode=view&idx=숫자` 만 남긴다.
 * 호스트·프로토콜·경로·게시판 id 가 다르거나 idx 가 숫자가 아니면 버린다.
 */
export function canonicalMolitDetailUrl(href: string, baseUrl: string = BASE): string | null {
  const raw = decodeHtmlEntities((href ?? "").trim());
  if (!raw || /^\s*javascript:/i.test(raw)) return null;
  let u: URL;
  try {
    u = new URL(raw, baseUrl);
  } catch {
    return null;
  }
  if (u.protocol !== "https:") return null;
  if (u.host.toLowerCase() !== HOST) return null;
  const path = u.pathname.replace(SESSION_PATH, "");
  if (path !== DETAIL_PATH) return null;
  const id = u.searchParams.get("id");
  const mode = u.searchParams.get("mode");
  const idx = u.searchParams.get("idx");
  if (id !== BOARD_ID || mode !== "view" || !idx || !IDX.test(idx)) return null;
  return `${ORIGIN}${DETAIL_PATH}?id=${BOARD_ID}&mode=view&idx=${idx}`;
}

function keepFileNameQuery(raw: string): string | null {
  if (!raw) return null;
  const decoded = decodeQuery(raw);
  if (decoded === null) return null;
  if (!ATTACH_EXT.test(decoded) && !ATTACH_EXT.test(raw)) return null;
  // 이미 퍼센트 인코딩된 값은 그대로 — 다시 인코딩하면 `%28` 이 `%2528` 이 된다.
  if (decoded !== raw) return raw;
  return encodeURIComponent(raw);
}

function canonicalMolitAttachmentUrl(href: string, baseUrl: string): string | null {
  const raw = decodeHtmlEntities((href ?? "").trim());
  if (!raw || /^\s*javascript:/i.test(raw)) return null;
  if (/\/USR\/viewer\.do(?:[?#]|$)/i.test(raw)) return null;
  let u: URL;
  try {
    u = new URL(raw, baseUrl);
  } catch {
    return null;
  }
  if (u.protocol !== "https:") return null;
  if (u.host.toLowerCase() !== HOST) return null;
  const path = u.pathname.replace(SESSION_PATH, "");
  if (path !== ATTACH_PATH) return null;
  const foldRaw = queryRaw(raw, "fold") ?? u.searchParams.get("fold") ?? "";
  const fold = decodeQuery(foldRaw) ?? foldRaw;
  if (fold !== ATTACH_FOLD && fold !== ATTACH_FOLD.replace(/\/$/, "")) return null;
  const fileRaw = queryRaw(raw, "fileName");
  if (fileRaw === null) return null;
  const fileName = keepFileNameQuery(fileRaw);
  if (!fileName) return null;
  return `${ORIGIN}${ATTACH_PATH}?fold=${ATTACH_FOLD}&fileName=${fileName}`;
}

function titleOfAnchor(a: { text: string }): string {
  // 제목은 앵커 **글자**. title 속성은 잘릴 수 있어 쓰지 않는다.
  return (a.text ?? "").replace(/\s+/g, " ").trim();
}

function dateTextOfRow(tr: { querySelector: (s: string) => { text: string } | null }): string {
  const cell = (tr.querySelector("td.bd_date")?.text ?? "").replace(/\s+/g, " ").trim();
  return YMD_CELL.test(cell) ? `${cell} ~` : "";
}

/**
 * 구조가 맞는 행을 **거르개 전에** 전부 담는다.
 * 검증(`validationParse`)이 제목 거르개 뒤 0행을 서식 붕괴로 오해하지 않게 한다.
 */
export function parseMolitRaw(html: string, _page = 1): BoardRow[] {
  const out: BoardRow[] = [];
  const seen = new Set<string>();
  for (const tr of parseHtml(html).querySelectorAll(ROW)) {
    const a = tr.querySelector("td.bd_title a");
    if (!a) continue;
    const detailUrl = canonicalMolitDetailUrl(a.getAttribute("href") ?? "");
    if (!detailUrl || seen.has(detailUrl)) continue;
    const title = titleOfAnchor(a);
    if (!title) continue;
    seen.add(detailUrl);
    const category = (tr.querySelector("td.bd_part")?.text ?? "").replace(/\s+/g, " ").trim();
    out.push({
      title,
      detailUrl,
      dateText: dateTextOfRow(tr),
      category,
    });
  }
  return out;
}

export function parseMolitList(html: string, page = 1): BoardRow[] {
  return parseMolitRaw(html, page).filter((r) => !isMolitDropTitle(r.title));
}

/**
 * 같은 호스트 `/LCMS/DWN.jsp?fold=/N01_B/&fileName=…` 만 담는다.
 * `viewer.do` 는 미리보기라 첨부가 아니다. 파일 이름 쿼리는 있는 인코딩을 유지한다.
 */
export function molitDetailAttachments(args: {
  html: string;
  pageHtml?: string;
  detailUrl?: string;
  baseUrl: string;
}): PolicyAttachmentRequest[] {
  const out: PolicyAttachmentRequest[] = [];
  const seen = new Set<string>();
  for (const a of parseHtml(args.html).querySelectorAll("a")) {
    const url = canonicalMolitAttachmentUrl(a.getAttribute("href") ?? "", args.baseUrl);
    if (!url || seen.has(url)) continue;
    const name =
      (a.text ?? "").replace(/\s+/g, " ").trim() ||
      decodeQuery(queryRaw(a.getAttribute("href") ?? "", "fileName") ?? "") ||
      "첨부";
    seen.add(url);
    out.push({ name, url, kind: attachmentKindOf(name, url) });
  }
  return out;
}

export const molitConfig: MolitBoardConfig = {
  id: "molit",
  label: "국토교통부 공고",
  agency: "국토교통부",
  region: "전국",
  baseUrl: BASE,
  charset: "utf-8",
  list: {
    url: (p) =>
      `${ORIGIN}${BOARD_DIR}/${LIST_FILE}?id=${BOARD_ID}` +
      `&search_regdate_s=${RANGE_START}&search_regdate_e=${RANGE_END}&lcmspage=${p}`,
    maxPages: 5,
    rowSelector: ROW,
    fields: {
      title: { selector: "td.bd_title a" },
      detailUrl: { selector: "td.bd_title a", attr: "href" },
      date: { selector: "td.bd_date" },
      category: { selector: "td.bd_part" },
    },
  },
  customParse: parseMolitList,
  validationParse: parseMolitRaw,
  skipHeuristic: true,
  expectMinRows: 1,
  detailContentSelector: ".bd_view_cont",
  /**
   * 실제 화면은 `.bd_view li.file` 이지만, 잘라 둔 상세 고정본에는 `.bd_view` 상자가 없다.
   * `li.file` 이면 고정본(뿌리)과 실페이지(상자 안)를 같이 집는다.
   */
  attachmentsScopeSelector: "li.file",
  detailAttachments: molitDetailAttachments,
};
