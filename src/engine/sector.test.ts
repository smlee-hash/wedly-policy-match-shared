import { describe, expect, it } from "vitest";
import { sectorFamiliesInTitle, sectorFamiliesOfIndustry } from "./sector";

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
