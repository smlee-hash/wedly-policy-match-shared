// 재리뷰(Astra 5차) BF6 — ZIP 로컬 헤더 크기·파일 이름 자르기 순서·명부 직원 이름·workbook.xml 표기·글 명부 잘림·
// 머리글 없는 단위·괄호 음수. ★표본은 전부 지어낸 값(김지원 …)이다. 실제 회사 정보는 쓰지 않는다.

import AdmZip from "adm-zip";
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { isSheetTruncated, lastValuedRows } from "./extract-text";
import { readDocuments } from "./index";
import { parseEmployment, parseEmploymentWithNames } from "./parse-employment";
import { preflightSpreadsheetZip } from "./spreadsheet-zip-guard";
import { EMPLOYMENT_ROWS, HEAD, txtOf, xlsxTableOf } from "./__fixtures__/samples";

/** 결과 어디에도 있으면 안 되는 이름이 JSON 에 없는지 본다(공백·대소문자 차이도 같은 이름으로 본다). */
function expectNoName(result: unknown, ...names: string[]): void {
  const json = JSON.stringify(result).replace(/\s+/g, "").toLowerCase();
  for (const name of names) expect(json).not.toContain(name.replace(/\s+/g, "").toLowerCase());
}

const MIB = 1024 * 1024;

/* ───────── 1. ZIP 로컬 파일 헤더 크기 ───────── */

describe("BF6-1 ZIP 사전 검사는 로컬 파일 헤더의 크기도 본다", () => {
  const SHEET = "xl/workbook.xml";
  const roster = () => xlsxTableOf("고용현황", EMPLOYMENT_ROWS);
  const localOffsetOf = (buf: Buffer, entryName: string): number => {
    const entry = new AdmZip(buf).getEntry(entryName);
    if (!entry) throw new Error("표본에 그 칸이 없다");
    return entry.header.offset;
  };
  /** 로컬 헤더의 한 자리만 바꾼 사본 */
  const patched = (buf: Buffer, edit: (copy: Buffer, at: number) => void): Buffer => {
    const copy = Buffer.from(buf);
    edit(copy, localOffsetOf(buf, SHEET));
    return copy;
  };

  it("표본이 작은 정상 XLSX 이고, 그대로면 통과해 읽힌다", async () => {
    const buf = roster();
    expect(buf.length).toBeLessThan(64 * 1024);
    expect(preflightSpreadsheetZip(buf)).toEqual({ ok: true });
    const result = await readDocuments([{ name: "고용보험 가입자명부.xlsx", bytes: buf }]);
    expect(result.files[0].status).toBe("read");
    expect(result.fields.employeeCount).toBe(3);
  });

  it("로컬 비압축 크기만 48MiB 로 바꾸면 중앙 디렉터리가 멀쩡해도 읽기 전에 거절한다", async () => {
    const bad = patched(roster(), (copy, at) => copy.writeUInt32LE(48 * MIB, at + 22));
    const verdict = preflightSpreadsheetZip(bad);
    expect(verdict.ok).toBe(false);
    const result = await readDocuments([{ name: "고용보험 가입자명부.xlsx", bytes: bad }]);
    expect(result.files[0].status).toBe("unsupported");
    expect(result.files[0].message).toContain("너무 큽니다");
    expect(result.fields.employeeCount).toBeUndefined();
  });

  it("로컬 압축 크기가 상한을 넘어도 거절한다", () => {
    const bad = patched(roster(), (copy, at) => copy.writeUInt32LE(48 * MIB, at + 18));
    expect(preflightSpreadsheetZip(bad).ok).toBe(false);
  });

  it("로컬 크기가 상한 안이어도 중앙 값과 다르면 거절한다", () => {
    const bad = patched(roster(), (copy, at) => copy.writeUInt32LE(copy.readUInt32LE(at + 22) + 1, at + 22));
    expect(preflightSpreadsheetZip(bad).ok).toBe(false);
    const badCompressed = patched(roster(), (copy, at) => copy.writeUInt32LE(copy.readUInt32LE(at + 18) + 1, at + 18));
    expect(preflightSpreadsheetZip(badCompressed).ok).toBe(false);
  });

  it("로컬 이름 길이가 중앙과 다르거나 로컬 서명이 깨졌으면 거절한다", () => {
    const badName = patched(roster(), (copy, at) => copy.writeUInt16LE(copy.readUInt16LE(at + 26) + 1, at + 26));
    expect(preflightSpreadsheetZip(badName).ok).toBe(false);
    const badSig = patched(roster(), (copy, at) => copy.writeUInt32LE(0, at));
    expect(preflightSpreadsheetZip(badSig).ok).toBe(false);
  });

  it("데이터 기술자 표시(비트 3)가 켜지고 로컬 크기가 0 이면 중앙 값을 쓴다", () => {
    const deferred = patched(roster(), (copy, at) => {
      copy.writeUInt16LE(copy.readUInt16LE(at + 6) | 0x8, at + 6);
      copy.writeUInt32LE(0, at + 18);
      copy.writeUInt32LE(0, at + 22);
    });
    expect(preflightSpreadsheetZip(deferred)).toEqual({ ok: true });
  });

  it("데이터 기술자 표시가 있어도 로컬 크기가 0 이 아니면 상한과 중앙 값을 그대로 따진다", () => {
    const bad = patched(roster(), (copy, at) => {
      copy.writeUInt16LE(copy.readUInt16LE(at + 6) | 0x8, at + 6);
      copy.writeUInt32LE(48 * MIB, at + 22);
    });
    expect(preflightSpreadsheetZip(bad).ok).toBe(false);
  });

  it("중앙 크기가 상한을 넘으면 거절한다(기존 동작 그대로)", () => {
    const tight = { maxParts: 1000, maxTotalBytes: 40 * MIB, maxEntryBytes: 10 };
    expect(preflightSpreadsheetZip(roster(), tight).ok).toBe(false);
  });
});

