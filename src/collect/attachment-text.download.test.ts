import { utils, write } from "cfb";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { describe, expect, it, vi } from "vitest";
import {
  fetchAttachmentTexts,
  FORM_CONTENT_TYPE,
  type AttachmentFileOutcome,
  type AttachmentFileReason,
} from "./attachment-text";
import { BROWSER_UA } from "./board/fetch-identity";
import { markProxyTransportError } from "./board/proxy";
import type { PolicyAttachmentRequest } from "./board/types";

/**
 * 첨부 내려받기(`downloadBytes`)를 브라우저처럼 — 2026-10-01 한국 IP 실측으로 확인한 세 가지.
 *
 * 1. **UA·언어**: 행정안전부·화성산업진흥원은 노드 기본 UA 접속을 끊는다. 브라우저 UA + `Accept-Language: ko`
 *    면 파일이 온다. 지금 잘 받아지는 주요 16곳은 두 방식 결과가 같았다.
 * 2. **쿠키 항아리**: 국토교통부(`/LCMS/DWN.jsp`)·수출입은행(`/comm/getFile`)·광명 소상공인센터(XE)는
 *    첫 응답에 세션 쿠키를 주며 **같은 주소로 302** 한다. 쿠키 없이 따라가면 302 를 되풀이하다 끝나고,
 *    받은 쿠키를 다음 홉에 실으면 파일이 온다. 항아리는 **내려받기 한 번 동안만** 산다.
 * 3. **못 받은 이유**: 지금은 404·500·크기 초과·시간 초과가 전부 같은 「읽지 못한 첨부」라 원인을 알 수 없다.
 *    파일마다 결과(`files`)에 이유 한 마디를 남긴다. AI 에게 가는 글자(표시)는 **바꾸지 않는다**.
 */

const B = "https://www.bizinfo.go.kr/cmm/fms/fileDown.do?file=";

async function makePdf(text: string): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 200]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText(text, { x: 24, y: 100, size: 12, font });
  return Buffer.from(await doc.save());
}

/** FileHeader(암호·배포용 표시 없음) + PrvText 만 있는 옛 한글 — 본문은 못 뽑고 미리보기만 나온다. */
function previewOnlyHwp(): Buffer {
  const cfb = utils.cfb_new();
  const header = Buffer.alloc(256);
  header.write("HWP Document File", 0, "ascii");
  header[35] = 5;
  utils.cfb_add(cfb, "FileHeader", header);
  utils.cfb_add(cfb, "PrvText", Buffer.from("미리보기 글자만 있는 공고", "utf16le"));
  return Buffer.from(write(cfb, { type: "buffer" }));
}

function headersOf(init?: RequestInit): Record<string, string> {
  const h = init?.headers;
  if (!h) return {};
  if (h instanceof Headers) return Object.fromEntries(h.entries());
  if (Array.isArray(h)) return Object.fromEntries(h);
  return { ...(h as Record<string, string>) };
}

/** 이름의 대소문자와 상관없이 그 머리글 값. */
function header(h: Record<string, string>, name: string): string | undefined {
  const k = Object.keys(h).find((x) => x.toLowerCase() === name.toLowerCase());
  return k === undefined ? undefined : h[k];
}

function headerCount(h: Record<string, string>, name: string): number {
  return Object.keys(h).filter((x) => x.toLowerCase() === name.toLowerCase()).length;
}

type Call = { url: string; init?: RequestInit; headers: Record<string, string> };

function recording(handler: (url: string, call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const call = { url, init, headers: headersOf(init) };
    calls.push(call);
    return handler(url, call);
  });
  return { calls, fetch };
}

function redirectTo(location: string | null, setCookies: string[] = []): Response {
  const h = new Headers();
  if (location !== null) h.set("location", location);
  for (const c of setCookies) h.append("set-cookie", c);
  return new Response(null, { status: 302, headers: h });
}

const ok = (body: Buffer | Uint8Array) => new Response(Uint8Array.from(body), { status: 200 });

