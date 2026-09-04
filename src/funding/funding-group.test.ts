import { describe, expect, it } from "vitest";
import { classifyFundingGroup, FUNDING_GROUP_META, FUNDING_GROUPS } from "./funding-group";

describe("classifyFundingGroup — 돈의 성격 6갈래(설계 §3-2)", () => {
  it("투자·펀드·TIPS·엔젤은 invest", () => {
    expect(classifyFundingGroup({ title: "TIPS 운영사 추천 창업기업 모집" })).toBe("invest");
    expect(classifyFundingGroup({ title: "2026 엔젤투자매칭펀드 안내" })).toBe("invest");
  });
  it("미소금융·햇살론·긴급·재해·폐업·재기는 urgent — 자금 낱말보다 먼저", () => {
    expect(classifyFundingGroup({ title: "긴급경영안정자금 융자 안내" })).toBe("urgent");
    expect(classifyFundingGroup({ title: "희망리턴패키지 점포철거비 지원" })).toBe("urgent");
    expect(classifyFundingGroup({ title: "미소금융 창업자금" })).toBe("urgent");
  });
  it("보증·안심통장·보증드림은 guarantee — 「지원사업 모집」이 붙어도", () => {
    expect(classifyFundingGroup({ title: "서울시 안심통장 4호 특례보증 시행" })).toBe("guarantee");
    expect(classifyFundingGroup({ title: "청년창업 특례보증 지원사업 참여기업 모집" })).toBe("guarantee");
    expect(classifyFundingGroup({ title: "인천 보증드림 마이너스통장형 보증" })).toBe("guarantee");
  });
  it("정책자금·융자·이차보전·육성기금·경영안정자금은 policy", () => {
    expect(classifyFundingGroup({ title: "2026년 하반기 관악구 중소기업육성자금 지원계획 공고" })).toBe("policy");
    expect(classifyFundingGroup({ title: "소상공인 이차보전 사업 안내" })).toBe("policy");
  });
  it("보조금·지원사업·바우처·모집·공모·무료는 grant", () => {
    expect(classifyFundingGroup({ title: "스마트상점 기술보급사업 3차 모집 공고" })).toBe("grant");
    expect(classifyFundingGroup({ title: "소상공인 무료보험 가입 지원" })).toBe("grant");
  });
  it("은행·인터넷은행·저축은행·캐피탈에서 온 상품은 글자와 무관하게 bank", () => {
    expect(classifyFundingGroup({ title: "사장님+ 마이너스통장", institutionType: "bank" })).toBe("bank");
    expect(classifyFundingGroup({ title: "보증서대출", institutionType: "internet-bank" })).toBe("bank");
  });
  it("아무 낱말도 없으면 우리 카테고리로 되돌아가고, 그것도 없으면 null", () => {
    expect(classifyFundingGroup({ title: "2026 청년 해외취업 연수", wedlyCategory: "무상지원금" })).toBe("grant");
    expect(classifyFundingGroup({ title: "기술개발 과제 공고", wedlyCategory: "정책자금" })).toBe("policy");
    expect(classifyFundingGroup({ title: "2026 예산안 편성 안내" })).toBeNull();
  });
  it("갈래 목록은 화면 순서 6개", () => {
    expect([...FUNDING_GROUPS]).toEqual(["grant", "policy", "guarantee", "bank", "urgent", "invest"]);
  });
});

describe("classifyFundingGroup — R1 규칙 보강(리뷰 중요6, 2026-09-03)", () => {
  it("「투자」낱말이 들어가도 설비투자·투자기업·투자보조는 invest 가 아니라 grant", () => {
    expect(classifyFundingGroup({ title: "중소기업 설비투자 지원사업" })).toBe("grant");
    expect(classifyFundingGroup({ title: "외국인투자기업 고용보조금" })).toBe("grant");
    expect(classifyFundingGroup({ title: "스마트공장 구축 투자 보조금" })).toBe("grant");
  });
  it("「재난안전산업 육성 지원사업」은 재해·재난 피해가 아니라 산업 육성이라 grant", () => {
    expect(classifyFundingGroup({ title: "재난안전산업 육성 지원사업" })).toBe("grant");
  });
  it("「품질보증 체계 구축 컨설팅」은 보증 상품이 아니라 컨설팅 지원이라 grant", () => {
    expect(classifyFundingGroup({ title: "품질보증 체계 구축 컨설팅" })).toBe("grant");
  });
  it("「신용보증기금 협약보증 연계 판로개척 지원사업」은 보증 상품 자체가 아니라 grant", () => {
    expect(classifyFundingGroup({ title: "신용보증기금 협약보증 연계 판로개척 지원사업" })).toBe("grant");
  });
  it("실제 투자 유치·긴급·특례보증은 그대로 유지된다", () => {
    expect(classifyFundingGroup({ title: "TIPS 운영사 추천 창업기업 모집" })).toBe("invest");
    expect(classifyFundingGroup({ title: "2026 엔젤투자매칭펀드 안내" })).toBe("invest");
    expect(classifyFundingGroup({ title: "긴급경영안정자금 융자" })).toBe("urgent");
    expect(classifyFundingGroup({ title: "서울시 안심통장 4호 특례보증 시행" })).toBe("guarantee");
  });
  it("grant 로 걸려도 본문에 실제 대출금리(연 N%)가 있으면 policy 로 되돌린다", () => {
    expect(classifyFundingGroup({ title: "소상공인 지원사업 안내", rateText: "연 2.0%" })).toBe("policy");
  });
  it("rateText 가 없거나 대출금리 모양이 아니면 grant 그대로", () => {
    expect(classifyFundingGroup({ title: "소상공인 지원사업 안내" })).toBe("grant");
    expect(classifyFundingGroup({ title: "소상공인 지원사업 안내", rateText: "보증료 연 0.6%" })).toBe("grant");
  });
});

