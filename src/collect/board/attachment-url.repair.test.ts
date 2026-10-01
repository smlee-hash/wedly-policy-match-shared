import { describe, expect, it } from "vitest";

import { repairStoredAttachmentUrl } from "./attachment-url";

/**
 * 이미 저장된 첨부 주소를 **읽을 때** 되살린다(2026-10-01 운영 실측).
 *
 * 1) 물음표 뒤 `&paramMenuId=` 의 `&para` 가 옛 수확기에서 「¶」로 풀려 `%C2%B6mMenuId=` 로
 *    굳어 있다 — 보건산업진흥원(khidi) 352건·에너지기술평가원(ketep) 217건. 본문이 이미 찬 줄은
 *    상세를 다시 읽지 않으므로(채움이 「빈 본문」에서만 돈다) 수확기만 고쳐서는 안 돌아온다.
 * 2) 용인시산업진흥원(ybs.ypa.or.kr)은 eGov 표준 경로 `/cmm/fms/FileDown.do` 가 200 + 0바이트이고,
 *    쪽 스크립트의 실제 경로 `/FileDown.do` 만 파일을 준다(같은 열쇠로 71,098바이트).
 */
describe("repairStoredAttachmentUrl", () => {
  it("khidi: 물음표 뒤 `%C2%B6mMenuId=` 를 `&paramMenuId=` 로 되돌린다", () => {
    expect(
      repairStoredAttachmentUrl(
        "https://www.khidi.or.kr/fileDownload?titleId=531733&fileId=1&fileDownType=C%C2%B6mMenuId=MENU01108",
      ),
    ).toBe("https://www.khidi.or.kr/fileDownload?titleId=531733&fileId=1&fileDownType=C&paramMenuId=MENU01108");
  });

  it("ketep: 운영에 저장된 주소 그대로를 되돌린다", () => {
    expect(
      repairStoredAttachmentUrl(
        "https://www.ketep.re.kr/fileDownload?fileKey=29gvT85lmw&fileId=9%C2%B6mMenuId=MENU001021100000000",
      ),
    ).toBe("https://www.ketep.re.kr/fileDownload?fileKey=29gvT85lmw&fileId=9&paramMenuId=MENU001021100000000");
  });

  it("인코딩 안 된 「¶」·소문자 `%c2%b6`·`¶=`(원래 `&para=`)도 되돌린다", () => {
    expect(repairStoredAttachmentUrl("https://www.example.or.kr/down?a=1¶mMenuId=2")).toBe(
      "https://www.example.or.kr/down?a=1&paramMenuId=2",
    );
    expect(repairStoredAttachmentUrl("https://www.example.or.kr/down?a=1%c2%b6mMenuId=2")).toBe(
      "https://www.example.or.kr/down?a=1&paramMenuId=2",
    );
    expect(repairStoredAttachmentUrl("https://www.example.or.kr/down?a=1%C2%B6=2")).toBe(
      "https://www.example.or.kr/down?a=1&para=2",
    );
  });

  it("한 주소에 여러 번 있으면 모두 되돌린다", () => {
    expect(
      repairStoredAttachmentUrl("https://www.example.or.kr/down?x=1%C2%B6mA=1%C2%B6mB=2"),
    ).toBe("https://www.example.or.kr/down?x=1&paramA=1&paramB=2");
  });

  /**
   * `%C2%B6` 은 euc-kr 파일 이름의 한 조각일 수도 있다 — 뒤에 「영문·숫자·밑줄 … =」가 이어질 때만
   * 매개변수 이름으로 본다. 그 밖은 한 글자도 안 바꾼다.
   */
  it("뒤에 「영문·숫자·밑줄 … =」가 오지 않으면 그대로 둔다(파일 이름 조각)", () => {
    const untouched = [
      // 충북TP euc-kr 이름: 바이트 경계가 %BF%C2 | %B6%F3 라 `%C2%B6` 이 가운데 걸친다.
      "https://www.cbtp.or.kr/index.php?control=bbs&board_id=saup_notice&file=%BF%C2%B6%F3%C0%CE.hwp",
      "https://www.example.or.kr/down?file=%C2%B6",
      "https://www.example.or.kr/down?file=%C2%B6%20a.hwp",
      "https://www.example.or.kr/down?file=%C2%B6.hwp",
      "https://www.example.or.kr/down?file=%C2%B61&x=1",
      "https://www.example.or.kr/down?file=%C2%B6abc.hwp&x=1",
    ];
    for (const u of untouched) expect(repairStoredAttachmentUrl(u)).toBe(u);
  });

  it("물음표 앞(경로)의 ¶ 는 건드리지 않는다", () => {
    const u = "https://www.example.or.kr/files/a%C2%B6mMenuId=1/b.pdf";
    expect(repairStoredAttachmentUrl(u)).toBe(u);
    const v = "https://www.example.or.kr/files/a%C2%B6mMenuId=1/b.pdf?x=1";
    expect(repairStoredAttachmentUrl(v)).toBe(v);
  });

  it("ypa: eGov 표준 경로를 그 사이트의 실제 경로 `/FileDown.do` 로 바꾼다(https·http)", () => {
    expect(
      repairStoredAttachmentUrl(
        "https://ybs.ypa.or.kr/cmm/fms/FileDown.do?atchFileId=FILE_000000000230380&fileSn=2",
      ),
    ).toBe("https://ybs.ypa.or.kr/FileDown.do?atchFileId=FILE_000000000230380&fileSn=2");
    expect(
      repairStoredAttachmentUrl("http://ybs.ypa.or.kr/cmm/fms/FileDown.do?atchFileId=FILE_000000000230380&fileSn=0"),
    ).toBe("http://ybs.ypa.or.kr/FileDown.do?atchFileId=FILE_000000000230380&fileSn=0");
  });

  it("다른 호스트의 eGov 경로·비슷한 이름은 그대로 둔다", () => {
    const untouched = [
      "https://www.gbtp.or.kr/cmm/fms/FileDown.do?atchFileId=FILE_000000000012345&fileSn=0",
      "https://ybs.ypa.or.kr.evil.example/cmm/fms/FileDown.do?atchFileId=FILE_1&fileSn=0",
      "https://www.ypa.or.kr/cmm/fms/FileDown.do?atchFileId=FILE_1&fileSn=0",
      "https://ybs.ypa.or.kr/cmm/fms/FileDown.doc?atchFileId=FILE_1&fileSn=0",
      "https://ybs.ypa.or.kr/FileDown.do?atchFileId=FILE_1&fileSn=0",
    ];
    for (const u of untouched) expect(repairStoredAttachmentUrl(u)).toBe(u);
  });

  it("두 번 고쳐도 같다(멱등)", () => {
    const samples = [
      "https://www.khidi.or.kr/fileDownload?titleId=531733&fileId=1&fileDownType=C%C2%B6mMenuId=MENU01108",
      "https://ybs.ypa.or.kr/cmm/fms/FileDown.do?atchFileId=FILE_000000000230380&fileSn=2",
      "https://www.example.or.kr/down?a=1%C2%B6=2",
    ];
    for (const s of samples) {
      const once = repairStoredAttachmentUrl(s);
      expect(repairStoredAttachmentUrl(once)).toBe(once);
    }
  });

  it("고칠 것이 없으면 받은 글자 그대로 돌려준다", () => {
    const untouched = [
      "",
      "/relative/down?a=1",
      "https://www.djtp.or.kr/files/a.pdf",
      "https://www.khidi.or.kr/fileDownload?titleId=531733&fileId=1&fileDownType=C&paramMenuId=MENU01108",
      "javascript:void(0)",
      "  https://www.example.or.kr/a.pdf  ",
    ];
    for (const u of untouched) expect(repairStoredAttachmentUrl(u)).toBe(u);
  });
});
