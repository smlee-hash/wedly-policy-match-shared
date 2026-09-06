import { parseHtml } from "../html";
import type { BoardConfig, BoardRow } from "../types";

/**
 * 제주경제통상진흥원 사업공고(bo_table=2_1_1_1).
 *
 * 왜 연결했나(2026-09-03 실측): www.jba.or.kr 사업공고는 그누보드5 정적 HTML.
 * 최신 표본(wr_id 799~810)은 제주 소상공인·창업·융자 공고라 기업마당만으로는 안 들어온다.
 *
 * 구조: `table.board_list tbody tr.bg`. 제목 `td.subject a` href
 * `/bbs/board.php?bo_table=2_1_1_1&wr_id={wr_id}` — 2쪽은 `/m/bbs/…&page=2` 가 붙는다.
 * **wr_id 만** 써서 주소를 조립한다. 쪽 번호가 sourceId 에 섞이면 같은 글이 쪽마다 다른 줄로 저장된다.
 * 쪽넘김은 `?page=n` GET. 한 쪽 15건(+붙박이 3) · 전체 약 51쪽. charset utf-8.
 * 목록은 **등록일만** 준다(`td.datetime` 「YY-MM-DD」) — pipa 와 같이 「등록일 ~」 개시형.
 *
 * 붙박이 3건(wr_id 707·794·807)이 모든 쪽 상단에 반복된다. 807은 청사 사무실 임대라 DROP.
 * ★브라우저 UA 위장은 불필요하다(실측 HTTP 200, 유무 바이트 거의 동일). 엔진이 이미 UA 를 붙인다.
 */
const BASE = "https://www.jba.or.kr";
const LIST = "/bbs/board.php";
const BOARD = "2_1_1_1";
const WR_ID = /[?&]wr_id=(\d+)/;
const YMD4 = /(20\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})/;
const YMD2 = /\b(\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})\b/;
const ROW = "table.board_list tbody tr.bg";

/**
 * 지원사업이 아닌 글. **버릴 것만** 지정한다.
 * 실측: 「진흥원 청사 사무실 임대모집」(wr_id=807) · 「컨설턴트 모집」(wr_id=781, 584).
 * ★`채용` 을 통째로 버리면 안 된다 — 「채용 지원사업」이 죽는다(bizbc.ts 주석).
 * ★`컨설팅 지원` 은 살린다 — `컨설턴트 모집` 과 글자가 다르다.
 */
const DROP = /임대\s*모집|컨설턴트\s*모집|입찰|설문|평가위원|합격자/;
const DROP_STAFF = /(?:신규|경력|직원)\s*채용\s*(?:공고|안내)|채용\s*공고/;

/** 시험이 제목 글자만으로 거르개를 잴 수 있게 내보낸다. */
export function isJbaDropTitle(title: string): boolean {
  return DROP.test(title) || DROP_STAFF.test(title);
}

/**
 * 붙박이 공지 중 **1년 넘게 붙어 있는 것은 버린다**(koreaexim.ts 방식).
 * 붙박이는 날짜를 비워 저장하는데, 그러면 처음 본 날부터 90일간 「모집중」이 된다.
 * 실측 붙박이 wr_id=707(2026-02-11)·794(2026-07-16)는 1년 안이라 담는다. 807은 DROP.
 */
const PINNED_MAX_AGE_MS = 365 * 24 * 3600_000;

/** 등록일 칸만. YY-MM-DD 를 20YY-MM-DD 로 올린다. 행 전체 글자에서 찾으면 번호와 붙는다. */
function ymdOf(cell: string): string {
  const compact = cell.replace(/\s+/g, " ").trim();
  const full = compact.match(YMD4);
  if (full) return `${full[1]}-${full[2].padStart(2, "0")}-${full[3].padStart(2, "0")}`;
  const short = compact.match(YMD2);
  if (short) return `20${short[1]}-${short[2].padStart(2, "0")}-${short[3].padStart(2, "0")}`;
  return "";
}

export function parseJbaList(html: string, _page = 1, now = Date.now()): BoardRow[] {
  const out: BoardRow[] = [];
  const seen = new Set<string>();
  for (const tr of parseHtml(html).querySelectorAll(ROW)) {
    const a = tr.querySelector("td.subject a");
    const id = (a?.getAttribute("href") ?? "").match(WR_ID)?.[1] ?? "";
    if (!id || seen.has(id)) continue;
    const title = (a?.text ?? "").replace(/\s+/g, " ").trim();
    if (!title || isJbaDropTitle(title)) continue;
    /**
     * 등록일은 **`td.datetime` 칸을 직접** 집는다.
     * ⚠️ 행 전체 글자(`tr.text`)에서 찾으면 안 된다 — 번호 칸 「753」 + 「26-09-01」이
     *    「75326-09-01」로 붙는다(hsbiz 실측 함정).
     */
    const ymd = ymdOf(tr.querySelector("td.datetime")?.text ?? "");
    const numHtml = tr.querySelector("td.num")?.innerHTML ?? "";
    const pinned = numHtml.includes("noticeicon") || !!tr.querySelector("span.notice");
    if (pinned && ymd && now - Date.parse(`${ymd}T00:00:00Z`) > PINNED_MAX_AGE_MS) continue;
    seen.add(id);
    out.push({
      title,
      // ★page 는 넣지 않는다 — 주소가 곧 중복 판정 열쇠(sourceId)라 쪽마다 다른 줄이 된다.
      // 2쪽 원문은 `/m/bbs/…&page=2` 이라 호스트·경로도 여기서 다시 조립한다.
      detailUrl: `${BASE}${LIST}?bo_table=${BOARD}&wr_id=${id}`,
      dateText: pinned || !ymd ? "" : `${ymd} ~`,
      category: "",
      agency: "제주경제통상진흥원",
    });
  }
  return out;
}

export const jbaConfig: BoardConfig = {
  id: "jba",
  label: "제주경제통상진흥원",
  agency: "제주경제통상진흥원",
  region: "제주",
  baseUrl: `${BASE}/`,
  charset: "utf-8",
  list: {
    url: (p) => `${BASE}${LIST}?bo_table=${BOARD}&page=${p}`,
    maxPages: 10,
    rowSelector: ROW,
    fields: {
      title: { selector: "td.subject a" },
      detailUrl: { selector: "td.subject a", attr: "href" },
      date: { selector: "td.datetime" },
    },
  },
  customParse: parseJbaList,
  /**
   * 상세 GET 실측(wr_id=810, 2026-09-03): 본문 `#writeContents`(공고 이미지 1장).
   * 첨부는 본문과 다른 상자 `#view_file_download_area`(`download.php?bo_table=2_1_1_1&wr_id=…`).
   */
  detailContentSelector: "#writeContents",
  attachmentsScopeSelector: "#view_file_download_area",
  // 한 쪽 15건의 절반. 거르개 뒤 실측 1쪽 17건(붙박이 포함). 0행이면 서식 변경.
  expectMinRows: 7,
};
