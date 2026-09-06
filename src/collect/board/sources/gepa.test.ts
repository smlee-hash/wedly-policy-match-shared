import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { gepaConfig, parseGepaList } from "./gepa";

const list = readFileSync(join(__dirname, "../__fixtures__/w4-gepa-list.html"), "utf-8");

describe("gepa 경북경제진흥원 — 목록 파싱", () => {
  it("vid 로 중복 없이 뽑고 정확한 신청기간 범위를 싣는다", () => {
    const rows = parseGepaList(list);
    expect(rows.length).toBe(11);
    const r = rows.find((x) => x.title.includes("글로벌 온라인몰"));
    expect(r?.detailUrl).toBe("https://www.gepa.kr/?page_id=36&stype1=type1&vid=2416");
    expect(r?.dateText).toBe("2026-08-27 ~ 2026-11-30");
  });
  it("메뉴·사이트맵 링크(vid 없음)는 안 섞인다", () => {
    for (const r of parseGepaList(list)) expect(r.detailUrl).toContain("vid=");
  });
  it("구직자 대상 채용행사는 거른다(적대 리뷰 — 기업 진단에 무관한 행 혼입)", () => {
    const titles = parseGepaList(list).map((r) => r.title).join("\n");
    expect(titles).not.toContain("채용행사");
  });
});

describe("gepa — 첨부 오탐 방지(적대 리뷰 — onclick 안 파일명을 주소로 오인)", () => {
  const detail = readFileSync(join(__dirname, "../__fixtures__/w4-gepa-detail.html"), "utf-8");
  it("sendBoardFileData 의 따옴표 파일명을 가짜 URL 로 저장하지 않는다", async () => {
    const { harvestBoardAttachments } = await import("../detail-fill");
    const atts = harvestBoardAttachments(detail, "https://www.gepa.kr/");
    expect(atts.every((a) => !a.url.includes("%EB%B6%99%EC%9E%84") && !a.url.includes("붙임"))).toBe(true);
  });
});

describe("gepa — config", () => {
  it("쪽넘김은 board_page", () => {
    expect(gepaConfig.list.url(2)).toBe("https://www.gepa.kr/?page_id=36&mode=list&board_page=2&stype1=type1");
    expect(gepaConfig.detailContentSelector).toBe("#madang01_board");
  });
});
