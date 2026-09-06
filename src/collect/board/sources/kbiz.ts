import { parseHtml } from "../html";
import type { BoardConfig, BoardRow } from "../types";

/**
 * 중소기업중앙회 유관기관 공지(mnSeq=210).
 *
 * 왜 연결했나(2026-09-02 실측): 최신 12건을 우리 DB 와 제목으로 대조했더니 **겹침 0**.
 * 12건 중 진짜 지원사업은 약 6건 — 밀도는 낮지만 기업마당이 안 싣는 유관기관 글이다.
 *
 * ★ `mnSeq=209`(중앙회 공지)는 통계조사·자체 행사라 밀도가 낮고,
 *    `mnSeq=211`(입찰·사업공고)은 이름과 달리 **KBIZ 가 발주하는 용역 입찰**이라 붙이면 안 된다.
 *
 * 구조: `div.table-box01 table tbody tr`. 제목이 `<a href>` 가 아니라
 * `<span onclick="goView(163878, 'N')">` 라서 상세 주소를 손으로 조립한다.
 * 쪽넘김은 `?pg=n` GET. 한 쪽이 **457KB** 라 `maxPages: 3`.
 * 목록은 **등록일만** 준다 — pipa 와 같이 「등록일 ~」 개시형.
 *
 * ⚠️ 제목 끝의 **` NEW`**(또는 `<span class="new">NEW</span>`) 를 잘라낸다.
 * ⚠️ **`tr.notice`(고정 공지)는 날짜를 비운다** — 실측 고정 공지가 `2025.12.19`(257일 전)이고
 *    제목이 「[국세청] 연말정산 …」이라 `PINNED_NOTICE` 예외에 못 걸려 **저장 즉시 마감**된다
 *    (평택 pipa 와 같은 갈래).
 * ★ 기관은 제목 앞 대괄호에서 뽑는다. 이 게시판은 남의 기관 공고를 옮겨 싣는 자리라
 *    (`[한국전력공사]`·`[중소벤처기업부]`·`[근로복지공단]`), 기관을 「중소기업중앙회」로 못 박으면
 *    중복 열쇠(`제목|기관`)가 달라져 **기업마당의 같은 공고와 안 묶인다**(화성 hsbiz 에서 겪은 것).
 */
const BASE = "https://www.kbiz.or.kr";
const LIST = "/ko/contents/bbs/list.do";
const VIEW = "/ko/contents/bbs/view.do";
const MN = "210";
const GO = /goView\(\s*(\d+)\s*,\s*['"]([NY])['"]/;
const YMD = /(20\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})/;
const BRACKET = /^\[([^\]]+)\]/;

/**
 * 지원사업이 아닌 글. **버릴 것만** 지정한다.
 * 실측 제목: 「생명사랑 밤길걷기 개최」·「사회서비스 박람회 개최」·「세제개편안」·「기술통계조사 오류정정」.
 * ★`채용` 을 통째로 버리면 안 된다 — 1쪽에 「채용문화 우수기업 어워즈」가 있다.
 */
const DROP = /밤길걷기|사회서비스\s*박람회|세제개편안|기술통계조사|자료\s*모음/;

/**
 * 붙박이 공지 중 **1년 넘게 붙어 있는 것은 버린다**(적대 리뷰 지적).
 * 붙박이는 날짜를 비워 저장하는데(아래 이유), 그러면 처음 본 날부터 90일 동안 「모집중」이 된다.
 * 오래 붙어 있는 붙박이는 대개 자료·안내라 그렇게 되살리면 안 된다. 실측 붙박이가
 * `2025.12.19`(국세청 연말정산 자료 모음)이라 이 갈래에 정확히 걸린다.
 */
const PINNED_MAX_AGE_MS = 365 * 24 * 3600_000;

export function isKbizDropTitle(title: string): boolean {
  return DROP.test(title);
}

function agencyOf(title: string): string {
  const raw = title.match(BRACKET)?.[1]?.trim() ?? "";
  return raw || "중소기업중앙회";
}

