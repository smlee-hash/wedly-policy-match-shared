import { describe, expect, it } from "vitest";
import { mergeDocumentFields, type MergeInput } from "./merge";

const reg = (fields: MergeInput["fields"], name = "사업자등록증.pdf"): MergeInput => ({
  name,
  docType: "biz-registration",
  fields,
});
const fin = (fields: MergeInput["fields"], year: number, name = "재무제표.pdf"): MergeInput => ({
  name,
  docType: "financial-statement",
  fields,
  year,
});
const vat = (fields: MergeInput["fields"], year: number, name = "부가세.pdf"): MergeInput => ({
  name,
  docType: "vat-return",
  fields,
  year,
});
const emp = (fields: MergeInput["fields"], name = "고용보험.xlsx"): MergeInput => ({
  name,
  docType: "employment-insurance",
  fields,
});
const status = (fields: MergeInput["fields"], name = "기업상태표.xlsx"): MergeInput => ({
  name,
  docType: "company-status",
  fields,
});

describe("mergeDocumentFields — 같은 값", () => {
  it("값 하나로 합치고 출처(파일 이름·종류)를 모두 적는다", () => {
    const out = mergeDocumentFields([
      reg({ foundedDate: "2018-03-12", region: "경기" }),
      status({ foundedDate: "2018-03-12", employeeCount: 7 }),
    ]);
    expect(out.fields).toEqual({ foundedDate: "2018-03-12", region: "경기", employeeCount: 7 });
    expect(out.conflicts).toEqual([]);
    expect(out.sources.foundedDate).toEqual({
      files: ["사업자등록증.pdf", "기업상태표.xlsx"],
      docTypes: ["biz-registration", "company-status"],
    });
    expect(out.sources.region).toEqual({ files: ["사업자등록증.pdf"], docTypes: ["biz-registration"] });
  });

  it("같은 파일 이름이 두 번 나와도 출처는 한 번만 적는다", () => {
    const out = mergeDocumentFields([reg({ region: "경기" }), reg({ region: "경기" })]);
    expect(out.sources.region?.files).toEqual(["사업자등록증.pdf"]);
  });

  it("인증 종류는 순서가 달라도 같은 값으로 본다", () => {
    const out = mergeDocumentFields([
      status({ certTypes: ["벤처", "ISO"] }),
      reg({ certTypes: ["ISO", "벤처"] }, "다른표.xlsx"),
    ]);
    expect(out.conflicts).toEqual([]);
    expect(out.sources.certTypes?.files).toHaveLength(2);
  });

  it("업종 글은 공백 차이만 있으면 같은 값으로 본다", () => {
    const out = mergeDocumentFields([reg({ industry: "제조업 / 전자부품" }), status({ industry: "제조업  /  전자부품" })]);
    expect(out.conflicts).toEqual([]);
  });
});

describe("mergeDocumentFields — 다른 값", () => {
  it("conflicts 에 값마다 한 줄을 적고 recommended 를 정한다", () => {
    const out = mergeDocumentFields([
      fin({ lastYearRevenueKrw: 1_234_567_000 }, 2025),
      vat({ lastYearRevenueKrw: 450_000_000 }, 2024),
    ]);
    expect(out.conflicts).toEqual([
      {
        field: "lastYearRevenueKrw",
        options: [
          { value: 1_234_567_000, files: ["재무제표.pdf"], docTypes: ["financial-statement"], year: 2025 },
          { value: 450_000_000, files: ["부가세.pdf"], docTypes: ["vat-return"], year: 2024 },
        ],
        recommended: 0,
      },
    ]);
    expect(out.fields.lastYearRevenueKrw).toBe(1_234_567_000);
  });

  it("충돌한 칸의 sources 는 추천한 값을 준 서류만 적는다", () => {
    const out = mergeDocumentFields([
      fin({ lastYearRevenueKrw: 1_000 }, 2023),
      vat({ lastYearRevenueKrw: 2_000 }, 2025),
    ]);
    expect(out.fields.lastYearRevenueKrw).toBe(2_000);
    expect(out.sources.lastYearRevenueKrw).toEqual({ files: ["부가세.pdf"], docTypes: ["vat-return"] });
    expect(out.conflicts[0].recommended).toBe(1);
  });

  it("같은 값을 준 서류가 여럿이면 한 줄로 묶는다", () => {
    const out = mergeDocumentFields([
      reg({ region: "경기" }),
      status({ region: "서울" }),
      emp({ region: "경기" }),
    ]);
    expect(out.conflicts).toHaveLength(1);
    const [c] = out.conflicts;
    expect(c.options).toHaveLength(2);
    expect(c.options[0]).toEqual({
      value: "경기",
      files: ["사업자등록증.pdf", "고용보험.xlsx"],
      docTypes: ["biz-registration", "employment-insurance"],
    });
  });

  it("충돌하지 않는 칸은 그대로 값으로 남는다", () => {
    const out = mergeDocumentFields([reg({ region: "경기", foundedDate: "2018-03-12" }), status({ region: "서울" })]);
    expect(out.fields.foundedDate).toBe("2018-03-12");
    expect(out.conflicts.map((c) => c.field)).toEqual(["region"]);
  });
});

