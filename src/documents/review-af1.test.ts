// 독립 리뷰(Astra) 지적 수정 AF1 — 서류 읽기 11개 항목 중 src/documents 쪽 10개를 리뷰 표본 그대로 재현해 막는다.
// ★표본은 전부 지어낸 값(김가상·800101-1234567·테헤란로 123 …)이다. 실제 회사 정보는 쓰지 않는다.
// (11번 법인 여부 서버 경계는 src/serve/diagnose-profile.test.ts)

import AdmZip from "adm-zip";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { cleanCompanyScale, cleanIndustryText } from "./clean-text";
import { exceedsPdfPageLimit, extractDocumentText } from "./extract-text";
import { readDocuments } from "./index";
import { parseBizRegistration } from "./parse-biz-registration";
import { parseEmployment } from "./parse-employment";
import { parseFinancial } from "./parse-financial";
import { EMPLOYMENT_ROWS, HEAD, docxOf, txtOf, xlsxOf, xlsxTableOf } from "./__fixtures__/samples";

/** 결과 어디에도 있으면 안 되는 가짜 개인정보 조각 */
const LEAK = ["김가상", "800101", "테헤란로"] as const;

function expectNoLeak(value: unknown): void {
  const json = JSON.stringify(value);
  for (const piece of LEAK) expect(json).not.toContain(piece);
}

/* ───────── 1. 종목 뒤 개인정보 ───────── */

const REGISTRATION_WITH_TAIL = [
  "사업자등록증",
  "등록번호 : 123-81-67890",
  "상호 : 가상테크",
  "개업연월일 : 2018 년 03 월 12 일",
  "사업장 소재지 : 서울특별시 강남구 테헤란로 123",
  "업태 서비스업 종목 소프트웨어 개발 성명 : 김가상 주민등록번호 : 800101-1234567 주소 : 서울특별시 강남구 테헤란로 123",
].join("\n");

