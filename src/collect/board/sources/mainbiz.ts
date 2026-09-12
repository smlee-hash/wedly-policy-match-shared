import { parseHtml, type HTMLElement } from "../html";
import type { BoardConfig, BoardRow } from "../types";

/**
 * 메인비즈협회(한국경영혁신중소기업협회) 알림마당 > 중소기업지원정보(`smem=2&gbn=2`).
 *
 * 왜 연결했나(2026-09-06 실측): 월드옥타 수출컨소시엄·중소기업중앙회 품평회처럼
 * 협단체가 기업을 모집하는 글이 이 판에만 올라온다. 서버 렌더 ASP(IIS/8.0) 라
 * JS 실행이 필요 없고 목록·상세·첨부 전부 쿠키·열쇠 없이 HTTP 200 이다.
 *
 * robots 표식: `https://www.mainbiz.or.kr/robots.txt` 는 `User-agent: *` / `Allow: /` —
 * **금지 경로 없음**(같은 물결의 이노비즈·김해의생명·포항소재와 달리 방침상 걸림돌이 없다).
 *
 * 구조: `table.board_list tbody tr`(칸 6개 — 번호|상태|제목|파일|등록일|조회).
 * 제목 `td.tit > a`, 상세 열쇠는 그 href 의 `bidx`. 쪽넘김 GET `page=n&gbn=2&smem=2` ·
 * 한 쪽 10건 · 전체 약 47쪽(마지막 페이징 링크 `?page=47`). charset utf-8(`<meta charset="UTF-8">`).
 *
 * ⚠️ 목록 주소에 빈 검색조건(`cur_pack=0&SFIELD=&GTXT=&bcate=&date_ing=`)을 붙이면
 *    HTTP 500 이다(2026-09-13 실측). 판 선택 `gbn=2&smem=2` 와 쪽 `page=n` 만 보낸다.
 *
 * ⚠️ href 를 **그대로 쓰면 안 된다.** 원문은 `…&SFIELD=&GTXT=&gbn=2…` 인데 파서가
 *    `&GT` 를 옛 이름 실체(`>`)로 풀어 `…&SFIELD=>XT=&gbn=2…` 가 된다(2026-09-06 고정본 실측).
 *    `bidx` 숫자만 뽑아 상세 주소를 손으로 조립한다 — 덤으로 `page` 도 안 섞인다
 *    (주소가 곧 중복 판정 열쇠라 쪽마다 다른 줄이 되는 것을 막는다).
 *
 * ⚠️ 제목 `a` 안에는 새 글 딱지 `<em class="new_mark">N</em>` 이 들어 있다. `a.text` 를 그대로
 *    쓰면 제목 끝에 「N」이 붙어 다른 게시판의 같은 공고와 `dedupKey` 가 갈린다 — `em` 을 뺀다.
 *
 * ★날짜는 두 자리에서 온다. **목록**은 등록일(`td.date` 「2026.09.04」)만 주므로 개시형
 *  (`YYYY-MM-DD ~`)으로 담고 — cbf·itp·ketep 와 같은 갈래 —, 진짜 접수기간은 **상세 머리의
 *  기간 칸**을 엔진 옵션 `detailApplyPeriod` 로 읽어 덮는다(아래 설정). 저장 단계의 본문 마감
 *  규칙(`store.ts` → `body-deadline.ts`)은 이 사이트를 못 읽는다 — 그 규칙의 라벨 목록
 *  (접수기간·신청기간·모집기간·공모기간)에 이 사이트의 라벨 「기간」이 없다.
 *
 * ★목록의 **상태 칸(`td.sort`)이 「종료」인 행은 담지 않는다.** 목록엔 마감일이 없어서 담으면
 *  등록일 개시형으로 90일간 「모집중」 행세를 한다(2026-09-06 적대 리뷰 보통3).
 *  「진행예정」은 담는다 — 곧 열리는 공고다.
 */
const BASE = "https://www.mainbiz.or.kr";
const LIST = "/notice/company.asp";
const BIDX = /[?&]bidx=(\d+)/;
const YMD = /(20\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})/;
const ROW = "table.board_list tbody tr";

