import { describe, expect, it } from "vitest";
import { revenueWords, usedProfileSummary } from "./profile-summary";

// 자금 조달 지도(2026-09-03)가 쓰는 세 칸(법인 여부·신용점수·기존 대출)이 「왜 이 결과인지」
// 요약에 빠져 있었다(코덱스 지적) — 대조엔 쓰면서 근거에는 안 보이면 화면을 믿을 수 없다.
describe("usedProfileSummary — 자금 조달 지도 판정 근거 3종(코덱스 지적)", () => {
  it("법인 사업자번호·신용점수·기존 대출 값이 모두 있으면 기존 문구 뒤에 순서대로 붙는다", () => {
    const out = usedProfileSummary({
      region: "전북",
      employeeCount: 10,
      bizno: "123-81-45678", // 가운데 81 → 법인
      creditScore: 700,
      hasExistingLoan: true,
    });
    expect(out).toEqual([
      "지역 전북",
      "직원수 10명",
      "법인 여부 법인",
      "신용점수 700",
      "기존 대출 있음",
    ]);
  });

  it("개인사업자 번호면 개인으로 나온다", () => {
    const out = usedProfileSummary({ bizno: "1234512345" }); // 가운데 45 → 개인
    expect(out).toEqual(["법인 여부 개인"]);
  });

  it("기존 대출이 없으면(false) 없음으로 나온다 — false 를 미입력과 혼동하지 않는다", () => {
    const out = usedProfileSummary({ hasExistingLoan: false });
    expect(out).toEqual(["기존 대출 없음"]);
  });

  it("사업자번호 가운데 자리가 법인·개인 어디에도 안 걸리면(모름) 지어내지 않고 아예 붙이지 않는다", () => {
    const out = usedProfileSummary({ bizno: "123-90-45678" });
    expect(out).toEqual([]);
  });

  it("값이 하나도 없으면 빈 배열 그대로 — 사업자번호·신용점수·기존대출 전부 미입력", () => {
    expect(usedProfileSummary({})).toEqual([]);
  });
});

