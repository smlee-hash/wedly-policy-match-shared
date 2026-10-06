import { describe, expect, it } from "vitest";
import { feedbackDiffOf, isFeedbackDiff, type FeedbackDiff, type FeedbackDiffFact, type FeedbackDiffRound } from "./feedback-diff";
import type { BusinessProfile } from "./match-engine";

/** 기준 시각 = 한국 시각 2026-10-06 10:00 → 「작년」은 2025. 시험이 도는 컴퓨터의 시간대와 무관하다. */
const NOW = new Date("2026-10-06T10:00:00+09:00");

const 회차 = (facts: FeedbackDiffFact[]): FeedbackDiffRound => ({ round: 2, at: "2026-10-01T03:00:00.000Z", facts });

/** 통로를 건너온 이상한 사실 — 타입은 이런 값을 못 막는다. */
const 이상한사실 = (v: unknown): FeedbackDiffFact => v as FeedbackDiffFact;

describe("feedbackDiffOf — 같음·다름·빈 칸", () => {
  it("글자가 같으면 줄을 만들지 않고, 줄이 하나도 없으면 null", () => {
    const profile: BusinessProfile = { employeeCount: 12, hasCert: true, companyScale: "소기업", patentCount: 3 };
    const out = feedbackDiffOf(
      profile,
      회차([
        { axis: "employeeCount", value: 12 },
        { axis: "hasCert", value: true },
        { axis: "companyScale", value: "소기업" },
        { axis: "patentCount", value: 3 },
      ]),
      NOW,
    );
    expect(out).toBeNull();
  });

  it("값이 다르면 줄이 생기고 회차 번호·시각이 그대로 실린다", () => {
    const out = feedbackDiffOf({ employeeCount: 10 }, 회차([{ axis: "employeeCount", value: 12 }]), NOW);
    expect(out).toEqual({
      round: 2,
      at: "2026-10-01T03:00:00.000Z",
      rows: [{ field: "employeeCount", label: "직원수", current: "10명", feedback: "12명" }],
    });
  });

  it("같은 줄과 다른 줄이 섞이면 다른 줄만 남는다", () => {
    const out = feedbackDiffOf(
      { employeeCount: 12, hasCert: false },
      회차([
        { axis: "employeeCount", value: 12 },
        { axis: "hasCert", value: true },
      ]),
      NOW,
    );
    expect(out?.rows).toEqual([{ field: "hasCert", label: "인증", current: "없음", feedback: "있음" }]);
  });

  it("상태표에 값이 없으면(undefined·null·빈 문자열) current 가 null 인 줄이 된다", () => {
    const facts: FeedbackDiffFact[] = [
      { axis: "employeeCount", value: 12 },
      { axis: "companyScale", value: "소기업" },
      { axis: "hasCert", value: true },
    ];
    // undefined — 칸 자체가 없다
    expect(feedbackDiffOf({}, 회차(facts), NOW)?.rows.map((r) => r.current)).toEqual([null, null, null]);
    // null·빈 문자열 — 통로가 안 채운 칸을 이렇게 보내기도 한다
    const 비어있음 = { employeeCount: null, companyScale: "", hasCert: null } as unknown as BusinessProfile;
    expect(feedbackDiffOf(비어있음, 회차(facts), NOW)?.rows.map((r) => r.current)).toEqual([null, null, null]);
  });

  it("false·0 은 채워진 값이다 — 상태표의 「없음」·「0명」을 빈 칸으로 보지 않는다", () => {
    const out = feedbackDiffOf(
      { hasCert: false, employeeCount: 0 },
      회차([
        { axis: "hasCert", value: true },
        { axis: "employeeCount", value: 3 },
      ]),
      NOW,
    );
    expect(out?.rows.map((r) => r.current)).toEqual(["0명", "없음"]);
  });
});

