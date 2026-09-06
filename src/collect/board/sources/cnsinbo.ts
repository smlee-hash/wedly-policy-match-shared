import { parseHtml } from "../html";
import type { BoardConfig, BoardRow } from "../types";

/**
 * 충남신용보증재단 정보광장 공지사항(boardID=134, m=030101).
 *
 * 왜 연결했나(2026-09-03 실측): 힌트 도메인 cnsinbo.or.kr 는 DNS 미등록.
 * 실제는 www.cnsinbo.co.kr. 전용 「지원사업 공고」 칸은 없고, 최상단 메뉴 8개 중
 * 「정보광장」(boardID=134)이 공지·모집공고를 겸한다. 채용은 boardID=192 로 분리되어
 * 이 목록엔 안 섞인다. 최신 쪽에 동네창업학교·소상공인 교육·상권 활성화 패키지가 있다.
 *
 * 구조: `table.wb > tbody > tr`. 옆에 `table.mb` 는 같은 내용의 모바일 사본이라
 * `.wb` 만 읽는다. 제목이 `<a href="#contents">` 가 아니라
 * `onclick="goView('134','번호',…)"` 라서 상세 주소를 손으로 조립한다.
 * 쪽넘김은 `?page=n` GET. 한 쪽 10건 · 전체 약 57쪽. 목록은 **등록일만** 준다
 * (`td` 5번째 「작성일」 YYYY-MM-DD) — pipa 와 같이 「등록일 ~」 개시형.
 *
 * ⚠️ 제목 `title` 속성과 `<strong>`/텍스트가 같고, 댓글 수는 안쪽 `<span>[n]</span>`.
 *    `title='뷰화면이동'` 은 모바일 사본이라 쓰지 않는다.
 * ★봇 차단 없음(브라우저 UA 없이도 200). 엔진이 이미 UA 를 붙인다.
 */
const BASE = "https://www.cnsinbo.co.kr";
const LIST = "/boardCnts/list.do";
const VIEW = "/boardCnts/view.do";
const BOARD_ID = "134";
const MENU = "030101";
const SITE = "cnsinbo";
const GO = /goView\(\s*'134'\s*,\s*'(\d+)'/;
const YMD = /(20\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})/;
const ROW = "table.wb > tbody > tr";
const COMMENT = /\[\d+\]\s*$/;

/**
 * 지원사업이 아닌 글. **버릴 것만** 지정한다.
 * 실측 제목: 지점 이전 안내 · 출장사무소 확대운영 · 최종합격자 결과 안내 · 연구용역 · 개인정보.
 * ★`채용` 을 통째로 버리면 안 된다 — 고용보조금은 제목에 「채용」을 쓴다(bizbc.ts 주석).
 *   기관이 사람을 뽑는 글(`직원 채용`·`채용 공고`)만 좁게 버린다. 채용 전용 칸은 boardID=192.
 */
const DROP =
  /이전\s*안내|확대운영|출장사무소|결과\s*안내|최종합격자|연구용역|개인정보|입찰|설문|평가위원|합격자/;
const DROP_STAFF =
  /(?:신규|경력|직원)\s*채용\s*(?:공고|안내)|채용\s*공고/;

/** 붙박이 공지 중 **1년 넘게 붙어 있는 것은 버린다**(koreaexim 방식). */
const PINNED_MAX_AGE_MS = 365 * 24 * 3600_000;

export function isCnsinboDropTitle(title: string): boolean {
  return DROP.test(title) || DROP_STAFF.test(title);
}

function ymdOf(cell: string): string {
  const d = cell.replace(/\s+/g, " ").trim().match(YMD);
  return d ? `${d[1]}-${d[2].padStart(2, "0")}-${d[3].padStart(2, "0")}` : "";
}

