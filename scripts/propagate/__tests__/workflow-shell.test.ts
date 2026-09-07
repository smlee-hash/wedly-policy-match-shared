import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { runBlocks } from "./yaml-run-blocks";

/**
 * `propagate.yml` 안의 셸 토막을 **잘라 내어 실제로 돌리는** 시험 — 2026-09-08 2차 리뷰 F6·F1.
 * 두 자리를 잰다: 「무엇을 반영할지 정하는」 `resolve` 토막과 「실패를 알리는」 토막.
 *
 * ★이 토막이 하는 일: 「무엇을 반영할지」를 하나로 정한다. 그 판정이 틀리면 3앱이 통째로
 *  틀린 커밋으로 간다. 그런데 워크플로우는 여기서 실행해 볼 수 없어서(GitHub 안에서만 돈다)
 *  글자 대조만 하면 **논리가 뒤집혀도 초록**이다. 그래서 `run:` 토막을 그대로 잘라
 *  진짜 git 저장소와 가짜 `gh` 로 돌려 결과(`GITHUB_OUTPUT` 의 sha)를 잰다.
 *
 * ★F6 이 막는 사고: 같은 줄에서 대기 중인 실행은 GitHub 가 **최신 하나만** 남긴다.
 *  옛 커밋의 CI 가 늦게 끝나 뒤늦게 도착하면, 그 실행이 **최신 커밋의 대기 실행을 밀어내고**
 *  자기(옛) 커밋으로 핀을 올린다 → 최신 핀은 아무도 반영하지 않은 채 남는다.
 *  그래서 최신 커밋(TIP)도 CI 를 통과했으면 그쪽으로 올린다. 확인이 안 되면 원래대로 간다.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const YAML = readFileSync(resolve(HERE, "../../../.github/workflows/propagate.yml"), "utf8");

/** `resolve` job 의 `pick` 단계 셸 토막 */
const PICK = (() => {
  const found = runBlocks(YAML).filter((b) => b.includes("propagate: 반영 대상"));
  if (found.length !== 1) throw new Error(`resolve 의 pick 토막을 하나로 찾지 못했습니다(${found.length}개)`);
  return found[0];
})();

function sh(cmd: string, cwd: string) {
  const r = spawnSync("bash", ["-c", cmd], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" },
  });
  if (r.status !== 0) throw new Error(`${cmd}\n${r.stdout}\n${r.stderr}`);
  return r.stdout.trim();
}

/** 가짜 패키지 저장소: A → B(=main 끝). `origin/main` 은 손으로 세운다(원격 없이) */
function repo(tmp: string) {
  const dir = join(tmp, "pkg");
  mkdirSync(dir, { recursive: true });
  sh("git init -q -b main && git config user.email t@t && git config user.name t", dir);
  const commit = (n: string) => {
    writeFileSync(join(dir, "f.txt"), n);
    sh(`git add . && git commit -qm "${n}"`, dir);
    return sh("git rev-parse HEAD", dir);
  };
  const a = commit("옛 커밋");
  const b = commit("최신 커밋");
  sh(`git update-ref refs/remotes/origin/main ${b}`, dir);
  return { dir, a, b };
}

/**
 * 가짜 `gh`: 부른 인자를 적어 두고 `FAKE_GH_MODE` 를 그대로 돌려준다.
 * `boom` 이면 진짜 `gh` 가 인증·네트워크로 죽었을 때처럼 1 로 끝난다.
 */
function fakeGh(tmp: string) {
  const bin = join(tmp, "bin");
  mkdirSync(bin, { recursive: true });
  const gh = join(bin, "gh");
  writeFileSync(
    gh,
    [
      "#!/usr/bin/env bash",
      "set -u",
      `printf '%s\\n' "$*" >> "$FAKE_GH_LOG"`,
      `if [ "$FAKE_GH_MODE" = "boom" ]; then echo "gh: 물어보지 못했습니다" >&2; exit 1; fi`,
      `printf '%s\\n' "$FAKE_GH_MODE"`,
      "",
    ].join("\n"),
  );
  chmodSync(gh, 0o755);
  return bin;
}

interface PickRun {
  code: number | null;
  stdout: string;
  stderr: string;
  /** GITHUB_OUTPUT 에 적힌 key=value 를 풀어 놓은 것 */
  out: Record<string, string>;
  /** 가짜 gh 가 받은 호출(줄마다 하나) */
  ghCalls: string[];
}

