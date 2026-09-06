import { parseHtml } from "../html";
import type { BoardConfig, BoardRow } from "../types";

/**
 * 광명시 소상공인지원센터 알림마당 공지사항(mid=s41).
 *
 * 왜 연결했나(2026-09-03 실측): 힌트의 「광명산업진흥원」은 2026-09 현재 미설립이다
 * (시의회 설립조례 5차 시도, 제9대 마지막 회기까지 무산). 실제 광명시 소상공인 모집공고는
 * 시청 산하 `sbdc.gm.go.kr`(푸터 주소 경기도 광명시 오리로 651번길 8)의
 * **알림마당 > 공지사항(`/s41`)** 에 올라온다. 상단 「지원사업」(`/s01`)은 정적 안내 페이지다.
 *
 * 구조: XE 게시판. `table.table-hover tbody tr`(td.title 있는 행). 제목 `td.title > a`.
 * 상세는 1쪽 `https://sbdc.gm.go.kr/s41/{document_srl}`, 2쪽부터는
 * `index.php?mid=s41&page=N&document_srl={id}` 혼용 — **쪽 번호를 주소에 넣으면 같은 글이
 * 쪽마다 다른 줄로 저장되므로** `/s41/{id}` 로 정규화한다.
 * 쪽넘김은 GET `?mid=s41&page=n`. 한 쪽 붙박이 2 + 일반 19, 전체 약 12쪽.
 * 목록은 **등록일만** 준다(`td.time`) — pipa·kbiz 와 같이 「등록일 ~」 개시형.
 *
 * ⚠️ 붙박이(`tr.notice`)가 모든 쪽에 반복된다. `seen` 으로 document_srl 을 한 번만 담는다.
 * ⚠️ 목록 행의 file.gif 는 아이콘이지 내려받기 링크가 아니다.
 */
const BASE = "https://sbdc.gm.go.kr";
const YMD = /(20\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})/;
const BRACKET = /^\[([^\]]+)\]/;
const SRL_PATH = /\/s41\/(\d+)(?:[/?#]|$)/;
const SRL_QUERY = /[?&]document_srl=(\d+)/;

/**
 * 지원사업이 아닌 글. **버릴 것만** 지정한다.
 * 실측 1·2쪽: 상인회 계약직 **공개채용** · 부천대 **신입생** 모집 · 자동차 **무상점검** ·
 * 경기 살리기 **통큰 세일**(본 행사·참여상권 모집).
 * ★`채용` 을 통째로 버리면 안 된다 — 고용보조금은 제목에 「채용」을 쓴다(bizbc·cwip).
 */
const DROP = /신입생|무상점검|통큰\s*세일|입찰|설문|평가위원|합격자/;
const DROP_STAFF = /공개채용|(?:신규|경력|직원)\s*채용|채용\s*공고/;

/**
 * 붙박이 공지 중 **1년 넘게 붙어 있는 것은 버린다**(적대 리뷰 지적).
 * 붙박이는 날짜를 비워 저장하는데, 그러면 처음 본 날부터 90일 동안 「모집중」이 된다.
 */
const PINNED_MAX_AGE_MS = 365 * 24 * 3600_000;

export function isGmsbdcDropTitle(title: string): boolean {
  return DROP.test(title) || DROP_STAFF.test(title);
}

function agencyOf(title: string): string {
  const raw = title.match(BRACKET)?.[1]?.trim() ?? "";
  return raw || "광명시 소상공인지원센터";
}

function srlOf(href: string): string {
  return href.match(SRL_PATH)?.[1] ?? href.match(SRL_QUERY)?.[1] ?? "";
}

export function parseGmsbdcList(html: string, _page = 1, now = Date.now()): BoardRow[] {
  const out: BoardRow[] = [];
  const seen = new Set<string>();
  for (const tr of parseHtml(html).querySelectorAll("table.table-hover tbody tr")) {
    if (!tr.querySelector("td.title")) continue;
    const a = tr.querySelector("td.title > a") ?? tr.querySelector("td.title a");
    const srl = srlOf((a?.getAttribute("href") ?? "").trim());
    if (!srl || seen.has(srl)) continue;
    const title = (a?.text ?? "").replace(/\s+/g, " ").trim();
    if (!title || isGmsbdcDropTitle(title)) continue;
    /**
     * 등록일은 **`td.time` 칸을 직접** 집는다.
     * ⚠️ 행 전체 글자(`tr.text`)에서 찾으면 안 된다 — 번호 칸 「227」 + 「2026.08.20」이
     *    「2272026.08.20」로 붙는다(hsbiz 실측 함정).
     */
    const dateCell = (tr.querySelector("td.time")?.text ?? "").replace(/\s+/g, " ").trim();
    const d = dateCell.match(YMD);
    const ymd = d ? `${d[1]}-${d[2].padStart(2, "0")}-${d[3].padStart(2, "0")}` : "";
    const pinned = (tr.getAttribute("class") ?? "").split(/\s+/).includes("notice");
    // 오래 붙어 있는 붙박이는 아예 안 담는다 — 날짜를 비우면 처음 본 날부터 90일간 되살아난다.
    if (pinned && ymd && now - Date.parse(`${ymd}T00:00:00Z`) > PINNED_MAX_AGE_MS) continue;
    seen.add(srl);
    out.push({
      title,
      detailUrl: `${BASE}/s41/${srl}`,
      dateText: pinned || !ymd ? "" : `${ymd} ~`,
      category: "",
      agency: agencyOf(title),
    });
  }
  return out;
}

export const gmsbdcConfig: BoardConfig = {
  id: "gmsbdc",
  label: "광명시 소상공인지원센터",
  agency: "광명시 소상공인지원센터",
  region: "경기",
  baseUrl: `${BASE}/`,
  charset: "utf-8",
  list: {
    url: (p) => `${BASE}/index.php?mid=s41&page=${p}`,
    maxPages: 6,
    rowSelector: "table.table-hover tbody tr",
    fields: {
      title: { selector: "td.title > a" },
      detailUrl: { selector: "td.title > a", attr: "href" },
      date: { selector: "td.time" },
    },
  },
  customParse: parseGmsbdcList,
  /**
   * 상세 실측 `/s41/27026`(2026-09-03): 본문은 XE `div.xe_content`(공고 문단),
   * 첨부는 「첨부파일 [ 2 ]」 아래 `ul.files` 의 `procFileDownload` 링크 두 개.
   */
  detailContentSelector: "div.xe_content",
  attachmentsScopeSelector: "ul.files",
  // 한 쪽 일반 19건의 절반. 0행이면 서식 변경.
  expectMinRows: 9,
};
