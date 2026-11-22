import { describe, expect, it } from "vitest";
import type { AnnouncementListRow, CompanyAnnouncementRow, ContactBest, ContactCompanyRow, ExportRow } from "../../serve/policy-deadline/types";
import {
  EXPORT_HEADERS,
  OTHER_KINDS,
  announcementsFor,
  companyCardRowOf,
  conditionColumns,
  contactRowsFor,
  dDayLabel,
  dDayTone,
  dateLabel,
  exportBody,
  filterAnnouncements,
  kindLabel,
  kindTone,
  lastRunLabel,
  matchesKind,
  needsSourceCheck,
  progressToastText,
  rebuildContactRow,
  specificToCheck,
  visibleCount,
} from "./deadline-view";

function listRow(over: Partial<AnnouncementListRow>): AnnouncementListRow {
  return {
    bucketKey: "b1", repAnnouncementId: "a1", title: "공고", agency: "기관", category: "정책자금", url: "", applyEnd: "2026-11-20", dDay: 8, fit: 0, unverified: 0, summary: "",
    tiers: { high: 0, mid: 0, low: 0 }, unstructured: 0, bestTier: null, ...over,
  };
}

const BEST: ContactBest = {
  bucketKey: "b1", title: "공고", category: "정책자금", url: "", applyEnd: "2026-11-15", dDay: 3, amountMaxWon: null,
  tier: "high", tierScore: 100, tierReason: "", checkItems: [], checkCount: 0, nextAction: "", unstructured: false,
};

function contact(over: Partial<ContactCompanyRow>): ContactCompanyRow {
  return {
    customerKey: "b:1",
    companyName: "가나상사",
    consultant: "김지현",
    consultantNames: ["김지현"],
    statusText: "진행",
    nearestApplyEnd: "2026-11-15",
    nearestDDay: 3,
    kinds: [{ category: "정책자금", count: 1, nearestDDay: 3, best: BEST }],
    announcementCount: 1,
    progressCount: 0,
    bestTier: "high",
    tiers: { high: 1, mid: 0, low: 0, unstructured: 0 },
    best: BEST,
    ...over,
  };
}

function ann(over: Partial<CompanyAnnouncementRow>): CompanyAnnouncementRow {
  return {
    bucketKey: "b1", repAnnouncementId: "a1", title: "공고", agency: "", category: "정책자금", url: "", applyEnd: "2026-11-20", dDay: 8, verdict: "fit", fitLabels: [], toCheck: [], gaps: [], progress: null,
    tier: "high", tierScore: 100, tierReason: "", checkItems: [], checkCount: 0, nextAction: "", unstructured: false, amountMaxWon: null, dismissed: null, ...over,
  };
}

describe("마감 딱지", () => {
  it("상시 · 오늘 마감 · D-n 글자와 색", () => {
    expect([dDayLabel(null), dDayLabel(0), dDayLabel(5)]).toEqual(["상시", "오늘 마감", "D-5"]);
    expect([dDayTone(null), dDayTone(0), dDayTone(1), dDayTone(7), dDayTone(8)]).toEqual(["always", "today", "soon", "soon", "later"]);
  });

  it("날짜는 MM/DD(요일), 모르는 꼴은 그대로", () => {
    expect(dateLabel("2026-11-11")).toBe("11/11(수)");
    expect(dateLabel("2026-11-15")).toBe("11/15(일)");
    expect(dateLabel("11월")).toBe("11월");
  });

  it("마지막 대조 시각은 서울 시각, 기록 없으면 「아직 대조 전」", () => {
    expect(lastRunLabel({ finishedAt: "2026-11-11T00:20:00.000Z" })).toBe("11/11(수) 오전 9:20");
    expect(lastRunLabel({ finishedAt: "2026-11-11T04:05:00.000Z" })).toBe("11/11(수) 오후 1:05");
    expect(lastRunLabel({ finishedAt: "2026-11-10T15:30:00.000Z" })).toBe("11/11(수) 오전 12:30");
    expect(lastRunLabel(null)).toBe("아직 대조 전");
    expect(lastRunLabel({ finishedAt: "엉터리" })).toBe("아직 대조 전");
  });
});

