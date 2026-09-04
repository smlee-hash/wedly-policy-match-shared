import { describe, it, expect } from "vitest";
import {
  CONDITION_KEYS,
  EXPECTED_OP,
  OTHER_CONDITION_LABEL,
  conditionLabelOf,
  gradeOf,
  type ConditionCheck,
  type StructuredCondition,
} from "./structure-types";

function check(verdict: ConditionCheck["verdict"]): ConditionCheck {
  const condition: StructuredCondition = {
    key: "region",
    op: "in",
    value: ["서울"],
    rawText: "서울 소재",
    machineReadable: true,
  };
  return { condition, verdict, note: "" };
}

describe("gradeOf — 대조 결과 묶음 → 등급", () => {
  it("fail 1개면 impossible", () => {
    expect(gradeOf([check("pass"), check("fail")])).toBe("impossible");
  });

  it("기계 조건이 전부 pass 면 possible", () => {
    expect(gradeOf([check("pass"), check("pass")])).toBe("possible");
  });

  it("unknown 있으면 uncertain", () => {
    expect(gradeOf([check("pass"), check("unknown")])).toBe("uncertain");
  });

  // 2026-08-22 독립 화면 검사 1번 — 사람 확인 조건은 등급을 내리지 않는다(칩으로만 알린다).
  it("사람확인필요가 있어도 기계 조건이 전부 pass 면 possible", () => {
    expect(gradeOf([check("pass")])).toBe("possible");
  });

  it("기계 조건이 하나도 없으면 uncertain — 통과를 말할 근거가 없다", () => {
    expect(gradeOf([])).toBe("uncertain");
  });

  it("기계 조건이 없어도 fail 이 있으면 impossible 이 먼저다", () => {
    expect(gradeOf([check("fail")])).toBe("impossible");
  });
});

// 2026-08-22 독립 재검사 1번 — 같은 원문을 쓰는 두 조건을 화면에서 가르는 것이 이 표다.
// 라벨이 빠지거나(→「기타」) 서로 겹치면 체크리스트가 다시 구분 불가가 된다.
describe("conditionLabelOf — 조건 키별 화면 라벨", () => {
  it("모든 조건 키에 고유한 라벨이 있다", () => {
    const labels = CONDITION_KEYS.map((k) => conditionLabelOf(k));
    for (const [i, key] of CONDITION_KEYS.entries()) {
      expect(labels[i], `${key} 에 라벨이 없다`).toBeTruthy();
      expect(labels[i], `${key} 가 라벨 표에 빠져 「기타」로 떨어진다`).not.toBe(OTHER_CONDITION_LABEL);
    }
    expect(new Set(labels).size, "라벨이 겹치면 두 조건을 구분할 수 없다").toBe(CONDITION_KEYS.length);
  });
});

// 자금 조달 지도(계획 2026-09-03 Task 5) — 상시 상품 targetRules 가 낳는 조건 키 4종.
// op 가 어긋나면 대조가 조용히 뒤집히므로 기대 op 를 여기서 못 박는다.
describe("자금 조달 지도 조건 키 4종", () => {
  it("새 조건 키 4종의 기대 op 와 라벨", () => {
    expect(EXPECTED_OP.creditScoreMin).toBe("gte");
    expect(EXPECTED_OP.creditScoreMax).toBe("lte");
    expect(EXPECTED_OP.hasExistingLoan).toBe("eq");
    expect(EXPECTED_OP.isCorporation).toBe("eq");
    expect(conditionLabelOf("creditScoreMin")).toBe("신용점수 하한");
  });
});
