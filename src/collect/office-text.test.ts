import AdmZip from "adm-zip";
import { utils, write } from "cfb";
import { describe, expect, it } from "vitest";
import { docxOf, hwpxOf, pptxOf, xlsxOf } from "../documents/__fixtures__/samples";
import { classifyOleDocument, classifyZipDocument, extractOdtText } from "./office-text";

/**
 * 받은 zip·OLE 파일이 어떤 문서인지 가리고, ODT(오픈 문서) 본문 글자를 뽑는다(2026-10-01 「첨부파일 글자 추출 누락」 4번).
 *
 * 운영 실측에서 본 것:
 *  · 과기정통부는 같은 공고를 hwp·hwpx·odt 로 함께 올린다. odt 는 형식을 몰라 못 읽었다.
 *  · 공고 첨부에 워드·엑셀·파워포인트(xlsx·docx·pptx·옛 xls)가 섞여 온다. 모두 zip(PK) 이라 hwpx 로 잘못 보고 「글자 없음」이 됐다.
 *  · zip 안에 서식 묶음이 든 진짜 압축 파일도 온다 — 이건 문서가 아니라 「압축 파일」로 따로 알려야 한다.
 * 받은 바이트만 보고 가린다(이름·저장 형식은 믿지 않는다). 셋 다 던지지 않는다.
 */

/** 이름 → 내용 짝으로 zip 을 만든다(글자면 UTF-8). */
function zipOf(entries: Record<string, string | Buffer>): Buffer {
  const zip = new AdmZip();
  for (const [name, v] of Object.entries(entries)) zip.addFile(name, typeof v === "string" ? Buffer.from(v, "utf8") : v);
  return zip.toBuffer();
}

const ODF_NS =
  'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" ' +
  'xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:dc="http://purl.org/dc/elements/1.1/" ' +
  'xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:xlink="http://www.w3.org/1999/xlink"';

/** content.xml 하나로 된 ODT. body = `<office:text>` 안쪽, before = `<office:body>` 앞(머리 쪽). */
function odtXml(body: string, before = ""): string {
  return `<?xml version="1.0" encoding="UTF-8"?><office:document-content ${ODF_NS} office:version="1.3">${before}<office:body><office:text>${body}</office:text></office:body></office:document-content>`;
}

function odtOf(body: string, before = ""): Buffer {
  return zipOf({
    mimetype: "application/vnd.oasis.opendocument.text",
    "content.xml": odtXml(body, before),
    "META-INF/manifest.xml": "<manifest:manifest/>",
  });
}

/** 셀 글자 목록 → 한 줄짜리 ODS(오픈 문서 표). */
function odsOf(cells: string[]): Buffer {
  const row = cells.map((c) => `<table:table-cell office:value-type="string"><text:p>${c}</text:p></table:table-cell>`).join("");
  return zipOf({
    mimetype: "application/vnd.oasis.opendocument.spreadsheet",
    "content.xml": `<?xml version="1.0" encoding="UTF-8"?><office:document-content ${ODF_NS}><office:body><office:spreadsheet><table:table table:name="시트1"><table:table-row>${row}</table:table-row></table:table></office:spreadsheet></office:body></office:document-content>`,
  });
}

/** 줄기 이름 목록 → OLE(CFB) 파일. `Sub/X` 는 하위 저장소 안 줄기. */
function oleOf(streams: string[]): Buffer {
  const cfb = utils.cfb_new();
  for (const s of streams) utils.cfb_add(cfb, s, Buffer.from("stream"));
  return Buffer.from(write(cfb, { type: "buffer" }));
}

const OLE_SIG = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

describe("classifyZipDocument — zip 속 항목 이름으로 문서 종류를 가린다", () => {
  const cases: Array<[string, () => Buffer, ReturnType<typeof classifyZipDocument>]> = [
    ["한글 새 형식(hwpx)", () => hwpxOf(["가"]), "hwpx"],
    ["워드(docx)", () => docxOf(["가"]), "docx"],
    ["엑셀(xlsx)", () => xlsxOf({ 시트: { A1: "가" } }), "xlsx"],
    ["파워포인트(pptx, 슬라이드만)", () => pptxOf([["가"]]), "pptx"],
    ["파워포인트(presentation.xml 만)", () => zipOf({ "ppt/presentation.xml": "<p:presentation/>" }), "pptx"],
    ["ODT", () => odtOf("<text:p>가</text:p>"), "odt"],
    ["ODS 도 odt 로 읽는다", () => odsOf(["가"]), "odt"],
    ["대소문자 다른 한글 본문 이름(Contents/Section0.xml)", () => zipOf({ "Contents/Section0.xml": "<x/>" }), "hwpx"],
    ["한글·워드 항목이 함께 있으면 한글", () => zipOf({ "word/document.xml": "<w/>", "Contents/section0.xml": "<x/>" }), "hwpx"],
    ["엑셀·ODT 항목이 함께 있으면 엑셀", () => zipOf({ "content.xml": "<x/>", "xl/workbook.xml": "<w/>" }), "xlsx"],
    ["서식 묶음(글 파일)", () => zipOf({ "서식/신청서.txt": "양식" }), "archive"],
    ["속에 hwpx 파일이 든 압축 파일", () => zipOf({ "공고.hwpx": hwpxOf(["가"]) }), "archive"],
    ["하위 폴더의 content.xml 은 ODT 가 아니다", () => zipOf({ "docs/content.xml": "<x/>" }), "archive"],
    ["폴더만 든 zip", () => zipOf({ "docs/": Buffer.alloc(0) }), "archive"],
    ["항목이 하나도 없는 zip", () => new AdmZip().toBuffer(), "archive"],
    ["PDF 바이트", () => Buffer.from("%PDF-1.7\n%âãÏÓ\n", "latin1"), null],
    ["zip 머리만 있고 깨진 바이트", () => Buffer.from("PK\x03\x04garbage-bytes-here", "latin1"), null],
    ["빈 바이트", () => Buffer.alloc(0), null],
  ];
  it.each(cases)("%s", (_label, make, want) => {
    expect(classifyZipDocument(make())).toBe(want);
  });
});

