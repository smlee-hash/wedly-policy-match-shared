import { describe, expect, it, vi } from "vitest";
import { buildProductSources, buildSources, type CollectDeps } from "./index";
import {
  API_SOURCE_NAMES,
  TAIL_SOURCE_NAMES,
  boardSourceNames,
  collectSourceNames,
  productSourceNames,
} from "./source-names";

/**
 * ★조립기(`buildSources`)는 DB·AI·슬랙 주입이 있어야 돈다. 이름만 필요한 곳(수집원 현황판)이
 *  그 주입을 못 만들어 이름 목록을 따로 뒀다 — 그러면 **두 목록이 조용히 갈릴 수 있다.**
 *  이 시험이 그 둘을 실제로 만들어 대조한다.
 */
const stub = {
  askModel: vi.fn(async () => ""),
  jsonCacheGet: vi.fn(async () => null),
  jsonCacheSet: vi.fn(async () => {}),
} as unknown as CollectDeps;

describe("collectSourceNames — 회차 목록과 같은 이름·순서", () => {
  it("게시판 이름이 조립기 결과와 글자·순서까지 같다", () => {
    expect(boardSourceNames()).toEqual(buildSources(stub).map((s) => s.name));
  });

  it("상시 상품 이름이 조립기 결과와 글자·순서까지 같다", () => {
    expect(productSourceNames()).toEqual(buildProductSources(stub).map((s) => s.name));
  });

  it("★전체 순서 = 공공API 4 → 게시판 → 상시 상품 → 고용24(맨 뒤)", () => {
    expect(collectSourceNames()).toEqual([
      ...API_SOURCE_NAMES,
      ...buildSources(stub).map((s) => s.name),
      ...buildProductSources(stub).map((s) => s.name),
      ...TAIL_SOURCE_NAMES,
    ]);
  });

  it("★clockOnly 를 거르지 않는다 — 현황판은 전부를 본다(거르는 곳은 수동 새로고침뿐)", () => {
    const clockOnly = [...buildSources(stub), ...buildProductSources(stub)]
      .filter((s) => s.clockOnly)
      .map((s) => s.name);
    expect(clockOnly.length).toBeGreaterThan(0); // 게시판·상품은 전부 clockOnly 다
    const names = collectSourceNames();
    for (const n of clockOnly) expect(names).toContain(n);
    expect(names).toContain("work24"); // 고용24 도 clockOnly
  });

  it("이름이 겹치지 않는다 — 회차 장부의 단계 이름이라 겹치면 결과가 덮인다", () => {
    const names = collectSourceNames();
    expect(new Set(names).size).toBe(names.length);
  });

  it("조립기를 안 불러도 만들 수 있다 — 주입(CollectDeps) 없이 이름만", () => {
    expect(collectSourceNames().length).toBeGreaterThan(50);
  });
});
