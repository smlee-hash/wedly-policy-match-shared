import { describe, expect, it, vi } from "vitest";
import {
  BOARD_CAP_KEY_PREFIX,
  boardCapKey,
  boardCapMapFromCache,
  notePageCap,
  parseBoardCap,
} from "./page-cap";

describe("parseBoardCap", () => {
  it("hitCap·lastPageNew·at 가 있으면 그대로 읽는다", () => {
    expect(parseBoardCap({
      hitCap: true,
      lastPageNew: 3,
      at: "2026-09-01T00:00:00.000Z",
    })).toEqual({
      hitCap: true,
      lastPageNew: 3,
      at: "2026-09-01T00:00:00.000Z",
    });
  });

  it("깨진 값은 버린다 — 화면이 가짜 상한으로 켜지지 않게", () => {
    expect(parseBoardCap(null)).toBeNull();
    expect(parseBoardCap("yes")).toBeNull();
    expect(parseBoardCap({ hitCap: "true", lastPageNew: 1, at: "2026-09-01T00:00:00.000Z" })).toBeNull();
    expect(parseBoardCap({ hitCap: true, lastPageNew: "3", at: "2026-09-01T00:00:00.000Z" })).toBeNull();
    expect(parseBoardCap({ hitCap: true, lastPageNew: 3 })).toBeNull();
  });

  it("⑧ hitCap·lastPageNew·at 불변식이 어긋나면 모름(null)으로 떨어뜨린다", () => {
    const at = "2026-09-01T00:00:00.000Z";
    expect(parseBoardCap({ hitCap: true, lastPageNew: 0, at })).toBeNull();
    expect(parseBoardCap({ hitCap: false, lastPageNew: 2, at })).toBeNull();
    expect(parseBoardCap({ hitCap: true, lastPageNew: -1, at })).toBeNull();
    expect(parseBoardCap({ hitCap: true, lastPageNew: 1.5, at })).toBeNull();
    expect(parseBoardCap({ hitCap: true, lastPageNew: 3, at: "어제" })).toBeNull();
    expect(parseBoardCap({ hitCap: false, lastPageNew: 0, at })).toEqual({
      hitCap: false,
      lastPageNew: 0,
      at,
    });
  });
});

describe("boardCapMapFromCache", () => {
  it("board-cap:<id> 행만 id → 기록으로 모은다", () => {
    const map = boardCapMapFromCache([
      { key: `${BOARD_CAP_KEY_PREFIX}semas`, value: { hitCap: true, lastPageNew: 4, at: "2026-09-01T00:00:00.000Z" } },
      { key: "board-alert:semas", value: 3 },
      { key: `${BOARD_CAP_KEY_PREFIX}gepa`, value: { hitCap: false, lastPageNew: 0, at: "2026-09-01T01:00:00.000Z" } },
    ]);
    expect(map.get("semas")).toEqual({ hitCap: true, lastPageNew: 4, at: "2026-09-01T00:00:00.000Z" });
    expect(map.get("gepa")?.hitCap).toBe(false);
    expect(map.has("board-alert:semas")).toBe(false);
  });
});

describe("notePageCap", () => {
  it("장부에 { hitCap, lastPageNew, at } 를 쓴다", async () => {
    const set = vi.fn(async () => {});
    await notePageCap("semas", { hitCap: true, lastPageNew: 3 }, {
      store: { set },
      now: () => new Date("2026-09-01T08:00:00.000Z"),
    });
    expect(set).toHaveBeenCalledWith({
      hitCap: true,
      lastPageNew: 3,
      at: "2026-09-01T08:00:00.000Z",
      runAt: "2026-09-01T08:00:00.000Z",
    });
    expect(boardCapKey("semas")).toBe("board-cap:semas");
  });

  it("장부 쓰기가 실패해도 던지지 않는다 — 수집 회차가 죽으면 안 된다", async () => {
    const set = vi.fn(async () => { throw new Error("db down"); });
    await expect(notePageCap("semas", { hitCap: true, lastPageNew: 1 }, { store: { set } }))
      .resolves.toBeUndefined();
  });

  it("⑥ 더 새 회차가 이미 썼으면 옛 회차 쓰기를 버린다", async () => {
    const set = vi.fn(async () => {});
    const get = vi.fn(async () => ({
      hitCap: false,
      lastPageNew: 0,
      at: "2026-09-02T00:00:00.000Z",
      runAt: "2026-09-02T00:00:00.000Z",
    }));
    await notePageCap("semas", { hitCap: true, lastPageNew: 4, runAt: "2026-09-01T00:00:00.000Z" }, {
      store: { set, get },
      now: () => new Date("2026-09-01T00:01:00.000Z"),
    });
    expect(set).not.toHaveBeenCalled();
  });

  it("⑥ 이번 회차가 더 새면 덮어쓴다", async () => {
    const set = vi.fn(async () => {});
    const get = vi.fn(async () => ({
      hitCap: true,
      lastPageNew: 4,
      at: "2026-09-01T00:00:00.000Z",
      runAt: "2026-09-01T00:00:00.000Z",
    }));
    await notePageCap("semas", { hitCap: false, lastPageNew: 0, runAt: "2026-09-02T00:00:00.000Z" }, {
      store: { set, get },
      now: () => new Date("2026-09-02T00:01:00.000Z"),
    });
    expect(set).toHaveBeenCalledWith({
      hitCap: false,
      lastPageNew: 0,
      at: "2026-09-02T00:01:00.000Z",
      runAt: "2026-09-02T00:00:00.000Z",
    });
  });
});