describe("AF1-1 종목 뒤에 이어 붙은 이름·주민번호·주소", () => {
  it("종목 값은 다음 항목 이름(성명)에서 끊긴다", () => {
    const r = parseBizRegistration(REGISTRATION_WITH_TAIL);
    expect(r.fields.industry).toBe("서비스업 / 소프트웨어 개발");
    expectNoLeak(r);
  });

  it("항목 이름이 아닌 「대표」 꼬리도 최종 거르개가 자른다", () => {
    const r = parseBizRegistration("사업자등록증\n업태 서비스업 종목 소프트웨어 개발 대표 김가상");
    expect(r.fields.industry).toBe("서비스업 / 소프트웨어 개발");
    expectNoLeak(r);
  });

  it("종목 뒤에 주민번호 모양이 바로 붙으면 업종 칸을 버린다", () => {
    const r = parseBizRegistration("사업자등록증\n업태 서비스업 종목 소프트웨어 개발 800101-1234567");
    expect(r.fields.industry).toBeUndefined();
    expectNoLeak(r);
  });

  it("파일을 끝까지 읽은 결과(JSON 전체)에도 이름·주민번호·도로명이 없다", async () => {
    const result = await readDocuments([{ name: "사업자등록증.txt", bytes: txtOf(REGISTRATION_WITH_TAIL) }]);
    expect(result.files[0].status).toBe("read");
    expect(result.fields.industry).toBe("서비스업 / 소프트웨어 개발");
    expectNoLeak(result);
  });

  it("글자 칸 거르개: 다음 항목 이름에서 자르고, 주민번호·주소 모양은 버린다", () => {
    expect(cleanIndustryText("소프트웨어 개발 성명 김가상")).toBe("소프트웨어 개발");
    expect(cleanIndustryText("제조업 800101-1234567")).toBeNull();
    expect(cleanIndustryText("제조업 8001011234567")).toBeNull(); // 하이픈 없는 13자리
    expect(cleanIndustryText("서울 강남구 테헤란로 123")).toBeNull();
    expect(cleanIndustryText("제조업 서울 강남구 역삼동 123번지")).toBeNull();
    expect(cleanIndustryText("전자부품 제조")).toBe("전자부품 제조");
    expect(cleanIndustryText(123)).toBeNull();
  });

  it("업종은 40자까지만 남긴다", () => {
    const out = cleanIndustryText("전자부품 제조 ".repeat(20));
    expect(out).not.toBeNull();
    expect(Array.from(out ?? "").length).toBeLessThanOrEqual(40);
  });

  it("규모 거르개: 정해진 값만 남긴다", () => {
    expect(cleanCompanyScale("중소기업")).toBe("중소기업");
    expect(cleanCompanyScale(" 중견 기업 ")).toBe("중견기업");
    expect(cleanCompanyScale("소상공인")).toBe("소상공인");
    expect(cleanCompanyScale("예비창업자")).toBe("예비창업자");
    expect(cleanCompanyScale("대기업")).toBeNull();
    expect(cleanCompanyScale("김가상 중소기업")).toBeNull();
    expect(cleanCompanyScale(5)).toBeNull();
  });

  it("가짜 AI 응답(업종·규모에 이름·도로명)도 같은 거르개로 걸러 JSON 전체에 새지 않는다", async () => {
    const aiFields = {
      industry: "소프트웨어 개발 대표자 김가상 서울 강남구 테헤란로 123",
      companyScale: "김가상 중소기업",
      businessAddress: "서울특별시 강남구 테헤란로 123 가상빌딩",
      bizno: "123-81-67890",
    };
    const result = await readDocuments([{ name: "사업자등록증.png", bytes: HEAD.png }], {
      aiReader: async () => aiFields as never,
    });
    expect(result.files[0].status).toBe("read-by-ai");
    expect(result.fields.industry).toBe("소프트웨어 개발");
    expect(result.fields.companyScale).toBeUndefined();
    expectNoLeak(result);
  });

  it("AI 가 업종 자리에 주소·주민번호만 적어 보내면 업종 칸을 버린다", async () => {
    for (const industry of ["서울 강남구 테헤란로 123", "제조업 8001011234567", "제조업 800101-1234567"]) {
      const result = await readDocuments([{ name: "사진.png", bytes: HEAD.png }], {
        aiReader: async () => ({ industry, companyScale: "중소기업" }) as never,
      });
      expect(result.fields.industry).toBeUndefined();
      expect(result.fields.companyScale).toBe("중소기업");
      expectNoLeak(result);
    }
  });
});

/* ───────── BF3-1. 업종 칸 끝에 붙은 주소 꼬리·이름 꼬리 ───────── */

