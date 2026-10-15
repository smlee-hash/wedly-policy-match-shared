import AdmZip from "adm-zip";
import { utils, write } from "cfb";
import iconv from "iconv-lite";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { describe, expect, it, vi } from "vitest";
import { blankPdf, docxOf, hwpxOf, pdfOf } from "../documents/__fixtures__/samples";
import {
  extractPdfBytes,
  fetchAttachmentTexts,
  type AttachmentFileReason,
  type AttachmentTextResult,
  type FetchAttachmentTextsOptions,
} from "./attachment-text";
import type { PolicyAttachmentRequest } from "./board/types";

/**
 * 공고 첨부로 온 zip(압축 파일)을 열어 안의 문서를 읽는다(2026-10-01 「첨부파일 글자 추출 누락」 4b번).
 *
 * 운영 실측: 「첨부를 다 읽지 못함」 공고 5,814건 중 618건에 zip 첨부가 있었다.
 * 예전에는 zip 을 후보에서 빼거나 「압축 묶음(archive)」 실패로 끝내서, 안에 든 공고문·지침을 AI 가 못 봤다.
 *
 * `readArchives` 를 켤 때만 연다(기본은 예전 그대로).
 *  · 연 zip 자체는 결과 줄을 남기지 않는다. 안의 항목을 `서식.zip › 공고문.pdf` 처럼 「zip 이름 › 안 경로」로 남긴다.
 *  · 항목은 공고문 쪽 이름 → 형식 → zip 순서로 읽고, 많아야 20개만 보인다. 나머지는 「외 N개」 한 줄로 알린다.
 *  · zip 내려받기가 시도 하나를 쓰고, 첫 항목 풀기는 그 값으로 친다. 둘째 항목부터는 풀 때마다 시도 하나를 쓴다.
 *  · 이름·머리만 보고 거를 수 있는 항목(그림·zip 속 압축·모르는 형식·암호·모르는 압축 방식·한도 넘는 크기)은 시도를 쓰지 않는다.
 *  · `sameDocumentOnce` 와 함께 켜면, 이미 온전히 읽은 문서와 이름이 같은 것은 zip 안팎 어디서든 「같은 문서 다른 형식」이다.
 */

const B = "https://www.bizinfo.go.kr/cmm/fms/fileDown.do?file=";
const EOCD = Buffer.from([0x50, 0x4b, 0x05, 0x06]);

async function makePdf(text: string): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 200]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText(text, { x: 24, y: 100, size: 12, font });
  return Buffer.from(await doc.save());
}

/** 한글 5 OLE — 본문 줄기 없이 미리보기(PrvText)만. */
function hwpPreviewOnly(preview: string): Buffer {
  const cfb = utils.cfb_new();
  const header = Buffer.alloc(256);
  header.write("HWP Document File", 0, "ascii");
  header[35] = 5;
  utils.cfb_add(cfb, "FileHeader", header);
  utils.cfb_add(cfb, "PrvText", Buffer.from(preview, "utf16le"));
  return Buffer.from(write(cfb, { type: "buffer" }));
}

type NameCodec = { efs: boolean; encode(s: string): Buffer; decode(b: Buffer | Uint8Array): string };

/** 윈도 탐색기처럼 이름을 CP949 로 적고 UTF-8 표시(EFS)는 끈다. */
const CP949: NameCodec = {
  efs: false,
  encode: (s) => iconv.encode(s, "cp949"),
  decode: (b) => iconv.decode(Buffer.from(b), "cp949"),
};

/** 넣은 순서 그대로(이름순 정렬 없이) zip 을 만든다. codec 을 주면 이름을 그 방식으로 적는다. */
function zipInOrder(entries: Array<[string, string | Buffer]>, codec?: NameCodec): Buffer {
  const zip = new AdmZip(undefined, { noSort: true, ...(codec ? { decoder: codec } : {}) });
  for (const [name, v] of entries) zip.addFile(name, typeof v === "string" ? Buffer.from(v, "utf8") : v);
  return zip.toBuffer();
}

/** 첫 항목의 중앙 머리·지역 머리 위치. */
function firstHeaders(buf: Buffer): { cen: number; loc: number } {
  const eocd = buf.lastIndexOf(EOCD);
  const cen = buf.readUInt32LE(eocd + 16);
  return { cen, loc: buf.readUInt32LE(cen + 42) };
}

