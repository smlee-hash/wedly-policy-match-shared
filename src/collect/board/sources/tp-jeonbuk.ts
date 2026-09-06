import type { BoardConfig } from "../types";

export const tpJeonbuk: BoardConfig = {
  id: "tp-jeonbuk",
  label: "전북테크노파크",
  agency: "전북테크노파크",
  region: "전북",
  baseUrl: "https://www.jbtp.or.kr/",
  charset: "utf-8",
  list: {
    url: (p) => `https://www.jbtp.or.kr/board/list.jbtp?boardId=BBS_0000006&menuCd=DOM_000000102001000000&paging=ok&pageNo=${p}`,
    maxPages: 10,
    rowSelector: "table.bbs_list_t tbody tr",
    fields: {
      title: { selector: "td.txt_left a" },
      detailUrl: { selector: "td.txt_left a", attr: "href" },
      date: { selector: "td.t_date" },
    },
  },
  detailContentSelector: "div.bbs_con",
  requiresProxy: true,
  expectMinRows: 5,
};