describe("BF3-1 업종 칸의 주소 꼬리·이름 꼬리", () => {
  it("리뷰 표본: 종목 뒤에 번호 없는 지번 주소가 붙어도 시도·시군구·동·번지가 남지 않는다", () => {
    const out = cleanIndustryText("서비스업 / 소프트웨어 개발 서울 강남구 역삼동 123");
    expect(out).toBe("서비스업 / 소프트웨어 개발");
    const r = parseBizRegistration("사업자등록증\n업태 서비스업 종목 소프트웨어 개발 서울 강남구 역삼동 123");
    const json = JSON.stringify(r);
    for (const piece of ["역삼동", "123", "강남구", "서울"]) expect(json).not.toContain(piece);
  });

  it("시도 이름이나 「…동·로·길 + 숫자」 모양이 나오는 자리에서 그 앞까지만 남긴다", () => {
    expect(cleanIndustryText("소프트웨어 개발 경기도 성남시")).toBe("소프트웨어 개발");
    expect(cleanIndustryText("전자부품 제조 충청남도 천안시")).toBe("전자부품 제조");
    expect(cleanIndustryText("전자부품 제조 서울특별시")).toBe("전자부품 제조");
    expect(cleanIndustryText("전자부품 제조 역삼동 12")).toBe("전자부품 제조");
    expect(cleanIndustryText("전자부품 제조 가상읍 7-1")).toBe("전자부품 제조");
    expect(cleanIndustryText("전자부품 제조 가상로 12")).toBeNull(); // 도로명 주소 모양은 기존대로 칸을 버린다
    expect(cleanIndustryText("서울 전자부품 제조")).toBeNull(); // 맨 앞에서 잘려 남는 것이 없다
  });

  it("업종 낱말은 주소로 오해해 자르지 않는다", () => {
    expect(cleanIndustryText("경기장 운영업")).toBe("경기장 운영업");
    expect(cleanIndustryText("자동 3D 프린터 제조")).toBe("자동 3D 프린터 제조");
  });

  it("리뷰 표본: 가짜 AI 가 이름을 personNames 로 알려 주면 업종 끝에 붙은 이름은 버린다", async () => {
    const result = await readDocuments([{ name: "사진.png", bytes: HEAD.png }], {
      aiReader: async () =>
        ({ industry: "소프트웨어 개발 김가상", companyScale: "중소기업", personNames: ["김가상"] }) as never,
    });
    expect(result.fields.industry).toBe("소프트웨어 개발");
    expect(JSON.stringify(result)).not.toContain("김가상");
  });

  it("이름은 글자 모양으로 짐작해 지우지 않고, 알려 준 이름(names)만 지운다(공백 무시)", () => {
    expect(cleanIndustryText("소프트웨어 개발 김가상", undefined, ["김가상"])).toBe("소프트웨어 개발");
    expect(cleanIndustryText("제조업 박가상", undefined, ["박가상"])).toBe("제조업");
    expect(cleanIndustryText("서비스업 / 도소매업 남궁가상", undefined, ["남궁가상"])).toBe("서비스업 / 도소매업"); // 4자 이름
    expect(cleanIndustryText("제조업 / 박 가 상 / 원단", undefined, ["박가상"])).toBe("제조업 / 원단");
    expect(cleanIndustryText("김가상", undefined, ["김가상"])).toBeNull();
    expect(cleanIndustryText("소프트웨어 개발 김가상")).toBe("소프트웨어 개발 김가상"); // 이름을 모르면 그대로
  });

  it("잘못 지우지 않기: 흔한 업종은 그대로 둔다", () => {
    for (const ok of [
      "정보통신업",
      "배추김치 제조",
      "조경 공사",
      "한식 음식점",
      "이벤트 대행",
      "장비 임대",
      "소프트웨어 공급",
      "전자상거래 도소매",
      "제조업",
      "도매 및 소매업",
      "인쇄",
    ]) {
      expect(cleanIndustryText(ok)).toBe(ok);
    }
  });
});

/* ───────── 2. 엑셀 범위 ───────── */

/** 작은 엑셀의 시트 범위(`dimension`)만 터무니없이 고쳐 쓴다 — 칸을 실제로 만들지 않아 표본 만들기는 빠르다. */
function xlsxWithDimension(ref: string): Buffer {
  const zip = new AdmZip(xlsxTableOf("큰범위", [["가", "나"], ["다", "라"]]));
  const name = "xl/worksheets/sheet1.xml";
  const patched = zip.readAsText(name).replace(/<dimension\s+ref="[^"]*"\s*\/>/, `<dimension ref="${ref}"/>`);
  if (!patched.includes(ref)) throw new Error("표본의 시트 범위를 바꾸지 못했다");
  zip.updateFile(name, Buffer.from(patched, "utf-8"));
  return zip.toBuffer();
}

describe("AF1-2 시트 범위만 큰 엑셀", () => {
  it("범위가 A1:ZZZZ100 이어도 1초 안에 끝나고 잘림 표시가 붙는다", async () => {
    const bytes = xlsxWithDimension("A1:ZZZZ100");
    const started = Date.now();
    const r = await extractDocumentText("범위.xlsx", bytes);
    expect(Date.now() - started).toBeLessThan(1000);
    if (r.kind !== "spreadsheet") throw new Error(`엑셀로 읽혀야 한다: ${r.kind}`);
    expect(r.sheets[0].truncated).toBe(true);
    expect(r.sheets[0].cells.A1).toBe("가");
  });

  // 행 상한(sheetRows)을 주면 읽기 도구가 범위를 실제로 읽은 줄까지 줄인다 — 범위만 넓고 자료가 2줄이면
  // 잃은 줄이 없으니 잘림 표시도 없어야 맞다(진짜 2,001줄 명부의 잘림은 AF1-5 시험이 본다).
  it("행 범위만 넓고 실제 줄은 적으면 빨리 끝나고 잘림 표시가 없다", async () => {
    const started = Date.now();
    const r = await extractDocumentText("행.xlsx", xlsxWithDimension("A1:B500000"));
    expect(Date.now() - started).toBeLessThan(1000);
    if (r.kind !== "spreadsheet") throw new Error(`엑셀로 읽혀야 한다: ${r.kind}`);
    expect(r.sheets[0].truncated).toBeUndefined();
    expect(r.sheets[0].cells.B2).toBe("라");
  });

  it("범위가 정상인 엑셀에는 잘림 표시가 없다", async () => {
    const r = await extractDocumentText("정상.xlsx", xlsxTableOf("정상", [["가", "나"], ["다", "라"]]));
    if (r.kind !== "spreadsheet") throw new Error(`엑셀로 읽혀야 한다: ${r.kind}`);
    expect(r.sheets[0].truncated).toBeUndefined();
  });
});

