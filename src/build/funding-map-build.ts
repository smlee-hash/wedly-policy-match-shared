/**
 * 자금 조달 지도 조립 — 공고(PolicyAnnouncement)와 상시 상품(FinanceProduct) 두 표를
 * 한 모양(FundingItem)으로 합쳐 화면이 그대로 그릴 수 있는 `FundingMapData` 를 만든다.
 *
 * 통로 두 개(`POST /api/policy-match/funding-map` · `GET …?bizno=`)가 **이 함수 하나만** 부른다 —
 * 진단 화면과 통합 상세창 추천 탭이 다른 계산을 하면 같은 공고가 두 곳에서 다르게 읽힌다.
 *
 * AI 0콜: 저장 때 규칙으로 채워 둔 갈래·한도·금리와 판정 엔진(checkCondition)만 쓴다.
 */
import { extractAmount } from "../funding/amount-rate-extract";
import { classifyFundingGroup, isFundingGroup, type FundingGroup } from "../funding/funding-group";
import {
  deadlineOfAnnouncement,
  deadlineOfProduct,
  fitsOf,
  formatWon,
  glanceOf,
  groupBlocks,
  normalizeAmountUnits,
  splitByFit,
  whyOf,
  type FundingFilters,
  type FundingItem,
  type FundingMapData,
  type FundingSort,
} from "../funding/funding-map";
import {
  checkCondition,
  matchAnnouncement,
  readStoredStructure,
  type BusinessProfile,
} from "../engine/match-engine";
import { withRegionConditions } from "../engine/region-augment";
import type { StructuredCondition } from "../engine/structure-types";
import { fitVerdictOf, scoreOf, type FitVerdict } from "../engine/recommend-score";
import { rulesToConditions } from "../funding/products/rules-to-conditions";
import { MANUAL_PRODUCTS } from "../funding/products/sources/manual";
import type { ProductTargetRules } from "../funding/products/types";
import { dedupKeyOf } from "../engine/types";

/**
 * 공고 한 줄 — 지도 조립이 읽는 칸만. **원본**
 * (`wedly-erp/src/lib/services/policy-match/open-announcements.ts` 의 `OpenAnnouncementRow`)
 * 에서 칸과 주석을 그대로 옮겼다. 이름만 바꾼 이유: 이 패키지에는 「열려 있는 것만 읽는다」는
 * 조회 규칙이 없다 — 그 규칙(캐시·마감 거르기 포함)은 loader 를 내는 앱 몫이다(설계서 §2-a).
 */
export interface AnnouncementRow {
  id: string;
  title: string;
  agency: string;
  region: string;
  wedlyCategory: string;
  applyStart: Date | null;
  applyEnd: Date | null;
  url: string;
  structure: unknown;
  ruleStructure: unknown;
  structureStatus: string;
  dedupKey: string;
  // ── 자금 조달 지도(2026-09-03) — 저장 때 규칙으로 채워 둔 칸. 본문(summary·targetText)은 일부러 안 읽는다:
  //    1만 행의 Text 열을 통째로 들고 오면 이 조회 하나가 서버 메모리를 먹는다.
  source: string;
  applyPeriodText: string;
  fundingGroup: string;
  amountText: string;
  amountMaxWon: bigint | null;
  rateText: string;
  rateMin: number | null;
  firstSeenAt: Date;
}

/**
 * 상시 상품 한 줄 — 아래 `PRODUCT_SELECT` 가 고르는 **17칸과 정확히 짝**이다. 칸 이름은 Prisma
 * `FinanceProduct` 모델 그대로라 앱 loader 가 `select: PRODUCT_SELECT` 를 그대로 쓰면 어긋날 자리가 없다.
 *
 * 타입은 스키마(`wedly-erp/prisma/schema.prisma` model FinanceProduct) 실측 그대로다:
 * `limitMaxWon` 은 `BigInt?` → `bigint | null`, `rateMin` 은 `Float?` → `number | null`,
 * `firstSeenAt` 은 `DateTime @default(now())` 라 **비지 않는다**.
 * `targetRules` 는 `Json` — 모양을 좁히지 않고 `unknown` 으로 받는다(값 검사는 `readTargetRules` 와
 * `rulesToConditions` 가 키마다 다시 한다). Prisma 의 `JsonValue` 가 그대로 들어온다.
 *
 * ※ 아래 내부 타입 `ProductRow` 와 따로 두는 이유: 손 등록 명부(`MANUAL_ROWS`)는 한도를 `number` 로,
 *   「처음 본 날」을 `null` 로 준다. `ProductRow` 는 그 둘을 함께 담는 **더 넓은** 모양이고,
 *   `FinanceProductRow` 는 DB 가 실제로 주는 **좁은** 모양이다(좁은 쪽이 넓은 쪽에 그대로 들어간다).
 */
export interface FinanceProductRow {
  id: string;
  source: string;
  fundingGroup: string;
  institution: string;
  institutionType: string;
  name: string;
  targetText: string;
  targetRules: unknown;
  limitText: string;
  limitMaxWon: bigint | null;
  rateText: string;
  rateMin: number | null;
  channel: string;
  applyUrl: string;
  detailUrl: string;
  deadlineText: string;
  firstSeenAt: Date;
}

/**
 * 자료를 **어디서 읽는지**만 앱이 낸다(설계서 §2-a) — 이 패키지에 Prisma 는 한 줄도 없다.
 * 계산·판정은 두 앱이 같고 읽는 곳만 달라서, 읽기만 인자로 뺐다.
 *
 * ERP 는 기존 `open-announcements.ts`(60초 캐시·마감 거르기 포함)를 그대로 넘기고,
 * 일루아는 같은 select 를 하는 얇은 loader 를 낸다. 타입 검사는 각 앱의 Prisma 클라이언트로 받는다.
 */
export interface FundingMapLoaders {
  /** 열려 있고 마감이 안 지난 공고. 캐시·마감 거르기는 앱 몫이다. */
  loadAnnouncements(now: Date): Promise<AnnouncementRow[]>;
  /** 살아 있는 상시 상품 — `where: { active: true }` · `select: PRODUCT_SELECT`. */
  loadProducts(): Promise<FinanceProductRow[]>;
}

/** 처음 본 지 이 시간 안이면 「새로 올라옴」. */
const NEW_MS = 72 * 3_600_000;
/** 갈래를 못 붙인 줄의 한 줄 이유 앞머리 — 화면에서 「왜 여기 있지」를 바로 알 수 있게. */
const UNCLASSIFIED_PREFIX = "갈래 미분류 · ";
/** 서랍이 그리는 대상 원문 길이 상한(상품만). 공고는 상세 통로가 따로 있어 싣지 않는다. */
const TARGET_TEXT_MAX = 600;
/**
 * **공고** 앞면 「얼마」 칸 글자 상한. AI 구조화가 뽑은 `supportAmountText` 에는 금액이 아니라 공고 문장이
 * 통째로 들어 있는 것이 많아, 그대로 실으면 표 한 줄이 다섯 줄로 늘어난다
 * (배포본 QA 캡처 `15c-table-sorted-by-amount.png`). 공고 원문은 상세 화면에 그대로 있다.
 *
 * ★상품(`limitText`)에는 걸지 않는다 — 상품은 상세 화면이 없어 자르면 원본이 사라진다(코덱스 #3).
 */
