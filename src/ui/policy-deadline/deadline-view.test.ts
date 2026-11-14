import { describe, expect, it } from "vitest";
import type { AnnouncementListRow, CompanyAnnouncementRow, ContactCompanyRow, ExportRow } from "../../serve/policy-deadline/types";
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
  return { bucketKey: "b1", repAnnouncementId: "a1", title: "공고", agency: "기관", category: "정책자금", url: "", applyEnd: "2026-11-20", dDay: 8, fit: 0, unverified: 0, ...over };
}

function contact(over: Partial<ContactCompanyRow>): ContactCompanyRow {
  return {
    customerKey: "b:1",
    companyName: "가나상사",
    consultant: "김지현",
    consultantNames: ["김지현"],
    statusText: "진행",
    nearestApplyEnd: "2026-11-15",
    nearestDDay: 3,
    kinds: [{ category: "정책자금", count: 1, nearestDDay: 3 }],
    announcementCount: 1,
    progressCount: 0,
    ...over,
  };
}

function ann(over: Partial<CompanyAnnouncementRow>): CompanyAnnouncementRow {
  return { bucketKey: "b1", repAnnouncementId: "a1", title: "공고", agency: "", category: "정책자금", url: "", applyEnd: "2026-11-20", dDay: 8, verdict: "fit", fitLabels: [], toCheck: [], gaps: [], progress: null, ...over };
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
    contact({ customerKey: "b:2", companyName: "다라", kinds: [{ category: "무상지원금", count: 1, nearestDDay: 2 }, { category: "수출", count: 2, nearestDDay: 9 }], nearestDDay: 2 }),
    contact({ customerKey: "b:1", companyName: "가나", kinds: [{ category: "정책자금", count: 1, nearestDDay: 5 }, { category: "수출", count: 1, nearestDDay: 4 }], nearestDDay: 4 }),
    contact({ customerKey: "b:3", companyName: "가나", kinds: [{ category: "정책자금", count: 3, nearestDDay: 5 }], nearestDDay: 5 }),
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
    expect(rebuilt?.kinds).toEqual([
      { category: "무상지원금", count: 2, nearestDDay: 7 },
      { category: "가공", count: 1, nearestDDay: 20 },
      { category: "수출", count: 1, nearestDDay: 6 },
      { category: "", count: 1, nearestDDay: 12 },
    ]);
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

describe("엑셀·알림·주소", () => {
  it("엑셀 줄은 머리줄 14칸 순서", () => {
    const row: ExportRow = {
      applyEnd: null, dDay: null, title: "공고", agency: "기관", category: "", url: "https://example.com", companyName: "가나", consultant: "",
      statusText: "진행", verdict: "unverified", fitLabels: ["업력"], toCheck: ["매출", "지역"], gaps: ["매출액"], inProgress: true,
    };
    const [line] = exportBody([row]);
    expect(line).toHaveLength(EXPORT_HEADERS.length);
    expect(line).toEqual(["상시", "상시", "공고", "기관", "분류 없음", "가나", "담당 없음", "진행", "확인 필요", "업력", "매출 · 지역", "매출액", "진행 중", "https://example.com"]);
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
    expect(conditionColumns(onlyGeneric, false)).toEqual({ fit: false, check: false });
    expect(conditionColumns(onlyGeneric, true)).toEqual({ fit: false, check: true });
    expect(conditionColumns([...onlyGeneric, { fitLabels: ["업력"], toCheck: [], gaps: ["매출액"] }], false)).toEqual({ fit: true, check: true });
  });

  it("상세창 신원 — b: 는 사업자번호, p: 는 연락처", () => {
    expect(companyCardRowOf("b:1234567890", "가나")).toEqual({ companyName: "가나", bizno: "1234567890", phone: "" });
    expect(companyCardRowOf("p:01012345678", "다라")).toEqual({ companyName: "다라", bizno: "", phone: "01012345678" });
  });
});