describe("classifyOleDocument — OLE 최상위 줄기 이름으로 문서 종류를 가린다", () => {
  const cases: Array<[string, () => Buffer, ReturnType<typeof classifyOleDocument>]> = [
    ["한글(FileHeader)", () => oleOf(["FileHeader"]), "hwp"],
    ["옛 엑셀(BIFF8, 실제 xlsx 라이브러리로 만든 것)", () => xlsxOf({ 시트: { A1: "가" } }, "biff8"), "xls"],
    ["옛 엑셀(Book 줄기)", () => oleOf(["Book"]), "xls"],
    ["옛 워드(WordDocument)", () => oleOf(["WordDocument"]), "doc"],
    ["옛 파워포인트(PowerPoint Document)", () => oleOf(["PowerPoint Document"]), "ppt"],
    ["한글이 워드보다 먼저", () => oleOf(["WordDocument", "FileHeader"]), "hwp"],
    ["엑셀이 워드보다 먼저", () => oleOf(["WordDocument", "Workbook"]), "xls"],
    ["모르는 줄기만", () => oleOf(["Foo"]), null],
    ["하위 저장소 안의 FileHeader 는 보지 않는다", () => oleOf(["Sub/FileHeader"]), null],
    ["OLE 가 아닌 바이트", () => Buffer.from("not an ole file"), null],
    ["OLE 머리 뒤가 깨진 바이트", () => Buffer.concat([OLE_SIG, Buffer.alloc(504)]), null],
    ["빈 바이트", () => Buffer.alloc(0), null],
  ];
  it.each(cases)("%s", (_label, make, want) => {
    expect(classifyOleDocument(make())).toBe(want);
  });
});

