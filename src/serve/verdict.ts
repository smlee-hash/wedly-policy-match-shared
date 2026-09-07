// AI 정밀 판정 — 상세 패널을 열 때 공고 1건만, 프로필별로 캐시.
// 실패해도 화면은 기계 대조 결과를 그대로 쓰면 되므로 오류를 정직하게 알린다(AI_FAILED).
//
// ★AI 를 실제로 부르는 것은 앱이다(`callModel`) — 열쇠·모델 SDK·하루 예산 장부가 앱마다 다르다.
//  여기 남는 것은 **캐시 열쇠 조성·지시문 조립·응답 검증**뿐이고, 그 셋이 갈리면
//  「전문가가 본 AI 판정」과 「직원이 본 것」이 달라진다.
import { createHash } from "crypto";
import {
  matchAnnouncement,
  parseBusinessProfile,
  readStoredStructure,
  type BusinessProfile,
} from "../engine/match-engine";
import { withRegionConditions } from "../engine/region-augment";
import type { MatchGrade } from "../engine/structure-types";
import { CURRENT_STRUCTURE_VERSION } from "./structure-status";
import type {
  ServeQuery,
  VerdictModelCall,
  VerdictPromptModule,
  VerdictResultLike,
} from "./types";

/** 앱이 AI 를 부를 때 쓰는 값 — 두 앱이 같은 모델·같은 상한으로 불러야 판정이 갈리지 않는다. */
export const VERDICT_MODEL = "claude-sonnet-5";
export const VERDICT_MAX_TOKENS = 4_096;
export const VERDICT_AI_TIMEOUT_MS = 120_000;
export const VERDICT_AI_EFFORT = "medium";

const CACHE_PREFIX = "policy-verdict";
/**
 * ★저장해 둔 판정은 **시간이 지난다고 버리지 않는다**
 * (2026-08-25 사장님 「한 번 요약한 자료를 매번 새로 요약할 필요가 없잖아」).
 * 예전엔 7일이 지나면 버렸는데, 열쇠에 이미 판정을 바꿀 것이 전부 들어 있다 —
 * 공고 재독 시각·첨부 지문·사업자 정보·지시문 판본. 하나라도 바뀌면 열쇠가 달라져 저절로 다시 부른다.
 * 날짜로 또 버리는 것은 **아무것도 안 바뀌었는데 8일째에 돈을 다시 내는** 것뿐이었다.
 */
const GRADES: readonly string[] = ["possible", "uncertain", "impossible"];

/**
 * 판정 지시문에 넣는 첨부 원문 상한.
 * 저장본(attachmentText)은 최대 20,000자라 통째로 넣으면 공고 1건 판정마다 지시문이 그만큼 길어진다
 * — 자격조건은 대개 앞부분(사업 개요·지원 대상)에 있으므로 앞 6,000자만 넣는다.
 * 잘랐다는 사실을 **표시로 남긴다** — 안 남기면 AI 가 「원문에 그 조건이 없다」고 단정할 수 있다.
 */
const ATTACHMENT_EXCERPT_CAP = 6_000;
const EXCERPT_CUT_MARK = "(발췌 — 이후 생략)";

/**
 * 첨부 원문을 지시문에 실어야 하는 공고인가.
 * **AI 가 이미 읽어 조건을 뽑아 둔 공고면 안 싣는다** — 그 조건이 곧 첨부의 요약이고,
 * 원문을 다시 실으면 같은 값을 두 번 사는 셈이다. 아직 덜 읽혔거나(needs_review)
 * 뽑힌 조건이 하나도 없으면 원문이 유일한 근거라 그때만 싣는다.
 */
