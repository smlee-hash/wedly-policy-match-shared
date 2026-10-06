"use client";

// ② 매칭 결과의 오른쪽 상세 칸 본문 — 고른 항목의 종류로 갈린다.
//  · 공고(announcement) → 기존 DetailPanel(조건 맞춰 보기·AI 판정·돌파구·피드백·강사 문의). 진단 결과는 refId 로 이어 판정 근거를 넘긴다.
//  · 상시 상품(product) → 기존 FundingDrawer 의 본문(서랍 껍데기 없이 inline). 상품은 상세 통로가 없다.
// 상세 칸의 재구성(요약 3칸·대조표)은 다음 묶음(C3) 몫이라 여기서는 기존 부품을 그대로 옮겨 그리기만 한다.
import type { ReactNode } from "react";
import type { BusinessProfile } from "../../engine/match-engine";
import type { FundingItem } from "../../funding/funding-map";
import FundingDrawer from "../FundingDrawer";
import DetailPanel from "./DetailPanel";
import type { PolicyMatchEndpoints, PolicyMatchFeatures, VerdictFeedbackContext } from "./endpoints";
import type { DiagnoseItem } from "./PolicyMatchScreen";

const NOOP = () => {};

export default function ResultDetail({
  item, endpoints, features, verdictFeedback, profile, profileNonce, diagnoseById, hasDiagnosis,
}: {
  item: FundingItem;
  endpoints: PolicyMatchEndpoints;
  features?: PolicyMatchFeatures;
  /** 상세 머리에 끼울 판정 피드백(랩만, place:"detail" 은 DetailPanel 이 정한다). */
  verdictFeedback?: (ctx: VerdictFeedbackContext) => ReactNode;
  profile: BusinessProfile;
  profileNonce: number;
  /** 진단 결과를 공고 번호(refId)로 찾는 표 — 판정 근거를 DetailPanel 로 넘긴다. */
  diagnoseById: ReadonlyMap<string, DiagnoseItem>;
  hasDiagnosis: boolean;
}) {
  if (item.kind === "announcement") {
    return (
      <DetailPanel
        endpoints={endpoints}
        parseError={features?.parseError}
        verdictFeedback={verdictFeedback}
        announcementId={item.refId}
        mode="diagnosed"
        profile={profile}
        profileNonce={profileNonce}
        item={diagnoseById.get(item.refId) ?? null}
        hasDiagnosis={hasDiagnosis}
        serverStructurizes={features?.serverStructurizes ?? true}
      />
    );
  }
  // ★`aiVerdictAvailable` 은 다른 자리(「AI 판정」 단추·돌파구)와 같은 규칙이다 — 통로가 없는 앱에서는
  //  상품 본문도 AI 를 약속하지 않는다(2026-09-07 독립 리뷰 지적 3). 껍데기가 없으니 닫기는 쓰지 않는다.
  return <FundingDrawer inline item={item} onClose={NOOP} aiVerdictAvailable={!!endpoints.verdict} />;
}
