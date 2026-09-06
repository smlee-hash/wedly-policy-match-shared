import { parseHtml } from "../html";
import type { BoardConfig, BoardRow } from "../types";

/**
 * 강원테크노파크(GWTP) 공고안내 > **모집공고**(`code=sub01b`).
 *
 * 왜 이 게시판인가: 상단 「공고안내」 메뉴는 다섯 갈래다 —
 * `sub01a` 공지사항 · **`sub01b` 모집공고(=기업 지원사업)** · `sub01c` 계약공고(TP 자체 입찰) ·
 * `sub01d` 채용공고(TP 직원 채용) · `sub01g` 타기관소식.
 * 입찰·채용이 애초에 다른 메뉴로 갈려 있어 여기는 지원사업 밀도가 높다(실측 80줄 중 버릴 것 1줄).
 *
 * 구조(2026-09-03 실측 고정본):
 * · 행 `table.table.table-hover tbody tr` — 한 쪽 **40줄 = 붙박이 공지 25 + 일반 15**
 * · 제목 자리가 **두 갈래**다. 붙박이는 `<a><button>모집중</button><span class="ellipsis">제목</span></a>`,
 *   일반 행은 `<button>완료</button> <a>제목</a>` 로 **딱지가 링크 밖**이다.
 *   그래서 `span.ellipsis` 만 보면 일반 15줄이 통째로 사라진다 — `<a>` 안의 `<button>` 을 떼고
 *   `<a>` 글자를 그대로 읽는다.
 * · 등록일은 **4번째 칸**(번호/제목/작성자/등록일/조회수/첨부) — `2026-07-13`
 * · 목록 제목은 서버가 일정 길이에서 잘라 `..` 를 붙인다(전체 제목은 상세에만 있다).
 *
 * ★★쪽 번호가 **주소 안 base64 에 숨어 있다.**
 *   상세 href 는 `bbsNew_view.php?bbs_data=<base64>||` 이고, 그 base64 를 풀면
 *   `idx=3279&startPage=0&listNo=497&table=…` 처럼 **쪽·줄 번호가 함께 들어 있다**(2쪽은 `startPage=15`).
 *   엔진의 `stripDropParams` 는 「변수 이름」으로 지우므로 이건 절대 못 뗀다 —
 *   그대로 쓰면 **같은 붙박이 공고가 쪽마다 다른 줄로 저장된다**(sourceId 가 곧 상세 주소다).
 *   그래서 `idx` 만 뽑아 **쪽·줄이 빈 표준형으로 다시 조립**한다(실사이트의 붙박이 링크와 같은 모양,
 *   `||` 유무 무관하게 200/같은 본문 — 실측).
 *
 * ★1쪽 주소에는 `bbs_data` 를 **쓰지 않는다.** `pagingParamsOf` 는 url(1)·url(2) 에서 이름이 같고
 *   값이 다른 변수를 쪽 번호로 보는데, 1쪽도 `bbs_data=…` 로 두면 **상세 주소의 `bbs_data` 가
 *   통째로 지워져** 모든 줄이 `bbsNew_view.php` 한 주소로 뭉개진다.
 *
 * ★브라우저 UA 는 없어도 열린다(실측 200) — 엔진이 어차피 붙인다.
 */
const BASE = "https://www.gwtp.or.kr";
const LIST = "/gwtp/bbsNew_list.php";
const VIEW = "/gwtp/bbsNew_view.php";
const CODE = "sub01b";
const KEY = "sub01";
const TABLE = "cs_bbs_data_new";
/** 한 쪽 일반 행 수. 쪽넘김은 이 값의 배수를 `startPage` 로 넘기는 offset 방식이다. */
const PER_PAGE = 15;
const B64 = /bbs_data=([A-Za-z0-9+/=]+)/;
const IDX = /(?:^|&)idx=(\d+)/;
/** 등록일 칸은 통째로 날짜뿐이다 — 칸 전체가 날짜일 때만 인정해 번호·조회수와 붙는 것을 막는다. */
const YMD_CELL = /^(20\d{2})-(\d{2})-(\d{2})$/;

/**
 * 지원사업이 아닌 글. **버릴 것만** 좁게 지정한다.
 * 실측 80줄(1·2쪽)에서 걸리는 것은 딱 한 줄 —
 * 「… 고도화 및 개편 용역 제안서 **평가 위원** 모..」(TP 가 심사위원을 뽑는 글).
 * ⚠️ 실물이 「평가 위원」처럼 **띄어 써 있다** — `평가위원` 만으로는 못 잡는다.
 * ★`채용` 을 통째로 버리지 않는다 — 「청년 채용 지원사업」이 같이 죽는다(bizbc 주석).
 * ★`수요조사` 도 버리지 않는다 — 「기술수요조사 공고」는 기업이 신청하는 진짜 공고다.
 * 입찰·낙찰·합격자·채용공고는 이 게시판에서 아직 안 나왔지만(각각 sub01c·sub01d 로 갈려 있다)
 * 관리자가 잘못 올릴 때를 대비해 좁은 꼴로만 남겨 둔다.
 */
