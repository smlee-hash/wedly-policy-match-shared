import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * README 의 **가져오기 예제가 실제로 되는지** 잰다(2026-09-07 독립 리뷰 지적 4).
 *
 * ★왜 필요한가: README 예제는 소비 앱(ERP·일루아·랩)이 껍데기 파일을 적을 때 **그대로 베끼는**
 *  문장이다. 여기가 틀리면 잘못이 이 저장소에서는 한 번도 안 터지고 **소비 앱 빌드**에서만
 *  터진다(`TS2724: has no exported member` · `ERR_PACKAGE_PATH_NOT_EXPORTED`).
 *  실제로 P4 회차의 README 는 기본 내보내기만 있는 `PolicyMatchScreen` 을 낱개 주소에서
 *  **이름으로** 가져오는 예제를 실었다 — 그대로 베끼면 앱이 빌드되지 않는다.
 *
 * 재는 방법은 글자 대조가 아니다: 예제의 주소를 `exports` 지도로 **풀어** 그 파일을 실제로
 * 불러오고, 예제가 쓴 이름·기본 내보내기가 그 모듈에 **정말 있는지** 본다.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PKG_NAME = "@wedly/policy-match-shared";
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
  exports: Record<string, string | Record<string, string>>;
};
const readme = readFileSync(join(ROOT, "README.md"), "utf8");

/** ```ts / ```tsx 코드칸 안의 글자만 본다 — 본문 산문에 적힌 주소는 예제가 아니다. */
function codeBlocks(md: string): string[] {
  const out: string[] = [];
  const re = /```(ts|tsx|js|jsx)\n([\s\S]*?)```/g;
  for (let m = re.exec(md); m; m = re.exec(md)) out.push(m[2]);
  return out;
}

type Stmt = { kind: "import" | "export"; clause: string; subpath: string; line: string };

function statementsOf(code: string): Stmt[] {
  const out: Stmt[] = [];
  const re = new RegExp(
    String.raw`(import|export)\s+([\s\S]*?)\bfrom\s+"(${PKG_NAME.replace("/", "\\/")}[^"]*)"`,
    "g",
  );
  for (let m = re.exec(code); m; m = re.exec(code)) {
    out.push({ kind: m[1] as "import" | "export", clause: m[2], subpath: m[3], line: m[0] });
  }
  return out;
}

function targetOf(value: string | Record<string, string>): string {
  return typeof value === "string" ? value : (value.default ?? Object.values(value)[0]);
}

/** 예제 주소를 `exports` 지도로 푼다 — 낱개가 먼저, 없으면 별표(가장 긴 앞자락). */
function resolveSubpath(subpath: string): string | null {
  const key = subpath === PKG_NAME ? "." : `.${subpath.slice(PKG_NAME.length)}`;
  const direct = pkg.exports[key];
  if (direct) return targetOf(direct);
  let best: { target: string; preLen: number } | null = null;
  for (const [pattern, value] of Object.entries(pkg.exports)) {
    if (!pattern.includes("*")) continue;
    const [pre, post] = pattern.split("*");
    if (!key.startsWith(pre) || !key.endsWith(post)) continue;
    if (key.length < pre.length + post.length) continue;
    const star = key.slice(pre.length, key.length - post.length);
    if (!best || pre.length > best.preLen) {
      best = { target: targetOf(value).replace("*", star), preLen: pre.length };
    }
  }
  return best?.target ?? null;
}

/** 예제가 요구하는 것: 기본 내보내기가 필요한가 · 이름으로 뭘 가져오는가. */
function specsOf(clause: string): { needsDefault: boolean; named: string[] } {
  const c = clause.trim();
  if (c === "*" || /^\*\s+as\s+[\w$]+$/.test(c)) return { needsDefault: false, named: [] };
  const braceAt = c.indexOf("{");
  const head = (braceAt === -1 ? c : c.slice(0, braceAt)).replace(/,\s*$/, "").trim();
  let needsDefault = head.length > 0 && head !== "type";
  const named: string[] = [];
  if (braceAt !== -1) {
    for (const raw of c.slice(braceAt + 1, c.lastIndexOf("}")).split(",")) {
      const name = raw.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0].trim();
      if (!name) continue;
      if (name === "default") needsDefault = true;
      else named.push(name);
    }
  }
  return { needsDefault, named };
}

const stmts = codeBlocks(readme).flatMap(statementsOf);

describe("README 예제 — 적힌 주소·이름이 실물과 맞는다", () => {
  it("예제 문장을 실제로 찾아냈다(0건이면 아래 시험이 공허하다)", () => {
    expect(stmts.length).toBeGreaterThanOrEqual(4);
  });

  it("★`PolicyMatchScreen` 은 기본·이름 **두 가지**로 다 가져올 수 있다(껍데기 두 줄 관례)", async () => {
    const 낱개 = (await import("./ui/policy/PolicyMatchScreen")) as Record<string, unknown>;
    expect(낱개.default, "기존 껍데기 `export { default } from …` 가 계속 돌아야 한다").toBeDefined();
    expect(Object.keys(낱개)).toContain("PolicyMatchScreen");
    expect(낱개.PolicyMatchScreen, "둘은 같은 부품이어야 한다").toBe(낱개.default);
    const 배럴 = (await import("./ui/policy/index")) as Record<string, unknown>;
    expect(배럴.PolicyMatchScreen).toBe(낱개.default);
  });

  for (const s of stmts) {
    it(`${s.subpath} — ${s.line.replace(/\s+/g, " ").slice(0, 80)}`, async () => {
      const target = resolveSubpath(s.subpath);
      expect(target, `${s.subpath} 가 exports 지도에 없다 — 소비 앱에서 ERR_PACKAGE_PATH_NOT_EXPORTED 가 난다`).toBeTruthy();
      if (!target || /\.css$/.test(target)) return;

      const mod = (await import(pathToFileURL(join(ROOT, target)).href)) as Record<string, unknown>;
      const { needsDefault, named } = specsOf(s.clause);
      if (needsDefault) {
        expect(mod.default, `${s.subpath} 에 기본 내보내기가 없다`).toBeDefined();
      }
      for (const name of named) {
        expect(Object.keys(mod), `${s.subpath} 에 \`${name}\` 이름이 없다`).toContain(name);
      }
    });
  }
});
