import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BROWSER_ACCEPT_LANGUAGE, BROWSER_UA, withBrowserIdentity } from "./fetch-identity";

/**
 * 근거(2026-10-01 한국 IP 실측): 행정안전부·화성산업진흥원 첨부 서버는 **비브라우저 접속을 끊는다** —
 * 노드 기본 UA 로 부르면 연결이 닫히거나 거부 문구가 오고, 목록 수집이 써 온 브라우저 UA 와
 * `Accept-Language: ko` 를 실으면 파일이 온다. 지금 잘 받아지는 주요 16곳(기업마당·과기정통부·중기부 …)은
 * 두 방식 결과가 같았다(`notion-d6b0973897d5-notes/data/probe-ua.out`).
 */
describe("브라우저 신원 — 목록·상세·첨부가 같은 UA·언어를 쓴다", () => {
  it("UA 는 목록 수집(registry)이 써 온 글자 그대로다", () => {
    expect(BROWSER_UA).toBe(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    );
    expect(BROWSER_ACCEPT_LANGUAGE).toBe("ko");
  });

  it("없으면 둘 다 붙인다", () => {
    expect(withBrowserIdentity({})).toEqual({ "User-Agent": BROWSER_UA, "Accept-Language": "ko" });
    expect(withBrowserIdentity(undefined)).toEqual({ "User-Agent": BROWSER_UA, "Accept-Language": "ko" });
  });

  it("부르는 쪽이 넣은 값은 이름의 대소문자와 상관없이 그대로 두고, 같은 이름을 또 넣지 않는다", () => {
    expect(withBrowserIdentity({ "user-agent": "X/1", "accept-language": "en" })).toEqual({
      "user-agent": "X/1",
      "accept-language": "en",
    });
    expect(withBrowserIdentity({ "USER-AGENT": "X/1" })).toEqual({ "USER-AGENT": "X/1", "Accept-Language": "ko" });
  });

  it("다른 머리글은 그대로 두고, 넘겨받은 객체는 바꾸지 않는다", () => {
    const input = { Referer: "https://a.example/", Cookie: "a=1" };
    const out = withBrowserIdentity(input);
    expect(out).toEqual({ Referer: "https://a.example/", Cookie: "a=1", "User-Agent": BROWSER_UA, "Accept-Language": "ko" });
    expect(input).toEqual({ Referer: "https://a.example/", Cookie: "a=1" });
    expect(out).not.toBe(input);
  });

  it("registry 는 UA 글자를 따로 두지 않고 이 값을 가져다 쓴다 — 두 곳이 갈라지지 않게", () => {
    const src = readFileSync(join(__dirname, "registry.ts"), "utf8");
    expect(src).toMatch(/from "\.\/fetch-identity"/);
    expect(src).not.toContain("Chrome/126.0.0.0");
  });
});
