/**
 * 공고 상세를 「다시 물어볼지」 정하는 규칙 — 화면에서 떼어내 시험할 수 있게 한 순수 함수.
 *
 * 왜 규칙이 필요한가: 서버는 20초만 기다렸다 「읽는 중」으로 돌려준다. 그대로 두면 화면이 영영
 * 그 문구다. 그래서 몇 초 간격으로 몇 번만 다시 물어본다. 그런데 다시 물어보다 실패했을 때
 * 보고 있던 내용을 지우면, 배포 교체 창처럼 몇 초 끊기는 흔한 일에 **잘 보고 있던 공고가 사라진다**
 * (2026-08-24 화면 독립 검사가 실제로 잡았다 — 다른 세션 배포로 502가 나 오른쪽이 통째로 비었다).
 */
export type PollAction =
  /** 다 받았다 — 그대로 보여 주고 멈춘다. */
  | "show"
  /** 아직이다 — 잠시 뒤 한 번 더 물어본다. */
  | "retry"
  /** 다 기다렸는데 아직 읽는 중 — 안내 문구를 「잠시 뒤 다시 열어 보세요」로 바꾼다. */
  | "waited-out"
  /** 첫 조회부터 실패 — 보여 줄 것이 없으니 오류를 띄운다. */
  | "fail"
  /** 다시 물어보다 실패했고 더 해 볼 횟수도 없다 — **보고 있던 내용을 그대로 둔다.** */
  | "keep";

export interface PollInput {
  /** 응답이 성공이었나. */
  ok: boolean;
  /** 성공했을 때, 그 공고가 아직 읽는 중 상태인가. */
  reading: boolean;
  /** 이번 공고를 이미 한 번이라도 받아 봤나. */
  gotOnce: boolean;
  /** 남은 「다시 물어보기」 횟수. */
  retriesLeft: number;
}

export function nextPollAction({ ok, reading, gotOnce, retriesLeft }: PollInput): PollAction {
  if (ok) {
    if (!reading) return "show";
    return retriesLeft > 0 ? "retry" : "waited-out";
  }
  // 한 번도 못 받았으면 보여 줄 것이 없다 — 그때만 오류를 띄운다.
  if (!gotOnce) return "fail";
  return retriesLeft > 0 ? "retry" : "keep";
}
