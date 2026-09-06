import { parseHtml } from "../html";
import type { BoardConfig, BoardRow } from "../types";

/**
 * 안양산업진흥원 기업지원사업 — 분류(sbPart) **여덟 곳**을 한 수집기가 번갈아 읽는다.
 *
 * 왜 이제야 붙었나(2026-09-05 실측): aca.or.kr 은 **국내 IP 로만 열린다**. 이름은 풀리는데
 * 미국(Railway)·사무실 맥에서는 443·80 둘 다 연결이 안 된다 — 그래서 `requiresProxy: true` 다
 * (전북TP·대전신보와 같은 사정). 국내 경유(서울 VM)로 열어 구조를 확정했다.
 *
 * 구조: `table.table-hover tbody tr.small-hb` — 칸 5개 「번호 / 지원사업명 / 접수기간 / 조회 /
 * 진행상태」. 목록이 **접수기간을 시작·마감 둘 다** 준다(`2026-08-20~2026-09-04`) — 등록일만
 * 주는 게시판보다 마감 정리가 정확하다. 진행상태는 `span.label`(진행중·진행완료).
 *
 * ★★목록 제목이 **서버에서 20자로 잘려** 온다(`2026년 안양시 유망기업 온‧오프라...`).
 *   실측 50행 중 50행 전부가 `...` 로 끝났고, 앵커에 `title` 속성도 없다(경기TP 가 쓴 탈출구가
 *   여기엔 없다). 잘린 제목을 그대로 저장하면
 *    · `dedupKeyOf({title, agency})` 가 기업마당의 같은 공고와 갈려 **영영 안 묶이고**
 *    · 갈래·한도 추출이 제목 뒷부분(「… 유통망 입점 지원사업」)을 통째로 못 본다.
 *   그래서 상세의 온전한 제목으로 승격한다 — 아래 `detailTitle` 설정이 그 배선이고,
 *   판정은 `board/title-upgrade.ts` 가 접두어 관계일 때만 한다.
 *
 * ★쪽 크기 변수(`recordCountPerPage`)가 **먹는다**(2026-09-05 실측: 10 → 50 → 200 → 500 그대로
 *   반영, Total Pages 15 → 3 → 1). 그래서 **분류마다 한 쪽에 다 담아** 읽는다(`ROWS_PER_PAGE`).
 *   ⓐ 이게 중요한 이유 — 엔진은 「신규 0인 쪽이 **연속 둘**」이면 멈추는데, 그 규칙은
 *      「이 분류가 바닥났다」와 「전체가 끝났다」를 구분하지 못한다. 분류 여덟 곳의 크기가
 *      147·39·64·7·4·4·15·6 으로 심하게 갈려서, 쪽 크기를 50 으로 두면 작은 분류들의 빈 2쪽이
 *      **줄줄이 붙어**(0004·0005·0007·0010·0011) 그 자리에서 끊긴다 — 가장 큰 마케팅지원의
 *      3쪽(47건)이 통째로 안 들어온다. 한 분류 = 한 쪽이면 빈 쪽이 아예 안 생긴다.
 *   ⓑ 500 은 지금 가장 큰 분류(147건)의 3배가 넘는 여유다. 147건 응답이 177KB 라
 *      목록 상한(3MB)까지도 한참 남는다.
 * ★분류를 **한 쪽씩 돌아가며** 읽는다(`acaTargetOf`, ansan·atkorea 방식) —
 *   1쪽=마케팅지원 · 2쪽=기술개발/사업화 · … · 8쪽=중장년센터 · 9쪽=마케팅지원 2쪽 …
 *   분류마다 같은 쪽 수(`PAGES_PER_PART`)를 준다 — 「지금 147건이니 여기만 2쪽」처럼
 *   순간값에 맞춰 자르지 않는다. 분류가 500건을 넘기면 2쪽이 저절로 들어온다.
 *   대신 `url(1)`·`url(2)` 는 분류 조각만 다르고 쪽 번호가 둘 다 1 이라, 엔진의 쪽 번호 변수
 *   찾기가 `menuId` 를 쪽 변수로 잘못 짚는다(실측 `pagingParamsOf` → `["menuId"]`).
 *   **무해하다** — 상세 주소를 `sbIdx` 로만 조립해 `menuId` 도 쪽 번호도 아예 없어서 지울 것이 없다.
 *   그래서 `PAGING_WITHOUT_URL_PARAM` 예외는 필요 없다(등록하지 않는다).
 *
 * ★상세 주소는 **`?sbIdx=N` 하나로 못 박는다**(atkorea 와 같은 갈래). 화면 링크는
 *   `?sbIdx=541&sbPart=sbtp0001&menuId=849` 지만 `sbIdx` 만으로도 200 이고 제목·첨부가 같다
 *   (2026-09-05 실측). 분류를 주소에 남기면 한 사업이 두 분류에 걸릴 때 주소가 갈려 두 줄로
 *   저장된다 — 주소가 곧 중복 판정 열쇠(sourceId)다.
 *
 * ⚠️알려진 한계(2026-09-05 독립 검사 지적 7 — 이번엔 안 고침): 제목을 한 번 올린 뒤
 *   기관이 제목 **꼬리만** 고치면(「… 지원사업」 → 「… 지원사업(연장)」) 그 수정이 안 들어온다.
 *   목록은 계속 잘린 앞부분만 주고, 저장 단계는 「이전 제목이 이번 제목의 잘린 앞부분」이면
 *   이전 값을 지키기 때문이다. 상세를 주기적으로 다시 여는 장치가 생기면 함께 풀린다.
 *
 * 상세(3개 분류에서 확인): 제목 `div.panel-title.view-title.h5 > strong`(접두 `[사업안내] - `) ·
 * 첨부 `ul.list-group` 안 `/cmmn/download.do?idx=NNNNN`(없는 상세도 있다) · 본문 `div.bbs_memo`.
 */
