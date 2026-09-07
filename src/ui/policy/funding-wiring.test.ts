import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import PolicyMatchScreen, {
  FUNDING_TOP_N,
  createFundingLoader,
  mapUiReducer,
  postFundingMap,
  showsMap,
  toggleGroupSet,
  type FundingOutcome,
  type FundingRequest,
  type MapUiState,
} from "./PolicyMatchScreen";
import { ERP_POLICY_MATCH_ENDPOINTS } from "./endpoints";
import type { FundingItem, FundingFilters } from "../../funding/funding-map";
import type { FundingGroup } from "../../funding/funding-group";
// 화면(PolicyMatchScreen)이 실제로 부르는 그 함수를 잰다 — 보관함 안이라 껍데기를 거칠 일이 없다.
import { nextFilters } from "../FundingMap";
import { nextFundingState } from "../FundingRecommendPanel";

/**
 * 진단 화면 ↔ 자금 조달 지도 배선 시험(계획서 Task 19 · 재설계 계약 §G2, 2026-09-04 시안 3).
 *
 * 이 저장소엔 jsdom·testing-library 가 없다(2026-09-03 실측) — 그래서 「눌러 보는」 대신
 * 화면이 실제로 쓰는 **순수 조각**(통로 몸통·심부름꾼·판 갈아타기 규칙)을 직접 불러 잰다.
 * 화면이 이 조각들을 안 쓰고 딴 길로 가면 `PolicyMatchClient.tsx` 안에서 죽은 코드가 되므로
 * 「그 파일이 이 함수들을 실제로 부르는가」는 사람이 읽어 확인한다(같은 폴더 시험들과 같은 약속).
 *
 * ★재설계로 `FundingFilters.fitOnly` → `includeExcluded`(G1) 로 바뀌어 이 파일의 기본 요청도 함께
 *  고쳤다. `toggleGroupSet`(G2 신설, showExcluded 집합 손잡이)도 여기서 잰다.
 */

const 프로필 = { region: "서울", industry: "제조업" };
const 요청 = (over: Partial<FundingRequest> = {}): FundingRequest => ({
  profile: 프로필,
  filters: { openOnly: false, soonOnly: false, includeExcluded: false },
  sort: "rec",
  ...over,
});

/** 지도 자료 흉내 — 배선 시험엔 「무엇이 들어왔나」만 필요하다. */
const 자료 = (mark: string) =>
  ({
    groups: [],
    glance: { open: 0, soon: 0, grantFit: 0, grantMaxWon: null, minRate: null },
    profileGaps: [mark],
    unclassified: 0,
    generatedAt: "2026-09-03T01:00:00.000Z",
  }) as never;

function 항목(id: string): FundingItem {
  return {
    id,
    kind: "announcement",
    refId: id.slice(2),
    group: "grant",
    title: "예시 공고",
    agency: "중소벤처기업부",
    url: "https://example.kr/a/1",
    applyUrl: "",
    targetText: "",
    amountText: "최대 5,000만원",
    amountMaxWon: 50_000_000,
    rateText: "무상",
    rateMin: null,
    deadline: { kind: "always", date: null, text: "상시", dDay: null },
    where: "관악구청",
    fit: [],
    fitVerdict: "unverified",
    humanCheck: 0,
    score: 10,
    why: "",
    source: "smes24",
    isNew: false,
  };
}

/** 손으로 풀고 잠그는 약속 — 응답 차례를 시험이 정한다. */
function 대기표<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

function 받는곳() {
  const calls: string[] = [];
  const state = { data: null as unknown, error: "", loading: false };
  return {
    calls,
    state,
    sink: {
      setLoading: (v: boolean) => { state.loading = v; calls.push(`loading:${v}`); },
      setData: (d: unknown) => { state.data = d; calls.push("data"); },
      setError: (m: string) => { state.error = m; calls.push(`error:${m}`); },
    },
  };
}

afterEach(() => { vi.unstubAllGlobals(); });

