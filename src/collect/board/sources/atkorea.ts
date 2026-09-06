import { parseHtml, type HTMLElement } from "../html";
import type { BoardConfig, BoardRow } from "../types";

/**
 * 한국농수산식품유통공사(aT) 공고 — 부서별 게시판 **네 곳**(식품사업 d00 · 유통사업 e00 ·
 * 기업지원 f00 · 수출 400)을 한 수집기가 번갈아 읽는다.
 *
 * 구조: `table#colTable tbody tr`(칸 = 번호·제목·담당부서·첨부·등록일).
 * 제목은 `td.list_tit a.subject span`, 상세는 같은 칸 `<a href='view.action?articleId=52416'>`
 * 라 **번호만 뽑아 절대 주소를 손으로 조립**한다(상대 href 를 그대로 쓰면 목록 주소의
 * 쪽 번호가 상세 주소에 묻어 같은 글이 쪽마다 다른 줄로 저장된다 — sourceId 가 곧 중복 열쇠).
 * 쪽넘김은 `?at.condition.currentPage=n` GET · 한 쪽 10건 · UTF-8.
 * ⚠️ 쪽 크기 변수는 없다(2026-09-03 실측: rowCount·pageSize·recordCountPerPage 등 7가지 전부
 *    10건 그대로) — 그래서 게시판마다 쪽을 여러 번 넘겨 읽는 수밖에 없다.
 *
 * ★aT 는 통합 게시판이 아니라 **부서별 게시판이 병렬**로 있다(모두 같은 `list.action` 서식,
 *   `apko363xxx` 조각만 다름). 2026-09-03 「누락 0」 회차에 **네 곳을 전부 켰다**:
 *   d00 식품사업(22쪽) · e00 유통사업(32쪽) · f00 기업지원(19쪽) · 400 수출(83쪽).
 *   (600 FTA·300 정부수매는 지원사업이 아니라 제도 안내·수매 공고라 아직 안 켠다.)
 *
 * ★쪽넘김은 **게시판을 한 쪽씩 돌아가며** 읽는다(`atkoreaTargetOf`, kita 방식).
 *   1쪽=d00 1 · 2쪽=e00 1 · 3쪽=f00 1 · 4쪽=400 1 · 5쪽=d00 2 · 6쪽=e00 2 …
 *   ⓐ 왜 한 게시판을 몰아(또는 두 쪽씩 묶어) 읽지 않나 — 엔진은 「신규 0인 쪽이 **연속 둘**」이면
 *      멈추는데, 그 규칙은 「이 게시판이 바닥났다」와 「전체가 끝났다」를 구분하지 못한다.
 *      한 대상의 두 쪽을 붙여 두면 그 대상 하나가 비는 순간 **뒤 대상이 통째로 잘린다**
 *      (2026-09-03 적대 리뷰 지적 ①). 한 쪽씩 돌리면 빈 쪽 사이에 다른 대상이 끼어 연속으로 안 센다.
 *   ⓑ 대신 `url(1)`·`url(2)` 의 쪽 번호가 둘 다 1 이라 엔진이 쪽 번호 변수를 못 찾는다
 *      (`pagingParamsOf` → 빈 목록). 상세 주소는 articleId 로만 조립해 **쪽 정보가 아예 없으므로**
 *      지울 것도 없다 — `deep-paging.test.ts` 의 `PAGING_WITHOUT_URL_PARAM` 에 등록해 뒀다.
 *
 * ★상세 주소는 **어느 게시판에서 읽었든 d00 경로로 못 박는다**(kita 와 같은 갈래).
 *   실측(2026-09-03, articleId=53136 은 e00 글): d00·e00·f00·400 네 경로가 전부 200 이고
 *   제목·첨부 상자(`board-file-box`)가 같다 — 바이트 차이는 메뉴 강조뿐(90,700~90,757).
 *   경로를 게시판마다 바꾸면 같은 글이 두 게시판에 걸릴 때 주소가 갈려 두 줄로 저장된다
 *   (주소가 곧 중복 판정 열쇠 `sourceId`). 예전 줄의 열쇠도 그대로 유지된다.
 *
 * ★등록일 글자가 **자바 `Date.toString()`**(「Tue Jun 02 09:38:22 KST 2026」)이다.
 *   그대로 흘리면 뒷단계 날짜 파서가 못 읽어 「기간 없음」이 되므로 여기서 `YYYY-MM-DD` 로
 *   맞춘다. 목록은 **등록일만** 주므로 pipa·geri 와 같이 「등록일 ~」 개시형으로 넘긴다.
 *
 * ★브라우저 UA 는 엔진이 이미 붙인다(registry `FETCH_UA`) — 여기서 따로 할 일이 없다.
 */
