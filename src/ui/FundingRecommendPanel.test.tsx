import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import FundingRecommendPanel, {
  FACTS_POLL_MAX,
  FACTS_POLL_MS,
  LOAD_ERROR,
  ProfileNotice,
  RecommendPanel,
  fundingFetchKeys,
  fundingMapQuery,
  isAbortError,
  nextFactsPollMs,
  openRecommendItem,
  openTargetOf,
  startFundingMapFetch,
  unknownCountOf,
  viewState,
  type FundingFetchResult,
  type RecommendFundingData,
} from "./FundingRecommendPanel";
import InlineFundingSummary from "./policy/InlineFundingSummary";
import { FUNDING_TOP_N } from "./policy/result-one-list";
import { FUNDING_GROUPS, type FundingGroup } from "../funding/funding-group";
import {
  deadlineOfAnnouncement,
  deadlineOfProduct,
  gapParts,
  profileBandParts,
  type FundingFilters,
  type FundingItem,
} from "../funding/funding-map";

/**
 * 통합 상세창 「추천 정책」 탭.
 *
 * 2026-09-03 Task 20 에 옛 `RecommendList` 를 자금 조달 지도(`FundingMap` compact)로 바꿨고,
 * 2026-10-07 에 다시 정책매칭 화면과 **같은 목록 부품**(`ResultOneList layout="inline"`)으로 바꿨다 —
 * 판정 탭(지원 가능·확인 필요) · 돈의 성격 칩 · 찾기 · 정렬 · 쪽 넘김, 줄을 누르면 그 줄 아래로 요약이 펼쳐진다.
 * 조건이 확실히 안 맞는 공고(excluded)는 아예 안 보인다(사장님 결정) — 「안 맞아서 뺀 N건 보기」 배선 시험은 지웠다.
 *
 * 재는 방법은 같은 저장소 전례 그대로 `renderToStaticMarkup` 이다(이 저장소엔 jsdom·testing-library 가 없다).
 * 누르는 동작은 순수 함수(`openTargetOf`·`openRecommendItem`·`fundingMapQuery`)를 직접 불러 잰다.
 * 목록 안의 탭·칩·정렬·쪽·펼침 규칙은 `policy/result-one-list.test.tsx` 가 잰다.
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

/** 안 맞음(excluded) 항목 — 서버가 실수로 실어 보내도 화면에 안 나오는지 재는 데만 쓴다. */
const 안맞음공고 = mk({
  id: "a:9",
  group: "grant",
  refId: "ann-9",
  title: "전북 스마트공장 구축지원",
  fit: [{ label: "지역 전북 소재", verdict: "fail", note: "프로필은 서울" }],
  fitVerdict: "excluded",
});

/** 갈래 한 칸 — 서버 계약대로 **정상만** `items` 에 담고 안 맞음은 `excludedItems` 로 따로 싣는다. */
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
    // 단정문의 유일한 근거 — 기본 자료는 **회사 정보가 있는** 회사다.
    profileEmpty: false,
    ...over,
  };
}

const 기본거르개: FundingFilters = { openOnly: false, soonOnly: false, includeExcluded: false };

/** 낱말이 몇 번 나오는지 — 「있다/없다」로는 같은 말이 두 번 나오는 것을 못 잡는다. */
const 세기 = (html: string, 낱말: string): number => html.split(낱말).length - 1;

function 판(
  over: {
    data?: RecommendFundingData | null;
    loading?: boolean;
    error?: string;
    drawerItem?: FundingItem | null;
    onOpenDetail?: (id: string) => void;
    onOpenCompanyStatus?: () => void;
  } = {},
): string {
  return renderToStaticMarkup(
    <RecommendPanel
      data={over.data === undefined ? 자료() : over.data}
      loading={over.loading ?? false}
      error={over.error ?? ""}
      query=""
      askedQuery=""
      onQuery={() => {}}
      drawerItem={over.drawerItem ?? null}
      onOpen={() => {}}
      onOpenDetail={over.onOpenDetail}
      onOpenCompanyStatus={over.onOpenCompanyStatus}
      onCloseDrawer={() => {}}
      onRefresh={() => {}}
      now={NOW}
    />,
  );
}

