import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { gcgfConfig, parseGcgfList } from "./gcgf";

const list = readFileSync(join(__dirname, "../__fixtures__/w4-gcgf-list.html"), "utf-8");

describe("gcgf 경기신보 — 잡탕 게시판 선별", () => {
  it("모집·공모·지원사업만 남기고 data-id 로 상세 주소를 만든다", () => {
    const rows = parseGcgfList(list);
    expect(rows.length).toBeGreaterThanOrEqual(2);
    const r = rows.find((x) => x.title.includes("모두의 창업"));
    expect(r?.detailUrl).toBe("https://www.gcgf.or.kr/gcgf/pt/pst/selectPstInfo.do?mi=1024&bbsId=1002&pstSn=51148");
    expect(r?.dateText).toBe("2026-08-27 ~");
  });
  it("지점 이전·행정예고·청렴도·비엔날레는 거른다", () => {
    const titles = parseGcgfList(list).map((r) => r.title).join("\n");
    expect(titles).not.toContain("이전 안내");
    expect(titles).not.toContain("행정예고");
    expect(titles).not.toContain("청렴도");
    expect(titles).not.toContain("비엔날레");
  });
});

describe("gcgf — config", () => {
  it("쪽넘김은 currPage", () => {
    expect(gcgfConfig.list.url(2)).toBe("https://www.gcgf.or.kr/gcgf/pt/pst/selectPstList.do?mi=1024&bbsId=1002&currPage=2");
    expect(gcgfConfig.detailContentSelector).toBe(".bbs_ViewA");
  });
});
