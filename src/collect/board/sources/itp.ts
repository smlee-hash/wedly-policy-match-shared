import { parseHtml } from "../html";
import type { BoardConfig, BoardRow } from "../types";

/**
 * 인천테크노파크 「ITP 뉴스 > 지원사업」(`intro.asp?tmid=13`).
 *
 * 구조(2026-09-03 실측):
 * · 행 = `table.list.fixed tbody tr` — 한 쪽 10건, 붙박이(공지) 행이 **없다**(1·2쪽 20줄 전부 일반 행).
 * · 칸 = 번호 / 분야(`td.subjectc`) / 제목(`td.subject > a`) / 작성일(`td.idWriteDateData`) /
 *        진행상태 아이콘 / 조회수(`td.idVisitNumData`)
 * · 목록은 **작성일만** 준다(마감일은 상세에만 있다) — pipa·kbiz 와 같이 「등록일 ~」 개시형.
 *
 * ★제목 링크가 **의사링크**다: `href="javascript:fncShow('11100')"`.
 *   스크립트 본문이 `location.href="/intro.asp?tmid=13&seq="+seq` 뿐이라(`/script/tools_window.js` 244행)
 *   JS 실행 없이 번호만 뽑아 주소를 조립하면 된다 — `seq=11100` 을 직접 GET 해 상세 HTML 을 받아 확인했다.
 *   `javascript:` 를 그대로 실으면 중복 열쇠(sourceId)에 못 쓰는 주소가 저장된다.
 *
 * ★쪽넘김이 **URL 쿼리가 아니라 POST 본문**이다(`fncBoardPage(n)` 가 `document.frmSearch` 를 제출).
 *   주소는 쪽과 무관하게 `/intro.asp?tmid=13` 이고 `PageNum` 이 쪽을 나른다 — ccei 방식으로 `list.init` 에 싣는다.
 *   실측: POST `PageNum=1` → 1쪽(seq 11100…) · `PageNum=2` → 2쪽(seq 11075…). 전체 336쪽.
 *
 * ⚠️ 브라우저 UA 가 있어야 목록을 준다. 빈 UA·`curl/8.7.1` 은 쿠키를 미리 받아도, Referer 를 홈으로 줘도
 *    매번 200 이지만 1,372바이트짜리 「요청하신 페이지를 찾을 수 없습니다」 안내만 돌려준다(조합 4가지 대조).
 *    엔진이 이미 브라우저 UA 를 붙이므로 설정에 따로 적을 것은 없다 — 이 주석이 기록이다.
 */
