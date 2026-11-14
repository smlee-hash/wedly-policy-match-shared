// 단계 식별자 붙이기 — 같은 입력이면 앱 안(ERP)과 같은 id 가 나와야 한다.
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ensureStepIds, type StepGroup } from "./step-ids";

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

describe("ensureStepIds", () => {
  const groups: StepGroup[] = [
    { name: "신청", steps: [{ label: "사전 점검", status: "대기" }, { label: "접수", status: "대기" }] },
  ];

  it("같은 입력을 두 번 넣으면 같은 id 를 주고 입력은 그대로 둔다", () => {
    const snapshot = structuredClone(groups);
    const first = ensureStepIds(groups);
    const second = ensureStepIds(groups);
    const hash0 = sha256Hex("신청사전 점검").slice(0, 6);
    const hash1 = sha256Hex("신청접수").slice(0, 6);
    expect(first.groups[0]?.steps[0]?.id).toBe(`s-0-0-${hash0}`);
    expect(first.groups[0]?.steps[1]?.id).toBe(`s-0-1-${hash1}`);
    expect(second.groups[0]?.steps[0]?.id).toBe(first.groups[0]?.steps[0]?.id);
    expect(second.groups[0]?.steps[1]?.id).toBe(first.groups[0]?.steps[1]?.id);
    expect(first.changed).toBe(true);
    expect(groups).toEqual(snapshot);
    expect(groups[0]?.steps[0]?.id).toBeUndefined();
    expect(first.groups).not.toBe(groups);
    expect(first.groups[0]?.steps[0]).not.toBe(groups[0]?.steps[0]);
  });

  it("이미 있는 id 는 유지하고 changed 는 false 다", () => {
    const withId: StepGroup[] = [
      { name: "신청", steps: [{ label: "사전 점검", status: "대기", id: "keep-me" }] },
    ];
    const result = ensureStepIds(withId);
    expect(result.groups[0]?.steps[0]?.id).toBe("keep-me");
    expect(result.changed).toBe(false);
    expect(withId[0]?.steps[0]?.id).toBe("keep-me");
  });

  it("[A,B,C] 에서 B 를 지우고 C 와 같은 이름을 추가해도 두 단계의 id 가 다르다", () => {
    const hashA = sha256Hex("신청A").slice(0, 6);
    const hashC = sha256Hex("신청C").slice(0, 6);
    const idA = `s-0-0-${hashA}`;
    const idC = `s-0-2-${hashC}`;
    const result = ensureStepIds([
      {
        name: "신청",
        steps: [
          { label: "A", status: "대기", id: idA },
          { label: "C", status: "대기", id: idC },
          { label: "C", status: "대기" },
        ],
      },
    ]);
    const ids = result.groups[0]?.steps.map((step) => step.id) ?? [];
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
    expect(ids[0]).toBe(idA);
    expect(ids[1]).toBe(idC);
    expect(ids[2]).toBe(`${idC}-2`);
    expect(result.changed).toBe(true);
  });

  it("이미 쓰인 id 가 겹치면 뒤엣것에 -2, -3 을 붙인다", () => {
    const result = ensureStepIds([
      {
        name: "신청",
        steps: [
          { label: "A", status: "대기", id: "same" },
          { label: "B", status: "대기", id: "same" },
          { label: "C", status: "대기", id: "same" },
        ],
      },
    ]);
    expect(result.groups[0]?.steps.map((step) => step.id)).toEqual(["same", "same-2", "same-3"]);
    expect(result.changed).toBe(true);
  });
});