describe("추천 정책 탭 — 정책매칭 화면과 같은 목록(inline)", () => {
  it("판정 탭 두 개·돈의 성격 칩·찾기·정렬이 그려지고, 「다시 추천」과 원문 확인 안내가 남는다", () => {
    const html = 판();
    expect(html).toContain('data-layout="inline"');
    expect(html).toContain('data-tab="fit"');
    expect(html).toContain('data-tab="unverified"');
    expect(html).toContain("지원 가능");
    expect(html).toContain("확인 필요");
    expect(html).toContain("안 갚아도 되는 돈"); // 돈의 성격 칩
    expect(html).toContain("은행에서 바로");
    expect(html).toContain('aria-label="공고 찾기"');
    expect(html).toContain('aria-label="정렬"');
    expect(html).toContain("스마트상점 기술보급사업 3차"); // 지원 가능 탭이 먼저 열린다
    expect(html).toContain("다시 추천");
    expect(html).toContain("최종 자격은 공고 원문에서 확인");
  });

  it("옛 지도 모양(숫자 4칸·갈래 카드·두 칸 상자)이 없다", () => {
    const html = 판();
    expect(html, "한눈에 4칸이 남았다").not.toContain("지금 신청 가능");
    expect(html, "두 칸 상자는 정책매칭 화면 전용이다").not.toContain('data-area="result-two-pane"');
    expect(html).not.toContain("전체 공고 탐색");
  });

  it("안 맞는 공고는 탭·건수·줄·펼침 어디에도 없다 — 서버가 실어 보내도 안 그린다", () => {
    const html = 판({
      data: 자료({
        groups: FUNDING_GROUPS.map((group) =>
          갈래칸(group, group === "grant" ? [공고, 안맞음공고] : group === "bank" ? [상품] : []),
        ),
      }),
    });
    expect(html).not.toContain("전북 스마트공장 구축지원");
    expect(html).not.toContain("어려움");
    expect(html).not.toContain('data-tab="excluded"');
    expect(html).not.toContain("안 맞아서 뺀");
  });

  it("처음엔 아무 줄도 안 펼친다 — 누르면 그 줄 아래로 펼친다(aria-expanded)", () => {
    const html = 판();
    expect(html).toMatch(/data-row="a:1"[^>]*aria-expanded="false"/);
    expect(html).not.toContain('data-area="row-detail"');
  });

  it("판정에 쓴 회사 정보를 머리 카드가 라벨·값으로 밝힌다(찾은 고객)", () => {
    const html = 판();
    const 띠 = profileBandParts(["지역 전북", "직원수 10명"]);
    expect(html).toContain(띠.label);
    expect(html).toContain(띠.value);
    expect(html).not.toContain("찾지 못했어요");
    expect(html, "옛 「대조에 쓴 정보」 문구").not.toContain("대조에 쓴 정보");
  });

  it("고객을 못 찾으면 「이 사업장 정보를 찾지 못했어요」 안내가 뜬다", () => {
    const html = 판({ data: 자료({ matchedCompany: null, usedProfile: [], profileEmpty: true }) });
    expect(html).toContain("이 사업장 정보를 찾지 못했어요");
    expect(html).toContain("조건 판정 없이 지금 열려 있는 자금만 보여 드립니다");
    expect(html).not.toContain(profileBandParts(["지역 전북", "직원수 10명"]).value);
  });

  /** 머리 카드의 빈칸 힌트는 끄고(`showGap={false}`), 목록 위 「모르는 N칸 때문에 …」 안내 한 곳이 말한다. */
  it("모름 칸 안내는 머리 카드가 아니라 목록 위 한 곳에서만 — 지도 빈칸 힌트가 안 겹친다", () => {
    const html = 판({ data: 자료({ usedProfile: [], profileEmpty: true }) });
    const 힌트 = gapParts(["신용점수"]);
    expect(힌트, "이 시험 자료엔 빈 칸이 1개다").not.toBeNull();
    expect(html, "지도 빈칸 힌트가 남았다").not.toContain(힌트!.title);
    expect(html, "못 찾음 안내는 이 자리에선 안 뜬다").not.toContain("찾지 못했어요");
    expect(unknownCountOf(자료())).toBe(1);
    expect(unknownCountOf(null)).toBeNull();
    const 칸없음 = 자료();
    delete (칸없음 as { profileGaps?: string[] }).profileGaps;
    expect(unknownCountOf(칸없음), "칸이 없으면 0 으로 지어내지 않는다").toBeNull();
  });

  it("회사 정보가 비면 「조건을 맞춰 보지 않은 목록」이라 밝히고 「자동 대조 결과」라고 하지 않는다", () => {
    const 없음값 = profileBandParts([]).value;
    const html = 판({ data: 자료({ usedProfile: [], profileEmpty: true }) });
    expect(html, "위 구역이 그 사실을 말해야 한다").toContain(없음값);
    expect(html).not.toContain("자동 대조 결과입니다");
    expect(html).toContain("최종 자격은 공고 원문에서 확인하세요.");
    expect(세기(html, "최종 자격은 공고 원문에서 확인"), "같은 말이 두 번 나온다").toBe(1);

    const 맞춤 = 판();
    expect(맞춤).toContain("자동 대조 결과입니다 — 최종 자격은 공고 원문에서 확인하세요.");
    expect(맞춤).not.toContain(없음값);
  });

  it("matchedCompany 는 null 일 때만 「찾지 못했어요」 — 칸이 없으면(undefined) 아무 말도 안 한다", () => {
    const 없는칸 = 자료({ usedProfile: [], profileEmpty: true });
    delete (없는칸 as { matchedCompany?: string | null }).matchedCompany;
    const 생략 = 판({ data: 없는칸 });
    expect(생략).not.toContain("이 사업장 정보를 찾지 못했어요");
    expect(생략, "목록 자체는 그대로 그린다").toContain("스마트상점 기술보급사업 3차");

    expect(renderToStaticMarkup(<ProfileNotice matchedCompany={undefined} usedProfile={[]} />)).toBe("");
    expect(renderToStaticMarkup(<ProfileNotice matchedCompany={null} usedProfile={[]} />)).toContain(
      "이 사업장 정보를 찾지 못했어요",
    );
    expect(renderToStaticMarkup(<ProfileNotice matchedCompany="삼영식품" usedProfile={["지역 전북"]} />)).toBe("");
  });

  it("발 안내는 profileEmpty 로만 가린다 — 칸이 없는 옛 통로는 예전 문구 그대로", () => {
    expect(판({ data: 자료({ usedProfile: [], profileEmpty: false }) })).toContain("자동 대조 결과입니다");
    const 옛통로 = 자료({ usedProfile: ["지역 전북"] });
    delete (옛통로 as { profileEmpty?: boolean }).profileEmpty;
    expect(판({ data: 옛통로 })).toContain("자동 대조 결과입니다");
  });

  it("재조회 중에는 목록이 흐려지고, 「다시 추천」은 목록 밖 머리에 있어 그대로 눌린다", () => {
    const html = 판({ loading: true });
    expect(html).toContain("opacity-60");
    const i단추 = html.indexOf("다시 추천");
    const i목록 = html.indexOf('data-area="result-one-list"');
    expect(i단추, "「다시 추천」이 없다").toBeGreaterThan(-1);
    expect(i단추, "「다시 추천」이 흐려지는 목록 안에 들어갔다").toBeLessThan(i목록);
    expect(html, "앞 자료를 지우지 않는다 — 흐려질 뿐").toContain("스마트상점 기술보급사업 3차");
  });

  it("「다시 추천」은 머리 카드 라벨 줄 안에 있다 — 단추만 있는 별도 줄이 아니다", () => {
    const html = 판();
    const i라벨 = html.indexOf("판정에 쓴 정보");
    const i단추 = html.indexOf("다시 추천");
    const i값 = html.indexOf(profileBandParts(["지역 전북", "직원수 10명"]).value);
    expect(i단추).toBeGreaterThan(i라벨);
    expect(i값).toBeGreaterThan(i단추);
  });

  it("오류면 목록 대신 안내가 뜨고 「다시 추천」은 남는다", () => {
    const html = 판({ data: null, error: LOAD_ERROR });
    expect(html).toContain(LOAD_ERROR);
    expect(html).toContain("다시 추천");
    expect(html).not.toContain("스마트상점 기술보급사업 3차");
  });

  it("첫 로딩은 뼈대만 — 「다시 추천」은 그때도 누를 수 있다", () => {
    const html = 판({ data: null, loading: true });
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("다시 추천");
  });

  it("상품을 고르면 서랍이 열리고, 안 고르면 서랍이 없다", () => {
    const open = 판({ drawerItem: 상품 });
    expect(open).toContain("상품 정보");
    expect(open).toContain("개인사업자 · 사업기간 3개월 이상");
    expect(판()).not.toContain("상품 정보");
  });

  it("공고는 상세창이 이미 가진 상세로, 상품은 서랍으로 보낸다", () => {
    expect(openTargetOf(공고, true)).toBe("detail");
    expect(openTargetOf(상품, true)).toBe("drawer");
    expect(openTargetOf(공고, false)).toBe("drawer");

    const 상세 = vi.fn();
    const 서랍 = vi.fn();
    openRecommendItem(공고, { onOpenDetail: 상세, openDrawer: 서랍 });
    expect(상세).toHaveBeenCalledWith("ann-1");
    expect(서랍).not.toHaveBeenCalled();
    openRecommendItem(상품, { onOpenDetail: 상세, openDrawer: 서랍 });
    expect(서랍).toHaveBeenCalledWith(상품);
    openRecommendItem(공고, { openDrawer: 서랍 });
    expect(서랍, "상세 손잡이가 없으면 공고도 서랍이 받는다").toHaveBeenLastCalledWith(공고);
  });

  it("주소 한 줄에 번호·상호·칩·정렬·상위 N 이 실린다 — 기본 상위 N 은 정책매칭 화면과 같은 80", () => {
    const qs = fundingMapQuery({
      bizno: "1234567890",
      companyName: "삼영식품",
      filters: { openOnly: true, soonOnly: false, includeExcluded: false },
      sort: "dead",
    });
    expect(qs).toContain("bizno=1234567890");
    expect(qs).toContain(`name=${encodeURIComponent("삼영식품")}`);
    expect(qs).toContain("open=1");
    expect(qs).not.toContain("soon=1");
    expect(qs).toContain("sort=dead");
    expect(qs).toContain(`topN=${FUNDING_TOP_N}`);
    expect(FUNDING_TOP_N).toBe(80);
    expect(qs, "이 패널은 안 맞음을 달라고 하지 않는다").not.toContain("excluded=");
  });

  it("includeExcluded 가 켜지면 excluded=1(다른 부르는 쪽을 위해 남긴 길)", () => {
    const 켜짐 = fundingMapQuery({ companyName: "삼영식품", filters: { ...기본거르개, includeExcluded: true }, sort: "rec" });
    expect(켜짐).toContain("excluded=1");
    expect(켜짐).not.toContain("fit=1");
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

  it("다시 부르는 동안에는 앞 자료를 그대로 둔다(같은 회사)", () => {
    const 끝난것: FundingFetchResult = { requestKey: "0|a", companyKey: "123|삼영식품", data: 자료(), error: "" };
    const 도는중 = viewState(끝난것, "1|a", "123|삼영식품");
    expect(도는중.loading).toBe(true);
    expect(도는중.data).not.toBeNull();
    expect(도는중.error).toBe("");
  });

  it("회사가 바뀌면 앞 회사 목록을 절대 안 보여 준다", () => {
    const 앞회사: FundingFetchResult = { requestKey: "0|a", companyKey: "123|삼영식품", data: 자료(), error: "" };
    const 새회사 = viewState(앞회사, "0|c", "999|대한식품");
    expect(새회사.data).toBeNull();
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
  });

  it("raw Tailwind 색이 없다", () => {
    const html = 판({ drawerItem: 상품 }) + renderToStaticMarkup(<InlineFundingSummary item={공고} onOpen={() => {}} now={NOW} />);
    expect(html).not.toMatch(/(bg|text|border)-(red|green|amber|blue|gray|slate|sky|orange|yellow)-[0-9]{2,3}/);
  });
});

describe("추천 정책 탭 — 줄 아래 펼침 요약(InlineFundingSummary)", () => {
  it("얼마까지 · 갚아야 하나 · 언제까지 · 어디에 신청 · 조건 목록 · 「공고 상세 열기」", () => {
    const html = renderToStaticMarkup(<InlineFundingSummary item={공고} onOpen={() => {}} now={NOW} />);
    expect(html).toContain("얼마까지");
    expect(html).toContain("언제까지");
    expect(html).toContain("어디에 신청");
    expect(html).toContain("지역 전북");
    expect(html).toContain("공고 상세 열기");
    expect(html).toContain('data-open-detail="a:1"');
  });

  it("상품은 「상품 상세 열기」, 값이 없는 칸은 줄을 안 그린다", () => {
    const html = renderToStaticMarkup(
      <InlineFundingSummary item={{ ...상품, amountText: "", where: "", agency: "" }} onOpen={() => {}} now={NOW} />,
    );
    expect(html).toContain("상품 상세 열기");
    expect(html).not.toContain("얼마까지");
    expect(html).not.toContain("어디에 신청");
  });
});

/**
 * 피드백과 다른 칸 알림(2026-10-06) — 응답의 `feedbackDiff` 와 부모가 넘긴 `onOpenCompanyStatus` 가
 * 레일(compact)의 머리 카드까지 이어지는지. 알림 구역의 모양·글자는 `funding-map-render.test.tsx` 가 잰다.
 * 랩이 아닌 앱(ERP·일루아)은 둘 다 안 넘기므로, 안 넘기면 기존 화면과 같아야 한다.
 */
describe("추천 정책 탭 — 피드백과 다른 칸 알림 배선(feedbackDiff·onOpenCompanyStatus)", () => {
  const 알림: RecommendFundingData["feedbackDiff"] = {
    round: 3,
    at: "2026-10-01T03:00:00.000Z",
    rows: [{ field: "employeeCount", label: "직원수", current: "10명", feedback: "12명" }],
  };

  it("응답에 feedbackDiff 가 있으면 레일 머리 카드에 구역이 그려지고, 좁은 폭이라 표 대신 카드다", () => {
    const html = 판({ data: 자료({ feedbackDiff: 알림 }) });
    expect(html).toContain("피드백 3회차(10/1)와 기업상태표 비교 · 판정에는 안 씀");
    expect(html).toContain("다른 칸 1개 — 맞으면 상태표를 고쳐 주세요");
    expect(html, "레일은 compact 라 표가 아니라 작은 카드여야 한다").toContain("rounded-wedly-inner");
    expect(html).not.toContain("<table");
  });

  it("onOpenCompanyStatus 를 넘기면 `기업상태표 열기` 단추가 한 개, 안 넘기면 없다", () => {
    expect(세기(판({ data: 자료({ feedbackDiff: 알림 }), onOpenCompanyStatus: () => {} }), "기업상태표 열기")).toBe(1);
    expect(판({ data: 자료({ feedbackDiff: 알림 }) })).not.toContain("기업상태표 열기");
  });

  it("feedbackDiff 가 없거나 null 이면 구역도 단추도 없다 — 손잡이만 넘겨도 마찬가지(옛 통로·다른 앱 불변)", () => {
    for (const 칸 of [undefined, null]) {
      const html = 판({ data: 자료({ feedbackDiff: 칸 }), onOpenCompanyStatus: () => {} });
      expect(html).not.toContain("판정에는 안 씀");
      expect(html).not.toContain("기업상태표 열기");
    }
  });

  it("모양이 틀린 feedbackDiff 는 없는 것으로 본다 — 화면이 터지지 않는다", () => {
    const 이상한 = 자료();
    (이상한 as unknown as Record<string, unknown>).feedbackDiff = { round: "3", at: 1, rows: "x" };
    let html = "";
    expect(() => {
      html = 판({ data: 이상한, onOpenCompanyStatus: () => {} });
    }).not.toThrow();
    expect(html).not.toContain("판정에는 안 씀");
    expect(html).not.toContain("기업상태표 열기");
    expect(html, "지도는 그대로 그린다").toContain("안 갚아도 되는 돈");
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

/**
 * ★코덱스 2차 #5(2026-09-04) — 「다시 추천」을 연타하면 **요청이 쌓였다**. 단추를 재조회 중에도 누를
 *  수 있게 만든 것은 계약이지만(지적 F), 예전 구현은 앞 요청의 **응답만 버렸을 뿐**(`alive` 깃발)
 *  회선·서버는 계속 물고 있었다. 이제 `AbortController` 로 그 자리에서 끊는다.
 *
 * 효과를 돌릴 브라우저 흉내(jsdom)가 없으므로, 화면이 실제로 부르는 함수(`startFundingMapFetch`)를
 * 직접 불러 잰다 — 효과의 정리 함수가 이 함수가 돌려준 것 그대로다.
 */
describe("추천 정책 탭 — 재조회 연타로 요청이 쌓이지 않는다(AbortController)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** 미시 작업 대기열을 비운다 — 취소·거절이 catch 까지 도달했는지 보려면 한 바퀴 이상 돌려야 한다. */
  const 한바퀴 = () => new Promise((r) => setTimeout(r, 0));

  const 취소오류 = () => Object.assign(new Error("aborted"), { name: "AbortError" });

  /** 신호가 끊길 때까지 안 끝나는 응답 — 진짜 fetch 와 같은 방식으로 AbortError 를 낸다. */
  function 끝나지않는응답(signal: AbortSignal): Promise<never> {
    return new Promise((_, reject) => {
      signal.addEventListener("abort", () => reject(취소오류()));
    });
  }

  function 시작(url: string, requestKey: string, 받은: FundingFetchResult[]) {
    return startFundingMapFetch({
      url,
      requestKey,
      companyKey: "/api/x|1234567890|삼영식품",
      parseError: () => LOAD_ERROR,
      onResult: (r) => 받은.push(r),
    });
  }

  it("정리 함수를 부르면 앞 요청이 **실제로 끊긴다** — 응답만 버리지 않는다", async () => {
    const signals: AbortSignal[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: { signal?: AbortSignal }) => {
        const signal = init!.signal!;
        signals.push(signal);
        return 끝나지않는응답(signal);
      }),
    );

    const 받은: FundingFetchResult[] = [];
    const 정리 = 시작("/api/x?1", "r1", 받은);
    expect(signals, "요청에 취소 신호를 안 달았다").toHaveLength(1);
    expect(signals[0].aborted).toBe(false);

    정리();
    expect(signals[0].aborted, "앞 요청이 안 끊겼다 — 응답만 버렸다").toBe(true);
    await 한바퀴();
    expect(받은, "취소한 요청이 화면에 앉았다").toEqual([]);
  });

  it("연타하면 앞 요청이 그 자리에서 끊기고 마지막 것만 화면에 앉는다", async () => {
    const signals: AbortSignal[] = [];
    const 응답: Array<(b: unknown) => void> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: { signal?: AbortSignal }) => {
        const signal = init!.signal!;
        signals.push(signal);
        return new Promise((resolve, reject) => {
          signal.addEventListener("abort", () => reject(취소오류()));
          응답.push((b) => resolve({ json: () => Promise.resolve(b) } as unknown as Response));
        });
      }),
    );

    const 받은: FundingFetchResult[] = [];
    // 실제 화면 차례: 요청 열쇠가 바뀌면 효과의 **정리 함수가 먼저** 돌고 새 효과가 시작한다.
    const 정리1 = 시작("/api/x?1", "r1", 받은);
    정리1();
    const 정리2 = 시작("/api/x?2", "r2", 받은);

    expect(signals).toHaveLength(2);
    expect(signals[0].aborted, "앞 요청이 살아 있다 — 요청이 쌓인다").toBe(true);
    expect(signals[1].aborted, "새 요청까지 끊겼다").toBe(false);

    응답[1]({ success: true, data: 자료() });
    await 한바퀴();
    expect(받은.map((r) => r.requestKey), "마지막 요청 것만 앉아야 한다").toEqual(["r2"]);
    expect(받은[0].data).not.toBeNull();
    정리2();
  });

  /**
   * ★코덱스 3차 #A1(2026-09-04, 높음) — **영원한 로딩**이 나던 자리.
   *
   *  예전엔 오류의 **이름**이 `AbortError` 이기만 하면 결과 처리를 건너뛰었다. 그런데 앱의 fetch
   *  감싸개(프록시·계측 래퍼 등)가 **자체 시간 제한**으로 끊으면 우리 controller 는 취소한 적이
   *  없는데도 같은 이름의 오류가 온다 → `onResult` 가 영영 안 불려 화면이 뼈대(또는 흐린 옛 자료)에
   *  머문다. 이제 「우리가 취소했나」는 `controller.signal.aborted` 하나로만 가른다.
   */
  it("우리가 취소한 게 아닌 AbortError 는 오류로 처리한다 — 로딩이 안 끝나면 안 된다(3차 #A1)", async () => {
    // 감싸개의 자체 시간 제한 흉내: 우리 신호는 멀쩡한데 AbortError 이름으로 거절한다.
    const signals: AbortSignal[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: { signal?: AbortSignal }) => {
        signals.push(init!.signal!);
        return Promise.reject(취소오류());
      }),
    );
    const 받은: FundingFetchResult[] = [];
    시작("/api/x?1", "r1", 받은);
    await 한바퀴();

    expect(signals[0].aborted, "이 시험은 **우리가 안 끊은** 자리를 잰다").toBe(false);
    expect(받은, "결과가 안 와서 화면이 영원히 로딩에 머문다").toHaveLength(1);
    expect(받은[0].error).toBe(LOAD_ERROR);
    expect(받은[0].data).toBeNull();
  });

  it("우리가 끊은 요청의 오류는 이름이 무엇이든 조용히 넘긴다 — 신호 하나로만 가른다", async () => {
    // 이름이 AbortError 가 아닌 오류로 거절해도, 우리가 끊었으면 사용자 오류 문구를 안 띄운다.
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init?: { signal?: AbortSignal }) =>
          new Promise((_, reject) => {
            init!.signal!.addEventListener("abort", () => reject(new Error("연결이 닫혔습니다")));
          }),
      ),
    );
    const 받은: FundingFetchResult[] = [];
    const 정리 = 시작("/api/x?1", "r1", 받은);
    정리();
    await 한바퀴();
    expect(받은, "우리가 시킨 취소를 「불러오지 못했습니다」로 보여 준다").toEqual([]);
  });

  it("isAbortError 는 오류 **모양**만 가른다 — 취소 판정에는 쓰지 않는다", () => {
    expect(isAbortError(취소오류())).toBe(true);
    expect(isAbortError(new Error("네트워크 끊김")), "진짜 오류까지 취소로 읽는다").toBe(false);
    expect(isAbortError(null)).toBe(false);
  });

  it("진짜 통신 오류는 그대로 오류 문구로 보여 준다 — 취소 처리가 오류를 삼키지 않는다", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("네트워크 끊김"))));
    const 받은: FundingFetchResult[] = [];
    시작("/api/x?1", "r1", 받은);
    await 한바퀴();
    expect(받은).toHaveLength(1);
    expect(받은[0].error).toBe(LOAD_ERROR);
    expect(받은[0].data).toBeNull();
  });

  it("실패한 응답은 부르는 쪽의 오류 문구 규칙(parseError)으로 옮긴다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ json: () => Promise.resolve({ success: false }) } as unknown as Response)),
    );
    const 받은: FundingFetchResult[] = [];
    startFundingMapFetch({
      url: "/api/x?1",
      requestKey: "r1",
      companyKey: "c",
      parseError: () => "회사 정보를 찾지 못했습니다",
      onResult: (r) => 받은.push(r),
    });
    await 한바퀴();
    expect(받은[0].error).toBe("회사 정보를 찾지 못했습니다");
  });
});

