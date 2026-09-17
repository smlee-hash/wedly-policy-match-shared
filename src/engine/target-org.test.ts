import { describe, expect, it } from "vitest";
import { profileOrgTypes, targetOrgsInTitle, uncertainTargetOrgsInTitle } from "./target-org";
import { titleTargetOrgCondition } from "./rule-extract";
import { checkCondition } from "./match-engine";
import { fitVerdictOf } from "./recommend-score";

describe("targetOrgsInTitle — 제목의 대상 선언 자리만", () => {
  it("착한가격업소 신규모집은 「되려는 기업」 공고라 조건을 만들지 않는다(2차 리뷰 M-B)", () => {
    expect(targetOrgsInTitle("[전남광주] 목포시 2026년 착한가격업소 신규모집 공고")).toEqual([]);
  });

  it("(예비)사회적기업 사업개발비", () => {
    expect(targetOrgsInTitle("[충남] 2026년 (예비)사회적기업 사업개발비 지원사업 참여기업 모집 공고")).toEqual(["사회적기업"]);
  });

  it("사회적경제기업 행사참여지원", () => {
    expect(targetOrgsInTitle("[경북] 김천시 2026년 4차 사회적경제기업 행사참여지원사업 참여기업 모집 공고")).toEqual(["사회적경제"]);
  });

  it("중소기업 판로개척은 자격 유형이 아니다", () => {
    expect(targetOrgsInTitle("2026년 중소기업 판로개척 지원사업")).toEqual([]);
  });

  it("「사회적기업과 협업」은 대상 선언 자리가 아니다 — 협업은 선언 낱말이 아니다", () => {
    expect(targetOrgsInTitle("사회적기업과 협업하는 중소기업 모집")).toEqual([]);
  });
});

describe("profileOrgTypes — 프로필 기업 형태 문구", () => {
  it("사회적기업(인증)은 사회적기업", () => {
    expect(profileOrgTypes(["사회적기업(인증)"])).toEqual(["사회적기업"]);
  });

  it("비었으면 빈 배열", () => {
    expect(profileOrgTypes(undefined)).toEqual([]);
    expect(profileOrgTypes([])).toEqual([]);
  });
});

describe("독립 리뷰 2026-09-17 반영 — 대상 선언 자리", () => {
  it("C1·F-2: 「예비창업자 및 재창업자 …」는 사전 밖 대상이 함께 적힌 제목이라 자격 조건을 아예 만들지 않는다", () => {
    expect(targetOrgsInTitle("로봇분야 예비창업자 및 재창업자를 위한 창업 성장 프로그램 참가자 모집")).toEqual([]);
  });

  it("H1·M1: 발주처로 쓰인 공공기관·대학은 사전에 없어 안 잡힌다", () => {
    expect(targetOrgsInTitle("2026년도 기술개발제품 공공기관 실증지원 사업 2차 공고")).toEqual([]);
    expect(targetOrgsInTitle("2026년 지역혁신중심 대학지원체계(RISE) 참여기업 모집 공고")).toEqual([]);
    expect(targetOrgsInTitle("해양수산부 기타공공기관 고객만족도 조사 주간사업자 선정 공고")).toEqual([]);
  });

  it("H1: 「마을기업 설립 전(입문) 교육」은 아직 그 자격이 아닌 사람이 대상이라 안 잡는다", () => {
    expect(targetOrgsInTitle("2026년 마을기업 설립 전(입문) 교육 3차 운영 안내")).toEqual([]);
  });

  it("M2: 나열 가운데 항목(협동조합)도 대상으로 읽는다", () => {
    expect(targetOrgsInTitle("2026년 사회적기업·협동조합·마을기업 지원사업 모집")).toEqual(
      expect.arrayContaining(["사회적기업", "협동조합", "마을기업"]),
    );
  });

  it("참 대상은 그대로 잡는다 — 사업 이름이 먼저 오는 제목", () => {
    expect(targetOrgsInTitle("[충남] 2026년 (예비)사회적기업 사업개발비 지원사업 참여기업 모집 공고")).toEqual(["사회적기업"]);
    expect(targetOrgsInTitle("[경북] 김천시 2026년 4차 사회적경제기업 행사참여지원사업 참여기업 모집 공고")).toEqual(["사회적경제"]);
  });
});

