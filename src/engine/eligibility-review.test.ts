// 추천 판정·단계(NO.585) 회귀 시험 — 행사 글 빼기, 업종·지역 범위 「모름」, 기준 공고 고정본.
// 고정본 공고 셋(S-OJT·장위 의류봉제·서울 중장년 디지털 전환)은 운영 AI 정리본에서 판정에 쓰는 칸만 옮겼다.
// 고객은 성진섬유와 같은 모양(서울 도봉구·양말 임가공 제조·7명·체납 없음)으로 지어낸 값이다.
import { describe, expect, it } from "vitest";
import {
  displayChecks,
  INDUSTRY_SCOPE_UNKNOWN,
  nonBenefitReason,
  REGION_SCOPE_UNKNOWN,
  reviewEligibility,
  SCOPE_UNKNOWN_TO_CHECK,
  toCheckWeight,
  unverifiedStep,
  type EligibilityInput,
} from "./eligibility-review";
import { checkCondition, matchAnnouncement, readStoredStructure, type BusinessProfile } from "./match-engine";
import { withRegionConditions } from "./region-augment";
import type { ConditionCheck, StructuredCondition } from "./structure-types";

const NOW = new Date("2026-10-26T07:00:00Z");

const SOCKS: BusinessProfile = {
  bizno: "123-45-67890",
  industry: "제조업(임가공, 양말)",
  region: "서울",
  regionSigungu: "도봉구",
  employeeCount: 7,
  foundedDate: "2000-05-01",
  lastYearRevenueKrw: 600_000_000,
  taxDelinquent: false,
  hasCert: false,
  hasPatent: false,
};

/** 고객 정보로 확인된 진짜 통과 하나 — 「맞다」의 근거(규모). */
const SCALE_PASS: ConditionCheck = {
  condition: { key: "companyScale", op: "in", value: ["소상공인"], rawText: "소상공인", machineReadable: true },
  verdict: "pass",
  note: "",
};

function base(over: Partial<EligibilityInput> = {}): EligibilityInput {
  return {
    kind: "announcement",
    group: "grant",
    title: "2026년 소상공인 경영 개선 지원사업 모집 공고",
    source: "bizinfo",
    profile: SOCKS,
    now: NOW,
    checks: [SCALE_PASS],
    structure: { industryScope: "all", regionScope: "all", supportAmountText: "", benefitSummary: "" },
    ...over,
  };
}

describe("nonBenefitReason — 행사·안내 글은 지원금 공고가 아니다(NO.585 2절)", () => {
  it.each([
    "2026 우수기업 현판 수여식 개최",
    "중소기업 주간 기념식 안내",
    "청년 서포터즈 발대식",
    "○○ 창업지원센터 개소식",
    "스마트공장 준공식",
  ])("행사 글 「%s」는 뺀다", (title) => {
    expect(nonBenefitReason(title)).toBe("행사·포상·채용·교육 모집 글");
  });

  it.each(["2026 판로 박람회 일정 변경 공지", "수출 상담회 부스 배치도 안내"])("안내 글 「%s」는 뺀다", (title) => {
    expect(nonBenefitReason(title)).toBe("지원사업 공고가 아닌 글");
  });

  it.each([
    "2026 해외 전시회 참가기업 모집",
    "국제 섬유 박람회 부스 지원 사업",
    "우수기업 현판 제작 지원 안내",
    "체계적 현장훈련(S-OJT) 지원사업",
  ])("혜택을 주는 「%s」는 남긴다", (title) => {
    expect(nonBenefitReason(title)).toBeNull();
  });
});

