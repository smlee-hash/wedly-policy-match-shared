import { parseHtml } from "../html";
import type { BoardConfig, BoardRow } from "../types";

/**
 * 신용보증재단중앙회 알림마당 > 공지사항(bbsId=1031, mi=1026).
 *
 * 왜 연결했나(2026-09-03 실측): 공지 433건/44쪽. 최신 1·2쪽 20건 중 지원사업은
 * 멘토 매칭·물류 지원·차주 지원 안내 몇 건뿐이라 밀도는 낮다. 다만 그 글은
 * 기업마당이 안 싣는 중앙회 자체 안내라 수집기는 붙이고, 거르개가 알림톡·실태조사·
 * GBSI·우수사례 공모 같은 행정글을 걷어낸다.
 *
 * ★haedream(개인 채무자 서브사이트, bbsId=1053)은 Total 2건뿐이라 섞으면 안 된다.
 *
 * 구조: `div.bbs_ListA table tbody tr`. 제목이 `<a href>` 가 아니라
 * `<a href="javascript:" data-id="{nttSn}" class="nttInfoBtn">` 라서 상세 주소를 손으로 조립한다.
 * 쪽넘김은 사이트 JS 가 POST form 이지만, GET `?currPage=n` 도 같은 결과가 온다
 * (1·2·3쪽 첫 글 다름 실측). 한 쪽 10건 · 전체 약 44쪽. charset utf-8.
 * 목록은 **등록일만** 준다 — pipa 와 같이 「등록일 ~」 개시형.
 *
 * ★브라우저 UA 가 없으면 WAF 가 「Request Checked」 213바이트만 준다(실측).
 *   엔진이 이미 UA 를 붙인다.
 *
 * 헤더 tr 은 thead 에 있다. 실데이터 행만 `td.BD_tm_none`(번호·조회수) 값이 있다.
 */
const BASE = "https://www.koreg.or.kr";
const LIST = "/koreg/na/ntt/selectNttList.do";
const VIEW = "/koreg/na/ntt/selectNttInfo.do";
const MI = "1026";
const BBS = "1031";
const ROW = "div.bbs_ListA table tbody tr";
const YMD = /(20\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})/;
const BRACKET = /^\[([^\]]+)\]/;

/**
 * 지원사업이 아닌 글. **버릴 것만** 지정한다.
 * 실측 1·2쪽: 위기징후 알림톡 · GBSI 경기실사지수 · 실태조사 협조요청 · 우수사례 공모 ·
 * 선정결과 · 홈페이지 중단 · IT 유지보수 제안요청 · 업무제안 공모.
 * ★`채용` 을 통째로 버리면 안 된다 — 고용보조금은 제목에 「채용」을 쓴다(bizbc.ts 주석).
 */
const DROP =
  /알림톡|경기실사지수|GBSI|실태조사|협조\s*요청|우수사례\s*공모|수상자\s*발표|선정결과|홈페이지.{0,20}중단|서비스\s*중단|상근임원\s*초빙|개인정보\s*제공|제안요청|업무제안\s*공모|고객만족도\s*조사|입찰|설문|합격자/;
const DROP_STAFF = /평가위원|(?:신규|경력|직원)\s*채용\s*(?:공고|안내)|채용\s*공고/;

/**
 * 붙박이 공지 중 **1년 넘게 붙어 있는 것은 버린다**(koreaexim.ts 방식).
 * 실측 1·2쪽 번호 칸은 433…424 / 423…414 로 붙박이(「공지」)는 없다.
 */
const PINNED_MAX_AGE_MS = 365 * 24 * 3600_000;

/** 시험이 제목 글자만으로 거르개를 잴 수 있게 내보낸다. */
export function isKoregDropTitle(title: string): boolean {
  return DROP.test(title) || DROP_STAFF.test(title);
}

function agencyOf(title: string): string {
  const raw = title.match(BRACKET)?.[1]?.trim() ?? "";
  return raw || "신용보증재단중앙회";
}

