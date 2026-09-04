/**
 * 돈의 성격 6갈래 — 자금 조달 지도의 첫 번째 축(설계 2026-09-03 §1·§3-2). AI 없음.
 * 순서가 뜻이다: 좁은 낱말(투자·긴급·보증)을 먼저, 넓은 낱말(융자·지원사업)을 뒤에 본다 —
 * 「긴급경영안정자금 융자」는 policy 가 아니라 urgent, 「특례보증 지원사업 모집」은 grant 가 아니라 guarantee.
 * ※ wedly-category.ts(추천 카테고리 7종)와 축이 다르다 — 합치지 않는다. 못 붙이면 그쪽 값으로 되돌아간다.
 */
export const FUNDING_GROUPS = ["grant", "policy", "guarantee", "bank", "urgent", "invest"] as const;
export type FundingGroup = (typeof FUNDING_GROUPS)[number];

export function isFundingGroup(v: unknown): v is FundingGroup {
  return typeof v === "string" && (FUNDING_GROUPS as readonly string[]).includes(v);
}

/** 화면 이름표 색 6가지 — 갈래마다 다른 색(재설계 계약 G1③, 2026-09-04 시안 3). */
export type FundingGroupTone = "green" | "blue" | "purple" | "navy" | "gold" | "teal";

/**
 * 화면 이름표 — 승인 미리보기 GROUPS 와 글자까지 같다.
 *
 * ★재설계 계약 G1③(2026-09-04 시안 3) — 예전엔 3톤(green/blue/gray/gold)을 갈래 6개가 나눠 썼는데
 *  (policy·guarantee 가 같은 blue, grant·invest 가 같은 green), 갈래 카드 색만 보고 어느 칸인지
 *  구분할 수 없었다. 이제 6갈래가 각자 다른 색을 쓴다.
 *  who — 카드 머리에 한 줄 얹는 「누구를 위한 돈인지」. example — 실제 있는 상품·공고 이름 한 줄.
 *  둘 다 화면(카드·서랍)이 그대로 읽는다 — 화면이 제 나름대로 다시 짓지 않는다.
 */
export const FUNDING_GROUP_META: Record<
  FundingGroup,
  { name: string; sub: string; tone: FundingGroupTone; who: string; example: string }
> = {
  grant: {
    name: "안 갚아도 되는 돈",
    sub: "보조금 · 지원사업 · 바우처",
    tone: "green",
    who: "갚지 않는 돈 — 선정되면 사업비를 지원",
    example: "스마트상점 기술보급",
  },
  policy: {
    name: "싸게 빌리는 돈",
    sub: "정책자금 · 이차보전 · 육성기금",
    tone: "blue",
    who: "정부·지자체가 이자를 낮춰 주는 대출",
    example: "관악구 육성자금 연 1.5%",
  },
  guarantee: {
    name: "보증 받아 빌리는 돈",
    sub: "특례보증 · 마이너스통장형 보증",
    tone: "purple",
    who: "보증서로 담보 없이 은행 대출",
    example: "서울 안심통장 2천만원",
  },
  bank: {
    name: "은행에서 바로",
    sub: "사업자 신용대출 · 마이너스통장",
    tone: "navy",
    who: "은행 앱·창구에서 바로 신청하는 대출",
    example: "케이뱅크 사장님 신용대출",
  },
  urgent: {
    name: "급할 때",
    sub: "서민금융 · 긴급경영안정 · 폐업지원",
    tone: "gold",
    who: "신용이 낮거나 위기일 때 먼저 볼 곳",
    example: "미소금융 · 희망리턴",
  },
  invest: {
    name: "투자 받기",
    sub: "TIPS · 모태펀드 · 엔젤매칭",
    tone: "teal",
    who: "지분을 주고 받는 돈 — 상환 없음",
    example: "TIPS R&D 5억",
  },
};

