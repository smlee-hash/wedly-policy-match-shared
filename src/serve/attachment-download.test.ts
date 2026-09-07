import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** 감싸개는 실물을 쓰되 **불렸는지**를 잰다 — 여기서 흉내만 내면 세션·경유 배선이 빠져도 초록이 된다. */
vi.mock("../collect/board/attachment-fetch", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../collect/board/attachment-fetch")>();
  return { ...actual, wrapAttachmentFetch: vi.fn(actual.wrapAttachmentFetch) };
});

import { wrapAttachmentFetch } from "../collect/board/attachment-fetch";
import {
  ATTACHMENT_DOWNLOAD_MAX_BYTES,
  ATTACHMENT_GAP_MS,
  ATTACHMENT_RATE_PER_MIN,
  contentDispositionOf,
  downloadAttachment,
  resetAttachmentRateLimitForTest,
  type AttachmentDownloadResult,
} from "./attachment-download";

const wrapMock = wrapAttachmentFetch as unknown as ReturnType<typeof vi.fn>;

const HRDK_DOWN = "https://www.hrdkorea.or.kr/cms/download/downloadFile2.hrd";
const HRDK_DETAIL = "https://www.hrdkorea.or.kr/3/1/1?k=56065";
const BIZINFO = "https://www.bizinfo.go.kr/cmm/fms/fileDown.do?file=a.pdf";

const postAtt = {
  name: "공고문.hwp",
  url: HRDK_DOWN,
  kind: "hwp",
  method: "POST",
  body: "attachSeq2=MjA3MjIzOQ%3D%3D",
};
const getAtt = { name: "붙임.pdf", url: BIZINFO, kind: "pdf" };

const findUnique = vi.fn();
const q = { findAnnouncement: (...a: unknown[]) => findUnique(...a) } as never;

function row(attachments: unknown[], source = "hrdk", url = HRDK_DETAIL) {
  return { id: "a1", source, url, attachments };
}
const call = (id: string, idx: string, over: { userKey?: string } = {}) =>
  downloadAttachment(q, { id, idx, userKey: over.userKey ?? "u1", now: Date.now() });

/** 진짜 파일처럼 보이는 첫 바이트(OLE = hwp). 매직바이트 검사를 지나가려면 필요하다. */
const HWP_HEAD = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00, 0x01]);
const PDF_HEAD = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x36]);

/** 흘려보내는 몸통을 끝까지 읽어 잠금을 푼다(응답을 안 읽으면 「동시 1건」 잠금이 살아 있다). */
async function drain(res: AttachmentDownloadResult): Promise<Uint8Array> {
  if (res.kind !== "stream") throw new Error(`stream 이 아님: ${res.kind}`);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) { chunks.push(value); total += value.byteLength; }
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.byteLength; }
  return out;
}

beforeEach(async () => {
  findUnique.mockReset();
  // 감싸개 mock 은 시험마다 **실물 구현**으로 되돌린다 — 한 시험이 건 `mockReturnValue` 가 다음
  // 시험으로 새면 거기서 상류를 진짜로 두드릴 수 있다(mockClear 는 구현을 안 지운다).
  const actual = await vi.importActual<typeof import("../collect/board/attachment-fetch")>(
    "../collect/board/attachment-fetch",
  );
  wrapMock.mockReset();
  wrapMock.mockImplementation(actual.wrapAttachmentFetch);
  resetAttachmentRateLimitForTest();
  vi.unstubAllGlobals();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  resetAttachmentRateLimitForTest();
});

