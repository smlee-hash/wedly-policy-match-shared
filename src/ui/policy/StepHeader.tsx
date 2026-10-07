"use client";

// 두 단계 화면의 머리 — 단계 표시(1 회사 정보 · 2 매칭 결과)와 결과 단계의 회사 요약 줄.
// 상태는 전부 부모(PolicyMatchScreen)가 쥔다 — 이 부품은 그리기만 해서 그려서 잴 수 있다.
import type { BusinessProfile } from "../../engine/match-engine";
import { companySummaryOf, type Step } from "./step-state";

const BTN_SECONDARY =
  "inline-flex h-10 items-center justify-center rounded-[10px] border border-wedly-bd bg-white px-4 " +
  "text-sm text-wedly-t2 transition-colors hover:bg-wedly-bg-gray focus-visible:outline-none " +
  "focus-visible:ring-2 focus-visible:ring-wedly-accent focus-visible:ring-offset-2 disabled:opacity-50";
const CHIP = "rounded-lg bg-wedly-bg-gray px-2 py-1 text-xs leading-[18px] text-wedly-t2";

/** 단계 동그라미 — 지금 단계는 파랑, 끝난 단계는 초록 체크, 아직은 흰 바탕. */
function StepDot({ n, state }: { n: number; state: "on" | "done" | "todo" }) {
  const tone =
    state === "on"
      ? "border-wedly-accent bg-wedly-accent text-white"
      : state === "done"
        ? "border-wedly-green-ink bg-wedly-green-ink text-white"
        : "border-wedly-bd bg-white text-wedly-muted";
  return (
    <span className={`inline-flex h-6 w-6 items-center justify-center rounded-full border text-xs ${tone}`}>
      {state === "done" ? "✓" : n}
    </span>
  );
}

/** 「1 회사 정보 — 2 매칭 결과」. 결과 단계에서는 1 이 ✓ 로 바뀐다.
 *  아직 단계 이름은 t2 — 이 줄은 연파랑 화면 바닥 위라 muted 는 대비 4.22(기준 4.5 미달, 10/7 axe). */
export function StepBar({ step }: { step: Step }) {
  const first = step === "company" ? "on" : "done";
  const second = step === "result" ? "on" : "todo";
  const label = (state: "on" | "done" | "todo") =>
    `text-sm font-semibold leading-[22px] ${state === "todo" ? "text-wedly-t2" : "text-wedly-t1"}`;
  return (
    <ol data-area="step-bar" aria-label="진행 단계" className="flex items-center gap-2">
      <li className="flex items-center gap-2" aria-current={step === "company" ? "step" : undefined}>
        <StepDot n={1} state={first} />
        <span className={label(first)}>회사 정보</span>
      </li>
      <li aria-hidden className="h-0.5 w-10 bg-wedly-bd" />
      <li className="flex items-center gap-2" aria-current={step === "result" ? "step" : undefined}>
        <StepDot n={2} state={second} />
        <span className={label(second)}>매칭 결과</span>
      </li>
    </ol>
  );
}

/**
 * 결과 머리의 회사 요약 줄 — 상호·법인/개인·소재지·설립 연월·매출·직원 수(있는 값만) · 모름 N칸 ·
 * 「← 회사 정보 고치기」 · 「다른 회사」.
 */
export function CompanySummaryBar({
  profile, unknownCount, onEdit, onOther,
}: {
  profile: BusinessProfile;
  /** 폼이 센 모름 칸 수. 모르면 null(칸 수를 안 그린다). */
  unknownCount: number | null;
  onEdit: () => void;
  onOther: () => void;
}) {
  const { name, chips } = companySummaryOf(profile);
  return (
    <div
      data-area="company-summary"
      className="flex flex-wrap items-center gap-2 rounded-2xl border border-wedly-bd bg-white px-4 py-2 shadow-sm"
    >
      {name && <span className="text-sm font-semibold leading-[22px] text-wedly-t1">{name}</span>}
      {chips.map((c) => (
        <span key={c} className={CHIP}>{c}</span>
      ))}
      {unknownCount !== null && (
        <span data-area="unknown-count" className="rounded-lg bg-wedly-bg-yellow px-2 py-1 text-xs leading-[18px] text-wedly-t1">
          {`모름 ${unknownCount}칸`}
        </span>
      )}
      <div className="ml-auto flex flex-wrap gap-2">
        <button type="button" onClick={onEdit} className={BTN_SECONDARY}>
          ← 회사 정보 고치기
        </button>
        <button type="button" onClick={onOther} className={BTN_SECONDARY}>
          다른 회사
        </button>
      </div>
    </div>
  );
}
