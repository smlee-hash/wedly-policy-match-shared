/**
 * 경기신용보증재단 특례보증 — 상시 상품 수집기(설계 2026-09-24 §C).
 * 특례보증 쪽 하나(`/gcgf/cm/conts/contsView.do?mi=1051&contsId=1022`)를 받아 상자(`div.menuBox`)마다 첫 이름
 * (`h3.tit1`)과 그 바로 다음 표만 읽는다. 표는 두 열 — 본문 줄마다 `th` 가 칸 이름(지원대상·지원규모·지원한도·
 * 신청방법·대출은행·대출금리/융자금리·대출기간·보증비율·보증료율), 같은 줄 `td` 가 값이다.
 * 2026-09-24 고정본 기준 상자 9개 → 상품 7개.
 *
 * ★menu00(처음 열린 상자)은 여덟 절을 잇달아 담은 「전체」 상자다 — 첫 절만 읽고 나머지는 각자의
 * 상자(menu02~menu10)에서 읽는다. 그래서 menu02 는 menu00 과 같은 상품이다 — 같은 이름은 첫 것만.
 * ★표 없는 상자는 상품이 아니다 — menu05 「경기도 소상공인지원자금」은 다른 쪽(mi=1079)으로 가는 단추뿐.
 * ★menu00 지원대상 칸 안에 부속 표가 있다 — 바깥 표 tbody 의 직계 줄만 읽고, 부속 표 글은 그 칸 글자로만
 * 든다(caption 「…정보를 포함한 표입니다」는 뺀다). 표 뒤 세부 요건 표(태양광기업…)도 읽지 않는다.
 *
 * 대상 글은 기계 조건으로 풀지 않는다 — humanCheck 한 항목으로만 넣어 판정이 「확인 필요」에 머물게 하고
 * 기계 조건은 지역(경기)만 둔다(설계 공통 규칙 3). 값은 원문 그대로 — 못 읽으면 빈 값/null.
 */
import { HTMLElement, parse } from "node-html-parser";
import { extractRate } from "../../../funding/amount-rate-extract";
import { firstLimitWon } from "./guarantee-limit";
import { fetchProductText } from "../fetch";
import type { NormalizedProduct, ProductSource } from "../types";

/** 명부 id·FinanceProduct.source 공통 계약 — 접두어 `product-`(kinfa.ts 와 동일). */
const SOURCE_ID = "product-gcgf";
const BASE_URL = "https://www.gcgf.or.kr";
/** 특례보증 목록 쪽 — 명부 대표 주소이자 detailUrl 의 바탕(뒤에 `#menuNN`, 설계 §C). */
export const GCGF_URL = `${BASE_URL}/gcgf/cm/conts/contsView.do?mi=1051&contsId=1022`;
const INSTITUTION = "경기신용보증재단";
/** 신청방법·대출은행 줄이 둘 다 없는 상품의 창구 — 설계 결정 글을 그대로 쓴다. */
const DEFAULT_CHANNEL = "경기신용보증재단 지점";
/** 고정본 기준 7개 — 5개 미만이면 반쪽 응답이거나 표 모양이 바뀐 것이다(설계 공통 규칙 8). */
const MIN_ITEMS = 5;
/** 대상 글 최대 길이(설계 결정). */
const TARGET_TEXT_CHARS = 600;
/** humanCheck 한 항목 길이(설계 공통 규칙 3). */
const HUMAN_CHECK_CHARS = 80;
const FETCH_SOURCE = { id: SOURCE_ID, baseUrl: BASE_URL };
/** 고정본이 189KB — 넉넉히 잡되 끝은 둔다. */
const FETCH_LIMITS = { timeoutMs: 30_000, maxBytes: 1_000_000 };
/** 칸 글자에서 뺀다 — caption 은 숨은 표 설명(부속 표에 있어도 칸 글자가 아니다), script·style 은 글이 아니다. */
const SKIP_TAGS = new Set(["CAPTION", "SCRIPT", "STYLE"]);
/** 앞뒤 글자에 붙여 읽는 글자 꾸밈 — 그 밖의 요소(<br>·span·p·부속 표 칸…) 경계는 공백 한 칸. */
const INLINE_TAGS = new Set([
  "A", "ABBR", "B", "CODE", "DEL", "EM", "FONT", "I", "INS", "MARK", "S", "SMALL", "STRIKE", "STRONG", "SUB", "SUP", "U",
]);

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

/** 표의 본문 직계 줄만 — table > tr, table > tbody > tr. 머리 줄(「구분·내용」)과 칸 안 부속 표의 줄은 들지 않는다. */
function rowsOf(table: HTMLElement): HTMLElement[] {
  return childElements(table).flatMap((c) => {
    if (c.tagName === "TR") return [c];
    return c.tagName === "TBODY" ? childElements(c).filter((r) => r.tagName === "TR") : [];
  });
}

