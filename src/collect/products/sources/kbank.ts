/**
 * 케이뱅크(인터넷전문은행) 「사장님대출 맞춤조회」 — 상시 상품 수집기(설계 2026-09-03, 계획서 Task 11).
 * 페이지 하나에 상품 3종(사장님 신용대출·사장님 보증서대출·사장님 온택트 보증서대출)이
 * `<script type="application/ld+json">` 구조화 데이터로 통째로 실려 있다 — 표를 긁을 필요가 없다
 * (2026-09-03 10:13 실측 고정본 `__fixtures__/kbank-soho.html`).
 *
 * 구조: 페이지 안 ld+json 블록 중 하나가 `FinancialProduct(name:"사장님대출 맞춤조회")` →
 * `hasOfferCatalog.itemListElement[].itemOffered` 에 상품 3건(FinancialProduct, `interestRate` 있음).
 * 부모 노드는 `interestRate` 가 없어 재귀 수집에서 자연히 걸러진다.
 *
 * ★한도(limitMaxWon)는 「한도산정기준」 additionalProperty 만 보면 전부 서술형 문장
 * ("개인의 신용상태에 따라 차등 적용…", "보증서대출 최대한도는 보증상품 종류에 따라 상이")이라 숫자가
 * 없다. 하지만 같은 상품 노드에 **별도로 구조화된 `amount`(MonetaryAmount) 가 있고 그 `maxValue`
 * 가 실제 한도(원 단위)다**(2026-09-03 코덱스 리뷰 F2① — 고정본 `kbank-soho.html` 3건 모두 확인:
 * 신용대출 3억(300000000)·보증서대출 1억(100000000)·온택트 보증서대출 3천만(30000000)).
 * 그래서 `amount.maxValue` 가 있으면 그 값을 limitMaxWon 에 원 단위 그대로 싣고, 사람이 읽는
 * limitText 에도 「최대 N」을 앞에 붙인다 — 「한도산정기준」 원문만으로는 실제 상한이 안 보였다.
 * maxValue 자체가 없으면(다른 케이뱅크 상품 페이지를 나중에 추가할 때 대비) 지금처럼 null 로 둔다 —
 * 숫자를 지어내지 않는다(계획서 Task 11 원 결론은 유지, 다만 못 보고 지나친 필드가 있었다).
 */
import { parse } from "node-html-parser";
import { extractRate } from "../../amount-rate-extract";
import { fetchProductText } from "../fetch";
import type { NormalizedProduct, ProductSource, ProductTargetRules } from "../types";

/** 명부 id·FinanceProduct.source 공통 계약 — 접두어 `product-`(2026-09-03 자금 조달 지도 공통 계약). */
const SOURCE_ID = "product-kbank";
const PAGE_URL = "https://www.kbanknow.com/web/product/loan/soho-loan-custom-inquiry";
const INSTITUTION = "케이뱅크";
/** 페이지 상단 additionalProperty("신청채널")가 상품 3건 모두 같은 값이라 상수로 둔다. */
const CHANNEL = "케이뱅크 앱";

/** "사업장에 법인 또는 공동대표가 등재되지 않는 개인 기업 고객" — 있을 때만 개인사업자 전용으로 안다. */
const CORP_EXCLUDED_RE = /법인.{0,20}등재되지\s*않/;

type JsonLdNode = Record<string, unknown>;

/** ld+json 트리를 재귀로 훑어 `@type==="FinancialProduct"` 이면서 `interestRate` 가 있는 노드만 모은다. */
function collectFinancialProducts(node: unknown, out: JsonLdNode[]): void {
  if (Array.isArray(node)) {
    for (const item of node) collectFinancialProducts(item, out);
    return;
  }
  if (!node || typeof node !== "object") return;
  const obj = node as JsonLdNode;
  if (obj["@type"] === "FinancialProduct" && obj.interestRate) out.push(obj);
  for (const key of Object.keys(obj)) {
    if (key === "@type") continue;
    collectFinancialProducts(obj[key], out);
  }
}

/** additionalProperty[] 에서 이름으로 값을 찾는다 — 배열/글 어느 쪽이든 원천이 주는 대로. */
function propValue(node: JsonLdNode, name: string): string | string[] | undefined {
  const list = Array.isArray(node.additionalProperty) ? (node.additionalProperty as JsonLdNode[]) : [];
  const found = list.find((p) => p?.name === name);
  return found?.value as string | string[] | undefined;
}

/** 배열이면 사람이 읽기 좋게 " · " 로 잇는다(설계 다른 자리의 갈래 부제와 같은 구분자). 지어내지 않는다 — 원문 그대로. */
function joinValue(v: string | string[] | undefined): string {
  if (!v) return "";
  return Array.isArray(v) ? v.join(" · ") : v;
}

