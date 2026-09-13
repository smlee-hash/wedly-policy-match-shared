import { describe, expect, it } from "vitest";
import { utils, write } from "cfb";
import { deflateRawSync, gzipSync } from "node:zlib";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { extractHwpText } from "./hwp-text";
import { extractPdfBytes, fetchAttachmentTexts, stripUnstorableChars } from "./attachment-text";

describe("HWP 첨부의 미리보기 뒤 본문", () => {
  it("미리보기에 없는 공식 신청기간 문단까지 첨부 입력으로 읽는다", async () => {
    const cfb=utils.cfb_new(); const header=Buffer.alloc(256);
    header.write("HWP Document File",0,"ascii");header[35]=5;
    const body=Buffer.from("지원사업 설명 ".repeat(180)+"\n신청기간: 2026-01-05 ~ 2026-01-20\n", "utf16le");
    const record=Buffer.alloc(4);record.writeUInt32LE(((body.length<<20)|0x43)>>>0,0);
    utils.cfb_add(cfb,"FileHeader",header);
    utils.cfb_add(cfb,"PrvText",Buffer.from("지원사업 설명 ".repeat(20),"utf16le"));
    utils.cfb_add(cfb,"BodyText/Section0",Buffer.concat([record,body]));
    const bytes=Buffer.from(write(cfb,{type:"buffer"}));
    const result=await fetchAttachmentTexts([{name:"모집공고.hwp",url:"https://www.bizinfo.go.kr/cmm/fms/fileDown.do?file=body.hwp",kind:"hwp"}],{fetch:async()=>new Response(Uint8Array.from(bytes)),extractHwpx:()=>""});
    expect(result.text).toContain("신청기간: 2026-01-05 ~ 2026-01-20");
    expect(result.failedFiles).toEqual([]);
  });
});

function reviewedHwpFixture(section: Buffer, flags = 0): Buffer {
  const cfb=utils.cfb_new(); const header=Buffer.alloc(256);
  header.write("HWP Document File",0,"ascii");header[35]=5;header.writeUInt32LE(flags,36);
  utils.cfb_add(cfb,"FileHeader",header);
  utils.cfb_add(cfb,"PrvText",Buffer.from("미리보기만 있는 공고", "utf16le"));
  utils.cfb_add(cfb,"BodyText/Section0",section);
  return Buffer.from(write(cfb,{type:"buffer"}));
}
function reviewedParagraph(text: string): Buffer {
  const bytes=Buffer.from(text,"utf16le");const header=Buffer.alloc(4);
  header.writeUInt32LE(((bytes.length<<20)|0x43)>>>0);
  return Buffer.concat([header,bytes]);
}
describe("HWP 독립 검토에서 확인한 불완전 본문",()=>{
  it("보호 문서의 미리보기를 보존하되 저장 후에도 미확인 표시를 복원할 수 있다",async()=>{
    const bytes=reviewedHwpFixture(reviewedParagraph("본문의 신청 조건"),2);
    const result=await fetchAttachmentTexts([{name:"보호공고.hwp",url:"https://www.bizinfo.go.kr/cmm/fms/fileDown.do?file=review.hwp",kind:"hwp"}],{fetch:async()=>new Response(Uint8Array.from(bytes)),extractHwpx:()=>""});
    expect(result.text).toContain("미리보기만 있는 공고");
    expect(result.skippedFiles).toContain("보호공고.hwp");
    expect(result).toMatchObject({ previewOnlyFiles: ["보호공고.hwp"] });
    expect(result.text).toContain("[미확인 첨부: 보호공고.hwp]");
  });
  it("CFB가 선언한 Section 길이보다 실제 공급된 바이트가 짧으면 부분 본문을 거절한다",()=>{
    const bytes=reviewedHwpFixture(reviewedParagraph("앞부분만"));
    const entry=bytes.indexOf(Buffer.from("Section0\0","utf16le"));
    expect(entry).toBeGreaterThan(0);bytes.writeUInt32LE(1000,entry+120);
    expect(extractHwpText(bytes)).toBe("");
  });
  it.each([Buffer.from([1,2,3,4]),deflateRawSync(reviewedParagraph("둘째 압축"))])("첫 DEFLATE 뒤에 소비하지 않은 바이트가 있으면 부분 본문을 거절한다",trailing=>{
    const section=Buffer.concat([deflateRawSync(reviewedParagraph("압축 앞부분")),trailing]);
    expect(extractHwpText(reviewedHwpFixture(section,1))).toBe("");
  });
});

