import { describe, expect, it } from "vitest";
import { extractDocumentText, type SheetData } from "./extract-text";
import { parseCompanyStatus, parseCertText, parsePatentText } from "./parse-company-status";
import { companyStatusSheet, xlsxOf, type SampleCell } from "./__fixtures__/samples";

async function parse(over: Record<string, SampleCell> = {}, omit: string[] = []) {
  const cells = companyStatusSheet(over);
  for (const key of omit) delete cells[key];
  const r = await extractDocumentText("기업상태표.xlsx", xlsxOf({ 기업상태표: cells }));
  if (r.kind !== "spreadsheet") throw new Error(r.kind);
  return parseCompanyStatus(r.sheets);
}

describe("parseCompanyStatus — 정본 셀 위치에서 칸 뽑기", () => {
  it("가상 표본의 칸을 전부 뽑는다", async () => {
    const r = await parse();
    expect(r.fields).toEqual({
      foundedDate: "2018-03-12", // F2
      industry: "제조업 / 전자부품", // B3
      region: "경기", // B4 → 시도
      regionSigungu: "화성시", // B4 → 시군구
      businessAddress: "경기 화성시", // B4 → 시도+시군구까지만
      lastYearRevenueKrw: 120_000_000, // C6 「1억 2천」
      employeeCount: 7, // C10
      patentCount: 3, // E26 「등록 2건, 출원 1건」
      certTypes: ["벤처", "이노비즈", "ISO"], // E29
      taxDelinquent: false, // G30·G31 = N
    });
    // 서류가 「없음」을 말하지 않았으므로 hasCert·hasPatent 는 채우지 않는다.
    expect("hasCert" in r.fields).toBe(false);
    expect("hasPatent" in r.fields).toBe(false);
    // 기업상태표 칸에는 기준 연도가 없다.
    expect(r.year).toBeUndefined();
  });

  it("B2 업체명은 읽지 않는다 · 도로명·건물명은 결과 어디에도 없다", async () => {
    const r = await parse({ B2: "㈜가상테크" });
    const json = JSON.stringify(r);
    expect(json).not.toContain("가상테크");
    expect(json).not.toMatch(/동탄대로|123|가상빌딩/);
  });

  it("매출은 전년도(C6)만 쓴다 — 당해년도(C5)·그 전 해(C7·C8)는 쓰지 않는다", async () => {
    const onlyOthers = await parse({}, ["C6"]);
    expect(onlyOthers.fields.lastYearRevenueKrw).toBeUndefined();
    const r = await parse({ C5: "9억", C6: "2억", C7: "7억", C8: "6억" });
    expect(r.fields.lastYearRevenueKrw).toBe(200_000_000);
  });

  it.each([
    ["120,000,000", 120_000_000],
    ["12000만원", 120_000_000],
    ["1억 2천", 120_000_000],
    ["1.2억", 120_000_000],
    ["3,500만원", 35_000_000],
    [120_000_000, 120_000_000], // 숫자 칸
  ])("매출 표기 %s → %d원", async (cell, expected) => {
    expect((await parse({ C6: cell })).fields.lastYearRevenueKrw).toBe(expected);
  });

  it("단위를 알 수 없는 작은 숫자 매출은 채우지 않는다", async () => {
    expect((await parse({ C6: "12000" })).fields.lastYearRevenueKrw).toBeUndefined();
  });

  it("개업일이 날짜 서식 숫자 칸이어도 읽는다", async () => {
    const r = await parse({ F2: { serial: 41456, format: "yyyy-mm-dd" } });
    expect(r.fields.foundedDate).toBe("2013-07-01");
  });

  it("개업일이 날짜가 아니면(신용점수 899 같은 값) 채우지 않는다", async () => {
    expect((await parse({ F2: "899" })).fields.foundedDate).toBeUndefined();
  });

  it("4대보험 인원수(C10)는 정수만", async () => {
    expect((await parse({ C10: "12명" })).fields.employeeCount).toBe(12);
    expect((await parse({ C10: "1,200" })).fields.employeeCount).toBe(1200);
    expect((await parse({ C10: "없음" })).fields.employeeCount).toBe(0);
    expect((await parse({ C10: "미정" })).fields.employeeCount).toBeUndefined();
  });

  it("소재지를 못 읽으면 지역 칸을 채우지 않는다", async () => {
    const r = await parse({ B4: "주소 미상" });
    expect(r.fields.region).toBeUndefined();
    expect(r.fields.businessAddress).toBeUndefined();
  });

  it("빈 칸은 채우지 않는다", async () => {
    const r = await parse({}, ["F2", "B3", "B4", "C6", "C10", "E26", "E29"]);
    expect(r.fields).toEqual({ taxDelinquent: false });
  });

  it("체납 — 하나라도 Y 면 true, 국세 N 이고 보험료가 Y 아니면 false, 국세를 모르면 모름", async () => {
    expect((await parse({ G30: "Y", G31: "N" })).fields.taxDelinquent).toBe(true);
    expect((await parse({ G30: "N", G31: "Y" })).fields.taxDelinquent).toBe(true);
    expect((await parse({ G30: "N", G31: "N" })).fields.taxDelinquent).toBe(false);
    expect((await parse({ G30: "N" }, ["G31"])).fields.taxDelinquent).toBe(false);
    expect((await parse({ G31: "N" }, ["G30"])).fields.taxDelinquent).toBeUndefined();
    expect((await parse({}, ["G30", "G31"])).fields.taxDelinquent).toBeUndefined();
  });

  it("특허·인증이 「없음」이면 hasPatent·hasCert 를 false 로 분명히 채운다", async () => {
    const r = await parse({ E26: "없음", E29: "X" });
    expect(r.fields.patentCount).toBe(0);
    expect(r.fields.hasPatent).toBe(false);
    expect(r.fields.certTypes).toEqual(["없음"]);
    expect(r.fields.hasCert).toBe(false);
  });

  it("기업상태표 시트가 여럿이면 라벨이 가장 많은 시트를 읽는다", async () => {
    const r = await extractDocumentText(
      "여럿.xlsx",
      xlsxOf({ 메모: { A1: "그냥 메모", B3: "엉뚱한 값" }, 기업상태표: companyStatusSheet() }),
    );
    if (r.kind !== "spreadsheet") throw new Error(r.kind);
    expect(parseCompanyStatus(r.sheets).fields.industry).toBe("제조업 / 전자부품");
  });

  it("시트가 없으면 빈 결과(터지지 않는다)", () => {
    expect(parseCompanyStatus([] as SheetData[])).toEqual({ fields: {} });
  });
});