describe("종류", () => {
  it("정책자금 · 무상지원금 · 그 밖 색, 빈 분류는 「분류 없음」", () => {
    expect([kindTone("정책자금"), kindTone("무상지원금"), kindTone("수출"), kindTone("")]).toEqual(["fund", "grant", "other", "other"]);
    expect([kindLabel(""), kindLabel("수출")]).toEqual(["분류 없음", "수출"]);
  });

  it("그 밖의 분야는 정책자금·무상지원금이 아닌 것(분류 없음 포함)", () => {
    expect(matchesKind("수출", OTHER_KINDS)).toBe(true);
    expect(matchesKind("", OTHER_KINDS)).toBe(true);
    expect(matchesKind("정책자금", OTHER_KINDS)).toBe(false);
    expect(matchesKind("무상지원금", "")).toBe(true);
    expect(matchesKind("무상지원금", "정책자금")).toBe(false);
  });
});

describe("공고 줄 거르기", () => {
  const rows = [
    listRow({ bucketKey: "a", category: "정책자금", fit: 2, unverified: 1 }),
    listRow({ bucketKey: "b", category: "무상지원금", fit: 0, unverified: 3 }),
    listRow({ bucketKey: "c", category: "정책자금", fit: 0, unverified: 0 }),
  ];

  it("「맞음만」이면 확인 필요를 세지 않는다", () => {
    expect(visibleCount(rows[0], false)).toBe(3);
    expect(visibleCount(rows[0], true)).toBe(2);
  });

  it("분야·0곳 숨기기·맞음만을 함께 건다", () => {
    const keys = (f: Parameters<typeof filterAnnouncements>[1]) => filterAnnouncements(rows, f).map((r) => r.bucketKey);
    expect(keys({ category: "", fitOnly: false, hideEmpty: true })).toEqual(["a", "b"]);
    expect(keys({ category: "", fitOnly: true, hideEmpty: true })).toEqual(["a"]);
    expect(keys({ category: "정책자금", fitOnly: false, hideEmpty: false })).toEqual(["a", "c"]);
  });
});

