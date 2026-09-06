import type { BoardConfig, BoardRow } from "../types";

/**
 * 제주테크노파크(JTP) 사업공고 — `/board/business`.
 *
 * ★「스크립트 화면이라 못 읽는다」가 아니다. 목록 HTML(69,422바이트)에는 공고 행이 **0개**이고
 *   Vue 2 의 `<template v-for="(item,index) in page.content">` 틀만 있지만, 그 틀을 채우는
 *   AJAX 통로를 브라우저 없이 그대로 부를 수 있다(ccei 와 같은 갈래, 2026-09-03 실측).
 *
 * 구조:
 * · 목록 = **GET** `/board/business/list?keyword=&page={0부터}&size=30&businessDiv=`
 *   ⚠️ **`Content-Type: application/json` 헤더가 없으면 서버가 415 에 본문 0바이트**를 준다.
 *      GET 인데 본문 형식 헤더를 요구하는 건 사이트 JS 가 `axios.get(url, {data:{}})` 로 부르기
 *      때문이다(목록 HTML 의 `fetch()` 함수 확인). 실측: 헤더 없이 415/0바이트 · 붙이면 200/29,268바이트.
 *      브라우저 UA 위장은 필요 없다(순정 curl 로도 200 — 엔진이 이미 UA 를 붙인다).
 * · `size` 는 서버가 무시한다(100 을 요청해도 30 고정 응답) — 한 쪽 30건, 전체 2,635건·88쪽.
 * · 응답 `content[]` 가 행, `totalElements`·`totalPages` 가 전체 규모.
 * · 정렬은 **접수종료일 내림차순**이다(실측: 1쪽 2026-11-30 → 2026-07-02). 그래서 새로 올라온
 *   공고는 마감일이 미래라 늘 1쪽에 들어온다 — 붙박이 공지 칸이 따로 없고(칸도 없다) 「1년 넘은
 *   공지 버리기」(koreaexim 방식)가 필요한 자리도 없다.
 * · 상세는 `/board/business/detail/{annoId}` (annoId = 32자리 16진수, 순번 추측 불가).
 *
 * 접수기간을 **시작·끝 둘 다** 주는 드문 게시판이다(`receiptSDate`·`receiptEDate`).
 */
const BASE = "https://www.jejutp.or.kr";
const LIST = `${BASE}/board/business/list`;
const VIEW = `${BASE}/board/business/detail`;
const DETAIL_JSON = `${BASE}/board/business/detail/json`;
/** 첨부 내려받기는 JTP 가 운영하는 제주산업정보서비스(JEIS)에 있다 — 목록·상세와 호스트가 다르다. */
const FILE_HOST = "jeis.or.kr";
const FILE_DOWN = `https://${FILE_HOST}/fileDown.ac`;
/** 서버가 무시하지만 사이트 JS 와 같은 값을 보낸다 — 응답은 늘 30건이다. */
const PER_PAGE = 30;
/** `Content-Type` 이 없으면 415. 목록·상세 두 통로 다 같다(실측). */
const JSON_HEADERS = { "Content-Type": "application/json" } as const;

const ANNO_ID = /\/board\/business\/detail\/([0-9a-f]{32})(?:$|[?#/])/i;

/**
 * 지원사업이 아닌 글. **버릴 것만** 좁게 지정한다.
 *
 * 실측 1·2쪽(60건)에서 걸리는 다섯: 「기술닥터 **평가용** 공고」·「…보급대상지 선정공고(**평가용**)」
 * (직원이 심사 연습용으로 올린 글) · 「…개발 **용역**」(발주 공고) ·
 * 「…**위탁정산기관** 모집공고」 · 「…리빙랩 **운영 대행사업** **운영기관 모집** 공고」
 * (뒤 셋은 기업 지원이 아니라 사업을 대신 굴릴 기관을 뽑는 글 — exportvoucher 의 `수행기관` 과 같은 갈래).
 *
 * ★`채용` 을 통째로 버리면 안 된다 — 고용보조금은 제목에 「채용」을 쓴다(bizbc 주석).
 * ★`용역` 도 통째로 버리면 안 된다 — 「컨설팅 용역 지원사업」이 같이 죽는다.
 *   발주 공고는 제목이 「…용역」으로 **끝나므로** 끝자리일 때만 버린다.
 */
const DROP =
  /입찰|설문|평가위원|합격자|채용\s*공고|평가용|위탁정산기관|운영기관\s*모집|운영\s*대행|용역\s*(?:입찰|공고)?$/;

export function isJejutpDropTitle(title: string): boolean {
  return DROP.test(title.replace(/\s+/g, " ").trim());
}

/**
 * ★응답 글자가 **두 겹**으로 엔티티에 싸여 온다.
 * 실측: 원문 「컨설팅·테스팅」이 응답엔 `컨설팅&amp;middot;테스팅`, 「R&D」가 `R&amp;amp;D`.
 * 한 번만 풀면 `&middot;` 가 글자로 남아 제목에 그대로 저장된다(사이트 JS 도 `htmlDecode` 를 쓴다).
 * 그래서 **더 안 바뀔 때까지** 푼다 — 겹수를 2로 못 박으면 세 겹 짜리가 새로 오면 또 샌다.
 * 도는 횟수는 3회로 막는다(무한 고리 방지).
 */
const ENTITY = /&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp|middot|middle|hellip|ndash|mdash|rsquo|lsquo|ldquo|rdquo);/gi;
const NAMED: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  middot: "·", middle: "·", hellip: "…", ndash: "–", mdash: "—",
  rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”",
};