const DROP = /평가\s*위원|입찰\s*공고|낙찰|합격자|설문\s*조사|채용\s*공고/;

/** 시험이 제목 글자만으로 거르개를 잴 수 있게 내보낸다. */
export function isGwtpDropTitle(title: string): boolean {
  return DROP.test(title);
}

/**
 * 붙박이 공지 중 **1년 넘게 붙어 있는 것은 버린다**(koreaexim 방식).
 * 붙박이 「모집중」은 날짜를 비워 넘기는데, 그러면 처음 본 날부터 90일 동안 모집중으로 남는다.
 * 몇 해씩 붙어 있는 안내문까지 그렇게 되살리면 안 된다.
 */
const PINNED_MAX_AGE_MS = 365 * 24 * 3600_000;

/** `idx` 로 상세 주소를 다시 조립한다 — 쪽·줄 번호가 빈 표준형(실사이트 붙박이 링크와 동일). */
function viewUrlOf(idx: string): string {
  const query =
    `idx=${idx}&startPage=&listNo=&table=${TABLE}&code=${CODE}` +
    `&search_item=&search_order=&url=${CODE}&keyvalue=${KEY}&bbs_malname=`;
  return `${BASE}${VIEW}?bbs_data=${Buffer.from(query, "utf-8").toString("base64")}||`;
}

/** 목록 주소. 1쪽은 맨 주소, 2쪽부터 base64 `startPage`(15의 배수) — 실사이트 쪽넘김 링크와 동일. */
function listUrlOf(page: number): string {
  if (page <= 1) return `${BASE}${LIST}?code=${CODE}&keyvalue=${KEY}`;
  const query =
    `startPage=${(page - 1) * PER_PAGE}&code=${CODE}&table=${TABLE}` +
    `&search_item=&search_order=&url=${CODE}&keyvalue=${KEY}`;
  return `${BASE}${LIST}?bbs_data=${Buffer.from(query, "utf-8").toString("base64")}||`;
}

export function parseGwtpList(html: string, _page = 1, now = Date.now()): BoardRow[] {
  const out: BoardRow[] = [];
  const seen = new Set<string>();
  for (const tr of parseHtml(html).querySelectorAll("table.table.table-hover tbody tr")) {
    const cell = tr.querySelector("td.text-start");
    const a = cell?.querySelector("a[href*='bbsNew_view.php']");
    const href = a?.getAttribute("href") ?? "";
    const b64 = href.match(B64)?.[1] ?? "";
    if (!b64) continue;
    const idx = Buffer.from(b64, "base64").toString("utf-8").match(IDX)?.[1] ?? "";
    if (!idx || seen.has(idx)) continue;
    /**
     * 상태 딱지(`모집중`/`완료`)를 **제목보다 먼저** 읽는다 — 붙박이는 그 단추가 `<a>` 안에 있어
     * 아래에서 떼어 내면 사라진다. 일반 행은 `<a>` 밖이라 칸 기준으로 집어야 둘 다 잡힌다.
     */
    const badge = (cell?.querySelector("button")?.text ?? "").replace(/\s+/g, " ").trim();
    for (const b of a?.querySelectorAll("button") ?? []) b.remove();
    const title = (a?.text ?? "").replace(/\s+/g, " ").trim();
    if (!title || DROP.test(title)) continue;
    /**
     * 등록일은 **4번째 칸을 직접** 집는다(번호/제목/작성자/등록일/조회수/첨부).
     * ⚠️ 행 전체 글자에서 찾으면 안 된다 — 번호 「497」 + 「2026-07-13」이 「4972026-07-13」으로
     *    붙는다(hsbiz 실측 함정). 칸이 밀렸을 때를 대비한 보조도 **칸 전체가 날짜인 것만** 본다.
     */
    const tds = tr.querySelectorAll("td");
    const texts = tds.map((td) => td.text.replace(/\s+/g, " ").trim());
    const dateCell = YMD_CELL.test(texts[3] ?? "") ? texts[3] : (texts.find((t) => YMD_CELL.test(t)) ?? "");
    const ymd = YMD_CELL.test(dateCell) ? dateCell : "";
    // 붙박이 판정은 번호 칸이다 — 붙박이는 숫자 대신 「공지」 단추가 들어 있다.
    const pinned = (texts[0] ?? "") === "공지";
    // 오래 붙어 있는 붙박이는 아예 안 담는다.
    if (pinned && ymd && now - Date.parse(`${ymd}T00:00:00Z`) > PINNED_MAX_AGE_MS) continue;
    seen.add(idx);
    /**
     * ★붙박이는 **사이트가 「모집중」이라 말할 때만** 날짜를 비운다.
     * 저장 쪽 `openStartExpired` 의 예외 `PINNED_NOTICE` 는 제목이 「[공지]」로 **시작**해야만 걸리는데
     * 이 게시판 제목은 「(2026-27호) …」로 시작한다. 그래서 2026-01-19 짜리 붙박이에 등록일을 주면
     * **저장 즉시 마감**된다 — 사이트는 아직 모집 중이라고 말하는데도.
     * 반대로 「완료」 딱지가 붙은 붙박이까지 비우면 끝난 공고가 처음 본 날부터 90일 모집중이 된다.
     * 그래서 딱지를 그대로 따른다.
     */
    const openPinned = pinned && badge === "모집중";
    out.push({
      title,
      detailUrl: viewUrlOf(idx),
      dateText: openPinned || !ymd ? "" : `${ymd} ~`,
      category: "",
      agency: "강원테크노파크",
    });
  }
  return out;
}

