import { parseHtml } from "../html";
import type { BoardConfig, BoardRow } from "../types";

/**
 * 하남시 기업지원포털 「공지사항」(`bbsNo=1632`).
 *
 * 왜 시청 주소인가(2026-09-06 실측): 하남시 산하 산업진흥원·기업지원재단은 **존재 근거를
 * 못 찾았다**(설립 추진 중이라는 근거도 없다). 실제 있는 것은 시청이 직접 운영하는
 * 하남기업지원포털(`hanam.go.kr/biz`)과 별도 호스트의 하남시사회적경제지원센터다.
 *
 * ★★같은 포털의 「기업지원사업」 메뉴(`selectEntrprsSportBsnsApiList.do?key=5986`)는
 *   **절대 보지 않는다** — 하남 공고가 아니라 기업마당(bizinfo) 통짜 거울이다(실측:
 *   응답 121,344바이트 안에 `bizinfo.go.kr` 링크 79개, 페이지 title 이 「중앙정부 - 기업지원포털」,
 *   모든 상세 링크가 `bizinfo.go.kr/sii/siia/selectSIIA200Detail.do?pblancId=…` 로 바로 나간다).
 *   그래서 게시판을 공지사항(`bbsNo=1632`) 하나로 못 박는다(`BBS_NO` 상수 한 곳).
 *
 * robots(실측): 모든 봇에 `Allow: /` 지만 `/DATA/` 아래와 문서 확장자 7종
 * (pdf·hwp·hwpx·xls·xlsx·doc·docx)으로 끝나는 주소를 막는다. 우리가 받는 첨부 주소는
 * `downloadBbsFile.do?atchmnflNo=…` 로 **확장자가 없어 그 규칙에 걸리지 않지만**, 본문 안
 * 이미지는 `/DATA/bbs/1632/` 아래라 금지 대상이다 — 이미지 원본은 긁지 않는다(글자·첨부만 쓴다).
 * `GPTBot` 은 전면 차단, `Googlebot` 만 목록·상세(`selectBbsNtt…`) 금지이고 그 밖의 봇에는 그 규칙이 없다.
 *
 * 구조: 표준 eGov. `table.p-table.simple > tbody.text_center > tr`, 한 쪽 10행.
 * 칸 = 번호 / 제목(`td.text_left > a`) / 파일 유무 / 조회수 / 작성일(`td.last`, YYYY-MM-DD).
 * 쪽 변수 `pageIndex`, 끝쪽 17(총 161건). charset utf-8.
 */
const BASE = "https://www.hanam.go.kr";
const LIST = "/biz/selectBbsNttList.do";
const VIEW = "/biz/selectBbsNttView.do";
const BBS_NO = "1632";
const KEY = "6003";
const ROW = "table.p-table.simple > tbody.text_center > tr";
const NTT_NO = /[?&]nttNo=(\d+)/;
/** 상세 링크의 게시판 번호 — 공지사항(1632)이 아니면 담지 않는다(uesc 와 같은 방식). */
const BBS_NO_IN_HREF = /[?&]bbsNo=(\d+)/;
const REGION = "경기";
/** 제목 앞머리의 대괄호 기관명(`[경기도경제과학진흥원]…`). */
const AGENCY_PREFIX = /^\s*[[［【]\s*([^\]］】]{1,40})\s*[\]］】]/;

/**
 * 이 줄의 지역. **남의 공고를 옮겨 실은 줄은 지역을 비운다**(2026-09-06 적대 리뷰).
 *
 * 왜: 실측 1쪽 10건 중 3건이 `[경기도경제과학진흥원]`·`[경기도시장상권진흥원]` 재게시다.
 * 그 줄에 「경기」를 박아도 틀리진 않지만 **하남 공고인 양 지역이 좁혀져** 원 기관 출처와
 * 갈린다 — 도 단위 사업은 지역을 비워 두는 편이 추천에서 안전하다.
 * 머리표가 없거나 `[하남시 …]` 면 하남 자체 공고라 「경기」 그대로 둔다.
 */
export function hanamRegionOf(title: string): string {
  const owner = title.match(AGENCY_PREFIX)?.[1];
  if (!owner) return REGION;
  return owner.includes("하남") ? REGION : "";
}
const YMD = /(20\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})/;

/**
 * 지원사업이 아닌 글. **버릴 것만** 지정한다.
 * 실측 1쪽 10건에서 걸리는 여섯: 교육생 모집 3건 · 수강생 모집 1건 · 수출기업 설문조사 1건 ·
 * 경제총조사 1건.
 * ★`교육` 을 통째로 버리지 않는다 — 「생애 최초 경영 안정화 교육지원 사업 모집 공고」처럼
 *   교육비를 대 주는 지원사업이 제목에 「교육」을 쓴다(실측 1쪽에 있다). 사람을 모으는
 *   「교육생/수강생 모집」만 좁게 버린다.
 */
const DROP =
  /교육생\s*모집|수강생\s*모집|설문\s*조사|총조사|입찰\s*공고|낙찰|평가위원|선정\s*결과|결과\s*발표|합격자|(?:신규|경력|직원)\s*채용\s*(?:공고|안내)/;

