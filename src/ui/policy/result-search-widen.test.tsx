import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FUNDING_TOP_N, createFundingLoader, postFundingMap, type FundingRequest } from "./PolicyMatchScreen";
import { SearchCutNotice } from "./ResultGroupList";
import {
  WIDE_TOP_N_MAX, filterFundingData, searchCutNoticeOf, searchCutOf, searchCutText, widerTopN,
  type ResultConditions,
} from "./result-conditions";
import type { FundingFilters, FundingGroupBlock, FundingItem } from "../../funding/funding-map";
import type { FundingMapPayload } from "../FundingMap";

/**
 * BF2 ④ — 서버는 갈래마다 앞쪽 80건만 실어 보낸다. 검색어·탭을 걸었는데 받은 자료가 서버 전체보다 적으면
 * 한 번 더 넓게(서버 전체 건수, 상한 500) 받아 거르고, 그래도 잘리면 「앞의 N건 안에서 찾았어요 — 전체 M건」을 알린다.
 * 이 저장소엔 jsdom 이 없다 — 규칙은 순수 함수, 요청 흐름은 가짜 서버를 낀 심부름꾼, 배선은 소스 글자로 잰다.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

function fItem(over: Partial<FundingItem> & { refId: string }): FundingItem {
  return {
    id: `a:${over.refId}`,
    kind: "announcement",
    group: "grant",
    title: `공고 ${over.refId}`,
    agency: "경기테크노파크",
    url: "https://example.kr/a",
    applyUrl: "",
    targetText: "",
    amountText: "최대 3,000만원",
    amountMaxWon: 30_000_000,
    rateText: "",
    rateMin: null,
    deadline: { kind: "date", date: "2026-10-25", text: "", dDay: 20 },
    where: "",
    fit: [],
    fitVerdict: "fit",
    humanCheck: 0,
    score: 0,
    why: "",
    source: "smes24",
    isNew: false,
    ...over,
  };
}

function block(group: FundingGroupBlock["group"], items: FundingItem[], over: Partial<FundingGroupBlock> = {}): FundingGroupBlock {
  const normal = items.filter((i) => !i.unclassified);
  return {
    group,
    total: normal.length,
    fit: normal.filter((i) => i.fitVerdict === "fit").length,
    unverified: 0,
    excluded: 0,
    soon: 0,
    items,
    truncated: false,
    ...over,
  };
}

const 서버전체 = 81;
const 공고들 = Array.from({ length: 서버전체 }, (_, i) => fItem({ refId: `g${i + 1}`, title: `지원 공고 ${i + 1}` }));

/** 가짜 서버가 `받은수` 건만 실어 보낸 지도 자료 — 서버가 센 전체 건수는 늘 81. */
const 자료 = (받은수: number): FundingMapPayload => ({
  groups: [
    block("grant", 공고들.slice(0, 받은수), { total: 서버전체, truncated: 받은수 < 서버전체 }),
    block("policy", []),
    block("guarantee", []),
    block("bank", []),
  ],
  glance: { open: 0, soon: 0, grantFit: 0, grantMaxWon: 0, minRate: null },
  profileGaps: [],
  unclassified: 0,
  generatedAt: "2026-10-05T00:00:00.000Z",
});

const 조건 = (over: Partial<ResultConditions> = {}): ResultConditions => ({ tab: "all", query: "", ...over });
const 필터: FundingFilters = { openOnly: false, soonOnly: false, includeExcluded: false };

describe("검색어·탭을 걸었는데 받은 자료가 잘려 있으면 — 판단", () => {
  it("검색어가 걸리고 받은 80건이 서버 전체 81건보다 적으면 잘린 것이다", () => {
    expect(searchCutOf(자료(80), 조건({ query: "지원 공고 81" }))).toEqual({ searched: 80, total: 81 });
  });

  it("「전체」 탭에 검색어가 없으면 처음 받은 만큼만 보이는 것이 정상이라 잘린 것으로 안 본다", () => {
    expect(searchCutOf(자료(80), 조건())).toBeNull();
    expect(searchCutOf(자료(80), 조건({ query: "   " }))).toBeNull();
    expect(widerTopN(자료(80), 조건(), FUNDING_TOP_N)).toBeNull();
  });

  it("「전체」가 아닌 탭만 걸려도 잘린 것으로 본다", () => {
    expect(searchCutOf(자료(80), 조건({ tab: "now" }))).toEqual({ searched: 80, total: 81 });
    expect(searchCutOf(자료(80), 조건({ tab: "grant" }))).toEqual({ searched: 80, total: 81 });
  });

  it("다 받았으면 잘린 것이 아니다", () => {
    expect(searchCutOf(자료(81), 조건({ query: "지원 공고 81" }))).toBeNull();
    expect(searchCutOf(null, 조건({ query: "가" }))).toBeNull();
  });

  it("넓게 받을 건수는 서버 전체 건수, 상한 500 — 이미 그만큼 요청했으면 되풀이하지 않는다", () => {
    expect(widerTopN(자료(80), 조건({ query: "지원 공고 81" }), FUNDING_TOP_N)).toBe(81);
    expect(widerTopN(자료(80), 조건({ query: "지원 공고 81" }), 81)).toBeNull();

    const 많음: FundingMapPayload = { ...자료(80), groups: [block("grant", 공고들.slice(0, 80), { total: 3120 }), ...자료(80).groups.slice(1)] };
    expect(widerTopN(많음, 조건({ query: "공고" }), FUNDING_TOP_N)).toBe(WIDE_TOP_N_MAX);
    expect(WIDE_TOP_N_MAX).toBe(500);
    expect(widerTopN(많음, 조건({ query: "공고" }), WIDE_TOP_N_MAX)).toBeNull();
  });
});

