import { describe, expect, it } from "vitest";
import { extractConditions, ruleGradeOf, RULE_SOURCE_PREFIX } from "./rule-extract";
import type { ConditionCheck, StructuredCondition } from "./structure-types";

function pick(cs: StructuredCondition[], key: string) {
  return cs.find((c) => c.key === key);
}

describe("extractConditions — 업력", () => {
  it("「업력 3년 이내」를 상한 3으로 읽는다", () => {
    const c = pick(extractConditions("공고일 기준 업력 3년 이내인 초기창업기업"), "businessAgeMaxYears");
    expect(c?.value).toBe(3);
    expect(c?.op).toBe("lte");
    expect(c?.machineReadable).toBe(true);
  });

  it("「창업 7년 미만」도 상한으로 읽는다 — 7년은 못 들어가므로 6", () => {
    expect(pick(extractConditions("전국 소재 창업 7년 미만 스타트업"), "businessAgeMaxYears")?.value).toBe(6);
  });

  it("「업력 3년 이상」은 하한으로 읽는다", () => {
    const c = pick(extractConditions("업력 3년 이상 기업"), "businessAgeMinYears");
    expect(c?.value).toBe(3);
    expect(c?.op).toBe("gte");
  });

  it("방향을 안 밝힌 서술은 조건으로 읽지 않는다", () => {
    // 「업력 3년차」는 조건이 아니라 설명이다 — 조건으로 오해하면 멀쩡한 회사가 걸린다.
    expect(pick(extractConditions("업력 3년차 기업의 사례"), "businessAgeMaxYears")).toBeUndefined();
    expect(pick(extractConditions("업력 3년차 기업의 사례"), "businessAgeMinYears")).toBeUndefined();
  });
});

describe("extractConditions — 직원 수", () => {
  it("「상시 근로자 5인 이상」을 하한 5로 읽는다", () => {
    const c = pick(extractConditions("중소기업으로서 상시 근로자 5인 이상인 기업"), "employeeMin");
    expect(c?.value).toBe(5);
    expect(c?.op).toBe("gte");
  });

  it("「상시근로자 10명 이하」를 상한으로 읽는다", () => {
    expect(pick(extractConditions("상시근로자 10명 이하 소상공인"), "employeeMax")?.value).toBe(10);
  });
});

describe("extractConditions — 매출", () => {
  it("「매출액 200억원 이하」를 원 단위로 바꾼다", () => {
    expect(pick(extractConditions("최근 3년 매출액 평균 200억원 이하 기업"), "revenueMaxKrw")?.value).toBe(20_000_000_000);
  });

  it("쉼표가 든 숫자도 읽는다", () => {
    expect(pick(extractConditions("연매출 1,000억원 이상 기업"), "revenueMinKrw")?.value).toBe(100_000_000_000);
  });

  it("단위가 없으면 원으로 본다", () => {
    expect(pick(extractConditions("매출액 50000000원 이하"), "revenueMaxKrw")?.value).toBe(50_000_000);
  });
});

describe("extractConditions — 기업 규모·세금", () => {
  it("글자로 나온 규모를 모은다", () => {
    const c = pick(extractConditions("중소기업 및 소상공인 대상"), "companyScale");
    expect(c?.value).toEqual(["중소기업", "소상공인"]);
    expect(c?.op).toBe("in");
  });

  it("「체납」이 나오면 체납 없음 요구로 본다", () => {
    expect(pick(extractConditions("국세 및 지방세 체납이 없는 기업"), "noTaxDelinquency")?.value).toBe(true);
  });

  it("아무 조건도 없으면 빈 목록", () => {
    expect(extractConditions("교육장 사진을 첨부하세요")).toEqual([]);
    expect(extractConditions("")).toEqual([]);
  });
});

describe("extractConditions — 「미만」은 그 수를 뺀다", () => {
  // 대조기의 비교는 「이하」뿐이라 5를 그대로 담으면 정확히 5명인 회사가 통과해 틀린 「가능」이 된다.
  it("「상시근로자 5인 미만」은 4로 담는다", () => {
    expect(pick(extractConditions("상시근로자 5인 미만 기업"), "employeeMax")?.value).toBe(4);
  });

  it("「업력 3년 미만」은 2로 담는다", () => {
    expect(pick(extractConditions("창업 3년 미만 기업"), "businessAgeMaxYears")?.value).toBe(2);
  });

  it("「이하」·「이내」는 그대로 담는다", () => {
    expect(pick(extractConditions("상시근로자 5인 이하 기업"), "employeeMax")?.value).toBe(5);
    expect(pick(extractConditions("업력 3년 이내 기업"), "businessAgeMaxYears")?.value).toBe(3);
  });

  it("매출 「미만」도 한 칸 낮춘다", () => {
    expect(pick(extractConditions("매출액 200억원 미만"), "revenueMaxKrw")?.value).toBe(19_999_999_999);
  });
});