/*
 * ※ ERP 원본(`ErpPolicyRecommendSection.test.tsx`)의 마지막 묶음
 *   「레일 탭(WideCenterWithRecommend)」 2건은 여기 없다 — 그 부품(`./policy-track-headers`)은
 *   상세창 레일을 그리는 **앱 부품**이라 이 보관함(설계서 §2 「패키지 밖(앱 몫)」)에 오지 않는다.
 *   그 2건은 ERP 저장소에 그대로 남긴다.
 */

describe("추천 정책 탭 — 피드백 기업 사실을 뽑는 중이면 다시 부르기(feedbackFactsPending)", () => {
  const base = { feedbackDiff: null } as unknown as RecommendFundingData;
  it("서버가 뽑는 중이라고 하면 30초 뒤 다시 부른다", () => {
    expect(nextFactsPollMs({ ...base, feedbackFactsPending: true }, false, 0)).toBe(FACTS_POLL_MS);
    expect(FACTS_POLL_MS).toBe(30_000);
  });
  it("다 뽑았거나 칸이 없거나(옛 통로·다른 앱) 모양이 틀리면 다시 부르지 않는다", () => {
    expect(nextFactsPollMs({ ...base, feedbackFactsPending: false }, false, 0)).toBeNull();
    expect(nextFactsPollMs(base, false, 0)).toBeNull();
    expect(nextFactsPollMs({ ...base, feedbackFactsPending: "true" as unknown as boolean }, false, 0)).toBeNull();
    expect(nextFactsPollMs(null, false, 0)).toBeNull();
  });
  it("조회 중에는 앞 자료로 판단하지 않는다 — 응답이 오면 그때 다시 정한다", () => {
    expect(nextFactsPollMs({ ...base, feedbackFactsPending: true }, true, 0)).toBeNull();
  });
  it("상한(20번 = 10분)에 닿으면 멈춘다 — 끝내 못 뽑는 회차가 요청을 끝없이 만들지 않는다", () => {
    expect(nextFactsPollMs({ ...base, feedbackFactsPending: true }, false, FACTS_POLL_MAX - 1)).toBe(FACTS_POLL_MS);
    expect(nextFactsPollMs({ ...base, feedbackFactsPending: true }, false, FACTS_POLL_MAX)).toBeNull();
    // 상한은 서버 최악(시도 2번 × (원문 2분 + AI 1분) = 6분)과 첫 조회 지연을 넉넉히 덮는다.
    expect(FACTS_POLL_MS * FACTS_POLL_MAX).toBeGreaterThanOrEqual(2 * (120_000 + 60_000) + 4 * 60_000);
  });
});
