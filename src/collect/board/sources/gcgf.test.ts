import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { gcgfConfig, parseGcgfList } from "./gcgf";
import { validateRows } from "../validate";

const list = readFileSync(join(__dirname, "../__fixtures__/w4-gcgf-list.html"), "utf-8");

describe("gcgf 경기신보 — 잡탕 게시판 선별", () => {
  it("모집·공모·지원사업만 남기고 data-id 로 상세 주소를 만든다", () => {
    const rows = parseGcgfList(list);
    expect(rows.length).toBeGreaterThanOrEqual(2);
    const r = rows.find((x) => x.title.includes("모두의 창업"));
    expect(r?.detailUrl).toBe("https://www.gcgf.or.kr/gcgf/pt/pst/selectPstInfo.do?mi=1024&bbsId=1002&pstSn=51148");
    expect(r?.dateText).toBe("2026-08-27 ~");
  });
  it("지점 이전·행정예고·청렴도·비엔날레는 거른다", () => {
    const titles = parseGcgfList(list).map((r) => r.title).join("\n");
    expect(titles).not.toContain("이전 안내");
    expect(titles).not.toContain("행정예고");
    expect(titles).not.toContain("청렴도");
    expect(titles).not.toContain("비엔날레");
  });
});

describe("gcgf — config", () => {
  it("쪽넘김은 currPage", () => {
    expect(gcgfConfig.list.url(2)).toBe("https://www.gcgf.or.kr/gcgf/pt/pst/selectPstList.do?mi=1024&bbsId=1002&currPage=2");
    expect(gcgfConfig.detailContentSelector).toBe(".bbs_ViewA");
  });
});

/**
 * 2026-09-23 누락 실측 — 「모집·공모·지원사업·신청·공고」가 있어야만 남기던 거르개 때문에
 * 1쪽의 「푸드트레일러 임대지원 안내」·「찾아가는 현장보증 상담회」까지 빠져 0행이 됐고,
 * 0행이면 회차 검증이 실패해 게시판 전체를 버렸다. 이제 지원사업이 아닌 글만 뺀다.
 */
describe("gcgf — 2026-09-23 원문(1쪽)", () => {
  const live = readFileSync(join(__dirname, "../__fixtures__/gcgf-list-20260923.html"), "utf-8");
  it("사업자 지원 안내는 「모집」 낱말이 없어도 담는다", () => {
    const titles = parseGcgfList(live).map((r) => r.title);
    expect(titles).toContain("2026년 경기도 푸드트레일러 임대지원 안내");
    expect(titles).toContain("2026년 9월 찾아가는 현장보증 상담회 일정");
  });
  it("검증은 거르개 전 10줄로 한다 — 1쪽이 전부 비지원 글이어도 게시판을 버리지 않는다", () => {
    const raw = gcgfConfig.validationParse?.(live, 1) ?? [];
    expect(raw.length).toBe(10);
    expect(validateRows(raw, { expectMinRows: gcgfConfig.expectMinRows, prevCount: 0 }).ok).toBe(true);
  });
  it("제목에 형식 표시(카드뉴스)가 붙은 모집 공고도 담는다 — 리뷰 review-0f08ca4d", () => {
    const html = live.replace("2026년 경기도 푸드트레일러 임대지원 안내", "(카드뉴스) 2026년 경기도 푸드트레일러 임대지원 안내");
    expect(parseGcgfList(html).map((r) => r.title)).toContain("(카드뉴스) 2026년 경기도 푸드트레일러 임대지원 안내");
  });
  it("지원사업이 아닌 글(행정예고·설문·청탁금지·고객만족도)은 뺀다", () => {
    const titles = parseGcgfList(live).map((r) => r.title).join("\n");
    expect(titles).not.toContain("행정예고");
    expect(titles).not.toContain("설문조사");
    expect(titles).not.toContain("청탁금지법");
    expect(titles).not.toContain("고객만족도");
  });
});
