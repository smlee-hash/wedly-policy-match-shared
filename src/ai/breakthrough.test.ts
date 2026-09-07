import { describe, expect, it } from "vitest";
import {
  BLOCKED_CAP,
  BREAKTHROUGH_JSON_SCHEMA,
  blockedConditionsOf,
  breakthroughCapNote,
  buildBreakthroughUserPrompt,
  pickBlockedForAi,
  sourceBadgeBox,
  sourceKindOf,
} from "./breakthrough";

describe("BREAKTHROUGH_JSON_SCHEMA", () => {
  it("스키마에 maxItems/minItems 가 없고 모든 묶음이 additionalProperties:false 다", () => {
    const json = JSON.stringify(BREAKTHROUGH_JSON_SCHEMA);
    expect(json).not.toContain("maxItems");
    expect(json).not.toContain("minItems");
    expect(BREAKTHROUGH_JSON_SCHEMA.additionalProperties).toBe(false);
    expect(BREAKTHROUGH_JSON_SCHEMA.properties.items.items.additionalProperties).toBe(false);
    expect(BREAKTHROUGH_JSON_SCHEMA.properties.items.items.properties.sources.items.additionalProperties).toBe(false);
  });
});

describe("buildBreakthroughUserPrompt", () => {
  it("근거 있는 조건은 근거 조각을, 없는 조건은 내부 근거 없음을 넣는다", () => {
    const prompt = buildBreakthroughUserPrompt({
      policyTitle: "청년 고용 장려금",
      conditions: [
        { condition: "고용보험 피보험자 5인 이상", status: "미충족", note: "현재 3인" },
        { condition: "업력 3년 이상", status: "확인필요" },
      ],
      snippetsByCondition: [
        {
          condition: "고용보험 피보험자 5인 이상",
          snippets: [{ kind: "자료실", ref: "채용 우회", text: "2명 추가 채용 후 신청" }],
        },
      ],
    });
    expect(prompt).toContain("청년 고용 장려금");
    expect(prompt).toContain("고용보험 피보험자 5인 이상");
    expect(prompt).toContain("[근거1] (자료실·채용 우회) 2명 추가 채용 후 신청");
    expect(prompt).toContain("업력 3년 이상");
    expect(prompt).toContain("(내부 근거 없음)");
    expect(prompt).toContain("hasInternalCase=false");
    expect(prompt).toContain("내부 사례 없음 — 강사 확인 필요");
  });
});

describe("blockedConditionsOf", () => {
  it("미충족·확인필요만 남기고 충족은 뺀다 — 0건이면 빈 배열", () => {
    expect(
      blockedConditionsOf([
        { condition: "서울 소재", status: "충족", note: "맞음" },
        { condition: "고용보험 5인", status: "미충족", note: "3인" },
        { condition: "업력 3년", status: "확인필요" },
      ]),
    ).toEqual([
      { condition: "고용보험 5인", status: "미충족", note: "3인" },
      { condition: "업력 3년", status: "확인필요" },
    ]);
    expect(blockedConditionsOf([{ condition: "서울 소재", status: "충족" }])).toEqual([]);
  });
});

describe("sourceKindOf", () => {
  it("자료실·고객이력·통화만 인정하고 모르는 값은 자료실로 바꾸지 않는다", () => {
    expect(sourceKindOf("자료실")).toBe("자료실");
    expect(sourceKindOf("고객이력")).toBe("고객이력");
    expect(sourceKindOf("통화")).toBe("통화");
    expect(sourceKindOf("이상한값")).toBeNull();
    expect(sourceKindOf("웹검색")).toBeNull();
  });
});

describe("sourceBadgeBox", () => {
  /**
   * ★옮겨 오면서 **기대값 두 줄만** 고쳤다(2026-09-07). 이 시험은 ERP 에서 2026-08-25
   *  커밋 `e06418983`(「보조 글자를 읽히게」) 뒤로 계속 깨져 있었다 — 그 커밋이 회색 워시 위
   *  `text-wedly-muted`(대비 미달)를 `text-wedly-t2` 로 바꿨는데, 이 시험 파일이 ERP 의
   *  배포 전 관문 목록(`package.json` build)에 **이름으로 등록돼 있지 않아** 아무도 못 봤다.
   *  실물(화면에 나가는 값)이 맞고 기대값이 낡은 쪽이라, 실물이 아니라 기대값을 맞췄다.
   */
  it("모르는 kind 는 중립 회색이지 자료실 파랑이 아니다", () => {
    expect(sourceBadgeBox("자료실")).toBe("bg-wedly-bg-blue text-wedly-accent-ink");
    expect(sourceBadgeBox("고객이력")).toBe("bg-wedly-bg-purple text-wedly-purple-ink");
    expect(sourceBadgeBox("통화")).toBe("bg-wedly-bg-green text-wedly-green-ink");
    expect(sourceBadgeBox("웹검색")).toBe("bg-wedly-bg-gray text-wedly-t2");
    expect(sourceBadgeBox("이상한값")).toBe("bg-wedly-bg-gray text-wedly-t2");
  });
});

describe("pickBlockedForAi", () => {
  it("미충족을 먼저, 그다음 확인필요를 최대 8건만 남긴다", () => {
    expect(BLOCKED_CAP).toBe(8);
    const rows = [
      { condition: "확인-1", status: "확인필요" as const },
      { condition: "미충족-1", status: "미충족" as const },
      { condition: "확인-2", status: "확인필요" as const },
      { condition: "미충족-2", status: "미충족" as const },
      ...Array.from({ length: 8 }, (_, i) => ({
        condition: `확인-extra-${i}`,
        status: "확인필요" as const,
      })),
    ];
    const picked = pickBlockedForAi(rows);
    expect(picked).toHaveLength(8);
    expect(picked.map((c) => c.condition)).toEqual([
      "미충족-1",
      "미충족-2",
      "확인-1",
      "확인-2",
      "확인-extra-0",
      "확인-extra-1",
      "확인-extra-2",
      "확인-extra-3",
    ]);
    expect(picked.find((c) => c.condition === "확인-extra-4")).toBeUndefined();
  });

  it("미충족이 8건을 넘으면 확인필요는 한 건도 안 넣는다", () => {
    const rows = [
      ...Array.from({ length: 10 }, (_, i) => ({ condition: `막힘-${i}`, status: "미충족" as const })),
      { condition: "애매", status: "확인필요" as const },
    ];
    const picked = pickBlockedForAi(rows);
    expect(picked).toHaveLength(8);
    expect(picked.every((c) => c.status === "미충족")).toBe(true);
    expect(picked[7].condition).toBe("막힘-7");
  });
});

describe("breakthroughCapNote", () => {
  it("전체보다 적게 분석했을 때만 안내 문구를 만든다", () => {
    expect(breakthroughCapNote(8, 12)).toBe("안 되는 조건 12건 중 8건을 분석했습니다");
    expect(breakthroughCapNote(8, 8)).toBeNull();
    expect(breakthroughCapNote(3, 3)).toBeNull();
  });
});
