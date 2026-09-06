import type { BoardConfig, BoardRow } from "../types";

/**
 * 창조경제혁신센터 지원사업공고 — **17개 지역 센터가 한 목록에 다 나온다.**
 *
 * 왜 연결했나(2026-09-02 실측): 최신 15건을 우리 DB 9,565건과 제목으로 대조했더니
 * 이미 들어옴 8 · 애매 2 · **신규 5**. 신규 다섯은 「KT Collaboration 참여 기업 모집」·
 * 「공공기술 활용 딥테크 창업 경진대회」·「KC 인증 취득 지원 프로그램」·
 * 「대구 창업-BuS Station IR 참여기업 모집」·「CES 2027 대전통합관 참가기업 모집」으로
 * 전부 기업이 실제로 신청하는 사업이다.
 *
 * ★앞 기록 「스크립트 화면 — 실브라우저 조사 1회 후 결정」은 틀렸다.
 *   목록 `tbody#list_body` 는 비어 오는 게 맞지만, 그것을 그리는 스크립트가 부르는
 *   `business_list.json` 이 제목·지역·접수기간·지원자격·본문까지 통째로 준다. 실브라우저 불필요.
 *
 * 구조:
 * · 목록 = **POST** `business_list.json`, 본문 `pn={쪽}&sPtime=now&pagePerContents=15&…`
 * · `sPtime=now` 는 진행중(실측 62건), `pre` 는 지난 1,703건 — **`now` 만 쓴다.**
 *   지난 공고를 넣으면 화면이 끝난 글로 차고, 우리는 끝난 공고를 굳이 보관하지 않는다.
 * · 응답 `result.list[]` · `result.size` 가 총건수
 * · 접수일·마감일을 **둘 다** 준다(`C_SDATE`~`C_EDATE`) — 게시판 30여 곳 중 드문 경우다
 * · 상세는 GET `business_view.do?seq={SEQ}` (200/77KB 실측)
 *
 * ⚠️ 같은 제목이 센터별로 두 줄 들어오는 경우가 있다(실측: 강원 「모두의 창업 프로젝트」 2건).
 *    `SEQ` 가 다르므로 여기서는 둘 다 살리고, 화면에서 중복 열쇠(`제목|기관`)가 묶는다.
 *    그래서 **기관을 센터 이름으로 못 박지 않는다** — 「모두의 창업 프로젝트」는 중기부 통합 공고를
 *    각 센터가 옮겨 싣는 것이라, 센터명을 박으면 열쇠가 갈려 서로도 안 묶이고 기업마당의 같은
 *    공고와도 안 묶인다(화성 hsbiz 에서 겪은 그 갈래).
 */
const BASE = "https://ccei.creativekorea.or.kr";
const LIST_API = `${BASE}/service/business_list.json`;
const VIEW = `${BASE}/service/business_view.do`;
/** 한 쪽에 몇 건을 달라고 할지. 15 × 5쪽 = 75 ≥ 진행중 62건(2026-09-02 실측). */
const PER_PAGE = 15;

type CceiRow = {
  SEQ?: string;
  PROGRAM_TITLE?: string;
  /** 접수(신청) 기간. 비어 있는 줄이 많다. */
  R_SDATE?: string;
  R_EDATE?: string;
  /** 프로그램(사업) 기간 — **접수 기간이 아니다.** 아래 ymdRange 주석 참고. */
  C_SDATE?: string;
  C_EDATE?: string;
  /** 자격 요약(「예비창업자, 7년이내 기업」). "all" 이면 뜻이 없다. */
  ELIGIBILITY?: string;
};

