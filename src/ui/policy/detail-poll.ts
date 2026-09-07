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

/**
 * 이 두 값이 앱마다 다른 것을 「서버가 이 공고를 계속 구조화하는가」로 정한다 — 상세가 다시
 * 물어볼지(폴링)와 「읽는 중」 안내를 둘 다 이 하나로 정한다(P4 랩 개편, 2026-09-07).
 *
 * `noServerAi`(상세창 추천 레일처럼 서버 AI 자체를 안 부르는 통로)나 `serverStructurizes`가
 * `false`(저장된 구조만 주는 앱 — 랩)면, 서버가 이 공고를 다시 구조화할 일이 없다. 그때 상태가
 * `pending`이어도 「읽는 중」으로 다시 물어보면 전부 헛통신이다
 * (2026-08-30 독립 검사: 카드 1클릭에 조회 7회 — noServerAi 통로에서 이미 겪은 결함).
 * `serverStructurizes` 를 안 넘기면(undefined) **true 로 본다** — ERP·일루아처럼 서버가 첫 열람에
 * 구조화를 시작하는 앱은 이 값을 몰라도 예전 그대로 움직인다.
 */
export function serverKeepsStructurizing(opts: { noServerAi?: boolean; serverStructurizes?: boolean }): boolean {
  return !opts.noServerAi && opts.serverStructurizes !== false;
}

/** 아직 구조화하지 않은 공고를 서버가 이제 와서 다시 읽어 줄 리 없는 통로의 공통 안내. */
export const NOT_STRUCTURIZED_MESSAGE = "이 공고는 아직 요약이 준비되지 않았습니다 — 원문을 확인해 주세요";
/** 서버가 실제로 구조화 중일 때의 안내 — AI 요약 탭과 같은 말로 통일한다(2026-08-22 독립 화면 검사 2번). */
export const READING_MESSAGE = "공고 읽는 중 — 잠시 후 제공됩니다";
/** 다 기다려도 안 끝났을 때. 「잠시 후」라고만 두면 화면이 영영 안 바뀌어 거짓말이 된다. */
export const READING_TIMEOUT_MESSAGE = "공고 읽는 중 — 잠시 뒤 다시 열어 보세요";

/**
 * 「읽는 중」이 아닐 때 상세 화면에 보여줄 안내 한 줄. `serverKeepsStructurizing` 이 거짓이면
 * (서버가 다시 구조화하지 않는 통로) `readWaitedOut` 과 무관하게 같은 공통 문구를 쓴다 — 서버가
 * 다시 읽어줄 계획이 없으니 「잠시 후」·「잠시 뒤 다시」라는 말 자체가 거짓이 된다.
 */
export function readingMessageFor(opts: {
  noServerAi?: boolean;
  serverStructurizes?: boolean;
  readWaitedOut: boolean;
}): string {
  if (!serverKeepsStructurizing(opts)) return NOT_STRUCTURIZED_MESSAGE;
  return opts.readWaitedOut ? READING_TIMEOUT_MESSAGE : READING_MESSAGE;
}
