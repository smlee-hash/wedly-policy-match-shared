/**
 * 정책별 고객사 읽기 통로의 주소 글자(`URLSearchParams`) → 질의. ERP `api/policy-track/deadline/route.ts` 의 해석과 오류 글자를 그대로 옮겼다.
 * 잘못된 값은 `BadDeadlineQuery`(통로가 400 BAD_REQUEST 로 응답)를 던진다. 거르는 순서(view → scope → 보기별 값)도 원본과 같다.
 * 정렬(`sort`)은 list·contacts·company·export 만, 단계(`tiers`)는 contacts·company 만 읽는다(NO.789 — 원본에 없는 질의).
 */
import {
  CONTACTS_DEFAULT_DAYS,
  CONTACTS_INCLUDE_UNSTRUCTURED_DEFAULT,
  LIST_DEFAULT_DAYS,
  type DaysFilter,
  type DeadlineTier,
  type SortOrder,
} from "./types";

export const DEADLINE_VIEWS = ["list", "bucket", "contacts", "company", "summary", "export"] as const;
export type DeadlineView = (typeof DEADLINE_VIEWS)[number];

/** 화면이 요청한 담당 범위 — 글자가 없으면 null. 어느 범위를 줄지는 앱의 scopeOf 가 정한다. */
export type RequestedScope = "mine" | "all" | null;

const DAYS: Record<string, DaysFilter> = { "7": 7, "14": 14, "30": 30, all: "all" };
const TIER_WORDS: readonly DeadlineTier[] = ["high", "mid", "low"];
/** 정렬을 안 정하면 맞을 확률 순. */
const DEFAULT_SORT: SortOrder = "tier";
const CUSTOMER_KEY = /^[bp]:\d{1,64}$/;

/** 잘못된 질의 — 통로가 400 BAD_REQUEST 와 이 글자로 응답한다. */
export class BadDeadlineQuery extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BadDeadlineQuery";
  }
}

export interface ContactFilter {
  days: DaysFilter;
  includeUnstructured: boolean;
  includeProgress: boolean;
  sort: SortOrder;
  /** 남길 단계 — 비면(키 없음) 거르지 않는다. */
  tiers?: DeadlineTier[];
}

export type DeadlineQuery =
  | { view: "list"; scope: RequestedScope; days: DaysFilter; hideEmpty: boolean; sort: SortOrder }
  | { view: "bucket"; scope: RequestedScope; bucketKey: string }
  | ({ view: "contacts"; scope: RequestedScope } & ContactFilter)
  | ({ view: "company"; customerKey: string } & ContactFilter)
  | { view: "summary"; scope: RequestedScope }
  | { view: "export"; scope: RequestedScope; days: DaysFilter; fitOnly: boolean; sort: SortOrder; category?: string };

function isView(value: string): value is DeadlineView {
  return (DEADLINE_VIEWS as readonly string[]).includes(value);
}

function isTierWord(value: string): value is DeadlineTier {
  return (TIER_WORDS as readonly string[]).includes(value);
}

function daysOf(raw: string | null, fallback: DaysFilter): DaysFilter {
  if (raw === null || raw === "") return fallback;
  const days = DAYS[raw];
  if (days === undefined) throw new BadDeadlineQuery("days 는 7·14·30·all 중 하나입니다.");
  return days;
}

function flagOf(raw: string | null, fallback: boolean): boolean {
  if (raw === null || raw === "") return fallback;
  if (raw === "1") return true;
  if (raw === "0") return false;
  throw new BadDeadlineQuery("거르기 값은 0 또는 1 입니다.");
}

function scopeOf(raw: string | null): RequestedScope {
  if (raw === null || raw === "") return null;
  if (raw === "mine" || raw === "all") return raw;
  throw new BadDeadlineQuery("보기 범위가 올바르지 않습니다.");
}

function sortOf(raw: string | null): SortOrder {
  if (raw === null || raw === "") return DEFAULT_SORT;
  if (raw === "tier" || raw === "deadline") return raw;
  throw new BadDeadlineQuery("정렬 값이 올바르지 않습니다.");
}

/** 쉼표로 이은 단계(예: "high,mid") — 겹친 낱말은 한 번만. 비면 undefined(거르지 않음), 모르는 낱말이 있으면 400. */
function tiersOf(raw: string | null): DeadlineTier[] | undefined {
  if (raw === null || raw === "") return undefined;
  const tiers: DeadlineTier[] = [];
  for (const word of raw.split(",")) {
    if (!isTierWord(word)) throw new BadDeadlineQuery("단계 값이 올바르지 않습니다.");
    if (!tiers.includes(word)) tiers.push(word);
  }
  return tiers;
}

function contactFilterOf(q: URLSearchParams): ContactFilter {
  const days = daysOf(q.get("days"), CONTACTS_DEFAULT_DAYS);
  const includeUnstructured = flagOf(q.get("includeUnstructured"), CONTACTS_INCLUDE_UNSTRUCTURED_DEFAULT);
  const includeProgress = flagOf(q.get("includeProgress"), false);
  const sort = sortOf(q.get("sort"));
  const tiers = tiersOf(q.get("tiers"));
  return { days, includeUnstructured, includeProgress, sort, ...(tiers !== undefined ? { tiers } : {}) };
}

export function parseDeadlineQuery(q: URLSearchParams): DeadlineQuery {
  const view = q.get("view") || "list";
  if (!isView(view)) throw new BadDeadlineQuery("view 값이 올바르지 않습니다.");
  const scope = scopeOf(q.get("scope"));

  if (view === "list") {
    return {
      view,
      scope,
      days: daysOf(q.get("days"), LIST_DEFAULT_DAYS),
      hideEmpty: flagOf(q.get("hideEmpty"), true),
      sort: sortOf(q.get("sort")),
    };
  }
  if (view === "bucket") {
    const bucketKey = (q.get("bucket") ?? "").trim();
    if (!bucketKey || bucketKey.length > 300) throw new BadDeadlineQuery("공고를 골라 주세요.");
    return { view, scope, bucketKey };
  }
  if (view === "contacts") return { view, scope, ...contactFilterOf(q) };
  if (view === "company") {
    const filter = contactFilterOf(q);
    const customerKey = q.get("customerKey") ?? "";
    if (!CUSTOMER_KEY.test(customerKey)) throw new BadDeadlineQuery("업체를 골라 주세요.");
    return { view, customerKey, ...filter };
  }
  if (view === "summary") return { view, scope };
  const category = q.get("category");
  if (category !== null && category.length > 100) throw new BadDeadlineQuery("분류 값이 너무 깁니다.");
  return {
    view,
    scope,
    days: daysOf(q.get("days"), LIST_DEFAULT_DAYS),
    fitOnly: flagOf(q.get("fitOnly"), false),
    sort: sortOf(q.get("sort")),
    ...(category !== null ? { category } : {}),
  };
}

/** 업체 열쇠(b: 사업자 · p: 개인 + 숫자) 모양인가 — 「업무 현황에 추가」 본문도 같은 규칙을 쓴다. */
export function isCustomerKey(value: string): boolean {
  return CUSTOMER_KEY.test(value);
}
