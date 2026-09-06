import { describe, it, expect } from "vitest";
import { decodeBody, parseHtml, absolutize, normalizeDateText } from "./html";

describe("board html", () => {
  it("euc-kr 바이트를 한글로 디코딩한다", () => {
    // '가' = EUC-KR 0xB0A1
    const buf = new Uint8Array([0xb0, 0xa1]);
    expect(decodeBody(buf.buffer, "euc-kr")).toBe("가");
  });
  it("utf-8 기본 디코딩", () => {
    const buf = new TextEncoder().encode("나라");
    expect(decodeBody(buf.buffer, undefined)).toBe("나라");
  });
  it("행에서 selector 로 텍스트를 뽑는다", () => {
    const root = parseHtml("<table><tr><td class='t'><a href='/v?id=7'>제목A</a></td></tr></table>");
    const row = root.querySelectorAll("tr")[0];
    expect(row.querySelector("td.t a")?.text.trim()).toBe("제목A");
    expect(row.querySelector("a")?.getAttribute("href")).toBe("/v?id=7");
  });
  it("상대 링크를 절대 주소로 만든다", () => {
    expect(absolutize("/v?id=7", "https://a.kr/board/")).toBe("https://a.kr/v?id=7");
    expect(absolutize("https://x.kr/z", "https://a.kr/")).toBe("https://x.kr/z");
  });
  it("닫히지 않은 tr 이 있는 표도 table tbody 행을 복구한다", () => {
    const html = `<table class="w-100"><tbody>
<tr><td class="text-left"><a href="a">공고1</a></td>
<tr><td class="text-left"><a href="b">공고2</a></td>
<tr><td class="text-left"><a href="c">공고3</a></td>
</tbody></table>`;
    const root = parseHtml(html);
    expect(root.querySelectorAll("table.w-100 tbody tr").length).toBe(3);
  });
});

describe("normalizeDateText", () => {
  it("점 구분 날짜를 YYYY-MM-DD 로 바꾼다", () => {
    expect(normalizeDateText("2026.08.26")).toBe("2026-08-26");
  });
  it("빗금 구분 날짜를 YYYY-MM-DD 로 바꾼다", () => {
    expect(normalizeDateText("2026/08/14")).toBe("2026-08-14");
  });
  it("한국어 날짜를 0채움 YYYY-MM-DD 로 바꾼다", () => {
    expect(normalizeDateText("2026년 8월 26일")).toBe("2026-08-26");
  });
  it("범위 문자열 안의 여러 날짜를 각각 변환한다", () => {
    expect(normalizeDateText("2026.08.26 ~ 2026.09.04")).toBe("2026-08-26 ~ 2026-09-04");
    expect(normalizeDateText("2026/08/14~2026/09/02")).toBe("2026-08-14~2026-09-02");
    expect(normalizeDateText("2026년 8월 26일  0시 ~ 2026년 9월 11일  23시"))
      .toBe("2026-08-26  0시 ~ 2026-09-11  23시");
  });
  it("하이픈 비패딩 날짜도 YYYY-MM-DD 로 바꾼다", () => {
    expect(normalizeDateText("2026-8-1")).toBe("2026-08-01");
    expect(normalizeDateText("2026-8-1 ~ 2026-9-4")).toBe("2026-08-01 ~ 2026-09-04");
  });
  it("숫자 경계 밖 버전 문자열은 날짜로 바꾸지 않는다", () => {
    expect(normalizeDateText("v2026.8.261")).toBe("v2026.8.261");
    expect(normalizeDateText("12026-8-1")).toBe("12026-8-1");
  });
});
