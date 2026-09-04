import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import FundingRecommendPanel, {
  COMPACT_TOP_N,
  LOAD_ERROR,
  ProfileNotice,
  RecommendPanel,
  fundingFetchKeys,
  fundingMapQuery,
  isAbortError,
  nextFundingState,
  openTargetOf,
  resetExcludedForCompany,
  startFundingMapFetch,
  toggleExcludedGroup,
  viewState,
  type FundingFetchResult,
  type RecommendFundingData,
} from "./FundingRecommendPanel";
// 표 위 「안 맞는 공고도 보기」 손잡이가 실제로 부르는 규칙 — 시험도 같은 함수를 탄다(글자 흉내 금지).
import { nextFilters } from "./FundingMap";
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
    // 단정문의 유일한 근거(코덱스 3차 #C) — 기본 자료는 **회사 정보가 있는** 회사다.
    profileEmpty: false,
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

/** 낱말이 몇 번 나오는지 — 「있다/없다」로는 같은 말이 두 번 나오는 것을 못 잡는다. */
const 세기 = (html: string, 낱말: string): number => html.split(낱말).length - 1;

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

  it("판정에 쓴 회사 정보를 머리 카드가 라벨·값으로 밝힌다(찾은 고객, A안)", () => {
    const html = 판();
    const 띠 = profileBandParts(["지역 전북", "직원수 10명"]);
    expect(html).toContain(띠.label);
    expect(html).toContain(띠.value);
    expect(html).not.toContain("찾지 못했어요");
    expect(html, "옛 「대조에 쓴 정보」 문구").not.toContain("대조에 쓴 정보");
    expect(html, "「대조 기준」 낱말 금지(계약 낱말 규칙)").not.toContain("대조 기준");
    expect(html, "라벨과 값을 콜론으로 붙이던 옛 한 줄 문장").not.toContain("이 사업장 정보로 판정");
  });

  /** ★A안 문구 교체 — 「통합 고객에서 …」 같은 내부 이름을 빼고, 무엇이 보이는지를 두 줄로 나눴다. */
  it("고객을 못 찾으면 「이 사업장 정보를 찾지 못했어요」 안내가 뜬다(새 문구)", () => {
    const html = 판({ data: 자료({ matchedCompany: null, usedProfile: [], profileEmpty: true }) });
    expect(html).toContain("이 사업장 정보를 찾지 못했어요");
    expect(html).toContain("조건 판정 없이 지금 열려 있는 자금만 보여 드립니다");
    expect(html, "옛 문구가 남아 있다").not.toContain("찾지 못해,");
    expect(html, "옛 문구가 남아 있다").not.toContain("조건 대조 없이");
    expect(html, "옛 문구가 남아 있다").not.toContain("통합 고객에서");
    expect(html).not.toContain(profileBandParts(["지역 전북", "직원수 10명"]).value);
  });

  /**
   * ★이번 재설계의 핵심 하나 — 예전엔 「쓸 정보 0개」일 때 노란 안내와 지도 빈칸 힌트가 **함께** 떠
   *  같은 말이 화면에 두 번 나왔다. 이제 「무엇을 입력해 달라」는 머리 카드 한 곳에서만 말한다.
   */
  it("「찾았는데 쓸 정보 0개」면 「입력해 주세요」가 한 번만 나온다 — 같은 말이 두 번 안 나온다(A안)", () => {
    const html = 판({ data: 자료({ usedProfile: [], profileEmpty: true }) });
    const 힌트 = gapParts(["신용점수"]);
    expect(힌트, "이 시험 자료엔 빈 칸이 1개다").not.toBeNull();
    expect(세기(html, "입력해 주세요"), "같은 말이 두 번 나온다").toBe(1);
    expect(세기(html, 힌트!.title), "빈칸 힌트 제목이 두 번 나온다").toBe(1);
    expect(html, "옛 폴백 안내가 되살아났다").not.toContain("비어 있어");
    expect(html, "옛 폴백 안내가 되살아났다").not.toContain("조건 대조 없이");
    expect(html, "못 찾음 안내는 이 자리에선 안 뜬다").not.toContain("찾지 못했어요");
    expect(html, "금색 글자 클래스가 남아 있다").not.toContain("text-wedly-gold");
  });

  /**
   * ★코덱스 5차 #1 → 3차 #C(2026-09-04) — 「조건을 안 맞춰 봤다」는 사실이 화면에서 사라졌던 자리.
   *  ⓐ 머리 카드 위 구역이 그 사실을 말하고 ⓑ 발 안내의 「자동 대조 결과입니다」는 **참일 때만** 쓴다.
   *  회사 정보 자체가 비면 아무 조건도 못 맞춰 본 것이 **확실하므로** 둘 다 그 자리에서만 움직인다.
   */
  it("회사 정보가 비면 「조건을 맞춰 보지 않은 목록」이라 밝히고 「자동 대조 결과」라고 하지 않는다", () => {
    const 없음값 = profileBandParts([]).value;
    const html = 판({ data: 자료({ usedProfile: [], profileEmpty: true }) });
    expect(html, "위 구역이 그 사실을 말해야 한다").toContain(없음값);
    expect(없음값).toBe("없음 — 조건을 맞춰 보지 않은 목록입니다");
    expect(html, "조건을 안 맞춰 본 목록을 「자동 대조 결과」라고 한다").not.toContain("자동 대조 결과입니다");
    expect(html, "늘 참인 뒷부분은 남는다").toContain("최종 자격은 공고 원문에서 확인하세요.");
    expect(세기(html, "최종 자격은 공고 원문에서 확인"), "같은 말이 두 번 나온다").toBe(1);

    // 실제로 맞춰 본 자료에서는 예전 문구 그대로다 — 조건을 좁혀 놓고 늘 빼 버리지 않는다
    const 맞춤 = 판();
    expect(맞춤).toContain("자동 대조 결과입니다 — 최종 자격은 공고 원문에서 확인하세요.");
    expect(맞춤).not.toContain(없음값);
  });

  /**
   * ★코덱스 2차 #3(2026-09-04) — 5차 #1 의 「undefined 도 null 과 같게」를 **되돌린다**.
   *  이름을 **생략한 것**(undefined)과 **못 찾았다고 말한 것**(null)은 다른 사실이다. 이 칸을 아예
   *  안 싣는 통로(옛 판·다른 앱)의 응답에 「찾지 못했어요 · 조건 판정 없이…」를 띄우면, 멀쩡히 찾아
   *  판정까지 한 목록을 「조건 판정 없는 목록」이라 단정하게 된다 — 모르면 아무 말도 하지 않는다.
   */
  it("matchedCompany 는 null 일 때만 「찾지 못했어요」 — 칸이 없으면(undefined) 아무 말도 안 한다", () => {
    const 없는칸 = 자료({ usedProfile: [], profileEmpty: true });
    delete (없는칸 as { matchedCompany?: string | null }).matchedCompany;
    expect(없는칸.matchedCompany, "이 시험은 칸이 아예 없는 자료를 잰다").toBeUndefined();

    const 생략 = 판({ data: 없는칸 });
    expect(생략, "모르는 사실을 단정한다").not.toContain("이 사업장 정보를 찾지 못했어요");
    expect(생략, "모르는 사실을 단정한다").not.toContain("조건 판정 없이 지금 열려 있는 자금만");
    expect(생략, "지도 자체는 그대로 그린다").toContain("안 갚아도 되는 돈");

    // 못 찾았다고 **말한** 자료에서는 그대로 뜬다
    const 못찾음 = 판({ data: 자료({ matchedCompany: null, usedProfile: [], profileEmpty: true }) });
    expect(못찾음).toContain("이 사업장 정보를 찾지 못했어요");

    // 부품을 직접 불러도 세 갈래가 그대로다
    expect(
      renderToStaticMarkup(<ProfileNotice matchedCompany={undefined} usedProfile={[]} />),
      "칸이 없는데 「못 찾음」이라 단정한다",
    ).toBe("");
    expect(renderToStaticMarkup(<ProfileNotice matchedCompany={null} usedProfile={[]} />)).toContain(
      "이 사업장 정보를 찾지 못했어요",
    );
    expect(renderToStaticMarkup(<ProfileNotice matchedCompany="삼영식품" usedProfile={[]} />)).toBe("");
  });

  /**
   * ★코덱스 3차 #C(2026-09-04) — 발 안내의 「자동 대조 결과입니다」를 **확실히 아닐 때만** 뺀다.
   *  앞선 두 판(요약 길이 → `evaluatedConditions`)은 둘 다 근사치라 자꾸 틀렸다: 요약은
   *  `companyScale`·`hasCert`·`hasPatent` 를 안 담고, 셈은 「견줘 봤다」를 기록하지 않는 엔진에서 나온
   *  어림값이다. 이제 **회사 정보 자체가 빈 회사**(`profileEmpty`)에서만 빼고, 나머지는 그대로 둔다.
   */
  it("발 안내는 profileEmpty 로만 가린다 — 요약이 비어도 정보가 있으면 「자동 대조 결과」다", () => {
    const 요약없이정보있음 = 판({ data: 자료({ usedProfile: [], profileEmpty: false }) });
    expect(요약없이정보있음, "모르면서 안 했다는 듯이 말한다").toContain("자동 대조 결과입니다");
    expect(요약없이정보있음, "모르는데 「안 맞춰 봤다」고 말한다").not.toContain(profileBandParts([]).value);

    // 회사 정보가 통째로 비면 그 말이 확실히 거짓이라 뺀다
    const 정보없음 = 판({ data: 자료({ usedProfile: [], profileEmpty: true }) });
    expect(정보없음, "정보가 하나도 없는데 자동 대조 결과라 한다").not.toContain("자동 대조 결과입니다");
    expect(정보없음).toContain("최종 자격은 공고 원문에서 확인하세요.");

    // 요약이 있으면 정보가 있는 것이므로 예전처럼 그대로다
    const 요약만 = 판({ data: 자료({ usedProfile: ["지역 전북"], profileEmpty: false }) });
    expect(요약만).toContain("자동 대조 결과입니다");

    // 칸이 응답에 없으면(옛 통로) 예전 문구 그대로 둔다 — 모르면 안 바꾼다
    const 옛통로 = 자료({ usedProfile: ["지역 전북"] });
    delete (옛통로 as { profileEmpty?: boolean }).profileEmpty;
    const 옛html = 판({ data: 옛통로 });
    expect(옛html, "모르는데 문구를 바꾼다").toContain("자동 대조 결과입니다");
    expect(옛html).toContain("최종 자격은 공고 원문에서 확인하세요.");
  });

  /**
   * ★코덱스 5차 #3(2026-09-04) — 자료를 쥔 채 다시 부르는 동안 지도 전체가 `pointer-events-none` 이
   *  되는데, 「다시 추천」이 그 안으로 들어오면서 **멈췄을 때 복구할 길이 사라졌다**. 원래 계약은
   *  「다시 추천은 어느 상태에서도 남는다」(화면 독립 검사 2026-08-30 지적 F)이고, 「남는다」는
   *  보이기만 하는 것이 아니라 **눌린다**는 뜻이다.
   */
  it("재조회 중에도 「다시 추천」은 눌린다 — 흐림·잠금은 그대로", () => {
    const html = 판({ loading: true });
    expect(html, "재조회 중 흐려진다").toContain("opacity-60");
    const i잠금 = html.indexOf("pointer-events-none");
    const i풀림 = html.indexOf("pointer-events-auto");
    expect(i잠금, "재조회 중 지도를 잠그는 자리가 없어졌다").toBeGreaterThan(-1);
    expect(i풀림, "손잡이를 되살리는 자리가 없다 — 멈추면 복구할 길이 없다").toBeGreaterThan(i잠금);
    // 「다시 추천」이 그 되살린 자리 **안**에 있어야 한다(감싸개가 닫히기 전에 나온다)
    const 감싸개 = html.slice(i풀림);
    expect(감싸개.slice(0, 감싸개.indexOf("</span>")), "「다시 추천」이 되살린 자리 밖에 있다").toContain(
      "다시 추천",
    );
    // 나머지는 그대로 잠긴다 — 손잡이 하나만 살린 것이지 잠금을 걷어낸 것이 아니다
    expect(html.indexOf("스마트상점 기술보급사업 3차"), "지도 본문이 사라졌다").toBeGreaterThan(i잠금);
  });

  /**
   * ★단추 하나가 한 줄을 통째로 쓰던 빈 줄을 없앤 자리(A안) — 「다시 추천」은 머리 카드 라벨 줄
   *  오른쪽 끝에 앉는다. 그래서 「카드 → 라벨 → 단추 → 값」 차례여야 한다.
   */
  it("「다시 추천」은 머리 카드 라벨 줄 안에 있다 — 단추만 있는 별도 줄이 아니다(A안)", () => {
    const html = 판();
    expect(html, "단추만 있는 줄이 남아 있다").not.toContain('class="mb-2 flex justify-end"');
    const i카드 = html.indexOf("rounded-xl border border-wedly-bd bg-white");
    const i라벨 = html.indexOf("판정에 쓴 정보");
    const i단추 = html.indexOf("다시 추천");
    const i값 = html.indexOf(profileBandParts(["지역 전북", "직원수 10명"]).value);
    expect(i카드, "머리 카드가 없다").toBeGreaterThan(-1);
    expect(i라벨, "라벨이 머리 카드 안에 없다").toBeGreaterThan(i카드);
    expect(i단추, "단추가 라벨보다 앞에 있다").toBeGreaterThan(i라벨);
    expect(i값, "단추가 값 줄 아래로 내려갔다 — 라벨과 같은 줄이어야 한다").toBeGreaterThan(i단추);
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

  it("안내 줄만 따로 그려도 갈래가 맞다 — 「못 찾음」 하나만 그린다(A안)", () => {
    expect(renderToStaticMarkup(<ProfileNotice matchedCompany={null} usedProfile={[]} />)).toContain(
      "이 사업장 정보를 찾지 못했어요",
    );
    expect(
      renderToStaticMarkup(<ProfileNotice matchedCompany="삼영식품" usedProfile={["지역 전북"]} />),
      "찾은 고객의 판정 근거는 지도 머리 카드가 그린다 — 여기선 아무것도 안 그린다",
    ).toBe("");
    expect(
      renderToStaticMarkup(<ProfileNotice matchedCompany="삼영식품" usedProfile={[]} />),
      "「쓸 정보 0개」는 머리 카드 빈칸 힌트가 말한다 — 여기선 아무것도 안 그린다",
    ).toBe("");
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
 * ★「스위치를 끄면 펼침도 접힌다」(2026-09-04) — 부모가 거르개와 펼침을 따로 쥐고
 *  `onFiltersChange={setFilters}` 로 거르개만 갈아 끼웠다. 그래서 「카드에서 grant 펼침 → 표 보기로
 *  이동 → 「안 맞는 공고도 보기」 끄기 → 카드로 복귀」 하면 `showExcluded` 엔 grant 가 남았는데
 *  `includeExcluded` 는 꺼져 서버가 `excludedItems` 를 안 싣는다 — 그 카드가 펼친 모양인데 아래가 비었다.
 *
 *  재는 방법은 이 파일의 다른 배선 시험과 같다(jsdom 이 없다) — 화면이 실제로 부르는 순수 함수
 *  두 개(`nextFilters` → `nextFundingState`)를 손잡이 순서 그대로 이어 붙여 잰다.
 */
describe("추천 정책 탭 — 거르개·펼침 한 자리에서 옮기기(nextFundingState)", () => {
  const 켠거르개: FundingFilters = { ...기본거르개, includeExcluded: true };
  const grant펼침 = new Set<FundingGroup>(["grant"]);

  it("스위치를 끄면 펼침이 빈다 — 「뺀 것 접기」인데 아래가 빈 카드가 안 남는다", () => {
    const 다음 = nextFundingState(켠거르개, grant펼침, nextFilters(켠거르개, "includeExcluded"));
    expect(다음.filters.includeExcluded, "스위치는 꺼진 채로 넘어가야 한다").toBe(false);
    expect([...다음.showExcluded], "펼침이 남으면 빈 카드가 그려진다").toEqual([]);
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
    // ① 카드 보기에서 grant 「안 맞아서 뺀 N건 보기」 — 부모의 onToggleExcluded 와 같은 규칙
    const 펼친집합 = toggleExcludedGroup(new Set<FundingGroup>(), "grant");
    const 펼친거르개: FundingFilters = { ...기본거르개, includeExcluded: 펼친집합.size > 0 };
    expect([...펼친집합]).toEqual(["grant"]);
    // 이때는 실제로 안 맞음 항목이 보인다(그려서 확인)
    expect(판({ data: 안맞음포함자료(), filters: 펼친거르개, showExcluded: 펼친집합 })).toContain(
      "전북 스마트공장 구축지원",
    );

    // ② 표 보기로 옮겨 「안 맞는 공고도 보기」 손잡이를 끈다(거르개만 바뀌는 길)
    const 끈뒤 = nextFundingState(펼친거르개, 펼친집합, nextFilters(펼친거르개, "includeExcluded"));

    // ③ 카드 보기로 복귀 — 서버가 안 맞음을 안 싣는 상태이므로 펼침도 비어 있어야 한다
    expect(끈뒤.filters.includeExcluded).toBe(false);
    expect([...끈뒤.showExcluded]).toEqual([]);
    const 복귀 = 판({ data: 자료(), filters: 끈뒤.filters, showExcluded: 끈뒤.showExcluded });
    expect(복귀, "펼친 카드가 남으면 「뺀 것 접기」가 보인다").not.toContain("뺀 것 접기");
  });

  it("갈래 단추로 마지막 갈래를 접어 스위치가 꺼지는 길도 결과가 같다(부모 onToggleExcluded 와 대조)", () => {
    // 부모 onToggleExcluded 의 규칙 그대로: 집합을 먼저 뒤집고, 비면 스위치를 끈다
    const 접은집합 = toggleExcludedGroup(grant펼침, "grant");
    const 접은거르개: FundingFilters = { ...켠거르개, includeExcluded: 접은집합.size > 0 };
    expect([...접은집합]).toEqual([]);
    expect(접은거르개.includeExcluded).toBe(false);
    // 같은 자리를 nextFundingState 로 통과시켜도 결과가 같다(두 길이 갈리지 않는다)
    const 통과 = nextFundingState(켠거르개, 접은집합, 접은거르개);
    expect(통과.filters).toEqual(접은거르개);
    expect([...통과.showExcluded]).toEqual([]);
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
