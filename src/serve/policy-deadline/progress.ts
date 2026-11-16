/**
 * 「업무 현황에 추가」(진행) — 화면의 단추와 슬랙 단추가 함께 쓴다.
 * 그 업체에 공고 이름의 정부지원금 정책 진행을 만들고(할 일 「신청 마감」, 기한 = 공고 마감일), 진행 줄을 남긴다.
 * 앱이 공고 자료(`readTaskSource`)를 주면 단계·서류 전달 칸을 그 공고에 맞춰 만든다 — 공고에 없는 일은 지어내지 않는다.
 * 같은 업체 × 공고 묶음은 한 번만 — 두 번째부터는 처음 만든 정책을 돌려준다.
 *
 * ERP `services/policy-deadline/progress.ts` 를 그대로 옮기되 앱마다 다른 것만 주입으로 바꿨다:
 * 담당 확인(`isAssigned`)·정책 이름 같음 판정(`isSamePolicyName`). 정책 만들기·히스토리·진행 줄 저장은 원래부터 주입이다.
 */
import { GENERIC_TO_CHECK } from "../../engine/eligibility-review";
import { kstDateKey } from "./kst";
import { ensureStepIds, type StepGroup, type TrackStep } from "./step-ids";
import type { DeadlineBucket, ProgressResult, StoredProgress } from "./types";
import { isCustomerKey } from "./query";

export type { ProgressResult } from "./types";

export const PROGRESS_SECTION = "government-subsidy";
export const PROGRESS_TODO = "신청 마감";
/** 담당이 아닌 사람이 눌렀을 때 — 슬랙은 누른 사람에게만 이 글을 보인다. */
export const NOT_ASSIGNED_MESSAGE = "이 업체 담당자만 누를 수 있습니다.";

export interface ProgressActor {
  id: string;
  name: string;
  email: string;
  role: string;
}

/** 진행 거절 — 통로가 status·code·message 그대로 응답한다. */
export class DeadlineProgressError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "DeadlineProgressError";
  }
}

export interface ProgressTrack {
  id: string;
  customerKey: string;
  policyName: string;
  announcementId: string | null;
}

/** 진행에 쓰는 업체 칸 — 읽기용 업체 칸에서 열쇠·이름·담당 id 만 쓰고, 같은 업체의 다른 열쇠(별칭)가 더 있다. */
export interface ProgressCompany {
  customerKey: string;
  aliases: string[];
  companyName: string;
  readConsultantIds: string[];
}

/**
 * 새 업무를 공고에 맞춰 만들 자료 — 공고의 제출 서류(정리된 공고 `structure.documents`),
 * 그 업체 판정 줄의 확인할 조건(`toCheck`)·채울 칸(`gaps`).
 */
export interface ProgressTaskSource {
  documents: string[];
  toCheck: string[];
  gaps: string[];
}

/** 서류 전달 칸 한 줄 — 앱의 정책 진행 `docs` 칸과 같은 모양. */
export interface ProgressDoc {
  label: string;
  done: boolean;
}

