import { parseHtml } from "../html";
import type { BoardConfig, BoardRow } from "../types";

/**
 * 방위사업청 공지사항 (menuSeq=3031, bbsSeq=443).
 *
 * 왜 연결했나(2026-09-03 실측): 힌트 경로 `sub.do?menuId=756`(공모 안내)는 HTTP 404.
 * 실제 공지사항 판에 「26-2차 방산 중소수출길 지원사업」·「방위산업 계약학과 지원사업」이 올라온다.
 *
 * ★브라우저 User-Agent 가 없으면 WAF 가 HTTP 400(1414바이트)을 돌려준다.
 *   엔진이 이미 Chrome UA 를 붙인다. 쿠키 항아리는 호출마다 새로 만든다.
 *
 * 구조: `table.list-table tbody tr`. 제목이 `<a href="#none">` 라서
 * `onclick="fn_selectDoc('번호')"` 로 상세 주소를 손으로 조립한다.
 * 쪽넘김은 GET `currentPageNo=n`. 한 쪽 10건 · 전체 약 24쪽. 목록은 **등록일만**
 * 준다 — kbiz 와 같이 「등록일 ~」 개시형.
 *
 * ⚠️ 목록 행 `td.file` 에 `/jfile/board/readDownloadFile.do` 첨부 링크가 섞여 있다.
 *    heuristic 이 파일 링크를 공고로 저장하지 않게 `skipHeuristic` 을 켠다.
 */
const BASE = "https://www.dapa.go.kr";
const LIST = "/dapa/doc/selectDocList.do";
const VIEW = "/dapa/doc/selectDoc.do";
const MENU = "3031";
const BBS = "443";
const SN = /fn_selectDoc\(\s*'(\d+)'\s*\)/;
const YMD = /(20\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})/;
const YMD_CELL = /^20\d{2}-\d{2}-\d{2}$/;

/**
 * 지원사업이 아닌 글. **버릴 것만** 지정한다.
 * 실측 제목: 「입찰공고」·「합격자 발표」·「임기제공무원 채용」·「자체점검 결과」·「소장 모집」.
 * ★`채용` 을 통째로 버리면 안 된다 — 고용보조금은 제목에 「채용」을 쓴다(bizbc·cwip).
 *   기관이 사람을 뽑는 글(`채용 공고`·`소장 모집`·`임기제공무원`)만 좁힌다.
 */
const DROP =
  /입찰|설문|합격자|임기제공무원|자체점검|소장\s*모집|평가위원|(?:신규|경력|직원)\s*채용\s*(?:공고|안내)|채용\s*공고/;

/**
 * 붙박이 공지 중 **1년 넘게 붙어 있는 것은 버린다**(koreaexim 과 같은 갈래).
 * 붙박이는 날짜를 비워 저장하는데, 그러면 처음 본 날부터 90일 동안 「모집중」이 된다.
 */
const PINNED_MAX_AGE_MS = 365 * 24 * 3600_000;

export function isDapaDropTitle(title: string): boolean {
  return DROP.test(title);
}

/** 등록일은 **칸(td) 단위**로만 집는다. 행 전체 글자면 번호+날짜가 붙는다(hsbiz 함정). */
function dateCellText(tr: { querySelectorAll: (s: string) => { text: string }[] }): string {
  const tds = tr.querySelectorAll("td");
  // 칸 순서: 번호·분류·제목·첨부·작성자·게시일·조회수 — 6번째가 게시일(실측).
  const sixth = (tds[5]?.text ?? "").replace(/\s+/g, " ").trim();
  if (YMD_CELL.test(sixth)) return sixth;
  for (const td of tds) {
    const t = (td.text ?? "").replace(/\s+/g, " ").trim();
    if (YMD_CELL.test(t)) return t;
  }
  return "";
}

export function parseDapaList(html: string, _page = 1, now = Date.now()): BoardRow[] {
  const out: BoardRow[] = [];
  const seen = new Set<string>();
  for (const tr of parseHtml(html).querySelectorAll("table.list-table tbody tr")) {
    const a = tr.querySelector("td.subject a.subject-anchor");
    const seq = (a?.getAttribute("onclick") ?? "").match(SN)?.[1] ?? "";
    if (!seq || seen.has(seq)) continue;
    const title = (a?.querySelector("p.text")?.text ?? "").replace(/\s+/g, " ").trim();
    if (!title || DROP.test(title)) continue;
    const dateCell = dateCellText(tr);
    const d = dateCell.match(YMD);
    const ymd = d ? `${d[1]}-${d[2].padStart(2, "0")}-${d[3].padStart(2, "0")}` : "";
    const num = (tr.querySelector("td.num")?.text ?? "").replace(/\s+/g, " ").trim();
    const pinned = num.includes("공지");
    if (pinned && ymd && now - Date.parse(`${ymd}T00:00:00Z`) > PINNED_MAX_AGE_MS) continue;
    seen.add(seq);
    out.push({
      title,
      // ★쪽 번호(currentPageNo)를 넣으면 같은 글이 쪽마다 다른 줄로 저장된다.
      detailUrl: `${BASE}${VIEW}?docSeq=${seq}&menuSeq=${MENU}&bbsSeq=${BBS}`,
      dateText: pinned || !ymd ? "" : `${ymd} ~`,
      category: (tr.querySelector("span.cate")?.text ?? "").replace(/\s+/g, " ").trim(),
      agency: "방위사업청",
    });
  }
  return out;
}

export const dapaConfig: BoardConfig = {
  id: "dapa",
  label: "방위사업청 공지",
  agency: "방위사업청",
  region: "전국",
  baseUrl: `${BASE}/`,
  charset: "utf-8",
  list: {
    url: (p) => `${BASE}${LIST}?menuSeq=${MENU}&bbsSeq=${BBS}&currentPageNo=${p}`,
    maxPages: 8,
    rowSelector: "table.list-table tbody tr",
    fields: {
      title: { selector: "td.subject a.subject-anchor p.text" },
      detailUrl: {
        selector: "td.subject a.subject-anchor",
        attr: "onclick",
        regex: "fn_selectDoc\\(\\s*'(\\d+)'\\s*\\)",
      },
      date: { selector: "td:nth-child(6)" },
      category: { selector: "span.cate" },
    },
  },
  customParse: parseDapaList,
  /**
   * 상세 실측(`/dapa/doc/selectDoc.do?docSeq=58985&menuSeq=3031&bbsSeq=443`, 2026-09-03):
   * 본문 `div.view-cont`(공고 전문 + 신청기한), 첨부 `ul.view-file`(`readDownloadFile.do`).
   */
  detailContentSelector: "div.view-cont",
  attachmentsScopeSelector: "ul.view-file",
  // 한 쪽 10줄에서 거르개를 지나면 지원사업이 몇 건만 남는다. 0행이면 서식 변경.
  expectMinRows: 2,
  skipHeuristic: true,
};
