"use client";

/**
 * 자금 조달 지도 — 결과 영역 본체.
 *
 * ★재설계(계약 §G2, 2026-09-04 시안 3 — 「가독성이 너무 떨어져 내용이 전혀 눈에 안 들어온다」 사장님 지적):
 *  카드 앞면은 이제 제목 + 답 네 개(2열) + 판정 한 줄만 둔다. 조건 원문은 「조건 펼치기」를 눌러야
 *  보인다. 낱말(마감·판정·금액·갚기·어디·갈래 소개)은 전부 `funding-map.ts`(G1)의 도우미 함수를
 *  그대로 쓴다 — 이 파일이 문구를 다시 짓지 않는다(계약 낱말 규칙).
 *
 * ★거르기(칩)·줄 세우기(정렬)·**정상/안 맞음 가르기**는 전부 **서버가** 한다 — 이 파일은
 *  `applyFilters`·`sortItems` 를 부르지 않고 받은 차례 그대로 그린다. **표 보기 한 자리만 예외**로,
 *  정상과 안 맞음을 합친 행을 지금 정렬 기준으로 다시 세운다(순수 함수 `sortRows` · 코덱스 12차 #4) —
 *  두 목록을 합치는 일이 이 화면에서만 일어나 서버가 그 차례를 정해 줄 수 없기 때문이다.
 *  갈래 칸의 `items` 는 언제나 정상(맞음+확인 필요)만이고, 안 맞아서 뺀 것은 `excludedItems` 로
 *  따로 실려 온다(`includeExcluded:true` 로 물었을 때만) — **카드 보기**는 펼친 갈래의 것만,
 *  **표 보기**는 스위치 하나로 전부/전무를 그린다(`tableRowsOf` · 코덱스 14차 [높음], 2026-09-04)
 *  (코덱스 11차 #2·#4·#5, 2026-09-04. 예전엔 이 파일이 한 목록을 받아 `normalGroupItems`·
 *  `excludedGroupItems` 로 다시 갈랐는데, 그러면 정상과 안 맞음이 서버의 한 topN 을 나눠 가져
 *  정상이 잘리거나 안 맞음이 아예 안 실렸다).
 *  화면이 하는 재배치는 이제 「미분류 재분류」 하나뿐이다(`classifiedGroupItems`·
 *  `unclassifiedGroupItems` 두 순수 함수).
 * ★색은 WEDLY 토큰만(CLAUDE.md rule#1). raw Tailwind 색은 `funding-map-render.test.tsx` 가
 *  **그려 낸 HTML** 에서 잡는다.
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Gift, Landmark, LifeBuoy, Percent, ShieldCheck, TrendingUp, type LucideIcon } from "lucide-react";
import { IoAlertCircle, IoBusiness, IoCheckmarkCircle, IoGift, IoTime, IoTrendingDown } from "react-icons/io5";
import { Badge } from "./Badge";
import CustomSelect from "./CustomSelect";
import { EmptyState } from "@wedly/ui-shared/ui";
import { SegmentedControl } from "@wedly/ui-shared/ui";
import { Skeleton } from "@wedly/ui-shared/ui";
import { StatCard } from "@wedly/ui-shared/ui";
import { StatusBox } from "@wedly/ui-shared/ui";
import { Table, type TableColumn } from "@wedly/ui-shared/ui";
import { cn } from "@wedly/ui-shared/ui/cn";
import { FUNDING_GROUP_META, type FundingGroup, type FundingGroupTone } from "../funding/funding-group";
import {
  amountWords,
  conditionVerdictWord,
  deadlineWords,
  gapParts,
  groupFooterWords,
  profileBandOf,
  repayWords,
  sortItems,
  unclassifiedFooterWords,
  verdictWords,
  whereWords,
  type FundingFilters,
  type FundingFit,
  type FundingGroupBlock,
  type FundingItem,
  type FundingMapData,
  type FundingSort,
} from "../funding/funding-map";
import type { FitVerdict } from "../engine/recommend-score";
import type { ConditionVerdict } from "../engine/structure-types";

export type FundingView = "map" | "table";

/**
 * 통로가 곁들여 주는 값까지 담은 모양. `totals` 는 **선택**이다 — 없으면 갈래 칸 합계로 센다.
 * `usedProfile` 은 `usedProfileSummary`(profile-summary.ts) 결과 — 머리 카드의 「판정에 쓴 정보」 띠가 읽는다.
 * **선택 칸이다**: 응답에 아예 없으면(옛 통로) 띠를 안 그리고, 빈 배열이면 「없음」 갈래로 간다
 * (`profileBandOf` — 「없는 것」과 「빈 것」은 다르다, 코덱스 2차 #2).
 */
export type FundingMapPayload = FundingMapData & {
  totals?: { all: number; filtered: number };
  usedProfile?: string[];
};

/**
 * 갈래 톤 하나가 쓰이는 세 자리 — 아이콘 타일(채움+흰 심볼) · 머리 띠 워시(연한 바탕) ·
 * 왼쪽 4px 색 띠(border-left) · 표 「종류」 칸의 점(dot). urgent(gold) 만 심볼이 남색이다
 * (금색 타일 위 흰 글리프 대비 2.1 미달 실측 — 상태 박스 v3 와 같은 규칙).
 */
export const GROUP_TONE_TILE: Record<
  FundingGroupTone,
  { tile: string; wash: string; borderL: string; dot: string }
> = {
  green: { tile: "bg-wedly-green text-white", wash: "bg-wedly-bg-green", borderL: "border-wedly-green", dot: "bg-wedly-green" },
  blue: { tile: "bg-wedly-accent text-white", wash: "bg-wedly-bg-blue", borderL: "border-wedly-accent", dot: "bg-wedly-accent" },
  purple: { tile: "bg-wedly-purple text-white", wash: "bg-wedly-bg-purple", borderL: "border-wedly-purple", dot: "bg-wedly-purple" },
  navy: { tile: "bg-wedly-navy text-white", wash: "bg-wedly-bg-sidebar", borderL: "border-wedly-navy", dot: "bg-wedly-navy" },
  gold: { tile: "bg-wedly-gold text-wedly-navy", wash: "bg-wedly-bg-yellow", borderL: "border-wedly-gold", dot: "bg-wedly-gold-ink" },
  teal: { tile: "bg-wedly-teal text-white", wash: "bg-wedly-bg-teal", borderL: "border-wedly-teal", dot: "bg-wedly-teal" },
};

/** 갈래별 심볼 — 미리보기 ICONS(gift·pct·shield·bank·buoy·up)와 같은 모양. */
const GROUP_ICON: Record<FundingGroup, LucideIcon> = {
  grant: Gift,
  policy: Percent,
  guarantee: ShieldCheck,
  bank: Landmark,
  urgent: LifeBuoy,
  invest: TrendingUp,
};

const SORT_OPTIONS: Array<{ value: FundingSort; label: string }> = [
  { value: "rec", label: "추천순" },
  { value: "dead", label: "마감 빠른 순" },
  { value: "rate", label: "이자 낮은 순" },
  { value: "amt", label: "한도 큰 순" },
];

/** ★재설계 — 「맞는 것만」 칩을 없앴다(계약 §G2②). 남은 두 칩만 화면이 다시 거르지 않고 서버가 거른다. */
const CHIPS: Array<{ key: "openOnly" | "soonOnly"; label: string }> = [
  { key: "openOnly", label: "지금 신청 가능한 것만" },
  { key: "soonOnly", label: "7일 안에 마감되는 것만" },
];

/** 갈래 한 칸에 접힌 채로 보이는 건수 — 미리보기와 같은 3건. */
const FOLDED = 3;

/**
 * 갈래 카드 격자의 열 규칙 — **감싸는 상자의 실제 폭**(컨테이너)으로 정한다(독립 검사 지적 ⑥,
 * 2026-09-04). 실제 격자와 로딩 뼈대가 **같은 글자**를 써야 자료가 도착할 때 열이 안 움직인다.
 *
 * ★왜 뷰포트(`sm:`·`lg:`)를 버렸나: 상세창 레일은 뷰포트 1280 에서도 **480px** 다. 뷰포트 기준
 *  `sm:grid-cols-2`(640px)는 그 레일 안에서도 켜져 갈래 카드가 2열이 되고, 그 안의 답 한 칸이
 *  89px 로 잘렸다(실측 32곳). 숫자 카드 줄에서 `!compact && lg:` 로 손으로 막던 것을 이제
 *  구조로 막는다 — 「어느 앱·어느 자리인지」를 묻지 않고 **자기 폭만** 본다.
 *
 * ★열 수는 **답 4개 격자(`FACT_GRID`, 항목 안쪽 448px 에서 2열)가 2열을 지킬 수 있을 때만** 늘린다.
 *  갈래 카드 폭 = (상자 − 열 사이 16px×(열−1))/열, 항목 안쪽 = 갈래 카드 − 40(갈래 `p-2` 16 +
 *  항목 `px-3` 24). 2열: 2×(448+40)+16 = 992, 3열: 3×(448+40)+32 = 1496.
 *  옛 `@2xl`(672)·`@7xl`(1280)은 창 1280~1347·1636~1851 에서 답이 세로로 쌓였다
 *  (2026-09-05 재검사 지적 1).
 *
 * ★`@min-[N px]`(임의 값 컨테이너 문턱)가 실제로 CSS 로 나오는지 실측했다(2026-09-05) — 훑개
 *  `@tailwindcss/oxide` 가 이 파일 같은 `.tsx` 문자열에서 `@min-[992px]:grid-cols-2` 를 뽑아냈고,
 *  `tailwindcss` 4.2.1 이 그것을 `@container (width >= 992px)` 로 찍었다(`@min-[1496px]` 도 같음).
 *  문서만 보고 적은 값이 아니다.
 */
const GROUP_GRID = "grid gap-4 grid-cols-1 @min-[992px]:grid-cols-2";
/** 3열은 `compact`(좁은 상세창 레일) 아닐 때만 — 「몇 열까지」가 유일한 앱·자리 구분이다. */
const GROUP_GRID_WIDE = "@min-[1496px]:grid-cols-3";

