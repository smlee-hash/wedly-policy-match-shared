import { parseHtml } from "../html";
import type { BoardConfig, BoardRow } from "../types";

/**
 * 경북신용보증재단 공지사항(재단소식 > 공지사항, mn=10052/pageNo=10005).
 *
 * 왜 연결했나(2026-09-03 실측): 전용 「지원사업/사업공고」 게시판은 없고, 상품(특례보증)은
 * 날짜 없는 정적 카탈로그(`/page/link.tc?mn=10046~10049`)다. 시간순 게시물은
 * 공지사항 하나뿐(136건/10쪽). 밀도는 낮지만 특례보증·라이브커머스·창업사관학교처럼
 * 기업마당이 안 싣는 경북 지역 글이 섞여 있다.
 *
 * ★힌트 도메인 gbsinbo.or.kr 는 200 이 뜨지만 실제로는 무관한 「대전금융복지상담센터」다.
 *    진짜 주소는 gbsinbo.co.kr (`<title>`=경북신용보증재단).
 *
 * 구조: `div.table_wrap.notice table.com_table.board tbody tr`. 제목이 `<a href>` 가 아니라
 * `<a class="board_title" onclick="boardList.view('번호')">` 라서 상세 주소를 손으로 조립한다.
 * 쪽넘김은 `?pageIndex=n` GET. 한 쪽 15건(+붙박이 6) · 전체 약 10쪽. `maxPages: 6`.
 * 목록은 **등록일만** 준다(5번째 td 「YYYY-MM-DD」) — pipa 와 같이 「등록일 ~」 개시형.
 *
 * ⚠️ 붙박이 행은 `style="background: #fffcec"` + `span.notice_label` 이고, 같은 글이
 *    본문 칸에 한 번 더 나온다. `seen` 중복 제거가 필수.
 * ⚠️ onclick 은 **tr 이 아니라 td·a** 에 있다. `tr[onclick]` 은 0행이다.
 * ★브라우저 UA 없어도 HTTP 200(실측). 엔진이 이미 UA 를 붙인다.
 */
const BASE = "https://gbsinbo.co.kr";
const LIST = "/page/10052/10005.tc";
const VIEW = /boardList\.view\(\s*'(\d+)'\s*\)/;
const YMD = /(20\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})/;
const ROW = "div.table_wrap.notice table.com_table.board tbody tr";

/**
 * 지원사업이 아닌 글. **버릴 것만** 지정한다.
 * 실측 제목: 설문조사·개인정보 제3자·청렴도·지점 개점/이전·보이스피싱·브로커 주의·
 * 생활체육·공모전·추모비·아동학대·실태조사·컨설턴트 모집·수기공모·업무제안 공모.
 * ★`채용` 을 통째로 버리면 안 된다 — 「채용 지원사업」이 죽는다(bizbc.ts 주석).
 *   기관이 사람을 뽑는 글(`직원 채용`·`채용 공고`)만 좁게 버린다.
 * ★`조성사업 공모` 는 살린다 — `공모전` 과 글자가 다르다.
 */
const DROP =
  /설문조사|개인정보\s*제3자|청렴도|지점\s*개점|지점\s*이전|보이스피싱|브로커|공모전|수기공모|업무제안\s*공모|생활체육|추모비|아동학대|실태조사|입찰|평가위원|합격자|컨설턴트.{0,8}모집/;
const DROP_STAFF = /(?:신규|경력|직원)\s*채용\s*(?:공고|안내)|채용\s*공고/;

/** 붙박이 공지 중 **1년 넘게 붙어 있는 것은 버린다**(koreaexim.ts 방식). */
const PINNED_MAX_AGE_MS = 365 * 24 * 3600_000;

export function isGbsinboDropTitle(title: string): boolean {
  return DROP.test(title) || DROP_STAFF.test(title);
}

function ymdOf(cell: string): string {
  const d = cell.replace(/\s+/g, " ").trim().match(YMD);
  return d ? `${d[1]}-${d[2].padStart(2, "0")}-${d[3].padStart(2, "0")}` : "";
}

