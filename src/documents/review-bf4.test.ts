// 재리뷰(Astra 3차) BF4 ①②③ — src/documents 쪽: 업종 이름 지우기·XML 표기·원 단위 표시.
// ★표본은 전부 지어낸 값(김지원·김가상·이가짜 …)이다. 실제 회사 정보는 쓰지 않는다.
// (④⑤⑥ 화면·서버 건수는 src/ui/policy/review-bf4.test.tsx)

import AdmZip from "adm-zip";
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { cleanIndustryText, cleanPersonNames, personNamesIn } from "./clean-text";
import { extractDocumentText, lastValuedRowOf } from "./extract-text";
import { readDocuments } from "./index";
import { parseBizRegistration, readBizRegistration } from "./parse-biz-registration";
import { parseFinancial } from "./parse-financial";
import { HEAD, txtOf, xlsxOf } from "./__fixtures__/samples";

/* ───────── 1. 업종 이름 지우기 ───────── */

const REGISTRATION = [
  "사업자등록증",
  "등록번호 : 123-81-67890",
  "상호 : 가상테크",
  "대표자 김지원",
  "개업연월일 : 2018 년 03 월 12 일",
  "사업장 소재지 : 서울특별시 강남구 테헤란로 123",
  "업태 서비스업 종목 소프트웨어 개발 김지원",
].join("\n");

const OWNER_ONLY_REGISTRATION = [
  "사업자등록증",
  "등록번호 : 123-81-67890",
  "상호 : 가상테크",
  "대표자 김가상",
  "개업연월일 : 2018 년 03 월 12 일",
].join("\n");

/** 결과 어디에도 있으면 안 되는 이름이 JSON 에 없는지 본다. */
function expectNoName(result: unknown, ...names: string[]): void {
  const json = JSON.stringify(result);
  for (const name of names) expect(json).not.toContain(name);
}

