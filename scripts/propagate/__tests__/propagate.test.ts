import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";

/**
 * `scripts/propagate/propagate.sh` 시나리오 시험 — 계획서 Task 3(설계서 §6 D1·D2),
 * 2026-09-08 리뷰 R2 로 **clone → prepare → push 세 단계**가 된 뒤의 판.
 *
 * ★이 봇이 하는 일: 공용 보관함에 커밋이 올라가면 앱 3곳(ERP·일루아·랩)의
 *  `@wedly/policy-match-shared` 핀을 새 SHA 로 올려 커밋·푸시한다. 사람이 손으로 맞추던 일이다.
 *
 * ★단계를 나눈 이유(리뷰 R2 · 여기서 실제로 재는 것):
 *  토큰을 쥔 자리에서 앱 코드를 돌리지 않는다. `prepare` 는 토큰 없이 npm·후처리를 돌려
 *  **파일만** 산출물 폴더에 담고, `push` 는 새로 클론해 그 파일을 얹어 밀기만 한다.
 *  그래서 「push 단계가 npm 을 한 번도 부르지 않는다」가 시험 항목이다 —
 *  그 줄이 빨개지면 앱 코드가 다시 토큰 옆으로 돌아온 것이다.
 *
 * ★그래서 이 시험이 막는 사고들:
 *  1) 핀만 올리고 잠금 파일이 옛 SHA 로 남는 것(= 새 핀인데 옛 코드로 배포)
 *  2) 순서가 뒤집혀 핀이 **뒤로 가는** 것(늦게 도착한 옛 반영이 새 핀을 덮어씀)
 *  3) 봇이 핀 말고 **다른 파일까지** 커밋하는 것
 *  4) 준비와 밀기 사이에 사람이 민 커밋을 **잃는** 것(다른 파일이면 rebase 로 살리고, 같은 파일이면 멈춘다)
 *  5) 토큰이 화면·산출물에 새는 것
 *
 * ★재는 방식: 글자 대조가 아니라 **진짜 스크립트를 진짜 git 저장소에서 돌린다.**
 *  - 가짜 패키지 저장소(c1→c2→c3, 곁가지 x1)로 「후손인가」 판정을 실제 `merge-base` 로 시킨다
 *  - 가짜 앱 저장소는 bare 원격까지 만들어 **진짜 푸시**를 받는다(커밋이 원격에 남았는지로 판정)
 *  - `npm` 만 PATH 앞의 shim 으로 바꾼다(네트워크·설치 시간 없이 잠금 파일 갱신을 흉내)
 *  - 단계마다 **다른 npm 기록 파일·다른 GITHUB_OUTPUT** 을 줘 어느 단계가 무엇을 했는지 따로 잰다
 *
 * ★`__dirname` 대신 `fileURLToPath(import.meta.url)`: 이 보관함은 `"type": "module"`(ESM).
 * ★git 설정을 `/dev/null` 로 격리: 사람의 전역 설정(`core.hooksPath`·`commit.gpgsign` 등)이
 *  시험 결과를 바꾸면 안 된다.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(HERE, "../propagate.sh");
const LIB = resolve(HERE, "../lib.sh");
const REPO = "smlee-hash/wedly-policy-match-shared";
const SPEC = (sha: string) => `github:${REPO}#${sha}`;
const RESOLVED = (sha: string) => `git+ssh://git@github.com/${REPO}.git#${sha}`;

/** 시험용 git 은 사람의 전역·시스템 설정을 읽지 않는다 */
const HERMETIC_GIT = {
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_TERMINAL_PROMPT: "0",
};

function sh(cmd: string, cwd: string, env: NodeJS.ProcessEnv = {}) {
  const r = spawnSync("bash", ["-c", cmd], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...HERMETIC_GIT, ...env },
  });
  if (r.status !== 0) throw new Error(`${cmd}\n${r.stdout}\n${r.stderr}`);
  return r.stdout.trim();
}

/** 가짜 패키지 저장소: c1 → c2 → c3 (main), 갈래 x1(c1 에서 딴 것) */
function fakePackage(tmp: string) {
  const dir = join(tmp, "pkg");
  mkdirSync(dir, { recursive: true });
  sh("git init -q -b main && git config user.email t@t && git config user.name t", dir);
  const commit = (n: string) => {
    writeFileSync(join(dir, "f.txt"), n);
    sh(`git add . && git commit -qm "${n}"`, dir);
    return sh("git rev-parse HEAD", dir);
  };
  const c1 = commit("c1");
  const c2 = commit("c2");
  const c3 = commit("c3");
  sh(`git checkout -q -b side ${c1}`, dir);
  const x1 = commit("x1");
  sh("git checkout -q main", dir);
  return { dir, c1, c2, c3, x1 };
}

/** 가짜 앱: package.json·package-lock 핀 = pinSha, bare 원격 포함 */
function fakeApp(tmp: string, name: string, pinSha: string, extra?: (work: string) => void) {
  const work = join(tmp, `${name}-seed`);
  mkdirSync(work, { recursive: true });
  writeFileSync(
    join(work, "package.json"),
    JSON.stringify({ name, dependencies: { "@wedly/policy-match-shared": SPEC(pinSha) } }, null, 2) + "\n",
  );
  writeFileSync(
    join(work, "package-lock.json"),
    JSON.stringify(
      {
        lockfileVersion: 3,
        packages: {
          "": { dependencies: { "@wedly/policy-match-shared": SPEC(pinSha) } },
          "node_modules/@wedly/policy-match-shared": { resolved: RESOLVED(pinSha), integrity: "sha512-seed" },
        },
      },
      null,
      2,
    ) + "\n",
  );
  writeFileSync(join(work, ".gitignore"), "node_modules\n");
  writeFileSync(join(work, "README.md"), "app\n");
  extra?.(work);
  sh("git init -q -b main && git config user.email t@t && git config user.name t && git add . && git commit -qm seed", work);
  const bare = join(tmp, `${name}.git`);
  sh(`git clone -q --bare "${work}" "${bare}"`, tmp);
  return { work, bare };
}

/**
 * 사람이 앱 저장소에 직접 미는 상황 — **준비와 밀기 사이**의 경합을 만든다.
 * 봇의 push 단계는 그때 이미 옛 커밋(baseSha) 위에 얹으므로 푸시가 거부되고 rebase 로 이어진다.
 */
