import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { tpBusan } from "./tp-busan";
import { fetchBoardAll, fetchBoardDetail } from "../engine";

const listHtml = readFileSync(join(__dirname, "../__fixtures__/tp-busan-list.html"), "utf-8");
const detailHtml = readFileSync(join(__dirname, "../__fixtures__/tp-busan-detail.html"), "utf-8");

const deps = {
  fetchText: async () => listHtml,
  prevOpenCount: 0,
  askModel: async () => "{}",
  onAllFailed: vi.fn(),
};

describe("tp-busan", () => {
  it("고정본에서 공고를 뽑아 정규화한다", async () => {
    const out = await fetchBoardAll(tpBusan, deps);
    expect(out.length).toBeGreaterThanOrEqual(tpBusan.expectMinRows ?? 5);
    expect(out[0].source).toBe("tp-busan");
    expect(out[0].url).toMatch(/^https?:\/\//);
    expect(out[0].title.length).toBeGreaterThan(3);
  });

  it("이중 span 제목이 한 번만 나온다", async () => {
    const out = await fetchBoardAll(tpBusan, deps);
    const title = out[0].title;
    expect(title).toContain("기술수요조사");
    expect(title.split("기술수요조사").length - 1).toBe(1);
  });

  it("접수기간 점 날짜가 applyStart·End 로 파싱된다", async () => {
    const out = await fetchBoardAll(tpBusan, deps);
    expect(out[0].applyStart?.toISOString()).toBe("2026-08-25T15:00:00.000Z");
    expect(out[0].applyEnd?.toISOString()).toBe("2026-09-04T14:59:59.000Z");
  });

  it("상세 고정본 board-biz-view 에 기술수요조사가 있다", async () => {
    const text = await fetchBoardDetail(tpBusan, "https://www.btp.or.kr/detail", {
      fetchText: async () => detailHtml,
    });
    expect(text).toContain("기술수요조사");
  });
});