const BASE = "https://www.at.or.kr";
/** 읽을 게시판 넷. 순서가 곧 도는 순서다(앞이 자주 갱신되는 곳). */
const BOARDS = [
  { code: "apko363d00", label: "식품사업" },
  { code: "apko363e00", label: "유통사업" },
  { code: "apko363f00", label: "기업지원" },
  { code: "apko363400", label: "수출" },
] as const;
/** 게시판마다 몇 쪽까지 읽을지(상한 = BOARDS.length × 이 값). */
const PAGES_PER_BOARD = 10;
/** 상세 주소를 못 박을 게시판(위 주석 ★). 바꾸면 이미 저장된 줄의 열쇠가 통째로 갈린다. */
const VIEW_BOARD = "apko363d00";
const VIEW = `${BASE}/article/${VIEW_BOARD}/view.action`;
const ARTICLE = /[?&]articleId=(\d+)/;

/** 엔진 쪽 번호 → 「어느 게시판의 몇 쪽」. 시험이 사상을 그대로 잴 수 있게 내보낸다. */
export function atkoreaTargetOf(p: number): { board: string; label: string; page: number } {
  const i = Math.max(1, Math.floor(p)) - 1;
  // 한 바퀴에 게시판 하나씩 한 쪽(위 주석 ★ⓐ) — A1 B1 C1 D1 A2 B2 …
  const board = BOARDS[i % BOARDS.length];
  return { board: board.code, label: board.label, page: Math.floor(i / BOARDS.length) + 1 };
}

/** 자바 `Date.toString()` — 「Tue Jun 02 09:38:22 KST 2026」. 시간대 글자가 없으면 안 맞춘다. */
const JAVA_DATE =
  /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})\s+\d{1,2}:\d{2}:\d{2}\s+[A-Za-z]{2,5}(?:[+-]\d{2}:?\d{2})?\s+(20\d{2})\b/;
/** 서식이 「2026.06.02」로 바뀌어도 같은 칸에서 읽히게 둔 보조 갈래. */
const YMD = /(20\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})/;
const MONTHS: Record<string, string> = {
  Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
  Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
};

/**
 * 지원사업이 아닌 글. **버릴 것만** 좁게 지정한다.
 *
 * ㉠ `HARD_DROP` — 언제나 버린다. 입찰·낙찰·평가위원·합격자·설문·직원 채용 공고.
 * ㉡ `RESULT_DROP` — **결과 알림**이다. 실측 1·2쪽 20건 중 7건이 이 갈래였다:
 *    「김치품평회 수상작 선정결과 안내」·「정부시상 후보업체 공개」·「예선 심사 결과 안내」·
 *    「우리술 품평회 수상작 발표」·「수상작 후보 TOP 20 공개」. 신청할 수 있는 사업이 아니다.
 *    단 **모집·공모·접수·신청이 함께 적힌 글은 살린다** — 「1차 선정결과 및 2차 모집공고」처럼
 *    결과와 모집을 한 글에 담는 기관이 있어, 결과 낱말만 보고 버리면 진짜 모집이 죽는다.
 * ★`채용` 을 통째로 버리지 않는다 — 「채용 지원금 참여기업 모집」이 죽는다(bizbc 주석).
 */