const one = (name = "a.pdf", url = `${B}a.pdf`): PolicyAttachmentRequest[] => [{ name, url, kind: "pdf" }];

const opts = (fetch: unknown, more: Record<string, unknown> = {}) => ({
  extractHwpx: () => "",
  fetch: fetch as never,
  ...more,
});

describe("첨부 내려받기 — 브라우저처럼 부른다(행정안전부·화성 실측)", () => {
  it("★GET 첨부의 첫 요청에 UA·Accept-Language 가 붙는다 — 방법·본문·형식은 여전히 안 붙는다", async () => {
    const pdf = await makePdf("UA_FIRST");
    const { calls, fetch } = recording(() => ok(pdf));
    const r = await fetchAttachmentTexts(one(), opts(fetch));
    expect(r.readFiles).toEqual(["a.pdf"]);
    expect(header(calls[0].headers, "user-agent")).toBe(BROWSER_UA);
    expect(header(calls[0].headers, "accept-language")).toBe("ko");
    expect(header(calls[0].headers, "content-type")).toBeUndefined();
    expect(calls[0].init?.method).toBeUndefined();
    expect(calls[0].init?.body).toBeUndefined();
    expect(calls[0].init?.redirect).toBe("manual");
  });

  it("★리다이렉트 홉마다 다시 붙는다", async () => {
    const pdf = await makePdf("UA_HOPS");
    const { calls, fetch } = recording((url) => (url.endsWith("a.pdf") ? redirectTo(`${B}real.pdf`) : ok(pdf)));
    const r = await fetchAttachmentTexts(one(), opts(fetch));
    expect(r.readFiles).toEqual(["a.pdf"]);
    expect(calls).toHaveLength(2);
    for (const c of calls) {
      expect(header(c.headers, "user-agent")).toBe(BROWSER_UA);
      expect(header(c.headers, "accept-language")).toBe("ko");
    }
  });

  it("수집기가 적어 둔 UA 는 첫 홉에서 덮지 않고, 같은 이름을 두 번 싣지 않는다", async () => {
    const pdf = await makePdf("UA_CALLER");
    const { calls, fetch } = recording(() => ok(pdf));
    await fetchAttachmentTexts(
      [{ name: "a.pdf", url: `${B}a.pdf`, kind: "pdf", headers: { "user-agent": "Custom/1" } }],
      opts(fetch),
    );
    expect(headerCount(calls[0].headers, "user-agent")).toBe(1);
    expect(header(calls[0].headers, "user-agent")).toBe("Custom/1");
    expect(header(calls[0].headers, "accept-language")).toBe("ko");
  });

  it("POST 첨부도 UA·언어와 form 형식이 함께 나간다", async () => {
    const pdf = await makePdf("UA_POST");
    const { calls, fetch } = recording(() => ok(pdf));
    await fetchAttachmentTexts(
      [{ name: "a.pdf", url: `${B}down.do`, kind: "pdf", method: "POST", body: "a=1" }],
      opts(fetch),
    );
    expect(calls[0].init?.method).toBe("POST");
    expect(calls[0].init?.body).toBe("a=1");
    expect(header(calls[0].headers, "content-type")).toBe(FORM_CONTENT_TYPE);
    expect(header(calls[0].headers, "user-agent")).toBe(BROWSER_UA);
  });
});

