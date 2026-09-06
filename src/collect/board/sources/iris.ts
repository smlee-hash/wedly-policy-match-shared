import { parseHtml } from "../html";
import type { BoardConfig, BoardRow } from "../types";

/**
 * IRIS 범부처통합연구지원시스템 — 사업공고 **접수중**(`ancmPrg=ancmIng`).
 *
 * 왜 연결했나(2026-09-06 실측): 범부처 국가R&D 공고의 **원본**이다. 전문기관 사이트들이
 * 여기를 거울로 쓴다 — 해양수산과기원(KIMST) 사업공고판 11행은 100% 이 사이트 상세로 직접
 * 링크하고, 국토교통과기원(KAIA) 자체 게시판의 「국토교통연구기획 사업 제2차 시행 재공고」가
 * 여기 검색(`bsnsTl=국토교통연구기획`, 140건)에 그대로 나온다. 한 곳을 붙이면 전문기관 여러 곳을 덮는다.
 * 목록·상세·첨부가 전부 쿠키 없는 GET 이고 robots 는 `/contents/` 를 막지 않는다(55줄 전부
 * `/wklounge/`·`/sysadmn/`).
 *
 * 구조: `ul.dbody > li` — 기관 `span.inst_title`(「해양수산부 > 해양수산과학기술진흥원」) ·
 * 제목 `strong.title > a`(href 는 빈 문자열, `onclick="f_bsnsAncmBtinSituListForm_view('023757','ancmIng')"`) ·
 * 공고일자 `span.ancmDe` · 공모유형 `span.pbofrTpSeNmLst`. 쪽넘김은 GET `pageIndex`, 한 쪽 10행.
 * 접수중은 전체 14건(1/2쪽) — `maxPages: 2` 면 다 담긴다.
 *
 * ★목록은 **접수기간을 안 준다**(공고일자만). 그래서 kodma·pipa 와 같이 「공고일자 ~」 개시형으로
 *  낸다. 접수기간(`2026-09-02 ~ 2026-09-09`)은 상세 라벨-값 표에만 있고, 상세 채움 단계는
 *  날짜를 고치지 않으므로 여기서 억지로 끌어오지 않는다.
 *
 * ★기관은 **행마다 다르다** — `span.inst_title` 의 「>」 뒤(전문기관)를 그 행의 기관으로 쓴다.
 *  부처(앞부분)를 쓰면 전 행이 「과학기술정보통신부」로 뭉쳐 `dedupKey`(제목+기관)가 전문기관
 *  사이트의 같은 공고와 갈린다 — 이 판을 붙이는 목적(거울 덮기)이 사라진다.
 */
const BASE = "https://www.iris.go.kr";
const LIST = "/contents/retrieveBsnsAncmBtinSituListView.do";
const VIEW = "/contents/retrieveBsnsAncmView.do";
/**
 * 읽을 탭 **둘**을 한 쪽씩 번갈아 돈다(aca 의 다중 목록 문법 — 1쪽=접수중 1쪽, 2쪽=접수예정 1쪽,
 * 3쪽=접수중 2쪽 …). 마감 탭은 안 읽는다.
 *
 * 왜 접수예정을 더했나(2026-09-06 실측): `ancmPre` 는 전체 5,534건 / 554쪽이고 1쪽 공고일자가
 * 2026-09-01 ~ 2026-02-19 로 최신순이다. **아직 접수가 시작되지 않은 공고**라 접수중 탭에는
 * 절대 안 나오는데, 기업이 미리 준비해야 하는 축이 여기 있다(예: 중소기업기술정보진흥원
 * 「중소제조 특화 Multi AI Agent 개발(R&D) 점프업 Track 시행계획 공고」).
 */
const TABS = ["ancmIng", "ancmPre"] as const;
/** 탭마다 몇 쪽까지 읽을지(상한 = TABS.length × 이 값). 접수중 전체가 14건/2쪽이라 2면 충분하다. */
const PAGES_PER_TAB = 2;
/**
 * 상세 주소에 박는 탭값 — **한 값으로 못 박는다.** 같은 공고가 접수예정 → 접수중으로 넘어갈 때
 * 주소가 갈리면 두 줄로 저장된다(주소가 곧 중복 판정 열쇠다). 2026-09-06 실측으로 접수예정
 * 공고(`ancmId=023978`)도 `ancmPrg=ancmIng` 로 200 + 같은 제목·첨부가 나온다.
 */
const PRG = "ancmIng";

