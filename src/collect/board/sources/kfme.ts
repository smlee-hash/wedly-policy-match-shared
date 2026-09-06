import { absolutize, parseHtml } from "../html";
import type { BoardConfig, BoardRow } from "../types";

/**
 * 소상공인연합회 사업공지(`notice.php?cate=1`).
 *
 * 왜 연결했나(2026-09-06 실측): 협회가 한국자산관리공사·중기부 위탁으로 **직접 집행**하는
 * 소상공인 실지원(새출발 경영환경개선=간판 교체 · 배리어프리 키오스크 · 무료 법률·세무·노무
 * 간편상담 · 찾아가는 1:1 교육)이 여기서만 공고된다. 신청 창구도 협회 자체 양식·전화다.
 * robots 는 전체 허용(`User-agent: *` / `allow: /`) 이고 첨부는 쿠키·Referer 없이 GET 200 이다.
 *
 * 구조: `div.bbs-list-row` — 제목 `div.column.bbs-title > a > div.bbs-subject-con >
 * strong.bbs-subject-txt`, 상세 href `/kr/board/notice.php?bgu=view&idx=<번호>&cate=1`,
 * 등록일 `div.column.bbs-inline[data-label="등록일"]`(`YYYY-MM-DD`). 총 820건.
 * 쪽넘김은 **offset** 이다 — `startPage=0|10|20…`(쪽당 10행). 맨 위 고정 공지 8행
 * (`div.bbs-list-row.notice-row`)은 **쪽마다 되풀이**된다(2026-09-06 `startPage=10` 실측).
 *
 * ★고정 공지도 **제 등록일을 그대로** 낸다(sida 와 같은 판정). 날짜를 비우면 게시판 전체의
 *  날짜 검증을 꺼야 하고, 그러면 사이트가 칸을 하나 더했을 때 모든 행의 날짜가 빈 문자열이
 *  돼도 행 수만으로 통과한다. 옛 등록일(2022년 글 포함)은 저장 규칙(90일 개시형 마감)이 처리한다.
 *
 * ★제목 글자 앞에 `<span class="notice-tit">공지사항</span>` 딱지가 들어 있다 — 그 노드를
 *  떼지 않으면 모든 고정 공지 제목이 「공지사항 …」으로 저장돼 `dedupKey` 가 갈린다.
 */
const BASE = "https://www.kfme.or.kr";
const LIST = "/kr/board/notice.php";
/** 사업공지 탭. `cate=2` 는 일반공지(협회 살림 공지)라 안 읽는다. */
const CATE = "1";
/** 쪽당 행 수 = offset 증가폭(고정 공지 8행은 별도로 매 쪽 되풀이된다). */
const ROWS_PER_PAGE = 10;
const YMD = /(20\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})/;

/**
 * 지원사업이 아닌 글. **버릴 것만** 지정한다 — 실측 26건(2026-09-06 1쪽 18행 + 2쪽 새 10행)의
 * 제목 유형에서만 뽑았다: 회원 이벤트 · 정부포상 공개검증 · 슬로건 공모전 · 용역업체 선정결과 ·
 * 입찰공고 · 컨설턴트/코디네이터 모집(사람) · 협회 임원 선거 · 정치참여 안내 · 동참 안내 ·
 * 앱 설치 홍보 · 제재조치 · 결의대회.
 * ★`모집`·`교육` 을 통째로 버리지 않는다 — 「참가업체 모집 공고」·「1:1 교육사업 시행 공고」가
 *  이 판의 실수확이다.
 */
const DROP =
  /이벤트|포상|공개검증|공모전|수상작|최종투표|용역|입찰|컨설턴트\s*모집|코디네이터|양성과정|정치참여|동참\s*안내|회장\s*모집|채용|앱\s*설치|제재조치|결의대회|궐기대회/;

export function isKfmeDropTitle(title: string): boolean {
  return DROP.test(title);
}

