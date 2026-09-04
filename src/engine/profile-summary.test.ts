import { describe, expect, it } from "vitest";
import { usedProfileSummary } from "./profile-summary";

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