export function parseKbizList(html: string, _page = 1, now = Date.now()): BoardRow[] {
  const out: BoardRow[] = [];
  const seen = new Set<string>();
  for (const tr of parseHtml(html).querySelectorAll("div.table-box01 table tbody tr")) {
    const span = tr.querySelector("td.subject > span") ?? tr.querySelector("td.subject span");
    const hit = (span?.getAttribute("onclick") ?? "").match(GO);
    const seq = hit?.[1] ?? "";
    if (!seq || seen.has(seq)) continue;
    // NEW 딱지는 안쪽 span 이라 노드를 먼저 떼고 읽는다. 텍스트로만 남은 경우도 자른다.
    span?.querySelector("span.new")?.remove();
    const title = (span?.text ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\s*NEW$/i, "")
      .trim();
    if (!title || DROP.test(title)) continue;
    /**
     * 등록일은 **`td.date` 칸을 직접** 집는다.
     * ⚠️ 행 전체 글자(`tr.text`)에서 찾으면 안 된다 — 번호 칸 「1287」 + 「2026.09.01」이
     *    「12872026.09.01」로 붙는다(hsbiz 실측 함정).
     */
    const dateCell = (tr.querySelector("td.date")?.text ?? "").replace(/\s+/g, " ").trim();
    const d = dateCell.match(YMD);
    const ymd = d ? `${d[1]}-${d[2].padStart(2, "0")}-${d[3].padStart(2, "0")}` : "";
    const pinned = (tr.getAttribute("class") ?? "").split(/\s+/).includes("notice");
    // 오래 붙어 있는 붙박이는 아예 안 담는다 — 날짜를 비우면 처음 본 날부터 90일간 되살아난다.
    if (pinned && ymd && now - Date.parse(`${ymd}T00:00:00Z`) > PINNED_MAX_AGE_MS) continue;
    seen.add(seq);
    out.push({
      title,
      // ★`topFixYn` 은 상세를 여는 데 필요 없다(빼고 불러도 본문 동일 — 실측). 그런데 값이
      //   고정 여부에 따라 Y↔N 으로 바뀌므로 주소에 넣으면 **같은 공고가 두 줄로 저장된다**
      //   (주소가 곧 중복 판정 열쇠 sourceId — 적대 리뷰 지적).
      detailUrl: `${BASE}${VIEW}?seq=${seq}&mnSeq=${MN}`,
      dateText: pinned || !ymd ? "" : `${ymd} ~`,
      category: "",
      agency: agencyOf(title),
    });
  }
  return out;
}

export const kbizConfig: BoardConfig = {
  id: "kbiz",
  label: "중소기업중앙회",
  agency: "중소기업중앙회",
  region: "전국",
  baseUrl: `${BASE}/`,
  charset: "utf-8",
  list: {
    url: (p) => `${BASE}${LIST}?mnSeq=${MN}&pg=${p}`,
    maxPages: 3,
    rowSelector: "div.table-box01 table tbody tr",
    fields: {
      title: { selector: "td.subject > span" },
      detailUrl: { selector: "td.subject > span", attr: "onclick", regex: "goView\\(\\s*(\\d+)" },
      date: { selector: "td.date" },
    },
  },
  customParse: parseKbizList,
  /**
   * ★`detailContentSelector` 를 **일부러 안 적는다**(적대 리뷰 지적 반영).
   * 상세 본문(`div.detail-body`)은 파서가 첫 문단에서 상자를 닫아 실측 328자짜리 도입부만 잡힌다.
   * 그 도입부를 `targetText` 에 채우면 뒷단계의 「첨부에서 본문 뽑기」가 `targetText === ""`
   * 조건에서 이 공고를 건너뛰어, 첨부 공고문 PDF 의 「최근 3년 한전 납품실적」·「수출 300만 달러
   * 이상」 같은 **진짜 자격조건을 영영 못 읽는다.** 선택자를 비워 첨부 길을 열어 둔다.
   * 첨부는 본문과 다른 상자(`div.file-wrap`)에 있어 범위를 그쪽으로 못 박는다.
   */
  attachmentsScopeSelector: "div.file-wrap",
  expectMinRows: 2,
};