describe("2차 독립 리뷰(2026-09-17) 반영 — 조사·나열·되려는 기업", () => {
  it("H-A: 조사가 붙은 지나가는 말은 대상이 아니다", () => {
    expect(targetOrgsInTitle("2026년 사회적기업을 지원하는 중간지원조직 모집 공고")).toEqual([]);
    expect(targetOrgsInTitle("2026년 익산형 사회적기업가 육성사업 추가모집 공고")).toEqual([]);
  });

  it("M-A: 구분자가 껴도 부정 문맥을 본다", () => {
    expect(targetOrgsInTitle("2026년 사회적기업, 협동조합 등과 협력하는 중소기업 모집")).toEqual([]);
    expect(targetOrgsInTitle("마을기업 및 협동조합 등과 연계한 지원")).toEqual([]);
  });

  it("M-B: 그 자격을 새로 받으려는 공고(지정·신규모집·공모)는 자격 조건을 만들지 않는다", () => {
    expect(targetOrgsInTitle("[전남광주] 목포시 2026년 착한가격업소 신규모집 공고")).toEqual([]);
    expect(targetOrgsInTitle("2026년 상반기 착한가격업소 모집 공고")).toEqual([]);
    expect(targetOrgsInTitle("[전라남도] 2026년도 1차 예비사회적기업 지정 공모")).toEqual([]);
  });

  it("M-C: 창업·설립·양성 대상 공고도 만들지 않는다", () => {
    expect(targetOrgsInTitle("2026년도 사회적기업 창업지원사업 창업팀 모집 공고")).toEqual([]);
    expect(targetOrgsInTitle("마을기업 설립교육 수강생 모집")).toEqual([]);
  });

  it("이미 그 자격인 기업이 대상인 공고만 남는다", () => {
    expect(targetOrgsInTitle("[충남] 2026년 (예비)사회적기업 사업개발비 지원사업 참여기업 모집 공고")).toEqual(["사회적기업"]);
    expect(targetOrgsInTitle("[충남] 논산시 2026년 사회적경제기업 시설장비 지원사업 공고")).toEqual(["사회적경제"]);
    expect(targetOrgsInTitle("2026년 사회적기업·협동조합·마을기업 판로개척 지원사업")).toEqual(
      ["사회적기업", "협동조합", "마을기업"],
    );
  });
});

describe("3차 독립 리뷰(2026-09-17) 반영", () => {
  it("M-1: 「올해의 사회적기업 선정 계획 공고」는 이미 인증받은 기업이 대상이라 조건을 만든다", () => {
    expect(targetOrgsInTitle("2026년 올해의 사회적기업 선정 계획 공고")).toEqual(["사회적기업"]);
  });

  it("M-2: 사업 이름 없이 문서 종류만 오는 제목은 대상 선언으로 보지 않는다", () => {
    expect(targetOrgsInTitle("고용노동부 예비사회적기업 공고")).toEqual([]);
    expect(targetOrgsInTitle("2026년 마을기업 안내")).toEqual([]);
  });

  it("M-3: 접미사 없는 자격(협동조합·소셜벤처)도 단독으로 잡는다", () => {
    expect(targetOrgsInTitle("2026년 협동조합 판로개척 지원사업 참여기업 모집")).toEqual(["협동조합"]);
    expect(targetOrgsInTitle("2026년 소셜벤처 성장지원 프로그램 참여기업 모집")).toEqual(["소셜벤처"]);
  });
});

describe("4차 독립 리뷰(2026-09-17) 반영", () => {
  it("F-2: 「등을/등 … 조직」처럼 조사·다른 대상이 이어지면 자격형이 아니다", () => {
    expect(targetOrgsInTitle("2026년 사회적기업 등을 지원하는 중간지원조직 모집 공고")).toEqual([]);
    expect(targetOrgsInTitle("2026년 사회적기업과 함께하는 나눔장터 참여업체 모집")).toEqual([]);
  });

  it("F-2: 나열 끝맺음 「등」은 그대로 다리로 쓴다", () => {
    expect(targetOrgsInTitle("2026년 사회적기업·협동조합 등 판로개척 지원사업")).toEqual(
      ["사회적기업", "협동조합"],
    );
  });

  it("L-3: 「공고(재공고)」처럼 여는 괄호가 붙어도 문서 종류뿐이면 제외", () => {
    expect(targetOrgsInTitle("2026년 제1차 고용노동부 예비사회적기업 공고(재공고)")).toEqual([]);
  });
});

