/**
 * 서울신용보증재단 보증 상품 — 상시 상품 수집기(설계 2026-09-24 §B).
 * 보증 상품 탭 6개(`/wbase/contents.do?mng_cd=BUSI…`)를 순서대로 받아 **PC 표**(`div.info_table_box.for_web`
 * 안의 표)만 읽는다. 머리 줄 첫 칸 「구분」 뒤가 상품 이름(열), 본문 줄마다 첫 칸이 칸 이름(대상기업·보증조건·
 * 보증한도·보증기간·보증비율·보증료·보증상대처·대출금리)이고 나머지 칸이 열별 값이다(`colspan` 칸은 걸친 열
 * 모두에 같은 값). 2026-09-24 13:00 KST 고정본 기준 9개.
 *
 * ★모바일 블록(`div.toggle_wrap.for_mob`)은 읽지 않는다 — PC 표와 금액이 다른 옛 글이 남아 있다(고정본
 * BUSI5337 창업자금 특별보증: PC 「5천만원」, 모바일 「3천만 원」).
 * ★BUSI2346 첫 표는 대상기업 칸 안에 부속 표(`table.target-comp-table`)가 또 있다 — 바깥 표의 직계 줄만 읽는다.
 * 부속 표 머리를 상품 열로, 그 줄을 칸으로 읽으면 안 되고, 부속 표 글은 그 칸 글자로만 든다.
 *
 * 대상 글은 기계 조건으로 풀지 않는다 — humanCheck 한 항목으로만 넣어 판정이 「확인 필요」에 머물게 하고
 * 기계 조건은 지역(서울)만 둔다(설계 공통 규칙 3). 값은 원문 그대로 — 못 읽으면 빈 값/null.
 */
import { HTMLElement, parse } from "node-html-parser";
import { extractRate } from "../../../funding/amount-rate-extract";
import { firstLimitWon } from "./guarantee-limit";
import { guaranteeTargetRules } from "./guarantee-target";
import { fetchProductText } from "../fetch";
import type { NormalizedProduct, ProductSource } from "../types";

/** 명부 id·FinanceProduct.source 공통 계약 — 접두어 `product-`(kinfa.ts 와 동일). */
const SOURCE_ID = "product-seoulshinbo";
const BASE_URL = "https://www.seoulshinbo.co.kr";
/** 보증 상품 탭 — 이 순서대로 하나씩 받는다(설계 §B). */
export const SEOULSHINBO_TABS = ["BUSI2346", "BUSI4617", "BUSI4763", "BUSI5337", "BUSI5388", "BUSI5389"] as const;
const INSTITUTION = "서울신용보증재단";
/** 보증상대처 칸이 없는 상품의 창구 — 설계 결정 글을 그대로 쓴다. */
const DEFAULT_CHANNEL = "서울신용보증재단 지점·모바일 앱";
/** 고정본 기준 9개 — 6개 미만이면 반쪽 응답이거나 표 모양이 바뀐 것이다(설계 공통 규칙 8). */
const MIN_ITEMS = 6;
const FETCH_SOURCE = { id: SOURCE_ID, baseUrl: BASE_URL };
/** 탭 공통 — 고정본이 탭마다 70KB 안팎이라 넉넉히 잡되 끝은 둔다. */
const FETCH_LIMITS = { timeoutMs: 30_000, maxBytes: 1_000_000 };
/** 이 묶음 아래 직계 tr 까지만 표의 줄이다(table > tr 도 줄). */
const ROW_GROUPS = new Set(["THEAD", "TBODY", "TFOOT"]);
/** 칸 글자에서 뺀다 — caption 은 숨은 표 설명(부속 표에 있어도 칸 글자가 아니다), script·style 은 글이 아니다. */
const SKIP_TAGS = new Set(["CAPTION", "SCRIPT", "STYLE"]);
/** 앞뒤 글자에 붙여 읽는 글자 꾸밈 — 그 밖의 요소(<br>·span·p·부속 표 칸…) 경계는 공백 한 칸. */
const INLINE_TAGS = new Set([
  "A", "ABBR", "B", "CODE", "DEL", "EM", "FONT", "I", "INS", "MARK", "S", "SMALL", "STRIKE", "STRONG", "SUB", "SUP", "U",
]);

/** 탭 주소 — 그 탭 상품들의 detailUrl 로도 쓴다(설계 §B). */
export function seoulshinboTabUrl(tab: string): string {
  return `${BASE_URL}/wbase/contents.do?mng_cd=${tab}`;
}

