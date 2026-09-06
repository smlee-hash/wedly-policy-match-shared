import { parseHtml } from "../html";
import type { BoardConfig, BoardRow } from "../types";

/**
 * 포항소재산업진흥원(POMIA) 기업지원사업 공고(`/sub/board_buisness.html`).
 *
 * 왜 연결했나(2026-09-06 실측): 포항시 출연 재단의 **자체** 게시판이라 철강·이차전지 등
 * 지역 특화 공고가 여기에만 올라온다(기업마당·K-Startup 거울이 아니다). 총 약 150건 · 7쪽.
 * 서버가 목록·상세를 그대로 그려 주고 첨부는 쿠키 없이 Referer 만으로 받아진다
 * (HWP 174,080바이트 실수신 — `Content-Disposition: attachment`).
 *
 * ★robots 표식(방침 판단 필요): `https://pomia.or.kr/robots.txt` 는 목록·상세(`/sub/…`)를
 *   **허용**하지만 첨부 통로 `/inc` 와 본문 이미지 `/smarteditor2` 를 비허용한다.
 *   즉 공고는 방침상 문제가 없고 **첨부 내려받기만** 판단이 필요하다. 여기와 명부 note 에 남긴다.
 *
 * 구조: `ul.board_con_wrap > li`(첫 `li.board_header` 는 머리줄). 한 `li` 가 통째로
 * `a[href^="board_detail_buisness.html?no="]` 이고 그 안에 칸이 `p` 로 늘어선다 —
 * 번호 `p.num`(첫째) · 분류 `p.num`(둘째) · 제목 `p.tit` · 작성자 `p.who` · 등록일 `p.date` ·
 * 조회 `p.see` · 접수현황 `p.see1 span`(접수중) 또는 `p.see2 span`(접수마감).
 * 쪽넘김 GET `page=n` · 한 쪽 22행(붙박이 2건 포함) · 7쪽. charset utf-8(`<meta charset="UTF-8">`).
 * 목록은 **등록일만** 준다 — cbf·itp·ketep 와 같이 「등록일 ~」 개시형.
 * 접수현황이 「접수마감」인 행은 담지 않는다(마감일이 없어 담으면 90일간 「모집중」이 된다).
 *
 * ★상세 주소에서 `page`·`search`·`keyword`·`scate`·`sstatus` 를 **떼고** `no` 만 남긴다.
 *   주소가 곧 중복 판정 열쇠(sourceId)라 그대로 두면 같은 글이 쪽마다 다른 줄로 저장된다.
 */
const BASE = "https://pomia.or.kr";
const DIR = "/sub";
const LIST = `${DIR}/board_buisness.html`;
const VIEW = `${DIR}/board_detail_buisness.html`;
const NO = /[?&]no=(\d+)/;
const YMD = /(20\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})/;
const ROW = "ul.board_con_wrap > li";

/**
 * 기업이 수혜자가 아닌 글. **버릴 것만** 지정한다.
 * 실측 1쪽 22건 중 10건이 여기 걸린다 — 교육생(인력양성) 5 · 평가위원 3 · 컨설팅 업체 2.
 * 남는 12건은 통합지원·사업화지원의 기업 모집 공고다.
 * ★`모집` 을 통째로 버리면 안 된다 — 지원사업 공고가 그 낱말을 쓴다(kodma 주석).
 * ★`컨설팅` 도 통째로는 못 버린다 — 「컨설팅 지원사업 참여기업 모집」은 기업이 수혜자다.
 *   수행할 **업체**를 뽑는 글(`컨설팅 업체 모집`)만 좁게 친다.
 */
const DROP = /교육생|평가위원|심사위원|컨설팅\s*업체\s*모집|수행\s*(?:기관|업체|기업)\s*모집/;

/** 시험이 제목 글자만으로 거르개를 잴 수 있게 내보낸다. */
export function isPomiaDropTitle(title: string): boolean {
  return DROP.test(title);
}

/**
 * 붙박이 공지 중 **1년 넘게 붙어 있는 것은 버린다**(koreaexim·sjtp 방식).
 * 판정은 번호 칸(`p.num` 첫째)이 숫자가 아니라 「공지」인지로 한다.
 */
const PINNED_MAX_AGE_MS = 365 * 24 * 3600_000;