/** 바깥 표 하나 → 칸 이름(공백 없앰)→값 사전. 줄마다 첫 th 가 칸 이름, 같은 줄 td 가 값이다. */
function fieldsOf(table: HTMLElement): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const row of rowsOf(table)) {
    const cells = childElements(row);
    const labelCell = cells.find((c) => c.tagName === "TH");
    // 칸 이름은 공백을 지워 맞춘다(「지원 한도」 = 「지원한도」)
    const label = labelCell ? cellText(labelCell).replace(/\s+/g, "") : "";
    const valueCells = cells.filter((c) => c.tagName === "TD");
    // 같은 칸 이름이 또 나오면 첫 것만
    if (!label || valueCells.length === 0 || label in fields) continue;
    fields[label] = valueCells.map((c) => cellText(c)).filter(Boolean).join(" ");
  }
  return fields;
}

/**
 * 상자 하나(이름 + 칸 사전) → NormalizedProduct. 대상 글(지원대상)은 humanCheck 한 항목(80자)으로만 넣고
 * 기계 조건은 지역만 — 대상 글만으로 「맞음」이 나오지 않는다(설계 공통 규칙 3).
 */
function productOf(name: string, f: Record<string, string>, detailUrl: string): NormalizedProduct {
  const targetText = (f["지원대상"] ?? "").slice(0, TARGET_TEXT_CHARS);
  const limitText = f["지원한도"] ?? "";
  // 금리 줄 이름이 「융자금리」인 표도 있다(고정본 시군(추천)·시군추천 소상공인 특례보증)
  const rateText = f["대출금리"] || f["융자금리"] || "";
  // 창구 — 신청방법·대출은행 가운데 있는 것만 잇는다(시군 특례보증들은 신청방법 줄이 없다)
  const apply = f["신청방법"] ?? "";
  const banks = f["대출은행"] ?? "";
  const channel = [apply && `신청: ${apply}`, banks && `은행: ${banks}`].filter(Boolean).join(" / ");
  return {
    source: SOURCE_ID,
    sourceId: idPart(name),
    fundingGroup: "guarantee",
    institution: INSTITUTION,
    institutionType: "guarantee",
    name,
    productType: "guarantee",
    targetText,
    targetRules: targetText
      ? { region: ["경기"], humanCheck: [targetText.slice(0, HUMAN_CHECK_CHARS)] }
      : { region: ["경기"] },
    limitText,
    limitMaxWon: firstLimitWon(limitText), // 맨 앞 대표 한도(guarantee-limit.ts)
    rateText,
    rateMin: extractRate(rateText).rateMin,
    rateMax: null,
    feeText: f["보증료율"] ?? "",
    termText: f["대출기간"] ?? "",
    channel: channel || DEFAULT_CHANNEL,
    applyUrl: "", // 신청 주소 원문이 없다 — 지어내지 않는다
    detailUrl,
    deadlineText: "상시",
    raw: { url: detailUrl, fields: { 상품명: name, ...f } },
  };
}

/**
 * 특례보증 쪽 HTML → 상품들, 문서 순서대로. 상자마다 첫 이름과 **그 바로 다음 표**만 읽는다 — 이름 다음에 표
 * 없이 다른 이름이 먼저 오면(표 없는 절 — menu00 안 「소상공인지원자금」 절이 그 모양) 뒤 절의 표를 이 이름에
 * 붙이지 않는다. 같은 이름(sourceId)은 첫 것만. 순수 함수 — 네트워크 없이 고정본만으로 시험한다.
 */
export function parseGcgf(html: string): NormalizedProduct[] {
  const out: NormalizedProduct[] = [];
  for (const box of parse(html).querySelectorAll("div.menuBox")) {
    // 이름·표를 문서 순서로 — 바깥 표가 그 칸 안 부속 표보다 먼저 나온다
    const [title, table] = box.querySelectorAll("h3.tit1, table");
    // 표 없는 상자(menu05 단추뿐)·이름 없는 상자는 상품이 아니다
    if (title?.tagName !== "H3" || table?.tagName !== "TABLE") continue;
    const id = box.getAttribute("id");
    const product = productOf(normalize(title.text), fieldsOf(table), id ? `${GCGF_URL}#${id}` : GCGF_URL);
    if (!product.sourceId || out.some((p) => p.sourceId === product.sourceId)) continue;
    out.push(product);
  }
  return out;
}

/**
 * 실제 수집 — 특례보증 쪽 하나를 GET. 5건 미만이면 던진다(반쪽 응답으로 상품을 빠뜨린 채 저장하지 않게).
 */
export async function fetchGcgfAll(): Promise<NormalizedProduct[]> {
  const html = await fetchProductText(FETCH_SOURCE, GCGF_URL, { method: "GET" }, FETCH_LIMITS);
  const out = parseGcgf(html);
  if (out.length < MIN_ITEMS) {
    throw new Error(`경기신보 보증 상품이 ${out.length}건뿐 — 반쪽 응답(또는 표 모양 변경)으로 보고 저장하지 않는다`);
  }
  return out;
}

export const gcgfSource: ProductSource = {
  id: SOURCE_ID,
  label: "경기신용보증재단 보증 상품",
  url: GCGF_URL,
  fetchAll: fetchGcgfAll,
};
