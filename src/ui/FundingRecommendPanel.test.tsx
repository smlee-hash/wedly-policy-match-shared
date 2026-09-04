import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import FundingRecommendPanel, {
  COMPACT_TOP_N,
  LOAD_ERROR,
  ProfileNotice,
  RecommendPanel,
  fundingFetchKeys,
  fundingMapQuery,
  openTargetOf,
  resetExcludedForCompany,
  toggleExcludedGroup,
  viewState,
  type FundingFetchResult,
  type RecommendFundingData,
} from "./FundingRecommendPanel";
import { FUNDING_GROUPS, type FundingGroup } from "../funding/funding-group";
import {
  deadlineOfAnnouncement,
  deadlineOfProduct,
  profileBandWords,
  type FundingFilters,
  type FundingItem,
} from "../funding/funding-map";

/**
 * 통합 상세창 「추천 정책」 탭 — 2026-09-03 Task 20 으로 옛 `RecommendList`(카테고리 칩 + 공고 카드)를
 * 버리고 **자금 조달 지도 부품**(`FundingMap` compact + `FundingDrawer`)으로 갈아탔다.
 * 그래서 이 시험도 새 부품 기준으로 다시 썼다 — 옛 `RecommendList` 는 파일에서 사라졌다.
 *
 * ★재설계(계약 §G3, 2026-09-04 시안 3) — `fitOnly`(맞는 것만 좁히기)가 `includeExcluded`(안 맞음도
 *  보이기)로 뒤집혔고, 「대조에 쓴 정보: …」 안내는 `profileBandWords`(G1) 로 통일됐고, 갈래 카드의
 *  「안 맞아서 뺀 항목 보기」(showExcluded 집합)가 새로 배선됐다 — 아래 시험도 함께 바뀐다.
 *
 * 재는 방법은 같은 폴더·같은 저장소 전례 그대로 `renderToStaticMarkup` 이다(이 저장소엔 jsdom·
 * testing-library 가 없다 — `src/app/(erp)/policy-match/funding-map-render.test.tsx` 주석 참고).
 * 누르는 동작은 순수 함수(`openTargetOf`·`fundingMapQuery`·`toggleExcludedGroup`)를 직접 불러 잰다.
 */

const NOW = new Date("2026-09-03T10:00:00+09:00");
const 상시 = deadlineOfProduct("상시", NOW);

function mk(over: Partial<FundingItem> & { id: string; group: FundingGroup }): FundingItem {
  return {
    kind: "announcement",
    refId: over.id.slice(2),
    title: "예시 항목",
    agency: "중소벤처기업부",
    url: "https://example.kr/a/1",
    applyUrl: "",
    targetText: "",
    amountText: "최대 500만원",
    amountMaxWon: 5_000_000,
    rateText: "무상",
    rateMin: null,
    deadline: 상시,
    where: "관악구청",
    fit: [],
    fitVerdict: "unverified",
    humanCheck: 0,
    score: 10,
    why: "입력한 조건 2개 모두 맞음",
    source: "smes24",
    isNew: false,
    ...over,
  };
}

const 공고 = mk({
  id: "a:1",
  group: "grant",
  refId: "ann-1",
  title: "스마트상점 기술보급사업 3차",
  deadline: deadlineOfAnnouncement(new Date("2026-09-15T23:59:59+09:00"), "2026-08-01 ~ 2026-09-15", NOW),
  fit: [{ label: "지역 전북", verdict: "pass", note: "" }],
  fitVerdict: "fit",
  score: 90,
});

const 상품 = mk({
  id: "p:2",
  kind: "product",
  group: "bank",
  refId: "prod-2",
  title: "케이뱅크 사장님 대출",
  agency: "케이뱅크",
  where: "케이뱅크 앱",
  amountText: "최대 3억원",
  amountMaxWon: 300_000_000,
  rateText: "연 4.2%",
  rateMin: 4.2,
  source: "product-kbank",
  targetText: "개인사업자 · 사업기간 3개월 이상",
});

/** 안 맞음(excluded) 항목 — showExcluded 배선을 재는 데만 쓴다(공고·상품 기본 자료엔 안 섞는다). */
const 안맞음공고 = mk({
  id: "a:9",
  group: "grant",
  refId: "ann-9",
  title: "전북 스마트공장 구축지원",
  fit: [{ label: "지역 전북 소재", verdict: "fail", note: "프로필은 서울" }],
  fitVerdict: "excluded",
});

