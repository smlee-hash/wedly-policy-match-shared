import { describe, expect, it, vi } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { sessionAttachmentFetch } from "./attachment-session";
import { fetchAttachmentTexts } from "../attachment-text";
import { BROWSER_UA } from "./fetch-identity";
import { isProxyTransportError } from "./proxy";
import { sjtpConfig } from "./sources/sjtp";
import { tpBusan, tpBusanPrecall } from "./sources/tp-busan";
import { jbbaConfig } from "./sources/jbba";
import { atkoreaConfig } from "./sources/atkorea";
import { cbsinboConfig } from "./sources/cbsinbo";
import type { BoardConfig } from "./types";

/**
 * 첨부 세션 감싸개 — 2026-10-01 한국 IP 실측으로 더한 것.
 *
 * · 데우기(상세 GET)도 목록 수집과 같은 브라우저 UA·`Accept-Language: ko` 로 부른다.
 * · 첨부 응답이 준 쿠키도 같은 줄의 다음 첨부에 싣는다(지금은 데우기 응답 쿠키만 모은다).
 * · 부산TP(`notion-d6b0973897d5-notes/data/probe-btp.out`): `downloadRun.do?qcode=…` 를 그냥 부르면
 *   `302 → /resources/Error/404.html`, 상세를 데워도 같다. **첨부마다** 먼저
 *   `download.json?qcode=<q>&prg_code=<atob(q) 의 첫 조각>` 를 부르면 JSESSIONID 가 오고,
 *   그 쿠키로 부른 `downloadRun.do` 가 파일(25,504,446바이트)을 준다. 화면의 내려받기 단추가 하는 순서다.
 */

const DETAIL = "https://sjtp.or.kr/bbs/board.php?bo_table=business01&wr_id=1985";
const ATTACH = "https://sjtp.or.kr/bbs/download.php?bo_table=business01&wr_id=1985&no=0";

const DETAIL_BTP = "https://www.btp.or.kr/kor/CMS/Board/Board.do?mCode=MN013&mode=view&mgr_seq=16&board_seq=9582503";
const RUN = "https://www.btp.or.kr/kor/ajx_json/UploadMgr/downloadRun.do";
const PRE = "https://www.btp.or.kr/kor/ajx_json/UploadMgr/download.json";
const ATTACH_BTP = `${RUN}?qcode=Qm9hcmQsMzM4MDEsWQ==`; // "Board,33801,Y"
const PRE_BTP = `${PRE}?qcode=Qm9hcmQsMzM4MDEsWQ%3D%3D&prg_code=Board`;

async function makePdf(text: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage([300, 200]).drawText(text, { x: 20, y: 100, size: 12, font });
  return doc.save();
}

const enc = (s: string) => new TextEncoder().encode(s);

function headersOf(init?: RequestInit): Record<string, string> {
  const h = init?.headers;
  if (!h) return {};
  if (h instanceof Headers) return Object.fromEntries(h.entries());
  if (Array.isArray(h)) return Object.fromEntries(h);
  return { ...(h as Record<string, string>) };
}

function header(h: Record<string, string>, name: string): string | undefined {
  const k = Object.keys(h).find((x) => x.toLowerCase() === name.toLowerCase());
  return k === undefined ? undefined : h[k];
}

type Call = { url: string; init?: RequestInit; headers: Record<string, string> };
type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

function recording(handler: (url: string, call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const call = { url, init, headers: headersOf(init) };
    calls.push(call);
    return handler(url, call);
  });
  return { calls, fetch: fetch as unknown as Fetch };
}

function res(status: number, opts: { setCookies?: string[]; location?: string; body?: Uint8Array } = {}): Response {
  const h = new Headers();
  if (opts.location) h.set("location", opts.location);
  for (const c of opts.setCookies ?? []) h.append("set-cookie", c);
  return new Response(opts.body ? Uint8Array.from(opts.body) : null, { status, headers: h });
}

/** 실측 순서를 흉내 낸 부산TP. 사전 호출을 거쳐 JSESSIONID 가 있어야만 파일을 준다. */
function fakeBtp(opts: { pre?: (call: Call) => Response; file?: Uint8Array } = {}) {
  return recording((url, call) => {
    if (url.startsWith(PRE)) {
      return opts.pre
        ? opts.pre(call)
        : res(200, { setCookies: ["JSESSIONID=s1; Path=/; HttpOnly"], body: enc('{"result":"Y"}') });
    }
    if (url.startsWith(RUN)) {
      return (header(call.headers, "cookie") ?? "").includes("JSESSIONID=s1")
        ? res(200, { body: opts.file ?? enc("%PDF-1.4") })
        : res(302, { location: "/resources/Error/404.html" });
    }
    if (url.includes("/resources/Error/404.html")) return res(404, { body: enc("<html>404</html>") });
    if (url.includes("Board.do")) return res(200, { setCookies: ["WARM=1; Path=/"], body: enc("<html></html>") });
    return res(500);
  });
}

