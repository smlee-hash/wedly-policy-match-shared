import { absolutize, parseHtml, type HTMLElement } from "../html";
import type { BoardConfig, BoardRow } from "../types";

/**
 * 고양산업진흥원 지원사업 공고.
 *
 * 왜 연결했나(2026-09-05 실측): 목록 GET `/apply/01.php?cate=1&page=n`, 한 쪽 10행,
 * 총 202건. 1·2쪽 겹침 0. 접수일정을 목록에서 시작·마감 둘 다 준다.
 * 상세는 같은 호스트 `01_view.php?no=…`. DROP 후보 없음(실측 20건 전부 지원사업·모집).
 *
 * 구조: `table.board-list > tbody > tr`. 제목 `td.subject a strong.txt_t` —
 * 글자 앞에 디데이/`완료` 배지 span 이 붙는다. 날짜는 행 안 `td:nth-child(3)` 만
 * (`tr > td:nth-child(3)` 는 행 노드 기준 0건).
 */
const BASE = "https://www.gipa.or.kr";
const LIST = "/apply/01.php";
const APPLY = `${BASE}/apply/`;
const YMD = /(20\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})/g;
const DDAY_PREFIX = /^\s*D-(?:\d+|day)\s*/i;

function titleOf(strong: HTMLElement): string {
  strong.querySelectorAll("span").forEach((s) => s.remove());
  return (strong.text ?? "").replace(DDAY_PREFIX, "").replace(/\s+/g, " ").trim();
}

export function parseGipaList(html: string): BoardRow[] {
  const out: BoardRow[] = [];
  const seen = new Set<string>();
  for (const tr of parseHtml(html).querySelectorAll("table.board-list > tbody > tr")) {
    const a = tr.querySelector("td.subject a");
    const href = (a?.getAttribute("href") ?? "").trim();
    if (!href || href === "#" || /^javascript:/i.test(href)) continue;
    const detailUrl = absolutize(href, APPLY);
    if (seen.has(detailUrl)) continue;
    const strong = a?.querySelector("strong.txt_t");
    const title = strong ? titleOf(strong) : "";
    if (!title) continue;
    seen.add(detailUrl);
    /**
     * 접수일정은 **`td:nth-child(3)` 칸을 직접** 집는다(유형|사업명|접수일정|버튼).
     * ⚠️ 행 전체 글자(`tr.text`)에서 찾으면 안 된다 — 칸이 띄어쓰기 없이 이어 붙어
     *    조회수·전화번호와 날짜가 붙는다(hsbiz 실측 함정).
     * ⚠️ 행 노드에서 `tr > td:nth-child(3)` 로 찾으면 0건 — 이미 tr 이라 자식 tr 을 찾는다.
     */
    const term = (tr.querySelector("td:nth-child(3)")?.text ?? "").replace(/\s+/g, " ").trim();
    const days = [...term.matchAll(YMD)].map(
      (m) => `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`,
    );
    const dateText =
      days.length >= 2 ? `${days[0]} ~ ${days[1]}` : days.length === 1 ? `${days[0]} ~` : "";
    out.push({
      title,
      detailUrl,
      dateText,
      category: "",
      agency: "고양산업진흥원",
    });
  }
  return out;
}

export const gipaConfig: BoardConfig = {
  id: "gipa",
  label: "고양산업진흥원",
  agency: "고양산업진흥원",
  region: "경기",
  baseUrl: APPLY,
  charset: "utf-8",
  list: {
    url: (p) => `${BASE}${LIST}?cate=1&page=${p}`,
    maxPages: 3,
    rowSelector: "table.board-list > tbody > tr",
    fields: {
      title: { selector: "td.subject a strong.txt_t" },
      detailUrl: { selector: "td.subject a", attr: "href" },
      date: { selector: "td:nth-child(3)" },
    },
  },
  customParse: parseGipaList,
  /**
   * 4번째 칸에 `href="#"` · `javascript:void(0)` 신청 버튼이 있다.
   * customParse 가 죽으면 heuristic 이 그 링크를 공고로 저장할 수 있다.
   */
  skipHeuristic: true,
  expectMinRows: 5,
};
