// 재리뷰(Astra 4차) BF5 — 업종 이름 지우기를 「돌려주기 직전 한 곳」으로 모으고, 남은 6건을 막는다.
// ★표본은 전부 지어낸 값(김가상·김지원·박아름다운별·JOHN SMITH …)이다. 실제 회사 정보는 쓰지 않는다.

import AdmZip from "adm-zip";
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { cleanIndustryText, cleanPersonNames, personNamesIn } from "./clean-text";
import { lastValuedRowOf } from "./extract-text";
import { readDocuments } from "./index";
import { readBizRegistration } from "./parse-biz-registration";
import { HEAD, txtOf } from "./__fixtures__/samples";

/** 결과 어디에도 있으면 안 되는 이름이 JSON 에 없는지 본다(공백·대소문자 차이도 같은 이름으로 본다). */
function expectNoName(result: unknown, ...names: string[]): void {
  const json = JSON.stringify(result).replace(/\s+/g, "").toLowerCase();
  for (const name of names) expect(json).not.toContain(name.replace(/\s+/g, "").toLowerCase());
}

/** 등록증 표본: 대표자 줄은 호출하는 쪽이 정한다. 업태·종목은 업종이 서로 달라 충돌이 생기게 「서비스업 / 도소매」. */
function registration(...personLines: string[]): string {
  return [
    "사업자등록증",
    "등록번호 : 123-81-67890",
    "상호 : 가상테크",
    ...personLines,
    "개업연월일 : 2018 년 03 월 12 일",
    "업태 서비스업 종목 도소매",
  ].join("\n");
}

const photoAi = (industry: string, personNames?: string[]) => ({
  aiReader: async () => ({ industry, ...(personNames ? { personNames } : {}) }),
});

const PHOTO = { name: "사진.png", bytes: HEAD.png };

/* ───────── 1. 라벨 다음 줄의 이름 ───────── */

describe("BF5-1 대표자·성명 라벨 뒤 구분표·빈 줄을 건너 첫 의미 있는 줄에서 이름을 읽는다", () => {
  const FORMS: Array<[string, string]> = [
    ["쌍점 뒤 줄바꿈", "대표자 :\n김가상"],
    ["성명·쌍점·이름이 각각 한 줄", "성명\n:\n김가상"],
    ["빈 줄 뒤 이름", "대표자\n\n김가상"],
  ];

  it("personNamesIn 이 세 모양 모두에서 이름을 꺼낸다", () => {
    for (const [, form] of FORMS) {
      const value = form.replace(/^(대표자|성명)/, "");
      expect(personNamesIn(value)).toEqual(["김가상"]);
    }
  });

  it("등록증 + 다른 업종 사진: fields·sources·conflicts 어디에도 이름이 없다", async () => {
    for (const [label, form] of FORMS) {
      const result = await readDocuments(
        [{ name: "사업자등록증.txt", bytes: txtOf(registration(form)) }, PHOTO],
        photoAi("소프트웨어 개발 김가상."),
      );
      expect(result.files[0].status, label).toBe("read");
      expect(result.conflicts.map((c) => c.field), label).toEqual(["industry"]);
      expect(result.conflicts[0].options.map((o) => o.value).sort(), label).toEqual(["서비스업 / 도소매", "소프트웨어 개발"]);
      expectNoName(result, "김가상");
    }
  });
});

/* ───────── 2. AI 이름 형식 ───────── */

