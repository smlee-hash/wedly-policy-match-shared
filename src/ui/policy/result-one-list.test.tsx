import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * 상세 칸이 실제로 고르는 부품을 가로챈다 — 이 저장소엔 jsdom 이 없어 「공고를 고르면 DetailPanel, 상품을 고르면 FundingDrawer 본문」을
 * 눌러서 못 잰다. 그래서 두 부품이 **받은 값**을 잰다(부품이 그것을 받아 무엇을 그리는지는 각자의 그리기 시험이 잰다).
 */
const { detailProps, drawerProps } = vi.hoisted(() => ({
  detailProps: [] as Array<Record<string, unknown>>,
  drawerProps: [] as Array<Record<string, unknown>>,
}));
vi.mock("./DetailPanel", () => ({
  default: (p: Record<string, unknown>) => {
    detailProps.push(p);
    return null;
  },
}));
vi.mock("../FundingDrawer", () => ({
  default: (p: Record<string, unknown>) => {
    drawerProps.push(p);
    return null;
  },
  GroupMembers: () => null,
}));

import { FUNDING_GROUP_META } from "../../funding/funding-group";
import type { FundingDeadline, FundingItem } from "../../funding/funding-map";
import FundingMap, { type FundingMapPayload } from "../FundingMap";
import ResultGroupList from "./ResultGroupList";
import ResultDetail from "./ResultDetail";
import { ResultOneListView } from "./ResultOneList";
import {
  ONE_LIST_FILTERS, listVerdictContext, postFundingMap,
} from "./PolicyMatchScreen";
import { ERP_POLICY_MATCH_ENDPOINTS, type PolicyMatchEndpoints } from "./endpoints";
import {
  RESULT_PAGE_SIZE, chipsOf, ddayBadgeOf, defaultVerdictTab, filterByChip, flattenFundingItems, kindTagOf,
  oneListReducer, oneListViewOf, pageCountOf, pageSlice, searchItems, sortOneList, unknownNoticeOf,
  verdictCountsOf, serverVerdictCountsOf, cutNoticeOf, type OneListState,
} from "./result-one-list";

/**
 * 결과 목록 하나로 합치기(C2).
 *
 * ★이 저장소엔 jsdom 이 없다 — 눌러 보는 동작은 못 잰다. 그래서 ① 거르기·세기·정렬·쪽 넘김·상태 바뀜은
 *  순수 함수(`result-one-list.ts`)로 직접 재고, ② 그림은 `ResultOneListView`(상태를 밖에서 받는 그리기 부품)를
 *  `renderToStaticMarkup` 로 재고, ③ 화면 배선은 소스 글자로 잰다.
 */

