import { parseHtml } from "../html";
import type { BoardConfig, BoardRow } from "../types";

/**
 * 전남중소기업일자리경제진흥원 공지사항.
 *
 * 왜 연결했나(2026-09-03 실측): 홈 제목 「중소기업일자리경제진흥원」·설명 「전남의 중소기업과
 * 함께 경제발전을 선도하는 기업지원 전문기관」. 최신 글이 「민생회복대출안심보험」·
 * 「원스톱 중소기업 현장지원단」·「스마트시티 엑스포 참가 지원」처럼 기업이 신청하는 사업이다.
 *
 * ★목록 화면 `/bbs/?b_id=notice` 는 js-only 다. curl 200/136KB 가 나와도 `#board_wrap` 안이
 *   비어 있고, 로드 시 jQuery `$.ajax(url:'/bbs/bbs_ajax/'+location.search)` 로 표를 주입한다
 *   (스크립트 원문·빈 칸 둘 다 직접 확인). 그래서 목록은 **ajax 주소**를 부른다.
 *   브라우저 UA·쿠키·Referer 없이 맨 curl 로도 ajax 조각이 열린다(실측).
 *
 * 구조:
 * · 목록 GET `/bbs/bbs_ajax/?b_id=notice&site=new_jepa&mn=426&page={쪽}`
 * · 행 `#board_list table tbody tr` · 제목 `td.t_title a` · 등록일 `td.t_date`
 * · 한 쪽 15건 · 전체 1,637건 / 110쪽. `maxPages: 15`(최근 225건).
 * · 목록은 **등록일만** 준다 — 「등록일 ~」 개시형.
 * · 상세 사람용 URL `/bbs/?...type=view&bs_idx=` 도 같은 껍데기(실측 136KB, board_view 없음).
 *   본문·첨부는 ajax 조각(실측 2.9KB)에만 있다.
 *
 * ⚠️ 모든 제목이 `div.title.notice` 다 — 게시판 id 가 notice 라서다. 그걸 붙박이 표시로
 *    보면 전 행이 날짜가 비거나 묵은 글로 버려진다. 붙박이는 **행(tr) class** 또는
 *    번호 칸 글자 「공지」만 본다.
 */
const BASE = "https://www.jepa.kr";
const LIST = "/bbs/bbs_ajax/";
const VIEW = "/bbs/?b_id=notice&site=new_jepa&mn=426&type=view";
const ID = /bs_idx=(\d+)/;
const YMD = /(20\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})/;

/**
 * 지원사업이 아닌 글. **버릴 것만** 지정한다.
 * 실측 1·2쪽: 입찰공고 · 제안서 평가결과 공고 · 제안서 평가위원(후보자) 모집 ·
 * 제안서 평가위원회 결과 공고.
 * ★`채용` 을 통째로 버리면 안 된다 — 「채용 지원사업」이 죽는다(bizbc.ts 주석).
 */
const DROP =
  /입찰|설문|평가위원|합격자|제안서\s*평가|(?:신규|경력|직원)\s*채용\s*(?:공고|안내)|채용\s*공고/;

/** 시험이 제목 글자만으로 거르개를 잴 수 있게 내보낸다. */
export function isJepaDropTitle(title: string): boolean {
  return DROP.test(title);
}

/**
 * 붙박이 공지 중 **1년 넘게 붙어 있는 것은 버린다**(koreaexim.ts 방식).
 * 실측 1·2쪽에는 붙박이 행이 없다 — tr class 에 notice 가 생기거나 번호 칸이 「공지」면
 * 같은 갈래로 건넌다.
 */
const PINNED_MAX_AGE_MS = 365 * 24 * 3600_000;

