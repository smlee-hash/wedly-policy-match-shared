import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseHtml } from "../html";
import { bizbcConfig, parseBizbcList } from "./bizbc";

/**
 * ★손으로 쓴 HTML 대신 **실사이트 고정본**으로 잰다(적대 리뷰 지적).
 * 앞서 손으로 쓴 고정본으로 시험했더니 실제 마크업과 어긋난 선택자가 그대로 통과했다 —
 * 창원은 첨부 범위를 `div.file_list_wrap` 으로 적고도 통과했는데 실제는 `<ul>` 이라
 * 첨부를 하나도 못 잡고 있었다. 고정본: 2026-09-01 배포본 목록 1쪽 + 상세(bizPbancSn=11380).
 */
const listHtml = readFileSync(join(__dirname, "../__fixtures__/bizbc-list.html"), "utf-8");
const detailHtml = readFileSync(join(__dirname, "../__fixtures__/bizbc-detail.html"), "utf-8");
const rows = parseBizbcList(listHtml);

describe("부천산업진흥원 목록 읽기 — 실사이트 고정본", () => {
  it("행을 읽어 낸다", () => {
    expect(rows.length).toBeGreaterThan(0);
  });

  it("★모집기간이 YYYY-MM-DD ~ YYYY-MM-DD 모양이다", () => {
    const both = rows.filter((r) => / ~ /.test(r.dateText));
    expect(both.length).toBeGreaterThan(0);
    for (const r of both) expect(r.dateText).toMatch(/^20\d{2}-\d{2}-\d{2} ~ 20\d{2}-\d{2}-\d{2}$/);
  });

  it("상세 주소를 bizPbancSn 으로 조립한다", () => {
    for (const r of rows) {
      expect(r.detailUrl).toMatch(
        /^https:\/\/www\.bizbc\.or\.kr\/kor\/contents\/BC0101010000\.do\?schM=view&bizPbancSn=\d+$/,
      );
    }
  });

  it("★기관이 한 종류가 아니다 — 이 게시판은 부천시 공고도 싣는다", () => {
    // 못 박으면 중복 판정 열쇠(제목+기관)가 달라져 기업마당의 같은 공고와 안 묶인다.
    expect(new Set(rows.map((r) => r.agency)).size).toBeGreaterThan(1);
    expect(rows.some((r) => r.agency === "부천산업진흥원")).toBe(true);
    expect(rows.some((r) => r.agency === "부천시")).toBe(true);
  });

  it("★「채용 지원사업」은 버리지 않는다 — 고용보조금은 제목에 「채용」을 쓴다", () => {
    expect(
      parseBizbcList(
        listHtml.replace(
          /2026년 유해물질 시험분석 수수료 지원 사업\(9월\)/g,
          "2026년 방위산업 중소기업 신규직원 채용 지원사업 참여기업 모집공고",
        ),
      ).some((r) => r.title.includes("채용 지원사업")),
    ).toBe(true);
  });

  it("고정본의 「채용행사 참여기업 모집」도 살아남는다 — 「채용」을 통째로 버리면 죽는다", () => {
    expect(rows.some((r) => r.title.includes("채용행사"))).toBe(true);
  });

  it("★인력·용역 공고는 뺀다 — 기업이 신청할 지원사업이 아니다", () => {
    expect(
      parseBizbcList(
        listHtml.replace(
          /2026년 유해물질 시험분석 수수료 지원 사업\(9월\)/g,
          "2026년 평가위원 모집",
        ),
      ).some((r) => r.title.includes("평가위원")),
    ).toBe(false);
  });

  it("날짜가 없으면 빈 값 — 없는 마감일을 지어내지 않는다", () => {
    const none = parseBizbcList(`<ul class="board_list">
<li class="tr"><div class="board_tit"><a href="#none" onclick="fn_goView('2')">지원사업 안내</a>
<div class="date_txt"><p>부천산업진흥원</p><p>모집기간 : <span></span></p></div></div></li>
</ul>`);
    expect(none[0].dateText).toBe("");
  });

  it("기관 칸이 비면 부천산업진흥원으로 떨어진다", () => {
    const empty = parseBizbcList(`<ul class="board_list">
<li class="tr"><div class="board_tit"><a href="#none" onclick="fn_goView('3')">지원사업 안내</a>
<div class="date_txt"><p></p><p>모집기간 : <span>2026-09-01 ~ 2026-09-30</span></p></div></div></li>
</ul>`);
    expect(empty[0].agency).toBe("부천산업진흥원");
  });

  it("같은 공고 번호는 한 번만 담는다", () => {
    const ids = rows.map((r) => r.detailUrl);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("글번호가 없는 행(머리글 등)은 건너뛴다", () => {
    expect(parseBizbcList('<ul class="board_list"><li class="tr"><div>제목</div></li></ul>')).toEqual([]);
  });
});

describe("부천산업진흥원 설정", () => {
  it("쪽넘김은 GET page — 쪽마다 주소가 달라야 중복이 안 생긴다", () => {
    expect(bizbcConfig.list.url(1)).toContain("page=1");
    expect(bizbcConfig.list.url(2)).toContain("page=2");
    expect(bizbcConfig.list.url(1)).not.toBe(bizbcConfig.list.url(2));
  });

  it("지역은 경기 — 지역 조건 없이 전국에 노출되면 안 된다", () => {
    expect(bizbcConfig.region).toBe("경기");
  });

  /**
   * ★설정값이 자기 자신과 같은지만 재면 오타를 못 잡는다(적대 리뷰 지적 — 실제로 못 잡았다).
   * **상세 고정본에서 그 선택자가 실제로 무언가를 잡는지**를 잰다.
   */
  it("첨부 범위 선택자가 상세 고정본에서 실제로 잡힌다", () => {
    const root = parseHtml(detailHtml);
    const hit = root.querySelectorAll(bizbcConfig.attachmentsScopeSelector!);
    expect(hit.length).toBeGreaterThan(0);
    expect(hit.map((n) => n.innerHTML).join("")).toContain("fileDownload");
  });

  it("상세 본문 선택자가 상세 고정본에서 실제로 잡힌다", () => {
    const root = parseHtml(detailHtml);
    const hit = root.querySelectorAll(bizbcConfig.detailContentSelector!);
    expect(hit.length).toBeGreaterThan(0);
    expect(hit.map((n) => n.text).join("")).toContain("지원대상");
  });

  it("서식 변경 감지가 살아 있다 — 1은 검사를 끈 것과 같다", () => {
    expect(bizbcConfig.expectMinRows).toBeGreaterThanOrEqual(2);
  });
});
