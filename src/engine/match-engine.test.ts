import { describe, expect, it } from "vitest";
import type { AnnouncementStructure, ConditionKey, ConditionOp, StructuredCondition } from "./structure-types";
import {
  UNREADABLE_STRUCTURE_NOTE,
  businessAgeYears,
  canonicalRegion,
  checkCondition,
  isCorporationByBizno,
  matchAnnouncement,
  parseBusinessProfile,
  readStoredStructure,
  type BusinessProfile,
} from "./match-engine";

const NOW = new Date("2026-08-22T00:00:00.000Z");

function cond(over: Partial<StructuredCondition> = {}): StructuredCondition {
  return {
    key: "region",
    op: "in",
    value: ["서울"],
    rawText: "서울 소재 중소기업",
    machineReadable: true,
    ...over,
  };
}

function structure(over: Partial<AnnouncementStructure> = {}): AnnouncementStructure {
  return {
    benefitSummary: "사업화 자금",
    supportAmountText: "최대 1억원",
    aiSummary: { purpose: "창업 지원", target: "중소기업", scale: "1억원", scaleItems: [] },
    conditions: [],
    humanCheck: [],
    documents: [],
    verified: true,
    ...over,
  };
}

/** 딱 N년 전 날짜(now 기준, 365.25일 환산) — 경계값 시험용. */
function foundedYearsAgo(years: number): string {
  return new Date(NOW.getTime() - years * 365.25 * 86_400_000).toISOString().slice(0, 10);
}

describe("businessAgeYears", () => {
  it("설립일이 없으면 null(모름)", () => {
    expect(businessAgeYears(undefined, NOW)).toBeNull();
    expect(businessAgeYears("", NOW)).toBeNull();
  });

  it("날짜가 아니면 null", () => {
    expect(businessAgeYears("어제", NOW)).toBeNull();
  });

  it("3년 전 설립이면 약 3년", () => {
    const age = businessAgeYears(foundedYearsAgo(3), NOW);
    expect(age).not.toBeNull();
    expect(age!).toBeCloseTo(3, 2);
  });
});

describe("checkCondition — 지역", () => {
  it("「전국」이면 소재지가 무엇이든 통과", () => {
    const c = cond({ value: ["전국"] });
    expect(checkCondition(c, { region: "제주" }, NOW).verdict).toBe("pass");
    expect(checkCondition(c, { region: "충북" }, NOW).verdict).toBe("pass");
  });

  it("소재지 미입력이면 unknown(모름)", () => {
    const r = checkCondition(cond(), {}, NOW);
    expect(r.verdict).toBe("unknown");
    expect(r.note).toContain("소재지");
  });

  it("긴 이름·짧은 이름 어느 쪽이든 서로 포함되면 통과", () => {
    expect(checkCondition(cond({ value: ["서울"] }), { region: "서울특별시" }, NOW).verdict).toBe("pass");
    expect(checkCondition(cond({ value: ["서울특별시"] }), { region: "서울" }, NOW).verdict).toBe("pass");
  });

  it("대상 지역이 아니면 fail 이고 사유에 지역 목록이 담긴다", () => {
    const r = checkCondition(cond({ value: ["부산", "울산"] }), { region: "서울" }, NOW);
    expect(r.verdict).toBe("fail");
    expect(r.note).toContain("부산·울산");
  });
});

