import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseHtml } from "../html";
import { isJcgfDropTitle, jcgfConfig, parseJcgfList } from "./jcgf";

/**
 * ★손으로 쓴 HTML 대신 **실사이트 고정본**으로 잰다.
 * 창원 사고: 지어낸 HTML 로 시험하면 선택자 오타가 그대로 통과한다.
 * 고정본: 2026-09-03 실측 `bo_table=2_3_1_1` 창업(모집공고) 1·2쪽.
 */
const listHtml = readFileSync(join(__dirname, "../__fixtures__/jcgf-list.html"), "utf-8");
const listP2Html = readFileSync(join(__dirname, "../__fixtures__/jcgf-list-p2.html"), "utf-8");
const NOW = Date.parse("2026-09-03T00:00:00Z");
const rows = parseJcgfList(listHtml, 1, NOW);
const rowsP2 = parseJcgfList(listP2Html, 2, NOW);
const combined = parseJcgfList(listHtml + listP2Html, 1, NOW);

const FIRST = {
  title: "2026년 재기지원교육 3기",
  detailUrl: "https://jcgf.or.kr/bbs/board.php?bo_table=2_3_1_1&wr_id=129",
  dateText: "2026-08-27 ~ 2026-09-06",
  agency: "제주신용보증재단",
} as const;

describe("제주신용보증재단 창업 모집공고 목록 읽기 — 실사이트 고정본", () => {
  it("1쪽 고정본에서 15건을 읽고 첫 행의 제목·상세주소·dateText 가 맞다", () => {
    expect(rows.length).toBeGreaterThanOrEqual(8);
    expect(rows.length).toBeLessThanOrEqual(15);
    expect(rows).toHaveLength(15);
    expect(rows[0]).toMatchObject(FIRST);
  });

  it("접수기간이 YYYY-MM-DD ~ YYYY-MM-DD 모양이다 — 교육기간 날짜를 넣지 않는다", () => {
    expect(rows.every((r) => r.dateText !== "")).toBe(true);
    for (const r of rows) expect(r.dateText).toMatch(/^20\d{2}-\d{2}-\d{2} ~ 20\d{2}-\d{2}-\d{2}$/);
    expect(rows[0].dateText).toBe("2026-08-27 ~ 2026-09-06");
    expect(rows[0].dateText).not.toMatch(/2026-09-07|2026-09-08/);
  });

  it("★상세 주소에 쪽 번호를 넣지 않는다 — 넣으면 같은 글이 쪽마다 다른 줄이 된다", () => {
    expect(rows.every((r) => !/[?&]page=/.test(r.detailUrl))).toBe(true);
    expect(rowsP2.every((r) => !/[?&]page=/.test(r.detailUrl))).toBe(true);
    expect(rowsP2.every((r) => r.detailUrl.includes("wr_id="))).toBe(true);
  });

  it("날짜는 접수기간 칸에서만 집는다 — 행 전체 글자면 번호·인원과 붙는다", () => {
    const r = rows.find((x) => x.detailUrl.includes("wr_id=128"));
    expect(r?.dateText).toBe("2026-08-05 ~ 2026-08-25");
    expect(r?.dateText).not.toMatch(/102|18명|30명/);
  });

  it("1쪽+2쪽을 합쳐 파싱해도 상세 열쇠 중복이 없고 30건이다", () => {
    expect(rowsP2).toHaveLength(15);
    expect(rowsP2[0]).toMatchObject({
      title: "(서귀포시) 2026년 상반기 세무교육(부가가치세..",
      detailUrl: "https://jcgf.or.kr/bbs/board.php?bo_table=2_3_1_1&wr_id=112",
      dateText: "2026-01-02 ~ 2026-01-14",
    });
    const urls = combined.map((r) => r.detailUrl);
    expect(new Set(urls).size).toBe(urls.length);
    expect(combined).toHaveLength(30);
    expect(rows.map((r) => r.detailUrl)).not.toEqual(rowsP2.map((r) => r.detailUrl));
  });

  it("같은 글번호는 한 번만 담는다", () => {
    const urls = rows.map((r) => r.detailUrl);
    expect(new Set(urls).size).toBe(urls.length);
  });
});

