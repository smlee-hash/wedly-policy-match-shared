import { parseHtml, type HTMLElement } from "../html";
import type { BoardConfig, BoardRow } from "../types";

/**
 * 세종테크노파크 사업공고(bo_table=business01).
 *
 * 왜 연결했나(2026-09-03 실측): 목록에 신청기간 시작·끝이 바로 있고,
 * 최신 wr_id=1993 「지역특화콘텐츠개발지원 (웹툰콘텐츠분야)」 등 세종 지역 지원사업이
 * 여기 게시판에만 실린다. 그누보드5 완전 서버렌더링 HTML.
 *
 * 구조: `#bo_list table tbody tr`. 제목 `td.td_subject ul.bo_title li:first-child a`
 * (첫 li 라벨이 「사업명」). 상세는 wr_id 만으로 조립한다 —
 * 2쪽 href 에 `&page=2` 가 붙어 있어 그대로 쓰면 같은 글이 쪽마다 다른 줄로 저장된다.
 * 쪽넘김은 `?page=n` GET. 한 쪽 15건 · 전체 약 43쪽. charset utf-8.
 * 목록은 **신청기간 시작·끝** 을 준다(`li:nth-child(4) p` 「YYYY-MM-DD ~ YYYY-MM-DD」).
 * 등록일 칸은 목록에 없다(상세 `span.if_date` 「작성일 26-08-27 09:41」).
 *
 * ★목록 기본 정렬은 wr_id 가 아니라 진행상태·마감근접(`sst=to_date DESC`).
 *   최댓값 wr_id=1993 이 1쪽 7번째에 나온다. 수집기는 노출순 그대로 담는다.
 *
 * ★브라우저 UA 위장은 불필요하다(실측 HTTP 200, UA 없어도 같은 바이트). 엔진이 이미 UA 를 붙인다.
 */
const BASE = "https://sjtp.or.kr";
const LIST = "/bbs/board.php";
const BOARD = "business01";
const WR_ID = /[?&]wr_id=(\d+)/;
const YMD = /(20\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})/g;
const ROW = "#bo_list table tbody tr";

/**
 * 지원사업이 아닌 글. **버릴 것만** 지정한다.
 * 실측 1쪽: 「분야별 전문가 모집」·「지역시민체험단 모집」.
 * ★`채용` 을 통째로 버리면 안 된다 — 고용보조금은 제목에 「채용」을 쓴다(bizbc.ts 주석).
 *   기관이 사람을 뽑는 글(`직원 채용`·`채용 공고`)만 좁게 버린다.
 */
const DROP = /입찰|설문|합격자|평가위원|시민체험단|전문가\s*모집/;
const DROP_STAFF = /(?:신규|경력|직원)\s*채용\s*(?:공고|안내)|채용\s*공고/;

/** 시험이 제목 글자만으로 거르개를 잴 수 있게 내보낸다. */
export function isSjtpDropTitle(title: string): boolean {
  return DROP.test(title) || DROP_STAFF.test(title);
}

/**
 * 붙박이 공지 중 **1년 넘게 붙어 있는 것은 버린다**(koreaexim.ts 방식).
 * 실측 1·2쪽에는 붙박이 칸이 없다(`td.td_num2` 가 642…628 / 627…613).
 */
const PINNED_MAX_AGE_MS = 365 * 24 * 3600_000;

function ymdList(chunk: string): string[] {
  return [...chunk.matchAll(YMD)].map((m) => `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`);
}

/** 신청기간 칸만. 행 전체 글자에서 찾으면 번호·D-day 와 날짜가 붙는다(hsbiz 실측 함정). */
function applyPeriodOf(tr: HTMLElement): { dateText: string; start: string } {
  const li = tr.querySelector("td.td_subject ul.bo_title li:nth-child(4)");
  const label = (li?.querySelector("span")?.text ?? "").replace(/\s+/g, " ").trim();
  if (!label.includes("신청기간")) return { dateText: "", start: "" };
  const days = ymdList((li?.querySelector("p")?.text ?? "").replace(/\s+/g, " ").trim());
  if (days.length >= 2) return { dateText: `${days[0]} ~ ${days[1]}`, start: days[0] };
  if (days.length === 1) return { dateText: `${days[0]} ~`, start: days[0] };
  return { dateText: "", start: "" };
}