describe("실제 HWP의 검증 가능한 압축 꼬리와 미리보기 표시",()=>{
  it("실제 공고처럼 DEFLATE 뒤에 CRC32와 원래 길이가 있으면 검증 후 본문을 읽는다",()=>{
    const gzip=gzipSync(reviewedParagraph("검증 가능한 본문"));
    expect(extractHwpText(reviewedHwpFixture(gzip.subarray(10),1))).toBe("검증 가능한 본문");
  });
  it.each(["crc","length","extra"])("압축 꼬리 %s가 일치하지 않으면 거절한다",part=>{
    let raw=Buffer.from(gzipSync(reviewedParagraph("본문")).subarray(10));
    if(part==="extra")raw=Buffer.concat([raw,Buffer.from([0])]);
    else raw[raw.length-(part==="crc"?8:4)]^=1;
    expect(extractHwpText(reviewedHwpFixture(raw,1))).toBe("");
  });
  it.each([1014,1015,1020,1025,1030])("글자 상한 %i에서도 저장한 글자에 미확인 표식이 남는다",async cap=>{
    const cfb=utils.cfb_new();const header=Buffer.alloc(256);header.write("HWP Document File",0,"ascii");header[35]=5;header.writeUInt32LE(2,36);utils.cfb_add(cfb,"FileHeader",header);utils.cfb_add(cfb,"PrvText",Buffer.from("가".repeat(1000),"utf16le"));const bytes=Buffer.from(write(cfb,{type:"buffer"}));
    const r=await fetchAttachmentTexts([{name:"부분.hwp",url:"https://www.bizinfo.go.kr/review.hwp",kind:"hwp"}],{fetch:async()=>new Response(Uint8Array.from(bytes)),extractHwpx:()=>"",totalCharCap:cap});
    expect(r.text.length).toBeLessThanOrEqual(cap);
    expect(r.skippedFiles).toContain("부분.hwp");
    expect(r.text).toMatch(/\[(미확인 첨부|첨부 잘림): 부분\.hwp\]/);
  });
});


it("자동 저장 모드는 HWP 미리보기 글자를 빼고 미확인 표식만 돌려준다", async () => {
  const bytes = reviewedHwpFixture(reviewedParagraph("보호된 본문"), 2);
  const r = await fetchAttachmentTexts([{ name: "protected.hwp", url: "https://www.bizinfo.go.kr/protected.hwp", kind: "hwp" }], { fetch: async () => new Response(Uint8Array.from(bytes)), extractHwpx: () => "", includeHwpPreview: false });
  expect(r.text).not.toContain("미리보기만 있는 공고");
  expect(r.text).toContain("[미확인 첨부: protected.hwp]");
  expect(r.readFiles).toEqual([]);
  expect(r.previewOnlyFiles).toEqual(["protected.hwp"]);
  expect(r.skippedFiles).toEqual(["protected.hwp"]);
  expect(r.bodyTextChars).toBe(0);
});

const BIZ = "https://www.bizinfo.go.kr/cmm/fms/fileDown.do?file=";

async function makePdfLine(text: string, width = 2_400): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([width, 240]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText(text, { x: 24, y: 120, size: 10, font });
  return Buffer.from(await doc.save());
}

function okBuf(buf: Buffer): Response {
  return new Response(Uint8Array.from(buf));
}

