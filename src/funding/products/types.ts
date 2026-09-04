/**
 * 자금 조달 지도 — 상시 상품(접수기간이 없는 돈)의 공통 모양(설계 2026-09-03 §3).
 * 공고(PolicyAnnouncement)와 달리 마감이 없고 창구가 상시 열려 있는 돈을 여기에 담는다:
 * 은행 사업자대출·정책자금·보증·서민금융·투자.
 *
 * 원천마다 글의 모양이 제각각이라 어댑터(sources/*.ts)가 이 모양으로 바꿔 놓고,
 * 저장소(product-store.ts)는 이 모양만 안다.
 */
import type { FundingGroup } from "../funding-group";

/** 돈을 내주는 곳의 성격 — 갈래(fundingGroup) 를 정하는 데도 쓰인다(은행 계열이면 무조건 bank). */
export type InstitutionType =
  | "bank"
  | "internet-bank"
  | "savings-bank"
  | "capital"
  | "policy"
  | "guarantee"
  | "microfinance"
  | "local-gov"
  | "invest";

/** 돈의 형태. 빈 글자는 「원천이 안 알려 줌」 — 지어내지 않는다. */
export type ProductType =
  | "credit"
  | "overdraft"
  | "secured"
  | "guarantee-backed"
  | "direct-loan"
  | "agency-loan"
  | "guarantee"
  | "interest-subsidy"
  | "grant"
  | "equity"
  | "insurance"
  | "";

/** 사람이 읽는 대상 글(targetText)과 별개로, 기계가 대조할 수 있는 조건만 담는다. 비면 전부 「확인 필요」. */
export interface ProductTargetRules {
  region?: string[];            // 시도 줄임말(서울·부산…) 또는 「전국」
  bizAgeMinYears?: number;
  bizAgeMaxYears?: number;
  creditScoreMin?: number;
  creditScoreMax?: number;      // 신용취약 상품(「NCB 839 이하」)
  revenueMaxKrw?: number;
  employeesMax?: number;
  industry?: string[];
  scale?: string[];             // 중소기업|소상공인|중견기업|예비창업자
  isCorporation?: boolean;
  hasExistingLoan?: boolean;    // true = 대환(기존 대출 있어야)
  representativeAgeMax?: number; // 프로필에 나이 칸이 없다 — 항상 「확인 필요」로만 쓰인다
  /** 기계로 못 재는 필수 조건 원문 — 예: 「폐업(예정) 소상공인」「운영사 추천 필요」「신용평점 하위 20%」.
   *  rulesToConditions 가 항목마다 key:"other"+machineReadable:false 조건으로 덧붙인다(원문을
   *  버리지 않는다 — F3, 2026-09-03 코덱스 리뷰: 비구조 필수조건이 통째로 사라지고 있었다). */
  humanCheck?: string[];
}

/** 어댑터가 내놓는 상품 한 건. DB 칸(FinanceProduct)과 이름을 맞춘다. */
export interface NormalizedProduct {
  source: string;
  sourceId: string;
  fundingGroup: FundingGroup;
  institution: string;
  institutionType: InstitutionType;
  name: string;
  productType: ProductType;
  targetText: string;
  targetRules: ProductTargetRules;
  limitText: string;
  limitMaxWon: number | null;
  rateText: string;
  rateMin: number | null;
  rateMax: number | null;
  feeText: string;
  termText: string;
  channel: string;
  applyUrl: string;
  detailUrl: string;
  deadlineText: string;         // "상시" | "예산 소진 시" | "YYYY-MM-DD" | 원문
  raw: unknown;
  /** 이번 회차엔 상세를 못 받아 목록 값만으로 채웠다는 표식(코덱스 지적 2026-09-03) — 저장소는
   *  이 표식이 있으면 기존 행이 있을 때 값 칸(한도·금리 등)을 빈 값으로 덮지 않고 lastSeenAt·active
   *  만 갱신한다. 값을 정말로 새로 확인했을 때는 붙이지 않는다(붙이지 않으면 그대로 갱신). */
  keepExisting?: true;
}

/** 수집원 하나. 회차(sync)가 이 모양만 보고 돌린다. */
export interface ProductSource {
  id: string;
  label: string;
  url: string;                  // 명부에 보일 대표 주소
  fetchAll: () => Promise<NormalizedProduct[]>;
}