/** 「연 3.97% ~ 연 5.90%」 → 「연 3.97%~5.90%」 — extractRate 가 한 낱말짜리 구간으로 읽게 정규화. */
function normalizeRateRange(desc: string): string {
  return desc.replace(/\s*[~∼-]\s*연\s*/g, "~").replace(/\s+/g, " ").trim();
}

/** sourceId = 자금명 정규화(공백 제거) — sbiz.ts 와 같은 관례. */
function sourceIdOf(name: string): string {
  return name.replace(/\s+/g, "").replace(/[()（）]/g, "");
}

/** 「3억원」·「3,000만원」처럼 사람이 읽는 금액 — rules-to-conditions.ts moneyLabel 과 같은 규칙(파일이 달라 여기서 다시 적는다). */
function moneyLabelWon(won: number): string {
  if (won >= 100_000_000 && won % 100_000_000 === 0) return `${won / 100_000_000}억원`;
  if (won >= 10_000 && won % 10_000 === 0) return `${(won / 10_000).toLocaleString("ko-KR")}만원`;
  return `${won.toLocaleString("ko-KR")}원`;
}

/** amount.maxValue 가 있으면 「최대 N」을 한도산정기준 원문 앞에 붙인다 — 없으면(원문이 비어 있어도) 그대로 둔다. */
function limitTextWithMax(maxWon: number | null, base: string): string {
  if (maxWon === null) return base;
  const prefix = `최대 ${moneyLabelWon(maxWon)}`;
  return base ? `${prefix} · ${base}` : prefix;
}

function toProduct(node: JsonLdNode): NormalizedProduct {
  const name = typeof node.name === "string" ? node.name : "";
  const interestRate = (node.interestRate ?? {}) as { description?: string; maxValue?: number };
  const rate = extractRate(normalizeRateRange(interestRate.description ?? ""));
  const rateMax = typeof interestRate.maxValue === "number" ? interestRate.maxValue : null;
  const amount = (node.amount ?? {}) as { maxValue?: number };
  const limitMaxWon = typeof amount.maxValue === "number" ? amount.maxValue : null;
  const loanTerm = (node.loanTerm ?? {}) as { description?: string };
  const targetText = joinValue(propValue(node, "신청가능조건"));
  const limitTextRaw = joinValue(propValue(node, "한도산정기준"));
  const limitText = limitTextWithMax(limitMaxWon, limitTextRaw);
  const isGuaranteeBacked = name.includes("보증서");
  const targetRules: ProductTargetRules = CORP_EXCLUDED_RE.test(targetText) ? { isCorporation: false } : {};

  return {
    source: SOURCE_ID,
    sourceId: sourceIdOf(name),
    fundingGroup: "bank",
    institution: INSTITUTION,
    institutionType: "internet-bank",
    name,
    productType: isGuaranteeBacked ? "guarantee-backed" : "credit",
    targetText,
    targetRules,
    limitText,
    limitMaxWon,
    rateText: rate.rateText,
    rateMin: rate.rateMin,
    rateMax,
    feeText: "",
    termText: loanTerm.description ?? "",
    channel: CHANNEL,
    applyUrl: typeof node.url === "string" ? node.url : PAGE_URL,
    detailUrl: PAGE_URL,
    deadlineText: "상시",
    raw: node,
  };
}

/** ld+json 블록마다 JSON.parse 를 시도한다 — 페이지에 다른 스키마(WebSite 등)가 섞여 있어도 조용히 건너뛴다. */
export function parseKbank(html: string): NormalizedProduct[] {
  const root = parse(html);
  const scripts = root.querySelectorAll('script[type="application/ld+json"]');
  const matches: JsonLdNode[] = [];
  for (const script of scripts) {
    let json: unknown;
    try {
      json = JSON.parse(script.text);
    } catch {
      continue; // 깨진 JSON-LD — 사이트 개편으로 통째로 던지지 않는다
    }
    collectFinancialProducts(json, matches);
  }
  return matches.map(toProduct);
}

/** 정적 페이지 하나를 받아 3건을 만든다. 2건 미만이면 반쪽 응답으로 보고 던진다(빈 껍데기 방어). */
export async function fetchKbankAll(): Promise<NormalizedProduct[]> {
  const html = await fetchProductText({ id: SOURCE_ID, baseUrl: "https://www.kbanknow.com" }, PAGE_URL);
  const list = parseKbank(html);
  if (list.length < 2) {
    throw new Error(`kbank 사장님대출 상품이 ${list.length}건뿐 — 반쪽 응답으로 보고 저장하지 않는다`);
  }
  return list;
}

export const kbankSource: ProductSource = {
  id: SOURCE_ID,
  label: "케이뱅크 사장님대출 맞춤조회",
  url: PAGE_URL,
  fetchAll: fetchKbankAll,
};