describe("checkCondition — 지역 별칭(줄임말 ↔ 정식명)", () => {
  // 글자 포함으로만 대조하던 때는 공고 「충청북도」 vs 프로필 「충북」이 서로 안 걸려
  // 자격이 되는 회사에 「안 됨」이 나왔다. 표준형으로 바꾼 뒤 대조한다.
  it("충북 ↔ 충청북도 는 어느 쪽으로 적어도 통과", () => {
    expect(checkCondition(cond({ value: ["충청북도"] }), { region: "충북" }, NOW).verdict).toBe("pass");
    expect(checkCondition(cond({ value: ["충북"] }), { region: "충청북도" }, NOW).verdict).toBe("pass");
  });

  it("특별자치도 표기도 같은 곳으로 읽는다", () => {
    expect(checkCondition(cond({ value: ["전북특별자치도"] }), { region: "전북" }, NOW).verdict).toBe("pass");
    expect(checkCondition(cond({ value: ["강원특별자치도"] }), { region: "강원" }, NOW).verdict).toBe("pass");
    expect(checkCondition(cond({ value: ["제주특별자치도"] }), { region: "제주" }, NOW).verdict).toBe("pass");
    expect(checkCondition(cond({ value: ["세종특별자치시"] }), { region: "세종" }, NOW).verdict).toBe("pass");
  });

  it("전남광주 는 광주다 — 앞 두 글자만 보고 전남으로 읽지 않는다", () => {
    expect(checkCondition(cond({ value: ["전남광주"] }), { region: "광주" }, NOW).verdict).toBe("pass");
    expect(checkCondition(cond({ value: ["광주"] }), { region: "전남광주" }, NOW).verdict).toBe("pass");
    expect(checkCondition(cond({ value: ["전남"] }), { region: "전남광주" }, NOW).verdict).toBe("fail");
  });

  it("다른 지역은 별칭을 넣어도 여전히 불가", () => {
    expect(checkCondition(cond({ value: ["부산"] }), { region: "서울" }, NOW).verdict).toBe("fail");
    expect(checkCondition(cond({ value: ["부산광역시"] }), { region: "서울특별시" }, NOW).verdict).toBe("fail");
    expect(checkCondition(cond({ value: ["충청남도"] }), { region: "충북" }, NOW).verdict).toBe("fail");
  });

  it("시·군까지 붙은 표기도 시도로 읽는다", () => {
    expect(checkCondition(cond({ value: ["충청북도 청주시"] }), { region: "충북" }, NOW).verdict).toBe("pass");
    expect(checkCondition(cond({ value: ["경기"] }), { region: "경기도 성남시" }, NOW).verdict).toBe("pass");
  });

  it("사전에 없는 표기(수도권·청주시)는 글자 포함이면 pass, 미일치는 fail 이 아니라 「확인 필요」", () => {
    // 추천이 fail 을 목록 제외로 격상한 뒤로(2026-08-30), 확신 없는 fail 은 자격 있는
    // 회사에게서 공고를 지운다 — 시도를 못 읽는 표기의 미일치는 unknown 으로 남긴다(적대 리뷰 치명1).
    expect(checkCondition(cond({ value: ["수도권"] }), { region: "수도권 전역" }, NOW).verdict).toBe("pass");
    expect(checkCondition(cond({ value: ["수도권"] }), { region: "서울" }, NOW).verdict).toBe("unknown");
    expect(checkCondition(cond({ value: ["청주시"] }), { region: "충북" }, NOW).verdict).toBe("unknown");
  });

  it("붙여 쓴 복수 시도(「대구경북」)는 양쪽 시도 모두로 대조된다 — 뒤 시도가 삼켜지지 않는다", () => {
    expect(checkCondition(cond({ value: ["대구경북"] }), { region: "경북" }, NOW).verdict).toBe("pass");
    expect(checkCondition(cond({ value: ["대구경북"] }), { region: "대구" }, NOW).verdict).toBe("pass");
    // 시도가 읽히는 표기의 미일치는 확신 있는 fail — 여긴 그대로 떨어져야 한다.
    expect(checkCondition(cond({ value: ["대구경북"] }), { region: "전북" }, NOW).verdict).toBe("fail");
  });

  it("소재지를 「전국」으로 두면 지역 조건은 확인 필요(불가로 떨구지 않는다)", () => {
    const r = checkCondition(cond({ value: ["부산"] }), { region: "전국" }, NOW);
    expect(r.verdict).toBe("unknown");
    expect(r.note).toContain("전국");
  });
});

