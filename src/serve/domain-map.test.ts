import { describe, it, expect } from "vitest";
import { mapCategoryToSources } from "./domain-map";

describe("mapCategoryToSources", () => {
  it("인증 계열은 cert 로", () => {
    expect(mapCategoryToSources("기업 인증 지원")).toEqual({ consultingDomain: "cert", sectionKey: "cert" });
    expect(mapCategoryToSources("벤처확인")).toEqual({ consultingDomain: "cert", sectionKey: "cert" });
  });
  it("특허·지식재산은 patent 로", () => {
    expect(mapCategoryToSources("특허 출원 지원")).toEqual({ consultingDomain: "patent", sectionKey: "patent" });
  });
  it("고용·인건비는 hr + labor-subsidy 로", () => {
    expect(mapCategoryToSources("고용창출 장려금")).toEqual({ consultingDomain: "hr", sectionKey: "labor-subsidy" });
  });
  it("자금·융자·정책자금은 policy-fund + government-subsidy 로", () => {
    expect(mapCategoryToSources("중소기업 정책자금 융자")).toEqual({ consultingDomain: "policy-fund", sectionKey: "government-subsidy" });
  });
  it("모르는 분야는 기본값(policy-fund + government-subsidy)", () => {
    expect(mapCategoryToSources("")).toEqual({ consultingDomain: "policy-fund", sectionKey: "government-subsidy" });
    expect(mapCategoryToSources("기타 지원")).toEqual({ consultingDomain: "policy-fund", sectionKey: "government-subsidy" });
  });
});

describe("★기업마당이 실제로 쓰는 분야 여덟 가지", () => {
  // 실측(2026-08-25): 모집중 공고 1,521건의 분야는 아래 여덟 가지뿐이다.
  // 예전 규칙은 「고용·인건비·인증」 같은 낱말을 찾아 **한 건도 안 걸렸고**,
  // 그 결과 공고 전부가 기본값 한 칸만 뒤져 자료실 1,171건이 사장돼 있었다.
  it("「인력」 공고는 인사 자료실로 간다", () => {
    expect(mapCategoryToSources("인력").consultingDomain).toBe("hr");
  });

  it("「기술」 공고는 인증 자료실로 간다", () => {
    expect(mapCategoryToSources("기술").consultingDomain).toBe("cert");
  });

  it("자금 성격인 나머지는 정책자금 자료실로 간다", () => {
    for (const c of ["경영", "금융", "수출", "내수", "창업", "기타"]) {
      expect(mapCategoryToSources(c).consultingDomain, `${c} 분야`).toBe("policy-fund");
    }
  });

  it("여덟 분야가 하나도 빠짐없이 어딘가로 이어진다", () => {
    const 여덟 = ["경영", "기술", "수출", "금융", "인력", "내수", "창업", "기타"];
    for (const c of 여덟) {
      const m = mapCategoryToSources(c);
      expect(m.consultingDomain, `${c} 분야`).toBeTruthy();
      expect(m.sectionKey, `${c} 분야`).toBeTruthy();
    }
  });
});
