import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { djbeaConfig, parseDjbeaList } from "./djbea";

const list = readFileSync(join(__dirname, "../__fixtures__/djbea-list.html"), "utf-8");

describe("djbea 대전일자리경제진흥원 — 목록 파싱", () => {
  it("li 행에서 data-id 로 상세 URL 을 만든다", () => {
    const rows = parseDjbeaList(list, djbeaConfig);
    expect(rows.length).toBeGreaterThanOrEqual(8);
    const first = rows[0];
    expect(first.title).toContain("기업 직접물류비");
    expect(first.detailUrl).toBe(
      "https://www.djbea.or.kr/mps/bizTskPbnc/view?tsk_pbnc_id=2026-0144&menuKey=TOfnnvp207",
    );
    // 접수기간 라벨의 값을 쓴다(공고기간 아님)
    // 시각(10시·23시)은 버리고 날짜만 — 시각이 남으면 범위 해석이 깨진다(첫 수집 실측 회귀 방지)
    expect(first.dateText).toBe("2026-10-01 ~ 2026-10-09");
  });
  it("분류(label)를 행별로 뽑는다", () => {
    const rows = parseDjbeaList(list, djbeaConfig);
    expect(rows[0].category).toBe("중소기업지원");
  });
});
