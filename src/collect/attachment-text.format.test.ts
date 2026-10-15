import { utils, write } from "cfb";
import { PDFDocument, PDFHexString, StandardFonts, rgb } from "pdf-lib";
import { describe, expect, it, vi } from "vitest";
import {
  detectAttachmentFormat,
  fetchAttachmentTexts,
  listedAttachmentNames,
  sniffAttachmentKind,
  type AttachmentFileReason,
  type AttachmentFormat,
  type FetchAttachmentTextsOptions,
} from "./attachment-text";
import type { PolicyAttachmentRequest } from "./board/types";

/**
 * 첨부 형식 판별·읽는 차례·시도 수(2026-10-01 「첨부파일 글자 추출 누락」 3번).
 *
 * 운영 실측에서 본 것:
 *  · 형식: 해양수산부 `.hml`(한글 XML) 첨부는 형식을 몰라 하나도 못 읽었다. 그림·HTML 오류 쪽·암호 PDF·
 *    암호/배포용 한글은 모두 「글자 없음」으로 뭉쳐 원인을 알 수 없었다 → 이유를 나눠 남긴다.
 *  · 차례: 한 공고에 첨부를 1개만 읽는데 형식 순서만 봐서 신청서·포스터 pdf 가 공고문 hwp 보다 먼저 읽혔다
 *    → 이름 역할(공고문 쪽 0 · 그 밖 1 · 서식 쪽 2)을 먼저 본다.
 *  · 시도 수: 앞 파일이 404 면 다음 파일을 안 봤다 → `extraAttempts` 만큼 더 본다(읽은 수 상한은 그대로).
 *  · 충북기업진흥원 전자책·수출바우처 공통 안내 파일이 공고마다 첨부로 저장돼 있다 → 부르지 않는다(ignored).
 *  · 같은 파일이 두 번 저장된 공고(같은 요청) → 한 번만 부른다(duplicate).
 * AI 에게 가는 표시 글자의 모양(`[첨부: X]`·`[읽지 못한 첨부: X]`·`[미확인 첨부: X]`)은 바꾸지 않는다.
 */

const B = "https://www.bizinfo.go.kr/cmm/fms/fileDown.do?file=";

async function makePdf(text: string): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 200]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText(text, { x: 24, y: 100, size: 12, font });
  return Buffer.from(await doc.save());
}

/** 글자 없이 그림(사각형)만 그린 PDF — pdf.js 는 빈 글자를 돌려준다. */
async function imageOnlyPdf(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 200]);
  page.drawRectangle({ x: 20, y: 20, width: 100, height: 50, color: rgb(0.2, 0.4, 0.6) });
  return Buffer.from(await doc.save());
}

/** 빈 암호로 안 열리는 PDF — pdf.js 가 PasswordException 을 던진다. */
async function encryptedPdf(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 200]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText("SECRET_BODY", { x: 24, y: 100, size: 12, font });
  const enc = doc.context.obj({
    Filter: "Standard",
    V: 1,
    R: 2,
    O: PDFHexString.of("00".repeat(32)),
    U: PDFHexString.of("11".repeat(32)),
    P: -4,
  });
  doc.context.trailerInfo.Encrypt = doc.context.register(enc);
  doc.context.trailerInfo.ID = doc.context.obj([PDFHexString.of("ab".repeat(16)), PDFHexString.of("ab".repeat(16))]);
  return Buffer.from(await doc.save({ useObjectStreams: false }));
}

/** 머리 8바이트가 PNG 인 바이트(그림 판별에는 앞머리만 쓴다). */
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52]);

/**
 * 한글 5 OLE — FileHeader(플래그) + 미리보기(PrvText). 보호 플래그면 암호화된 본문 흉내 줄기를 넣는다.
 * 보호 플래그가 없으면 본문 줄기가 없어 미리보기만 나온다.
 */
function hwpFile(opts: { flags?: number; preview?: string } = {}): Buffer {
  const cfb = utils.cfb_new();
  const header = Buffer.alloc(256);
  header.write("HWP Document File", 0, "ascii");
  header[35] = 5;
  header.writeUInt32LE((opts.flags ?? 0) >>> 0, 36);
  utils.cfb_add(cfb, "FileHeader", header);
  if (opts.flags) utils.cfb_add(cfb, "BodyText/Section0", Buffer.from([0x13, 0x37, 0xbe, 0xef, 0x00, 0x42]));
  if (opts.preview !== undefined) utils.cfb_add(cfb, "PrvText", Buffer.from(opts.preview, "utf16le"));
  return Buffer.from(write(cfb, { type: "buffer" }));
}