/** 첫 항목 머리를 고쳐 쓴다: 압축 방식·암호 표시. */
function patchFirst(buf: Buffer, p: { method?: number; encrypted?: boolean }): Buffer {
  const out = Buffer.from(buf);
  const { cen, loc } = firstHeaders(out);
  if (p.method !== undefined) {
    out.writeUInt16LE(p.method, cen + 10);
    out.writeUInt16LE(p.method, loc + 8);
  }
  if (p.encrypted) {
    out.writeUInt16LE(out.readUInt16LE(cen + 8) | 1, cen + 8);
    out.writeUInt16LE(out.readUInt16LE(loc + 6) | 1, loc + 6);
  }
  return out;
}

/** 첫 항목의 압축된 데이터 가운데 몇 바이트를 뒤집는다. */
function corruptFirst(buf: Buffer): Buffer {
  const out = Buffer.from(buf);
  const { loc } = firstHeaders(out);
  const start = loc + 30 + out.readUInt16LE(loc + 26) + out.readUInt16LE(loc + 28);
  for (let i = start + 5; i < start + 15; i += 1) out[i] ^= 0xff;
  return out;
}

const ok = (body: Buffer | Uint8Array) => new Response(Uint8Array.from(body), { status: 200 });
const notFound = () => new Response("gone", { status: 404 });

/** 주소 끝 번호마다 응답을 정한다. 정하지 않은 번호는 404. 부른 주소를 차례로 남긴다. */
function serve(plan: Record<number, () => Response>) {
  const calls: string[] = [];
  const fetch = vi.fn(async (url: string) => {
    calls.push(url);
    const make = plan[Number(url.slice(B.length))];
    return make ? make() : notFound();
  });
  return { calls, fetch };
}

const opts = (fetch: unknown, more: Partial<FetchAttachmentTextsOptions> = {}): FetchAttachmentTextsOptions => ({
  extractHwpx: () => "",
  fetch: fetch as never,
  ...more,
});

/** 압축 파일 열기 켜기. */
const arc = (fetch: unknown, more: Partial<FetchAttachmentTextsOptions> = {}) =>
  opts(fetch, { readArchives: true, ...more });

type Kind = PolicyAttachmentRequest["kind"];

function numbered(items: Array<[string, Kind]>): PolicyAttachmentRequest[] {
  return items.map(([name, kind], i) => ({ name, kind, url: `${B}${i}` }));
}

/** zip 안 항목의 표시 이름. */
const Z = (zip: string, path: string) => `${zip} › ${path}`;

/** files 를 이름·결과·이유만 남겨 비교한다. */
function rows(r: AttachmentTextResult) {
  return (r.files ?? []).map(({ name, result, reason }) => (reason ? { name, result, reason } : { name, result }));
}
const read = (name: string) => ({ name, result: "read" });
/** 이유 칸은 AttachmentFileReason 이어야 한다 — 새 이유(nested_archive 등)가 타입에 없으면 타입 검사가 막는다. */
const failed = (name: string, reason: AttachmentFileReason) => ({ name, result: "failed", reason });
const overLimit = (name: string) => ({ name, result: "skipped", reason: "over_limit" });
const variant = (name: string) => ({ name, result: "duplicate", reason: "same_document" });

/** 기대 본문 — 같은 PDF 를 바로 뽑은 글자. pdf.js 가 받은 버퍼를 비울 수 있어 복사본을 넘긴다. */
const pdfBody = async (pdf: Buffer) => (await extractPdfBytes(Uint8Array.from(pdf))).trim();

describe("readArchives 꺼짐 — 예전 그대로", () => {
  it("옵션이 없거나 false 면 zip 첨부는 후보에서 빠지고 부르지도 않는다", async () => {
    const zip = zipInOrder([["공고문.pdf", await makePdf("INNER NOTICE")]]);
    const pdf = await makePdf("OUTER NOTICE");
    const items = numbered([
      ["서식.zip", "zip"],
      ["공고문.pdf", "pdf"],
    ]);
    const one = serve({ 0: () => ok(zip), 1: () => ok(pdf) });
    const two = serve({ 0: () => ok(zip), 1: () => ok(pdf) });

    const unset = await fetchAttachmentTexts(items, opts(one.fetch));
    const off = await fetchAttachmentTexts(items, opts(two.fetch, { readArchives: false }));

    expect(one.calls).toEqual([`${B}1`]);
    expect(two.calls).toEqual([`${B}1`]);
    expect(off).toEqual(unset);
    expect(rows(unset)).toEqual([read("공고문.pdf")]);
  });

  it("이름이 zip 이 아니어도 속이 압축 묶음이면, 꺼져 있을 때는 「archive」 실패로 남는다", async () => {
    const zip = zipInOrder([["공고문.pdf", await makePdf("INNER NOTICE")]]);
    const { fetch } = serve({ 0: () => ok(zip) });

    const r = await fetchAttachmentTexts(numbered([["첨부.bin", "etc"]]), opts(fetch));

    expect(rows(r)).toEqual([failed("첨부.bin", "archive")]);
    expect(r.text).toBe("[읽지 못한 첨부: 첨부.bin]");
  });
});

