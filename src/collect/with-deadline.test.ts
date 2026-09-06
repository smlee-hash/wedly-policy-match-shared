import { afterEach, describe, expect, it, vi } from "vitest";
import { DEADLINE_TIMEOUT, withDeadline } from "./with-deadline";

afterEach(() => {
  vi.useRealTimers();
});

describe("withDeadline", () => {
  it("주어진 시간 안에 끝나면 그 값을 돌려준다", async () => {
    vi.useFakeTimers();
    const p = new Promise<string>((resolve) => {
      setTimeout(() => resolve("ok"), 10);
    });
    const resultP = withDeadline(p, 50);
    await vi.advanceTimersByTimeAsync(10);
    await expect(resultP).resolves.toBe("ok");
  });

  it("시간이 지나면 timeout 을 돌려주고 원래 작업은 계속 돈다", async () => {
    vi.useFakeTimers();
    let finished = false;
    const p = new Promise<string>((resolve) => {
      setTimeout(() => {
        finished = true;
        resolve("late");
      }, 100);
    });
    const resultP = withDeadline(p, 20);
    await vi.advanceTimersByTimeAsync(20);
    await expect(resultP).resolves.toBe(DEADLINE_TIMEOUT);
    expect(finished).toBe(false);
    await vi.advanceTimersByTimeAsync(80);
    expect(finished).toBe(true);
  });

  it("마감 뒤에 원래 작업이 실패해도 오류가 밖으로 새지 않는다", async () => {
    vi.useFakeTimers();
    const leaked: unknown[] = [];
    const onUnhandled = (reason: unknown) => {
      leaked.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);
    try {
      const p = new Promise<string>((_, reject) => {
        setTimeout(() => reject(new Error("늦게 터짐")), 100);
      });
      const resultP = withDeadline(p, 20);
      await vi.advanceTimersByTimeAsync(20);
      await expect(resultP).resolves.toBe(DEADLINE_TIMEOUT);
      await vi.advanceTimersByTimeAsync(80);
      await Promise.resolve();
      await Promise.resolve();
      expect(leaked).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("마감 전에 실패하면 그 오류를 그대로 던진다", async () => {
    vi.useFakeTimers();
    const p = new Promise<string>((_, reject) => {
      setTimeout(() => reject(new Error("크레딧")), 5);
    });
    const resultP = withDeadline(p, 50);
    const assertion = expect(resultP).rejects.toThrow("크레딧");
    await vi.advanceTimersByTimeAsync(5);
    await assertion;
  });

  it("남은 시간이 0 이하면 기다리지 않고 timeout 이다", async () => {
    let resolveP: (v: string) => void = () => {};
    const p = new Promise<string>((resolve) => {
      resolveP = resolve;
    });
    await expect(withDeadline(p, 0)).resolves.toBe(DEADLINE_TIMEOUT);
    // 원래 약속은 아직 안 끝났다 — 0ms 마감이 그걸 기다리지 않았다는 증거.
    let settled = false;
    void p.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    resolveP("ok");
    await p;
    expect(settled).toBe(true);
  });
});