export interface ProgressDeps {
  readCompany(customerKey: string): Promise<ProgressCompany | null>;
  /**
   * 이 사람이 이 업체의 진행을 눌러도 되나 — 앱이 정한다(예: 관리자이거나 업체 담당 id 에 내 id 가 있음).
   * 업체가 없으면 company 가 null 로 온다. 거짓이면 403 FORBIDDEN NOT_ASSIGNED_MESSAGE(없는 업체도 같은 403 — 있는지조차 알리지 않는다).
   */
  isAssigned(actor: ProgressActor, company: ProgressCompany | null): boolean | Promise<boolean>;
  /** 정책 이름이 같은 정책인가 — 정책 이름 맞춤 규칙은 앱의 정책 진행 쪽에 있다. */
  isSamePolicyName(a: string, b: string): boolean;
  /** 그 업체 × 묶음 판정 줄이 있나(맞음·확인 필요만 저장된다). */
  hasMatch(customerKey: string, bucketKey: string): Promise<boolean>;
  readBucket(bucketKey: string): Promise<DeadlineBucket | null>;
  /**
   * 새 업무를 공고에 맞춰 만들 자료 — 새로 만들 때만 읽는다. 없으면(앱이 안 넘김·null·실패) 「신청 마감」 한 칸으로 만든다.
   */
  readTaskSource?(customerKey: string, bucket: DeadlineBucket): Promise<ProgressTaskSource | null>;
  readProgress(customerKey: string, bucketKey: string): Promise<StoredProgress | null>;
  /** 정부지원금 정책 진행 중 customerKey 가 customerKeys 안인 것 — 만든 순서대로. */
  findTracks(customerKeys: string[]): Promise<ProgressTrack[]>;
  /** 같은 업체에 같은 이름 정책이 있으면 고유 키 충돌(code "P2002")을 던진다. */
  createTrack(input: {
    customerKey: string;
    policyName: string;
    announcementId: string | null;
    assignee: string;
    startedAt: Date;
    stepGroups: StepGroup[];
    /** 서류 전달 칸 — 공고 제출 서류(없으면 빈 목록). */
    docs: ProgressDoc[];
    companyName: string;
  }): Promise<{ id: string }>;
  /** 분야 히스토리 한 줄 — 실패해도 진행은 성공이다. */
  appendHistory(customerKey: string, text: string, author: string): Promise<void>;
  /** 같은 (업체, 묶음) 줄이 있으면 고유 키 충돌(code "P2002")을 던진다. */
  insertProgress(row: StoredProgress): Promise<void>;
}

/** 정책 이름 = 묶음 제목 앞뒤 공백 빼고 200자까지, 비면 "이름 없는 공고". */
export function policyNameOf(bucket: Pick<DeadlineBucket, "title">): string {
  return bucket.title.trim().slice(0, 200) || "이름 없는 공고";
}

/** 앞뒤 공백을 빼고 빈 줄·겹친 줄을 지운 목록(처음 나온 순서). */
function cleanLabels(labels: readonly string[]): string[] {
  return Array.from(new Set(labels.map((label) => label.trim()).filter(Boolean)));
}

const MAX_DOCS = 100;
const MAX_DOC_CHARS = 500;

/** 서류 전달 칸 = 공고 제출 서류(앞뒤 공백·빈 줄·겹침 빼고 100개·한 줄 500자까지, 모두 「안 받음」). 자료가 없으면 빈 목록. */
export function progressDocs(source: ProgressTaskSource | null | undefined): ProgressDoc[] {
  if (!source) return [];
  return cleanLabels(source.documents)
    .slice(0, MAX_DOCS)
    .map((label) => ({ label: label.slice(0, MAX_DOC_CHARS), done: false }));
}

/**
 * 새 정책의 단계 — 식별자는 ensureStepIds 로 붙인다. 기한은 「신청 마감」에만(공고 마감일), 나머지는 비운다.
 * 자료가 없으면 [「신청」: 「신청 마감」] 한 칸. 자료가 있으면 공고에 있는 것만으로:
 * 1) 「자격 확인」 — 조건 정리 전 공고면 「공고 원문에서 자격 조건 확인」, 그 업체의 확인할 조건 하나씩, 채울 칸이 있으면
 *    「업체 정보 채우기: 매출액 · 업력」. 하나도 없으면(조건이 다 맞음) 갈래를 두지 않는다.
 * 2) 「서류 준비」 — 공고 제출 서류가 있으면 「제출 서류 N개 준비」(목록은 서류 전달 칸), 없으면 「공고 원문에서 제출 서류 확인」.
 * 3) 「신청」 — 「신청 마감」.
 */
