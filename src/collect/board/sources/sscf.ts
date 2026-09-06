import { parseHtml } from "../html";
import type { BoardConfig, BoardRow } from "../types";

/**
 * 수원도시재단 「지원사업공고」(`entry_list.do?mn_key=04010000`).
 *
 * 왜 이 기관인가(2026-09-06 실측): 수원시 출연기관 8곳 중 기업지원 공고를 내는 곳은
 * **수원도시재단** 하나다(산하에 창업지원센터·사회적경제지원센터·상권활성화센터·경제본부).
 * 단서에 적힌 수원시정연구원·수원문화재단에는 기업지원 게시판이 없다.
 *
 * ⚠️이 게시판은 **한 쪽 고정이다**(실측): `srch_page=2` 로 요청해도 1쪽과 **완전히 같은 14행**이
 *   돌아온다. 지난 건은 목록에서 떨어져 나가 되돌릴 길이 없다 — 그래서 `maxPages: 1` 로 두고
 *   회차마다 이 한 쪽을 본다. 쪽을 늘리면 같은 14행을 여러 번 읽을 뿐이다.
 *
 * 구조: `table.b_list tbody tr`(실측 14행). 칸 6개 「번호 / 지원부서 / 유형 / 제목 / 조회수 / 상태」.
 * ★제목에 `href` 가 없다 — `onclick="javascript:fn_goViewPage('/entry_view.do','<18자리>'); return false;"`
 *   에서 글 번호를 뽑아 상세 주소를 손으로 조립한다.
 * ★★목록에 **날짜 칸이 아예 없다.** 대신 상태 칸이 있고 접수기간은 상세에만 있다
 *   (`<b>공고일정</b> : 2026.08.27 9시 ~ 2026.09.17 18시`). 그래서 `allowUndatedRows` 를 켜고,
 *   상세 본문 범위에 공고일정 줄을 함께 담는다(`body-deadline.ts` 의 `공고일정` 라벨이 받는다).
 *
 * ★★★상태 칸은 **두 이름**이다 — 진행 중은 `p.bbs_term`(모집중·오늘마감·마감N일전),
 *   끝난 것은 `p.bbs_term2`(마감). 실측 14행 = 진행 4 + 마감 10.
 *   **「마감」 줄은 아예 담지 않는다.** 이 출처는 목록에 날짜가 없어서, 마감된 줄을 담으면
 *   날짜 없는 공고로 저장되고 → 마감일이 없으니 **영영 「모집중」으로 굳는다.** 상세를 열어야
 *   공고일정이 붙는데 그마저 실패하면 되돌릴 길이 없다. 「오늘마감·마감N일전」은 아직 접수 중이라
 *   그대로 담고 상태를 `category` 에 싣는다.
 */
