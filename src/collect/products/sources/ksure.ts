/**
 * 한국무역보험공사(K-SURE) 수출신용보증 — 상시 상품 수집기(설계 2026-09-24 §A).
 * 첫 화면(`/rh-kr/index.do`) 「사업안내」 메뉴에서 **「신용보증」 묶음의 하위 링크만** 상품으로 삼는다
 * (2026-09-24 13:00 KST 고정본 기준 5개). 같은 메뉴의 단기성·중장기성·환변동·수입보험은 수출 손실을
 * 메우는 보험이지 돈을 구하는 상품이 아니라 뺀다(자금 조달 지도 대상 아님 — 설계 결정).
 *
 * ★「>신용보증<」 글자는 첫 화면에 4번 나오고 같은 링크가 두 번 나오기도 한다(고정본 실측) — 글자가
 * 정확히 「신용보증」인 a 의 **형제** `ul.depth3` 링크만 읽고 경로로 중복을 지운다. 부모 아래를
 * 통째로 뒤지면 이웃 보험 묶음이 딸려 올 수 있다.
 *
 * ★상세는 `dir.do` 를 GET(302 를 따라 제도개요 `web.do`) 해 본문 `div.ctn` 글자에서 끝 안내문
 * (`notice_box`, 「본 안내는 무역보험 …」) 앞까지를 대상 글로 삼는다. 대상 글은 기계 조건으로 풀지
 * 않는다 — humanCheck 한 항목으로만 넣어 판정이 「확인 필요」에 머물게 한다(설계 공통 규칙 3, 지역 조건 없음).
 * 한도·금리 원문은 없어 빈 값/null 로 둔다(지어내지 않는다).
 */
import { HTMLElement, parse } from "node-html-parser";
import { fetchProductText } from "../fetch";
import type { NormalizedProduct, ProductSource } from "../types";

/** 명부 id·FinanceProduct.source 공통 계약 — 접두어 `product-`(kinfa.ts 와 동일). */
const SOURCE_ID = "product-ksure";
const BASE_URL = "https://www.ksure.or.kr";
export const KSURE_INDEX_URL = `${BASE_URL}/rh-kr/index.do`;
const INSTITUTION = "한국무역보험공사";
/** 원천에 신청 창구 칸이 없어 설계 결정 글을 그대로 쓴다. */
const CHANNEL = "K-SURE 영업점·K-SURE ON";
/** 사업안내 메뉴에서 이 글자인 a 의 형제 ul.depth3 만 상품 묶음이다. */
const GROUP_LABEL = "신용보증";
/** 고정본 기준 신용보증 하위 5개 — 이보다 적으면 반쪽 응답이거나 메뉴 모양이 바뀐 것이다. */
const MIN_ITEMS = 5;
/** 대상 글 최대 길이(설계 §A). */
const MAX_TARGET_CHARS = 600;
const FETCH_SOURCE = { id: SOURCE_ID, baseUrl: BASE_URL };
/** 첫 화면·상세 공통 — 고정본이 162KB·98KB 라 넉넉히 잡되 끝은 둔다. */
const FETCH_LIMITS = { timeoutMs: 30_000, maxBytes: 2_000_000 };

/** 목록 메뉴의 상품 하나 — 이름과 사이트 안 경로(`/rh-kr/cntnts/i-NNN/dir.do`). */
export interface KsureListItem {
  name: string;
  path: string;
}

/** 줄바꿈/탭/중복 공백 한 칸으로 + 앞뒤 공백 제거. */
function normalize(v: string): string {
  return v.replace(/\s+/g, " ").trim();
}

/** sourceId 조각 정규화 — 공백·괄호 제거(kinfa.ts idPart 와 같은 규칙). */
function idPart(v: string): string {
  return v.replace(/\s+/g, "").replace(/[()（）]/g, "");
}

/** 상세 주소 = 기관 주소 + 메뉴 경로(설계 §A). */
function detailUrlOf(item: KsureListItem): string {
  return `${BASE_URL}${item.path}`;
}

/**
 * 첫 화면 HTML → 「신용보증」 묶음의 하위 상품(이름·경로), 문서 순서대로.
 * 순수 함수 — 네트워크 없이 고정본만으로 시험한다.
 */
export function parseKsureList(html: string): KsureListItem[] {
  const out: KsureListItem[] = [];
  for (const link of parse(html).querySelectorAll("a")) {
    if (normalize(link.text) !== GROUP_LABEL) continue;
    // 부모 아래를 통째로 뒤지지 않고 a 의 형제 ul.depth3 만 — 이웃 보험 묶음이 딸려 오지 않게
    const groups = (link.parentNode?.childNodes ?? []).filter(
      (n): n is HTMLElement => n instanceof HTMLElement && n.tagName === "UL" && n.classList.contains("depth3"),
    );
    for (const a of groups.flatMap((ul) => ul.querySelectorAll("a"))) {
      const name = normalize(a.text);
      const path = (a.getAttribute("href") ?? "").trim();
      // 사이트 안 경로만 — 상세 주소를 기관 주소 + 경로로 만들므로 바깥 주소·빈 링크는 버린다
      if (!name || !path.startsWith("/") || path.startsWith("//")) continue;
      // 같은 메뉴가 두 번 나온다(고정본 실측) — 경로나 이름(sourceId)이 겹치면 첫 것만
      if (out.some((p) => p.path === path || idPart(p.name) === idPart(name))) continue;
      out.push({ name, path });
    }
  }
  return out;
}

