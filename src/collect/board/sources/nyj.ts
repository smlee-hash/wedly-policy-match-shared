import { parseHtml } from "../html";
import type { BoardConfig, BoardRow } from "../types";

/**
 * 남양주시청 일반지원사업(취업/경제 > 기업지원 > 정보마당).
 *
 * 왜 연결했나(2026-09-03 실측): 남양주 출자·출연기관(남양주도시공사 등)은 기업 대상
 * 지원사업 게시판이 없고, 실제 공고는 시청 자체 도메인(nyj.go.kr) 이 게시판에 올라온다.
 * 최신 10건은 경기도·중기부·콘텐츠진흥원·서울시 글을 옮겨 싣는 자리다.
 *
 * 구조: `table.p-table.simple > tbody.text_center > tr`. 제목은
 * `td.p-subject a[href*="selectBbsNttView.do"]`. 쪽넘김은 `?pageIndex=n` GET.
 * 한 쪽 10건 + 붙박이 2줄, 전체 약 14쪽. 목록은 **등록일만** 준다 — pipa 와 같이
 * 「등록일 ~」 개시형.
 *
 * ⚠️ href 에 `pageIndex` 가 붙어 있다. 주소가 곧 sourceId 라 쪽 번호를 빼지 않으면
 *    같은 글이 쪽마다 다른 줄로 저장된다.
 * ⚠️ **`tr.p-notice`(고정 공지)는 날짜를 비운다** — 실측 붙박이 G-FAIR 가
 *    `2026-03-16`(약 170일 전)이라 `PINNED_NOTICE` 예외에 못 걸려 **저장 즉시 마감**된다.
 * ★ 기관은 제목 앞 대괄호에서 뽑는다(`[경기도]`·`[남양주시 일자리지원과]`).
 *    「남양주시」로 못 박으면 중복 열쇠(제목|기관)가 달라져 기업마당의 같은 공고와 안 묶인다.
 *
 * 상세 본문 `div.contenttext`(실측 298자, 지원대상·모집기간 포함).
 * 첨부는 `div.attachedfile` 안 `downloadBbsFile.do`.
 */
const BASE = "https://www.nyj.go.kr/www";
const KEY = "3294";
const BBS = "80";
const NTT = /[?&]nttNo=(\d+)/;
const YMD = /(20\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})/;
const BRACKET = /^\[([^\]]+)\]/;

/**
 * 지원사업이 아닌 글. **버릴 것만** 지정한다.
 * 실측 제목: 「남양주시 공무원 사칭 및 공문서·명함 위조 사기 주의 알림」.
 * ★`채용` 을 통째로 버리면 안 된다 — 1쪽에 「채용박람회 참여기업 모집」이 있다.
 */
const DROP = /사칭|사기\s*주의|위조|입찰|설문|평가위원|합격자/;
const DROP_STAFF = /(?:신규|경력|직원)\s*채용\s*(?:공고|안내)|채용\s*공고/;

/**
 * 붙박이 공지 중 **1년 넘게 붙어 있는 것은 버린다**(적대 리뷰 지적).
 * 붙박이는 날짜를 비워 저장하는데, 그러면 처음 본 날부터 90일 동안 「모집중」이 된다.
 * 오래 붙어 있는 붙박이는 대개 자료·안내라 그렇게 되살리면 안 된다. 실측 붙박이가
 * `2025-07-02`(공무원 사칭 주의)이라 이 갈래에 걸린다.
 */
const PINNED_MAX_AGE_MS = 365 * 24 * 3600_000;

export function isNyjDropTitle(title: string): boolean {
  return DROP.test(title) || DROP_STAFF.test(title);
}

function agencyOf(title: string): string {
  const raw = title.match(BRACKET)?.[1]?.trim() ?? "";
  return raw || "남양주시";
}

export function parseNyjList(html: string, _page = 1, now = Date.now()): BoardRow[] {
  const out: BoardRow[] = [];
  const seen = new Set<string>();
  for (const tr of parseHtml(html).querySelectorAll("table.p-table.simple > tbody.text_center > tr")) {
    const a = tr.querySelector("td.p-subject a[href*='selectBbsNttView.do']") ?? tr.querySelector("td.p-subject a");
    const href = (a?.getAttribute("href") ?? "").trim();
    const nttNo = href.match(NTT)?.[1] ?? "";
    if (!nttNo || seen.has(nttNo)) continue;
    const title = (a?.text ?? "").replace(/\s+/g, " ").trim();
    if (!title || isNyjDropTitle(title)) continue;
    /**
     * 등록일은 **마지막 td(작성일) 칸을 직접** 집는다.
     * ⚠️ 행 전체 글자(`tr.text`)에서 찾으면 안 된다 — 번호 칸 「135」 + 「2026-08-26」이
     *    「1352026-08-26」으로 붙는다(hsbiz 실측 함정).
     */
    const tds = tr.querySelectorAll("td");
    const dateCell = (tds[tds.length - 1]?.text ?? "").replace(/\s+/g, " ").trim();
    const d = dateCell.match(YMD);
    const ymd = d ? `${d[1]}-${d[2].padStart(2, "0")}-${d[3].padStart(2, "0")}` : "";
    const pinned = (tr.getAttribute("class") ?? "").split(/\s+/).includes("p-notice");
    // 오래 붙어 있는 붙박이는 아예 안 담는다 — 날짜를 비우면 처음 본 날부터 90일간 되살아난다.
    if (pinned && ymd && now - Date.parse(`${ymd}T00:00:00Z`) > PINNED_MAX_AGE_MS) continue;
    seen.add(nttNo);
    out.push({
      title,
      // ★pageIndex·pageUnit·searchCnd 는 상세를 여는 데 필요 없다. pageIndex 는 쪽마다
      //   값이 바뀌므로 주소에 넣으면 **같은 공고가 두 줄로 저장된다**(주소가 곧 sourceId).
      detailUrl: `${BASE}/selectBbsNttView.do?key=${KEY}&bbsNo=${BBS}&nttNo=${nttNo}`,
      dateText: pinned || !ymd ? "" : `${ymd} ~`,
      category: "",
      agency: agencyOf(title),
    });
  }
  return out;
}

export const nyjConfig: BoardConfig = {
  id: "nyj",
  label: "남양주시 기업지원 공고",
  agency: "남양주시",
  region: "경기",
  baseUrl: `${BASE}/`,
  charset: "utf-8",
  list: {
    url: (p) => `${BASE}/selectBbsNttList.do?key=${KEY}&bbsNo=${BBS}&pageIndex=${p}`,
    maxPages: 10,
    rowSelector: "table.p-table.simple > tbody.text_center > tr",
    fields: {
      title: { selector: "td.p-subject a" },
      detailUrl: { selector: "td.p-subject a", attr: "href" },
      date: { selector: "td:last-child" },
    },
  },
  customParse: parseNyjList,
  detailContentSelector: "div.contenttext",
  attachmentsScopeSelector: "div.attachedfile",
  // 한 쪽 10건에서 거르개를 지나면 열 몇 건이 남는다. 0행이면 서식 변경.
  expectMinRows: 5,
  // 목록 행의 첨부 칸은 아이콘 span 뿐이라 heuristic 을 끄지 않는다.
};
