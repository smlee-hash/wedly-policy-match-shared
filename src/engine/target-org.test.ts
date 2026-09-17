import { describe, expect, it } from "vitest";
import { profileOrgTypes, targetOrgsInTitle } from "./target-org";

describe("targetOrgsInTitle — 제목의 대상 선언 자리만", () => {
  it("착한가격업소 신규모집", () => {
    expect(targetOrgsInTitle("[전남광주] 목포시 2026년 착한가격업소 신규모집 공고")).toEqual(["착한가격업소"]);
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
