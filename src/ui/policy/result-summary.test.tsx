import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import PolicyMatchScreen, { type DiagnoseItem, type Diagnosis } from "./PolicyMatchScreen";
import ProfileForm from "./ProfileForm";
import ResultSummaryBar from "./ResultSummaryBar";
import {
  SORT_CHOICES,
  filterDiagnosis,
  filterFundingData,
  matchesQuery,
  reviewCountOf,
  summaryTabs,
  type ResultConditions,
} from "./result-conditions";
import { focusFirstUnknown } from "./unknown-focus";
import { ERP_POLICY_MATCH_ENDPOINTS } from "./endpoints";
import type { FundingItem, FundingGroupBlock } from "../../funding/funding-map";
import type { FundingMapPayload } from "../FundingMap";

/**
 * 화면 재구성 B3 — 요약 탭·「모름 → 확인 필요」 띠·도구 줄·두 칸 배치.
 * 이 저장소엔 jsdom 이 없어 눌러 보지 못한다 — 거르는 규칙은 순수 함수로, 모양은 그려서 잰다.
 */

const RAW색 =
  /(?:^|["\s])(?:bg|text|border|from|to)-(?:green|amber|red|sky|blue|indigo|violet|pink|gray|slate|zinc|orange|yellow|lime|emerald|teal|cyan|rose|fuchsia)-(?:50|100|200|300|400|500|600|700|800|900)\b/;

function fItem(over: Partial<FundingItem> & { refId: string }): FundingItem {
  return {
    id: `a:${over.refId}`,
    kind: "announcement",
    group: "grant",
    title: "공고",
    agency: "중기부",
    url: "https://example.kr/a",
    applyUrl: "",
    targetText: "",
    amountText: "",
    amountMaxWon: null,
    rateText: "",
    rateMin: null,
    deadline: { kind: "date", date: "2026-10-30", text: "", dDay: 25 },
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

const 마감임박 = { kind: "date", date: "2026-10-08", text: "", dDay: 3 } as const;
const 상시 = { kind: "always", date: null, text: "상시", dDay: null } as const;
const 지남 = { kind: "closed", date: "2026-09-01", text: "", dDay: -34 } as const;

function block(group: FundingGroupBlock["group"], items: FundingItem[], over: Partial<FundingGroupBlock> = {}): FundingGroupBlock {
  const normal = items.filter((i) => !i.unclassified);
  return {
    group,
    total: normal.length,
    fit: normal.filter((i) => i.fitVerdict === "fit").length,
    unverified: normal.filter((i) => i.fitVerdict === "unverified").length,
    excluded: 0,
    soon: 0,
    items,
    truncated: false,
    ...over,
  };
}

const 자료 = (): FundingMapPayload => ({
  groups: [
    block("grant", [
      fItem({ refId: "g1", title: "시제품 제작 지원", deadline: 마감임박, amountMaxWon: 30_000_000 }),
      fItem({ refId: "g2", title: "수출 바우처", fitVerdict: "unverified", deadline: 상시, amountMaxWon: 20_000_000 }),
      fItem({ refId: "g3", title: "지난 공고", deadline: 지남, amountMaxWon: 90_000_000 }),
    ]),
    block("policy", [fItem({ refId: "p1", group: "policy", title: "신성장기반자금", agency: "중진공", fitVerdict: "unverified" })]),
    block("guarantee", []),
    block("bank", [fItem({ refId: "b1", group: "bank", title: "운전자금 대출", deadline: 상시 })]),
  ],
  glance: { open: 4, soon: 1, grantFit: 3, grantMaxWon: 30_000_000, minRate: null },
  profileGaps: [],
  unclassified: 2,
  generatedAt: "2026-10-05T00:00:00.000Z",
});

const 조건 = (over: Partial<ResultConditions> = {}): ResultConditions => ({ tab: "all", query: "", ...over });

describe("요약 탭 — 건수는 실제 자료에서 센다", () => {
  it("전체·지금 신청 가능·7일 안 마감·묶음 네 개, 이름은 기존 갈래 이름 그대로", () => {
    const tabs = summaryTabs(자료());
    expect(tabs.map((t) => t.label)).toEqual([
      "전체", "지금 신청 가능", "7일 안 마감",
      "안 갚아도 되는 돈", "싸게 빌리는 돈", "보증 받아 빌리는 돈", "은행에서 바로",
    ]);
    // 전체 = 갈래 건수 합 + 종류 미확인(서버 계약: 갈래 total 합 + 미확인 = 걸러진 전체)
    expect(tabs.map((t) => t.count)).toEqual([3 + 1 + 0 + 1 + 2, 4, 1, 3, 1, 0, 1]);
  });

  it("자료가 아직 없으면 건수를 지어내지 않는다(null)", () => {
    expect(summaryTabs(null).every((t) => t.count === null)).toBe(true);
  });
});

describe("요약 탭 거르기 — 자금 지도 자료", () => {
  it("묶음 탭은 그 묶음만 남긴다", () => {
    const out = filterFundingData(자료(), 조건({ tab: "bank" }));
    expect(out.groups.map((g) => g.group)).toEqual(["bank"]);
    expect(out.groups[0].items.map((i) => i.refId)).toEqual(["b1"]);
  });

  it("지금 신청 가능은 마감 지난 줄을 뺀다", () => {
    const out = filterFundingData(자료(), 조건({ tab: "now" }));
    const ids = out.groups.flatMap((g) => g.items.map((i) => i.refId));
    expect(ids).toContain("g1");
    expect(ids).not.toContain("g3");
  });

  it("7일 안 마감은 임박한 줄만 남기고, 칸 수도 남은 줄로 다시 센다", () => {
    const out = filterFundingData(자료(), 조건({ tab: "soon" }));
    expect(out.groups.flatMap((g) => g.items.map((i) => i.refId))).toEqual(["g1"]);
    const grant = out.groups.find((g) => g.group === "grant");
    expect(grant?.total).toBe(1);
    expect(grant?.fit).toBe(1);
  });

  it("검색어는 공고명·기관·지원대상에서 찾는다", () => {
    const out = filterFundingData(자료(), 조건({ query: "중진공" }));
    expect(out.groups.flatMap((g) => g.items.map((i) => i.refId))).toEqual(["p1"]);
  });

  it("조건이 없으면 같은 자료를 그대로 돌려준다(뜻 없는 다시 그리기를 안 만든다)", () => {
    const d = 자료();
    expect(filterFundingData(d, 조건())).toBe(d);
  });

  it("matchesQuery — 띄어 쓴 낱말은 모두 들어 있어야 하고 대소문자는 가리지 않는다", () => {
    expect(matchesQuery({ title: "AI 바우처 지원", agency: "중기부" }, "ai 중기부")).toBe(true);
    expect(matchesQuery({ title: "AI 바우처 지원", agency: "중기부" }, "ai 산업부")).toBe(false);
    expect(matchesQuery({ title: "무엇이든" }, "  ")).toBe(true);
  });
});

describe("요약 탭 거르기 — 진단 목록", () => {
  function d(over: Partial<DiagnoseItem> & { announcementId: string }): DiagnoseItem {
    return {
      title: "공고", agency: "중기부", category: "금융", applyEnd: null, applyPeriodText: "",
      grade: "possible", needsReview: false, failSummary: "",
      checks: { total: 1, pass: 1, fail: 0, unknown: 0, humanCheck: 0 },
      ...over,
    };
  }
  const 진단 = (): Diagnosis => ({
    possible: [d({ announcementId: "g1", title: "시제품 제작 지원" }), d({ announcementId: "b1", title: "운전자금 대출" })],
    uncertain: [d({ announcementId: "p1", title: "신성장기반자금", grade: "uncertain" })],
    impossible: [],
    structureProgress: { total: 3, done: 3, pending: 0, needsReview: 0, failed: 0 },
  });
  const byRef = () => new Map(자료().groups.flatMap((g) => g.items).map((i) => [i.refId, i] as const));
  const 기본 = { nowOnly: false, sort: "rec" as const };

  it("조건이 없으면 같은 진단을 그대로 돌려준다 — 고른 묶음 탭이 풀리지 않는다", () => {
    const x = 진단();
    expect(filterDiagnosis(x, 조건(), 기본, byRef())).toBe(x);
  });

  it("묶음 탭은 지도 자료의 갈래로 거른다", () => {
    const out = filterDiagnosis(진단(), 조건({ tab: "policy" }), 기본, byRef());
    expect(out?.possible).toHaveLength(0);
    expect(out?.uncertain.map((i) => i.announcementId)).toEqual(["p1"]);
  });

  it("검색어로 거르면 세 등급 모두에 적용된다", () => {
    const out = filterDiagnosis(진단(), 조건({ query: "대출" }), 기본, byRef());
    expect(out?.possible.map((i) => i.announcementId)).toEqual(["b1"]);
    expect(out?.uncertain).toHaveLength(0);
  });

  it("마감 지난 공고는 「지금 신청 가능」에서 빠진다", () => {
    const x = 진단();
    x.possible[0] = d({ announcementId: "g1", applyEnd: "2020-01-01T00:00:00.000Z" });
    const out = filterDiagnosis(x, 조건({ tab: "now" }), 기본, byRef());
    expect(out?.possible.map((i) => i.announcementId)).toEqual(["b1"]);
  });

  it("금액 큰 순은 지도 자료의 최대 금액으로 줄 세운다", () => {
    const x = 진단();
    x.possible.reverse(); // 금액이 작은 줄이 앞에 오게 뒤집어 둔다 — 안 뒤집으면 그냥 통과해 버린다
    const out = filterDiagnosis(x, 조건(), { nowOnly: false, sort: "amt" }, byRef());
    expect(out?.possible.map((i) => i.announcementId)).toEqual(["g1", "b1"]);
  });

  it("진단이 없으면 null 그대로", () => {
    expect(filterDiagnosis(null, 조건({ tab: "bank" }), 기본, byRef())).toBeNull();
  });
});

describe("「모름 N칸 → 확인 필요 M건」의 M", () => {
  it("지도 자료가 있으면 갈래별 확인 필요 합", () => {
    expect(reviewCountOf(자료(), null)).toBe(2);
  });
  it("지도 자료가 아직 없으면 진단의 애매함 건수, 둘 다 없으면 모른다(undefined)", () => {
    const x = { possible: [], uncertain: [{}, {}, {}], impossible: [] } as unknown as Diagnosis;
    expect(reviewCountOf(null, x)).toBe(3);
    expect(reviewCountOf(null, null)).toBeUndefined();
  });
});

describe("결과 위 줄(ResultSummaryBar) — 탭·띠·도구 줄", () => {
  type BarProps = Parameters<typeof ResultSummaryBar>[0];
  const props = (): BarProps => ({
    data: 자료(),
    tab: "all",
    onTab: () => {},
    unknownCount: 5,
    reviewCount: 1284,
    onFill: () => {},
    view: "list",
    onView: () => {},
    query: "",
    onQuery: () => {},
    nowOnly: false,
    onNowOnly: () => {},
    sort: "dead",
    onSort: () => {},
  });
  const 그림 = (over: Partial<BarProps> = {}) =>
    renderToStaticMarkup(<ResultSummaryBar {...props()} {...over} />);

  it("탭 일곱 개가 건수와 함께 있고, 고른 탭만 aria-pressed=true", () => {
    const html = 그림({ tab: "soon" });
    for (const 이름 of ["전체", "지금 신청 가능", "7일 안 마감", "안 갚아도 되는 돈", "싸게 빌리는 돈", "보증 받아 빌리는 돈", "은행에서 바로"]) {
      expect(html).toContain(이름);
    }
    expect(html.match(/aria-pressed="true"/g)?.length).toBeGreaterThanOrEqual(1);
    expect(html).toMatch(/aria-pressed="true"[^>]*>(?:(?!<\/button>).)*7일 안 마감/);
    expect(html).toContain("3건"); // 안 갚아도 되는 돈
  });

  it("띠: 모름 5칸 → 확인 필요 1,284건 + 채우기 단추", () => {
    const html = 그림();
    expect(html).toContain("모름 5칸 → 확인 필요 1,284건");
    expect(html).toContain("채우기");
  });

  it("모름이 0칸이면 띠가 없다", () => {
    expect(그림({ unknownCount: 0 })).not.toContain("채우기");
    expect(그림({ unknownCount: null })).not.toContain("채우기");
  });

  it("도구 줄: 보기 단추(목록·한눈에)·검색·지금 신청 가능한 것만·정렬 세 가지", () => {
    const html = 그림();
    expect(html).toContain("목록");
    expect(html).toContain("한눈에");
    expect(html).toContain("공고명·기관·지원대상 검색");
    expect(html).toContain("지금 신청 가능한 것만");
    expect(html).toContain('type="checkbox"');
    expect(SORT_CHOICES.map((c) => c.label)).toEqual(["마감 빠른 순", "금액 큰 순", "맞는 조건 많은 순"]);
    for (const c of SORT_CHOICES) expect(html).toContain(c.label);
    expect(html).toContain("<select");
  });

  it("색은 토큰만 쓴다", () => {
    expect(그림()).not.toMatch(RAW색);
    // 금지 글자를 파일에 그대로 적지 않고 이어 붙여 만든다(위 RAW색 대조군과 같은 이유).
    const 직접색 = new RegExp([`${"#"}[0-9a-f]{3,8}\\b`, `rgb${"\\("}`, `\\[${"#"}`].join("|"), "i");
    expect(그림()).not.toMatch(직접색);
  });
});

describe("채우기 — 왼쪽 첫 모름 칸으로 초점", () => {
  it("모름 칸(data-unk) 안의 첫 입력·단추를 찾아 스크롤하고 초점을 준다", () => {
    const target = { focus: vi.fn(), scrollIntoView: vi.fn() };
    const root = { querySelector: vi.fn(() => target) };
    expect(focusFirstUnknown(root as never)).toBe(true);
    expect(root.querySelector).toHaveBeenCalledWith('[data-unk="true"] input, [data-unk="true"] button');
    expect(target.scrollIntoView).toHaveBeenCalled();
    expect(target.focus).toHaveBeenCalled();
  });

  it("모름 칸이 없으면 아무 일도 안 하고 false", () => {
    expect(focusFirstUnknown({ querySelector: () => null } as never)).toBe(false);
    expect(focusFirstUnknown(null)).toBe(false);
  });

  it("그려진 폼에 모름 칸 표식이 실제로 있다", () => {
    const html = renderToStaticMarkup(<ProfileForm onDiagnose={async () => true} diagnosing={false} />);
    expect(html).toContain('data-unk="true"');
  });
});

describe("배치 — 옆 칸 패널(side)은 그대로, 화면은 두 단계(회사 정보 전체 폭)", () => {
  it("화면: 처음에는 회사 정보 폼이 본문 전체 폭을 쓰고, 결과 영역은 아직 없다", () => {
    const html = renderToStaticMarkup(<PolicyMatchScreen endpoints={ERP_POLICY_MATCH_ENDPOINTS} />);
    expect(html).toContain('data-area="company-panel"');
    expect(html).toMatch(/data-area="company-panel"[^>]*class="[^"]*w-full/);
    expect(html).not.toContain("max-w-[880px]");
    // 옛 두 칸(380px 옆 칸 + 결과) 배치는 없어졌다
    expect(html).not.toContain("min-[821px]:sticky");
    expect(html).not.toContain("min-[821px]:grid-cols-");
    expect(html).not.toContain('data-area="results"');
  });

  it("폼: 칸 묶음은 안쪽에서 스크롤하고, 매칭 진단 단추는 스크롤 밖 바닥에 있다", () => {
    const html = renderToStaticMarkup(<ProfileForm onDiagnose={async () => true} diagnosing={false} />);
    const body = html.indexOf('data-panel="body"');
    const foot = html.indexOf('data-panel="footer"');
    expect(body).toBeGreaterThan(-1);
    expect(foot).toBeGreaterThan(body);
    expect(html.slice(body, html.indexOf(">", body))).toContain("overflow-y-auto");
    // 진단 단추는 바닥 줄 안에만 있다(스크롤하는 몸통 안에는 없다)
    expect(html.slice(body, foot)).not.toContain("매칭 진단");
    expect(html.slice(foot)).toContain("매칭 진단");
  });

  it("진단 전에는 요약 탭·도구 줄이 없고, 전체 공고 탐색의 검색·새로 받아오기도 없어졌다", () => {
    const html = renderToStaticMarkup(<PolicyMatchScreen endpoints={ERP_POLICY_MATCH_ENDPOINTS} />);
    expect(html).not.toContain("지금 신청 가능한 것만");
    expect(html).not.toContain("7일 안 마감");
    // 전체 공고 탐색(browse)은 두 단계 개편에서 없어졌다
    expect(html).not.toContain("공고명·기관·지원대상 검색");
    expect(html).not.toContain("지금 새로 받아오기");
  });
});
