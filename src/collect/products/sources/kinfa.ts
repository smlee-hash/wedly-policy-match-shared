/**
 * 서민금융진흥원(KINFA) 정책서민금융상품 — 상시 상품 수집기(설계 2026-09-03, 계획서 Task 8).
 * `POST .../loanProductGlanceSearch.do` 가 목록 화면과 똑같은 JSON 배열을 그대로 내려준다
 * (2026-09-03 10:20 실측, 실제 배포는 325건 — 고정본 `__fixtures__/kinfa-sample.json` 은 그중 12건 표본).
 *
 * ★325건 대부분은 근로자·주거·서민 생활자금(전세자금보증·불법사금융예방대출 등)이라 사업자 대상이
 * 아니다 — `trgt`(대상 글)에 「사업자·소상공인·자영업·창업·기업」 중 하나가 있어야만 남긴다(hint 실측).
 *
 * ★값은 raw API 그대로 옮긴다(지어내지 않는다). `inrt`(금리) 는 "9% 이내" 처럼 단위가 붙은 것도
 * 있고 "4.5" 처럼 숫자만 온 것도 있다(2026-09-03 10:20 실측 고정본) — 후자에 우리가 "%" 를 붙이면
 * 원문에 없는 확신을 만드는 것이라 rateText 는 항상 원문 그대로, rateMin 도 `extractRate` 가
 * 「연 N%」류를 실제로 읽어낼 때만 채운다(못 읽으면 null — 화면은 원문 글자만 보여준다).
 *
 * ★`fincPrdSno`(원천 고유번호)가 있는 행은 그것으로 sourceId 를 삼고, 없으면(고정본 12건 전부 없음)
 * `상품명|취급기관` 을 공백·괄호를 지워 정규화한 값을 쓴다(sbiz.ts 의 sourceIdOf 와 같은 방식).
 *
 * ★원문에 `&#40;`·`&#41;` 같은 숫자 문자참조가 섞여 있다(예: "신청 대상&#40;수급자&#41;인").
 * 손으로 표를 만드는 대신 이미 의존하는 `node-html-parser` 가 실제 HTML 텍스트 노드를 읽을 때
 * 하는 엔티티 풀이를 그대로 빌린다(빈 태그로 감싸 파싱 후 `.text` 만 취함) — 새 라이브러리를
 * 늘리지 않는다.
 */
import { parse } from "node-html-parser";
import { extractRate } from "../../../funding/amount-rate-extract";
import { classifyFundingGroup, type FundingGroup } from "../../../funding/funding-group";
import { fetchProductText } from "../fetch";
import type { NormalizedProduct, ProductSource, ProductTargetRules } from "../types";

/** 명부 id·FinanceProduct.source 공통 계약 — 접두어 `product-`(2026-09-03 자금 조달 지도 공통 계약, sbiz.ts 와 동일). */
const SOURCE_ID = "product-kinfa";
export const KINFA_LIST_URL = "https://www.kinfa.or.kr/financialProduct/loanProductGlanceSearch.do";
export const KINFA_DETAIL_URL = "https://www.kinfa.or.kr/financialProduct/loanProductGlance.do";
const INSTITUTION = "서민금융진흥원";
/** 표본 12건 중 진짜 응답(325건)이 이 아래로 잘려 오면 반쪽 응답 — parseKinfa 이전, 원본 배열 길이로 잰다. */
const MIN_RAW_ITEMS = 100;

/** trgt(대상 글)에 이 낱말 중 하나가 있어야 사업자 대상으로 본다(hint 실측 — 12건 중 7건만 남는다). */
const BUSINESS_TARGET_RE = /사업자|소상공인|자영업|창업|기업/;
/** 이름에 있으면 무조건 urgent — 서민금융진흥원 상품 대부분이 여기 걸린다. */
const URGENT_NAME_RE = /미소금융|햇살론|취약|재기/;
const GUARANTEE_NAME_RE = /보증/;
/** 값 없음을 뜻하는 원문 표기 — 그대로 두면 화면에 "-" 가 값처럼 보인다. */
const EMPTY_VALUES = new Set(["", "-", "없음"]);

/**
 * spprtTrgtDetlCnd 의 「신용평점 하위 20%」류는 절대 점수(예: NCB 839)가 아니라 백분위라 기계
 * 조건화가 안 된다 — 그렇다고 버리지 않고, 그 원문을 targetRules.humanCheck 한 항목(80자 자르기)에
 * 담아 사람이 확인하게 한다(F3, 2026-09-03 코덱스 리뷰: 상품의 비구조 필수조건이 통째로 사라지고
 * 있었다). detail(spprtTrgtDetlCnd 정규화값)이 없으면 targetRules 는 그대로 빈 값이다.
 */
function targetRulesOf(detail: string): ProductTargetRules {
  return detail ? { humanCheck: [detail.slice(0, 80)] } : {};
}

interface KinfaRawItem {
  fincPrdSno?: string | number | null;
  fincPrdNm?: string | null;
  lonLmt?: string | number | null;
  inrt?: string | null;
  totLonPrid?: string | number | null;
  trgt?: string | null;
  ofrInsttNm?: string | null;
  insttDs?: string | null;
  prpos?: string | null;
  spprtTrgtDetlCnd?: string | null;
}