export function parseKfmeList(html: string): BoardRow[] {
  const out: BoardRow[] = [];
  const seen = new Set<string>();
  for (const row of parseHtml(html).querySelectorAll("div.bbs-list-row")) {
    const a = row.querySelector("div.column.bbs-title > a");
    const href = (a?.getAttribute("href") ?? "").trim();
    if (!href || !href.includes("idx=")) continue;
    const strong = row.querySelector("strong.bbs-subject-txt");
    /**
     * 제목에서 딱지 노드(`span.notice-tit` = 「공지사항」)를 뺀다.
     * ★`strong.text` 를 그대로 쓰면 고정 공지 8건이 전부 「공지사항 …」으로 저장된다.
     */
    const tag = (strong?.querySelector("span.notice-tit")?.text ?? "").replace(/\s+/g, " ").trim();
    let title = (strong?.text ?? "").replace(/\s+/g, " ").trim();
    if (tag && title.startsWith(tag)) title = title.slice(tag.length).trim();
    if (!title || DROP.test(title)) continue;
    const idx = href.match(/[?&]idx=(\d+)/)?.[1] ?? "";
    const detailUrl = absolutize(href, `${BASE}/`);
    const key = idx || detailUrl;
    if (seen.has(key)) continue;
    seen.add(key);
    /**
     * 등록일은 **`[data-label="등록일"]` 칸을 직접** 집는다.
     * ⚠️ 행 전체 글자로도 지금 고정본에서는 같은 값이 나온다(2026-09-06 확인) — 다만 이 판은
     *    제목에 연도·기간이 자주 들어가(「2026 소상공인대회 …」) 서식이 조금만 바뀌어도 제목 쪽이
     *    먼저 걸린다. 칸은 `data-label` 로 고정돼 있어 칸을 집는다.
     */
    const dateCell = (row.querySelector('div.column[data-label="등록일"]')?.text ?? "")
      .replace(/\s+/g, " ")
      .trim();
    const d = dateCell.match(YMD);
    const ymd = d ? `${d[1]}-${d[2].padStart(2, "0")}-${d[3].padStart(2, "0")}` : "";
    out.push({
      title,
      detailUrl,
      dateText: ymd ? `${ymd} ~` : "",
      category: "",
      agency: "소상공인연합회",
    });
  }
  return out;
}

export const kfmeConfig: BoardConfig = {
  id: "kfme",
  label: "소상공인연합회",
  agency: "소상공인연합회",
  region: "전국",
  baseUrl: `${BASE}/`,
  charset: "utf-8",
  list: {
    // 쪽 번호가 아니라 **행 offset** 이다 — 1쪽=0, 2쪽=10, 3쪽=20.
    url: (p) => `${BASE}${LIST}?cate=${CATE}&startPage=${(Math.max(1, p) - 1) * ROWS_PER_PAGE}`,
    // 월 3~5건짜리 판이라 2쪽(고정 8 + 일반 20행)이면 최근 몇 달이 다 들어온다.
    maxPages: 2,
    rowSelector: "div.bbs-list-row",
    fields: {
      title: { selector: "strong.bbs-subject-txt" },
      detailUrl: { selector: "div.column.bbs-title > a", attr: "href" },
      date: { selector: 'div.column[data-label="등록일"]' },
    },
  },
  customParse: parseKfmeList,
  /**
   * ★추측 단계를 끈다. 목록 첨부 칸에 `bbs_download.php?download=1&idx=…` 링크가 행마다
   * 있어, 추측 단계가 그 파일을 공고로, 파일 이름을 제목으로 저장한다(수출입은행에서 겪은 갈래).
   */
  skipHeuristic: true,
  // 1쪽 18행(고정 8 + 일반 10)에서 DROP 뒤 실측 11건.
  expectMinRows: 5,
  detailContentSelector: "div.bbs-view-content.editor",
  /**
   * 첨부는 상세의 `aside.bbs-view-file-info-box` 안에만 있다
   * (`/bbs/bbs_download.php?idx=<글번호>&download=<순번>` · 쿠키·Referer 없이 GET 200 + HWP 실측).
   * 범위를 안 좁히면 목록 이동·이전글 링크와 본문에 붙은 이미지까지 훑는다.
   * ★`attachmentsScopeRequired` 는 켜지 않는다 — 첨부 없는 상세에도 이 상자가 있는지
   *  실물로 확인하지 못했다.
   */
  attachmentsScopeSelector: "aside.bbs-view-file-info-box",
  // 2026-09-06 실측: 미국(Railway) 차단·서울 경유 200 — 국내 경유 전용
  requiresProxy: true,
};
