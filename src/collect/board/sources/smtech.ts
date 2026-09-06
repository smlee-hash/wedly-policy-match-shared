import { decodeHtmlEntities, parseHtml } from "../html";
import type { BoardConfig, BoardRow } from "../types";

/**
 * 중소기업기술정보진흥원(SMTECH) — 중기부 R&D 사업공고
 * (`정보마당 > 알림마당 > R&D 사업공고`, `notice02_list.do`).
 *
 * 왜 이 주소인가(2026-09-03 실측): 조사가 잡아 온 메인 화면 위젯
 * (`main.do` 의 `div.notice_list[name=ancmList]`)은 한 판에 56건이 박혀 있지만 **쪽넘김이 없다.**
 * 같은 자료의 정식 목록인 `notice02_list.do` 는 **한 쪽 15건 · 228쪽**(sysGubun=smtech 기준)이고
 * `?pageIndex=n` GET 으로 그대로 넘어간다 — 「단 1건도 놓치지 않는다」에 맞는 쪽은 이쪽이다.
 * 게다가 위젯은 제목을 「…추천기업(방산 및 전략...」처럼 **잘라서** 보여 준다.
 *
 * 구조: `div.right table.tbl_base.tbl_type01 tbody tr` (칸 7개 — 번호·시스템구분·사업명·제목·접수기간·공고일·상태).
 * 제목·상세는 `a.board`, 상세는 `notice02_detail.do?ancmId&buclCd&dtlAncmSn&schdSe&aplySn`.
 * ★행 선택자를 `div.right` 로 감싸는 이유: 이 사이트는 모든 화면에 **로그인 ID/PW 알림창**
 *   (`#idpwPop` 안의 `table.tbl_type01.tbl_base.gap_div`)을 숨겨 두는데, 같은 표 이름이라
 *   안 감싸면 빈 줄 3개가 목록에 섞인다(실측).
 *
 * ⚠️⚠️ **세션 표(`;jsessionid=…`)를 반드시 떼어낸다.** 이 사이트는 쿠키가 없으면 모든 링크를
 *   `notice02_detail.do;jsessionid=<매번 다른 값>?ancmId=…` 로 바꿔서 준다. 수집기는 목록 한 쪽마다
 *   새 요청(= 새 세션)으로 부르므로, 안 떼면 **같은 공고가 회차마다 새 줄로 저장된다**
 *   (상세 주소가 곧 중복 판정 열쇠 sourceId). 같은 이유로 `skipHeuristic: true` — 추측 단계는
 *   세션 표를 못 떼서 그 중복을 그대로 쌓는다.
 *
 * ★`sysGubun=smtech` 로 좁힌다. 안 좁히면 목록에 **IRIS(범부처통합연구지원시스템) 줄**이 섞이는데,
 *   그 줄의 제목 링크는 `javascript:goMove()`(iris.go.kr 로 가겠냐는 알림창)라 **공고마다 다른 주소가
 *   아예 없다.** 담으면 전 줄이 한 열쇠로 뭉치고, 빈 주소로 담으면 「링크가 상세 주소 모양 아님」
 *   검증(60%)에 걸려 **뒷쪽이 통째로 끊긴다**(실측 2쪽은 15줄 중 10줄이 IRIS). 좁히면 15줄 전부
 *   진짜 주소가 있어 검증이 안정적이다. IRIS 공고는 iris.go.kr 을 보는 **별도 출처**가 맡아야 한다.
 */
