import { parseHtml } from "../html";
import type { BoardConfig, BoardRow } from "../types";

/**
 * 한국에너지공단 신·재생에너지센터 사업공고.
 *
 * 왜 연결했나(2026-09-06 실측): 총 304건(31쪽×10행), 재생에너지 금융지원·KS인증 수수료지원·
 * ReSCO 모집처럼 **기업 대상 보급·금융·인증 사업**이 올라온다. 이미 연결된 한국에너지기술평가원
 * (`ketep`)은 R&D 과제 전담기관이라 기관도 사업도 다르다.
 *
 * 구조(고정본 `knrec-list.html`·`knrec-list-p2.html` 실측):
 * · 목록 표는 클래스가 없다 — `div.table_list table tbody tr` 로 잡는다.
 * · 칸 9개 「번호 / 진행여부 / 분류 / 제목 / 담당부서 / 등록일 / 마감일 / 첨부파일 / 조회수」.
 * · **등록일과 마감일이 각각 별도 칸**이라 접수기간을 본문 추정 없이 얻는다.
 * · 상세 링크가 평범한 href `./view.do?no=7023`(JS 해석 불필요), 쪽넘김도 `?page=N` 링크다.
 *
 * ★★상단 고정 「공지」 **8행이 매 쪽 반복된다**(1·2쪽 고정본 둘 다 같은 8건). 그대로 두면
 *   같은 공고가 쪽수만큼 저장되고, 한 회차 안에서 「신규 0인 쪽」 판정도 흐려진다.
 *   그래서 `no` 를 열쇠로 **한 회차 안에서** 지운다 — 다만 `customParse` 는 쪽마다 따로 불리므로
 *   한 쪽 안의 중복(1쪽은 공지 8 + 일반 10 인데 그중 2건이 같은 no)만 여기서 접히고,
 *   쪽을 넘어가는 중복은 상세 주소(`view.do?no=`)가 같아 **저장 단계가 한 줄로 접는다**.
 *
 * 상세: `view.do?no=<번호>` GET 200. 본문 `p.notice_view_txt`(id `board_cont`) —
 * 「ㅇ신청대상 : …」·「ㅇ공모기간 : 2026. 9. 1.(화) ~ 9.15.(화)」가 글자 그대로 들어 있다.
 * 첨부는 `href="javascript:file_down('7023','1','notice')"` — 상세 스크립트가
 * `/biz/file/File_down.do?no=&gubun=&kinds=` 로 여는 갈래라 공용 수확기에 이 사이트 전용
 * 갈래를 하나 더했다(`detail-fill.ts` 의 `KNREC_DOWN`). 실호출 200 + HWP 123,904바이트.
 *
 * ⚠️첨부 응답 헤더의 파일 이름은 **EUC-KR** 이라 UTF-8 로 읽으면 깨진다 —
 *   원본 이름은 상세 HTML 링크 글자에서 가져온다(수확기가 그렇게 한다). 게시판 문서 자체는 UTF-8 이다.
 */
const BASE = "https://www.knrec.or.kr";
const LIST = "/biz/pds/businoti/list.do";
const VIEW = "/biz/pds/businoti/view.do";
const NO = /[?&]no=(\d+)/;
const YMD = /(20\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})/;

/**
 * 지원사업이 아닌 글. **버릴 것만** 좁게 지정한다(조사 `filterNeeded` ①②③).
 * 실측 1·2쪽 제목에서 걸리는 갈래:
 * · 「… 고정가격계약 **경쟁입찰** 공고」 — 발전사업자 대상 입찰이지 기업지원금이 아니다.
 * · 「… KS인증 **위탁기관 지정** 변경사항 공고」 — 제도·행정 공고.
 * · 「재생에너지 자가설비 인증서(REGO) 발급·거래 **시범사업**」 — 설비 보유자 대상.
 * · 「… **위탁정산기관** 선정」·「… **수행기관** 선정」·「… **위탁운용사** 선정」 — 기관 선정 공고.
 * ★`공모`·`모집` 을 통째로 버리지 않는다 — ReSCO 기업 모집·A/S 전담업체 공모가 지원 대상이다.
 */
const DROP =
  /경쟁입찰|위탁기관\s*(?:\S+\s*)?지정|위탁정산기관|위탁운용사|수행기관\s*선정|REGO|낙찰|선정\s*결과\s*(?:발표|안내)?$/;

/** 시험이 제목 글자만으로 거르개를 잴 수 있게 내보낸다. */
export function isKnrecDropTitle(title: string): boolean {
  return DROP.test(title);
}