describe("BF4-1 서류가 알려 준 이름만 정확히 지운다", () => {
  it("서류의 「대표자」 값을 이름 목록으로만 돌려주고, 칸·결과 모양에는 넣지 않는다", () => {
    const read = readBizRegistration(REGISTRATION);
    expect(read.personNames).toEqual(["김지원"]);
    expect(read.parsed.fields.industry).toBe("서비스업 / 소프트웨어 개발");
    expectNoName(read.parsed, "김지원"); // 이름은 parsed(칸·안내·연도) 쪽에 없다
    expectNoName(parseBizRegistration(REGISTRATION), "김지원");
  });

  it("「성명」「대표자명」 항목과 글자 사이 공백도 읽는다", () => {
    expect(readBizRegistration("사업자등록증\n성명 : 박가상\n업태 제조업 종목 원단").personNames).toEqual(["박가상"]);
    expect(readBizRegistration("사업자등록증\n대표자명 : 최 가 상\n업태 제조업 종목 원단").personNames).toEqual(["최가상"]);
    expect(personNamesIn(" : 김 지 원")).toEqual(["김지원"]);
    expect(personNamesIn("홍길동, 김지원")).toEqual(["홍길동", "김지원"]);
  });

  it("직함·한 글자·한글이 아닌 값은 이름으로 모으지 않는다", () => {
    expect(personNamesIn("대표이사")).toEqual([]);
    expect(personNamesIn("김")).toEqual([]);
    expect(personNamesIn("123-45")).toEqual([]);
    expect(cleanPersonNames(["김지원", " 김 지원 ", "AB", "대표자", 5, null, "여섯글자이름이다"])).toEqual(["김지원"]);
  });

  it("등록증 전체 경로: 종목 끝에 붙은 대표자 이름이 업종에서 지워진다", async () => {
    const result = await readDocuments([{ name: "사업자등록증.txt", bytes: txtOf(REGISTRATION) }]);
    expect(result.files[0].status).toBe("read");
    expect(result.fields.industry).toBe("서비스업 / 소프트웨어 개발");
    expectNoName(result, "김지원");
  });

  it("묶음 전체: 등록증이 알려 준 대표자 이름이 사진(가짜 AI)의 업종에서도 지워진다", async () => {
    const result = await readDocuments(
      [
        { name: "사업자등록증.txt", bytes: txtOf(OWNER_ONLY_REGISTRATION) },
        { name: "사진.png", bytes: HEAD.png },
      ],
      { aiReader: async () => ({ industry: "소프트웨어 개발 김가상." }) },
    );
    expect(result.files[1].status).toBe("read-by-ai");
    expect(result.fields.industry).toBe("소프트웨어 개발");
    expectNoName(result, "김가상");
  });

  it("사진 순서가 앞이어도 같다(이름은 묶음 전체를 다 읽은 뒤에 지운다)", async () => {
    const result = await readDocuments(
      [
        { name: "사진.png", bytes: HEAD.png },
        { name: "사업자등록증.txt", bytes: txtOf(OWNER_ONLY_REGISTRATION) },
      ],
      { aiReader: async () => ({ industry: "소프트웨어 개발 김가상." }) },
    );
    expect(result.fields.industry).toBe("소프트웨어 개발");
    expectNoName(result, "김가상");
  });

  it("가짜 AI 가 personNames 로 알려 준 이름도 지우고, 결과 어디에도 이름이 없다", async () => {
    const result = await readDocuments([{ name: "사진.png", bytes: HEAD.png }], {
      aiReader: async () => ({ industry: "도소매 이가짜", personNames: ["이가짜"] }),
    });
    expect(result.fields.industry).toBe("도소매");
    expectNoName(result, "이가짜"); // fields·sources·conflicts·files 전부
    expect(Object.keys(result).sort()).toEqual(["conflicts", "fields", "files", "sources"]);
    expect(Object.keys(result.fields)).toEqual(["industry"]);
  });

  it("AI 가 알려 준 이름은 같은 묶음의 다른 사진 업종에서도 지워지고, 이름 모양이 아닌 값은 버린다", async () => {
    let n = 0;
    const result = await readDocuments(
      [
        { name: "사진1.png", bytes: HEAD.png },
        { name: "사진2.png", bytes: HEAD.png },
      ],
      {
        aiReader: async () =>
          ++n === 1
            ? ({ personNames: ["이가짜", "소프트웨어 개발 아주 긴 글", 7 as never] } as never)
            : { industry: "이가짜 소프트웨어 개발" },
      },
    );
    expect(result.files[0].status).toBe("no-fields"); // 이름만 있고 칸이 없는 사진
    expect(result.fields.industry).toBe("소프트웨어 개발");
    expectNoName(result, "이가짜");
  });

  it("이름을 지우고 나면 칸이 하나도 안 남는 파일은 「채울 값 없음」으로 바뀐다", async () => {
    const result = await readDocuments([{ name: "사진.png", bytes: HEAD.png }], {
      aiReader: async () => ({ industry: "김가상", personNames: ["김가상"] }),
    });
    expect(result.files[0].status).toBe("no-fields");
    expect(result.files[0].fields).toEqual([]);
    expect(result.fields.industry).toBeUndefined();
    expectNoName(result, "김가상");
  });

  it("지운 자리 앞뒤 구분표(빗금·쉼표·가운뎃점·빈 괄호·마침표)를 정리한다", () => {
    const clean = (text: string, ...names: string[]) => cleanIndustryText(text, undefined, names);
    expect(clean("서비스업 / 김지원 / 개발", "김지원")).toBe("서비스업 / 개발");
    expect(clean("김지원, 소프트웨어 개발", "김지원")).toBe("소프트웨어 개발");
    expect(clean("소프트웨어 개발 · 김지원", "김지원")).toBe("소프트웨어 개발");
    expect(clean("제조업 (김지원)", "김지원")).toBe("제조업");
    expect(clean("소프트웨어 개발 김 지 원.", "김지원")).toBe("소프트웨어 개발");
    expect(clean("소프트웨어 개발 박가상 김지원", "김지원", "박가상")).toBe("소프트웨어 개발");
    expect(clean("김지원")).toBe("김지원"); // 이름을 모르면 그대로(짐작해 지우지 않는다)
    expect(clean("김지원", "김지원")).toBeNull();
    expect(cleanIndustryText("소프트웨어 개발.")).toBe("소프트웨어 개발"); // 끝 마침표
  });

  it("보존 시험: 이름처럼 보여도 업종이면 그대로 둔다(이름 꼬리를 짐작해 지우지 않는다)", () => {
    for (const ok of [
      "농업 / 양봉",
      "제조업 / 원단",
      "서비스업 / 스포츠 경기 운영업",
      "정보통신업",
      "배추김치 제조",
      "조경 공사",
      "한식 음식점",
      "이벤트 대행",
      "장비 임대",
      "전자부품 제조 서울", // 시도 이름만 홀로 나오면 자르지 않는다
    ]) {
      expect(cleanIndustryText(ok)).toBe(ok);
    }
  });

  it("보존 시험: 등록증 전체 경로에서도 「농업 / 양봉」「제조업 / 원단」이 남는다", async () => {
    for (const [type, item] of [
      ["농업", "양봉"],
      ["제조업", "원단"],
      ["서비스업", "스포츠 경기 운영업"],
    ]) {
      const text = `사업자등록증\n대표자 김지원\n업태 ${type} 종목 ${item}`;
      const result = await readDocuments([{ name: "사업자등록증.txt", bytes: txtOf(text) }]);
      expect(result.fields.industry).toBe(`${type} / ${item}`);
    }
  });

  it("주소 꼬리: 접미어가 붙은 시도·시도+시군구는 자르고, 번지 없는 지번(동·번호)도 자른다", () => {
    expect(cleanIndustryText("소프트웨어 개발 경기 화성시")).toBe("소프트웨어 개발");
    expect(cleanIndustryText("소프트웨어 개발 서울 강남구")).toBe("소프트웨어 개발");
    expect(cleanIndustryText("소프트웨어 개발 충북 청주시")).toBe("소프트웨어 개발");
    expect(cleanIndustryText("소프트웨어 개발 서울특별시")).toBe("소프트웨어 개발");
    expect(cleanIndustryText("소프트웨어 개발 경기도")).toBe("소프트웨어 개발");
    expect(cleanIndustryText("전자부품 제조 역삼동 12")).toBe("전자부품 제조");
    const out = cleanIndustryText("서비스업 / 소프트웨어 개발 서울 강남구 역삼동 123");
    expect(out).toBe("서비스업 / 소프트웨어 개발");
    for (const piece of ["역삼동", "123", "강남구"]) expect(out ?? "").not.toContain(piece);
  });
});