describe("canonicalRegion", () => {
  it("줄임말·정식명·시군 표기를 모두 같은 표준형으로 바꾼다", () => {
    expect(canonicalRegion("서울시")).toBe("서울");
    expect(canonicalRegion("서울특별시 강남구")).toBe("서울");
    expect(canonicalRegion("경상북도")).toBe("경북");
    expect(canonicalRegion("전라남도 여수시")).toBe("전남");
    expect(canonicalRegion("인천광역시")).toBe("인천");
  });

  it("사전에 없는 이름·빈 값은 null", () => {
    expect(canonicalRegion("수도권")).toBeNull();
    expect(canonicalRegion("")).toBeNull();
    expect(canonicalRegion(undefined)).toBeNull();
  });

  it("17개 시도가 모두 사전에 있다 — 하나라도 빠지면 그 지역만 조용히 옛 방식으로 돈다", () => {
    const 시도 = ["서울", "부산", "대구", "인천", "광주", "대전", "울산", "세종",
      "경기", "강원", "충북", "충남", "전북", "전남", "경북", "경남", "제주"];
    expect(시도.filter((r) => canonicalRegion(r) !== r)).toEqual([]);
  });
});

describe("checkCondition — 업종", () => {
  const c = cond({ key: "industry", value: ["제조", "정보통신"], rawText: "제조업 또는 정보통신업" });

  it("업종 문구에 키워드가 들어 있으면 통과", () => {
    expect(checkCondition(c, { industry: "전자부품 제조업" }, NOW).verdict).toBe("pass");
  });

  it("업종 미입력은 unknown", () => {
    expect(checkCondition(c, {}, NOW).verdict).toBe("unknown");
  });

  // 업종은 우리 표기(「소프트웨어 개발업」)와 공고 표기(「정보통신업」)가 자주 어긋난다.
  // 글자가 안 겹친다고 「안 됨」을 내면 자격 있는 회사를 떨어뜨린다(2026-08-22 리뷰 5번).
  it("키워드가 없어도 fail 이 아니라 unknown(표기 차이일 수 있다)", () => {
    const r = checkCondition(c, { industry: "음식점업" }, NOW);
    expect(r.verdict).toBe("unknown");
    expect(r.note).toContain("업종 표기");
  });
});

describe("checkCondition — 업력 경계값", () => {
  const max3 = cond({ key: "businessAgeMaxYears", op: "lte", value: 3, rawText: "업력 3년 이하" });
  const min3 = cond({ key: "businessAgeMinYears", op: "gte", value: 3, rawText: "업력 3년 이상" });
  // 업력은 365.25일=1년으로 재므로 「딱 3년」은 2023-08-23 00:00 → 2026-08-22 18:00 이다.
  // 이 시각을 기준으로 잡아야 경계(=3.000000년)를 실제로 밟아 본다.
  const AT_3Y = new Date("2026-08-22T18:00:00.000Z");
  const EXACT = "2023-08-23";

  it("업력이 딱 상한이면 통과한다(lte — 경계 포함)", () => {
    expect(businessAgeYears(EXACT, AT_3Y)).toBe(3);
    expect(checkCondition(max3, { foundedDate: EXACT }, AT_3Y).verdict).toBe("pass");
  });

  it("업력이 딱 하한이면 통과한다(gte — 경계 포함)", () => {
    expect(checkCondition(min3, { foundedDate: EXACT }, AT_3Y).verdict).toBe("pass");
  });

  it("하루라도 더 오래됐으면 상한 fail·하한 pass", () => {
    expect(checkCondition(max3, { foundedDate: "2023-08-22" }, AT_3Y).verdict).toBe("fail");
    expect(checkCondition(min3, { foundedDate: "2023-08-22" }, AT_3Y).verdict).toBe("pass");
  });

  it("하루라도 덜 됐으면 하한 fail·상한 pass", () => {
    expect(checkCondition(min3, { foundedDate: "2023-08-24" }, AT_3Y).verdict).toBe("fail");
    expect(checkCondition(max3, { foundedDate: "2023-08-24" }, AT_3Y).verdict).toBe("pass");
  });

  it("설립일 미입력은 상·하한 모두 unknown", () => {
    expect(checkCondition(max3, {}, NOW).verdict).toBe("unknown");
    expect(checkCondition(min3, {}, NOW).verdict).toBe("unknown");
  });

  // 설립일을 미래로 잘못 적으면 업력이 음수가 된다 — 그대로 두면 「업력 3년 이하」를 통과해 버린다.
  it("설립일이 미래면 업력을 못 믿는다 — 상·하한 모두 unknown", () => {
    const future = "2027-01-01";
    const up = checkCondition(max3, { foundedDate: future }, NOW);
    expect(up.verdict).toBe("unknown");
    expect(up.note).toContain("설립일");
    expect(checkCondition(min3, { foundedDate: future }, NOW).verdict).toBe("unknown");
  });
});

