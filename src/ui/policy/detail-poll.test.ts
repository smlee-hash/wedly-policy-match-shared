import { describe, expect, it } from "vitest";
import { nextPollAction } from "./detail-poll";

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
