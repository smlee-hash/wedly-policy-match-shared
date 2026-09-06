import { parseHtml } from "../html";
import type { BoardConfig, BoardRow } from "../types";

/**
 * 구미전자정보기술원 사업공고(알림마당 > 사업공고).
 *
 * 구조: `div.notice_box > ul > li`. 제목은 `span.t2 span.txt`, 상세는
 * `/html/board_content.asp?board_id=business&board_idx={idx}` href.
 * 쪽넘김은 `?page=n` GET. 한 쪽 20건 · 전체 약 38쪽.
 * 목록은 **등록일만** 준다(`span.t4` 「2026.08.31」) — pipa 와 같이 「등록일 ~」 개시형.
 *
 * ★브라우저 UA 위장은 불필요하다(실측: UA 없는 curl 도 HTTP 200/같은 바이트).
 *
 * ★상세 본문(`div.data`)은 공고 이미지 한 장뿐이라 글자가 거의 없다(실측 board_idx=4358).
 *   그걸 `targetText` 에 채우면 뒷단계의 「첨부에서 본문 뽑기」가 `targetText === ""`
 *   조건에서 이 공고를 건너뛰어, 첨부 PDF 공고문의 자격조건을 영영 못 읽는다.
 *   선택자를 비워 첨부 길을 연다. 첨부는 `dl.file` 안에만 있다.
 */
const BASE = "https://geri.re.kr";
const LIST = "/html/board_list.asp";
const VIEW = "/html/board_content.asp";
const BOARD = "business";
const IDX = /[?&]board_idx=(\d+)/;
const YMD = /(20\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})/;

/**
 * 지원사업이 아닌 글. **버릴 것만** 지정한다.
 * 실측 1·2쪽: 「제안서 예비평가위원 모집」·「선정평가 예비위원 모집」·「입찰제안서 예비평가위원」.
 * ★`채용` 을 통째로 버리면 안 된다 — 고용보조금은 제목에 「채용」을 쓴다(bizbc 주석).
 */
const DROP = /입찰|설문|예비평가위원|선정평가\s*예비위원|평가위원|합격자|채용\s*공고/;

export function isGeriDropTitle(title: string): boolean {
  return DROP.test(title);
}

/**
 * 붙박이 공지 중 **1년 넘게 붙어 있는 것은 버린다**(koreaexim 방식).
 * 붙박이는 날짜를 비워 저장하는데, 그러면 처음 본 날부터 90일간 「모집중」이 된다.
 */
const PINNED_MAX_AGE_MS = 365 * 24 * 3600_000;

export function parseGeriList(html: string, _page = 1, now = Date.now()): BoardRow[] {
  const out: BoardRow[] = [];
  const seen = new Set<string>();
  for (const li of parseHtml(html).querySelectorAll("div.notice_box > ul > li")) {
    const a = li.querySelector("a[href*='board_idx']") ?? li.querySelector("a");
    const idx = (a?.getAttribute("href") ?? "").match(IDX)?.[1] ?? "";
    if (!idx || seen.has(idx)) continue;
    const title = (li.querySelector("span.t2 span.txt")?.text ?? "").replace(/\s+/g, " ").trim();
    if (!title || DROP.test(title)) continue;
    /**
     * 등록일은 **`span.t4` 칸을 직접** 집는다.
     * ⚠️ 행 전체 글자(`li.text`)에서 찾으면 안 된다 — 번호 칸 「747」 + 「2026.08.31」이
     *    「7472026.08.31」로 붙는다(hsbiz 실측 함정).
     */
    const dateCell = (li.querySelector("span.t4")?.text ?? "").replace(/\s+/g, " ").trim();
    const d = dateCell.match(YMD);
    const ymd = d ? `${d[1]}-${d[2].padStart(2, "0")}-${d[3].padStart(2, "0")}` : "";
    const num = (li.querySelector("span.t1")?.text ?? "").replace(/\s+/g, " ").trim();
    const pinned = num === "공지" || (li.getAttribute("class") ?? "").split(/\s+/).includes("notice");
    if (pinned && ymd && now - Date.parse(`${ymd}T00:00:00Z`) > PINNED_MAX_AGE_MS) continue;
    seen.add(idx);
    out.push({
      title,
      // ★page 는 넣지 않는다 — 주소가 곧 중복 판정 열쇠(sourceId)라 쪽마다 다른 줄이 된다.
      detailUrl: `${BASE}${VIEW}?board_id=${BOARD}&board_idx=${idx}`,
      dateText: pinned || !ymd ? "" : `${ymd} ~`,
      category: "",
      agency: "구미전자정보기술원",
    });
  }
  return out;
}

export const geriConfig: BoardConfig = {
  id: "geri",
  label: "구미전자정보기술원",
  agency: "구미전자정보기술원",
  region: "경북",
  baseUrl: `${BASE}/`,
  charset: "utf-8",
  list: {
    url: (p) => `${BASE}${LIST}?board_id=${BOARD}&page=${p}`,
    maxPages: 10,
    rowSelector: "div.notice_box > ul > li",
    fields: {
      title: { selector: "span.t2 span.txt" },
      detailUrl: { selector: "a", attr: "href" },
      date: { selector: "span.t4" },
    },
  },
  customParse: parseGeriList,
  /**
   * ★`detailContentSelector` 를 **일부러 안 적는다.**
   * 실측 본문(`div.data`)은 공고 이미지 한 장 + 빈 문단뿐이라, 그걸 채우면 첨부 PDF
   * 공고문의 자격조건을 영영 못 읽는다(kbiz 와 같은 갈래).
   */
  attachmentsScopeSelector: "dl.file",
  // 한 쪽 20건에서 예비평가위원을 걸러내면 실측 9건. 절반(10)은 그 아래라 5로 둔다.
  // 0행이면 서식 변경.
  expectMinRows: 5,
};
