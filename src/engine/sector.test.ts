import { describe, expect, it } from "vitest";
import { relatedFamiliesOf, SECTOR_FAMILIES, SECTOR_FAMILY_NAMES, sectorFamiliesInTitle, sectorFamiliesOfIndustry } from "./sector";
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

describe("2차 독립 리뷰 반영 — 이웃 관계 대칭·부분 문자열 오판", () => {
  const NOW = new Date("2026-09-16T00:00:00Z");
  const c = (title: string) => {
    const cond = titleSectorCondition(title);
    expect(cond, `제목이 분야로 안 읽힘: ${title}`).not.toBeNull();
    return cond!;
  };

  it("지적 1: 이웃 관계는 양방향이다 — 사전이 한쪽만 적어도 판정이 같다", () => {
    for (const f of SECTOR_FAMILIES) {
      for (const r of f.relatedFamilies) {
        expect(SECTOR_FAMILY_NAMES.has(r), `${f.family} 의 이웃 ${r} 이 사전에 없다`).toBe(true);
        expect(relatedFamiliesOf([r]).has(f.family), `${r} → ${f.family} 역방향이 없다`).toBe(true);
      }
    }
  });

  it("지적 1: 호텔 × 외식기업, 음식점 × 관광기업이 같은 판정(unknown)", () => {
    expect(checkCondition(c("외식기업 해외진출 지원 공고"), { industry: "호텔업" }, NOW).verdict).toBe("unknown");
    expect(checkCondition(c("관광기업 육성 공고"), { industry: "음식점업" }, NOW).verdict).toBe("unknown");
  });

  it("지적 2: 플랫폼 공고 × 전자상거래, 그린바이오 공고 × 농업, 교육 공고 × 출판은 fail 이 아니다", () => {
    expect(checkCondition(c("온라인 플랫폼 기업 상생협력 지원 공고"), { industry: "전자상거래 소매업" }, NOW).verdict).toBe("unknown");
    expect(checkCondition(c("그린바이오 기업 육성사업 참여기업 모집"), { industry: "작물 재배업" }, NOW).verdict).toBe("unknown");
    expect(checkCondition(c("교육기업 해외진출 지원 공고"), { industry: "서적 출판업" }, NOW).verdict).toBe("unknown");
  });

  it("지적 4: 「광고 제작물 제작업」은 농림어업이 아니고 「인쇄회로」 제조사는 광고인쇄가 아니다", () => {
    expect(sectorFamiliesOfIndustry("광고 제작물 제작업")).not.toContain("농림어업");
    expect(sectorFamiliesOfIndustry("작물 재배업")).toContain("농림어업");
    expect(sectorFamiliesOfIndustry("인쇄회로기판 제조업")).not.toContain("광고인쇄");
    expect(sectorFamiliesOfIndustry("경성 인쇄회로기판 제조업")).toEqual(["반도체전자"]);
  });

  it("지적 6: 빈 분야 목록으로는 아무도 떨어뜨리지 않는다", () => {
    const empty = { key: "targetSector" as const, op: "in" as const, value: [] as string[], rawText: "AI", machineReadable: true };
    expect(checkCondition(empty, { industry: "도배, 실내 장식 및 내장 목공사업" }, NOW).verdict).toBe("unknown");
  });

  it("먼 분야는 여전히 fail — 제약기업 × 도배, 식품기업 × 철판 가공", () => {
    expect(checkCondition(c("2026년 혁신형 제약기업 신규인증 공고"), { industry: "도배, 실내 장식 및 내장 목공사업" }, NOW).verdict).toBe("fail");
    expect(checkCondition(c("2026년 식품기업 수출 지원 공고"), { industry: "철판 및 철판 가공" }, NOW).verdict).toBe("fail");
  });
});

describe("통합 리뷰(2026-09-17) 반영 — 합성어 안의 짧은 낱말", () => {
  const NOW = new Date("2026-09-17T00:00:00Z");
  it("F1: PCB 제조사는 반도체 공고에서 안 떨어진다", () => {
    const cond = titleSectorCondition("2026년 시스템반도체 기업 육성사업 공고")!;
    expect(cond).not.toBeNull();
    expect(checkCondition(cond, { industry: "경성 인쇄회로기판 제조업" }, NOW).verdict).toBe("pass");
  });
  it("F2: 「서양식 음식점업」은 농림어업이 아니라 식품 — 수산기업 공고에 맞음이 안 된다", () => {
    expect(sectorFamiliesOfIndustry("서양식 음식점업")).toEqual(["식품"]);
    const cond = titleSectorCondition("2026년 수산기업 수출 지원 공고")!;
    expect(checkCondition(cond, { industry: "서양식 음식점업" }, NOW).verdict).toBe("unknown");
    expect(checkCondition(cond, { industry: "넙치 양식업" }, NOW).verdict).toBe("pass");
  });
});

describe("통합 2차 리뷰(2026-09-17) 반영 — 가림은 가린 글로만 대조", () => {
  const NOW = new Date("2026-09-17T00:00:00Z");
  it("D1: 「한식양식업」은 농림어업이 아니다(가림이 실제로 듣는다)", () => {
    expect(sectorFamiliesOfIndustry("한식양식업")).toEqual([]);
    const cond = titleSectorCondition("2026년 수산기업 수출 지원 공고")!;
    expect(checkCondition(cond, { industry: "한식양식업" }, NOW).verdict).toBe("unknown");
  });
  it("D2: 「인쇄회로 설계업」은 반도체전자로 남는다(합성어 제 가족은 안 사라진다)", () => {
    expect(sectorFamiliesOfIndustry("인쇄회로 설계업")).toEqual(["반도체전자"]);
    expect(sectorFamiliesOfIndustry("인쇄회로 및 광고물 제작")).toEqual(expect.arrayContaining(["반도체전자", "광고인쇄"]));
    expect(sectorFamiliesOfIndustry("인쇄회로 및 광고물 제작")).not.toContain("콘텐츠");
  });
  it("D3: 「전기판매업」은 반도체전자가 아니다(두 글자 부분 문자열 「기판」 없음)", () => {
    expect(sectorFamiliesOfIndustry("전기판매업")).not.toContain("반도체전자");
  });
  it("D4: industry 조건 「인쇄」도 「인쇄회로기판 제조업」에 pass 를 주지 않는다", () => {
    const c = { key: "industry" as const, op: "in" as const, value: ["인쇄"], rawText: "인쇄업", machineReadable: true };
    expect(checkCondition(c, { industry: "경성 인쇄회로기판 제조업" }, NOW).verdict).toBe("unknown");
    expect(checkCondition(c, { industry: "옵셋 인쇄업" }, NOW).verdict).toBe("pass");
  });
});
