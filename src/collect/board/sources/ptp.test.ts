import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { pagingParamsOf } from "../engine";
import { parseHtml } from "../html";
import { isPtpDropTitle, parsePtpList, ptpConfig } from "./ptp";

/**
 * ★손으로 쓴 HTML 대신 **실사이트 고정본**으로 잰다(적대 리뷰 지적).
 * 창원 사고: 지어낸 HTML 로 시험하면 선택자 오타가 그대로 통과한다.
 * 고정본: 2026-09-03 실측 `index.do?menu_idx=116&manage_idx=15` 1쪽 + `viewPage=2`.
 */
const listHtml = readFileSync(join(__dirname, "../__fixtures__/ptp-list.html"), "utf-8");
const listP2Html = readFileSync(join(__dirname, "../__fixtures__/ptp-list-p2.html"), "utf-8");
const NOW = Date.parse("2026-09-03T00:00:00Z");
const rows = parsePtpList(listHtml, 1, NOW);
const rowsP2 = parsePtpList(listP2Html, 2, NOW);
const combined = parsePtpList(listHtml + listP2Html, 1, NOW);

describe("포항테크노파크 목록 읽기 — 실사이트 고정본", () => {
  it("1쪽 고정본에서 DROP·중복을 뺀 15건을 읽고 첫 행의 제목·상세주소·날짜가 맞다", () => {
    // 붙박이 17 + 일반 10 − DROP 4(강사·평가위원 2·외부전문가) − 같은 글번호 8건.
    expect(rows).toHaveLength(15);
    expect(rows.length).toBeGreaterThanOrEqual(ptpConfig.expectMinRows ?? 0);
    expect(rows.length).toBeLessThanOrEqual(27);
    expect(rows[0]).toMatchObject({
      title:
        "「2026년 산업혁신기반구축 사업」 제조 특화 온디바이스 AI 기반 자율제조 실증 기반 구축 기업지원 참여기업 모집",
      detailUrl: "https://ptp.or.kr/main/board/view.do?menu_idx=116&manage_idx=15&board_idx=8107",
      dateText: "2026-09-03 ~ 2026-09-18",
      agency: "포항테크노파크",
    });
  });

  it("접수기간은 5번째 td 에서만 집는다 — 작성일(td.date)로 떨어지면 안 된다", () => {
    expect(rows[0].dateText).not.toBe("2026-09-02 ~");
    expect(rows[0].dateText).not.toBe("2026-09-02");
    expect(rows[1]).toMatchObject({
      title: "「지역 SW아웃소싱 개발기업 지원사업」 참여기업 모집 재공고",
      detailUrl: "https://ptp.or.kr/main/board/view.do?menu_idx=116&manage_idx=15&board_idx=8105",
      dateText: "2026-09-01 ~ 2026-10-02",
    });
  });

  it("시작만 있는 접수기간은 개시형, 끝만 있는 접수기간은 마감 단독이다", () => {
    const endOnly = rows.find((r) => r.detailUrl.endsWith("board_idx=7910"));
    expect(endOnly?.dateText).toBe("2026-12-18");
    const endOnlyPinned = rows.find((r) => r.detailUrl.endsWith("board_idx=7530"));
    expect(endOnlyPinned?.dateText).toBe("2026-12-31");
  });

  it("상세 주소는 viewBoard 번호로 조립하고 쪽 번호가 안 섞인다", () => {
    for (const r of [...rows, ...rowsP2]) {
      expect(r.detailUrl).toMatch(
        /^https:\/\/ptp\.or\.kr\/main\/board\/view\.do\?menu_idx=116&manage_idx=15&board_idx=\d+$/,
      );
      expect(r.detailUrl).not.toMatch(/viewPage|javascript:/i);
    }
  });

  it("같은 글번호는 한 쪽 안에서도 한 번만 담는다 — 붙박이와 일반이 같은 id 를 두 줄로 싣는다", () => {
    const ids = rows.map((r) => r.detailUrl);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("1·2쪽을 합쳐도 중복이 없다 — 붙박이가 모든 쪽에 반복된다", () => {
    const urls = combined.map((r) => r.detailUrl);
    expect(new Set(urls).size).toBe(urls.length);
    expect(combined).toHaveLength(15);
    expect(rowsP2).toHaveLength(15);
    expect(rowsP2[0].detailUrl).toBe(rows[0].detailUrl);
  });

  it("2쪽 일반 칸의 평가위원 글은 빠지고, 쪽넘김이 먹은 증거로 원문에는 남아 있다", () => {
    expect(listP2Html).toContain("viewBoard(8093)");
    expect(listP2Html).toContain("viewBoard(8077)");
    expect(rowsP2.some((r) => r.detailUrl.includes("board_idx=8093"))).toBe(false);
    expect(rowsP2.some((r) => r.detailUrl.includes("board_idx=8077"))).toBe(false);
  });
});

describe("거르개 — 버릴 것만 지정한다", () => {
  it("고정본의 평가위원·외부전문가·강사 모집은 빠진다", () => {
    const titles = [...rows, ...rowsP2].map((r) => r.title);
    expect(titles.some((t) => t.includes("평가위원"))).toBe(false);
    expect(titles.some((t) => t.includes("외부전문가"))).toBe(false);
    expect(titles.some((t) => t.includes("강사 모집"))).toBe(false);
    expect(rows.some((r) => r.detailUrl.includes("board_idx=8091"))).toBe(false);
    expect(rows.some((r) => r.detailUrl.includes("board_idx=7924"))).toBe(false);
    expect(rows.some((r) => r.detailUrl.includes("board_idx=7643"))).toBe(false);
    expect(rows.some((r) => r.detailUrl.includes("board_idx=7635"))).toBe(false);
  });

  it("★「전문가 자문 프로그램」은 살아남는다 — 「전문가」를 통째로 버리면 죽는다", () => {
    expect(rows.some((r) => r.title.includes("전문가 자문 프로그램"))).toBe(true);
    expect(isPtpDropTitle("2026년 창업보육센터 졸업기업 육성 지원사업(전문가 자문 프로그램) 참여기업 모집 공고")).toBe(
      false,
    );
  });

  it("DROP 낱말 행이 빠진다 — 입찰·설문·채용 공고·평가위원·합격자만 좁게", () => {
    const plant = (title: string) =>
      parsePtpList(
        listHtml.replaceAll(
          "「2026년 산업혁신기반구축 사업」 제조 특화 온디바이스 AI 기반 자율제조 실증 기반 구축 기업지원 참여기업 모집",
          title,
        ),
        1,
        NOW,
      );
    expect(plant("2026년 사무용품 입찰 공고").some((r) => r.title.includes("입찰"))).toBe(false);
    expect(plant("만족도 설문 조사").some((r) => r.title.includes("설문"))).toBe(false);
    expect(plant("직원 채용 공고").some((r) => r.title.includes("채용 공고"))).toBe(false);
    expect(plant("2026년 평가위원 모집").some((r) => r.title.includes("평가위원"))).toBe(false);
    expect(plant("합격자 발표").some((r) => r.title.includes("합격자"))).toBe(false);
  });

  it("★「채용 지원사업」은 버리지 않는다 — 고용보조금은 제목에 「채용」을 쓴다", () => {
    expect(
      parsePtpList(
        listHtml.replaceAll(
          "「2026년 산업혁신기반구축 사업」 제조 특화 온디바이스 AI 기반 자율제조 실증 기반 구축 기업지원 참여기업 모집",
          "2026년 방위산업 중소기업 신규직원 채용 지원사업 참여기업 모집공고",
        ),
        1,
        NOW,
      ).some((r) => r.title.includes("채용 지원사업")),
    ).toBe(true);
    expect(isPtpDropTitle("청년 채용 지원금 참여기업 모집")).toBe(false);
    expect(isPtpDropTitle("기업지원과 직원 채용 공고")).toBe(true);
  });

  it("★1년 넘게 붙어 있는 붙박이는 아예 안 담는다 — 날짜를 비우면 90일간 되살아난다", () => {
    const oldPinned = listHtml.replace("2026.09.02", "2023.01.01");
    const parsed = parsePtpList(oldPinned, 1, NOW);
    expect(parsed.some((r) => r.detailUrl.includes("board_idx=8107"))).toBe(false);
    expect(parsed).toHaveLength(14);
    expect(
      parsePtpList(oldPinned, 1, Date.parse("2023-06-01T00:00:00Z")).some((r) =>
        r.detailUrl.includes("board_idx=8107"),
      ),
    ).toBe(true);
  });
});

describe("포항테크노파크 설정", () => {
  it("쪽넘김은 GET viewPage — 쪽마다 주소가 달라야 중복이 안 생긴다", () => {
    expect(ptpConfig.list.url(1)).toContain("viewPage=1");
    expect(ptpConfig.list.url(2)).toContain("viewPage=2");
    expect(ptpConfig.list.url(1)).not.toBe(ptpConfig.list.url(2));
    expect(ptpConfig.list.url(1)).toContain("menu_idx=116");
    expect(ptpConfig.list.url(1)).toContain("manage_idx=15");
    expect(pagingParamsOf(ptpConfig)).toContain("viewPage");
    expect(ptpConfig.list.maxPages).toBe(10);
  });

  it("지역은 경북 — 지역 조건 없이 전국에 노출되면 안 된다", () => {
    expect(ptpConfig.region).toBe("경북");
    expect(ptpConfig.id).toBe("ptp");
    expect(ptpConfig.agency).toBe("포항테크노파크");
  });

  it("서식 변경 감지가 살아 있다 — 한 쪽 10건의 절반", () => {
    expect(ptpConfig.expectMinRows).toBe(5);
  });

  it("상세 본문·첨부 선택자가 비어 있지 않다 — 실측 div.view-cont-biz · div.board-view-attach", () => {
    expect(ptpConfig.detailContentSelector).toBe("div.view-cont-biz");
    expect(ptpConfig.attachmentsScopeSelector).toBe("div.board-view-attach");
  });
});

/** ★판정기를 망가뜨려 본다 — 안 하면 위 시험들이 「그냥 통과하는 글」일 뿐이다. */
describe("망가뜨려 보기", () => {
  it("행 선택자가 틀리면 0행이다", () => {
    expect(parsePtpList(listHtml.replaceAll("board-list", "board-list-x"), 1, NOW)).toHaveLength(0);
  });

  it("제목 칸(td.subject)이 바뀌면 한 줄도 못 읽는다", () => {
    expect(parsePtpList(listHtml.replaceAll('class="subject"', 'class="subject-x"'), 1, NOW)).toHaveLength(0);
  });

  it("행 선택자를 틀리게 준 설정으로 고정본에서 0행이다", () => {
    expect(parseHtml(listHtml).querySelectorAll("div.board-list-x > table.table.text-sm > tbody > tr[title]")).toHaveLength(
      0,
    );
    expect(parseHtml(listHtml).querySelectorAll(ptpConfig.list.rowSelector).length).toBe(27);
  });

  it("접수기간 칸을 비우면 날짜를 지어내지 않는다 — 작성일로 떨어지지 않는다", () => {
    const blank = listHtml.replace("2026-09-03 09시 ~ 2026-09-18 18시", "");
    const first = parsePtpList(blank, 1, NOW)[0];
    expect(first.title).toContain("산업혁신기반구축");
    expect(first.dateText).toBe("");
  });
});
