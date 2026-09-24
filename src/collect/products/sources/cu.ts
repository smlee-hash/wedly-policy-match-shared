/**
 * 신협 사업자대출 — 상시 상품 수집기(설계 2026-09-25 §F).
 * 신협중앙회 대출 상품 목록(`/cu/ad/fnncGoods/selectFnncGoodsLonList.do?mi=100244`)의 `fn_selectFnncGoods('N')`
 * 링크를 상품 번호(N)로 한 번씩만 세고, 링크 a 의 title(상품 이름)에 「사업자|자영업|소상공인|개인사업」이 든 것만
 * 고른다(2026-09-25 01시 KST 고정본 기준 18개 중 3개 — 95 소상공인지원대출금·76 자영업자스피드대출금·
 * 70 VAN사업자대출금). 목록은 한 쪽 20건이라 고정본(총 18개)은 한 번 GET 에 다 든다.
 *
 * ★상세(`…/selectFnncGoodsLonInfo.do?fnncGoodsSn=N`)의 `section#section_B01` 에는 주석(`<!-- … -->`)으로 막은
 * 옛 설명 블록이 살아 있는 설명 앞에 있다(고정본 70: 주석 속 「1인당 7천만원 이내」, 살아 있는 값 「최대 1인당
 * 7천만원」). node-html-parser 기본 parse 는 주석을 버리므로 살아 있는 `ul.info_list` 만 읽힌다(시험이 지킨다).
 * 쪽 위 요약 상자(`ul.explandata`)에도 옛 한도 글이 남아 있어 section_B01 밖은 읽지 않는다.
 *
 * ★실제 취급 여부·조건은 조합마다 다르다 — 대상 글 항목과 함께 조합 확인 항목을 humanCheck 에 늘 달아 이 상품만으로
 * 「맞음」이 나오지 않게 한다(설계 §F). 지역 조건 없음. 값은 원문 그대로 — 못 읽으면 빈 값/null.
 */
import { HTMLElement, parse } from "node-html-parser";
import { extractRate } from "../../../funding/amount-rate-extract";
import { firstLimitWon } from "./guarantee-limit";
import { guaranteeTargetRules } from "./guarantee-target";
import { fetchProductText } from "../fetch";
import type { NormalizedProduct, ProductSource } from "../types";

/** 명부 id·FinanceProduct.source 공통 계약 — 접두어 `product-`(kinfa.ts 와 동일). */
const SOURCE_ID = "product-cu";
const BASE_URL = "https://www.cu.co.kr";
export const CU_LIST_URL = `${BASE_URL}/cu/ad/fnncGoods/selectFnncGoodsLonList.do?mi=100244`;
const INSTITUTION = "신협";
/** 원천에 신청 창구 칸이 없어 설계 결정 글을 그대로 쓴다. */
const CHANNEL = "가까운 신협 조합";
/** 조합마다 취급·조건이 달라 모든 상품에 늘 다는 확인 항목(설계 §F). */
export const CU_BRANCH_NOTE = "실제 취급 여부·조건은 신협 조합마다 다름 — 가까운 조합에 확인";
/** 사업자 대상 상품 — 이름에 이 말이 든 것만(설계 §F). */
const BUSINESS_NAME = /사업자|자영업|소상공인|개인사업/;
/** 목록 상품 링크 — `javascript:fn_selectFnncGoods('70');` 의 상품 번호. */
const GOODS_LINK = /fn_selectFnncGoods\(\s*'(\d+)'\s*\)/;
/** 고정본 기준 3개 — 2건보다 적으면 반쪽 응답이거나 목록 모양이 바뀐 것이다(설계 §F). */
const MIN_ITEMS = 2;
const FETCH_SOURCE = { id: SOURCE_ID, baseUrl: BASE_URL };
/** 목록·상세 공통 — 넉넉히 잡되 끝은 둔다. */
const FETCH_LIMITS = { timeoutMs: 30_000, maxBytes: 1_000_000 };
/** 값 글자에서 뺀다 — caption 은 숨은 표 설명(고객부담비용 칸 인지세 표), script·style 은 글이 아니다. */
const SKIP_TAGS = new Set(["CAPTION", "SCRIPT", "STYLE"]);
/** 앞뒤 글자에 붙여 읽는 글자 꾸밈 — 그 밖의 요소(li·p·<br>·표 칸…) 경계는 공백 한 칸. */
const INLINE_TAGS = new Set([
  "A", "ABBR", "B", "CODE", "DEL", "EM", "FONT", "I", "INS", "MARK", "S", "SMALL", "STRIKE", "STRONG", "SUB", "SUP", "U",
]);

