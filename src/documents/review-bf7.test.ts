// 재리뷰(Astra 6차) BF7 — ZIP64 표시 거절·시트를 이름이 아니라 순서로 잇기·이름 목록 상한 없애기·모든 명부 시트의 이름·
// 전기 열의 괄호 음수. 원칙: 빈틈을 하나씩 막지 않고 「모르면 거절·미확정」. ★표본은 전부 지어낸 값이다.

import AdmZip from "adm-zip";
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { personNameEraser } from "./clean-text";
import { extractDocumentText } from "./extract-text";
import { readDocuments } from "./index";
import { parseFinancial } from "./parse-financial";
import { preflightSpreadsheetZip } from "./spreadsheet-zip-guard";
import { EMPLOYMENT_ROWS, HEAD, txtOf, xlsxTableOf } from "./__fixtures__/samples";

/** 결과 어디에도 있으면 안 되는 이름이 JSON 에 없는지 본다(공백·대소문자 차이도 같은 이름으로 본다). */
function expectNoName(result: unknown, ...names: string[]): void {
  const json = JSON.stringify(result).replace(/\s+/g, "").toLowerCase();
  for (const name of names) expect(json).not.toContain(name.replace(/\s+/g, "").toLowerCase());
}

const MIB = 1024 * 1024;

/* ───────── 1. ZIP64 표시는 어느 쪽에 있든 거절 ───────── */

describe("BF7-1 ZIP64 표시가 하나라도 있으면 읽기 전에 거절한다", () => {
  const roster = () => xlsxTableOf("고용현황", EMPLOYMENT_ROWS);
  const u16 = (buf: Buffer, at: number) => buf.readUInt16LE(at);
  const u32 = (buf: Buffer, at: number) => buf.readUInt32LE(at);
  const splice = (buf: Buffer, at: number, bytes: Buffer) => Buffer.concat([buf.subarray(0, at), bytes, buf.subarray(at)]);
  const eocdOf = (buf: Buffer) => buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));

  /** ZIP64 확장 필드(ID 0x0001, 비압축·압축 크기 48MiB) 20바이트 */
  const zip64Extra = (): Buffer => {
    const extra = Buffer.alloc(20);
    extra.writeUInt16LE(0x0001, 0);
    extra.writeUInt16LE(16, 2);
    extra.writeBigUInt64LE(BigInt(48 * MIB), 4);
    extra.writeBigUInt64LE(BigInt(48 * MIB), 12);
    return extra;
  };

  /** 파일 안에서 맨 뒤에 놓인 칸의 로컬 헤더 끝에 확장 필드를 끼운다(뒤따르는 칸이 없어 끝 레코드의 디렉터리 위치만 밀면 된다). */
  const withLocalExtra = (buf: Buffer, extra: Buffer): Buffer => {
    const last = new AdmZip(buf).getEntries().reduce((a, b) => (b.header.offset > a.header.offset ? b : a));
    const at = last.header.offset;
    const out = splice(buf, at + 30 + u16(buf, at + 26), extra);
    out.writeUInt16LE(u16(out, at + 28) + extra.length, at + 28);
    const eocd = eocdOf(out);
    out.writeUInt32LE(u32(out, eocd + 16) + extra.length, eocd + 16);
    return out;
  };

  /** 중앙 디렉터리의 맨 뒤 항목 끝에 확장 필드를 끼운다. */
  const withCentralExtra = (buf: Buffer, extra: Buffer): Buffer => {
    const eocd = eocdOf(buf);
    let at = u32(buf, eocd + 16);
    let last = at;
    for (let i = 0; i < u16(buf, eocd + 10); i++) {
      last = at;
      at += 46 + u16(buf, at + 28) + u16(buf, at + 30) + u16(buf, at + 32);
    }
    const out = splice(buf, last + 46 + u16(buf, last + 28), extra);
    out.writeUInt16LE(u16(out, last + 30) + extra.length, last + 30);
    const newEocd = eocd + extra.length;
    out.writeUInt32LE(u32(out, newEocd + 12) + extra.length, newEocd + 12);
    return out;
  };

  const expectRefused = async (bad: Buffer) => {
    expect(preflightSpreadsheetZip(bad).ok).toBe(false);
    const result = await readDocuments([{ name: "고용보험 가입자명부.xlsx", bytes: bad }]);
    expect(result.files[0].status).toBe("unsupported");
    expect(result.fields.employeeCount).toBeUndefined();
  };

  it("정상 XLSX 는 통과해 읽힌다", async () => {
    expect(preflightSpreadsheetZip(roster())).toEqual({ ok: true });
    const result = await readDocuments([{ name: "고용보험 가입자명부.xlsx", bytes: roster() }]);
    expect(result.files[0].status).toBe("read");
    expect(result.fields.employeeCount).toBe(3);
  });

  it("로컬 헤더에만 ZIP64 확장(비압축 48MiB)이 있어도 거절한다", async () => {
    await expectRefused(withLocalExtra(roster(), zip64Extra()));
  });

  it("중앙 디렉터리에만 ZIP64 확장이 있어도 거절한다", async () => {
    await expectRefused(withCentralExtra(roster(), zip64Extra()));
  });

  it("확장 필드가 길이 범위를 넘으면(깨진 파일) 거절한다", async () => {
    const broken = Buffer.alloc(8);
    broken.writeUInt16LE(0x9999, 0);
    broken.writeUInt16LE(0xfff0, 2); // 남은 길이보다 훨씬 크다
    await expectRefused(withLocalExtra(roster(), broken));
    await expectRefused(withCentralExtra(roster(), broken));
  });

  it("ZIP64 가 아닌 다른 확장 필드는 그대로 통과한다", () => {
    const other = Buffer.alloc(8);
    other.writeUInt16LE(0x7075, 0); // 유니코드 경로 같은 흔한 확장
    other.writeUInt16LE(4, 2);
    expect(preflightSpreadsheetZip(withLocalExtra(roster(), other))).toEqual({ ok: true });
    expect(preflightSpreadsheetZip(withCentralExtra(roster(), other))).toEqual({ ok: true });
  });

  it("크기 칸이 0xFFFFFFFF 이거나 항목 수가 0xFFFF 이면 거절한다", async () => {
    const full = roster();
    const eocd = eocdOf(full);
    // 중앙 디렉터리 첫 항목의 압축 크기 칸
    const sizeFull = Buffer.from(full);
    sizeFull.writeUInt32LE(0xffffffff, u32(full, eocd + 16) + 20);
    await expectRefused(sizeFull);
    const countFull = Buffer.from(full);
    countFull.writeUInt16LE(0xffff, eocd + 10);
    await expectRefused(countFull);
    // 로컬 헤더의 비압축 크기 칸
    const localFull = Buffer.from(full);
    localFull.writeUInt32LE(0xffffffff, new AdmZip(full).getEntries()[0].header.offset + 22);
    await expectRefused(localFull);
  });

  it("ZIP64 위치 표시·끝 레코드 서명이 있어도 거절한다", async () => {
    const full = roster();
    const eocd = eocdOf(full);
    const locator = Buffer.alloc(20);
    locator.writeUInt32LE(0x07064b50, 0);
    await expectRefused(splice(full, eocd, locator));
    const record = Buffer.alloc(56);
    record.writeUInt32LE(0x06064b50, 0);
    await expectRefused(splice(full, eocd, record));
  });
});

