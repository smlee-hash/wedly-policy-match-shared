/**
 * 중진공(중소벤처기업진흥공단) 정책자금 융자조건 — 상시 상품 수집기(설계 2026-09-03, 계획서 Task 12).
 * 세부사업 탭 8곳(`/nsh/SH/SBI/SHSBI{004,006,007,008,009,010,011,012}M0.do`)이 각각 정적 HTML 로
 * 융자조건을 내려준다 — 로그인·쿠키·페이지네이션 없음(2026-09-03 10:21 실측 고정본
 * `__fixtures__/kosmes-SHSBI004M0.html`·`kosmes-SHSBI012M0.html`).
 *
 * ★실측 구조는 계획서 힌트("p.title-blue-20 이 자금명")와 다르다 — **실제 파일이 정본**이다.
 * `p.title-blue-20` 은 그 앞쪽 "신청대상" 절의 큰 분류 제목(예: "창업기반지원")일 뿐이고, 자금 하나하나의
 * 이름과 조건은 그 뒤 "융자조건" 절의 `dl.box-con > dt`(자금명) + `dd ul.bulit-text > li`
 * (융자방식·대출한도·대출기간·대출금리·기타) 에 있다 — 분류 제목과 자금명이 1:1 이 아니라서
 * (예: "창업기반지원" 하나 아래 "창업기반지원자금(일반)"·"(청년전용창업자금)" 두 자금이 있다),
 * `dl.box-con` 을 기준으로 자금을 나눈다. 같은 페이지의 "단축키 목록" 모달과 "비교시점" 표도
 * `dl.box-con` 을 쓰지만 융자조건 낱말이 하나도 없어 아래 필터가 자연히 걸러낸다(실측 — 4개 중 진짜
 * 자금 2~3개, 나머지는 이 둘).
 */
import { parse } from "node-html-parser";
import { extractAmount, extractRate, wonOf } from "../../amount-rate-extract";
import { fetchProductText } from "../fetch";
import type { FundingGroup } from "../../funding-group";
import type { NormalizedProduct, ProductSource, ProductTargetRules } from "../types";

/** 명부 id·FinanceProduct.source 공통 계약 — 접두어 `product-`. 게시판 수집기 id `kosmes` 와 겹치면
 * 안 된다(계획서 리뷰 1번 지적 — 회차 재개 skip·명부 중복·현황판 덮어씀). */
const SOURCE_ID = "product-kosmes";
const BASE_URL = "https://www.kosmes.or.kr";
const INSTITUTION = "중소벤처기업진흥공단";

/** 실측 8곳(004·006~012, 005 오류 셸·001·002·003·013·014·016·019·029 조건 없음은 부르지 않는다). */
const TAB_IDS = ["SHSBI004M0", "SHSBI006M0", "SHSBI007M0", "SHSBI008M0", "SHSBI009M0", "SHSBI010M0", "SHSBI011M0", "SHSBI012M0"];

function tabUrl(tabId: string): string {
  return `${BASE_URL}/nsh/SH/SBI/${tabId}.do`;
}

/**
 * 중진공 정책자금은 이 두 갈래만 쓴다(설계 §3-2 6갈래 중 — sbiz.ts 와 같은 판단: 좁은 낱말만 urgent).
 * 낱말은 funding-group.ts 의 urgent 낱말 목록과 맞춘다 — "재창업자금"(SHSBI008M0, 실사이트 실측)이
 * 빠지면 policy 로 잘못 떨어진다.
 */
const URGENT_NAME_RE = /긴급|재해|재난|폐업|재도전|재기|재창업|취약/;

function fundingGroupOf(name: string): FundingGroup {
  return URGENT_NAME_RE.test(name) ? "urgent" : "policy";
}

/** 중진공 정책자금은 전부 중소기업 창구다(개별 세부 자격은 targetText 로만 안내). */
const TARGET_RULES: ProductTargetRules = { scale: ["중소기업"] };

type FieldKey = "method" | "limit" | "term" | "rate" | "target" | "etc";

