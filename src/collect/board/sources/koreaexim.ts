import { parseHtml } from "../html";
import type { BoardConfig, BoardRow } from "../types";

/**
 * 한국수출입은행 공지사항.
 *
 * 왜 연결했나(2026-09-02 실측): 최신 5건을 우리 DB 9,565건과 제목으로 대조했더니
 * 이미 들어옴 0 · 애매 1 · **신규 4**. 「2026년 사업타당성조사 지원사업 모집」·
 * 「기업 맞춤형 전문컨설팅 지원사업 모집(ESG·해외진출·통상리스크)」·
 * 「스마트제조혁신컨설팅 지원사업 설명회」는 여기 말고 나올 데가 없다.
 *
 * ★앞 기록 「수출입은행 인증서 문제」는 틀렸다. TLS 는 정상이고 `-k` 도 쿠키 항아리도 필요 없다.
 *   브라우저 User-Agent 만 있으면 200/591KB 가 그대로 나온다(엔진이 이미 UA 를 붙인다).
 *   ※탐침 일꾼이 「쿠키 없으면 302 무한 루프」라고 보고했으나, 같은 주소를 다시 쳐 보니
 *     리다이렉트 0회로 200 이었다. 간헐적 WAF 반응으로 보이며 엔진의 3홉 추적으로 감당된다.
 *
 * 구조:
 * · 목록 GET `?curPage={쪽}` · 총 404건 / 41쪽
 * · 행 `div.notice-list-item` — 한 쪽 20줄 = **붙박이 공지 10 + 일반 10**
 * · 제목 `span.subject a`, 상세 href `/HPHKBI039M01/115905?curPage=1`
 *   → `curPage` 는 쪽 번호라 엔진이 `pagingParamsOf` 로 알아서 떼어 낸다(url(1)·url(2) 비교로 찾음)
 * · 날짜 `span[title="작성일"]`("2026.08.31") — **등록일만**
 * · 기관 `span[title="카테고리"]` — 「한국수출입은행」 또는 「대외경제협력기금」
 * · 상세 `div.detail-view-cont`(실측 1,131자)
 *
 * ⚠️ 한 쪽이 **591KB** 로 무겁다. 값어치 있는 공고는 붙박이 칸에 몰려 있어 `maxPages: 2` 로 둔다.
 */
const BASE = "https://www.koreaexim.go.kr";
const LIST = "/HPHKBI039M01";
const YMD = /(20\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})/;

/**
 * 공고가 아닌 글. **버릴 것만** 지정한다.
 *
 * ★「출자사업 공고」는 **버리지 않는다.** 처음엔 「펀드 운용사 모집이라 사업주 대상이 아니다」로
 *   버리려 했으나, 이 저장소의 방침은 「수집은 최대한 넓게, 걸러내기는 회사별 매칭에서」다
 *   (2026-09-01 계획서). 출자사업도 기업이 신청하는 공고이고, 낱말로 버리면
 *   「출자사업 참여기업 모집」 같은 갈래까지 함께 죽는다.
 *
 * 실측 20건(1쪽)에서 공고가 아닌 것: 「공공기관 종합청렴도 평가 관련 개인정보 제3자 제공사항 알림」
 * (2건)·「해외투자통계 대국민 포털 사이트 일시중단 안내」·「「한국의 개발협력」 원고 모집」·
 * 「공공기관 AI 활용 국민제안 접수」·「EDCF 중기운용방향('26~'28년)」.
 * ★`채용` 을 통째로 버리지 않는다 — 고용보조금은 제목에 「채용」을 쓴다(cwip 에서 겪음).
 */
const DROP =
  /개인정보\s*제3자|종합청렴도|일시\s*중단|일시중단|서비스\s*중단|원고\s*모집|국민제안|중기운용방향|입찰\s*공고|낙찰/;

/** 시험이 제목 글자만으로 거르개를 잴 수 있게 내보낸다. */
export function isKoreaeximDropTitle(title: string): boolean {
  return DROP.test(title);
}

/**
 * 붙박이 공지 중 **1년 넘게 붙어 있는 것은 버린다**(적대 리뷰 지적).
 * 붙박이는 날짜를 비워 저장하는데, 그러면 처음 본 날부터 90일간 「모집중」이 된다.
 * 실측 붙박이에 `2023.06.16`·`2023.08.21`·`2023.12.14`·`2024.07.23` 이 섞여 있어
 * 그대로 두면 3년 전 안내문이 2026년에 새 공고처럼 되살아난다.
 */