export function progressStepGroups(due: string, source?: ProgressTaskSource | null): StepGroup[] {
  const todo = (label: string, stepDue = ""): TrackStep => ({ label, status: "대기", due: stepDue });
  const apply: StepGroup = { name: "신청", steps: [todo(PROGRESS_TODO, due)] };
  if (!source) return ensureStepIds([apply]).groups;
  const toCheck = cleanLabels(source.toCheck);
  const gaps = cleanLabels(source.gaps);
  const checks = [
    ...(toCheck.some((label) => GENERIC_TO_CHECK.has(label)) ? ["공고 원문에서 자격 조건 확인"] : []),
    ...toCheck.filter((label) => !GENERIC_TO_CHECK.has(label)),
    ...(gaps.length ? [`업체 정보 채우기: ${gaps.join(" · ")}`] : []),
  ];
  const docCount = progressDocs(source).length;
  const groups: StepGroup[] = [
    ...(checks.length ? [{ name: "자격 확인", steps: checks.map((label) => todo(label)) }] : []),
    { name: "서류 준비", steps: [todo(docCount ? `제출 서류 ${docCount}개 준비` : "공고 원문에서 제출 서류 확인")] },
    apply,
  ];
  return ensureStepIds(groups).groups;
}

/** 공고 자료 — 앱이 안 넘기거나 읽다 실패하면 null(새 업무는 「신청 마감」 한 칸으로 만든다). */
/** 글자 목록만 남긴다 — 앱이 옛 모양 JSON(칸 없음·배열 아님)을 그대로 넘겨도 진행이 깨지지 않게. */
function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

async function readTaskSourceSafe(deps: ProgressDeps, customerKey: string, bucket: DeadlineBucket): Promise<ProgressTaskSource | null> {
  if (!deps.readTaskSource) return null;
  try {
    const source: unknown = await deps.readTaskSource(customerKey, bucket);
    if (!source || typeof source !== "object") return null;
    const raw = source as Record<string, unknown>;
    return { documents: stringList(raw.documents), toCheck: stringList(raw.toCheck), gaps: stringList(raw.gaps) };
  } catch {
    // 공고 자료는 업무를 채우는 덧붙임 — 못 읽어도 진행은 막지 않는다.
    return null;
  }
}

/**
 * 이을 정책 찾기 — 공고 id 가 묶음 announcementIds 안이거나, 이름이 isSamePolicyName(정책 이름, policyName) 인 첫 정책. 없으면 null.
 * 이름 비교는 앱마다 다르므로 비교 함수를 받는다.
 */
export function findLinkableTrack(
  tracks: ProgressTrack[],
  bucket: Pick<DeadlineBucket, "announcementIds">,
  policyName: string,
  isSamePolicyName: (a: string, b: string) => boolean,
): ProgressTrack | null {
  return (
    tracks.find(
      (track) =>
        (track.announcementId !== null && bucket.announcementIds.includes(track.announcementId)) ||
        isSamePolicyName(track.policyName, policyName),
    ) ?? null
  );
}

