import { parseHtml } from "../html";
import type { BoardConfig, BoardRow } from "../types";

/**
 * 농림식품기술기획평가원(IPET) 사업공고 — 알림소식 > 사업공고.
 *
 * 구조(2026-09-03 실측): `table.sub-table > tbody > tr` 한 줄에 칸 5개
 * 「번호 · 접수기간 · 공고명 · 접수상태 · 등록일」. 완전 서버렌더 HTML 이라 화면 그리기가 필요 없고,
 * 브라우저 UA 위장도 필요 없다(UA 없는 curl 도 HTTP 200 · 같은 바이트).
 * 쪽넘김은 `?page=n` GET · 한 쪽 10건 · 전체 327건/33쪽 · UTF-8.
 *
 * ★목록이 **접수기간을 시작·끝 둘 다** 준다(등록일만 주는 게시판보다 마감 정리가 정확하다).
 *   33쪽 전부 「YYYY-MM-DD ~ YYYY-MM-DD」 였다.
 *
 * ★상세 주소를 목록 href 그대로 쓰면 안 된다.
 *   목록 href 는 `bizNoticeVP.asp?page=1&tbl_id=2026000028&_sbj=<제목>` 이라 **쪽 번호와 제목이 섞인다** —
 *   그대로 저장하면 같은 글이 1쪽·2쪽에서 다른 열쇠(sourceId)가 되어 두 줄로 쌓인다.
 *   `tbl_id` 만 뽑아 `bizNoticeVP.asp?tbl_id=…` 로 조립한다(실측 200/45,681바이트로 정상 열림).
 *
 * ★첨부는 **다른 호스트**(`rnd.ipet.re.kr`)에 있다 — `allowedHosts` 에 안 적으면 첨부 내려받기
 *   허용 명부(attachment-text.ts 는 게시판 명부의 allowedHostsOf 를 그대로 쓴다)에서 빠져
 *   공고문 HWP/PDF 를 통째로 못 받는다.
 */
const BASE = "https://www.ipet.re.kr";
const LIST = "/Notice/bizNoticeLV.asp";
const VIEW = "/Notice/bizNoticeVP.asp";
const TBL_ID = /[?&]tbl_id=(\d+)/;
const YMD = /(20\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})/g;

/**
 * 지원사업이 아닌 글. **버릴 것만** 좁게 지정한다(실측 1·2쪽 20건에는 한 건도 없다).
 * ★`채용` 을 통째로 버리면 안 된다(bizbc 주석) — 고용보조금은 제목에 「채용」을 쓴다.
 *   기관이 사람을 뽑는 글(`직원 채용 공고`)만 버리고 `채용 지원사업` 은 살린다.
 */
const DROP =
  /입찰|설문|평가위원|외부전문가|전문가\s*풀|우선협상대상자|제안발표|합격자|(?:신규|경력|직원)\s*채용\s*(?:공고|안내)|채용\s*공고/;

export function isIpetDropTitle(title: string): boolean {
  return DROP.test(title);
}

/**
 * 붙박이 공지 중 **1년 넘게 붙어 있는 것은 버린다**(koreaexim 방식).
 * 실측 33쪽 전부 번호 칸이 숫자라 지금은 붙박이가 없지만, 생기면 오래된 글이 계속 「모집중」으로 뜬다.
 */
const PINNED_MAX_AGE_MS = 365 * 24 * 3600_000;

/** 칸 하나에서 YYYY-MM-DD 를 모두 뽑는다(0채움). */
function daysIn(cellText: string): string[] {
  return [...cellText.matchAll(YMD)].map(
    (m) => `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`,
  );
}

