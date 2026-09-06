import { parseHtml } from "../html";
import type { BoardConfig, BoardRow } from "../types";

/**
 * 부산신용보증재단 공지사항(bcIdx=565, mid=0301010000).
 *
 * 왜 연결했나(2026-09-03 실측): 이 재단은 신용보증(대출보증) 기관이라 자체 「지원사업/모집공고」
 * 전용 게시판이 없다. 메인 GNB(mid 약 110개)를 파싱했으나 지원사업 성격 게시판이 없고,
 * 이름이 맞는 「소상공인 지원 알리미」(mid=0210040000)는 외부 링크 3개뿐이다.
 * 쓸 수 있는 건 일반 공지사항 — 표가 HTML 에 그대로 박혀 있고(js-only 아님),
 * 쪽넘김(`&page=2`)·상세(`view.do?...&idx=N`) 둘 다 GET 으로 동작한다.
 * 1~2쪽 20건 중 지원사업이라 부를 만한 글은 소수(온실가스 감축활동·서비스 강소기업)다.
 *
 * ★힌트 도메인 busanshinbo.or.kr 는 DNS 가 안 풀린다. 실제는 busansinbo.or.kr('h' 없음).
 *
 * 구조: `table.board-table > tbody > tr`. 제목이 `<a href="#">` 라서
 * `data-req-get-p-idx` 로 상세 주소를 손으로 조립한다. 목록 onclick 은
 * `yhLib.inline.post(this)` 이지만 같은 GET 주소로도 상세 HTML 이 그대로 온다(실측).
 * 쪽넘김은 폼이 POST 이지만 `?page=n` GET 도 동일하게 동작(1·2쪽 제목 완전히 다름 실측).
 * 한 쪽 10건 · 전체 약 69쪽. 목록은 **등록일만** 준다 — pipa 와 같이 「등록일 ~」 개시형.
 *
 * ⚠️ 목록 행 `td.file` 에 `a.file-download`(첨부)가 섞인다 — heuristic 을 끄지 않으면
 *    파일 링크를 공고로 저장한다(한국수출입은행에서 겪음).
 */
const BASE = "https://www.busansinbo.or.kr";
const LIST = "/portal/board/post/list.do";
const VIEW = "/portal/board/post/view.do";
const BC = "565";
const MID = "0301010000";
/** 작성일이 `2026. 09. 01` 처럼 점 뒤에 공백이 있다. 칸 글자에서만 쓴다. */
const YMD = /(20\d{2})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{1,2})/;

/**
 * 지원사업이 아닌 글. **버릴 것만** 지정한다.
 * 실측 제목: 사기 주의 · 설문/만족도/실사지수 · 환경산업조사 · 실천과제 · 특강 · 이벤트 ·
 * 업무제안 공모 · 통행료 · 합동구매 상담회 참가업체 모집.
 * ★`채용` 을 통째로 버리면 안 된다 — 고용보조금은 제목에 「채용」을 쓴다(bizbc 주석).
 *   기관이 사람을 뽑는 글(`채용 공고`)만 좁힌다. 채용 전용 게시판은 mid=0303030000.
 */
const DROP =
  /사기|사칭|설문|만족도|실천과제|특강|이벤트|업무제안|통행료|경기실사지수|GBSI|환경산업조사|합동구매|입찰|평가위원|합격자|채용\s*공고/;

export function isBssinboDropTitle(title: string): boolean {
  return DROP.test(title);
}

/**
 * 붙박이 공지 중 **1년 넘게 붙어 있는 것은 버린다**(koreaexim 방식).
 * 붙박이는 날짜를 비워 저장하는데, 그러면 처음 본 날부터 90일간 「모집중」이 된다.
 */
const PINNED_MAX_AGE_MS = 365 * 24 * 3600_000;

export function parseBssinboList(html: string, _page = 1, now = Date.now()): BoardRow[] {
  const out: BoardRow[] = [];
  const seen = new Set<string>();
  for (const tr of parseHtml(html).querySelectorAll("table.board-table > tbody > tr")) {
    const a = tr.querySelector("td.title a[data-req-get-p-idx]");
    const idx = (a?.getAttribute("data-req-get-p-idx") ?? "").trim();
    if (!idx || seen.has(idx)) continue;
    const title = (a?.text ?? "").replace(/\s+/g, " ").trim();
    if (!title || DROP.test(title)) continue;
    /**
     * 등록일은 **`td.date` 칸을 직접** 집는다.
     * ⚠️ 행 전체 글자(`tr.text`)에서 찾으면 안 된다 — 번호 칸 「685」 + 「2026. 08. 10」이
     *    「6852026. 08. 10」으로 붙는다(hsbiz 실측 함정).
     */
    const dateCell = (tr.querySelector("td.date")?.text ?? "").replace(/\s+/g, " ").trim();
    const d = dateCell.match(YMD);
    const ymd = d ? `${d[1]}-${d[2].padStart(2, "0")}-${d[3].padStart(2, "0")}` : "";
    const numText = (tr.querySelector("td.num")?.text ?? "").replace(/\s+/g, " ").trim();
    const pinned =
      (tr.getAttribute("class") ?? "").split(/\s+/).includes("notice") || /공지/.test(numText);
    if (pinned && ymd && now - Date.parse(`${ymd}T00:00:00Z`) > PINNED_MAX_AGE_MS) continue;
    seen.add(idx);
    out.push({
      title,
      // ★`page` 는 쪽 번호라 주소에 넣으면 같은 글이 쪽마다 다른 줄로 저장된다.
      detailUrl: `${BASE}${VIEW}?bcIdx=${BC}&mid=${MID}&idx=${idx}`,
      dateText: pinned || !ymd ? "" : `${ymd} ~`,
      category: "",
      agency: "부산신용보증재단",
    });
  }
  return out;
}

export const bssinboConfig: BoardConfig = {
  id: "bssinbo",
  label: "부산신용보증재단",
  agency: "부산신용보증재단",
  region: "부산",
  baseUrl: `${BASE}/`,
  charset: "utf-8",
  list: {
    url: (p) => `${BASE}${LIST}?bcIdx=${BC}&mid=${MID}&page=${p}`,
    maxPages: 10,
    rowSelector: "table.board-table > tbody > tr",
    fields: {
      title: { selector: "td.title a[data-req-get-p-idx]" },
      detailUrl: { selector: "td.title a[data-req-get-p-idx]", attr: "data-req-get-p-idx" },
      date: { selector: "td.date" },
    },
  },
  customParse: parseBssinboList,
  // 상세 GET `view.do?idx=8089` 실측(2026-09-03): 본문 `div.detail-cont`(사업명·모집기간·지원대상),
  // 첨부는 본문과 다른 상자 `div.detail-file`(`ul.file_list` · yhLib.file.download).
  detailContentSelector: "div.detail-cont",
  attachmentsScopeSelector: "div.detail-file",
  /**
   * 한 쪽 10건의 절반은 5 이지만, DROP 뒤 1쪽 실측이 2건이다. 5 로 두면 서식이 멀쩡한데도
   * 1쪽 관문이 거짓 실패한다. 0행이면 서식 변경이므로 2 로 둔다.
   */
  expectMinRows: 2,
  /**
   * 목록 행 `td.file` 에 첨부 파일 링크가 섞여 있다. heuristic 이 파일 링크를 공고로,
   * 파일 이름을 제목으로 저장한다 — 오류가 틀린 저장보다 낫다.
   */
  skipHeuristic: true,
};
