import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { waitForCommit } from "../watch-deploy.mjs";

/**
 * `scripts/propagate/watch-deploy.mjs` 시험 — 계획서 Task 7(총괄 결정 6).
 *
 * ★이 감시기가 하는 일: 봇이 앱 핀을 올려 밀면, 그 커밋이 **실제로 배포됐는지**를 앱이 공개로
 *  내놓는 `GET /api/build-id`(`{commitSha}`)로 확인한다. 30분 안에 안 나타나면 슬랙으로 알린다.
 *
 * ★그래서 이 시험이 막는 사고 3가지:
 *  1) 배포가 안 됐는데 「됐다」고 초록으로 넘어가는 것(= 아무도 모르는 사이 옛 코드가 그대로 산다)
 *  2) 배포창의 502·깨진 응답·네트워크 오류를 **실패로 세어** 멀쩡한 배포를 실패라고 알리는 것
 *  3) 시간 초과 알림에 「마지막으로 본 SHA」가 빠져 사람이 무엇이 살아 있는지 모르는 것
 *
 * ★재는 방식: 네트워크를 쓰지 않는다. 가짜 fetch 를 끼우고 간격을 10ms 로 줄여 **진짜 함수**를 돌린다.
 *  CLI 갈래(인자 오류 exit 2)만 실제 프로세스로 1건 잰다 — 종료 코드는 프로세스로만 잴 수 있다.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(HERE, "../watch-deploy.mjs");
const URL_ = "https://wedly-erp-production.up.railway.app/api/build-id";
const OLD = "a35d6e19f3aaf027032b0ecae11696dc47075f96";
const NEW = "b404b4b1f44d0ffb8213fff771a0bec090ca6257";

/** 실제 응답 흉내: `{ok, status, json()}` 만 쓴다 */
const ok = (commitSha: string) => ({ ok: true, status: 200, json: async () => ({ buildId: "x", commitSha }) });

/** 미리 짜 둔 응답을 순서대로 돌려주는 가짜 fetch(다 쓰면 마지막 것을 되풀이한다) */
function fakeFetch(steps: Array<() => unknown>) {
  const calls: string[] = [];
  const fn = async (url: string) => {
    calls.push(url);
    const step = steps[Math.min(calls.length - 1, steps.length - 1)];
    return step() as never;
  };
  return { fn, calls };
}

describe("watch-deploy.mjs", () => {
  it("옛 SHA 였다가 새 SHA 가 나오면 배포 확인", async () => {
    const f = fakeFetch([() => ok(OLD), () => ok(NEW)]);
    const r = await waitForCommit(URL_, NEW, { timeoutMs: 2000, intervalMs: 10, fetchImpl: f.fn });
    expect(r.ok).toBe(true);
    expect(r.lastSeen).toBe(NEW);
    expect(r.polls).toBe(2);
    expect(f.calls[0]).toBe(URL_);
  });

  it("계속 옛 SHA 면 시간 초과 — 마지막으로 본 SHA 를 함께 돌려준다", async () => {
    const f = fakeFetch([() => ok(OLD)]);
    const r = await waitForCommit(URL_, NEW, { timeoutMs: 60, intervalMs: 10, fetchImpl: f.fn });
    expect(r.ok).toBe(false);
    expect(r.lastSeen).toBe(OLD); // 알림에 적을 값 — 「무엇이 아직 살아 있는지」
    expect(r.polls).toBeGreaterThan(1); // 한 번 보고 포기하지 않는다
  });

  it("네트워크 오류·502·깨진 JSON 은 실패가 아니라 「아직」 — 넘기고 계속 묻는다", async () => {
    const f = fakeFetch([
      () => {
        throw new Error("fetch failed"); // 배포창에 연결 자체가 안 되는 순간
      },
      // Railway 배포창의 502 — 몸통에 무엇이 적혀 있든 200 이 아니면 믿지 않는다
      () => ({ ok: false, status: 502, json: async () => ({ commitSha: NEW }) }),
      () => ({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError("Unexpected token < in JSON"); // HTML 오류 쪽이 온 경우
        },
      }),
      () => ok(NEW),
    ]);
    const r = await waitForCommit(URL_, NEW, { timeoutMs: 2000, intervalMs: 10, fetchImpl: f.fn });
    expect(r.ok).toBe(true);
    expect(r.polls).toBe(4);
  });

  it("한 번도 응답을 못 받으면 lastSeen 은 비어 있다(응답 없음)", async () => {
    const f = fakeFetch([
      () => {
        throw new Error("fetch failed");
      },
    ]);
    const r = await waitForCommit(URL_, NEW, { timeoutMs: 60, intervalMs: 10, fetchImpl: f.fn });
    expect(r.ok).toBe(false);
    expect(r.lastSeen).toBe("");
  });

  it("CLI: 인자가 모자라면 2 로 끝나고 사용법을 알린다", () => {
    const r = spawnSync(process.execPath, [SCRIPT, URL_], { encoding: "utf8" });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/40자리 SHA/);
    expect(r.stderr).toMatch(/사용법/);
  }, 30_000);
});
