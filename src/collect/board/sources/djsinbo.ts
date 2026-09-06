import { parseHtml } from "../html";
import type { BoardConfig, BoardRow } from "../types";

/**
 * 대전신용보증재단 공지사항(재단소식 > 알림마당 > 공지사항).
 *
 * 왜 연결했나(2026-09-03 실측): 공고 게시판은 `www.sinbo.or.kr/sub04_01_01` 이고
 * 온라인 신청 포털(`hope.sinbo.or.kr`)과는 별개다. 형제 탭 「입찰 및 계약공고」
 * (`/sub04_01_02`)는 조달 공고라 붙이지 않는다.
 *
 * 구조: `table.bbs tbody tr`. 붙박이는 `class="notice"`, 일반 행은 class 없음.
 * 제목 `td:nth-child(2) a[href^='/sub04_01_01/view']`.
 * 상세는 1쪽이 `/view/id/{id}`, 2쪽 이후는 `/view/page/{n}/id/{id}` — **쪽 번호를
 * 주소에 남기면 같은 글이 쪽마다 다른 줄로 저장된다.** id 만으로 조립한다.
 * 쪽넘김은 경로형 `/sub04_01_01/index/page/{n}`(쿼리스트링 `?page=` 아님). 한 쪽 10건 · 약 30쪽.
 * 목록은 **등록일만** 준다(`YYYY/MM/DD`) — 「등록일 ~」 개시형.
 *
 * ★봇 차단 없음(브라우저 UA 없이도 200). TLS 정상.
 */
const BASE = "https://www.sinbo.or.kr";
const LIST = "/sub04_01_01";
const ID = /\/id\/(\d+)/;
const YMD = /(20\d{2})[./\-](\d{1,2})[./\-](\d{1,2})/;

/**
 * 지원사업이 아닌 글. **버릴 것만** 지정한다.
 * 실측 1·2쪽: 설문조사·고객만족도·GBSI·실태조사·컨설턴트 모집·방침 변경·화재관련 보증 서비스.
 * ★`채용` 을 통째로 버리면 안 된다 — 고용보조금은 제목에 「채용」을 쓴다(bizbc).
 * ★`컨설팅` 을 버리면 안 된다 — 「경영컨설팅 지원사업」이 1쪽 붙박이다. 사람 뽑는
 *   「컨설턴트 모집」만 좁게 버린다.
 */
const DROP =
  /입찰|설문|실태조사|고객만족도|경기실사지수|GBSI|컨설턴트\s*모집|이사장\s*공개모집|방침\s*변경|화재관련|평가위원|합격자/;
const DROP_STAFF = /(?:신규|경력|직원)\s*채용|채용\s*공고/;

/**
 * 붙박이 공지 중 **1년 넘게 붙어 있는 것은 버린다**(koreaexim 방식).
 * 날짜를 비우면 처음 본 날부터 90일간 「모집중」이 되어, 오래된 안내문이 되살아난다.
 */
const PINNED_MAX_AGE_MS = 365 * 24 * 3600_000;

export function isDjsinboDropTitle(title: string): boolean {
  return DROP.test(title) || DROP_STAFF.test(title);
}

export function parseDjsinboList(html: string, _page = 1, now = Date.now()): BoardRow[] {
  const out: BoardRow[] = [];
  const seen = new Set<string>();
  for (const tr of parseHtml(html).querySelectorAll("table.bbs tbody tr")) {
    const tds = tr.querySelectorAll("td");
    const a = tds[1]?.querySelector("a[href*='/sub04_01_01/view']");
    const id = (a?.getAttribute("href") ?? "").match(ID)?.[1] ?? "";
    if (!id || seen.has(id)) continue;
    const title = (a?.text ?? "").replace(/\s+/g, " ").trim();
    if (!title || isDjsinboDropTitle(title)) continue;
    /**
     * 등록일은 **작성일 칸(4번째 td)** 을 직접 집는다.
     * ⚠️ 행 전체 글자(`tr.text`)에서 찾으면 안 된다 — 번호·조회수 칸이 날짜와 붙어
     *    「2875682026/05/11」이 된다(hsbiz 실측 함정).
     */
    const dateCell = (tds[3]?.text ?? "").replace(/\s+/g, " ").trim();
    const d = dateCell.match(YMD);
    const ymd = d ? `${d[1]}-${d[2].padStart(2, "0")}-${d[3].padStart(2, "0")}` : "";
    const pinned = (tr.getAttribute("class") ?? "").split(/\s+/).includes("notice");
    if (pinned && ymd && now - Date.parse(`${ymd}T00:00:00Z`) > PINNED_MAX_AGE_MS) continue;
    seen.add(id);
    out.push({
      title,
      detailUrl: `${BASE}${LIST}/view/id/${id}`,
      /**
       * 등록일만 주므로 「등록일 ~」 개시형. 붙박이 날짜를 비우면 1쪽 4건 중 날짜 있는
       * 행이 1건뿐이라 저장 전 관문(날짜 30%)이 실패하고, 추측 단계가 설문·실태조사까지
       * 10쪽 100건으로 담는다(2026-09-03 실측).
       */
      dateText: ymd ? `${ymd} ~` : "",
      category: "",
      agency: "대전신용보증재단",
    });
  }
  return out;
}

export const djsinboConfig: BoardConfig = {
  id: "djsinbo",
  label: "대전신용보증재단",
  agency: "대전신용보증재단",
  region: "대전",
  baseUrl: `${BASE}/`,
  charset: "utf-8",
  list: {
    url: (p) => (p <= 1 ? `${BASE}${LIST}` : `${BASE}${LIST}/index/page/${p}`),
    maxPages: 10,
    rowSelector: "table.bbs tbody tr",
    fields: {
      title: { selector: "td:nth-child(2) a[href*='/sub04_01_01/view']" },
      detailUrl: { selector: "td:nth-child(2) a[href*='/sub04_01_01/view']", attr: "href" },
      date: { selector: "td:nth-child(4)" },
    },
  },
  customParse: parseDjsinboList,
  /**
   * 상세 본문(2026-09-03 `view/id/4588` 실측): `#board_content_zone` 에 지원대상·접수기간이 있다.
   * `table.bbs.view` 안 칸은 「공지사항 입니다.」 한 줄이라 그걸 채우면 첨부 공고문을 건너뛴다.
   * `div.contents` 는 바닥 만족도 설문이라 쓰면 안 된다.
   */
  detailContentSelector: "#board_content_zone",
  /** 첨부 목록. 바닥 배너 이미지와 섞이지 않게 `div.board_downloader` 안으로 제한. */
  attachmentsScopeSelector: "div.board_downloader",
  // 한 쪽 10건 중 거르개를 지나면 실측 1쪽 4건. 절반(5)이면 서식 변경이 아닌데도 관문이 실패한다.
  expectMinRows: 2,
  /**
   * 선택자 단계가 날짜 비율 관문에 떨어지면 추측 단계가 설문·실태조사까지 10쪽 100건으로
   * 담았다(2026-09-03 실측). 틀린 저장보다 오류가 낫다.
   */
  skipHeuristic: true,
  /** 운영 서버(미국 IP)에서 연결 시간초과/빈 응답(2026-09-03 컨테이너 실측) — 국내 경유로만 연다. 변수 없으면 회차에서 빠져 화면은 「대기」. */
  requiresProxy: true,
};
