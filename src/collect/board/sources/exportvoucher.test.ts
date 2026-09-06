import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { exportvoucherConfig, parseExportvoucherList } from "./exportvoucher";
import { fetchBoardDetail } from "../engine";

const list = readFileSync(join(__dirname, "../__fixtures__/w3-ev-list.html"), "utf-8");
const detail = readFileSync(join(__dirname, "../__fixtures__/w3-ev-detail.html"), "utf-8");

describe("exportvoucher 수출바우처 — 목록 파싱", () => {
  it("모집·공고 제목만 남기고 goDetail 로 상세 GET 주소를 만든다", () => {
    const rows = parseExportvoucherList(list, exportvoucherConfig);
    expect(rows.length).toBeGreaterThanOrEqual(3);
    expect(rows.every((r) => /모집|공고/.test(r.title))).toBe(true);
    expect(rows.some((r) => r.title.includes("검수평가 결과보고서"))).toBe(false);
    const recruit = rows.find((r) => r.title.includes("3차 모집공고"));
    expect(recruit).toBeTruthy();
    expect(recruit!.detailUrl).toBe(
      "https://www.exportvoucher.com/portal/board/boardView?bbs_id=1&ntt_id=12551",
    );
  });

  it("등록일은 「YYYY-MM-DD ~」 개시형으로 넣는다(날짜 검증 통과·마감 오인 방지)", () => {
    const rows = parseExportvoucherList(list, exportvoucherConfig);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.dateText).toMatch(/^20\d{2}-\d{2}-\d{2} ~$/);
    }
  });

  it("수행기관·전문기관 모집(사업자용 아님)은 버린다", () => {
    const rows = parseExportvoucherList(list, exportvoucherConfig);
    expect(rows.some((r) => /수행기관|전문기관/.test(r.title))).toBe(false);
  });
});

describe("exportvoucher — config", () => {
  // ★2026-09-01 정정. 옛 시험은 「POST 전용이라 1쪽이 끝」을 지키고 있었는데, 그 전제가 틀렸다 —
  //   목록 폼이 method="get" 이고 변수 이름이 pageNo 다(goPage 가 그 값을 채워 폼을 보낸다).
  //   그 이름을 안 넣어 봤을 뿐이었고, 그 사이 1쪽에 안 걸린 공고 9건을 계속 놓치고 있었다.
  it("GET pageNo 로 쪽을 넘긴다 — 쪽마다 주소가 달라야 한다", () => {
    expect(exportvoucherConfig.list.maxPages).toBeGreaterThan(1);
    expect(exportvoucherConfig.list.url(1)).toBe(
      "https://www.exportvoucher.com/portal/board/boardList?bbs_id=1&pageNo=1",
    );
    expect(exportvoucherConfig.list.url(2)).toBe(
      "https://www.exportvoucher.com/portal/board/boardList?bbs_id=1&pageNo=2",
    );
    expect(exportvoucherConfig.list.url(1)).not.toBe(exportvoucherConfig.list.url(2));
  });

  // ★정정(적대 리뷰 ③). 이 값은 **1쪽 관문에만** 쓰이고 뒤 페이지 검증엔 안 넘어간다.
  //   `1` 은 validate.ts 에서 0·미지정과 동작이 같아 서식 변경 감지가 꺼진 것과 같다.
  //   그래서 「행이 하나라도 있으면 통과」가 아니라 실제로 막는 값인지를 잰다.
  it("1쪽 서식 변경 감지가 살아 있다 — 1은 검사를 끈 것과 같으므로 2 이상", () => {
    expect(exportvoucherConfig.expectMinRows).toBeGreaterThanOrEqual(2);
  });
  it("고정본 상세 본문 컨테이너는 div.bbsCon 이다", async () => {
    expect(exportvoucherConfig.detailContentSelector).toBe("div.bbsCon");
    const text = await fetchBoardDetail(
      exportvoucherConfig,
      "https://www.exportvoucher.com/portal/board/boardView?bbs_id=1&ntt_id=12866",
      { fetchText: async () => detail },
    );
    expect(text).toContain("선정 결과발표");
  });
});