export function parseIpetList(html: string, _page = 1, now = Date.now()): BoardRow[] {
  const out: BoardRow[] = [];
  const seen = new Set<string>();
  for (const tr of parseHtml(html).querySelectorAll("table.sub-table tbody tr")) {
    const cells = tr.querySelectorAll("td");
    const titleIdx = cells.findIndex((td) =>
      (td.getAttribute("class") ?? "").split(/\s+/).includes("taxt-lt20"),
    );
    if (titleIdx < 0) continue;
    const a = cells[titleIdx].querySelector("a");
    const id = (a?.getAttribute("href") ?? "").match(TBL_ID)?.[1] ?? "";
    if (!id || seen.has(id)) continue;
    // 제목: `title` 속성이 전체 공고명이고 화면 글자와 같다(실측). 속성이 없으면 글자로.
    const title = ((a?.getAttribute("title") ?? "").trim() || (a?.text ?? "")).replace(/\s+/g, " ").trim();
    if (!title || DROP.test(title)) continue;
    /**
     * 접수기간은 **공고명 칸 바로 왼쪽 칸**을 직접 집는다.
     * ⚠️ 행 전체 글자(`tr.text`)에서 정규식으로 찾으면 안 된다 — 번호 칸 「327」과 붙어
     *    「3272026-04-14」 가 되고 경계가 깨져 날짜를 못 읽는다(hsbiz 실측 함정).
     * ⚠️ 마지막 칸은 **등록일**이라 접수기간이 아니다 — 섞어 쓰면 마감일이 통째로 틀어진다.
     */
    const days = daysIn(cells[titleIdx - 1]?.text ?? "");
    const dateText = days.length >= 2 ? `${days[0]} ~ ${days[1]}` : days.length === 1 ? `${days[0]} ~` : "";
    const no = (cells[0]?.text ?? "").replace(/\s+/g, "");
    if (no && !/^\d+$/.test(no)) {
      // 붙박이 공지 — 나이는 마지막 칸(등록일)으로 잰다. 없으면 접수기간 끝으로.
      const reg = daysIn(cells[cells.length - 1]?.text ?? "")[0] ?? days[days.length - 1] ?? "";
      if (reg && now - Date.parse(`${reg}T00:00:00Z`) > PINNED_MAX_AGE_MS) continue;
    }
    seen.add(id);
    out.push({
      title,
      // ★page·_sbj 는 넣지 않는다 — 주소가 곧 중복 판정 열쇠(sourceId)다.
      detailUrl: `${BASE}${VIEW}?tbl_id=${id}`,
      dateText,
      // 접수상태(접수중/접수완료)는 시간이 지나면 바뀌는 상태값이라 분류로 쓰지 않는다.
      category: "",
      agency: "농림식품기술기획평가원",
    });
  }
  return out;
}

export const ipetConfig: BoardConfig = {
  id: "ipet",
  label: "농림식품기술기획평가원",
  agency: "농림식품기술기획평가원",
  region: "전국",
  baseUrl: `${BASE}/`,
  // 첨부 내려받기 주소가 여기로만 나간다(실측 5건 전부 `rnd.ipet.re.kr/…/fileDownload.do?atchFileNo=…`).
  allowedHosts: ["rnd.ipet.re.kr"],
  charset: "utf-8",
  list: {
    url: (p) => `${BASE}${LIST}?page=${p}`,
    maxPages: 10,
    rowSelector: "table.sub-table tbody tr",
    fields: {
      title: { selector: "td.taxt-lt20 a", attr: "title" },
      detailUrl: { selector: "td.taxt-lt20 a", attr: "href" },
      date: { selector: "td.taxt-lt20" },
    },
  },
  customParse: parseIpetList,
  // 상세는 「공고기간·접수기간·공고명·첨부파일·지원내용 및 추진형태」 한 표에 다 들어 있다(실측).
  detailContentSelector: "table.sub-table.row-table",
  /**
   * 첨부 칸에 class 가 없고, 같은 칸에 **모든 공고 공통 안내 PDF**(「첨부파일 다운로드 가이드」)가
   * 섞여 있다 — 칸째 수확하면 327건 전부에 같은 안내서가 붙는다(인천 비즈OK 와 같은 오염).
   * 실제 공고문 링크만 집는다: 5건 전부 `rnd.ipet.re.kr/…/fileDownload.do?atchFileNo=…` 였다.
   */
  attachmentsScopeSelector: "table.row-table a[href*='fileDownload.do']",
  // 한 쪽 10건. 절반 아래로 떨어지면 서식 변경 의심(0행이면 확실).
  expectMinRows: 5,
  // skipHeuristic 은 켜지 않는다 — 목록 행에 첨부 파일 링크가 하나도 없어(실측) 추측 단계가
  // 파일 링크를 공고로 저장할 위험이 없고, 구조가 바뀌면 마지막 방어선이 된다(광주TP 근거).
};
