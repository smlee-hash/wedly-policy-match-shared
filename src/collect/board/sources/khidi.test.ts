import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { khidiConfig, parseKhidiList } from "./khidi";

const list = readFileSync(join(__dirname, "../__fixtures__/w4-khidi-list.html"), "utf-8");

describe("khidi 보건산업진흥원 — 목록 파싱", () => {
  it("linkId 만 남긴 최소 상세 주소를 만들고 제목의 마감(~8월 28일)을 종료일로 삼는다", () => {
    const rows = parseKhidiList(list);
    expect(rows.length).toBeGreaterThanOrEqual(8);
    const r = rows.find((x) => x.title.includes("외국인환자 유치사업자"));
    expect(r?.detailUrl).toBe("https://www.khidi.or.kr/board/view?linkId=48948725&menuId=MENU01108");
    expect(r?.dateText).toBe("2026-08-13 ~ 2026-08-28");
  });
  it("~8/24 꼴 마감도 등록 연도로 완성한다", () => {
    const rows = parseKhidiList(list);
    const r = rows.find((x) => x.title.includes("K-VIP"));
    expect(r?.dateText).toBe("2026-08-18 ~ 2026-08-24");
  });
  it("공지 고정으로 두 번 나오는 행은 linkId 로 한 번만 남긴다(적대 리뷰)", () => {
    const rows = parseKhidiList(list);
    const ids = rows.map((r) => r.detailUrl);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("khidi — 첨부 이름 정돈(적대 리뷰 — (208.24KB) 꼬리로 형식이 etc 가 되는 문제)", () => {
  const detail = readFileSync(join(__dirname, "../__fixtures__/w4-khidi-detail.html"), "utf-8");
  it("용량 꼬리를 지워 pdf/hwp 로 판정한다", async () => {
    const { harvestBoardAttachments } = await import("../detail-fill");
    const atts = harvestBoardAttachments(detail, "https://www.khidi.or.kr/");
    const pdf = atts.find((x) => x.name.includes("공고문"));
    expect(pdf?.kind).toBe("pdf");
    expect(pdf?.name).not.toMatch(/KB\)/);
  });
});

describe("khidi — config", () => {
  it("쪽넘김은 pageNum, 본문은 #detail_content", () => {
    expect(khidiConfig.list.url(2)).toBe("https://www.khidi.or.kr/board?menuId=MENU01108&pageNum=2");
    expect(khidiConfig.detailContentSelector).toBe("#detail_content");
  });
});