const HARD_DROP = /입찰|낙찰|평가위원|심사위원\s*(?:모집|위촉)|합격자|설문\s*조사|채용\s*공고/;
/**
 * ★거르개보다 **먼저** 보는 구제 규칙(2026-09-03 적대 리뷰 지적 ⑦).
 * 「해외 공공조달 **입찰 지원사업 참여기업 모집**」·「소비자 **설문 조사 지원사업 신청기업 모집**」처럼
 * 버릴 낱말이 **사업 이름 안에** 들어 있는 진짜 모집 공고가 있다. 그런 글은 통째로 죽고 있었다.
 * 그래서 「지원사업·참여기업·신청기업…」 같은 **사업 표식**과 「모집·신청·접수·공모」가 함께 있으면
 * 거르지 않는다. 표식 없이 「평가위원 모집」·「기간제근로자 공개모집」은 그대로 걸린다.
 */
const RESCUE_SUBJECT = /지원\s*사업|참여\s*기업|신청\s*기업|참가\s*기업|참여\s*기관|지원\s*금|육성\s*사업|참가\s*업체/;
const RESCUE_ACTION = /모집|신청|접수|공모|참가/;
const RESCUE_NEVER = /용역|입찰\s*참가|채용|직원|근로자|위촉|공개\s*모집/;

/** 버릴 낱말이 있어도 「지원사업 + 모집」이면 살린다. */
export function isAtkoreaRescued(title: string): boolean {
  // 낱말이 있어도 조달·채용 글이면 구제하지 않는다 — 「지원사업 운영 용역 입찰 참가 신청 공고」·「지원사업 담당 직원 채용 공고」(코덱스 지적 2026-09-03).
  if (RESCUE_NEVER.test(title)) return false;
  return RESCUE_SUBJECT.test(title) && RESCUE_ACTION.test(title);
}
const RESULT_DROP =
  /선정\s*결과|심사\s*결과|결과\s*(?:발표|공고|안내)|수상작\s*(?:발표|공개|선정)|수상자\s*발표|후보(?:업체)?\s*(?:TOP\s*\d+\s*)?공개/;
const APPLY = /모집|공모|접수|신청|참가업체|참여기업/;

export function isAtkoreaDropTitle(title: string): boolean {
  if (isAtkoreaRescued(title)) return false;
  if (HARD_DROP.test(title)) return true;
  return RESULT_DROP.test(title) && !APPLY.test(title);
}

/**
 * 붙박이 공지 중 **1년 넘게 붙어 있는 것은 버린다**(koreaexim·geri 방식).
 * 붙박이는 날짜를 비워 저장하는데, 그러면 처음 본 날부터 90일간 「모집중」으로 되살아난다.
 */
const PINNED_MAX_AGE_MS = 365 * 24 * 3600_000;

/**
 * 등록일은 **마지막 칸(thead 「등록일」) 하나만** 읽는다.
 * ⚠️ 행 전체 글자(`tr.text`)에서 찾으면 안 된다 — 번호 칸 「218」과 날짜가
 *    「2182026-06-02」로 붙는다(hsbiz 실측 함정). 칸을 훑어 내려가지도 않는다 —
 *    제목에 든 「(~2026.4.27)」 같은 마감일을 등록일로 착각한다.
 */
/**
 * 제목 칸 글자. **「새글」 딱지를 제목으로 읽지 않는다.**
 * ⚠️ 실측(2026-09-03 유통 e00 1쪽): 최근 글은 제목 앞에 `<i class="new"><span class="hideTxt">새글</span></i>`
 *    가 붙는다. 앵커의 첫 `span` 을 집으면 그 줄의 제목이 통째로 **「새글」**이 된다 —
 *    식품(d00) 고정본은 최신 글이 2026-06 이라 딱지가 없어 이 함정이 안 보였다.
 */
