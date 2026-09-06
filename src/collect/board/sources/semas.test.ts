import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ddayToYmd, parseSemasList, semasConfig } from "./semas";

const list = readFileSync(join(__dirname, "../__fixtures__/w3-semas-list.html"), "utf-8");
/** 2026-08-27 00:00 KST */
const NOW = new Date("2026-08-26T15:00:00.000Z");

describe("semas D-day 환산", () => {
  it("D - N 은 수집 시점(KST) + N 일의 YYYY-MM-DD 다", () => {
    expect(ddayToYmd("D - 34", NOW)).toBe("2026-09-30");
    expect(ddayToYmd("D - 0", NOW)).toBe("2026-08-27");
  });
  it("D - DAY 는 오늘(KST)이다", () => {
    expect(ddayToYmd("D - DAY", NOW)).toBe("2026-08-27");
    expect(ddayToYmd("D-DAY", NOW)).toBe("2026-08-27");
  });
  it("못 읽으면 빈 값이다", () => {
    expect(ddayToYmd("마감", NOW)).toBe("");
    expect(ddayToYmd("", NOW)).toBe("");
  });
});

describe("semas 소상공인시장진흥공단 — 목록 파싱", () => {
  it("sbiz24 pbanc 행을 뽑고 .date 의 정확한 기간을 우선 쓴다", () => {
    const rows = parseSemasList(list, semasConfig, NOW);
    expect(rows.length).toBeGreaterThanOrEqual(5);
    const first = rows[0];
    expect(first.title).toContain("스마트상점 기술보급사업");
    expect(first.detailUrl).toBe("https://www.sbiz24.kr/#/pbanc/821");
    expect(first.dateText).toBe("2026-08-26 ~ 2026-09-30");
    // 상세가 스크립트 화면이라 목록 요약이 유일한 자격조건 원문 — 지원대상이 실려 있어야 한다
    expect(first.targetText ?? "").toContain("지원대상");
  });

  it("모든 행의 dateText 에 날짜가 있다(.date 우선, 없으면 D-day 환산)", () => {
    for (const r of parseSemasList(list, semasConfig, NOW)) {
      expect(r.dateText).toMatch(/20\d{2}-\d{2}-\d{2}/);
    }
  });
});

describe("semas — config", () => {
  it("목록 URL 은 page 매개변수로 쪽을 넘긴다", () => {
    expect(semasConfig.list.url(2)).toBe(
      "https://www.semas.or.kr/web/board/webBoardList.kmdc?bCd=2001&pNm=BOA0101&page=2",
    );
  });
  it("sbiz24 호스트를 허용하고 SPA 본문 선택자는 일부러 안 잡힌다", () => {
    expect(semasConfig.allowedHosts).toEqual(["www.sbiz24.kr"]);
    expect(semasConfig.detailContentSelector).toBe("#no-ssr-spa");
  });
});
