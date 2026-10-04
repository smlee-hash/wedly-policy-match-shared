import { describe, expect, it } from "vitest";
import { checkCondition, corporationOf, type BusinessProfile } from "./match-engine";
import { deriveProfileFlags, readRegionFromAddress } from "./profile-derive";
import { usedProfileSummary } from "./profile-summary";
import type { StructuredCondition } from "./structure-types";

const NOW = new Date("2026-10-05T00:00:00.000Z");

describe("deriveProfileFlags — 인증 종류(certTypes)", () => {
  it("「없음」만 있으면 hasCert 는 false", () => {
    expect(deriveProfileFlags({ certTypes: ["없음"] }).hasCert).toBe(false);
  });

  it("종류가 하나라도 있으면 hasCert 는 true", () => {
    expect(deriveProfileFlags({ certTypes: ["벤처"] }).hasCert).toBe(true);
    expect(deriveProfileFlags({ certTypes: ["ISO", "기타"] }).hasCert).toBe(true);
  });

  it("「없음」과 다른 종류가 함께 있으면 종류가 이긴다 — true", () => {
    expect(deriveProfileFlags({ certTypes: ["없음", "이노비즈"] }).hasCert).toBe(true);
  });

  it("빈 배열이면 hasCert 를 건드리지 않는다 — 사람이 고른 옛 값 유지", () => {
    expect(deriveProfileFlags({ certTypes: [], hasCert: true }).hasCert).toBe(true);
    expect(deriveProfileFlags({ certTypes: [], hasCert: false }).hasCert).toBe(false);
    expect("hasCert" in deriveProfileFlags({ certTypes: [] })).toBe(false);
  });

  it("certTypes 칸이 아예 없으면 hasCert 는 그대로", () => {
    expect(deriveProfileFlags({ hasCert: true }).hasCert).toBe(true);
    expect("hasCert" in deriveProfileFlags({})).toBe(false);
  });

  it("여성기업·사회적기업은 orgTypes 에 더한다", () => {
    expect(deriveProfileFlags({ certTypes: ["여성기업", "사회적기업"] }).orgTypes).toEqual(["여성기업", "사회적기업"]);
  });

  it("orgTypes 에 이미 있으면 중복 없이 더하고, 있던 값은 그대로 둔다", () => {
    const out = deriveProfileFlags({ orgTypes: ["협동조합", "여성기업"], certTypes: ["여성기업", "사회적기업", "벤처"] });
    expect(out.orgTypes).toEqual(["협동조합", "여성기업", "사회적기업"]);
  });

  it("다른 인증 종류(벤처·이노비즈·메인비즈·ISO·기타)는 orgTypes 를 만들지 않는다", () => {
    const out = deriveProfileFlags({ certTypes: ["벤처", "이노비즈", "메인비즈", "ISO", "기타"] });
    expect(out.orgTypes).toBeUndefined();
  });
});

describe("deriveProfileFlags — 특허 건수·기존 대출 잔액", () => {
  it("특허 0건이면 hasPatent=false, 1건 이상이면 true", () => {
    expect(deriveProfileFlags({ patentCount: 0 }).hasPatent).toBe(false);
    expect(deriveProfileFlags({ patentCount: 1 }).hasPatent).toBe(true);
    expect(deriveProfileFlags({ patentCount: 5 }).hasPatent).toBe(true);
  });

  it("특허 건수가 없으면 hasPatent 는 그대로", () => {
    expect(deriveProfileFlags({ hasPatent: true }).hasPatent).toBe(true);
    expect("hasPatent" in deriveProfileFlags({})).toBe(false);
  });

  it("음수·숫자 아님은 읽지 않는다 — hasPatent 그대로", () => {
    expect(deriveProfileFlags({ patentCount: -1, hasPatent: true }).hasPatent).toBe(true);
    expect(deriveProfileFlags({ patentCount: Number.NaN, hasPatent: false }).hasPatent).toBe(false);
  });

  it("기존 대출 잔액 0이면 hasExistingLoan=false, 1 이상이면 true", () => {
    expect(deriveProfileFlags({ existingLoanBalanceManwon: 0 }).hasExistingLoan).toBe(false);
    expect(deriveProfileFlags({ existingLoanBalanceManwon: 1 }).hasExistingLoan).toBe(true);
    expect(deriveProfileFlags({ existingLoanBalanceManwon: 30000 }).hasExistingLoan).toBe(true);
  });

  it("대출 잔액이 없으면 hasExistingLoan 은 그대로", () => {
    expect(deriveProfileFlags({ hasExistingLoan: true }).hasExistingLoan).toBe(true);
    expect(deriveProfileFlags({ hasExistingLoan: false }).hasExistingLoan).toBe(false);
    expect("hasExistingLoan" in deriveProfileFlags({})).toBe(false);
  });
});

