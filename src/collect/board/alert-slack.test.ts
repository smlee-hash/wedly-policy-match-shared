import { afterEach, describe, expect, it, vi } from "vitest";
import { sendPolicyBoardAlert } from "./alert-slack";

describe("sendPolicyBoardAlert", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("토큰이 없으면 경고만 하고 성공으로 끝낸다", async () => {
    vi.stubEnv("SLACK_BOT_TOKEN", "");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(sendPolicyBoardAlert("hi")).resolves.toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
  });
  it("res.ok 이고 json.ok 가 true 일 때만 true", async () => {
    vi.stubEnv("SLACK_BOT_TOKEN", "xoxb-test");
    vi.stubEnv("POLICY_BOARD_SLACK_CHANNEL", "C123");
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(sendPolicyBoardAlert("hi")).resolves.toBe(true);
    const failJson = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: false, error: "invalid" }),
    }));
    vi.stubGlobal("fetch", failJson);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(sendPolicyBoardAlert("hi")).resolves.toBe(false);
    expect(warn).toHaveBeenCalled();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({ ok: true }) })));
    await expect(sendPolicyBoardAlert("hi")).resolves.toBe(false);
  });
});
