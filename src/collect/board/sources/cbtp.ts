import { parseHtml } from "../html";
import type { BoardConfig, BoardRow } from "../types";

/**
 * 충북테크노파크 사업공고(알림마당 > 사업공고, board_id=saup_notice).
 *
 * 왜 연결했나(2026-09-03 실측): 목록 1쪽 15건이 대체인력·AI 융합·장비멘토·IP투자연계·
 * 오픈랩 공유오피스처럼 기업이 신청하는 지원사업이다. 접수기간을 시작·끝 둘 다 준다.
 *
 * 구조: `table.bbs_default_list tbody tr.notice`.
 * ★`notice` 는 공지고정이 아니라 **모든 목록 행**에 붙는 CSS 클래스다.
 *   붙박이(접수중)는 번호 칸에 `alt="공지"` 아이콘, 일반 행은 숫자(1663…).
 * 제목 `td.subject a`(앵커 앞에 공백 1칸 — trim). href 의 `no` 는 숫자(`307`)와
 * `contact_2590` 두 형식이 섞인다. **no·lm_uid 만** 써서 상세 주소를 조립한다.
 * 원문 href 의 `page`·`offset` 이 sourceId 에 섞이면 같은 글이 쪽마다 다른 줄로 저장된다.
 * 쪽넘김 GET `page=n&offset=(n-1)*15+1&task=list`. 한 쪽 15건 · 전체 약 112쪽.
 * 목록은 **접수기간**(마지막 td, `YYYY-MM-DD ~ <br/>YYYY-MM-DD`).
 *
 * charset 은 euc-kr(실측). 브라우저 UA 없이도 HTTP 200 — 엔진이 이미 UA 를 붙인다.
 *
 * 상세 실측(`no=307`): 본문 `td.substance` 는 공고 이미지 + 숨김 칸 `-` 뿐이다.
 * 그 한 줄을 본문으로 채우면 뒷단계의 「첨부에서 본문 뽑기」가 `targetText === ""`
 * 조건에서 이 공고를 건너뛰어, 첨부 PDF/ZIP 의 진짜 자격조건을 영영 못 읽는다.
 * 선택자를 비워 첨부 길을 연다. 첨부는 `table.bbs_view ul.attach`.
 */
const BASE = "https://www.cbtp.or.kr";
const LIST = "/index.php";
const BOARD = "saup_notice";
const LM = "387";
const PER_PAGE = 15;
const NO = /[?&]no=([^&]+)/;
const NO_OK = /^[A-Za-z0-9_]+$/;
const YMD = /(20\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})/g;

/**
 * 지원사업이 아닌 글. **버릴 것만** 지정한다.
 * 실측 1·2쪽 DROP 후보는 없다. 입찰·설문·평가위원·합격자·채용 공고만 좁게.
 * ★`채용` 을 통째로 버리면 안 된다 — 고용보조금은 제목에 「채용」을 쓴다(bizbc.ts 주석).
 */
const DROP = /입찰|설문|평가위원|합격자/;
const DROP_STAFF = /(?:신규|경력|직원)\s*채용\s*(?:공고|안내)|채용\s*공고/;

/** 시험이 제목 글자만으로 거르개를 잴 수 있게 내보낸다. */
export function isCbtpDropTitle(title: string): boolean {
  return DROP.test(title) || DROP_STAFF.test(title);
}

/**
 * 붙박이 공지 중 **1년 넘게 붙어 있는 것은 버린다**(koreaexim.ts 방식).
 * 날짜를 비우면 처음 본 날부터 90일간 「모집중」이 되어, 오래된 안내문이 되살아난다.
 * 판정은 CSS `tr.notice` 가 아니라 번호 칸의 공지 아이콘이다.
 */
const PINNED_MAX_AGE_MS = 365 * 24 * 3600_000;

function ymdList(raw: string): string[] {
  return [...raw.matchAll(YMD)].map(
    (m) => `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`,
  );
}

