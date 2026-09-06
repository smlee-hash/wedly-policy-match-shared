import { parseHtml } from "../html";
import type { BoardConfig, BoardRow } from "../types";

/**
 * 한국산업기술진흥원(KIAT) 사업공고 — 사업·자료 > 사업공고(board_id=90).
 *
 * 산업통상부 R&D·소부장 투자지원금·중견기업 금융지원·국제공동기술개발처럼
 * 기업이 직접 신청하는 사업이 한 칸에 모여 있고, 전체 2,598건 · 약 174쪽이다(2026-09-03 실측).
 *
 * ★목록 화면(`boardContentsListPage.do`)은 껍데기다 — 실측으로 확인했다.
 *   그 HTML(56,783B)의 `<div id="contentsList"></div>` 가 완전히 빈 채로 오고,
 *   같은 문서 안 `$(document).ready` 가 무조건 `$.ajax(POST, "/front/board/boardContentsListAjax.do")`
 *   로 목록 조각을 받아 채워 넣는다. 그래서 **AJAX 통로를 직접 POST 한다**(실브라우저 불필요).
 *
 * 구조:
 * · 목록 = **POST** `front/board/boardContentsListAjax.do`, 본문은 `#listFrm` 의 hidden 전부
 *   (`miv_pageNo`·`miv_pageSize`·`mode=W`·`board_id=90`·`MenuId=…`·`state_filter=W`).
 *   ⚠️ 쪽 번호가 URL 쿼리가 아니라 **form-urlencoded 본문**에 있어서 `list.init` 로 나른다(ccei·icsinbo 방식).
 * · 행 = `table.list.fixed.listTypeA > tbody > tr` (한 쪽 15건, 머리줄은 `thead` 라 안 섞인다)
 * · 제목 = `td.td_title a` — href 가 `javascript:contentsView('32자리hex')` 라 열쇠를 정규식으로 뽑아
 *   상세 주소를 손으로 조립한다(bizbc 방식).
 * · 상세 = GET `boardContentsView.do?contents_id={열쇠}&board_id=90&MenuId=…&mode=W` (실측 3건 전부 200)
 * · 날짜 = **접수기간을 시작·끝 둘 다 준다**(`td.td_app_term` 「2026-08-28~2026-09-28」).
 *   등록일(`td.td_reg_date`)은 따로 있는 별개 칸이고, 접수기간이 있으면 그것을 쓴다 —
 *   실측 「소부장 투자지원금 수정 공고」는 공고일 2026-08-21 인데 접수는 2026-07-23 부터라,
 *   공고일로 바꿔치면 이미 열려 있던 접수 시작일을 한 달 늦게 저장하게 된다.
 *
 * ★첨부는 절반이 **k-pass.kr** 로 나간다(실측: 3건 중 2건이 `https://k-pass.kr/cmm/ifsFileDown.do`,
 *   나머지는 상대 경로 `/commonfile/fileidDownLoad.do`). `allowedHosts` 에 안 적으면
 *   첨부 내려받기 명부(`attachment-text.ts`)가 그 호스트를 통째로 막아 공고문을 한 장도 못 읽는다.
 *
 * ★`skipHeuristic` 은 **안 켠다.** 목록 행에 첨부 링크가 섞이지 않고, heuristic 이 뽑는 15줄은
 *   전부 `javascript:contentsView(...)` 라 엔진의 `dropUntrusted` 가 http(s) 아닌 주소로 걸러 버린다
 *   (실측 확인) — 쓰레기를 저장할 길이 없다. 대신 KIAT 가 언젠가 진짜 href 로 바꾸면
 *   heuristic 이 마지막 방어선으로 남는다(광주TP 갈래).
 *
 * ★브라우저 UA 위장은 불필요하다(UA 없는 curl 도 200/같은 바이트). 엔진이 이미 UA 를 붙인다.
 */