describe("deriveProfileFlags — 신용점수(NICE·KCB)", () => {
  it("둘 다 있으면 낮은 값을 creditScore 로", () => {
    expect(deriveProfileFlags({ creditScoreNice: 820, creditScoreKcb: 760 }).creditScore).toBe(760);
    expect(deriveProfileFlags({ creditScoreNice: 700, creditScoreKcb: 780 }).creditScore).toBe(700);
  });

  it("하나만 있으면 그 값", () => {
    expect(deriveProfileFlags({ creditScoreNice: 810 }).creditScore).toBe(810);
    expect(deriveProfileFlags({ creditScoreKcb: 640 }).creditScore).toBe(640);
  });

  it("둘 다 없으면 creditScore 는 그대로(옛 저장값 유지)", () => {
    expect(deriveProfileFlags({ creditScore: 700 }).creditScore).toBe(700);
    expect("creditScore" in deriveProfileFlags({})).toBe(false);
  });

  it("새 점수가 있으면 옛 creditScore 를 덮는다", () => {
    expect(deriveProfileFlags({ creditScore: 900, creditScoreNice: 700 }).creditScore).toBe(700);
  });

  it("300~1000 밖 값은 무시한다 — 경계 300·1000 은 받는다", () => {
    expect(deriveProfileFlags({ creditScoreNice: 299, creditScoreKcb: 700 }).creditScore).toBe(700);
    expect(deriveProfileFlags({ creditScoreNice: 1001, creditScoreKcb: 700 }).creditScore).toBe(700);
    expect(deriveProfileFlags({ creditScoreNice: 300 }).creditScore).toBe(300);
    expect(deriveProfileFlags({ creditScoreKcb: 1000 }).creditScore).toBe(1000);
  });

  it("둘 다 범위 밖이면 옛 creditScore 그대로, 없으면 안 만든다", () => {
    expect(deriveProfileFlags({ creditScore: 710, creditScoreNice: 5, creditScoreKcb: 2000 }).creditScore).toBe(710);
    expect("creditScore" in deriveProfileFlags({ creditScoreNice: 5 })).toBe(false);
  });
});