describe("연락 예정 업체", () => {
  const companies = [
    contact({ customerKey: "b:2", companyName: "다라", kinds: [{ category: "무상지원금", count: 1, nearestDDay: 2, best: BEST }, { category: "수출", count: 2, nearestDDay: 9, best: BEST }], nearestDDay: 2 }),
    contact({ customerKey: "b:1", companyName: "가나", kinds: [{ category: "정책자금", count: 1, nearestDDay: 5, best: BEST }, { category: "수출", count: 1, nearestDDay: 4, best: BEST }], nearestDDay: 4 }),
    contact({ customerKey: "b:3", companyName: "가나", kinds: [{ category: "정책자금", count: 3, nearestDDay: 5, best: BEST }], nearestDDay: 5 }),
  ];

  it("종류를 고르면 그 종류 공고가 없는 업체는 빠지고 가까운 마감을 그 종류로 다시 잡는다", () => {
    expect(contactRowsFor(companies, "").map((r) => [r.row.customerKey, r.nearestDDay])).toEqual([["b:2", 2], ["b:1", 4], ["b:3", 5]]);
    expect(contactRowsFor(companies, "정책자금").map((r) => [r.row.customerKey, r.nearestDDay])).toEqual([["b:1", 5], ["b:3", 5]]);
    expect(contactRowsFor(companies, OTHER_KINDS).map((r) => [r.row.customerKey, r.nearestDDay, r.kinds.length])).toEqual([["b:1", 4, 1], ["b:2", 9, 1]]);
  });

  it("「진행」 뒤 남은 공고로 줄을 다시 센다 — 분야 순서는 정책자금·무상지원금·그 밖 글자 순·빈 분류 끝", () => {
    const row = contact({});
    const rebuilt = rebuildContactRow(row, [
      ann({ bucketKey: "x", category: "", dDay: 12, applyEnd: "2026-11-24" }),
      ann({ bucketKey: "y", category: "수출", dDay: 6, applyEnd: "2026-11-18" }),
      ann({ bucketKey: "z", category: "무상지원금", dDay: 9, applyEnd: "2026-11-21", progress: { trackId: "t", byName: "김지현", via: "web", at: "2026-11-12T00:00:00.000Z" } }),
      ann({ bucketKey: "w", category: "무상지원금", dDay: 7, applyEnd: "2026-11-19" }),
      ann({ bucketKey: "v", category: "가공", dDay: 20, applyEnd: "2026-12-02" }),
    ]);
    expect(rebuilt).toMatchObject({ nearestDDay: 6, nearestApplyEnd: "2026-11-18", announcementCount: 5, progressCount: 1 });
    expect(rebuilt?.kinds.map((k) => [k.category, k.count, k.nearestDDay, k.best.bucketKey])).toEqual([
      ["무상지원금", 2, 7, "w"],
      ["가공", 1, 20, "v"],
      ["수출", 1, 6, "y"],
      ["", 1, 12, "x"],
    ]);
    expect(rebuilt?.best.bucketKey).toBe("y");
  });

  it("다시 셀 때 해당 없음 줄은 빼고 단계 수·가장 좋은 줄(맞을 확률 순)도 다시 잡는다", () => {
    const rebuilt = rebuildContactRow(contact({}), [
      ann({ bucketKey: "m", category: "정책자금", tier: "mid", tierScore: 85, checkCount: 1, dDay: 3, applyEnd: "2026-11-15" }),
      ann({ bucketKey: "h", category: "정책자금", dDay: 9, applyEnd: "2026-11-21", amountMaxWon: 50000000, nextAction: "고객에게 연락해 신청 안내" }),
      ann({ bucketKey: "u", category: "수출", tier: "low", tierScore: 0, unstructured: true, dDay: 1, applyEnd: "2026-11-13" }),
      ann({ bucketKey: "d", category: "수출", dDay: 2, applyEnd: "2026-11-14", dismissed: { reason: "기타", byName: "김지현", at: "2026-11-12T00:00:00.000Z" } }),
      ann({ bucketKey: "l", category: "수출", tier: "low", tierScore: 50, dDay: 5, applyEnd: "2026-11-17" }),
    ]);
    expect(rebuilt).toMatchObject({ nearestDDay: 1, nearestApplyEnd: "2026-11-13", announcementCount: 4, progressCount: 0, bestTier: "high" });
    expect(rebuilt?.tiers).toEqual({ high: 1, mid: 1, low: 1, unstructured: 1 });
    expect(rebuilt?.kinds.map((k) => [k.category, k.count, k.nearestDDay, k.best.bucketKey])).toEqual([["정책자금", 2, 3, "h"], ["수출", 2, 1, "l"]]);
    expect(rebuilt?.best).toEqual({
      bucketKey: "h", title: "공고", category: "정책자금", url: "", applyEnd: "2026-11-21", dDay: 9, amountMaxWon: 50000000,
      tier: "high", tierScore: 100, tierReason: "", checkItems: [], checkCount: 0, nextAction: "고객에게 연락해 신청 안내", unstructured: false,
    });
    const dismissedOnly = [ann({ bucketKey: "d", dismissed: { reason: "기타", byName: "김지현", at: "2026-11-12T00:00:00.000Z" } })];
    expect(rebuildContactRow(contact({}), dismissedOnly)).toBeNull();
  });

  it("남은 공고가 없으면 업체가 빠진다(상시는 이 탭에 없다)", () => {
    expect(rebuildContactRow(contact({}), [])).toBeNull();
    expect(rebuildContactRow(contact({}), [ann({ dDay: null, applyEnd: null })])).toBeNull();
  });

  it("펼친 공고도 같은 종류로 거른다", () => {
    const rows = [ann({ bucketKey: "a", category: "정책자금" }), ann({ bucketKey: "b", category: "" })];
    expect(announcementsFor(rows, OTHER_KINDS).map((r) => r.bucketKey)).toEqual(["b"]);
  });
});

