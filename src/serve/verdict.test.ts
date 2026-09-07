import { describe, expect, it, vi } from "vitest";
import {
  VERDICT_MAX_TOKENS,
  VERDICT_SELECT,
  attachmentFingerprint,
  cacheKeyOf,
  parseVerdict,
  readModelJson,
  runVerdict,
  structureNeedsRawText,
  type RunVerdictDeps,
} from "./verdict";
import { CURRENT_STRUCTURE_VERSION } from "./structure-status";
import type { VerdictPromptModule } from "./types";

const STATUSES = ["충족", "미충족", "확인필요"] as const;

/** 지시문 모듈 흉내 — 실물(`ai/verdict`)과 **같은 모양**이면 그대로 꽂힌다. */
const prompt: VerdictPromptModule = {
  VERDICT_VERSION: 1,
  VERDICT_SYSTEM: "너는 판정 컨설턴트다",
  VERDICT_JSON_SCHEMA: { type: "object" },
  VERDICT_STATUSES: STATUSES,
  buildVerdictUserPrompt: (input) => `제목: ${input.title}|첨부: ${input.attachmentText ?? "(없음)"}`,
};

const OK_JSON = JSON.stringify({
  grade: "possible",
  explanation: "받을 수 있습니다.",
  checklist: [{ condition: "서울 소재", status: "충족", note: "본사가 서울" }],
});

function row(over: Record<string, unknown> = {}) {
  return {
    id: "a1", title: "공고", agency: "중기부", category: "금융", applyPeriodText: "8/1~9/30",
    targetText: "대상", summary: "개요", structure: null, structureStatus: "done",
    structuredAt: new Date("2026-09-01T00:00:00Z"), structureVersion: CURRENT_STRUCTURE_VERSION,
    attachmentText: null, region: "서울",
    ...over,
  };
}

function deps(over: Partial<RunVerdictDeps> = {}, rowValue: unknown = row(), cacheValue: unknown = null) {
  const cacheSet = vi.fn(async (_key: string, _value: unknown) => {});
  const callModel = vi.fn(async (_req: { system: string; user: string; schema: unknown; maxTokens: number }) => ({ text: OK_JSON }));
  const reserve = vi.fn(async () => 1);
  const refund = vi.fn(async () => {});
  const base: RunVerdictDeps = {
    q: {
      findAnnouncement: vi.fn(async () => rowValue),
      cacheGet: vi.fn(async () => cacheValue),
      cacheSet,
    } as never,
    prompt,
    reserve,
    refund,
    callModel,
    isBillingOrAuthError: () => false,
    by: "a@b.c",
    dailyMax: 150,
    ...over,
  };
  return { d: base, cacheSet, callModel, reserve, refund };
}

describe("attachmentFingerprint — 첨부 지문", () => {
  it("비면 0:", () => {
    expect(attachmentFingerprint(null)).toBe("0:");
    expect(attachmentFingerprint("   ")).toBe("0:");
  });
  it("길이와 앞 200자 해시로 만든다 — 뒤가 달라도 앞·길이가 같으면 같다", () => {
    const head = "가".repeat(200);
    expect(attachmentFingerprint(`${head}뒤1`)).toBe(attachmentFingerprint(`${head}뒤2`));
    expect(attachmentFingerprint(`${head}뒤`)).not.toBe(attachmentFingerprint(`${head}뒤뒤`));
  });
});

describe("cacheKeyOf — 캐시 열쇠", () => {
  const P = { industry: "제조", region: "서울", employeeCount: 10, companyName: "위들리", bizno: "111" };
  const at = new Date("2026-09-01T00:00:00Z");

  it("policy-verdict:{공고}:{16자리} 모양", () => {
    const k = cacheKeyOf(1, "a1", P, at, null);
    expect(k).toMatch(/^policy-verdict:a1:[0-9a-f]{16}$/);
  });

  it("★판정에 안 쓰는 칸(상호·사업자번호)이 달라도 열쇠는 같다", () => {
    expect(cacheKeyOf(1, "a1", P, at, null)).toBe(
      cacheKeyOf(1, "a1", { ...P, companyName: "다른이름", bizno: "999" }, at, null),
    );
  });

  it("판정에 쓰는 칸이 달라지면 열쇠가 달라진다", () => {
    expect(cacheKeyOf(1, "a1", P, at, null)).not.toBe(cacheKeyOf(1, "a1", { ...P, region: "부산" }, at, null));
  });

  it("지시문 판본·재독 시각·첨부가 바뀌면 열쇠가 달라진다", () => {
    const base = cacheKeyOf(1, "a1", P, at, null);
    expect(cacheKeyOf(2, "a1", P, at, null)).not.toBe(base);
    expect(cacheKeyOf(1, "a1", P, new Date("2026-09-02T00:00:00Z"), null)).not.toBe(base);
    expect(cacheKeyOf(1, "a1", P, at, "첨부 원문")).not.toBe(base);
  });

  it("칸 순서가 달라도 같은 열쇠", () => {
    expect(cacheKeyOf(1, "a1", { region: "서울", industry: "제조" }, at, null)).toBe(
      cacheKeyOf(1, "a1", { industry: "제조", region: "서울" }, at, null),
    );
  });
});

