import { parseHtml, type HTMLElement } from "../html";
import type { BoardConfig, BoardRow } from "../types";

/**
 * 한국무역협회(KITA) 지원·사업 > 사업신청.
 *
 * ★게시판이 **둘**이고 둘 다 받아야 전량이다(2026-09-03 실측).
 * · 진행중인 사업 `asocBizOngoingList.do` — 총 80건
 * · 상시지원 사업 `asocBizAlwaysList.do` — 총 116건
 * ⚠️ **배타적이 아니다.** 조사 메모는 「완전 배타」라고 했지만 전량을 받아 대조하니
 *    **17건이 양쪽에 다 있었다**(예: `202609003` 대전세종충남 금융지원 추천 9월).
 *    합쳐서 고유 179건.
 *
 * ★그래서 상세 주소를 **한 가지로 못 박는다.** 목록의 `goDetailPage()` 가 form action 을
 *   `asocBizAlwaysDetail.do` / `asocBizOngoingDetail.do` 로 갈라 넣는데, 그대로 따르면
 *   겹치는 17건이 **주소가 달라 두 줄로 저장된다**(주소가 곧 중복 판정 열쇠 `sourceId`).
 *   실측으로 두 통로가 같은 글을 준다 — 어떤 `bizAltkey` 든 양쪽 다 200 이고 바이트 차이는
 *   머리글(「상시지원 사업」/「진행중인 사업」)뿐이다. 그래서 `Ongoing` 쪽으로 통일한다.
 *
 * ★쪽넘김은 **홀수=진행중 · 짝수=상시**로 번갈아 준다.
 *   엔진은 「신규 0인 쪽이 연속 둘」이면 멈춘다. 앞쪽에 한 게시판을 몰아 넣으면
 *   그 게시판이 짧아진 날(상시 2쪽은 지금도 나이 거르개로 0행이다) 뒤 게시판을
 *   **한 쪽도 못 읽고** 통째로 잃는다. 번갈아 두면 한쪽의 빈 쪽이 다른 쪽 사이에 끼어
 *   연속으로 세지 않는다.
 *
 * 구조: `ul.board-list-biz > li`. 제목은 `div.subject > a[onclick="goDetailPage('<id>')"]`
 * (`href` 는 전부 `javascript:void(0)`). 쪽 크기는 `pageUnit`(기본 10) — **GET 질의로도 먹는다**
 * (실측 `?pageIndex=1&pageUnit=100` → 200, 100행). POST 폼을 흉내 낼 필요가 없다.
 * charset UTF-8.
 *
 * ⚠️ 날짜 칸이 **둘**이다 — `사업기간`(프로그램이 열려 있는 기간)과 `모집기간`(신청 기간).
 *    반드시 **모집기간**을 쓴다. 실측 `202601011` 은 사업기간 `2026.01.01~2026.12.31` ·
 *    모집기간 `2026.09.20~2026.09.25` 라, 사업기간을 쓰면 **닷새짜리 모집이 연말까지
 *    「모집중」**으로 뜬다(창조경제혁신센터에서 적대 리뷰가 「치명」으로 잡은 그 갈래).
 */
const BASE = "https://www.kita.net";
const DIR = `${BASE}/asocBiz/asocBiz`;
const ONGOING_LIST = `${DIR}/asocBizOngoingList.do`;
const ALWAYS_LIST = `${DIR}/asocBizAlwaysList.do`;
/** 겹치는 17건이 두 줄이 되지 않게 상세 통로를 하나로 못 박는다(위 주석). */
const DETAIL = `${DIR}/asocBizOngoingDetail.do`;
/** 한 쪽에 몇 건을 달라고 할지. 100 × 4쪽 = 400 ≥ 실측 116·80. */
const PAGE_UNIT = 100;

