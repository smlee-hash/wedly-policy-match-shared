// 추천 판정·단계(NO.585, 2026-10-26 대표 요청 「정책추천 순서 및 확인 필요 공고 추천 개선」).
//
// 예전 판정(recommend-score.fitVerdictOf + match-engine.strictFitBlock)은 「모르는 문장이 하나라도 있으면 맞음 금지」였다.
// 그래서 성진섬유(서울 도봉구·양말 임가공·7명)에 지원 가능 0건·확인 필요 5,534건이 나왔다. 지역·업종이 다른 공고도
// 「확인 필요」에 섞였다.
// 이 판정은 공고마다 세 갈래로 나눈다.
//  · 안 맞음(excluded) — 지역(시도·시군구)·업종·확인된 조건이 다르다. 행사·포상·채용·교육생 모집처럼 지원금이 아닌 글도 여기다.
//  · 확인 필요(unverified) — 어긋난 것은 없지만 고객 정보로 못 가리는 조건이 남았다. 남은 것을 「확인할 것」으로 짧게 적는다.
//    고칠 수 있는 걸림돌(체납·인증·특허)만 어긋나면 안 맞음이 아니라 걸림돌로 둔다.
//  · 지원 가능(fit) — 확인할 조건이 모두 고객 정보로 확인됐고 어긋난 것이 없다.
// 단계: 1 무상(자부담 없음) · 2 자부담 있음 · 3 융자·보증·투자 · 4 걸림돌 · 5 확인 필요. 같은 단계 안은 마감 순(정렬은 funding-map).
import { companyScaleVerdict, declaredScaleVerdict, scaleFactOf, type ScaleVerdict } from "./company-scale";
import {
  businessAgeYears,
  canonicalRegion,
  corporationOf,
  NON_PROGRAM,
  sidosInText,
  type BusinessProfile,
} from "./match-engine";
import { relatedFamiliesOf, sectorFamiliesInTitle, sectorFamiliesOfIndustry } from "./sector";
import { sigunguInText, sigunguSido } from "./sigungu";
import { orgRegionsOf, sourceRegionOf, type SourceRegion } from "./source-region";
import type { AnnouncementStructure, ConditionCheck, IndustryScope } from "./structure-types";
import type { FitVerdict } from "./recommend-score";
import {
  GENERIC_TO_CHECK,
  INDUSTRY_SCOPE_UNKNOWN,
  REGION_SCOPE_UNKNOWN,
  SCOPE_UNKNOWN_TO_CHECK,
  toCheckWeight,
} from "../funding/funding-map";

export type EligibilityStep = 1 | 2 | 3 | 4 | 5;

export const STEP_LABELS: Record<EligibilityStep, string> = {
  1: "무상 지원",
  2: "자부담 있음",
  3: "융자·보증",
  4: "걸림돌 있음",
  5: "확인 필요",
};

/**
 * 확인 필요 줄의 단계 — 걸림돌만 남았으면 4(걸림돌 있음), 확인할 것이 하나라도 남았으면 5(확인 필요).
 * 걸림돌과 확인할 것이 함께면 5에 두고 걸림돌은 순서 무게로 뒤에 선다(funding-map `reviewWeight`).
 * 4에 두면 「요구 인증 필요」에 확인할 것까지 수두룩한 공고가 확인 필요 맨 위를 차지했다
 * (NO.585 성진섬유 실측 — 사회적기업·국제공동 R&D 공고 35건이 장위·디지털 전환보다 앞섰다).
 */
export function unverifiedStep(toCheck: readonly string[], obstacles: readonly string[]): 4 | 5 {
  return obstacles.length > 0 && toCheck.length === 0 ? 4 : 5;
}

export interface EligibilityReview {
  verdict: FitVerdict;
  /** 안 맞음이면 null. */
  step: EligibilityStep | null;
  stepLabel: string;
  /** 자부담 글자(무상 지원금만) — 「자부담 원문에 없음」·「자부담 20%」·「부가세 고객 부담」. 융자·투자는 빈 글자. */
  copayText: string;
  /** 고객 정보로 못 가린 조건 — 줄마다 보이는 「확인할 것」(짧은 말, 겹침 없음). */
  toCheck: string[];
  /** 고칠 수 있는 걸림돌(체납·인증·특허). */
  obstacles: string[];
  /** 안 맞음 까닭(사람 말 한 줄). */
  excludeReason?: string;
  /** 안 맞음 까닭이 **출처 기관의 지역뿐**이다 — 같은 공고의 다른 수집본(전국 출처)을 끌어내리지 않게 묶음이 이 사본을 버린다. */
  excludedBySourceOnly?: boolean;
  /**
   * 안 맞음 까닭이 **지역뿐**이다(출처·창구 지역, 「광주광역시 소재」 같은 지역 문장) — 상품이 같은 이름·기관의 전국 공고를
   * 끌어내리지 않게 한다. 묶음이 사본을 버리는 `excludedBySourceOnly` 와 다르다(내용 지역 문장은 그 공고 자체의 조건이다).
   */
  excludedByPlaceOnly?: boolean;
}

/** 내용이 아니라 「정리가 덜 됐다」는 뜻의 확인할 것 — 같은 공고 다른 수집본의 판정을 내리는 근거로 쓰지 않는다(정본은 funding-map). */
export { GENERIC_TO_CHECK, INDUSTRY_SCOPE_UNKNOWN, REGION_SCOPE_UNKNOWN, SCOPE_UNKNOWN_TO_CHECK, toCheckWeight };

export interface EligibilityInput {
  kind: "announcement" | "product";
  /** 갈래(grant·policy·guarantee·bank·urgent·invest). */
  group: string;
  title: string;
  source?: string;
  profile: BusinessProfile;
  now: Date;
  /** matchAnnouncement / checkCondition 결과. */
  checks: readonly ConditionCheck[];
  /** 공고의 사람 확인 문장(AI 정리). */
  humanCheckTexts?: readonly string[];
  structure?: Pick<AnnouncementStructure, "industryScope" | "regionScope" | "supportAmountText" | "benefitSummary"> & {
    aiSummary?: AnnouncementStructure["aiSummary"];
  };
  /** AI 정리가 끝나지 않은 공고(규칙 추출본). */
  ruleOnly?: boolean;
  amountText?: string;
  /** 손 등록 상품 — 창구 안내에 기계로 못 읽은 조건이 남아 있다. */
  manualProduct?: boolean;
  /** 상품의 창구·기관, 공고의 주관기관 이름(앞쪽이 먼저) — 「전남신용보증재단」처럼 지역 기관이면 그 지역 상품·공고다(NO.585 운영 QA). */
  placeOrgs?: readonly string[];
}

/* ───────── 글자 도우미 ───────── */

const compact = (s: string) => s.replace(/\s+/g, "");

function shortText(s: string, max = 22): string {
  // 앞의 목록 기호(「1.」·「가)」·「(2)」·「①」)만 지운다 — 「1년 미만」·「5인 이상」의 숫자는 남긴다.
  const t = s
    .replace(/^(?:[\s□■○●◦▶▷※*·-]+|\d{1,2}[.)](?!\d)\s*|[가-하][.)]\s*|\(\d{1,2}\)\s*|[①-⑳]\s*)+/, "")
    .replace(/\s+/g, " ")
    .trim();
  const chars = Array.from(t);
  return chars.length > max ? `${chars.slice(0, max).join("")}…` : t;
}

/** 고객 시도·믿을 수 있는 시군구. */
function customerPlace(p: BusinessProfile): { sido: string | null; sigungu: string | null } {
  const sido = canonicalRegion(p.region) ?? (p.regionSigungu ? sigunguSido(p.regionSigungu)?.sido ?? null : null);
  const sg = p.regionSigungu ? sigunguSido(p.regionSigungu) : null;
  const sigungu = sg && (!sido || sg.sido === sido || sg.formerSido === sido) ? sg.name : null;
  return { sido, sigungu };
}

/** 대학·연구원 이름의 지역 낱말(「서울대」·「부산대학교」)은 지역 제한이 아니다. */
const INSTITUTION_REGION = /(서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주|경상|전라|충청)\s*(?:대학교|대학|대(?![가-힣])|과학기술원|과기원)/g;
/** 지역 이름처럼 읽히지만 지역이 아닌 말 — 「환경기술」의 경기, 「대전환」·「R&D 대전」·「수산대전」(앞말에 붙은 대전), 「세종과학」, 「경기 침체」. */
const PLACE_NOISE =
  /환경기|대전환|(?<=[가-힣A-Za-z&])대전(?![광시])|(?:R&D|알앤디)\s+대전|세종\s*(?:과학|문화|대왕|학당|도서)|경기\s*(?:침체|회복|변동|둔화|부양|활성화|불황|악화|장|일정|결과|규칙)/g;

/** 지역 조건 문장이 그 시군구 밖도 받는다는 말 — 「○○구 외」·「○○구 등」·「인근·인접」·「제외」(「종로구·동대문구」 나열은 아니다). */
const OTHER_SIGUNGU_TOO = /[구군시]\s*(?:외(?!국)|등(?![록급]))|제외|인근|인접|근처|주변/;
/** 그 지역에 사업장·주소가 있어야 한다는 말 — 「광주광역시 소재」·「경상남도에서 사업 중인」·「주민등록이 되어 있고 거주」. */
const PLACE_REQUIRED = /소재|주소|본사|본점|사업장|거주|주민\s*등록|사업\s*중|영위/;
/** 지역 문장 안 맞음 까닭의 머리말. */
const OTHER_PLACE_REASON = "다른 지역 대상";
/** 지역 때문에 빠졌다는 까닭 — 「다른 지역 대상(…)」·「다른 지역 공고(…)」·「다른 지역 기관 상품(…)」. */
const PLACE_REASON = /^다른 지역/;
/** 적힌 지역 말고 다른 곳도 받는다는 말 — 「광주 및 타 지역」·「전국」. */
const OTHER_PLACE_TOO = /타\s*(?:지역|시\s*[·ㆍ]?\s*도)|전국/;
/** 「서울 외」와 「서울」을 함께 받는다는 말 — 「서울 및 서울 외 지역」·「수도권 외 지역 포함」. */
const BOTH_PLACES = /포함|모두|및|까지/;
/**
 * 지역 이름 바로 뒤의 「외·이외·밖」 — 「수도권 외 지역」·「서울 이외」·「광주 밖」. 셋째 묶음은 「지역·소재」가 바로 이어지는
 * 「○○ 외 지역에 소재」꼴이다(「서울 외에 경기 소재 기업도」는 아니다). 「해외」·「제외」·「외국」·「외식」은 앞말·뒷말로 거른다.
 */
const AFTER_PLACE_OUTSIDE = /([가-힣]+)\s*(이외|(?<!제)외|밖)(?![국부래식과곽])(\s*(?:의|에)?\s*(?:지역|소재|시\s*[·ㆍ]?\s*도|곳))?/g;

