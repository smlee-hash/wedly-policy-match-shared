import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * 「AI 판정 통로가 없으면 지도 서랍도 AI 를 약속하지 않는다」의 **배선**을 잰다
 * (2026-09-07 독립 리뷰 지적 3).
 *
 * ★왜 별도 파일에 mock 을 쓰나(솔직히 적어 둔다): 서랍은 `mapUi.openItem` 이 있을 때만 그려지는데,
 *  이 저장소엔 jsdom 이 없어(`vitest.config.ts` 주석 참조) `renderToStaticMarkup` 한 번으로는
 *  「지도 카드를 눌러 서랍을 연 뒤」 상태를 만들 수 없다. 그래서 **화면이 서랍에 실제로 넘기는 값**을
 *  가로채 잰다. 서랍이 그 값을 받아 무엇을 그리는지(=AI 글자 0건)는 `funding-drawer-render.test.tsx`
 *  가 실물로 그려서 잰다 — 둘이 합쳐야 한 바퀴가 닫힌다.
 */
const { drawerProps } = vi.hoisted(() => ({ drawerProps: [] as Array<Record<string, unknown>> }));

vi.mock("../FundingDrawer", () => ({
  default: (props: Record<string, unknown>) => {
    drawerProps.push(props);
    return null;
  },
}));

import PolicyMatchScreen from "./PolicyMatchScreen";
import { ERP_POLICY_MATCH_ENDPOINTS, type PolicyMatchEndpoints } from "./endpoints";

/** AI 판정 통로가 **없는** 앱 — 나머지 필수 주소 다섯만 있다. */
const AI없음: PolicyMatchEndpoints = {
  fundingMap: "/api/policy-match/funding-map",
  announcements: "/api/policy-match/announcements",
  announcement: (id) => `/api/policy-match/announcements/${encodeURIComponent(id)}`,
  diagnose: "/api/policy-match/diagnose",
  sources: "/api/policy-match/sources",
};

function lastDrawerProps(endpoints: PolicyMatchEndpoints): Record<string, unknown> {
  drawerProps.length = 0;
  renderToStaticMarkup(<PolicyMatchScreen endpoints={endpoints} />);
  expect(drawerProps.length, "서랍은 화면에 언제나 걸려 있다(item 이 없으면 스스로 안 그린다)").toBe(1);
  return drawerProps[0];
}

beforeEach(() => {
  drawerProps.length = 0;
});

describe("지도 서랍 배선 — AI 판정 통로 유무를 그대로 넘긴다", () => {
  it("verdict 주소가 없으면 aiVerdictAvailable=false 로 넘어간다", () => {
    expect(lastDrawerProps(AI없음).aiVerdictAvailable).toBe(false);
  });

  it("★대조군 — ERP 통로(verdict 있음)는 true 다(기존 동작 불변)", () => {
    expect(lastDrawerProps(ERP_POLICY_MATCH_ENDPOINTS).aiVerdictAvailable).toBe(true);
  });

  it("상세를 여는 손잡이는 두 경우 모두 그대로 넘어간다 — 없어지는 건 AI 문구뿐이다", () => {
    expect(typeof lastDrawerProps(AI없음).onOpenDetail).toBe("function");
    expect(typeof lastDrawerProps(ERP_POLICY_MATCH_ENDPOINTS).onOpenDetail).toBe("function");
  });
});