describe("deriveProfileFlags — 소재지 주소(businessAddress)", () => {
  it("「경기도 화성시 …」에서 시도·시군구를 읽는다", () => {
    const out = deriveProfileFlags({ businessAddress: "경기도 화성시 동탄대로 123" });
    expect(out.region).toBe("경기");
    expect(out.regionSigungu).toBe("화성시");
  });

  it("줄임말 「경기 화성시」도 읽는다", () => {
    const out = deriveProfileFlags({ businessAddress: "경기 화성시" });
    expect(out.region).toBe("경기");
    expect(out.regionSigungu).toBe("화성시");
  });

  it("별칭(서울특별시·충청북도·전북특별자치도·광주광역시·제주특별자치도)을 표준 시도로 바꾼다", () => {
    expect(deriveProfileFlags({ businessAddress: "서울특별시 강남구 테헤란로 1" })).toMatchObject({ region: "서울", regionSigungu: "강남구" });
    expect(deriveProfileFlags({ businessAddress: "충청북도 청주시 흥덕구 1" })).toMatchObject({ region: "충북", regionSigungu: "청주시" });
    expect(deriveProfileFlags({ businessAddress: "전북특별자치도 전주시 완산구 1" })).toMatchObject({ region: "전북", regionSigungu: "전주시" });
    expect(deriveProfileFlags({ businessAddress: "광주광역시 광산구 1" })).toMatchObject({ region: "광주", regionSigungu: "광산구" });
    expect(deriveProfileFlags({ businessAddress: "제주특별자치도 제주시 1" })).toMatchObject({ region: "제주", regionSigungu: "제주시" });
  });

  it("앞의 우편번호와 붙여 쓴 표기(경기도화성시)도 읽는다", () => {
    expect(deriveProfileFlags({ businessAddress: "(12345) 경기도 화성시 1" })).toMatchObject({ region: "경기", regionSigungu: "화성시" });
    expect(deriveProfileFlags({ businessAddress: "경기도화성시 1" })).toMatchObject({ region: "경기", regionSigungu: "화성시" });
  });

  it("시도 없이 사전에 있는 시군구로 시작하면 시도도 사전에서 채운다", () => {
    expect(deriveProfileFlags({ businessAddress: "화성시 동탄대로 1" })).toMatchObject({ region: "경기", regionSigungu: "화성시" });
  });

  it("사전에 없는 이름(중구처럼 시도마다 있는 곳)은 시군구를 채우지 않는다 — 시도는 채운다", () => {
    const out = deriveProfileFlags({ businessAddress: "서울특별시 중구 세종대로 1" });
    expect(out.region).toBe("서울");
    expect("regionSigungu" in out).toBe(false);
  });

  it("주소에서 못 읽으면 기존 region·regionSigungu 를 그대로 둔다", () => {
    const out = deriveProfileFlags({ businessAddress: "주소 미상", region: "경남", regionSigungu: "김해시" });
    expect(out.region).toBe("경남");
    expect(out.regionSigungu).toBe("김해시");
  });

  it("읽은 주소가 기존 region 을 이기고, 어긋나는 옛 시군구는 버린다", () => {
    const out = deriveProfileFlags({ businessAddress: "경기도 화성시 1", region: "서울", regionSigungu: "강남구" });
    expect(out.region).toBe("경기");
    expect(out.regionSigungu).toBe("화성시");
    const onlySido = deriveProfileFlags({ businessAddress: "경기도 광주시 1", region: "서울", regionSigungu: "강남구" });
    expect(onlySido.region).toBe("경기");
    expect("regionSigungu" in onlySido).toBe(false);
  });

  it("시도가 같고 시군구를 못 읽으면 옛 시군구는 유지한다", () => {
    const out = deriveProfileFlags({ businessAddress: "경기도 광주시 1", region: "경기", regionSigungu: "화성시" });
    expect(out.regionSigungu).toBe("화성시");
  });

  it("주소가 비어 있거나 공백뿐이면 아무것도 바꾸지 않는다", () => {
    expect(deriveProfileFlags({ businessAddress: "  ", region: "부산" }).region).toBe("부산");
  });

  it("주소 자체는 읽은 그대로 돌려준다(지우지 않는다)", () => {
    expect(deriveProfileFlags({ businessAddress: "경기 화성시" }).businessAddress).toBe("경기 화성시");
  });
});

describe("readRegionFromAddress", () => {
  it("시도 + 시군구까지만 담은 짧은 주소를 함께 돌려준다 — 도로명·번지는 안 담는다", () => {
    const out = readRegionFromAddress("경기도 화성시 동탄대로 123, 가상빌딩 5층");
    expect(out).toEqual({ region: "경기", regionSigungu: "화성시", shortAddress: "경기 화성시" });
    expect(JSON.stringify(out)).not.toMatch(/동탄대로|123|가상빌딩/);
  });

  it("사전에 없는 시군구(중구)도 짧은 주소에는 이름을 담는다", () => {
    expect(readRegionFromAddress("서울특별시 중구 세종대로 110")).toEqual({ region: "서울", shortAddress: "서울 중구" });
  });

  it("시도만 읽히면 짧은 주소는 시도뿐", () => {
    expect(readRegionFromAddress("세종특별자치시 한누리대로 2130")).toEqual({ region: "세종", shortAddress: "세종" });
  });

  it("못 읽으면 빈 객체", () => {
    expect(readRegionFromAddress("")).toEqual({});
    expect(readRegionFromAddress(undefined)).toEqual({});
    expect(readRegionFromAddress("주소 미상")).toEqual({});
  });
});