function runPick(tmp: string, dir: string, env: Record<string, string>): PickRun {
  const outFile = join(tmp, `out-${Math.random().toString(36).slice(2)}.txt`);
  const ghLog = join(tmp, `gh-${Math.random().toString(36).slice(2)}.log`);
  writeFileSync(outFile, "");
  writeFileSync(ghLog, "");
  const r = spawnSync("bash", ["-c", PICK], {
    cwd: dir,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_SYSTEM: "/dev/null",
      PATH: `${fakeGh(tmp)}:${process.env.PATH}`,
      FAKE_GH_LOG: ghLog,
      FAKE_GH_MODE: "0",
      GITHUB_OUTPUT: outFile,
      GITHUB_REPOSITORY: "smlee-hash/wedly-policy-match-shared",
      GITHUB_EVENT_NAME: "workflow_run",
      GH_TOKEN: "가짜-토큰",
      INPUT_SHA: "",
      INPUT_DRY_RUN: "",
      WORKFLOW_RUN_SHA: "",
      ...env,
    },
  });
  const out: Record<string, string> = {};
  for (const line of readFileSync(outFile, "utf8").split("\n")) {
    const at = line.indexOf("=");
    if (at > 0) out[line.slice(0, at)] = line.slice(at + 1);
  }
  return {
    code: r.status,
    stdout: r.stdout,
    stderr: r.stderr,
    out,
    ghCalls: readFileSync(ghLog, "utf8").split("\n").filter(Boolean),
  };
}

describe("propagate.yml — resolve(pick) 셸 토막", () => {
  let tmp: string;
  let pkg: ReturnType<typeof repo>;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "resolve-pick-"));
    pkg = repo(tmp);
  }, 30_000);

  it("최신 커밋의 CI 가 이미 통과했으면 그쪽으로 올린다 — 늦게 온 옛 반영이 최신 핀을 묻지 않게", () => {
    const r = runPick(tmp, pkg.dir, { WORKFLOW_RUN_SHA: pkg.a, FAKE_GH_MODE: "1" });
    expect(r.code, r.stderr).toBe(0);
    expect(r.out.sha).toBe(pkg.b);
    expect(r.out.subject).toBe("최신 커밋");
    expect(r.out.dry_run).toBe("false");
    expect(r.stdout).toContain("최신 커밋으로 올림");
    // 물어본 곳이 맞는지(ci.yml 의 그 커밋 성공 실행)
    expect(r.ghCalls.join("\n")).toContain(`actions/workflows/ci.yml/runs?head_sha=${pkg.b}&status=success`);
  }, 30_000);

  it("최신 커밋의 CI 성공 기록이 없으면 원래 커밋 그대로 간다", () => {
    const r = runPick(tmp, pkg.dir, { WORKFLOW_RUN_SHA: pkg.a, FAKE_GH_MODE: "0" });
    expect(r.code, r.stderr).toBe(0);
    expect(r.out.sha).toBe(pkg.a);
    expect(r.out.subject).toBe("옛 커밋");
    expect(r.stdout).toContain("찾지 못해");
  }, 30_000);

  it("물어보다 실패해도 막지 않는다 — 원래 커밋 그대로 간다", () => {
    const r = runPick(tmp, pkg.dir, { WORKFLOW_RUN_SHA: pkg.a, FAKE_GH_MODE: "boom" });
    expect(r.code, r.stderr).toBe(0);
    expect(r.out.sha).toBe(pkg.a);
    expect(r.ghCalls).toHaveLength(1);
  }, 30_000);

  it("이미 최신 커밋이면 아무것도 물어보지 않는다 — 쓸데없는 호출을 만들지 않는다", () => {
    const r = runPick(tmp, pkg.dir, { WORKFLOW_RUN_SHA: pkg.b, FAKE_GH_MODE: "1" });
    expect(r.code, r.stderr).toBe(0);
    expect(r.out.sha).toBe(pkg.b);
    expect(r.ghCalls).toEqual([]);
  }, 30_000);

  it("손으로 돌린 실행은 승격하지 않는다 — 사람이 고른 커밋을 바꾸지 않는다", () => {
    const r = runPick(tmp, pkg.dir, {
      GITHUB_EVENT_NAME: "workflow_dispatch",
      INPUT_SHA: pkg.a,
      INPUT_DRY_RUN: "true",
      FAKE_GH_MODE: "1",
    });
    expect(r.code, r.stderr).toBe(0);
    expect(r.out.sha).toBe(pkg.a);
    expect(r.out.dry_run).toBe("true");
    expect(r.ghCalls).toEqual([]);
  }, 30_000);

  it("main 에 없는 커밋은 1 로 막는다(승격 이전 판정이 그대로 산다)", () => {
    const orphan = "0".repeat(40);
    const r = runPick(tmp, pkg.dir, { WORKFLOW_RUN_SHA: orphan, FAKE_GH_MODE: "1" });
    expect(r.code).toBe(1);
    expect(r.stdout + r.stderr).toMatch(/main 에 없습니다/);
    expect(r.out.sha).toBeUndefined();
  }, 30_000);
});