describe("extractConditions — 뒤집는 말이 붙으면 기계 판정에서 뺀다", () => {
  // 조건을 지우면 조건이 줄어 오히려 「전부 통과 = 가능」에 가까워진다 — 그래서 지우지 않고
  // machineReadable 을 내려 「원문 확인」으로 만든다(판정은 「확인 필요」로 내려간다).
  it("「업력 3년 이내 기업은 제외」는 기계 판정에서 뺀다", () => {
    const c = pick(extractConditions("업력 3년 이내 기업은 제외합니다"), "businessAgeMaxYears");
    expect(c).toBeDefined();
    expect(c?.machineReadable).toBe(false);
  });

  it("「중소기업이 아닌 곳」도 기계 판정에서 뺀다", () => {
    expect(pick(extractConditions("중소기업이 아닌 기관"), "companyScale")?.machineReadable).toBe(false);
  });

  it("뒤집는 말이 없으면 그대로 기계 판정한다", () => {
    expect(pick(extractConditions("업력 3년 이내 기업 지원"), "businessAgeMaxYears")?.machineReadable).toBe(true);
    expect(pick(extractConditions("중소기업 대상"), "companyScale")?.machineReadable).toBe(true);
  });
});

describe("extractConditions — 남기는 원문", () => {
  it("규칙으로 뽑았다는 표식을 원문 앞에 붙인다", () => {
    const c = pick(extractConditions("공고일 기준 업력 3년 이내인 기업"), "businessAgeMaxYears");
    expect(c?.rawText.startsWith(RULE_SOURCE_PREFIX)).toBe(true);
    expect(c?.rawText).toContain("업력 3년 이내");
  });
});

describe("ruleGradeOf — 규칙만으로는 「가능」도 「불가」도 못 만든다", () => {
  const check = (verdict: ConditionCheck["verdict"]): ConditionCheck => ({
    condition: { key: "companyScale", op: "in", value: ["중소기업"], rawText: "x", machineReadable: true },
    verdict,
    note: "",
  });

  it("어긋난 조건이 있어도 「불가」가 아니라 「확인 필요」", () => {
    // 글자만 보는 추출이라 문맥을 놓칠 수 있다 — 받을 수 있는 공고를 지우는 것이 가장 나쁜 실패다.
    expect(ruleGradeOf([check("pass"), check("fail")])).toBe("uncertain");
    expect(ruleGradeOf([check("fail")])).toBe("uncertain");
  });

  it("★모두 통과여도 「가능」이 아니다", () => {
    // 규칙이 진짜 조건을 못 뽑은 공고가 「전부 통과」로 읽혀 틀린 「가능」이 되던 실패
    // (2026-08-25 적대적 리뷰에서 6건 재현). 영업이 이 목록으로 고객에게 연락한다.
    expect(ruleGradeOf([check("pass"), check("pass")])).toBe("uncertain");
    expect(ruleGradeOf([check("pass")])).toBe("uncertain");
  });

  it("모르는 것이 섞이면 「확인 필요」", () => {
    expect(ruleGradeOf([check("pass"), check("unknown")])).toBe("uncertain");
  });

  it("조건이 하나도 없으면 「확인 필요」", () => {
    expect(ruleGradeOf([])).toBe("uncertain");
  });
});

describe("extractConditions — 「만원」 단위", () => {
  // 「만」이 단위 목록에 없어 이 표기가 통째로 안 잡히던 것을 고쳤다(2026-08-25 적대적 리뷰).
  it("「매출액 5,000만원 이상」을 5천만원으로 읽는다", () => {
    expect(pick(extractConditions("매출액 5,000만원 이상 기업"), "revenueMinKrw")?.value).toBe(50_000_000);
  });

  it("「매출 3천만원 이하」도 읽는다", () => {
    expect(pick(extractConditions("연매출 3천만원 이하 소상공인"), "revenueMaxKrw")?.value).toBe(30_000_000);
  });
});

