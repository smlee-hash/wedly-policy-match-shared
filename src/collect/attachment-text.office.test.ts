import AdmZip from "adm-zip";
import { utils, write } from "cfb";
import { describe, expect, it, vi } from "vitest";
import { docxOf, hwpxOf, pptxOf, xlsxOf, xlsxTableOf } from "../documents/__fixtures__/samples";
import { fetchAttachmentTexts, type AttachmentFileReason, type FetchAttachmentTextsOptions } from "./attachment-text";
import type { PolicyAttachmentRequest } from "./board/types";

/**
 * 받은 파일이 워드·엑셀·파워포인트·ODT·옛 엑셀이면 그 형식으로 읽는다(2026-10-01 「첨부파일 글자 추출 누락」 4번).
 *
 * 운영 실측에서 본 것:
 *  · zip(PK) 으로 시작하는 파일은 모두 한글(hwpx)로 보고 한글 추출기에 넣었다 — 워드·엑셀·파워포인트·ODT 는
 *    빈 글자가 나와 「글자 없음」으로 끝났다. 과기정통부 odt 공고, 엑셀 지원 내역표가 이렇게 빠졌다.
 *  · 옛 엑셀(.xls)은 OLE 라 한글(hwp)로 읽다 실패했다.
 *  · 서식 묶음 zip 은 문서가 아닌데 「글자 없음」으로 남아, 압축 파일이라는 걸 알 수 없었다 → 「archive」.
 *  · 옛 워드(.doc)·옛 파워포인트(.ppt)는 읽을 도구가 없다 → 「unsupported」 로 따로 남긴다.
 * 이름·저장 형식보다 받은 바이트를 먼저 본다. 표시 모양(`[첨부: X]`·`[읽지 못한 첨부: X]`)은 그대로다.
 */

const B = "https://www.bizinfo.go.kr/cmm/fms/fileDown.do?file=";

const ok = (body: Buffer | Uint8Array) => new Response(Uint8Array.from(body), { status: 200 });

const opts = (fetch: unknown, more: Partial<FetchAttachmentTextsOptions> = {}): FetchAttachmentTextsOptions => ({
  extractHwpx: () => "",
  fetch: fetch as never,
  ...more,
});

type Kind = PolicyAttachmentRequest["kind"];

function zipOf(entries: Record<string, string | Buffer>): Buffer {
  const zip = new AdmZip();
  for (const [name, v] of Object.entries(entries)) zip.addFile(name, typeof v === "string" ? Buffer.from(v, "utf8") : v);
  return zip.toBuffer();
}

const ODF_NS =
  'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" ' +
  'xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"';

function odtOf(body: string): Buffer {
  return zipOf({
    mimetype: "application/vnd.oasis.opendocument.text",
    "content.xml": `<?xml version="1.0" encoding="UTF-8"?><office:document-content ${ODF_NS}><office:body><office:text>${body}</office:text></office:body></office:document-content>`,
  });
}

function odsOf(cells: string[]): Buffer {
  const row = cells.map((c) => `<table:table-cell office:value-type="string"><text:p>${c}</text:p></table:table-cell>`).join("");
  return zipOf({
    mimetype: "application/vnd.oasis.opendocument.spreadsheet",
    "content.xml": `<?xml version="1.0" encoding="UTF-8"?><office:document-content ${ODF_NS}><office:body><office:spreadsheet><table:table table:name="시트1"><table:table-row>${row}</table:table-row></table:table></office:spreadsheet></office:body></office:document-content>`,
  });
}

function oleOf(streams: string[]): Buffer {
  const cfb = utils.cfb_new();
  for (const s of streams) utils.cfb_add(cfb, s, Buffer.from("stream"));
  return Buffer.from(write(cfb, { type: "buffer" }));
}

