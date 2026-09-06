import { parseHtml } from "../html";
import type { BoardConfig, BoardRow } from "../types";

/**
 * 서울신용보증재단 — 알림광장 > 새소식 **공지사항(STRY9788)** + 사업공고(STRY0006).
 *
 * ★2026-09-03 고침: 원래 이 칸은 `mng_cd=STRY0006`(「사업공고」) 하나만 봤다. 이름과 달리
 *   그 게시판은 **재단이 물건·용역을 사는 조달 게시판**이다 — 1~6쪽 72줄 실측이 전부
 *   입찰공고·제안평가결과·수의계약이고, 지원사업은 「골목형상점가 육성 지원 사업」 1·2차
 *   딱 둘뿐이었다. 그래서 제목 거르개를 지나면 **쪽마다 1건**만 남았다(신고된 증상).
 *   기업이 신청하는 공고 — 「안심통장 4호」 특례보증, 자영업자 고용·산재보험료 지원,
 *   자영업클리닉, 새 길 여는 폐업지원, 중소기업육성자금 분기 접수, 프렙 아카데미 —
 *   는 전부 **공지사항(STRY9788)** 에 있다. 두 게시판을 번갈아 읽는다(bepa 방식).
 *   조달 게시판의 지원사업 2건은 공지사항에도 그대로 올라오지만(bno 만 다르다) 빼지 않는다 —
 *   `dedupKey`(제목+기관)가 같아 화면에서 한 묶음으로 붙고, 값어치로 출처를 빼지 않는다는
 *   「누락 0」 방침(2026-09-03 사장님)에 맞춘다.
 *
 * 구조: `.pre_info_list_tbl.for_web table tbody tr`(PC 표만 — 같은 글이 `.for_mob` 에 한 번 더).
 * 칸은 번호|제목|작성자|작성일|첨부파일. 제목이 `<a href>` 가 아니라
 * `href="javascript:bbs.goView('{pageIndex}', '{bno}')"` 라서 상세 주소를 손으로 조립한다.
 * 쪽넘김은 사이트 JS 가 POST form 이지만 GET `?mng_cd=..&pageIndex=n` 도 같은 결과다(실측).
 * 공지사항 한 쪽 10건 + 붙박이 8건, 전체 약 148쪽. 목록은 **등록일만** 준다 — 개시형.
 *
 * ★봇 차단 없음(브라우저 UA 없이도 200). 엔진이 이미 UA 를 붙인다.
 * ★인증서 중간 사슬을 서버가 안 보낸다 — 손으로 curl 할 땐 `certs/extra-intermediates.pem`
 *   이 필요하다(운영 서버는 그 사슬을 이미 갖고 있어 수집엔 영향 없다).
 *
 * ⚠️ 붙박이(`td.notice`) 글이 본문 칸에 한 번 더 나온다. `seen` 중복 제거가 필수.
 * ⚠️ 목록 행 `td.file_add` 에 `common.download` 첨부 칸이 섞인다 — heuristic 을 끄지
 *    않으면 파일 이름을 제목으로 저장한다(한국수출입은행에서 겪음).
 */