describe("5차 독립 리뷰(2026-09-17) 반영", () => {
  it("5차 3: 「및」 뒤에 단체 이름이 오면 나열로 본다 — 사전 밖 이름이어도 방벽을 잃지 않는다", () => {
    expect(targetOrgsInTitle("2026년 마을기업 및 농어촌공동체회사 판로개척 지원사업")).toEqual(["마을기업"]);
    expect(targetOrgsInTitle("2026년 사회적기업 및 사회적협동조합 성장지원 사업")).toEqual(
      ["사회적기업", "협동조합"],
    );
  });

  it("5차 3: 「및·과」 뒤가 용언이면 조사다 — 종전대로 자격형이 아니다", () => {
    expect(targetOrgsInTitle("2026년 사회적기업과 함께하는 나눔장터 참여업체 모집")).toEqual([]);
    expect(targetOrgsInTitle("로봇분야 예비창업자 및 재창업자를 위한 창업 성장 프로그램 참가자 모집")).toEqual([]);
  });

  it("5차 4: 「등과의·등으로」처럼 어떤 조사가 붙어도 나열 끝이 아니다", () => {
    expect(targetOrgsInTitle("2026년 사회적기업 등과의 협업 과제 공모")).toEqual([]);
    expect(targetOrgsInTitle("2026년 마을기업 등으로 구성된 컨소시엄 모집")).toEqual([]);
    expect(targetOrgsInTitle("2026년 사회적기업·협동조합 등 판로개척 지원사업")).toEqual(["사회적기업", "협동조합"]);
    // 관문 통과 갈래(구분자 다리 + 단체 이름)도 고정한다 — 좁히면 참 나열이 조용히 사라진다(8차 ②).
    expect(targetOrgsInTitle("2026년 마을기업·농어촌공동체회사 판로개척 지원사업")).toEqual(["마을기업"]);
    expect(targetOrgsInTitle("2026년 사회적기업、사회적협동조합 성장지원")).toEqual(["사회적기업", "협동조합"]);
  });
});

describe("6차 독립 리뷰(2026-09-17) 반영", () => {
  it("F2: 「및」 뒤가 일반 기업 낱말이면 나열이 아니다 — 일반 공고가 자격형으로 뒤바뀌지 않는다", () => {
    expect(targetOrgsInTitle("2026년 사회적기업 및 중소기업 상생협력 지원사업")).toEqual([]);
    expect(targetOrgsInTitle("2026년 마을기업 및 유망기업 판로지원")).toEqual([]);
    expect(targetOrgsInTitle("2026년 협동조합 및 소상공인지원센터 운영 지원사업")).toEqual([]);
  });

  it("F2: 자격·조직 이름이 오면 종전대로 나열로 본다", () => {
    expect(targetOrgsInTitle("2026년 마을기업 및 농어촌공동체회사 판로개척 지원사업")).toEqual(["마을기업"]);
  });
});

