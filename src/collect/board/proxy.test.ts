import { afterEach, describe, expect, it, vi } from "vitest";
import { attachmentProxyAvailable, boardProxyUrl, isProxyTransportError, maskProxyUrl, proxiedAttachmentFetch, proxyDispatcher, resetProxyCacheForTest, resetProxyWarnForTest } from "./proxy";

/**
 * 여기서는 **환경변수를 시험이 직접 만든다** — `boardProxyUrl` 이 그때그때 읽기 때문에
 * 프로세스 시작값에 안 묶인다(extra-ca 에서 겪은 함정과 다른 경우다).
 * 그래도 원래 값은 반드시 되돌린다 — 같은 프로세스의 다른 시험이 영향을 받으면 안 된다.
 */
const KEY = "POLICY_BOARD_PROXY_URL";
const original = process.env[KEY];

afterEach(() => {
  if (original === undefined) delete process.env[KEY];
  else process.env[KEY] = original;
  resetProxyCacheForTest();
  resetProxyWarnForTest();
});

describe("국내 경유 설정 읽기", () => {
  it("설정값이 없으면 null", () => {
    delete process.env[KEY];
    expect(boardProxyUrl()).toBeNull();
  });

  it("빈 문자열·공백만 있으면 없는 것으로 본다 — 실수로 빈 값을 넣어도 경유하지 않는다", () => {
    process.env[KEY] = "   ";
    expect(boardProxyUrl()).toBeNull();
    expect(proxyDispatcher()).toBeUndefined();
  });

  it("값이 있으면 그대로 준다", () => {
    process.env[KEY] = "http://1.2.3.4:3128";
    expect(boardProxyUrl()).toBe("http://1.2.3.4:3128");
  });
});

describe("자격증명 가리기", () => {
  it("★비밀번호를 로그에 흘리지 않는다", () => {
    const masked = maskProxyUrl("http://wedly:s3cr3t@1.2.3.4:3128");
    expect(masked).not.toContain("s3cr3t");
    expect(masked).not.toContain("wedly");
    expect(masked).toBe("http://***@1.2.3.4:3128");
  });

  it("자격증명이 없으면 주소만", () => {
    expect(maskProxyUrl("http://1.2.3.4:3128")).toBe("http://1.2.3.4:3128");
  });

  it("형식이 깨져도 던지지 않고 원문도 안 흘린다", () => {
    const masked = maskProxyUrl("나는 주소가 아니다 secret");
    expect(masked).not.toContain("secret");
    expect(masked).toContain("형식이 잘못된");
  });
});

describe("★형식이 깨진 설정값 — 비밀번호가 새는 자리를 원천 차단한다", () => {
  // 근거(2026-08-28 실측): `new ProxyAgent("http://user:pw@[bad")` 가 던지는 오류의
  // `input` 속성에 원문이 통째로 들어 있고, console 이 객체를 펼쳐 찍으면 비밀번호가 로그에 남는다.
  // 그래서 애초에 만들지 않는다.
  it("주소 형식이 깨졌으면 「없음」으로 본다 — 경유도 안 하고 dispatcher 도 안 만든다", () => {
    process.env[KEY] = "http://user:secretPW@[bad";
    resetProxyWarnForTest();
    expect(boardProxyUrl()).toBeNull();
    expect(proxyDispatcher()).toBeUndefined();
  });

  it("http/https 가 아니면 「없음」으로 본다", () => {
    for (const bad of ["ftp://1.2.3.4:21", "socks5://1.2.3.4:1080", "file:///etc/passwd"]) {
      process.env[KEY] = bad;
      resetProxyWarnForTest();
      expect(boardProxyUrl(), bad).toBeNull();
    }
  });

  it("★깨진 값을 경고할 때도 비밀번호를 안 찍는다", () => {
    const seen: string[] = [];
    const orig = console.error;
    console.error = (...a: unknown[]) => { seen.push(a.map(String).join(" ")); };
    try {
      process.env[KEY] = "http://user:secretPW@[bad";
      resetProxyWarnForTest();
      boardProxyUrl();
    } finally {
      console.error = orig;
    }
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.join("\n")).not.toContain("secretPW");
  });
});

describe("경유 dispatcher", () => {
  it("설정값이 없으면 만들지 않는다", () => {
    delete process.env[KEY];
    expect(proxyDispatcher()).toBeUndefined();
  });

  it("같은 주소면 재사용한다 — 요청마다 새로 만들면 연결이 쌓인다", () => {
    process.env[KEY] = "http://1.2.3.4:3128";
    const a = proxyDispatcher();
    const b = proxyDispatcher();
    expect(a).toBeDefined();
    expect(a).toBe(b);
  });

  it("주소가 바뀌면 새로 만든다", () => {
    process.env[KEY] = "http://1.2.3.4:3128";
    const a = proxyDispatcher();
    process.env[KEY] = "http://5.6.7.8:3128";
    const b = proxyDispatcher();
    expect(a).not.toBe(b);
  });
});