const AMOUNT_TEXT_MAX = 40;

/** 40자를 넘으면 앞 40자 + 「…」. 짧은 값(「최대 1억원」)은 손대지 않는다. */
function shortAmountText(s: string): string {
  const t = s ?? "";
  return t.length > AMOUNT_TEXT_MAX ? `${t.slice(0, AMOUNT_TEXT_MAX)}…` : t;
}

/**
 * 「얼마」 앞에 붙는 낱말 후보 — **금액 표현 바로 앞 구절에 있는 것을 나온 순서대로 모두** 가져온다.
 *
 * ★낱말 하나만 남기던 것을 버렸다(2026-09-03 코덱스 적대 리뷰 #5 중간):
 *  「업체당 최대 1억 2천만원」이 「업체당 1.2억원」이 되어 **한도인지 업체당 총액인지**가 사라졌다.
 *  둘 다 뜻이 있는 말이라 하나만 남기면 안 된다.
 *
 * 긴 것을 먼저 적는다 — 「1개사당」이 「개사당」으로 잘리면 두 조각으로 읽힌다(정규식은 앞 대안이 이긴다).
 */
/**
 * ★「사업자당·차주당」을 더했다(코덱스 11차 #12, 2026-09-04) — 저장 때는 이 두 표지를 창에서 찾아
 *  한도를 살렸는데(`amount-rate-extract.ts` 의 `PER_COMPANY_RE`), 앞면 글자를 짓는 이 목록에는 없어
 *  화면에서 표지가 다시 사라졌다(「사업자당 지원한도 300억원」 → 「한도 300억원」). 한 곳당 한도인지
 *  사업 전체 규모인지는 사람이 신청 가능액을 읽는 데 결정적이라 글자에도 남겨야 한다.
 */
const AMOUNT_WORD_RE = /1개사당|개사당|사업자당|기업당|업체당|차주당|점포당|건당|인당|최대|한도|최고/g;

/**
 * 금액 표현(숫자 + 원·만원·천원·백만원·억·%) — 「앞 구절」의 끝을 여기서 찾는다.
 * 금액이 아예 없으면 앞머리를 대신 본다(「한도 없음」처럼 숫자가 없는 원문도 있다).
 */
const AMOUNT_EXPR_RE = /\d[\d,.]*\s*(?:백만원|천원|만원|억원|억|원|%)/;

/** 금액 표현 앞에서 살펴볼 글자 수. 너무 넓히면 앞 문장의 「최대」까지 끌고 온다. */
const AMOUNT_PREFIX_WINDOW = 12;

/**
 * 금액 앞 구절. 하나도 없으면 「최대」.
 * 같은 낱말이 두 번 나오면 한 번만 적는다 — 「최대 최대」는 사람이 지은 말이 아니다.
 */
function amountPrefixOf(raw: string): string {
  const s = (raw ?? "").replace(/\s+/g, " ");
  const at = s.match(AMOUNT_EXPR_RE)?.index ?? -1;
  // 전역 `window` 를 가리지 않게 이름을 따로 둔다 — 이 파일은 서버에서 돌지만 이름을 겹치지 않게.
  const before = at >= 0 ? s.slice(Math.max(0, at - AMOUNT_PREFIX_WINDOW), at) : s.slice(0, AMOUNT_PREFIX_WINDOW);
  const words: string[] = [];
  for (const m of before.matchAll(AMOUNT_WORD_RE)) {
    if (!words.includes(m[0])) words.push(m[0]);
  }
  return words.length ? words.join(" ") : "최대";
}

/**
 * 앞면 「얼마」 글자 — 공고 전용(상품 `limitText` 는 은행이 적은 상품 설명이라 이 함수를 안 거친다.
 * 상품은 자르지도 낱말을 바꾸지도 않고 **단위 토큰만** `normalizeAmountUnits` 로 통일한다 — 아래 itemOfProduct).
 *
 * ★단위 통일(독립 검사 C · 배포본 캡처 `10-amount-unit-inconsistency.png`)
 *  원문 단위를 그대로 실어 같은 금액이 「최대 70,000천원」·「최대 1,200백만원」·「최대 7천만원」
 *  세 가지로 섞여 보였다. **숫자 칸(`amountMaxWon`)이 있으면** 금액 앞 구절만 원문에서 가져오고
 *  금액은 `formatWon` 하나로 적는다 — 화면 어디서 봐도 같은 금액이 같은 글자가 된다.
 *
 * ★숫자 칸이 없을 때(독립 검사 D · 캡처 `07-drawer-from-table.png`)
 *  규칙 글자가 40자를 넘어 문장이 잘리는데 AI 구조화가 **더 짧은** 금액 표현
 *  (「월1만원(12개월)」)을 갖고 있으면 그쪽을 쓴다. 잘린 문장보다 짧은 금액이 늘 낫다.
 *  AI 문장이 더 길면 규칙 글자를 그대로 자른다 — 짧다는 이유만으로 아무 문장이나 바꿔치지 않는다.
 *
 * ★대체 조건에 **금액 표현이 있을 것**을 더했다(2026-09-03 코덱스 적대 리뷰 #6 중간):
 *  AI 문장이 짧기만 하면 무검증으로 갈아치워 「교육·컨설팅 지원」처럼 금액이 아예 없는 말이
 *  「얼마」 칸에 앉았다. 금액이 없는 문장은 잘린 원문보다 나을 것이 없다.
 */
function frontAmountText(ruleText: string, aiText: string, maxWon: number | null): string {
  const rule = ruleText ?? "";
  const ai = aiText ?? "";
  const raw = rule || ai;
  if (maxWon !== null && maxWon > 0) return `${amountPrefixOf(raw)} ${formatWon(maxWon)}`;
  // 숫자 칸이 없으면 글자를 그대로 싣는 자리다 — 글 안의 단위(17백만원·800천원)만 원으로 환산해
  // 표기를 통일한다(독립 검사 D). 자르기(shortAmountText)는 **환산 뒤** 해야 토큰이 반토막 나지 않는다.
  if (rule.length > AMOUNT_TEXT_MAX && ai && ai.length < rule.length && AMOUNT_EXPR_RE.test(ai)) {
    return shortAmountText(normalizeAmountUnits(ai));
  }
  return shortAmountText(normalizeAmountUnits(raw));
}

export interface BuildFundingMapOptions {
  /** 화면 칩(열린 것만·마감 임박·안 맞음도 보기). 서버에서 걸러야 한눈에 4칸과 표의 숫자가 어긋나지 않는다. */
  filters?: Partial<FundingFilters>;
  /** 갈래 안 차례. */
  sort?: FundingSort;
  /** 갈래 한 칸에 실을 최대 건수(통합 상세창 추천 탭은 3). */
  topN?: number;
}

