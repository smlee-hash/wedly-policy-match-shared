import { parseHtml } from "../html";
import type { BoardConfig, BoardRow } from "../types";

/**
 * 경기도경제과학진흥원(GBSA) 공지사항.
 *
 * 왜 이 게시판인가(2026-09-03 실측): 메인 메뉴에 「사업공고」 전용 자리가 없고,
 * 지원사업 모집공고가 이 **일반 공지사항**에 행정공지와 섞여 올라온다.
 * 1쪽 10건 중 지원사업이 5건(팝업스토어 입점기업·광교비즈니스센터 입주기업·AI글로벌 챌린지·
 * LBS 스타트업 챌린지 등), 나머지는 평가위원·공시송달·청렴도·수행사 모집 같은 행정공지다.
 *
 * 구조: eGovFramework 서버렌더 표 `table.tbl-basic.bbs-list > tbody > tr`.
 * 칸은 [번호, 제목, 작성자, 등록일, 조회수, 첨부] 여섯이고 제목만 `<a href>` 를 갖는다.
 * 로그인·세션·CSRF 불필요. 쪽넘김은 화면 UI 가 POST 제출이지만 **`?pageIndex=n` GET 도 그대로**
 * 먹는다(1쪽 nttId 11257~11583, 2쪽 11184~11256 — 완전히 다른 글로 실측). 전체 약 68쪽.
 *
 * ⚠️ WAF 가 UA 를 검사한다 — 기본 curl UA 로는 루트·목록 둘 다 HTTP 400 「Request Blocked」.
 *    엔진(`fetchBoardText`)이 이미 브라우저 UA 를 붙이므로 여기서 따로 할 일은 없다(주석만).
 *
 * ★첨부(2026-09-03 고침): 이 게시판은 eGov 표준 내려받기 함수를 `onclick` 이 아니라
 *   **`href="javascript:fn_egov_downFile('FILE_...','1')"`** 에 넣는데, 옛 수확기의 `EGOV_DOWN` 은
 *   `onclick` 만 봐서 첨부가 0건이었다. 이제 수확기가 둘 다 본다 — 실측 상세(nttId=11583)에서
 *   `/cmm/fms/FileDown.do?atchFileId=FILE_000000000126614&fileSn=1` 1건을 집어 실제로 내려받아
 *   공고문 전문을 읽었다(200 / OLE(hwp) / 112,128바이트).
 *   `attachmentsScopeSelector` 는 **안 적는다** — 첨부 칸에 고유한 class 가 없고, 쪽 전체로 훑어도
 *   실측 첨부가 그 1건뿐이라 머리글·바닥글 오염이 없다.
 */
const BASE = "https://www.gbsa.or.kr";
const PATH = "/board/notice.do";
/** 상세 링크에서 글 번호만 뽑는다 — href 에 붙어 있는 `pageIndex`·`searchCnd` 는 버린다. */
const NTT = /[?&]nttId=(\d+)/;
/** 칸 하나가 통째로 날짜일 때만 인정한다(YYYY-MM-DD). */
const YMD_CELL = /^(20\d{2})-(\d{1,2})-(\d{1,2})$/;

/**
 * 지원사업이 아닌 글. **버릴 것만** 좁게 지정한다.
 * 실측 1·2쪽 제목: 「GBSA 제안서 평가위원(후보자) Pool 모집」·「정보공개(공개, 정보부존재)
 * 결정통지 공시송달 공고」·「종합청렴도 평가 관련 개인정보 제3자 제공사항 알림」·
 * 「통합홍보 수행사 모집/공개 모집」·「규제샌드박스 컨설턴트 모집공고」·
 * 「소프트웨어사업 영향평가 결과서」.
 *
 * ★`채용` 을 통째로 버리지 않는다 — 고용보조금 공고가 제목에 「채용」을 쓴다(bizbc 주석).
 * ★`컨설턴트` 도 통째로는 못 버린다 — 「컨설턴트 파견 지원사업」 같은 진짜 지원사업이 죽는다.
 *   그래서 「컨설턴트 모집」 형태만 버린다.
 */
const DROP =
  /평가위원|정보공개|공시송달|청렴도|수행사|컨설턴트\s*모집|영향평가\s*결과서|입찰|설문|합격자|채용\s*공고/;

/**
 * 붙박이 공지 중 **1년 넘게 붙어 있는 것은 버린다**(koreaexim 과 같은 갈래).
 * 붙박이는 날짜를 비워 저장하는데, 그러면 처음 본 날부터 90일간 「모집중」이 된다.
 */
const PINNED_MAX_AGE_MS = 365 * 24 * 3600_000;

export function isGbsaDropTitle(title: string): boolean {
  return DROP.test(title);
}