const BASE = "https://sscf2016.or.kr";
const MN_KEY = "04010000";
const LIST = "/entry_list.do";
const VIEW = "/entry_view.do";
const ROW = "table.b_list tbody tr";
const GO_VIEW = /fn_goViewPage\(\s*['"][^'"]*['"]\s*,\s*['"](\d+)['"]\s*\)/;
/** 접수가 끝난 줄의 상태 글자. 「오늘마감」·「마감5일전」은 **아직 접수 중**이라 여기 안 걸린다. */
const CLOSED_STATE = /^마감$/;

/** 시험이 상태 글자만으로 판정을 잴 수 있게 내보낸다. */
export function isSscfClosedState(state: string): boolean {
  return CLOSED_STATE.test(state.replace(/\s+/g, ""));
}

/**
 * 지원사업이 아닌 글. **버릴 것만** 지정한다.
 * 실측 14행에서 걸리는 넷: 「전세임대 … 주택물색 지원」·「주거취약계층 주거환경개선사업(집수리)」
 * (주거복지센터) · 「창업활성화 전문가 멘토 위원 모집」 · 「… 제안서 평가위원 후보자 모집」.
 * ★부서(`지원부서` 칸)로 거르지 않는다 — 주거복지센터가 올린 「새빛 청년존 입주기업 모집」처럼
 *   기업 대상 공고가 그 부서에서도 나온다(실측). 제목으로만 좁게 버린다.
 */
const DROP =
  /전세임대|주택물색|집수리|주거환경개선|위원\s*(?:후보자\s*)?모집|평가위원|입찰\s*공고|낙찰|선정\s*결과|결과\s*발표|합격자|(?:신규|경력|직원)\s*채용\s*(?:공고|안내)/;

/** 시험이 제목 글자만으로 거르개를 잴 수 있게 내보낸다. */
export function isSscfDropTitle(title: string): boolean {
  return DROP.test(title);
}

export function parseSscfList(html: string, _page = 1): BoardRow[] {
  const out: BoardRow[] = [];
  const seen = new Set<string>();
  for (const tr of parseHtml(html).querySelectorAll(ROW)) {
    const tds = tr.querySelectorAll("td");
    if (tds.length < 6) continue; // 「자료가 없습니다」 줄·머리글
    const a = tr.querySelector("td.txt_left a");
    const num = (a?.getAttribute("onclick") ?? "").match(GO_VIEW)?.[1] ?? "";
    if (!num || seen.has(num)) continue;
    const title = (a?.text ?? "").replace(/\s+/g, " ").trim();
    if (!title || DROP.test(title)) continue;
    seen.add(num);
    const dep = (tds[1]?.text ?? "").replace(/\s+/g, " ").trim();
    const type = (tds[2]?.text ?? "").replace(/\s+/g, " ").trim();
    /**
     * ★상태 칸 **둘 다** 읽는다(`p.bbs_term` 진행 · `p.bbs_term2 > span` 마감).
     * 하나만 읽으면 마감 줄의 상태가 빈 글자로 와서 아래 「마감 제외」가 통째로 헛돈다.
     */
    const state = (tr.querySelector("p.bbs_term, p.bbs_term2")?.text ?? "").replace(/\s+/g, " ").trim();
    // ★접수가 끝난 줄은 담지 않는다(위 주석 ★★★) — 날짜가 없어 담으면 「모집중」으로 굳는다.
    if (isSscfClosedState(state)) continue;
    out.push({
      title,
      detailUrl: `${BASE}${VIEW}?mn_key=${MN_KEY}&ACV_CNT_BOARD_NUM=${num}`,
      // ★목록에 날짜가 없다 — 오늘 날짜를 지어내지 않고 비운다(`allowUndatedRows` 로 통과시킨다).
      dateText: "",
      category: [dep, type, state].filter(Boolean).join(" · "),
      agency: "수원도시재단",
    });
  }
  return out;
}

export const sscfConfig: BoardConfig = {
  id: "sscf",
  label: "수원도시재단",
  agency: "수원도시재단",
  region: "경기",
  baseUrl: `${BASE}/`,
  charset: "utf-8",
  list: {
    // 쪽 변수(`srch_page`)를 붙여 두되 **한 쪽만** 읽는다 — 위 ⚠️ 참조.
    url: (p) => `${BASE}${LIST}?mn_key=${MN_KEY}&brd_key=0&srch_page=${p}`,
    maxPages: 1,
    rowSelector: ROW,
    fields: {
      title: { selector: "td.txt_left a" },
      detailUrl: {
        selector: "td.txt_left a",
        attr: "onclick",
        regex: "fn_goViewPage\\(\\s*['\"][^'\"]*['\"]\\s*,\\s*['\"](\\d+)['\"]\\s*\\)",
      },
      date: { selector: "p.bbs_term" },
      category: { selector: "td:nth-child(2)" },
    },
  },
  customParse: parseSscfList,
  /**
   * 상세 실측(ACV_CNT_BOARD_NUM=202608271728400217): 본문·첨부가 한 표(`table.b_view`) 안에 있다.
   * ★본문 범위를 `td.con_in` 이 아니라 표 전체로 잡는 이유: **접수기간이 본문 밖에** 있다
   *   (`<b>공고일정</b> : 2026.08.27 9시 ~ 2026.09.17 18시`). 목록에 날짜 칸이 없어서
   *   이 줄이 유일한 접수기간 근거다 — 본문 글자에 함께 실어 보낸다.
   * ★첨부는 `href="#"` 이고 진짜 열쇠는 `onclick="fn_getFile('file','<열쇠>','<정적경로>')"` 의
   *   **두 번째 인자**다. 수확기(`detail-fill.ts`)의 **P2 w5 갈래**(`sscf2016.or.kr` 한정)가
   *   `…/contest/fileDown.do?ACV_FIL_KEY=<열쇠>` 로 조립하고, 같은 자리에서 세 번째 인자(확인 안 된
   *   정적 경로)를 첨부로 줍지 않도록 「따옴표 안 파일 주소」 갈래를 이 호스트에서만 끈다.
   */
  detailContentSelector: "table.b_view",
  attachmentsScopeSelector: "table.b_view",
  /**
   * ★목록에 날짜 칸이 아예 없다(위 ★★). 이 문을 안 열면 「날짜가 있는 행이 부족」 검증이
   * 수집을 끊어 이 게시판은 한 줄도 못 담는다. 접수기간은 상세의 「공고일정」에서 온다.
   */
  allowUndatedRows: true,
  /**
   * ★추측 단계를 끈다. 목록 제목에 `href` 가 없어(`href="#LINK"`) 추측 단계가 좌측 메뉴·
   * 검색 폼 링크를 공고로 저장한다 — 그 줄은 다음 회차에 지워지지 않는다(수출입은행 실측).
   */
  skipHeuristic: true,
  /**
   * 실측 14행 → DROP 4건(주거복지 2·위원 모집 2) → 마감 8건 제외 → **2건**.
   * ★그래서 하한을 1로 둔다. 이 판은 한 쪽 고정이고 대부분이 마감 줄이라 **접수 중인 건수가
   *  원래 한 자리**다 — 하한을 높이면 접수 중이 1건인 날 그 쪽이 통째로 버려진다.
   *  서식이 바뀌면 어차피 `customParse` 가 0행을 내어 「행 0개」로 걸린다(파서가 `fn_goViewPage`
   *  호출과 칸 6개를 둘 다 요구한다) — 이 출처의 실제 방어선은 그쪽이다.
   */
  expectMinRows: 1,
};
