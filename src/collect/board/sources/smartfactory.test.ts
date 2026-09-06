import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fetchSmartfactoryDetail, parseSmartfactoryList, smartfactoryConfig } from "./smartfactory";

const list = readFileSync(join(__dirname, "../__fixtures__/w4-sf-list.json"), "utf-8");
const dtl = readFileSync(join(__dirname, "../__fixtures__/w4-sf-dtl.json"), "utf-8");

describe("smartfactory — JSON 목록 파싱", () => {
  it("pbancList 에서 행을 뽑고 접수기간의 시각을 지운다(함정4)", () => {
    const rows = parseSmartfactoryList(list);
    expect(rows.length).toBe(10);
    const r = rows.find((x) => x.title.includes("HD현대사이트솔루션"));
    expect(r?.detailUrl).toBe("https://www.smart-factory.kr/usr/bg/ba/ma/bsnsPbancDtl?pbancId=2026-N-0182&pbancSn=2");
    expect(r?.dateText).toBe("2026-08-28 ~ 2026-09-18");
    expect(r?.dateText).not.toContain(":");
  });
  it("HTML 이 오면(장애) 빈 배열", () => {
    expect(parseSmartfactoryList("<html><body>점검중</body></html>")).toEqual([]);
  });
});

describe("smartfactory — detailFetch 훅", () => {
  it("상세 API 를 POST 로 부르고 pbancCn 본문을 돌려준다", async () => {
    const calls: Array<{ url: string; init?: { method: string; body: string } }> = [];
    const html = await fetchSmartfactoryDetail(
      "https://www.smart-factory.kr/usr/bg/ba/ma/bsnsPbancDtl?pbancId=2026-N-0182&pbancSn=2",
      async (url, init) => { calls.push({ url, init: init as never }); return dtl; },
    );
    expect(calls[0].url).toBe("https://www.smart-factory.kr/usr/bg/ba/ma/bsnsPbanc/selectBsnsPbancDtlPage.do");
    expect(calls[0].init?.method).toBe("POST");
    expect(calls[0].init?.body).toContain('"pbancId":"2026-N-0182"');
    expect(html).toContain("중소벤처기업부 공고");
    expect(html.length).toBeGreaterThan(500);
  });
  it("pbancId 가 없으면 빈 문자열(요청 안 함)", async () => {
    const html = await fetchSmartfactoryDetail("https://www.smart-factory.kr/usr/bg/ba/ma/bsnsPbancDtl", async () => dtl);
    expect(html).toBe("");
  });
});

describe("smartfactory — config", () => {
  it("목록은 POST init 으로 페이지를 넘긴다", () => {
    const init = smartfactoryConfig.list.init?.(3);
    expect(init?.method).toBe("POST");
    expect(init?.body).toContain('"currentPage":3');
    expect(smartfactoryConfig.detailFetch).toBe(fetchSmartfactoryDetail);
  });
  it("전체가 아니라 접수중(ING)만 7쪽까지 — 최신 30건 밖의 열린 공고 누락 방지(적대 리뷰)", () => {
    const init = smartfactoryConfig.list.init?.(1);
    expect(init?.body).toContain('"rcptStts":"ING"');
    expect(smartfactoryConfig.list.maxPages).toBe(7);
  });
});

describe("smartfactory — 분야 칸(독립 검사 4차: 사업·컨소시엄 이름이 분야 알약에 들어가던 문제)", () => {
  it("사업 분류명을 category 로 싣지 않는다(제목에 이미 들어 있다)", () => {
    const rows = parseSmartfactoryList(list);
    expect(rows.every((r) => !r.category)).toBe(true);
    expect(rows.some((r) => r.title.includes("HD현대사이트솔루션"))).toBe(true);
  });
});
