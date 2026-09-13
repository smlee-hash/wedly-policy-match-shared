import { afterEach, describe, expect, it, vi } from "vitest";
import type { BoardConfig } from "./types";
import {
  COLLECTION_BASELINE_TTL_MS,
  COLLECTION_BASELINE_VERSION,
  collectionBaselineKey,
  collectionBaselineSignature,
  parseCollectionBaseline,
  readCollectionBaselineCount,
  saveCollectionBaseline,
  type CollectionBaselineRecord,
} from "./collection-baseline";

const NOW = Date.parse("2026-09-13T05:11:00.000Z");

function cfgOf(overrides: Partial<BoardConfig> = {}): BoardConfig {
  return {
    id: "gbia",
    label: "김해의생명산업진흥원",
    agency: "김해의생명산업진흥원",
    region: "경남",
    baseUrl: "https://gbia.or.kr/",
    charset: "utf-8",
    list: {
      url: (p) => `https://gbia.or.kr/bbs/board.php?bo_table=business&page=${p}`,
      maxPages: 5,
      rowSelector: "#bo_list table tbody tr",
      fields: {
        title: { selector: "td.td_subject a" },
        detailUrl: { selector: "td.td_subject a", attr: "href" },
        date: { selector: "td.td_date" },
      },
    },
    expectMinRows: 7,
    ...overrides,
  };
}

function rec(overrides: Partial<CollectionBaselineRecord> = {}): CollectionBaselineRecord {
  const cfg = cfgOf();
  return {
    v: COLLECTION_BASELINE_VERSION,
    source: cfg.id,
    count: 75,
    observedAt: new Date(NOW).toISOString(),
    signature: collectionBaselineSignature(cfg),
    ...overrides,
  };
}

function parse(value: unknown, cfg = cfgOf(), now = NOW) {
  return parseCollectionBaseline(value, {
    source: cfg.id,
    signature: collectionBaselineSignature(cfg),
    now,
  });
}

describe("collectionBaselineSignature", () => {
  it("같은 평문 설정·목록 주소 표본이면 런타임과 무관하게 같다", () => {
    const a = cfgOf();
    const b = cfgOf({
      list: {
        ...cfgOf().list,
        url: (page) => `https://gbia.or.kr/bbs/board.php?bo_table=business&page=${page}`,
      },
    });
    expect(collectionBaselineSignature(a)).toBe(collectionBaselineSignature(b));
  });

  it("함수 본문·이름·커밋 해시를 서명에 넣지 않는다", () => {
    const withParse = cfgOf({
      customParse: function secretParseName() {
        return [];
      },
    });
    const sig = collectionBaselineSignature(withParse);
    expect(sig).not.toMatch(/function|secretParseName|\(\)\s*=>/);
    expect(sig).not.toMatch(/[0-9a-f]{40}/);
  });

  it("customParse 구현이 달라도 있음/없음만 본다", () => {
    const a = cfgOf({ customParse: () => [] });
    const b = cfgOf({
      customParse: () => [{ title: "다른 파서", detailUrl: "https://gbia.or.kr/x", dateText: "2026-09-01" }],
    });
    expect(collectionBaselineSignature(a)).toBe(collectionBaselineSignature(b));
    expect(collectionBaselineSignature(a)).not.toBe(collectionBaselineSignature(cfgOf()));
  });

  it("표시 이름만 바뀌면 서명이 같고, 쪽수·목록 주소가 바뀌면 다르다", () => {
    const base = cfgOf();
    expect(collectionBaselineSignature(cfgOf({ label: "다른 이름" }))).toBe(collectionBaselineSignature(base));
    expect(collectionBaselineSignature(cfgOf({
      list: { ...base.list, maxPages: 10 },
    }))).not.toBe(collectionBaselineSignature(base));
    expect(collectionBaselineSignature(cfgOf({
      list: { ...base.list, url: (p) => `https://gbia.or.kr/bbs/board.php?bo_table=other&page=${p}` },
    }))).not.toBe(collectionBaselineSignature(base));
  });

  it("POST 목록의 설정 변경은 서명을 바꾸고 같은 요청은 유지한다", () => {
    const base = cfgOf();
    const config = (size: number, method: "POST" | "GET" = "POST") => cfgOf({ list: {
      ...base.list,
      init: (page) => ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify({ size, offset: (page - 1) * size }) }),
    } });
    expect(collectionBaselineSignature(config(50))).toBe(collectionBaselineSignature(config(50)));
    expect(collectionBaselineSignature(config(50))).not.toBe(collectionBaselineSignature(config(20)));
    expect(collectionBaselineSignature(config(50))).not.toBe(collectionBaselineSignature(config(50, "GET")));
  });

  it("POST 요청 표본은 SHA256 만 남기고 본문·머리글·함수 본문을 실지 않는다", () => {
    const cfg = cfgOf({
      list: {
        ...cfgOf().list,
        init: function secretInitName(page) {
          return {
            method: "POST",
            headers: { authorization: "Bearer secret-token-value", "content-type": "application/json" },
            body: JSON.stringify({ password: "secret-value", page }),
          };
        },
      },
    });
    const sig = collectionBaselineSignature(cfg);
    expect(sig).toMatch(/"listInit":"[0-9a-f]{64}"/);
    expect(sig).not.toMatch(/secretInitName|secret-token-value|secret-value|Bearer|password|authorization/i);
    expect(sig).not.toMatch(/function|\(\)\s*=>/);
  });

  it("출처 id 가 다르면 서명이 갈린다", () => {
    expect(collectionBaselineKey("gbia")).toBe("board-collection-baseline:gbia");
    expect(collectionBaselineKey("ulsan")).not.toBe(collectionBaselineKey("gbia"));
    expect(collectionBaselineSignature(cfgOf({ id: "ulsan" }))).not.toBe(collectionBaselineSignature(cfgOf()));
  });
});