const HML_TEXT = "HML 공고 본문";

function hmlBytes(inner = `<P><TEXT><CHAR>${HML_TEXT}</CHAR></TEXT></P>`): Buffer {
  return Buffer.from(
    '<?xml version="1.0" encoding="UTF-8" standalone="no" ?>' +
      `<HWPML Version="2.8" SubVersion="8.0.0.0" Style="embed"><HEAD SecCnt="1"/><BODY><SECTION Id="0">${inner}</SECTION></BODY><TAIL/></HWPML>`,
    "utf8",
  );
}

type Call = { url: string; init?: RequestInit };

function recording(handler: (url: string) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return handler(url);
  });
  return { calls, fetch };
}

const ok = (body: Buffer | Uint8Array) => new Response(Uint8Array.from(body), { status: 200 });
const notFound = () => new Response("gone", { status: 404 });

const opts = (fetch: unknown, more: Partial<FetchAttachmentTextsOptions> = {}): FetchAttachmentTextsOptions => ({
  extractHwpx: () => "",
  fetch: fetch as never,
  ...more,
});

type Kind = PolicyAttachmentRequest["kind"];

/** 이름·형식 목록 → 주소 끝이 차례 번호인 첨부(`${B}0`, `${B}1` …). */
function numbered(items: Array<[string, Kind]>): PolicyAttachmentRequest[] {
  return items.map(([name, kind], i) => ({ name, kind, url: `${B}${i}` }));
}

describe("detectAttachmentFormat — 받은 바이트 앞머리로 형식을 가린다", () => {
  const u8 = (...bytes: number[]) => Buffer.from(bytes);
  const hmlUtf16le = Buffer.concat([u8(0xff, 0xfe), Buffer.from(hmlBytes().toString("utf8"), "utf16le")]);
  const hmlUtf16be = Buffer.concat([u8(0xfe, 0xff), Buffer.from(hmlBytes().toString("utf8"), "utf16le").swap16()]);
  const cases: Array<[string, Buffer, AttachmentFormat]> = [
    ["PDF", Buffer.from("%PDF-1.7\n%âãÏÓ\n"), "pdf"],
    ["OLE(옛 한글)", u8(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0), "hwp"],
    ["ZIP(hwpx 등)", u8(0x50, 0x4b, 0x03, 0x04, 0x14, 0), "zip"],
    ["JPEG", u8(0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46), "image"],
    ["PNG", PNG, "image"],
    ["GIF87a", Buffer.from("GIF87a\x01\x00\x01\x00", "latin1"), "image"],
    ["GIF89a", Buffer.from("GIF89a\x01\x00\x01\x00", "latin1"), "image"],
    ["WEBP", Buffer.concat([Buffer.from("RIFF"), u8(0x24, 0, 0, 0), Buffer.from("WEBPVP8 ")]), "image"],
    ["BMP", Buffer.concat([Buffer.from("BM"), u8(0x36, 0, 0, 0, 0, 0, 0, 0, 0x36, 0, 0, 0)]), "image"],
    ["TIFF(II)", u8(0x49, 0x49, 0x2a, 0x00, 0x08, 0, 0, 0), "image"],
    ["TIFF(MM)", u8(0x4d, 0x4d, 0x00, 0x2a, 0, 0, 0, 0x08), "image"],
    ["HML", hmlBytes(), "hml"],
    ["HML(UTF-8 BOM)", Buffer.concat([u8(0xef, 0xbb, 0xbf), hmlBytes()]), "hml"],
    ["HML(UTF-16LE BOM)", hmlUtf16le, "hml"],
    ["HML(UTF-16BE BOM)", hmlUtf16be, "hml"],
    ["HML(앞 공백·줄바꿈 + XML 선언)", Buffer.from(`\r\n  ${hmlBytes().toString("utf8")}`), "hml"],
    ["HML(XML 선언 없이, 소문자)", Buffer.from("<hwpml><body></body></hwpml>"), "hml"],
    ["HTML DOCTYPE", Buffer.from("<!DOCTYPE html><html><body>파일이 없습니다</body></html>"), "html"],
    ["HTML", Buffer.from("<html>로그인 필요</html>"), "html"],
    ["HTML 경고 스크립트", Buffer.from("<script>alert('파일이 없습니다');history.back();</script>"), "html"],
    ["HTML meta", Buffer.from('<meta http-equiv="refresh" content="0;url=/">'), "html"],
    ["HTML 대문자", Buffer.from("<HTML><BODY>x</BODY></HTML>"), "html"],
    ["HTML 앞 공백·소문자 doctype", Buffer.from("\n\n   <!doctype HTML>\n<html>"), "html"],
    ["HTML head", Buffer.from("<head><title>x</title></head>"), "html"],
    ["HTML body", Buffer.from("<body>x</body>"), "html"],
    ["HTML(UTF-8 BOM)", Buffer.concat([u8(0xef, 0xbb, 0xbf), Buffer.from("<html></html>")]), "html"],
  ];
  for (const [title, buf, want] of cases) {
    it(`${title} → ${want}`, () => {
      expect(detectAttachmentFormat(buf)).toBe(want);
    });
  }

  const none: Array<[string, Buffer]> = [
    ["평문", Buffer.from("hello world")],
    ["JSON", Buffer.from('{"result":"N","message":"파일 없음"}')],
    ["빈 값", Buffer.alloc(0)],
    ["BM 으로 시작하는 글(BMP 아님)", Buffer.from("BMW 협력사 모집 안내")],
    ["WEBP 아닌 RIFF(소리)", Buffer.concat([Buffer.from("RIFF"), u8(0x24, 0, 0, 0), Buffer.from("WAVEfmt ")])],
    ["HWPML 아닌 XML", Buffer.from('<?xml version="1.0"?><root><item>x</item></root>')],
    ["html 로 시작하는 다른 태그", Buffer.from("<htmlx>")],
    ["PDF 비슷한 글", Buffer.from("%PDX-1.4")],
    ["짧은 조각", u8(0xff, 0xd8)],
  ];
  for (const [title, buf] of none) {
    it(`${title} → null`, () => {
      expect(detectAttachmentFormat(buf)).toBeNull();
    });
  }

  it("안쪽 읽기 형식(sniffAttachmentKind)은 그대로 — 그림·HML 은 null", () => {
    expect(sniffAttachmentKind(PNG)).toBeNull();
    expect(sniffAttachmentKind(hmlBytes())).toBeNull();
    expect(sniffAttachmentKind(Buffer.from("<html></html>"))).toBeNull();
  });
});

