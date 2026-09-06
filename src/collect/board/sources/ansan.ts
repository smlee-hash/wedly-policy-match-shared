import { parseHtml } from "../html";
import type { BoardConfig, BoardRow } from "../types";

/**
 * 안산시 기업지원 공고 — 시 고시/공고 통합게시판(`bbs_code=WWW13`)을 **담당부서 넷**으로 좁혀 읽는다.
 *
 * 왜 이 주소인가(2026-09-03 실측): 안산시엔 기업지원 전용 게시판이 없다. 시 전체 고시/공고가
 * 한 게시판에 17,162건/1,145쪽으로 쌓여 있고 건축법 위반·세무조사까지 섞여 있어 통째로는 못 쓴다.
 * 이 게시판의 검색폼에 **담당부서 필터**(`sch_type=departSearch`)가 있어 부서명으로 좁힌다.
 *
 * ★2026-09-03 「누락 0」 회차에 **기업지원과 하나에서 넷으로 늘렸다**(총건수 실측):
 *   기업지원과 84 · 소상공인지원과 140 · 노동일자리과 137 · 산업진흥과 15 = 376건.
 *   (철도경제자유과 28건은 철도·경제자유구역 행정 고시라 아직 안 켠다.)
 *
 * ★부서를 **한 쪽씩 돌아가며** 읽는다(`ansanTargetOf`, kita 방식) — 1쪽=기업지원과 1 ·
 *   2쪽=소상공인지원과 1 · 3쪽=노동일자리과 1 · 4쪽=산업진흥과 1 · 5쪽=기업지원과 2 …
 *   ⓐ 한 부서의 두 쪽을 붙여 두면 안 된다 — 엔진은 「신규 0인 쪽이 **연속 둘**」이면 멈추는데,
 *      그 규칙은 「이 부서가 바닥났다」와 「전체가 끝났다」를 구분하지 못한다. **산업진흥과는
 *      15건뿐이라 2쪽이 0행**이라, 붙여 두면 그 자리에서 뒤 부서가 통째로 잘린다
 *      (2026-09-03 적대 리뷰 지적 ①). 한 쪽씩 돌리면 그 빈 쪽이 다른 부서 사이에 끼어 연속이 안 된다.
 *   ⓑ 그래서 **부서마다 같은 쪽 수(2쪽)를 준다** — 「지금 15건이니 산업진흥과는 1쪽만」처럼
 *      순간값에 맞춰 자르지 않는다(지적 ②). 그 부서가 늘면 2쪽이 저절로 들어온다.
 *   ⓒ 대신 `url(1)`·`url(2)` 는 부서명(`sch_text`)만 다르고 쪽 번호가 둘 다 1 이라
 *      엔진의 쪽 번호 변수 찾기가 부서명을 쪽 변수로 착각할 수 있다. 상세 주소는 `bbs_seq` 로만
 *      조립해 **쪽 정보도 검색어도 아예 없으므로** 지울 것이 없다 —
 *      `deep-paging.test.ts` 의 `PAGING_WITHOUT_URL_PARAM` 에 등록해 뒀다.
 *   ⓓ 실측으로 이 8쪽이 부서별로 기업지원과 2025-10 · 소상공인 2025-12 · 노동일자리 2026-01 ·
 *      산업진흥 2024-02 까지 닿는다 — 저장 단계의 「등록 90일 자동 마감」 창보다 훨씬 깊다.
 * 목록 HTML 은 서버에서 다 그려져 오므로 JS 실행이 필요 없다.
 * ⚠️ 쪽 크기 변수는 없다(2026-09-03 실측: pageSize·rowCount·pageUnit 등 10가지 전부 15건 그대로).
 *
 * 구조: `table.p-table.simple tbody tr`(한 쪽 15건) — 칸 5개 「번호 / 고시공고번호 / 제목 /
 * 담당부서 / 작성일」. 제목 앵커의 `href` 는 `#` 뿐이라 못 쓰고,
 * `onclick="fnGoDetail( 1681706 ); return false;"` 에서 seq 를 뽑아 상세 주소를 조립한다
 * (사이트 본체는 그 값을 숨은 폼에 넣어 `selectBbsDetail.do` 로 GET 제출한다 — 실측 fnGoDetail 정의).
 * 쪽넘김은 `&currentPage=n` GET(1쪽·2쪽 제목이 실제로 다름을 고정본으로 확인).
 * 목록은 **작성일(등록일)만** 준다 — 접수기간은 상세 본문 안 자유 텍스트라 목록엔 없다.
 * 그래서 `dateText` 는 「등록일 ~」 개시형으로 넘긴다(마감형으로 넘기면 저장 즉시 마감된다).
 */