describe("업종·지역 범위를 AI 가 「모름」이라 한 공고는 지원 가능이 아니다", () => {
  it("범위를 둘 다 안다고 했고 규모가 맞으면 지원 가능", () => {
    const r = reviewEligibility(base());
    expect(r.verdict).toBe("fit");
    expect(r.toCheck).toEqual([]);
  });

  it.each([
    ["모른다고 답함", { industryScope: "unknown" as const, regionScope: "all" as const }],
    ["답하지 않음(옛 정리분)", { regionScope: "all" as const }],
  ])("업종 범위 %s → 확인 필요 「업종 제한 여부 확인」", (_name, scope) => {
    const r = reviewEligibility(base({ structure: { supportAmountText: "", benefitSummary: "", ...scope } }));
    expect(r.verdict).toBe("unverified");
    expect(r.step).toBe(5);
    expect(r.toCheck).toEqual([INDUSTRY_SCOPE_UNKNOWN]);
  });

  it("업종 조건이 고객 업종과 맞아 통과했으면 업종 범위를 몰라도 묻지 않는다", () => {
    const industryPass: ConditionCheck = {
      condition: { key: "industry", op: "in", value: ["제조업"], rawText: "제조업 영위 기업", machineReadable: true },
      verdict: "pass",
      note: "",
    };
    const r = reviewEligibility(
      base({ checks: [SCALE_PASS, industryPass], structure: { industryScope: "unknown", regionScope: "all", supportAmountText: "", benefitSummary: "" } }),
    );
    expect(r.toCheck).not.toContain(INDUSTRY_SCOPE_UNKNOWN);
    expect(r.verdict).toBe("fit");
  });

  it("지역 범위를 모르면 「지역 제한 여부 확인」", () => {
    const r = reviewEligibility(base({ structure: { industryScope: "all", regionScope: "unknown", supportAmountText: "", benefitSummary: "" } }));
    expect(r.verdict).toBe("unverified");
    expect(r.toCheck).toEqual([REGION_SCOPE_UNKNOWN]);
  });

  it.each([
    ["제목이 고객 지역을 적었다", { title: "[서울] 2026년 소상공인 경영 개선 지원사업" }],
    ["고객 지역 기관이 낸 공고다", { source: "sba" }],
    [
      "지역 조건이 전국이다",
      {
        checks: [
          SCALE_PASS,
          { condition: { key: "region" as const, op: "in" as const, value: ["전국"], rawText: "전국", machineReadable: true }, verdict: "pass" as const, note: "" },
        ],
      },
    ],
  ])("지역 범위를 몰라도 %s → 묻지 않는다", (_name, over) => {
    const r = reviewEligibility(base({ ...over, structure: { industryScope: "all", regionScope: "unknown", supportAmountText: "", benefitSummary: "" } }));
    expect(r.toCheck).not.toContain(REGION_SCOPE_UNKNOWN);
    expect(r.verdict).toBe("fit");
  });

  it("다른 시도 기관의 공고는 범위를 몰라도 안 맞음(출처만으로 뺀 표시)", () => {
    const r = reviewEligibility(base({ source: "bepa", structure: { industryScope: "all", regionScope: "unknown", supportAmountText: "", benefitSummary: "" } }));
    expect(r.verdict).toBe("excluded");
    expect(r.excludeReason).toMatch(/^다른 지역 기관 공고/);
    expect(r.excludedBySourceOnly).toBe(true);
  });

  it.each([
    ["제주신용보증재단", "다른 지역 기관 공고(제주)"],
    ["부산신용보증재단", "다른 지역 기관 공고(부산)"],
  ])("전국 수집원(보조24)이 옮긴 공고도 주관기관이 다른 시도 지역 기관(%s)이면 안 맞음 — 운영 QA 2차", (agency, reason) => {
    const r = reviewEligibility(
      base({ source: "bojo24", placeOrgs: [agency], structure: { industryScope: "all", regionScope: "unknown", supportAmountText: "", benefitSummary: "" } }),
    );
    expect(r.verdict).toBe("excluded");
    expect(r.excludeReason).toBe(reason);
    expect(r.excludedBySourceOnly).toBe(true);
  });

  it("주관기관이 다른 시도 기관이어도 AI·제목이 「전국」이면 빼지 않고 지역 제한을 확인할 것으로 — 지역 수집원은 그대로 뺀다(리뷰 P2)", () => {
    const allScope = { industryScope: "all" as const, regionScope: "all" as const, supportAmountText: "", benefitSummary: "" };
    const unknownScope = { ...allScope, regionScope: "unknown" as const };
    const byAi = reviewEligibility(base({ source: "bojo24", placeOrgs: ["충북테크노파크"], structure: allScope }));
    expect(byAi.verdict).not.toBe("excluded");
    expect(byAi.toCheck).toContain("지역 제한 여부 확인");
    const byTitle = reviewEligibility(base({ source: "bojo24", title: "2026년 전국 화장품 비임상 지원기업 모집", placeOrgs: ["충북테크노파크"], structure: unknownScope }));
    expect(byTitle.verdict).not.toBe("excluded");
    expect(byTitle.toCheck).toContain("지역 제한 여부 확인");
    expect(reviewEligibility(base({ source: "bepa", structure: allScope })).excludeReason).toMatch(/^다른 지역 기관 공고/);
  });

  it("주관기관이 고객 지역 기관이면 지역 범위를 몰라도 묻지 않는다 — 전국 기관·빈 이름은 범위 확인을 그대로 둔다", () => {
    const unknownScope = { industryScope: "all" as const, regionScope: "unknown" as const, supportAmountText: "", benefitSummary: "" };
    const jeju = { ...SOCKS, region: "제주", regionSigungu: "제주시" };
    const own = reviewEligibility(base({ source: "bojo24", profile: jeju, placeOrgs: ["제주신용보증재단"], structure: unknownScope }));
    expect(own.verdict).toBe("fit");
    for (const agency of ["신용보증재단중앙회", "서민금융진흥원", "중소벤처기업부", ""]) {
      const r = reviewEligibility(base({ source: "bojo24", placeOrgs: [agency], structure: unknownScope }));
      expect(r.verdict).toBe("unverified");
      expect(r.toCheck).toEqual([REGION_SCOPE_UNKNOWN]);
    }
  });

  it("조건 정리 전(규칙 추출본) 공고와 금융상품에는 범위 확인을 붙이지 않는다", () => {
    const rule = reviewEligibility(base({ ruleOnly: true, structure: undefined }));
    expect(rule.toCheck).toEqual(["공고 원문 확인(조건 정리 전)"]);
    const product = reviewEligibility(base({ kind: "product", group: "policy", structure: undefined }));
    expect(product.toCheck).not.toContain(INDUSTRY_SCOPE_UNKNOWN);
    expect(product.toCheck).not.toContain(REGION_SCOPE_UNKNOWN);
  });

  it("범위 「모름」은 남은 조건 하나로 센다 — 조건 수를 모르는 원문 확인(6)보다 가볍다", () => {
    expect([...SCOPE_UNKNOWN_TO_CHECK]).toEqual([INDUSTRY_SCOPE_UNKNOWN, REGION_SCOPE_UNKNOWN]);
    expect(toCheckWeight([INDUSTRY_SCOPE_UNKNOWN])).toBe(1);
    expect(toCheckWeight([INDUSTRY_SCOPE_UNKNOWN, REGION_SCOPE_UNKNOWN])).toBe(2);
    expect(toCheckWeight(["공고 원문 확인(조건 정리 전)"])).toBe(6);
    expect(toCheckWeight(["자격 조건 원문 확인"])).toBe(6);
  });
});

describe("걸림돌 단계 — 걸림돌만 남아야 4단계, 확인할 것도 남으면 5단계(NO.585 4·5절)", () => {
  /** 고객이 「인증 없음」이라 적어 확정된 걸림돌. */
  const CERT_FAIL: ConditionCheck = {
    condition: { key: "certRequired", op: "eq", value: true, rawText: "벤처기업 인증 보유 기업", machineReadable: true },
    verdict: "fail",
    note: "요구 인증 미보유",
  };

  it("unverifiedStep — 걸림돌만이면 4, 확인할 것이 하나라도 있으면 5", () => {
    expect(unverifiedStep([], ["체납 정리 필요"])).toBe(4);
    expect(unverifiedStep(["기관 문의"], ["체납 정리 필요"])).toBe(5);
    expect(unverifiedStep(["기관 문의"], [])).toBe(5);
  });

  it("인증이 없는 고객 — 다른 확인이 없으면 4단계 걸림돌", () => {
    const r = reviewEligibility(base({ checks: [SCALE_PASS, CERT_FAIL] }));
    expect(r.verdict).toBe("unverified");
    expect(r.step).toBe(4);
    expect(r.stepLabel).toBe("걸림돌 있음");
    expect(r.obstacles).toEqual(["요구 인증 필요"]);
  });

  it("인증이 없는데 기관 문의까지 남으면 5단계 확인 필요 — 걸림돌은 지우지 않는다", () => {
    const r = reviewEligibility(base({ checks: [SCALE_PASS, CERT_FAIL], humanCheckTexts: ["센터별 세부 사항이 상이하므로 기관 문의 바람"] }));
    expect(r.verdict).toBe("unverified");
    expect(r.step).toBe(5);
    expect(r.stepLabel).toBe("확인 필요");
    expect(r.toCheck).toContain("기관 문의");
    expect(r.obstacles).toEqual(["요구 인증 필요"]);
  });
});

