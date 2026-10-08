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
}));
vi.mock("../funding-group-members", () => ({
  GroupMembers: () => null,
  LINK_BTN: "",
  PANEL: "",
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
  FUNDING_TOP_N, RESULT_PAGE_SIZE, VERDICT_TABS, chipsOf, ddayBadgeOf, defaultVerdictTab, filterByChip, flattenFundingItems,
  kindTagOf, oneListReducer, oneListViewOf, pageCountOf, pageSlice, searchItems, sortOneList, toggleSelectedId,
  unknownNoticeOf, verdictCountsOf, serverVerdictCountsOf, cutNoticeOf, type OneListState,
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
describe("flattenFundingItems — 갈래 항목을 id 로 중복 없이 한 배열로(안 맞음은 붙이지도 않고 실려 와도 버린다)", () => {
  it("groups 의 items 를 합치고 같은 id 는 한 번만 둔다", () => {
    const a1 = mk({ id: "a:1" });
    const a2 = mk({ id: "a:2" });
    const p1 = mk({ id: "p:1", kind: "product", group: "policy" });
    const data = payload([
      { group: "grant", items: [a1, a2, a2] },
      { group: "policy", items: [p1] },
    ]);
    expect(flattenFundingItems(data).map((x) => x.id)).toEqual(["a:1", "a:2", "p:1"]);
  });

  // 옛 규칙(excludedItems 를 뒤에 붙임)을 지운 이유: 조건이 확실히 안 맞는 공고는 화면에 아예 안 보이기로 했다(2026-10-07 사장님 결정).
  it("excludedItems 는 붙이지 않는다 — 서버가 실어 보내도 목록에 안 들어온다", () => {
    const a1 = mk({ id: "a:1" });
    const a3 = mk({ id: "a:3", fitVerdict: "excluded" });
    const data = payload([{ group: "grant", items: [a1], excludedItems: [a3] }]);
    expect(flattenFundingItems(data).map((x) => x.id)).toEqual(["a:1"]);
  });

  it("이중 안전: 서버가 실수로 items 에 안 맞음 줄을 실어도 버린다", () => {
    const a1 = mk({ id: "a:1" });
    const a2 = mk({ id: "a:2", fitVerdict: "excluded" });
    const a3 = mk({ id: "a:3", fitVerdict: "unverified" });
    const data = payload([{ group: "grant", items: [a1, a2, a3] }]);
    expect(flattenFundingItems(data).map((x) => x.id)).toEqual(["a:1", "a:3"]);
  });

  it("자료가 없으면 빈 배열이다", () => {
    expect(flattenFundingItems(null)).toEqual([]);
  });
});

// ── 판정 탭 ─────────────────────────────────────────────────────────────
describe("판정 탭 — fit→지원 가능 · unverified→확인 필요 (안 맞음은 탭이 없다)", () => {
  const items = [
    mk({ id: "a:1" }), mk({ id: "a:2" }),
    mk({ id: "a:3", fitVerdict: "unverified" }),
  ];

  it("탭은 둘뿐이다", () => {
    expect(VERDICT_TABS.map((t) => t.key)).toEqual(["fit", "unverified"]);
    expect(VERDICT_TABS.map((t) => t.label)).toEqual(["지원 가능", "확인 필요"]);
  });

  it("탭 숫자는 각 탭 항목 수다 — 안 맞음 줄이 섞여 있어도 세지 않는다", () => {
    expect(verdictCountsOf(items)).toEqual({ fit: 2, unverified: 1 });
    expect(verdictCountsOf([...items, mk({ id: "a:4", fitVerdict: "excluded" })])).toEqual({ fit: 2, unverified: 1 });
  });

  it("기본 탭은 지원 가능, 0건이면 확인 필요", () => {
    expect(defaultVerdictTab({ fit: 2, unverified: 1 })).toBe("fit");
    expect(defaultVerdictTab({ fit: 0, unverified: 5 })).toBe("unverified");
  });

  it("안 맞음 줄이 받은 배열에 섞여 와도 화면 모델(oneListViewOf)이 먼저 버린다 — 어느 탭·칩·쪽에도 안 들어간다", () => {
    const 섞임 = [...items, mk({ id: "a:4", fitVerdict: "excluded" }), mk({ id: "a:5", fitVerdict: "excluded", group: "policy" })];
    const v = oneListViewOf(섞임, 처음상태);
    expect(v.counts).toEqual({ fit: 2, unverified: 1 });
    expect(v.list.map((x) => x.id).sort()).toEqual(["a:1", "a:2"]);
    expect(v.chips.find((c) => c.key === "policy")?.count).toBe(0);
    // 없는 탭 이름("excluded")으로 눌러도 안 맞음 줄은 나오지 않는다
    const 억지 = oneListViewOf(섞임, { ...처음상태, tab: "excluded" as never });
    expect(억지.list).toEqual([]);
  });

  it("그림: 탭 두 개에 숫자가 붙고 지금 탭이 눌린 모양이다 — 「어려움」 글자와 세 번째 탭이 없다", () => {
    const html = 글자(
      renderToStaticMarkup(<ResultOneListView {...기본속성(items)} />),
    );
    expect(html).toContain("지원 가능");
    expect(html).toContain("확인 필요");
    expect(html).not.toContain("어려움");
    expect((html.match(/data-tab="/g) ?? []).length).toBe(2);
    // 탭 글 앞에 8px 점이 있고, 그 뒤에 글자·숫자가 온다
    expect(html).toMatch(/aria-pressed="true"[^>]*><span aria-hidden="true" class="[^"]*"><\/span>지원 가능<em[^>]*>2</);
    expect(html).toMatch(/aria-pressed="false"[^>]*><span aria-hidden="true" class="[^"]*"><\/span>확인 필요<em[^>]*>1</);
  });

  it("그림: 눌린 탭은 판정 색 — 지원 가능=초록 · 확인 필요=노랑, 안 눌린 탭은 기존 꺼짐 모양", () => {
    const 지원 = 글자(renderToStaticMarkup(<ResultOneListView {...기본속성(items)} state={{ ...처음상태, tab: "fit" }} />));
    const 확인 = 글자(renderToStaticMarkup(<ResultOneListView {...기본속성(items)} state={{ ...처음상태, tab: "unverified" }} />));
    const 탭태그 = (html: string, key: string) => html.match(new RegExp(`<button[^>]*data-tab="${key}"[^>]*>`))?.[0] ?? "";

    const 초록 = 탭태그(지원, "fit");
    for (const c of ["border-2", "border-wedly-green", "bg-wedly-bg-green", "text-wedly-green-ink"]) expect(초록, c).toContain(c);
    expect(초록).not.toContain("bg-wedly-t1"); // 옛 검정 바탕
    const 노랑 = 탭태그(확인, "unverified");
    for (const c of ["border-2", "border-wedly-gold", "bg-wedly-bg-yellow", "text-wedly-t1"]) expect(노랑, c).toContain(c);

    // 안 눌린 쪽은 TAB_OFF
    const 꺼짐 = 탭태그(지원, "unverified");
    for (const c of ["border-wedly-bd", "bg-white", "hover:bg-wedly-bg-gray"]) expect(꺼짐, c).toContain(c);
    expect(꺼짐).not.toContain("border-2");

    // 점 색: fit=초록 · unverified=노랑(gold) — 눌림과 상관없이 늘 붙어 있다
    expect(지원).toMatch(/data-tab="fit"[\s\S]*?<span aria-hidden="true" class="[^"]*bg-wedly-green[^"]*"/);
    expect(지원).toMatch(/data-tab="unverified"[\s\S]*?<span aria-hidden="true" class="[^"]*bg-wedly-gold[^"]*"/);
    expect(지원).toContain("h-2 w-2"); // 8px
    expect(지원).toContain("rounded-full");
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
    const s = oneListReducer({ ...처음상태, tab: "fit", chip: "grant", page: 4 }, { type: "tab", tab: "unverified" });
    expect(s).toMatchObject({ tab: "unverified", chip: "all", page: 1 });
  });

  it("칩 · 정렬 · 찾기어가 바뀌어도 1쪽으로 돌아간다", () => {
    expect(oneListReducer({ ...처음상태, page: 3 }, { type: "chip", chip: "policy" })).toMatchObject({ chip: "policy", page: 1 });
    expect(oneListReducer({ ...처음상태, page: 3 }, { type: "sort", sort: "score" })).toMatchObject({ sort: "score", page: 1 });
    expect(oneListReducer({ ...처음상태, page: 3 }, { type: "query" })).toMatchObject({ page: 1 });
    expect(oneListReducer({ ...처음상태, page: 3 }, { type: "page", page: 2 })).toMatchObject({ page: 2 });
  });
});

// ── 찾기 ────────────────────────────────────────────────────────────────
describe("찾기 — 두 탭 전체를 뒤지고 탭 숫자가 찾기 결과 개수로 바뀐다", () => {
  const items = [
    mk({ id: "a:1", title: "수출 바우처", agency: "중소벤처기업부" }),
    mk({ id: "a:2", title: "창업 도약 패키지", fitVerdict: "unverified" }),
    mk({ id: "a:3", title: "창업 사관학교", fitVerdict: "unverified" }),
  ];

  it("찾기어가 있으면 탭마다 맞는 개수만 센다", () => {
    expect(searchItems(items, "창업")).toHaveLength(2);
    expect(verdictCountsOf(searchItems(items, "창업"))).toEqual({ fit: 0, unverified: 2 });
    expect(searchItems(items, "  ")).toHaveLength(3);
  });

  it("안 맞음 줄은 찾기어에 맞아도 어느 탭에도 안 잡힌다", () => {
    const 섞임 = [...items, mk({ id: "a:4", title: "창업 지원금", fitVerdict: "excluded" })];
    const view = oneListViewOf(섞임, { ...처음상태, tab: "unverified" }, "창업");
    expect(view.counts).toEqual({ fit: 0, unverified: 2 });
    expect(view.list.map((x) => x.id).sort()).toEqual(["a:2", "a:3"]);
  });

  it("지금 탭이 0건이면 다른 탭의 개수를 알려 준다(눌러서 그 탭으로) — 두 탭 사이만", () => {
    const view = oneListViewOf(items, { ...처음상태, tab: "fit" }, "창업");
    expect(view.pageItems).toEqual([]);
    expect(view.otherTabs).toEqual([{ tab: "unverified", label: "확인 필요", count: 2 }]);
    // 확인 필요 탭이 0건이면 반대로 지원 가능 탭만 알려 준다
    expect(oneListViewOf(items, { ...처음상태, tab: "unverified" }, "수출").otherTabs).toEqual([
      { tab: "fit", label: "지원 가능", count: 1 },
    ]);
  });

  it("지금 탭에 결과가 있으면 다른 탭 안내는 없다", () => {
    expect(oneListViewOf(items, { ...처음상태, tab: "unverified" }, "창업").otherTabs).toEqual([]);
  });

  it("그림: 「다른 탭에 N건 있어요」 단추가 나오고 「어려움」 글은 없다", () => {
    const html = 글자(
      renderToStaticMarkup(
        <ResultOneListView {...기본속성(items)} state={{ ...처음상태, tab: "fit" }} query="창업" askedQuery="창업" />,
      ),
    );
    expect(html).toContain("다른 탭에 2건 있어요");
    expect(html).not.toContain("어려움");
  });

  it("그림: 찾기 칸 안내 글에 「세 탭」이 없다 — 「두 탭 전체」", () => {
    const html = 글자(renderToStaticMarkup(<ResultOneListView {...기본속성(items)} />));
    expect(html).toContain("공고 이름으로 찾기 (두 탭 전체)");
    expect(html).not.toContain("세 탭");
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

  it("줄 왼쪽에 4px 판정 색 띠 — 지원 가능=초록 · 확인 필요=노랑, 고른 줄 강조(accent 테두리)는 그대로", () => {
    const items = [mk({ id: "a:1", deadline: 날짜(2) }), mk({ id: "a:2", deadline: 날짜(9), fitVerdict: "unverified" })];
    const 줄태그 = (html: string, id: string) => html.match(new RegExp(`<div data-row-wrap="${id}"[^>]*>`))?.[0] ?? "";
    const fit탭 = 글자(renderToStaticMarkup(<ResultOneListView {...기본속성(items)} state={{ ...처음상태, tab: "fit" }} />));
    const 확인탭 = 글자(renderToStaticMarkup(<ResultOneListView {...기본속성(items)} state={{ ...처음상태, tab: "unverified" }} />));

    const 초록줄 = 줄태그(fit탭, "a:1");
    expect(초록줄).toContain("border-l-4");
    expect(초록줄).toContain("border-l-wedly-green");
    expect(초록줄, "고른 줄은 accent 테두리도 그대로").toContain("border-wedly-accent");

    const 노랑줄 = 줄태그(확인탭, "a:2");
    expect(노랑줄).toContain("border-l-4");
    expect(노랑줄).toContain("border-l-wedly-gold");
    expect(노랑줄).not.toContain("border-l-wedly-green");
  });

  it("안 고른 줄도 띠는 있고, 안 맞음 줄은 (어떻게든 넘어와도) 줄 자체를 그리지 않는다", () => {
    const items = [mk({ id: "a:1", deadline: 날짜(2) }), mk({ id: "a:2", deadline: 날짜(3) })];
    const html = 글자(renderToStaticMarkup(<ResultOneListView {...기본속성(items)} />));
    expect(html).toMatch(/data-row-wrap="a:2"[^>]*class="[^"]*border-l-4[^"]*border-l-wedly-green/);
    expect(html).toMatch(/data-row-wrap="a:2"[^>]*class="[^"]*border-transparent/);

    const 섞임 = [...items, mk({ id: "a:9", fitVerdict: "excluded", deadline: 날짜(1) })];
    const 섞인그림 = 글자(renderToStaticMarkup(<ResultOneListView {...기본속성(섞임)} />));
    expect(섞인그림).not.toContain('data-row="a:9"');
    expect(섞인그림).not.toContain("안 맞음");
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

  it("그림: onFill 을 안 넘기면 안내 문장만 보이고 「그 칸 채우기」 단추는 숨긴다", () => {
    const items = [mk({ id: "a:1" }), mk({ id: "a:2", fitVerdict: "unverified" })];
    const html = 글자(renderToStaticMarkup(<ResultOneListView {...기본속성(items)} onFill={undefined} unknownCount={6} />));
    expect(html).toContain("모르는 6칸 때문에 1건이 「확인 필요」입니다.");
    expect(html).not.toContain("그 칸 채우기");
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

  it("0건: onEdit 을 안 넘기면 「← 회사 정보 고치기」 단추를 숨긴다", () => {
    const html = 글자(renderToStaticMarkup(<ResultOneListView {...기본속성([])} onEdit={undefined} />));
    expect(html).toContain("조건에 맞는 공고가 없어요");
    expect(html).not.toContain("회사 정보 고치기");
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
// 옛 시험(includeExcluded=true 로 어려움까지 받는다)을 뒤집은 이유: 조건이 확실히 안 맞는 공고는 서버에 달라고도 하지 않는다.
describe("진단 때 fundingMap 요청 — includeExcluded=false (안 맞음은 달라고 하지 않는다)", () => {
  it("ONE_LIST_FILTERS 는 includeExcluded 가 false 이고 요청 몸통에도 false 로 실린다", async () => {
    expect(ONE_LIST_FILTERS.includeExcluded).toBe(false);
    const fetchSpy = vi.fn(async (_url: string, _init?: { body?: string }) => ({
      json: async () => ({ success: true, data: payload([]) }),
    }));
    vi.stubGlobal("fetch", fetchSpy);
    await postFundingMap({ profile: {}, filters: ONE_LIST_FILTERS, sort: "rec" }, "/api/x");
    const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body ?? "{}");
    expect(body.filters.includeExcluded).toBe(false);
  });

  it("정책매칭 화면과 상세창 「추천 정책」이 같은 건수(80)를 받는다", () => {
    expect(FUNDING_TOP_N).toBe(80);
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

// ── 안 맞음은 완전히 숨긴다 ─────────────────────────────────────────────
describe("안 맞음(excluded) 공고는 어디에도 안 보인다 — 탭·숫자·줄·펼침 링크·「왜 빠졌는지」", () => {
  const 주석뺀 = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\s\/\/\s.*$/gm, "");
  const 읽기 = (f: string) => readFileSync(new URL(f, import.meta.url), "utf8");

  it("사용자 화면 글(주석 밖)에 「어려움」 낱말이 없다 — 목록·요약·패널·정책매칭 화면", () => {
    for (const f of ["ResultOneList.tsx", "InlineFundingSummary.tsx", "result-one-list.ts", "PolicyMatchScreen.tsx", "../FundingRecommendPanel.tsx"]) {
      expect(주석뺀(읽기(f)), `${f} 에 「어려움」이 남아 있다`).not.toContain("어려움");
    }
  });

  it("그림: 안 맞음이 섞인 자료를 그려도 안 맞음 줄·탭·「안 맞아서 뺀」·「왜 빠졌는지」 글이 없다", () => {
    const 섞임 = [
      mk({ id: "a:1", deadline: 날짜(2) }),
      mk({ id: "a:2", fitVerdict: "unverified", deadline: 날짜(5) }),
      mk({ id: "a:3", fitVerdict: "excluded", deadline: 날짜(1), title: "빠져야 하는 공고" }),
    ];
    for (const layout of ["split", "inline"] as const) {
      for (const tab of ["fit", "unverified"] as const) {
        const html = 글자(renderToStaticMarkup(<ResultOneListView {...기본속성(섞임)} layout={layout} state={{ ...처음상태, tab }} />));
        expect(html, `${layout}/${tab}`).not.toContain("빠져야 하는 공고");
        expect(html, `${layout}/${tab}`).not.toContain('data-row="a:3"');
        for (const 글 of ["어려움", "안 맞음", "안 맞아서 뺀", "왜 빠졌", "안 맞는"]) expect(html, `${layout}/${tab} 에 「${글}」`).not.toContain(글);
      }
    }
  });
});

// ── 한 열 모양(inline) ─────────────────────────────────────────────────
describe('layout="inline" — 좁은 자리용 한 열, 상세는 줄 바로 아래로 펼친다', () => {
  const items = [
    mk({ id: "a:1", deadline: 날짜(2) }),
    mk({ id: "a:2", deadline: 날짜(9), fitVerdict: "unverified" }),
    mk({ id: "a:3", deadline: 날짜(12) }),
  ];
  const 읽기 = (f: string) => readFileSync(new URL(f, import.meta.url), "utf8");
  const 그림 = (over: Partial<ReturnType<typeof 기본속성>> & { layout?: "split" | "inline"; searchReachesAll?: boolean } = {}) =>
    글자(renderToStaticMarkup(<ResultOneListView {...기본속성(items)} layout="inline" {...over} />));
  const 상세그림 = (it: FundingItem) => <i data-detail={it.id} />;

  it("두 칸 상자·상세 칸·높이 계산이 없고 한 열 목록 하나다", () => {
    const html = 그림();
    expect(html).toContain('data-layout="inline"');
    expect(html).toContain('data-area="result-list-pane"');
    for (const 없어야 of ["result-two-pane", "result-detail-pane", "--pm-top", "min-[821px]", "grid-cols-[minmax"]) {
      expect(html, `${없어야} 가 한 열 모양에 있다`).not.toContain(없어야);
    }
  });

  it("처음엔 아무 줄도 안 펼쳐져 있다 — 첫 줄을 대신 고르지 않는다(상세 칸이 아니라 줄 아래라서)", () => {
    const seen: string[] = [];
    const html = 그림({
      renderDetail: (it) => {
        seen.push(it.id);
        return 상세그림(it);
      },
    });
    expect(seen).toEqual([]);
    expect(html).not.toContain('aria-expanded="true"');
    expect((html.match(/data-row="[^"]*"[^>]*aria-expanded="false"/g) ?? []).length).toBe(2); // 지원 가능 탭의 두 줄(정렬 단추의 aria-expanded 는 세지 않는다)
    expect(html).not.toContain("aria-current");
    expect(html).not.toContain('data-area="row-detail"');
  });

  it("펼친 줄은 그 줄 바로 아래(같은 줄 래퍼 안, 단추의 형제)에 renderDetail 을 그리고 aria-expanded 가 켜진다", () => {
    const seen: string[] = [];
    const html = 그림({
      state: { ...처음상태, selectedId: "a:3" },
      renderDetail: (it) => {
        seen.push(it.id);
        return 상세그림(it);
      },
    });
    expect(seen).toEqual(["a:3"]); // 펼친 줄 하나만 상세를 그린다
    expect(html).toMatch(/data-row="a:3"[^>]*aria-expanded="true"/);
    expect(html).toMatch(/data-row="a:1"[^>]*aria-expanded="false"/);
    // 같은 줄 래퍼 안: 단추가 닫힌 직후에 상세 상자가 오고 그 안에 상세가 있다
    expect(html).toMatch(/data-row-wrap="a:3"[\s\S]*?<\/button><div data-area="row-detail"[^>]*><i data-detail="a:3"><\/i><\/div><\/div>/);
    // 다른 줄 래퍼에는 상세가 없다
    const a1 = html.slice(html.indexOf('data-row-wrap="a:1"'), html.indexOf('data-row-wrap="a:3"'));
    expect(a1).not.toContain("row-detail");
    expect((html.match(/data-area="row-detail"/g) ?? []).length).toBe(1);
    // 펼친 줄도 accent 테두리 강조는 그대로
    expect(html).toMatch(/data-row-wrap="a:3"[^>]*class="[^"]*border-wedly-accent/);
  });

  it("다시 누르면 접힌다 — 접힌 상태는 고른 줄이 없는 상태(빈 id)다", () => {
    expect(toggleSelectedId("", "a:1")).toBe("a:1"); // 안 펼친 줄을 누르면 펼친다
    expect(toggleSelectedId("a:1", "a:3")).toBe("a:3"); // 다른 줄을 누르면 그 줄로 옮긴다
    expect(toggleSelectedId("a:3", "a:3")).toBe(""); // 펼친 줄을 다시 누르면 접는다
    // 접은 뒤(빈 id)에는 한 열 모양이 아무 줄도 안 펼친다 — 두 칸 모양처럼 첫 줄로 되돌아가지 않는다
    const 접힘 = oneListViewOf(items, { ...처음상태, selectedId: toggleSelectedId("a:3", "a:3") }, "", null, { autoSelect: false });
    expect(접힘.selected).toBeNull();
    expect(oneListViewOf(items, 처음상태).selected?.id).toBe("a:1"); // 두 칸 모양(기본)은 그대로 첫 줄
    expect(oneListViewOf(items, { ...처음상태, selectedId: "nope" }, "", null, { autoSelect: false }).selected).toBeNull();
    expect(oneListViewOf(items, { ...처음상태, selectedId: "a:3" }, "", null, { autoSelect: false }).selected?.id).toBe("a:3");
    // 배선: 한 열 모양은 펼친 줄을 다시 누르면 접는 규칙을 지나고, 두 칸 모양은 그냥 고른다
    const 목록글 = 읽기("ResultOneList.tsx");
    expect(목록글).toContain('const pickRow = inline ? (id: string) => onSelect(toggleSelectedId(view.selected?.id ?? "", id)) : onSelect;');
    expect(목록글).toContain("onSelect={pickRow}");
    expect(목록글).toContain("{ autoSelect: !inline }");
  });

  it("도구줄: 탭 두 개 한 줄 → 찾기 칸(전체 폭) → 정렬, min-w-0·flex-wrap 이라 380~460px 에서도 가로 스크롤이 안 생긴다", () => {
    const html = 그림();
    const 도구 = html.slice(html.indexOf('data-area="verdict-tabs"'), html.indexOf('data-area="group-chips"'));
    expect(도구).toContain("flex min-w-0 flex-col gap-2"); // 탭 줄과 찾기 줄이 위아래로
    expect(도구).toContain("flex min-w-0 flex-wrap items-center gap-2"); // 줄마다 넘치면 줄바꿈
    expect(도구).toContain("min-w-0 flex-1 basis-48"); // 찾기 칸: 남는 폭을 다 쓰고 좁으면 한 줄을 차지
    expect(도구).not.toContain("ml-auto");
    expect(도구).not.toContain("w-56"); // 두 칸 모양의 고정 폭 찾기 칸이 아니다
    expect((도구.match(/data-tab="/g) ?? []).length).toBe(2);
    expect(도구.indexOf('data-tab="unverified"')).toBeLessThan(도구.indexOf('aria-label="공고 찾기"'));
    expect(도구.indexOf('aria-label="공고 찾기"')).toBeLessThan(도구.indexOf("마감 임박 순"));
    // 목록 상자가 가로로 넘치는 것을 한 번 더 막는다
    expect(html).toMatch(/data-area="result-list-pane"[^>]*class="[^"]*min-w-0[^"]*overflow-hidden/);
  });

  it("쪽 넘김(10건)·칩·모름 안내·빈 상태·오류·뼈대는 두 칸 모양과 같은 부품이다", () => {
    const many = Array.from({ length: 25 }, (_, i) => mk({ id: `a:${i + 1}`, deadline: 날짜(i + 1), fitVerdict: "unverified" }));
    const 쪽 = 글자(renderToStaticMarkup(<ResultOneListView {...기본속성(many)} layout="inline" unknownCount={4} />));
    expect(쪽).toContain("1 / 3");
    expect((쪽.match(/data-row="/g) ?? []).length).toBe(RESULT_PAGE_SIZE);
    expect(쪽).toMatch(/<button[^>]*disabled=""[^>]*>이전</);
    expect(쪽).toContain('data-area="group-chips"');
    expect(쪽).toContain("모르는 4칸 때문에 25건이 「확인 필요」입니다.");
    expect(쪽).toContain("그 칸 채우기");
    expect(그림({ items: [] })).toContain("조건에 맞는 공고가 없어요");
    expect(그림({ items: null, error: "목록을 불러오지 못했어요" })).toContain("다시 시도");
    expect(그림({ items: null, loading: true })).toContain('data-area="result-skeleton"');
    // 오류·모름 안내의 단추는 손잡이를 안 주면 숨는다
    const 손잡이없음 = 글자(
      renderToStaticMarkup(<ResultOneListView {...기본속성([])} layout="inline" onFill={undefined} onEdit={undefined} />),
    );
    expect(손잡이없음).toContain("조건에 맞는 공고가 없어요");
    expect(손잡이없음).not.toContain("회사 정보 고치기");
  });

  it("출처 이름표(관리자만)·판정 피드백 줄 꼬리도 한 열 모양에서 그대로 붙는다", () => {
    const 줄 = mk({ id: "a:1", deadline: 날짜(5) });
    const html = 글자(
      renderToStaticMarkup(
        <ResultOneListView {...기본속성([줄])} layout="inline" showSources renderRowFooter={(it) => <span data-fb={it.refId} />} />,
      ),
    );
    expect(html).toContain("K-Startup");
    expect(html).toContain('data-fb="1"');
  });

  it("raw 색 0건", () => {
    expect(그림({ state: { ...처음상태, selectedId: "a:1" } })).not.toMatch(RAW색);
  });
});

describe("layout 기본값은 split — 두 칸 모양은 탭 색·줄 띠만 달라지고 그대로다", () => {
  const items = [mk({ id: "a:1", deadline: 날짜(2) }), mk({ id: "a:2", deadline: 날짜(9) })];
  const html = 글자(renderToStaticMarkup(<ResultOneListView {...기본속성(items)} />));

  it("두 칸 상자·상세 칸·고른 줄(aria-current)·오른쪽 상세 — 줄 아래 펼침은 없다", () => {
    expect(html).toContain('data-layout="split"');
    expect(html).toContain('data-area="result-two-pane"');
    expect(html).toContain('data-area="result-detail-pane"');
    expect(html).toMatch(/data-row="a:1"[^>]*aria-current="true"/);
    expect(html).toContain('data-detail="stub"'); // 오른쪽 상세 칸
    expect(html, "두 칸 모양 줄은 펼침이 없다(정렬 단추의 aria-expanded 는 별개)").not.toMatch(/data-row="[^"]*"[^>]*aria-expanded/);
    expect(html).not.toContain('data-area="row-detail"');
    // 도구줄은 한 줄: 탭 + 오른쪽 끝에 찾기·정렬
    expect(html).toContain("ml-auto flex flex-wrap items-center gap-2");
    expect(html).toContain("w-56 max-w-full");
  });

  it("split 을 직접 적어도 같은 그림이다", () => {
    expect(글자(renderToStaticMarkup(<ResultOneListView {...기본속성(items)} layout="split" />))).toBe(html);
  });

  it("고른 줄을 다시 눌러도 접히지 않는다 — 두 칸 모양은 항상 하나가 골라져 있다", () => {
    const 고른 = oneListViewOf(items, { ...처음상태, selectedId: "a:2" });
    expect(고른.selected?.id).toBe("a:2");
    expect(oneListReducer({ ...처음상태, selectedId: "a:2" }, { type: "select", id: "a:2" }).selectedId).toBe("a:2");
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
    renderDetail: (_it: FundingItem) => <div data-detail="stub" />,
  };
}

// ── 서버가 자르기 전에 센 개수 ─────────────────────────────────────────
// 새 서버는 모든 갈래에 미확인 집계 칸(unclassifiedCounts)을 싣는다 — 꾸민 답도 그 모양을 따른다.
describe("탭·칩 숫자 — 받은 앞쪽 N건이 아니라 서버가 센 실제 개수(안 맞음 수는 쓰지 않는다)", () => {
  const 블록 = (group: "grant" | "policy", fit: number, unverified: number, excluded: number, items: FundingItem[]) =>
    ({ group, total: fit + unverified, fit, unverified, excluded, soon: 0, items, truncated: true, excludedItems: [], unclassifiedCounts: { fit: 0, unverified: 0, excluded: 0 } }) as unknown as FundingMapPayload["groups"][number];
  const 받은 = [
    mk({ id: "a:1", group: "grant", fitVerdict: "unverified" }),
    mk({ id: "a:2", group: "grant", fitVerdict: "unverified" }),
    mk({ id: "a:3", group: "policy", fitVerdict: "unverified" }),
  ];
  // 서버가 센 안 맞음(900·120)은 어디에도 안 쓴다 — 탭도 칩도 아니다
  const data = { groups: [블록("grant", 3, 900, 900, []), 블록("policy", 0, 120, 120, [])] } as unknown as FundingMapPayload;
  const server = serverVerdictCountsOf(data)!;

  it("갈래 칸의 fit·unverified 를 더한다 — excluded 칸은 읽지 않는다", () => {
    expect(server.tab).toEqual({ fit: 3, unverified: 1020 });
    expect(server.byGroup.policy).toEqual({ fit: 0, unverified: 120 });
    expect("excluded" in server.tab).toBe(false);
    expect(serverVerdictCountsOf(null)).toBeNull();
  });

  it("탭·칩 숫자는 받은 수와 서버 수 중 큰 쪽이고, 받은 줄이 모자라면 잘림 안내를 낸다", () => {
    const v = oneListViewOf(받은, { ...처음상태, tab: "unverified" }, "", server);
    expect(v.counts).toEqual({ fit: 3, unverified: 1020 });
    expect(v.chips.find((c) => c.key === "all")?.count).toBe(1020);
    expect(v.chips.find((c) => c.key === "policy")?.count).toBe(120);
    expect(v.list).toHaveLength(3);
    expect(v.cut).toEqual({ loaded: 3, total: 1020 });
    expect(cutNoticeOf(v.cut!)).toBe("1,020건 중 추천 순 앞쪽 3건만 불러왔어요 · 공고 이름으로 찾으면 나머지도 찾아져요");
  });

  it("찾기가 받아 둔 줄만 거르는 자리(searchReachesAll=false)는 「찾으면 나머지도」를 약속하지 않는다", () => {
    expect(cutNoticeOf({ loaded: 3, total: 1020 }, false)).toBe("1,020건 중 추천 순 앞쪽 3건만 불러왔어요");
  });

  it("서버 수가 없거나 다 받았으면 받은 줄로 세고 안내가 없다", () => {
    const v = oneListViewOf(받은, { ...처음상태, tab: "unverified" }, "");
    expect(v.counts.unverified).toBe(3);
    expect(v.cut).toBeNull();
  });

  it("그림: 탭 숫자에 실제 개수, 목록 위에 잘림 안내", () => {
    const html = 글자(
      renderToStaticMarkup(
        <ResultOneListView {...기본속성(받은)} serverCounts={server} state={{ ...처음상태, tab: "unverified" }} query="" askedQuery="" />,
      ),
    );
    expect(html).toContain("1,020");
    expect(html).toContain('data-area="list-cut-notice"');
    expect(html).toContain("공고 이름으로 찾으면 나머지도 찾아져요");
    // 같은 그림이어도 찾기가 서버에 안 묻는 자리는 그 약속을 빼고 그린다
    const 로컬 = 글자(
      renderToStaticMarkup(
        <ResultOneListView {...기본속성(받은)} serverCounts={server} state={{ ...처음상태, tab: "unverified" }} searchReachesAll={false} />,
      ),
    );
    expect(로컬).toContain('data-area="list-cut-notice"');
    expect(로컬).not.toContain("나머지도 찾아져요");
  });
});
