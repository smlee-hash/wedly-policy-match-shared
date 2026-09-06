import { parseHtml } from "../html";
import type { BoardConfig, BoardRow } from "../types";

/**
 * 김포산업진흥원(김포산업지원센터, GOPA) 김포시 지원사업.
 *
 * 왜 연결했나(2026-09-03 실측): 지원사업 탭이 김포시 자체 공고(`/sub/apply01`, 이 출처)와
 * 타기관 재게시(`/sub/apply02`) 두 갈래다. apply01 은 순수 서버렌더 HTML 이라 JS 없이
 * 제목·신청기간·마감/접수중 태그가 전부 노출된다. 최신 표본은 「에너지효율시장 조성사업」·
 * 「중소기업 국도비 유치 지원사업」·「SOS컨설팅」처럼 김포시 자체 모집이다.
 *
 * 구조: 표가 아니라 `div.list.list2 > ul > li`. `li.end` 는 마감, class 없는 `li` 는 접수중.
 * 제목 `div.txt strong`, 신청기간 `div.txt em`(`YYYY-MM-DD ~ YYYY-MM-DD`).
 * 상세 href 는 `view.html?idx={id}&curpage={page}` — **idx 만** 써서 주소를 조립한다.
 * 쪽 번호가 sourceId 에 섞이면 같은 글이 쪽마다 다른 줄로 저장된다.
 * 쪽넘김은 `?curpage=n` GET. 한 쪽 6건 · 총 약 19쪽(목록 머리글 「총 100개의 게시물」).
 * **모집기간을 목록에서 시작·끝 둘 다 준다** — 등록일만 주는 게시판보다 마감 정리가 정확하다.
 *
 * 붙박이 공지 칸은 없다(1·2쪽 실측). 브라우저 UA 없이도 200 이지만 엔진이 이미 UA 를 붙인다.
 */
const BASE = "https://gopa.or.kr";
const LIST = "/sub/apply01";
const IDX = /[?&]idx=(\d+)/;
const YMD = /(20\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})/g;

/**
 * 지원사업이 아닌 글.
 * ★`채용` 을 통째로 버리면 안 된다(적대 리뷰 중요) — 고용보조금은 제목에 「채용」을 쓴다.
 *   기관이 사람을 뽑는 글(`직원 채용`·`채용 공고`)만 좁게 버리고 `채용 지원`은 살린다.
 * 실측 1·2쪽에는 DROP 후보가 없었지만, 입찰·설문·평가위원·합격자는 기업이 신청할 지원사업이 아니다.
 */
const DROP = /입찰|설문|합격자/;
const DROP_STAFF =
  /평가위원|외부전문가|전문가\s*풀|우선협상대상자|제안발표|(?:신규|경력|직원)\s*채용\s*(?:공고|안내)|채용\s*공고/;

export function parseGopaList(html: string): BoardRow[] {
  const out: BoardRow[] = [];
  const seen = new Set<string>();
  for (const li of parseHtml(html).querySelectorAll("div.list.list2 ul li")) {
    const a = li.querySelector("a");
    const idx = (a?.getAttribute("href") ?? "").match(IDX)?.[1] ?? "";
    if (!idx || seen.has(idx)) continue;
    const title = (li.querySelector("div.txt strong")?.text ?? "").replace(/\s+/g, " ").trim();
    if (!title || DROP.test(title) || DROP_STAFF.test(title)) continue;
    seen.add(idx);
    // 신청기간 칸 — 「시작 ~ 끝」 또는 끝이 없는 「시작 ~」. 칸(em) 단위로만 읽는다.
    // ⚠️ 행 전체 글자(`li.text`)에서 찾으면 안 된다 — 칸이 띄어쓰기 없이 이어 붙어
    // 조회수 「205」 + 「2026-08-12」 이 「2052026-08-12」 가 되고 `\b` 경계가 깨져 날짜를 못 읽는다(hsbiz 실측 함정).
    const period = (li.querySelector("div.txt em")?.text ?? "").replace(/\s+/g, " ").trim();
    const days = [...period.matchAll(YMD)].map(
      (m) => `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`,
    );
    const dateText = days.length >= 2 ? `${days[0]} ~ ${days[1]}` : days.length === 1 ? `${days[0]} ~` : "";
    out.push({
      title,
      detailUrl: `${BASE}${LIST}/view.html?idx=${idx}`,
      dateText,
      category: "",
      // 이 게시판은 김포시·여성새로일하기센터·경기대진테크노파크 공고를 그대로 옮겨 싣는다(실측).
      // 기관을 「김포산업진흥원」으로 못 박으면 중복 판정 열쇠(제목+기관)가 달라져,
      // 기업마당에 원 기관명으로 든 같은 공고와 안 묶여 목록에 두 줄로 뜬다(적대 리뷰 중요).
      // `div.txt p` 에 실제 기관이 있다(비어 있으면 김포산업진흥원).
      agency:
        (li.querySelector("div.txt p")?.text ?? "").replace(/\s+/g, " ").trim() || "김포산업진흥원",
    });
  }
  return out;
}

export const gopaConfig: BoardConfig = {
  id: "gopa",
  label: "김포산업진흥원",
  agency: "김포산업진흥원",
  region: "경기",
  baseUrl: `${BASE}/`,
  charset: "utf-8",
  list: {
    url: (p) => `${BASE}${LIST}/list.html?curpage=${p}`,
    maxPages: 19,
    rowSelector: "div.list.list2 ul li",
    fields: {
      title: { selector: "div.txt strong" },
      detailUrl: { selector: "a", attr: "href" },
      date: { selector: "div.txt em" },
    },
  },
  customParse: parseGopaList,
  // 상세 고정본 idx=113: 본문은 `div.con02 div.area`(지원내용), 첨부는 `div.b_file`
  // (`/board_file_download.php`). 바깥 `div.con01` 은 신청기간·지원대상 표지 칸이다.
  detailContentSelector: "div.con02 div.area",
  attachmentsScopeSelector: "div.b_file",
  // 한 쪽 6건. 제목 거르개를 지난 뒤 몇 건만 남을 수 있다. 0행이면 서식 변경이므로 절반인 3.
  expectMinRows: 3,
};