describe("readArchives 켜짐 — zip 을 열어 안의 문서를 읽는다", () => {
  it("공고문 쪽 이름을 먼저 읽고, 「zip 이름 › 안 경로」로 남기며 zip 자체 줄은 없다", async () => {
    const form = await makePdf("FORM BODY");
    const notice = await makePdf("NOTICE BODY");
    const zip = zipInOrder([
      ["신청서.pdf", form],
      ["공고문.pdf", notice],
    ]);
    const { calls, fetch } = serve({ 0: () => ok(zip) });

    const r = await fetchAttachmentTexts(numbered([["서식.zip", "zip"]]), arc(fetch, { maxFiles: 5 }));

    expect(calls).toEqual([`${B}0`]);
    expect(rows(r)).toEqual([read(Z("서식.zip", "공고문.pdf")), read(Z("서식.zip", "신청서.pdf"))]);
    expect(r.readFiles).toEqual([Z("서식.zip", "공고문.pdf"), Z("서식.zip", "신청서.pdf")]);
    expect(r.failedFiles).toEqual([]);
    expect(r.skippedFiles).toEqual([]);
    expect(r.text).toBe(
      `[첨부: 서식.zip › 공고문.pdf]\n${await pdfBody(notice)}\n\n[첨부: 서식.zip › 신청서.pdf]\n${await pdfBody(form)}`,
    );
  });

  it("zip 안의 한글(hwpx)·워드(docx) 항목도 그 형식으로 읽는다", async () => {
    const hwpx = hwpxOf(["무시되는 본문"]);
    const extractHwpx = vi.fn((buf: Buffer) => (buf.length > 0 ? "한글 공고 본문" : ""));
    const zip = zipInOrder([
      ["신청서.docx", docxOf(["신청서 양식 본문"])],
      ["공고문.hwpx", hwpx],
    ]);
    const { fetch } = serve({ 0: () => ok(zip) });

    const r = await fetchAttachmentTexts(numbered([["서식.zip", "zip"]]), arc(fetch, { maxFiles: 5, extractHwpx }));

    expect(extractHwpx).toHaveBeenCalledTimes(1);
    expect(Buffer.from(extractHwpx.mock.calls[0]?.[0] ?? Buffer.alloc(0)).equals(hwpx)).toBe(true);
    expect(r.files?.map(({ name, result, kind }) => ({ name, result, kind }))).toEqual([
      { name: Z("서식.zip", "공고문.hwpx"), result: "read", kind: "hwpx" },
      { name: Z("서식.zip", "신청서.docx"), result: "read", kind: "docx" },
    ]);
    expect(r.text).toContain("[첨부: 서식.zip › 공고문.hwpx]\n한글 공고 본문");
    expect(r.text).toContain("[첨부: 서식.zip › 신청서.docx]");
    expect(r.text).toContain("신청서 양식 본문");
  });

  it("이름이 zip 이 아니어도 속이 압축 묶음이면 연다", async () => {
    const zip = zipInOrder([["공고문.pdf", await makePdf("NOTICE BODY")]]);
    const { fetch } = serve({ 0: () => ok(zip) });

    const r = await fetchAttachmentTexts(numbered([["첨부.bin", "etc"]]), arc(fetch));

    expect(rows(r)).toEqual([read(Z("첨부.bin", "공고문.pdf"))]);
  });

  it("이름이 .hwp 인 압축 묶음도 한글로 한 번 더 읽어 보고 안 되면 연다", async () => {
    const zip = zipInOrder([["공고문.pdf", await makePdf("NOTICE BODY")]]);
    const { fetch } = serve({ 0: () => ok(zip) });

    const r = await fetchAttachmentTexts(numbered([["공고.hwp", "hwp"]]), arc(fetch));

    expect(rows(r)).toEqual([read(Z("공고.hwp", "공고문.pdf"))]);
  });

  it("이름이 .hwpx 인 압축 묶음은 한글 추출기를 한 번 부른 뒤 연다", async () => {
    const zip = zipInOrder([["공고문.pdf", await makePdf("NOTICE BODY")]]);
    const extractHwpx = vi.fn(() => "");
    const { fetch } = serve({ 0: () => ok(zip) });

    const r = await fetchAttachmentTexts(numbered([["공고.hwpx", "hwpx"]]), arc(fetch, { extractHwpx }));

    expect(extractHwpx).toHaveBeenCalledTimes(1);
    expect(rows(r)).toEqual([read(Z("공고.hwpx", "공고문.pdf"))]);
  });

  it("윈도에서 만든(CP949 이름) zip 의 항목 이름을 바르게 보인다", async () => {
    const zip = zipInOrder([["붙임1. 공고문.pdf", await makePdf("NOTICE BODY")]], CP949);
    const { fetch } = serve({ 0: () => ok(zip) });

    const r = await fetchAttachmentTexts(numbered([["서식.zip", "zip"]]), arc(fetch));

    expect(rows(r)).toEqual([read(Z("서식.zip", "붙임1. 공고문.pdf"))]);
  });

  it("CP949 이름 둘이 UTF-8 로는 같은 이름이 되는 zip(공고.pdf·서식.pdf)도 열어 둘 다 읽는다", async () => {
    const zip = zipInOrder(
      [
        ["서식.pdf", await makePdf("FORM BODY")],
        ["공고.pdf", await makePdf("NOTICE BODY")],
      ],
      CP949,
    );
    const { fetch } = serve({ 0: () => ok(zip) });

    const r = await fetchAttachmentTexts(numbered([["첨부.zip", "zip"]]), arc(fetch, { maxFiles: 5 }));

    expect(rows(r)).toEqual([read(Z("첨부.zip", "공고.pdf")), read(Z("첨부.zip", "서식.pdf"))]);
  });

  it("맥 잡동사니뿐이라 남는 항목이 없으면 zip 을 「no_text」 실패로 남긴다", async () => {
    const zip = zipInOrder([
      ["__MACOSX/._공고.pdf", "mac"],
      [".DS_Store", "ds"],
    ]);
    const { fetch } = serve({ 0: () => ok(zip) });

    const r = await fetchAttachmentTexts(numbered([["서식.zip", "zip"]]), arc(fetch));

    expect(rows(r)).toEqual([failed("서식.zip", "no_text")]);
    expect(r.failedFiles).toEqual(["서식.zip"]);
    expect(r.text).toBe("[읽지 못한 첨부: 서식.zip]");
  });

  it("zip 을 못 받으면(404) 예전처럼 not_found", async () => {
    const { fetch } = serve({});

    const r = await fetchAttachmentTexts(numbered([["서식.zip", "zip"]]), arc(fetch));

    expect(rows(r)).toEqual([failed("서식.zip", "not_found")]);
  });

  it("글자 상한에 잘린 항목은 표시 이름으로 「truncated」", async () => {
    const long = await pdfOf([
      "LINE ONE OF THE NOTICE BODY",
      "LINE TWO OF THE NOTICE BODY",
      "LINE THREE OF THE NOTICE BODY",
    ]);
    const zip = zipInOrder([["공고문.pdf", long]]);
    const { fetch } = serve({ 0: () => ok(zip) });

    const r = await fetchAttachmentTexts(numbered([["서식.zip", "zip"]]), arc(fetch, { totalCharCap: 70 }));

    expect(rows(r)).toEqual([{ name: Z("서식.zip", "공고문.pdf"), result: "read", reason: "truncated" }]);
    expect(r.skippedFiles).toContain(Z("서식.zip", "공고문.pdf"));
    expect(r.text).toContain("[첨부 잘림: 서식.zip › 공고문.pdf]");
  });
});