export function parseSjtpList(html: string, _page = 1, now = Date.now()): BoardRow[] {
  const out: BoardRow[] = [];
  const seen = new Set<string>();
  for (const tr of parseHtml(html).querySelectorAll(ROW)) {
    const a = tr.querySelector("td.td_subject ul.bo_title li:first-child a");
    const id = (a?.getAttribute("href") ?? "").match(WR_ID)?.[1] ?? "";
    if (!id || seen.has(id)) continue;
    const title = (a?.text ?? "").replace(/\s+/g, " ").trim();
    if (!title || isSjtpDropTitle(title)) continue;
    /**
     * 신청기간은 **`li:nth-child(4) p` 칸을 직접** 집는다(사업명|주관기관|시행기관|신청기간).
     * ⚠️ 행 전체 글자(`tr.text`)에서 찾으면 안 된다 — 번호 「642」 + 「2026-02-02」가
     *    「6422026-02-02」로 붙는다. `td.td_datetime` 은 진행상태(접수중/임박/마감)라 날짜가 아니다.
     */
    const period = applyPeriodOf(tr);
    const num = (tr.querySelector("td.td_num2")?.text ?? "").replace(/\s+/g, " ").trim();
    const pinned = num === "공지" || (tr.getAttribute("class") ?? "").split(/\s+/).includes("bo_notice");
    if (pinned && period.start && now - Date.parse(`${period.start}T00:00:00Z`) > PINNED_MAX_AGE_MS) {
      seen.add(id);
      continue;
    }
    seen.add(id);
    out.push({
      title,
      // ★page 는 넣지 않는다 — 주소가 곧 중복 판정 열쇠(sourceId)라 쪽마다 다른 줄이 된다.
      detailUrl: `${BASE}${LIST}?bo_table=${BOARD}&wr_id=${id}`,
      dateText: period.dateText,
      category: "",
      agency: "세종테크노파크",
    });
  }
  return out;
}

export const sjtpConfig: BoardConfig = {
  id: "sjtp",
  label: "세종테크노파크",
  agency: "세종테크노파크",
  region: "세종",
  baseUrl: `${BASE}/`,
  charset: "utf-8",
  list: {
    url: (p) => `${BASE}${LIST}?bo_table=${BOARD}&page=${p}`,
    maxPages: 10,
    rowSelector: ROW,
    fields: {
      title: { selector: "td.td_subject ul.bo_title li:first-child a" },
      detailUrl: { selector: "td.td_subject ul.bo_title li:first-child a", attr: "href" },
      date: { selector: "td.td_subject ul.bo_title li:nth-child(4) p" },
    },
  },
  customParse: parseSjtpList,
  /**
   * 상세 GET 실측(wr_id=1993, 2026-09-03): 본문 `#bo_v_con`(공고 이미지 여러 장).
   * 첨부는 본문과 다른 상자 `#bo_v_file`(`bbs/download.php?bo_table=business01&wr_id=…`).
   */
  detailContentSelector: "#bo_v_con",
  attachmentsScopeSelector: "#bo_v_file",
  /**
   * ★첨부는 **상세 세션 쿠키가 있어야** 내려온다(2026-09-06 curl 실측, wr_id=1985&no=0):
   * · 그냥 GET → 200 + `text/html` 3,947바이트(「잘못된 접근입니다」 안내 화면)
   * · `Referer` 만 붙여도 → 200 + `text/html` 4,088바이트 (그대로 안내 화면)
   * · 상세를 먼저 GET 해 받은 쿠키(PHPSESSID 등 3개)를 실으면 → 200 +
   *   `content-disposition: attachment` + HWP 78,848바이트(OLE `d0cf11e0`)
   * 쿠키만으로 열리지만 `Referer` 도 함께 붙인다 — 브라우저와 같은 모양이라 그누보드 설정이
   * 바뀌어 Referer 검사를 켜도 그 자리에서 안 깨진다.
   * 이 옵션이 없던 동안 열린 공고 6건 중 2건만 본문이 찼다(나머지는 「읽지 못한 첨부」 + 7일 도장).
   */
  attachmentSession: { warmup: "detail", referer: "detail" },
  // 한 쪽 15건의 절반. 거르개 뒤 실측 1쪽 13건. 0행이면 서식 변경.
  expectMinRows: 7,
  /** 운영 서버(미국 IP)에서 연결 시간초과/빈 응답(2026-09-03 컨테이너 실측) — 국내 경유로만 연다. 변수 없으면 회차에서 빠져 화면은 「대기」. */
  requiresProxy: true,
};
