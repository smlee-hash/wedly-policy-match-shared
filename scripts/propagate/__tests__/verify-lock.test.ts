import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * `scripts/propagate/verify-lock.mjs` 단위 시험 — 계획서 Task 2(설계서 §6 D1).
 *
 * ★이 대조기가 막는 사고: 봇이 `package.json` 핀만 바꾸고 `package-lock.json` 이 옛 SHA 로
 *  남으면, 앱은 **옛 코드로 배포되면서 겉보기엔 새 핀**이 된다. 그러면 사람이 「반영됐다」고
 *  믿는데 화면은 그대로다. 그래서 밀기 전에 세 곳(핀·잠금 루트 spec·잠금 resolved)이
 *  **같은 SHA** 인지, `integrity` 가 실제로 채워졌는지 본다.
 *  ERP 처럼 실제 설치까지 하는 앱은 `node_modules/.package-lock.json`(설치된 ref)도 본다 —
 *  설계 등록부(registry.mjs)가 그 값을 읽기 때문이다.
 *
 * ★가짜 앱 폴더를 만들어 **진짜 스크립트를 실행**해 종료 코드로 잰다(0=일치, 1=어긋남, 2=사용법).
 *  글자 대조가 아니라 실제 프로세스 결과다.
 *
 * ★`__dirname` 대신 `fileURLToPath(import.meta.url)`: 이 보관함은 `"type": "module"`(ESM).
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(HERE, "../verify-lock.mjs");
const SHA = "b404b4b1f44d0ffb8213fff771a0bec090ca6257";
const OTHER = "e7d0ed8fe9428b1c720f2f5675cd29a39e99e9b1";
const SPEC = (sha: string) => `github:smlee-hash/wedly-policy-match-shared#${sha}`;
const RESOLVED = (sha: string) => `git+ssh://git@github.com/smlee-hash/wedly-policy-match-shared.git#${sha}`;

function app(opts: {
  pkgSha: string;
  lockRootSha: string;
  lockResolvedSha: string;
  integrity?: string;
  installedSha?: string;
}) {
  const root = mkdtempSync(join(tmpdir(), "verify-lock-"));
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ name: "x", dependencies: { "@wedly/policy-match-shared": SPEC(opts.pkgSha) } }),
  );
  writeFileSync(
    join(root, "package-lock.json"),
    JSON.stringify({
      lockfileVersion: 3,
      packages: {
        "": { dependencies: { "@wedly/policy-match-shared": SPEC(opts.lockRootSha) } },
        "node_modules/@wedly/policy-match-shared": {
          resolved: RESOLVED(opts.lockResolvedSha),
          integrity: opts.integrity ?? "sha512-abc",
        },
      },
    }),
  );
  if (opts.installedSha) {
    mkdirSync(join(root, "node_modules"), { recursive: true });
    writeFileSync(
      join(root, "node_modules/.package-lock.json"),
      JSON.stringify({
        packages: { "node_modules/@wedly/policy-match-shared": { resolved: RESOLVED(opts.installedSha) } },
      }),
    );
  }
  return root;
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

function run(root: string, sha: string, ...extra: string[]) {
  const r = spawnSync("node", [SCRIPT, root, sha, ...extra], { encoding: "utf8" });
  return { code: r.status, err: r.stderr, out: r.stdout };
}

/**
 * 「어긋남」은 **종료 코드 1 만으로는 증명되지 않는다** — 스크립트가 없거나 첫 줄에서 죽어도 1 이다.
 * 그래서 대조기가 실제로 돌아 **그 이유를 자기 말투(`verify-lock: …`)로 적었는지**까지 본다.
 */
function expectRejected(r: { code: number | null; err: string }, reason: RegExp) {
  expect(r.code, r.err).toBe(1);
  expect(r.err).toMatch(/^verify-lock: /m);
  expect(r.err).toMatch(reason);
}

