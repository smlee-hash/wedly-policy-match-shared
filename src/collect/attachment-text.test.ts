import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { describe, expect, it, vi } from "vitest";

/** pdf 파서(unpdf) 호출을 재기 위한 못 — 이름이 pdf 여도 바이트가 hwpx 면 부르면 안 된다. */
const unpdfCalls = vi.hoisted(() => ({ getDocumentProxy: vi.fn() }));
vi.mock("unpdf", async (importOriginal) => {
  const actual = await importOriginal<typeof import("unpdf")>();
  unpdfCalls.getDocumentProxy.mockImplementation((...args: unknown[]) =>
    (actual.getDocumentProxy as (...a: unknown[]) => unknown)(...args),
  );
  return { ...actual, getDocumentProxy: unpdfCalls.getDocumentProxy };
});
import type { PolicyAttachment } from "./types";
import {
  ALLOWED_ATTACHMENT_HOSTS,
  EXTRACTABLE_KINDS,
  asPolicyAttachments,
  extractHwpPreview,
  extractPdfBytes,
  fetchAttachmentTexts,
  safeAttachmentUrl,
  sniffAttachmentKind,
  stripUnstorableChars,
  DEFAULT_MAX_FILES,
  DEFAULT_CHAR_CAP,
  FORM_CONTENT_TYPE,
} from "./attachment-text";
import { BOARD_SOURCES } from "./board/source-list";
import { allowedHostsOf } from "./board/engine";

const FIX = join(__dirname, "__fixtures__");
const hwpBuf = () => readFileSync(join(FIX, "sample.hwp"));
const hwpxBuf = () => readFileSync(join(FIX, "sample.hwpx"));

/** 기업마당 첨부 주소 — 내려받기가 허용하는 유일한 호스트. */
const B = "https://www.bizinfo.go.kr/cmm/fms/fileDown.do?file=";

async function makePdf(text: string): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 200]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText(text, { x: 24, y: 100, size: 12, font });
  return Buffer.from(await doc.save());
}

function att(over: Partial<PolicyAttachment> & { name: string; url: string }): PolicyAttachment {
  return { kind: "etc", ...over };
}

function okResponse(body: Buffer, headers: Record<string, string> = {}): Response {
  return new Response(Uint8Array.from(body), { status: 200, headers });
}

/** 길이 헤더는 마음대로 적고 본문은 조각조각 흘려보내는 가짜 응답. */
function streamResponse(
  chunks: Uint8Array[],
  headers: Record<string, string> = {},
): { res: Response; pulled: () => number } {
  let pulled = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (pulled >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(chunks[pulled]);
      pulled += 1;
    },
  });
  return { res: new Response(body, { status: 200, headers }), pulled: () => pulled };
}

describe("asPolicyAttachments — 저장 모양 방어", () => {
  it("kind 가 없으면 이름으로 채운다", () => {
    expect(asPolicyAttachments([
      { name: "a.pdf", url: `${B}a.pdf` },
      { name: "b.hwp", url: `${B}b.hwp`, kind: "hwp" },
      { name: "", url: "" },
      "아님",
    ])).toEqual([
      { name: "a.pdf", url: `${B}a.pdf`, kind: "pdf" },
      { name: "b.hwp", url: `${B}b.hwp`, kind: "hwp" },
    ]);
  });
});

describe("safeAttachmentUrl — 첨부 주소 검증", () => {
  it("기업마당 두 호스트만 허용한다", () => {
    expect([...ALLOWED_ATTACHMENT_HOSTS].sort()).toEqual(["bizinfo.go.kr", "www.bizinfo.go.kr"]);
    expect(safeAttachmentUrl("https://www.bizinfo.go.kr/a.pdf")).toBe("https://www.bizinfo.go.kr/a.pdf");
    expect(safeAttachmentUrl("https://bizinfo.go.kr/a.pdf")).toBe("https://bizinfo.go.kr/a.pdf");
  });

  it("대전TP(djtp) 첨부 주소를 허용한다", () => {
    expect(safeAttachmentUrl("https://www.djtp.or.kr/boardDownload.es?seq=1")).toContain("djtp.or.kr");
  });

  it("http 는 https 로 올려서 부른다", () => {
    expect(safeAttachmentUrl("http://www.bizinfo.go.kr/a.pdf")).toBe("https://www.bizinfo.go.kr/a.pdf");
  });

  it("내부망·엉뚱한 호스트·다른 통신방식은 거절한다", () => {
    expect(safeAttachmentUrl("http://169.254.169.254/latest/meta-data/")).toBeNull();
    expect(safeAttachmentUrl("http://127.0.0.1:3000/a.pdf")).toBeNull();
    expect(safeAttachmentUrl("https://evil.example.com/a.pdf")).toBeNull();
    expect(safeAttachmentUrl("file:///etc/passwd")).toBeNull();
    expect(safeAttachmentUrl("/cmm/fms/fileDown.do?id=1")).toBeNull(); // 상대주소는 호스트를 알 수 없다
    expect(safeAttachmentUrl("")).toBeNull();
  });

  it("호스트처럼 보이게 꾸민 주소에 속지 않는다", () => {
    expect(safeAttachmentUrl("https://www.bizinfo.go.kr.evil.com/a.pdf")).toBeNull();
    expect(safeAttachmentUrl("https://evil.com/www.bizinfo.go.kr/a.pdf")).toBeNull();
    expect(safeAttachmentUrl("https://user@www.bizinfo.go.kr:8443/a.pdf")).toBeNull(); // 낯선 문 번호
  });
});