const FIELD_PATTERNS: ReadonlyArray<{ key: FieldKey; re: RegExp }> = [
  { key: "limit", re: /^대출한도\s*:\s*/ },
  { key: "term", re: /^대출기간\s*:\s*/ },
  { key: "rate", re: /^대출금리\s*:\s*/ },
  { key: "method", re: /^융자방식\s*:\s*/ },
  { key: "target", re: /^(?:융자대상|지원대상)\s*:\s*/ }, // 두 고정본엔 없지만 다른 탭에 있을 수 있어 남겨둔다
  { key: "etc", re: /^기타\s*:\s*/ },
];

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** sourceId 정규화 — sbiz.ts 와 같은 규칙(공백·괄호 제거). */
function sourceIdOf(name: string): string {
  return name.replace(/\s+/g, "").replace(/[()（）]/g, "");
}

function productTypeOf(method: string): NormalizedProduct["productType"] {
  if (method.startsWith("직접대출")) return "direct-loan";
  if (method.startsWith("대리대출")) return "agency-loan";
  return ""; // 원천이 안 알려 주면 지어내지 않는다
}

/**
 * 자유 문장이라 공용 규칙(extractAmount)이 대부분 잡지만, "기업당 최대 1억원 이내 (제조업 및
 * 중점지원분야 영위기업은 2억원 이내)" 처럼 두 번째 금액 앞에 "최대·한도·기업당" 같은 트리거 낱말이
 * 없으면 공용 규칙은 그 금액을 놓친다(2026-09-03 실측). extractAmount 자체의 "가장 큰 값을 상한으로
 * 둔다"는 취지를 살리려고, 트리거 낱말 없이도 문장 전체에서 금액을 다시 훑어 더 큰 값이 있으면 그 값으로
 * 보정한다 — limitText 는 항상 원문 전체(sbiz.ts 와 같은 원칙, 사람이 어느 조건에 어느 금액인지 봐야 한다).
 */
const AMOUNT_TOKEN_RE = /[\d,.]+\s*(?:억|천만|백만|만|천)(?:\s*[\d,.]+\s*(?:천만|백만|만|천))?\s*원?/g;

function limitFrom(raw: string): { limitText: string; limitMaxWon: number | null } {
  if (!raw) return { limitText: "", limitMaxWon: null };
  let max = extractAmount(raw).amountMaxWon;
  for (const m of raw.matchAll(AMOUNT_TOKEN_RE)) {
    const won = wonOf(m[0]);
    if (won !== null && (max === null || won > max)) max = won;
  }
  return { limitText: raw, limitMaxWon: max };
}

/**
 * "2.5% (고정금리)"·"1.9%(고정)" 류는 절대금리인데, 공용 규칙(extractRate)은 "연"·"금리" 가 숫자
 * 바로 앞에 와야만 잡아서 이 표현("금리"가 숫자 뒤에 옴)을 놓친다(2026-09-03 실측). "정책자금
 * 기준금리(변동) + 0.5%p" 류(기준금리 대비 가산·차감폭, %p 표기)는 절대금리가 아니므로 "고정" 낱말이
 * 같이 있을 때만 숫자를 뽑는다 — 값을 지어내지 않는다.
 */