describe("deriveProfileFlags — 옛 저장값·입력 보존", () => {
  it("새 칸이 하나도 없는 옛 프로필(creditScore 하나·hasCert 만)은 그대로 돌려준다", () => {
    const old: BusinessProfile = { region: "전북", creditScore: 700, hasCert: true, hasExistingLoan: false, orgTypes: ["협동조합"] };
    expect(deriveProfileFlags(old)).toEqual(old);
  });

  it("입력 객체와 그 안의 배열을 바꾸지 않고 새 객체를 돌려준다", () => {
    const input: BusinessProfile = {
      orgTypes: ["협동조합"],
      certTypes: ["여성기업", "벤처"],
      patentCount: 2,
      creditScoreNice: 800,
      creditScoreKcb: 750,
      businessAddress: "경기도 화성시 1",
    };
    const before = structuredClone(input);
    const out = deriveProfileFlags(input);
    expect(input).toEqual(before);
    expect(out).not.toBe(input);
    expect(out.orgTypes).not.toBe(input.orgTypes);
    expect(out.certTypes).not.toBe(input.certTypes);
  });
});

describe("법인 판정 — 사업자번호가 먼저, 모를 때만 isCorporation", () => {
  it("사업자번호가 판정하면 isCorporation 과 달라도 사업자번호가 이긴다", () => {
    expect(corporationOf({ bizno: "123-81-67890", isCorporation: false })).toBe(true);
    expect(corporationOf({ bizno: "123-45-67890", isCorporation: true })).toBe(false);
  });

  it("사업자번호가 없거나 모름(89·90 …)이면 isCorporation 을 쓴다", () => {
    expect(corporationOf({ isCorporation: true })).toBe(true);
    expect(corporationOf({ isCorporation: false })).toBe(false);
    expect(corporationOf({ bizno: "123-90-67890", isCorporation: true })).toBe(true);
  });

  it("둘 다 모르면 null(모름)", () => {
    expect(corporationOf({})).toBeNull();
    expect(corporationOf({ bizno: "123-90-67890" })).toBeNull();
  });

  const lawCond = (value: boolean): StructuredCondition => ({
    key: "isCorporation",
    op: "eq",
    value,
    rawText: "원문",
    machineReadable: true,
  });

  it("판정 엔진: 사업자번호가 없어도 isCorporation 이 있으면 pass·fail 을 낸다", () => {
    expect(checkCondition(lawCond(true), { isCorporation: true }, NOW).verdict).toBe("pass");
    expect(checkCondition(lawCond(false), { isCorporation: true }, NOW).verdict).toBe("fail");
    expect(checkCondition(lawCond(true), {}, NOW).verdict).toBe("unknown");
  });

  it("판정 엔진: 사업자번호가 판정하면 isCorporation 은 무시한다", () => {
    expect(checkCondition(lawCond(true), { bizno: "123-45-67890", isCorporation: true }, NOW).verdict).toBe("fail");
  });

  it("판정 근거 요약도 같은 도우미를 쓴다", () => {
    expect(usedProfileSummary({ isCorporation: true })).toEqual(["법인 여부 법인"]);
    expect(usedProfileSummary({ isCorporation: false })).toEqual(["법인 여부 개인"]);
    expect(usedProfileSummary({ bizno: "123-45-67890", isCorporation: true })).toEqual(["법인 여부 개인"]);
    expect(usedProfileSummary({ bizno: "123-90-67890" })).toEqual([]);
  });
});
