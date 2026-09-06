import type { BoardConfig } from "../types";

export const tpBusan: BoardConfig = {
  id: "tp-busan",
  label: "부산테크노파크",
  agency: "부산테크노파크",
  region: "부산",
  baseUrl: "https://www.btp.or.kr/kor/CMS/Board/Board.do",
  charset: "utf-8",
  list: {
    url: (p) => `https://www.btp.or.kr/kor/CMS/Board/Board.do?mCode=MN013&page=${p}`,
    maxPages: 10,
    rowSelector: "table.bdListTbl tbody tr",
    fields: {
      title: { selector: "td.subject a .subjectWr" },
      detailUrl: { selector: "td.subject a", attr: "href" },
      date: { selector: "td.period" },
    },
  },
  detailContentSelector: "div.board-biz-view",
  expectMinRows: 5,
};