export function structureNeedsRawText(
  status: string,
  version: number,
  structure: { conditions: unknown[]; humanCheck: unknown[] },
): boolean {
  if (status === "needs_review") return true;
  if (structure.conditions.length === 0) return true;
  // ★읽기 규칙 판본이 낡은 공고는 첨부를 싣는다(2026-08-25 적대적 리뷰 「중요 2」).
  // 판본 1 은 첨부를 정독하기 전 규칙이라, 저장된 조건이 **본문(평균 325자)만 보고 뽑은 것**일 수 있다.
  // 그걸 「첨부의 요약」으로 믿고 원문을 빼면, 첨부(평균 5,935자)에만 있는 제외 조건을 못 본 채
  // 「가능」이 나가고 캐시에 영구히 남는다. 실측(2026-08-25): 모집중 중 판본 1 이 337건.
  return version < CURRENT_STRUCTURE_VERSION;
}

function attachmentExcerpt(text: string | null | undefined): string | undefined {
  const t = (text ?? "").trim();
  if (!t) return undefined;
  if (t.length <= ATTACHMENT_EXCERPT_CAP) return t;
  return `${t.slice(0, ATTACHMENT_EXCERPT_CAP)}\n${EXCERPT_CUT_MARK}`;
}

/* 캐시 열쇠에 넣는 칸 — **판정에 쓰이는 값만**.
 * 상호·사업자번호는 판정에 안 쓰이는데 열쇠에 넣으면 이름 한 글자만 바꿔도 캐시를 비껴가
 * 같은 판정에 AI 값을 계속 물린다(2026-08-22 리뷰 8번). */
const MATCH_FIELDS = [
  "industry",
  "region",
  "foundedDate",
  "lastYearRevenueKrw",
  "employeeCount",
  "companyScale",
  "taxDelinquent",
  "hasCert",
  "hasPatent",
] as const;

/**
 * 첨부 원문 지문 — 길이와 앞 200자 해시.
 * 첨부는 구조화와 따로 다시 받을 수 있어 structuredAt 이 그대로여도 내용이 바뀔 수 있다.
 * 통째로 해시하면 20,000자를 매 요청 훑게 되므로 앞머리+길이로 갈음한다(2026-08-22 리뷰 6번).
 */
export function attachmentFingerprint(attachmentText: string | null | undefined): string {
  const t = (attachmentText ?? "").trim();
  if (!t) return "0:";
  const head = createHash("sha256").update(t.slice(0, 200)).digest("hex").slice(0, 16);
  return `${t.length}:${head}`;
}

/**
 * 공고+프로필이 같으면 같은 열쇠 — 칸 순서가 달라도 같게(정렬 뒤 해시).
 * 공고를 다시 읽었으면(structuredAt 이 바뀌거나 첨부 원문이 갱신되면) 옛 판정을 쓰지 않는다.
 */
export function cacheKeyOf(
  verdictVersion: number,
  announcementId: string,
  profile: BusinessProfile,
  structuredAt: Date | string | null | undefined,
  attachmentText: string | null | undefined,
): string {
  const picked: Record<string, unknown> = {};
  for (const k of MATCH_FIELDS) {
    const v = profile[k];
    if (v !== undefined) picked[k] = v;
  }
  const canonical = JSON.stringify(picked, Object.keys(picked).sort());
  const stamp = structuredAt ? new Date(structuredAt).toISOString() : "";
  const att = attachmentFingerprint(attachmentText);
  const hash = createHash("sha256")
    .update(`${verdictVersion}|${canonical || "{}"}|${stamp}|${att}`)
    .digest("hex")
    .slice(0, 16);
  return `${CACHE_PREFIX}:${announcementId}:${hash}`;
}

/** 모델이 준 글자를 JSON 으로 — 끊김·거절·빈 답을 사람 말로 가른다. */
export function readModelJson(res: { text: string; stopReason?: string | null }): unknown {
  if (res?.stopReason === "refusal") throw new Error("AI 가 이 내용을 다루기를 거절했습니다.");
  if (res?.stopReason === "max_tokens") throw new Error("판정 응답이 중간에 끊겼습니다.");
  const text = res?.text ?? "";
  if (!text.trim()) throw new Error("AI 응답이 비어 있습니다.");
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("AI 응답 형식이 올바르지 않습니다.");
  }
}

