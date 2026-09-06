import type { BoardConfig, BoardRow } from "../types";

/**
 * 중소벤처24(portal.smes.go.kr) 지원사업 공고 — **중앙정부·지방정부를 한 줄기로** 받는다.
 *
 * 왜 연결했나(2026-09-03 실측): 접수중 1,630건 + 진행예정 17건. 그중 1,063건이
 * 지방정부 공고(「[경북] 경산시 …」·「[충남] 아산시 …」)로, 시·군 단위 지원사업이 통째로 들어온다.
 * 소관부처가 행마다 달라(경상북도·충청남도·중소벤처기업부…) 기관을 행에서 싣는다.
 *
 * ★앞 기록(2026-08-26 「요청 규격 미확정 — 인증키가 필요하다」)은 이제 안 따라도 된다.
 *   그 메모가 가리키던 `/ione-gw/api/pblanc/list` 는 인증키(token)를 받는 개방 API 인데,
 *   **사람이 보는 목록 화면이 쓰는 통로는 열쇠가 없어도 열린다**(로그인 안 한 브라우저로 실측):
 *   `GET /home/api/v1/pbanc?page=&size=&sortType=&bizPbancTypeCd=BIZPBN&applyStatus=`.
 *   열쇠가 없으니 만료·한도·비밀값 보관 문제가 없다. 그래서 이쪽을 쓴다.
 *
 * 구조:
 * · 목록 = GET JSON. 응답 `{success, data:{content[], page, size, totalElements, totalPages}}`
 * · 한 쪽 최대 **50건** — `size=100` 을 보내도 서버가 50 으로 깎는다(실측).
 * · `govType` 을 **안 붙인다.** 붙이면 `central`(567건) / `local`(1,063건) 로 갈리고,
 *   한 설정에 주소는 하나라 한쪽만 들어온다. 안 붙이면 둘이 합쳐 1,630건이 온다.
 * · `applyStatus=AVAILABLE`(접수중) + `PLANNED`(진행예정). `CLOSED` 9,300건은 안 받는다 —
 *   끝난 공고를 굳이 보관하지 않는다(창조경제혁신센터와 같은 판단).
 * · 상세 = 사람용 화면 `/home/req/pbanc/{공고번호}` 는 **스크립트 화면(빈 껍데기)** 이라
 *   선택자로 한 글자도 못 읽는다. 같은 번호를 `GET /home/api/v1/pbanc/{번호}?bizPbancTypeCd=BIZPBN`
 *   으로 다시 불러 지원대상·지원자격·신청제외대상·제출서류·추진절차를 이어 붙인다(`detailFetch`).
 *
 * ★쪽 배치를 왜 「마감임박순」으로 잡았나 (2026-09-03 33쪽 전수 실측 — 이 게시판의 급소):
 *   접수중 1,630건 중 **997건은 접수 기간이 아예 없다**(「예산 소진시까지」617·「상시 접수」154·
 *   「추후 공지」37 …). 공용 검증기(`validate.ts`)는 **한 쪽의 30% 이상이 날짜를 가져야** 통과시키고,
 *   못 통과한 쪽에서 수집을 **끊는다**. 그래서 정렬을 잘못 고르면 뒷쪽을 통째로 잃는다:
 *     · 등록일순(REG)  — 12쪽에서 28% 로 떨어져 **12쪽부터 끊긴다**(1,080건 유실)
 *     · 조회순(VIEW)   — **2쪽**에서 28% 로 떨어져 더 나쁘다
 *     · 마감임박순(DEADLINE) — 날짜 있는 633건이 앞에 모여 1~12쪽 100%, 13쪽 62%, 14쪽부터 0%
 *   그래서 DEADLINE 을 쓴다. 날짜 있는 633건을 **한 건도 안 빠뜨리고** 받고, 마감이 급한 순서라
 *   화면에 먼저 필요한 것이 먼저 들어온다. 14쪽은 검증에 걸려 그 자리에서 멈추는데,
 *   그 뒤는 전부 날짜 없는 줄이라 **멈춰도 새로 잃는 것이 없다.**
 *
 * ⚠️ 남은 구멍(메인에게 보고): 날짜가 아예 없는 **997건**은 이 엔진으로는 담을 수 없다.
 *   날짜를 지어내면 담기지만 그것은 없는 접수 시작일을 만드는 것이라 하지 않는다.
 *   푸는 길은 공용 `validate.ts` 의 30% 규칙에 「날짜를 안 주는 게시판」 예외를 두는 것뿐인데,
 *   공용 파일이라 여기서 고치지 않는다.
 */