describe("verify-lock.mjs", () => {
  it("셋이 같은 SHA 면 0", () => {
    const r = run(app({ pkgSha: SHA, lockRootSha: SHA, lockResolvedSha: SHA }), SHA);
    expect(r.code, r.err).toBe(0);
    expect(r.out).toContain(SHA);
  });

  it("package.json 핀이 다르면 1 + 이유", () => {
    const r = run(app({ pkgSha: OTHER, lockRootSha: SHA, lockResolvedSha: SHA }), SHA);
    expectRejected(r, /package\.json/);
  });

  it("잠금 파일 루트 spec 이 다르면 1", () => {
    expectRejected(run(app({ pkgSha: SHA, lockRootSha: OTHER, lockResolvedSha: SHA }), SHA), /루트 spec/);
  });

  it("잠금 파일 resolved 가 다르면 1", () => {
    expectRejected(run(app({ pkgSha: SHA, lockRootSha: SHA, lockResolvedSha: OTHER }), SHA), /resolved/);
  });

  it("integrity 가 sha512 가 아니면 1", () => {
    expectRejected(run(app({ pkgSha: SHA, lockRootSha: SHA, lockResolvedSha: SHA, integrity: "" }), SHA), /integrity/);
  });

  it("--installed: 설치 잠금이 없거나 다르면 1, 같으면 0", () => {
    expectRejected(
      run(app({ pkgSha: SHA, lockRootSha: SHA, lockResolvedSha: SHA }), SHA, "--installed"),
      /node_modules\/\.package-lock\.json/,
    );
    expectRejected(
      run(app({ pkgSha: SHA, lockRootSha: SHA, lockResolvedSha: SHA, installedSha: OTHER }), SHA, "--installed"),
      /설치 잠금/,
    );
    const ok = run(app({ pkgSha: SHA, lockRootSha: SHA, lockResolvedSha: SHA, installedSha: SHA }), SHA, "--installed");
    expect(ok.code, ok.err).toBe(0);
  });

  it("잠금 파일이 없거나 깨졌으면 1 + 읽을 수 있는 이유(맨 stack 이 아니라)", () => {
    // 왜: `npm install --package-lock-only` 가 조용히 실패했거나 앱에 잠금 파일이 없을 때,
    // Actions 로그에 node stack 만 남으면 사람이 무엇을 고쳐야 할지 모른다.
    const noLock = mkdtempSync(join(tmpdir(), "verify-lock-nolock-"));
    writeFileSync(
      join(noLock, "package.json"),
      JSON.stringify({ name: "x", dependencies: { "@wedly/policy-match-shared": SPEC(SHA) } }),
    );
    expectRejected(run(noLock, SHA), /package-lock\.json/);

    const broken = app({ pkgSha: SHA, lockRootSha: SHA, lockResolvedSha: SHA });
    writeFileSync(join(broken, "package-lock.json"), "{ 이건 JSON 이 아니다");
    expectRejected(run(broken, SHA), /package-lock\.json/);
  });

  // ── 2026-09-08 3차 리뷰 G2(P2): 「읽기 성공」과 「값」은 다른 이야기다 ──

  it("파일 내용이 null·false·0·\"\" 이면 1 — 검사를 건너뛰고 통과하지 않는다", () => {
    // ★막는 사고: 옛 판은 읽기만 성공하면 그 값을 그대로 돌려주고 부르는 쪽이 `if (pkg)` 로 감쌌다.
    //  그래서 파일을 `0` 한 글자로 바꿔 오면 **아무것도 안 보고 OK** 가 찍혔다(핀·잠금 대조가 통째로 사라짐).
    //  JSON 으로는 멀쩡히 읽히지만 개체가 아닌 값 넷을 두 파일 각각에 넣어 잰다.
    for (const body of ["null", "false", "0", '""']) {
      const rootA = app({ pkgSha: SHA, lockRootSha: SHA, lockResolvedSha: SHA });
      writeFileSync(join(rootA, "package.json"), body);
      expectRejected(run(rootA, SHA), /package\.json 의 최상위가 개체가 아님/);

      const rootB = app({ pkgSha: SHA, lockRootSha: SHA, lockResolvedSha: SHA });
      writeFileSync(join(rootB, "package-lock.json"), body);
      expectRejected(run(rootB, SHA), /package-lock\.json 의 최상위가 개체가 아님/);
    }
  });

  it("설치 잠금이 개체가 아니어도 1 — --installed 갈래도 같은 규칙", () => {
    const root = app({ pkgSha: SHA, lockRootSha: SHA, lockResolvedSha: SHA, installedSha: SHA });
    writeFileSync(join(root, "node_modules/.package-lock.json"), "0");
    expectRejected(run(root, SHA, "--installed"), /최상위가 개체가 아님/);
  });

  it("SHA 가 40자리 16진수가 아니면 2(사용법 오류)", () => {
    expect(run(app({ pkgSha: SHA, lockRootSha: SHA, lockResolvedSha: SHA }), "b404b4b").code).toBe(2);
  });

  // ── 2026-09-08 4차 리뷰 H2(P2): 깨진 JSON 의 앞부분이 공개 로그로 새지 않는다 ──

  it("깨진 JSON 을 넣어도 그 내용이 stdout·stderr 어디에도 안 실린다", () => {
    // ★막는 사고: `JSON.parse` 가 던지는 오류문에는 **입력의 앞부분이 그대로 들어간다**
    //  (node 22 실측: `Unexpected token 'P', "PRIVATE_RE"... is not valid JSON`).
    //  이 대조기가 읽는 것은 **비공개 앱의 파일**(밀기 단계에서는 봉인을 푼 산출물)이고
    //  이 저장소의 Actions 로그는 **공개**다 — 깨진 파일 하나로 그 앞부분이 공개 로그에 실린다.
    //  옛 판은 `err.message` 를 그대로 적었다.
    // ★재는 방식: 표식 전체는 애초에 오류문에 다 들어가지 않는다(V8 이 10여 글자에서 자른다).
    //  그래서 **표식의 앞 9글자**까지 함께 본다 — 이 줄이 옛 코드에서 실제로 빨개지는 자리다.
    for (const target of ["package.json", "package-lock.json"]) {
      const root = app({ pkgSha: SHA, lockRootSha: SHA, lockResolvedSha: SHA });
      writeFileSync(join(root, target), BROKEN);
      expectNoLeak(run(root, SHA), target);
    }

    const installed = app({ pkgSha: SHA, lockRootSha: SHA, lockResolvedSha: SHA, installedSha: SHA });
    writeFileSync(join(installed, "node_modules/.package-lock.json"), BROKEN);
    expectNoLeak(run(installed, SHA, "--installed"), "node_modules/.package-lock.json");
  });
});