/**
 * ★재설계 계약 G1①(2026-09-04) — `fitOnly` 를 없애고 `includeExcluded`(기본 false) 로 바꿨다.
 * 이 파일은 G1 이 손대는 목록엔 없지만 `FundingFilters` 타입을 그대로 쓰므로 이 상수도 함께 고친다
 * (통합 단계 G4 — 안 고치면 `applyFilters` 가 `includeExcluded` 를 `undefined` 로 읽어 excluded 를
 * 항상 숨기는 것까진 맞아도, 옛 필드 이름이 타입 밖에 남아 tsc 가 걸린다).
 */
const NO_FILTERS: FundingFilters = { openOnly: false, soonOnly: false, includeExcluded: false };

/** Prisma Json 칸 → 대상 규칙. 값 검사는 rulesToConditions 가 키마다 다시 한다(모양이 이상하면 조건을 안 만든다). */
function readTargetRules(raw: unknown): ProductTargetRules {
  return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as ProductTargetRules) : {};
}

/** BigInt 칸 → 응답에 실을 수 있는 수. JSON 은 BigInt 를 못 실어 그대로 두면 응답을 만들다 500 이 난다. */
function wonNumber(v: bigint | number | null): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "bigint" ? Number(v) : v;
  return Number.isFinite(n) ? n : null;
}

/**
 * 상시 상품 한도 상한(100억원) — 이 위로는 정렬·「가장 큰 한도」 집계용 숫자에서 뺀다. 공고에 이미 있는
 * 100억 상한 규칙(`amount-rate-extract.ts` 의 `PER_COMPANY_REQUIRED_WON`)과 같은 취지다.
 *
 * ★2026-09-03 독립 화면 검사 후속(금감원 자료 실측 6건 — 「500억원 이하」·「동일인당 최대 220억원」 등) —
 *  상시 상품 한도가 실제로 100억을 넘는 값이 있었다. 글자(amountText)는 원문 그대로 두고 숫자만 비운다
 *  — 정직하게 보여 주되, 비현실적으로 큰 값이 정렬·집계를 왜곡하지 않게 한다.
 *
 * ★2026-09-03 코덱스 적대 리뷰 반영 — 위 규칙이 100억을 넘으면 **무조건** 지웠는데, 「동일인당 최대
 *  220억원」처럼 기업 한 곳당 표시가 뚜렷한 값은 실제 유효 한도라 정렬 숫자를 지우면 50억짜리 상품
 *  보다 뒤로 밀리고 글자(220억원)와 정렬이 어긋난다 — 표시가 있으면 100억을 넘어도 남긴다.
 *
 * ★2026-09-04 코덱스 12차 #2 — 그 「표시 찾기」를 표지 목록(`PER_COMPANY_RE`)으로 **글 전체에서**
 *  했다. 공고 쪽 추출기는 표지를 같은 절 안에서만(구두점 경계) 찾는데 이쪽만 규칙이 느슨해서,
 *  「사업자당 한도 5억원; 전체 한도 300억원」처럼 앞 절에만 표시가 있는 글이 300억을 기업 한 곳
 *  한도로 통과시켰다. 이제 **추출기(`extractAmount`)를 그대로 불러** 그것이 뽑은 숫자를 본다 —
 *  규칙이 한 벌뿐이라 두 곳이 갈릴 자리가 없어진다. 글자(amountText)는 어느 쪽이든 원문 그대로다
 *  (숫자만 비운다).
 *
 * ★2026-09-04 코덱스 13차 #4 — 그 잣대가 「추출기 값 === 저장된 한도」였다. 「기업당 운전자금 최대
 *  100억원, 시설자금 최대 200억원」처럼 자금 종류별로 한도가 갈리는 글에서는 추출기가 표지
 *  (「기업당」)와 같은 절에 있는 100억만 인정하므로(200억 쪽 절엔 표지가 없다) 두 값이 안 맞아
 *  200억이 통째로 버려졌다 — 이 상품의 실제 최대 한도가 정렬·집계에서 사라진다. 잣대를
 *  **「추출기 값이 100억 이상」**으로 바꾼다: 표지로 검증된 큰 금액이 그 글에 실제로 있다는 뜻이라
 *  저장된 한도를 믿을 근거가 된다. 표지가 아예 없거나(「500억원 이하」) 앞 절에만 있어 작은 금액만
 *  인정되는 글(「사업자당 한도 5억원; 전체 한도 300억원」 → 5억)은 예전대로 비운다.
 */
const PRODUCT_AMOUNT_CAP_WON = 10_000_000_000;

function productAmountMaxWon(v: bigint | number | null, limitText: string): number | null {
  const n = wonNumber(v);
  if (n === null || n <= PRODUCT_AMOUNT_CAP_WON) return n;
  // ★같은 값일 때만이 아니라 **100억 이상일 때** 살린다(코덱스 13차 #4) — 위 주석 마지막 ★ 참고.
  const re = extractAmount(limitText).amountMaxWon;
  return re !== null && re >= PRODUCT_AMOUNT_CAP_WON ? n : null;
}

function isNewSince(firstSeenAt: Date | null | undefined, now: Date): boolean {
  if (!firstSeenAt) return false;
  const t = firstSeenAt.getTime();
  return Number.isFinite(t) && now.getTime() - t < NEW_MS;
}

/**
 * 지도 항목 + **응답에 안 싣는 곁가지**. `gapLabels` 는 이 항목의 기계 대조 조건이 실제로 읽는
 * 프로필 항목 이름들이다 — 빈칸 힌트(`profileGaps`)를 「이번 결과가 쓰는 것」으로 좁히는 데만 쓴다.
 * 항목(`FundingItem`)에 칸으로 넣지 않는 이유: 그 모양은 그대로 JSON 응답이 되어 응답이 커진다.
 */
interface BuiltItem {
  item: FundingItem;
  gapLabels: string[];
}

