// 정책별 고객사·연락 예정 화면의 「주소 ↔ 화면 상태」 — 화면 컴포넌트와 따로 둬서 글자만으로 시험한다.
//   ?tab=companies|contacts  &view=list|calendar  &bucket=<공고 열쇠>  &scope=mine|all
// 기본값(tab=companies · view=list · scope=mine)은 주소에서 뺀다. scope 는 `scopeToggle` 이 켜졌을 때만 읽고 쓴다.
import type { DaysFilter, ScopeFilter, SummaryView } from "../../serve/policy-deadline/types";
import type { ContactsBoardView } from "./ContactsBoard";
import type { SummaryTab } from "./SummaryCards";

export type ScreenTab = SummaryTab;

export interface ScreenState {
  tab: ScreenTab;
  /** 연락 예정 탭의 보기. 정책별 고객사 탭에서는 쓰지 않는다. */
  view: ContactsBoardView;
  /** 정책별 고객사 탭에서 바로 펼칠 공고 열쇠(슬랙 「공고 보기」). 없으면 빈 글자. */
  bucket: string;
  scope: ScopeFilter;
}

export const DEFAULT_SCREEN_STATE: ScreenState = { tab: "companies", view: "list", bucket: "", scope: "mine" };

/** 첫 화면의 마감 거르기 — 두 탭 모두 14일(카드 숫자도 14일 기준이다). */
export const DEFAULT_DAYS: DaysFilter = 14;

const OWN_KEYS = ["tab", "view", "bucket", "scope"] as const;

/**
 * 주소의 검색 글자(`?tab=…`)에서 화면 상태를 읽는다. 모르는 값은 기본값으로 둔다.
 * `tab=deadline` 은 옛 주소(슬랙 「공고 보기」) — 정책별 고객사로 읽는다.
 */
export function parseScreenSearch(search: string, scopeToggle: boolean): ScreenState {
  const q = new URLSearchParams(search);
  const tabValue = q.get("tab");
  const tab: ScreenTab = tabValue === "contacts" ? "contacts" : "companies";
  const view: ContactsBoardView = q.get("view") === "calendar" ? "calendar" : "list";
  const bucket = tab === "companies" ? q.get("bucket") ?? "" : "";
  const scope: ScopeFilter = scopeToggle && q.get("scope") === "all" ? "all" : "mine";
  return { tab, view, bucket, scope };
}

/**
 * 화면 상태를 주소의 검색 글자로 만든다. 이 화면이 모르는 다른 값(앱이 붙인 `key` 등)은 그대로 두고,
 * 기본값은 뺀다. 결과는 `?` 로 시작하거나(값이 있을 때) 빈 글자다.
 */
export function screenSearch(state: ScreenState, scopeToggle: boolean, currentSearch = ""): string {
  const q = new URLSearchParams(currentSearch);
  for (const key of OWN_KEYS) if (key !== "scope" || scopeToggle) q.delete(key);
  if (state.tab === "contacts") {
    q.set("tab", "contacts");
    if (state.view === "calendar") q.set("view", "calendar");
  } else if (state.bucket) {
    q.set("bucket", state.bucket);
  }
  if (scopeToggle && state.scope === "all") q.set("scope", "all");
  const text = q.toString();
  return text ? `?${text}` : "";
}

/** 요약 응답이 두 카드를 그릴 만큼 다 왔는지 — 덜 온 응답은 못 읽은 것으로 본다. */
export function completeSummary(view: SummaryView | null | undefined): SummaryView | null {
  return view?.buckets && view.contactKinds ? view : null;
}

/** 설명 한 줄 — 모든 고객사가 보이는지(앱이 정한 범위)에 따라 한 줄이 다르다. 제목은 앱 위 띠가 그린다. */
export function descriptionLine(showConsultant: boolean): string {
  return showConsultant
    ? "정책마다 맞는 고객사를 묶어 보고, 연락할 업체를 마감 순서로 봅니다. 모든 고객사가 보입니다."
    : "정책마다 맞는 내 담당 고객사를 묶어 보고, 연락할 업체를 마감 순서로 봅니다.";
}