/* ───────── 기준 공고 고정본 ───────── */

interface Fixture {
  title: string;
  source: string;
  agency: string;
  region: string;
  structure: Record<string, unknown>;
}

const cond = (key: string, op: string, value: unknown, rawText: string) => ({ key, op, value, rawText, machineReadable: key !== "other" });

const S_OJT: Fixture = {
  title: "체계적 현장훈련 참여기업으로 선정되면 훈련 실시에 소요되는 훈련비와 훈련과정 컨설팅을 지원받을 수 있습니다",
  source: "work24",
  agency: "고용노동부(고용24)",
  region: "",
  structure: {
    industryScope: "restricted",
    regionScope: "all",
    benefitSummary: "체계적 현장훈련 참여기업으로 선정되면 훈련비, 훈련과정컨설팅(훈련과정 개발비), 훈련교사수당, 내부훈련교사 교육 등을 지원받을 수 있습니다.",
    supportAmountText: "훈련비: 훈련직종별 기준단가(평균 7,000원) × 훈련시간 × 훈련인원(수료기준) × 3배 / 훈련과정컨설팅: 내부전문가 최대 50만원",
    conditions: [
      cond("companyScale", "in", ["우선지원대상기업", "중소기업"], "고용보험가입 사업장 중 고용보험법 시행령 제 12 조에서 우선지원대상기업 (= 중소기업 ) 이면 지원받을 수 있으나 일부 기업의 경우 지원이 제한됩니다 ."),
      cond("noTaxDelinquency", "eq", true, "고용보험료를 신청일 기준으로 체납하지 않아야 합니다 ."),
      cond("other", "eq", true, "임금체불명단 공개 사업장 및 산재다발 사업장이 아니여야 합니다 ."),
      cond(
        "industry",
        "in",
        ["풍속영업", "청소년 유해업종", "성매매알선", "공공기관", "지방공기업", "비영리사업자", "협회"],
        "기타 아래의 업종은 제한되니 확인해보세요 . 「 풍속영업의 규제에 관한 법률 」 제 2 조에 따른 업종에 해당하는 기업",
      ),
    ],
    humanCheck: ["그 밖에 이사업의 목적에 적합하지 아니하다고 판단하는 기업"],
  },
};

const JANGWI: Fixture = {
  title: "서울 장위 의류봉제 소공인특화지원센터 소공인 모집 공고",
  source: "semas",
  agency: "소상공인시장진흥공단",
  region: "",
  structure: {
    industryScope: "unknown",
    regionScope: "restricted",
    benefitSummary: "서울 장위 의류봉제 소공인특화지원센터의 교육사업(정보교류·경영·기술역량 배양)과 지역·업종 특화사업",
    supportAmountText: "",
    conditions: [
      cond("companyScale", "in", ["소공인"], "□ 지원대상 : 집적지 내 또는 집적지 인근 소공인"),
      cond("region", "in", ["서울"], "서울 장위 의류봉제 소공인특화지원센터 소공인 모집 공고"),
    ],
    humanCheck: [
      "□ 지원대상 : 집적지 내 또는 집적지 인근 소공인",
      "□ 지원규모와 신청서류 : 센터별 사업 세부내용 및 각 사업별 모집시기 상이하므로, 소공인특화지원센터에 문의",
    ],
  },
};

const SEOUL_DIGITAL: Fixture = {
  title: "[서울] 2026년 하반기 중장년 소상공인 디지털 전환지원 사업 모집 공고",
  source: "bizinfo",
  agency: "서울특별시",
  // 운영 수집본의 지역 칸은 낱말 꼬리표 묶음이다(서울·서울특별시가 섞여 있다).
  region: "경영,서울,인력관리,디지털전환,서울신용보증재단,서울특별시,컨설팅,마케팅,소상공인",
  structure: {
    industryScope: "unknown",
    regionScope: "restricted",
    benefitSummary: "서울 소재 만 40세 이상 소상공인 200명에게 디지털 전환 교육, 컨설팅 4회, 솔루션 이행비용(부가세 제외 최대 3백만원)",
    supportAmountText: "솔루션 이행(최대 3백만원 지원), 부가가치세 제외 최대 3백만 원 이내 지원",
    conditions: [
      cond("region", "in", ["서울", "서울특별시", "서울시"], "소 재 지: 사업자등록증상 사업장 소재지가 ‘서울시’인 기업"),
      cond("companyScale", "in", ["소상공인"], "지원대상: 사업 신청일 기준 다음 요건을 모두 충족하는 소상공인"),
      cond("other", "gte", 40, "지원연령: 만 40세 이상인 자"),
      cond("other", "eq", true, "업 력: 개업일이 2025년 7월 1일 이전인 자"),
      cond("other", "eq", false, "휴업 중 또는 이미 폐업한 기업"),
      cond("other", "eq", false, "’26년도 서울시 소상공인 종합지원사업*을 지원받았거나 진행 중인 자"),
    ],
    humanCheck: ["(우대사항) - 디지털 취약 업종(숙박·음식점업, 제조업, 수리·기타서비스업) - 디지털 취약 연령(만 50세 이상)"],
  },
};

