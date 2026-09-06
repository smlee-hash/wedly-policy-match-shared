import { parseHtml } from "../html";
import type { BoardConfig, BoardRow } from "../types";

/**
 * 충북신용보증재단 공지사항(알림마당 > 공지사항, code=123).
 *
 * 왜 연결했나(2026-09-03 실측): 메뉴 「지원사업」(code=191)은 게시판이 아니라 신청현황
 * 한 장(접수마감 2행뿐)이다. 실제 모집공고는 공지사항에 다른 안내와 섞여 올라온다 —
 * 최근 1·2쪽 27건 중 약 70%가 경영지도 교육생 모집·Scale-Up 컨설팅 수진기업 모집·
 * 새출발 재기지원사업·소상공인 육성자금 변경 공고문이다.
 *
 * 구조: `table.table_board_basic tbody tr`. 제목 `td.td_left a` href
 * `/sub.php?code=123&mode=view&no={no}&category=&page={쪽}&search=&keyword=` —
 * **no 만** 써서 주소를 조립한다. 쪽 번호가 sourceId 에 섞이면 같은 글이 쪽마다 다른 줄로 저장된다.
 * 붙박이는 번호 칸에 `i.i_notice`(title="공지글"), 일반 행은 숫자.
 * 쪽넘김은 `?page=n` GET. 한 쪽 15건 · 전체 약 24쪽. 목록은 **등록일만** 준다
 * (`td:nth-child(5)` 「YYYY-MM-DD」) — pipa 와 같이 「등록일 ~」 개시형.
 *
 * ⚠️ 목록 행 첨부 칸에 `a[href*="download.php"]` 가 섞인다 — heuristic 을 끄지 않으면
 *    파일 링크를 공고로 저장한다(한국수출입은행에서 겪음).
 *
 * ★기본 curl UA 는 HTTP 403(오류 페이지 2641바이트). 브라우저 UA 면 200.
 *   엔진이 이미 UA 를 붙인다.
 */
const BASE = "https://www.cbsinbo.or.kr";
const LIST = "/sub.php";
const CODE = "123";
const NO = /[?&]no=(\d+)/;
const YMD = /(20\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})/;

/**
 * 지원사업이 아닌 글. **버릴 것만** 지정한다.
 * 실측 1·2쪽: 앱 이용방법(붙박이)·디지털 소외계층 안내·설문/GBSI·개인정보 제3자·
 * 경영평가 용역 알림·화재 관련 서비스 복구·착한가격업소 캠페인·우수사례 공모.
 * ★`채용` 을 통째로 버리면 안 된다 — 고용보조금은 제목에 「채용」을 쓴다(bizbc 주석).
 * ★`컨설팅` 을 버리면 안 된다 — 「Scale-Up 맞춤형 전문 컨설팅 수진기업 모집」이 1쪽에 있다.
 * ★`화재` 를 통째로 버리면 「화재피해 소상공인 지원」이 죽는다. 실측 글은 「화재 관련 … 복구 안내」다.
 */
const DROP =
  /앱\s*이용방법|디지털\s*소외계층|설문|개인정보\s*제3자|경영평가\s*용역|화재\s*관련|복구\s*안내|착한가격업소|우수사례\s*공모|입찰|평가위원|합격자/;
const DROP_STAFF = /(?:신규|경력|직원)\s*채용|채용\s*공고/;

/** 시험이 제목 글자만으로 거르개를 잴 수 있게 내보낸다. */
export function isCbsinboDropTitle(title: string): boolean {
  return DROP.test(title) || DROP_STAFF.test(title);
}

/**
 * 붙박이 공지 중 **1년 넘게 붙어 있는 것은 버린다**(koreaexim.ts 방식).
 * 날짜를 비우면 처음 본 날부터 90일간 「모집중」이 되어, 오래된 안내문이 되살아난다.
 * 실측 붙박이 3건은 2024-07-29 · 2024-08-07 · 2025-01-20.
 */
const PINNED_MAX_AGE_MS = 365 * 24 * 3600_000;

