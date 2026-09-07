import { describe, expect, it, vi } from "vitest";
import { ANN_SELECT, RULE_TEXT_SELECT, runDiagnose } from "./diagnose";
import { CURRENT_STRUCTURE_VERSION } from "./structure-status";
import type { AnnouncementStructure, StructuredCondition } from "../engine/structure-types";

/**
 * ★마감일은 「오늘부터 며칠 뒤」로 잡는다 — 달력 날짜를 박아 두면 그날이 지나는 순간
 * 시험이 스스로 깨져 저장소를 함께 쓰는 사람들의 배포가 막힌다(ERP 2026-08-25 실측).
 */
const 며칠뒤 = (n: number) => new Date(Date.now() + n * 24 * 60 * 60 * 1000);
const 기본_마감일 = 며칠뒤(60);

function cond(over: Partial<StructuredCondition> = {}): StructuredCondition {
  return { key: "region", op: "in", value: ["서울"], rawText: "서울 소재", machineReadable: true, ...over };
}
function structure(over: Partial<AnnouncementStructure> = {}): AnnouncementStructure {
  return {
    benefitSummary: "자금 지원",
    supportAmountText: "1억원",
    aiSummary: { purpose: "", target: "", scale: "", scaleItems: [] },
    conditions: [],
    humanCheck: [],
    documents: [],
    verified: true,
    ...over,
  };
}
function row(id: string, s: unknown, over: Record<string, unknown> = {}) {
  return {
    id,
    title: `공고 ${id}`,
    agency: "중기부",
    category: "금융",
    applyEnd: 기본_마감일,
    applyPeriodText: "2026-08-01 ~ 2026-09-30",
    structure: s,
    structureStatus: "done",
    structureVersion: CURRENT_STRUCTURE_VERSION,
    region: "서울",
    ...over,
  };
}

const PROFILE = { companyName: "위들리테크", region: "서울", employeeCount: 10 };

/** 첫 조회는 목록(ANN_SELECT), 둘째 조회는 규칙 원문(RULE_TEXT_SELECT). */
function makeQ(rows: unknown[], ruleTexts: unknown[] = [], progressRows: unknown[] = []) {
  const findAnnouncements = vi.fn(async (args: { select: unknown }) =>
    args.select === RULE_TEXT_SELECT ? ruleTexts : rows,
  );
  const groupAnnouncementsByStructure = vi.fn(async () => progressRows);
  return { q: { findAnnouncements, groupAnnouncementsByStructure } as never, findAnnouncements, groupAnnouncementsByStructure };
}

describe("runDiagnose — 읽는 칸", () => {
  it("모집중 전량을 목록 칸으로 읽고 원문(요약·대상·첨부)은 안 읽는다", async () => {
    const { q, findAnnouncements } = makeQ([]);
    await runDiagnose(PROFILE, q);
    expect(findAnnouncements).toHaveBeenCalledTimes(1);
    const arg = findAnnouncements.mock.calls[0][0] as { where: unknown; select: unknown };
    expect(arg.where).toEqual({ status: "open" });
    expect(arg.select).toBe(ANN_SELECT);
    expect((ANN_SELECT as Record<string, unknown>).summary).toBeUndefined();
    expect((ANN_SELECT as Record<string, unknown>).attachmentText).toBeUndefined();
  });

  it("규칙 판정이 필요한 공고의 원문만 따로 받는다 — 필요 없으면 두 번째 조회가 없다", async () => {
    const { q, findAnnouncements } = makeQ([row("a", structure())]);
    await runDiagnose(PROFILE, q);
    expect(findAnnouncements).toHaveBeenCalledTimes(1);
  });

  it("AI 가 한 번도 안 읽은 공고가 있으면 그 id 만 두 번째 조회로 받는다", async () => {
    const rows = [
      row("done1", structure()),
      row("new1", null, { structureStatus: "pending", structureVersion: 0 }),
    ];
    const { q, findAnnouncements } = makeQ(rows, [
      { id: "new1", summary: "상시근로자 5인 이상", targetText: "", attachmentText: "" },
    ]);
    await runDiagnose(PROFILE, q);
    expect(findAnnouncements).toHaveBeenCalledTimes(2);
    const second = findAnnouncements.mock.calls[1][0] as { where: { id: { in: string[] } }; select: unknown };
    expect(second.where.id.in).toEqual(["new1"]);
    expect(second.select).toBe(RULE_TEXT_SELECT);
  });
});

