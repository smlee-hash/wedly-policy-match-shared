import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GROUP_TOP_N, groupBlocks, parseFundingSearch, type FundingItem } from "../../funding/funding-map";
import type { FundingMapPayload } from "../FundingMap";
import { postFundingMap, type FundingRequest } from "./PolicyMatchScreen";
import {
  FUNDING_QUERY_DELAY_MS, filterFundingData, fundingSearchOf, searchCutOf, type ResultConditions,
} from "./result-conditions";

/**
 * BF3 ⑤ — 화면이 검색어·탭을 서버에 실어 보내고, 서버가 80건으로 자르기 전에 거른다.
 * 이 저장소엔 jsdom 이 없다 — 요청은 가짜 서버(진짜 `groupBlocks`·`parseFundingSearch` 를 낀 fetch)로,
 * 배선은 소스 글자로 잰다. 표본은 전부 가짜 공고다.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

function item(n: number): FundingItem {
  return {
    id: `a:${n}`,
    kind: "announcement",
    refId: String(n),
    group: "grant",
    title: `지원 공고 ${n}`,
    agency: "가상테크노파크",
    url: "https://example.kr/a",
    applyUrl: "",
    targetText: "",
    amountText: "",
    amountMaxWon: null,
    rateText: "",
    rateMin: null,
    deadline: { kind: "date", date: "2026-10-25", text: "", dDay: 20 },
    where: "",
    fit: [],
    fitVerdict: "fit",
    humanCheck: 0,
    score: 1000 - n,
    why: "",
    source: "smes24",
    isNew: false,
  };
}

const 공고81 = Array.from({ length: GROUP_TOP_N + 1 }, (_, i) => item(i + 1));
const 필터 = { openOnly: false, soonOnly: false, includeExcluded: false };
const 기본요청: FundingRequest = { profile: {}, filters: 필터, sort: "rec" };

/** 진짜 서버 규칙(요청 검사 + groupBlocks)을 낀 가짜 통로. 잘못된 요청은 400 처럼 실패 응답을 준다. */
function 가짜서버() {
  const 받은본문: Array<Record<string, unknown>> = [];
  const fn = vi.fn(async (_url: string, init?: { body?: string }) => {
    const body = JSON.parse(String(init?.body)) as { query?: unknown; tab?: unknown; sort?: "rec"; topN?: number };
    받은본문.push(body);
    const search = parseFundingSearch(body);
    if (!search.ok) return { json: async () => ({ success: false, error: { code: "BAD_REQUEST", message: search.message } }) };
    const data: FundingMapPayload = {
      groups: groupBlocks(공고81, { sort: body.sort, topN: body.topN, query: search.query, tab: search.tab }),
      glance: { open: 0, soon: 0, grantFit: 0, grantMaxWon: null, minRate: null },
      profileGaps: [],
      unclassified: 0,
      generatedAt: "2026-10-05T00:00:00.000Z",
    };
    return { json: async () => ({ success: true, data }) };
  });
  vi.stubGlobal("fetch", fn);
  return { fn, 받은본문 };
}

describe("postFundingMap — 검색어·탭을 요청 본문에 싣는다", () => {
  it("걸린 것만 싣는다 — 검색어가 비었거나 탭이 「전체」면 칸 자체가 없다", async () => {
    const { 받은본문 } = 가짜서버();
    await postFundingMap(기본요청, "/api/x");
    await postFundingMap({ ...기본요청, query: "   ", tab: "all" }, "/api/x");
    expect(받은본문[0]).not.toHaveProperty("query");
    expect(받은본문[0]).not.toHaveProperty("tab");
    expect(받은본문[1]).not.toHaveProperty("query");
    expect(받은본문[1]).not.toHaveProperty("tab");
  });

  it("검색어는 앞뒤 공백을 걷고 100자로 자르며, 탭은 이름 그대로 싣는다", async () => {
    const { 받은본문 } = 가짜서버();
    await postFundingMap({ ...기본요청, query: "  지원 공고 81  ", tab: "grant" }, "/api/x");
    await postFundingMap({ ...기본요청, query: "가".repeat(150) }, "/api/x");
    expect(받은본문[0]).toMatchObject({ query: "지원 공고 81", tab: "grant" });
    expect(String(받은본문[1].query)).toHaveLength(100);
  });
});