describe("checkCondition — 매출·직원 수 경계값", () => {
  const revMax = cond({ key: "revenueMaxKrw", op: "lte", value: 1_000_000_000, rawText: "연매출 10억원 이하" });
  const revMin = cond({ key: "revenueMinKrw", op: "gte", value: 100_000_000, rawText: "연매출 1억원 이상" });
  const empMax = cond({ key: "employeeMax", op: "lte", value: 10, rawText: "상시근로자 10명 이하" });
  const empMin = cond({ key: "employeeMin", op: "gte", value: 5, rawText: "상시근로자 5명 이상" });

  it("매출이 딱 상한이면 통과, 1원 넘으면 fail", () => {
    expect(checkCondition(revMax, { lastYearRevenueKrw: 1_000_000_000 }, NOW).verdict).toBe("pass");
    expect(checkCondition(revMax, { lastYearRevenueKrw: 1_000_000_001 }, NOW).verdict).toBe("fail");
  });

  it("매출이 딱 하한이면 통과, 1원 모자라면 fail", () => {
    expect(checkCondition(revMin, { lastYearRevenueKrw: 100_000_000 }, NOW).verdict).toBe("pass");
    expect(checkCondition(revMin, { lastYearRevenueKrw: 99_999_999 }, NOW).verdict).toBe("fail");
  });

  it("매출 0원도 모름이 아니라 판정한다(0 은 값이다)", () => {
    expect(checkCondition(revMax, { lastYearRevenueKrw: 0 }, NOW).verdict).toBe("pass");
    expect(checkCondition(revMin, { lastYearRevenueKrw: 0 }, NOW).verdict).toBe("fail");
  });

  it("매출 미입력은 unknown", () => {
    expect(checkCondition(revMax, {}, NOW).verdict).toBe("unknown");
    expect(checkCondition(revMin, {}, NOW).verdict).toBe("unknown");
  });

  it("직원 수 경계값(딱 상한·딱 하한) 통과, 0명도 판정", () => {
    expect(checkCondition(empMax, { employeeCount: 10 }, NOW).verdict).toBe("pass");
    expect(checkCondition(empMax, { employeeCount: 11 }, NOW).verdict).toBe("fail");
    expect(checkCondition(empMin, { employeeCount: 5 }, NOW).verdict).toBe("pass");
    expect(checkCondition(empMin, { employeeCount: 0 }, NOW).verdict).toBe("fail");
    expect(checkCondition(empMax, {}, NOW).verdict).toBe("unknown");
    expect(checkCondition(empMin, {}, NOW).verdict).toBe("unknown");
  });
});

