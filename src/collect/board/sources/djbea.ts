import { parseHtml, type HTMLElement } from "../html";
import type { BoardConfig, BoardRow } from "../types";

/** 「2026-10-01 10시 ~ 2026-10-09 23시」처럼 시각이 붙으면 범위 해석이 깨진다 — 날짜만 추린다(첫 수집 실측). */
function ymdOnly(span: string): string {
  const ymd = span.match(/\d{4}-\d{2}-\d{2}/g);
  if (!ymd || ymd.length === 0) return "";
  return ymd.length >= 2 ? `${ymd[0]} ~ ${ymd[1]}` : ymd[0];
}

function periodFromInfo(row: HTMLElement): string {
  let fallback = "";
  for (const li of row.querySelectorAll("ul.info li")) {
    const label = (li.querySelector("strong")?.text ?? "").trim();
    const span = (li.querySelector("span")?.text ?? "").trim();
    if (label === "접수기간") return ymdOnly(span);
    if (label === "공고기간" && !fallback) fallback = ymdOnly(span);
  }
  return fallback;
}

/** 대전일자리경제진흥원 목록 — data-id 로 상세 GET 주소를 조립한다. */
export function parseDjbeaList(html: string, cfg: BoardConfig): BoardRow[] {
  const root = parseHtml(html);
  const rows = root.querySelectorAll("div.board_list ul li");
  const out: BoardRow[] = [];
  for (const row of rows) {
    const link = row.querySelector("a.lnk_pbnc_view");
    if (!link) continue;
    const id = (link.getAttribute("data-id") ?? "").trim();
    if (!id) continue;
    const title = (link.querySelector("strong")?.text ?? link.text).trim();
    if (!title) continue;
    const category = (row.querySelector("strong.label")?.text ?? "").trim();
    out.push({
      title,
      detailUrl: `https://www.djbea.or.kr/mps/bizTskPbnc/view?tsk_pbnc_id=${id}&menuKey=TOfnnvp207`,
      dateText: periodFromInfo(row),
      category,
      agency: cfg.agency,
    });
  }
  return out;
}

export const djbeaConfig: BoardConfig = {
  id: "djbea",
  label: "대전일자리경제진흥원",
  agency: "대전일자리경제진흥원",
  region: "대전",
  baseUrl: "https://www.djbea.or.kr/",
  charset: "utf-8",
  list: {
    // 게시판이 탭 6개(01 일자리~06 기타)로 갈려 있고 「전체」 탭이 없다(schTab 빈 값 = 02 와 동일 — 실측).
    // 그래서 쪽 번호를 탭 번호로 쓴다: p번째 「쪽」 = 0p 탭의 첫 쪽. 탭마다 누적 공고 수십 쪽이라
    // 빈 탭으로 인한 조기 중단은 실측상 없고, 새 공고는 자기 탭 첫 쪽에 올라온다(적대 리뷰 반영).
    url: (p) =>
      `https://www.djbea.or.kr/mps/bizTskPbnc?menuKey=TOfnnvp207&menuId=MENU002040101000000&pageNum=1&schTab=0${p}`,
    maxPages: 10,
    rowSelector: "div.board_list ul li",
    fields: {
      title: { selector: "a.lnk_pbnc_view strong" },
      detailUrl: { selector: "a.lnk_pbnc_view", attr: "data-id" },
      date: {},
      category: { selector: "strong.label" },
    },
  },
  customParse: (html) => parseDjbeaList(html, djbeaConfig),
  detailContentSelector: "div.board_view",
  expectMinRows: 5,
};