/* ───────── BF3-4. 읽기 상한 뒤에 값이 있는 줄 ───────── */

/** 머리글 + 2행, 그리고 3,000행에 직원이 한 명씩 있는 명부 — 사이 줄은 비어 있다(실제로 만들지 않아 표본 만들기는 빠르다). */
function rosterWithFarRow(farRow: number): Buffer {
  const ws: XLSX.WorkSheet = {
    A1: { t: "s", v: "근로자 이름" },
    B1: { t: "s", v: "근로자 주민번호" },
    C1: { t: "s", v: "고용상태" },
    D1: { t: "s", v: "취득일" },
    A2: { t: "s", v: "가상직원일" },
    B2: { t: "s", v: "900101-1111111" },
    C2: { t: "s", v: "고용" },
    D2: { t: "s", v: "2022-01-03" },
    [`A${farRow}`]: { t: "s", v: "가상직원이" },
    [`B${farRow}`]: { t: "s", v: "910202-2222222" },
    [`C${farRow}`]: { t: "s", v: "고용" },
    [`D${farRow}`]: { t: "s", v: "2023-02-01" },
    "!ref": `A1:D${farRow}`,
  };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "고용현황");
  return Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer);
}

describe("BF3-4 2,000줄 뒤에만 값이 있는 엑셀", () => {
  it("3,000행에 직원이 있으면 직원 수를 채우지 않고 직접 적도록 안내한다(1초 안)", async () => {
    const started = Date.now();
    const result = await readDocuments([{ name: "고용보험 가입자명부.xlsx", bytes: rosterWithFarRow(3000) }]);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(result.fields.employeeCount).toBeUndefined();
    expect(result.files[0].message).toContain("명부가 너무 길어 직원 수를 다 세지 못했어요 — 직원 수는 직접 적어 주세요");
  });

  it("값이 있는 마지막 줄이 상한 안(2,000행)이면 잘림 표시가 없다", async () => {
    const r = await extractDocumentText("명부.xlsx", rosterWithFarRow(2000));
    if (r.kind !== "spreadsheet") throw new Error(`엑셀로 읽혀야 한다: ${r.kind}`);
    expect(r.sheets[0].truncated).toBeUndefined();
  });

  it("3,000행이 값 없는 줄(서식만)이면 잘림 표시가 없다", async () => {
    const zip = new AdmZip(xlsxTableOf("서식줄", [["가", "나"], ["다", "라"]]));
    const name = "xl/worksheets/sheet1.xml";
    const patched = zip.readAsText(name).replace("</sheetData>", `<row r="3000"><c r="A3000"/></row></sheetData>`);
    if (!patched.includes(`<row r="3000">`)) throw new Error("표본의 시트를 고치지 못했다");
    zip.updateFile(name, Buffer.from(patched, "utf-8"));
    const r = await extractDocumentText("서식.xlsx", zip.toBuffer());
    if (r.kind !== "spreadsheet") throw new Error(`엑셀로 읽혀야 한다: ${r.kind}`);
    expect(r.sheets[0].truncated).toBeUndefined();
  });

  it("값이 있는 3,000행 한 칸이 있으면 잘림 표시가 붙는다", async () => {
    const r = await extractDocumentText("명부.xlsx", rosterWithFarRow(3000));
    if (r.kind !== "spreadsheet") throw new Error(`엑셀로 읽혀야 한다: ${r.kind}`);
    expect(r.sheets[0].truncated).toBe(true);
    expect(r.sheets[0].cells.A2).toBe("가상직원일");
  });
});