/** 엔진 쪽 번호 → 「어느 탭의 몇 쪽」. 시험이 사상을 그대로 잴 수 있게 내보낸다. */
export function irisTargetOf(p: number): { prg: string; page: number } {
  const i = Math.max(1, Math.floor(p)) - 1;
  return { prg: TABS[i % TABS.length], page: Math.floor(i / TABS.length) + 1 };
}

/** 목록 한 쪽의 주소. */
export function irisListUrl(p: number): string {
  const t = irisTargetOf(p);
  return `${BASE}${LIST}?ancmPrg=${t.prg}&pageIndex=${t.page}`;
}
const GO = /f_bsnsAncmBtinSituListForm_view\(\s*'([^']+)'\s*,\s*'([^']*)'\s*\)/;
const YMD = /(20\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})/;

/**
 * 기업이 못 들어가는 공고. **버릴 것만** 지정한다 — 허용목록(KEEP)은 「~ 안내」형 지원사업을
 * 죽인다(hsbiz). 실측 60건(접수중 1쪽 · 마감 1~6쪽 2026-09-06)에서 고른 낱말만 쓴다.
 *
 * ㉠ 시험 글 — 운영자 시험 글이 실제로 올라와 있다: 마감 탭에 `test` ·
 *    `(TEST) KISTEP 통합공고 테스트 입니다.`, 접수예정 탭 1쪽에 `test` 2건 · `테스트` 1건
 *    (2026-09-06 실측). 그래서 **제목 전체가 시험 글자일 때만** 버린다 — 낱말 `테스트` 를
 *    통째로 버리면 「테스트베드 지원기업」 같은 진짜 공고가 함께 죽는다(적대 리뷰 지적).
 * ㉡ 대학·출연연·사람 대상 과제 — 「인재양성」(인공지능혁신인재양성) ·「인재유치」(최고급
 *    해외인재유치) ·「인적기반조성」(양자정보과학 인적기반조성) ·「대학원생」(한-캐나다 이공계
 *    대학원생 연수프로그램) ·「연수프로그램」·「연구생활장려금」·「참가자 모집」(HOPE Meeting)이
 *    실측 제목에 그대로 있다. 전부 주관이 대학·연구자다.
 *
 * ★2026-09-06 적대 리뷰로 **좁힌 것 둘**:
 *  · `대학` 통짜 → `대학원생|이공계\s*대학|대학\s*(?:연구자|교원)`. 통짜로 두면
 *    「지역앵커기업-지역대학 공동개발」·「창업중심대학 추천형 창업기업」처럼 **기업이 주관인**
 *    공고가 함께 죽는다.
 *  · `인력양성` 은 DROP 에서 뺐다 — 기업지원 프로그램 제목에도 쓰인다.
 *    (대가: 「에너지인력양성사업 …(에너지기술공유대학)」 같은 대학 대상 과제가 이제 통과한다.)
 *
 * ⚠️알려진 한계: 기업 참여 가능 여부의 진짜 근거는 공고문 안 「주관연구개발기관 자격」이고
 *  목록·상세 어디에도 그 칸이 없다(2026-09-06 조사). 제목 낱말은 근사치다.
 */
const DROP =
  /^\s*\(?TEST\)?\s*$|^\s*테스트\s*$|\(TEST\)|테스트\s*입니다|인재양성|인재유치|인적기반조성|대학원생|이공계\s*대학|대학\s*(?:연구자|교원)|학술|연수프로그램|연구생활장려금|참가자\s*모집/i;

export function isIrisDropTitle(title: string): boolean {
  return DROP.test(title);
}

/** `해양수산부 > 해양수산과학기술진흥원` → `해양수산과학기술진흥원`(전문기관). 「>」가 없으면 통째로. */
export function irisAgencyOf(instTitle: string): string {
  const t = instTitle.replace(/\s+/g, " ").trim();
  const i = t.lastIndexOf(">");
  return (i >= 0 ? t.slice(i + 1) : t).trim();
}