/** 공고 한 건 → 지도 항목. 갈래를 못 붙이면 grant 칸에 싣고 미분류 표식을 남긴다(빼면 누락이다). */
function itemOfAnnouncement(r: AnnouncementRow, profile: BusinessProfile, now: Date): BuiltItem {
  const stored = isFundingGroup(r.fundingGroup) ? r.fundingGroup : null;
  const guessed =
    stored ??
    classifyFundingGroup({ title: r.title ?? "", agency: r.agency ?? "", wedlyCategory: r.wedlyCategory ?? "" });
  const unclassified = guessed === null;
  const group: FundingGroup = guessed ?? "grant";

  // ★적대 리뷰(2026-08-29 중요4)와 같은 줄: `structure ?? ruleStructure` 는 실패 스텁을 골라잡는다 —
  //   상태로 판별한다. 추천 통로(recommend/route.ts)와 한 글자도 다르면 두 화면의 판정이 갈린다.
  const aiUsable = r.structureStatus === "done" || r.structureStatus === "needs_review";
  const structure = withRegionConditions(readStoredStructure(aiUsable ? r.structure : r.ruleStructure), r, {
    regionFieldFallback: true,
  });
  const m = matchAnnouncement(structure, profile, now);
  const fit = fitsOf(m.checks);
  const humanCheck = m.humanCheck.length;
  const why = whyOf(fit, humanCheck);

  const rateText = r.rateText || (group === "grant" && !unclassified ? "무상" : "");
  const item: FundingItem = {
    id: `a:${r.id}`,
    kind: "announcement",
    refId: r.id,
    group,
    title: r.title ?? "",
    agency: r.agency ?? "",
    url: r.url ?? "",
    applyUrl: "",
    // 공고 원문은 서랍이 상세 통로로 따로 읽는다 — 여기 실으면 응답이 1MB 를 넘는다.
    targetText: "",
    // 숫자 칸이 있으면 단위를 통일해 다시 쓰고, 없으면 규칙 글자(또는 더 짧은 AI 문장)를 40자까지 싣는다.
    amountText: frontAmountText(r.amountText || "", structure.supportAmountText || "", wonNumber(r.amountMaxWon)),
    amountMaxWon: wonNumber(r.amountMaxWon),
    rateText,
    rateMin: r.rateMin ?? null,
    // 접수 시작 전이면 마감이 넉넉해도 「지금 신청 가능」이 아니다 — applyStart 를 넘겨
    // 「N일 뒤 접수」(upcoming)로 갈라 준다(R1 이 만든 갈래, 리뷰 대장 #15·코덱스 #12).
    deadline: deadlineOfAnnouncement(r.applyEnd, r.applyPeriodText ?? "", now, r.applyStart),
    where: r.agency ?? "",
    fit,
    fitVerdict: fitVerdictOf(m.checks),
    humanCheck,
    score: scoreOf(m.checks),
    why: unclassified ? `${UNCLASSIFIED_PREFIX}${why}` : why,
    source: r.source ?? "",
    isNew: isNewSince(r.firstSeenAt, now),
    ...(unclassified ? { unclassified: true } : {}),
    // 서랍이 이 열쇠로 묶인 다른 수집본을 다시 물어 보여 준다(코덱스 #2). 빈 열쇠는 싣지 않는다 —
    // 빈 값으로 물으면 통로가 빈 배열을 주고 화면엔 뜻 없는 빈 목록이 남는다.
    ...((r.dedupKey ?? "").trim() ? { dedupKey: (r.dedupKey ?? "").trim() } : {}),
  };
  return { item, gapLabels: gapLabelsOfConditions(structure.conditions) };
}

/** 상시 상품 한 줄 — DB 에서 읽는 칸(select)과 짝이 맞아야 한다. */
interface ProductRow {
  id: string;
  source: string;
  fundingGroup: string;
  institution: string;
  institutionType: string;
  name: string;
  targetText: string;
  targetRules: unknown;
  limitText: string;
  /** DB 는 BigInt, 손 등록 명부(상수)는 number 로 준다 — 어느 쪽이든 wonNumber 가 응답용 수로 바꾼다. */
  limitMaxWon: bigint | number | null;
  rateText: string;
  rateMin: number | null;
  channel: string;
  applyUrl: string;
  detailUrl: string;
  deadlineText: string;
  /** 손 등록 명부는 「처음 본 날」이 없다(null) — 사람이 확인한 날짜를 새 것 표식으로 쓰지 않는다. */
  firstSeenAt: Date | null;
}

function itemOfProduct(p: ProductRow, profile: BusinessProfile, now: Date): BuiltItem {
  const stored = isFundingGroup(p.fundingGroup) ? p.fundingGroup : null;
  // 갈래 칸이 비거나 이상하면 기관 성격으로 다시 붙인다 — 은행 상품 876건이 미분류로 새면 지도가 무너진다.
  const guessed =
    stored ??
    classifyFundingGroup({ title: p.name ?? "", agency: p.institution ?? "", institutionType: p.institutionType ?? "" });
  const unclassified = guessed === null;
  const group: FundingGroup = guessed ?? "grant";

  const conditions = rulesToConditions(readTargetRules(p.targetRules), p.targetText ?? "");
  const checks = conditions.map((c) => checkCondition(c, profile, now));
  const fit = fitsOf(checks);
  // 상품에는 AI 의 「사람 확인」 목록이 없다 — 기계로 못 재는 조건(대표 나이 등)이 그 자리다.
  const humanCheck = conditions.filter((c) => !c.machineReadable).length;
  const why = whyOf(fit, humanCheck);

  const item: FundingItem = {
    id: `p:${p.id}`,
    kind: "product",
    refId: p.id,
    group,
    title: p.name ?? "",
    agency: p.institution ?? "",
    url: p.detailUrl ?? "",
    applyUrl: p.applyUrl ?? "",
    targetText: (p.targetText ?? "").slice(0, TARGET_TEXT_MAX),
    // ★상품 한도 글자는 **자르지 않는다**(2026-09-03 코덱스 적대 리뷰 #3 높음): 은행이 적은 한도 조건은
    //  「운전자금 최대 5억원 / 시설자금 최대 30억원 / 매출액의 1/3 이내」처럼 뒤쪽에 핵심이 있는 문장이
    //  많은데, 서버가 40자에서 자르면 **원본이 어디에도 남지 않는다**(상품은 상세 통로가 따로 없다).
    //  앞면은 화면이 두 줄(line-clamp-2)에서 끊고 전체는 `title` 로 읽는다.
    //  ★단, 글 안의 단위 토큰만은 통일한다(독립 검사 D) — 자르는 것과 달리 문장은 그대로 남는다.
    amountText: normalizeAmountUnits(p.limitText ?? ""),
    amountMaxWon: productAmountMaxWon(p.limitMaxWon, p.limitText ?? ""),
    rateText: p.rateText ?? "",
    rateMin: p.rateMin ?? null,
    deadline: deadlineOfProduct(p.deadlineText ?? "", now),
    where: p.channel || p.institution || "",
    fit,
    fitVerdict: fitVerdictOf(checks),
    humanCheck,
    score: scoreOf(checks),
    why: unclassified ? `${UNCLASSIFIED_PREFIX}${why}` : why,
    source: p.source ?? "",
    isNew: isNewSince(p.firstSeenAt, now),
    ...(unclassified ? { unclassified: true } : {}),
  };
  return { item, gapLabels: gapLabelsOfConditions(conditions) };
}

/**
 * 프로필에서 빈 칸을 사람 말로 — 「무엇을 입력해 달라」 힌트에 쓴다.
 *
 * ★뒤쪽 다섯(기업 규모·체납 여부·인증 보유·특허 보유·사업자번호)은 코덱스 3차 #B2(2026-09-04)에서
 *  더했다. 예전엔 「짝지을 이름이 없다」며 뺐는데, 이 다섯은 **채우면 판정이 실제로 달라지는** 칸이다
 *  (`checkCondition` 이 비면 곧바로 「…미입력」 unknown 을 낸다). 이름은 그 함수가 쓰는 오류 문구에서
 *  그대로 가져왔다 — 「기업 규모 미입력」·「체납 여부 미입력」·「인증 보유 미입력」·「특허 보유 미입력」·
 *  「사업자번호로 법인 여부를 알 수 없음」.
 */
