import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// 앱(일루아·ERP)의 글자 층 검사가 이 꾸러미의 화면 부품도 읽는다. 핀을 올린 뒤에야
// 앱 시험에서 걸리지 않게, 제목(h2·h3)과 표 머리(thead)의 층 밖 크기를 여기서 먼저 막는다.
const DIR = __dirname;
const RAW_SIZE = /\btext-(xs|sm|base|lg|xl|[2-9]xl|\[\d)/;

describe("정책매칭 화면 부품의 글자 층", () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith(".tsx") && !f.includes(".test."));

  it("h2·h3·thead 와 thead 안 tr 은 층 클래스만 쓴다", () => {
    const bad: string[] = [];
    for (const f of files) {
      const lines = readFileSync(join(DIR, f), "utf8").split("\n");
      lines.forEach((line, i) => {
        const tag = line.match(/<(h2|h3|thead)\b[^>]*>/);
        const theadRow = lines[i - 1]?.includes("<thead") && line.match(/<tr\b[^>]*>/);
        const hit = tag?.[0] ?? (theadRow ? theadRow[0] : null);
        if (!hit) return;
        if (RAW_SIZE.test(hit)) bad.push(`${f}:${i + 1} 층 밖 크기`);
        // 클래스를 상수·식으로 넘겨도(className={SECTION_TITLE}) 층 클래스는 태그에 글자 그대로 있어야 한다 —
        // 앱 쪽 검사도 태그 글자만 읽는다.
        if (tag && !/text-wedly-(section|sub|tablehead|page|value)/.test(hit)) {
          bad.push(`${f}:${i + 1} 층 클래스 없음`);
        }
      });
    }
    expect(bad).toEqual([]);
  });
});
