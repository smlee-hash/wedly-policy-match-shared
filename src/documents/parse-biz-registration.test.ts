import { describe, expect, it } from "vitest";
import { parseBizRegistration } from "./parse-biz-registration";
import { BIZ_REGISTRATION_CORP_TEXT, BIZ_REGISTRATION_PERSONAL_TEXT, FAKE } from "./__fixtures__/samples";

/** 결과 JSON 어디에도 있으면 안 되는 개인정보·도로명 */
function expectNoSensitive(result: unknown) {
  const json = JSON.stringify(result);
  expect(json).not.toContain(FAKE.rep);
  expect(json).not.toContain(FAKE.rrn);
  expect(json).not.toContain(FAKE.corpRegNo);
  expect(json).not.toMatch(/\d{6}-?\d{7}/); // 주민·법인등록번호 모양
  expect(json).not.toMatch(/동탄대로|테헤란로|가상빌딩|123,/);
}

describe("parseBizRegistration — 법인 사업자등록증", () => {
  const r = parseBizRegistration(BIZ_REGISTRATION_CORP_TEXT);

  it("사업자번호·개업일·업종·소재지·법인 여부를 뽑는다", () => {
    expect(r.fields).toEqual({
      bizno: "123-81-67890",
      foundedDate: "2018-03-12",
      industry: "제조업, 도소매업 / 전자부품, 전자상거래",
      region: "경기",
      regionSigungu: "화성시",
      businessAddress: "경기 화성시",
      isCorporation: true,
    });
  });

  it("대표자 이름·법인등록번호·도로명은 결과 어디에도 없다", () => {
    expectNoSensitive(r);
  });
});

describe("parseBizRegistration — 개인 사업자등록증명", () => {
  const r = parseBizRegistration(BIZ_REGISTRATION_PERSONAL_TEXT);

  it("칸을 뽑고 개인(일반과세자)은 isCorporation=false", () => {
    expect(r.fields).toEqual({
      bizno: "123-45-67890",
      foundedDate: "2020-07-01",
      industry: "서비스업 / 소프트웨어 개발",
      region: "서울",
      regionSigungu: "강남구",
      businessAddress: "서울 강남구",
      isCorporation: false,
    });
  });

  it("주민등록번호·대표자 이름·도로명은 결과 어디에도 없다", () => {
    expectNoSensitive(r);
  });
});

describe("parseBizRegistration — 법인 판정 근거", () => {
  it("법인등록번호만 있어도 법인", () => {
    const text = `사업자등록증\n등록번호 : ${FAKE.bizno}\n개 업 연 월 일 : 2018 년 03 월 12 일 법인등록번호 : ${FAKE.corpRegNo}`;
    expect(parseBizRegistration(text).fields.isCorporation).toBe(true);
  });

  it("상호에 ㈜·(주)·주식회사가 있으면 법인", () => {
    for (const name of ["㈜가상테크", "(주)가상테크", "주식회사 가상테크", "가상테크 주식회사"]) {
      const text = `등록번호 : ${FAKE.bizno}\n상 호 : ${name}`;
      expect(parseBizRegistration(text).fields.isCorporation, name).toBe(true);
    }
  });

  it("법인 근거가 없고 개인 표시도 없으면 isCorporation 을 채우지 않는다", () => {
    const text = `등록번호 : ${FAKE.biznoPersonal}\n상 호 : 가상테크`;
    expect("isCorporation" in parseBizRegistration(text).fields).toBe(false);
  });

  it("법인등록번호 칸이 비어 있는 개인 서류는 법인이 아니다", () => {
    const text = `사업자등록증 ( 일반과세자 )\n등록번호 : ${FAKE.biznoPersonal}\n법인등록번호 :\n상 호 : 가상테크`;
    expect(parseBizRegistration(text).fields.isCorporation).toBe(false);
  });
});

describe("parseBizRegistration — 읽기 모양·빈 칸", () => {
  it("항목 이름 글자 사이에 공백이 섞여도 읽는다", () => {
    const text = "사 업 장 소 재 지 : 충청북도 청주시 흥덕구 가상로 1\n개 업 연 월 일 : 2015.4.7";
    const r = parseBizRegistration(text);
    expect(r.fields).toMatchObject({ foundedDate: "2015-04-07", region: "충북", regionSigungu: "청주시", businessAddress: "충북 청주시" });
  });

  it("시도 없이 시군구로 시작하는 소재지는 시도를 사전에서 채운다", () => {
    const r = parseBizRegistration("사업장 소재지 : 화성시 동탄대로 1");
    expect(r.fields).toMatchObject({ region: "경기", regionSigungu: "화성시", businessAddress: "경기 화성시" });
  });

  it("달력에 없는 개업일은 채우지 않는다", () => {
    expect(parseBizRegistration("개업연월일 : 2018 년 13 월 45 일").fields.foundedDate).toBeUndefined();
  });

  it("업태만 있고 종목이 없으면 업종을 채우지 않는다", () => {
    expect(parseBizRegistration("업태 제조업").fields.industry).toBeUndefined();
  });

  it("맺음 문구 뒤의 안내 글은 읽지 않는다", () => {
    const text = [
      "사업자등록증명 ( 일반과세자 )",
      "사업장 소재지 : 서울특별시 강남구 가상로 1",
      "위와 같이 증명합니다.",
      "사업장 소재지 : 부산광역시 해운대구 안내문 1",
    ].join("\n");
    expect(parseBizRegistration(text).fields.regionSigungu).toBe("강남구");
  });

  it("서류 글이 아니면 빈 결과 + 안내", () => {
    const r = parseBizRegistration("오늘 점심 메뉴는 김치찌개입니다.");
    expect(r.fields).toEqual({});
    expect(r.note).toBeTruthy();
  });
});
