import { parseHtml, type HTMLElement } from "../html";
import type { BoardConfig, BoardRow } from "../types";

/**
 * 의정부시 기업지원센터 — 게시판 **둘**(`board_01` 공지사항 · `bus_04` 의정부시 지원사업)을
 * 한 출처가 번갈아 읽는다(안양산업진흥원 `aca.ts` 와 같은 문법).
 *
 * 왜 연결했나(2026-09-06 실측): 「의정부시 중소기업 육성 및 지원 등에 관한 조례」 제10조에
 * 근거해 **자기 공고번호로 내는 원천 공고**다(상세 본문 첫 줄 「의정부시 기업지원센터 공고
 * 제2026-016호」). 그누보드5 서버 렌더라 본문이 글자로 다 들어 있다.
 * 실측 규모: `board_01` ≈225건/15쪽(최근 30일 3건) · `bus_04` ≈105건/7쪽(최근 30일 5건).
 *
 * ★★같은 사이트의 `bus_01`(경기도지원사업)·`bus_02`(정부지원사업)는 **절대 보지 않는다** —
 *   메뉴 이름 그대로 경기도·중앙부처 공고의 재게시라 기업마당·경기도 출처와 통째로 겹친다
 *   (실측 첫 줄도 「경기도경제과학진흥원 국제물류비 지원 안내」). `board_job`(온라인채용관)도 뺀다.
 *   읽을 게시판은 아래 `BOARDS` **한 곳에서만** 정한다.
 *
 * ★게시판을 **한 쪽씩 돌아가며** 읽는다 — 1쪽=board_01 1쪽 · 2쪽=bus_04 1쪽 · 3쪽=board_01 2쪽 …
 *   그래서 `emptyStreakStop` 을 **한 바퀴의 두 배**(`2 * BOARDS.length`)로 준다.
 *   기본값 2 는 「이 게시판이 바닥났다」와 「전체가 끝났다」를 구분하지 못한다 — 한 게시판이
 *   먼저 비면 그 빈 쪽 하나와 다음 게시판의 빈 쪽 하나가 붙어 그 자리에서 끊기고, 나머지가
 *   통째로 안 들어온다. 두 배로 둬야 원래 뜻인 **「같은 게시판에서 연속 두 쪽이 빈다」**가 된다.
 *
 * 구조: 행 `div.Board_item`(붙박이 공지는 `div.Board_item.notice` + `strong.notice_icon`).
 * 제목 `a.board_title`(href 가 이미 절대주소라 `bo_table`·`wr_id` 를 거기서 그대로 읽는다 —
 * 쪽 번호로 게시판을 되짚지 않는다). 쪽 변수는 `page`. 한 쪽 15행. charset utf-8.
 */
const BASE = "https://www.uesc.or.kr";
const LIST = "/bbs/board.php";
/** 읽을 게시판. 순서가 곧 도는 순서다. **여기에 `bus_01`·`bus_02`·`board_job` 을 넣지 마라.** */
const BOARDS = [
  { code: "board_01", label: "공지사항" },
  { code: "bus_04", label: "의정부시 지원사업" },
] as const;
/** 게시판마다 몇 쪽까지 읽을지(상한 = BOARDS.length × 이 값). 월 3~5건짜리 판이라 3쪽이면 반년치다. */
const PAGES_PER_BOARD = 3;
const ROW = "div.Board_item";
/** 상세 href 에서 게시판을 그대로 읽는다 — 허용 목록 밖 게시판 글은 담지 않는다. */
const BO_TABLE = /[?&]bo_table=(\w+)/;
const WR_ID = /[?&]wr_id=(\d+)/;
/** 목록 날짜 칸은 `08-14` 처럼 **연도가 없다**(아래 `uescYmd` 가 보정한다). */
const MD = /^(\d{1,2})-(\d{1,2})$/;