describe("업종·지역 추출(2026-08-30 신설 — 표본 150건에서 가장 잦은 두 축)", () => {
  const get = (text: string, key: string) => extractConditions(text).find((c) => c.key === key);

  it("업종 낱말을 모아 industry 조건으로 담는다", () => {
    const c = get("제조업, 정보통신산업, 지식서비스산업을 주업종으로 영위하는 법인", "industry");
    expect(c).toBeTruthy();
    expect(c!.value).toEqual(expect.arrayContaining(["제조업", "정보통신산업", "지식서비스산업"]));
    expect(c!.machineReadable).toBe(true);
  });

  it("업종이 부정문 안에 있으면 기계 대조에서 빼고 사람 확인으로 넘긴다", () => {
    const c = get("지원 제외대상 - 부동산업 및 임대업, 금융업은 신청할 수 없습니다", "industry");
    expect(c).toBeTruthy();
    expect(c!.machineReadable).toBe(false);
  });

  it("지역은 문맥 낱말(소재·관내·거주) 가까이의 시도만 담는다", () => {
    const c = get("부산 소재 신발기업으로 직전년도 수출실적 3천만USD 이하", "region");
    expect(c!.value).toEqual(["부산"]);
  });

  it("★지나가는 지명은 지역 조건이 되지 않는다 — 잘못 뽑으면 그 공고가 목록에서 사라진다", () => {
    // 접수처·주최기관으로만 나온 지명. 문맥 낱말이 없으니 조건을 만들지 않는다.
    expect(get("신청서는 서울 본원 접수창구로 제출하시기 바랍니다. 문의: 세종 정부청사", "region")).toBeUndefined();
    expect(get("2026년 대구경북 첨단산업 육성사업 공고", "region")).toBeUndefined();
  });

  it("시·군·구만 있고 시도를 못 읽으면 지역 조건을 만들지 않는다(사전 밖 표기 보호)", () => {
    expect(get("봉화군에서 한우를 사육하고 있는 관내 농가", "region")).toBeUndefined();
    expect(get("도내 여성인턴 채용기업", "region")).toBeUndefined();
  });

  it("붙여 쓴 복수 시도도 양쪽 다 담는다", () => {
    const c = get("대구경북 소재 중소기업", "region");
    expect(c!.value).toEqual(expect.arrayContaining(["대구", "경북"]));
  });

  it("여러 시도가 문맥 낱말 곁에 흩어져 있으면 모두 담는다", () => {
    const c = get("경기 소재 기업 또는 인천에 사업장을 둔 기업", "region");
    expect(c!.value).toEqual(expect.arrayContaining(["경기", "인천"]));
  });
});

import { titleRegionConditions } from "./rule-extract";