// ★조작줄 부품 높이 = 36px(정본 계단 `h-9`, 2026-09-04 승인 시안). `py-1`(26px)로는 알약·셀렉트와
//  높이가 안 맞아 칩만 떠 보였다. 높이를 못 박았으니 글자는 `inline-flex items-center` 로 직접
//  세로 가운데에 둔다 — 브라우저 기본 정렬에 기대지 않는다.
// ★조작줄 글자는 **한 층**(`text-wedly-sub` 13px)이다(독립 검사 지적 ④, 2026-09-04). 높이는 36px 로
//  맞췄는데 글자만 알약 13 · 칩 11 · 셀렉트 14 · 라벨 11 로 **세 종류**여서, 한 줄 안에서 어느 것이
//  더 중요한지 크기가 거짓말을 했다. 알약(공용 부품)이 이미 13px 이라 그 층으로 나머지를 모은다 —
//  알약의 선택된 칸만 굵기 600 인 것은 그 부품의 **상태 표시**라 그대로 둔다(크기만 맞춘다).
//  ※ CHIP_BASE 는 조작줄 안(칩 둘 + 표 보기 여는 손잡이)에서만 쓴다 — 밖으로 새지 않는다.
const CHIP_BASE =
  "inline-flex h-9 items-center rounded-full border border-wedly-bd bg-white px-3 text-wedly-sub text-wedly-t2 " +
  "transition-colors duration-150 ease-out hover:border-wedly-accent " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-wedly-accent";
const CHIP_ON = "border-wedly-accent bg-wedly-bg-blue font-semibold text-wedly-accent-ink";

// ★이 이름은 **조작줄 밖**에서도 쓴다 — 갈래 카드 발치의 「안 맞아서 뺀 N건 보기」·빈 상태의
//  「칩 모두 풀기」·오류의 「다시 시도」. 그래서 상수 자체를 36px(`h-9`)로 키웠더니 조작줄과
//  상관없는 그 단추들까지 10px 커져, **뺀 것이 있는 갈래 카드만** 발치가 높아져 옆 카드와
//  아래 정렬이 어긋났다(코덱스 13차 #2, 2026-09-04). 상수는 26px(`py-1`) 그대로 두고,
//  36px 이 필요한 조작줄 「전체 공고 탐색」 **그 자리에서만** `h-9` 를 덧붙인다.
const BTN_SM =
  "inline-flex items-center justify-center rounded-lg border border-wedly-bd bg-white px-3 py-1 " +
  "text-wedly-hint font-semibold text-wedly-accent-ink transition-colors duration-150 ease-out " +
  "hover:bg-wedly-bg-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-wedly-accent";

const LINK_BTN =
  "font-medium text-wedly-accent-ink underline-offset-2 hover:underline " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-wedly-accent rounded";

const DEAD_BASE = "shrink-0 whitespace-nowrap rounded-md border px-1.5 text-wedly-hint tabular-nums";
/** `deadlineWords` 의 tone("red"|"green"|"plain")과 짝지은 색. */
const DEAD_TONE: Record<"red" | "green" | "plain", string> = {
  red: "border-wedly-bd-red bg-wedly-bg-red font-semibold text-wedly-red-ink",
  green: "border-wedly-bd-green bg-white text-wedly-green-ink",
  plain: "border-wedly-bd bg-white text-wedly-t2",
};

/** 조건 한 줄(pass/fail/unknown) → Badge 톤. */
const COND_BADGE: Record<ConditionVerdict, "green" | "red" | "yellow"> = { pass: "green", fail: "red", unknown: "yellow" };

/** 칩 하나만 뒤집는다 — 화면 상태를 손잡이 밖에서도 잴 수 있게 순수 함수로 뺐다. */
export function nextFilters(f: FundingFilters, key: keyof FundingFilters): FundingFilters {
  return { ...f, [key]: !f[key] };
}

/**
 * 항목을 눌렀을 때 서랍 대신 상세 화면으로 보낼지. 좁은 자리(통합 상세창 추천 탭)에서는
 * 상세창 위에 서랍을 또 겹쳐 띄우지 않는다 — 공고는 그 화면이 이미 가진 상세로 바로 보낸다.
 * 상품은 상세 화면이 없으므로 어디서든 서랍이 맡는다.
 */
export function shouldOpenDetail(item: FundingItem, compact: boolean): boolean {
  return compact && item.kind === "announcement";
}

/** 항목은 `<div role="button">` 이라 Enter·Space 를 손으로 이어 준다(브라우저가 안 해 준다). */
export function itemKeyDown(
  e: KeyboardEvent<HTMLElement>,
  item: FundingItem,
  onOpen: (item: FundingItem) => void,
): void {
  if (e.key !== "Enter" && e.key !== " " && e.key !== "Spacebar") return;
  e.preventDefault();
  onOpen(item);
}

/**
 * 「클라이언트 재분류」 남은 한 규칙(계약 §G2 — 미분류는 갈래 칸에서 빼서 맨 아래 「종류 미확인」
 * 블록으로 모은다) — 순수 함수라 그리지 않고도 잰다.
 *
 * ★안 맞음 가르개(옛 `normalGroupItems`·`excludedGroupItems`)는 없앴다(코덱스 11차 #2, 2026-09-04)
 *  — 서버가 `items`(정상)와 `excludedItems`(안 맞음)를 이미 나눠 보내므로 화면이 다시 가르면
 *  서버가 안 실어 준 것을 못 그리면서 개수만 어긋난다.
 */
export function classifiedGroupItems(items: FundingItem[]): FundingItem[] {
  return items.filter((it) => !it.unclassified);
}

export function unclassifiedGroupItems(groups: FundingGroupBlock[]): FundingItem[] {
  return groups.flatMap((g) => g.items.filter((it) => it.unclassified));
}

/**
 * 표 행 다시 세우기 — **합친 뒤** 지금 고른 차례로 한 번 더 세운다(코덱스 12차 #4, 2026-09-04).
 *
 * 표 행은 「모든 갈래의 정상 + 펼친 갈래의 안 맞음」인데, 서버는 두 목록을 **각자** 세워 보낸다
 * (`groupBlocks` 가 `items`·`excludedItems` 에 같은 정렬을 따로 적용한다). 그래서 그대로 이어
 * 붙이면 표 전체에서는 고른 기준이 깨졌다 — 「한도 큰 순」인데 안 맞음 50억이 정상 1억보다 뒤에
 * 앉았다. 정렬은 서버 몫이라는 원칙(파일 머리 주석)에서 **표 보기만** 예외로 두는 이유는, 두
 * 목록을 합치는 일 자체가 이 화면에서만 일어나기 때문이다(카드 보기는 두 목록을 따로 그린다).
 *
 * ★규칙을 여기서 다시 쓰지 않고 **서버 정렬기 `sortItems` 를 그대로 부른다**(2026-09-04). 손으로
 * 베껴 둔 예전 판은 서버와 두 자리에서 갈렸다: ⓐ 마감이 지난 줄(dDay 음수)을 「가장 가까운 마감」
 * 으로 읽어 「마감 빠른 순」 맨 **위**에 세웠다(서버는 `deadRank` 로 맨 뒤로 보낸다) ⓑ 「추천순」이
 * 점수만 봐서, 안 맞음이 점수만 높으면 맞음보다 앞섰다(서버는 맞음→확인 필요→안 맞음을 점수보다
 * 먼저 본다). 표와 카드가 같은 자료를 다른 차례로 보이던 원인이라 한 곳에서만 정한다.
 * `sortItems` 도 원본 배열을 복사해 세우고, 값이 같으면 받은 차례를 그대로 지킨다(안정 정렬).
 */
export function sortRows(rows: FundingItem[], sort: FundingSort): FundingItem[] {
  return sortItems(rows, sort);
}

/**
 * 표 보기의 행 목록 — **스위치 하나(`includeExcluded`)만** 본다(코덱스 14차 [높음], 2026-09-04).
 *
 * ★고친 것: 예전엔 표도 「갈래별 펼치기(`showExcluded`)」를 봤다. 그런데 표 위 손잡이
 *  (`data-excluded-toggle="table"`)는 `filters.includeExcluded` 만 뒤집으므로, 표에서 손잡이를 눌러
 *  **서버가 안 맞음을 실어 보내도 `showExcluded` 는 빈 채라 행이 하나도 안 늘었다**. 정상 0건·
 *  안 맞음 2건이면 손잡이는 눌린 모양인데 표는 비어 있었다. 반대로 카드 보기에서 한 갈래만 펼친
 *  뒤 표로 옮기면 손잡이는 전체 건수를 달고 눌린 것처럼 보이는데 그 갈래의 안 맞음 행만 나왔다.
 *
 * ★갈래별 펼치기는 **카드 보기의 개념**이다(갈래마다 단추가 따로 있다). 표에는 갈래 카드가 없어
 *  전부 보이거나 전부 숨는 스위치 하나가 맞다 — 그래서 이 함수는 `showExcluded` 를 아예 안 받는다.
 *
 * ★순수 함수로 뗀 이유(같은 회차 지적): 이 규칙이 화면 안 `useMemo` 에 묻혀 있어 시험이 못 쟀고,
 *  그래서 위 버그가 시험 21파일을 그대로 통과했다. `classifiedGroupItems`·`sortRows` 와 같은 결로
 *  밖에서 직접 부를 수 있게 둔다.
 *
 * @param groups 통로가 준 갈래 칸들. `items` 는 언제나 정상만, `excludedItems` 는
 *   **`includeExcluded:true` 로 물었을 때만** 실려 온다(없으면 켜도 늘어날 행이 없다).
 * @param opts.includeExcluded 지금 스위치 상태. 켜져 있으면 **모든 갈래**의 안 맞음을 붙인다.
 * @param opts.sort 합친 뒤 다시 세울 기준(`sortRows` 주석 — 서버가 두 목록을 각자 세워 보낸다).
 */
export function tableRowsOf(
  groups: FundingGroupBlock[],
  opts: { includeExcluded: boolean; sort: FundingSort },
): FundingItem[] {
  return sortRows(
    groups.flatMap((g) => [...g.items, ...(opts.includeExcluded ? (g.excludedItems ?? []) : [])]),
    opts.sort,
  );
}

/** 조건 한 줄 글자 — 「label — note」(note 없으면 label만). 기호 없이 뜻으로만. */
export function conditionRowText(f: FundingFit): string {
  return f.note ? `${f.label} — ${f.note}` : f.label;
}

const 건수 = (n: number): string => n.toLocaleString("ko-KR");

