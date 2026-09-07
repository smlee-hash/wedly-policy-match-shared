import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * 「봇 시험이 앱 3곳으로 딸려 가지 않는다」를 **실제 `npm pack` 으로** 재는 회귀 시험 — 2026-09-08 리뷰 R1.
 *
 * ★막는 사고: 이 보관함의 `package.json` 은 `files: ["src","certs","README.md"]` 라
 *  `src/**` 가 통째로 앱의 `node_modules/@wedly/policy-match-shared/` 안으로 들어간다.
 *  그리고 앱 3곳은 그 폴더의 시험을 **배포 관문에서 그대로 돌린다**:
 *    ERP  `vitest.shared.config.ts`      include `node_modules/@wedly/policy-match-shared/src/**\/*.test.{ts,tsx}`
 *    일루아·랩 `vitest.shared-pkg.config.ts` 같은 모양(2026-09-08 실측)
 *  봇 시험은 `scripts/propagate/*.sh` 를 실제로 돌리는데 **앱 쪽에는 그 폴더가 없다** —
 *  그래서 봇 시험이 `src/` 에 있으면 앱 3곳의 배포가 전부 막힌다. 그래서 `scripts/propagate/__tests__/` 로 옮겼다.
 *
 * ★왜 「포장에 `*.test.*` 가 하나도 없어야 한다」로 재지 않나(총괄 판정 R1 문구에서 좁힌 부분):
 *  `src/**\/*.test.ts` 200여 개는 **일부러 포장에 넣는다** — 그게 위 세 앱의 공용 꾸러미 관문이 돌리는 바로 그 시험이고,
 *  ERP `vitest.shared.config.ts` 머리주석이 「핀만 올려도 판정·화면이 조용히 뒤집힌 채 배포되던 창을 이 설정이 닫는다」고
 *  적어 둔 안전망이다. 그것까지 빼면 관문이 조용히 비어 버린다. 그래서 이 시험은
 *  **① `scripts/` 경로 0건 ② `__tests__` 경로 0건 ③ 봇 시험 파일 이름 0건** 을 재고,
 *  반대로 **④ `src` 시험이 여전히 포장에 들어 있다**(관문이 비지 않았다)까지 함께 잰다.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../..");

/** 봇 시험 파일들 — 이름이 하나라도 포장 목록에 보이면 앱 관문이 깨진다 */
const BOT_TEST_FILES = [
  "apps-json.test.ts",
  "notify.test.ts",
  "pack-excludes.test.ts",
  "propagate.test.ts",
  "resolve-shell.test.ts",
  "verify-artifact.test.ts",
  "verify-lock.test.ts",
  "watch-deploy.test.ts",
  "workflow.test.ts",
];

function packedPaths(): string[] {
  const r = spawnSync("npm", ["pack", "--dry-run", "--json"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: { ...process.env, npm_config_loglevel: "silent" },
  });
  expect(r.status, `npm pack 이 실패했습니다:\n${r.stdout}\n${r.stderr}`).toBe(0);
  const parsed = JSON.parse(r.stdout) as Array<{ files?: Array<{ path: string }> }>;
  const files = parsed[0]?.files ?? [];
  return files.map((f) => f.path);
}

describe("npm pack 목록(앱 3곳으로 나가는 파일)", () => {
  const paths = packedPaths();

  it("포장이 실제로 만들어졌다 — 목록이 비어 있지 않다", () => {
    // 목록이 비면 아래 「없다」 시험들이 전부 거저 통과한다(빈 껍데기 시험 방지).
    expect(paths.length).toBeGreaterThan(100);
    expect(paths).toContain("package.json");
    expect(paths).toContain("src/index.ts");
  });

  it("`scripts/` 로 시작하는 파일이 하나도 없다 — 봇 코드·시험은 앱으로 나가지 않는다", () => {
    expect(paths.filter((p) => p.startsWith("scripts/"))).toEqual([]);
  });

  it("`__tests__` 폴더가 하나도 없다", () => {
    expect(paths.filter((p) => p.split("/").includes("__tests__"))).toEqual([]);
  });

  it("봇 시험 파일 이름이 어느 경로에도 없다", () => {
    const leaked = paths.filter((p) => BOT_TEST_FILES.includes(p.split("/").pop() ?? ""));
    expect(leaked).toEqual([]);
  });

  it("반대로 `src` 의 시험은 여전히 포장에 들어간다 — 앱 3곳의 공용 꾸러미 관문이 그걸 돌린다", () => {
    const srcTests = paths.filter((p) => p.startsWith("src/") && /\.test\.tsx?$/.test(p));
    expect(srcTests.length).toBeGreaterThan(50);
  });
}, 120_000);