/**
 * 지원사업이 아닌 글. **버릴 것만** 지정한다(허용목록은 「~ 안내」형 지원사업을 죽인다).
 * · `board_01` 1쪽에서 걸리는 셋 — 「… 최종 수혜업체 선정」·「… 수행업체 선정」·「… 선정 기업 안내」.
 * · `bus_04` 1쪽에서 걸리는 여섯 — 수요조사 2건 · 「입주의향 조사」 · 「폭염대비 … 안전조치」 ·
 *   「… 세미나 … 개최 알림」 · 「해커톤 참가자 모집안내」.
 * ★`채용` 을 통째로 버리지 않는다 — 고용보조금은 제목에 「채용」을 쓴다(bizbc·sjtp 주석).
 * ★`수행업체 모집` 은 살린다 — 「선정」이 붙은 결과 공고만 버린다.
 * ★`교육` 도 통째로 버리지 않는다 — `bus_04` 의 「… 실무교육 참여기업 모집」처럼 교육비를
 *   대 주는 지원사업이 있다.
 */
const DROP =
  /수혜업체\s*선정|수행업체\s*선정|선정\s*기업\s*안내|선정\s*결과|결과\s*발표|합격자|수요\s*조사|의향\s*조사|세미나|포럼|해커톤|폭염|안전\s*조치|입찰\s*공고|낙찰|평가위원|(?:신규|경력|직원)\s*채용\s*(?:공고|안내)/;

/** 시험이 제목 글자만으로 거르개를 잴 수 있게 내보낸다. */
export function isUescDropTitle(title: string): boolean {
  return DROP.test(title);
}

/** 엔진 쪽 번호 → 「어느 게시판의 몇 쪽」. 시험이 사상을 그대로 잴 수 있게 내보낸다. */
export function uescTargetOf(p: number): { code: string; label: string; page: number } {
  const i = Math.max(1, Math.floor(p)) - 1;
  const board = BOARDS[i % BOARDS.length];
  return { code: board.code, label: board.label, page: Math.floor(i / BOARDS.length) + 1 };
}

/** 목록 한 쪽의 주소. */
export function uescListUrl(p: number): string {
  const t = uescTargetOf(p);
  return `${BASE}${LIST}?bo_table=${t.code}&page=${t.page}`;
}

/**
 * ★여기엔 「1년 넘은 붙박이 공지는 버린다」 규칙(sjtp·koreaexim)이 **없다.**
 *
 * 쓸 수가 없어서다: 아래 `uescYmd` 가 연도를 **추정**하는데 그 결과는 늘 「올해 아니면 작년」이라
 * 나이가 구조적으로 363일을 못 넘는다 — 조건이 영영 참이 안 되는 죽은 검사가 된다.
 * 죽은 검사를 두면 「막고 있다」고 착각하게 되므로 아예 두지 않는다.
 *
 * ⚠️그래서 남는 한계: 1년 넘게 붙어 있는 붙박이 공지(실측 「2025년 의정부시 우수 기업제품
 *   참여기업 신청 안내」, 목록 표기 `02-26`)는 **올해 날짜로 저장된다.** 목록이 연도를 안 주는
 *   이상 이 자리에서는 풀 수 없다 — 상세의 네 자리 연도(`26-08-14 09:46`)를 쓰려면 엔진의
 *   상세 채움 단계에 「날짜 보정」 자리가 생겨야 한다(지금은 제목 승격 자리만 있다).
 */

/**
 * `MM-DD` 뿐인 목록 날짜에 연도를 붙인다.
 *
 * 왜 여기서 하나(2026-09-06 실측): 목록은 `08-14` 처럼 **월-일만** 주고 연도는 상세에만 있다
 * (`26-08-14 09:46`). 그런데 `customParse` 는 동기 함수라 상세를 받아올 수 없고, 엔진의 상세
 * 채움 단계에는 제목(`detailTitle`)은 있어도 **날짜를 고치는 자리가 없다**. 그래서 목록에서
 * 「올해」로 가정하되 **12월→1월 경계**를 아래처럼 처리한다.
 *
 * 규칙: 올해로 붙인 날짜가 기준 시각보다 `FUTURE_SLACK_MS` 이상 **미래**면 작년으로 내린다.
 * 게시판 글의 작성일은 미래일 수 없으므로, 1월 3일에 보이는 `12-20` 은 작년 12월이다.
 * 여유(2일)를 두는 이유: 이 판단은 UTC 로 하고 사이트는 KST(+9)라 자정 근처에서 하루가
 * 어긋난다 — 여유가 없으면 **오늘 올라온 글이 작년으로 밀린다.**
 */
