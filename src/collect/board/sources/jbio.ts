import { parseHtml } from "../html";
import type { BoardConfig, BoardRow } from "../types";

/**
 * (재)진주바이오산업진흥원 사업공고(`boardId=5`).
 *
 * 왜 연결했나(2026-09-06 실측): 「그린바이오 특화역량 BI 육성지원」·「바우처형 연구서비스」·
 * 「진주시 그린바이오 올인원 기업지원」처럼 진흥원 **자체** 공고가 올라오는 판이다(거울이 아님).
 * 양은 적다 — 1쪽 11행(공지 1 + 일반 10)에 연 8~10건, 총 약 195건.
 *
 * 구조: Java/Spring. 행 `table.basicList tbody tr`. 제목 `td.title a` 의 href 가
 * `javascript:viewData('1650');` 이고 그 함수 실측이
 * `location.href="/boardView.do?boardId=5&…&dataNo="+dataNo+"&nowPage=1&sub=02_02"` 라
 * **dataNo 로 상세 주소를 직접 조립**한다. 쪽넘김은 `&nowPage={n}`.
 * 등록일 `td.date` 는 `2026-08-21 16:52` — 시각을 떼고 「등록일 ~」 개시형으로 넘긴다.
 *
 * ★상세 주소에 `nowPage` 를 **안 싣는다.** 엔진이 목록 주소 두 개를 견줘 쪽 변수를 스스로 알아내
 *  지우기도 하지만(`pagingParamsOf`), 애초에 안 실으면 쪽마다 같은 공고가 다른 줄로 저장될 길이 없다.
 *  2026-09-06 curl 실측으로 `nowPage` 없이도 상세가 200/189,041바이트로 **똑같이** 온다(세 변형 동일).
 *
 * ★국내 회선 전용(`requiresProxy`). 미국 IP 로는 403 이고 이 맥(국내)에서는 목록·상세·첨부가 전부 200 이다.
 *  **2026-09-06 실측: 서울 VM(경유 서버)도 20초 무응답 — 데이터센터 IP 차단으로 보인다.
 *  명부는 blocked, 풀리면 자동 복귀**(설정값이 없으면 `boardSyncSources` 가 회차에서 빼 준다).
 *
 * ★robots(https://jbio.or.kr/robots.txt) 는 **목록(`/boardList.do*`)만 허용**하고
 *  상세(`/boardView.do`)·첨부(`/fileDownload.do`)는 허용 목록에 없다. 안양(aca)과 같은 관례로
 *  진행하되 명부 note 에 이 사실을 적는다(계획서 「방침 표식」 — 사장님 확인 대상).
 */
const BASE = "https://jbio.or.kr";
/** 사업공고 게시판. 25=타기관 소식(재게시라 중복)·26=채용은 **읽지 않는다**. */
const BOARD_ID = 5;
const SUB = "02_02";
const VIEW_DATA = /viewData\(\s*'(\d+)'\s*\)/;
const YMD = /(20\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})/;

/**
 * 지원사업이 아닌 글. **버릴 것만** 지정한다 — 허용목록(KEEP)은 「~ 안내」형 지원사업을 죽인다(hsbiz).
 * 실측 1쪽에 섞인 것: 「(재)진주바이오산업진흥원 구내식당 위탁사업자 입찰공고」.
 * 기관 조달(입찰·견적)은 기업 지원사업이 아니다.
 * 「평가위원」은 사람 뽑는 글이라 함께 버린다(hespa 와 같은 처리 — 2026-09-06 독립 리뷰 5번).
 *
 * ★`모집`·`공고` 를 통째로 버리면 안 된다 — 지원사업 제목이 「참여기업 모집」·「지원공고」다.
 */
const DROP = /입찰|위탁사업자|견적|평가위원/;

export function isJbioDropTitle(title: string): boolean {
  return DROP.test(title);
}

/** 상세 주소 — 쪽 변수(`nowPage`)는 싣지 않는다(위 주석 참고). */
export function jbioDetailUrl(dataNo: string): string {
  return `${BASE}/boardView.do?boardId=${BOARD_ID}&fieldNo=0&dataNo=${encodeURIComponent(dataNo)}&sub=${SUB}`;
}

