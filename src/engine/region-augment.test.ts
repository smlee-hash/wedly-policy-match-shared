import { describe, expect, it } from "vitest";
import { withRegionConditions, synthesizedRegionCondition } from "./region-augment";
import { checkCondition } from "./match-engine";
import type { AnnouncementStructure, StructuredCondition } from "./structure-types";

const EMPTY: AnnouncementStructure = {
  benefitSummary: "", supportAmountText: "",
  aiSummary: { purpose: "", target: "", scale: "", scaleItems: [] },
  conditions: [], humanCheck: [], documents: [], verified: false,
};
const st = (conditions: StructuredCondition[]): AnnouncementStructure => ({ ...EMPTY, conditions });
const region = (value: string[], machineReadable = true): StructuredCondition =>
  ({ key: "region", op: "in", value, rawText: "r", machineReadable });
const scale: StructuredCondition = { key: "companyScale", op: "in", value: ["중소기업"], rawText: "s", machineReadable: true };

// 실측: 공고의 지역 칸은 홍보 낱말 뭉치라 전 시도가 나열돼 있다.
const JUNK = "기술,창업,서울,부산,대구,인천,광주,대전,울산,세종,경기,강원,충북,충남,전북,전남,경북,경남,제주,2026";

describe("withRegionConditions — 제목 앞머리 보태기", () => {
  it("지역 조건이 시군구뿐이면 제목의 광역을 보탠다(포천시 사고)", () => {
    const out = withRegionConditions(st([region(["포천시"]), scale]), {
      title: "[경기] 포천시 2026년 소공인가구지원센터 운영 지원 사업 공고", agency: "경기도", region: JUNK,
    });
    const added = out.conditions.filter((c) => c.key === "region" && c.machineReadable);
    expect(added.some((c) => (c.value as string[]).includes("경기"))).toBe(true);
  });

  it("보탠 광역으로 타지역 회사가 실제로 fail 이 난다", () => {
    const out = withRegionConditions(st([region(["포천시"])]), {
      title: "[경기] 포천시 2026년 공고", agency: "경기도", region: "",
    });
    const sido = out.conditions.find((c) => c.key === "region" && (c.value as string[]).includes("경기"))!;
    expect(checkCondition(sido, { region: "인천광역시 남동구" } as never, new Date()).verdict).toBe("fail");
  });

  it("이미 광역 조건이 있으면 아무것도 안 보탠다(중복 금지)", () => {
    const before = st([region(["경기"])]);
    const out = withRegionConditions(before, { title: "[경기] 수원시 공고", agency: "경기도", region: JUNK });
    expect(out.conditions).toHaveLength(1);
  });

  it("광역 값이지만 machineReadable=false 면 「광역 있음」으로 안 본다", () => {
    const out = withRegionConditions(st([region(["경기"], false)]), {
      title: "[경기] 수원시 공고", agency: "경기도", region: "",
    });
    expect(out.conditions.some((c) => c.key === "region" && c.machineReadable)).toBe(true);
  });
});

describe("withRegionConditions — 지역 칸 폴백은 조건이 하나도 없을 때만", () => {
  it("시군구 전용 조건이 있으면 지역 칸을 안 쓴다 — 구미시 사업이 서울 회사에 뜨던 사고", () => {
    const before = st([region(["구미"])]);
    const out = withRegionConditions(before, {
      title: "2026년 구미시 스타트업 제작센터 참여기업 모집 공고", agency: "경상북도", region: JUNK,
    });
    expect(out.conditions).toHaveLength(1); // 안 늘어야 한다
  });

  it("「전국」 조건이 있으면 지역 칸을 안 써 전국 가드가 살아 있다", () => {
    const before = st([region(["전국"])]);
    const out = withRegionConditions(before, {
      title: "2026년 BOUNCE 글로벌 오피스아워 참여 스타트업 모집 공고", agency: "중소벤처기업부", region: JUNK,
    });
    expect(out.conditions).toHaveLength(1);
  });

  it("지역 조건이 하나도 없고 **폴백을 켠 곳에서만** 지역 칸으로 보탠다", () => {
    const out = withRegionConditions(st([scale]), { title: "지역 표기 없는 공고", agency: "부산테크노파크", region: "부산" }, { regionFieldFallback: true });
    const added = out.conditions.find((c) => c.key === "region");
    expect(added?.value).toEqual(["부산"]);
  });

  it("보탤 게 없으면 받은 것을 그대로 돌려준다", () => {
    const before = st([scale]);
    expect(withRegionConditions(before, { title: "제목", agency: "기관", region: "" })).toBe(before);
  });
});

describe("synthesizedRegionCondition", () => {
  it("「전국」이 섞이면 만들지 않는다", () => {
    expect(synthesizedRegionCondition("전국,서울")).toBeNull();
  });
  it("시도를 못 읽으면 만들지 않는다", () => {
    expect(synthesizedRegionCondition("기술,창업,2026")).toBeNull();
  });
  it("붙여 쓴 복수 시도를 전부 읽는다", () => {
    expect(synthesizedRegionCondition("대구경북 소재")?.value).toEqual(expect.arrayContaining(["대구", "경북"]));
  });
});

describe("지역 칸 폴백은 기본으로 꺼져 있다 — 진단·AI판정 보호", () => {
  it("옵션을 안 주면 지역 칸을 쓰지 않는다", () => {
    const before = st([scale]);
    expect(withRegionConditions(before, { title: "공고 broken", agency: "중기부", region: "서울" })).toBe(before);
  });

  it("구조가 비어 있어도 지역 조건을 만들지 않는다 — 「가능」 오승격 방지", () => {
    const before = st([]);
    const out = withRegionConditions(before, { title: "공고 broken", agency: "중기부", region: "서울" });
    expect(out.conditions).toHaveLength(0);
  });

  it("폴백을 켠 곳(추천)에서는 종전대로 만든다", () => {
    const out = withRegionConditions(st([]), { title: "공고 x", agency: "중기부", region: "서울" }, { regionFieldFallback: true });
    expect(out.conditions.find((c) => c.key === "region")?.value).toEqual(["서울"]);
  });
});