export function parseGbsinboList(html: string, _page = 1, now = Date.now()): BoardRow[] {
  const out: BoardRow[] = [];
  const seen = new Set<string>();
  for (const tr of parseHtml(html).querySelectorAll(ROW)) {
    const a = tr.querySelector("a.board_title");
    const no = (a?.getAttribute("onclick") ?? "").match(VIEW)?.[1] ?? "";
    if (!no || seen.has(no)) continue;
    // 공지 라벨 span 은 제목 글자에 넣지 않는다. 본문은 p.except.
    const titleNode = a?.querySelector("p.except") ?? a;
    titleNode?.querySelectorAll("span").forEach((s) => {
      const t = (s.text ?? "").replace(/\s+/g, " ").trim();
      if (t === "공지" || t === "[모집]" || t === "모집") s.remove();
    });
    const title = (titleNode?.text ?? "").replace(/\s+/g, " ").trim();
    if (!title || isGbsinboDropTitle(title)) continue;
    /**
     * 등록일은 **5번째 td 칸을 직접** 집는다(번호|제목|작성자|조회수|작성일).
     * ⚠️ 행 전체 글자(`tr.text`)에서 찾으면 안 된다 — 조회수 「3934」 + 「2022-09-28」이
     *    「39342022-09-28」로 붙는다(hsbiz 실측 함정).
     */
    const tds = tr.querySelectorAll("td");
    const ymd = ymdOf(tds[4]?.text ?? "");
    const style = tr.getAttribute("style") ?? "";
    const pinned = /#fffcec/i.test(style) || !!tr.querySelector("span.notice_label");
    // 붙박이를 나이로 건너뛸 때도 번호를 기억한다 — 같은 글이 본문 칸에 한 번 더 나온다.
    if (pinned && ymd && now - Date.parse(`${ymd}T00:00:00Z`) > PINNED_MAX_AGE_MS) {
      seen.add(no);
      continue;
    }
    seen.add(no);
    out.push({
      title,
      // ★pageIndex 는 쪽 번호라 주소에 넣으면 같은 글이 쪽마다 다른 줄로 저장된다.
      detailUrl: `${BASE}${LIST}?pageDtlOrdrNo=1&boardNo=${no}&boardMngNo=2&importUrl=%2Fboard%2Fview.tc`,
      dateText: pinned || !ymd ? "" : `${ymd} ~`,
      category: "",
      agency: "경북신용보증재단",
    });
  }
  return out;
}

export const gbsinboConfig: BoardConfig = {
  id: "gbsinbo",
  label: "경북신용보증재단",
  agency: "경북신용보증재단",
  region: "경북",
  baseUrl: `${BASE}/`,
  charset: "utf-8",
  list: {
    url: (p) => `${BASE}${LIST}?pageIndex=${p}`,
    maxPages: 6,
    rowSelector: ROW,
    fields: {
      title: { selector: "a.board_title p.except" },
      detailUrl: {
        selector: "a.board_title",
        attr: "onclick",
        regex: "boardList\\.view\\(\\s*'(\\d+)'\\s*\\)",
      },
      date: { selector: "td:nth-child(5)" },
    },
  },
  customParse: parseGbsinboList,
  /**
   * 상세 GET 실측(boardNo=135·6058, 2026-09-03): 본문은 `div.board_view > div.text`.
   * 첨부 칸 `div.fileWrap.fileId` 는 GET 응답이 비어 있고 JS 가 `data-vl` 로 채운다 —
   * 선택자를 적으면 빈 상자만 수확한다. 비워 두고 본문 길을 연다.
   */
  detailContentSelector: "div.board_view > div.text",
  // 한 쪽 15건(+붙박이)에서 거르개를 지나면 실측 4건. 절반(7)로 두면 정상 목록도 서식 변경으로 버린다.
  expectMinRows: 2,
};