describe("첨부 형식별 결과 — HML 은 읽고, 못 읽으면 이유를 나눠 남긴다", () => {
  it("이름이 .hml(저장 형식 etc)이면 HML 로 읽는다 — kind hml", async () => {
    const r = await fetchAttachmentTexts(
      [{ name: "공고문.hml", url: `${B}1.hml`, kind: "etc" }],
      opts(async () => ok(hmlBytes())),
    );
    expect(r.readFiles).toEqual(["공고문.hml"]);
    expect(r.text).toContain("[첨부: 공고문.hml]");
    expect(r.text).toContain(HML_TEXT);
    expect(r.files).toEqual([expect.objectContaining({ name: "공고문.hml", result: "read", kind: "hml" })]);
  });

  it("이름은 .hwp 인데 바이트가 HML 이면 HML 로 읽는다", async () => {
    const r = await fetchAttachmentTexts(
      [{ name: "공고.hwp", url: `${B}2.hwp`, kind: "hwp" }],
      opts(async () => ok(hmlBytes())),
    );
    expect(r.readFiles).toEqual(["공고.hwp"]);
    expect(r.text).toContain(HML_TEXT);
    expect(r.files).toEqual([expect.objectContaining({ name: "공고.hwp", result: "read", kind: "hml" })]);
  });

  type FailCase = {
    title: string;
    name: string;
    kind: Kind;
    bytes: () => Buffer | Promise<Buffer>;
    reason: AttachmentFileReason;
  };
  const failCases: FailCase[] = [
    { title: "읽을 글자 없는 HML", name: "공고.hml", kind: "etc", bytes: () => hmlBytes("<P></P>"), reason: "no_text" },
    { title: "그림 파일(png)", name: "포스터.png", kind: "etc", bytes: () => PNG, reason: "image" },
    { title: "이름은 pdf 인데 그림 바이트", name: "공고.pdf", kind: "pdf", bytes: () => PNG, reason: "image" },
    {
      title: "이름은 pdf 인데 HTML 오류 페이지",
      name: "공고.pdf",
      kind: "pdf",
      bytes: () => Buffer.from("<!DOCTYPE html><html><body>파일이 없습니다</body></html>"),
      reason: "html",
    },
    {
      title: "내려받기 주소가 경고 스크립트만 준다",
      name: "download.do",
      kind: "etc",
      bytes: () => Buffer.from("<script>alert('파일이 없습니다');history.back();</script>"),
      reason: "html",
    },
    { title: "글자 없는 PDF(그림만)", name: "공고.pdf", kind: "pdf", bytes: imageOnlyPdf, reason: "image_pdf" },
    { title: "암호 걸린 PDF", name: "공고.pdf", kind: "pdf", bytes: encryptedPdf, reason: "protected" },
    {
      title: "깨진 PDF",
      name: "공고.pdf",
      kind: "pdf",
      bytes: () => Buffer.from("%PDF-1.4\ngarbage garbage"),
      reason: "no_text",
    },
    {
      title: "암호·배포용 한글(미리보기 없음)",
      name: "공고.hwp",
      kind: "hwp",
      bytes: () => hwpFile({ flags: 1 << 1 }),
      reason: "protected",
    },
    {
      title: "그림만 든 PDF 바이트인데 이름은 hwp — 첫 시도의 이유를 남긴다",
      name: "공고.hwp",
      kind: "hwp",
      bytes: imageOnlyPdf,
      reason: "image_pdf",
    },
    {
      title: "보호 한글 바이트인데 이름은 pdf — 첫 시도의 이유를 남긴다",
      name: "공고.pdf",
      kind: "pdf",
      bytes: () => hwpFile({ flags: 1 << 2 }),
      reason: "protected",
    },
  ];
  for (const c of failCases) {
    it(`${c.title} → failed·${c.reason} (표시는 「읽지 못한 첨부」 그대로)`, async () => {
      const bytes = await c.bytes();
      const r = await fetchAttachmentTexts([{ name: c.name, url: `${B}x`, kind: c.kind }], opts(async () => ok(bytes)));
      expect(r.readFiles).toEqual([]);
      expect(r.failedFiles).toEqual([c.name]);
      expect(r.text).toContain(`[읽지 못한 첨부: ${c.name}]`);
      expect(r.files).toEqual([expect.objectContaining({ name: c.name, result: "failed", reason: c.reason })]);
    });
  }

  it("암호 PDF 의 글자는 어디에도 나오지 않는다", async () => {
    const pdf = await encryptedPdf();
    const r = await fetchAttachmentTexts([{ name: "공고.pdf", url: `${B}x`, kind: "pdf" }], opts(async () => ok(pdf)));
    expect(r.text).not.toContain("SECRET_BODY");
  });

  it("암호·배포용 한글이라도 미리보기가 있으면 read·preview_only (예전 그대로)", async () => {
    const r = await fetchAttachmentTexts(
      [{ name: "공고.hwp", url: `${B}x`, kind: "hwp" }],
      opts(async () => ok(hwpFile({ flags: 1 << 1, preview: "미리보기 공고" }))),
    );
    expect(r.readFiles).toEqual(["공고.hwp"]);
    expect(r.text).toContain("미리보기 공고");
    expect(r.files).toEqual([
      expect.objectContaining({ name: "공고.hwp", result: "read", reason: "preview_only", kind: "hwp" }),
    ]);
  });
});

