import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { pagingParamsOf } from "../engine";
import { parseHtml } from "../html";
import { isJbaDropTitle, jbaConfig, parseJbaList } from "./jba";

/**
 * ★손으로 쓴 HTML 대신 **실사이트 고정본**으로 잰다.
 * 창원 사고: 지어낸 HTML 로 시험하면 선택자 오타가 그대로 통과한다.
 * 고정본: 2026-09-03 실측 `bo_table=2_1_1_1` 사업공고 1·2쪽.
 */
const listHtml = readFileSync(join(__dirname, "../__fixtures__/jba-list.html"), "utf-8");
const listP2Html = readFileSync(join(__dirname, "../__fixtures__/jba-list-p2.html"), "utf-8");
const NOW = Date.parse("2026-09-03T00:00:00Z");
const rows = parseJbaList(listHtml, 1, NOW);
const rowsP2 = parseJbaList(listP2Html, 2, NOW);
const combined = parseJbaList(listHtml + listP2Html, 1, NOW);

const FIRST = {
  title: "2026년 제주우수제품품질인증(JQ) 인증기업 시험성적서 비용 지원 참여기업 모집공고",
  detailUrl: "https://www.jba.or.kr/bbs/board.php?bo_table=2_1_1_1&wr_id=794",
  dateText: "",
  agency: "제주경제통상진흥원",
} as const;

describe("제주경제통상진흥원 사업공고 목록 읽기 — 실사이트 고정본", () => {
  it("1쪽 고정본에서 DROP·중복을 뺀 17건을 읽고 첫 행이 맞다", () => {
    expect(rows.length).toBeGreaterThanOrEqual(8);
    expect(rows.length).toBeLessThanOrEqual(18);
    expect(rows).toHaveLength(17);
    expect(rows[0]).toMatchObject(FIRST);
  });

  it("★상세 주소에 쪽 번호를 넣지 않는다 — 2쪽 원문 href 에 page=2 가 붙어 있다", () => {
    expect(rows.every((r) => !/[?&]page=/.test(r.detailUrl))).toBe(true);
    expect(rowsP2.every((r) => !/[?&]page=/.test(r.detailUrl))).toBe(true);
    expect(rowsP2.every((r) => r.detailUrl.includes("wr_id="))).toBe(true);
    expect(rowsP2.every((r) => !r.detailUrl.includes("/m/"))).toBe(true);
  });

  it("★붙박이(noticeicon·span.notice) 행은 등록일을 개시일로 넘기지 않는다", () => {
    expect(rows[0].dateText).toBe("");
    const training = rows.find((r) => r.detailUrl.includes("wr_id=707"));
    expect(training).toMatchObject({
      title: "2026년 도외 직업훈련 참가 지원사업 참여자 모집 공고",
      detailUrl: "https://www.jba.or.kr/bbs/board.php?bo_table=2_1_1_1&wr_id=707",
      dateText: "",
    });
  });

  it("일반 행은 등록일을 개시형으로 넘긴다 — 위 규칙이 전부를 비우면 안 된다", () => {
    const normal = rows.filter((r) => r.dateText !== "");
    expect(normal.length).toBeGreaterThan(0);
    for (const r of normal) expect(r.dateText).toMatch(/^\d{4}-\d{2}-\d{2} ~$/);
    const firstDated = rows.find((r) => r.detailUrl.includes("wr_id=810"));
    expect(firstDated).toMatchObject({
      title: "2026년 제주자원 활용 창업 컨설팅 지원사업(추가모집) 선정업체 발표 및 향후 일정 알림",
      detailUrl: "https://www.jba.or.kr/bbs/board.php?bo_table=2_1_1_1&wr_id=810",
      dateText: "2026-09-01 ~",
    });
  });

  it("1쪽+2쪽을 합쳐 파싱해도 상세 열쇠 중복이 없고 31건이다", () => {
    expect(rowsP2).toHaveLength(16);
    expect(rowsP2.find((r) => r.detailUrl.includes("wr_id=792"))).toMatchObject({
      title: "2026 물류전문인력양성과정 교육생 참여 모집 공고",
      detailUrl: "https://www.jba.or.kr/bbs/board.php?bo_table=2_1_1_1&wr_id=792",
      dateText: "2026-07-09 ~",
    });
    const urls = combined.map((r) => r.detailUrl);
    expect(new Set(urls).size).toBe(urls.length);
    expect(combined).toHaveLength(31);
    expect(rows.map((r) => r.detailUrl)).not.toEqual(rowsP2.map((r) => r.detailUrl));
  });

  it("날짜는 td.datetime 칸에서만 집는다 — 행 전체 글자면 번호와 붙는다", () => {
    const r = rows.find((x) => x.detailUrl.includes("wr_id=810"));
    expect(r?.dateText).toBe("2026-09-01 ~");
    expect(r?.dateText).not.toMatch(/753|1287/);
  });
});

