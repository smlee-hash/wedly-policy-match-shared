import { afterEach, describe, expect, it, vi } from "vitest";
import { buildBoardFailureAlert } from "./alert";
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
  it("안전망: 보내기 직전에 > 로 시작하지 않는 줄엔 `> ` 를 붙이고 빈 줄은 > 로 바꾼다", async () => {
    vi.stubEnv("SLACK_BOT_TOKEN", "xoxb-test");
    vi.stubEnv("POLICY_BOARD_SLACK_CHANNEL", "C123");
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => ({
      ok: true,
      json: async () => ({ ok: true }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const sentText = (call: number): string => JSON.parse(String(fetchMock.mock.calls[call][1].body)).text;

    await expect(sendPolicyBoardAlert("> 제목\n본문 줄\n\n   \n>\n> 꼬리")).resolves.toBe(true);
    expect(sentText(0)).toBe("> 제목\n> 본문 줄\n>\n>\n>\n> 꼬리");
    for (const line of sentText(0).split("\n")) expect(line.startsWith(">")).toBe(true);

    // 이미 모든 줄이 > 로 시작하는 글(게시판 실패 알림)은 한 글자도 바뀌지 않는다
    const quoted = buildBoardFailureAlert("tp-x", 3, "목록 쪽을 못 읽음");
    await expect(sendPolicyBoardAlert(quoted)).resolves.toBe(true);
    expect(sentText(1)).toBe(quoted);

    // 채널·주소 등 나머지는 그대로
    expect(fetchMock.mock.calls[1][0]).toBe("https://slack.com/api/chat.postMessage");
    expect(JSON.parse(String(fetchMock.mock.calls[1][1].body)).channel).toBe("C123");
  });
});
