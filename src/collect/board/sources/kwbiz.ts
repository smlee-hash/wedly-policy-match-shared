import { parseHtml } from "../html";
import type { BoardConfig, BoardRow } from "../types";

/**
 * 한국여성경제인협회 공지사항(`/notice`).
 *
 * 왜 연결했나(2026-09-06 실측): 여성기업 전용 판로·교육·상담회 모집이 본회 + 15개 지회
 * 몫으로 한 판에 올라온다 — 실측 10건 중 9건이 기업 대상(브릿G마켓 참여기업 모집 · 구매상담회
 * 참여기업 모집 · 전시회 지원 참여기업 모집 · 여성CEO비즈니스아카데미 참가자 모집).
 * 총 331건 / 34쪽, 월 8~10건. robots 는 `/admin` 만 막는다. 첨부는 쿠키·Referer 없이 GET 200.
 *
 * 구조: `div.board_list table tbody tr` — 제목 `td.td_sub.tal > a`, 작성일 `td.td_date`
 * (`YYYY/MM/DD`), 첨부 유무는 `img[src="/assets/img/ico_att.png"]`. 쪽넘김은 GET
 * `?pageIndex=<n>&categoryId=notice`(폼 method=GET).
 *
 * ★상세 링크가 `href="javascript:goDetail('BOARD_000002480');"` 라 **번호로 손수 조립**한다 —
 *  실주소는 `GET /notice/<BOARD_ID>` 다(홈 화면이 그 평문 링크를 그대로 쓰고, 2026-09-06
 *  curl 실측 200 / 170,596바이트).
 */
const BASE = "https://www.kwbiz.or.kr";
const LIST = "/notice";
const GO = /goDetail\(\s*'([A-Za-z0-9_]+)'\s*\)/;
const YMD = /(20\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})/;

/**
 * 지원사업이 아닌 글 — 실측 4유형(협회 직원 채용 · 협회 발주 용역 입찰 · 유공자 포상 ·
 * 사칭 보이스피싱 안내). **버릴 것만** 지정한다.
 * ★`채용` 을 통째로 버릴 수 없어 아래 KEEP 을 함께 둔다 — 고용보조금 공고가 제목에
 *  「채용」을 쓰는 게시판이 있다(cwip 에서 겪은 갈래).
 */
const DROP =
  /채용|공개모집|공개초빙|용역|입찰|포상|유공|사칭|보이스피싱|공모전|수상작|평가위원|심사위원|비상임이사/;

/**
 * DROP 에 걸려도 **이 낱말이 있으면 살린다**(순서: KEEP → DROP).
 *
 * ★2026-09-06 적대 리뷰 반영 — 예전 KEEP 의 `모집\s*공고`·`설명회`·`상담회` 를 뺐다.
 *  그 낱말들은 **대상이 사람인 글까지 되살렸다**: 「비상임이사 공개모집 공고」·
 *  「평가위원 모집 공고」가 `모집 공고` 하나로 DROP 을 통째로 무력화했다(리뷰 corpus 44건 실측).
 *  지금은 **대상이 기업임이 제목에 드러나는 꼴**만 받는다.
 * ⚠️대가: 「여성기업 신규 채용 지원사업」처럼 대상만 적히고 모집꼴이 없는 제목은 `지원사업`
 *  하나로만 살아난다 — 그 낱말까지 빼면 고용보조금류 공고가 `채용` 에 걸려 죽는다(cwip 갈래).
 */
const KEEP = /(?:참여|참가)\s*(?:기업|사)\s*모집|여성기업\s*(?:모집|지원)|지원사업/;

export function isKwbizDropTitle(title: string): boolean {
  if (KEEP.test(title)) return false;
  return DROP.test(title);
}