/** funding-map-build 의 공고 한 건 판정과 같은 순서 — 지역 보태기 → 대조 → 판정. */
function judge(f: Fixture, profile: BusinessProfile = SOCKS) {
  const structure = withRegionConditions(readStoredStructure(f.structure), { title: f.title, agency: f.agency, region: f.region }, { regionFieldFallback: true });
  const m = matchAnnouncement(structure, profile, NOW, { title: f.title });
  return reviewEligibility({
    kind: "announcement",
    group: "grant",
    title: f.title,
    source: f.source,
    profile,
    now: NOW,
    checks: m.checks,
    humanCheckTexts: m.humanCheck,
    structure,
    ruleOnly: false,
  });
}

describe("기준 공고 고정본 — 서울 도봉구 양말 임가공 7명(NO.585 6절)", () => {
  it("(b) S-OJT 는 지원 가능 · 1단계 무상", () => {
    const r = judge(S_OJT);
    expect(r.verdict).toBe("fit");
    expect(r.step).toBe(1);
    expect(r.copayText).toBe("자부담 원문에 없음");
  });

  it("(e) 장위 의류봉제는 확인 필요 — 「집적지 근처 인정 여부 확인」이 맨 앞", () => {
    const r = judge(JANGWI);
    expect(r.verdict).toBe("unverified");
    expect(r.step).toBe(5);
    expect(r.toCheck[0]).toBe("집적지 근처 인정 여부 확인");
  });

  it("(d) 서울 중장년 디지털 전환은 부가세 고객 부담과 함께 확인 필요 — 대표 나이가 남는다", () => {
    const r = judge(SEOUL_DIGITAL);
    expect(r.verdict).toBe("unverified");
    expect(r.copayText).toBe("부가세 고객 부담");
    expect(r.toCheck).toContain("대표자 만 40세 이상");
    expect(r.toCheck).not.toContain(REGION_SCOPE_UNKNOWN);
  });

  it("(h) 체납 고객 — S-OJT 는 4단계 걸림돌 「체납 정리 필요」로 남는다", () => {
    const r = judge(S_OJT, { ...SOCKS, taxDelinquent: true });
    expect(r.verdict).toBe("unverified");
    expect(r.step).toBe(4);
    expect(r.obstacles).toContain("체납 정리 필요");
  });

  it("(a) 부산 고객에게 서울 공고는 안 맞음", () => {
    const busan = { ...SOCKS, region: "부산", regionSigungu: "해운대구" };
    expect(judge(SEOUL_DIGITAL, busan).verdict).toBe("excluded");
    expect(judge(JANGWI, busan).verdict).toBe("excluded");
  });
});

describe("리뷰 review-29a732f5 P2 — 규모 포함 관계·채용 지원금·범위 상한·걸림돌 중복(NO.585 2·3절)", () => {
  const scaleCheck = (value: string[], verdict: "pass" | "fail"): ConditionCheck => ({
    condition: { key: "companyScale", op: "in", value, rawText: value.join("·"), machineReadable: true },
    verdict,
    note: verdict === "fail" ? `대상: ${value.join("·")}` : "",
  });

  it("규모를 「소상공인」으로 적은 고객도 중소기업·우선지원대상기업 공고(S-OJT) 대상이다", () => {
    const r = judge(S_OJT, { ...SOCKS, companyScale: "소상공인" });
    expect(r.verdict).toBe("fit");
    expect(r.step).toBe(1);
  });

  it("「중소기업」이라 적었어도 직원 수·매출이 소상공인이면 소상공인 공고 대상이다", () => {
    const r = reviewEligibility(base({ profile: { ...SOCKS, companyScale: "중소기업" }, checks: [scaleCheck(["소상공인"], "fail")] }));
    expect(r.verdict).toBe("fit");
  });

  it("「중소기업」이라 적은 매출 200억 고객은 글자가 겹쳐도 소기업 공고 대상이 아니다", () => {
    const big = { ...SOCKS, companyScale: "중소기업", employeeCount: 80, lastYearRevenueKrw: 20_000_000_000 };
    expect(reviewEligibility(base({ profile: big, checks: [scaleCheck(["소기업"], "pass")] })).verdict).toBe("excluded");
  });

  it("「중견기업」이라 적은 큰 회사는 소상공인 공고 대상이 아니다", () => {
    const big = { ...SOCKS, companyScale: "중견기업", employeeCount: 300, lastYearRevenueKrw: 100_000_000_000 };
    expect(reviewEligibility(base({ profile: big, checks: [scaleCheck(["소상공인"], "fail")] })).verdict).toBe("excluded");
  });

  it.each([
    "방위산업 중소기업 신규직원 채용 지원사업 참여기업 모집",
    "청년 정규직 채용 장려금 신청 안내",
    "중소기업 신규채용 인건비 지원",
  ])("고용지원금 공고 「%s」는 남긴다", (title) => {
    expect(nonBenefitReason(title)).toBeNull();
  });

  it.each(["○○공단 신규직원 채용 공고", "중소기업 지원사업 담당 직원 채용"])("구인 글 「%s」는 뺀다", (title) => {
    expect(nonBenefitReason(title)).not.toBeNull();
  });

  it("「상시근로자 5인 이상 50인 미만」은 위 경계도 본다 — 120명 고객은 안 맞음, 7명 고객은 맞음", () => {
    const text = ["상시근로자 5인 이상 50인 미만 기업"];
    expect(reviewEligibility(base({ profile: { ...SOCKS, employeeCount: 120 }, humanCheckTexts: text })).verdict).toBe("excluded");
    expect(reviewEligibility(base({ humanCheckTexts: text })).verdict).toBe("fit");
  });

  it("「업력 3년 이상 7년 미만」은 위 경계도 본다 — 업력 26년 고객은 안 맞음", () => {
    expect(reviewEligibility(base({ humanCheckTexts: ["업력 3년 이상 7년 미만 기업"] })).verdict).toBe("excluded");
  });

  it("체납 문장이 여럿이어도 걸림돌 「체납 정리 필요」는 한 번만 센다", () => {
    const many: Fixture = {
      ...S_OJT,
      structure: { ...S_OJT.structure, humanCheck: ["국세 체납이 없는 자", "지방세 체납이 없는 자"] },
    };
    const r = judge(many, { ...SOCKS, taxDelinquent: true });
    expect(r.obstacles).toEqual(["체납 정리 필요"]);
    expect(r.step).toBe(4);
  });
});

