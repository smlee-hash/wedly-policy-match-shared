import { createHash } from "crypto";
import { describe, expect, it, vi } from "vitest";
import {
  AI_INPUT_OVERHEAD_BYTES,
  AI_INPUT_TOO_LARGE_MESSAGE,
  INCOMPLETE_EVIDENCE_CONDITION,
  INCOMPLETE_EVIDENCE_REASON,
  MAX_AI_INPUT_BYTES,
  measureAiInputBytes,
  utf8ByteLength,
} from "../ai/customer-evidence";
import {
  VERDICT_MAX_TOKENS,
  VERDICT_SELECT,
  attachmentFingerprint,
  cacheKeyOf,
  customerEvidenceFingerprint,
  parseVerdict,
  readModelJson,
  runVerdict,
  structureNeedsRawText,
  type RunVerdictDeps,
  AWAITING_OPUS_REASON,
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
  buildVerdictUserPrompt: (input) =>
    `제목: ${input.title}|첨부: ${input.attachmentText ?? "(없음)"}|고객자료: ${input.customerEvidence?.text ?? "(없음)"}`,
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
  const E = { revision: "rev-1", text: "출처: 원장 · 기간: 2024", incomplete: false as const };

  it("policy-verdict:{공고}:{16자리} 모양", () => {
    const k = cacheKeyOf(1, "a1", P, at, null);
    expect(k).toMatch(/^policy-verdict:a1:[0-9a-f]{16}$/);
  });

  it("상호·사업자번호가 다르면 열쇠가 달라진다 — 고객 자료가 있으면 회사 사이 재사용은 위험하다", () => {
    expect(cacheKeyOf(1, "a1", P, at, null)).not.toBe(
      cacheKeyOf(1, "a1", { ...P, companyName: "다른이름", bizno: "999" }, at, null),
    );
    expect(cacheKeyOf(1, "a1", P, at, null)).not.toBe(
      cacheKeyOf(1, "a1", { ...P, companyName: "다른이름" }, at, null),
    );
    expect(cacheKeyOf(1, "a1", P, at, null)).not.toBe(
      cacheKeyOf(1, "a1", { ...P, bizno: "999" }, at, null),
    );
  });

  it("판정에 쓰는 칸이 달라지면 열쇠가 달라진다", () => {
    expect(cacheKeyOf(1, "a1", P, at, null)).not.toBe(cacheKeyOf(1, "a1", { ...P, region: "부산" }, at, null));
  });

  it("region 이 같고 regionSigungu 만 다르면 열쇠가 달라진다", () => {
    expect(cacheKeyOf(1, "a1", { ...P, regionSigungu: "강남구" }, at, null)).not.toBe(
      cacheKeyOf(1, "a1", { ...P, regionSigungu: "송파구" }, at, null),
    );
  });

  it("orgTypes·신용점수·기존 대출이 달라지면 열쇠가 달라진다", () => {
    const base = cacheKeyOf(1, "a1", P, at, null);
    expect(cacheKeyOf(1, "a1", { ...P, orgTypes: ["사회적기업"] }, at, null)).not.toBe(base);
    expect(cacheKeyOf(1, "a1", { ...P, orgTypes: ["사회적기업"] }, at, null)).not.toBe(
      cacheKeyOf(1, "a1", { ...P, orgTypes: ["예비창업자"] }, at, null),
    );
    expect(cacheKeyOf(1, "a1", { ...P, creditScore: 720 }, at, null)).not.toBe(
      cacheKeyOf(1, "a1", { ...P, creditScore: 800 }, at, null),
    );
    expect(cacheKeyOf(1, "a1", { ...P, hasExistingLoan: true }, at, null)).not.toBe(
      cacheKeyOf(1, "a1", { ...P, hasExistingLoan: false }, at, null),
    );
  });

  it("같은 정규 값이면 칸 순서가 달라도 같은 열쇠 — 배열 내용도 남긴다", () => {
    expect(cacheKeyOf(1, "a1", { region: "서울", industry: "제조" }, at, null)).toBe(
      cacheKeyOf(1, "a1", { industry: "제조", region: "서울" }, at, null),
    );
    expect(
      cacheKeyOf(1, "a1", { orgTypes: ["사회적기업"], creditScore: 720, region: "서울" }, at, null),
    ).toBe(
      cacheKeyOf(1, "a1", { region: "서울", creditScore: 720, orgTypes: ["사회적기업"] }, at, null),
    );
  });

  it("지시문 판본·재독 시각·첨부가 바뀌면 열쇠가 달라진다", () => {
    const base = cacheKeyOf(1, "a1", P, at, null);
    expect(cacheKeyOf(2, "a1", P, at, null)).not.toBe(base);
    expect(cacheKeyOf(1, "a1", P, new Date("2026-09-02T00:00:00Z"), null)).not.toBe(base);
    expect(cacheKeyOf(1, "a1", P, at, "첨부 원문")).not.toBe(base);
  });

  it("고객 자료의 회사·출처·본문·판본·불완전 여부가 다르면 열쇠가 달라진다", () => {
    const base = cacheKeyOf(1, "a1", P, at, null, E);
    expect(cacheKeyOf(1, "a1", { ...P, companyName: "다른회사" }, at, null, E)).not.toBe(base);
    expect(cacheKeyOf(1, "a1", P, at, null, { ...E, text: "출처: 상담일지 · 기간: 2024" })).not.toBe(base);
    expect(cacheKeyOf(1, "a1", P, at, null, { ...E, revision: "rev-2" })).not.toBe(base);
    expect(cacheKeyOf(1, "a1", P, at, null, { ...E, incomplete: true })).not.toBe(base);
    expect(cacheKeyOf(1, "a1", P, at, null)).not.toBe(base);
  });

  it("판본 글자만 같고 본문이 바뀌면 열쇠가 달라진다 — 판본 글자만 믿지 않는다", () => {
    const head = "가".repeat(200);
    expect(
      cacheKeyOf(1, "a1", P, at, null, { revision: "rev-1", text: `${head}뒤A`, incomplete: false }),
    ).not.toBe(
      cacheKeyOf(1, "a1", P, at, null, { revision: "rev-1", text: `${head}뒤B`, incomplete: false }),
    );
  });

  it("여섯 번째 인자가 없으면 예전 호출과 같고, null 도 없는 것과 같다", () => {
    expect(cacheKeyOf(1, "a1", P, at, null)).toBe(cacheKeyOf(1, "a1", P, at, null, undefined));
    expect(cacheKeyOf(1, "a1", P, at, null)).toBe(cacheKeyOf(1, "a1", P, at, null, null));
  });
});