export function parseCbtpList(html: string, _page = 1, now = Date.now()): BoardRow[] {
  const out: BoardRow[] = [];
  const seen = new Set<string>();
  for (const tr of parseHtml(html).querySelectorAll("table.bbs_default_list tbody tr.notice")) {
    const a = tr.querySelector("td.subject a");
    const id = decodeURIComponent((a?.getAttribute("href") ?? "").match(NO)?.[1] ?? "");
    if (!id || !NO_OK.test(id) || seen.has(id)) continue;
    const title = (a?.text ?? "").replace(/\s+/g, " ").trim();
    if (!title || isCbtpDropTitle(title)) continue;
    const tds = tr.querySelectorAll("td");
    /**
     * 접수기간은 **마지막 td 칸을 직접** 집는다(번호|상태|제목|파일|주관기관명|접수기간).
     * ⚠️ 행 전체 글자(`tr.text`)에서 찾으면 안 된다 — 번호 칸 「1663」 + 「2026-08-18」이
     *    「16632026-08-18」로 붙는다(hsbiz 실측 함정).
     */
    const dateCell = tds[tds.length - 1];
    const period = (dateCell?.innerHTML ?? dateCell?.text ?? "").replace(/<[^>]+>/g, " ");
    const days = ymdList(period);
    const dateText =
      days.length >= 2 ? `${days[0]} ~ ${days[1]}` : days.length === 1 ? `${days[0]} ~` : "";
    const pinned = (tr.querySelector("td.gray img")?.getAttribute("alt") ?? "") === "공지";
    const ageFrom = days[0];
    if (pinned && ageFrom && now - Date.parse(`${ageFrom}T00:00:00Z`) > PINNED_MAX_AGE_MS) continue;
    seen.add(id);
    out.push({
      title,
      detailUrl: `${BASE}${LIST}?control=bbs&board_id=${BOARD}&mode=view&no=${id}&lm_uid=${LM}`,
      dateText,
      category: (tds[4]?.text ?? "").replace(/\s+/g, " ").trim(),
      agency: "충북테크노파크",
    });
  }
  return out;
}

export const cbtpConfig: BoardConfig = {
  id: "cbtp",
  label: "충북테크노파크",
  agency: "충북테크노파크",
  region: "충북",
  baseUrl: `${BASE}/`,
  charset: "euc-kr",
  list: {
    url: (p) =>
      `${BASE}${LIST}?control=bbs&board_id=${BOARD}&mode=list&lm_uid=${LM}&page=${p}&offset=${(p - 1) * PER_PAGE + 1}&task=list`,
    maxPages: 10,
    rowSelector: "table.bbs_default_list tbody tr.notice",
    fields: {
      title: { selector: "td.subject a" },
      detailUrl: { selector: "td.subject a", attr: "href" },
      date: { selector: "td:last-child" },
    },
  },
  customParse: parseCbtpList,
  /**
   * 상세 본문 `td.substance` 는 공고 이미지 + `-` 뿐이라 채우면 첨부 공고문을 건너뛴다.
   * 첨부는 본문과 다른 상자 `ul.attach`. 상세 페이지 아래쪽에 목록 표가 또 있어
   * `table.bbs_view` 안으로 범위를 좁힌다.
   */
  attachmentsScopeSelector: "table.bbs_view ul.attach",
  /** 상자가 사라지면 서식 변경이다 — 실측 4건(no=303~306) 전부 이 상자가 있다. */
  attachmentsScopeRequired: true,
  /**
   * ★`charset: "euc-kr"` 는 목록·상세를 읽는 데만이 아니라 **첨부 주소를 만드는 데도** 쓰인다.
   * 첨부 href 는 파일 이름을 날 한글로 들고 있는데(`…&file=붙임1. … 공고문.pdf`), 표준대로
   * UTF-8 로 인코딩해 부르면 200 + `text/html` 452바이트(「요청하신 파일이 존재하지 않습니다」)고
   * 같은 이름을 euc-kr 로 인코딩해야 200 + `attachment` + PDF 799,373바이트가 온다
   * (2026-09-06 curl 실측 `no=307`). 처리는 `board/attachment-url.ts`.
   */
  /** 한 쪽 15건의 절반. DROP 뒤에도 서식 변경이 아니면 관문이 실패하지 않게. */
  expectMinRows: 7,
};
