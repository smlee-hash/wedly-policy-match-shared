import { parseHtml } from "../html";
import type { BoardConfig, BoardRow } from "../types";

/**
 * 파주시 기업지원 사업공고(시청 기업지원과 직영, bbsCd=9052).
 *
 * 왜 연결했나(2026-09-03 실측): 「파주시 출자·출연기관」으로 별도 법인을 찾았으나
 * 파주도시관광공사·파주시시설관리공단뿐이고 둘 다 기업지원과 무관하다.
 * 「파주경제진흥원」류는 없다. 대신 시청 기업지원과가 이 게시판을 직영한다.
 *
 * 구조: 표 `table tbody tr`(한 쪽 10건, 서버 렌더). 제목 앵커 href 는
 * `javascript:void(0)` 뿐이라 못 쓰고, `onclick="jsView('9052','{seq}','N','Y')"` 에서
 * seq 를 뽑아 상세 주소를 조립한다. 쪽넘김은 `?q_currPage=n` GET(1부터, 기본 10건/쪽, 약 25쪽).
 * 목록은 **등록일만** 준다 — 「등록일 ~」 개시형.
 *
 * 상세 본문·첨부 선택자는 실측 상세(`seq=20260821174932745`)에서 확인.
 * 본문 칸 클래스 `article-conetnt` 는 사이트 원문 오타 그대로다.
 */
const BASE = "https://www.paju.go.kr";
const LIST = "/user/board/BD_board.list.do";
const VIEW = "/user/board/BD_board.view.do";
const BBS = "9052";
const SN = /jsView\('9052',\s*'([0-9]+)'/;
const YMD = /(20\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})/;

/**
 * 지원사업이 아닌 글. **버릴 것만** 지정한다.
 * 실측 1·2쪽 20건은 전부 기업지원 공고라 DROP 후보가 없었다.
 * ★`채용` 을 통째로 버리면 안 된다(적대 리뷰 중요) — 고용보조금은 제목에 「채용」을 쓴다.
 *   기관이 사람을 뽑는 글(`직원 채용`·`채용 공고`)만 좁게 버리고 `채용 지원`은 살린다.
 */
const DROP = /입찰|설문|합격자|평가위원|(?:신규|경력|직원)\s*채용\s*(?:공고|안내)|채용\s*공고/;

export function isPajuDropTitle(title: string): boolean {
  return DROP.test(title);
}

/**
 * 붙박이 공지 중 **1년 넘게 붙어 있는 것은 버린다**(koreaexim 방식).
 * 붙박이는 날짜를 비워 저장하는데, 그러면 처음 본 날부터 90일간 「모집중」이 된다.
 * 이 게시판 고정본의 공지 칸은 비어 있으나, 번호 칸이 「공지」이면 같은 규칙으로 건넌다.
 */
const PINNED_MAX_AGE_MS = 365 * 24 * 3600_000;

export function parsePajuList(html: string, _page = 1, now = Date.now()): BoardRow[] {
  const out: BoardRow[] = [];
  const seen = new Set<string>();
  for (const tr of parseHtml(html).querySelectorAll("table tbody tr")) {
    const a = tr.querySelector("td.cell-subject a.ellipsis_b") ?? tr.querySelector("td.cell-subject a");
    const seq = (a?.getAttribute("onclick") ?? "").match(SN)?.[1] ?? "";
    if (!seq || seen.has(seq)) continue;
    const title = (a?.text ?? "").replace(/\s+/g, " ").trim();
    if (!title || DROP.test(title)) continue;
    /**
     * 등록일은 **칸 순번**으로 집는다(thead: 번호/제목/등록자명/등록일/조회수/부서명 → 4번째 td).
     * `td.cell-default` 가 4칸이라 클래스로는 못 가른다.
     * ⚠️ 행 전체 글자(`tr.text`)에서 찾으면 안 된다 — 칸이 띄어쓰기 없이 이어 붙어
     * 조회수 + 날짜가 「4552026/08/21」이 되고 `\b` 경계가 깨진다(hsbiz 실측 함정).
     */
    const tds = tr.querySelectorAll("td");
    const dateCell = (tds[3]?.text ?? "").replace(/\s+/g, " ").trim();
    const d = dateCell.match(YMD);
    const ymd = d ? `${d[1]}-${d[2].padStart(2, "0")}-${d[3].padStart(2, "0")}` : "";
    const noCell = (tds[0]?.text ?? "").replace(/\s+/g, " ").trim();
    const pinned = /공지/.test(noCell);
    if (pinned && ymd && now - Date.parse(`${ymd}T00:00:00Z`) > PINNED_MAX_AGE_MS) continue;
    seen.add(seq);
    out.push({
      title,
      // ★쪽 번호(q_currPage)를 넣으면 같은 글이 쪽마다 다른 sourceId 가 된다.
      detailUrl: `${BASE}${VIEW}?bbsCd=${BBS}&seq=${seq}`,
      dateText: pinned || !ymd ? "" : `${ymd} ~`,
      category: (tds[5]?.text ?? "").replace(/\s+/g, " ").trim(),
      agency: "파주시",
    });
  }
  return out;
}

export const pajuConfig: BoardConfig = {
  id: "paju",
  label: "파주시 기업지원 공고",
  agency: "파주시",
  region: "경기",
  baseUrl: `${BASE}/`,
  charset: "utf-8",
  list: {
    url: (p) => `${BASE}${LIST}?bbsCd=${BBS}&q_currPage=${p}`,
    maxPages: 10,
    rowSelector: "table tbody tr",
    fields: {
      title: { selector: "td.cell-subject a.ellipsis_b" },
      detailUrl: {
        selector: "td.cell-subject a.ellipsis_b",
        attr: "onclick",
        regex: "jsView\\('9052',\\s*'([0-9]+)'",
      },
      date: { selector: "td:nth-child(4)" },
    },
  },
  customParse: parsePajuList,
  // 실측 상세: 본문 칸 클래스명이 article-conetnt(사이트 원문 오타).
  detailContentSelector: "div.article-conetnt",
  attachmentsScopeSelector: "ul.file-list",
  // 한 쪽 10건의 절반. 0행이면 서식 변경.
  expectMinRows: 5,
};
