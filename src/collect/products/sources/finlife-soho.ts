/**
 * 금감원 「금융상품 한눈에」 개인사업자대출 — 상시 상품 수집기(설계 2026-09-03, 계획서 Task 10).
 * 은행·저축은행·캐피탈이 내놓는 개인사업자 대출 876건을 모은다(2026-09-03 10:20 실측).
 *
 * 세 단계 통신이 필요하다(오픈API 키는 본인인증·사업자등록증 첨부가 필요해 쓰지 않는다 — 이 통로로 충분):
 *  ① `GET list.do?menuNo=700072` 로 세션 쿠키(WMONID)만 받는다.
 *  ② 같은 쿠키+Referer 로 `POST list.do` 폼(FORM, 아래) → 목록 HTML(`tr.onOffTr` 876행).
 *  ③ 행마다 `POST selectOneIndvlBusi.ujson` → `resultZvl`(한도·금리·신용등급 구간 금리 등 상세).
 * ①②는 `fetchProductWithCookies`/`fetchProductText`(게시판 엔진 재사용, fetch.ts 주석 참조)로 검문·
 * 쿠키 항아리를 공짜로 받는다. ③은 876번을 순서대로 부르면 느리므로 **동시 4개·건 사이 150ms**로
 * 스로틀한다(876건 × 약 0.3초 / 4 ≈ 70초). 상세 한 건이 실패해도 그 행만 목록 값으로 정직하게
 * 대체할 뿐 전체를 죽이지 않는다 — 은행 서버 쪽 순간 오류로 876건이 통째로 날아가면 안 된다.
 *
 * ★FORM 의 `areaType`(시도 지역코드) — 계획서 표(2026-09-03 10:20 실측)의 원문이 "01,…,17" 로
 *   줄여 적혀 있어(원 세션 로그에 전체 문자열이 남아있지 않다), 여기서는 전 지역을 뜻하는 01~17
 *   연속값으로 채웠다 — 나머지 파라미터(joinDeny=1..8, loanLimit=1..6 등)가 전부 "모든 값을 켠
 *   상태"인 것과 같은 패턴이다. 실사이트 실측(라이브 체크)으로 876행이 그대로 나오는지 확인한다.
 */
import { parse } from "node-html-parser";
import { classifyFundingGroup } from "../../../funding/funding-group";
import { extractAmount, wonOf } from "../../../funding/amount-rate-extract";
import { fetchProductText, fetchProductWithCookies } from "../fetch";
import type {
  InstitutionType,
  NormalizedProduct,
  ProductSource,
  ProductTargetRules,
  ProductType,
} from "../types";

/** 명부 id·FinanceProduct.source 공통 계약 — 접두어 `product-`(2026-09-03 자금 조달 지도 공통 계약). */
const SOURCE_ID = "product-finlife-soho";
export const LIST_URL = "https://finlife.fss.or.kr/finlife/ldng/indvlBusi/list.do?menuNo=700072";
export const DETAIL_URL = "https://finlife.fss.or.kr/finlife/ldng/indvlBusi/selectOneIndvlBusi.ujson";
const CFG = { id: SOURCE_ID, baseUrl: "https://finlife.fss.or.kr" };
const LIST_LIMITS = { timeoutMs: 60_000, maxBytes: 4_000_000 }; // 목록 응답 실측 2.2MB

/**
 * 상세 조회 실패 비율이 이 값(20%)을 넘으면 반쪽 응답으로 보고 던진다(코덱스 지적 2026-09-03) —
 * 그 아래는 실패한 건만 목록 값으로 정직하게 채워 저장한다(mergeFinlifeDetail 의 null 경로).
 * 은행 한 곳의 순간 오류(행 하나)까지 죽이면 과민 반응이지만, 상세 API 가 통째로 막히면
 * (전실패 포함) 기존 한도·금리가 빈 값으로 덮여쓰기당한다 — 그 경계를 20%로 긋는다.
 */
const MAX_DETAIL_FAIL_RATIO = 0.2;

/** 시도 지역코드 01~17(전국) — 위 파일 주석 참조. */
const AREA_TYPE_ALL = Array.from({ length: 17 }, (_, i) => String(i + 1).padStart(2, "0")).join(",");

