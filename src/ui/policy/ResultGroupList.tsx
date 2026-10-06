"use client";

// 진단 결과 「목록」 — 묶음(안 갚아도 되는 돈 등)별로 접고 펴는 목록.
// 행 하나 = 판정 알약 · 공고명 · 기관 · 최대 금액 · 조건 한 줄 · 마감 · 자세히. 행을 누르면 부모가 서랍을 연다.
// 고른 줄·서랍은 부모가 쥐고, 이 부품은 접기·더 보기만 스스로 쥔다.
import { useState, type ReactNode } from "react";
import { FUNDING_GROUP_META, type FundingGroup } from "../../funding/funding-group";
import {
  amountWords, deadlineWords, verdictWords,
  type FundingGroupBlock, type FundingItem,
} from "../../funding/funding-map";
import type { FitVerdict } from "../../engine/recommend-score";
import {
  GROUP_TONE_TILE, cardFooterOf, classifiedGroupItems, unclassifiedGroupItems, type FundingMapPayload,
} from "../FundingMap";
import { BTN_SECONDARY, DiagnosisNotice, PILL } from "./ResultList";
import { searchCutText, type SearchCut } from "./result-conditions";
import type { Diagnosis } from "./PolicyMatchScreen";

/** 묶음마다 처음 보이는 건수, 「더 보기」를 한 번 누를 때마다 늘어나는 건수. */
export const FIRST_SHOWN = 5;
export const MORE_STEP = 10;

/** 종류를 못 가른 줄을 따로 모아 두는 칸의 열쇠. */
export const UNCLASSIFIED_KEY = "unclassified";

/** 「더 보기」를 한 번 누른 뒤 보일 건수. 아직 안 눌렀으면(undefined) 처음 건수에서 시작한다. */
export function showMoreCount(current: number | undefined): number {
  return (current ?? FIRST_SHOWN) + MORE_STEP;
}

