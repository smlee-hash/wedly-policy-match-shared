"use client";

// 정책별 고객사 화면의 맞을 확률 부품 — 단계 딱지·단계 칸·단계 거르기·순서 단추·오늘 줄·확인 항목 요약과 목록·「해당 없음」·접는 묶음.
// 글자·거르기·묶기 계산은 ./tier-view 가 한다(여기서는 그리기만). 딱지는 사장님 표준 「흰 칩 + 색 점」(../Badge)을 그대로 쓴다.
import { useId, useState, type ReactNode } from "react";
import { TIER_LABEL, type CheckField, type CheckItem, type DeadlineTier } from "../../serve/policy-deadline/tier";
import { DISMISS_REASONS, type DismissInfo, type DismissReason, type SortOrder, type SummaryView } from "../../serve/policy-deadline/types";
import { Badge } from "../Badge";
import { buttonClass } from "./classes";
import { Seg } from "./DeadlineBits";
import { TIER_MARK, TIER_ORDER, checkGroupsOf, dismissedNoteText, firstCheckText, tierText, todayLine, toggleTier, type TierChipCounts } from "./tier-view";

// 단계 딱지 점 — 높음 초록·보통 노랑(Badge 가 gold-ink 로 그린다)·낮음은 점 없음.
const TIER_VARIANT: Record<DeadlineTier, "green" | "yellow" | "default"> = { high: "green", mid: "yellow", low: "default" };

/** 맞을 확률 딱지 — 눈에는 단계 글자만, 읽어 주는 글에는 「맞을 확률」을 붙인다. 판단 전은 단계와 상관없이 점 없음. */
export function TierBadge({ tier, unstructured }: { tier: DeadlineTier; unstructured: boolean }) {
  return (
    <Badge variant={unstructured ? "default" : TIER_VARIANT[tier]}>
      <span className="sr-only">맞을 확률 </span>
      {tierText(tier, unstructured)}
    </Badge>
  );
}

/** 단계 칸 — 딱지 아래 근거 한 줄. */
export function TierCell({ tier, unstructured, tierReason }: { tier: DeadlineTier; unstructured: boolean; tierReason: string }) {
  return (
    <span className="flex flex-col items-start gap-1">
      <TierBadge tier={tier} unstructured={unstructured} />
      <span className="break-keep text-wedly-hint text-wedly-t2">{tierReason}</span>
    </span>
  );
}

const LAST_TIER_HINT = "단계는 하나 이상 골라야 합니다";

const sameTiers = (a: readonly DeadlineTier[], b: readonly DeadlineTier[]) => a.length === b.length && a.every((tier, i) => tier === b[i]);

/**
 * 단계 거르기 단추 — 높음·보통·낮음을 켜고 끈다(KindButtons 와 같은 알약). 단추 글자는 「● 높음 2곳」.
 * 마지막 하나는 끌 수 없다 — 눌러도 넘기지 않고, 그 하나에만 까닭을 title 로 보인다.
 */
export function TierFilter({
  value,
  counts,
  unit,
  onChange,
}: {
  value: readonly DeadlineTier[];
  counts: TierChipCounts;
  unit: "곳" | "건";
  onChange: (next: DeadlineTier[]) => void;
}) {
  return (
    <span className="inline-flex flex-wrap gap-1.5" role="group" aria-label="맞을 확률">
      {TIER_ORDER.map((tier) => {
        const on = value.includes(tier);
        return (
          <button
            key={tier}
            type="button"
            aria-pressed={on}
            title={on && value.length === 1 ? LAST_TIER_HINT : undefined}
            onClick={() => {
              const next = toggleTier(value, tier);
              if (!sameTiers(next, value)) onChange(next);
            }}
            className={`rounded-full border px-3 py-1 text-wedly-sub focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-wedly-accent ${on ? "border-wedly-accent bg-wedly-bg-blue text-wedly-accent-ink font-semibold" : "border-wedly-bd bg-white text-wedly-t2 hover:bg-wedly-bg-gray"}`}
          >
            <span aria-hidden="true">{TIER_MARK[tier]}</span>
            {` ${TIER_LABEL[tier]} ${counts[tier]}${unit}`}
          </button>
        );
      })}
    </span>
  );
}

