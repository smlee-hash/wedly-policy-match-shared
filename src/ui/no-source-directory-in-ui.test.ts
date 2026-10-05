import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * 화면 부품(src/ui)이 수집원 정본 명부를 **값으로** 가져오지 않는지 — 2026-10-05 랩 리뷰 P1.
 * 화면 부품은 브라우저 코드로 실리므로, 명부(상태·주소·메모)가 닿으면 어느 앱에서든 읽힌다.
 * `import type`·`export type` 은 지워지므로 허용한다. 명부·묶음 입구(꾸러미 루트·funding/index·serve)는
 * 화면에서 닿지 않아야 한다. 상대 경로(.js 확장자 포함)·꾸러미 자기 이름(package.json exports)·
 * 동적 import·부작용 import 를 모두 따라간다 — 같은 날 꾸러미 리뷰 P2 두 차례(글자 패턴은 반례가 끝없어 컴파일러로 바꿈).
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

/**
 * 브라우저 코드에 남는 import 경로를 모두 뽑는다 — 글자 패턴이 아니라 TypeScript 가 직접 한다.
 * ① transpileModule 로 타입 전용 참조(import type·{ type X }·쓰지 않는 import)를 묶음 도구처럼 지우고
 * ② 남은 코드의 구문 나무에서 정적 import·export … from·import()·require() 를 읽는다.
 * import()·require() 인자가 글자 그대로가 아니면 어디로 가는지 모르므로 "?" 를 돌려 실패시킨다.
 */
export function valueImports(text: string, fileName = "x.tsx"): string[] {
  const js = ts.transpileModule(text, {
    fileName,
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.Preserve },
  }).outputText;
  const sf = ts.createSourceFile("out.js", js, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
  const out: string[] = [];
  const literal = (e: ts.Expression | undefined) => {
    let x = e;
    while (x && ts.isParenthesizedExpression(x)) x = x.expression;
    return x && (ts.isStringLiteral(x) || ts.isNoSubstitutionTemplateLiteral(x)) ? x.text : "?";
  };
  const visit = (n: ts.Node): void => {
    if ((ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier) out.push(literal(n.moduleSpecifier));
    else if (ts.isCallExpression(n)) {
      let callee: ts.Expression = n.expression;
      while (ts.isParenthesizedExpression(callee)) callee = callee.expression;
      const dyn = callee.kind === ts.SyntaxKind.ImportKeyword;
      const req = ts.isIdentifier(callee) && callee.text === "require";
      if (dyn || req) {
        out.push(literal(n.arguments[0]));
        n.arguments.forEach(visit);
        return;
      }
    } else if (ts.isIdentifier(n) && n.text === "require") {
      // 호출 말고 다른 식(별칭·넘기기)으로 쓰인 require 는 어디로 가는지 모른다 — 실패로 친다.
      out.push("?");
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
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
    for (const spec of valueImports(text, f)) {
      if (spec === "?") {
        hits.push([...path, "(글자가 아닌 import 경로)"].join(" → "));
        continue;
      }
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
  }, 60_000); // 화면 파일마다 컴파일러로 바꿔 보므로 바쁜 기계에서 5초를 넘는다.

  it("검사기가 우회 import 방식을 모두 잡는다", () => {
    const drawer = join(SRC, "ui", "FundingDrawer.tsx");
    // 묶음 도구처럼 쓰지 않는 import 는 지워지므로, 가져온 이름을 실제로 쓰는 줄을 붙여 본다.
    const caught = (line: string) =>
      forbiddenPaths(drawer, { [drawer]: `${line}\nexport const __use = () => SOURCE_DIRECTORY;` }).length > 0;
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
    expect(caught(`import/* d */{ SOURCE_DIRECTORY as r } from "../funding/source-directory";\nexport const n = r.length;`)).toBe(true);
    expect(caught(`export{SOURCE_DIRECTORY}from"../funding/source-directory";`)).toBe(true);
    expect(caught(`export async function f() { return (await import(("../funding/source-directory"))).SOURCE_DIRECTORY; }`)).toBe(true);
    expect(caught(`const r = require("../funding/source-directory");`)).toBe(true);
    expect(caught(`export const d = (require)("../funding/source-directory").SOURCE_DIRECTORY;`)).toBe(true);
    expect(caught(`const q = require; export const d = q("../funding/source-directory");`)).toBe(true);
    expect(caught(`export const d = (import)("../funding/source-directory" as string);`.replace("(import)", "import"))).toBe(true);
    expect(caught(`const p = "../funding/" + "source-directory"; export const f = () => import(p);`)).toBe(true);
    expect(caught(`import type { SourceEntry } from "../funding/source-directory";`)).toBe(false);
    expect(caught(`import { type DirectoryStatus } from "../funding/source-directory";`)).toBe(false);
    expect(caught(`export { type DirectoryStatus } from "../funding/source-directory";`)).toBe(false);
    expect(caught(`export type S = import("../funding/source-directory").DirectoryStatus;`)).toBe(false);
    expect(caught(`import\n  type { DirectoryStatus } from "../funding/source-directory";`)).toBe(false);
    expect(caught(`export type { SourceEntry } from "../funding/source-directory";`)).toBe(false);
    expect(caught(`// import { SOURCE_DIRECTORY } from "../funding/source-directory";`)).toBe(false);
    expect(caught(`import { ANNOUNCEMENT_SOURCE_LABELS } from "../funding/source-labels";`)).toBe(false);
  });
});
