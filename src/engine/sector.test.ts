import { describe, expect, it } from "vitest";
import { sectorFamiliesInTitle, sectorFamiliesOfIndustry } from "./sector";
import { checkCondition } from "./match-engine";
import { titleSectorCondition } from "./rule-extract";

describe("sectorFamiliesInTitle — 제목의 「○○기업」만", () => {
  it("혁신형 제약기업은 제약바이오", () => {
    expect(sectorFamiliesInTitle("2026년 혁신형 제약기업 신규인증 공고")).toEqual(["제약바이오"]);
  });

  it("식품외식기업은 식품(낱말 둘이 붙어도 같은 가족)", () => {
    expect(sectorFamiliesInTitle("2026년 식품외식기업 청년 인턴십 지원사업 참가기업 추가모집 공고")).toEqual(["식품"]);
  });

  it("산림분야와 참여기업 사이에 다른 말이 있으면 잡지 않는다", () => {
    expect(sectorFamiliesInTitle("2026년 산림분야 오픈이노베이션 참여기업 모집 공고")).toEqual([]);
  });

  it("수출·중소기업처럼 분야가 아닌 수식어는 잡지 않는다", () => {
    expect(sectorFamiliesInTitle("2026년 2차 온라인수출 중소기업 물류 지원 사업")).toEqual([]);
  });

  it("블록체인 기업(띄어쓰기)은 정보통신", () => {
    expect(sectorFamiliesInTitle("싱가포르 현지 진출 지원 국내 블록체인 기업 모집 공고")).toEqual(["정보통신"]);
  });
});

describe("sectorFamiliesOfIndustry — 회사 업종 문구", () => {
  it("도배·목공은 건설", () => {
    expect(sectorFamiliesOfIndustry("도배, 실내 장식 및 내장 목공사업")).toEqual(["건설"]);
  });

  it("제조업(식품)은 식품", () => {
    expect(sectorFamiliesOfIndustry("제조업(식품)")).toEqual(["식품"]);
  });

  it("제조업만 있으면 너무 넓어서 빈 배열", () => {
    expect(sectorFamiliesOfIndustry("제조업")).toEqual([]);
  });

  it("의약품 도매·건강기능식품은 제약바이오·유통·식품을 포함한다", () => {
    const fams = sectorFamiliesOfIndustry("서비스업/도매 및 소매업/의약품 판매 대리/건강기능식품/");
    expect(fams).toEqual(expect.arrayContaining(["제약바이오", "유통", "식품"]));
  });
});

describe("독립 리뷰 2026-09-16 반영 — 확신 없는 fail 을 없앤다", () => {
  const NOW = new Date("2026-09-16T00:00:00Z");
  const c = (title: string) => titleSectorCondition(title)!;

  it("지적 1: 콘텐츠 공고 × 게임 소프트웨어 회사는 fail 이 아니다(게임은 두 가족 모두)", () => {
    expect(sectorFamiliesOfIndustry("게임 소프트웨어 개발 및 공급업")).toEqual(expect.arrayContaining(["정보통신", "콘텐츠"]));
    expect(checkCondition(c("2026년 문화콘텐츠 기업 보증 지원 공고"), { industry: "게임 소프트웨어 개발 및 공급업" }, NOW).verdict).toBe("pass");
  });

  it("지적 2: 「가공」은 기계금속이 아니다 — 식품 가공사가 식품 공고에서 안 떨어진다", () => {
    expect(sectorFamiliesOfIndustry("과실, 채소 가공 및 저장 처리업")).not.toContain("기계금속");
    expect(checkCondition(c("2026년 식품외식기업 청년 인턴십 지원사업"), { industry: "수산물 가공 및 저장 처리업" }, NOW).verdict).not.toBe("fail");
  });

  it("지적 3: 농식품 공고 × 농업 회사는 pass(농식품은 식품·농림어업 둘 다)", () => {
    expect(checkCondition(c("농식품기업 해외 인증 검사 지원 수요기업 모집공고"), { industry: "작물 재배업" }, NOW).verdict).toBe("pass");
  });

  it("지적 4: 「전자상거래 소매업」은 반도체전자가 아니다", () => {
    expect(sectorFamiliesOfIndustry("전자상거래 소매업")).not.toContain("반도체전자");
    expect(sectorFamiliesOfIndustry("전자상거래 소매업")).toContain("유통");
  });

  it("지적 5: 「기업지원사업」처럼 낱말이 이어지면 대상 선언이 아니다", () => {
    expect(sectorFamiliesInTitle("평창군 그린바이오 기업지원사업 위탁정산 회계법인 모집 재공고")).toEqual([]);
    expect(sectorFamiliesInTitle("2026년 8월 문화콘텐츠기업보증 공고")).toEqual([]);
  });

  it("지적 6: 이웃 분야는 fail 이 아니라 원문 확인 — 디지털 헬스케어 공고 × 소프트웨어 회사", () => {
    const r = checkCondition(c("정밀의료 디지털 헬스케어 기업 육성 사업 공고"), { industry: "응용 소프트웨어 개발 및 공급업" }, NOW);
    expect(r.verdict).toBe("unknown");
    expect(r.note).toContain("이웃 분야");
  });

  it("먼 분야는 그대로 fail — 제약기업 공고 × 도배·실내장식", () => {
    expect(checkCondition(c("2026년 혁신형 제약기업 신규인증 공고"), { industry: "도배, 실내 장식 및 내장 목공사업" }, NOW).verdict).toBe("fail");
  });

  it("사전 밖 분야 이름은 아무도 떨어뜨리지 않는다", () => {
    const bogus = { key: "targetSector" as const, op: "in" as const, value: ["제약"], rawText: "AI", machineReadable: true };
    expect(checkCondition(bogus, { industry: "도배, 실내 장식 및 내장 목공사업" }, NOW).verdict).toBe("unknown");
  });
});
