#!/usr/bin/env node
// scripts/propagate/watch-deploy.mjs — 앱이 공개로 내놓는 build-id 가 봇 커밋 SHA 로 바뀔 때까지 기다린다.
// 계획서: docs/superpowers/plans/2026-09-07-p5-propagate-bot.md (Task 7 · 총괄 결정 6)
//
// 사용: node watch-deploy.mjs <buildIdUrl> <sha40> [timeoutSec=1800] [intervalSec=30]
// 종료 코드: 0 = 배포 확인 · 3 = 시간 안에 못 봄(빌드 실패이거나 지연) · 2 = 인자 오류
//
// ★왜 Railway 토큰을 쓰지 않나(총괄 결정 6): 프로젝트 토큰은 그 환경의 **모든 변수**
//  (운영 DB 주소·AI 열쇠까지)를 읽을 수 있어 공개 저장소 시크릿에 두기엔 폭이 너무 넓다.
//  대신 앱 3곳이 이미 아무 인증 없이 내놓는 `GET /api/build-id`(`{commitSha}`)를 되풀이해 묻는다.
//  비밀값이 하나도 필요 없다. 그 대신 **빌드 실패와 지연을 구분하지 못한다** — 알림 문구에 그렇게 적는다.
//
// ★오류를 실패로 세지 않는 이유: 배포하는 동안 앱은 502·503 을 내거나 HTML 오류 쪽을 돌려준다
//  (ERP 배포창 실측). 그건 「아직」이지 「실패」가 아니다. 그래서 네트워크 오류·비정상 응답·깨진 JSON 은
//  모두 그냥 다음 회차로 넘긴다 — 판정은 오직 「시간 안에 그 SHA 를 봤는가」 하나다.
//
// ★`fetch` 를 모듈 맨 위에서 잡아 두지 않고 **부를 때마다** `globalThis.fetch` 를 읽는 이유:
//  시험이 가짜 fetch 를 끼워 네트워크 없이 시나리오를 돌린다(node 22 전역 fetch 를 그대로 쓰면서).
import { pathToFileURL } from "node:url";

const DEFAULT_TIMEOUT_SEC = 1800; // 30분 — ERP 배포가 보통 15분 안팎(2026-09-07 실측)
const DEFAULT_INTERVAL_SEC = 30;
const HTTP_TIMEOUT_MS = 15_000;
const USAGE = "사용법: watch-deploy.mjs <buildIdUrl> <sha40> [timeoutSec=1800] [intervalSec=30]";

/** 사람이 읽을 시간 — 1분 미만은 초로 적는다(손으로 짧게 돌려볼 때 「최대 0분」이 되지 않게) */
const humanSpan = (ms) => (ms >= 60_000 ? `${Math.round(ms / 60_000)}분` : `${Math.round(ms / 1000)}초`);

/**
 * build-id 를 한 번 물어 `commitSha` 를 돌려준다. 무엇이든 잘못되면 빈 문자열(= 「아직 모름」).
 * 던지지 않는다 — 부르는 쪽의 판정이 「시간 안에 봤는가」 하나로 유지되게.
 */
async function readCommitSha(url, fetchImpl) {
  try {
    const doFetch = fetchImpl ?? globalThis.fetch;
    const res = await doFetch(url, {
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      headers: { accept: "application/json" },
    });
    if (!res || res.ok === false) return "";
    const body = await res.json();
    const seen = body?.commitSha;
    return typeof seen === "string" && /^[0-9a-f]{7,40}$/.test(seen) ? seen : "";
  } catch {
    return "";
  }
}

/**
 * `url` 이 `sha` 를 돌려줄 때까지 `intervalMs` 마다 묻는다. `timeoutMs` 를 넘기면 포기한다.
 * @returns {Promise<{ok: boolean, lastSeen: string, polls: number, waitedMs: number}>}
 *   `lastSeen` 은 마지막으로 실제로 본 SHA(한 번도 못 봤으면 빈 문자열) — 시간 초과 알림에 적는다.
 */
export async function waitForCommit(url, sha, options = {}) {
  const timeoutMs = Number(options.timeoutMs ?? DEFAULT_TIMEOUT_SEC * 1000);
  const intervalMs = Number(options.intervalMs ?? DEFAULT_INTERVAL_SEC * 1000);
  const { fetchImpl } = options;
  const started = Date.now();
  const deadline = started + timeoutMs;
  let lastSeen = "";
  let polls = 0;

  for (;;) {
    polls += 1;
    const seen = await readCommitSha(url, fetchImpl);
    if (seen) lastSeen = seen;
    if (seen === sha) return { ok: true, lastSeen, polls, waitedMs: Date.now() - started };
    // 다음 물음을 시간 안에 못 하면 여기서 끝낸다(자고 일어나 시간을 넘긴 뒤 묻지 않게).
    if (Date.now() + intervalMs >= deadline) {
      return { ok: false, lastSeen, polls, waitedMs: Date.now() - started };
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

/** CLI 인자 검사 — 틀리면 `{ error }`, 맞으면 실행에 쓸 값. */
export function parseArgs(argv) {
  const [url, sha, timeoutSec, intervalSec] = argv;
  if (!url || !/^https?:\/\//.test(url)) return { error: `주소가 http(s) 가 아닙니다: '${url ?? ""}'` };
  if (!/^[0-9a-f]{40}$/.test(sha ?? "")) return { error: `커밋이 40자리 SHA 가 아닙니다: '${sha ?? ""}'` };
  const timeout = timeoutSec === undefined ? DEFAULT_TIMEOUT_SEC : Number(timeoutSec);
  const interval = intervalSec === undefined ? DEFAULT_INTERVAL_SEC : Number(intervalSec);
  if (!Number.isFinite(timeout) || timeout <= 0) return { error: `timeoutSec 이 양수가 아닙니다: '${timeoutSec}'` };
  if (!Number.isFinite(interval) || interval <= 0) return { error: `intervalSec 이 양수가 아닙니다: '${intervalSec}'` };
  return { url, sha, timeoutMs: timeout * 1000, intervalMs: interval * 1000 };
}

// 직접 부른 경우에만 CLI 로 동작한다 — 시험은 위 함수를 그대로 가져다 쓴다.
const invokedAsCli = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedAsCli) {
  const args = parseArgs(process.argv.slice(2));
  if (args.error) {
    process.stderr.write(`watch-deploy: ${args.error}\n${USAGE}\n`);
    process.exit(2);
  }
  process.stdout.write(
    `watch-deploy: ${args.url} 이 ${args.sha.slice(0, 7)} 을 돌려줄 때까지 ` +
      `${Math.round(args.intervalMs / 1000)}초마다 확인합니다 (최대 ${humanSpan(args.timeoutMs)})\n`,
  );
  const result = await waitForCommit(args.url, args.sha, { timeoutMs: args.timeoutMs, intervalMs: args.intervalMs });
  if (result.ok) {
    process.stdout.write(
      `watch-deploy: 배포 확인 ${args.sha.slice(0, 7)} (${Math.round(result.waitedMs / 1000)}초 · ${result.polls}회 확인)\n`,
    );
    process.exit(0);
  }
  process.stderr.write(
    `watch-deploy: ${humanSpan(args.timeoutMs)} 안에 ${args.sha.slice(0, 7)} 이 나타나지 않았습니다 ` +
      `(${result.polls}회 확인). 마지막으로 본 SHA: ${result.lastSeen || "(응답 없음)"}\n`,
  );
  process.exit(3);
}
