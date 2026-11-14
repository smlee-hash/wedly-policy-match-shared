"use client";

// 요약 카드 한 장(ERP `ConsultingScorecard` 를 옮겨 왔다) — 큰 숫자 하나와 고를 수 있는 줄 몇 개.
// 내보내는 이름은 ERP 와 같다: ScorecardDot, SCORECARD_DOT_CLASS, scorecardChoiceClass, formatCount, ConsultingScorecard, ScorecardChoice.
import type { ReactNode } from 'react';
import { ArrowRight, Check } from 'lucide-react';
import { sectionCardClass } from './classes';

const FOCUS =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-wedly-accent focus-visible:ring-offset-2';

export type ScorecardDot = 'muted' | 'green' | 'accent' | 'red' | 'gold';

export const SCORECARD_DOT_CLASS: Record<ScorecardDot, string> = {
  muted: 'bg-wedly-muted',
  green: 'bg-wedly-green',
  accent: 'bg-wedly-accent',
  red: 'bg-wedly-red',
  gold: 'bg-wedly-gold-ink',
};

export function scorecardChoiceClass(selected?: boolean): string {
  return `grid w-full grid-cols-[auto_minmax(0,1fr)_auto_14px] items-center gap-2.5 rounded-[10px] border-0 px-2 py-2 text-left text-wedly-sub text-wedly-t1 [&+&]:shadow-[inset_0_1px_0_var(--color-wedly-bd)] ${FOCUS} ${
    selected ? 'ring-1 ring-inset ring-wedly-accent bg-wedly-bg-blue' : 'hover:bg-wedly-bg-gray'
  }`;
}

export function formatCount(value: unknown): string {
  return typeof value === 'number' ? value.toLocaleString('ko-KR') : String(value);
}

/** Four shared grid rows keep dividers aligned even when notes or choices wrap. Without a description the note row is left out. */
export function ConsultingScorecard({ title, icon, label, value, unit, warn, description, active, align = 'subgrid', children }: {
  title: string; icon: ReactNode; label: string; value: ReactNode;
  unit?: ReactNode; warn?: boolean; description?: ReactNode; active?: boolean;
  align?: 'subgrid' | 'own'; children: ReactNode;
}) {
  return <div data-scorecard={title}
    className={sectionCardClass('sm', `${align === 'own' ? `grid min-w-0 ${description === undefined ? 'grid-rows-[auto_auto_1fr]' : 'grid-rows-[auto_auto_auto_1fr]'}` : 'row-span-4 grid min-w-0 grid-rows-subgrid'} gap-3 break-keep p-3 md:p-4 ${active ? 'border-wedly-accent ring-1 ring-wedly-accent' : ''}`)}>
    <div className="flex min-w-0 items-center gap-2.5">
      <span aria-hidden className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-wedly-accent text-white shadow-sm">{icon}</span>
      <div className="min-w-0">
        <h2 className="min-w-0 text-wedly-section font-semibold text-wedly-t1">{title}</h2>
        <span aria-hidden className="mt-1 block h-1 w-10 rounded-full bg-wedly-accent"/>
      </div>
    </div>
    <div data-scorecard-stat className="rounded-xl border border-wedly-bd/60 bg-wedly-bg-gray px-3 py-2.5">
      <p className="text-wedly-hint font-semibold text-wedly-t2">{label}</p>
      <p className="flex items-baseline gap-1.5">
        {/* 큰 숫자 타이포(24px 이상 지표 숫자: tabular-nums·600·자간 음수) — 글자 층에 없는 26px 규격 */}
        <strong className={`text-[26px] leading-[30px] font-semibold tracking-tight tabular-nums ${warn ? 'text-wedly-red-ink' : 'text-wedly-t1'}`}>{typeof value === 'number' ? formatCount(value) : value}</strong>
        {unit && <span className="text-wedly-sub text-wedly-t2">{unit}</span>}
      </p>
    </div>
    {description !== undefined && <div className="min-h-9 text-wedly-hint text-wedly-t2">{description}</div>}
    <div data-scorecard-choices className="flex flex-col border-t border-wedly-bd pt-1">{children}</div>
  </div>;
}

export function ScorecardChoice({ label, count, selected, onClick, ariaLabel, dot = 'muted' }: {
  label: string; count?: ReactNode; selected?: boolean; onClick: () => void; ariaLabel?: string; dot?: ScorecardDot;
}) {
  const isLink = count === undefined;
  return <button type="button" onClick={onClick} aria-pressed={selected} aria-label={ariaLabel}
    className={scorecardChoiceClass(selected)}>
    <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${SCORECARD_DOT_CLASS[dot]}`}/>
    <span className={`min-w-0 break-keep ${isLink && !selected ? 'font-semibold text-wedly-accent-ink' : ''}`}>{label}</span>
    {count !== undefined ? <b className={`font-semibold tabular-nums ${selected ? 'text-wedly-accent-ink' : ''}`}>{typeof count === 'number' ? formatCount(count) : count}</b> : <span/>}
    {selected ? <Check size={12} className="text-wedly-accent-ink" aria-hidden/> : isLink ? <ArrowRight size={12} className="text-wedly-accent-ink" aria-hidden/> : <span/>}
  </button>;
}
