import type { BoardConfig, BoardFetchInit, BoardRow } from "../types";

/**
 * (재)헬스케어스파산업진흥원(아산시 출연기관) 공지사항 — **화면은 AngularJS 껍데기, 자료는 JSON 통로**.
 *
 * 왜 이렇게 읽나(2026-09-06 실측): 목록 화면 `main/index.php?m_cd=23` 의 표는
 * `<tr ng-repeat="obj in ctl.data">` 한 줄뿐이고 서버가 준 행이 **0개**다. 실제 자료는 그 화면이
 * 뒤에서 부르는 `bbs2/bbs_gate.php?cmd=get_blist&pm_id=23` 가 **JSON 배열로 전량(16건)** 을
 * 한 번에 준다(쪽 변수 자체가 없다 · 같은 날 curl 200/8,586바이트 재확인).
 * 그래서 `list.url` 을 그 통로로 두고 `customParse` 가 JSON 을 읽는다 — `feed` 갈래는
 * 값을 그대로 옮기기만 해서 상세 주소 조립(`b_id`)도 거르개도 못 한다.
 *
 * 상세는 `main/index.php?m_cd=23&b_id={b_id}` 인데 여기도 서버가 준 HTML 에는 본문 태그가 없고
 * **`var r_data = {…}` 라는 JSON 덩어리**만 박혀 있다(고정본 `hespa-detail.html` 513행).
 * 그래서 `detailFetch` 로 그 덩어리에서 본문(`b_cont`)·첨부 목록(`f_list`)을 꺼내 HTML 로 돌려준다 —
 * 선택자(`detailContentSelector`·`attachmentsScopeSelector`)는 이 갈래에서 아예 안 쓰인다.
 *
 * 첨부는 `../bbs2/file_download.php?fname=<원본 파일명(한글 그대로)>` 이고 **쿠키·열쇠가 필요 없다**
 * (실측 200 · `content-disposition: attachment` · 998,564바이트 hwpx). 그래서 `attachmentSession`
 * 도 `attachmentToken` 도 안 쓴다.
 *
 * robots(https://hespa.or.kr/robots.txt · 200): 두 줄뿐 — `User-agent: Yeti` / `Allow:/`.
 * 다른 UA 에 대한 금지 규칙이 아예 없다.
 *
 * 양: 총 16건 · 약 13.5개월 ≈ 월 1.2건. 기업 대상은 「굿스파 인증」 계열이 중심이다.
 */
const BASE = "https://hespa.or.kr";
/** 상대 첨부(`../bbs2/…`)를 절대화하는 기준 — 상세·목록 화면이 사는 곳이라 `/main/` 로 둔다. */
const BASE_URL = `${BASE}/main/`;
/** 공지사항 게시판 번호. 24=입찰정보·25=채용공고·26=진흥원소식·31=보도자료는 **읽지 않는다**. */
const PM_ID = 23;
const LIST_API = `${BASE}/bbs2/bbs_gate.php?cmd=get_blist&pm_id=${PM_ID}`;
const VIEW = `${BASE}/main/index.php?m_cd=${PM_ID}`;
const YMD = /^(20\d{2})-(\d{2})-(\d{2})/;