const BASE = "https://www.ansan.go.kr";
const LIST = "/www/common/bbs/selectPageListBbs.do";
const VIEW = "/www/common/bbs/selectBbsDetail.do";
const BBS = "WWW13";
/**
 * 읽을 담당부서. 순서가 곧 도는 순서다. 담당부서 필터는 코드가 아니라
 * **부서 이름 글자**로 건다(검색폼 `sch_text`).
 */
const DEPTS = ["기업지원과", "소상공인지원과", "노동일자리과", "산업진흥과"] as const;
/** 부서마다 몇 쪽까지 읽을지(상한 = DEPTS.length × 이 값). 부서마다 **같은 값**이다(위 주석 ⓑ). */
const PAGES_PER_DEPT = 2;

/** 엔진 쪽 번호 → 「어느 부서의 몇 쪽」. 시험이 사상을 그대로 잴 수 있게 내보낸다. */
export function ansanTargetOf(p: number): { dept: string; page: number } {
  const i = Math.max(1, Math.floor(p)) - 1;
  // 한 바퀴에 부서 하나씩 한 쪽(위 주석 ★ⓐ) — A1 B1 C1 D1 A2 B2 …
  return { dept: DEPTS[i % DEPTS.length], page: Math.floor(i / DEPTS.length) + 1 };
}
const SEQ = /fnGoDetail\(\s*(\d+)\s*\)/;
const YMD = /(20\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})/;

/**
 * 지원사업이 아닌 글. **버릴 것만** 좁게 지정한다.
 *
 * 이 게시판은 부서로만 좁힌 것이라 같은 부서가 내는 **행정 처분 고시**가 섞인다.
 * 실측(1·2쪽 30건 중 11건): 「행정대집행 공시송달 공고」·「건축법 위반사항 이행강제금 부과계고
 * 공시 송달」(띄어쓰기 변형 있음)·「국토의 계획 및 이용에 관한 법률, 건축법 위반 처분 사전통지
 * 공시송달」·「기업지원과 자재보관소CCTV 추가설치에 따른 행정예고」·
 * 「안산스마트허브 내 계량기 정기검사 실시 공고」(규제 검사 안내)·같은 검사의 「기간제근로자 공개모집」.
 *
 * ★`채용` 을 통째로 버리면 안 된다(bizbc 주석) — 「채용 지원사업」이 함께 죽는다.
 *   기관이 사람을 뽑는 글(`직원 채용 공고`·`기간제근로자`)만 좁게 버린다.
 * ★「중소기업대상 시상 계획 공고」는 **버리지 않는다.** 상금·인증이 붙는 기업 대상 공모라
 *   이 저장소 방침(수집은 넓게, 걸러내기는 회사별 매칭에서)에 따라 담는다.
 */
const DROP =
  /공시\s*송달|행정대집행|이행강제금|행정예고|계량기\s*정기검사|기간제근로자|입찰\s*공고|낙찰|설문|합격자|평가위원|(?:신규|경력|직원)\s*채용\s*(?:공고|안내)|채용\s*공고/;

/**
 * ★거르개보다 **먼저** 보는 구제 규칙(2026-09-03 적대 리뷰 지적 ⑦).
 * 포괄 `설문`·`입찰 공고` 는 「소비자 **설문 조사 지원사업 참여기업 모집**」처럼 버릴 낱말이
 * **사업 이름 안에** 든 진짜 모집 공고까지 죽인다. 「지원사업·참여기업·신청기업…」 같은
 * **사업 표식**과 「모집·신청·접수·공모」가 함께 있으면 거르지 않는다.
 * 표식이 없는 「기간제근로자 공개모집」·「직원 채용 공고」는 그대로 걸린다.
 */
const RESCUE_SUBJECT = /지원\s*사업|참여\s*기업|신청\s*기업|참가\s*기업|참여\s*기관|지원\s*금|육성\s*사업|참가\s*업체/;
const RESCUE_ACTION = /모집|신청|접수|공모|참가/;
const RESCUE_NEVER = /용역|입찰\s*참가|채용|직원|근로자|위촉|공개\s*모집/;

