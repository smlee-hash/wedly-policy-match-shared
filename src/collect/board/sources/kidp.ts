import { decodeHtmlEntities, parseHtml } from "../html";
import type { BoardConfig, BoardRow } from "../types";

/**
 * 한국디자인진흥원(KIDP) 「사업부 전체소식」(menuno=1202, boardno=622).
 *
 * 왜 이 게시판인가(2026-09-03 조사): 사이트 상단 「사업정보」 아래는 사업부 소식·대관임대·
 * 입찰정보·채용정보 넷뿐이고, **지원사업 공고만 모은 전용 게시판이 없다.** 개별 사업
 * (해외인턴지원 menuno=1207, 디자인-기술협업 menuno=1122 등)은 각자 안내 페이지만 있다.
 * 그래서 사실상 유일한 통합 소식판인 이 게시판을 붙이고, 지원사업이 아닌 글만 걸러 낸다.
 *
 * 구조: `table.board01-list > tbody > tr` (한 쪽 10건, 전체 약 1,244쪽).
 * 제목이 `<a href>` 가 아니라 `<a href='#none' onclick="return submitForm(this,'view',19221)">`
 * 이라 상세 주소를 손으로 조립한다(bizbc 방식). 전체 제목은 `title` 속성에 있다
 * (실측 80행 전부 앵커 글자와 같지만, 긴 제목이 잘리는 스킨 사고를 막으려 속성을 먼저 본다).
 *
 * ⚠️ **상세 주소에 `ztag` 가 없으면 HTTP 200 인데 본문이 0바이트로 온다**(2026-09-03 curl 실측).
 *    이 값이 게시판 번호(622)·스킨(kidp_bbs) 지정이다. `+` 는 반드시 `%2B` 로 — 날것으로 두면
 *    서버가 공백으로 읽어 역시 빈 본문이 된다.
 * ⚠️ 쪽넘김은 `pageIndex` 다. 폼의 숨은 칸 이름은 `page` 지만 GET 으로 `page=3` 을 줘도
 *    1쪽이 그대로 온다(실측: `page=3` 43,089바이트 = 1쪽, `pageIndex=3` 42,884바이트 = 3쪽).
 * ⚠️ 브라우저 UA 가 없으면 WAF 가 HTTP 400 「Request Blocked」를 준다 — 엔진이 이미 UA 를 붙인다.
 *
 * ★붙박이 공지는 **없다**(1~8쪽 실측: 번호 12436→12357 이 한 칸씩 줄고 날짜도 단조 감소).
 *   그래서 kbiz 식 「고정 행은 날짜를 비운다」 갈래를 만들지 않았다. 대신 게시가 뜸해져
 *   8쪽까지 파는 사이 오래된 글이 딸려 올 때를 나이 검사로 막는다(아래 MAX_AGE_MS).
 */