describe("runDiagnose — 판정", () => {
  it("가능·애매·불가 3묶음으로 나눈다", async () => {
    const { q } = makeQ([
      row("ok", structure({ conditions: [cond()] })),
      row("no", structure({ conditions: [cond({ value: ["부산"], rawText: "부산 소재" })] })),
    ]);
    const r = await runDiagnose(PROFILE, q);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.possible.map((x) => x.announcementId)).toEqual(["ok"]);
    expect(r.data.impossible.map((x) => x.announcementId)).toEqual(["no"]);
    expect(r.data.analyzedCount).toBe(2);
    expect(r.data.candidateCount).toBe(2);
  });

  it("불가에는 사유 한 줄과 조건 수 요약이 붙고, 가능에는 사유가 없다", async () => {
    const { q } = makeQ([
      row("no", structure({ conditions: [cond({ value: ["부산"], rawText: "부산 소재" }), cond({ value: ["대구"], rawText: "대구 소재" })] })),
      row("ok", structure({ conditions: [cond()] })),
    ]);
    const r = await runDiagnose(PROFILE, q);
    if (!r.ok) throw new Error("실패");
    const no = r.data.impossible[0];
    expect(no.failSummary).toContain("외 1건");
    expect(no.checks.total).toBe(2);
    expect(r.data.possible[0].failSummary).toBe("");
  });

  it("needs_review 공고는 전부 통과해도 가능이 아니라 애매로 내린다", async () => {
    const { q } = makeQ([row("r", structure({ conditions: [cond()] }), { structureStatus: "needs_review" })]);
    const r = await runDiagnose(PROFILE, q);
    if (!r.ok) throw new Error("실패");
    expect(r.data.possible).toHaveLength(0);
    expect(r.data.uncertain.map((x) => x.announcementId)).toEqual(["r"]);
    expect(r.data.uncertain[0].needsReview).toBe(true);
  });

  it("needs_review 라도 어긋나는 조건이 있으면 불가 그대로", async () => {
    const { q } = makeQ([
      row("r", structure({ conditions: [cond({ value: ["부산"], rawText: "부산 소재" })] }), { structureStatus: "needs_review" }),
    ]);
    const r = await runDiagnose(PROFILE, q);
    if (!r.ok) throw new Error("실패");
    expect(r.data.impossible.map((x) => x.announcementId)).toEqual(["r"]);
  });

  it("판본이 낡은 done 은 저장된 조건 그대로 판정하고 분석 수에 센다 — 버리지 않는다", async () => {
    const { q, findAnnouncements } = makeQ([
      row("old", structure({ conditions: [cond({ value: ["부산"], rawText: "부산 소재" })] }), { structureVersion: 1 }),
    ]);
    const r = await runDiagnose(PROFILE, q);
    if (!r.ok) throw new Error("실패");
    expect(r.data.analyzedCount).toBe(1);
    expect(r.data.impossible.map((x) => x.announcementId)).toEqual(["old"]);
    expect(findAnnouncements).toHaveBeenCalledTimes(1); // 규칙 원문을 안 받는다
  });

  it("★AI 가 안 읽은 공고는 규칙으로 공짜 판정 — ruleOnly 표식이 붙고 불가가 안 된다", async () => {
    const { q } = makeQ(
      [row("new1", null, { structureStatus: "pending", structureVersion: 0 })],
      [{ id: "new1", summary: "상시근로자 100명 이상 기업", targetText: "", attachmentText: "" }],
    );
    const r = await runDiagnose(PROFILE, q);
    if (!r.ok) throw new Error("실패");
    const all = [...r.data.possible, ...r.data.uncertain, ...r.data.impossible];
    expect(all).toHaveLength(1);
    expect(all[0].ruleOnly).toBe(true);
    expect(all[0].needsReview).toBe(false);
    expect(r.data.impossible).toHaveLength(0); // 규칙은 「불가」를 못 내린다
    expect(r.data.analyzedCount).toBe(0);
  });

  it("마감 임박순으로 내려주고 마감일 없는 공고는 뒤로 보낸다", async () => {
    const { q } = makeQ([
      row("none", structure({ conditions: [cond()] }), { applyEnd: null }),
      row("late", structure({ conditions: [cond()] }), { applyEnd: 며칠뒤(40) }),
      row("soon", structure({ conditions: [cond()] }), { applyEnd: 며칠뒤(2) }),
    ]);
    const r = await runDiagnose(PROFILE, q);
    if (!r.ok) throw new Error("실패");
    expect(r.data.possible.map((x) => x.announcementId)).toEqual(["soon", "late", "none"]);
  });
});