describe("structureNeedsRawText — 첨부 원문을 실을까", () => {
  const s = (n: number) => ({ conditions: new Array(n).fill(0), humanCheck: [] });
  it("needs_review 면 싣는다", () => {
    expect(structureNeedsRawText("needs_review", CURRENT_STRUCTURE_VERSION, s(3))).toBe(true);
  });
  it("뽑힌 조건이 없으면 싣는다", () => {
    expect(structureNeedsRawText("done", CURRENT_STRUCTURE_VERSION, s(0))).toBe(true);
  });
  it("판본이 낡으면 싣는다 — 옛 규칙은 본문만 보고 뽑았을 수 있다", () => {
    expect(structureNeedsRawText("done", CURRENT_STRUCTURE_VERSION - 1, s(3))).toBe(true);
  });
  it("현재 판본으로 조건이 뽑혀 있으면 안 싣는다 — 같은 값을 두 번 사지 않는다", () => {
    expect(structureNeedsRawText("done", CURRENT_STRUCTURE_VERSION, s(3))).toBe(false);
  });
});

describe("readModelJson — 모델 응답 읽기", () => {
  it("거절·끊김·빈 답·형식 오류를 사람 말로 가른다", () => {
    expect(() => readModelJson({ text: "", stopReason: "refusal" })).toThrow("거절");
    expect(() => readModelJson({ text: "{}", stopReason: "max_tokens" })).toThrow("중간에 끊겼");
    expect(() => readModelJson({ text: "   " })).toThrow("비어 있");
    expect(() => readModelJson({ text: "{어쩌구" })).toThrow("형식이 올바르지 않");
  });
  it("정상 JSON 은 그대로 돌려준다", () => {
    expect(readModelJson({ text: '{"a":1}', stopReason: "end_turn" })).toEqual({ a: 1 });
  });
});

describe("parseVerdict — 산출물 검증", () => {
  it("등급이 세 가지 밖이면 실패", () => {
    expect(parseVerdict({ grade: "maybe", explanation: "x", checklist: [] }, STATUSES)).toBeNull();
  });
  it("설명이 비면 실패", () => {
    expect(parseVerdict({ grade: "possible", explanation: "   ", checklist: [] }, STATUSES)).toBeNull();
  });
  it("checklist 가 배열이 아니면 실패", () => {
    expect(parseVerdict({ grade: "possible", explanation: "x", checklist: "x" }, STATUSES)).toBeNull();
  });
  it("★모르는 상태값을 「충족」으로 올리지 않는다 — 확인필요로 내린다", () => {
    const v = parseVerdict(
      { grade: "possible", explanation: "x", checklist: [{ condition: "c", status: "완벽충족", note: "" }] },
      STATUSES,
    );
    expect(v?.checklist[0].status).toBe("확인필요");
  });
  it("조건이 빈 항목은 버리고 나머지는 다듬어 남긴다", () => {
    const v = parseVerdict(
      {
        grade: "uncertain",
        explanation: " 설명 ",
        checklist: [{ condition: "  ", status: "충족", note: "" }, { condition: " 서울 ", status: "충족", note: " 근거 " }],
      },
      STATUSES,
    );
    expect(v).toEqual({ grade: "uncertain", explanation: "설명", checklist: [{ condition: "서울", status: "충족", note: "근거" }] });
  });
});