const BASE = "https://www.smtech.go.kr";
const LIST = "/front/ifg/no/notice02_list.do";
const DETAIL = "/front/ifg/no/notice02_detail.do";
const FILE_DOWN = "/front/comn/AtchFileDownload.do";
const ROWS = "div.right table.tbl_base.tbl_type01 tbody tr";
const JSESSION = /;jsessionid=[^?#]*/i;
/** 상세 주소에서 지울 검색·쪽 인자. `pageIndex` 를 남기면 같은 글이 쪽마다 다른 줄이 된다. */
const NOISE_PARAMS = ["searchCondition", "searchKeyword", "pageIndex"];
const YMD = /(20\d{2})[.\-/]\s*(\d{1,2})[.\-/]\s*(\d{1,2})/;
const PERIOD = new RegExp(`${YMD.source}\\s*~\\s*${YMD.source}`);
/** 첨부 내려받기 — `cfn_AtchFileDownload('<파일열쇠>','/front','fileDownFrame')`. */
const ATCH = /cfn_AtchFileDownload\(\s*['"]([A-Za-z0-9]+)['"]/;
/** 상세 본문 구역을 감싼 서버 서식 표식. 실측 상세 4건 전부에 정확히 한 번씩 있다. */
const BODY_START = /<!--\s*공지사항 내용 시작입니다\s*-->/;
const BODY_END = /<!--\s*공지사항 내용 마침니다\s*\/\/-->/;
const CAPTION = "사업공고 목록보기 내용";

/**
 * 지원사업이 아닌 글. **버릴 것만** 좁게 지정한다.
 * 실측 1~3쪽 45건 중 걸리는 것은 「2026년 DCP(생태계혁신형) 민간전문가 **배심원단** 모집 안내」 하나뿐 —
 * 기업을 지원하는 공고가 아니라 심사에 참여할 사람을 뽑는 글이다(평가위원과 같은 갈래).
 * ★`채용` 을 통째로 버리면 안 된다 — 실측에 「중소기업 연구인력지원사업(**채용**, 신진) 공고」가 있다.
 */
const DROP = /입찰|설문|평가위원|심사위원|배심원단|합격자|낙찰|채용\s*공고/;

export function isSmtechDropTitle(title: string): boolean {
  return DROP.test(title);
}

function ymd(text: string): string {
  const m = text.match(YMD);
  return m ? `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}` : "";
}

/** 목록 링크 → 세션 표·검색·쪽 인자를 뗀 상세 주소. 공고 링크가 아니면 빈 글자. */
function detailUrlOf(href: string): string {
  const raw = decodeHtmlEntities(href).replace(JSESSION, "");
  if (!raw.includes(DETAIL)) return "";
  let u: URL;
  try {
    u = new URL(raw, `${BASE}/`);
  } catch {
    return "";
  }
  if (!(u.searchParams.get("ancmId") ?? "").trim()) return "";
  for (const k of NOISE_PARAMS) u.searchParams.delete(k);
  // `buclYy` 는 실측이 전부 빈 값이다. 값이 있으면 상세를 여는 데 쓰일 수 있으니 그때만 남긴다.
  if (!(u.searchParams.get("buclYy") ?? "").trim()) u.searchParams.delete("buclYy");
  return u.toString();
}

/**
 * 상세에서 **본문 구역만** 잘라 낸다.
 *
 * ⚠️ 「caption 으로 표를 찾아 `outerHTML`」로는 안 된다(2026-09-03 실측). 공용 `parseHtml` 은
 *    `parseNoneClosedTags: true` 로 읽는데, 공고 본문이 한글에서 붙여 넣은 HTML 이라 안 닫힌 딱지가
 *    섞여 있다 — 그러면 표가 문서 끝까지 안 닫혀 **바닥글(관계사이트·개인정보처리방침)까지 통째로**
 *    딸려 온다(실측 링크 4개여야 할 자리에 26개).
 *    그래서 파싱 전에 **서버 서식 표식으로 원문을 먼저 자른다.**
 * 표식이 사라지면 caption 으로 표를 찾아 두 번째 길로 간다 — 바닥글이 섞여도 껍데기보다는 낫다.
 */
function contentHtmlOf(html: string): string {
  const s = html.match(BODY_START);
  const e = html.match(BODY_END);
  if (s?.index != null && e?.index != null && e.index > s.index) {
    return html.slice(s.index + s[0].length, e.index);
  }
  return (
    parseHtml(html)
      .querySelectorAll("table")
      .find((t) => (t.querySelector("caption")?.text ?? "").includes(CAPTION))?.outerHTML ?? ""
  );
}

export function parseSmtechList(html: string, _page = 1): BoardRow[] {
  const out: BoardRow[] = [];
  const seen = new Set<string>();
  for (const tr of parseHtml(html).querySelectorAll(ROWS)) {
    const a = tr.querySelector("a.board");
    const detailUrl = detailUrlOf(a?.getAttribute("href") ?? "");
    if (!detailUrl || seen.has(detailUrl)) continue;
    const title = (a?.text ?? "").replace(/\s+/g, " ").trim();
    if (!title || DROP.test(title)) continue;
    /**
     * 날짜는 **칸(td)을 직접** 집는다.
     * ⚠️ 행 전체 글자(`tr.text`)에서 정규식으로 찾으면 안 된다 — 번호 칸 「7」과 공고일이
     *    「72026-09-01」로 붙는다(hsbiz 실측 함정).
     */
    const tds = tr.querySelectorAll("td");
    const periodCell = (tds[4]?.text ?? "").replace(/\s+/g, " ").trim();
    const p = periodCell.match(PERIOD);
    // 접수기간이 비어 있으면 공고일만 개시형으로 — 오늘 날짜를 지어내지 않는다.
    const registered = ymd((tds[5]?.text ?? "").replace(/\s+/g, " ").trim());
    const dateText = p
      ? `${p[1]}-${p[2].padStart(2, "0")}-${p[3].padStart(2, "0")} ~ ${p[4]}-${p[5].padStart(2, "0")}-${p[6].padStart(2, "0")}`
      : registered
        ? `${registered} ~`
        : "";
    seen.add(detailUrl);
    out.push({
      title,
      detailUrl,
      dateText,
      // 「사업명」 칸 — 「공공연연구인력파견지원(참여기업접수용)」처럼 어느 사업의 회차인지 알려 준다.
      category: (tds[2]?.text ?? "").replace(/\s+/g, " ").trim(),
    });
  }
  return out;
}

export const smtechConfig: BoardConfig = {
  id: "smtech",
  label: "중소기업기술정보진흥원(SMTECH)",
  agency: "중소기업기술정보진흥원",
  region: "전국",
  baseUrl: `${BASE}/`,
  charset: "utf-8",
  list: {
    url: (p) => `${BASE}${LIST}?sysGubun=smtech&pageIndex=${p}`,
    // 한 쪽 15건 · 실측 228쪽(공고일 내림차순). 5쪽이면 최근 75건 ≈ 8개월치로 새 공고를 놓치지 않는다.
    maxPages: 5,
    rowSelector: ROWS,
    fields: {
      title: { selector: "a.board" },
      detailUrl: { selector: "a.board", attr: "href" },
      date: { selector: "td:nth-child(5)" },
    },
  },
  customParse: parseSmtechList,
  /**
   * 상세 본문을 **직접 조달한다.** 이 게시판은 첨부가 `<a href="javascript:cfn_AtchFileDownload('열쇠',…)">`
   * (또는 `href="#list"` + 같은 onclick)라, 그대로 두면 공용 첨부 수확기가 `javascript:` 주소를
   * 저장하고 뒷단계가 「허용하지 않은 주소」로 막아 **공고문 HWP 를 영영 못 읽는다.**
   * 본문 글자는 대개 「자세한 내용은 첨부파일 「공고문」을 참고해주시길 바랍니다」 한 줄뿐이라
   * (실측 S02847) 첨부를 못 열면 자격조건이 통째로 빈다.
   *
   * 그래서 상세 HTML 을 받아 **① 본문 구역만 잘라 내고(`contentHtmlOf`) ② 첨부 링크를 실제 GET 주소
   * `/front/comn/AtchFileDownload.do?atchFileId=…` 로 바꿔** 돌려준다
   * (그 주소는 사이트 자신의 `cfn_AtchFileDownloadUrl` 이 쓰는 것 — 실측 HTTP 200 · 91,648바이트 HWP).
   * 통째로 안 주고 잘라 내는 이유는 krit 과 같다 — 메뉴·바닥글 글자가 자격조건으로 들어가고
   * 사이트 공용 파일이 첨부로 수확된다.
   */
  detailFetch: async (detailUrl, fetchText) => {
    const content = contentHtmlOf(await fetchText(detailUrl));
    if (!content.trim()) return "";
    const root = parseHtml(content);
    for (const a of root.querySelectorAll("a")) {
      const id = `${a.getAttribute("href") ?? ""} ${a.getAttribute("onclick") ?? ""}`.match(ATCH)?.[1];
      if (!id) continue;
      a.removeAttribute("onclick");
      a.setAttribute("href", `${FILE_DOWN}?atchFileId=${id}`);
    }
    return root.toString();
  },
  // 한 쪽 15건 — 절반이 깨지면 서식이 바뀐 것으로 본다.
  expectMinRows: 7,
  /**
   * ★추측 단계를 끈다. 이 사이트는 쿠키 없는 요청에 `;jsessionid=<매번 다른 값>` 을 박아 주는데,
   * 추측 단계는 링크를 그대로 담아 **회차마다 전 공고를 새 줄로 저장한다.**
   * (`dropUrlParams` 로는 못 막는다 — 세션 표가 물음표 앞 **경로**에 붙는다.)
   */
  skipHeuristic: true,
};