/* ───────── 2. 시트 XML 과 읽은 시트는 순서로 잇는다 ───────── */

describe("BF7-2 마지막 값 줄을 모르는 시트는 잘림으로 본다", () => {
  const SHEET_XML = "xl/worksheets/sheet1.xml";
  const BOOK = "xl/workbook.xml";
  const RELS = "xl/_rels/workbook.xml.rels";

  /** 머리글 + 2행, 그리고 farRow 행에 직원이 한 명 있는 명부. dimension 은 읽기 도구가 속도록 A1:D2 로 거짓말을 적는다. */
  function rosterWithLyingDimension(farRow: number, sheetName = "고용현황"): Buffer {
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
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    const zip = new AdmZip(Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer));
    const patched = zip.readAsText(SHEET_XML).replace(/<dimension\s+ref="[^"]*"\s*\/>/, '<dimension ref="A1:D2"/>');
    if (!patched.includes('<dimension ref="A1:D2"/>')) throw new Error("표본의 시트 범위를 바꾸지 못했다");
    zip.updateFile(SHEET_XML, Buffer.from(patched, "utf-8"));
    return zip.toBuffer();
  }

  /** 통합 문서의 시트 이름만 파일에 적힌 모양(`고용_x0020_현황`)으로 바꾼다 — 읽기 도구가 보는 이름과 달라질 수 있다. */
  function withEscapedName(buf: Buffer): Buffer {
    const zip = new AdmZip(buf);
    const book = zip.readAsText(BOOK);
    if (!book.includes('name="고용현황"')) throw new Error("표본의 시트 이름을 찾지 못했다");
    zip.updateFile(BOOK, Buffer.from(book.replace('name="고용현황"', 'name="고용_x0020_현황"'), "utf-8"));
    return zip.toBuffer();
  }

  function withRenamedEntry(buf: Buffer, from: string, to: string): Buffer {
    const zip = new AdmZip(buf);
    const entry = zip.getEntry(from);
    if (!entry) throw new Error("표본에 그 칸이 없다");
    entry.entryName = to;
    return zip.toBuffer();
  }

  const VARIANTS: Record<string, (buf: Buffer) => Buffer> = {
    "시트 이름 고용_x0020_현황": withEscapedName,
    "xl/Workbook.xml 대소문자": (buf) => withRenamedEntry(buf, BOOK, "xl/Workbook.xml"),
    "Workbook.xml + rels 대소문자": (buf) =>
      withRenamedEntry(withRenamedEntry(buf, BOOK, "xl/Workbook.xml"), RELS, "xl/_rels/Workbook.xml.rels"),
  };

  const countOf = async (bytes: Buffer) =>
    (await readDocuments([{ name: "고용보험 가입자명부.xlsx", bytes }])).fields.employeeCount;

  it("표본: 범위를 속인 3,000행 명부는 바꾸지 않아도 확정하지 않는다(순서로 이어 3000을 안다)", async () => {
    expect(await countOf(rosterWithLyingDimension(3000))).toBeUndefined();
    const r = await extractDocumentText("명부.xlsx", rosterWithLyingDimension(3000));
    if (r.kind !== "spreadsheet") throw new Error(`엑셀로 읽혀야 한다: ${r.kind}`);
    expect(r.sheets[0].truncated).toBe(true);
  });

  it("시트 이름·통합 문서 대소문자를 바꿔도 3,000행 명부는 확정 인원이 없다", async () => {
    for (const [label, patch] of Object.entries(VARIANTS)) {
      const bytes = patch(rosterWithLyingDimension(3000));
      expect(await countOf(bytes), label).toBeUndefined();
      // 엑셀로 읽히는 경우에는 모든 시트가 잘림이어야 한다(읽기 도구가 못 읽으면 거절이라 이 줄은 건너뛴다).
      const r = await extractDocumentText("명부.xlsx", bytes);
      if (r.kind === "spreadsheet") for (const sheet of r.sheets) expect(sheet.truncated, label).toBe(true);
    }
  });

  it("2행뿐인 작은 명부는 이름·대소문자를 바꿔도 그대로 센다", async () => {
    for (const [label, patch] of Object.entries(VARIANTS)) {
      const bytes = patch(rosterWithLyingDimension(3));
      const r = await extractDocumentText("명부.xlsx", bytes);
      if (r.kind !== "spreadsheet") continue; // 읽기 도구가 이 표기를 못 읽는 경우는 이 시험이 따지지 않는다
      expect(r.sheets[0].truncated, label).toBeUndefined();
      expect(await countOf(bytes), label).toBe(2);
    }
  });

  it("정상 작은 명부는 그대로 센다", async () => {
    expect(await countOf(rosterWithLyingDimension(3))).toBe(2);
    expect(await countOf(xlsxTableOf("고용현황", EMPLOYMENT_ROWS))).toBe(3);
  });

  it("시트가 둘이어도 순서로 이어 각자 따진다 — 뒤 시트만 3,000행이면 그 시트만 잘림", async () => {
    const far: XLSX.WorkSheet = {
      A1: { t: "s", v: "근로자 이름" },
      A3000: { t: "s", v: "가상직원이" },
      "!ref": "A1:A3000",
    };
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(EMPLOYMENT_ROWS), "첫째");
    XLSX.utils.book_append_sheet(wb, far, "둘째");
    const bytes = Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer);
    const r = await extractDocumentText("명부.xlsx", bytes);
    if (r.kind !== "spreadsheet") throw new Error(`엑셀로 읽혀야 한다: ${r.kind}`);
    expect(r.sheets.map((s) => s.truncated)).toEqual([undefined, true]);
  });
});