/* ───────── 2. XML 표기 ───────── */

/** 머리글 + 2행, 그리고 3,000행에 직원이 한 명씩 있는 명부(사이 줄은 비어 있다). */
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

type Notation = "double" | "single" | "prefix";

const SHEET_PATH = "xl/worksheets/sheet1.xml";

/** 시트 XML 의 표기만 바꾼다 — 큰따옴표 그대로 / 줄·칸 속성을 작은따옴표로 / 줄·칸·값 태그에 `x:` 접두사. */
function sheetXmlIn(bytes: Buffer, how: Notation): string {
  const xml = new AdmZip(bytes).readAsText(SHEET_PATH);
  if (how === "double") return xml;
  if (how === "single") {
    return xml.replace(/<(row|c)\b([^>]*)>/g, (_m, tag: string, attrs: string) => `<${tag}${attrs.replace(/"/g, "'")}>`);
  }
  const uri = /<worksheet[^>]*\sxmlns="([^"]+)"/.exec(xml)?.[1];
  if (!uri) throw new Error("표본 시트의 이름공간을 찾지 못했다");
  return xml
    .replace(/<worksheet\b/, `<worksheet xmlns:x="${uri}"`)
    .replace(/<(\/?)(row|c|v|is)\b/g, "<$1x:$2");
}

function rosterIn(how: Notation, farRow: number): Buffer {
  const base = rosterWithFarRow(farRow);
  const zip = new AdmZip(base);
  zip.updateFile(SHEET_PATH, Buffer.from(sheetXmlIn(base, how), "utf-8"));
  return zip.toBuffer();
}