/** el 아래 글자를 문서 순서로 out 에 모으다 stop 을 만나면 true — 끝 안내문과 그 뒤는 대상 글이 아니다. */
function collectUntil(el: HTMLElement, stop: HTMLElement | null, out: string[]): boolean {
  for (const child of el.childNodes) {
    if (child === stop) return true;
    if (!(child instanceof HTMLElement)) out.push(child.text);
    else if (collectUntil(child, stop, out)) return true;
  }
  return false;
}

/**
 * 상세(제도개요) HTML → 대상 글: `div.ctn` 글자를 `notice_box` 앞까지 모아 공백 한 칸으로 줄이고,
 * 머리 제목 「제도개요」를 한 번 떼어 최대 600자. 본문을 못 찾으면 빈 값(지어내지 않는다).
 */
export function parseKsureDetail(html: string): string {
  // ★원문 글자에서 본문 구간을 먼저 잘라 그 조각만 해석한다 — 닫히지 않은 <span> 이 있는 쪽(i-175 매입·i-180
  // 포괄매입, 2026-09-24 실측)은 문서 전체를 해석하면 트리가 틀어져 div.ctn 을 아예 못 찾는다.
  const start = html.search(/<div\s+class="ctn"\s*>/);
  if (start >= 0) {
    const rest = html.slice(start);
    const end = rest.search(/<div\s+class="notice_box"/);
    const parts: string[] = [];
    collectUntil(parse(end >= 0 ? rest.slice(0, end) : rest), null, parts);
    const text = normalize(parts.join("")).replace(/^제도개요\s*/, "").slice(0, MAX_TARGET_CHARS).trim();
    if (text) return text;
  }
  const ctn = parse(html).querySelector("div.ctn");
  if (!ctn) return "";
  const parts: string[] = [];
  collectUntil(ctn, ctn.querySelector(".notice_box"), parts);
  return normalize(parts.join("")).replace(/^제도개요\s*/, "").slice(0, MAX_TARGET_CHARS).trim();
}

/**
 * 목록 한 줄 + 상세 대상 글 → NormalizedProduct. 대상 글은 humanCheck 한 항목(80자)으로만 넣는다 —
 * 기계 조건이 없으니 대상 글만으로 「맞음」이 나오지 않는다.
 */
function productOf(item: KsureListItem, targetText: string): NormalizedProduct {
  const detailUrl = detailUrlOf(item);
  const product: NormalizedProduct = {
    source: SOURCE_ID,
    sourceId: idPart(item.name),
    fundingGroup: "guarantee",
    institution: INSTITUTION,
    institutionType: "guarantee",
    name: item.name,
    productType: "guarantee",
    targetText,
    targetRules: targetText ? { humanCheck: [targetText.slice(0, 80)] } : {},
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
    raw: { url: detailUrl, fields: { 상품명: item.name, 제도개요: targetText } },
  };
  // 상세를 못 받았거나 본문을 못 읽었다 — 저장소가 기존 행 값을 빈 값으로 덮지 않게(types.ts keepExisting)
  if (!targetText) product.keepExisting = true;
  return product;
}

/**
 * 실제 수집 — 첫 화면 한 번 + 상품마다 상세 한 번. 상세는 **한 번에 하나씩 순서대로** 받는다(동시
 * 요청 금지 — 설계 §A). 목록이 5건 미만이면 던지고, 상세 한 건 실패는 그 상품만 keepExisting 으로 낸다.
 */
export async function fetchKsureAll(): Promise<NormalizedProduct[]> {
  const items = parseKsureList(await fetchProductText(FETCH_SOURCE, KSURE_INDEX_URL, { method: "GET" }, FETCH_LIMITS));
  if (items.length < MIN_ITEMS) {
    throw new Error(`ksure 신용보증 상품이 ${items.length}건뿐 — 반쪽 응답(또는 메뉴 모양 변경)으로 보고 저장하지 않는다`);
  }
  const out: NormalizedProduct[] = [];
  for (const item of items) {
    let targetText = "";
    try {
      targetText = parseKsureDetail(
        await fetchProductText(FETCH_SOURCE, detailUrlOf(item), { method: "GET" }, FETCH_LIMITS),
      );
    } catch {
      // 한 건 실패로 회차 전체를 버리지 않는다 — 이 상품만 목록 값으로(productOf 가 keepExisting 을 붙인다)
    }
    out.push(productOf(item, targetText));
  }
  return out;
}

export const ksureSource: ProductSource = {
  id: SOURCE_ID,
  label: "한국무역보험공사 수출신용보증",
  url: KSURE_INDEX_URL,
  fetchAll: fetchKsureAll,
};