const BASE = "https://www.seoulshinbo.co.kr";
const LIST = "/wbase/contents/bbs/list.do";
const VIEW = "/wbase/contents/bbs/view";
/** 공지사항을 **앞에** 둔다 — url(1)·url(2) 가 pageIndex 만 달라지게(엔진의 쪽변수 판정). */
const BOARDS = ["STRY9788", "STRY0006"] as const;
const PAGES_PER_BOARD = 6;
const ROW = ".pre_info_list_tbl.for_web table tbody tr";
const GO = /bbs\.goView\(\s*['"](\d+)['"]\s*,\s*['"](\d+)['"]\s*\)/;
const YMD = /(20\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})/;
/** 목록 HTML 이 스스로 자기 게시판 코드를 들고 있다 — 쪽 번호로 되짚지 않는다. */
const MNG_IN_HTML = /<input[^>]+name="mng_cd"[^>]+value="([A-Z0-9]+)"/;

/**
 * 지원사업이 아닌 글. **버릴 것만** 지정한다.
 * 실측(공지사항 1~3쪽 + 사업공고 1~6쪽): 입찰공고 · 제안평가결과 · 전자공개 수의계약 ·
 * 계약관련서식 · 임직원 사칭 사기피해 예방 · 불법브로커 개입 주의 · 고객만족도 조사 개인정보 알림.
 * ★`채용` 을 통째로 버리면 안 된다 — 고용보조금은 제목에 「채용」을 쓴다(bizbc.ts 주석).
 * ★`모집공고` 를 버리면 안 된다 — 「자영업클리닉 모집공고」가 죽는다.
 */
const DROP =
  /입찰\s*공고|제안평가결과|수의계약|계약관련서식|설문|합격자|사칭|불법브로커|만족도\s*조사/;
/**
 * 재단 내부 인사 글. 「노동이사 모집공고」·「[상임이사] 공개모집 공고」처럼 `모집공고` 를 쓰는
 * 것이 있어 낱말로 못 박는다. `제20NN인사-NN호` 는 재단 내부 인사 문서번호라 지원사업엔 안 붙는다.
 */
const DROP_STAFF =
  /평가위원|(?:신규|경력|직원|임시직)\s*채용\s*(?:공고|안내)|채용\s*공고|채용\s*현황|친인척\s*채용|노동이사|제20\d{2}인사-/;

/**
 * 붙박이 공지 중 **1년 넘게 붙어 있는 것은 버린다**(koreaexim 방식).
 * 실측 붙박이 「계약관련서식」(2024-08-21)이 이 갈래다 — DROP 에도 걸린다.
 */
const PINNED_MAX_AGE_MS = 365 * 24 * 3600_000;

export function isSeoulsinboDropTitle(title: string): boolean {
  return DROP.test(title) || DROP_STAFF.test(title);
}

/** 수집기 쪽 번호 → 게시판 코드. 앞 PAGES_PER_BOARD 쪽이 공지사항, 그다음이 사업공고. */
export function seoulsinboBoardOf(page: number): string {
  const i = Math.min(Math.max(0, Math.floor((page - 1) / PAGES_PER_BOARD)), BOARDS.length - 1);
  return BOARDS[i];
}

export function seoulsinboListUrl(page: number): string {
  const p = ((Math.max(1, page) - 1) % PAGES_PER_BOARD) + 1;
  return `${BASE}${LIST}?mng_cd=${seoulsinboBoardOf(page)}&pageIndex=${p}`;
}

export function parseSeoulsinboList(html: string, page = 1, now = Date.now()): BoardRow[] {
  const out: BoardRow[] = [];
  const seen = new Set<string>();
  // 게시판 코드는 목록 HTML 안 숨은 칸에서 읽는다 — 못 읽으면 쪽 번호로 되짚는다.
  const mng = html.match(MNG_IN_HTML)?.[1] ?? seoulsinboBoardOf(page);
  for (const tr of parseHtml(html).querySelectorAll(ROW)) {
    const a = tr.querySelector("td.t_left a");
    // 실측은 href. 조사 메모의 onclick 도 같은 함수라 둘 다 본다.
    const raw = `${a?.getAttribute("href") ?? ""} ${a?.getAttribute("onclick") ?? ""}`;
    const bno = raw.match(GO)?.[2] ?? "";
    if (!bno || seen.has(bno)) continue;
    const title = (a?.querySelector("span.ellipsis")?.text ?? a?.text ?? "")
      .replace(/\s+/g, " ")
      .trim();
    if (!title || isSeoulsinboDropTitle(title)) continue;
    /**
     * 등록일은 **4번째 td 칸을 직접** 집는다(번호|제목|작성자|작성일|첨부파일).
     * ⚠️ 행 전체 글자(`tr.text`)에서 찾으면 안 된다 — 번호 칸 「179」 + 「2026-08-05」가
     *    「1792026-08-05」로 붙는다(hsbiz 실측 함정).
     */
    const tds = tr.querySelectorAll("td");
    const dateCell = (tds[3]?.text ?? "").replace(/\s+/g, " ").trim();
    const d = dateCell.match(YMD);
    const ymd = d ? `${d[1]}-${d[2].padStart(2, "0")}-${d[3].padStart(2, "0")}` : "";
    const pinned = Boolean(tr.querySelector("td.notice"));
    // 붙박이를 나이로 건너뛸 때도 번호를 기억한다 — 같은 글이 본문 칸에 한 번 더 나온다.
    if (pinned && ymd && now - Date.parse(`${ymd}T00:00:00Z`) > PINNED_MAX_AGE_MS) {
      seen.add(bno);
      continue;
    }
    seen.add(bno);
    out.push({
      title,
      /**
       * ★상세는 `pageIndex` 가 **없으면 HTTP 500**, 값이 숫자가 아니면 400 이다
       * (2026-09-03 실측: `?mng_cd=STRY9788` 만 → 500 / `&pageIndex=1` → 200 67,692바이트).
       * 그래서 **늘 `pageIndex=1` 로 못 박는다** — goView 첫 인자(그 글을 발견한 쪽 번호)를
       * 그대로 넣으면 같은 글이 쪽마다 다른 줄로 저장된다.
       * ⚠️ 다만 엔진이 목록 주소에서 「쪽 변수」를 알아내 상세 주소에서 지우기 때문에
       *    저장될 때 이 `pageIndex=1` 이 떨어져 나간다 → 상세 채움이 500 을 받는다.
       *    고치려면 엔진에 「지우지 않을 변수」 자리가 필요하다(공용 파일이라 여기서 못 고침).
       */
      detailUrl: `${BASE}${VIEW}/${bno}.do?mng_cd=${mng}&pageIndex=1`,
      /**
       * ★붙박이(`td.notice`)는 **등록일을 개시일로 넘기지 않는다**(koreaexim 방식).
       * 이 게시판 붙박이엔 2026-02-12 짜리가 셋 있는데(자영업자 고용·산재보험료, 자영업클리닉)
       * 전부 지금도 접수 중이다. 등록일을 개시일로 넘기면 저장 쪽 `openStartExpired`
       * (개시 90일 초과)가 걸려 **저장하자마자 마감**된다 — 그 예외 `PINNED_NOTICE` 는 제목이
       * 「[공지]」로 **시작**해야만 걸리는데 이 게시판 제목은 그렇지 않다.
       * 비우면 `undatedStale`(처음 본 날 기준 90일)로 넘어가 붙어 있는 동안 모집중으로 남는다.
       * ⚠️ 같은 글이 붙박이 칸과 본문 칸에 두 번 나오는데(23384 등) `seen` 이 **붙박이를 먼저**
       *    담으므로 이 빈 날짜가 이긴다. 엔진의 쪽 사이 중복 제거(detailUrl)도 앞 쪽이 이긴다.
       */
      dateText: pinned || !ymd ? "" : `${ymd} ~`,
      category: "",
      agency: "서울신용보증재단",
    });
  }
  return out;
}

export const seoulsinboConfig: BoardConfig = {
  id: "seoulsinbo",
  label: "서울신용보증재단",
  agency: "서울신용보증재단",
  region: "서울",
  baseUrl: `${BASE}/`,
  charset: "utf-8",
  list: {
    url: seoulsinboListUrl,
    /** 공지사항 6쪽 + 사업공고 6쪽. 사업공고는 신규가 마르면 엔진이 알아서 멈춘다. */
    maxPages: BOARDS.length * PAGES_PER_BOARD,
    rowSelector: ROW,
    fields: {
      title: { selector: "td.t_left a span.ellipsis" },
      detailUrl: {
        selector: "td.t_left a",
        attr: "href",
        regex: "bbs\\.goView\\(\\s*['\"]\\d+['\"]\\s*,\\s*['\"](\\d+)['\"]",
      },
      date: { selector: "td:nth-child(4)" },
    },
  },
  customParse: parseSeoulsinboList,
  /**
   * ★`detailContentSelector` 를 **일부러 안 적는다.**
   * 상세 본문(2026-09-03 `view/23384.do` 실측)은 `textarea#editor1` 안에 공고문 **이미지**
   * 두 장(`/download/STRY9788/editorImage-….do`)뿐이고 글자는 없다. 표지문을 `targetText` 에
   * 채우면 뒷단계의 「첨부에서 본문 뽑기」가 `targetText === ""` 조건에서 이 공고를
   * 건너뛰어, 첨부 공고문 PDF 의 진짜 자격조건을 영영 못 읽는다.
   * 첨부는 PC 칸 `div.info_input_each.for_web` 안 `div.download_detail a.attach_down` 이다
   * — 모바일 칸이 한 벌 더 있어 범위를 PC 로 못 박는다.
   * ★2026-09-03: 공용 수확기가 `javascript:common.download(bno,'serial')` 을
   *   `/download/{bno}/{serial}.do?mng_cd={게시판코드}` 로 옮긴다(`/js/common/common.js` 339행).
   *   ⚠️ **게시판 코드가 없으면 HTTP 400** 이고, 그 값은 범위 밖 머리글의 `var mng_cd = "STRY9788"`
   *      에만 있다 — 그래서 수확기가 쪽 전체 HTML 을 따로 받는다(`harvestBoardAttachments` 3번째 인자).
   *   실측(안심통장 4호 `view/23384.do`): 첨부 2건(hwpx·pdf), 실제로 내려받아 공고문 전문을 읽었다.
   *   ⚠️ 이 서버는 같은 파일을 짧은 사이에 여러 번 부르면 302 로 안내 화면에 보낸다(잠깐 뒤 다시 200).
   *      그럴 때는 「읽지 못한 첨부」로 남고 다음 회차에 다시 읽힌다.
   */
  attachmentsScopeSelector: "div.info_input_each.for_web",
  /**
   * 공지사항 1쪽은 DROP 뒤 실측 11건(붙박이 6 + 본문 5). 절반보다 낮게 잡아 서식이 조금
   * 흔들려도 거짓 실패가 안 나게 하되, 옛 「1」로 두면 게시판이 통째로 바뀌어도 못 잡는다.
   */
  expectMinRows: 5,
  /**
   * 목록 행 `td.file_add` 에 첨부 파일 칸이 섞여 있다. heuristic 이 파일 링크를 공고로,
   * 파일 이름을 제목으로 저장한다 — 오류가 틀린 저장보다 낫다.
   */
  keepPagingParamsInDetail: true,
  skipHeuristic: true,
  /** 운영 서버(미국 IP)에서 연결 시간초과/빈 응답(2026-09-03 컨테이너 실측) — 국내 경유로만 연다. 변수 없으면 회차에서 빠져 화면은 「대기」. */
  requiresProxy: true,
};
