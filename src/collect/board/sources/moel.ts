import { absolutize, parseHtml } from "../html";
import type { BoardConfig, BoardRow } from "../types";

/**
 * 고용노동부 공지사항(`/news/notice`).
 *
 * 왜 연결했나(2026-09-06 실측): 청년일자리 강소기업 선정·일터혁신 우수기업·장애인고용
 * 우수사업주처럼 **부처가 직접 내는 기업 인정·선정 공고**가 여기에 뜬다. robots 는 `/news/` 를
 * 막지 않는다(금지 목록은 `/info/defaulter/`·`/portal/`·`/v2024/` 등). 목록·상세·첨부 전부
 * 서버 렌더 + 쿠키 없는 GET 이고 첨부는 `Content-Disposition` 이 붙어 그대로 떨어진다.
 *
 * 구조: `div.board_list > table.tstyle_list > tbody > tr`. 칸 = 번호 / 제목 / 담당부서 / 첨부 /
 * 등록일 / 조회. 제목은 `td.txt_left strong.b_tit a[href^="/news/notice/noticeView.do?bbs_seq="]`
 * 이고 **잘리지 않은 전체 제목이 `title` 속성**에 있다(앵커 안 글자에는 `[공고]` 같은 구분
 * 딱지가 앞에 붙는다). 등록일은 `td[aria-label="등록일"]` `YYYY.MM.DD`.
 * 쪽 크기 변수 `pageUnit` 이 **먹는다**(50 실측) — 한 쪽 50행이면 1쪽이 46일을 덮는다.
 *
 * ★거르개 5단이 이 판의 전부다. 실측 50건 중 기업 대상은 6~8건(0.12~0.16)이고 나머지는
 *  ①정책연구과제 입찰·사전규격·우선협상 ②공무원·임원 채용/공개초빙 ③정부포상·공개검증
 *  ④행정예고·개정(안)·등록폐지 ⑤결과·현황·결정사항 공고다.
 *  ⓐ **「재공고」를 통째로 버리지 않는다** — 조사 메모의 제안에는 있었지만, 실측에서 「재공고」는
 *     전부 「입찰 재공고」라 `입찰` 하나로 잡힌다. 낱말째 버리면 지원사업 재공고가 함께 죽는다.
 *  ⓑ **「채용」에 걸린 글을 KEEP 이 되살린다** — 「채용문화 우수기업 어워즈 … 참가기업 모집
 *     공고」가 실측에 있다. 거르개 순서를 뒤집으면 이 공고가 사라진다.
 *  ⓒ 2쪽 고정본(2026-09-06)에서 새로 드러난 유형을 더했다 — 입법예고·일부개정령(안)·
 *     「공개 모집」(띄어쓰기)·공표·경진대회·우수제안.
 * ⚠️알려진 새는 구멍: 「… 참여 지방자치단체 추가 공모」·「… 지원사업 참여 지방정부 추가 공모」는
 *  대상이 **지자체**인데 KEEP 의 `지원사업 참여` 에 걸려 남는다(2쪽 실측 2건). 제목만으로는
 *  기업 공모와 못 가르고, KEEP 을 줄이면 진짜 지원사업이 죽어서 이번엔 그대로 둔다.
 */
const BASE = "https://www.moel.go.kr";
const LIST = "/news/notice/noticeList.do";
/** 한 쪽에 담을 행 수. 50 이 먹는 것을 실측했다(200 / 299,711바이트 · 46일치). */
const PAGE_UNIT = 50;
const YMD = /(20\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})/;

/**
 * 지원 공고가 아닌 글. **버릴 것만** 지정한다 — 실측 50건(2026-09-06 `pageUnit=50` 1쪽)의
 * 제목 유형에서만 뽑았다.
 */
const DROP =
  /입찰|사전규격|우선협상|낙찰|용역|채용|공개\s*모집|공개초빙|경력경쟁|임용|합격자|면접|포상|유공|공개검증|수상자|수상작|공모전|경진대회|우수제안|행정예고|입법예고|일부개정(?:령)?\s*\(?안\)?|제(?:정|개정)\s*\(안\)|등록폐지|공시송달|공표|선정취소|선정\s*결과|결과\s*공고|현황\s*공고|결정사항|사용금지|명단|제3자\s*제공|이의신청/;

/**
 * DROP 에 걸려도 **이 낱말이 있으면 살린다**(순서: KEEP → DROP).
 * 실측 근거: 「2026년 채용문화 우수기업 어워즈(구. 공정채용 우수기업 어워즈) 참가기업 모집 공고」가
 * `채용` 으로 죽는다 — 이 판에서 놓치면 안 되는 여섯 건 중 하나다.
 *
 * ★2026-09-06 적대 리뷰로 **넓힌 것 셋**(DROP 5단이 기업 지원까지 먹던 자리):
 *  · `장려금|지원금` — 고용장려금·특별지원금 공고가 「지원금 지급 결과」류 낱말과 겹쳐 죽었다.
 *  · `우수기업\s*포상|우수사업장` — 「납품대금 연동 우수기업 포상 모집 공고」가 `포상` 에 걸렸다.
 *  · `지원\s*사업[^\s]*\s*(?:공모|모집|참여)` — 사업명 뒤에 괄호가 붙는 실제 서식
 *    (「지원사업(환경개선) 모집 공고」)을 예전 `지원사업\s*모집` 이 못 받았다.
 */