/** 한글 5 OLE — 본문 줄기 없이 미리보기(PrvText)만. */
function hwpPreviewOnly(preview: string): Buffer {
  const cfb = utils.cfb_new();
  const header = Buffer.alloc(256);
  header.write("HWP Document File", 0, "ascii");
  header[35] = 5;
  utils.cfb_add(cfb, "FileHeader", header);
  utils.cfb_add(cfb, "PrvText", Buffer.from(preview, "utf16le"));
  return Buffer.from(write(cfb, { type: "buffer" }));
}

/** 첨부 하나를 받은 바이트로 읽는다. 한글 추출기는 부른 횟수를 센다. */
async function readOne(name: string, kind: Kind, bytes: Buffer, hwpx: string = "") {
  const extractHwpx = vi.fn(() => hwpx);
  const fetch = vi.fn(async () => ok(bytes));
  const r = await fetchAttachmentTexts([{ name, url: `${B}0`, kind }], opts(fetch, { extractHwpx }));
  return { r, extractHwpx, fetch };
}

describe("zip 문서 — 속 항목으로 가려 그 형식으로 읽는다(한글 추출기에 넣지 않는다)", () => {
  it("워드(docx) — kind docx", async () => {
    const { r, extractHwpx } = await readOne(
      "2026 사업 안내.docx",
      "etc",
      docxOf(["2026년 수출 지원 사업 안내", "지원 대상: 중소기업"]),
    );
    expect(extractHwpx).not.toHaveBeenCalled();
    expect(r.readFiles).toEqual(["2026 사업 안내.docx"]);
    expect(r.text).toContain("[첨부: 2026 사업 안내.docx]");
    expect(r.text).toContain("2026년 수출 지원 사업 안내");
    expect(r.text).toContain("지원 대상: 중소기업");
    expect(r.files).toEqual([expect.objectContaining({ name: "2026 사업 안내.docx", result: "read", kind: "docx" })]);
  });

  it("엑셀(xlsx) — 시트 이름 머리와 칸 글자, kind xlsx", async () => {
    const book = xlsxTableOf("공고", [
      ["항목", "내용"],
      ["지원금", "5천만원"],
    ]);
    const { r, extractHwpx } = await readOne("지원 내용.xlsx", "etc", book);
    expect(extractHwpx).not.toHaveBeenCalled();
    expect(r.readFiles).toEqual(["지원 내용.xlsx"]);
    expect(r.text).toContain("## 공고");
    expect(r.text).toContain("지원금");
    expect(r.text).toContain("5천만원");
    expect(r.files).toEqual([expect.objectContaining({ name: "지원 내용.xlsx", result: "read", kind: "xlsx" })]);
  });

  it("엑셀 여러 시트 — 시트 차례대로 빈 줄 하나를 두고 잇는다", async () => {
    const { r } = await readOne("예산표.xlsx", "etc", xlsxOf({ 첫시트: { A1: "FIRST" }, 둘째: { A1: "SECOND" } }));
    expect(r.text).toMatch(/## 첫시트\n[\s\S]*FIRST[\s\S]*\n\n## 둘째\n[\s\S]*SECOND/);
  });

  it("엑셀 빈 시트는 빼고 값 있는 시트만", async () => {
    const { r } = await readOne("예산표.xlsx", "etc", xlsxOf({ 빈: {}, 값: { A1: "VALUE" } }));
    expect(r.text).toContain("## 값");
    expect(r.text).toContain("VALUE");
    expect(r.text).not.toContain("## 빈");
  });

  it("엑셀에 값 있는 시트가 하나도 없으면 failed·no_text", async () => {
    const { r } = await readOne("빈 표.xlsx", "etc", xlsxOf({ 빈: {} }));
    expect(r.readFiles).toEqual([]);
    expect(r.failedFiles).toEqual(["빈 표.xlsx"]);
    expect(r.files).toEqual([expect.objectContaining({ name: "빈 표.xlsx", result: "failed", reason: "no_text" })]);
  });

  it("파워포인트(pptx) — 슬라이드 글자, kind pptx", async () => {
    const { r, extractHwpx } = await readOne("설명회 자료.pptx", "etc", pptxOf([["사업 개요"], ["신청 방법"]]));
    expect(extractHwpx).not.toHaveBeenCalled();
    expect(r.text).toContain("사업 개요");
    expect(r.text).toContain("신청 방법");
    expect(r.files).toEqual([expect.objectContaining({ name: "설명회 자료.pptx", result: "read", kind: "pptx" })]);
  });

  it("ODT — kind odt", async () => {
    const { r, extractHwpx } = await readOne("공고문.odt", "etc", odtOf("<text:p>ODT 공고 본문</text:p>"));
    expect(extractHwpx).not.toHaveBeenCalled();
    expect(r.readFiles).toEqual(["공고문.odt"]);
    expect(r.text).toContain("[첨부: 공고문.odt]");
    expect(r.text).toContain("ODT 공고 본문");
    expect(r.files).toEqual([expect.objectContaining({ name: "공고문.odt", result: "read", kind: "odt" })]);
  });

  it("ODS(표 문서)도 ODT 방식으로 읽는다 — kind odt", async () => {
    const { r } = await readOne("예산.ods", "etc", odsOf(["지원금", "5천만원"]));
    expect(r.text).toContain("지원금");
    expect(r.files).toEqual([expect.objectContaining({ name: "예산.ods", result: "read", kind: "odt" })]);
  });

  it("이름은 .hwp 인데 바이트가 워드면 워드로 읽는다", async () => {
    const { r, extractHwpx } = await readOne("공고.hwp", "hwp", docxOf(["워드로 올린 공고"]));
    expect(extractHwpx).not.toHaveBeenCalled();
    expect(r.text).toContain("워드로 올린 공고");
    expect(r.files).toEqual([expect.objectContaining({ name: "공고.hwp", result: "read", kind: "docx" })]);
  });

  it("이름은 .xls 인데 바이트가 xlsx 면 xlsx 로 읽는다", async () => {
    const { r } = await readOne("예산.xls", "etc", xlsxOf({ 예산: { A1: "ZIP_BUDGET" } }));
    expect(r.text).toContain("ZIP_BUDGET");
    expect(r.files).toEqual([expect.objectContaining({ name: "예산.xls", result: "read", kind: "xlsx" })]);
  });

  it("진짜 한글 새 형식(hwpx)은 예전처럼 넣어 준 추출기로 한 번 읽는다", async () => {
    const { r, extractHwpx } = await readOne("공고.hwpx", "hwpx", hwpxOf(["가"]), "HWPX_BODY");
    expect(extractHwpx).toHaveBeenCalledTimes(1);
    expect(r.text).toContain("HWPX_BODY");
    expect(r.files).toEqual([expect.objectContaining({ name: "공고.hwpx", result: "read", kind: "hwpx" })]);
  });

  it("빈 워드는 failed·no_text", async () => {
    const { r } = await readOne("빈 문서.docx", "etc", docxOf([]));
    expect(r.failedFiles).toEqual(["빈 문서.docx"]);
    expect(r.files).toEqual([expect.objectContaining({ name: "빈 문서.docx", result: "failed", reason: "no_text" })]);
  });
});

describe("압축 묶음(archive) — 문서가 아니면 「archive」 로 남긴다", () => {
  const bundle = () => zipOf({ "서식/신청서.txt": "양식", "서식/동의서.txt": "양식" });

  it("이름이 문서가 아니면 추출기를 부르지 않고 failed·archive", async () => {
    const { r, extractHwpx } = await readOne("자료.bin", "etc", bundle(), "SHOULD_NOT_READ");
    expect(extractHwpx).not.toHaveBeenCalled();
    expect(r.readFiles).toEqual([]);
    expect(r.failedFiles).toEqual(["자료.bin"]);
    expect(r.text).toContain("[읽지 못한 첨부: 자료.bin]");
    expect(r.files).toEqual([expect.objectContaining({ name: "자료.bin", result: "failed", reason: "archive" })]);
  });

  it("이름이 .hwpx 면 선언 형식으로 한 번 더 해 보고, 그래도 비면 첫 이유(archive)를 남긴다", async () => {
    const { r, extractHwpx } = await readOne("공고.hwpx", "hwpx", bundle(), "");
    expect(extractHwpx).toHaveBeenCalledTimes(1);
    expect(r.files).toEqual([expect.objectContaining({ name: "공고.hwpx", result: "failed", reason: "archive" })]);
  });

  it("이름이 .hwpx 이고 선언 형식으로 글자가 나오면 읽은 것", async () => {
    const { r } = await readOne("공고.hwpx", "hwpx", bundle(), "HWPX_FROM_DECLARED");
    expect(r.text).toContain("HWPX_FROM_DECLARED");
    expect(r.files).toEqual([expect.objectContaining({ name: "공고.hwpx", result: "read", kind: "hwpx" })]);
  });

  it("zip 머리만 있는 깨진 바이트는 예전처럼 한글 추출기에 맡긴다", async () => {
    const junk = Buffer.from("PK\x03\x04garbage-bytes-here", "latin1");
    const read = await readOne("공고.hwpx", "hwpx", junk, "JUNK_OK");
    expect(read.extractHwpx).toHaveBeenCalledTimes(1);
    expect(read.r.files).toEqual([expect.objectContaining({ name: "공고.hwpx", result: "read", kind: "hwpx" })]);
    const empty = await readOne("공고.hwpx", "hwpx", junk, "");
    expect(empty.r.files).toEqual([expect.objectContaining({ name: "공고.hwpx", result: "failed", reason: "no_text" })]);
  });
});

describe("OLE 문서 — 최상위 줄기로 가린다", () => {
  it("옛 엑셀(BIFF8) — kind xls", async () => {
    const { r } = await readOne("예산.xls", "etc", xlsxOf({ 예산: { A1: "BIFF_BUDGET" } }, "biff8"));
    expect(r.text).toContain("## 예산");
    expect(r.text).toContain("BIFF_BUDGET");
    expect(r.files).toEqual([expect.objectContaining({ name: "예산.xls", result: "read", kind: "xls" })]);
  });

  it("옛 워드(.doc)는 failed·unsupported", async () => {
    const { r } = await readOne("공고.doc", "etc", oleOf(["WordDocument"]));
    expect(r.failedFiles).toEqual(["공고.doc"]);
    expect(r.text).toContain("[읽지 못한 첨부: 공고.doc]");
    expect(r.files).toEqual([expect.objectContaining({ name: "공고.doc", result: "failed", reason: "unsupported" })]);
  });

  it("옛 파워포인트(.ppt)는 failed·unsupported", async () => {
    const { r } = await readOne("발표.ppt", "etc", oleOf(["PowerPoint Document"]));
    expect(r.files).toEqual([expect.objectContaining({ name: "발표.ppt", result: "failed", reason: "unsupported" })]);
  });

  it("모르는 OLE 는 예전처럼 한글로 읽어 보고 못 읽으면 no_text", async () => {
    const { r } = await readOne("자료.hwp", "hwp", oleOf(["Foo"]));
    expect(r.files).toEqual([expect.objectContaining({ name: "자료.hwp", result: "failed", reason: "no_text" })]);
  });

  it("한글 미리보기만 있는 파일은 예전 그대로 read·preview_only·kind hwp", async () => {
    const { r } = await readOne("공고.hwp", "hwp", hwpPreviewOnly("미리보기 공고"));
    expect(r.readFiles).toEqual(["공고.hwp"]);
    expect(r.text).toContain("미리보기 공고");
    expect(r.files).toEqual([
      expect.objectContaining({ name: "공고.hwp", result: "read", reason: "preview_only", kind: "hwp" }),
    ]);
  });
});

it("새 이유 이름 — archive·unsupported·same_document 가 이유 목록에 있다(타입 검사)", () => {
  const reasons: AttachmentFileReason[] = ["archive", "unsupported", "same_document"];
  expect(reasons).toHaveLength(3);
});
