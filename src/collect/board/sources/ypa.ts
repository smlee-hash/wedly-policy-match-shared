import { parseHtml } from "../html";
import type { BoardConfig, BoardRow } from "../types";

/**
 * 용인시산업진흥원 지원사업 공고(용인기업지원시스템).
 *
 * 게시판은 메인 ypa.or.kr 이 아니라 서브시스템 `ybs.ypa.or.kr` 이다(실측 2026-09-03).
 * 목록 GET `?pageIndex=n` · 한 쪽 10건 · 전체 약 38쪽. charset 은 활성 태그가 utf-8
 * (원문에 euc-kr 주석이 남아 있어 grep 함정). 브라우저 UA·쿠키 없이 200.
 *
 * 구조: `ul.boardBox > li`. 제목이 `<a href>` 가 아니라
 * `<a onclick="javascript:fn_viewDetail('RGS_…')">` 라서 상세 주소를 손으로 조립한다.
 * 상세 경로의 `poratl` 은 사이트 오타 그대로다.
 * **모집기간을 목록에서 시작·끝 둘 다 준다** (`p.date_box > span` 통짜 「시작 ~ 종료」).
 *
 * 붙박이 공지 칸이 없다(1·2쪽 고정본 글번호 겹침 0). 기간이 있어 묵은 글은 마감일로 닫힌다.
 */
const BASE = "https://ybs.ypa.or.kr";
const LIST = "/application.do";
const DETAIL = "/poratlAppFormDtl.do";
const REGNO = /fn_viewDetail\(\s*'([A-Za-z0-9_]+)'\s*\)/;
const YMD = /(20\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})/g;

/**
 * 지원사업이 아닌 글.
 * ★`채용` 을 통째로 버리면 안 된다 — 고용보조금은 제목에 「채용」을 쓴다.
 *   고정본에 「용인시 반도체 기업 채용 연계 지원 안내」가 있다.
 */
const DROP = /입찰|설문|합격자/;
const DROP_STAFF = /평가위원|(?:신규|경력|직원)\s*채용\s*(?:공고|안내)|채용\s*공고/;

export function parseYpaList(html: string): BoardRow[] {
  const out: BoardRow[] = [];
  const seen = new Set<string>();
  for (const li of parseHtml(html).querySelectorAll("ul.boardBox > li")) {
    const a = li.querySelector("a");
    const regno = (a?.getAttribute("onclick") ?? "").match(REGNO)?.[1] ?? "";
    if (!regno || seen.has(regno)) continue;
    const title = (li.querySelector("strong.pjtit")?.text ?? "").replace(/\s+/g, " ").trim();
    if (!title || DROP.test(title) || DROP_STAFF.test(title)) continue;
    seen.add(regno);
    // 모집기간 칸 — 「시작 ~ 끝」. 칸(span) 단위로만 읽는다.
    // ⚠️ 행 전체 글자(`li.text`)에서 찾으면 안 된다 — 칸이 띄어쓰기 없이 이어 붙어
    // 조회수 + 날짜가 「712026-09-01」 이 되고 `\b` 경계가 깨진다(hsbiz 실측 함정).
    const period = (li.querySelector("p.date_box > span")?.text ?? "").replace(/\s+/g, " ").trim();
    const days = [...period.matchAll(YMD)].map(
      (m) => `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`,
    );
    const dateText = days.length >= 2 ? `${days[0]} ~ ${days[1]}` : days.length === 1 ? `${days[0]} ~` : "";
    out.push({
      title,
      detailUrl: `${BASE}${DETAIL}?regNo=${regno}`,
      dateText,
      category: (li.querySelector("span.linebox")?.text ?? "").replace(/\s+/g, " ").trim(),
    });
  }
  return out;
}

export const ypaConfig: BoardConfig = {
  id: "ypa",
  label: "용인시산업진흥원",
  agency: "용인시산업진흥원",
  region: "경기",
  baseUrl: `${BASE}/`,
  charset: "utf-8",
  list: {
    url: (p) => `${BASE}${LIST}?pageIndex=${p}`,
    maxPages: 20,
    rowSelector: "ul.boardBox > li",
    fields: {
      title: { selector: "strong.pjtit" },
      detailUrl: {
        selector: "a",
        attr: "onclick",
        regex: "fn_viewDetail\\(\\s*'([A-Za-z0-9_]+)'\\s*\\)",
      },
      date: { selector: "p.date_box > span" },
      category: { selector: "span.linebox" },
    },
  },
  customParse: parseYpaList,
  // 상세 고정본(poratlAppFormDtl.do?regNo=RGS_…0662): 본문은 첨부 상자 아래 `div.mb50`,
  // 첨부 링크는 `div.appFileDiv` 안 `fn_egov_downFile`.
  detailContentSelector: "section.py-5 div.mb50",
  attachmentsScopeSelector: "div.appFileDiv",
  expectMinRows: 5,
};