/**
 * 밀기 job 의 「실패 알림」 토막 — 2026-09-08 2차 리뷰 F1·F7.
 *
 * ★이 토막이 하는 일: 준비 단계가 남긴 사유(`meta.json` 의 `error`)를 **파일에서 읽어** 알림 인자로 넘긴다.
 *  준비 job 에는 알림이 없으므로(앱 코드가 돈 자리에서 열쇠를 쓰지 않으려고), **이 자리가 유일한 알림**이다.
 *  그래서 여기서 사유가 안 실리면 사람은 「무엇이 실패했는지」를 로그를 파야만 안다.
 *
 * ★같이 재는 것: 커밋 제목처럼 **아무나 적을 수 있는 글자**가 셸 명령이 되지 않는지.
 *  `env:` 로 받아 `"$변수"` 로 읽으면 셸은 그것을 자료로 다룬다 — 그 성질을 실제 실행으로 잰다.
 */
const NOTIFY_FAILURE = (() => {
  const found = runBlocks(YAML).filter((b) => b.includes("notify.sh") && b.includes("meta.json"));
  if (found.length !== 1) throw new Error(`실패 알림 토막을 하나로 찾지 못했습니다(${found.length}개)`);
  return found[0];
})();

const REPO_ROOT = resolve(HERE, "../../..");

/** 가짜 curl: 받은 인자를 그대로 적어 두고 200 을 돌려준다(네트워크 없음) */
function fakeCurl(tmp: string) {
  const bin = join(tmp, "curl-bin");
  mkdirSync(bin, { recursive: true });
  const curl = join(bin, "curl");
  writeFileSync(
    curl,
    ["#!/usr/bin/env bash", "set -u", `printf '%s\n' "$*" >> "$FAKE_CURL_ARGS"`, `printf '200'`, ""].join("\n"),
  );
  chmodSync(curl, 0o755);
  return bin;
}

describe("propagate.yml — 밀기 job 의 실패 알림 토막", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "notify-block-"));
  }, 30_000);

  function runNotifyBlock(meta: Record<string, string> | null, env: Record<string, string> = {}) {
    const out = join(tmp, "propagate-out");
    rmSync(out, { recursive: true, force: true });
    mkdirSync(out, { recursive: true });
    if (meta) writeFileSync(join(out, "meta.json"), JSON.stringify(meta, null, 2) + "\n");
    const args = join(tmp, `curl-args-${Math.random().toString(36).slice(2)}.txt`);
    writeFileSync(args, "");
    const r = spawnSync("bash", ["-c", NOTIFY_FAILURE], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${fakeCurl(tmp)}:${process.env.PATH}`,
        FAKE_CURL_ARGS: args,
        PROPAGATE_OUT: out,
        APP_ID: "erp",
        RUN_URL: "https://example.test/run/1",
        PKG_SHA: "b404b4b1f44d0ffb8213fff771a0bec090ca6257",
        PKG_SUBJECT: "feat: 보통 제목",
        WEDLY_NOTIFY_URL: "https://erp.example.test",
        WEDLY_NOTIFY_KEY: "시험용-가짜-열쇠",
        ...env,
      },
    });
    return { code: r.status, stdout: r.stdout, stderr: r.stderr, curlArgs: readFileSync(args, "utf8") };
  }

  it("준비 단계가 남긴 사유가 알림 줄에 실린다", () => {
    const r = runNotifyBlock({
      app: "erp",
      result: "failed",
      error: "후처리 실패: npm run design:check",
    });
    expect(r.code, r.stderr).toBe(0);
    expect(r.curlArgs).toContain("사유: 후처리 실패: npm run design:check");
    expect(r.curlArgs).toContain("정책매칭 공용 자동 반영 실패: erp");
    expect(r.curlArgs).toContain("https://example.test/run/1");
  }, 30_000);

  it("산출물을 못 받았으면 그렇게 알린다 — 조용히 넘어가지 않는다", () => {
    const r = runNotifyBlock(null);
    expect(r.code, r.stderr).toBe(0);
    expect(r.curlArgs).toContain("준비 단계 산출물을 받지 못했습니다");
  }, 30_000);

  it("커밋 제목에 명령을 숨겨도 글자로만 실린다 — 셸에서 실행되지 않는다", () => {
    const canary = join(tmp, "카나리아.txt");
    const r = runNotifyBlock(
      { app: "erp", result: "failed", error: `사유에도 $(touch "${canary}") 숨겨 본다` },
      { PKG_SUBJECT: `feat: $(touch "${canary}") 제목` },
    );
    expect(r.code, r.stderr).toBe(0);
    expect(existsSync(canary), "커밋 제목·사유 안의 명령이 실행됐습니다").toBe(false);
    expect(r.curlArgs).toContain("touch");
  }, 30_000);
});
