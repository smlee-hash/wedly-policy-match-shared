import { describe, expect, it } from "vitest";
import { utils, write } from "cfb";
import { deflateRawSync } from "node:zlib";
import { extractHwpText } from "./hwp-text";
import { fetchAttachmentTexts } from "./attachment-text";

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
    const result=await fetchAttachmentTexts([{name:"모집공고.hwp",url:"https://www.bizinfo.go.kr/cmm/fms/fileDown.do?file=body.hwp",kind:"hwp"}],{fetch:async()=>new Response(bytes),extractHwpx:()=>""});
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
    const result=await fetchAttachmentTexts([{name:"보호공고.hwp",url:"https://www.bizinfo.go.kr/cmm/fms/fileDown.do?file=review.hwp",kind:"hwp"}],{fetch:async()=>new Response(bytes),extractHwpx:()=>""});
    expect(result.text).toContain("미리보기만 있는 공고");
    expect(result.skippedFiles).toContain("보호공고.hwp");
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
