// scripts/propagate/watch-deploy.mjs 의 타입 — `npm run typecheck` 가 시험 파일을 검사할 수 있게.
//
// ★왜 `.d.mts` 를 따로 두나: 이 보관함의 `tsconfig.json` 은 `allowJs` 가 꺼져 있어(그리고 켜면
//  `scripts/` 의 다른 .mjs 까지 프로그램에 딸려 들어온다) `.mjs` 를 그대로 가져오면
//  TS7016(암묵적 any)이 난다. 시험이 실제 함수를 부르는 방식(계획서 Task 7)을 유지하면서
//  타입도 지키려고 선언만 옆에 둔다 — 구현은 `.mjs` 한 곳뿐이다.
export interface WaitForCommitOptions {
  /** 이 시간이 지나면 포기한다(밀리초, 기본 1_800_000 = 30분) */
  timeoutMs?: number;
  /** 물어보는 간격(밀리초, 기본 30_000) */
  intervalMs?: number;
  /** 시험용 가짜 fetch. 없으면 부를 때마다 `globalThis.fetch` 를 읽는다 */
  fetchImpl?: (url: string, init?: unknown) => Promise<{ ok?: boolean; status?: number; json(): Promise<unknown> }>;
}

export interface WaitForCommitResult {
  /** 시간 안에 그 SHA 를 봤는가 */
  ok: boolean;
  /** 마지막으로 실제로 본 commitSha(한 번도 못 받았으면 "") */
  lastSeen: string;
  /** 몇 번 물었나 */
  polls: number;
  /** 처음부터 끝까지 걸린 시간(밀리초) */
  waitedMs: number;
}

export declare function waitForCommit(
  url: string,
  sha: string,
  options?: WaitForCommitOptions,
): Promise<WaitForCommitResult>;

export declare function parseArgs(
  argv: string[],
): { error: string } | { url: string; sha: string; timeoutMs: number; intervalMs: number; error?: undefined };
