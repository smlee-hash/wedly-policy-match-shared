import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseSeoultpList, seoultpConfig } from "./seoultp";

const list = readFileSync(join(__dirname, "../__fixtures__/w4-seoultp-list.html"), "utf-8");

describe("seoultp 서울TP — 목록 파싱", () => {
  it("goBoardView 에서 boardNo 를 뽑고 등록일을 개시형으로 싣는다", () => {
    const rows = parseSeoultpList(list);
    expect(rows.length).toBeGreaterThanOrEqual(10);
    const r = rows.find((x) => x.title.includes("베트남 ODA"));
    expect(r?.detailUrl).toBe("https://www.seoultp.or.kr/user/nd19746.do?View&boardNo=00004062");
    expect(r?.dateText).toBe("2026-08-14 ~");
  });
  it("공지 행(입주기업 모집)도 수집한다", () => {
    const rows = parseSeoultpList(list);
    expect(rows.some((x) => x.title.includes("입주기업 모집"))).toBe(true);
  });
  it("제목의 마감 표기(~26.7.7)를 종료일로 삼는다(적대 리뷰 — 마감 공고가 모집중으로 남는 문제)", () => {
    const rows = parseSeoultpList(list);
    const r = rows.find((x) => x.title.includes("사업재편"));
    expect(r?.dateText).toBe("2026-06-26 ~ 2026-07-07");
  });
});

describe("seoultp — 첨부 수확(onclick attachfileDownload, 실검증 attachNo 200 OK)", () => {
  const detail = readFileSync(join(__dirname, "../__fixtures__/w4-seoultp-detail.html"), "utf-8");
  it("onclick 에서 경로+attachNo 를 조립하고 형식은 hwp 로 판정한다", async () => {
    const { harvestBoardAttachments } = await import("../detail-fill");
    const atts = harvestBoardAttachments(detail, "https://www.seoultp.or.kr/");
    const a = atts.find((x) => x.url.includes("attachNo=00007302"));
    expect(a?.url).toBe("https://www.seoultp.or.kr/common/attachfile/attachfileDownload.do?attachNo=00007302");
    expect(a?.name).toContain("베트남 ODA");
    expect(a?.kind).toBe("hwp");
  });
});

describe("seoultp — config", () => {
  it("쪽넘김은 page, 상세 본문은 board-write 표", () => {
    expect(seoultpConfig.list.url(2)).toBe("https://www.seoultp.or.kr/user/nd19746.do?page=2");
    expect(seoultpConfig.detailContentSelector).toBe("table.board-write");
  });
});
