import AdmZip from "adm-zip";
import { describe, expect, it } from "vitest";
import { readDocuments } from "./index";
import { SPREADSHEET_ZIP_MAX_TOTAL_BYTES } from "./spreadsheet-zip-guard";
import { DOCUMENT_UPLOAD_LIMITS, type DocumentFields } from "./types";
import {
  BIZ_REGISTRATION_CORP_TEXT,
  BIZ_REGISTRATION_PERSONAL_TEXT,
  EMPLOYMENT_ROWS,
  FAKE,
  FINANCIAL_STATEMENT_TEXT,
  HEAD,
  TAX_BASE_CERT_TEXT,
  VAT_RETURN_TEXT,
  blankPdf,
  companyStatusSheet,
  docxOf,
  txtOf,
  xlsxOf,
  xlsxTableOf,
} from "./__fixtures__/samples";

const MB = 1024 * 1024;

const reg = { name: "사업자등록증.txt", bytes: txtOf(BIZ_REGISTRATION_CORP_TEXT) };
const personal = { name: "사업자등록증명.txt", bytes: txtOf(BIZ_REGISTRATION_PERSONAL_TEXT) };
const status = { name: "기업상태표.xlsx", bytes: xlsxOf({ 기업상태표: companyStatusSheet() }) };
const financial = { name: "재무제표.txt", bytes: txtOf(FINANCIAL_STATEMENT_TEXT) };
const vat = { name: "부가세신고서.txt", bytes: txtOf(VAT_RETURN_TEXT) };
const taxBase = { name: "과세표준증명.txt", bytes: txtOf(TAX_BASE_CERT_TEXT) };
const employment = { name: "고용산재가입자명부.xlsx", bytes: xlsxTableOf("고용현황", EMPLOYMENT_ROWS) };
const memo = { name: "메모.txt", bytes: txtOf("안녕하세요. 가상 회의 메모입니다.") };
const photo = { name: "사업자등록증.jpg", bytes: HEAD.jpeg };

const sorted = (list: string[]) => [...list].sort();

describe("readDocuments — 종류 가르기와 칸 뽑기", () => {
  it("서류 종류 6가지를 가른다", async () => {
    const r = await readDocuments([reg, status, financial, vat, employment, memo]);
    expect(r.files.map((f) => f.docType)).toEqual([
      "biz-registration",
      "company-status",
      "financial-statement",
      "vat-return",
      "employment-insurance",
      "unknown",
    ]);
  });

  it("서류마다 읽은 칸 이름을 적는다", async () => {
    const r = await readDocuments([reg, status, financial, vat, taxBase, employment]);
    const byName = (name: string) => r.files.find((f) => f.name === name);
    expect(sorted(byName("사업자등록증.txt")!.fields)).toEqual(
      sorted(["bizno", "foundedDate", "industry", "region", "regionSigungu", "businessAddress", "isCorporation"]),
    );
    expect(byName("재무제표.txt")).toMatchObject({ status: "read", year: 2025, fields: ["lastYearRevenueKrw"] });
    expect(byName("부가세신고서.txt")).toMatchObject({ status: "read", year: 2025, fields: ["lastYearRevenueKrw"] });
    expect(byName("과세표준증명.txt")).toMatchObject({ status: "read", year: 2024, fields: ["lastYearRevenueKrw"] });
    expect(byName("고용산재가입자명부.xlsx")).toMatchObject({ status: "read", fields: ["employeeCount"] });
    expect(byName("기업상태표.xlsx")!.fields).toEqual(
      expect.arrayContaining(["foundedDate", "industry", "lastYearRevenueKrw", "employeeCount", "patentCount", "certTypes"]),
    );
  });

  it("워드 파일로 올린 사업자등록증도 읽는다", async () => {
    const docx = { name: "사업자등록증.docx", bytes: docxOf(BIZ_REGISTRATION_CORP_TEXT.split("\n")) };
    const r = await readDocuments([docx]);
    expect(r.files[0]).toMatchObject({ docType: "biz-registration", status: "read" });
    expect(r.fields.bizno).toBe("123-81-67890");
  });

  it("어떤 서류인지 모르면 no-fields + 안내", async () => {
    const r = await readDocuments([memo]);
    expect(r.files[0]).toMatchObject({ docType: "unknown", status: "no-fields", fields: [] });
    expect(r.files[0].message).toBeTruthy();
    expect(r.fields).toEqual({});
  });
});