const BASE = "https://aca.or.kr";
const VIEW = `${BASE}/support/supportBizView.do`;

/** 읽을 분류. 순서가 곧 도는 순서다(큰 분류가 앞 — 1쪽이 출처 전체의 채택 여부를 가른다). */
const PARTS = [
  { code: "sbtp0001", menuId: "849", label: "마케팅지원" },
  { code: "sbtp0002", menuId: "850", label: "기술개발/사업화" },
  { code: "sbtp0003", menuId: "851", label: "인증/지식재산" },
  { code: "sbtp0004", menuId: "853", label: "창업/양성/교육" },
  { code: "sbtp0005", menuId: "852", label: "네트워크활성화" },
  { code: "sbtp0007", menuId: "854", label: "전략산업/맞춤형" },
  { code: "sbtp0010", menuId: "1169", label: "소공인지원센터" },
  { code: "sbtp0011", menuId: "1222", label: "중장년센터" },
] as const;
/**
 * 분류마다 몇 쪽까지 읽을지(상한 = PARTS.length × 이 값).
 * `ROWS_PER_PAGE` 가 지금 가장 큰 분류(147건)의 3배가 넘어 **한 분류가 한 쪽에 다 들어온다** —
 * 2쪽을 두면 여덟 쪽이 전부 빈 쪽이 되어 「연속 N쪽 신규 0」 판정만 흐린다.
 * 분류가 500건을 넘기면 이 값을 올린다(그때 `emptyStreakStop` 도 함께 본다).
 */
const PAGES_PER_PART = 1;
/** 한 쪽에 담을 행 수(위 주석 ★ⓑ). 지금 가장 큰 분류가 147건이다. */
const ROWS_PER_PAGE = 500;

/** 엔진 쪽 번호 → 「어느 분류의 몇 쪽」. 시험이 사상을 그대로 잴 수 있게 내보낸다. */
export function acaTargetOf(p: number): { code: string; menuId: string; label: string; page: number } {
  const i = Math.max(1, Math.floor(p)) - 1;
  // 한 바퀴에 분류 하나씩 한 쪽(위 주석 ★) — A1 B1 … H1 A2 B2 …
  const part = PARTS[i % PARTS.length];
  return { code: part.code, menuId: part.menuId, label: part.label, page: Math.floor(i / PARTS.length) + 1 };
}

/** 목록 한 쪽의 주소. */
export function acaListUrl(p: number): string {
  const t = acaTargetOf(p);
  return `${BASE}/support/supportBizList/${t.code}.do?menuId=${t.menuId}&page=${t.page}&recordCountPerPage=${ROWS_PER_PAGE}`;
}