describe("feedbackDiffOf — 글자 형식", () => {
  it("직원수 `12명` · 신용점수 `820` · 기업 규모 글자 그대로 · 있음/없음 · 특허 건수 `3건`", () => {
    const out = feedbackDiffOf(
      {},
      회차([
        { axis: "employeeCount", value: 12 },
        { axis: "creditScore", value: 820 },
        { axis: "companyScale", value: "소기업" },
        { axis: "hasCert", value: true },
        { axis: "hasPatent", value: false },
        { axis: "patentCount", value: 3 },
        { axis: "hasExistingLoan", value: true },
        { axis: "taxDelinquent", value: false },
      ]),
      NOW,
    );
    expect(out?.rows.map((r) => [r.field, r.feedback])).toEqual([
      ["employeeCount", "12명"],
      ["creditScore", "820"],
      ["companyScale", "소기업"],
      ["hasCert", "있음"],
      ["hasPatent", "없음"],
      ["patentCount", "3건"],
      ["hasExistingLoan", "있음"],
      ["taxDelinquent", "없음"],
    ]);
  });

  it("칸 이름(label)·field 이름이 기준 문서대로다", () => {
    const out = feedbackDiffOf(
      {},
      회차([
        { axis: "employeeCount", value: 1 },
        { axis: "revenue", value: 100_000_000, year: 2025 },
        { axis: "companyScale", value: "소기업" },
        { axis: "hasCert", value: true },
        { axis: "hasPatent", value: true },
        { axis: "patentCount", value: 1 },
        { axis: "hasExistingLoan", value: true },
        { axis: "taxDelinquent", value: true },
      ]),
      NOW,
    );
    expect(out?.rows.map((r) => [r.field, r.label])).toEqual([
      ["employeeCount", "직원수"],
      ["revenue", "매출(작년)"],
      ["companyScale", "기업 규모"],
      ["hasCert", "인증"],
      ["hasPatent", "특허"],
      ["patentCount", "특허 건수"],
      ["hasExistingLoan", "기존 대출"],
      ["taxDelinquent", "체납"],
    ]);
  });

  it("매출은 요약과 같은 억·만 글자로 견준다 — 3.2억 / 8,000만, 화면에 같게 보이면 줄이 없다", () => {
    const 다름 = feedbackDiffOf(
      { lastYearRevenueKrw: 70_000_000 },
      회차([{ axis: "revenue", value: 80_000_000, year: 2025 }]),
      NOW,
    );
    expect(다름?.rows).toEqual([{ field: "revenue", label: "매출(작년)", current: "7,000만", feedback: "8,000만" }]);

    const 억 = feedbackDiffOf(
      { lastYearRevenueKrw: 250_000_000 },
      회차([{ axis: "revenue", value: 320_000_000, year: 2025 }]),
      NOW,
    );
    expect(억?.rows).toEqual([{ field: "revenue", label: "매출(작년)", current: "2.5억", feedback: "3.2억" }]);

    // 3.2억 과 3.24억 은 같은 글자(3.2억)라 알릴 것이 없다
    const 같은글자 = feedbackDiffOf(
      { lastYearRevenueKrw: 320_000_000 },
      회차([{ axis: "revenue", value: 324_000_000, year: 2025 }]),
      NOW,
    );
    expect(같은글자).toBeNull();
  });
});

describe("feedbackDiffOf — 매출은 한국 시각 작년 값만", () => {
  it("작년이 아닌 해(올해·재작년)의 매출은 건너뛴다 — 줄이 없으면 null", () => {
    const profile: BusinessProfile = { lastYearRevenueKrw: 100_000_000 };
    expect(feedbackDiffOf(profile, 회차([{ axis: "revenue", value: 500_000_000, year: 2026 }]), NOW)).toBeNull();
    expect(feedbackDiffOf(profile, 회차([{ axis: "revenue", value: 500_000_000, year: 2024 }]), NOW)).toBeNull();
  });

  it("작년 매출이면 lastYearRevenueKrw 와 견주고 상태표가 비었으면 current null", () => {
    const 있음 = feedbackDiffOf(
      { lastYearRevenueKrw: 100_000_000 },
      회차([{ axis: "revenue", value: 500_000_000, year: 2025 }]),
      NOW,
    );
    expect(한줄(있음)).toEqual({ field: "revenue", label: "매출(작년)", current: "1억", feedback: "5억" });

    const 빈칸 = feedbackDiffOf({}, 회차([{ axis: "revenue", value: 500_000_000, year: 2025 }]), NOW);
    expect(한줄(빈칸)).toEqual({ field: "revenue", label: "매출(작년)", current: null, feedback: "5억" });
  });

  it("한국 시각 경계 — UTC 12/31 16:00 은 한국 1/1 이라 작년이 2026 으로 바뀐다", () => {
    const profile: BusinessProfile = { lastYearRevenueKrw: 100_000_000 };
    const 작년2026 = { axis: "revenue", value: 500_000_000, year: 2026 } as const;
    const 작년2025 = { axis: "revenue", value: 500_000_000, year: 2025 } as const;

    // UTC 로는 아직 2026-12-31 이지만 한국은 이미 2027-01-01 이다(16:00Z = 한국 01:00, 15:00Z = 한국 00:00 정각).
    for (const 새해 of [new Date("2026-12-31T16:00:00Z"), new Date("2026-12-31T15:00:00Z")]) {
      expect(feedbackDiffOf(profile, 회차([작년2026]), 새해)?.rows, 새해.toISOString()).toHaveLength(1);
      expect(feedbackDiffOf(profile, 회차([작년2025]), 새해), 새해.toISOString()).toBeNull();
    }

    // 한국 2026-12-31 23:59:59 — 아직 한국도 2026 이라 작년은 2025
    const 직전 = new Date("2026-12-31T14:59:59Z");
    expect(feedbackDiffOf(profile, 회차([작년2025]), 직전)?.rows).toHaveLength(1);
    expect(feedbackDiffOf(profile, 회차([작년2026]), 직전)).toBeNull();
  });
});

