/**
 * 기술보증기금(KIBO) 보증상품 — 상시 상품 수집기(설계 2026-09-25 §E).
 * 보증상품 목록 쪽(`/main/work/work01030101.do`)의 링크 중 경로가 정확히 `/main/work/work01(05~09)NN.do`
 * (숫자 6자리)인 쪽만 상품으로 삼는다(2026-09-25 01시 KST 고정본 기준 21개 — 재기 3·창업 8·기업 4·
 * R&D·IP·녹색 3·일자리·4차 3). `work01050103` 같은 8자리 쪽은 상품 아래 안내 쪽이라 뺀다.
 *
 * ★같은 메뉴 링크가 여러 번 나오고, 글자가 비었거나 공백뿐인 a 도 같은 경로로 섞여 나온다(고정본 실측) —
 * 경로로 중복을 지우고 이름은 같은 경로의 글자 있는 a 에서 가져온다(엔티티 &#40; &#41; &amp; 는 풀어서).
 *
 * ★상세는 상품마다 GET 해 머리 제목 `h2.sec-title` 을 이름으로, 본문 `div#cms-content` 글자 전체를 대상 글로
 * 삼는다(쪽 아래 누리집 이용안내·주소는 본문 밖). 대상 글은 기계 조건으로 풀지 않는다 — humanCheck 한
 * 항목으로만 넣어 판정이 「확인 필요」에 머물게 한다(설계 공통 규칙 3, 지역 조건 없음). 한도·금리·기간은
 * 서술형이라 숫자로 옮기지 않고 빈 값/null 로 둔다(지어내지 않는다).
 */
import { parse } from "node-html-parser";
import { fetchProductText } from "../fetch";
import type { NormalizedProduct, ProductSource } from "../types";
import { guaranteeTargetRules } from "./guarantee-target";

/** 명부 id·FinanceProduct.source 공통 계약 — 접두어 `product-`(kinfa.ts 와 동일). */
const SOURCE_ID = "product-kibo";
const BASE_URL = "https://www.kibo.or.kr";
export const KIBO_LIST_URL = `${BASE_URL}/main/work/work01030101.do`;
const INSTITUTION = "기술보증기금";
/** 원천에 신청 창구 칸이 없어 설계 결정 글을 그대로 쓴다. */
const CHANNEL = "기술보증기금 영업점·디지털지점";
/** 상품 쪽 경로 — 숫자 6자리만. 8자리 안내 쪽(`work01050103` 같은)과 목록 쪽 자신은 맞지 않는다. */
const PRODUCT_PATH = /^\/main\/work\/work01(?:05|06|07|08|09)\d{2}\.do$/;
/** 고정본 기준 21개 — 15건보다 적으면 반쪽 응답이거나 메뉴 모양이 바뀐 것이다. */
const MIN_ITEMS = 15;
const FETCH_SOURCE = { id: SOURCE_ID, baseUrl: BASE_URL };
/** 목록·상세 공통 — 고정본이 180KB 안팎이라 넉넉히 잡되 끝은 둔다. */
const FETCH_LIMITS = { timeoutMs: 30_000, maxBytes: 2_000_000 };

/** 목록의 상품 하나 — 메뉴 이름과 사이트 안 경로(`/main/work/work01NNNN.do`). */
export interface KiboListItem {
  name: string;
  path: string;
}

/** 상세 한 쪽에서 읽는 값 — 못 읽은 칸은 빈 값(지어내지 않는다). */
export interface KiboDetail {
  name: string;
  targetText: string;
}

/** 줄바꿈/탭/중복 공백 한 칸으로 + 앞뒤 공백 제거. */
function normalize(v: string): string {
  return v.replace(/\s+/g, " ").trim();
}

/** sourceId 조각 정규화 — 공백·괄호 제거(kinfa.ts idPart 와 같은 규칙). */
function idPart(v: string): string {
  return v.replace(/\s+/g, "").replace(/[()（）]/g, "");
}

/** 상세 주소 = 기관 주소 + 메뉴 경로(설계 §E). */
function detailUrlOf(item: KiboListItem): string {
  return `${BASE_URL}${item.path}`;
}

/**
 * 목록 HTML → 상품(이름·경로), 경로가 처음 나온 순서대로.
 * 순수 함수 — 네트워크 없이 고정본만으로 시험한다.
 */
