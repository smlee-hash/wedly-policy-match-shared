import { utils, write } from "cfb";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { describe, expect, it, vi } from "vitest";
import { hwpxOf, xlsxTableOf } from "../documents/__fixtures__/samples";
import { sameDocumentKey } from "./attachment-order";
import { renderAttachmentBlocks } from "./attachment-render";
import { extractPdfBytes, fetchAttachmentTexts, type FetchAttachmentTextsOptions } from "./attachment-text";
import type { PolicyAttachmentRequest } from "./board/types";

/**
 * 같은 문서를 형식만 바꿔 여러 개 올린 공고는 한 번만 읽는다(2026-10-01 「첨부파일 글자 추출 누락」 4번).
 *
 * 운영 실측에서 본 것:
 *  · 과기정통부·해양수산부는 같은 공고를 `공고.hwp`·`공고.hwpx`·`공고.pdf`·`공고.odt` 로 함께 올린다.
 *    읽을 수(maxFiles)가 같은 글로 다 차서 신청서·지침 같은 다른 문서를 못 봤다.
 *  · 앞 형식이 404·미리보기뿐이면 같은 문서의 다른 형식이 있는데도 「확인 필요」로 끝났다.
 * 이름(크기 꼬리를 뗀 확장자 앞부분)이 같으면 같은 문서로 묶고, 읽기 좋은 형식부터 시도해 온전히 읽힌 하나만 남긴다.
 * 나머지는 「같은 문서 다른 형식」(`[같은 문서 다른 형식: X]`)으로 존재만 알린다 — 못 읽은 첨부로 세지 않는다.
 * `sameDocumentOnce` 를 켤 때만 그렇게 한다(기본은 예전 그대로).
 */

const B = "https://www.bizinfo.go.kr/cmm/fms/fileDown.do?file=";

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

