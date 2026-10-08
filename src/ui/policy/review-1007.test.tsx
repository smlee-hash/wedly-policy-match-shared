/**
 * 2026-10-07 독립 리뷰(정책매칭 결과 화면 개편) 지적 7건의 회귀 시험.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { GROUP_TOP_N, deadlineOfAnnouncement, groupBlocks, topPerVerdict, whereWords, type FundingItem } from "../../funding/funding-map";
import type { FundingMapPayload } from "../FundingMap";
import { downloadAttachmentsInOrder, isOwnAttachmentUrl, scheduleOf, shortAmountOf, summaryCellsOf } from "./detail-structured";
import {
  INITIAL_ONE_LIST_STATE, oneListViewOf, serverCountsForQuery, serverVerdictCountsOf,
} from "./result-one-list";
import {
  PROFILE_STORAGE_KEY, bootPlanOf, dropUnscopedProfile, readStoredProfile, scopedProfileStorage, writeStoredProfile,
} from "./step-state";

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

  // 옛 시험(어려움 탭의 미확인 안 맞음 3건이 갈래 칩에 안 잡힘)을 바꾼 이유: 안 맞음은 이제 탭이 없다 —
  // 같은 입력이 어느 탭·칩·숫자에도 안 잡히는지로 대신 잰다.
  it("미확인 안 맞음 3건은 어느 탭·칩·숫자에도 안 잡힌다(서버가 자르기 전에 센 안 맞음 수도 쓰지 않는다)", () => {
    const items = Array.from({ length: 3 }, (_, i) => item({ refId: `x${i}`, fitVerdict: "excluded", unclassified: true }));
    const p = payloadOf(items);
    const server = serverVerdictCountsOf(p)!;
    expect(server.tab).toEqual({ fit: 0, unverified: 0 });
    for (const tab of ["fit", "unverified"] as const) {
      const v = oneListViewOf(flat(p), { ...INITIAL_ONE_LIST_STATE, tab }, "", server);
      expect(v.counts).toEqual({ fit: 0, unverified: 0 });
      expect(v.list).toEqual([]);
      expect(v.chips.every((c) => c.count === 0)).toBe(true);
    }
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
    // 안 맞음 미확인 3건은 받은 줄에 섞여 와도 어느 탭·숫자에도 안 잡힌다(어려움 탭이 없어졌다)
    expect(v.counts.fit).toBe(0);
    expect(v.list.every((x) => x.fitVerdict === "unverified")).toBe(true);
  });

  it("옛 서버 답에서 미확인 줄이 상한 밖으로 잘려 안 보여도 서버 셈을 쓰지 않는다(재리뷰 10/7 세 번째)", () => {
    // 옛 시험은 안 맞음 줄로 어려움 탭 칩을 쟀다 — 탭이 없어졌으니 확인 필요 줄로 같은 모양을 잰다.
    const items = [
      ...Array.from({ length: GROUP_TOP_N }, (_, i) => item({ refId: `e${i}`, fitVerdict: "unverified", score: 1000 - i })),
      ...Array.from({ length: 3 }, (_, i) => item({ refId: `x${i}`, fitVerdict: "unverified", unclassified: true, score: 1 })),
    ];
    const p = payloadOf(items);
    for (const b of p.groups) delete (b as { unclassifiedCounts?: unknown }).unclassifiedCounts;
    expect(serverVerdictCountsOf(p)).toBeNull();
    const ex = oneListViewOf(flat(p), { ...INITIAL_ONE_LIST_STATE, tab: "unverified" }, "", serverVerdictCountsOf(p));
    expect(ex.chips.find((c) => c.key === "grant")?.count ?? 0, "칩은 실제로 받은 분류된 줄 수를 넘지 않는다")
      .toBeLessThanOrEqual(GROUP_TOP_N);
  });

  it("새 서버 답(모든 갈래에 미확인 집계 칸)은 서버 셈을 그대로 쓴다", () => {
    const p = payloadOf([item({ refId: "a" })]);
    expect(p.groups.every((b) => b.unclassifiedCounts)).toBe(true);
    expect(serverVerdictCountsOf(p)).not.toBeNull();
  });
});

describe("ERP 독립 리뷰 10/7 — P1 사용자 간 저장값·P2 세 건", () => {
  it("맞음 80건 + 확인 필요 1건 → 확인 필요 탭이 빈 목록이 아니다(판정마다 따로 80건)", () => {
    const items = [
      ...Array.from({ length: 80 }, (_, i) => item({ refId: `f${i}`, fitVerdict: "fit", score: 10_000 - i })),
      item({ refId: "u0", fitVerdict: "unverified", score: 1 }),
    ];
    const p = payloadOf(items);
    const v = oneListViewOf(flat(p), { ...INITIAL_ONE_LIST_STATE, tab: "unverified" }, "", serverVerdictCountsOf(p));
    expect(v.counts.unverified).toBe(1);
    expect(v.list.map((x) => x.refId)).toEqual(["u0"]);
    const fit = oneListViewOf(flat(p), { ...INITIAL_ONE_LIST_STATE, tab: "fit" }, "", serverVerdictCountsOf(p));
    expect(fit.list.length).toBe(80);
  });

  it("topPerVerdict — 순서를 지키며 판정마다 앞 N건만", () => {
    const sorted = [
      item({ refId: "a", fitVerdict: "fit" }), item({ refId: "b", fitVerdict: "unverified" }),
      item({ refId: "c", fitVerdict: "fit" }), item({ refId: "d", fitVerdict: "unverified" }),
      item({ refId: "e", fitVerdict: "fit" }),
    ];
    expect(topPerVerdict(sorted, 2).map((x) => x.refId)).toEqual(["a", "b", "c", "d"]);
  });

  it("한 판정만 상한을 넘어도 truncated", () => {
    const items = [
      ...Array.from({ length: 3 }, (_, i) => item({ refId: `f${i}`, fitVerdict: "fit" })),
      ...Array.from({ length: GROUP_TOP_N + 1 }, (_, i) => item({ refId: `u${i}`, fitVerdict: "unverified" })),
    ];
    const grant = groupBlocks(items).find((b) => b.group === "grant")!;
    expect(grant.truncated).toBe(true);
    expect(grant.items.length).toBe(3 + GROUP_TOP_N);
  });

  function 가짜저장소() {
    const m = new Map<string, string>();
    return {
      m,
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
      removeItem: (k: string) => void m.delete(k),
    };
  }

  it("저장값은 사용자마다 따로 — 앞사람이 남긴 고객 정보를 다른 사람이 읽지 못한다", () => {
    const raw = 가짜저장소();
    const a = scopedProfileStorage(raw, "user-a")!;
    writeStoredProfile(a, { companyName: "앞 사용자 고객", employeeCount: 3 } as never);
    expect(readStoredProfile(a)).not.toBeNull();
    expect(readStoredProfile(scopedProfileStorage(raw, "user-b"))).toBeNull();
    expect(bootPlanOf("?step=result", scopedProfileStorage(raw, "user-b")).kind).toBe("company");
    expect(bootPlanOf("?step=result", a).kind).toBe("rediagnose");
    // 이름 없는 옛 칸에는 쓰지 않는다
    expect(raw.m.has(PROFILE_STORAGE_KEY)).toBe(false);
  });

  it("사용자 구분값이 없으면 저장·복원을 아예 안 한다", () => {
    expect(scopedProfileStorage(가짜저장소(), undefined)).toBeNull();
    expect(scopedProfileStorage(가짜저장소(), "  ")).toBeNull();
    expect(scopedProfileStorage(null, "user-a")).toBeNull();
  });

  it("옛 이름 없는 칸은 지운다", () => {
    const raw = 가짜저장소();
    raw.setItem(PROFILE_STORAGE_KEY, "{}");
    dropUnscopedProfile(raw);
    expect(raw.m.has(PROFILE_STORAGE_KEY)).toBe(false);
    expect(() => dropUnscopedProfile(null)).not.toThrow();
  });

  it("추천 카드·표의 「어디에 신청」은 수집원 수를 드러내지 않는다 — 서랍만 관리자에게", () => {
    const 지도글 = readFileSync(new URL("../FundingMap.tsx", import.meta.url), "utf8");
    const 서랍글 = readFileSync(new URL("../FundingDrawer.tsx", import.meta.url), "utf8");
    for (const m of 지도글.matchAll(/whereWords\(([^)]*)\)/g)) expect(m[1], "지도 카드가 수집원 수를 켠다").not.toContain(",");
    expect(서랍글).toContain("whereWords(item, showSources)");
    expect(whereWords(item({ refId: "w", agency: "접수기관", groupSources: 3 }))).toBe("접수기관");
  });
});

describe("ERP 재리뷰 10/7 — P2 두 건", () => {
  // 옛 시험은 어려움 탭으로 쟀다. 탭이 없어졌으니 같은 일을 확인 필요 탭으로 잰다(미확인 80건이 앞서도 분류된 1건이 안 사라진다).
  it("확인 필요 탭: 종류 미확인 80건이 앞서 있어도 무상지원금 1건이 목록에서 사라지지 않는다", () => {
    const items = [
      ...Array.from({ length: GROUP_TOP_N }, (_, i) =>
        item({ refId: `u${i}`, fitVerdict: "unverified", unclassified: true, score: 10_000 - i })),
      item({ refId: "g0", fitVerdict: "unverified", score: 1 }),
    ];
    const p = payloadOf(items);
    const v = oneListViewOf(flat(p), { ...INITIAL_ONE_LIST_STATE, tab: "unverified", chip: "grant" }, "", serverVerdictCountsOf(p));
    expect(v.chips.find((c) => c.key === "grant")?.count).toBe(1);
    expect(v.list.map((x) => x.refId)).toEqual(["g0"]);
  });

  it("「상시접수(예산 소진 시까지)」는 마감일 없는 상시가 아니라 예산 소진 시 마감으로 안내한다", () => {
    const now = new Date("2026-10-07T03:00:00Z");
    const text = "상시접수(예산 소진 시까지)";
    const cells = summaryCellsOf({ supportAmountText: "", applyStart: null, applyEnd: null, applyPeriodText: text, now });
    expect(cells[1].value).toBe("예산 소진 시");
    expect(cells[1].sub).not.toContain("마감일 없음");
    const s = scheduleOf({ applyStart: null, applyEnd: null, applyPeriodText: text, now });
    expect(s).toEqual({ kind: "line", text: expect.stringContaining("예산") });
    expect(JSON.stringify(s)).not.toContain("마감일이 없어요");
    // 진짜 상시는 그대로
    expect(summaryCellsOf({ supportAmountText: "", applyStart: null, applyEnd: null, applyPeriodText: "상시 접수", now })[1].value).toBe("상시");
  });
});

describe("ERP 재리뷰 10/7 — 공용 재리뷰 P2 세 건", () => {
  const now = new Date("2026-10-07T03:00:00Z");

  it("「예산이 소진될 때까지」처럼 조사·활용형이 붙어도 예산 소진으로 읽는다(목록 분류와 상세 모두)", () => {
    for (const text of ["상시접수(예산이 소진될 때까지)", "예산 소진 시까지", "예산의 소진 시 마감", "상시(소진 시 마감)"]) {
      expect(deadlineOfAnnouncement(null, text, now).kind).toBe("budget");
      const cells = summaryCellsOf({ supportAmountText: "", applyStart: null, applyEnd: null, applyPeriodText: text, now });
      expect(cells[1].value).toBe("예산 소진 시");
      expect(JSON.stringify(scheduleOf({ applyStart: null, applyEnd: null, applyPeriodText: text, now }))).not.toContain("마감일이 없어요");
    }
    expect(deadlineOfAnnouncement(null, "상시 접수", now).kind).toBe("always");
  });

  it("마감 날짜와 예산 조건이 함께 있으면 날짜를 유지하면서 조기 마감 안내도 붙인다", () => {
    const text = "2026-10-01 ~ 2026-12-31 (예산 소진 시 조기 마감)";
    const input = { applyStart: "2026-10-01T00:00:00Z", applyEnd: "2026-12-31T14:59:59Z", applyPeriodText: text, now };
    const cells = summaryCellsOf({ supportAmountText: "", ...input });
    expect(cells[1].value).toMatch(/^D-\d+$/);
    expect(cells[1].sub).toContain("예산 소진 시 조기 마감");
    const s = scheduleOf(input);
    expect(s.kind).toBe("bar");
    expect(s.kind === "bar" && s.note).toContain("예산");
    // 예산 조건이 없으면 안내도 없다
    const plain = scheduleOf({ ...input, applyPeriodText: "2026-10-01 ~ 2026-12-31" });
    expect(plain.kind === "bar" && plain.note).toBeFalsy();
    expect(summaryCellsOf({ supportAmountText: "", ...input, applyPeriodText: "" })[1].sub).not.toContain("예산");
  });

  it("어려움 줄을 나눠 자른 뒤에도 고른 정렬(마감순)이 지켜진다", () => {
    const items = [
      item({ refId: "c20", fitVerdict: "excluded", deadline: { kind: "date", date: "2026-10-27", text: "", dDay: 20 } }),
      item({ refId: "u1", fitVerdict: "excluded", unclassified: true, deadline: { kind: "date", date: "2026-10-08", text: "", dDay: 1 } }),
    ];
    const grant = groupBlocks(items, { includeExcluded: true, sort: "dead" }).find((b) => b.group === "grant")!;
    expect(grant.excludedItems!.map((x) => x.refId)).toEqual(["u1", "c20"]);
  });
});