/** "2026.09.01" → "2026-09-01". 값이 없거나 날짜가 아니면 빈 문자열. */
function ymd(raw: string | undefined): string {
  const m = (raw ?? "").match(/(20\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
  return m ? `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}` : "";
}

/**
 * ★신청 기간은 `R_SDATE~R_EDATE` 다. `C_SDATE~C_EDATE` 는 **프로그램 기간**이라 쓰면 안 된다.
 *
 * 처음엔 `C_*` 를 접수기간으로 썼다가 적대 리뷰(코덱스)가 「치명」으로 잡았고, 자료로 확인됐다:
 * 「CES 2027 대전통합관 전시 참가기업 모집 **연장 공고(~7/1)**」는
 *   C = `2027.01.06~2027.01.09`(전시회가 열리는 날) · R = `2026.06.18~2026.07.01`(신청 마감)
 * C 를 쓰면 **이미 7월 1일에 끝난 모집이 2027년까지 「모집중」으로** 뜬다.
 * 상세 화면의 칸 이름도 그 값을 「프로그램 기간」이라 부른다(고정본 확인).
 *
 * 제목이 증거를 셋 준다 — R_EDATE 가 있는 세 줄의 제목 꼬리가 그 날짜와 정확히 같다:
 *   「…(~7/1)」=2026-07-01 · 「…(~8/14 금)」=2026-08-14 · 「…(~08.21)」=2026-08-21.
 * R 이 빈 줄(15건 중 11건)은 C 가 사실상 모집 기간이라 그때만 C 로 물러선다.
 */
function periodOf(r: CceiRow): string {
  const rs = ymd(r.R_SDATE);
  const re = ymd(r.R_EDATE);
  if (rs && re) return `${rs} ~ ${re}`;
  if (re) return `${re}`;
  if (rs) return `${rs} ~`;
  const cs = ymd(r.C_SDATE);
  const ce = ymd(r.C_EDATE);
  if (cs && ce) return `${cs} ~ ${ce}`;
  return cs ? `${cs} ~` : "";
}

export function parseCceiList(jsonText: string): BoardRow[] {
  let raw: CceiRow[] = [];
  try {
    const d = JSON.parse(jsonText) as { result?: { list?: CceiRow[] } };
    if (Array.isArray(d?.result?.list)) raw = d.result.list;
  } catch {
    return [];
  }
  const out: BoardRow[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    const seq = String(r.SEQ ?? "").trim();
    const title = (r.PROGRAM_TITLE ?? "").replace(/\s+/g, " ").trim();
    if (!seq || !title || seen.has(seq)) continue;
    seen.add(seq);
    /**
     * 자격 요약은 `summary` 로 싣는다 — **`targetText` 로 실으면 안 된다**(적대 리뷰 지적).
     * 뒷단계의 「첨부에서 본문 뽑기」가 `targetText === ""` 인 줄만 처리해서, 짧은 요약이라도
     * 채워 넣는 순간 그 공고는 첨부 공고문의 진짜 자격조건을 **영영 못 읽는다.**
     * "all" 은 「제한 없음」이라 조건으로 쓸 값이 아니다.
     */
    const elig = (r.ELIGIBILITY ?? "").trim();
    out.push({
      title,
      detailUrl: `${VIEW}?seq=${encodeURIComponent(seq)}`,
      dateText: periodOf(r),
      category: "",
      summary: elig && elig.toLowerCase() !== "all" ? elig : undefined,
    });
  }
  return out;
}

export const cceiConfig: BoardConfig = {
  id: "ccei",
  label: "창조경제혁신센터",
  agency: "창조경제혁신센터",
  /**
   * ★행마다 `CD_NM2`(제주·울산·강원…)가 오지만 **지역으로 쓰지 않는다.**
   * 그것은 「공고를 올린 센터의 지역」이지 「신청 자격 지역」이 아니다 — 적대 리뷰가 짚은 실례:
   * 부산센터의 「BOUNCE 2026」은 자격이 **전국 소재 창업 7년 미만 스타트업**인데
   * 지역을 「부산」으로 저장하면 서울 기업이 지역 사전 필터에서 탈락해 이 공고를 못 받는다.
   * 이 저장소의 우선순위는 「단 1건도 놓치지 않기」라 **놓치는 쪽보다 넓게 두는 쪽**을 고른다.
   * 진짜 지역 제한은 본문·첨부에서 조건 추출이 잡는다.
   */
  region: "전국",
  baseUrl: `${BASE}/`,
  charset: "utf-8",
  list: {
    // POST 라 주소는 쪽과 무관하게 같다 — 쪽 번호는 init 의 본문이 나른다.
    url: () => LIST_API,
    maxPages: 5,
    init: (p) => ({
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `pn=${p}&sPtime=now&pagePerContents=${PER_PAGE}&sdate=&edate=&keyword1=&center_searching=`,
    }),
    // JSON 이라 선택자 갈래는 안 쓴다. customParse 가 없을 때만 보는 값이라 빈 자리를 채워 둔다.
    rowSelector: "",
    fields: { title: {}, detailUrl: {}, date: {} },
  },
  customParse: parseCceiList,
  /**
   * ★`detailContentSelector` 를 **일부러 안 적는다**(적대 리뷰 지적 반영).
   *
   * 상세 본문은 실측 297자짜리 표지문으로 「상세내용은 첨부파일 공고문 참고」로 끝난다.
   * 그 297자를 `targetText` 에 저장하면 뒷단계의 「첨부에서 본문 뽑기」가
   * `targetText === ""` 조건에서 이 공고를 **영영 건너뛰어** 진짜 자격조건이 든 공고문 PDF 를
   * 한 번도 안 읽는다. 선택자를 비우면 `targetText` 가 빈 채로 남고 첨부만 수확돼,
   * 다음 단계가 공고문에서 본문을 뽑아 채운다(그것이 설계된 길이다).
   * 자격 요약은 목록의 `ELIGIBILITY` 를 `summary` 로 이미 싣는다.
   */
  attachmentsScopeSelector: "div.brd_viewer",
  // 한 쪽 15건을 요청한다. 절반 아래로 떨어지면 응답 서식이 바뀐 것으로 본다.
  expectMinRows: 5,
};
