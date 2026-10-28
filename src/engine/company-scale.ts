// 기업 규모 이름(소상공인·소공인·중소기업·우선지원대상기업 …)을 고객의 직원 수·매출·업종·설립일로 판정한다
// (NO.585, 2026-10-26 대표 요청 「우선지원대상기업·중소기업·소상공인·소공인은 직원 수·매출로 판정」).
// 확신이 있을 때만 yes/no 를 낸다 — 업종별로 기준이 갈리는 사이 값은 unknown(사람 확인)이다.
import { businessAgeYears, corporationOf, type BusinessProfile } from "./match-engine";

export type ScaleFact = "yes" | "no" | "unknown";

/** 소상공인 상시근로자 기준이 10명인 업종(소상공인기본법 시행령 — 광업·제조업·건설업·운수업). 그 밖은 5명. */
const TEN_WORKER_INDUSTRY = /제조|가공|봉제|광업|건설|운수|운송|화물/;
/** 소공인(도시형소공인 지원법) — 제조업이면서 상시근로자 10명 미만. */
const MANUFACTURING = /제조|가공|봉제/;

/** 소기업 매출 상한 중 가장 낮은 값·가장 높은 값(중소기업기본법 시행령 별표3 — 업종별 10억~120억). */
const SMALL_REVENUE_MIN_CAP = 1_000_000_000;
const SMALL_REVENUE_MAX_CAP = 12_000_000_000;
/** 중소기업 평균매출 상한 중 가장 낮은 값·가장 높은 값(별표1 — 업종별 400억~1,500억). */
const SME_REVENUE_MIN_CAP = 40_000_000_000;
const SME_REVENUE_MAX_CAP = 150_000_000_000;
/** 우선지원대상기업(고용보험법 시행령 제12조) — 상시근로자 기준 중 가장 낮은 값(그 밖의 업종 100명). */
const PRIORITY_SUPPORT_MIN_WORKERS = 100;
/** 창업기업(중소기업창업 지원법) — 업력 7년 이내. */
const STARTUP_MAX_YEARS = 7;

function and(a: ScaleFact, b: ScaleFact): ScaleFact {
  if (a === "no" || b === "no") return "no";
  return a === "yes" && b === "yes" ? "yes" : "unknown";
}

function smallByRevenue(p: BusinessProfile): ScaleFact {
  const r = p.lastYearRevenueKrw;
  if (r == null) return "unknown";
  if (r <= SMALL_REVENUE_MIN_CAP) return "yes";
  return r > SMALL_REVENUE_MAX_CAP ? "no" : "unknown";
}

function smeByRevenue(p: BusinessProfile): ScaleFact {
  const r = p.lastYearRevenueKrw;
  if (r == null) return "unknown";
  if (r <= SME_REVENUE_MIN_CAP) return "yes";
  return r > SME_REVENUE_MAX_CAP ? "no" : "unknown";
}

function smallBusinessWorkers(p: BusinessProfile): ScaleFact {
  const n = p.employeeCount;
  if (n == null) return "unknown";
  const industry = p.industry ?? "";
  if (industry.trim()) return n < (TEN_WORKER_INDUSTRY.test(industry) ? 10 : 5) ? "yes" : "no";
  if (n < 5) return "yes";
  return n >= 10 ? "no" : "unknown";
}