/** 이 기관에서 온 상품은 글자와 무관하게 bank — 「보증서대출」이라 적혀 있어도 창구는 은행이다. */
const BANK_TYPES = new Set(["bank", "internet-bank", "savings-bank", "capital"]);

const RULES: Array<{ re: RegExp; group: FundingGroup }> = [
  // 넓은 「투자」 단독은 「설비투자·시설투자·투자기업·투자 보조·투자 지원사업」까지 끌어와
  // grant 를 삼킨다(리뷰 중요6) — 실제 투자 유치·펀드·엔젤 계열만 좁혀서 잡는다.
  { re: /투자유치|투자\s*받|투자\s*연계|펀드|TIPS|팁스|엔젤|액셀러레이|벤처캐피탈/i, group: "invest" },
  // 「재해|재난」 단독은 「재난안전산업 육성」 같은 산업 육성 공고까지 urgent 로 끌어온다
  // (리뷰 중요6) — 실제 재해 피해·복구 지원만 좁힌다.
  { re: /미소금융|햇살론|긴급|재해\s*(피해|복구|중소기업|소상공인)|재난\s*피해|폐업|재기|재도전|재창업|신용취약|취약계층|희망리턴|저신용|연체/, group: "urgent" },
  // 「보증(?!금)」 단독은 「품질보증 컨설팅」처럼 보증과 무관한 문구까지 guarantee 로 끌어온다
  // (리뷰 중요6) — 실제 특례보증·보증서·협약보증 상품 계열만 좁힌다.
  { re: /특례보증|보증서|안심통장|보증드림|협약보증\s*(시행|안내|출시)|보증\s*지원(?!금)|신용보증(?!기금)|보증상품/, group: "guarantee" },
  { re: /정책자금|융자|이차보전|육성자금|육성기금|경영안정자금|운전자금|시설자금|대출|이자\s*(지원|보전)/, group: "policy" },
  { re: /보조금|지원사업|지원금|바우처|모집|공모|무료|무상|환급|사업화|컨설팅|기술보급|창업패키지/, group: "grant" },
];

const BY_WEDLY_CATEGORY: Record<string, FundingGroup> = {
  무상지원금: "grant",
  정책자금: "policy",
  "고용·인력": "grant",
  "R&D·기술": "grant",
  수출: "grant",
};

/**
 * grant 로 걸렸는데 본문에 실제 대출 금리(「연 N%」)가 있으면 오분류다 —
 * 「소상공인 지원사업」이라 적힌 대출 상품이 실제로 있다(리뷰 중요6 교차검증).
 * 보증료·이차보전 표현(「보증료 연 0.6%」·「이자 2.5%p 지원」)은 "연"으로 시작하지 않아 걸리지 않는다.
 */
const LOAN_RATE_RE = /^연\s*[\d.]+\s*%/;

export interface FundingGroupInput {
  title: string;
  summary?: string;
  agency?: string;
  institutionType?: string;
  wedlyCategory?: string;
  /** amount-rate-extract.ts extractRate 결과 — grant 오분류 교차검증에만 쓰는 선택 인자. */
  rateText?: string;
}

function classifyCore(input: FundingGroupInput): FundingGroup | null {
  if (input.institutionType && BANK_TYPES.has(input.institutionType)) return "bank";
  const text = `${input.title} ${input.summary ?? ""} ${input.agency ?? ""}`;
  for (const { re, group } of RULES) if (re.test(text)) return group;
  const fallback = input.wedlyCategory ? BY_WEDLY_CATEGORY[input.wedlyCategory] : undefined;
  return fallback ?? null;
}

/** 못 붙이면 null — 저장은 빈 글자('')로, 화면은 미분류를 grant 쪽 뒤에 두지 않고 「기타」로 세지 않는다(설계: AI 구조화가 나중에 채움). */
export function classifyFundingGroup(input: FundingGroupInput): FundingGroup | null {
  const group = classifyCore(input);
  if (group === "grant" && input.rateText && LOAN_RATE_RE.test(input.rateText.trim())) return "policy";
  return group;
}
