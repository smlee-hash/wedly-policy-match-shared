/**
 * 소진공(소상공인시장진흥공단) 정책자금 대출조건 — 상시 상품 수집기(설계 2026-09-03, 계획서 Task 9).
 * 페이지가 정적 HTML 표 2개(직접대출·대리대출)를 그대로 내려준다 — 로그인·쿠키·페이지네이션 없음
 * (2026-09-03 10:13 실측 고정본 `__fixtures__/sbiz-loan-conditions.html`, 13행).
 *
 * ★「대출한도」·「대출금리」 칸은 자유 문장이 아니라 이미 숫자만 담긴 표 칸이다. 공용 규칙
 * extractAmount/extractRate 는 본문 속에 섞인 숫자를 찾으려고 "최대·한도·연·금리" 같은 낱말이
 * 숫자 바로 앞에 있어야만 잡는데, 이 표 칸엔 그 낱말이 아예 없다(실측 — 13행 전부 "최대"류가 없다).
 * 그래서 두 값 모두 ①먼저 공용 규칙을 그대로 불러 보고 ②그게 못 잡으면(이 표에서는 매번) 표 칸
 * 전용의 좁은 규칙으로 보충한다 — 공용 규칙 자체는 손대지 않는다(다른 원천의 문장형 본문에 영향 없게).
 * 금리 칸("기준금리+0.4%P")은 분기별로 바뀌는 기준금리 위에 얹는 가산폭이라 절대 금리를 이 표만으로는
 * 알 수 없다 — rateMin 은 null 로 정직하게 비우고, 사람이 읽을 rateText 는 원문을 그대로 보여준다.
 */
import { parse } from "node-html-parser";
import { extractAmount, extractRate, wonOf } from "../../../funding/amount-rate-extract";
import { fetchProductText } from "../fetch";
import type { NormalizedProduct, ProductSource, ProductTargetRules } from "../types";

/** 명부 id·FinanceProduct.source 공통 계약 — 접두어 `product-`(2026-09-03 자금 조달 지도 공통 계약). */
const SOURCE_ID = "product-sbiz";
export const SBIZ_DETAIL_URL = "https://ols.semas.or.kr/ols/man/SMAN018M/page.do";
const INSTITUTION = "소상공인시장진흥공단";

const TABLE_CONFIG: ReadonlyArray<{ productType: "direct-loan" | "agency-loan"; channel: string }> = [
  { productType: "direct-loan", channel: "소진공 정책자금 누리집(ols.semas.or.kr)" },
  { productType: "agency-loan", channel: "소진공 확인서 → 취급 은행" },
];

/** 좁은 낱말만 urgent — 나머지는 전부 policy(설계 §3-2 6갈래 중 소진공은 이 두 갈래만 쓴다). */
const URGENT_NAME_RE = /긴급|재도전|취약/;

/** 소진공 정책자금 대출조건은 소상공인 전용 창구 — 13건 모두 같다(개별 조건은 targetText 로만 안내). */
const TARGET_RULES: ProductTargetRules = { scale: ["소상공인"] };

/** 표 칸 안에서만 쓰는 "숫자+단위" 훑기 — AMOUNT_RE 의 숫자 부분과 같되 앞 낱말 조건이 없다. */
const AMOUNT_TOKEN_RE = /[\d,.]+\s*(?:억|천만|백만|만|천)(?:\s*[\d,.]+\s*(?:천만|백만|만|천))?\s*원?/g;