/** 버릴 낱말이 있어도 「지원사업 + 모집」이면 살린다. */
export function isAnsanRescued(title: string): boolean {
  // 낱말이 있어도 조달·채용 글이면 구제하지 않는다 — 「지원사업 운영 용역 입찰 참가 신청 공고」·「지원사업 담당 직원 채용 공고」(코덱스 지적 2026-09-03).
  if (RESCUE_NEVER.test(title)) return false;
  return RESCUE_SUBJECT.test(title) && RESCUE_ACTION.test(title);
}

/** 시험이 제목 글자만으로 거르개를 잴 수 있게 내보낸다. */
export function isAnsanDropTitle(title: string): boolean {
  if (isAnsanRescued(title)) return false;
  return DROP.test(title);
}

/**
 * 붙박이 공지 중 **1년 넘게 붙어 있는 것은 버린다**(koreaexim 방식).
 * 붙박이는 날짜를 비워 저장하는데, 그러면 처음 본 날부터 90일간 「모집중」이 된다.
 * 부서로 좁힌 고정본엔 붙박이가 없었지만, 부서를 바꾸거나 시가 공지를 고정하면 바로 생긴다 —
 * 번호 칸이 숫자가 아니라 「공지」인 줄이 그것이다.
 */
const PINNED_MAX_AGE_MS = 365 * 24 * 3600_000;

export function parseAnsanList(html: string, _page = 1, now = Date.now()): BoardRow[] {
  const out: BoardRow[] = [];
  const seen = new Set<string>();
  for (const tr of parseHtml(html).querySelectorAll("table.p-table.simple tbody tr")) {
    const a = tr.querySelector("td.p-subject a");
    const seq = (a?.getAttribute("onclick") ?? "").match(SEQ)?.[1] ?? "";
    if (!seq || seen.has(seq)) continue;
    const title = (a?.text ?? "").replace(/\s+/g, " ").trim();
    // ★`DROP.test` 를 직접 부르지 않는다 — 구제 규칙(위 `isAnsanRescued`)을 지나쳐
    //   「입찰 지원사업 참여기업 모집」이 다시 죽는다. 시험이 재는 함수와 같은 길로 판정한다.
    if (!title || isAnsanDropTitle(title)) continue;
    /**
     * 작성일은 **칸 순번**으로 집는다(thead: 번호/고시공고번호/제목/담당부서/작성일 → 5번째 td).
     * 칸에 클래스가 없어 순번 말고는 가릴 길이 없다.
     * ⚠️ 행 전체 글자(`tr.text`)에서 정규식으로 찾으면 안 된다 — 칸이 이어 붙어
     *    번호 「84」 + 고시공고번호 「…제2026-21호」가 날짜처럼 보이는 자리를 만든다(hsbiz 실측 함정).
     */
    const tds = tr.querySelectorAll("td");
    const dateCell = (tds[4]?.text ?? "").replace(/\s+/g, " ").trim();
    const d = dateCell.match(YMD);
    const ymd = d ? `${d[1]}-${d[2].padStart(2, "0")}-${d[3].padStart(2, "0")}` : "";
    const noCell = (tds[0]?.text ?? "").replace(/\s+/g, " ").trim();
    const pinned = /공지/.test(noCell);
    // 오래 붙어 있는 붙박이는 아예 안 담는다 — 날짜를 비우면 처음 본 날부터 90일간 되살아난다.
    if (pinned && ymd && now - Date.parse(`${ymd}T00:00:00Z`) > PINNED_MAX_AGE_MS) continue;
    seen.add(seq);
    out.push({
      title,
      // ★쪽 번호(currentPage)·검색어를 넣지 않는다 — 주소가 곧 중복 판정 열쇠(sourceId)라
      //   같은 글이 쪽마다 다른 줄로 저장된다.
      detailUrl: `${BASE}${VIEW}?bbs_code=${BBS}&bbs_seq=${seq}`,
      dateText: pinned || !ymd ? "" : `${ymd} ~`,
      // 담당부서 칸. 부서 필터를 넓히면 여기서 어느 부서 글인지 남는다.
      category: (tds[3]?.text ?? "").replace(/\s+/g, " ").trim(),
      agency: "안산시",
    });
  }
  return out;
}

