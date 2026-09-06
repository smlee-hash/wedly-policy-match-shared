import { parseHtml } from "../html";
import type { BoardConfig, BoardRow } from "../types";

/**
 * 강원신용보증재단 신용보증 상품(운영) — `board_name=product`.
 *
 * 왜 연결했나(2026-09-03 실측): 「OO시/군 출연 소상공인 협약보증」·「청년창업자금 무이자대출
 * 지원사업 협약보증」처럼 기업이 신청하는 개별 지원사업 공고가 이 게시판에 올라온다.
 * 공지사항(`board_name=notice`)은 채용·인사 공고 위주라 붙이면 안 된다.
 * bizinfo.go.kr 교차 등재(「춘천시 2026년 중소기업 특례보증」 ↔ view_id=173)로 이 게시판이 맞다.
 *
 * 구조: `table.basic_board tbody tr.hover_list`. 제목 `td.subject a` href
 * `/board/board_view.php?view_id={ID}&board_name=product&page={쪽}` —
 * **view_id 만** 써서 주소를 조립한다. 쪽 번호가 sourceId 에 섞이면 같은 글이 쪽마다 다른 줄로 저장된다.
 * 쪽넘김은 `?page=n` GET. 한 쪽 20건 · 전체 약 2쪽(목록 머리글 전체 40건).
 * 목록은 **등록일만** 준다(`td:nth-child(4)` 「YYYY-MM-DD」) — pipa 와 같이 「등록일 ~」 개시형.
 *
 * ★브라우저 UA 위장은 불필요하다(실측: 기본 curl UA 도 HTTP 200/같은 바이트). 엔진이 이미 UA 를 붙인다.
 */
const BASE = "https://gwsinbo.or.kr";
const LIST = "/board/board_list.php";
const VIEW = "/board/board_view.php";
const BOARD = "product";
const VIEW_ID = /[?&]view_id=(\d+)/;
const YMD = /(20\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})/;

/**
 * 지원사업이 아닌 글. **버릴 것만** 지정한다.
 * 실측 1·2쪽(40건)에는 DROP 후보가 없었다. 입찰·설문·평가위원·합격자·채용 공고는
 * 기업이 신청할 지원사업이 아니라서 좁게 버린다.
 * ★`채용` 을 통째로 버리면 안 된다 — 고용보조금은 제목에 「채용」을 쓴다(bizbc 주석).
 */
const DROP = /입찰|설문|합격자/;
const DROP_STAFF =
  /평가위원|외부전문가|전문가\s*풀|우선협상대상자|제안발표|(?:신규|경력|직원)\s*채용\s*(?:공고|안내)|채용\s*공고/;

/** 시험이 제목 글자만으로 거르개를 잴 수 있게 내보낸다. */
export function isGwsinboDropTitle(title: string): boolean {
  return DROP.test(title) || DROP_STAFF.test(title);
}

/**
 * 붙박이 공지 중 **1년 넘게 붙어 있는 것은 버린다**(koreaexim 방식).
 * 붙박이는 날짜를 비워 저장하는데, 그러면 처음 본 날부터 90일간 「모집중」이 된다.
 * 실측 1·2쪽에는 붙박이 칸이 없다(`td.num` 이 40…21 / 20…1).
 */
const PINNED_MAX_AGE_MS = 365 * 24 * 3600_000;

export function parseGwsinboList(html: string, _page = 1, now = Date.now()): BoardRow[] {
  const out: BoardRow[] = [];
  const seen = new Set<string>();
  for (const tr of parseHtml(html).querySelectorAll("table.basic_board tbody tr.hover_list")) {
    const a = tr.querySelector("td.subject a");
    const id = (a?.getAttribute("href") ?? "").match(VIEW_ID)?.[1] ?? "";
    if (!id || seen.has(id)) continue;
    const title = (a?.text ?? "").replace(/\s+/g, " ").trim();
    if (!title || isGwsinboDropTitle(title)) continue;
    /**
     * 등록일은 **4번째 td 칸을 직접** 집는다(`번호|제목|글쓴이|날짜`).
     * ⚠️ 행 전체 글자(`tr.text`)에서 찾으면 안 된다 — 번호 칸 「40」 + 「2026-03-31」이
     *    「402026-03-31」로 붙는다(hsbiz 실측 함정).
     */
    const dateCell = (tr.querySelector("td:nth-child(4)")?.text ?? "").replace(/\s+/g, " ").trim();
    const d = dateCell.match(YMD);
    const ymd = d ? `${d[1]}-${d[2].padStart(2, "0")}-${d[3].padStart(2, "0")}` : "";
    const num = (tr.querySelector("td.num")?.text ?? "").replace(/\s+/g, " ").trim();
    const pinned = num === "공지" || (tr.getAttribute("class") ?? "").split(/\s+/).includes("notice");
    if (pinned && ymd && now - Date.parse(`${ymd}T00:00:00Z`) > PINNED_MAX_AGE_MS) continue;
    seen.add(id);
    out.push({
      title,
      // ★page 는 넣지 않는다 — 주소가 곧 중복 판정 열쇠(sourceId)라 쪽마다 다른 줄이 된다.
      detailUrl: `${BASE}${VIEW}?view_id=${id}&board_name=${BOARD}`,
      dateText: pinned || !ymd ? "" : `${ymd} ~`,
      category: "",
      agency: "강원신용보증재단",
    });
  }
  return out;
}

export const gwsinboConfig: BoardConfig = {
  id: "gwsinbo",
  label: "강원신용보증재단 협약보증",
  agency: "강원신용보증재단",
  region: "강원",
  baseUrl: `${BASE}/`,
  charset: "utf-8",
  list: {
    url: (p) => `${BASE}${LIST}?board_name=${BOARD}&page=${p}`,
    maxPages: 2,
    rowSelector: "table.basic_board tbody tr.hover_list",
    fields: {
      title: { selector: "td.subject a" },
      detailUrl: { selector: "td.subject a", attr: "href" },
      date: { selector: "td:nth-child(4)" },
    },
  },
  customParse: parseGwsinboList,
  /**
   * 실측 상세 view_id=183: 본문은 `td.write_body`(#write_body)에 지원대상·상품개요·신청방법이
   * 그대로 있다. 첨부는 그 글에 칸 자체가 없었다 — 범위를 못 박으면 사이트 공용 링크가 섞인다.
   * 첨부 수확은 pdf/hwp/download 만 골라 쓰므로 선택자를 비워 둔다.
   */
  detailContentSelector: "td.write_body",
  // 한 쪽 20건. 제목 거르개를 지난 뒤 몇 건만 남을 수 있다. 0행이면 서식 변경이므로 절반인 10.
  expectMinRows: 10,
};
