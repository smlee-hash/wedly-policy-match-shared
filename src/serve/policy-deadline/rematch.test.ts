// 「다시 맞추기」(NO.789) — 상세창에서 업체 정보를 고치고 닫으면, 그 업체를 미리 대조 줄에 넣고 줄이 빠질 때(앱의 대조 시계가
// 그 업체를 다시 판정했을 때)까지 기다린다. 담당 확인은 진행·해당 없음과 같은 앱 주입이다.
import { describe, expect, it, vi } from "vitest";
import {
  REMATCH_BAD_BODY_MESSAGE,
  REMATCH_POLL_MS,
  REMATCH_WAIT_MS,
  readRematchBody,
  requestDeadlineRematch,
  type RematchDeps,
} from "./rematch";
import { DeadlineProgressError, NOT_ASSIGNED_MESSAGE, type ProgressActor, type ProgressCompany } from "./progress";

const NOW = new Date("2026-11-12T01:00:00Z");
const CONSULTANT: ProgressActor = { id: "u1", name: "김컨설", email: "kim@example.com", role: "SALES_REP" };
const OTHER: ProgressActor = { id: "u2", name: "박컨설", email: "park@example.com", role: "SALES_REP" };
const ADMIN: ProgressActor = { id: "a", name: "관리자", email: "admin@example.com", role: "ADMIN" };
const COMPANY: ProgressCompany = { customerKey: "b:1", aliases: ["b:1", "p:01012345678"], companyName: "삼영식품", readConsultantIds: ["u1"] };

function assigned(actor: ProgressActor, company: ProgressCompany | null): boolean {
  return actor.role === "ADMIN" || (company !== null && company.readConsultantIds.includes(actor.id));
}

/**
 * 시험용 자리 — sleep 이 가짜 시계를 쉰 만큼 앞으로 민다. queued 는 isQueued 가 차례로 돌려줄 값(다 쓰면 마지막 값).
 * 다르게 굴려야 하는 시험은 받은 가짜에 mockImplementation 등을 건다.
 */
function fakeDeps(queued: readonly boolean[]) {
  let clock = 0;
  let asked = 0;
  return {
    readCompany: vi.fn<RematchDeps["readCompany"]>(async (key) => (COMPANY.aliases.includes(key) ? COMPANY : null)),
    isAssigned: vi.fn<RematchDeps["isAssigned"]>(assigned),
    enqueue: vi.fn<RematchDeps["enqueue"]>(async () => undefined),
    isQueued: vi.fn<RematchDeps["isQueued"]>(async () => {
      const value = queued[Math.min(asked, queued.length - 1)] ?? false;
      asked += 1;
      return value;
    }),
    sleep: vi.fn<RematchDeps["sleep"]>(async (ms) => {
      clock += ms;
    }),
    nowMs: vi.fn<RematchDeps["nowMs"]>(() => clock),
  } satisfies RematchDeps;
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  return expect.unreachable("거절돼야 하는데 통과했다");
}

