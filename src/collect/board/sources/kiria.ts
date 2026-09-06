import { parseHtml } from "../html";
import type { BoardConfig, BoardRow } from "../types";

/**
 * 한국로봇산업진흥원 사업공고(eGov 표준 게시판).
 *
 * 왜 연결했나(2026-09-06 실측): 사업공고 전용 게시판이라 채용(`portalInfoJobList.do`)·
 * 입찰(`portalInfoTenderList.do`)이 **아예 안 섞인다** — 게시판을 고른 것만으로 거르개가 거의 끝난다.
 * 총 669건(`span.page_total` = 「전체 669건 | 페이지 1/67」), 한 쪽 10행, 최근 30일 3건의 저빈도.
 * 로봇·모빌리티 업종 공고는 다른 출처에서 안 잡혀 「누락 0」에 값한다.
 *
 * 구조(고정본 `kiria-list.html` 실측):
 * · 목록 표는 `table.default_board_01`(조사 메모의 `default_board_02` 는 **상세** 표 이름이다 —
 *   실측 목록 HTML 에 `default_board_02` 는 한 번도 안 나온다).
 * · 칸 8개 「No / 제목 / 접수기간 / 상태 / 첨부 / 작성자 / 작성일 / 조회」.
 * · 제목 `td:nth-child(2) a.title`, href 가 `javascript:fn_update('IBUS_000000000001264')` —
 *   괄호 안 문자열이 상세 열쇠(`ibusCode`)다. 평범한 href 가 아니라 손으로 조립한다.
 * · **접수기간을 시작·마감 둘 다** 준다(`2026-09-01 ~ 2026-12-31`) — 등록일만 주는 게시판보다
 *   마감 정리가 정확하다.
 *
 * 상세: `portalInfoBusinessWrite.do?mode=update&ibusCode=<열쇠>` **GET 200**(화면은 POST 폼이지만
 * GET 으로 같은 문서가 온다 — 조사 단계에서 49,258바이트 실수신). 본문 `td.board_cnts`,
 * 첨부 `href="javascript:fn_egov_downFile('FILE_…','1')"` → 공용 수확기가 이미 아는 갈래라
 * (`detail-fill.ts` 의 `EGOV_DOWN`) `/cmm/fms/FileDown.do?atchFileId=…&fileSn=…` 로 풀린다.
 * 실호출 200 + `Content-Disposition: attachment` + HWP 359,936바이트(세션·쿠키 없이).
 *
 * ★사이트 안 링크에 `;jsessionid=…` 가 붙지만 **세션 없이도 전부 200** 이다(조사 실측).
 *  그래서 상세 주소를 `ibusCode` 하나로 못 박아 조립한다 — 세션 조각이 주소에 섞이면
 *  그 값이 회차마다 달라져 같은 공고가 매번 새 줄로 저장된다(주소가 곧 중복 판정 열쇠).
 */
const BASE = "https://www.kiria.org";
const LIST = "/portal/info/portalInfoBusinessList.do";
const VIEW = "/portal/info/portalInfoBusinessWrite.do";
const IBUS = /fn_update\(\s*'([A-Za-z0-9_]+)'\s*\)/;
const YMD = /(20\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})/g;

/**
 * 지원사업이 아닌 글. **버릴 것만** 좁게 지정한다 — 허용목록(KEEP)은 「~ 안내」형 지원사업을 죽인다(hsbiz).
 *
 * 실측 1·2쪽 20건 중 걸리는 것은 **한 갈래뿐**이다(조사 `filterNeeded` ①):
 * 「2027년 국제로봇콘테스트(IRC) 유치 희망 **지자체** 수요조사 공고」 — 받는 쪽이 기업이 아니라
 * 지자체라 기업 매칭에 걸리면 안 된다. 나머지 18건은 전부 기업 대상이다.
 * ★`채용`·`입찰` 은 이 게시판에 안 섞이지만(별도 게시판), 게시판이 합쳐지는 날을 대비해
 *  aca 와 같은 좁은 꼴로만 둔다 — 「채용」을 통째로 버리면 고용보조금 공고가 같이 죽는다(cwip).
 */
const DROP =
  /지자체\s*수요조사|입찰\s*공고|낙찰|선정\s*결과|결과\s*발표|(?:신규|경력|직원)\s*채용\s*(?:공고|안내)/;

/** 시험이 제목 글자만으로 거르개를 잴 수 있게 내보낸다. */
export function isKiriaDropTitle(title: string): boolean {
  return DROP.test(title);
}

