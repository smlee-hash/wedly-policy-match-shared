import type { BoardConfig, BoardRow } from "../types";

/**
 * 한국산업기술기획평가원(KEIT) 지원사업공고 — 산업통상자원부 산업기술 R&D 신규지원 공고.
 *
 * ★도메인 주의(2026-09-03 조사): `www.keit.re.kr` 은 기관 홍보 홈페이지고 **사업공고가 없다.**
 *   거기 게시판 `board.es?bid=0007` 은 「뉴스클리핑」, `bid=0013` 은 「유관기관 소식」,
 *   `bid=0009` 는 「입찰」이라 셋 다 타깃이 아니다. 진짜 공고는 산업기술R&D정보포털
 *   `itech.keit.re.kr` 에 있다. `itech.keit.re.kr/` 루트는 연구관리 시스템(srome)으로
 *   튕기는데 그건 로그인형 별개 시스템이다 — 혼동 금지.
 *
 * 구조:
 * · 화면 `bsnsancm/retrieveSprtBsnsAncmList.do` 은 서버가 표를 그려 주지만, **같은 화면이 쓰는
 *   JSON 통로** `bsnsancm/retrieveSprtBsnsAncmListJson.do` 가 훨씬 안정적이다(POST).
 *   제목·공고일·접수시작·접수종료가 이미 칸으로 갈려 온다.
 * · 표의 제목은 `<a href="#" onclick="f_detailPage('I22056','2026')">` 라 **href 가 없다.**
 *   JSON 의 `ancmId`+`bsnsYy` 로 상세 주소를 조립한다(GET 200 실측).
 * · 한 쪽 15건 · 전체 1,238건 / 83쪽(2026-09-03 실측)
 *
 * ★`bsnsYy`(해)를 **빈 값으로 보내는 것이 핵심**이다.
 *   화면 기본값은 올해라서 그대로 쓰면 2026년 **3건**, 2025년 2건, 2024년 6건처럼 해마다 토막 난
 *   목록만 온다. 게다가 쪽넘김이 「그 해 안에서만」 돌아 다른 해를 영영 못 본다.
 *   빈 값이면 1,238건이 **공고일 내림차순 한 줄**로 와서 1쪽이 곧 최신 15건이다(실측 확인).
 *
 * ⚠️ 쪽 변수는 `pageIndex` 하나뿐이어야 한다. 해까지 쪽마다 바꾸면 엔진의 `pagingParamsOf` 가
 *    `bsnsYy` 를 「쪽 번호 변수」로 오해해 **상세 주소에서 `bsnsYy` 를 지워** 상세가 안 열린다.
 *    그래서 본문의 `bsnsYy` 는 쪽과 무관하게 항상 빈 값으로 둔다.
 */
const BASE = "https://itech.keit.re.kr";
const LIST_API = `${BASE}/bsnsancm/retrieveSprtBsnsAncmListJson.do`;
const VIEW = `${BASE}/bsnsancm/retrieveSprtBsnsAncmDetail.do`;

/** 목록 한 줄. 쓰는 칸만 적는다(응답에는 `rcveStat`·`frstRegDt` 등이 더 온다). */
type KeitRow = {
  /** 공고 번호 — 「I22056」·「A00636」. 상세 주소의 열쇠. */
  ancmId?: string;
  /** 사업연도 — 상세 주소에 함께 필요하다. 공고를 **올린 해**다(제목의 「2026년도」와 다를 수 있다). */
  bsnsYy?: string;
  ancmTl?: string;
  /** 공고일 "2026-05-29". */
  ancmDe?: string;
  /** 접수 시작·종료 "20260529"/"20260629". 실측 90줄 전부 채워져 있다. */
  minRcveStrDe?: string;
  maxRcveEndDe?: string;
};

/**
 * 지원사업이 아닌 글. **버릴 것만** 좁게 지정한다.
 *
 * 실측 90건(6쪽)에서 공고가 아닌 것은 「…지역 수요 의향조사」 단 1건이었다.
 * 의향조사·수요조사는 기획 단계의 설문이라 기업이 신청해 지원받는 사업이 아니다.
 * 나머지(입찰·평가위원·합격자·채용공고)는 아직 실측에 없지만 같은 계열 게시판에서 나오는
 * 갈래라 미리 막아 둔다.
 *
 * ★`공모` 를 버리면 안 된다 — 실측 「재난안전 문제해결 기술개발 지원 신규과제 공모」처럼
 *   진짜 지원사업이 「공모」로 나온다.
 * ★`채용` 을 통째로 버리면 안 된다 — 고용보조금은 제목에 「채용」을 쓴다(bizbc 주석).
 *   그래서 「채용 공고」로만 좁힌다.
 * ★`테스트` 도 안 버린다 — 실측 「STELLA 관련 테스트 공고」(2021) 같은 시험용 줄이 있지만,
 *   「테스트베드 구축 지원사업」이 같이 죽는 값이 훨씬 크다.
 */
const DROP = /의향\s*조사|수요\s*조사|입찰\s*공고|낙찰|평가위원|설문\s*조사|합격자|채용\s*공고/;

/** 시험이 제목 글자만으로 거르개를 잴 수 있게 내보낸다. */
export function isKeitDropTitle(title: string): boolean {
  return DROP.test(title);
}