describe("첨부 내려받기 — 내려받기 한 번 안에서 쿠키를 들고 다닌다(국토부·수출입은행·광명 실측)", () => {
  it("★첫 응답이 쿠키를 주며 같은 주소로 되돌리면, 그 쿠키를 싣고 다시 불러 파일을 받는다", async () => {
    const pdf = await makePdf("COOKIE_BOUNCE");
    const url = `${B}LCMS/DWN.jsp`;
    const { calls, fetch } = recording((u, call) =>
      (header(call.headers, "cookie") ?? "").includes("JSESSIONID=abc")
        ? ok(pdf)
        : redirectTo(u, ["JSESSIONID=abc; Path=/; HttpOnly", "WMONID=w1; Path=/"]),
    );
    const r = await fetchAttachmentTexts(one("a.pdf", url), opts(fetch));
    expect(r.readFiles).toEqual(["a.pdf"]);
    expect(r.text).toContain("COOKIE_BOUNCE");
    expect(calls).toHaveLength(2);
    expect(header(calls[0].headers, "cookie")).toBeUndefined();
    expect(header(calls[1].headers, "cookie")).toContain("JSESSIONID=abc");
    expect(header(calls[1].headers, "cookie")).toContain("WMONID=w1");
  });

  it("받은 쿠키는 Path 가 맞는 홉에만 실린다(항아리 규칙 그대로)", async () => {
    const pdf = await makePdf("COOKIE_PATH");
    const { calls, fetch } = recording((u) =>
      u.endsWith("a.pdf")
        ? redirectTo("https://www.bizinfo.go.kr/cmm/real.pdf", ["A=1; Path=/cmm", "B=2; Path=/other"])
        : ok(pdf),
    );
    const r = await fetchAttachmentTexts(one(), opts(fetch));
    expect(r.readFiles).toEqual(["a.pdf"]);
    const cookie = header(calls[1].headers, "cookie") ?? "";
    expect(cookie).toContain("A=1");
    expect(cookie).not.toContain("B=2");
  });

  it("★다음 첨부로는 넘어가지 않는다 — 내려받기 한 번이 끝나면 항아리를 버린다", async () => {
    const pdf = await makePdf("JAR_SCOPE");
    const { calls, fetch } = recording((u, call) =>
      u.endsWith("a.pdf") && !(header(call.headers, "cookie") ?? "").includes("S=1")
        ? redirectTo(u, ["S=1; Path=/"])
        : ok(pdf),
    );
    const r = await fetchAttachmentTexts(
      [
        { name: "a.pdf", url: `${B}a.pdf`, kind: "pdf" },
        { name: "b.pdf", url: `${B}b.pdf`, kind: "pdf" },
      ],
      opts(fetch, { maxFiles: 2 }),
    );
    expect(r.readFiles).toEqual(["a.pdf", "b.pdf"]);
    const firstB = calls.find((c) => c.url.endsWith("b.pdf"))!;
    expect(header(firstB.headers, "cookie")).toBeUndefined();
  });

  it("첫 홉은 수집기가 적어 둔 Cookie 를 그대로 한 번만 싣는다", async () => {
    const pdf = await makePdf("CALLER_COOKIE");
    const { calls, fetch } = recording(() => ok(pdf));
    await fetchAttachmentTexts(
      [{ name: "a.pdf", url: `${B}a.pdf`, kind: "pdf", headers: { Cookie: "locale=ko" } }],
      opts(fetch),
    );
    expect(header(calls[0].headers, "cookie")).toBe("locale=ko");
    expect(headerCount(calls[0].headers, "cookie")).toBe(1);
  });

  it("머리글 객체가 없는 응답 모양(시험용 가짜·옛 경유)이어도 쿠키 담기가 내려받기를 깨지 않는다", async () => {
    const pdf = await makePdf("NO_HEADERS");
    let sent = false;
    const bare = {
      status: 200,
      ok: true,
      body: {
        getReader: () => ({
          read: async () => (sent ? { done: true } : ((sent = true), { done: false, value: Uint8Array.from(pdf) })),
          cancel: async () => undefined,
          releaseLock: () => undefined,
        }),
      },
    } as unknown as Response;
    const r = await fetchAttachmentTexts(one(), opts(async () => bare));
    expect(r.readFiles).toEqual(["a.pdf"]);
    expect(r.text).toContain("NO_HEADERS");
  });
});