const SB_IDX = /[?&]sbIdx=(\d+)/;
/** 「Total Article147 / Total Pages15」 — 서버가 쪽 크기를 존중했는지 재는 유일한 표식. */
const TOTAL_PAGES = /Total\s*Pages\s*<strong[^>]*>\s*(\d+)/i;
const YMD = /(20\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})/g;

/**
 * 지원사업이 아닌 글. **버릴 것만** 좁게 지정한다.
 * 이 게시판은 「기업지원사업」 전용이라 실측 286건에 행정 고시·채용이 섞이지 않았다 —
 * 그래도 결과 알림·입찰이 뒤에 생길 수 있어 좁은 거르개만 둔다.
 * ★`채용` 을 통째로 버리지 않는다(bizbc·ansan 주석) — 고용보조금은 제목에 「채용」을 쓴다.
 */
const DROP = /선정\s*결과|결과\s*발표|합격자|입찰\s*공고|낙찰|평가위원|기간제근로자|(?:신규|경력|직원)\s*채용\s*(?:공고|안내)/;

/** 시험이 제목 글자만으로 거르개를 잴 수 있게 내보낸다. */
export function isAcaDropTitle(title: string): boolean {
  return DROP.test(title);
}

export function parseAcaList(html: string, page = 1): BoardRow[] {
  const target = acaTargetOf(page);
  /**
   * ★쪽 크기를 무시하면 **소리 나게 멈춘다**(2026-09-05 독립 검사 지적 5).
   * 이 수집기는 「한 분류 = 한 쪽」을 전제로 `maxPages` 를 8로 잡았다. 서버가 언젠가
   * `recordCountPerPage` 를 무시하고 10건씩 돌려주면 분류마다 앞 10건만 담기고
   * **나머지가 조용히 사라진다.** 출처가 「오류」로 현황판에 뜨는 편이 낫다.
   */
  const pages = Number(html.match(TOTAL_PAGES)?.[1] ?? "1");
  if (Number.isFinite(pages) && pages > 1) {
    throw new Error(
      `aca: 서버가 쪽 크기(${ROWS_PER_PAGE})를 무시해 ${pages}쪽으로 나눔 — 유실 방지를 위해 중단`,
    );
  }
  const out: BoardRow[] = [];
  const seen = new Set<string>();
  for (const tr of parseHtml(html).querySelectorAll("table.table-hover tbody tr")) {
    const tds = tr.querySelectorAll("td");
    if (tds.length < 5) continue; // 「자료가 없습니다」 줄·머리글
    const a = tr.querySelector("td:nth-child(2) a");
    const href = (a?.getAttribute("href") ?? "").trim();
    const sbIdx = href.match(SB_IDX)?.[1] ?? "";
    if (!sbIdx || seen.has(sbIdx)) continue;
    /**
     * ★제목은 **잘린 채로** 담는다(위 주석 ★★). 여기서 고칠 방법이 없다 —
     * `customParse` 는 동기 함수라 상세를 받아올 수 없다. 상세 채움 단계가
     * `detailTitle` 설정을 보고 온전한 제목으로 올린다.
     */
    const title = (a?.text ?? "").replace(/\s+/g, " ").trim();
    if (!title || DROP.test(title)) continue;
    seen.add(sbIdx);
    /**
     * 접수기간은 **`td:nth-child(3)` 칸을 직접** 집는다(번호|사업명|접수기간|조회|진행상태).
     * ⚠️ 행 전체 글자(`tr.text`)에서 찾으면 안 된다 — 칸이 띄어쓰기 없이 이어 붙어
     *    번호(147)와 조회수(186)가 날짜처럼 보이는 자리를 만든다(hsbiz 실측 함정).
     */
    const term = (tds[2]?.text ?? "").replace(/\s+/g, " ").trim();
    const days = [...term.matchAll(YMD)].map(
      (m) => `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`,
    );
    const dateText =
      days.length >= 2 ? `${days[0]} ~ ${days[1]}` : days.length === 1 ? `${days[0]} ~` : "";
    // 진행상태(진행중·진행완료)는 분류와 함께 category 에만 남긴다 — 닫힘은 접수기간 마감일이
    // 정하게 두고(저장 규칙), 이 글자로 거르지 않는다. 「진행완료」도 이력으로 담아 둔다.
    const state = (tds[4]?.text ?? "").replace(/\s+/g, " ").trim();
    out.push({
      title,
      // 쪽 번호·분류를 넣지 않는다 — 주소가 곧 중복 판정 열쇠(sourceId)다(위 주석 ★).
      detailUrl: `${VIEW}?sbIdx=${sbIdx}`,
      dateText,
      category: state ? `${target.label} · ${state}` : target.label,
      agency: "안양산업진흥원",
    });
  }
  return out;
}