describe("checkCondition — 규모·체납·인증·특허", () => {
  const scale = cond({ key: "companyScale", value: ["중소기업", "소상공인"], rawText: "중소기업 또는 소상공인" });
  const noTax = cond({ key: "noTaxDelinquency", op: "eq", value: true, rawText: "국세·지방세 체납이 없을 것" });
  const certReq = cond({ key: "certRequired", op: "eq", value: true, rawText: "벤처기업 인증 보유" });
  const patentReq = cond({ key: "patentRequired", op: "eq", value: true, rawText: "특허 보유 기업" });

  it("기업 규모는 서로 포함되면 통과, 아니면 fail, 미입력은 unknown", () => {
    expect(checkCondition(scale, { companyScale: "중소기업" }, NOW).verdict).toBe("pass");
    expect(checkCondition(scale, { companyScale: "중견기업" }, NOW).verdict).toBe("fail");
    expect(checkCondition(scale, {}, NOW).verdict).toBe("unknown");
  });

  it("체납이 있으면 fail, 없으면 pass, 모름이면 unknown", () => {
    expect(checkCondition(noTax, { taxDelinquent: true }, NOW).verdict).toBe("fail");
    expect(checkCondition(noTax, { taxDelinquent: false }, NOW).verdict).toBe("pass");
    expect(checkCondition(noTax, {}, NOW).verdict).toBe("unknown");
  });

  // 우리 칸은 「인증이 있다/없다」만 안다 — 공고가 요구하는 **종류**(벤처·이노비즈…)까지는 모른다.
  // 그래서 보유는 통과로 올리지 않고 확인 필요로 둔다(2026-08-22 리뷰 4번). 미보유는 그대로 불가.
  it("인증·특허는 보유해도 통과가 아니라 unknown(종류 확인), 미보유는 fail, 모름은 unknown", () => {
    const cert = checkCondition(certReq, { hasCert: true }, NOW);
    expect(cert.verdict).toBe("unknown");
    expect(cert.note).toContain("종류");
    expect(checkCondition(certReq, { hasCert: false }, NOW).verdict).toBe("fail");
    expect(checkCondition(certReq, {}, NOW).verdict).toBe("unknown");
    expect(checkCondition(patentReq, { hasPatent: true }, NOW).verdict).toBe("unknown");
    expect(checkCondition(patentReq, { hasPatent: false }, NOW).verdict).toBe("fail");
    expect(checkCondition(patentReq, {}, NOW).verdict).toBe("unknown");
  });
});

describe("checkCondition — op 가 키와 안 맞으면 대조하지 않는다", () => {
  // 「업력 3년 이하」인데 op 가 gte 로 오면 대조가 거꾸로 돌아 못 받는 회사에 「가능」이 나온다.
  it("기대 op 와 다르면 machineReadable 이어도 unknown", () => {
    const flipped = cond({ key: "businessAgeMaxYears", op: "gte", value: 3, rawText: "업력 3년 이하" });
    const r = checkCondition(flipped, { foundedDate: "2010-01-01" }, NOW);
    expect(r.verdict).toBe("unknown");
    expect(r.note).toContain("비교 방식");
  });

  it("기대 op 와 같으면 그대로 판정한다", () => {
    const ok = cond({ key: "businessAgeMaxYears", op: "lte", value: 3, rawText: "업력 3년 이하" });
    expect(checkCondition(ok, { foundedDate: "2010-01-01" }, NOW).verdict).toBe("fail");
  });
});

describe("checkCondition — 기계로 못 읽는 조건", () => {
  const full: BusinessProfile = {
    region: "서울",
    industry: "제조",
    foundedDate: foundedYearsAgo(1),
    lastYearRevenueKrw: 1,
    employeeCount: 1,
    companyScale: "중소기업",
    taxDelinquent: false,
    hasCert: true,
    hasPatent: true,
  };

  it("machineReadable=false 면 값이 다 있어도 unknown", () => {
    const r = checkCondition(cond({ machineReadable: false }), full, NOW);
    expect(r.verdict).toBe("unknown");
    expect(r.note).toContain("원문 확인");
  });

  it("사전에 없는 조건(other)은 unknown", () => {
    const r = checkCondition(cond({ key: "other", machineReadable: true }), full, NOW);
    expect(r.verdict).toBe("unknown");
    expect(r.note).toContain("사전에 없는 조건");
  });
});