const RAW색 =
  /(?:^|["\s])(?:bg|text|border|from|to)-(?:green|amber|red|sky|blue|indigo|violet|pink|gray|slate|zinc|orange|yellow|lime|emerald|teal|cyan|rose|fuchsia)-(?:50|100|200|300|400|500|600|700|800|900)\b/;
const 글자 = (html: string) => html.replace(/<!-- -->/g, "");
const 화면글 = readFileSync(new URL("PolicyMatchScreen.tsx", import.meta.url), "utf8");

afterEach(() => {
  vi.unstubAllGlobals();
});

const 날짜 = (dDay: number): FundingDeadline => ({ kind: "date", date: "2026-10-17", text: "2026.09.20 ~ 2026.10.17", dDay });
const 상시: FundingDeadline = { kind: "always", date: null, text: "상시", dDay: null };
const 모름: FundingDeadline = { kind: "unknown", date: null, text: "", dDay: null };

function mk(over: Partial<FundingItem> & { id: string }): FundingItem {
  return {
    kind: "announcement",
    refId: over.id.slice(2),
    group: "grant",
    title: `공고 ${over.id}`,
    agency: "창업진흥원",
    url: "https://example.kr/a",
    applyUrl: "",
    targetText: "",
    amountText: "최대 3억 원",
    amountMaxWon: 300_000_000,
    rateText: "",
    rateMin: null,
    deadline: 날짜(11),
    where: "",
    fit: [],
    fitVerdict: "fit",
    humanCheck: 0,
    score: 50,
    why: "",
    source: "kstartup",
    isNew: false,
    ...over,
  };
}

function payload(groups: Array<{ group: FundingItem["group"]; items: FundingItem[]; excludedItems?: FundingItem[] }>): FundingMapPayload {
  return {
    groups: groups.map((g) => ({
      group: g.group, total: g.items.length, fit: 0, unverified: 0, excluded: g.excludedItems?.length ?? 0, soon: 0,
      items: g.items, truncated: false, ...(g.excludedItems ? { excludedItems: g.excludedItems } : {}),
    })),
    glance: { open: 0, soon: 0, grantFit: 0, grantMaxWon: null, minRate: null },
    profileGaps: [], unclassified: 0, generatedAt: "2026-10-06T00:00:00Z",
  } as FundingMapPayload;
}

const 처음상태: OneListState = { tab: null, chip: "all", sort: "deadline", page: 1, selectedId: "" };

// ── 합치기 ──────────────────────────────────────────────────────────────
describe("flattenFundingItems — 갈래 항목 + 안 맞아서 뺀 항목을 id 로 중복 없이 한 배열로", () => {
  it("groups 의 items 와 excludedItems 를 합치고 같은 id 는 한 번만 둔다", () => {
    const a1 = mk({ id: "a:1" });
    const a2 = mk({ id: "a:2" });
    const a3 = mk({ id: "a:3", fitVerdict: "excluded" });
    const p1 = mk({ id: "p:1", kind: "product", group: "policy" });
    const data = payload([
      { group: "grant", items: [a1, a2], excludedItems: [a3, a2] },
      { group: "policy", items: [p1] },
    ]);
    expect(flattenFundingItems(data).map((x) => x.id)).toEqual(["a:1", "a:2", "a:3", "p:1"]);
  });

  it("자료가 없으면 빈 배열이다", () => {
    expect(flattenFundingItems(null)).toEqual([]);
  });
});

// ── 판정 탭 ─────────────────────────────────────────────────────────────
describe("판정 탭 — fit→지원 가능 · unverified→확인 필요 · excluded→어려움", () => {
  const items = [
    mk({ id: "a:1" }), mk({ id: "a:2" }),
    mk({ id: "a:3", fitVerdict: "unverified" }),
    mk({ id: "a:4", fitVerdict: "excluded" }),
  ];

  it("탭 숫자는 각 탭 항목 수다", () => {
    expect(verdictCountsOf(items)).toEqual({ fit: 2, unverified: 1, excluded: 1 });
  });

  it("기본 탭은 지원 가능, 0건이면 확인 필요", () => {
    expect(defaultVerdictTab({ fit: 2, unverified: 1, excluded: 1 })).toBe("fit");
    expect(defaultVerdictTab({ fit: 0, unverified: 5, excluded: 9 })).toBe("unverified");
  });

  it("그림: 세 탭에 숫자가 붙고 지금 탭이 눌린 모양이다", () => {
    const html = 글자(
      renderToStaticMarkup(<ResultOneListView {...기본속성(items)} />),
    );
    expect(html).toContain("지원 가능");
    expect(html).toContain("확인 필요");
    expect(html).toContain("어려움");
    expect(html).toMatch(/aria-pressed="true"[^>]*>지원 가능<em[^>]*>2</);
    expect(html).toMatch(/aria-pressed="false"[^>]*>확인 필요<em[^>]*>1</);
  });
});

// ── 돈의 성격 칩 ────────────────────────────────────────────────────────
describe("돈의 성격 칩 — 「전체」+ 6갈래 이름 그대로, 숫자는 지금 탭 안 개수", () => {
  const tabItems = [
    mk({ id: "a:1" }), mk({ id: "a:2" }), mk({ id: "a:3", group: "policy" }),
    mk({ id: "a:4", unclassified: true }),
  ];

  it("전체 N + 6갈래 이름, 0건 칩도 목록에 있다", () => {
    const chips = chipsOf(tabItems);
    expect(chips.map((c) => c.label)).toEqual([
      "전체", ...(["grant", "policy", "guarantee", "bank", "urgent", "invest"] as const).map((g) => FUNDING_GROUP_META[g].name),
    ]);
    expect(chips.map((c) => c.count)).toEqual([4, 2, 1, 0, 0, 0, 0]);
  });

  it("칩으로 거르기 — 종류 미확인 줄은 전체에서만 보인다", () => {
    expect(filterByChip(tabItems, "all")).toHaveLength(4);
    expect(filterByChip(tabItems, "grant").map((x) => x.id)).toEqual(["a:1", "a:2"]);
    expect(filterByChip(tabItems, "policy").map((x) => x.id)).toEqual(["a:3"]);
  });

  it("그림: 0건 칩은 흐리고 눌리지 않는다(disabled)", () => {
    const html = 글자(renderToStaticMarkup(<ResultOneListView {...기본속성(tabItems)} />));
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*data-chip="bank"/);
    expect(html).toMatch(/<button(?![^>]*disabled="")[^>]*data-chip="grant"/);
    expect(html).toContain("opacity-50");
    expect(html).toContain("안 갚아도 되는 돈");
  });

  it("탭을 바꾸면 칩은 「전체」로, 쪽은 1쪽으로 돌아간다", () => {
    const s = oneListReducer({ ...처음상태, tab: "fit", chip: "grant", page: 4 }, { type: "tab", tab: "excluded" });
    expect(s).toMatchObject({ tab: "excluded", chip: "all", page: 1 });
  });

  it("칩 · 정렬 · 찾기어가 바뀌어도 1쪽으로 돌아간다", () => {
    expect(oneListReducer({ ...처음상태, page: 3 }, { type: "chip", chip: "policy" })).toMatchObject({ chip: "policy", page: 1 });
    expect(oneListReducer({ ...처음상태, page: 3 }, { type: "sort", sort: "score" })).toMatchObject({ sort: "score", page: 1 });
    expect(oneListReducer({ ...처음상태, page: 3 }, { type: "query" })).toMatchObject({ page: 1 });
    expect(oneListReducer({ ...처음상태, page: 3 }, { type: "page", page: 2 })).toMatchObject({ page: 2 });
  });
});

// ── 찾기 ────────────────────────────────────────────────────────────────
describe("찾기 — 세 탭 전체를 뒤지고 탭 숫자가 찾기 결과 개수로 바뀐다", () => {
  const items = [
    mk({ id: "a:1", title: "수출 바우처", agency: "중소벤처기업부" }),
    mk({ id: "a:2", title: "창업 도약 패키지", fitVerdict: "unverified" }),
    mk({ id: "a:3", title: "창업 사관학교", fitVerdict: "unverified" }),
    mk({ id: "a:4", title: "창업 지원금", fitVerdict: "excluded" }),
  ];

  it("찾기어가 있으면 탭마다 맞는 개수만 센다", () => {
    expect(searchItems(items, "창업")).toHaveLength(3);
    expect(verdictCountsOf(searchItems(items, "창업"))).toEqual({ fit: 0, unverified: 2, excluded: 1 });
    expect(searchItems(items, "  ")).toHaveLength(4);
  });

  it("지금 탭이 0건이면 다른 탭의 개수를 알려 준다(눌러서 그 탭으로)", () => {
    const view = oneListViewOf(items, { ...처음상태, tab: "fit" }, "창업");
    expect(view.pageItems).toEqual([]);
    expect(view.otherTabs).toEqual([
      { tab: "unverified", label: "확인 필요", count: 2 },
      { tab: "excluded", label: "어려움", count: 1 },
    ]);
  });

  it("지금 탭에 결과가 있으면 다른 탭 안내는 없다", () => {
    expect(oneListViewOf(items, { ...처음상태, tab: "unverified" }, "창업").otherTabs).toEqual([]);
  });

  it("그림: 「다른 탭에 N건 있어요」 단추가 나온다", () => {
    const html = 글자(
      renderToStaticMarkup(
        <ResultOneListView {...기본속성(items)} state={{ ...처음상태, tab: "fit" }} query="창업" askedQuery="창업" />,
      ),
    );
    expect(html).toContain("다른 탭에 2건 있어요");
    expect(html).toContain("다른 탭에 1건 있어요");
  });
});

// ── 정렬 ────────────────────────────────────────────────────────────────
describe("정렬 — 마감 임박 순(기본) · 추천 순", () => {
  const items = [
    mk({ id: "a:1", deadline: 날짜(20), score: 10 }),
    mk({ id: "a:2", deadline: 날짜(3), score: 30 }),
    mk({ id: "a:3", deadline: 상시, score: 90 }),
    mk({ id: "a:4", deadline: 모름, score: 40 }),
    mk({ id: "a:5", deadline: 날짜(11), score: 20 }),
  ];

  it("마감 임박 순: dDay 오름차순, 상시·모름은 뒤", () => {
    expect(sortOneList(items, "deadline").map((x) => x.id)).toEqual(["a:2", "a:5", "a:1", "a:3", "a:4"]);
  });

  it("추천 순: score 내림차순", () => {
    expect(sortOneList(items, "score").map((x) => x.id)).toEqual(["a:3", "a:4", "a:2", "a:5", "a:1"]);
  });

  it("원래 배열은 건드리지 않는다", () => {
    const before = items.map((x) => x.id);
    sortOneList(items, "deadline");
    expect(items.map((x) => x.id)).toEqual(before);
  });

  it("그림: 정렬 선택에 두 선택지 글자가 있고 기존 CustomSelect 를 쓴다", () => {
    const html = 글자(renderToStaticMarkup(<ResultOneListView {...기본속성(items)} />));
    expect(html).toContain("마감 임박 순");
    expect(readFileSync(new URL("ResultOneList.tsx", import.meta.url), "utf8")).toContain("<CustomSelect");
  });
});

// ── 쪽 넘김 ─────────────────────────────────────────────────────────────
describe("쪽 넘김 — 10건씩", () => {
  const many = Array.from({ length: 25 }, (_, i) => mk({ id: `a:${i + 1}`, deadline: 날짜(i + 1) }));

  it("한 쪽은 10건이고 마지막 쪽은 남은 만큼이다", () => {
    expect(RESULT_PAGE_SIZE).toBe(10);
    expect(pageCountOf(25)).toBe(3);
    expect(pageCountOf(0)).toBe(1);
    expect(pageSlice(many, 1)).toHaveLength(10);
    expect(pageSlice(many, 3)).toHaveLength(5);
    expect(pageSlice(many, 3)[0].id).toBe("a:21");
  });

  it("넘치는 쪽 번호는 마지막 쪽으로 맞춘다", () => {
    const view = oneListViewOf(many, { ...처음상태, page: 9 });
    expect(view.page).toBe(3);
    expect(view.pageCount).toBe(3);
  });

  it("그림: 「이전 · n / m · 다음」 이 칸 아래에 있고 첫 쪽은 이전이 눌리지 않는다", () => {
    const html = 글자(renderToStaticMarkup(<ResultOneListView {...기본속성(many)} />));
    expect(html).toContain("1 / 3");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>이전</);
    expect(html).toMatch(/<button(?![^>]*disabled="")[^>]*>다음</);
    expect((html.match(/data-row="/g) ?? []).length).toBe(10);
  });
});

// ── 목록 줄 ─────────────────────────────────────────────────────────────
describe("목록 줄 — 이름표 넷 · 제목 두 줄 · 기관·기간·금액 · D-day", () => {
  it("종류 이름표: 은행 상품 · 상시 · 공고", () => {
    expect(kindTagOf(mk({ id: "p:1", kind: "product", group: "bank", deadline: 상시 }))).toBe("은행 상품");
    expect(kindTagOf(mk({ id: "p:2", kind: "product", group: "guarantee", deadline: 상시 }))).toBe("상시");
    expect(kindTagOf(mk({ id: "a:1", deadline: 상시 }))).toBe("상시");
    expect(kindTagOf(mk({ id: "a:2", deadline: 날짜(5) }))).toBe("공고");
  });

  it("D-day: 날짜 마감만, 7일 안이면 빨강", () => {
    expect(ddayBadgeOf(mk({ id: "a:1", deadline: 날짜(11) }))).toEqual({ text: "D-11", hot: false });
    expect(ddayBadgeOf(mk({ id: "a:2", deadline: 날짜(7) }))).toEqual({ text: "D-7", hot: true });
    expect(ddayBadgeOf(mk({ id: "a:3", deadline: 날짜(0) }))).toEqual({ text: "D-day", hot: true });
    expect(ddayBadgeOf(mk({ id: "a:4", deadline: 상시 }))).toBeNull();
    expect(ddayBadgeOf(mk({ id: "a:5", deadline: 날짜(-2) }))).toBeNull();
  });

  it("그림: 출처·종류·갈래·판정 이름표, 두 줄 제목, 기관·기간·금액, 빨간 D-day 토큰", () => {
    const item = mk({ id: "a:1", title: "2026년 창업도약패키지", deadline: 날짜(5) });
    const html = 글자(renderToStaticMarkup(<ResultOneListView {...기본속성([item])} showSources />));
    expect(html).toContain("K-Startup");
    // 관리자가 아니면(기본) 출처 이름표만 빠지고 나머지 이름표는 그대로다(2026-10-07 관리자만 결정).
    const 직원 = 글자(renderToStaticMarkup(<ResultOneListView {...기본속성([item])} />));
    expect(직원).not.toContain("K-Startup");
    expect(직원).toMatch(/data-row="a:1"[\s\S]*지원 가능/);
    expect(html).toContain("공고");
    expect(html).toContain(FUNDING_GROUP_META.grant.name);
    expect(html).toMatch(/data-row="a:1"[\s\S]*지원 가능/);
    expect(html).toContain("line-clamp-2");
    expect(html).toContain("창업진흥원 · 2026.09.20 ~ 2026.10.17 · 최대 3억 원");
    expect(html).toMatch(/text-wedly-red-ink[^>]*>D-5</);
  });

  it("여러 수집원에 묶인 공고는 관리자 줄에만 「외 N건」이 따로 붙는다(10/7 리뷰 P2)", () => {
    const item = mk({ id: "a:1", deadline: 날짜(5), groupCount: 3, dedupKey: "묶음|서울" });
    const 관리자 = 글자(renderToStaticMarkup(<ResultOneListView {...기본속성([item])} showSources />));
    expect(관리자).toMatch(/data-group-count[^>]*>외 2건</);
    const 직원 = 글자(renderToStaticMarkup(<ResultOneListView {...기본속성([item])} />));
    expect(직원).not.toContain("data-group-count");
    expect(직원).not.toMatch(/외 \d+건/);
    // 한 건뿐이면 관리자에게도 안 붙는다
    const 혼자 = 글자(renderToStaticMarkup(<ResultOneListView {...기본속성([mk({ id: "a:2", deadline: 날짜(5), groupCount: 1 })])} showSources />));
    expect(혼자).not.toContain("data-group-count");
  });

  it("고른 줄은 강조 테두리 — 처음엔 목록 첫 항목이 골라져 있다", () => {
    const items = [mk({ id: "a:1", deadline: 날짜(2) }), mk({ id: "a:2", deadline: 날짜(9) })];
    const html = 글자(renderToStaticMarkup(<ResultOneListView {...기본속성(items)} />));
    expect(html).toMatch(/data-row="a:1"[^>]*aria-current="true"/);
    expect(html).not.toMatch(/data-row="a:2"[^>]*aria-current="true"/);
    expect(html).toMatch(/data-row-wrap="a:1"[^>]*class="[^"]*border-wedly-accent/);
  });
});

// ── 상세 칸 ─────────────────────────────────────────────────────────────
describe("상세 칸 — 공고는 DetailPanel, 상품은 FundingDrawer 본문", () => {
  const 공고 = mk({ id: "a:1", deadline: 날짜(2) });
  const 상품 = mk({ id: "p:9", kind: "product", group: "bank", deadline: 상시 });

  it("처음엔 목록 첫 항목을 상세 칸에 넘긴다", () => {
    const seen: Array<string | null> = [];
    renderToStaticMarkup(
      <ResultOneListView
        {...기본속성([상품, 공고])}
        renderDetail={(it) => {
          seen.push(it?.id ?? null);
          return <i />;
        }}
      />,
    );
    expect(seen).toEqual(["a:1"]); // 마감 임박 순이라 공고(D-2)가 먼저
  });

  it("상품을 고르면 상품이, 공고를 고르면 공고가 상세 칸으로 간다", () => {
    const seen: Array<string | null> = [];
    const 그림 = (selectedId: string) =>
      renderToStaticMarkup(
        <ResultOneListView
          {...기본속성([상품, 공고])}
          state={{ ...처음상태, selectedId }}
          renderDetail={(it) => {
            seen.push(it?.id ?? null);
            return <i />;
          }}
        />,
      );
    그림("p:9");
    그림("a:1");
    expect(seen).toEqual(["p:9", "a:1"]);
  });

  const 진단줄 = {
    announcementId: "1", title: "공고", agency: "기관", category: "", applyEnd: null, applyPeriodText: "",
    grade: "possible", needsReview: false, failSummary: "", checks: { total: 0, pass: 0, fail: 0, unknown: 0, humanCheck: 0 },
  } as const;
  const 상세 = (item: FundingItem, endpoints: PolicyMatchEndpoints = ERP_POLICY_MATCH_ENDPOINTS) => {
    detailProps.length = 0;
    drawerProps.length = 0;
    renderToStaticMarkup(
      <ResultDetail
        item={item}
        endpoints={endpoints}
        profile={{ employeeCount: 3 }}
        profileNonce={2}
        diagnoseById={new Map([["1", { ...진단줄 }]])}
        hasDiagnosis
      />,
    );
  };

  it("공고를 고르면 DetailPanel — refId 와 진단 판정 근거(diagnoseIndex)를 이어 준다", () => {
    상세(공고);
    expect(drawerProps).toHaveLength(0);
    expect(detailProps).toHaveLength(1);
    expect(detailProps[0]).toMatchObject({
      announcementId: "1", mode: "diagnosed", profileNonce: 2, hasDiagnosis: true, serverStructurizes: true,
    });
    expect(detailProps[0].item).toMatchObject({ announcementId: "1" });
    expect(detailProps[0].profile).toEqual({ employeeCount: 3 });
  });

  it("관리자 상세에만 같은 공고의 다른 수집본 묶음(GroupMembers)을 넘긴다(10/7 리뷰 P2)", () => {
    const 묶인공고 = mk({ id: "a:1", deadline: 날짜(2), groupCount: 3, dedupKey: "묶음|서울" });
    const 그림 = (showSourceNames: boolean, item: FundingItem = 묶인공고) => {
      detailProps.length = 0;
      renderToStaticMarkup(
        <ResultDetail
          item={item}
          endpoints={ERP_POLICY_MATCH_ENDPOINTS}
          features={{ showSourceNames }}
          profile={{}}
          profileNonce={1}
          diagnoseById={new Map()}
          hasDiagnosis
        />,
      );
      return detailProps[0];
    };
    const 관리자 = 그림(true);
    expect(관리자.showSources).toBe(true);
    const group = 관리자.sourceGroup as { props: Record<string, unknown> };
    expect(group.props).toMatchObject({ dedupKey: "묶음|서울", count: 3, repId: "1", repLabel: "목록에 실린 줄" });
    expect(그림(false).sourceGroup).toBeUndefined();
    expect(그림(true, mk({ id: "a:2", deadline: 날짜(2), groupCount: 1, dedupKey: "x" })).sourceGroup).toBeUndefined();
  });

  it("진단 목록에 없는 공고면 판정 근거(item)는 null 로 넘긴다(지어내지 않는다)", () => {
    상세(mk({ id: "a:77", refId: "77" }));
    expect(detailProps[0].item).toBeNull();
  });

  it("상품을 고르면 서랍 껍데기 없이(inline) FundingDrawer 본문 — AI 판정 통로 유무를 그대로 넘긴다", () => {
    상세(상품);
    expect(detailProps).toHaveLength(0);
    expect(drawerProps).toHaveLength(1);
    expect(drawerProps[0]).toMatchObject({ inline: true, aiVerdictAvailable: true });
    expect((drawerProps[0].item as FundingItem).id).toBe("p:9");
    const AI없음: PolicyMatchEndpoints = {
      fundingMap: "/f", announcements: "/a", announcement: (id) => `/a/${id}`, diagnose: "/d", sources: "/s",
    };
    상세(상품, AI없음);
    expect(drawerProps[0].aiVerdictAvailable).toBe(false);
  });

  it("화면 배선: 상세 칸은 ResultDetail 이고 서랍(ResultDrawer)·지도 서랍은 이 화면에 없다", () => {
    expect(화면글).toContain("<ResultDetail");
    expect(화면글).toContain("renderDetail={renderDetail}");
    expect(화면글).toContain("diagnoseById={diagnoseById}");
    for (const 없어야 of ["<ResultDrawer", "<FundingDrawer", "<DetailPanel"]) {
      expect(화면글, `${없어야} 가 화면에 남아 있다`).not.toContain(없어야);
    }
    const 상세글 = readFileSync(new URL("ResultDetail.tsx", import.meta.url), "utf8");
    expect(상세글).toContain('item.kind === "announcement"');
    expect(상세글).toContain("announcementId={item.refId}");
    expect(상세글).toContain("item={diagnoseById.get(item.refId) ?? null}");
    expect(상세글).toContain("serverStructurizes={features?.serverStructurizes ?? true}");
  });
});

// ── 판정 피드백 ─────────────────────────────────────────────────────────
describe("랩 verdictFeedback — 줄 안에 place:card 로", () => {
  it("공고 줄에만 조각이 붙고 줄 안(data-row-wrap)에 있다", () => {
    const 공고 = mk({ id: "a:1", deadline: 날짜(2) });
    const 상품 = mk({ id: "p:1", kind: "product", group: "bank", deadline: 상시 });
    const 호출: string[] = [];
    const html = 글자(
      renderToStaticMarkup(
        <ResultOneListView
          {...기본속성([공고, 상품])}
          renderRowFooter={(it) => {
            호출.push(it.refId);
            return <span data-fb={it.refId}>맞음·틀림</span>;
          }}
        />,
      ),
    );
    expect(호출).toEqual(["1"]);
    expect(html).toContain('data-fb="1"');
    expect(html).not.toContain('data-fb="p:1"');
    expect(html).toContain('data-row-wrap="a:1"');
  });

  it("넘기는 자료의 자리 이름은 card 이고, 화면은 그 조각을 목록에 이어 준다", () => {
    expect(listVerdictContext(mk({ id: "a:1" }), { byId: new Map(), profile: null }).place).toBe("card");
    expect(화면글).toContain("verdictFeedback(listVerdictContext(item, { byId: diagnoseById, profile }))");
    expect(화면글).toContain("renderRowFooter={rowFooter}");
  });
});

// ── 모름 칸 안내 ────────────────────────────────────────────────────────
describe("모름 칸 안내 — 센 수만 쓴다", () => {
  it("확인 필요가 1건 이상이고 비어 있는 칸이 있을 때만 한 줄", () => {
    expect(unknownNoticeOf({ unverifiedCount: 342, unknownFieldCount: 6 })).toBe(
      "모르는 6칸 때문에 342건이 「확인 필요」입니다.",
    );
    expect(unknownNoticeOf({ unverifiedCount: 0, unknownFieldCount: 6 })).toBeNull();
    expect(unknownNoticeOf({ unverifiedCount: 5, unknownFieldCount: 0 })).toBeNull();
    expect(unknownNoticeOf({ unverifiedCount: 5, unknownFieldCount: null })).toBeNull();
  });

  it("그림: 「그 칸 채우기」 단추가 있고, 셀 근거 없는 「바로 판정돼요」 숫자는 없다", () => {
    const items = [mk({ id: "a:1" }), mk({ id: "a:2", fitVerdict: "unverified" })];
    const html = 글자(renderToStaticMarkup(<ResultOneListView {...기본속성(items)} unknownCount={6} />));
    expect(html).toContain("모르는 6칸 때문에 1건이 「확인 필요」입니다.");
    expect(html).toContain("그 칸 채우기");
    expect(html).not.toContain("바로 판정돼요");
    expect(글자(renderToStaticMarkup(<ResultOneListView {...기본속성(items)} unknownCount={0} />))).not.toContain("그 칸 채우기");
  });

  it("화면 배선: 「그 칸 채우기」는 회사 정보 단계로 돌아가 첫 빈 칸에 초점을 준다", () => {
    expect(화면글).toMatch(/onFill=\{\(\) => \{\s*goCompany\(\);[^}]*setFillNonce\(\(n\) => n \+ 1\);\s*\}\}/);
    expect(화면글).toContain("focusUnknownNonce={fillNonce}");
  });
});

// ── 상태 ────────────────────────────────────────────────────────────────
describe("불러오는 중 · 오류 · 0건을 각각 그린다", () => {
  it("불러오는 중(자료 없음): 뼈대를 그린다", () => {
    const html = 글자(renderToStaticMarkup(<ResultOneListView {...기본속성(null)} loading />));
    expect(html).toContain('data-area="result-skeleton"');
    expect(html).toContain('aria-busy="true"');
  });

  it("오류(자료 없음): 문구와 「다시 시도」", () => {
    const html = 글자(renderToStaticMarkup(<ResultOneListView {...기본속성(null)} error="목록을 불러오지 못했어요" />));
    expect(html).toContain("목록을 불러오지 못했어요");
    expect(html).toContain("다시 시도");
  });

  it("0건: 안내와 다음 행동", () => {
    const html = 글자(renderToStaticMarkup(<ResultOneListView {...기본속성([])} />));
    expect(html).toContain("조건에 맞는 공고가 없어요");
    expect(html).toContain("회사 정보 고치기");
  });
});

// ── 배치 ────────────────────────────────────────────────────────────────
describe("두 칸 배치 — 넓은 화면은 같은 높이, 좁은 화면은 쌓는다", () => {
  const html = 글자(renderToStaticMarkup(<ResultOneListView {...기본속성([mk({ id: "a:1" })])} />));

  it("grid 두 칸(0.9fr : 1.1fr)과 화면 아래까지 닿는 높이(CSS 만으로)", () => {
    expect(html).toContain("min-[821px]:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]");
    expect(html).toContain("min-[821px]:min-h-[400px]");
    expect(html).toContain("min-[821px]:h-[calc(100dvh-var(--pm-top,280px))]");
  });

  it("각 칸은 flex-col, 본문은 안쪽 스크롤(min-h-0), 좁은 화면에서는 스크롤을 푼다", () => {
    expect(html).toContain("flex flex-col");
    expect(html).toContain("min-[821px]:overflow-y-auto");
    expect(html).toContain("min-h-0");
    expect(html).toContain('data-area="result-list-pane"');
    expect(html).toContain('data-area="result-detail-pane"');
  });

  it("raw 색 0건", () => {
    expect(html).not.toMatch(RAW색);
  });
});

// ── 자료 요청 ───────────────────────────────────────────────────────────
describe("진단 때 fundingMap 요청 — includeExcluded=true 로 어려움까지 받는다", () => {
  it("ONE_LIST_FILTERS 는 includeExcluded 가 true 이고 요청 몸통에 실린다", async () => {
    expect(ONE_LIST_FILTERS.includeExcluded).toBe(true);
    const fetchSpy = vi.fn(async (_url: string, _init?: { body?: string }) => ({
      json: async () => ({ success: true, data: payload([]) }),
    }));
    vi.stubGlobal("fetch", fetchSpy);
    await postFundingMap({ profile: {}, filters: ONE_LIST_FILTERS, sort: "rec" }, "/api/x");
    const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body ?? "{}");
    expect(body.filters.includeExcluded).toBe(true);
  });

  it("화면은 그 거르개로 부르고, 탭은 서버에 싣지 않는다(탭 거르기는 클라이언트)", () => {
    expect(화면글).toContain("filters: ONE_LIST_FILTERS");
    expect(화면글).not.toContain("tab: resultTab");
    expect(화면글).toContain('fundingSearchOf({ tab: "all", query: askedQuery })');
  });
});