function normalizeCell(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** sourceId = 자금명 정규화(공백·괄호 제거) — 「긴급경영안정자금 (재해피해)」→「긴급경영안정자금재해피해」. */
function sourceIdOf(name: string): string {
  return name.replace(/\s+/g, "").replace(/[()（）]/g, "");
}

/**
 * 여러 한도가 나열돼도("운전 1억원,시설 5억원") 합치지 않고 가장 큰 값만 상한으로 둔다
 * (extractAmount 와 같은 규칙). limitText 는 항상 원문 전체 — 어느 조건에 어느 금액인지 사람이 봐야 한다.
 */
function limitFromCell(raw: string): { limitText: string; limitMaxWon: number | null } {
  const viaCommon = extractAmount(raw);
  if (viaCommon.amountMaxWon !== null) return { limitText: raw, limitMaxWon: viaCommon.amountMaxWon };
  let max: number | null = null;
  for (const m of raw.matchAll(AMOUNT_TOKEN_RE)) {
    const won = wonOf(m[0]);
    if (won !== null && (max === null || won > max)) max = won;
  }
  return { limitText: raw, limitMaxWon: max };
}

/** "기준금리+0.4%P"·"고정금리(2.0%P)" 는 절대 금리가 아니다 — 원문을 그대로 두고 rateMin 은 비운다. */
function rateFromCell(raw: string): { rateText: string; rateMin: number | null } {
  const viaCommon = extractRate(raw);
  if (viaCommon.rateText) return viaCommon;
  return { rateText: raw, rateMin: null };
}

/** 표 2개(직접대출·대리대출)를 한 모양으로 합친다. td 5개가 안 되는 행(공지·colspan)은 건너뛴다. */
export function parseSbiz(html: string): NormalizedProduct[] {
  const root = parse(html);
  const tables = root.querySelectorAll("table");
  const out: NormalizedProduct[] = [];

  TABLE_CONFIG.forEach((cfg, tableIndex) => {
    const table = tables[tableIndex];
    if (!table) return; // 사이트 개편으로 표가 하나뿐이면 그 표만큼만 — 지어내지 않는다
    const rows = table.querySelectorAll("tbody tr");
    for (const row of rows) {
      const cells = row.querySelectorAll("td");
      if (cells.length < 5) continue; // 안내문 등 colspan 행 방어
      const name = normalizeCell(cells[0].text);
      if (!name) continue;
      const targetText = normalizeCell(cells[1].text);
      const termText = normalizeCell(cells[2].text);
      const limitRaw = normalizeCell(cells[3].text);
      const rateRaw = normalizeCell(cells[4].text);

      const { limitText, limitMaxWon } = limitFromCell(limitRaw);
      const { rateText, rateMin } = rateFromCell(rateRaw);

      const product: NormalizedProduct = {
        source: SOURCE_ID,
        sourceId: sourceIdOf(name),
        fundingGroup: URGENT_NAME_RE.test(name) ? "urgent" : "policy",
        institution: INSTITUTION,
        institutionType: "policy",
        name,
        productType: cfg.productType,
        targetText,
        targetRules: TARGET_RULES,
        limitText,
        limitMaxWon,
        rateText,
        rateMin,
        rateMax: null,
        feeText: "",
        termText,
        channel: cfg.channel,
        applyUrl: "",
        detailUrl: SBIZ_DETAIL_URL,
        deadlineText: "상시",
        raw: { 자금명: name, 신청요건: targetText, 대출기간: termText, 대출한도: limitRaw, 대출금리: rateRaw },
      };
      out.push(product);
    }
  });

  return out;
}

/** 정적 페이지 하나를 받아 13건을 만든다. 8건 미만이면 반쪽 응답으로 보고 던진다(빈 껍데기 방어). */
export async function fetchSbizAll(): Promise<NormalizedProduct[]> {
  const html = await fetchProductText({ id: SOURCE_ID, baseUrl: "https://ols.semas.or.kr" }, SBIZ_DETAIL_URL);
  const list = parseSbiz(html);
  if (list.length < 8) {
    throw new Error(`sbiz 대출조건이 ${list.length}건뿐 — 반쪽 응답으로 보고 저장하지 않는다`);
  }
  return list;
}

export const sbizSource: ProductSource = {
  id: SOURCE_ID,
  label: "소상공인시장진흥공단 정책자금 대출조건",
  url: SBIZ_DETAIL_URL,
  fetchAll: fetchSbizAll,
};
