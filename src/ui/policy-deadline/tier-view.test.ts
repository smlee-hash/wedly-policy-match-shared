// 맞을 확률 화면 계산(NO.789) — 단계 글자·딱지 표시·단계 고르기·확인 항목 묶기·지원 금액 글자·오늘 할 일 한 줄·목록 나누기.
import { describe, expect, it } from "vitest";
import type {
  AnnouncementListRow,
  CheckItem,
  CompanyMatchRow,
  ContactBest,
  ContactCompanyRow,
  DeadlineTier,
} from "../../serve/policy-deadline/types";
import type { ContactListRow } from "./deadline-view";
import {
  DEFAULT_TIERS,
  TIER_MARK,
  TIER_ORDER,
  UNSTRUCTURED_LABEL,
  amountLabel,
  checkGroupsOf,
  dismissedNoteText,
  dismissedTitle,
  firstCheckText,
  hiddenHint,
  markProgressed,
  partitionAnnouncements,
  partitionContactRows,
  partitionLines,
  sortCompanyLines,
  tierAria,
  tierCountLine,
  tierText,
  todayLine,
  toggleTier,
  unstructuredTitle,
} from "./tier-view";

function item(over: Partial<CheckItem> & Pick<CheckItem, "what" | "group" | "rank">): CheckItem {
  return { label: over.what, where: "공고 원문", ...over };
}

function best(over: Partial<ContactBest> = {}): ContactBest {
  return {
    bucketKey: "b1", title: "공고", category: "정책자금", url: "", applyEnd: "2026-11-20", dDay: 3, amountMaxWon: null,
    tier: "high", tierScore: 100, tierReason: "", checkItems: [], checkCount: 0, nextAction: "", unstructured: false, ...over,
  };
}

function contactRow(key: string, b: Partial<ContactBest>): ContactListRow {
  const row = { customerKey: key, companyName: key } as ContactCompanyRow;
  return { row, kinds: [], nearestDDay: 3, best: best(b) };
}

function listRow(key: string, over: Partial<AnnouncementListRow>): AnnouncementListRow {
  return {
    bucketKey: key, repAnnouncementId: "a", title: "공고", agency: "", category: "", url: "", applyEnd: "2026-11-20", dDay: 3, fit: 0, unverified: 0, summary: "",
    tiers: { high: 0, mid: 0, low: 0 }, unstructured: 0, bestTier: null, ...over,
  };
}

function line(key: string, over: Partial<CompanyMatchRow>): CompanyMatchRow {
  return {
    customerKey: key, companyName: key, consultant: "", consultantNames: [], statusText: "", verdict: "fit", fitLabels: [], toCheck: [], gaps: [], progress: null,
    amountMaxWon: null, dismissed: null, tier: "high", tierScore: 100, tierReason: "", checkItems: [], checkCount: 0, nextAction: "", unstructured: false, ...over,
  };
}

describe("업무 현황에 추가한 줄", () => {
  it("진행 기록을 붙이고 다음 할 일을 「업무 현황에서 진행 중」으로 — 나머지 칸과 원래 줄은 그대로", () => {
    const row = { bucketKey: "b1", progress: null, nextAction: "고객에게 연락해 신청 안내", tier: "high" as const };
    const done = { trackId: "t1", byName: "김컨설", via: "web" as const, at: "2026-11-14T00:00:00.000Z" };
    expect(markProgressed(row, done)).toEqual({ bucketKey: "b1", progress: done, nextAction: "업무 현황에서 진행 중", tier: "high" });
    expect(row.nextAction).toBe("고객에게 연락해 신청 안내");
  });
});