describe("postFundingMap — 통로 계약(b)", () => {
  it("POST /api/policy-match/funding-map 에 profile·filters·sort·topN 80 을 보낸다", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ success: true, data: 자료("ok") })));
    vi.stubGlobal("fetch", fetchMock);

    const out = await postFundingMap(
      요청({ filters: { openOnly: true, soonOnly: false, includeExcluded: true }, sort: "dead" }),
      ERP_POLICY_MATCH_ENDPOINTS.fundingMap,
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/policy-match/funding-map");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      profile: 프로필,
      filters: { openOnly: true, soonOnly: false, includeExcluded: true },
      sort: "dead",
      topN: 80,
    });
    expect(FUNDING_TOP_N).toBe(80);
    expect(out.ok).toBe(true);
  });

  it("통로가 실패를 주면 그 문구를 그대로 쓴다", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ success: false, error: { code: "UNAUTHORIZED", message: "로그인이 필요합니다" } }), { status: 401 })));
    const out = await postFundingMap(요청(), ERP_POLICY_MATCH_ENDPOINTS.fundingMap);
    expect(out).toEqual({ ok: false, message: "로그인이 필요합니다" });
  });

  it("통신이 끊기거나 답이 JSON 이 아니면 사람 말 안내로 바꾼다", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network down"); }));
    const 끊김 = await postFundingMap(요청(), ERP_POLICY_MATCH_ENDPOINTS.fundingMap);
    expect(끊김.ok).toBe(false);
    expect(끊김.ok === false && 끊김.message).toMatch(/자금 조달 지도/);

    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>502</html>", { status: 502 })));
    const 웹문서 = await postFundingMap(요청(), ERP_POLICY_MATCH_ENDPOINTS.fundingMap);
    expect(웹문서.ok).toBe(false);
    expect(웹문서.ok === false && 웹문서.message).toMatch(/자금 조달 지도/);
  });
});

describe("createFundingLoader — 응답 순서가 뒤집혀도 마지막 요청만 이긴다", () => {
  it("늦게 온 앞선 요청의 답은 버린다", async () => {
    const a = 대기표<FundingOutcome>();
    const b = 대기표<FundingOutcome>();
    const 순서 = [a.promise, b.promise];
    const post = vi.fn(() => 순서.shift()!);
    const { sink, state, calls } = 받는곳();
    const load = createFundingLoader(sink, post);

    const 첫째 = load(요청());                       // 느린 요청(칩 켜기)
    const 둘째 = load(요청({ sort: "dead" }));        // 곧바로 누른 두 번째(정렬 바꾸기)

    b.resolve({ ok: true, data: 자료("둘째") });       // 두 번째가 먼저 도착
    await 둘째;
    a.resolve({ ok: true, data: 자료("첫째") });       // 첫 번째가 뒤늦게 도착
    await 첫째;

    expect((state.data as { profileGaps: string[] }).profileGaps).toEqual(["둘째"]);
    expect(state.loading).toBe(false);
    // 늦게 온 답이 로딩을 다시 켜거나 자료를 덮어쓰지 않는다
    expect(calls.filter((c) => c === "data")).toHaveLength(1);
    expect(calls.filter((c) => c === "loading:false")).toHaveLength(1);
  });

  it("부르는 순간 오류를 지운다 — 「다시 시도」가 먹통으로 보이지 않게", async () => {
    const 표 = 대기표<FundingOutcome>();
    const { sink, state } = 받는곳();
    state.error = "앞선 실패";
    const load = createFundingLoader(sink, () => 표.promise);

    const 진행 = load(요청());
    expect(state.error).toBe("");   // 답을 기다리는 동안 이미 지워져 있다
    expect(state.loading).toBe(true);
    표.resolve({ ok: true, data: 자료("ok") });
    await 진행;
    expect(state.loading).toBe(false);
  });

  it("실패하면 문구만 남기고 앞서 받은 자료는 건드리지 않는다", async () => {
    const { sink, state } = 받는곳();
    state.data = 자료("앞선 자료");
    const load = createFundingLoader(sink, async () => ({ ok: false, message: "불러오지 못했습니다" }));

    await load(요청());

    expect(state.error).toBe("불러오지 못했습니다");
    expect((state.data as { profileGaps: string[] }).profileGaps).toEqual(["앞선 자료"]);
    expect(state.loading).toBe(false);
  });
});