/** 명부 대표 주소 — 첫 탭. */
export const SEOULSHINBO_URL = seoulshinboTabUrl(SEOULSHINBO_TABS[0]);

/** 표 한 열 = 상품 하나 — 이름과 칸 이름(공백 없앰)→값 사전. */
interface Column {
  name: string;
  fields: Record<string, string>;
}

/** 줄바꿈/탭/중복 공백 한 칸으로 + 앞뒤 공백 제거. */
function normalize(v: string): string {
  return v.replace(/\s+/g, " ").trim();
}

/** sourceId 조각 정규화 — 공백·괄호 제거(kinfa.ts idPart 와 같은 규칙). */
function idPart(v: string): string {
  return v.replace(/\s+/g, "").replace(/[()（）]/g, "");
}

function childElements(el: HTMLElement): HTMLElement[] {
  return el.childNodes.filter((n): n is HTMLElement => n instanceof HTMLElement);
}

/** el 의 조상 가운데(stop 과 그 위는 보지 않는다) test 를 만족하는 것이 있는가. */
function hasAncestor(el: HTMLElement, test: (a: HTMLElement) => boolean, stop: HTMLElement | null = null): boolean {
  for (let p = el.parentNode; p && p !== stop; p = p.parentNode) {
    if (test(p)) return true;
  }
  return false;
}