/**
 * 지원사업이 아닌 글. **버릴 것만** 지정한다 — 허용목록은 「~ 안내」형 지원사업을 죽인다(hsbiz).
 * 실측 1쪽 10건의 갈래: 보도자료 2 · 규제 의견제출 1 · 포럼 1 · 대회 개최 1 · 교육과정 1 ·
 * 기부 모금 1 · 개인 대상 멘티 모집 1 / 기업 대상 모집 3.
 * 포상·설문·교육·행사 네 갈래에, 실측으로 확인된 네 유형(보도자료·「보러가기」·모금 안내·
 * 멘티 모집)을 더해 거른다(2026-09-06 적대 리뷰 보통6 — 거르개 뒤 7건 → 3건).
 *
 * ★`공모`·`모집` 을 통째로 버리면 안 된다 — 지원사업 공고가 그 낱말을 쓴다(kodma 주석과 같은 갈래).
 * ★`대회` 도 통째로는 못 버린다(「기술경진대회 참가기업 모집」) — `대회 개최` 안내만 친다.
 * ★`예산` 도 통째로는 못 버린다(「예산 소진 시까지」) — 예산안 보도자료(`예산안`)만 친다.
 */
const DROP =
  /포상|시상|유공|설문|실태\s*조사|포럼|세미나|웨비나|대회\s*개최|과정\s*안내|수강생\s*모집|교육생\s*모집|교육\s*프로그램|아카데미/;
/**
 * 실측 1쪽에서 확인한 「공고가 아닌 글」 네 유형.
 * · 보도자료 — 「'27년 예산안 18조 …」(신청 절차가 없다)
 * · 보러가기·모금 안내 — 「모두의 창업 2차 종합편 보러가기」·「고향사랑기부제 모금 안내」
 * · 개인 대상 멘티 모집 — 「멘토 스쿨 멘티 모집」(수혜자가 기업이 아니다)
 */
const DROP_NOTICE = /예산안|보러가기|기부제|모금\s*안내|멘티\s*모집|멘토\s*스쿨/;

/** 시험이 제목 글자만으로 거르개를 잴 수 있게 내보낸다. */
export function isMainbizDropTitle(title: string): boolean {
  return DROP.test(title) || DROP_NOTICE.test(title);
}

/**
 * 붙박이 공지 중 **1년 넘게 붙어 있는 것은 버린다**(koreaexim·sjtp 방식).
 * 이 판은 10건 중 7건이 붙박이(`td.num` 이 숫자 대신 `주요`)라 안 걸러 두면
 * 오래된 안내문이 매 회차 「모집중」으로 되살아난다.
 */
const PINNED_MAX_AGE_MS = 365 * 24 * 3600_000;

/** 새 글 딱지 `<em class="new_mark">N</em>` 을 뺀 제목. */
function titleOf(a: HTMLElement): string {
  const parts: string[] = [];
  for (const node of a.childNodes) {
    if ((node as unknown as { tagName?: string }).tagName === "EM") continue;
    parts.push(node.text);
  }
  return parts.join("").replace(/\s+/g, " ").trim();
}

type MainbizRaw = { id: string; title: string; ymd: string; pinned: boolean; sort: string };

function mainbizRawRows(html: string): MainbizRaw[] {
  const out: MainbizRaw[] = [];
  const seen = new Set<string>();
  for (const tr of parseHtml(html).querySelectorAll(ROW)) {
    const a = tr.querySelector("td.tit a");
    if (!a) continue;
    const id = (a.getAttribute("href") ?? "").match(BIDX)?.[1] ?? "";
    if (!id || seen.has(id)) continue;
    const title = titleOf(a);
    if (!title) continue;
    const sort = (tr.querySelector("td.sort")?.text ?? "").replace(/\s+/g, " ").trim();
    /**
     * 등록일은 **`td.date` 칸을 직접** 집는다.
     * ⚠️ 행 전체 글자(`tr.text`)에서 찾으면 안 된다 — 번호 「459」 + 「2026.09.02」가
     *    「4592026.09.02」로 붙는다(hsbiz 실측 함정).
     */
    const d = (tr.querySelector("td.date")?.text ?? "").replace(/\s+/g, " ").trim().match(YMD);
    const ymd = d ? `${d[1]}-${d[2].padStart(2, "0")}-${d[3].padStart(2, "0")}` : "";
    // 붙박이 판정은 CSS 가 아니라 번호 칸이다 — 숫자가 아니면(`주요`) 붙박이.
    const num = (tr.querySelector("td.num")?.text ?? "").replace(/\s+/g, " ").trim();
    const pinned = num !== "" && !/^\d+$/.test(num);
    seen.add(id);
    out.push({ id, title, ymd, pinned, sort });
  }
  return out;
}

function mainbizRow(raw: MainbizRaw): BoardRow {
  return {
    title: raw.title,
    detailUrl: `${BASE}${LIST}?bidx=${raw.id}&gbn=2&smem=2&bgbn=V`,
    dateText: raw.ymd ? `${raw.ymd} ~` : "",
    category: "",
    agency: "메인비즈협회",
  };
}