describe("연락 예정 업체 — 맞을 확률 순(NO.789)", () => {
  const kb = (bucketKey: string, category: string, over: Partial<ContactBest> = {}): ContactBest => ({
    bucketKey, title: bucketKey, category, url: "", applyEnd: "2026-11-20", dDay: 8, amountMaxWon: null,
    tier: "high", tierScore: 100, tierReason: "", checkItems: [], checkCount: 0, nextAction: "", unstructured: false, ...over,
  });
  const fundMid = kb("f-mid", "정책자금", { tier: "mid", tierScore: 80, checkCount: 1 });
  const grantHigh = kb("g-high", "무상지원금", { tier: "high", tierScore: 95 });
  const exportLow = kb("x-low", "수출", { tier: "low", tierScore: 40, applyEnd: "2026-11-15", dDay: 3 });
  const emptyHigh = kb("e-high", "", { tier: "high", tierScore: 92, checkCount: 1 });
  const fundMid0 = kb("f-mid0", "정책자금", { tier: "mid", tierScore: 70 });
  const flat = kb("u", "무상지원금", { tier: "low", tierScore: 0, unstructured: true, applyEnd: "2026-11-13", dDay: 1 });
  const companies = [
    contact({ customerKey: "b:1", companyName: "가나", nearestDDay: 8, best: grantHigh, kinds: [
      { category: "정책자금", count: 1, nearestDDay: 8, best: fundMid },
      { category: "무상지원금", count: 1, nearestDDay: 8, best: grantHigh },
    ] }),
    contact({ customerKey: "b:2", companyName: "다라", nearestDDay: 3, best: emptyHigh, kinds: [
      { category: "수출", count: 1, nearestDDay: 3, best: exportLow },
      { category: "", count: 1, nearestDDay: 8, best: emptyHigh },
    ] }),
    contact({ customerKey: "b:3", companyName: "마바", nearestDDay: 8, best: fundMid0, kinds: [{ category: "정책자금", count: 1, nearestDDay: 8, best: fundMid0 }] }),
    contact({ customerKey: "b:4", companyName: "아자", nearestDDay: 1, best: flat, kinds: [{ category: "무상지원금", count: 1, nearestDDay: 1, best: flat }] }),
  ];
  const keys = (rows: ReturnType<typeof contactRowsFor>) => rows.map((r) => [r.row.customerKey, r.best.bucketKey]);

  it("전체면 업체의 best · 종류를 고르면 그 종류들의 best 중 맞을 확률 순 첫 줄", () => {
    expect(keys(contactRowsFor(companies, ""))).toEqual([["b:4", "u"], ["b:2", "e-high"], ["b:1", "g-high"], ["b:3", "f-mid0"]]);
    expect(keys(contactRowsFor(companies, "정책자금"))).toEqual([["b:1", "f-mid"], ["b:3", "f-mid0"]]);
    expect(keys(contactRowsFor(companies, OTHER_KINDS))).toEqual([["b:2", "e-high"]]);
  });

  it("정렬을 안 정하거나 마감 순이면 지금 순서(가까운 마감 → 업체명 → 열쇠)", () => {
    expect(keys(contactRowsFor(companies, "", "deadline"))).toEqual(keys(contactRowsFor(companies, "")));
  });

  it("맞을 확률 순 — best 로 단계 → 확인 수 → 마감 → 점수 → 업체명, 판단 전은 맨 뒤", () => {
    expect(keys(contactRowsFor(companies, "", "tier"))).toEqual([["b:1", "g-high"], ["b:2", "e-high"], ["b:3", "f-mid0"], ["b:4", "u"]]);
    expect(keys(contactRowsFor(companies, "정책자금", "tier"))).toEqual([["b:3", "f-mid0"], ["b:1", "f-mid"]]);
    expect(keys(contactRowsFor(companies, "무상지원금", "tier"))).toEqual([["b:1", "g-high"], ["b:4", "u"]]);
  });
});

