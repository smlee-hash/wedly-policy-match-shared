"use client";

// 화면 위쪽 카드 두 장 — 정책별 고객사(마감 거르기)·연락 예정 업체(종류 거르기).
// 거르기 값은 화면이 쥐고, 카드는 지금 값을 표시하고 누른 값을 알리기만 한다. 선택 줄을 누르면 그 탭으로 옮기는 일도 화면이 한다.
import { Building2, CalendarClock } from "lucide-react";
import type { DaysFilter, SummaryView } from "../../serve/policy-deadline/types";
import { FREE_GRANT, OTHER_KINDS, POLICY_FUND } from "./deadline-view";
import { ConsultingScorecard, ScorecardChoice, formatCount, type ScorecardDot } from "./Scorecard";

/** 아직 못 읽은 숫자 자리 — 단추는 그대로 누를 수 있다. */
const PENDING = "…";

/** 화면의 두 탭 — 카드 두 장이 각각 한 탭의 숫자이자 바로가기다. */
export type SummaryTab = "companies" | "contacts";

export const DAYS_CHOICES: { label: string; value: DaysFilter; dot: ScorecardDot; bucket: "d7" | "d14" | "d30" | "all" }[] = [
  { label: "7일 안 마감", value: 7, dot: "red", bucket: "d7" },
  { label: "14일 안 마감", value: 14, dot: "gold", bucket: "d14" },
  { label: "30일 안 마감", value: 30, dot: "accent", bucket: "d30" },
  { label: "전체", value: "all", dot: "muted", bucket: "all" },
];

export const KIND_CHOICES: { label: string; value: string; dot: ScorecardDot; field: "policyFund" | "freeGrant" | "other" }[] = [
  { label: POLICY_FUND, value: POLICY_FUND, dot: "accent", field: "policyFund" },
  { label: FREE_GRANT, value: FREE_GRANT, dot: "green", field: "freeGrant" },
  { label: "그 밖의 분야", value: OTHER_KINDS, dot: "muted", field: "other" },
];

export default function SummaryCards({
  summary,
  tab,
  days,
  kind,
  onDays,
  onKind,
}: {
  /** null = 아직 못 읽음 */
  summary: SummaryView | null;
  /** 지금 화면 탭 */
  tab: SummaryTab;
  /** 정책별 고객사 탭의 지금 마감 거르기 */
  days: DaysFilter;
  /** 연락 예정 탭의 지금 종류 거르기 — "" 전체 */
  kind: string;
  onDays: (days: DaysFilter) => void;
  onKind: (kind: string) => void;
}) {
  return (
    <section aria-label="요약 카드" className="mb-5 grid grid-cols-1 gap-3 md:grid-cols-2">
      <ConsultingScorecard
        title="정책별 고객사"
        icon={<Building2 size={16} />}
        label="7일 안 마감 공고가 있는 고객사"
        value={summary ? summary.within7Companies : PENDING}
        unit="곳"
        warn={(summary?.within7Companies ?? 0) > 0}
        active={tab === "companies"}
        align="own"
      >
        {DAYS_CHOICES.map(({ label, value, dot, bucket }) => {
          const count = summary?.buckets[bucket];
          return (
            <ScorecardChoice
              key={String(value)}
              label={label}
              count={count === undefined ? PENDING : `${formatCount(count)}건`}
              ariaLabel={count === undefined ? undefined : `${label} 공고 ${formatCount(count)}건`}
              dot={dot}
              selected={tab === "companies" && days === value}
              onClick={() => onDays(value)}
            />
          );
        })}
      </ConsultingScorecard>
      <ConsultingScorecard
        title="연락 예정 업체"
        icon={<CalendarClock size={16} />}
        label="14일 안 마감 공고가 있는 고객사"
        value={summary ? summary.contacts : PENDING}
        unit="곳"
        active={tab === "contacts"}
        align="own"
      >
        {KIND_CHOICES.map(({ label, value, dot, field }) => {
          const count = summary?.contactKinds[field];
          const selected = tab === "contacts" && kind === value;
          return (
            <ScorecardChoice
              key={value}
              label={label}
              count={count === undefined ? PENDING : `${formatCount(count)}곳`}
              ariaLabel={count === undefined ? undefined : `${label} ${formatCount(count)}곳`}
              dot={dot}
              selected={selected}
              onClick={() => onKind(selected ? "" : value)}
            />
          );
        })}
      </ConsultingScorecard>
    </section>
  );
}
