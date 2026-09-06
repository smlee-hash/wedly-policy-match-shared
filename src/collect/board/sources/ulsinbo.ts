import { parseHtml } from "../html";
import type { BoardConfig, BoardRow } from "../types";

/**
 * 울산신용보증재단 중소기업지원자금공고.
 *
 * 구조: `div.board-text > table > tbody > tr`. 제목은 `td.link > a`,
 * href 는 상대경로 `?mcode=0402060000&no={no}`. 날짜는 **지원기간 칸**
 * (`td:nth-child(5)`, 6칸 중 5번째: 번호/구분/자금공고명/지원규모/지원기간/시행여부).
 * 끝이 「자금소진시까지」(또는 「선착순마감완료」)라 시작일만 온다 — 「시작 ~」 개시형.
 *
 * 쪽넘김 없음. 전체 50건이 한 쪽에 다 실리고 `?page=2` 는 같은 50건을 돌려주며
 * href 에 `&page=2` 만 붙인다(2026-09-03 실측). maxPages 1.
 * 상세 주소는 `no` 만으로 조립해 쪽 번호가 sourceId 에 안 섞이게 한다.
 *
 * 상세 본문은 PDF iframe(`div.viewBox` > `div.board-view-files`) 뿐이라
 * `detailContentSelector` 를 **일부러 안 적는다** — 빈 본문을 `targetText` 에 채우면
 * 뒷단계의 「첨부에서 본문 뽑기」가 이 공고를 건너뛰어, 첨부 공고문(hwpx/PDF)의
 * 자격조건을 영영 못 읽는다(kbiz 와 같음). 첨부는 `ul.infoBox` 의 `/_Inc/download.php`.
 *
 * 붙박이 공지 칸이 없다(번호 50→1, `tr.notice` 없음). 브라우저 UA 불필요(실측 HTTP 200).
 */
const BASE = "https://www.ulsanshinbo.co.kr";
const LIST = "/02_sinbo/?mcode=0402060000";
const NO = /[?&]no=(\d+)/;
const YMD = /(20\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})/g;

/**
 * 지원사업이 아닌 글. **버릴 것만** 지정한다.
 * 실측 50건은 전부 자금공고라 거르개에 안 걸린다.
 * ★`채용` 을 통째로 버리면 안 된다 — 고용보조금은 제목에 「채용」을 쓴다(bizbc 주석).
 */
const DROP = /입찰|설문|평가위원|합격자/;
const DROP_STAFF = /(?:신규|경력|직원)\s*채용\s*(?:공고|안내)|채용\s*공고/;

export function isUlsinboDropTitle(title: string): boolean {
  return DROP.test(title) || DROP_STAFF.test(title);
}

export function parseUlsinboList(html: string, _page = 1): BoardRow[] {
  const out: BoardRow[] = [];
  const seen = new Set<string>();
  for (const tr of parseHtml(html).querySelectorAll("div.board-text > table > tbody > tr")) {
    const a = tr.querySelector("td.link > a");
    const href = a?.getAttribute("href") ?? "";
    const no = href.match(NO)?.[1] ?? "";
    if (!no || seen.has(no)) continue;
    const title = (a?.text ?? "").replace(/\s+/g, " ").trim();
    if (!title || DROP.test(title) || DROP_STAFF.test(title)) continue;
    /**
     * 지원기간은 **5번째 td 칸을 직접** 집는다.
     * ⚠️ 행 전체 글자(`tr.text`)에서 찾으면 안 된다 — 번호 칸 「50」 + 「2026.09.10」이
     *    「502026.09.10」으로 붙는다(hsbiz 실측 함정).
     */
    const tds = tr.querySelectorAll("td");
    const period = (tds[4]?.text ?? "").replace(/\s+/g, " ").trim();
    const days = [...period.matchAll(YMD)].map(
      (m) => `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`,
    );
    const dateText = days.length >= 2 ? `${days[0]} ~ ${days[1]}` : days.length === 1 ? `${days[0]} ~` : "";
    seen.add(no);
    out.push({
      title,
      detailUrl: `${BASE}${LIST}&no=${no}`,
      dateText,
      category: (tds[1]?.text ?? "").replace(/\s+/g, " ").trim(),
      agency: "울산신용보증재단",
    });
  }
  return out;
}

export const ulsinboConfig: BoardConfig = {
  id: "ulsinbo",
  label: "울산신용보증재단 자금공고",
  agency: "울산신용보증재단",
  region: "울산",
  baseUrl: `${BASE}/`,
  charset: "utf-8",
  list: {
    url: () => `${BASE}${LIST}`,
    maxPages: 1,
    rowSelector: "div.board-text > table > tbody > tr",
    fields: {
      title: { selector: "td.link > a" },
      detailUrl: { selector: "td.link > a", attr: "href" },
      date: { selector: "td:nth-child(5)" },
    },
  },
  customParse: parseUlsinboList,
  /**
   * ★`detailContentSelector` 를 **일부러 안 적는다**(kbiz 와 같음).
   * 상세 본문(`div.viewBox`)은 PDF iframe 과 `&nbsp;` 뿐이라, 그걸 `targetText` 에 채우면
   * 첨부 공고문 길을 막는다. 첨부는 본문과 다른 상자(`ul.infoBox`)에 있다.
   */
  attachmentsScopeSelector: "ul.infoBox",
  // 한 쪽 50건. 거르개를 지나도 거의 남는다. 절반 미만이면 서식 변경.
  expectMinRows: 25,
};