/* ───────── 3. 이름 목록 상한 ───────── */

describe("BF7-3 지우기 목록에 상한이 없어 라벨·AI 이름이 밀려나지 않는다", () => {
  const SYLLABLES = Array.from("꺼껍꼬꾸뀌끌넉녹뇌눈닭댁덕돈돔뒤");
  /** 서로 다른 가상 직원 이름(글자만) — 0 이상 4095 미만 */
  const nameOf = (i: number): string =>
    SYLLABLES[i % 16] + SYLLABLES[Math.floor(i / 16) % 16] + SYLLABLES[Math.floor(i / 256) % 16];
  const rosterCsv = (count: number): string =>
    [
      "근로자 이름,근로자 주민번호,고용상태,취득일",
      ...Array.from({ length: count }, (_, i) => `${nameOf(i)},900101-1${String(i).padStart(6, "0")},고용,2022-01-03`),
    ].join("\n");

  const BIZ_TEXT = ["사업자등록증", "대표자 박민서", "업태 서비스업 종목 도소매"].join("\n");

  it("1,000명 명부 + 박민서_사업자등록증.txt(대표자 박민서) + 사진 업종 … 박민서 → 어디에도 박민서가 없다", async () => {
    const result = await readDocuments(
      [
        { name: "고용보험_가입자명부.csv", bytes: txtOf(rosterCsv(1000)) },
        { name: "박민서_사업자등록증.txt", bytes: txtOf(BIZ_TEXT) },
        { name: "사진.png", bytes: HEAD.png },
      ],
      { aiReader: async () => ({ industry: "소프트웨어 개발 박민서" }) },
    );
    expect(result.fields.employeeCount).toBe(1000);
    expectNoName(result, "박민서");
    expect(result.files[1].name).toBe("○○○_사업자등록증.txt");
  });

  it("라벨 이름 뒤에 파일이 와도(명부가 맨 뒤) 같다", async () => {
    const result = await readDocuments(
      [
        { name: "박민서_사업자등록증.txt", bytes: txtOf(BIZ_TEXT) },
        { name: "사진.png", bytes: HEAD.png },
        { name: "고용보험_가입자명부.csv", bytes: txtOf(rosterCsv(1000)) },
      ],
      { aiReader: async () => ({ industry: "소프트웨어 개발 박민서" }) },
    );
    expectNoName(result, "박민서");
  });

  it("1,001명 CSV 의 마지막 직원 이름도 지워진다", async () => {
    const last = nameOf(1000);
    const result = await readDocuments(
      [
        { name: "고용보험_가입자명부.csv", bytes: txtOf(rosterCsv(1001)) },
        { name: "사진.png", bytes: HEAD.png },
      ],
      { aiReader: async () => ({ industry: `소프트웨어 개발 ${last}` }) },
    );
    expect(result.fields.employeeCount).toBe(1001);
    expect(result.fields.industry).toBe("소프트웨어 개발");
    expectNoName(result, last);
  });

  it("AI personNames 가 1,000개를 넘어도 모두 지운다", async () => {
    const names = Array.from({ length: 1200 }, (_, i) => nameOf(i));
    const result = await readDocuments([{ name: "사진.png", bytes: HEAD.png }], {
      aiReader: async () => ({ industry: `소프트웨어 개발 ${names[1199]}`, personNames: names }),
    });
    expect(result.fields.industry).toBe("소프트웨어 개발");
    expectNoName(result, names[1199]);
  });

  it("이름 2,000개로도 업종·파일 이름 처리가 100ms 안에 끝난다", () => {
    const names = Array.from({ length: 2000 }, (_, i) => nameOf(i));
    const text = `소프트웨어 개발 ${nameOf(1999)} `.repeat(20).slice(0, 500);
    const started = Date.now();
    const erase = personNameEraser(names);
    if (!erase) throw new Error("지우기 함수가 있어야 한다");
    for (let i = 0; i < 20; i++) {
      erase(text, " ");
      erase(`${"a".repeat(80)}${nameOf(1999)}_사업자등록증.txt`, "○○○");
    }
    expect(Date.now() - started).toBeLessThan(100);
    expect(erase(`가 ${nameOf(1999)} 나`, "○")).toBe("가 ○ 나");
  });

  it("지우기 함수는 글자 사이 공백·대소문자를 가리지 않고 긴 이름을 먼저 지운다", () => {
    const erase = personNameEraser(["김지", "김지원", "Kim Lee"]);
    if (!erase) throw new Error("지우기 함수가 있어야 한다");
    expect(erase("대표 김 지 원 입니다", "○")).toBe("대표 ○ 입니다");
    expect(erase("KIMLEE 와 kim  lee", "○")).toBe("○ 와 ○");
    expect(erase("아무도 없음", "○")).toBe("아무도 없음");
    expect(personNameEraser([])).toBeNull();
  });
});

