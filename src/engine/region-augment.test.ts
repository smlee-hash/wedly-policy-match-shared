import { describe, expect, it } from "vitest";
import { withRegionConditions, synthesizedRegionCondition } from "./region-augment";
import { ALL_SIDO_COUNT, checkCondition } from "./match-engine";
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
  it("시군구 사전이 아는 조건은 제목 광역을 또 안 붙인다(포천시)", () => {
    const before = st([region(["포천시"]), scale]);
    const out = withRegionConditions(before, {
      title: "[경기] 포천시 2026년 소공인가구지원센터 운영 지원 사업 공고", agency: "경기도", region: JUNK,
    });
    expect(out).toBe(before);
  });

  it("시군구 조건으로 타지역 회사가 실제로 fail 이 난다", () => {
    const out = withRegionConditions(st([region(["포천시"])]), {
      title: "[경기] 포천시 2026년 공고", agency: "경기도", region: "",
    });
    const c = out.conditions.find((x) => x.key === "region" && x.machineReadable)!;
    expect(checkCondition(c, { region: "인천광역시 남동구" } as never, new Date()).verdict).toBe("fail");
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

describe("synthesizedRegionCondition — 17개 시도 나열은 전국", () => {
  // ERP route.test.ts JUNK_REGION 과 같은 실측 문자열(열린 공고 455건).
  const JUNK_REGION = "기술,창업,서울,부산,대구,인천,광주,대전,울산,세종,경기,강원,충북,충남,전북,전남,경북,경남,제주,5축가공기,2026";
  const SIDOS_17 = ["서울", "부산", "대구", "인천", "광주", "대전", "울산", "세종", "경기", "강원", "충북", "충남", "전북", "전남", "경북", "경남", "제주"];

  it("JUNK_REGION 문자열은 조건을 만들지 않는다", () => {
    expect(synthesizedRegionCondition(JUNK_REGION)).toBeNull();
  });

  it("기업마당 실제 표기(16토큰·「전남광주」 결합)도 17곳으로 읽어 조건을 만들지 않는다(2차 리뷰 T1)", () => {
    // bizinfo-sample.json 의 해시태그 그대로 — 전남광주가 광주·전남 둘로 세어져야 전남 회사가 떨어지지 않는다.
    const BIZINFO_16 = "경영,서울,부산,대구,인천,전남광주,대전,울산,세종,경기,강원,충북,충남,전북,경북,경남,제주,2026";
    expect(synthesizedRegionCondition(BIZINFO_16)).toBeNull();
  });

  it("폴백을 켜도 JUNK_REGION 은 지역 조건을 안 붙인다", () => {
    const before = st([]);
    const out = withRegionConditions(
      before,
      { title: "지역 표기 없는 공고", agency: "중기부", region: JUNK_REGION },
      { regionFieldFallback: true },
    );
    expect(out.conditions.filter((c) => c.key === "region")).toHaveLength(0);
    expect(out).toBe(before);
  });

  it("서울,경기,인천 세 시도는 조건을 만든다", () => {
    const value = synthesizedRegionCondition("서울,경기,인천")?.value;
    expect(value).toEqual(expect.arrayContaining(["서울", "경기", "인천"]));
    expect(value).toHaveLength(3);
  });

  it("시도 16개 나열은 조건을 만들고(빠진 시도의 회사는 떨어진다) 17개 전부는 만들지 않는다", () => {
    expect(ALL_SIDO_COUNT).toBe(17);
    const sixteen = SIDOS_17.slice(0, 16).join(","); // 제주 빠짐
    const value = synthesizedRegionCondition(sixteen)?.value;
    expect(value).toHaveLength(16);
    expect(synthesizedRegionCondition(SIDOS_17.join(","))).toBeNull();
  });

  it("비수도권 14곳 나열은 서울 회사를 떨어뜨리는 실제 조건이다(독립 리뷰 2026-09-16 지적 1)", () => {
    const nonCapital = SIDOS_17.filter((s) => !["서울", "경기", "인천"].includes(s)).join(",");
    const out = withRegionConditions(
      st([]),
      { title: "비수도권 기업 지원", agency: "산업부", region: nonCapital },
      { regionFieldFallback: true },
    );
    const region = out.conditions.find((c) => c.key === "region");
    expect(region?.value).toHaveLength(14);
    expect(checkCondition(region!, { region: "서울" }, new Date("2026-09-16T00:00:00Z")).verdict).toBe("fail");
    expect(checkCondition(region!, { region: "부산" }, new Date("2026-09-16T00:00:00Z")).verdict).toBe("pass");
  });
});

describe("통합 3차 리뷰 §1 — 저장된 「전국」 조건은 제목 시군구 추가를 막는다", () => {
  it("전국 조건 + 영월군 제목 + 기관 강원 → 조건이 그대로 1개(전국)", () => {
    const before = st([region(["전국"])]);
    const out = withRegionConditions(before, { title: "2026년 3차 영월군 청년 창업육성 지원사업 수정 공고", agency: "강원특별자치도", region: "" }, { regionFieldFallback: true });
    expect(out).toBe(before);
  });
  it("F-1: 전국 조건이 있어도 기관과 교차검증된 [경남] 태그의 광역 조건은 보탠다(시군구만 거른다)", () => {
    const before = st([region(["전국"])]);
    const out = withRegionConditions(before, { title: "[경남] 진주시 해외지사화 사업", agency: "경상남도", region: "" });
    const added = out.conditions.filter((c) => c.key === "region" && c.machineReadable && (c.value as string[]).includes("경남"));
    expect(added).toHaveLength(1);
    expect(checkCondition(added[0], { region: "서울" }, new Date("2026-09-17T00:00:00Z")).verdict).toBe("fail");
  });
  it("5차 지적 1: 전국 조건 + 「제주시」·「부산진구」 제목(시도 별칭을 품은 시군구)도 조건을 안 붙인다", () => {
    const before = st([region(["전국"])]);
    expect(withRegionConditions(before, { title: "2026년 제주시 소상공인 경영안정 지원사업 공고", agency: "제주특별자치도", region: "" })).toBe(before);
    expect(withRegionConditions(before, { title: "2026년 부산진구 소상공인 지원 공고", agency: "부산광역시", region: "" })).toBe(before);
  });

  it("F-6c: 전국 조건이 있어도 제목의 대상 분야(targetSector)는 보탠다", () => {
    const before = st([region(["전국"])]);
    const out = withRegionConditions(before, { title: "2026년 혁신형 제약기업 신규인증 공고", agency: "보건복지부", region: "" });
    expect(out.conditions.some((c) => c.key === "targetSector")).toBe(true);
  });
});

describe("2차 리뷰 지적 1 — 태그 없는 제목·기관 시도 없음이면 ① 은 아무것도 안 붙이고 ② 가 산다", () => {
  it("영월군 제목 + 기관 「영월군」 + 지역 칸 「강원」 → ② 로 [강원] 이 붙어 강원 회사가 pass", () => {
    const out = withRegionConditions(
      st([]),
      { title: "2026년 3차 영월군 청년 창업육성 지원사업 수정 공고", agency: "영월군", region: "강원" },
      { regionFieldFallback: true },
    );
    const r = out.conditions.filter((c) => c.key === "region");
    expect(r).toHaveLength(1);
    expect(r[0].value).toEqual(["강원"]);
    expect(checkCondition(r[0], { region: "강원 원주시" }, new Date("2026-09-16T00:00:00Z")).verdict).toBe("pass");
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

describe("withRegionConditions — 제목 대상 분야(targetSector)", () => {
  const TITLE = "2026년 혁신형 제약기업 신규인증 공고";

  it("구조가 비어 있고 제목이 제약기업이면 targetSector 가 붙는다", () => {
    const out = withRegionConditions(st([]), { title: TITLE, agency: "중기부", region: "" });
    const c = out.conditions.find((x) => x.key === "targetSector");
    expect(c?.value).toEqual(["제약바이오"]);
    expect(c?.op).toBe("in");
    expect(c?.machineReadable).toBe(true);
  });

  it("이미 있으면 안 붙인다", () => {
    const before = st([{
      key: "targetSector", op: "in", value: ["식품"], rawText: "기존", machineReadable: true,
    }]);
    const out = withRegionConditions(before, { title: TITLE, agency: "중기부", region: "" });
    expect(out.conditions.filter((c) => c.key === "targetSector")).toHaveLength(1);
    expect(out.conditions[0].value).toEqual(["식품"]);
    expect(out).toBe(before);
  });
});

describe("withRegionConditions — 제목 대상 유형(targetOrg)", () => {
  const TITLE = "[충남] 2026년 (예비)사회적기업 사업개발비 지원사업 참여기업 모집 공고";

  it("구조에 없고 제목이 자격형(사회적기업 사업개발비)이면 붙는다", () => {
    const out = withRegionConditions(st([]), { title: TITLE, agency: "충청남도", region: "" });
    const c = out.conditions.find((x) => x.key === "targetOrg");
    expect(c?.value).toEqual(["사회적기업"]);
    expect(c?.op).toBe("in");
    expect(c?.machineReadable).toBe(true);
  });

  it("이미 있으면 안 붙인다", () => {
    const before = st([{
      key: "targetOrg", op: "in", value: ["사회적기업"], rawText: "기존", machineReadable: true,
    }]);
    const out = withRegionConditions(before, { title: TITLE, agency: "목포시", region: "" });
    expect(out.conditions.filter((c) => c.key === "targetOrg")).toHaveLength(1);
    expect(out.conditions[0].value).toEqual(["사회적기업"]);
    expect(out).toBe(before);
  });
});

describe("withRegionConditions — 시군구 사전 조건", () => {
  const YEONGWOL = "2026년 3차 영월군 청년 창업육성 지원사업 수정 공고";

  it("구조에 [영월군] 기계 조건이 있으면 그대로 돌려준다", () => {
    const before = st([region(["영월군"])]);
    const out = withRegionConditions(before, {
      title: YEONGWOL, agency: "강원특별자치도", region: "",
    });
    expect(out).toBe(before);
  });

  it("구조가 비고 제목이 영월군이면 조건을 붙이고 전북은 fail·강원 영월군은 pass", () => {
    const out = withRegionConditions(st([]), {
      title: YEONGWOL, agency: "강원특별자치도", region: "",
    });
    const c = out.conditions.find((x) => x.key === "region")!;
    expect(c.value).toEqual(["영월군"]);
    expect(c.machineReadable).toBe(true);
    expect(checkCondition(c, { region: "전북 전주시" }, new Date()).verdict).toBe("fail");
    expect(checkCondition(c, { region: "강원특별자치도 영월군" }, new Date()).verdict).toBe("pass");
  });
});
