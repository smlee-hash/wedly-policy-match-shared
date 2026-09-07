import { describe, expect, it, vi } from "vitest";
import { CURRENT_STRUCTURE_VERSION, isCurrentStructure, structureProgress } from "./structure-status";

describe("isCurrentStructure — 다시 안 읽어도 되는 공고", () => {
  it("done·needs_review 이고 판본이 현재 이상이면 참", () => {
    expect(isCurrentStructure({ structureStatus: "done", structureVersion: CURRENT_STRUCTURE_VERSION })).toBe(true);
    expect(isCurrentStructure({ structureStatus: "needs_review", structureVersion: CURRENT_STRUCTURE_VERSION + 1 })).toBe(true);
  });
  it("판본이 낡았으면 거짓 — 저장된 조건은 살아 있지만 「현재」는 아니다", () => {
    expect(isCurrentStructure({ structureStatus: "done", structureVersion: CURRENT_STRUCTURE_VERSION - 1 })).toBe(false);
  });
  it("실패·대기는 거짓", () => {
    expect(isCurrentStructure({ structureStatus: "failed", structureVersion: 9 })).toBe(false);
    expect(isCurrentStructure({ structureStatus: "pending", structureVersion: 9 })).toBe(false);
  });
});

describe("structureProgress — 화면 진행 띠", () => {
  const q = (rows: Array<{ structureStatus: string; structureVersion: number; count: number }>) =>
    ({ groupAnnouncementsByStructure: vi.fn(async () => rows) }) as never;

  it("★첨부까지 읽은 판본만 done 으로 센다 — 옛 판본 완료분은 pending 에 합친다", async () => {
    const r = await structureProgress(
      q([
        { structureStatus: "done", structureVersion: CURRENT_STRUCTURE_VERSION, count: 10 },
        { structureStatus: "done", structureVersion: CURRENT_STRUCTURE_VERSION - 1, count: 5 },
        { structureStatus: "needs_review", structureVersion: CURRENT_STRUCTURE_VERSION, count: 3 },
        { structureStatus: "needs_review", structureVersion: 1, count: 2 },
        { structureStatus: "failed", structureVersion: 0, count: 4 },
        { structureStatus: "pending", structureVersion: 0, count: 6 },
      ]),
    );
    expect(r).toEqual({ total: 30, done: 10, needsReview: 3, failed: 4, pending: 13 });
  });

  it("행이 없으면 전부 0", async () => {
    expect(await structureProgress(q([]))).toEqual({ total: 0, done: 0, pending: 0, needsReview: 0, failed: 0 });
  });

  it("판본 칸이 비었어도(0 취급) 죽지 않는다", async () => {
    const r = await structureProgress(
      q([{ structureStatus: "done", structureVersion: undefined as unknown as number, count: 2 }]),
    );
    expect(r).toEqual({ total: 2, done: 0, pending: 2, needsReview: 0, failed: 0 });
  });

  it("★묶음 조회를 **한 번만** 부른다 — 상태별로 세면 숫자와 비용이 달라진다", async () => {
    const spy = vi.fn(async () => []);
    await structureProgress({ groupAnnouncementsByStructure: spy } as never);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