describe("readArchives — 읽을 수·시도 수", () => {
  it("zip 내려받기가 시도 하나를 쓰고 첫 항목 풀기는 그 값으로 친다 — 읽은 수가 차면 나머지는 개수 상한", async () => {
    const notice = await makePdf("NOTICE BODY");
    const zip = zipInOrder([
      ["공고문.pdf", notice],
      ["지침.hwp", "HWP"],
    ]);
    const { fetch } = serve({ 0: () => ok(zip) });

    const r = await fetchAttachmentTexts(numbered([["서식.zip", "zip"]]), arc(fetch));

    expect(rows(r)).toEqual([read(Z("서식.zip", "공고문.pdf")), overLimit(Z("서식.zip", "지침.hwp"))]);
    expect(r.skippedFiles).toEqual([Z("서식.zip", "지침.hwp")]);
    expect(r.text).toBe(
      `[첨부: 서식.zip › 공고문.pdf]\n${await pdfBody(notice)}\n\n[미확인 첨부: 서식.zip › 지침.hwp]`,
    );
  });

  it("못 읽은 첫 항목 대신 더 시도할 수(extraAttempts)로 다음 항목을 읽는다", async () => {
    const zip = zipInOrder([
      ["공고문.pdf", await blankPdf()],
      ["지침.pdf", await makePdf("GUIDE BODY")],
      ["서식.hwp", "HWP"],
    ]);
    const { fetch } = serve({ 0: () => ok(zip) });

    const r = await fetchAttachmentTexts(numbered([["서식.zip", "zip"]]), arc(fetch, { extraAttempts: 1 }));

    expect(rows(r)).toEqual([
      failed(Z("서식.zip", "공고문.pdf"), "image_pdf"),
      read(Z("서식.zip", "지침.pdf")),
      overLimit(Z("서식.zip", "서식.hwp")),
    ]);
  });

  it("둘째 항목부터는 풀 때마다 시도 하나를 쓴다", async () => {
    const zip = zipInOrder([
      ["a.pdf", await blankPdf()],
      ["b.pdf", await makePdf("B BODY")],
      ["c.pdf", await makePdf("C BODY")],
    ]);
    const { fetch } = serve({ 0: () => ok(zip) });

    const r = await fetchAttachmentTexts(numbered([["서식.zip", "zip"]]), arc(fetch, { maxFiles: 2 }));

    expect(rows(r)).toEqual([
      failed(Z("서식.zip", "a.pdf"), "image_pdf"),
      read(Z("서식.zip", "b.pdf")),
      overLimit(Z("서식.zip", "c.pdf")),
    ]);
  });

  it("zip 은 같은 역할의 문서 첨부보다 뒤이고, 앞 첨부로 읽은 수가 차면 내려받지도 않는다", async () => {
    const zip = zipInOrder([["안내.pdf", await makePdf("INNER")]]);
    const outer = await makePdf("OUTER");
    const { calls, fetch } = serve({ 0: () => ok(zip), 1: () => ok(outer) });

    const r = await fetchAttachmentTexts(
      numbered([
        ["공고.zip", "zip"],
        ["공고문.pdf", "pdf"],
      ]),
      arc(fetch),
    );

    expect(calls).toEqual([`${B}1`]);
    expect(rows(r)).toEqual([read("공고문.pdf"), overLimit("공고.zip")]);
  });

  it("항목은 많아야 20개만 보이고 나머지는 「외 N개」 한 줄로 알린다 — 개수 상한 줄은 넣은 차례", async () => {
    const pdf = await makePdf("ATTACHED FORM");
    const names = Array.from({ length: 23 }, (_, i) => `붙임${String(i + 1).padStart(2, "0")}.pdf`);
    const zip = zipInOrder(names.map((n): [string, Buffer] => [n, pdf]));
    const outer = await makePdf("OUTER FORM");
    const { calls, fetch } = serve({ 0: () => ok(zip), 1: () => ok(outer) });

    const r = await fetchAttachmentTexts(
      numbered([
        ["공고.zip", "zip"],
        ["신청서.pdf", "pdf"],
      ]),
      arc(fetch),
    );

    const shownButSkipped = names.slice(1, 20).map((n) => Z("공고.zip", n));
    expect(calls).toEqual([`${B}0`]);
    expect(rows(r)).toEqual([
      read(Z("공고.zip", "붙임01.pdf")),
      ...shownButSkipped.map(overLimit),
      overLimit("공고.zip › 외 3개"),
      overLimit("신청서.pdf"),
    ]);
    expect(r.skippedFiles).toEqual([...shownButSkipped, "공고.zip › 외 3개", "신청서.pdf"]);
    expect(r.text.endsWith("[미확인 첨부: 공고.zip › 외 3개]\n\n[미확인 첨부: 신청서.pdf]")).toBe(true);
    expect(r.text).not.toContain("붙임21");
  });
});

