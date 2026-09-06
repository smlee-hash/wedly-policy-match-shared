import { afterEach, describe, expect, it, vi } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { sessionAttachmentFetch } from "./attachment-session";
import { fetchAttachmentTexts } from "../attachment-text";
import { isProxyTransportError, proxiedAttachmentFetch, proxyDispatcher, resetProxyCacheForTest, resetProxyWarnForTest } from "./proxy";
import { sjtpConfig } from "./sources/sjtp";
import { seseConfig } from "./sources/sese";
import type { BoardConfig } from "./types";

/**
 * 근거(2026-09-06 curl 실측): 세종TP `bbs/download.php?…` 는 쿠키 없이 부르면
 * **200 + text/html 3,947바이트**(「잘못된 접근입니다」)를 준다 — 실패가 아니라 **성공처럼 생긴 HTML** 이라
 * `downloadBytes` 는 그걸 그대로 받아 오고 `sniffAttachmentKind` 가 못 알아봐 「읽지 못한 첨부」가 된다.
 * 상세를 한 번 GET 해 받은 쿠키를 실으면 `content-disposition: attachment` + HWP(OLE `d0cf11e0`) 가 온다.
 */
const DENIED_HTML = '<!doctype html><script>alert("잘못된 접근입니다.");</script>';

/** 세션이 통했을 때 서버가 주는 진짜 파일(실측은 HWP 78,848바이트 — 시험은 읽을 수 있는 PDF 로). */
async function makePdf(text: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage([300, 200]).drawText(text, { x: 20, y: 100, size: 12, font });
  return doc.save();
}

const KEY = "POLICY_BOARD_PROXY_URL";
const originalProxy = process.env[KEY];

afterEach(() => {
  if (originalProxy === undefined) delete process.env[KEY];
  else process.env[KEY] = originalProxy;
  resetProxyCacheForTest();
  resetProxyWarnForTest();
});

const DETAIL = "https://sjtp.or.kr/bbs/board.php?bo_table=business01&wr_id=1985";
const ATTACH = "https://sjtp.or.kr/bbs/download.php?bo_table=business01&wr_id=1985&no=0";

type Call = { url: string; headers: Record<string, string> };

function headersOf(init?: RequestInit): Record<string, string> {
  const h = init?.headers;
  if (!h) return {};
  if (Array.isArray(h)) return Object.fromEntries(h);
  return { ...(h as Record<string, string>) };
}

/** 세션이 있어야만 파일을 주는 가짜 게시판. 없으면 **200 + HTML** 이다(실측과 같다). */
function fakeBoard(opts: { requireCookie?: boolean; requireReferer?: boolean; file?: Uint8Array } = {}) {
  const calls: Call[] = [];
  const fetchImpl = vi.fn(async (url: string, init?: RequestInit): Promise<Response> => {
    const headers = headersOf(init);
    calls.push({ url, headers });
    if (url.includes("board.php")) {
      // 상세 — 쿠키를 3개 내준다(그누보드 실측 모양).
      return {
        status: 200,
        ok: true,
        headers: {
          get: () => null,
          getSetCookie: () => [
            "PHPSESSID=abc123; path=/; HttpOnly",
            "2a0d2363701f23f8a75028924a3af643=1; path=/",
            "e1192aefb64683cc97abb83c71057733=1; path=/",
          ],
        },
        body: null,
      } as unknown as Response;
    }
    const cookieOk = !opts.requireCookie || (headers.Cookie ?? "").includes("PHPSESSID=abc123");
    const refererOk = !opts.requireReferer || (headers.Referer ?? "").includes("board.php");
    const bytes =
      cookieOk && refererOk
        ? (opts.file ?? Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))
        : new TextEncoder().encode(DENIED_HTML);
    let sent = false;
    return {
      status: 200,
      ok: true,
      headers: { get: () => null },
      body: {
        getReader: () => ({
          read: async () => (sent ? { done: true } : ((sent = true), { done: false, value: bytes })),
          cancel: async () => undefined,
        }),
      },
    } as unknown as Response;
  });
  return { calls, fetchImpl: fetchImpl as unknown as (url: string, init?: RequestInit) => Promise<Response> };
}

const cfgWith = (session: BoardConfig["attachmentSession"]): BoardConfig => ({
  ...sjtpConfig,
  attachmentSession: session,
});

