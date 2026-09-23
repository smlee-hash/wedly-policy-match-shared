// 2026-09-03 상한 올림: 감시 장치 실측 상한 밖 60건(사장님 누락 0 지시)
import { parseHtml } from "../html";
import type { BoardConfig, BoardRow } from "../types";

// 잡탕 게시판(함정12): 지원사업이 아닌 글만 뺀다. 긴 대안 먼저 규칙과 무관(고정 낱말).
// ★2026-09-23 — 예전엔 「모집·공모·지원사업·신청·공고」가 있어야만 남겼다. 그랬더니 「푸드트레일러
//  임대지원 안내」·「찾아가는 현장보증 상담회」가 빠져 1쪽이 0행이 됐고, 회차 검증이 게시판 전체를
//  버렸다(사장님 기준: 값어치 판단으로 빼지 말고 걸러내기는 매칭에서). 「카드뉴스」 같은 형식 표시는
//  모집 공고에도 붙으므로 거르개에 넣지 않는다(리뷰 review-0f08ca4d).
const DROP =
  /행정예고|채용|입찰|이전\s*안내|CCTV|설문|청렴|청탁|휴무|유공|포상|개인정보|고객만족도|비엔날레/;
const YMD_DOTS = /\b(20\d{2})\.(\d{2})\.(\d{2})\b/;

export function parseGcgfList(html: string): BoardRow[] {
  return parseGcgfRows(html, true);
}

/** 거르개 전 원본 행 — 검증 관문용. 잡탕 게시판이라 1쪽이 전부 비지원 글이어도 서식은 멀쩡할 수 있다. */
export function parseGcgfRaw(html: string): BoardRow[] {
  return parseGcgfRows(html, false);
}

function parseGcgfRows(html: string, filter: boolean): BoardRow[] {
  const out: BoardRow[] = [];
  for (const tr of parseHtml(html).querySelectorAll("table tbody tr")) {
    const a = tr.querySelector("td.bbs_tit a.pstInfoBtn");
    const id = (a?.getAttribute("data-id") ?? "").trim();
    const title = (a?.text ?? "").replace(/\s+/g, " ").trim();
    if (!id || !title) continue;
    if (filter && DROP.test(title)) continue;
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
  validationParse: (html) => parseGcgfRaw(html),
  detailContentSelector: ".bbs_ViewA",
  // 검증은 거르개 전 행으로 한다(한 쪽 10줄) — 잡탕이라 거르개 뒤 0행인 쪽도 정상이다.
  expectMinRows: 5,
};