describe("readArchives — 이름·머리만 보고 거르는 항목은 시도를 쓰지 않는다", () => {
  it("그림·zip 속 압축·모르는 형식은 풀지 않고 그 이유로 실패 — 읽을 수가 다 차도 개수 상한으로 돌리지 않는다", async () => {
    const zip = zipInOrder([
      ["내부.zip", zipInOrder([["안.pdf", "PDF"]])],
      ["메모.txt", "memo"],
      ["공고문.pdf", await makePdf("NOTICE BODY")],
      ["묶음.7z", "7z"],
      ["포스터.jpg", "jpg"],
    ]);
    const { calls, fetch } = serve({ 0: () => ok(zip) });

    const r = await fetchAttachmentTexts(numbered([["서식.zip", "zip"]]), arc(fetch));

    expect(calls).toEqual([`${B}0`]);
    expect(rows(r)).toEqual([
      read(Z("서식.zip", "공고문.pdf")),
      failed(Z("서식.zip", "메모.txt"), "unknown_format"),
      failed(Z("서식.zip", "묶음.7z"), "nested_archive"),
      failed(Z("서식.zip", "내부.zip"), "nested_archive"),
      failed(Z("서식.zip", "포스터.jpg"), "image"),
    ]);
    expect(r.failedFiles).toEqual([
      Z("서식.zip", "메모.txt"),
      Z("서식.zip", "묶음.7z"),
      Z("서식.zip", "내부.zip"),
      Z("서식.zip", "포스터.jpg"),
    ]);
    expect(r.skippedFiles).toEqual([]);
    expect(r.text).toContain("[읽지 못한 첨부: 서식.zip › 포스터.jpg]");
  });

  it("이름은 문서인데 속이 압축 묶음이면 풀어 본 뒤 「nested_archive」", async () => {
    const zip = zipInOrder([["공고문.pdf", zipInOrder([["안.pdf", await makePdf("DEEP")]])]]);
    const { fetch } = serve({ 0: () => ok(zip) });

    const r = await fetchAttachmentTexts(numbered([["서식.zip", "zip"]]), arc(fetch));

    expect(rows(r)).toEqual([failed(Z("서식.zip", "공고문.pdf"), "nested_archive")]);
  });

  it("암호가 걸린 항목은 「protected」 — 풀지 않으므로 다음 항목이 첫 풀기 값을 쓴다", async () => {
    const zip = patchFirst(
      zipInOrder([
        ["공고문.pdf", await makePdf("LOCKED")],
        ["지침.pdf", await makePdf("GUIDE BODY")],
      ]),
      { encrypted: true },
    );
    const { fetch } = serve({ 0: () => ok(zip) });

    const r = await fetchAttachmentTexts(numbered([["서식.zip", "zip"]]), arc(fetch));

    expect(rows(r)).toEqual([failed(Z("서식.zip", "공고문.pdf"), "protected"), read(Z("서식.zip", "지침.pdf"))]);
  });

  it("머리에 적힌 크기가 한도(maxBytes)를 넘으면 풀지 않고 「too_big」", async () => {
    const zip = zipInOrder([
      ["공고문.pdf", Buffer.alloc(50_000, 0x41)],
      ["지침.pdf", await makePdf("GUIDE BODY")],
    ]);
    expect(zip.length).toBeLessThan(5_000);
    const { fetch } = serve({ 0: () => ok(zip) });

    const r = await fetchAttachmentTexts(numbered([["서식.zip", "zip"]]), arc(fetch, { maxBytes: 5_000 }));

    expect(rows(r)).toEqual([failed(Z("서식.zip", "공고문.pdf"), "too_big"), read(Z("서식.zip", "지침.pdf"))]);
  });

  it("모르는 압축 방식이면 풀지 않고 「unsupported」", async () => {
    const zip = patchFirst(
      zipInOrder([
        ["공고문.pdf", await makePdf("ODD METHOD")],
        ["지침.pdf", await makePdf("GUIDE BODY")],
      ]),
      { method: 12 },
    );
    const { fetch } = serve({ 0: () => ok(zip) });

    const r = await fetchAttachmentTexts(numbered([["서식.zip", "zip"]]), arc(fetch));

    expect(rows(r)).toEqual([failed(Z("서식.zip", "공고문.pdf"), "unsupported"), read(Z("서식.zip", "지침.pdf"))]);
  });

  it("풀다 깨진 항목은 「no_text」이고 첫 풀기 값을 써 버린다", async () => {
    const zip = corruptFirst(
      zipInOrder([
        ["공고문.pdf", await makePdf("BROKEN")],
        ["지침.pdf", await makePdf("GUIDE BODY")],
      ]),
    );
    const { fetch } = serve({ 0: () => ok(zip) });

    const r = await fetchAttachmentTexts(numbered([["서식.zip", "zip"]]), arc(fetch));

    expect(rows(r)).toEqual([failed(Z("서식.zip", "공고문.pdf"), "no_text"), overLimit(Z("서식.zip", "지침.pdf"))]);
  });
});

