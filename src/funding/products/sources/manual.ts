/**
 * 손 등록 명부 — 정찰로 「JS 라우팅이라 못 긁거나, 창구 안내뿐이라 상품 한 건으로 못 뽑는 것」만
 * 코드 상수로 담는다(설계 2026-09-03 §3, 계획서 Task 14). 정찰 결론:
 *  · 창업진흥원 「융자」 목록 — JS `fn_goView` 로만 열리고, 내용도 결국 중진공 정책자금(kosmes) 안내와
 *    같아 놓쳐도 손실 0. 등록하지 않는다.
 *  · KVIC 엔젤투자매칭펀드·모태펀드 — 조합(펀드) 규모만 정적으로 나오고 기업이 보는 개별 조건이
 *    페이지에 없어 자동 파서를 만들 수 없다. 아는 값만 손으로 적는다.
 *  · 신용보증기금·기술보증기금·지역신용보증재단 상시 보증 「창구」 — 상품 낱개가 아니라 창구
 *    안내뿐이라 한도·금리를 못 뽑는다. 대상·한도는 정직하게 비워 두고 창구 주소만 안내한다.
 *
 * ★회차(`SOURCES`)에는 넣지 않는다 — 절대 실패하지 않는 상수 출처가 하나 끼면 「전부 실패 되감기」
 * 안전장치가 항상 "성공 1건 이상"으로 보여 영구히 무력화된다(계획서 리뷰 대장 #4 치명). 그래서
 * `registry.ts` 의 `PRODUCT_SOURCES` 에도 싣지 않는다 — 지도 조립(`funding-map-build.ts`, Task 16)이
 * `MANUAL_PRODUCTS` 를 상수로 직접 합친다. 같은 이유로 수집원 명부(`source-directory.ts`)에도
 * 이 항목만의 줄을 만들지 않는다 — 사연은 그 파일의 주석에 note 로만 남는다.
 */
import type { NormalizedProduct } from "../types";

/** `NormalizedProduct` 에서 `source`·`raw` 만 빼고, 사람이 마지막으로 확인한 날짜를 더한 모양. */
export type ManualProductInput = Omit<NormalizedProduct, "source" | "raw"> & {
  /** YYYY-MM-DD — 사람이 마지막으로 링크·조건을 확인한 날짜(자동 수집이 아니라 값이 자동 갱신되지 않는다). */
  verifiedAt: string;
};

export const MANUAL_PRODUCTS: ManualProductInput[] = [
  {
    sourceId: "angel-matching-fund",
    fundingGroup: "invest",
    institution: "한국벤처투자(KVIC)",
    institutionType: "invest",
    name: "엔젤투자매칭펀드",
    productType: "equity",
    targetText:
      "개인 엔젤투자자로부터 투자를 받은 창업기업(업력 7년 이내) — 엔젤투자 금액만큼 정부 재원이 매칭 투자",
    targetRules: { bizAgeMaxYears: 7 },
    limitText: "엔젤투자액의 1~2배 매칭",
    limitMaxWon: null,
    rateText: "지분 투자",
    rateMin: null,
    rateMax: null,
    feeText: "",
    termText: "",
    channel: "한국벤처투자(KVIC) 누리집",
    applyUrl: "https://www.kvic.or.kr/about-business/investment-business/angel-mother-fund",
    detailUrl: "https://www.kvic.or.kr/about-business/investment-business/angel-mother-fund",
    deadlineText: "상시",
    verifiedAt: "2026-09-03",
  },
  {
    sourceId: "mother-fund-fof",
    fundingGroup: "invest",
    institution: "한국벤처투자(KVIC)",
    institutionType: "invest",
    name: "모태펀드 출자 초기펀드",
    productType: "equity",
    targetText:
      "정부 출자로 결성된 벤처투자조합(VC 운용사)을 통해 간접 투자를 받는 창업·벤처기업 — 조합마다 대상·단계·조건이 달라 운용사에 개별 확인이 필요",
    targetRules: {},
    limitText: "",
    limitMaxWon: null,
    rateText: "지분 투자",
    rateMin: null,
    rateMax: null,
    feeText: "",
    termText: "",
    channel: "한국벤처투자(KVIC) 누리집",
    applyUrl: "https://www.kvic.or.kr",
    detailUrl: "https://www.kvic.or.kr",
    deadlineText: "상시",
    verifiedAt: "2026-09-03",
  },
  {
    sourceId: "kodit-guarantee-window",
    fundingGroup: "guarantee",
    institution: "신용보증기금",
    institutionType: "guarantee",
    name: "신용보증기금 보증 창구",
    productType: "guarantee",
    targetText: "재단·기금별 보증상품은 창구 안내 참조",
    targetRules: {},
    limitText: "",
    limitMaxWon: null,
    rateText: "보증료 별도",
    rateMin: null,
    rateMax: null,
    feeText: "",
    termText: "",
    channel: "신용보증기금 누리집·지점",
    applyUrl: "https://www.kodit.co.kr",
    detailUrl: "https://www.kodit.co.kr",
    deadlineText: "상시",
    verifiedAt: "2026-09-03",
  },
  {
    sourceId: "kibo-guarantee-window",
    fundingGroup: "guarantee",
    institution: "기술보증기금",
    institutionType: "guarantee",
    name: "기술보증기금 보증 창구",
    productType: "guarantee",
    targetText: "재단·기금별 보증상품은 창구 안내 참조",
    targetRules: {},
    limitText: "",
    limitMaxWon: null,
    rateText: "보증료 별도",
    rateMin: null,
    rateMax: null,
    feeText: "",
    termText: "",
    channel: "기술보증기금 누리집·지점",
    applyUrl: "https://www.kibo.or.kr",
    detailUrl: "https://www.kibo.or.kr",
    deadlineText: "상시",
    verifiedAt: "2026-09-03",
  },
  {
    sourceId: "local-credit-guarantee-window",
    fundingGroup: "guarantee",
    institution: "지역신용보증재단(전국 16곳)",
    institutionType: "guarantee",
    name: "지역신용보증재단 보증 창구",
    productType: "guarantee",
    targetText: "재단·기금별 보증상품은 창구 안내 참조",
    targetRules: {},
    limitText: "",
    limitMaxWon: null,
    rateText: "보증료 별도",
    rateMin: null,
    rateMax: null,
    feeText: "",
    termText: "",
    channel: "신용보증재단중앙회 누리집 → 지역별 재단 안내",
    applyUrl: "https://www.koreg.or.kr",
    detailUrl: "https://www.koreg.or.kr",
    deadlineText: "상시",
    verifiedAt: "2026-09-03",
  },
];

/** 상수를 `NormalizedProduct` 모양으로 — `source` 는 고정 "manual", `verifiedAt` 은 `raw` 로 옮긴다. */
export async function fetchManualAll(): Promise<NormalizedProduct[]> {
  return MANUAL_PRODUCTS.map(({ verifiedAt, ...rest }): NormalizedProduct => ({
    ...rest,
    source: "manual",
    raw: { verifiedAt },
  }));
}