function humanPush(tmp: string, bare: string, edit: (dir: string) => void, message: string) {
  const dir = join(tmp, `human-${Math.random().toString(36).slice(2)}`);
  sh(`git clone -q "${bare}" "${dir}"`, tmp);
  sh("git config user.email h@t && git config user.name 사람", dir);
  edit(dir);
  sh(`git add -A && git commit -qm "${message}" && git push -q origin HEAD:main`, dir);
}

/**
 * 가짜 npm: `pkg set` 은 package.json 을 실제로 고치고, `install` 은 잠금 파일을 새 SHA 로 고친다.
 * `ci` 는 설치 잠금(node_modules/.package-lock.json)을 쓴다. `run` 은 **진짜 npm 과 같은 뜻으로**
 * package.json 의 `scripts` 를 읽어 그 문자열을 셸로 돌린다(`A && B` 묶음도 그대로).
 * 그 밖의 부명령은 실패(9)로 알린다 — 스크립트가 예상 밖 npm 호출을 하면 조용히 넘어가지 않게.
 *
 * ★`run` 이 필요한 이유: 봇의 ERP 후처리가 `npm run design:check` 다(apps.json). Railway 가 ERP
 *  `build` 첫 단계로 돌리는 바로 그 명령이라 봇도 같은 것을 돌려야 한다. 여기서 `run` 을 흉내만 내고
 *  아무것도 실행하지 않으면 「봇 시험은 초록인데 Railway 는 빨간」 상태를 시험이 못 잡는다.
 */
function fakeNpm(tmp: string) {
  const bin = join(tmp, "bin");
  mkdirSync(bin, { recursive: true });
  const npm = join(bin, "npm");
  writeFileSync(
    npm,
    `#!/usr/bin/env bash
set -e
log="$FAKE_NPM_LOG"; echo "npm $*" >> "$log"
# 시험용 스위치: FAKE_NPM_FAIL 에 적힌 부명령은 npm 처럼 큰 종료 코드로 죽는다(진짜 npm 은 128 도 낸다)
if [ -n "$FAKE_NPM_FAIL" ] && [ "$1" = "$FAKE_NPM_FAIL" ]; then
  echo "fake npm: $1 을(를) 일부러 실패시켰습니다" >&2
  exit 128
fi
case "$1" in
  pkg) node -e '
    const fs = require("fs");
    const arg = process.argv[1];
    const at = arg.indexOf("=");
    const k = arg.slice(0, at), v = arg.slice(at + 1);
    const keys = k.split(".");
    const p = JSON.parse(fs.readFileSync("package.json", "utf8"));
    p[keys[0]][keys.slice(1).join(".")] = v;
    fs.writeFileSync("package.json", JSON.stringify(p, null, 2) + "\\n");' "$3" ;;
  install) node -e '
    const fs = require("fs");
    const p = JSON.parse(fs.readFileSync("package.json", "utf8"));
    const spec = p.dependencies["@wedly/policy-match-shared"];
    const sha = spec.split("#")[1];
    const l = JSON.parse(fs.readFileSync("package-lock.json", "utf8"));
    l.packages[""].dependencies["@wedly/policy-match-shared"] = spec;
    l.packages["node_modules/@wedly/policy-match-shared"] = {
      resolved: "git+ssh://git@github.com/smlee-hash/wedly-policy-match-shared.git#" + sha,
      integrity: "sha512-" + sha.slice(0, 8),
    };
    fs.writeFileSync("package-lock.json", JSON.stringify(l, null, 2) + "\\n");' ;;
  ci) node -e '
    const fs = require("fs");
    const l = JSON.parse(fs.readFileSync("package-lock.json", "utf8"));
    fs.mkdirSync("node_modules", { recursive: true });
    fs.writeFileSync("node_modules/.package-lock.json", JSON.stringify({
      packages: { "node_modules/@wedly/policy-match-shared": l.packages["node_modules/@wedly/policy-match-shared"] },
    }));' ;;
  run)
    # package.json 의 scripts 에서 명령 문자열을 꺼내 셸로 돌린다(진짜 npm 과 같은 동작).
    # 없는 script 면 진짜 npm 처럼 1 로 죽는다 — set -e 가 여기서 스크립트를 멈춘다.
    CMD="$(node -e '
      const fs = require("fs");
      const name = process.argv[1];
      const s = (JSON.parse(fs.readFileSync("package.json", "utf8")).scripts || {})[name];
      if (!s) { console.error("fake npm: Missing script: " + name); process.exit(1); }
      process.stdout.write(s);' "$2")"
    bash -c "$CMD" ;;
  *) echo "fake npm: unknown $1" >&2; exit 9 ;;
esac
`,
  );
  chmodSync(npm, 0o755);
  return bin;
}

interface StepRun {
  code: number | null;
  stdout: string;
  stderr: string;
  /** 그 단계가 GITHUB_OUTPUT 에 적은 것 */
  out: string;
  /** 그 단계가 부른 npm 기록(줄마다 한 번) */
  npmLog: string;
}

let stepCounter = 0;

/** `propagate.sh <단계>` 를 한 번 돌린다. 단계마다 기록 파일을 따로 준다. */
function runStep(tmp: string, step: "clone" | "prepare" | "push", env: Record<string, string>): StepRun {
  const stamp = `${step}-${(stepCounter += 1)}`;
  const npmLog = join(tmp, `npm-${stamp}.log`);
  const outFile = join(tmp, `github-output-${stamp}.txt`);
  writeFileSync(npmLog, "");
  writeFileSync(outFile, "");
  const r = spawnSync("bash", [SCRIPT, step], {
    encoding: "utf8",
    env: {
      ...process.env,
      ...HERMETIC_GIT,
      PATH: `${fakeNpm(tmp)}:${process.env.PATH}`,
      FAKE_NPM_LOG: npmLog,
      FAKE_NPM_FAIL: "",
      PROPAGATE_WORKDIR: join(tmp, "work"),
      PROPAGATE_OUT: join(tmp, "artifact"),
      PROPAGATE_SUBJECT: "feat: 시험 커밋",
      PROPAGATE_PACKAGE_URL: "https://example.test/pkg/commit",
      PROPAGATE_RUN_URL: "https://example.test/run/1",
      PROPAGATE_TOKEN: "",
      GITHUB_OUTPUT: outFile,
      ...env,
    },
  });
  return {
    code: r.status,
    stdout: r.stdout,
    stderr: r.stderr,
    out: readFileSync(outFile, "utf8"),
    npmLog: readFileSync(npmLog, "utf8"),
  };
}