const BASE = "https://www.kiat.or.kr";
const LIST_API = `${BASE}/front/board/boardContentsListAjax.do`;
const VIEW = `${BASE}/front/board/boardContentsView.do`;
const BOARD_ID = "90";
const MENU_ID = "b159c9dac684471b87256f1e25404f5e";
/** 한 쪽 몇 건을 달라고 할지. 서버가 허용하는 값은 15·20·50·100 이고 빈 값이면 기본 15. */
const PER_PAGE = 15;

/** `javascript:contentsView('86e5fd49…')` 에서 32자리 열쇠. 이름이 바뀌면 한 줄도 안 뽑는다. */
const CONTENTS_ID = /contentsView\(\s*'([a-f0-9]{32})'\s*\)/i;
const YMD = /(20\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})/g;

/**
 * 지원사업이 아닌 글. **버릴 것만** 좁게 지정한다.
 * 실측 30건(1·2쪽)에는 버릴 글이 하나도 없었지만, 같은 칸에 조달·인사 글이 섞여 올 수 있어 둔다.
 */
const DROP = /입찰|낙찰|설문\s*조사|만족도\s*조사|평가위원|심사위원|합격자|우선협상대상자|제안서\s*평가/;
/**
 * 기관이 사람을 뽑는 글.
 * ★`채용` 을 통째로 버리면 안 된다(적대 리뷰 중요) — 고용보조금은 제목에 「채용」을 쓴다.
 *   실측에서 「채용 지원사업 참여기업 모집」류가 통째로 죽었다(bizbc 주석).
 */
const DROP_STAFF =
  /(?:정규직|계약직|기간제|무기계약|신규|경력|직원|인턴)\s*채용|채용\s*(?:공고|안내|계획|절차)|채용공고|인사\s*발령/;

/** 시험이 제목 글자만으로 거르개를 잴 수 있게 내보낸다. */
export function isKiatDropTitle(title: string): boolean {
  return DROP.test(title) || DROP_STAFF.test(title);
}

/**
 * 접수기간·공고일이 다 없는 붙박이가 담기면 처음 본 날부터 90일간 「모집중」이 된다.
 * 접수기간이 없고 공고일만 1년 넘게 지난 줄은 담지 않는다(koreaexim 방식).
 * ⚠️ 접수기간이 **있는** 줄은 아무리 오래돼도 담는다 — 마감일이 있어 저절로 닫히고,
 *    이 저장소의 우선순위는 「단 1건도 놓치지 않기」다.
 */
const STALE_MAX_AGE_MS = 365 * 24 * 3600_000;

/** 칸 하나의 글자를 한 줄로 눌러 담는다. */
function cellText(el: { text?: string } | null | undefined): string {
  return (el?.text ?? "").replace(/\s+/g, " ").trim();
}

/** 칸 글자 안의 날짜를 전부 `YYYY-MM-DD` 로. */
function daysIn(cell: string): string[] {
  return [...cell.matchAll(YMD)].map((m) => `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`);
}

