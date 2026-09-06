import { describe, expect, it, vi } from "vitest";
import { tokenAttachmentFetch } from "./attachment-token";
import { wrapAttachmentFetch } from "./attachment-fetch";
import { isProxyTransportError } from "./proxy";
import { sidaConfig } from "./sources/sida";
import type { BoardConfig } from "./types";

/** 실측 응답 모양(2026-09-06 POST /program_process/ar_code.php · `ar_create=Y`). */
const TOKEN_JSON = '{"0":{"id_status":"Y","ar_chk":"6a9c40d550be1JAc"}}';
const DL = "https://www.sida.kr/config/download_home.php?filename=GoV20260901143459.hwp&a=y";

type Call = { url: string; init?: RequestInit };

/** 발급처엔 열쇠 JSON 을, 그 밖엔 빈 200 을 준다. 부른 순서를 그대로 담는다. */
function stubFetch(tokenBody = TOKEN_JSON, tokenStatus = 200) {
  const calls: Call[] = [];
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (url.includes("ar_code.php")) {
      return new Response(tokenBody, { status: tokenStatus });
    }
    return new Response("bytes", { status: 200 });
  });
  return { calls, fn };
}

describe("1회용 열쇠 감싸개 — 시흥산업진흥원", () => {
  it("첨부를 부르기 전에 POST 로 열쇠를 받고 주소에 &ar_chk= 를 붙인다", async () => {
    const { calls, fn } = stubFetch();
    const wrapped = tokenAttachmentFetch(sidaConfig, fn)!;
    expect(wrapped).toBeTypeOf("function");
    await wrapped(DL);
    expect(calls).toHaveLength(2);
    // ① 열쇠 발급 — POST + 실측 본문
    expect(calls[0].url).toBe("https://www.sida.kr/program_process/ar_code.php");
    expect(calls[0].init?.method).toBe("POST");
    expect(calls[0].init?.body).toBe("ar_create=Y");
    // ② 첨부 — 받은 열쇠가 붙는다
    expect(calls[1].url).toBe(`${DL}&ar_chk=6a9c40d550be1JAc`);
  });

  it("★첨부 2건이면 열쇠도 2번 받는다 — 한 번 쓰면 끝나는 값이다", async () => {
    const { calls, fn } = stubFetch();
    const wrapped = tokenAttachmentFetch(sidaConfig, fn)!;
    await wrapped(DL);
    await wrapped("https://www.sida.kr/config/download_home.php?filename=O3o.jpg");
    expect(calls.filter((c) => c.url.includes("ar_code.php"))).toHaveLength(2);
  });

  it("리다이렉트 홉처럼 이미 열쇠가 붙은 주소는 다시 발급받지 않는다", async () => {
    const { calls, fn } = stubFetch();
    const wrapped = tokenAttachmentFetch(sidaConfig, fn)!;
    await wrapped(`${DL}&ar_chk=already`);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${DL}&ar_chk=already`);
  });

  /**
   * ★열쇠를 못 받으면 **통로 탓 표식을 단 오류로 던진다**(2026-09-06 독립 리뷰 1번).
   * 예전엔 열쇠 없는 GET 으로 떨어졌는데, 시흥 서버는 그 GET 에 **200 + 안내 HTML** 을 준다 —
   * 수집 틱은 7일 도장, 구조화는 첨부 없는 판정을 굳혀 발급처가 살아나도 다시 안 읽는다.
   */
  it("★발급이 실패하면(500·깨진 JSON·이상한 값) 통로 탓 오류로 던진다 — 열쇠 없는 GET 금지", async () => {
    for (const [body, status] of [["", 500], ["not json", 200], ['{"0":{"ar_chk":"a b&c"}}', 200]] as const) {
      const { calls, fn } = stubFetch(body, status);
      const wrapped = tokenAttachmentFetch(sidaConfig, fn)!;
      await expect(wrapped(DL)).rejects.toSatisfy(isProxyTransportError);
      // 첨부 GET 은 아예 안 나갔다 — 발급 요청 한 번뿐.
      expect(calls).toHaveLength(1);
      expect(calls[0].url).toContain("ar_code.php");
    }
  });

  it("발급처에 못 닿아도(던짐) 통로 탓 오류다 — 사이트가 「파일 없다」고 답한 것이 아니다", async () => {
    const fn = vi.fn(async (url: string) => {
      if (url.includes("ar_code.php")) throw new Error("ECONNREFUSED");
      return new Response("bytes", { status: 200 });
    });
    const wrapped = tokenAttachmentFetch(sidaConfig, fn)!;
    await expect(wrapped(DL)).rejects.toSatisfy(isProxyTransportError);
  });

  it("★열쇠 응답은 64KB 까지만 읽는다 — 장애 화면을 통째로 메모리에 올리지 않는다", async () => {
    const chunk = new Uint8Array(16 * 1024);
    const fn = vi.fn(async (url: string) => {
      if (!url.includes("ar_code.php")) return new Response("bytes", { status: 200 });
      let sent = 0;
      return new Response(
        new ReadableStream<Uint8Array>({
          pull(c) {
            sent += 1;
            if (sent > 100) return c.close();
            c.enqueue(chunk);
          },
        }),
        { status: 200 },
      );
    });
    const wrapped = tokenAttachmentFetch(sidaConfig, fn)!;
    await expect(wrapped(DL)).rejects.toSatisfy(isProxyTransportError);
  });

  it("★부르는 쪽 신호를 열쇠 발급에도 그대로 넘긴다 — 없을 때만 자체 상한", async () => {
    const { calls, fn } = stubFetch();
    const wrapped = tokenAttachmentFetch(sidaConfig, fn)!;
    const signal = AbortSignal.timeout(30_000);
    await wrapped(DL, { signal });
    expect(calls[0].init?.signal).toBe(signal);
    const bare = stubFetch();
    await tokenAttachmentFetch(sidaConfig, bare.fn)!(DL);
    expect(bare.calls[0].init?.signal).toBeInstanceOf(AbortSignal);
    expect(bare.calls[0].init?.signal).not.toBe(signal);
  });

  it("명부 밖 호스트의 주소엔 열쇠를 붙이지 않는다 — 남의 서버로 새는 길을 막는다", async () => {
    const { calls, fn } = stubFetch();
    const wrapped = tokenAttachmentFetch(sidaConfig, fn)!;
    await wrapped("https://evil.example/config/download_home.php?filename=x");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://evil.example/config/download_home.php?filename=x");
  });

  it("발급처가 명부 밖이면 감싸지 않는다(undefined)", () => {
    const bad: BoardConfig = {
      ...sidaConfig,
      attachmentToken: { ...sidaConfig.attachmentToken!, endpoint: "https://evil.example/ar.php" },
    };
    expect(tokenAttachmentFetch(bad, vi.fn())).toBeUndefined();
  });

  it("설정이 없는 게시판은 감싸지 않는다 — 예전 통로 그대로", () => {
    const plain: BoardConfig = { ...sidaConfig, attachmentToken: undefined };
    expect(tokenAttachmentFetch(plain, vi.fn())).toBeUndefined();
    expect(tokenAttachmentFetch(undefined, vi.fn())).toBeUndefined();
  });

  it("한 줄 훅(wrapAttachmentFetch)이 같은 감싸개를 내준다 — 두 호출부가 이 한 줄만 부른다", async () => {
    const { calls, fn } = stubFetch();
    const wrapped = wrapAttachmentFetch(sidaConfig, "https://www.sida.kr/notification/noticeView.html?uid=1144", fn)!;
    await wrapped(DL);
    expect(calls[1].url).toBe(`${DL}&ar_chk=6a9c40d550be1JAc`);
  });

  it("붙일 것이 없으면 훅은 받은 통로를 그대로 돌려준다 — 아무것도 없으면 undefined", () => {
    const fn = vi.fn();
    const plain: BoardConfig = { ...sidaConfig, attachmentToken: undefined, attachmentSession: undefined };
    expect(wrapAttachmentFetch(plain, "", fn)).toBe(fn);
    expect(wrapAttachmentFetch(plain, "")).toBeUndefined();
    expect(wrapAttachmentFetch(undefined, "", fn)).toBe(fn);
  });

  /**
   * ★간격 감싸개는 **가장 안쪽**이어야 한다 — 그래야 열쇠 발급·세션 데우기 같은 **앞선 요청**까지
   * 간격을 탄다(독립 리뷰 4번). 바깥에 두면 한 첨부를 받는 동안 나가는 두 요청이 붙어 나간다.
   */
  it("★간격 감싸개가 열쇠 발급 요청까지 덮는다 — 훅이 가장 안쪽에 깐다", async () => {
    const { calls, fn } = stubFetch();
    const t0 = Date.now();
    const wrapped = wrapAttachmentFetch(sidaConfig, "", fn, { gapMs: 40 })!;
    await wrapped(DL);
    // 발급 POST + 첨부 GET = 두 요청. 두 번째 요청 앞에 간격이 한 번 들어간다.
    expect(calls).toHaveLength(2);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(35);
  });

  it("설정이 실측과 같다 — 발급처·본문·변수 이름", () => {
    expect(sidaConfig.attachmentToken).toMatchObject({
      endpoint: "/program_process/ar_code.php",
      method: "POST",
      body: "ar_create=Y",
      param: "ar_chk",
    });
    expect(sidaConfig.attachmentToken!.extract(TOKEN_JSON)).toBe("6a9c40d550be1JAc");
    expect(sidaConfig.attachmentToken!.extract("<html>오류</html>")).toBeNull();
  });
});
