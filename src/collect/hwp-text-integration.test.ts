import { describe, expect, it } from "vitest";
import { utils, write } from "cfb";
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