function titleOf(a: HTMLElement | null): string {
  if (!a) return "";
  const spans = a
    .querySelectorAll("span")
    .filter((el) => !(el.getAttribute("class") ?? "").split(/\s+/).includes("hideTxt"));
  const raw = spans[0]?.text ?? a.text;
  /**
   * 딱지 제거는 **DOM 에서** 끝났다(위 `filter`). 아래 치환은 선택자가 바뀌어 앵커 글자로
   * 내려갔을 때의 보루인데, **앞머리 딱지 모양에만** 건다.
   * ⚠️ 경계 없이 `^(새글|NEW)` 를 지우면 「**NEW딜** 농식품 수출기업 모집」이 「딜 …」이 된다
   *    (2026-09-03 적대 리뷰 지적 ⑧). 딱지 뒤에 공백이나 끝, 또는 대괄호가 있을 때만 지운다.
   */
  return raw
    .replace(/\s+/g, " ")
    .replace(/^\s*(?:\[\s*(?:새글|NEW)\s*\]|(?:새글|NEW)(?=\s|$))\s*/i, "")
    .trim();
}

function registeredYmd(tr: HTMLElement): string {
  const cells = tr.querySelectorAll("td");
  const last = cells[cells.length - 1];
  const cell = (last?.text ?? "").replace(/\s+/g, " ").trim();
  const j = cell.match(JAVA_DATE);
  if (j) return `${j[3]}-${MONTHS[j[1]]}-${j[2].padStart(2, "0")}`;
  const y = cell.match(YMD);
  return y ? `${y[1]}-${y[2].padStart(2, "0")}-${y[3].padStart(2, "0")}` : "";
}

export function parseAtkoreaList(html: string, page = 1, now = Date.now()): BoardRow[] {
  // 어느 게시판을 읽는 중인지는 쪽 번호가 정한다 — 목록 HTML 은 네 게시판이 서식이 같아
  // 스스로를 밝히지 않는다(머리 메뉴가 형제 게시판을 전부 링크한다).
  const boardLabel = atkoreaTargetOf(page).label;
  const out: BoardRow[] = [];
  const seen = new Set<string>();
  for (const tr of parseHtml(html).querySelectorAll("table#colTable tbody tr")) {
    const a = tr.querySelector("td.list_tit a.subject") ?? tr.querySelector("td.list_tit a[href*='articleId']");
    const id = (a?.getAttribute("href") ?? "").match(ARTICLE)?.[1] ?? "";
    if (!id || seen.has(id)) continue;
    const title = titleOf(a);
    if (!title || isAtkoreaDropTitle(title)) continue;
    const ymd = registeredYmd(tr);
    // 붙박이 표식은 실측 1·2쪽에 없었다(전 행 `<tr class="">`). 서식(「공지 여부 체크」 주석)이
    // 붙박이를 예정하고 있어 두 갈래를 미리 막아 둔다 — 행 class 와 번호 칸의 「공지」.
    const num = (tr.querySelector("td")?.text ?? "").replace(/\s+/g, " ").trim();
    const pinned = num === "공지" || (tr.getAttribute("class") ?? "").split(/\s+/).includes("notice");
    if (pinned && ymd && now - Date.parse(`${ymd}T00:00:00Z`) > PINNED_MAX_AGE_MS) continue;
    seen.add(id);
    out.push({
      title,
      // ★쪽 번호를 넣지 않는다 — 주소가 곧 중복 판정 열쇠(sourceId)라 쪽마다 다른 줄이 된다.
      detailUrl: `${VIEW}?articleId=${id}`,
      dateText: pinned || !ymd ? "" : `${ymd} ~`,
      // 어느 게시판(식품사업·유통사업·기업지원·수출)에서 읽었는지 남긴다 — 화면 분류에만 쓴다.
      category: boardLabel,
      agency: "한국농수산식품유통공사",
    });
  }
  return out;
}

