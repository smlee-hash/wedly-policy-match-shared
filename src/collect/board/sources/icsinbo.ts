import type { BoardConfig, BoardRow } from "../types";

/**
 * 인천신용보증재단 공지사항 (menu_cd=000096).
 *
 * 왜 연결했나(2026-09-03 실측): 목록 셸 HTML(`brdList.do`)에는 행이 없고, 페이지 스크립트가
 * POST `/home/board/ajax/list.do?menu_cd=000096` 로 JSON(`brdList[]`)을 받아 그린다.
 * 상세(`brdDetail.do?menu_cd=000096&num={num}`)는 GET 만으로 서버렌더링 200.
 * 최신 10건에 협약보증·특례보증·입주 모집이 섞여 있고, 채용·설문·평가위원이 같은 칸에 있다.
 *
 * 구조:
 * · 목록 = **POST** `ajax/list.do?menu_cd=000096`, 본문 `searchText=&searchData=data&currentPage={쪽}`
 * · 응답 `brdList[]`(한 쪽 10건) · `pagingInfoVO.totalPageCount` = 47 · `totalRecordCount` = 470
 * · 제목 `title` · 열쇠 `num` · 등록일 `write_dt`("2026-08-24")
 * · `receive_start_dt`/`receive_end_dt` 는 스키마에 있으나 관찰한 전 행이 빈 문자열 —
 *   접수기간은 구조화 데이터가 아니라 제목 앞 `[접수마감]`/`[신청마감]`/`[사전공고]` 태그뿐.
 *   **등록일만** 주므로 dateText 는 `YYYY-MM-DD ~` 개시형.
 * · 상세 GET `brdDetail.do?menu_cd=000096&num={num}` — 쪽 번호를 넣지 않는다.
 *
 * 더 좁은 「특례 및 협약보증」(menu_cd=000196)도 있으나, 입주 모집·지원사업 안내가 000096 에만
 * 있어 종합 공지 칸을 붙인다. 거르개가 채용·설문을 걷어낸다.
 *
 * 셸 HTML 의 `li.notice` 붙박이 7건은 JSON `brdList` 에 공지 표식이 없다(admin_yn·type 비어 있음).
 * 1년 초과 붙박이 건너뛰기(koreaexim)를 걸 칸이 없고, 실측 붙박이 날짜는 전부 2026 이라 해당 없음.
 */
const BASE = "https://www.icsinbo.or.kr";
const MENU = "000096";
const LIST_API = `${BASE}/home/board/ajax/list.do?menu_cd=${MENU}`;
const VIEW = `${BASE}/home/board/brdDetail.do`;

type IcsinboRow = {
  num?: string | number;
  title?: string;
  write_dt?: string;
};

/**
 * 지원사업이 아닌 글. **버릴 것만** 지정한다.
 * ★`채용` 을 통째로 버리면 안 된다(적대 리뷰 중요) — 고용보조금은 제목에 「채용」을 쓴다.
 *   기관이 사람을 뽑는 글(`정규직원 채용`·`기간제근로자`·`채용 공고`·`채용 사전공고`)만 좁힌다.
 */
const DROP =
  /입찰|낙찰|설문|명칭\s*변경|평가위원|평가\s*결과|합격자/;
const DROP_STAFF =
  /정규직원\s*채용|기간제근로자|채용\s*공고|채용공고|채용\s*사전공고|(?:신규|경력|직원)\s*채용\s*(?:공고|안내)/;

/** 시험이 제목 글자만으로 거르개를 잴 수 있게 내보낸다. */
export function isIcsinboDropTitle(title: string): boolean {
  return DROP.test(title) || DROP_STAFF.test(title);
}

/** "2026-08-24" → "2026-08-24". 값이 없거나 날짜가 아니면 빈 문자열. */
function ymd(raw: string | undefined): string {
  const m = (raw ?? "").match(/(20\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
  return m ? `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}` : "";
}

export function parseIcsinboList(jsonText: string): BoardRow[] {
  let raw: IcsinboRow[] = [];
  try {
    const d = JSON.parse(jsonText) as { brdList?: IcsinboRow[] };
    if (Array.isArray(d?.brdList)) raw = d.brdList;
  } catch {
    return [];
  }
  const out: BoardRow[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    const num = String(r.num ?? "").trim();
    const title = (r.title ?? "").replace(/\s+/g, " ").trim();
    if (!num || !title || seen.has(num)) continue;
    if (isIcsinboDropTitle(title)) continue;
    seen.add(num);
    const d = ymd(r.write_dt);
    out.push({
      title,
      detailUrl: `${VIEW}?menu_cd=${MENU}&num=${encodeURIComponent(num)}`,
      dateText: d ? `${d} ~` : "",
      category: "",
    });
  }
  return out;
}

export const icsinboConfig: BoardConfig = {
  id: "icsinbo",
  label: "인천신용보증재단",
  agency: "인천신용보증재단",
  region: "인천",
  baseUrl: `${BASE}/`,
  charset: "utf-8",
  list: {
    // POST 라 주소는 쪽과 무관하게 같다 — 쪽 번호는 init 의 본문이 나른다.
    url: () => LIST_API,
    maxPages: 10,
    init: (p) => ({
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `searchText=&searchData=data&currentPage=${p}`,
    }),
    // JSON 이라 선택자 갈래는 안 쓴다. customParse 가 없을 때만 보는 값이라 빈 자리를 채워 둔다.
    rowSelector: "",
    fields: { title: {}, detailUrl: {}, date: {} },
  },
  customParse: parseIcsinboList,
  /**
   * ★`detailContentSelector` 를 **일부러 안 적는다.**
   * 상세 본문 `div.readContents`(실측 num=1465)는 PDF iframe 뿐이라 글자가 없다.
   * 짧은 표지문을 채우면 뒷단계의 「첨부에서 본문 뽑기」가 `targetText === ""` 조건에서
   * 이 공고를 영영 건너뛴다. 선택자를 비우면 첨부만 수확된다.
   *
   * 첨부 범위는 `article.postStyle01` — 그 안에 `div.fileList`(javascript:fileDown)와
   * 본문 iframe(`/attach/cms/board/…pdf`)이 같이 있다. fileList 만 잡으면 href 가
   * javascript 라 수확기가 파일을 못 본다.
   */
  attachmentsScopeSelector: "article.postStyle01",
  // 한 쪽 10건. 거르개를 지나도 절반 아래면 응답 서식이 바뀐 것으로 본다.
  expectMinRows: 5,
};
