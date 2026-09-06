import { parseHtml } from "../html";
import type { BoardConfig, BoardRow } from "../types";

const FN_DETAIL = /fn_detail\(\s*'(\d+)'\s*,\s*'(\d+)'\s*\)/;

/** 경북테크노파크 목록 — onclick fn_detail nttNo 로 GET 상세 주소를 조립한다. */
export function parseGyeongbukList(html: string, cfg: BoardConfig): BoardRow[] {
  const root = parseHtml(html);
  const rows = root.querySelectorAll("table.tablelist tbody tr");
  const out: BoardRow[] = [];
  for (const row of rows) {
    const titleA = row.querySelector("td.title a");
    if (!titleA) continue;
    const title = titleA.text.trim();
    const onclick = titleA.getAttribute("onclick") ?? "";
    const idm = onclick.match(FN_DETAIL);
    if (!title || !idm) continue;
    const tds = row.querySelectorAll("td");
    const dateText = (tds[3]?.text ?? "").trim();
    out.push({
      title,
      detailUrl: `https://www.gbtp.or.kr/user/boardDetail.do?bbsId=BBSMSTR_000000000021&nttNo=${idm[1]}`,
      dateText,
      category: "",
      agency: cfg.agency,
    });
  }
  return out;
}

export const tpGyeongbukConfig: BoardConfig = {
  id: "tp-gyeongbuk",
  label: "경북테크노파크",
  agency: "경북테크노파크",
  region: "경북",
  baseUrl: "https://www.gbtp.or.kr/",
  charset: "utf-8",
  list: {
    url: (p) => `https://www.gbtp.or.kr/user/board.do?bbsId=BBSMSTR_000000000021&pageIndex=${p}`,
    maxPages: 10,
    rowSelector: "table.tablelist tbody tr",
    fields: {
      title: { selector: "td.title a" },
      detailUrl: { selector: "td.title a", attr: "onclick", regex: "fn_detail\\(\\s*'(\\d+)'\\s*,\\s*'(\\d+)'\\s*\\)" },
      date: { selector: "td:nth-child(4)" },
    },
  },
  customParse: (html) => parseGyeongbukList(html, tpGyeongbukConfig),
  detailContentSelector: "table.tableview",
  expectMinRows: 5,
};
