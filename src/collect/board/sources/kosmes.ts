import type { BoardConfig, BoardRow } from "../types";

/**
 * 중소벤처기업진흥공단 알림광장 > 공지/알림 > 공지사항 (탭1: 중소벤처기업진흥공단).
 *
 * 왜 연결했나(2026-09-03 실측): 지원사업 모집공고(AI 활용 포상·CBAM MRV·산업안전구축·
 * 정책자금 융자·챌린지진단·수출지원기반활용 등)가 여기 탭1에 올라온다.
 *
 * 구조:
 * · 목록 화면 GET `/nsh/SH/NTS/SHNTS001M0.do` 는 뼈대(정적 `<tr>` 5개뿐)다.
 *   실제 행은 **POST** `/sh/nts/notice_list.json` 응답 `ds_infoList[]`.
 * · 본문 `nowPage={쪽}&pageCount=10&rowCount=10&param=proc%3DList&bKind=popluar&activatedTab=01`
 *   ※ `popluar` 는 사이트 철자 그대로 — `popular` 로 고치면 거절된다.
 * · 한 쪽 10건 · 전체 약 4쪽(pageInfo.maxPage=4, rowMax=40).
 * · 제목 `TITL_NM` · 열쇠 `SLNO` · 등록일 `REG_DTM`(YYYY-MM-DD).
 *   `VALI_DT` 는 게시 유효기간 종료일이 같이 오지만 신청마감일과 같은지는 본문 대조를 못 해
 *   마감으로 쓰지 않는다 — **등록일만** 「등록일 ~」 개시형.
 * · 상세 GET `/nsh/SH/NTS/SHNTS001F0.do?seqNo={SLNO}` (정적 HTML 은 뼈대, 본문은
 *   같은 JSON 을 `proc=View` 로 다시 부르는 AJAX — 본문 칸을 확정 못 해 선택자는 비운다).
 * · 탭2(유관기관, activatedTab=02)는 안 본다. 지원사업 모집은 탭1에 있다.
 *
 * 브라우저 User-Agent 없이 같은 POST 를 보내면 200 이지만
 * `{"pageInfo":{"resultCd":"999","resultMsg":"시스템 오류가 발생하였습니다."}}` 로 거절된다.
 * 엔진이 이미 UA 를 붙인다.
 */
const BASE = "https://www.kosmes.or.kr";
const LIST_API = `${BASE}/sh/nts/notice_list.json`;
const VIEW = `${BASE}/nsh/SH/NTS/SHNTS001F0.do`;
const PER_PAGE = 10;

type KosmesRow = {
  SLNO?: string | number;
  TITL_NM?: string;
  REG_DTM?: string;
  VALI_DT?: string;
  BADGE_CD?: string;
  CATG_CD?: string;
};

/**
 * 지원사업이 아닌 글. **버릴 것만** 지정한다.
 * ★`채용` 을 통째로 버리면 안 된다(적대 리뷰 중요) — 고용보조금은 제목에 「채용」을 쓴다.
 *   기관이 사람을 뽑는 글(`직원 채용`·`채용 공고`)만 좁게 버린다.
 *
 * 실측 DROP: 「종합청렴도 … 제3자 제공사항 알림」·「정책자금 기준금리」·
 * 「우대금리 … 유예기간 안내」·「수행기관 선정 결과 공지」.
 */
const DROP =
  /선정\s*결과|선정결과|기준금리|청렴도|제3자\s*제공|유예기간\s*안내|입찰|설문|평가위원|합격자|(?:신규|경력|직원)\s*채용\s*(?:공고|안내)|채용\s*공고/;

/** 시험이 제목 글자만으로 거르개를 잴 수 있게 내보낸다. */
export function isKosmesDropTitle(title: string): boolean {
  return DROP.test(title);
}

/** 붙박이 공지 중 **1년 넘게 붙어 있는 것은 버린다**(한국수출입은행과 같은 이유). */
const PINNED_MAX_AGE_MS = 365 * 24 * 3600_000;

