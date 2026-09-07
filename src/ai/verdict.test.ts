import { describe, expect, it } from "vitest";
import {
  buildVerdictUserPrompt,
  VERDICT_JSON_SCHEMA,
  VERDICT_VERSION,
  type VerdictPromptInput,
} from "./verdict";

function baseInput(over: Partial<VerdictPromptInput> = {}): VerdictPromptInput {
  return {
    title: "청년창업 지원",
    agency: "중기부",
    category: "금융",
    applyPeriodText: "2026-08-01 ~ 2026-09-30",
    targetText: "서울 소재",
    summary: "사업화 자금",
    benefitSummary: "자금",
    supportAmountText: "1억",
    conditions: [{ rawText: "서울 소재", machineReadable: true }],
    humanCheck: [],
    structureIncomplete: false,
    profile: { region: "서울" },
    machine: { grade: "uncertain", checks: [] },
    ...over,
  };
}

describe("buildVerdictUserPrompt — 첨부 원문", () => {
  it("첨부 원문이 있으면 발췌 섹션을 넣는다", () => {
    const prompt = buildVerdictUserPrompt(baseInput({
      attachmentText: "R&D 예산: 286.16억원. 업력 3년 이하.",
    }));
    expect(prompt).toContain("첨부 원문");
    expect(prompt).toContain("R&D 예산: 286.16억원");
    expect(prompt).toContain("업력 3년 이하");
  });

  it("첨부 원문이 없으면 발췌 섹션을 넣지 않는다", () => {
    const prompt = buildVerdictUserPrompt(baseInput());
    expect(prompt).not.toContain("첨부 원문");
  });
});

// ── 아래 3묶음은 보관함으로 옮기며 더한 것(P4 계획서 Task A1) ────────────────────
// 판정 열쇠·응답 형식·프로필 9칸은 「저장해 둔 AI 판정을 언제 버리나」를 정하는 값이라,
// 조용히 바뀌면 **같은 공고가 화면마다 다르게 판정된다.** 그래서 여기서 못 박는다.

describe("VERDICT_VERSION — 캐시 열쇠에 들어가는 판본", () => {
  it("지금 판본은 1이다 — 올릴 때는 저장해 둔 판정이 전부 무효가 된다는 뜻이다", () => {
    expect(VERDICT_VERSION).toBe(1);
  });
});

describe("VERDICT_JSON_SCHEMA — 응답 형식", () => {
  it("필수 칸 세 개(grade·explanation·checklist)를 요구한다", () => {
    expect(VERDICT_JSON_SCHEMA.required).toContain("grade");
    expect(VERDICT_JSON_SCHEMA.required).toContain("explanation");
    expect(VERDICT_JSON_SCHEMA.required).toContain("checklist");
  });

  it("개수 제한(maxItems·minItems)을 넣지 않는다 — 넣으면 Anthropic 이 400 으로 거절한다", () => {
    const json = JSON.stringify(VERDICT_JSON_SCHEMA);
    expect(json).not.toContain("maxItems");
    expect(json).not.toContain("minItems");
  });
});

describe("buildVerdictUserPrompt — 사업자 정보 9칸", () => {
  /**
   * 판정 캐시 열쇠가 쓰는 아홉 칸(계획서 §0). 하나라도 지시문에서 빠지면
   * 「열쇠는 달라졌는데 AI 는 같은 것만 본다」가 되어 캐시가 거짓이 된다.
   */
  it("아홉 칸의 값이 전부 지시문 글자에 들어간다", () => {
    const prompt = buildVerdictUserPrompt(baseInput({
      profile: {
        industry: "전자부품 제조업",
        region: "서울",
        foundedDate: "2020-03-02",
        lastYearRevenueKrw: 512_000_000,
        employeeCount: 12,
        companyScale: "중소기업",
        taxDelinquent: false,
        hasCert: true,
        hasPatent: false,
      },
    }));
    expect(prompt).toContain("주업종: 전자부품 제조업");
    expect(prompt).toContain("소재지: 서울");
    expect(prompt).toContain("설립일: 2020-03-02");
    expect(prompt).toContain("작년 연매출: 512,000,000원");
    expect(prompt).toContain("상시 근로자 수: 12명");
    expect(prompt).toContain("기업 규모: 중소기업");
    expect(prompt).toContain("세금 체납: 체납 없음");
    expect(prompt).toContain("인증 보유: 보유");
    expect(prompt).toContain("특허 보유: 미보유");
  });

  it("빈 칸은 「모름」이라고 분명히 적는다 — 충족으로 둔갑시키지 않는다", () => {
    const prompt = buildVerdictUserPrompt(baseInput({ profile: {} }));
    for (const label of [
      "주업종", "소재지", "설립일", "작년 연매출",
      "상시 근로자 수", "기업 규모", "세금 체납", "인증 보유", "특허 보유",
    ]) {
      expect(prompt).toContain(`- ${label}: 모름`);
    }
  });
});
