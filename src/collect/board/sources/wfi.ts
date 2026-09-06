import { parseHtml } from "../html";
import type { BoardConfig, BoardRow } from "../types";

/**
 * 원주미래산업진흥원 **사업공고**(`b=B_1_14`).
 *
 * 왜 연결했나(2026-09-06 실측): 구조가 넷 중 가장 쉽다 — 서버 렌더 표, 상세 주소가 `bn` 하나로
 * 조립되고, 첨부는 쿠키 없이 **한글 파일 이름 그대로** 받아진다(PDF 533,794바이트 실수신).
 * robots 도 `Allow: /`(막는 곳은 `/manager/`·`/upload_data/` 뿐, 첨부 통로는 `/_common/` 이라 무관).
 * 약점은 양이다 — 사업공고가 통틀어 13건(월 0.8건, 최근 30일 2건). 그래도 모빌리티 ISO 인증·
 * 드론특구·원주시 화재보험 지원은 다른 출처에서 안 잡히는 원주시 자체 사업이다.
 *
 * ★이번에 붙이는 건 **사업공고(B_1_14) 한 판뿐**이다. 같은 사이트의 다른 판은 뺀다:
 *  · 공지사항 `B_1_1` — 74건이지만 대부분 GPU 팜 공사 견적·임원 초빙(입찰·채용)이고,
 *    기업 공고는 간간이 섞인다. `m_type=EMPLOYMENT|BID|OTORG` 를 빼고 COMMON 만 보는 배선이
 *    따로 필요해 이번 물결 범위 밖이다.
 *  · 국가R&D통합공고 `B_1_5` 와 `B_1_1&m_type=OTORG` 는 정의상 **거울 게시판**이라 영영 안 붙인다.
 *
 * ★강원테크노파크 공동 공고 2건(「[강원테크노파크 공통] …」·「[강원테크노파크 공동] …」)은
 *  강원TP(`gwtp`)에도 있으면 **두 줄로 들어온다 — 알고 받는다.** 저장 쪽 `dedupKey` 는
 *  「제목+기관」이라 기관이 다르면(원주미래 vs 강원TP) 원리적으로 안 접힌다(kodma 주석과 같은 사정).
 *  제목을 원문 그대로 담아 사람이 눈으로 짝을 알아볼 수 있게만 해 둔다.
 *
 * 구조(고정본 `wfi-list.html` 실측):
 * · 표 `table.tbl`, 행 `tbody tr`, 칸 5개 「No / 제목 / 작성자 / 등록일 / 조회수」.
 * · 제목 `td.tbl-tit a.link` → `view.do?b=B_1_14&bn=518&m_type=&nPage=1`.
 *   같은 칸에 첨부 표시용 `a.file` 이 하나 더 있다 — `a.link` 로 못 박아 구분한다.
 * · 등록일 `td.tbl-date`(`2026.08.18`) — 마감일 칸이 없어 「등록일 ~」 개시형이다.
 * · 쪽 변수는 `nPage`. 13건이라 실제로는 1쪽뿐이다.
 *
 * 상세: `view.do?b=B_1_14&bn=<bn>` GET 200. 제목 `div.view-title-wrap h2.title`,
 * 첨부 `div.file-area a[href="/_common/new_download_file.php?menu=boardfile&file_no=544"]`
 * (한 글에 4건 — 붙임1·2가 두 벌씩), 본문 `div.view-area`.
 *
 * ⚠️본문은 **글자가 없다** — 공고문을 통째로 그림(base64 data URI)으로 올린다(실측 상세 1.9MB,
 *   `div.view-area` 의 글자는 「이전글/다음글」뿐). 그래서 자격조건은 첨부 PDF 에서만 나온다.
 *   `detailContentSelector` 는 그림이 아니라 **글자만** 뽑으므로(engine 의 `el.text`) 저장물이
 *   1.9MB 로 부풀지는 않는다. 고정본은 그림 알맹이를 잘라 두었다(구조·개수는 그대로).
 */
const BASE = "https://wfi.or.kr";
const BOARD = "/communication";
const B = "B_1_14";
const BN = /[?&]bn=(\d+)/;
const YMD = /(20\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})/;

/**
 * 지원사업이 아닌 글. **버릴 것만** 좁게 지정한다(조사 `filterNeeded`) —
 * 허용목록(KEEP)은 「~ 안내」형 지원사업을 죽인다(hsbiz).
 *
 * ★실측 13건에는 **버릴 것이 없다.** 여기 적은 갈래(견적 제출·초빙·입찰·직원 채용)는
 *  공지사항 판(`B_1_1`)에만 있어 지금 이 수집기에는 안 들어오지만, 판이 합쳐지는 날을 대비해
 *  좁은 꼴로 미리 둔다.
 * ★`모집` 을 통째로 버리지 않는다 — 참여기업·수요기업 모집이 곧 지원사업이다.
 * ★`교육생 모집` 도 **안 버린다**(2026-09-06 독립 리뷰 반영 · kimst 와 같은 판정). 재직자·소상공인
 *  교육 지원이 기업 대상 지원사업이라 통째로 버리면 그쪽이 같이 죽는다. 실측 1건(교육발전특구
 *  진로체험 여름방학 교육생 모집)은 학생 대상이지만, 그 한 건 때문에 낱말을 통째로 버리지 않는다.
 */
