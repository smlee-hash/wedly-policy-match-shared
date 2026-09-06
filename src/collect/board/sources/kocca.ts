import { parseHtml } from "../html";
import type { BoardConfig, BoardRow } from "../types";

/**
 * 한국콘텐츠진흥원 지원사업공고(알림마당 > 지원공고, menuNo=204104).
 *
 * 왜 연결했나(2026-09-03 실측): data.go.kr 「한국콘텐츠진흥원_지원사업공고」(publicDataPk=15134251)
 * 의 API 유형이 LINK 라 공용 게이트웨이가 아니라 기관 자체 게시판으로 안내한다.
 * OpenAPI(`kocca.kr/api/pims/List.do`)는 serviceKey 가 없으면 INFO-100 으로 거절된다.
 * HTML 목록 `pims/list.do?menuNo=204104` 는 키 없이 200.
 *
 * 구조: `div.board_list01 table tbody tr`. 제목 `td[data-label="제목"] a`,
 * 상세 `/kocca/pims/view.do?intcNo={ID}&menuNo=204104`.
 * 쪽넘김은 폼이 POST 지만 `?pageIndex=n` GET 도 그대로 먹는다(1쪽 5건 · 2쪽 0건 실측).
 * 한 쪽 10건. 진행중 탭은 실측 총 5건(2쪽 없음). 종료된사업(category=4)은 약 212쪽이라
 * 붙이면 끝난 글만 찬다 — **전체(진행중) 탭만** 본다. maxPages 15.
 *
 * 목록이 **접수기간을 시작·끝 둘 다** 준다(`26.08.31 ~ 26.09.21`, 두 자리 연도).
 * 공고일(`td[data-label="공고일"]`)은 별도 칸 — 접수기간 대신 집으면 시작이 하루 앞당겨진다
 * (실측 ATF: 공고 08.24 / 접수 08.25~09.08).
 *
 * ⚠️ 원문 href 는 `pageIndex`·`category`·`search` 를 달고 있다. 쪽 번호가 열쇠에 섞이면
 *    같은 글이 쪽마다 다른 줄로 저장된다 — intcNo+menuNo 만 남긴다.
 */
const BASE = "https://www.kocca.kr";
const LIST = "/kocca/pims/list.do";
const VIEW = "/kocca/pims/view.do";
const MENU = "204104";
const INTC = /[?&]intcNo=([A-Za-z0-9]+)/;

/**
 * 지원사업이 아닌 글. **버릴 것만** 지정한다.
 * 실측 진행중 5건은 전부 지원사업(DROP 후보 없음). 앞으로 섞일 입찰·설문·평가위원·합격자만 좁게.
 * ★`채용` 을 통째로 버리면 안 된다 — 고용보조금은 제목에 「채용」을 쓴다(bizbc).
 * ★`강사 Pool` 은 버리지 않는다 — 1쪽에 「게임인재원 AI 외래 강사 Pool 2차 모집」이 있다.
 */
const DROP =
  /입찰|설문|평가위원|합격자|(?:신규|경력|직원)\s*채용\s*(?:공고|안내)|채용\s*공고/;

/**
 * 붙박이 공지 중 **1년 넘게 붙어 있는 것은 버린다**(koreaexim 과 같은 갈래).
 * 실측 1쪽 5건은 전부 일반 행(붙박이 없음). 구분 「공지」이거나 tr.notice 이면 나이로 한 번 더 건다.
 */
const PINNED_MAX_AGE_MS = 365 * 24 * 3600_000;

export function isKoccaDropTitle(title: string): boolean {
  return DROP.test(title);
}

function ymdAll(text: string): string[] {
  const out: string[] = [];
  // /g 를 모듈 상수로 두면 lastIndex 가 칸마다 남아 다음 칸을 못 읽는다.
  const re = /(20\d{2}|\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})/g;
  for (const m of text.matchAll(re)) {
    const y = m[1].length === 2 ? `20${m[1]}` : m[1];
    out.push(`${y}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`);
  }
  return out;
}