/* ───────── 3. 한글(hwpx) 닫히지 않은 각주 ───────── */

function hwpxWithBody(body: string): Buffer {
  const zip = new AdmZip();
  zip.addFile(
    "Contents/section0.xml",
    Buffer.from(
      `<?xml version="1.0" encoding="UTF-8"?><hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph">${body}</hs:sec>`,
      "utf-8",
    ),
  );
  return zip.toBuffer();
}

const hpPara = (t: string) => `<hp:p><hp:run><hp:t>${t}</hp:t></hp:run></hp:p>`;

describe("AF1-3 닫히지 않은 각주 태그", () => {
  it("닫히지 않은 <hp:footNote> 100,000개도 1초 안에 끝나고 본문은 남는다", async () => {
    const bytes = hwpxWithBody(hpPara("본문 글자") + "<hp:footNote>".repeat(100_000));
    const started = Date.now();
    const r = await extractDocumentText("각주.hwpx", bytes);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(r).toEqual({ kind: "text", text: "본문 글자" });
  });

  it("닫는 태그가 없으면 그 시작 태그만 지우고 뒤 글자는 그대로 읽는다", async () => {
    const r = await extractDocumentText("각주.hwpx", hwpxWithBody(hpPara("앞") + "<hp:footNote>" + hpPara("뒤")));
    expect(r).toEqual({ kind: "text", text: "앞\n뒤" });
  });

  it("닫힌 각주는 예전처럼 본문 뒤에 모은다", async () => {
    const body = hpPara("본문") + `<hp:footNote>${hpPara("각주글")}</hp:footNote>`;
    const r = await extractDocumentText("각주.hwpx", hwpxWithBody(body));
    expect(r).toEqual({ kind: "text", text: "본문\n\n[각주]\n각주글" });
  });
});

/* ───────── 4. PDF 쪽수 ───────── */

async function pdfWithPages(pages: number, lineOf?: (n: number) => string): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let n = 1; n <= pages; n++) {
    const page = doc.addPage([600, 800]);
    if (lineOf) page.drawText(lineOf(n), { x: 24, y: 760, size: 10, font });
  }
  return Buffer.from(await doc.save());
}

describe("AF1-4 PDF 쪽수 제한", () => {
  it("쪽수 확인: 30쪽까지는 읽고 31쪽부터는 읽지 않는다", () => {
    expect(exceedsPdfPageLimit(0)).toBe(false);
    expect(exceedsPdfPageLimit(30)).toBe(false);
    expect(exceedsPdfPageLimit(31)).toBe(true);
  });

  it("31쪽 PDF 는 글자를 뽑지 않고 안내만 돌려준다", async () => {
    const r = await extractDocumentText("긴문서.pdf", await pdfWithPages(31));
    expect(r.kind).toBe("unsupported");
    if (r.kind === "unsupported") expect(r.reason).toContain("30쪽이 넘는 PDF는 필요한 쪽만 따로 저장해 올려 주세요");
  });

  it("30쪽 PDF 는 한 쪽씩 차례로 읽어 쪽 순서대로 이어 준다", async () => {
    const bytes = await pdfWithPages(30, (n) => `Page ${n} sample text for the fake company ledger line number ${n}`);
    const r = await extractDocumentText("서른쪽.pdf", bytes);
    expect(r.kind).toBe("text");
    if (r.kind !== "text") return;
    expect(r.text.indexOf("Page 1 ")).toBeGreaterThanOrEqual(0);
    expect(r.text.indexOf("Page 30 ")).toBeGreaterThan(r.text.indexOf("Page 29 "));
  });
});

/* ───────── 5. 명부가 잘렸을 때 직원 수 ───────── */

