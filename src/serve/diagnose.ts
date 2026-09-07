// 진단 — 모집중 공고를 무료 사전필터(마감·지역)로 좁힌 뒤 저장된 구조·규칙으로 대조한다.
// 정밀 판정(verdict/breakthrough)은 건드리지 않는다. 지연 AI 읽기는 2026-08-29 설계로 제거.
import {
  checkCondition,
  matchAnnouncement,
  parseBusinessProfile,
  readStoredStructure,
  type BusinessProfile,
  type MatchResult,
} from "../engine/match-engine";
import { withRegionConditions } from "../engine/region-augment";
import { extractConditions, ruleGradeOf } from "../engine/rule-extract";
import type { MatchGrade } from "../engine/structure-types";
import { prefilter } from "./raw-prefilter";
import { isCurrentStructure, structureProgress, type StructureProgress } from "./structure-status";
import type { ServeQuery } from "./types";

export interface DiagnoseItem {
  announcementId: string;
  title: string;
  agency: string;
  category: string;
  applyEnd: string | null;
  applyPeriodText: string;
  grade: MatchGrade;
  needsReview: boolean;
  /** 아직 AI 로 안 읽음. 읽었는데 애매함(needsReview)과 화면에서 가른다. */
  unanalyzed?: boolean;
  /** AI 없이 규칙(글자 패턴)만으로 판정했다 — 촘촘함이 덜하다. */
  ruleOnly?: boolean;
  failSummary: string;
  checks: { total: number; pass: number; fail: number; unknown: number; humanCheck: number };
}

type Row = {
  id: string;
  title: string;
  agency: string;
  category: string;
  applyEnd: Date | null;
  applyPeriodText: string;
  structure: unknown;
  structureStatus: string;
  region: string;
  structureVersion: number;
};

/**
 * 목록에서 읽는 칸. **원문(요약·대상·첨부)은 여기 넣지 않는다.**
 * 예전엔 첨부 원문까지 전 행에 걸어 두어, 진단 한 번에 모집중 공고 전량의 첨부(옛 행은 최대
 * 20,000자)를 서버 메모리로 끌어왔다 — 공고가 늘수록 무한히 커지는 대기 경로였다
 * (2026-08-25 적대적 리뷰 「중요 3」). 원문은 **규칙 판정이 실제로 필요한 몇 건만** 따로 받는다.
 */
export const ANN_SELECT = {
  id: true,
  title: true,
  agency: true,
  category: true,
  applyEnd: true,
  applyPeriodText: true,
  structure: true,
  structureStatus: true,
  region: true,
  structureVersion: true,
} as const;

/** 규칙 추출(무료)이 볼 원문 — AI 를 안 부르고 조건을 뽑는 데 쓴다. */
export const RULE_TEXT_SELECT = {
  id: true,
  summary: true,
  targetText: true,
  attachmentText: true,
} as const;

type RuleText = { id: string; summary: string | null; targetText: string | null; attachmentText: string | null };

/** 불가 사유 한 줄 — 첫 어긋난 조건을 적고 나머지는 개수로 줄인다. */
function failSummaryOf(m: MatchResult): string {
  const fails = m.checks.filter((c) => c.verdict === "fail");
  if (fails.length === 0) return "";
  const first = fails[0];
  const why = first.note || first.condition.rawText;
  return fails.length > 1 ? `${why} 외 ${fails.length - 1}건` : why;
}

function toItem(row: Row, profile: BusinessProfile, now: Date): DiagnoseItem {
  // ruleStructure 는 여기서 읽지 않는다(적대 리뷰 2026-08-29 중요4) — 이 화면은 pending 을
  // 실시간 무료 추출(ruleOnly)로 판정하므로 죽은 갈래였고, 실패 스텁(_structureError)이
  // 진짜 조건을 가리는 함정 + 모집중 전 행의 JSONB 를 매 진단마다 끌어오는 비용만 남는다.
  // 추천(3차)은 상태 기반 공용 판별로 따로 설계한다.
  const structureSource = row.structure;
  // 추천·AI판정과 **같은 공용 함수**로 지역 조건을 보탠다 — 화면마다 판정이 갈리지 않게.
  const s = withRegionConditions(readStoredStructure(structureSource), { title: row.title ?? "", agency: row.agency ?? "", region: row.region ?? "" });
  const m = matchAnnouncement(s, profile, now);
  const needsReview = row.structureStatus === "needs_review";
  // 구조화가 덜 끝난 공고(needs_review)는 조건이 빠졌을 수 있다 — 「가능」으로 올리지 않는다.
  const grade: MatchGrade = needsReview && m.grade === "possible" ? "uncertain" : m.grade;
  return {
    announcementId: row.id,
    title: row.title,
    agency: row.agency,
    category: row.category,
    applyEnd: row.applyEnd ? new Date(row.applyEnd).toISOString() : null,
    applyPeriodText: row.applyPeriodText,
    grade,
    needsReview,
    failSummary: grade === "impossible" ? failSummaryOf(m) : "",
    checks: {
      total: m.checks.length,
      pass: m.checks.filter((c) => c.verdict === "pass").length,
      fail: m.checks.filter((c) => c.verdict === "fail").length,
      unknown: m.checks.filter((c) => c.verdict === "unknown").length,
      humanCheck: m.humanCheck.length,
    },
  };
}