describe("첨부 허용 호스트는 게시판 명부에서 나온다", () => {
  it("★BOARD_SOURCES 전 항목의 모든 호스트로 된 첨부 주소가 허용된다(손으로 적은 목록에서 14곳이 빠져 있던 것)", () => {
    const missing: string[] = [];
    for (const cfg of BOARD_SOURCES) {
      for (const host of allowedHostsOf(cfg)) {
        const ok = safeAttachmentUrl(`https://${host}/files/공고문.pdf`);
        if (!ok) missing.push(`${cfg.id}:${host}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("명부가 포트까지 적은 호스트(portal.snip.or.kr:8443)는 그 포트 그대로 허용하고, 명부에 없는 포트는 여전히 거절한다", () => {
    expect(safeAttachmentUrl("https://portal.snip.or.kr:8443/a.pdf")).toBe("https://portal.snip.or.kr:8443/a.pdf");
    expect(safeAttachmentUrl("https://www.snip.or.kr:8443/a.pdf")).toBeNull();
    expect(safeAttachmentUrl("https://www.kbiz.or.kr:8080/a.pdf")).toBeNull();
  });

  it("명부 밖 호스트는 여전히 거절한다(사칭 주소 포함)", () => {
    expect(safeAttachmentUrl("https://www.kbiz.or.kr.evil.com/a.pdf")).toBeNull();
    expect(safeAttachmentUrl("https://evil.com/www.socialenterprise.or.kr/a.pdf")).toBeNull();
  });
});

describe("extractHwpPreview — OLE PrvText", () => {
  it("구형 hwp 미리보기 글자를 꺼낸다", () => {
    const text = extractHwpPreview(hwpBuf());
    expect(text).toContain("안양시");
    expect(text.length).toBeGreaterThan(100);
    expect(text.length).toBeLessThanOrEqual(2_000);
  });
  it("CFB 가 아니면 빈 글자", () => {
    expect(extractHwpPreview(Buffer.from("not ole"))).toBe("");
  });
});

describe("extractPdfBytes — unpdf 버퍼 이관", () => {
  it("같은 버퍼를 두 번 읽어도 글자가 남는다(복사본 전달)", async () => {
    const buf = await makePdf("POLICY_PDF_MARK");
    const bytes = new Uint8Array(buf);
    const t1 = await extractPdfBytes(bytes);
    const t2 = await extractPdfBytes(bytes);
    expect(t1).toContain("POLICY_PDF_MARK");
    expect(t2).toContain("POLICY_PDF_MARK");
  });
});

describe("fetchAttachmentTexts", () => {
  it("hwpx 전문과 hwp 미리보기를 가짜 fetch 로 읽는다", async () => {
    const hwp = hwpBuf();
    const hwpx = hwpxBuf();
    const r = await fetchAttachmentTexts(
      [
        att({ name: "재공고.hwpx", url: `${B}a.hwpx`, kind: "hwpx" }),
        att({ name: "매뉴얼.hwp", url: `${B}b.hwp`, kind: "hwp" }),
      ],
      {
        // 기본 상한은 1개다(비용) — 이 시험은 여러 파일을 다루는 장치를 재므로 명시해 준다.
        maxFiles: 3,
        // hwpx 추출기는 앱 주입(P3-B2) — 실물 hwpx 파싱은 ERP extract-text.test.ts 가 잰다.
        // 여기선 스텁이 낸 글자가 결과에 흘러드는 배선만 본다.
        extractHwpx: () => "하청노동자 안양시 지원 본문",
        fetch: async (url) => {
          if (url.endsWith("a.hwpx")) return okResponse(hwpx);
          if (url.endsWith("b.hwp")) return okResponse(hwp);
          return new Response(null, { status: 404 });
        },
      },
    );
    expect(r.readFiles).toEqual(["재공고.hwpx", "매뉴얼.hwp"]);
    expect(r.failedFiles).toEqual([]);
    expect(r.skippedFiles).toEqual([]);
    expect(r.text).toContain("하청노동자");
    expect(r.text).toContain("안양시");
    expect(r.text).toContain("[첨부: 재공고.hwpx]");
    expect(r.text).toContain("[첨부: 매뉴얼.hwp]");
  });

  it("pdf 글자를 읽는다", async () => {
    const pdf = await makePdf("SCALE_ITEM_BUDGET");
    const r = await fetchAttachmentTexts(
      [att({ name: "공고.pdf", url: `${B}a.pdf`, kind: "pdf" })],
      { fetch: async () => okResponse(pdf) },
    );
    expect(r.readFiles).toEqual(["공고.pdf"]);
    expect(r.text).toContain("SCALE_ITEM_BUDGET");
  });

  it("zip 은 내려받지 않는다", async () => {
    const urls: string[] = [];
    const pdf = await makePdf("KEEP");
    const r = await fetchAttachmentTexts(
      [
        att({ name: "묶음.zip", url: `${B}a.zip`, kind: "zip" }),
        att({ name: "표.xlsx", url: `${B}b.xlsx`, kind: "etc" }),
        att({ name: "공고.pdf", url: `${B}c.pdf`, kind: "pdf" }),
      ],
      {
        maxFiles: 3,
        fetch: async (url) => {
          urls.push(url);
          return okResponse(pdf);
        },
      },
    );
    expect(urls).not.toContain(`${B}a.zip`);
    expect(r.readFiles).toContain("공고.pdf");
    expect(r.failedFiles).toEqual([]);
  });

  /**
   * ★확장자도 이름도 없는 첨부(NIPA `/comm/getFile?…&fileTy=ATTACH`)가 이 길로 읽힌다.
   * 이름·주소로는 `etc` 로 떨어지지만 후보에 들어가고, 첫 바이트(`%PDF-`)로 형식이 다시 잡힌다.
   */
  it("확장자 없는 「기타」 첨부도 내려받아 첫 바이트로 형식을 다시 잡는다", async () => {
    const urls: string[] = [];
    const pdf = await makePdf("EXTLESS");
    const url = `https://www.nipa.kr/comm/getFile?srvcId=BBSTY1&upperNo=abc==&fileTy=ATTACH&fileNo=def==`;
    const r = await fetchAttachmentTexts([att({ name: "", url, kind: "etc" })], {
      maxFiles: 1,
      fetch: async (u) => {
        urls.push(u);
        return okResponse(pdf);
      },
    });
    expect(urls).toEqual([url]);
    expect(r.failedFiles).toEqual([]);
    expect(r.text).toContain("EXTLESS");
  });

  it("공고당 3개까지만 내려받고 나머지는 미확인 첨부로 남긴다", async () => {
    const urls: string[] = [];
    const pdf = await makePdf("N");
    const list = [1, 2, 3, 4].map((n) =>
      att({ name: `${n}.pdf`, url: `${B}${n}.pdf`, kind: "pdf" }),
    );
    const r = await fetchAttachmentTexts(list, {
      maxFiles: 3,
      fetch: async (url) => {
        urls.push(url);
        return okResponse(pdf);
      },
    });
    expect(urls).toHaveLength(3);
    expect(r.readFiles).toEqual(["1.pdf", "2.pdf", "3.pdf"]);
    expect(r.skippedFiles).toEqual(["4.pdf"]);
    expect(r.text).toContain("[미확인 첨부: 4.pdf]");
  });

  it("읽을 3개는 pdf·hwpx 를 먼저 고르고 hwp 는 뒤로 미룬다", async () => {
    const pdf = await makePdf("N");
    const hwpx = hwpxBuf();
    const urls: string[] = [];
    const r = await fetchAttachmentTexts(
      [
        att({ name: "안내.hwp", url: `${B}h1.hwp`, kind: "hwp" }),
        att({ name: "서식.hwp", url: `${B}h2.hwp`, kind: "hwp" }),
        att({ name: "공고.pdf", url: `${B}a.pdf`, kind: "pdf" }),
        att({ name: "재공고.hwpx", url: `${B}b.hwpx`, kind: "hwpx" }),
      ],
      {
        maxFiles: 3,
        extractHwpx: () => "하청노동자 안양시 지원 본문",
        fetch: async (url) => {
          urls.push(url);
          return okResponse(url.endsWith(".hwpx") ? hwpx : pdf);
        },
      },
    );
    // 전문을 뽑을 수 있는 pdf·hwpx 가 먼저, 남는 한 자리에만 hwp
    expect(urls).toEqual([`${B}a.pdf`, `${B}b.hwpx`, `${B}h1.hwp`]);
    expect(r.skippedFiles).toEqual(["서식.hwp"]);
    expect(r.text).toContain("[미확인 첨부: 서식.hwp]");
    expect(r.text).not.toContain("[미확인 첨부: 안내.hwp]");
  });

  it("허용하지 않은 호스트는 내려받지 않고 표시만 남긴다", async () => {
    const urls: string[] = [];
    const pdf = await makePdf("OK");
    const r = await fetchAttachmentTexts(
      [
        att({ name: "내부망.pdf", url: "http://169.254.169.254/latest/meta-data/", kind: "pdf" }),
        att({ name: "가짜.pdf", url: "https://evil.example.com/a.pdf", kind: "pdf" }),
        att({ name: "공고.pdf", url: `${B}c.pdf`, kind: "pdf" }),
      ],
      {
        // 기본 상한은 1개다(비용) — 이 시험은 주소 거르기를 재므로 명시해 준다.
        maxFiles: 3,
        fetch: async (url) => {
          urls.push(url);
          return okResponse(pdf);
        },
      },
    );
    expect(urls).toEqual([`${B}c.pdf`]); // 거절된 주소는 호출 자체를 안 한다
    expect(r.failedFiles).toEqual(["내부망.pdf", "가짜.pdf"]);
    expect(r.readFiles).toEqual(["공고.pdf"]);
    expect(r.text).toContain("[허용되지 않은 첨부 주소: 내부망.pdf]");
    expect(r.text).toContain("[허용되지 않은 첨부 주소: 가짜.pdf]");
  });

  it("http 첨부는 https 로 올려서 부른다", async () => {
    const urls: string[] = [];
    const pdf = await makePdf("UPGRADE");
    const r = await fetchAttachmentTexts(
      [att({ name: "공고.pdf", url: "http://www.bizinfo.go.kr/a.pdf", kind: "pdf" })],
      {
        fetch: async (url) => {
          urls.push(url);
          return okResponse(pdf);
        },
      },
    );
    expect(urls).toEqual(["https://www.bizinfo.go.kr/a.pdf"]);
    expect(r.readFiles).toEqual(["공고.pdf"]);
  });

  it("길이 헤더가 거짓이어도 실제로 읽은 양으로 끊는다", async () => {
    const chunk = new Uint8Array(4_000).fill(65);
    const { res, pulled } = streamResponse([chunk, chunk, chunk, chunk, chunk], {
      "content-length": "10", // 거짓말 — 실제 본문은 20,000바이트
    });
    const r = await fetchAttachmentTexts(
      [att({ name: "큰파일.pdf", url: `${B}big.pdf`, kind: "pdf" })],
      { maxBytes: 10_000, fetch: async () => res },
    );
    expect(r.readFiles).toEqual([]);
    expect(r.failedFiles).toEqual(["큰파일.pdf"]);
    expect(r.text).toContain("[읽지 못한 첨부: 큰파일.pdf]");
    expect(pulled()).toBeLessThan(5); // 상한을 넘는 순간 멈춘다 — 끝까지 안 읽는다
  });

  it("길이 헤더가 거짓으로 크더라도 실제가 작으면 읽는다", async () => {
    const pdf = await makePdf("SMALL_BUT_LIES");
    const r = await fetchAttachmentTexts(
      [att({ name: "공고.pdf", url: `${B}a.pdf`, kind: "pdf" })],
      {
        maxBytes: 10 * 1024 * 1024,
        fetch: async () => okResponse(pdf, { "content-length": String(999 * 1024 * 1024) }),
      },
    );
    expect(r.readFiles).toEqual(["공고.pdf"]);
    expect(r.text).toContain("SMALL_BUT_LIES");
  });

  it("첨부당 상한을 넘으면 실패 표시를 남긴다", async () => {
    const r = await fetchAttachmentTexts(
      [att({ name: "큰파일.pdf", url: `${B}big.pdf`, kind: "pdf" })],
      {
        maxBytes: 10,
        fetch: async () => okResponse(Buffer.from("%PDF-1.4 too big")),
      },
    );
    expect(r.readFiles).toEqual([]);
    expect(r.failedFiles).toEqual(["큰파일.pdf"]);
    expect(r.text).toContain("[읽지 못한 첨부: 큰파일.pdf]");
  });

  it("내려받기 실패는 건너뛰고 표시를 남긴다", async () => {
    const pdf = await makePdf("OK");
    const r = await fetchAttachmentTexts(
      [
        att({ name: "없음.hwp", url: `${B}missing.hwp`, kind: "hwp" }),
        att({ name: "공고.pdf", url: `${B}ok.pdf`, kind: "pdf" }),
      ],
      {
        maxFiles: 3,
        fetch: async (url) => {
          if (url.includes("missing")) return new Response("gone", { status: 404 });
          return okResponse(pdf);
        },
      },
    );
    expect(r.failedFiles).toEqual(["없음.hwp"]);
    expect(r.readFiles).toEqual(["공고.pdf"]);
    expect(r.text).toContain("[읽지 못한 첨부: 없음.hwp]");
    expect(r.text).toContain("OK");
  });

  it("추출 합계 글자 수 상한을 지킨다", async () => {
    const pdf = await makePdf("ABCDEFGHIJKLMNOPQRSTUVWXYZ");
    const r = await fetchAttachmentTexts(
      [
        att({ name: "a.pdf", url: `${B}a.pdf`, kind: "pdf" }),
        att({ name: "b.pdf", url: `${B}b.pdf`, kind: "pdf" }),
      ],
      { totalCharCap: 40, fetch: async () => okResponse(pdf) },
    );
    expect(r.text.length).toBeLessThanOrEqual(40);
  });

  it("외부 호출에 30초 제한을 건다", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const pdf = await makePdf("T");
    await fetchAttachmentTexts(
      [att({ name: "a.pdf", url: `${B}a.pdf`, kind: "pdf" })],
      { fetch: async () => okResponse(pdf) },
    );
    expect(timeout).toHaveBeenCalledWith(30_000);
    timeout.mockRestore();
  });

  it("리다이렉트 여러 홉이 같은 AbortSignal 을 쓴다 — 홉마다 새로 만들면 시간 상한이 배가 된다", async () => {
    const pdf = await makePdf("SHARED_SIGNAL");
    const signals: AbortSignal[] = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      signals.push(init?.signal as AbortSignal);
      if (url.endsWith("a.pdf")) {
        return new Response(null, { status: 302, headers: { location: `${B}b.pdf` } });
      }
      if (url.endsWith("b.pdf")) {
        return new Response(null, { status: 302, headers: { location: `${B}c.pdf` } });
      }
      return okResponse(pdf);
    });
    const r = await fetchAttachmentTexts(
      [att({ name: "a.pdf", url: `${B}a.pdf`, kind: "pdf" })],
      { fetch: fetchMock as never },
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(signals).toHaveLength(3);
    expect(signals[0]).toBe(signals[1]);
    expect(signals[1]).toBe(signals[2]);
    expect(r.readFiles).toEqual(["a.pdf"]);
  });

  it("EXTRACTABLE_KINDS 는 pdf·hwp·hwpx 뿐이다", () => {
    expect([...EXTRACTABLE_KINDS].sort()).toEqual(["hwp", "hwpx", "pdf"]);
  });
});


describe("기본 상한 — 비용을 묶는 못", () => {
  it("파일은 기본으로 1개, 글자는 8,000자까지만 읽는다", () => {
    // AI 에게 보내는 글자의 95%가 첨부다(2026-08-25 실측) — 이 두 값이 비용의 천장이다.
    expect(DEFAULT_MAX_FILES).toBe(1);
    expect(DEFAULT_CHAR_CAP).toBe(8_000);
  });

  it("상한을 넘는 첨부는 안 읽고 「미확인 첨부」로 남긴다", async () => {
    const pdf = await makePdf("FIRST");
    const r = await fetchAttachmentTexts(
      [
        att({ name: "첫째.pdf", url: `${B}a.pdf`, kind: "pdf" }),
        att({ name: "둘째.pdf", url: `${B}b.pdf`, kind: "pdf" }),
      ],
      { fetch: async () => okResponse(pdf) },
    );
    expect(r.readFiles).toEqual(["첫째.pdf"]);
    expect(r.skippedFiles).toEqual(["둘째.pdf"]);
    expect(r.text).toContain("[미확인 첨부: 둘째.pdf]");
  });

  it("★글자 상한에 걸려 뒷부분이 잘리면 「첨부 잘림」으로 알린다", async () => {
    // 조용히 자르면 잘린 꼬리에 있던 「지원 제외 대상」이 사라진 채 「가능」이 나온다
    // (2026-08-25 적대적 리뷰 치명 2). 잘렸다는 사실 자체가 「확인 필요」의 근거가 된다.
    const pdf = await makePdf("HEAD_MARK_AAAA BBBB CCCC DDDD EEEE FFFF GGGG");
    const r = await fetchAttachmentTexts([att({ name: "긴공고.pdf", url: `${B}a.pdf`, kind: "pdf" })], {
      totalCharCap: 40,
      fetch: async () => okResponse(pdf),
    });
    expect(r.readFiles).toEqual(["긴공고.pdf"]);
    // 읽긴 했지만 다 못 읽었다 — 「안 읽은 첨부」와 같은 무게로 남는다.
    expect(r.skippedFiles).toEqual(["긴공고.pdf"]);
    expect(r.text).toContain("[첨부 잘림: 긴공고.pdf]");
    expect(r.text.length).toBeLessThanOrEqual(40);
  });

  it("상한 안에 들어오면 잘림 표식이 없다", async () => {
    const pdf = await makePdf("SHORT");
    const r = await fetchAttachmentTexts([att({ name: "짧은공고.pdf", url: `${B}a.pdf`, kind: "pdf" })], {
      fetch: async () => okResponse(pdf),
    });
    expect(r.skippedFiles).toEqual([]);
    expect(r.text).not.toContain("[첨부 잘림");
  });
});

describe("stripUnstorableChars — 저장이 거부되는 글자를 걸러낸다", () => {
  // 실측(2026-08-25): 모집중 공고 28건이 이 병으로 못 읽혔다. AI 를 이미 부른 뒤에
  // 저장이 거부돼 **값은 나가고 결과는 안 남는** 가장 아까운 실패였다.
  it("★눈에 안 보이는 빈 글자를 없앤다", () => {
    expect(stripUnstorableChars("가\u0000나")).toBe("가나");
  });

  it("다른 제어문자도 없앤다", () => {
    expect(stripUnstorableChars("가\u0001나\u001F다")).toBe("가나다");
  });

  it("줄바꿈과 탭은 남긴다 — 글의 짜임새다", () => {
    expect(stripUnstorableChars("가\n나\t다")).toBe("가\n나\t다");
  });

  it("멀쩡한 글자는 그대로", () => {
    expect(stripUnstorableChars("업력 3년 이내 · 중소기업")).toBe("업력 3년 이내 · 중소기업");
  });
});

describe("★배선 — 걸러내기가 fetchAttachmentTexts 를 실제로 지나는지", () => {
  /**
   * 왜 이 시험이 따로 필요한가(2026-08-25 적대적 리뷰 「중요 3」):
   * 위 시험들은 `stripUnstorableChars` 를 **직접** 부른다. 그래서 함수 몸통을 지우면 잡지만,
   * **호출 자리를 빼면 하나도 안 깨진다.** 그런데 이번에 고친 원래 결함이 정확히
   * 「걸러내기가 한 갈래에만 있던 것」 — 배선 결함이었다. 그러니 배선을 직접 재야 한다.
   *
   * 아래 두 갈래는 글자 뽑기(`extractByKind`)를 **아예 안 지나는** 길이라,
   * 마지막 길목의 걸러내기가 없으면 그대로 저장으로 흘러간다.
   */
  const 다른호스트 = "https://evil.example.com/a.pdf";

  it("★첨부 이름에 든 빈 글자가 나가는 글자에 남지 않는다", async () => {
    // 이름은 부르는 쪽이 준다 — 파일 내용이 아니라서 글자 뽑기를 안 거친다.
    const r = await fetchAttachmentTexts([att({ name: "공고\u0000문.pdf", url: 다른호스트, kind: "pdf" })]);
    expect(r.text).toContain("허용되지 않은 첨부 주소");
    expect(r.text).not.toContain("\u0000");
  });

  it("★글자 상한이 이모지 한가운데를 잘라도 반쪽 글자가 안 남는다", async () => {
    // 자르기(`slice`)는 갈래별 걸러내기 **뒤**에 일어난다 — 여기서 새 반쪽이 생긴다.
    // `[허용되지 않은 첨부 주소: ` 16칸 + `가` 1칸 + 이모지 2칸 → 상한 18이면 이모지 한가운데.
    const r = await fetchAttachmentTexts([att({ name: "가\u{1F3AF}", url: 다른호스트, kind: "pdf" })], {
      totalCharCap: 18,
    });
    expect(r.text.isWellFormed()).toBe(true);
    expect(r.text).toBe("[허용되지 않은 첨부 주소: 가");
  });
});

describe("sniffAttachmentKind — 파일 이름이 없어도 첫 바이트로 형식을 안다", () => {
  it("%PDF- 로 시작하면 pdf", () => {
    expect(sniffAttachmentKind(Buffer.from("%PDF-1.7\n…"))).toBe("pdf");
  });
  it("OLE 머리(D0 CF 11 E0 A1 B1 1A E1)는 hwp", () => {
    expect(sniffAttachmentKind(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]))).toBe("hwp");
  });
  it("PK 로 시작하면 hwpx 후보(진짜 hwpx 인지는 뽑아 봐야 안다)", () => {
    expect(sniffAttachmentKind(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0]))).toBe("hwpx");
  });
  it("모르는 바이트·빈 버퍼는 null", () => {
    expect(sniffAttachmentKind(Buffer.from("<html>"))).toBeNull();
    expect(sniffAttachmentKind(Buffer.alloc(0))).toBeNull();
  });
});