const FUTURE_SLACK_MS = 2 * 24 * 3600_000;

export function uescYmd(md: string, now = Date.now()): string {
  const m = md.trim().match(MD);
  if (!m) return "";
  const mm = m[1].padStart(2, "0");
  const dd = m[2].padStart(2, "0");
  const year = new Date(now).getUTCFullYear();
  const asThisYear = Date.parse(`${year}-${mm}-${dd}T00:00:00Z`);
  if (!Number.isFinite(asThisYear)) return "";
  const y = asThisYear - now > FUTURE_SLACK_MS ? year - 1 : year;
  return `${y}-${mm}-${dd}`;
}

/** 날짜 칸만 집는다. 행 전체 글자에서 찾으면 조회수(292)와 붙는다(hsbiz 실측 함정). */
function listDateOf(item: HTMLElement): string {
  for (const sp of item.querySelectorAll("li > span")) {
    const t = sp.text.replace(/\s+/g, " ").trim();
    if (MD.test(t)) return t;
  }
  return "";
}

export function parseUescList(html: string, _page = 1, now = Date.now()): BoardRow[] {
  const out: BoardRow[] = [];
  const seen = new Set<string>();
  const allowed = new Set<string>(BOARDS.map((b) => b.code));
  for (const item of parseHtml(html).querySelectorAll(ROW)) {
    const a = item.querySelector("a.board_title");
    const href = a?.getAttribute("href") ?? "";
    /**
     * ★게시판은 **링크에서 읽는다**(쪽 번호로 되짚지 않는다). 그래야 목록 HTML 이 어떤 쪽에서
     * 왔든 주소가 어긋나지 않고, 무엇보다 `bus_01`·`bus_02` 글이 섞여 들어와도 여기서 걸린다.
     */
    const board = href.match(BO_TABLE)?.[1] ?? "";
    if (!allowed.has(board)) continue;
    const id = href.match(WR_ID)?.[1] ?? "";
    const key = `${board}#${id}`;
    if (!id || seen.has(key)) continue;
    const title = (a?.text ?? "").replace(/\s+/g, " ").trim();
    if (!title || DROP.test(title)) continue;
    const ymd = uescYmd(listDateOf(item), now);
    seen.add(key);
    out.push({
      title,
      // ★page 는 넣지 않는다 — 주소가 곧 중복 판정 열쇠(sourceId)라 쪽마다 다른 줄이 된다.
      detailUrl: `${BASE}${LIST}?bo_table=${board}&wr_id=${id}`,
      // 목록은 등록일만 준다 — 개시형(`YYYY-MM-DD ~`)으로 담는다(kodma·pipa 와 같은 갈래).
      dateText: ymd ? `${ymd} ~` : "",
      category: BOARDS.find((b) => b.code === board)?.label ?? "",
      agency: "의정부시 기업지원센터",
    });
  }
  return out;
}