// ── 지도 전환 제거 ──────────────────────────────────────────────────────
describe("「한눈에」 지도 보기와 전환 단추는 이 화면에서 뺐다", () => {
  it("화면 글에 지도·묶음 목록·요약 줄 부품이 없다", () => {
    for (const 없어야 of ["<FundingMap ", "<FundingMap\n", "<FundingMap>", "<ResultGroupList", "<ResultSummaryBar", "dispatchMapUi", "mapUi."]) {
      expect(화면글, `${없어야} 가 아직 화면에 있다`).not.toContain(없어야);
    }
  });

  it("그림에 목록/한눈에 전환 단추가 없다", () => {
    const html = 글자(renderToStaticMarkup(<ResultOneListView {...기본속성([mk({ id: "a:1" })])} />));
    expect(html).not.toContain("한눈에");
  });

  it("FundingMap·ResultGroupList 부품과 export 는 그대로 남아 있다", () => {
    expect(typeof FundingMap).toBe("function");
    expect(typeof ResultGroupList).toBe("function");
  });
});

// ── C1 에서 넘어온 고칠 것 ──────────────────────────────────────────────
describe("「← 회사 정보 고치기」는 pushState — 뒤로 가기가 결과 단계로 돌아간다", () => {
  it("goCompany 는 주소를 push 로 쓴다(replace 가 아니다)", () => {
    const start = 화면글.indexOf("const goCompany");
    const body = 화면글.slice(start, 화면글.indexOf("}, []);", start));
    expect(body).toContain('writeStepToAddress("company", "push")');
    expect(body).not.toContain('writeStepToAddress("company", "replace")');
  });

  it("이미 회사 정보 주소이면 다시 쌓지 않는다(두 번 연속 나오지 않게)", () => {
    const start = 화면글.indexOf("const goCompany");
    const body = 화면글.slice(start, 화면글.indexOf("}, []);", start));
    expect(body).toContain('stepOfSearch(window.location.search) !== "company"');
  });
});

