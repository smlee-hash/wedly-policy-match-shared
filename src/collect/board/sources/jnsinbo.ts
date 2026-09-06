import { parseHtml } from "../html";
import type { BoardConfig, BoardRow } from "../types";

/**
 * 전남신용보증재단 공지사항 (`/jnsinbo/operation/news/notice.do`).
 *
 * 왜 연결했나(2026-09-03 실측): 「지원사업 공고」 전용 게시판이 없다. `/jnsinbo/support/*`
 * 는 프로그램 소개 페이지뿐이고, 실제 모집공고는 일반 공지사항에 채용·설문·자산매각과
 * 섞여 올라온다. 1쪽 일반행에 창업교실·WINGz·고용보험료·라이브커머스·광양시 경영혁신이 있다.
 *
 * 구조: `table.tbl_Board_notice tbody tr`. 붙박이 5행은 `tr.boardNotice_Row`
 * (`span.cate` 공지), 일반 10행은 `tr[class=""]`. 제목 `td.sbj a`.
 * href 는 `javascript:;` 고정값이라 쓸 수 없고, `onclick="pf_DetailMove('번호')"` 에서
 * ID 를 뽑아 `/jnsinbo/Board/{id}/detailView.do` 로 조립한다(bizbc 방식).
 * 목록은 **등록일만** 준다(`td.date` YYYY-MM-DD) — 「등록일 ~」 개시형.
 *
 * 쪽넘김: 화면 스크립트는 POST(`PageIndex` + `_csrf` + 세션쿠키). POST 만 보내면
 * 403(실측). 엔진은 쪽마다 새 요청이라 CSRF·세션을 못 나른다.
 * ★GET `?PageIndex=N`(대문자, 숨은 칸 이름과 같음) 은 2·3쪽이 실제로 넘어간다
 * (실측 p1 일반 선두 9091 · p2 8637 · p3 8122). 소문자 `?pageIndex=` 도 같은 날
 * 재실측에서는 먹혔으나, 숨은 칸 이름과 맞추어 대문자를 쓴다.
 *
 * 한 쪽 10건(+붙박이 5) · 전체 약 23쪽(228건) · charset UTF-8.
 * 브라우저 UA 없으면 HTTP 403(WAF, 239바이트) — 엔진이 이미 UA 를 붙인다.
 */
const BASE = "https://www.jnsinbo.or.kr";
const LIST = "/jnsinbo/operation/news/notice.do";
const VIEW = "/jnsinbo/Board";
const ROW = "table.tbl_Board_notice tbody tr";
const ID = /pf_DetailMove\(\s*'(\d+)'\s*\)/;
const YMD = /(20\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})/;

/**
 * 지원사업이 아닌 글. **버릴 것만** 지정한다.
 * 실측 제목: GBSI/설문·당첨자·개인정보 제3자·고객만족도·비상근 이사·불용물품/매각·
 * 보이스피싱·방문상담 예약안내·문자피싱.
 * ★`채용` 을 통째로 버리면 안 된다 — 고용보조금은 제목에 「채용」을 쓴다(bizbc.ts 주석).
 */
const DROP =
  /입찰|합격자|서류전형|경기실사지수|GBSI|설문조사|보이스피싱|피싱|당첨자|비상근\s*이사|개인정보\s*제3자|고객만족도\s*조사|불용물품|무상양여|매각|\(종료\)|예방\s*안내|방문상담\s*예약안내/;
const DROP_STAFF =
  /평가위원|(?:신규|경력|직원)\s*채용\s*(?:공고|안내)|채용\s*공고/;

/** 시험이 제목 글자만으로 거르개를 잴 수 있게 내보낸다. */
export function isJnsinboDropTitle(title: string): boolean {
  return DROP.test(title) || DROP_STAFF.test(title);
}

/**
 * 붙박이 공지 중 **1년 넘게 붙어 있는 것은 버린다**(koreaexim.ts 방식).
 * 실측 붙박이 5건 중 2022-05-16 방문상담·2021-06-21 피싱 안내가 이 갈래다.
 */