describe("matchAnnouncement — 등급", () => {
  const pass = cond({ value: ["전국"] });
  const failing = cond({ key: "employeeMax", op: "lte", value: 5, rawText: "5명 이하", machineReadable: true });
  const unknownCond = cond({ key: "revenueMaxKrw", op: "lte", value: 100, rawText: "매출 100원 이하" });

  it("전부 pass 이고 사람확인필요가 없으면 가능", () => {
    const r = matchAnnouncement(structure({ conditions: [pass] }), { region: "서울" }, NOW);
    expect(r.grade).toBe("possible");
    expect(r.checks).toHaveLength(1);
  });

  // 기계로 대조할 조건이 하나도 없으면 「된다」고 말할 근거가 없다 — 구조화가 깨진 공고가
  // 「받을 수 있음」으로 둔갑하던 자리라 애매로 둔다(2026-08-22 독립 화면 검사).
  it("조건이 하나도 없으면 애매 — 통과를 말할 근거가 없다", () => {
    expect(matchAnnouncement(structure(), {}, NOW).grade).toBe("uncertain");
  });

  it("fail 이 하나면 나머지가 pass·unknown 이어도 불가", () => {
    const r = matchAnnouncement(
      structure({ conditions: [pass, failing, unknownCond], humanCheck: ["직접 확인"] }),
      { region: "서울", employeeCount: 10 },
      NOW,
    );
    expect(r.grade).toBe("impossible");
  });

  it("미입력으로 생긴 unknown 이 있으면 애매", () => {
    const r = matchAnnouncement(structure({ conditions: [pass, unknownCond] }), { region: "서울" }, NOW);
    expect(r.grade).toBe("uncertain");
    expect(r.checks.filter((c) => c.verdict === "unknown")).toHaveLength(1);
  });

  // 2026-08-22 독립 화면 검사 1번 — 사람 확인 조건은 등급을 내리지 않는다.
  // (내리면 실공고 거의 전부가 우대사항 한 줄 때문에 애매가 되어 「받을 수 있음」이 영원히 0.)
  it("전부 pass 면 사람확인필요가 남아 있어도 가능 — 그 조건은 결과에 그대로 실린다", () => {
    const r = matchAnnouncement(
      structure({ conditions: [pass], humanCheck: ["첨부 원문 확인 필요: 공고문.hwp"] }),
      { region: "서울" },
      NOW,
    );
    expect(r.grade).toBe("possible");
    expect(r.humanCheck).toEqual(["첨부 원문 확인 필요: 공고문.hwp"]);
  });
});

