import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { BoardFetchInit } from "../types";
import { createSbaPageSession, SbaPageEndError } from "./sba-page-session";

/**
 * 고정본: 2026-09-13 실측 `Posting.aspx` 1쪽(GET) · 다음 단추로 11쪽 · 다시 다음으로 21쪽.
 * 다음 창은 `$PageNum` 을 함께 POST 해야 실제로 넘어갔다.
 */
const FIX = join(__dirname, "../__fixtures__");
const group1 = readFileSync(join(FIX, "sba-group1.html"), "utf-8");
const group11 = readFileSync(join(FIX, "sba-group11.html"), "utf-8");
const group21 = readFileSync(join(FIX, "sba-group21.html"), "utf-8");

const LIST = "https://www.sba.seoul.kr/Pages/BusinessApply/Posting.aspx";
const PAGE_NUM = "ctl00$ctl00$ContentPlaceHolder1$MainContents$PageNum";
const NEXT = "ctl00$ctl00$ContentPlaceHolder1$MainContents$GridView1$ctl13$ctl02";
const PAGE12_TARGET =
  "ctl00$ctl00$ContentPlaceHolder1$MainContents$GridView1$ctl13$PagingRepeater$ctl01$PageNum";

type Call = { url: string; init?: BoardFetchInit };

function bodyOf(init?: BoardFetchInit): URLSearchParams {
  return new URLSearchParams(init?.body ?? "");
}

function isGet(init?: BoardFetchInit): boolean {
  return !init || init.method === "GET";
}

function isNext(init?: BoardFetchInit): boolean {
  return init?.method === "POST" && bodyOf(init).get(`${NEXT}.x`) === "1";
}

function withActivePage(html: string, page: number): string {
  return html
    .replace(/ class="on"/g, "")
    .replace(
      new RegExp(`(<a id="[^"]*PagingRepeater_PageNum_\\d+")( href="[^"]+">${page}</a>)`),
      `$1 class="on"$2`,
    );
}

function miniGroup(start: number): string {
  const pages = Array.from({ length: 10 }, (_, i) => {
    const n = start + i;
    const on = i === 0 ? ` class="on"` : "";
    const ctl = String(i).padStart(2, "0");
    return `<a id="ContentPlaceHolder1_MainContents_GridView1_PagingRepeater_PageNum_${i}"${on} href="javascript:__doPostBack(&#39;ctl00$ctl00$ContentPlaceHolder1$MainContents$GridView1$ctl13$PagingRepeater$ctl${ctl}$PageNum&#39;,&#39;&#39;)">${n}</a>`;
  }).join("");
  const pageNumVal = String(Math.floor((start - 1) / 10) + 1);
  return `<input type="hidden" name="__VIEWSTATE" id="__VIEWSTATE" value="vs-${start}" />
<input type="hidden" name="__VIEWSTATEGENERATOR" id="__VIEWSTATEGENERATOR" value="88AF516D" />
<input type="hidden" name="${PAGE_NUM}" value="${pageNumVal}" />
<table><tr class="grid_list tbody"><td>row</td></tr>
${pages}
<input type="image" name="${NEXT}" class="next" />
</table>`;
}

function liveNextSession(calls: Call[]) {
  return createSbaPageSession(async (url, init) => {
    calls.push({ url, init });
    if (isGet(init)) return group1;
    const body = bodyOf(init);
    if (isNext(init)) {
      if (!body.get(PAGE_NUM)) return group1;
      if (body.get(PAGE_NUM) === "1") return group11;
      if (body.get(PAGE_NUM) === "2") return group21;
      return group1;
    }
    const target = body.get("__EVENTTARGET") ?? "";
    if (target === PAGE12_TARGET) return withActivePage(group11, 12);
    const m = target.match(/PagingRepeater\$ctl(\d+)\$PageNum$/);
    if (m) {
      const idx = Number(m[1]);
      return withActivePage(group1, idx + 1);
    }
    return group1;
  });
}

