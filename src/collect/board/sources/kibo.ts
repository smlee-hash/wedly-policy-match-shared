import { parseHtml } from "../html";
import type { BoardConfig, BoardRow } from "../types";

/**
 * 기술보증기금 공지사항(boardType01).
 *
 * 왜 연결했나(2026-09-03 실측): 사이트맵의 지원정보 칸(boardType15/16/17)은
 * Total:0 「등록된 글이 없습니다」로 죽어 있고, 실제 글은 공지사항(boardType01,
 * Total 2648건)에 있다. 상세 `articleNo=65100` 본문에 「동 사업에 참여를 희망하는
 * 기업은 공고 내용에 따라 신청하여 주시기 바랍니다」가 있어 기업이 신청하는
 * 지원사업 공고가 맞다. 같은 칸에 비상임이사 공개모집·채용공고·퀴즈쇼·포상·
 * 청렴도 알림이 섞여 있어 거르개가 필요하다.
 *
 * 구조: `table.board-table > tbody > tr`. 제목은
 * `td.b-td-title .b-title-box a[href*="mode=view"]`. href 에
 * `articleNo` 가 있어 상세 주소를 조립한다.
 * 쪽넘김은 GET `article.offset`(0, 10, 20…) + `articleLimit=10`. 한 쪽 10건 ·
 * 전체 약 265쪽. 목록은 **등록일만** 준다 — pipa 와 같이 「등록일 ~」 개시형.
 *
 * 브라우저 UA 없이도 HTTP 200(실측). 엔진이 이미 UA 를 붙인다.
 */
const BASE = "https://www.kibo.or.kr";
const LIST = "/main/board/boardType01.do";
const NO = /[?&]articleNo=(\d+)/;
const YMD = /(20\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})/;

/**
 * 지원사업이 아닌 글. **버릴 것만** 지정한다.
 * 실측 제목: 비상임이사 공개모집 · 상임이사 모집 · 사무지원인력/신입직원 채용공고 ·
 * 북북 퀴즈쇼 · 아차사고 공모 · 유공 포상 · 종합청렴도 · 논문 모집 · 기술평가체험단.
 * ★`채용` 을 통째로 버리면 안 된다 — 「채용 지원사업」이 죽는다(bizbc.ts 주석).
 * ★`공개모집` 도 통째로 버리면 안 된다 — 지원사업 공고가 그 낱말을 쓴다.
 */
const DROP =
  /비상임이사|상임이사|사무지원인력|퀴즈|아차사고|유공|포상|청렴도|논문\s*모집|체험단|입찰|설문|평가위원|합격자|(?:신규|경력|직원|정규직|신입직원)\s*채용\s*(?:공고|안내)|채용\s*공고|채용공고/;

export function isKiboDropTitle(title: string): boolean {
  return DROP.test(title);
}

/**
 * 붙박이 공지 중 **1년 넘게 붙어 있는 것은 버린다**(koreaexim.ts 방식).
 * 붙박이는 날짜를 비워 저장하는데, 그러면 처음 본 날부터 90일간 「모집중」이 된다.
 * 실측 1·2쪽에는 붙박이 표시가 없다 — class 에 notice 가 생기면 같은 갈래로 건넌다.
 */
const PINNED_MAX_AGE_MS = 365 * 24 * 3600_000;

export function parseKiboList(html: string, _page = 1, now = Date.now()): BoardRow[] {
  const out: BoardRow[] = [];
  const seen = new Set<string>();
  for (const tr of parseHtml(html).querySelectorAll("table.board-table > tbody > tr")) {
    const a = tr.querySelector('td.b-td-title .b-title-box a[href*="mode=view"]');
    const href = (a?.getAttribute("href") ?? "").trim();
    const articleNo = href.match(NO)?.[1] ?? "";
    if (!articleNo || seen.has(articleNo)) continue;
    const title = (a?.text ?? "").replace(/\s+/g, " ").trim();
    if (!title || DROP.test(title)) continue;
    /**
     * 등록일은 **3번째 td 칸을 직접** 집는다(헤더 「등록일자」, 원문 YYYY-MM-DD).
     * ⚠️ 행 전체 글자(`tr.text`)에서 찾으면 안 된다 — 번호 칸 「2647」 + 「2026-08-24」가
     *    「26472026-08-24」로 붙는다(hsbiz 실측 함정).
     * 제목 칸 안 `span.b-date` 는 모바일 중복 표시라 쓰지 않는다 — 칸이 이어 붙는 함정과
     * 같은 글자라도, 3번째 td 가 비면 날짜를 지어내지 않아야 한다.
     */
    const tds = tr.querySelectorAll("td");
    const dateCell = (tds[2]?.text ?? "").replace(/\s+/g, " ").trim();
    const d = dateCell.match(YMD);
    const ymd = d ? `${d[1]}-${d[2].padStart(2, "0")}-${d[3].padStart(2, "0")}` : "";
    const numText = (tr.querySelector("td.b-num-box")?.text ?? "").replace(/\s+/g, " ").trim();
    const pinned =
      (tr.getAttribute("class") ?? "").split(/\s+/).includes("notice") || /공지/.test(numText);
    if (pinned && ymd && now - Date.parse(`${ymd}T00:00:00Z`) > PINNED_MAX_AGE_MS) continue;
    seen.add(articleNo);
    out.push({
      title,
      // ★`article.offset`·`articleLimit` 은 쪽 번호라 주소에 넣으면 같은 글이 쪽마다
      //   다른 줄로 저장된다(2쪽 href 실측 `article.offset=10`).
      detailUrl: `${BASE}${LIST}?mode=view&articleNo=${articleNo}`,
      dateText: pinned || !ymd ? "" : `${ymd} ~`,
      category: "",
      agency: "기술보증기금",
    });
  }
  return out;
}

export const kiboConfig: BoardConfig = {
  id: "kibo",
  label: "기술보증기금 공지",
  agency: "기술보증기금",
  region: "전국",
  baseUrl: `${BASE}/`,
  charset: "utf-8",
  list: {
    url: (p) => `${BASE}${LIST}?mode=list&article.offset=${(p - 1) * 10}&articleLimit=10`,
    maxPages: 6,
    rowSelector: "table.board-table > tbody > tr",
    fields: {
      title: { selector: 'td.b-td-title .b-title-box a[href*="mode=view"]' },
      detailUrl: { selector: 'td.b-td-title .b-title-box a[href*="mode=view"]', attr: "href" },
      date: { selector: "td:nth-child(3)" },
    },
  },
  customParse: parseKiboList,
  /**
   * ★`detailContentSelector` 를 **일부러 안 적는다**(kbiz 와 같음).
   * 상세 `articleNo=65100` 실측: 본문 `div.b-content-box`/`div.fr-view` 는 도입부
   * 「신청하여 주시기 바랍니다」+ 「자세한 사항은 첨부파일 참조」뿐이라, 그걸
   * `targetText` 에 채우면 첨부 공고문(hwpx) 길을 막는다.
   * 첨부는 본문과 다른 상자 `div.b-file-box`(`a.file-down-btn`, href="#" + data-file-*).
   */
  attachmentsScopeSelector: "div.b-file-box",
  /**
   * 한 쪽 10건의 절반은 5 이지만, DROP 뒤 1쪽 실측이 4건이다. 5 로 두면 서식이 멀쩡한데도
   * 1쪽 관문이 거짓 실패한다. 0행이면 서식 변경이므로 2 로 둔다.
   */
  expectMinRows: 2,
};