/** 목록의 사업자 상품 하나 — 상품 번호(fnncGoodsSn)와 목록 a 의 title(상품 이름). */
export interface CuListItem {
  sn: string;
  name: string;
}

/** 상세 주소 — 목록 링크의 상품 번호로(설계 §F). */
export function cuDetailUrl(sn: string): string {
  return `${BASE_URL}/cu/ad/fnncGoods/selectFnncGoodsLonInfo.do?fnncGoodsSn=${sn}`;
}

/** 줄바꿈/탭/중복 공백 한 칸으로 + 앞뒤 공백 제거. */
function normalize(v: string): string {
  return v.replace(/\s+/g, " ").trim();
}

function childElements(el: HTMLElement): HTMLElement[] {
  return el.childNodes.filter((n): n is HTMLElement => n instanceof HTMLElement);
}

/** 요소 글자 — 글자 꾸밈(a·b·u…)은 붙여 읽고 그 밖의 요소 경계(li·p·<br>…)는 공백 한 칸, caption 은 뺀다. */
function textOf(el: HTMLElement): string {
  const parts: string[] = [];
  const walk = (node: HTMLElement): void => {
    for (const child of node.childNodes) {
      if (!(child instanceof HTMLElement)) {
        parts.push(child.text);
      } else if (!SKIP_TAGS.has(child.tagName)) {
        const gap = INLINE_TAGS.has(child.tagName) ? "" : " ";
        parts.push(gap);
        walk(child);
        parts.push(gap);
      }
    }
  };
  walk(el);
  return normalize(parts.join(""));
}

/**
 * 목록 HTML → 사업자 상품(번호·이름), 번호가 처음 나온 순서대로. 상품마다 같은 번호 링크가 셋(분류·이름·소개)
 * 나오고 약관·설명서 내려받기 a 도 같은 title 을 달고 있어, 번호 링크만 번호로 한 번 센다. 이름은 title 속성 —
 * 첫 링크 글자는 분류(「기타대출」)라 이름이 아니다. 순수 함수 — 네트워크 없이 고정본만으로 시험한다.
 */
export function parseCuList(html: string): CuListItem[] {
  const seen: CuListItem[] = [];
  for (const a of parse(html).querySelectorAll("a")) {
    const sn = (a.getAttribute("href") ?? "").match(GOODS_LINK)?.[1];
    if (!sn) continue;
    const name = normalize(a.getAttribute("title") ?? "");
    const prev = seen.find((p) => p.sn === sn);
    if (!prev) seen.push({ sn, name });
    else if (!prev.name) prev.name = name;
  }
  // 어느 링크에도 title 이 없으면 이름을 지어내지 않고 버린다
  return seen.filter((item) => item.name && BUSINESS_NAME.test(item.name));
}

/**
 * 상세 HTML → 칸 이름(공백 없앰)→값 사전. `section#section_B01` 안 `ul.info_list` 의 직계 li 마다 strong(칸 이름)과
 * `ul.list_stT1`(값). 같은 칸 이름은 첫 것만, 못 찾으면 빈 사전. 주석 속 옛 블록은 parse 기본값이 버려 여기까지
 * 오지 않는다.
 */
export function parseCuDetail(html: string): Record<string, string> {
  const fields: Record<string, string> = {};
  const section = parse(html).querySelector("section#section_B01");
  if (!section) return fields;
  for (const list of section.querySelectorAll("ul.info_list")) {
    for (const li of childElements(list)) {
      if (li.tagName !== "LI") continue;
      const kids = childElements(li);
      const labelEl = kids.find((c) => c.tagName === "STRONG");
      const valueEl = kids.find((c) => c.tagName === "UL" && c.classList.contains("list_stT1"));
      if (!labelEl || !valueEl) continue;
      // 칸 이름에 앞뒤 공백·<br> 이 섞여 나온다(「 상품유형」「 대출기간 」) — 공백을 지워 맞춘다
      const label = textOf(labelEl).replace(/\s+/g, "");
      if (label && !(label in fields)) fields[label] = textOf(valueEl);
    }
  }
  return fields;
}