/** AI 산출물 검증. 등급·설명이 어긋나면 실패로 본다(체크리스트 항목만 안전하게 손질). */
export function parseVerdict(raw: unknown, statuses: readonly string[]): VerdictResultLike | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const grade = typeof o.grade === "string" && GRADES.includes(o.grade) ? (o.grade as MatchGrade) : null;
  const explanation = typeof o.explanation === "string" ? o.explanation.trim() : "";
  if (!grade || !explanation || !Array.isArray(o.checklist)) return null;
  const checklist: VerdictResultLike["checklist"] = [];
  for (const item of o.checklist) {
    if (!item || typeof item !== "object") continue;
    const it = item as Record<string, unknown>;
    const condition = typeof it.condition === "string" ? it.condition.trim() : "";
    if (!condition) continue;
    const status =
      typeof it.status === "string" && statuses.includes(it.status)
        ? it.status
        : "확인필요"; // 모르는 상태값을 충족으로 올리지 않는다
    checklist.push({ condition, status, note: typeof it.note === "string" ? it.note.trim() : "" });
  }
  return { grade, explanation, checklist };
}

type VerdictRow = {
  id: string;
  title: string;
  agency: string;
  category: string;
  applyPeriodText: string;
  targetText: string;
  summary: string;
  structure: unknown;
  structureStatus: string;
  structuredAt: Date | null;
  structureVersion: number;
  attachmentText: string | null;
  region: string;
};

/** 판정이 읽는 칸 — 지역 조건 보태기(withRegionConditions)에 쓰는 region 까지. */
export const VERDICT_SELECT = {
  id: true, title: true, agency: true, category: true, applyPeriodText: true,
  targetText: true, summary: true, structure: true, structureStatus: true, structuredAt: true,
  structureVersion: true, attachmentText: true,
  region: true,
} as const;

export type RunVerdictInput = { announcementId: unknown; profile: unknown };

export type RunVerdictDeps = {
  q: Pick<ServeQuery, "findAnnouncement" | "cacheGet" | "cacheSet">;
  prompt: VerdictPromptModule;
  /** 하루 예산 장부에 자리 잡기 — 0 이하면 안 부른다. */
  reserve: (by: string) => Promise<number>;
  /** 실제로 안 불렀을 때 자리 돌려주기. */
  refund: (by: string, n: number) => Promise<void>;
  callModel: VerdictModelCall;
  isBillingOrAuthError: (e: unknown) => boolean;
  /** 장부에 남길 사람 — ERP 는 이메일(없으면 id). */
  by: string;
  /** 하루 상한 문구에 쓰는 숫자(ERP 150). */
  dailyMax: number;
};

export type RunVerdictResult =
  | { status: "ok"; data: VerdictResultLike & { cached: boolean } }
  | { status: "bad_request"; message: string }
  | { status: "not_found"; message: string }
  | { status: "limit"; message: string }
  | { status: "ai_failed"; message: string };

