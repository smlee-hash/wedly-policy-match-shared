import { describe, expect, it } from "vitest";
import { extractDocumentText } from "./extract-text";
import { parseFinancial } from "./parse-financial";
import {
  FAKE,
  FINANCIAL_STATEMENT_TEXT,
  TAX_BASE_CERT_TEXT,
  VAT_RETURN_TEXT,
  xlsxTableOf,
} from "./__fixtures__/samples";

describe("parseFinancial — 재무제표(손익계산서 매출액)", () => {
  it("당기 매출액을 천원 단위에서 원으로 바꾸고, 사업연도 끝 해를 귀속 연도로 쓴다", () => {
    const r = parseFinancial({ text: FINANCIAL_STATEMENT_TEXT }, "financial-statement");
    expect(r.fields).toEqual({ lastYearRevenueKrw: 1_234_567_000 });
    expect(r.year).toBe(2025);
  });

  it("전기 칸(둘째 숫자)이 아니라 당기 칸(첫 숫자)을 쓴다", () => {
    const r = parseFinancial({ text: FINANCIAL_STATEMENT_TEXT }, "financial-statement");
    expect(r.fields.lastYearRevenueKrw).not.toBe(987_654_000);
  });

  it("재무제표 안의 상호·사업자번호는 결과에 넣지 않는다", () => {
    const json = JSON.stringify(parseFinancial({ text: FINANCIAL_STATEMENT_TEXT }, "financial-statement"));
    expect(json).not.toContain(FAKE.company);
    expect(json).not.toContain(FAKE.bizno);
  });

  it("엑셀 재무제표도 같은 규칙으로 읽는다", async () => {
    const bytes = xlsxTableOf("손익계산서", [
      ["표준손익계산서"],
      ["사업연도", "2024.01.01 ~ 2024.12.31"],
      ["(단위: 천원)"],
      ["과목", "당기", "전기"],
      ["Ⅰ.매출액", 2_000_000, 1_500_000],
    ]);
    const extracted = await extractDocumentText("재무제표.xlsx", bytes);
    if (extracted.kind !== "spreadsheet") throw new Error("엑셀로 읽혀야 한다");
    const r = parseFinancial({ sheets: extracted.sheets }, "financial-statement");
    expect(r.fields).toEqual({ lastYearRevenueKrw: 2_000_000_000 });
    expect(r.year).toBe(2024);
  });
});

describe("parseFinancial — 부가세 신고서·과세표준증명(과세표준 합계)", () => {
  it("단위 표기가 없으면 원 — 부가세 신고서", () => {
    const r = parseFinancial({ text: VAT_RETURN_TEXT }, "vat-return");
    expect(r.fields).toEqual({ lastYearRevenueKrw: 450_000_000 });
    expect(r.year).toBe(2025);
  });

  it("(단위 : 백만원) — 과세표준증명", () => {
    const r = parseFinancial({ text: TAX_BASE_CERT_TEXT }, "vat-return");
    expect(r.fields).toEqual({ lastYearRevenueKrw: 512_000_000 });
    expect(r.year).toBe(2024);
  });
});

describe("parseFinancial — 단위 환산", () => {
  const withUnit = (unit: string) =>
    ["표준손익계산서", "사업연도 2025.01.01 ~ 2025.12.31", unit, "Ⅰ.매출액  1,000  900"].join("\n");

  it.each([
    ["(단위: 원)", 1_000],
    ["(단위: 천원)", 1_000_000],
    ["(단위: 만원)", 10_000_000],
    ["(단위 : 백만원)", 1_000_000_000],
    ["(단위: 억원)", 100_000_000_000],
  ])("%s → %d 원", (unit, expected) => {
    expect(parseFinancial({ text: withUnit(unit) }, "financial-statement").fields.lastYearRevenueKrw).toBe(expected);
  });
});

describe("parseFinancial — 못 읽으면 지어내지 않는다", () => {
  it("매출액 줄이 없으면 빈 결과 + 안내", () => {
    const r = parseFinancial({ text: "표준재무제표증명\n자산총계 1,000" }, "financial-statement");
    expect(r.fields).toEqual({});
    expect(r.note).toBeTruthy();
  });

  it("매출액 뒤에 숫자가 없으면 건너뛰고 다음 매출액 줄을 본다", () => {
    const text = "매출액 및 이익 분석\nⅠ.매출액  3,000,000  2,000,000";
    expect(parseFinancial({ text }, "financial-statement").fields).toEqual({ lastYearRevenueKrw: 3_000_000 });
  });

  it("연도를 못 읽으면 year 는 없다", () => {
    const r = parseFinancial({ text: "Ⅰ.매출액  3,000,000" }, "financial-statement");
    expect(r.fields.lastYearRevenueKrw).toBe(3_000_000);
    expect(r.year).toBeUndefined();
  });

  it("글이 없어도 던지지 않는다", () => {
    expect(parseFinancial({}, "vat-return").fields).toEqual({});
  });
});