const PINNED_MAX_AGE_MS = 365 * 24 * 3600_000;

export function parseKoreaeximList(html: string, _page = 1, now = Date.now()): BoardRow[] {
  const out: BoardRow[] = [];
  const seen = new Set<string>();
  for (const item of parseHtml(html).querySelectorAll("div.notice-list-item")) {
    const a = item.querySelector("span.subject a");
    const href = (a?.getAttribute("href") ?? "").trim();
    if (!href) continue;
    const title = (a?.text ?? "").replace(/\s+/g, " ").trim();
    if (!title || DROP.test(title)) continue;
    // 상세 주소에서 쪽 번호를 뺀 부분이 곧 고유 열쇠다(같은 글이 붙박이·일반 양쪽에 있을 수 있다).
    const key = href.split("?")[0];
    if (seen.has(key)) continue;
    const spans = item.querySelectorAll("span");
    const cell = (t: string) => spans.find((s) => s.getAttribute("title") === t);
    /**
     * ★붙박이 공지는 **등록일을 개시일로 넘기지 않는다.**
     * 판정은 「순번 칸이 없고 공지 칸이 있는가」다 — 일반 행은 `span[title="순번"]`(404·403…),
     * 붙박이는 `span[title="공지"]`(아이콘 이미지)를 갖는다(실측).
     * 실측 붙박이 10건에 `2023.06.16`·`2023.08.21`·`2023.12.14`·`2024.07.23` 이 섞여 있는데,
     * 저장 쪽 `openStartExpired` 의 예외 `PINNED_NOTICE` 는 제목이 「[공지]」로 **시작**해야만 걸린다.
     * 이 게시판 제목은 「한국수출입은행 2026년 …」로 시작해 안 걸리므로 **저장 즉시 마감**된다.
     * 날짜를 비우면 `undatedStale`(처음 본 날 기준)로 넘어가 붙어 있는 동안 모집중으로 남는다.
     */
    const pinned = !!cell("공지");
    const d = (cell("작성일")?.text ?? "").trim().match(YMD);
    const ymd = d ? `${d[1]}-${d[2].padStart(2, "0")}-${d[3].padStart(2, "0")}` : "";
    // 오래 붙어 있는 붙박이는 아예 안 담는다 — 날짜를 비우면 처음 본 날부터 90일간 되살아난다.
    if (pinned && ymd && now - Date.parse(`${ymd}T00:00:00Z`) > PINNED_MAX_AGE_MS) continue;
    seen.add(key);
    out.push({
      title,
      detailUrl: `${BASE}${href.startsWith("/") ? href : `/${href}`}`,
      dateText: pinned || !ymd ? "" : `${ymd} ~`,
      category: "",
      // 「대외경제협력기금(EDCF)」 글이 절반이다. 기관을 은행으로 못 박으면 화면에서 주체가 뒤바뀐다.
      agency: (cell("카테고리")?.text ?? "").replace(/\s+/g, " ").trim() || undefined,
    });
  }
  return out;
}

export const koreaeximConfig: BoardConfig = {
  id: "koreaexim",
  label: "한국수출입은행",
  agency: "한국수출입은행",
  region: "전국",
  baseUrl: `${BASE}/`,
  charset: "utf-8",
  list: {
    url: (p) => `${BASE}${LIST}?curPage=${p}`,
    maxPages: 2,
    rowSelector: "div.notice-list-item",
    fields: {
      title: { selector: "span.subject a" },
      detailUrl: { selector: "span.subject a", attr: "href" },
      date: { selector: 'span[title="작성일"]' },
    },
  },
  customParse: parseKoreaeximList,
  detailContentSelector: "div.detail-view-cont",
  attachmentsScopeSelector: "section.detail-view-wrap",
  // 한 쪽 20줄(붙박이 10 + 일반 10)에서 거르개를 지나면 열 몇 건이 남는다. 0행이면 서식 변경.
  expectMinRows: 5,
  /**
   * selector 가 실패해도 heuristic 으로 내려가지 않는다 — 목록 행에 첨부 파일 링크(/comm/getFile)가
   * 섞여 있어 heuristic 이 파일 링크를 공고로·파일 이름을 제목으로·등록일을 마감으로 저장했다
   * (2026-09-02 23:05 운영 실측 30줄, 전부 closed). 오류가 틀린 저장보다 낫다.
   */
  skipHeuristic: true,
};
