import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { tpJeonbuk } from "./tp-jeonbuk";
import { fetchBoardAll } from "../engine";

const listHtml = readFileSync(join(__dirname, "../__fixtures__/tp-jeonbuk-list.html"), "utf-8");

const deps = {
  fetchText: async () => listHtml,
  prevOpenCount: 0,
  askModel: async () => "{}",
  onAllFailed: vi.fn(),
};

describe("tp-jeonbuk", () => {
  it("고정본에서 공고를 뽑아 정규화한다", async () => {
    const out = await fetchBoardAll(tpJeonbuk, deps);
    expect(out.length).toBeGreaterThanOrEqual(tpJeonbuk.expectMinRows ?? 5);
    expect(out[0].source).toBe("tp-jeonbuk");
    expect(out[0].url).toMatch(/^https?:\/\//);
    expect(out[0].title.length).toBeGreaterThan(3);
  });

  it("thead 행이 안 섞인다", async () => {
    const out = await fetchBoardAll(tpJeonbuk, deps);
    expect(out.every((r) => r.title !== "제목" && r.title !== "No" && r.title !== "마감일")).toBe(true);
    expect(out[0].title).toContain("기후테크");
  });

  it("마감일 단일 → applyEnd 만 설정되고 applyStart 는 null", async () => {
    const out = await fetchBoardAll(tpJeonbuk, deps);
    expect(out[0].applyStart).toBeNull();
    expect(out[0].applyEnd?.toISOString()).toBe("2026-08-28T14:59:59.000Z");
  });
});
