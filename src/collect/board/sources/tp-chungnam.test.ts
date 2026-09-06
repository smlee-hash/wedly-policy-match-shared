import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { tpChungnam } from "./tp-chungnam";
import { fetchBoardAll } from "../engine";

const listHtml = readFileSync(join(__dirname, "../__fixtures__/tp-chungnam-list.html"), "utf-8");

const deps = {
  fetchText: async () => listHtml,
  prevOpenCount: 0,
  askModel: async () => "{}",
  onAllFailed: vi.fn(),
};

describe("tp-chungnam", () => {
  it("고정본에서 공고를 뽑아 정규화한다", async () => {
    const out = await fetchBoardAll(tpChungnam, deps);
    expect(out.length).toBeGreaterThanOrEqual(tpChungnam.expectMinRows ?? 5);
    expect(out[0].source).toBe("tp-chungnam");
    expect(out[0].url).toMatch(/^https?:\/\//);
    expect(out[0].title.length).toBeGreaterThan(3);
  });

  it("</tr> 안 닫는 원문에서도 행 10개가 나온다", async () => {
    const out = await fetchBoardAll(tpChungnam, deps);
    expect(out).toHaveLength(10);
  });

  it("마감일 단일 → applyEnd 만 설정되고 applyStart 는 null", async () => {
    const out = await fetchBoardAll(tpChungnam, deps);
    expect(out[0].applyStart).toBeNull();
    expect(out[0].applyEnd?.toISOString()).toBe("2026-08-28T14:59:59.000Z");
  });
});
