import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 화면 부품(src/ui)이 수집원 정본 명부를 **값으로** 가져오지 않는지 — 2026-10-05 랩 리뷰 P1.
 * 화면 부품은 브라우저 코드로 실리므로, 명부(상태·주소·메모)가 닿으면 어느 앱에서든 읽힌다.
 * `import type`·`export type` 은 지워지므로 허용한다. 명부·묶음 입구(꾸러미 루트·funding/index·serve)는
 * 화면에서 닿지 않아야 한다. 상대 경로(.js 확장자 포함)·꾸러미 자기 이름(package.json exports)·
 * 동적 import·부작용 import 를 모두 따라간다 — 같은 날 꾸러미 리뷰 P2.
 */
const SRC = resolve(__dirname, "..");
const ROOT = resolve(SRC, "..");
const PKG = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
  name: string;
  exports: Record<string, string | { default?: string; types?: string }>;
};
const FORBIDDEN = ["index.ts", "funding/source-directory.ts", "funding/index.ts", "serve/sources-summary.ts", "serve/index.ts"];

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return filesUnder(p);
    return /\.(ts|tsx)$/.test(n) && !/\.test\.(ts|tsx)$/.test(n) ? [p] : [];
  });
}

/** 주석을 지운 본문에서 값으로 가져오는 경로를 모두 뽑는다. */
export function valueImports(text: string): string[] {
  const code = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'])\/\/.*$/gm, "$1");
  const out: string[] = [];
  const res = [
    /\b(?:import|export)\s+(?!type\b)[^;]*?\bfrom\s*["']([^"']+)["']/g,
    /\bimport\s*["']([^"']+)["']/g,
    /\bimport\s*\(\s*["'`]([^"'`]+)["'`]\s*[,)]/g,
    /\brequire\s*\(\s*["'`]([^"'`]+)["'`]\s*\)/g,
  ];
  for (const re of res) for (const m of code.matchAll(re)) out.push(m[1]);
  return out;
}

function firstFile(base: string): string | null {
  const stripped = base.replace(/\.(m?js|jsx)$/, "");
  for (const c of [base, `${stripped}.ts`, `${stripped}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  return null;
}

function exportTarget(sub: string): string | null {
  const pick = (v: string | { default?: string; types?: string }) => (typeof v === "string" ? v : (v.default ?? v.types ?? null));
  if (PKG.exports[sub]) return pick(PKG.exports[sub]);
  for (const [key, v] of Object.entries(PKG.exports)) {
    if (!key.endsWith("/*")) continue;
    const head = key.slice(0, -1);
    const t = pick(v);
    if (t && sub.startsWith(head)) return t.replace("*", sub.slice(head.length));
  }
  return null;
}

/** 경로를 꾸러미 안 파일로 푼다. 바깥 꾸러미면 null. */
export function resolveSpec(from: string, spec: string): string | null {
  if (spec.startsWith(".")) return firstFile(resolve(dirname(from), spec));
  if (spec === PKG.name || spec.startsWith(`${PKG.name}/`)) {
    const sub = spec === PKG.name ? "." : `./${spec.slice(PKG.name.length + 1)}`;
    const t = exportTarget(sub);
    return t ? firstFile(resolve(ROOT, t)) : null;
  }
  return null;
}

/** start 에서 값 import 를 따라가 금지 파일에 닿는 길을 모은다. override 는 시험용 가짜 본문. */
export function forbiddenPaths(start: string, override: Record<string, string> = {}): string[] {
  const hits: string[] = [];
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
    const text = override[f] ?? readFileSync(f, "utf8");
    for (const spec of valueImports(text)) {
      const next = resolveSpec(f, spec);
      if (next && next.startsWith(SRC)) stack.push([next, [...path, relative(SRC, next)]]);
    }
  }
  return hits;
}

describe("화면 부품은 수집원 명부를 브라우저 코드로 싣지 않는다", () => {
  it("src/ui 의 어느 파일에서 값 import 를 따라가도 명부·묶음 입구에 닿지 않는다", () => {
    const hits = filesUnder(join(SRC, "ui")).flatMap((f) => forbiddenPaths(f));
    expect(hits).toEqual([]);
  });

  it("검사기가 우회 import 방식을 모두 잡는다", () => {
    const drawer = join(SRC, "ui", "FundingDrawer.tsx");
    const caught = (line: string) => forbiddenPaths(drawer, { [drawer]: line }).length > 0;
    expect(caught(`import { SOURCE_DIRECTORY } from "../funding/source-directory";`)).toBe(true);
    expect(caught(`import { SOURCE_DIRECTORY } from "../funding/source-directory.js";`)).toBe(true);
    expect(caught(`import { SOURCE_DIRECTORY } from "@wedly/policy-match-shared/source-directory";`)).toBe(true);
    expect(caught(`import { SOURCE_DIRECTORY } from "@wedly/policy-match-shared";`)).toBe(true);
    expect(caught(`export * from "@wedly/policy-match-shared/source-directory";`)).toBe(true);
    expect(caught(`export * from "../funding/source-directory";`)).toBe(true);
    expect(caught(`const m = await import ( "../funding/source-directory" );`)).toBe(true);
    expect(caught(`import "../funding/source-directory";`)).toBe(true);
    expect(caught(`import {\n  SOURCE_DIRECTORY,\n} from "../funding/source-directory";`)).toBe(true);
    expect(caught(`import { type X, SOURCE_DIRECTORY } from "../funding/source-directory";`)).toBe(true);
    expect(caught(`import type { SourceEntry } from "../funding/source-directory";`)).toBe(false);
    expect(caught(`export type { SourceEntry } from "../funding/source-directory";`)).toBe(false);
    expect(caught(`// import { SOURCE_DIRECTORY } from "../funding/source-directory";`)).toBe(false);
    expect(caught(`import { ANNOUNCEMENT_SOURCE_LABELS } from "../funding/source-labels";`)).toBe(false);
  });
});
