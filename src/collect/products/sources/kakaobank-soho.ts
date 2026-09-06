/**
 * 카카오뱅크 「개인사업자 신용대출」 — 상시 상품 수집기(계획서 2026-09-06 P2 w6).
 *
 * 게시판이 아니다. 공고도 마감도 없는 **상시 판매 상품**이라 게시판 수집기가 아니라 상품 어댑터로 붙인다.
 * 상품 소개 화면 `https://www.kakaobank.com/products/sohoLoans` 한 장이 **완전 서버 렌더**라
 * 가입대상·대출한도·대출기간·금리가 전부 HTML 글자로 들어 있다
 * (2026-09-06 실측 고정본 `__fixtures__/kakaobank-soho.html` · 200 / 77,831바이트 / 쿠키·로그인 불필요).
 *
 * 구조(고정본 실측):
 * · 상단 요약 `div.section-summary` → 상품명 `h1.summary-title span.gray`("카카오뱅크 개인사업자 신용대출"),
 *   `ul.summary-contents > li` 3개("최대한도 3억원" · "대출금리 연 3.36~14.22%" · "중도상환해약금 면제")
 * · 본문 `div.board_accordion > div.board_item` 4개. 제목은 `h3.info_tit span.tit_board`
 *   (상품안내 · 금리정보 · 기타사항 · 상품설명서 및 이용약관), 내용은 `div.info_cont` 안에서
 *   **`<strong>` 소제목 → 다음 `<strong>` 전까지**가 한 토막이다(가입대상·대출한도·대출기간 …).
 *
 * ★금리는 매일 바뀐다 — 화면에 「(2026.09.06 기준)」이 박혀 있다. 값을 붙잡아 두지 않고 회차마다
 *  다시 읽는다(저장 쪽이 lastSeenAt 을 갱신한다). 그래서 `rateText` 에 기준일 문구를 지우지 않고 남긴다.
 *
 * ★신청 창구(`channel`)는 **비운다.** 이 화면 어디에도 「어디서 신청하는지」가 글자로 없다
 *  (실측: 「앱에서」가 나오는 두 자리는 금리인하요구권·휴일 상환 설명이지 신청 창구가 아니다).
 *  「카카오뱅크 앱」은 사람이 아는 사실이지 원천이 준 값이 아니므로 지어내지 않는다.
 *
 * ★robots(https://www.kakaobank.com/robots.txt · 200): Googlebot·Yeti·Daum·facebookexternalhit 에만
 *  `Allow: /` 이고 `User-agent: *` 에는 `Disallow: /` 다. 상품 한 장을 12시간마다 읽는 정도지만
 *  **방침 표식** 대상이라 명부 note 에 적는다(계획서 「방침 표식」 — 사장님 확인 대상).
 */
import { parse } from "node-html-parser";
import { extractAmount, extractRate } from "../../amount-rate-extract";
import { fetchProductText } from "../fetch";
import type { NormalizedProduct, ProductSource, ProductTargetRules } from "../types";

/** 명부 id·FinanceProduct.source 공통 계약 — 접두어 `product-`(2026-09-03 자금 조달 지도 공통 계약). */
const SOURCE_ID = "product-kakaobank-soho";
const PAGE_URL = "https://www.kakaobank.com/products/sohoLoans";
const BASE_URL = "https://www.kakaobank.com";
const INSTITUTION = "카카오뱅크";

/** 「사업등록증이 있는 개인사업자(공동사업자의 경우 주대표만 신청가능)」 — 있을 때만 개인사업자 전용으로 안다. */
const SOLE_PROPRIETOR_RE = /개인사업자/;
/** 「연 3.351% ~ 14.219%」를 extractRate 가 한 낱말짜리 구간으로 읽게 정규화(kbank 와 같은 손질). */
function normalizeRateRange(text: string): string {
  return text.replace(/\s*[~∼-]\s*연\s*/g, "~").replace(/\s+/g, " ").trim();
}