const DROP = /견적\s*(?:제출|서)|초빙|입찰\s*공고|낙찰|(?:신규|경력|직원)\s*채용\s*(?:공고|안내)/;

/** 시험이 제목 글자만으로 거르개를 잴 수 있게 내보낸다. */
export function isWfiDropTitle(title: string): boolean {
  return DROP.test(title);
}

export function parseWfiList(html: string): BoardRow[] {
  const out: BoardRow[] = [];
  const seen = new Set<string>();
  for (const tr of parseHtml(html).querySelectorAll("table.tbl tbody tr")) {
    const tds = tr.querySelectorAll("td");
    if (tds.length < 5) continue; // 「게시물이 없습니다」 줄·머리글
    // ★`a.link` 로 못 박는다 — 같은 칸의 `a.file`(첨부 표시)도 같은 상세 주소를 들고 있어
    //  `td.tbl-tit a` 로 두면 어느 쪽이 걸릴지 서식 변경에 따라 뒤집힌다.
    const a = tr.querySelector("td.tbl-tit a.link");
    const bn = (a?.getAttribute("href") ?? "").match(BN)?.[1] ?? "";
    if (!bn || seen.has(bn)) continue;
    const title = (a?.text ?? "").replace(/\s+/g, " ").trim();
    if (!title || DROP.test(title)) continue;
    seen.add(bn);
    /**
     * 등록일은 **`td.tbl-date` 칸을 직접** 집는다.
     * ⚠️ 행 전체 글자(`tr.text`)에서 찾으면 안 된다 — 칸이 띄어쓰기 없이 이어 붙어
     *    번호(13)·조회수(78)가 날짜에 달라붙는다(hsbiz 실측 함정).
     */
    const d = (tr.querySelector("td.tbl-date")?.text ?? "").replace(/\s+/g, " ").trim().match(YMD);
    const ymd = d ? `${d[1]}-${d[2].padStart(2, "0")}-${d[3].padStart(2, "0")}` : "";
    out.push({
      title,
      // ★`m_type`·`nPage`·검색 인자를 떼고 `b`+`bn` 으로만 조립한다 —
      //  쪽 번호가 주소에 남으면 같은 공고가 쪽마다 다른 줄이 된다(주소가 곧 중복 열쇠).
      detailUrl: `${BASE}${BOARD}/view.do?b=${B}&bn=${bn}`,
      dateText: ymd ? `${ymd} ~` : "",
      category: "",
      agency: "원주미래산업진흥원",
    });
  }
  return out;
}

export const wfiConfig: BoardConfig = {
  id: "wfi",
  label: "원주미래산업진흥원",
  agency: "원주미래산업진흥원",
  region: "강원",
  baseUrl: `${BASE}/`,
  charset: "utf-8",
  list: {
    url: (p) => `${BASE}${BOARD}/?b=${B}&nPage=${p}`,
    // 한 쪽 20행인데 게시판 전체가 13건 — 2쪽이면 두 배로 늘어도 다 담긴다.
    maxPages: 2,
    rowSelector: "table.tbl tbody tr",
    fields: {
      title: { selector: "td.tbl-tit a.link" },
      detailUrl: { selector: "td.tbl-tit a.link", attr: "href" },
      date: { selector: "td.tbl-date" },
    },
  },
  customParse: parseWfiList,
  detailContentSelector: "div.view-area",
  /**
   * ★마감이 **첨부 PDF 안에만** 있다 — 목록은 등록일뿐이고 상세 본문은 글자가 0이다(위 ⚠️).
   *  이걸 안 켜면 등록일 기준 90일이 지난 7건(실측 13건 중 · 2026-09-06 기준)이 **첫 저장에서 바로 닫히고**,
   *  닫힌 줄은 첨부 채움 줄서기(`status:"open"`)에 못 들어가 첨부를 영영 안 읽는다 →
   *  마감도 자격조건도 영영 0. 켜면 첨부를 한 번 읽을 때까지만 유예한다(`types.ts` 주석).
   */
  deadlineInAttachments: true,
  /**
   * 첨부는 상세의 `div.file-area` 안에만 있다. 범위를 못 박아 본문·바닥글이 섞이지 않게 한다.
   * ★`attachmentsScopeRequired` 는 **켜지 않는다** — 첨부 없는 상세를 실물로 못 봤다(types.ts 주석).
   */
  attachmentsScopeSelector: "div.file-area",
  /**
   * ★heuristic 추측을 끈다. 목록 제목 칸에 첨부 표시 링크(`a.file`)가 같은 상세 주소로 붙어 있어
   * 추측 단계가 `a[href]` 를 긁으면 「첨부파일」이 제목인 줄이 함께 저장된다 —
   * 그 줄은 다음 회차에 지워지지 않는다(수출입은행 실측).
   */
  skipHeuristic: true,
  /** 13건 중 DROP 1건을 뺀 실측 12건. 서식이 깨지면 0행이 된다. */
  expectMinRows: 5,
};