/** clone → prepare (실패하면 거기서 멈춘다) */
function runPrepare(tmp: string, env: Record<string, string>) {
  const clone = runStep(tmp, "clone", env);
  if (clone.code !== 0) return { clone, prepare: undefined };
  return { clone, prepare: runStep(tmp, "prepare", env) };
}

/** clone → prepare → push (앞 단계가 실패하면 거기서 멈춘다) */
function runAll(tmp: string, env: Record<string, string>) {
  const { clone, prepare } = runPrepare(tmp, env);
  if (!prepare || prepare.code !== 0) return { clone, prepare, push: undefined };
  return { clone, prepare, push: runStep(tmp, "push", env) };
}

/** 산출물 폴더에 담긴 파일 목록(상대 경로) */
function listFiles(dir: string, prefix = ""): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? listFiles(join(dir, e.name), `${prefix}${e.name}/`) : [`${prefix}${e.name}`]))
    .sort();
}

/**
 * ERP 의 `design:check` script 흉내 — **두 명령의 묶음**이다(실제 ERP package.json, 2026-09-08 실측:
 * `node scripts/design-system/cli.mjs check && node scripts/design-system/debt.mjs check`).
 * 봇은 `npm run design:check` 로 이 묶음을 통째로 돌리므로, 가짜 앱도 같은 모양이어야
 * 「Railway 와 같은 명령을 돌린다」를 시험이 실제로 잰다.
 */
function seedErpScripts(work: string) {
  const pkgPath = join(work, "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as Record<string, unknown>;
  pkg.scripts = {
    ...((pkg.scripts as Record<string, string> | undefined) ?? {}),
    "design:check": "node scripts/design-system/cli.mjs check && node scripts/design-system/debt.mjs check",
  };
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
  mkdirSync(join(work, "scripts/design-system"), { recursive: true });
  // 빚(debt) 검사는 이 시험의 관심사가 아니다 — 있기만 하면 된다(묶음의 뒷 절반이 실제로 돈다는 증거).
  writeFileSync(join(work, "scripts/design-system/debt.mjs"), "// 빚 검사 흉내 — 늘 통과\n");
}

/** ERP 흉내: 설계 등록부 + 가짜 cli.mjs(generate 는 현재 핀을 적고, check 는 그것이 핀과 같은지 본다) */
function seedErpDesignSystem(work: string, cliBody?: string) {
  seedErpScripts(work);
  mkdirSync(join(work, "scripts/design-system"), { recursive: true });
  mkdirSync(join(work, "src/lib/design-system"), { recursive: true });
  writeFileSync(join(work, "src/lib/design-system/registry.generated.json"), '{"pin":"old"}\n');
  writeFileSync(
    join(work, "scripts/design-system/cli.mjs"),
    cliBody ??
      `import { readFileSync, writeFileSync } from "node:fs";
const cmd = process.argv[2];
const pin = JSON.parse(readFileSync("package.json", "utf8")).dependencies["@wedly/policy-match-shared"];
if (cmd === "generate") writeFileSync("src/lib/design-system/registry.generated.json", JSON.stringify({ pin }) + "\\n");
else if (cmd === "check") {
  if (JSON.parse(readFileSync("src/lib/design-system/registry.generated.json", "utf8")).pin !== pin) {
    console.error("stale");
    process.exit(1);
  }
} else process.exit(2);
`,
  );
}

/**
 * 준비 단계를 거치지 않고 **산출물을 손으로 지어** 밀기 단계만 시험한다.
 *
 * ★왜 필요한가(2026-09-08 2차 리뷰의 위협 모델): 준비 job 에서 도는 앱 코드는 믿을 수 없다 —
 *  실행기의 파일도 산출물도 마음대로 바꿀 수 있다. 그러니 밀기 단계는 산출물을 **믿을 수 없는 입력**
 *  으로 다뤄야 한다. 그 판정을 재려면 「준비가 만들 리 없는 산출물」을 시험이 직접 지어야 한다.
 */
function writeArtifact(tmp: string, meta: Record<string, string>, files: Record<string, string>) {
  const outDir = join(tmp, "artifact");
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "meta.json"), JSON.stringify(meta, null, 2) + "\n");
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(dirname(join(outDir, rel)), { recursive: true });
    writeFileSync(join(outDir, rel), body);
  }
  return outDir;
}

/** `fakeApp` 이 심은 것과 같은 모양의 package.json — 핀만 다른 판 */
function pkgJsonAt(name: string, sha: string) {
  return JSON.stringify({ name, dependencies: { "@wedly/policy-match-shared": SPEC(sha) } }, null, 2) + "\n";
}

/** 가짜 npm 의 `install` 이 만드는 것과 같은 모양의 잠금 파일 */
function lockJsonAt(sha: string, integrity = `sha512-${sha.slice(0, 8)}`) {
  return (
    JSON.stringify(
      {
        lockfileVersion: 3,
        packages: {
          "": { dependencies: { "@wedly/policy-match-shared": SPEC(sha) } },
          "node_modules/@wedly/policy-match-shared": { resolved: RESOLVED(sha), integrity },
        },
      },
      null,
      2,
    ) + "\n"
  );
}

