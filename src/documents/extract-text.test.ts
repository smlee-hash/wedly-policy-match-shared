import AdmZip from "adm-zip";
import iconv from "iconv-lite";
import { describe, expect, it } from "vitest";
import { extractDocumentText, looksScanned, type ExtractedDocument } from "./extract-text";
import {
  SPREADSHEET_ZIP_MAX_TOTAL_BYTES,
  preflightSpreadsheetZip,
} from "./spreadsheet-zip-guard";
import {
  HEAD,
  blankPdf,
  companyStatusSheet,
  docxOf,
  hwpxOf,
  pdfOf,
  pptxOf,
  txtOf,
  xlsxOf,
  xlsxTableOf,
} from "./__fixtures__/samples";

const run = (name: string, bytes: Uint8Array) => extractDocumentText(name, bytes);

function textOf(r: ExtractedDocument): string {
  if (r.kind !== "text") throw new Error(`글이 아니라 ${r.kind}`);
  return r.text;
}

describe("extractDocumentText — 글 파일", () => {
  it("txt(UTF-8)를 그대로 돌려준다", async () => {
    const r = await run("메모.txt", txtOf("가상테크 메모\r\n둘째 줄"));
    expect(r).toEqual({ kind: "text", text: "가상테크 메모\n둘째 줄" });
  });

  it("옛 윈도우 글자(CP949)로 저장한 csv 도 읽는다", async () => {
    const r = await run("표.csv", iconv.encode("업체명,가상테크\n지역,경기", "cp949"));
    expect(textOf(r)).toBe("업체명,가상테크\n지역,경기");
  });

  it("UTF-16 으로 저장한 txt(엑셀 「유니코드 텍스트」)도 읽는다", async () => {
    const body = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("가상테크", "utf16le")]);
    expect(textOf(await run("유니코드.txt", body))).toBe("가상테크");
  });

  it("글 파일이라면서 속이 바이너리(널 바이트)면 거절한다", async () => {
    const r = await run("가짜.txt", Buffer.from([0x41, 0x00, 0x42, 0x00, 0x00, 0x43, 0x00]));
    expect(r.kind).toBe("unsupported");
  });
});

describe("extractDocumentText — 워드·한글·파워포인트", () => {
  it("docx 문단과 표(행=줄, 칸=탭)를 읽는다", async () => {
    const r = await run("서류.docx", docxOf(["사업자등록증", ["상호", "가상테크"], "끝"]));
    expect(textOf(r)).toBe("사업자등록증\n상호\t가상테크\n끝");
  });

  it("docx 속 XML 기호(&)를 원래 글자로 되돌린다", async () => {
    expect(textOf(await run("a.docx", docxOf(["R&D 센터"])))).toBe("R&D 센터");
  });

  it("hwpx 본문을 읽는다", async () => {
    const r = await run("서류.hwpx", hwpxOf(["사업자등록증명", "가상테크"]));
    expect(textOf(r)).toBe("사업자등록증명\n가상테크");
  });

  it("pptx 슬라이드 글자를 쪽 번호와 함께 읽는다", async () => {
    const r = await run("발표.pptx", pptxOf([["첫 장 제목"], ["둘째 장 내용"]]));
    expect(textOf(r)).toBe("## 1쪽\n첫 장 제목\n\n## 2쪽\n둘째 장 내용");
  });

  it("글자가 없는 docx 는 빈 글(터지지 않는다)", async () => {
    expect(await run("빈.docx", docxOf([]))).toEqual({ kind: "text", text: "" });
  });

  it("풀면 한도를 넘는 docx 속 칸은 읽지 않고 빈 글로 돌려준다(압축 폭탄)", async () => {
    const zip = new AdmZip();
    zip.addFile("word/document.xml", Buffer.alloc(21 * 1024 * 1024));
    expect(await run("폭탄.docx", zip.toBuffer())).toEqual({ kind: "text", text: "" });
  });
});

