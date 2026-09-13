import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// 주입 스텁 — 게시판 등록부는 prisma·AI 를 CollectDeps 로 받는다(P3-B2). 원문
// `prisma.jsonCache.findUnique/upsert`·`policyAnnouncement.count` 을 이 세 스텁이 대신한다.
const jsonCacheGet = vi.fn((_key: string): Promise<unknown> => Promise.resolve(null));
const jsonCacheSet = vi.fn((_key: string, _value: unknown): Promise<void> => Promise.resolve());
const countOpenAnnouncements = vi.fn((_source: string, _since: Date): Promise<number> => Promise.resolve(0));
const { noteSuccess } = vi.hoisted(() => ({ noteSuccess: vi.fn(async () => {}) }));

vi.mock("./alert", () => ({
  noteFailureAndMaybeAlert: vi.fn(async () => {}),
  noteSuccess,
}));

import type { CollectDeps } from "../types";
const deps: CollectDeps = {
  askModel: vi.fn(async () => ""),
  jsonCacheGet,
  jsonCacheSet,
  countOpenAnnouncements,
  updateAnnouncement: vi.fn(async () => {}),
  updateAnnouncementIfEmpty: vi.fn(async () => 0),
};

import {
  BOARD_SOURCES,
  RETRY_DELAY_MS,
  applyPersistedBoardRule,
  asFailCount,
  boardSyncSources,
  cookieHeaderFor,
  cookieJarAbsorb,
  type CookieJar,
  enforceHealCooldown,
  fetchBoardText,
  mergeCookieHeader,
} from "./registry";
import { BOARD_SOURCE_IDS } from "./source-ids";
import { tpBusan } from "./sources/tp-busan";
import { tpJeonbuk } from "./sources/tp-jeonbuk";
import { ulsan } from "./sources/ulsan";
import { koreaeximConfig } from "./sources/koreaexim";
import { boardCapKey } from "./page-cap";
import {
  COLLECTION_BASELINE_TTL_MS,
  collectionBaselineKey,
  collectionBaselineSignature,
  type CollectionBaselineRecord,
} from "./collection-baseline";

function headerGet(location?: string | null) {
  return {
    get: (name: string) => (name.toLowerCase() === "location" ? location ?? null : null),
  };
}

function bodyOf(data: string | Uint8Array) {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  return {
    getReader() {
      let sent = false;
      return {
        read: async () => {
          if (sent) return { done: true as const, value: undefined };
          sent = true;
          return { done: false as const, value: bytes };
        },
        cancel: async () => {},
      };
    },
  };
}

function okRes(body: string | Uint8Array, status = 200) {
  const bytes = typeof body === "string" ? new TextEncoder().encode(body) : body;
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: headerGet(null),
    body: bodyOf(bytes),
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  };
}

function redirectRes(location: string, status = 302) {
  return { ok: false, status, headers: headerGet(location), body: null };
}

/** 수출입은행처럼 「쿠키 주고 같은 주소로 돌려보내는」 응답. getSetCookie 가 있는 Headers 흉내. */
function redirectResWithCookies(location: string, cookies: string[]) {
  return {
    ok: false,
    status: 302,
    body: null,
    headers: {
      get: (k: string) => {
        const key = k.toLowerCase();
        if (key === "location") return location;
        if (key === "set-cookie") return cookies.join(", ");
        return null;
      },
      getSetCookie: () => cookies,
    },
  };
}