describe("단계 글자·딱지", () => {
  it("단계 순서는 높음 → 보통 → 낮음, 첫 화면 기본은 높음·보통", () => {
    expect(TIER_ORDER).toEqual(["high", "mid", "low"]);
    expect(DEFAULT_TIERS).toEqual(["high", "mid"]);
  });

  it("딱지 글자 — AI가 자격 조건을 확정하지 못한 줄은 단계와 상관없이 「원문 확인 필요」(내부 용어를 쓰지 않는다)", () => {
    expect([tierText("high", false), tierText("mid", false), tierText("low", false), tierText("low", true), tierText("high", true)]).toEqual([
      "높음", "보통", "낮음", "원문 확인 필요", "원문 확인 필요",
    ]);
    expect(UNSTRUCTURED_LABEL).toBe("원문 확인 필요");
  });

  it("색 말고도 모양으로 가른다 — ● ◐ ○, 읽어 주는 글은 「맞을 확률 ○○」", () => {
    expect(TIER_MARK).toEqual({ high: "●", mid: "◐", low: "○" });
    expect([tierAria("high", false), tierAria("low", true)]).toEqual(["맞을 확률 높음", "맞을 확률 원문 확인 필요"]);
  });

  it("단계 고르기 — 누르면 켜고 끄되 마지막 하나는 끌 수 없다 · 결과는 늘 높음 → 보통 → 낮음 순", () => {
    expect(toggleTier(["high", "mid"], "low")).toEqual(["high", "mid", "low"]);
    expect(toggleTier(["low"], "high")).toEqual(["high", "low"]);
    expect(toggleTier(["high", "mid"], "high")).toEqual(["mid"]);
    expect(toggleTier(["mid"], "mid")).toEqual(["mid"]);
    const before: DeadlineTier[] = ["mid"];
    toggleTier(before, "high");
    expect(before).toEqual(["mid"]); // 받은 배열은 그대로
  });
});

describe("확인 항목", () => {
  const items = [
    item({ what: "참고 문장", group: "ref", rank: 900 }),
    item({ what: "업력", group: "company", rank: 40, field: "foundedDate", where: "기본정보 › 설립일", current: "비어 있음" }),
    item({ what: "공고 원문 조건", group: "notice", rank: 80 }),
    item({ what: "세금 체납", group: "company", rank: 70, field: "taxArrears" }),
    item({ what: "걸림돌", group: "company", rank: 0, obstacle: true }),
    item({ what: "지역", group: "notice", rank: 20 }),
  ];

  it("두 묶음(업체 정보에서 채울 것 · 공고 원문에서 확인할 것)과 참고로 나누고, 묶음마다 중요한 순(rank 작은 순)", () => {
    const groups = checkGroupsOf(items);
    expect(groups.company.map((i) => i.what)).toEqual(["걸림돌", "업력", "세금 체납"]);
    expect(groups.notice.map((i) => i.what)).toEqual(["지역", "공고 원문 조건"]);
    expect(groups.ref.map((i) => i.what)).toEqual(["참고 문장"]);
  });

  it("rank 가 같으면 받은 순서 그대로", () => {
    const same = [item({ what: "가", group: "notice", rank: 10 }), item({ what: "나", group: "notice", rank: 10 })];
    expect(checkGroupsOf(same).notice.map((i) => i.what)).toEqual(["가", "나"]);
  });

  it("펼치지 않아도 보이는 한 줄 — 확인할 것 개수(참고 빼고)와 두 묶음을 통틀어 가장 중요한 항목", () => {
    expect(firstCheckText({ checkItems: items, checkCount: 5 })).toBe("확인할 것 5개 · 걸림돌");
    expect(firstCheckText({ checkItems: items.filter((i) => !i.obstacle), checkCount: 4 })).toBe("확인할 것 4개 · 지역");
  });

  it("확인할 것이 없으면 「확인할 것 없음」 · 참고만 있어도 같다 · 개수만 있고 항목이 없으면 개수만", () => {
    expect(firstCheckText({ checkItems: [], checkCount: 0 })).toBe("확인할 것 없음");
    expect(firstCheckText({ checkItems: [items[0]], checkCount: 0 })).toBe("확인할 것 없음");
    expect(firstCheckText({ checkItems: [items[0]], checkCount: 2 })).toBe("확인할 것 2개");
  });
});