describe("SBA 쪽 세션 — 실측 고정본 1→11→21", () => {
  it("다음 단추 POST 에 PageNum 이 있어야 1쪽 다음이 11쪽, 그 다음이 21쪽이다", async () => {
    const calls: Call[] = [];
    const session = liveNextSession(calls);
    const html1 = await session(1);
    const html11 = await session(11);
    const html21 = await session(21);
    expect(html1).toBe(group1);
    expect(html11).toBe(group11);
    expect(html21).toBe(group21);
    expect(html1).not.toBe(html11);
    expect(html11).not.toBe(html21);
    expect(calls.every((c) => c.url === LIST)).toBe(true);
    expect(calls.map((c) => c.init?.method ?? "GET")).toEqual(["GET", "POST", "POST"]);
    expect(isNext(calls[1].init)).toBe(true);
    expect(bodyOf(calls[1].init).get(PAGE_NUM)).toBe("1");
    expect(bodyOf(calls[1].init).get("__EVENTTARGET")).toBe("");
    expect(bodyOf(calls[1].init).get(`${NEXT}.x`)).toBe("1");
    expect(bodyOf(calls[1].init).get(`${NEXT}.y`)).toBe("1");
    expect((bodyOf(calls[1].init).get("__VIEWSTATE") ?? "").length).toBeGreaterThan(100);
    expect(bodyOf(calls[1].init).get("__VIEWSTATEGENERATOR")).toBe("88AF516D");
    expect(isNext(calls[2].init)).toBe(true);
    expect(bodyOf(calls[2].init).get(PAGE_NUM)).toBe("2");
    expect((bodyOf(calls[2].init).get("__VIEWSTATE") ?? "").length).toBeGreaterThan(100);
    expect(bodyOf(calls[2].init).get("__VIEWSTATE")).not.toBe(bodyOf(calls[1].init).get("__VIEWSTATE"));
  });

  it("같은 쪽을 다시 요청하면 캐시된 HTML 을 쓰고 요청을 보내지 않는다", async () => {
    const calls: Call[] = [];
    const session = liveNextSession(calls);
    await session(11);
    const n = calls.length;
    const again = await session(11);
    expect(again).toBe(group11);
    expect(calls).toHaveLength(n);
  });

  it("12쪽은 11~20 창의 쪽 번호 앵커를 포스트백한다", async () => {
    const calls: Call[] = [];
    const session = liveNextSession(calls);
    const html = await session(12);
    expect(html).toBe(withActivePage(group11, 12));
    expect(calls).toHaveLength(3);
    expect(isNext(calls[1].init)).toBe(true);
    expect(isNext(calls[2].init)).toBe(false);
    expect(bodyOf(calls[2].init).get("__EVENTTARGET")).toBe(PAGE12_TARGET);
    expect(bodyOf(calls[2].init).get(PAGE_NUM)).toBe("2");
    expect(bodyOf(calls[2].init).get(`${NEXT}.x`)).toBeNull();
  });
});

describe("SBA 쪽 세션 — 실패·끝", () => {
  it("숨은 PageNum 이 없으면 1쪽 GET 도 실패한다 — 1쪽으로 조용히 물러서지 않는다", async () => {
    const html = group1.replace(
      'name="ctl00$ctl00$ContentPlaceHolder1$MainContents$PageNum"',
      'name="ctl00$ctl00$ContentPlaceHolder1$MainContents$xPageNum"',
    );
    const session = createSbaPageSession(async () => html);
    await expect(session(1)).rejects.toThrow(/읽지 못했습니다/);
    await expect(session(2)).rejects.not.toBeInstanceOf(SbaPageEndError);
  });

  it("__VIEWSTATE 가 없어도 1쪽 GET 으로 물러서지 않는다", async () => {
    const html = group1
      .replace('name="__VIEWSTATE"', 'name="__VIEWSTATE_X"')
      .replace('id="__VIEWSTATE"', 'id="__VIEWSTATE_X"');
    const session = createSbaPageSession(async () => html);
    await expect(session(2)).rejects.toThrow(/읽지 못했습니다/);
  });

  it("깨진 HTML·오류 HTML 은 끝이 아니다", async () => {
    const blank = createSbaPageSession(async () => "");
    await expect(blank(1)).rejects.toThrow(/읽지 못했습니다/);
    await expect(blank(1)).rejects.not.toBeInstanceOf(SbaPageEndError);

    const err = createSbaPageSession(async () => "<html><body>오류</body></html>");
    await expect(err(1)).rejects.toThrow(/읽지 못했습니다/);
    await expect(err(1)).rejects.not.toBeInstanceOf(SbaPageEndError);
  });

  it("마지막 쪽이 아닌데 다음 창이 그대로면 끝이 아니라 미완료다", async () => {
    const session = createSbaPageSession(async () => group1);
    const err = await session(21).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(SbaPageEndError);
    expect(String(err)).toMatch(/읽지 못했습니다/);
  });

  it("다음 단추 응답이 오류 HTML 이면 마지막 쪽으로 치지 않는다", async () => {
    const last = withActivePage(group21, 30);
    const session = createSbaPageSession(async (_url, init) => {
      if (isGet(init)) return last;
      return "<html><body>오류</body></html>";
    });
    const err = await session(31).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(SbaPageEndError);
  });

  it("다음 단추가 같은 마지막 쪽을 돌려주면 SbaPageEndError 에 lastPage 를 담는다", async () => {
    const last = withActivePage(group21, 30);
    const session = createSbaPageSession(async () => last);
    const err = await session(31).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SbaPageEndError);
    expect((err as SbaPageEndError).lastPage).toBe(30);
  });

  it("응답의 현재 쪽이 요청한 쪽과 다르면 그 HTML 을 성공으로 쓰지 않는다", async () => {
    const session = createSbaPageSession(async (_url, init) => {
      if (isGet(init)) return group1;
      return group1;
    });
    const err = await session(2).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(SbaPageEndError);
  });
});