/* ───────── 4. 모든 명부 시트의 이름 ───────── */

describe("BF7-4 인원 셈이 첫 시트에서 끝나도 뒤 명부 시트의 이름까지 모은다", () => {
  const HEADER = ["근로자 이름", "근로자 주민번호", "고용상태", "취득일"];

  it("1시트 김지원 · 2시트 박민서 → 사진 업종의 박민서도 지워진다", async () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([HEADER, ["김지원", "900101-1111111", "고용", "2022-01-03"]]), "본점");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([HEADER, ["박민서", "910202-2222222", "고용", "2023-02-01"]]), "지점");
    const bytes = Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer);
    const result = await readDocuments(
      [
        { name: "박민서_고용보험.xlsx", bytes },
        { name: "사진.png", bytes: HEAD.png },
      ],
      { aiReader: async () => ({ industry: "소프트웨어 개발 박민서" }) },
    );
    expect(result.fields.employeeCount).toBe(1); // 셈은 첫 명부 시트에서 끝난다(기존 동작)
    expect(result.fields.industry).toBe("소프트웨어 개발");
    expectNoName(result, "박민서", "김지원");
  });
});

/* ───────── 5. 전기 열의 괄호 음수 ───────── */

describe("BF7-5 괄호 음수는 금액 토큰으로 읽어 당기 열을 고른다", () => {
  const read = (...lines: string[]) =>
    parseFinancial({ text: ["표준손익계산서", ...lines].join("\n") }, "financial-statement");
  const readCsv = (...lines: string[]) =>
    parseFinancial({ text: ["표준손익계산서", ...lines].join("\n"), csv: true }, "financial-statement");

  it("머리글 「전기 당기」 순서면 전기가 음수여도 당기 900 을 읽는다", () => {
    expect(read("과목\t전기\t당기", "매출액\t(1,234)\t900").fields).toEqual({ lastYearRevenueKrw: 900 });
    expect(read("과목 | 전기 | 당기", "매출액 | (1,234) | 900").fields).toEqual({ lastYearRevenueKrw: 900 });
    expect(read("과목      전기       당기", "매출액     (1,234)     900").fields).toEqual({ lastYearRevenueKrw: 900 });
    expect(readCsv("과목,전기,당기", '매출액,"(1,234)",900').fields).toEqual({ lastYearRevenueKrw: 900 });
  });

  it("머리글 「당기 전기」 순서에서 당기가 음수면 미확정", () => {
    expect(read("과목\t당기\t전기", "매출액\t(1,234)\t900").fields).toEqual({});
    expect(readCsv("과목,당기,전기", '매출액,"(1,234)",900').fields).toEqual({});
    expect(read("과목      당기       전기", "매출액     (1,234)     900").fields).toEqual({});
  });

  it("머리글 없는 「매출액 (1,234) 900」은 첫 금액이 음수라 미확정(기존 동작 그대로)", () => {
    expect(read("매출액 (1,234) 900").fields).toEqual({});
    expect(read("매출액 （1,234） 900").fields).toEqual({});
    expect(read("매출액(1,234) 900").fields).toEqual({});
    expect(read("매출액 △1,234 900").fields).toEqual({});
  });

  it("숫자 아닌 괄호 풀이는 건너뛴다 — 「매출액(주석 3) 1,000,000」 → 1,000,000", () => {
    expect(read("매출액(주석 3) 1,000,000").fields).toEqual({ lastYearRevenueKrw: 1_000_000 });
    expect(read("매출액 (단위: 원) 2,000,000").fields).toEqual({ lastYearRevenueKrw: 2_000_000 });
  });

  it("라벨 뒤에 금액이 없는 줄(매출액 증가율)은 머리글 열이 있어도 매출 줄이 아니다", () => {
    expect(read("과목\t당기\t전기", "매출액증가율\t5.0\t3.0").fields).toEqual({});
    expect(read("과목\t당기\t전기", "매출액증가율\t5.0\t3.0", "매출액\t1,000\t900").fields).toEqual({ lastYearRevenueKrw: 1_000 });
  });

  it("한 줄에 라벨이 둘이면 금액이 있는 쪽을 쓴다", () => {
    expect(read("매출액 증가율 5.0 매출액 1,000").fields).toEqual({ lastYearRevenueKrw: 1_000 });
  });
});