/** 거르개 전 원본. 종료·포럼 등도 제목·정규 주소·등록일을 남긴다. */
export function parseMainbizValidationList(html: string, _page = 1): BoardRow[] {
  return mainbizRawRows(html).map(mainbizRow);
}

export function parseMainbizList(html: string, _page = 1, now = Date.now()): BoardRow[] {
  const out: BoardRow[] = [];
  for (const raw of mainbizRawRows(html)) {
    if (isMainbizDropTitle(raw.title)) continue;
    /**
     * ★상태 칸이 「종료」면 담지 않는다(2026-09-06 적대 리뷰 보통3).
     * 목록엔 마감일이 없어서 담으면 등록일 개시형으로 90일간 「모집중」 행세를 한다.
     * 「진행중」·「진행예정」만 담는다 — 이미 저장된 줄은 목록에서 사라지면
     * `markStaleClosed` 가 닫는다.
     */
    if (raw.sort === "종료") continue;
    if (raw.pinned && raw.ymd && now - Date.parse(`${raw.ymd}T00:00:00Z`) > PINNED_MAX_AGE_MS) continue;
    out.push(mainbizRow(raw));
  }
  return out;
}

export const mainbizConfig: BoardConfig = {
  id: "mainbiz",
  label: "메인비즈협회",
  agency: "메인비즈협회",
  region: "전국",
  baseUrl: `${BASE}/`,
  charset: "utf-8",
  list: {
    url: (p) =>
      // 빈 검색조건은 HTTP 500. 판 선택(gbn=2, smem=2)과 쪽만 보낸다(2026-09-13 실측 200).
      `${BASE}${LIST}?page=${p}&gbn=2&smem=2`,
    maxPages: 5,
    rowSelector: ROW,
    fields: {
      title: { selector: "td.tit a" },
      detailUrl: { selector: "td.tit a", attr: "href" },
      date: { selector: "td.date" },
    },
  },
  customParse: parseMainbizList,
  validationParse: parseMainbizValidationList,
  /**
   * ★추측 단계를 끈다(2026-09-06 적대 리뷰 보통5). 이 사이트의 제목 href 는
   * `…&SFIELD=&GTXT=&gbn=2…` 인데 파서가 `&GT` 를 옛 이름 실체(`>`)로 풀어
   * `…&SFIELD=>XT=&gbn=2…` 를 준다 — 추측 단계는 그 href 를 그대로 상세 주소로 저장한다.
   */
  skipHeuristic: true,
  /**
   * 본문은 `div.board_view_con` 만 — 머리(`div.board_view_top`)를 함께 넣으면 안 된다.
   * 실측 상세(bidx=5906)의 본문은 공고 이미지 7장뿐이라 글자가 없는데, 머리를 넣으면
   * 「작성일 : … 조회 : … 기간 : …」이 본문 행세를 해 `targetText` 가 차 버리고,
   * 그러면 뒷단계의 **첨부에서 본문 뽑기**가 `targetText === ""` 조건에서 이 공고를
   * 영영 건너뛴다(cbtp 주석과 같은 갈래).
   */
  detailContentSelector: "div.board_view_con",
  /**
   * ★접수기간은 **상세 머리의 기간 칸**에서 읽는다(2026-09-06 엔진 옵션 신설).
   * 실물: `<div class="info"><span class="each">진행상태 : 진행중</span>
   *        <span class="each">기간 : <span>2026-09-04 ~ 2026-09-09</span></span></div>`
   * `strip` 이 울타리다 — 같은 상자의 「작성일 : 2026.09.04」·「조회 : 23」·「진행상태 : 진행중」은
   * 이 정규식에 안 걸려 아예 안 본다. 읽으면 applyStart·applyEnd·applyPeriodText·status 를 고친다.
   */
  detailApplyPeriod: { selector: "div.board_view_top div.info span.each", strip: /^기간\s*[::]\s*/ },
  /** 첨부는 본문과 다른 상자 `div.board_view_file` — 위쪽 메뉴·바닥글 링크가 섞이지 않게 못 박는다. */
  attachmentsScopeSelector: "div.board_view_file",
  // 최소 행은 거르개 전 원본(validationParse)에 적용한다. 거르개·종료 뒤 정책 행이
  // 1건이어도 원본 10행이 살아 있으면 서식이 멀쩡하다. 원본 0행이면 서식 변경이므로
  // 2로 둔다 — 1은 검사를 끈 것과 같다.
  expectMinRows: 2,
};