/** 기준 시각을 한국시간 「YYYY-MM-DD HH:mm」 으로. 보는 사람 시간대에 흔들리면 안 된다. */
export function kstStamp(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  return new Date(t + 9 * 3_600_000).toISOString().slice(0, 16).replace("T", " ");
}

function DeadChip({ item, now }: { item: FundingItem; now: Date }) {
  const d = deadlineWords(item.deadline, now);
  // 좁은 딱지(chip)가 긴 원문을 14자에서 끊었을 때만 전문(long)을 title 로 곁들인다.
  // ★`item.deadline.text` 를 직접 읽던 우회는 걷어냈다(코덱스 11차 #13, 2026-09-04) — `long` 이
  //  이제 자르지 않은 전문이라 이 파일이 원문 칸을 따로 뒤질 이유가 없다.
  return (
    <span className={cn(DEAD_BASE, DEAD_TONE[d.tone])} title={d.long === d.chip ? undefined : d.long}>
      {d.chip}
    </span>
  );
}

/** 「상시 상품 있음」만 남았다 — 「미분류」 표식은 종류 미확인 블록으로 옮겨서 카드에서 뺐다(낱말 규칙: 「미분류」 금지). */
function ItemFlags({ item, className }: { item: FundingItem; className?: string }) {
  if (!item.relatedProductId) return null;
  return (
    <div className={cn("flex flex-wrap items-center gap-1", className)}>
      <span
        className="inline-flex items-center whitespace-nowrap rounded border border-wedly-bd bg-white px-1.5 text-wedly-hint text-wedly-t2"
        title="같은 사업의 상시 상품 줄을 이 공고에 묶었습니다"
      >
        상시 상품 있음
      </span>
    </div>
  );
}

/**
 * 답 네 개를 담는 격자 — **카드 폭(컨테이너) 기준**으로 열 수를 정한다(독립 검사 지적 ⑥, 2026-09-04).
 *
 * ★왜 뷰포트(`sm:`)가 아니라 컨테이너인가: 이 카드는 넓은 본문에도 놓이고 480px 짜리 상세창 레일에도
 *  놓인다. 뷰포트 기준으로 켜면 **레일 안에서도 2열이 켜져** 답 한 칸이 89px 로 잘렸다(실측 32곳).
 *
 * ★문턱 `@md`(28rem = 448px)의 근거: 답 한 칸이 **200px 밑으로 내려가지 않게** 잡은 값이다
 *  ((448 − 14(`gap-x-3.5`)) ÷ 2 = 217px). 448px 미만이면 1열로 내려가 답이 **카드 폭 전부**를 쓴다 —
 *  좁을 때 2열은 어떤 경우에도 1열보다 답이 좁으므로, 밀도보다 읽히는 것을 택한다.
 *  값이 그보다 길면(가장 긴 실측값 374px) 여전히 잘리지만 `title` 로 전체를 읽을 수 있다.
 */
const FACT_GRID = "mt-2 grid grid-cols-1 gap-x-3.5 gap-y-1.5 @md:grid-cols-2";

/** 답 네 개 중 하나 — 라벨 11px muted · 값 14px 600(계약 §G2). 한 줄 자르기 + title 로 전체를 읽는다. */
function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-wedly-hint text-wedly-muted">{label}</dt>
      <dd className="mt-0.5 truncate text-sm font-semibold tabular-nums text-wedly-t1" title={value}>
        {value}
      </dd>
    </div>
  );
}

/**
 * 판정 줄 — 딱지(맞음/확인 필요/안 맞음) + `verdictWords` 한 줄 + 「조건 펼치기」 단추.
 * 단추는 카드 클릭(서랍 열기)과 분리한다(stopPropagation) — 펼침 내용은 순수 함수
 * `conditionRowText` 로만 검증한다(이 파일은 jsdom 이 없어 실제 펼쳐진 화면은 못 그린다 —
 * 렌더 시험 파일 맨 위 주석과 같은 한계, 브라우저 QA 몫).
 */
