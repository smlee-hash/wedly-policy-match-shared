import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { pagingParamsOf } from "../engine";
import { parseHtml } from "../html";
import { isSjtpDropTitle, parseSjtpList, sjtpConfig } from "./sjtp";

/**
 * ★손으로 쓴 HTML 대신 **실사이트 고정본**으로 잰다.
 * 창원 사고: 지어낸 HTML 로 시험하면 선택자 오타가 그대로 통과한다.
 * 고정본: 2026-09-03 실측 `bo_table=business01` 사업공고 1·2쪽.
 */
const listHtml = readFileSync(join(__dirname, "../__fixtures__/sjtp-list.html"), "utf-8");
const listP2Html = readFileSync(join(__dirname, "../__fixtures__/sjtp-list-p2.html"), "utf-8");
const NOW = Date.parse("2026-09-03T00:00:00Z");
const rows = parseSjtpList(listHtml, 1, NOW);
const rowsP2 = parseSjtpList(listP2Html, 2, NOW);
const combined = parseSjtpList(listHtml + listP2Html, 1, NOW);

const FIRST = {
  title: "[2026-003호] 2026년도 세종테크노파크 본관동 입주기업 상시모집 공고",
  detailUrl: "https://sjtp.or.kr/bbs/board.php?bo_table=business01&wr_id=1928",
  dateText: "2026-02-02 ~ 2026-12-31",
  agency: "세종테크노파크",
} as const;

describe("세종테크노파크 사업공고 목록 읽기 — 실사이트 고정본", () => {
  it("1쪽 고정본에서 DROP·중복을 뺀 13건을 읽고 첫 행의 제목·상세주소·dateText 가 맞다", () => {
    expect(rows.length).toBeGreaterThanOrEqual(7);
    expect(rows.length).toBeLessThanOrEqual(15);
    expect(rows).toHaveLength(13);
    expect(rows[0]).toMatchObject(FIRST);
  });

  it("신청기간이 YYYY-MM-DD ~ YYYY-MM-DD 모양이다", () => {
    expect(rows.every((r) => r.dateText !== "")).toBe(true);
    for (const r of rows) expect(r.dateText).toMatch(/^20\d{2}-\d{2}-\d{2} ~ 20\d{2}-\d{2}-\d{2}$/);
    expect(rows[0].dateText).toBe("2026-02-02 ~ 2026-12-31");
  });

  it("★상세 주소에 쪽 번호를 넣지 않는다 — 넣으면 같은 글이 쪽마다 다른 줄이 된다", () => {
    expect(rows.every((r) => !/[?&]page=/.test(r.detailUrl))).toBe(true);
    expect(rowsP2.every((r) => !/[?&]page=/.test(r.detailUrl))).toBe(true);
    expect(combined.every((r) => !/[?&]page=/.test(r.detailUrl))).toBe(true);
    expect(rowsP2.every((r) => r.detailUrl.includes("wr_id="))).toBe(true);
  });

  it("날짜는 신청기간 칸에서만 집는다 — 행 전체 글자면 번호·D-day 와 붙는다", () => {
    const r = rows.find((x) => x.detailUrl.includes("wr_id=1993"));
    expect(r?.dateText).toBe("2026-08-27 ~ 2026-09-10");
    expect(r?.dateText).not.toMatch(/642|119|D-|636/);
    expect(rows[0].dateText).not.toMatch(/642|119/);
  });

  it("1쪽+2쪽을 합쳐 파싱해도 상세 열쇠 중복이 없고 28건이다", () => {
    expect(rowsP2).toHaveLength(15);
    expect(rowsP2[0]).toMatchObject({
      title: "[2026-057호] 2026년 세종테크노파크 본관동 입주기업 비즈니스 고도화 프로그램 모집 참여기업 공고",
      detailUrl: "https://sjtp.or.kr/bbs/board.php?bo_table=business01&wr_id=1983",
      dateText: "2026-07-06 ~ 2026-07-20",
    });
    const urls = combined.map((r) => r.detailUrl);
    expect(new Set(urls).size).toBe(urls.length);
    expect(combined).toHaveLength(28);
    const concat = [...rows, ...rowsP2];
    expect(new Set(concat.map((r) => r.detailUrl)).size).toBe(concat.length);
    expect(rows.map((r) => r.detailUrl)).not.toEqual(rowsP2.map((r) => r.detailUrl));
  });

  it("같은 글번호는 한 번만 담는다", () => {
    const urls = rows.map((r) => r.detailUrl);
    expect(new Set(urls).size).toBe(urls.length);
  });
});