describe("BF5-2 AI 가 알려 준 이름은 영문·한글·공백·점 1~40자면 그대로 지운다", () => {
  it("영문 이름은 대소문자·공백을 무시하고 지운다", async () => {
    const r1 = await readDocuments([PHOTO], photoAi("소프트웨어 개발 JOHN SMITH", ["JOHN SMITH"]));
    expect(r1.fields.industry).toBe("소프트웨어 개발");
    expectNoName(r1, "JOHN SMITH");
    const r2 = await readDocuments([PHOTO], photoAi("소프트웨어 개발 john   smith", ["JOHN SMITH"]));
    expect(r2.fields.industry).toBe("소프트웨어 개발");
    expectNoName(r2, "JOHN SMITH");
    const r3 = await readDocuments([PHOTO], photoAi("소프트웨어 개발 J. Smith", ["J. Smith"]));
    expect(r3.fields.industry).toBe("소프트웨어 개발");
    expectNoName(r3, "J.Smith");
  });

  it("한글 6자 이름도 지운다(AI·서류 라벨 모두)", async () => {
    const ai = await readDocuments([PHOTO], photoAi("소프트웨어 개발 박아름다운별", ["박아름다운별"]));
    expect(ai.fields.industry).toBe("소프트웨어 개발");
    expectNoName(ai, "박아름다운별");

    expect(personNamesIn(" : 박아름다운별")).toEqual(["박아름다운별"]);
    expect(readBizRegistration(registration("대표자 박아름다운별")).personNames).toEqual(["박아름다운별"]);
    const doc = await readDocuments(
      [{ name: "사업자등록증.txt", bytes: txtOf(registration("대표자 박아름다운별")) }, PHOTO],
      photoAi("소프트웨어 개발 박아름다운별"),
    );
    expect(doc.fields.industry).toBe("서비스업 / 도소매");
    expectNoName(doc, "박아름다운별");
  });

  it("서류 라벨 이름 규칙은 그대로다 — 영문·직함·너무 긴 글은 이름으로 모으지 않는다", () => {
    expect(cleanPersonNames(["AB", "대표자", "여섯글자이름이다"])).toEqual([]);
    expect(personNamesIn("대표이사")).toEqual([]);
  });
});

/* ───────── 3. 파일 이름 ───────── */

describe("BF5-3 파일 이름 속 이름도 「○○○」로 바꾼다", () => {
  it("sources·conflicts·files 의 파일 이름에 이름이 없고, 이름 말고는 그대로 남는다", async () => {
    const result = await readDocuments(
      [{ name: "김지원_사업자등록증.txt", bytes: txtOf(registration("대표자 김지원")) }, PHOTO],
      photoAi("소프트웨어 개발"),
    );
    expectNoName(result, "김지원");
    expect(result.files.map((f) => f.name)).toEqual(["○○○_사업자등록증.txt", "사진.png"]);
    expect(result.sources.industry?.files).toEqual(["○○○_사업자등록증.txt"]);
    const files = result.conflicts[0].options.flatMap((o) => o.files).sort();
    expect(files).toEqual(["○○○_사업자등록증.txt", "사진.png"]);
  });

  it("AI 가 알려 준 영문 이름이 든 파일 이름도 바꾼다", async () => {
    const result = await readDocuments([{ name: "JOHN SMITH 명함.png", bytes: HEAD.png }], photoAi("제조업", ["John Smith"]));
    expect(result.files[0].name).toBe("○○○ 명함.png");
    expect(result.sources.industry?.files).toEqual(["○○○ 명함.png"]);
    expectNoName(result, "John Smith");
  });
});

/* ───────── 4. 자르기 순서 ───────── */

describe("BF5-4 이름을 지운 뒤에 40자로 자른다", () => {
  const LONG = "소프트웨어 개발 및 공급, 정보통신기기 도소매, 시스템 설계와 운영"; // 37자

  it("표본이 37자인지 확인", () => {
    expect(Array.from(LONG).length).toBe(37);
  });

  it("AI 가 알려 준 이름: 끝에 「김지」·「김」 조각이 남지 않는다", async () => {
    const result = await readDocuments([PHOTO], photoAi(`${LONG} 김지원`, ["김지원"]));
    expect(result.fields.industry).toBe(LONG);
    expectNoName(result, "김지", "김지원");
    expect(JSON.stringify(result.fields)).not.toContain("김");
  });

  it("같은 묶음 다른 등록증에서 이름을 얻는 경로도 같다", async () => {
    const result = await readDocuments(
      [{ name: "사업자등록증.txt", bytes: txtOf(registration("대표자 김지원")) }, PHOTO],
      photoAi(`${LONG} 김지원`),
    );
    expect(JSON.stringify(result)).not.toContain("김");
    expect(result.conflicts[0].options.map((o) => o.value)).toContain(LONG);
  });

  it("등록증 종목 끝의 이름도 40자 자르기보다 먼저 지워진다", async () => {
    const text = ["사업자등록증", "대표자 김지원", `업태 서비스업 종목 ${LONG} 김지원`].join("\n");
    const result = await readDocuments([{ name: "사업자등록증.txt", bytes: txtOf(text) }]);
    // 「서비스업 / 」7자 + 종목 앞 33자 = 40자. 끝에 이름 조각이 없다.
    expect(result.fields.industry).toBe("서비스업 / 소프트웨어 개발 및 공급, 정보통신기기 도소매, 시스템 설계");
    expect(JSON.stringify(result)).not.toContain("김");
  });

  it("이름을 지우면 같아지는 값은 충돌로 남기지 않고 한 값으로 합친다", async () => {
    const result = await readDocuments(
      [
        { name: "사업자등록증.txt", bytes: txtOf(["사업자등록증", "대표자 김지원", "업태 서비스업 종목 도소매"].join("\n")) },
        PHOTO,
      ],
      photoAi("서비스업 / 도소매 김지원"),
    );
    expect(result.fields.industry).toBe("서비스업 / 도소매");
    expect(result.conflicts).toEqual([]);
    expect(result.sources.industry?.files).toEqual(["사업자등록증.txt", "사진.png"]);
    expectNoName(result, "김지원");
  });
});