const BASE = "https://portal.smes.go.kr";
const LIST_API = `${BASE}/home/api/v1/pbanc`;
/** 사람이 여는 상세 화면. 지방정부 공고도 같은 주소로 열린다(실측). */
const VIEW = `${BASE}/home/req/pbanc`;
/** 한 쪽에 몇 건을 달라고 할지. 50 이 서버 상한이다(51 이상을 보내도 50 으로 깎인다). */
const PER_PAGE = 50;
/** 엔진 몇 쪽을 「진행예정」에 쓸지. 1쪽에 두면 예정 공고가 0건인 날 출처가 통째로 죽는다. */
const PLANNED_PAGE = 2;

/** 목록 분야 코드 — `commoncode/bulk?groups=BIZ_PBANC_CLSF_CD` 실측(2026-09-03). */
const CLSF: Record<string, string> = {
  PC10: "금융", PC12: "중견", PC20: "기술", PC30: "인력", PC40: "수출",
  PC50: "내수", PC60: "창업", PC70: "경영", PC80: "소상공인", PC99: "기타",
};

type Smes24Row = {
  bizPbancNo?: number | string;
  bizPbancNm?: string;
  bizPbancClsfCd?: string;
  bizSprvsnInstNm?: string;
  /** 접수 시작·마감 — **칸 두 개를 따로** 읽는다(행 글자를 정규식으로 훑지 않는다). */
  bizAplyBgngYmd?: string | null;
  bizAplyDdlnYmd?: string | null;
  /** 행별 접수 상태 글(「신청가능」·「진행예정」, 2026-09-03 실측). 목록 필터를 API 가 무시해도 이 값으로 행마다 거른다. */
  applyStatusText?: string | null;
};

/**
 * 지원사업이 아닌 글. **버릴 것만** 좁게 적는다.
 * ★`채용` 을 통째로 버리면 안 된다 — 「소상공인 직원 신규채용 인건비 지원사업」·
 *   「기업 채용연계 청년일자리 지원사업」이 죽는다(둘 다 실제 목록 제목).
 *   기관이 사람을 뽑는 글(`직원 채용 공고`)만 걸리게 뒤에 「공고/안내」를 붙여 좁힌다.
 *
 * 2026-09-03 접수중 1,630건 전수 대조: 이 거르개에 걸리는 제목 **0건**.
 * 지금은 버릴 것이 없는 깨끗한 목록이라, 이 거르개는 성격이 다른 글이 섞여 들어올 때의 보호막이다.
 */
const DROP =
  /평가위원|심사위원\s*(?:모집|공모)|합격자|선정\s*결과|입찰\s*공고|설문\s*조사|(?:신규|경력|정규직|직원)\s*채용\s*(?:공고|안내)|채용\s*공고/;

/** 시험이 제목 글자만으로 거르개를 잴 수 있게 내보낸다. */
/** 살아 있는 공고의 상태 글. 「마감」·「종료」·「접수마감」 등 다른 글이 오면 그 행은 버린다. */
const OPEN_STATUS = /신청가능|진행예정|접수중|모집중|접수예정/;

export function isSmes24DropTitle(title: string): boolean {
  return DROP.test(title);
}

/** 엔진 쪽 번호 → 실제 목록 주소. 1쪽=접수중 1쪽, 2쪽=진행예정, 3쪽부터 접수중 2·3·4… */
export function smes24ListUrl(page: number): string {
  const planned = page === PLANNED_PAGE;
  const apiPage = planned ? 1 : Math.max(1, page < PLANNED_PAGE ? page : page - 1);
  const status = planned ? "PLANNED" : "AVAILABLE";
  return `${LIST_API}?page=${apiPage}&size=${PER_PAGE}&sortType=DEADLINE&bizPbancTypeCd=BIZPBN&applyStatus=${status}`;
}

/** "20260828" → "2026-08-28". 값이 없거나 8자리 날짜가 아니면 빈 문자열. */
function ymd(raw: string | null | undefined): string {
  const m = String(raw ?? "").trim().match(/^(20\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])$/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : "";
}

