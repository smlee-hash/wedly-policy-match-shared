import { parseHtml } from "../html";
import { deadlineFromTitle } from "../title-deadline";
import type { BoardConfig, BoardRow } from "../types";

const LINK_ID = /[?&]linkId=(\d+)/;
const YMD = /\b(20\d{2}-\d{2}-\d{2})\b/;

/** 보건산업진흥원 사업공고 — 잡동사니 쿼리를 linkId 로 정규화, 공지 중복은 linkId 로 제거(적대 리뷰). */
export function parseKhidiList(html: string): BoardRow[] {
  const out: BoardRow[] = [];
  const seen = new Set<string>();
  for (const tr of parseHtml(html).querySelectorAll("table tbody tr")) {
    const a = tr.querySelector('td.ellipsis a[href*="/board/view"]');
    const m = (a?.getAttribute("href") ?? "").match(LINK_ID);
    const title = ((a?.getAttribute("title") || a?.text) ?? "").replace(/\s+/g, " ").trim();
    if (!m || !title) continue;
    if (seen.has(m[1])) continue;
    seen.add(m[1]);
    const d = tr.querySelectorAll("td").map((t) => t.text.trim()).join(" ").match(YMD);
    const end = d ? deadlineFromTitle(title, d[1]) : "";
    out.push({
      title,
      detailUrl: `https://www.khidi.or.kr/board/view?linkId=${m[1]}&menuId=MENU01108`,
      dateText: d ? `${d[1]} ~${end ? ` ${end}` : ""}` : "",
    });
  }
  return out;
}

export const khidiConfig: BoardConfig = {
  id: "khidi",
  label: "한국보건산업진흥원",
  agency: "한국보건산업진흥원",
  region: "전국",
  baseUrl: "https://www.khidi.or.kr/",
  charset: "utf-8",
  list: {
    url: (p) => `https://www.khidi.or.kr/board?menuId=MENU01108&pageNum=${p}`,
    maxPages: 10,
    rowSelector: "table tbody tr",
    fields: {
      title: { selector: "td.ellipsis a" },
      detailUrl: { selector: "td.ellipsis a", attr: "href" },
      date: {},
    },
  },
  customParse: (html) => parseKhidiList(html),
  detailContentSelector: "#detail_content",
  expectMinRows: 5,
};