function profileGapsOf(p: BusinessProfile): string[] {
  const gaps: string[] = [];
  if (p.creditScore == null) gaps.push("신용점수");
  if (p.hasExistingLoan == null) gaps.push("기존 대출 유무");
  if (!p.region) gaps.push("소재지");
  if (!p.industry) gaps.push("업종");
  if (!p.foundedDate) gaps.push("설립일");
  if (p.lastYearRevenueKrw == null) gaps.push("연매출");
  if (p.employeeCount == null) gaps.push("직원 수");
  if (!p.companyScale) gaps.push("기업 규모");
  if (p.taxDelinquent == null) gaps.push("체납 여부");
  if (p.hasCert == null) gaps.push("인증 보유");
  if (p.hasPatent == null) gaps.push("특허 보유");
  // `isCorporation` 은 사업자번호에서 법인 여부를 읽는다 — **비어 있을 때만** 빈 칸으로 센다.
  // 적혀 있는데 못 읽는 번호(가운데 두 자리가 89·90 등)는 「빈 칸」이 아니라 「읽을 수 없는 값」이라
  // 「입력해 주세요」가 거짓이 된다 — 그 자리는 조건 쪽 note 가 말한다.
  if (!p.bizno) gaps.push("사업자번호");
  return gaps;
}

/**
 * 판정에 쓸 회사 정보가 **하나도 없는가**(`FundingMapData.profileEmpty`, 코덱스 3차 #C 2026-09-04).
 *
 * 화면이 「조건을 맞춰 보지 않은 목록입니다」라고 **단정해도 되는 유일한 근거**다 — 정보가 통째로
 * 비었으면 어떤 조건도 못 맞춰 본 것이 확실하다. 반대로 값이 하나라도 있으면 우리는 **모른다**
 * (판정 엔진이 「견줘 봤다」를 기록하지 않는다). 모르면 화면이 아무 말도 하지 않는다.
 *
 * `false`·`0` 은 **채워진 값**이다(체납 없음·직원 0명) — 비었다고 세면 안 된다.
 */
function isProfileEmpty(p: BusinessProfile): boolean {
  return Object.values(p).every((v) => v === undefined || v === null || v === "");
}

/**
 * 조건 키 → 그 조건이 **읽는 프로필 항목의 사람 말 이름**. 이름은 위 `profileGapsOf` 가 쓰는 글자와
 * 한 글자도 다르면 안 된다(그 글자로 걸러 내기 때문이다).
 *
 * 짝은 지어내지 않고 `checkCondition`(`src/engine/match-engine.ts`)이 **실제로 읽는 칸**을 그대로 옮겼다:
 *  · region → `p.region`(소재지) · industry → `p.industry`(업종)
 *  · businessAgeMaxYears·businessAgeMinYears → `p.foundedDate`(설립일)
 *  · revenueMaxKrw·revenueMinKrw → `p.lastYearRevenueKrw`(연매출)
 *  · employeeMax·employeeMin → `p.employeeCount`(직원 수)
 *  · creditScoreMin·creditScoreMax → `p.creditScore`(신용점수)
 *  · hasExistingLoan → `p.hasExistingLoan`(기존 대출 유무)
 *
 * ★뒤 다섯은 코덱스 3차 #B2(2026-09-04)에서 더했다 — 예전엔 「`profileGapsOf` 가 안 세니 짝지을
 *  이름이 없다」며 뺐지만, 그것은 `profileGapsOf` 쪽 누락이었다. 채우면 판정이 실제로 갈린다:
 *  · companyScale → `p.companyScale`(기업 규모) · noTaxDelinquency → `p.taxDelinquent`(체납 여부)
 *  · certRequired → `p.hasCert`(인증 보유) · patentRequired → `p.hasPatent`(특허 보유)
 *  · isCorporation → `p.bizno`(사업자번호)
 *  「other」처럼 프로필을 아예 안 읽는 키는 여전히 여기 없다(짝이 없다).
 */
const GAP_LABEL_BY_CONDITION_KEY: Record<string, string> = {
  region: "소재지",
  industry: "업종",
  businessAgeMaxYears: "설립일",
  businessAgeMinYears: "설립일",
  revenueMaxKrw: "연매출",
  revenueMinKrw: "연매출",
  employeeMax: "직원 수",
  employeeMin: "직원 수",
  creditScoreMin: "신용점수",
  creditScoreMax: "신용점수",
  hasExistingLoan: "기존 대출 유무",
  companyScale: "기업 규모",
  noTaxDelinquency: "체납 여부",
  certRequired: "인증 보유",
  patentRequired: "특허 보유",
  isCorporation: "사업자번호",
};

/**
 * 한 항목이 **기계 대조에 실제로 쓰는** 프로필 항목 이름들 — 빈칸 힌트를 좁히는 데만 쓰고 응답에는 안 싣는다.
 *
 * `machineReadable` 이 false 인 조건은 뺀다: `checkCondition` 이 그 조건에서는 프로필을 **아예 읽지 않고**
 * 바로 「확인 필요」를 내므로, 그 칸을 채워도 달라질 것이 없다.
 */
function gapLabelsOfConditions(conditions: StructuredCondition[]): string[] {
  const out: string[] = [];
  for (const c of conditions) {
    if (!c.machineReadable) continue;
    const label = GAP_LABEL_BY_CONDITION_KEY[c.key];
    if (label) out.push(label);
  }
  return out;
}

/**
 * 빈칸 힌트 = 「비어 있는 프로필 항목」 ∩ 「이번 결과의 기계 대조 조건이 실제로 읽는 항목」
 * (코덱스 2차 #6, 2026-09-04).
 *
 * 예전엔 앞쪽(빈 칸 7종)만 보고 전부 나열했다 — 지금 결과에 신용점수를 보는 조건이 하나도 없어도
 * 「신용점수를 입력해 주세요 · 입력하면 조건을 더 정확하게 맞춰 볼 수 있어요」라고 시켰다(근거 없는 안내).
 *
 * 두 조건이 함께 참이면 그 항목은 **지금 확인 필요로 남아 있는 조건을 실제로 막고 있다**:
 * `checkCondition` 은 그 키의 프로필 칸이 비면 곧바로 「…미입력」 unknown 을 내기 때문이다.
 */
function usedProfileGapsOf(
  profile: BusinessProfile,
  items: FundingItem[],
  gapLabelsByItem: Map<FundingItem, string[]>,
): string[] {
  const used = new Set<string>();
  for (const it of items) for (const label of gapLabelsByItem.get(it) ?? []) used.add(label);
  return profileGapsOf(profile).filter((g) => used.has(g));
}