/** 계획서 Task 10 이 못박은 폼 그대로(areaType 만 전국 값으로 채움) — 개인사업자대출 전체를 필터 없이 요청. */
const FORM =
  "pageType=ajax&menuNo=700072&pageIndex=1&pageSize=1000&pageUnit=1000&useWay=1,2,3,4,5,9&finPrdtType=1" +
  "&joinDeny=1,2,3,4,5,6,7,8&loanLimit=1,2,3,4,5,6&loanType=1,2,3&lendRateType=1,2&rpayType=1,2,3,4" +
  `&areaType=${AREA_TYPE_ALL}&topFinGrpNo=020000,030200,030300,050000&joinWay=1,2,3,4,5,9&menuId=2000152` +
  "&BLTN_ID=BB000000000000000134";

/** 목록 한 행(순수 파싱 결과) — 상세 조회가 실패해도 상품을 만들 수 있을 만큼만 담는다. */
export interface FinlifeListRow {
  finPrdtNm: string;
  finCoNo: string;
  dclsMonth: string;
  finPrdtCd: string;
  institution: string;
  prdtUrl: string;
  useWay: string;
  joinDeny: string;
  loanType: string;
  rateType: string;
  repay: string;
  /** 목록의 「평균금리」 칸 원문(예 "0.04%") — 상세 조회 실패 때 정직한 대체값의 재료. */
  avgRateText: string;
  hompUrl: string;
  tel: string;
}

