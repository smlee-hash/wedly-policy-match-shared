import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { tpDaejeon } from "./tp-daejeon";
import { fetchBoardAll } from "../engine";
import { extractBySelector } from "../layers/selector";

const listHtml = readFileSync(join(__dirname, "../__fixtures__/tp-daejeon-list.html"), "utf-8");
const listHtmlKo = readFileSync(join(__dirname, "../__fixtures__/tp-daejeon-list-ko.html"), "utf-8");

const deps = {
  fetchText: async () => listHtml,
  prevOpenCount: 0,
  askModel: async () => "{}",
  onAllFailed: vi.fn(),
};

describe("tp-daejeon", () => {
  it("고정본에서 공고를 뽑아 정규화한다", async () => {
    const out = await fetchBoardAll(tpDaejeon, deps);
    expect(out.length).toBeGreaterThanOrEqual(tpDaejeon.expectMinRows ?? 5);
    expect(out[0].source).toBe("tp-daejeon");
    expect(out[0].url).toMatch(/^https?:\/\//);
    expect(out[0].title.length).toBeGreaterThan(3);
  });

  it("detailUrl 에 &amp; 가 남아있지 않다", async () => {
    const out = await fetchBoardAll(tpDaejeon, deps);
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((r) => !r.url.includes("&amp;"))).toBe(true);
    expect(out[0].url).toContain("&bid=");
  });

  it("category 가 잡힌다", async () => {
    const out = await fetchBoardAll(tpDaejeon, deps);
    expect(out.some((r) => (r.category ?? "").length > 0)).toBe(true);
  });

  it("1·2페이지에서 같은 list_no 는 nPage 만 달라도 한 건이다", async () => {
    const page1 = listHtml;
    const page2 = listHtml.replace(/nPage=1/g, "nPage=2");
    const out = await fetchBoardAll(tpDaejeon, {
      fetchText: async (url) => (url.includes("nPage=2") ? page2 : page1),
      prevOpenCount: 0,
      askModel: async () => "{}",
      onAllFailed: vi.fn(),
    });
    const listNos = out.map((r) => new URL(r.url).searchParams.get("list_no"));
    expect(listNos.every((n) => n)).toBe(true);
    expect(new Set(listNos).size).toBe(listNos.length);
    expect(out.every((r) => !new URL(r.url).searchParams.has("nPage"))).toBe(true);
  });

  it("한국어 변형 HTML 은 selector 층이 10행 이상·범위 날짜·tag 없는 상세를 남긴다", async () => {
    const rows = extractBySelector(listHtmlKo, tpDaejeon);
    expect(rows.length).toBeGreaterThanOrEqual(10);
    expect(rows.every((r) => /20\d{2}-\d{2}-\d{2}\s*~\s*20\d{2}-\d{2}-\d{2}/.test(r.dateText))).toBe(true);

    const out = await fetchBoardAll(tpDaejeon, {
      fetchText: async () => listHtmlKo,
      prevOpenCount: 0,
      askModel: async () => "{}",
      onAllFailed: vi.fn(),
    });
    expect(out.length).toBeGreaterThanOrEqual(10);
    expect(out.every((r) => !r.url.includes("tag="))).toBe(true);
    expect(out.every((r) => /20\d{2}-\d{2}-\d{2}\s*~\s*20\d{2}-\d{2}-\d{2}/.test(r.applyPeriodText))).toBe(true);
  });
});