/**
 * 갈래 한 칸 — 서버 계약대로 **정상만** `items` 에 담고 안 맞음은 `excludedItems` 로 따로 싣는다
 * (코덱스 11차 #2 · W1). 시험 자료가 한 목록에 섞어 두면 화면이 다시 가르는 옛 구현도 통과한다.
 */
function 갈래칸(group: FundingGroup, mine: FundingItem[]) {
  const 정상 = mine.filter((it) => it.fitVerdict !== "excluded");
  const 안맞음 = mine.filter((it) => it.fitVerdict === "excluded");
  return {
    group,
    total: 정상.length,
    fit: 정상.filter((it) => it.fitVerdict === "fit").length,
    unverified: 정상.filter((it) => it.fitVerdict === "unverified").length,
    excluded: 안맞음.length,
    soon: 0,
    items: 정상,
    truncated: false,
    ...(안맞음.length > 0 ? { excludedItems: 안맞음 } : {}),
  };
}

function 자료(over: Partial<RecommendFundingData> = {}): RecommendFundingData {
  const items = [공고, 상품];
  return {
    groups: FUNDING_GROUPS.map((group) => 갈래칸(group, items.filter((it) => it.group === group))),
    glance: { open: 2, soon: 0, grantFit: 1, grantMaxWon: 5_000_000, minRate: 4.2 },
    profileGaps: ["신용점수"],
    unclassified: 0,
    generatedAt: "2026-09-03T01:00:00.000Z",
    matchedCompany: "삼영식품",
    usedProfile: ["지역 전북", "직원수 10명"],
    ...over,
  };
}

/** grant 갈래에 안맞음공고 한 건을 더 실은 자료 — showExcluded 배선 시험 전용. */
function 안맞음포함자료(): RecommendFundingData {
  return 자료({
    groups: FUNDING_GROUPS.map((group) =>
      갈래칸(group, group === "grant" ? [공고, 안맞음공고] : group === "bank" ? [상품] : []),
    ),
  });
}

const 기본거르개: FundingFilters = { openOnly: false, soonOnly: false, includeExcluded: false };

function 판(
  over: {
    data?: RecommendFundingData | null;
    loading?: boolean;
    error?: string;
    filters?: FundingFilters;
    drawerItem?: FundingItem | null;
    showExcluded?: ReadonlySet<FundingGroup>;
    onOpenDetail?: (id: string) => void;
    onToggleExcluded?: (group: FundingGroup) => void;
  } = {},
): string {
  return renderToStaticMarkup(
    <RecommendPanel
      data={over.data === undefined ? 자료() : over.data}
      loading={over.loading ?? false}
      error={over.error ?? ""}
      filters={over.filters ?? 기본거르개}
      sort="rec"
      drawerItem={over.drawerItem ?? null}
      showExcluded={over.showExcluded ?? new Set<FundingGroup>()}
      onFiltersChange={() => {}}
      onSortChange={() => {}}
      onOpen={() => {}}
      onOpenDetail={over.onOpenDetail}
      onCloseDrawer={() => {}}
      onRefresh={() => {}}
      onToggleExcluded={over.onToggleExcluded ?? (() => {})}
    />,
  );
}

