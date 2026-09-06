import { describe, expect, it } from "vitest";
import { encodeAttachmentHref } from "./attachment-url";

/**
 * 충북테크노파크 첨부 주소의 파일 이름은 **euc-kr 로 인코딩해야** 파일이 온다.
 * 2026-09-06 curl 실측(`no=307`):
 * · UTF-8  `…&file=%EB%B6%99%EC%9E%84…` → 200 `text/html` 452바이트(「파일이 존재하지 않습니다」)
 * · euc-kr `…&file=%BA%D9%C0%D31.%20…` → 200 `attachment` + PDF 799,373바이트(`%PDF-1.6`)
 */
describe("첨부 주소 글자 인코딩 — euc-kr 게시판", () => {
  it("날 한글 파일 이름을 euc-kr 퍼센트 표기로 바꾼다(실측한 그 바이트)", () => {
    const href = "/index.php?control=util&task=down&no=307&file=붙임2. 사업 신청서.zip";
    expect(encodeAttachmentHref(href, "euc-kr")).toBe(
      "/index.php?control=util&task=down&no=307&file=%BA%D9%C0%D32. %BB%E7%BE%F7 %BD%C5%C3%BB%BC%AD.zip",
    );
  });

  it("ASCII 는 손대지 않는다 — 빈 칸·구분자는 절대화(new URL)가 알아서 %20 으로 바꾼다", () => {
    const href = "/index.php?a=1&b=two three.pdf";
    expect(encodeAttachmentHref(href, "euc-kr")).toBe(href);
  });

  it("★이미 euc-kr 로 인코딩된 href 는 그대로 둔다 — 올바른 UTF-8 이 아니라 손대지 않는다", () => {
    const euckr = "/down.php?file=%BA%D9%C0%D31.pdf";
    expect(encodeAttachmentHref(euckr, "euc-kr")).toBe(euckr);
  });

  /**
   * 사이트가 링크를 **미리 UTF-8 로** 인코딩해 내보내는 날(독립 리뷰 5번) — 충북TP 서버는
   * 그 주소에 452바이트 「파일 없음」을 준다. 날 한글일 때와 똑같이 euc-kr 로 다시 인코딩한다.
   */
  it("★euc-kr 게시판인데 href 가 UTF-8 퍼센트 인코딩이면 euc-kr 로 다시 인코딩한다", () => {
    expect(encodeAttachmentHref("/down.php?file=%EB%B6%99%EC%9E%841.pdf", "euc-kr")).toBe(
      "/down.php?file=%BA%D9%C0%D31.pdf",
    );
  });

  it("utf-8 게시판은 UTF-8 퍼센트 인코딩을 그대로 둔다", () => {
    const utf8 = "/down.php?file=%EB%B6%99%EC%9E%841.pdf";
    expect(encodeAttachmentHref(utf8, "utf-8")).toBe(utf8);
  });

  it("한글·한자가 아닌 퍼센트열은 안 건드린다 — 우연히 UTF-8 로 읽히는 euc-kr 두 바이트 방어", () => {
    // %C7%D0 은 euc-kr 「학」이지만 UTF-8 로도 올바른 U+01D0(ǐ)이다. 한글이 아니라 그대로 둔다.
    expect(encodeAttachmentHref("/down.php?file=%C7%D0.pdf", "euc-kr")).toBe("/down.php?file=%C7%D0.pdf");
    // 공백·괄호 같은 ASCII 퍼센트열도 그대로.
    expect(encodeAttachmentHref("/down.php?file=a%20b%28c%29.pdf", "euc-kr")).toBe("/down.php?file=a%20b%28c%29.pdf");
  });

  it("utf-8 게시판·설정 없음은 한 글자도 안 바꾼다", () => {
    const href = "/down.php?file=공고문.pdf";
    expect(encodeAttachmentHref(href, "utf-8")).toBe(href);
    expect(encodeAttachmentHref(href, undefined)).toBe(href);
  });

  it("euc-kr 이 못 담는 글자가 하나라도 있으면 **통째로** 예전 그대로 둔다(반쪽 주소 금지)", () => {
    // 이모지는 euc-kr 에 없다 — iconv 가 조용히 `?` 로 바꾸는 자리를 잡아낸다.
    const href = "/down.php?file=공고문🎉.pdf";
    expect(encodeAttachmentHref(href, "euc-kr")).toBe(href);
  });

  it("빈 글자는 그대로", () => {
    expect(encodeAttachmentHref("", "euc-kr")).toBe("");
  });
});