describe("parseCollectionBaseline", () => {
  it("같은 출처·설정·26시간 안의 정수 건수는 통과한다", () => {
    expect(parse(rec())?.count).toBe(75);
    expect(parse(rec(), cfgOf(), NOW + COLLECTION_BASELINE_TTL_MS - 1)?.count).toBe(75);
  });

  it.each([
    ["없음", null],
    ["배열", [{ count: 75 }]],
    ["문자열", "75"],
    ["버전 불일치", rec({ v: 2 })],
    ["버전 문자열", { ...rec(), v: "1" as unknown as number }],
    ["음수", rec({ count: -1 })],
    ["소수", rec({ count: 75.5 })],
    ["안전정수 아님", rec({ count: Number.MAX_SAFE_INTEGER + 1 })],
    ["건수 문자열", { ...rec(), count: "75" as unknown as number }],
    ["미래", rec({ observedAt: new Date(NOW + 1).toISOString() })],
    ["만료", rec({ observedAt: new Date(NOW - COLLECTION_BASELINE_TTL_MS).toISOString() })],
    ["날짜 아님", rec({ observedAt: "어제" })],
    ["빈 시각", rec({ observedAt: "" })],
    ["다른 출처", rec({ source: "ulsan" })],
    ["빈 서명", rec({ signature: "" })],
    ["다른 설정", rec({ signature: "other-config" })],
  ])("깨진 값(%s)은 버린다", (_label, value) => {
    expect(parse(value)).toBeNull();
  });
});

describe("readCollectionBaselineCount", () => {
  it("유효한 기록의 count 를 돌려준다", async () => {
    const cfg = cfgOf();
    const n = await readCollectionBaselineCount(
      cfg,
      async (key) => {
        expect(key).toBe(collectionBaselineKey("gbia"));
        return rec();
      },
      NOW,
    );
    expect(n).toBe(75);
  });

  it("읽기 실패·깨진 값은 첫 비교(0)이다", async () => {
    const cfg = cfgOf();
    await expect(readCollectionBaselineCount(cfg, async () => { throw new Error("db"); }, NOW)).resolves.toBe(0);
    await expect(readCollectionBaselineCount(cfg, async () => rec({ count: -3 }), NOW)).resolves.toBe(0);
    await expect(readCollectionBaselineCount(cfg, async () => null, NOW)).resolves.toBe(0);
  });
});

describe("saveCollectionBaseline", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("성공 수집 건수와 서명을 저장한다", async () => {
    const cfg = cfgOf();
    const set = vi.fn(async () => {});
    await saveCollectionBaseline(cfg, 75, set, NOW);
    expect(set).toHaveBeenCalledWith(collectionBaselineKey("gbia"), {
      v: 1,
      source: "gbia",
      count: 75,
      observedAt: new Date(NOW).toISOString(),
      signature: collectionBaselineSignature(cfg),
    });
  });

  it("음수·소수 건수는 저장하지 않는다", async () => {
    const set = vi.fn(async () => {});
    await saveCollectionBaseline(cfgOf(), -1, set, NOW);
    await saveCollectionBaseline(cfgOf(), 1.5, set, NOW);
    expect(set).not.toHaveBeenCalled();
  });

  it("저장 실패는 경고만 하고 던지지 않는다 — 비밀값을 실지 않는다", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const set = vi.fn(async () => { throw new Error("disk full token=secret-value"); });
    await expect(saveCollectionBaseline(cfgOf(), 75, set, NOW)).resolves.toBeUndefined();
    const printed = warn.mock.calls.map((c) => c.map(String).join(" ")).join("\n");
    expect(printed).toMatch(/\[policy-board\] 수집 기준값 저장 실패 gbia/);
    expect(printed).not.toMatch(/token=secret-value/);
    expect(printed).not.toMatch(/https:\/\/gbia\.or\.kr/);
  });
});
