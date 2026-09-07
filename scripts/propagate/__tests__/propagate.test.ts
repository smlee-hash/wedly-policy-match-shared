import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";

/**
 * `scripts/propagate/propagate.sh` 시나리오 시험 — 계획서 Task 3(설계서 §6 D1·D2).
 *
 * ★이 봇이 하는 일: 공용 보관함에 커밋이 올라가면 앱 3곳(ERP·일루아·랩)의
 *  `@wedly/policy-match-shared` 핀을 새 SHA 로 올려 커밋·푸시한다. 사람이 손으로 맞추던 일이다.
 *
 * ★그래서 이 시험이 막는 사고 4가지:
 *  1) 핀만 올리고 잠금 파일이 옛 SHA 로 남는 것(= 새 핀인데 옛 코드로 배포)
 *  2) 순서가 뒤집혀 핀이 **뒤로 가는** 것(늦게 도착한 옛 반영이 새 핀을 덮어씀)
 *  3) 봇이 핀 말고 **다른 파일까지** 커밋하는 것
 *  4) 사람이 같은 순간에 밀어 푸시가 거부됐을 때 **사람 커밋을 잃는** 것
 *
 * ★재는 방식: 글자 대조가 아니라 **진짜 스크립트를 진짜 git 저장소에서 돌린다.**
 *  - 가짜 패키지 저장소(c1→c2→c3, 곁가지 x1)로 「후손인가」 판정을 실제 `merge-base` 로 시킨다
 *  - 가짜 앱 저장소는 bare 원격까지 만들어 **진짜 푸시**를 받는다(커밋이 원격에 남았는지로 판정)
 *  - `npm` 만 PATH 앞의 shim 으로 바꾼다(네트워크·설치 시간 없이 잠금 파일 갱신을 흉내)
 *
 * ★`__dirname` 대신 `fileURLToPath(import.meta.url)`: 이 보관함은 `"type": "module"`(ESM).
 * ★git 설정을 `/dev/null` 로 격리: 사람의 전역 설정(`core.hooksPath`·`commit.gpgsign` 등)이
 *  시험 결과를 바꾸면 안 된다. 특히 전역 `core.hooksPath` 는 아래 푸시 경합 훅을 무력화한다.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(HERE, "../propagate.sh");
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
  extra?.(work);
  sh("git init -q -b main && git config user.email t@t && git config user.name t && git add . && git commit -qm seed", work);
  const bare = join(tmp, `${name}.git`);
  sh(`git clone -q --bare "${work}" "${bare}"`, tmp);
  return { work, bare };
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

function runPropagate(tmp: string, env: Record<string, string>) {
  const log = join(tmp, "npm.log");
  writeFileSync(log, "");
  const r = spawnSync("bash", [SCRIPT], {
    encoding: "utf8",
    env: {
      ...process.env,
      ...HERMETIC_GIT,
      PATH: `${fakeNpm(tmp)}:${process.env.PATH}`,
      FAKE_NPM_LOG: log,
      PROPAGATE_WORKDIR: join(tmp, "work"),
      PROPAGATE_SUBJECT: "feat: 시험 커밋",
      PROPAGATE_PACKAGE_URL: "https://example.test/pkg/commit",
      PROPAGATE_RUN_URL: "https://example.test/run/1",
      PROPAGATE_TOKEN: "",
      GITHUB_OUTPUT: join(tmp, "out.txt"),
      ...env,
    },
  });
  const out = (() => {
    try {
      return readFileSync(join(tmp, "out.txt"), "utf8");
    } catch {
      return "";
    }
  })();
  return { code: r.status, stdout: r.stdout, stderr: r.stderr, out, npmLog: readFileSync(log, "utf8") };
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
    const r = runPropagate(tmp, {
      PROPAGATE_APP_ID: "lab",
      PROPAGATE_SHA: pkg.c3,
      PROPAGATE_PACKAGE_DIR: pkg.dir,
      PROPAGATE_CLONE_URL: app.bare,
    });
    expect(r.code, r.stderr).toBe(0);
    expect(r.out).toContain("result=updated");
    expect(r.out).toContain(`commit=${sh("git rev-parse main", app.bare)}`);
    expect(sh("git log -1 --format=%s main", app.bare)).toBe(
      `chore(정책매칭 공용): 핀 ${pkg.c3.slice(0, 7)} — feat: 시험 커밋`,
    );
    expect(sh("git log -1 --format='%an <%ae>' main", app.bare)).toBe("WEDLY 정책매칭 봇 <policy-bot@wedly.kr>");
    expect(sh("git log -1 --format=%b main", app.bare)).toContain("https://example.test/pkg/commit");
    expect(sh("git show main:package.json", app.bare)).toContain(SPEC(pkg.c3));
    expect(sh("git show main:package-lock.json", app.bare)).toContain(RESOLVED(pkg.c3));
    expect(r.npmLog).not.toMatch(/^npm ci/m);
  }, 60_000);

  it("설치 앱(erp): npm ci 와 후처리(postSteps)를 돌리고 등록부 파일까지 커밋한다", () => {
    const app = fakeApp(tmp, "erp", pkg.c1, (w) => seedErpDesignSystem(w));
    const r = runPropagate(tmp, {
      PROPAGATE_APP_ID: "erp",
      PROPAGATE_SHA: pkg.c3,
      PROPAGATE_PACKAGE_DIR: pkg.dir,
      PROPAGATE_CLONE_URL: app.bare,
    });
    expect(r.code, r.stderr).toBe(0);
    expect(r.out).toContain("result=updated");
    expect(r.npmLog).toMatch(/^npm ci --ignore-scripts/m);
    // 후처리 두 번째 단계는 Railway 가 ERP `build` 첫 단계로 돌리는 것과 **같은 명령**이어야 한다.
    expect(r.npmLog).toMatch(/^npm run design:check$/m);
    expect(sh("git show main:src/lib/design-system/registry.generated.json", app.bare)).toContain(pkg.c3);
    expect(sh("git show --stat --format= main", app.bare)).toMatch(/registry\.generated\.json/);
  }, 60_000);

  it("설계 등록부가 핀과 어긋나면 `npm run design:check` 가 막는다 — 아무것도 밀지 않는다", () => {
    // 왜 이 시험이 있나: 이것이 봇의 「Railway 와 같은 관문」이다. 등록부 재생성이 깨져 옛 값이
    // 남으면 Railway 의 `npm run design:check` 가 빨개져 **배포가 실패**한다. 봇은 그런 커밋을
    // 애초에 밀지 않아야 한다 — 밀면 앱 main 은 배포 안 되는 상태로 남는다.
    // (이 시험은 가짜 npm 의 `run` 갈래가 진짜로 script 를 실행하는지도 함께 잰다 —
    //  `run` 이 아무것도 안 하면 여기서 봇이 밀어 버리므로 시험이 빨개진다.)
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
    const r = runPropagate(tmp, {
      PROPAGATE_APP_ID: "erp",
      PROPAGATE_SHA: pkg.c3,
      PROPAGATE_PACKAGE_DIR: pkg.dir,
      PROPAGATE_CLONE_URL: app.bare,
    });
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/후처리 실패: npm run design:check/);
    expect(sh("git rev-parse main", app.bare)).toBe(before);
  }, 60_000);

  it("같은 SHA 면 skipped-same, 커밋 없음", () => {
    const app = fakeApp(tmp, "lab", pkg.c3);
    const before = sh("git rev-parse main", app.bare);
    const r = runPropagate(tmp, {
      PROPAGATE_APP_ID: "lab",
      PROPAGATE_SHA: pkg.c3,
      PROPAGATE_PACKAGE_DIR: pkg.dir,
      PROPAGATE_CLONE_URL: app.bare,
    });
    expect(r.code, r.stderr).toBe(0);
    expect(r.out).toContain("result=skipped-same");
    expect(sh("git rev-parse main", app.bare)).toBe(before);
  }, 60_000);

  it("현재 핀이 더 새 것이거나 다른 갈래면 skipped-not-descendant — 핀이 뒤로 가지 않는다", () => {
    // ① 더 새 것: 앱은 c3, 늦게 도착한 반영이 c2 를 들고 온 경우
    const newer = fakeApp(tmp, "newer", pkg.c3);
    const r1 = runPropagate(tmp, {
      PROPAGATE_APP_ID: "lab",
      PROPAGATE_SHA: pkg.c2,
      PROPAGATE_PACKAGE_DIR: pkg.dir,
      PROPAGATE_CLONE_URL: newer.bare,
    });
    expect(r1.code, r1.stderr).toBe(0);
    expect(r1.out).toContain("result=skipped-not-descendant");
    expect(sh("git show main:package.json", newer.bare)).toContain(SPEC(pkg.c3));

    // ② 다른 갈래: 앱이 곁가지 x1 에 물려 있으면 main 의 c3 는 그 후손이 아니다
    const side = fakeApp(tmp, "side", pkg.x1);
    const r2 = runPropagate(tmp, {
      PROPAGATE_APP_ID: "lab",
      PROPAGATE_SHA: pkg.c3,
      PROPAGATE_PACKAGE_DIR: pkg.dir,
      PROPAGATE_CLONE_URL: side.bare,
    });
    expect(r2.code, r2.stderr).toBe(0);
    expect(r2.out).toContain("result=skipped-not-descendant");
    expect(sh("git show main:package.json", side.bare)).toContain(SPEC(pkg.x1));
  }, 60_000);

  it("dry run: 커밋은 만들되 푸시하지 않는다", () => {
    const app = fakeApp(tmp, "lab", pkg.c1);
    const before = sh("git rev-parse main", app.bare);
    const r = runPropagate(tmp, {
      PROPAGATE_APP_ID: "lab",
      PROPAGATE_SHA: pkg.c3,
      PROPAGATE_PACKAGE_DIR: pkg.dir,
      PROPAGATE_CLONE_URL: app.bare,
      PROPAGATE_DRY_RUN: "1",
    });
    expect(r.code, r.stderr).toBe(0);
    expect(r.out).toContain("result=dry-run");
    expect(r.stdout).toMatch(/package-lock\.json/);
    expect(sh("git rev-parse main", app.bare)).toBe(before);
  }, 60_000);

  it("푸시 경합: 사람이 먼저 밀어 거부되면 rebase 뒤 재시도해 성공하고 사람 커밋도 남는다", () => {
    const app = fakeApp(tmp, "lab", pkg.c1);
    // 클론 뒤·푸시 전 사이에 남이 미는 상황을 bare 의 pre-receive 훅으로 흉내낸다.
    // 훅 안에서 다른 클론이 미는 푸시도 같은 훅을 타므로 flag 파일로 한 번만 거부한다.
    const other = join(tmp, "other");
    sh(`git clone -q "${app.bare}" "${other}"`, tmp);
    writeFileSync(
      join(tmp, "race.sh"),
      `#!/usr/bin/env bash
set -e
flag="${tmp}/raced"
if [ ! -f "$flag" ]; then
  touch "$flag"
  # 훅은 GIT_DIR·격리 창고(quarantine) 변수를 물려받는다. 그대로 두면 다른 클론의 푸시가
  # **거부될 이 푸시의 격리 창고**에 객체를 쓰고 함께 버려진다 — 그래서 지우고 부른다.
  unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_OBJECT_DIRECTORY \\
        GIT_ALTERNATE_OBJECT_DIRECTORIES GIT_QUARANTINE_PATH GIT_PUSH_CERT_NONCE
  (
    cd "${other}"
    git config user.email h@t
    git config user.name 사람
    echo x >> README.md
    git add .
    git commit -qm "사람 커밋"
    git push -q origin HEAD:main
  ) >&2
  echo "simulated race" >&2
  exit 1
fi
exit 0
`,
    );
    chmodSync(join(tmp, "race.sh"), 0o755);
    mkdirSync(join(app.bare, "hooks"), { recursive: true });
    writeFileSync(join(app.bare, "hooks/pre-receive"), `#!/usr/bin/env bash\nexec "${join(tmp, "race.sh")}"\n`);
    chmodSync(join(app.bare, "hooks/pre-receive"), 0o755);

    const r = runPropagate(tmp, {
      PROPAGATE_APP_ID: "lab",
      PROPAGATE_SHA: pkg.c3,
      PROPAGATE_PACKAGE_DIR: pkg.dir,
      PROPAGATE_CLONE_URL: app.bare,
    });
    expect(r.code, r.stderr).toBe(0);
    expect(r.out).toContain("result=updated");
    const log = sh("git log --format=%s main", app.bare);
    expect(log.split("\n")[0]).toMatch(/^chore\(정책매칭 공용\)/);
    expect(log).toContain("사람 커밋");
    // 사람이 넣은 파일이 살아 있어야 한다(rebase 로 덮어쓰지 않았다는 증거)
    expect(sh("git show main:README.md", app.bare)).toContain("x");
  }, 60_000);

  it("commitPaths 밖 파일이 바뀌면 실패하고 목록을 알린다", () => {
    const app = fakeApp(tmp, "erp", pkg.c1, (w) => {
      seedErpDesignSystem(w, `import { writeFileSync } from "node:fs";\nwriteFileSync("stray.txt", "b\\n");\n`);
      writeFileSync(join(w, "stray.txt"), "a\n");
    });
    const before = sh("git rev-parse main", app.bare);
    const r = runPropagate(tmp, {
      PROPAGATE_APP_ID: "erp",
      PROPAGATE_SHA: pkg.c3,
      PROPAGATE_PACKAGE_DIR: pkg.dir,
      PROPAGATE_CLONE_URL: app.bare,
    });
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/stray\.txt/);
    expect(sh("git rev-parse main", app.bare)).toBe(before);
  }, 60_000);

  it("입력 오류(SHA 형식·모르는 앱)는 2 — 그리고 왜인지 말한다", () => {
    const bad = runPropagate(tmp, {
      PROPAGATE_APP_ID: "lab",
      PROPAGATE_SHA: "abc",
      PROPAGATE_PACKAGE_DIR: pkg.dir,
      PROPAGATE_CLONE_URL: "x",
    });
    expect(bad.code).toBe(2);
    expect(bad.stderr).toMatch(/PROPAGATE_SHA/);

    const unknown = runPropagate(tmp, {
      PROPAGATE_APP_ID: "hive",
      PROPAGATE_SHA: pkg.c3,
      PROPAGATE_PACKAGE_DIR: pkg.dir,
      PROPAGATE_CLONE_URL: "x",
    });
    expect(unknown.code).toBe(2);
    expect(unknown.stderr).toMatch(/hive/);
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
    const base = {
      PROPAGATE_APP_ID: "lab",
      PROPAGATE_SHA: pkg.c3,
      PROPAGATE_PACKAGE_DIR: pkg.dir,
    };

    // ① https 주소: 127.0.0.1:1 은 곧바로 연결 거부된다(네트워크를 쓰지 않는다).
    //   요즘 git 은 이 오류문에서 자격을 스스로 지우지만, 우리가 주소를 직접 찍으면 그대로 샌다.
    const viaHttps = runPropagate(tmp, {
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
    const viaPath = runPropagate(tmp, {
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
    const r = runPropagate(tmp, {
      PROPAGATE_APP_ID: "lab",
      PROPAGATE_SHA: pkg.c3,
      PROPAGATE_PACKAGE_DIR: pkg.dir,
      PROPAGATE_CLONE_URL: app.bare,
      FAKE_NPM_FAIL: "install",
    });
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/잠금 파일 갱신/);
    expect(sh("git rev-parse main", app.bare)).toBe(before); // 실패하면 아무것도 밀지 않는다
  }, 60_000);

  it("커밋할 파일이 없으면(등록부 미생성) 1 로 끝나고 무엇이 없는지 알린다", () => {
    // ERP 후처리가 설계 등록부를 못 만든 경우. verify-lock 은 등록부를 보지 않으므로 여기까지 통과한다.
    // 그대로 두면 `git add` 가 128 로 죽어 규격(0/1/2)이 깨진다.
    const app = fakeApp(tmp, "erp", pkg.c1, (w) => {
      // `design:check` script 는 있고(그래서 후처리는 통과) 등록부 파일만 없는 상황을 만든다.
      seedErpScripts(w);
      writeFileSync(join(w, "scripts/design-system/cli.mjs"), "// 아무것도 만들지 않는다\n");
    });
    const before = sh("git rev-parse main", app.bare);
    const r = runPropagate(tmp, {
      PROPAGATE_APP_ID: "erp",
      PROPAGATE_SHA: pkg.c3,
      PROPAGATE_PACKAGE_DIR: pkg.dir,
      PROPAGATE_CLONE_URL: app.bare,
    });
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/registry\.generated\.json/);
    expect(sh("git rev-parse main", app.bare)).toBe(before);
  }, 60_000);
});
