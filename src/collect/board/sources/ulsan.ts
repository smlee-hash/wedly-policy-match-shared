import { parseHtml } from "../html";
import type { BoardConfig, BoardRow } from "../types";

const KOR_DATE = /(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/g;

function padDate(y: string, m: string, d: string): string {
  return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

/** 울산 기업지원플랫폼 목록 — href 가 JS 해쉬라 onclick id 로 상세 GET 주소를 조립한다. */
export function parseUlsanList(html: string, _page: number): BoardRow[] {
  const root = parseHtml(html);
  const rows = root.querySelectorAll("table.media-table tbody tr");
  const out: BoardRow[] = [];
  for (const row of rows) {
    const titleA = row.querySelector('div.hidden-xs a[href="#gonggoView"]');
    if (!titleA) continue;
    const title = titleA.text.trim();
    const onclick = titleA.getAttribute("onclick") ?? "";
    const idm = onclick.match(/goViewGonggo\(\s*['"]?(\d+)['"]?\s*\)/);
    if (!idm) continue;
    const tds = row.querySelectorAll("td");
    const category = (tds[1]?.text ?? "").trim() || undefined;
    const agency = tds[6]?.querySelector("span")?.text.trim() || undefined;
    const dates: string[] = [];
    for (const m of row.text.matchAll(KOR_DATE)) {
      dates.push(padDate(m[1], m[2], m[3]));
    }
    let dateText = "";
    if (dates.length >= 2) dateText = `${dates[0]} ~ ${dates[1]}`;
    else if (dates.length === 1) dateText = dates[0];
    out.push({
      title,
      detailUrl: `https://platform.utp.or.kr/com/biz_gonggo_detail.php?cmd=detail&rq_gonggopgrm=${idm[1]}`,
      dateText,
      category,
      agency,
    });
  }
  return out;
}

export const ulsan: BoardConfig = {
  id: "ulsan",
  label: "울산 기업지원플랫폼",
  agency: "울산테크노파크",
  region: "울산",
  baseUrl: "https://platform.utp.or.kr/",
  charset: "utf-8",
  list: {
    url: (p) => `https://platform.utp.or.kr/com/biz_gonggo_all.php?page=${p}`,
    maxPages: 10,
    rowSelector: "table.media-table tbody tr",
    fields: {
      title: { selector: "div.hidden-xs a[href='#gonggoView']" },
      detailUrl: { selector: "div.hidden-xs a[href='#gonggoView']", attr: "onclick", regex: "goViewGonggo\\(\\s*['\"]?(\\d+)['\"]?\\s*\\)" },
      date: {},
    },
  },
  customParse: parseUlsanList,
  detailContentSelector: "table.table-bordered2",
  expectMinRows: 5,
};