export const acaConfig: BoardConfig = {
  id: "aca",
  label: "안양산업진흥원",
  agency: "안양산업진흥원",
  region: "경기",
  baseUrl: `${BASE}/`,
  charset: "utf-8",
  /** 국내 IP 로만 열린다 — 프록시가 없으면 수집 목록에서 빠진다(매 회차 실패 알림만 쌓이지 않게). */
  requiresProxy: true,
  list: {
    url: acaListUrl,
    // 분류 8 × 1쪽. 실측 286건이 이 여덟 쪽에서 전부 나온다.
    maxPages: PARTS.length * PAGES_PER_PART,
    rowSelector: "table.table-hover tbody tr",
    fields: {
      title: { selector: "td:nth-child(2) a" },
      detailUrl: { selector: "td:nth-child(2) a", attr: "href" },
      date: { selector: "td:nth-child(3)" },
      category: { selector: "td:nth-child(5)" },
    },
  },
  /**
   * ★한 바퀴(분류 8개)를 도는 동안에는 **절대 안 끊기게** 한 바퀴 길이를 준다
   * (2026-09-05 독립 검사 지적 4). 기본값 2 는 「이 분류가 비었다」와 「전체가 끝났다」를
   * 구분하지 못해서, 작은 분류 둘이 나란히 오면 그 자리에서 끊겨 **뒤 분류가 통째로 안 들어온다.**
   * 지금은 분류마다 1쪽뿐이라 빈 쪽이 안 생기지만, 한 분류가 통째로 비는 날(개편·점검)에도
   * 나머지 분류가 살아남아야 한다.
   */
  emptyStreakStop: PARTS.length,
  customParse: parseAcaList,
  detailContentSelector: "div.bbs_memo",
  /**
   * 첨부는 `ul.list-group` 안에만 있다(실측: 2건인 상세·0건인 상세 둘 다 확인).
   * 범위를 못 박아 머리글·바닥글의 매뉴얼 PDF 가 섞이지 않게 한다(비즈OK 오염 사례).
   */
  attachmentsScopeSelector: "ul.list-group",
  /** 상자가 사라지면 서식 변경이다 — 첨부 없는 상세 고정본(aca-detail-noattach.html)에도 이 상자가 있다. */
  attachmentsScopeRequired: true,
  /**
   * ★목록이 20자에서 잘라 보내는 제목을 상세의 온전한 제목으로 올린다(위 주석 ★★).
   * `strip` 은 상세 제목 앞의 `[사업안내] - ` 를 뗀다 — 안 떼면 목록의 잘린 앞부분과
   * 접두어 관계가 성립하지 않아 승격 자체가 안 된다.
   */
  detailTitle: {
    selector: "div.panel-title.view-title.h5 > strong",
    strip: /^\s*\[[^\]]*\]\s*-\s*/,
    /**
     * ★온전한 제목을 처음 보는 자리에서 한 번 더 거른다. 목록 제목은 20자에서 잘려 오므로
     * 목록 단계의 `DROP` 이 뒷글자(「… 선정 결과 발표」)를 못 보고 그냥 통과시킨다.
     */
    drop: DROP,
  },
  /**
   * ★heuristic 추측을 끈다. 목록 행에 신청 버튼·조회수 링크가 섞이면 추측 단계가
   * 그것을 공고로 저장할 수 있고, 그 줄은 다음 회차에 지워지지 않는다(수출입은행 실측).
   */
  skipHeuristic: true,
  /**
   * 낮게 둔다(4) — 이 값은 **1쪽(마케팅지원)** 하나로 출처 전체의 채택 여부를 가른다.
   * 가장 작은 분류가 4건이라 분류 순서를 바꿔도 안전한 값이다.
   * 서식이 깨지면 어차피 customParse 가 0행을 내어 「행 0개」로 걸린다.
   */
  expectMinRows: 4,
};
