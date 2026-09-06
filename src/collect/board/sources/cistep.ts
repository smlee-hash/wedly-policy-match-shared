import { parseHtml, type HTMLElement } from "../html";
import type { BoardConfig, BoardRow } from "../types";

/**
 * 천안과학산업진흥원 공지사항.
 *
 * 왜 연결했나(2026-09-03 실측): 힌트 도메인 cstp.or.kr 은 호스트 자체가 없다(curl HTTP 000).
 * 실제 사이트는 www.cistep.re.kr. 「사업신청」 전용판(`/gnb01/lnb01/list.do`)은 최신 글이
 * 2025-05-30 이라 1년 넘게 멈춰 있고, 지원사업 모집은 **공지사항**에 섞여 올라온다.
 *
 * 구조: `table.list_1`. 제목 `td.subject a`, 상세 `/zboard/read.do?…&pd_pkid={ID}`.
 * 쪽넘김은 `?pageIndex=n` GET. 한 쪽 10건 · 전체 약 32쪽.
 * 목록은 **등록일만** 준다 — kbiz 와 같이 「등록일 ~」 개시형.
 *
 * ⚠️ 원문은 데이터 행의 여는 `<tr>` 을 생략하고 `</tr>` 만 닫는다(실측).
 *    `parseNoneClosedTags` 로도 `table.list_1 tr` 은 thead 1줄만 잡히고, 칸은 table
 *    직속 `td` 로 펼쳐진다. 그래서 제목 칸(`td.subject`)을 행으로 본다.
 */
const BASE = "https://www.cistep.re.kr";
const LIST = "/zboard/list.do";
const VIEW = "/zboard/read.do";
const PKID = /[?&]pd_pkid=(\d+)/;
const YMD = /(20\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})/;

/**
 * 지원사업이 아닌 글. **버릴 것만** 지정한다.
 * 실측 제목: 「평가위원 모집」·「제안서 평가 결과」·「평가위원 후보자」.
 * ★`평가` 를 통째로 버리면 안 된다 — 2쪽에 「기술이전·가치평가 지원사업」이 있다.
 * ★`채용` 을 통째로 버리면 안 된다 — 고용보조금은 제목에 「채용」을 쓴다(cwip).
 */
const DROP =
  /평가위원|평가\s*결과|제안서\s*평가|낙찰|계약\s*공개|입찰|설문|합격자|(?:신규|경력|직원)\s*채용\s*(?:공고|안내)|채용\s*공고/;

/**
 * 붙박이 공지 중 **1년 넘게 붙어 있는 것은 버린다**(koreaexim 과 같은 갈래).
 * 붙박이는 날짜를 비워 저장하는데, 그러면 처음 본 날부터 90일 동안 「모집중」이 된다.
 */
const PINNED_MAX_AGE_MS = 365 * 24 * 3600_000;

export function isCistepDropTitle(title: string): boolean {
  return DROP.test(title);
}

function classList(el: HTMLElement): string[] {
  return (el.getAttribute("class") ?? "").split(/\s+/);
}

/** 원문이 `<tr>` 을 안 열어 칸이 table 직속이므로, 제목 칸에서 옆 칸을 걷는다. */
function siblingTd(start: HTMLElement, cls: string, dir: 1 | -1): HTMLElement | null {
  const parent = start.parentNode as HTMLElement | undefined;
  if (!parent?.childNodes) return null;
  const kids = [...parent.childNodes].filter((n): n is HTMLElement =>
    Boolean((n as HTMLElement).tagName),
  );
  const i = kids.indexOf(start);
  if (i < 0) return null;
  for (let j = i + dir; j >= 0 && j < kids.length; j += dir) {
    const el = kids[j];
    const c = classList(el);
    if (c.includes(cls)) return el;
    if (c.includes("subject")) return null;
    if (dir === 1 && c.includes("num")) return null;
  }
  return null;
}

export function parseCistepList(html: string, _page = 1, now = Date.now()): BoardRow[] {
  const out: BoardRow[] = [];
  const seen = new Set<string>();
  for (const td of parseHtml(html).querySelectorAll("table.list_1 td.subject")) {
    const a = td.querySelector("a");
    const id = (a?.getAttribute("href") ?? "").match(PKID)?.[1] ?? "";
    if (!id || seen.has(id)) continue;
    const title = (a?.text ?? "").replace(/\s+/g, " ").trim();
    if (!title || DROP.test(title)) continue;
    /**
     * 등록일은 **`td.date` 칸을 직접** 집는다.
     * ⚠️ 행 전체 글자에서 찾으면 안 된다 — 번호 칸 「312」 + 「2026-08-19」가
     *    「3122026-08-19」로 붙는다(hsbiz 실측 함정). 이 게시판은 `<tr>` 이 없어
     *    제목 칸의 다음 형제에서 작성일 칸을 고른다.
     */
    const dateCell = (siblingTd(td, "date", 1)?.text ?? "").replace(/\s+/g, " ").trim();
    const d = dateCell.match(YMD);
    const ymd = d ? `${d[1]}-${d[2].padStart(2, "0")}-${d[3].padStart(2, "0")}` : "";
    const num = (siblingTd(td, "num", -1)?.text ?? "").replace(/\s+/g, " ").trim();
    const pinned = num.includes("공지");
    if (pinned && ymd && now - Date.parse(`${ymd}T00:00:00Z`) > PINNED_MAX_AGE_MS) continue;
    seen.add(id);
    out.push({
      title,
      // 원문 href 는 `pageIndex`·검색어를 달고 있다. 쪽 번호가 열쇠에 섞이면
      // 같은 글이 쪽마다 다른 줄로 저장된다 — lmCode+pd_pkid 만 남긴다.
      detailUrl: `${BASE}${VIEW}?lmCode=notice&pd_pkid=${id}`,
      dateText: pinned || !ymd ? "" : `${ymd} ~`,
      category: "",
      agency: "천안과학산업진흥원",
    });
  }
  return out;
}

export const cistepConfig: BoardConfig = {
  id: "cistep",
  label: "천안과학산업진흥원",
  agency: "천안과학산업진흥원",
  region: "충남",
  baseUrl: `${BASE}/`,
  charset: "utf-8",
  list: {
    url: (p) => `${BASE}${LIST}?lmCode=notice&pageIndex=${p}`,
    maxPages: 10,
    // 원문은 여는 <tr> 이 없어 tr 선택자는 thead 만 잡는다. customParse 가 제목 칸을 행으로 쓴다.
    rowSelector: "table.list_1 td.subject",
    fields: {
      title: { selector: "a" },
      detailUrl: { selector: "a", attr: "href", regex: "pd_pkid=(\\d+)" },
      date: { selector: "td.date" },
    },
  },
  customParse: parseCistepList,
  /**
   * 상세 실측(`/zboard/read.do?lmCode=notice&pd_pkid=14428`, 2026-09-03):
   * 본문 `td.bbs_detail`(공고 글 + 한글 편집기 상자), 첨부 `td.file`(`printFileDown.do`).
   */
  detailContentSelector: "td.bbs_detail",
  attachmentsScopeSelector: "td.file",
  // 한 쪽 10줄에서 거르개를 지나면 절반 근처가 남는다. 0행이면 서식 변경.
  expectMinRows: 5,
};