describe("fetchAttachmentTexts — kind 가 etc 여도 내려받아 냄새로 읽는다", () => {
  it("★kind 가 etc 인 첨부도 허용 호스트면 내려받아 냄새로 형식을 정해 읽는다(중기중앙회·창조경제혁신센터)", async () => {
    const pdfBytes = await makePdf("SNIFF_ETC_PDF");
    const fetchMock = vi.fn(async () => okResponse(pdfBytes));
    const r = await fetchAttachmentTexts(
      [{ name: "download.do", url: "https://www.kbiz.or.kr/download.do?orgalFle=ebb699&seq=1", kind: "etc" }],
      { fetch: fetchMock as never },
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(r.readFiles).toEqual(["download.do"]);
    expect(r.text).toContain("[첨부: download.do]");
    expect(r.text).toContain("SNIFF_ETC_PDF");
  });

  it("etc 인데 내려받은 바이트가 어느 형식도 아니면(HTML 오류 페이지) 읽지 못한 첨부로 남긴다", async () => {
    const fetchMock = vi.fn(async () => new Response("<html>로그인 필요</html>", { status: 200 }));
    const r = await fetchAttachmentTexts(
      [{ name: "download.do", url: "https://www.kbiz.or.kr/download.do?seq=2", kind: "etc" }],
      { fetch: fetchMock as never },
    );
    expect(r.failedFiles).toEqual(["download.do"]);
    expect(r.text).toContain("[읽지 못한 첨부: download.do]");
  });

  it("etc 는 pdf·hwpx·hwp 보다 뒤에 선다 — maxFiles 안에 이름 있는 파일이 먼저", async () => {
    const pdfBytes = await makePdf("RANK_PDF");
    const calls: string[] = [];
    const fetchMock = vi.fn(async (u: string) => {
      calls.push(u);
      return okResponse(pdfBytes);
    });
    await fetchAttachmentTexts(
      [
        { name: "download.do", url: "https://www.kbiz.or.kr/download.do?seq=1", kind: "etc" },
        { name: "공고문.pdf", url: "https://www.kbiz.or.kr/공고문.pdf", kind: "pdf" },
      ],
      { fetch: fetchMock as never, maxFiles: 1 },
    );
    expect(calls).toEqual(["https://www.kbiz.or.kr/%EA%B3%B5%EA%B3%A0%EB%AC%B8.pdf"]);
  });
});

describe("fetchAttachmentTexts — 이름/주소 kind 가 비면 바이트 냄새로 한 번 더", () => {
  // download.do?return=cover.pdf&saveFle=notice.hwpx 처럼 물음표 뒤 첫 확장자가 틀릴 수 있다.
  // 틀린 kind 로 뽑아 본문이 비면 7일간 재시도에서 빠지므로, sniff 가 다른 형식이면 한 번 더 뽑는다.
  it("kind 가 pdf 인데 바이트가 hwpx 면 냄새로 다시 뽑아 읽는다", async () => {
    const hwpx = hwpxBuf();
    const r = await fetchAttachmentTexts(
      [
        att({
          name: "cover.pdf",
          url: `${B}download.do?return=cover.pdf&saveFle=notice.hwpx`,
          kind: "pdf",
        }),
      ],
      { fetch: async () => okResponse(hwpx), extractHwpx: () => "하청노동자 안양시 지원 본문" },
    );
    expect(r.readFiles).toEqual(["cover.pdf"]);
    expect(r.failedFiles).toEqual([]);
    expect(r.text).toContain("하청노동자");
    expect(r.text).toContain("[첨부: cover.pdf]");
  });

  it("kind 가 pdf 인데 바이트가 HTML 이면 읽지 못한 첨부로 남긴다", async () => {
    const r = await fetchAttachmentTexts(
      [att({ name: "cover.pdf", url: `${B}download.do?return=cover.pdf`, kind: "pdf" })],
      { fetch: async () => okResponse(Buffer.from("<html>로그인 필요</html>")) },
    );
    expect(r.readFiles).toEqual([]);
    expect(r.failedFiles).toEqual(["cover.pdf"]);
    expect(r.text).toContain("[읽지 못한 첨부: cover.pdf]");
  });

  it("kind 가 pdf 인데 바이트가 고정본 sample.hwpx 이면 pdf 파서를 부르지 않고 hwpx 글자가 나온다", async () => {
    unpdfCalls.getDocumentProxy.mockClear();
    const hwpx = hwpxBuf();
    const r = await fetchAttachmentTexts(
      [
        att({
          name: "cover.pdf",
          url: `${B}download.do?return=cover.pdf&saveFle=notice.hwpx`,
          kind: "pdf",
        }),
      ],
      { fetch: async () => okResponse(hwpx), extractHwpx: () => "하청노동자 안양시 지원 본문" },
    );
    expect(unpdfCalls.getDocumentProxy).not.toHaveBeenCalled();
    expect(r.readFiles).toEqual(["cover.pdf"]);
    expect(r.failedFiles).toEqual([]);
    expect(r.text).toContain("하청노동자");
    expect(r.text).toContain("[첨부: cover.pdf]");
  });
});

/**
 * ★요청 방법 주입 — 국내 IP 로만 열리는 게시판(전북TP·대전신보·서울신보·세종TP)의 첨부는
 * 목록·상세와 **같은 경유**를 타야 한다. 부르는 쪽이 통로를 갈아 끼울 수 있는지, 그리고
 * 안 갈아 끼우면 예전 그대로 전역 fetch 로 나가는지를 여기서 못 박는다.
 */
describe("fetchAttachmentTexts — 요청 방법(fetch) 주입", () => {
  it("★주입한 fetch 로만 내려받는다 — 전역 fetch 는 부르지 않는다", async () => {
    const pdf = await makePdf("INJECTED_FETCH");
    const urls: string[] = [];
    const injected = vi.fn(async (url: string) => {
      urls.push(url);
      return okResponse(pdf);
    });
    const globalFetch = vi.spyOn(globalThis, "fetch");
    const r = await fetchAttachmentTexts(
      [att({ name: "공고.pdf", url: `${B}a.pdf`, kind: "pdf" })],
      { fetch: injected },
    );
    expect(injected).toHaveBeenCalledTimes(1);
    expect(urls).toEqual([`${B}a.pdf`]);
    expect(globalFetch).not.toHaveBeenCalled();
    expect(r.readFiles).toEqual(["공고.pdf"]);
    expect(r.text).toContain("INJECTED_FETCH");
    globalFetch.mockRestore();
  });

  it("주입하지 않으면 예전대로 전역 fetch 로 나간다", async () => {
    const pdf = await makePdf("GLOBAL_FETCH");
    const globalFetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(okResponse(pdf));
    const r = await fetchAttachmentTexts([att({ name: "공고.pdf", url: `${B}a.pdf`, kind: "pdf" })]);
    expect(globalFetch).toHaveBeenCalledTimes(1);
    expect(globalFetch.mock.calls[0][0]).toBe(`${B}a.pdf`);
    expect(r.readFiles).toEqual(["공고.pdf"]);
    expect(r.text).toContain("GLOBAL_FETCH");
    globalFetch.mockRestore();
  });

  it("★주입한 fetch 를 써도 허용 호스트 검문은 그대로 — 남의 호스트는 부르지 않는다", async () => {
    const injected = vi.fn(async () => okResponse(Buffer.from("x")));
    const r = await fetchAttachmentTexts(
      [att({ name: "공고.pdf", url: "https://evil.example.com/a.pdf", kind: "pdf" })],
      { fetch: injected },
    );
    expect(injected).not.toHaveBeenCalled();
    expect(r.text).toContain("허용되지 않은 첨부 주소");
  });
});

/**
 * ★「사이트가 없다고 답한 것」과 「우리 경유가 죽어 못 물어본 것」을 가른다.
 * 구분이 없으면 부르는 쪽이 둘 다 7일 도장을 찍어, 프록시가 죽어 있던 동안
 * 지나간 공고들이 7일간 재시도에서 빠진다(2026-09-05 적대 리뷰 중간).
 */
describe("fetchAttachmentTexts — 경유 통로 실패는 사이트 실패와 구분한다", () => {
  const 통로실패 = () => {
    const e = new Error("[board-proxy] 경유 통로가 응답하지 않는다: ECONNREFUSED");
    Object.defineProperty(e, Symbol.for("wedly.policy-board.proxyTransportFailure"), { value: true });
    return e;
  };

  it("★요청한 첨부가 전부 경유 통로 탓으로 죽으면 proxyFailed 를 세운다", async () => {
    const r = await fetchAttachmentTexts(
      [
        att({ name: "a.pdf", url: `${B}a.pdf`, kind: "pdf" }),
        att({ name: "b.pdf", url: `${B}b.pdf`, kind: "pdf" }),
      ],
      { maxFiles: 2, fetch: async () => { throw 통로실패(); } },
    );
    expect(r.proxyFailed).toBe(true);
    expect(r.readFiles).toEqual([]);
    expect(r.failedFiles).toEqual(["a.pdf", "b.pdf"]);
  });

  it("사이트가 404 를 준 것은 proxyFailed 가 아니다 — 예전대로 못 읽은 첨부", async () => {
    const r = await fetchAttachmentTexts(
      [att({ name: "a.pdf", url: `${B}a.pdf`, kind: "pdf" })],
      { fetch: async () => new Response("gone", { status: 404 }) },
    );
    expect(r.proxyFailed).toBe(false);
    expect(r.failedFiles).toEqual(["a.pdf"]);
  });

  /**
   * ★「전부」가 아니라 **하나라도**다(2026-09-06 적대 리뷰).
   * 옛 규칙(`proxyFailures === requested`)은 첨부 하나가 사이트 404 이기만 하면
   * 나머지가 통로 죽음이어도 「사이트 탓」으로 뭉개, 물어보지도 못한 첨부가 7일간 막혔다.
   * 도장이 무기한 유예가 아니라 1시간짜리로 바뀌었으니 좁힐 이유가 없다.
   */
  it("★하나라도 통로 탓이면 proxyFailed 다 — 다른 하나를 읽었어도", async () => {
    const pdf = await makePdf("REACHED");
    let n = 0;
    const r = await fetchAttachmentTexts(
      [
        att({ name: "a.pdf", url: `${B}a.pdf`, kind: "pdf" }),
        att({ name: "b.pdf", url: `${B}b.pdf`, kind: "pdf" }),
      ],
      { maxFiles: 2, fetch: async () => { if (n++ === 0) throw 통로실패(); return okResponse(pdf); } },
    );
    expect(r.proxyFailed).toBe(true);
    expect(r.readFiles).toEqual(["b.pdf"]);
  });

  it("통로 탓이 하나도 없으면 거짓 — 다 읽었을 때도, 사이트가 다 막았을 때도", async () => {
    const pdf = await makePdf("REACHED");
    const ok = await fetchAttachmentTexts(
      [att({ name: "a.pdf", url: `${B}a.pdf`, kind: "pdf" })],
      { fetch: async () => okResponse(pdf) },
    );
    expect(ok.proxyFailed).toBe(false);
  });

  it("요청까지 간 첨부가 없으면(허용 안 된 주소뿐) proxyFailed 가 아니다", async () => {
    const r = await fetchAttachmentTexts([att({ name: "a.pdf", url: "https://evil.example.com/a.pdf", kind: "pdf" })]);
    expect(r.proxyFailed).toBe(false);
  });
});

/**
 * ★POST 로만 첨부를 주는 게시판(2026-09-06 실측 3곳 — 산업인력공단·영화진흥위·여성기업센터).
 * 이 배선이 없으면 세 곳의 첨부가 전부 「읽지 못한 첨부」로 적히고 7일 도장이 찍힌다.
 */
describe("fetchAttachmentTexts — POST 로만 주는 첨부", () => {
  it("method·body 를 적은 대로 첫 요청에 싣는다(form 형식 머리글은 기본으로 붙는다)", async () => {
    const pdf = await makePdf("POST_ATTACHMENT");
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const injected = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return okResponse(pdf);
    });
    const r = await fetchAttachmentTexts(
      [
        {
          name: "공고문.pdf",
          url: `${B}down.do`,
          kind: "pdf",
          method: "POST",
          body: "attachSeq2=MjA3MjIzOQ%3D%3D",
        },
      ],
      { fetch: injected },
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].init?.method).toBe("POST");
    expect(calls[0].init?.body).toBe("attachSeq2=MjA3MjIzOQ%3D%3D");
    expect((calls[0].init?.headers as Record<string, string>)["Content-Type"]).toBe(FORM_CONTENT_TYPE);
    expect(r.readFiles).toEqual(["공고문.pdf"]);
    expect(r.text).toContain("POST_ATTACHMENT");
  });

  it("수집기가 적은 머리글은 그대로 나가고 content-type 도 덮어쓰지 않는다", async () => {
    const pdf = await makePdf("POST_HEADERS");
    const calls: Array<Record<string, string>> = [];
    const injected = vi.fn(async (_url: string, init?: RequestInit) => {
      calls.push(init?.headers as Record<string, string>);
      return okResponse(pdf);
    });
    await fetchAttachmentTexts(
      [
        {
          name: "공고문.pdf",
          url: `${B}down.do`,
          kind: "pdf",
          method: "POST",
          body: "a=1",
          headers: { "content-type": "text/plain", "X-Board": "hrdk" },
        },
      ],
      { fetch: injected },
    );
    expect(calls[0]["content-type"]).toBe("text/plain");
    expect(calls[0]["X-Board"]).toBe("hrdk");
    expect(calls[0]["Content-Type"]).toBeUndefined();
  });

  it("★리다이렉트 홉은 GET 이다 — 본문을 다시 보내면 같은 내려받기가 두 번 일어난다", async () => {
    const pdf = await makePdf("POST_REDIRECT");
    const inits: Array<RequestInit | undefined> = [];
    const injected = vi.fn(async (url: string, init?: RequestInit) => {
      inits.push(init);
      if (url === `${B}down.do`) {
        return new Response(null, { status: 302, headers: { location: `${B}real.pdf` } });
      }
      return okResponse(pdf);
    });
    const r = await fetchAttachmentTexts(
      [{ name: "공고문.pdf", url: `${B}down.do`, kind: "pdf", method: "POST", body: "a=1" }],
      { fetch: injected },
    );
    expect(inits).toHaveLength(2);
    expect(inits[0]?.method).toBe("POST");
    expect(inits[1]?.method).toBeUndefined();
    expect(inits[1]?.body).toBeUndefined();
    expect(r.readFiles).toEqual(["공고문.pdf"]);
  });

  it("★GET 첨부는 무변화 — method·body·content-type 이 하나도 안 붙는다", async () => {
    const pdf = await makePdf("PLAIN_GET");
    const inits: Array<RequestInit | undefined> = [];
    const injected = vi.fn(async (_url: string, init?: RequestInit) => {
      inits.push(init);
      return okResponse(pdf);
    });
    const r = await fetchAttachmentTexts([att({ name: "공고.pdf", url: `${B}a.pdf`, kind: "pdf" })], {
      fetch: injected,
    });
    expect(inits[0]?.method).toBeUndefined();
    expect(inits[0]?.body).toBeUndefined();
    expect(inits[0]?.headers).toBeUndefined();
    expect(inits[0]?.redirect).toBe("manual");
    expect(r.readFiles).toEqual(["공고.pdf"]);
  });

  it("저장 JSON 을 되읽어도 method·body 가 살아남고, POST 아닌 방법은 버린다", () => {
    const stored = JSON.parse(
      JSON.stringify([
        { name: "a.pdf", url: `${B}a.pdf`, kind: "pdf", method: "POST", body: "x=1", headers: { Referer: "https://x" } },
        { name: "b.pdf", url: `${B}b.pdf`, kind: "pdf", method: "DELETE", body: "x=1" },
        { name: "c.pdf", url: `${B}c.pdf`, kind: "pdf", headers: { Cookie: { evil: 1 } } },
      ]),
    );
    expect(asPolicyAttachments(stored)).toEqual([
      { name: "a.pdf", url: `${B}a.pdf`, kind: "pdf", method: "POST", body: "x=1", headers: { Referer: "https://x" } },
      { name: "b.pdf", url: `${B}b.pdf`, kind: "pdf", body: "x=1" },
      { name: "c.pdf", url: `${B}c.pdf`, kind: "pdf" },
    ]);
  });
});
