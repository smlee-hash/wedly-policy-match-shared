// 정책별 고객사 통로 부르기(NO.789) — 정렬(sort)은 넘겼을 때만 주소에 싣고, 「해당 없음」은 앱이 dismiss 주소를 줬을 때만 보낸다.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchAnnouncementList,
  fetchCompanyAnnouncements,
  fetchContacts,
  fetchExport,
  postDismiss,
} from "./deadline-api";
import { DEADLINE_DISMISS_ENDPOINT, DEADLINE_ENDPOINTS, type DeadlineEndpoints } from "./endpoints";
import { jsonResponse } from "./test-kit";

const fetchMock = vi.fn();
const urls = () => fetchMock.mock.calls.map(([input]) => String(input));
const WITH_EXPORT: DeadlineEndpoints = { ...DEADLINE_ENDPOINTS, export: "/api/x/export" };
const WITH_DISMISS: DeadlineEndpoints = { ...DEADLINE_ENDPOINTS, dismiss: DEADLINE_DISMISS_ENDPOINT };

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(() => Promise.resolve(jsonResponse({ success: true, data: {} })));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("정렬 싣기", () => {
  it("넘기면 sort 를 싣고, 안 넘기면 싣지 않는다(서버 기본은 맞을 확률 순)", async () => {
    await fetchAnnouncementList(DEADLINE_ENDPOINTS, { days: 7, hideEmpty: true, sort: "deadline" });
    await fetchAnnouncementList(DEADLINE_ENDPOINTS, { days: 7, hideEmpty: true });
    expect(urls()).toEqual([
      "/api/policy-track/deadline?view=list&days=7&hideEmpty=1&sort=deadline",
      "/api/policy-track/deadline?view=list&days=7&hideEmpty=1",
    ]);
  });

  it("연락 예정 업체·업체 공고도 같은 자리(거르기 뒤)에 싣는다 · 단계(tiers)는 싣지 않는다(화면이 거른다)", async () => {
    const q = { days: 7, includeUnstructured: true, includeProgress: false, sort: "tier" } as const;
    await fetchContacts(DEADLINE_ENDPOINTS, { ...q, scope: "mine" });
    await fetchCompanyAnnouncements(DEADLINE_ENDPOINTS, { ...q, customerKey: "b:123" });
    expect(urls()).toEqual([
      "/api/policy-track/deadline?view=contacts&scope=mine&days=7&includeUnstructured=1&includeProgress=0&sort=tier",
      "/api/policy-track/deadline?view=company&customerKey=b%3A123&days=7&includeUnstructured=1&includeProgress=0&sort=tier",
    ]);
  });

  it("엑셀은 fitOnly 뒤 · category 앞", async () => {
    await fetchExport(WITH_EXPORT, { days: 30, fitOnly: false, category: "정책자금", sort: "tier" });
    await fetchExport(WITH_EXPORT, { days: 30, fitOnly: true, category: "" });
    expect(urls()).toEqual([
      "/api/x/export?view=export&days=30&fitOnly=0&sort=tier&category=%EC%A0%95%EC%B1%85%EC%9E%90%EA%B8%88",
      "/api/x/export?view=export&days=30&fitOnly=1",
    ]);
  });
});

describe("해당 없음 보내기", () => {
  it("기본 주소에는 dismiss 가 없다 — 통로를 만든 앱이 DEADLINE_DISMISS_ENDPOINT 를 더해 켠다", () => {
    expect(DEADLINE_ENDPOINTS.dismiss).toBeUndefined();
    expect(DEADLINE_DISMISS_ENDPOINT).toBe("/api/policy-track/deadline/dismiss");
  });

  it("업체·공고·사유를 POST 로 보내고 결과(dismissed)를 돌려준다 · 되돌리기는 사유 null", async () => {
    const dismissed = { reason: "자격이 안 됨", byName: "김지현", at: "2026-11-20T00:00:00.000Z" };
    fetchMock.mockImplementationOnce(() => Promise.resolve(jsonResponse({ success: true, data: { dismissed } })));
    await expect(postDismiss(WITH_DISMISS, "b:1", "B1", "자격이 안 됨")).resolves.toEqual({ dismissed });
    fetchMock.mockImplementationOnce(() => Promise.resolve(jsonResponse({ success: true, data: { dismissed: null } })));
    await expect(postDismiss(WITH_DISMISS, "b:1", "B1", null)).resolves.toEqual({ dismissed: null });

    expect(fetchMock.mock.calls.map(([input, init]) => [String(input), (init as RequestInit).method, JSON.parse(String((init as RequestInit).body))])).toEqual([
      ["/api/policy-track/deadline/dismiss", "POST", { customerKey: "b:1", bucketKey: "B1", reason: "자격이 안 됨" }],
      ["/api/policy-track/deadline/dismiss", "POST", { customerKey: "b:1", bucketKey: "B1", reason: null }],
    ]);
    expect((fetchMock.mock.calls[0][1] as RequestInit).headers).toEqual({ "Content-Type": "application/json" });
  });

  it("서버 오류 글이 있으면 그 글, 없으면 기본 안내", async () => {
    fetchMock.mockImplementationOnce(() =>
      Promise.resolve(jsonResponse({ success: false, error: { code: "FORBIDDEN", message: "담당 업체만 바꿀 수 있습니다." } }, 403)),
    );
    await expect(postDismiss(WITH_DISMISS, "b:1", "B1", "기타")).rejects.toThrow("담당 업체만 바꿀 수 있습니다.");
    fetchMock.mockImplementationOnce(() => Promise.resolve(new Response("x", { status: 500 })));
    await expect(postDismiss(WITH_DISMISS, "b:1", "B1", "기타")).rejects.toThrow("해당 없음으로 남기지 못했습니다. 잠시 후 다시 시도해 주세요.");
  });

  it("앱이 dismiss 주소를 주지 않으면 부르지 않고 거절한다", async () => {
    const noDismiss: DeadlineEndpoints = { read: "/r", progress: "/p" };
    await expect(postDismiss(noDismiss, "b:1", "B1", "기타")).rejects.toThrow("해당 없음을 남길 수 없습니다.");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