describe("데우기도 브라우저 신원으로", () => {
  it("★상세 데우기 요청에 UA·Accept-Language 가 실린다", async () => {
    const { calls, fetch } = recording((url) =>
      url.includes("board.php") ? res(200, { setCookies: ["PHPSESSID=abc123; path=/"] }) : res(200, { body: enc("x") }),
    );
    await sessionAttachmentFetch(sjtpConfig, DETAIL, fetch)!(ATTACH);
    expect(calls[0].url).toBe(DETAIL);
    expect(header(calls[0].headers, "user-agent")).toBe(BROWSER_UA);
    expect(header(calls[0].headers, "accept-language")).toBe("ko");
    expect(header(calls[1].headers, "cookie")).toContain("PHPSESSID=abc123");
  });
});

describe("첨부 응답이 준 쿠키도 같은 줄의 다음 첨부에 싣는다", () => {
  const cases: Array<[string, BoardConfig]> = [
    ["데우기 게시판", sjtpConfig],
    ["Referer 만 쓰는 게시판", { ...sjtpConfig, attachmentSession: { referer: "detail" } }],
  ];
  for (const [이름, cfg] of cases) {
    it(`${이름}`, async () => {
      const second = ATTACH.replace("no=0", "no=1");
      const { calls, fetch } = recording((url) => {
        if (url.includes("board.php")) return res(200, { setCookies: ["PHPSESSID=abc123; path=/"] });
        if (url === ATTACH) return res(200, { setCookies: ["dl=1; Path=/"], body: enc("a") });
        return res(200, { body: enc("b") });
      });
      const wrapped = sessionAttachmentFetch(cfg, DETAIL, fetch)!;
      await wrapped(ATTACH);
      await wrapped(second);
      const sent = calls.find((c) => c.url === second)!;
      expect(header(sent.headers, "cookie")).toContain("dl=1");
    });
  }
});

describe("부산TP 사전 호출 주소(tpBusanPrecall)", () => {
  it("★저장된 첨부 주소의 qcode 로 download.json 주소를 만든다(prg_code = 풀어 낸 첫 조각)", () => {
    expect(tpBusanPrecall(ATTACH_BTP)).toBe(PRE_BTP);
  });

  it("퍼센트 부호화된 저장 형태도 같은 주소가 된다", () => {
    expect(tpBusanPrecall(`${RUN}?qcode=Qm9hcmQsMzM4MDEsWQ%3D%3D`)).toBe(PRE_BTP);
  });

  it("qcode 의 '+'·'/' 를 공백 등으로 바꾸지 않고 부호화해 넘긴다", () => {
    expect(tpBusanPrecall(`${RUN}?qcode=Qm9hcmQsMT4+LFk=`)).toBe(`${PRE}?qcode=Qm9hcmQsMT4%2BLFk%3D&prg_code=Board`); // "Board,1>>,Y"
    expect(tpBusanPrecall(`${RUN}?qcode=Qm9hcmQsfj4/LFk=`)).toBe(`${PRE}?qcode=Qm9hcmQsfj4%2FLFk%3D&prg_code=Board`); // "Board,~>?,Y"
  });

  it("다른 쿼리가 함께 있어도 qcode 만 쓴다", () => {
    expect(tpBusanPrecall(`${RUN}?x=1&qcode=Qm9hcmQsMzM4MDEsWQ==&y=2`)).toBe(PRE_BTP);
  });

  it("부산TP 첨부 내려받기 주소가 아니면 null", () => {
    expect(tpBusanPrecall("https://evil.example.com/kor/ajx_json/UploadMgr/downloadRun.do?qcode=Qm9hcmQsMzM4MDEsWQ==")).toBeNull();
    expect(tpBusanPrecall("https://www.btp.or.kr/resources/Error/404.html")).toBeNull();
    expect(tpBusanPrecall(DETAIL_BTP)).toBeNull();
    expect(tpBusanPrecall(RUN)).toBeNull();
    expect(tpBusanPrecall(`${RUN}?qcode=`)).toBeNull();
    expect(tpBusanPrecall("not a url")).toBeNull();
  });

  it("풀어 낸 첫 조각이 영문·숫자·밑줄이 아니면 null — 남의 값을 주소에 끼워 넣지 않는다", () => {
    expect(tpBusanPrecall(`${RUN}?qcode=PHg+LDEsWQ==`)).toBeNull(); // "<x>,1,Y"
    expect(tpBusanPrecall(`${RUN}?qcode=%%%`)).toBeNull();
  });
});

