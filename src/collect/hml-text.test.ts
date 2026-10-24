import { readFileSync } from "node:fs";
import { join } from "node:path";
import iconv from "iconv-lite";
import { describe, expect, it } from "vitest";
import { extractHmlText } from "./hml-text";

/**
 * HML(한글 XML 문서, `<HWPML>`) 본문 글자 뽑기(2026-10-01 「첨부파일 글자 추출 누락」 3번).
 *
 * 운영 실측: 해양수산부 첨부 198개가 `.hml` 이라 형식을 몰라 하나도 못 읽었다. HML 은 XML 이고
 * 본문 글자는 `<BODY>` 안 `<CHAR>` 에만 있다. 머리(`<HEAD>` — 문서 요약·글꼴·모양)·꼬리(`<TAIL>` — 그림 바이트)는 버린다.
 *  · `</P>` → 줄, `<TAB/>` → 탭, `<LINEBREAK/>` → 줄, `<FWSPACE/>`·`<HWSPACE/>`·`<NBSPACE/>` → 띄어쓰기
 *  · XML 표기(`&lt;`·`&#54620;` 등 다섯 이름과 숫자)만 푼다. DOCTYPE 의 ENTITY 는 펼치지 않는다(바깥 파일 읽기 막기).
 *  · 줄 끝 공백을 지우고 빈 줄은 둘까지만, 앞뒤 빈칸을 뗀다.
 * 바깥 파서를 쓰지 않고 한 번 훑는 선형 시간 — 일부러 만든 나쁜 파일도 몇 초 안에 끝난다.
 */

const DECL = '<?xml version="1.0" encoding="UTF-8" standalone="no" ?>';
const HEAD = '<HEAD SecCnt="1"><DOCSUMMARY><TITLE><CHAR>머리 비밀</CHAR></TITLE></DOCSUMMARY></HEAD>';
const TAIL = '<TAIL><BINDATASTORAGE><BINDATA Id="1">QUJD</BINDATA></BINDATASTORAGE><CHAR>꼬리 비밀</CHAR></TAIL>';

function hml(body: string, decl = DECL): string {
  return `${decl}<HWPML Version="2.8" SubVersion="8.0.0.0" Style="embed">${HEAD}<BODY><SECTION Id="0">${body}</SECTION></BODY>${TAIL}</HWPML>`;
}

const SYNTHETIC_BODY =
  '<P ParaShape="0" Style="0"><TEXT CharShape="0"><CHAR>첫 줄</CHAR><CHAR>이어짐</CHAR></TEXT></P>\n' +
  "<P><TEXT><CHAR>가<TAB/>나<LINEBREAK/>다<FWSPACE/>라<HWSPACE/>마<NBSPACE/>바</CHAR></TEXT></P>\n" +
  "<P><TEXT><CHAR/></TEXT></P>\n" +
  "<P><TEXT><CHAR>&lt;붙임&gt; &amp; &quot;따옴&quot; &#54620;&#xAE00;</CHAR></TEXT></P>\n";
const SYNTHETIC_TEXT = '첫 줄이어짐\n가\t나\n다 라 마 바\n\n<붙임> & "따옴" 한글';

const utf8 = (s: string) => Buffer.from(s, "utf8");

describe("extractHmlText — 본문 CHAR 글자만", () => {
  it("문단·탭·줄바꿈·띄어쓰기·표기를 풀고 머리·꼬리는 버린다", () => {
    const text = extractHmlText(utf8(hml(SYNTHETIC_BODY)));
    expect(text).toBe(SYNTHETIC_TEXT);
    expect(text).not.toContain("머리 비밀");
    expect(text).not.toContain("꼬리 비밀");
  });

  it("UTF-8 BOM 이 있어도 같다", () => {
    const buf = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), utf8(hml(SYNTHETIC_BODY))]);
    expect(extractHmlText(buf)).toBe(SYNTHETIC_TEXT);
  });

  it("UTF-16LE(BOM) 도 같다", () => {
    const buf = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(hml(SYNTHETIC_BODY), "utf16le")]);
    expect(extractHmlText(buf)).toBe(SYNTHETIC_TEXT);
  });

  it("UTF-16BE(BOM) 도 같다", () => {
    const be = Buffer.from(hml(SYNTHETIC_BODY), "utf16le").swap16();
    const buf = Buffer.concat([Buffer.from([0xfe, 0xff]), be]);
    expect(extractHmlText(buf)).toBe(SYNTHETIC_TEXT);
  });

  it("XML 선언이 euc-kr 이면 cp949 바이트로 읽는다", () => {
    const src = hml(SYNTHETIC_BODY, '<?xml version="1.0" encoding="euc-kr" ?>');
    expect(extractHmlText(iconv.encode(src, "cp949"))).toBe(SYNTHETIC_TEXT);
  });
});

