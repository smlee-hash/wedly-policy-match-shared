import { attachmentKindOf } from "../../../engine/types";
import { decodeHtmlEntities, parseHtml, type HTMLElement } from "../html";
import type { BoardConfig, BoardRow } from "../types";

/** 게시 빈도와 무관하게 기업이 신청할 수 있는 본청 공식 공고를 수집한다. */
export type MinistryBoardConfig = BoardConfig;

const JSESSION = /;jsessionid=[^?#]*/i;
const YMD = /(20\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})/;

const MOIS_HOST = "www.mois.go.kr";
const MOIS_BASE = `https://${MOIS_HOST}`;
const MOIS_BBS = "BBSMSTR_000000000006";
const MOIS_LIST = "/frt/bbs/type013/commonSelectBoardList.do";
const MOIS_VIEW = "/frt/bbs/type013/commonSelectBoardArticle.do";

const MPVA_HOST = "www.mpva.go.kr";
const MPVA_BASE = `https://${MPVA_HOST}`;
/** 상대 첨부 `./downloadBbsFile.do` 를 풀려면 끝이 `/mpva/` 여야 한다. */
const MPVA_ORIGIN = `${MPVA_BASE}/mpva/`;
const MPVA_LIST = "/mpva/selectBbsNttList.do";
const MPVA_VIEW = "/mpva/selectBbsNttView.do";
const MPVA_KEY = "76";
const MPVA_BBS = "15";

const MND_HOST = "www.mnd.go.kr";
const MND_BASE = `https://${MND_HOST}`;
/** 입찰(26374) 판에도 AI 상용화 지원·국방 R&D 공고가 있다. 판 이름만 보고 빼지 않는다. */
export const MND_BOARD_IDS = ["26374", "26390", "133389"] as const;
const MND_VIEW = new RegExp(
  `^/bbs/mnd/(${MND_BOARD_IDS.join("|")})/([IO]_\\d+)/artclView\\.do$`,
);

/**
 * 버릴 제목만 좁게. 애매한 정책 공고·옛 날짜 글은 남긴다.
 * ★`채용 지원사업` 은 고용보조금이라 절대 버리지 않는다.
 * ★`입찰` 은 제목에 조달이 드러날 때만. 지원사업 제목은 입찰 판에 있어도 남긴다.
 */
const STAFF =
  /(?:기간제\s*근로자|공무직|임기제\s*(?:공무원)?)(?!.*지원\s*사업).*(?:채용|모집|선발)|경력경쟁채용|(?:직원|공무원|근로자)\s*채용|채용\s*(?:공고|시험|안내)|선발\s*시험|임용\s*시험|개방형직위|공개초빙|사무총장|인사발령|합격자/;
const RESULTS =
  /선정\s*결과|수상\s*결과|결과\s*발표|서류(?:심사)?\s*결과|대면평가\s*결과|기술평가\s*결과|영향평가\s*결과|최종\s*결과/;
const JUDICIAL = /공시\s*송달/;
const DISCIPLINE = /징계|서훈\s*취소/;
const ADMIN_ONLY = /시스템\s*점검|홈페이지\s*(?:안내|점검)|휴무\s*안내/;
const BID = /입찰/;
const KEEP_EMPLOYMENT_GRANT = /채용\s*지원/;
const KEEP_SUPPORT = /지원\s*사업/;

export function isMinistryDropTitle(title: string): boolean {
  if (KEEP_EMPLOYMENT_GRANT.test(title)) return false;
  if (STAFF.test(title) || RESULTS.test(title) || JUDICIAL.test(title) || DISCIPLINE.test(title) || ADMIN_ONLY.test(title)) {
    return true;
  }
  if (BID.test(title) && !KEEP_SUPPORT.test(title)) return true;
  return false;
}

export function mndTargetOf(p: number): { boardId: (typeof MND_BOARD_IDS)[number]; page: number } {
  const i = Math.max(1, Math.floor(p)) - 1;
  return { boardId: MND_BOARD_IDS[i % MND_BOARD_IDS.length], page: Math.floor(i / MND_BOARD_IDS.length) + 1 };
}

