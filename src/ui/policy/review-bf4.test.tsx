import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FUNDING_QUERY_MAX, GROUP_TOP_N, groupBlocks, type FundingItem } from "../../funding/funding-map";
import type { FundingMapPayload } from "../FundingMap";
import ResultSummaryBar from "./ResultSummaryBar";
import { SearchCutNotice } from "./ResultGroupList";
import {
  clipQuery, filterFundingData, filteredTotalOf, fundingSearchOf, normalizeQuery, searchCutOf, searchCutText, summaryTabs,
  type ResultConditions,
} from "./result-conditions";

/**
 * 재리뷰(Astra 3차) BF4 ④⑤⑥ — 긴 검색어·탭 유지 재진단 건수·미확인 공고 잘림 안내.
 * 이 저장소엔 jsdom 이 없다 — 규칙은 순수 함수와 진짜 `groupBlocks`, 그리기는 서버 쪽 그리기(renderToStaticMarkup),
 * 화면 배선은 소스 글자로 잰다. 표본은 전부 가짜 공고다.
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
    score: 1000,
    why: "",
    source: "smes24",
    isNew: false,
    ...over,
  };
}

function payload(groups: FundingMapPayload["groups"], unclassified = 0): FundingMapPayload {
  return {
    groups,
    glance: { open: 0, soon: 0, grantFit: 0, grantMaxWon: 0, minRate: null },
    profileGaps: [],
    unclassified,
    generatedAt: "2026-10-05T00:00:00.000Z",
  };
}

const 조건 = (over: Partial<ResultConditions> = {}): ResultConditions => ({ tab: "all", query: "", ...over });

/* ───────── ④ 긴 검색어 ───────── */

describe("BF4-4 검색어 100자 — 입력·화면 거르기·서버 요청이 한 값", () => {
  const 앞부분 = "가나다라마바사아자차".repeat(10); // 100자, 공백 없음
  const 공고81 = Array.from({ length: GROUP_TOP_N + 1 }, (_, i) =>
    item({ refId: String(i + 1), title: `${앞부분}${i === GROUP_TOP_N ? "목표" : i + 1}`, score: 1000 - i }),
  );
  const 긴검색어 = `${앞부분}초과분`; // 103자

  it("검색 입력 칸에 maxLength 100 이 걸려 있다", () => {
    const html = renderToStaticMarkup(
      <ResultSummaryBar
        data={null} tab="all" onTab={() => {}} unknownCount={null} onFill={() => {}} view="list" onView={() => {}}
        query="" onQuery={() => {}} nowOnly={false} onNowOnly={() => {}} sort="rec" onSort={() => {}}
      />,
    );
    expect(html).toMatch(new RegExp(`maxlength="${FUNDING_QUERY_MAX}"`, "i"));
    expect(FUNDING_QUERY_MAX).toBe(100);
  });

  it("입력 상태는 100자에서 멈추고(붙여 넣어도), 서버에 보내는 값과 화면이 거르는 값이 같다", () => {
    expect(Array.from(긴검색어)).toHaveLength(103);
    expect(Array.from(clipQuery(긴검색어))).toHaveLength(100);
    expect(normalizeQuery(`  ${긴검색어}  `)).toBe(앞부분);
    expect(fundingSearchOf(조건({ query: 긴검색어 })).query).toBe(앞부분);
  });

  it("103자 검색어여도 100자 접두사에 맞는 공고가 화면에 보인다(0건이 되지 않는다)", () => {
    // 서버는 100자로 보낸 요청으로 걸러 앞 80건을 실어 보낸다
    const 보낸 = fundingSearchOf(조건({ query: 긴검색어 }));
    const 받은 = payload(groupBlocks(공고81, { query: 보낸.query, tab: "all" }));
    expect(받은.groups[0].total).toBe(GROUP_TOP_N + 1);
    expect(받은.groups[0].items).toHaveLength(GROUP_TOP_N);

    const 보임 = filterFundingData(받은, 조건({ query: 긴검색어 }));
    expect(보임.groups[0].items).toHaveLength(GROUP_TOP_N);
    // 서버 요청 조건(100자)으로 거른 것과 똑같다
    expect(filterFundingData(받은, 조건({ query: 앞부분 })).groups[0].items.map((i) => i.refId)).toEqual(
      보임.groups[0].items.map((i) => i.refId),
    );
  });

  it("화면 배선: 입력 상태는 clipQuery 로, 요청 조건은 fundingSearchOf 로 만든다", () => {
    const 화면글 = readFileSync(new URL("./PolicyMatchScreen.tsx", import.meta.url), "utf8");
    expect(화면글).toContain("onQuery={(q) => setResultQuery(clipQuery(q))}");
    // C2 — 탭은 서버 조건이 아니다(탭 거르기는 클라이언트 배열 거르기). 서버 조건은 찾기어뿐.
    expect(화면글).toContain('fundingSearchOf({ tab: "all", query: askedQuery })');
  });
});

/* ───────── ⑤ 탭이 골라진 채 재진단 ───────── */