describe("board registry", () => {
  beforeEach(() => {
    jsonCacheGet.mockReset().mockResolvedValue(null);
    jsonCacheSet.mockReset().mockResolvedValue(undefined);
    countOpenAnnouncements.mockReset().mockResolvedValue(0);
    noteSuccess.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("124곳이 등록되고 각각 고유 id", () => {
    expect(BOARD_SOURCES.length).toBe(124);
    const ids = BOARD_SOURCES.map((c) => c.id);
    expect(new Set(ids).size).toBe(124);
    expect(ids).toContain("kocca-finance");
    // 2026-09-06 P2 w6 연결 2곳
    for (const id of ["hespa", "jbio"]) expect(ids).toContain(id);
    expect(ids).toContain("dgtp");
    expect(ids).toContain("tp-jeonbuk");
    expect(ids).toContain("jica");
    expect(ids).toContain("pipa");
    // 2026-09-02 연결 6곳
    for (const id of ["ccei", "sese", "snip", "krit", "kbiz", "koreaexim"]) expect(ids).toContain(id);
    // 2026-09-06 P2 w1 연결 4곳
    for (const id of ["kiria", "knrec", "kimst", "wfi"]) expect(ids).toContain(id);
    // 2026-09-06 P2 w2 연결 3곳 — 첨부가 POST 전용인 게시판
    for (const id of ["hrdk", "kofic", "wbiz"]) expect(ids).toContain(id);
    // 2026-09-06 P2 w3 연결 5곳(거르개 중심)
    for (const id of ["iris", "kead", "moel", "kfme", "kwbiz"]) expect(ids).toContain(id);
    // 2026-09-06 연결(P2 w4) 4곳
    for (const id of ["mainbiz", "innobiz", "gbia", "pomia"]) expect(ids).toContain(id);
    // ── P2 w5 ── 2026-09-06 연결 5곳(기초자치단체 계열)
    for (const id of ["uesc", "ikse", "suncheon", "hanam", "sscf"]) expect(ids).toContain(id);
  });

  it("BOARD_SOURCES 는 BOARD_SOURCE_IDS 의 부분집합이다", () => {
    expect(BOARD_SOURCE_IDS.size).toBe(124);
    expect(BOARD_SOURCES.every((c) => BOARD_SOURCE_IDS.has(c.id))).toBe(true);
  });

  it("대장에 실린 출처는 전부 id 목록에도 있다", () => {
    for (const cfg of BOARD_SOURCES) expect(BOARD_SOURCE_IDS.has(cfg.id)).toBe(true);
  });

  it("sync 용 PolicyMatchSource 로 감싸지고 전부 clockOnly", () => {
    const before = process.env.POLICY_BOARD_PROXY_URL;
    delete process.env.POLICY_BOARD_PROXY_URL;
    try {
      const wrapped = boardSyncSources(deps);
      // 프록시 없으면 국내 IP 전용 14곳(기존 6곳 전북TP·대전신보·서울신보·세종TP·안양·진주바이오 + 2026-09-06 P2 8곳 hrdk·kfme·kwbiz·pomia·uesc·suncheon·gbia·ikse)이 빠져 105곳. 119는 BOARD_SOURCES 쪽.
      expect(wrapped).toHaveLength(110);
      expect(wrapped.every((s) => s.clockOnly === true)).toBe(true);
      expect(wrapped.every((s) => s.staleAfterDays === 30)).toBe(true);
      expect(typeof wrapped[0].fetchAll).toBe("function");
      expect(wrapped.map((s) => s.name).sort()).toEqual(
        [
          "ansan",
          "atkorea",
          "bepa",
          "bizbc",
          "bizok",
          "bssinbo",
          "cba",
          "cbf",
          "cbsinbo",
          "cbtp",
          "ccei",
          "cistep",
          "cnsinbo",
          "cwip",
          "dapa",
          "dgsinbo",
          "dgtp",
          "djbea",
          "exportvoucher",
          "gbsa",
          "gbsinbo",
          "gcgf",
          "gepa",
          "geri",
          "gipa",
          "gjsinbo",
          "gjtp",
          "gmsbdc",
          "gnsinbo",
          "gopa",
          "gtp",
          "gwsinbo",
          "gwtp",
          "hanam",
          "hespa",
          "hsbiz",
          "icsinbo",
          "innobiz",
          "ipet",
          "iris",
          "itp",
          "jba",
          "jbba",
          "jbsinbo",
          "jcgf",
          "jejutp",
          "jepa",
          "jica",
          "jnsinbo",
          "kbiz",
          "kead",
          "keit",
          "keiti",
          "ketep",
          "khidi",
          "kiat",
          "kibo",
          "kicox",
          "kidp",
          "kita",
          "kocca",
          "kocca-finance",
          "molit",
          "mof",
          "mois",
          "mpva",
          "mnd",
          "kodma",
          "kofic",
          "koreaexim",
          "koreg",
          "kosmes",
          "kotra",
          "krit",
          "mainbiz",
          "moel",
          "motie",
          "mss",
          "nipa",
          "nyj",
          "paju",
          "pipa",
          "ptp",
          "riia-gn",
          "riia-jn",
          "sba",
          "semas",
          "seoultp",
          "sese",
          "sida",
          "sjsinbo",
          "smartfactory",
          "smes24",
          "smtech",
          "snip",
          "sscf",
          "touraz",
          "tp-busan",
          "tp-chungnam",
          "tp-daejeon",
          "tp-gyeongbuk",
          "tp-gyeongnam",
          "ulsan",
          "ulsinbo",
          "wbiz",
          "ypa",
          // ── P2 w1 ──
          "kiria",
          "knrec",
          "kimst",
          "wfi",
        ].sort(),
      );
    } finally {
      if (before !== undefined) process.env.POLICY_BOARD_PROXY_URL = before;
    }
  });

  it("persisted 규칙이 있으면 list.rowSelector·fields 를 덮어쓴다", async () => {
    jsonCacheGet.mockResolvedValue({
      rowSelector: "table.healed tbody tr",
      fields: {
        title: { selector: "a.healed" },
        detailUrl: { selector: "a.healed", attr: "href" },
        date: { selector: ".d" },
      },
    });
    const resolved = await applyPersistedBoardRule(tpBusan, deps);
    expect(resolved.list.rowSelector).toBe("table.healed tbody tr");
    expect(resolved.list.fields.title.selector).toBe("a.healed");
    expect(jsonCacheGet).toHaveBeenCalledWith("board-rule:tp-busan");
  });

  it("sanitize 실패 규칙은 적용하지 않는다", async () => {
    jsonCacheGet.mockResolvedValue({
      rowSelector: "table.healed tbody tr",
      fields: {
        title: { selector: "a.healed" },
        detailUrl: { selector: "a.healed", attr: "href" },
        date: { selector: ".d" },
        xss: { selector: "script" },
      },
    });
    const resolved = await applyPersistedBoardRule(tpBusan, deps);
    expect(resolved.list.rowSelector).toBe(tpBusan.list.rowSelector);
  });

  it("persisted 규칙이 적용되면 customParse 를 뺀다", async () => {
    jsonCacheGet.mockResolvedValue({
      rowSelector: "table.media-table tbody tr",
      fields: {
        title: { selector: "a" },
        detailUrl: { selector: "a", attr: "onclick" },
        date: { regex: "(\\d{4}-\\d{2}-\\d{2})" },
      },
    });
    const resolved = await applyPersistedBoardRule(ulsan, deps);
    expect(resolved.customParse).toBeUndefined();
    expect(resolved.list.rowSelector).toBe("table.media-table tbody tr");
  });

  it("prisma 조회 실패는 규칙 없음으로 진행한다", async () => {
    jsonCacheGet.mockRejectedValue(new Error("down"));
    await expect(applyPersistedBoardRule(tpBusan, deps)).resolves.toBe(tpBusan);
  });

  it("실패 카운터는 숫자 문자열을 Number 로 읽고 아니면 0", () => {
    expect(asFailCount(3)).toBe(3);
    expect(asFailCount("4")).toBe(4);
    expect(asFailCount("nope")).toBe(0);
    expect(asFailCount(null)).toBe(0);
    expect(asFailCount({ n: 1 })).toBe(0);
  });

  it("목록 비교는 열린 공고 합계를 부르지 않는다", async () => {
    countOpenAnnouncements.mockResolvedValue(231);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("net"); }));
    const src = boardSyncSources(deps).find((s) => s.name === "tp-busan");
    await expect(src!.fetchAll()).rejects.toThrow();
    expect(countOpenAnnouncements).not.toHaveBeenCalled();
  });

  it("fetchBoardText 는 HTTP 오류·목록용 3MB 초과·외부 호스트를 거절한다(limits 안 주면 원래 좁은 상한 그대로)", async () => {
    await expect(fetchBoardText("https://evil.test/x", "utf-8", tpBusan)).rejects.toThrow(/호스트/);
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false, status: 503, headers: headerGet(null), body: bodyOf(""),
    })));
    await expect(fetchBoardText("https://www.btp.or.kr/a", "utf-8", tpBusan)).rejects.toThrow(/HTTP 503/);
    const chunk = new Uint8Array(1024 * 1024);
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: { signal?: AbortSignal }) => {
      let n = 0;
      return {
        ok: true,
        status: 200,
        headers: headerGet(null),
        body: {
          getReader() {
            return {
              read: async () => {
                n += 1;
                if (n > 5) return { done: true as const, value: undefined };
                return { done: false as const, value: chunk };
              },
              cancel: async () => {},
            };
          },
        },
        arrayBuffer: async () => new ArrayBuffer(0),
        signal: init?.signal,
      };
    }));
    await expect(fetchBoardText("https://www.btp.or.kr/a", "utf-8", tpBusan)).rejects.toThrow(/3MB/);
  });

  it("limits 를 상세용(20MB)으로 주면 3MB 를 넘는 정상 문서도 끝까지 읽는다(경북TP nttNo=11458 재발 방지 — fable 리뷰 중요2)", async () => {
    // 15MB — 옛 3MB 상한이면 잘렸을 크기, 새 20MB 상한 아래라 성공해야 한다.
    const totalBytes = 15 * 1024 * 1024;
    const chunkSize = 1024 * 1024;
    const chunk = new TextEncoder().encode("가".repeat(chunkSize / 3)); // 대략 1MB
    vi.stubGlobal("fetch", vi.fn(async () => {
      let sent = 0;
      return {
        ok: true,
        status: 200,
        headers: headerGet(null),
        body: {
          getReader() {
            return {
              read: async () => {
                if (sent >= totalBytes) return { done: true as const, value: undefined };
                sent += chunk.byteLength;
                return { done: false as const, value: chunk };
              },
              cancel: async () => {},
            };
          },
        },
      };
    }));
    const text = await fetchBoardText("https://www.btp.or.kr/a", "utf-8", tpBusan, undefined, {
      timeoutMs: 30_000,
      maxBytes: 20 * 1024 * 1024,
    });
    expect(text.length).toBeGreaterThan(0);
  });

  it("limits 를 상세용으로 줘도 20MB 는 넘으면 거절한다", async () => {
    const chunk = new Uint8Array(4 * 1024 * 1024);
    vi.stubGlobal("fetch", vi.fn(async () => {
      let n = 0;
      return {
        ok: true,
        status: 200,
        headers: headerGet(null),
        body: {
          getReader() {
            return {
              read: async () => {
                n += 1;
                if (n > 6) return { done: true as const, value: undefined }; // 24MB
                return { done: false as const, value: chunk };
              },
              cancel: async () => {},
            };
          },
        },
      };
    }));
    await expect(
      fetchBoardText("https://www.btp.or.kr/a", "utf-8", tpBusan, undefined, { timeoutMs: 30_000, maxBytes: 20 * 1024 * 1024 }),
    ).rejects.toThrow(/20MB/);
  });

  // ※ 예전에는 이 세 시험이 전북TP(tpJeonbuk)를 예시로 썼다. 전북TP 가 `requiresProxy` 가 되면서
  //    「경유 설정 없으면 요청 안 함」에 먼저 걸려 리다이렉트까지 가지도 못한다.
  //    리다이렉트 동작은 출처와 무관하므로 경유가 필요 없는 부산TP 로 바꿨다.
  //    전북TP 의 새 동작은 아래 「국내 경유가 필요한 출처」 묶음에서 따로 잰다.
  it("같은 호스트 3xx 는 Location 을 절대화해 따라가고 redirect:manual 이다", async () => {
    const fetchMock = vi.fn(async (url: string, _init?: unknown) => {
      if (url === "https://www.btp.or.kr/board/list") {
        return redirectRes("/board/list?ok=1");
      }
      return okRes("부산본문");
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchBoardText("https://www.btp.or.kr/board/list", "utf-8", tpBusan))
      .resolves.toBe("부산본문");
    expect(fetchMock.mock.calls[0][1]).toEqual(expect.objectContaining({ redirect: "manual" }));
    expect(fetchMock.mock.calls[1][0]).toBe("https://www.btp.or.kr/board/list?ok=1");
  });

  it("리다이렉트 호스트가 허용 밖이면 throw 한다", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => redirectRes("https://evil.test/x")));
    await expect(fetchBoardText("https://www.btp.or.kr/a", "utf-8", tpBusan)).rejects.toThrow(/호스트/);
  });

  it("리다이렉트 3홉을 넘으면 throw 한다", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const u = new URL(url);
      const n = Number(u.searchParams.get("h") ?? "0");
      return redirectRes(`https://www.btp.or.kr/a?h=${n + 1}`);
    }));
    await expect(fetchBoardText("https://www.btp.or.kr/a?h=0", "utf-8", tpBusan)).rejects.toThrow(/3홉/);
  });

  it("★리다이렉트가 준 쿠키를 같은 호스트 다음 홉에 Cookie 로 싣는다 — 수출입은행은 안 실으면 302 를 되풀이한다", async () => {
    type FetchInit = { headers?: Record<string, string> };
    const fetchMock = vi.fn(async (url: string, init: FetchInit) => {
      const cookie = init.headers?.Cookie ?? "";
      if (!cookie.includes("JSESSIONID=abc.node1") || !cookie.includes("WMONID=w1")) {
        return redirectResWithCookies(url, [
          "JSESSIONID=abc.node1; Path=/; HttpOnly",
          "WMONID=w1; Expires=Thu, 02-Sep-2027 19:02:25 GMT; Path=/",
        ]);
      }
      return okRes("수출입은행 본문");
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchBoardText("https://www.koreaexim.go.kr/HPHKBI039M01?curPage=1", "utf-8", koreaeximConfig))
      .resolves.toBe("수출입은행 본문");
    // 첫 요청엔 Cookie 가 없고, 둘째 요청에 두 쿠키가 「이름=값; 이름=값」으로 실린다.
    const firstInit = fetchMock.mock.calls[0]?.[1];
    const secondInit = fetchMock.mock.calls[1]?.[1];
    expect(firstInit?.headers?.Cookie).toBeUndefined();
    expect(secondInit?.headers?.Cookie).toBe("JSESSIONID=abc.node1; WMONID=w1");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("쿠키는 그것을 준 호스트에만 보낸다 — 다른 허용 호스트로 넘어가면 안 싣는다", async () => {
    // tpBusan 은 www.btp.or.kr 외 allowedHosts 가 없으므로, 같은 호스트 안에서만 검증한다.
    // 다른 호스트로의 리다이렉트는 assertAllowedHost 가 막으므로 「보내지 않는다」를 항아리 단위 시험으로 고정한다.
    const jar = new Map();
    cookieJarAbsorb(jar, "https://a.test/x", ["S=1; Path=/", "T=2; HttpOnly"]);
    expect(cookieHeaderFor(jar, "https://a.test/y")).toBe("S=1; T=2");
    expect(cookieHeaderFor(jar, "https://b.test/y")).toBeUndefined();
    // 같은 이름이 다시 오면 값을 덮는다(세션 갱신).
    cookieJarAbsorb(jar, "https://a.test/z", ["S=9; Path=/"]);
    expect(cookieHeaderFor(jar, "https://a.test/y")).toBe("S=9; T=2");
  });

  it("설정이 이미 Cookie 헤더를 주면 항아리 쿠키를 뒤에 이어 붙인다", () => {
    const jar = new Map();
    cookieJarAbsorb(jar, "https://a.test/x", ["S=1"]);
    expect(mergeCookieHeader("K=0", cookieHeaderFor(jar, "https://a.test/y"))).toBe("K=0; S=1");
    expect(mergeCookieHeader(undefined, cookieHeaderFor(jar, "https://a.test/y"))).toBe("S=1");
    expect(mergeCookieHeader("K=0", undefined)).toBe("K=0");
  });

  it("Secure 쿠키는 https 에서만 싣고, http 로 내려가면 안 싣는다", async () => {
    type FetchInit = { headers?: Record<string, string> };
    const fetchMock = vi.fn(async (url: string, init: FetchInit) => {
      if (new URL(url).protocol === "https:") {
        return redirectResWithCookies("http://www.koreaexim.go.kr/public", [
          "SID=x; Secure; Path=/",
        ]);
      }
      return okRes("공개 페이지");
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      fetchBoardText("https://www.koreaexim.go.kr/HPHKBI039M01?curPage=1", "utf-8", koreaeximConfig),
    ).resolves.toBe("공개 페이지");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("http://www.koreaexim.go.kr/public");
    expect(fetchMock.mock.calls[1]?.[1]?.headers?.Cookie ?? "").not.toContain("SID=");
  });

  it("Set-Cookie 에 Path 가 없으면 기본 경로는 요청 주소의 디렉터리다", () => {
    const jar = new Map();
    cookieJarAbsorb(jar, "https://a.test/challenge/start", ["TOK=1"]);
    expect(cookieHeaderFor(jar, "https://a.test/challenge/next")).toBe("TOK=1");
    expect(cookieHeaderFor(jar, "https://a.test/public")).toBeUndefined();
  });

  it("Path=/challenge 쿠키는 RFC 6265 path-match 로 /challenge·/challenge/next 에만 실린다", () => {
    const jar = new Map();
    cookieJarAbsorb(jar, "https://a.test/challenge", ["TOK=1; Path=/challenge"]);
    expect(cookieHeaderFor(jar, "https://a.test/challenge")).toBe("TOK=1");
    expect(cookieHeaderFor(jar, "https://a.test/challenge/next")).toBe("TOK=1");
    expect(cookieHeaderFor(jar, "https://a.test/challenges")).toBeUndefined();
    expect(cookieHeaderFor(jar, "https://a.test/challenge-old")).toBeUndefined();
    expect(cookieHeaderFor(jar, "https://a.test/public")).toBeUndefined();
  });

  it("같은 이름·다른 Path 쿠키는 둘 다 보관하고 path 가 긴 것부터 싣는다", () => {
    const jar = new Map();
    cookieJarAbsorb(jar, "https://a.test/", ["SID=root; Path=/"]);
    cookieJarAbsorb(jar, "https://a.test/challenge", ["SID=guard; Path=/challenge"]);
    expect(cookieHeaderFor(jar, "https://a.test/public")).toBe("SID=root");
    expect(cookieHeaderFor(jar, "https://a.test/challenge/x")).toBe("SID=guard; SID=root");
  });

  it("설정 Cookie 와 항아리 Cookie 이름이 겹치면 항아리 값으로 덮어쓴다", () => {
    expect(mergeCookieHeader("JSESSIONID=stale; K=0", "JSESSIONID=fresh")).toBe("JSESSIONID=fresh; K=0");
  });

  it("★경유가 필요한 출처는 설정값이 없으면 요청 자체를 안 한다 — 해외 IP 로 두드려 봐야 실패 알림만 쌓인다", async () => {
    const before = process.env.POLICY_BOARD_PROXY_URL;
    delete process.env.POLICY_BOARD_PROXY_URL;
    const fetchMock = vi.fn(async () => okRes("가면 안 되는 응답"));
    vi.stubGlobal("fetch", fetchMock);
    try {
      await expect(fetchBoardText("https://www.jbtp.or.kr/a", "utf-8", tpJeonbuk))
        .rejects.toThrow(/국내 경유 설정값이 없어/);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      if (before !== undefined) process.env.POLICY_BOARD_PROXY_URL = before;
    }
  });

  it("네트워크 오류(fetch failed)면 같은 홉을 700ms 뒤 한 번 더 보내고 본문을 돌려준다", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(okRes("본문"));
    vi.stubGlobal("fetch", fetchMock);
    const p = fetchBoardText("https://www.btp.or.kr/a", "utf-8", tpBusan);
    await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS);
    await expect(p).resolves.toBe("본문");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(fetchMock.mock.calls[1]?.[0]);
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(fetchMock.mock.calls[1]?.[1]);
  });

  it("HTTP 503 은 재시도하지 않고 한 번만 부르며 HTTP 503 으로 throw 한다", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false, status: 503, headers: headerGet(null), body: bodyOf(""),
    }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchBoardText("https://www.btp.or.kr/a", "utf-8", tpBusan)).rejects.toThrow(/HTTP 503/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("두 번 다 네트워크 오류면 원래 오류를 던지고 fetch 는 2번이다", async () => {
    vi.useFakeTimers();
    const first = new TypeError("fetch failed");
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(first)
      .mockRejectedValueOnce(new TypeError("fetch failed"));
    vi.stubGlobal("fetch", fetchMock);
    const p = fetchBoardText("https://www.btp.or.kr/a", "utf-8", tpBusan);
    const assertion = expect(p).rejects.toBe(first);
    await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS);
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("본문을 스트리밍으로 읽다 목록용 3MB 를 넘으면 abort 한다(limits 안 준 기본 경로)", async () => {
    const chunk = new Uint8Array(1024 * 1024);
    const signals: AbortSignal[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: { signal?: AbortSignal }) => {
      if (init?.signal) signals.push(init.signal);
      let n = 0;
      return {
        ok: true,
        status: 200,
        headers: headerGet(null),
        body: {
          getReader() {
            return {
              read: async () => {
                n += 1;
                if (n > 5) return { done: true as const, value: undefined };
                return { done: false as const, value: chunk };
              },
              cancel: async () => {},
            };
          },
        },
      };
    }));
    await expect(fetchBoardText("https://www.btp.or.kr/a", "utf-8", tpBusan)).rejects.toThrow(/3MB/);
    expect(signals[0]?.aborted).toBe(true);
  });

  it("24시간 안 자가수리는 즉시 throw 하고 직전에 시각을 기록한다", async () => {
    jsonCacheGet.mockResolvedValue(Date.now() - 60_000);
    await expect(enforceHealCooldown("tp-busan", deps)).rejects.toThrow(/쿨다운/);
    jsonCacheGet.mockResolvedValue(null);
    await expect(enforceHealCooldown("ulsan", deps)).resolves.toBeUndefined();
    expect(jsonCacheSet).toHaveBeenCalledWith("board-heal-cooldown:ulsan", expect.any(Number));
  });

  it("fetchAll 성공 시 실패 카운터를 리셋한다", async () => {
    const html = readFileSync(join(__dirname, "__fixtures__/ulsan-list.html"), "utf-8");
    vi.stubGlobal("fetch", vi.fn(async () => okRes(html)));
    const src = boardSyncSources(deps).find((s) => s.name === "ulsan");
    const list = await src!.fetchAll();
    expect(list.length).toBeGreaterThan(0);
    expect(noteSuccess).toHaveBeenCalledWith("ulsan", expect.anything());
  });

  /**
   * 운영 실측(GBIA 2026-09-13): 정상 5쪽이 75행인데 복구된 열린 공고 231건과 비교해 거짓 급락.
   * 비교 기준은 출처·설정별 성공 수집 기록이다. 엔진·부산TP 선택자 경로로 75→20 을 재현한다.
   */
  describe("수집 성공 기준값", () => {
    const BUSAN_PER_PAGE = 15;

    function busanListHtml(ids: number[]): string {
      const rows = ids.map((id) =>
        `<tr><td class="subject"><a href="?mCode=MN013&mode=view&board_seq=${id}"><span class="subjectWr">2026년 지원사업 공고 ${id}번 모집</span></a></td><td class="period">2026.08.26 ~ 2026.09.04</td></tr>`,
      ).join("");
      return `<table class="bdListTbl"><tbody>${rows}</tbody></table>`;
    }

    function stubBusanPages(total: number, perPage = BUSAN_PER_PAGE) {
      vi.stubGlobal("fetch", vi.fn(async (url: string) => {
        const page = Number(new URL(String(url)).searchParams.get("page") ?? "1");
        const start = (page - 1) * perPage + 1;
        const ids = start > total
          ? []
          : Array.from({ length: Math.min(perPage, total - start + 1) }, (_, i) => start + i);
        return okRes(busanListHtml(ids));
      }));
    }

    function validRecord(cfg: typeof tpBusan, count: number, observedAt = new Date().toISOString()): CollectionBaselineRecord {
      return {
        v: 1,
        source: cfg.id,
        count,
        observedAt,
        signature: collectionBaselineSignature(cfg),
      };
    }

    function installCache(initial: Record<string, unknown> = {}) {
      const cache = new Map<string, unknown>(Object.entries(initial));
      jsonCacheGet.mockImplementation(async (key: string) => cache.get(key) ?? null);
      jsonCacheSet.mockImplementation(async (key: string, value: unknown) => {
        cache.set(key, value);
      });
      return cache;
    }

    function busanSrc() {
      return boardSyncSources(deps).find((s) => s.name === "tp-busan")!;
    }

    function baselineWrites() {
      return jsonCacheSet.mock.calls.filter(([key]) => key === collectionBaselineKey("tp-busan"));
    }

    it("첫 비교는 아카이브 231이 있어도 75행을 채택하고 75를 기록한다", async () => {
      countOpenAnnouncements.mockResolvedValue(231);
      const cache = installCache();
      stubBusanPages(75);
      const list = await busanSrc().fetchAll();
      expect(list).toHaveLength(75);
      expect(countOpenAnnouncements).not.toHaveBeenCalled();
      expect(cache.get(collectionBaselineKey("tp-busan"))).toEqual(expect.objectContaining({
        v: 1,
        source: "tp-busan",
        count: 75,
        signature: collectionBaselineSignature(tpBusan),
      }));
      expect(jsonCacheSet).toHaveBeenCalledWith(
        boardCapKey("tp-busan"),
        expect.objectContaining({ hitCap: false }),
      );
      expect(noteSuccess).toHaveBeenCalledWith("tp-busan", expect.anything());
    });

    it("같은 설정의 다음 75행은 통과하고 기준값을 유지한다", async () => {
      const cache = installCache();
      stubBusanPages(75);
      const src = busanSrc();
      expect(await src.fetchAll()).toHaveLength(75);
      expect(await src.fetchAll()).toHaveLength(75);
      expect(cache.get(collectionBaselineKey("tp-busan"))).toEqual(expect.objectContaining({ count: 75 }));
      expect(countOpenAnnouncements).not.toHaveBeenCalled();
    });

    it("실제 75→20 급락은 실패하고 직전 75를 지킨다", async () => {
      const key = collectionBaselineKey("tp-busan");
      const prior = validRecord(tpBusan, 75);
      const cache = installCache({ [key]: prior });
      stubBusanPages(20);
      await expect(busanSrc().fetchAll()).rejects.toThrow(/급락 20 < 직전 75/);
      expect(cache.get(key)).toBe(prior);
      expect(baselineWrites()).toHaveLength(0);
    });

    it("네트워크 실패는 기존 기준값을 덮지 않는다", async () => {
      const key = collectionBaselineKey("tp-busan");
      const prior = validRecord(tpBusan, 75);
      const cache = installCache({ [key]: prior });
      vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("net"); }));
      await expect(busanSrc().fetchAll()).rejects.toThrow();
      expect(cache.get(key)).toBe(prior);
      expect(baselineWrites()).toHaveLength(0);
      expect(noteSuccess).not.toHaveBeenCalled();
    });

    it("뒤쪽 요청 실패로 일부만 반환해도 성공 기준값은 덮지 않는다", async () => {
      const key = collectionBaselineKey("tp-busan");
      const prior = validRecord(tpBusan, 75);
      const cache = installCache({ [key]: prior });
      vi.stubGlobal("fetch", vi.fn(async (url: string) => {
        const page = Number(new URL(String(url)).searchParams.get("page") ?? "1");
        if (page >= 5) throw new Error("late page unavailable");
        return okRes(busanListHtml(Array.from({ length: 15 }, (_, i) => (page - 1) * 15 + i + 1)));
      }));
      expect(await busanSrc().fetchAll()).toHaveLength(60);
      expect(cache.get(key)).toBe(prior);
      expect(baselineWrites()).toHaveLength(0);
    });

    it("빈 목록 실패는 기준값을 만들지 않는다", async () => {
      installCache();
      vi.stubGlobal("fetch", vi.fn(async () => okRes("<div>없음</div>")));
      await expect(busanSrc().fetchAll()).rejects.toThrow(/게시판 추출 전 단계 실패/);
      expect(baselineWrites()).toHaveLength(0);
    });

    it.each([
      ["없음", null],
      ["음수", { count: -1 }],
      ["소수", { count: 75.5 }],
      ["안전정수 아님", { count: Number.MAX_SAFE_INTEGER + 1 }],
      ["미래", { observedAt: new Date(Date.now() + 60_000).toISOString() }],
      ["만료", { observedAt: new Date(Date.now() - COLLECTION_BASELINE_TTL_MS).toISOString() }],
      ["다른 출처", { source: "ulsan" }],
      ["다른 설정", { signature: "old-config" }],
    ] as const)("깨진 기준값(%s)은 첫 비교로 20행을 통과시킨다", async (_label, patch) => {
      const key = collectionBaselineKey("tp-busan");
      const broken = patch === null ? null : { ...validRecord(tpBusan, 75), ...patch };
      installCache({ [key]: broken });
      stubBusanPages(20);
      const list = await busanSrc().fetchAll();
      expect(list).toHaveLength(20);
      expect(jsonCacheSet).toHaveBeenCalledWith(key, expect.objectContaining({ count: 20 }));
    });

    it("설정이 바뀐 출처만 비교를 리셋하고 다른 출처 기준값은 그대로다", async () => {
      const busanKey = collectionBaselineKey("tp-busan");
      const ulsanKey = collectionBaselineKey("ulsan");
      const ulsanPrior = validRecord(ulsan, 40);
      const cache = installCache({
        [busanKey]: { ...validRecord(tpBusan, 75), signature: "old-config" },
        [ulsanKey]: ulsanPrior,
      });
      stubBusanPages(20);
      expect(await busanSrc().fetchAll()).toHaveLength(20);
      expect(cache.get(ulsanKey)).toBe(ulsanPrior);
      expect(cache.get(busanKey)).toEqual(expect.objectContaining({
        count: 20,
        signature: collectionBaselineSignature(tpBusan),
      }));
    });

    it("기준값 저장 실패는 검증된 75행을 그대로 돌려주고 경고한다", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      jsonCacheGet.mockResolvedValue(null);
      jsonCacheSet.mockImplementation(async (key: string) => {
        if (String(key) === collectionBaselineKey("tp-busan")) throw new Error("disk full token=secret-value");
      });
      stubBusanPages(75);
      try {
        const list = await busanSrc().fetchAll();
        expect(list).toHaveLength(75);
        const printed = warn.mock.calls.map((c) => c.map(String).join(" ")).join("\n");
        expect(printed).toMatch(/\[policy-board\] 수집 기준값 저장 실패 tp-busan/);
        expect(printed).not.toMatch(/secret-value/);
        expect(noteSuccess).toHaveBeenCalledWith("tp-busan", expect.anything());
      } finally {
        warn.mockRestore();
      }
    });

    it("기준값 읽기 실패는 첫 비교(0)로 75행을 채택한다", async () => {
      jsonCacheGet.mockImplementation(async (key: string) => {
        if (String(key) === collectionBaselineKey("tp-busan")) throw new Error("db");
        return null;
      });
      stubBusanPages(75);
      expect(await busanSrc().fetchAll()).toHaveLength(75);
    });
  });
});

