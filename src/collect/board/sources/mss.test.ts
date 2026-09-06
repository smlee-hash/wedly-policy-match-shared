import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { mssConfig, parseMssList } from "./mss";

const list = readFileSync(join(__dirname, "../__fixtures__/w3-mss-list.html"), "utf-8");

describe("mss 중소벤처기업부 — 목록 파싱", () => {
  it("tr title 과 doBbsFView 2번째 인자로 상세 GET 주소를 만든다", () => {
    const rows = parseMssList(list, mssConfig);
    expect(rows.length).toBeGreaterThanOrEqual(8);
    const first = rows[0];
    expect(first.title).toBe("2026년 중소기업 CBAM대응 인프라구축 사업 참여기업 3차 모집공고");
    expect(first.detailUrl).toBe(
      "https://www.mss.go.kr/site/smba/ex/bbs/View.do?cbIdx=310&bcIdx=1070709",
    );
  });

  it("행 안 신청기간 범위를 dateText 로 쓴다(등록일 단독은 마감 오인이라 금지)", () => {
    const rows = parseMssList(list, mssConfig);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      // 범위가 있으면 「시작 ~ 끝」, 없으면 빈 값 — 등록일 단독(끝날짜 오인)은 절대 아님
      expect(r.dateText === "" || /20\d{2}-\d{2}-\d{2}\s*~\s*20\d{2}-\d{2}-\d{2}/.test(r.dateText)).toBe(true);
    }
    const cbam = rows.find((r) => r.title.includes("CBAM"));
    expect(cbam?.dateText).toBe("2026-08-25 ~ 2026-09-15");
  });
});

describe("mss — config", () => {
  it("목록 URL 은 pageIndex 매개변수로 쪽을 넘긴다", () => {
    expect(mssConfig.list.url(2)).toBe(
      "https://www.mss.go.kr/site/smba/ex/bbs/List.do?cbIdx=310&pageIndex=2",
    );
  });
  it("상세 본문 선택자는 고정본 실측대로 .view_contents", () => {
    expect(mssConfig.detailContentSelector).toBe(".view_contents");
  });
});
