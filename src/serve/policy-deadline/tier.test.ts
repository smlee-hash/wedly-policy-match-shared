/**
 * NO.789 맞을 확률 단계 — 총괄이 쓴 실패 시험. 구현은 이 시험을 바꾸지 않고 통과시킨다.
 * 단계는 판정 규칙을 바꾸지 않고, 이미 나온 조건별 결과(맞은 조건·확인할 조건·걸림돌)로만 매긴다.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_TIER_CONFIG,
  TIER_LABEL,
  TIER_RANK,
  classifyCheck,
  mergeTierConfig,
  nextActionOf,
  tierOf,
  type TierInput,
} from "./tier";

const pass = (label: string) => ({ label, verdict: "pass" as const, note: "" });
const unknown = (label: string, note: string) => ({ label, verdict: "unknown" as const, note });

function input(p: Partial<TierInput>): TierInput {
  return { verdict: "unverified", fit: [], toCheck: [], obstacles: [], ...p };
}

describe("tierOf — 점수와 단계", () => {
  it("맞음·확인 없음 = 높음 100점, 근거는 「조건 N개 모두 맞음」, 바로 연락", () => {
    const t = tierOf(input({ verdict: "fit", fit: ["업종", "지역", "업력 상한", "기업 규모", "세금 체납"].map(pass) }));
    expect(t).toMatchObject({ tier: "high", score: 100, reason: "조건 5개 모두 맞음", fitTotal: 5, fitPass: 5, checkItems: [] });
    expect(nextActionOf({ tier: t.tier, checkItems: t.checkItems, unstructured: false, inProgress: false })).toBe("고객에게 연락해 신청 안내");
  });

  it("업체 칸 하나 비면 −8 → 92점 높음, 근거·다음 할 일에 칸 이름", () => {
    const t = tierOf(
      input({
        fit: [pass("지역"), pass("업력 상한"), pass("기업 규모"), pass("세금 체납"), unknown("업종", "업종 미입력")],
        toCheck: ["업종 입력"],
      }),
    );
    expect(t.tier).toBe("high");
    expect(t.score).toBe(92);
    expect(t.reason).toBe("조건 5개 중 4개 맞음 · 주업종만 확인");
    expect(t.checkItems).toEqual([
      {
        label: "업종 입력",
        what: "주업종",
        group: "company",
        rank: 1,
        field: "industry",
        where: "기업상태표 › 사업자등록증 주업종",
        current: "비어 있음",
      },
    ]);
    expect(nextActionOf({ tier: t.tier, checkItems: t.checkItems, unstructured: false, inProgress: false })).toBe(
      "고객에게 연락해 신청 안내 · 통화 때 주업종 확인",
    );
  });

  it("걸림돌 −25·공고 확인 −15·업체 칸 −8 → 52점 낮음, 걸림돌이 맨 앞", () => {
    const t = tierOf(
      input({
        fit: [pass("지역"), pass("업력 상한"), pass("기업 규모"), unknown("업종", "제조업 해당 여부를 원문에서 확인"), unknown("직원 수 상한", "직원 수 미입력"), { label: "세금 체납", verdict: "fail", note: "체납 있음" }],
        toCheck: ["업종 제한 확인", "직원 수 입력"],
        obstacles: ["체납 정리 필요"],
      }),
    );
    expect(t.score).toBe(52);
    expect(t.tier).toBe("low");
    expect(t.reason).toBe("조건 6개 중 3개 맞음 · 체납 정리 외 2개 확인");
    expect(t.checkItems.map((c) => [c.label, c.group, c.rank, c.obstacle ?? false])).toEqual([
      ["체납 정리 필요", "company", 0, true],
      ["업종 제한 확인", "notice", 1, false],
      ["직원 수 입력", "company", 5, false],
    ]);
    // 걸림돌 = 업체가 풀어야 할 것: 관련 칸으로 가고, 근거는 그 조건의 판정 줄
    expect(t.checkItems[0]).toMatchObject({ what: "체납 정리", field: "taxArrears", where: "기업상태표 › 국세 체납여부", evidence: "세금 체납: 체납 있음" });
    // 공고 확인 항목의 근거 = 같은 순위의 「모름」 판정 줄(이름표: 메모)
    expect(t.checkItems[1]).toMatchObject({ what: "업종 제한", where: "공고 원문", evidence: "업종: 제조업 해당 여부를 원문에서 확인" });
    expect(t.checkItems[2]).toMatchObject({ what: "직원 수", field: "employees", where: "기업상태표 › 4대보험 인원수", current: "비어 있음" });
    expect(nextActionOf({ tier: t.tier, checkItems: t.checkItems, unstructured: false, inProgress: false })).toBe("체납 정리 확인 후 연락");
  });

  it("조건 정리 전 = 낮음 0점, 근거 「공고 조건을 아직 정리하지 않음」, 다음 할 일 「공고 조건 정리 대기」", () => {
    const t = tierOf(input({ toCheck: ["공고 원문 확인(조건 정리 전)"] }));
    expect(t).toMatchObject({ tier: "low", score: 0, reason: "공고 조건을 아직 정리하지 않음", unstructured: true, checkItems: [] });
    expect(nextActionOf({ tier: t.tier, checkItems: t.checkItems, unstructured: true, inProgress: false })).toBe("공고 조건 정리 대기");
    // 확인 필요인데 확인할 것이 하나도 없어도 조건 정리 전(읽기의 isUnstructuredMatch 와 같은 뜻)
    expect(tierOf(input({})).unstructured).toBe(true);
    expect(tierOf(input({ verdict: "fit" })).unstructured).toBe(false);
  });

  it("원문을 그대로 줄인 확인 −20 → 80점 보통, 근거 문장 = 원문, 다음 할 일 = 공고 원문 먼저", () => {
    const raw = "조건 확인: 중소기업기본법상 소상공인으로서 사업장이 경기도에 있는 자";
    const t = tierOf(input({ fit: [pass("지역"), pass("업력 상한"), pass("기업 규모")], toCheck: [raw] }));
    expect(t.score).toBe(80);
    expect(t.tier).toBe("mid");
    expect(t.reason).toBe("조건 3개 모두 맞음 · 공고 원문 조건만 확인");
    expect(t.checkItems[0]).toMatchObject({ group: "notice", rank: 8, what: "공고 원문 조건", where: "공고 원문", evidence: "중소기업기본법상 소상공인으로서 사업장이 경기도에 있는 자" });
    expect(nextActionOf({ tier: t.tier, checkItems: t.checkItems, unstructured: false, inProgress: false })).toBe("공고 원문에서 자격 먼저 확인");
  });

  it("「자격 조건 원문 확인」이 다른 확인과 섞이면 조건 정리 전이 아니고 −20", () => {
    const t = tierOf(input({ fit: [pass("지역")], toCheck: ["자격 조건 원문 확인", "직원 수 입력"] }));
    expect(t.unstructured).toBe(false);
    expect(t.score).toBe(72);
    expect(t.tier).toBe("mid");
  });

  it("참고 항목(출품 규정·상담 방법·생성형 AI 표시)은 점수·근거에서 빠지고 맨 뒤 「ref」", () => {
    const t = tierOf(
      input({ fit: ["업종", "지역", "업력 상한", "기업 규모"].map(pass), toCheck: ["조건 확인: 출품작은 생성형 AI 활용 여부를 표시", "직원 수 입력"] }),
    );
    expect(t.score).toBe(92);
    expect(t.reason).toBe("조건 4개 모두 맞음 · 직원 수만 확인");
    expect(t.checkItems.map((c) => [c.group, c.rank])).toEqual([
      ["company", 5],
      ["ref", 9],
    ]);
    const onlyRef = tierOf(input({ fit: [pass("업종")], toCheck: ["조건 확인: 상담 방법은 전화 예약"] }));
    expect(onlyRef).toMatchObject({ tier: "high", score: 100, reason: "조건 1개 모두 맞음" });
    expect(nextActionOf({ tier: onlyRef.tier, checkItems: onlyRef.checkItems, unstructured: false, inProgress: false })).toBe("고객에게 연락해 신청 안내");
  });

  it("업종·지역 범위 모름 −10 → 90점 높음, 공고 확인이라 「…확인 후 연락」", () => {
    const t = tierOf(input({ fit: [pass("업력 상한"), pass("기업 규모")], toCheck: ["업종 제한 여부 확인"] }));
    expect(t).toMatchObject({ score: 90, tier: "high", reason: "조건 2개 모두 맞음 · 업종 제한 여부만 확인" });
    expect(nextActionOf({ tier: t.tier, checkItems: t.checkItems, unstructured: false, inProgress: false })).toBe("업종 제한 여부 확인 후 연락");
  });

  it("맞은 조건이 하나도 없으면 높음이 아니라 보통까지만, 근거 앞머리 없음", () => {
    const t = tierOf(input({ toCheck: ["직원 수 입력"] }));
    expect(t.score).toBe(92);
    expect(t.tier).toBe("mid");
    expect(t.reason).toBe("직원 수만 확인");
    expect(nextActionOf({ tier: t.tier, checkItems: t.checkItems, unstructured: false, inProgress: false })).toBe("직원 수 확인 후 연락");
  });

  it("점수는 0 밑으로 안 내려간다", () => {
    const t = tierOf(input({ toCheck: ["조건 확인: 가", "조건 확인: 나", "제외 조건: 다", "업종 제한 확인", "지역 조건 확인"], obstacles: ["특허 필요"] }));
    expect(t.score).toBe(0);
    expect(t.tier).toBe("low");
  });

  it("같은 이름표가 확인할 것·걸림돌에 겹치면 하나로, 저장된 옛 줄처럼 걸림돌이 확인할 것에 섞여 와도 걸림돌로 본다", () => {
    const t = tierOf(input({ fit: [pass("업종")], toCheck: ["요구 인증 필요", "요구 인증 필요"], obstacles: ["요구 인증 필요"] }));
    expect(t.checkItems).toHaveLength(1);
    expect(t.checkItems[0]).toMatchObject({ obstacle: true, rank: 0, what: "요구 인증 보유" });
    expect(t.score).toBe(75);
  });

  it("업체 칸 메모(지금 값·피드백 힌트)는 넘겨준 함수에서 받는다", () => {
    const hint = "피드백 회차에는 \"제조업\"으로 적혀 있음 → 기업상태표에 옮기면 반영";
    const t = tierOf(input({ fit: [pass("지역")], toCheck: ["업종 입력", "소재지 확인"] }), DEFAULT_TIER_CONFIG, (field) =>
      field === "industry" ? { current: "비어 있음", hint } : field === "address" ? { current: "서울특별시 (기업상태표)" } : undefined,
    );
    expect(t.checkItems[0]).toMatchObject({ field: "industry", current: "비어 있음", hint });
    expect(t.checkItems[1]).toMatchObject({ field: "address", what: "사업장 소재지", where: "기업상태표 › 사업장 소재지", current: "서울특별시 (기업상태표)" });
  });

  it("근거 문장은 120자를 넘으면 119자 + 「…」", () => {
    const long = "가".repeat(200);
    const t = tierOf(input({ fit: [unknown("지역", long)], toCheck: ["지역 조건 확인"] }));
    expect(Array.from(t.checkItems[0].evidence ?? "")).toHaveLength(120);
    expect(t.checkItems[0].evidence?.endsWith("…")).toBe(true);
  });
});

describe("classifyCheck — 묶음·순위·칸", () => {
  it.each([
    ["업종 입력", "company", 1, "industry"],
    ["소재지 입력", "company", 2, "address"],
    ["시군구 확인", "company", 2, "address"],
    ["설립일 입력", "company", 4, "foundedDate"],
    ["기업 규모 입력", "company", 3, "companyScale"],
    ["기업 형태 입력", "company", 3, "companyForm"],
    ["법인·개인 구분 확인", "company", 3, "companyForm"],
    ["사업자 등록 여부", "company", 3, "bizno"],
    ["연매출 입력", "company", 5, "revenue"],
    ["매출 입력", "company", 5, "revenue"],
    ["직원 수 입력", "company", 5, "employees"],
    ["인증 보유 입력", "company", 6, "cert"],
    ["특허 보유 입력", "company", 6, "patent"],
    ["체납 여부 입력", "company", 7, "taxArrears"],
    ["신용점수 입력", "company", 7, "creditScore"],
    ["대출 유무 입력", "company", 7, "loan"],
  ] as const)("%s → %s·%i·%s", (label, group, rank, field) => {
    expect(classifyCheck(label)).toMatchObject({ group, rank, field });
  });

  it.each([
    ["업종 제한 확인", 1],
    ["제외 업종 해당 여부", 1],
    ["지역 조건 확인", 2],
    ["요구 특허 종류 확인", 6],
    ["소기업 매출 기준 확인", 5],
    ["지역 제외 조건 확인", 2],
    ["같은 사업 다른 안내 확인", 8],
    ["상품 안내 확인", 8],
    ["기관 문의", 8],
  ] as const)("공고 확인 %s → 순위 %i", (label, rank) => {
    expect(classifyCheck(label)).toMatchObject({ group: "notice", rank });
  });

  it("걸림돌 이름표 셋은 업체 묶음·순위 0·관련 칸", () => {
    expect(classifyCheck("체납 정리 필요")).toMatchObject({ group: "company", rank: 0, obstacle: true, field: "taxArrears", what: "체납 정리" });
    expect(classifyCheck("요구 인증 필요")).toMatchObject({ group: "company", rank: 0, obstacle: true, field: "cert", what: "요구 인증 보유" });
    expect(classifyCheck("특허 필요")).toMatchObject({ group: "company", rank: 0, obstacle: true, field: "patent", what: "특허 보유" });
  });

  it("모르는 이름표는 공고 묶음·순위 8, 원문 줄임은 앞머리를 뗀 원문이 근거", () => {
    expect(classifyCheck("처음 보는 확인")).toMatchObject({ group: "notice", rank: 8, what: "처음 보는" });
    expect(classifyCheck("제외 조건: 휴업 중인 기업")).toMatchObject({ group: "notice", rank: 8, what: "공고 원문 조건", evidence: "휴업 중인 기업" });
    expect(classifyCheck("업종 제한 여부 확인")).toMatchObject({ group: "notice", rank: 1, what: "업종 제한 여부" });
    expect(classifyCheck("지역 제한 여부 확인")).toMatchObject({ group: "notice", rank: 2, what: "지역 제한 여부" });
  });
});

describe("고객 통화로 확인할 것 — 고객 정보로 못 가리는 요건", () => {
  it.each([
    ["대표자 청년(만 39세 이하) 여부", 4],
    ["대표자 만 39세 이하", 4],
    ["직원 나이 조건(만 34세 이하)", 5],
    ["올해 서울시 지원 이력", 8],
    ["지원 이력(같은 사업 수혜 여부)", 8],
    ["집적지 근처 인정 여부 확인", 2],
    ["고용보험 가입 여부", 5],
    ["카드 매출 여부", 5],
    ["예비창업자 여부", 3],
    ["재창업·재도전 대상 여부", 4],
    ["R&D 수행 요건(연구소·연구 인력)", 6],
    ["상시근로자 기준 확인", 5],
  ] as const)("%s → 고객 통화·순위 %i", (label, rank) => {
    expect(classifyCheck(label)).toMatchObject({ group: "notice", rank, where: "고객 통화로 확인" });
  });

  it("공고 원문·기관 문의처는 따로", () => {
    expect(classifyCheck("업종 제한 확인").where).toBe("공고 원문");
    expect(classifyCheck("요구 인증 종류 확인")).toMatchObject({ rank: 6, where: "공고 원문" });
    expect(classifyCheck("기관 문의")).toMatchObject({ rank: 8, where: "공고 기관 문의처" });
  });

  it("첫 항목이 고객 통화면 「고객에게 연락해 … 확인」", () => {
    const t = tierOf(input({ fit: [pass("지역"), pass("업종")], toCheck: ["대표자 청년(만 39세 이하) 여부"] }));
    expect(t).toMatchObject({ score: 85, tier: "mid", reason: "조건 2개 모두 맞음 · 대표자 청년(만 39세 이하) 여부만 확인" });
    expect(nextActionOf({ tier: t.tier, checkItems: t.checkItems, unstructured: false, inProgress: false })).toBe(
      "고객에게 연락해 대표자 청년(만 39세 이하) 여부 확인",
    );
  });
});

describe("nextActionOf", () => {
  it("진행 중이면 다른 것보다 먼저 「업무 현황에서 진행 중」", () => {
    expect(nextActionOf({ tier: "high", checkItems: [], unstructured: true, inProgress: true })).toBe("업무 현황에서 진행 중");
  });
});

describe("mergeTierConfig — 설정값 한 곳", () => {
  it("모르는 값·잘못된 값은 기본값, 맞는 값만 덮는다", () => {
    expect(mergeTierConfig(undefined)).toEqual(DEFAULT_TIER_CONFIG);
    expect(mergeTierConfig("x")).toEqual(DEFAULT_TIER_CONFIG);
    const c = mergeTierConfig({ weights: { noticeCheck: 5, obstacle: -3 }, highMin: 95, referenceWords: ["출품"], text: { contact: "연락" }, extra: 1 });
    expect(c.weights).toEqual({ ...DEFAULT_TIER_CONFIG.weights, noticeCheck: 5 });
    expect(c.highMin).toBe(95);
    expect(c.midMin).toBe(DEFAULT_TIER_CONFIG.midMin);
    expect(c.referenceWords).toEqual(["출품"]);
    expect(c.text.contact).toBe("연락");
    expect(c.text.checkFirst).toBe(DEFAULT_TIER_CONFIG.text.checkFirst);
  });

  it("높음 기준이 보통 기준보다 크지 않으면 둘 다 기본값, 빈 참고 낱말 목록은 기본값", () => {
    const c = mergeTierConfig({ highMin: 50, midMin: 70, referenceWords: [] });
    expect([c.highMin, c.midMin]).toEqual([90, 60]);
    expect(c.referenceWords).toEqual(DEFAULT_TIER_CONFIG.referenceWords);
  });

  it("설정을 바꾸면 점수·단계가 따라간다", () => {
    const cfg = mergeTierConfig({ weights: { noticeCheck: 5 } });
    expect(tierOf(input({ fit: [pass("지역")], toCheck: ["업종 제한 확인"] }), cfg)).toMatchObject({ score: 95, tier: "high" });
  });

  it("기본값과 이름표", () => {
    expect(DEFAULT_TIER_CONFIG.weights).toEqual({ fieldGap: 8, scopeUnknown: 10, noticeCheck: 15, rawCheck: 20, obstacle: 25 });
    expect([DEFAULT_TIER_CONFIG.highMin, DEFAULT_TIER_CONFIG.midMin]).toEqual([90, 60]);
    expect(TIER_LABEL).toEqual({ high: "높음", mid: "보통", low: "낮음" });
    expect(TIER_RANK).toEqual({ high: 0, mid: 1, low: 2 });
  });
});
