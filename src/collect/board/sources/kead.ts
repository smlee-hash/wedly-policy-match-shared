import { parseHtml } from "../html";
import type { BoardConfig, BoardRow } from "../types";

/**
 * 한국장애인고용공단 부서 공지사항(`bbsCode=deptgongji`).
 *
 * 왜 연결했나(2026-09-06 실측): 장애인 표준사업장 인증·고용장려금·인식개선 교육 위탁기관
 * 공모처럼 **사업주 대상** 공고가 여기에만 올라온다(기업마당·고용24 목록에 같은 모양으로
 * 오지 않는다). 총 3,147건 / 315쪽, 최근 30일 35~38건. robots 는 `/bbs/`·`/cmm/fms/` 를
 * 막지 않는다. 목록·상세·첨부 전부 UTF-8 서버 렌더 + 쿠키 없는 GET.
 *
 * 구조: `table#bbsTable > tbody > tr` 10행 고정(`recordCountPerPage` 를 GET 으로 넘겨도
 * 무시된다 — 50 을 붙여도 10행 실측). 칸 = 번호 / 제목 / 담당부서 / 등록일 / 첨부 / 조회수.
 * 제목은 `a.view_link` 인데 **href 가 `javascript:void(0)`** 라 `onClick="…fn_bbsView('216000')"`
 * 의 번호로 상세 주소를 손으로 조립한다. 쪽넘김은 화면상 폼 submit 이지만
 * GET `?menuId=…&bbsCode=…&pageIndex=N` 이 그대로 돈다(2026-09-06 실측 2쪽 정상).
 *
 * ★거르개 없이는 못 쓴다 — 실측 20건(1·2쪽) 중 사업주 대상은 3건이고 나머지는 공단 자체
 *  채용공고·대회·행정예고다. 그래서 **머리표 + 낱말 DROP** 을 두고, 그 그물에 걸려도
 *  기업 공고임이 분명한 낱말(KEEP)이면 되살린다 — 지사가 올리는 참여기업 모집이 실제로 있다.
 */
const BASE = "https://www.kead.or.kr";
const LIST = "/bbs/deptgongji/bbsPage.do";
const VIEW = "/bbs/deptgongji/bbsView.do";
const MENU_ID = "MENU0895";
const BBS_CODE = "deptgongji";
const GO = /fn_bbsView\(\s*'(\d+)'\s*\)/;
const YMD = /(20\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})/;

/**
 * 공단 조직이 자기 이름으로 올리는 글의 머리표 — `[한국장애인고용공단 전남지사]` ·
 * `[경기남부직업능력개발원]` · `[한국장애인고용공단 경기지역본부]`(실측 20건 중 8건).
 * 이 머리표가 붙은 글은 사실상 전부 채용·행정 공지다.
 */
const ORG_PREFIX = /^\s*[[［【][^\]］】]*(?:지사|지역본부|직업능력개발원|공단)[^\]］】]*[\]］】]/;

/**
 * 지원 공고가 아닌 글. 실측 20건(2026-09-06 1·2쪽)의 제목 유형만 담는다 —
 * 채용·면접·합격자·청년인턴 / 공직박람회 / 공모전·수상작 / 인증취소 / 전국대회·선발전 /
 * 행정예고 / 입찰·매각·수의계약.
 * ★`모집` 을 통째로 버리지 않는다 — 「참여 기업 모집」이 이 판의 핵심 수확이다.
 * ★`인턴` 도 낱말째 버리지 않는다(2026-09-06 적대 리뷰) — 이 공단은 **장애인 인턴제·인턴십을
 *  사업주에게 지원하는 기관**이라, 통짜로 버리면 그 지원 공고가 함께 죽는다. 공단 자체 채용
 *  글의 실제 서식인 `(체험형) 청년인턴`·`인턴 채용`·`인턴 모집 공고` 만 버린다.
 */
const DROP =
  /채용|면접|합격자|(?:체험형\s*)?청년인턴|인턴\s*(?:채용|모집\s*공고)|공직박람회|공모전|수상작|인증취소|선발전|전국대회|행정예고|입찰|매각|수의계약|공개모집|공개초빙/;

/**
 * DROP 에 걸려도 **이 낱말이 있으면 살린다**. 지사가 올리는 참여기업 모집·장려금 안내가
 * 머리표 하나로 통째로 죽는 것을 막는 유일한 장치다(순서: KEEP → DROP).
 * 「표준사업장 인증 공고」는 **공고까지 붙여** 맞춘다 — 「표준사업장 인증취소 공고」를
 * 되살리지 않기 위해서다(실측 2쪽에 그 글이 있다).
 */
const KEEP =
  /표준사업장\s*인증\s*공고|장려금|위탁\s*수행기관\s*공모|(?:참여|참가)\s*기업\s*모집|지원\s*사업\s*(?:공모|모집|참여기업)|인턴제|인턴십\s*지원사업/;

export function isKeadDropTitle(title: string): boolean {
  if (KEEP.test(title)) return false;
  return ORG_PREFIX.test(title) || DROP.test(title);
}