describe("runVerdict — 흐름", () => {
  it("공고 번호가 비면 bad_request — 조회도 안 한다", async () => {
    const { d } = deps();
    const res = await runVerdict({ announcementId: "  ", profile: {} }, d);
    expect(res.status).toBe("bad_request");
    expect(d.q.findAnnouncement).not.toHaveBeenCalled();
  });

  it("공고가 없으면 not_found — 예산을 안 잡는다", async () => {
    const { d, reserve } = deps({}, null);
    expect((await runVerdict({ announcementId: "a1", profile: {} }, d)).status).toBe("not_found");
    expect(reserve).not.toHaveBeenCalled();
  });

  it("★캐시가 있으면 AI 를 안 부르고 예산도 안 잡는다 — cached: true", async () => {
    const cached = { grade: "possible", explanation: "저장본", checklist: [] };
    const { d, callModel, reserve } = deps({}, row(), cached);
    const res = await runVerdict({ announcementId: "a1", profile: {} }, d);
    expect(res).toEqual({ status: "ok", data: { ...cached, cached: true } });
    expect(callModel).not.toHaveBeenCalled();
    expect(reserve).not.toHaveBeenCalled();
  });

  it("읽는 칸에 region 이 들어 있다 — 지역 조건 보태기가 화면과 같아야 한다", () => {
    expect((VERDICT_SELECT as Record<string, boolean>).region).toBe(true);
    expect((VERDICT_SELECT as Record<string, boolean>).attachmentText).toBe(true);
  });

  it("자리를 못 잡으면 limit — 하루 상한 수가 문구에 들어간다", async () => {
    const { d, callModel } = deps({ reserve: vi.fn(async () => 0), dailyMax: 150 });
    const res = await runVerdict({ announcementId: "a1", profile: {} }, d);
    expect(res.status).toBe("limit");
    if (res.status !== "limit") return;
    expect(res.message).toContain("150건");
    expect(callModel).not.toHaveBeenCalled();
  });

  it("성공하면 캐시에 적고 cached: false 로 돌려준다", async () => {
    const { d, cacheSet, callModel } = deps();
    const res = await runVerdict({ announcementId: "a1", profile: { region: "서울" } }, d);
    expect(res.status).toBe("ok");
    if (res.status !== "ok") return;
    expect(res.data.cached).toBe(false);
    expect(res.data.grade).toBe("possible");
    expect(cacheSet).toHaveBeenCalledTimes(1);
    expect(String(cacheSet.mock.calls[0][0])).toMatch(/^policy-verdict:a1:/);
    const req = callModel.mock.calls[0][0] as { system: string; maxTokens: number; schema: unknown };
    expect(req.system).toBe(prompt.VERDICT_SYSTEM);
    expect(req.maxTokens).toBe(VERDICT_MAX_TOKENS);
    expect(req.schema).toBe(prompt.VERDICT_JSON_SCHEMA);
  });

  it("★조건이 뽑혀 있으면 첨부 원문을 지시문에 안 싣는다", async () => {
    const structure = { benefitSummary: "", supportAmountText: "", aiSummary: { purpose: "", target: "", scale: "", scaleItems: [] },
      conditions: [{ key: "region", op: "in", value: ["서울"], rawText: "서울", machineReadable: true }],
      humanCheck: [], documents: [], verified: true };
    const { d, callModel } = deps({}, row({ structure, attachmentText: "첨부 원문 매우 김" }));
    await runVerdict({ announcementId: "a1", profile: {} }, d);
    expect((callModel.mock.calls[0][0] as { user: string }).user).toContain("첨부: (없음)");
  });

  it("★구조화가 덜 된 공고면 첨부 원문을 싣는다", async () => {
    const { d, callModel } = deps({}, row({ structureStatus: "needs_review", attachmentText: "첨부 원문" }));
    await runVerdict({ announcementId: "a1", profile: {} }, d);
    expect((callModel.mock.calls[0][0] as { user: string }).user).toContain("첨부: 첨부 원문");
  });

  it("★AI 실패는 ai_failed — 청구된 실패는 환불하지 않는다", async () => {
    const { d, refund } = deps({
      callModel: vi.fn(async () => ({ text: "", stopReason: "max_tokens" })),
      isBillingOrAuthError: () => false,
    });
    const res = await runVerdict({ announcementId: "a1", profile: {} }, d);
    expect(res.status).toBe("ai_failed");
    if (res.status !== "ai_failed") return;
    expect(res.message).toContain("중간에 끊겼");
    expect(refund).not.toHaveBeenCalled();
  });

  it("★크레딧·열쇠 문제는 호출이 안 나간 것이므로 자리를 돌려준다", async () => {
    const { d, refund } = deps({
      callModel: vi.fn(async () => { throw new Error("credit balance is too low"); }),
      isBillingOrAuthError: () => true,
    });
    expect((await runVerdict({ announcementId: "a1", profile: {} }, d)).status).toBe("ai_failed");
    expect(refund).toHaveBeenCalledWith("a@b.c", 1);
  });

  it("응답 모양이 어긋나면 ai_failed 이고 캐시에 안 적는다", async () => {
    const { d, cacheSet } = deps({ callModel: vi.fn(async () => ({ text: '{"grade":"maybe"}' })) });
    expect((await runVerdict({ announcementId: "a1", profile: {} }, d)).status).toBe("ai_failed");
    expect(cacheSet).not.toHaveBeenCalled();
  });

  it("캐시 읽기가 던져도 판정은 진행한다", async () => {
    const { d } = deps({
      q: {
        findAnnouncement: vi.fn(async () => row()),
        cacheGet: vi.fn(async () => { throw new Error("db down"); }),
        cacheSet: vi.fn(async () => {}),
      } as never,
    });
    expect((await runVerdict({ announcementId: "a1", profile: {} }, d)).status).toBe("ok");
  });

  it("캐시 저장이 던져도 판정 결과는 나간다", async () => {
    const { d } = deps({
      q: {
        findAnnouncement: vi.fn(async () => row()),
        cacheGet: vi.fn(async () => null),
        cacheSet: vi.fn(async () => { throw new Error("db down"); }),
      } as never,
    });
    expect((await runVerdict({ announcementId: "a1", profile: {} }, d)).status).toBe("ok");
  });
});
