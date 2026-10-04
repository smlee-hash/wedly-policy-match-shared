// 재리뷰(Astra 8차) BF9 — 한 줄 매출 라벨 상한을 없애도 당기 매출을 읽고, 라벨을 되풀이한 줄이 오래 걸리지 않는다.
// ★표본은 전부 지어낸 값이다.

import { describe, expect, it } from "vitest";
import { readDocuments } from "./index";
import { parseFinancial } from "./parse-financial";
import { txtOf } from "./__fixtures__/samples";

const fs = (text: string) => parseFinancial({ text }, "financial-statement");

function timed<T>(run: () => T): { value: T; ms: number } {
  const started = performance.now();
  const value = run();
  return { value, ms: performance.now() - started };
}

describe("BF9-1 비율 라벨이 넷 넘게 앞에 있어도 같은 줄의 당기 매출을 읽는다", () => {
  it("리뷰 표본 — 당기 1,000,000 (전기 900,000 이 아니다)", () => {
    const text = [
      "손익계산서",
      "당기: 매출액 증가율 5% 매출액 영업이익률 6% 매출액 순이익률 7% 매출액 총이익률 8% 매출액 1,000,000",
      "전기: 매출액 900,000",
    ].join("\n");
    expect(fs(text).fields.lastYearRevenueKrw).toBe(1_000_000);
  });

  it("공개 진입점에서도 같은 값", async () => {
    const text = [
      "손익계산서",
      "당기: 매출액 증가율 5% 매출액 영업이익률 6% 매출액 순이익률 7% 매출액 총이익률 8% 매출액 1,000,000",
      "전기: 매출액 900,000",
    ].join("\n");
    const r = await readDocuments([{ name: "재무제표.txt", bytes: txtOf(text) }]);
    expect(r.fields.lastYearRevenueKrw).toBe(1_000_000);
  });

  it("비율 라벨 100개 뒤의 금액도 읽는다", () => {
    const text = `손익계산서\n${"매출액 증가율 5% ".repeat(100)}매출액 1,234,000`;
    expect(fs(text).fields.lastYearRevenueKrw).toBe(1_234_000);
  });
});

describe("BF9-2 라벨을 수만 번 되풀이한 줄도 빨리 끝난다", () => {
  const cases: Array<[string, string, number | undefined]> = [
    ["금액 없는 라벨 24,000번 뒤 금액", `손익계산서\n${"매출액 증가율 ".repeat(24_000)}매출액 1,000`, 1_000],
    ["괄호 음수 24,000번", `손익계산서\n${"매출액 (1) ".repeat(24_000)}`, undefined],
    ["상한 넘는 금액 24,000번", `손익계산서\n${"매출액 9999999999999999 ".repeat(24_000)}`, undefined],
    ["코드 모양 숫자 24,000번", `손익계산서\n${"매출액 01 ".repeat(24_000)}`, undefined],
    ["라벨 하나 뒤 코드 모양 숫자 50,000개", `손익계산서\n매출액 ${"01 ".repeat(50_000)}`, undefined],
    [
      "코드 열 머리글 아래 라벨 24,000번",
      `손익계산서\n과목\t코드\t비고\n${"매출액 ".repeat(24_000)}\t0101\t메모`,
      undefined,
    ],
    [
      "당기 열 머리글 아래 라벨 24,000번(빈 금액 칸)",
      `손익계산서\n과목\t당기\t전기\n${"매출액 (1) ".repeat(24_000)}\t\t900`,
      undefined,
    ],
  ];
  for (const [name, text, expected] of cases) {
    it(name, () => {
      const { value, ms } = timed(() => fs(text));
      expect(ms).toBeLessThan(500);
      expect(value.fields.lastYearRevenueKrw).toBe(expected);
    });
  }

  it("되풀이 줄 2,000줄도 빨리 끝난다", () => {
    const text = `손익계산서\n${`${"매출액 증가율 ".repeat(20)}\n`.repeat(2_000)}매출액 5,000`;
    const { value, ms } = timed(() => fs(text));
    expect(ms).toBeLessThan(1500);
    expect(value.fields.lastYearRevenueKrw).toBe(5_000);
  });
});