describe("추천 정책 탭 — 자금 조달 지도", () => {
  it("6갈래 지도·한눈에 4칸·항목이 그려지고, 「다시 추천」과 원문 확인 안내가 남는다", () => {
    const html = 판();
    expect(html).toContain("안 갚아도 되는 돈");
    expect(html).toContain("은행에서 바로");
    expect(html).toContain("투자 받기");
    expect(html).toContain("지금 신청 가능"); // 한눈에 4칸
    expect(html).toContain("스마트상점 기술보급사업 3차");
    expect(html).toContain("케이뱅크 사장님 대출");
    expect(html).toContain("다시 추천");
    expect(html).toContain("최종 자격은 공고 원문에서 확인");
  });

  it("좁은 자리라 compact 로 넘긴다 — 3열·4열 배치와 「전체 공고 탐색」이 없다", () => {
    const html = 판();
    expect(html).not.toContain("lg:grid-cols-3"); // 갈래 카드가 2열까지만
    expect(html).not.toContain("lg:grid-cols-4"); // 한눈에 4칸도 2열까지만
    expect(html).not.toContain("전체 공고 탐색"); // 상세창엔 갈 곳이 없다
  });

  it("대조에 쓴 회사 정보를 profileBandWords 문장으로 밝힌다(찾은 고객, 계약 §G3)", () => {
    const html = 판();
    expect(html).toContain(profileBandWords(["지역 전북", "직원수 10명"]));
    expect(html).not.toContain("찾지 못해");
    expect(html, "옛 「대조에 쓴 정보」 문구는 profileBandWords 로 통일됐다").not.toContain("대조에 쓴 정보");
    expect(html, "「대조 기준」 낱말 금지(계약 낱말 규칙)").not.toContain("대조 기준");
  });

  it("고객을 못 찾으면 「조건 대조 없이」 안내가 뜬다", () => {
    const html = 판({ data: 자료({ matchedCompany: null, usedProfile: [] }) });
    expect(html).toContain("찾지 못해");
    expect(html).toContain("조건 대조 없이");
    expect(html).not.toContain(profileBandWords(["지역 전북", "직원수 10명"]));
  });

  it("고객은 찾았지만 대조할 정보가 한 칸도 없으면 같은 폴백 안내로 알린다", () => {
    const html = 판({ data: 자료({ usedProfile: [] }) });
    expect(html).toContain("비어 있어");
    expect(html).toContain("조건 대조 없이");
    expect(html).not.toContain("찾지 못해");
  });

  it("오류면 지도 대신 안내가 뜨고 「다시 추천」은 남는다", () => {
    const html = 판({ data: null, error: LOAD_ERROR });
    expect(html).toContain(LOAD_ERROR);
    expect(html).toContain("다시 추천");
    expect(html).not.toContain("안 갚아도 되는 돈"); // 지도는 안 그린다
  });

  it("첫 로딩은 뼈대만 — 「다시 추천」은 그때도 누를 수 있다", () => {
    const html = 판({ data: null, loading: true });
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("다시 추천");
  });

  it("상품을 고르면 서랍이 열리고, 안 고르면 서랍이 없다", () => {
    const open = 판({ drawerItem: 상품 });
    expect(open).toContain("상품 정보");
    expect(open).toContain("케이뱅크");
    expect(open).toContain("개인사업자 · 사업기간 3개월 이상"); // 대상 원문
    const closed = 판();
    expect(closed).not.toContain("상품 정보");
  });

  it("공고는 상세창이 이미 가진 상세로, 상품은 서랍으로 보낸다", () => {
    expect(openTargetOf(공고, true)).toBe("detail");
    expect(openTargetOf(상품, true)).toBe("drawer");
    // 상세를 열 손잡이가 없으면(그럴 자리는 없지만) 공고도 서랍으로 — 눌러도 아무 일도 안 하는 카드를 두지 않는다
    expect(openTargetOf(공고, false)).toBe("drawer");
  });

  it("주소 한 줄에 번호·상호·칩·정렬·상위 N 이 실린다 — 거르기는 서버 몫", () => {
    const qs = fundingMapQuery({
      bizno: "1234567890",
      companyName: "삼영식품",
      filters: { openOnly: true, soonOnly: false, includeExcluded: false },
      sort: "dead",
    });
    expect(qs).toContain("bizno=1234567890");
    expect(qs).toContain(`name=${encodeURIComponent("삼영식품")}`);
    expect(qs).toContain("open=1");
    expect(qs).not.toContain("soon=1"); // 꺼진 칩은 안 싣는다
    expect(qs).toContain("sort=dead");
    expect(qs).toContain(`topN=${COMPACT_TOP_N}`);
    expect(COMPACT_TOP_N).toBe(3);
  });

  it("재설계 §G1① — includeExcluded 가 켜지면 excluded=1(옛 fit=1 이 아니다)", () => {
    const 켜짐 = fundingMapQuery({ companyName: "삼영식품", filters: { ...기본거르개, includeExcluded: true }, sort: "rec" });
    expect(켜짐).toContain("excluded=1");
    expect(켜짐, "옛 이름 fit= 은 더 이상 안 쓴다").not.toContain("fit=1");

    const 꺼짐 = fundingMapQuery({ companyName: "삼영식품", filters: 기본거르개, sort: "rec" });
    expect(꺼짐, "꺼져 있으면 excluded 파라미터를 아예 안 싣는다").not.toContain("excluded=");
  });

  it("번호가 없으면 상호만으로도 부른다", () => {
    const qs = fundingMapQuery({ companyName: "삼영식품", filters: 기본거르개, sort: "rec" });
    expect(qs).not.toContain("bizno=");
    expect(qs).toContain("name=");
  });

  it("식별자가 하나도 없으면 대조할 수 없다고만 말한다(통로를 안 부른다)", () => {
    const html = renderToStaticMarkup(<FundingRecommendPanel />);
    expect(html).toContain("사업자번호가 있어야");
    expect(html).not.toContain("다시 추천");
  });

  it("안내 줄만 따로 그려도 세 갈래가 맞다 — 찾은 고객은 profileBandWords 문장", () => {
    expect(renderToStaticMarkup(<ProfileNotice matchedCompany="삼영식품" usedProfile={["지역 전북"]} />)).toContain(
      profileBandWords(["지역 전북"]),
    );
    expect(renderToStaticMarkup(<ProfileNotice matchedCompany={null} usedProfile={[]} />)).toContain("찾지 못해");
    expect(renderToStaticMarkup(<ProfileNotice matchedCompany="삼영식품" usedProfile={[]} />)).toContain("비어 있어");
  });

  it("칩·정렬을 바꿔 다시 부르는 동안에는 앞 자료를 그대로 둔다(같은 회사)", () => {
    const 끝난것: FundingFetchResult = { requestKey: "0|a", companyKey: "123|삼영식품", data: 자료(), error: "" };
    const 도는중 = viewState(끝난것, "0|b", "123|삼영식품"); // 칩 하나 눌러 요청 열쇠만 바뀐 상태
    expect(도는중.loading).toBe(true);
    expect(도는중.data).not.toBeNull(); // 지도가 사라졌다 나타나지 않는다 — 흐려질 뿐
    expect(도는중.error).toBe("");
  });

  it("회사가 바뀌면 앞 회사 지도를 절대 안 보여 준다", () => {
    const 앞회사: FundingFetchResult = { requestKey: "0|a", companyKey: "123|삼영식품", data: 자료(), error: "" };
    const 새회사 = viewState(앞회사, "0|c", "999|대한식품");
    expect(새회사.data).toBeNull();
    expect(새회사.error).toBe("");
    expect(새회사.loading).toBe(true);
  });

  it("아직 한 번도 안 끝났으면 첫 로딩, 끝나면 그 결과를 그린다", () => {
    expect(viewState(null, "0|a", "123|삼영식품")).toEqual({ data: null, error: "", loading: true });
    const 실패: FundingFetchResult = { requestKey: "0|a", companyKey: "123|삼영식품", data: null, error: LOAD_ERROR };
    const v = viewState(실패, "0|a", "123|삼영식품");
    expect(v.loading).toBe(false);
    expect(v.error).toBe(LOAD_ERROR);
  });

  it("가능/불가 단정 낱말이 없다", () => {
    const html = 판();
    expect(html).not.toContain("자격 있음");
    expect(html).not.toContain("신청하세요");
    expect(html).toContain("최종 자격은 공고 원문에서 확인");
  });

  it("raw Tailwind 색이 없다", () => {
    const html = 판({ drawerItem: 상품 });
    expect(html).not.toMatch(/(bg|text|border)-(red|green|amber|blue|gray|slate|sky|orange|yellow)-[0-9]{2,3}/);
  });
});