describe("81건 표본 — 마지막 공고 검색(서버 함수 + 화면 둘 다)", () => {
  it("검색어 없이 받으면 80건뿐이라 81번째는 없다", async () => {
    가짜서버();
    const out = await postFundingMap(기본요청, "/api/x");
    if (!out.ok) throw new Error(out.message);
    expect(out.data.groups.find((b) => b.group === "grant")!.items).toHaveLength(80);
  });

  it("검색어를 실어 받으면 서버가 자르기 전에 걸러 그 1건이 오고, 화면 거르개를 거쳐도 1건이다", async () => {
    가짜서버();
    const c: ResultConditions = { tab: "all", query: "지원 공고 81" };
    const out = await postFundingMap({ ...기본요청, ...fundingSearchOf(c) }, "/api/x");
    if (!out.ok) throw new Error(out.message);
    const grant = out.data.groups.find((b) => b.group === "grant")!;
    expect(grant.items.map((i) => i.title)).toEqual(["지원 공고 81"]);
    expect(grant.total).toBe(1);

    const 보임 = filterFundingData(out.data, c).groups.find((b) => b.group === "grant")!;
    expect(보임.items.map((i) => i.title)).toEqual(["지원 공고 81"]);
    expect(보임.total).toBe(1);
    expect(searchCutOf(out.data, c)).toBeNull(); // 거른 결과가 다 실렸으니 「앞의 N건」 안내가 없다
  });

  it("묶음 탭도 서버가 걸러 같은 규칙으로 보인다", async () => {
    가짜서버();
    const c: ResultConditions = { tab: "grant", query: "공고 81" };
    const out = await postFundingMap({ ...기본요청, ...fundingSearchOf(c) }, "/api/x");
    if (!out.ok) throw new Error(out.message);
    expect(filterFundingData(out.data, c).groups.map((b) => b.group)).toEqual(["grant"]);
    expect(filterFundingData(out.data, c).groups[0].items).toHaveLength(1);
  });

  it("잘못된 검색어·탭은 서버가 거절하고 화면은 안내 글을 받는다", async () => {
    가짜서버();
    const bad = await postFundingMap({ ...기본요청, tab: "엉뚱" as never }, "/api/x");
    expect(bad.ok).toBe(false);
    expect(parseFundingSearch({ query: "가".repeat(101) }).ok).toBe(false);
    expect(parseFundingSearch({ query: 5 }).ok).toBe(false);
  });
});

describe("앞의 N건 안내는 서버가 센 거른 뒤 건수가 여전히 많을 때만", () => {
  const 자료 = (total: number, 받은수: number, unclassified: number): FundingMapPayload => ({
    groups: groupBlocks(공고81, { topN: 받은수 }).map((b) => (b.group === "grant" ? { ...b, total } : b)),
    glance: { open: 0, soon: 0, grantFit: 0, grantMaxWon: null, minRate: null },
    profileGaps: [],
    unclassified,
    generatedAt: "2026-10-05T00:00:00.000Z",
  });
  const c: ResultConditions = { tab: "all", query: "공고" };

  it("거른 결과가 실려 온 줄보다 많으면 알린다", () => {
    expect(searchCutOf(자료(120, 80, 0), c)).toEqual({ searched: 80, total: 120 });
  });

  it("거르기 전 전체의 종류 미확인 수(unclassified)를 더해 없는 잘림을 말하지 않는다", () => {
    expect(searchCutOf(자료(80, 80, 40), c)).toBeNull();
  });
});

describe("화면 배선 — 입력이 멈춘 뒤 300ms, 소스 글자로 잰다", () => {
  const 화면글 = readFileSync(new URL("PolicyMatchScreen.tsx", import.meta.url), "utf8");

  it("찾기어는 300ms 뒤에 서버 조건으로 넘어간다 — 탭은 서버 조건이 아니라 항상 「전체」다(탭 거르기는 클라이언트)", () => {
    expect(FUNDING_QUERY_DELAY_MS).toBe(300);
    expect(화면글).toContain("setTimeout(() => setAskedQuery(resultQuery), FUNDING_QUERY_DELAY_MS)");
    expect(화면글).toContain('fundingSearchOf({ tab: "all", query: askedQuery })');
  });

  it("찾기어가 바뀌면 목록 자료를 다시 요청하고, 「다시 시도」도 같은 조건을 쓴다", () => {
    expect(화면글.match(/\.\.\.askedSearch/g)).toHaveLength(2);
    expect(화면글).toContain("profile, askedSearch]");
    expect(화면글).toContain("profileNonce, profile, askedSearch]");
  });

  it("찾기어 없이 받은 자료로 폼 바닥의 「확인 필요 M건」을 센다(찾기어를 걸어도 건수가 줄지 않는다)", () => {
    expect(화면글).toContain("reviewCount={reviewCountOf(countData ?? fundingData, diagnosis)}");
  });
});
