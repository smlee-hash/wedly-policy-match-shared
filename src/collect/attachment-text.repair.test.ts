import { PDFDocument, StandardFonts } from "pdf-lib";
import { describe, expect, it, vi } from "vitest";

import { asPolicyAttachments, fetchAttachmentTexts } from "./attachment-text";

/**
 * 저장된 첨부 주소는 **읽을 때** 되살린다(2026-10-01 운영 실측 — `board/attachment-url.repair.test.ts`).
 * 본문이 이미 찬 줄은 상세를 다시 읽지 않아 수확기 고침만으로는 저장 주소가 안 바뀐다.
 * 그래서 저장 JSON 을 요청 모양으로 바꾸는 한 곳(`asPolicyAttachments`)에서 고치면
 * 첨부 글자 추출(`fetchAttachmentTexts`)·화면 내려받기 창구(`serve/attachment-download`)가 함께 고친 주소를 쓴다.
 *
 * 단 상세 채움의 「첨부가 바뀌었나」 비교만은 저장 글자 그대로 봐야 한다(`repairUrls: false`) —
 * 되살린 값끼리 비교하면 망가진 주소로 실패하며 찍힌 7일 도장이 안 지워진다.
 */

const KHIDI_BAD =
  "https://www.khidi.or.kr/fileDownload?titleId=531733&fileId=1&fileDownType=C%C2%B6mMenuId=MENU01108";
const KHIDI_GOOD =
  "https://www.khidi.or.kr/fileDownload?titleId=531733&fileId=1&fileDownType=C&paramMenuId=MENU01108";
const YPA_BAD = "https://ybs.ypa.or.kr/cmm/fms/FileDown.do?atchFileId=FILE_000000000230380&fileSn=2";
const YPA_GOOD = "https://ybs.ypa.or.kr/FileDown.do?atchFileId=FILE_000000000230380&fileSn=2";
const HRDK_DOWN = "https://www.hrdkorea.or.kr/cms/download/downloadFile2.hrd";

const stored = () => [
  { name: "공고문.pdf", url: KHIDI_BAD, kind: "pdf" },
  { name: "붙임.hwpx", url: `  ${YPA_BAD}  `, kind: "hwpx" },
  { name: "안내.hwp", url: "https://www.djtp.or.kr/files/guide.hwp" },
  {
    name: "서식.hwp",
    url: HRDK_DOWN,
    kind: "hwp",
    method: "POST",
    body: "attachSeq2=TkVX",
    headers: { Referer: "https://www.hrdkorea.or.kr/3/1/1?k=56065" },
  },
];

describe("asPolicyAttachments — 저장 주소를 읽을 때 되살린다", () => {
  it("기본은 되살린 주소 — 개수·순서·이름·형식·POST 칸은 그대로", () => {
    expect(asPolicyAttachments(stored())).toEqual([
      { name: "공고문.pdf", url: KHIDI_GOOD, kind: "pdf" },
      { name: "붙임.hwpx", url: YPA_GOOD, kind: "hwpx" },
      { name: "안내.hwp", url: "https://www.djtp.or.kr/files/guide.hwp", kind: "hwp" },
      {
        name: "서식.hwp",
        url: HRDK_DOWN,
        kind: "hwp",
        method: "POST",
        body: "attachSeq2=TkVX",
        headers: { Referer: "https://www.hrdkorea.or.kr/3/1/1?k=56065" },
      },
    ]);
  });

  it("`{ repairUrls: false }` 면 저장된 글자 그대로(앞뒤 공백만 뺀다)", () => {
    expect(asPolicyAttachments(stored(), { repairUrls: false }).map((a) => a.url)).toEqual([
      KHIDI_BAD,
      YPA_BAD,
      "https://www.djtp.or.kr/files/guide.hwp",
      HRDK_DOWN,
    ]);
  });

  it("`{ repairUrls: true }` 는 기본과 같다", () => {
    expect(asPolicyAttachments(stored(), { repairUrls: true })).toEqual(asPolicyAttachments(stored()));
  });

  it("받은 저장 배열은 바꾸지 않는다", () => {
    const raw = stored();
    const before = structuredClone(raw);
    asPolicyAttachments(raw);
    expect(raw).toEqual(before);
  });

  it("모양이 깨진 항목 거르기는 예전 그대로다", () => {
    expect(
      asPolicyAttachments([null, 3, "x", {}, { name: "", url: "" }, { name: " 공고문.pdf ", url: KHIDI_BAD }]),
    ).toEqual([{ name: "공고문.pdf", url: KHIDI_GOOD, kind: "pdf" }]);
    expect(asPolicyAttachments(undefined)).toEqual([]);
    expect(asPolicyAttachments({ url: KHIDI_BAD })).toEqual([]);
  });
});

async function makePdf(text: string): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 200]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText(text, { x: 24, y: 100, size: 12, font });
  return Buffer.from(await doc.save());
}

describe("fetchAttachmentTexts — 망가진 저장 주소를 받아도 되살린 주소로 내려받는다", () => {
  it("khidi `%C2%B6` → `&paramMenuId=` 로 요청하고 글자를 읽는다", async () => {
    const pdf = await makePdf("KHIDI notice body");
    const urls: string[] = [];
    const fetch = vi.fn(async (url: string, _init?: RequestInit) => {
      urls.push(url);
      return url === KHIDI_GOOD ? new Response(Uint8Array.from(pdf)) : new Response("오류", { status: 500 });
    });
    const r = await fetchAttachmentTexts([{ name: "공고문.pdf", url: KHIDI_BAD, kind: "pdf" }], {
      fetch,
      extractHwpx: () => "",
    });
    expect(urls).toEqual([KHIDI_GOOD]);
    expect(r.readFiles).toEqual(["공고문.pdf"]);
    expect(r.failedFiles).toEqual([]);
    expect(r.text).toContain("KHIDI notice body");
  });

  it("ypa `/cmm/fms/FileDown.do` → `/FileDown.do` 로 요청한다", async () => {
    const urls: string[] = [];
    const fetch = vi.fn(async (url: string, _init?: RequestInit) => {
      urls.push(url);
      return new Response("없음", { status: 404 });
    });
    await fetchAttachmentTexts([{ name: "공고.hwpx", url: YPA_BAD, kind: "hwpx" }], {
      fetch,
      extractHwpx: () => "",
    });
    expect(urls).toEqual([YPA_GOOD]);
  });
});