describe("읽는 차례 — 이름 역할(공고문 쪽 먼저) → 형식 → 원래 차례", () => {
  it("[포스터.pdf, 공고문.hwp]·1개 → 공고문을 읽고 포스터는 over_limit", async () => {
    const pdf = await makePdf("ROLE_FIRST");
    const { calls, fetch } = recording(() => ok(pdf));
    const r = await fetchAttachmentTexts(
      numbered([
        ["포스터.pdf", "pdf"],
        ["공고문.hwp", "hwp"],
      ]),
      opts(fetch, { maxFiles: 1 }),
    );
    expect(calls.map((c) => c.url)).toEqual([`${B}1`]);
    expect(r.readFiles).toEqual(["공고문.hwp"]);
    expect(r.text).toContain("[미확인 첨부: 포스터.pdf]");
    expect(r.files).toEqual([
      expect.objectContaining({ name: "공고문.hwp", result: "read" }),
      expect.objectContaining({ name: "포스터.pdf", result: "skipped", reason: "over_limit" }),
    ]);
  });

  it("[신청서.hwp, 참고자료.pdf, 공고.hwp, 공고.pdf]·4개 → 공고.pdf, 공고.hwp, 참고자료.pdf, 신청서.hwp", async () => {
    const pdf = await makePdf("ROLE_ORDER");
    const { calls, fetch } = recording(() => ok(pdf));
    const r = await fetchAttachmentTexts(
      numbered([
        ["신청서.hwp", "hwp"],
        ["참고자료.pdf", "pdf"],
        ["공고.hwp", "hwp"],
        ["공고.pdf", "pdf"],
      ]),
      opts(fetch, { maxFiles: 4 }),
    );
    expect(calls.map((c) => c.url)).toEqual([`${B}3`, `${B}2`, `${B}1`, `${B}0`]);
    expect(r.files?.map((f) => f.name)).toEqual(["공고.pdf", "공고.hwp", "참고자료.pdf", "신청서.hwp"]);
  });

  it("크기 꼬리 때문에 etc 로 저장된 공고문(hwp)이 같은 역할의 etc 파일보다 먼저", async () => {
    const pdf = await makePdf("TRIMMED_KIND");
    const { calls, fetch } = recording(() => ok(pdf));
    const r = await fetchAttachmentTexts(
      numbered([
        ["안내.bin", "etc"],
        ["공고문.hwp (68.5K)", "etc"],
      ]),
      opts(fetch, { maxFiles: 1 }),
    );
    expect(calls.map((c) => c.url)).toEqual([`${B}1`]);
    expect(r.files).toEqual([
      expect.objectContaining({ name: "공고문.hwp (68.5K)", result: "read" }),
      expect.objectContaining({ name: "안내.bin", result: "skipped", reason: "over_limit" }),
    ]);
  });

  it("크기 꼬리 때문에 etc 로 저장된 zip 은 후보가 아니다 — 부르지 않고 결과·표시에도 없다", async () => {
    const pdf = await makePdf("ZIP_DROPPED");
    const { calls, fetch } = recording(() => ok(pdf));
    const r = await fetchAttachmentTexts(
      numbered([
        ["서식 모음.zip (1.2MB)", "etc"],
        ["공고.pdf", "pdf"],
      ]),
      opts(fetch, { maxFiles: 1 }),
    );
    expect(calls.map((c) => c.url)).toEqual([`${B}1`]);
    expect(r.files).toEqual([expect.objectContaining({ name: "공고.pdf", result: "read" })]);
    expect(r.text).not.toContain("서식 모음");
  });
});