describe("국내 경유가 필요한 출처", () => {
  it("프록시 설정값이 없으면 수집 목록에서 빠진다", () => {
    const before = process.env.POLICY_BOARD_PROXY_URL;
    delete process.env.POLICY_BOARD_PROXY_URL;
    try {
      const ids = boardSyncSources(deps).map((s) => s.name);
      expect(ids).not.toContain("tp-jeonbuk");
      expect(ids).not.toContain("djsinbo");
      expect(ids).not.toContain("seoulsinbo");
      expect(ids).not.toContain("sjtp");
      expect(ids).not.toContain("aca");
      expect(ids).not.toContain("jbio");
      expect(ids).toContain("dgtp");
      // ── P2 w5 ── 하남·수원은 국내 경유가 필요 없다(맥에서 직접 200 실측).
      for (const id of ["hanam", "sscf"]) expect(ids).toContain(id);
      // 2026-09-06 P2 경유 전환 8곳은 설정값이 없으면 빠진다(hrdk·kfme·kwbiz·pomia·uesc·suncheon·gbia·ikse).
      for (const id of ["hrdk", "kfme", "kwbiz", "pomia", "uesc", "suncheon", "gbia", "ikse"]) expect(ids).not.toContain(id);
      expect(ids).toHaveLength(110);
    } finally {
      if (before !== undefined) process.env.POLICY_BOARD_PROXY_URL = before;
    }
  });

  it("설정값이 있으면 목록에 들어온다", () => {
    const before = process.env.POLICY_BOARD_PROXY_URL;
    process.env.POLICY_BOARD_PROXY_URL = "http://example.invalid:8080";
    try {
      const ids = boardSyncSources(deps).map((s) => s.name);
      expect(ids).toContain("tp-jeonbuk");
      expect(ids).toContain("djsinbo");
      expect(ids).toContain("seoulsinbo");
      expect(ids).toContain("sjtp");
      expect(ids).toContain("aca");
      expect(ids).toContain("jbio");
    } finally {
      if (before === undefined) delete process.env.POLICY_BOARD_PROXY_URL;
      else process.env.POLICY_BOARD_PROXY_URL = before;
    }
  });

  it("프록시 필요 표시가 붙은 출처는 열네 곳이다 — 기존 6곳 + 2026-09-06 P2 경유 전환 8곳", () => {
    expect(BOARD_SOURCES.filter((c) => c.requiresProxy).map((c) => c.id)).toEqual([
      "tp-jeonbuk",
      "djsinbo",
      "seoulsinbo",
      "sjtp",
      "aca",
      "hrdk",
      "kfme",
      "kwbiz",
      "gbia",
      "pomia",
      "uesc",
      "ikse",
      "suncheon",
      "jbio",
    ]);
  });

  it("★공백만 든 설정값은 「없음」으로 본다 — 등록만 되고 매번 실패해 알림이 쌓이면 안 된다", () => {
    // 걸러내기와 실제 요청이 설정값을 **다르게** 읽으면, 출처가 목록에는 들어가고
    // 요청은 거부돼 12시간마다 실패 알림만 남는다(적대 리뷰 지적).
    const before = process.env.POLICY_BOARD_PROXY_URL;
    process.env.POLICY_BOARD_PROXY_URL = "   ";
    try {
      expect(boardSyncSources(deps).map((s) => s.name)).not.toContain("tp-jeonbuk");
    } finally {
      if (before === undefined) delete process.env.POLICY_BOARD_PROXY_URL;
      else process.env.POLICY_BOARD_PROXY_URL = before;
    }
  });
});


