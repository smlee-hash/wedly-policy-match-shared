import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchProductText, fetchProductWithCookies } from "./fetch";

/** 게시판 엔진이 기대하는 응답의 최소 모양(BoardResponse)을 흉내낸다. */
function fakeRes(
  body: string,
  opts: { status?: number; setCookie?: string[]; location?: string } = {},
) {
  const status = opts.status ?? 200;
  const bytes = new TextEncoder().encode(body);
  let sent = false;
  return {
    status,
    ok: status < 400,
    headers: {
      get: (k: string) => {
        const key = k.toLowerCase();
        if (key === "set-cookie") return opts.setCookie?.[0] ?? null;
        if (key === "location") return opts.location ?? null;
        return null;
      },
      getSetCookie: () => opts.setCookie ?? [],
    },
    body: {
      getReader: () => ({
        read: async () => (sent ? { done: true } : ((sent = true), { done: false, value: bytes })),
        cancel: async () => {},
      }),
    },
  };
}

const KINFA = { id: "kinfa", baseUrl: "https://www.kinfa.or.kr" };

let fetchMock: ReturnType<typeof vi.fn>;
const realFetch = globalThis.fetch;

beforeEach(() => {
  fetchMock = vi.fn();
  (globalThis as { fetch: unknown }).fetch = fetchMock;
});
afterEach(() => {
  (globalThis as { fetch: unknown }).fetch = realFetch;
});

describe("fetchProductText — 게시판 엔진(fetchBoardText)을 빌려 쓴다", () => {
  it("허용 호스트면 본문 글을 그대로 돌려주고, 게시판과 같은 기본 헤더를 싣는다", async () => {
    fetchMock.mockResolvedValue(fakeRes('{"list":[]}'));
    const text = await fetchProductText(KINFA, "https://www.kinfa.or.kr/x.do");
    expect(text).toBe('{"list":[]}');
    const [url, init] = fetchMock.mock.calls[0] as [string, { headers: Record<string, string>; method: string }];
    expect(url).toBe("https://www.kinfa.or.kr/x.do");
    expect(init.method).toBe("GET");
    expect(init.headers["Accept-Language"]).toBe("ko");
    expect(init.headers["User-Agent"]).toContain("Mozilla/5.0");
  });

  it("★baseUrl 밖 호스트는 요청 자체를 하지 않는다 — 게시판과 같은 검문을 그대로 받는다", async () => {
    await expect(fetchProductText(KINFA, "https://evil.test/x")).rejects.toThrow("허용되지 않은 호스트");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("allowedHosts 에 적어 둔 호스트는 열어 준다", async () => {
    fetchMock.mockResolvedValue(fakeRes("ok"));
    const cfg = { id: "sbiz", baseUrl: "https://www.semas.or.kr", allowedHosts: ["ols.semas.or.kr"] };
    await expect(fetchProductText(cfg, "https://ols.semas.or.kr/ols/man/SMAN018M/page.do")).resolves.toBe("ok");
  });

  it("POST 와 헤더를 그대로 실어 보낸다 — 목록이 폼 통로인 원천용", async () => {
    fetchMock.mockResolvedValue(fakeRes("[]"));
    await fetchProductText(
      KINFA,
      "https://www.kinfa.or.kr/financialProduct/loanProductGlanceSearch.do",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: '{"currentPageNo":1}' },
    );
    const init = fetchMock.mock.calls[0][1] as { method: string; body: string; headers: Record<string, string> };
    expect(init.method).toBe("POST");
    expect(init.body).toBe('{"currentPageNo":1}');
    expect(init.headers["Content-Type"]).toBe("application/json");
  });
});

describe("fetchProductWithCookies — 응답이 심어 준 쿠키까지 돌려준다", () => {
  const FINLIFE = { id: "finlife-soho", baseUrl: "https://finlife.fss.or.kr" };
  const listUrl = "https://finlife.fss.or.kr/finlife/ldng/indvlBusi/list.do?menuNo=700072";

  it("Set-Cookie 를 이름=값으로 이어 붙여 준다 — 다음 POST 에 그대로 실을 수 있게", async () => {
    fetchMock.mockResolvedValue(
      fakeRes("<html>목록</html>", { setCookie: ["WMONID=abc; Path=/", "JSESSIONID=xyz; Path=/"] }),
    );
    const out = await fetchProductWithCookies(FINLIFE, listUrl);
    expect(out.text).toBe("<html>목록</html>");
    expect(out.cookie).toBe("WMONID=abc; JSESSIONID=xyz");
  });

  it("쿠키를 안 주면 빈 글자 — 없는 쿠키를 지어내지 않는다", async () => {
    fetchMock.mockResolvedValue(fakeRes("ok"));
    await expect(fetchProductWithCookies(FINLIFE, listUrl)).resolves.toEqual({ text: "ok", cookie: "" });
  });

  it("★리다이렉트는 따라가지 않는다 — 어느 홉의 쿠키인지 모호해지므로 오류로 세운다", async () => {
    fetchMock.mockResolvedValue(
      fakeRes("", { status: 302, location: "https://finlife.fss.or.kr/other", setCookie: ["WMONID=abc; Path=/"] }),
    );
    await expect(fetchProductWithCookies(FINLIFE, listUrl)).rejects.toThrow("리다이렉트");
  });

  it("허용 호스트 검문은 여기도 똑같이 받는다", async () => {
    await expect(fetchProductWithCookies(FINLIFE, "https://evil.test/x")).rejects.toThrow("허용되지 않은 호스트");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("HTTP 오류는 그대로 올린다", async () => {
    fetchMock.mockResolvedValue(fakeRes("nope", { status: 500 }));
    await expect(fetchProductWithCookies(FINLIFE, listUrl)).rejects.toThrow("HTTP 500");
  });
});
