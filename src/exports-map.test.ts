import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * `package.json` 의 `exports` 지도가 **실재하는 파일**을 가리키는지 잰다.
 *
 * ★왜 필요한가: 지도에 오타가 나거나 파일을 옮기고 지도를 안 고치면, 이 저장소의
 *  타입 검사·시험은 **전부 초록**이다(둘 다 지도를 안 본다). 잘못은 소비 앱에서만
 *  터진다 — Railway 빌드가 `ERR_PACKAGE_PATH_NOT_EXPORTED` 나
 *  `Cannot find module` 로 죽는데, 그때는 이미 배포 중이라 되돌리는 값이 비싸다.
 *  그 오류를 여기서 미리 잡는다.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
  exports: Record<string, string | Record<string, string>>;
};

/** 한 항목이 가리키는 파일 경로들(`types`·`default` 둘 다 잰다). */
function targetsOf(value: string | Record<string, string>): string[] {
  return typeof value === "string" ? [value] : Object.values(value);
}

const entries = Object.entries(pkg.exports);
const 낱개 = entries.filter(([subpath]) => !subpath.includes("*"));
const 별표 = entries.filter(([subpath]) => subpath.includes("*"));

describe("exports 지도 — 낱개 주소", () => {
  it("항목이 실제로 여럿 있다(빈 목록이면 아래 시험이 공허하다)", () => {
    expect(낱개.length).toBeGreaterThan(20);
  });

  for (const [subpath, value] of 낱개) {
    it(`${subpath} → 파일이 있다`, () => {
      for (const target of targetsOf(value)) {
        expect(target.startsWith("./"), `${subpath} 의 목적지는 ./ 로 시작해야 한다`).toBe(true);
        const abs = join(ROOT, target);
        expect(existsSync(abs), `${subpath} → ${target} 이 없다`).toBe(true);
        expect(statSync(abs).isFile(), `${subpath} → ${target} 이 파일이 아니다`).toBe(true);
      }
    });
  }
});

describe("exports 지도 — 별표(와일드카드) 주소", () => {
  for (const [subpath, value] of 별표) {
    it(`${subpath} → 그 자리에 실제 파일이 있다`, () => {
      for (const target of targetsOf(value)) {
        const [앞, 뒤] = target.split("*");
        expect(뒤, `${subpath} 의 목적지에 * 가 하나여야 한다`).toBeDefined();
        const dir = join(ROOT, dirname(앞.endsWith("/") ? `${앞}x` : 앞));
        expect(existsSync(dir), `${subpath} → ${dir} 폴더가 없다`).toBe(true);
        const 짝 = readdirSync(dir).filter((f) => f.endsWith(뒤));
        expect(짝.length, `${subpath} 로 부를 수 있는 파일이 하나도 없다`).toBeGreaterThan(0);
      }
    });
  }
});

describe("exports 지도 — 새로 옮겨 온 화면·판정 지시문(P4)", () => {
  const 있어야 = [
    "./ai", "./ai/verdict", "./ai/breakthrough", "./ai/tacit-types",
    "./ui/policy",
    "./ui/policy/PolicyMatchScreen", "./ui/policy/ProfileForm", "./ui/policy/ResultList",
    "./ui/policy/DetailPanel", "./ui/policy/SourceDirectoryPanel", "./ui/policy/Modal",
    "./ui/policy/endpoints", "./ui/policy/detail-poll", "./ui/policy/ask-instructor-text",
  ];

  it("앱이 부를 주소가 지도에 전부 있다 — 하나라도 빠지면 소비 앱 빌드에서만 터진다", () => {
    for (const subpath of 있어야) {
      expect(pkg.exports[subpath], `${subpath} 가 exports 에 없다`).toBeDefined();
    }
  });

  it("화면 부품은 `src/ui/index.ts` 배럴에 얹지 않는다 — \"use client\" 여섯을 통째로 끌고 간다", () => {
    const barrel = readFileSync(join(ROOT, "src/ui/index.ts"), "utf8");
    expect(barrel).not.toContain("./policy");
  });
});