/**
 * ★재설계 계약 G1③(2026-09-04·시안 3) — 6갈래 이름표에 who(누구를 위한 돈인지 한 줄)·example(실제 예)을
 * 더하고, tone 을 3색(green/blue/gray/gold)에서 6갈래 각자 다른 색으로 넓혔다. 카드·표의 색은 전부
 * 이 값에서만 나온다(G2 — raw 색 금지와 같은 이유로, 갈래 색이 흩어지지 않게 한곳에 못박는다).
 */
describe("FUNDING_GROUP_META — 6갈래 이름표(재설계 계약 G1③)", () => {
  it("6갈래 모두 who·example 을 갖는다 — 빈 갈래가 없다", () => {
    expect(Object.keys(FUNDING_GROUP_META)).toHaveLength(6);
    for (const g of FUNDING_GROUPS) {
      expect(FUNDING_GROUP_META[g].who.length).toBeGreaterThan(0);
      expect(FUNDING_GROUP_META[g].example.length).toBeGreaterThan(0);
    }
  });
  it("tone 은 갈래마다 다른 6색이다", () => {
    const tones = FUNDING_GROUPS.map((g) => FUNDING_GROUP_META[g].tone);
    expect(new Set(tones).size).toBe(6);
  });
  it("tone 값은 계약대로 grant=green·policy=blue·guarantee=purple·bank=navy·urgent=gold·invest=teal", () => {
    expect(FUNDING_GROUP_META.grant.tone).toBe("green");
    expect(FUNDING_GROUP_META.policy.tone).toBe("blue");
    expect(FUNDING_GROUP_META.guarantee.tone).toBe("purple");
    expect(FUNDING_GROUP_META.bank.tone).toBe("navy");
    expect(FUNDING_GROUP_META.urgent.tone).toBe("gold");
    expect(FUNDING_GROUP_META.invest.tone).toBe("teal");
  });
  it("who·example 은 시안 문구 그대로다", () => {
    expect(FUNDING_GROUP_META.grant.who).toBe("갚지 않는 돈 — 선정되면 사업비를 지원");
    expect(FUNDING_GROUP_META.grant.example).toBe("스마트상점 기술보급");
    expect(FUNDING_GROUP_META.policy.who).toBe("정부·지자체가 이자를 낮춰 주는 대출");
    expect(FUNDING_GROUP_META.policy.example).toBe("관악구 육성자금 연 1.5%");
    expect(FUNDING_GROUP_META.guarantee.who).toBe("보증서로 담보 없이 은행 대출");
    expect(FUNDING_GROUP_META.guarantee.example).toBe("서울 안심통장 2천만원");
    expect(FUNDING_GROUP_META.bank.who).toBe("은행 앱·창구에서 바로 신청하는 대출");
    expect(FUNDING_GROUP_META.bank.example).toBe("케이뱅크 사장님 신용대출");
    expect(FUNDING_GROUP_META.urgent.who).toBe("신용이 낮거나 위기일 때 먼저 볼 곳");
    expect(FUNDING_GROUP_META.urgent.example).toBe("미소금융 · 희망리턴");
    expect(FUNDING_GROUP_META.invest.who).toBe("지분을 주고 받는 돈 — 상환 없음");
    expect(FUNDING_GROUP_META.invest.example).toBe("TIPS R&D 5억");
  });
  it("name·sub 는 예전 그대로다 — 재설계는 확장이지 재정의가 아니다", () => {
    expect(FUNDING_GROUP_META.grant.name).toBe("안 갚아도 되는 돈");
    expect(FUNDING_GROUP_META.grant.sub).toBe("보조금 · 지원사업 · 바우처");
    expect(FUNDING_GROUP_META.bank.name).toBe("은행에서 바로");
    expect(FUNDING_GROUP_META.bank.sub).toBe("사업자 신용대출 · 마이너스통장");
  });
});
