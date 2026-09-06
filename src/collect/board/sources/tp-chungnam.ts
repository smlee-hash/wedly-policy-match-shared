// 2026-09-03 상한 올림: 감시 장치 실측 상한 밖 4건(사장님 누락 0 지시)
import type { BoardConfig } from "../types";

export const tpChungnam: BoardConfig = {
  id: "tp-chungnam",
  label: "충남테크노파크",
  agency: "충남테크노파크",
  region: "충남",
  baseUrl: "https://ctp.or.kr/business/data.do",
  charset: "utf-8",
  list: {
    url: (p) => `https://ctp.or.kr/business/data.do?pn=${p}`,
    // 2026-09-02 30쪽 탐침: 상한 밖 살아 있는 2026년 지원사업 10건 — 20쪽으로 연다
    maxPages: 25,
    rowSelector: "table.w-100 tbody tr",
    fields: {
      title: { selector: "td.text-left a" },
      detailUrl: { selector: "td.text-left a", attr: "href" },
      date: { selector: "span.cod1" },
    },
  },
  detailContentSelector: "div.bddetail",
  expectMinRows: 5,
};