describe("extractHmlText — 모양이 다르거나 덜 된 문서", () => {
  it("HWPML 이 아니면 빈 글자", () => {
    expect(extractHmlText(utf8('<?xml version="1.0"?><DOC><BODY><P><CHAR>x</CHAR></P></BODY></DOC>'))).toBe("");
  });

  it("BODY 가 없으면 빈 글자", () => {
    expect(extractHmlText(utf8("<HWPML><HEAD/><TAIL/></HWPML>"))).toBe("");
  });

  it("CHAR 밖 글자는 버린다", () => {
    expect(extractHmlText(utf8(hml("<P>밖<CHAR>안</CHAR>밖</P>")))).toBe("안");
  });

  it("DOCTYPE 의 ENTITY 는 펼치지 않는다(바깥 파일을 읽지 않음)", () => {
    const src =
      '<?xml version="1.0"?><!DOCTYPE HWPML [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>' +
      "<HWPML><BODY><P><CHAR>&xxe;자격</CHAR></P></BODY></HWPML>";
    expect(extractHmlText(utf8(src))).toBe("&xxe;자격");
  });

  it("줄 끝 공백을 지우고 빈 줄은 둘까지만", () => {
    const body = "<P><CHAR>위   </CHAR></P>" + "<P></P>".repeat(5) + "<P><CHAR>아래</CHAR></P>";
    expect(extractHmlText(utf8(hml(body)))).toBe("위\n\n아래");
  });

  it("주석은 버리고 CDATA 는 글자 그대로", () => {
    const body = "<P><CHAR>가<!-- 주석 <CHAR>숨김</CHAR> -->나<![CDATA[<다>]]></CHAR></P>";
    expect(extractHmlText(utf8(hml(body)))).toBe("가나<다>");
  });

  it("태그 대소문자는 가리지 않는다", () => {
    expect(extractHmlText(utf8("<hwpml><body><p><char>소문자</char></p></body></hwpml>"))).toBe("소문자");
  });

  it("다섯 이름과 숫자 표기만 풀고, 범위 밖 숫자·모르는 이름은 그대로", () => {
    const body = "<P><CHAR>&apos;a&apos; &#x1F600; &#9999999999; &nbsp; &unknown; &#65;</CHAR></P>";
    expect(extractHmlText(utf8(hml(body)))).toBe("'a' 😀 &#9999999999; &nbsp; &unknown; A");
  });

  it("표 칸의 글자도 나오고 표 뒤 문단은 따로 줄이 된다", () => {
    const body =
      "<P><TEXT><TABLE><ROW><CELL><PARALIST><P><TEXT><CHAR>칸 글자</CHAR></TEXT></P></PARALIST></CELL></ROW></TABLE></TEXT></P>" +
      "<P><TEXT><CHAR>표 뒤</CHAR></TEXT></P>";
    const text = extractHmlText(utf8(hml(body)));
    expect(text).toContain("칸 글자");
    expect(text.split("\n")).toContain("표 뒤");
  });
});

describe("extractHmlText — 실물(해양수산부 공고 제2026-1311호, 756,716바이트)", () => {
  const FIX = join(__dirname, "__fixtures__");
  const real = () => readFileSync(join(FIX, "mof-announcement.hml"));

  it("본문이 나오고 머리의 모양 정의·태그는 섞이지 않는다", () => {
    const text = extractHmlText(real());
    expect(text.startsWith("해양수산부 공고 제2026-1311호\n\n2026년 친환경양식어업육성")).toBe(true);
    expect(text).toContain("모집규모: 총사업비 8,000백만원(국비 4,000백만원)");
    expect(text).toContain("□ 증빙자료 목록");
    expect(text).not.toContain("이곳부터 내용을 기재하세요"); // 머리 문서 요약의 제목
    expect(text).not.toContain("<CHAR");
    expect(text).not.toContain("<FWSPACE");
    expect(text).not.toContain("CharShape");
    expect(text).toHaveLength(12904);
  });

  it("같은 문서를 UTF-16LE 로 바꿔도 결과가 같다", () => {
    const buf = real();
    const asText = buf.subarray(3).toString("utf8"); // 실물은 UTF-8 BOM 으로 시작
    const u16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(asText, "utf16le")]);
    expect(extractHmlText(u16)).toBe(extractHmlText(buf));
  });
});

describe("extractHmlText — 나쁜 입력도 빨리 끝나고 던지지 않는다", () => {
  const wrapBody = (inner: string) => `<HWPML><BODY>${inner}</BODY></HWPML>`;
  const hostile: Array<[string, string, (out: string) => void]> = [
    ["닫히지 않는 주석 50만 개", wrapBody("<!--".repeat(500_000)), (o) => expect(o).toBe("")],
    ["닫히지 않는 태그 100만 개", wrapBody("<a".repeat(1_000_000)), (o) => expect(o).toBe("")],
    ["HWPML 안 닫히지 않는 BODY 40만 개", "<HWPML>" + "<BODY".repeat(400_000), (o) => expect(o).toBe("")],
    ["닫히지 않는 CDATA 20만 개", wrapBody("<![CDATA[".repeat(200_000)), (o) => expect(o).toBe("")],
    [
      "CHAR 안 끝나지 않는 숫자 표기 100만 개",
      wrapBody("<P><CHAR>" + "&#".repeat(1_000_000) + "</CHAR></P>"),
      (o) => expect(o.startsWith("&#&#")).toBe(true),
    ],
    ["공백 200만 칸 뒤 글자", wrapBody("<P><CHAR>" + " ".repeat(2_000_000) + "x</CHAR></P>"), (o) => expect(o).toBe("x")],
    ["닫히지 않는 따옴표 속성 50만 개", wrapBody('<a "'.repeat(500_000)), (o) => expect(o).toBe("")],
  ];

  it("일곱 가지 약 2MB 입력을 합쳐 5초 안에", { timeout: 20_000 }, () => {
    const started = Date.now();
    for (const [, src, check] of hostile) check(extractHmlText(utf8(src)));
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it("무작위 바이트·빈 입력 → 빈 글자", () => {
    let seed = 20261001;
    const rnd = Buffer.alloc(64 * 1024);
    for (let i = 0; i < rnd.length; i++) {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      rnd[i] = seed >>> 24;
    }
    expect(extractHmlText(rnd)).toBe("");
    expect(extractHmlText(Buffer.alloc(0))).toBe("");
  });
});