/* ───────── 2. 파일 이름은 이름을 가린 뒤에 자른다 ───────── */

describe("BF6-2 파일 이름 100자 자르기는 이름 가리기 뒤에 한다", () => {
  it("98자 뒤에 「김지원」이 오면 가린 뒤 잘라 「김지」 조각이 남지 않는다", async () => {
    const name = `${"a".repeat(98)}김지원_사업자등록증.txt`;
    const text = ["사업자등록증", "대표자 김지원", "업태 서비스업 종목 도소매"].join("\n");
    const result = await readDocuments([{ name, bytes: txtOf(text) }]);
    expect(result.files[0].status).toBe("read");
    expectNoName(result, "김지", "김지원");
    expect(result.files[0].name).toBe(`${"a".repeat(98)}○○`);
    expect(Array.from(result.files[0].name).length).toBe(100);
    expect(result.sources.industry?.files).toEqual([`${"a".repeat(98)}○○`]);
  });

  it("이름이 없는 긴 파일 이름은 그대로 100자에서 자른다", async () => {
    const name = `${"b".repeat(150)}.txt`;
    const result = await readDocuments([{ name, bytes: txtOf("아무 글") }]);
    expect(Array.from(result.files[0].name).length).toBe(100);
  });
});

/* ───────── 3. 명부 직원 이름 ───────── */

describe("BF6-3 명부의 근로자 이름도 지우기 목록에 들어간다", () => {
  const csv = ["근로자 이름,근로자 주민번호,고용상태,취득일", "김지원,900101-1111111,고용,2022-01-03"].join("\n");

  it("명부 이름이 사진 업종 글에 있어도 결과 어디에도 남지 않고, 직원 수는 그대로다", async () => {
    const result = await readDocuments(
      [
        { name: "김지원_고용보험.csv", bytes: txtOf(csv) },
        { name: "사진.png", bytes: HEAD.png },
      ],
      { aiReader: async () => ({ industry: "소프트웨어 개발 김지원" }) },
    );
    expect(result.fields.employeeCount).toBe(1);
    expect(result.fields.industry).toBe("소프트웨어 개발");
    expectNoName(result, "김지원");
  });

  it("parseEmployment 의 이름 목록은 읽은 이름만 담고 칸 결과에는 이름이 없다", () => {
    const read = parseEmploymentWithNames({ text: csv, csv: true });
    expect(read.personNames).toEqual(["김지원"]);
    expect(read.parsed.fields).toEqual({ employeeCount: 1 });
    expect(parseEmployment({ text: csv, csv: true })).toEqual({ fields: { employeeCount: 1 } });
  });
});

/* ───────── 4. workbook.xml 표기 ───────── */