function rosterRows(count: number): Array<Array<string | number>> {
  const rows: Array<Array<string | number>> = [["근로자 이름", "근로자 주민번호", "고용상태", "취득일"]];
  for (let i = 1; i <= count; i++) rows.push([`가상직원${i}`, `900101-${1_000_000 + i}`, "고용", "2022-01-03"]);
  return rows;
}

describe("AF1-5 2,000행을 넘는 고용보험 명부", () => {
  it("2,001명 명부는 직원 수를 채우지 않고 직접 적도록 안내한다", async () => {
    const result = await readDocuments([{ name: "고용보험 가입자명부.xlsx", bytes: xlsxTableOf("고용현황", rosterRows(2001)) }]);
    expect(result.fields.employeeCount).toBeUndefined();
    expect(result.files[0].docType).toBe("employment-insurance");
    expect(result.files[0].message).toContain("명부가 너무 길어 직원 수를 다 세지 못했어요 — 직원 수는 직접 적어 주세요");
  });

  it("상한 안(1,999명)의 명부는 그대로 센다", async () => {
    const result = await readDocuments([{ name: "고용보험 가입자명부.xlsx", bytes: xlsxTableOf("고용현황", rosterRows(1999)) }]);
    expect(result.fields.employeeCount).toBe(1999);
  });
});

/* ───────── 6. 1904 날짜 체계 ───────── */

/** 1904 체계(맥 엑셀 옛 파일)로 표시한 엑셀 — 날짜 번호 41456 을 담은 칸 하나. */
function xlsxWithDate1904(): Buffer {
  const zip = new AdmZip(xlsxOf({ 날짜: { A1: { serial: 41456, format: "yyyy-mm-dd" } } }));
  const name = "xl/workbook.xml";
  const xml = zip.readAsText(name);
  const patched = xml.includes("<workbookPr")
    ? xml.replace("<workbookPr", '<workbookPr date1904="1"')
    : xml.replace("<sheets>", '<workbookPr date1904="1"/><sheets>');
  if (!patched.includes('date1904="1"')) throw new Error("표본에 1904 표시를 달지 못했다");
  zip.updateFile(name, Buffer.from(patched, "utf-8"));
  return zip.toBuffer();
}

describe("AF1-6 통합 문서 date1904", () => {
  it("date1904 가 켜진 문서는 같은 번호가 1,462일 뒤 날짜로 읽힌다(41456 → 2017-07-02)", async () => {
    const r = await extractDocumentText("옛맥.xlsx", xlsxWithDate1904());
    if (r.kind !== "spreadsheet") throw new Error(`엑셀로 읽혀야 한다: ${r.kind}`);
    expect(r.sheets[0].cells.A1).toBe("2017-07-02");
  });

  it("1900 체계 문서는 그대로다(41456 → 2013-07-01)", async () => {
    const bytes = xlsxOf({ 날짜: { A1: { serial: 41456, format: "yyyy-mm-dd" } } });
    const r = await extractDocumentText("보통.xlsx", bytes);
    if (r.kind !== "spreadsheet") throw new Error(`엑셀로 읽혀야 한다: ${r.kind}`);
    expect(r.sheets[0].cells.A1).toBe("2013-07-01");
  });
});

/* ───────── 7. 워드(탭)·쉼표·`|` 고용보험 표 ───────── */

describe("AF1-7 같은 명부를 어느 모양으로 넣어도 같은 인원", () => {
  const lines = (sep: string) => EMPLOYMENT_ROWS.map((row) => row.join(sep)).join("\n");

  it("탭·쉼표·`|` 로 나뉜 글", () => {
    expect(parseEmployment({ text: lines("\t") }).fields.employeeCount).toBe(3);
    expect(parseEmployment({ text: lines(",") }).fields.employeeCount).toBe(3);
    expect(parseEmployment({ text: lines(" | ") }).fields.employeeCount).toBe(3);
    expect(parseEmployment({ text: EMPLOYMENT_ROWS.map((row) => `| ${row.join(" | ")} |`).join("\n") }).fields.employeeCount).toBe(3);
  });

  it("엑셀과 워드(표 칸 사이 탭)가 같은 인원을 낸다", async () => {
    const xlsx = await readDocuments([{ name: "고용보험 명부.xlsx", bytes: xlsxTableOf("고용현황", EMPLOYMENT_ROWS) }]);
    const docx = await readDocuments([
      { name: "고용보험 명부.docx", bytes: docxOf(["고용보험 가입자명부", ...EMPLOYMENT_ROWS.map((row) => row.map(String))]) },
    ]);
    expect(xlsx.fields.employeeCount).toBe(3);
    expect(docx.fields.employeeCount).toBe(3);
  });
});