describe("사이트 공통 파일(ignored)·같은 요청(duplicate)은 부르지 않는다", () => {
  const CBA_EBOOK = "https://www.cba.ne.kr/ebook/2026/01_jiwon/res/pages/pages.pdf";
  const CBA_FILE = "https://www.cba.ne.kr/base/download/bbs.php?fno=1&bid=2&did=3";

  it("충북기업진흥원 전자책은 ignored — 부르지 않고 표시·세 목록에도 없다", async () => {
    const pdf = await makePdf("CBA_NOTICE");
    const { calls, fetch } = recording(() => ok(pdf));
    const r = await fetchAttachmentTexts(
      [
        { name: "pages.pdf", url: CBA_EBOOK, kind: "pdf" },
        { name: "공고.pdf", url: CBA_FILE, kind: "pdf" },
      ],
      opts(fetch),
    );
    expect(calls.map((c) => c.url)).toEqual([CBA_FILE]);
    expect(r.files).toEqual([
      { name: "pages.pdf", result: "ignored" },
      expect.objectContaining({ name: "공고.pdf", result: "read" }),
    ]);
    expect(r.readFiles).toEqual(["공고.pdf"]);
    expect(r.failedFiles).toEqual([]);
    expect(r.skippedFiles).toEqual([]);
    expect(r.text).not.toContain("pages.pdf");
  });

  it("수출바우처 공통 안내 파일(file_id)은 ignored", async () => {
    const fetch = vi.fn(async () => ok(Buffer.from("x")));
    const r = await fetchAttachmentTexts(
      [
        {
          name: "수출바우처 관리지침.pdf",
          url: "https://www.exportvoucher.com/common.FileDownload.do?file_id=FILE_000000006726376",
          kind: "pdf",
        },
      ],
      opts(fetch),
    );
    expect(fetch).not.toHaveBeenCalled();
    expect(r.files).toEqual([{ name: "수출바우처 관리지침.pdf", result: "ignored" }]);
    expect(r.text).toBe("");
    expect(r.readFiles).toEqual([]);
    expect(r.failedFiles).toEqual([]);
    expect(r.skippedFiles).toEqual([]);
  });

  it("같은 주소(http·https)가 두 번이면 한 번만 부르고 뒤의 것은 duplicate", async () => {
    const pdf = await makePdf("ONCE");
    const { calls, fetch } = recording(() => ok(pdf));
    const r = await fetchAttachmentTexts(
      [
        { name: "공고문.pdf", url: `${B}a`, kind: "pdf" },
        { name: "공고문(사본).pdf", url: `${B}a`.replace("https:", "http:"), kind: "pdf" },
      ],
      opts(fetch, { maxFiles: 2 }),
    );
    expect(calls).toHaveLength(1);
    expect(r.files).toEqual([
      { name: "공고문(사본).pdf", result: "duplicate" },
      expect.objectContaining({ name: "공고문.pdf", result: "read" }),
    ]);
    expect(r.readFiles).toEqual(["공고문.pdf"]);
    expect(r.text.match(/\[첨부: /g)).toHaveLength(1);
    expect(r.text).not.toContain("공고문(사본).pdf");
  });

  it("같은 주소라도 POST 본문이 다르면 다른 파일 — 둘 다 부른다", async () => {
    const pdf = await makePdf("POST_TWO");
    const { calls, fetch } = recording(() => ok(pdf));
    const r = await fetchAttachmentTexts(
      [
        { name: "a.pdf", url: `${B}down.do`, kind: "pdf", method: "POST", body: "id=1" },
        { name: "b.pdf", url: `${B}down.do`, kind: "pdf", method: "POST", body: "id=2" },
      ],
      opts(fetch, { maxFiles: 2 }),
    );
    expect(calls.map((c) => c.init?.body)).toEqual(["id=1", "id=2"]);
    expect(r.readFiles).toEqual(["a.pdf", "b.pdf"]);
  });

  it("무시·중복은 개수 상한을 쓰지 않는다", async () => {
    const pdf = await makePdf("REAL");
    const { calls, fetch } = recording(() => ok(pdf));
    const r = await fetchAttachmentTexts(
      [
        { name: "pages.pdf", url: CBA_EBOOK, kind: "pdf" },
        { name: "공고.pdf", url: CBA_FILE, kind: "pdf" },
        { name: "공고 사본.pdf", url: CBA_FILE.replace("https:", "http:"), kind: "pdf" },
        { name: "참고.pdf", url: "https://www.cba.ne.kr/base/download/bbs.php?fno=9", kind: "pdf" },
      ],
      opts(fetch, { maxFiles: 1 }),
    );
    expect(calls.map((c) => c.url)).toEqual([CBA_FILE]);
    expect(r.files).toEqual([
      { name: "pages.pdf", result: "ignored" },
      { name: "공고 사본.pdf", result: "duplicate" },
      expect.objectContaining({ name: "공고.pdf", result: "read" }),
      expect.objectContaining({ name: "참고.pdf", result: "skipped", reason: "over_limit" }),
    ]);
  });
});

describe("extraAttempts — 못 읽은 파일 대신 몇 개 더 시도한다(읽은 수 상한은 그대로)", () => {
  const abc = (n: number): PolicyAttachmentRequest[] =>
    ["a", "b", "c"].slice(0, n).map((x) => ({ name: `${x}.pdf`, url: `${B}${x}.pdf`, kind: "pdf" as const }));

  /** 주소 끝 글자(a·b·c)마다 404 또는 정상 PDF. */
  async function serve(plan: Record<string, "404" | "ok">) {
    const pdf = await makePdf("EXTRA");
    return recording((url) => (plan[url.slice(-5, -4)] === "ok" ? ok(pdf) : notFound()));
  }

  it("기본(0): [404, 정상]·1개 → 둘째는 over_limit", async () => {
    const { calls, fetch } = await serve({ a: "404", b: "ok" });
    const r = await fetchAttachmentTexts(abc(2), opts(fetch, { maxFiles: 1 }));
    expect(calls).toHaveLength(1);
    expect(r.files).toEqual([
      expect.objectContaining({ name: "a.pdf", result: "failed", reason: "not_found" }),
      expect.objectContaining({ name: "b.pdf", result: "skipped", reason: "over_limit" }),
    ]);
  });

  it("1: [404, 정상]·1개 → 둘째를 읽는다", async () => {
    const { calls, fetch } = await serve({ a: "404", b: "ok" });
    const r = await fetchAttachmentTexts(abc(2), opts(fetch, { maxFiles: 1, extraAttempts: 1 }));
    expect(calls).toHaveLength(2);
    expect(r.failedFiles).toEqual(["a.pdf"]);
    expect(r.readFiles).toEqual(["b.pdf"]);
    expect(r.files).toEqual([
      expect.objectContaining({ name: "a.pdf", result: "failed", reason: "not_found" }),
      expect.objectContaining({ name: "b.pdf", result: "read" }),
    ]);
  });

  it("1: [404, 404, 정상]·1개 → 두 번 시도하고 셋째는 over_limit", async () => {
    const { calls, fetch } = await serve({ a: "404", b: "404", c: "ok" });
    const r = await fetchAttachmentTexts(abc(3), opts(fetch, { maxFiles: 1, extraAttempts: 1 }));
    expect(calls).toHaveLength(2);
    expect(r.files).toEqual([
      expect.objectContaining({ name: "a.pdf", result: "failed" }),
      expect.objectContaining({ name: "b.pdf", result: "failed" }),
      expect.objectContaining({ name: "c.pdf", result: "skipped", reason: "over_limit" }),
    ]);
  });

  it("3: [정상, 정상, 정상]·2개 → 읽은 수가 차면 멈춘다", async () => {
    const { calls, fetch } = await serve({ a: "ok", b: "ok", c: "ok" });
    const r = await fetchAttachmentTexts(abc(3), opts(fetch, { maxFiles: 2, extraAttempts: 3 }));
    expect(calls).toHaveLength(2);
    expect(r.readFiles).toEqual(["a.pdf", "b.pdf"]);
    expect(r.files).toEqual([
      expect.objectContaining({ name: "a.pdf", result: "read" }),
      expect.objectContaining({ name: "b.pdf", result: "read" }),
      expect.objectContaining({ name: "c.pdf", result: "skipped", reason: "over_limit" }),
    ]);
  });

  it("음수는 0 으로 본다", async () => {
    const { calls, fetch } = await serve({ a: "404", b: "ok" });
    const r = await fetchAttachmentTexts(abc(2), opts(fetch, { maxFiles: 1, extraAttempts: -3 }));
    expect(calls).toHaveLength(1);
    expect(r.files?.[1]).toEqual(expect.objectContaining({ name: "b.pdf", result: "skipped", reason: "over_limit" }));
  });

  it("허용 안 된 주소도 시도 한 번으로 센다", async () => {
    const pdf = await makePdf("AFTER_BLOCKED");
    const list: PolicyAttachmentRequest[] = [
      { name: "a.pdf", url: "https://evil.example.com/a.pdf", kind: "pdf" },
      { name: "b.pdf", url: `${B}b.pdf`, kind: "pdf" },
      { name: "c.pdf", url: `${B}c.pdf`, kind: "pdf" },
    ];
    const first = recording(() => ok(pdf));
    const none = await fetchAttachmentTexts(list.slice(0, 2), opts(first.fetch, { maxFiles: 1 }));
    expect(first.calls).toHaveLength(0);
    expect(none.files).toEqual([
      expect.objectContaining({ name: "a.pdf", result: "failed", reason: "blocked_url" }),
      expect.objectContaining({ name: "b.pdf", result: "skipped", reason: "over_limit" }),
    ]);
    const second = recording(() => ok(pdf));
    const one = await fetchAttachmentTexts(list, opts(second.fetch, { maxFiles: 1, extraAttempts: 1 }));
    expect(second.calls.map((c) => c.url)).toEqual([`${B}b.pdf`]);
    expect(one.files).toEqual([
      expect.objectContaining({ name: "a.pdf", result: "failed", reason: "blocked_url" }),
      expect.objectContaining({ name: "b.pdf", result: "read" }),
      expect.objectContaining({ name: "c.pdf", result: "skipped", reason: "over_limit" }),
    ]);
  });

  it("maxFiles 0 이면 extraAttempts 가 있어도 부르지 않는다", async () => {
    const { calls, fetch } = await serve({ a: "ok", b: "ok" });
    const r = await fetchAttachmentTexts(abc(2), opts(fetch, { maxFiles: 0, extraAttempts: 3 }));
    expect(calls).toHaveLength(0);
    expect(r.files?.map((f) => f.reason)).toEqual(["over_limit", "over_limit"]);
  });

  it("자동 저장 모드: 미리보기뿐인 한글은 읽은 수에 안 들어가 다음 파일을 본다", async () => {
    const pdf = await makePdf("NEXT_AFTER_PREVIEW");
    const { calls, fetch } = recording((url) => (url.endsWith("hwp") ? ok(hwpFile({ preview: "미리보기 글자" })) : ok(pdf)));
    const r = await fetchAttachmentTexts(
      [
        { name: "공고.hwp", url: `${B}1.hwp`, kind: "hwp" },
        { name: "참고.pdf", url: `${B}2.pdf`, kind: "pdf" },
      ],
      opts(fetch, { maxFiles: 1, extraAttempts: 1, includeHwpPreview: false }),
    );
    expect(calls).toHaveLength(2);
    expect(r.files).toEqual([
      expect.objectContaining({ name: "공고.hwp", result: "skipped", reason: "preview_only" }),
      expect.objectContaining({ name: "참고.pdf", result: "read" }),
    ]);
  });

  it("미리보기를 남기는 모드: 미리보기도 읽은 것으로 세어 다음은 over_limit", async () => {
    const pdf = await makePdf("NOT_REACHED");
    const { calls, fetch } = recording((url) => (url.endsWith("hwp") ? ok(hwpFile({ preview: "미리보기 글자" })) : ok(pdf)));
    const r = await fetchAttachmentTexts(
      [
        { name: "공고.hwp", url: `${B}1.hwp`, kind: "hwp" },
        { name: "참고.pdf", url: `${B}2.pdf`, kind: "pdf" },
      ],
      opts(fetch, { maxFiles: 1, extraAttempts: 1 }),
    );
    expect(calls).toHaveLength(1);
    expect(r.files).toEqual([
      expect.objectContaining({ name: "공고.hwp", result: "read", reason: "preview_only" }),
      expect.objectContaining({ name: "참고.pdf", result: "skipped", reason: "over_limit" }),
    ]);
  });
});

describe("listedAttachmentNames — AI 에게 보일 첨부 이름 목록", () => {
  it("원래 차례로 모든 형식(zip·xlsx 포함)을 담고, 사이트 공통·뒤쪽 같은 요청은 뺀다(되살린 주소로 비교)", () => {
    const raw = [
      { name: "공고문.hwp", url: "https://www.khidi.or.kr/board/view?linkId=1&paramMenuId=MENU01", kind: "hwp" },
      { name: "서식 모음.zip", url: `${B}2.zip`, kind: "zip" },
      { name: "", url: `${B}3.xlsx`, kind: "etc" },
      { name: "pages.pdf", url: "https://www.cba.ne.kr/ebook/2026/pages.pdf", kind: "pdf" },
      { name: "공고문 사본.hwp", url: "https://www.khidi.or.kr/board/view?linkId=1%C2%B6mMenuId=MENU01", kind: "hwp" },
      {
        name: "관리지침.pdf",
        url: "https://www.exportvoucher.com/common.FileDownload.do?file_id=FILE_000000007042784",
        kind: "pdf",
      },
      { name: "참고.pdf", url: `${B}4.pdf`, kind: "pdf" },
    ];
    expect(listedAttachmentNames(raw)).toEqual(["공고문.hwp", "서식 모음.zip", `${B}3.xlsx`, "참고.pdf"]);
  });

  it("배열이 아니면 빈 목록", () => {
    expect(listedAttachmentNames(null)).toEqual([]);
    expect(listedAttachmentNames(undefined)).toEqual([]);
    expect(listedAttachmentNames({ name: "a.pdf", url: `${B}a` })).toEqual([]);
    expect(listedAttachmentNames("a.pdf")).toEqual([]);
  });

  it("모양이 깨진 항목(이름·주소 모두 없음)은 뺀다", () => {
    expect(listedAttachmentNames([{}, { name: "  ", url: "" }, null, 3, { name: "a.pdf", url: `${B}a` }])).toEqual([
      "a.pdf",
    ]);
  });
});