/** 고유 키 충돌(Prisma P2002)인가 — 오류 클래스 대신 code 칸만 본다(Prisma 를 가져오지 않는다). */
function isUniqueConflict(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

/** 할 일 기한 = 공고 마감의 KST 날짜, 상시(마감 없음)면 "". */
function dueOf(bucket: Pick<DeadlineBucket, "applyEnd">): string {
  return bucket.applyEnd ? kstDateKey(bucket.applyEnd) : "";
}

/** 저장된 진행 줄 → 응답의 progress 칸. */
function progressOf(row: StoredProgress): ProgressResult["progress"] {
  return { byName: row.byName, via: row.via, at: row.createdAt.toISOString() };
}

/**
 * 「진행」. 순서:
 * 1) readCompany. isAssigned 가 거짓이면 DeadlineProgressError(403, "FORBIDDEN", NOT_ASSIGNED_MESSAGE).
 *    통과했는데 업체가 없으면 (404, "NOT_FOUND", "업체를 찾지 못했습니다.").
 * 2) readProgress 가 있으면 그것을 돌려준다(created false, trackCreated false, policyName·due 는 묶음에서 — 묶음이 없으면 policyName "" due "").
 * 3) hasMatch 가 거짓이면 (404, "NOT_FOUND", "이 업체에 맞는 공고가 아닙니다."). readBucket 이 null 이면 (404, "NOT_FOUND", "공고를 찾지 못했습니다.").
 * 4) policyName = policyNameOf(묶음), due = 묶음 applyEnd 가 있으면 kstDateKey(applyEnd), 없으면 "".
 * 5) findTracks([업체 customerKey, ...aliases(겹친 것 빼고)]) → findLinkableTrack 이 있으면 그 정책에 잇는다(trackCreated false, 정책은 고치지 않는다).
 *    없으면 readTaskSource(업체 customerKey, 묶음)로 공고 자료를 읽어(없거나 실패면 null)
 *    createTrack({ customerKey, policyName, announcementId: 묶음 repAnnouncementId 가 비면 null,
 *    assignee: actor.email, startedAt: now, stepGroups: progressStepGroups(due, 자료), docs: progressDocs(자료), companyName }) (trackCreated true).
 *    createTrack 이 P2002 를 던지면 findTracks 를 다시 읽어 findLinkableTrack 으로 잇고(trackCreated false), 그래도 없으면 그 오류를 던진다.
 * 6) 새로 만들었을 때만 appendHistory(업체 customerKey, `[진행 정책] 「${policyName}」 진행을 시작했습니다. (정책별 고객사${via === "slack" ? " · 슬랙" : ""}에서 시작) · 담당 ${actor.email}`, actor.name)
 *    — 던져도 삼킨다.
 * 7) insertProgress({ customerKey, bucketKey, trackId, byUserId: actor.id, byName: actor.name, via, createdAt: now }).
 *    P2002 면 readProgress 를 다시 읽어 그 줄로 돌려준다(created false, trackCreated 는 5단계 값 그대로). 다시 읽어도 없으면 그 오류를 던진다.
 * 8) { created: true, trackCreated, trackId, policyName, companyName, todo: PROGRESS_TODO, due, progress: { byName, via, at: now ISO } }.
 */
export async function startDeadlineProgress(
  input: { customerKey: string; bucketKey: string; actor: ProgressActor; via: "web" | "slack" },
  now: Date,
  deps: ProgressDeps,
): Promise<ProgressResult> {
  const { bucketKey, actor, via } = input;

  const company = await deps.readCompany(input.customerKey);
  // 담당이 아니면 업체가 있는지도 알리지 않는다 — 없는 업체도 같은 403.
  if (!(await deps.isAssigned(actor, company))) {
    throw new DeadlineProgressError(403, "FORBIDDEN", NOT_ASSIGNED_MESSAGE);
  }
  if (!company) throw new DeadlineProgressError(404, "NOT_FOUND", "업체를 찾지 못했습니다.");
  const { customerKey, companyName } = company;

  // 이미 누가 진행했으면 그 줄을 그대로 — 정책·히스토리·진행 줄은 건드리지 않는다.
  const existing = await deps.readProgress(customerKey, bucketKey);
  if (existing) {
    const known = await deps.readBucket(bucketKey);
    return {
      created: false,
      trackCreated: false,
      trackId: existing.trackId,
      policyName: known ? policyNameOf(known) : "",
      companyName,
      todo: PROGRESS_TODO,
      due: known ? dueOf(known) : "",
      progress: progressOf(existing),
    };
  }

  if (!(await deps.hasMatch(customerKey, bucketKey))) {
    throw new DeadlineProgressError(404, "NOT_FOUND", "이 업체에 맞는 공고가 아닙니다.");
  }
  const bucket = await deps.readBucket(bucketKey);
  if (!bucket) throw new DeadlineProgressError(404, "NOT_FOUND", "공고를 찾지 못했습니다.");

  const policyName = policyNameOf(bucket);
  const due = dueOf(bucket);

  // 같은 업체의 다른 열쇠(별칭)에 이미 있는 정책도 같은 정책이다 — 겹친 열쇠는 한 번만 넘긴다.
  const customerKeys = Array.from(new Set([customerKey, ...company.aliases]));
  const findLinked = async () =>
    findLinkableTrack(await deps.findTracks(customerKeys), bucket, policyName, (a, b) => deps.isSamePolicyName(a, b));

  let trackId: string;
  let trackCreated = false;
  const linked = await findLinked();
  if (linked) {
    trackId = linked.id;
  } else {
    const source = await readTaskSourceSafe(deps, customerKey, bucket);
    try {
      const created = await deps.createTrack({
        customerKey,
        policyName,
        announcementId: bucket.repAnnouncementId || null,
        assignee: actor.email,
        startedAt: now,
        stepGroups: progressStepGroups(due, source),
        docs: progressDocs(source),
        companyName,
      });
      trackId = created.id;
      trackCreated = true;
    } catch (error) {
      if (!isUniqueConflict(error)) throw error;
      // 동시에 누가 먼저 만들었다 — 그 정책에 잇고, 그래도 안 보이면 원래 오류.
      const raced = await findLinked();
      if (!raced) throw error;
      trackId = raced.id;
    }
  }

  if (trackCreated) {
    try {
      await deps.appendHistory(
        customerKey,
        `[진행 정책] 「${policyName}」 진행을 시작했습니다. (정책별 고객사${via === "slack" ? " · 슬랙" : ""}에서 시작) · 담당 ${actor.email}`,
        actor.name,
      );
    } catch {
      // 히스토리는 부가 기능 — 실패해도 진행은 성공이다.
    }
  }

  try {
    await deps.insertProgress({ customerKey, bucketKey, trackId, byUserId: actor.id, byName: actor.name, via, createdAt: now });
  } catch (error) {
    if (!isUniqueConflict(error)) throw error;
    // 두 사람이 동시에 눌렀다 — 먼저 남긴 줄을 돌려주고, 줄이 안 보이면 원래 오류.
    const first = await deps.readProgress(customerKey, bucketKey);
    if (!first) throw error;
    return { created: false, trackCreated, trackId: first.trackId, policyName, companyName, todo: PROGRESS_TODO, due, progress: progressOf(first) };
  }

  return {
    created: true,
    trackCreated,
    trackId,
    policyName,
    companyName,
    todo: PROGRESS_TODO,
    due,
    progress: { byName: actor.name, via, at: now.toISOString() },
  };
}

/** 「업무 현황에 추가」 POST 본문이 맞지 않을 때의 글자 — 400 BAD_REQUEST. */
export const PROGRESS_BAD_BODY_MESSAGE = "업체와 공고를 골라 주세요.";

/**
 * 「업무 현황에 추가」 POST 본문 해석(`await req.json().catch(() => null)` 결과를 그대로 넘긴다).
 * 맞지 않으면 DeadlineProgressError(400, "BAD_REQUEST", PROGRESS_BAD_BODY_MESSAGE) — 통로가 다른 진행 거절과 같은 자리에서 응답한다.
 */
export function readProgressBody(body: unknown): { customerKey: string; bucketKey: string } {
  const bad = () => new DeadlineProgressError(400, "BAD_REQUEST", PROGRESS_BAD_BODY_MESSAGE);
  if (typeof body !== "object" || body === null) throw bad();
  const { customerKey, bucketKey } = body as { customerKey?: unknown; bucketKey?: unknown };
  if (typeof customerKey !== "string" || !isCustomerKey(customerKey)) throw bad();
  if (typeof bucketKey !== "string") throw bad();
  const key = bucketKey.trim();
  if (!key || key.length > 300) throw bad();
  return { customerKey, bucketKey: key };
}