describe("extractDocumentText — PDF", () => {
  const LONG = Array.from({ length: 8 }, (_, i) => `Business registration sample line number ${i + 1} for tests`);

  it("글자가 충분한 PDF 는 글로 읽는다", async () => {
    const r = await run("서류.pdf", await pdfOf(LONG));
    expect(textOf(r)).toContain("sample line number 3");
  });

  it("글자가 거의 없는 PDF 는 스캔본 = image", async () => {
    expect(await run("스캔.pdf", await blankPdf())).toEqual({ kind: "image" });
  });

  it("같은 바이트를 두 번 읽어도 된다(PDF 읽기가 원본을 비우지 않는다)", async () => {
    const bytes = new Uint8Array(await pdfOf(LONG));
    expect(textOf(await run("a.pdf", bytes))).toContain("sample line number 1");
    expect(bytes.byteLength).toBeGreaterThan(0);
    expect(textOf(await run("a.pdf", bytes))).toContain("sample line number 1");
  });

  it("PDF 머리는 맞지만 속이 깨졌으면 unsupported + 안내(예외를 던지지 않는다)", async () => {
    const r = await run("깨짐.pdf", Buffer.from("%PDF-1.7\nthis is not a pdf at all"));
    expect(r.kind).toBe("unsupported");
    if (r.kind === "unsupported") expect(r.reason).toContain("PDF");
  });

  it("looksScanned — 공백을 뺀 글자 수로 센다", () => {
    expect(looksScanned(" \n \n\t  ")).toBe(true);
    expect(looksScanned("가".repeat(99))).toBe(true);
    expect(looksScanned("가".repeat(100))).toBe(false);
  });
});

describe("extractDocumentText — 엑셀", () => {
  it("xlsx 를 칸 이름(B3)으로 찾을 수 있게 읽는다", async () => {
    const r = await run("기업상태표.xlsx", xlsxOf({ 기업상태표: companyStatusSheet() }));
    expect(r.kind).toBe("spreadsheet");
    if (r.kind !== "spreadsheet") return;
    expect(r.sheets).toHaveLength(1);
    expect(r.sheets[0].name).toBe("기업상태표");
    expect(r.sheets[0].cells.B3).toBe("제조업 / 전자부품");
    expect(r.sheets[0].cells.C6).toBe("1억 2천");
    expect(r.sheets[0].cells.Z99).toBeUndefined();
    expect(r.sheets[0].text.startsWith("## 기업상태표\n")).toBe(true);
  });

  it("숫자 칸은 숫자 글자로, 날짜 서식 칸은 YYYY-MM-DD 로 바꾼다", async () => {
    const r = await run("a.xlsx", xlsxOf({ s: { B1: 120000000, F2: { serial: 41456, format: "yyyy-mm-dd" }, F3: { serial: 41456, format: "m/d/yy" } } }));
    if (r.kind !== "spreadsheet") throw new Error(r.kind);
    expect(r.sheets[0].cells.B1).toBe("120000000");
    expect(r.sheets[0].cells.F2).toBe("2013-07-01");
    expect(r.sheets[0].cells.F3).toBe("2013-07-01");
  });

  it("옛 .xls(BIFF)도 읽는다", async () => {
    const r = await run("옛.xls", xlsxOf({ s: { A1: "가상테크" } }, "biff8"));
    expect(r.kind).toBe("spreadsheet");
    if (r.kind === "spreadsheet") expect(r.sheets[0].cells.A1).toBe("가상테크");
  });

  it("시트 글(text)은 ## 시트이름 + 쉼표 표 — 고용현황 읽기가 기대하는 모양", async () => {
    const r = await run("명부.xlsx", xlsxTableOf("고용현황", [["근로자 이름", "고용상태"], ["가상직원일", "고용"]]));
    if (r.kind !== "spreadsheet") throw new Error(r.kind);
    expect(r.sheets[0].text).toBe("## 고용현황\n근로자 이름,고용상태\n가상직원일,고용");
  });
});

