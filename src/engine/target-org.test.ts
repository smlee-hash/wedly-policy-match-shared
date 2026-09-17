import { describe, expect, it } from "vitest";
import { profileOrgTypes, targetOrgsInTitle } from "./target-org";

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