/**
 * 접수기간 글자. 칸 두 개를 각각 읽어 만든다.
 * ★마감이 시작보다 앞선 뒤집힌 자료는 **마감을 버린다** — 실자료에 있다
 *   (「2027 일본 도쿄 소비재 기프트쇼 수출컨소시엄」 시작 2026-10-01 · 마감 2025-10-20).
 *   그대로 실으면 시작도 하기 전에 끝난 공고가 되어 저장 즉시 마감 처리된다.
 * 날짜가 하나도 없으면 **빈 문자열** — 「예산 소진시까지」에 오늘 날짜를 넣지 않는다.
 */
function periodOf(r: Smes24Row): string {
  const begin = ymd(r.bizAplyBgngYmd);
  const end = ymd(r.bizAplyDdlnYmd);
  if (begin && end) return end < begin ? `${begin} ~` : `${begin} ~ ${end}`;
  if (begin) return `${begin} ~`;
  return end;
}

export function parseSmes24List(jsonText: string, page = 1): BoardRow[] {
  let raw: Smes24Row[] = [];
  try {
    const d = JSON.parse(jsonText) as { data?: { content?: Smes24Row[] } };
    if (Array.isArray(d?.data?.content)) raw = d.data.content;
  } catch {
    return [];
  }
  const out: BoardRow[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    const no = String(r.bizPbancNo ?? "").trim();
    const title = (r.bizPbancNm ?? "").replace(/\s+/g, " ").trim();
    if (!/^\d+$/.test(no) || !title || seen.has(no)) continue;
    if (isSmes24DropTitle(title)) continue;
    // ★행별 상태 확인 — 날짜 없는 행을 통과시키는 대신(allowUndatedRows) 원천이 준 상태 글로 끝난 공고를 거른다(코덱스 지적 2026-09-03).
    //   상태 글이 아예 없는 옛 응답은 거르지 않는다(과잉 삭제 방지).
    const statusText = String(r.applyStatusText ?? "").trim();
    if (statusText && !OPEN_STATUS.test(statusText)) continue;
    const dateText = periodOf(r);
    /**
     * ★진행예정 쪽에서만 날짜 없는 줄을 버린다.
     * 「예정」은 접수 시작일이 있어야 뜻이 있고, 무엇보다 이 쪽이 통째로 날짜 없는 줄이 되면
     * 공용 검증기의 30% 규칙에 걸려 **그 뒤 쪽을 전부 잃는다**(2쪽에서 끊긴다).
     * 접수중 쪽에서는 절대 버리지 않는다 — 상시 공고를 잃으면 안 된다.
     */
    if (page === PLANNED_PAGE && !dateText) continue;
    seen.add(no);
    const agency = (r.bizSprvsnInstNm ?? "").replace(/\s+/g, " ").trim();
    out.push({
      title,
      detailUrl: `${VIEW}/${no}`,
      dateText,
      category: CLSF[(r.bizPbancClsfCd ?? "").trim()] ?? "",
      // 소관부처·지자체가 행마다 다르다(경상북도·충청남도·중소벤처기업부…).
      // 기업마당(bizinfo)도 같은 값을 기관으로 쓰므로 중복 열쇠(제목|기관)가 서로 맞물린다.
      ...(agency ? { agency } : {}),
    });
  }
  return out;
}

/** 상세 API 에서 이어 붙일 칸과 이름표. 순서가 곧 본문 차례다. */
const DETAIL_SECTIONS: Array<[string, string]> = [
  ["bizSprtTrgtCn", "지원대상"],
  ["bizSprtQlfcRqmtCn", "지원자격"],
  ["bizAplyExclTrgtCn", "신청제외대상"],
  ["bizSprtCn", "지원내용"],
  ["bizSprtSclCn", "지원규모"],
  ["bizPbancSprtAmtCn", "지원금액"],
  ["bizAplyMthdCn", "신청방법"],
  ["bizAplySbmsnDcmntCn", "제출서류"],
  ["bizPbancPrtrtMttrCn", "추진절차"],
  ["bizPbancInqplCn", "문의처"],
];

