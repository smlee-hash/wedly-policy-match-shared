import { parseHtml } from "../html";
import type { BoardConfig, BoardRow } from "../types";

/**
 * 순천시기업지원포털 「기업지원 공고」(`bbs_0000000000011603`).
 *
 * 왜 시청 주소인가(2026-09-06 실측): **순천시 산하 기업지원 기관이 없다.** 대표 누리집을
 * 훑어도 진흥원·재단이 없고, 창구는 시청이 직접 운영하는 「순천시기업지원포털」
 * (`suncheon.go.kr/biz`)이다. 그래서 출처 이름도 기관이 아니라 포털이다.
 *
 * 왜 연결했나: 이번 물결 다섯 곳 중 구조가 가장 좋다 — **목록에 접수기간이 그대로 있고**
 * (`td.date01` 「2026-07-03 ~ 2026-07-24」) 접수상태 배지(`span.state_ing`·`span.state_end`)도
 * 붙어 있어 상세를 열지 않고 마감을 잡는다. 게시판 전체가 기업 대상 지원사업이고 채용·입찰이
 * 안 섞인다. robots 도 `/biz/` 를 막지 않는다(막는 것은 `/cms`·`/vote` 로 시작하는 경로 둘뿐).
 *
 * ⚠️안고 가는 감점 둘(실측): ①최근 30일 신규 0건 — 마지막 일괄 등록이 2026-07-08 이다.
 *   ②일반행의 과반이 `[중소벤처기업부]`(= 이미 연결된 `mss`)·`[전남TP]`·`[전남도]` 재게시라
 *   기관이 다른 겹침은 저장 쪽 `dedupKey`(제목+기관)로 안 접힌다. 여기서는 못 푼다 —
 *   전남TP·전라남도중소기업일자리경제진흥원을 **각각 출처로 붙이는 편**이 근본 해법이다.
 *
 * 구조: `table.bbsList tbody tr`(실측 22행 = 붙박이 공지 7 + 일반 15). 칸 5개
 * 「번호 / 분야 / 지원사업명 / 접수기간 / 등록일」. 제목 `td.subject a` 안에 상태 배지와
 * 「온라인」 꼬리표(`span.ext01`)가 섞여 들어오므로 **떼어 내고** 담는다. 쪽 변수 `pageIdx`.
 */
const BASE = "https://www.suncheon.go.kr";
const LIST_PATH = "/biz/0001/0001/";
const REGION = "전남";
const ROW = "table.bbsList tbody tr";
const CNT_ID = /[?&]cntId=(\d+)/;
const YMD = /(20\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})/g;
/** 제목 앞머리의 대괄호 기관명(`[중소벤처기업부]…`·`[전남TP]…`). */
const AGENCY_PREFIX = /^\s*[[［【]\s*([^\]］】]{1,40})\s*[\]］】]/;

/**
 * 이 줄의 지역. **남의 공고를 옮겨 실은 줄은 지역을 비운다**(2026-09-06 적대 리뷰).
 *
 * 왜: 이 게시판은 1쪽 과반이 `[중소벤처기업부]`·`[전남TP]`·`[전라남도]` 머리표를 단 재게시다.
 * 그 줄에 「전남」을 박으면 **전국 사업이 전남 기업에게만 추천되고** 다른 지역 기업은 놓친다.
 * 반대로 머리표가 없거나 `[순천시]` 면 순천시 자체 시책이라 「전남」 그대로 둔다.
 */
export function suncheonRegionOf(title: string): string {
  const owner = title.match(AGENCY_PREFIX)?.[1];
  if (!owner) return REGION;
  return owner.includes("순천") ? REGION : "";
}

/**
 * 지원사업이 아닌 글. **버릴 것만** 좁게 지정한다 — 이 판은 성격 거르개가 거의 필요 없다.
 * 실측 22행에서 걸리는 것 하나: 「재직자대상 AI 업무혁신 실무 무료교육 참여 안내」.
 * ★`교육` 을 통째로 버리지 않는다 — 교육비를 대 주는 지원사업이 제목에 「교육」을 쓴다.
 */
const DROP =
  /무료\s*교육|수강생\s*모집|교육생\s*모집|설문\s*조사|입찰\s*공고|낙찰|평가위원|선정\s*결과|결과\s*발표|합격자|(?:신규|경력|직원)\s*채용\s*(?:공고|안내)/;

/** 시험이 제목 글자만으로 거르개를 잴 수 있게 내보낸다. */
export function isSuncheonDropTitle(title: string): boolean {
  return DROP.test(title);
}

/**
 * 상세 주소에서 쪽 변수(`pageIdx`)만 지운다.
 *
 * 왜: 목록이 주는 href 는 `?boardId=…&mode=view&cntId=236&category=…&pageIdx=` 인데
 * `pageIdx` 값이 **쪽마다 달라져** 그대로 두면 같은 공고가 쪽 수만큼 다른 줄로 저장된다
 * (주소가 곧 중복 판정 열쇠 `sourceId`). `category` 는 공고마다 고정이라 남긴다 —
 * 서버가 그 인자를 요구하는지 실물로 확인하지 못해 **빼지 않는다**(빼서 404 가 되면 본문이 영영 빈다).
 */
