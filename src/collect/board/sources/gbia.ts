import { parseHtml } from "../html";
import type { BoardConfig, BoardRow } from "../types";

/**
 * 김해의생명산업진흥원 사업공고(그누보드5 `bo_table=business`).
 *
 * 왜 연결했나(2026-09-06 실측): 김해시 출연 재단의 **자체** 공고 게시판이라 기업 대상 비율이
 * 높고(1쪽 15건 대부분이 참가기업·입주기업 모집), 채용은 `bo_table=recruit`, 입찰은
 * `bo_table=bid` 로 판이 갈려 있어 섞이지 않는다. 총 817건 · 월 5~6건.
 *
 * ★robots 표식(방침 판단 필요): `https://gbia.or.kr/robots.txt` 가
 *   `User-agent: *` / `Disallow: /bbs/` / `Disallow: /gibf_administrator/` 다.
 *   목록·상세·첨부가 전부 `/bbs/` 아래라 **방침상 전면 비허용**이다(기술적 차단은 없다).
 *   안양산업진흥원과 같은 관례로 진행하되 이 사실을 여기와 명부 note 에 남긴다.
 *
 * 구조: `#bo_list table tbody tr`(칸 6개 — No|제목|등록자|등록일|접수상태|조회).
 * 제목 `td.td_subject a`(href 에 절대주소 + `wr_id`), 쪽넘김 GET `page=n` · 한 쪽 15건 ·
 * 전체 55쪽. charset **utf-8**(`<meta charset="utf-8">` — 첨부 파일 이름만 EUC-KR 이다, 아래).
 *
 * ★목록 날짜는 **월-일뿐**이다(`td.td_date` = `09-02`). 연도는 상세에만 있다
 *  (`bbs_head02` 표의 등록일 칸 `2026-09-02`). 등록일은 미래일 수 없으므로 수집 시각(KST)의
 *  해를 넣되, 오늘보다 뒤 날짜면 지난해로 본다(`gbiaYmd`). 목록은 접수기간을 안 주므로
 *  cbf·itp·ketep 와 같이 「등록일 ~」 개시형으로 싣는다.
 */
const BASE = "https://gbia.or.kr";
const LIST = "/bbs/board.php";
const BOARD = "business";
const WR_ID = /[?&]wr_id=(\d+)/;
const MMDD = /^(\d{1,2})-(\d{1,2})$/;
const ROW = "#bo_list table tbody tr";

/**
 * 지원사업이 아닌 글. **버릴 것만** 지정한다.
 * 실측 1쪽 15건에는 한 줄도 안 걸린다 — 채용(`bo_table=recruit`)·입찰(`bo_table=bid`)이
 * 다른 판이기 때문이다. 나중에 이 판으로 흘러들어올 그물로 둔다.
 * ★`채용` 을 통째로 버리면 안 된다 — 고용보조금이 제목에 「채용」을 쓴다(bizbc 주석).
 */
const DROP = /입찰|낙찰|용역\s*공고/;
/**
 * ★「공고·안내」를 **선택으로 두면 안 된다** — 그러면 「청년 **신규채용** 인건비 지원사업
 *  참여기업 모집」처럼 기업이 수혜자인 고용보조금 공고까지 함께 죽는다(2026-09-06 시험에서 잡음).
 */
const DROP_STAFF = /(?:신규|경력|직원|계약직|기간제)\s*채용\s*(?:공고|안내)|채용\s*공고/;

/** 시험이 제목 글자만으로 거르개를 잴 수 있게 내보낸다. */
export function isGbiaDropTitle(title: string): boolean {
  return DROP.test(title) || DROP_STAFF.test(title);
}