describe("지원 금액 글자 — 기업당 최대, 모르면 그리지 않는다", () => {
  it("억·만 단위로 끊고 천 단위 쉼표(로케일을 쓰지 않는다)", () => {
    expect(amountLabel(300_000_000)).toBe("최대 3억원");
    expect(amountLabel(150_000_000)).toBe("최대 1억 5,000만원");
    expect(amountLabel(50_000_000)).toBe("최대 5,000만원");
    expect(amountLabel(120_000_000_000)).toBe("최대 1,200억원");
    expect(amountLabel(8_000)).toBe("최대 8,000원");
  });

  it("만원 아래 자투리는 버린다", () => {
    expect(amountLabel(100_005_000)).toBe("최대 1억원");
    expect(amountLabel(30_000_900)).toBe("최대 3,000만원");
  });

  it("모르거나 0 이하·숫자가 아니면 null", () => {
    expect([amountLabel(null), amountLabel(undefined), amountLabel(0), amountLabel(-5), amountLabel(Number.NaN), amountLabel(Number.POSITIVE_INFINITY)]).toEqual([
      null, null, null, null, null, null,
    ]);
  });
});

describe("오늘 할 일 한 줄", () => {
  it("요청서 문구 그대로", () => {
    expect(todayLine({ contactNow: 3, checkFirst: 1, inProgress: 0 })).toBe("오늘 연락할 곳 3곳 · 확인 후 연락 1곳 · 진행함 0곳");
  });
});

describe("묶음 제목·숨김 안내·해당 없음 표시", () => {
  it("업체는 곳, 공고는 건", () => {
    expect(hiddenHint(2, "업체")).toBe("고르지 않은 단계의 업체 2곳은 숨겼습니다");
    expect(hiddenHint(1, "공고")).toBe("고르지 않은 단계의 공고 1건은 숨겼습니다");
    expect(unstructuredTitle(4, "업체")).toBe("원문 확인 필요 업체 4곳 · AI가 공고 자격 조건을 확정하지 못해 맞을 확률 대신 확인할 것을 보여 줍니다");
    expect(unstructuredTitle(3, "공고")).toBe("원문 확인 필요 공고 3건 · AI가 공고 자격 조건을 확정하지 못해 맞을 확률 대신 확인할 것을 보여 줍니다");
    expect(dismissedTitle(2, "업체")).toBe("해당 없음 업체 2곳");
    expect(dismissedTitle(5, "공고")).toBe("해당 없음 공고 5건");
  });

  it("숨긴 것이 없으면 빈 글", () => {
    expect(hiddenHint(0, "업체")).toBe("");
  });

  it("해당 없음 표시 — 사유 · 표시한 사람 · 서울 날짜(MM/DD(요일)), 날짜를 못 읽으면 날짜 없이", () => {
    expect(dismissedNoteText({ reason: "고객이 원하지 않음", byName: "김지현", at: "2026-11-19T16:30:00.000Z" })).toBe("해당 없음 · 고객이 원하지 않음 · 김지현 · 11/20(금)");
    expect(dismissedNoteText({ reason: "기타", byName: "박서연", at: "엉터리" })).toBe("해당 없음 · 기타 · 박서연");
  });
});