/** `selectOneIndvlBusi.ujson` 의 `resultZvl` — 계획서가 지정한 필드만 타입으로 박고 나머지는 열어 둔다. */
export interface FinlifeDetailResult {
  loanLimitDetl?: string;
  loanLimitNm?: string;
  lendRateMin?: string;
  lendRateMax?: string;
  lendRateAvg?: string;
  val1Grad1?: string | null;
  val1Grad2?: string | null;
  val1Grad3?: string | null;
  joinDenyDetl?: string;
  joinWayNm?: string;
  loanTerm?: string;
  prdtUrl?: string;
  hompUrl?: string;
  calTel?: string;
  cbName?: string;
  rpayTypeNm?: string;
  loanTypeNm?: string;
  lendRateTypeNm?: string;
  [key: string]: unknown;
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * 상세 JSON 필드는 공백이 `&nbsp;` 로, 줄바꿈이 `<br>` 로 들어온다("최대&nbsp;1억원",
 * "…합계액 이내 <br> ※ …" — 2026-09-03 실사이트 실측 20건에서 확인) — 사람이 읽을 글로 되돌린다.
 */
function cleanNbsp(text: string | undefined): string {
  if (!text) return "";
  return normalizeText(text.replace(/&nbsp;/g, " ").replace(/<br\s*\/?>/gi, " "));
}

function telFromContact(text: string): string {
  const labeled = text.match(/([0-9-]{4,})\s*\(대표번호\)/);
  if (labeled) return labeled[1];
  const generic = text.match(/(\d{2,4}-\d{3,4}-\d{4}|\d{7,8})/);
  return generic ? generic[1] : "";
}

/**
 * 목록 페이지(POST 응답 HTML)에서 `tr.onOffTr` 876행을 읽는다(실측 기준 개수 — 순수 함수라
 * 개수 검증은 하지 않는다, 임계값 판단은 fetchFinlifeSohoAll 몫).
 * 열 순서(체크박스 제외): 금융회사·상품명(상세 링크)·자금용도·가입대상·대출종류·금리방식·
 * 상환방식·평균금리·연락처(홈페이지+대표번호) — 계획서 Task 10 실측 그대로.
 */
export function parseFinlifeList(html: string): FinlifeListRow[] {
  const root = parse(html);
  const trs = root.querySelectorAll("tr.onOffTr");
  const out: FinlifeListRow[] = [];

  for (const tr of trs) {
    const finPrdtNm = tr.getAttribute("data-finPrdtNm") ?? "";
    const finCoNo = tr.getAttribute("data-finCoNo") ?? "";
    const dclsMonth = tr.getAttribute("data-dclsMonth") ?? "";
    const finPrdtCd = tr.getAttribute("data-finPrdtCd") ?? "";
    if (!finPrdtNm || !finCoNo || !finPrdtCd) continue; // 식별자 없는 행은 상품을 못 만든다

    const tds = tr.querySelectorAll("td");
    if (tds.length < 10) continue; // 열 구조가 바뀐 반쪽 행 방어(체크박스+9열)

    const contactTd = tds[9];
    const contactText = normalizeText(contactTd.text);

    out.push({
      finPrdtNm,
      finCoNo,
      dclsMonth,
      finPrdtCd,
      institution: normalizeText(tds[1].text),
      prdtUrl: tds[2].querySelector("a")?.getAttribute("href") ?? "",
      useWay: normalizeText(tds[3].text),
      joinDeny: normalizeText(tds[4].text),
      loanType: normalizeText(tds[5].text),
      rateType: normalizeText(tds[6].text),
      repay: normalizeText(tds[7].text),
      avgRateText: normalizeText(tds[8].text),
      hompUrl: contactTd.querySelector("a")?.getAttribute("href") ?? "",
      tel: telFromContact(contactText),
    });
  }
  return out;
}

/** 저축은행/캐피탈·커머셜/인터넷은행 은 이름으로 구분하고, 그 밖은 전부 은행(계획서 Task 10 지정). */
function institutionTypeOf(institution: string): InstitutionType {
  if (/저축은행/.test(institution)) return "savings-bank";
  if (/캐피탈|커머셜/.test(institution)) return "capital";
  if (/케이뱅크|카카오뱅크|토스뱅크/.test(institution)) return "internet-bank";
  return "bank";
}

/**
 * 이름의 「마이너스통장」이 가장 먼저(overdraft), 그다음 대출종류 글 안에서 신용대출 > 담보 > 보증
 * 순으로 본다(계획서 Task 10 나열 순서) — "담보대출, 보증대출, 신용대출" 처럼 여러 종류가 섞인
 * 상품은 신용대출 표기가 있으면 credit 으로, 없이 담보+보증만 섞였으면 담보(secured)를 앞세운다.
 * 아무 키워드도 없으면 빈 값 — 원천이 안 알려 준 것을 지어내지 않는다.
 */
function productTypeOf(finPrdtNm: string, loanTypeText: string): ProductType {
  if (/마이너스통장/.test(finPrdtNm)) return "overdraft";
  if (/신용대출/.test(loanTypeText)) return "credit";
  if (/담보/.test(loanTypeText)) return "secured";
  if (/보증/.test(loanTypeText)) return "guarantee-backed";
  return "";
}

/** 상세 응답의 한도(loanLimitDetl) → limitText·limitMaxWon. 공용 규칙을 먼저 쓰고 못 잡으면 보충한다(sbiz.ts 와 같은 방식). */
function limitFromDetail(loanLimitDetl: string): { limitText: string; limitMaxWon: number | null } {
  if (!loanLimitDetl) return { limitText: "", limitMaxWon: null };
  const viaCommon = extractAmount(loanLimitDetl);
  if (viaCommon.amountMaxWon !== null) return { limitText: loanLimitDetl, limitMaxWon: viaCommon.amountMaxWon };
  return { limitText: loanLimitDetl, limitMaxWon: wonOf(loanLimitDetl) };
}

/** 상세 응답의 lendRateMin/Max → "연 N%~M%"(같으면 "연 N%") · rateMin/rateMax. */
function rateFromDetail(
  min: string | undefined,
  max: string | undefined,
): { rateText: string; rateMin: number | null; rateMax: number | null } {
  const minN = min !== undefined && min !== "" && Number.isFinite(Number(min)) ? Number(min) : null;
  const maxN = max !== undefined && max !== "" && Number.isFinite(Number(max)) ? Number(max) : null;
  if (minN === null && maxN === null) return { rateText: "", rateMin: null, rateMax: null };
  if (minN !== null && maxN !== null && minN !== maxN) {
    return { rateText: `연 ${min}%~${max}%`, rateMin: minN, rateMax: maxN };
  }
  const only = minN ?? maxN;
  const onlyText = (min && minN === only ? min : max) ?? String(only);
  return { rateText: `연 ${onlyText}%`, rateMin: only, rateMax: only };
}

/**
 * 목록 행 + 상세(없으면 null)를 합쳐 `NormalizedProduct` 를 만든다(순수 함수).
 * 상세가 없을 때는 "목록 값만으로" 정직하게 채운다 — `limitText` 는 비우고 `rateText` 는
 * 목록 평균금리로 "평균 N%"(대출금리 범위를 안다고 지어내지 않는다).
 */
export function mergeFinlifeDetail(row: FinlifeListRow, detail: FinlifeDetailResult | null): NormalizedProduct {
  const institutionType = institutionTypeOf(row.institution);
  const productType = productTypeOf(row.finPrdtNm, row.loanType);
  // BANK_TYPES(bank|internet-bank|savings-bank|capital) 는 institutionType 만으로 무조건 bank —
  // funding-group.ts 의 규칙을 그대로 빌려 쓴다(직접 하드코딩하면 두 곳이 따로 논다).
  const fundingGroup = classifyFundingGroup({ title: row.finPrdtNm, institutionType }) ?? "bank";
  const targetRules: ProductTargetRules = { isCorporation: false }; // 개인사업자대출 전용 화면 — 전 건 공통

  if (!detail) {
    return {
      source: SOURCE_ID,
      sourceId: `${row.finCoNo}|${row.finPrdtCd}`,
      fundingGroup,
      institution: row.institution,
      institutionType,
      name: row.finPrdtNm,
      productType,
      targetText: row.joinDeny,
      targetRules,
      limitText: "",
      limitMaxWon: null,
      rateText: row.avgRateText ? `평균 ${row.avgRateText}` : "",
      rateMin: null,
      rateMax: null,
      feeText: "",
      termText: "",
      channel: "",
      applyUrl: row.prdtUrl,
      detailUrl: LIST_URL,
      deadlineText: "상시",
      raw: { ...row, detailFetchFailed: true },
      // 값이 목록만으로 채워진 반쪽이다 — 저장소가 기존 한도·금리를 이 빈 값으로 덮지 않게 한다
      // (설계 2026-09-03 §3 개정, 코덱스 지적).
      keepExisting: true,
    };
  }

  const { limitText, limitMaxWon } = limitFromDetail(cleanNbsp(detail.loanLimitDetl));
  const { rateText, rateMin, rateMax } = rateFromDetail(detail.lendRateMin, detail.lendRateMax);

  return {
    source: SOURCE_ID,
    sourceId: `${row.finCoNo}|${row.finPrdtCd}`,
    fundingGroup,
    institution: row.institution,
    institutionType,
    name: row.finPrdtNm,
    productType,
    targetText: cleanNbsp(detail.joinDenyDetl) || row.joinDeny,
    targetRules,
    limitText,
    limitMaxWon,
    rateText,
    rateMin,
    rateMax,
    feeText: "",
    termText: cleanNbsp(detail.loanTerm),
    channel: detail.joinWayNm ?? "",
    applyUrl: detail.prdtUrl || row.prdtUrl,
    detailUrl: LIST_URL,
    deadlineText: "상시",
    raw: {
      finPrdtNm: row.finPrdtNm,
      finCoNo: row.finCoNo,
      finPrdtCd: row.finPrdtCd,
      loanLimitNm: detail.loanLimitNm ?? "",
      val1Grad1: detail.val1Grad1 ?? null,
      val1Grad2: detail.val1Grad2 ?? null,
      val1Grad3: detail.val1Grad3 ?? null,
      cbName: detail.cbName ?? "",
    },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * ① GET 으로 쿠키 → ② 같은 쿠키+Referer 로 목록 POST(FORM) → `tr.onOffTr` 파싱.
 * 임계값(500건) 판단은 하지 않는다 — 이 함수는 "있는 그대로" 돌려주고, 반쪽 응답 방어는
 * 호출자(`fetchFinlifeSohoAll`)와 라이브 체크 스크립트가 각자의 목적에 맞게 판단한다.
 */
export async function fetchFinlifeListRows(): Promise<{ rows: FinlifeListRow[]; cookie: string }> {
  const { cookie } = await fetchProductWithCookies(CFG, LIST_URL, undefined, LIST_LIMITS);
  const html = await fetchProductText(
    CFG,
    LIST_URL,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: cookie, Referer: LIST_URL },
      body: FORM,
    },
    LIST_LIMITS,
  );
  return { rows: parseFinlifeList(html), cookie };
}

/**
 * 행 하나의 상세(`selectOneIndvlBusi.ujson`). 네트워크 오류·깨진 JSON·`resultZvl` 없음 —
 * 무엇이든 실패하면 **던지지 않고 null** 을 돌려준다: 은행 한 곳의 순간 오류로 876건 수집
 * 전체가 죽으면 안 된다(mergeFinlifeDetail 이 null 을 "목록 값만" 경로로 정직하게 처리한다).
 */
export async function fetchFinlifeDetail(row: FinlifeListRow, cookie: string): Promise<FinlifeDetailResult | null> {
  try {
    const body = `dclsMonth=${row.dclsMonth}&finCoNo=${row.finCoNo}&finPrdtCd=${row.finPrdtCd}&finPrdtType=1`;
    const text = await fetchProductText(CFG, DETAIL_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: cookie, Referer: LIST_URL },
      body,
    });
    const parsed = JSON.parse(text) as { resultZvl?: FinlifeDetailResult };
    return parsed.resultZvl ?? null;
  } catch (err) {
    console.warn(`[finlife-soho] 상세 조회 실패 (${row.finPrdtNm} ${row.finCoNo}|${row.finPrdtCd}):`, err);
    return null;
  }
}