export function parseJbioList(html: string): BoardRow[] {
  const out: BoardRow[] = [];
  const seen = new Set<string>();
  for (const tr of parseHtml(html).querySelectorAll("table.basicList tbody tr")) {
    const a = tr.querySelector("td.title a");
    const dataNo = (a?.getAttribute("href") ?? "").match(VIEW_DATA)?.[1] ?? "";
    if (!dataNo || seen.has(dataNo)) continue;
    const title = (a?.text ?? "").replace(/\s+/g, " ").trim();
    if (!title || isJbioDropTitle(title)) continue;
    seen.add(dataNo);
    /**
     * 등록일은 **`td.date` 칸을 직접** 집는다.
     * ⚠️ 행 전체 글자(`tr.text`)에서 찾으면 안 된다 — 번호·조회수 칸이 날짜와 붙어
     *    「1942026-07-13」이 된다(hsbiz 실측 함정).
     */
    const dateCell = (tr.querySelector("td.date")?.text ?? "").replace(/\s+/g, " ").trim();
    const d = dateCell.match(YMD);
    const ymd = d ? `${d[1]}-${d[2].padStart(2, "0")}-${d[3].padStart(2, "0")}` : "";
    out.push({
      title,
      detailUrl: jbioDetailUrl(dataNo),
      // 목록은 등록일만 준다 — 「등록일 ~」 개시형(djsinbo·kodma 와 같은 관례).
      dateText: ymd ? `${ymd} ~` : "",
      category: "",
      agency: "진주바이오산업진흥원",
    });
  }
  return out;
}

class JbioListEnd extends Error {}
function jbioListUrl(page: number): string {
  return `${BASE}/boardList.do?boardId=${BOARD_ID}&sub=${SUB}&nowPage=${page}`;
}
/** 붙박이는 마지막 쪽 다음에도 남는다. 기관 쪽수·현재 요청·빈 일반 목록을 함께 확인한다. */
function jbioListEnded(html: string, page: number): boolean {
  const root = parseHtml(html);
  const match = root.querySelector(".boardSearch .count-2")?.text.trim().match(/^(\d+)\/(\d+)$/);
  const actual = root.querySelector("input#nowPage")?.getAttribute("value");
  const empty = root.querySelectorAll("table.basicList tbody td[colspan]").some(td => /게시물이\s*없습니다/.test(td.text));
  return !!match && Number(match[1]) === page && actual === String(page)
    && Number(match[2]) >= 1 && Number(match[2]) < page && empty;
}

export const jbioConfig: BoardConfig = {
  id: "jbio",
  label: "진주바이오산업진흥원",
  agency: "진주바이오산업진흥원",
  region: "경남",
  baseUrl: `${BASE}/`,
  charset: "utf-8",
  list: {
    // 1쪽에도 `nowPage=1` 을 붙인다 — 엔진이 url(1)·url(2) 를 견줘 쪽 변수를 알아내는 길을 열어 둔다.
    url: jbioListUrl,
    // 1쪽 11행에 연 8~10건이라 3쪽이면 약 3년 치다. 더 파도 2025년 이전 글만 늘어난다.
    maxPages: 3,
    rowSelector: "table.basicList tbody tr",
    fields: {
      title: { selector: "td.title a" },
      detailUrl: { selector: "td.title a", attr: "href", regex: "viewData\\(\\s*'(\\d+)'\\s*\\)" },
      date: { selector: "td.date" },
    },
  },
  customParse: parseJbioList,
  createListSession: fetchText => async page => {
    const html = await fetchText(jbioListUrl(page));
    if (jbioListEnded(html, page)) throw new JbioListEnd();
    return html;
  },
  isListEndError: error => error instanceof JbioListEnd,
  /** 상세 본문(2026-09-06 `dataNo=1650` 실측): HWP 에서 붙여넣은 인라인 style 범벅이 `div.conText` 안에 있다. */
  detailContentSelector: "div.conText",
  /** 첨부는 `div.conField ul li a.file` → `/fileDownload.do?fileNo=…&boardId=5`. 바닥글과 섞이지 않게 범위를 좁힌다. */
  attachmentsScopeSelector: "div.conField",
  // 1쪽 11행 중 거르개(입찰)를 지나면 실측 10건. 절반(5)이면 서식 변경이 아닌데도 관문이 실패한다.
  expectMinRows: 3,
  /**
   * ★추측 단계를 끈다. 제목 링크가 전부 `javascript:viewData(…)` 라 추측 단계는 진짜 상세 주소를
   * 못 만들고, 대신 좌측 메뉴·바닥글 링크를 공고로 저장한다 — 그 줄은 다음 회차에 지워지지 않는다
   * (수출입은행에서 겪은 갈래).
   */
  skipHeuristic: true,
  /** 국내 IP 로만 열린다(위 주석). 경유 설정값이 없으면 회차에서 빠져 화면은 「대기」. */
  requiresProxy: true,
};