/**
 * 공고에서 규칙이 읽을 글자 — 제목·요약·대상·첨부를 한 덩이로 본다.
 * 줄바꿈으로 잇는다 — 공백으로 이으면 제목 끝과 요약 앞이 **한 문장으로 붙어**
 * 「업력 3년」과 무관한 뒷문장의 숫자를 끌어올 수 있다(2026-08-25 적대적 리뷰).
 */
function ruleTextOf(row: Row, t: RuleText | undefined): string {
  return [row.title ?? "", t?.summary ?? "", t?.targetText ?? "", t?.attachmentText ?? ""].join("\n");
}

/**
 * AI 가 읽기를 끝낸 공고인가 — **읽기 규칙 판본이 낡았어도 저장된 조건은 살아 있다.**
 *
 * 낡았다고 그 결과를 버리면 안 된다(2026-08-25 적대적 리뷰 「중요 4」). 옛 판본에
 * 「상시근로자 5인 이하」가 저장돼 직원 50명 회사를 「불가」로 걸러 주던 공고가, 버려지는 순간
 * 규칙 판정으로 내려가 근거를 통째로 잃는다. 실측(2026-08-25 운영 DB): 모집중 공고 중
 * 판본이 낡은 것이 **575건**이라 그냥 넘길 수가 없다.
 *
 * 규칙 조건을 여기에 섞지 않는다 — 규칙이 잘못 뽑은 조건 하나가 어긋나면 AI 가 제대로 읽어 둔
 * 공고를 **「불가」로 지워** 버린다. AI 가 읽은 공고는 AI 가 읽은 것만으로 판정한다.
 */
function wasReadByAi(row: Row): boolean {
  return row.structureStatus === "done" || row.structureStatus === "needs_review";
}

/**
 * AI 가 아직 안 읽은 공고를 **규칙만으로** 판정한다 — 돈이 안 든다.
 * 규칙은 「불가」를 못 내린다(ruleGradeOf) — 글자만 보는 추출이라 받을 수 있는 공고를 지우면 안 된다.
 */
function toRuleItem(
  row: Row,
  text: RuleText | undefined,
  profile: BusinessProfile,
  now: Date,
): DiagnoseItem {
  const conditions = extractConditions(ruleTextOf(row, text));
  const checks = conditions.map((c) => checkCondition(c, profile, now));
  const grade = ruleGradeOf(checks);
  return {
    announcementId: row.id,
    title: row.title,
    agency: row.agency,
    category: row.category,
    applyEnd: applyEndIso(row.applyEnd),
    applyPeriodText: row.applyPeriodText,
    grade,
    // 「조건 확인 필요」(AI 가 읽었는데 애매함)와는 다른 상태다 — 화면이 「간이 판정」으로 따로 알린다.
    needsReview: false,
    ruleOnly: true,
    failSummary: "",
    checks: {
      total: checks.length,
      pass: checks.filter((c) => c.verdict === "pass").length,
      fail: checks.filter((c) => c.verdict === "fail").length,
      unknown: checks.filter((c) => c.verdict === "unknown").length,
      humanCheck: 0,
    },
  };
}

function applyEndIso(v: Date | string | null): string | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** 마감 임박순. 마감일이 없는 공고는 맨 뒤(순서를 못 정하니 앞에 세우지 않는다). */
function byDeadline(a: { applyEnd: string | null; title: string }, b: { applyEnd: string | null; title: string }): number {
  if (a.applyEnd && b.applyEnd) return a.applyEnd < b.applyEnd ? -1 : a.applyEnd > b.applyEnd ? 1 : a.title.localeCompare(b.title);
  if (a.applyEnd) return -1;
  if (b.applyEnd) return 1;
  return a.title.localeCompare(b.title);
}

// 「아직 분석 안 됨」을 만들던 toUnanalyzed 는 지웠다 — 이제 AI 가 안 읽은 공고도
// 규칙으로 「간이 판정」이 나오므로 이 상태가 생기지 않는다(2026-08-25 구조 전환).
// 화면(ResultList)의 `unanalyzed` 갈래는 남겨 둔다 — 옛 응답이 떠 있는 창을 위한 방어다.

