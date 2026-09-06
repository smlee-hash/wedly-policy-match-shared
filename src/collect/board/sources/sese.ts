import type { BoardConfig, BoardRow } from "../types";

/**
 * 한국사회적기업진흥원 공지사항.
 *
 * 왜 연결했나(2026-09-02 실측): 최신 6건을 우리 DB 9,565건과 제목으로 대조했더니
 * 이미 들어옴 0 · 애매 3 · **신규 3**. 「지방자치단체 사회적경제정책 평가사업 모집」·
 * 「맞춤형 판로지원사업(소셜벤더 운영) 참여기업 모집」·「사회적가치 비즈니스 모델 공모전」이
 * 통합 수집원으로는 한 건도 안 들어온다. 총 4,177건에 **최신글이 어제**라 살아 있는 게시판이다.
 *
 * ★루트 주소(`https://www.socialenterprise.or.kr`)는 8KB 짜리 관문 화면이다 — 본 사이트는 `/homepage/`.
 *   목록 화면 HTML 은 핸들바 서식({{var …}})이라 행이 안 보이는데, 그 스크립트가 부르는
 *   **POST `/homepage/bbs/ajax/boardList.do`** 가 JSON 으로 행을 그대로 준다. 실브라우저 불필요.
 *
 * 구조:
 * · 응답 `resultList[]`(한 쪽 10건) + `noticeList[]`(맨 위 붙박이) · `paginationInfo.totalRecordCount` = 4,177
 * · `SUBJECT` · `WRITE_DATE`("2026/09/01") · `B_IDX`(상세 열쇠) · `ADD_COLUMN03`(담당 부서)
 * · **등록일만** 준다 — 「등록일 ~」 개시형으로 넣고 마감 정리는 저장 쪽 「등록 90일」 규칙에 맡긴다
 * · 상세 GET `/homepage/bbs/boardView.do?bsIdx=10002&bIdx={B_IDX}&page=1&menuId=822` (200/175KB 실측)
 */
const BASE = "https://www.socialenterprise.or.kr";
const LIST_API = `${BASE}/homepage/bbs/ajax/boardList.do`;
const BS_IDX = "10002";
const MENU_ID = "822";

type SeseRow = {
  B_IDX?: string | number;
  SUBJECT?: string;
  WRITE_DATE?: string;
  NOTICE_YN?: string;
};

/**
 * 지원사업이 아닌 글. **버릴 것만** 지정한다 — 허용목록(KEEP)은 「~ 안내」로 끝나는
 * 진짜 지원사업을 통째로 죽인다(hsbiz 에서 겪음).
 *
 * 실측 20건(1·2쪽)에서 절반 가까이가 **권역센터 교육 안내**였다:
 *   「하반기 (사회적)협동조합 경영공시 교육 안내(9.2.(수) …)」·「사회적협동조합 설립인가교육」·
 *   「사회적가치지표(SVI) 측정 대비 교육」·「9월 인증 설명회(09.09(수) …)」 — 날짜만 바뀌어 매달 올라온다.
 * 그 밖에 「개인정보보호 퀴즈 이벤트」·「1차 심사 결과 공고」(결과 발표)·「접수 마감 계획 안내」.
 *
 * ★`교육` 을 통째로 버리지 않는다 — 「특화 멘토링 지원사업」처럼 교육이 딸린 지원사업이 있고,
 *   「교육생 모집」은 진짜 지원사업이다. **「교육 안내」·「교육 신청」 꼴로만** 좁힌다.
 * ★`채용` 도 통째로 버리지 않는다 — 고용보조금은 제목에 「채용」을 쓴다(cwip 에서 겪음).
 */