const GO = /goDetailPage\(\s*['"]([A-Za-z0-9_-]+)['"]/;
const YMD = /(20\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})/g;

/**
 * 지원사업이 아닌 글. **버릴 것만** 좁게 지정한다(실측 179건을 눈으로 훑어 고른 20건).
 * · `호텔 특가`·`특가`·`회원 할인`·`멤버십카드` — 회원 혜택 안내(제휴 호텔·카드·운송 할인)
 * · `협력업체 모집` — 협회가 발주처인 업체 모집이라 우리 고객이 신청할 사업이 아니다
 * · `규제애로 건의` — 건의 접수 창구
 * · `공동제작` — 「2027년 TRADE 다이어리 공동제작 회원사 모집」
 *
 * ★`모집`·`교육`·`공동`·`채용` 을 통째로 버리면 안 된다 — 「참여기업 모집」·「실무 교육」·
 *   「현대글로비스 **공동** 항공운임 프로모션」이 이 게시판의 본체다(bizbc.ts 주석과 같은 함정).
 */
const DROP = /특가|회원\s*할인|멤버십\s*카드|멤버십카드|협력업체\s*모집|규제애로\s*건의|공동제작/;

/** 카테고리가 이것이면 지원사업이 아니다. 실측 `설문조사` 1건(애로사항 접수 창구). */
const DROP_CATEGORY = new Set(["설문조사"]);

/**
 * 모집기간 **끝이 1년 넘게 지난** 줄은 담지 않는다(koreaexim·kbiz 와 같은 갈래).
 * 상시지원 게시판은 2018년 글까지 그대로 붙어 있어(실측 2쪽 16건이 전부 2018~2024년),
 * 그냥 담으면 매 회차 「이미 끝난 공고」 60여 건이 새 줄로 들어온다.
 */
const STALE_MAX_AGE_MS = 365 * 24 * 3_600_000;

function clean(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

export function isKitaDropTitle(title: string): boolean {
  return DROP.test(title);
}

/** "2026.09.01 ~ 2026.09.25" → "2026-09-01 ~ 2026-09-25". 날짜가 없으면 빈 문자열. */
function ymdRange(raw: string): string {
  const ds = [...raw.matchAll(YMD)].map((m) => `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`);
  if (ds.length >= 2) return `${ds[0]} ~ ${ds[1]}`;
  // 한쪽만 있는 줄은 실측 196건에 하나도 없다. 나오면 개시형으로 둔다 —
  // 홑 날짜를 마감으로 읽으면 「상시 접수」가 그날 바로 닫힌다(engine.toNormalized).
  if (ds.length === 1) return `${ds[0]} ~`;
  return "";
}

/**
 * ★날짜는 **칸 단위**로 읽는다. 행 전체 글자에서 정규식으로 찾으면 `D-22`·조회수와 붙거나
 *   먼저 나오는 **사업기간**이 잡힌다(hsbiz 「12872026.09.01」 함정의 같은 갈래).
 */
function recruitPeriodOf(li: HTMLElement): string {
  for (const p of li.querySelectorAll("div.subject > div.date > p")) {
    if (!clean(p.text).startsWith("모집기간")) continue;
    return ymdRange(clean(p.querySelector("span.font-numbers")?.text ?? ""));
  }
  return "";
}

/** 모집이 1년 넘게 전에 끝났으면 true. 날짜가 없으면 판단하지 않는다(버리지 않는다). */
function isStale(dateText: string, now: number): boolean {
  const ds = dateText.match(/20\d{2}-\d{2}-\d{2}/g) ?? [];
  const last = ds[ds.length - 1];
  if (!last) return false;
  const t = Date.parse(`${last}T23:59:59Z`);
  return Number.isFinite(t) && now - t > STALE_MAX_AGE_MS;
}

/**
 * 목록이 실어 주는 지역(`지역 : 울산`)을 `summary` 로 넘긴다.
 * ★`targetText` 가 아니라 `summary` 다 — `targetText` 를 채우면 뒷단계의 첨부 본문 뽑기가
 *   `targetText === ""` 조건에서 이 공고를 영영 건너뛴다(types.ts 주석).
 * 설정상 지역은 「전국」이라(협회 본부·지역본부가 섞인다) 행이 주는 이 값이 유일한 단서다.
 */
function summaryOf(li: HTMLElement): string {
  const bits: string[] = [];
  for (const item of li.querySelectorAll("div.info li")) {
    const t = clean(item.text);
    if (t.startsWith("지역")) bits.push(t);
  }
  return bits.join(" · ");
}

export function parseKitaList(html: string, _page = 1, now = Date.now()): BoardRow[] {
  const out: BoardRow[] = [];
  const seen = new Set<string>();
  // `> li` 로 못 박는다 — 행 안에 `div.info > ul > li`(「사업 : …」·「지역 : …」)가 또 들어 있어
  // 후손 선택자면 한 쪽이 30줄로 부푼다. 실제 방어는 아래 `onclick` 검문이 하지만,
  // 질의부터 좁혀 두어야 서식이 바뀌었을 때 엉뚱한 것이 조용히 통과하지 않는다.
  for (const li of parseHtml(html).querySelectorAll("ul.board-list-biz > li")) {
    const a = li.querySelector("div.subject > a[onclick]");
    const key = (a?.getAttribute("onclick") ?? "").match(GO)?.[1] ?? "";
    if (!key || seen.has(key)) continue;
    const title = clean(a?.text ?? "");
    if (!title || DROP.test(title)) continue;
    const category = clean(li.querySelector("div.cate > span.cate-info")?.text ?? "");
    if (DROP_CATEGORY.has(category)) continue;
    const dateText = recruitPeriodOf(li);
    if (isStale(dateText, now)) continue;
    seen.add(key);
    out.push({
      title,
      detailUrl: `${DETAIL}?bizAltkey=${encodeURIComponent(key)}`,
      dateText,
      category,
      summary: summaryOf(li),
    });
  }
  return out;
}

export const kitaConfig: BoardConfig = {
  id: "kita",
  label: "한국무역협회 지원사업",
  /**
   * ★기관을 제목 앞 대괄호에서 뽑지 않는다. 실측 대괄호는 `[인천]`·`[전남]`·`[상시]`·
   * `[모집마감]`·`[다이어리]` 처럼 **지역·상태 딱지**라, 기관으로 쓰면 중복 열쇠(`제목|기관`)가
   * 회차마다 갈린다(kbiz 와 반대 상황이다).
   */
  agency: "한국무역협회",
  region: "전국",
  baseUrl: `${BASE}/`,
  charset: "utf-8",
  list: {
    // 홀수 쪽 = 진행중인 사업 · 짝수 쪽 = 상시지원 사업(위 주석). 쪽 번호는 (p+1)/2.
    // 앞 4쪽·뒤 4쪽 블록으로 나누면 진행중 목록이 100건 미만일 때 「연속 두 쪽 신규 0」 규칙이 상시지원 목록
    // 앞에서 수집을 멈춘다(2026-09-03) — 그래서 번갈아 읽는다. 엔진의 쪽 변수 감지는 deep-paging 시험에서 예외 처리.
    url: (p) =>
      `${p % 2 === 1 ? ONGOING_LIST : ALWAYS_LIST}?pageIndex=${Math.ceil(p / 2)}&pageUnit=${PAGE_UNIT}`,
    maxPages: 8,
    rowSelector: "ul.board-list-biz > li",
    fields: {
      title: { selector: "div.subject > a" },
      detailUrl: { selector: "div.subject > a", attr: "onclick", regex: "goDetailPage\\(\\s*['\"]([A-Za-z0-9_-]+)" },
      date: { selector: "div.subject > div.date > p:nth-child(2) span.font-numbers" },
    },
  },
  customParse: parseKitaList,
  /**
   * ★본문 선택자를 **채운다**(kbiz·ccei 와 반대로 하는 이유).
   * 저 둘은 첨부 공고문에서 진짜 자격조건을 뽑게 하려고 일부러 비웠다. 그런데 이 게시판의
   * 첨부는 `href="javascript:void(0)"` + `onclick="doDownloadFile('58447','5A75…')"` 라
   * **첨부 수확기가 원리적으로 못 집는다**(eGov·서울TP 형식도 아니다). 여기서 본문까지 비우면
   * 본문·첨부가 둘 다 비어 `fillBoardDetail` 이 매번 `empty` 로 끝나고, 그 줄이 다음 회차에도
   * 「본문 빈 공고」 자리를 차지해 **다른 출처의 빈 본문이 차례를 못 받는다**(types.ts skipDetailFill 주석).
   * `div.detail-head` 는 사업기간·모집기간·참가신청 상태·사업분류·지역·담당부서를 담아
   * 조건 추출에 실제로 쓸모가 있다.
   */
  detailContentSelector: "div.detail-head, div.detail-body",
  /** 첨부 자리(수확은 위 이유로 0건이지만, 범위를 못 박아 두면 서식이 바뀌어도 오염되지 않는다). */
  attachmentsScopeSelector: "div.detail-footer",
  /**
   * ★추측 단계를 끈다. 이 목록에는 **진짜 링크가 하나도 없다**(상세는 전부 onclick).
   * heuristic 이 내려가면 머리글·메뉴의 `<a href>` 를 공고로, 메뉴 이름을 제목으로 저장하고
   * 그 줄은 다음 회차에 지워지지 않는다(한국수출입은행 실측 30줄).
   */
  skipHeuristic: true,
  /**
   * 1쪽(진행중인 사업)은 실측 80건 중 74건이 거르개를 통과한다. 절반(40)으로 잡으면
   * 비수기에 게시판 전체가 통째로 실패하므로 넉넉히 낮춘다 — 서식이 깨지면 0행이 되어
   * 어차피 「행 0개」로 걸린다.
   */
  // 1쪽은 진행중 목록 하나뿐이라 건수가 철에 따라 출렁인다 — 서식 깨짐은 customParse 가 0행으로 잡으므로 낮게 둔다(2026-09-03).
  expectMinRows: 5,
};