describe("BF6-4 workbook.xml 의 등호 공백·작은따옴표·접두사 태그도 읽는다", () => {
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

  const BOOK = "xl/workbook.xml";
  const SHEET_TAG = /<(?:\w+:)?sheet\b[^>]*>/g; // 「<sheets>」는 잡지 않는다
  const spaced = (xml: string) => xml.replace(SHEET_TAG, (tag) => tag.replace(/([\w:]+)="/g, '$1 = "'));
  const singleQuoted = (xml: string) => xml.replace(SHEET_TAG, (tag) => tag.replace(/"([^"]*)"/g, "'$1'"));
  const prefixed = (xml: string) => {
    const uri = /<workbook[^>]*\sxmlns="([^"]+)"/.exec(xml)?.[1];
    if (!uri) throw new Error("표본 통합 문서의 이름공간을 찾지 못했다");
    return xml.replace(/<workbook\b/, `<workbook xmlns:s="${uri}"`).replace(/<(\/?)(sheets|sheet)\b/g, "<$1s:$2");
  };
  const NOTATIONS: Record<string, (xml: string) => string> = {
    "등호 앞뒤 공백": spaced,
    작은따옴표: singleQuoted,
    "접두사 태그": prefixed,
    "접두사 태그 + 작은따옴표 + 등호 공백": (xml) => spaced(singleQuoted(prefixed(xml))),
  };

  function withBook(buf: Buffer, patch: (xml: string) => string): Buffer {
    const zip = new AdmZip(buf);
    zip.updateFile(BOOK, Buffer.from(patch(zip.readAsText(BOOK)), "utf-8"));
    return zip.toBuffer();
  }

  it("바꾼 표기마다 시트의 마지막 값 줄(3000)을 찾는다", () => {
    const base = rosterWithFarRow(3000);
    expect(lastValuedRows(base).get("고용현황")).toBe(3000);
    for (const [label, patch] of Object.entries(NOTATIONS)) {
      expect(lastValuedRows(withBook(base, patch)).get("고용현황"), label).toBe(3000);
    }
  });

  it("바꾼 표기여도 3,000행 직원이 있는 명부는 직원 수를 확정하지 않는다", async () => {
    const base = rosterWithFarRow(3000);
    for (const [label, patch] of Object.entries(NOTATIONS)) {
      const result = await readDocuments([{ name: "고용보험 가입자명부.xlsx", bytes: withBook(base, patch) }]);
      expect(result.fields.employeeCount, label).toBeUndefined();
    }
  });

  it("행이 2개뿐인 명부는 바꾼 표기여도 그대로 센다", async () => {
    const base = rosterWithFarRow(3); // 3번째 줄까지 — 상한 안
    for (const [label, patch] of Object.entries(NOTATIONS)) {
      if (label.includes("접두사")) continue; // 접두사 태그를 엑셀 읽기 도구가 읽는지는 이 시험이 따지지 않는다
      const result = await readDocuments([{ name: "고용보험 가입자명부.xlsx", bytes: withBook(base, patch) }]);
      expect(result.fields.employeeCount, label).toBe(2);
    }
  });

  it("마지막 값 줄을 못 구한 시트는 읽은 범위가 잘렸다는 표시가 있으면 잘린 것으로 본다", () => {
    expect(isSheetTruncated(undefined, true)).toBe(true);
    expect(isSheetTruncated(undefined, false)).toBe(false); // 읽은 결과로 상한보다 작다고 확실하다
    expect(isSheetTruncated(0, false)).toBe(false);
    expect(isSheetTruncated(2000, false)).toBe(false);
    expect(isSheetTruncated(2001, false)).toBe(true);
    expect(isSheetTruncated(-1, false)).toBe(true);
  });
});

/* ───────── 5. 글 명부가 글자 상한으로 잘렸으면 직원 수를 확정하지 않는다 ───────── */