export function parseIrisList(html: string): BoardRow[] {
  const out: BoardRow[] = [];
  const seen = new Set<string>();
  for (const li of parseHtml(html).querySelectorAll("ul.dbody > li")) {
    const a = li.querySelector("strong.title > a");
    const m = (a?.getAttribute("onclick") ?? "").match(GO);
    const ancmId = m?.[1] ?? "";
    if (!ancmId || seen.has(ancmId)) continue;
    const title = (a?.text ?? "").replace(/\s+/g, " ").trim();
    if (!title || DROP.test(title)) continue;
    seen.add(ancmId);
    /**
     * 공고일자는 **`span.ancmDe` 칸을 직접** 집는다.
     * ⚠️ 행 전체 글자(`li.text`)로도 지금 고정본에서는 같은 값이 나온다(2026-09-06 확인) —
     *    하지만 한 행에 공고번호(「제2026-1283호」)·접수상태가 함께 실려 있어, 기관이 공고번호
     *    서식을 `제2026-08-31호` 꼴로 바꾸는 날 **날짜보다 먼저 걸린다.** 칸을 집으면 그 위험이 없다.
     */
    const dateCell = (li.querySelector("span.ancmDe")?.text ?? "").replace(/\s+/g, " ").trim();
    const d = dateCell.match(YMD);
    const ymd = d ? `${d[1]}-${d[2].padStart(2, "0")}-${d[3].padStart(2, "0")}` : "";
    const agency = irisAgencyOf(li.querySelector("span.inst_title")?.text ?? "");
    out.push({
      title,
      // 탭값은 목록에서 온 것을 쓰지 않고 이 수집기가 읽는 탭으로 못 박는다 — 같은 공고가
      // 탭만 다른 두 주소로 저장되면 중복이 된다(주소가 곧 중복 판정 열쇠다).
      detailUrl: `${BASE}${VIEW}?ancmId=${encodeURIComponent(ancmId)}&ancmPrg=${PRG}`,
      dateText: ymd ? `${ymd} ~` : "",
      category: (li.querySelector("span.pbofrTpSeNmLst")?.text ?? "")
        .replace(/공모유형\s*:/, "")
        .replace(/\s+/g, " ")
        .trim(),
      agency: agency || "범부처통합연구지원시스템",
    });
  }
  return out;
}

export const irisConfig: BoardConfig = {
  id: "iris",
  label: "IRIS 범부처통합연구지원시스템",
  agency: "범부처통합연구지원시스템",
  region: "전국",
  baseUrl: `${BASE}/`,
  charset: "utf-8",
  list: {
    url: irisListUrl,
    // 탭 2개 × 탭마다 2쪽 = 4. 접수중 전체가 14건(1/2쪽 · 2026-09-06 실측)이라 두 쪽이면 다 담긴다.
    maxPages: TABS.length * PAGES_PER_TAB,
    rowSelector: "ul.dbody > li",
    fields: {
      title: { selector: "strong.title > a" },
      detailUrl: {
        selector: "strong.title > a",
        attr: "onclick",
        regex: "f_bsnsAncmBtinSituListForm_view\\(\\s*'([^']+)'",
      },
      date: { selector: "span.ancmDe" },
    },
  },
  customParse: parseIrisList,
  /**
   * ★추측 단계를 끈다. 제목 링크가 전부 `href=""` 라 추측 단계가 `a[href]` 를 긁으면
   * 왼쪽 메뉴·검색 상자의 링크가 공고로 저장된다 — 그 줄은 다음 회차에 지워지지 않는다.
   */
  skipHeuristic: true,
  // 1쪽 10행에서 DROP 뒤 실측 9건. 서식이 바뀌면 여기서 끊긴다.
  expectMinRows: 5,
  /**
   * 탭을 한 쪽씩 번갈아 도니 「연속 N쪽 신규 0」 판정을 **한 바퀴 길이만큼** 올린다(aca 와 같은 이유).
   * 기본 2 로 두면 접수중 2쪽이 비는 순간 접수예정 2쪽을 통째로 잃는다.
   */
  emptyStreakStop: TABS.length,
  /**
   * ★상세 주소의 `ancmPrg` 를 엔진이 지우지 못하게 막는다.
   * 엔진은 `url(1)` 과 `url(2)` 에서 **값이 달라지는 변수**를 쪽 번호로 본다. 탭을 번갈아 도는
   * 이 사상에서는 1·2쪽 모두 `pageIndex=1` 이고 `ancmPrg` 만 갈리므로, 엔진이 `ancmPrg` 를
   * 쪽 변수로 짚어 상세 주소에서 지워 버린다(`pagingParamsOf` 실측). 파서는 탭과 무관하게
   * 한 값으로 못 박으므로 쪽마다 값이 갈릴 일이 없다 — 그래서 켜도 안전하다.
   */
  keepPagingParamsInDetail: true,
  detailContentSelector: "div.tstyle_view",
  /**
   * 첨부는 상세의 `div.add_file_list` 안에만 있다. 범위를 안 좁히면 「신청하기」 버튼 안
   * 로그인 링크(`/mbrs/entr/loginForm.do`)까지 훑게 된다.
   * ★`attachmentsScopeRequired` 는 켜지 않는다 — 첨부 없는 상세에도 이 상자가 있는지
   *  실물로 확인하지 못했다(고정본이 첨부 3건짜리 한 장뿐).
   */
  attachmentsScopeSelector: "div.add_file_list",
};