const HARD_DROP = /퀴즈|심사\s*결과|결과\s*공고|선정\s*결과|접수\s*마감\s*계획|입찰|낙찰|용역\s*공고/;
/** 행사·교육을 가리키는 말. 이것만으로는 못 버린다 — 아래 REAL_CALL 과 함께 본다. */
const EVENT = /교육|설명회|간담회|워크숍|워크샵|포럼|세미나/;
/**
 * 「신청해서 혜택을 받는 것」을 가리키는 말. EVENT 가 있어도 이게 함께 있으면 **살린다.**
 * 처음엔 「교육 안내」·「설명회 안내」 꼴만 버렸는데, 2쪽의
 * 「[서울·인천센터] 2026년 서울·인천 권역 9월 인증 설명회(09.09(수), 09.29(화))」가
 * 「안내」 없이 괄호로 이어져 그대로 통과했다(시험이 잡았다). 낱말 꼴로 좁히는 대신
 * **「부름(모집·공모)이 있는가」**로 가른다 — 이쪽이 제목 서식 변화에 안 흔들린다.
 */
const REAL_CALL = /모집|공모|참여기업|지원사업|선발|접수합니다/;

/** 시험이 제목 글자만으로 거르개를 잴 수 있게 내보낸다(HTML/JSON 을 지어내지 않기 위해). */
export function isSeseDropTitle(title: string): boolean {
  if (HARD_DROP.test(title)) return true;
  return EVENT.test(title) && !REAL_CALL.test(title);
}

/**
 * 제목 앞 대괄호가 **지자체 이름**이면 그것이 실제 공고 기관이다.
 * 이 게시판은 「[전라남도] 2026년도 1차 예비사회적기업 지정 공모」처럼 지자체 공고를 옮겨 싣는데,
 * 기관을 「한국사회적기업진흥원」으로 못 박으면 중복 열쇠(`제목|기관`)가 갈려 기업마당의
 * 같은 공고와 안 묶인다(화성 hsbiz 에서 겪은 그 갈래).
 *
 * ⚠️ 대괄호가 전부 기관인 것은 아니다 — 실측에 「[공고문]」(글머리표)·「[세종대전충청센터]」·
 *    「[경기강원센터]」(진흥원 자기 권역센터)가 섞여 있다. 그래서 **지자체 꼴로 끝날 때만** 쓴다.
 */
export function seseAgencyOf(title: string): string | undefined {
  const m = title.match(/^\s*[[［【]\s*([^\]］】]{2,12})\s*[\]］】]/);
  const inner = (m?.[1] ?? "").trim();
  if (!inner) return undefined;
  if (!/(특별시|광역시|특별자치시|특별자치도|[가-힣]{2,}도|[가-힣]{2,}시|[가-힣]{2,}군|[가-힣]{2,}구)$/.test(inner)) {
    return undefined;
  }
  return inner;
}

/** "2026/09/01" → "2026-09-01". 날짜가 아니면 빈 문자열. */
function ymd(raw: string | undefined): string {
  const m = (raw ?? "").match(/(20\d{2})[./\-](\d{1,2})[./\-](\d{1,2})/);
  return m ? `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}` : "";
}

