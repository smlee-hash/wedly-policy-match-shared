/**
 * 새마을금고 사업자대출 — 상시 상품 수집기(설계 2026-09-25 §G).
 * 새마을금고중앙회 상품 설명 팝업 한 쪽(`/html/goods/popup/goods0217.html`)을 받는다(2026-09-25 01시 KST 고정본
 * 기준 1건 — 사장님드림UP대출). 이름은 `h1.tit_popup` 글자에서 끝의 「상세설명」을 뗀 것, 칸은 `h3.con_title02`
 * (칸 이름) 뒤를 다음 h3 전까지 따르는 `p.con_title03` 들(값 — 여럿이면 공백 한 칸으로 잇는다. 대출기간이 둘).
 *
 * ★실제 조건은 금고마다 다르다 — 대상 글 항목과 함께 금고 확인 항목을 humanCheck 에 늘 달아 이 상품만으로
 * 「맞음」이 나오지 않게 한다(설계 §G). 지역 조건 없음. 값은 원문 그대로 — 못 읽으면 빈 값/null.
 * 1건짜리 원천이라 반쪽 판단이 곧 전부다 — 이름·신청대상을 못 읽으면 저장하지 않고 던진다.
 */
import { HTMLElement, parse } from "node-html-parser";
import { extractRate } from "../../../funding/amount-rate-extract";
import { firstLimitWon } from "./guarantee-limit";
import { guaranteeTargetRules } from "./guarantee-target";
import { fetchProductText } from "../fetch";
import type { NormalizedProduct, ProductSource } from "../types";

/** 명부 id·FinanceProduct.source 공통 계약 — 접두어 `product-`(kinfa.ts 와 동일). */
const SOURCE_ID = "product-kfcc";
const BASE_URL = "https://www.kfcc.co.kr";
/** 상품 설명 팝업 쪽 이름 — sourceId 로도 쓴다(상품 이름 글자가 바뀌어도 같은 행을 가리키게). */
const PAGE = "goods0217";
export const KFCC_URL = `${BASE_URL}/html/goods/popup/${PAGE}.html`;
const INSTITUTION = "새마을금고";
/** 원천에 신청 창구 칸이 없어 설계 결정 글을 그대로 쓴다. */
const CHANNEL = "가까운 새마을금고";
/** 금고마다 조건이 달라 늘 다는 확인 항목(설계 §G). */
export const KFCC_BRANCH_NOTE = "실제 조건은 새마을금고마다 다름 — 가까운 금고에 확인";
const FETCH_SOURCE = { id: SOURCE_ID, baseUrl: BASE_URL };
/** 팝업 한 쪽 — 넉넉히 잡되 끝은 둔다. */
const FETCH_LIMITS = { timeoutMs: 30_000, maxBytes: 1_000_000 };

/** 줄바꿈/탭/중복 공백 한 칸으로 + 앞뒤 공백 제거. */
function normalize(v: string): string {
  return v.replace(/\s+/g, " ").trim();
}

function childElements(el: HTMLElement): HTMLElement[] {
  return el.childNodes.filter((n): n is HTMLElement => n instanceof HTMLElement);
}

/** 칸 이름(공백 없앰) → 값. h3 뒤 다음 h3 전까지의 형제 p.con_title03 들을 공백 한 칸으로 잇는다. 같은 칸 이름은 첫 것만. */
function fieldsOf(root: HTMLElement): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const head of root.querySelectorAll("h3.con_title02")) {
    const siblings = head.parentNode ? childElements(head.parentNode) : [];
    const values: string[] = [];
    for (const el of siblings.slice(siblings.indexOf(head) + 1)) {
      if (el.tagName === "H3") break; // 다음 칸
      if (el.tagName === "P" && el.classList.contains("con_title03")) values.push(normalize(el.text));
    }
    const label = head.text.replace(/\s+/g, "");
    if (label && !(label in fields)) fields[label] = values.filter(Boolean).join(" ");
  }
  return fields;
}

/**
 * 팝업 HTML → 상품 한 건. 이름을 못 읽으면 null(지어내지 않는다), 신청대상을 못 읽으면 keepExisting +
 * 「읽지 못함」 확인 항목. 순수 함수 — 네트워크 없이 고정본만으로 시험한다.
 */
export function parseKfcc(html: string): NormalizedProduct | null {
  const root = parse(html);
  const name = normalize(root.querySelector("h1.tit_popup")?.text ?? "").replace(/\s*상세\s*설명$/, "");
  if (!name) return null;
  const f = fieldsOf(root);
  const targetText = f["신청대상"] ?? "";
  const limitText = f["대출한도"] ?? "";
  const rateText = f["대출금리"] ?? "";
  const rules = guaranteeTargetRules(targetText);
  const product: NormalizedProduct = {
    source: SOURCE_ID,
    sourceId: PAGE,
    fundingGroup: "bank",
    institution: INSTITUTION,
    institutionType: "bank",
    name,
    productType: "credit",
    targetText,
    targetRules: { ...rules, humanCheck: [...(rules.humanCheck ?? []), KFCC_BRANCH_NOTE] },
    limitText,
    limitMaxWon: firstLimitWon(limitText), // 맨 앞 대표 한도(guarantee-limit.ts)
    rateText,
    rateMin: extractRate(rateText).rateMin, // 「신용등급 및 거래실적에 따라 차등 적용」처럼 숫자가 없으면 null
    rateMax: null,
    feeText: "",
    termText: f["대출기간"] ?? "",
    channel: CHANNEL,
    applyUrl: "", // 신청 주소 원문이 없다 — 지어내지 않는다
    detailUrl: KFCC_URL,
    deadlineText: "상시",
    raw: { url: KFCC_URL, fields: { 상품명: name, ...f } },
  };
  // 신청대상을 못 읽었다 — 저장소가 기존 행 값을 빈 값으로 덮지 않게(types.ts keepExisting)
  if (!targetText) product.keepExisting = true;
  return product;
}

/** 실제 수집 — 팝업 한 쪽 GET. 이름이나 신청대상을 못 읽으면 던진다(1건짜리라 그 응답을 저장하지 않는다). */
export async function fetchKfccAll(): Promise<NormalizedProduct[]> {
  const product = parseKfcc(await fetchProductText(FETCH_SOURCE, KFCC_URL, { method: "GET" }, FETCH_LIMITS));
  if (!product) {
    throw new Error("새마을금고 상품 쪽에서 이름(h1.tit_popup)을 못 읽었다 — 반쪽 응답(또는 쪽 모양 변경)으로 보고 저장하지 않는다");
  }
  if (!product.targetText) {
    throw new Error("새마을금고 상품 쪽에서 신청대상을 못 읽었다 — 반쪽 응답(또는 쪽 모양 변경)으로 보고 저장하지 않는다");
  }
  return [product];
}

export const kfccSource: ProductSource = {
  id: SOURCE_ID,
  label: "새마을금고 사업자대출",
  url: KFCC_URL,
  fetchAll: fetchKfccAll,
};