const BASE = "https://www.kidp.or.kr";
const MENU = "1202";
/** 게시판·스킨 지정값. 주소에 넣을 땐 반드시 인코딩한다(`+` → `%2B`). */
const ZTAG_RAW = 'rO0ABXQAMzxjYWxsIHR5cGU9ImJvYXJkIiBubz0iNjIyIiBza2luPSJraWRwX2JicyI+PC9jYWxsPg==';
const ZTAG = encodeURIComponent(ZTAG_RAW);
const VIEW = /submitForm\(\s*this\s*,\s*['"]view['"]\s*,\s*(\d+)/;
const YMD = /(20\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})/;

/**
 * 지원사업이 아닌 글. **버릴 것만** 좁게 지정한다(1~8쪽 80건 실측으로 뽑은 갈래만).
 * ㉠ 입찰·사전규격 — KIDP 가 발주하는 용역이라 기업이 신청할 지원사업이 아니다.
 * ㉡ 시상 심사 절차 안내(심사 참관/공개/진행/착수·국민참여심사·공개검증) — 이미 응모한 사람용.
 * ㉢ 자료 배포(가이드북·사례집·자가진단지)·행사 후기·추진 현황.
 * ㉣ 경영공시(업무추진비·징계현황·고문변호사·소송대리인).
 *
 * ★`채용` 을 통째로 버리면 안 된다(bizbc 에서 겪은 것) — 「채용 지원사업」이 같이 죽는다.
 *   사람 뽑는 글(`직원 채용`·`채용 공고`)만 아래 DROP_STAFF 로 좁게 버린다.
 * ★`사례` 도 통째로 버리지 않는다 — 「우수사례 공모전」이 죽는다. `사례집`만 버린다.
 * ★`후기` 뒤에 한글이 붙으면(「이후기간」) 버리지 않는다.
 */
const DROP =
  /입찰|사전\s*규격|설문|자가진단|가이드북|사례집|후기(?![가-힣])|추진\s*현황|공개검증|심사\s*(?:참관|공개|진행|착수|결과)|참여\s*심사|고문변호사|소송\s*(?:및|대리인)|업무추진비|징계\s*현황/;
/** 인력·용역 — 창원(cwip)·부천(bizbc)이 버리는 것과 같은 갈래. */
const DROP_STAFF =
  /평가위원|외부\s*전문가|전문가\s*풀|우선협상대상자|합격자\s*(?:발표|안내)|(?:신규|경력|직원)\s*채용|채용\s*(?:공고|안내)/;

/**
 * 등록일이 이보다 오래된 글은 담지 않는다.
 * 이 게시판은 **등록일만** 주므로 개시형(`YYYY-MM-DD ~`)으로 넘긴다 — 마감이 없어
 * 저장 단계가 「시작일 + 90일」로 닫아 주기는 하지만, 1년 지난 소식글까지 한 번 담았다가
 * 닫는 것은 헛일이다. 지금(1~8쪽 = 2026-06-09~09-02)은 한 줄도 안 걸린다.
 */
const MAX_AGE_MS = 365 * 24 * 3600_000;

export function isKidpDropTitle(title: string): boolean {
  return DROP.test(title) || DROP_STAFF.test(title);
}

export function parseKidpList(html: string, _page = 1, now = Date.now()): BoardRow[] {
  const out: BoardRow[] = [];
  const seen = new Set<string>();
  for (const tr of parseHtml(html).querySelectorAll("table.board01-list > tbody > tr")) {
    const a = tr.querySelector("td.left a");
    const bbsno = (a?.getAttribute("onclick") ?? "").match(VIEW)?.[1] ?? "";
    if (!bbsno || seen.has(bbsno)) continue;
    // 전체 제목은 `title` 속성에 있다. 없으면 앵커 글자로 되돌린다.
    const title = decodeHtmlEntities(a?.getAttribute("title") ?? "").replace(/\s+/g, " ").trim() ||
      (a?.text ?? "").replace(/\s+/g, " ").trim();
    if (!title || isKidpDropTitle(title)) continue;
    /**
     * 등록일은 **3번째 칸(td)** 을 직접 집는다(번호·제목·등록일·조회·첨부 순).
     * ⚠️ 행 전체 글자에서 정규식으로 찾으면 안 된다 — 번호 「12435」와 「2026-09-02」가
     *    「124352026-09-02」로 이어 붙는다(hsbiz 실측 함정, 시험으로 못 박아 뒀다).
     */
    const cell = (tr.querySelectorAll("td")[2]?.text ?? "").replace(/\s+/g, " ").trim();
    const d = cell.match(YMD);
    if (!d) continue;
    const ymd = `${d[1]}-${d[2].padStart(2, "0")}-${d[3].padStart(2, "0")}`;
    if (now - Date.parse(`${ymd}T00:00:00Z`) > MAX_AGE_MS) continue;
    seen.add(bbsno);
    out.push({
      title,
      // 쪽 번호(pageIndex)를 넣지 않는다 — 주소가 곧 중복 판정 열쇠(sourceId)라
      // 같은 글이 쪽마다 다른 줄로 저장된다.
      detailUrl: `${BASE}/?menuno=${MENU}&bbsno=${bbsno}&siteno=16&act=view&ztag=${ZTAG}`,
      // 목록은 등록일만 준다 — kbiz·pipa 와 같이 개시형으로 넘긴다.
      dateText: `${ymd} ~`,
      category: "",
    });
  }
  return out;
}

export const kidpConfig: BoardConfig = {
  id: "kidp",
  label: "한국디자인진흥원",
  agency: "한국디자인진흥원",
  region: "전국",
  baseUrl: `${BASE}/`,
  charset: "utf-8",
  list: {
    url: (p) => `${BASE}/?menuno=${MENU}&pageIndex=${p}`,
    // 한 쪽 10건 · 1~8쪽이 2026-06-09~09-02(약 3개월)를 덮는다.
    maxPages: 8,
    rowSelector: "table.board01-list > tbody > tr",
    fields: {
      title: { selector: "td.left a", attr: "title" },
      detailUrl: { selector: "td.left a", attr: "onclick", regex: "submitForm\\([^,]+,\\s*'view'\\s*,\\s*(\\d+)" },
      date: { selector: "td:nth-child(3)" },
    },
  },
  customParse: parseKidpList,
  /**
   * 상세 본문은 `div.bbs_list` 하나에 다 들어 있다(실측 634~962자, 도입부만 잘리는 kbiz 갈래가
   * 아니다). 첨부 원문 뽑기는 `attachmentText` 라는 다른 칸이 맡으므로 본문을 채워도 막히지 않는다.
   */
  detailContentSelector: "div.bbs_list",
  /**
   * ★첨부는 머리 표(`table.board02-list`) 안 「첨부파일」 줄에 있는데, **표 전체로 범위를 잡으면
   *   안 된다** — 같은 칸에 미리보기 iframe(`/pdfjs/web/viewer.jsp?file=…pdf`)이 있어 그 뷰어
   *   주소가 **가짜 첨부로 한 건 더** 저장된다(실측). 링크(`a`)만 범위로 잡으면 진짜 파일 하나만 남는다.
   *   보이는 단추는 `href="###"` 이고 진짜 주소는 그 옆 숨은 `<a>` 에 있다.
   */
  attachmentsScopeSelector: "table.board02-list a",
  /**
   * ★heuristic 추측 단계를 끈다. 목록 행의 앵커는 전부 `href='#none'` 이라 추측 단계가
   * 공고 주소를 하나도 못 만든다 — 대신 같은 쪽의 **왼쪽 메뉴 링크**(`/?menuno=…`)를 공고로,
   * 메뉴 이름을 제목으로 저장한다(수출입은행에서 겪은 갈래, 그 줄은 다음 회차에 안 지워진다).
   */
  skipHeuristic: true,
  /**
   * 1·2쪽 실측 생존이 3건이다(「사업부 전체소식」이라 10건 중 3~10건만 지원사업 — 1~8쪽 실측
   * 3·3·5·8·8·10·8·7). 그래서 「한 쪽의 절반」인 5로 두면 정상 회차가 「서식 깨짐」으로 버려진다.
   */
  expectMinRows: 2,
};