const KEEP =
  /(?:참여|참가)\s*기업\s*모집|우수기업\s*(?:선정|어워즈|포상)|우수사업주|우수사업장|강소기업\s*선정\s*신청|지원\s*사업[^\s]*\s*(?:공모|모집|참여)|장려금|지원금/;

export function isMoelDropTitle(title: string): boolean {
  if (KEEP.test(title)) return false;
  return DROP.test(title);
}

/**
 * 제목 앞 구분 딱지(`[공고]`·`[알림]`)를 뗀다.
 *
 * 왜: 같은 사업을 고용24·기업마당은 딱지 없이 올린다 — 저장 쪽 `dedupKey`(제목+기관 정규화)가
 * 대괄호는 지우지만 **낱말 「공고」는 남겨** 제목 자체가 달라진다(kodma 와 같은 갈래).
 * ★거르개는 **원문 제목**에 먼저 건다 — 딱지 자체가 판정 근거가 되는 날을 대비한다.
 */
const TITLE_PREFIX = /^\s*[[［【]\s*(?:공고|알림|공지|안내)\s*[\]］】]\s*/;

export function stripMoelTitlePrefix(title: string): string {
  return title.replace(TITLE_PREFIX, "").trim();
}

export function parseMoelList(html: string): BoardRow[] {
  const out: BoardRow[] = [];
  const seen = new Set<string>();
  for (const tr of parseHtml(html).querySelectorAll("div.board_list > table.tstyle_list > tbody > tr")) {
    const a = tr.querySelector("td.txt_left strong.b_tit a");
    const href = (a?.getAttribute("href") ?? "").trim();
    if (!href || !href.includes("bbs_seq=")) continue;
    /**
     * 제목은 **`title` 속성을 먼저** 쓴다 — 앵커 안 글자에는 구분 딱지(`[공고]`)가 텍스트
     * 노드로 붙어 있고, 화면은 `class="ellipsis"` 로 잘라 보여 준다. 속성이 없으면 글자로 되돌린다.
     */
    const raw = ((a?.getAttribute("title") ?? "") || (a?.text ?? "")).replace(/\s+/g, " ").trim();
    if (!raw || isMoelDropTitle(raw)) continue;
    const title = stripMoelTitlePrefix(raw);
    if (!title) continue;
    const seq = href.match(/[?&]bbs_seq=(\d+)/)?.[1] ?? "";
    const detailUrl = absolutize(href, `${BASE}/`);
    const key = seq || detailUrl;
    if (seen.has(key)) continue;
    seen.add(key);
    /**
     * 등록일은 **`td[aria-label="등록일"]` 칸을 직접** 집는다.
     * ⚠️ 행 전체 글자로도 지금 고정본에서는 같은 값이 나온다(2026-09-06 확인) — 다만 제목에
     *    날짜꼴(「2026.09.30까지」)이 든 공고가 오면 그쪽이 먼저 걸린다. 칸은 `aria-label` 로
     *    고정돼 있어 칸을 집는 편이 안전하다.
     */
    const dateCell = (tr.querySelector('td[aria-label="등록일"]')?.text ?? "").replace(/\s+/g, " ").trim();
    const d = dateCell.match(YMD);
    const ymd = d ? `${d[1]}-${d[2].padStart(2, "0")}-${d[3].padStart(2, "0")}` : "";
    out.push({
      title,
      detailUrl,
      dateText: ymd ? `${ymd} ~` : "",
      category: "",
      agency: "고용노동부",
    });
  }
  return out;
}

export const moelConfig: BoardConfig = {
  id: "moel",
  label: "고용노동부",
  agency: "고용노동부",
  region: "전국",
  baseUrl: `${BASE}/`,
  charset: "utf-8",
  list: {
    url: (p) => `${BASE}${LIST}?pageIndex=${p}&pageUnit=${PAGE_UNIT}`,
    // 한 쪽 50행이 46일을 덮는다 — 두 쪽이면 최근 30일에 넉넉하다.
    maxPages: 2,
    rowSelector: "div.board_list > table.tstyle_list > tbody > tr",
    fields: {
      title: { selector: "td.txt_left strong.b_tit a" },
      detailUrl: { selector: "td.txt_left strong.b_tit a", attr: "href" },
      date: { selector: 'td[aria-label="등록일"]' },
    },
  },
  customParse: parseMoelList,
  /**
   * ★추측 단계를 끈다. 목록 첨부 칸에 `/common/downloadAllZip.do?bbs_seq=…` 링크가 행마다
   * 있어, 추측 단계가 그 묶음 파일을 공고로 저장한다 — 그 줄은 다음 회차에 지워지지 않는다.
   */
  skipHeuristic: true,
  // 50행에서 DROP 뒤 실측 8건. 서식이 바뀌면(칸 순서·aria-label 변경) 여기서 끊긴다.
  expectMinRows: 3,
  detailContentSelector: "div.b_content",
  /**
   * 첨부는 상세의 `div.file ul.list` 안에만 있다. 한 파일에 앵커가 둘(이름 링크 + 「다운로드」
   * 버튼)이지만 주소가 같아 수확기가 접는다 — 이름 링크가 먼저라 파일 이름이 남는다.
   * ★`attachmentsScopeRequired` 는 켜지 않는다 — 첨부 없는 상세에도 `div.file` 이 있는지
   *  실물로 확인하지 못했다.
   */
  attachmentsScopeSelector: "div.file ul.list",
};
