import { beforeEach, describe, expect, it, vi } from "vitest";

// noteSuccess/noteFailureAndMaybeAlert 는 자체 시험(board/alert.test.ts)이 있다 — 여기서는
// registry.ts 가 이 둘을 **올바른 인자로 부르는지**만 본다(배선 시험, 재구현 아님).
const noteSuccessMock = vi.fn();
const noteFailureMock = vi.fn();
vi.mock("../board/alert", () => ({
  noteSuccess: (...a: unknown[]) => noteSuccessMock(...a),
  noteFailureAndMaybeAlert: (...a: unknown[]) => noteFailureMock(...a),
}));
vi.mock("../board/alert-slack", () => ({
  sendPolicyBoardAlert: vi.fn(),
}));

import { PRODUCT_SOURCES, productSyncSources } from "./registry";
import { SOURCE_DIRECTORY } from "../../funding/source-directory";
import type { NormalizedProduct, ProductSource } from "./types";
import type { CollectDeps } from "../types";

// 주입 스텁 — 등록부가 JsonCache 를 CollectDeps 로 받는다(P3-B2). 이 시험은 alert 두 함수를
// 통째로 흉내내므로 productAlertStore 의 실제 읽기·쓰기는 안 일어난다 — 형태만 갖춘다.
const deps: Pick<CollectDeps, "jsonCacheGet" | "jsonCacheSet"> = {
  jsonCacheGet: async () => null,
  jsonCacheSet: async () => {},
};

const fake = (id: string): ProductSource => ({
  id,
  label: id,
  url: `https://${id}.test`,
  fetchAll: async (): Promise<NormalizedProduct[]> => [],
});

beforeEach(() => {
  noteSuccessMock.mockReset();
  noteFailureMock.mockReset();
});

describe("상시 상품 수집원 명부", () => {
  it("기본 인자는 PRODUCT_SOURCES — 등록한 만큼만 회차에 실린다(Task 14 로 7개 + P2 w6 카카오뱅크, manual 제외)", () => {
    expect(Array.isArray(PRODUCT_SOURCES)).toBe(true);
    expect(productSyncSources(deps).map((s) => s.name)).toEqual(PRODUCT_SOURCES.map((s) => s.id));
  });

  it("★8개 어댑터가 전부 등록됐고, 전부 접두어 product- 다 — manual 은 회차에 안 넣는다(계획서 리뷰 대장 #4)", () => {
    const ids = PRODUCT_SOURCES.map((s) => s.id).sort();
    expect(ids).toEqual(
      [
        "product-finlife-soho",
        "product-hope-return",
        // 2026-09-06 P2 w6 — 카카오뱅크 개인사업자 신용대출(상시 상품)
        "product-kakaobank-soho",
        "product-kbank",
        "product-kinfa",
        "product-kosmes",
        "product-sbiz",
        "product-tips",
      ].sort(),
    );
    expect(ids.every((id) => id.startsWith("product-"))).toBe(true);
    expect(ids).not.toContain("manual");
    expect(ids).not.toContain("product-manual");
  });

  it("회차용으로 감싸면 kind:\"product\" · clockOnly · 이름은 수집원 id 다", () => {
    const wrapped = productSyncSources(deps, [fake("kinfa"), fake("sbiz")]);
    expect(wrapped.map((s) => s.name)).toEqual(["kinfa", "sbiz"]);
    expect(wrapped.every((s) => s.kind === "product")).toBe(true);
    expect(wrapped.every((s) => s.clockOnly === true)).toBe(true);
  });

  it("감싼 뒤에도 원래 fetchAll 이 그대로 불린다", async () => {
    let called = 0;
    const src: ProductSource = { ...fake("kbank"), fetchAll: async () => { called += 1; return []; } };
    const [wrapped] = productSyncSources(deps, [src]);
    await wrapped.fetchAll();
    expect(called).toBe(1);
  });

  it("★성공하면 noteSuccess 를 그 출처 id 로 부른다 — 연속 실패 카운트를 리셋한다(계획서 리뷰 대장 #16)", async () => {
    const [wrapped] = productSyncSources(deps, [fake("kinfa")]);
    const list = await wrapped.fetchAll();
    expect(list).toEqual([]);
    expect(noteSuccessMock).toHaveBeenCalledTimes(1);
    expect(noteSuccessMock.mock.calls[0][0]).toBe("kinfa");
    expect(noteFailureMock).not.toHaveBeenCalled();
  });

  it("★실패하면 noteFailureAndMaybeAlert 를 [id,사유] 로 부르고 원래 오류를 그대로 다시 던진다 — sync.ts 의 실패 집계가 그대로 살아 있어야 한다", async () => {
    const failing: ProductSource = { ...fake("kbank"), fetchAll: async () => { throw new Error("타임아웃"); } };
    const [wrapped] = productSyncSources(deps, [failing]);
    await expect(wrapped.fetchAll()).rejects.toThrow("타임아웃");
    expect(noteFailureMock).toHaveBeenCalledTimes(1);
    expect(noteFailureMock.mock.calls[0][0]).toBe("kbank");
    expect(noteFailureMock.mock.calls[0][1]).toBe("타임아웃");
    expect(noteSuccessMock).not.toHaveBeenCalled();
  });

  it("★상품 수집원 id 는 전부 명부(SOURCE_DIRECTORY)에 있어야 한다 — 없으면 현황판에서 사라진다", () => {
    const ids = new Set(SOURCE_DIRECTORY.filter((s) => s.id).map((s) => s.id));
    for (const s of PRODUCT_SOURCES) expect(ids.has(s.id), `명부에 없는 상품 출처: ${s.id}`).toBe(true);
  });

  it("★상품 수집원 id 끼리 겹치지 않는다 — 겹치면 뒤엣것이 앞엣것 상품을 통째로 끈다", () => {
    const ids = PRODUCT_SOURCES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