describe("propagate.sh", () => {
  let tmp: string;
  let pkg: ReturnType<typeof fakePackage>;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "propagate-"));
    mkdirSync(join(tmp, "work"), { recursive: true });
    pkg = fakePackage(tmp);
  }, 60_000);

  it("잠금 파일만 쓰는 앱(lab): 핀 갱신 → 커밋 → 푸시, 커밋 저자는 봇", () => {
    const app = fakeApp(tmp, "lab", pkg.c1);
    const r = runAll(tmp, {
      PROPAGATE_APP_ID: "lab",
      PROPAGATE_SHA: pkg.c3,
      PROPAGATE_PACKAGE_DIR: pkg.dir,
      PROPAGATE_CLONE_URL: app.bare,
    });
    expect(r.prepare?.code, r.prepare?.stderr).toBe(0);
    expect(r.prepare?.out).toContain("result=prepared");
    expect(r.push?.code, r.push?.stderr).toBe(0);
    expect(r.push?.out).toContain("result=updated");
    expect(r.push?.out).toContain(`commit=${sh("git rev-parse main", app.bare)}`);
    expect(sh("git log -1 --format=%s main", app.bare)).toBe(
      `chore(정책매칭 공용): 핀 ${pkg.c3.slice(0, 7)} — feat: 시험 커밋`,
    );
    expect(sh("git log -1 --format='%an <%ae>' main", app.bare)).toBe("WEDLY 정책매칭 봇 <policy-bot@wedly.kr>");
    expect(sh("git log -1 --format=%b main", app.bare)).toContain("https://example.test/pkg/commit");
    expect(sh("git show main:package.json", app.bare)).toContain(SPEC(pkg.c3));
    expect(sh("git show main:package-lock.json", app.bare)).toContain(RESOLVED(pkg.c3));
    expect(r.prepare?.npmLog).not.toMatch(/^npm ci/m);
  }, 60_000);

  it("설치 앱(erp): npm ci 와 후처리(postSteps)를 돌리고 등록부 파일까지 커밋한다", () => {
    const app = fakeApp(tmp, "erp", pkg.c1, (w) => seedErpDesignSystem(w));
    const r = runAll(tmp, {
      PROPAGATE_APP_ID: "erp",
      PROPAGATE_SHA: pkg.c3,
      PROPAGATE_PACKAGE_DIR: pkg.dir,
      PROPAGATE_CLONE_URL: app.bare,
    });
    expect(r.push?.code, r.push?.stderr).toBe(0);
    expect(r.push?.out).toContain("result=updated");
    expect(r.prepare?.npmLog).toMatch(/^npm ci --ignore-scripts/m);
    // 후처리 두 번째 단계는 Railway 가 ERP `build` 첫 단계로 돌리는 것과 **같은 명령**이어야 한다.
    expect(r.prepare?.npmLog).toMatch(/^npm run design:check$/m);
    expect(sh("git show main:src/lib/design-system/registry.generated.json", app.bare)).toContain(pkg.c3);
    expect(sh("git show --stat --format= main", app.bare)).toMatch(/registry\.generated\.json/);
  }, 60_000);

  it("push 단계는 npm 을 한 번도 부르지 않는다 — 토큰 옆에서 앱 코드가 돌지 않는다는 증거", () => {
    // 리뷰 R2 의 핵심. ERP 는 준비 단계에서 npm 을 여러 번 부르는 앱이라 대비가 분명하다.
    const app = fakeApp(tmp, "erp", pkg.c1, (w) => seedErpDesignSystem(w));
    const r = runAll(tmp, {
      PROPAGATE_APP_ID: "erp",
      PROPAGATE_SHA: pkg.c3,
      PROPAGATE_PACKAGE_DIR: pkg.dir,
      PROPAGATE_CLONE_URL: app.bare,
    });
    expect(r.push?.code, r.push?.stderr).toBe(0);
    expect(r.prepare?.npmLog.trim().split("\n").length).toBeGreaterThan(2); // 준비 단계는 실제로 npm 을 쓴다
    expect(r.push?.npmLog).toBe(""); // 밀기 단계는 한 줄도 없다
    expect(r.clone.npmLog).toBe(""); // 클론 단계도 마찬가지
  }, 60_000);

  it("준비 단계 산출물에는 commitPaths 와 meta.json 만 담긴다", () => {
    const app = fakeApp(tmp, "erp", pkg.c1, (w) => seedErpDesignSystem(w));
    const baseSha = sh("git rev-parse main", app.bare);
    const r = runPrepare(tmp, {
      PROPAGATE_APP_ID: "erp",
      PROPAGATE_SHA: pkg.c3,
      PROPAGATE_PACKAGE_DIR: pkg.dir,
      PROPAGATE_CLONE_URL: app.bare,
    });
    expect(r.prepare?.code, r.prepare?.stderr).toBe(0);
    const outDir = join(tmp, "artifact");
    expect(listFiles(outDir)).toEqual([
      "meta.json",
      "package-lock.json",
      "package.json",
      "src/lib/design-system/registry.generated.json",
    ]);
    const meta = JSON.parse(readFileSync(join(outDir, "meta.json"), "utf8")) as Record<string, string>;
    expect(meta).toEqual({
      app: "erp",
      result: "prepared",
      baseSha, // 밀기 단계는 이 커밋 위에 얹는다
      pinFrom: pkg.c1,
      pinTo: pkg.c3,
      subject: "feat: 시험 커밋",
    });
    // 담긴 파일은 실제로 새 핀이 든 파일이어야 한다(빈 껍데기 산출물 방지)
    expect(readFileSync(join(outDir, "package.json"), "utf8")).toContain(SPEC(pkg.c3));
    expect(readFileSync(join(outDir, "package-lock.json"), "utf8")).toContain(RESOLVED(pkg.c3));
  }, 60_000);

  it("설계 등록부가 핀과 어긋나면 `npm run design:check` 가 막는다 — 아무것도 밀지 않는다", () => {
    // 왜 이 시험이 있나: 이것이 봇의 「Railway 와 같은 관문」이다. 등록부 재생성이 깨져 옛 값이
    // 남으면 Railway 의 `npm run design:check` 가 빨개져 **배포가 실패**한다. 봇은 그런 커밋을
    // 애초에 만들지 않아야 한다.
    const app = fakeApp(tmp, "erp", pkg.c1, (w) =>
      seedErpDesignSystem(
        w,
        `import { readFileSync, writeFileSync } from "node:fs";
const cmd = process.argv[2];
const pin = JSON.parse(readFileSync("package.json", "utf8")).dependencies["@wedly/policy-match-shared"];
// generate 가 낡은 값을 적는다(등록부 재생성이 깨진 상황)
if (cmd === "generate") writeFileSync("src/lib/design-system/registry.generated.json", JSON.stringify({ pin: "stale" }) + "\\n");
else if (cmd === "check") {
  if (JSON.parse(readFileSync("src/lib/design-system/registry.generated.json", "utf8")).pin !== pin) {
    console.error("설계 등록부가 핀과 다릅니다");
    process.exit(1);
  }
} else process.exit(2);
`,
      ),
    );
    const before = sh("git rev-parse main", app.bare);
    const r = runPrepare(tmp, {
      PROPAGATE_APP_ID: "erp",
      PROPAGATE_SHA: pkg.c3,
      PROPAGATE_PACKAGE_DIR: pkg.dir,
      PROPAGATE_CLONE_URL: app.bare,
    });
    expect(r.prepare?.code).toBe(1);
    expect(r.prepare?.stderr).toMatch(/후처리 실패: npm run design:check/);
    expect(sh("git rev-parse main", app.bare)).toBe(before);
  }, 60_000);

  it("같은 SHA 면 skipped-same — 준비도 밀기도 아무것도 하지 않는다", () => {
    const app = fakeApp(tmp, "lab", pkg.c3);
    const before = sh("git rev-parse main", app.bare);
    const r = runAll(tmp, {
      PROPAGATE_APP_ID: "lab",
      PROPAGATE_SHA: pkg.c3,
      PROPAGATE_PACKAGE_DIR: pkg.dir,
      PROPAGATE_CLONE_URL: app.bare,
    });
    expect(r.prepare?.code, r.prepare?.stderr).toBe(0);
    expect(r.prepare?.out).toContain("result=skipped-same");
    // 건너뛴 경우에도 meta.json 은 담긴다 — 밀기 단계가 그 이유를 그대로 이어받는다
    expect(listFiles(join(tmp, "artifact"))).toEqual(["meta.json"]);
    expect(r.push?.code, r.push?.stderr).toBe(0);
    expect(r.push?.out).toContain("result=skipped-same");
    expect(sh("git rev-parse main", app.bare)).toBe(before);
  }, 60_000);

  it("현재 핀이 더 새 것이거나 다른 갈래면 skipped-not-descendant — 핀이 뒤로 가지 않는다", () => {
    // ① 더 새 것: 앱은 c3, 늦게 도착한 반영이 c2 를 들고 온 경우
    const newer = fakeApp(tmp, "newer", pkg.c3);
    const r1 = runAll(tmp, {
      PROPAGATE_APP_ID: "lab",
      PROPAGATE_SHA: pkg.c2,
      PROPAGATE_PACKAGE_DIR: pkg.dir,
      PROPAGATE_CLONE_URL: newer.bare,
    });
    expect(r1.prepare?.code, r1.prepare?.stderr).toBe(0);
    expect(r1.prepare?.out).toContain("result=skipped-not-descendant");
    expect(r1.push?.out).toContain("result=skipped-not-descendant");
    expect(sh("git show main:package.json", newer.bare)).toContain(SPEC(pkg.c3));

    // ② 다른 갈래: 앱이 곁가지 x1 에 물려 있으면 main 의 c3 는 그 후손이 아니다
    const side = fakeApp(tmp, "side", pkg.x1);
    const r2 = runAll(tmp, {
      PROPAGATE_APP_ID: "lab",
      PROPAGATE_SHA: pkg.c3,
      PROPAGATE_PACKAGE_DIR: pkg.dir,
      PROPAGATE_CLONE_URL: side.bare,
    });
    expect(r2.prepare?.code, r2.prepare?.stderr).toBe(0);
    expect(r2.prepare?.out).toContain("result=skipped-not-descendant");
    expect(sh("git show main:package.json", side.bare)).toContain(SPEC(pkg.x1));
  }, 60_000);

  it("dry run: 커밋은 만들되 푸시하지 않는다", () => {
    const app = fakeApp(tmp, "lab", pkg.c1);
    const before = sh("git rev-parse main", app.bare);
    const r = runAll(tmp, {
      PROPAGATE_APP_ID: "lab",
      PROPAGATE_SHA: pkg.c3,
      PROPAGATE_PACKAGE_DIR: pkg.dir,
      PROPAGATE_CLONE_URL: app.bare,
      PROPAGATE_DRY_RUN: "1",
    });
    expect(r.push?.code, r.push?.stderr).toBe(0);
    expect(r.push?.out).toContain("result=dry-run");
    expect(r.push?.stdout).toMatch(/package-lock\.json/);
    expect(sh("git rev-parse main", app.bare)).toBe(before);
  }, 60_000);

  it("경합(다른 파일): 준비와 밀기 사이에 사람이 밀면 rebase 로 얹고 사람 커밋도 남는다", () => {
    const app = fakeApp(tmp, "lab", pkg.c1);
    const env = {
      PROPAGATE_APP_ID: "lab",
      PROPAGATE_SHA: pkg.c3,
      PROPAGATE_PACKAGE_DIR: pkg.dir,
      PROPAGATE_CLONE_URL: app.bare,
    };
    const { prepare } = runPrepare(tmp, env);
    expect(prepare?.code, prepare?.stderr).toBe(0);

    // 준비가 끝난 뒤 사람이 **다른 파일**을 고쳐 민다
    humanPush(tmp, app.bare, (dir) => writeFileSync(join(dir, "README.md"), "app\n사람이 고침\n"), "사람 커밋");

    const push = runStep(tmp, "push", env);
    expect(push.code, push.stderr).toBe(0);
    // 진짜로 「거부 → 다시 얹기」를 지나왔다는 증거(그냥 앞으로 감기로 들어갔으면 이 줄이 없다)
    expect(push.stderr).toMatch(/푸시 거부 \(1\/3\)/);
    expect(push.out).toContain("result=updated");
    const log = sh("git log --format=%s main", app.bare);
    expect(log.split("\n")[0]).toMatch(/^chore\(정책매칭 공용\)/);
    expect(log).toContain("사람 커밋");
    // 사람이 넣은 줄이 살아 있어야 한다(rebase 로 덮어쓰지 않았다는 증거)
    expect(sh("git show main:README.md", app.bare)).toContain("사람이 고침");
    expect(sh("git show main:package.json", app.bare)).toContain(SPEC(pkg.c3));
  }, 60_000);

  it("경합(같은 파일): 사람이 핀을 손으로 바꿨으면 rebase 충돌로 1 — 사람 커밋을 덮지 않는다", () => {
    const app = fakeApp(tmp, "lab", pkg.c1);
    const env = {
      PROPAGATE_APP_ID: "lab",
      PROPAGATE_SHA: pkg.c3,
      PROPAGATE_PACKAGE_DIR: pkg.dir,
      PROPAGATE_CLONE_URL: app.bare,
    };
    const { prepare } = runPrepare(tmp, env);
    expect(prepare?.code, prepare?.stderr).toBe(0);

    // 사람이 **같은 파일의 같은 줄**(핀)을 손으로 c2 로 바꿔 민다
    humanPush(
      tmp,
      app.bare,
      (dir) => {
        const p = join(dir, "package.json");
        writeFileSync(p, readFileSync(p, "utf8").replace(SPEC(pkg.c1), SPEC(pkg.c2)));
      },
      "사람이 핀을 손으로 바꿈",
    );
    const humanHead = sh("git rev-parse main", app.bare);

    const push = runStep(tmp, "push", env);
    expect(push.code).toBe(1);
    expect(push.stderr).toMatch(/rebase 충돌/);
    expect(sh("git rev-parse main", app.bare)).toBe(humanHead); // 사람 커밋이 그대로 끝이다
    expect(sh("git show main:package.json", app.bare)).toContain(SPEC(pkg.c2));
  }, 60_000);

  it("준비가 본 기준 커밋이 앱 저장소에 없으면(되감기·강제 푸시) 밀지 않고 1 로 멈춘다", () => {
    const app = fakeApp(tmp, "lab", pkg.c1);
    const env = {
      PROPAGATE_APP_ID: "lab",
      PROPAGATE_SHA: pkg.c3,
      PROPAGATE_PACKAGE_DIR: pkg.dir,
      PROPAGATE_CLONE_URL: app.bare,
    };
    const { prepare } = runPrepare(tmp, env);
    expect(prepare?.code, prepare?.stderr).toBe(0);

    // 앱 저장소에 없는 커밋을 기준으로 삼게 만든다 — main 이 되감기거나 강제 푸시로 갈린 상황과 같다.
    const metaPath = join(tmp, "artifact/meta.json");
    const meta = JSON.parse(readFileSync(metaPath, "utf8")) as Record<string, string>;
    meta.baseSha = "0123456789abcdef0123456789abcdef01234567";
    writeFileSync(metaPath, JSON.stringify(meta, null, 2) + "\n");
    const before = sh("git rev-parse main", app.bare);

    const push = runStep(tmp, "push", env);
    expect(push.code).toBe(1);
    expect(push.stderr).toMatch(/찾지 못했습니다/);
    expect(sh("git rev-parse main", app.bare)).toBe(before); // 엉뚱한 자리에 얹지 않는다
  }, 60_000);

  it("클론에 자격이 남아 있으면 그 자리에서 멈춘다 — 토큰 값은 오류문에도 안 적는다", () => {
    // clone 단계가 앱 코드에게 폴더를 넘기기 전에 부르는 검사(lib.sh assert_no_credentials).
    // 실제 토큰 클론을 시험에서 돌릴 수는 없으니 함수를 직접 불러 잰다.
    const secret = "ghp_NEVER_IN_A_MESSAGE_0001";
    const poisoned = join(tmp, "poisoned");
    mkdirSync(join(poisoned, ".git"), { recursive: true });
    writeFileSync(
      join(poisoned, ".git/config"),
      `[remote "origin"]\n\turl = https://x-access-token:${secret}@github.com/smlee-hash/wedly-policy-lab.git\n`,
    );
    const call = (dir: string) =>
      spawnSync("bash", ["-c", `set -euo pipefail; APP_ID=lab; . "${LIB}"; assert_no_credentials "${dir}"`], {
        encoding: "utf8",
        env: { ...process.env, ...HERMETIC_GIT },
      });

    const bad = call(poisoned);
    expect(bad.status).toBe(1);
    expect(bad.stderr).toMatch(/자격/);
    expect(bad.stderr).not.toContain(secret);
    expect(bad.stdout).not.toContain(secret);

    // 깨끗한 클론은 그냥 지나간다(검사가 늘 빨간 것이 아니라는 확인)
    const clean = join(tmp, "clean");
    mkdirSync(join(clean, ".git"), { recursive: true });
    writeFileSync(join(clean, ".git/config"), `[remote "origin"]\n\turl = https://github.com/smlee-hash/wedly-policy-lab.git\n`);
    expect(call(clean).status).toBe(0);
  }, 60_000);

  it("commitPaths 밖 파일이 바뀌면 실패하고 목록을 알린다", () => {
    const app = fakeApp(tmp, "erp", pkg.c1, (w) => {
      seedErpDesignSystem(w, `import { writeFileSync } from "node:fs";\nwriteFileSync("stray.txt", "b\\n");\n`);
      writeFileSync(join(w, "stray.txt"), "a\n");
    });
    const before = sh("git rev-parse main", app.bare);
    const r = runPrepare(tmp, {
      PROPAGATE_APP_ID: "erp",
      PROPAGATE_SHA: pkg.c3,
      PROPAGATE_PACKAGE_DIR: pkg.dir,
      PROPAGATE_CLONE_URL: app.bare,
    });
    expect(r.prepare?.code).toBe(1);
    expect(r.prepare?.stderr).toMatch(/stray\.txt/);
    expect(sh("git rev-parse main", app.bare)).toBe(before);
  }, 60_000);

  it("입력 오류(단계 이름·SHA 형식·모르는 앱)는 2 — 그리고 왜인지 말한다", () => {
    const app = fakeApp(tmp, "lab", pkg.c1);
    const base = {
      PROPAGATE_APP_ID: "lab",
      PROPAGATE_SHA: pkg.c3,
      PROPAGATE_PACKAGE_DIR: pkg.dir,
      PROPAGATE_CLONE_URL: app.bare,
    };

    const noStep = spawnSync("bash", [SCRIPT], { encoding: "utf8", env: { ...process.env, ...HERMETIC_GIT } });
    expect(noStep.status).toBe(2);
    expect(noStep.stderr).toMatch(/clone\|prepare\|push/);

    const badStep = spawnSync("bash", [SCRIPT, "밀어"], { encoding: "utf8", env: { ...process.env, ...HERMETIC_GIT } });
    expect(badStep.status).toBe(2);

    const cloned = runStep(tmp, "clone", base);
    expect(cloned.code, cloned.stderr).toBe(0);
    const badSha = runStep(tmp, "prepare", { ...base, PROPAGATE_SHA: "abc" });
    expect(badSha.code).toBe(2);
    expect(badSha.stderr).toMatch(/PROPAGATE_SHA/);

    const unknown = runStep(tmp, "clone", { ...base, PROPAGATE_APP_ID: "hive" });
    expect(unknown.code).toBe(2);
    expect(unknown.stderr).toMatch(/hive/);
  }, 60_000);

  it("산출물이 없으면 밀기 단계는 2 로 멈춘다 — artifact 를 못 받은 것을 조용히 넘기지 않는다", () => {
    const app = fakeApp(tmp, "lab", pkg.c1);
    const r = runStep(tmp, "push", {
      PROPAGATE_APP_ID: "lab",
      PROPAGATE_CLONE_URL: app.bare,
      PROPAGATE_OUT: join(tmp, "없는-폴더"),
    });
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/meta\.json/);
    expect(sh("git log --format=%s main", app.bare)).toBe("seed");
  }, 60_000);

  it("주소에 토큰이 섞여 있어도 어떤 출력에도 남기지 않는다", () => {
    const secret = "ghp_SHOULD_NEVER_APPEAR_1234567890";
    const noProxy = {
      http_proxy: "",
      https_proxy: "",
      HTTP_PROXY: "",
      HTTPS_PROXY: "",
      ALL_PROXY: "",
      NO_PROXY: "*",
    };
    const base = { PROPAGATE_APP_ID: "lab", PROPAGATE_SHA: pkg.c3, PROPAGATE_PACKAGE_DIR: pkg.dir };

    // ① https 주소: 127.0.0.1:1 은 곧바로 연결 거부된다(네트워크를 쓰지 않는다).
    //   요즘 git 은 이 오류문에서 자격을 스스로 지우지만, 우리가 주소를 직접 찍으면 그대로 샌다.
    const viaHttps = runStep(tmp, "clone", {
      ...base,
      PROPAGATE_CLONE_URL: `https://x-access-token:${secret}@127.0.0.1:1/smlee-hash/wedly-policy-lab.git`,
      ...noProxy,
    });
    expect(viaHttps.code).toBe(1);
    expect(viaHttps.stdout).not.toContain(secret);
    expect(viaHttps.stderr).not.toContain(secret);
    expect(viaHttps.out).not.toContain(secret);
    expect(viaHttps.stderr).toMatch(/propagate/); // 실패했다는 사실 자체는 알려야 한다

    // ② 로컬 경로 주소: git 은 이 문자열을 **그대로** 오류에 찍는다(2026-09-08 실측).
    //   로컬 경로는 예행연습이 실제로 쓰는 방식이라 가리개가 없으면 여기서 샌다.
    const viaPath = runStep(tmp, "clone", {
      ...base,
      PROPAGATE_CLONE_URL: `${tmp}/none//x-access-token:${secret}@github.com/x.git`,
      ...noProxy,
    });
    expect(viaPath.code).toBe(1);
    expect(viaPath.stdout).not.toContain(secret);
    expect(viaPath.stderr).not.toContain(secret);
    expect(viaPath.out).not.toContain(secret);
    expect(viaPath.stderr).toMatch(/x-access-token|\*\*\*/); // 무엇을 물고 실패했는지는 남아야 한다
  }, 60_000);

  it("npm 이 죽어도 종료 코드는 1 — npm 의 코드(128)를 그대로 내보내지 않는다", () => {
    // 2026-09-08 랩 저장소 예행에서 실제로 겪은 일: `npm install --package-lock-only` 가 128 로 죽자
    // 스크립트도 128 로 끝났다. 규격(0=반영·건너뜀 / 1=실패 / 2=입력 오류)을 지켜야
    // 워크플로우·알림이 「입력 오류」와 「일 실패」를 구분할 수 있다.
    const app = fakeApp(tmp, "lab", pkg.c1);
    const before = sh("git rev-parse main", app.bare);
    const r = runPrepare(tmp, {
      PROPAGATE_APP_ID: "lab",
      PROPAGATE_SHA: pkg.c3,
      PROPAGATE_PACKAGE_DIR: pkg.dir,
      PROPAGATE_CLONE_URL: app.bare,
      FAKE_NPM_FAIL: "install",
    });
    expect(r.prepare?.code).toBe(1);
    expect(r.prepare?.stderr).toMatch(/잠금 파일 갱신/);
    expect(sh("git rev-parse main", app.bare)).toBe(before); // 실패하면 아무것도 밀지 않는다
  }, 60_000);

  // ── 2026-09-08 2차 리뷰 F1: 준비의 실패는 **산출물로** 전해지고, 알림은 밀기 job 에서만 간다 ──

  it("준비가 죽으면 산출물에 사유가 담긴 meta.json(failed)이 남는다 — 준비 job 은 알림을 보내지 않는다", () => {
    const app = fakeApp(tmp, "lab", pkg.c1);
    const r = runPrepare(tmp, {
      PROPAGATE_APP_ID: "lab",
      PROPAGATE_SHA: pkg.c3,
      PROPAGATE_PACKAGE_DIR: pkg.dir,
      PROPAGATE_CLONE_URL: app.bare,
      FAKE_NPM_FAIL: "install",
    });
    expect(r.prepare?.code).toBe(1);
    const meta = JSON.parse(readFileSync(join(tmp, "artifact/meta.json"), "utf8")) as Record<string, string>;
    expect(meta.app).toBe("lab");
    expect(meta.result).toBe("failed");
    expect(meta.error).toMatch(/잠금 파일 갱신/);
    expect(meta.error).not.toContain("\n"); // 알림 한 줄에 그대로 들어가야 한다
  }, 60_000);

  it("클론이 죽어도 사유가 담긴 meta.json 이 남는다 — 밀기 job 이 그 사유로 알린다", () => {
    const r = runStep(tmp, "clone", {
      PROPAGATE_APP_ID: "lab",
      PROPAGATE_SHA: pkg.c3,
      PROPAGATE_PACKAGE_DIR: pkg.dir,
      PROPAGATE_CLONE_URL: join(tmp, "없는-저장소.git"),
    });
    expect(r.code).toBe(1);
    const meta = JSON.parse(readFileSync(join(tmp, "artifact/meta.json"), "utf8")) as Record<string, string>;
    expect(meta.result).toBe("failed");
    expect(meta.error).toMatch(/클론 실패/);
  }, 60_000);

  it("산출물이 failed 면 밀기는 1 로 끝나고 사유를 그대로 알린다 — 원격은 그대로", () => {
    const app = fakeApp(tmp, "lab", pkg.c1);
    const before = sh("git rev-parse main", app.bare);
    writeArtifact(tmp, { app: "lab", result: "failed", error: "후처리 실패: npm run design:check" }, {});
    const r = runStep(tmp, "push", {
      PROPAGATE_APP_ID: "lab",
      PROPAGATE_SHA: pkg.c3,
      PROPAGATE_PACKAGE_DIR: pkg.dir,
      PROPAGATE_CLONE_URL: app.bare,
    });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("후처리 실패: npm run design:check");
    expect(r.out).toContain("result=failed");
    expect(sh("git rev-parse main", app.bare)).toBe(before);
  }, 60_000);

  // ── 2차 리뷰 F2: 산출물을 얹을 자리가 심볼릭 링크면 밀지 않는다 ──

  it("기준 커밋의 커밋 대상이 심볼릭 링크면 밀지 않는다 — `.git/config` 가 덮이지 않는다", () => {
    // 앱 저장소의 기준 커밋이 `registry.generated.json` 을 `../../../.git/config` 로 걸어 두면,
    // 밀기 단계가 그 자리에 파일을 쓰는 순간 **클론의 git 설정이 덮인다**(자격 도우미·url.insteadOf
    // 를 심어 다음 git 호출에서 토큰을 빼돌리는 길). 그래서 덮어쓰기 전에 막아야 한다.
    const app = fakeApp(tmp, "erp", pkg.c1, (w) => {
      mkdirSync(join(w, "src/lib/design-system"), { recursive: true });
      symlinkSync("../../../.git/config", join(w, "src/lib/design-system/registry.generated.json"));
    });
    const before = sh("git rev-parse main", app.bare);
    const baseSha = before;
    const MARKER = "[credential]\n\thelper = !사악한도우미\n";
    writeArtifact(
      tmp,
      { app: "erp", result: "prepared", baseSha, pinFrom: pkg.c1, pinTo: pkg.c3, subject: "feat: 시험 커밋" },
      {
        "package.json": pkgJsonAt("erp", pkg.c3),
        "package-lock.json": lockJsonAt(pkg.c3),
        "src/lib/design-system/registry.generated.json": MARKER,
      },
    );
    const r = runStep(tmp, "push", {
      PROPAGATE_APP_ID: "erp",
      PROPAGATE_SHA: pkg.c3,
      PROPAGATE_PACKAGE_DIR: pkg.dir,
      PROPAGATE_CLONE_URL: app.bare,
    });
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/심볼릭 링크/);
    expect(sh("git rev-parse main", app.bare)).toBe(before); // 원격 불변

    // 그리고 클론의 `.git/config` 는 산출물 내용으로 덮이지 않았다 — 여전히 git 설정 파일이다.
    const cloneConfig = readFileSync(join(tmp, "work/push-erp/.git/config"), "utf8");
    expect(cloneConfig).not.toContain("사악한도우미");
    expect(cloneConfig).toContain('[remote "origin"]');
    expect(sh("git config --get remote.origin.url", join(tmp, "work/push-erp"))).toBe(app.bare);
  }, 60_000);

  it("밀기 단계는 실행기가 심어 둔 git 설정을 눌러 버린다 — 남의 갈고리가 토큰 옆에서 돌지 않는다", () => {
    // 2차 리뷰 F2: 밀기 job 은 토큰을 쥔 자리다. 실행기 환경이 `core.hooksPath` 같은 설정을 들고
    // 있으면 그 갈고리가 우리 git 호출과 함께 돈다. 그래서 스크립트가 `GIT_CONFIG_COUNT` 로
    // 자격 도우미·갈고리·대리 서버·ssh 명령을 전부 눌러 둔다.
    // 재는 법: **일부러 죽는 갈고리**를 환경으로 물려준다. 눌러 두지 않으면 커밋이 실패한다.
    const hooks = join(tmp, "적대적-갈고리");
    mkdirSync(hooks, { recursive: true });
    writeFileSync(join(hooks, "pre-commit"), "#!/usr/bin/env bash\necho '갈고리가 돌았습니다' >&2\nexit 1\n");
    chmodSync(join(hooks, "pre-commit"), 0o755);

    const app = fakeApp(tmp, "lab", pkg.c1);
    const r = runAll(tmp, {
      PROPAGATE_APP_ID: "lab",
      PROPAGATE_SHA: pkg.c3,
      PROPAGATE_PACKAGE_DIR: pkg.dir,
      PROPAGATE_CLONE_URL: app.bare,
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "core.hooksPath",
      GIT_CONFIG_VALUE_0: hooks,
    });
    expect(r.push?.code, r.push?.stderr).toBe(0);
    expect(r.push?.stderr).not.toContain("갈고리가 돌았습니다");
    expect(r.push?.out).toContain("result=updated");
  }, 60_000);

  it("커밋할 파일이 없으면(등록부 미생성) 1 로 끝나고 무엇이 없는지 알린다", () => {
    // ERP 후처리가 설계 등록부를 못 만든 경우. verify-lock 은 등록부를 보지 않으므로 여기까지 통과한다.
    const app = fakeApp(tmp, "erp", pkg.c1, (w) => {
      // `design:check` script 는 있고(그래서 후처리는 통과) 등록부 파일만 없는 상황을 만든다.
      seedErpScripts(w);
      writeFileSync(join(w, "scripts/design-system/cli.mjs"), "// 아무것도 만들지 않는다\n");
    });
    const before = sh("git rev-parse main", app.bare);
    const r = runPrepare(tmp, {
      PROPAGATE_APP_ID: "erp",
      PROPAGATE_SHA: pkg.c3,
      PROPAGATE_PACKAGE_DIR: pkg.dir,
      PROPAGATE_CLONE_URL: app.bare,
    });
    expect(r.prepare?.code).toBe(1);
    expect(r.prepare?.stderr).toMatch(/registry\.generated\.json/);
    expect(sh("git rev-parse main", app.bare)).toBe(before);
  }, 60_000);
});
