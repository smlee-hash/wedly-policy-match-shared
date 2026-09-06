import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { jbbaConfig, parseJbbaList } from "./jbba";

const list = readFileSync(join(__dirname, "../__fixtures__/jbba-list.html"), "utf-8");

describe("jbba 전북경제통상진흥원 — 목록 파싱", () => {
  it("공고 행을 뽑고 2자리 연도를 4자리로 바꾼다", () => {
    const rows = parseJbbaList(list, jbbaConfig);
    expect(rows.length).toBeGreaterThanOrEqual(15);
    const first = rows[0];
    expect(first.title).toContain("수출애로 해소 전문가 컨설팅");
    expect(first.detailUrl).toContain("board.php?bo_table=sub01_09&wr_id=");
    // 목록 원문은 "26.03.06 ~ 26.11.30" — 변환 결과가 4자리 연도여야 한다
    expect(first.dateText).toMatch(/2026[.\-]03[.\-]06/);
    expect(first.dateText).toMatch(/2026[.\-]11[.\-]30/);
  });
  it("모든 행의 상세 URL 이 jbba.kr host 다", () => {
    for (const r of parseJbbaList(list, jbbaConfig)) {
      expect(new URL(r.detailUrl).hostname).toBe("www.jbba.kr");
    }
  });
});

describe("jbba — config", () => {
  it("목록 URL 은 page 매개변수로 쪽을 넘긴다", () => {
    expect(jbbaConfig.list.url(2)).toBe("https://www.jbba.kr/bbs/board.php?bo_table=sub01_09&page=2");
  });
  it("상세 본문 선택자는 정보 표(.tbl_frs01)와 본문(#bo_v_con)을 함께 읽는다", () => {
    expect(jbbaConfig.detailContentSelector).toBe(".tbl_frs01, #bo_v_con");
  });
});