describe("상세 세션으로 첨부 받기", () => {
  it("★상세를 먼저 GET 해 set-cookie 를 모으고, 첨부 요청에 Cookie·Referer 를 싣는다", async () => {
    const { calls, fetchImpl } = fakeBoard({ requireCookie: true });
    const wrapped = sessionAttachmentFetch(sjtpConfig, DETAIL, fetchImpl)!;
    expect(wrapped).toBeTypeOf("function");
    await wrapped(ATTACH, { redirect: "manual" });

    expect(calls).toHaveLength(2);
    // 1회차 = 상세 데우기
    expect(calls[0].url).toBe(DETAIL);
    // 2회차 = 첨부. 쿠키 3개가 전부 실린다.
    expect(calls[1].url).toBe(ATTACH);
    expect(calls[1].headers.Cookie).toContain("PHPSESSID=abc123");
    expect(calls[1].headers.Cookie).toContain("2a0d2363701f23f8a75028924a3af643=1");
    expect(calls[1].headers.Referer).toBe(DETAIL);
  });

  it("같은 줄의 첨부가 여럿이어도 상세는 **한 번만** 데운다", async () => {
    const { calls, fetchImpl } = fakeBoard({ requireCookie: true });
    const wrapped = sessionAttachmentFetch(sjtpConfig, DETAIL, fetchImpl)!;
    await Promise.all([wrapped(ATTACH), wrapped(`${ATTACH}&no=1`), wrapped(`${ATTACH}&no=2`)]);
    expect(calls.filter((c) => c.url.includes("board.php"))).toHaveLength(1);
    expect(calls.filter((c) => c.url.includes("download.php"))).toHaveLength(3);
  });

  it("Referer 만 필요한 게시판은 상세를 데우지 않는다(사회적기업진흥원)", async () => {
    const { calls, fetchImpl } = fakeBoard({ requireReferer: true });
    const wrapped = sessionAttachmentFetch(cfgWith({ referer: "detail" }), DETAIL, fetchImpl)!;
    await wrapped(ATTACH);
    expect(calls).toHaveLength(1);
    expect(calls[0].headers.Referer).toBe(DETAIL);
    expect(calls[0].headers.Cookie).toBeUndefined();
  });

  it("설정이 없으면 감싸지 않는다 — 부르는 쪽이 예전 통로를 그대로 쓴다", () => {
    expect(sessionAttachmentFetch(cfgWith(undefined), DETAIL, fakeBoard().fetchImpl)).toBeUndefined();
    expect(sessionAttachmentFetch(undefined, DETAIL, fakeBoard().fetchImpl)).toBeUndefined();
  });

  it("★상세 주소가 명부 밖 호스트면 데우지도, Referer 로 쓰지도 않는다", () => {
    // 저장된 주소가 오염돼도 남의 서버를 대신 불러 주지 않는다.
    expect(sessionAttachmentFetch(sjtpConfig, "https://evil.example.com/x", fakeBoard().fetchImpl)).toBeUndefined();
    expect(sessionAttachmentFetch(sjtpConfig, "", fakeBoard().fetchImpl)).toBeUndefined();
  });

  /**
   * ★데우기 실패를 **삼키지 않는다**(2026-09-06 독립 리뷰 3번).
   * 예전엔 빈 항아리로 삼켰고, 그러면 첨부가 「200 + 잘못된 접근 HTML」로 와서 **파일 형식 실패**로
   * 분류돼 7일 도장이 찍혔다 — 잠깐의 세션 발급 장애가 일주일짜리 누락이 된다.
   */
  describe("★데우기 실패는 통로 탓으로 던진다 — 7일 도장이 아니라 1시간 재시도", () => {
    const failing = (fail: () => never | Promise<never>) => {
      const calls: Call[] = [];
      const impl = (async (url: string, init?: RequestInit) => {
        calls.push({ url, headers: headersOf(init) });
        if (url.includes("board.php")) return fail();
        return { status: 200, ok: true, headers: { get: () => null }, body: null } as unknown as Response;
      }) as (url: string, init?: RequestInit) => Promise<Response>;
      return { calls, impl };
    };

    it("상세가 던지면(연결 실패) 첨부 요청을 아예 안 보낸다", async () => {
      const { calls, impl } = failing(() => {
        throw Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
      });
      const wrapped = sessionAttachmentFetch(sjtpConfig, DETAIL, impl)!;
      const err = await wrapped(ATTACH).catch((e) => e);
      expect(isProxyTransportError(err)).toBe(true);
      expect(calls.filter((c) => c.url.includes("download.php"))).toHaveLength(0);
    });

    it("상세가 500 이면 통로 탓", async () => {
      const impl = (async (url: string): Promise<Response> => {
        if (url.includes("board.php")) {
          return { status: 500, ok: false, headers: { get: () => null }, body: null } as unknown as Response;
        }
        return { status: 200, ok: true, headers: { get: () => null }, body: null } as unknown as Response;
      }) as (url: string, init?: RequestInit) => Promise<Response>;
      const err = await sessionAttachmentFetch(sjtpConfig, DETAIL, impl)!(ATTACH).catch((e) => e);
      expect(isProxyTransportError(err)).toBe(true);
      expect((err as Error).message).toContain("500");
    });

    it("상세가 시간초과여도 통로 탓 — 사이트가 「없다」고 답한 것과 구분한다", async () => {
      const { impl } = failing(() => {
        throw new DOMException("aborted due to timeout", "TimeoutError");
      });
      const err = await sessionAttachmentFetch(sjtpConfig, DETAIL, impl)!(ATTACH).catch((e) => e);
      expect(isProxyTransportError(err)).toBe(true);
      expect((err as Error).message).toContain("TimeoutError");
    });

    it("★내려받기 단계까지 이어 보면 proxyFailed 가 참이다 → 부르는 쪽이 1시간 도장을 찍는다", async () => {
      const { impl } = failing(() => {
        throw Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
      });
      const wrapped = sessionAttachmentFetch(sjtpConfig, DETAIL, impl)!;
      const r = await fetchAttachmentTexts([{ name: "공고문.pdf", url: ATTACH, kind: "pdf" }], { extractHwpx: () => "",  fetch: wrapped });
      expect(r.proxyFailed).toBe(true);
      expect(r.failedFiles).toEqual(["공고문.pdf"]);
    });
  });

  /** ★부르는 쪽 30초 신호를 **그대로 물려받는다** — 홉마다 새 15초를 만들면 예산이 4배가 된다(리뷰 5번). */
  it("★데우기는 부르는 쪽 시간 상한을 나눠 쓴다 — 첨부와 같은 신호", async () => {
    const seen: Array<AbortSignal | undefined | null> = [];
    const impl = (async (url: string, init?: RequestInit): Promise<Response> => {
      seen.push(init?.signal);
      if (url.includes("board.php")) {
        return {
          status: 200, ok: true,
          headers: { get: () => null, getSetCookie: () => ["PHPSESSID=abc123; path=/"] },
          body: null,
        } as unknown as Response;
      }
      return { status: 200, ok: true, headers: { get: () => null }, body: null } as unknown as Response;
    }) as (url: string, init?: RequestInit) => Promise<Response>;
    const signal = AbortSignal.timeout(30_000);
    await sessionAttachmentFetch(sjtpConfig, DETAIL, impl)!(ATTACH, { signal });
    expect(seen).toHaveLength(2);
    expect(seen[0]).toBe(signal); // 데우기
    expect(seen[1]).toBe(signal); // 첨부
  });

  /** ★리다이렉트 홉 수를 `downloadBytes`(hop <= 3 = 요청 네 번)와 맞춘다(리뷰 6번). */
  it("★상세가 세 번 넘어가도 네 번째 요청에서 쿠키를 받는다", async () => {
    const urls: string[] = [];
    const impl = (async (url: string): Promise<Response> => {
      urls.push(url);
      const hop = urls.filter((u) => u.includes("board.php")).length;
      if (url.includes("board.php") && hop <= 3) {
        return {
          status: 302, ok: false,
          headers: { get: (n: string) => (n.toLowerCase() === "location" ? `${DETAIL}&hop=${hop}` : null) },
          body: null,
        } as unknown as Response;
      }
      if (url.includes("board.php")) {
        return {
          status: 200, ok: true,
          headers: { get: () => null, getSetCookie: () => ["PHPSESSID=abc123; path=/"] },
          body: null,
        } as unknown as Response;
      }
      return { status: 200, ok: true, headers: { get: () => null }, body: null } as unknown as Response;
    }) as (url: string, init?: RequestInit) => Promise<Response>;
    const calls: Call[] = [];
    const spy = (async (url: string, init?: RequestInit) => {
      calls.push({ url, headers: headersOf(init) });
      return impl(url, init);
    }) as (url: string, init?: RequestInit) => Promise<Response>;
    await sessionAttachmentFetch(sjtpConfig, DETAIL, spy)!(ATTACH);
    expect(calls.filter((c) => c.url.includes("board.php"))).toHaveLength(4);
    expect(calls.at(-1)!.headers.Cookie).toContain("PHPSESSID=abc123");
  });

  /** ★부르는 쪽이 넣어 둔 쿠키를 **버리지 않고 합친다**(리뷰 7번). 머리글 세 형태 + 소문자 이름. */
  describe("★기존 Cookie 를 버리지 않는다", () => {
    const cases: Array<[string, () => RequestInit]> = [
      ["평범한 객체", () => ({ headers: { Cookie: "locale=ko" } })],
      ["소문자 이름", () => ({ headers: { cookie: "locale=ko" } })],
      ["Headers 객체", () => ({ headers: new Headers({ cookie: "locale=ko" }) })],
      ["튜플 배열", () => ({ headers: [["Cookie", "locale=ko"]] as Array<[string, string]> })],
    ];
    for (const [이름, init] of cases) {
      it(`${이름} 로 넘겨도 PHPSESSID 가 함께 실린다`, async () => {
        const { calls, fetchImpl } = fakeBoard({ requireCookie: true });
        await sessionAttachmentFetch(sjtpConfig, DETAIL, fetchImpl)!(ATTACH, init());
        const sent = calls.at(-1)!.headers;
        const cookie = sent.Cookie ?? sent.cookie;
        expect(cookie).toContain("locale=ko");
        expect(cookie).toContain("PHPSESSID=abc123");
      });
    }
  });
});