export const atkoreaConfig: BoardConfig = {
  id: "atkorea",
  label: "한국농수산식품유통공사(aT)",
  agency: "한국농수산식품유통공사",
  region: "전국",
  baseUrl: `${BASE}/`,
  charset: "utf-8",
  list: {
    // 게시판 넷을 두 쪽씩 번갈아(위 주석 ★). p=1·2 는 같은 게시판의 1·2쪽이라
    // 엔진이 `at.condition.currentPage` 를 쪽 번호 변수로 알아본다(pagingParamsOf).
    url: (p) => {
      const t = atkoreaTargetOf(p);
      return `${BASE}/article/${t.board}/list.action?at.condition.currentPage=${t.page}`;
    },
    /**
     * 게시판 4곳 × 10쪽 = 40 — 엔진 절대 상한(`PAGE_HARD_CAP` 40)을 꽉 채운다.
     * 실측(2026-09-03) 8쪽만 읽어도 d00 은 2022-03, e00 2023-04, f00 2018-08, 400 은 2025-01 까지
     * 내려가 「1년 안쪽 글」은 이미 다 들어온다. 10쪽은 그 위의 여유다(적대 리뷰 지적 ⑤).
     */
    maxPages: BOARDS.length * PAGES_PER_BOARD,
    rowSelector: "table#colTable tbody tr",
    fields: {
      title: { selector: "td.list_tit a.subject span" },
      detailUrl: { selector: "td.list_tit a.subject", attr: "href", regex: "articleId=(\\d+)" },
      // 등록일은 마지막 칸이다. 선택자 단계(customParse 가 죽었을 때의 대비)에서도 칸 하나만 보게.
      date: { selector: "td:last-of-type" },
    },
  },
  customParse: parseAtkoreaList,
  /**
   * ★목록 행의 「첨부」 칸에 `<a href="/download.action?attachId=…">` 가 행마다 들어 있다.
   * customParse 가 죽어 추측 단계로 내려가면 그 파일 링크를 공고로, 파일 이름을 제목으로
   * 저장한다(수출입은행 실측 30줄) — 그 줄은 다음 회차에도 안 지워진다. 그래서 끈다.
   */
  skipHeuristic: true,
  /**
   * ★`detailContentSelector` 를 **일부러 안 적는다**(kbiz·geri 와 같은 갈래).
   * 상세 본문(`div.board-view-content-box`)은 실측(articleId=52416) 「안녕하십니까 …
   * 접수가 시작되었습니다 … 문의 061-931-0733」 인사말 **188자**뿐이고, 자격·지원내용은 전부
   * 첨부 공고문 PDF 에 있다. 그 인사말을 `targetText` 에 채우면 뒷단계의 「첨부에서 본문 뽑기」가
   * `targetText === ""` 조건에서 이 공고를 영영 건너뛴다. 선택자를 비워 첨부 길을 열어 둔다.
   * 첨부는 본문과 다른 상자(`div.board-file-box`)에 있어 범위를 그쪽으로 못 박는다 —
   * 안 막으면 본문 미리보기 iframe·바닥글까지 첨부로 걷힌다. 실측(2026-09-03): 상세 97,666바이트
   * 중 첨부 상자 2,660바이트에서 공고문 PDF·신청서 HWP 두 개만 정확히 걷혔다.
   */
  attachmentsScopeSelector: "div.board-file-box",
  /**
   * ★낮게 둔다(3). 이 값은 **첫 쪽(식품사업 1쪽) 하나로 출처 전체의 채택 여부**를 가른다 —
   * 그 쪽에 결과 발표 글이 몰린 날 게시판 넷이 통째로 실패한다(2026-09-03 적대 리뷰 지적 ⑥).
   * 서식이 깨지면 어차피 customParse 가 0행을 내어 「행 0개」로 걸린다.
   */
  expectMinRows: 3,
};