/**
 * 목록 한 줄 + 상세 칸 → NormalizedProduct. humanCheck 는 대상 글 한 항목(80자, 못 읽었으면 「읽지 못함」)과
 * 조합 확인 항목 — 기계 조건이 없으니 이 상품만으로 「맞음」이 나오지 않는다.
 */
function productOf(item: CuListItem, fields: Record<string, string>): NormalizedProduct {
  const detailUrl = cuDetailUrl(item.sn);
  const name = fields["상품명"] || item.name; // 상세 상품명이 있으면 그것, 없으면(상세 실패 포함) 목록 이름
  const targetText = fields["대출대상"] ?? "";
  const limitText = fields["대출한도"] ?? "";
  const rateText = fields["대출금리"] ?? "";
  const rules = guaranteeTargetRules(targetText);
  const product: NormalizedProduct = {
    source: SOURCE_ID,
    // 목록의 상품 번호 — 상세를 못 받은 회차에도 같은 행을 가리켜야 keepExisting 이 기존 값을 지킨다
    sourceId: item.sn,
    fundingGroup: "bank",
    institution: INSTITUTION,
    institutionType: "bank",
    name,
    // 「기타대출」 등 그 밖의 유형은 형태를 지어내지 않는다
    productType: fields["상품유형"] === "신용" ? "credit" : "",
    targetText,
    targetRules: { ...rules, humanCheck: [...(rules.humanCheck ?? []), CU_BRANCH_NOTE] },
    limitText,
    limitMaxWon: firstLimitWon(limitText), // 맨 앞 대표 한도(guarantee-limit.ts)
    rateText,
    rateMin: extractRate(rateText).rateMin, // 「기준금리 + 가산금리」처럼 숫자가 없으면 null
    rateMax: null,
    feeText: "", // 상환방법은 수수료가 아니다(설계 §F)
    termText: fields["대출기간"] ?? "",
    channel: CHANNEL,
    applyUrl: "", // 신청 주소 원문이 없다 — 지어내지 않는다
    detailUrl,
    deadlineText: "상시",
    raw: { url: detailUrl, fields: { 목록이름: item.name, ...fields } },
  };
  // 상세를 못 받았거나 대출대상을 못 읽었다 — 저장소가 기존 행 값을 빈 값으로 덮지 않게(types.ts keepExisting)
  if (!targetText) product.keepExisting = true;
  return product;
}

/**
 * 실제 수집 — 목록 한 번 + 사업자 상품마다 상세 한 번. 상세는 **한 번에 하나씩 순서대로** 받는다(동시 요청
 * 금지 — 설계 머리말). 사업자 상품이 2건 미만이면 던지고, 상세 한 건 실패는 그 상품만 목록 이름 + keepExisting 으로 낸다.
 */
export async function fetchCuAll(): Promise<NormalizedProduct[]> {
  const items = parseCuList(await fetchProductText(FETCH_SOURCE, CU_LIST_URL, { method: "GET" }, FETCH_LIMITS));
  if (items.length < MIN_ITEMS) {
    throw new Error(`신협 사업자 대출 상품이 ${items.length}건뿐 — 반쪽 응답(또는 목록 모양 변경)으로 보고 저장하지 않는다`);
  }
  const out: NormalizedProduct[] = [];
  for (const item of items) {
    let fields: Record<string, string> = {};
    try {
      fields = parseCuDetail(
        await fetchProductText(FETCH_SOURCE, cuDetailUrl(item.sn), { method: "GET" }, FETCH_LIMITS),
      );
    } catch {
      // 한 건 실패로 회차 전체를 버리지 않는다 — 이 상품만 목록 이름으로(productOf 가 keepExisting 을 붙인다)
    }
    out.push(productOf(item, fields));
  }
  return out;
}

export const cuSource: ProductSource = {
  id: SOURCE_ID,
  label: "신협 사업자대출",
  url: CU_LIST_URL,
  fetchAll: fetchCuAll,
};
