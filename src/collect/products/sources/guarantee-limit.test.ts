import { describe, expect, it } from "vitest";
import { firstLimitWon } from "./guarantee-limit";

describe("firstLimitWon — 보증 상품 표의 대표 한도(처음 나오는 금액, 2026-09-24 실사이트 원문)", () => {
  it.each([
    ["3천만원 이내(기보증금액 포함 5천만원 이내)", 30_000_000],
    ["1억원 이내 (재단 기보증 포함) ※ 단, 업력 3개월미만인 경우 최대 2천만원", 100_000_000],
    ["본 특례보증 5억원 이내 업체당 8억원 이하 (소상공인 심사 1억원 이하)", 500_000_000],
    ["(소기업) 업체당 최대 5억원 이내 (운전자금, 시설자금) (소상공인) 업체당 최대 1억원 이내", 500_000_000],
    ["본건 최대 1,800만원(마이너스통장 대출한도 최대 2,000만원) 이내", 18_000_000],
    ["업체당 50백만원 이내", 50_000_000],
    ["100백만원 이내", 100_000_000],
  ])("%s → %d", (text, won) => {
    expect(firstLimitWon(text)).toBe(won);
  });

  it("금액이 없으면 null — 지어내지 않는다", () => {
    expect(firstLimitWon("개별 심사")).toBeNull();
    expect(firstLimitWon("")).toBeNull();
  });
});