export const ansanConfig: BoardConfig = {
  id: "ansan",
  label: "안산시 기업지원 공고",
  agency: "안산시",
  region: "경기",
  baseUrl: `${BASE}/`,
  charset: "utf-8",
  list: {
    // 부서 넷을 두 쪽씩 번갈아(위 주석 ★). 한글 부서명은 주소에 넣기 전에 인코딩한다 —
    // 안 하면 요청마다 인코딩이 달라져 같은 쪽을 다른 주소로 두 번 부른다.
    url: (p) => {
      const t = ansanTargetOf(p);
      return `${BASE}${LIST}?bbs_code=${BBS}&sch_type=departSearch&sch_text=${encodeURIComponent(t.dept)}&currentPage=${t.page}`;
    },
    /**
     * 부서 4곳 × 2쪽 = 8. 실측 87건이 이 안에서 나온다
     * (기업지원과 9+10 · 소상공인 13+14 · 노동일자리 15+13 · 산업진흥 13+0).
     * 산업진흥과 2쪽은 지금 0행이지만 **일부러 남긴다** — 그 부서가 늘면 저절로 들어오고,
     * 한 쪽씩 도는 배치라 그 빈 쪽이 다른 부서를 자르지 못한다(위 주석 ★ⓐⓑ).
     * ★7 을 넘겼으므로 `deep-paging.test.ts` 의 `DEEP_PAGING_ALLOWED` 에 안산을 등록했다
     *   (등록일만 주지만 저장 단계의 「등록 90일 자동 마감」이 옛 글을 닫아 준다).
     */
    maxPages: DEPTS.length * PAGES_PER_DEPT,
    rowSelector: "table.p-table.simple tbody tr",
    fields: {
      title: { selector: "td.p-subject a" },
      detailUrl: { selector: "td.p-subject a", attr: "onclick", regex: "fnGoDetail\\(\\s*(\\d+)\\s*\\)" },
      date: { selector: "td:nth-child(5)" },
    },
  },
  customParse: parseAnsanList,
  /**
   * 상세 본문 — 2026-09-03 실측(`selectBbsDetail.do?bbs_code=WWW13&bbs_seq=1681706`).
   * 본문 표의 제목 줄·내용 줄이 둘 다 `tr.p-table__subject` 라 함께 집는다(제목 32자 + 내용 325자).
   * 목록에 없는 **모집기간·모집대상·지원규모**가 여기 자유 텍스트로 들어 있어 꼭 읽어야 한다
   * (실측: 「○모집기간 : 2026. 9. 2.(수) ~ 9. 16.(수)」·「○모집대상 : 안산시 관내 소재 중소기업으로
   * 전년도 수출실적 2,000만불 이하 기업」).
   */
  detailContentSelector: "tr.p-table__subject td",
  /**
   * 첨부 칸은 `ul.p-attach` 하나뿐이다(실측 4개 파일).
   * ⚠️ 다만 이 게시판 첨부는 `href="#"` + `onclick="fnFileDownLoad('<파일열쇠>')"` 라
   *    지금의 첨부 수확기가 아는 모양(eGov·서울TP·직접 링크)이 아니어서 **0건이 수확된다.**
   *    상세 페이지 전체를 훑어도 파일 주소가 0건이라 결과는 같지만, 범위를 여기로 못 박아
   *    나중에 머리글·바닥글에 매뉴얼 PDF 가 생겨도 섞이지 않게 한다(비즈OK 오염 사례).
   */
  attachmentsScopeSelector: "ul.p-attach",
  /**
   * ★heuristic 추측을 끈다. 이 목록은 **행마다 진짜 링크가 하나도 없다**(제목 앵커가 `href='#'`).
   * 추측 단계는 「행에서 가장 긴 링크」를 상세 주소로 삼으므로 15줄이 전부
   * `https://www.ansan.go.kr/#` 한 주소로 뭉개져 쓰레기 한 줄이 저장된다
   * (그 줄은 다음 회차에 지워지지 않는다 — 수출입은행 실측).
   */
  skipHeuristic: true,
  /**
   * ★낮게 둔다(3). 이 값은 **첫 쪽(기업지원과 1쪽) 하나로 출처 전체의 채택 여부**를 가른다 —
   * 그 쪽에 행정 처분 고시가 몰린 날 부서 넷이 통째로 실패한다(2026-09-03 적대 리뷰 지적 ⑥).
   * 서식이 깨지면 어차피 customParse 가 0행을 내어 「행 0개」로 걸린다.
   */
  expectMinRows: 3,
};