/** 시험이 제목 글자만으로 거르개를 잴 수 있게 내보낸다. */
export function isHanamDropTitle(title: string): boolean {
  return DROP.test(title);
}

export function parseHanamList(html: string, _page = 1): BoardRow[] {
  const out: BoardRow[] = [];
  const seen = new Set<string>();
  for (const tr of parseHtml(html).querySelectorAll(ROW)) {
    const a = tr.querySelector("td.text_left a");
    const href = a?.getAttribute("href") ?? "";
    /**
     * ★게시판 번호를 **링크에서 확인한다**(uesc 와 같은 방식). 이 포털에는 기업마당 거울 메뉴가
     * 붙어 있어, 목록 서식이 바뀌어 다른 게시판 글이 섞여 들어오면 그대로 저장될 수 있다.
     */
    if ((href.match(BBS_NO_IN_HREF)?.[1] ?? "") !== BBS_NO) continue;
    const id = href.match(NTT_NO)?.[1] ?? "";
    if (!id || seen.has(id)) continue;
    const title = (a?.text ?? "").replace(/\s+/g, " ").trim();
    if (!title || DROP.test(title)) continue;
    seen.add(id);
    /**
     * 작성일은 **`td.last` 칸을 직접** 집는다.
     * ⚠️행 전체 글자에서 찾으면 번호(161)와 조회수가 날짜처럼 보이는 자리를 만든다(hsbiz 실측 함정).
     */
    const d = (tr.querySelector("td.last")?.text ?? "").replace(/\s+/g, " ").trim().match(YMD);
    const ymd = d ? `${d[1]}-${d[2].padStart(2, "0")}-${d[3].padStart(2, "0")}` : "";
    out.push({
      title,
      /**
       * ★검색 인자(`searchCtgry`·`searchCnd`·`searchKrwd`·`pageIndex`·`integrDeptCode`·
       * `selectPageUnit`)를 다 떼고 **`key`+`bbsNo`+`nttNo`** 셋으로만 조립한다.
       * 실측: 이 셋만으로 HTTP 200 + 22,280바이트 정상. 그대로 두면 `pageIndex` 가 쪽마다 달라져
       * 같은 공고가 쪽 수만큼 다른 줄로 저장된다(주소가 곧 중복 판정 열쇠 `sourceId`).
       */
      detailUrl: `${BASE}${VIEW}?key=${KEY}&bbsNo=${BBS_NO}&nttNo=${id}`,
      // 목록은 작성일만 준다 — 개시형(`YYYY-MM-DD ~`)으로 담는다.
      dateText: ymd ? `${ymd} ~` : "",
      category: "",
      agency: "하남시",
      // 재게시(남의 공고)는 지역을 비운다 — 위 `hanamRegionOf` 주석.
      region: hanamRegionOf(title),
    });
  }
  return out;
}

export const hanamConfig: BoardConfig = {
  id: "hanam",
  label: "하남시 기업지원포털",
  agency: "하남시",
  region: REGION,
  baseUrl: `${BASE}/biz/`,
  charset: "utf-8",
  list: {
    url: (p) => `${BASE}${LIST}?bbsNo=${BBS_NO}&key=${KEY}&pageIndex=${p}`,
    // 총 17쪽이지만 월 3건짜리 판이다 — 앞 3쪽(30건)이 1년치를 덮는다.
    maxPages: 3,
    rowSelector: ROW,
    fields: {
      title: { selector: "td.text_left a" },
      detailUrl: { selector: "td.text_left a", attr: "href" },
      date: { selector: "td.last" },
    },
  },
  customParse: parseHanamList,
  /**
   * 상세 실측(nttNo=501713): 본문 `td.p-table__content`(공백이 `&nbsp;` 로 들어 있다),
   * 첨부 상자 `ul.p-attach`. 첨부는 `./downloadBbsFile.do?atchmnflNo=…` 로 **세션·Referer 없이**
   * 200 + `Content-Disposition: attachment` + HWP 434,176바이트가 온다(응답이 WMONID·JSESSIONID
   * 를 새로 내주지만 요청에는 필요 없다).
   * ★범위를 `ul.p-attach` 로 못 박는 이유: 그 상자 안 각 첨부 옆에 「미리보기」(`/previewHtml.do`)
   *   링크가 나란히 있는데, 수확기가 그것을 첨부로 저장하지 않도록 상자 밖 링크까지 넓히지 않는다.
   */
  detailContentSelector: "td.p-table__content",
  attachmentsScopeSelector: "ul.p-attach",
  /**
   * ★추측 단계를 끈다. 이 포털 상단에는 거울 메뉴(「기업지원사업」 = 기업마당)로 가는 링크가
   * 깔려 있다 — 추측 단계가 `a[href]` 를 긁으면 **거울 글이 공고로 저장되고** 그 줄은 다음
   * 회차에 지워지지 않는다(수출입은행 실측).
   */
  skipHeuristic: true,
  // 1쪽 10행에서 DROP 6건(교육생·수강생 모집 3 · 설문조사 · 총조사)을 뺀 실측 4건. 0행이면 서식 변경이므로 2로 둔다.
  expectMinRows: 2,
};