describe("extractDocumentText — 사진·hwp·그 밖", () => {
  it("jpg·jpeg·png·webp 는 image", async () => {
    expect(await run("a.jpg", HEAD.jpeg)).toEqual({ kind: "image" });
    expect(await run("a.JPEG", HEAD.jpeg)).toEqual({ kind: "image" });
    expect(await run("a.png", HEAD.png)).toEqual({ kind: "image" });
    expect(await run("a.webp", HEAD.webp)).toEqual({ kind: "image" });
  });

  it("hwp 는 unsupported — 「PDF로 저장해 올려 주세요」", async () => {
    const r = await run("옛한글.hwp", HEAD.cfb);
    expect(r.kind).toBe("unsupported");
    if (r.kind === "unsupported") expect(r.reason).toContain("PDF로 저장해 올려 주세요");
  });

  it("읽을 수 없는 종류(.exe·.zip·.doc·.gif)와 이름에 확장자가 없는 파일은 unsupported", async () => {
    for (const name of ["a.exe", "a.zip", "a.doc", "a.gif", "확장자없음"]) {
      expect((await run(name, HEAD.zip)).kind, name).toBe("unsupported");
    }
  });

  it("빈 파일은 unsupported", async () => {
    expect((await run("빈.txt", new Uint8Array(0))).kind).toBe("unsupported");
  });
});

describe("extractDocumentText — 확장자 위장(파일 머리 바이트가 안 맞으면 거절)", () => {
  it(".xlsx 인데 PDF 머리면 unsupported", async () => {
    const r = await run("위장.xlsx", HEAD.pdf);
    expect(r.kind).toBe("unsupported");
    if (r.kind === "unsupported") expect(r.reason).toContain("확장자");
  });

  it("그 밖의 위장도 모두 unsupported", async () => {
    const cases: Array<[string, Uint8Array]> = [
      ["a.docx", HEAD.pdf],
      ["a.hwpx", HEAD.pdf],
      ["a.pptx", HEAD.pdf],
      ["a.pdf", HEAD.zip],
      ["a.xls", HEAD.pdf],
      ["a.png", HEAD.pdf],
      ["a.jpg", HEAD.png],
      ["a.webp", HEAD.jpeg],
      ["a.txt", HEAD.pdf],
      ["a.csv", HEAD.zip],
    ];
    for (const [name, bytes] of cases) {
      expect((await run(name, bytes)).kind, name).toBe("unsupported");
    }
  });
});

describe("압축 폭탄 — 엑셀을 열기 전에 막는다", () => {
  /** 0 으로만 채운 한 칸짜리 xlsx 모양 zip. 아주 작게 압축되지만 풀면 한도를 넘는다. */
  function bombZip(bytes: number): Buffer {
    const zip = new AdmZip();
    zip.addFile("xl/worksheets/sheet1.xml", Buffer.alloc(bytes));
    return zip.toBuffer();
  }
  const OVER = SPREADSHEET_ZIP_MAX_TOTAL_BYTES + 1024 * 1024;

  it("풀면 한도를 넘는다고 적어 둔 파일은 거절한다", async () => {
    const zip = bombZip(OVER);
    expect(zip.length).toBeLessThan(1024 * 1024); // 압축된 모양은 작다
    const r = await run("폭탄.xlsx", zip);
    expect(r.kind).toBe("unsupported");
    if (r.kind === "unsupported") expect(r.reason).toContain("너무 큽니다");
  });

  it("크기를 작게 거짓 신고한 파일도 실제로 풀며 거절한다", async () => {
    const zip = bombZip(OVER);
    // 가운데 디렉터리(50 4B 01 02)의 「풀었을 때 크기」(+24)를 100 으로 속인다.
    const at = zip.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    expect(at).toBeGreaterThan(0);
    zip.writeUInt32LE(100, at + 24);
    expect(new AdmZip(zip).getEntries()[0].header.size).toBe(100);
    const r = await run("거짓신고.xlsx", zip);
    expect(r.kind).toBe("unsupported");
    if (r.kind === "unsupported") expect(r.reason).toContain("너무 큽니다");
  });

  it("preflightSpreadsheetZip — 정상 파일은 통과, 한도를 낮추면 거절", () => {
    const ok = xlsxOf({ s: { A1: "가상테크" } });
    expect(preflightSpreadsheetZip(ok)).toEqual({ ok: true });
    const small = preflightSpreadsheetZip(ok, { maxParts: 1000, maxTotalBytes: 10, maxEntryBytes: 10 });
    expect(small.ok).toBe(false);
    expect(preflightSpreadsheetZip(Buffer.from("not a zip")).ok).toBe(false);
  });
});
