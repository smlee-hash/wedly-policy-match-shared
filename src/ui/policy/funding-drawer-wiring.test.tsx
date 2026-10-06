import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * 「AI 판정 통로가 없으면 상품 본문도 AI 를 약속하지 않는다」의 **배선**을 잰다
 * (2026-09-07 독립 리뷰 지적 3).
 *
 * ★바뀐 것(C2, 결과 목록 하나로 합치기): 예전엔 지도 카드를 눌러 연 서랍(`mapUi.openItem`)을 화면이 `FundingDrawer` 에 넘겼다.
 *  지도 보기가 없어지면서 상품은 오른쪽 상세 칸(`ResultDetail`)이 서랍 껍데기 없이(inline) 같은 본문을 그린다.
 *  그래서 「화면이 서랍에 실제로 넘기는 값」을 가로채던 자리가 `ResultDetail` 로 옮겨 왔다.
 *
 * ★왜 mock 을 쓰나(솔직히 적어 둔다): 이 저장소엔 jsdom 이 없어(`vitest.config.ts` 주석 참조) 「목록 줄을 누른 뒤」 상태를
 *  `renderToStaticMarkup` 한 번으로는 만들 수 없다. 그래서 **상세 칸이 부품에 실제로 넘기는 값**을 가로채 잰다.
 *  부품이 그 값을 받아 무엇을 그리는지(=AI 글자 0건)는 `funding-drawer-render.test.tsx` 가 실물로 그려서 잰다 —
 *  둘이 합쳐야 한 바퀴가 닫힌다.
 */
const { drawerProps } = vi.hoisted(() => ({ drawerProps: [] as Array<Record<string, unknown>> }));

vi.mock("../FundingDrawer", () => ({
  default: (props: Record<string, unknown>) => {
    drawerProps.push(props);
    return null;
  },
}));
vi.mock("./DetailPanel", () => ({ default: () => null }));

import ResultDetail from "./ResultDetail";
import { ERP_POLICY_MATCH_ENDPOINTS, type PolicyMatchEndpoints } from "./endpoints";
import type { FundingItem } from "../../funding/funding-map";

/** AI 판정 통로가 **없는** 앱 — 나머지 필수 주소 다섯만 있다. */
const AI없음: PolicyMatchEndpoints = {
  fundingMap: "/api/policy-match/funding-map",
  announcements: "/api/policy-match/announcements",
  announcement: (id) => `/api/policy-match/announcements/${encodeURIComponent(id)}`,
  diagnose: "/api/policy-match/diagnose",
  sources: "/api/policy-match/sources",
};

const 상품 = {
  id: "p:1", kind: "product", refId: "1", group: "bank", title: "예시 상품", agency: "예시은행", url: "", applyUrl: "",
  targetText: "", amountText: "", amountMaxWon: null, rateText: "", rateMin: null,
  deadline: { kind: "always", date: null, text: "상시", dDay: null },
  where: "", fit: [], fitVerdict: "fit", humanCheck: 0, score: 1, why: "", source: "product-kbank", isNew: false,
} as FundingItem;

function lastDrawerProps(endpoints: PolicyMatchEndpoints): Record<string, unknown> {
  drawerProps.length = 0;
  renderToStaticMarkup(
    <ResultDetail item={상품} endpoints={endpoints} profile={{}} profileNonce={1} diagnoseById={new Map()} hasDiagnosis />,
  );
  expect(drawerProps.length, "상품을 고르면 상세 칸이 본문을 한 번 그린다").toBe(1);
  return drawerProps[0];
}

beforeEach(() => {
  drawerProps.length = 0;
});

describe("상품 상세 배선 — AI 판정 통로 유무를 그대로 넘긴다", () => {
  it("verdict 주소가 없으면 aiVerdictAvailable=false 로 넘어간다", () => {
    expect(lastDrawerProps(AI없음).aiVerdictAvailable).toBe(false);
  });

  it("★대조군 — ERP 통로(verdict 있음)는 true 다(기존 동작 불변)", () => {
    expect(lastDrawerProps(ERP_POLICY_MATCH_ENDPOINTS).aiVerdictAvailable).toBe(true);
  });

  it("두 경우 모두 서랍 껍데기 없이(inline) 그린다 — 상품은 공고 상세로 건너갈 길이 없다", () => {
    expect(lastDrawerProps(AI없음).inline).toBe(true);
    expect(lastDrawerProps(ERP_POLICY_MATCH_ENDPOINTS).inline).toBe(true);
    expect(lastDrawerProps(ERP_POLICY_MATCH_ENDPOINTS).onOpenDetail).toBeUndefined();
  });
});
