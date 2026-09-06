import { parseHtml } from "../html";
import type { BoardConfig, BoardRow } from "../types";

/**
 * 한국에너지기술평가원 사업공고(공지·공시 > 사업공고).
 *
 * 구조: `table.tstyle_list tbody tr`. 제목은 `td.txt_left a`(글자가 `<strong>` 안),
 * 상세는 `/businessAcment/view?...&uni_ancm_id={id}`.
 * 쪽넘김은 `?pageNum=n`(+ `rowCnt=10`) GET. 한 쪽 10건 · 전체 50쪽 499건(2026-09-03 실측).
 * 목록은 **등록일만** 준다(`td[aria-label='등록일']` 「2026-09-01」) — geri·kbiz 와 같이
 * 「등록일 ~」 개시형. 접수기간(「2026-09-01 ~ 2026-10-01」)은 **상세에만** 있다.
 *
 * ★열쇠 모양이 두 가지다 — `D`+9자리(D202610539, 상세정보 칸 「과제」)와 순수 숫자(10262,
 *   상세정보 칸 「수요」= 기술수요조사 계열). 둘 다 같은 상세 화면이라 한 규칙으로 읽는다.
 *
 * ★목록이 준 href 에는 **자기가 보던 쪽 번호(`pageNum`)와 `rowCnt`** 가 붙어 있다. 그대로 쓰면
 *   같은 공고가 쪽마다 다른 줄로 저장된다(상세 주소가 곧 중복 판정 열쇠 sourceId) — 그래서
 *   href 를 쓰지 않고 `uni_ancm_id` 만 뽑아 주소를 손으로 조립한다.
 *   `menuId` 만 남긴 짧은 주소도 같은 본문을 준다(실측 HTTP 200 · 339,729B, href 전체와 동일).
 *
 * ★브라우저 UA 위장은 불필요하다(실측: UA·쿠키 없는 curl 도 HTTP 200/같은 바이트).
 *
 * ★붙박이 공지는 지금 하나도 없다(실측 499줄 전부 번호 1~499). 그래도 생겼을 때를 대비해
 *   번호 칸이 숫자가 아닌 행은 붙박이로 보고, 1년 넘은 것은 담지 않는다(koreaexim·geri 방식).
 */
const BASE = "https://www.ketep.re.kr";
const LIST = "/businessAcment";
const VIEW = "/businessAcment/view";
const MENU = "MENU002080200000000";
const AGENCY = "한국에너지기술평가원";
const ROW = "table.tstyle_list tbody tr";
const CONTENTS = "article.board_view div.contents";
const ID = /[?&]uni_ancm_id=([A-Za-z0-9_-]+)/;
const YMD = /(20\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})/;

/**
 * 지원사업이 아닌 글. **버릴 것만** 좁게 지정한다.
 * 실측(2026-09-03, 전체 499줄 훑기): 이 게시판은 거의 전량이 사업공고·기술수요조사이고
 * 사람을 뽑는 글만 몇 건 있다 — 「국제에너지기구(IEA) 기술협력 활동전문가 모집 공모」·
 * 「다자협력활동 전문가 공모」. 입찰·설문조사·평가위원·합격자 행은 0건이지만, 다른 기관 게시판에서
 * 흔한 갈래라 함께 막아 둔다.
 * ★`공모` 를 통째로 버리면 안 된다 — 이 게시판의 「지정공모형 재공고」가 죽는다.
 * ★`채용` 도 통째로 버리면 안 된다 — 고용보조금은 제목에 「채용」을 쓴다(bizbc 주석).
 * ★`수요조사` 는 버리지 않는다 — 신규 사업 기획 단계 공고라 기업이 제안할 자리다.
 */
const DROP = /입찰|설문\s*조사|평가위원|심사위원|합격자|활동\s*전문가|채용\s*공고/;

export function isKetepDropTitle(title: string): boolean {
  return DROP.test(title);
}

/** 붙박이 공지가 1년 넘게 붙어 있으면 담지 않는다(날짜를 비우면 처음 본 날부터 90일 모집중이 된다). */
const PINNED_MAX_AGE_MS = 365 * 24 * 3600_000;