describe("사전 호출 감싸개(attachmentSession.precall)", () => {
  it("★첨부마다 먼저 download.json 을 불러 받은 쿠키로 첨부를 받는다 — 상세는 데우지 않는다", async () => {
    const { calls, fetch } = fakeBtp();
    const signal = AbortSignal.timeout(30_000);
    const r = await sessionAttachmentFetch(tpBusan, DETAIL_BTP, fetch)!(ATTACH_BTP, { redirect: "manual", signal });
    expect(r.status).toBe(200);
    expect(calls.map((c) => c.url)).toEqual([PRE_BTP, ATTACH_BTP]);

    const pre = calls[0];
    expect(pre.init?.method ?? "GET").toBe("GET");
    expect(pre.init?.redirect).toBe("manual");
    expect(pre.init?.signal).toBe(signal); // 부르는 쪽 시간 상한을 나눠 쓴다
    expect(header(pre.headers, "referer")).toBe(DETAIL_BTP);
    expect(header(pre.headers, "user-agent")).toBe(BROWSER_UA);
    expect(header(pre.headers, "accept-language")).toBe("ko");

    expect(header(calls[1].headers, "cookie")).toContain("JSESSIONID=s1");
    expect(header(calls[1].headers, "referer")).toBe(DETAIL_BTP);
  });

  it("첨부가 둘이면 사전 호출도 둘 — 서버가 받을 파일을 그때그때 기억한다", async () => {
    const { calls, fetch } = fakeBtp();
    const wrapped = sessionAttachmentFetch(tpBusan, DETAIL_BTP, fetch)!;
    await wrapped(ATTACH_BTP);
    await wrapped(`${RUN}?qcode=Qm9hcmQsMzM4MDIsWQ==`);
    expect(calls.map((c) => c.url)).toEqual([
      PRE_BTP,
      ATTACH_BTP,
      `${PRE}?qcode=Qm9hcmQsMzM4MDIsWQ%3D%3D&prg_code=Board`,
      `${RUN}?qcode=Qm9hcmQsMzM4MDIsWQ==`,
    ]);
  });

  it("사전 호출 주소가 안 나오는 요청(리다이렉트 홉 등)은 한 번만 부른다", async () => {
    const { calls, fetch } = fakeBtp();
    await sessionAttachmentFetch(tpBusan, DETAIL_BTP, fetch)!("https://www.btp.or.kr/resources/Error/404.html");
    expect(calls).toHaveLength(1);
  });

  it("사전 호출만 있는 설정도 감싼다 — Referer 는 설정이 있을 때만 싣는다", async () => {
    const cfg: BoardConfig = { ...tpBusan, attachmentSession: { precall: tpBusanPrecall } };
    const { calls, fetch } = fakeBtp();
    const wrapped = sessionAttachmentFetch(cfg, DETAIL_BTP, fetch);
    expect(wrapped).toBeTypeOf("function");
    await wrapped!(ATTACH_BTP);
    expect(calls.map((c) => c.url)).toEqual([PRE_BTP, ATTACH_BTP]);
    expect(header(calls[0].headers, "referer")).toBeUndefined();
  });

  it("데우기와 함께면 상세 → 사전 호출 → 첨부 순서이고, 사전 호출에도 데우기 쿠키가 실린다", async () => {
    const cfg: BoardConfig = {
      ...tpBusan,
      attachmentSession: { warmup: "detail", referer: "detail", precall: tpBusanPrecall },
    };
    const { calls, fetch } = fakeBtp();
    await sessionAttachmentFetch(cfg, DETAIL_BTP, fetch)!(ATTACH_BTP);
    expect(calls.map((c) => c.url)).toEqual([DETAIL_BTP, PRE_BTP, ATTACH_BTP]);
    expect(header(calls[1].headers, "cookie")).toContain("WARM=1");
    expect(header(calls[2].headers, "cookie")).toContain("WARM=1");
    expect(header(calls[2].headers, "cookie")).toContain("JSESSIONID=s1");
  });

  it("사전 호출 주소가 명부 밖 호스트면 부르지 않고 경고만 남긴 뒤 첨부는 그대로 부른다", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const cfg: BoardConfig = {
        ...tpBusan,
        attachmentSession: { referer: "detail", precall: () => "https://evil.example.com/steal" },
      };
      const { calls, fetch } = fakeBtp();
      await sessionAttachmentFetch(cfg, DETAIL_BTP, fetch)!(ATTACH_BTP);
      expect(calls.map((c) => c.url)).toEqual([ATTACH_BTP]);
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  describe("★사전 호출 실패는 통로 탓 — 첨부는 부르지 않는다(7일 도장 대신 1시간 재시도)", () => {
    it("사전 호출이 500", async () => {
      const { calls, fetch } = fakeBtp({ pre: () => res(500) });
      const err = await sessionAttachmentFetch(tpBusan, DETAIL_BTP, fetch)!(ATTACH_BTP).catch((e) => e);
      expect(isProxyTransportError(err)).toBe(true);
      expect((err as Error).message).toContain("사전 호출");
      expect(calls.filter((c) => c.url.startsWith(RUN))).toHaveLength(0);
    });

    it("사전 호출 연결 실패", async () => {
      const { calls, fetch } = fakeBtp({
        pre: () => {
          throw Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
        },
      });
      const err = await sessionAttachmentFetch(tpBusan, DETAIL_BTP, fetch)!(ATTACH_BTP).catch((e) => e);
      expect(isProxyTransportError(err)).toBe(true);
      expect(calls.filter((c) => c.url.startsWith(RUN))).toHaveLength(0);
    });

    it("내려받기 단계까지 이어 보면 proxyFailed 이고 이유는 transport", async () => {
      const { fetch } = fakeBtp({ pre: () => res(500) });
      const wrapped = sessionAttachmentFetch(tpBusan, DETAIL_BTP, fetch)!;
      const r = await fetchAttachmentTexts([{ name: "공고문.pdf", url: ATTACH_BTP, kind: "pdf" }], {
        extractHwpx: () => "",
        fetch: wrapped,
      });
      expect(r.proxyFailed).toBe(true);
      expect(r.failedFiles).toEqual(["공고문.pdf"]);
      expect(r.files).toEqual([expect.objectContaining({ name: "공고문.pdf", result: "failed", reason: "transport" })]);
    });
  });
});

describe("부산TP 끝까지 — 내려받기 단계에서 본다", () => {
  const ATT = [{ name: "공고문.pdf", url: ATTACH_BTP, kind: "pdf" as const }];

  it("감싸개 없이 부르면 오류 화면으로 넘어가 못 읽는다", async () => {
    const { fetch } = fakeBtp({ file: await makePdf("BTP_MARK") });
    const r = await fetchAttachmentTexts(ATT, { extractHwpx: () => "", fetch });
    expect(r.readFiles).toEqual([]);
    expect(r.failedFiles).toEqual(["공고문.pdf"]);
  });

  it("★감싸개를 끼우면 같은 첨부의 글자가 나온다", async () => {
    const { fetch } = fakeBtp({ file: await makePdf("BTP_MARK") });
    const wrapped = sessionAttachmentFetch(tpBusan, DETAIL_BTP, fetch)!;
    const r = await fetchAttachmentTexts(ATT, { extractHwpx: () => "", fetch: wrapped });
    expect(r.readFiles).toEqual(["공고문.pdf"]);
    expect(r.text).toContain("BTP_MARK");
  });
});

describe("이번에 붙인 출처의 설정(2026-10-01 실측)", () => {
  it("전북경제통상진흥원 — 상세 데우기 + Referer", () => {
    expect(jbbaConfig.attachmentSession).toEqual({ warmup: "detail", referer: "detail" });
  });

  it("한국농수산식품유통공사(aT) — Referer 만", () => {
    expect(atkoreaConfig.attachmentSession).toEqual({ referer: "detail" });
  });

  it("충북신용보증재단 — Referer 만", () => {
    expect(cbsinboConfig.attachmentSession).toEqual({ referer: "detail" });
  });

  it("부산테크노파크 — Referer + 첨부마다 사전 호출(데우기는 필요 없다는 실측)", () => {
    expect(typeof tpBusanPrecall).toBe("function");
    expect(tpBusan.attachmentSession).toEqual({ referer: "detail", precall: tpBusanPrecall });
  });
});