describe("proxiedAttachmentFetch — 통로 탓 실패에 표식을 붙인다", () => {
  const agent = () => {
    process.env.POLICY_BOARD_PROXY_URL = "http://1.2.3.4:3128";
    return proxyDispatcher()!;
  };
  const boardRes = (status: number, cancel?: () => Promise<unknown>, server?: string) =>
    ({
      status,
      ok: status < 400,
      headers: { get: (n: string) => (n.toLowerCase() === "server" ? (server ?? null) : null) },
      body: cancel ? { getReader: () => { throw new Error("no"); }, cancel } : null,
    }) as never;

  it("★통로가 연결을 거부하면 「통로 탓」 표식이 붙은 오류를 던진다", async () => {
    const send = vi.fn(async () => { throw Object.assign(new Error("connect ECONNREFUSED 1.2.3.4:3128"), { code: "ECONNREFUSED" }); });
    const f = proxiedAttachmentFetch(agent(), send as never);
    const err = await f("https://www.jbtp.or.kr/a.pdf").catch((e) => e);
    expect(isProxyTransportError(err)).toBe(true);
    expect((err as Error).message).toContain("ECONNREFUSED");
    // 경유 주소·자격증명이 오류 문구로 새면 안 된다.
    expect((err as Error).message).not.toContain("1.2.3.4");
  });

  /**
   * ★2026-09-06 curl 실측(tinyproxy 1.11.1): 프록시가 **자기가 만든 응답에는 전부**
   * `Server: tinyproxy/1.11.1` 을 붙인다. 허용 밖 호스트 403 Filtered · 허용 밖 포트
   * 403 Access violation · 상대가 안 열리면 500 Unable to connect · **인증 실패는 401**(407 아니다).
   * 그래서 407 만 특별 취급하던 옛 규칙을 지우고 **머리글**로 가른다.
   */
  for (const status of [401, 403, 500, 404]) {
    it(`★Server: tinyproxy 인 ${status} 은 통로 탓이다 — 본문은 닫고 던진다`, async () => {
      const cancel = vi.fn(async () => undefined);
      const send = vi.fn(async () => boardRes(status, cancel, "tinyproxy/1.11.1"));
      const f = proxiedAttachmentFetch(agent(), send as never);
      const err = await f("https://www.jbtp.or.kr/a.pdf").catch((e) => e);
      expect(isProxyTransportError(err)).toBe(true);
      expect((err as Error).message).toContain(`HTTP ${status}`);
      expect(cancel).toHaveBeenCalledTimes(1);
    });
  }

  it("★머리글이 없는 407 은 사이트가 준 값이다 — 통로 탓이 아니다(옛 규칙이 뭉갰다)", async () => {
    const send = vi.fn(async () => boardRes(407));
    const f = proxiedAttachmentFetch(agent(), send as never);
    const res = await f("https://www.jbtp.or.kr/a.pdf");
    expect(res.status).toBe(407);
  });

  /**
   * ★`downloadBytes` 의 30초 상한이 프록시 자체 120초보다 **먼저** 터진다.
   * 그건 상대가 느리거나 막은 것이라 **사이트 탓**이다 — 통로 탓으로 읽으면
   * 느린 사이트 하나가 그 출처 전체를 1시간마다 다시 긁게 만든다.
   */
  it("★시간초과(TimeoutError)는 통로 탓이 아니다 — 코드보다 name 을 먼저 본다", async () => {
    const send = vi.fn(async () => { throw new DOMException("The operation was aborted due to timeout", "TimeoutError"); });
    const f = proxiedAttachmentFetch(agent(), send as never);
    const err = await f("https://www.jbtp.or.kr/a.pdf").catch((e) => e);
    expect(isProxyTransportError(err)).toBe(false);
    // DOMException 은 code 가 **숫자**(23)라 name 으로 원인을 남긴다 — 「요청 실패」로 뭉개면 안 된다.
    expect((err as Error).message).toContain("TimeoutError");
  });

  it("부르는 쪽 abort(AbortError)도 통로 탓이 아니다", async () => {
    const send = vi.fn(async () => { throw new DOMException("aborted", "AbortError"); });
    const f = proxiedAttachmentFetch(agent(), send as never);
    const err = await f("https://www.jbtp.or.kr/a.pdf").catch((e) => e);
    expect(isProxyTransportError(err)).toBe(false);
  });

  /**
   * https 는 CONNECT 터널이라 프록시가 거부하면 undici 는 응답을 안 주고 **던진다**.
   * 그 오류의 code 는 `UND_ERR_ABORTED` 로 우리 abort 와 **같아서** 문구로만 갈린다
   * (node_modules/undici/lib/dispatcher/proxy-agent.js:230).
   */
  it("★undici 의 CONNECT 거부(Proxy response (403) !== 200)는 통로 탓이다", async () => {
    const send = vi.fn(async () => {
      throw Object.assign(new Error("Proxy response (403) !== 200 when HTTP Tunneling"), { code: "UND_ERR_ABORTED" });
    });
    const f = proxiedAttachmentFetch(agent(), send as never);
    const err = await f("https://www.jbtp.or.kr/a.pdf").catch((e) => e);
    expect(isProxyTransportError(err)).toBe(true);
  });

  it("★상한을 안 걸어 오면 예비 상한(30초)을 우리가 붙인다 — 상한 없는 요청은 없다", async () => {
    const send = vi.fn(async (_u: string, _init: { signal: AbortSignal; headers: Record<string, string> }) => boardRes(200));
    const f = proxiedAttachmentFetch(agent(), send as never);
    await f("https://www.jbtp.or.kr/a.pdf"); // init 없음 = signal 없음
    const init = send.mock.calls[0][1];
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.signal.aborted).toBe(false);
  });

  it("부르는 쪽 머리글은 그대로 넘긴다 — 빈 객체로 덮어 조용히 버리지 않는다", async () => {
    const send = vi.fn(async (_u: string, _init: { signal: AbortSignal; headers: Record<string, string> }) => boardRes(200));
    const f = proxiedAttachmentFetch(agent(), send as never);
    await f("https://www.jbtp.or.kr/a.pdf", { headers: { Referer: "https://www.jbtp.or.kr/list" } });
    const init = send.mock.calls[0][1];
    expect(init.headers).toEqual({ Referer: "https://www.jbtp.or.kr/list" });
  });

  /**
   * ★본문을 안 넘기면 경유가 필요한 게시판에서 **열쇠 발급 POST 가 빈 몸으로** 나가
   * 열쇠를 못 받는다(2026-09-06 독립 리뷰 3번). 첨부 GET 은 본문이 없어 예전과 같다.
   */
  it("★부르는 쪽 본문(POST body)도 그대로 넘긴다 — 빈 POST 로 나가면 열쇠를 못 받는다", async () => {
    const send = vi.fn(async (_u: string, _init: { method: string; body?: string }) => boardRes(200));
    const f = proxiedAttachmentFetch(agent(), send as never);
    await f("https://www.jbtp.or.kr/ar_code.php", { method: "POST", body: "ar_create=Y" });
    expect(send.mock.calls[0][1]).toMatchObject({ method: "POST", body: "ar_create=Y" });
    // 본문이 없는 첨부 GET 은 body 키를 아예 안 만든다.
    await f("https://www.jbtp.or.kr/a.pdf");
    expect(send.mock.calls[1][1]).not.toHaveProperty("body");
  });

  it("사이트가 준 404 는 통로 탓이 아니다 — 그대로 돌려준다", async () => {
    const send = vi.fn(async () => boardRes(404));
    const f = proxiedAttachmentFetch(agent(), send as never);
    const res = await f("https://www.jbtp.or.kr/a.pdf");
    expect(res.status).toBe(404);
  });

  it("보통 오류는 통로 탓 표식이 없다", () => {
    expect(isProxyTransportError(new Error("just an error"))).toBe(false);
    expect(isProxyTransportError(null)).toBe(false);
  });
});

/**
 * ★통로를 **만들 수 있나**를 따로 묻는 이유(2026-09-06 적대 리뷰):
 * 형식이 깨진 설정값이면 `proxyDispatcher()` 가 던진다. 그 호출이 try 밖에 있으면
 * 수집 틱 한 회차가 통째로 죽고, 줄서기(remaining)와 처리 대상이 갈려 일괄 실행이 안 끝난다.
 */
describe("attachmentProxyAvailable — 던지지 않는다", () => {
  it("설정이 없으면 거짓", () => {
    delete process.env[KEY];
    expect(attachmentProxyAvailable()).toBe(false);
  });

  it("쓸 수 있는 주소면 참", () => {
    process.env[KEY] = "http://1.2.3.4:3128";
    expect(attachmentProxyAvailable()).toBe(true);
  });

  it("★형식이 깨진 값이면 던지지 않고 거짓 — 틱이 죽지 않는다", () => {
    process.env[KEY] = "not-a-url";
    expect(() => attachmentProxyAvailable()).not.toThrow();
    expect(attachmentProxyAvailable()).toBe(false);
  });
});