/**
 * 지원사업이 아닌 글. **버릴 것만** 지정한다 — 허용목록(KEEP)은 「~ 안내」형 지원사업을 죽인다(hsbiz).
 *
 * 실측 16건에서 버리는 것(2026-09-06):
 * · `[유관기관]` 말머리 4건 — KMI·KTL 공고를 그대로 옮긴 재게시라 이미 연결된 국책기관 출처와 겹친다.
 * · 시민 대상 프로그램 2건 — 「[2026 어린이 온천과학캠프] 참여자 모집」·
 *   「[2026 스파헬스케어 프로그램] 하반기 수중건강 프로그램 참여자 모집」.
 * · 사람 뽑는 글 1건 — 「제안서 평가위원(후보자) 공개모집」.
 * · 콘텐츠 공모전 2건 — 「청년 크리에이티브」 공고·결과. 기업 지원사업이 아니다.
 * · 끝난 공고 1건 — 「굿스파 인증기업 **선정결과** 공고」. 신청할 수 없는 글이다(koreg·kosmes 와 같은 처리).
 *
 * ★`모집`·`공모` 를 통째로 버리면 안 된다 — 지원사업 제목이 「참여기업 모집 공고」다(kodma 와 같은 함정).
 * ★`채용` 도 통째로 버리지 않는다 — 고용보조금 공고가 제목에 「채용」을 쓴다(djsinbo 실측).
 *   여기 채용 글은 별도 게시판(pm_id=25)이라 안 섞이지만, 옮겨 실릴 때를 대비해 좁게만 막는다.
 * ★★`어린이`·`캠프` 를 **낱말째 버리면 안 된다**(2026-09-06 독립 리뷰 2번). 저장소의 다른 고정본에
 *   「직장어린이집 설치·운영비 지원」·「중장년 인턴캠프」 같은 **진짜 지원사업**이 있다 —
 *   여기서 버릴 것은 실측 제목 두 개뿐이라 「어린이 온천/과학」·「온천과학 캠프」로 좁힌다.
 */
const DROP =
  /^\s*\[유관기관\]|어린이\s*(?:온천|과학)|온천과학\s*캠프|수중건강|스파헬스케어\s*프로그램|평가위원|공모전|선정\s*결과/;
const DROP_STAFF = /(?:신규|경력|직원)\s*채용|채용\s*공고/;

export function isHespaDropTitle(title: string): boolean {
  return DROP.test(title) || DROP_STAFF.test(title);
}

/** JSON 통로가 주는 한 줄. 숫자도 전부 글자로 온다(실측). */
type HespaRow = {
  b_id?: string;
  b_subj?: string;
  b_regdt?: string;
  /** "-1" 이면 상단 고정 공지. 날짜를 그대로 주므로 따로 다루지 않는다. */
  b_notice?: string;
  /** 첨부 원본 파일명(없으면 ""). 첨부 주소는 상세에서 조립되므로 여기서는 안 쓴다. */
  wf_name?: string;
};

/**
 * JSON 배열 한 벌을 행으로. 쪽 개념이 없어 `page` 는 안 본다(엔진 계약을 맞추려 받기만 한다).
 * 깨진 JSON 은 조용히 0행 — 엔진이 「행 0개」로 그 회차를 실패로 적는다.
 */
export function parseHespaList(text: string): BoardRow[] {
  let raw: HespaRow[] = [];
  try {
    const d: unknown = JSON.parse(text);
    if (Array.isArray(d)) raw = d as HespaRow[];
  } catch {
    return [];
  }
  const out: BoardRow[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    const id = String(r.b_id ?? "").trim();
    const title = String(r.b_subj ?? "").replace(/\s+/g, " ").trim();
    if (!id || !title || seen.has(id)) continue;
    if (isHespaDropTitle(title)) continue;
    seen.add(id);
    // 등록일만 준다(`2026-08-14 16:01:41`) — 「등록일 ~」 개시형. 시각은 버린다.
    const d = String(r.b_regdt ?? "").match(YMD);
    out.push({
      title,
      detailUrl: `${VIEW}&b_id=${encodeURIComponent(id)}`,
      dateText: d ? `${d[1]}-${d[2]}-${d[3]} ~` : "",
      category: "",
      agency: "헬스케어스파산업진흥원",
    });
  }
  return out;
}

/**
 * 상세 HTML 에 박힌 `var r_data = {…};` 덩어리를 꺼낸다.
 *
 * 중괄호를 **세면서** 끝을 찾는다 — `}` 로 먼저 만나는 자리를 끝으로 삼으면 본문 HTML 안의
 * 중괄호(스타일 조각)에서 잘린다. 글자열 안의 중괄호·이스케이프는 세지 않는다.
 * 못 찾으면 빈 문자열(호출부가 「본문 없음」으로 다룬다).
 */
