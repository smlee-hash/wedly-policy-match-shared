import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 화면 부품(src/ui)이 수집원 정본 명부를 **값으로** 가져오지 않는지 — 2026-10-05 랩 리뷰 P1.
 * 화면 부품은 브라우저 코드로 실리므로, 명부(상태·주소·메모)가 닿으면 어느 앱에서든 읽힌다.
 * `import type` 은 지워지므로 허용한다. 명부·묶음 입구(funding/index·serve)는 화면에서 닿지 않아야 한다.
 */
const SRC = resolve(__dirname, "..");
const FORBIDDEN = ["funding/source-directory.ts", "funding/index.ts", "serve/sources-summary.ts"];

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return filesUnder(p);
    return /\.(ts|tsx)$/.test(n) && !/\.test\.(ts|tsx)$/.test(n) ? [p] : [];
  });
}

function valueImports(file: string): string[] {
  const text = readFileSync(file, "utf8");
  const out: string[] = [];
  const re = /^\s*(import|export)\s+(?!type\b)[^;]*?from\s+["'](\.[^"']+)["']/gms;
  for (const m of text.matchAll(re)) out.push(m[2]);
  for (const m of text.matchAll(/import\(\s*["'](\.[^"']+)["']\s*\)/g)) out.push(m[1]);
  return out;
}

function resolveRel(from: string, spec: string): string | null {
  const base = resolve(dirname(from), spec);
  for (const c of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  return null;
}

describe("화면 부품은 수집원 명부를 브라우저 코드로 싣지 않는다", () => {
  it("src/ui 의 어느 파일에서 값 import 를 따라가도 명부·묶음 입구에 닿지 않는다", () => {
    const hits: string[] = [];
    for (const start of filesUnder(join(SRC, "ui"))) {
      const seen = new Set<string>();
      const stack: Array<[string, string[]]> = [[start, [relative(SRC, start)]]];
      while (stack.length) {
        const [f, path] = stack.pop()!;
        if (seen.has(f)) continue;
        seen.add(f);
        const rel = relative(SRC, f);
        if (FORBIDDEN.includes(rel)) {
          hits.push(path.join(" → "));
          continue;
        }
        for (const spec of valueImports(f)) {
          const next = resolveRel(f, spec);
          if (next && next.startsWith(SRC)) stack.push([next, [...path, relative(SRC, next)]]);
        }
      }
    }
    expect(hits).toEqual([]);
  });
});
