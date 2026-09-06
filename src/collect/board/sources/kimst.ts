import { parseHtml } from "../html";
import type { BoardConfig, BoardRow } from "../types";

/**
 * 해양수산과학기술진흥원 **공지사항**.
 *
 * ★★붙일 게시판은 이름이 그럴듯한 「사업공고」가 아니라 **「공지사항」**이다(2026-09-06 실측).
 *   사업공고 게시판(`/u/news/inform_01/pjtAnuc.do`)은 11행 **전부**가 자체 상세 없이
 *   `iris.go.kr/contents/retrieveBsnsAncmView.do` 로 새 창만 여는 **IRIS 거울**이라 값이 0이다.
 *   채용공고 게시판(`/u/news/notice_03/board.do`)도 전부 직원 채용이라 뺀다.
 *   공지사항에는 IRIS 에 안 실리는 KIMST 자체 비R&D 사업 — 예비오션스타 기업 모집,
 *   해양수산신기술(NET) 인증, 혁신제품 지정, 기업은행 상생형 창업벤처 지원, 기술사업화자금
 *   대출지원 — 이 월 10~13건 올라온다. 총 1,796건(`p.bbs-total`), 마지막 쪽 180.
 *
 * 구조(고정본 `kimst-list.html`·`kimst-list-p5.html` 실측):
 * · 표 `table.table-list`, 칸 4개 「번호 / 제목 / 일자 / 조회」, 한 쪽 10행.
 * · 제목·상세링크 `td.cell-subject > a`, href 가 **상대 질의문자열**
 *   `?type=view&bno=153421765145800&searchDiv=&searchKeyword=` — 게시판 경로에 붙여 조립한다.
 * · 번호 칸은 실측 두 쪽 다 모든 행이 「공지」다(고정 공지 구분이 사실상 없다) — 번호로 못 가른다.
 * · 목록은 **일자(등록일)만** 준다 — 마감일 칸이 없어 「등록일 ~」 개시형이다.
 * · 쪽 변수는 `page`. 화면은 `fnPage(n)` 폼 제출이지만 GET `?page=5` 가 그대로 먹는다
 *   (조사 실측: 5쪽 200, 2026-05-12~04-09 구간의 다른 10건).
 *
 * ⚠️이 사이트는 Accept-Encoding 협상 없이도 gzip 을 내려보낸다 — curl 로 손수 받을 때
 *   `--compressed` 를 안 붙이면 본문이 깨진 바이너리로 보인다. 수집기 쪽 `fetch` 는
 *   압축을 알아서 푼다(조사 실측: 목록 200/205,981바이트 정상).
 *
 * 상세: `board.do?type=view&bno=<bno>` GET 200. 제목 `h3.bbs-article-title`,
 * 본문 `div.bbs-article-detail`, 첨부 `div.file-item > a[href="/fileDown.do?fn=…&dn=…"]` —
 * 평문 인자라 공용 수확기가 확장자(`.hwp`)로 바로 집는다. 실호출 200 + HWP 76,288바이트
 * (세션·쿠키 없이 Referer 만).
 */
const BASE = "https://www.kimst.re.kr";
const BOARD = "/u/news/notice_01/board.do";
const BNO = /[?&]bno=(\d+)/;
const YMD = /(20\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})/;

/**
 * 지원사업이 아닌 글. **버릴 것만** 좁게 지정한다(조사 `filterNeeded` ②) —
 * 허용목록(KEEP)은 「~ 안내」형 지원사업을 죽인다(hsbiz).
 *
 * 실측 고정본에서 걸리는 갈래(1쪽 3건 · 5쪽 3건):
 * · 「… 개인정보보호 **퀴즈 이벤트**」·「… 개인정보 **제3자 제공** 알림」
 * · 「해양수산과학기술대상 **후보자** 추가 모집 공고」
 * · 「제1회 해양수산 과학기술 혁신**포럼** 개최 안내」
 * · 「… **국제기구 인턴십** 프로그램 공고」·「… 신청에 대한 **의견수렴** 공고」
 * ★`개인정보` 단독으로는 안 버린다 — 개인정보보호 지원사업이 같이 죽는다(kodma 실측).
 * ★`채용` 을 통째로 버리지 않는다 — 고용보조금은 제목에 「채용」을 쓴다(cwip).
 * ★`행사` 를 통째로 버리지 않는다 — 실측 「현장방문행사(팸투어) **참여기업 모집공고**」는 기업 대상이다.
 * ★**세 낱말은 일부러 좁혔다**(2026-09-06 독립 리뷰 반영 — 네 수집기가 같은 판정을 하게 맞췄다):
 *  · `수요조사` → `지자체 수요조사` 만. 기업 대상 수요조사가 많아 통째로 버리면 지원사업이 죽는다
 *    (kiria 와 같은 꼴 — 받는 쪽이 지자체일 때만 버린다).
 *  · `인턴십` → `국제기구·해외 인턴십` 만. 기업이 인턴을 받는 지원사업과 갈라야 한다.
 *  · `교육생 모집` → **거르개에서 뺐다.** 재직자·소상공인 교육 지원이 기업 대상 지원사업이다.
 */
