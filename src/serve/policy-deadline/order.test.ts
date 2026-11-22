// 맞을 확률 순서(NO.789) — 해당 없음 → 조건 정리 전 → 단계 → 남은 확인 수 → 마감(상시는 뒤) → 점수 → 이름 → 열쇠.
// 서버 목록과 화면(종류로 거를 때 다시 줄 세우기)이 같은 비교를 쓴다.
import { describe, expect, it } from "vitest";
import { compareByTier, type TierOrderKey } from "./order";

function row(key: string, over: Partial<TierOrderKey> = {}): TierOrderKey {
  return {
    dismissed: false, unstructured: false, tier: "high", checkCount: 0, applyEnd: "2026-11-20", tierScore: 100, name: "가나상사", key, ...over,
  };
}
const order = (rows: TierOrderKey[]) => [...rows].sort(compareByTier).map((r) => r.key);

describe("compareByTier — 맞을 확률 순서", () => {
  it("해당 없음은 단계와 상관없이 맨 뒤 · 조건 정리 전은 그 앞 · 나머지는 높음 → 보통 → 낮음", () => {
    expect(order([
      row("dismissed-high", { dismissed: true }),
      row("flat", { unstructured: true, tier: "low", tierScore: 0 }),
      row("low", { tier: "low", tierScore: 40 }),
      row("mid", { tier: "mid", tierScore: 70 }),
      row("high", { tier: "high", tierScore: 95 }),
    ])).toEqual(["high", "mid", "low", "flat", "dismissed-high"]);
  });

  it("같은 단계면 남은 확인 수가 적은 순 — 점수가 낮아도 확인이 적으면 먼저", () => {
    expect(order([
      row("two", { tier: "mid", checkCount: 2, tierScore: 85 }),
      row("one", { tier: "mid", checkCount: 1, tierScore: 70 }),
    ])).toEqual(["one", "two"]);
  });

  it("같은 단계·같은 확인 수면 마감 가까운 순 — 상시(마감 없음)는 날짜 마감 뒤", () => {
    expect(order([
      row("always", { applyEnd: null }),
      row("d10", { applyEnd: "2026-11-22" }),
      row("d3", { applyEnd: "2026-11-15" }),
    ])).toEqual(["d3", "d10", "always"]);
  });

  it("같은 마감이면 점수 높은 순 → 이름 글자 순 → 열쇠 순", () => {
    expect(order([
      row("k3", { tierScore: 92, name: "다온상사" }),
      row("k2", { tierScore: 92, name: "가온식품" }),
      row("k1", { tierScore: 100, name: "하나" }),
      row("k0", { tierScore: 92, name: "가온식품" }),
    ])).toEqual(["k1", "k0", "k2", "k3"]);
  });

  it("이름은 기본 글자 비교 — 로케일 비교를 쓰지 않는다(맥 LANG 에 따라 순서가 바뀌지 않게)", () => {
    // 로케일 비교면 영문 소문자가 대문자 사이에 끼지만, 기본 비교는 대문자(B) → 소문자(a) 순이다.
    expect(order([row("lower", { name: "a상사" }), row("upper", { name: "B상사" })])).toEqual(["upper", "lower"]);
  });

  it("모든 칸이 같으면 0", () => {
    expect(compareByTier(row("same"), row("same"))).toBe(0);
  });
});
