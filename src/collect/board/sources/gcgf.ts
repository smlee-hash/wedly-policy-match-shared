// 2026-09-03 상한 올림: 감시 장치 실측 상한 밖 60건(사장님 누락 0 지시)
import { parseHtml } from "../html";
import type { BoardConfig, BoardRow } from "../types";

// 잡탕 게시판(함정12): 기업지원 성격만 남긴다. 긴 대안 먼저 규칙과 무관(고정 낱말).
const KEEP = /모집|공모|지원사업|신청|공고/;
const DROP = /행정예고|채용|입찰|이전\s*안내|CCTV|설문|청렴|휴무|유공|포상|개인정보/;
const YMD_DOTS = /\b(20\d{2})\.(\d{2})\.(\d{2})\b/;

export function parseGcgfList(html: string): BoardRow[] {
  const out: BoardRow[] = [];
  for (const tr of parseHtml(html).querySelectorAll("table tbody tr")) {
    const a = tr.querySelector("td.bbs_tit a.pstInfoBtn");
    const id = (a?.getAttribute("data-id") ?? "").trim();
    const title = (a?.text ?? "").replace(/\s+/g, " ").trim();
    if (!id || !title) continue;
    if (!KEEP.test(title) || DROP.test(title)) continue;
    const d = tr.querySelectorAll("td").map((t) => t.text.trim()).join(" ").match(YMD_DOTS);
    out.push({
      title,
      detailUrl: `https://www.gcgf.or.kr/gcgf/pt/pst/selectPstInfo.do?mi=1024&bbsId=1002&pstSn=${id}`,
      dateText: d ? `${d[1]}-${d[2]}-${d[3]} ~` : "",
    });
  }
  return out;
}

export const gcgfConfig: BoardConfig = {
  id: "gcgf",
  label: "경기신용보증재단",
  agency: "경기신용보증재단",
  region: "경기",
  baseUrl: "https://www.gcgf.or.kr/",
  charset: "utf-8",
  list: {
    url: (p) => `https://www.gcgf.or.kr/gcgf/pt/pst/selectPstList.do?mi=1024&bbsId=1002&currPage=${p}`,
    maxPages: 25,
    rowSelector: "table tbody tr",
    fields: {
      title: { selector: "td.bbs_tit a" },
      detailUrl: { selector: "td.bbs_tit a", attr: "data-id" },
      date: {},
    },
  },
  customParse: (html) => parseGcgfList(html),
  detailContentSelector: ".bbs_ViewA",
  // 선별 뒤 1쪽에 몇 건 안 남을 수 있다(잡탕) — 최소 행 수는 낮게.
  expectMinRows: 1,
};