function classList(el: { getAttribute: (n: string) => string | undefined }): string[] {
  return (el.getAttribute("class") ?? "").split(/\s+/);
}

export function parseKoccaList(html: string, _page = 1, now = Date.now()): BoardRow[] {
  const out: BoardRow[] = [];
  const seen = new Set<string>();
  for (const tr of parseHtml(html).querySelectorAll("div.board_list01 table tbody tr")) {
    const a = tr.querySelector('td[data-label="제목"] a');
    const href = (a?.getAttribute("href") ?? "").trim();
    const id = href.match(INTC)?.[1] ?? "";
    if (!id || seen.has(id)) continue;
    const title = (a?.text ?? "").replace(/\s+/g, " ").trim();
    if (!title || DROP.test(title)) continue;
    /**
     * 접수기간은 **`td[data-label="접수기간"]` 칸을 직접** 집는다.
     * ⚠️ 행 전체 글자(`tr.text`)에서 찾으면 안 된다 — 조회수 「971」 + 「26.08.31」이
     *    「97126.08.31」로 붙는다(hsbiz 실측 함정).
     * ⚠️ `td[data-label="공고일"]` 로 떨어지면 안 된다 — ATF 는 공고 08.24,
     *    접수는 08.25~09.08 이라 시작이 하루 앞당겨진다.
     */
    const term = (tr.querySelector('td[data-label="접수기간"]')?.text ?? "").replace(/\s+/g, " ").trim();
    const days = ymdAll(term);
    const dateText =
      days.length >= 2 ? `${days[0]} ~ ${days[1]}` : days.length === 1 ? `${days[0]} ~` : "";
    const kind = (tr.querySelector('td[data-label="구분"]')?.text ?? "").replace(/\s+/g, " ").trim();
    const pinned = classList(tr).includes("notice") || kind === "공지";
    const posted = ymdAll((tr.querySelector('td[data-label="공고일"]')?.text ?? "").replace(/\s+/g, " ").trim())[0] ?? "";
    if (pinned && posted && now - Date.parse(`${posted}T00:00:00Z`) > PINNED_MAX_AGE_MS) continue;
    seen.add(id);
    out.push({
      title,
      detailUrl: `${BASE}${VIEW}?intcNo=${id}&menuNo=${MENU}`,
      dateText: pinned ? "" : dateText,
      category: kind,
      agency: "한국콘텐츠진흥원",
    });
  }
  return out;
}

export const koccaConfig: BoardConfig = {
  id: "kocca",
  label: "한국콘텐츠진흥원 지원사업공고",
  agency: "한국콘텐츠진흥원",
  region: "전국",
  baseUrl: `${BASE}/`,
  charset: "utf-8",
  list: {
    url: (p) => `${BASE}${LIST}?menuNo=${MENU}&pageIndex=${p}`,
    maxPages: 15,
    rowSelector: "div.board_list01 table tbody tr",
    fields: {
      title: { selector: 'td[data-label="제목"] a' },
      detailUrl: { selector: 'td[data-label="제목"] a', attr: "href", regex: "intcNo=([A-Za-z0-9]+)" },
      date: { selector: 'td[data-label="접수기간"]' },
    },
  },
  customParse: parseKoccaList,
  /**
   * 상세 본문(`div.board_cont`)에 지원대상·신청자격·신청제한이 그대로 있다(실측 2026-09-03,
   * view.do?intcNo=326D00085009). 짧은 표지문이 아니라서 선택자를 적는다.
   *
   * 공고 파일은 `javascript:openNoticeFileList2` → pms.kocca.kr 팝업이라 HTML 링크가 없다.
   * 화면 하단 「정책자료.zip」(`/about/laws/rule/policy_data.zip`)은 사이트 공용이라
   * 상세 전체에서 수확하면 자격조건 추출이 오염된다. 본문 칸으로 범위를 좁힌다.
   */
  detailContentSelector: "div.board_cont",
  attachmentsScopeSelector: "div.board_cont",
  // 진행중 탭은 한 쪽이 10건이 안 될 수 있다(실측 5건). 0행이면 서식 변경.
  expectMinRows: 2,
};