export async function runVerdict(
  input: RunVerdictInput,
  deps: RunVerdictDeps,
): Promise<RunVerdictResult> {
  const announcementId = String(input?.announcementId ?? "").trim();
  if (!announcementId) return { status: "bad_request", message: "공고를 선택해 주세요." };

  const profile = parseBusinessProfile(input?.profile);

  const row = await deps.q.findAnnouncement<VerdictRow>(announcementId, VERDICT_SELECT);
  if (!row) return { status: "not_found", message: "공고를 찾을 수 없습니다." };

  const key = cacheKeyOf(
    deps.prompt.VERDICT_VERSION,
    announcementId,
    profile,
    row.structuredAt,
    row.attachmentText,
  );
  const cached = await readCache(deps, key);
  if (cached) return { status: "ok", data: { ...cached, cached: true } };

  // ★이 통로도 **같은 하루 예산 장부**를 지나간다(2026-08-25 사장님 「이 부분도 비용 개선」).
  // 캐시에 없을 때만 자리를 잡는다 — 캐시로 돌려준 것은 돈이 안 든다.
  if ((await deps.reserve(deps.by)) <= 0) {
    return {
      status: "limit",
      message: `오늘 AI 사용 상한(${deps.dailyMax}건)에 닿았습니다 — 내일 다시 시도하세요.`,
    };
  }

  // 추천 화면과 **같은 공용 함수**로 지역 조건을 보탠다 — AI 에게 넘기는 「기계 등급」이
  // 화면과 어긋나면 AI 가 잘못된 전제로 판단한다.
  const structure = withRegionConditions(readStoredStructure(row.structure), row);
  const machine = matchAnnouncement(structure, profile);

  let verdict: VerdictResultLike | null = null;
  try {
    const res = await deps.callModel({
      system: deps.prompt.VERDICT_SYSTEM,
      schema: deps.prompt.VERDICT_JSON_SCHEMA,
      maxTokens: VERDICT_MAX_TOKENS,
      user: deps.prompt.buildVerdictUserPrompt({
        title: row.title,
        agency: row.agency,
        category: row.category,
        applyPeriodText: row.applyPeriodText,
        targetText: row.targetText,
        summary: row.summary,
        benefitSummary: structure.benefitSummary,
        supportAmountText: structure.supportAmountText,
        conditions: structure.conditions.map((c) => ({
          rawText: c.rawText,
          machineReadable: c.machineReadable,
        })),
        humanCheck: structure.humanCheck,
        structureIncomplete: row.structureStatus === "needs_review",
        // ★첨부 원문은 **구조화가 덜 된 공고에만** 보낸다(2026-08-25 사장님 「이 부분도 비용 개선」).
        // AI 가 이미 읽어 조건을 뽑아 둔 공고라면 그 조건이 곧 첨부의 요약이라,
        // 원문 6,000자를 다시 실어 보내는 것은 같은 값을 두 번 사는 것이다.
        // 이 한 줄이 판정 한 번에 보내는 글자를 약 4분의 1로 줄인다.
        attachmentText: structureNeedsRawText(row.structureStatus, row.structureVersion, structure)
          ? attachmentExcerpt(row.attachmentText)
          : undefined,
        profile,
        machine: {
          grade: machine.grade,
          checks: machine.checks.map((c) => ({
            rawText: c.condition.rawText,
            verdict: c.verdict,
            note: c.note,
          })),
        },
      }),
    });
    verdict = parseVerdict(readModelJson(res), deps.prompt.VERDICT_STATUSES);
    if (!verdict) throw new Error("AI 응답 형식이 올바르지 않습니다.");
  } catch (err) {
    // ★환불은 **호출 자체가 안 나간 실패**에만(크레딧·열쇠 문제).
    // 답이 끊겼거나(max_tokens) 시간이 초과된 호출은 토큰이 **실제로 청구된다** —
    // 그걸 환불하면 「실패할 때마다 공짜로 다시 시도」가 되어 상한 밖으로 샌다
    // (2026-08-25 적대적 리뷰 「중요 1」).
    if (deps.isBillingOrAuthError(err)) await deps.refund(deps.by, 1);
    return {
      status: "ai_failed",
      message: `AI 정밀 판정에 실패했습니다 — ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  await writeCache(deps, key, verdict);
  return { status: "ok", data: { ...verdict, cached: false } };
}

async function readCache(deps: RunVerdictDeps, key: string): Promise<VerdictResultLike | null> {
  try {
    const value = await deps.q.cacheGet(key);
    if (value == null) return null;
    return parseVerdict(value, deps.prompt.VERDICT_STATUSES);
  } catch {
    // 캐시를 못 읽어도 판정 자체는 진행한다 — 앱이 자기 방식으로 일지에 남긴다.
    return null;
  }
}

async function writeCache(deps: RunVerdictDeps, key: string, verdict: VerdictResultLike): Promise<void> {
  try {
    await deps.q.cacheSet(key, verdict);
  } catch {
    // 저장 실패가 판정 결과를 막지 않는다.
  }
}
