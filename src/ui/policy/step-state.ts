// 두 단계(① 회사 정보 → ② 매칭 결과)의 주소·저장 규칙 — 그리지 않는 순수 함수만 모았다.
// 단계는 주소의 `?step=result` 에, 입력한 회사 정보는 sessionStorage 에만 둔다(서버에 저장하지 않는다).
// 브라우저 흉내(jsdom)가 없어도 시험으로 재려고 창·저장소를 직접 만지지 않고 인자로 받는다.
import { corporationOf, type BusinessProfile } from "../../engine/match-engine";
import { manwonToKorean } from "./profile-field-format";

export type Step = "company" | "result";

/** 입력한 회사 정보를 담아 두는 sessionStorage 열쇠 — 새로 고침해도 결과를 다시 돌릴 수 있게 한다. */
export const PROFILE_STORAGE_KEY = "wedly-policy-match:profile:v1";

/** 저장소에서 읽고 쓰는 데 필요한 것만 — 시험이 가짜 저장소를 넘길 수 있다. */
export type ProfileStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** 주소 쿼리(`?a=1&step=result`)에서 단계를 읽는다. `step=result` 가 아니면 모두 회사 정보다. */
export function stepOfSearch(search: string): Step {
  return new URLSearchParams(search).get("step") === "result" ? "result" : "company";
}

/**
 * 주소 쿼리에 단계만 바꿔 돌려준다 — 다른 쿼리는 그대로 둔다.
 * 회사 정보 단계는 `step` 을 아예 뗀다(첫 진입 주소와 같게). 결과가 비면 빈 글자다.
 */
export function searchWithStep(search: string, step: Step): string {
  const params = new URLSearchParams(search);
  if (step === "result") params.set("step", "result");
  else params.delete("step");
  const text = params.toString();
  return text ? `?${text}` : "";
}

/** 창의 sessionStorage — 막힌 브라우저(사생활 보호·서버 그리기)에서는 접근만 해도 터지므로 null 로 돌려준다. */
export function sessionStorageOrNull(): ProfileStorage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * 사용자마다 나눈 저장소 — 열쇠 뒤에 `:사용자 구분값` 을 붙여 읽고 쓴다. 구분값이 없으면 null(저장·복원 안 함).
 * 같은 탭에서 로그아웃 뒤 다른 사람이 들어와도 앞사람이 입력한 고객 정보를 읽지 못한다(2026-10-07 독립 리뷰 P1).
 */
export function scopedProfileStorage(storage: ProfileStorage | null, scope: string | undefined): ProfileStorage | null {
  const who = scope?.trim();
  if (!storage || !who) return null;
  const keyOf = (k: string) => `${k}:${who}`;
  return {
    getItem: (k) => storage.getItem(keyOf(k)),
    setItem: (k, v) => storage.setItem(keyOf(k), v),
    removeItem: (k) => storage.removeItem(keyOf(k)),
  };
}

/** 사용자 구분 없이 저장하던 옛 칸을 지운다 — 이 판 전에 남은 값이 누구 것인지 알 수 없어서다. */
export function dropUnscopedProfile(storage: ProfileStorage | null): void {
  try {
    storage?.removeItem(PROFILE_STORAGE_KEY);
  } catch {
    /* 지울 수 없어도 사용자별 칸만 읽으므로 되살아나지 않는다 */
  }
}

/** 값이 진단 입력으로 쓸 수 있는 모양인가 — 글자·숫자·참거짓·글자 목록만 허용한다. */
function isProfileValue(v: unknown): boolean {
  if (typeof v === "string" || typeof v === "boolean") return true;
  if (typeof v === "number") return Number.isFinite(v);
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

/** 저장해 둔 회사 정보 읽기. 없거나·깨졌거나·읽다가 막히면 null (그때는 회사 정보 단계로 돌아간다). */
export function readStoredProfile(storage: ProfileStorage | null): BusinessProfile | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(PROFILE_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    if (!Object.values(parsed).every(isProfileValue)) return null;
    return parsed as BusinessProfile;
  } catch {
    return null;
  }
}

/** 회사 정보 저장 — 막혀 있으면 조용히 건너뛴다(새로 고침 복원만 못 할 뿐 화면은 그대로 돈다). */
export function writeStoredProfile(storage: ProfileStorage | null, profile: BusinessProfile): void {
  try {
    storage?.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profile));
  } catch {
    /* 저장소가 막혔거나 가득 찼다 — 복원만 안 될 뿐이다 */
  }
}

/** 저장해 둔 회사 정보 지우기(「다른 회사」). */
export function clearStoredProfile(storage: ProfileStorage | null): void {
  try {
    storage?.removeItem(PROFILE_STORAGE_KEY);
  } catch {
    /* 지울 수 없어도 화면 상태는 이미 비웠다 */
  }
}

/**
 * 첫 진입에서 무엇을 할까 — 주소가 결과 단계이고 저장된 회사 정보가 멀쩡하면 그 값으로 진단을 다시 돌린다.
 * 값이 없거나 깨졌으면 회사 정보 단계에 머문다.
 */
export function bootPlanOf(
  search: string,
  storage: ProfileStorage | null,
): { kind: "company" } | { kind: "rediagnose"; profile: BusinessProfile } {
  if (stepOfSearch(search) !== "result") return { kind: "company" };
  const profile = readStoredProfile(storage);
  return profile ? { kind: "rediagnose", profile } : { kind: "company" };
}

/** 결과 머리의 회사 요약 줄 — 상호·법인/개인·소재지·설립 연월·매출·직원 수. 있는 값만 순서대로 돌려준다. */
export function companySummaryOf(p: BusinessProfile): { name: string; chips: string[] } {
  const chips: string[] = [];
  const corp = corporationOf(p);
  if (corp !== null) chips.push(corp ? "법인" : "개인");
  const place = p.businessAddress?.trim() || [p.region, p.regionSigungu].filter(Boolean).join(" ");
  if (place) chips.push(place);
  const founded = /^(\d{4})-(\d{2})/.exec(p.foundedDate ?? "");
  if (founded) chips.push(`설립 ${founded[1]}.${founded[2]}`);
  if (typeof p.lastYearRevenueKrw === "number") chips.push(`매출 ${manwonToKorean(Math.round(p.lastYearRevenueKrw / 10_000))}`);
  if (typeof p.employeeCount === "number") chips.push(`직원 ${p.employeeCount}명`);
  return { name: p.companyName?.trim() ?? "", chips };
}