describe("거르개 — 버릴 것만 지정한다", () => {
  it("DROP 낱말 행이 빠진다 — 입찰·설문·채용 공고·평가위원·합격자", () => {
    const cases = [
      "2026년 전산장비 입찰 공고",
      "고객만족도 설문 안내",
      "직원 채용 공고",
      "2026년 평가위원 모집",
      "지원사업 합격자 발표",
      "2026년 신입직원 임용",
      "홈페이지 구축 용역",
    ];
    for (const planted of cases) {
      const html = listHtml.replace("2026년 재기지원교육 3기", planted);
      const out = parseJcgfList(html, 1, NOW);
      expect(out.some((r) => r.title.includes(planted) || r.title === planted), planted).toBe(false);
      expect(out).toHaveLength(14);
      expect(isJcgfDropTitle(planted), planted).toBe(true);
    }
  });

  it("「채용」을 통째로 버리지 않는다 — 채용 지원사업이 죽으면 안 된다", () => {
    expect(isJcgfDropTitle("청년 채용 지원금 참여기업 모집 공고")).toBe(false);
    expect(
      parseJcgfList(
        listHtml.replace("2026년 재기지원교육 3기", "2026년 중소기업 신규직원 채용 지원사업 참여기업 모집"),
        1,
        NOW,
      ).some((r) => r.title.includes("채용 지원사업")),
    ).toBe(true);
  });

  it("지원사업·교육 모집은 살린다", () => {
    expect(rows.some((r) => r.title.includes("재기지원교육 3기"))).toBe(true);
    expect(rows.some((r) => r.title.includes("창업아카데미 8기"))).toBe(true);
    expect(isJcgfDropTitle("2026년 재기지원교육 3기")).toBe(false);
    expect(isJcgfDropTitle("2026년 창업아카데미 8기")).toBe(false);
  });
});

describe("붙박이 공지 — 1년 넘은 것은 담지 않는다", () => {
  it("기준 시각을 2030년으로 옮기면 2026-08-27 붙박이가 빠진다", () => {
    const pinned = listHtml.replace(/<td class="num">\s*103\s*<\/td>/, '<td class="num">공지</td>');
    const old = parseJcgfList(pinned, 1, Date.parse("2030-01-01T00:00:00Z"));
    expect(old.some((r) => r.detailUrl.includes("wr_id=129"))).toBe(false);
    expect(old).toHaveLength(14);
  });
});

describe("제주신용보증재단 설정", () => {
  it("쪽넘김은 GET page + bo_table=2_3_1_1", () => {
    expect(jcgfConfig.list.url(1)).toBe("https://jcgf.or.kr/bbs/board.php?bo_table=2_3_1_1&page=1");
    expect(jcgfConfig.list.url(2)).toBe("https://jcgf.or.kr/bbs/board.php?bo_table=2_3_1_1&page=2");
    expect(jcgfConfig.list.maxPages).toBe(7);
  });

  it("지역은 제주", () => {
    expect(jcgfConfig.region).toBe("제주");
    expect(jcgfConfig.id).toBe("jcgf");
    expect(jcgfConfig.agency).toBe("제주신용보증재단");
    expect(jcgfConfig.label).toBe("제주신용보증재단");
  });

  it("서식 변경 감지가 살아 있다 — 1은 검사를 끈 것과 같다", () => {
    expect(jcgfConfig.expectMinRows).toBeGreaterThanOrEqual(2);
    expect(jcgfConfig.expectMinRows).toBe(7);
  });

  it("행 선택자가 1쪽 고정본에서 실제 15줄을 잡는다", () => {
    expect(parseHtml(listHtml).querySelectorAll(jcgfConfig.list.rowSelector)).toHaveLength(15);
  });

  it("상세 본문·첨부 자리가 실측 선택자다", () => {
    expect(jcgfConfig.detailContentSelector).toBe("#writeContents");
    expect(jcgfConfig.attachmentsScopeSelector).toBe("#view_file_download_area");
  });
});

/** ★판정기를 망가뜨려 본다 — 안 하면 위 시험들이 「그냥 통과하는 글」일 뿐이다. */
describe("망가뜨려 보기", () => {
  it("행 껍데기 이름이 바뀌면 한 줄도 못 읽는다", () => {
    expect(parseJcgfList(listHtml.replaceAll('class="bg"', 'class="bg_x"'), 1, NOW)).toHaveLength(0);
  });

  it("제목 칸(td.subject)이 바뀌면 한 줄도 못 읽는다", () => {
    expect(parseJcgfList(listHtml.replaceAll('class="subject"', 'class="subject_x"'), 1, NOW)).toHaveLength(0);
  });

  it("접수기간 칸을 비우면 날짜를 비운다(오늘 날짜를 지어내지 않는다)", () => {
    const broken = parseJcgfList(listHtml.replaceAll("접수기간", "게시기간"), 1, NOW);
    expect(broken.length).toBeGreaterThan(0);
    expect(broken.every((r) => r.dateText === "")).toBe(true);
  });
});