describe("실제 PDF와 보호 CFB HWP의 본문 글자 수·잘림 출처", () => {
  it("149자 PDF 본문에 미확인 HWP 표식을 더해 211자가 되어도 본문 글자 수는 149다", async () => {
    const pdfName = "notice.pdf";
    const hwpName = "protected.hwp";
    const pdf = await makePdfLine("A".repeat(149));
    const extracted = stripUnstorableChars(await extractPdfBytes(Uint8Array.from(pdf))).trim();
    expect(extracted.length).toBe(149);
    const hwp = reviewedHwpFixture(reviewedParagraph("보호된 본문"), 2);
    const r = await fetchAttachmentTexts(
      [
        { name: pdfName, url: `${BIZ}${pdfName}`, kind: "pdf" },
        { name: hwpName, url: `${BIZ}${hwpName}`, kind: "hwp" },
      ],
      {
        maxFiles: 2,
        includeHwpPreview: false,
        extractHwpx: () => "",
        fetch: async (url) => (url.includes(pdfName) ? okBuf(pdf) : okBuf(hwp)),
      },
    );
    expect(r.bodyTextChars).toBe(149);
    expect(r.text.length).toBe(211);
    expect(r.bodyTextChars).toBeLessThan(200);
    expect(r.text.length).toBeGreaterThan(200);
    expect(r.readFiles).toEqual([pdfName]);
    expect(r.previewOnlyFiles).toEqual([hwpName]);
    expect(r.skippedFiles).toEqual([hwpName]);
    expect(r.text).toContain(extracted);
    expect(r.text).toContain(`[미확인 첨부: ${hwpName}]`);
    expect(r.text).not.toContain("미리보기만 있는 공고");
    expect(r.text).not.toContain("[첨부 잘림:");
  });

  it("충분한 PDF와 보호 HWP를 함께 두면 PDF 본문은 남고 미리보기 글자는 빼다", async () => {
    const pdfName = "notice.pdf";
    const hwpName = "protected.hwp";
    const payload = `KEEP_BODY_${"B".repeat(240)}`;
    const pdf = await makePdfLine(payload, 4_000);
    const extracted = stripUnstorableChars(await extractPdfBytes(Uint8Array.from(pdf))).trim();
    expect(extracted.length).toBeGreaterThanOrEqual(200);
    const hwp = reviewedHwpFixture(reviewedParagraph("보호된 본문"), 2);
    const r = await fetchAttachmentTexts(
      [
        { name: pdfName, url: `${BIZ}${pdfName}`, kind: "pdf" },
        { name: hwpName, url: `${BIZ}${hwpName}`, kind: "hwp" },
      ],
      {
        maxFiles: 2,
        includeHwpPreview: false,
        extractHwpx: () => "",
        fetch: async (url) => (url.includes(pdfName) ? okBuf(pdf) : okBuf(hwp)),
      },
    );
    expect(r.bodyTextChars).toBe(extracted.length);
    expect(r.text).toContain(extracted);
    expect(r.text).not.toContain("미리보기만 있는 공고");
    expect(r.skippedFiles).toEqual([hwpName]);
    expect(r.readFiles).toEqual([pdfName]);
    expect(r.previewOnlyFiles).toEqual([hwpName]);
  });

  it("상한 직전 11980자 PDF에 HWP 표식을 붙이면 잘린 PDF 이름을 남긴다", async () => {
    const pdfName = "notice.pdf";
    const hwpName = "protected.hwp";
    const payloadChars = 11_980 - `[첨부: ${pdfName}]\n`.length;
    const pdf = await makePdfLine("Z".repeat(payloadChars - "EXCLUSION_TAIL".length) + "EXCLUSION_TAIL", 100_000);
    const hwp = reviewedHwpFixture(reviewedParagraph("보호된 본문"), 2);
    const pdfOnly = await fetchAttachmentTexts(
      [{ name: pdfName, url: `${BIZ}${pdfName}`, kind: "pdf" }],
      { totalCharCap: 12_000, includeHwpPreview: false, extractHwpx: () => "", fetch: async () => okBuf(pdf) },
    );
    expect(pdfOnly.text.length).toBe(11_980);
    expect(pdfOnly.text).toContain("EXCLUSION_TAIL");
    expect(pdfOnly.bodyTextChars).toBeGreaterThan(0);
    expect(pdfOnly.skippedFiles).toEqual([]);

    const mixed = await fetchAttachmentTexts(
      [
        { name: pdfName, url: `${BIZ}${pdfName}`, kind: "pdf" },
        { name: hwpName, url: `${BIZ}${hwpName}`, kind: "hwp" },
      ],
      {
        maxFiles: 2,
        totalCharCap: 12_000,
        includeHwpPreview: false,
        extractHwpx: () => "",
        fetch: async (url) => (url.includes(pdfName) ? okBuf(pdf) : okBuf(hwp)),
      },
    );
    expect(mixed.text.length).toBeLessThanOrEqual(12_000);
    expect(mixed.text).not.toContain("EXCLUSION_TAIL");
    expect(mixed.skippedFiles).toContain(pdfName);
    expect(mixed.skippedFiles).toContain(hwpName);
    expect(mixed.text).toContain(`[첨부 잘림: ${pdfName}]`);
    expect(mixed.text).toContain(`[미확인 첨부: ${hwpName}]`);
    expect(mixed.bodyTextChars).toBeLessThan(pdfOnly.bodyTextChars ?? 0);
    expect(mixed.bodyTextChars).toBeGreaterThan(0);
    expect(mixed.readFiles).toEqual([pdfName]);
    expect(mixed.previewOnlyFiles).toEqual([hwpName]);
  });

  it("기본 미리보기 모드에서는 미리보기 글자를 남기고 bodyTextChars를 붙이지 않는다", async () => {
    const pdfName = "notice.pdf";
    const hwpName = "protected.hwp";
    const pdf = await makePdfLine("PREVIEW_MODE_PDF");
    const hwp = reviewedHwpFixture(reviewedParagraph("보호된 본문"), 2);
    const r = await fetchAttachmentTexts(
      [
        { name: pdfName, url: `${BIZ}${pdfName}`, kind: "pdf" },
        { name: hwpName, url: `${BIZ}${hwpName}`, kind: "hwp" },
      ],
      {
        maxFiles: 2,
        extractHwpx: () => "",
        fetch: async (url) => (url.includes(pdfName) ? okBuf(pdf) : okBuf(hwp)),
      },
    );
    expect(r.bodyTextChars).toBeUndefined();
    expect(r.text).toContain("PREVIEW_MODE_PDF");
    expect(r.text).toContain("미리보기만 있는 공고");
    expect(r.previewOnlyFiles).toEqual([hwpName]);
    expect(r.skippedFiles).toEqual([hwpName]);
  });
});