describe("readArchives + sameDocumentOnce — 같은 문서는 zip 안팎에서 한 번만", () => {
  const both = (fetch: unknown, more: Partial<FetchAttachmentTextsOptions> = {}) =>
    arc(fetch, { sameDocumentOnce: true, ...more });

  it("밖에서 온전히 읽은 문서와 이름이 같은 zip 항목은 풀지 않고 「같은 문서 다른 형식」", async () => {
    const extractHwpx = vi.fn(() => "한글 공고 본문");
    const zip = zipInOrder([
      ["공고문.pdf", await makePdf("SAME NOTICE")],
      ["신청서.docx", docxOf(["신청서 양식 본문"])],
    ]);
    const { calls, fetch } = serve({ 0: () => ok(hwpxOf(["무시"])), 1: () => ok(zip) });

    const r = await fetchAttachmentTexts(
      numbered([
        ["공고문.hwpx", "hwpx"],
        ["서식.zip", "zip"],
      ]),
      both(fetch, { maxFiles: 2, extractHwpx }),
    );

    expect(calls).toEqual([`${B}0`, `${B}1`]);
    expect(rows(r)).toEqual([
      read("공고문.hwpx"),
      variant(Z("서식.zip", "공고문.pdf")),
      read(Z("서식.zip", "신청서.docx")),
    ]);
    expect(r.sameDocumentFiles).toEqual([Z("서식.zip", "공고문.pdf")]);
    expect(r.text).toContain("[첨부: 공고문.hwpx]\n한글 공고 본문\n\n[같은 문서 다른 형식: 서식.zip › 공고문.pdf]\n\n[첨부: 서식.zip › 신청서.docx]");
    expect(extractHwpx).toHaveBeenCalledTimes(1);
  });

  it("zip 안에서도 먼저 읽은 문서와 이름이 같으면 「같은 문서 다른 형식」 — 읽을 수가 다 차도 개수 상한보다 먼저", async () => {
    const zip = zipInOrder([
      ["공고문.hwp", "HWP"],
      ["공고문.pdf", await makePdf("NOTICE BODY")],
    ]);
    const { fetch } = serve({ 0: () => ok(zip) });

    const r = await fetchAttachmentTexts(numbered([["서식.zip", "zip"]]), both(fetch));

    expect(rows(r)).toEqual([read(Z("서식.zip", "공고문.pdf")), variant(Z("서식.zip", "공고문.hwp"))]);
    expect(r.sameDocumentFiles).toEqual([Z("서식.zip", "공고문.hwp")]);
  });

  it("못 읽은 항목은 같은 문서로 치지 않는다 — 같은 이름 다른 형식을 이어서 읽는다", async () => {
    const zip = zipInOrder([
      ["공고문.pdf", await blankPdf()],
      ["공고문.docx", docxOf(["공고 본문 워드"])],
    ]);
    const { fetch } = serve({ 0: () => ok(zip) });

    const r = await fetchAttachmentTexts(numbered([["서식.zip", "zip"]]), both(fetch, { extraAttempts: 1 }));

    expect(rows(r)).toEqual([failed(Z("서식.zip", "공고문.pdf"), "image_pdf"), read(Z("서식.zip", "공고문.docx"))]);
  });

  it("zip 안에서 읽은 문서와 이름이 같은 바깥 첨부는 내려받지 않는다 — 읽을 수가 다 차도 개수 상한보다 먼저", async () => {
    const zip = zipInOrder([["신청서.docx", docxOf(["신청서 양식 본문"])]]);
    const form = await makePdf("FORM");
    const { calls, fetch } = serve({ 0: () => ok(zip), 1: () => ok(form) });

    const r = await fetchAttachmentTexts(
      numbered([
        ["공고문 및 서식.zip", "zip"],
        ["신청서.pdf", "pdf"],
      ]),
      both(fetch),
    );

    expect(calls).toEqual([`${B}0`]);
    expect(rows(r)).toEqual([read(Z("공고문 및 서식.zip", "신청서.docx")), variant("신청서.pdf")]);
    expect(r.sameDocumentFiles).toEqual(["신청서.pdf"]);
  });

  it("바깥 같은 문서 묶음도 zip 안에서 읽었으면 모두 「같은 문서 다른 형식」", async () => {
    const zip = zipInOrder([["신청서.pdf", await makePdf("FORM BODY")]]);
    const { calls, fetch } = serve({ 0: () => ok(zip) });

    const r = await fetchAttachmentTexts(
      numbered([
        ["공고.zip", "zip"],
        ["신청서.pdf", "pdf"],
        ["신청서.hwp", "hwp"],
      ]),
      both(fetch, { maxFiles: 5 }),
    );

    expect(calls).toEqual([`${B}0`]);
    expect(rows(r)).toEqual([read(Z("공고.zip", "신청서.pdf")), variant("신청서.hwp"), variant("신청서.pdf")]);
  });

  it("sameDocumentOnce 를 안 켜면 이름이 같아도 모두 읽는다", async () => {
    const extractHwpx = vi.fn(() => "한글 공고 본문");
    const zip = zipInOrder([
      ["공고문.pdf", await makePdf("SAME NOTICE")],
      ["신청서.docx", docxOf(["신청서 양식 본문"])],
    ]);
    const { fetch } = serve({ 0: () => ok(hwpxOf(["무시"])), 1: () => ok(zip) });

    const r = await fetchAttachmentTexts(
      numbered([
        ["공고문.hwpx", "hwpx"],
        ["서식.zip", "zip"],
      ]),
      arc(fetch, { maxFiles: 3, extractHwpx }),
    );

    expect(rows(r)).toEqual([
      read("공고문.hwpx"),
      read(Z("서식.zip", "공고문.pdf")),
      read(Z("서식.zip", "신청서.docx")),
    ]);
    expect(r.sameDocumentFiles).toBeUndefined();
  });
});