describe("readStoredStructure — 저장된 구조화 JSON 방어", () => {
  it("모양이 아예 아니면 사람확인필요 한 줄로 남긴다(애매 아래로 안 내려간다)", () => {
    const s = readStoredStructure(null);
    expect(s.conditions).toEqual([]);
    expect(s.humanCheck).toEqual([UNREADABLE_STRUCTURE_NOTE]);
    expect(matchAnnouncement(s, { region: "서울" }, NOW).grade).toBe("uncertain");
  });

  it("조건 목록이 배열이 아니면 사람확인필요로 남긴다", () => {
    const s = readStoredStructure({ conditions: "없음", humanCheck: [] });
    expect(s.humanCheck).toContain(UNREADABLE_STRUCTURE_NOTE);
  });

  it("모양이 깨진 조건은 버리지 않고 원문을 사람확인필요로 옮긴다", () => {
    const s = readStoredStructure({
      conditions: [cond(), { rawText: "매출 제한 있음", key: "revenueMaxKrw" }],
      humanCheck: [],
    });
    expect(s.conditions).toHaveLength(1);
    expect(s.humanCheck).toEqual(["매출 제한 있음"]);
    // 못 읽은 조건은 버려지지 않고 사람 확인 목록으로 남는다(화면엔 「직접 확인 조건 N건」 칩).
    // 등급은 읽어낸 기계 조건만으로 매긴다 — 2026-08-22 독립 화면 검사 1번.
    expect(matchAnnouncement(s, { region: "서울" }, NOW).grade).toBe("possible");
  });

  it("값 모양이 키와 안 맞으면 대조하지 않는다(터지지 않는다)", () => {
    const s = readStoredStructure({
      conditions: [{ key: "region", op: "in", value: 5, rawText: "서울", machineReadable: true }],
      humanCheck: [],
    });
    expect(s.conditions[0].machineReadable).toBe(false);
    expect(checkCondition(s.conditions[0], { region: "서울" }, NOW).verdict).toBe("unknown");
  });

  it("op 가 키와 안 맞으면 기계대조를 끄고 원문을 사람확인필요로도 남긴다", () => {
    const s = readStoredStructure({
      conditions: [
        { key: "revenueMaxKrw", op: "gte", value: 1_000_000_000, rawText: "연매출 10억원 이하", machineReadable: true },
      ],
      humanCheck: [],
    });
    expect(s.conditions[0].machineReadable).toBe(false);
    expect(s.humanCheck).toContain("연매출 10억원 이하");
    expect(matchAnnouncement(s, { lastYearRevenueKrw: 1 }, NOW).grade).toBe("uncertain");
  });

  it("정상 구조화는 그대로 읽는다", () => {
    const src = structure({ conditions: [cond()], humanCheck: ["직접 확인"], documents: ["사업자등록증"] });
    const s = readStoredStructure(JSON.parse(JSON.stringify(src)));
    expect(s.conditions).toEqual(src.conditions);
    expect(s.humanCheck).toEqual(["직접 확인"]);
    expect(s.documents).toEqual(["사업자등록증"]);
    expect(s.aiSummary).toEqual(src.aiSummary);
    expect(s.verified).toBe(true);
  });

  it("옛 저장값에 scaleItems 가 없으면 빈 배열로 읽는다", () => {
    const s = readStoredStructure({
      aiSummary: { purpose: "목적", target: "대상", scale: "1억" },
      conditions: [],
      humanCheck: [],
      documents: [],
    });
    expect(s.aiSummary.scaleItems).toEqual([]);
  });
});

describe("parseBusinessProfile — 바깥에서 들어온 값 방어", () => {
  it("빈 값·공백은 모름(undefined)으로 남긴다", () => {
    const p = parseBusinessProfile({ region: "  ", industry: "", foundedDate: null });
    expect(p.region).toBeUndefined();
    expect(p.industry).toBeUndefined();
    expect(p.foundedDate).toBeUndefined();
  });

  it("숫자 문자열·쉼표는 숫자로, 음수·글자는 모름", () => {
    expect(parseBusinessProfile({ lastYearRevenueKrw: "1,000,000" }).lastYearRevenueKrw).toBe(1_000_000);
    expect(parseBusinessProfile({ employeeCount: "12" }).employeeCount).toBe(12);
    expect(parseBusinessProfile({ employeeCount: -3 }).employeeCount).toBeUndefined();
    expect(parseBusinessProfile({ lastYearRevenueKrw: "열억" }).lastYearRevenueKrw).toBeUndefined();
    expect(parseBusinessProfile({ employeeCount: Number.NaN }).employeeCount).toBeUndefined();
  });

  it("참·거짓이 아닌 값은 모름으로 둔다(멋대로 false 로 만들지 않는다)", () => {
    expect(parseBusinessProfile({ taxDelinquent: "아니오" }).taxDelinquent).toBeUndefined();
    expect(parseBusinessProfile({ taxDelinquent: false }).taxDelinquent).toBe(false);
    expect(parseBusinessProfile({ hasCert: true }).hasCert).toBe(true);
  });

  it("객체가 아니면 전부 모름", () => {
    expect(parseBusinessProfile(null)).toEqual({});
    expect(parseBusinessProfile("문자열")).toEqual({});
  });
});

/* ───────── 자금 조달 지도(계획 2026-09-03 Task 5) ─────────
 * 상시 상품(은행 사업자대출·서민금융·대환)이 낳는 조건 키 4종.
 * 값이 없으면 절대 통과로 치지 않는다는 이 파일의 원칙은 여기서도 같다 — 미입력은 unknown. */