describe("titleRegionConditions — 제목 앞머리 「[광역] 시군구」", () => {
  it("정형 제목에서 광역(판정용)과 시군구(확인용)를 뽑는다", () => {
    const cs = titleRegionConditions("[경남] 진주시 2026년 해외지사화 지원사업 참여업체 모집 공고", "경상남도");
    expect(cs.find((c) => c.machineReadable)?.value).toEqual(["경남"]);
    expect(cs.find((c) => !c.machineReadable)?.value).toEqual(["진주시"]);
  });

  it("여러 시군구를 ㆍ 로 이어 쓴 것도 전부 뽑는다", () => {
    const cs = titleRegionConditions("[경남] 사천시ㆍ진주시 2026년 디지털전환(DX) 컨설팅 공고", "경상남도");
    expect(cs.find((c) => !c.machineReadable)?.value).toEqual(["사천시", "진주시"]);
  });

  it("대괄호가 광역이 아니면 아무것도 안 뽑는다 — 민간 태그 함정(실측: 「대구」가 '구'로 끝나 잡히던 것)", () => {
    expect(titleRegionConditions("[무료/선착순] 대구 피지컬AI & 공공데이터 활용 세미나", "메타코드에이치")).toEqual([]);
  });

  it("제목 광역과 기관 광역이 어긋나면 판정용 조건을 안 만든다 — 원본 표기 오류 방어(실측: 「[경남] 하남시」/기관 경기도)", () => {
    const cs = titleRegionConditions("[경남] 하남시 2026년 제2회 청년 채용 ZONE 참여기업 모집 연장 공고", "경기도");
    expect(cs.some((c) => c.machineReadable)).toBe(false);
    // 확인용 시군구는 남겨 영업이 볼 수 있게 한다
    expect(cs.find((c) => !c.machineReadable)?.value).toEqual(["하남시"]);
  });


  it("★태그가 두 광역을 합친 실제 표기 「[전남광주]」면 둘 다 담는다 — 하나만 담으면 여수시(전남) 회사가 자기 공고에서 제외된다(fable 리뷰 치명, 운영 158건)", () => {
    const cs = titleRegionConditions("[전남광주] 여수시 2026년 소상공인 융자금 이차보전 지원 계획 변경 공고", "전남광주통합특별시");
    const sido = cs.find((c) => c.machineReadable);
    expect(sido?.value).toEqual(["광주", "전남"]);
    expect(cs.find((c) => !c.machineReadable)?.value).toEqual(["여수시"]);
  });
  it("기관이 두 광역을 합친 이름이면 그중 하나만 맞아도 인정한다 — 「전남광주통합특별시」 실측 7건", () => {
    const cs = titleRegionConditions("[전남] 여수시 2026년 중소기업발전자금 지원계획 공고", "전남광주통합특별시");
    expect(cs.find((c) => c.machineReadable)?.value).toEqual(["전남"]);
  });

  it("기관에서 광역을 못 읽으면 제목을 믿는다", () => {
    const cs = titleRegionConditions("[경기] 수원시 2026년 중소기업육성자금 융자지원 계획 공고", "");
    expect(cs.find((c) => c.machineReadable)?.value).toEqual(["경기"]);
  });

  it("대괄호 직후가 시군구가 아니면 아무것도 안 뽑는다", () => {
    expect(titleRegionConditions("[전남광주] 2026년 예비사회적기업 지정계획 공고", "전남광주통합특별시")).toEqual([]);
    expect(titleRegionConditions("2026년 팁스(TIPS) 창업기업 지원계획 공고", "중소벤처기업부")).toEqual([]);
  });

  it("제목 뒤쪽의 지명은 절대 보지 않는다 — 「여수엑스포항」에서 「포항」이 잡히던 사고 방지", () => {
    const cs = titleRegionConditions("2026년 여수엑스포항 국제크루즈 관광객 유치 인센티브 지원 공고", "전남광주통합특별시");
    expect(cs).toEqual([]);
  });

  it("확인용 시군구 조건은 판정에 쓰이지 않는다(machineReadable=false)", () => {
    const cs = titleRegionConditions("[서울] 은평구 2026년 소규모 자영업자 LED간판 설치 지원사업 공고", "서울특별시");
    const gugun = cs.find((c) => !c.machineReadable);
    expect(gugun?.machineReadable).toBe(false);
    expect(gugun?.rawText).toContain(RULE_SOURCE_PREFIX);
  });
});

import { checkCondition } from "./match-engine";

describe("titleRegionConditions — 실제 판정까지 태워 본다(껍데기 시험 방지)", () => {
  it("「[전남광주] 여수시」 공고를 전남·여수시·광주 회사 모두 통과시킨다 — 오제외 없음", () => {
    const cs = titleRegionConditions("[전남광주] 여수시 2026년 소상공인 융자금 공고", "전남광주통합특별시");
    const sido = cs.find((c) => c.machineReadable)!;
    for (const region of ["전남", "전라남도 여수시 소호동", "광주"]) {
      expect(checkCondition(sido, { region } as never, new Date()).verdict).toBe("pass");
    }
  });

  it("「[경남] 진주시」 공고는 서울 회사에서 fail 이 난다 — 오추천이 실제로 막히는지", () => {
    const cs = titleRegionConditions("[경남] 진주시 2026년 해외지사화 지원사업 공고", "경상남도");
    const sido = cs.find((c) => c.machineReadable)!;
    expect(checkCondition(sido, { region: "서울특별시 강남구" } as never, new Date()).verdict).toBe("fail");
  });

  it("확인용 시군구 조건은 어떤 소재지를 넣어도 fail 이 안 난다", () => {
    const cs = titleRegionConditions("[경남] 진주시 2026년 산업재산권 권리화 지원 사업 공고", "경상남도");
    const gugun = cs.find((c) => !c.machineReadable)!;
    for (const region of ["서울", "경상남도 창원시", "전국", ""]) {
      expect(checkCondition(gugun, { region } as never, new Date()).verdict).not.toBe("fail");
    }
  });
});
