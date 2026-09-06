import { describe, it, expect, vi } from "vitest";
import { noteFailureAndMaybeAlert, noteSuccess } from "./alert";

describe("noteFailureAndMaybeAlert", () => {
  it("연속 3회째에만 알린다", async () => {
    const send = vi.fn(async () => true);
    let count = 0;
    const store = { get: async () => count, set: async (n: number) => { count = n; } };
    for (let i = 0; i < 2; i++) await noteFailureAndMaybeAlert("tp-x", "실패", { send, store });
    expect(send).not.toHaveBeenCalled();
    await noteFailureAndMaybeAlert("tp-x", "실패", { send, store });
    expect(send).toHaveBeenCalledOnce();
    expect(count).toBe(0); // 알림 뒤 리셋
  });
  it("send 가 false 이면 카운터를 THRESHOLD 로 유지한다", async () => {
    const send = vi.fn(async () => false);
    let count = 2;
    const store = { get: async () => count, set: async (n: number) => { count = n; } };
    await noteFailureAndMaybeAlert("tp-x", "실패", { send, store });
    expect(send).toHaveBeenCalledOnce();
    expect(count).toBe(3);
  });
  it("send 가 throw 하면 카운터를 THRESHOLD 로 유지한다", async () => {
    const send = vi.fn(async () => { throw new Error("slack down"); });
    let count = 2;
    const store = { get: async () => count, set: async (n: number) => { count = n; } };
    await noteFailureAndMaybeAlert("tp-x", "실패", { send, store });
    expect(count).toBe(3);
  });
  it("성공하면 카운트를 0으로", async () => {
    let count = 2; const store = { get: async () => count, set: async (n: number) => { count = n; } };
    await noteSuccess("tp-x", { store });
    expect(count).toBe(0);
  });
});