describe("7차 독립 리뷰(2026-09-17) 반영", () => {
  it("M-1: 구분자 다리도 같은 잣대로 본다 — 「사회적기업·중소기업 상생협력」은 자격형이 아니다", () => {
    expect(targetOrgsInTitle("2026년 사회적기업·중소기업 상생협력 지원사업")).toEqual([]);
    expect(targetOrgsInTitle("2026년 마을기업, 소상공인 판로지원")).toEqual([]);
    expect(targetOrgsInTitle("2026년 사회적기업·협동조합 등 판로개척 지원사업")).toEqual(["사회적기업", "협동조합"]);
    // 관문 통과 갈래(구분자 다리 + 단체 이름)도 고정한다 — 좁히면 참 나열이 조용히 사라진다(8차 ②).
    expect(targetOrgsInTitle("2026년 마을기업·농어촌공동체회사 판로개척 지원사업")).toEqual(["마을기업"]);
    expect(targetOrgsInTitle("2026년 사회적기업、사회적협동조합 성장지원")).toEqual(["사회적기업", "협동조합"]);
  });

  it("M-2: 「예비창업자」는 공고가 주는 자격이 아니라 상태라 모집·양성 제목에서도 조건을 만든다", () => {
    expect(targetOrgsInTitle("2026년 예비창업자 모집 공고")).toEqual(["예비창업자"]);
    expect(targetOrgsInTitle("2026년 예비창업자 양성과정 참가자 모집")).toEqual(["예비창업자"]);
    expect(targetOrgsInTitle("중장년 예비창업자 맞춤형 창업교육")).toEqual(["예비창업자"]);
    expect(targetOrgsInTitle("2026년 예비창업자 등과의 협업 과제 공모")).toEqual([]);
  });

  it("M-2 대조: 착한가격업소·사회적기업처럼 공고가 주는 자격은 종전대로 제외", () => {
    expect(targetOrgsInTitle("2026년 상반기 착한가격업소 모집 공고")).toEqual([]);
    expect(targetOrgsInTitle("[전라남도] 2026년도 1차 예비사회적기업 지정 공모")).toEqual([]);
  });
});

describe("8차 독립 리뷰(2026-09-17) 반영", () => {
  // 아래 세 제목은 실측 제목이 아니라 **구성한 변형**이다(khidi 의 「유치사업자 및 예비창업자」는 본문 문단,
  // kiria 실측 제목은 어순이 반대다 — 9차 M-2). 코퍼스에 없는 꼴이라 회귀 그물로만 쓴다.
  it("①: 앞에 다른 공동 대상이 나열되면 확신 대상이 아니다(구성 변형)", () => {
    expect(targetOrgsInTitle("외국인환자 유치사업자 및 예비창업자 모집 공고")).toEqual([]);
    expect(targetOrgsInTitle("2026년 소상공인·예비창업자 창업교육")).toEqual([]);
  });

  it("11차 ②: 확신 자리가 없어도 나열 속 상태형은 조건으로 남아 「맞음 금지」를 지킨다", () => {
    const c = titleTargetOrgCondition("2026년 소상공인·예비창업자 창업교육")!;
    expect(c.value).toEqual(["예비창업자"]);
    expect(c.machineReadable).toBe(true);
    const NOW = new Date("2026-09-17T00:00:00Z");
    const region = { condition: { key: "region" as const, op: "in" as const, value: ["경기"], rawText: "r", machineReadable: true }, verdict: "pass" as const, note: "" };
    // 형태를 모르는 회사(대다수)는 unknown → 지역 pass 가 있어도 「맞음」이 아니다.
    expect(fitVerdictOf([region, checkCondition(c, { companyScale: "중소기업", foundedDate: "2010-01-01" }, NOW)])).toBe("unverified");
  });

  it("11차 ①·10차 M-1: 나열을 합쳐 담아 두 참 대상 모두 pass, 빠진 대상의 fail 은 없다", () => {
    const c = titleTargetOrgCondition("2026년 사회적기업 지원사업 및 예비창업자 모집 공고")!;
    expect(c.value).toEqual(["사회적기업", "예비창업자"]);
    expect(c.machineReadable).toBe(true);
    const NOW = new Date("2026-09-17T00:00:00Z");
    expect(checkCondition(c, { orgTypes: ["사회적기업(인증)"] }, NOW).verdict).toBe("pass");
    expect(checkCondition(c, { orgTypes: ["예비창업자"] }, NOW).verdict).toBe("pass");
    expect(checkCondition(c, {}, NOW).verdict).toBe("unknown");
  });

  it("①: 앞에 나열이 없으면 종전대로 상태형 예외를 준다", () => {
    expect(targetOrgsInTitle("2026년 예비창업자 모집 공고")).toEqual(["예비창업자"]);
    expect(targetOrgsInTitle("중장년 예비창업자 맞춤형 창업교육")).toEqual(["예비창업자"]);
  });
});