describe("추천 정책 탭 — 「안 맞아서 뺀 항목 보기」 배선(재설계 §G3, showExcluded)", () => {
  it("toggleExcludedGroup — 갈래 하나만 켜고 끄는 순수 집합 연산(원본은 안 바뀐다)", () => {
    const 빈집합 = new Set<FundingGroup>();
    const 켠것 = toggleExcludedGroup(빈집합, "grant");
    expect([...켠것]).toEqual(["grant"]);
    expect([...빈집합], "원본 집합은 그대로다(불변)").toEqual([]);
    const 끈것 = toggleExcludedGroup(켠것, "grant");
    expect([...끈것]).toEqual([]);
    // 다른 갈래는 서로 안 건드린다
    const 둘켠것 = toggleExcludedGroup(toggleExcludedGroup(빈집합, "grant"), "bank");
    expect([...둘켠것].sort()).toEqual(["bank", "grant"]);
  });

  it("showExcluded 에 그 갈래가 없으면 안 맞음 항목이 안 보인다(FundingMap 에 그대로 넘긴다)", () => {
    const html = 판({ data: 안맞음포함자료(), showExcluded: new Set<FundingGroup>() });
    expect(html).not.toContain("전북 스마트공장 구축지원");
  });

  it("showExcluded 에 그 갈래가 있으면 안 맞음 항목이 보인다(부모가 쥔 집합을 그대로 넘긴다)", () => {
    const html = 판({ data: 안맞음포함자료(), showExcluded: new Set<FundingGroup>(["grant"]) });
    expect(html).toContain("전북 스마트공장 구축지원");
  });

  it("다른 갈래(bank)가 켜져 있어도 grant 의 안 맞음 항목은 안 보인다(갈래별로 따로 쥔다)", () => {
    const html = 판({ data: 안맞음포함자료(), showExcluded: new Set<FundingGroup>(["bank"]) });
    expect(html).not.toContain("전북 스마트공장 구축지원");
  });

  /**
   * ★코덱스 11차 #10(2026-09-04) — 상세창 레일에서 다른 회사로 갈아타도 「안 맞아서 뺀 항목 펼침」이
   *  그대로 남아, 새 회사 자료를 `excluded=1` 로 물으면서 남의 회사에서 펼쳐 둔 갈래가 계속 열렸다.
   *  갈래 이름은 같아도 「무엇이 안 맞는지」는 회사마다 다르다.
   */
  it("회사가 바뀌면 펼침을 비우고 includeExcluded 를 끈다 — 이미 꺼져 있으면 같은 객체(헛조회 금지, 11차 #10)", () => {
    expect(resetExcludedForCompany({ openOnly: false, soonOnly: false, includeExcluded: true })).toEqual({
      openOnly: false,
      soonOnly: false,
      includeExcluded: false,
    });
    // 다른 칩(지금 신청 가능·7일 안 마감)은 회사가 바뀌어도 그대로 둔다
    expect(resetExcludedForCompany({ openOnly: true, soonOnly: true, includeExcluded: true })).toEqual({
      openOnly: true,
      soonOnly: true,
      includeExcluded: false,
    });
    // 이미 꺼져 있으면 **같은 객체**를 돌려준다 — 새 객체를 만들면 조회 열쇠가 바뀌어 조회가 한 번 더 돈다
    const 꺼짐 = { ...기본거르개 };
    expect(resetExcludedForCompany(꺼짐)).toBe(꺼짐);
  });
});

