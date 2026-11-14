// 보는 범위(scope) — 앱이 정한 모양대로 업체를 거르고, 빈 열쇠는 DB 를 부르지 않는다.
import { describe, expect, it, vi } from "vitest";
import { DeadlineReadError, readScope, scopeAllows, type DeadlineScope } from "./scope";
import type { ReadCompany, ReadSource } from "./types";

function company(customerKey: string, readConsultantIds: string[]): ReadCompany {
  return { customerKey, companyName: customerKey, consultant: "", consultantNames: [], readConsultantIds, statusText: "", profileGaps: [] };
}

const COMPANIES = [company("b:1", ["u1"]), company("b:2", ["u2"]), company("p:3", ["u1", "u2"])];

function source() {
  return {
    companies: vi.fn(async (f: { readerId?: string; customerKeys?: string[] }) =>
      COMPANIES.filter((c) => (f.readerId === undefined || c.readConsultantIds.includes(f.readerId))
        && (f.customerKeys === undefined || f.customerKeys.includes(c.customerKey)))),
  } satisfies Pick<ReadSource, "companies">;
}

describe("readScope", () => {
  it("all — 거르지 않고 모든 업체, 판정·진행 거르기 열쇠는 null", async () => {
    const src = source();
    const result = await readScope({ kind: "all" }, src as unknown as ReadSource);
    expect(src.companies).toHaveBeenCalledWith({});
    expect(result.companies.map((c) => c.customerKey)).toEqual(["b:1", "b:2", "p:3"]);
    expect(result.keys).toBeNull();
  });

  it("reader — 업체의 담당 id 에 내 id 가 든 곳만", async () => {
    const src = source();
    const result = await readScope({ kind: "reader", readerId: "u1" }, src as unknown as ReadSource);
    expect(src.companies).toHaveBeenCalledWith({ readerId: "u1" });
    expect(result.keys).toEqual(["b:1", "p:3"]);
  });

  it("keys — 앱이 정한 업체 열쇠만", async () => {
    const src = source();
    const result = await readScope({ kind: "keys", customerKeys: ["b:2", "x:9"] }, src as unknown as ReadSource);
    expect(src.companies).toHaveBeenCalledWith({ customerKeys: ["b:2", "x:9"] });
    expect(result.companies.map((c) => c.customerKey)).toEqual(["b:2"]);
    expect(result.keys).toEqual(["b:2"]);
  });

  it("keys 가 빈 배열이면 읽는 자리를 부르지 않고 빈 결과 — 「거르지 않음」으로 읽히지 않는다", async () => {
    const src = source();
    const result = await readScope({ kind: "keys", customerKeys: [] }, src as unknown as ReadSource);
    expect(src.companies).not.toHaveBeenCalled();
    expect(result).toEqual({ companies: [], keys: [] });
  });
});

describe("scopeAllows", () => {
  const bOne = company("b:1", ["u1"]);
  const cases: Array<[DeadlineScope, boolean]> = [
    [{ kind: "all" }, true],
    [{ kind: "reader", readerId: "u1" }, true],
    [{ kind: "reader", readerId: "u2" }, false],
    [{ kind: "keys", customerKeys: ["b:1"] }, true],
    [{ kind: "keys", customerKeys: ["b:2"] }, false],
    [{ kind: "keys", customerKeys: [] }, false],
  ];
  for (const [scope, want] of cases) {
    it(`${JSON.stringify(scope)} → ${want}`, () => {
      expect(scopeAllows(scope, bOne)).toBe(want);
    });
  }
});

describe("DeadlineReadError", () => {
  it("status·code·message 를 그대로 지닌다", () => {
    const error = new DeadlineReadError(403, "FORBIDDEN", "관리자만 전체를 봅니다.");
    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({ name: "DeadlineReadError", status: 403, code: "FORBIDDEN", message: "관리자만 전체를 봅니다." });
  });
});