describe("엑셀·알림·주소", () => {
  it("엑셀 줄은 머리줄 18칸 순서 — 맞을 확률·근거·다음 할 일·해당 없음 사유를 더한다(줄 수는 그대로)", () => {
    expect(EXPORT_HEADERS).toEqual([
      "마감일", "남은 날", "공고명", "기관", "분야", "업체명", "담당", "진행상태", "맞을 확률", "근거", "다음 할 일",
      "판정", "맞은 조건", "확인할 조건", "채울 칸", "정책 진행", "해당 없음 사유", "공고 원문",
    ]);
    const row: ExportRow = {
      applyEnd: null, dDay: null, title: "공고", agency: "기관", category: "", url: "https://example.com", companyName: "가나", consultant: "",
      statusText: "진행", verdict: "unverified", fitLabels: ["업력"], toCheck: ["매출", "지역"], gaps: ["매출액"], inProgress: true,
      tier: "mid", tierReason: "조건 6개 중 5개 맞음 · 매출 확인", nextAction: "매출 확인 후 연락", unstructured: false, dismissedReason: "기타",
    };
    const flat: ExportRow = { ...row, tier: "low", tierReason: "공고 조건 정리 전", nextAction: "공고 조건 정리 대기", unstructured: true, dismissedReason: "" };
    const [line, flatLine] = exportBody([row, flat]);
    expect(line).toHaveLength(EXPORT_HEADERS.length);
    expect(line).toEqual([
      "상시", "상시", "공고", "기관", "분류 없음", "가나", "담당 없음", "진행", "보통", "조건 6개 중 5개 맞음 · 매출 확인", "매출 확인 후 연락",
      "확인 필요", "업력", "매출 · 지역", "매출액", "진행 중", "기타", "https://example.com",
    ]);
    expect(flatLine[8]).toBe("판단 전");
    expect(flatLine[16]).toBe("");
  });

  it("업무 현황에 추가 알림 — 기한은 MM/DD(요일), 상시면 「기한 없음」, 이미 넣었으면 넣은 사람", () => {
    const r = { created: true, companyName: "가나", policyName: "수출 바우처", todo: "신청 마감", due: "2026-11-20", progress: { byName: "김컨설" } };
    expect(progressToastText(r)).toBe("가나 · 컨설팅 업무 현황에 「수출 바우처」 추가 · 할 일 「신청 마감」 · 기한 11/20(금)");
    expect(progressToastText({ ...r, due: "" })).toBe("가나 · 컨설팅 업무 현황에 「수출 바우처」 추가 · 할 일 「신청 마감」 · 기한 없음");
    expect(progressToastText({ ...r, created: false })).toBe("가나 · 「수출 바우처」 · 이미 김컨설 님이 업무 현황에 추가했습니다");
  });

  it("확인할 조건 — 공고 전체 문구는 빼고 업체마다 다른 것만, 다 비는 칸은 그리지 않음", () => {
    const generic = "공고 원문 확인(조건 정리 전)";
    expect(specificToCheck([generic, "수출 실적", "자격 조건 원문 확인"])).toEqual(["수출 실적"]);
    expect([needsSourceCheck([generic]), needsSourceCheck(["수출 실적"])]).toEqual([true, false]);
    const onlyGeneric = [{ fitLabels: [], toCheck: [generic], gaps: [] }];
    expect(conditionColumns(onlyGeneric, false)).toEqual({ check: false });
    expect(conditionColumns(onlyGeneric, true)).toEqual({ check: true });
    const withGap = { fitLabels: ["업력"], toCheck: [], gaps: ["매출액"] };
    expect(conditionColumns([...onlyGeneric, withGap], false)).toEqual({ check: true });
    // 맞은 조건만 있는 줄은 조건 칸을 만들지 않는다 — 「맞은 조건」 칸은 두지 않는다(2026-11-16 사장님).
    const fitOnly = { fitLabels: ["업력"], toCheck: [], gaps: [] };
    expect(conditionColumns([fitOnly], true)).toEqual({ check: false });
  });

  it("상세창 신원 — b: 는 사업자번호, p: 는 연락처", () => {
    expect(companyCardRowOf("b:1234567890", "가나")).toEqual({ companyName: "가나", bizno: "1234567890", phone: "" });
    expect(companyCardRowOf("p:01012345678", "다라")).toEqual({ companyName: "다라", bizno: "", phone: "01012345678" });
  });
});
