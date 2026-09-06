import { parseHtml } from "../html";
import type { BoardConfig, BoardRow } from "../types";

/**
 * 국방기술진흥연구소 공지사항.
 *
 * 왜 연결했나(2026-09-02 실측): 최신 9건을 우리 DB 와 제목으로 대조했더니
 * 이미 2 · 애매 2 · 신규 5, 신규 5건이 전부 진짜 지원사업이었다.
 *
 * 구조: `ul.listType > li`. 제목이 `<a href="#">` 라서 상세 주소를 손으로 조립한다.
 * `onclick="fnView('notice','','6484','1','','')"` 의 **세 번째 인자**가 글번호.
 * 쪽넘김은 `?page=n` GET. 총 567건 / 57쪽. 목록은 **등록일만** 준다 —
 * pipa 와 같이 「등록일 ~」 개시형으로 넣어 시작일로만 읽히게 하고,
 * 마감 정리는 저장 쪽의 「등록 90일」·「날짜 없음」 규칙에 맡긴다.
 *
 * ⚠️ **`li.notice`(고정 공지) 14줄은 건너뛴다.** 1쪽은 공지 14 + 일반 10 = 24줄인데
 *    공지 14줄 중 **10줄이 바로 아래 일반 행과 같은 공고**다(567~558). 게다가 공지에는
 *    `2023-09-20` 짜리(「방산 헬프데스크 (~2027.12.31.)」)가 섞여 있어 등록일을 개시일로
 *    넘기면 **저장 즉시 마감**된다(제목이 「[공지]」로 시작하지 않아 `PINNED_NOTICE` 예외에
 *    못 걸린다). 2쪽부터는 공지가 아예 없다(실측).
 */
const BASE = "https://www.krit.re.kr";
const LIST = "/krit/bbs/notice_list.do";
const VIEW = "/krit/bbs/notice_view.do";
const MENU = "05010000";
const ID = /fnView\(\s*'[^']*'\s*,\s*'[^']*'\s*,\s*'(\d+)'/;
const YMD = /(20\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})/;

/**
 * 지원사업이 아닌 글. **버릴 것만** 지정한다.
 * 실측 제목: 「소장 모집 공고」(임원 채용) · 「선물 신고 제도 안내」 · 「중간발표회 개최」.
 * ★`채용` 을 통째로 버리면 안 된다 — 고용보조금은 제목에 「채용」을 쓴다(cwip).
 *   기관이 사람을 뽑는 글(`소장 모집`·`임원 채용`)만 좁힌다.
 */
const DROP = /소장\s*모집|임원\s*채용|선물\s*신고|중간발표회/;

export function isKritDropTitle(title: string): boolean {
  return DROP.test(title);
}

/**
 * ★고정 공지를 **버리지 않고 뒤로 미룬다**(적대 리뷰 지적 반영).
 *
 * 처음엔 `li.notice` 14줄을 통째로 건너뛰었다. 그중 10줄이 바로 아래 일반 행과 같은 공고라
 * 중복만 만든다고 봤기 때문이다. 그런데 **나머지 4줄은 고정 공지에만 있다** —
 * 「[경북·구미 방산혁신클러스터] 2026년 판로개척 지원사업」(2026-01-14)과
 * 「방산 헬프데스크 … (~2027. 12. 31.)」(2023-09-20)은 살아 있는 지원사업인데,
 * 등록일이 오래돼 `maxPages: 5` 안의 일반 목록에서는 다시 안 나온다. 통째로 버리면 영영 못 받는다.
 *
 * 그래서 **일반 행을 먼저 담고, 고정 공지는 그다음에 「아직 안 담긴 것만」 담는다.**
 * · 겹치는 10줄은 일반 행이 이미 담겨 있어 자동으로 걸러지고, **일반 행의 진짜 등록일이 살아남는다**
 * · 고정 공지에만 있는 줄은 **날짜를 비워** 담는다 — 등록일을 개시일로 넘기면 저장 쪽
 *   「등록 90일」 규칙이 저장 즉시 마감시키고(제목이 「[공지]」로 시작 안 해 예외에 못 걸린다),
 *   날짜를 비우면 `undatedStale`(처음 본 날 기준)로 넘어가 붙어 있는 동안 모집중으로 남는다.
 */