const SORT_OPTIONS: { value: SortOrder; label: string }[] = [
  { value: "tier", label: "맞을 확률 순" },
  { value: "deadline", label: "마감 순" },
];

/** 순서 단추 — 맞을 확률 순 · 마감 순. */
export function SortSeg({ value, onChange }: { value: SortOrder; onChange: (value: SortOrder) => void }) {
  return <Seg label="순서" value={value} onChange={onChange} options={SORT_OPTIONS} />;
}

/** 오늘 할 일 한 줄. */
export function TodayLine({ today }: { today: SummaryView["today"] }) {
  return <p className="text-wedly-sub text-wedly-t1">{todayLine(today)}</p>;
}

/** 펼침 화살표 — 글자 없는 도형이라 단추 글자를 바꾸지 않는다. 열리면 위를 본다. */
function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`h-3 w-3 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
    >
      <path d="M2.5 4.5 6 8l3.5-3.5" />
    </svg>
  );
}

/**
 * 확인할 것 한 줄 요약 — 「확인할 것 5개 · 휴업·폐업」(수는 참고를 뺀 개수, 첫 항목은 가장 중요한 것).
 * 확인할 것이 없거나 펼치기(onToggle)를 받지 않으면 단추 없이 글만 둔다.
 */
export function CheckSummary({
  checkItems,
  checkCount,
  open,
  onToggle,
}: {
  checkItems: CheckItem[];
  checkCount: number;
  open?: boolean;
  onToggle?: () => void;
}) {
  const text = firstCheckText({ checkItems, checkCount });
  if (checkCount === 0 || !onToggle) return <span className="text-wedly-hint text-wedly-t2">{text}</span>;
  const isOpen = open === true;
  return (
    <button
      type="button"
      aria-expanded={isOpen}
      onClick={onToggle}
      className="inline-flex items-center gap-1 text-left text-wedly-hint text-wedly-accent-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-wedly-accent"
    >
      {text}
      <Chevron open={isOpen} />
    </button>
  );
}

const has = (text: string | undefined): text is string => text !== undefined && text !== "";

/** 확인 항목 한 줄 — 이름 · 걸림돌 · 지금 값 · 확인할 곳 · 힌트 · 근거(공고 원문 글 그대로). 없는 칸은 그리지 않는다. */
function CheckRow({ item, onField }: { item: CheckItem; onField?: (field: CheckField) => void }) {
  const { field } = item;
  return (
    <li className="flex flex-wrap items-center gap-x-2 gap-y-0.5 break-words text-wedly-sub">
      {item.group === "company" && field !== undefined && onField ? (
        <button
          type="button"
          onClick={() => onField(field)}
          className="font-medium text-wedly-accent-ink underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-wedly-accent"
        >
          {item.what}
        </button>
      ) : (
        <span className="font-medium text-wedly-t1">{item.what}</span>
      )}
      {item.obstacle && <Badge variant="red">걸림돌</Badge>}
      {has(item.current) && <span className="text-wedly-t1">{`지금 값: ${item.current}`}</span>}
      {has(item.where) && <span className="text-wedly-hint text-wedly-muted">{item.where}</span>}
      {has(item.hint) && <span className="text-wedly-hint text-wedly-t2">{item.hint}</span>}
      {has(item.evidence) && <span className="text-wedly-hint text-wedly-t2">{item.evidence}</span>}
    </li>
  );
}

function CheckRows({ items, onField }: { items: readonly CheckItem[]; onField?: (field: CheckField) => void }) {
  return (
    <ul className="flex flex-col gap-1.5">
      {items.map((item) => (
        <CheckRow key={item.label} item={item} onField={onField} />
      ))}
    </ul>
  );
}

function CheckSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-wedly-hint font-bold text-wedly-t2">{title}</p>
      {children}
    </div>
  );
}

const REF_HEAD =
  "inline-flex items-center gap-1 self-start text-left text-wedly-hint font-bold text-wedly-t2 hover:text-wedly-accent-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-wedly-accent";

/**
 * 확인 항목 목록 — 업체 정보에서 채울 것 → 공고 원문에서 확인할 것, 묶음 안은 중요한 순. 참고는 접어 둔다.
 * 업체 항목에 칸(field)이 있고 onField 를 받으면 이름이 단추다 — 누르면 상세창에서 그 칸을 연다. 항목이 없으면 아무것도 그리지 않는다.
 */
export function CheckList({ items, onField }: { items: readonly CheckItem[]; onField?: (field: CheckField) => void }) {
  if (items.length === 0) return null;
  const groups = checkGroupsOf(items);
  return (
    <div className="flex flex-col gap-2.5">
      {groups.company.length > 0 && (
        <CheckSection title="업체 정보에서 채울 것">
          <CheckRows items={groups.company} onField={onField} />
        </CheckSection>
      )}
      {groups.notice.length > 0 && (
        <CheckSection title="공고 원문에서 확인할 것">
          <CheckRows items={groups.notice} />
        </CheckSection>
      )}
      {groups.ref.length > 0 && (
        <Fold title={`참고 ${groups.ref.length}개`} headClass={REF_HEAD}>
          <div className="mt-1.5">
            <CheckRows items={groups.ref} />
          </div>
        </Fold>
      )}
    </div>
  );
}

/**
 * 「해당 없음」 — 단추를 누르면 사유 다섯 + 취소가 열리고, 사유를 고르면 그 사유를 넘기고 닫는다.
 * 이미 해당 없음이면 기록 한 줄 + 「되돌리기」(사유 null). onDismiss 가 없으면(통로 없는 앱) 단추는 그리지 않고 기록만 보인다.
 */
export function DismissControl({
  dismissed,
  busy,
  onDismiss,
}: {
  dismissed: DismissInfo | null;
  busy: boolean;
  onDismiss?: (reason: DismissReason | null) => void | Promise<unknown>;
}) {
  const [picking, setPicking] = useState(false);
  if (dismissed) {
    return (
      <span className="inline-flex flex-wrap items-center gap-2">
        <span className="text-wedly-hint text-wedly-t2">{dismissedNoteText(dismissed)}</span>
        {onDismiss && (
          <button type="button" className={buttonClass("secondary", "xs")} disabled={busy} onClick={() => void onDismiss(null)}>
            되돌리기
          </button>
        )}
      </span>
    );
  }
  if (!onDismiss) return null;
  const choose = (reason: DismissReason) => {
    setPicking(false);
    void onDismiss(reason);
  };
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <button type="button" className={buttonClass("secondary", "xs")} aria-expanded={picking} disabled={busy} onClick={() => setPicking((v) => !v)}>
        해당 없음
      </button>
      {picking && (
        <span className="inline-flex flex-wrap items-center gap-1" role="group" aria-label="해당 없음 사유 고르기">
          {DISMISS_REASONS.map((reason) => (
            <button key={reason} type="button" className={buttonClass("secondary", "xs")} onClick={() => choose(reason)}>
              {reason}
            </button>
          ))}
          <button type="button" className={buttonClass("secondary", "xs")} onClick={() => setPicking(false)}>
            취소
          </button>
        </span>
      )}
    </span>
  );
}

/** 접는 머리 단추 + 펼친 곳 — 펼칠 곳의 id 는 항상 있어서 aria-controls 가 늘 맞는 곳을 가리킨다(안쪽 글은 펼쳤을 때만). */
function Fold({ title, defaultOpen = false, headClass, children }: { title: string; defaultOpen?: boolean; headClass: string; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();
  return (
    <div>
      <button type="button" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen((v) => !v)} className={headClass}>
        <span className="min-w-0 break-keep">{title}</span>
        <Chevron open={open} />
      </button>
      <div id={bodyId}>{open && children}</div>
    </div>
  );
}

const FOLD_HEAD =
  "flex w-full items-center justify-between gap-2 rounded-md border border-wedly-bd bg-wedly-bg-gray px-3 py-2 text-left text-wedly-sub font-bold text-wedly-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-wedly-accent";

/** 접는 묶음 — 머리 단추(글자 = title)를 누르면 안쪽을 펼치고 다시 누르면 접는다. 처음 열림은 defaultOpen(기본 접힘). */
export function FoldGroup({ title, defaultOpen = false, children }: { title: string; defaultOpen?: boolean; children: ReactNode }) {
  return (
    <Fold title={title} defaultOpen={defaultOpen} headClass={FOLD_HEAD}>
      {children}
    </Fold>
  );
}