/** node-html-parser 의 문자참조 풀이를 빌린다 — 엔티티 낌새가 없으면 파싱 자체를 건너뛴다(빠른 경로). */
function decodeEntities(v: string): string {
  if (!v || !/&(#\d+|#x[0-9a-f]+|[a-z]+);/i.test(v)) return v;
  return parse(`<i>${v}</i>`).text;
}

/** 엔티티 풀기 + 줄바꿈/탭/중복 공백 한 칸으로 + 앞뒤 공백 제거 + "-"·"없음" 은 빈 값으로. */
function normalize(v: unknown): string {
  const s = decodeEntities(String(v ?? "")).replace(/\s+/g, " ").trim();
  return EMPTY_VALUES.has(s) ? "" : s;
}

/** sourceId 조각 정규화 — 공백·괄호 제거(sbiz.ts sourceIdOf 와 같은 규칙). */
function idPart(v: string): string {
  return v.replace(/\s+/g, "").replace(/[()（）]/g, "");
}

/** 이름만으로 6갈래를 정한다: 좁은 서민금융 낱말 → urgent, 보증 → guarantee, 그 밖은 공용 규칙(못 붙이면 urgent — 서금원은 전부 서민금융). */
function fundingGroupOf(name: string): FundingGroup {
  if (URGENT_NAME_RE.test(name)) return "urgent";
  if (GUARANTEE_NAME_RE.test(name)) return "guarantee";
  return classifyFundingGroup({ title: name }) ?? "urgent";
}

/** lonLmt 는 이미 "만원" 단위 숫자 글(억·천 같은 한글 단위가 없다) — 억/천 표기가 섞인 본문용 wonOf 를 쓰지 않는다. */
function limitOf(lonLmt: unknown): { limitText: string; limitMaxWon: number | null } {
  const raw = normalize(lonLmt);
  if (!raw) return { limitText: "", limitMaxWon: null };
  const n = Number(raw.replace(/,/g, ""));
  if (!Number.isFinite(n)) return { limitText: raw, limitMaxWon: null }; // 지어내지 않는다 — 못 읽으면 원문만
  return { limitText: `${n.toLocaleString()}만원`, limitMaxWon: Math.round(n * 10_000) };
}

/** totLonPrid 가 순수 숫자(정수·소수)면 "N년", 그 밖(서술형·빈 값)은 원문 그대로 두거나 빈 값. */
function termOf(totLonPrid: unknown): string {
  const raw = normalize(totLonPrid);
  if (!raw) return "";
  return Number.isFinite(Number(raw)) ? `${raw}년` : raw;
}

/**
 * 12건(실제 325건) 중 `trgt` 에 사업자 관련 낱말이 있는 것만 `NormalizedProduct` 로 바꾼다.
 * 순수 함수 — 네트워크 없이 고정본만으로 시험한다.
 */
export function parseKinfa(items: unknown[]): NormalizedProduct[] {
  const out: NormalizedProduct[] = [];
  for (const item of items as KinfaRawItem[]) {
    const trgt = normalize(item.trgt);
    if (!BUSINESS_TARGET_RE.test(trgt)) continue; // 근로자·주거·서민생활 전용은 뺀다(hint)

    const name = normalize(item.fincPrdNm);
    if (!name) continue; // 이름 없는 행은 상품으로 만들지 않는다

    const ofrInsttNm = normalize(item.ofrInsttNm) || INSTITUTION;
    const detail = normalize(item.spprtTrgtDetlCnd);
    const { limitText, limitMaxWon } = limitOf(item.lonLmt);
    const rateText = normalize(item.inrt);
    const rateMin = rateText ? extractRate(rateText).rateMin : null;
    const sno = item.fincPrdSno != null ? String(item.fincPrdSno).trim() : "";

    out.push({
      source: SOURCE_ID,
      sourceId: sno || `${idPart(name)}|${idPart(ofrInsttNm)}`,
      fundingGroup: fundingGroupOf(name),
      institution: INSTITUTION,
      institutionType: "microfinance",
      name,
      productType: "credit",
      targetText: detail || trgt,
      targetRules: targetRulesOf(detail),
      limitText,
      limitMaxWon,
      rateText,
      rateMin,
      rateMax: null,
      feeText: "",
      termText: termOf(item.totLonPrid),
      channel: ofrInsttNm,
      applyUrl: "",
      detailUrl: KINFA_DETAIL_URL,
      deadlineText: "상시",
      raw: {
        fincPrdSno: item.fincPrdSno ?? null,
        fincPrdNm: item.fincPrdNm ?? null,
        lonLmt: item.lonLmt ?? null,
        inrt: item.inrt ?? null,
        totLonPrid: item.totLonPrid ?? null,
        trgt: item.trgt ?? null,
        ofrInsttNm: item.ofrInsttNm ?? null,
        insttDs: item.insttDs ?? null,
        prpos: item.prpos ?? null,
        spprtTrgtDetlCnd: item.spprtTrgtDetlCnd ?? null,
      },
    });
  }
  return out;
}

/** 실제 수집 — 400건 요청해 325건 받는 목록 API 그대로. 응답이 100건 미만이면 반쪽 응답으로 던진다. */
export async function fetchKinfaAll(): Promise<NormalizedProduct[]> {
  const text = await fetchProductText(
    { id: SOURCE_ID, baseUrl: "https://www.kinfa.or.kr" },
    KINFA_LIST_URL,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ currentPageNo: 1, recordCountPerPage: 400 }) },
    { timeoutMs: 60_000, maxBytes: 12_000_000 },
  );
  const parsed: unknown = JSON.parse(text);
  const items = Array.isArray(parsed) ? parsed : [];
  if (items.length < MIN_RAW_ITEMS) {
    throw new Error(`kinfa 상품이 ${items.length}건뿐 — 반쪽 응답으로 보고 저장하지 않는다`);
  }
  return parseKinfa(items);
}

export const kinfaSource: ProductSource = {
  id: SOURCE_ID,
  label: "서민금융진흥원 정책서민금융상품",
  url: KINFA_DETAIL_URL,
  fetchAll: fetchKinfaAll,
};