export function extractHespaRData(html: string): string {
  // ★이름을 **정확히** 맞춘다 — `indexOf("var r_data")` 로 찾으면 `var r_dataX = {…}` 같은
  //  다른 변수도 걸려 엉뚱한 덩어리를 본문으로 삼는다(자체 돌연변이 시험이 잡았다).
  const m = html.match(/var\s+r_data\s*=\s*(?=\{)/);
  if (m?.index === undefined) return "";
  const open = html.indexOf("{", m.index);
  if (open < 0) return "";
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = open; i < html.length; i += 1) {
    const c = html[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{") depth += 1;
    else if (c === "}") {
      depth -= 1;
      if (depth === 0) return html.slice(open, i + 1);
    }
  }
  return "";
}

/**
 * 상세 HTML → 「본문 + 첨부 목록」 HTML. 뒷단계(본문 뽑기·첨부 수확)가 이 글만 본다.
 *
 * ★첨부 링크(`f_list`)를 반드시 함께 돌려준다 — 본문(`b_cont`)이 그림 한 장뿐인 공고가 있어
 *  (실측 b_id=20260615083905479: `<img src="../service/ImageBrowser.php?…">` 뿐) 첨부를 빼면
 *  그 공고는 자격조건을 영영 못 읽는다.
 */
export function buildHespaDetailHtml(html: string): string {
  const block = extractHespaRData(html);
  if (!block) return "";
  let data: { b_cont?: string; f_list?: string } = {};
  try {
    data = JSON.parse(block) as { b_cont?: string; f_list?: string };
  } catch {
    return "";
  }
  const cont = String(data.b_cont ?? "");
  const files = String(data.f_list ?? "").trim();
  return files ? `${cont}\n<ul class="hespa-files">${files}</ul>` : cont;
}

export const hespaConfig: BoardConfig = {
  id: "hespa",
  label: "헬스케어스파산업진흥원",
  agency: "헬스케어스파산업진흥원",
  region: "충남",
  baseUrl: BASE_URL,
  charset: "utf-8",
  list: {
    // 쪽 변수가 없다 — 한 번 부르면 전량(실측 16건)이 온다. 쪽 번호를 붙이면 같은 답이 반복된다.
    url: () => LIST_API,
    maxPages: 1,
    // JSON 이라 선택자 갈래는 안 쓴다. customParse 가 없을 때만 보는 값이라 빈 자리를 채워 둔다(ccei 와 같은 관례).
    rowSelector: "",
    fields: { title: {}, detailUrl: {}, date: {} },
  },
  customParse: parseHespaList,
  /**
   * 상세가 JSON 덩어리라 GET+선택자로는 본문도 첨부도 못 읽는다 — 여기서 직접 조달한다.
   * 요청은 **반드시 인자로 받은 fetchText 로만** 한다(허용 호스트 검문이 유지된다).
   */
  detailFetch: async (detailUrl: string, fetchText: (url: string, init?: BoardFetchInit) => Promise<string>) => {
    const html = await fetchText(detailUrl);
    return buildHespaDetailHtml(html);
  },
  /**
   * ★추측 단계를 끈다. 목록 응답이 JSON 이라 추측 단계가 HTML 로 읽으면 0행이 나오고,
   * 혹 서식이 바뀌어 HTML 이 오더라도 이 사이트의 표는 `ng-repeat` 껍데기라 건질 것이 없다.
   */
  skipHeuristic: true,
  // 실측 16건 중 거르개를 지나면 6건. 절반(3)이면 서식 변경이 아닌데도 관문이 실패한다 — 3 으로 둔다.
  expectMinRows: 3,
};