/** "2026-09-01" → "2026-09-01". 값이 없거나 날짜가 아니면 빈 문자열. */
function ymd(raw: string | undefined): string {
  const m = (raw ?? "").match(/(20\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
  return m ? `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}` : "";
}

export function parseKosmesList(jsonText: string, _page = 1, now = Date.now()): BoardRow[] {
  let raw: KosmesRow[] = [];
  try {
    const d = JSON.parse(jsonText) as { ds_infoList?: KosmesRow[] };
    if (Array.isArray(d?.ds_infoList)) raw = d.ds_infoList;
  } catch {
    return [];
  }
  const out: BoardRow[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    const slno = String(r.SLNO ?? "").trim();
    const title = (r.TITL_NM ?? "").replace(/\s+/g, " ").trim();
    if (!slno || !title || seen.has(slno)) continue;
    if (isKosmesDropTitle(title)) continue;
    const d = ymd(r.REG_DTM);
    /**
     * ★붙박이(BADGE_CD=중요)는 **등록일을 개시일로 넘기지 않는다.**
     * 실측 1쪽 맨 위 「새정부 출범 … 중진공의 성과」는 등록일이 3월인데 목록 1번째에 항상 있다.
     * 저장 쪽 `openStartExpired` 의 예외 `PINNED_NOTICE` 는 제목이 「[공지]」로 **시작**해야만
     * 걸려, 이 제목은 안 걸린다 → 등록일을 넘기면 저장 즉시 마감된다.
     * 날짜를 비우면 `undatedStale`(처음 본 날 기준)로 넘어가 붙어 있는 동안 모집중으로 남는다.
     *
     * 1년 넘게 붙어 있는 붙박이는 아예 안 담는다 — 날짜를 비우면 처음 본 날부터 90일간 되살아난다.
     */
    const pinned = (r.BADGE_CD ?? "").trim() === "중요";
    if (pinned && d && now - Date.parse(`${d}T00:00:00Z`) > PINNED_MAX_AGE_MS) continue;
    seen.add(slno);
    out.push({
      title,
      // nowPage 는 쪽 번호라 넣으면 같은 글이 쪽마다 다른 sourceId 가 된다.
      detailUrl: `${VIEW}?seqNo=${encodeURIComponent(slno)}`,
      dateText: pinned || !d ? "" : `${d} ~`,
      category: (r.CATG_CD ?? "").replace(/\s+/g, " ").trim(),
    });
  }
  return out;
}

export const kosmesConfig: BoardConfig = {
  id: "kosmes",
  label: "중소벤처기업진흥공단 공지",
  agency: "중소벤처기업진흥공단",
  region: "전국",
  baseUrl: `${BASE}/`,
  charset: "utf-8",
  list: {
    // POST 라 주소는 쪽과 무관하게 같다 — 쪽 번호는 init 의 본문이 나른다.
    url: () => LIST_API,
    maxPages: 4,
    init: (p) => ({
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded; charset=utf-8" },
      body: `nowPage=${p}&pageCount=${PER_PAGE}&rowCount=${PER_PAGE}&param=${encodeURIComponent("proc=List")}&bKind=popluar&activatedTab=01`,
    }),
    // JSON 이라 선택자 갈래는 안 쓴다. customParse 가 없을 때만 보는 값이라 빈 자리를 채워 둔다.
    rowSelector: "",
    fields: { title: {}, detailUrl: {}, date: {} },
  },
  customParse: parseKosmesList,
  /**
   * 상세 본문·첨부 선택자를 **일부러 안 적는다.**
   * GET `SHNTS001F0.do?seqNo=` 정적 HTML 은 레이아웃 뼈대이고, 본문·첨부는
   * POST `/sh/nts/notice_list.json` (`param=proc=View&seqNo=`) 가 `ds_infoMap` 으로 채운다.
   * 본문 칸 이름을 실측으로 확정하지 못해 선택자를 비운다 — 짧은 껍데기를 `targetText` 에
   * 채우면 뒷단계의 첨부 본문 뽑기가 이 공고를 영영 건너뛴다.
   */
  // 한 쪽 10건을 요청한다. 절반 아래로 떨어지면 응답 서식이 바뀐 것으로 본다.
  expectMinRows: 5,
};
