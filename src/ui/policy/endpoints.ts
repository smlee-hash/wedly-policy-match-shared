/**
 * 지원정책 매칭 화면이 **앱마다 다르게 받는 것**을 한자리에 모은 계약.
 *
 * 이 폴더의 부품 안에는 「어느 앱인지」를 묻는 코드가 한 줄도 없다. 통로 주소·앱에만 있는
 * 기능·화면에 끼워 넣을 조각은 전부 여기 정의한 세 묶음으로 **받는다**:
 *   · `PolicyMatchEndpoints` — 부를 통로 주소. **없는 주소는 그 단추·칸 자체를 안 그린다.**
 *   · `PolicyMatchSlots`     — 앱만 아는 조각을 끼워 넣는 자리(랩의 판정 피드백·수집원 신고).
 *   · `PolicyMatchFeatures`  — 앱이 대신 해 주는 일(엑셀 저장·오류 문구 읽기·여백).
 *
 * ★왜 「없으면 안 그린다」인가: 랩(`wedly-policy-lab`)엔 고객 표도, 상담 자료실도, 수집기도
 *  없다. 그런데 화면에 「기존 고객 검색」·「자료실에 질문 저장」·「지금 새로 받아오기」가 보이면
 *  외부 전문가에게 **있지도 않은 사내 기능**을 약속하는 셈이 된다. 그래서 주소를 안 넘기면
 *  그 자리는 존재 자체가 없다(그리지도, 부르지도 않는다).
 *
 * ★쓰는 쪽 주의: `endpoints` 는 **모듈 상수 하나**로 넘겨라(예: `ERP_POLICY_MATCH_ENDPOINTS`).
 *  화면이 상세 조회를 다시 걸지 말지는 「고른 공고가 바뀌었나」만 보고 정하고, 지도 심부름꾼은
 *  첫 그리기 때 주소를 한 번 붙잡는다 — 그리는 자리에서 객체를 새로 만들면 그 주소를 나중에
 *  바꿔도 반영되지 않는다(앱이 도중에 주소를 바꿀 일은 없다는 전제).
 */
import type { ReactNode } from "react";
import type { BusinessProfile } from "../../engine/match-engine";
import type { DirectoryStatus } from "../../funding/source-directory";
import type { VerdictResult } from "../../ai/verdict";
import type { DiagnoseItem } from "./PolicyMatchScreen";

export type PolicyMatchEndpoints = {
  fundingMap: string;            // POST
  announcements: string;         // GET ?q&status&page | ?dedupKey
  announcement: (id: string, opts?: { noAi?: boolean }) => string; // GET
  diagnose: string;              // POST
  sources: string;               // GET
  verdict?: string;              // POST — 없으면 「AI 판정」 단추 미표시
  breakthrough?: string;         // POST — 없으면 「돌파구」 미표시
  askInstructor?: string;        // POST — 없으면 「자료실에 질문 저장」 미표시
  sync?: string;                 // POST — 없으면 「지금 새로 받아오기」 미표시
  prefill?: string;              // GET ?query= — 없으면 고객 검색 칸 미표시
};

/** ERP 의 현재 절대경로 그대로 — ERP 껍데기가 이 상수를 넘긴다. */
export const ERP_POLICY_MATCH_ENDPOINTS: PolicyMatchEndpoints = {
  fundingMap: "/api/policy-match/funding-map",
  announcements: "/api/policy-match/announcements",
  announcement: (id, o) => `/api/policy-match/announcements/${encodeURIComponent(id)}${o?.noAi ? "?noAi=1" : ""}`,
  diagnose: "/api/policy-match/diagnose",
  sources: "/api/policy-match/sources",
  verdict: "/api/policy-match/verdict",
  breakthrough: "/api/policy-match/breakthrough",
  askInstructor: "/api/policy-match/ask-instructor",
  sync: "/api/policy-match/sync",
  prefill: "/api/policy-match/prefill",
};

export type VerdictFeedbackContext = {
  announcementId: string;
  title: string;
  item: DiagnoseItem | null;              // 규칙 판정(등급·검사 수)
  aiVerdict: VerdictResult | null;        // AI 판정(있을 때)
  profile: BusinessProfile | null;
  place: "card" | "detail";
};

export type PolicyMatchSlots = {
  /** 카드 아래·상세 머리에 그릴 판정 피드백 단추(랩만). 없으면 아무것도 안 그린다. */
  verdictFeedback?: (ctx: VerdictFeedbackContext) => ReactNode;
  /** 수집원 현황 상단 오른쪽 단추 자리(랩: 「빠진 수집원 신고」). */
  sourcesActions?: ReactNode;
  /** 수집원 현황 위 요약 카드 자리(랩: StatCard 4개). */
  sourcesHeader?: (summary: SourcesSummary) => ReactNode;
};

export type PolicyMatchFeatures = {
  /** 엑셀 내려받기 — 없으면 단추 미표시. ERP 는 downloadSheet 를 넘긴다. */
  exportSources?: (rows: DirectoryRow[], fileName: string) => Promise<void>;
  /** 응답 오류를 사람 말로 — 기본은 ERP 규약(errMsg). 일루아 DetailPanel 사본과의 차이 11줄이 이 한 축이다. */
  parseError?: (res: Response, body: unknown) => string;
  /** ERP 화면 오른쪽 아래 잠금 단추 여백(`pr-14`). 기본 "" */
  sourcesTrailingPaddingClass?: string;
  /**
   * 상세를 열면 서버가 AI 구조화를 시작하는 앱(ERP)이면 true(기본). 저장된 구조만 주는 앱(랩)은
   * false — 「읽는 중」 폴링·안내를 하지 않되 AI 판정 단추는 endpoints.verdict 로 따로 결정한다.
   */
  serverStructurizes?: boolean;
};

/**
 * 수집원 현황 표 한 줄 — `GET {endpoints.sources}` 응답의 `data.entries[]` 모양 그대로.
 * 판정 통로 코어(`serve/sources-summary`)가 만드는 값과 **같은 모양**이어야 한다.
 */
export interface DirectoryRow {
  id?: string;
  label: string;
  url: string;
  status: DirectoryStatus;
  note: string;
  count: number;
  lastSaved: number | null;
  lastError: string | null;
  /** 쪽수 상한에 걸렸는지. note 에 넣지 않는다 — note 가 있으면 회차 건수가 가려진다. null 은 모름. */
  hitCap?: boolean | null;
}

/**
 * 수집원 현황 머리 요약 — `GET {endpoints.sources}` 응답의 `data.summary` 모양 그대로.
 * 여섯 상태의 개수 + 마지막 회차 시각 + 마지막 꼬리(본문·첨부 채움) 시각.
 */
export interface SourcesSummary {
  connected: number;
  waiting: number;
  candidate: number;
  blocked: number;
  error: number;
  excluded: number;
  lastRanAt: string | null;
  /** 꼬리(본문·첨부 채움)는 회차와 따로 10분 틱마다 돈다 — 회차 시각으로는 그 진행이 안 보인다. */
  lastTailAt: string | null;
}