describe("SBA 쪽 세션 — 회차 분리·한도", () => {
  it("세션 두 개는 상태를 나누지 않는다", async () => {
    const callsA: Call[] = [];
    const sessionA = liveNextSession(callsA);
    let bCalls = 0;
    const sessionB = createSbaPageSession(async (_url, init) => {
      bCalls += 1;
      if (isGet(init)) return group1;
      return group11;
    });
    await sessionA(11);
    expect(callsA.length).toBeGreaterThan(0);
    const html = await sessionB(11);
    expect(html).toBe(group11);
    expect(bCalls).toBe(2);
  });

  it("더 앞쪽을 요청하면 새 GET 으로 다시 걸어 간다", async () => {
    const calls: Call[] = [];
    const session = liveNextSession(calls);
    await session(11);
    calls.length = 0;
    const html = await session(5);
    expect(html).toBe(withActivePage(group1, 5));
    expect(isGet(calls[0].init)).toBe(true);
    expect(calls.some((c) => !isGet(c.init) && !isNext(c.init))).toBe(true);
  });

  it("쪽넘김 100번을 넘기면 미완료이고, 100번 안이면 도달한다", async () => {
    let start = 1;
    let nexts = 0;
    const session = createSbaPageSession(async (_url, init) => {
      if (isGet(init)) {
        start = 1;
        return miniGroup(1);
      }
      if (isNext(init)) {
        nexts += 1;
        start += 10;
        return miniGroup(start);
      }
      return miniGroup(start);
    });
    const ok = createSbaPageSession(async (_url, init) => {
      if (isGet(init)) return miniGroup(1);
      if (isNext(init)) {
        const n = Number(bodyOf(init).get(PAGE_NUM) ?? "1");
        return miniGroup(n * 10 + 1);
      }
      return miniGroup(1);
    });
    expect(await ok(1001)).toBe(miniGroup(1001));
    const err = await session(1011).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(SbaPageEndError);
    expect(nexts).toBe(100);
  });

  it("HTML 에 다른 주소가 있어도 Posting.aspx 만 부른다", async () => {
    const poisoned = group1.replace(
      "<table",
      '<form action="https://evil.example/steal"><table',
    );
    const urls: string[] = [];
    const session = createSbaPageSession(async (url) => {
      urls.push(url);
      return poisoned;
    });
    await session(1);
    expect(urls).toEqual([LIST]);
  });

  it("있으면 __EVENTVALIDATION 도 다음 포스트백에 실어 보낸다", async () => {
    const html = group1.replace(
      'name="__VIEWSTATEGENERATOR"',
      'name="__EVENTVALIDATION" id="__EVENTVALIDATION" value="ev-token" /><input type="hidden" name="__VIEWSTATEGENERATOR"',
    );
    const calls: Call[] = [];
    const session = createSbaPageSession(async (url, init) => {
      calls.push({ url, init });
      if (isGet(init)) return html;
      if (isNext(init)) return group11;
      return withActivePage(html, 2);
    });
    await session(2);
    expect(bodyOf(calls[1].init).get("__EVENTVALIDATION")).toBe("ev-token");
  });
});

it("마지막 창의 첫 쪽에서 이어 받아도 마지막 쪽을 확인한 뒤 끝을 판단한다", async () => {
  const partial = miniGroup(231).replace(/<a[^>]*>23[4-9]<\/a>|<a[^>]*>240<\/a>/g, "");
  const last = withActivePage(partial, 233);
  let atLast = false;
  const session = createSbaPageSession(async (_url, init) => {
    if (isGet(init)) return partial;
    if (bodyOf(init).get("__EVENTTARGET")?.includes("$ctl02$PageNum")) { atLast = true; return last; }
    return atLast ? last : partial;
  });
  const error = await session(234).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(SbaPageEndError);
  expect((error as SbaPageEndError).lastPage).toBe(233);
});

it("첫 GET 이 다른 쪽이면 1쪽 응답으로 저장하지 않는다", async () => {
  const session = createSbaPageSession(async () => group11);
  await expect(session(1)).rejects.toThrow(/현재 쪽/);
});
