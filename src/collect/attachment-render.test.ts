import { describe, expect, it } from "vitest";
import {
  renderAttachmentBlocks,
  sliceUtf16,
  truncatedMarker,
  type RenderBlock,
} from "./attachment-render";

function heading(name: string) {
  return { kind: "heading" as const, text: `[첨부: ${name}]` };
}
function body(text: string) {
  return { kind: "body" as const, text };
}
function unverified(name: string) {
  return { kind: "unverified" as const, text: `[미확인 첨부: ${name}]` };
}
function preview(text: string) {
  return { kind: "preview" as const, text };
}

function block(name: string, pieces: RenderBlock["pieces"]): RenderBlock {
  return { name, pieces };
}

describe("sliceUtf16 — 서로게이트 경계", () => {
  it("이모지 한가운데를 자르지 않는다", () => {
    const s = "가😀나";
    expect(sliceUtf16(s, 2)).toBe("가");
    expect(sliceUtf16(s, 3)).toBe("가😀");
    expect(sliceUtf16(s, 3).isWellFormed()).toBe(true);
  });
});

describe("첨부 조각 렌더 — 본문만 세고 잘린 파일을 가리킨다", () => {
  it("표시만으로 상한을 넘으면 완독으로 복원될 머리글도 반환하지 않는다", () => {
    const name = "n".repeat(3990) + ".pdf";
    const r = renderAttachmentBlocks([block(name, [heading(name), body("X".repeat(4000))])], 8000);
    expect(r.text).toBe("");
    expect(r.bodyTextChars).toBe(0);
    expect(r.truncatedNames).toEqual([name]);
  });

  it("같은 이름의 두 첨부에서 실제로 잘린 뒤 블록에만 표시한다", () => {
    const name = "download";
    const kept = "KEEP".repeat(10);
    const r = renderAttachmentBlocks([
      block(name, [heading(name), body(kept)]),
      block(name, [heading(name), body("X".repeat(200))]),
    ], 160);
    expect(r.retainedBodies[0]).toBe(kept);
    expect(r.text.split(truncatedMarker(name)).length - 1).toBe(1);
    expect(r.text.indexOf(truncatedMarker(name))).toBeGreaterThan(r.text.lastIndexOf(`[첨부: ${name}]`));
  });

  it("149자 본문과 HWP 미확인 표식 합 211자에서 본문은 149다", () => {
    const pdf = "notice.pdf";
    const hwp = "protected.hwp";
    const r = renderAttachmentBlocks(
      [
        block(pdf, [heading(pdf), body("A".repeat(149))]),
        block(hwp, [heading(hwp), unverified(hwp)]),
      ],
      8_000,
    );
    expect(r.bodyTextChars).toBe(149);
    expect(r.text.length).toBe(211);
    expect(r.truncatedNames).toEqual([]);
    expect(r.retainedBodies).toEqual(["A".repeat(149)]);
    expect(r.text).toContain("[미확인 첨부: protected.hwp]");
    expect(r.text).not.toContain(truncatedMarker(pdf));
  });

  it("상한에 딱 맞는 11980자 PDF 뒤에 HWP 표식을 넣으면 PDF 꼬리와 잘림 이름이 남는다", () => {
    const pdf = "notice.pdf";
    const hwp = "protected.hwp";
    const headingLen = `[첨부: ${pdf}]`.length + 1;
    const bodyText = `${"C".repeat(11_980 - headingLen - "EXCLUSION_TAIL".length)}EXCLUSION_TAIL`;
    const pdfOnly = renderAttachmentBlocks([block(pdf, [heading(pdf), body(bodyText)])], 11_980);
    expect(pdfOnly.text).toContain("EXCLUSION_TAIL");
    expect(pdfOnly.text.length).toBe(11_980);
    expect(pdfOnly.truncatedNames).toEqual([]);

    const mixed = renderAttachmentBlocks(
      [
        block(pdf, [heading(pdf), body(bodyText)]),
        block(hwp, [heading(hwp), unverified(hwp)]),
      ],
      11_980,
    );
    expect(mixed.text.length).toBeLessThanOrEqual(11_980);
    expect(mixed.text).not.toContain("EXCLUSION_TAIL");
    expect(mixed.truncatedNames).toEqual([pdf]);
    expect(mixed.text).toContain(truncatedMarker(pdf));
    expect(mixed.text).toContain("[미확인 첨부: protected.hwp]");
    expect(mixed.bodyTextChars).toBe(mixed.retainedBodies.reduce((n, s) => n + s.length, 0));
    expect(mixed.bodyTextChars).toBeLessThan(pdfOnly.bodyTextChars);
    expect(mixed.bodyTextChars).toBeGreaterThan(0);
  });

  it("두 정상 첨부에서 뒤 표식 공간이 앞 본문을 밀면 앞 파일도 잘린다", () => {
    const a = "a.pdf";
    const b = "b.pdf";
    const r = renderAttachmentBlocks(
      [
        block(a, [heading(a), body("F".repeat(80))]),
        block(b, [heading(b), body("G".repeat(5))]),
      ],
      70,
    );
    expect(r.text.length).toBeLessThanOrEqual(70);
    expect(r.truncatedNames).toContain(a);
    expect(r.truncatedNames).toContain(b);
    expect(r.text).toContain(truncatedMarker(a));
    expect(r.text).toContain(truncatedMarker(b));
    expect(r.bodyTextChars).toBe(r.retainedBodies.reduce((n, s) => n + s.length, 0));
  });

  it("본문에 표식처럼 보이는 원문이 있으면 본문으로 센다", () => {
    const name = "raw.pdf";
    const raw = "[첨부 잘림: other.pdf]\n[미확인 첨부: x.hwp] 실제원문";
    const r = renderAttachmentBlocks([block(name, [heading(name), body(raw)])], 8_000);
    expect(r.bodyTextChars).toBe(raw.length);
    expect(r.truncatedNames).toEqual([]);
    expect(r.retainedBodies).toEqual([raw]);
  });

  it("미리보기 글자는 본문 글자 수에 넣지 않는다", () => {
    const r = renderAttachmentBlocks(
      [
        block("ok.pdf", [heading("ok.pdf"), body("KEEP")]),
        block("p.hwp", [heading("p.hwp"), unverified("p.hwp"), preview("미리보기만 있는 공고")]),
      ],
      8_000,
    );
    expect(r.bodyTextChars).toBe(4);
    expect(r.text).toContain("미리보기만 있는 공고");
    expect(r.truncatedNames).toEqual([]);
  });

  it("유니코드 경계에서 반쪽 글자를 남기지 않고 남은 본문만 센다", () => {
    const name = "u.pdf";
    const r = renderAttachmentBlocks([block(name, [body("가😀나")])], 3);
    expect(r.text.isWellFormed()).toBe(true);
    expect(r.bodyTextChars).toBe(r.retainedBodies.reduce((n, s) => n + s.length, 0));
    for (const b of r.retainedBodies) expect(b.isWellFormed()).toBe(true);
  });

  it("아주 작은 상한과 긴 이름에서는 본문을 완성으로 세지 않는다", () => {
    const name = `${"n".repeat(80)}.pdf`;
    const r = renderAttachmentBlocks(
      [block(name, [heading(name), body("COMPLETE_BODY")])],
      10,
    );
    expect(r.text.length).toBeLessThanOrEqual(10);
    expect(r.bodyTextChars).toBe(0);
    expect(r.truncatedNames).toEqual([name]);
    expect(r.text).not.toContain("COMPLETE_BODY");
  });

  it("파일 많은 입력도 유계로 끝나며 잘린 이름을 각각 남긴다", () => {
    const blocks = Array.from({ length: 40 }, (_, i) => {
      const name = `f${i}.pdf`;
      return block(name, [heading(name), body("X".repeat(50))]);
    });
    const r = renderAttachmentBlocks(blocks, 120);
    expect(r.text.length).toBeLessThanOrEqual(120);
    expect(r.truncatedNames.length).toBeGreaterThan(1);
    expect(r.bodyTextChars).toBe(r.retainedBodies.reduce((n, s) => n + s.length, 0));
    expect(r.bodyTextChars).toBeLessThan(40 * 50);
  });

  it("필수 표식이 본문보다 뒤에 오면 본문 꼬리를 줄여 표식을 남긴다", () => {
    const pdf = "front.pdf";
    const hwp = "tail.hwp";
    const r = renderAttachmentBlocks(
      [
        block(pdf, [heading(pdf), body(`${"Z".repeat(80)}TAILMARK`)]),
        block(hwp, [heading(hwp), unverified(hwp)]),
      ],
      `[첨부: ${pdf}]\n${"Z".repeat(80)}TAILMARK`.length,
    );
    expect(r.text).toContain("[미확인 첨부: tail.hwp]");
    expect(r.truncatedNames).toEqual([pdf]);
    expect(r.text).toContain(truncatedMarker(pdf));
    expect(r.text).not.toContain("TAILMARK");
  });
});