/**
 * 손 등록 명부(상수) → DB 상품과 똑같은 줄 모양. `manual` 은 회차(SOURCES)에 없다 —
 * 절대 실패하지 않는 상수 출처가 끼면 「전부 실패 되감기」 안전장치가 영원히 꺼지기 때문이다
 * (계획서 리뷰 대장 #4). 그래서 지도 조립이 여기서 직접 합친다(코덱스 1차 #7).
 *
 * 번호는 `manual:<sourceId>` — DB 번호(cuid)와 겹치지 않고, 화면 항목 번호는 `p:manual:…` 이 된다.
 * 「처음 본 날」은 null 이다: `verifiedAt` 은 사람이 마지막으로 링크를 확인한 날이라
 * 그걸 새 것 표식으로 쓰면 손볼 때마다 다섯 건이 「새로 올라옴」으로 둔갑한다.
 */
const MANUAL_ROWS: ProductRow[] = MANUAL_PRODUCTS.map((m) => ({
  id: `manual:${m.sourceId}`,
  source: "manual",
  fundingGroup: m.fundingGroup,
  institution: m.institution,
  institutionType: m.institutionType,
  name: m.name,
  targetText: m.targetText,
  targetRules: m.targetRules,
  limitText: m.limitText,
  limitMaxWon: m.limitMaxWon,
  rateText: m.rateText,
  rateMin: m.rateMin,
  channel: m.channel,
  applyUrl: m.applyUrl,
  detailUrl: m.detailUrl,
  deadlineText: m.deadlineText,
  firstSeenAt: null,
}));

/**
 * 같은 공고가 수집원 두 곳(기업마당 + 지자체 게시판 등)에서 들어와 `PolicyAnnouncement` 행이
 * 둘일 때 지도에 한 줄만 싣는다 — 2026-09-03 운영 실측에서 「한도 큰 순」 1·2위가 제목·기관·금액까지
 * 똑같은 두 줄이었다(「중소기업육성자금 경영안정자금(이자차액보전) 8차」).
 * 탐색 목록(browse-groups.ts)·추천 통로(recommend/route.ts)는 이미 같은 열쇠로 묶는다.
 */
const GROUP_IDS_CAP = 20;

/** 대표 고르기 1순위 — 판정이 좋은 수집본이 앞(recommend/route.ts 의 FIT_RANK 와 같은 차례). */
const REP_FIT_RANK: Record<FitVerdict, number> = { fit: 0, unverified: 1, excluded: 2 };

/**
 * 묶음 안에 **안 맞음(excluded)이 하나라도 있으면 묶음 판정은 안 맞음**이다 —
 * 추천 통로(`src/app/api/policy-match/recommend/route.ts` 의 `excludedKeys`)와 한 규칙이다.
 *
 * 왜(2026-09-03 코덱스 적대 리뷰 #1 높음): fit 을 무조건 앞세우면, 한 수집본에서 「이 회사는 대상이
 * 아니다」가 **증명된** 사업이 조건을 덜 읽은 쌍둥이(fit) 뒤에 숨어 「맞는 사업」으로 되살아난다.
 * 추천 통로는 그 자리에서 묶음을 통째로 버리지만, 지도는 **누락 0** 이 목표라 버리지 않고
 * 안 맞음 줄을 대표로 세운다 — 사람이 「왜 안 되는지」를 그 줄의 이유로 읽는다.
 */
function repRankOf(pairs: AnnPair[]): (p: AnnPair) => number {
  const hasExcluded = pairs.some((p) => p.item.fitVerdict === "excluded");
  if (!hasExcluded) return (p) => REP_FIT_RANK[p.item.fitVerdict];
  return (p) => (p.item.fitVerdict === "excluded" ? 0 : 1);
}

/** 공고 한 줄 + 그 원본 행 — 대표 고르기가 dedupKey·applyEnd 를 봐야 해서 짝으로 들고 다닌다. */
interface AnnPair {
  row: AnnouncementRow;
  item: FundingItem;
}

/** 마감 정렬 열쇠 — 마감일이 없으면 맨 뒤(「언제까지인지 모르는 줄」을 대표로 세우지 않는다). */
function applyEndRank(d: Date | null): number {
  return d && Number.isFinite(d.getTime()) ? d.getTime() : Number.MAX_SAFE_INTEGER;
}

/**
 * 대표 차례: 판정 → 대조한 조건 수(많은 쪽) → 마감(가까운 쪽) → 번호 사전순.
 * 첫 열쇠(판정)는 묶음 전체를 보고 정해진다(`repRankOf`) — 안 맞음이 섞인 묶음에서는
 * 안 맞음 줄끼리 겨루고, 나머지 세 열쇠는 그 안에서 그대로 돈다.
 */
function compareRep(rank: (p: AnnPair) => number) {
  return (a: AnnPair, b: AnnPair): number => {
    const byFit = rank(a) - rank(b);
    if (byFit !== 0) return byFit;
    if (a.item.fit.length !== b.item.fit.length) return b.item.fit.length - a.item.fit.length;
    const byEnd = applyEndRank(a.row.applyEnd) - applyEndRank(b.row.applyEnd);
    if (byEnd !== 0) return byEnd;
    return a.row.id < b.row.id ? -1 : a.row.id > b.row.id ? 1 : 0;
  };
}

/**
 * 같은 `dedupKey` 끼리 묶어 대표 한 줄만 남긴다. **열쇠가 비면 묶지 않는다** —
 * 빈 값끼리 「같은 공고」로 접히면 아무 상관 없는 공고가 통째로 사라진다.
 *
 * 자리(차례)는 **묶음이 처음 나온 자리**를 그대로 지킨다: 묶었다고 줄이 뒤로 밀리면
 * 동점일 때 원래 차례를 지키던 정렬(sortItems 는 안정 정렬)이 흔들린다.
 */
function groupAnnouncements(pairs: AnnPair[]): FundingItem[] {
  const buckets = new Map<string, AnnPair[]>();
  const slots: Array<{ key: string } | { item: FundingItem }> = [];
  for (const p of pairs) {
    const key = (p.row.dedupKey ?? "").trim();
    if (!key) {
      slots.push({ item: p.item });
      continue;
    }
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.push(p);
      continue;
    }
    buckets.set(key, [p]);
    slots.push({ key });
  }
  return slots.map((s) => {
    if ("item" in s) return s.item;
    const bucket = buckets.get(s.key) ?? [];
    const sorted = [...bucket].sort(compareRep(repRankOf(bucket)));
    const rep = sorted[0].item;
    // 혼자면 표식을 붙이지 않는다 — 화면이 「외 0곳」을 그리게 된다.
    if (sorted.length > 1) {
      rep.groupCount = sorted.length;
      rep.groupIds = sorted.slice(0, GROUP_IDS_CAP).map((p) => p.row.id);
      // 「외 N곳」은 **수집원 수**로만 센다 — 행 수로 세면 한 수집원이 같은 공고를 두 번 올린 것도
      // 「외 1곳」이 되어 없는 수집원을 말한다(코덱스 #7). 출처가 빈 줄은 세지 않는다.
      rep.groupSources = new Set(sorted.map((p) => (p.row.source ?? "").trim()).filter((x) => x !== "")).size;
    }
    return rep;
  });
}

