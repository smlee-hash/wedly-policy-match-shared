import { parseHtml } from "../html";
import type { BoardConfig, BoardRow } from "../types";

/**
 * 세종신용보증재단 공지사항(`/sub0501/index`).
 *
 * 왜 연결했나(2026-09-03 실측): 최상단이 「2026년 9월 세종시 소상공인자금」·
 * 「세종 뿌리깊은 가게 선정」처럼 소상공인 지원사업 공고다. 채용은 별도 게시판
 * (`/sub050502`)이라 이 목록엔 안 섞인다(실측 20건 중 채용 0).
 *
 * 구조: `table.tbl_board.list > tbody > tr` 한 쪽 10건. 제목 `td.left > a > span`,
 * 상세 href `/sub0501/view/id/{id}`. 2쪽 이후는 `/sub0501/view/page/{n}/id/{id}`
 * 로도 나오지만 **id 만으로 조립**한다 — 쪽 번호가 sourceId 에 섞이면 같은 글이
 * 쪽마다 다른 줄로 저장된다. canonical `/view/id/{id}` 도 200(실측).
 * 쪽넘김은 경로형 `/sub0501/index/page/{n}`(쿼리스트링 아님). 1쪽은 `/sub0501/index`.
 * 전체 약 16쪽 · charset UTF-8. 목록은 **등록일만** 준다(`td.hidden2`) — 「등록일 ~」 개시형.
 *
 * ★봇 차단 없음(브라우저 UA 없이도 200/같은 바이트). 엔진이 이미 UA 를 붙인다.
 * ★TLS 정상(리다이렉트 없이 직결).
 */
const BASE = "https://www.sjsinbo.or.kr";
const LIST = "/sub0501";
const ID = /\/id\/(\d+)/;
const YMD = /(20\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})/;

/**
 * 지원사업이 아닌 글. **버릴 것만** 지정한다.
 * 실측 1·2쪽: 질의&응답 · 보증브로커 피해예방 · 개인정보 제3자 제공 · 일시중단 · 접수재개.
 * ★`채용` 을 통째로 버리면 안 된다 — 고용보조금은 제목에 「채용」을 쓴다(bizbc 주석).
 */
const DROP =
  /질의\s*(?:&amp;|&)?\s*응답|피해예방|개인정보\s*제3자|일시\s*중단|접수\s*재개|입찰|설문|합격자/;
const DROP_STAFF =
  /평가위원|외부전문가|전문가\s*풀|(?:신규|경력|직원)\s*채용\s*(?:공고|안내)|채용\s*공고/;

/**
 * 붙박이 공지 중 **1년 넘게 붙어 있는 것은 버린다**(koreaexim 방식).
 * 실측 2쪽 붙박이 「보증브로커(작업대출) 피해예방」(2023-08-11)이 이 갈래다.
 */
const PINNED_MAX_AGE_MS = 365 * 24 * 3600_000;

export function isSjsinboDropTitle(title: string): boolean {
  return DROP.test(title) || DROP_STAFF.test(title);
}

export function parseSjsinboList(html: string, _page = 1, now = Date.now()): BoardRow[] {
  const out: BoardRow[] = [];
  const seen = new Set<string>();
  for (const tr of parseHtml(html).querySelectorAll("table.tbl_board.list > tbody > tr")) {
    const a = tr.querySelector("td.left a");
    const id = (a?.getAttribute("href") ?? "").match(ID)?.[1] ?? "";
    if (!id || seen.has(id)) continue;
    const title = (a?.querySelector("span")?.text ?? a?.text ?? "").replace(/\s+/g, " ").trim();
    if (!title || isSjsinboDropTitle(title)) continue;
    /**
     * 등록일은 **`td.hidden2`(작성일) 칸을 직접** 집는다.
     * ⚠️ 행 전체 글자(`tr.text`)에서 찾으면 안 된다 — 조회수 「32」 + 「2026-09-01」이
     *    「322026-09-01」로 붙는다(hsbiz 실측 함정).
     */
    const dateCell = (tr.querySelector("td.hidden2")?.text ?? "").replace(/\s+/g, " ").trim();
    const d = dateCell.match(YMD);
    const ymd = d ? `${d[1]}-${d[2].padStart(2, "0")}-${d[3].padStart(2, "0")}` : "";
    // 번호 칸이 확성기 아이콘이면 붙박이(실측 1쪽 10건·2쪽 1건).
    const pinned = Boolean(tr.querySelector("i.ri-volume-up-fill"));
    if (pinned && ymd && now - Date.parse(`${ymd}T00:00:00Z`) > PINNED_MAX_AGE_MS) continue;
    seen.add(id);
    out.push({
      title,
      // ★쪽 번호(`/view/page/{n}/id/{id}`)는 버린다. 주소가 곧 중복 판정 열쇠(sourceId).
      detailUrl: `${BASE}${LIST}/view/id/${id}`,
      dateText: ymd ? `${ymd} ~` : "",
      category: "",
      agency: "세종신용보증재단",
    });
  }
  return out;
}

export const sjsinboConfig: BoardConfig = {
  id: "sjsinbo",
  label: "세종신용보증재단",
  agency: "세종신용보증재단",
  region: "세종",
  baseUrl: `${BASE}/`,
  charset: "utf-8",
  list: {
    url: (p) => (p <= 1 ? `${BASE}${LIST}/index` : `${BASE}${LIST}/index/page/${p}`),
    maxPages: 10,
    rowSelector: "table.tbl_board.list > tbody > tr",
    fields: {
      title: { selector: "td.left a span" },
      detailUrl: { selector: "td.left a", attr: "href" },
      date: { selector: "td.hidden2" },
    },
  },
  customParse: parseSjsinboList,
  /**
   * 상세 본문(2026-09-03 `view/id/1130`·`1051` 실측): `table.board_view td.content`.
   * 이미지 공고는 글자가 비고, 고용보험료 지원사업(id 1051)은 지원대상 원문이 있다.
   * 첨부는 본문과 다른 상자 `div.board_downloader`(`/sub0501/file_down/id/…`).
   */
  detailContentSelector: "table.board_view td.content",
  attachmentsScopeSelector: "div.board_downloader",
  // 한 쪽 10건의 절반. 거르개 뒤 실측 1쪽 8건. 0행이면 서식 변경.
  expectMinRows: 5,
  // 경로 쪽넘김(/index/page/N) 게시판 — heuristic 이 상세 주소에 쪽 번호를 섞어 저장한다(적대 리뷰) → 추측 단계 끔
  skipHeuristic: true,
};