/** 공고가 적은 규모 이름 하나 → 이 고객이 해당하는가. 이 함수가 모르는 이름이면 null. */
export function scaleFactOf(name: string, p: BusinessProfile, now: Date): ScaleFact | null {
  const n = name.replace(/\s+/g, "");
  if (!n) return null;
  // 「소기업(소상공인)」처럼 괄호로 다른 이름을 덧붙였으면 어느 하나만 맞아도 해당한다.
  const paren = n.match(/^([^()（）]+)[(（]([^()（）]+)[)）]$/);
  if (paren) {
    const facts = [scaleFactOf(paren[1], p, now), scaleFactOf(paren[2], p, now)].filter((f): f is ScaleFact => f !== null);
    if (facts.length === 0) return null;
    if (facts.includes("yes")) return "yes";
    return facts.every((f) => f === "no") ? "no" : "unknown";
  }
  switch (n) {
    case "소상공인":
    case "소상공인기업":
      return and(smallBusinessWorkers(p), smallByRevenue(p));
    case "소공인":
    case "도시형소공인": {
      const industry = p.industry ?? "";
      if (!industry.trim() || p.employeeCount == null) return "unknown";
      if (!MANUFACTURING.test(industry)) return "no";
      return p.employeeCount < 10 ? "yes" : "no";
    }
    case "소기업":
      return smallByRevenue(p);
    case "중소기업":
    case "중소기업자":
      return smeByRevenue(p);
    case "중기업": {
      const sme = smeByRevenue(p);
      const small = smallByRevenue(p);
      if (small === "yes" || sme === "no") return "no";
      return sme === "yes" && small === "no" ? "yes" : "unknown";
    }
    case "우선지원대상기업": {
      if (smeByRevenue(p) === "yes") return "yes";
      if (p.employeeCount != null && p.employeeCount <= PRIORITY_SUPPORT_MIN_WORKERS) return "yes";
      return "unknown";
    }
    case "중견기업":
    case "초기중견기업":
    case "대기업":
      return smeByRevenue(p) === "yes" ? "no" : "unknown";
    case "창업기업":
    case "스타트업":
    case "초기창업기업": {
      const age = businessAgeYears(p.foundedDate, now);
      if (age == null || age < 0) return "unknown";
      return age <= STARTUP_MAX_YEARS ? "yes" : "no";
    }
    case "예비창업자": {
      const age = businessAgeYears(p.foundedDate, now);
      if (age == null) return "unknown";
      return age > 0 ? "no" : "unknown";
    }
    case "개인":
    case "개인사업자":
    case "자영업자": {
      const corp = corporationOf(p);
      if (corp === null) return "unknown";
      return corp ? "no" : "yes";
    }
    default:
      return null;
  }
}

export type ScaleVerdict = { verdict: "pass" | "fail" | "unknown"; unknownNames: string[] };

/**
 * 규모 조건(companyScale in [...]) 판정 — 하나라도 해당하면 pass, 모두 해당 안 하면 fail, 그 밖은 unknown.
 * 고객이 규모를 직접 적었으면(profile.companyScale) `declaredScaleVerdict` 가 먼저 본다.
 */
export function companyScaleVerdict(values: readonly string[], p: BusinessProfile, now: Date): ScaleVerdict {
  const facts = values.map((v) => ({ name: v, fact: scaleFactOf(v, p, now) }));
  if (facts.some((f) => f.fact === "yes")) return { verdict: "pass", unknownNames: [] };
  if (facts.length > 0 && facts.every((f) => f.fact === "no")) return { verdict: "fail", unknownNames: [] };
  return { verdict: "unknown", unknownNames: facts.filter((f) => f.fact !== "no").map((f) => f.name) };
}

/** 고객이 적은 규모가 들어가는 규모 이름 — 소공인 ⊂ 소상공인 ⊂ 소기업 ⊂ 중소기업(= 우선지원대상기업). */
const DECLARED_WITHIN: Record<string, readonly string[]> = {
  소공인: ["소공인", "소상공인", "소기업", "중소기업", "우선지원대상기업"],
  소상공인: ["소상공인", "소기업", "중소기업", "우선지원대상기업"],
  소기업: ["소기업", "중소기업", "우선지원대상기업"],
  중소기업: ["중소기업", "우선지원대상기업"],
  중견기업: ["중견기업"],
};

/**
 * 고객이 규모를 직접 적었을 때의 규모 조건 판정(리뷰 review-29a732f5 P2) — 글자 겹침이 아니라 포함 관계로 본다.
 * 적은 규모가 공고 대상 안에 들면 통과(소상공인은 중소기업 공고 대상이다). 아니면 직원 수·매출로 다시 본다
 * (「중소기업」이라 적은 5인 미만 회사도 소상공인 공고 대상이고, 매출 200억 회사는 「소기업」 글자가 겹쳐도 아니다).
 * 적은 이름이 표에 없으면(예비창업자 등) null — 부르는 쪽이 하던 대로 판정한다.
 */
export function declaredScaleVerdict(values: readonly string[], p: BusinessProfile, now: Date): ScaleVerdict | null {
  const within = DECLARED_WITHIN[(p.companyScale ?? "").replace(/\s+/g, "")];
  if (!within) return null;
  if (values.some((v) => within.some((w) => v.replace(/\s+/g, "").includes(w)))) return { verdict: "pass", unknownNames: [] };
  return companyScaleVerdict(values, p, now);
}