function clean(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function stripIconWords(title: string): string {
  return clean(title)
    .replace(/^(?:\[\s*(?:새글|NEW)\s*\]|(?:새글|NEW)(?=\s|$))\s*/i, "")
    .replace(/\s+(?:새글|NEW)$/i, "")
    .replace(/(?:^|\s)첨부파일(?=\s|$)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isRealCalendarDay(y: number, m: number, d: number): boolean {
  const utc = Date.UTC(y, m - 1, d);
  const probe = new Date(utc);
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
}

/** 달력에 없는 날짜(2월 30일 등)는 빈 값. 게시일만 쓴다. */
function publicationYmd(cellText: string): string {
  const m = clean(cellText).match(YMD);
  if (!m) return "";
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (!isRealCalendarDay(y, mo, d)) return "";
  return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
}

function stripSession(href: string): string {
  return decodeHtmlEntities(href).replace(JSESSION, "").trim();
}

function titleOf(a: HTMLElement | null): string {
  if (!a) return "";
  const titled = (a.getAttribute("title") ?? "").trim();
  const span = a.querySelector("strong span") ?? a.querySelector("span");
  const raw = titled || clean(span?.text ?? "") || clean(a.text ?? "");
  return stripIconWords(raw);
}

function parseHref(href: string, base: string): URL | null {
  try {
    return new URL(stripSession(href), base);
  } catch {
    return null;
  }
}

function moisDetailUrl(href: string): string {
  const u = parseHref(href, `${MOIS_BASE}/`);
  if (!u || u.hostname !== MOIS_HOST) return "";
  if (u.pathname.replace(JSESSION, "") !== MOIS_VIEW) return "";
  if (u.searchParams.get("bbsId") !== MOIS_BBS) return "";
  const nttId = u.searchParams.get("nttId") ?? "";
  if (!/^\d+$/.test(nttId)) return "";
  return `${MOIS_BASE}${MOIS_VIEW}?bbsId=${MOIS_BBS}&nttId=${nttId}`;
}

function mpvaDetailUrl(href: string): string {
  const u = parseHref(href, MPVA_ORIGIN);
  if (!u || u.hostname !== MPVA_HOST) return "";
  if (u.pathname.replace(JSESSION, "") !== MPVA_VIEW) return "";
  if (u.searchParams.get("key") !== MPVA_KEY) return "";
  if (u.searchParams.get("bbsNo") !== MPVA_BBS) return "";
  const nttNo = u.searchParams.get("nttNo") ?? "";
  if (!/^\d+$/.test(nttNo)) return "";
  return `${MPVA_BASE}${MPVA_VIEW}?key=${MPVA_KEY}&bbsNo=${MPVA_BBS}&nttNo=${nttNo}`;
}

function mndDetailUrl(href: string): string {
  const u = parseHref(href, `${MND_BASE}/`);
  if (!u || u.hostname !== MND_HOST) return "";
  const m = u.pathname.replace(JSESSION, "").match(MND_VIEW);
  if (!m) return "";
  return `${MND_BASE}/bbs/mnd/${m[1]}/${m[2]}/artclView.do`;
}

function pushRow(
  out: BoardRow[],
  seen: Set<string>,
  row: { title: string; detailUrl: string; dateText: string; agency: string },
): void {
  if (!row.title || !row.detailUrl || !row.dateText) return;
  if (seen.has(row.detailUrl)) return;
  seen.add(row.detailUrl);
  out.push({ title: row.title, detailUrl: row.detailUrl, dateText: `${row.dateText} ~`, agency: row.agency });
}

export function parseMoisRaw(html: string, _page = 1): BoardRow[] {
  const out: BoardRow[] = [];
  const seen = new Set<string>();
  for (const tr of parseHtml(html).querySelectorAll("table.table_style1 tbody tr")) {
    const a = tr.querySelector("td.l a");
    const href = a?.getAttribute("href") ?? "";
    const tds = tr.querySelectorAll("td");
    pushRow(out, seen, {
      title: titleOf(a),
      detailUrl: moisDetailUrl(href),
      dateText: publicationYmd(tds[4]?.text ?? ""),
      agency: "행정안전부",
    });
  }
  return out;
}

export function parseMoisList(html: string, page = 1): BoardRow[] {
  return parseMoisRaw(html, page).filter((r) => !isMinistryDropTitle(r.title));
}

export function parseMpvaRaw(html: string, _page = 1): BoardRow[] {
  const out: BoardRow[] = [];
  const seen = new Set<string>();
  for (const tr of parseHtml(html).querySelectorAll("table.p-table tbody tr")) {
    const a = tr.querySelector("td.p-subject a");
    const href = a?.getAttribute("href") ?? "";
    const tds = tr.querySelectorAll("td");
    pushRow(out, seen, {
      title: titleOf(a),
      detailUrl: mpvaDetailUrl(href),
      dateText: publicationYmd(tds[tds.length - 1]?.text ?? ""),
      agency: "국가보훈부",
    });
  }
  return out;
}

export function parseMpvaList(html: string, page = 1): BoardRow[] {
  return parseMpvaRaw(html, page).filter((r) => !isMinistryDropTitle(r.title));
}

export function parseMndRaw(html: string, _page = 1): BoardRow[] {
  const out: BoardRow[] = [];
  const seen = new Set<string>();
  for (const tr of parseHtml(html).querySelectorAll("table.board-table tbody tr")) {
    const a = tr.querySelector("td.td-title a");
    const href = a?.getAttribute("href") ?? "";
    pushRow(out, seen, {
      title: titleOf(a),
      detailUrl: mndDetailUrl(href),
      dateText: publicationYmd(tr.querySelector("td.td-date")?.text ?? ""),
      agency: "국방부",
    });
  }
  return out;
}

export function parseMndList(html: string, page = 1): BoardRow[] {
  return parseMndRaw(html, page).filter((r) => !isMinistryDropTitle(r.title));
}

const MOIS_FIELDS = {
  title: { selector: "td.l a" },
  detailUrl: { selector: "td.l a", attr: "href" },
  date: { selector: "td:nth-child(5)" },
};

export const moisConfig: MinistryBoardConfig = {
  id: "mois",
  label: "행정안전부",
  agency: "행정안전부",
  region: "전국",
  baseUrl: `${MOIS_BASE}/`,
  charset: "utf-8",
  list: {
    url: (p) => `${MOIS_BASE}${MOIS_LIST}?bbsId=${MOIS_BBS}&pageIndex=${p}`,
    maxPages: 5,
    rowSelector: "table.table_style1 tbody tr",
    fields: MOIS_FIELDS,
  },
  customParse: parseMoisList,
  validationParse: parseMoisRaw,
  skipHeuristic: true,
  expectMinRows: 1,
  dropUrlParams: ["pageIndex"],
  detailContentSelector: ".desc",
  attachmentsScopeSelector: "dl.download",
  detailAttachments: ({ html }) => {
    const out = [];
    const seen = new Set<string>();
    for (const a of parseHtml(html).querySelectorAll("a[href]")) {
      const u = parseHref(a.getAttribute("href") ?? "", MOIS_BASE);
      if (!u || u.origin !== MOIS_BASE || u.pathname !== "/cmm/fms/FileDown.do") continue;
      const id = u.searchParams.get("atchFileId") ?? "";
      const sn = u.searchParams.get("fileSn") ?? "";
      if (!/^FILE_[A-Za-z0-9_]+$/.test(id) || !/^\d+$/.test(sn)) continue;
      const url = `${MOIS_BASE}/cmm/fms/FileDown.do?atchFileId=${id}&fileSn=${sn}`;
      if (seen.has(url)) continue;
      seen.add(url);
      const name = clean(a.text).replace(/\s*\[\s*[\d.]+\s*[KMG]?B\s*\]\s*$/i, "").trim();
      out.push({ name, url, kind: attachmentKindOf(name, url) });
    }
    return out;
  },
};

export const mpvaConfig: MinistryBoardConfig = {
  id: "mpva",
  label: "국가보훈부",
  agency: "국가보훈부",
  region: "전국",
  baseUrl: MPVA_ORIGIN,
  charset: "utf-8",
  list: {
    url: (p) => `${MPVA_BASE}${MPVA_LIST}?bbsNo=${MPVA_BBS}&key=${MPVA_KEY}&pageIndex=${p}`,
    maxPages: 5,
    rowSelector: "table.p-table tbody tr",
    fields: {
      title: { selector: "td.p-subject a" },
      detailUrl: { selector: "td.p-subject a", attr: "href" },
      date: { selector: "td:last-child" },
    },
  },
  customParse: parseMpvaList,
  validationParse: parseMpvaRaw,
  skipHeuristic: true,
  expectMinRows: 1,
  dropUrlParams: ["pageIndex", "searchCtgry", "searchCnd", "searchKrwd", "integrDeptCode"],
  detailContentSelector: ".p-table__content",
  attachmentsScopeSelector: ".p-attach",
};

export const mndConfig: MinistryBoardConfig = {
  id: "mnd",
  label: "국방부",
  agency: "국방부",
  region: "전국",
  baseUrl: `${MND_BASE}/`,
  charset: "utf-8",
  list: {
    url: (p) => {
      const t = mndTargetOf(p);
      return `${MND_BASE}/bbs/mnd/${t.boardId}/artclList.do?page=${t.page}`;
    },
    maxPages: 6,
    rowSelector: "table.board-table tbody tr",
    fields: {
      title: { selector: "td.td-title a" },
      detailUrl: { selector: "td.td-title a", attr: "href" },
      date: { selector: "td.td-date" },
    },
  },
  customParse: parseMndList,
  validationParse: parseMndRaw,
  skipHeuristic: true,
  expectMinRows: 1,
  emptyStreakStop: 6,
  dropUrlParams: ["page"],
  // `.viewCont` 안에 머리글(작성자·작성일·조회수)이 있어 본문은 `.txt` 만 집는다.
  detailContentSelector: ".viewCont .txt",
  attachmentsScopeSelector: ".attachment",
};
