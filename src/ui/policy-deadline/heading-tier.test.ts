// 이 폴더 화면 부품의 제목(<h1>~<h4>) 글자 크기가 앱의 글자 층을 따르는지 글자로 지킨다.
// 층 규칙은 ERP 의 글자 층 검사(src/lib/nav/text-tiers.ts 의 기대층)와 같다 — h1 page · h2 section · h3·h4 sub.
// ERP 시험이 공용 부품까지 읽어 잡지만, 그건 핀을 옮긴 뒤라 공용 PR 에서 먼저 막는다
// (0.1.6 캘린더 달 제목 <h3> 이 text-wedly-section 을 써 ERP 에서야 걸린 자리).
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const FOLDER = new URL("./", import.meta.url);
const EXPECTED = { h1: "page", h2: "section", h3: "sub", h4: "sub" } as const;
const TIERS = ["page", "section", "value", "sub", "hint", "label", "tablehead"];
// 층 밖 크기 — tailwind 기본 크기와 [..px] 같은 임의 크기.
const RAW_SIZE = /^(?:[a-z]+:)?text-(?:xs|sm|base|lg|[2-9]?xl|\[[^\]]+\])$/;

/** 어긴 자리를 「N행 <hX> 받은 것 → 써야 할 것」 글로 돌려준다. 맞으면 빈 배열. */
function headingTierProblems(source: string): string[] {
  const problems: string[] = [];
  const lines = source.split("\n");
  lines.forEach((line, index) => {
    for (const match of line.matchAll(/<(h[1-4])(?=[\s>])([^>]*)>/g)) {
      const tag = match[1] as keyof typeof EXPECTED;
      const want = `text-wedly-${EXPECTED[tag]}`;
      const where = `${index + 1}행 <${tag}>`;
      const literal = /className="([^"]*)"/.exec(match[2]);
      if (!literal) {
        problems.push(`${where} className 을 글자 그대로 적어라(검사가 읽을 수 있게)`);
        continue;
      }
      const tokens = literal[1].split(/\s+/).filter(Boolean);
      const sizes = tokens.filter(
        (token) => RAW_SIZE.test(token) || TIERS.some((tier) => token.replace(/^[a-z]+:/, "") === `text-wedly-${tier}`),
      );
      if (sizes.length === 1 && sizes[0] === want) continue;
      problems.push(`${where} ${sizes.length ? sizes.join(",") : "크기 없음"} → ${want}`);
    }
  });
  return problems;
}

const files = readdirSync(FOLDER)
  .filter((name) => name.endsWith(".tsx") && !/\.test\.tsx$/.test(name))
  .map((name) => fileURLToPath(new URL(name, FOLDER)));

describe("화면 부품 제목의 글자 층", () => {
  it("시험이 실제 부품 파일을 읽고 있다(빈 폴더로 통과하지 않는다)", () => {
    expect(files.some((file) => file.endsWith("ContactsCalendar.tsx"))).toBe(true);
    expect(files.some((file) => file.endsWith("Scorecard.tsx"))).toBe(true);
  });

  it("모든 <h1>~<h4> 가 제 층 크기 하나만 쓴다", () => {
    const found = files.flatMap((file) =>
      headingTierProblems(readFileSync(file, "utf8")).map((problem) => `${file.split("/").pop()} ${problem}`),
    );
    expect(found).toEqual([]);
  });

  it("검사 식이 층을 어긴 제목을 잡는다(검사 자체의 시험)", () => {
    expect(headingTierProblems(`<h3 className="text-wedly-section font-semibold">가</h3>`))
      .toEqual(["1행 <h3> text-wedly-section → text-wedly-sub"]);
    expect(headingTierProblems(`<h2 className="text-lg">가</h2>`)).toEqual(["1행 <h2> text-lg → text-wedly-section"]);
    expect(headingTierProblems(`<h4 className="font-bold">가</h4>`)).toEqual(["1행 <h4> 크기 없음 → text-wedly-sub"]);
    expect(headingTierProblems(`<h2 className="text-wedly-section sm:text-xl">가</h2>`))
      .toEqual(["1행 <h2> text-wedly-section,sm:text-xl → text-wedly-section"]);
    expect(headingTierProblems(`<h3 className={cls}>가</h3>`))
      .toEqual(["1행 <h3> className 을 글자 그대로 적어라(검사가 읽을 수 있게)"]);
    expect(headingTierProblems(`<h3 className="text-wedly-sub font-semibold text-wedly-navy">가</h3>`)).toEqual([]);
    expect(headingTierProblems(`<header className="text-xl">가</header>`)).toEqual([]);
  });
});