describe("자금 조달 지도 조건 — 신용점수·기존 대출·법인 여부", () => {
  // 이 파일 위쪽 cond(Partial) 과 인자 모양이 달라 이름을 따로 둔다.
  const ruleCond = (
    key: ConditionKey,
    op: ConditionOp,
    value: string[] | number | boolean,
  ): StructuredCondition => ({ key, op, value, rawText: "원문", machineReadable: true });

  it("신용점수 하한: 미입력 unknown, 이상 pass, 미만 fail", () => {
    expect(checkCondition(ruleCond("creditScoreMin", "gte", 600), {}, NOW).verdict).toBe("unknown");
    expect(checkCondition(ruleCond("creditScoreMin", "gte", 600), { creditScore: 700 }, NOW).verdict).toBe("pass");
    expect(checkCondition(ruleCond("creditScoreMin", "gte", 600), { creditScore: 550 }, NOW).verdict).toBe("fail");
  });

  it("신용점수 상한(취약 계층 상품): 이하 pass, 초과 fail", () => {
    expect(checkCondition(ruleCond("creditScoreMax", "lte", 839), { creditScore: 700 }, NOW).verdict).toBe("pass");
    expect(checkCondition(ruleCond("creditScoreMax", "lte", 839), { creditScore: 900 }, NOW).verdict).toBe("fail");
  });

  it("기존 대출: 대환 상품(true)은 있어야 pass, 없으면 fail; 미입력 unknown", () => {
    expect(checkCondition(ruleCond("hasExistingLoan", "eq", true), { hasExistingLoan: true }, NOW).verdict).toBe("pass");
    expect(checkCondition(ruleCond("hasExistingLoan", "eq", true), { hasExistingLoan: false }, NOW).verdict).toBe("fail");
    expect(checkCondition(ruleCond("hasExistingLoan", "eq", true), {}, NOW).verdict).toBe("unknown");
  });

  it("법인 여부는 사업자번호 가운데 두 자리로 안다(81~88 법인, 01~79 개인, 그 밖은 모름)", () => {
    expect(isCorporationByBizno("123-81-45678")).toBe(true);
    expect(isCorporationByBizno("1234512345")).toBe(false);
    expect(isCorporationByBizno("123-90-45678")).toBeNull();
    expect(checkCondition(ruleCond("isCorporation", "eq", false), { bizno: "123-45-67890" }, NOW).verdict).toBe("pass");
    expect(checkCondition(ruleCond("isCorporation", "eq", false), { bizno: "123-81-67890" }, NOW).verdict).toBe("fail");
    expect(checkCondition(ruleCond("isCorporation", "eq", true), {}, NOW).verdict).toBe("unknown");
  });

  it("parseBusinessProfile 이 두 칸을 읽는다(범위 밖 점수는 버린다)", () => {
    expect(parseBusinessProfile({ creditScore: 720, hasExistingLoan: "yes" })).toEqual({
      creditScore: 720,
      hasExistingLoan: true,
    });
    expect(parseBusinessProfile({ creditScore: 5000 })).toEqual({});
  });

  // 저장된 값을 다시 읽을 때도 네 키가 기계대조 대상이어야 한다
  // — valueFitsKey 에서 빠지면 조용히 machineReadable:false 가 되어 판정이 사라진다.
  it("readStoredStructure 가 네 키를 기계대조 대상으로 살려 읽는다", () => {
    const s = readStoredStructure({
      conditions: [
        { key: "creditScoreMin", op: "gte", value: 600, rawText: "신용점수 600점 이상", machineReadable: true },
        { key: "hasExistingLoan", op: "eq", value: true, rawText: "기존 대출 보유자", machineReadable: true },
        { key: "isCorporation", op: "eq", value: false, rawText: "개인사업자만", machineReadable: true },
      ],
      humanCheck: [],
      documents: [],
    });
    expect(s.conditions.map((c) => c.machineReadable)).toEqual([true, true, true]);
  });
});
