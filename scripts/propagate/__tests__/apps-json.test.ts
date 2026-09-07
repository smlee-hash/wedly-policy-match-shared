import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * `scripts/propagate/apps.json` 형식 시험 — 계획서 Task 1(설계서 §6 D1).
 *
 * ★왜 이 파일이 시험을 받나: 이 명부 하나가 봇이 **어느 저장소의 main 에 커밋을 미는지**를
 *  정한다. 저장소 이름이 한 글자만 틀려도 봇은 엉뚱한 곳을 건드리거나 조용히 죽는다.
 *  그래서 이름을 시험에 **글자로 못 박아** 둔다 — 앱이 늘거나 빠지면 이 시험이 먼저 빨개져
 *  사람이 계획서·PAT 권한 범위를 같이 손보게 만든다.
 *
 * ★`__dirname` 대신 `fileURLToPath(import.meta.url)`: 이 보관함은 `"type": "module"`(ESM)이고
 *  다른 시험 파일들도 같은 방식이다(`readme-imports.test.ts`).
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const path = resolve(HERE, "../apps.json");

describe("scripts/propagate/apps.json", () => {
  const apps = JSON.parse(readFileSync(path, "utf8")) as Array<Record<string, unknown>>;

  it("앱 3곳(ERP·일루아·랩)을 정확히 담는다 — 설계서 §6 D1", () => {
    expect(apps.map((a) => String(a.repo)).sort()).toEqual([
      "smlee-hash/wedly-erp",
      "smlee-hash/wedly-illua-collab",
      "smlee-hash/wedly-policy-lab",
    ]);
  });

  it("각 앱은 id·repo·install·postSteps·commitPaths 를 갖는다", () => {
    for (const a of apps) {
      expect(typeof a.id).toBe("string");
      expect(String(a.repo)).toMatch(/^smlee-hash\/[a-z0-9-]+$/);
      expect(typeof a.install).toBe("boolean");
      expect(Array.isArray(a.postSteps)).toBe(true);
      expect(Array.isArray(a.commitPaths)).toBe(true);
      expect(a.commitPaths).toEqual(expect.arrayContaining(["package.json", "package-lock.json"]));
    }
  });

  it("앱마다 배포 확인용 build-id 주소를 갖는다 — https · /api/build-id", () => {
    // 봇은 핀을 민 뒤 이 주소를 물어 「그 커밋이 실제로 배포됐는지」를 본다(계획서 Task 7).
    // 주소가 틀리면 배포 확인이 늘 시간 초과가 되어 **멀쩡한 배포마다 슬랙 알림**이 온다.
    for (const a of apps) {
      const url = String(a.buildIdUrl);
      expect(url.startsWith("https://"), `${String(a.id)}: ${url}`).toBe(true);
      expect(url.endsWith("/api/build-id"), `${String(a.id)}: ${url}`).toBe(true);
    }
  });

  it("ERP 만 설치+설계 등록부 재생성, 나머지는 잠금 파일만", () => {
    const byId = Object.fromEntries(apps.map((a) => [String(a.id), a] as const));
    expect(byId.erp.install).toBe(true);
    // ★두 번째 단계는 `npm run design:check` 여야 한다 — Railway 가 ERP `build` 첫 단계로 돌리는 바로 그 명령이다.
    //  ERP 의 `design:check` 는 `cli.mjs check` **와** `debt.mjs check` 두 가지다(2026-09-08 실측).
    //  봇이 `cli.mjs check` 만 돌리면 「봇은 초록인데 Railway 배포가 빨간」 상태가 만들어진다.
    expect(byId.erp.postSteps).toEqual([
      "node scripts/design-system/cli.mjs generate",
      "npm run design:check",
    ]);
    expect(byId.erp.commitPaths).toContain("src/lib/design-system/registry.generated.json");
    expect(byId.illua.install).toBe(false);
    expect(byId.illua.postSteps).toEqual([]);
    expect(byId.lab.install).toBe(false);
    expect(byId.lab.postSteps).toEqual([]);
  });
});
