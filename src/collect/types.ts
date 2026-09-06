// 수집기 공개 타입 + 앱 결합 주입 계약(CollectDeps).
//
// 경계 규칙(설계 §2): 이 보관함 안에는 「어느 앱인지」를 묻는 코드도, 앱 전용 경로 별칭 import 도 없다.
// 앱마다 다른 것(DB 읽기·쓰기·AI 호출)은 전부 `CollectDeps` 로 받아 `buildSources`·
// `buildProductSources`·`fillBoardDetail` 에 넘긴다.
import type { NormalizedAnnouncement } from "../engine/types";
import type { NormalizedProduct } from "./products/types";

// 엔진 타입 재수출 — 옮겨 온 형제·어댑터가 `./types`/`../types` 로 부르던 ERP 루트 껍데기
// (`policy-match/types.ts` → engine/types)를 이 자리에서 이어 준다. 그래서 `NormalizedAnnouncement`·
// `PolicyAttachment`·`attachmentKindOf`·`ATTACHMENT_KINDS`·`parseApplyPeriod`·`PolicySource` 등은
// 여기서도 나온다(수집기 파일들의 상대경로를 한 곳으로 모은다).
export * from "../engine/types";

// ── 수집원 타입 (ERP services/policy-match/sync.ts:28-49 에서 글자 그대로 옮김) ──

/**
 * 접수기간이 있는 **공고** 수집원. `PolicyAnnouncement` 에 저장하고 안 실려온 건 닫는다.
 * `kind` 를 안 적으면 이것이다 — 게시판·API 가 그대로 통과하게 두려는 기본값.
 */
export interface AnnouncementSyncSource {
  kind?: "announcement";
  name: string;
  fetchAll: () => Promise<NormalizedAnnouncement[]>;
  clockOnly?: true;
  staleAfterDays?: number;
}

/**
 * 접수기간이 없는 **상시 상품** 수집원(은행 사업자대출·정책자금·보증·서민금융·투자).
 * 저장 표가 `FinanceProduct` 라 저장·정리 방식이 통째로 다르다 — 닫기(closed) 대신 `active=false`,
 * 그래서 `staleAfterDays` 도 없다.
 */
export interface ProductSyncSource {
  kind: "product";
  name: string;
  fetchAll: () => Promise<NormalizedProduct[]>;
  clockOnly?: true;
}

/** 회차가 돌리는 수집원 한 곳 — 공고 아니면 상시 상품. `name` 은 회차 장부의 단계 이름이라 **겹치면 안 된다**. */
export type PolicyMatchSource = AnnouncementSyncSource | ProductSyncSource;

// ── 공고 갱신 페이로드 (ERP `Prisma.PolicyAnnouncementUncheckedUpdateInput` 대체) ──

/**
 * `detail-fill` 이 만들어 `CollectDeps.updateAnnouncement` 로 넘기는 **갱신할 칸들**.
 * `@prisma/client` 의 `Prisma.PolicyAnnouncementUncheckedUpdateInput` 를 이 보관함이 실제로
 * 쓰는 칸만 추려 옮긴 것 — Prisma 타입에 매이지 않게 한다(실제 write 는 앱이 한다).
 */
export interface PolicyAnnouncementUpdate {
  title?: string;
  wedlyCategory?: string;
  dedupKey?: string;
  status?: string;
  applyStart?: Date | null;
  applyEnd?: Date | null;
  applyPeriodText?: string;
  targetText?: string;
  attachments?: unknown;
  ruleStructure?: unknown;
  attachmentFillTriedAt?: Date | null;
  fundingGroup?: string;
  amountText?: string;
  amountMaxWon?: bigint | null;
  rateText?: string;
  rateMin?: number | null;
}

// ── 앱 결합 주입 계약 ──

/**
 * 앱이 넣어 주는 것들. 순수 판정 로직은 이 보관함, **읽기·쓰기·AI 호출은 전부 인자**.
 * (게시판 수집 `buildSources`·상품 수집 `buildProductSources`·상세 채움 `fillBoardDetail` 이 쓴다.
 *  고용24 번호 훑기는 자기 옵션(`FetchWork24Options`)으로 따로 받는다 — `buildSources` 밖이라서다.)
 */
export interface CollectDeps {
  /** 자가수리 규칙을 AI 한 번에 물어본다. 원문: 앱의 ai/client(anthropic haiku) 호출. */
  askModel: (prompt: string) => Promise<string>;
  /**
   * JsonCache 한 줄 읽기 — **열쇠 문자열은 이 보관함이 만든다**(`board-rule:<id>`·
   * `board-heal-cooldown:<id>`·`board-alert:<id>`·게시판 쪽수 장부 열쇠·`product-alert:<id>`).
   * 원문: `prisma.jsonCache.findUnique({ where: { key } })` 의 `.value`(없으면 null).
   */
  jsonCacheGet: (key: string) => Promise<unknown>;
  /** JsonCache 한 줄 쓰기. 원문: `prisma.jsonCache.upsert({ where:{key}, create:{key,value}, update:{value} })`. */
  jsonCacheSet: (key: string, value: unknown) => Promise<void>;
  /**
   * 급락 판정용 직전 열린 공고 수. 원문:
   * `prisma.policyAnnouncement.count({ where: { source, status:"open", lastSeenAt:{ gt: since } } })`.
   */
  countOpenAnnouncements: (source: string, since: Date) => Promise<number>;
  /** 공고 한 줄 무조건 갱신. 원문: `prisma.policyAnnouncement.update({ where:{id}, data })`. */
  updateAnnouncement: (id: string, data: PolicyAnnouncementUpdate) => Promise<void>;
  /**
   * **아직 본문이 빈 행일 때만** 갱신하고 쓴 줄 수를 돌려준다(0 이면 그사이 남이 채운 것).
   * 원문: `prisma.policyAnnouncement.updateMany({ where:{ id, targetText:"" }, data }).count`.
   */
  updateAnnouncementIfEmpty: (id: string, data: PolicyAnnouncementUpdate) => Promise<number>;
}
