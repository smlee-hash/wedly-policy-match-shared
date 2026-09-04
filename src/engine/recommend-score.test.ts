import { describe, expect, it } from "vitest";
import { bucketOf, scoreOf, compareRecommend, fitVerdictOf } from "./recommend-score";
import type { ConditionCheck } from "./structure-types";

const NOW = new Date("2026-08-29T00:00:00Z");
const pass = { verdict: "pass" } as ConditionCheck;
const fail = { verdict: "fail" } as ConditionCheck;
const unknown = { verdict: "unknown" } as ConditionCheck;
const D = (s: string | null) => (s ? new Date(s) : null);

describe("구획", () => {
  it("접수중(마감 미래) → open, 상시(마감 없음) → always, 곧 시작 → upcoming", () => {
    expect(bucketOf(D("2026-08-01"), D("2026-09-10"), NOW)).toBe("open");
    expect(bucketOf(D("2026-08-01"), null, NOW)).toBe("always");
    expect(bucketOf(null, null, NOW)).toBe("always");
    expect(bucketOf(D("2026-09-05"), D("2026-09-30"), NOW)).toBe("upcoming"); // 시작이 미래면 마감 있어도 upcoming
  });
});

describe("점수", () => {
  it("일치 +15, 불일치 -40, 확인필요 0, 기본 50", () => {
    expect(scoreOf([pass, pass, unknown])).toBe(80);
    expect(scoreOf([pass, fail])).toBe(25);
  });
  it("조건 0개는 40 — 일치 1개(65)보다 아래, 불일치(10)보다 위", () => {
    expect(scoreOf([])).toBe(40);
    expect(scoreOf([fail])).toBe(10);
  });
});

describe("정렬", () => {
  const item = (bucket: "open" | "always" | "upcoming", score: number, end: string | null) =>
    ({ bucket, score, applyEnd: D(end) });
  it("구획 → 점수 → 마감임박 순", () => {
    const list = [
      item("always", 90, null),
      item("open", 50, "2026-09-01"),
      item("open", 80, "2026-09-20"),
      item("open", 80, "2026-09-02"),
      item("upcoming", 95, "2026-10-01"),
    ].sort(compareRecommend);
    expect(list.map((x) => `${x.bucket}:${x.score}`)).toEqual([
      "open:80", "open:80", "open:50", "always:90", "upcoming:95",
    ]);
    // 동점 80 둘은 마감 빠른 쪽이 앞
    expect(list[0].applyEnd?.toISOString().slice(0, 10)).toBe("2026-09-02");
  });
});

describe("맞음 판정(fitVerdictOf)", () => {
  const c = (verdict: "pass" | "fail" | "unknown") => ({ condition: { key: "region", op: "in", value: ["전북"], rawText: "", machineReadable: true }, verdict, note: "" }) as never;
  const corp = (verdict: "pass" | "fail" | "unknown") => ({ condition: { key: "isCorporation", op: "eq", value: true, rawText: "", machineReadable: true }, verdict, note: "" }) as never;
  const seoul = (verdict: "pass" | "fail" | "unknown") => ({ condition: { key: "region", op: "in", value: ["서울"], rawText: "", machineReadable: true }, verdict, note: "" }) as never;
  const scale = (verdict: "pass" | "fail" | "unknown") => ({ condition: { key: "companyScale", op: "in", value: ["소상공인"], rawText: "", machineReadable: true }, verdict, note: "" }) as never;
  it("불일치가 하나라도 있으면 excluded — 일치가 있어도 탈락", () => {
    expect(fitVerdictOf([c("pass"), c("fail")])).toBe("excluded");
  });
  it("일치 1개 이상 + 불일치 0 = fit", () => {
    expect(fitVerdictOf([c("pass"), c("unknown")])).toBe("fit");
  });
  it("조건 0개·확인필요뿐이면 unverified", () => {
    expect(fitVerdictOf([])).toBe("unverified");
    expect(fitVerdictOf([c("unknown")])).toBe("unverified");
  });
  it("법인 여부(isCorporation) pass 단독은 「전국」 pass 처럼 단독으로는 fit 근거가 못 된다 — unverified", () => {
    expect(fitVerdictOf([corp("pass")])).toBe("unverified");
  });
  it("법인 여부 pass + 구체 지역(서울) pass 가 함께 있으면 fit", () => {
    expect(fitVerdictOf([corp("pass"), seoul("pass")])).toBe("fit");
  });
  it("기업 규모(companyScale) pass 단독도 「전국」·법인 여부처럼 단독으로는 fit 근거가 못 된다 — unverified(F3 코덱스: 희망리턴처럼 규모만 맞은 상품이 fit 으로 뜨던 자리)", () => {
    expect(fitVerdictOf([scale("pass")])).toBe("unverified");
  });
  it("기업 규모 pass + 구체 지역(서울) pass 가 함께 있으면 fit", () => {
    expect(fitVerdictOf([scale("pass"), seoul("pass")])).toBe("fit");
  });
});