/* ───────── 8. 한글(hwpx) 표 ───────── */

const hpCell = (t: string) => `<hp:tc><hp:subList>${hpPara(t)}</hp:subList></hp:tc>`;
const hpTable = (rows: string[][]) =>
  `<hp:tbl>${rows.map((cells) => `<hp:tr>${cells.map(hpCell).join("")}</hp:tr>`).join("")}</hp:tbl>`;

describe("AF1-8 hwpx 표의 행·칸", () => {
  it("칸 사이는 탭, 행 사이는 줄바꿈으로 넘긴다", async () => {
    const bytes = hwpxWithBody(hpTable([["상호", "가상테크"], ["매출액", "123456789"]]));
    expect(await extractDocumentText("표.hwpx", bytes)).toEqual({ kind: "text", text: "상호\t가상테크\n매출액\t123456789" });
  });

  it("표 칸에 나뉜 「매출액 | 123456789」 가 매출로 읽힌다", async () => {
    const body = hpPara("표준손익계산서") + `<hp:p><hp:run>${hpTable([["매출액", "123456789"]])}</hp:run></hp:p>`;
    const result = await readDocuments([{ name: "손익계산서.hwpx", bytes: hwpxWithBody(body) }]);
    expect(result.files[0].docType).toBe("financial-statement");
    expect(result.fields.lastYearRevenueKrw).toBe(123_456_789);
  });
});

/* ───────── 9. CSV ───────── */

describe("AF1-9 CSV 는 따옴표를 지키며 열을 나눈다", () => {
  const readCsv = (text: string) => readDocuments([{ name: "손익.csv", bytes: txtOf(text) }]);

  it("「매출액,123456789」가 매출로 읽힌다", async () => {
    const result = await readCsv("표준손익계산서\n매출액,123456789");
    expect(result.files[0].docType).toBe("financial-statement");
    expect(result.fields.lastYearRevenueKrw).toBe(123_456_789);
  });

  it("따옴표 안 쉼표 금액(\"123,456,789\")을 한 칸으로 읽는다", async () => {
    const result = await readCsv('표준손익계산서\n"매출액","123,456,789"');
    expect(result.fields.lastYearRevenueKrw).toBe(123_456_789);
  });

  it("빈 열이 끼어도 읽는다", async () => {
    const result = await readCsv('표준손익계산서\n매출액,,"123,456,789"');
    expect(result.fields.lastYearRevenueKrw).toBe(123_456_789);
  });

  it("파서에 csv 표시를 직접 넘겨도 같다", () => {
    expect(parseFinancial({ text: '표준손익계산서\n매출액,"1,234,567,890"', csv: true }, "financial-statement").fields).toEqual({
      lastYearRevenueKrw: 1_234_567_890,
    });
  });
});

/* ───────── 10. 재무제표의 계정 코드 열 ───────── */