describe("거르개 — 버릴 것만 지정한다", () => {
  it("실측 DROP 제목(전문가 모집·시민체험단)이 빠진다", () => {
    const titles = combined.map((r) => r.title);
    expect(titles.some((t) => t.includes("전문가 모집"))).toBe(false);
    expect(titles.some((t) => t.includes("시민체험단"))).toBe(false);
    expect(isSjtpDropTitle("2026년 세종RISE센터 분야별 전문가 모집 공고")).toBe(true);
    expect(
      isSjtpDropTitle("[2026-058호] 2026년 AI기반 디지털헬스케어 서비스 실증사업지역시민체험단 모집 공고"),
    ).toBe(true);
  });

  it("DROP 낱말 행이 빠진다 — 입찰·설문·채용 공고·평가위원·합격자", () => {
    const cases = [
      "2026년 전산장비 입찰 공고",
      "고객만족도 설문 안내",
      "직원 채용 공고",
      "2026년 평가위원 모집",
      "지원사업 합격자 발표",
    ];
    for (const planted of cases) {
      const html = listHtml.replace(
        "[2026-003호] 2026년도 세종테크노파크 본관동 입주기업 상시모집 공고",
        planted,
      );
      const out = parseSjtpList(html, 1, NOW);
      expect(out.some((r) => r.title.includes(planted) || r.title === planted), planted).toBe(false);
      expect(out).toHaveLength(12);
      expect(isSjtpDropTitle(planted), planted).toBe(true);
    }
  });

  it("「채용」을 통째로 버리지 않는다 — 채용 지원사업이 죽으면 안 된다", () => {
    expect(isSjtpDropTitle("청년 채용 지원금 참여기업 모집 공고")).toBe(false);
    expect(
      parseSjtpList(
        listHtml.replace(
          "[2026-003호] 2026년도 세종테크노파크 본관동 입주기업 상시모집 공고",
          "2026년 중소기업 신규직원 채용 지원사업 참여기업 모집",
        ),
        1,
        NOW,
      ).some((r) => r.title.includes("채용 지원사업")),
    ).toBe(true);
  });

  it("지원사업·기업 모집은 살린다", () => {
    expect(rows.some((r) => r.title.includes("기술닥터제"))).toBe(true);
    expect(rows.some((r) => r.title.includes("지역특화콘텐츠개발지원"))).toBe(true);
    expect(isSjtpDropTitle("[2026-020호] 2026년 기술닥터제 지원사업 참여기업 모집공고")).toBe(false);
    expect(isSjtpDropTitle("2026년 세종 지역특화콘텐츠개발지원 사업 공고 (웹툰콘텐츠분야)")).toBe(false);
  });
});

describe("붙박이 공지 — 1년 넘은 것은 담지 않는다", () => {
  it("기준 시각을 2030년으로 옮기면 2026-02-02 붙박이가 빠진다", () => {
    const pinned = listHtml.replace(/<td class="td_num2">\s*642\s*<\/td>/, '<td class="td_num2">공지</td>');
    const old = parseSjtpList(pinned, 1, Date.parse("2030-01-01T00:00:00Z"));
    expect(old.some((r) => r.detailUrl.includes("wr_id=1928"))).toBe(false);
    expect(old).toHaveLength(12);
  });
});

describe("세종테크노파크 설정", () => {
  it("쪽넘김은 GET page + bo_table=business01", () => {
    expect(sjtpConfig.list.url(1)).toBe("https://sjtp.or.kr/bbs/board.php?bo_table=business01&page=1");
    expect(sjtpConfig.list.url(2)).toBe("https://sjtp.or.kr/bbs/board.php?bo_table=business01&page=2");
    expect(sjtpConfig.list.maxPages).toBe(10);
  });

  it("★상세 주소의 page 는 엔진이 알아서 떼어 낸다 — 안 떼면 같은 글이 쪽마다 다른 주소가 된다", () => {
    expect(pagingParamsOf(sjtpConfig)).toContain("page");
  });

  it("지역은 세종", () => {
    expect(sjtpConfig.region).toBe("세종");
    expect(sjtpConfig.id).toBe("sjtp");
    expect(sjtpConfig.agency).toBe("세종테크노파크");
    expect(sjtpConfig.label).toBe("세종테크노파크");
  });

  it("서식 변경 감지가 살아 있다 — 1은 검사를 끈 것과 같다", () => {
    expect(sjtpConfig.expectMinRows).toBeGreaterThanOrEqual(2);
    expect(sjtpConfig.expectMinRows).toBe(7);
  });

  it("행 선택자가 1쪽 고정본에서 실제 15줄을 잡는다", () => {
    expect(parseHtml(listHtml).querySelectorAll(sjtpConfig.list.rowSelector)).toHaveLength(15);
  });

  it("상세 본문·첨부 자리가 실측 선택자다", () => {
    expect(sjtpConfig.detailContentSelector).toBe("#bo_v_con");
    expect(sjtpConfig.attachmentsScopeSelector).toBe("#bo_v_file");
  });
});

/** ★판정기를 망가뜨려 본다 — 안 하면 위 시험들이 「그냥 통과하는 글」일 뿐이다. */
describe("망가뜨려 보기", () => {
  it("행 껍데기 이름이 바뀌면 한 줄도 못 읽는다", () => {
    expect(parseSjtpList(listHtml.replaceAll('id="bo_list"', 'id="bo_list-x"'), 1, NOW)).toHaveLength(0);
  });

  it("제목 칸(bo_title)이 바뀌면 한 줄도 못 읽는다", () => {
    expect(parseSjtpList(listHtml.replaceAll("bo_title", "bo_title-x"), 1, NOW)).toHaveLength(0);
  });

  it("신청기간 칸을 비우면 날짜를 비운다(오늘 날짜를 지어내지 않는다)", () => {
    const broken = parseSjtpList(listHtml.replaceAll("신청기간", "게시기간"), 1, NOW);
    expect(broken.length).toBeGreaterThan(0);
    expect(broken.every((r) => r.dateText === "")).toBe(true);
  });
});
