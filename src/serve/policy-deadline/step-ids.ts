/**
 * 정부지원금 정책 진행의 단계 모양과 단계 식별자 붙이기 — ERP 의 `components/policy-track/types.ts` 단계 형과
 * `services/policy-track-step-records.ts` 의 `ensureStepIds` 를 그대로 옮겼다(같은 입력이면 앱 안과 같은 id 가 나와야 한다).
 */
import { createHash } from "node:crypto";

export type StepStatus = "대기" | "신청" | "막힘" | "완료";

export type TrackStep = {
  label: string;
  status: StepStatus;
  date?: string;
  by?: string;
  /** 단계 식별자 */
  id?: string;
  /** YYYY-MM-DD 또는 "" (기한 없음) */
  due?: string;
  /** 완료 시각 */
  doneAt?: string;
  /** 막힌 이유 종류 */
  blockedKind?: string;
  /** 막힌 이유 */
  blockedReason?: string;
  /** YYYY-MM-DD 또는 "" (다시 확인할 날 없음) */
  followUpDue?: string;
  /** 기한을 넘겨 완료한 이유 */
  lateReason?: string;
  /** 「방법을 몰라서」 질문으로 만든 지식 자료실 카드 id */
  questionCardId?: string;
  /** 서버가 첫 메모·변경 기록 때 넣는 인스턴스 */
  recordInstanceId?: string;
};

export type StepGroup = {
  name: string;
  note?: string;
  steps: TrackStep[];
};

function uniquifyStepId(base: string, used: Set<string>): string {
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  let serial = 2;
  let candidate = `${base}-${serial}`;
  while (used.has(candidate)) {
    serial += 1;
    candidate = `${base}-${serial}`;
  }
  used.add(candidate);
  return candidate;
}

export function ensureStepIds(groups: StepGroup[]): { groups: StepGroup[]; changed: boolean } {
  let changed = false;
  const used = new Set<string>();
  const next = groups.map((group, groupIndex) => ({
    ...group,
    steps: group.steps.map((step, stepIndex) => {
      if (typeof step.id === "string" && step.id) {
        const id = uniquifyStepId(step.id, used);
        if (id === step.id) return { ...step };
        changed = true;
        return { ...step, id };
      }
      changed = true;
      const digest = createHash("sha256")
        .update(`${group.name}${step.label}`, "utf8")
        .digest("hex")
        .slice(0, 6);
      return { ...step, id: uniquifyStepId(`s-${groupIndex}-${stepIndex}-${digest}`, used) };
    }),
  }));
  return { groups: next, changed };
}
