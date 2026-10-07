import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// 앱(일루아·ERP)의 글자 층 검사가 이 꾸러미의 화면 부품도 읽는다. 핀을 올린 뒤에야
// 앱 시험에서 걸리지 않게, 제목(h2·h3)과 표 머리(thead)의 층 밖 크기를 여기서 먼저 막는다.
const DIR = __dirname;
const RAW_SIZE = /\btext-(xs|sm|base|lg|xl|[2-9]xl|\[\d)/;
const TIER = /text-wedly-(section|sub|tablehead|page|value)/;

/** 파일 전체에서 태그를 찾는다 — 여는 태그가 여러 줄이어도 놓치지 않는다. */
export function tierProblems(name: string, src: string): string[] {
  const bad: string[] = [];
  const lineOf = (index: number) => src.slice(0, index).split("\n").length;
  for (const m of src.matchAll(/<(h2|h3|thead)\b[^>]*>/g)) {
    const at = `${name}:${lineOf(m.index)}`;
    if (RAW_SIZE.test(m[0])) bad.push(`${at} 층 밖 크기`);
    // 클래스를 상수·식으로 넘겨도(className={SECTION_TITLE}) 층 클래스는 태그에 글자 그대로 있어야 한다 —
    // 앱 쪽 검사도 태그 글자만 읽는다.
    if (!TIER.test(m[0])) bad.push(`${at} 층 클래스 없음`);
  }
  for (const m of src.matchAll(/<thead\b[^>]*>\s*(<tr\b[^>]*>)/g)) {
    if (RAW_SIZE.test(m[1])) bad.push(`${name}:${lineOf(m.index)} thead 안 tr 에 층 밖 크기`);
  }
  return bad;
}

describe("정책매칭 화면 부품의 글자 층", () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith(".tsx") && !f.includes(".test."));

  it("h2·h3·thead 와 thead 안 tr 은 층 클래스만 쓴다", () => {
    expect(files.length).toBeGreaterThan(5);
    expect(files.flatMap((f) => tierProblems(f, readFileSync(join(DIR, f), "utf8")))).toEqual([]);
  });

  it("검사기가 실제로 겪은 모양을 잡는다(크기 직접·상수 참조·여러 줄 태그·thead 안 tr)", () => {
    expect(tierProblems("a", '<h2 className="text-lg font-semibold">x</h2>')).toEqual(["a:1 층 밖 크기", "a:1 층 클래스 없음"]);
    expect(tierProblems("a", "<h3 className={SECTION_TITLE}>x</h3>")).toEqual(["a:1 층 클래스 없음"]);
    expect(tierProblems("a", "<div>\n<h3\n  className={SECTION_TITLE}\n>x</h3>")).toEqual(["a:2 층 클래스 없음"]);
    expect(tierProblems("a", "<thead\n>\n<tr />")).toEqual(["a:1 층 클래스 없음"]);
    expect(tierProblems("a", '<thead className="text-wedly-tablehead">\n  <tr className="text-xs">')).toEqual([
      "a:1 thead 안 tr 에 층 밖 크기",
    ]);
    expect(tierProblems("a", '<h3 className="text-wedly-sub font-semibold">x</h3>')).toEqual([]);
  });
});