/** 동시 `concurrency`개 워커가 각자 순서대로 처리하되, 한 워커 안에서는 요청 사이 `staggerMs` 를 쉰다. */
async function fetchDetailsWithConcurrency(
  rows: FinlifeListRow[],
  cookie: string,
  concurrency: number,
  staggerMs: number,
): Promise<(FinlifeDetailResult | null)[]> {
  const results: (FinlifeDetailResult | null)[] = new Array(rows.length).fill(null);
  let next = 0;
  async function worker() {
    for (;;) {
      const i = next;
      next += 1;
      if (i >= rows.length) return;
      results[i] = await fetchFinlifeDetail(rows[i], cookie);
      if (staggerMs > 0 && next < rows.length) await sleep(staggerMs);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, () => worker()));
  return results;
}

/**
 * 전체 수집: 목록(≥500건 기대) → 동시 4·건 사이 150ms 로 상세 병합.
 * `overrides` 는 **시험 전용**이다 — 실제 수집(등록은 Task 14 registry.ts 몫)은 인자 없이 불러
 * 기본값(500건 임계값·동시 4·150ms)을 그대로 쓴다. 500건 미만이면 반쪽 응답으로 보고 던진다.
 * ★상세 조회 실패율이 20%를 넘어도 마찬가지로 던진다(코덱스 지적) — 그 아래는 실패 건만
 * 목록 값으로 채운 채(mergeFinlifeDetail 의 null 경로) 나머지와 함께 정직하게 돌려준다.
 */