describe("readDocuments — 합치기", () => {
  it("같은 값은 출처를 모두 적고, 다른 값은 conflicts 에 적는다", async () => {
    const r = await readDocuments([reg, status, financial, employment]);
    expect(r.fields.bizno).toBe("123-81-67890");
    expect(r.sources.foundedDate?.files).toEqual(["사업자등록증.txt", "기업상태표.xlsx"]);
    const conflicted = r.conflicts.map((c) => c.field);
    expect(conflicted).toEqual(expect.arrayContaining(["industry", "lastYearRevenueKrw", "employeeCount"]));
    // 재무제표(2025)가 연도 없는 기업상태표보다 앞서고, 고용보험이 기업상태표보다 앞선다.
    expect(r.fields.lastYearRevenueKrw).toBe(1_234_567_000);
    expect(r.fields.employeeCount).toBe(3);
  });

  it("읽은 서류가 없으면 빈 결과", async () => {
    expect(await readDocuments([])).toEqual({ fields: {}, sources: {}, conflicts: [], files: [] });
  });
});

describe("readDocuments — 개인정보·도로명이 결과에 없다", () => {
  it("주민번호·법인등록번호·대표자 이름·도로명·근로자 정보는 결과 JSON 어디에도 없다", async () => {
    const r = await readDocuments([reg, personal, status, employment]);
    expect(r.files.every((f) => f.status === "read")).toBe(true);
    const json = JSON.stringify(r);
    expect(json).not.toContain(FAKE.rep);
    expect(json).not.toContain(FAKE.rrn);
    expect(json).not.toContain(FAKE.corpRegNo);
    expect(json).not.toMatch(/\d{6}-?\d{7}/);
    expect(json).not.toMatch(/동탄대로|테헤란로|가상빌딩|가상직원/);
    expect(r.fields.businessAddress).toBe("경기 화성시");
  });
});

describe("readDocuments — 사진·스캔본", () => {
  it("aiReader 가 없으면 needs-text-pdf + 글자 있는 PDF 안내", async () => {
    const r = await readDocuments([photo, { name: "스캔본.pdf", bytes: await blankPdf() }]);
    for (const f of r.files) {
      expect(f.status).toBe("needs-text-pdf");
      expect(f.message).toContain("글자 있는 PDF");
      expect(f.fields).toEqual([]);
    }
  });

  it("aiReader 가 있으면 read-by-ai 로 읽어 칸을 합친다", async () => {
    const seen: string[] = [];
    const aiReader = async (file: { name: string; bytes: Uint8Array }): Promise<DocumentFields> => {
      seen.push(`${file.name}:${file.bytes.length}`);
      return { bizno: "123-81-67890", employeeCount: 5 };
    };
    const r = await readDocuments([photo, memo], { aiReader });
    expect(seen).toEqual([`사업자등록증.jpg:${HEAD.jpeg.length}`]); // 사진만 넘긴다
    expect(r.files[0]).toMatchObject({ status: "read-by-ai", fields: ["bizno", "employeeCount"] });
    expect(r.fields).toEqual({ bizno: "123-81-67890", employeeCount: 5 });
    expect(r.sources.bizno?.files).toEqual(["사업자등록증.jpg"]);
  });

  it("aiReader 가 돌려준 값도 걸러 낸다 — 도로명·주민번호·모르는 칸은 버리고 주소는 시도+시군구까지만", async () => {
    const dirty = {
      businessAddress: `경기도 화성시 ${FAKE.street}, ${FAKE.building} 5층`,
      bizno: "123-81-67890",
      industry: `제조업 ${FAKE.rrn}`,
      representative: FAKE.rep,
      foundedDate: "어제",
      certTypes: ["벤처", "엉뚱한종류"],
      employeeCount: -3,
    };
    const r = await readDocuments([photo], { aiReader: async () => dirty as unknown as DocumentFields });
    expect(r.fields).toEqual({
      bizno: "123-81-67890",
      businessAddress: "경기 화성시",
      region: "경기",
      regionSigungu: "화성시",
      certTypes: ["벤처"],
    });
    const json = JSON.stringify(r);
    expect(json).not.toMatch(/동탄대로|가상빌딩|representative/);
    expect(json).not.toContain(FAKE.rrn);
    expect(json).not.toContain(FAKE.rep);
  });

  it("aiReader 가 던져도 그 파일만 failed 이고 나머지는 계속 읽는다", async () => {
    const r = await readDocuments([photo, reg], {
      aiReader: async () => {
        throw new Error("내부 오류 800101-1234567");
      },
    });
    expect(r.files[0].status).toBe("failed");
    expect(r.files[0].message).toBeTruthy();
    expect(JSON.stringify(r)).not.toContain("800101-1234567"); // 오류 글을 그대로 내보내지 않는다
    expect(r.files[1].status).toBe("read");
    expect(r.fields.bizno).toBe("123-81-67890");
  });

  it("aiReader 가 빈 값을 주면 no-fields", async () => {
    const r = await readDocuments([photo], { aiReader: async () => ({}) });
    expect(r.files[0].status).toBe("no-fields");
  });
});