/** 원문에 박힌 기준일(「(2026.09.06 기준)」). 없으면 빈 글자 — 날짜를 지어내지 않는다. */
const AS_OF_RE = /\(\s*20\d{2}[.\-/]\d{1,2}[.\-/]\d{1,2}\s*기준\s*\)/;

/**
 * 「대출금리」 토막에서 **상품 금리 한 줄만** 집는다.
 *
 * ★토막을 통째로 넘기면 안 된다 — 이 토막은 한 `<div>` 안에 상품 금리 구간·기준금리/가산금리 표·
 *  **우대금리 목록**(「연 0.20%」 셋)·연체금리가 다 들어 있어서, 공용 규칙이 뒤엣것을 집으면 상품 금리가
 *  「연 0.20%」로 저장된다(자체 시험이 실제로 잡았다).
 *
 * ★★그렇다고 「맨 앞 것」으로 정하면 안 된다(2026-09-06 독립 리뷰 6번) — 사이트가 표를 문장보다
 *  위로 올리는 날 **가산금리 구간(연 0.663%~10.448%)** 이 상품 금리로 둔갑한다. 그래서 두 겹으로 막는다:
 *  ① 매치 앞 20자에 기준/가산/우대/연체 금리라는 낱말이 있으면 그 구간은 버린다
 *  ② 상품명 앵커(「개인사업자 신용대출 :」) **바로 뒤**에 오는 구간을 가장 먼저 고른다 — 실측 문장이
 *     `∙ 개인사업자 신용대출 : 연 3.351% ~ 14.219% (2026.09.06 기준)` 꼴이라 순서가 뒤집혀도 이건 안 흔들린다.
 *  구간이 하나도 없으면 홑 금리로, 그것도 없으면 빈 글자(지어내지 않는다).
 */
const RATE_RANGE_RE = /연\s*[\d.]+\s*%\s*[~∼-]\s*(?:연\s*)?[\d.]+\s*%/g;
const RATE_ONE_RE = /연\s*[\d.]+\s*%/g;
/** 표 칸·우대 조건의 금리는 상품 금리가 아니다. */
const RATE_NOISE_RE = /기준금리|가산금리|우대금리|연체금리/;
/** 상품 금리 한 줄은 상품명 + 콜론 바로 뒤에 온다. */
const RATE_ANCHOR_RE = /개인사업자\s*신용대출\s*[:：]\s*$/;

function pickRate(text: string, re: RegExp): string {
  const clean = [...text.matchAll(new RegExp(re.source, "g"))].filter(
    (m) => !RATE_NOISE_RE.test(text.slice(Math.max(0, (m.index ?? 0) - 20), m.index ?? 0)),
  );
  const anchored = clean.find((m) =>
    RATE_ANCHOR_RE.test(text.slice(Math.max(0, (m.index ?? 0) - 40), m.index ?? 0)),
  );
  return (anchored ?? clean[0])?.[0] ?? "";
}

export function rateHeadline(text: string): string {
  return pickRate(text, RATE_RANGE_RE) || pickRate(text, RATE_ONE_RE);
}

/** 정규화된 rateText(「연 A%~B%」)의 **뒷 숫자**. 구간이 아니면 null — 지어내지 않는다. */
export function rateMaxOf(rateText: string): number | null {
  const m = rateText.match(/~\s*연?\s*([\d.]+)\s*%/);
  const v = m ? Number(m[1]) : NaN;
  return Number.isFinite(v) ? v : null;
}