/** "20260529" → "2026-05-29". 여덟 자리 숫자가 아니면 빈 문자열. */
function ymd8(raw: string | undefined): string {
  const m = (raw ?? "").trim().match(/^(20\d{2})(\d{2})(\d{2})$/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : "";
}

/** "2026-05-29" → 그대로. 다른 모양이면 빈 문자열. */
function ymdDash(raw: string | undefined): string {
  const m = (raw ?? "").trim().match(/^(20\d{2})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : "";
}

/**
 * 접수기간은 **시작·끝 칸을 따로** 읽는다(`minRcveStrDe`·`maxRcveEndDe`).
 * 한 덩어리 글자에서 정규식으로 찾으면 칸이 이어 붙어 깨진다(hsbiz 실측 함정).
 *
 * 접수기간이 통째로 비면 공고일을 **개시형**(`YYYY-MM-DD ~`)으로 넘긴다 —
 * 단일 날짜로 넘기면 엔진이 그날을 **마감일**로 읽어 공고일에 이미 끝난 공고가 된다.
 */
function periodOf(r: KeitRow): string {
  const start = ymd8(r.minRcveStrDe);
  const end = ymd8(r.maxRcveEndDe);
  if (start && end) return `${start} ~ ${end}`;
  if (end) return end;
  if (start) return `${start} ~`;
  const posted = ymdDash(r.ancmDe);
  return posted ? `${posted} ~` : "";
}

export function parseKeitList(jsonText: string, _page = 1): BoardRow[] {
  let raw: KeitRow[] = [];
  try {
    const d = JSON.parse(jsonText) as { list?: KeitRow[] };
    if (Array.isArray(d?.list)) raw = d.list;
  } catch {
    // 점검 화면·오류 HTML 이 오면 여기서 0행 — 껍데기를 공고로 저장하지 않는다.
    return [];
  }
  const out: BoardRow[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    const id = String(r.ancmId ?? "").trim();
    const yy = String(r.bsnsYy ?? "").trim();
    // 상세 주소는 둘 다 있어야 열린다(실측: 하나만 주면 목록으로 튕긴다).
    if (!id || !/^20\d{2}$/.test(yy)) continue;
    const title = (r.ancmTl ?? "").replace(/\s+/g, " ").trim();
    if (!title || DROP.test(title)) continue;
    const detailUrl = `${VIEW}?ancmId=${encodeURIComponent(id)}&bsnsYy=${encodeURIComponent(yy)}`;
    if (seen.has(detailUrl)) continue;
    seen.add(detailUrl);
    out.push({ title, detailUrl, dateText: periodOf(r), category: "" });
  }
  return out;
}

export const keitConfig: BoardConfig = {
  id: "keit",
  label: "한국산업기술기획평가원(KEIT)",
  agency: "한국산업기술기획평가원",
  // 산업부 R&D 신규지원 공고라 신청 자격에 지역 제한이 없다.
  region: "전국",
  baseUrl: `${BASE}/`,
  charset: "utf-8",
  list: {
    // POST 라 주소는 쪽과 무관하게 같다 — 쪽 번호는 init 의 본문이 나른다.
    url: () => LIST_API,
    // 1쪽이 이미 2023년 8월까지 닿는다(신규는 해마다 3~6건). 5쪽이면 2022년까지 훑는다.
    maxPages: 5,
    init: (p) => ({
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      // `bsnsYy=` 는 「전 연도」다. 쪽마다 값이 변하지 않아야 엔진이 이걸 쪽 변수로 오해하지 않는다.
      body: `bsnsYy=&pageIndex=${p}`,
    }),
    // JSON 이라 선택자 갈래는 안 쓴다. customParse 가 없을 때만 보는 값이라 빈 자리를 채워 둔다.
    rowSelector: "",
    fields: { title: {}, detailUrl: {}, date: {} },
  },
  customParse: parseKeitList,
  /**
   * 상세 본문. 최신 공고는 표 안에 공고문 전문을 그대로 실어 준다(실측 3,959~4,570자).
   * 본문이 없는 공고(첨부 한글파일만 있는 줄)에서는 이 선택자가 없어 `targetText` 가 비는데,
   * 그게 맞다 — 첨부 목록 글자만 채우면 「본문 있음」으로 굳어 영영 다시 안 읽는다.
   *
   * ★첨부(2026-09-03 고침): `href="#"` + `onclick="f_bsnsAncmFileDownload('열쇠1','열쇠2')"` 라
   *    옛 수확기로는 한 건도 못 땄다. 이제 수확기가 그 모양을
   *    `/fileDownLoad.do?atchFileId=..&orgEdmsId=..&fileCrtSe=NA1001&menuId=02000000` 로 옮긴다
   *    (`/js/common/keit_common.js` 2022행 `cf_fileDownload`). ★`menuId` 를 빼면 404 다.
   *    실측 상세(ancmId=I22056)에서 10건을 집고 실제로 내려받아 품목개요서 전문을 읽었다.
   */
  detailContentSelector: "div.report",
  // 첨부 수확을 공고 표 안으로 묶는다(머리글·바닥글의 사이트 안내 파일 오염 방지 — bizok 선례).
  attachmentsScopeSelector: "table#table-response",
  /**
   * 목록이 JSON 이라 heuristic 추측 단계는 **마지막 방어선이 될 수 없다**(JSON 글자엔 링크가 없다).
   * 반대로 점검·차단 HTML 화면이 오면 그 화면의 메뉴 링크를 공고로 저장할 수 있다 —
   * 그 줄은 다음 회차에 지워지지 않는다(2026-09-02 수출입은행 실측). 그래서 끈다.
   */
  skipHeuristic: true,
  // 한 쪽 15건. 절반 아래로 떨어지면 응답 서식이 바뀐 것으로 본다.
  expectMinRows: 7,
};