describe("feedbackDiffOf — 신용점수 NICE·KCB·일반은 서로 다른 칸", () => {
  it("기관 NICE → creditScoreNice, KCB → creditScoreKcb, 기관 없음 → creditScore 와 견준다", () => {
    const out = feedbackDiffOf(
      { creditScoreNice: 800, creditScoreKcb: 700, creditScore: 600 },
      회차([
        { axis: "creditScore", value: 820, agency: "NICE" },
        { axis: "creditScore", value: 790, agency: "KCB" },
        { axis: "creditScore", value: 750 },
      ]),
      NOW,
    );
    expect(out?.rows).toEqual([
      { field: "creditScoreNice", label: "신용점수(NICE)", current: "800", feedback: "820" },
      { field: "creditScoreKcb", label: "신용점수(KCB)", current: "700", feedback: "790" },
      { field: "creditScore", label: "신용점수", current: "600", feedback: "750" },
    ]);
  });

  it("다른 기관 칸과는 견주지 않는다 — NICE 820 은 상태표 KCB 820 과 같아도 NICE 칸이 비었으면 줄이 생긴다", () => {
    const out = feedbackDiffOf(
      { creditScoreKcb: 820, creditScore: 820 },
      회차([{ axis: "creditScore", value: 820, agency: "NICE" }]),
      NOW,
    );
    expect(out?.rows).toEqual([{ field: "creditScoreNice", label: "신용점수(NICE)", current: null, feedback: "820" }]);
  });

  it("기관이 같은 칸끼리만 같음으로 친다 — 일반 점수가 같으면 줄 없음", () => {
    expect(feedbackDiffOf({ creditScore: 750 }, 회차([{ axis: "creditScore", value: 750 }]), NOW)).toBeNull();
    expect(
      feedbackDiffOf({ creditScoreNice: 820 }, 회차([{ axis: "creditScore", value: 820, agency: "NICE" }]), NOW),
    ).toBeNull();
  });

  it("기관별 점수는 같은 기관끼리 따로 마지막 값을 쓴다 — 서로 덮어쓰지 않는다", () => {
    const out = feedbackDiffOf(
      {},
      회차([
        { axis: "creditScore", value: 800, agency: "NICE" },
        { axis: "creditScore", value: 700, agency: "KCB" },
        { axis: "creditScore", value: 820, agency: "NICE" },
      ]),
      NOW,
    );
    expect(out?.rows.map((r) => [r.field, r.feedback])).toEqual([
      ["creditScoreNice", "820"],
      ["creditScoreKcb", "700"],
    ]);
  });
});

describe("feedbackDiffOf — 같은 칸이 여러 번이면 마지막", () => {
  it("같은 축이 두 번 나오면 배열에서 마지막 것 하나만 쓴다", () => {
    const out = feedbackDiffOf(
      { employeeCount: 10 },
      회차([
        { axis: "employeeCount", value: 11 },
        { axis: "employeeCount", value: 12 },
      ]),
      NOW,
    );
    expect(out?.rows).toEqual([{ field: "employeeCount", label: "직원수", current: "10명", feedback: "12명" }]);
  });

  it("마지막 값이 상태표와 같으면 앞의 다른 값은 무시되어 줄이 없다", () => {
    const out = feedbackDiffOf(
      { employeeCount: 12 },
      회차([
        { axis: "employeeCount", value: 11 },
        { axis: "employeeCount", value: 12 },
      ]),
      NOW,
    );
    expect(out).toBeNull();
  });

  it("버려지는 사실(숫자 아님·다른 해)은 마지막 자리를 차지하지 못한다 — 남은 것 중 마지막을 쓴다", () => {
    const out = feedbackDiffOf(
      {},
      회차([
        { axis: "employeeCount", value: 12 },
        이상한사실({ axis: "employeeCount", value: Number.NaN }),
        { axis: "revenue", value: 500_000_000, year: 2025 },
        { axis: "revenue", value: 900_000_000, year: 2024 },
      ]),
      NOW,
    );
    expect(out?.rows.map((r) => [r.field, r.feedback])).toEqual([
      ["employeeCount", "12명"],
      ["revenue", "5억"],
    ]);
  });
});