describe("다른 지역 대상 상품 — 운영 QA(NO.585 2절: 서울 밖 공고·상품이 어느 탭에도 없다)", () => {
  /** 상품 어댑터가 대상 원문을 옮겨 적은 사람 확인 조건(rules-to-conditions 의 humanCheck). */
  const other = (rawText: string): ConditionCheck => ({
    condition: { key: "other", op: "eq", value: true, rawText, machineReadable: false },
    verdict: "unknown",
    note: "",
  });
  const product = (over: Partial<EligibilityInput> = {}): EligibilityInput => ({
    kind: "product",
    group: "guarantee",
    title: "소상공인 특례보증",
    source: "product-kinfa",
    profile: SOCKS,
    now: NOW,
    checks: [other("소상공인")],
    placeOrgs: ["", "서민금융진흥원"],
    ...over,
  });

  it.each(["광주광역시 소재 소기업.소상공인", "경상남도에서 사업 중인 소상공인", "부산광역시에 사업장을 둔 중소기업", "충청북도 내 주소를 둔 소상공인"])(
    "「%s」는 규모가 맞아도 서울 회사에 안 맞음",
    (text) => {
      const r = reviewEligibility(product({ checks: [other(text)] }));
      expect(r.verdict).toBe("excluded");
      expect(r.excludeReason).toMatch(/^다른 지역 대상\(/);
    },
  );

  it("공고의 사람 확인 문장도 같다 — 「대구광역시 소재 소상공인」은 서울 회사에 안 맞음", () => {
    const r = reviewEligibility(base({ humanCheckTexts: ["대구광역시 소재 소상공인"] }));
    expect(r.verdict).toBe("excluded");
    expect(r.excludeReason).toBe("다른 지역 대상(대구)");
  });

  it.each(["서울특별시 소재 소상공인", "서울 도봉구에 사업장을 둔 소상공인"])("고객 지역 문장 「%s」는 맞음", (text) => {
    expect(reviewEligibility(product({ checks: [other(text)] })).verdict).toBe("fit");
  });

  it("다른 지역이 우대 문장에만 있으면 빼지 않는다", () => {
    const r = reviewEligibility(product({ checks: [other("소상공인"), other("부산 소재 기업 우대")] }));
    expect(r.verdict).not.toBe("excluded");
  });

  it("「또는」으로 다른 길이 있으면 빼지 않고 확인할 것", () => {
    const r = reviewEligibility(product({ checks: [other("부산광역시 소재 소상공인 또는 부산으로 이전 예정인 소상공인")] }));
    expect(r.verdict).toBe("unverified");
    expect(r.toCheck).toContain("지역 조건 확인");
  });

  it("「성북구 외」·「인근」처럼 다른 구도 받는 문장은 빼지 않는다", () => {
    const r = reviewEligibility(product({ checks: [other("서울 성북구 및 인근 지역 소재 소상공인")] }));
    expect(r.verdict).not.toBe("excluded");
  });

  it.each([
    ["전남신용보증재단", "다른 지역 기관 상품(전남)"],
    ["충청북도기업진흥원", "다른 지역 기관 상품(충북)"],
    ["강원신용보증재단, 전북신용보증재단", "다른 지역 기관 상품(강원·전북)"],
  ])("창구가 다른 시도 지역 기관(%s)이면 대상 원문에 지역이 없어도 안 맞음(출처만으로 뺀 표시)", (channel, reason) => {
    const r = reviewEligibility(product({ checks: [other("각 시·군에 주민등록이 되어있고 실제 거주하고 있는 소상공인")], placeOrgs: [channel, "서민금융진흥원"] }));
    expect(r.verdict).toBe("excluded");
    expect(r.excludeReason).toBe(reason);
    expect(r.excludedBySourceOnly).toBe(true);
  });

  it.each(["서울신용보증재단", "강원신용보증재단, 서울신용보증재단", "신용보증재단중앙회", "지역신용보증재단", "서민금융진흥원", "BNK경남은행"])(
    "창구 「%s」 상품은 서울 회사에 남는다",
    (channel) => {
      const r = reviewEligibility(product({ placeOrgs: [channel, "서민금융진흥원"] }));
      expect(r.verdict).toBe("fit");
    },
  );

  it("창구가 비면 기관 이름으로 본다", () => {
    const r = reviewEligibility(product({ placeOrgs: ["", "경기신용보증재단"] }));
    expect(r.excludeReason).toBe("다른 지역 기관 상품(경기)");
  });

  it("고객 시도를 모르면 빼지 않고 「소재지 확인」", () => {
    const r = reviewEligibility(product({ profile: { ...SOCKS, region: undefined, regionSigungu: undefined }, placeOrgs: ["전남신용보증재단", "서민금융진흥원"] }));
    expect(r.verdict).toBe("unverified");
    expect(r.toCheck).toContain("소재지 확인");
  });

  it("지역 기관 출처 상품(product-gcgf)도 다른 시도 고객에게 안 맞음", () => {
    const r = reviewEligibility(product({ source: "product-gcgf", placeOrgs: ["경기신용보증재단 지점", "경기신용보증재단"] }));
    expect(r.excludeReason).toBe("다른 지역 기관 상품(경기)");
  });

  it("지역 문장·창구 지역만으로 뺀 상품은 「지역만으로 뺌」 표시, 출처 사본 표시는 창구 지역일 때만", () => {
    const byText = reviewEligibility(product({ checks: [other("광주광역시 소재 소기업.소상공인")], placeOrgs: ["광주신용보증재단", "서민금융진흥원"] }));
    expect(byText.excludedByPlaceOnly).toBe(true);
    expect(byText.excludedBySourceOnly).toBeUndefined();
    const byChannel = reviewEligibility(product({ placeOrgs: ["전남신용보증재단", "서민금융진흥원"] }));
    expect(byChannel.excludedByPlaceOnly).toBe(true);
    const notPlace = reviewEligibility(product({ checks: [other("광주광역시 소재 소기업.소상공인"), other("개인사업자 제외")], placeOrgs: ["광주신용보증재단", "서민금융진흥원"] }));
    expect(notPlace.verdict).toBe("excluded");
    expect(notPlace.excludedByPlaceOnly).toBeUndefined();
  });
});

describe("「X 외 지역」 문장 — 리뷰 review-fca5517e P2·P3(NO.585 2절)", () => {
  const busan = { ...SOCKS, region: "부산", regionSigungu: "해운대구" };

  it.each(["수도권 외 지역에 소재한 중소기업", "서울 외 지역 소재 소상공인", "서울 이외 지역에 사업장을 둔 소상공인"])(
    "부산 회사에게 「%s」는 지역 때문에 빠지지 않는다",
    (text) => {
      expect(reviewEligibility(base({ profile: busan, humanCheckTexts: [text] })).verdict).not.toBe("excluded");
    },
  );

  it.each([
    ["수도권 외 지역에 소재한 중소기업", "다른 지역 대상(서울·경기·인천 밖)"],
    ["서울 외 지역 소재 소상공인", "다른 지역 대상(서울 밖)"],
  ])("서울 회사에게 「%s」는 안 맞음", (text, reason) => {
    const r = reviewEligibility(base({ humanCheckTexts: [text] }));
    expect(r.verdict).toBe("excluded");
    expect(r.excludeReason).toBe(reason);
  });

  it("「비수도권 소재」는 지역 이름 목록으로 읽혀 서울 회사는 안 맞음·부산 회사는 빠지지 않는다", () => {
    expect(reviewEligibility(base({ humanCheckTexts: ["비수도권 소재 중소기업"] })).excludeReason).toMatch(/^다른 지역 대상\(/);
    expect(reviewEligibility(base({ profile: busan, humanCheckTexts: ["비수도권 소재 중소기업"] })).verdict).not.toBe("excluded");
  });

  it.each(["서울 및 서울 외 지역 소재 소상공인", "수도권 및 비수도권 소재 중소기업 모두", "비수도권 소재 기업 우대", "서울 외 지역 소재 기업 또는 서울 소재 사회적기업"])(
    "서울 회사에게 「%s」는 빼지 않는다",
    (text) => {
      expect(reviewEligibility(base({ humanCheckTexts: [text] })).verdict).not.toBe("excluded");
    },
  );
});

describe("displayChecks — 보이는 지역·업종·규모 줄은 판정 결과를 따른다(NO.585 추가 제보 2026-10-29)", () => {
  // 제보 예시와 같은 모양으로 지어낸 고객 — 경기 화성·도장·도배 공사업·5명·매출 8억.
  const PAINTER: BusinessProfile = {
    industry: "건설업(도장·도배 공사업)",
    region: "경기",
    regionSigungu: "화성시",
    employeeCount: 5,
    foundedDate: "2015-03-01",
    lastYearRevenueKrw: 800_000_000,
    taxDelinquent: false,
    hasCert: false,
    hasPatent: false,
  };
  const cond = (key: StructuredCondition["key"], value: StructuredCondition["value"], rawText: string, machineReadable = true): StructuredCondition =>
    ({ key, op: key === "noTaxDelinquency" ? "eq" : "in", value, rawText, machineReadable }) as StructuredCondition;
  const shownOf = (conds: StructuredCondition[], p: BusinessProfile = PAINTER) => {
    const checks = conds.map((c) => checkCondition(c, p, NOW));
    return { checks, shown: displayChecks(checks, p, NOW) };
  };

  it("충남 해양바이오 공고(조건 4개 중 1개 맞음 · 3개 직접 확인) — 지역·업종은 안 맞음, 규모는 맞음, 「직접 확인」이 남지 않는다", () => {
    const { checks, shown } = shownOf([
      cond("region", ["충청남도"], "(신청자격) 충청남도에 본사·공장 소재 기업", false),
      cond("industry", ["해양생명자원", "미세조류", "해조류", "수산물"], "(지원분야) 해양생명자원·미세조류·해조류·수산물", false),
      cond("companyScale", ["중소기업"], "중소기업", false),
      cond("noTaxDelinquency", true, "국세·지방세 체납, 가압류 등으로 사업 수행이 어려운 기업 제외"),
    ]);
    expect(checks.map((c) => c.verdict)).toEqual(["unknown", "unknown", "unknown", "pass"]);
    expect(shown.map((c) => c.verdict)).toEqual(["fail", "fail", "pass", "pass"]);
    expect(shown[0].note).toBe("다른 지역 공고(충청남도)");
    expect(shown[1].note).toMatch(/^다른 업종 공고\(해양생명자원·/);
    expect(shown.some((c) => c.verdict === "unknown")).toBe(false);
  });

  it("업종 값이 분야 사전으로 읽히거나 읽힌 값의 일부면 안 맞음 — 사전 밖 값이 따로 서면 확인으로 둔다", () => {
    const { shown } = shownOf([
      cond("industry", ["축산", "축산업", "축산농가", "가축"], "관내 축산농가", false),
      cond("industry", ["해양수산", "해양", "수산"], "해양수산·해양·수산", false),
      cond("industry", ["축산업", "수산업", "가두리"], "축산업·수산업·가두리", false),
      cond("industry", ["농업", "스마트팜"], "농업·스마트팜", false),
    ]);
    expect(shown.map((c) => c.verdict)).toEqual(["fail", "fail", "unknown", "unknown"]);
    expect(shown[2].note).toBe("업종 해당 여부(축산업·수산업·가두리)");
    expect(shown[3].note).toBe("업종 해당 여부(농업·스마트팜)");
    // 판정도 같다 — 값이 모두 다른 분야로 읽히는 업종 조건이 있으면 빠진다.
    const painterChecks = (conds: StructuredCondition[]) => conds.map((c) => checkCondition(c, PAINTER, NOW));
    expect(reviewEligibility(base({ profile: PAINTER, checks: painterChecks([cond("industry", ["해양수산", "해양", "수산"], "해양수산·해양·수산", false)]) })).excludeReason).toMatch(/^다른 업종 공고\(/);
    expect(reviewEligibility(base({ profile: PAINTER, checks: painterChecks([cond("industry", ["축산업", "수산업", "가두리"], "축산업·수산업·가두리", false)]) })).verdict).not.toBe("excluded");
  });

  it("사전 밖 값이 고객 업종일 수 있으면 빼지 않는다 — 양말 제조 × 생활용품·잡화, IT × 스마트팜(리뷰 P2)", () => {
    const socks: BusinessProfile = { ...PAINTER, industry: "제조업(임가공, 양말)" };
    const it_: BusinessProfile = { ...PAINTER, industry: "소프트웨어 개발업" };
    const beauty = cond("industry", ["뷰티", "화장품", "미용", "생활용품", "잡화"], "뷰티·화장품·미용·생활용품·잡화", false);
    const farm = cond("industry", ["농업", "축산", "스마트팜"], "농업·축산·스마트팜", false);
    expect(shownOf([beauty], socks).shown[0].verdict).toBe("unknown");
    expect(shownOf([farm], it_).shown[0].verdict).toBe("unknown");
    expect(reviewEligibility(base({ profile: socks, checks: [checkCondition(beauty, socks, NOW)] })).verdict).not.toBe("excluded");
    expect(reviewEligibility(base({ profile: it_, checks: [checkCondition(farm, it_, NOW)] })).verdict).not.toBe("excluded");
  });

  it("업종 — 고객 업종 글자가 든 값은 맞음, 값이 모두 다른 분야면 안 맞음", () => {
    const { checks, shown } = shownOf([
      cond("industry", ["도배업", "축산업"], "도배업·축산업"),
      cond("industry", ["축산업", "수산업"], "축산업·수산업", false),
    ]);
    expect(checks.map((c) => c.verdict)).toEqual(["unknown", "unknown"]);
    expect(shown.map((c) => c.verdict)).toEqual(["pass", "fail"]);
    expect(shown[1].note).toBe("다른 업종 공고(축산업·수산업)");
  });

  it("규모 이름은 직원 수·매출로 맞음·안 맞음 — 「기업 규모 미입력」을 보이지 않는다", () => {
    const { checks, shown } = shownOf([
      cond("companyScale", ["소상공인"], "소상공인"),
      cond("companyScale", ["중견기업"], "중견기업"),
      cond("companyScale", ["소공인"], "소공인"),
    ]);
    expect(checks.map((c) => c.note)).toEqual(["기업 규모 미입력", "기업 규모 미입력", "기업 규모 미입력"]);
    expect(shown.map((c) => c.verdict)).toEqual(["pass", "fail", "fail"]);
  });

  it("업종별 기준 사이라 못 가린 규모는 확인으로 두되 「미입력」이라 하지 않는다", () => {
    const mid = { ...PAINTER, industry: "", employeeCount: 7, lastYearRevenueKrw: 3_000_000_000 };
    const { shown } = shownOf([cond("companyScale", ["소상공인"], "소상공인")], mid);
    expect(shown[0].verdict).toBe("unknown");
    expect(shown[0].note).toBe("직원 수·매출로 못 가림 — 기업 규모: 소상공인");
  });

  it("규모 판정이 모르는 이름(여성기업)은 직원 수·매출 탓을 하지 않는다 — 원래 메모 그대로(리뷰 P3)", () => {
    const { checks, shown } = shownOf([cond("companyScale", ["여성기업"], "여성기업")]);
    expect(shown[0].verdict).toBe("unknown");
    expect(shown[0].note).not.toMatch(/직원 수·매출/);
    expect(shown[0]).toBe(checks[0]);
  });

  it("고객 정보가 없거나 이웃 업종이면 맞음·안 맞음을 정하지 않는다 — 메모만 확인할 것으로", () => {
    const empty: BusinessProfile = { industry: "건설업(도장·도배 공사업)" };
    const { checks, shown } = shownOf(
      [cond("region", ["충청남도"], "충청남도", false), cond("companyScale", ["소상공인"], "소상공인"), cond("industry", ["금속"], "금속 가공", false)],
      empty,
    );
    expect(shown.map((c) => c.verdict)).toEqual(["unknown", "unknown", "unknown"]);
    expect(shown.map((c) => c.note)).toEqual(["소재지 확인", "기업 규모 미입력", "업종 해당 여부(금속)"]);
    expect(shown[1]).toBe(checks[1]);
  });

  it("규모 이름으로 적은 대상 유형 줄도 따른다 — 참·거짓 문장으로 정리한 대상 유형은 그대로", () => {
    const { checks, shown } = shownOf([
      cond("targetOrg", ["소상공인"], "소상공인", false),
      cond("targetOrg", true, "주관연구개발기관 유형 대학 및 정부출연연구소", false),
    ]);
    expect(shown[0].verdict).toBe("pass");
    expect(shown[1]).toBe(checks[1]);
  });
});

describe("대상 업종 문장을 제외 업종 목록으로 읽지 않는다 — 운영 QA 3차(NO.585 2026-10-30)", () => {
  // 원문·값은 운영 AI 정리본 그대로다. 고객은 위와 같은 화성 도장·도배 공사업.
  const PAINTER: BusinessProfile = {
    industry: "건설업(도장·도배 공사업)",
    region: "경기",
    regionSigungu: "화성시",
    employeeCount: 5,
    foundedDate: "2015-03-01",
    lastYearRevenueKrw: 800_000_000,
    taxDelinquent: false,
    hasCert: false,
    hasPatent: false,
  };
  const FOOD: BusinessProfile = { ...PAINTER, industry: "식품 제조업(김치)" };
  const ind = (value: string[], rawText: string): StructuredCondition => ({ key: "industry", op: "in", value, rawText, machineReadable: true });
  const shown = (c: StructuredCondition, p: BusinessProfile = PAINTER, scope?: "all" | "restricted" | "unknown") =>
    displayChecks([checkCondition(c, p, NOW)], p, NOW, scope)[0];
  const review = (c: StructuredCondition, p: BusinessProfile = PAINTER, scope: "all" | "restricted" | "unknown" = "restricted") =>
    reviewEligibility(base({ profile: p, checks: [SCALE_PASS, checkCondition(c, p, NOW)], structure: { industryScope: scope, regionScope: "all", supportAmountText: "", benefitSummary: "" } }));

  const food = ind(["식품", "식품 수출", "식품수출업체"], "식품 수출업체 중 제외국(미국 등) 현지실사 대상 업체");
  const fishery = ind(
    ["어업", "어업인", "어업용 면세경유", "수산"],
    "「조세특례제한법」 제106조의2 및 「농·축산·임·어업용 기자재 및 석유류에 대한 부가가치세 영세율 및 면세 적용 등에 관한 특례규정」에 따라 어업용 면세경유를 공급받은 자(이하 “어업인”)",
  );
  const tac = ind(["어업", "어업인", "TAC 참여 어업"], "○ TAC 참여 어업인(단, 제주도 소라 채취 어업인은 및 TAC 참여 1단계 어업인은 제외)");
  const delivery = ind(
    ["배달대행", "배달", "퀵서비스", "퀵", "대리운전", "플랫폼종사자"],
    "온라인 플랫폼을 이용하여 배달대행·퀵서비스·대리운전 노무를 제공하고 사업주 또는 노무수령자로부터 대가를 받는 사람(택배기사와 택시기사 제외)",
  );
  const news = ind(
    ["일간신문", "주간신문", "인터넷신문", "신문", "언론"],
    "신문법상 일간신문, 주간신문, 인터넷신문(* 무료신문 제외, 해당 년도 언론진흥기금 공모사업 지원 자격 충족)",
  );
  const medical = ind(["의료기기", "의료기기 전방산업", "의료기기 후방산업"], "☞ 의료기기 전ㆍ후방 산업군에 해당하는 전국의 중소ㆍ중견기업");

  it("「제외국」·「○○제한법」은 제외 말이 아니다 — 다른 업종 대상 공고는 안 맞음, 같은 업종은 맞음", () => {
    expect(shown(food).verdict).toBe("fail");
    expect(shown(food).note).toMatch(/^다른 업종 공고\(식품/);
    expect(shown(fishery).verdict).toBe("fail");
    expect(review(food).excludeReason).toMatch(/^다른 업종 공고\(/);
    expect(review(fishery).excludeReason).toMatch(/^다른 업종 공고\(/);
    expect(shown(food, FOOD).verdict).toBe("pass");
  });

  it("괄호 속 「(… 제외)」는 대상 업종 안의 덜어 냄이다 — 대상 값이 괄호 밖에 있으면 대상 업종 목록", () => {
    expect(shown(tac).verdict).toBe("fail");
    expect(review(tac).excludeReason).toMatch(/^다른 업종 공고\(/);
    // 사전 밖 값이 따로 서면 맞음도 안 맞음도 아니다 — 확인할 것.
    expect(shown(delivery).verdict).toBe("unknown");
    expect(shown(delivery).note).toMatch(/^업종 표기가 달라 확인 필요 — 대상 업종: 배달대행/);
    expect(shown(news).verdict).toBe("unknown");
    expect(review(delivery).verdict).not.toBe("fit");
    expect(review(news).verdict).not.toBe("fit");
  });

  it("AI 가 「특정 업종만」이라 한 공고의 결격 낱말(의료·금융·회계) 값은 맞음이 아니라 확인 — 빼지도 않는다", () => {
    expect(shown(medical, PAINTER, "restricted").verdict).toBe("unknown");
    expect(shown(medical, PAINTER, "restricted").note).toMatch(/^업종 표기가 달라 확인 필요 — 대상 업종: 의료기기/);
    const r = review(medical);
    expect(r.verdict).not.toBe("fit");
    expect(r.verdict).not.toBe("excluded");
    const finance = ind(["금융기관", "금융"], "금융기관 출연금 납부시 제출하여야 할 서류를 아래와 같이 알려드리오니 출연금 납부일 5일전까지 제출하여 주시기 바랍니다.");
    expect(shown(finance, PAINTER, "restricted").verdict).toBe("unknown");
    // 업종 범위를 모르는 공고·상품은 예전처럼 결격 낱말 목록으로 본다.
    expect(shown(medical).verdict).toBe("pass");
  });

  it("진짜 제외 업종 목록은 그대로 — 괄호 속 결격 업종, 본문의 「제외」, 범위가 「특정 업종만」이어도", () => {
    const vice = ind(["일반유흥주점업", "사행시설 관리 및 운영업"], "○ 모든 중소기업(단, 일반유흥주점업, 사행시설 관리 및 운영업 등 제외)");
    const loanBan = ind(["숙박업", "부동산업"], "정책자금 융자제외업종(별표1)을 영위하는 기업은 지원 제외");
    const plain = ind(["유흥주점업", "부동산업"], "유흥주점업, 부동산업 등은 지원 제외");
    for (const c of [vice, loanBan, plain]) {
      expect(shown(c).verdict).toBe("pass");
      expect(shown(c, PAINTER, "restricted").verdict).toBe("pass");
      expect(review(c).verdict).not.toBe("excluded");
    }
    // 고객이 그 업종이면 확인할 것(맞음 아님) — AI 가 기계 대조를 끈 조건. 대조를 켠 조건은 앞 단계(checkCondition)가
    // 고객 업종 글자로 맞음을 내며, 이번 고침 밖이다.
    const realtor: BusinessProfile = { ...PAINTER, industry: "부동산업(중개)" };
    const plainOff = { ...plain, machineReadable: false };
    expect(shown(plainOff, realtor).verdict).toBe("unknown");
    expect(shown(plainOff, realtor).note).toBe("제외 업종 해당 여부");
  });

  it("범위가 「특정 업종만」이고 제외 말이 없는 결격 낱말 목록은 빼지 않는다 — 확인으로 둔다", () => {
    // 부동산·숙박은 분야 사전으로도 읽혀 대상 업종 목록으로 넘기면 건설 고객을 잘못 뺀다.
    const bare = ind(["부동산업", "숙박업"], "부동산업, 숙박업");
    expect(shown(bare, PAINTER, "restricted").verdict).toBe("unknown");
    expect(review(bare).verdict).not.toBe("excluded");
    expect(shown(bare).verdict).toBe("pass");
  });
});