export function parseGbsaList(html: string, _page = 1, now = Date.now()): BoardRow[] {
  const out: BoardRow[] = [];
  const seen = new Set<string>();
  for (const tr of parseHtml(html).querySelectorAll("table.tbl-basic.bbs-list > tbody > tr")) {
    const a = tr.querySelector("td.align_left a[href*='nttId']") ?? tr.querySelector("td.align_left a");
    const nttId = (a?.getAttribute("href") ?? "").match(NTT)?.[1] ?? "";
    if (!nttId || seen.has(nttId)) continue;
    const title = (a?.text ?? "").replace(/\s+/g, " ").trim();
    if (!title || DROP.test(title)) continue;
    const tds = tr.querySelectorAll("td");
    /**
     * 등록일은 **칸(td) 단위**로 집는다. 행 전체 글자에서 정규식으로 찾으면 번호 칸 「676」과
     * 날짜가 「6762026-08-05」로 붙는다(hsbiz 실측 함정). 칸 번호(4번째)로 못 박는 대신
     * 「통째로 날짜인 칸」을 찾는다 — 칸 수가 바뀌어도 조회수(숫자)·번호(숫자)와 안 헷갈린다.
     */
    const dateCell = tds
      .filter((td) => !(td.getAttribute("class") ?? "").split(/\s+/).includes("align_left"))
      .map((td) => (td.text ?? "").replace(/\s+/g, " ").trim())
      .find((t) => YMD_CELL.test(t));
    const d = dateCell?.match(YMD_CELL);
    const ymd = d ? `${d[1]}-${d[2].padStart(2, "0")}-${d[3].padStart(2, "0")}` : "";
    /**
     * 붙박이 공지는 번호 대신 「공지」(또는 공지 아이콘)를 단다.
     * 지금 고정본에서는 그 `<img>` 가 **주석 처리**돼 있어 1·2쪽에 붙박이가 없지만,
     * 서식이 되살아났을 때 붙박이가 등록일을 개시일로 넘겨 90일간 「모집중」이 되는 것을 막는다.
     */
    const numCell = (tds[0]?.text ?? "").replace(/\s+/g, " ").trim();
    const pinned = numCell.includes("공지") || !!tr.querySelector('img[alt="공지"]');
    if (pinned && ymd && now - Date.parse(`${ymd}T00:00:00Z`) > PINNED_MAX_AGE_MS) continue;
    seen.add(nttId);
    out.push({
      title,
      /**
       * ★`pageIndex`·`searchCnd`·`searchWrd` 를 넣지 않는다. 주소가 곧 중복 판정 열쇠(sourceId)라
       * 쪽 번호가 섞이면 같은 글이 쪽마다 다른 줄로 저장된다. 인자 없이도 상세가 그대로 열린다
       * (실측 nttId=11583 → HTTP 200 · 96,848바이트).
       */
      detailUrl: `${BASE}${PATH}?nttId=${nttId}`,
      dateText: pinned || !ymd ? "" : `${ymd} ~`,
      category: "",
      agency: "경기도경제과학진흥원",
    });
  }
  return out;
}

export const gbsaConfig: BoardConfig = {
  id: "gbsa",
  label: "경기도경제과학진흥원",
  agency: "경기도경제과학진흥원",
  region: "경기",
  baseUrl: `${BASE}/`,
  charset: "utf-8",
  list: {
    url: (p) => `${BASE}${PATH}?pageIndex=${p}`,
    maxPages: 10,
    rowSelector: "table.tbl-basic.bbs-list > tbody > tr",
    fields: {
      title: { selector: "td.align_left a" },
      detailUrl: { selector: "td.align_left a", attr: "href" },
      date: { selector: "td:nth-child(4)" },
    },
  },
  customParse: parseGbsaList,
  /**
   * 상세 본문 칸. 대부분은 공고 이미지 한 장이라 글자가 0자지만(실측 10건 중 9건),
   * 「2026년 중장년 인턴캠프」처럼 **신청기간·지원대상이 글자로 적힌 글**이 섞여 있다(292자).
   * 첨부 길을 막지 않느냐 — 이 출처는 위 주석대로 첨부 수확이 원래 0건이라 막을 길이 없다.
   * 본문이 비고 첨부도 0이면 `fillBoardDetail` 이 아무것도 저장하지 않고 「빈 값」으로 넘어간다.
   */
  detailContentSelector: "div#bbs_cn",
  /**
   * 1쪽 10줄에서 행정공지를 걸러 실측 5건(2쪽은 7건).
   * 기대치를 실측값(5)에 붙이면 행정공지가 많은 주에 헛경보가 난다 — 3으로 두어
   * 「0행 = 서식 변경」만 잡는다.
   */
  expectMinRows: 3,
  /**
   * `skipHeuristic` 은 **안 켠다**(기본 끔). 목록 행에 첨부 파일 링크가 섞여 있지 않고
   * (첨부 칸은 `<img>` 한 장뿐이라 heuristic 이 파일을 공고로 저장할 위험이 없다),
   * 서식이 바뀌었을 때 heuristic 이 마지막 방어선으로 남는다(적대 리뷰, 광주TP).
   */
};
