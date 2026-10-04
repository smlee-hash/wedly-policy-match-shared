import { describe, expect, it } from "vitest";
import { classifyDocument } from "./classify";
import { extractDocumentText, type SheetData } from "./extract-text";
import {
  BIZ_REGISTRATION_CORP_TEXT,
  BIZ_REGISTRATION_PERSONAL_TEXT,
  EMPLOYMENT_ROWS,
  FINANCIAL_STATEMENT_TEXT,
  TAX_BASE_CERT_TEXT,
  VAT_RETURN_TEXT,
  companyStatusSheet,
  xlsxOf,
  xlsxTableOf,
} from "./__fixtures__/samples";

async function sheetsOf(name: string, bytes: Buffer): Promise<SheetData[]> {
  const r = await extractDocumentText(name, bytes);
  if (r.kind !== "spreadsheet") throw new Error(r.kind);
  return r.sheets;
}

describe("classifyDocument — 서류 종류 6종(가상 표본)", () => {
  it("기업상태표(엑셀 시트)", async () => {
    const sheets = await sheetsOf("a.xlsx", xlsxOf({ 기업상태표: companyStatusSheet() }));
    expect(classifyDocument({ fileName: "a.xlsx", sheets })).toBe("company-status");
  });

  it("사업자등록증(법인)·사업자등록증명(개인)", () => {
    expect(classifyDocument({ fileName: "a.pdf", text: BIZ_REGISTRATION_CORP_TEXT })).toBe("biz-registration");
    expect(classifyDocument({ fileName: "a.pdf", text: BIZ_REGISTRATION_PERSONAL_TEXT })).toBe("biz-registration");
  });

  it("재무제표(표준재무제표증명)", () => {
    expect(classifyDocument({ fileName: "a.pdf", text: FINANCIAL_STATEMENT_TEXT })).toBe("financial-statement");
  });

  it("부가세 신고서·과세표준증명", () => {
    expect(classifyDocument({ fileName: "a.pdf", text: VAT_RETURN_TEXT })).toBe("vat-return");
    expect(classifyDocument({ fileName: "a.pdf", text: TAX_BASE_CERT_TEXT })).toBe("vat-return");
  });

  it("고용·산재 가입자 명부(엑셀)·신고서(글)", async () => {
    const sheets = await sheetsOf("a.xlsx", xlsxTableOf("고용현황", EMPLOYMENT_ROWS));
    expect(classifyDocument({ fileName: "a.xlsx", sheets })).toBe("employment-insurance");
    const text = "고용보험 산재보험 보험관계 성립신고서\n사업장 소재지 : 경기도 화성시\n근로자 수 5명";
    expect(classifyDocument({ fileName: "a.pdf", text })).toBe("employment-insurance");
  });

  it("엑셀로 만든 재무제표도 글 내용으로 가른다", async () => {
    const sheets = await sheetsOf(
      "a.xlsx",
      xlsxTableOf("손익계산서", [["(단위: 천원)"], ["매출액", 1000], ["매출원가", 600], ["매출총이익", 400]]),
    );
    expect(classifyDocument({ fileName: "a.xlsx", sheets })).toBe("financial-statement");
  });

  it("아무 서류도 아니면 unknown", () => {
    expect(classifyDocument({ fileName: "a.txt", text: "오늘 점심 메뉴는 김치찌개입니다." })).toBe("unknown");
    expect(classifyDocument({ fileName: "a.txt", text: "" })).toBe("unknown");
    expect(classifyDocument({ fileName: "a.xlsx", sheets: [] })).toBe("unknown");
  });
});

describe("classifyDocument — 글자 모양·파일 이름", () => {
  it("글자 사이에 공백이 섞인 PDF 글도 가른다", () => {
    const text = "사 업 자 등 록 증\n개 업 연 월 일 : 2018 년 03 월 12 일\n사 업 장 소 재 지 : 경기도 화성시";
    expect(classifyDocument({ fileName: "a.pdf", text })).toBe("biz-registration");
  });

  it("파일 이름은 보조 단서일 뿐 — 이름만으로는 가르지 않는다", () => {
    expect(classifyDocument({ fileName: "사업자등록증.pdf", text: "별 내용 없음" })).toBe("unknown");
  });

  it("글 내용의 약한 단서에 이름이 힘을 보탤 수는 있다", () => {
    const text = "사업장 소재지 : 경기도 화성시";
    expect(classifyDocument({ fileName: "scan1.pdf", text })).toBe("unknown");
    expect(classifyDocument({ fileName: "사업자등록증 사본.pdf", text })).toBe("biz-registration");
  });

  it("이름이 글 내용을 이기지 못한다 — 재무제표 글에 사업자등록증 이름", () => {
    expect(classifyDocument({ fileName: "사업자등록증.pdf", text: FINANCIAL_STATEMENT_TEXT })).toBe("financial-statement");
  });

  it("맥(NFD) 자모가 풀어진 파일 이름도 알아본다", () => {
    const name = "사업자등록증 사본.pdf".normalize("NFD");
    expect(classifyDocument({ fileName: name, text: "사업장 소재지 : 경기도 화성시" })).toBe("biz-registration");
  });

  it("두 종류의 단서가 비슷하면 지어내지 않고 unknown", () => {
    expect(classifyDocument({ fileName: "a.pdf", text: "사업자등록증 손익계산서 매출원가" })).toBe("unknown");
  });
});
