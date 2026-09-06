import { parseHtml } from "../html";
import type { BoardConfig, BoardRow } from "../types";

/**
 * 경남신용보증재단 소상공인종합지원 공지사항(공고/기업, bo_table=04_01).
 *
 * 왜 연결했나(2026-09-03 실측): www.gnsinbo.or.kr 는 신용보증 업무 중심이고,
 * 지원사업 「공고/기업 OOOO호」 는 dream.gnsinbo.or.kr/bbs/board.php?bo_table=04_01 에만 실린다.
 * 본사이트 첫 화면에는 이 게시판 링크가 없다.
 *
 * 구조: `div.tbl_wrap table tbody tr`. 일반 글 class="" · 상단 고정 공지 class="bo_notice".
 * 제목 `td.td_subject .bo_tit a[href*='wr_id=']`. 상세는 wr_id 만으로 조립한다 —
 * 원문 href 에 `&page=n` 이 붙어 있어 그대로 쓰면 같은 글이 쪽마다 다른 줄로 저장된다.
 * 쪽넘김은 `?page=n` GET. 한 쪽 15건 · 전체 약 11쪽. `maxPages: 10`.
 * 목록은 **등록일만** 준다(`td.td_datetime` 「YYYY-MM-DD」) — pipa 와 같이 「등록일 ~」 개시형.
 *
 * ★브라우저 UA 없으면 HTTP 400 + "Request Blocked"(WAF). 엔진이 이미 UA 를 붙인다.
 * ★TLS 정상(`-k` 불필요). 목록은 SSR HTML — 별도 XHR 없이 바로 파싱 가능.
 */
const BASE = "https://dream.gnsinbo.or.kr";
const LIST = "/bbs/board.php";
const BOARD = "04_01";
const WR_ID = /[?&]wr_id=(\d+)/;
const YMD = /(20\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})/;
const ROW = "div.tbl_wrap table tbody tr";

/**
 * 지원사업이 아닌 글. **버릴 것만** 지정한다.
 * 실측 제목: 시상계획 · 강사/컨설턴트 모집 · 서류전형 결과 · 합격자 결과 공고.
 * ★`채용` 을 통째로 버리면 안 된다 — 「채용 지원사업」이 죽는다(bizbc.ts 주석).
 *   기관이 사람을 뽑는 글(`직원 채용`·`채용 공고`)만 좁게 버린다.
 * ★`컨설팅 지원 사업` 은 살린다 — `컨설턴트 모집` 과 글자가 다르다.
 */
const DROP =
  /시상계획|강사.{0,8}모집|컨설턴트.{0,8}모집|서류전형\s*결과|합격자\s*(?:결과|발표)|결과\s*공고|입찰|설문|평가위원/;
const DROP_STAFF = /(?:신규|경력|직원)\s*채용\s*(?:공고|안내)|채용\s*공고/;

/** 시험이 제목 글자만으로 거르개를 잴 수 있게 내보낸다. */
export function isGnsinboDropTitle(title: string): boolean {
  return DROP.test(title) || DROP_STAFF.test(title);
}

/**
 * 붙박이 공지 중 **1년 넘게 붙어 있는 것은 버린다**(koreaexim.ts 방식).
 * 붙박이는 날짜를 비워 저장하는데, 그러면 처음 본 날부터 90일간 「모집중」이 된다.
 * 실측 붙박이 wr_id=142(2026-02-02, 함께가게 멘토링)는 1년 안이라 담는다.
 */
const PINNED_MAX_AGE_MS = 365 * 24 * 3600_000;

export function parseGnsinboList(html: string, _page = 1, now = Date.now()): BoardRow[] {
  const out: BoardRow[] = [];
  const seen = new Set<string>();
  for (const tr of parseHtml(html).querySelectorAll(ROW)) {
    const a = tr.querySelector("td.td_subject .bo_tit a[href*='wr_id=']") ?? tr.querySelector("td.td_subject .bo_tit a");
    const id = (a?.getAttribute("href") ?? "").match(WR_ID)?.[1] ?? "";
    if (!id || seen.has(id)) continue;
    const title = (a?.text ?? "").replace(/\s+/g, " ").trim();
    if (!title || isGnsinboDropTitle(title)) continue;
    /**
     * 등록일은 **`td.td_datetime` 칸을 직접** 집는다.
     * ⚠️ 행 전체 글자(`tr.text`)에서 찾으면 안 된다 — 번호 칸 「157」 + 「2026-09-02」가
     *    「1572026-09-02」로 붙는다(hsbiz 실측 함정).
     */
    const dateCell = (tr.querySelector("td.td_datetime")?.text ?? "").replace(/\s+/g, " ").trim();
    const d = dateCell.match(YMD);
    const ymd = d ? `${d[1]}-${d[2].padStart(2, "0")}-${d[3].padStart(2, "0")}` : "";
    const pinned = (tr.getAttribute("class") ?? "").split(/\s+/).includes("bo_notice");
    if (pinned && ymd && now - Date.parse(`${ymd}T00:00:00Z`) > PINNED_MAX_AGE_MS) continue;
    seen.add(id);
    out.push({
      title,
      // ★page 는 넣지 않는다 — 주소가 곧 중복 판정 열쇠(sourceId)라 쪽마다 다른 줄이 된다.
      detailUrl: `${BASE}${LIST}?bo_table=${BOARD}&wr_id=${id}`,
      dateText: pinned || !ymd ? "" : `${ymd} ~`,
      category: "",
      agency: "경남신용보증재단",
    });
  }
  return out;
}

export const gnsinboConfig: BoardConfig = {
  id: "gnsinbo",
  label: "경남신용보증재단 소상공인지원",
  agency: "경남신용보증재단",
  region: "경남",
  baseUrl: `${BASE}/`,
  charset: "utf-8",
  list: {
    url: (p) => `${BASE}${LIST}?bo_table=${BOARD}&page=${p}`,
    maxPages: 10,
    rowSelector: ROW,
    fields: {
      title: { selector: "td.td_subject .bo_tit a" },
      detailUrl: { selector: "td.td_subject .bo_tit a", attr: "href" },
      date: { selector: "td.td_datetime" },
    },
  },
  customParse: parseGnsinboList,
  /**
   * 상세 GET 실측(wr_id=170, 2026-09-03): 본문 `#bo_v_con`(393자, 모집기간·지원대상 포함).
   * 첨부는 본문과 다른 상자 `#bo_v_file`(`bbs/download.php?bo_table=04_01&wr_id=…`).
   */
  detailContentSelector: "#bo_v_con",
  attachmentsScopeSelector: "#bo_v_file",
  // 한 쪽 15건의 절반. 거르개 뒤 실측 1쪽 14건. 0행이면 서식 변경.
  expectMinRows: 7,
};