const PINNED_MAX_AGE_MS = 365 * 24 * 3600_000;

export function parseJnsinboList(html: string, _page = 1, now = Date.now()): BoardRow[] {
  const out: BoardRow[] = [];
  const seen = new Set<string>();
  for (const tr of parseHtml(html).querySelectorAll(ROW)) {
    const a = tr.querySelector("td.sbj a");
    const id = (a?.getAttribute("onclick") ?? "").match(ID)?.[1] ?? "";
    if (!id || seen.has(id)) continue;
    const title = (a?.text ?? "").replace(/\s+/g, " ").trim();
    if (!title || isJnsinboDropTitle(title)) continue;
    /**
     * 등록일은 **`td.date` 칸을 직접** 집는다.
     * ⚠️ 행 전체 글자(`tr.text`)에서 찾으면 안 된다 — 번호 칸 「228」 + 「2026-07-27」이
     *    「2282026-07-27」로 붙는다(hsbiz 실측 함정).
     */
    const dateCell = (tr.querySelector("td.date")?.text ?? "").replace(/\s+/g, " ").trim();
    const d = dateCell.match(YMD);
    const ymd = d ? `${d[1]}-${d[2].padStart(2, "0")}-${d[3].padStart(2, "0")}` : "";
    const pinned =
      (tr.getAttribute("class") ?? "").split(/\s+/).includes("boardNotice_Row") ||
      (tr.querySelector("span.cate")?.text ?? "").replace(/\s+/g, " ").trim() === "공지";
    if (pinned && ymd && now - Date.parse(`${ymd}T00:00:00Z`) > PINNED_MAX_AGE_MS) {
      seen.add(id);
      continue;
    }
    seen.add(id);
    out.push({
      title,
      // ★PageIndex 는 쪽 번호라 주소에 넣으면 같은 글이 쪽마다 다른 줄로 저장된다.
      detailUrl: `${BASE}${VIEW}/${id}/detailView.do`,
      dateText: ymd ? `${ymd} ~` : "",
      category: "",
      agency: "전남신용보증재단",
    });
  }
  return out;
}

export const jnsinboConfig: BoardConfig = {
  id: "jnsinbo",
  label: "전남신용보증재단",
  agency: "전남신용보증재단",
  region: "전남",
  baseUrl: `${BASE}/`,
  charset: "utf-8",
  list: {
    url: (p) => `${BASE}${LIST}?PageIndex=${p}`,
    maxPages: 8,
    rowSelector: ROW,
    fields: {
      title: { selector: "td.sbj a" },
      detailUrl: {
        selector: "td.sbj a",
        attr: "onclick",
        regex: "pf_DetailMove\\(\\s*'(\\d+)'\\s*\\)",
      },
      date: { selector: "td.date" },
    },
  },
  customParse: parseJnsinboList,
  /**
   * 상세 GET 실측(2026-09-03 `Board/8818`·`8842`):
   * 본문 `div.board_detail_content` — 8818 은 지원대상·교육일정이 HTML 에 있고 첨부가 없다.
   * 8842 는 「첨부된 공고문 확인」 짧은 표지 + hwp. 첨부가 없는 글을 위해 본문 칸을 연다.
   * 첨부 `div.board_detail_attach` (`onclick="cf_download('…')"` · href 는 javascript:;).
   */
  detailContentSelector: "div.board_detail_content",
  attachmentsScopeSelector: "div.board_detail_attach",
  // 한 쪽 10건(+붙박이)의 절반. 거르개 뒤 실측 1쪽 8건. 0행이면 서식 변경.
  expectMinRows: 5,
  /**
   * 목록 행 `td.file` 에 첨부 아이콘(`icon_file_01.png`)이 섞여 있고, 페이지가 1.3MB
   * 사이트 껍데기다. heuristic 이 아이콘·바닥 링크를 공고로 저장하지 않게 끈다.
   */
  skipHeuristic: true,
};
