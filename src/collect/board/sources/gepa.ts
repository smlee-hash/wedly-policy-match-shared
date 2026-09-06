// 2026-09-03 상한 올림: 감시 장치 실측 상한 밖 3건(사장님 누락 0 지시)
import { decodeHtmlEntities, parseHtml } from "../html";
import type { BoardConfig, BoardRow } from "../types";

const VID = /[?&]vid=(\d+)/;
const RANGE = /20\d{2}-\d{2}-\d{2}\s*~\s*20\d{2}-\d{2}-\d{2}/;
// 구직자 대상 행사는 기업 진단에 무관(적대 리뷰). 「채용 지원사업」(기업 대상)을 지우지 않게 좁게 잡는다.
const DROP = /채용행사|채용박람회|구직자/;

/** 경북경제진흥원(워드프레스 MangBoard 갤러리) — title 속성이 제목, .gallery-date 가 정확한 신청기간. */
export function parseGepaList(html: string): BoardRow[] {
  const titles = new Map<string, string>();
  const dates = new Map<string, string>();
  for (const a of parseHtml(html).querySelectorAll('a[href*="vid="]')) {
    const href = decodeHtmlEntities(a.getAttribute("href") ?? "");
    const m = href.match(VID);
    if (!m) continue;
    const t = (a.getAttribute("title") ?? "").replace(/\s+/g, " ").trim();
    if (t && !titles.has(m[1])) titles.set(m[1], t);
    const dm = (a.text ?? "").match(RANGE);
    if (dm && !dates.has(m[1])) dates.set(m[1], dm[0].replace(/\s+/g, "").replace("~", " ~ "));
  }
  const out: BoardRow[] = [];
  for (const [vid, title] of titles) {
    if (DROP.test(title)) continue;
    out.push({
      title,
      detailUrl: `https://www.gepa.kr/?page_id=36&stype1=type1&vid=${vid}`,
      dateText: dates.get(vid) ?? "",
    });
  }
  return out;
}

export const gepaConfig: BoardConfig = {
  id: "gepa",
  label: "경상북도경제진흥원",
  agency: "경상북도경제진흥원",
  region: "경북",
  baseUrl: "https://www.gepa.kr/",
  charset: "utf-8",
  list: {
    url: (p) => `https://www.gepa.kr/?page_id=36&mode=list&board_page=${p}&stype1=type1`,
    // 2026-09-02 30쪽 탐침: 상한 밖 살아 있는 2026년 지원사업 11건
    maxPages: 35,
    rowSelector: 'a[href*="vid="]',
    fields: {
      title: { attr: "title" },
      detailUrl: { attr: "href" },
      date: {},
    },
  },
  customParse: (html) => parseGepaList(html),
  detailContentSelector: "#madang01_board",
  expectMinRows: 5,
};
