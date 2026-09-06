import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseHtml } from "../html";
import { cwipConfig, parseCwipList } from "./cwip";

/**
 * ★손으로 쓴 HTML 대신 **실사이트 고정본**으로 잰다(적대 리뷰 지적).
 * 앞서 손으로 쓴 고정본으로 시험했더니 첨부 범위 선택자를 `div.file_list_wrap` 으로 잘못 적고도
 * 통과했다 — 실제 태그는 `<ul class="file_list_wrap">` 라 첨부를 하나도 못 잡고 있었다.
 * 고정본: 2026-09-01 배포본 목록 1쪽 + 상세(ab_id=278).
 */
const listHtml = readFileSync(join(__dirname, "../__fixtures__/cwip-list.html"), "utf-8");
const detailHtml = readFileSync(join(__dirname, "../__fixtures__/cwip-detail.html"), "utf-8");
const rows = parseCwipList(listHtml);

describe("창원산업진흥원 목록 읽기 — 실사이트 고정본", () => {
  it("행을 읽어 낸다", () => {
    expect(rows.length).toBeGreaterThan(0);
  });

  it("★사이트가 「신청중」인데 마감일이 없으면 날짜를 비운다 — 개시형으로 넘기면 90일 뒤 자동 마감된다", () => {
    // 실측: 개시형으로 넘겼더니 244건 중 241건이 저장 즉시 마감으로 들어갔고,
    // 이 수집원을 연결한 근거였던 「수출 표준화 지원사업」 등 5건이 전부 거기 들어 있었다.
    const 수출 = rows.find((r) => r.title.includes("수출 표준화 지원사업"));
    expect(수출).toBeDefined();
    expect(수출!.dateText).toBe("");
  });

  it("마감일이 있으면 시작·끝을 그대로 잇는다", () => {
    const both = rows.filter((r) => / ~ /.test(r.dateText));
    expect(both.length).toBeGreaterThan(0);
    for (const r of both) expect(r.dateText).toMatch(/^20\d{2}-\d{2}-\d{2} ~ 20\d{2}-\d{2}-\d{2}$/);
  });

  it("★「채용 지원사업」은 버리지 않는다 — 고용보조금은 제목에 「채용」을 쓴다", () => {
    expect(parseCwipList(listHtml.replace(/2026년 수출 표준화 지원사업 통합 공고/g,
      "2026년 방위산업 중소기업 신규직원 채용 지원사업 참여기업 모집공고"))
      .some((r) => r.title.includes("채용 지원사업"))).toBe(true);
  });

  it("인력 모집(외부전문가·평가위원)은 뺀다", () => {
    expect(rows.filter((r) => /외부전문가|평가위원/.test(r.title)).map((r) => r.title)).toEqual([]);
  });

  it("상세 주소를 ab_id 로 조립한다", () => {
    for (const r of rows) {
      expect(r.detailUrl).toMatch(
        /^https:\/\/www\.cwip\.or\.kr\/application\/application_view\.php\?ab_id=\d+$/,
      );
    }
  });

  it("지원유형을 분류로 싣는다", () => {
    expect(rows.some((r) => r.category !== "")).toBe(true);
  });

  it("같은 ab_id 는 한 번만 담는다", () => {
    const ids = rows.map((r) => r.detailUrl);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("카드가 없으면 빈 목록", () => {
    expect(parseCwipList("<div class='list_ul_type'></div>")).toEqual([]);
  });
});

describe("창원산업진흥원 설정", () => {
  it("쪽넘김은 GET page — 쪽마다 주소가 달라야 중복이 안 생긴다", () => {
    expect(cwipConfig.list.url(1)).toContain("page=1");
    expect(cwipConfig.list.url(1)).not.toBe(cwipConfig.list.url(2));
  });

  it("지역은 경남 — 지역 조건 없이 전국에 노출되면 안 된다", () => {
    expect(cwipConfig.region).toBe("경남");
  });

  /**
   * ★설정값이 자기 자신과 같은지만 재면 오타를 못 잡는다(적대 리뷰 지적 — 실제로 못 잡았다).
   * **상세 고정본에서 그 선택자가 실제로 무언가를 잡는지**를 잰다.
   */
  it("첨부 범위 선택자가 상세 고정본에서 실제로 잡힌다", () => {
    const root = parseHtml(detailHtml);
    const hit = root.querySelectorAll(cwipConfig.attachmentsScopeSelector!);
    expect(hit.length).toBeGreaterThan(0);
    // 그 안에 실제 내려받기 링크가 있어야 첨부 수확이 동작한다
    expect(hit.map((n) => n.innerHTML).join("")).toContain("file_download.php");
  });

  it("잘못 적었던 div.file_list_wrap 은 이 고정본에서 0개다 — 그래서 첨부가 안 들어왔다", () => {
    expect(parseHtml(detailHtml).querySelectorAll("div.file_list_wrap").length).toBe(0);
  });

  it("서식 변경 감지가 살아 있다", () => {
    expect(cwipConfig.expectMinRows).toBeGreaterThanOrEqual(2);
  });
});