const BASE = "https://itp.or.kr";
const LIST = `${BASE}/intro.asp?tmid=13`;
/** 게시판 식별 hidden 값. 빠지면 서버가 1쪽으로 되돌린다(frmSearch 실측). */
const BID = "1";
const TMID = "13";
const PER_PAGE = "10";
const SHOW = /fncShow\(\s*['"](\d+)['"]\s*\)/;
const YMD = /(20\d{2})-(\d{1,2})-(\d{1,2})/;

/**
 * 지원사업이 아닌 글. **버릴 것만** 좁게 잡는다.
 * 실측 제목: 「인천 ICT콤플렉스 **개소식** 개최 안내」·「공모전 1차 **심사 결과**(입상작) 발표」·
 * 「지원사업 최종 **선정기업 안내**」·「글로벌 실증 파트너십 지원 사업 과제 **선정 통지**」.
 *
 * ★`채용`·`안내`·`공고` 를 통째로 버리면 안 된다 — 「채용 지원사업」·「참가자 모집 안내」·
 *   「중소기업육성자금 지원 공고」가 같이 죽는다(bizbc 주석). 그래서 뒤따르는 낱말까지 붙여 좁힌다.
 */
const DROP =
  /개소식|선정\s*통지|선정\s*기업\s*(?:안내|발표|공고)|선정\s*결과|심사\s*결과|결과\s*발표|합격자|입찰\s*공고|평가위원|심사위원\s*(?:모집|위촉)|설문\s*조사|채용\s*공고/;

export function isItpDropTitle(title: string): boolean {
  return DROP.test(title);
}

export function parseItpList(html: string, _page = 1): BoardRow[] {
  const out: BoardRow[] = [];
  const seen = new Set<string>();
  for (const tr of parseHtml(html).querySelectorAll("table.list.fixed tbody tr")) {
    const a = tr.querySelector("td.subject > a") ?? tr.querySelector("td.subject a");
    const seq = (a?.getAttribute("href") ?? "").match(SHOW)?.[1] ?? "";
    if (!seq || seen.has(seq)) continue;
    const title = (a?.text ?? "").replace(/\s+/g, " ").trim();
    if (!title || DROP.test(title)) continue;
    /**
     * 작성일은 **`td.idWriteDateData` 칸을 직접** 집는다.
     * ⚠️ 행 전체 글자(`tr.text`)에서 찾으면 안 된다 — 실측 행이
     *    「3353 혁신창업센터 … 2026-09-01 159」라 번호·조회수가 날짜에 붙는다(hsbiz 함정).
     */
    const cell = (tr.querySelector("td.idWriteDateData")?.text ?? "").replace(/\s+/g, " ").trim();
    const d = cell.match(YMD);
    const ymd = d ? `${d[1]}-${d[2].padStart(2, "0")}-${d[3].padStart(2, "0")}` : "";
    seen.add(seq);
    out.push({
      title,
      // 쪽 번호는 POST 본문에만 있어 주소에 섞일 여지가 없다 — 주소가 곧 중복 열쇠(sourceId)다.
      detailUrl: `${LIST}&seq=${seq}`,
      // 마감일은 목록에 없다(상세 `마감일` 칸에만 있다) — 등록일을 개시형으로 넘긴다.
      dateText: ymd ? `${ymd} ~` : "",
      // 분야 칸은 센터 이름(「혁신창업센터」)이다. 참고값으로만 싣고 **기관으로 쓰지 않는다** —
      // 기관을 센터별로 갈면 중복 열쇠(제목|기관)가 갈려 같은 공고가 안 묶인다(hsbiz 에서 겪은 갈래).
      category: (tr.querySelector("td.subjectc")?.text ?? "").replace(/\s+/g, " ").trim(),
    });
  }
  return out;
}

export const itpConfig: BoardConfig = {
  id: "itp",
  label: "인천테크노파크",
  agency: "인천테크노파크",
  region: "인천",
  baseUrl: `${BASE}/`,
  charset: "utf-8",
  list: {
    // POST 라 주소는 쪽과 무관하게 같다 — 쪽 번호는 init 의 본문이 나른다(ccei 방식).
    url: () => LIST,
    // 한 쪽 10건 × 10쪽 = 100건. 전체 336쪽이지만 뒤쪽은 몇 해 전 글이다.
    maxPages: 10,
    init: (p) => ({
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      // frmSearch 의 hidden 칸 그대로. 검색 조건은 비워 「전체」로 둔다.
      body:
        `search=1&tmid=${TMID}&bid=${BID}&PageShowSize=${PER_PAGE}` +
        `&search_bbstype=&PageNum=${p}&_action=&PageYOffset=`,
    }),
    rowSelector: "table.list.fixed tbody tr",
    fields: {
      title: { selector: "td.subject > a" },
      detailUrl: { selector: "td.subject > a", attr: "href", regex: "fncShow\\(\\s*'(\\d+)'" },
      date: { selector: "td.idWriteDateData" },
    },
  },
  customParse: parseItpList,
  /**
   * ★heuristic 추측 단계를 막는다.
   * 이 목록의 유일한 링크가 `javascript:fncShow('…')` 의사링크라, 선택자 단계가 실패해 추측 단계로
   * 내려가면 그 의사링크(또는 좌측 메뉴 링크)를 공고로, 메뉴 글자를 제목으로 저장한다.
   * 그렇게 들어간 줄은 다음 회차에 지워지지 않는다(koreaexim 실측 30줄).
   */
  skipHeuristic: true,
  /**
   * 상세 본문은 `div.editor` 다 — 실측 3건(seq 11010·11051·11081)을 직접 받아 확인했다.
   * 대부분 **공고문 전문**이 글자로 들어 있어(「인천광역시 공고 제2026-1631호 …」) 자격조건 추출에 그대로 쓴다.
   * 포스터 그림 한 장만 있는 글(11100·11081)은 글자가 없어 본문이 빈 채로 남는데,
   * 그 줄은 뒷단계(첨부에서 본문 뽑기)가 `targetText === ""` 조건으로 다시 집는다.
   *
   * ★첨부 범위(2026-09-03 고침): 첨부 링크는 본문 상자 **밖** `dl.view > dd.vdd` 에 있다.
   *   그래서 옛 범위(`div.editor` 하나)로는 실측 첨부가 **0건**이었다.
   *   이제 공용 수확기가 `fncFileDownload('bbs','<파일>')` → `/common/COM_FILEDOWN.ASP?a=bbs&b=<파일>`
   *   를 안다(`/script/tools_window.js` 244행 · 실호출 200 / %PDF-1.6 / 937,758바이트).
   *   `javascript:` 의사링크를 그대로 저장하던 옛 문제도 수확기가 막는다.
   *   본문 상자도 범위에 남긴다 — 본문에 파일 주소가 박혀 오는 글을 잃지 않기 위해서다.
   *   ⚠️ `dl.sub_view`(작성자·마감일)는 class 가 달라 안 걸린다 — 늘리면 안 된다.
   */
  detailContentSelector: "div.editor",
  attachmentsScopeSelector: "div.editor, dl.view dd.vdd",
  // 한 쪽 10건의 절반. 1쪽 실측이 거르개를 지나 9건이라 여유가 있다.
  expectMinRows: 5,
};
