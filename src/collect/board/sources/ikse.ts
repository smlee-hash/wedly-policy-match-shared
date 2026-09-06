import { parseHtml } from "../html";
import type { BoardConfig, BoardRow } from "../types";

/**
 * 익산시 사회적경제지원센터 공지사항(`bo_id=notice`).
 *
 * 왜 연결했나(2026-09-06 실측): 익산시 산하로 확인되는 기업지원 성격 기관은 이 한 곳이다
 * (「익산시 사회적경제 육성·지원에 관한 조례」 근거). 대상이 **사회적경제조직**(사회적기업·
 * 예비사회적기업·마을기업)으로 좁고 총 1,600건 중 최근 30일 1건일 만큼 얇지만, 「익산형
 * 사회적기업가 육성사업」처럼 익산 고유 건이 실재한다.
 * ★익산에 있는 `foodpolis.kr`(한국식품산업클러스터진흥원)는 **익산시 산하가 아니다** —
 *   국가 단위 진흥원이라 이 출처와 무관하고 별도 정찰 대상이다(혼동 주의).
 *
 * robots(실측): `Disallow: /core/ /data/ /synergy/ /myadmin/` 넷뿐이라 우리가 쓰는
 * `/bbs/board.php`(목록·상세)와 `/bbs/download.php`(첨부)는 허용 범위다. 단 **본문 안 이미지는
 * `/data/` 아래**라 금지 대상이니 이미지 원본은 긁지 않는다(우리는 글자·첨부만 쓴다).
 *
 * 구조: 표가 아니라 목록 div 다. `div.board_list > ul.content_wrap` 안에서 **`<a>` 가 `<li>` 를
 * 통째로 감싸는** 비표준 구조라 「tr 단위」 파싱이 안 된다 — 행 = `ul.content_wrap > a`.
 * 번호·공지아이콘 `p.no`, 제목 `p.tit0`, 작성일 `p.date`(두 자리 연도 `26-08-26`),
 * 조회 `p.hit`, 모바일용 중복 요약 `p.minfo`. 쪽 변수 `page`, 한 쪽 16행. charset utf-8.
 */
const BASE = "https://www.ikse.or.kr";
const LIST = "/bbs/board.php";
const BOARD = "notice";
const ROW = "div.board_list ul.content_wrap > a";
const WR_ID = /[?&]wr_id=(\d+)/;
/** 목록 작성일은 **두 자리 연도**다(`26-08-26`) — 상세는 네 자리(`2026-08-03 13:47:13`). */
const YY_MD = /^(\d{2})-(\d{1,2})-(\d{1,2})$/;

/**
 * 지원사업이 아닌 글. **버릴 것만** 지정한다.
 * 실측 1쪽 16건에서 걸리는 것 일곱: 마을기업 설립 전(입문) 교육 3건 · 사회적경제 아카데미 ·
 * 창업상담매뉴얼 공개 · 인턴 모집 · 육성사업 「선정 기업(팀)」 결과 공고.
 * ★`교육` 을 통째로 버리지 않는다 — 「경영 안정화 교육지원 사업」처럼 교육비를 대 주는
 *   지원사업이 제목에 「교육」을 쓴다. 「(입문)교육」·「교육 N차 운영」·「교육 안내」만 좁게 버린다.
 */
const DROP =
  /입문\)?\s*교육|교육\s*\d+차\s*운영|교육\s*운영\s*안내|아카데미|매뉴얼|인턴\s*모집|선정\s*기업|선정\s*결과|결과\s*발표|합격자|입찰\s*공고|낙찰|평가위원|(?:신규|경력|직원)\s*채용\s*(?:공고|안내)/;

/** 시험이 제목 글자만으로 거르개를 잴 수 있게 내보낸다. */
export function isIkseDropTitle(title: string): boolean {
  return DROP.test(title);
}

/** 붙박이 공지 중 **1년 넘게 붙어 있는 것은 버린다**(실측: 2020-10-26 짜리가 아직 위에 있다). */
const PINNED_MAX_AGE_MS = 365 * 24 * 3600_000;

