import { absolutize, parseHtml } from "../html";
import type { BoardConfig, BoardRow } from "../types";

/**
 * 성남산업진흥원 전체사업공고.
 *
 * 왜 연결했나(2026-09-02 실측): 최신 5건을 기업마당·보조금24 포함 우리 DB 와 제목으로
 * 대조했더니 진짜 겹침은 0건(오탐 1) — 통합 수집원으로는 안 들어온다.
 *
 * 구조: `table.board-list > tbody > tr` 10건. **접수기간을 목록에서 준다**
 * (`td.term` = `2026-08-31~2026-09-17`) — 등록일만 주는 게시판보다 마감 정리가 정확하다.
 * 쪽넘김은 `?page=n` GET. `pageIndex`·`pageNo`·`currentPage` 는 안 먹는다(실측).
 * 총 3,627건. 마감일을 주므로 깊이 파도 끝난 공고가 「모집중」으로 안 섞인다 — `maxPages: 10`.
 *
 * ⚠️ 상세 링크가 다른 호스트다 — `https://portal.snip.or.kr:8443/portal/snip/...`.
 *    `allowedHosts` 에 포트를 포함한 `portal.snip.or.kr:8443` 을 반드시 적는다
 *    (`allowedHostsOf` 는 `new URL().host` 로 대조하므로 포트가 열쇠에 들어간다).
 */
const BASE = "https://www.snip.or.kr";
const LIST = "/SNIP/contents/Business1.do";
const YMD = /(20\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})/g;

/**
 * 지원사업이 아닌 글. **버릴 것만** 지정한다 — 허용목록(KEEP)은 「~ 안내」형 지원사업을 죽인다(hsbiz).
 * 실측 1·2쪽 20건은 거의 전부 지원사업. 버린 건 「강사 인력 Pool 모집」 하나뿐.
 * ★`채용` 을 통째로 버리면 안 된다 — 고용보조금은 제목에 「채용」을 쓴다(cwip).
 */
const DROP = /강사\s*인력\s*(?:Pool|풀)/;

export function isSnipDropTitle(title: string): boolean {
  return DROP.test(title);
}

export function parseSnipList(html: string): BoardRow[] {
  const out: BoardRow[] = [];
  const seen = new Set<string>();
  for (const tr of parseHtml(html).querySelectorAll("table.board-list > tbody > tr")) {
    const a = tr.querySelector("td.subject a");
    const href = (a?.getAttribute("href") ?? "").trim();
    if (!href || href === "#") continue;
    const detailUrl = absolutize(href, `${BASE}/`);
    if (seen.has(detailUrl)) continue;
    const title = (a?.text ?? "").replace(/\s+/g, " ").trim();
    if (!title || DROP.test(title)) continue;
    seen.add(detailUrl);
    /**
     * 접수기간은 **`td.term` 칸을 직접** 집는다.
     * ⚠️ 행 전체 글자(`tr.text`)에서 찾으면 안 된다 — 칸이 띄어쓰기 없이 이어 붙어
     *    조회수 「142」 + 작성일 「2026-08-31」이 「1422026-08-31」이 된다(hsbiz 실측 함정).
     * ⚠️ `td.data`(작성일)로 떨어지면 안 된다 — 세 번째 행은 접수기간 08-28~09-04,
     *    작성일은 08-27 이라 끝이 하루 앞당겨진다.
     */
    const term = (tr.querySelector("td.term")?.text ?? "").replace(/\s+/g, " ").trim();
    const days = [...term.matchAll(YMD)].map(
      (m) => `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`,
    );
    const dateText =
      days.length >= 2 ? `${days[0]} ~ ${days[1]}` : days.length === 1 ? `${days[0]} ~` : "";
    out.push({
      title,
      detailUrl,
      dateText,
      category: "",
      agency: "성남산업진흥원",
    });
  }
  return out;
}

export const snipConfig: BoardConfig = {
  id: "snip",
  label: "성남산업진흥원",
  agency: "성남산업진흥원",
  region: "경기",
  baseUrl: `${BASE}/`,
  allowedHosts: ["portal.snip.or.kr:8443"],
  charset: "utf-8",
  list: {
    url: (p) => `${BASE}${LIST}?page=${p}`,
    maxPages: 10,
    rowSelector: "table.board-list > tbody > tr",
    fields: {
      title: { selector: "td.subject a" },
      detailUrl: { selector: "td.subject a", attr: "href" },
      date: { selector: "td.term" },
    },
  },
  customParse: parseSnipList,
  /**
   * ★상세 본문은 **공개돼 있지 않다**(2026-09-02 실측). 목록의 링크는 성남 포털의
   * 「사업신청」 화면(`portal.snip.or.kr:8443/…/application.page`)인데, 받아 보면 20KB짜리
   * 껍데기에 `<iframe src='/statics/password/passwordChange.jsp'>` 가 들어 있다 — **로그인 화면**이다.
   * 공고 글자(제목·접수기간)는 한 자도 없다.
   *
   * 그래서 상세를 **요청하지 않는다.** 안 막으면 `fillEmptyBodies` 가 회차마다 이 100여 줄을
   * 다시 열어 보며 아무것도 못 채우고, 그 사이 다른 출처의 빈 본문이 밀린다(그 단계는 한 틱에
   * 정해진 수만 처리한다). 빈 문자열을 돌려주면 통신 없이 「채울 것 없음」으로 끝난다.
   *
   * 대신 목록이 **접수기간을 통째로 주므로** 마감 판정은 정확하다 — 잃는 것은 자격조건 원문뿐이고,
   * 그건 사람이 원문 링크를 눌러 확인한다.
   */
  detailFetch: async () => "",
  /**
   * ★본문 채우기 대기줄에서 아예 뺀다(적대 리뷰 지적).
   * 요청을 안 보내는 것만으로는 부족하다 — `fillEmptyBodies` 는 「본문이 빈 공고」를
   * 최근 것부터 정해진 수만큼 가져다 처리하는데, 영영 안 채워지는 이 출처의 줄들이
   * 그 자리를 계속 차지하면 **다른 출처의 빈 본문이 영영 차례를 못 받는다**(10쪽 = 100줄).
   */
  skipDetailFill: true,
  expectMinRows: 2,
};
