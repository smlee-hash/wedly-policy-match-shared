import type { BoardConfig } from "../types";

export const tpDaejeon: BoardConfig = {
  id: "tp-daejeon",
  label: "대전테크노파크",
  agency: "대전테크노파크",
  region: "대전",
  baseUrl: "https://www.djtp.or.kr/",
  charset: "utf-8",
  list: {
    url: (p) => `https://www.djtp.or.kr/board.es?mid=a20102000000&bid=0102&nPage=${p}`,
    maxPages: 10,
    rowSelector: "#board-list tbody tr",
    fields: {
      // 고정본: 공지 행만 p.subject a. 일반 행은 td[aria-label=Title] a (p.subject 없음).
      title: { selector: "td[aria-label='Title'] a, td[aria-label='제목'] a" },
      detailUrl: { selector: "td[aria-label='Title'] a, td[aria-label='제목'] a", attr: "href" },
      date: { regex: "(\\d{4}[./-]\\d{1,2}[./-]\\d{1,2}\\s*~\\s*\\d{4}[./-]\\d{1,2}[./-]\\d{1,2})" },
      category: { selector: "td:nth-child(3)" },
    },
  },
  detailContentSelector: "#board-view",
  dropUrlParams: ["nPage", "tag"],
  expectMinRows: 5,
};
