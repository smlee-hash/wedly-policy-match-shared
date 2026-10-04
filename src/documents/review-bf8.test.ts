// 재리뷰(Astra 7차) BF8 — 중앙 디렉터리 크기 0 우회·겹치는 칸 경로·거짓 범위의 시작·그리스어 대소문자·매출 라벨 되풀이.
// ★표본은 전부 지어낸 값이다.

import AdmZip from "adm-zip";
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { extractDocumentText } from "./extract-text";
import { readDocuments } from "./index";
import { parseFinancial } from "./parse-financial";
import { preflightSpreadsheetZip } from "./spreadsheet-zip-guard";
import { EMPLOYMENT_ROWS, HEAD, txtOf, xlsxTableOf } from "./__fixtures__/samples";

const eocdOf = (buf: Buffer) => buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
const SHEET_XML = "xl/worksheets/sheet1.xml";

describe("BF8-1 끝 레코드의 디렉터리 크기를 줄여도 검사를 건너뛰지 못한다", () => {
  it("디렉터리 크기 0 은 항목 수와 맞지 않아 거절", () => {
    const buf = Buffer.from(xlsxTableOf("고용현황", EMPLOYMENT_ROWS));
    expect(preflightSpreadsheetZip(buf).ok).toBe(true);
    const bad = Buffer.from(buf);
    bad.writeUInt32LE(0, eocdOf(bad) + 12);
    expect(preflightSpreadsheetZip(bad).ok).toBe(false);
  });

  it("항목 하나만 걸리게 크기를 줄여도 거절", () => {
    const buf = Buffer.from(xlsxTableOf("고용현황", EMPLOYMENT_ROWS));
    const eocd = eocdOf(buf);
    const at = buf.readUInt32LE(eocd + 16);
    const first = 46 + buf.readUInt16LE(at + 28) + buf.readUInt16LE(at + 30) + buf.readUInt16LE(at + 32);
    const bad = Buffer.from(buf);
    bad.writeUInt32LE(first, eocd + 12);
    expect(preflightSpreadsheetZip(bad).ok).toBe(false);
  });
});

describe("BF8-2 정리하면 같은 경로가 되는 칸이 둘이면 그 시트는 잘림으로 본다", () => {
  function farRoster(): Buffer {
    const ws: XLSX.WorkSheet = {
      A1: { t: "s", v: "근로자 이름" },
      B1: { t: "s", v: "고용상태" },
      A2: { t: "s", v: "가상직원일" },
      B2: { t: "s", v: "고용" },
      A3000: { t: "s", v: "가상직원이" },
      B3000: { t: "s", v: "고용" },
      "!ref": "A1:B3000",
    };
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "고용현황");
    return Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer);
  }

  it("xl/./worksheets/sheet1.xml 에 짧은 시트를 끼워도 인원을 확정하지 않는다", async () => {
    const zip = new AdmZip(farRoster());
    const short = zip.readAsText(SHEET_XML).replace(/<row r="3000"[\s\S]*?<\/row>/, "");
    // adm-zip 은 칸 이름의 `./` 를 정리해 덮어쓰므로, 같은 길이의 다른 이름으로 넣은 뒤 이름 바이트만 바꾼다(검사값은 이름과 무관).
    zip.addFile("xl/Q/worksheets/sheet1.xml", Buffer.from(short, "utf-8"));
    const raw = zip.toBuffer();
    const from = Buffer.from("xl/Q/worksheets/sheet1.xml");
    const to = Buffer.from("xl/./worksheets/sheet1.xml");
    let replaced = 0;
    for (let at = raw.indexOf(from); at >= 0; at = raw.indexOf(from, at + 1)) {
      to.copy(raw, at);
      replaced++;
    }
    expect(replaced).toBe(2); // 로컬 헤더 + 중앙 디렉터리
    const bytes = raw;
    const r = await extractDocumentText("명부.xlsx", bytes);
    if (r.kind === "spreadsheet") for (const sheet of r.sheets) expect(sheet.truncated).toBe(true);
    const result = await readDocuments([{ name: "고용보험 가입자명부.xlsx", bytes }]);
    expect(result.fields.employeeCount).toBeUndefined();
  });
});

describe("BF8-3 거짓 범위의 시작이 실제 칸보다 뒤여도 넓혀 읽는다", () => {
  function rosterWithDimension(dimension: string): Buffer {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ["근로자 이름", "근로자 주민번호", "고용상태", "취득일"],
        ["가상직원일", "900101-1111111", "고용", "2022-01-03"],
        ["가상직원이", "910202-2222222", "고용", "2023-02-01"],
      ]),
      "고용현황",
    );
    const zip = new AdmZip(Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer));
    const patched = zip.readAsText(SHEET_XML).replace(/<dimension\s+ref="[^"]*"\s*\/>/, `<dimension ref="${dimension}"/>`);
    if (!patched.includes(`<dimension ref="${dimension}"/>`)) throw new Error("표본의 시트 범위를 바꾸지 못했다");
    zip.updateFile(SHEET_XML, Buffer.from(patched, "utf-8"));
    return zip.toBuffer();
  }

  for (const dimension of ["A1:D3", "A1:D2", "A2:D3", "B1:D3", "C3:D3"]) {
    it(`dimension ${dimension} → 2명`, async () => {
      const result = await readDocuments([{ name: "고용보험 가입자명부.xlsx", bytes: rosterWithDimension(dimension) }]);
      expect(result.fields.employeeCount).toBe(2);
    });
  }
});

describe("BF8-4 알려 준 이름은 대문자 표기도 지운다(그리스어 끝 시그마 포함)", () => {
  for (const [name, upper] of [
    ["Στέφανος", "ΣΤΈΦΑΝΟΣ"],
    ["Μάριος", "ΜΆΡΙΟΣ"],
    ["John Smith", "JOHN SMITH"],
    ["김지원", "김지원"],
  ]) {
    it(`${name} ↔ ${upper}`, async () => {
      const result = await readDocuments([{ name: `${upper}_사진.png`, bytes: HEAD.png }], {
        aiReader: async () => ({ industry: `소프트웨어 개발 ${upper}`, personNames: [name] }),
      });
      const json = JSON.stringify(result).normalize("NFC");
      expect(json).not.toContain(upper.normalize("NFC"));
      expect(json).not.toContain(name.normalize("NFC"));
      expect(result.fields.industry).toBe("소프트웨어 개발");
    });
  }
});

describe("BF8-5 매출 라벨을 되풀이한 줄이 오래 걸리지 않는다", () => {
  it("라벨 24,000번 되풀이 줄은 빨리 끝나고 매출을 정하지 않는다", () => {
    const text = `손익계산서\n${"매출액 (1) ".repeat(24_000)}`;
    const started = performance.now();
    const parsed = parseFinancial({ text }, "financial-statement");
    expect(performance.now() - started).toBeLessThan(500);
    expect(parsed.fields.lastYearRevenueKrw).toBeUndefined();
  });

  it("앞 라벨 몇 개를 못 읽어도 같은 줄 뒤 라벨의 금액은 읽는다", () => {
    const parsed = parseFinancial({ text: "손익계산서\n매출액 증가율 매출액 1,000,000" }, "financial-statement");
    expect(parsed.fields.lastYearRevenueKrw).toBe(1_000_000);
  });

  it("되풀이 txt 를 공개 진입점으로 올려도 빨리 끝난다", async () => {
    const started = performance.now();
    await readDocuments([{ name: "재무제표.txt", bytes: txtOf(`손익계산서\n${"매출액 (1) ".repeat(24_000)}`) }]);
    expect(performance.now() - started).toBeLessThan(1500);
  });
});