export function parseKeadList(html: string): BoardRow[] {
  const out: BoardRow[] = [];
  const seen = new Set<string>();
  for (const tr of parseHtml(html).querySelectorAll("table#bbsTable > tbody > tr")) {
    const a = tr.querySelector("a.view_link");
    const id = (a?.getAttribute("onclick") ?? a?.getAttribute("onClick") ?? "").match(GO)?.[1] ?? "";
    if (!id || seen.has(id)) continue;
    const title = (a?.text ?? "").replace(/\s+/g, " ").trim();
    if (!title || isKeadDropTitle(title)) continue;
    seen.add(id);
    /**
     * 등록일은 **네 번째 칸을 직접** 집는다.
     * ⚠️ 행 전체 글자(`tr.text`)로도 지금 고정본에서는 같은 값이 나온다(2026-09-06 확인) —
     *    다만 제목에 날짜꼴이 들어간 공고(「2026-09-02 설명회 안내」)가 오면 그쪽이 먼저 걸린다.
     *    칸이 라벨로 고정돼 있으니 칸을 집는다(hsbiz 에서 번호+날짜가 붙어 터진 갈래와 같은 예방).
     */
    const dateCell = (tr.querySelector("td:nth-child(4)")?.text ?? "").replace(/\s+/g, " ").trim();
    const d = dateCell.match(YMD);
    const ymd = d ? `${d[1]}-${d[2].padStart(2, "0")}-${d[3].padStart(2, "0")}` : "";
    out.push({
      title,
      // 상세는 `pageIndex` 없이도 200 이다(2026-09-06 실측 233,675바이트) — 쪽 번호를 안 남긴다.
      detailUrl: `${BASE}${VIEW}?bbsCnId=${id}&menuId=${MENU_ID}&bbsCode=${BBS_CODE}`,
      dateText: ymd ? `${ymd} ~` : "",
      category: "",
      agency: "한국장애인고용공단",
    });
  }
  return out;
}

export const keadConfig: BoardConfig = {
  id: "kead",
  label: "한국장애인고용공단",
  agency: "한국장애인고용공단",
  region: "전국",
  baseUrl: `${BASE}/`,
  charset: "utf-8",
  list: {
    url: (p) => `${BASE}${LIST}?menuId=${MENU_ID}&bbsCode=${BBS_CODE}&pageIndex=${p}`,
    // 한 쪽 10행 고정 · 최근 30일 35~38건이라 4쪽이면 한 달을 덮는다.
    maxPages: 4,
    rowSelector: "table#bbsTable > tbody > tr",
    fields: {
      title: { selector: "a.view_link" },
      detailUrl: { selector: "a.view_link", attr: "onclick", regex: "fn_bbsView\\(\\s*'(\\d+)'\\s*\\)" },
      date: { selector: "td:nth-child(4)" },
    },
  },
  customParse: parseKeadList,
  /**
   * 4쪽까지 **무조건** 돈다. 거르개 뒤 한 쪽에 0~2건이라 기본값 2 로 두면 남는 게 없는 쪽 둘이
   * 나란히 오는 것만으로 뒷쪽을 통째로 잃는다(수출바우처에서 겪은 갈래).
   * ⚠️알려진 한계: 4쪽이 **전부 0행**인 회차는 1쪽 검증이 「행 0개」로 떨어져 그 회차 출처 자체가
   *  실패로 기록된다(다음 회차에 새 글이 오면 저절로 복구된다). 밀도 0.17 짜리 판을 최소 행수
   *  없이 붙이는 대가이며, 지금 고정본에서는 1쪽 2건·2쪽 1건으로 그런 회차가 안 나왔다.
   */
  emptyStreakStop: 4,
  /**
   * ★추측 단계를 끈다. 제목 href 가 전부 `javascript:void(0);` 인데다 **목록 칸에 첨부 링크가
   * 그대로 노출**돼 있어(`/cmm/fms/downloadDirect.do?key=…` · 한 행에 3개까지), 추측 단계가
   * 그 파일 링크를 공고로, 파일 이름을 제목으로 저장한다(수출입은행에서 겪은 갈래).
   */
  skipHeuristic: true,
  /**
   * ★`expectMinRows` 를 두지 않는다. 이 판은 사업주 대상 비율이 0.17 이라 거르개를 지나면
   *  한 쪽에 1~2건만 남는다(실측 1쪽 2건 · 2쪽 1건). 최소 행수를 걸면 조용한 주에 출처
   *  전체가 실패로 떨어진다. 서식이 깨지면 「행 0개」 검증이 그대로 잡는다.
   */
  /**
   * 본문은 한두 문장뿐이다(고정본 실측 67자 — 「…붙임과 같이 공고합니다.」).
   * 마감·신청자격은 **첨부 공고문**에만 있고, 그 채움은 첨부 단계(`fetchAttachmentTexts`)가 한다 —
   * 본문 선택자를 넓혀도 얻을 것이 없어 그대로 둔다(2026-09-06 적대 리뷰 확인).
   */
  detailContentSelector: "article.board_view .data_cnt_body .main_text",
  /**
   * 첨부는 상세의 `ul.file_list` 안에만 있다(`/cmm/fms/downloadDirect.do?key=…` · 세션·Referer
   * 없이 GET 200 + PDF 실측). 범위를 안 좁히면 바닥의 이전·다음 글 링크까지 훑는다.
   * ★`attachmentsScopeRequired` 는 켜지 않는다 — 첨부 없는 상세에도 이 상자가 있는지
   *  실물로 확인하지 못했다(고정본이 첨부 1건짜리 한 장뿐).
   */
  attachmentsScopeSelector: "ul.file_list",
};