function squash(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * `div.info_cont` 안에서 `<strong>소제목</strong>` 부터 **다음 `<strong>` 직전**까지의 글을 모은다.
 * 소제목이 없으면 빈 글자(원천이 안 알려 줌 — 지어내지 않는다).
 */
export function sectionParts(contHtml: string, label: string): string[] {
  const cont = parse(contHtml);
  /**
   * ★**화면에 안 보이는 표 설명**을 먼저 걷어낸다(2026-09-06 독립 리뷰 1번).
   * 이 화면의 표마다 `<caption class="caption_g">대출한도 표로 개인사업자 신용대출에 대한 안내</caption>`
   * 가 달려 있는데(눈에는 안 보이고 화면낭독기용이다), 그대로 두면 한도·대상·기간 글이 전부
   * 그 문장으로 **시작**한다 — 자금 지도 카드의 「얼마까지」는 한 줄로 잘라 보여 주므로
   * 정작 「최대 3억원」이 잘려 사라진다.
   */
  for (const hidden of cont.querySelectorAll("caption, .caption_g, .blind")) hidden.remove();
  let started = false;
  const parts: string[] = [];
  for (const node of cont.childNodes) {
    const tag = (node as { tagName?: string }).tagName;
    if (tag === "STRONG") {
      const t = squash(node.text);
      if (started) break;
      if (t === label) started = true;
      continue;
    }
    if (!started) continue;
    const t = squash(node.text);
    if (t) parts.push(t);
  }
  return parts;
}

export function sectionText(contHtml: string, label: string): string {
  return sectionParts(contHtml, label).join(" ").trim();
}

/** 상단 요약 `ul.summary-contents > li` 한 줄(「최대한도 3억원」)에서 이름표를 뗀 값. 없으면 빈 글자. */
export function summaryValue(html: string, label: string): string {
  for (const li of parse(html).querySelectorAll("ul.summary-contents > li")) {
    const t = squash(li.text);
    if (t.startsWith(label)) return t.slice(label.length).trim();
  }
  return "";
}

/**
 * 「3억원」·「3,000만원」처럼 사람이 읽는 금액 — 형제 어댑터 `kbank.ts` 의 `moneyLabelWon` 과 같은 규칙
 * (파일이 달라 거기 주석대로 여기서 다시 적는다).
 */
function moneyLabelWon(won: number): string {
  if (won >= 100_000_000 && won % 100_000_000 === 0) return `${won / 100_000_000}억원`;
  if (won >= 10_000 && won % 10_000 === 0) return `${(won / 10_000).toLocaleString("ko-KR")}만원`;
  return `${won.toLocaleString("ko-KR")}원`;
}

/**
 * 한도 글 맨 앞에 「최대 N」을 세운다 — `kbank.ts` 의 `limitTextWithMax` 와 같은 모양.
 * 자금 지도 카드의 「얼마까지」는 한 줄로 잘라 보여 주므로, 금액이 문장 뒤에 묻히면 화면에서 사라진다.
 */
function limitTextWithMax(maxWon: number | null, base: string): string {
  if (maxWon === null) return base;
  const prefix = `최대 ${moneyLabelWon(maxWon)}`;
  return base ? `${prefix} · ${base}` : prefix;
}

/** sourceId = 상품명 정규화(공백·괄호 제거) — sbiz·kbank 와 같은 관례. */
function sourceIdOf(name: string): string {
  return name.replace(/\s+/g, "").replace(/[()（）]/g, "");
}

/** 본문 아코디언에서 제목이 `label` 인 토막의 `div.info_cont` HTML. 없으면 빈 글자. */
function boardItemHtml(html: string, label: string): string {
  for (const item of parse(html).querySelectorAll("div.board_item")) {
    const tit = squash(item.querySelector("h3.info_tit span.tit_board")?.text ?? "");
    if (tit === label) return item.querySelector("div.info_cont")?.innerHTML ?? "";
  }
  return "";
}

/**
 * 상품 한 건을 만든다. 상품명이 없으면 화면 서식이 바뀐 것이라 `null` —
 * 이름 없는 줄을 저장하면 화면에 빈 카드가 남는다.
 */
export function parseKakaobankSoho(html: string): NormalizedProduct | null {
  const root = parse(html);
  const name = squash(root.querySelector("h1.summary-title span.gray")?.text ?? "");
  if (!name) return null;

  const product = boardItemHtml(html, "상품안내");
  const rateInfo = boardItemHtml(html, "금리정보");

  // 가입대상 — 표 안의 조건 줄과 취급 금지업종까지 한 토막에 들어 있다(실측).
  const targetText = sectionText(product, "가입대상");
  // 대출한도 — 「최대 3억원」 + 「※ 최소 대출신청 가능금액은 100만원입니다.」
  const limitRaw = sectionText(product, "대출한도");
  const limitAmount = extractAmount(limitRaw);
  const termText = sectionText(product, "대출기간");
  // 중도상환해약금은 상단 요약과 본문 둘 다 준다 — 본문을 먼저 보고 없으면 요약으로.
  const prepay = sectionText(product, "중도상환해약금") || summaryValue(html, "중도상환해약금");

  // 대출금리 — 「∙ 개인사업자 신용대출 : 연 3.351% ~ 14.219% (2026.09.06 기준)」
  const rateRaw = sectionText(rateInfo, "대출금리");
  const rate = extractRate(normalizeRateRange(rateHeadline(rateRaw)));
  /**
   * ★기준일을 **원문 그대로** 뒤에 붙인다 — 이 상품은 금리가 날마다 바뀌어서
   * 「언제 값인지」가 값의 일부다(화면에 「(2026.09.06 기준)」이 박혀 있다). 없으면 안 붙인다.
   */
  const asOf = rateRaw.match(AS_OF_RE)?.[0] ?? "";
  const rateText = rate.rateText && asOf ? `${rate.rateText} ${asOf}` : rate.rateText;

  const targetRules: ProductTargetRules = SOLE_PROPRIETOR_RE.test(targetText) ? { isCorporation: false } : {};

  return {
    source: SOURCE_ID,
    sourceId: sourceIdOf(name),
    fundingGroup: "bank",
    institution: INSTITUTION,
    institutionType: "internet-bank",
    name,
    productType: "credit",
    targetText,
    targetRules,
    limitText: limitTextWithMax(limitAmount.amountMaxWon, limitRaw),
    limitMaxWon: limitAmount.amountMaxWon,
    rateText,
    rateMin: rate.rateMin,
    rateMax: rateMaxOf(rate.rateText),
    feeText: prepay ? `중도상환해약금 ${prepay}` : "",
    termText,
    /**
     * ★비워 두는 것이 맞다(2026-09-06 독립 리뷰 8번 판정 유지). 이 화면 어디에도 「어디서 신청하는지」가
     * 글자로 없다 — 「카카오뱅크 앱」은 사람이 아는 사실이지 원천이 준 값이 아니라 채우지 않는다.
     */
    channel: "",
    applyUrl: PAGE_URL,
    detailUrl: PAGE_URL,
    deadlineText: "상시",
    raw: { name, targetText, limitRaw, termText, rateRaw, prepay },
  };
}

/**
 * 상품 화면 한 장을 받아 1건을 만든다.
 * 못 읽으면 던진다 — 빈 껍데기(로그인 화면·차단 안내)를 저장하면 화면에서 상품이 사라진 줄 모른다.
 */
export async function fetchKakaobankSohoAll(): Promise<NormalizedProduct[]> {
  const html = await fetchProductText({ id: SOURCE_ID, baseUrl: BASE_URL }, PAGE_URL);
  const one = parseKakaobankSoho(html);
  if (!one) throw new Error("카카오뱅크 개인사업자 신용대출 화면에서 상품명을 못 읽었다 — 서식 변경으로 보고 저장하지 않는다");
  if (!one.targetText || !one.rateText) {
    throw new Error("카카오뱅크 개인사업자 신용대출 — 가입대상·금리를 못 읽었다(반쪽 응답)");
  }
  return [one];
}

export const kakaobankSohoSource: ProductSource = {
  id: SOURCE_ID,
  label: "카카오뱅크 개인사업자 신용대출",
  url: PAGE_URL,
  fetchAll: fetchKakaobankSohoAll,
};