describe("toggleGroupSet — 「안 맞아서 뺀 항목 보기」 갈래 집합 손잡이(계약 §G2 신설)", () => {
  it("없던 갈래를 넣으면 켜지고, 있던 갈래를 다시 부르면 빠진다", () => {
    const 빈집합 = new Set<FundingGroup>();
    const 켜짐 = toggleGroupSet(빈집합, "grant");
    expect([...켜짐]).toEqual(["grant"]);
    expect(빈집합.size, "원본은 안 바뀐다(새 Set 을 돌려준다)").toBe(0);

    const 두번째 = toggleGroupSet(켜짐, "policy");
    expect([...두번째].sort()).toEqual(["grant", "policy"]);

    const 꺼짐 = toggleGroupSet(두번째, "grant");
    expect([...꺼짐]).toEqual(["policy"]);
  });

  it("마지막 하나를 빼면 다시 빈 집합 — 부모가 이 size 로 includeExcluded 를 결정한다", () => {
    const 하나 = toggleGroupSet(new Set<FundingGroup>(), "urgent");
    expect(하나.size > 0, "하나라도 있으면 includeExcluded:true 를 원한다").toBe(true);
    const 없음 = toggleGroupSet(하나, "urgent");
    expect(없음.size > 0, "전부 빠지면 includeExcluded:false 로 되돌아간다").toBe(false);
  });
});

/**
 * ★「스위치를 끄면 펼침도 접힌다」 — 브라우저 독립 검사(2026-09-04)가 배포본에서 재현한 결함.
 *
 *  `/policy-match` 카드 보기에서 한 갈래의 「안 맞아서 뺀 N건 보기」를 펼친 뒤 → 「표로 보기」 →
 *  「안 맞는 공고도 보기」 손잡이를 **끄고** → 「카드로 보기」로 돌아오면, 그 갈래 단추가
 *  「뺀 것 접기」(펼친 모양)로 남아 있는데 안 맞음 영역이 안 그려졌다. 원인은 부모가 거르개와
 *  펼침을 따로 쥐고 `onFiltersChange={setFundingFilters}` 로 **거르개만** 갈아 끼운 것 —
 *  `includeExcluded` 는 꺼졌는데 `showExcluded` 에는 그 갈래가 그대로 남았다.
 *
 *  고친 방법: 거르개를 바꾸는 길을 사설 훅(`useFundingFilterState`)의 `onFiltersChange` 하나로
 *  좁히고, 그 길이 공용 `nextFundingState` 를 반드시 지나게 했다. 날 것 설정 함수는 부품 범위에
 *  없으므로 옛 배선으로 되돌리면 타입 검사가 막는다(실측: `TS2552: Cannot find name
 *  'setFundingFilters'`) — 그래서 「배선이 그 함수를 지나는가」는 시험이 아니라 **타입**이 지킨다.
 *
 *  이 저장소엔 jsdom 이 없어 「눌러 보는」 대신, 화면이 부르는 순수 함수 두 개
 *  (`nextFilters` → `nextFundingState`)를 손잡이 순서 그대로 **이어 붙여** 잰다.
 */