describe("넓게 다시 받아 거르면 마지막 항목도 찾는다", () => {
  it("81건 중 마지막 항목을 검색하면 앞 80건 안에는 없다가, 넓게 받은 뒤 1건이 보인다", async () => {
    const c = 조건({ query: "지원 공고 81" });
    expect(filterFundingData(자료(80), c).groups[0].items).toHaveLength(0);

    // 가짜 서버: 요청한 건수만큼(최대 81) 실어 보낸다
    const 요청들: FundingRequest[] = [];
    let 받은: FundingMapPayload | null = null;
    const 불러오기 = createFundingLoader(
      { setLoading: () => {}, setData: (d) => { 받은 = d; }, setError: () => {} },
      async (req) => {
        요청들.push(req);
        return { ok: true, data: 자료(Math.min(req.topN ?? FUNDING_TOP_N, 서버전체)) };
      },
    );

    await 불러오기({ profile: {}, filters: 필터, sort: "rec" });
    const 넓게 = widerTopN(받은, c, FUNDING_TOP_N);
    expect(넓게).toBe(81);
    await 불러오기({ profile: {}, filters: 필터, sort: "rec", topN: 넓게 as number });

    expect(요청들.map((r) => r.topN)).toEqual([undefined, 81]);
    const 보임 = filterFundingData(받은 as unknown as FundingMapPayload, c);
    expect(보임.groups[0].items.map((i) => i.title)).toEqual(["지원 공고 81"]);
    expect(보임.groups[0].total).toBe(1);
    expect(searchCutOf(받은, c)).toBeNull();
  });
});

describe("postFundingMap — 넓게 받을 때 topN 을 그대로 보낸다", () => {
  const 붙이기 = () => {
    const fn = vi.fn(async (_url: string, _init?: { body?: string }) => ({
      json: async () => ({ success: true, data: 자료(80) }),
    }));
    vi.stubGlobal("fetch", fn);
    return fn;
  };
  const 보낸topN = (fn: ReturnType<typeof 붙이기>) => JSON.parse(String(fn.mock.calls[0][1]?.body)).topN;

  it("topN 이 없으면 처음 건수(80), 있으면 그 값, 상한(500)은 넘기지 않는다", async () => {
    const base: FundingRequest = { profile: {}, filters: 필터, sort: "rec" };
    let fn = 붙이기();
    await postFundingMap(base, "/api/x");
    expect(보낸topN(fn)).toBe(FUNDING_TOP_N);

    fn = 붙이기();
    await postFundingMap({ ...base, topN: 81 }, "/api/x");
    expect(보낸topN(fn)).toBe(81);

    fn = 붙이기();
    await postFundingMap({ ...base, topN: 99_999 }, "/api/x");
    expect(보낸topN(fn)).toBe(WIDE_TOP_N_MAX);
  });
});

describe("그래도 잘리면 목록 위에 안내한다", () => {
  const c = 조건({ query: "지원 공고 81" });

  it("글자는 「앞의 N건 안에서 찾았어요 — 전체 M건」", () => {
    expect(searchCutText({ searched: 80, total: 81 })).toBe("앞의 80건 안에서 찾았어요 — 전체 81건");
  });

  it("넓게 받을 예정이면 아직 알리지 않고, 요청한 만큼 받고도 잘렸을 때만 알린다", () => {
    expect(searchCutNoticeOf(자료(80), c, FUNDING_TOP_N)).toBeNull(); // 곧 넓게 받는다
    expect(searchCutNoticeOf(자료(80), c, 81)).toEqual({ searched: 80, total: 81 }); // 서버가 81 을 못 줬다
    expect(searchCutNoticeOf(자료(81), c, 81)).toBeNull(); // 다 받았다
  });

  it("안내 부품은 잘림이 있을 때만 그려지고, 토큰 색만 쓴다", () => {
    expect(renderToStaticMarkup(<SearchCutNotice cut={null} />)).toBe("");
    const html = renderToStaticMarkup(<SearchCutNotice cut={{ searched: 80, total: 81 }} />);
    expect(html.replace(/<!-- -->/g, "")).toContain("앞의 80건 안에서 찾았어요 — 전체 81건");
    expect(html).toContain('data-area="search-cut"');
    expect(html).not.toMatch(/(?:bg|text|border)-(?:gray|red|blue|green|yellow)-\d{2,3}\b/);
  });
});

describe("화면 배선 — 소스 글자로 잰다", () => {
  const 화면글 = readFileSync(new URL("PolicyMatchScreen.tsx", import.meta.url), "utf8");

  it("지도 자료 요청에 건수를 싣고, 잘렸으면 넓히고, 조건을 풀면 처음 건수로 되돌린다", () => {
    expect(화면글).toContain("topN: fundingTopN");
    expect(화면글).toContain("widerTopN(fundingData, conditions, dataTopN)");
    expect(화면글).toContain("setFundingTopN(FUNDING_TOP_N)");
    expect(화면글).toContain("searchCutNoticeOf(fundingData, conditions, dataTopN)");
  });

  it("진단 판일 때 목록(과 지도) 위에 안내를 둔다", () => {
    expect(화면글).toContain('{mode === "diagnosed" && <SearchCutNotice cut={searchCut} />}');
    expect(화면글.indexOf("<SearchCutNotice")).toBeLessThan(화면글.indexOf("<ResultGroupList"));
  });
});