describe("feedbackDiffOf — 줄 순서", () => {
  it("직원수 → 매출(작년) → 신용점수(NICE) → (KCB) → 신용점수 → 기업 규모 → 인증 → 특허 → 특허 건수 → 기존 대출 → 체납", () => {
    // 일부러 거꾸로 넣는다 — 입력 순서가 아니라 정해진 순서로 나와야 한다.
    const facts: FeedbackDiffFact[] = [
      { axis: "taxDelinquent", value: true },
      { axis: "hasExistingLoan", value: true },
      { axis: "patentCount", value: 2 },
      { axis: "hasPatent", value: true },
      { axis: "hasCert", value: true },
      { axis: "companyScale", value: "소기업" },
      { axis: "creditScore", value: 700 },
      { axis: "creditScore", value: 790, agency: "KCB" },
      { axis: "creditScore", value: 820, agency: "NICE" },
      { axis: "revenue", value: 500_000_000, year: 2025 },
      { axis: "employeeCount", value: 12 },
    ];
    const out = feedbackDiffOf({}, 회차(facts), NOW);
    expect(out?.rows.map((r) => r.field)).toEqual([
      "employeeCount",
      "revenue",
      "creditScoreNice",
      "creditScoreKcb",
      "creditScore",
      "companyScale",
      "hasCert",
      "hasPatent",
      "patentCount",
      "hasExistingLoan",
      "taxDelinquent",
    ]);
    expect(out?.rows.map((r) => r.label)).toEqual([
      "직원수",
      "매출(작년)",
      "신용점수(NICE)",
      "신용점수(KCB)",
      "신용점수",
      "기업 규모",
      "인증",
      "특허",
      "특허 건수",
      "기존 대출",
      "체납",
    ]);
  });
});

describe("feedbackDiffOf — 회차가 없거나 알릴 것이 없으면 null", () => {
  it("round 가 null 이면 null", () => {
    expect(feedbackDiffOf({ employeeCount: 10 }, null, NOW)).toBeNull();
  });

  it("사실이 하나도 없으면 null", () => {
    expect(feedbackDiffOf({ employeeCount: 10 }, 회차([]), NOW)).toBeNull();
  });
});

describe("feedbackDiffOf — 통로를 건너온 값 방어", () => {
  it("알 수 없는 axis·숫자 아닌 값(NaN·Infinity·글자)·모양이 틀린 사실은 버린다", () => {
    const out = feedbackDiffOf(
      {},
      회차([
        이상한사실({ axis: "mystery", value: 1 }),
        이상한사실({ axis: "employeeCount", value: Number.NaN }),
        이상한사실({ axis: "employeeCount", value: Number.POSITIVE_INFINITY }),
        이상한사실({ axis: "employeeCount", value: "12" }),
        이상한사실({ axis: "creditScore", value: Number.NaN }),
        이상한사실({ axis: "patentCount", value: null }),
        이상한사실({ axis: "revenue", value: Number.NaN, year: 2025 }),
        이상한사실({ axis: "hasCert", value: "true" }),
        이상한사실({ axis: "companyScale", value: 3 }),
        이상한사실({ axis: "companyScale", value: "" }),
        이상한사실(null),
        이상한사실("employeeCount"),
        이상한사실(42),
      ]),
      NOW,
    );
    expect(out).toBeNull();
  });

  it("버릴 것이 섞여 있어도 멀쩡한 사실은 그대로 줄이 된다", () => {
    const out = feedbackDiffOf(
      { employeeCount: 10 },
      회차([이상한사실({ axis: "mystery", value: 1 }), { axis: "employeeCount", value: 12 }, 이상한사실(null)]),
      NOW,
    );
    expect(out?.rows).toEqual([{ field: "employeeCount", label: "직원수", current: "10명", feedback: "12명" }]);
  });

  it("facts 가 배열이 아니어도 터지지 않고 null", () => {
    const 이상한회차 = { round: 1, at: "2026-10-01T00:00:00.000Z", facts: null } as unknown as FeedbackDiffRound;
    expect(feedbackDiffOf({}, 이상한회차, NOW)).toBeNull();
  });

  it("상태표 쪽 숫자가 NaN 이면 빈 칸으로 본다 — 「NaN명」 같은 글자를 만들지 않는다", () => {
    const profile = { employeeCount: Number.NaN } as unknown as BusinessProfile;
    const out = feedbackDiffOf(profile, 회차([{ axis: "employeeCount", value: 12 }]), NOW);
    expect(out?.rows[0].current).toBeNull();
  });
});