export type DiagnoseData = {
  possible: DiagnoseItem[];
  uncertain: DiagnoseItem[];
  impossible: DiagnoseItem[];
  structureProgress: StructureProgress;
  analyzedCount: number;
  candidateCount: number;
  droppedByRegion: number;
};

export type DiagnoseResult =
  | { ok: true; data: DiagnoseData }
  | { ok: false; code: "BAD_PROFILE"; message: string };

/**
 * 진단 한 번.
 *
 * `now` 를 안 넘기면 ERP 원문과 **똑같이** 두 시각을 따로 잡는다 —
 * 사전필터는 `new Date()`, 대조는 `new Date(Date.now())`(가짜 시계 시험이 이 갈래를 본다).
 * 시험·랩에서 시각을 고정하고 싶으면 `now` 를 넘긴다.
 *
 * 진단 기록 저장(ERP `PolicyDiagnosis` · 랩 `PolicyLabDiagnosis`)은 **앱 몫**이다 —
 * 표 이름이 앱마다 다르고, 실패해도 진단 결과는 그대로 돌려줘야 한다.
 */
export async function runDiagnose(
  profileInput: unknown,
  q: Pick<ServeQuery, "findAnnouncements" | "groupAnnouncementsByStructure">,
  now?: Date,
): Promise<DiagnoseResult> {
  const profile = parseBusinessProfile(profileInput);

  const rows = await q.findAnnouncements<Row>({
    where: { status: "open" },
    select: ANN_SELECT,
  });

  const prefilterNow = now ?? new Date();
  let droppedByRegion = 0;
  const candidates: Row[] = [];
  for (const row of rows) {
    const decision = prefilter(
      { applyEnd: row.applyEnd, region: row.region ?? "", title: row.title ?? "" },
      profile,
      prefilterNow,
    );
    // 마감으로 뺀 건은 여기 넣지 않는다 — 지역으로 빠진 수만.
    if (decision === "drop-region") droppedByRegion += 1;
    if (decision === "keep") candidates.push(row);
  }
  candidates.sort((a, b) => byDeadline(
    { applyEnd: applyEndIso(a.applyEnd), title: a.title },
    { applyEnd: applyEndIso(b.applyEnd), title: b.title },
  ));

  // 지연 AI 읽기는 2026-08-29 설계(§8)로 제거 — 진단·추천은 AI 0원.
  // 구조를 채우는 길은 무료 추출(ruleStructure, 저장 때 자동)과 관리자 수동 배치(structurize POST)뿐.

  // 대조 시각은 루프가 끝난 뒤 Date.now() 로 다시 잡는다.
  // new Date() 는 가짜 시계(Date.now 스파이)를 안 따라가 자정·마감 경계 시험을 통과하지 못한다.
  const matchNow = now ?? new Date(Date.now());
  // 규칙 판정이 필요한 공고의 **원문만** 따로 받는다 — 전 행에 첨부를 걸면 요청 하나가 수십 MB 가 된다.
  const needRuleText = candidates.filter((r) => !isCurrentStructure(r) && !wasReadByAi(r));
  const ruleTexts = new Map<string, RuleText>();
  if (needRuleText.length > 0) {
    const texts = await q.findAnnouncements<RuleText>({
      where: { id: { in: needRuleText.map((r) => r.id) } },
      select: RULE_TEXT_SELECT,
    });
    for (const t of texts) ruleTexts.set(t.id, t);
  }

  const buckets: Record<MatchGrade, DiagnoseItem[]> = { possible: [], uncertain: [], impossible: [] };
  let analyzedCount = 0;
  for (const row of candidates) {
    if (isCurrentStructure(row)) {
      analyzedCount += 1;
      const item = toItem(row, profile, matchNow);
      buckets[item.grade].push(item);
    } else if (wasReadByAi(row)) {
      // 판본만 낡았을 뿐 AI 가 읽어 둔 공고 — 저장된 조건 그대로 판정한다.
      // 버리면 저장돼 있던 「불가」 근거가 사라진다.
      analyzedCount += 1;
      const item = toItem(row, profile, matchNow);
      buckets[item.grade].push(item);
    } else {
      // AI 가 한 번도 안 읽은 공고 — **규칙으로 공짜 판정**한다. 「아직 분석 안 됨」으로 버리지 않는다.
      const item = toRuleItem(row, ruleTexts.get(row.id), profile, matchNow);
      buckets[item.grade].push(item);
    }
  }
  for (const g of Object.keys(buckets) as MatchGrade[]) buckets[g].sort(byDeadline);

  const progress = await structureProgress(q);

  return {
    ok: true,
    data: {
      possible: buckets.possible,
      uncertain: buckets.uncertain,
      impossible: buckets.impossible,
      structureProgress: progress,
      analyzedCount,
      candidateCount: candidates.length,
      droppedByRegion,
    },
  };
}