export function parseJepaList(html: string, _page = 1, now = Date.now()): BoardRow[] {
  const out: BoardRow[] = [];
  const seen = new Set<string>();
  for (const tr of parseHtml(html).querySelectorAll("#board_list table tbody tr")) {
    const a = tr.querySelector("td.t_title a");
    const href = (a?.getAttribute("href") ?? "").trim();
    const id = href.match(ID)?.[1] ?? "";
    if (!id || seen.has(id)) continue;
    const title = (a?.text ?? "").replace(/\s+/g, " ").trim();
    if (!title || DROP.test(title)) continue;
    /**
     * 등록일은 **`td.t_date` 칸을 직접** 집는다(원문 YYYY-MM-DD).
     * ⚠️ 행 전체 글자(`tr.text`)에서 찾으면 안 된다 — 번호 칸 「1637」 + 「2026-08-31」이
     *    「16372026-08-31」로 붙는다(hsbiz 실측 함정).
     */
    const dateCell = (tr.querySelector("td.t_date")?.text ?? "").replace(/\s+/g, " ").trim();
    const d = dateCell.match(YMD);
    const ymd = d ? `${d[1]}-${d[2].padStart(2, "0")}-${d[3].padStart(2, "0")}` : "";
    const numText = (tr.querySelector("td.t_num")?.text ?? "").replace(/\s+/g, " ").trim();
    const pinned =
      numText === "공지" || (tr.getAttribute("class") ?? "").split(/\s+/).includes("notice");
    if (pinned && ymd && now - Date.parse(`${ymd}T00:00:00Z`) > PINNED_MAX_AGE_MS) continue;
    seen.add(id);
    out.push({
      title,
      // ★page 는 쪽 번호라 주소에 넣으면 같은 글이 쪽마다 다른 줄로 저장된다
      //   (2쪽 href 실측 `page=2&type=view&bs_idx=1695`).
      detailUrl: `${BASE}${VIEW}&bs_idx=${id}`,
      dateText: pinned || !ymd ? "" : `${ymd} ~`,
      category: "",
      agency: "전남중소기업일자리경제진흥원",
    });
  }
  return out;
}

function ajaxViewUrl(detailUrl: string): string {
  return detailUrl.replace("/bbs/?", "/bbs/bbs_ajax/?");
}

export const jepaConfig: BoardConfig = {
  id: "jepa",
  label: "전남중소기업일자리경제진흥원",
  agency: "전남중소기업일자리경제진흥원",
  region: "전남",
  baseUrl: `${BASE}/`,
  charset: "utf-8",
  list: {
    url: (p) => `${BASE}${LIST}?b_id=notice&site=new_jepa&mn=426&page=${p}`,
    maxPages: 15,
    rowSelector: "#board_list table tbody tr",
    fields: {
      title: { selector: "td.t_title a" },
      detailUrl: { selector: "td.t_title a", attr: "href" },
      date: { selector: "td.t_date" },
    },
  },
  customParse: parseJepaList,
  /**
   * ★`detailContentSelector` 를 **일부러 안 적는다.**
   * 상세 ajax 조각(bs_idx=1712) 실측: 본문 `div.board_view_contents` 는 포스터 이미지 +
   * 「가입동의신청」 링크뿐이고, 진짜 공고문은 첨부 hwpx 에 있다. 짧은 표지문을
   * `targetText` 에 채우면 첨부 공고문 길을 막는다.
   * 첨부는 본문과 다른 상자 `#file_list`(`a.file_title`, href 에 `type=download`).
   *
   * 사람용 `/bbs/?type=view` 는 껍데기라(실측 136KB, `#board_wrap` 빈 칸) 엔진이 그 주소를
   * 그대로 GET 하면 첨부를 못 찾는다. `detailFetch` 가 ajax 조각만 가져와 `#file_list` 를 돌린다.
   */
  attachmentsScopeSelector: "#file_list",
  detailFetch: async (detailUrl, fetchText) => {
    const html = await fetchText(ajaxViewUrl(detailUrl));
    return parseHtml(html).querySelector("#file_list")?.outerHTML ?? "";
  },
  // 한 쪽 15건의 절반. DROP 뒤 1쪽 실측 11건. 0행이면 서식 변경.
  expectMinRows: 7,
};