describe("BF4-2 줄 태그의 접두사·작은따옴표 표기도 읽는다", () => {
  const NOTATIONS: Notation[] = ["double", "single", "prefix"];

  it("세 표기 모두 값이 있는 마지막 줄 번호는 3000 이다", () => {
    for (const how of NOTATIONS) {
      expect(lastValuedRowOf(sheetXmlIn(rosterWithFarRow(3000), how))).toBe(3000);
    }
    // 손으로 쓴 최소 표본
    expect(lastValuedRowOf(`<sheetData><x:row r="3000"><x:c r="A3000"><x:v>1</x:v></x:c></x:row></sheetData>`)).toBe(3000);
    expect(lastValuedRowOf(`<sheetData><row r='3000'><c r='A3000'><v>1</v></c></row></sheetData>`)).toBe(3000);
    expect(lastValuedRowOf(`<sheetData><x:row r='3000'><x:c r='A3000' t='inlineStr'><x:is><x:t>가</x:t></x:is></x:c></x:row></sheetData>`)).toBe(3000);
  });

  it("서식만 있는 줄·이름만 비슷한 태그는 값이 있는 줄로 세지 않는다", () => {
    expect(lastValuedRowOf(`<sheetData><x:row r='3000'><x:c r='A3000'/></x:row></sheetData>`)).toBe(0);
    expect(lastValuedRowOf(`<sheetData><row r="2"><c r="A2"><v>1</v></c></row></sheetData><rowBreaks r="9000"><v>1</v></rowBreaks>`)).toBe(2);
    expect(lastValuedRowOf(`<sheetData><x:row r='2'><x:c r='A2'><x:v>1</x:v></x:c></x:row></sheetData>`)).toBe(2);
  });

  it("역추적이 길어지지 않는다 — 큰 입력도 빨리 끝난다", () => {
    const filler = "<x:row r='1'><x:c r='A1'/></x:row>".repeat(20_000);
    const started = Date.now();
    lastValuedRowOf(filler);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("세 표기 모두 3,000행 직원이 있는 명부는 직원 수를 확정하지 않는다", async () => {
    for (const how of NOTATIONS) {
      const result = await readDocuments([{ name: "고용보험 가입자명부.xlsx", bytes: rosterIn(how, 3000) }]);
      expect(result.fields.employeeCount).toBeUndefined();
    }
  });

  it("행 범위만 넓은 파일(실제 줄은 2개)은 여전히 잘림 표시가 없다", async () => {
    const zip = new AdmZip(xlsxOf({ 시트: { A1: "가", B1: "나", A2: "다", B2: "라" } }));
    const patched = zip.readAsText(SHEET_PATH).replace(/<dimension\s+ref="[^"]*"\s*\/>/, `<dimension ref="A1:B500000"/>`);
    zip.updateFile(SHEET_PATH, Buffer.from(patched, "utf-8"));
    const r = await extractDocumentText("범위.xlsx", zip.toBuffer());
    if (r.kind !== "spreadsheet") throw new Error(`엑셀로 읽혀야 한다: ${r.kind}`);
    expect(r.sheets[0].truncated).toBeUndefined();
  });
});

/* ───────── 3. 원 단위 표시 ───────── */

describe("BF4-3 금액 칸 끝의 단위 표시·괄호 음수", () => {
  const readCsv = (...lines: string[]) =>
    parseFinancial({ text: ["표준손익계산서", ...lines].join("\n"), csv: true }, "financial-statement");

  it("엑셀: 당기 칸이 표시 형식 #,##0\"원\" 이면 값 그대로 읽는다", async () => {
    const bytes = xlsxOf({
      재무제표: {
        A1: "과목",
        B1: "당기",
        C1: "전기",
        A2: "매출액",
        B2: { serial: 123_456_789, format: '#,##0"원"' },
        C2: 100_000_000,
      },
    });
    const extracted = await extractDocumentText("손익.xlsx", bytes);
    if (extracted.kind !== "spreadsheet") throw new Error("엑셀로 읽혀야 한다");
    expect(parseFinancial({ sheets: extracted.sheets }, "financial-statement").fields).toEqual({
      lastYearRevenueKrw: 123_456_789,
    });
  });

  it("끝의 「원」은 그대로, 「천원」「백만원」은 곱한다", () => {
    expect(readCsv("과목,당기,전기", '매출액,"1,000원",900').fields).toEqual({ lastYearRevenueKrw: 1_000 });
    expect(readCsv("과목,당기,전기", '매출액,"1,000천원",900').fields).toEqual({ lastYearRevenueKrw: 1_000_000 });
    expect(readCsv("과목,당기,전기", "매출액,12백만원,900").fields).toEqual({ lastYearRevenueKrw: 12_000_000 });
  });

  it("머리글의 「단위: 천원」과 겹쳐 곱하지 않는다(칸의 단위가 우선)", () => {
    expect(readCsv("(단위: 천원)", "과목,당기,전기", '매출액,"1,000원",900').fields).toEqual({ lastYearRevenueKrw: 1_000 });
    // 칸에 단위가 없으면 머리글 단위를 그대로 쓴다(기존 동작)
    expect(readCsv("(단위: 천원)", "과목,당기,전기", '매출액,"1,000",900').fields).toEqual({ lastYearRevenueKrw: 1_000_000 });
  });

  it("괄호 음수·빈 칸·글자는 매출로 읽지 않는다", () => {
    expect(readCsv("과목,당기,전기", '매출액,"(1,234)",900').fields).toEqual({});
    expect(readCsv("과목,당기,전기", "매출액,,987654").fields).toEqual({});
    expect(readCsv("과목,당기,전기", "매출액,해당없음,987654").fields).toEqual({});
  });
});
