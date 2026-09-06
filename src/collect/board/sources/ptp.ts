import { parseHtml } from "../html";
import type { BoardConfig, BoardRow } from "../types";

/**
 * 포항테크노파크 사업공고.
 *
 * 게시판: `https://ptp.or.kr/main/board/index.do?menu_idx=116&manage_idx=15`
 * (실측 2026-09-03 HTTP 200 · charset utf-8 · 브라우저 UA 위장 불필요 — 엔진이 이미 UA 를 붙인다).
 * 입찰정보(114)·채용정보(115) 는 별도 게시판이라 여기 목록은 지원사업 전용 성격이다.
 *
 * 구조: `div.board-list > table.table.text-sm > tbody > tr[title]`.
 * 제목이 `<a href>` 가 아니라 `<a onclick="viewBoard({ID})">` 라서 상세 주소를 손으로 조립한다
 * (`href` 는 `javascript:void(0)`). 쪽넘김은 GET `viewPage=n`. 한 쪽 일반 10건 + 붙박이
 * (실측 1쪽 붙박이 17 + 일반 10, 붙박이는 모든 쪽에 반복). 전체 약 149쪽.
 * **접수기간을 목록에서 시작·끝 둘 다 준다** (`YYYY-MM-DD HH시 ~ YYYY-MM-DD HH시`, 5번째 td).
 *
 * 상세 본문·첨부 선택자는 실측 상세(`view.do?board_idx=8107`, 594KB)에서 확인.
 */
const BASE = "https://ptp.or.kr";
const LIST = "/main/board/index.do";
const VIEW = "/main/board/view.do";
const MENU = "116";
const MANAGE = "15";
const ROW = "div.board-list > table.table.text-sm > tbody > tr[title]";
const ID = /viewBoard\(\s*(\d+)\s*\)/;
const YMD = /(20\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})/g;

/**
 * 지원사업이 아닌 글. **버릴 것만** 지정한다.
 * 실측 DROP: 평가위원(후보자) · 외부전문가 · 강사 모집.
 * ★`채용` 을 통째로 버리면 안 된다 — 고용보조금은 제목에 「채용」을 쓴다(bizbc.ts 주석).
 * ★`전문가` 를 통째로 버리면 「전문가 자문 프로그램」 참여기업 모집이 죽는다.
 */
const DROP = /입찰|설문|합격자|평가위원|외부전문가|강사\s*모집/;
const DROP_STAFF = /(?:신규|경력|직원)\s*채용\s*(?:공고|안내)|채용\s*공고/;

/** 시험이 제목 글자만으로 거르개를 잴 수 있게 내보낸다. */
export function isPtpDropTitle(title: string): boolean {
  return DROP.test(title) || DROP_STAFF.test(title);
}

/**
 * 붙박이 공지 중 **1년 넘게 붙어 있는 것은 버린다**(koreaexim.ts 방식).
 * 나이는 작성일(`td.date`)로 잰다 — 접수기간만 있는 붙박이는 시작일이 비어 나이를 못 본다.
 */
const PINNED_MAX_AGE_MS = 365 * 24 * 3600_000;

function ymdList(chunk: string): string[] {
  return [...chunk.matchAll(YMD)].map((m) => `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`);
}

/**
 * 접수기간 칸만. 「시작 ~ 끝」 / 「시작 ~」 / 「~ 끝」.
 * ⚠️ 행 전체 글자(`tr.text`)에서 찾으면 안 된다 — 칸이 띄어쓰기 없이 이어 붙어
 * 조회수 + 작성일이 「612026.09.02」가 되고 `\b` 경계가 깨진다(hsbiz 실측 함정).
 */
function applyPeriodOf(cell: string): string {
  const period = cell.replace(/\s+/g, " ").trim();
  const days = ymdList(period);
  if (days.length >= 2) return `${days[0]} ~ ${days[1]}`;
  if (days.length === 1) {
    const first = period.match(/(20\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
    const before = period.slice(0, first?.index ?? 0).replace(/\s+/g, "");
    if (before.endsWith("~")) return days[0];
    return `${days[0]} ~`;
  }
  return "";
}

export function parsePtpList(html: string, _page = 1, now = Date.now()): BoardRow[] {
  const out: BoardRow[] = [];
  const seen = new Set<string>();
  for (const tr of parseHtml(html).querySelectorAll(ROW)) {
    const a = tr.querySelector("td.subject a");
    const id = (a?.getAttribute("onclick") ?? "").match(ID)?.[1] ?? "";
    if (!id || seen.has(id)) continue;
    const title = (a?.querySelector("span")?.text ?? "").replace(/\s+/g, " ").trim();
    if (!title || isPtpDropTitle(title)) continue;
    /**
     * 접수기간은 **5번째 td**(번호|부서|제목|상태|접수기간|파일|작성일|조회)를 직접 집는다.
     * 작성일 `td.date` 로 떨어지면 안 된다 — 첫 행은 접수 2026-09-03~09-18, 작성일 2026.09.02.
     */
    const tds = tr.querySelectorAll("td");
    const dateText = applyPeriodOf(tds[4]?.text ?? "");
    const registered = ymdList((tr.querySelector("td.date")?.text ?? "").replace(/\s+/g, " ").trim())[0] ?? "";
    const pinned = !!(tr.querySelector("span.ico-notice") || /공지/.test((tds[0]?.text ?? "").replace(/\s+/g, " ")));
    if (pinned && registered && now - Date.parse(`${registered}T00:00:00Z`) > PINNED_MAX_AGE_MS) {
      seen.add(id);
      continue;
    }
    seen.add(id);
    out.push({
      title,
      // ★viewPage 를 넣으면 같은 글이 쪽마다 다른 sourceId 가 된다.
      detailUrl: `${BASE}${VIEW}?menu_idx=${MENU}&manage_idx=${MANAGE}&board_idx=${id}`,
      dateText,
      category: (tr.querySelector("td.point-blue")?.text ?? "").replace(/\s+/g, " ").trim(),
      agency: "포항테크노파크",
    });
  }
  return out;
}

export const ptpConfig: BoardConfig = {
  id: "ptp",
  label: "포항테크노파크",
  agency: "포항테크노파크",
  region: "경북",
  baseUrl: `${BASE}/`,
  charset: "utf-8",
  list: {
    url: (p) => `${BASE}${LIST}?menu_idx=${MENU}&manage_idx=${MANAGE}&viewPage=${p}`,
    maxPages: 10,
    rowSelector: ROW,
    fields: {
      title: { selector: "td.subject a span" },
      detailUrl: {
        selector: "td.subject a",
        attr: "onclick",
        regex: "viewBoard\\(\\s*(\\d+)\\s*\\)",
      },
      date: { selector: "td:nth-child(5)" },
      category: { selector: "td.point-blue" },
    },
  },
  customParse: (html, page) => parsePtpList(html, page),
  // 실측 상세 board_idx=8107: 본문 칸 `div.view-cont-biz`(사업명·접수기간·접수방법 dl),
  // 첨부 링크는 `div.board-view-attach` 안 `/board/boardFile/download/…`.
  detailContentSelector: "div.view-cont-biz",
  attachmentsScopeSelector: "div.board-view-attach",
  // 한 쪽 일반 10건의 절반. 0행이면 서식 변경.
  expectMinRows: 5,
};
