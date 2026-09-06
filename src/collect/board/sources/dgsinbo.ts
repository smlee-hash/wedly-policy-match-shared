import { parseHtml } from "../html";
import type { BoardConfig, BoardRow } from "../types";

/**
 * 대구신용보증재단 재단 공지사항(알림마당 > 사이버홍보실, boardMngNo=2).
 *
 * 왜 연결했나(2026-09-03 실측): 전용 「지원사업」 게시판은 없고, 공지 402건/27쪽 안에
 * 경영안정자금·고용보험 지원사업·소상공인 모집이 섞여 있다. 최근 30건(1·2쪽) 중
 * 실질 공고는 7건 — 밀도는 낮지만 기업마당이 안 싣는 대구 지역 글이다.
 *
 * ★힌트 도메인 daegushinbo.or.kr 는 DNS 미해결. 실제는 www.dgsinbo.or.kr.
 *
 * 구조: `table.Ttable.com_table.board tbody tr`. 제목이 `<a href>` 가 아니라
 * `<a class="board_title" onclick="boardList.view('번호')">` 라서 상세 주소를 손으로 조립한다.
 * 쪽넘김은 `?pageIndex=n&boardMngNo=2` GET. 한 쪽 15건(+붙박이 1) · 전체 약 27쪽.
 * 목록은 **등록일만** 준다 — pipa 와 같이 「등록일 ~」 개시형.
 *
 * ⚠️ 붙박이 행은 `style="background: #fffdf5"` + `span.notice_label` 이고, 같은 글이
 *    본문 칸에 한 번 더 나온다. `seen` 중복 제거가 필수.
 * ⚠️ onclick 은 **tr 이 아니라 td·a** 에 있다. `tr[onclick]` 은 0행이다.
 */
const BASE = "https://www.dgsinbo.or.kr";
const LIST = "/page/10065/10006.tc";
const VIEW = /boardList\.view\(\s*'(\d+)'\s*\)/;
const YMD = /(20\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})/;
const ROW = "table.Ttable.com_table.board tbody tr";

/**
 * 지원사업이 아닌 글. **버릴 것만** 지정한다.
 * 실측 제목: 새출발/새도약기금 매각(채권양도)·서포터즈·용역 발주·만족도/실태/설문조사·
 * 업무제안 공모·신년사·합격자 발표.
 * ★`채용` 을 통째로 버리면 안 된다 — 고용보조금은 제목에 「채용」을 쓴다(cwip 에서 겪음).
 *   기관이 사람을 뽑는 글(`직원 채용`·`채용 공고`)만 좁게 버린다.
 */
const DROP =
  /새출발기금\s*매각|새도약기금\s*매각|채권양도|서포터즈|용역|만족도\s*조사|실태조사|설문조사|업무제안\s*공모|신년사|합격자|입찰|평가위원/;
const DROP_STAFF = /(?:신규|경력|직원)\s*채용|채용\s*공고/;

/** 붙박이 공지 중 **1년 넘게 붙어 있는 것은 버린다**(koreaexim 과 같은 갈래). */
const PINNED_MAX_AGE_MS = 365 * 24 * 3600_000;

export function isDgsinboDropTitle(title: string): boolean {
  return DROP.test(title) || DROP_STAFF.test(title);
}

function ymdOf(cell: string): string {
  const d = cell.replace(/\s+/g, " ").trim().match(YMD);
  return d ? `${d[1]}-${d[2].padStart(2, "0")}-${d[3].padStart(2, "0")}` : "";
}

export function parseDgsinboList(html: string, _page = 1, now = Date.now()): BoardRow[] {
  const out: BoardRow[] = [];
  const seen = new Set<string>();
  for (const tr of parseHtml(html).querySelectorAll(ROW)) {
    const a = tr.querySelector("a.board_title");
    const no = (a?.getAttribute("onclick") ?? "").match(VIEW)?.[1] ?? "";
    if (!no || seen.has(no)) continue;
    // [모집]/공지 라벨 span 은 제목 글자에 넣지 않는다. 본문은 p.except.
    const titleNode = a?.querySelector("p.except") ?? a;
    titleNode?.querySelectorAll("span").forEach((s) => {
      const t = (s.text ?? "").replace(/\s+/g, " ").trim();
      if (t === "공지" || t === "[모집]" || t === "모집") s.remove();
    });
    const title = (titleNode?.text ?? "").replace(/\s+/g, " ").trim();
    if (!title || isDgsinboDropTitle(title)) continue;
    /**
     * 등록일은 **4번째 td 칸을 직접** 집는다(번호|제목|작성자|작성일|조회수).
     * ⚠️ 행 전체 글자(`tr.text`)에서 찾으면 안 된다 — 조회수 「2744」 + 「2026-06-01」이
     *    「27442026-06-01」로 붙는다(hsbiz 실측 함정).
     */
    const tds = tr.querySelectorAll("td");
    const ymd = ymdOf(tds[3]?.text ?? "");
    const style = tr.getAttribute("style") ?? "";
    const pinned = /#fffdf5/i.test(style) || !!tr.querySelector("span.notice_label");
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
      agency: (tds[2]?.text ?? "").replace(/\s+/g, " ").trim() || "대구신용보증재단",
    });
  }
  return out;
}

export const dgsinboConfig: BoardConfig = {
  id: "dgsinbo",
  label: "대구신용보증재단",
  agency: "대구신용보증재단",
  region: "대구",
  baseUrl: `${BASE}/`,
  charset: "utf-8",
  list: {
    url: (p) => `${BASE}${LIST}?pageIndex=${p}&boardMngNo=2`,
    maxPages: 10,
    rowSelector: ROW,
    fields: {
      title: { selector: "a.board_title p.except" },
      detailUrl: {
        selector: "a.board_title",
        attr: "onclick",
        regex: "boardList\\.view\\(\\s*'(\\d+)'\\s*\\)",
      },
      date: { selector: "td:nth-child(4)" },
    },
  },
  customParse: parseDgsinboList,
  /**
   * 상세 GET 실측(boardNo=84464): 본문은 `div.board_view > div.text`(676자, 모집기간·대상 포함).
   * 첨부 칸 `div.fileWrap` 은 비어 있고 JS 가 `data-vl` 로 채운다 — 선택자를 적으면
   * 빈 상자만 수확한다. 비워 두고 본문 길을 연다.
   */
  detailContentSelector: "div.board_view > div.text",
  // 한 쪽 15건(+붙박이)에서 거르개를 지나면 실측 2건. 절반(7)로 두면 정상 목록도 서식 변경으로 버린다.
  expectMinRows: 2,
};