describe("첨부 결과 — 파일마다 결과와 못 받은 이유(files)", () => {
  type Case = {
    title: string;
    respond: (url: string) => Response;
    reason: AttachmentFileReason;
    more?: Record<string, unknown>;
  };
  const cases: Case[] = [
    { title: "사이트 404", respond: () => new Response("gone", { status: 404 }), reason: "not_found" },
    { title: "사이트 410", respond: () => new Response("gone", { status: 410 }), reason: "not_found" },
    { title: "사이트 500", respond: () => new Response("err", { status: 500 }), reason: "http_error" },
    { title: "사이트 403", respond: () => new Response("no", { status: 403 }), reason: "http_error" },
    { title: "다음 주소 없는 302", respond: () => redirectTo(null), reason: "http_error" },
    { title: "끝나지 않는 리다이렉트", respond: (u) => redirectTo(`${u}x`), reason: "redirect_limit" },
    { title: "허용 안 된 호스트로 이동", respond: () => redirectTo("https://evil.example.com/a.pdf"), reason: "blocked_host" },
    {
      title: "상한을 넘는 파일",
      respond: () => ok(Buffer.from(`%PDF-1.4 ${"x".repeat(64)}`)),
      reason: "too_big",
      more: { maxBytes: 16 },
    },
    { title: "빈 본문", respond: () => new Response(new Uint8Array(0), { status: 200 }), reason: "empty" },
    { title: "본문 없는 200", respond: () => new Response(null, { status: 200 }), reason: "empty" },
  ];
  for (const c of cases) {
    it(`${c.title} → failed·${c.reason} (표시는 예전 그대로)`, async () => {
      const { fetch } = recording((u) => c.respond(u));
      const r = await fetchAttachmentTexts(one(), opts(fetch, c.more));
      expect(r.failedFiles).toEqual(["a.pdf"]);
      expect(r.text).toContain("[읽지 못한 첨부: a.pdf]");
      expect(r.files).toEqual([expect.objectContaining({ name: "a.pdf", result: "failed", reason: c.reason })]);
    });
  }

  const thrown: Array<{ title: string; error: () => unknown; reason: AttachmentFileReason }> = [
    { title: "시간 초과", error: () => new DOMException("The operation was aborted due to timeout", "TimeoutError"), reason: "timeout" },
    { title: "바깥 예산으로 중단", error: () => new DOMException("This operation was aborted", "AbortError"), reason: "aborted" },
    { title: "연결 실패", error: () => new TypeError("fetch failed"), reason: "network" },
    {
      title: "경유 통로·세션 발급 실패(통로 탓 표식)",
      error: () => markProxyTransportError(new Error("[board-proxy] 경유 통로가 응답하지 않는다")),
      reason: "transport",
    },
  ];
  for (const c of thrown) {
    it(`${c.title} → failed·${c.reason}`, async () => {
      const r = await fetchAttachmentTexts(
        one(),
        opts(async () => {
          throw c.error();
        }),
      );
      expect(r.failedFiles).toEqual(["a.pdf"]);
      expect(r.text).toContain("[읽지 못한 첨부: a.pdf]");
      expect(r.files).toEqual([expect.objectContaining({ name: "a.pdf", result: "failed", reason: c.reason })]);
      expect(r.proxyFailed).toBe(c.reason === "transport");
    });
  }

  it("허용 안 된 저장 주소 → failed·blocked_url, 부르지도 않는다", async () => {
    const fetch = vi.fn(async () => new Response("x"));
    const r = await fetchAttachmentTexts(one("a.pdf", "https://evil.example.com/a.pdf"), opts(fetch));
    expect(fetch).not.toHaveBeenCalled();
    expect(r.text).toContain("[허용되지 않은 첨부 주소: a.pdf]");
    expect(r.files).toEqual([expect.objectContaining({ name: "a.pdf", result: "failed", reason: "blocked_url" })]);
  });

  it("이름에도 바이트에도 형식이 없으면 failed·unknown_format", async () => {
    const r = await fetchAttachmentTexts(
      [{ name: "file", url: `${B}x`, kind: "etc" }],
      opts(async () => ok(Buffer.from([0, 1, 2, 3, 4, 5, 6, 7]))),
    );
    expect(r.failedFiles).toEqual(["file"]);
    expect(r.files).toEqual([expect.objectContaining({ name: "file", result: "failed", reason: "unknown_format" })]);
  });

  it("형식은 알았는데 뽑은 글자가 비면 failed·no_text", async () => {
    const zipLike = Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4, 5, 6]);
    const r = await fetchAttachmentTexts(
      [{ name: "a.hwpx", url: `${B}a.hwpx`, kind: "hwpx" }],
      opts(async () => ok(zipLike)),
    );
    expect(r.failedFiles).toEqual(["a.hwpx"]);
    expect(r.files).toEqual([expect.objectContaining({ name: "a.hwpx", result: "failed", reason: "no_text" })]);
  });

  it("읽은 파일은 read·형식·글자 수를 남기고 이유는 없다", async () => {
    const pdf = await makePdf("READ_ENTRY");
    const r = await fetchAttachmentTexts(one(), opts(async () => ok(pdf)));
    expect(r.files).toEqual([expect.objectContaining({ name: "a.pdf", result: "read", kind: "pdf" })]);
    const entry: AttachmentFileOutcome = r.files![0];
    expect(entry.reason).toBeUndefined();
    expect(entry.chars).toBeGreaterThanOrEqual("READ_ENTRY".length);
  });

  it("개수 상한으로 안 읽은 파일은 skipped·over_limit (읽은 것 뒤에)", async () => {
    const pdf = await makePdf("LIMIT");
    const r = await fetchAttachmentTexts(
      [
        { name: "a.pdf", url: `${B}a.pdf`, kind: "pdf" },
        { name: "b.pdf", url: `${B}b.pdf`, kind: "pdf" },
      ],
      opts(async () => ok(pdf), { maxFiles: 1 }),
    );
    expect(r.files).toEqual([
      expect.objectContaining({ name: "a.pdf", result: "read" }),
      expect.objectContaining({ name: "b.pdf", result: "skipped", reason: "over_limit" }),
    ]);
  });

  it("글자 상한에 잘린 파일은 read·truncated", async () => {
    const pdf = await makePdf("HEAD_MARK_AAAA BBBB CCCC DDDD EEEE FFFF GGGG");
    const r = await fetchAttachmentTexts(one(), opts(async () => ok(pdf), { totalCharCap: 40 }));
    expect(r.skippedFiles).toContain("a.pdf"); // 지금도 잘린 파일은 미확인 목록에 들어간다
    expect(r.files).toEqual([expect.objectContaining({ name: "a.pdf", result: "read", reason: "truncated" })]);
  });

  it("자동 저장 모드에서 미리보기만 읽힌 한글 파일은 skipped·preview_only", async () => {
    const r = await fetchAttachmentTexts(
      [{ name: "a.hwp", url: `${B}a.hwp`, kind: "hwp" }],
      opts(async () => ok(previewOnlyHwp()), { includeHwpPreview: false }),
    );
    expect(r.previewOnlyFiles).toEqual(["a.hwp"]);
    expect(r.files).toEqual([
      expect.objectContaining({ name: "a.hwp", result: "skipped", reason: "preview_only", kind: "hwp" }),
    ]);
  });

  it("미리보기를 남기는 모드에서는 read·preview_only", async () => {
    const r = await fetchAttachmentTexts(
      [{ name: "a.hwp", url: `${B}a.hwp`, kind: "hwp" }],
      opts(async () => ok(previewOnlyHwp())),
    );
    expect(r.readFiles).toEqual(["a.hwp"]);
    expect(r.files).toEqual([
      expect.objectContaining({ name: "a.hwp", result: "read", reason: "preview_only", kind: "hwp" }),
    ]);
  });

  it("첨부가 없으면 빈 목록", async () => {
    const r = await fetchAttachmentTexts([], opts(async () => ok(Buffer.alloc(0))));
    expect(r.files).toEqual([]);
  });
});
