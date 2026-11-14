"use client";

// 정책별 고객사 화면의 작은 부품 — 마감 딱지·종류 표시·종류 단추·구간 단추·조건 칸·「업무 현황에 추가」 칸·알림.
import { Toast } from "@wedly/ui-shared/ui";
import { buttonClass } from "./classes";
import {
  FREE_GRANT,
  POLICY_FUND,
  dDayLabel,
  dDayTone,
  kindLabel,
  kindTone,
  needsSourceCheck,
  specificToCheck,
  type DDayTone,
  type KindTone,
} from "./deadline-view";

const DDAY_CLASS: Record<DDayTone, string> = {
  today: "bg-wedly-bg-red text-wedly-red-ink",
  soon: "bg-wedly-bg-yellow text-wedly-t1",
  later: "bg-wedly-bg-gray text-wedly-navy",
  always: "bg-wedly-bg-purple text-wedly-purple-ink",
};

export function DDayBadge({ dDay }: { dDay: number | null }) {
  return (
    <span className={`inline-block w-14 shrink-0 rounded-md py-0.5 text-center text-wedly-sub font-bold tabular-nums ${DDAY_CLASS[dDayTone(dDay)]}`}>
      {dDayLabel(dDay)}
    </span>
  );
}

const KIND_CLASS: Record<KindTone, string> = {
  fund: "bg-wedly-bg-blue text-wedly-accent-ink",
  grant: "bg-wedly-bg-teal text-wedly-teal-ink",
  other: "bg-wedly-bg-gray text-wedly-navy",
};