export function parseKiboList(html: string): KiboListItem[] {
  const seen: KiboListItem[] = [];
  for (const a of parse(html).querySelectorAll("a")) {
    const path = (a.getAttribute("href") ?? "").trim();
    if (!PRODUCT_PATH.test(path)) continue;
    const name = normalize(a.text);
    const prev = seen.find((p) => p.path === path);
    // 자리는 그 경로가 처음 나온 곳, 이름은 **마지막으로 나온 글자 있는 a** — 메뉴는 같은 경로를 먼저 묶음 이름
    // (「재기지원보증」「R&D·지식재산(IP)보증」)으로 걸고 뒤에 상품 이름(「재도전 재기지원보증」「R&D보증」)으로 건다
    // (2026-09-25 총괄 실측). 상세를 못 읽은 상품이 묶음 이름으로 저장되지 않게.
    if (!prev) seen.push({ name, path });
    else if (name) prev.name = name;
  }
  const out: KiboListItem[] = [];
  for (const item of seen) {
    // 어느 a 에도 글자가 없으면 이름을 지어내지 않고 버린다 — 이름(sourceId)이 겹치면 첫 것만(ksure.ts 와 같은 규칙)
    if (!item.name || out.some((p) => idPart(p.name) === idPart(item.name))) continue;
    out.push(item);
  }
  return out;
}

/**
 * 상세 HTML → 이름(`#main-section` 머리의 `h2.sec-title`)과 대상 글(`div#cms-content` 글자 전체를 공백 한 칸으로 —
 * 자르지 않는다, 공용 리뷰 P2). 쪽 아래 누리집 이용안내·주소는 본문 밖이라 들어오지 않는다. 못 찾은 값은 빈 값.
 */
export function parseKiboDetail(html: string): KiboDetail {
  const root = parse(html);
  return {
    name: normalize(root.querySelector("#main-section h2.sec-title")?.text ?? ""),
    targetText: normalize(root.querySelector("div#cms-content")?.text ?? ""),
  };
}

/**
 * 목록 한 줄 + 상세 → NormalizedProduct. 대상 글은 humanCheck 한 항목(80자)으로만 넣는다 —
 * 기계 조건이 없으니 대상 글만으로 「맞음」이 나오지 않는다.
 */
function productOf(item: KiboListItem, detail: KiboDetail): NormalizedProduct {
  const detailUrl = detailUrlOf(item);
  const name = detail.name || item.name; // 상세 머리 제목이 있으면 그것, 없으면(상세 실패 포함) 목록 이름
  const { targetText } = detail;
  const product: NormalizedProduct = {
    source: SOURCE_ID,
    // ★목록 이름에서만 — 상세를 못 받은 회차에도 같은 행을 가리켜야 keepExisting 이 기존 값을 지킨다
    sourceId: idPart(item.name),
    fundingGroup: "guarantee",
    institution: INSTITUTION,
    institutionType: "guarantee",
    name,
    productType: "guarantee",
    targetText,
    targetRules: guaranteeTargetRules(targetText),
    limitText: "",
    limitMaxWon: null,
    rateText: "",
    rateMin: null,
    rateMax: null,
    feeText: "",
    termText: "",
    channel: CHANNEL,
    applyUrl: "", // 신청 주소 원문이 없다 — 지어내지 않는다
    detailUrl,
    deadlineText: "상시",
    raw: { url: detailUrl, fields: { 상품명: name, 목록이름: item.name, 본문: targetText } },
  };
  // 상세를 못 받았거나 본문을 못 읽었다 — 저장소가 기존 행 값을 빈 값으로 덮지 않게(types.ts keepExisting)
  if (!targetText) product.keepExisting = true;
  return product;
}

/**
 * 실제 수집 — 목록 한 번 + 상품마다 상세 한 번. 상세는 **한 번에 하나씩 순서대로** 받는다(동시 요청
 * 금지 — 설계 머리말). 목록이 15건 미만이면 던지고, 상세 한 건 실패는 그 상품만 목록 이름 + keepExisting 으로 낸다.
 */
export async function fetchKiboAll(): Promise<NormalizedProduct[]> {
  const items = parseKiboList(await fetchProductText(FETCH_SOURCE, KIBO_LIST_URL, { method: "GET" }, FETCH_LIMITS));
  if (items.length < MIN_ITEMS) {
    throw new Error(`kibo 보증 상품이 ${items.length}건뿐 — 반쪽 응답(또는 메뉴 모양 변경)으로 보고 저장하지 않는다`);
  }
  const out: NormalizedProduct[] = [];
  for (const item of items) {
    let detail: KiboDetail = { name: "", targetText: "" };
    try {
      detail = parseKiboDetail(
        await fetchProductText(FETCH_SOURCE, detailUrlOf(item), { method: "GET" }, FETCH_LIMITS),
      );
    } catch {
      // 한 건 실패로 회차 전체를 버리지 않는다 — 이 상품만 목록 이름으로(productOf 가 keepExisting 을 붙인다)
    }
    out.push(productOf(item, detail));
  }
  return out;
}

export const kiboSource: ProductSource = {
  id: SOURCE_ID,
  label: "기술보증기금 보증상품",
  url: KIBO_LIST_URL,
  fetchAll: fetchKiboAll,
};
