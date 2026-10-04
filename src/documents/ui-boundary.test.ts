import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * 화면(src/ui)이 서류 읽기 **서버 모듈**을 가져오지 않는지 잰다.
 *
 * ★왜 필요한가: 서류 읽기(index·extract-text·parse-* …)는 unpdf·adm-zip·xlsx 와 node:zlib 을 쓰는 서버 전용이다.
 *  화면 부품이 이것을 가져오면 브라우저 번들에 서버 코드가 통째로 들어가 빌드가 깨지거나 번들이 부푼다.
 *  화면은 결과 모양만 담은 `documents/types` 하나만 가져올 수 있다.
 */

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

/** `from "x"` · `import "x"` · `import("x")` · `require("x")` 의 주소들(나온 순서대로). */
function specifiersOf(code: string): string[] {
  const re = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)["']([^"']+)["']/g;
  return [...code.matchAll(re)].map((m) => m[1]);
}

/** documents 폴더(또는 꾸러미 이름의 /documents)를 가리키는데 `types` 가 아닌 주소. */
function isServerDocumentImport(spec: string): boolean {
  const m = /(?:^|\/)documents(?:\/(.*))?$/.exec(spec);
  return m !== null && m[1] !== "types";
}

describe("src/ui — 서류 읽기 서버 모듈을 가져오지 않는다", () => {
  it("documents/types 만 허용하고, index·extract-text·parse-* 등은 어떤 주소로도 가져오지 않는다", () => {
    // 찾는 방법 자체가 맞는지 먼저 확인한다(못 찾으면 아래 검사가 공허하다).
    const sample = [
      'import { readDocuments } from "../documents/index";',
      'import type { DocumentFields } from "../documents/types";',
      'export * from "@wedly/policy-match-shared/documents";',
      'const mod = await import("../../documents/parse-common");',
      'import "@wedly/policy-match-shared/documents/types";',
    ].join("\n");
    expect(specifiersOf(sample).filter(isServerDocumentImport)).toEqual([
      "../documents/index",
      "@wedly/policy-match-shared/documents",
      "../../documents/parse-common",
    ]);

    const files = sourceFiles(join(SRC, "ui"));
    expect(files.length).toBeGreaterThan(5);

    const violations = files.flatMap((file) =>
      specifiersOf(readFileSync(file, "utf8"))
        .filter(isServerDocumentImport)
        .map((spec) => `${file.slice(SRC.length + 1)} → ${spec}`),
    );
    expect(violations).toEqual([]);
  });
});
