import { parseHtml } from "../html";
import type { BoardConfig, BoardRow } from "../types";

/**
 * 한국관광공사 관광기업지원(touraz) — 한국관광산업포털 TOURAZ 공고·공모.
 *
 * 왜 연결했나(2026-09-03 실측): knto.or.kr 자체 공고(bbsId=445271)는 7개월간 새 글이 없고,
 * 같은 부서(기업회의인센티브팀·중국팀·국민관광지원팀 등)의 참가기관 모집·공모는
 * touraz.kr `/announcementList`(기본 탭 「투어라즈 공모」)로 옮겨 2026-08-29까지 올라온다.
 *
 * 구조: 표가 아니라 `.board-card-wrap.public .board-card-body > ul > li > .inner` 카드.
 * 제목 `.card-body .subject > a` 의 href 가 상세(`/announcementList/pssrpView?pssrpSeqEnc=…`).
 * pssrpSeqEnc 는 쿠키 없이 열리지만 **요청마다 값이 바뀐다**(실측: 연속 2회 목록의 같은 글
 * enc 가 달랐고, 몇 시간 전 값도 seq 1707 같은 글로 열림). 목록 HTML 에 숫자 번호가 없어
 * 이 값을 상세 주소로 쓴다. `*`·`^` 는 이스케이프 없이 그대로 둔다.
 * 쪽넘김은 GET `curPage` + `cntPerPage=12` + `tabMode=ktoip`. 한 쪽 12건 · 전체 약 77쪽.
 * **신청기간을 목록에서 시작·끝 둘 다 준다** — dt 텍스트로 칸을 고른다(담당부서 dl 이 빠진
 * 카드가 있어 인덱스로 고정하면 안 된다). 신청기간이 없으면 등록일을 「등록일 ~」 개시형으로.
 */
const BASE = "https://touraz.kr";
const LIST = "/announcementList";
const VIEW = "/announcementList/pssrpView";
const ENC = /pssrpView\?pssrpSeqEnc=([^&]+)/;
const YMD = /(20\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})/g;
const ROW = ".board-card-wrap.public .board-card-body > ul > li > .inner";

/**
 * 지원사업이 아닌 글. **버릴 것만** 지정한다.
 * ★`채용` 을 통째로 버리면 안 된다(적대 리뷰 중요) — 고용보조금은 제목에 「채용」을 쓴다.
 *   기관이 사람을 뽑는 글(`직원 채용`·`채용 공고`)만 좁게 버리고 `채용 지원`은 살린다.
 */
const DROP = /입찰|설문|합격자|평가위원|(?:신규|경력|직원)\s*채용\s*(?:공고|안내)|채용\s*공고/;

export function isTourazDropTitle(title: string): boolean {
  return DROP.test(title);
}

function ymds(text: string): string[] {
  return [...text.matchAll(YMD)].map(
    (m) => `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`,
  );
}

/** dt 텍스트로 dd 칸을 고른다. 위치 인덱스로 고정하면 담당부서 없는 카드에서 등록일을 놓친다. */
function ddByDt(inner: { querySelectorAll: (s: string) => { querySelector: (s: string) => { text: string } | null }[] }, label: string): string {
  for (const dl of inner.querySelectorAll(".card-info dl")) {
    const dt = (dl.querySelector("dt")?.text ?? "").replace(/\s+/g, " ").trim();
    if (!dt.includes(label)) continue;
    return (dl.querySelector("dd")?.text ?? "").replace(/\s+/g, " ").trim();
  }
  return "";
}

function dateTextOf(inner: Parameters<typeof ddByDt>[0]): string {
  const period = ymds(ddByDt(inner, "신청기간"));
  if (period.length >= 2) return `${period[0]} ~ ${period[1]}`;
  if (period.length === 1) return `${period[0]} ~`;
  const registered = ymds(ddByDt(inner, "등록일"));
  return registered[0] ? `${registered[0]} ~` : "";
}

function detailUrlOf(href: string): string {
  const enc = href.replace(/&amp;/g, "&").match(ENC)?.[1] ?? "";
  return enc ? `${BASE}${VIEW}?pssrpSeqEnc=${enc}` : "";
}

function agencyOf(inner: { querySelector: (s: string) => { text: string } | null }): string {
  const noti = inner.querySelector(".cate .noti");
  const status = (inner.querySelector(".cate .category")?.text ?? "").replace(/\s+/g, " ").trim();
  let agency = (noti?.text ?? "").replace(/\s+/g, " ").trim();
  if (status) agency = agency.replace(status, "").trim();
  return agency || "한국관광공사";
}

export function parseTourazList(html: string, _page = 1): BoardRow[] {
  const out: BoardRow[] = [];
  const seen = new Set<string>();
  for (const inner of parseHtml(html).querySelectorAll(ROW)) {
    const a = inner.querySelector(".card-body .subject > a");
    const href = (a?.getAttribute("href") ?? "").trim();
    const detailUrl = detailUrlOf(href);
    if (!detailUrl || seen.has(detailUrl)) continue;
    const title = (a?.text ?? "").replace(/\s+/g, " ").trim();
    if (!title || DROP.test(title)) continue;
    seen.add(detailUrl);
    out.push({
      title,
      detailUrl,
      dateText: dateTextOf(inner),
      category: (inner.querySelector(".cate .category")?.text ?? "").replace(/\s+/g, " ").trim(),
      agency: agencyOf(inner),
    });
  }
  return out;
}

export const tourazConfig: BoardConfig = {
  id: "touraz",
  label: "한국관광공사 관광기업지원(touraz)",
  agency: "한국관광공사",
  region: "전국",
  baseUrl: `${BASE}/`,
  charset: "utf-8",
  list: {
    url: (p) => `${BASE}${LIST}?tabMode=ktoip&curPage=${p}&cntPerPage=12`,
    maxPages: 20,
    rowSelector: ROW,
    fields: {
      title: { selector: ".card-body .subject > a" },
      detailUrl: { selector: ".card-body .subject > a", attr: "href" },
      date: { selector: ".card-info" },
      category: { selector: ".cate .category" },
    },
  },
  customParse: parseTourazList,
  // 상세 실측(`/announcementList/pssrpView?pssrpSeqEnc=gceHXEN*FRnXmIAn6LDZGA==`, 2026-09-03):
  // 본문 `div.view-content:not(.hidden)`(사업설명 전문), 첨부 `div.trend-file-list-wrap`(`/comm/getFile`).
  // 같은 자리에 `div.view-content.hidden`(사전규격, 비어 있음)이 하나 더 있다.
  detailContentSelector: "div.view-content:not(.hidden)",
  attachmentsScopeSelector: "div.trend-file-list-wrap",
  dropUrlParams: ["tabMode", "cntPerPage"],
  // 한 쪽 12건. 거르개를 지나도 절반 미만이면 서식이 바뀐 것이다.
  expectMinRows: 6,
};
