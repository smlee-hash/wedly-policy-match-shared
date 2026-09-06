import { parseHtml } from "../html";
import type { BoardConfig, BoardRow } from "../types";

/**
 * 한국산업단지공단 공지사항(`boardList/1016`).
 *
 * 왜 이 게시판인가(2026-09-03 실측): 홈 네비게이션의 `boardList` 25개를 전부 열어 봤지만
 * **「지원사업」 전용 게시판은 없다.** 산업단지 입주기업 모집공고·공모가 언론자료·행정공지와
 * 섞여 이 공지사항 한 곳에 올라온다(1쪽 18줄 중 지원사업이 13건). 입찰공고(1002)·임대분양(1003)·
 * 채용공고(1019)는 우리가 담을 것이 아니라 붙이지 않는다.
 *
 * 구조(실측):
 * · 목록 GET `?pageIndex={쪽}` · 총 1,042건 / 105쪽 · 한 쪽 18줄 = **붙박이 공지 8 + 일반 10**
 * · 행 `table.board tbody tr`
 * · 제목 `td.cont > a` — **`href` 는 전부 `#none`** 이고 진짜 주소는
 *   `onClick="bbsArticleDet('49468')"` 안에 있다. 그래서 번호를 뽑아 손으로 조립한다.
 * · 상세 `GET /boardDetail/1016?bbsSeq={번호}` (페이지 JS 는 POST 폼이지만 GET 으로도 본문 200 — 실측)
 * · 날짜 `td.b_date`(등록일만) · 본문 `div.detPage div.tbody`(실측 49431 본문 654자)
 *
 * ⚠️ 브라우저 User-Agent 가 없으면 **HTTP 400**(1,186바이트, WAF 로 보임)을 준다. 엔진이 이미
 *    UA 를 붙이므로 설정에 적을 것은 없다 — 400 이 보이면 UA 부터 의심하라는 기록만 남긴다.
 */
const BASE = "https://www.kicox.or.kr";
const BOARD = "1016";
const DET = /bbsArticleDet\(\s*'(\d+)'\s*\)/;
const YMD = /(20\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})/;

/**
 * 지원사업이 아닌 글. **버릴 것만** 좁게 지정한다.
 *
 * 실측(1·2쪽 36줄)에서 버릴 것: 「… 의료기기 혁신성장 **세미나 개최** 안내」·「사전 **수요조사**
 * (**설문조사**)」·「잡 페스티벌 **구인기업** 모집」·「유공 **포상계획** 공고」(2건)·「산업단지 발전
 * **유공자** 모집」·「건축**자문위원** 모집」·「근로자 **통근버스** 노선도 안내」.
 *
 * ★넓게 잡으면 안 되는 자리 둘:
 *   ⓐ `수요조사` 는 버리되 **`수요기업` 은 살린다** — 「에너지자급자족형 인프라 구축사업
 *      수요기업 모집공고」가 이 게시판 지원사업의 큰 갈래다(실측 5건).
 *   ⓑ `채용` 을 통째로 버리지 않는다 — 고용보조금은 제목에 「채용」을 쓴다(bizbc·cwip 에서 겪음).
 *      기관이 사람을 뽑는 글(`채용 공고`)만 좁게 버린다.
 * ★`설명회` 는 **일부러 안 넣었다** — 실측 표본에 없고, 「지원사업 설명회 및 참여기업 모집」처럼
 *   신청이 딸린 글까지 죽는다. 낱말을 늘리려면 실측 제목을 먼저 확인하고 늘린다.
 * `입찰 공고`·`낙찰` 은 전용 게시판(1002)이 따로 있어 여기 섞이면 흘린 글이다 — 좁게 버린다.
 */
// 「잡 페스티벌 구인기업 모집」은 기업이 참가 신청하는 공고라 거르지 않는다(코덱스 지적 2026-09-03).
const DROP =
  /세미나\s*개최|수요조사|설문조사|채용\s*공고|평가위원|자문위원|유공자|유공\s*포상|포상\s*계획|포상계획|통근버스|입찰\s*공고|낙찰/;

/** 시험이 제목 글자만으로 거르개를 잴 수 있게 내보낸다. */
export function isKicoxDropTitle(title: string): boolean {
  return DROP.test(title);
}

/**
 * 붙박이 공지 중 **1년 넘게 붙어 있는 것은 버린다**(koreaexim·kbiz 와 같은 갈래).
 * 붙박이는 날짜를 비워 저장하는데, 그러면 처음 본 날부터 90일 동안 「모집중」이 된다.
 * 오래 붙어 있는 붙박이는 대개 안내문이라 그렇게 되살리면 안 된다.
 */
const PINNED_MAX_AGE_MS = 365 * 24 * 3600_000;