describe("상수 — ERP 원문과 같은 값", () => {
  it("★첨부 간격은 수집 회차(ERP sync.ts ATTACHMENT_GAP_MS)와 같은 250ms", () => {
    expect(ATTACHMENT_GAP_MS).toBe(250);
  });
  it("크기 30MB · 머리글 30초 · 본문 10분 · 분당 6회", async () => {
    const m = await import("./attachment-download");
    expect(m.ATTACHMENT_DOWNLOAD_MAX_BYTES).toBe(30 * 1024 * 1024);
    expect(m.ATTACHMENT_HEADERS_TIMEOUT_MS).toBe(30_000);
    expect(m.ATTACHMENT_BODY_TIMEOUT_MS).toBe(600_000);
    expect(m.ATTACHMENT_RATE_PER_MIN).toBe(6);
  });
});

describe("① 주소는 저장 배열에서만 — 입력 검증", () => {
  it("공고가 없으면 404", async () => {
    findUnique.mockResolvedValue(null);
    expect((await call("nope", "0")).status).toBe(404);
  });

  it("자리번호가 범위 밖이면 404 — 요청을 보내지 않는다", async () => {
    findUnique.mockResolvedValue(row([postAtt]));
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect((await call("a1", "3")).status).toBe(404);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("★자리번호 모양이 이상하면 DB 도 안 본다 — 음수·소수·지수 표기", async () => {
    for (const bad of ["-1", "1.5", "1e2", "01x", "", "abc"]) {
      findUnique.mockClear();
      expect((await call("a1", bad)).status).toBe(404);
      expect(findUnique).not.toHaveBeenCalled();
    }
  });

  it("★자리번호는 저장 배열의 자리 그대로다 — 깨진 항목이 있어도 안 밀린다", async () => {
    // 0번이 모양 깨진 항목, 1번이 진짜 POST 첨부. 화면이 준 번호(1)로 그 파일이 나와야 한다.
    findUnique.mockResolvedValue(row(["깨진 항목", postAtt]));
    const send = vi.fn(async (_u: string, _init?: RequestInit) => new Response(HWP_HEAD, { status: 200 }));
    wrapMock.mockReturnValueOnce(send);
    const res = await call("a1", "1");
    expect(res.status).toBe(200);
    expect(send.mock.calls[0][0]).toBe(HRDK_DOWN);
    await drain(res);
  });

  it("★허용 호스트가 아닌 주소는 부르지 않는다(SSRF) — 저장된 값도 다시 검문한다", async () => {
    findUnique.mockResolvedValue(row([{ ...postAtt, url: "http://169.254.169.254/latest/meta-data/" }]));
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const res = await call("a1", "0");
    expect(res.status).toBe(400);
    expect(res.kind === "error" && res.code).toBe("BAD_ATTACHMENT");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("읽는 칸은 네 개뿐이다 — 공고 원문·첨부 글자는 안 읽는다", async () => {
    findUnique.mockResolvedValue(row([getAtt], "bizinfo", "https://www.bizinfo.go.kr/x"));
    await call("a1", "0");
    expect(findUnique.mock.calls[0][0]).toBe("a1");
    expect(Object.keys(findUnique.mock.calls[0][1] as object).sort()).toEqual(["attachments", "id", "source", "url"]);
  });
});

describe("갈래 — GET 은 그대로, POST 만 대신 받는다", () => {
  it("GET 첨부는 원 주소로 302 — 서버가 대신 받지 않는다", async () => {
    findUnique.mockResolvedValue(row([getAtt], "bizinfo", "https://www.bizinfo.go.kr/x"));
    const res = await call("a1", "0");
    expect(res).toEqual({ kind: "redirect", status: 302, url: BIZINFO });
    expect(wrapMock).not.toHaveBeenCalled();
  });

  it("★POST 첨부는 감싸개(세션·경유 훅)를 거쳐 method·body 그대로 나간다", async () => {
    findUnique.mockResolvedValue(row([postAtt]));
    const send = vi.fn(async (_u: string, _init?: RequestInit) =>
      new Response(HWP_HEAD, { status: 200, headers: { "content-type": "application/octet-stream" } }),
    );
    wrapMock.mockReturnValueOnce(send);
    const res = await call("a1", "0");
    expect(res.status).toBe(200);
    if (res.kind !== "stream") throw new Error("stream 아님");
    // 감싸개는 **그 공고의 설정·상세 주소**로 만들어져야 세션 쿠키를 데울 수 있다.
    expect(wrapMock).toHaveBeenCalledTimes(1);
    expect((wrapMock.mock.calls[0][0] as { id?: string })?.id).toBe("hrdk");
    expect(wrapMock.mock.calls[0][1]).toBe(HRDK_DETAIL);
    const init = (send.mock.calls[0][1] ?? {}) as RequestInit;
    expect(init.method).toBe("POST");
    expect(init.body).toBe("attachSeq2=MjA3MjIzOQ%3D%3D");
    expect(init.redirect).toBe("manual");
    expect((init.headers as Record<string, string>)["Content-Type"]).toContain("x-www-form-urlencoded");
    expect(res.headers["Content-Disposition"]).toContain("filename*=UTF-8''");
    expect(res.headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(res.headers["Cache-Control"]).toBe("private, no-store");
    expect(await drain(res)).toEqual(HWP_HEAD);
    // 감싸개는 수집 쪽과 **같은 간격**을 물려받아야 한 사람의 연타가 상대 서버를 몰아치지 않는다.
    expect(wrapMock.mock.calls[0][3]).toEqual({ gapMs: ATTACHMENT_GAP_MS });
  });

  it("상류가 실패하면 502 — 실패 화면을 파일인 척 내려보내지 않는다", async () => {
    findUnique.mockResolvedValue(row([postAtt]));
    wrapMock.mockReturnValueOnce(vi.fn(async () => new Response("잘못된 접근입니다", { status: 404 })));
    const res = await call("a1", "0");
    expect(res.status).toBe(502);
    expect(res.kind === "error" && res.code).toBe("UPSTREAM_FAILED");
  });

  it("상류가 던져도 502 이고 잠금이 풀린다", async () => {
    findUnique.mockResolvedValue(row([postAtt]));
    wrapMock.mockReturnValueOnce(vi.fn(async () => { throw new Error("연결 끊김"); }));
    expect((await call("a1", "0")).status).toBe(502);
    // 잠금이 살아 있으면 다음 호출이 429 가 된다
    wrapMock.mockReturnValueOnce(vi.fn(async () => new Response(HWP_HEAD, { status: 200 })));
    expect((await call("a1", "0")).status).toBe(200);
  });
});

describe("④ 크기 상한", () => {
  it("★크기 상한을 넘으면 흘려보내던 것을 끊는다 — 통째로 메모리에 올리지 않는다", async () => {
    findUnique.mockResolvedValue(row([postAtt]));
    const chunk = new Uint8Array(1024 * 1024);
    chunk.set(PDF_HEAD, 0); // 첫 청크는 진짜 파일처럼 — 매직바이트 검사를 지나가야 크기 상한까지 간다
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        sent += 1;
        c.enqueue(chunk); // 끝나지 않는 본문
      },
    });
    wrapMock.mockReturnValueOnce(vi.fn(async () => new Response(body, { status: 200 })));
    const res = await call("a1", "0");
    expect(res.status).toBe(200);
    await expect(drain(res)).rejects.toThrow();
    expect(sent).toBeLessThanOrEqual(ATTACHMENT_DOWNLOAD_MAX_BYTES / chunk.byteLength + 2);
  });
});

describe("파일이름 머리글", () => {
  it("한글 이름은 filename* 로, ASCII 대체 이름도 함께 적는다", () => {
    const v = contentDispositionOf("공고문 (최종).hwp");
    expect(v).toContain("filename*=UTF-8''");
    expect(v).toContain("%EA%B3%B5%EA%B3%A0%EB%AC%B8"); // 「공고문」
    expect(v).toMatch(/^attachment; filename="[\x20-\x7E]*"/);
  });

  it("★`'()*!` 도 퍼센트로 적는다 — attr-char 가 아니라 브라우저가 머리글을 다르게 읽는다", () => {
    const v = contentDispositionOf("O'Brien (v1)*!.pdf");
    const star = v.split("filename*=UTF-8''")[1];
    expect(star).not.toMatch(/['()*!]/);
    expect(star).toContain("%27"); // '
    expect(star).toContain("%28"); // (
    expect(star).toContain("%29"); // )
    expect(star).toContain("%2A"); // *
    expect(star).toContain("%21"); // !
  });

  it("★줄바꿈·따옴표는 지운다 — 머리글을 쪼개는 길을 막는다", () => {
    const v = contentDispositionOf('a"\r\nSet-Cookie: x=1.pdf');
    expect(v).not.toContain("\r");
    expect(v).not.toContain("\n");
    expect(v.split('filename="')[1].split('"')[0]).not.toContain('"');
  });

  it("이름이 비면 기본 이름을 쓴다", () => {
    expect(contentDispositionOf("")).toContain(encodeURIComponent("첨부파일"));
  });
});

/**
 * ★②③ 대리호출 통로는 **우리 이름으로 남의 서버를 두드린다** — 양·속도를 우리가 묶는다.
 * (2026-08-31 실측: 빠른 연속 217건 뒤 정상 파일이 거부 문구로 바뀌었다.)
 */
describe("②③ 속도 제한 · 동시 1건", () => {
  const okSend = () => vi.fn(async () => new Response(HWP_HEAD, { status: 200 }));

  it(`한 사람이 분당 ${ATTACHMENT_RATE_PER_MIN}회를 넘기면 429 + Retry-After`, async () => {
    findUnique.mockResolvedValue(row([postAtt]));
    for (let i = 0; i < ATTACHMENT_RATE_PER_MIN; i++) {
      wrapMock.mockReturnValueOnce(okSend());
      const ok = await call("a1", "0");
      expect(ok.status, `${i + 1}번째`).toBe(200);
      await drain(ok); // 공고 잠금을 풀어 준다(동시 1건 규칙)
    }
    const res = await call("a1", "0");
    expect(res.status).toBe(429);
    if (res.kind !== "error") throw new Error("error 아님");
    expect(Number(res.headers?.["Retry-After"])).toBeGreaterThan(0);
    expect(res.code).toBe("TOO_MANY_REQUESTS");
  });

  it("★속도 제한은 사람마다 따로 센다", async () => {
    findUnique.mockResolvedValue(row([postAtt]));
    for (let i = 0; i < ATTACHMENT_RATE_PER_MIN; i++) {
      wrapMock.mockReturnValueOnce(okSend());
      await drain(await call("a1", "0", { userKey: "u1" }));
    }
    expect((await call("a1", "0", { userKey: "u1" })).status).toBe(429);
    wrapMock.mockReturnValueOnce(okSend());
    const other = await call("a1", "0", { userKey: "u2" });
    expect(other.status).toBe(200);
    await drain(other);
  });

  it("★속도 제한은 DB 를 보기 전에 막는다 — 연타가 조회까지 못 끌고 간다", async () => {
    findUnique.mockResolvedValue(row([postAtt]));
    for (let i = 0; i < ATTACHMENT_RATE_PER_MIN; i++) {
      wrapMock.mockReturnValueOnce(okSend());
      await drain(await call("a1", "0"));
    }
    findUnique.mockClear();
    expect((await call("a1", "0")).status).toBe(429);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("★같은 공고를 동시에 두 번 받지 않는다 — 두 번째는 429", async () => {
    findUnique.mockResolvedValue(row([postAtt]));
    wrapMock.mockReturnValueOnce(okSend());
    const first = await call("a1", "0"); // 본문을 안 읽어 잠금이 살아 있다
    expect(first.status).toBe(200);
    const second = await call("a1", "0");
    expect(second.status).toBe(429);
    if (second.kind !== "error") throw new Error("error 아님");
    expect(second.headers?.["Retry-After"]).toBe("5");
    await drain(first);
  });
});

describe("⑤⑥⑦ 시간 상한·302 추적·매직바이트", () => {
  it("★머리글이 온 뒤의 느린 본문은 머리글 상한(30초)에 안 끊긴다", async () => {
    findUnique.mockResolvedValue(row([postAtt]));
    // 머리글은 곧바로, 본문은 두 조각을 사이를 두고 흘린다. 신호가 하나뿐이면 여기서 끊긴다.
    const body = new ReadableStream<Uint8Array>({
      async pull(c) {
        if ((c as unknown as { _n?: number })._n) {
          c.close();
          return;
        }
        (c as unknown as { _n?: number })._n = 1;
        await new Promise((r) => setTimeout(r, 30));
        c.enqueue(PDF_HEAD);
      },
    });
    let usedSignal: AbortSignal | undefined;
    wrapMock.mockReturnValueOnce(
      vi.fn(async (_u: string, init?: RequestInit) => {
        usedSignal = init?.signal as AbortSignal;
        return new Response(body, { status: 200 });
      }),
    );
    const res = await call("a1", "0");
    expect(res.status).toBe(200);
    // 머리글 시간 상한은 여기서 이미 풀렸다 — 신호가 살아 있어야 본문이 끝까지 흐른다.
    expect(usedSignal?.aborted).toBe(false);
    expect(await drain(res)).toEqual(PDF_HEAD);
  });

  it("★손님이 창을 닫으면 상류 연결도 끊는다", async () => {
    findUnique.mockResolvedValue(row([postAtt]));
    const ac = new AbortController();
    let usedSignal: AbortSignal | undefined;
    wrapMock.mockReturnValueOnce(
      vi.fn(async (_u: string, init?: RequestInit) => {
        usedSignal = init?.signal as AbortSignal;
        return new Response(HWP_HEAD, { status: 200 });
      }),
    );
    const res = await downloadAttachment(q, { id: "a1", idx: "0", userKey: "u1", now: Date.now(), signal: ac.signal });
    expect(res.status).toBe(200);
    expect(usedSignal?.aborted).toBe(false);
    ac.abort();
    expect(usedSignal?.aborted).toBe(true);
    await drain(res).catch(() => {});
  });

  it("★302 는 허용 호스트로만 따라간다 — 홉은 GET 이고 본문을 다시 안 보낸다", async () => {
    findUnique.mockResolvedValue(row([postAtt]));
    const seen: Array<{ url: string; init?: RequestInit }> = [];
    wrapMock.mockReturnValueOnce(
      vi.fn(async (u: string, init?: RequestInit) => {
        seen.push({ url: u, init });
        if (u === HRDK_DOWN) {
          return new Response(null, { status: 302, headers: { location: "https://www.hrdkorea.or.kr/real.hwp" } });
        }
        return new Response(HWP_HEAD, { status: 200 });
      }),
    );
    const res = await call("a1", "0");
    expect(res.status).toBe(200);
    expect(seen.map((s) => s.url)).toEqual([HRDK_DOWN, "https://www.hrdkorea.or.kr/real.hwp"]);
    expect(seen[0].init?.method).toBe("POST");
    expect(seen[1].init?.method).toBeUndefined();
    expect(seen[1].init?.body).toBeUndefined();
    await drain(res);
  });

  it("★302 가 내부망으로 가면 502 — 검문을 통과한 뒤의 우회를 막는다", async () => {
    findUnique.mockResolvedValue(row([postAtt]));
    const seen: string[] = [];
    wrapMock.mockReturnValueOnce(
      vi.fn(async (u: string) => {
        seen.push(u);
        return new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data/" } });
      }),
    );
    const res = await call("a1", "0");
    expect(res.status).toBe(502);
    expect(seen).toEqual([HRDK_DOWN]); // 내부망 주소는 부르지 않았다
  });

  it("★홉 상한(3)을 넘도록 계속 302 면 502 — 무한 추적을 막는다", async () => {
    findUnique.mockResolvedValue(row([postAtt]));
    let hops = 0;
    wrapMock.mockReturnValueOnce(
      vi.fn(async () => {
        hops += 1;
        return new Response(null, { status: 302, headers: { location: "https://www.hrdkorea.or.kr/again.hwp" } });
      }),
    );
    const res = await call("a1", "0");
    expect(res.status).toBe(502);
    expect(hops).toBeLessThanOrEqual(4); // hop 0..3 = 요청 네 번
  });

  it("★200 + HTML 안내 화면은 502 — 깨진 파일을 .hwp 이름으로 내려주지 않는다", async () => {
    findUnique.mockResolvedValue(row([postAtt]));
    wrapMock.mockReturnValueOnce(
      vi.fn(async () =>
        new Response("<html><script>alert('잘못된 접근입니다.');</script></html>", {
          status: 200,
          headers: { "content-type": "text/html;charset=utf-8" },
        }),
      ),
    );
    const res = await call("a1", "0");
    expect(res.status).toBe(502);
    expect(res.kind === "error" && res.code).toBe("NOT_A_FILE");
  });

  it("형식 머리글이 없어도 첫 바이트가 파일이 아니면 502", async () => {
    findUnique.mockResolvedValue(row([postAtt]));
    wrapMock.mockReturnValueOnce(
      vi.fn(async () => new Response(new TextEncoder().encode("not a file at all"), { status: 200 })),
    );
    expect((await call("a1", "0")).status).toBe(502);
  });
});


/**
 * ★독립 리뷰(2026-09-07) 지적 1·2·5 — 원문(ERP 라우트)에도 있던 결함 두 개와 시험 공백 하나.
 *
 * ① 잠금 고착: 본문을 흘리다 상류 연결이 끊기면 `reader.read()` 가 **거절**하는데, 그 길에는
 *    잠금 해제가 없었다 → 그 공고는 프로세스가 죽을 때까지 429.
 * ② 동시 1건 경쟁: 잠금 확인과 잠금 설정 사이에 DB 조회(`await`)가 있어 같은 공고 두 요청이
 *    **둘 다** 통과했다. 기존 시험은 첫 호출을 `await` 해서 이 틈을 못 잡는다.
 * ⑤ 30초 경계: 「본문이 머리글 상한에 안 끊긴다」 시험이 30ms 만 기다려, 본문 시계로 갈아 끼우는
 *    `clearTimeout(timer)` 를 지워도 초록이었다 — 가짜 시계로 30초·10분 두 경계를 직접 넘어 본다.
 */
describe("리뷰 반영 — 잠금 해제·동시 경쟁·시간 경계", () => {
  it("★본문 도중 연결이 끊겨도 잠금이 풀린다 — 같은 공고의 다음 요청이 429 가 아니다", async () => {
    findUnique.mockResolvedValue(row([postAtt]));
    let sentHead = false;
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        if (sentHead) {
          c.error(new Error("연결 끊김"));
          return;
        }
        sentHead = true;
        c.enqueue(PDF_HEAD); // 매직바이트 검사는 지나간다 — 끊기는 건 그 뒤 본문이다
      },
    });
    wrapMock.mockReturnValueOnce(vi.fn(async () => new Response(body, { status: 200 })));
    const first = await call("a1", "0");
    expect(first.status).toBe(200);
    await expect(drain(first)).rejects.toThrow();

    wrapMock.mockReturnValueOnce(vi.fn(async () => new Response(HWP_HEAD, { status: 200 })));
    const again = await call("a1", "0");
    expect(again.status, "끊긴 내려받기가 잠금을 물고 있으면 여기서 429 가 된다").toBe(200);
    await drain(again);
  });

  it("★같은 공고 두 요청이 **동시에** 와도 상류는 한 번만 두드린다 — 하나는 429", async () => {
    findUnique.mockResolvedValue(row([postAtt]));
    const send = vi.fn(async () => new Response(HWP_HEAD, { status: 200 }));
    wrapMock.mockReturnValue(send);
    const [a, b] = await Promise.all([call("a1", "0"), call("a1", "0")]);
    expect([a.status, b.status].sort()).toEqual([200, 429]);
    expect(send, "잠금을 DB 조회 뒤에 잡으면 둘 다 통과해 두 번 두드린다").toHaveBeenCalledTimes(1);
    const ok = a.status === 200 ? a : b;
    await drain(ok);
  });

  it("★본문은 머리글 상한(30초)을 넘겨도 계속 흐른다 — 가짜 시계로 45초를 보낸다", async () => {
    vi.useFakeTimers();
    findUnique.mockResolvedValue(row([postAtt]));
    const TAIL = new Uint8Array([0x0a, 0x0b, 0x0c, 0x0d]);
    let open: () => void = () => {};
    const gate = new Promise<void>((r) => {
      open = r;
    });
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>({
      async pull(c) {
        pulls += 1;
        if (pulls === 1) {
          c.enqueue(PDF_HEAD);
          return;
        }
        if (pulls === 2) {
          await gate; // 45초가 흐르는 동안 본문이 멈춰 있는 상황
          c.enqueue(TAIL);
          return;
        }
        c.close();
      },
    });
    let usedSignal: AbortSignal | undefined;
    wrapMock.mockReturnValueOnce(
      vi.fn(async (_u: string, init?: RequestInit) => {
        usedSignal = init?.signal as AbortSignal;
        return new Response(body, { status: 200 });
      }),
    );
    const res = await call("a1", "0");
    expect(res.status).toBe(200);
    const got = drain(res);
    await vi.advanceTimersByTimeAsync(45_000);
    expect(usedSignal?.aborted, "머리글 시계를 본문 시계로 안 갈아 끼우면 30초에 끊긴다").toBe(false);
    open();
    expect(await got).toEqual(new Uint8Array([...PDF_HEAD, ...TAIL]));
  });

  it("★본문이 10분을 넘기면 끊는다 — 신호를 끊고 잠금도 푼다", async () => {
    vi.useFakeTimers();
    findUnique.mockResolvedValue(row([postAtt]));
    let ctrl: ReadableStreamDefaultController<Uint8Array> | null = null;
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        ctrl = c;
        c.enqueue(PDF_HEAD);
      },
    });
    let usedSignal: AbortSignal | undefined;
    wrapMock.mockReturnValueOnce(
      vi.fn(async (_u: string, init?: RequestInit) => {
        usedSignal = init?.signal as AbortSignal;
        // 진짜 fetch 는 신호가 끊기면 본문 스트림도 오류로 끝낸다 — 그 모양을 흉내 낸다.
        usedSignal?.addEventListener("abort", () => ctrl?.error(new Error("시간 초과로 끊김")));
        return new Response(body, { status: 200 });
      }),
    );
    const res = await call("a1", "0");
    expect(res.status).toBe(200);
    await vi.advanceTimersByTimeAsync(9 * 60_000);
    expect(usedSignal?.aborted, "9분에는 아직 살아 있어야 한다").toBe(false);
    await vi.advanceTimersByTimeAsync(90_000);
    expect(usedSignal?.aborted, "본문 상한 10분을 넘기면 끊는다").toBe(true);
    await expect(drain(res)).rejects.toThrow();

    wrapMock.mockReturnValueOnce(vi.fn(async () => new Response(HWP_HEAD, { status: 200 })));
    const again = await call("a1", "0");
    expect(again.status, "시간 초과로 끊긴 뒤에도 잠금이 남으면 429 가 된다").toBe(200);
    await drain(again);
  });
});