describe("parsePatentText — 특허 글자에서 건수", () => {
  it("「등록 2건, 출원 1건」→ 3", () => {
    expect(parsePatentText("등록 2건, 출원 1건")).toEqual({ patentCount: 3 });
  });

  it("건수만 있는 글·숫자만 있는 칸", () => {
    expect(parsePatentText("특허 5건")).toEqual({ patentCount: 5 });
    expect(parsePatentText("2")).toEqual({ patentCount: 2 });
  });

  it("괄호 속 풀이는 두 번 세지 않는다", () => {
    expect(parsePatentText("특허 3건 (등록 2건, 출원 1건)")).toEqual({ patentCount: 3 });
  });

  it("없음·X·0건은 0건 + hasPatent=false", () => {
    for (const t of ["없음", "X", "x", "해당 없음", "미보유", "무", "0", "등록 0건, 출원 0건"]) {
      expect(parsePatentText(t), t).toEqual({ patentCount: 0, hasPatent: false });
    }
  });

  it("건수를 알 수 없는 글은 아무것도 채우지 않는다", () => {
    expect(parsePatentText("있음")).toEqual({});
    expect(parsePatentText("")).toEqual({});
    expect(parsePatentText("  ")).toEqual({});
  });
});

describe("parseCertText — 인증 글자에서 종류", () => {
  it("종류를 가려낸다 — 순서는 정해진 순서", () => {
    expect(parseCertText("벤처기업 확인")).toEqual({ certTypes: ["벤처"] });
    expect(parseCertText("ISO 9001, 이노비즈, 메인비즈")).toEqual({ certTypes: ["이노비즈", "메인비즈", "ISO"] });
    expect(parseCertText("여성기업")).toEqual({ certTypes: ["여성기업"] });
    expect(parseCertText("사회적기업 인증")).toEqual({ certTypes: ["사회적기업"] });
  });

  it("ISO 번호는 기타로 세지 않는다", () => {
    expect(parseCertText("ISO 9001 / ISO 14001")).toEqual({ certTypes: ["ISO"] });
  });

  it("그 밖의 글자는 기타", () => {
    expect(parseCertText("기업부설연구소")).toEqual({ certTypes: ["기타"] });
    expect(parseCertText("벤처, 연구개발전담부서")).toEqual({ certTypes: ["벤처", "기타"] });
  });

  it("괄호 속 기간 표기는 기타로 세지 않는다", () => {
    expect(parseCertText("벤처인증(2027.03까지)")).toEqual({ certTypes: ["벤처"] });
  });

  it("없음·X 는 「없음」 + hasCert=false", () => {
    for (const t of ["없음", "X", "x", "해당없음", "미보유", "무"]) {
      expect(parseCertText(t), t).toEqual({ certTypes: ["없음"], hasCert: false });
    }
  });

  it("비어 있거나 읽을 글이 없으면 아무것도 채우지 않는다", () => {
    expect(parseCertText("")).toEqual({});
    expect(parseCertText(" - ")).toEqual({});
  });
});