const DROP =
  /퀴즈\s*이벤트|개인정보\s*(?:파기|제3자|제공|처리방침)|후보자\s*(?:추가\s*)?(?:추천|모집|공개검증)|포럼\s*개최|(?:국제기구|해외)\s*인턴십|지자체\s*수요조사|의견수렴|(?:신규|경력|직원)\s*채용\s*(?:공고|안내)/;

/** 시험이 제목 글자만으로 거르개를 잴 수 있게 내보낸다. */
export function isKimstDropTitle(title: string): boolean {
  return DROP.test(title);
}

export function parseKimstList(html: string): BoardRow[] {
  const out: BoardRow[] = [];
  const seen = new Set<string>();
  for (const tr of parseHtml(html).querySelectorAll("table.table-list tbody tr")) {
    const tds = tr.querySelectorAll("td");
    if (tds.length < 4) continue; // 「게시물이 없습니다」 줄·머리글
    const a = tr.querySelector("td.cell-subject a");
    const bno = (a?.getAttribute("href") ?? "").match(BNO)?.[1] ?? "";
    if (!bno || seen.has(bno)) continue;
    const title = (a?.text ?? "").replace(/\s+/g, " ").trim();
    if (!title || DROP.test(title)) continue;
    seen.add(bno);
    /**
     * 일자는 **`td:nth-child(3)` 칸을 직접** 집는다.
     * ⚠️ 행 전체 글자(`tr.text`)에서 찾으면 안 된다 — 칸이 띄어쓰기 없이 이어 붙어
     *    「공지」·조회수가 날짜에 달라붙는다(hsbiz 실측 함정).
     */
    const d = (tds[2]?.text ?? "").replace(/\s+/g, " ").trim().match(YMD);
    const ymd = d ? `${d[1]}-${d[2].padStart(2, "0")}-${d[3].padStart(2, "0")}` : "";
    out.push({
      title,
      // ★빈 검색 인자(`searchDiv=&searchKeyword=`)는 떼고 `bno` 하나로 못 박는다 —
      //  검색어가 붙은 채 저장되면 같은 공고가 검색 상태마다 다른 줄이 된다(주소가 곧 중복 열쇠).
      detailUrl: `${BASE}${BOARD}?type=view&bno=${bno}`,
      dateText: ymd ? `${ymd} ~` : "",
      category: "",
      agency: "해양수산과학기술진흥원",
    });
  }
  return out;
}

export const kimstConfig: BoardConfig = {
  id: "kimst",
  label: "해양수산과학기술진흥원",
  agency: "해양수산과학기술진흥원",
  region: "전국",
  baseUrl: `${BASE}/`,
  charset: "utf-8",
  list: {
    // 화면은 `fnPage(n)` 폼 제출이지만 GET `?page=N` 이 그대로 먹는다(조사 실측 5쪽).
    url: (p) => `${BASE}${BOARD}?page=${p}`,
    // 한 쪽 10행, 월 10~13건 — 3쪽이면 약 두 달을 덮는다.
    maxPages: 3,
    rowSelector: "table.table-list tbody tr",
    fields: {
      title: { selector: "td.cell-subject a" },
      detailUrl: { selector: "td.cell-subject a", attr: "href" },
      date: { selector: "td:nth-child(3)" },
    },
  },
  customParse: parseKimstList,
  detailContentSelector: "div.bbs-article-detail",
  /**
   * 첨부는 상세 표의 「첨부파일」 줄 안 `div.file-item` 에만 있다. 범위를 못 박아
   * 본문 편집기가 심은 그림 주소(`/download.do?fn=editor_…`)·바닥글이 섞이지 않게 한다.
   * ★`attachmentsScopeRequired` 는 **켜지 않는다** — 첨부 없는 상세를 실물로 못 봤다(types.ts 주석).
   */
  attachmentsScopeSelector: "div.file-item",
  /**
   * ★heuristic 추측을 끈다. 이 판은 지원사업이 아닌 글(퀴즈 이벤트·개인정보 알림)이 섞여 있어
   * 추측 단계가 `a[href]` 를 긁으면 거르개를 지나친 글과 메뉴가 공고로 저장된다 —
   * 그 줄은 다음 회차에 지워지지 않는다(수출입은행 실측).
   */
  skipHeuristic: true,
  /** 1쪽 고정본 10행에서 DROP 3건을 뺀 실측 7건(5쪽도 DROP 3건을 뺀 7건). 서식이 깨지면 0행이 된다. */
  expectMinRows: 4,
};