// 피드백과 다른 칸 알림(2026-10-06) — 기업 규모·NICE/KCB 점수·인증·특허가 맨 끝에 값이 있을 때만 붙는다.
describe("usedProfileSummary — 기업 규모·신용점수 기관별·인증·특허(맨 끝 묶음)", () => {
  it("기업 규모가 있으면 `기업 규모 {값}` 한 줄 — 빈 문자열·공백뿐이면 안 붙는다", () => {
    expect(usedProfileSummary({ companyScale: "소기업" })).toEqual(["기업 규모 소기업"]);
    expect(usedProfileSummary({ companyScale: "" })).toEqual([]);
    expect(usedProfileSummary({ companyScale: "  " })).toEqual([]);
    expect(usedProfileSummary({})).toEqual([]);
  });

  it("NICE 점수만 있으면 `신용점수 NICE n` — 일반 신용점수 줄은 내지 않는다", () => {
    expect(usedProfileSummary({ creditScoreNice: 820 })).toEqual(["신용점수 NICE 820"]);
    expect(usedProfileSummary({ creditScoreNice: 820, creditScore: 700 })).toEqual(["신용점수 NICE 820"]);
  });

  it("KCB 점수만 있으면 `신용점수 KCB n` — 일반 신용점수 줄은 내지 않는다", () => {
    expect(usedProfileSummary({ creditScoreKcb: 790 })).toEqual(["신용점수 KCB 790"]);
    expect(usedProfileSummary({ creditScoreKcb: 790, creditScore: 700 })).toEqual(["신용점수 KCB 790"]);
  });

  it("NICE·KCB 가 둘 다 있으면 NICE → KCB 순서로 두 줄, 일반 줄은 없다", () => {
    const out = usedProfileSummary({ creditScoreNice: 820, creditScoreKcb: 790, creditScore: 700 });
    expect(out).toEqual(["신용점수 NICE 820", "신용점수 KCB 790"]);
    expect(out).not.toContain("신용점수 700");
  });

  it("NICE·KCB 가 둘 다 없으면 일반 신용점수 줄이 지금 자리(법인 여부 뒤·기존 대출 앞)에 그대로 난다", () => {
    expect(
      usedProfileSummary({ bizno: "123-81-45678", creditScore: 700, hasExistingLoan: false, companyScale: "소기업" }),
    ).toEqual(["법인 여부 법인", "신용점수 700", "기존 대출 없음", "기업 규모 소기업"]);
  });

  it("NICE/KCB 줄은 기존 대출 뒤, 기업 규모 다음에 온다 — 일반 줄 자리에 끼지 않는다", () => {
    const out = usedProfileSummary({ hasExistingLoan: true, companyScale: "소기업", creditScoreNice: 820 });
    expect(out).toEqual(["기존 대출 있음", "기업 규모 소기업", "신용점수 NICE 820"]);
  });

  it("인증은 true/false 모두 말하고 값이 없으면 안 붙는다 — false 를 미입력과 섞지 않는다", () => {
    expect(usedProfileSummary({ hasCert: true })).toEqual(["인증 있음"]);
    expect(usedProfileSummary({ hasCert: false })).toEqual(["인증 없음"]);
    expect(usedProfileSummary({})).toEqual([]);
  });

  it("특허 건수가 1 이상이면 `특허 n건` — hasPatent 값과 상관없이 건수가 먼저다", () => {
    expect(usedProfileSummary({ patentCount: 3 })).toEqual(["특허 3건"]);
    expect(usedProfileSummary({ patentCount: 3, hasPatent: false })).toEqual(["특허 3건"]);
    expect(usedProfileSummary({ patentCount: 1, hasPatent: true })).toEqual(["특허 1건"]);
  });

  it("특허 건수가 0 이거나 없으면 hasPatent 가 boolean 일 때만 `특허 있음|없음`", () => {
    expect(usedProfileSummary({ hasPatent: true })).toEqual(["특허 있음"]);
    expect(usedProfileSummary({ hasPatent: false })).toEqual(["특허 없음"]);
    expect(usedProfileSummary({ patentCount: 0, hasPatent: true })).toEqual(["특허 있음"]);
    expect(usedProfileSummary({ patentCount: 0, hasPatent: false })).toEqual(["특허 없음"]);
    expect(usedProfileSummary({ patentCount: Number.NaN, hasPatent: true })).toEqual(["특허 있음"]);
    expect(usedProfileSummary({ patentCount: 0 })).toEqual([]);
    expect(usedProfileSummary({})).toEqual([]);
  });

  it("값이 모두 있으면 기존 줄 뒤에 기업 규모 → NICE → KCB → 인증 → 특허 순서로 붙는다", () => {
    const out = usedProfileSummary({
      region: "전북",
      industry: "제조업",
      employeeCount: 10,
      lastYearRevenueKrw: 320_000_000,
      foundedDate: "2020-01-02",
      taxDelinquent: false,
      bizno: "123-81-45678",
      creditScore: 700,
      hasExistingLoan: true,
      companyScale: "소기업",
      creditScoreNice: 820,
      creditScoreKcb: 790,
      hasCert: true,
      patentCount: 3,
      hasPatent: true,
    });
    expect(out).toEqual([
      "지역 전북",
      "업종 제조업",
      "직원수 10명",
      "매출 3.2억",
      "설립일 2020-01-02",
      "체납 없음",
      "법인 여부 법인",
      "기존 대출 있음",
      "기업 규모 소기업",
      "신용점수 NICE 820",
      "신용점수 KCB 790",
      "인증 있음",
      "특허 3건",
    ]);
  });
});

describe("revenueWords — 매출 억·만 글자(요약과 피드백 비교가 같이 쓴다)", () => {
  it("1억 이상은 소수 첫째 자리까지 억, 1억 미만은 만 단위(쉼표)로 내린다", () => {
    expect(revenueWords(320_000_000)).toBe("3.2억");
    expect(revenueWords(100_000_000)).toBe("1억");
    expect(revenueWords(80_000_000)).toBe("8,000만");
  });

  it("요약의 매출 줄은 `매출 ` 뒤에 같은 글자가 온다 — 두 곳이 갈라지지 않는다", () => {
    for (const krw of [320_000_000, 130_000_000, 80_000_000, 5_000_000]) {
      expect(usedProfileSummary({ lastYearRevenueKrw: krw })).toEqual([`매출 ${revenueWords(krw)}`]);
    }
  });
});

describe("usedProfileSummary — 시군구", () => {
  it("시군구가 있으면 지역 시도 시군구를 담는다", () => {
    expect(usedProfileSummary({ region: "경기", regionSigungu: "안양시" })).toEqual(["지역 경기 안양시"]);
  });

  it("시군구가 없으면 종전처럼 지역 시도만", () => {
    expect(usedProfileSummary({ region: "경기" })).toEqual(["지역 경기"]);
  });
});
