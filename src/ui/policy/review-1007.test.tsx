/**
 * 2026-10-07 독립 리뷰(정책매칭 결과 화면 개편) 지적 7건의 회귀 시험.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { GROUP_TOP_N, groupBlocks, type FundingItem } from "../../funding/funding-map";
import type { FundingMapPayload } from "../FundingMap";
import { downloadAttachmentsInOrder, isOwnAttachmentUrl, shortAmountOf } from "./detail-structured";
import {
  INITIAL_ONE_LIST_STATE, oneListViewOf, serverCountsForQuery, serverVerdictCountsOf,
} from "./result-one-list";

function item(over: Partial<FundingItem> & { refId: string }): FundingItem {
  return {
    id: `a:${over.refId}`, kind: "announcement", group: "grant", title: `지원 공고 ${over.refId}`,
    agency: "가상테크노파크", url: "https://example.kr/a", applyUrl: "", targetText: "", amountText: "",
    amountMaxWon: null, rateText: "", rateMin: null,
    deadline: { kind: "date", date: "2026-10-25", text: "", dDay: 20 },
    where: "", fit: [], fitVerdict: "fit", humanCheck: 0, score: 1000, why: "", source: "smes24", isNew: false,
    ...over,
  };
}

function payloadOf(items: FundingItem[], query = ""): FundingMapPayload {
  const groups = groupBlocks(items, { includeExcluded: true, query });
  return { groups, search: { query, tab: "all" } } as unknown as FundingMapPayload;
}

const flat = (p: FundingMapPayload) =>
  p.groups.flatMap((b) => [...b.items, ...(b.excludedItems ?? [])]);

describe("① 「종류 미확인」 줄도 판정 탭 숫자에 들어가고, 갈래 칩에서는 빠진다", () => {
  it("분류된 확인 필요 100 + 미확인 10 → 탭 110", () => {
    const items = [
      ...Array.from({ length: 100 }, (_, i) => item({ refId: `c${i}`, fitVerdict: "unverified", score: 1000 - i })),
      ...Array.from({ length: 10 }, (_, i) => item({ refId: `u${i}`, fitVerdict: "unverified", unclassified: true })),
    ];
    const p = payloadOf(items);
    const v = oneListViewOf(flat(p), { ...INITIAL_ONE_LIST_STATE, tab: "unverified" }, "", serverVerdictCountsOf(p));
    expect(v.counts.unverified).toBe(110);
    expect(v.cut).not.toBeNull(); // 받은 줄은 80+10
  });

  it("미확인만 100건이면 탭 100 · 잘림 안내가 뜬다", () => {
    const items = Array.from({ length: 100 }, (_, i) => item({ refId: `u${i}`, fitVerdict: "fit", unclassified: true, score: 1000 - i }));
    const p = payloadOf(items);
    const v = oneListViewOf(flat(p), INITIAL_ONE_LIST_STATE, "", serverVerdictCountsOf(p));
    expect(v.counts.fit).toBe(100);
    expect(v.list.length).toBe(GROUP_TOP_N);
    expect(v.cut).toEqual({ loaded: GROUP_TOP_N, total: 100 });
  });

  it("미확인 안 맞음 3건은 갈래 칩에 세지 않는다(칩 숫자 3 · 목록 0 이 되지 않게)", () => {
    const items = Array.from({ length: 3 }, (_, i) => item({ refId: `x${i}`, fitVerdict: "excluded", unclassified: true }));
    const p = payloadOf(items);
    const v = oneListViewOf(flat(p), { ...INITIAL_ONE_LIST_STATE, tab: "excluded" }, "", serverVerdictCountsOf(p));
    expect(v.counts.excluded).toBe(3);
    expect(v.chips.find((c) => c.key === "grant")?.count ?? 0).toBe(0);
  });

  it("서버 묶음은 미확인 판정별 수를 늘 싣는다", () => {
    const b = groupBlocks([
      item({ refId: "1", fitVerdict: "fit", unclassified: true }),
      item({ refId: "2", fitVerdict: "unverified", unclassified: true }),
      item({ refId: "3", fitVerdict: "excluded", unclassified: true }),
      item({ refId: "4", fitVerdict: "fit" }),
    ], { includeExcluded: true }).find((g) => g.group === "grant")!;
    expect(b.unclassifiedCounts).toEqual({ fit: 1, unverified: 1, excluded: 1 });
    expect(b.fit).toBe(1);
  });
});

describe("④ 찾기 요청이 실패해 이전 답이 남아 있으면 그 서버 셈을 새 찾기어에 붙이지 않는다", () => {
  it("답의 찾기어와 지금 찾기어가 다르면 null", () => {
    const p = payloadOf(Array.from({ length: 100 }, (_, i) => item({ refId: `c${i}` })));
    expect(serverCountsForQuery(p, "")).not.toBeNull();
    expect(serverCountsForQuery(p, "없는낱말")).toBeNull();
    const v = oneListViewOf(flat(p), INITIAL_ONE_LIST_STATE, "없는낱말", serverCountsForQuery(p, "없는낱말"));
    expect(v.counts.fit).toBe(0);
    expect(v.cut).toBeNull();
  });
});

describe("② ③ 첨부 모두 받기 — 외부 주소는 요청하지 않고, 넘김·HTML·JSON 답은 실패", () => {
  const ok = (type: string) => new Response("x", { status: 200, headers: { "content-type": type } });

  it("외부 출처 주소는 fetch 자체를 하지 않는다", async () => {
    const fetchFn = vi.fn(async () => ok("application/pdf"));
    const save = vi.fn();
    const r = await downloadAttachmentsInOrder(
      [{ name: "a.pdf", url: "https://other.example/a.pdf", kind: "pdf" }, { name: "b.pdf", url: "/api/x/1", kind: "pdf" }],
      { fetchFn: fetchFn as unknown as typeof fetch, save, origin: "https://erp.example" },
    );
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect((fetchFn.mock.calls[0] as unknown[])[0]).toBe("/api/x/1");
    expect((fetchFn.mock.calls[0] as unknown[])[1]).toMatchObject({ redirect: "manual" });
    expect(r).toMatchObject({ saved: 1, failed: 1 });
  });

  it("같은 출처의 절대 주소는 받고, // 로 시작하는 주소는 외부로 본다", () => {
    expect(isOwnAttachmentUrl("https://erp.example/api/a", "https://erp.example")).toBe(true);
    expect(isOwnAttachmentUrl("//other.example/a", "https://erp.example")).toBe(false);
    expect(isOwnAttachmentUrl("https://other.example/a", null)).toBe(false);
  });

  it.each(["text/html; charset=utf-8", "application/problem+json", "application/json"])("%s 답은 실패로 센다", async (type) => {
    const save = vi.fn();
    const r = await downloadAttachmentsInOrder([{ name: "a.pdf", url: "/api/x/1", kind: "pdf" }], {
      fetchFn: (async () => ok(type)) as unknown as typeof fetch, save, origin: null,
    });
    expect(save).not.toHaveBeenCalled();
    expect(r).toMatchObject({ saved: 0, failed: 1 });
  });
});

describe("⑤ 금액 요약은 천 단위 쉼표에서 자르지 않는다", () => {
  it.each([
    ["최대 5,000만 원", "최대 5,000만 원"],
    ["기업당 1,500,000원", "기업당 1,500,000원"],
    ["최대 1억 원, 융자 별도", "최대 1억 원"],
  ])("%s → %s", (src, want) => {
    expect(shortAmountOf(src)).toBe(want);
  });
});

describe("⑥ 「다른 회사」 뒤에 늦게 온 진단 답은 버린다", () => {
  const src = readFileSync(new URL("./PolicyMatchScreen.tsx", import.meta.url), "utf8");
  it("진단은 회차 번호를 올리고, 답이 오면 번호가 그대로인지 본 뒤에만 반영한다", () => {
    expect(src).toMatch(/const gen = \+\+diagnoseGen\.current/);
    expect(src).toMatch(/if \(gen !== diagnoseGen\.current\) return false;/);
  });
  it("「다른 회사」는 번호를 올려 나가 있던 답을 버린다", () => {
    const reset = src.slice(src.indexOf("const resetCompany"), src.indexOf("const resetCompany") + 300);
    expect(reset).toMatch(/diagnoseGen\.current \+= 1/);
  });
});

describe("⑦ 칸 안 상품 상세에도 전체 상품명이 있다", () => {
  it("inline 이면 제목을 본문에 그린다", () => {
    const src = readFileSync(new URL("../FundingDrawer.tsx", import.meta.url), "utf8");
    expect(src).toMatch(/\{inline && <div[^>]*>\{item\.title\}<\/div>\}/);
  });
});

describe("재리뷰 10/7 — 남은 두 지적", () => {
  it("겉보기만 상대 경로인 외부 주소는 우리 통로가 아니다", () => {
    const o = "https://erp.example";
    expect(isOwnAttachmentUrl("/\\outside.example/a.pdf", o)).toBe(false);
    expect(isOwnAttachmentUrl("/\\outside.example/a.pdf", null)).toBe(false);
    expect(isOwnAttachmentUrl("\\\\outside.example/a.pdf", o)).toBe(false);
    expect(isOwnAttachmentUrl("/api/files/1", o)).toBe(true);
    expect(isOwnAttachmentUrl("/api/files/1", null)).toBe(true);
  });

  it("외부로 풀리는 첨부는 모두 받기가 요청하지 않는다", async () => {
    const fetchImpl = vi.fn();
    const r = await downloadAttachmentsInOrder(
      [{ name: "a.pdf", url: "/\\outside.example/a.pdf" }] as never,
      { fetchFn: fetchImpl as never, save: () => {}, origin: "https://erp.example" },
    );
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(r).toEqual({ saved: 0, failed: 1, skipped: 0 });
  });

  it("미확인 집계 칸이 없는 옛 서버 답 — 서버 셈을 버리고 받은 줄로 세어 탭·칩·목록이 서로 맞는다", () => {
    const items = [
      ...Array.from({ length: 100 }, (_, i) => item({ refId: `c${i}`, fitVerdict: "unverified", score: 1000 - i })),
      ...Array.from({ length: 10 }, (_, i) => item({ refId: `u${i}`, fitVerdict: "unverified", unclassified: true })),
      ...Array.from({ length: 3 }, (_, i) => item({ refId: `x${i}`, fitVerdict: "excluded", unclassified: true })),
    ];
    const p = payloadOf(items);
    for (const b of p.groups) delete (b as { unclassifiedCounts?: unknown }).unclassifiedCounts;
    expect(serverVerdictCountsOf(p), "옛 답에는 서버 셈을 쓰지 않는다").toBeNull();
    const v = oneListViewOf(flat(p), { ...INITIAL_ONE_LIST_STATE, tab: "unverified" }, "", serverVerdictCountsOf(p));
    expect(v.counts.unverified, "받은 줄(80+10)과 탭이 맞는다").toBe(90);
    const ex = oneListViewOf(flat(p), { ...INITIAL_ONE_LIST_STATE, tab: "excluded" }, "", serverVerdictCountsOf(p));
    expect(ex.counts.excluded).toBe(3);
    expect(ex.chips.find((c) => c.key === "grant")?.count ?? 0).toBe(0);
  });

  it("옛 서버 답에서 미확인 줄이 상한 밖으로 잘려 안 보여도 서버 셈을 쓰지 않는다(재리뷰 10/7 세 번째)", () => {
    const items = [
      ...Array.from({ length: GROUP_TOP_N }, (_, i) => item({ refId: `e${i}`, fitVerdict: "excluded", score: 1000 - i })),
      ...Array.from({ length: 3 }, (_, i) => item({ refId: `x${i}`, fitVerdict: "excluded", unclassified: true, score: 1 })),
    ];
    const p = payloadOf(items);
    for (const b of p.groups) delete (b as { unclassifiedCounts?: unknown }).unclassifiedCounts;
    expect(serverVerdictCountsOf(p)).toBeNull();
    const ex = oneListViewOf(flat(p), { ...INITIAL_ONE_LIST_STATE, tab: "excluded" }, "", serverVerdictCountsOf(p));
    expect(ex.chips.find((c) => c.key === "grant")?.count ?? 0, "칩은 실제로 받은 분류된 줄 수를 넘지 않는다")
      .toBeLessThanOrEqual(GROUP_TOP_N);
  });

  it("새 서버 답(모든 갈래에 미확인 집계 칸)은 서버 셈을 그대로 쓴다", () => {
    const p = payloadOf([item({ refId: "a" })]);
    expect(p.groups.every((b) => b.unclassifiedCounts)).toBe(true);
    expect(serverVerdictCountsOf(p)).not.toBeNull();
  });
});