export function parseKritList(html: string): BoardRow[] {
  const out: BoardRow[] = [];
  const seen = new Set<string>();
  const all = parseHtml(html).querySelectorAll("ul.listType > li");
  const isPinned = (li: (typeof all)[number]) =>
    (li.getAttribute("class") ?? "").split(/\s+/).includes("notice");
  for (const li of [...all.filter((x) => !isPinned(x)), ...all.filter(isPinned)]) {
    const pinned = isPinned(li);
    const a = li.querySelector("a");
    const id = (a?.getAttribute("onclick") ?? "").match(ID)?.[1] ?? "";
    if (!id || seen.has(id)) continue;
    /**
     * 앞머리 `<span>` 이 번호(「567」) 또는 「공지」다 — **떼야 한다.**
     * a.text 를 그대로 쓰면 「5672026년 하반기…」가 된다. span 글자를 문자열에서
     * 지우면 제목 안에 같은 숫자가 있을 때 잘리므로, 노드를 제거하고 나머지를 읽는다.
     */
    a?.querySelector("span")?.remove();
    const title = (a?.text ?? "").replace(/\s+/g, " ").trim();
    if (!title || DROP.test(title)) continue;
    seen.add(id);
    /**
     * 등록일은 **`ul.writer li.date` 칸을 직접** 집는다.
     * ⚠️ 행 전체 글자(`li.text`)에서 찾으면 안 된다 — 칸이 띄어쓰기 없이 이어 붙어
     *    조회수 + 날짜가 붙는다(hsbiz 실측 함정).
     */
    const dateCell = (li.querySelector("ul.writer li.date")?.text ?? "").replace(/\s+/g, " ").trim();
    const d = dateCell.match(YMD);
    out.push({
      title,
      // ★인자 이름은 스크립트 변수(`bbs_id`·`article_id`)가 아니라 **입력칸 이름**(`bbsId`·`nttId`)이다.
      //   목록 HTML 의 `<form id="form">` 을 읽어 확정했다. `page` 는 넣지 않는다 —
      //   엔진이 쪽 번호로 보고 떼어 내기도 하고, 없어도 상세가 정상으로 나온다(실측).
      detailUrl: `${BASE}${VIEW}?bbsId=notice&nttId=${id}`,
      dateText: pinned || !d ? "" : `${d[1]}-${d[2].padStart(2, "0")}-${d[3].padStart(2, "0")} ~`,
      category: "",
      agency: "국방기술진흥연구소",
    });
  }
  return out;
}

export const kritConfig: BoardConfig = {
  id: "krit",
  label: "국방기술진흥연구소",
  agency: "국방기술진흥연구소",
  region: "전국",
  baseUrl: `${BASE}/`,
  charset: "utf-8",
  list: {
    url: (p) => `${BASE}${LIST}?gotoMenuNo=${MENU}&page=${p}`,
    maxPages: 5,
    rowSelector: "ul.listType > li",
    fields: {
      title: { selector: "a" },
      detailUrl: { selector: "a", attr: "onclick", regex: "fnView\\(\\s*'[^']*'\\s*,\\s*'[^']*'\\s*,\\s*'(\\d+)'" },
      date: { selector: "ul.writer li.date" },
    },
  },
  customParse: parseKritList,
  /**
   * ★상세는 **Referer 가 있어야** 표를 채워 준다(2026-09-02 실측).
   *
   * 함정이 두 겹이라 하나만 풀면 「빈 표」를 본문으로 착각하게 된다:
   * ① **인자 이름** — 스크립트 변수는 `bbs_id`·`article_id` 인데 실제로 보내지는 입력칸 이름은
   *    `bbsId`·`nttId` 다(목록 HTML 의 `<form id="form">` 확인). `bbsSeq` 는 아예 없는 이름이다.
   * ② **Referer** — 인자를 맞춰도 Referer 가 없으면 44,029바이트짜리 껍데기가 온다.
   *
   * ⚠️ 두 함정이 겹치면 **속기 쉽다.** Referer 만 붙이고 인자가 틀리면 응답이 57,513바이트로
   *    늘어나 「됐다」처럼 보이지만, 표 안의 제목·내용·첨부 칸이 **전부 비어 있다**(직접 겪음).
   *    늘어난 바이트는 본문이 아니라 이전글·다음글 같은 페이지 장식이었다.
   *    확인은 바이트 수가 아니라 **표 안에 제목 글자가 들어 있는가**로 해야 한다.
   *
   * 본문 표(`div.tbTypeView`)만 잘라 돌려준다 — 통째로 주면 메뉴·바닥글 글자가 자격조건으로 들어가고
   * 사이트 공용 파일(웹와치 배너 등)이 첨부로 수확된다.
   */
  detailFetch: async (detailUrl, fetchText) => {
    const html = await fetchText(detailUrl, {
      method: "GET",
      headers: { Referer: `${BASE}${LIST}?gotoMenuNo=${MENU}` },
    });
    return parseHtml(html).querySelector("div.tbTypeView")?.outerHTML ?? "";
  },
  expectMinRows: 2,
};
