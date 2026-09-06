import { parseHtml } from "../html";
import type { BoardConfig, BoardRow } from "../types";

const GO_PAGE = /goPage\(\s*'S'\s*,\s*null\s*,\s*'(\/biz\/applyInfo\/\d+)'\s*\)/;
const YMD = /(\d{4}-\d{2}-\d{2})/;

function firstYmd(text: string): string {
  const m = text.match(YMD);
  return m ? m[1] : "";
}

/** 경남테크노파크 목록 — PC 표(#gridData)만 읽고 모바일 li 는 버린다. */
export function parseGyeongnamList(html: string, cfg: BoardConfig): BoardRow[] {
  const root = parseHtml(html);
  const rows = root.querySelectorAll("#gridData tr.table-contents");
  const out: BoardRow[] = [];
  for (const row of rows) {
    const titleA = row.querySelector("a.color-fix");
    if (!titleA) continue;
    const title = titleA.text.trim();
    const onclick = titleA.getAttribute("onclick") ?? "";
    const pathm = onclick.match(GO_PAGE);
    if (!title || !pathm) continue;
    const tds = row.querySelectorAll("td");
    const start = firstYmd(tds[5]?.text ?? "");
    const end = firstYmd(tds[6]?.text ?? "");
    const dateText = start && end ? `${start} ~ ${end}` : start || end;
    out.push({
      title,
      detailUrl: `https://www.gntp.or.kr${pathm[1]}`,
      dateText,
      category: "",
      // 3번째 칸은 기관명이 아니라 본부/팀명이라 검색을 깨뜨린다(적대 리뷰) — 기관명 고정.
      agency: cfg.agency,
    });
  }
  return out;
}

export const tpGyeongnamConfig: BoardConfig = {
  id: "tp-gyeongnam",
  label: "경남테크노파크",
  agency: "경남테크노파크",
  region: "경남",
  baseUrl: "https://www.gntp.or.kr/",
  charset: "utf-8",
  list: {
    url: (p) => `https://www.gntp.or.kr/biz/apply?pageIndex=${p}`,
    maxPages: 10,
    rowSelector: "#gridData tr.table-contents",
    fields: {
      title: { selector: "a.color-fix" },
      detailUrl: { selector: "a.color-fix", attr: "onclick", regex: "goPage\\(\\s*'S'\\s*,\\s*null\\s*,\\s*'(\\/biz\\/applyInfo\\/\\d+)'\\s*\\)" },
      date: {},
    },
  },
  customParse: (html) => parseGyeongnamList(html, tpGyeongnamConfig),
  // 안내문만 있는 detail-contents 밖 「사업정보 표(de-biz-table)」에 지원내용·문의처가 있다(적대 리뷰).
  detailContentSelector: "div.detail-contents, table.de-biz-table",
  expectMinRows: 5,
};