export const uescConfig: BoardConfig = {
  id: "uesc",
  label: "의정부시 기업지원센터",
  agency: "의정부시 기업지원센터",
  region: "경기",
  baseUrl: `${BASE}/`,
  charset: "utf-8",
  list: {
    url: uescListUrl,
    // 게시판 2 × 3쪽. 한 쪽씩 번갈아 돈다(위 주석 ★).
    maxPages: BOARDS.length * PAGES_PER_BOARD,
    rowSelector: ROW,
    fields: {
      title: { selector: "a.board_title" },
      detailUrl: { selector: "a.board_title", attr: "href" },
      date: { selector: "li > span" },
    },
  },
  /**
   * ★★**반드시 켠다.** 엔진은 `url(1)` 과 `url(2)` 를 견줘 「값이 달라지는 변수 = 쪽 번호」로
   * 보는데(`pagingParamsOf`), 이 출처는 두 주소가 **게시판(`bo_table`)** 으로 갈려서
   * `bo_table` 을 쪽 번호로 잘못 짚는다(실측 `["bo_table"]`). 그대로 두면 저장 직전
   * (`dropUntrusted`)에 상세 주소에서 `bo_table` 이 지워져
   * `…/bbs/board.php?wr_id=274` 가 되고 — 게시판이 빠진 주소라 글을 못 연다.
   * 여기서 켜도 안전한 이유: `bo_table` 값은 **글마다 고정**이다(쪽 번호처럼 쪽마다 갈리지 않는다).
   * 값을 링크에서 그대로 읽어 박기 때문에 같은 글은 늘 같은 주소가 된다.
   */
  keepPagingParamsInDetail: true,
  /**
   * ★한 바퀴의 **두 배**를 준다(위 주석 ★). 이래야 「같은 게시판에서 연속 두 쪽이 빈다」가 되고,
   * 한 게시판이 먼저 바닥나도 나머지 게시판의 뒤쪽이 살아 들어온다.
   */
  emptyStreakStop: 2 * BOARDS.length,
  customParse: parseUescList,
  /**
   * 상세 실측(wr_id=274): 본문 `#bo_v_con`(HWP 붙여넣기 HTML 전문), 첨부 상자 `div.View_download`.
   * ⚠️알려진 흠(고치지 않음): 링크 글자가 `<strong>파일명.pdf</strong> (88.9K)` 라 수확기가 이름을
   *   「… .pdf (88.9K)」로 담고, 크기 꼬리 지우개(`SIZE_TAIL`)가 「88.9K**B**」만 알아서 안 지워진다.
   * 링크 글자가 `<strong>파일명.pdf</strong> (88.9K)` 라 이름 끝에 크기가 붙어 오는데,
   * 수확기(`detail-fill.ts`)의 크기 꼬리 지우개가 「88.9K」처럼 **`B` 없는 표기**도 지우도록
   * 넓혀 뒀다 — 안 그러면 형식이 `pdf` 가 아니라 `etc` 로 잡혀 읽는 차례가 뒤로 밀린다.
   */
  detailContentSelector: "#bo_v_con",
  attachmentsScopeSelector: "div.View_download",
  /**
   * ★첨부는 **상세 세션 쿠키가 있어야** 내려온다(2026-09-06 실측, wr_id=274&no=0):
   * · 쿠키 없이 Referer 만 붙여 받으면 200 인데 내용이
   *   `<title>오류안내 페이지 | 의정부시 기업지원센터</title>` + `alert("잘못된 접근입니다.")` HTML 이다.
   * · 상세를 먼저 GET 해 PHPSESSID 를 받아 같은 쿠키·Referer 로 다시 부르면 200 +
   *   `content-disposition: attachment` + PDF 91,052바이트(2쪽)가 온다.
   * 200 + HTML 은 성공처럼 생겨서, 이 옵션이 없으면 뒷단계가 「읽지 못한 첨부」로 적고 7일 도장을 찍는다.
   */
  attachmentSession: { warmup: "detail", referer: "detail" },
  /**
   * ★추측 단계를 끈다. 붙박이 공지 4건이 매 쪽 위에 붙고 좌측 메뉴에 다른 게시판(`bus_01`·`bus_02`)
   * 링크가 깔려 있다 — 추측 단계가 `a[href]` 를 긁으면 **거울 게시판 글이 공고로 저장되고**
   * 그 줄은 다음 회차에 지워지지 않는다(수출입은행 실측).
   */
  skipHeuristic: true,
  // `board_01` 1쪽 15행에서 DROP 3건을 뺀 12건, `bus_04` 1쪽 15행에서 6건을 뺀 9건(실측).
  // 작은 쪽(9)의 절반을 하한으로 — 0행이면 서식 변경이다.
  expectMinRows: 4,
  // 2026-09-06 실측: 미국(Railway) 차단·서울 경유 200 — 국내 경유 전용
  requiresProxy: true,
};