/** `26-08-26` → `2026-08-26`. 두 자리 연도는 2000년대로만 편다(이 게시판 최고령이 2020년). */
export function ikseYmd(text: string): string {
  const m = text.trim().match(YY_MD);
  if (!m) return "";
  return `20${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
}

export function parseIkseList(html: string, _page = 1, now = Date.now()): BoardRow[] {
  const out: BoardRow[] = [];
  const seen = new Set<string>();
  for (const a of parseHtml(html).querySelectorAll(ROW)) {
    const id = (a.getAttribute("href") ?? "").match(WR_ID)?.[1] ?? "";
    if (!id || seen.has(id)) continue;
    /**
     * 제목은 `p.tit0` **칸만** 집는다. 행 전체 글자를 쓰면 `p.minfo`(「관리자 / 26-08-26 / 조회 4」)가
     * 제목 뒤에 그대로 붙는다 — 그 글자가 곧 중복 판정 열쇠(제목+기관)라 조회수가 바뀔 때마다
     * 같은 공고가 새 줄이 된다.
     */
    const title = (a.querySelector("p.tit0")?.text ?? "").replace(/\s+/g, " ").trim();
    if (!title || DROP.test(title)) continue;
    const ymd = ikseYmd((a.querySelector("p.date")?.text ?? "").replace(/\s+/g, " ").trim());
    // 붙박이 공지는 번호 대신 공지 아이콘(img)이 들어간다.
    const pinned = !!a.querySelector("p.no img");
    if (pinned && ymd && now - Date.parse(`${ymd}T00:00:00Z`) > PINNED_MAX_AGE_MS) {
      seen.add(id);
      continue;
    }
    seen.add(id);
    out.push({
      title,
      // ★page 는 넣지 않는다 — 주소가 곧 중복 판정 열쇠(sourceId)다.
      detailUrl: `${BASE}${LIST}?bo_id=${BOARD}&wr_id=${id}`,
      // 목록은 등록일만 준다 — 개시형(`YYYY-MM-DD ~`)으로 담는다.
      dateText: ymd ? `${ymd} ~` : "",
      category: "사회적경제",
      agency: "익산시 사회적경제지원센터",
    });
  }
  return out;
}

export const ikseConfig: BoardConfig = {
  id: "ikse",
  label: "익산시 사회적경제지원센터",
  agency: "익산시 사회적경제지원센터",
  region: "전북",
  baseUrl: `${BASE}/`,
  charset: "utf-8",
  list: {
    url: (p) => `${BASE}${LIST}?bo_id=${BOARD}&page=${p}`,
    // 총 100쪽이지만 월 2~3건짜리 판이다 — 앞 3쪽(48건)이 여러 해를 덮는다.
    maxPages: 3,
    rowSelector: ROW,
    fields: {
      title: { selector: "p.tit0" },
      // 행 자체가 `<a>` 다 — selector 를 비우면 행 원소에서 바로 속성을 읽는다(`layers/selector.ts`).
      detailUrl: { attr: "href" },
      date: { selector: "p.date" },
    },
  },
  customParse: parseIkseList,
  /**
   * 상세 실측(wr_id=2638): 본문 `div.view_content`(한글 붙여넣기 HTML 전문), 첨부 상자 `ul.view_file`.
   * ★첨부 주소는 `href` 에 없다 — `href="javascript:;"` 이고 진짜 주소는
   *   `onclick="file_download('…/download.php?…')"` 안에 있다. 수확기(`detail-fill.ts`)의
   *   **P2 w5 갈래**(`www.ikse.or.kr` 한정)가 그 인자를 꺼내 준다. 그 갈래가 없으면 첨부 0건이다.
   */
  detailContentSelector: "div.view_content",
  attachmentsScopeSelector: "ul.view_file",
  /**
   * ★첨부는 **상세 세션 + Referer 가 있어야** 내려온다(2026-09-06 실측, wr_id=2638&no=3):
   * · 맨손 GET → 200 인데 75바이트 `<script>alert("값을 제대로 넘겨주세요.");history.go(-1);</script>`
   * · 상세를 먼저 열어 받은 쿠키(PHPSESSID·rtk) + `Referer: <상세 주소>` 를 붙이면 → 200 +
   *   `content-disposition: attachment; filename="…공고최종.hwpx"` + 188,387바이트
   * `rtk` 쿠키는 만료가 1시간이라(Expires 헤더 실측) 세션을 오래 재사용하면 안 된다 —
   * 엔진은 공고 한 줄마다 데우므로 그 조건을 이미 만족한다.
   */
  attachmentSession: { warmup: "detail", referer: "detail" },
  /**
   * ★추측 단계를 끈다. 이 목록은 `<a>` 가 `<li>` 를 감싸는 비표준 구조라 추측 단계가
   * 메뉴·바닥글 링크를 공고로 저장하기 쉽고, 그 줄은 다음 회차에 지워지지 않는다.
   */
  skipHeuristic: true,
  // 1쪽 16행에서 DROP 7건을 뺀 실측 9건. 절반을 하한으로.
  expectMinRows: 4,
  // 2026-09-06 실측: 미국·서울 VM 둘 다 차단(데이터센터 IP) — 명부 blocked, 풀리면 자동 복귀
  requiresProxy: true,
};