describe("쿠키 없이 부르면 어떤 일이 벌어지나 — 내려받기 단계까지 이어 본다", () => {
  const ATT = [{ name: "공고문.pdf", url: ATTACH, kind: "pdf" as const }];

  it("★맨 GET 은 200 + HTML 을 받아 「읽지 못한 첨부」가 된다", async () => {
    const { fetchImpl } = fakeBoard({ requireCookie: true, file: await makePdf("SJTP_SESSION_MARK") });
    const r = await fetchAttachmentTexts(ATT, { extractHwpx: () => "",  fetch: fetchImpl });
    expect(r.readFiles).toEqual([]);
    expect(r.failedFiles).toEqual(["공고문.pdf"]);
    expect(r.text).toContain("[읽지 못한 첨부: 공고문.pdf]");
  });

  it("세션 감싸개를 끼우면 **같은 첨부의 글자가 실제로 나온다**", async () => {
    const { fetchImpl } = fakeBoard({ requireCookie: true, file: await makePdf("SJTP_SESSION_MARK") });
    const wrapped = sessionAttachmentFetch(sjtpConfig, DETAIL, fetchImpl)!;
    const r = await fetchAttachmentTexts(ATT, { extractHwpx: () => "",  fetch: wrapped });
    expect(r.readFiles).toEqual(["공고문.pdf"]);
    expect(r.failedFiles).toEqual([]);
    expect(r.text).toContain("SJTP_SESSION_MARK");
  });
});