describe("isFeedbackDiff — 통로를 건너온 값 모양 검사", () => {
  const 올바름: FeedbackDiff = {
    round: 2,
    at: "2026-10-01T03:00:00.000Z",
    rows: [
      { field: "employeeCount", label: "직원수", current: "10명", feedback: "12명" },
      { field: "hasCert", label: "인증", current: null, feedback: "있음" },
    ],
  };

  it("올바른 모양이면 참 — current 는 글자 또는 null", () => {
    expect(isFeedbackDiff(올바름)).toBe(true);
    expect(isFeedbackDiff({ ...올바름, rows: [] }), "줄이 0개여도 모양은 맞다(그릴지는 화면이 따로 정한다)").toBe(true);
  });

  it("feedbackDiffOf 가 만든 값은 그대로 통과한다", () => {
    const out = feedbackDiffOf({ employeeCount: 10 }, 회차([{ axis: "employeeCount", value: 12 }]), NOW);
    expect(isFeedbackDiff(out)).toBe(true);
  });

  it("객체가 아니거나 null 이면 거짓", () => {
    for (const v of [null, undefined, "diff", 3, true, []]) expect(isFeedbackDiff(v), String(v)).toBe(false);
  });

  it("round 가 정수가 아니거나 at 가 글자가 아니거나 rows 가 배열이 아니면 거짓", () => {
    expect(isFeedbackDiff({ ...올바름, round: 1.5 })).toBe(false);
    expect(isFeedbackDiff({ ...올바름, round: "2" })).toBe(false);
    expect(isFeedbackDiff({ ...올바름, round: Number.NaN })).toBe(false);
    expect(isFeedbackDiff({ ...올바름, at: 20261001 })).toBe(false);
    expect(isFeedbackDiff({ ...올바름, rows: null })).toBe(false);
    expect(isFeedbackDiff({ ...올바름, rows: {} })).toBe(false);
    expect(isFeedbackDiff({ at: 올바름.at, rows: 올바름.rows }), "round 칸이 아예 없으면 거짓").toBe(false);
  });

  it("줄 하나라도 field·label·feedback 이 글자가 아니거나 current 가 글자·null 이 아니면 거짓", () => {
    const 줄 = { field: "hasCert", label: "인증", current: "없음", feedback: "있음" };
    expect(isFeedbackDiff({ ...올바름, rows: [줄] })).toBe(true);
    expect(isFeedbackDiff({ ...올바름, rows: [{ ...줄, field: 1 }] })).toBe(false);
    expect(isFeedbackDiff({ ...올바름, rows: [{ ...줄, label: null }] })).toBe(false);
    expect(isFeedbackDiff({ ...올바름, rows: [{ ...줄, feedback: undefined }] })).toBe(false);
    expect(isFeedbackDiff({ ...올바름, rows: [{ ...줄, current: 3 }] })).toBe(false);
    expect(isFeedbackDiff({ ...올바름, rows: [{ ...줄, current: undefined }] }), "current 칸이 아예 없으면 거짓").toBe(false);
    expect(isFeedbackDiff({ ...올바름, rows: [줄, null] })).toBe(false);
    expect(isFeedbackDiff({ ...올바름, rows: ["hasCert"] })).toBe(false);
  });

  it("줄이 20개까지는 참, 21개부터는 거짓", () => {
    const 줄 = { field: "hasCert", label: "인증", current: null, feedback: "있음" };
    expect(isFeedbackDiff({ ...올바름, rows: Array.from({ length: 20 }, () => 줄) })).toBe(true);
    expect(isFeedbackDiff({ ...올바름, rows: Array.from({ length: 21 }, () => 줄) })).toBe(false);
  });
});

/** 줄이 하나만 나와야 하는 시험에서 그 줄을 꺼낸다 — 없거나 둘 이상이면 시험이 바로 걸린다. */
function 한줄(diff: FeedbackDiff | null) {
  expect(diff, "줄이 하나도 안 나왔다").not.toBeNull();
  expect(diff!.rows, "줄이 하나여야 한다").toHaveLength(1);
  return diff!.rows[0];
}