/** 같은 사업인지 가리는 열쇠 — 이름도 기관도 비면 열쇠를 만들지 않는다(빈 값끼리 묶이면 엉뚱한 줄이 접힌다). */
function productKeyOf(p: { name: string; institution: string }): string {
  const title = (p.name ?? "").trim();
  const agency = (p.institution ?? "").trim();
  return title || agency ? dedupKeyOf({ title, agency }) : "";
}

/**
 * 같은 사업이 공고와 상시 상품 두 곳에 있으면(제목+기관이 **정확히** 같음) 공고 줄만 남기고,
 * 접은 상품 번호를 공고 줄에 남긴다 — 공고는 마감·접수처를 갖고 있어 사람이 할 일이 더 분명하다.
 *
 * ★접기는 **한 풀 안에서만** 돈다(코덱스 12차 #5, 2026-09-04). 예전엔 정상 풀에만 걸려 있어
 *  둘 다 안 맞음인 사업이 안 맞음 목록에 두 줄로 뜨고 「안 맞아서 뺀 K건」도 하나 더 세어졌다.
 *  풀을 섞어 접으면 안 된다 — 안 맞음 공고가 **맞는** 상품을 삼키면 사람이 넣을 수 있는 상품이
 *  안 맞음 뒤로 숨는다(11차 #4). 그래서 정상·안 맞음에 이 함수를 **따로** 부른다.
 *
 * 이름도 기관도 비면 열쇠를 만들지 않는다 — 빈 값끼리 「같은 사업」으로 묶여 엉뚱한 상품이 접힌다.
 */
function twinKeyOf(it: FundingItem): string {
  return it.title.trim() || it.agency.trim() ? dedupKeyOf({ title: it.title, agency: it.agency }) : "";
}

/**
 * @param mark 접은 상품 번호를 공고 줄에 **남길지**(기본 true). `false` 는 「몇 건이 남는지」만 세는
 *   자리(`totals.all`, 코덱스 13차 #5)에서 쓴다 — 그 자리는 칩을 걸기 전 **전체**를 한 번 접어 보는
 *   것이라, 번호까지 남기면 뒤이어 도는 정상·안 맞음 풀의 접기가 「이미 접어 둔 공고」로 읽혀
 *   상품 줄이 접히지 않는다(지도에 같은 사업이 두 줄로 뜬다).
 */
function foldTwinProducts(pool: FundingItem[], mark = true): FundingItem[] {
  const annByKey = new Map<string, FundingItem>();
  for (const it of pool) {
    if (it.kind !== "announcement") continue;
    const key = twinKeyOf(it);
    if (key && !annByKey.has(key)) annByKey.set(key, it);
  }
  // 이 호출에서 이미 상품을 접은 공고 열쇠 — `relatedProductId`(남기는 표식) 대신 이것으로 센다.
  // 그래야 표식을 안 남기는 세기(mark:false)도 「공고 하나는 상품 하나만 접는다」 규칙이 같다.
  const folded = new Set<string>();
  return pool.filter((it) => {
    if (it.kind !== "product") return true;
    const key = twinKeyOf(it);
    const twin = annByKey.get(key);
    // 이미 다른 상품을 접어 둔 공고면 이 상품은 그대로 보여 준다 — 번호를 못 남기는 줄을 숨기면 그게 누락이다.
    if (!twin || folded.has(key) || twin.relatedProductId) return true;
    folded.add(key);
    if (mark) twin.relatedProductId = it.refId;
    return false;
  });
}

/**
 * 앱 loader 가 **그대로 써야 하는** select — 패키지가 계속 내보낸다(설계서 §2-a).
 * 위 `FinanceProductRow` 의 17칸과 한 글자도 어긋나면 안 된다.
 */
export const PRODUCT_SELECT = {
  id: true, source: true, fundingGroup: true, institution: true, institutionType: true, name: true,
  targetText: true, targetRules: true, limitText: true, limitMaxWon: true, rateText: true, rateMin: true,
  channel: true, applyUrl: true, detailUrl: true, deadlineText: true, firstSeenAt: true,
} as const;

/** 지도 + 「거르기 전 / 거른 뒤」 건수. 화면 발 hint 가 「표시 N / 조건에 맞는 M / 전체 K」로 쓴다. */
export interface FundingMapResult extends FundingMapData {
  /**
   * 조립은 이 칸을 **반드시** 싣는다 — `FundingMapData` 쪽은 선택이다(옛 통로가 보낸 응답도
   * 그대로 그려야 하므로). 여기서 필수로 좁혀 두면 나중에 빠뜨렸을 때 타입검사가 잡는다.
   */
  profileEmpty: boolean;
  totals: {
    /**
     * 칩을 걸기 전 전체 건수(공고 + 상시 상품 + 손 등록) — **묶고 쌍둥이 상품을 접은 뒤**의 수다
     * (코덱스 13차 #5, 2026-09-04). 지도·표에 그려질 수 있는 줄만 센다.
     */
    all: number;
    /**
     * 칩으로 거르고 겹친 상품을 접은 뒤 남은 **정상** 건수 = 갈래 칸 `total` 의 합.
     *
     * ★안 맞음은 이 수에 안 들어간다(코덱스 11차 #2, 2026-09-04) — `includeExcluded` 를 켜도
     *  그대로다. 안 맞음 건수는 갈래 칸 `excluded` 를 더해 센다(그 수는 갈래별로 따로 필요하다).
     */
    filtered: number;
  };
}