describe("requestDeadlineRematch — 다시 맞추기", () => {
  it("기다림 상한은 25초, 확인 간격은 1초다", () => {
    expect(REMATCH_WAIT_MS).toBe(25_000);
    expect(REMATCH_POLL_MS).toBe(1_000);
  });

  it("담당이 부르면 업체를 줄에 넣고, 줄이 빠질 때까지 1초마다 본 뒤 다시 맞췄다고 답한다", async () => {
    const deps = fakeDeps([true, true, false]);
    const result = await requestDeadlineRematch({ customerKey: "b:1", actor: CONSULTANT }, NOW, deps);
    expect(result).toEqual({ rematched: true });
    expect(deps.isAssigned).toHaveBeenCalledWith(CONSULTANT, COMPANY);
    expect(deps.enqueue).toHaveBeenCalledTimes(1);
    expect(deps.enqueue).toHaveBeenCalledWith("b:1", NOW);
    expect(deps.isQueued).toHaveBeenCalledTimes(3);
    expect(deps.isQueued).toHaveBeenCalledWith("b:1");
    expect(deps.sleep).toHaveBeenCalledTimes(3);
    expect(deps.sleep.mock.calls.every(([ms]) => ms === REMATCH_POLL_MS)).toBe(true);
  });

  it("줄에 넣은 뒤 한 번 쉬고 나서 처음 본다 — 넣자마자 보지 않는다", async () => {
    const deps = fakeDeps([false]);
    await requestDeadlineRematch({ customerKey: "b:1", actor: CONSULTANT }, NOW, deps);
    const enqueued = deps.enqueue.mock.invocationCallOrder[0] ?? Infinity;
    const slept = deps.sleep.mock.invocationCallOrder[0] ?? Infinity;
    const checked = deps.isQueued.mock.invocationCallOrder[0] ?? -Infinity;
    expect(enqueued).toBeLessThan(slept);
    expect(slept).toBeLessThan(checked);
  });

  it("같은 업체의 다른 열쇠(별칭)로 불러도 업체 본 열쇠로 넣고 본 열쇠를 본다", async () => {
    const deps = fakeDeps([false]);
    await requestDeadlineRematch({ customerKey: "p:01012345678", actor: ADMIN }, NOW, deps);
    expect(deps.readCompany).toHaveBeenCalledWith("p:01012345678");
    expect(deps.enqueue).toHaveBeenCalledWith("b:1", NOW);
    expect(deps.isQueued).toHaveBeenCalledWith("b:1");
  });

  it("25초가 지나도 줄이 안 빠지면 기다림을 멈추고 아직이라고 답한다(줄은 그대로 둔다 — 시계가 곧 맞춘다)", async () => {
    const deps = fakeDeps([true]);
    const result = await requestDeadlineRematch({ customerKey: "b:1", actor: CONSULTANT }, NOW, deps);
    expect(result).toEqual({ rematched: false });
    expect(deps.sleep).toHaveBeenCalledTimes(REMATCH_WAIT_MS / REMATCH_POLL_MS);
    expect(deps.enqueue).toHaveBeenCalledTimes(1);
  });

  it("기다림 상한·간격은 바꿔 줄 수 있다", async () => {
    const deps = fakeDeps([true]);
    const result = await requestDeadlineRematch({ customerKey: "b:1", actor: CONSULTANT }, NOW, deps, { waitMs: 3_000, pollMs: 500 });
    expect(result).toEqual({ rematched: false });
    expect(deps.sleep).toHaveBeenCalledTimes(6);
    expect(deps.sleep).toHaveBeenCalledWith(500);
  });

  it("마지막 확인에서 줄이 빠졌으면 상한에 닿았어도 다시 맞췄다고 답한다", async () => {
    const deps = fakeDeps([...Array.from({ length: 24 }, () => true), false]);
    const result = await requestDeadlineRematch({ customerKey: "b:1", actor: CONSULTANT }, NOW, deps);
    expect(result).toEqual({ rematched: true });
    expect(deps.isQueued).toHaveBeenCalledTimes(25);
  });

  it("담당이 아니면 403 — 줄에 넣지 않는다", async () => {
    const deps = fakeDeps([false]);
    const error = await rejection(requestDeadlineRematch({ customerKey: "b:1", actor: OTHER }, NOW, deps));
    expect(error).toBeInstanceOf(DeadlineProgressError);
    expect(error).toMatchObject({ status: 403, code: "FORBIDDEN", message: NOT_ASSIGNED_MESSAGE });
    expect(deps.enqueue).not.toHaveBeenCalled();
    expect(deps.isQueued).not.toHaveBeenCalled();
  });

  it("없는 업체도 담당이 아니면 같은 403 — 있는지조차 알리지 않는다", async () => {
    const deps = fakeDeps([false]);
    const error = await rejection(requestDeadlineRematch({ customerKey: "b:9", actor: CONSULTANT }, NOW, deps));
    expect(error).toMatchObject({ status: 403, code: "FORBIDDEN", message: NOT_ASSIGNED_MESSAGE });
    expect(deps.isAssigned).toHaveBeenCalledWith(CONSULTANT, null);
    expect(deps.enqueue).not.toHaveBeenCalled();
  });

  it("관리자인데 업체가 없으면 404", async () => {
    const deps = fakeDeps([false]);
    const error = await rejection(requestDeadlineRematch({ customerKey: "b:9", actor: ADMIN }, NOW, deps));
    expect(error).toMatchObject({ status: 404, code: "NOT_FOUND", message: "업체를 찾지 못했습니다." });
    expect(deps.enqueue).not.toHaveBeenCalled();
  });

  it("담당 확인이 Promise 여도 기다려 판단한다", async () => {
    const deps = fakeDeps([false]);
    deps.isAssigned.mockImplementation(async () => false);
    const error = await rejection(requestDeadlineRematch({ customerKey: "b:1", actor: ADMIN }, NOW, deps));
    expect(error).toMatchObject({ status: 403, code: "FORBIDDEN" });
    expect(deps.enqueue).not.toHaveBeenCalled();
  });

  it("줄에 넣다 실패하면 그 오류를 그대로 던지고 기다리지 않는다", async () => {
    const boom = new Error("db down");
    const deps = fakeDeps([false]);
    deps.enqueue.mockRejectedValue(boom);
    const error = await rejection(requestDeadlineRematch({ customerKey: "b:1", actor: CONSULTANT }, NOW, deps));
    expect(error).toBe(boom);
    expect(deps.sleep).not.toHaveBeenCalled();
    expect(deps.isQueued).not.toHaveBeenCalled();
  });

  it("줄을 보다 실패하면 그 오류를 그대로 던진다", async () => {
    const boom = new Error("db down");
    const deps = fakeDeps([false]);
    deps.isQueued.mockRejectedValue(boom);
    const error = await rejection(requestDeadlineRematch({ customerKey: "b:1", actor: CONSULTANT }, NOW, deps));
    expect(error).toBe(boom);
  });
});

describe("readRematchBody — 다시 맞추기 본문", () => {
  it("업체 열쇠만 꺼낸다(다른 칸은 버린다)", () => {
    expect(readRematchBody({ customerKey: "b:1", bucketKey: "x", reason: "기타" })).toEqual({ customerKey: "b:1" });
    expect(readRematchBody({ customerKey: "p:01012345678" })).toEqual({ customerKey: "p:01012345678" });
  });

  it.each([
    { name: "본문 없음", body: null },
    { name: "글자", body: "b:1" },
    { name: "열쇠 없음", body: {} },
    { name: "열쇠가 수", body: { customerKey: 1 } },
    { name: "열쇠 모양이 다름", body: { customerKey: "x:1" } },
    { name: "열쇠 앞뒤 빈칸", body: { customerKey: " b:1" } },
  ])("$name → 400", ({ body }) => {
    let thrown: unknown;
    try {
      readRematchBody(body);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(DeadlineProgressError);
    expect(thrown).toMatchObject({ status: 400, code: "BAD_REQUEST", message: REMATCH_BAD_BODY_MESSAGE });
    expect(REMATCH_BAD_BODY_MESSAGE).toBe("업체를 골라 주세요.");
  });
});
