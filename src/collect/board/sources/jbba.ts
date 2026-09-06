import { parseHtml } from "../html";
import type { BoardConfig, BoardRow } from "../types";

/** 전북경제통상진흥원 목록 — 날짜 칸만 2자리 연도를 4자리로 바꾼다. */
export function parseJbbaList(html: string, cfg: BoardConfig): BoardRow[] {
  const root = parseHtml(html);
  const rows = root.querySelectorAll("table tbody tr");
  const out: BoardRow[] = [];
  for (const row of rows) {
    if (!row.querySelector("td.td_subject")) continue;
    const titleA = row.querySelector("td.td_subject a");
    if (!titleA) continue;
    const title = titleA.text.trim();
    const href = (titleA.getAttribute("href") ?? "").trim();
    if (!title || !href) continue;
    const tds = row.querySelectorAll("td");
    const rawDate = (tds[2]?.text ?? "").trim();
    const dateText = rawDate.replace(/\b(\d{2})\.(\d{2})\.(\d{2})\b/g, "20$1.$2.$3");
    out.push({
      title,
      detailUrl: href,
      dateText,
      category: "",
      agency: cfg.agency,
    });
  }
  return out;
}

export const jbbaConfig: BoardConfig = {
  id: "jbba",
  label: "전북경제통상진흥원",
  agency: "전북경제통상진흥원",
  region: "전북",
  baseUrl: "https://www.jbba.kr/",
  charset: "utf-8",
  list: {
    url: (p) => `https://www.jbba.kr/bbs/board.php?bo_table=sub01_09&page=${p}`,
    maxPages: 10,
    rowSelector: "table tbody tr",
    fields: {
      title: { selector: "td.td_subject a" },
      detailUrl: { selector: "td.td_subject a", attr: "href" },
      date: { selector: "td:nth-child(3)" },
    },
  },
  customParse: (html) => parseJbbaList(html, jbbaConfig),
  // 본문(#bo_v_con)이 빈 공고가 있다 — 지원대상·일정은 스킨의 정보 표(.tbl_frs01)에 있다(적대 리뷰).
  detailContentSelector: ".tbl_frs01, #bo_v_con",
  expectMinRows: 5,
};
