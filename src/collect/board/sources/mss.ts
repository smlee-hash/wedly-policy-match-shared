// 2026-09-03 상한 올림: 감시 장치 실측 상한 밖 65건(사장님 누락 0 지시)
import { parseHtml } from "../html";
import type { BoardConfig, BoardRow } from "../types";

const DO_VIEW = /doBbsFView\(\s*'310'\s*,\s*'(\d+)'/;
// 행 안 모바일 정의 목록에 「신청기간 2026-08-25 ~ 2026-09-15」가 실려 있다(적대 리뷰가 고정본에서 발견).
const RANGE = /(20\d{2}-\d{2}-\d{2})\s*~\s*(20\d{2}-\d{2}-\d{2})/;

/** 중기부 사업공고 목록 — onclick 2번째 인자로 GET 상세 주소를 조립한다. */
export function parseMssList(html: string, cfg: BoardConfig): BoardRow[] {
  const root = parseHtml(html);
  const out: BoardRow[] = [];
  for (const tr of root.querySelectorAll("tr[onclick]")) {
    const onclick = tr.getAttribute("onclick") ?? "";
    if (!onclick.includes("doBbsFView('310',")) continue;
    const idm = onclick.match(DO_VIEW);
    if (!idm) continue;
    const title =
      (tr.getAttribute("title") ?? "").trim() ||
      (tr.querySelector("td.subject a")?.text ?? "").trim();
    if (!title) continue;
    // 행 전체 글자에서 신청기간 범위를 뽑는다. 없으면 빈 값(등록일 단독을 넣으면 마감일로 오인).
    const rm = tr.text.match(RANGE);
    out.push({
      title,
      detailUrl: `https://www.mss.go.kr/site/smba/ex/bbs/View.do?cbIdx=310&bcIdx=${idm[1]}`,
      dateText: rm ? `${rm[1]} ~ ${rm[2]}` : "",
      category: "",
      agency: cfg.agency,
    });
  }
  return out;
}

export const mssConfig: BoardConfig = {
  id: "mss",
  label: "중소벤처기업부",
  agency: "중소벤처기업부",
  region: "",
  baseUrl: "https://www.mss.go.kr/",
  charset: "utf-8",
  list: {
    url: (p) => `https://www.mss.go.kr/site/smba/ex/bbs/List.do?cbIdx=310&pageIndex=${p}`,
    // 2026-09-02 30쪽 탐침: 상한 밖 살아 있는 2026년 지원사업 65건(정책자금 융자·자율형공장)
    maxPages: 45,
    rowSelector: "tr[onclick]",
    fields: {
      title: { attr: "title" },
      detailUrl: { attr: "onclick", regex: "doBbsFView\\(\\s*'310'\\s*,\\s*'(\\d+)'" },
      date: {},
    },
  },
  customParse: (html) => parseMssList(html, mssConfig),
  // 고정본 실측: 본문 클래스는 view_cont 가 아니라 view_contents(적대 리뷰).
  detailContentSelector: ".view_contents",
  expectMinRows: 5,
};