export function parseSeseList(jsonText: string): BoardRow[] {
  let list: SeseRow[] = [];
  let notices: SeseRow[] = [];
  try {
    const d = JSON.parse(jsonText) as { resultList?: SeseRow[]; noticeList?: SeseRow[] };
    if (Array.isArray(d?.resultList)) list = d.resultList;
    if (Array.isArray(d?.noticeList)) notices = d.noticeList;
  } catch {
    return [];
  }
  const out: BoardRow[] = [];
  const seen = new Set<string>();
  // 붙박이를 먼저 담되 날짜는 비운다(아래 이유) — 뒤에 같은 글이 일반 행으로 또 와도 중복 제거가 잡는다.
  for (const [rows, pinned] of [
    [notices, true],
    [list, false],
  ] as Array<[SeseRow[], boolean]>) {
    for (const r of rows) {
      const id = String(r.B_IDX ?? "").trim();
      const title = (r.SUBJECT ?? "").replace(/\s+/g, " ").trim();
      if (!id || !title || seen.has(id)) continue;
      if (isSeseDropTitle(title)) continue;
      seen.add(id);
      const d = ymd(r.WRITE_DATE);
      /**
       * ★붙박이 공지는 **등록일을 개시일로 넘기지 않는다.**
       * 저장 쪽 `openStartExpired` 는 「마감일 없음 + 개시일 90일 초과」면 저장 시점에 닫는데,
       * 그 예외 `PINNED_NOTICE` 는 제목이 「[공지]」로 **시작**해야만 걸린다. 이 게시판의 붙박이는
       * 「[공고문] …」·「2026 …」로 시작해 안 걸린다 → 오래 붙어 있는 글이 저장 즉시 마감된다.
       * 날짜를 비우면 `undatedStale`(처음 본 날 기준)로 넘어가 붙어 있는 동안은 모집중으로 남는다.
       */
      out.push({
        title,
        detailUrl: `${BASE}/homepage/bbs/boardView.do?bsIdx=${BS_IDX}&bIdx=${encodeURIComponent(id)}&menuId=${MENU_ID}`,
        dateText: pinned || (r.NOTICE_YN ?? "") === "Y" || !d ? "" : `${d} ~`,
        category: "",
        agency: seseAgencyOf(title),
      });
    }
  }
  return out;
}

export const seseConfig: BoardConfig = {
  id: "sese",
  label: "한국사회적기업진흥원",
  agency: "한국사회적기업진흥원",
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
      body: `bsIdx=${BS_IDX}&menuId=${MENU_ID}&page=${p}`,
    }),
    rowSelector: "",
    fields: { title: {}, detailUrl: {}, date: {} },
  },
  customParse: parseSeseList,
  /**
   * ★`detailContentSelector` 를 **일부러 안 적는다**(적대 리뷰 지적 반영).
   * 상세 본문(`div.view-contents-wrp`)은 실측 183자짜리 표지문이고 자격조건은 첨부 공고문에 있다.
   * 그 183자를 `targetText` 에 채우면 뒷단계의 「첨부에서 본문 뽑기」가 `targetText === ""`
   * 조건에서 이 공고를 영영 건너뛴다 — 선택자를 비워 첨부 길을 열어 둔다.
   * (참고로 `div.view-wrp` 는 절대 쓰면 안 된다 — 21,503자 중 20,751자가 자바스크립트 코드다.)
   */
  attachmentsScopeSelector: "div.view-file-wrp",
  /**
   * ★첨부는 **`Referer` 가 있어야** 내려온다(2026-09-06 curl 실측, bIdx=252611 의
   * `cmmn/download.do?idx=jlcAkbgl…`):
   * · 그냥 GET → 200 + `text/html` **91바이트** (`<script>alert('…`)
   * · 저장된 상세 주소를 `Referer` 로 붙이면 → 200 + `content-disposition: attachment` +
   *   PDF 771,077바이트(`%PDF-1.4`). 같은 글의 hwpx 도 237,806바이트(`PK`)로 열린다.
   * 쿠키는 필요 없다(쿠키를 함께 실어도 결과가 같다) — 그래서 `warmup` 은 켜지 않는다.
   * 이 옵션이 없던 동안 열린 공고 24건 중 23건이 「읽지 못한 첨부」로 남았다.
   */
  attachmentSession: { referer: "detail" },
  /**
   * ★1로 둔다(적대 리뷰 지적). 2로 두면 「최신 10건 중 9건이 교육·행사이고 지원사업이 1건」인 날
   * 정상 응답인데도 1쪽이 통째로 파싱 실패로 처리돼 **2쪽 이후의 정상 공고까지 다 못 가져온다.**
   * 이 게시판은 거르개가 절반을 버리는 곳이라(실측 10건 → 5건) 그 날이 실제로 올 수 있다.
   * 0행은 여전히 서식 변경으로 잡힌다.
   */
  expectMinRows: 1,
};
