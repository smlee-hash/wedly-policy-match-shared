import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { tpGyeongnamConfig, parseGyeongnamList } from "./tp-gyeongnam";

const list = readFileSync(join(__dirname, "../__fixtures__/gntp-list.html"), "utf-8");

describe("tp-gyeongnam 경남테크노파크 — 목록 파싱", () => {
  it("PC 표(#gridData)만 읽어 이중 마크업 중복이 없다", () => {
    const rows = parseGyeongnamList(list, tpGyeongnamConfig);
    expect(rows.length).toBeGreaterThanOrEqual(8);
    const ids = rows.map((r) => r.detailUrl);
    expect(new Set(ids).size).toBe(ids.length); // 모바일 li 와 겹치면 여기서 깨진다
  });
  it("시작·마감 칸을 「시작 ~ 마감」으로 합치고 행별 기관명을 쓴다", () => {
    const rows = parseGyeongnamList(list, tpGyeongnamConfig);
    const sacheon = rows.find((r) => r.title.includes("사천시 항공기업"));
    expect(sacheon).toBeTruthy();
    expect(sacheon!.detailUrl).toBe("https://www.gntp.or.kr/biz/applyInfo/3832");
    expect(sacheon!.dateText).toMatch(/2026-08-24\s*~\s*2026-09-02/);
    expect(sacheon!.agency).toContain("경남테크노파크");
  });
});
