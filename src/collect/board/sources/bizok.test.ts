import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bizokConfig, parseBizokList } from "./bizok";

const list = readFileSync(join(__dirname, "../__fixtures__/w3-incheon-list.html"), "utf-8");

describe("bizok 인천 비즈OK — 목록 파싱", () => {
  it("policyno 행을 뽑고 2자리 연도를 4자리로 바꾼다", () => {
    const rows = parseBizokList(list, bizokConfig);
    expect(rows.length).toBeGreaterThanOrEqual(10);
    const first = rows[0];
    expect(first.title).toContain("스마트공장 교육지원사업");
    expect(first.detailUrl).toBe(
      "https://bizok.incheon.go.kr/open_content/support.do?act=detail&policyno=7139",
    );
    // 라벨·「접수중」·탭 없이 정돈된 범위만 남아야 한다(첫 수집 실측 회귀 방지)
    expect(first.dateText).toBe("2026-08-07 ~ 2026-08-27");
    expect(first.category).toBe("기술");
    expect(first.agency).toBe("인천테크노파크");
  });

  it("주관기관이 비면 인천광역시를 쓴다", () => {
    const rows = parseBizokList(list, bizokConfig);
    const incheon = rows.find((r) => r.title.includes("인도(벵갈루루)"));
    expect(incheon?.agency).toBe("인천광역시");
  });
});

describe("bizok — config", () => {
  it("목록 URL 은 pgno 매개변수로 쪽을 넘긴다", () => {
    expect(bizokConfig.list.url(2)).toBe(
      "https://bizok.incheon.go.kr/open_content/support.do?act=list&pgno=2",
    );
  });
  it("상세 본문 선택자는 div.board_view", () => {
    expect(bizokConfig.detailContentSelector).toBe("div.board_view");
  });
});

import { readFileSync as rf2 } from "node:fs";
import { join as jn2 } from "node:path";
import { harvestBoardAttachments } from "../detail-fill";
import { parseHtml as ph2 } from "../html";

describe("bizok — 첨부 수확 범위(공고 밖 사이트 매뉴얼 오염 방지)", () => {
  const detail = rf2(jn2(__dirname, "../__fixtures__/w3-incheon-detail.html"), "utf-8");
  it("전체 수확엔 매뉴얼 PDF 가 섞이지만, board_view 범위 수확엔 없다", () => {
    const whole = harvestBoardAttachments(detail, "https://bizok.incheon.go.kr/");
    expect(whole.some((a) => /매뉴얼|manual/i.test(`${a.name}${a.url}`))).toBe(true);
    const scoped = ph2(detail)
      .querySelectorAll("div.board_view")
      .map((el) => el.outerHTML)
      .join("\n");
    const atts = harvestBoardAttachments(scoped, "https://bizok.incheon.go.kr/");
    expect(atts.some((a) => /매뉴얼|manual/i.test(`${a.name}${a.url}`))).toBe(false);
  });
});