export function parseKetepList(html: string, _page = 1, now = Date.now()): BoardRow[] {
  const out: BoardRow[] = [];
  const seen = new Set<string>();
  for (const tr of parseHtml(html).querySelectorAll(ROW)) {
    const a = tr.querySelector("td.txt_left a");
    const id = (a?.getAttribute("href") ?? "").match(ID)?.[1] ?? "";
    if (!id || seen.has(id)) continue;
    const title = (a?.text ?? "").replace(/\s+/g, " ").trim();
    if (!title || DROP.test(title)) continue;
    /**
     * 등록일은 **`td[aria-label='등록일']` 칸을 직접** 집는다.
     * ⚠️ 행 전체 글자(`tr.text`)에서 찾으면 안 된다 — 번호 칸 「499」 + 「2026-09-01」이
     *    「4992026-09-01」로 붙는다(hsbiz 실측 함정).
     */
    const dateCell = (tr.querySelector("td[aria-label='등록일']")?.text ?? "").replace(/\s+/g, " ").trim();
    const d = dateCell.match(YMD);
    const ymd = d ? `${d[1]}-${d[2].padStart(2, "0")}-${d[3].padStart(2, "0")}` : "";
    const num = (tr.querySelector("td[aria-label='번호']")?.text ?? "").replace(/\s+/g, " ").trim();
    const pinned = num !== "" && !/^\d+$/.test(num);
    if (pinned && ymd && now - Date.parse(`${ymd}T00:00:00Z`) > PINNED_MAX_AGE_MS) continue;
    seen.add(id);
    out.push({
      title,
      detailUrl: `${BASE}${VIEW}?menuId=${MENU}&uni_ancm_id=${id}`,
      dateText: pinned || !ymd ? "" : `${ymd} ~`,
      // 상세정보 칸 「과제」(신규지원 대상과제 공고) / 「수요」(기술수요조사) — 사람이 갈래를 가르는 데 쓴다.
      category: (tr.querySelector("td[aria-label='상세정보']")?.text ?? "").replace(/\s+/g, " ").trim(),
      agency: AGENCY,
    });
  }
  return out;
}

export const ketepConfig: BoardConfig = {
  id: "ketep",
  label: "한국에너지기술평가원",
  agency: AGENCY,
  region: "전국",
  baseUrl: `${BASE}/`,
  charset: "utf-8",
  list: {
    // rowCnt 를 10으로 못 박는다 — 안 주면 상대가 기본값을 바꿀 때 쪽마다 건수가 흔들린다.
    url: (p) => `${BASE}${LIST}?menuId=${MENU}&pageNum=${p}&rowCnt=10`,
    // 10건 × 8쪽 = 80건(실측으로 2024-05 까지). 오래된 줄은 저장 단계가 알아서 닫는다.
    maxPages: 8,
    rowSelector: ROW,
    fields: {
      title: { selector: "td.txt_left a" },
      detailUrl: { selector: "td.txt_left a", attr: "href" },
      date: { selector: "td[aria-label='등록일']" },
      category: { selector: "td[aria-label='상세정보']" },
    },
  },
  customParse: parseKetepList,
  /**
   * ★여기는 kbiz·geri 와 달리 **본문을 적는다.** 상세 `div.contents` 가 공고문 전문이라
   * 실측 2,000~33,027자(과제 공고 32,680자·수요조사 2,000자)로 접수기간·신청방법·제출서류가
   * 다 들어 있다. 「표지문 몇 줄」이라 첨부 길을 열어 둬야 하는 갈래가 아니다.
   * 첨부(.hwp·.pdf·.zip)는 전부 같은 상자 안에 있어(실측 7/7) 범위를 그쪽으로 못 박는다 —
   * 상자를 안 정하면 사이트 공통 머리·바닥글의 파일까지 공고 첨부로 딸려 온다.
   */
  detailContentSelector: CONTENTS,
  attachmentsScopeSelector: CONTENTS,
  // 한 쪽 10건, 버릴 행이 거의 없다. 절반인 5보다 낮춰 잡지 않는다 — 0행이면 서식 변경.
  expectMinRows: 5,
  /**
   * `skipHeuristic` 은 **켜지 않는다.** 목록 행에 첨부 파일 링크가 없고(바로가기 칸은 iris.go.kr
   * 같은 바깥 사이트 링크라 호스트 검문에서 걸러진다), 실제로 heuristic 을 돌려 보면 10줄을
   * 그대로 읽는다(2026-09-03 실측) — 구조가 바뀌었을 때 마지막 방어선으로 쓸 만하다.
   */
};
