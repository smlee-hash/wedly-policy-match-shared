import { parseHtml } from "../html";
import type { BoardConfig, BoardRow } from "../types";

/**
 * 중소벤처기업유통원 공지사항 통합 게시판(`key=2409240028`).
 *
 * 왜 연결했나(2026-09-05 실측): 사업공고·공모전·행사·행정공지가 한 판에 섞여 있고
 * 총 546건. 기업마당이 안 싣는 소상공인 판로 지원사업(온라인판로·점프업·상품개선)이
 * 이 판에 올라온다. 겹침은 저장 쪽 `dedupKey`(제목+기관 정규화) 병합이 접는데,
 * **기관이 다르면 원리적으로 안 접힌다** — 여기서는 제목 말머리만 맞춰 준다
 * (`stripKodmaTitlePrefix`). 기관까지 다른 겹침은 이 파일에서 못 푼다.
 *
 * 구조: `div.list-wrap > div.list-btm > div.table-wrap.type-line > div.list-row`.
 * 머리줄 `div.list-row.table-title` 은 건넌다. 제목 `div.title > a` 의 href 는 `#` 이라
 * `onclick="goView('2608120001')"` 숫자를 뽑아 상세 주소를 손으로 조립한다.
 * 쪽넘김은 GET `?pageIndex=n`. 한 쪽 10행. 공지·행사가 섞여 앞쪽만 본다 — `maxPages: 3`.
 * 목록은 **등록일만** 준다(`div.date` YYYY-MM-DD) — pipa·keiti 와 같이 「등록일 ~」 개시형.
 *
 * ★`공모` 를 통째로 버리면 안 된다 — 지원사업 공모가 제목에 「공모」를 쓴다.
 */
const BASE = "https://www.kodma.or.kr";
const LIST = "/bbs/list.do";
const VIEW = "/bbs/view.do";
const KEY = "2409240028";
const GO = /goView\(\s*'(\d+)'\s*\)/;
const YMD = /(20\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})/;

/**
 * 지원사업이 아닌 글. **버릴 것만** 지정한다 — 허용목록(KEEP)은 「~ 안내」형 지원사업을 죽인다(hsbiz).
 * 실측 제목 유형(2026-09-05 1·2쪽): 숏폼영상 공모전 · 세계한상대회 · 국민제안 · 사칭 ·
 * 회원제 폐지 · 개인정보 · 소송수행 · 고객만족도 · [협조 공지].
 */
const DROP =
  /공모전|세계한상대회|국민제안|사칭|회원제 폐지|개인정보\s*(파기|제3자|제공|처리방침)|소송수행|고객만족도|\[협조 공지\]|\[국정성과\]/;

export function isKodmaDropTitle(title: string): boolean {
  return DROP.test(title);
}

/**
 * 제목 앞 대괄호 말머리(`[공고]`·`[모집]`·`[재공고]`)를 뗀다.
 *
 * 왜(적대 리뷰 높음): 같은 공고를 다른 게시판은 말머리 없이 올린다 — 이 판의
 * `[공고] 2026년 소상공인 온라인판로 지원사업 참여기업 모집공고` 와 광명센터의 같은 제목이
 * 저장 쪽 `dedupKey`(제목+기관 정규화)에서 갈렸다. 대괄호는 정규화가 지우지만 **낱말 「공고」는
 * 남기** 때문에 제목 자체가 달라진다. `[공지]` 는 떼지 않는다 — 저장 쪽 고정 공지 예외
 * (`PINNED_NOTICE`)가 그 말머리로 상시 공고를 90일 규칙에서 지켜 준다.
 * ★DROP 거르개는 **원문 제목**에 걸어야 한다(`[협조 공지]`·`[국정성과]` 가 말머리다).
 */
const TITLE_PREFIX = /^\s*[[［【]\s*(?:공고|모집|재공고)\s*[\]］】]\s*/;

export function stripKodmaTitlePrefix(title: string): string {
  return title.replace(TITLE_PREFIX, "").trim();
}

export function parseKodmaList(html: string): BoardRow[] {
  const out: BoardRow[] = [];
  const seen = new Set<string>();
  for (const row of parseHtml(html).querySelectorAll(
    "div.list-wrap > div.list-btm > div.table-wrap.type-line > div.list-row",
  )) {
    const cls = (row.getAttribute("class") ?? "").split(/\s+/);
    if (cls.includes("table-title")) continue;
    const a = row.querySelector("div.title > a");
    const sn = (a?.getAttribute("onclick") ?? "").match(GO)?.[1] ?? "";
    if (!sn || seen.has(sn)) continue;
    const raw = (a?.text ?? "").replace(/\s+/g, " ").trim();
    // 거르개는 원문 제목에, 저장은 말머리를 뗀 제목으로 — 순서를 바꾸면 `[협조 공지]` 가 안 걸린다.
    if (!raw || DROP.test(raw)) continue;
    const title = stripKodmaTitlePrefix(raw);
    if (!title) continue;
    seen.add(sn);
    /**
     * 등록일은 **`div.date` 칸을 직접** 집는다.
     * ⚠️ 행 전체 글자(`row.text`)에서 찾으면 안 된다 — 칸이 띄어쓰기 없이 이어 붙어
     *    번호 「546」 + 「2026-05-27」이 「5462026-05-27」이 된다(hsbiz 실측 함정).
     */
    const dateCell = (row.querySelector("div.date")?.text ?? "").replace(/\s+/g, " ").trim();
    const d = dateCell.match(YMD);
    const ymd = d ? `${d[1]}-${d[2].padStart(2, "0")}-${d[3].padStart(2, "0")}` : "";
    out.push({
      title,
      detailUrl: `${BASE}${VIEW}?key=${KEY}&pstSn=${sn}`,
      dateText: ymd ? `${ymd} ~` : "",
      category: "",
      agency: "중소벤처기업유통원",
    });
  }
  return out;
}

export const kodmaConfig: BoardConfig = {
  id: "kodma",
  label: "중소벤처기업유통원",
  agency: "중소벤처기업유통원",
  region: "전국",
  baseUrl: `${BASE}/`,
  charset: "utf-8",
  list: {
    url: (p) => `${BASE}${LIST}?key=${KEY}&pageIndex=${p}`,
    maxPages: 3,
    rowSelector: "div.list-wrap > div.list-btm > div.table-wrap.type-line > div.list-row",
    fields: {
      title: { selector: "div.title > a" },
      detailUrl: { selector: "div.title > a", attr: "onclick", regex: "goView\\(\\s*'(\\d+)'\\s*\\)" },
      date: { selector: "div.date" },
    },
  },
  customParse: parseKodmaList,
  /**
   * ★추측 단계를 끈다. 이 판은 제목 링크가 전부 `href="#"` 이고 지원사업이 아닌 글이 섞여 있다.
   * 추측 단계가 `a[href]` 를 긁으면 메뉴·바닥글이 공고로 저장되고, 거르개를 지나친 공모전·행사
   * 글이 그대로 남는다 — 그 줄은 다음 회차에 지워지지 않는다(수출입은행에서 겪은 갈래).
   */
  skipHeuristic: true,
  // 1쪽 10행에서 DROP 뒤 실측 4건(`[국정성과]` 를 버리면서 5→4). 0행이면 서식 변경이므로 2로 둔다.
  expectMinRows: 2,
};