describe("customerEvidenceFingerprint — JSON 튜플 해시", () => {
  it("해시 입력은 [revision, incomplete, text] JSON 튜플이다 — 본문 전체를 넣는다", () => {
    const e = { revision: "rev-1", incomplete: false as const, text: "출처: 원장 · 기간: 2024" };
    expect(customerEvidenceFingerprint(e)).toBe(
      createHash("sha256").update(JSON.stringify(["rev-1", false, "출처: 원장 · 기간: 2024"])).digest("hex"),
    );
    const long = { revision: "rev-1", incomplete: false as const, text: `${"가".repeat(200)}뒤A` };
    const other = { ...long, text: `${"가".repeat(200)}뒤B` };
    expect(customerEvidenceFingerprint(long)).not.toBe(customerEvidenceFingerprint(other));
  });

  it("예전에 구분자 이어붙이면 같던 튜플은 서로 다른 해시가 된다", () => {
    const left = { revision: "a", incomplete: false as const, text: "b|inc:1|c" };
    const right = { revision: "a|inc:0|b", incomplete: true as const, text: "c" };
    const concat = (e: { revision: string; incomplete: boolean; text: string }) =>
      `rev:${e.revision}|inc:${e.incomplete ? "1" : "0"}|${e.text}`;
    expect(concat(left)).toBe(concat(right));
    expect(customerEvidenceFingerprint(left)).not.toBe(customerEvidenceFingerprint(right));

    const swapLeft = { revision: "x|inc:0", incomplete: false as const, text: "y" };
    const swapRight = { revision: "x", incomplete: false as const, text: "inc:0|y" };
    expect(concat(swapLeft)).toBe(concat(swapRight));
    expect(customerEvidenceFingerprint(swapLeft)).not.toBe(customerEvidenceFingerprint(swapRight));
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
    expect(structureNeedsRawText("done", 2, s(3))).toBe(true);
  });
  it("첨부 정독 판본(3) 이상이면 정리 판본이 더 올라가도(v4 업종 범위) 원문을 싣지 않는다 — 판정 비용이 늘지 않게", () => {
    expect(structureNeedsRawText("done", 3, s(3))).toBe(false);
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

  it("★Opus 를 기다리는 공고(_awaitingOpus)는 저장된 「가능」 판정도 「확인 필요」로 내려 보여 준다", async () => {
    const cached = { grade: "possible", explanation: "저장본", checklist: [] };
    const awaiting = row({ structureStatus: "needs_review", structure: { conditions: [], _awaitingOpus: true } });
    const { d, callModel } = deps({}, awaiting, cached);
    const res = await runVerdict({ announcementId: "a1", profile: {} }, d);
    expect(res.status).toBe("ok");
    if (res.status !== "ok") return;
    expect(res.data.grade).toBe("uncertain");
    expect(res.data.cached).toBe(true);
    expect(res.data.explanation).toContain(AWAITING_OPUS_REASON);
    expect(callModel).not.toHaveBeenCalled();
  });

  it("★Opus 를 기다리는 공고는 새로 받은 「가능」도 내려 보여 주되, 캐시에는 AI 답을 그대로 둔다", async () => {
    const awaiting = row({ structureStatus: "needs_review", structure: { conditions: [], _awaitingOpus: true } });
    const { d, cacheSet } = deps({}, awaiting);
    const res = await runVerdict({ announcementId: "a1", profile: {} }, d);
    expect(res.status).toBe("ok");
    if (res.status !== "ok") return;
    expect(res.data.grade).toBe("uncertain");
    expect(res.data.cached).toBe(false);
    expect((cacheSet.mock.calls[0][1] as { grade: string }).grade).toBe("possible");
  });

  it("Opus 표식이 없거나 「불가」·「확인 필요」면 그대로다", async () => {
    const plainReview = row({ structureStatus: "needs_review", structure: { conditions: [] } });
    const r1 = await runVerdict({ announcementId: "a1", profile: {} }, deps({}, plainReview, { grade: "possible", explanation: "x", checklist: [] }).d);
    expect(r1.status === "ok" && r1.data.grade).toBe("possible");
    const awaiting = row({ structureStatus: "needs_review", structure: { conditions: [], _awaitingOpus: true } });
    const r2 = await runVerdict({ announcementId: "a1", profile: {} }, deps({}, awaiting, { grade: "impossible", explanation: "x", checklist: [] }).d);
    expect(r2.status === "ok" && r2.data).toEqual({ grade: "impossible", explanation: "x", checklist: [], cached: true });
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

  it("서버 deps 의 고객 자료를 지시문에 넘긴다", async () => {
    const { d, callModel } = deps({
      customerEvidence: { revision: "r1", text: "출처: 원장 · 작년 매출 12억", incomplete: false },
    });
    await runVerdict({ announcementId: "a1", profile: {} }, d);
    expect((callModel.mock.calls[0][0] as { user: string }).user).toContain("출처: 원장 · 작년 매출 12억");
  });

  it("고객 자료 본문은 6,000자 넘어 꼬리까지 자르지 않고 넘긴다", async () => {
    const tail = "SERVE_EVIDENCE_TAIL_W2";
    const text = `${"본문".repeat(3_100)}\n${tail}`;
    const { d, callModel } = deps({
      customerEvidence: { revision: "r1", text, incomplete: false },
    });
    await runVerdict({ announcementId: "a1", profile: {} }, d);
    const user = (callModel.mock.calls[0][0] as { user: string }).user;
    expect(user).toContain(tail);
    expect(user).not.toContain("이후 생략");
  });

  it("요청 본문의 customerEvidence 는 쓰지 않는다", async () => {
    const { d, callModel } = deps();
    await runVerdict(
      { announcementId: "a1", profile: {}, customerEvidence: { revision: "x", text: "몰래 넣은 자료", incomplete: false } } as never,
      d,
    );
    expect((callModel.mock.calls[0][0] as { user: string }).user).not.toContain("몰래 넣은 자료");
    expect((callModel.mock.calls[0][0] as { user: string }).user).toContain("고객자료: (없음)");
  });

  it("deps 고객 자료가 잘못되면 bad_request — 캐시 possible 도 쓰지 않는다", async () => {
    const cached = { grade: "possible", explanation: "저장본", checklist: [] };
    const { d, callModel } = deps({ customerEvidence: { text: "만" } as never }, row(), cached);
    const res = await runVerdict({ announcementId: "a1", profile: {} }, d);
    expect(res.status).toBe("bad_request");
    if (res.status !== "bad_request") return;
    expect(res.message).toContain("고객 자료");
    expect(callModel).not.toHaveBeenCalled();
  });

  it("complete 자료면 모델 possible 을 그대로 둔다", async () => {
    const { d } = deps({
      customerEvidence: { revision: "r1", text: "원장 전체", incomplete: false },
    });
    const res = await runVerdict({ announcementId: "a1", profile: {} }, d);
    expect(res.status).toBe("ok");
    if (res.status !== "ok") return;
    expect(res.data.grade).toBe("possible");
    expect(res.data.checklist).toEqual([{ condition: "서울 소재", status: "충족", note: "본사가 서울" }]);
    expect(res.data.checklist.some((row) => row.condition === INCOMPLETE_EVIDENCE_CONDITION)).toBe(false);
  });

  it("incomplete 자료면 모델이 possible 을 줘도 uncertain 으로 내리고 이유를 붙인다", async () => {
    const { d, cacheSet } = deps({
      customerEvidence: { revision: "r1", text: "일부 원장만", incomplete: true },
    });
    const res = await runVerdict({ announcementId: "a1", profile: {} }, d);
    expect(res.status).toBe("ok");
    if (res.status !== "ok") return;
    expect(res.data.grade).toBe("uncertain");
    expect(res.data.explanation).toContain("완전하지");
    expect(res.data.cached).toBe(false);
    expect(res.data.checklist).toEqual([
      { condition: "서울 소재", status: "충족", note: "본사가 서울" },
      { condition: INCOMPLETE_EVIDENCE_CONDITION, status: "확인필요", note: INCOMPLETE_EVIDENCE_REASON },
    ]);
    expect(cacheSet.mock.calls[0][1]).toMatchObject({
      grade: "uncertain",
      checklist: [
        { condition: "서울 소재", status: "충족", note: "본사가 서울" },
        { condition: INCOMPLETE_EVIDENCE_CONDITION, status: "확인필요", note: INCOMPLETE_EVIDENCE_REASON },
      ],
    });
  });

  it("incomplete 자료면 캐시에 possible 이 있어도 uncertain 으로 내린다", async () => {
    const cached = {
      grade: "possible",
      explanation: "저장본 가능",
      checklist: [{ condition: "서울 소재", status: "충족", note: "본사" }],
    };
    const { d, callModel } = deps(
      { customerEvidence: { revision: "r1", text: "일부 원장만", incomplete: true } },
      row(),
      cached,
    );
    const res = await runVerdict({ announcementId: "a1", profile: {} }, d);
    expect(res).toMatchObject({
      status: "ok",
      data: { grade: "uncertain", cached: true },
    });
    if (res.status !== "ok") return;
    expect(res.data.explanation).toContain("저장본 가능");
    expect(res.data.explanation).toContain("완전하지");
    expect(res.data.checklist).toEqual([
      { condition: "서울 소재", status: "충족", note: "본사" },
      { condition: INCOMPLETE_EVIDENCE_CONDITION, status: "확인필요", note: INCOMPLETE_EVIDENCE_REASON },
    ]);
    expect(callModel).not.toHaveBeenCalled();
  });

  it("incomplete 캐시에 확인 범위 행이 있으면 한 줄만 유지하고 기존 충족은 남긴다", async () => {
    const cached = {
      grade: "uncertain",
      explanation: `저장본 ${INCOMPLETE_EVIDENCE_REASON}`,
      checklist: [
        { condition: "서울 소재", status: "충족", note: "본사" },
        { condition: INCOMPLETE_EVIDENCE_CONDITION, status: "확인필요", note: INCOMPLETE_EVIDENCE_REASON },
      ],
    };
    const { d, callModel } = deps(
      { customerEvidence: { revision: "r1", text: "일부 원장만", incomplete: true } },
      row(),
      cached,
    );
    const res = await runVerdict({ announcementId: "a1", profile: {} }, d);
    expect(res.status).toBe("ok");
    if (res.status !== "ok") return;
    expect(res.data.grade).toBe("uncertain");
    expect(res.data.checklist).toEqual(cached.checklist);
    expect(res.data.checklist.filter((row) => row.condition === INCOMPLETE_EVIDENCE_CONDITION)).toHaveLength(1);
    expect(callModel).not.toHaveBeenCalled();
  });

  it("공백만 있는 revision·text 는 malformed — 캐시 possible 도 쓰지 않는다", async () => {
    const cached = { grade: "possible", explanation: "저장본", checklist: [] };
    const blankRevision = deps(
      { customerEvidence: { revision: "  ", text: "원장", incomplete: false } },
      row(),
      cached,
    );
    const blankText = deps(
      { customerEvidence: { revision: "r1", text: "\n\t ", incomplete: false } },
      row(),
      cached,
    );
    for (const { d, callModel } of [blankRevision, blankText]) {
      const res = await runVerdict({ announcementId: "a1", profile: {} }, d);
      expect(res.status).toBe("bad_request");
      if (res.status !== "bad_request") return;
      expect(res.message).toContain("고객 자료");
      expect(callModel).not.toHaveBeenCalled();
    }
  });

  it("최종 지시문이 앱 바이트 상한을 넘으면 bad_request — 예산을 안 잡고 모델도 안 부른다", async () => {
    const user = "한".repeat(Math.ceil((MAX_AI_INPUT_BYTES + 1) / 3));
    expect(user.length).toBeLessThan(MAX_AI_INPUT_BYTES);
    const buildVerdictUserPrompt = vi.fn(() => user);
    const { d, reserve, callModel, cacheSet } = deps({
      prompt: { ...prompt, buildVerdictUserPrompt },
    });
    const res = await runVerdict({ announcementId: "a1", profile: {} }, d);
    expect(res.status).toBe("bad_request");
    if (res.status !== "bad_request") return;
    expect(res.message).toBe(AI_INPUT_TOO_LARGE_MESSAGE);
    expect(res.message).toMatch(/나눠서 검토/);
    expect(buildVerdictUserPrompt).toHaveBeenCalledTimes(1);
    expect(reserve).not.toHaveBeenCalled();
    expect(callModel).not.toHaveBeenCalled();
    expect(cacheSet).not.toHaveBeenCalled();
  });

  it("상한과 같은 바이트는 통과하고 한 바이트 더하면 거절한다", async () => {
    const system = prompt.VERDICT_SYSTEM;
    const budget = MAX_AI_INPUT_BYTES - AI_INPUT_OVERHEAD_BYTES - utf8ByteLength(system);
    const exact = "a".repeat(budget);
    const over = "a".repeat(budget + 1);
    expect(measureAiInputBytes(system, exact)).toBe(MAX_AI_INPUT_BYTES);
    expect(measureAiInputBytes(system, over)).toBe(MAX_AI_INPUT_BYTES + 1);

    const exactRun = deps({
      prompt: { ...prompt, VERDICT_SYSTEM: system, buildVerdictUserPrompt: () => exact },
    });
    const ok = await runVerdict({ announcementId: "a1", profile: {} }, exactRun.d);
    expect(ok.status).toBe("ok");
    expect(exactRun.reserve).toHaveBeenCalledTimes(1);
    expect(exactRun.callModel).toHaveBeenCalledTimes(1);
    expect(exactRun.callModel.mock.calls[0][0].user).toBe(exact);
    expect(exactRun.callModel.mock.calls[0][0].system).toBe(system);

    const overRun = deps({
      prompt: { ...prompt, VERDICT_SYSTEM: system, buildVerdictUserPrompt: () => over },
    });
    const bad = await runVerdict({ announcementId: "a1", profile: {} }, overRun.d);
    expect(bad.status).toBe("bad_request");
    if (bad.status !== "bad_request") return;
    expect(bad.message).toBe(AI_INPUT_TOO_LARGE_MESSAGE);
    expect(overRun.reserve).not.toHaveBeenCalled();
    expect(overRun.callModel).not.toHaveBeenCalled();
  });

  it("작은 지시문은 만든 글자를 그대로 모델에 넘기고 한 번만 조립한다", async () => {
    const buildVerdictUserPrompt = vi.fn(prompt.buildVerdictUserPrompt);
    const { d, callModel } = deps({ prompt: { ...prompt, buildVerdictUserPrompt } });
    await runVerdict({ announcementId: "a1", profile: {} }, d);
    expect(buildVerdictUserPrompt).toHaveBeenCalledTimes(1);
    const user = buildVerdictUserPrompt.mock.results[0]?.value as string;
    expect(user).toBe("제목: 공고|첨부: (없음)|고객자료: (없음)");
    expect(callModel.mock.calls[0][0].user).toBe(user);
    expect(callModel.mock.calls[0][0].system).toBe(prompt.VERDICT_SYSTEM);
  });

  it("모델이 추론 전에 맥락이 너무 길다고 400 으로 거절하면 자리를 한 번 돌려준다", async () => {
    const err = Object.assign(new Error("prompt is too long"), { status: 400 });
    const { d, refund, reserve, callModel } = deps({
      callModel: vi.fn(async () => {
        throw err;
      }),
    });
    const res = await runVerdict({ announcementId: "a1", profile: {} }, d);
    expect(res.status).toBe("ai_failed");
    expect(reserve).toHaveBeenCalledTimes(1);
    expect(d.callModel).toHaveBeenCalledTimes(1);
    expect(refund).toHaveBeenCalledTimes(1);
    expect(refund).toHaveBeenCalledWith("a@b.c", 1);
  });

  it("다른 400 은 자리를 돌려주지 않는다", async () => {
    const err = Object.assign(new Error("maxItems is not allowed"), { status: 400 });
    const { d, refund } = deps({
      callModel: vi.fn(async () => {
        throw err;
      }),
    });
    const res = await runVerdict({ announcementId: "a1", profile: {} }, d);
    expect(res.status).toBe("ai_failed");
    expect(refund).not.toHaveBeenCalled();
  });
});