describe("BF4-5 탭이 골라진 채 다시 진단해도 요약 탭 건수가 줄지 않는다", () => {
  const 회사 = [
    item({ refId: "g1", group: "grant", title: "지원금 공고" }),
    item({ refId: "b1", group: "bank", title: "은행 대출" }),
  ];
  /** 가짜 서버 — 요청의 검색 조건으로 진짜 groupBlocks 가 거른다. */
  const 서버 = (req: { query?: string; tab?: ResultConditions["tab"] }) =>
    payload(groupBlocks(회사, { query: req.query, tab: req.tab }));
  const 건수 = (data: FundingMapPayload) =>
    Object.fromEntries(summaryTabs(data).map((t) => [t.key, t.count])) as Record<string, number | null>;

  it("grant 탭을 골라 받은 응답만으로 세면 전체가 1건으로 줄어든다(재진단이 풀어 줘야 하는 이유)", () => {
    expect(건수(서버(fundingSearchOf(조건({ tab: "grant" }))))).toMatchObject({ all: 1, bank: 0 });
  });

  it("재진단 뒤 탭·검색어 없는 요청의 응답에서 세면 전체 2·은행 1", () => {
    const 재요청 = fundingSearchOf(조건()); // 탭이 「전체」로 돌아간 새 회차
    expect(재요청).toEqual({});
    expect(건수(서버(재요청))).toMatchObject({ all: 2, grant: 1, bank: 1 });
  });

  it("화면 배선: 진단이 성공하면 찾기어를 처음으로 되돌리고, 탭·칩은 목록을 key 로 새로 만들어 되돌린다", () => {
    const 화면글 = readFileSync(new URL("./PolicyMatchScreen.tsx", import.meta.url), "utf8");
    const start = 화면글.indexOf("const runDiagnose");
    const 몸 = 화면글.slice(start, 화면글.indexOf("}, [endpoints.diagnose", start));
    expect(start).toBeGreaterThan(0);
    expect(몸).toContain('setResultQuery("")');
    expect(몸).toContain('setAskedQuery("")');
    // 탭 상태는 목록 부품이 쥐고 진단 회차(profileNonce)를 key 로 받아 새 회차마다 새로 시작한다(기본 탭 = 지원 가능).
    expect(화면글).toMatch(/<ResultOneList\s+key=\{profileNonce\}/);
  });
});

/* ───────── ⑥ 미확인 공고 잘림 안내 ───────── */

describe("BF4-6 검색에 맞는 미확인 공고가 80건을 넘으면 잘림 안내가 뜬다", () => {
  const 미확인81 = Array.from({ length: GROUP_TOP_N + 1 }, (_, i) =>
    item({ refId: `u${i + 1}`, title: `미확인 안내 ${i + 1}`, fitVerdict: "unverified", unclassified: true, score: 1000 - i }),
  );

  it("서버 함수: 검색어를 건 응답은 거른 뒤 미확인 건수(unclassifiedTotal)를 실어 보낸다", () => {
    const grant = groupBlocks(미확인81, { query: "미확인" }).find((b) => b.group === "grant")!;
    expect(grant.items).toHaveLength(GROUP_TOP_N); // 80건만 실려 온다
    expect(grant.total).toBe(0);
    expect(grant.unclassifiedTotal).toBe(GROUP_TOP_N + 1);
    // 검색에 안 맞는 미확인은 세지 않는다
    expect(groupBlocks(미확인81, { query: "없는낱말" }).find((b) => b.group === "grant")!.unclassifiedTotal).toBe(0);
    // 탭만 걸어도 센다 / 안 걸면 칸 자체가 없다(옛 응답 모양)
    expect(groupBlocks(미확인81, { tab: "grant" }).find((b) => b.group === "grant")!.unclassifiedTotal).toBe(GROUP_TOP_N + 1);
    expect(groupBlocks(미확인81).find((b) => b.group === "grant")!).not.toHaveProperty("unclassifiedTotal");
  });

  it("화면: 서버가 센 수로 잘림을 알아채고 안내를 그린다", () => {
    // 서버 응답 속 data.unclassified 는 거르기 전 전체(여기선 미확인 500건이라고 하자) — 안내에 쓰면 안 된다
    const 받은 = payload(groupBlocks(미확인81, { query: "미확인" }), 500);
    const c = 조건({ query: "미확인" });
    expect(filteredTotalOf(받은)).toBe(GROUP_TOP_N + 1);
    const cut = searchCutOf(받은, c);
    expect(cut).toEqual({ searched: GROUP_TOP_N, total: GROUP_TOP_N + 1 });
    const html = renderToStaticMarkup(<SearchCutNotice cut={cut} />);
    expect(html).toContain(searchCutText({ searched: 80, total: 81 }));
    expect(html).toContain("전체 81건");
  });

  it("미확인 칸이 없는 옛 응답은 실려 온 줄 수로 센다(기존 동작)", () => {
    const 받은 = payload(groupBlocks(미확인81.slice(0, 3), { query: "미확인" }));
    const 옛 = { ...받은, groups: 받은.groups.map(({ unclassifiedTotal: _drop, ...rest }) => rest) };
    expect(filteredTotalOf(옛)).toBe(3);
  });

  it("화면이 다시 거른 자료는 서버가 센 수를 물려받지 않고 남은 줄로 다시 센다", () => {
    const 받은 = payload(groupBlocks(미확인81, { query: "미확인" }));
    const 보임 = filterFundingData(받은, 조건({ tab: "now", query: "미확인 안내 1" }));
    expect(보임.groups[0]).not.toHaveProperty("unclassifiedTotal");
  });
});