export function parseKicoxList(html: string, page = 1, now = Date.now()): BoardRow[] {
  const out: BoardRow[] = [];
  const seen = new Set<string>();
  for (const tr of parseHtml(html).querySelectorAll("table.board tbody tr")) {
    const a = tr.querySelector("td.cont a");
    const seq = (a?.getAttribute("onclick") ?? "").match(DET)?.[1] ?? "";
    if (!seq || seen.has(seq)) continue;
    const title = (a?.text ?? "").replace(/\s+/g, " ").trim();
    if (!title || DROP.test(title)) continue;
    /**
     * 붙박이 공지(번호 칸이 숫자가 아니라 공지 아이콘)는 **쪽마다 똑같이 되풀이된다**(실측 2쪽 확인).
     * 2쪽부터는 아예 담지 않는다 — 엔진의 중복 걸이는 주소로 거르지만, 그러면 「이 쪽에서 새로
     * 들어온 건수」가 0 으로 잡혀 뒷쪽 수집이 조기에 끊길 수 있다.
     */
    const pinned = !!tr.querySelector('td.web img[alt="공지"]');
    if (pinned && page > 1) continue;
    /**
     * 등록일은 **`td.b_date` 칸을 직접** 집는다.
     * ⚠️ 행 전체 글자(`tr.text`)에서 찾으면 안 된다 — 번호 「1042」 + 「2026-08-26」이
     *    「10422026-08-26」로 붙는다(hsbiz 실측 함정).
     */
    const d = (tr.querySelector("td.b_date")?.text ?? "").replace(/\s+/g, " ").trim().match(YMD);
    const ymd = d ? `${d[1]}-${d[2].padStart(2, "0")}-${d[3].padStart(2, "0")}` : "";
    // 오래 붙어 있는 붙박이는 아예 안 담는다 — 날짜를 비우면 처음 본 날부터 90일간 되살아난다.
    if (pinned && ymd && now - Date.parse(`${ymd}T00:00:00Z`) > PINNED_MAX_AGE_MS) continue;
    seen.add(seq);
    out.push({
      title,
      // ★쪽 번호(`pageIndex`)를 넣지 않는다 — 주소가 곧 중복 판정 열쇠(sourceId)라
      //   같은 글이 쪽마다 다른 줄로 저장된다.
      detailUrl: `${BASE}/boardDetail/${BOARD}?bbsSeq=${seq}`,
      /**
       * ★붙박이 공지는 **등록일을 개시일로 넘기지 않는다.**
       * 저장 쪽 `openStartExpired` 는 「마감일 없음 + 개시일 90일 초과」면 저장 시점에 닫는데,
       * 그 예외 `PINNED_NOTICE` 는 제목이 「[공지]」로 **시작**해야만 걸린다. 이 게시판 붙박이는
       * 「2026년 스마트그린산단 …」으로 시작해 안 걸리고, 실측 등록일이 `2026-04-01`~`2026-08-24`
       * (넉 달 전까지)라 그대로 넘기면 **저장 즉시 마감**된다. 비우면 `undatedStale`(처음 본 날
       * 기준)로 넘어가 붙어 있는 동안 모집중으로 남는다.
       */
      dateText: pinned || !ymd ? "" : `${ymd} ~`,
      category: "",
      agency: "한국산업단지공단",
    });
  }
  return out;
}

export const kicoxConfig: BoardConfig = {
  id: "kicox",
  label: "한국산업단지공단",
  agency: "한국산업단지공단",
  region: "전국",
  baseUrl: `${BASE}/`,
  charset: "utf-8",
  list: {
    url: (p) => `${BASE}/boardList/${BOARD}?pageIndex=${p}`,
    // 총 105쪽이지만 뒤로 갈수록 옛 글이다. 한 쪽 147KB — 8쪽이면 약 두 달 치가 들어온다.
    maxPages: 8,
    rowSelector: "table.board tbody tr",
    fields: {
      title: { selector: "td.cont a" },
      detailUrl: { selector: "td.cont a", attr: "onclick", regex: "bbsArticleDet\\(\\s*'(\\d+)'" },
      date: { selector: "td.b_date" },
    },
  },
  customParse: parseKicoxList,
  /**
   * 상세 본문. **첨부를 못 읽는 게시판이라 본문을 반드시 채운다**(kbiz 와 반대 판단).
   * 실측(`bbsSeq=49431`): 첨부는 `<button onclick="fnFileDownload('150293','uuid')">` 라
   * `href` 가 아예 없고, 페이지 전체에 따옴표로 감싼 `.hwp/.pdf` 주소도 0개다 →
   * `harvestBoardAttachments` 가 어떤 길로도 첨부를 못 집는다. 본문까지 비우면 이 출처는
   * **제목만** 남는다. `div.tbody` 에는 사업명·사업기간·신청대상·사업내용이 들어 있다
   * (실측 654자. 세부 자격은 「자세한 내용은 첨부파일 참고」로 넘어가지만 그 첨부는 위 이유로 못 읽는다).
   */
  detailContentSelector: "div.detPage div.tbody",
  // 첨부 수확 범위를 상세 상자로 좁힌다(머리글·바닥글 오염 방지 — 인천 비즈OK 갈래).
  attachmentsScopeSelector: "div.detPage",
  // 한 쪽 18줄(붙박이 8 + 일반 10)에서 거르개를 지나면 열 몇 건이 남는다. 5 미만이면 서식 변경.
  expectMinRows: 5,
  /**
   * selector(customParse) 가 실패해도 heuristic 추측 단계로 내려가지 않는다.
   * 목록 링크가 **전부 `href="#none"`** 이라, heuristic 을 그대로 태우면 18줄이 모두
   * `https://www.kicox.or.kr/#none` 한 주소로·등록일을 마감일로 저장된다(2026-09-03 고정본 실측,
   * 시험이 이 숫자를 잰다). 수출입은행에서 겪은 「틀린 저장은 다음 회차에도 안 지워진다」와 같은 갈래다.
   */
  skipHeuristic: true,
};
