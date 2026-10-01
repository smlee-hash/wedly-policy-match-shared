import { describe, expect, it } from "vitest";

import { attributeOf, decodeAttributeValue, parseHtml } from "./html";

/**
 * 속성 값(href·onclick)의 문자 참조를 **브라우저가 속성에서 푸는 방식**으로 푼다(HTML 표준
 * 「character reference in attribute」). 2026-10-01 운영 실측:
 *
 * 쪽 HTML 의 `href="/fileDownload?…&fileId=9&paramMenuId=MENU…"` 를 브라우저는 그대로 연다.
 * 그런데 수확기가 쓰던 `getAttribute` 는 속성 값을 **본문 글자처럼** 풀어서, 세미콜론 없는 옛 이름
 * `&para` 를 「¶」로 바꿨다 → `fileId=9¶mMenuId=…` → 저장 주소 `%C2%B6mMenuId=` →
 * 파일 대신 오류 화면. 보건산업진흥원 352건·에너지기술평가원 217건이 이 꼴이었다.
 *
 * 표준 규칙: 세미콜론 없는 옛 이름(`&para`·`&not`·`&sect`·`&curren`·`&copy`·`&reg`·`&times`…) 바로 뒤에
 * `=` 나 영문·숫자가 오면 **속성 안에서는 풀지 않는다.** 나머지는 본문과 똑같이 한 번만 푼다.
 * 기대값은 표준을 그대로 구현한 `he` 의 속성 모드 결과를 하나하나 대조해 적었다(he 를 직접 쓰지는 않는다 —
 * 공용 패키지의 직접 의존성이 아니다).
 */
describe("decodeAttributeValue — 속성 안의 문자 참조", () => {
  const cases: [string, string][] = [
    // 옛 이름 + 영문·숫자·= → 그대로(이번 결함의 핵심)
    ["a=1&paramMenuId=2", "a=1&paramMenuId=2"],
    ["a=1&para=2", "a=1&para=2"],
    ["/x?a=1&notice_id=2", "/x?a=1&notice_id=2"],
    ["/x?a=1&currentPage=3", "/x?a=1&currentPage=3"],
    ["/x?a=1&section=2", "/x?a=1&section=2"],
    ["/x?a=1&regNo=RGS_1", "/x?a=1&regNo=RGS_1"],
    ["&copy=1", "&copy=1"],
    ["&times=1", "&times=1"],
    ["&AMP=1", "&AMP=1"],
    ["&ampid=1", "&ampid=1"],
    ["&gtype=1", "&gtype=1"],
    ["&lt3", "&lt3"],
    ["&notit", "&notit"],
    ["&notinx;", "&notinx;"],
    ["&middotA", "&middotA"],
    ["&nbspx", "&nbspx"],
    ["&sup2=1", "&sup2=1"],
    ["&frac12x", "&frac12x"],
    ["&eacutee", "&eacutee"],
    ["&GTx", "&GTx"],
    ["&&para=1", "&&para=1"],
    ["&paraMenu&notice=1&amp;x=1", "&paraMenu&notice=1&x=1"],
    // 세미콜론이 있거나 뒤가 영문·숫자·= 가 아니면 본문처럼 푼다
    ["&para;", "¶"],
    ["&para x", "¶ x"],
    ["&para", "¶"],
    ["&para-1", "¶-1"],
    ["&reg_id=1", "®_id=1"],
    ["&copy;2026", "©2026"],
    ["&not;x", "¬x"],
    ["&para;mMenuId=1", "¶mMenuId=1"],
    ["&nbsp;x", " x"],
    ["&eacute;e", "ée"],
    ["&lt;&gt", "<>"],
    ["&gt", ">"],
    ["&GT", ">"],
    ["&amp", "&"],
    // 옛 이름으로 시작하는 **더 긴 진짜 이름**(세미콜론까지)은 그 이름으로 푼다
    ["&notin;", "∉"],
    ["&timesb;", "⊠"],
    ["&parallel;", "∥"],
    // 한 번만 푼다(풀린 & 뒤를 다시 이름으로 읽지 않는다)
    ["/x?a=1&amp;notice=1", "/x?a=1&notice=1"],
    ["&amp;amp;", "&amp;"],
    ["&#38;para=1", "&para=1"],
    // 숫자 참조·흔한 이름
    ["&amp;&lt;&#39;&#x26;", "&<'&"],
    ["&#38;b", "&b"],
    ["&#x41;&#66;", "AB"],
    ["&quot;x&quot;", '"x"'],
    // 이름이 아니거나 모르는 글자는 그대로
    ["&Para=1", "&Para=1"],
    ["&ParaX=1", "&ParaX=1"],
    ["&lang=ko", "&lang=ko"],
    ["&am&para=1", "&am&para=1"],
    ["& para=1", "& para=1"],
    ["x&", "x&"],
    ["&#", "&#"],
    ["&;", "&;"],
    ["", ""],
    ["/a/b.pdf?x=1&y=2", "/a/b.pdf?x=1&y=2"],
    ["javascript:fn_egov_downFile('FILE_1','0')", "javascript:fn_egov_downFile('FILE_1','0')"],
  ];
  it.each(cases)("%j → %j", (raw, want) => {
    expect(decodeAttributeValue(raw)).toBe(want);
  });
});

describe("attributeOf — 요소의 속성 값을 속성 방식으로", () => {
  it("href 의 `&paramMenuId` 를 그대로 둔다(getAttribute 는 「¶」로 바꾼다)", () => {
    const a = parseHtml(`<a href="/fileDownload?fileId=9&paramMenuId=MENU001">공고.hwp</a>`).querySelector("a")!;
    expect(attributeOf(a, "href")).toBe("/fileDownload?fileId=9&paramMenuId=MENU001");
  });

  it("이름 대소문자를 가리지 않는다(HREF·onClick)", () => {
    const a = parseHtml(
      `<a HREF="/download?a=1&notice=2" onClick="autoRchk('/download?b=1&section=3')">x</a>`,
    ).querySelector("a")!;
    expect(attributeOf(a, "href")).toBe("/download?a=1&notice=2");
    expect(attributeOf(a, "onclick")).toBe("autoRchk('/download?b=1&section=3')");
  });

  it("작은따옴표 값·진짜 참조(&amp;·&#39;)는 한 번 푼다", () => {
    const a = parseHtml(
      `<a href='/download?a=1&amp;b=2' onclick="go(&#39;x&#39;)">x</a>`,
    ).querySelector("a")!;
    expect(attributeOf(a, "href")).toBe("/download?a=1&b=2");
    expect(attributeOf(a, "onclick")).toBe("go('x')");
  });

  it("값 없는 속성·없는 속성은 빈 글자", () => {
    const a = parseHtml(`<a href>x</a>`).querySelector("a")!;
    expect(attributeOf(a, "href")).toBe("");
    expect(attributeOf(a, "onclick")).toBe("");
  });
});