describe("mergeDocumentFields — 추천 규칙", () => {
  it("연도가 가장 최근인 값을 추천한다(서류 우선순위보다 앞)", () => {
    const out = mergeDocumentFields([
      status({ lastYearRevenueKrw: 100 }),
      fin({ lastYearRevenueKrw: 300 }, 2023),
      vat({ lastYearRevenueKrw: 200 }, 2024),
    ]);
    expect(out.fields.lastYearRevenueKrw).toBe(200);
  });

  it("연도가 있는 값이 연도 없는 값보다 앞선다", () => {
    const out = mergeDocumentFields([status({ lastYearRevenueKrw: 100 }), fin({ lastYearRevenueKrw: 300 }, 2022)]);
    expect(out.fields.lastYearRevenueKrw).toBe(300);
  });

  it("연도가 같으면 서류 우선순위: 사업자등록증 > 재무제표 > 고용보험 > 기업상태표", () => {
    const pick = (inputs: MergeInput[], field: "employeeCount" | "region" | "lastYearRevenueKrw") =>
      mergeDocumentFields(inputs).fields[field];
    expect(pick([status({ region: "서울" }), reg({ region: "경기" })], "region")).toBe("경기");
    expect(pick([status({ employeeCount: 5 }), emp({ employeeCount: 7 })], "employeeCount")).toBe(7);
    expect(
      pick([vat({ lastYearRevenueKrw: 1 }, 2025), fin({ lastYearRevenueKrw: 2 }, 2025)], "lastYearRevenueKrw"),
    ).toBe(1); // 재무제표·부가세는 같은 순위 — 먼저 올린 쪽
  });

  it("연도가 둘 다 없으면 서류 우선순위로 정한다", () => {
    const out = mergeDocumentFields([
      status({ foundedDate: "2018-01-01" }),
      reg({ foundedDate: "2018-03-12" }),
    ]);
    expect(out.fields.foundedDate).toBe("2018-03-12");
    expect(out.conflicts[0].recommended).toBe(1);
  });

  it("같은 값 묶음의 연도는 그 묶음에서 가장 최근 해로 본다", () => {
    const out = mergeDocumentFields([
      fin({ lastYearRevenueKrw: 500 }, 2022),
      vat({ lastYearRevenueKrw: 500 }, 2025),
      fin({ lastYearRevenueKrw: 900 }, 2024, "재무제표2.pdf"),
    ]);
    expect(out.fields.lastYearRevenueKrw).toBe(500);
    expect(out.conflicts[0].options[0].year).toBe(2025);
  });
});

describe("mergeDocumentFields — 빈 값·입력 보존", () => {
  it("입력이 없으면 빈 결과", () => {
    expect(mergeDocumentFields([])).toEqual({ fields: {}, sources: {}, conflicts: [] });
  });

  it("undefined·빈 배열 칸은 건너뛴다", () => {
    const out = mergeDocumentFields([reg({ region: undefined, certTypes: [] })]);
    expect(out.fields).toEqual({});
    expect(out.sources).toEqual({});
  });

  it("false·0 도 값이다", () => {
    const out = mergeDocumentFields([status({ taxDelinquent: false, patentCount: 0, employeeCount: 0 })]);
    expect(out.fields).toEqual({ taxDelinquent: false, patentCount: 0, employeeCount: 0 });
  });

  it("입력 객체를 바꾸지 않는다", () => {
    const inputs = [status({ certTypes: ["벤처"] }), reg({ certTypes: ["벤처"] })];
    const before = JSON.stringify(inputs);
    const out = mergeDocumentFields(inputs);
    out.fields.certTypes?.push("기타");
    expect(JSON.stringify(inputs)).toBe(before);
  });
});