describe("readDocuments — 읽을 수 없는 파일", () => {
  it("hwp 는 unsupported + PDF 로 저장하라는 안내", async () => {
    const r = await readDocuments([{ name: "서류.hwp", bytes: HEAD.cfb }]);
    expect(r.files[0]).toMatchObject({ status: "unsupported", docType: "unknown" });
    expect(r.files[0].message).toContain("PDF");
  });

  it("확장자 위장(.xlsx 인데 PDF 머리)은 unsupported", async () => {
    const r = await readDocuments([{ name: "기업상태표.xlsx", bytes: HEAD.pdf }]);
    expect(r.files[0].status).toBe("unsupported");
    expect(r.fields).toEqual({});
  });

  it("엑셀 압축 폭탄은 unsupported 로 거절한다", async () => {
    const zip = new AdmZip();
    zip.addFile("xl/worksheets/sheet1.xml", Buffer.alloc(SPREADSHEET_ZIP_MAX_TOTAL_BYTES + MB));
    const r = await readDocuments([{ name: "폭탄.xlsx", bytes: zip.toBuffer() }]);
    expect(r.files[0].status).toBe("unsupported");
    expect(r.files[0].message).toContain("너무 큽니다");
  });

  it("파일 하나가 읽히지 않아도 나머지는 계속 읽는다", async () => {
    const r = await readDocuments([{ name: "가짜.xlsx", bytes: HEAD.pdf }, reg, { name: "비었음.txt", bytes: new Uint8Array() }, financial]);
    expect(r.files.map((f) => f.status)).toEqual(["unsupported", "read", "unsupported", "read"]);
    expect(r.fields.bizno).toBe("123-81-67890");
    expect(r.fields.lastYearRevenueKrw).toBe(1_234_567_000);
  });
});

describe("readDocuments — 제한", () => {
  it("한 파일이 크기 제한을 넘으면 too-large 로 읽지 않는다", async () => {
    const big = { name: "큰파일.pdf", bytes: new Uint8Array(DOCUMENT_UPLOAD_LIMITS.maxFileBytes + 1) };
    const r = await readDocuments([big, reg]);
    expect(r.files[0]).toMatchObject({ status: "too-large", docType: "unknown", fields: [] });
    expect(r.files[0].message).toContain("20MB");
    expect(r.files[1].status).toBe("read");
  });

  it("개수 초과분은 읽지 않고 failed + 안내", async () => {
    const files = Array.from({ length: DOCUMENT_UPLOAD_LIMITS.maxFiles + 2 }, (_, i) => ({
      name: `메모${i + 1}.txt`,
      bytes: txtOf("가상 메모"),
    }));
    const r = await readDocuments(files);
    expect(r.files).toHaveLength(files.length);
    expect(r.files.slice(0, 10).every((f) => f.status === "no-fields")).toBe(true);
    for (const f of r.files.slice(10)) {
      expect(f.status).toBe("failed");
      expect(f.message).toContain("10개");
    }
  });

  it("합계 크기를 넘기는 파일부터 too-large", async () => {
    const chunk = new Uint8Array(16 * MB); // 한 파일 제한(20MB) 안, 넷이면 합계 제한(50MB) 밖
    const r = await readDocuments(["a.txt", "b.txt", "c.txt", "d.txt"].map((name) => ({ name, bytes: chunk })));
    expect(r.files.map((f) => f.status)).toEqual(["unsupported", "unsupported", "unsupported", "too-large"]);
    expect(r.files[3].message).toContain("50MB");
  });
});

describe("readDocuments — 파일 이름 정리", () => {
  it("경로를 떼고 100자로 자른다(읽기는 원래 이름의 확장자로 한다)", async () => {
    const longName = `${"가".repeat(150)}.txt`;
    const r = await readDocuments([
      { name: `C:\\문서\\제출용\\${longName}`, bytes: reg.bytes },
      { name: `../../etc/${longName}`, bytes: reg.bytes },
    ]);
    for (const f of r.files) {
      expect(f.name).not.toMatch(/[\\/]/);
      expect(Array.from(f.name).length).toBeLessThanOrEqual(100);
      expect(f.status).toBe("read");
    }
  });

  it("이름에 든 주민번호 모양은 가린다", async () => {
    const r = await readDocuments([{ name: `김가상_${FAKE.rrn}.txt`, bytes: reg.bytes }]);
    expect(JSON.stringify(r)).not.toContain(FAKE.rrn);
  });

  it("이름이 비면 안내용 이름을 쓴다", async () => {
    const r = await readDocuments([{ name: "", bytes: reg.bytes }, { name: "폴더/", bytes: reg.bytes }]);
    expect(r.files.every((f) => f.name.length > 0)).toBe(true);
  });
});