export const gwtpConfig: BoardConfig = {
  id: "gwtp",
  label: "강원테크노파크",
  agency: "강원테크노파크",
  region: "강원",
  /**
   * ★기준 주소에 **`/gwtp/` 까지** 넣는다. 이 사이트의 링크는 `bbsNew_download.php?…` 처럼
   * **파일 이름만 있는 상대 주소**라, 기준을 `https://www.gwtp.or.kr/` 로 두면 첨부가
   * `…/bbsNew_download.php`(폴더 하나 빠진 주소)로 굳어 전부 404 가 된다(실측).
   */
  baseUrl: `${BASE}/gwtp/`,
  charset: "utf-8",
  list: {
    url: listUrlOf,
    // 전체 약 33쪽. 한 쪽 108KB 라 10쪽까지만 판다(쪽마다 새 줄 15개).
    maxPages: 10,
    rowSelector: "table.table.table-hover tbody tr",
    fields: {
      title: { selector: "td.text-start a" },
      detailUrl: { selector: "td.text-start a", attr: "href" },
      date: { selector: "td:nth-child(4)" },
    },
  },
  customParse: parseGwtpList,
  /**
   * 상세 본문 칸. 실측 7건 모두 `td.img_td` 가 한 개뿐이다.
   * ★다만 **글자가 든 본문은 그중 둘뿐**이고(2,680자·683자) 나머지는 공고 이미지 한 장이라 0자다.
   *   그래도 선택자를 적어 둔다 — 이 게시판은 글자가 있을 땐 **공고 전문**이 통째로 들어 있어
   *   비워 둘 이유가 없고(kbiz·geri 는 「짧은 도입부만」이라 일부러 비운 것이다),
   *   빈 본문일 때도 첨부 수확은 같은 호출에서 그대로 이뤄져 잃는 것이 없다.
   */
  detailContentSelector: "td.img_td",
  /**
   * 첨부는 `<th>첨부</th>` 옆 칸에 있는데 그 칸에는 **구분할 class 가 없다** —
   * 담을 수 있는 상자 선택자(`table.table-striped`)는 본문 칸까지 함께 삼킨다.
   * 이 게시판 본문은 공고 그림을 **base64 로 통째로 박아** 한 건이 26만~70만 자다.
   * 그걸 첨부 수확기(정규식으로 HTML 전체를 훑는다)에 넘길 이유가 없어 내려받기 링크만 못 박는다.
   * ★좁혀도 첨부는 하나도 안 잃는다 — 시험이 상세 전체 훑기와 결과를 대조한다.
   */
  attachmentsScopeSelector: "a[href*='bbsNew_download.php']",
  /**
   * ★추측 단계로 내려가지 않는다.
   * 이 게시판은 쪽 번호가 상세 주소의 base64 **안**에 있어서, 추측 단계가 원문 href 를 그대로 쓰면
   * 붙박이 25줄이 **쪽마다 다른 주소**로 저장된다(10쪽이면 한 회에 225줄의 유령). 그 줄들은
   * 다음 회차에 지워지지 않는다(수출입은행에서 겪은 갈래). 구조가 바뀌면 조용히 0건으로 두고
   * `expectMinRows` 경보에 맡긴다.
   */
  skipHeuristic: true,
  /**
   * 한 쪽 40줄(붙박이 25 + 일반 15). 붙박이는 관리자가 언제든 내릴 수 있으므로
   * **사이트 구조가 보장하는 일반 15줄**의 절반 아래로 잡는다 — 8줄 밑이면 서식 변경이다.
   */
  expectMinRows: 8,
};
