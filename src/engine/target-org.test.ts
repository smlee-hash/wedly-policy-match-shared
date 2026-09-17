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

describe("독립 리뷰 2026-09-17 반영 — 대상 선언 자리", () => {
  it("C1: 「예비창업자 및 재창업자 … 모집」도 자격 조건은 붙지만(예비창업자) 판정은 fail 이 아니다", () => {
    expect(targetOrgsInTitle("로봇분야 예비창업자 및 재창업자를 위한 창업 성장 프로그램 참가자 모집")).toEqual(["예비창업자"]);
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

  it("참 대상은 그대로 잡는다 — 신규모집·사업 이름이 먼저 오는 제목", () => {
    expect(targetOrgsInTitle("[전남광주] 목포시 2026년 착한가격업소 신규모집 공고")).toEqual(["착한가격업소"]);
    expect(targetOrgsInTitle("[충남] 2026년 (예비)사회적기업 사업개발비 지원사업 참여기업 모집 공고")).toEqual(["사회적기업"]);
    expect(targetOrgsInTitle("[경북] 김천시 2026년 4차 사회적경제기업 행사참여지원사업 참여기업 모집 공고")).toEqual(["사회적경제"]);
  });
});