/** 그리기 부품에 넘길 기본 속성 — 시험마다 필요한 것만 덮어쓴다. */
function 기본속성(items: FundingItem[] | null) {
  return {
    items,
    state: 처음상태,
    query: "",
    askedQuery: "",
    loading: false,
    error: "",
    unknownCount: null as number | null,
    onRetry: () => {},
    onTab: () => {},
    onChip: () => {},
    onQuery: () => {},
    onSort: () => {},
    onPage: () => {},
    onSelect: () => {},
    onFill: () => {},
    onEdit: () => {},
    renderDetail: (_it: FundingItem | null) => <div data-detail="stub" />,
  };
}

// ── 서버가 자르기 전에 센 개수 ─────────────────────────────────────────
// 새 서버는 모든 갈래에 미확인 집계 칸(unclassifiedCounts)을 싣는다 — 꾸민 답도 그 모양을 따른다.
describe("탭·칩 숫자 — 받은 앞쪽 N건이 아니라 서버가 센 실제 개수", () => {
  const 블록 = (group: "grant" | "policy", fit: number, unverified: number, excluded: number, items: FundingItem[]) =>
    ({ group, total: fit + unverified, fit, unverified, excluded, soon: 0, items, truncated: true, excludedItems: [], unclassifiedCounts: { fit: 0, unverified: 0, excluded: 0 } }) as unknown as FundingMapPayload["groups"][number];
  const 받은 = [
    mk({ id: "a:1", group: "grant" }),
    mk({ id: "a:2", group: "grant", fitVerdict: "excluded" }),
    mk({ id: "a:3", group: "policy", fitVerdict: "excluded" }),
  ];
  const data = { groups: [블록("grant", 3, 0, 900, []), 블록("policy", 0, 0, 120, [])] } as unknown as FundingMapPayload;
  const server = serverVerdictCountsOf(data)!;

  it("갈래 칸의 fit·unverified·excluded 를 더한다", () => {
    expect(server.tab).toEqual({ fit: 3, unverified: 0, excluded: 1020 });
    expect(server.byGroup.policy.excluded).toBe(120);
    expect(serverVerdictCountsOf(null)).toBeNull();
  });

  it("탭·칩 숫자는 받은 수와 서버 수 중 큰 쪽이고, 받은 줄이 모자라면 잘림 안내를 낸다", () => {
    const v = oneListViewOf(받은, { ...처음상태, tab: "excluded" }, "", server);
    expect(v.counts).toEqual({ fit: 3, unverified: 0, excluded: 1020 });
    expect(v.chips.find((c) => c.key === "all")?.count).toBe(1020);
    expect(v.chips.find((c) => c.key === "policy")?.count).toBe(120);
    expect(v.list).toHaveLength(2);
    expect(v.cut).toEqual({ loaded: 2, total: 1020 });
    expect(cutNoticeOf(v.cut!)).toBe("1,020건 중 추천 순 앞쪽 2건만 불러왔어요 · 공고 이름으로 찾으면 나머지도 찾아져요");
  });

  it("서버 수가 없거나 다 받았으면 받은 줄로 세고 안내가 없다", () => {
    const v = oneListViewOf(받은, { ...처음상태, tab: "excluded" }, "");
    expect(v.counts.excluded).toBe(2);
    expect(v.cut).toBeNull();
  });

  it("그림: 탭 숫자에 실제 개수, 목록 위에 잘림 안내", () => {
    const html = 글자(
      renderToStaticMarkup(
        <ResultOneListView {...기본속성(받은)} serverCounts={server} state={{ ...처음상태, tab: "excluded" }} query="" askedQuery="" />,
      ),
    );
    expect(html).toContain("1,020");
    expect(html).toContain('data-area="list-cut-notice"');
  });
});
