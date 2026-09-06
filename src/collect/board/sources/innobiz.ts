import { parseHtml } from "../html";
import type { BoardConfig, BoardRow } from "../types";

/**
 * 이노비즈협회(중소기업기술혁신협회) 지원정보 게시판(`notice.asp?menuno=2`).
 *
 * 왜 연결했나(2026-09-06 실측): 1쪽 20건 중 9건이 기업이 신청하는 지원사업이고
 * (WISET 대체인력·기술보증기금 유동화회사보증·KOICA 중점지원기업·직무발명 컨설팅 …)
 * 협단체가 모아 올리는 글이라 기존 105곳에 없는 민간 출처가 섞여 있다.
 * 서버 렌더 ASP(IIS/10.0) — JS 실행·쿠키·열쇠 전부 불필요(첨부 PDF 134,635바이트 실수신).
 *
 * ★robots 표식(방침 판단 필요): `https://innobiz.or.kr/robots.txt` 전문이 2줄
 *   `User-agent:*` / `Disallow:/` — **전 경로 수집 금지**다. 기술적 차단·캡차는 없다.
 *   안양산업진흥원과 **같은 관례로 진행**하되 이 사실을 여기와 명부 note 에 남긴다.
 *
 * ★호스트에 `www` 를 붙이면 안 된다(2026-09-06 curl 실측): `https://www.innobiz.or.kr/` 는
 *   `SSL: no alternative certificate subject name matches target host name` (인증서에 www 가 없다).
 *   사이트 안에는 www 로 걸린 링크가 남아 있어, 이 파일이 만드는 주소는 전부
 *   `stripInnobizWww` 를 지나 비-www 로 굳힌다. `allowedHosts` 에도 www 를 넣지 않는다 —
 *   넣으면 뒷단계가 인증서 오류로 죽는 주소를 붙잡고 7일 도장을 찍는다.
 *
 * ★루트 `/` 는 본문 94바이트짜리 JS 리다이렉트(`location.href='/MA/introgate.asp'`)다.
 *   `curl -L` 로도 안 따라가므로 목록 주소를 직접 잡는다(아래 `LIST`).
 *
 * 구조: `div.table-box.notice table tr`. **tbody·thead 가 없고** 첫 `tr` 이 머리줄(NO/구분/
 * 지원사업명/작성일)이라 `td.title` 이 있는 행만 담는다. 상세 열쇠는 제목 칸의
 * `onClick="eDataView('3634')"` — `a href` 가 아예 없다. 쪽넘김 GET `Page=n`(대문자 P) ·
 * 한 쪽 20건 · 전체 약 170쪽. charset utf-8(`<meta charset="utf-8">`).
 * 목록은 **작성일만** 준다(접수기간 칸 없음) — cbf·itp·ketep 와 같이 「등록일 ~」 개시형.
 */
const HOST = "innobiz.or.kr";
const BASE = `https://${HOST}`;
const DIR = "/IB/news";
const MENU = "2";
const VIEW_ID = /eDataView\(\s*'(\d+)'\s*\)/;
const YMD = /(20\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})/;
const ROW = "div.table-box.notice table tr";

/**
 * 지원사업이 아닌 글. **버릴 것만** 지정한다.
 * 실측 1쪽 20건의 비대상 갈래(지시받은 6종): 포상·설문·포럼·교육·시상·유공.
 * ★`공모`·`모집` 을 통째로 버리면 안 된다 — 지원사업 공고가 그 낱말을 쓴다(kodma 주석).
 * ★`채용` 도 통째로는 못 버린다 — 고용보조금이 제목에 「채용」을 쓴다(bizbc 주석).
 * ★`상\s*선정계획` 을 그대로 두면 안 된다(2026-09-06 적대 리뷰 보통4) —
 *  「스마트공장 구축 **지원대상 선정계획** 공고」처럼 기업 대상 공고가 함께 죽는다.
 *  포상·시상이 앞에 붙은 경우(「올해의 여성과학기술인상 선정계획」)만 친다.
 * ★`주간$` 도 너무 넓었다 — 실측 제목 그대로 `지식재산 주간` 만 친다.
 */
const DROP =
  /포상|시상|유공|설문|실태\s*조사\s*(?:참여|안내)?|포럼|세미나|웨비나|수강생\s*모집|교육생\s*모집|교육\s*프로그램|재직자\s*교육|아카데미|양성\s*과정|지식재산\s*주간|(?:포상|시상)\s*선정계획/;