function VerdictRow({ item }: { item: FundingItem }) {
  const [open, setOpen] = useState(false);
  const canExpand = item.fit.length > 0;
  return (
    <div className="mt-2 border-t border-wedly-bd pt-2">
      <div className="flex flex-wrap items-center gap-1.5 text-wedly-hint text-wedly-t2">
        <Badge variant={VERDICT_TONE[item.fitVerdict]}>{VERDICT_WORD[item.fitVerdict]}</Badge>
        <span className="min-w-0 break-keep">{verdictWords(item.fit)}</span>
        {canExpand && (
          <button
            type="button"
            aria-expanded={open}
            onClick={(e) => {
              e.stopPropagation();
              setOpen((v) => !v);
            }}
            // ★글쇠 사건도 끊는다(코덱스 11차 #6, 2026-09-04) — 이 단추에서 Enter·Space 를 누르면
            //  사건이 카드(role="button" + 손으로 이어 준 onKeyDown)까지 올라가 서랍이 같이 열렸다.
            onKeyDown={(e) => e.stopPropagation()}
            className={cn("ml-auto shrink-0", LINK_BTN)}
          >
            {open ? "조건 접기" : "조건 펼치기"}
          </button>
        )}
      </div>
      {open && canExpand && (
        <div className="mt-2 border-t border-dashed border-wedly-bd pt-2">
          <p className="break-keep text-wedly-hint text-wedly-muted">이 사업장 정보와 공고 조건을 하나씩 맞춰 본 결과</p>
          <ul className="mt-1 flex list-none flex-col gap-1">
            {item.fit.map((f, i) => (
              <li key={`${f.label}-${i}`} className="flex items-start gap-1.5 text-wedly-hint text-wedly-t2">
                <Badge variant={COND_BADGE[f.verdict]} className="shrink-0">
                  {conditionVerdictWord(f.verdict)}
                </Badge>
                <span className="break-keep">{conditionRowText(f)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * 항목 카드 앞면(계약 §G2) — 제목(2줄 상한) + 오른쪽 마감 딱지 · 답 네 개 2열
 * (얼마까지·갚기/이자·언제까지·어디에 신청) · 판정 줄. 카드 전체가 눌리면 서랍(기존).
 */
function ItemCard({
  item,
  selected,
  onOpen,
  now,
}: {
  item: FundingItem;
  selected: boolean;
  onOpen: (item: FundingItem) => void;
  now: Date;
}) {
  const repay = repayWords(item);
  return (
    <li>
      <div
        role="button"
        tabIndex={0}
        aria-label={`${item.title} 자세히 보기`}
        aria-current={selected ? "true" : undefined}
        onClick={() => onOpen(item)}
        onKeyDown={(e) => itemKeyDown(e, item, onOpen)}
        className={cn(
          // ★`@container` — 안쪽 「답 네 개」 격자가 **이 카드의 실제 폭**을 재게 만든다(지적 ⑥).
          //  컨테이너는 자기 자신을 못 재므로 격자의 **조상**인 이 상자에 선언한다.
          "@container cursor-pointer rounded-[10px] border border-wedly-bd/60 bg-wedly-bg-gray px-2.5 py-2",
          "transition-colors duration-150 ease-out hover:border-wedly-accent hover:bg-white",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-wedly-accent",
          selected && "border-wedly-accent bg-white",
        )}
      >
        <div className="flex items-start justify-between gap-2">
          <span className="min-w-0 line-clamp-2 break-keep text-wedly-sub font-semibold text-wedly-t1">{item.title}</span>
          <DeadChip item={item} now={now} />
        </div>
        <ItemFlags item={item} className="mt-1" />
        <dl className={FACT_GRID}>
          <Fact label="얼마까지" value={amountWords(item)} />
          <Fact label={repay.label} value={repay.value} />
          <Fact label="언제까지" value={deadlineWords(item.deadline, now).long} />
          <Fact label="어디에 신청" value={whereWords(item)} />
        </dl>
        <VerdictRow item={item} />
      </div>
    </li>
  );
}

/**
 * 안 맞아서 뺀 항목 — 회색(opacity 70%)·간단한 모양(제목·마감·판정 딱지·안 맞는 이유 한 줄).
 *
 * ★갈래를 못 가른 줄에는 「종류 미확인」 딱지를 함께 붙인다(코덱스 12차 #7, 2026-09-04) —
 *  「종류 미확인」 블록은 정상 줄만 모으므로(`unclassifiedGroupItems`), 미확인이면서 안 맞음인 줄은
 *  임시로 얹힌 갈래(grant)의 안 맞음 목록에 아무 표시 없이 섞여 「안 갚아도 되는 돈」으로 읽혔다.
 *
 * ★정상 카드처럼 **눌러 서랍을 연다**(코덱스 13차 #2, 2026-09-04) — 예전엔 「참고용」이라 안 눌렸는데,
 *  그 카드가 서랍으로 가는 유일한 길이었다. 안 맞음 공고에 접힌 상시 상품(relatedProductId)·묶인
 *  수집본·상품 신청처는 서랍에만 있어서, 「왜 안 맞는지·대신 넣을 것은 없나」를 더 보려는 사람이
 *  갈 곳이 없었다. 회색·「안 맞음」 딱지·이유 줄은 그대로 둔다(안 맞는다는 사실을 흐리지 않는다).
 *  표의 안 맞음 행도 이미 눌러 열린다 — 두 보기가 같아진다.
 */
function ExcludedItemCard({
  item,
  now,
  onOpen,
}: {
  item: FundingItem;
  now: Date;
  onOpen: (item: FundingItem) => void;
}) {
  const fail = item.fit.find((f) => f.verdict === "fail");
  const reason = fail ? conditionRowText(fail) : "";
  return (
    <li className="opacity-70">
      <div
        role="button"
        tabIndex={0}
        aria-label={`${item.title} 자세히 보기`}
        onClick={() => onOpen(item)}
        onKeyDown={(e) => itemKeyDown(e, item, onOpen)}
        className={cn(
          "cursor-pointer rounded-[10px] border border-wedly-bd/60 bg-white px-2.5 py-2",
          "transition-colors duration-150 ease-out hover:border-wedly-accent hover:bg-wedly-bg-gray",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-wedly-accent",
        )}
      >
        <div className="flex items-start justify-between gap-2">
          <span className="min-w-0 line-clamp-2 break-keep text-wedly-sub font-semibold text-wedly-t1">{item.title}</span>
          <DeadChip item={item} now={now} />
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-wedly-hint text-wedly-t2">
          <Badge variant="red">안 맞음</Badge>
          {item.unclassified && <KindChip>종류 미확인</KindChip>}
          {reason && <span className="break-keep">안 맞는 이유: {reason}</span>}
        </div>
      </div>
    </li>
  );
}

function GroupCard({
  block,
  expanded,
  excludedShown,
  compact,
  selectedId,
  now,
  onOpen,
  onToggleExpand,
  onToggleExcluded,
}: {
  /** 서버가 준 갈래 칸 그대로 — `total` 은 전체 건수, `items` 는 그중 실어 보낸 몫이다. */
  block: FundingGroupBlock;
  expanded: boolean;
  /** 이 갈래의 「안 맞아서 뺀 항목」을 펼쳤는지 — 부모(showExcluded 집합)가 쥔다. */
  excludedShown: boolean;
  compact: boolean;
  selectedId: string;
  now: Date;
  onOpen: (item: FundingItem) => void;
  onToggleExpand: (group: FundingGroup) => void;
  onToggleExcluded: (group: FundingGroup) => void;
}) {
  const meta = FUNDING_GROUP_META[block.group];
  const tone = GROUP_TONE_TILE[meta.tone];
  const Icon = GROUP_ICON[block.group];
  // 서버가 준 정상 목록에서 「종류 미확인」만 빼낸다(그것들은 맨 아래 전용 블록으로 모인다).
  const normal = classifiedGroupItems(block.items);
  // compact(상세창 추천 탭)는 자리가 좁아 상위 3건 고정 — 펼치기 단추를 두지 않는다.
  const shown = compact || !expanded ? normal.slice(0, FOLDED) : normal;
  const canExpand = !compact && normal.length > FOLDED;
  // ★안 맞음은 **펼친 갈래만** 그린다 — 서버는 하나만 펼쳐도 갈래 전부에 excludedItems 를 실어 준다.
  const excluded = excludedShown ? (block.excludedItems ?? []) : [];
  // 잘려서 못 실은 안 맞음이 있는지(`excluded` 는 전체 개수, 배열은 실려 온 몫).
  const excludedCut = excludedShown && excluded.length < block.excluded;
  // 아래 줄 개수는 **지금 그려진 줄**로 센다(코덱스 11차 #15) — 안 그린 것을 세면 화면과 수가 어긋난다.
  const footer = groupFooterWords(block, shown.length, excluded.length);
  return (
    <section
      data-group={block.group}
      className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-wedly-bd bg-white"
    >
      <div className={cn("flex items-center gap-2.5 border-l-4 px-3 py-2.5", tone.wash, tone.borderL)}>
        <span className={cn("inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", tone.tile)}>
          <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
        </span>
        <span className="min-w-0">
          <span className="block text-wedly-sub font-semibold break-keep text-wedly-t1">{meta.name}</span>
          <span className="block text-wedly-hint break-keep text-wedly-t2">{meta.sub}</span>
          <span className="block text-wedly-hint break-keep font-medium text-wedly-t1">{meta.who}</span>
          <span className="block text-wedly-hint break-keep text-wedly-muted">예: {meta.example}</span>
        </span>
        {/* 딱지는 **서버가 센 전체 건수**다(코덱스 1차 #19 재발 방지). */}
        <span className="ml-auto shrink-0 self-start">
          <Badge variant="default">{건수(block.total)}건</Badge>
        </span>
      </div>
      {shown.length === 0 ? (
        <p className="break-keep px-3 py-4 text-center text-wedly-hint text-wedly-muted">
          지금 조건에 맞는 항목이 없습니다
        </p>
      ) : (
        <ul className="flex list-none flex-col gap-1.5 p-2">
          {shown.map((it) => (
            <ItemCard key={it.id} item={it} selected={it.id === selectedId} onOpen={onOpen} now={now} />
          ))}
        </ul>
      )}
      {(normal.length > 0 || footer.excluded !== null) && (
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-wedly-bd px-3 py-2">
          <span className="break-keep text-wedly-hint text-wedly-muted">
            {footer.shown}
            {canExpand && (
              <>
                {" — "}
                <button type="button" className={LINK_BTN} onClick={() => onToggleExpand(block.group)}>
                  {expanded ? "접기" : "나머지 보기"}
                </button>
              </>
            )}
          </span>
          {footer.excluded !== null && (
            <button type="button" className={BTN_SM} onClick={() => onToggleExcluded(block.group)}>
              {excludedShown ? "뺀 것 접기" : footer.excluded}
            </button>
          )}
        </div>
      )}
      {excluded.length > 0 && (
        <div className="border-t border-dashed border-wedly-bd bg-wedly-bg-gray/40">
          {excludedCut && (
            <p className="break-keep px-3 pt-2 text-wedly-hint text-wedly-muted">
              안 맞아서 뺀 {건수(block.excluded)}건 중 {건수(excluded.length)}건 표시
            </p>
          )}
          <ul className="flex list-none flex-col gap-1.5 p-2">
            {excluded.map((it) => (
              <ExcludedItemCard key={it.id} item={it} now={now} onOpen={onOpen} />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/**
 * 「종류 미확인」 블록 — 낱말 규칙이 「미분류」를 막아, 못 가른 항목은 갈래에서 빼서 여기 맨 아래에 모은다.
 *
 * ★딱지·접기·발치를 **갈래 카드와 같은 규칙**으로 맞췄다(2026-09-05 재검사 지적 2):
 *   ⓐ 딱지는 실려 온 배열 길이가 아니라 **서버가 센 전체 건수**(`total`)다 — 갈래 카드 딱지와
 *     같은 잣대여야 한눈에 두 수를 견줄 수 있다(옛 화면은 834건을 「80건」이라 적었다).
 *   ⓑ 접힘 3줄 + 「나머지 보기」도 갈래 카드와 같다 — 예전엔 실려 온 80줄이 그대로 다 그려져
 *     접는 길도, 나머지를 세는 길도 없었다.
 *   ⓒ 펼침 상태는 갈래 열쇠(`FundingGroup`)에 못 끼우므로 **따로 boolean 하나**로 받는다.
 */
function UnclassifiedBlock({
  items,
  total,
  compact,
  expanded,
  selectedId,
  now,
  onOpen,
  onToggleExpand,
}: {
  items: FundingItem[];
  /** 서버가 센 미확인 **전체** 건수(`FundingMapData.unclassified`). `items` 는 그중 실려 온 몫이다. */
  total: number;
  compact: boolean;
  expanded: boolean;
  selectedId: string;
  now: Date;
  onOpen: (item: FundingItem) => void;
  /** 없으면 「나머지 보기」를 **안 그린다** — 눌러도 아무 일 없는 죽은 링크를 만들지 않는다. */
  onToggleExpand?: () => void;
}) {
  if (items.length === 0) return null;
  // 갈래 카드(GroupCard)와 같은 규칙 — compact 는 3건 고정이라 펼치기 손잡이를 두지 않는다.
  //
  // ★**손잡이가 없으면 접지 않는다**(코덱스 2차 반려 1, 2026-09-05). 펼칠 길을 안 주면서 접기만
  //  하면 실려 온 줄을 **영영 못 보게** 만든다 — 접기는 「나머지 보기」와 한 쌍일 때만 뜻이 있다.
  //  `compact` 만은 예외로 계속 3줄이다(좁은 레일은 애초에 다 보여 줄 자리가 없고, 옛 동작도 그랬다).
  const folded = compact || (Boolean(onToggleExpand) && !expanded);
  const shown = folded ? items.slice(0, FOLDED) : items;
  const canExpand = !compact && items.length > FOLDED && Boolean(onToggleExpand);
  // ★전체 건수는 **한 곳에서** 센다(코덱스 2차 반려 2) — 딱지와 발치가 같은 수를 써야 한다.
  //  `total` 이 그린 줄보다 작은 역전(옛 통로·배포 교체 창)에서는 본 것만큼을 전체로 본다.
  const 전체 = Math.max(total, shown.length);
  // 발치 개수도 갈래 카드와 같이 **지금 그려진 줄**로 센다.
  const footer = unclassifiedFooterWords(전체, shown.length);
  return (
    <section className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-wedly-bd bg-wedly-bg-gray">
      <div className="flex items-center gap-2.5 border-b border-wedly-bd px-3 py-2.5">
        <span className="min-w-0">
          <span className="block text-wedly-sub font-semibold break-keep text-wedly-t1">종류 미확인 — 제목만으로는 못 가름</span>
        </span>
        <span className="ml-auto shrink-0">
          <Badge variant="default">{건수(전체)}건</Badge>
        </span>
      </div>
      <ul className="flex list-none flex-col gap-1.5 p-2">
        {shown.map((it) => (
          <ItemCard key={it.id} item={it} selected={it.id === selectedId} onOpen={onOpen} now={now} />
        ))}
      </ul>
      {footer !== null && (
        <div className="border-t border-wedly-bd px-3 py-2">
          <span className="break-keep text-wedly-hint text-wedly-muted">
            {footer}
            {canExpand && (
              <>
                {" — "}
                <button type="button" className={LINK_BTN} onClick={onToggleExpand}>
                  {expanded ? "접기" : "나머지 보기"}
                </button>
              </>
            )}
          </span>
        </div>
      )}
    </section>
  );
}

/**
 * 표 열 폭 — 공용 `Table` 의 `TableColumn` 에는 폭·className 인자가 **없다**
 * (`node_modules/@wedly/ui-shared/src/ui/Table.tsx` 18~26줄). 그래서 칸 **안쪽 상자**에 폭을 준다.
 * 고정 폭(`w-*`) 금지 — 전부 **최소 폭**(`min-w-*`)이다(독립 검사 B). 합계 51rem(816px).
 */
const COL_W = {
  group: "min-w-[6rem]",
  title: "min-w-[12rem]",
  amount: "min-w-[7rem]",
  rate: "min-w-[5rem]",
  dead: "min-w-[6rem] max-w-[9rem] whitespace-nowrap",
  where: "min-w-[7rem] max-w-[11rem]",
  fit: "min-w-[8rem]",
} as const;

type ColKey = keyof typeof COL_W;

/** 머리글 칸 — **전부 한 줄로**(`whitespace-nowrap`). */
const 머리칸 = (key: ColKey, node: ReactNode): ReactNode => (
  <span className={cn("block whitespace-nowrap", COL_W[key])}>{node}</span>
);

/**
 * 값 칸 — 어절 단위 줄바꿈(`break-keep`)에 그 열의 최소 폭을 함께 준다.
 *
 * `dim` 은 「안 맞아서 뺀」 행을 옅게 그리는 표시다(카드 쪽 `ExcludedItemCard` 와 같은 opacity 70%).
 * 공용 `Table` 에는 행 단위 className 인자가 없어(`@wedly/ui-shared/src/ui/Table.tsx`) **칸마다** 준다.
 */
const 값칸 = (
  key: ColKey,
  node: ReactNode,
  opts: { clamp?: 2; truncate?: boolean; title?: string; dim?: boolean } = {},
): ReactNode => (
  <div
    className={cn(
      "break-keep",
      COL_W[key],
      opts.clamp === 2 && "line-clamp-2",
      opts.truncate && "truncate",
      opts.dim && "opacity-70",
    )}
    title={opts.title || undefined}
  >
    {node}
  </div>
);

/** 이 행이 「안 맞아서 뺀」 것인지 — 표에서 옅게 그릴 판정(펼친 갈래에만 섞여 온다). */
const 옅게 = (r: FundingItem): boolean => r.fitVerdict === "excluded";

/** 항목 판정(fitVerdict) → 딱지 글자·색. 서랍의 조건별 딱지와 같은 말·같은 톤. */
const VERDICT_WORD: Record<FitVerdict, string> = { fit: "맞음", unverified: "확인 필요", excluded: "안 맞음" };
const VERDICT_TONE: Record<FitVerdict, "green" | "yellow" | "red"> = {
  fit: "green",
  unverified: "yellow",
  excluded: "red",
};

/** 「종류」 칸 · 갈래 소개 어디서든 재사용하는 흰 칩 + 색 점(계약 낱말 규칙: 딱지는 흰 칩+색 점). */
function KindChip({ tone, children }: { tone?: FundingGroupTone; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-wedly-bd bg-white px-2.5 py-0.5 text-wedly-hint font-medium text-wedly-t1 shadow-sm">
      {tone && <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", GROUP_TONE_TILE[tone].dot)} aria-hidden="true" />}
      {children}
    </span>
  );
}

/**
 * 표의 「판정」 칸 — 딱지 하나 + 「M/N 맞음」(통과 개수/전체 개수). 기호(✓·✕·?) 없이 숫자로만 —
 * 조건 하나하나는 카드·서랍의 펼침에서 본다(독립 검사 A·B의 「열이 화면 밖으로 밀림」 재발 방지).
 */
function FitSummary({ item }: { item: FundingItem }) {
  const pass = item.fit.filter((f) => f.verdict === "pass").length;
  const total = item.fit.length;
  return (
    <div className="flex flex-col items-start gap-1">
      <Badge variant={VERDICT_TONE[item.fitVerdict]}>{VERDICT_WORD[item.fitVerdict]}</Badge>
      {total > 0 && (
        <span className="whitespace-nowrap text-wedly-hint tabular-nums text-wedly-t2" title={verdictWords(item.fit)}>
          {pass}/{total} 맞음
        </span>
      )}
    </div>
  );
}

/**
 * 표 가로 스크롤 안전망 — **공용 `Table` 이 스스로는 못 미는 자리를 우리가 감싼다.**
 * (독립 검사 A — 5차와 같은 부품, 그대로 유지.)
 */
const SCROLL_HINT = "표가 화면보다 넓습니다 — 옆으로 밀어 더 보세요";
const SCROLLER_LABEL = "자금 조달 표(옆으로 밀어 더 보기)";

function TableScroller({ children }: { children: ReactNode }) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [overflowed, setOverflowed] = useState(false);
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const measure = () => setOverflowed(el.scrollWidth > el.clientWidth + 1);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    for (const child of Array.from(el.children)) ro.observe(child);
    return () => ro.disconnect();
  }, []);
  return (
    <>
      {overflowed && (
        <p className="break-keep text-wedly-hint text-wedly-muted" role="status">
          {SCROLL_HINT}
        </p>
      )}
      <div
        ref={boxRef}
        className={cn(
          "overflow-x-auto rounded-lg",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-wedly-accent",
          overflowed &&
            "[&::-webkit-scrollbar]:h-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-wedly-bd",
        )}
        tabIndex={0}
        role="region"
        aria-label={SCROLLER_LABEL}
      >
        {children}
      </div>
      {overflowed && (
        <p className="break-keep text-wedly-hint text-wedly-muted" aria-hidden="true">
          {SCROLL_HINT}
        </p>
      )}
    </>
  );
}

interface ViewProps {
  data: FundingMapPayload;
  view: FundingView;
  /** 지금 켜진 칩. 화면은 이 값으로 **모양만** 바꾼다 — 자료를 다시 거르지 않는다. */
  filters: FundingFilters;
  /** 지금 고른 차례. 마찬가지로 모양만 바꾼다 — 줄 세우기는 서버가 이미 했다. */
  sort: FundingSort;
  expanded: ReadonlySet<FundingGroup>;
  /**
   * 「종류 미확인」 블록을 펼쳤나 — 갈래 열쇠(`FundingGroup`)에 못 끼우므로 **따로 boolean 하나**다
   * (2026-09-05 재검사 지적 2). 그 블록은 갈래가 아니라 갈래를 못 가른 줄이 모인 곳이라,
   * `expanded` 집합에 가짜 열쇠를 넣으면 갈래 목록을 도는 코드가 그 열쇠를 갈래로 착각한다.
   */
  unclassifiedExpanded?: boolean;
  /**
   * 「안 맞아서 뺀 항목」을 펼친 갈래 집합 — 부모가 쥔다(비어 있지 않으면 부모가 includeExcluded:true 로 재조회).
   * ★**카드 보기 전용**이다(코덱스 14차 [높음], 2026-09-04) — 표 보기는 갈래 카드가 없어 스위치
   *  하나(`filters.includeExcluded`)만 본다. 발 hint 의 「표시 N건」만 두 보기가 나눠 쓴다.
   */
  showExcluded: ReadonlySet<FundingGroup>;
  selectedId: string;
  compact: boolean;
  /** 마감 계산 기준 시각. 생략 없이 부모가 매 렌더 값을 넘긴다(시험이 고정값을 준다). */
  now: Date;
  /** 머리 카드 라벨 줄 오른쪽 끝에 앉을 손잡이(예: 「다시 추천」). 없으면 아무것도 안 그린다. */
  headerAction?: ReactNode;
  onOpen: (item: FundingItem) => void;
  onView: (view: FundingView) => void;
  onFiltersChange: (filters: FundingFilters) => void;
  onSortChange: (sort: FundingSort) => void;
  onToggleExpand: (group: FundingGroup) => void;
  /**
   * 「종류 미확인」 블록의 「나머지 보기 / 접기」 — 갈래 펼침과 **같은 자리**에서 부모가 쥔다.
   * **선택값이다**(코덱스 반려 4, 2026-09-05) — 이 부품은 앱이 직접 그릴 수도 있어, 필수로 두면
   * 옛 부르는 쪽이 그대로 깨진다. 손잡이를 안 주면 「나머지 보기」 링크 자체를 안 그린다
   * (누르면 아무 일도 안 일어나는 죽은 링크를 그리는 것이 더 나쁘다).
   */
  onToggleUnclassified?: () => void;
  onToggleExcluded: (group: FundingGroup) => void;
  onBrowseAll?: () => void;
}

/**
 * 상태 없는 본체 — 보기 갈래·칩·정렬·펼침을 **전부 밖에서 받는다**.
 * 상태를 안에 숨기면 그려서 재는 시험이 「눌러 본 뒤의 화면」을 못 잰다(이 저장소엔 jsdom 이 없다).
 */
export function FundingMapView({
  data,
  view,
  filters,
  sort,
  expanded,
  unclassifiedExpanded = false,
  showExcluded,
  selectedId,
  compact,
  now,
  headerAction,
  onOpen,
  onView,
  onFiltersChange,
  onSortChange,
  onToggleExpand,
  onToggleUnclassified,
  onToggleExcluded,
  onBrowseAll,
}: ViewProps) {
  // ★표 행 = 모든 갈래의 `items`(정상) + **스위치가 켜져 있으면** 모든 갈래의 `excludedItems`
  //  (순수 함수 `tableRowsOf` · 코덱스 14차 [높음], 2026-09-04). 표 위 손잡이가 뒤집는 값이
  //  `filters.includeExcluded` 하나라서, 표가 갈래별 펼치기(`showExcluded`)를 보면 손잡이를 눌러도
  //  행이 안 늘었다(그 함수 주석에 경위). 갈래별 펼치기는 카드 보기에만 남는다.
  // ★합친 뒤 **지금 정렬 기준으로 다시 세운다**(코덱스 12차 #4, 2026-09-04) — 서버는 두 목록을
  //  각자 세워 보내므로 그냥 이어 붙이면 표 전체에서 고른 기준이 깨진다(`sortRows` 주석).
  //  미분류는 표에서도 갈래 칸 이름만 「종류 미확인」으로 바꿔 보여 준다(재분류는 클라이언트 몫).
  const rows = useMemo(
    () => tableRowsOf(data.groups, { includeExcluded: filters.includeExcluded, sort }),
    [data, filters.includeExcluded, sort],
  );
  const filteredTotal = useMemo(() => data.groups.reduce((s, g) => s + g.total, 0), [data]);
  const unclassified = useMemo(() => unclassifiedGroupItems(data.groups), [data]);
  // 카드 보기는 갈래마다 **펼친 것만** 그린다 — 두 보기의 「보이는 규칙」이 갈렸으니 발 hint 의
  // 「표시 N건」도 보기마다 따로 센다. 한 수로 두면 카드 보기에서 접어 둔 안 맞음까지 세어
  // 화면에 없는 줄을 「표시」라고 적는다.
  //
  // ★미확인 줄은 **갈래 칸 `items` 에 실려 오지만 갈래 카드가 안 그린다** — 화면이 맨 아래 전용
  //  블록으로 옮긴다. 그래서 갈래 몫은 `classifiedGroupItems` 로 옮겨 간 줄을 빼고 세고, 미확인
  //  몫은 그 블록이 **실제로 그린 수**로 따로 더한다(코덱스 반려 3, 2026-09-05). 예전엔 `g.items`
  //  를 통째로 세, 미확인 5건이 접혀 3줄만 그려진 화면이 「표시 …건」에 5를 넣어 **화면에 없는
  //  줄까지** 표시라고 적었다.
  //
  // ★**갈래 몫도 그려진 수다**(코덱스 반려 3 후속, 2026-09-05) — 갈래 카드도 접히면 상위 3건만
  //  그리는데 여기서만 실려 온 줄을 통째로 셌다. 한 줄(「표시 N건」) 안에 규칙이 둘이면 그 수가
  //  무엇을 뜻하는지 아무도 못 말한다. 이제 **갈래 카드 발치 `shown.length` 와 같은 규칙**이고
  //  **「종류 미확인」 블록과도 같은 규칙**이다 — 세 자리가 한 규칙을 쓴다.
  //  안 맞음 몫은 그대로다: 접는 규칙이 없어 펼친 갈래의 실려 온 줄이 곧 그려진 줄이다.
  //  ※미확인 몫의 접힘 규칙은 `UnclassifiedBlock` 과 **글자 그대로 같다** — 손잡이가 없으면
  //   그 블록이 접지 않으므로(2차 반려 1) 여기서도 접힌 셈을 하면 안 된다.
  const 미확인접힘 = compact || (Boolean(onToggleUnclassified) && !unclassifiedExpanded);
  const 미확인그려진 = 미확인접힘 ? Math.min(unclassified.length, FOLDED) : unclassified.length;
  const cardShown = useMemo(
    () =>
      data.groups.reduce((s, g) => {
        const 정상 = classifiedGroupItems(g.items);
        const 그려진 = compact || !expanded.has(g.group) ? Math.min(정상.length, FOLDED) : 정상.length;
        return s + 그려진 + (showExcluded.has(g.group) ? (g.excludedItems?.length ?? 0) : 0);
      }, 0),
    [data, showExcluded, compact, expanded],
  ) + 미확인그려진;
  const delivered = view === "table" ? rows.length : cardShown;
  // 안 맞아서 뺀 것이 있으면 정상 0건이어도 빈 상태로 갈아치우지 않는다 — 그러면 갈래 카드와
  // 함께 「안 맞아서 뺀 K건 보기」 단추까지 사라져 열 길이 없어진다(코덱스 11차 #1).
  const excludedTotal = useMemo(() => data.groups.reduce((s, g) => s + g.excluded, 0), [data]);
  const nothingToShow = delivered === 0 && excludedTotal === 0;
  const anyFilter = filters.openOnly || filters.soonOnly;
  const glance = data.glance;
  const totals = data.totals;
  // ★머리 띠는 **요약에 적을 것이 있을 때만** 그린다. 요약이 비었을 때 「없음 — 조건을 맞춰 보지
  //  않은 목록입니다」라고 단정하는 것은 **`profileEmpty`(회사 정보 자체가 비었다)** 하나뿐이다
  //  (코덱스 3차 #C, 2026-09-04 — 옛 신호 `evaluatedConditions` 는 근사치라 폐기했다).
  //  요약이 비어도 인증·특허·기업 규모 같은 값이 판정에 쓰였을 수 있어 「없음」이 거짓일 수 있고,
  //  옛 통로는 이 칸을 아예 안 싣는다 — 그럴 땐 `profileBandOf` 가 아무 말도 하지 않는다.
  const band = profileBandOf(data.usedProfile, data.profileEmpty);
  const gap = gapParts(data.profileGaps);
  // 머리 카드는 **할 말이 있을 때만** 그린다. 판정 근거도 빈칸 힌트도 없으면 카드 자체를 안 그린다.
  const 머리카드 = band !== null || gap !== null;
  // 카드 위쪽(판정 근거 구역 또는 손잡이 줄)이 그려졌나 — 구분선을 그릴지 정한다.
  const 위줄 = band !== null || Boolean(headerAction);

  // 한눈에 4칸은 StatCard 기본 한 톤(파랑)이다 — 칸마다 색을 달리하면 뜻 없는 3톤이 된다(리뷰 대장 #17).
  const 한눈에: Array<{ label: string; value: string; icon: React.ComponentType<{ className?: string }> }> = [
    { label: "지금 신청 가능", value: `${건수(glance.open)}건`, icon: IoCheckmarkCircle },
    { label: "7일 안에 마감", value: `${건수(glance.soon)}건`, icon: IoTime },
    { label: "안 갚아도 되는 돈", value: `${건수(glance.grantFit)}건`, icon: IoGift },
    // 0 은 「모른다」가 아니라 **무이자**다 — 하한 미기재 0 은 조립이 이미 미상(null)으로 되돌린다(2026-09-05).
    { label: "가장 낮은 이자", value: glance.minRate === null ? "—" : glance.minRate === 0 ? "무이자" : `연 ${glance.minRate}%`, icon: IoTrendingDown },
  ];

  /**
   * 표 머리글 — 공용 `Table` 의 `sortable`(부품 안 상태)을 쓰지 않고 **부모 정렬 하나만** 바꾼다.
   * 두 벌이면 셀렉트와 머리글이 서로 다른 차례를 가리킨다(리뷰 대장 #18).
   */
  const 머리 = (label: string, key: FundingSort): ReactNode => {
    const on = sort === key;
    return (
      <button
        type="button"
        aria-pressed={on}
        onClick={() => onSortChange(key)}
        className={cn("inline-flex items-center gap-1 text-white underline-offset-4 hover:underline", on && "font-bold")}
      >
        {label}
        {on ? " ▾" : ""}
      </button>
    );
  };

  const columns: Array<TableColumn<FundingItem>> = [
    {
      key: "group",
      header: 머리칸("group", "종류"),
      render: (r) =>
        값칸(
          "group",
          r.unclassified ? (
            <KindChip>종류 미확인</KindChip>
          ) : (
            <KindChip tone={FUNDING_GROUP_META[r.group].tone}>{FUNDING_GROUP_META[r.group].name}</KindChip>
          ),
          { dim: 옅게(r) },
        ),
    },
    {
      key: "title",
      header: 머리칸("title", "이름"),
      render: (r) =>
        값칸(
          "title",
          <>
            <button
              type="button"
              onClick={() => onOpen(r)}
              className={cn(
                "break-keep text-left font-semibold text-wedly-t1 underline-offset-4 hover:underline",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-wedly-accent",
                r.id === selectedId && "text-wedly-accent-ink",
              )}
            >
              {r.title}
            </button>
            <ItemFlags item={r} className="mt-1" />
          </>,
          { dim: 옅게(r) },
        ),
    },
    {
      key: "amount",
      header: 머리칸("amount", 머리("얼마까지", "amt")),
      render: (r) => {
        const v = amountWords(r);
        return 값칸("amount", <span className="tabular-nums">{v}</span>, { clamp: 2, title: v, dim: 옅게(r) });
      },
    },
    {
      key: "rate",
      header: 머리칸("rate", 머리("갚기/이자", "rate")),
      render: (r) => {
        const v = repayWords(r).value;
        return 값칸("rate", <span className="tabular-nums">{v}</span>, { clamp: 2, title: v, dim: 옅게(r) });
      },
    },
    {
      key: "dead",
      header: 머리칸("dead", 머리("언제까지", "dead")),
      render: (r) =>
        값칸("dead", <span className="tabular-nums"><DeadChip item={r} now={now} /></span>, { dim: 옅게(r) }),
    },
    {
      key: "where",
      header: 머리칸("where", "어디에 신청"),
      render: (r) => {
        const v = whereWords(r);
        return 값칸("where", v, { truncate: true, title: v, dim: 옅게(r) });
      },
    },
    {
      key: "fit",
      header: 머리칸("fit", 머리("판정", "rec")),
      render: (r) => 값칸("fit", <FitSummary item={r} />, { dim: 옅게(r) }),
    },
  ];

  return (
    // ★덩어리 사이 16px(`gap-4`) — 정본 여백 계단은 4·6·8·16·24·32 이고 「카드 사이 16」이 기본이다.
    //  옛 `gap-3`(12px)은 계단에 없는 값이었다(2026-09-04 승인 시안).
    <div className="flex flex-col gap-4">
      {/* ① 머리 카드 — 판정 근거(위)와 빈칸 힌트(아래)를 흰 카드 하나로 묶는다(2026-09-04 승인 시안 A안).
          예전엔 회색 띠 한 줄과 금색 맨 글자 한 줄이 서로 떨어져 떠 있어, 아이콘 0개·굵기 600 줄 0개라
          눈이 처음 붙잡을 곳이 없었다. 이제 구역마다 아이콘 타일 1개와 굵기 600 한 줄을 둔다.
          ★금색은 아이콘 타일까지만 쓴다 — 흰 바탕 위 금색 글자는 대비 2.0 미달이라 본문에 못 쓴다
           (상태 박스 v3 와 같은 규칙. 경고 타일 심볼만 남색인 것도 금색 위 흰 글리프 2.1 미달 때문이다).
          ★headerAction(「다시 추천」 같은 손잡이)은 라벨 줄 오른쪽 끝에 앉는다 — 단추 하나가
           한 줄을 통째로 쓰던 빈 줄을 없앤다. */}
      {머리카드 ? (
        <div className="rounded-xl border border-wedly-bd bg-white shadow-[0_1px_2px_rgba(10,34,68,0.05),0_6px_18px_rgba(10,34,68,0.08)]">
          {band ? (
            <div className="flex items-start gap-2.5 p-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-wedly-accent">
                <IoBusiness className="h-5 w-5 text-white" aria-hidden="true" />
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex min-h-[22px] items-center justify-between gap-2.5">
                  <span className="truncate text-wedly-hint text-wedly-muted">{band.label}</span>
                  {headerAction}
                </div>
                <p className="min-w-0 break-keep text-wedly-sub font-semibold text-wedly-t1">{band.value}</p>
              </div>
            </div>
          ) : (
            headerAction && <div className="flex justify-end p-3">{headerAction}</div>
          )}
          {gap && (
            <>
              {위줄 && <div className="border-t border-wedly-bd/60" />}
              <div className="flex items-start gap-2.5 p-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-wedly-gold">
                  <IoAlertCircle className="h-5 w-5 text-wedly-navy" aria-hidden="true" />
                </span>
                {/* ★차례가 위 구역과 같다 — 작은 라벨 위, 큰 값 아래(2026-09-04 승인 시안).
                    예전엔 이 구역만 「큰 제목 → 작은 설명」으로 거꾸로여서, 한 카드 안에서 같은 뜻의
                    두 줄이 서로 다른 차례로 놓였다. 옛 본문 한 줄은 라벨로 접혀 사라졌고 줄 수는
                    그대로 둘이라 카드가 길어지지 않는다. */}
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <p className="min-w-0 break-keep text-wedly-hint text-wedly-muted">{gap.label}</p>
                  <p className="min-w-0 break-keep text-wedly-sub font-semibold text-wedly-t1">{gap.title}</p>
                </div>
              </div>
            </>
          )}
        </div>
      ) : (
        headerAction && <div className="flex justify-end">{headerAction}</div>
      )}

      {/* ② 한눈에 4칸 — 숫자는 서버가 전체 자료로 센 값(data.glance)이다.
          ★구현 결함 수정(통합 단계 G4, 2026-09-04) — compact(통합 상세창 추천 탭)에서도 이 줄만
           4열 그대로였다(바로 아래 갈래 카드 줄은 `!compact &&`로 이미 2열까지만 두던 것과 어긋남).
           `lg:` 는 뷰포트 폭 기준이라, 데스크톱 화면에서 열리는 좁은 상세창 안에서도 그대로 켜져
           4칸이 좁은 자리에 눌려 보였다 — 갈래 카드와 같은 패턴으로 맞춘다. */}
      {/* ★네 칸이 칩·정렬을 **안 따른다는 사실**을 화면에 적는다(2026-09-05 재검사 지적 3 · 승인 시안 A안).
          칩 「7일 안에 마감되는 것만」을 켜면 이 줄의 「안 갚아도 되는 돈 1,619건」은 그대로인데 100px
          아래 갈래 카드는 「90건」이 된다 — 같은 이름의 두 수가 다른 말을 하는데 화면이 왜 다른지
          한마디도 안 했다. 숫자를 칩에 따르게 바꾸지 않는 것은 **고의**이므로(앞선 지적으로 그렇게
          고쳤다) 결정은 그대로 두고 기준만 적는다. compact 레일도 같은 부품이라 자동으로 따라온다. */}
      {/* ★캡션과 네 칸을 **한 덩어리로** 감싼다 — 이 화면 뿌리는 `flex flex-col gap-4`(16px)라
          캡션을 낱개 칸으로 두면 `mb-2`(8px)가 그 16px 에 **더해져** 24px 이 된다(승인 시안은 8px). */}
      <div>
        <p className="mb-2 break-keep text-wedly-hint text-wedly-muted">전체 자료 기준 — 아래 칩·정렬과 무관합니다</p>
        {/* ★숫자 카드 사이 16px(`gap-4`) — 옛 `gap-2.5`(10px)는 정본 계단에 없는 값이었다. */}
        <div className={cn("grid gap-4 grid-cols-2", !compact && "lg:grid-cols-4")}>
          {한눈에.map((s) => (
            <StatCard key={s.label} label={s.label} value={s.value} icon={s.icon} />
          ))}
        </div>
      </div>

      {/* ③ 조작줄 — 칩·정렬을 누르면 부모가 통로를 다시 부른다(여기서 자료를 만지지 않는다)
          ★`data-controls` 는 **시험이 이 줄만 잘라 내는 표식**이다(`data-chip`·`data-group` 과 같은
           쓰임). 이 줄 안 글자가 한 층인지 재려면 줄 밖 글자와 섞이지 않게 잘라야 한다 —
           표식이 없으면 문서 전체에서 재게 되어 시험이 껍데기가 된다. */}
      <div data-controls="funding-map" className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {/* ★알약도 36px — `className` 은 공용 부품 안에서 알약 트랙에 그대로 합쳐진다
              (`@wedly/ui-shared` SegmentedControl, `cn(...)`). 그래서 공용 부품 파일은 안 건드린다.
              안쪽 단추 글자는 `[&>button]:` 로 직접 세로 가운데에 둔다 — 트랙만 키우고 두면
              글자 위치가 브라우저 기본에 맡겨진다. */}
          <SegmentedControl
            className="h-9 [&>button]:inline-flex [&>button]:items-center"
            options={[
              { value: "map", label: "카드로 보기" },
              { value: "table", label: "표로 보기" },
            ]}
            value={view}
            onChange={(v) => onView(v === "table" ? "table" : "map")}
          />
          {CHIPS.map((c) => (
            <button
              key={c.key}
              type="button"
              data-chip={c.key}
              aria-pressed={filters[c.key]}
              onClick={() => onFiltersChange(nextFilters(filters, c.key))}
              className={cn(CHIP_BASE, filters[c.key] && CHIP_ON)}
            >
              {c.label}
            </button>
          ))}
          {/* ★표 보기 전용 「여는 손잡이」(코덱스 13차 #1, 2026-09-04) — 카드 보기에는 갈래마다
              「안 맞아서 뺀 N건 보기」 단추가 있지만 **표 보기에는 갈래 카드가 없어서**, 뺀 공고가
              있어도 그 존재도 여는 법도 알 길이 없었다(회색 안내 문장을 지우면서 생긴 구멍).
              ※ 「맞는 것만」 칩을 되살리는 게 아니다 — 그건 기본이 「안 맞음 제외」인 지금 계약과
                반대다. 이건 **뺀 것을 여는** 한 방향 손잡이다.
              ※ 뺀 것이 **실제로 있을 때만** 그린다(0이면 없는 일을 알리지 않는다).
              ※ 카드 보기에서는 안 그린다 — 갈래마다 단추가 이미 있어 같은 말이 두 번 된다.
              ※ 누르면 표 행이 **모든 갈래**의 안 맞음만큼 늘어난다(`tableRowsOf`) — 갈래별 펼치기와
                섞이지 않는다(14차 [높음]).
              ★손잡이 글자에는 **건수를 적지 않는다**(독립 검사 지적 ⑦, 2026-09-04). 예전엔
                「안 맞는 공고도 보기 (4,962건)」이라 적었는데, 서버는 갈래마다 `excludedItems` 를
                topN 까지만 실으므로(`groupBlocks`) 눌러도 18줄만 늘었다 — **지킬 수 없는 약속**이다.
                꺼져 있을 땐 `excludedItems` 가 아예 안 실려 와 「실어 줄 수 있는 건수」를 화면이
                알 길조차 없다. 실제로 몇 건이 보이는지는 발 안내(「표시 N건」)가 이미 정확히 말한다.
                ※ `excludedTotal` 은 이제 **손잡이를 그릴지 말지**(0이면 안 그린다)에만 쓴다.
                ※ 갈래 카드의 「안 맞아서 뺀 N건 보기」는 **그대로 둔다** — 그건 그 갈래의 진짜
                  전체 수이고, 펼친 뒤 발치가 「N건 중 M건 표시」로 잘림을 정확히 말한다. */}
          {view === "table" && excludedTotal > 0 && (
            <button
              type="button"
              data-excluded-toggle="table"
              aria-pressed={filters.includeExcluded}
              onClick={() => onFiltersChange(nextFilters(filters, "includeExcluded"))}
              className={cn(CHIP_BASE, filters.includeExcluded && CHIP_ON)}
            >
              안 맞는 공고도 보기
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* ★글자 층도 조작줄 한 층(13px) — 11px 로 두면 같은 줄의 알약·칩보다 작아 라벨만 뒤로 물러난다. */}
          <label className="inline-flex min-h-9 items-center text-wedly-sub text-wedly-muted" htmlFor="funding-map-sort">
            정렬
          </label>
          {/* ★셀렉트만 42px 이라 혼자 컸다. 부품 **기본**은 그대로 두고 `controlClassName` 으로
              **이 자리에서만** 36px 을 준다 — 이 부품을 ERP 43개·일루아 2개 화면이 쓰는데
              기본 높이를 내리면 그 화면들이 전부 함께 바뀌기 때문이다(승인 범위 밖).
              부품 전체를 정본 높이로 수렴시키는 일은 **별도 승인이 필요한 후속**이다. */}
          {/* ★글자 크기도 **같은 길**로 준다(독립 검사 지적 ④) — 부품 기본은 `text-sm`(14px)이라
              조작줄에서 혼자 컸다. `controlClassName` 은 `cn`(tailwind-merge)을 타고, 이 저장소의
              `cn` 은 WEDLY 글자 여섯 층을 「글자 크기」로 등록해 두었으므로(`@wedly/ui-shared` cn.ts)
              `text-wedly-sub` 가 부품의 `text-sm` 을 **지우고** 이긴다 — 실제로 지워지는지는
              `customSelect-render.test.tsx` 가 그려 낸 클래스에서 확인한다.
              부품 **기본값은 안 건드린다** — 이 부품을 ERP 43개·일루아 2개 화면이 쓴다. */}
          <CustomSelect
            id="funding-map-sort"
            value={sort}
            onChange={(v) => onSortChange(v as FundingSort)}
            options={SORT_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
            className="min-w-[8.5rem]"
            controlClassName="flex h-9 items-center py-0 text-wedly-sub"
          />
          {/* ★조작줄 안이라 여기서만 36px·13px — 상수를 키우면 조작줄 밖 단추까지 커진다(BTN_SM 주석).
              글자 층도 여기서만 올린다(`cn` 이 상수의 `text-wedly-hint` 11px 을 지운다). */}
          {onBrowseAll && (
            <button type="button" className={cn(BTN_SM, "h-9 inline-flex items-center text-wedly-sub")} onClick={onBrowseAll}>
              전체 공고 탐색
            </button>
          )}
        </div>
      </div>

      {/* ④·⑤ 카드 / 표 */}
      {nothingToShow ? (
        <EmptyState
          title="조건에 맞는 항목이 없습니다"
          description="위 칩을 풀면 더 많은 항목이 보입니다"
          action={
            anyFilter ? (
              <button
                type="button"
                className={BTN_SM}
                onClick={() => onFiltersChange({ ...filters, openOnly: false, soonOnly: false })}
              >
                칩 모두 풀기
              </button>
            ) : undefined
          }
        />
      ) : view === "map" ? (
        // ★갈래 카드 격자와 「종류 미확인」 블록 사이도 16px — 격자만 `gap-4` 로 바꾸고 이 바깥
        //  상자를 `gap-3` 로 두면 화면 마지막 경계에서만 12px 이 된다(코덱스 13차 #3).
        // ★`@container` — 아래 격자가 **이 상자의 실제 폭**으로 열 수를 정하게 만든다(지적 ⑥).
        <div className="@container flex flex-col gap-4">
          {/* ★갈래 카드 사이 16px(`gap-4`) — 옛 `gap-3`(12px)는 정본 계단에 없는 값이었다. */}
          <div className={cn(GROUP_GRID, !compact && GROUP_GRID_WIDE)}>
            {data.groups.map((block) => (
              <GroupCard
                key={block.group}
                block={block}
                expanded={expanded.has(block.group)}
                excludedShown={showExcluded.has(block.group)}
                compact={compact}
                selectedId={selectedId}
                now={now}
                onOpen={onOpen}
                onToggleExpand={onToggleExpand}
                onToggleExcluded={onToggleExcluded}
              />
            ))}
          </div>
          {/* ★딱지·발치의 건수는 **서버가 센 전체 미확인 수**(`data.unclassified`)다 — 실려 온
              배열 길이(`unclassified.length`)로 되돌리면 834건짜리 화면이 다시 「80건」이라 적는다. */}
          <UnclassifiedBlock
            items={unclassified}
            total={data.unclassified}
            compact={compact}
            expanded={unclassifiedExpanded}
            selectedId={selectedId}
            now={now}
            onOpen={onOpen}
            onToggleExpand={onToggleUnclassified}
          />
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          <TableScroller>
            <Table
              columns={columns}
              rows={rows}
              rowKey={(r) => r.id}
              emptyText="조건에 맞는 항목이 없습니다"
              className="w-fit"
            />
          </TableScroller>
          <p className="break-keep text-wedly-hint text-wedly-muted">
            표는 고른 차례로 전체를 정렬합니다
          </p>
        </div>
      )}

      {/* ⑥ 발 hint */}
      <p className="break-keep text-wedly-hint text-wedly-muted">
        {totals ? (
          <>
            표시 {건수(delivered)}건 / 조건에 맞는 {건수(totals.filtered)}건 / 전체 {건수(totals.all)}건
          </>
        ) : (
          <>
            표시 {건수(delivered)}건 / {anyFilter ? "조건에 맞는" : "전체"} {건수(filteredTotal)}건
          </>
        )}{" "}
        · 기준 {kstStamp(data.generatedAt)}
      </p>
    </div>
  );
}

export interface FundingMapProps {
  data: FundingMapPayload | null;
  loading: boolean;
  error: string;
  /** 칩 상태 — 부모가 쥔다(바뀌면 부모가 통로를 다시 부른다). */
  filters: FundingFilters;
  /** 정렬 상태 — 부모가 쥔다. */
  sort: FundingSort;
  onFiltersChange: (filters: FundingFilters) => void;
  onSortChange: (sort: FundingSort) => void;
  onOpen: (item: FundingItem) => void;
  /** 공고의 상세·AI 판정 화면을 여는 손잡이. compact 에서는 서랍 대신 이쪽으로 보낸다. */
  onOpenDetail?: (announcementId: string) => void;
  /** 「전체 공고 탐색」 — /policy-match 만 넘긴다(상세창 추천 탭엔 갈 곳이 없다). */
  onBrowseAll?: () => void;
  selectedId: string;
  /** 통합 상세창 추천 탭: 갈래 2열 · 상위 3건 고정. */
  compact?: boolean;
  /** 오류 상자의 「다시 시도」. 없으면 단추를 그리지 않는다(누르면 아무 일도 안 하는 단추를 두지 않는다). */
  onRetry?: () => void;
  /**
   * 갈래별 「안 맞아서 뺀 항목 보기」 펼침 집합 — **부모가 쥔다**(계약 §G2). 비어 있지 않으면
   * 부모가 `includeExcluded:true` 로 재조회해야 하므로(네트워크 함의) `expanded`(펼치기, 순수 UI)와
   * 달리 이 컴포넌트 안에 두지 않는다.
   */
  showExcluded: ReadonlySet<FundingGroup>;
  onToggleExcluded: (group: FundingGroup) => void;
  /** 마감 계산 기준 시각 — 생략하면 지금(new Date()). 시험이 고정값을 넣는다. */
  now?: Date;
  /**
   * 머리 카드 라벨 줄 오른쪽 끝에 앉을 손잡이(예: 「다시 추천」). 없으면 아무것도 안 그린다.
   * 뼈대·오류·자료 없음처럼 **머리 카드가 없는 상태**에서는 오른쪽 끝 한 줄로 대신 그린다 —
   * 이 손잡이는 어느 상태에서도 남아야 한다(화면 독립 검사 2026-08-30 지적 F).
   */
  headerAction?: ReactNode;
}

const ERROR_TITLE = "자금 조달 지도를 불러오지 못했습니다";

/** 보기 갈래·펼침만 쥔 껍데기. 칩·정렬·안 맞음 펼침은 부모 몫이고, 그리는 일은 전부 `FundingMapView` 가 한다. */
export default function FundingMap({
  data,
  loading,
  error,
  filters,
  sort,
  onFiltersChange,
  onSortChange,
  onOpen,
  onOpenDetail,
  onBrowseAll,
  selectedId,
  compact = false,
  onRetry,
  showExcluded,
  onToggleExcluded,
  now,
  headerAction,
}: FundingMapProps) {
  const [view, setView] = useState<FundingView>("map");
  const [expanded, setExpanded] = useState<ReadonlySet<FundingGroup>>(() => new Set<FundingGroup>());
  // 「종류 미확인」 블록 펼침 — 갈래 열쇠가 아니라서 갈래 집합에 못 넣는다(2026-09-05 재검사 지적 2).
  const [unclassifiedExpanded, setUnclassifiedExpanded] = useState(false);

  // ★훅은 조기 반환보다 위에 둔다 — 아래로 내려가면 화면이 통째로 죽는다(2026-08 실사고).

  // 「다시 추천」 같은 손잡이는 **어느 상태에서도** 남는다(화면 독립 검사 2026-08-30 지적 F —
  // 배포 교체 창의 일시 502 뒤 사용자가 복구할 길이 상세창을 닫았다 여는 것뿐이었다).
  // 뼈대·오류·자료 없음에는 손잡이를 얹을 머리 카드가 없으므로 오른쪽 끝 한 줄로 둔다.
  //
  // ★재조회 중에도 **누를 수 있게** 감싼다(코덱스 5차 #3, 2026-09-04). 자료를 쥔 채 다시 부르는
  //  동안 맨 아래 감싸개가 지도 전체를 `pointer-events-none` 으로 잠그는데, 그 안에 든 이 손잡이까지
  //  같이 죽으면 멈췄을 때 복구할 길이 사라진다 — 지적 F 가 그대로 되살아난다. `pointer-events` 는
  //  상속되므로 자손에서 `auto` 로 되돌리면 이 손잡이만 살아난다(흐림·나머지 잠금은 그대로).
  const 손잡이 = headerAction ? <span className="pointer-events-auto inline-flex">{headerAction}</span> : undefined;
  const 손잡이줄 = 손잡이 ? <div className="mb-2 flex justify-end">{손잡이}</div> : null;

  // 뼈대는 **첫 로딩만**. 이미 본 자료가 있으면 칩 하나 눌렀다고 화면이 사라지지 않게 흐리게 두고 바꾼다.
  if (loading && !data) {
    return (
      <>
        {손잡이줄}
        {/* ★뼈대도 실제 갈래 격자와 같은 16px·같은 열 규칙 — 12px 로 두거나 컨테이너 선언을 빼면
            자료가 도착하는 순간 칸 간격이 4px 벌어지거나 열 수가 바뀌어 열이 움직인다
            (코덱스 13차 #4 · 지적 ⑥). 컨테이너는 자기 자신을 못 재므로 겉 상자에 선언한다. */}
        <div className="@container">
          <div className={cn(GROUP_GRID, !compact && GROUP_GRID_WIDE)} aria-busy="true">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} variant="block" className="h-40" />
            ))}
          </div>
        </div>
      </>
    );
  }

  if (error) {
    // ★ StatusBox 의 `actions` 칸은 쓰지 않는다 — 그 칸은 카드 폭을 못 채워 단추가 어중간한 자리에 선다
    //   (`src/components/ui/__tests__/statusbox-actions-trap.test.ts` 가 빌드에서 막는다). 상자 밖 왼쪽에 둔다.
    return (
      <>
        {손잡이줄}
        <div className="flex flex-col gap-2">
          <StatusBox tone="error" title={ERROR_TITLE}>
            {error === ERROR_TITLE ? "잠시 뒤 다시 시도해 주세요." : error}
          </StatusBox>
          {onRetry && (
            <div>
              <button type="button" className={BTN_SM} onClick={onRetry}>
                다시 시도
              </button>
            </div>
          )}
        </div>
      </>
    );
  }

  if (!data) return 손잡이줄;

  const openItem = (it: FundingItem) => {
    if (onOpenDetail && shouldOpenDetail(it, compact)) onOpenDetail(it.refId);
    else onOpen(it);
  };

  return (
    <div
      aria-busy={loading || undefined}
      className={loading ? "pointer-events-none opacity-60 transition-opacity duration-200 ease-out" : undefined}
    >
      <FundingMapView
        data={data}
        view={view}
        filters={filters}
        sort={sort}
        expanded={expanded}
        unclassifiedExpanded={unclassifiedExpanded}
        showExcluded={showExcluded}
        selectedId={selectedId}
        compact={compact}
        now={now ?? new Date()}
        headerAction={손잡이}
        onOpen={openItem}
        onView={setView}
        onFiltersChange={onFiltersChange}
        onSortChange={onSortChange}
        onToggleExpand={(group) =>
          setExpanded((prev) => {
            const next = new Set(prev);
            if (next.has(group)) next.delete(group);
            else next.add(group);
            return next;
          })
        }
        onToggleUnclassified={() => setUnclassifiedExpanded((prev) => !prev)}
        onToggleExcluded={onToggleExcluded}
        onBrowseAll={onBrowseAll}
      />
    </div>
  );
}