export function parseCbsinboList(html: string, _page = 1, now = Date.now()): BoardRow[] {
  const out: BoardRow[] = [];
  const seen = new Set<string>();
  for (const tr of parseHtml(html).querySelectorAll("table.table_board_basic tbody tr")) {
    const tds = tr.querySelectorAll("td");
    const a = tr.querySelector("td.td_left a");
    const id = (a?.getAttribute("href") ?? "").match(NO)?.[1] ?? "";
    if (!id || seen.has(id)) continue;
    const title = (a?.text ?? "").replace(/\s+/g, " ").trim();
    if (!title || isCbsinboDropTitle(title)) continue;
    /**
     * 등록일은 **5번째 td 칸을 직접** 집는다(번호|제목|첨부|작성자|날짜|조회).
     * ⚠️ 행 전체 글자(`tr.text`)에서 찾으면 안 된다 — 번호 칸 「351」 + 「2026-08-21」이
     *    「3512026-08-21」로 붙는다(hsbiz 실측 함정).
     */
    const dateCell = (tds[4]?.text ?? "").replace(/\s+/g, " ").trim();
    const d = dateCell.match(YMD);
    const ymd = d ? `${d[1]}-${d[2].padStart(2, "0")}-${d[3].padStart(2, "0")}` : "";
    const numText = (tds[0]?.text ?? "").replace(/\s+/g, " ").trim();
    const pinned = !!tr.querySelector("i.i_notice") || !/^\d+$/.test(numText);
    if (pinned && ymd && now - Date.parse(`${ymd}T00:00:00Z`) > PINNED_MAX_AGE_MS) continue;
    seen.add(id);
    out.push({
      title,
      // ★`page`·`category`·`search`·`keyword` 는 상세를 여는 데 필요 없다.
      //   page 를 넣으면 같은 글이 쪽마다 다른 줄로 저장된다(주소가 곧 sourceId).
      detailUrl: `${BASE}${LIST}?code=${CODE}&mode=view&no=${id}`,
      dateText: ymd ? `${ymd} ~` : "",
      category: "",
      agency: "충북신용보증재단",
    });
  }
  return out;
}

export const cbsinboConfig: BoardConfig = {
  id: "cbsinbo",
  label: "충북신용보증재단",
  agency: "충북신용보증재단",
  region: "충북",
  baseUrl: `${BASE}/`,
  charset: "utf-8",
  list: {
    url: (p) => `${BASE}${LIST}?code=${CODE}&page=${p}`,
    maxPages: 8,
    rowSelector: "table.table_board_basic tbody tr",
    fields: {
      title: { selector: "td.td_left a" },
      detailUrl: { selector: "td.td_left a", attr: "href" },
      date: { selector: "td:nth-child(5)" },
    },
  },
  customParse: parseCbsinboList,
  /**
   * 상세 실측(2026-09-03 `no=429`·`no=431`): `div.view_con` 본문은 「첨부파일 참고」 한 줄뿐이다.
   * 그 한 줄을 `targetText` 에 채우면 뒷단계의 「첨부에서 본문 뽑기」가 `targetText === ""`
   * 조건에서 이 공고를 건너뛰어, 첨부 공고문 PDF/HWP 의 진짜 자격조건을 영영 못 읽는다.
   * 선택자를 비워 첨부 길을 열어 둔다. 첨부는 본문과 다른 상자 `div.t_file`.
   */
  attachmentsScopeSelector: "div.t_file",
  /**
   * 한 쪽 15건의 절반은 7. DROP 뒤 1쪽 실측이 10건이라 7 이어도 서식 변경이 아닌데도
   * 관문이 실패하지는 않는다. 0행이면 서식 변경.
   */
  expectMinRows: 7,
  /**
   * 목록 행 첨부 칸에 파일 링크가 섞여 있다. heuristic 이 파일 링크를 공고로,
   * 파일 이름을 제목으로 저장한다 — 오류가 틀린 저장보다 낫다.
   */
  skipHeuristic: true,
};