describe("readArchives — 자동 저장 모드(includeHwpPreview false)", () => {
  it("미리보기뿐인 한글 항목은 미확인으로 두고, 더 시도할 수로 다음 항목을 읽는다", async () => {
    const zip = zipInOrder([
      ["공고.hwp", hwpPreviewOnly("PREVIEW TEXT")],
      ["신청서.pdf", await makePdf("FORM BODY")],
    ]);
    const { fetch } = serve({ 0: () => ok(zip) });

    const r = await fetchAttachmentTexts(
      numbered([["서식.zip", "zip"]]),
      arc(fetch, { extraAttempts: 1, includeHwpPreview: false }),
    );

    expect(rows(r)).toEqual([
      { name: Z("서식.zip", "공고.hwp"), result: "skipped", reason: "preview_only" },
      read(Z("서식.zip", "신청서.pdf")),
    ]);
    expect(r.previewOnlyFiles).toEqual([Z("서식.zip", "공고.hwp")]);
    expect(r.skippedFiles).toEqual([Z("서식.zip", "공고.hwp")]);
    expect(r.text).toContain("[미확인 첨부: 서식.zip › 공고.hwp]");
    expect(r.text).not.toContain("PREVIEW TEXT");
  });

  it("zip 안에서 읽은 본문 글자 수는 같은 파일을 바로 읽은 값과 같다", async () => {
    const notice = await makePdf("NOTICE BODY FOR COUNT");
    const zip = zipInOrder([["공고문.pdf", notice]]);
    const inside = serve({ 0: () => ok(zip) });
    const outside = serve({ 0: () => ok(notice) });

    const a = await fetchAttachmentTexts(
      numbered([["서식.zip", "zip"]]),
      arc(inside.fetch, { includeHwpPreview: false }),
    );
    const b = await fetchAttachmentTexts(
      numbered([["공고문.pdf", "pdf"]]),
      opts(outside.fetch, { includeHwpPreview: false }),
    );

    expect(b.bodyTextChars).toBeGreaterThan(0);
    expect(a.bodyTextChars).toBe(b.bodyTextChars);
  });
});