/* ───────── 5. XML 표기 ───────── */

describe("BF5-5 lastValuedRowOf — 속성 공백·값 태그/행 태그 접두사가 서로 달라도 읽는다", () => {
  it("행 번호 속성의 등호 앞뒤 공백(작은·큰따옴표)", () => {
    expect(lastValuedRowOf(`<sheetData><row r = '3000'><c r="A3000"><v>1</v></c></row></sheetData>`)).toBe(3000);
    expect(lastValuedRowOf(`<sheetData><row r = "3000"><c r="A3000"><v>1</v></c></row></sheetData>`)).toBe(3000);
    expect(lastValuedRowOf(`<sheetData><row r\t=\n'3000'><c r='A3000'><v>1</v></c></row></sheetData>`)).toBe(3000);
  });

  it("값 태그 접두사만 다르다 / 행 태그 접두사만 다르다", () => {
    expect(lastValuedRowOf(`<sheetData><row r="3000"><c r="A3000"><x:v>1</x:v></c></row></sheetData>`)).toBe(3000);
    expect(lastValuedRowOf(`<sheetData><row r="3000"><c r="A3000"><x:is><x:t>가</x:t></x:is></c></row></sheetData>`)).toBe(3000);
    expect(lastValuedRowOf(`<sheetData><s:row r="3000"><c r="A3000"><v>1</v></c></s:row></sheetData>`)).toBe(3000);
  });

  it("닫는 태그 접두사가 달라도 줄 끝을 찾는다 — 다음 줄을 앞 줄 속으로 잘못 넣지 않는다", () => {
    expect(
      lastValuedRowOf(`<sheetData><s:row r="5"><c r="A5"/></row><row r="6"><c r="A6"><v>1</v></c></row></sheetData>`),
    ).toBe(6);
    expect(
      lastValuedRowOf(`<sheetData><row r="5"><c r="A5"><v>1</v></c></x:row><row r="6"><c r="A6"/></row></sheetData>`),
    ).toBe(5);
  });

  it("서식만 있는 줄·이름만 비슷한 태그는 여전히 값으로 세지 않는다", () => {
    expect(lastValuedRowOf(`<sheetData><row r = '3000'><c r='A3000'/><x:v/></row></sheetData>`)).toBe(0);
    expect(lastValuedRowOf(`<sheetData><row r="2"><c r="A2"><vertAlign>1</vertAlign></c></row></sheetData>`)).toBe(0);
  });

  it("역추적이 길어지지 않는다 — 큰 입력도 빨리 끝난다", () => {
    const filler = "<s:row r = '1'><x:c r='A1'/></row>".repeat(20_000);
    const started = Date.now();
    lastValuedRowOf(filler);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  /** 머리글 + 2행, 그리고 3,000행에 직원이 한 명씩 있는 명부 */
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

  const SHEET_PATH = "xl/worksheets/sheet1.xml";
  const withNamespace = (xml: string, prefix: string): string => {
    const uri = /<worksheet[^>]*\sxmlns="([^"]+)"/.exec(xml)?.[1];
    if (!uri) throw new Error("표본 시트의 이름공간을 찾지 못했다");
    return xml.replace(/<worksheet\b/, `<worksheet xmlns:${prefix}="${uri}"`);
  };

  const NOTATIONS: Record<string, (xml: string) => string> = {
    큰따옴표: (xml) => xml,
    "작은따옴표·등호 공백": (xml) =>
      xml.replace(/<row\b([^>]*)>/g, (_m, attrs: string) => `<row${attrs.replace(/\br="(\d+)"/, "r = '$1'")}>`),
    "값 태그 접두사만 다름": (xml) => withNamespace(xml, "x").replace(/<(\/?)(v|is)\b/g, "<$1x:$2"),
    "행 태그 접두사만 다름": (xml) => withNamespace(xml, "s").replace(/<(\/?)row\b/g, "<$1s:row"),
  };

  it("네 표기 모두 3,000행 직원이 있는 명부는 직원 수를 확정하지 않는다", async () => {
    for (const [label, patch] of Object.entries(NOTATIONS)) {
      const base = rosterWithFarRow(3000);
      expect(lastValuedRowOf(patch(new AdmZip(base).readAsText(SHEET_PATH))), label).toBe(3000);
      const zip = new AdmZip(base);
      zip.updateFile(SHEET_PATH, Buffer.from(patch(zip.readAsText(SHEET_PATH)), "utf-8"));
      const result = await readDocuments([{ name: "고용보험 가입자명부.xlsx", bytes: zip.toBuffer() }]);
      expect(result.fields.employeeCount, label).toBeUndefined();
    }
  });
});