/** 묶음 접기·펴기 — 접혀 있으면 펴고, 펴져 있으면 접는다. 원래 집합은 건드리지 않는다. */
export function toggleFolded(folded: ReadonlySet<string>, key: string): Set<string> {
  const next = new Set(folded);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

/** 판정 알약 — 맞음 초록 · 확인 필요 금색 · 안 맞음 빨강(기존 등급 톤과 같은 색). */
export function verdictPillOf(v: FitVerdict): { label: string; className: string } {
  if (v === "fit") return { label: "맞음", className: `${PILL} bg-wedly-bg-green text-wedly-green-ink` };
  if (v === "excluded") return { label: "안 맞음", className: `${PILL} bg-wedly-bg-red text-wedly-red-ink` };
  return { label: "확인 필요", className: `${PILL} bg-wedly-bg-yellow text-wedly-t1` };
}

/** 마감 글자와 강조 여부 — 7일 안(오늘·내일 포함)이면 빨강. 낱말은 지도와 같은 함수를 쓴다. */
export function deadlineChipOf(it: FundingItem, now: Date = new Date()): { text: string; hot: boolean } {
  const w = deadlineWords(it.deadline, now);
  return { text: w.chip, hot: w.tone === "red" };
}

/** 묶음 바닥 줄 글자. 다 보이면 null, 더 있으면 「— 더 보기」까지, 더 보여 줄 줄이 없으면 건수만. */
export function moreLineOf(total: number, shown: number, canMore: boolean): string | null {
  if (shown >= total && !canMore) return null;
  const head = `이 묶음 ${total.toLocaleString("ko-KR")}건 중 ${shown.toLocaleString("ko-KR")}건 보임`;
  return canMore ? `${head} — 더 보기` : head;
}

/** 목록에 그릴 한 칸(묶음) — 갈래 카드 하나 또는 「종류 미확인」. */
export interface GroupSection {
  key: string;
  name: string;
  sub: string;
  dotClass: string;
  total: number;
  items: FundingItem[];
  /** 안 맞아서 뺀 줄 수와, 펼쳤을 때만 있는 그 줄들. */
  excluded: number;
  excludedItems: FundingItem[] | undefined;
  group: FundingGroup | null;
}

/** 지도 자료 → 그릴 칸들. 줄이 하나도 없는 칸은 뺀다. 건수는 서버가 센 값 그대로. */
export function sectionsOf(data: FundingMapPayload | null): GroupSection[] {
  if (!data) return [];
  const out: GroupSection[] = [];
  for (const b of data.groups as FundingGroupBlock[]) {
    const items = classifiedGroupItems(b.items);
    if (items.length === 0 && b.excluded === 0) continue;
    const meta = FUNDING_GROUP_META[b.group];
    out.push({
      key: b.group, name: meta.name, sub: meta.sub, dotClass: GROUP_TONE_TILE[meta.tone].dot,
      total: b.total, items, excluded: b.excluded, excludedItems: b.excludedItems, group: b.group,
    });
  }
  const loose = unclassifiedGroupItems(data.groups);
  if (loose.length > 0) {
    out.push({
      key: UNCLASSIFIED_KEY, name: "종류 미확인", sub: "돈의 종류를 아직 못 가른 공고", dotClass: "bg-wedly-muted",
      // 서버가 조건을 걸어 센 자료(`search` 있음)면 자르기 전에 센 미확인 수를 쓴다 — 실려 온 줄(갈래마다
      // 80건)로 세면 잘린 결과가 전부처럼 보인다. 옛 통로·화면이 다시 거른 자료는 실려 온 줄로 센다.
      total: data.search ? Math.max(loose.length, data.unclassified) : loose.length, items: loose, excluded: 0, excludedItems: undefined, group: null,
    });
  }
  return out;
}

const ROW_BASE =
  "grid w-full grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-1 border-t border-wedly-bd/60 px-4 py-3 text-left " +
  "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-wedly-accent focus-visible:ring-inset " +
  "min-[821px]:grid-cols-[auto_minmax(0,1fr)_150px_110px_72px]";

/**
 * 목록 한 줄. 누르면 부모가 서랍을 연다.
 * `footer`(판정 피드백 조각)가 있으면 줄 **밖 아래**에 붙인다 — 단추 안에 또 단추를 넣을 수 없어서다.
 * 없으면(조각을 안 받은 앱) 줄 하나만 그대로 그린다.
 */
export function ResultRow({ item, selected, onOpen, footer }: {
  item: FundingItem;
  selected: boolean;
  onOpen: (item: FundingItem) => void;
  footer?: ReactNode;
}) {
  const row = <ResultRowButton item={item} selected={selected} onOpen={onOpen} />;
  if (footer === null || footer === undefined) return row;
  return (
    <div data-row-wrap={item.id}>
      {row}
      <div className="bg-white px-4 pb-3">{footer}</div>
    </div>
  );
}

function ResultRowButton({ item, selected, onOpen }: {
  item: FundingItem;
  selected: boolean;
  onOpen: (item: FundingItem) => void;
}) {
  const pill = verdictPillOf(item.fitVerdict);
  const dead = deadlineChipOf(item);
  return (
    <button
      type="button"
      data-row={item.id}
      aria-current={selected ? "true" : undefined}
      onClick={() => onOpen(item)}
      className={`${ROW_BASE} ${selected ? "bg-wedly-bg-blue" : "bg-white hover:bg-wedly-bg-gray"}`}
    >
      <span className={pill.className}>{pill.label}</span>
      {/* 좁은 화면에서는 공고명이 맨 윗줄을 다 차지한다(알약·금액·마감이 그 아래 한 줄). */}
      <span className="col-span-full order-first min-w-0 min-[821px]:order-none min-[821px]:col-span-1">
        <span className="block truncate text-sm font-semibold leading-[22px] text-wedly-t1">{item.title}</span>
        <span className="block truncate text-xs leading-[18px] text-wedly-t2">{item.agency}</span>
      </span>
      <span className="min-w-0 text-sm font-semibold leading-[22px] text-wedly-t1">
        <span className="block truncate">{amountWords(item)}</span>
        <span className="hidden truncate text-xs font-normal leading-[18px] text-wedly-t2 min-[821px]:block">
          {verdictWords(item.fit)}
        </span>
      </span>
      <span
        className={`justify-self-end rounded-md px-2 py-1 text-center text-xs tabular-nums ${
          dead.hot ? "bg-wedly-bg-red font-semibold text-wedly-red-ink" : "bg-wedly-bg-gray text-wedly-t2"
        }`}
      >
        {dead.text}
      </span>
      <span className="hidden text-xs leading-[18px] text-wedly-accent-ink min-[821px]:inline">자세히 →</span>
    </button>
  );
}

interface Props {
  data: FundingMapPayload | null;
  loading: boolean;
  error: string;
  onRetry: () => void;
  /** 위 안내 띠(AI 가 읽은 수·소재지로 뺀 수)의 출처. */
  diagnosis: Diagnosis | null;
  serverStructurizes?: boolean;
  /** 서랍에 열려 있는 줄의 id(`FundingItem.id`) — 강조용. 없으면 빈 글자. */
  selectedKey: string;
  onOpen: (item: FundingItem) => void;
  /** 행 바닥에 끼울 판정 피드백 조각(랩만). 없으면 행은 마디를 더하지 않는다. 공고 줄에만 그린다 */
  renderRowFooter?: (item: FundingItem) => ReactNode;
  /** 「안 맞아서 뺀 N건 보기」를 펼친 갈래들과 그 손잡이(거르개와 한 짝이라 부모가 쥔다). */
  showExcluded: ReadonlySet<FundingGroup>;
  onToggleExcluded: (g: FundingGroup) => void;
  /** 전체 공고 둘러보기로 가는 길. 안 넘기면 「전체 공고 탐색」 단추를 안 그린다(두 단계 화면은 회사 없이 둘러보기가 없다). */
  onBrowseAll?: () => void;
}

/** 검색어·탭으로 거르는데 받은 자료가 서버 전체보다 적을 때 목록 위에 붙이는 안내. 잘림이 없으면 아무것도 안 그린다. */
export function SearchCutNotice({ cut }: { cut: SearchCut | null }) {
  if (!cut) return null;
  return (
    <div
      data-area="search-cut"
      className="rounded-xl border border-wedly-bd bg-wedly-bg-gray px-4 py-2 text-xs leading-[18px] text-wedly-t2"
    >
      {searchCutText(cut)}
    </div>
  );
}

/** 지도 기본 오류 문구 — 목록 위에서는 목록 말로 바꿔 보인다. */
const MAP_FAIL_TEXT = "자금 조달 지도를 불러오지 못했습니다";
const LIST_REFRESH_FAILED = "목록을 새로 받지 못했어요";

/** 자료가 남아 있는데 새로 받기가 실패했을 때의 띠 글자 — 서버가 말한 안내가 있으면 그대로, 없거나 지도 기본 문구면 목록 말로. */
export function staleErrorText(error: string): string {
  const message = error.trim();
  return message === "" || message === MAP_FAIL_TEXT ? LIST_REFRESH_FAILED : message;
}

export default function ResultGroupList({
  data, loading, error, onRetry, diagnosis, serverStructurizes = true, selectedKey, onOpen, renderRowFooter,
  showExcluded, onToggleExcluded, onBrowseAll,
}: Props) {
  const [folded, setFolded] = useState<ReadonlySet<string>>(() => new Set<string>());
  const [shownBy, setShownBy] = useState<Readonly<Record<string, number>>>({});
  const sections = sectionsOf(data);

  const toggleFold = (key: string) => setFolded((prev) => toggleFolded(prev, key));
  const showMore = (key: string) => setShownBy((prev) => ({ ...prev, [key]: showMoreCount(prev[key]) }));

  return (
    <div data-area="result-groups" className="space-y-4" aria-busy={loading}>
      <div className="flex flex-wrap items-center gap-2">
        <DiagnosisNotice diagnosis={diagnosis} serverStructurizes={serverStructurizes} />
        {onBrowseAll && (
          <button type="button" onClick={onBrowseAll} className={`ml-auto ${BTN_SECONDARY}`}>
            전체 공고 탐색
          </button>
        )}
      </div>

      {error && !data && (
        <div className="rounded-xl border border-wedly-bd bg-wedly-bg-gray px-4 py-3 text-sm leading-[22px] text-wedly-t2">
          {error}{" "}
          <button type="button" className="underline" onClick={onRetry}>
            다시 시도
          </button>
        </div>
      )}
      {error && data && (
        // 옛 자료가 남아 있어도 새로 받기가 실패한 것은 알린다 — 안 알리면 낡은 목록을 최신으로 오해한다.
        <div
          role="alert"
          data-error-band="stale"
          className="rounded-xl border border-wedly-bd bg-wedly-bg-yellow px-4 py-3 text-sm leading-[22px] text-wedly-t1"
        >
          {staleErrorText(error)} — 아래는 이전에 받은 목록이에요{" "}
          <button type="button" className="underline" onClick={onRetry}>
            다시 시도
          </button>
        </div>
      )}
      {!data && !error && <div className="py-8 text-center text-sm leading-[22px] text-wedly-muted">불러오는 중…</div>}
      {data && sections.length === 0 && (
        <div className="py-8 text-center">
          <div className="text-sm leading-[22px] text-wedly-muted">조건에 맞는 공고가 없습니다</div>
          <div className="mt-2 text-xs leading-[18px] text-wedly-muted">위의 묶음 탭이나 검색어를 바꿔 보세요</div>
        </div>
      )}

      {sections.length > 0 && (
        <div className={`overflow-hidden rounded-xl border border-wedly-bd bg-white ${loading ? "opacity-60" : ""}`}>
          {sections.map((s, idx) => {
            const isFolded = folded.has(s.key);
            const open = s.group !== null && showExcluded.has(s.group) && !!s.excludedItems;
            const rows = [...s.items, ...(open ? (s.excludedItems ?? []) : [])];
            const shown = Math.min(shownBy[s.key] ?? FIRST_SHOWN, rows.length);
            const line = moreLineOf(s.total, shown, shown < rows.length);
            return (
              <section key={s.key} data-group={s.key}>
                <button
                  type="button"
                  aria-expanded={!isFolded}
                  onClick={() => toggleFold(s.key)}
                  className={`flex w-full items-center gap-2 bg-wedly-bg-gray px-4 py-2 text-left text-sm font-semibold text-wedly-t1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-wedly-accent focus-visible:ring-inset ${
                    idx === 0 ? "" : "border-t border-wedly-bd"
                  }`}
                >
                  <span aria-hidden="true" className={`inline-block h-2 w-2 rounded-sm ${s.dotClass}`} />
                  {s.name}
                  <span className="font-medium tabular-nums text-wedly-t2">
                    {`${s.total.toLocaleString("ko-KR")}건 · ${s.sub}`}
                  </span>
                  <span className="ml-auto hidden text-xs font-normal text-wedly-t2 min-[821px]:inline">접기·펴기</span>
                </button>
                {!isFolded && (
                  <>
                    {rows.slice(0, shown).map((it) => (
                      <ResultRow
                        key={it.id}
                        item={it}
                        selected={selectedKey === it.id}
                        onOpen={onOpen}
                        footer={cardFooterOf(it, renderRowFooter)}
                      />
                    ))}
                    {line &&
                      (shown < rows.length ? (
                        <button
                          type="button"
                          onClick={() => showMore(s.key)}
                          className="block w-full border-t border-wedly-bd/60 px-4 py-2 text-left text-xs leading-[18px] text-wedly-accent-ink hover:bg-wedly-bg-gray focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-wedly-accent focus-visible:ring-inset"
                        >
                          {line}
                        </button>
                      ) : (
                        <div className="border-t border-wedly-bd/60 px-4 py-2 text-xs leading-[18px] text-wedly-t2">{line}</div>
                      ))}
                    {s.group !== null && s.excluded > 0 && (
                      <button
                        type="button"
                        aria-expanded={open}
                        onClick={() => onToggleExcluded(s.group as FundingGroup)}
                        className="block w-full border-t border-wedly-bd/60 px-4 py-2 text-left text-xs leading-[18px] text-wedly-t2 hover:bg-wedly-bg-gray focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-wedly-accent focus-visible:ring-inset"
                      >
                        {open ? `안 맞아서 뺀 ${s.excluded}건 접기` : `안 맞아서 뺀 ${s.excluded}건 보기`}
                      </button>
                    )}
                  </>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