describe("BF6-5 글자 상한(20만 자)으로 잘린 글 명부", () => {
  /** 줄마다 정확히 50자(줄바꿈 포함) — 20만 자 절단점이 줄 끝에 맞는다. */
  const LINE = 50;
  const line = (cells: string[]): string => `${cells.join(",").padEnd(LINE - 1)}\n`;
  const header = line(["근로자 이름", "근로자 주민번호", "고용상태", "취득일"]);
  const rows = (count: number): string =>
    Array.from({ length: count }, (_, i) =>
      line([`가상직원${String(i + 1).padStart(4, "0")}`, "900101-1111111", "고용", "2022-01-03"]),
    ).join("");

  it("표본: 6,000명·30만 자이고 20만 자 절단점이 줄 끝이다", () => {
    const text = header + rows(6000);
    expect(text.length).toBeGreaterThan(300_000);
    expect(200_000 % LINE).toBe(0);
  });

  it("6,000명 CSV 는 직원 수 없이 잘림 안내만 한다", async () => {
    const result = await readDocuments([{ name: "고용보험_가입자명부.csv", bytes: txtOf(header + rows(6000)) }]);
    expect(result.fields.employeeCount).toBeUndefined();
    expect(result.files[0].status).toBe("no-fields");
    expect(result.files[0].message).toContain("너무 길어");
  });

  it("TXT 도 같고, 상한 안의 명부는 그대로 센다", async () => {
    const long = await readDocuments([{ name: "고용보험_가입자명부.txt", bytes: txtOf(header + rows(6000)) }]);
    expect(long.fields.employeeCount).toBeUndefined();
    const short = await readDocuments([{ name: "고용보험_가입자명부.csv", bytes: txtOf(header + rows(30)) }]);
    expect(short.fields.employeeCount).toBe(30);
  });
});

/* ───────── 6. 머리글 없는 경로의 단위 ───────── */

describe("BF6-6 머리글 없는 매출 줄도 금액 바로 뒤 단위를 환산한다", () => {
  const revenueOf = async (name: string, text: string) =>
    (await readDocuments([{ name, bytes: txtOf(text) }])).fields.lastYearRevenueKrw;

  it("TXT: 「매출액 1,000천원」 → 1,000,000", async () => {
    expect(await revenueOf("재무제표.txt", "손익계산서\n사업연도 2025\n매출액 1,000천원")).toBe(1_000_000);
  });

  it("CSV: 따옴표 칸 「1,000천원」 → 1,000,000", async () => {
    expect(await revenueOf("재무제표.csv", '손익계산서\n사업연도 2025\n매출액,"1,000천원"')).toBe(1_000_000);
  });

  it("「매출액 5,000,000원」 → 5,000,000, 백만원 → 곱한다", async () => {
    expect(await revenueOf("재무제표.txt", "손익계산서\n사업연도 2025\n매출액 5,000,000원")).toBe(5_000_000);
    expect(await revenueOf("재무제표.txt", "손익계산서\n사업연도 2025\n매출액 3백만원")).toBe(3_000_000);
    expect(await revenueOf("재무제표.txt", "손익계산서\n사업연도 2025\n매출액 12 백만원")).toBe(12_000_000);
  });

  it("숫자 뒤에 이어 붙은 낱말(「원가」)은 단위로 보지 않는다", async () => {
    expect(await revenueOf("재무제표.txt", "손익계산서\n(단위: 천원)\n매출액 1,000 원가 900")).toBe(1_000_000);
  });

  it("값 바로 뒤 단위는 본문의 「(단위: 천원)」보다 앞선다", async () => {
    expect(await revenueOf("재무제표.txt", "손익계산서\n(단위: 천원)\n매출액 5,000원")).toBe(5_000);
    expect(await revenueOf("재무제표.txt", "손익계산서\n(단위: 천원)\n매출액 5,000")).toBe(5_000_000);
  });
});

/* ───────── 7. 괄호 음수 ───────── */

describe("BF6-7 괄호 안이 숫자뿐이면 음수 금액이라 그 줄의 매출을 확정하지 않는다", () => {
  const revenueOf = async (text: string) =>
    (await readDocuments([{ name: "재무제표.txt", bytes: txtOf(text) }])).fields.lastYearRevenueKrw;

  it("「매출액 (1,234) 900」 → 매출 없음", async () => {
    expect(await revenueOf("손익계산서\n매출액 (1,234) 900")).toBeUndefined();
    expect(await revenueOf("손익계산서\n매출액 （1,234） 900")).toBeUndefined();
    expect(await revenueOf("손익계산서\n매출액(1,234) 900")).toBeUndefined();
  });

  it("숫자 아닌 괄호 설명은 건너뛴다 — 「매출액(주석 3) 1,000,000」 → 1,000,000", async () => {
    expect(await revenueOf("손익계산서\n매출액(주석 3) 1,000,000")).toBe(1_000_000);
    expect(await revenueOf("손익계산서\n매출액 (단위: 원) 2,000,000")).toBe(2_000_000);
  });
});