export function parsePomiaList(html: string, _page = 1, now = Date.now()): BoardRow[] {
  const out: BoardRow[] = [];
  const seen = new Set<string>();
  for (const li of parseHtml(html).querySelectorAll(ROW)) {
    // 머리줄(`li.board_header`)에는 링크가 없다 — 클래스 대신 링크 있고 없음으로 가른다.
    const a = li.querySelector('a[href*="board_detail_buisness.html"]');
    const id = (a?.getAttribute("href") ?? "").match(NO)?.[1] ?? "";
    if (!id || seen.has(id)) continue;
    const title = (li.querySelector("p.tit")?.text ?? "").replace(/\s+/g, " ").trim();
    if (!title || isPomiaDropTitle(title)) continue;
    /**
     * ★접수현황이 「접수마감」이면 담지 않는다(2026-09-06 적대 리뷰 보통3).
     * 목록엔 마감일이 없어서 담으면 등록일 개시형으로 90일간 「모집중」 행세를 한다.
     * 판정은 사이트가 준 값(`p.see2`)으로 한다 — 코드가 날짜를 추측하지 않는다.
     * ⚠️상세에도 접수기간 칸이 없다(고정본 `no=135` 실측: 머리에 분류·접수상태·작성일·
     *   작성자·조회수뿐) — 그래서 이 게시판은 `detailApplyPeriod` 를 켜지 못한다.
     */
    if ((li.querySelector("p.see2")?.text ?? "").replace(/\s+/g, " ").trim() === "접수마감") {
      seen.add(id);
      continue;
    }
    /**
     * 등록일은 **`p.date` 칸을 직접** 집는다.
     * ⚠️ 행 전체 글자(`li.text`)에서 찾으면 안 된다 — 번호 「130」 + 「2026.08.31」이
     *    「1302026.08.31」로 붙는다(hsbiz 실측 함정).
     */
    const d = (li.querySelector("p.date")?.text ?? "").replace(/\s+/g, " ").trim().match(YMD);
    const ymd = d ? `${d[1]}-${d[2].padStart(2, "0")}-${d[3].padStart(2, "0")}` : "";
    const nums = li.querySelectorAll("p.num");
    const num = (nums[0]?.text ?? "").replace(/\s+/g, " ").trim();
    const pinned = num !== "" && !/^\d+$/.test(num);
    if (pinned && ymd && now - Date.parse(`${ymd}T00:00:00Z`) > PINNED_MAX_AGE_MS) {
      seen.add(id);
      continue;
    }
    seen.add(id);
    out.push({
      title,
      detailUrl: `${BASE}${VIEW}?no=${id}`,
      dateText: ymd ? `${ymd} ~` : "",
      // 붙박이 행은 분류를 `[통합지원]` 처럼 대괄호로 싣는다 — 일반 행과 같은 글자로 맞춘다.
      category: (nums[1]?.text ?? "").replace(/\s+/g, " ").trim().replace(/^\[|\]$/g, ""),
      agency: "포항소재산업진흥원",
    });
  }
  return out;
}

export const pomiaConfig: BoardConfig = {
  id: "pomia",
  label: "포항소재산업진흥원",
  agency: "포항소재산업진흥원",
  region: "경북",
  baseUrl: `${BASE}/`,
  charset: "utf-8",
  list: {
    url: (p) => `${BASE}${LIST}?search=&keyword=&scate=&sstatus=&page=${p}`,
    // 전체가 7쪽이다(마지막 페이징 링크 `page=7`) — 더 부르면 같은 쪽이 되풀이된다.
    maxPages: 7,
    rowSelector: ROW,
    fields: {
      title: { selector: "p.tit" },
      detailUrl: { selector: 'a[href*="board_detail_buisness.html"]', attr: "href" },
      date: { selector: "p.date" },
      category: { selector: "p.num:nth-child(2)" },
    },
  },
  customParse: parsePomiaList,
  /** 본문은 `div.board_detail_con`(smarteditor2 HTML). 머리(분류·접수상태·작성일)는 넣지 않는다. */
  detailContentSelector: "div.board_detail_con",
  /**
   * 첨부는 본문과 다른 상자 `ul.board_detail_con_file_a`.
   * 주소는 `../inc/download4.php?fn=…&dir=board_data7&ext=1&fn2=<표시이름>` 이라
   * 확장자가 주소 끝에 없지만 공용 수확기의 `download` 글자 조건에 걸려 그대로 집힌다.
   */
  attachmentsScopeSelector: "ul.board_detail_con_file_a",
  // 1쪽 22건에서 거르개 10 + 접수마감 7 을 뺀 실측 5건. 0행이면 서식 변경이므로 3으로 둔다.
  expectMinRows: 3,
  // 2026-09-06 실측: 미국(Railway) 차단·서울 경유 200 — 국내 경유 전용
  requiresProxy: true,
};
