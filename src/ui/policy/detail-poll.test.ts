import { describe, expect, it } from "vitest";
import {
  nextPollAction, readingMessageFor, serverKeepsStructurizing,
  NOT_STRUCTURIZED_MESSAGE, READING_MESSAGE, READING_TIMEOUT_MESSAGE,
} from "./detail-poll";

const base = { ok: true, reading: false, gotOnce: false, retriesLeft: 6 };

describe("nextPollAction — 다 읽은 경우", () => {
  it("읽기가 끝났으면 그대로 보여 주고 멈춘다", () => {
    expect(nextPollAction({ ...base, ok: true, reading: false })).toBe("show");
  });
});

describe("nextPollAction — 아직 읽는 중", () => {
  it("횟수가 남았으면 다시 물어본다", () => {
    expect(nextPollAction({ ...base, reading: true, retriesLeft: 1 })).toBe("retry");
  });

  it("횟수를 다 썼으면 안내 문구를 바꾼다", () => {
    expect(nextPollAction({ ...base, reading: true, retriesLeft: 0 })).toBe("waited-out");
  });
});

describe("nextPollAction — 실패했을 때 (핵심)", () => {
  it("첫 조회부터 실패면 오류를 띄운다", () => {
    expect(nextPollAction({ ...base, ok: false, gotOnce: false, retriesLeft: 6 })).toBe("fail");
    expect(nextPollAction({ ...base, ok: false, gotOnce: false, retriesLeft: 0 })).toBe("fail");
  });

  it("이미 보여 준 뒤 실패면 오류를 띄우지 않고 한 번 더 해 본다", () => {
    // 배포 교체 창의 502 하나로 잘 보고 있던 공고가 사라지면 안 된다.
    expect(nextPollAction({ ...base, ok: false, gotOnce: true, retriesLeft: 3 })).toBe("retry");
  });

  it("이미 보여 준 뒤 실패했고 횟수도 다 썼으면 **보고 있던 내용을 그대로 둔다**", () => {
    expect(nextPollAction({ ...base, ok: false, gotOnce: true, retriesLeft: 0 })).toBe("keep");
  });

  it("실패했는데 보여 준 적이 있으면 어떤 경우에도 fail 이 아니다", () => {
    for (const retriesLeft of [0, 1, 6]) {
      expect(nextPollAction({ ...base, ok: false, gotOnce: true, retriesLeft })).not.toBe("fail");
    }
  });
});

/**
 * P4 랩 개편(2026-09-07) — 랩은 상세를 열어도 서버가 AI 구조화를 시작하지 않는다(저장본만 준다).
 * `serverStructurizes:false` 는 `noServerAi` 와 **같은 결과**(폴링 안 함·같은 안내)를 내야 하지만,
 * 서로 다른 이유로 쓰인다: `noServerAi` 는 「AI 0원」 레일, `serverStructurizes:false` 는 「랩엔 AI
 * 구조화 통로가 아예 없음」. 이 시험이 실제로 깨지려면(judge 를 부순다) `serverStructurizes` 를
 * 지우거나 `!==false` 를 `===true` 로 바꾸면 된다 — 둘 다 아래 값 중 하나를 뒤집는다.
 */
describe("serverKeepsStructurizing — 서버가 이 공고를 계속 구조화하는가", () => {
  it("아무것도 안 넘기면(ERP·일루아 기본) 계속 구조화한다", () => {
    expect(serverKeepsStructurizing({})).toBe(true);
  });

  it("serverStructurizes 를 명시적으로 true 로 넘겨도 계속 구조화한다", () => {
    expect(serverKeepsStructurizing({ serverStructurizes: true })).toBe(true);
  });

  it("serverStructurizes:false 면(랩) noServerAi 없이도 구조화를 멈춘다", () => {
    expect(serverKeepsStructurizing({ serverStructurizes: false })).toBe(false);
  });

  it("noServerAi 만 true 여도(상세창 추천 레일) 구조화를 멈춘다 — 예전 그대로", () => {
    expect(serverKeepsStructurizing({ noServerAi: true })).toBe(false);
  });

  it("둘 다 걸려도 멈춘다", () => {
    expect(serverKeepsStructurizing({ noServerAi: true, serverStructurizes: false })).toBe(false);
  });
});

describe("readingMessageFor — 「읽는 중」이 아닐 때 보여줄 안내", () => {
  it("기본값(serverStructurizes 안 넘김) — 기다리는 중이면 기존 「읽는 중」 문구 그대로", () => {
    expect(readingMessageFor({ readWaitedOut: false })).toBe(READING_MESSAGE);
  });

  it("기본값 — 다 기다렸으면 기존 타임아웃 문구 그대로", () => {
    expect(readingMessageFor({ readWaitedOut: true })).toBe(READING_TIMEOUT_MESSAGE);
  });

  it("serverStructurizes:false 면 readWaitedOut 과 무관하게 공통 안내 하나", () => {
    expect(readingMessageFor({ serverStructurizes: false, readWaitedOut: false })).toBe(NOT_STRUCTURIZED_MESSAGE);
    expect(readingMessageFor({ serverStructurizes: false, readWaitedOut: true })).toBe(NOT_STRUCTURIZED_MESSAGE);
  });

  it("serverStructurizes:false 안내에는 「읽는 중」이 한 글자도 없다", () => {
    expect(readingMessageFor({ serverStructurizes: false, readWaitedOut: false })).not.toContain("읽는 중");
  });

  it("noServerAi 만 true 여도 같은 공통 안내를 쓴다", () => {
    expect(readingMessageFor({ noServerAi: true, readWaitedOut: false })).toBe(NOT_STRUCTURIZED_MESSAGE);
  });
});