function hmlBytes(text: string): Buffer {
  return Buffer.from(
    '<?xml version="1.0" encoding="UTF-8"?>' +
      `<HWPML Version="2.8"><HEAD SecCnt="1"/><BODY><SECTION Id="0"><P><TEXT><CHAR>${text}</CHAR></TEXT></P></SECTION></BODY><TAIL/></HWPML>`,
    "utf8",
  );
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

/** 같은 문서 한 번만 켜기. */
const same = (fetch: unknown, more: Partial<FetchAttachmentTextsOptions> = {}) =>
  opts(fetch, { sameDocumentOnce: true, ...more });

type Kind = PolicyAttachmentRequest["kind"];

/** 이름·형식 목록 → 주소 끝이 차례 번호인 첨부(`${B}0`, `${B}1` …). */
function numbered(items: Array<[string, Kind]>): PolicyAttachmentRequest[] {
  return items.map(([name, kind], i) => ({ name, kind, url: `${B}${i}` }));
}

const variant = (name: string) => ({ name, result: "duplicate", reason: "same_document" });

describe("sameDocumentKey — 같은 문서 다른 형식을 가리는 열쇠", () => {
  it.each([
    ["공고문.hwp (68.5K)", { key: "공고문", rank: 1 }],
    ["  2026년  공고  안내 .hwp ", { key: "2026년 공고 안내", rank: 1 }],
    ["Notice.PDF", { key: "notice", rank: 2 }],
    ["공고.hwpx", { key: "공고", rank: 0 }],
    ["공고.odt", { key: "공고", rank: 3 }],
    ["공고.hml", { key: "공고", rank: 4 }],
    ["공고.docx", { key: "공고", rank: 5 }],
    ["공고.doc", { key: "공고", rank: 6 }],
  ])("%s", (name, want) => {
    expect(sameDocumentKey(name)).toEqual(want);
  });

  it("맥에서 올린 NFD 이름도 NFC 열쇠", () => {
    expect(sameDocumentKey(`${"공고".normalize("NFD")}.hwp`)).toEqual({ key: "공고", rank: 1 });
  });

  it.each(["서식 모음.zip", "지원 내용.xlsx", "포스터.png", "공고문", ".hwp", "   .pdf", ""])(
    "%s → null(묶지 않는 형식·이름 없음)",
    (name) => {
      expect(sameDocumentKey(name)).toBeNull();
    },
  );
});

describe("sameDocumentOnce — 같은 문서는 한 번만 읽는다", () => {
  it("[공고.hwp, 공고.pdf]·1개 → 한글 쪽을 먼저 읽고 pdf 는 부르지 않는다", async () => {
    const hwpSide = await makePdf("HWP_SIDE");
    const pdfSide = await makePdf("PDF_SIDE");
    const { calls, fetch } = serve({ 0: () => ok(hwpSide), 1: () => ok(pdfSide) });
    const r = await fetchAttachmentTexts(
      numbered([
        ["공고.hwp", "hwp"],
        ["공고.pdf", "pdf"],
      ]),
      same(fetch, { maxFiles: 1 }),
    );
    expect(calls).toEqual([`${B}0`]);
    expect(r.readFiles).toEqual(["공고.hwp"]);
    expect(r.failedFiles).toEqual([]);
    expect(r.skippedFiles).toEqual([]);
    expect(r.sameDocumentFiles).toEqual(["공고.pdf"]);
    expect(r.files).toEqual([
      expect.objectContaining({ name: "공고.hwp", result: "read", kind: "pdf" }),
      variant("공고.pdf"),
    ]);
    expect(r.text).toContain("HWP_SIDE");
    expect(r.text).not.toContain("PDF_SIDE");
    expect(r.text.startsWith("[첨부: 공고.hwp]\n")).toBe(true);
    expect(r.text.endsWith("\n\n[같은 문서 다른 형식: 공고.pdf]")).toBe(true);
    expect(r.text).not.toContain("[미확인 첨부: 공고.pdf]");
  });

  it("기본(끔)은 예전 그대로 — 형식 순으로 pdf 를 읽고 한글은 over_limit", async () => {
    const hwpSide = await makePdf("HWP_SIDE");
    const pdfSide = await makePdf("PDF_SIDE");
    for (const more of [{}, { sameDocumentOnce: false }]) {
      const { calls, fetch } = serve({ 0: () => ok(hwpSide), 1: () => ok(pdfSide) });
      const r = await fetchAttachmentTexts(
        numbered([
          ["공고.hwp", "hwp"],
          ["공고.pdf", "pdf"],
        ]),
        opts(fetch, { maxFiles: 1, ...more }),
      );
      expect(calls).toEqual([`${B}1`]);
      expect(r.files).toEqual([
        expect.objectContaining({ name: "공고.pdf", result: "read" }),
        expect.objectContaining({ name: "공고.hwp", result: "skipped", reason: "over_limit" }),
      ]);
      expect(r.sameDocumentFiles).toBeUndefined();
      expect(r.text).not.toContain("같은 문서 다른 형식");
    }
  });

  it("[공고.hwp, 공고.odt, 공고.hwpx] → hwpx 를 먼저 읽고 나머지 둘은 같은 문서", async () => {
    const { calls, fetch } = serve({ 2: () => ok(hwpxOf(["x"])) });
    const extractHwpx = vi.fn(() => "HWPX_BODY");
    const r = await fetchAttachmentTexts(
      numbered([
        ["공고.hwp", "hwp"],
        ["공고.odt", "etc"],
        ["공고.hwpx", "hwpx"],
      ]),
      same(fetch, { extractHwpx }),
    );
    expect(calls).toEqual([`${B}2`]);
    expect(r.files).toEqual([
      expect.objectContaining({ name: "공고.hwpx", result: "read", kind: "hwpx" }),
      variant("공고.hwp"),
      variant("공고.odt"),
    ]);
    expect(r.sameDocumentFiles).toEqual(["공고.hwp", "공고.odt"]);
    expect(r.text).toBe(
      "[첨부: 공고.hwpx]\nHWPX_BODY\n\n[같은 문서 다른 형식: 공고.hwp]\n\n[같은 문서 다른 형식: 공고.odt]",
    );
  });

  it("[공고.hwp 404, 공고.pdf]·1개·더 시도 1 → pdf 를 읽고, 한글은 못 읽은 첨부가 아니라 같은 문서", async () => {
    const pdf = await makePdf("PDF_OK");
    const body = (await extractPdfBytes(Uint8Array.from(pdf))).trim();
    expect(body).toContain("PDF_OK");
    const { calls, fetch } = serve({ 1: () => ok(pdf) });
    const r = await fetchAttachmentTexts(
      numbered([
        ["공고.hwp", "hwp"],
        ["공고.pdf", "pdf"],
      ]),
      same(fetch, { maxFiles: 1, extraAttempts: 1 }),
    );
    expect(calls).toEqual([`${B}0`, `${B}1`]);
    expect(r.readFiles).toEqual(["공고.pdf"]);
    expect(r.failedFiles).toEqual([]);
    expect(r.files).toEqual([
      expect.objectContaining({ name: "공고.pdf", result: "read", kind: "pdf" }),
      variant("공고.hwp"),
    ]);
    expect(r.text).toBe(`[첨부: 공고.pdf]\n${body}\n\n[같은 문서 다른 형식: 공고.hwp]`);
  });

  it("[공고.hwp 404, 공고.pdf 404, 신청서.hwp]·더 시도 3 → 둘 다 실패로 남고 신청서를 읽는다", async () => {
    const pdf = await makePdf("FORM_OK");
    const { calls, fetch } = serve({ 2: () => ok(pdf) });
    const r = await fetchAttachmentTexts(
      numbered([
        ["공고.hwp", "hwp"],
        ["공고.pdf", "pdf"],
        ["신청서.hwp", "hwp"],
      ]),
      same(fetch, { extraAttempts: 3 }),
    );
    expect(calls).toEqual([`${B}0`, `${B}1`, `${B}2`]);
    expect(r.failedFiles).toEqual(["공고.hwp", "공고.pdf"]);
    expect(r.readFiles).toEqual(["신청서.hwp"]);
    expect(r.files).toEqual([
      expect.objectContaining({ name: "공고.hwp", result: "failed", reason: "not_found" }),
      expect.objectContaining({ name: "공고.pdf", result: "failed", reason: "not_found" }),
      expect.objectContaining({ name: "신청서.hwp", result: "read" }),
    ]);
    expect(r.sameDocumentFiles).toBeUndefined();
    expect(r.text).toContain("[읽지 못한 첨부: 공고.hwp]");
    expect(r.text).toContain("[읽지 못한 첨부: 공고.pdf]");
    expect(r.text).toContain("FORM_OK");
  });

  it("[공고.hwp 404, 공고.pdf, 신청서.hwp]·더 시도 0 → 한 번만 부르고 나머지는 over_limit", async () => {
    const pdf = await makePdf("NOT_REACHED");
    const { calls, fetch } = serve({ 1: () => ok(pdf), 2: () => ok(pdf) });
    const r = await fetchAttachmentTexts(
      numbered([
        ["공고.hwp", "hwp"],
        ["공고.pdf", "pdf"],
        ["신청서.hwp", "hwp"],
      ]),
      same(fetch),
    );
    expect(calls).toEqual([`${B}0`]);
    expect(r.files).toEqual([
      expect.objectContaining({ name: "공고.hwp", result: "failed", reason: "not_found" }),
      expect.objectContaining({ name: "공고.pdf", result: "skipped", reason: "over_limit" }),
      expect.objectContaining({ name: "신청서.hwp", result: "skipped", reason: "over_limit" }),
    ]);
    expect(r.sameDocumentFiles).toBeUndefined();
  });

  it("[공고.hwp 미리보기뿐, 공고.hml]·1개·더 시도 1 → HML 을 읽고 미리보기는 어디에도 남기지 않는다", async () => {
    const { calls, fetch } = serve({ 0: () => ok(hwpPreviewOnly("PREVIEW_TEXT")), 1: () => ok(hmlBytes("HML_FULL")) });
    const r = await fetchAttachmentTexts(
      numbered([
        ["공고.hwp", "hwp"],
        ["공고.hml", "etc"],
      ]),
      same(fetch, { maxFiles: 1, extraAttempts: 1 }),
    );
    expect(calls).toEqual([`${B}0`, `${B}1`]);
    expect(r.text).toBe("[첨부: 공고.hml]\nHML_FULL\n\n[같은 문서 다른 형식: 공고.hwp]");
    expect(r.readFiles).toEqual(["공고.hml"]);
    expect(r.skippedFiles).toEqual([]);
    expect(r.failedFiles).toEqual([]);
    expect(r.previewOnlyFiles).toBeUndefined();
    expect(r.files).toEqual([
      expect.objectContaining({ name: "공고.hml", result: "read", kind: "hml" }),
      variant("공고.hwp"),
    ]);
  });

  it("[공고.hwp 미리보기뿐, 공고.hml]·1개·더 시도 0 → 미리보기를 예전처럼 남기고 HML 은 over_limit", async () => {
    const { calls, fetch } = serve({ 0: () => ok(hwpPreviewOnly("PREVIEW_TEXT")), 1: () => ok(hmlBytes("HML_FULL")) });
    const r = await fetchAttachmentTexts(
      numbered([
        ["공고.hwp", "hwp"],
        ["공고.hml", "etc"],
      ]),
      same(fetch, { maxFiles: 1 }),
    );
    expect(calls).toEqual([`${B}0`]);
    expect(r.text).toBe("[첨부: 공고.hwp]\n[미확인 첨부: 공고.hwp]\nPREVIEW_TEXT\n\n[미확인 첨부: 공고.hml]");
    expect(r.previewOnlyFiles).toEqual(["공고.hwp"]);
    expect(r.skippedFiles).toEqual(["공고.hwp", "공고.hml"]);
    expect(r.files).toEqual([
      expect.objectContaining({ name: "공고.hwp", result: "read", reason: "preview_only", kind: "hwp" }),
      expect.objectContaining({ name: "공고.hml", result: "skipped", reason: "over_limit" }),
    ]);
    expect(r.sameDocumentFiles).toBeUndefined();
  });

  it("[공고.hwp 미리보기뿐, 공고.hml 404]·더 시도 1 → 미리보기를 예전처럼 남기고 HML 은 실패", async () => {
    const { calls, fetch } = serve({ 0: () => ok(hwpPreviewOnly("PREVIEW_TEXT")) });
    const r = await fetchAttachmentTexts(
      numbered([
        ["공고.hwp", "hwp"],
        ["공고.hml", "etc"],
      ]),
      same(fetch, { maxFiles: 1, extraAttempts: 1 }),
    );
    expect(calls).toEqual([`${B}0`, `${B}1`]);
    expect(r.text).toBe("[첨부: 공고.hwp]\n[미확인 첨부: 공고.hwp]\nPREVIEW_TEXT\n\n[읽지 못한 첨부: 공고.hml]");
    expect(r.readFiles).toEqual(["공고.hwp"]);
    expect(r.previewOnlyFiles).toEqual(["공고.hwp"]);
    expect(r.skippedFiles).toEqual(["공고.hwp"]);
    expect(r.failedFiles).toEqual(["공고.hml"]);
    expect(r.files).toEqual([
      expect.objectContaining({ name: "공고.hwp", result: "read", reason: "preview_only", kind: "hwp" }),
      expect.objectContaining({ name: "공고.hml", result: "failed", reason: "not_found" }),
    ]);
    expect(r.sameDocumentFiles).toBeUndefined();
  });

  it("자동 저장 모드: 미리보기 대신 HML 을 읽으면 미리보기 표시·목록이 없고 본문 글자 수는 HML 만", async () => {
    const { fetch } = serve({ 0: () => ok(hwpPreviewOnly("PREVIEW_TEXT")), 1: () => ok(hmlBytes("HML_FULL")) });
    const r = await fetchAttachmentTexts(
      numbered([
        ["공고.hwp", "hwp"],
        ["공고.hml", "etc"],
      ]),
      same(fetch, { maxFiles: 1, extraAttempts: 1, includeHwpPreview: false }),
    );
    expect(r.text).toBe("[첨부: 공고.hml]\nHML_FULL\n\n[같은 문서 다른 형식: 공고.hwp]");
    expect(r.previewOnlyFiles).toBeUndefined();
    expect(r.skippedFiles).toEqual([]);
    expect(r.bodyTextChars).toBe("HML_FULL".length);
    expect(r.files).toEqual([expect.objectContaining({ name: "공고.hml", result: "read" }), variant("공고.hwp")]);
  });

  it("자동 저장 모드: 다른 형식을 못 읽으면 미리보기 표식만 예전처럼 남긴다", async () => {
    const { fetch } = serve({ 0: () => ok(hwpPreviewOnly("PREVIEW_TEXT")) });
    const r = await fetchAttachmentTexts(
      numbered([
        ["공고.hwp", "hwp"],
        ["공고.hml", "etc"],
      ]),
      same(fetch, { maxFiles: 1, extraAttempts: 1, includeHwpPreview: false }),
    );
    expect(r.text).toBe("[첨부: 공고.hwp]\n[미확인 첨부: 공고.hwp]\n\n[읽지 못한 첨부: 공고.hml]");
    expect(r.readFiles).toEqual([]);
    expect(r.previewOnlyFiles).toEqual(["공고.hwp"]);
    expect(r.skippedFiles).toEqual(["공고.hwp"]);
    expect(r.failedFiles).toEqual(["공고.hml"]);
    expect(r.bodyTextChars).toBe(0);
    expect(r.files).toEqual([
      expect.objectContaining({ name: "공고.hwp", result: "skipped", reason: "preview_only" }),
      expect.objectContaining({ name: "공고.hml", result: "failed", reason: "not_found" }),
    ]);
  });

  it("이름이 같은 파일이 주소 둘로 올라와도 한 번만 읽는다", async () => {
    const pdf = await makePdf("TWICE");
    const { calls, fetch } = serve({ 0: () => ok(pdf), 1: () => ok(pdf) });
    const r = await fetchAttachmentTexts(
      numbered([
        ["공고.pdf", "pdf"],
        ["공고.pdf", "pdf"],
      ]),
      same(fetch, { maxFiles: 2 }),
    );
    expect(calls).toEqual([`${B}0`]);
    expect(r.readFiles).toEqual(["공고.pdf"]);
    expect(r.files).toEqual([expect.objectContaining({ name: "공고.pdf", result: "read" }), variant("공고.pdf")]);
  });

  it("묶음은 읽은 수를 하나만 쓴다 — 2개면 같은 문서 하나 + 다른 문서 하나", async () => {
    const pdf = await makePdf("TWO_DOCS");
    const { calls, fetch } = serve({ 0: () => ok(pdf), 1: () => ok(pdf), 2: () => ok(pdf) });
    const r = await fetchAttachmentTexts(
      numbered([
        ["공고.hwp", "hwp"],
        ["공고.pdf", "pdf"],
        ["신청서.hwp", "hwp"],
      ]),
      same(fetch, { maxFiles: 2 }),
    );
    expect(calls).toEqual([`${B}0`, `${B}2`]);
    expect(r.readFiles).toEqual(["공고.hwp", "신청서.hwp"]);
    expect(r.files).toEqual([
      expect.objectContaining({ name: "공고.hwp", result: "read" }),
      variant("공고.pdf"),
      expect.objectContaining({ name: "신청서.hwp", result: "read" }),
    ]);
  });

  it("묶음은 맨 앞 구성원 자리에서 처리한다", async () => {
    const pdf = await makePdf("NOTICE_PDF");
    const { calls, fetch } = serve({ 0: () => ok(pdf), 1: () => ok(hwpxOf(["x"])), 2: () => ok(hmlBytes("HML")) });
    const r = await fetchAttachmentTexts(
      numbered([
        ["공고.pdf", "pdf"],
        ["사업 안내.hwpx", "hwpx"],
        ["공고.hml", "etc"],
      ]),
      same(fetch, { maxFiles: 2, extractHwpx: () => "GUIDE_HWPX" }),
    );
    expect(calls).toEqual([`${B}0`, `${B}1`]);
    expect(r.files).toEqual([
      expect.objectContaining({ name: "공고.pdf", result: "read" }),
      variant("공고.hml"),
      expect.objectContaining({ name: "사업 안내.hwpx", result: "read" }),
    ]);
    const at = (s: string) => r.text.indexOf(s);
    expect(at("[첨부: 공고.pdf]")).toBe(0);
    expect(at("[같은 문서 다른 형식: 공고.hml]")).toBeGreaterThan(at("NOTICE_PDF"));
    expect(at("[첨부: 사업 안내.hwpx]")).toBeGreaterThan(at("[같은 문서 다른 형식: 공고.hml]"));
    expect(r.text.endsWith("GUIDE_HWPX")).toBe(true);
  });

  it("상한에 걸린 묶음은 구성원을 읽기 좋은 형식 차례로 over_limit 에 남긴다", async () => {
    const { calls, fetch } = serve({ 0: () => ok(hwpxOf(["x"])) });
    const r = await fetchAttachmentTexts(
      numbered([
        ["사업 안내.hwpx", "hwpx"],
        ["신청서.hwp", "hwp"],
        ["신청서.pdf", "pdf"],
      ]),
      same(fetch, { maxFiles: 1, extractHwpx: () => "GUIDE" }),
    );
    expect(calls).toEqual([`${B}0`]);
    expect(r.files).toEqual([
      expect.objectContaining({ name: "사업 안내.hwpx", result: "read" }),
      expect.objectContaining({ name: "신청서.hwp", result: "skipped", reason: "over_limit" }),
      expect.objectContaining({ name: "신청서.pdf", result: "skipped", reason: "over_limit" }),
    ]);
    expect(r.text).toBe("[첨부: 사업 안내.hwpx]\nGUIDE\n\n[미확인 첨부: 신청서.hwp]\n\n[미확인 첨부: 신청서.pdf]");
  });

  it("크기 꼬리가 붙은 이름도 같은 문서로 묶는다", async () => {
    const pdf = await makePdf("TAIL");
    const { calls, fetch } = serve({ 0: () => ok(pdf), 1: () => ok(pdf) });
    const r = await fetchAttachmentTexts(
      numbered([
        ["공고문.hwp (68.5K)", "etc"],
        ["공고문.pdf", "pdf"],
      ]),
      same(fetch, { maxFiles: 1 }),
    );
    expect(calls).toEqual([`${B}0`]);
    expect(r.files).toEqual([
      expect.objectContaining({ name: "공고문.hwp (68.5K)", result: "read" }),
      variant("공고문.pdf"),
    ]);
  });

  it("NFD 이름과 NFC 이름도 같은 문서", async () => {
    const pdf = await makePdf("NFD");
    const nfd = `${"공고".normalize("NFD")}.hwp`;
    const { calls, fetch } = serve({ 0: () => ok(pdf), 1: () => ok(pdf) });
    const r = await fetchAttachmentTexts(
      numbered([
        [nfd, "hwp"],
        ["공고.pdf", "pdf"],
      ]),
      same(fetch, { maxFiles: 1 }),
    );
    expect(calls).toEqual([`${B}0`]);
    expect(r.sameDocumentFiles).toEqual(["공고.pdf"]);
  });

  it("묶지 않는 형식(xlsx)은 이름이 같아도 따로 읽는다", async () => {
    const pdf = await makePdf("SHEET_SIBLING");
    const { calls, fetch } = serve({
      0: () => ok(pdf),
      1: () =>
        ok(
          xlsxTableOf("공고", [
            ["항목", "내용"],
            ["지원금", "5천만원"],
          ]),
        ),
    });
    const r = await fetchAttachmentTexts(
      numbered([
        ["공고.hwp", "hwp"],
        ["공고.xlsx", "etc"],
      ]),
      same(fetch, { maxFiles: 2 }),
    );
    expect(calls).toEqual([`${B}0`, `${B}1`]);
    expect(r.readFiles).toEqual(["공고.hwp", "공고.xlsx"]);
    expect(r.sameDocumentFiles).toBeUndefined();
  });

  it("사이트 공통 파일·같은 요청은 묶기 전에 빠진다", async () => {
    const pdf = await makePdf("REAL_NOTICE");
    const cbaFetch = vi.fn(async () => ok(pdf));
    const r1 = await fetchAttachmentTexts(
      [
        { name: "공고.pdf", url: "https://www.cba.ne.kr/ebook/2026/notice.pdf", kind: "pdf" },
        { name: "공고.hwp", url: "https://www.cba.ne.kr/base/download/bbs.php?fno=1", kind: "hwp" },
      ],
      same(cbaFetch, { maxFiles: 2 }),
    );
    expect(cbaFetch).toHaveBeenCalledTimes(1);
    expect(r1.files).toEqual([
      { name: "공고.pdf", result: "ignored" },
      expect.objectContaining({ name: "공고.hwp", result: "read" }),
    ]);
    expect(r1.sameDocumentFiles).toBeUndefined();

    const { calls, fetch } = serve({ 0: () => ok(pdf) });
    const r2 = await fetchAttachmentTexts(
      [
        { name: "공고.pdf", url: `${B}0`, kind: "pdf" },
        { name: "공고.hwp", url: `${B}0`, kind: "hwp" },
      ],
      same(fetch, { maxFiles: 2 }),
    );
    expect(calls).toEqual([`${B}0`]);
    expect(r2.files).toEqual([
      { name: "공고.hwp", result: "duplicate" },
      expect.objectContaining({ name: "공고.pdf", result: "read" }),
    ]);
    expect(r2.sameDocumentFiles).toBeUndefined();
  });
});

describe("variant 조각 — 표시는 남고 본문처럼 줄지 않는다", () => {
  it("글자 상한에서 앞 본문만 줄고 같은 문서 표식은 그대로", () => {
    const r = renderAttachmentBlocks(
      [
        {
          name: "공고.hwpx",
          pieces: [
            { kind: "heading", text: "[첨부: 공고.hwpx]" },
            { kind: "body", text: "가".repeat(100) },
          ],
        },
        { name: "공고.hwp", pieces: [{ kind: "variant", text: "[같은 문서 다른 형식: 공고.hwp]" }] },
      ],
      80,
    );
    expect(r.text).toBe(
      `[첨부: 공고.hwpx]\n${"가".repeat(25)}\n\n[첨부 잘림: 공고.hwpx]\n\n[같은 문서 다른 형식: 공고.hwp]`,
    );
    expect(r.text.length).toBe(80);
    expect(r.truncatedNames).toEqual(["공고.hwpx"]);
  });
});