describe("extractOdtText — content.xml 의 office:body 글자", () => {
  it("문단·제목·꾸밈·연결은 글자만 남기고 문단마다 줄을 바꾼다", () => {
    const body =
      '<text:h text:outline-level="1">2026년 공고</text:h>' +
      "<text:p>첫 문단</text:p>" +
      '<text:p>둘째 <text:span text:style-name="T1">문단</text:span></text:p>' +
      '<text:p><text:a xlink:href="https://www.msit.go.kr">신청 바로가기</text:a></text:p>';
    expect(extractOdtText(odtOf(body))).toBe("2026년 공고\n첫 문단\n둘째 문단\n신청 바로가기");
  });

  it("탭·줄바꿈·띄어쓰기 태그", () => {
    const body = '<text:p>가<text:tab/>나<text:line-break/>다<text:s text:c="3"/>라<text:s/>마</text:p>';
    expect(extractOdtText(odtOf(body))).toBe("가\t나\n다   라 마");
  });

  it("띄어쓰기 수(text:c) — 1 미만·숫자 아님은 1, 100 넘으면 100, 작은따옴표도 읽는다", () => {
    const body = '<text:p>a<text:s text:c="0"/>b<text:s text:c="abc"/>c<text:s text:c="500"/>d<text:s text:c=\'2\'/>e</text:p>';
    expect(extractOdtText(odtOf(body))).toBe(`a b c${" ".repeat(100)}d  e`);
  });

  it("글자 안 공백·줄바꿈 뭉치는 한 칸으로, 문단 밖 들여쓰기 공백은 버린다", () => {
    expect(extractOdtText(odtOf("<text:p>  여러   칸\n\t띄움  </text:p>"))).toBe("여러 칸 띄움");
    expect(extractOdtText(odtOf("\n  <text:p>가</text:p>\n  <text:p>나</text:p>\n"))).toBe("가\n나");
  });

  it("메모(office:annotation)·바뀐 내용 기록(text:tracked-changes)은 건너뛴다 — 메모 끝 표시(annotation-end)는 메모가 아니다", () => {
    const body =
      '<text:p>본문<office:annotation office:name="a1"><dc:creator>김가상</dc:creator><text:p>메모 글</text:p></office:annotation> 계속<office:annotation-end office:name="a1"/> 끝</text:p>' +
      '<text:tracked-changes><text:changed-region text:id="c1"><text:deletion><text:p>지운 글</text:p></text:deletion></text:changed-region></text:tracked-changes>' +
      "<text:p>남은 글</text:p>";
    expect(extractOdtText(odtOf(body))).toBe("본문 계속 끝\n남은 글");
  });

  it("글자 참조 — 다섯 이름과 숫자만 한 번에 푼다(모르는 이름·범위 밖 숫자는 그대로)", () => {
    const body = "<text:p>A &amp; B &lt;C&gt; &#54620;&#xAE00; &quot;x&quot; &apos;y&apos; &amp;lt; &unknown; &#1114112;</text:p>";
    expect(extractOdtText(odtOf(body))).toBe("A & B <C> 한글 \"x\" 'y' &lt; &unknown; &#1114112;");
  });

  it("주석은 버리고 CDATA 는 글자 그대로", () => {
    const body = "<text:p>가<!-- 주석 <text:p>숨김</text:p> -->나<![CDATA[<원문>]]></text:p>";
    expect(extractOdtText(odtOf(body))).toBe("가나<원문>");
  });

  it("office:body 밖(스크립트·꾸밈 정의)의 글자는 읽지 않는다", () => {
    const before =
      "<office:scripts><text:p>머리 글</text:p></office:scripts>" +
      '<office:automatic-styles><style:style style:name="P1"><text:p>꾸밈 글</text:p></style:style></office:automatic-styles>';
    expect(extractOdtText(odtOf("<text:p>본문</text:p>", before))).toBe("본문");
  });

  it("빈 문단이 이어져도 빈 줄은 하나까지, 줄 끝 공백은 지운다", () => {
    expect(extractOdtText(odtOf("<text:p>하나</text:p><text:p/><text:p/><text:p/><text:p>둘</text:p>"))).toBe("하나\n\n둘");
    expect(extractOdtText(odtOf('<text:p>가<text:s text:c="5"/></text:p><text:p>나</text:p>'))).toBe("가\n나");
  });

  it("표 칸·목록 항목도 문단으로 읽는다", () => {
    const body =
      "<table:table><table:table-row>" +
      "<table:table-cell><text:p>칸1</text:p></table:table-cell><table:table-cell><text:p>칸2</text:p></table:table-cell>" +
      "</table:table-row></table:table>" +
      "<text:list><text:list-item><text:p>항목</text:p></text:list-item></text:list>";
    expect(extractOdtText(odtOf(body))).toBe("칸1\n칸2\n항목");
  });

  it("ODS(표 문서)도 칸 글자를 읽는다", () => {
    expect(extractOdtText(odsOf(["지원금", "5천만원"]))).toBe("지원금\n5천만원");
  });

  it("ODT 가 아니거나 본문이 없으면 빈 글자(던지지 않는다)", () => {
    expect(extractOdtText(hwpxOf(["가"]))).toBe("");
    expect(extractOdtText(Buffer.from("plain text"))).toBe("");
    expect(extractOdtText(Buffer.alloc(0))).toBe("");
    expect(extractOdtText(Buffer.from("PK\x03\x04garbage", "latin1"))).toBe("");
    const noBody = zipOf({ "content.xml": `<office:document-content ${ODF_NS}><office:scripts/></office:document-content>` });
    expect(extractOdtText(noBody)).toBe("");
  });

  it("content.xml 이 20MB 를 넘으면 읽지 않는다", () => {
    const big = odtXml("<text:p>BIG</text:p>" + " ".repeat(20 * 1024 * 1024 + 1));
    expect(extractOdtText(zipOf({ "content.xml": big }))).toBe("");
  });

  it("일부러 만든 나쁜 파일도 선형 시간에 끝난다", () => {
    const spaces = `<text:p>${'<text:s text:c="100"/>'.repeat(20_000)}x</text:p>`;
    const t0 = Date.now();
    expect(extractOdtText(odtOf(spaces))).toBe("x");
    // 닫는 태그 없는 메모 — 거기서 멈춘다(뒤를 메모로 본다).
    const openAnnotation = `<text:p>가</text:p><office:annotation>${"<text:p>z</text:p>".repeat(50_000)}`;
    expect(extractOdtText(zipOf({ "content.xml": `<office:document-content ${ODF_NS}><office:body><office:text>${openAnnotation}</office:text></office:body></office:document-content>` }))).toBe("가");
    // 닫히지 않은 꺾쇠가 줄줄이 — 거기서 멈춘다.
    expect(extractOdtText(odtOf(`<text:p>나</text:p>${"<".repeat(200_000)}`))).toBe("나");
    expect(Date.now() - t0).toBeLessThan(3000);
  });
});
