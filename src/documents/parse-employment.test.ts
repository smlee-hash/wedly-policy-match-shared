import { describe, expect, it } from "vitest";
import { extractDocumentText } from "./extract-text";
import { parseEmployment } from "./parse-employment";
import { EMPLOYMENT_ROWS, xlsxTableOf } from "./__fixtures__/samples";

/** 결과 JSON 어디에도 있으면 안 되는 근로자 이름·주민번호 */
function expectNoPeople(result: unknown) {
  const json = JSON.stringify(result);
  expect(json).not.toMatch(/가상직원/);
  expect(json).not.toMatch(/\d{6}-?\d{7}/);
}

async function sheetsOf(fileName: string, rows: Array<Array<string | number>>, sheetName = "고용현황") {
  const extracted = await extractDocumentText(fileName, xlsxTableOf(sheetName, rows));
  if (extracted.kind !== "spreadsheet") throw new Error("엑셀로 읽혀야 한다");
  return extracted.sheets;
}

describe("parseEmployment — 가입자 명부(엑셀)", () => {
  it("고용 상태인 사람만 세고, 같은 사람(이름+주민번호)은 한 명으로 센다", async () => {
    const r = parseEmployment({ sheets: await sheetsOf("고용산재가입자명부.xlsx", EMPLOYMENT_ROWS) });
    expect(r.fields).toEqual({ employeeCount: 3 });
  });

  it("근로자 이름·주민번호는 결과 어디에도 없다", async () => {
    expectNoPeople(parseEmployment({ sheets: await sheetsOf("명부.xlsx", EMPLOYMENT_ROWS) }));
  });

  it("시트 이름이 「고용현황」이 아니어도 머리줄(고용상태 칸)로 찾는다", async () => {
    const r = parseEmployment({ sheets: await sheetsOf("명부.xlsx", EMPLOYMENT_ROWS, "Sheet1") });
    expect(r.fields.employeeCount).toBe(3);
  });

  it("머리줄 앞에 제목 줄이 있어도 읽는다", async () => {
    const rows = [["고용보험 가입자 명부"], ...EMPLOYMENT_ROWS];
    expect((parseEmployment({ sheets: await sheetsOf("명부.xlsx", rows) }).fields.employeeCount)).toBe(3);
  });

  it("머리줄만 있고 근로자 줄이 없으면 0명", async () => {
    const r = parseEmployment({ sheets: await sheetsOf("명부.xlsx", [EMPLOYMENT_ROWS[0]]) });
    expect(r.fields).toEqual({ employeeCount: 0 });
  });
});

describe("parseEmployment — 글 서류(쉼표 표)", () => {
  const section = [
    "고용산재보험 신고서",
    "## 고용현황",
    "근로자 이름,근로자 주민번호,고용상태,취득일",
    "가상직원일,900101-1111111,고용,2022-01-03",
    "가상직원이,910202-2222222,고용,2023-02-01",
    "가상직원사,930404-2444444,상실,2021-04-05",
  ].join("\n");

  it("「## 고용현황」 구역에서 센다", () => {
    const r = parseEmployment({ text: section });
    expect(r.fields).toEqual({ employeeCount: 2 });
    expectNoPeople(r);
  });

  it("구역 표시 없이 머리줄만 있는 csv 도 읽는다", () => {
    const text = section.split("\n").slice(2).join("\n");
    expect(parseEmployment({ text }).fields.employeeCount).toBe(2);
  });

  it("「상시근로자수 12명」처럼 사람 수만 적힌 신고서는 그 수를 쓴다", () => {
    expect(parseEmployment({ text: "고용산재보험 보험관계 성립신고서\n상시근로자수 : 12명" }).fields).toEqual({
      employeeCount: 12,
    });
  });
});

describe("parseEmployment — 믿을 수 없으면 세지 않는다", () => {
  it("고용상태 칸이 없으면 빈 결과 + 안내(사람 정보 없음)", () => {
    const text = "## 고용현황\n근로자 이름,근로자 주민번호\n가상직원일,900101-1111111";
    const r = parseEmployment({ text });
    expect(r.fields).toEqual({});
    expect(r.note).toBeTruthy();
    expectNoPeople(r);
  });

  it("마지막 줄의 칸 수가 머리줄과 다르면(잘린 흔적) 세지 않는다", () => {
    const text = [
      "## 고용현황",
      "근로자 이름,근로자 주민번호,고용상태",
      "가상직원일,900101-1111111,고용",
      "가상직원이,910202-2222222",
    ].join("\n");
    const r = parseEmployment({ text });
    expect(r.fields).toEqual({});
    expectNoPeople(r);
  });

  it("고용 중인 줄에 이름·주민번호가 모두 비면 세지 않는다", () => {
    const text = ["근로자 이름,근로자 주민번호,고용상태", ",,고용"].join("\n");
    expect(parseEmployment({ text }).fields).toEqual({});
  });

  it("글이 없어도 던지지 않는다", () => {
    expect(parseEmployment({}).fields).toEqual({});
  });
});