describe("runDiagnose — 사전필터", () => {
  it("마감 지남·타지역 전용은 후보에서 뺀다. 마감으로 뺀 건은 droppedByRegion 에 안 센다", async () => {
    const { q } = makeQ([
      row("keep", structure({ conditions: [cond()] })),
      row("closed", structure(), { applyEnd: 며칠뒤(-1) }),
      row("other", structure(), { region: "부산" }),
    ]);
    const r = await runDiagnose(PROFILE, q);
    if (!r.ok) throw new Error("실패");
    expect(r.data.candidateCount).toBe(1);
    expect(r.data.droppedByRegion).toBe(1);
    expect(r.data.possible.map((x) => x.announcementId)).toEqual(["keep"]);
  });

  it("프로필이 없어도 오류가 아니라 전부 「모름」으로 대조한다", async () => {
    const { q } = makeQ([row("a", structure({ conditions: [cond()] }))]);
    const r = await runDiagnose(undefined, q);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.candidateCount).toBe(1);
    expect(r.data.uncertain.map((x) => x.announcementId)).toEqual(["a"]);
  });
});

describe("runDiagnose — 진행률·시각", () => {
  it("구조화 진행률을 그대로 함께 내려준다", async () => {
    const { q } = makeQ([], [], [
      { structureStatus: "done", structureVersion: CURRENT_STRUCTURE_VERSION, count: 3 },
      { structureStatus: "pending", structureVersion: 0, count: 2 },
    ]);
    const r = await runDiagnose(PROFILE, q);
    if (!r.ok) throw new Error("실패");
    expect(r.data.structureProgress).toEqual({ total: 5, done: 3, pending: 2, needsReview: 0, failed: 0 });
  });

  it("now 를 안 넘기면 대조 시각을 Date.now() 로 잡는다 — 가짜 시계를 따라간다", async () => {
    const spy = vi.spyOn(Date, "now");
    try {
      const { q } = makeQ([
        // 「설립 3년 이내」 — 대조 시각이 바뀌면 판정이 갈린다.
        row("a", structure({ conditions: [cond({ key: "businessAgeMaxYears", op: "lte", value: 3, rawText: "업력 3년 이내" })] }), {
          region: "전국",
        }),
      ]);
      spy.mockReturnValue(new Date("2026-09-07T00:00:00Z").getTime());
      const near = await runDiagnose({ ...PROFILE, foundedDate: "2025-01-01" }, q);
      if (!near.ok) throw new Error("실패");
      expect(near.data.possible).toHaveLength(1);

      spy.mockReturnValue(new Date("2036-09-07T00:00:00Z").getTime());
      const far = await runDiagnose({ ...PROFILE, foundedDate: "2025-01-01" }, q);
      if (!far.ok) throw new Error("실패");
      expect(far.data.impossible).toHaveLength(1);
    } finally {
      spy.mockRestore();
    }
  });
});