describe("쿠키 항아리 — 적대 리뷰 3차 (이름 충돌·구분자·Path 형식)", () => {
  it("설정 Cookie 가 있어도 항아리의 같은 이름·다른 Path 쿠키가 하나로 뭉개지지 않는다", () => {
    expect(mergeCookieHeader("PREF=ko", "SID=guard; SID=root")).toBe("PREF=ko; SID=guard; SID=root");
    expect(mergeCookieHeader("JSESSIONID=stale; K=0", "JSESSIONID=fresh")).toBe("JSESSIONID=fresh; K=0");
  });
  it("쿠키 이름에 | 가 있어도 이름이 잘리지 않는다", () => {
    const jar: CookieJar = new Map();
    cookieJarAbsorb(jar, "https://a.test/x", ["A|B=v; Path=/"]);
    expect(cookieHeaderFor(jar, "https://a.test/y")).toBe("A|B=v");
  });
  it("/ 로 시작하지 않는 Path 는 무시하고 요청 디렉터리를 기본 경로로 쓴다", () => {
    const jar: CookieJar = new Map();
    cookieJarAbsorb(jar, "https://a.test/challenge/start", ["TOK=1; Path=challenge"]);
    expect(cookieHeaderFor(jar, "https://a.test/challenge/next")).toBe("TOK=1");
    expect(cookieHeaderFor(jar, "https://a.test/public")).toBeUndefined();
  });
});