export function parseKiatList(html: string, _page = 1, now = Date.now()): BoardRow[] {
  const out: BoardRow[] = [];
  const seen = new Set<string>();
  for (const tr of parseHtml(html).querySelectorAll("table.list.fixed.listTypeA > tbody > tr")) {
    const a = tr.querySelector("td.td_title a");
    // href 가 `javascript:contentsView('…')` 다. 옛 서식이 onclick 을 쓸 수도 있어 둘 다 본다.
    const key = `${a?.getAttribute("href") ?? ""} ${a?.getAttribute("onclick") ?? ""}`;
    const id = key.match(CONTENTS_ID)?.[1] ?? "";
    if (!id || seen.has(id)) continue;
    const title = cellText(a);
    if (!title || isKiatDropTitle(title)) continue;

    /**
     * ⚠️ 날짜는 **칸(td) 단위**로만 집는다.
     * 행 전체 글자(`tr.text`)에서 찾으면 번호 칸 「2598」이 접수기간 앞에 붙어
     * 「25982026-08-28」이 되고 날짜를 통째로 놓친다(hsbiz 실측 함정).
     */
    const term = daysIn(cellText(tr.querySelector("td.td_app_term")));
    const reg = daysIn(cellText(tr.querySelector("td.td_reg_date")));
    let dateText = "";
    if (term.length >= 2) dateText = `${term[0]} ~ ${term[1]}`;
    else if (term.length === 1) dateText = `${term[0]} ~`;
    else if (reg.length >= 1) {
      // 접수기간이 없으면 공고일을 개시형으로. 1년 넘은 줄은 담지 않는다.
      if (now - Date.parse(`${reg[0]}T00:00:00Z`) > STALE_MAX_AGE_MS) continue;
      dateText = `${reg[0]} ~`;
    }

    seen.add(id);
    out.push({
      title,
      // ★쪽 번호를 넣지 않는다 — 주소가 곧 중복 판정 열쇠(sourceId)라 쪽마다 다른 줄이 된다.
      detailUrl: `${VIEW}?contents_id=${id}&board_id=${BOARD_ID}&MenuId=${MENU_ID}&mode=W`,
      dateText,
      category: "",
      agency: "한국산업기술진흥원",
    });
  }
  return out;
}

export const kiatConfig: BoardConfig = {
  id: "kiat",
  label: "한국산업기술진흥원(KIAT)",
  agency: "한국산업기술진흥원",
  // 산업통상부 위탁 전국 사업이다 — 지역을 박으면 지역 사전 필터에서 다른 지역 기업이 탈락한다.
  region: "전국",
  baseUrl: `${BASE}/`,
  /** 첨부가 k-pass.kr 로 나가는 공고가 절반이다(실측). 안 적으면 첨부를 한 장도 못 내려받는다. */
  allowedHosts: ["k-pass.kr"],
  charset: "utf-8",
  list: {
    // POST 라 주소는 쪽과 무관하게 같다 — 쪽 번호는 init 의 본문이 나른다.
    url: () => LIST_API,
    maxPages: 10,
    init: (p) => ({
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
      // `#listFrm` 의 hidden 전부. board_id·MenuId 가 빠지면 서버가 다른 게시판을 준다.
      body:
        `miv_pageNo=${p}&miv_pageSize=${PER_PAGE}&total_cnt=&LISTOP=&mode=W&contents_id=` +
        `&board_id=${BOARD_ID}&cate_id=&field_id=&intropage_boardUseYn=&MenuId=${MENU_ID}&state_filter=W`,
    }),
    // customParse 가 없을 때만 보는 값이지만, 서식이 바뀌면 자가수리가 여기서 출발한다.
    rowSelector: "table.list.fixed.listTypeA > tbody > tr",
    fields: {
      title: { selector: "td.td_title a" },
      detailUrl: { selector: "td.td_title a", attr: "href", regex: "contentsView\\(\\s*'([a-f0-9]{32})'\\s*\\)" },
      date: { selector: "td.td_app_term" },
    },
  },
  customParse: parseKiatList,
  /**
   * ★상세 본문을 **읽는다**(ccei·geri 와 반대). 실측 3건의 `div.viewTypeA_contents` 가
   * 5,649·6,357·7,122자이고 셋 다 「신청자격」·「지원대상」 문단을 통째로 담고 있다 —
   * 표지문 한 줄짜리가 아니라 공고문 본문이다. 첨부 PDF·HWP 도 따로 수확된다.
   */
  detailContentSelector: "div.viewTypeA_contents",
  // 첨부는 `div.view_area` 안(첨부파일 줄)에만 있다. 실측 3건 모두 그 밖에는 파일 링크가 없다.
  attachmentsScopeSelector: "div.view_area",
  // 한 쪽 15건. 거르개가 거의 안 버리므로 절반(7) 아래로 떨어지면 응답 서식이 바뀐 것으로 본다.
  expectMinRows: 7,
};
