import { describe, expect, it } from "vitest";
import { ERP_POLICY_MATCH_ENDPOINTS, type PolicyMatchEndpoints, type PolicyMatchFeatures } from "./endpoints";

describe("주소 계약 — 서류 올리기 통로", () => {
  it("ERP 주소 묶음에 서류 올리기 주소가 있다", () => {
    expect(ERP_POLICY_MATCH_ENDPOINTS.documentPrefill).toBe("/api/policy-match/document-prefill");
  });

  it("서류 올리기 주소는 없어도 되는 통로다 — 안 넘긴 앱은 올리기 칸이 없다", () => {
    // 필수 통로 다섯만 있어도 계약을 지킨다(랩이 이 모양으로 넘긴다).
    const lab: PolicyMatchEndpoints = {
      fundingMap: "/api/policy-match/funding-map",
      announcements: "/api/policy-match/announcements",
      announcement: (id) => `/api/policy-match/announcements/${id}`,
      diagnose: "/api/policy-match/diagnose",
      sources: "/api/policy-match/sources",
    };
    expect(lab.documentPrefill).toBeUndefined();
  });

  it("앞서 있던 통로 주소는 그대로다", () => {
    expect(ERP_POLICY_MATCH_ENDPOINTS.prefill).toBe("/api/policy-match/prefill");
    expect(ERP_POLICY_MATCH_ENDPOINTS.diagnose).toBe("/api/policy-match/diagnose");
    expect(ERP_POLICY_MATCH_ENDPOINTS.fundingMap).toBe("/api/policy-match/funding-map");
    expect(ERP_POLICY_MATCH_ENDPOINTS.sync).toBe("/api/policy-match/sync");
  });

  it("documentPrefillMode 는 attach·lab 두 값만 받는다", () => {
    const attach: PolicyMatchFeatures = { documentPrefillMode: "attach" };
    const lab: PolicyMatchFeatures = { documentPrefillMode: "lab" };
    const none: PolicyMatchFeatures = {};
    expect(attach.documentPrefillMode).toBe("attach");
    expect(lab.documentPrefillMode).toBe("lab");
    expect(none.documentPrefillMode).toBeUndefined();
  });
});