export function parseKwbizList(html: string): BoardRow[] {
  const out: BoardRow[] = [];
  const seen = new Set<string>();
  for (const tr of parseHtml(html).querySelectorAll("div.board_list table tbody tr")) {
    const a = tr.querySelector("td.td_sub.tal > a");
    const id = (a?.getAttribute("href") ?? "").match(GO)?.[1] ?? "";
    if (!id || seen.has(id)) continue;
    const title = (a?.text ?? "").replace(/\s+/g, " ").trim();
    if (!title || isKwbizDropTitle(title)) continue;
    seen.add(id);
    /**
     * 작성일은 **`td.td_date` 칸을 직접** 집는다.
     * ⚠️ 한 행이 같은 날짜를 **두 번** 싣는다 — 표 칸 `td.td_date` 와 모바일용
     *    `div.info.dv_mob` 안 `<span>`(2026-09-06 고정본 실측). 행 전체 글자로 찾으면 지금은
     *    우연히 같은 값이 먼저 나오지만, 모바일 칸이 앞에 오도록 서식이 바뀌면 근거가 흔들린다.
     */
    const dateCell = (tr.querySelector("td.td_date")?.text ?? "").replace(/\s+/g, " ").trim();
    const d = dateCell.match(YMD);
    const ymd = d ? `${d[1]}-${d[2].padStart(2, "0")}-${d[3].padStart(2, "0")}` : "";
    out.push({
      title,
      detailUrl: `${BASE}${LIST}/${id}`,
      dateText: ymd ? `${ymd} ~` : "",
      category: "",
      agency: "한국여성경제인협회",
    });
  }
  return out;
}

export const kwbizConfig: BoardConfig = {
  id: "kwbiz",
  label: "한국여성경제인협회",
  agency: "한국여성경제인협회",
  region: "전국",
  baseUrl: `${BASE}/`,
  charset: "utf-8",
  list: {
    url: (p) => `${BASE}${LIST}?pageIndex=${p}&categoryId=notice`,
    // 한 쪽 10행 · 월 8~10건이라 3쪽이면 최근 30일을 넉넉히 덮는다.
    maxPages: 3,
    rowSelector: "div.board_list table tbody tr",
    fields: {
      title: { selector: "td.td_sub.tal > a" },
      detailUrl: { selector: "td.td_sub.tal > a", attr: "href", regex: "goDetail\\(\\s*'([A-Za-z0-9_]+)'" },
      date: { selector: "td.td_date" },
    },
  },
  customParse: parseKwbizList,
  /**
   * ★추측 단계를 끈다. 제목 href 가 전부 `javascript:goDetail(...)` 이라 추측 단계가
   * 왼쪽 메뉴·바닥글 링크를 공고로 저장한다 — 그 줄은 다음 회차에 지워지지 않는다.
   */
  skipHeuristic: true,
  // 1쪽 10행에서 DROP 뒤 실측 9건.
  expectMinRows: 5,
  detailContentSelector: "div.view_con",
  /**
   * 첨부는 상세의 `div.attfile_wp` 안에만 있다(`/download?category=NOTICE&fileId=FILE_…` ·
   * 쿠키·Referer 없이 GET 200 + HWP 84,992바이트 실측).
   * ⚠️알려진 한계: 링크 글자가 「다운로드」뿐이고 `title` 속성도 없어, 파일 이름은 옆 `<span>`
   *  에만 있다. 공용 수확기는 앵커 글자·`title` 만 보므로 저장되는 이름이 주소 꼬리
   *  (`download`)가 된다 — **주소는 정확하다.** 이름이 없어도 형식이 `etc` 로 잡혀 내려받기·
   *  본문 뽑기 대상에는 그대로 들어간다(`attachment-text.ts` 의 CANDIDATE_KINDS).
   * ★`attachmentsScopeRequired` 는 켜지 않는다 — 첨부 없는 상세에도 이 상자가 있는지
   *  실물로 확인하지 못했다(고정본이 첨부 2건짜리 한 장뿐).
   */
  attachmentsScopeSelector: "div.attfile_wp",
  // 2026-09-06 실측: 미국(Railway) 차단·서울 경유 200 — 국내 경유 전용
  requiresProxy: true,
};