const FIXED_RATE_RE = /([\d.]+)\s*%\s*\(?\s*고정/;

function rateFrom(raw: string): { rateText: string; rateMin: number | null } {
  if (!raw) return { rateText: "", rateMin: null };
  const viaCommon = extractRate(raw);
  if (viaCommon.rateText) return viaCommon;
  const fixed = raw.match(FIXED_RATE_RE);
  return { rateText: raw, rateMin: fixed ? Number(fixed[1]) : null };
}

const CHANNEL_RE = /융자상담처<\/h3>\s*<p>([^<]+)<\/p>/;

/** "융자상담처" 절 바로 다음 문단을 그대로 쓴다(두 고정본 모두 같은 문장 — 실측). 못 찾으면 정직한 기본값. */
function channelOf(html: string): string {
  const m = html.match(CHANNEL_RE);
  return m ? m[1].trim() : "중진공 지역본(지)부";
}

/**
 * 탭 하나(html)를 자금 여러 건으로 나눈다. `dl.box-con` 마다 `dt`=자금명, `dd ul.bulit-text > li`=필드.
 * 대출한도·대출기간·대출금리 셋 다 없으면(단축키 목록·비교시점 표) 자금이 아니라고 보고 버린다.
 */
export function parseKosmes(html: string, tabId: string): NormalizedProduct[] {
  const root = parse(html);
  const detailUrl = tabUrl(tabId);
  const channel = channelOf(html);
  const out: NormalizedProduct[] = [];

  for (const dl of root.querySelectorAll("dl.box-con")) {
    const dtEl = dl.querySelector("dt");
    const name = dtEl ? normalizeText(dtEl.text) : "";
    if (!name) continue;

    const fields: Partial<Record<FieldKey, string>> = {};
    for (const li of dl.querySelectorAll("dd ul.bulit-text > li")) {
      const text = normalizeText(li.text);
      const hit = FIELD_PATTERNS.find(({ re }) => re.test(text));
      if (hit) fields[hit.key] = text.replace(hit.re, "").trim();
    }
    if (!fields.limit && !fields.term && !fields.rate) continue; // 융자조건 셋 다 없으면 자금 아님

    const { limitText, limitMaxWon } = limitFrom(fields.limit ?? "");
    const { rateText, rateMin } = rateFrom(fields.rate ?? "");

    const product: NormalizedProduct = {
      source: SOURCE_ID,
      sourceId: `${tabId}|${sourceIdOf(name)}`,
      fundingGroup: fundingGroupOf(name),
      institution: INSTITUTION,
      institutionType: "policy",
      name,
      productType: productTypeOf(fields.method ?? ""),
      targetText: fields.target ?? fields.etc ?? "",
      targetRules: TARGET_RULES,
      limitText,
      limitMaxWon,
      rateText,
      rateMin,
      rateMax: null,
      feeText: "",
      termText: fields.term ?? "",
      channel,
      applyUrl: "",
      detailUrl,
      deadlineText: "상시",
      raw: {
        탭: tabId,
        자금명: name,
        융자방식: fields.method ?? "",
        대출한도: fields.limit ?? "",
        대출기간: fields.term ?? "",
        대출금리: fields.rate ?? "",
        기타: fields.etc ?? "",
      },
    };
    out.push(product);
  }

  return out;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 탭 8곳을 순서대로 돈다(건 사이 300ms). ★탭 하나라도 실패하면 나머지가 전부 성공해도 던진다
 * (코덱스 지적 2026-09-03) — 부분 성공만 저장하면 저장 단계(upsertProducts)가 "이번엔 안 보였다"고
 * 판단해 실패한 탭에 있던 기존 상품을 비활성화한다. 실패해도 나머지 탭은 끝까지 돌려(300ms 페이싱은
 * 그대로) 어느 탭들이 왜 실패했는지 메시지 하나에 전부 담는다.
 */
export async function fetchKosmesAll(): Promise<NormalizedProduct[]> {
  const out: NormalizedProduct[] = [];
  const failures: Array<{ tabId: string; reason: string }> = [];

  for (let i = 0; i < TAB_IDS.length; i++) {
    const tabId = TAB_IDS[i];
    try {
      const html = await fetchProductText({ id: SOURCE_ID, baseUrl: BASE_URL }, tabUrl(tabId));
      out.push(...parseKosmes(html, tabId));
    } catch (err) {
      failures.push({ tabId, reason: err instanceof Error ? err.message : String(err) });
    }
    if (i < TAB_IDS.length - 1) await sleep(300);
  }

  if (failures.length > 0) {
    const detail = failures.map((f) => `${f.tabId}(${f.reason})`).join(", ");
    throw new Error(
      `kosmes 세부사업 탭 ${failures.length}/${TAB_IDS.length}곳 실패 — ${detail} — 부분 성공을 저장하면 실패한 탭의 기존 상품이 「이번에 안 보임」으로 비활성화된다`,
    );
  }
  if (out.length === 0) {
    throw new Error("kosmes 탭에서 자금을 한 건도 못 읽었다 — 선택자가 바뀌었을 수 있어 저장하지 않는다");
  }
  return out;
}

export const kosmesSource: ProductSource = {
  id: SOURCE_ID,
  label: "중소벤처기업진흥공단 정책자금 융자조건",
  url: tabUrl(TAB_IDS[0]),
  fetchAll: fetchKosmesAll,
};