function decodeOnce(s: string): string {
  return s.replace(ENTITY, (whole, body: string) => {
    const key = body.toLowerCase();
    if (key.startsWith("#x")) {
      const code = Number.parseInt(body.slice(2), 16);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    if (key.startsWith("#")) {
      const code = Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED[key] ?? whole;
  });
}

export function decodeJejutpText(raw: string | null | undefined): string {
  let s = String(raw ?? "");
  for (let i = 0; i < 3; i++) {
    const next = decodeOnce(s);
    if (next === s) break;
    s = next;
  }
  return s.replace(/\s+/g, " ").trim();
}

type JejutpRow = {
  annoId?: string;
  annoName?: string;
  /** 접수시작일 「2026-06-26」. */
  receiptSDate?: string;
  /** 접수종료일 「2026-11-30」. 마감 시각은 receiptEHour·receiptEMinute 로 따로 온다. */
  receiptEDate?: string;
  /** 등록일시(ISO). 접수기간이 아예 없는 줄에서만 개시일 대신 쓴다. */
  createdDate?: string;
  /** 분류 — R&D·기술지원·사업화지원·인력양성·기타. null 이면 사이트가 「교육」으로 그린다. */
  businessDivName?: string | null;
};

/** 「2026-06-26」 꼴만 받는다. 시각·요일이 붙어 와도 날짜만. 아니면 빈 문자열. */
function ymd(raw: string | null | undefined): string {
  const m = String(raw ?? "").match(/(20\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
  return m ? `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}` : "";
}

/**
 * 접수기간. **칸 단위**로 읽는다 — 행 전체 글자에서 정규식으로 찾으면 번호 칸과 붙어
 * 「712026-09-01」 처럼 깨진다(hsbiz 실측 함정).
 * 끝이 없으면 「시작 ~」 개시형, 시작이 없으면 마감 단독, 둘 다 없으면 등록일로 개시형.
 */
function periodOf(r: JejutpRow): string {
  const s = ymd(r.receiptSDate);
  const e = ymd(r.receiptEDate);
  if (s && e) return `${s} ~ ${e}`;
  if (s) return `${s} ~`;
  if (e) return e;
  const created = ymd(String(r.createdDate ?? "").slice(0, 10));
  return created ? `${created} ~` : "";
}

export function parseJejutpList(jsonText: string, _page = 1): BoardRow[] {
  let raw: JejutpRow[] = [];
  try {
    const d = JSON.parse(jsonText) as { content?: JejutpRow[] };
    if (Array.isArray(d?.content)) raw = d.content;
  } catch {
    return [];
  }
  const out: BoardRow[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    const annoId = String(r.annoId ?? "").trim();
    if (!/^[0-9a-f]{32}$/i.test(annoId) || seen.has(annoId)) continue;
    const title = decodeJejutpText(r.annoName);
    if (!title || DROP.test(title)) continue;
    seen.add(annoId);
    out.push({
      title,
      /**
       * ★사이트 링크는 `?cate=&pageNumber=0&keyword=` 를 달고 다니지만 **붙이지 않는다.**
       * 상세 주소가 곧 중복 판정 열쇠(sourceId)라, 쪽 번호가 섞이면 같은 공고가 쪽마다
       * 다른 줄로 저장된다(운영 실측 20묶음이 그 중복이었다).
       */
      detailUrl: `${VIEW}/${annoId}`,
      dateText: periodOf(r),
      // 「기타」가 대부분이지만 분류를 그대로 싣는다. null 은 비운다 —
      // 사이트는 그 자리를 「교육」으로 그리지만, 값이 없다는 사실을 지어내 채우지 않는다.
      category: decodeJejutpText(r.businessDivName),
    });
  }
  return out;
}

export const jejutpConfig: BoardConfig = {
  id: "jejutp",
  label: "제주테크노파크",
  agency: "제주테크노파크",
  region: "제주",
  baseUrl: `${BASE}/`,
  /**
   * ★첨부(공고문 PDF)만 다른 호스트다 — `https://jeis.or.kr/fileDown.ac?fileId=…`
   * (JTP 가 운영하는 「제주산업정보서비스」, 실측 200 · 652,385바이트 = fileSize 와 일치).
   * 여기 안 적으면 `attachment-text` 의 허용 호스트 명부(게시판 명부에서 만들어진다)에서 빠져
   * 공고문을 한 건도 못 내려받는다.
   */
  allowedHosts: [FILE_HOST],
  charset: "utf-8",
  list: {
    // ★쪽 번호가 **0부터**다. 1부터 보내면 1쪽을 통째로 건너뛴다.
    url: (p) => `${LIST}?keyword=&page=${p - 1}&size=${PER_PAGE}&businessDiv=`,
    /**
     * 전체 88쪽이지만 7쪽(210건)까지만 판다.
     * ★7 을 넘기려면 `deep-paging.test.ts` 의 허용 목록에 `jejutp` 를 **먼저** 올려야 한다
     *   (그 시험이 「허용 목록 밖 게시판은 7쪽 이하」를 강제한다). 이 게시판은 접수기간을
     *   시작·끝 둘 다 주므로 깊이 파도 끝난 공고가 「모집중」으로 안 섞인다 — 조건은 이미 갖췄다.
     * 놓칠 걱정은 작다: 정렬이 접수종료일 내림차순이라 **새 공고는 늘 1쪽**에 들어온다.
     */
    maxPages: 7,
    /**
     * GET 인데도 본문 형식 헤더를 요구한다 — 없으면 415 에 본문 0바이트.
     * 엔진은 `method: "POST"` 일 때만 리다이렉트를 막으므로 GET 은 그대로 따라간다.
     */
    init: () => ({ method: "GET", headers: { ...JSON_HEADERS } }),
    // JSON 이라 선택자 갈래는 안 쓴다. customParse 가 없을 때만 보는 값이라 빈 자리를 채워 둔다.
    rowSelector: "",
    fields: { title: {}, detailUrl: {}, date: {} },
  },
  customParse: parseJejutpList,
  /**
   * ★`detailContentSelector` 를 **일부러 안 적는다** — 두 가지 이유가 겹친다.
   * ① 상세 화면도 Vue 껍데기라 GET 으로 받은 HTML 에는 본문이 한 글자도 없다.
   * ② 본문을 주는 JSON(`annoContents`)을 열어 봐도 엔티티를 다 풀면 **40자짜리 표지문 한 줄**뿐이다
   *    (실측: 「>>> ○ (모집 방법) 온라인(KISA 지역정보보호센터) 신청」). 그걸 `targetText` 에
   *    채우면 뒷단계의 「첨부에서 본문 뽑기」가 `targetText === ""` 조건에서 이 공고를 **영영**
   *    건너뛰어, 진짜 자격조건이 든 공고문 PDF 를 한 번도 안 읽는다(ccei·geri 와 같은 갈래).
   *
   * `skipHeuristic` 은 안 켠다 — 목록 응답이 JSON 이라 추측 단계가 `a[href]` 를 하나도 못 찾아
   * 0행으로 조용히 실패한다(첨부 링크를 공고로 저장하는 사고가 원리적으로 안 난다).
   */
  detailFetch: async (detailUrl, fetchText) => {
    const annoId = detailUrl.match(ANNO_ID)?.[1];
    if (!annoId) return "";
    let files: Array<{ fileId?: string; realFileName?: string }> = [];
    try {
      const body = await fetchText(`${DETAIL_JSON}/${annoId}`, { method: "GET", headers: { ...JSON_HEADERS } });
      const d = JSON.parse(body) as { anno?: { fileList?: Array<{ fileId?: string; realFileName?: string }> } };
      if (Array.isArray(d?.anno?.fileList)) files = d.anno.fileList;
    } catch {
      return "";
    }
    /**
     * ★링크에 **글자를 넣지 않는다.** 이 조각의 글자가 그대로 `targetText` 가 되는데,
     * 파일 이름으로라도 채우는 순간 위 ②의 함정에 그대로 빠진다. 그 대가로 첨부 이름은
     * 수확기가 주소 경로 끝에서 만든 「fileDown.ac」가 된다(기업마당 첨부와 같은 모양) —
     * 이름은 보여 주기용이고 실제 판독은 형식(pdf)과 주소로 하므로 본문을 잃는 쪽보다 낫다.
     * ★주소 끝에 `fileName=` 을 붙이는 것은 장식이 아니다 — 수확기가 `.pdf`·`.hwp` 로 끝나는
     *   주소만 첨부로 인정하고(`fileDown.ac` 는 확장자가 없어 탈락) 형식 판정도 그 값을 본다.
     *   서버는 이 인자를 무시한다(실측: 붙여도 같은 200·652,385바이트).
     */
    const links = files
      // 파일 이름이 없으면 담지 않는다 — 확장자를 지어내면(`.pdf`) 형식 판정이 거짓말을 하고
      // 뒷단계가 hwp 를 pdf 로 열려다 헛걸음한다. 실측 응답엔 늘 realFileName 이 있다.
      .flatMap((f) => {
        const fileId = String(f.fileId ?? "");
        const name = decodeJejutpText(f.realFileName);
        if (!/^[0-9a-f]{32}$/i.test(fileId) || !name) return [];
        const href = `${FILE_DOWN}?fileId=${encodeURIComponent(fileId)}&amp;fileName=${encodeURIComponent(name)}`;
        return [`<a href="${href}"></a>`];
      });
    return links.length > 0 ? `<div class="jejutp-files">${links.join("")}</div>` : "";
  },
  /** 한 쪽 30건. 절반 아래로 떨어지면 응답 서식이 바뀐 것으로 본다. */
  expectMinRows: 15,
};