describe("AF1-10 계정 코드 열이 금액으로 읽히지 않는다", () => {
  const read = (...lines: string[]) => parseFinancial({ text: ["표준손익계산서", ...lines].join("\n") }, "financial-statement");

  it("머리글이 없을 때 0으로 시작하는 6자리 이하 숫자는 코드로 보고 건너뛴다", () => {
    expect(read("매출액 | 001 | 123456789").fields).toEqual({ lastYearRevenueKrw: 123_456_789 });
  });

  it("머리글에 당기 열이 있으면 그 열에서 읽는다", () => {
    const r = read("과목 | 코드 | 당기 | 전기", "매출액 | 001 | 123456789 | 98765432");
    expect(r.fields).toEqual({ lastYearRevenueKrw: 123_456_789 });
  });

  it("머리글에 금액 열이 있으면 그 열에서 읽는다", () => {
    expect(read("계정과목 | 계정코드 | 금액", "매출액 | 0101 | 5,000,000").fields).toEqual({ lastYearRevenueKrw: 5_000_000 });
  });

  it("당기 머리글 없이 코드 열 머리글만 있어도 코드 열을 뺀다(0으로 시작하지 않는 코드)", () => {
    expect(read("계정과목 | 코드 | 합계", "매출액 | 401 | 123456789").fields).toEqual({ lastYearRevenueKrw: 123_456_789 });
  });

  it("후보가 코드뿐이면 채우지 않는다", () => {
    const r = read("매출액 | 001");
    expect(r.fields).toEqual({});
    expect(r.note).toBeTruthy();
  });

  it("당기 칸이 비어 있으면 전기 값을 대신 쓰지 않는다", () => {
    const r = read("과목\t당기\t전기", "매출액\t\t987654");
    expect(r.fields).toEqual({});
  });

  it("기존 당기/전기 줄은 그대로 첫(당기) 숫자를 읽는다", () => {
    expect(read("(단위: 천원)", "과목      당기       전기", "Ⅰ.매출액   1,000     900").fields).toEqual({
      lastYearRevenueKrw: 1_000_000,
    });
  });
});

/* ───────── BF3-3. 빈 금액 열을 건너뛰고 옆 칸을 읽지 않는다 ───────── */

describe("BF3-3 표의 빈 칸이 열 위치를 밀지 않는다", () => {
  const readCsv = (...lines: string[]) =>
    parseFinancial({ text: ["표준손익계산서", ...lines].join("\n"), csv: true }, "financial-statement");

  it("쉼표 표: 금액 열이 비면 코드·비고 값으로 매출을 채우지 않는다", () => {
    const r = readCsv("계정과목,코드,금액,비고", "매출액,401,,123456789");
    expect(r.fields).toEqual({});
    expect(r.note).toBeTruthy();
  });

  it("쉼표 표: 당기 열이 비면 전기 값으로 매출을 채우지 않는다", () => {
    expect(readCsv("과목,당기,전기", "매출액,,987654").fields).toEqual({});
  });

  it("쉼표 표: 금액 열에 값이 있으면 그 열을 읽는다(빈 비고 열이 뒤에 있어도)", () => {
    expect(readCsv("계정과목,코드,금액,비고", "매출액,401,5000000,").fields).toEqual({ lastYearRevenueKrw: 5_000_000 });
    expect(readCsv("과목,당기,전기", '매출액,"1,000",900').fields).toEqual({ lastYearRevenueKrw: 1_000 });
  });

  it("엑셀: 당기 칸이 빈 줄은 매출을 채우지 않는다", async () => {
    const bytes = xlsxTableOf("손익계산서", [["표준손익계산서"], ["과목", "당기", "전기"], ["매출액", "", 987_654]]);
    const extracted = await extractDocumentText("손익.xlsx", bytes);
    if (extracted.kind !== "spreadsheet") throw new Error("엑셀로 읽혀야 한다");
    expect(parseFinancial({ sheets: extracted.sheets }, "financial-statement").fields).toEqual({});
  });

  it("엑셀: 코드 열 옆의 빈 금액 칸도 채우지 않고, 값이 있으면 읽는다", async () => {
    const make = async (amount: string | number) => {
      const bytes = xlsxTableOf("손익계산서", [["계정과목", "코드", "금액", "비고"], ["매출액", 401, amount, 123_456_789]]);
      const extracted = await extractDocumentText("손익.xlsx", bytes);
      if (extracted.kind !== "spreadsheet") throw new Error("엑셀로 읽혀야 한다");
      return parseFinancial({ sheets: extracted.sheets }, "financial-statement").fields;
    };
    expect(await make("")).toEqual({});
    expect(await make(7_000_000)).toEqual({ lastYearRevenueKrw: 7_000_000 });
  });

  it("탭 표 글: 빈 칸이 있어도 같은 규칙이다", () => {
    const r = parseFinancial({ text: "표준손익계산서\n계정과목\t코드\t금액\t비고\n매출액\t401\t\t123456789" }, "financial-statement");
    expect(r.fields).toEqual({});
  });
});