/** 읽힌 지역의 짧은 이름(「광주」·「성북구」) — 안 맞음 까닭에 쓴다. */
function placeLabel(read: PlaceRead): string {
  return shortText([...read.sigungus.map((s) => s.name), ...read.sidos].join("·"), 16);
}

/** 권역 낱말 → 시도. */
const REGION_GROUPS: Array<readonly [RegExp, readonly string[]]> = [
  [/비\s*수도권/, ["부산", "대구", "광주", "대전", "울산", "세종", "강원", "충북", "충남", "전북", "전남", "경북", "경남", "제주"]],
  [/수도권/, ["서울", "경기", "인천"]],
  [/충청권/, ["대전", "세종", "충북", "충남"]],
  [/호남권/, ["광주", "전북", "전남"]],
  [/대경권/, ["대구", "경북"]],
  [/동남권/, ["부산", "울산", "경남"]],
  [/영남권/, ["부산", "대구", "울산", "경북", "경남"]],
];

interface PlaceRead {
  sidos: string[];
  sigungus: Array<{ name: string; sido: string }>;
}

/** 글자 안의 지역 — 시군구를 먼저 떼고 시도를 읽는다. 권역 낱말(수도권 …)도 시도로 편다. */
function placesIn(text: string): PlaceRead {
  const masked = (text ?? "").replace(INSTITUTION_REGION, " ").replace(PLACE_NOISE, " ");
  const sigungus = sigunguInText(masked);
  let rest = sigungus.reduce((t, s) => t.split(s.name).join(" "), masked);
  const sidos = new Set<string>();
  for (const [re, list] of REGION_GROUPS) {
    if (re.test(rest)) {
      list.forEach((s) => sidos.add(s));
      rest = rest.replace(new RegExp(re.source, "g"), " ");
    }
  }
  // 낱말마다 따로 읽는다 — 띄어쓰기를 지우고 읽으면 「과제 주관」이 「제주」가 된다.
  for (const word of rest.split(/[\s,·ㆍ()[\]{}「」『』<>《》/|~\-:;'"“”‘’]+/)) {
    for (const s of sidosInText(word)) sidos.add(s);
  }
  return { sidos: [...sidos], sigungus };
}

/**
 * 「○○ 외」로 적힌 지역 — 그 지역이 빠진다는 뜻이다. 앞말이 지역이 아니면(「그 외」·「해외」) 없는 것으로 본다.
 * `only`는 「○○ 외 지역에 소재」처럼 바깥만 받는 꼴, `rest`는 「○○ 외」를 뺀 나머지 글자다.
 */
function outsidePlacesIn(text: string): { read: PlaceRead; only: boolean; rest: string } | null {
  const sidos = new Set<string>();
  const sigungus: PlaceRead["sigungus"] = [];
  let only = false;
  let rest = text ?? "";
  for (const m of (text ?? "").matchAll(AFTER_PLACE_OUTSIDE)) {
    const read = placesIn(m[1]);
    if (read.sidos.length === 0 && read.sigungus.length === 0) continue;
    read.sidos.forEach((s) => sidos.add(s));
    sigungus.push(...read.sigungus);
    if (m[3]) only = true;
    rest = rest.split(m[0]).join(" ");
  }
  if (sidos.size === 0 && sigungus.length === 0) return null;
  return { read: { sidos: [...sidos], sigungus }, only, rest };
}

type PlaceVerdict = "match" | "differ" | "none" | "unknown-customer";

/**
 * 읽힌 지역이 고객과 맞는가. 시군구가 적혔으면 시군구로, 아니면 시도로 본다.
 * 같은 시도의 다른 시군구만 적혔고 고객 시군구를 모르면 「unknown-customer」(확인할 것).
 */
function comparePlaces(read: PlaceRead, p: BusinessProfile): PlaceVerdict {
  if (read.sidos.length === 0 && read.sigungus.length === 0) return "none";
  const mine = customerPlace(p);
  if (!mine.sido) return "unknown-customer";
  const sameSidoSg = read.sigungus.filter((s) => s.sido === mine.sido);
  if (sameSidoSg.length > 0) {
    if (!mine.sigungu) return "unknown-customer";
    return sameSidoSg.some((s) => s.name === mine.sigungu) ? "match" : "differ";
  }
  if (read.sidos.includes(mine.sido)) return "match";
  return "differ";
}

/* ───────── 혜택이 아닌 글 ───────── */

/** 행사·포상·대회·채용·교육생 모집·시설 이용요금 감면 — 지원금·융자가 아닌 글(대표 요청 2절). */
const NON_BENEFIT =
  /(?:기초|실무|역량\s*강화|입문|심화|창업)\s*교육|교육\s*(?:과정|일정|신청\s*안내|프로그램)|아카데미|공청회|발표회|설명회|세미나|포럼|컨퍼런스|콘퍼런스|간담회|토론회|워크숍|시상식|포상|표창|경진\s*대회|경연\s*대회|대회|공모전|챔피언십|어워즈|어워드|교육생|수강생|훈련생|연수생|교육\s*참가자|참가자\s*모집|매칭\s*데이|네트워킹|데모\s*데이|이용\s*요금|사용료\s*감면|요금\s*감면|감면\s*안내|대관|행사\s*(?:개최|안내|운영)|기념식|수여식|발대식|출범식|개소식|준공식|기공식|축제|박람회\s*(?:개최|안내)|채용\s*(?:공고|박람회|설명회|안내)|(?:직원|신규|경력|정규직|계약직|기간제|인턴|직원\s*공개)\s*(?:채용|모집)/;
/** 혜택을 주는 공고 — 위 낱말이 있어도 남긴다(참가 지원·부스 지원·참여·채용·입주 기업 모집·지원금). */
const BENEFIT_HINT = /참가\s*(?:지원|기업|업체|비)|(?:참여|채용|수요|협약|입주)\s*(?:기업|업체)\s*모집|부스|출품|지원\s*사업|지원금|바우처|보조금|장려금|융자|보증|사업비|입점|판로|수출\s*(?:지원|바우처|보험|상담회\s*참가)/;

/** 사업을 **운영·심사하는 쪽**을 뽑는 글 — 제목에 「지원사업」이 있어도 지원 대상 공고가 아니다. 보조사업자는 받는 쪽이라 뺀다. */
const OPERATOR_RECRUIT =
  /(?:자문|심사|평가|전문|운영)\s*위원\s*(?:모집|위촉|공모|선정)|(?:강사|멘토|전문가|컨설턴트|자문단|지원단)\s*(?:모집|위촉|공모|풀\s*모집)|(?:수행|운영|위탁|주관|전담)\s*(?:기관|단체)\s*(?:모집|공모|선정|재공모)|(?:수행|공급)\s*(?:기업|업체|사)\s*(?:모집|공모|선정|등록)|운영자\s*(?:선정|모집)|관리\s*위탁|채용\s*시험|경력\s*경쟁|공무원\s*(?:채용|임용|시험)/;

/** 인가·예고·이의신청 같은 행정 알림 — 신청해 받는 지원이 없다. */
const NOTICE_ONLY =
  /(?:변경|설립|등록|영업|선박\s*투자업)\s*인가|인가\s*(?:신청\s*사실\s*)?공고|이의\s*신청|(?:행정|입법)\s*예고|고시\s*(?:개정|제정|일부\s*개정)|지정\s*고시|보상\s*계획\s*공고|계획\s*예고|선보인다|선보여|밝혔다|현안\s*보고|결정\s*내용\s*공개|(?:지구|개발|실시)\s*계획\s*(?:\(\d+차\)\s*)?(?:변경\s*)?(?:\(\d+차\)\s*)?승인|지형\s*도면|도로\s*구역|당선작|미술\s*대전|일정\s*변경\s*(?:공지|안내)|부스\s*배치도|(?:임원|상임\s*이사|비상임\s*(?:이사|감사)|감사|심판관)[^,]{0,10}(?:공개\s*)?(?:모집|임용)|경계\s*변경/;

/** NON_PROGRAM 의 구인 글 모양 낱말 — 아래 고용지원금 말과 함께 있으면 지원사업이다. */
const HIRING_WORDS = /(?:직원|신규|경력|정규직|계약직)\s*채용|채용\s*공고/g;
/** 고용지원금 공고의 말(「신규직원 채용 지원사업」·「정규직 채용 장려금」·「신규채용 인건비 지원」). */
const HIRING_BENEFIT = /채용\s*(?:지원|장려)|인건비|장려금|지원금|보조금/;

export function nonBenefitReason(title: string): string | null {
  const t = title ?? "";
  if (!t) return null;
  if (NOTICE_ONLY.test(t)) return "지원사업 공고가 아닌 글";
  // 채용 말만 걸렸고 고용지원금 말이 있으면 살린다(리뷰 review-29a732f5 P2 — 실제 고용지원 공고가 숨었다).
  const hiringAid = /채용/.test(t) && HIRING_BENEFIT.test(t) && !NON_PROGRAM.test(t.replace(HIRING_WORDS, " "));
  if (NON_PROGRAM.test(t) && !hiringAid) return "지원사업 공고가 아닌 글";
  if (OPERATOR_RECRUIT.test(t)) return "운영기관·위원·강사 모집 글";
  if (NON_BENEFIT.test(t) && !BENEFIT_HINT.test(t) && !hiringAid) return "행사·포상·채용·교육 모집 글";
  return null;
}

/* ───────── 문장 분류 ───────── */

export type TextJudgement =
  | { kind: "ignore" }
  | { kind: "pass" }
  | { kind: "fail"; reason: string }
  | { kind: "obstacle"; label: string }
  | { kind: "check"; label: string };

const IGNORE: TextJudgement = { kind: "ignore" };
const PASS: TextJudgement = { kind: "pass" };
const check = (label: string): TextJudgement => ({ kind: "check", label });

/** 빼는 말 — 결격·제외 문장. */
const EXCLUDING = /아니어야|아니여야|아닐\s*것|아닌\s*(?:자|기업|업체|사업자|경우|곳)|않은\s*(?:자|기업|업체)|않아야|제외|불가|배제|제한|금지|해당\s*(?:시|하는\s*경우|되는\s*경우)|결격|지원\s*대상이\s*아님/;
/** 결격 상태·행위(고객이 대개 해당 없음 — 표시만, 2026-09-24 사장님 결정과 같은 줄). */
const DISQUALIFIER =
  /휴\s*[·ㆍ.,]?\s*폐업|폐업|휴업|체납|부도|신용\s*불량|연체|채무\s*불이행|파산|회생|영업\s*정지|행정\s*처분|제재|참여\s*제한|허위|부정|부적격|이해\s*관계|중복\s*(?:지원|수혜|신청|참여)|불건전|사행|유흥|사치|향락|투기|퇴폐|도박|무신고|무등록|횡령|사회적\s*물의|임금\s*체불|산재\s*다발|적정하지|적합하지|목적에\s*(?:맞지|부합하지)|구상\s*채권|특수\s*채권|관리\s*종결|대위\s*변제|신용\s*관리|금융\s*질서|국세|지방세|4대\s*보험|보험료|대기업|중견기업|상장|계열사|공공기관|공기업|비영리|협회|단체|외국\s*기관|국제\s*기관|다단계|풍속|청소년\s*유해|성매매|훈련\s*기관|금융\s*(?:및|·)?\s*보험업|부동산\s*(?:업|임대)/;
/**
 * 그 자체로 결격 **상태**인 말 — 「④ 파산·회생절차 개시」처럼 제외 낱말 없이 나열돼도 결격 목록이다. 고객은 대개 해당 없어
 * 표시하지 않는다(체납은 고객이 체납이면 걸림돌). 기관·단체 낱말은 대상 선언일 수 있어 여기 넣지 않는다.
 */
const DISQUALIFIER_STATE =
  /휴\s*[·ㆍ.,]?\s*폐업|폐업|휴업|체납|부도|신용\s*불량|연체|채무\s*불이행|파산|회생|영업\s*정지|행정\s*처분|제재|참여\s*제한|허위|부정\s*(?:수급|사용|행위|한|하게|당)|부적격|불건전|사행|유흥|향락|투기|도박|무등록|횡령|사회적\s*물의|임금\s*체불|구상\s*채권|대위\s*변제|금융\s*질서|자본\s*(?:전액\s*)?잠식|부채\s*비율|외부\s*감사|결산\s*감사|감사\s*의견|외국\s*(?:법령|법인)|특수\s*관계|신용\s*회복|워크\s*아웃|채무\s*조정|불량\s*거래|법정\s*관리|청산|해산|적합하지\s*(?:아니|않)|목적에\s*(?:맞지|부합하지|적합하지)|채무\s*불이행자|모방|도용|표절|(?:권리|재산권)\s*(?:침해|분쟁)|이해\s*관계(?:인|가|자)|징역|금고\s*(?:이상|의)|(?:선고|집행)\s*유예|실형|복권되지|피성년|피한정/;
/** 연구개발 과제의 기관·인력 요건(국가연구개발혁신법 …) — 한 줄로 묶는다. */
const RND_REQUIREMENT =
  /국가\s*연구\s*개발|연구\s*개발\s*기관|주관\s*연구|공동\s*연구|연구\s*책임자|인건비\s*계상|기초\s*연구\s*진흥|연구\s*개발\s*혁신법|기업\s*부설\s*연구|연구\s*전담\s*부서|연구\s*소/;
/** 「소공인특화지원센터」·「소상공인시장진흥공단」처럼 규모 낱말로 시작하는 기관 이름 — 규모 조건이 아니다. */
const SCALE_INSTITUTION =
  /(?:소상공인|소공인|중소\s*(?:벤처\s*)?기업)\s*(?:시장\s*진흥\s*공단|진흥\s*공단|진흥원|특화\s*지원\s*센터|지원\s*센터|센터|벤처\s*기업부|중앙회|기술\s*정보\s*진흥원|유통\s*센터|정책\s*자금|연합회|협회|24|(?:부|청)(?![가-힣]))/g;
/** 「상 시 근 로 자」처럼 글자마다 띄운 말을 붙인다. */
function despace(text: string): string {
  return text.replace(/(?:[가-힣]\s){2,}[가-힣](?![가-힣])/g, (m) => m.replace(/\s+/g, ""));
}

/** 절차·서류·지원 내용 안내 — 자격이 아니다. */
const PROCEDURE =
  /문의처|연락처|담당자|전화|날인|한국\s*표준\s*산업\s*분류|홈페이지|누리집|신청\s*(?:방법|기간|기한|절차|서류|시\s|접수|하기)|접수\s*(?:방법|기간|처)|제출|구비\s*서류|첨부|서식|본인\s*인증|직접\s*신청|온라인\s*(?:접수|신청)|이수|수료|선정\s*(?:평가|절차|방법|후|시|된|기업은)|평가|심사|예산|매년|소진|지급|결제|계좌|정산|증빙|환수|취소|위배|위\s*[·ㆍ]?\s*변조|제재\s*조치|지원\s*(?:내용|규모|금액|한도|항목|범위|비율|기간|방법|절차|조건\s*:)|최대\s*[\d,.]+|[\d,.]+\s*(?:만\s*원|억\s*원|천\s*원|원)\s*(?:이내|한도|까지)|이내\s*(?:지원|까지)|한하여\s*(?:지원|지급)|대표\s*1\s*명|1\s*개(?:의)?\s*사업자|공동\s*사업자|공동\s*대표|우대|가점|우선\s*(?:선정|지원)|협약|사후\s*관리|의무|보고서|모니터링|훈련\s*교사|직무|훈련\s*(?:과정|내용|시간)|키오스크|장애인\s*차별|동시에\s*지원|외국인\s*사업자|일시불|할부|명의|이행\s*(?:항목|비용|완료)|컨설팅\s*완료|솔루션|교육\s*\(|교육을\s*(?:받|이수)|참석|발표\s*평가|현장\s*(?:실사|점검)|자세한\s*(?:사항|내용)|공고문\s*참조|붙임|별첨|첨부\s*파일|개인\s*정보|동의서|수집\s*[·ㆍ]?\s*이용|로그인|로그아웃|회원\s*(?:구분|가입|정보|사로|으로)|일반\s*회원|관리자\s*상태|선정\s*기준|지원\s*대상과\s*동일|수탁|위탁|제안서|접수\s*장소|도착|무효|행한\s*신청|RFP|러닝\s*타임|항공|숙소|보증금\s*납입|입주\s*계약/;
/** 기관에 물어야 아는 조건 — 「기관 문의」. */
const ASK_AGENCY = /(?:상이|다르므로|다름|별도\s*(?:공고|안내)|센터별|기관별|지역별|사업별|세부\s*(?:내용|사항))[^.。]*문의|문의\s*(?:바람|요망|필요|후\s*신청)/;
const AGE = /만\s*(\d{2})\s*세\s*(이상|이하|미만|초과)|(\d{2})\s*세\s*(이상|이하|미만|초과)/;
const YOUTH = /청년\s*(?:창업자|대표|사업자|기업)|(?:대표자?|창업자|신청인)\s*(?:가|이)?\s*청년/;
const HISTORY = /(?:지원|수혜|선정|참여|참가|이용)\s*(?:을|를)?\s*(?:받은|받았|받고|된|하였|했|한|중인|이력|한\s*적|경험)|기\s*수혜|수혜\s*(?:기업|자|업체|이력)/;
const CLUSTER = /집적지/;
/** 우대·가점 문장 — 그 안의 나이·청년은 자격이 아니다. */
const PREFERENCE = /우대|가점|우선\s*(?:선정|지원|선발)/;
/** 「단, 비영리 기관 및 공기업(공사)은 적용하지 않음」 — 기업이 아닌 신청자에게만 붙는 예외. */
const NON_BUSINESS_EXCEPTION =
  /^[\s※*·ㅇ○●◦□■▶►\-–]*단\s*[,.]?\s*[^.]{0,40}(?:비영리|공기업|공사\)|공공\s*기관|대학|연구\s*기관|출연\s*연)[^.]{0,30}(?:적용하지|적용\s*(?:제외|안\s*함|되지)|해당하지|예외)/;
const EMPLOYMENT_INSURANCE = /고용\s*보험\s*(?:에\s*)?(?:가입|피보험|적용|성립)/;
const OPERATING = /정상\s*(?:적으로)?\s*(?:영업|운영)|영업\s*(?:중|하고)\s*(?:인|있는)|사업\s*(?:중|영위\s*중)인/;
const BIZ_REGISTERED = /사업자\s*등록(?:증)?\s*(?:을|이|상)?\s*(?:보유|있는|소지|필수|된|한)/;
const SCALE_WORDS = /우선\s*지원\s*대상\s*기업|중소\s*기업|소상공인|소공인|소기업|중기업|중견\s*기업|창업\s*기업/g;
const FOUNDED_DATE =
  /(?:개업|설립|창업|사업자\s*등록|사업\s*개시)\s*(?:일|일자|일이|일자가)?[^0-9]{0,8}(\d{4}|['’‘]\d{2})\s*[년.\-/]\s*(\d{1,2})\s*(?:[월.\-/]\s*(\d{1,2})\s*일?)?\s*(?:\(?[가-힣]\)?)?\s*(이전|이후|부터|까지|전|후|以前)/;
const BUSINESS_AGE = /업력\s*(\d{1,2})\s*년\s*(이상|이하|미만|이내|초과)/;
/** 「A 또는 B」처럼 갈래가 여럿인 조건 — 한 갈래가 어긋나도 다른 갈래로 맞을 수 있다. */
const EITHER = /또는|이거나|혹은|중\s*(?:하나|어느|1개)/;
const WORKERS = /(?:상시\s*)?(?:근로자|종업원|직원|고용\s*인원)[^0-9]{0,20}(\d{1,4})\s*(?:명|인)\s*(미만|이하|이상|초과)/;
const CORP_ONLY = /법인\s*(?:사업자)?\s*(?:만|에\s*한)/;
const INDIVIDUAL_ONLY = /개인\s*사업자\s*(?:만|에\s*한)/;
const CORP_EXCLUDED = /법인\s*(?:사업자)?\s*(?:은|는)?\s*(?:제외|불가)/;
const INDIVIDUAL_EXCLUDED = /개인\s*사업자\s*(?:은|는)?\s*(?:제외|불가)/;
const CERT_KIND = /벤처\s*기업|이노비즈|메인비즈|인증\s*(?:기업|보유)|여성\s*기업|장애인\s*기업|사회적\s*기업|예비\s*사회적|마을\s*기업|자활\s*기업|협동\s*조합|소셜\s*벤처|백년\s*가게|착한\s*가격|가족\s*친화|강소\s*기업|뿌리\s*기업|수출\s*(?:기업|실적)|R&D|연구\s*소|전담\s*부서|특허|직무\s*발명|기술\s*평가/;

/** 고객 업종의 구체 낱말(양말·니트 …) — 넓은 말(제조업·서비스업)은 뺀다. 제외 업종 목록 대조에만 쓴다. */
const GENERIC_INDUSTRY_WORDS = new Set(["제조업", "제조", "가공", "임가공", "가공업", "서비스업", "서비스", "도소매업", "도매업", "소매업", "기타", "업", "및", "사업"]);
function specificIndustryWords(industry: string | undefined): string[] {
  return (industry ?? "")
    .split(/[^가-힣A-Za-z]+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 2 && !GENERIC_INDUSTRY_WORDS.has(w));
}

function industryInList(text: string, p: BusinessProfile): boolean {
  const words = specificIndustryWords(p.industry);
  const t = compact(text);
  return words.some((w) => t.includes(w)) || broadIndustryListed(text, p);
}

/** 목록 낱말 가르개 — 쉼표·가운뎃점·따옴표·괄호·「및/와/과」. 띄어쓰기로는 가르지 않는다(「불건전 영상게임기 제조업」은 한 낱말). */
const LIST_ITEM_SPLIT = /[,，、;·ㆍ"“”'‘’「」『』()（）[\]/\n]|\s(?:및|와|과|또는)\s/;
/**
 * 고객의 넓은 업종(제조업·서비스업 …)이 원문 목록에 낱말 하나로 따로 서 있나 — 「농업 및 임업, 어업, 광업, 제조업 …을 제외한 업종」.
 * 넓은 말은 긴 업종 이름의 꼬리(「불건전 영상게임기 제조업」)로는 세지 않는다. 사업전환자금이 서울 양말 제조 고객에게 업종 「맞음」·
 * 지원 가능으로 떴다(NO.585 운영 QA 4차).
 */
function broadIndustryListed(text: string, p: BusinessProfile): boolean {
  const broad = (p.industry ?? "").split(/[^가-힣A-Za-z]+/).filter((w) => w.length >= 3 && w.endsWith("업") && GENERIC_INDUSTRY_WORDS.has(w));
  if (broad.length === 0) return false;
  const items = text.split(LIST_ITEM_SPLIT).map((s) => compact(s).replace(/(?:등|을|를)$/, ""));
  return broad.some((w) => items.includes(w));
}

const YEAR_NOW_CACHE = new Map<number, RegExp>();
function thisYearRe(now: Date): RegExp {
  const y = now.getFullYear();
  let re = YEAR_NOW_CACHE.get(y);
  if (!re) {
    re = new RegExp(`(?:${y}|['’‘]${String(y).slice(2)})\\s*년|올해|금년|당해\\s*(?:연도|년도)`);
    YEAR_NOW_CACHE.set(y, re);
  }
  return re;
}

function historyLabel(text: string, now: Date): string {
  if (thisYearRe(now).test(text)) {
    const place = placesIn(text).sidos[0];
    return place ? `올해 ${place}${place.length === 2 && !/도$/.test(place) ? "시" : ""} 지원 이력` : "올해 같은 사업 지원 이력";
  }
  return "지원 이력(같은 사업 수혜 여부)";
}

function ageLabel(text: string): string {
  const m = text.match(AGE);
  const n = m ? m[1] ?? m[3] : "";
  const cmp = m ? m[2] ?? m[4] : "";
  const employeeAge = /근로자|직원|채용|고용|인력|구직|청년\s*(?:을|를)/.test(text) && !/대표/.test(text);
  return employeeAge ? `직원 나이 조건(만 ${n}세 ${cmp})` : `대표자 만 ${n}세 ${cmp}`;
}

function parseFoundedLimit(m: RegExpMatchArray, now: Date): { date: Date; before: boolean } | null {
  let year = m[1];
  if (/^['’‘]/.test(year)) year = `20${year.slice(1)}`;
  const y = Number(year);
  const mo = Number(m[2]);
  const d = m[3] ? Number(m[3]) : 1;
  if (!Number.isFinite(y) || y < 1950 || y > now.getFullYear() + 2 || mo < 1 || mo > 12) return null;
  const before = /이전|까지|전|以前/.test(m[4]);
  return { date: new Date(Date.UTC(y, mo - 1, d)), before };
}

function compareNumber(value: number, limit: number, cmp: string): boolean {
  switch (cmp) {
    case "미만":
      return value < limit;
    case "이하":
    case "이내":
      return value <= limit;
    case "초과":
      return value > limit;
    default:
      return value >= limit;
  }
}

/** 「5인 이상 50인 미만」·「3년 이상 ~ 7년 이하」의 두 번째 경계 — 첫 경계 바로 뒤에서만 읽는다. */
const SECOND_BOUND = /^\s*(?:~|∼|-|–)?\s*(\d{1,4})\s*(?:명|인|년)?\s*(미만|이하|이상|초과|이내)/;

function secondBoundOf(first: RegExpMatchArray, text: string): RegExpMatchArray | null {
  return text.slice((first.index ?? 0) + first[0].length).match(SECOND_BOUND);
}

/** 범위 문장은 두 경계를 다 본다(리뷰 review-29a732f5 P2 — 첫 경계만 보고 상한 밖 고객을 통과시켰다). */
function withinRange(value: number, first: RegExpMatchArray, text: string): boolean {
  if (!compareNumber(value, Number(first[1]), first[2])) return false;
  const second = secondBoundOf(first, text);
  return !second || compareNumber(value, Number(second[1]), second[2]);
}

function rangeLabel(first: RegExpMatchArray, text: string, unit: string): string {
  const second = secondBoundOf(first, text);
  return `${first[1]}${unit} ${first[2]}${second ? ` ${second[1]}${unit} ${second[2]}` : ""}`;
}

/**
 * 조건 문장 하나 → 판단. `negated` 는 AI 가 「아니어야 하는 것」(other eq false)으로 정리한 조건이다.
 * 고객 정보로 가릴 수 있으면 pass/fail, 결격·안내면 ignore, 그 밖은 짧은 「확인할 것」.
 */
export function judgeRequirementText(
  raw: string,
  p: BusinessProfile,
  now: Date,
  opts: { negated?: boolean } = {},
): TextJudgement {
  const text = despace((raw ?? "").trim());
  if (!text) return IGNORE;
  const negated = opts.negated === true;
  const excluding = negated || EXCLUDING.test(text);

  // 0) 기업이 아닌 신청자(비영리·공기업·대학·연구기관)에게만 붙는 예외 — 기업 고객과 무관하다.
  if (NON_BUSINESS_EXCEPTION.test(text)) return IGNORE;

  // 1) 고객 정보로 못 가리는 양의 요건 — 대표 나이·집적지·지원 이력·기관 문의.
  if (CLUSTER.test(text)) return check("집적지 근처 인정 여부 확인");
  if (AGE.test(text) && !excluding && !PREFERENCE.test(text)) return check(ageLabel(text));
  if (YOUTH.test(text) && !excluding && !PREFERENCE.test(text)) return check("대표자 청년(만 39세 이하) 여부");
  if (HISTORY.test(text) && (excluding || /수혜/.test(text)) && !/중복\s*(?:지원|수혜|신청|참여)/.test(text)) {
    return check(historyLabel(text, now));
  }

  // 2) 법인·개인.
  const corp = corporationOf(p);
  if (CORP_EXCLUDED.test(text) || INDIVIDUAL_EXCLUDED.test(text) || CORP_ONLY.test(text) || INDIVIDUAL_ONLY.test(text)) {
    if (corp === null) return check("법인·개인 구분 확인");
    if (CORP_EXCLUDED.test(text) && corp) return { kind: "fail", reason: "법인 제외" };
    if (INDIVIDUAL_EXCLUDED.test(text) && !corp) return { kind: "fail", reason: "개인사업자 제외" };
    if (CORP_ONLY.test(text) && !corp) return { kind: "fail", reason: "법인만" };
    if (INDIVIDUAL_ONLY.test(text) && corp) return { kind: "fail", reason: "개인사업자만" };
  }

  // 3) 지역 낱말 — 고객 지역이 들어 있으면 지역은 문제없다. 다르면 사람 확인.
  const places = placesIn(text);
  const placeVerdict = comparePlaces(places, p);
  const placeMentioned = placeVerdict !== "none";

  // 체납 고객에게 체납 결격 문장은 고칠 수 있는 걸림돌이다(대표 요청 6절 h — 체납 고객).
  if (/체납/.test(text) && p.taxDelinquent === true) return { kind: "obstacle", label: "체납 정리 필요" };

  // 4) 결격·제외 문장 — 고객 업종이 제외 목록에 들면 확인, 지역 제외면 확인, 그 밖은 표시만.
  if (excluding) {
    if (/업종|업\s*\(|영위/.test(text) && industryInList(text, p)) return check("제외 업종 해당 여부");
    if (placeMentioned && !PROCEDURE.test(text) && placeVerdict !== "differ") {
      // 「서울 소재 기업 제외」처럼 고객 지역을 빼는 문장.
      if (placeVerdict === "match" && /소재|주소|본사|사업장/.test(text)) return check("지역 제외 조건 확인");
    }
    // 고객 정보로 알 수 없는 사실 — 짧은 말로 묻는다.
    if (/카드\s*매출/.test(text)) return check("카드 매출 여부");
    if (DISQUALIFIER.test(text) || DISQUALIFIER_STATE.test(text) || negated) return IGNORE;
    if (PROCEDURE.test(text)) return IGNORE;
    // 무엇을 빼는지 모르는 제외 문장 — 대상 범위(직무·품목·과제)를 좁히는 말이 대부분이다.
    if (/직무|과제|품목|항목|비용|경비|사업비|용도|훈련|교육|구매|지출/.test(text)) return IGNORE;
    return check(`제외 조건: ${shortText(text)}`);
  }

  // 4-1) 다른 지역에 사업장·주소를 둔 기업만 받는 문장 — 규모(소상공인 …)가 맞아도 지역이 먼저다(NO.585 운영 QA:
  //  「광주광역시 소재 소기업·소상공인」이 서울 회사에 「지원 가능」으로 떴다). 우대·절차 문장과 「인근·○○구 외·타 지역」은 빼지 않는다.
  //  「○○ 외 지역 소재」는 거꾸로 읽는다 — 그 지역 고객만 빠지고, 다른 지역 고객은 지역 때문에 빠지지 않는다(리뷰 review-fca5517e).
  if (PLACE_REQUIRED.test(text) && !PREFERENCE.test(text) && !PROCEDURE.test(text)) {
    const outside = outsidePlacesIn(text);
    if (outside) {
      const onlyOutside = outside.only && !BOTH_PLACES.test(text) && comparePlaces(placesIn(outside.rest), p) !== "match";
      if (onlyOutside && comparePlaces(outside.read, p) === "match") {
        return EITHER.test(text) ? check("지역 조건 확인") : { kind: "fail", reason: `${OTHER_PLACE_REASON}(${placeLabel(outside.read)} 밖)` };
      }
    } else if (placeVerdict === "differ" && !OTHER_SIGUNGU_TOO.test(text) && !OTHER_PLACE_TOO.test(text)) {
      return EITHER.test(text) ? check("지역 조건 확인") : { kind: "fail", reason: `${OTHER_PLACE_REASON}(${placeLabel(places)})` };
    }
  }

  // 5) 고객 정보로 가릴 수 있는 것.
  // 「매출 5천만원 이하 또는 근로자 5인 미만」 — 한 갈래가 어긋나도 다른 갈래로 맞을 수 있으니 빼지 않고 확인할 것으로 둔다.
  const failOr = (reason: string): TextJudgement => (EITHER.test(text) ? check(`${reason} 또는 다른 기준`) : { kind: "fail", reason });
  const founded = text.match(FOUNDED_DATE);
  if (founded) {
    const lim = parseFoundedLimit(founded, now);
    if (lim) {
      if (!p.foundedDate) return check("설립일 입력");
      const t = Date.parse(p.foundedDate);
      if (Number.isFinite(t)) {
        const ok = lim.before ? t <= lim.date.getTime() : t >= lim.date.getTime();
        return ok ? PASS : failOr(`개업일 조건(${founded[0].trim()})`);
      }
    }
  }
  const bizAge = text.match(BUSINESS_AGE);
  if (bizAge) {
    const age = businessAgeYears(p.foundedDate, now);
    if (age == null) return check("설립일 입력");
    return withinRange(age, bizAge, text) ? PASS : failOr(`업력 ${rangeLabel(bizAge, text, "년")}`);
  }
  // 소상공인 정의(제조업 10명·그 밖 5명) — 업종별 기준이 둘 다 적힌 문장.
  if (/10\s*명/.test(text) && /5\s*명/.test(text) && /근로자|직원|종업원/.test(text)) {
    const fact = scaleFactOf("소상공인", { ...p, lastYearRevenueKrw: 0 }, now);
    if (fact === "yes") return PASS;
    if (fact === "no") return { kind: "fail", reason: "상시근로자 기준 초과" };
    return check(p.employeeCount == null ? "직원 수 입력" : "상시근로자 기준 확인");
  }
  const workers = text.match(WORKERS);
  if (workers) {
    if (p.employeeCount == null) return check("직원 수 입력");
    return withinRange(p.employeeCount, workers, text) ? PASS : failOr(`상시근로자 ${rangeLabel(workers, text, "명")}`);
  }
  if (/소기업\s*(?:규모\s*)?기준|매출\s*액?\s*(?:등이)?\s*소기업/.test(text)) {
    const fact = scaleFactOf("소기업", p, now);
    if (fact === "yes") return PASS;
    if (fact === "no") return failOr("소기업 매출 기준 초과");
    return check(p.lastYearRevenueKrw == null ? "연매출 입력" : "소기업 매출 기준 확인");
  }
  const scaleNames = [...new Set((text.replace(SCALE_INSTITUTION, " ").match(SCALE_WORDS) ?? []).map(compact))];
  if (EMPLOYMENT_INSURANCE.test(text)) {
    if (p.employeeCount == null) return check("직원 수 입력");
    if (p.employeeCount < 1) return check("고용보험 가입 여부");
    if (scaleNames.length === 0) return PASS;
  }
  if (scaleNames.length > 0) {
    const v = companyScaleVerdict(scaleNames, p, now);
    if (v.verdict === "pass") return PASS;
    if (v.verdict === "fail") return failOr(`대상: ${scaleNames.join("·")}`);
    return check(`기업 규모: ${v.unknownNames.join("·")}`);
  }
  if (OPERATING.test(text)) return PASS;
  if (BIZ_REGISTERED.test(text)) return p.bizno ? PASS : check("사업자 등록 여부");

  // 6) 결격 나열·기관 문의·연구개발 요건·인증 종류.
  if (DISQUALIFIER_STATE.test(text)) return IGNORE;
  if (ASK_AGENCY.test(text)) return check("기관 문의");
  if (RND_REQUIREMENT.test(text) && !PROCEDURE.test(text)) return check("R&D 수행 요건(연구소·연구 인력)");
  if (CERT_KIND.test(text) && !PROCEDURE.test(text)) {
    const kind = text.match(CERT_KIND)?.[0]?.replace(/\s+/g, "") ?? "인증";
    return check(`${kind} 해당 여부`);
  }

  // 7) 지역만 말하는 문장.
  if (placeMentioned) {
    if (placeVerdict === "match") return PASS;
    if (PROCEDURE.test(text)) return IGNORE;
    return placeVerdict === "unknown-customer" ? check("소재지 확인") : check("지역 조건 확인");
  }

  // 8) 절차·안내.
  if (PROCEDURE.test(text)) return IGNORE;
  if (/문의/.test(text)) return IGNORE;

  return check(`조건 확인: ${shortText(text)}`);
}

/**
 * 고객 정보로 못 가리는 요건(집적지·대표 나이·청년 대표) — 다른 조건(기업 규모 …)이 통과시킨 원문이나 그 원문과 겹친
 * 사람 확인 문장 안에 섞여 있어도 꺼낸다. 「집적지 내 또는 인근 소공인」은 소공인이 맞아도 집적지가 남는다.
 */
function profileBlindLabels(raw: string): string[] {
  const text = despace(raw ?? "");
  if (!text.trim()) return [];
  const excluding = EXCLUDING.test(text);
  const out: string[] = [];
  if (CLUSTER.test(text)) out.push("집적지 근처 인정 여부 확인");
  if (AGE.test(text) && !excluding && !PREFERENCE.test(text)) out.push(ageLabel(text));
  if (YOUTH.test(text) && !excluding && !PREFERENCE.test(text)) out.push("대표자 청년(만 39세 이하) 여부");
  return out;
}

/* ───────── 조건 다시 보기 ───────── */

/** 고칠 수 있는 걸림돌 — fail 이어도 안 맞음이 아니라 걸림돌로 둔다. */
const OBSTACLE_LABEL: Record<string, string> = {
  noTaxDelinquency: "체납 정리 필요",
  certRequired: "요구 인증 필요",
  patentRequired: "특허 필요",
};

const MISSING_FIELD = /^(.+?)\s*미입력/;

function missingLabel(note: string): string | null {
  const m = note.match(MISSING_FIELD);
  if (m) return `${m[1]} 입력`;
  if (/사업자번호로 법인 여부/.test(note)) return "법인·개인 구분 확인";
  return null;
}

function valuesOf(c: ConditionCheck): string[] {
  const v: unknown = c.condition.value;
  return (Array.isArray(v) ? v : [v]).filter((x) => x != null).map((x) => String(x));
}

/** 제외 업종 목록으로 정리된 업종 조건인가(값이 결격 업종·원문이 「제한·제외」). */
const EXCLUDED_INDUSTRY_WORDS = /유흥|사행|도박|성매매|풍속|부동산|무도|골프|청소년|투기|사치|향락|다단계|공공기관|공기업|비영리|협회|단체|훈련기관|금융|보험|주점|안마|증기탕|담배|주류|기관|법무|회계|세무|의료|약국/;
/**
 * 제외 말이 아닌 낱말(NO.585 운영 QA 3차) — 「제외국(諸外國)」·「조세특례제한법」 같은 법 이름, 「업력 제한 없음」,
 * 대상을 못 박는 「○○로 제한」, 「해당 시·군 소재」.
 */
const NOT_EXCLUDING = /제외국|[가-힣]*제한법(?!인)|제한\s*(?:이\s*)?없|(?:으로|로)\s*제한|해당\s*시\s*[·ㆍ･]?\s*[군도구]/g;
/** 괄호 한 겹 — 「TAC 참여 어업인(단, 제주도 … 제외)」처럼 대상 업종 안에서 일부를 덜어 내는 자리. */
const PAREN_PART = /[(（][^()（）]*[)）]/g;
/** 괄호가 이름표뿐인 자리 — 「숙박업, 부동산업(지원 제외 업종)」의 괄호는 앞 값이 제외 업종이라는 표시다(리뷰 P2). */
const LABEL_ONLY = /^[\s*※·,]*(?:지원\s*)?(?:제외|불가|배제|제한|금지)(?:\s*(?:업종|대상|업체|기업|분야))?[\s*※·,]*$/;
/** 「단, …」·「다만 …」 꼬리절 — 문장 끝까지가 덜어 내는 자리다(「제조업 영위 중소기업, 단 유흥업 등은 제외」). */
const PROVISO_PART = /(?<![가-힣])(?:단|다만)(?:\s*[,，:]|\s)[^.。\n]*/g;

/** 덜어 내는 자리를 지운 본문 — 괄호는 안쪽부터 되풀이해 두 겹도 지운다(리뷰 P3). 이름표 괄호는 글만 남긴다. */
function mainClause(text: string): string {
  let s = text;
  for (let prev = ""; s !== prev; ) {
    prev = s;
    s = s.replace(PAREN_PART, (m) => (LABEL_ONLY.test(m.slice(1, -1)) ? ` ${m.slice(1, -1)} ` : " "));
  }
  return s.replace(PROVISO_PART, " ");
}

/** 값 바로 뒤에 「만」·「에 한」이 붙은 한정 절인가 — 「제조업에 한하며 유흥업 제외」. 「다만」·「5천만 원」·「중소기업에 한함」은 아니다. */
function valueOnlyClause(raw: string, values: readonly string[]): boolean {
  return values.some((v) => {
    const word = v.trim();
    const at = word.length >= 2 ? raw.indexOf(word) : -1;
    if (at < 0) return false;
    const tail = raw.slice(at + word.length, at + word.length + 12).split(/[,，.。·ㆍ;\n()（）]/)[0];
    return /^[가-힣\s]{0,8}?(?:만(?![가-힣]|\s*원)|에\s*한)/.test(tail);
  });
}

/** 누구나 해당하는 대상 말 — 본문에 이것만 남으면 업종은 덜어 낸 자리에만 적혔다(「모든 중소기업(단, 도소매업 제외)」). */
const GENERIC_SUBJECT = /모든|전체|국내|중소|중견|소상공인|소기업|기업|업체|사업자|신청|자격|대상|지원|[^가-힣A-Za-z]/g;

/**
 * 제외 말이 덜어 내는 자리(괄호·「단/다만」 꼬리절)에만 있는 업종 조건의 값을 가른다 — 본문에 든 값, 덜어 낸 자리에만 든 값.
 * 원문 어디에도 없는 AI 정리 값(「영농」)은 어느 쪽에도 넣지 않는다. 그런 꼴이 아니면(값 한정 절·본문의 제외 말·제외 말
 * 없음) null.
 */
function removedPartValues(c: ConditionCheck): { inBody: string[]; inRemoved: string[]; genericBody: boolean } | null {
  const raw = (c.condition.rawText ?? "").replace(NOT_EXCLUDING, " ");
  const values = valuesOf(c);
  if (valueOnlyClause(raw, values)) return null;
  const body = mainClause(raw);
  if (EXCLUDING.test(body) || !EXCLUDING.test(raw)) return null;
  const bodyText = compact(body);
  const rawText = compact(raw);
  const found = (text: string, v: string) => compact(v).length >= 2 && text.includes(compact(v));
  return {
    inBody: values.filter((v) => found(bodyText, v)),
    inRemoved: values.filter((v) => !found(bodyText, v) && found(rawText, v)),
    genericBody: body.replace(GENERIC_SUBJECT, "") === "",
  };
}

/**
 * 업종 조건이 제외 업종 목록(exclusion)인가, 대상 업종 목록(target)인가, 가릴 수 없나(unsure).
 * 제외 말이 괄호·「단, …」 꼬리절 속에만 있고 값이 그 밖 본문에 있으면 대상 업종 안의 덜어 냄이다 — 「식품 수출업체 중
 * 제외국」·「(택배기사와 택시기사 제외)」를 제외 목록으로 읽어 다른 업종 공고가 「업종 맞음」·지원 가능으로 떴다(NO.585 운영 QA 3차).
 * 제외 말 없이 결격 낱말(의료기기·금융기관)만 걸리면 AI 가 업종 범위를 「전체」라 한 공고만 제외 목록이다. 「특정 업종만」·
 * 「모름」·범위 없음이면 어느 쪽인지 모른다 — 대상 목록으로 넘기면 사전으로 읽히는 결격 업종(부동산·숙박)이 다른 업종 고객을
 * 잘못 빼므로 확인으로 둔다.
 */
function industryListKind(c: ConditionCheck, industryScope?: IndustryScope): "exclusion" | "target" | "unsure" {
  const raw = (c.condition.rawText ?? "").replace(NOT_EXCLUDING, " ");
  const values = valuesOf(c);
  if (!valueOnlyClause(raw, values) && EXCLUDING.test(mainClause(raw))) return "exclusion";
  const part = removedPartValues(c);
  if (part) {
    // 제외 말이 덜어 내는 자리에만 있으면 값이 어디 적혔는지로 가린다. 본문에 값이 하나라도 있으면 대상 업종 목록이다 —
    // 덜어 낸 자리의 값이 더 많아도(「제조업 영위 중소기업(단, 유흥·사행성 업종 제외)」) 본문이 대상을 적었다(리뷰 P2).
    // 「본문 값이 절반 이하」로 세던 판은 「실제 농업에 이용되는 농지. 다만 … 제외」(값 농업·영농)를 제외 목록으로 읽어
    // 양말 제조 고객에게 업종 「맞음」을 냈다(NO.585 운영 QA 4차). 본문에 값이 없으면 덜어 낸 자리에서 값을 찾았거나
    // 본문이 누구나 해당하는 말(「모든 중소기업」)뿐일 때만 제외 목록이고, 원문 어디에도 없는 AI 정리 값만 있는데 본문에
    // 다른 글(「실제 경작하는 농가」)이 있으면 어느 쪽인지 모른다(리뷰 P2).
    if (part.inBody.length > 0) return "target";
    return part.inRemoved.length > 0 || part.genericBody ? "exclusion" : "unsure";
  }
  const hits = values.filter((v) => EXCLUDED_INDUSTRY_WORDS.test(v)).length;
  if (values.length > 0 && hits * 2 >= values.length) return industryScope === "all" ? "exclusion" : "unsure";
  return "target";
}

/** 업종 조건 값 「제조업」 → 「제조」가 고객 업종에 있으면 맞다. */
function industryValueMatches(value: string, p: BusinessProfile): boolean {
  const mine = compact(p.industry ?? "");
  if (!mine) return false;
  const v = compact(value);
  if (!v) return false;
  if (mine.includes(v)) return true;
  const stem = v.replace(/(?:업종|업체|업)$/, "");
  return stem.length >= 2 && mine.includes(stem);
}

/** 누구나 해당하는 기업 대상 값(「국내 기업」·「사업자」). */
const GENERIC_BUSINESS_ORG = /^(?:국내\s*|민간\s*|일반\s*)?(?:기업|업체|사업자|사업주|기업체|개인\s*사업자|법인\s*사업자|영리\s*기업|영리\s*법인)$/;
/** 기업이 아닌 대상 — 학교·대학(원)·비영리·단체·기관·농어업인·개인(사람). */
const NON_BUSINESS_ORG =
  /대학|학교|학과|비영리|민간\s*단체|단체|협회|재단|지자체|지방\s*자치|공공\s*기관|공기업|연구\s*기관|연구원|훈련\s*기관|교육\s*기관|의료\s*기관|병원|미디어\s*센터|복지|어업자|어업인|농가|농업인|작목반|수협|농협|조합원|기부금|구성원|학생|청소년|구직자|근로자|미취업자|실업자|^개인$/;
const BUSINESS_ORG = /기업|사업자|소상공인|소공인|업체|사업주|창업자|자영업|회사|법인/;
const NON_BUSINESS_CORP = /비영리\s*법인|사단\s*법인|재단\s*법인|학교\s*법인|의료\s*법인|사회\s*복지\s*법인|농업\s*회사\s*법인|영농\s*조합\s*법인|어업\s*회사\s*법인/g;
function isNonBusinessOrg(value: string): boolean {
  const v = value.trim();
  if (!v) return false;
  const masked = v.replace(NON_BUSINESS_CORP, " 단체 ");
  return NON_BUSINESS_ORG.test(masked) && !BUSINESS_ORG.test(masked);
}

type Outcome =
  | { kind: "pass" }
  | { kind: "ignore" }
  | { kind: "exclude"; reason: string }
  | { kind: "fail"; reason: string }
  | { kind: "obstacle"; label: string }
  | { kind: "check"; label: string };

function regionValuesOutcome(c: ConditionCheck, p: BusinessProfile): Outcome {
  const values = valuesOf(c);
  if (values.some((v) => v.includes("전국"))) return { kind: "pass" };
  const read = placesIn(values.join(" "));
  const verdict = comparePlaces(read, p);
  if (verdict === "match") return { kind: "pass" };
  if (verdict === "differ") return { kind: "exclude", reason: `다른 지역 공고(${shortText(values.join("·"), 16)})` };
  if (verdict === "unknown-customer") return { kind: "check", label: "소재지 확인" };
  return { kind: "check", label: `지역 조건 확인(${shortText(values.join("·"), 16)})` };
}

function scaleOutcome(v: ScaleVerdict, values: readonly string[]): Outcome {
  if (v.verdict === "pass") return { kind: "pass" };
  if (v.verdict === "fail") return { kind: "fail", reason: `대상: ${values.join("·")}` };
  return { kind: "check", label: `기업 규모: ${v.unknownNames.join("·")}` };
}

function reviewCheck(c: ConditionCheck, p: BusinessProfile, now: Date, industryScope?: IndustryScope): Outcome {
  const key = c.condition.key;
  const raw = c.condition.rawText ?? "";
  // 고객이 적은 규모는 글자 겹침이 아니라 포함 관계·직원 수·매출로 본다(리뷰 review-29a732f5 P2 — 「소상공인」 고객의 S-OJT).
  if (key === "companyScale" && c.verdict !== "unknown") {
    const declared = declaredScaleVerdict(valuesOf(c), p, now);
    if (declared) return scaleOutcome(declared, valuesOf(c));
  }
  if (c.verdict === "pass") {
    // 지역 통과라도 원문이 같은 시도의 다른 시군구만 적었으면 다른 지역이다(「서울 성북구 소재」).
    if (key === "region" && c.condition.origin !== "augmented" && (raw || valuesOf(c).length > 0)) {
      const read = placesIn(`${raw} ${valuesOf(c).join(" ")}`);
      const mine = customerPlace(p);
      const sameSidoSg = read.sigungus.filter((s) => s.sido === mine.sido);
      // 「성북구 외」·「도봉구 등」·「인근 지역」처럼 다른 구도 받는 문장만 빼지 않는다(「…기업 등」의 「등」은 아니다).
      if (sameSidoSg.length > 0 && !OTHER_SIGUNGU_TOO.test(raw)) {
        if (!mine.sigungu) return { kind: "check", label: "시군구 확인" };
        if (!sameSidoSg.some((s) => s.name === mine.sigungu)) return { kind: "exclude", reason: `다른 시군구 공고(${sameSidoSg.map((s) => s.name).join("·")})` };
      }
    }
    return { kind: "pass" };
  }
  if (c.verdict === "fail") {
    if (key === "region") return { kind: "exclude", reason: `다른 지역 공고(${shortText(valuesOf(c).join("·"), 16)})` };
    if (key === "targetSector" || key === "industry") return { kind: "exclude", reason: `다른 업종 공고(${shortText(valuesOf(c).join("·"), 16)})` };
    if (OBSTACLE_LABEL[key]) return { kind: "obstacle", label: OBSTACLE_LABEL[key] };
    return { kind: "fail", reason: c.note || "조건이 맞지 않음" };
  }
  // unknown
  if (c.blocksFit) return { kind: "exclude", reason: "다른 시군구 공고" };
  const missing = missingLabel(c.note ?? "");
  switch (key) {
    case "region":
      return missing ? { kind: "check", label: missing } : regionValuesOutcome(c, p);
    case "companyScale": {
      if (p.companyScale) return missing ? { kind: "check", label: missing } : { kind: "check", label: `기업 규모: ${valuesOf(c).join("·")}` };
      return scaleOutcome(companyScaleVerdict(valuesOf(c), p, now), valuesOf(c));
    }
    case "industry": {
      if (missing) return { kind: "check", label: missing };
      const values = valuesOf(c);
      const list = industryListKind(c, industryScope);
      if (list === "exclusion") {
        return values.some((v) => industryValueMatches(v, p)) || industryInList(raw, p)
          ? { kind: "check", label: "제외 업종 해당 여부" }
          : { kind: "pass" };
      }
      if (list === "unsure") return { kind: "check", label: `업종 해당 여부(${shortText(values.join("·"), 14)})` };
      // 덜어 낸 자리의 값(「제조업 영위 중소기업(단, 유흥·사행성 업종 제외)」의 유흥·사행)은 대상 업종이 아니다 — 고객이
      // 그 업종이면 확인, 아니면 본문 값만으로 가린다(리뷰 P2).
      const removed = removedPartValues(c)?.inRemoved ?? [];
      if (removed.some((v) => industryValueMatches(v, p))) return { kind: "check", label: "제외 업종 해당 여부" };
      const targets = values.filter((v) => !removed.includes(v));
      if (targets.some((v) => industryValueMatches(v, p))) return { kind: "pass" };
      // 값이 모두 분야 사전으로 읽히고 읽힌 분야가 모두 고객 분야와 무관하면 다른 업종이다. AI 는 같은 업종을 줄여
      // 적기도 해(「해양수산·해양·수산」) 사전 밖 값이 읽힌 값의 일부이면 읽힌 것으로 본다(NO.585 추가 제보 2026-10-29).
      // 사전 밖 값이 따로 서면(「뷰티·화장품·미용·생활용품·잡화」·「농업·축산·스마트팜」) 그 값이 고객 업종일 수 있어
      // 확인으로 둔다 — 과반만 읽혀도 빼던 판은 양말 제조·IT 고객을 잘못 뺐다(리뷰 P2).
      const mine = sectorFamiliesOfIndustry(p.industry ?? "");
      const fams = targets.map((v) => sectorFamiliesOfIndustry(v));
      const readValues = targets.filter((_, i) => fams[i].length > 0).map((v) => v.replace(/\s+/g, ""));
      const partOfRead = (v: string) => {
        const s = v.replace(/\s+/g, "");
        return s.length >= 2 && readValues.some((r) => r.includes(s));
      };
      if (mine.length > 0 && readValues.length > 0 && targets.every((v, i) => fams[i].length > 0 || partOfRead(v))) {
        const read = fams.flat();
        const all = new Set([...read, ...relatedFamiliesOf(read)]);
        if (!mine.some((m) => all.has(m))) return { kind: "exclude", reason: `다른 업종 공고(${shortText(targets.join("·"), 16)})` };
      }
      return { kind: "check", label: `업종 해당 여부(${shortText(targets.join("·"), 14)})` };
    }
    case "targetSector":
      return missing ? { kind: "check", label: missing } : { kind: "check", label: `업종 해당 여부(${shortText(valuesOf(c).join("·"), 14)})` };
    case "targetOrg": {
      const v: unknown = c.condition.value;
      if (typeof v === "boolean") {
        // AI 가 「대상 자격 문장(참)」·「아니어야 하는 대상(거짓)」으로 정리한 조건 — 문장으로 판정한다.
        const j = judgeRequirementText(raw, p, now, { negated: v === false });
        if (j.kind === "fail") return { kind: "fail", reason: j.reason };
        return j.kind === "obstacle" ? { kind: "obstacle", label: j.label } : j;
      }
      // 값 하나하나를 본다 — 하나라도 이 고객이 해당하면(「기업」·규모 이름 해당) 통과, 모두 아니면 안 맞음.
      const values = valuesOf(c);
      const facts = values.map((x) => {
        if (GENERIC_BUSINESS_ORG.test(x.trim())) return "yes" as const;
        const scale = scaleFactOf(x, p, now);
        if (scale === "yes" || scale === "no") return scale;
        if (scale === null && isNonBusinessOrg(x)) return "nonBusiness" as const;
        return "unknown" as const;
      });
      if (facts.includes("yes")) return { kind: "pass" };
      if (facts.length > 0 && facts.every((f) => f === "nonBusiness")) {
        return { kind: "exclude", reason: `기업 대상 아님(${shortText(values.join("·"), 16)})` };
      }
      if (facts.length > 0 && facts.every((f) => f === "no" || f === "nonBusiness")) {
        return { kind: "exclude", reason: `대상: ${shortText(values.join("·"), 16)}` };
      }
      const unknown = values.filter((_, i) => facts[i] === "unknown");
      return { kind: "check", label: `대상 자격: ${shortText(unknown.join("·"), 20)}` };
    }
    case "certRequired":
    case "patentRequired":
      if (missing) return { kind: "check", label: missing };
      return { kind: "check", label: key === "certRequired" ? "요구 인증 종류 확인" : "요구 특허 종류 확인" };
    case "other": {
      const negated = c.condition.op === "eq" && c.condition.value === false;
      const j = judgeRequirementText(raw, p, now, { negated });
      if (j.kind === "fail") return { kind: "fail", reason: j.reason };
      return j.kind === "obstacle" ? { kind: "obstacle", label: j.label } : j;
    }
    default: {
      if (missing) return { kind: "check", label: missing };
      // 기계로 못 읽은 숫자 조건 — 문장으로 다시 본다.
      const j = judgeRequirementText(raw, p, now);
      if (j.kind === "fail") return { kind: "fail", reason: j.reason };
      if (j.kind === "pass" || j.kind === "ignore") return j;
      return { kind: "check", label: j.kind === "check" ? j.label : `조건 확인: ${shortText(raw)}` };
    }
  }
}

/** 고객 정보(소재지·업종·직원 수·매출)로 가리는 조건 — 화면의 조건 줄도 이 판정의 맞음·안 맞음을 따른다. */
const SETTLED_DISPLAY_KEYS = new Set(["region", "industry", "targetSector", "companyScale"]);
/** AI 가 기계 대조를 끈 조건의 메모 — 무엇을 확인할지 말하지 않는다. */
const MACHINE_OFF_NOTE = /^기계로 판정할 수 없는 조건/;

/**
 * 화면에 보일 조건 줄(NO.585 추가 제보 2026-10-29 배보라 — 상태표에 소재지·업종·직원 수가 있는데 지역·업종·규모 줄이
 * 「직접 확인 — 기계로 판정할 수 없는 조건」·「기업 규모 미입력」으로 남았다). 지역·업종·규모·규모 이름 대상 유형 줄은
 * 이 판정이 맞음·안 맞음을 정했으면 그 결과로 보여 준다. 확인할 것으로 남긴 줄은 확인으로 두되, 메모가 「기계로 판정할 수
 * 없는 조건」이면 판정이 남긴 확인할 것(「업종 해당 여부(…)」 등)으로 바꾼다. 업종 값에 분야 사전 밖 값이 따로 서면
 * 판정이 확인으로 남긴다 — 잘못 빼면 자격 있는 회사를 놓친다.
 * 점수(scoreOf)와 판정은 원래 줄로 계산한다 — 바꾸는 것은 보이는 줄뿐이다.
 * industryScope 는 판정(reviewEligibility)이 받은 공고의 AI 업종 범위와 같은 값을 넘긴다 — 상품은 없다.
 */
export function displayChecks(checks: readonly ConditionCheck[], p: BusinessProfile, now: Date, industryScope?: IndustryScope): ConditionCheck[] {
  return checks.map((c) => {
    const key = c.condition.key;
    const scaleNames = key === "targetOrg" && Array.isArray(c.condition.value);
    if (!SETTLED_DISPLAY_KEYS.has(key) && !scaleNames) return c;
    const o = reviewCheck(c, p, now, industryScope);
    if (o.kind === "pass") return c.verdict === "pass" ? c : { condition: c.condition, verdict: "pass", note: "" };
    if (o.kind === "exclude" || o.kind === "fail") return c.verdict === "fail" ? c : { condition: c.condition, verdict: "fail", note: o.reason };
    // 직원 수·매출이 있는데 규모를 못 가린 줄은 「미입력」이 아니다 — 업종별 기준 사이 값이라 확인이 남은 것이다.
    // 남은 이름이 규모 판정이 모르는 이름(「여성기업」)뿐이면 직원 수·매출과 무관하니 원래 메모를 둔다(리뷰 P3).
    if (key === "companyScale" && !p.companyScale && o.kind === "check" && (p.employeeCount != null || p.lastYearRevenueKrw != null)
      && companyScaleVerdict(valuesOf(c), p, now).unknownNames.some((n) => scaleFactOf(n, p, now) !== null)) {
      return { ...c, note: `직원 수·매출로 못 가림 — ${o.label}` };
    }
    if (o.kind === "check" && MACHINE_OFF_NOTE.test(c.note)) return { ...c, note: o.label };
    return c;
  });
}

/* ───────── 자부담 ───────── */

const COPAY_PERCENT = /(?:자부담|자기\s*부담|본인\s*부담|기업\s*부담|참여\s*기업\s*부담|민간\s*부담)\s*(?:금|비율)?\s*[:：]?\s*(?:총\s*사업비의?\s*)?(\d{1,2}(?:\.\d+)?)\s*%/;
const COPAY_WORD = /자부담|자기\s*부담|본인\s*부담|기업\s*부담금|매칭\s*(?:펀드|자금|비율|투자)|대응\s*자금|민간\s*부담/;
const NO_COPAY = /자부담\s*(?:없음|없이|0\s*%|면제)|자기\s*부담\s*(?:없음|없이)|전액\s*(?:무상|지원)|100\s*%\s*(?:무상\s*)?지원/;
const VAT_ON_CUSTOMER = /부가\s*(?:가치)?\s*세\s*(?:\(?\s*VAT\s*\)?\s*)?(?:는|은)?\s*(?:별도|제외|미포함|불포함|(?:기업|자부담|본인|신청자|참여\s*기업|수혜\s*기업)\s*(?:부담|에서))/;
const SUPPORT_PERCENT = /(?:총\s*)?(?:사업비|비용|소요\s*비용|구입\s*비|구매\s*비|공급\s*가액)\s*의?\s*(\d{2})\s*%\s*(?:이내|까지|를|만)?\s*(?:\(?[^)]{0,12}\)?\s*)?(?:지원|보조)/;

function copayOf(texts: readonly string[]): { copay: boolean; label: string } {
  const all = texts.filter(Boolean).join(" \n ");
  if (!all.trim()) return { copay: false, label: "자부담 원문에 없음" };
  const labels: string[] = [];
  const pct = all.match(COPAY_PERCENT);
  if (pct) labels.push(`자부담 ${pct[1]}%`);
  if (VAT_ON_CUSTOMER.test(all)) labels.push("부가세 고객 부담");
  const sup = all.match(SUPPORT_PERCENT);
  if (labels.length === 0 && sup && Number(sup[1]) < 100) labels.push(`총사업비 ${sup[1]}% 지원(자부담 ${100 - Number(sup[1])}%)`);
  if (labels.length === 0 && COPAY_WORD.test(all) && !NO_COPAY.test(all)) labels.push("자부담 있음(비율 원문 확인)");
  if (labels.length > 0) return { copay: true, label: labels.slice(0, 2).join(" · ") };
  if (NO_COPAY.test(all)) return { copay: false, label: "자부담 없음" };
  return { copay: false, label: "자부담 원문에 없음" };
}

/** 무상 지원금 갈래 안의 융자·보증·카드 공고. */
const LOAN_LIKE = /융자|대출|보증|이차\s*보전|이자\s*(?:지원|보전)|정책\s*자금|자금\s*지원\s*(?:\(융자\)|융자)|카드|리스|투자\s*유치/;

/* ───────── 판정 ───────── */

/** 맞음의 근거가 못 되는 통과(recommend-score 의 isWeakPass 와 같은 줄) — 전국 지역·보탠 지역·법인 여부. */
function isWeakPass(c: ConditionCheck): boolean {
  const key = c.condition.key;
  if (key === "isCorporation") return true;
  if (key === "region") return c.condition.origin === "augmented" || valuesOf(c).some((v) => v.includes("전국"));
  return false;
}

/**
 * 출처·창구가 맡은 지역. 출처가 지역 기관이 아니면 창구·기관 이름을 읽는다 — 서민금융진흥원 출처(product-kinfa)에는
 * 전국 신용보증재단 상품이 다 들어 있고(NO.585 운영 QA), 전국 수집원(보조24)도 제주·부산 신용보증재단 공고를 옮겨 싣는다(운영 QA 2차).
 */
function sourceRegionsOf(input: EligibilityInput): SourceRegion[] {
  const src = sourceRegionOf(input.source);
  if (src) return [src];
  for (const org of input.placeOrgs ?? []) {
    const found = orgRegionsOf(org);
    if (found.length > 0) return found;
  }
  return [];
}

export function reviewEligibility(input: EligibilityInput): EligibilityReview {
  const { profile: p, now } = input;
  const title = input.title ?? "";
  const toCheck: string[] = [];
  const obstacles: string[] = [];
  const addCheck = (label: string) => {
    if (label && !toCheck.includes(label)) toCheck.push(label);
  };
  let excludeReason: string | undefined;
  let excludedByContent = false;
  let excludedBySource = false;
  let excludedByNonPlace = false;
  const exclude = (reason: string, bySource = false) => {
    if (!excludeReason) excludeReason = reason;
    if (bySource) excludedBySource = true;
    else excludedByContent = true;
    if (!bySource && !PLACE_REASON.test(reason)) excludedByNonPlace = true;
  };

  // 1) 혜택이 아닌 글.
  const nb = nonBenefitReason(title);
  if (nb) exclude(nb);

  // 2) 조건 하나하나.
  const resolvedRaw = new Set<string>();
  let aiRegionPass = false;
  /** AI 지역 조건이 「전국」이 아니라 고객 지역을 콕 집어 통과했나 — 그때만 제목의 다른 지역 낱말(행사 장소 등)을 덮는다. */
  let aiRegionNamed = false;
  let anyRegionPass = false;
  let nationwideRegion = false;
  let industryResolved = false;
  /** 업종·지역 조건이 하나라도 있었나 — 있으면 AI 의 「업종·지역 제한」 표시는 그 조건의 확인할 것과 같은 말이다. */
  let sawIndustryCondition = false;
  let sawRegionCondition = false;
  /** 「맞다」를 말할 근거가 되는 통과 — 전국·보탠 지역·법인 여부 통과만으로는 맞음을 주지 않는다. */
  let realPass = 0;
  for (const c of input.checks) {
    const o = reviewCheck(c, p, now, input.structure?.industryScope);
    const raw = compact(c.condition.rawText ?? "");
    if (c.condition.key === "region" && c.condition.origin !== "augmented" && valuesOf(c).some((v) => v.includes("전국"))) nationwideRegion = true;
    if (c.condition.key === "industry" || c.condition.key === "targetSector") sawIndustryCondition = true;
    if (c.condition.key === "region" && c.condition.origin !== "augmented") sawRegionCondition = true;
    switch (o.kind) {
      case "pass":
        if (!isWeakPass(c)) realPass += 1;
        if (raw) resolvedRaw.add(raw);
        for (const label of profileBlindLabels(c.condition.rawText ?? "")) addCheck(label);
        if (c.condition.key === "region") {
          anyRegionPass = true;
          if (c.condition.origin !== "augmented") {
            aiRegionPass = true;
            if (!valuesOf(c).some((v) => v.includes("전국"))) aiRegionNamed = true;
          }
        }
        if (c.condition.key === "industry" || c.condition.key === "targetSector") industryResolved = true;
        break;
      case "ignore":
        if (raw) resolvedRaw.add(raw);
        break;
      case "exclude":
        exclude(o.reason);
        break;
      case "fail":
        exclude(o.reason);
        break;
      case "obstacle":
        if (!obstacles.includes(o.label)) obstacles.push(o.label);
        break;
      case "check":
        addCheck(o.label);
        break;
    }
  }

  // 3) 사람 확인 문장 — 조건과 같은 원문은 조건 판정을 따른다.
  for (const h of input.humanCheckTexts ?? []) {
    const key = compact(h);
    if (!key) continue;
    if ([...resolvedRaw].some((r) => r === key || (r.length >= 12 && key.includes(r)) || (key.length >= 12 && r.includes(key)))) {
      for (const label of profileBlindLabels(h)) addCheck(label);
      continue;
    }
    const j = judgeRequirementText(h, p, now);
    if (j.kind === "fail") exclude(j.reason);
    // 같은 걸림돌(국세·지방세 체납 두 줄 …)은 한 번만 — 겹치면 메모가 반복되고 확인 무게가 부풀어 뒤로 밀린다(리뷰 review-29a732f5 P2).
    else if (j.kind === "obstacle" && !obstacles.includes(j.label)) obstacles.push(j.label);
    else if (j.kind === "check") addCheck(j.label);
  }

  // 4) 제목·출처의 지역.
  //  제목에 다른 지역이 적혔으면 AI 가 「전국」이라 해도 그 지역 공고로 본다(대표 요청 6절 a — 서울 밖 공고가 어느 탭에도 없다).
  //  AI 가 고객 지역을 콕 집어 통과시킨 공고만 제목의 지역 낱말(행사 장소 등)을 무시한다.
  const titleScopeAll = input.structure?.regionScope === "all" || nationwideRegion;
  /** 제목이 고객 지역을 적었나(「[서울] …」) — AI 가 지역 범위를 모른다고 해도 지역은 맞는다. */
  let titleRegionSame = false;
  if (!aiRegionNamed && !/제외|외\s*지역|외\s|아닌|아니|밖|타\s*지역|전국/.test(title)) {
    const v = comparePlaces(placesIn(title), p);
    if (v === "differ") exclude("다른 지역 공고(제목)");
    else if (v === "match") titleRegionSame = true;
    else if (v === "unknown-customer" && !aiRegionPass && !titleScopeAll) addCheck("소재지 확인");
  }
  /** 출처 기관의 지역이 고객 지역과 같다고 확인됐나 — AI 가 지역 범위를 모른다고 해도 그 지역 기관 공고는 지역이 맞는다. */
  let sourceRegionSame = false;
  const srcRegions = aiRegionPass ? [] : sourceRegionsOf(input);
  if (srcRegions.length > 0) {
    const mine = customerPlace(p);
    const noun = input.kind === "product" ? "상품" : "공고";
    // 지역 기관이 맡은 전국 사업도 있다(지역 테크노파크가 주관하는 전국 공모) — 전국 수집원이 옮긴 공고를 주관기관
    // 이름으로 읽었는데 AI 나 제목이 「전국」이라 했으면 빼지 않고 지역 제한을 확인할 것으로 남긴다(리뷰 P2).
    // 지역 수집원(bepa 등)에서 온 공고는 전처럼 출처 지역으로 본다.
    const nationwideAnn = input.kind !== "product" && !sourceRegionOf(input.source) && (titleScopeAll || /전국/.test(title));
    const otherRegion = (where: string) => {
      if (nationwideAnn) addCheck(REGION_SCOPE_UNKNOWN);
      else exclude(`다른 지역 기관 ${noun}(${where})`, true);
    };
    // 창구가 여럿(「강원·전북 신용보증재단」)이면 하나라도 고객 지역이면 맞는다.
    const sameSido = srcRegions.filter((r) => r.sido === mine.sido);
    if (!mine.sido) addCheck("소재지 확인");
    else if (sameSido.length === 0) otherRegion(srcRegions.map((r) => r.sigungu ?? r.sido).join("·"));
    else if (sameSido.some((r) => !r.sigungu)) sourceRegionSame = true;
    else if (!mine.sigungu) addCheck("시군구 확인");
    else if (sameSido.some((r) => r.sigungu === mine.sigungu)) sourceRegionSame = true;
    else otherRegion(sameSido.map((r) => r.sigungu).join("·"));
  }

  // 5) 예비창업자 전용.
  if (/예비\s*창업/.test(title) && !/(?:초기|기|재)\s*창업|창업\s*(?:기업|자\s*및|7년)|기업|사업자|소상공인/.test(title)) {
    const age = businessAgeYears(p.foundedDate, now);
    if (age != null && age > 0) exclude("예비창업자 대상 공고");
    else addCheck("예비창업자 여부");
  } else if (/재\s*창업|재도전/.test(title)) {
    addCheck("재창업·재도전 대상 여부");
  }

  // 6) 제목이 적은 업종 분야(「○○기업」) — 고객 분야와 무관하면 확인할 것.
  const titleFams = sectorFamiliesInTitle(title);
  if (titleFams.length > 0 && !industryResolved) {
    const mine = sectorFamiliesOfIndustry(p.industry ?? "");
    const related = new Set([...titleFams, ...relatedFamiliesOf(titleFams)]);
    if (mine.length === 0 || !mine.some((m) => related.has(m))) addCheck(`업종 해당 여부(${titleFams.join("·")})`);
  }

  // 7) AI 의 범위 판단.
  if (input.structure?.industryScope === "restricted" && !industryResolved && !sawIndustryCondition) addCheck("업종 제한 확인");
  if (input.structure?.regionScope === "restricted" && !aiRegionPass && !anyRegionPass && !sawRegionCondition) addCheck("지역 제한 확인");
  // AI 정리를 마친 공고인데 업종·지역 범위를 「모름」이라 했거나 답하지 않았으면(옛 정리분) 맞음이 아니다(2026-09-24 정밀 맞음 —
  // 제목 글자 규칙만으로는 「굴뚝·악취 배출 사업장」·「선정기업 대상」 같은 대상을 끝까지 못 막았다). 금융상품은 보지 않는다.
  if (input.kind === "announcement" && !input.ruleOnly) {
    const ind = input.structure?.industryScope;
    if (ind !== "all" && ind !== "restricted" && !industryResolved) addCheck(INDUSTRY_SCOPE_UNKNOWN);
    const reg = input.structure?.regionScope;
    const regionKnown = anyRegionPass || nationwideRegion || sourceRegionSame || titleRegionSame;
    if (reg !== "all" && reg !== "restricted" && !regionKnown) addCheck(REGION_SCOPE_UNKNOWN);
  }
  if (input.ruleOnly) addCheck("공고 원문 확인(조건 정리 전)");
  if (input.manualProduct) addCheck("상품 안내 확인");
  if (realPass === 0 && toCheck.length === 0 && obstacles.length === 0) addCheck("자격 조건 원문 확인");

  if (toCheck.some((t) => /^올해 .+ 지원 이력$/.test(t))) {
    const i = toCheck.indexOf("지원 이력(같은 사업 수혜 여부)");
    if (i >= 0) toCheck.splice(i, 1);
  }

  // 8) 단계·자부담.
  const isGrant = input.group === "grant";
  const loanLike = !isGrant || LOAN_LIKE.test(title);
  let copayText = "";
  let benefitStep: EligibilityStep = 3;
  if (isGrant && !loanLike) {
    const s = input.structure;
    const copay = copayOf([
      s?.supportAmountText ?? "",
      s?.aiSummary?.scale ?? "",
      ...(s?.aiSummary?.scaleItems ?? []).map((x) => (typeof x === "string" ? x : JSON.stringify(x))),
      s?.benefitSummary ?? "",
      input.amountText ?? "",
      ...(input.humanCheckTexts ?? []),
    ]);
    copayText = copay.label;
    benefitStep = copay.copay ? 2 : 1;
  }
  const loanLabel = input.group === "invest" ? "투자" : "융자·보증";

  if (excludeReason) {
    return {
      verdict: "excluded", step: null, stepLabel: "", copayText, toCheck, obstacles, excludeReason,
      ...(excludedBySource && !excludedByContent ? { excludedBySourceOnly: true } : {}),
      ...(!excludedByNonPlace ? { excludedByPlaceOnly: true } : {}),
    };
  }
  if (obstacles.length > 0 || toCheck.length > 0) {
    const step = unverifiedStep(toCheck, obstacles);
    return { verdict: "unverified", step, stepLabel: STEP_LABELS[step], copayText, toCheck, obstacles };
  }
  return {
    verdict: "fit",
    step: benefitStep,
    stepLabel: benefitStep === 3 ? loanLabel : STEP_LABELS[benefitStep],
    copayText,
    toCheck,
    obstacles,
  };
}
