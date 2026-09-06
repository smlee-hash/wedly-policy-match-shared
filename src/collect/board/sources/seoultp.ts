// 2026-09-03 상한 올림: 감시 장치 실측 상한 밖 1건(사장님 누락 0 지시)
import { parseHtml } from "../html";
import { deadlineFromTitle } from "../title-deadline";
import type { BoardConfig, BoardRow } from "../types";

const BOARD_NO = /goBoardView\('\/user\/nd19746\.do'\s*,\s*'View'\s*,\s*'(\d+)'\)/;
const YMD_DOTS = /\b(20\d{2})\.(\d{2})\.(\d{2})\b/;

/** 서울TP 기업지원공고 — 등록일 개시형 + 제목의 마감 표기가 있으면 종료일로 완성(적대 리뷰·독립 검사 4차). */
export function parseSeoultpList(html: string): BoardRow[] {
  const out: BoardRow[] = [];
  for (const tr of parseHtml(html).querySelectorAll("table.board-list tbody tr")) {
    const a = tr.querySelector("td.left a");
    const m = (a?.getAttribute("href") ?? "").match(BOARD_NO);
    const title = (a?.text ?? "").replace(/\s+/g, " ").trim();
    if (!m || !title) continue;
    const d = tr.querySelectorAll("td").map((t) => t.text).join(" ").match(YMD_DOTS);
    const reg = d ? `${d[1]}-${d[2]}-${d[3]}` : "";
    const end = deadlineFromTitle(title, reg);
    out.push({
      title,
      detailUrl: `https://www.seoultp.or.kr/user/nd19746.do?View&boardNo=${m[1]}`,
      dateText: reg ? `${reg} ~${end ? ` ${end}` : ""}` : "",
    });
  }
  return out;
}

export const seoultpConfig: BoardConfig = {
  id: "seoultp",
  label: "서울테크노파크",
  agency: "서울테크노파크",
  region: "서울",
  baseUrl: "https://www.seoultp.or.kr/",
  charset: "utf-8",
  list: {
    url: (p) => `https://www.seoultp.or.kr/user/nd19746.do?page=${p}`,
    maxPages: 15,
    rowSelector: "table.board-list tbody tr",
    fields: {
      title: { selector: "td.left a" },
      detailUrl: { selector: "td.left a", attr: "href" },
      date: {},
    },
  },
  customParse: (html) => parseSeoultpList(html),
  detailContentSelector: "table.board-write",
  // 본문이 이미지 위주라 첨부(hwp)가 실질 원문 — onclick 수확 패턴(STP_DOWN)이 detail-fill 에 있다.
  expectMinRows: 5,
};
