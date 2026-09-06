import { parseHtml } from "../html";
import type { BoardConfig, BoardRow } from "../types";

/**
 * 부천산업진흥원 사업공고.
 *
 * 왜 연결했나(2026-09-01 실측): 최신 공고 10건을 기업마당·보조금24 포함 우리 DB 전체와
 * 제목으로 대조했더니 **겹침 4/10** 이었다 — 나머지 6건은 어디로도 안 들어온다.
 *
 * 구조: 표가 아니라 `ul.board_list` 안의 `li.tr`. 제목이 `<a href>` 가 아니라
 * `<a onclick="fn_goView('번호')">` 라서 상세 주소를 손으로 조립한다.
 * 쪽넘김은 `?page=n` GET. lastPageNo="2" 라 총 2쪽·14건(1쪽 10건·2쪽 4건 전부 새것)이므로
 * maxPages 는 3.
 * **모집기간을 목록에서 시작·끝 둘 다 준다** — 등록일만 주는 게시판보다 마감 정리가 정확하다.
 */
const BASE = "https://www.bizbc.or.kr";
const LIST = "/kor/contents/BC0101010000.do";
const SN = /fn_goView\(\s*'(\d+)'\s*\)/;
const YMD = /(20\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})/g;

/**
 * 지원사업이 아닌 글.
 * ★`채용` 을 통째로 버리면 안 된다(적대 리뷰 중요) — 고용보조금은 제목에 「채용」을 쓴다.
 *   실측에서 「방위산업 중소기업 신규직원 **채용 지원사업** 참여기업 모집」 등 5건이 죽었다.
 *   기관이 사람을 뽑는 글(`직원 채용`·`채용 공고`)만 좁게 버리고 `채용 지원`은 살린다.
 */
const DROP = /입찰|설문|행사\s*안내/;
// 인력·용역 — 창원(cwip)·화성(hsbiz)은 같은 것을 버린다.
// 「평가위원 모집」·「전문가 풀 모집」·「우선협상대상자 공고」는 기업이 신청할 지원사업이 아니다.
const DROP_STAFF =
  /평가위원|외부전문가|전문가\s*풀|우선협상대상자|제안발표|(?:신규|경력|직원)\s*채용\s*(?:공고|안내)|채용\s*공고/;

export function parseBizbcList(html: string): BoardRow[] {
  const out: BoardRow[] = [];
  const seen = new Set<string>();
  for (const li of parseHtml(html).querySelectorAll("ul.board_list li.tr")) {
    const a = li.querySelector("div.board_tit a");
    const sn = (a?.getAttribute("onclick") ?? "").match(SN)?.[1] ?? "";
    if (!sn || seen.has(sn)) continue;
    const title = (a?.text ?? "").replace(/\s+/g, " ").trim();
    if (!title || DROP.test(title) || DROP_STAFF.test(title)) continue;
    seen.add(sn);
    // 모집기간 칸 — 「시작 ~ 끝」 또는 끝이 없는 「시작 ~」. 칸(div) 단위로만 읽는다.
    // ⚠️ 행 전체 글자(`li.text`)에서 찾으면 안 된다 — 칸이 띄어쓰기 없이 이어 붙어
    // 조회수 「71」 + 「2026-09-01」 이 「712026-09-01」 이 되고 `\b` 경계가 깨져 날짜를 못 읽는다(hsbiz 실측 함정).
    const period = (li.querySelector("div.date_txt")?.text ?? "").replace(/\s+/g, " ").trim();
    const days = [...period.matchAll(YMD)].map(
      (m) => `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`,
    );
    const dateText = days.length >= 2 ? `${days[0]} ~ ${days[1]}` : days.length === 1 ? `${days[0]} ~` : "";
    out.push({
      title,
      detailUrl: `${BASE}${LIST}?schM=view&bizPbancSn=${sn}`,
      dateText,
      category: (li.querySelector("span.biz_tag")?.text ?? "").replace(/\s+/g, " ").trim(),
      // 이 게시판은 부천시 공고를 그대로 옮겨 싣는다(실측). 기관을 「부천산업진흥원」으로
      // 못 박으면 중복 판정 열쇠(제목+기관)가 달라져, 기업마당에 원 기관명으로 든 같은 공고와
      // 안 묶여 목록에 두 줄로 뜬다(적대 리뷰 중요). `div.date_txt` 안 첫 번째 `<p>` 에 실제 기관이 있다.
      agency:
        (li.querySelector("div.date_txt p")?.text ?? "").replace(/\s+/g, " ").trim() || "부천산업진흥원",
    });
  }
  return out;
}

export const bizbcConfig: BoardConfig = {
  id: "bizbc",
  label: "부천산업진흥원",
  agency: "부천산업진흥원",
  region: "경기",
  baseUrl: `${BASE}/`,
  charset: "utf-8",
  list: {
    url: (p) => `${BASE}${LIST}?page=${p}`,
    maxPages: 3,
    rowSelector: "ul.board_list li.tr",
    fields: {
      title: { selector: "div.board_tit a" },
      detailUrl: { selector: "div.board_tit a", attr: "onclick", regex: "fn_goView\\(\\s*'(\\d+)'\\s*\\)" },
      date: { selector: "div.date_txt" },
      category: { selector: "span.biz_tag" },
    },
  },
  customParse: parseBizbcList,
  detailContentSelector: "div.detail_contents",
  attachmentsScopeSelector: "div.detail_file",
  // 제목 거르개를 지난 뒤 한 쪽에 몇 건만 남을 수 있다. 0행이면 서식 변경이므로 2로 둔다.
  expectMinRows: 2,
};
