const DEFAULT_CHANNEL = "C0B3L7XS2AY";
const SLACK_TIMEOUT_MS = 10_000;

/** 게시판 수집 최후 알림. 토큰·채널이 없으면 경고만 하고 성공으로 끝낸다. */
export async function sendPolicyBoardAlert(text: string): Promise<boolean> {
  const token = String(process.env.SLACK_BOT_TOKEN ?? "").trim();
  const channel = String(process.env.POLICY_BOARD_SLACK_CHANNEL ?? DEFAULT_CHANNEL).trim();
  if (!token || !channel) {
    console.warn("[policy-board] 슬랙 설정(SLACK_BOT_TOKEN·채널)이 없어 보내지 않았습니다");
    return true;
  }
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), SLACK_TIMEOUT_MS);
  try {
    const res = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ channel, text, unfurl_links: false, unfurl_media: false }),
      signal: ac.signal,
    });
    if (!res.ok) return false;
    const json = (await res.json()) as { ok?: boolean; error?: string };
    if (json.ok === true) return true;
    console.warn("[policy-board] 슬랙이 거절했습니다:", json.error);
    return false;
  } catch (e) {
    console.warn("[policy-board] 슬랙 전송 실패", e);
    return false;
  } finally {
    clearTimeout(timer);
  }
}