/** 시험이 제목 글자만으로 거르개를 잴 수 있게 내보낸다. */
export function isInnobizDropTitle(title: string): boolean {
  return DROP.test(title);
}

/**
 * `www.innobiz.or.kr` → `innobiz.or.kr`. 그 밖의 호스트는 손대지 않는다.
 * 인증서에 www 가 없어(위 주석) www 주소는 TLS 단계에서 죽는다.
 */
export function stripInnobizWww(url: string): string {
  return url.replace(/^(https?:\/\/)www\.innobiz\.or\.kr(?=[/:?#]|$)/i, `$1${HOST}`);
}

export function parseInnobizList(html: string): BoardRow[] {
  const out: BoardRow[] = [];
  const seen = new Set<string>();
  for (const tr of parseHtml(html).querySelectorAll(ROW)) {
    // 머리줄은 `th` 뿐이라 `td.title` 이 없다 — 클래스 대신 있고 없음으로 가른다.
    const td = tr.querySelector("td.title");
    if (!td) continue;
    const id = (td.getAttribute("onClick") ?? td.getAttribute("onclick") ?? "").match(VIEW_ID)?.[1] ?? "";
    if (!id || seen.has(id)) continue;
    const title = td.text.replace(/\s+/g, " ").trim();
    if (!title || isInnobizDropTitle(title)) continue;
    const tds = tr.querySelectorAll("td");
    /**
     * 작성일은 **마지막 td 칸을 직접** 집는다(NO|구분|지원사업명|작성일).
     * ⚠️ 행 전체 글자(`tr.text`)에서 찾으면 안 된다 — 번호 「3388」 + 「2026-09-04」가
     *    「33882026-09-04」로 붙는다(hsbiz 실측 함정).
     */
    const d = (tds[tds.length - 1]?.text ?? "").replace(/\s+/g, " ").trim().match(YMD);
    const ymd = d ? `${d[1]}-${d[2].padStart(2, "0")}-${d[3].padStart(2, "0")}` : "";
    seen.add(id);
    out.push({
      title,
      // 쪽 번호를 넣지 않는다 — 주소가 곧 중복 판정 열쇠(sourceId)라 쪽마다 다른 줄이 된다.
      detailUrl: stripInnobizWww(`${BASE}${DIR}/notice_view.asp?idx=${id}&menuno=${MENU}`),
      dateText: ymd ? `${ymd} ~` : "",
      category: (tds[1]?.text ?? "").replace(/\s+/g, " ").trim(),
      agency: "이노비즈협회",
    });
  }
  return out;
}

export const innobizConfig: BoardConfig = {
  id: "innobiz",
  label: "이노비즈협회",
  agency: "이노비즈협회",
  region: "전국",
  baseUrl: `${BASE}/`,
  charset: "utf-8",
  list: {
    url: (p) =>
      `${BASE}${DIR}/notice.asp?Page=${p}&menuno=${MENU}&sfield=&stext=&status_s=&ste=&sty=&bct_s=&ord=0`,
    maxPages: 5,
    rowSelector: ROW,
    fields: {
      title: { selector: "td.title" },
      detailUrl: { selector: "td.title", attr: "onClick", regex: "eDataView\\(\\s*'(\\d+)'\\s*\\)" },
      date: { selector: "td:last-child" },
    },
  },
  customParse: parseInnobizList,
  /**
   * 상세 본문은 `section.content`. 첨부도 이 안에 있다 — 내려받기 스크립트를 거치지 않는
   * 정적 파일(`/Data/BM83/<한글이름>.pdf`)이 본문 링크로 박혀 있어 공용 수확기가 그대로 집는다.
   * 범위를 본문으로 못 박아 위쪽 메뉴·바닥글 링크가 첨부로 저장되는 것을 막는다.
   */
  detailContentSelector: "section.content",
  attachmentsScopeSelector: "section.content",
  /**
   * ★추측 단계를 끈다. 제목 링크가 `a href` 없이 `onClick` 뿐이라, 추측 단계가 `a[href]` 를
   * 긁으면 메뉴·바닥글이 공고로 저장된다(수출입은행에서 겪은 갈래).
   */
  skipHeuristic: true,
  // 1쪽 20건에서 거르개 뒤 실측 13건. 0행이면 서식 변경이므로 7로 둔다.
  expectMinRows: 7,
};
