import { parseHtml } from "../html";
import type { BoardConfig, BoardRow } from "../types";

/**
 * 산업통상부 사업공고(알림·뉴스 > 사업공고, `ATCL2826a2625`).
 *
 * 왜 연결했나: 부처 본청이 직접 올리는 R&D·수출·중견기업 지원 공고가 모이는 자리다.
 * 2026-09-03 실측 1·2쪽 20건 중 지원사업이 17건(85%)으로 밀도가 매우 높다.
 *
 * ★도메인이 `motie.go.kr` 이 아니라 **`www.motir.go.kr`** 이다(2026-09-03 실측).
 *   · `motie.go.kr`(www 없음)은 인증서 주체가 `www.motir.go.kr` 이라 TLS 가 끊긴다(curl 60번 오류).
 *   · `www.motie.go.kr` 은 301 로 `www.motir.go.kr` 에 넘긴다.
 *   그래서 baseUrl·상세 주소를 **처음부터 motir.go.kr 로** 적는다 — 넘김을 타면 첨부·상세에서
 *   쿠키·Referer 가 흩어진다.
 *
 * 구조: `div.board-tbl.board-list table tbody tr`(한 쪽 10줄, 총 350쪽).
 * 제목이 `<a href>` 가 아니라 `href="javascript:article.view('71301')"` 라서 번호를 뽑아
 * 상세 주소를 손으로 조립한다(`/kor/article/ATCL2826a2625/71301/view` — 쿠키 없이 GET 200,
 * `Article.js` 의 `view(bbsSeqN)` 로 확정).
 * 쪽넘김은 `?pageIndex=n` GET(1쪽 71301~71267, 2쪽 71266~71238 로 실제로 달라짐).
 * 목록은 **등록일만** 준다 — 개시형(`YYYY-MM-DD ~`)으로 넘기고 저장 쪽 90일 자동 마감에 맡긴다.
 *
 * 표시개수는 `rowPageC=10|30|50` 로도 조절된다(50 도 GET 으로 먹는 것을 실측). 지금은 기본값
 * 10줄로 두고 쪽수로만 판다 — 상한 밖이 아쉬우면 `rowPageC` 를 올리는 쪽이 요청 수를 안 늘린다.
 */