export async function fetchFinlifeSohoAll(overrides?: {
  minRows?: number;
  concurrency?: number;
  staggerMs?: number;
}): Promise<NormalizedProduct[]> {
  const minRows = overrides?.minRows ?? 500;
  const concurrency = overrides?.concurrency ?? 4;
  const staggerMs = overrides?.staggerMs ?? 150;

  const { rows, cookie } = await fetchFinlifeListRows();
  if (rows.length < minRows) {
    throw new Error(`finlife-soho 목록이 ${rows.length}행뿐(기대 ${minRows}행 이상) — 반쪽 응답으로 보고 저장하지 않는다`);
  }

  const details = await fetchDetailsWithConcurrency(rows, cookie, concurrency, staggerMs);
  const failedCount = details.filter((d) => d === null).length;
  const failRatio = rows.length > 0 ? failedCount / rows.length : 0;
  if (failRatio > MAX_DETAIL_FAIL_RATIO) {
    const pct = Math.round(failRatio * 1000) / 10; // 소수 첫째자리까지
    throw new Error(
      `finlife-soho 상세 조회 ${failedCount}/${rows.length}건(${pct}%) 실패 — 20%를 넘어 반쪽 응답으로 보고 저장하지 않는다` +
        "(그대로 저장하면 실패 건의 기존 한도·금리가 빈 값으로 덮인다)",
    );
  }

  return rows.map((row, i) => mergeFinlifeDetail(row, details[i]));
}

export const finlifeSohoSource: ProductSource = {
  id: SOURCE_ID,
  label: "금감원 금융상품한눈에 개인사업자대출",
  url: LIST_URL,
  fetchAll: fetchFinlifeSohoAll,
};