/**
 * ★서버가 **지우라고** 보낸 쿠키는 담지 않는다(2026-09-06 독립 리뷰 8번).
 * 안 보면 로그아웃·세션 폐기로 서버가 지운 값을 계속 되돌려 보내게 된다.
 */
describe("쿠키 항아리 — 만료(Max-Age·Expires)", () => {
  it("Max-Age=0 은 담지 않고, 이미 있던 같은 이름·경로도 지운다", () => {
    const jar: CookieJar = new Map();
    cookieJarAbsorb(jar, "https://a.test/x", ["SID=live; Path=/"]);
    expect(cookieHeaderFor(jar, "https://a.test/y")).toBe("SID=live");
    cookieJarAbsorb(jar, "https://a.test/x", ["SID=; Path=/; Max-Age=0"]);
    expect(cookieHeaderFor(jar, "https://a.test/y")).toBeUndefined();
  });

  it("지난 Expires 는 담지 않는다 — 앞으로의 Expires 와 Max-Age 우선 규칙은 그대로", () => {
    const jar: CookieJar = new Map();
    cookieJarAbsorb(jar, "https://a.test/x", [
      "OLD=1; Path=/; Expires=Wed, 09 Jun 2021 10:18:14 GMT",
      "NEW=2; Path=/; Expires=Fri, 09 Jun 2100 10:18:14 GMT",
      // RFC 6265 §5.2.2 — Max-Age 가 있으면 Expires 는 무시한다(지난 Expires 여도 산다).
      "KEEP=3; Path=/; Max-Age=600; Expires=Wed, 09 Jun 2021 10:18:14 GMT",
    ]);
    const sent = cookieHeaderFor(jar, "https://a.test/y") ?? "";
    expect(sent).not.toContain("OLD=");
    expect(sent).toContain("NEW=2");
    expect(sent).toContain("KEEP=3");
  });
});