export function KindChip({ category, count }: { category: string; count?: number }) {
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded px-1.5 text-wedly-hint font-medium ${KIND_CLASS[kindTone(category)]}`}>
      {kindLabel(category)}
      {count !== undefined && <b className="font-bold tabular-nums">{count}</b>}
    </span>
  );
}

/** 종류 나누기 단추 — 전체·정책자금·무상지원금(+ 그 밖의 분야). 누른 단추는 그 종류 색으로 채운다. */
export function KindButtons({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  options?: { value: string; label: string }[];
}) {
  const items = options ?? [
    { value: "", label: "전체" },
    { value: POLICY_FUND, label: POLICY_FUND },
    { value: FREE_GRANT, label: FREE_GRANT },
  ];
  return (
    <span className="inline-flex flex-wrap gap-1.5" role="group" aria-label="종류">
      {items.map((item) => {
        const on = value === item.value;
        const tone = item.value === "" ? "border-wedly-accent bg-wedly-bg-blue text-wedly-accent-ink" : `border-transparent ${KIND_CLASS[kindTone(item.value)]}`;
        return (
          <button
            key={item.value || "all"}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(item.value)}
            className={`rounded-full border px-3 py-1 text-wedly-sub focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-wedly-accent ${on ? `${tone} font-semibold` : "border-wedly-bd bg-white text-wedly-t2 hover:bg-wedly-bg-gray"}`}
          >
            {item.label}
          </button>
        );
      })}
    </span>
  );
}

/** 구간 단추 — 하나만 고른다. 잠긴 칸은 title 로 까닭을 보인다. */
export function Seg<T extends string | number>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string; disabledReason?: string }[];
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-wedly-hint text-wedly-muted">{label}</span>
      <span className="inline-flex overflow-hidden rounded-lg border border-wedly-bd" role="group" aria-label={label}>
        {options.map((o) => (
          <button
            key={String(o.value)}
            type="button"
            aria-pressed={value === o.value}
            disabled={!!o.disabledReason}
            title={o.disabledReason}
            onClick={() => onChange(o.value)}
            className={`border-r border-wedly-bd px-2.5 py-1 text-wedly-sub last:border-r-0 disabled:cursor-default disabled:opacity-55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-wedly-accent ${value === o.value ? "bg-wedly-bg-blue font-bold text-wedly-accent-ink" : "bg-white text-wedly-t2"}`}
          >
            {o.label}
          </button>
        ))}
      </span>
    </span>
  );
}

/** 맞은 조건 칸 — 초록 조각, 없으면 비워 둔다. */
export function FitCell({ labels }: { labels: string[] }) {
  if (!labels.length) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {labels.map((label) => (
        <span key={label} className="break-keep rounded bg-wedly-bg-green px-1.5 text-wedly-hint text-wedly-green-ink">{label}</span>
      ))}
    </span>
  );
}

/**
 * 확인할 조건 칸 — 업체마다 다른 조건만 노랑 조각으로 + 「채울 칸: …」. 없으면 비워 둔다.
 * 「공고 원문 확인(조건 정리 전)」 같은 공고 전체 문구는 칸에 되풀이하지 않는다 —
 * unstructuredChip 이면 짧은 「조건 정리 전」 조각만(연락 예정 업체), 아니면 표 위 한 줄이 알린다(정책별 고객사).
 */
export function CheckCell({ toCheck, gaps, unstructuredChip = false }: { toCheck: string[]; gaps: string[]; unstructuredChip?: boolean }) {
  const items = specificToCheck(toCheck);
  const unstructured = unstructuredChip && needsSourceCheck(toCheck);
  if (!items.length && !gaps.length && !unstructured) return null;
  return (
    <>
      {(items.length > 0 || unstructured) && (
        <span className="flex flex-wrap gap-1">
          {unstructured && (
            <span title="아직 자격 조건을 정리하지 않은 공고입니다. 공고 원문에서 확인해 주세요." className="break-keep rounded bg-wedly-bg-gray px-1.5 text-wedly-hint text-wedly-t2">
              조건 정리 전
            </span>
          )}
          {items.map((label) => (
            <span key={label} className="break-keep rounded bg-wedly-bg-yellow px-1.5 text-wedly-hint text-wedly-t1">{label}</span>
          ))}
        </span>
      )}
      {gaps.length > 0 && (
        <span className={`block text-wedly-hint text-wedly-red-ink ${items.length || unstructured ? "mt-1" : ""}`}>
          채울 칸: <b className="font-bold">{gaps.join(" · ")}</b>
        </span>
      )}
    </>
  );
}

// 할 일 이름은 서버 PROGRESS_TODO(「신청 마감」)와 같은 글자다.
export const PROGRESS_HINT = "이 업체의 컨설팅 업무 현황에 공고를 넣고 할 일 「신청 마감」(기한 = 공고 마감)을 만듭니다";

/** 「업무 현황에 추가」 단추, 이미 넣었으면 「업무 현황에 있음」. */
export function ProgressCell({ inProgress, busy, onProgress }: { inProgress: boolean; busy: boolean; onProgress: () => void }) {
  if (inProgress) {
    return <span className="inline-flex items-center whitespace-nowrap rounded-md bg-wedly-bg-green px-2.5 py-1 text-wedly-hint font-bold text-wedly-green-ink">업무 현황에 있음</span>;
  }
  return (
    <button type="button" className={buttonClass("primary", "xs")} disabled={busy} title={PROGRESS_HINT} onClick={onProgress}>
      업무 현황에 추가
    </button>
  );
}

/** 펼친 업체 표 마지막 칸(「업무 현황에 추가」) 폭 — 두 탭의 표가 같은 폭을 쓴다. */
export const ACTION_COL = "w-[148px]";

export interface DeadlineNotice {
  tone: "success" | "error";
  text: string;
  /** 둘 다 있으면 「업무 현황 보기」 단추를 붙인다 — 그 업체 상세를 연다(열기는 앱이 정한다). */
  customerKey?: string;
  companyName?: string;
}

/** 알림이 떠 있는 시간 — 「업무 현황 보기」 단추가 있으면 누를 틈을 더 준다. */
export function noticeMs(notice: DeadlineNotice): number {
  return notice.customerKey ? 8000 : 4200;
}

/** 화면 아래 가운데 알림 — 「업무 현황에 추가」 결과·실패. `onOpen` 이 없으면 「업무 현황 보기」는 그리지 않는다. */
export function DeadlineToast({ notice, onOpen }: { notice: DeadlineNotice | null; onOpen?: (customerKey: string, companyName: string) => void }) {
  if (!notice) return null;
  const key = notice.customerKey;
  const name = notice.companyName;
  return (
    <div className="pointer-events-none fixed bottom-6 left-1/2 z-50 w-max max-w-[calc(100%-32px)] -translate-x-1/2">
      <Toast variant="dark" tone={notice.tone}>
        {notice.text}
        {key && name !== undefined && onOpen && (
          <button
            type="button"
            onClick={() => onOpen(key, name)}
            className="pointer-events-auto ml-3 whitespace-nowrap text-wedly-bg-blue underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            업무 현황 보기
          </button>
        )}
      </Toast>
    </div>
  );
}