export function suncheonDetailUrl(href: string): string {
  try {
    const u = new URL(href.replace(/&amp;/g, "&"), `${BASE}${LIST_PATH}`);
    u.searchParams.delete("pageIdx");
    return u.toString();
  } catch {
    return "";
  }
}

export function parseSuncheonList(html: string, _page = 1): BoardRow[] {
  const out: BoardRow[] = [];
  const seen = new Set<string>();
  for (const tr of parseHtml(html).querySelectorAll(ROW)) {
    const a = tr.querySelector("td.subject a");
    const href = a?.getAttribute("href") ?? "";
    const id = href.match(CNT_ID)?.[1] ?? "";
    if (!id || seen.has(id)) continue;
    /**
     * ★제목에서 **배지와 꼬리표를 뗀다.** `td.subject a` 의 글자에는 상태 배지
     * (`접수중`·`접수종료`)와 온라인신청 표시(`온라인`)가 붙어 온다 — 그대로 담으면
     * 접수 상태가 바뀔 때마다 제목이 달라져 같은 공고가 새 줄이 되고, 중복 판정
     * (제목+기관)이 다른 출처의 같은 공고와도 안 붙는다.
     */
    const state = (tr.querySelector("span.state_ing, span.state_end")?.text ?? "")
      .replace(/\s+/g, " ")
      .trim();
    const ext = (tr.querySelector("span.ext01")?.text ?? "").replace(/\s+/g, " ").trim();
    let title = (a?.text ?? "").replace(/\s+/g, " ").trim();
    if (state && title.startsWith(state)) title = title.slice(state.length).trim();
    if (ext && title.endsWith(ext)) title = title.slice(0, title.length - ext.length).trim();
    if (!title || DROP.test(title)) continue;
    seen.add(id);
    /**
     * 접수기간은 **`td.date01` 칸을 직접** 집는다(칸 사이 `&nbsp;` 포함).
     * ⚠️행 전체 글자에서 찾으면 번호(228)·등록일이 뒤섞인다(hsbiz 실측 함정).
     */
    const term = (tr.querySelector("td.date01")?.text ?? "").replace(/\s+/g, " ").trim();
    const days = [...term.matchAll(YMD)].map(
      (m) => `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`,
    );
    const dateText =
      days.length >= 2 ? `${days[0]} ~ ${days[1]}` : days.length === 1 ? `${days[0]} ~` : "";
    const category = (tr.querySelector("td.category")?.text ?? "").replace(/\s+/g, " ").trim();
    const detailUrl = suncheonDetailUrl(href);
    if (!detailUrl) continue;
    out.push({
      title,
      detailUrl,
      dateText,
      // 접수상태는 분류 옆에만 남긴다 — 닫힘 판정은 접수기간 마감일이 한다(aca 와 같은 규칙).
      category: state ? `${category} · ${state}` : category,
      agency: "순천시",
      // 재게시(남의 공고)는 지역을 비운다 — 위 `suncheonRegionOf` 주석.
      region: suncheonRegionOf(title),
    });
  }
  return out;
}

export const suncheonConfig: BoardConfig = {
  id: "suncheon",
  label: "순천시기업지원포털",
  agency: "순천시",
  region: REGION,
  // 상세 href 가 `?boardId=…` 꼴의 **질의만 있는 상대주소**라 목록 폴더를 기준 주소로 둔다.
  baseUrl: `${BASE}${LIST_PATH}`,
  charset: "utf-8",
  list: {
    url: (p) => `${BASE}${LIST_PATH}?pageIdx=${p}`,
    // 총 16쪽이지만 최근 30일 신규 0건짜리 판이다 — 앞 3쪽이면 2년치를 덮는다.
    maxPages: 3,
    rowSelector: ROW,
    fields: {
      title: { selector: "td.subject a" },
      detailUrl: { selector: "td.subject a", attr: "href" },
      date: { selector: "td.date01" },
      category: { selector: "td.category" },
    },
  },
  customParse: parseSuncheonList,
  /**
   * 상세 실측(cntId=236): 본문 `table.bbsView td.content`, 첨부 상자 `td.leftth div.board`.
   * ★첨부 주소는 `href="javascript:Jnit_boardDownload('<주소>',…)"` 안에 있고 `;jsessionid=…` 가
   *   박혀 온다. 수확기(`detail-fill.ts`)의 **P2 w5 갈래**(`www.suncheon.go.kr` 한정)가 첫 인자를
   *   꺼내고 세션 조각을 지운다. 그 갈래가 없으면 첨부 0건이다.
   * 첨부는 세션·Referer 없이 200 + `Content-Disposition: attachment` 로 받힌다(실측).
   */
  detailContentSelector: "table.bbsView td.content",
  attachmentsScopeSelector: "td.leftth div.board",
  /**
   * ★추측 단계를 끈다. 상세 링크가 전부 `?boardId=…` 꼴 상대주소라 추측 단계가 좌측 메뉴·
   * 바닥글 링크를 공고로 저장하기 쉽고, 그 줄은 다음 회차에 지워지지 않는다.
   */
  skipHeuristic: true,
  // 1쪽 22행에서 DROP 1건(무료교육)을 뺀 실측 21건. 절반을 하한으로.
  expectMinRows: 10,
  // 2026-09-06 실측: 미국(Railway) 차단·서울 경유 200 — 국내 경유 전용
  requiresProxy: true,
};