describe("거르개 — 버릴 것만 지정한다", () => {
  it("DROP 거르개가 실측 제목을 실제로 버린다", () => {
    const titles = combined.map((r) => r.title);
    expect(titles.some((t) => t.includes("임대모집"))).toBe(false);
    expect(titles.some((t) => t.includes("컨설턴트 모집"))).toBe(false);
    expect(combined.some((r) => r.detailUrl.includes("wr_id=807"))).toBe(false);
    expect(combined.some((r) => r.detailUrl.includes("wr_id=781"))).toBe(false);
    expect(isJbaDropTitle("진흥원 청사 사무실 임대모집 공고(5층, 2층)")).toBe(true);
    expect(
      isJbaDropTitle("2026년 제주소상공인경영지원센터 외식업체 경영 컨설팅 지원사업 컨설턴트 모집 공고"),
    ).toBe(true);
  });

  it("입찰·설문·채용 공고·평가위원·합격자 행이 빠진다", () => {
    const cases = [
      "2026년 전산장비 입찰 공고",
      "고객만족도 설문 안내",
      "직원 채용 공고",
      "2026년 평가위원 모집",
      "지원사업 합격자 발표",
    ];
    for (const planted of cases) {
      const html = listHtml.replace(
        "2026년 제주자원 활용 창업 컨설팅 지원사업(추가모집) 선정업체 발표 및 향후 일정 알림",
        planted,
      );
      const out = parseJbaList(html, 1, NOW);
      expect(out.some((r) => r.title.includes(planted) || r.title === planted), planted).toBe(false);
      expect(isJbaDropTitle(planted), planted).toBe(true);
    }
  });

  it("「채용」을 통째로 버리지 않는다 — 채용 지원사업이 죽으면 안 된다", () => {
    expect(isJbaDropTitle("청년 채용 지원금 참여기업 모집 공고")).toBe(false);
    expect(
      parseJbaList(
        listHtml.replace(
          "2026년 제주자원 활용 창업 컨설팅 지원사업(추가모집) 선정업체 발표 및 향후 일정 알림",
          "2026년 중소기업 신규직원 채용 지원사업 참여기업 모집",
        ),
        1,
        NOW,
      ).some((r) => r.title.includes("채용 지원사업")),
    ).toBe(true);
  });

  it("지원사업·교육 모집·창업 컨설팅은 살린다", () => {
    expect(rows.some((r) => r.title.includes("창업 컨설팅 지원사업"))).toBe(true);
    expect(rows.some((r) => r.title.includes("디지털전환 마케팅교육"))).toBe(true);
    expect(isJbaDropTitle("2026년 제주자원 활용 창업 컨설팅 지원사업(추가모집) 선정업체 발표 및 향후 일정 알림")).toBe(
      false,
    );
    expect(isJbaDropTitle("2026년 소상공인 디지털전환 마케팅교육 (8기) 교육생 모집 공고")).toBe(false);
  });
});

describe("붙박이 공지 — 1년 넘은 것은 담지 않는다", () => {
  it("기준 시각을 2030년으로 옮기면 2026-07-16 붙박이가 빠진다", () => {
    const old = parseJbaList(listHtml, 1, Date.parse("2030-01-01T00:00:00Z"));
    expect(old.some((r) => r.detailUrl.includes("wr_id=794"))).toBe(false);
    expect(old.some((r) => r.detailUrl.includes("wr_id=707"))).toBe(false);
    expect(old.every((r) => r.dateText !== "")).toBe(true);
  });
});

describe("제주경제통상진흥원 설정", () => {
  it("쪽넘김은 GET page + bo_table=2_1_1_1", () => {
    expect(jbaConfig.list.url(1)).toBe("https://www.jba.or.kr/bbs/board.php?bo_table=2_1_1_1&page=1");
    expect(jbaConfig.list.url(2)).toBe("https://www.jba.or.kr/bbs/board.php?bo_table=2_1_1_1&page=2");
    expect(jbaConfig.list.maxPages).toBe(10);
  });

  it("★상세 주소의 page 는 엔진이 알아서 떼어 낸다 — 안 떼면 같은 글이 쪽마다 다른 주소가 된다", () => {
    expect(pagingParamsOf(jbaConfig)).toContain("page");
  });

  it("지역은 제주", () => {
    expect(jbaConfig.region).toBe("제주");
    expect(jbaConfig.id).toBe("jba");
    expect(jbaConfig.agency).toBe("제주경제통상진흥원");
    expect(jbaConfig.label).toBe("제주경제통상진흥원");
  });

  it("서식 변경 감지가 살아 있다 — 1은 검사를 끈 것과 같다", () => {
    expect(jbaConfig.expectMinRows).toBeGreaterThanOrEqual(2);
    expect(jbaConfig.expectMinRows).toBe(7);
  });

  it("행 선택자가 1쪽 고정본에서 실제 18줄을 잡는다", () => {
    expect(parseHtml(listHtml).querySelectorAll(jbaConfig.list.rowSelector)).toHaveLength(18);
  });

  it("상세 본문·첨부 자리가 실측 선택자다", () => {
    expect(jbaConfig.detailContentSelector).toBe("#writeContents");
    expect(jbaConfig.attachmentsScopeSelector).toBe("#view_file_download_area");
  });
});

/** ★판정기를 망가뜨려 본다 — 안 하면 위 시험들이 「그냥 통과하는 글」일 뿐이다. */
describe("망가뜨려 보기", () => {
  it("행 껍데기 이름이 바뀌면 한 줄도 못 읽는다", () => {
    expect(parseJbaList(listHtml.replaceAll('class="bg"', 'class="bg_x"'), 1, NOW)).toHaveLength(0);
  });

  it("제목 칸(td.subject)이 바뀌면 한 줄도 못 읽는다", () => {
    expect(parseJbaList(listHtml.replaceAll('class="subject"', 'class="subject_x"'), 1, NOW)).toHaveLength(0);
  });

  it("작성일 칸이 사라지면 날짜를 비운다(오늘 날짜를 지어내지 않는다)", () => {
    const broken = parseJbaList(listHtml.replaceAll('class="datetime"', 'class="datetime_x"'), 1, NOW);
    expect(broken.length).toBeGreaterThan(0);
    expect(broken.every((r) => r.dateText === "")).toBe(true);
  });
});