describe("국내 경유와 겹치기", () => {
  it("★경유 baseFetch 위에 겹쳐도 Cookie·Referer 가 그대로 통로를 탄다", async () => {
    process.env[KEY] = "http://1.2.3.4:3128";
    const dispatcher = proxyDispatcher()!;
    const sent: Array<{ url: string; headers: Record<string, string>; viaProxy: boolean }> = [];
    // `boardFetch` 자리를 가로챈다 — dispatcher 가 실제로 넘어오는지까지 본다.
    type FakeRes = {
      status: number;
      ok: boolean;
      headers: { get: (n: string) => string | null; getSetCookie?: () => string[] };
      body: null;
    };
    const send = vi.fn(
      async (url: string, init: { headers: Record<string, string> }, d?: unknown): Promise<FakeRes> => {
        sent.push({ url, headers: init.headers, viaProxy: d === dispatcher });
        const headers: FakeRes["headers"] = { get: () => null };
        if (url.includes("board.php")) headers.getSetCookie = () => ["PHPSESSID=abc123; path=/"];
        return { status: 200, ok: true, headers, body: null };
      },
    );
    const proxied = proxiedAttachmentFetch(dispatcher, send as never);
    const wrapped = sessionAttachmentFetch(sjtpConfig, DETAIL, proxied)!;
    await wrapped(ATTACH);

    expect(sent).toHaveLength(2);
    // 데우기도 첨부도 **둘 다** 경유를 탄다.
    expect(sent.every((s) => s.viaProxy)).toBe(true);
    expect(sent[1].headers.Cookie).toContain("PHPSESSID=abc123");
    expect(sent[1].headers.Referer).toBe(DETAIL);
  });
});

describe("적용한 출처의 설정", () => {
  it("세종TP — 상세 데우기 + Referer", () => {
    expect(sjtpConfig.attachmentSession).toEqual({ warmup: "detail", referer: "detail" });
  });

  it("한국사회적기업진흥원 — Referer 만(쿠키는 필요 없다는 실측)", () => {
    expect(seseConfig.attachmentSession).toEqual({ referer: "detail" });
  });
});