describe("거르개·펼침을 한 자리에서 옮기기(nextFundingState) — 전폭 지도 배선", () => {
  const 기본거르개: FundingFilters = { openOnly: false, soonOnly: false, includeExcluded: false };
  const 켠거르개: FundingFilters = { ...기본거르개, includeExcluded: true };
  const grant펼침 = new Set<FundingGroup>(["grant"]);

  it("「펼침 → 스위치 끄기」 뒤 펼침이 빈 집합이 된다 — 「뺀 것 접기」인데 빈 카드가 안 남는다", () => {
    const 다음 = nextFundingState(켠거르개, grant펼침, nextFilters(켠거르개, "includeExcluded"));
    expect(다음.filters.includeExcluded, "스위치는 꺼진 채로 넘어가야 한다").toBe(false);
    expect([...다음.showExcluded], "펼침이 남으면 펼친 모양인데 아래가 텅 빈다").toEqual([]);
    // 두 갈래를 펼쳐 뒀어도 전부 접힌다(한 갈래만 접히면 나머지가 또 빈 카드가 된다)
    const 둘펼침 = nextFundingState(켠거르개, new Set<FundingGroup>(["grant", "bank"]), {
      ...켠거르개,
      includeExcluded: false,
    });
    expect([...둘펼침.showExcluded]).toEqual([]);
  });

  it("스위치를 켜는 것만으로는 펼침이 안 채워진다 — 갈래는 눌러서 펼치는 것이 계약이다", () => {
    const 다음 = nextFundingState(기본거르개, new Set<FundingGroup>(), nextFilters(기본거르개, "includeExcluded"));
    expect(다음.filters.includeExcluded).toBe(true);
    expect([...다음.showExcluded], "켰다고 전 갈래를 펼치면 안 된다").toEqual([]);
    // 켤 때 이미 펼쳐 둔 갈래가 있으면 그대로 둔다(끄는 방향에만 손댄다)
    const 남김 = nextFundingState(기본거르개, grant펼침, { ...기본거르개, includeExcluded: true });
    expect(남김.showExcluded, "켜는 방향에서는 받은 집합을 그대로 돌려준다").toBe(grant펼침);
  });

  it("다른 칩(지금 신청 가능·7일 안에 마감)을 뒤집을 때는 펼침이 안 바뀐다", () => {
    for (const 칩 of ["openOnly", "soonOnly"] as const) {
      const 다음 = nextFundingState(켠거르개, grant펼침, nextFilters(켠거르개, 칩));
      expect(다음.filters[칩], `${칩} 만 뒤집혀야 한다`).toBe(true);
      expect(다음.filters.includeExcluded, "다른 칩이 스위치를 건드리면 안 된다").toBe(true);
      expect(다음.showExcluded, "펼침은 같은 집합 그대로여야 한다(헛 그리기 금지)").toBe(grant펼침);
    }
    // 「칩 모두 풀기」(openOnly·soonOnly 만 끄는 길)도 펼침을 안 건드린다
    const 모두풀기 = nextFundingState(
      { openOnly: true, soonOnly: true, includeExcluded: true },
      grant펼침,
      { openOnly: false, soonOnly: false, includeExcluded: true },
    );
    expect(모두풀기.showExcluded).toBe(grant펼침);
  });

  it("「카드에서 펼침 → 표에서 끔 → 카드 복귀」 를 이어 돌리면 빈 펼침이 안 남는다", () => {
    // ① 카드 보기에서 grant 「안 맞아서 뺀 N건 보기」 — 부모 toggleExcluded 와 같은 규칙
    const 펼친집합 = toggleGroupSet(new Set<FundingGroup>(), "grant");
    const 펼친거르개: FundingFilters = { ...기본거르개, includeExcluded: 펼친집합.size > 0 };
    expect([...펼친집합]).toEqual(["grant"]);
    expect(펼친거르개.includeExcluded, "펼치면 서버에 안 맞음까지 달라고 물어야 한다").toBe(true);

    // ② 표 보기로 옮겨 「안 맞는 공고도 보기」 손잡이를 끈다(거르개만 바뀌는 길)
    const 끈뒤 = nextFundingState(펼친거르개, 펼친집합, nextFilters(펼친거르개, "includeExcluded"));

    // ③ 카드 보기로 복귀 — 서버가 안 맞음을 안 싣는 상태이므로 펼침도 비어 있어야 한다
    expect(끈뒤.filters.includeExcluded).toBe(false);
    expect([...끈뒤.showExcluded], "여기 갈래가 남는 것이 배포본에서 재현된 그 결함이다").toEqual([]);
  });

  it("갈래 단추 경로는 예전 그대로다 — 두 길이 같은 규칙을 쓴다(대조)", () => {
    // 부모 toggleExcluded 의 규칙 그대로: 집합을 먼저 뒤집고, 비면 스위치를 끈다
    const 접은집합 = toggleGroupSet(grant펼침, "grant");
    const 접은거르개: FundingFilters = { ...켠거르개, includeExcluded: 접은집합.size > 0 };
    expect([...접은집합]).toEqual([]);
    expect(접은거르개.includeExcluded).toBe(false);
    // 같은 자리를 nextFundingState 로 통과시켜도 결과가 같다(두 길이 갈리지 않는다)
    const 통과 = nextFundingState(켠거르개, 접은집합, 접은거르개);
    expect(통과.filters).toEqual(접은거르개);
    expect([...통과.showExcluded]).toEqual([]);
    // 갈래를 켜는 쪽도 그대로 — 집합이 차면 스위치가 켜진다
    const 켠집합 = toggleGroupSet(new Set<FundingGroup>(), "policy");
    expect(켠집합.size > 0).toBe(true);
  });
});