export function parseCnsinboList(html: string, _page = 1, now = Date.now()): BoardRow[] {
  const out: BoardRow[] = [];
  const seen = new Set<string>();
  for (const tr of parseHtml(html).querySelectorAll(ROW)) {
    const a = tr.querySelector("td.link a");
    const seq = (a?.getAttribute("onclick") ?? "").match(GO)?.[1] ?? "";
    if (!seq || seen.has(seq)) continue;
    // 데스크톱 title 이 본문. 모바일 사본은 title='뷰화면이동' 이라 쓰지 않는다.
    const attr = (a?.getAttribute("title") ?? "").replace(/\s+/g, " ").trim();
    a?.querySelectorAll("span").forEach((s) => s.remove());
    const fromText = (a?.text ?? "").replace(/\s+/g, " ").trim().replace(COMMENT, "").trim();
    const title = (attr && attr !== "뷰화면이동" ? attr : fromText).replace(COMMENT, "").trim();
    if (!title || isCnsinboDropTitle(title)) continue;
    /**
     * 등록일은 **5번째 td(작성일) 칸을 직접** 집는다(번호|제목|첨부|조회수|작성일).
     * ⚠️ 행 전체 글자(`tr.text`)에서 찾으면 안 된다 — 조회수 「305」 + 「2026-08-14」가
     *    「3052026-08-14」로 붙는다(hsbiz 실측 함정).
     */
    const tds = tr.querySelectorAll("td");
    const ymd = ymdOf(tds[4]?.text ?? "");
    // 필독 아이콘만 붙박이. HOT 아이콘은 최근 글을 위에 띄운 것이라 등록일을 살린다.
    const pinned = Boolean(tr.querySelector("img[alt='필독아이콘']"));
    if (pinned && ymd && now - Date.parse(`${ymd}T00:00:00Z`) > PINNED_MAX_AGE_MS) {
      seen.add(seq);
      continue;
    }
    seen.add(seq);
    out.push({
      title,
      // ★page 는 쪽 번호라 주소에 넣으면 같은 글이 쪽마다 다른 줄로 저장된다.
      //   goView 6번째 인자(reqCurrPage)도 버린다.
      detailUrl: `${BASE}${VIEW}?m=${MENU}&action=view&boardID=${BOARD_ID}&boardSeq=${seq}&viewBoardID=${BOARD_ID}&lev=0&s=${SITE}`,
      dateText: pinned || !ymd ? "" : `${ymd} ~`,
      category: "",
      agency: "충남신용보증재단",
    });
  }
  return out;
}

export const cnsinboConfig: BoardConfig = {
  id: "cnsinbo",
  label: "충남신용보증재단",
  agency: "충남신용보증재단",
  region: "충남",
  baseUrl: `${BASE}/`,
  charset: "utf-8",
  list: {
    url: (p) => `${BASE}${LIST}?boardID=${BOARD_ID}&m=${MENU}&s=${SITE}&type=default&page=${p}`,
    maxPages: 10,
    rowSelector: ROW,
    fields: {
      title: { selector: "td.link a", attr: "title" },
      detailUrl: {
        selector: "td.link a",
        attr: "onclick",
        regex: "goView\\(\\s*'134'\\s*,\\s*'(\\d+)'",
      },
      date: { selector: "td:nth-child(5)" },
    },
  },
  customParse: parseCnsinboList,
  /**
   * ★`detailContentSelector` 를 **일부러 안 적는다.**
   * 상세 본문 `div.viewBox`(실측 boardSeq=33897)는 공고 이미지 4장뿐이라 글자가 없다.
   * 짧은 표지·alt 를 채우면 뒷단계의 「첨부에서 본문 뽑기」가 `targetText === ""` 조건에서
   * 이 공고를 영영 건너뛴다. 선택자를 비우면 첨부 PDF(`div.fieldBox` fileDown.do) 길이 열린다.
   */
  attachmentsScopeSelector: "div.fieldBox",
  // 한 쪽 10건의 절반. 거르개 뒤 실측 1쪽 7건. 0행이면 서식 변경.
  expectMinRows: 5,
  /**
   * 목록 행에 첨부 아이콘(`ic_add_file.gif`)과 모바일 사본(`table.mb`)이 섞여 있다.
   * heuristic 이 아이콘 경로·잘린 제목을 공고로 저장하지 않게 끈다.
   */
  skipHeuristic: true,
};