const BASE = "https://www.motir.go.kr";
const LIST = "/kor/article/ATCL2826a2625";
const SEQ = /article\.view\(\s*['"](\d+)['"]\s*\)/;
/** 등록일 칸은 **칸 전체가** 날짜다. 행 전체 글자에서 찾으면 공고번호·조회수와 붙는다. */
const YMD_CELL = /^(20\d{2})-(\d{2})-(\d{2})$/;

/**
 * 지원사업이 아닌 글. **버릴 것만** 좁게 지정한다.
 * 실측(2026-09-03 50건)에서 걸리는 것은 6건뿐이다 —
 * 「민간자격 **등록폐지** 공고」·「산업단지 발전**유공자 모집**공고」·「기술사업화 **유공자 포상**」·
 * 「녹색인증 **유공자포상**」·「한미 전략적 투자 프로젝트 외부 **자문사 풀**(Pool) 추가 모집」·
 * 「사무관·주무관 **전입 희망자** 공개모집」.
 * ★`채용` 을 통째로 버리면 안 된다(적대 리뷰 중요) — 「채용 지원사업」이 같이 죽는다.
 *   기관이 사람을 뽑는 글(`직원 채용 공고`)만 좁게 버린다.
 * ★`유공자` 도 통째로 버리지 않는다 — 포상·모집 글만 집는다.
 */
const DROP =
  /등록\s*폐지|전입\s*희망자|유공자\s*(?:포상|모집|표창|추천)|(?:자문사|전문가)\s*풀|입찰|설문|평가위원|우선협상대상자|합격자\s*(?:발표|명단)|(?:신규|경력|직원)?\s*채용\s*(?:공고|안내)/;

/**
 * 붙박이 공지 중 **1년 넘게 붙어 있는 것은 담지 않는다**(koreaexim 과 같은 갈래).
 * 붙박이는 등록일을 개시일로 넘기지 않는데(아래), 그러면 처음 본 날부터 90일 동안 「모집중」이 된다.
 * 오래 붙어 있는 붙박이는 대개 안내·자료라 그렇게 되살리면 안 된다.
 *
 * ※ 2026-09-03 실측 1·2쪽 20줄에는 붙박이가 **없다**(전 행이 공고번호 `2026-578` 꼴이고
 *   등록일이 내림차순). 그래서 판정은 **공고번호 칸에 「공지」가 적혔는가**로만 한다 —
 *   번호 서식이 바뀌었을 때 멀쩡한 행을 붙박이로 오해하지 않는 쪽(양성 판정)이다.
 */
const PINNED_MAX_AGE_MS = 365 * 24 * 3600_000;

export function isMotieDropTitle(title: string): boolean {
  return DROP.test(title);
}

export function parseMotieList(html: string, _page = 1, now = Date.now()): BoardRow[] {
  const out: BoardRow[] = [];
  const seen = new Set<string>();
  for (const tr of parseHtml(html).querySelectorAll("div.board-tbl.board-list table tbody tr")) {
    const a = tr.querySelector("td.ta-l div.board-link a");
    const link = `${a?.getAttribute("href") ?? ""} ${a?.getAttribute("onclick") ?? ""}`;
    const seq = link.match(SEQ)?.[1] ?? "";
    if (!seq || seen.has(seq)) continue;
    // 제목 글자는 안쪽 <i> 에 있다. <i> 가 없어지면 <a> 전체 글자로 물러선다.
    const title = ((a?.querySelector("i") ?? a)?.text ?? "").replace(/\s+/g, " ").trim();
    if (!title || DROP.test(title)) continue;

    /**
     * 칸 단위로만 읽는다 — 4번째 칸이 등록일, 3번째가 담당부서다.
     * ⚠️ 행 전체 글자(`tr.text`)에서 정규식으로 찾으면 안 된다: 공고번호 「2026-567」·
     *    조회수 「2,378」이 날짜와 이어 붙어 「712026-09-01」 꼴로 깨진다(hsbiz 실측 함정).
     * 칸이 하나 밀렸을 때를 대비해 **칸 전체가 날짜인 칸**을 다시 찾는다 — 이것도 칸 단위다.
     */
    const cells = tr.querySelectorAll("td").map((td) => td.text.replace(/\s+/g, " ").trim());
    const ymd = YMD_CELL.test(cells[3] ?? "") ? cells[3] : (cells.find((c) => YMD_CELL.test(c)) ?? "");
    const pinned = /공지/.test(cells[0] ?? "");
    // 오래 붙어 있는 붙박이는 아예 안 담는다 — 날짜를 비우면 처음 본 날부터 90일간 되살아난다.
    if (pinned && ymd && now - Date.parse(`${ymd}T00:00:00Z`) > PINNED_MAX_AGE_MS) continue;
    seen.add(seq);
    out.push({
      title,
      // 상세 주소가 곧 중복 판정 열쇠(sourceId)라 **쪽 번호를 절대 섞지 않는다** —
      // 섞으면 같은 공고가 쪽마다 다른 줄로 저장된다.
      detailUrl: `${BASE}${LIST}/${seq}/view`,
      dateText: pinned || !ymd ? "" : `${ymd} ~`,
      // 담당부서(3번째 칸) — 「인공지능기계로봇과」처럼 분야가 드러나는 값이라 그대로 싣는다.
      category: cells[2] ?? "",
      // 기관은 설정값(산업통상부) 그대로. 이 게시판은 남의 기관 공고를 옮겨 싣는 자리가 아니라
      // 부처 본청이 직접 올리는 자리다(실측 50건 전부 산업통상부 소관 부서).
    });
  }
  return out;
}

export const motieConfig: BoardConfig = {
  id: "motie",
  label: "산업통상부 공고",
  agency: "산업통상부",
  region: "전국",
  baseUrl: `${BASE}/`,
  charset: "utf-8",
  list: {
    url: (p) => `${BASE}${LIST}?pageIndex=${p}`,
    maxPages: 8,
    rowSelector: "div.board-tbl.board-list table tbody tr",
    fields: {
      title: { selector: "td.ta-l div.board-link a" },
      detailUrl: { selector: "td.ta-l div.board-link a", attr: "href", regex: "article\\.view\\(\\s*'(\\d+)'" },
      date: { selector: "td:nth-child(4)" },
    },
  },
  customParse: parseMotieList,
  /**
   * 목록 행 6번째 칸에 **첨부 내려받기 링크**(`/attach/down/…`)가 들어 있다.
   * 추측(heuristic) 단계가 그 링크를 공고로, 파일 이름을 제목으로 저장하면 다음 회차에도
   * 지워지지 않는다(수출입은행 실측 30줄) — 그래서 끈다. 사람이 확정한 customParse 가 정본이다.
   */
  skipHeuristic: true,
  /**
   * 상세 본문 칸(실측 `detail-71295`·`detail-71301` 둘 다 1개, 131·135자).
   * 본문이 짧지만 **비워 두지 않는다** — 비우면 `fillBoardDetail` 이 매 회차 "empty" 를 돌려
   * 그 줄이 채움 줄서기 맨 앞을 영영 차지한다(다른 출처의 빈 본문이 차례를 못 받는다).
   */
  detailContentSelector: "div.detail-cont",
  /**
   * 첨부는 `div.detail-info li.info-down` 안에만 있다(본문·바닥글과 섞이지 않게 범위를 좁힌다).
   * ★2026-09-03 고침 ① — `href="javascript:location.href='/attach/down/…'"` 를 공용 수확기가
   *   이제 안쪽 절대주소로 푼다(실측 상세 71301 에서 hwpx·pdf 2건). 「바로보기」(`/attach/viewer/…`)는
   *   내려받기가 아니라서 안 담는다.
   * ⚠️ 남은 빈틈 ② — 그 주소를 직접 불러도 **302 → `/error/500`** 이다(세션 쿠키·Referer·쿼리를
   *   붙여도 같다). 그래서 **주소만 저장되고 내용은 못 읽는다** — 내려받기 단계가 「읽지 못한 첨부」로
   *   남기므로(2026-09-03 실호출로 확인) 사람이 원문을 열어 볼 수는 있다.
   */
  attachmentsScopeSelector: "div.detail-info li.info-down",
  /** 한 쪽 10줄(거르개 통과 9줄)의 절반. 서식이 바뀌어 표식이 사라지면 여기서 걸린다. */
  expectMinRows: 5,
};