export function parseKnrecList(html: string): BoardRow[] {
  const out: BoardRow[] = [];
  const seen = new Set<string>();
  for (const tr of parseHtml(html).querySelectorAll("div.table_list table tbody tr")) {
    const tds = tr.querySelectorAll("td");
    if (tds.length < 9) continue; // 「등록된 게시물이 없습니다」 줄·머리글
    const a = tr.querySelector("td.left a");
    const no = (a?.getAttribute("href") ?? "").match(NO)?.[1] ?? "";
    // ★고정 「공지」 8행이 매 쪽 반복된다 — no 로 접는다(위 주석 ★★).
    if (!no || seen.has(no)) continue;
    const title = (a?.text ?? "").replace(/\s+/g, " ").trim();
    if (!title || DROP.test(title)) continue;
    seen.add(no);
    /**
     * 등록일·마감일은 **`td:nth-child(6)`·`td:nth-child(7)` 칸을 직접** 집는다.
     * ⚠️ 행 전체 글자(`tr.text`)에서 찾으면 안 된다 — 칸이 띄어쓰기 없이 이어 붙어
     *    번호(304)·조회수(381)가 날짜에 달라붙는다(hsbiz 실측 함정).
     */
    const opened = (tds[5]?.text ?? "").replace(/\s+/g, " ").trim().match(YMD);
    const closed = (tds[6]?.text ?? "").replace(/\s+/g, " ").trim().match(YMD);
    const ymd = (m: RegExpMatchArray | null) =>
      m ? `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}` : "";
    const from = ymd(opened);
    const to = ymd(closed);
    const dateText = from && to ? `${from} ~ ${to}` : from ? `${from} ~` : "";
    // 분류(`[공고]`)와 진행여부(진행·종료)를 함께 남긴다 — 닫힘은 마감일이 정하게 두고
    // 이 글자로 거르지 않는다(aca·kiria 와 같은 판단).
    const state = (tds[1]?.text ?? "").replace(/\s+/g, " ").trim();
    const kind = (tds[2]?.text ?? "").replace(/\s+/g, " ").trim();
    out.push({
      title,
      // 쪽 번호를 넣지 않는다 — 주소가 곧 중복 판정 열쇠(sourceId)이고, 쪽을 넘는 고정 공지
      // 중복은 이 주소가 같아야 저장 단계에서 한 줄로 접힌다.
      detailUrl: `${BASE}${VIEW}?no=${no}`,
      dateText,
      category: [kind, state].filter(Boolean).join(" · "),
      agency: "한국에너지공단 신·재생에너지센터",
    });
  }
  return out;
}

export const knrecConfig: BoardConfig = {
  id: "knrec",
  label: "한국에너지공단 신·재생에너지센터",
  agency: "한국에너지공단 신·재생에너지센터",
  region: "전국",
  baseUrl: `${BASE}/`,
  charset: "utf-8",
  list: {
    // 페이지네이션이 순수 링크 `list.do?page=2&` — 꼬리 `&` 까지 화면 그대로 따라간다.
    url: (p) => `${BASE}${LIST}?page=${p}&`,
    // 한 쪽 10행(+고정 공지 8행), 월 6~8건 — 3쪽이면 약 4개월을 덮는다.
    maxPages: 3,
    rowSelector: "div.table_list table tbody tr",
    fields: {
      title: { selector: "td.left a" },
      detailUrl: { selector: "td.left a", attr: "href" },
      date: { selector: "td:nth-child(6)" },
      category: { selector: "td:nth-child(3)" },
    },
  },
  customParse: parseKnrecList,
  detailContentSelector: "p.notice_view_txt",
  /**
   * 첨부는 상세의 `div.notive_view_file`(사이트 원문 오타 그대로 — `notice` 가 아니라 `notive`)
   * 안에만 있다. 범위를 못 박아 왼쪽 메뉴·바닥글이 섞이지 않게 한다(비즈OK 오염 사례).
   * ★`attachmentsScopeRequired` 는 **켜지 않는다** — 첨부 없는 상세를 실물로 못 봤다(types.ts 주석).
   */
  attachmentsScopeSelector: "div.notive_view_file",
  /**
   * ★목록이 제목을 **50자에서 잘라** 보낸다(2026-09-06 실측: 1쪽 18행 중 2행, 2쪽 18행 중 1행 —
   *  `… 고정가격계약 경쟁입찰 공...`). 그대로 저장하면 안양과 같은 두 가지 손해가 난다:
   *   · `dedupKeyOf({title, agency})` 가 기업마당·모기관(energy.or.kr)의 같은 공고와 갈려 **영영 안 묶인다**
   *   · 갈래·한도 추출이 제목 뒷부분을 통째로 못 본다
   *  상세 제목 `p.notice_view_tit` 은 온전하다 — 앞에 `<font>[공고]</font>` 말머리가 붙어 있어
   *  `strip` 으로 뗀다(안 떼면 접두어 관계가 성립하지 않아 승격 자체가 안 된다).
   *  승격 판정은 `title-upgrade.ts` 한 곳에서만 한다(접두어 관계일 때만).
   *
   * ★`drop` 이 마지막 방어선이다. 잘림이 거르개 낱말 **중간**에서 일어나면
   *  (`… 고정가격계약 경쟁입...`) 목록 단계 DROP 이 그 낱말을 못 보고 그냥 통과시킨다 —
   *  온전한 제목을 처음 보는 이 자리에서 다시 걸러 `closed` 로 닫는다.
   */
  detailTitle: {
    selector: "p.notice_view_tit",
    strip: /^\s*\[[^\]]*\]\s*/,
    drop: DROP,
  },
  /**
   * ★heuristic 추측을 끈다. 목록 행의 첨부 칸에 `javascript:file_down(…)` 링크가 4개씩 붙어 있어
   * 추측 단계가 `a[href]` 를 긁으면 그 링크가 공고로, 「한글파일」이 제목으로 저장된다
   * (수출입은행 실측과 같은 갈래 — 그 줄은 다음 회차에 지워지지 않는다).
   */
  skipHeuristic: true,
  /** 1쪽 고정본 18행에서 고정 공지 중복 2 + DROP 5 를 뺀 실측 11건. 서식이 깨지면 0행이 된다. */
  expectMinRows: 5,
};