describe("목록 나누기 — 고른 단계 · 판단 전 묶음 · 숨긴 수 · 단추 숫자", () => {
  it("연락 예정 업체 — 가장 좋은 공고(best)의 단계로 나누고 받은 순서를 지킨다", () => {
    const rows = [
      contactRow("h1", { tier: "high" }),
      contactRow("u1", { tier: "low", unstructured: true }),
      contactRow("l1", { tier: "low" }),
      contactRow("m1", { tier: "mid" }),
      contactRow("h2", { tier: "high" }),
    ];
    const parts = partitionContactRows(rows, ["high", "mid"]);
    expect(parts.main.map((r) => r.row.customerKey)).toEqual(["h1", "m1", "h2"]);
    expect(parts.unstructured.map((r) => r.row.customerKey)).toEqual(["u1"]);
    expect(parts.hidden).toBe(1);
    // 단추 숫자는 고른 단계와 상관없이 전부 센다 — 다 켜면 합이 업체 수.
    expect(parts.counts).toEqual({ high: 2, mid: 1, low: 1, unstructured: 1 });
    expect(partitionContactRows(rows, ["low"]).main.map((r) => r.row.customerKey)).toEqual(["l1"]);
  });

  it("정책별 공고 — 고른 단계 줄이 하나라도 있으면 본 목록 · 판단 전 줄만 있으면 판단 전 묶음 · 줄이 없는 공고는 본 목록(0곳 숨기기가 정한다)", () => {
    const rows = [
      listRow("hm", { tiers: { high: 1, mid: 2, low: 0 }, bestTier: "high" }),
      listRow("lo", { tiers: { high: 0, mid: 0, low: 3 }, bestTier: "low" }),
      listRow("un", { unstructured: 4 }),
      listRow("empty", {}),
      listRow("ml", { tiers: { high: 0, mid: 1, low: 1 }, unstructured: 1, bestTier: "mid" }),
    ];
    const parts = partitionAnnouncements(rows, ["high", "mid"]);
    expect(parts.main.map((r) => r.bucketKey)).toEqual(["hm", "empty", "ml"]);
    expect(parts.unstructured.map((r) => r.bucketKey)).toEqual(["un"]);
    expect(parts.hidden).toBe(1);
    // 공고 줄의 단추 숫자는 업체·공고 짝(건)을 더한다.
    expect(parts.counts).toEqual({ high: 1, mid: 3, low: 4, unstructured: 5 });
    expect(partitionAnnouncements(rows, ["low"]).main.map((r) => r.bucketKey)).toEqual(["lo", "empty", "ml"]);
  });

  it("펼친 줄 — 해당 없음은 단계와 상관없이 따로 · 판단 전 따로 · 나머지는 고른 단계만", () => {
    const rows = [
      line("h", { tier: "high" }),
      line("d", { tier: "high", dismissed: { reason: "기타", byName: "김지현", at: "2026-11-20T00:00:00.000Z" } }),
      line("u", { tier: "low", unstructured: true }),
      line("l", { tier: "low" }),
      line("m", { tier: "mid" }),
      line("du", { tier: "low", unstructured: true, dismissed: { reason: "기타", byName: "김지현", at: "2026-11-20T00:00:00.000Z" } }),
    ];
    const parts = partitionLines(rows, ["high", "mid"]);
    expect(parts.main.map((r) => r.customerKey)).toEqual(["h", "m"]);
    expect(parts.unstructured.map((r) => r.customerKey)).toEqual(["u"]);
    expect(parts.dismissed.map((r) => r.customerKey)).toEqual(["d", "du"]);
    expect(parts.hidden).toBe(1);
    // 단추 숫자는 해당 없음을 빼고 센다.
    expect(parts.counts).toEqual({ high: 1, mid: 1, low: 1, unstructured: 1 });
  });
});

describe("공고 줄 단계별 곳 수 · 펼친 줄 다시 줄 세우기", () => {
  it("고른 단계만 높음 → 보통 → 낮음 순으로, 0곳은 빼고 · 하나도 없으면 빈 글", () => {
    expect(tierCountLine({ high: 2, mid: 1, low: 4 }, ["high", "mid"])).toBe("높음 2곳 · 보통 1곳");
    expect(tierCountLine({ high: 0, mid: 3, low: 4 }, ["low", "mid", "high"])).toBe("보통 3곳 · 낮음 4곳");
    expect(tierCountLine({ high: 0, mid: 0, low: 4 }, ["high", "mid"])).toBe("");
  });

  it("해당 없음을 남기거나 되돌린 뒤 서버와 같은 순서로 — 해당 없음 뒤 · 판단 전 뒤 · 단계 · 확인 수 · 점수 큰 순 · 업체명", () => {
    const d = { reason: "기타", byName: "김지현", at: "2026-11-20T00:00:00.000Z" };
    const rows = [
      line("가", { tier: "high", dismissed: d }),
      line("나", { tier: "low" }),
      line("다", { tier: "low", unstructured: true }),
      line("라", { tier: "high", checkCount: 2 }),
      line("마", { tier: "high", checkCount: 0, tierScore: 90 }),
      line("바", { tier: "high", checkCount: 0, tierScore: 95 }),
    ];
    const before = rows.map((r) => r.customerKey);
    expect(sortCompanyLines(rows).map((r) => r.customerKey)).toEqual(["바", "마", "라", "나", "다", "가"]);
    // 받은 배열은 바꾸지 않는다.
    expect(rows.map((r) => r.customerKey)).toEqual(before);
  });
});