/* ───────── 6. 맨 앞 「경기」 ───────── */

describe("BF5-6 시도 이름은 접미어가 붙었거나 바로 뒤 낱말이 시·군·구로 끝날 때만 주소다", () => {
  it("업종 낱말은 맨 앞에 와도 그대로 둔다", () => {
    for (const ok of ["경기 운영업", "스포츠 경기 운영업", "농업 / 양봉", "제조업 / 원단"]) {
      expect(cleanIndustryText(ok)).toBe(ok);
    }
  });

  it("주소는 자른다", () => {
    expect(cleanIndustryText("경기 화성시")).toBeNull();
    expect(cleanIndustryText("경기 화성시 동탄대로 12")).toBeNull();
    expect(cleanIndustryText("서울 강남구 역삼동 123")).toBeNull();
    expect(cleanIndustryText("서비스업 경기 화성시")).toBe("서비스업");
    expect(cleanIndustryText("서비스업 서울 강남구 역삼동 123")).toBe("서비스업");
  });

  it("등록증 전체 경로에서도 「경기 운영업」이 남는다", async () => {
    const text = ["사업자등록증", "대표자 김지원", "업태 서비스업 종목 경기 운영업"].join("\n");
    const result = await readDocuments([{ name: "사업자등록증.txt", bytes: txtOf(text) }]);
    expect(result.fields.industry).toBe("서비스업 / 경기 운영업");
  });
});

/* ───────── 묶음: 결과 JSON 전체에 이름이 없다 ───────── */

describe("BF5 묶음 — 결과 JSON 전체에 알려진 이름이 한 번도 나오지 않는다", () => {
  it("등록증(라벨 다음 줄·파일 이름)·사진 둘(영문 이름·한글 이름) 섞어서", async () => {
    let n = 0;
    const LONG = "소프트웨어 개발 및 공급, 정보통신기기 도소매, 시스템 설계와 운영";
    const result = await readDocuments(
      [
        { name: "김지원_사업자등록증.txt", bytes: txtOf(registration("대표자 :\n김지원", "성명\n:\n박아름다운별")) },
        { name: "JOHN SMITH 명함.png", bytes: HEAD.png },
        { name: "박아름다운별 사진.png", bytes: HEAD.png },
      ],
      {
        aiReader: async () =>
          ++n === 1
            ? { industry: `${LONG} JOHN SMITH`, personNames: ["JOHN SMITH"] }
            : { industry: `${LONG} 박아름다운별 김지원` },
      },
    );
    const names = ["김지원", "박아름다운별", "JOHN SMITH"];
    expectNoName(result, ...names);
    expectNoName(result.fields, "김지", "John");
    for (const option of result.conflicts.flatMap((c) => c.options)) {
      expect(typeof option.value === "string" ? option.value : "").not.toMatch(/김|박아름|john/i);
    }
    expect(result.files.map((f) => f.name)).toEqual(["○○○_사업자등록증.txt", "○○○ 명함.png", "○○○ 사진.png"]);
    expect(result.fields.industry).toBe("서비스업 / 도소매"); // 등록증 값이 추천
    expect(result.conflicts[0].options.map((o) => o.value)).toContain(LONG);
  });
});