export async function buildFundingMap(
  profile: BusinessProfile,
  now = new Date(),
  opts: BuildFundingMapOptions = {},
  // ★자료 읽기는 인자다(설계서 §2-a) — 앞 두 인자에 기본값이 있어도 이 인자는 **반드시 넘겨야 한다**
  //  (기본값이 있는 인자 뒤에 필수 인자를 두는 것은 문법상 허용된다. 앞을 건너뛰려면 `undefined` 를 적는다).
  loaders: FundingMapLoaders,
): Promise<FundingMapResult> {
  const [rows, products] = await Promise.all([
    loaders.loadAnnouncements(now),
    loaders.loadProducts(),
  ]);

  // 수집기가 이미 같은 상품을 받아 왔으면(이름·기관이 정확히 같음) 손 등록 줄은 뺀다 —
  // 한 사업이 두 줄로 보이면 사람은 서로 다른 상품으로 읽는다. 공고와 겹칠 때의 접기는
  // 아래에서 DB 상품과 똑같은 규칙으로 한 번 더 돈다.
  const dbProductKeys = new Set((products as ProductRow[]).map(productKeyOf).filter((k) => k !== ""));
  const manualRows = MANUAL_ROWS.filter((m) => !dbProductKeys.has(productKeyOf(m)));

  // ★묶기가 **맨 먼저**다 — 접기(relatedProductId)·칩·정렬·상위 N 은 전부 그 뒤다.
  //  뒤로 미루면 같은 공고 두 줄이 각자 다른 상품을 접거나(접기 규칙과 어긋남) 표 앞자리를
  //  둘이 나눠 차지한다(운영 실측: 한도 큰 순 1·2위가 같은 공고였다).
  // 항목이 「어떤 프로필 항목을 읽는지」는 **응답에 안 싣고** 여기서만 들고 다닌다(빈칸 힌트 좁히기).
  // 열쇠는 항목 **객체 그대로**다 — 묶기(groupAnnouncements)·거르기(splitByFit)·접기(foldTwinProducts)
  // 어디서도 항목을 복사하지 않아(칸만 덧쓴다) 신원이 끝까지 유지된다.
  const gapLabelsByItem = new Map<FundingItem, string[]>();
  const remember = (b: BuiltItem): FundingItem => {
    gapLabelsByItem.set(b.item, b.gapLabels);
    return b.item;
  };

  const items: FundingItem[] = [
    ...groupAnnouncements(rows.map((r) => ({ row: r, item: remember(itemOfAnnouncement(r, profile, now)) }))),
    ...(products as ProductRow[]).map((p) => remember(itemOfProduct(p, profile, now))),
    ...manualRows.map((m) => remember(itemOfProduct(m, profile, now))),
  ];

  // ★「전체」 건수는 **쌍둥이 상품을 접은 뒤**로 센다(코덱스 13차 #5, 2026-09-04) — 접힌 상품 줄은
  //  지도·표 어디에도 없는데 발 hint 의 「전체 K건」에는 세어져 사람이 없는 줄을 찾아다녔다.
  //  표식을 남기지 않고(mark:false) 세는 이유는 `foldTwinProducts` 의 주석에 있다 — 아래 정상·
  //  안 맞음 풀의 접기보다 **먼저** 돌아야 한다(뒤로 미루면 표식이 이미 붙어 개수가 틀린다).
  const allCount = foldTwinProducts(items, false).length;

  const filters: FundingFilters = { ...NO_FILTERS, ...(opts.filters ?? {}) };
  // ★차례가 뜻이다(코덱스 11차 #2·#3·#4, 2026-09-04): ① 다른 칩(열린 것만·7일 내 마감)을 **먼저**
  //  걸고 ② 통과한 것만 정상(맞음+확인 필요)/안 맞음 두 풀로 나눈다. 아래 겹친 상품 접기·집계·
  //  정렬·topN·한눈에 4칸은 **정상 풀만** 쓰고, 안 맞음 풀은 갈래별 개수와 `excludedItems` 로만
  //  나간다 — 예전엔 스위치(includeExcluded) 하나가 이 전부를 흔들었다.
  const { normal: filtered, excluded: excludedPool } = splitByFit(items, filters);

  // 같은 사업이 공고와 상시 상품 두 곳에 있으면(소공인특화자금 등) 공고 줄만 남긴다 — 규칙은
  // `foldTwinProducts` 하나뿐이고, **정상 풀과 안 맞음 풀에 따로** 부른다(코덱스 12차 #5).
  //
  // ★접기는 반드시 **칩으로 거른 뒤**에 한다 — 먼저 접으면 공고가 「안 맞음」으로 걸러진 자리에서
  //  상품까지 함께 사라진다(맞는 상품을 잃는다).
  const shown = foldTwinProducts(filtered);
  const excludedShown = foldTwinProducts(excludedPool);
  const unclassified = shown.filter((it) => it.unclassified).length;

  // ★「무엇을 채우면 좋은가」(빈칸 힌트)는 **판정이 끝난 목록 전부**로 센다 — 정상 풀 + 안 맞음 풀을
  //  **겹친 상품을 접기 전**(`filtered`·`excludedPool`)으로 본다(코덱스 3차 #B1, 2026-09-04).
  //   ⓐ 정상 풀만 세면 전부 안 맞음으로 걸러진 회사에게 힌트가 사라지고, 「안 맞아서 뺀 항목 보기」
  //     스위치 하나에 머리 카드가 흔들린다(그 스위치는 판정과 무관하다 — 2차 #1·#6).
  //   ⓑ 접은 **뒤**로 세면 접힌 쌍둥이 상품이 들고 있던 조건을 통째로 잃는다. 접기는 「같은 사업을
  //     두 줄로 보여 주지 않기」일 뿐, 그 줄에서 판정이 안 돌았다는 뜻이 아니다(3차 #B1).
  const judged = [...filtered, ...excludedPool];
  const profileGaps = usedProfileGapsOf(profile, judged, gapLabelsByItem);

  const glance = glanceOf(shown);
  if (unclassified > 0) {
    // 미분류는 grant 칸에 얹혀 있을 뿐이다 — 「안 갚아도 되는 돈」 집계에 넣으면 없는 지원금이 부풀려진다.
    const real = glanceOf(shown.filter((it) => !it.unclassified));
    glance.grantFit = real.grantFit;
    glance.grantMaxWon = real.grantMaxWon;
  }

  return {
    // ★안 맞음은 **별도 풀**로 넘긴다(코덱스 11차 #2·#3, 2026-09-04). 예전 `allItems`(필터 전 전체)는
    //  개수만 세는 자리라, 켰을 때 실제 항목을 보여 줄 길이 없어 화면이 전역 재조회로 우회했다.
    //  `excludedPool` 은 **다른 칩을 통과한** 안 맞음이라 개수가 칩과 같은 잣대에서 나오고,
    //  `includeExcluded` 를 켜면 갈래마다 같은 정렬·같은 topN 으로 `excludedItems` 에 실린다.
    //  넘기는 값은 **겹친 상품을 접은 뒤**(`excludedShown`)다 — 정상 풀과 같은 중복 제거를 거쳐야
    //  같은 사업이 안 맞음 목록에 두 줄로 뜨지 않는다(코덱스 12차 #5).
    groups: groupBlocks(shown, {
      sort: opts.sort,
      topN: opts.topN,
      excludedPool: excludedShown,
      includeExcluded: filters.includeExcluded,
    }),
    glance,
    profileGaps,
    unclassified,
    // ★화면이 「조건을 맞춰 보지 않은 목록입니다」라고 단정해도 되는 **유일한 근거**(3차 #C).
    //  옛 칸 `evaluatedConditions`(판정이 난 조건 수)는 없앴다 — 판정 엔진이 「견줘 봤다」를 기록하지
    //  않아 어떤 셈도 근사치였고, 근사치로 만든 단정문은 계속 틀렸다.
    profileEmpty: isProfileEmpty(profile),
    // 화면이 「상위 N 건만 실렸다」와 「칩으로 몇 건이 빠졌다」를 구분해 말할 수 있게 둘 다 준다.
    // `all` 은 **묶고(dedupKey) 쌍둥이 상품까지 접은 뒤** 건수다(13차 #5) — 접힌 줄까지 세면
    // 화면 발 hint 가 지도에 없는 줄을 말한다.
    totals: { all: allCount, filtered: shown.length },
    generatedAt: now.toISOString(),
  };
}
