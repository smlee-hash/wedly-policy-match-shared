import { describe, expect, it } from "vitest";
import {
  FUNDING_QUERY_MAX,
  GROUP_TOP_N,
  groupBlocks,
  matchesFundingQuery,
  matchesFundingTab,
  parseFundingSearch,
  type FundingItem,
} from "./funding-map";

/**
 * BF3 ⑤ — 서버가 갈래마다 80건으로 자르기 **전에** 검색어·탭으로 거른다.
 * 81번째 공고는 자른 뒤에 걸면 어떤 검색으로도 찾을 수 없었다. 표본은 전부 가짜 공고다.
 */

function item(over: Partial<FundingItem> & { refId: string }): FundingItem {
  return {
    id: `a:${over.refId}`,
    kind: "announcement",
    group: "grant",
    title: `지원 공고 ${over.refId}`,
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
    score: 0,
    why: "",
    source: "smes24",
    isNew: false,
    ...over,
  };
}

/** 81건 — 점수는 번호가 클수록 낮아 추천순에서 81번째가 맨 뒤로 밀린다. */
const 공고81 = Array.from({ length: GROUP_TOP_N + 1 }, (_, i) => item({ refId: String(i + 1), score: 1000 - i }));

const grantBlock = (blocks: ReturnType<typeof groupBlocks>) => blocks.find((b) => b.group === "grant")!;

describe("groupBlocks — 자르기 전에 검색어로 거른다", () => {
  it("검색 없이는 80건만 실리고 81번째는 없다(기존 동작)", () => {
    const b = grantBlock(groupBlocks(공고81));
    expect(b.items).toHaveLength(GROUP_TOP_N);
    expect(b.truncated).toBe(true);
    expect(b.items.map((i) => i.refId)).not.toContain("81");
  });

  it("81번째 공고의 제목으로 검색하면 그 1건이 실리고 건수도 1건이다", () => {
    const b = grantBlock(groupBlocks(공고81, { query: "지원 공고 81" }));
    expect(b.items.map((i) => i.refId)).toEqual(["81"]);
    expect(b.total).toBe(1);
    expect(b.truncated).toBe(false);
  });

  it("검색어 앞뒤 공백·낱말 순서·대소문자는 화면 규칙과 같다", () => {
    expect(grantBlock(groupBlocks(공고81, { query: "  81  공고 " })).items.map((i) => i.refId)).toEqual(["81"]);
    expect(matchesFundingQuery({ title: "Smart 공장" }, "smart")).toBe(true);
    expect(matchesFundingQuery({ title: "가", agency: "나", targetText: "다" }, "가 다")).toBe(true);
    expect(matchesFundingQuery({ title: "가" }, "나")).toBe(false);
  });

  it("검색어에 맞는 줄이 없으면 갈래는 비어 있다(갈래 자리는 그대로 6칸)", () => {
    const blocks = groupBlocks(공고81, { query: "없는 낱말" });
    expect(blocks).toHaveLength(6);
    expect(grantBlock(blocks).items).toEqual([]);
    expect(grantBlock(blocks).total).toBe(0);
  });

  it("안 맞음 풀도 같은 검색어로 거른다", () => {
    const 안맞음 = [item({ refId: "x1", fitVerdict: "excluded" }), item({ refId: "x2", title: "다른 사업", fitVerdict: "excluded" })];
    const b = grantBlock(groupBlocks([...공고81, ...안맞음], { query: "공고 x1", includeExcluded: true }));
    expect(b.excluded).toBe(1);
    expect(b.excludedItems?.map((i) => i.refId)).toEqual(["x1"]);
  });
});

describe("groupBlocks — 탭으로 거른다", () => {
  const 섞음 = [
    item({ refId: "열림", deadline: { kind: "date", date: "2026-10-30", text: "", dDay: 25 } }),
    item({ refId: "임박", deadline: { kind: "date", date: "2026-10-08", text: "", dDay: 3 } }),
    item({ refId: "마감", deadline: { kind: "closed", date: "2026-09-01", text: "", dDay: -30 } }),
    item({ refId: "융자", group: "policy" }),
  ];
  const ids = (blocks: ReturnType<typeof groupBlocks>, group: string) =>
    blocks.find((b) => b.group === group)!.items.map((i) => i.refId);

  it("now 는 열린 것만, soon 은 7일 안 마감만 남긴다", () => {
    expect(ids(groupBlocks(섞음, { tab: "now" }), "grant").sort()).toEqual(["열림", "임박"]);
    expect(ids(groupBlocks(섞음, { tab: "soon" }), "grant")).toEqual(["임박"]);
  });

  it("묶음 이름 탭은 그 갈래 줄만 싣는다", () => {
    const blocks = groupBlocks(섞음, { tab: "policy" });
    expect(ids(blocks, "policy")).toEqual(["융자"]);
    expect(ids(blocks, "grant")).toEqual([]);
  });

  it("all·미지정·모르는 탭은 거르지 않는다", () => {
    expect(ids(groupBlocks(섞음, { tab: "all" }), "grant")).toHaveLength(3);
    expect(ids(groupBlocks(섞음), "grant")).toHaveLength(3);
    expect(ids(groupBlocks(섞음, { tab: "엉뚱" as never }), "grant")).toHaveLength(3);
  });

  it("탭 판별은 화면과 같은 함수를 쓴다", () => {
    expect(matchesFundingTab(섞음[0], "now")).toBe(true);
    expect(matchesFundingTab(섞음[2], "now")).toBe(false);
    expect(matchesFundingTab(섞음[3], "grant")).toBe(false);
    expect(matchesFundingTab(섞음[3], "policy")).toBe(true);
  });
});

describe("parseFundingSearch — 요청 본문의 선택 칸 검사", () => {
  it("둘 다 없으면 거르지 않는 값이다", () => {
    expect(parseFundingSearch({})).toEqual({ ok: true, query: "", tab: "all" });
    expect(parseFundingSearch(null)).toEqual({ ok: true, query: "", tab: "all" });
    expect(parseFundingSearch({ query: null, tab: null })).toEqual({ ok: true, query: "", tab: "all" });
  });

  it("바른 값은 받는다(검색어는 앞뒤 공백을 걷는다)", () => {
    expect(parseFundingSearch({ query: " 지원 ", tab: "now" })).toEqual({ ok: true, query: "지원", tab: "now" });
    for (const tab of ["all", "now", "soon", "grant", "policy", "guarantee", "bank"]) {
      expect(parseFundingSearch({ tab })).toEqual({ ok: true, query: "", tab });
    }
    expect(parseFundingSearch({ query: "가".repeat(FUNDING_QUERY_MAX) }).ok).toBe(true);
  });

  it("잘못된 query 는 거절한다(글이 아님·100자 초과·제어 글자)", () => {
    for (const query of [123, {}, ["가"], "가".repeat(FUNDING_QUERY_MAX + 1), "가\n나", "가\u0000나"]) {
      const r = parseFundingSearch({ query });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.message).toBeTruthy();
    }
  });

  it("잘못된 tab 은 거절한다(정해진 값만)", () => {
    for (const tab of ["evil", "ALL", "", 1, {}, "__proto__"]) {
      expect(parseFundingSearch({ tab }).ok).toBe(false);
    }
  });
});
