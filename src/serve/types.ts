/**
 * 판정 통로 코어(`src/serve/`)가 앱에게서 받는 **주입 계약**.
 *
 * ★이 폴더의 코드는 **HTTP 도 DB 도 모른다.** 웹 응답(NextResponse)·로그인 확인·Prisma·
 *  AI SDK 는 전부 앱(ERP·랩)에 남고, 여기에는 「입력 → 결과 객체」만 있다.
 *  결과 객체를 HTTP 상태·코드·문구로 옮기는 대응표는 `README.md` 에 적혀 있다 —
 *  두 앱이 **같은 표**를 보고 감싸야 같은 공고가 화면마다 다르게 판정되지 않는다.
 *
 * ★왜 Prisma 를 직접 안 부르나: 앱마다 DB 계정이 다르다(ERP 는 전체, 랩은 공고·상품 읽기와
 *  자기 표 쓰기만). 코어가 Prisma 를 물면 랩이 ERP 의 고객 표까지 볼 수 있는 통로가 열린다.
 */

import type { BusinessProfile } from "../engine/match-engine";
import type { ConditionVerdict, MatchGrade } from "../engine/structure-types";

/** Prisma 의 `Prisma.sql` 태그와 같은 모양. 조각의 실제 타입은 앱이 정한다. */
export type SqlTag = (strings: TemplateStringsArray, ...values: unknown[]) => unknown;

/**
 * 코어가 쓰는 읽기·쓰기 창구.
 *
 * `sql`·`join`·`raw`·`queryRaw` 는 Prisma 의 `Prisma.sql`/`Prisma.join`/`Prisma.raw`/
 * `prisma.$queryRaw` 를 **그대로** 넣으면 된다. 나머지는 앱이 한 줄로 감싼다.
 */
export type ServeQuery = {
  sql: SqlTag;
  join: (parts: unknown[], sep: string) => unknown;
  raw: (s: string) => unknown;
  queryRaw<T>(fragment: unknown): Promise<T[]>;
  /** `prisma.policyAnnouncement.findMany` 에 상응. */
  findAnnouncements<T>(args: {
    where: unknown;
    select: unknown;
    orderBy?: unknown;
    take?: number;
    skip?: number;
  }): Promise<T[]>;
  /** `prisma.policyAnnouncement.findUnique({ where: { id }, select })` 에 상응. */
  findAnnouncement<T>(id: string, select: unknown): Promise<T | null>;
  countAnnouncements(where: unknown): Promise<number>;
  findProducts<T>(args: { where: unknown; select: unknown }): Promise<T[]>;
  groupAnnouncementsBySource(): Promise<Array<{ source: string; count: number }>>;
  groupProductsBySource(): Promise<Array<{ source: string; count: number }>>;
  /**
   * `prisma.policyAnnouncement.groupBy({ by: ["structureStatus","structureVersion"], _count: { _all: true } })`.
   * ★계획서의 `countAnnouncements` 여러 번으로는 못 만든다 — 원문이 **묶음 조회 한 번**이라
   *  세는 방식을 바꾸면 진행률 숫자가 달라진다(옮기기 원칙: 계산 변경 0).
   */
  groupAnnouncementsByStructure(): Promise<
    Array<{ structureStatus: string; structureVersion: number; count: number }>
  >;
  cacheGet(key: string): Promise<unknown | null>;
  cacheSet(key: string, value: unknown): Promise<void>;
  cacheListByPrefix(prefix: string): Promise<Array<{ key: string; value: unknown }>>;
};

/**
 * AI 판정 한 번 부르기 — 앱이 자기 열쇠·자기 SDK 로 부른다.
 *
 * `stopReason` 은 SDK 응답의 `stop_reason` 을 그대로 넘긴다(없으면 생략).
 * ★왜 여기까지 받나: 「거절(refusal)」·「답이 끊김(max_tokens)」을 사람 말로 옮기는 문구가
 *  코어에 있어야 두 앱의 오류 메시지가 갈리지 않는다.
 */
export type VerdictModelCall = (req: {
  system: string;
  user: string;
  schema: unknown;
  maxTokens: number;
}) => Promise<{ text: string; stopReason?: string | null }>;

/**
 * 판정 지시문 묶음 — 패키지 `src/ai/verdict.ts`(Task A1) 모듈을 **통째로** 넘기면 맞는다.
 *
 * ★왜 import 가 아니라 주입인가: 코어와 지시문은 서로 다른 태스크에서 옮겨진다.
 *  구조상으로만 맞으면 되므로(`import * as verdict from "@wedly/policy-match-shared/ai/verdict"`)
 *  두 사본이 따로 자라지 않고, 코어가 지시문 모듈의 존재에 묶이지도 않는다.
 */
export type VerdictPromptModule = {
  VERDICT_VERSION: number;
  VERDICT_SYSTEM: string;
  VERDICT_JSON_SCHEMA: unknown;
  VERDICT_STATUSES: readonly string[];
  buildVerdictUserPrompt: (input: VerdictPromptInputLike) => string;
};

/** `buildVerdictUserPrompt` 가 받는 입력 — 지시문 모듈의 `VerdictPromptInput` 과 **글자 단위로 같은 모양**. */
export type VerdictPromptInputLike = {
  title: string;
  agency: string;
  category: string;
  applyPeriodText: string;
  targetText: string;
  summary: string;
  benefitSummary: string;
  supportAmountText: string;
  conditions: { rawText: string; machineReadable: boolean }[];
  humanCheck: string[];
  structureIncomplete: boolean;
  profile: BusinessProfile;
  machine: { grade: MatchGrade; checks: { rawText: string; verdict: ConditionVerdict; note: string }[] };
  attachmentText?: string;
};

/** AI 판정 결과 — 지시문 모듈의 `VerdictResult` 와 같은 모양. */
export type VerdictCheckItemLike = { condition: string; status: string; note: string };
export type VerdictResultLike = {
  grade: MatchGrade;
  explanation: string;
  checklist: VerdictCheckItemLike[];
};
