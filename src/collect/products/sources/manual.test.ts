import { describe, expect, it } from "vitest";
import { MANUAL_PRODUCTS, fetchManualAll } from "./manual";

describe("MANUAL_PRODUCTS — 손 등록 명부(JS 로 못 긁는 것·창구 안내, 계획서 Task 14)", () => {
  it("전 건에 verifiedAt(YYYY-MM-DD)·https detailUrl·fundingGroup 이 있고 sourceId 는 유일하다", () => {
    expect(MANUAL_PRODUCTS.length).toBeGreaterThanOrEqual(5);
    for (const p of MANUAL_PRODUCTS) {
      expect(p.verifiedAt, p.name).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(p.detailUrl, p.name).toMatch(/^https:\/\//);
      expect(p.fundingGroup, p.name).toBeTruthy();
    }
    const ids = MANUAL_PRODUCTS.map((p) => p.sourceId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("엔젤투자매칭펀드 — invest·매칭 배율·업력 7년 이내", () => {
    const p = MANUAL_PRODUCTS.find((x) => x.name === "엔젤투자매칭펀드");
    expect(p).toMatchObject({
      fundingGroup: "invest",
      limitText: "엔젤투자액의 1~2배 매칭",
      targetRules: { bizAgeMaxYears: 7 },
    });
  });

  it("신보·기보·지역신보 창구는 productType:guarantee·한도 없음·보증료 별도로 정직하게 적는다(값을 지어내지 않는다)", () => {
    const windows = MANUAL_PRODUCTS.filter((p) => p.fundingGroup === "guarantee");
    expect(windows.length).toBeGreaterThanOrEqual(3);
    for (const w of windows) {
      expect(w.productType, w.name).toBe("guarantee");
      expect(w.limitText, w.name).toBe("");
      expect(w.rateText, w.name).toBe("보증료 별도");
      expect(w.targetText, w.name).toBe("재단·기금별 보증상품은 창구 안내 참조");
    }
  });

  it("금감원 개인사업자대출 876건에 이미 있는 은행 상품(IBK·카카오뱅크·토스뱅크·국민은행)은 넣지 않는다 — 겹치면 두 번 센다", () => {
    const blob = MANUAL_PRODUCTS.map((p) => `${p.institution} ${p.name}`).join(" ");
    expect(blob).not.toMatch(/IBK|카카오뱅크|토스뱅크|국민은행|KB국민/);
  });

  it("fetchManualAll — source:'manual' 을 붙이고 verifiedAt 을 raw 로 옮긴다(원본 손실 없이)", async () => {
    const list = await fetchManualAll();
    expect(list).toHaveLength(MANUAL_PRODUCTS.length);
    list.forEach((item, i) => {
      expect(item.source).toBe("manual");
      expect(item.sourceId).toBe(MANUAL_PRODUCTS[i].sourceId);
      expect((item.raw as { verifiedAt?: string }).verifiedAt).toBe(MANUAL_PRODUCTS[i].verifiedAt);
      expect("verifiedAt" in item).toBe(false);
    });
  });
});