export function parseKoregList(html: string, _page = 1, now = Date.now()): BoardRow[] {
  const out: BoardRow[] = [];
  const seen = new Set<string>();
  for (const tr of parseHtml(html).querySelectorAll(ROW)) {
    const a = tr.querySelector("td.bbs_tit a.nttInfoBtn") ?? tr.querySelector("a.nttInfoBtn");
    const id = (a?.getAttribute("data-id") ?? "").trim();
    if (!id || seen.has(id)) continue;
    const title = (a?.text ?? "").replace(/\s+/g, " ").trim();
    if (!title || isKoregDropTitle(title)) continue;
    /**
     * 등록일은 **3번째 td 칸을 직접** 집는다(번호|제목|등록일|조회수).
     * ⚠️ 행 전체 글자(`tr.text`)에서 찾으면 안 된다 — 번호 칸 「433」 + 「2026.08.10」이
     *    「4332026.08.10」로 붙는다(hsbiz 실측 함정).
     */
    const tds = tr.querySelectorAll("td");
    const dateCell = (tds[2]?.text ?? "").replace(/\s+/g, " ").trim();
    const d = dateCell.match(YMD);
    const ymd = d ? `${d[1]}-${d[2].padStart(2, "0")}-${d[3].padStart(2, "0")}` : "";
    const num = (tr.querySelector("td.BD_tm_none")?.text ?? "").replace(/\s+/g, " ").trim();
    const pinned = num === "공지" || (tr.getAttribute("class") ?? "").split(/\s+/).includes("notice");
    if (pinned && ymd && now - Date.parse(`${ymd}T00:00:00Z`) > PINNED_MAX_AGE_MS) {
      seen.add(id);
      continue;
    }
    seen.add(id);
    out.push({
      title,
      // ★currPage 는 쪽 번호라 주소에 넣으면 같은 글이 쪽마다 다른 줄로 저장된다.
      //   상세 열쇠는 nttSn + bbsId + mi 만.
      detailUrl: `${BASE}${VIEW}?nttSn=${id}&bbsId=${BBS}&mi=${MI}`,
      dateText: ymd ? `${ymd} ~` : "",
      category: "",
      agency: agencyOf(title),
    });
  }
  return out;
}

export const koregConfig: BoardConfig = {
  id: "koreg",
  label: "신용보증재단중앙회 공지",
  agency: "신용보증재단중앙회",
  region: "전국",
  baseUrl: `${BASE}/`,
  charset: "utf-8",
  list: {
    url: (p) => `${BASE}${LIST}?mi=${MI}&bbsId=${BBS}&currPage=${p}`,
    maxPages: 8,
    rowSelector: ROW,
    fields: {
      title: { selector: "td.bbs_tit a.nttInfoBtn" },
      detailUrl: { selector: "td.bbs_tit a.nttInfoBtn", attr: "data-id" },
      date: { selector: "td:nth-child(3)" },
    },
  },
  customParse: parseKoregList,
  /**
   * 상세 실측(2026-09-03 nttSn=16073): 본문은 `div.bbsV_cont`(신청기간·대상·방법).
   * 첨부 칸 `div.bbsV_atchmnfl` / `ul.bbsV_file` 은 이 글에선 비어 있으나 칸은 있다 —
   * 범위를 안 적으면 바닥 메뉴 링크를 첨부처럼 수확한다.
   */
  detailContentSelector: "div.bbsV_cont",
  attachmentsScopeSelector: "div.bbsV_atchmnfl",
  /**
   * 한 쪽 10건의 절반은 5 이지만, DROP 뒤 1쪽 실측이 2건이다. 5 로 두면 서식이 멀쩡한데도
   * 1쪽 관문이 거짓 실패한다. 0행이면 서식 변경이므로 2 로 둔다.
   */
  expectMinRows: 2,
};