/** 칸 글자 — 글자 꾸밈(strong·a…)은 붙여 읽고 그 밖의 요소 경계(<br>·span·부속 표 칸…)는 공백 한 칸, caption 은 뺀다. */
function cellText(cell: HTMLElement): string {
  const parts: string[] = [];
  const walk = (el: HTMLElement): void => {
    for (const child of el.childNodes) {
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
  walk(cell);
  return normalize(parts.join(""));
}

/** 표의 직계 줄만 — table > tr, table > thead|tbody|tfoot > tr. 칸 안 부속 표의 줄은 들지 않는다. */
function rowsOf(table: HTMLElement): HTMLElement[] {
  return childElements(table).flatMap((c) => {
    if (c.tagName === "TR") return [c];
    return ROW_GROUPS.has(c.tagName) ? childElements(c).filter((r) => r.tagName === "TR") : [];
  });
}

/** 줄의 직계 칸(td·th). */
function cellsOf(row: HTMLElement): HTMLElement[] {
  return childElements(row).filter((c) => c.tagName === "TD" || c.tagName === "TH");
}

/**
 * 바깥 표 하나 → 상품 열들. 머리 줄 첫 칸(「구분」) 뒤 th 가 상품 이름이고, 본문 줄마다 첫 칸이 칸 이름,
 * 나머지 칸을 colspan 만큼 열에 나눠 준다. 머리 줄이 th 로만 되어 있지 않으면 상품 표가 아니다 — 빈 목록.
 */
function columnsOf(table: HTMLElement): Column[] {
  const [head, ...body] = rowsOf(table);
  const heads = head ? cellsOf(head) : [];
  if (heads.length < 2 || heads.some((c) => c.tagName !== "TH")) return [];
  const columns: Column[] = heads.slice(1).map((c) => ({ name: cellText(c), fields: {} }));
  for (const row of body) {
    const [labelCell, ...valueCells] = cellsOf(row);
    // 칸 이름은 공백을 지워 맞춘다(「보증 한도」 = 「보증한도」)
    const label = labelCell ? cellText(labelCell).replace(/\s+/g, "") : "";
    if (!label || valueCells.length === 0) continue;
    // colspan 칸은 걸친 열 모두에 같은 값 — 대상기업 칸이 흔히 colspan="2"
    const values = valueCells.flatMap((cell) => {
      const span = Number.parseInt(cell.getAttribute("colspan") ?? "", 10) || 1;
      return Array<string>(Math.min(Math.max(span, 1), columns.length)).fill(cellText(cell));
    });
    columns.forEach((col, i) => {
      // 같은 칸 이름이 또 나오면 첫 것만
      if (!(label in col.fields)) col.fields[label] = values[i] ?? "";
    });
  }
  return columns.filter((c) => c.name);
}

/**
 * 상품 열 하나 → NormalizedProduct. 대상 글(대상기업 + 보증조건)은 humanCheck 한 항목(80자)으로만 넣고
 * 기계 조건은 지역만 — 대상 글만으로 「맞음」이 나오지 않는다(설계 공통 규칙 3).
 */
function productOf(col: Column, detailUrl: string): NormalizedProduct {
  const f = col.fields;
  const condition = f["보증조건"] ?? "";
  const targetText = [f["대상기업"] ?? "", condition && `보증조건: ${condition}`].filter(Boolean).join(" / ");
  // 한도 줄 이름이 「보증금액」인 표도 있다(고정본 BUSI2346 첫 표)
  const limitText = f["보증한도"] || f["보증금액"] || "";
  const rateText = f["대출금리"] ?? "";
  return {
    source: SOURCE_ID,
    sourceId: idPart(col.name),
    fundingGroup: "guarantee",
    institution: INSTITUTION,
    institutionType: "guarantee",
    name: col.name,
    productType: "guarantee",
    targetText,
    targetRules: guaranteeTargetRules(targetText, ["서울"]),
    limitText,
    limitMaxWon: firstLimitWon(limitText), // 맨 앞 대표 한도(guarantee-limit.ts)
    rateText,
    rateMin: extractRate(rateText).rateMin,
    rateMax: null,
    feeText: f["보증료"] ?? "",
    termText: f["보증기간"] ?? "",
    channel: f["보증상대처"] || DEFAULT_CHANNEL,
    applyUrl: "", // 신청 주소 원문이 없다 — 지어내지 않는다
    detailUrl,
    deadlineText: "상시",
    raw: { url: detailUrl, fields: { 상품명: col.name, ...f } },
    // 대상 글을 못 읽었다(표 본문 누락 등) — 저장소가 기존 행 값을 빈 값으로 덮지 않게(types.ts keepExisting)
    ...(targetText ? {} : { keepExisting: true as const }),
  };
}

/**
 * 탭 HTML → 상품들, 문서 순서대로. PC 상자(`div.info_table_box.for_web`) 안의 바깥 표만 읽고 칸 안 부속 표와
 * 모바일 블록은 건너뛴다. 같은 이름(sourceId)은 첫 것만. 순수 함수 — 네트워크 없이 고정본만으로 시험한다.
 */
export function parseSeoulshinbo(html: string, tab: string): NormalizedProduct[] {
  const detailUrl = seoulshinboTabUrl(tab);
  const out: NormalizedProduct[] = [];
  for (const box of parse(html).querySelectorAll("div.info_table_box.for_web")) {
    for (const table of box.querySelectorAll("table")) {
      // 칸 안 부속 표(BUSI2346 target-comp-table)는 상품 표가 아니다 — 그 글은 바깥 칸 글자로 이미 들어갔다
      if (hasAncestor(table, (a) => a.tagName === "TABLE", box)) continue;
      // 모바일 블록의 옛 금액 — 해석이 틀어져 PC 상자 아래로 딸려 와도 읽지 않는다
      if (hasAncestor(table, (a) => a.classList.contains("for_mob"))) continue;
      for (const col of columnsOf(table)) {
        const product = productOf(col, detailUrl);
        if (!product.sourceId || out.some((p) => p.sourceId === product.sourceId)) continue;
        out.push(product);
      }
    }
  }
  return out;
}

/**
 * 실제 수집 — 탭 6개를 **한 번에 하나씩 순서대로** GET. 한 탭이라도 못 받거나 상품을 하나도 못 읽으면
 * 던진다(그 탭 상품을 빠뜨린 채 저장하지 않게). 탭끼리 같은 이름은 앞 탭 것만, 합쳐 6건 미만이면 던진다.
 */
export async function fetchSeoulshinboAll(): Promise<NormalizedProduct[]> {
  const out: NormalizedProduct[] = [];
  for (const tab of SEOULSHINBO_TABS) {
    const html = await fetchProductText(FETCH_SOURCE, seoulshinboTabUrl(tab), { method: "GET" }, FETCH_LIMITS);
    const rows = parseSeoulshinbo(html, tab);
    if (rows.length === 0) {
      throw new Error(`서울신보 ${tab} 탭에서 상품을 하나도 못 읽었다 — 반쪽 응답(또는 표 모양 변경)으로 보고 저장하지 않는다`);
    }
    for (const p of rows) {
      if (!out.some((q) => q.sourceId === p.sourceId)) out.push(p);
    }
  }
  if (out.length < MIN_ITEMS) {
    throw new Error(`서울신보 보증 상품이 ${out.length}건뿐 — 반쪽 응답(또는 표 모양 변경)으로 보고 저장하지 않는다`);
  }
  return out;
}

export const seoulshinboSource: ProductSource = {
  id: SOURCE_ID,
  label: "서울신용보증재단 보증 상품",
  url: SEOULSHINBO_URL,
  fetchAll: fetchSeoulshinboAll,
};
