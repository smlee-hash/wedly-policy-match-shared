// 두 새 폴더(`serve/policy-deadline`·`ui/policy-deadline`)의 글에 남기지 않을 것을 글자로 지킨다.
//   · 옛 화면 이름(「마감」과 「임박」을 띄어 붙인 두 낱말) — 이 시험 글에도 한 덩어리로 적지 않는다(아래에서 이어 붙여 만든다).
//   · 「어느 앱인지」를 묻는 비교(앱 이름 글자를 `===`·`!==`·`case` 로 견주는 꼴) — 앱 차이는 받는 값(endpoints·scopeToggle·onOpenCompany…)으로만 푼다.
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const FOLDERS = [new URL("../../serve/policy-deadline/", import.meta.url), new URL("./", import.meta.url)];
const OLD_WORD = ["마감", "임박"].join(" ");
// 앱 이름 글자를 이어 붙여 만든다 — 이 시험 글이 스스로 걸리지 않게.
const APP = ["er", "p"].join("") + "|" + ["ill", "ua"].join("");
const QUOTE = "[\"'`]";
const COMPARISON = new RegExp(`(?:[!=]==?\\s*|\\bcase\\s+)${QUOTE}(?:${APP})${QUOTE}|${QUOTE}(?:${APP})${QUOTE}\\s*[!=]==?`);

function filesOf(folder: URL, extensions: readonly string[]): string[] {
  return readdirSync(folder)
    .filter((name) => extensions.some((extension) => name.endsWith(extension)))
    .map((name) => fileURLToPath(new URL(name, folder)));
}

const allFiles = FOLDERS.flatMap((folder) => filesOf(folder, [".ts", ".tsx", ".md"]));
// 비교 검사는 부품 코드만 본다 — 시험 파일은 검사 식(정규식 글자)이나 「이런 꼴을 잡는다」는 예시 글을 스스로 품기 때문이다.
const codeFiles = FOLDERS.flatMap((folder) => filesOf(folder, [".ts", ".tsx"])).filter((file) => !/\.test\.tsx?$/.test(file));

describe("두 새 폴더의 글", () => {
  it("시험이 실제 글 파일을 읽고 있다(빈 폴더로 통과하지 않는다)", () => {
    expect(allFiles.length).toBeGreaterThan(30);
    expect(codeFiles.some((file) => file.endsWith("PolicyCompaniesScreen.tsx"))).toBe(true);
    expect(codeFiles.some((file) => file.endsWith("handler.ts"))).toBe(true);
  });

  it("옛 화면 이름은 주석·README 를 포함해 한 번도 나오지 않는다", () => {
    const found = allFiles.filter((file) => readFileSync(file, "utf8").includes(OLD_WORD));
    expect(found).toEqual([]);
  });

  it("앱 이름 글자 비교(=== 앱 이름 · case 앱 이름)가 코드에 없다", () => {
    const found = codeFiles.filter((file) => COMPARISON.test(readFileSync(file, "utf8")));
    expect(found).toEqual([]);
  });

  it("비교 검사 식이 진짜 비교 꼴을 잡는다(검사 자체의 시험)", () => {
    const app = APP.split("|")[0];
    expect(COMPARISON.test(`if (kind === "${app}") {}`)).toBe(true);
    expect(COMPARISON.test(`if ('${app}' !== kind) {}`)).toBe(true);
    expect(COMPARISON.test(`switch (a) { case "${app}": break; }`)).toBe(true);
    expect(COMPARISON.test(`const note = "${app} 가 보낸다";`)).toBe(false);
  });
});