export function parseKiriaList(html: string): BoardRow[] {
  const out: BoardRow[] = [];
  const seen = new Set<string>();
  for (const tr of parseHtml(html).querySelectorAll("table.default_board_01 tbody tr")) {
    const tds = tr.querySelectorAll("td");
    if (tds.length < 8) continue; // 「자료가 없습니다」 줄·머리글
    const a = tr.querySelector("td:nth-child(2) a.title");
    const code = (a?.getAttribute("href") ?? "").match(IBUS)?.[1] ?? "";
    if (!code || seen.has(code)) continue;
    const title = (a?.text ?? "").replace(/\s+/g, " ").trim();
    if (!title || DROP.test(title)) continue;
    seen.add(code);
    /**
     * 접수기간은 **`td:nth-child(3)` 칸을 직접** 집는다.
     * ⚠️ 행 전체 글자(`tr.text`)에서 찾으면 안 된다 — 칸이 띄어쓰기 없이 이어 붙어
     *    번호(669)·조회수(438)가 날짜처럼 보이는 자리를 만든다(hsbiz 실측 함정).
     */
    const term = (tds[2]?.text ?? "").replace(/\s+/g, " ").trim();
    const days = [...term.matchAll(YMD)].map(
      (m) => `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`,
    );
    const dateText =
      days.length >= 2 ? `${days[0]} ~ ${days[1]}` : days.length === 1 ? `${days[0]} ~` : "";
    // 상태(진행중·완료)는 category 에만 남긴다 — 닫힘은 접수기간 마감일이 정하게 두고(저장 규칙)
    // 이 글자로 거르지 않는다. 「완료」도 이력으로 담아 둔다(aca 와 같은 판단).
    const state = (tds[3]?.text ?? "").replace(/\s+/g, " ").trim();
    out.push({
      title,
      // ★`;jsessionid=…` 도 쪽 번호도 넣지 않는다 — 주소가 곧 중복 판정 열쇠(sourceId)다.
      detailUrl: `${BASE}${VIEW}?mode=update&ibusCode=${code}`,
      dateText,
      category: state,
      agency: "한국로봇산업진흥원",
    });
  }
  return out;
}

export const kiriaConfig: BoardConfig = {
  id: "kiria",
  label: "한국로봇산업진흥원",
  agency: "한국로봇산업진흥원",
  region: "전국",
  baseUrl: `${BASE}/`,
  charset: "utf-8",
  list: {
    // 화면은 폼 POST 지만 GET `?pageIndex=N` 이 그대로 먹는다(조사 실측: 2쪽 200 + 다른 제목 10건).
    url: (p) => `${BASE}${LIST}?pageIndex=${p}`,
    // 한 쪽 10행, 최근 30일 3건인 저빈도 게시판 — 3쪽이면 약 3개월을 덮는다.
    maxPages: 3,
    rowSelector: "table.default_board_01 tbody tr",
    fields: {
      title: { selector: "td:nth-child(2) a.title" },
      detailUrl: { selector: "td:nth-child(2) a.title", attr: "href" },
      date: { selector: "td:nth-child(3)" },
      category: { selector: "td:nth-child(4)" },
    },
  },
  customParse: parseKiriaList,
  detailContentSelector: "td.board_cnts",
  /**
   * 첨부는 상세 표(`table.default_board_02`) 안 「첨부파일」 줄에만 있다. 범위를 못 박아
   * 머리글·바닥글 링크가 섞이지 않게 한다(비즈OK 오염 사례).
   * ★`attachmentsScopeRequired` 는 **켜지 않는다** — 첨부 없는 상세를 실물로 못 봤다.
   *  실물 확인 없이 켜면 첨부 없는 공고가 매번 실패로 돌아가 본문을 받아 놓고도 버려진다(types.ts 주석).
   */
  attachmentsScopeSelector: "table.default_board_02",
  /**
   * ★heuristic 추측을 끈다. 목록 제목 링크가 전부 `href="javascript:fn_update(…)"` 라
   * 추측 단계가 `a[href]` 를 긁으면 왼쪽 메뉴·바닥글이 공고로 저장되고,
   * 그 줄은 다음 회차에 지워지지 않는다(수출입은행 실측 30줄).
   */
  skipHeuristic: true,
  /**
   * 1쪽 10행에서 DROP 1건(지자체 수요조사)을 뺀 실측 9건. 낮게 둔다 —
   * 서식이 깨지면 어차피 customParse 가 0행을 내어 「행 0개」로 걸린다.
   */
  expectMinRows: 5,
};