function text(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * 상세 API 응답(JSON) → 본문 HTML. 값이 빈 칸은 이름표까지 뺀다
 * (「지원규모:」만 남은 빈 줄을 자격조건 원문으로 저장하지 않는다).
 * 담을 것이 하나도 없으면 빈 문자열 — 빈 껍데기를 본문으로 저장하지 않는다.
 */
export function smes24DetailHtml(jsonText: string): string {
  let d: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(jsonText) as { data?: unknown };
    if (parsed?.data && typeof parsed.data === "object" && !Array.isArray(parsed.data)) {
      d = parsed.data as Record<string, unknown>;
    }
  } catch {
    return "";
  }
  const parts: string[] = [];
  // 사업개요만 원문이 이미 HTML 이다(<p>·<br> 포함) — 그대로 싣는다.
  const outline = text(d.bizPbancOtln);
  if (outline) parts.push(`<section><h3>사업개요</h3>\n${outline}\n</section>`);
  for (const [key, label] of DETAIL_SECTIONS) {
    const v = text(d[key]);
    if (!v) continue;
    parts.push(`<section><h3>${label}</h3>\n<p>${esc(v).replace(/\n/g, "<br>\n")}</p>\n</section>`);
  }
  return parts.length > 0 ? `<div class="smes24-detail">\n${parts.join("\n")}\n</div>` : "";
}

export const smes24Config: BoardConfig = {
  id: "smes24",
  label: "중소벤처24 사업공고",
  agency: "중소벤처24",
  /**
   * ★행마다 「[경북]·[충남]」 이 제목에 붙고 소관도 지자체지만 **지역을 좁히지 않는다.**
   * 이 설정값은 게시판 전체에 한 번 붙는 값이라 한 지역으로 못 박으면 나머지 16개 시·도 공고가
   * 전부 그 지역으로 저장된다. 진짜 지역 제한은 본문·제목에서 조건 추출이 잡는다.
   */
  region: "전국",
  baseUrl: `${BASE}/`,
  charset: "utf-8",
  list: {
    url: smes24ListUrl,
    /**
     * 접수중에서 날짜를 주는 633건이 오늘 13쪽(엔진 14쪽)에서 끝난다. 16 으로 두면
     * 그 블록이 15쪽까지 늘어나도 따라가고, 더 늘면 엔진의 쪽수 상한 알림이 울려 올려 달라고 알린다.
     */
    // 접수중 1,630건 = 50건씩 33쪽 + 진행예정 1쪽(2026-09-03 실측). 엔진 상한(PAGE_HARD_CAP 40) 안에서 여유 2쪽.
    maxPages: 36,
    // GET 이라 init 은 없다 — 쪽 번호는 주소가 나른다.
    // JSON 이라 선택자 갈래는 안 쓴다. customParse 가 없을 때만 보는 값이라 빈 자리를 채워 둔다.
    rowSelector: "",
    fields: { title: {}, detailUrl: {}, date: {} },
  },
  customParse: parseSmes24List,
  /**
   * 사람용 상세가 스크립트 화면이라 `detailContentSelector` 로는 아무것도 못 읽는다.
   * 대신 상세 API 를 인자로 받은 `fetchText` 로만 불러 본문을 만든다(허용 호스트 검사 유지).
   */
  detailFetch: async (detailUrl, fetchText) => {
    const no = detailUrl.match(/\/pbanc\/(\d+)(?:$|[?#])/)?.[1];
    if (!no) return "";
    return smes24DetailHtml(await fetchText(`${LIST_API}/${no}?bizPbancTypeCd=BIZPBN`));
  },
  /**
   * ★첨부는 **일부러 안 싣는다**(2026-09-03 실측 근거 둘).
   * ① 포털 제 다운로드 통로 `/home/api/v1/files/download/{id}/{순번}` 는 브라우저 안에서도
   *    500(COMMON_501) 을 준다 — 저장해 봐야 못 받는 주소만 쌓인다.
   * ② 기업마당 쪽 사본 주소(`getImageFile.do?atchFileId=`)는 열리지만 파일 확장자가 없어
   *    공용 수확기(`harvestBoardAttachments`)가 첨부로 알아보지 못한다. 공용 파일은 여기서 안 고친다.
   * 대신 상세 API 가 지원대상·지원자격·신청제외대상·제출서류·추진절차를 **글로** 다 주므로
   * 자격조건 추출에 필요한 내용은 첨부 없이도 채워진다.
   */
  // 한 쪽 50건을 요청한다. 절반 아래로 떨어지면 응답 서식이 바뀐 것으로 본다.
  expectMinRows: 25,
  allowUndatedRows: true,
};