describe("showsMap — 탐색 회귀 금지", () => {
  it("진단 모드에서 「지도」를 고른 때만 전폭 지도를 그린다", () => {
    expect(showsMap("diagnosed", "map")).toBe(true);
    expect(showsMap("diagnosed", "list")).toBe(false);
    expect(showsMap("browse", "map")).toBe(false); // 탐색은 언제나 기존 두 컬럼
    expect(showsMap("browse", "list")).toBe(false);
  });
});

describe("mapUiReducer — 판 갈아타기·서랍", () => {
  const 처음: MapUiState = { view: "map", openItem: null };

  it("항목을 고르면 서랍이 열리고 판은 그대로", () => {
    const s = mapUiReducer(처음, { type: "open", item: 항목("a:1") });
    expect(s.openItem?.id).toBe("a:1");
    expect(s.view).toBe("map");
  });

  it("서랍의 「상세·AI 판정 열기」는 목록·상세로 건너가며 서랍을 닫는다", () => {
    const 열림 = mapUiReducer(처음, { type: "open", item: 항목("a:1") });
    const s = mapUiReducer(열림, { type: "detail" });
    expect(s.view).toBe("list");
    expect(s.openItem).toBeNull();
  });

  it("알약으로 목록·상세로 가면 서랍은 닫힌다(서랍은 지도의 것)", () => {
    const 열림 = mapUiReducer(처음, { type: "open", item: 항목("a:1") });
    expect(mapUiReducer(열림, { type: "view", view: "list" })).toEqual({ view: "list", openItem: null });
    // 지도로 돌아올 때는 열려 있던 서랍을 되살리지 않는다
    expect(mapUiReducer({ view: "list", openItem: null }, { type: "view", view: "map" })).toEqual({ view: "map", openItem: null });
  });

  it("진단을 새로 돌리면 지도부터 보여 준다", () => {
    const s = mapUiReducer({ view: "list", openItem: 항목("a:9") }, { type: "diagnosed" });
    expect(s).toEqual({ view: "map", openItem: null });
  });

  it("닫기는 서랍만 닫는다", () => {
    const 열림 = mapUiReducer(처음, { type: "open", item: 항목("a:1") });
    expect(mapUiReducer(열림, { type: "close" })).toEqual({ view: "map", openItem: null });
  });

  it("바뀔 것이 없으면 있던 것을 그대로 돌려준다(뜻 없는 다시 그리기 금지)", () => {
    expect(mapUiReducer(처음, { type: "close" })).toBe(처음);
    expect(mapUiReducer(처음, { type: "view", view: "map" })).toBe(처음);
  });
});

describe("첫 화면(탐색) — 배선을 바꿔도 그대로 그려진다", () => {
  it("진단 전에는 두 컬럼(목록+상세)이고 지도·판 갈아타기 알약은 없다", () => {
    // Next 는 클라이언트 부품도 첫 방문에 서버에서 한 번 그린다 — 여기서 터지면 화면이 500 이 된다.
    // 손잡이(useEffect)는 서버 그리기에서 돌지 않으므로 통로를 부르지 않는다.
    const html = renderToStaticMarkup(
      createElement(PolicyMatchScreen, { endpoints: ERP_POLICY_MATCH_ENDPOINTS }),
    );
    expect(html).toContain("lg:grid-cols-12"); // 기존 두 컬럼 배치
    expect(html).not.toContain("결과 보기"); // 진단 전 = 알약 없음
  });
});