/** 달력에 있는 날짜인지. `gbiaYmd` 가 2월 29일을 엉뚱한 해에 붙이지 않게 한다. */
function isRealDate(y: number, m: number, d: number): boolean {
  const probe = new Date(Date.UTC(y, m - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
}

/**
 * 목록의 「MM-DD」에 해를 메워 `YYYY-MM-DD` 로. 읽을 수 없으면 "".
 * 등록일은 미래일 수 없다 — 수집 시각(KST)보다 뒤면 지난해로 본다.
 */
export function gbiaYmd(text: string, now = Date.now()): string {
  const raw = text.replace(/\s+/g, " ").trim();
  const m = raw.match(MMDD);
  if (!m) return "";
  const mo = Number(m[1]);
  const da = Number(m[2]);
  const kst = new Date(now + 9 * 3_600_000);
  const year = kst.getUTCFullYear();
  const todayKey = (kst.getUTCMonth() + 1) * 100 + kst.getUTCDate();
  const guess = mo * 100 + da > todayKey ? year - 1 : year;
  for (const y of [guess, guess - 1]) {
    if (isRealDate(y, mo, da)) return `${y}-${String(mo).padStart(2, "0")}-${String(da).padStart(2, "0")}`;
  }
  return "";
}

export function parseGbiaList(html: string, _page = 1, now = Date.now()): BoardRow[] {
  const out: BoardRow[] = [];
  const seen = new Set<string>();
  for (const tr of parseHtml(html).querySelectorAll(ROW)) {
    const a = tr.querySelector("td.td_subject a");
    const id = (a?.getAttribute("href") ?? "").match(WR_ID)?.[1] ?? "";
    if (!id || seen.has(id)) continue;
    const title = (a?.text ?? "").replace(/\s+/g, " ").trim();
    if (!title || isGbiaDropTitle(title)) continue;
    /**
     * 등록일은 **`td.td_date` 칸을 직접** 집는다.
     * ⚠️ 행 전체 글자(`tr.text`)에서 찾으면 안 된다 — 번호 「817」 + 「09-02」가
     *    「81709-02」로 붙는다(hsbiz 실측 함정).
     */
    const ymd = gbiaYmd(tr.querySelector("td.td_date")?.text ?? "", now);
    seen.add(id);
    out.push({
      title,
      // 쪽 번호를 넣지 않는다 — 주소가 곧 중복 판정 열쇠(sourceId)라 쪽마다 다른 줄이 된다.
      detailUrl: `${BASE}${LIST}?bo_table=${BOARD}&wr_id=${id}`,
      dateText: ymd ? `${ymd} ~` : "",
      category: "",
      agency: "김해의생명산업진흥원",
    });
  }
  return out;
}

export const gbiaConfig: BoardConfig = {
  id: "gbia",
  label: "김해의생명산업진흥원",
  agency: "김해의생명산업진흥원",
  region: "경남",
  baseUrl: `${BASE}/`,
  /**
   * 페이지 글자표는 **utf-8** 이다(고정본 `<meta charset="utf-8">` 실측).
   * 첨부 **파일 이름**만 응답 헤더에서 EUC-KR 로 오는데(`content-disposition: filename="…pdf"`),
   * 저장되는 이름은 상세 HTML 의 링크 글자(`a.view_file_download strong`)에서 가져오므로
   * 여기서 `euc-kr` 로 적으면 안 된다 — 적으면 목록·상세 한글이 통째로 깨지고,
   * 첨부 주소 인코딩 규칙(`attachment-url.ts`)까지 euc-kr 로 돌아 주소가 틀어진다.
   * (그 규칙이 필요한 곳은 파일 이름이 **주소**에 들어가는 충북TP 같은 게시판이다.
   *  여기 첨부 주소는 `download.php?bo_table=…&wr_id=…&no=0` 라 한글이 없다.)
   */
  charset: "utf-8",
  list: {
    url: (p) => `${BASE}${LIST}?bo_table=${BOARD}&page=${p}`,
    maxPages: 5,
    rowSelector: ROW,
    fields: {
      title: { selector: "td.td_subject a" },
      detailUrl: { selector: "td.td_subject a", attr: "href" },
      date: { selector: "td.td_date" },
    },
  },
  customParse: parseGbiaList,
  /** 본문은 `#bo_v_con`. 첨부는 같은 표의 다른 줄이라 범위는 게시글 껍데기(`#bo_v`)로 둔다. */
  detailContentSelector: "#bo_v_con",
  attachmentsScopeSelector: "article#bo_v",
  /**
   * ★첨부는 **상세 세션 쿠키가 있어야** 내려온다(2026-09-06 curl 실측, wr_id=904&no=0):
   * · 그냥 GET(+Referer) → 200 + `text/html` 3,829바이트 + `Set-Cookie: PHPSESSID…`
   *   (차단이 아니라 그누보드 중간 페이지 — 성공처럼 생겨서 뒷단계가 「읽지 못한 첨부」로
   *    적고 7일 도장을 찍는다)
   * · 상세를 먼저 GET 해 받은 쿠키를 같은 단지로 실으면 → 200 +
   *   `content-disposition: attachment; filename="…pdf"` + PDF 173,015바이트
   * 세종TP(`sjtp`)와 같은 갈래다. `Referer` 도 함께 붙인다 — 브라우저와 같은 모양이라
   * 그누보드 설정이 바뀌어 Referer 검사를 켜도 그 자리에서 안 깨진다.
   */
  attachmentSession: { warmup: "detail", referer: "detail" },
  // 한 쪽 15건(거르개 뒤 실측 15건). 절반인 7 밑으로 떨어지면 서식 변경을 의심한다.
  expectMinRows: 7,
  // 2026-09-06 실측: 미국·서울 VM 둘 다 차단(데이터센터 IP) — 명부 blocked, 풀리면 자동 복귀
  requiresProxy: true,
};
