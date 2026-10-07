"use client";

// ② 매칭 결과의 오른쪽 상세 칸 본문 — 고른 항목의 종류로 갈린다.
//  · 공고(announcement) → 기존 DetailPanel(조건 맞춰 보기·AI 판정·돌파구·피드백·강사 문의). 진단 결과는 refId 로 이어 판정 근거를 넘긴다.
//  · 상시 상품(product) → 기존 FundingDrawer 의 본문(서랍 껍데기 없이 inline). 상품은 상세 통로가 없다.
// 공고 상세의 요약 3칸·대조표·일정·첨부는 DetailPanel(detail-structured)이 그린다. 목록 줄과 같은 판정(fitVerdict)을 머리 이름표로 넘긴다.
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
        fitVerdict={item.fitVerdict}
        hasDiagnosis={hasDiagnosis}
        serverStructurizes={features?.serverStructurizes ?? true}
        frame="pane"
        showSources={features?.showSourceNames ?? false}
      />
    );
  }
  // ★`aiVerdictAvailable` 은 다른 자리(「AI 판정」 단추·돌파구)와 같은 규칙이다 — 통로가 없는 앱에서는
  //  상품 본문도 AI 를 약속하지 않는다(2026-09-07 독립 리뷰 지적 3). 껍데기가 없으니 닫기는 쓰지 않는다.
  // 칸이 바닥 여백을 두지 않으므로(상세의 고정 줄이 바닥에 붙게) 상품 본문은 여기서 바닥 여백을 준다.
  return (
    <div className="pb-4 min-[821px]:pb-6">
      <FundingDrawer inline item={item} onClose={NOOP} aiVerdictAvailable={!!endpoints.verdict} showSources={features?.showSourceNames ?? false} />
    </div>
  );
}