/**
 * ★코덱스 3차 #3(2026-09-04) — 같은 사업자번호·같은 칩인 채 통로(`endpoint`)만 바뀌면
 *  예전엔 조회 열쇠가 그대로라 재조회가 안 돌고 **앞 통로 자료가 새 통로 결과인 척** 계속 보였다.
 *  통로를 회사 열쇠에 섞어(그래서 요청 열쇠에도 섞여) 고쳤다.
 *
 *  재는 방법은 이 파일의 다른 배선 시험과 같다 — 효과를 돌릴 브라우저 흉내(jsdom)가 없으니
 *  화면이 실제로 쓰는 순수 함수 두 개(`fundingFetchKeys` → `viewState`)를 이어 붙여 잰다.
 *  열쇠가 바뀌면 조회 효과의 의존 배열(companyKey·requestKey)이 바뀌므로 재조회는 자동으로 따라온다.
 */
describe("추천 정책 탭 — 통로(endpoint)가 바뀌면 다시 부르고 앞 통로 자료를 안 보여 준다", () => {
  const 같은조회 = fundingMapQuery({ bizno: "1234567890", companyName: "삼영식품", filters: 기본거르개, sort: "rec" });
  const 앞통로 = fundingFetchKeys({ endpoint: "/api/a", bizno: "1234567890", companyName: "삼영식품", refreshKey: 0, query: 같은조회 });
  const 새통로 = fundingFetchKeys({ endpoint: "/api/b", bizno: "1234567890", companyName: "삼영식품", refreshKey: 0, query: 같은조회 });

  it("사업자번호·칩·정렬이 같아도 통로가 다르면 두 열쇠가 모두 달라진다(재조회가 돈다)", () => {
    expect(앞통로.companyKey, "통로가 회사 열쇠에 섞여야 한다").not.toBe(새통로.companyKey);
    expect(앞통로.requestKey, "통로가 요청 열쇠에도 섞여야 한다").not.toBe(새통로.requestKey);
    expect(앞통로.companyKey).toContain("/api/a");
    expect(새통로.companyKey).toContain("/api/b");
  });

  it("통로가 같으면 열쇠도 같다 — 헛조회를 만들지 않는다", () => {
    const 다시 = fundingFetchKeys({ endpoint: "/api/a", bizno: "1234567890", companyName: "삼영식품", refreshKey: 0, query: 같은조회 });
    expect(다시).toEqual(앞통로);
    // 「다시 추천」 회차만 올라도 요청 열쇠는 달라진다(회사 열쇠는 그대로)
    const 다시추천 = fundingFetchKeys({ endpoint: "/api/a", bizno: "1234567890", companyName: "삼영식품", refreshKey: 1, query: 같은조회 });
    expect(다시추천.companyKey).toBe(앞통로.companyKey);
    expect(다시추천.requestKey).not.toBe(앞통로.requestKey);
  });

  it("통로가 바뀐 순간 앞 통로 지도가 사라지고 로딩으로 바뀐다(앞 자료가 새 결과인 척 안 남는다)", () => {
    const 앞결과: FundingFetchResult = { requestKey: 앞통로.requestKey, companyKey: 앞통로.companyKey, data: 자료(), error: "" };
    const v = viewState(앞결과, 새통로.requestKey, 새통로.companyKey);
    expect(v.data, "앞 통로에서 받은 지도를 새 통로 화면에 그대로 두면 안 된다").toBeNull();
    expect(v.error).toBe("");
    expect(v.loading).toBe(true);
    const html = 판({ data: v.data, loading: v.loading });
    expect(html).toContain('aria-busy="true"');
    expect(html, "앞 통로 공고가 새 통로 화면에 남지 않는다").not.toContain("스마트상점 기술보급사업 3차");
  });

  it("새 통로 응답이 도착하면 화면이 새 결과로 바뀐다", () => {
    const 새자료 = 자료({
      groups: FUNDING_GROUPS.map((group) =>
        갈래칸(group, group === "grant" ? [mk({ id: "a:7", group: "grant", refId: "ann-7", title: "새 통로 전용 공고" })] : []),
      ),
    });
    const 새결과: FundingFetchResult = { requestKey: 새통로.requestKey, companyKey: 새통로.companyKey, data: 새자료, error: "" };
    const v = viewState(새결과, 새통로.requestKey, 새통로.companyKey);
    expect(v.loading).toBe(false);
    const html = 판({ data: v.data, loading: v.loading });
    expect(html).toContain("새 통로 전용 공고");
    expect(html).not.toContain("스마트상점 기술보급사업 3차");
  });

  it("앞 통로 응답이 늦게 도착해도 새 통로 화면에 못 앉는다", () => {
    const 늦게온앞결과: FundingFetchResult = { requestKey: 앞통로.requestKey, companyKey: 앞통로.companyKey, data: 자료(), error: "" };
    const v = viewState(늦게온앞결과, 새통로.requestKey, 새통로.companyKey);
    expect(v.data).toBeNull();
    expect(v.loading).toBe(true);
  });
});

/*
 * ※ ERP 원본(`ErpPolicyRecommendSection.test.tsx`)의 마지막 묶음
 *   「레일 탭(WideCenterWithRecommend)」 2건은 여기 없다 — 그 부품(`./policy-track-headers`)은
 *   상세창 레일을 그리는 **앱 부품**이라 이 보관함(설계서 §2 「패키지 밖(앱 몫)」)에 오지 않는다.
 *   그 2건은 ERP 저장소에 그대로 남긴다.
 */
