// 정책별 고객사 통로 부르기 — 화면 부품은 이 함수만 쓴다. 부를 주소는 앱이 `endpoints` 로 넘긴다.
// `scope`(내 담당·전체)는 화면이 넘겼을 때만 주소에 싣는다 — 안 넘기면 서버(앱의 scopeOf)가 정한다. 업체 보기는 아예 싣지 않는다.
import type {
  AnnouncementListView,
  BucketCompaniesView,
  CompanyAnnouncementsView,
  ContactsView,
  DaysFilter,
  ExportView,
  ProgressResult,
  ScopeFilter,
  SummaryView,
} from "../../serve/policy-deadline/types";
import type { DeadlineEndpoints } from "./endpoints";

async function readJson<T>(response: Response, fallback: string): Promise<T> {
  const result = (await response.json().catch(() => null)) as
    | { success: true; data: T }
    | { success: false; error?: { message?: string } }
    | null;
  if (!response.ok || !result || !result.success) {
    throw new Error((result && !result.success && result.error?.message) || fallback);
  }
  return result.data;
}

async function getView<T>(read: string, params: Record<string, string>, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${read}?${new URLSearchParams(params).toString()}`, { cache: "no-store", signal });
  return readJson<T>(response, "공고 대조 결과를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
}

const flag = (value: boolean) => (value ? "1" : "0");

/** 담당 범위는 화면이 넘겼을 때만 싣는다. */
const withScope = (scope: ScopeFilter | undefined): Record<string, string> => (scope === undefined ? {} : { scope });

export function fetchAnnouncementList(
  endpoints: DeadlineEndpoints,
  q: { scope?: ScopeFilter; days: DaysFilter; hideEmpty: boolean },
  signal?: AbortSignal,
) {
  return getView<AnnouncementListView>(
    endpoints.read,
    { view: "list", ...withScope(q.scope), days: String(q.days), hideEmpty: flag(q.hideEmpty) },
    signal,
  );
}

export function fetchBucketCompanies(
  endpoints: DeadlineEndpoints,
  q: { scope?: ScopeFilter; bucketKey: string },
  signal?: AbortSignal,
) {
  return getView<BucketCompaniesView>(endpoints.read, { view: "bucket", ...withScope(q.scope), bucket: q.bucketKey }, signal);
}

/** 「연락 예정 업체」 거르기 — 업체 목록과 펼친 공고가 같은 값을 쓴다. */
export type ContactsQuery = { days: DaysFilter; includeUnstructured: boolean; includeProgress: boolean };

function contactParams(q: ContactsQuery): Record<string, string> {
  return { days: String(q.days), includeUnstructured: flag(q.includeUnstructured), includeProgress: flag(q.includeProgress) };
}

export function fetchContacts(endpoints: DeadlineEndpoints, q: ContactsQuery & { scope?: ScopeFilter }, signal?: AbortSignal) {
  return getView<ContactsView>(endpoints.read, { view: "contacts", ...withScope(q.scope), ...contactParams(q) }, signal);
}

/** 업체 하나의 공고 — 어떤 범위로도 보내지 않는다(그 사람이 볼 수 있는 전부는 앱의 scopeOf 가 정한다). */
export function fetchCompanyAnnouncements(
  endpoints: DeadlineEndpoints,
  q: ContactsQuery & { customerKey: string },
  signal?: AbortSignal,
) {
  return getView<CompanyAnnouncementsView>(endpoints.read, { view: "company", customerKey: q.customerKey, ...contactParams(q) }, signal);
}

export function fetchSummary(endpoints: DeadlineEndpoints, scope: ScopeFilter | undefined, signal?: AbortSignal) {
  return getView<SummaryView>(endpoints.read, { view: "summary", ...withScope(scope) }, signal);
}

/** 엑셀 줄 — `endpoints.export` 가 있을 때만 부른다(없으면 오류). */
export function fetchExport(
  endpoints: DeadlineEndpoints,
  q: { scope?: ScopeFilter; days: DaysFilter; fitOnly: boolean; category: string },
) {
  if (!endpoints.export) return Promise.reject(new Error("엑셀 내려받기를 쓸 수 없습니다."));
  const params: Record<string, string> = { view: "export", ...withScope(q.scope), days: String(q.days), fitOnly: flag(q.fitOnly) };
  if (q.category !== "") params.category = q.category;
  return getView<ExportView>(endpoints.export, params);
}

export async function postProgress(endpoints: DeadlineEndpoints, customerKey: string, bucketKey: string): Promise<ProgressResult> {
  const response = await fetch(endpoints.progress, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ customerKey, bucketKey }),
  });
  return readJson<ProgressResult>(response, "업무 현황에 넣지 못했습니다. 잠시 후 다시 시도해 주세요.");
}
