import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isGwsinboDropTitle, parseGwsinboList, gwsinboConfig } from "./gwsinbo";

/**
 * ★손으로 쓴 HTML 대신 **실사이트 고정본**으로 잰다.
 * 창원 사고: 지어낸 HTML 로 시험하면 선택자 오타가 그대로 통과한다.
 * 고정본: 2026-09-03 실측 `board_list.php?board_name=product` 1·2쪽.
 */
const listHtml = readFileSync(join(__dirname, "../__fixtures__/gwsinbo-list.html"), "utf-8");
const listP2Html = readFileSync(join(__dirname, "../__fixtures__/gwsinbo-list-p2.html"), "utf-8");
const rows = parseGwsinboList(listHtml);
const rowsP2 = parseGwsinboList(listP2Html);
const combined = parseGwsinboList(listHtml + listP2Html);

describe("강원신용보증재단 협약보증 목록 읽기 — 실사이트 고정본", () => {
  it("1쪽 고정본에서 20건을 읽고 첫 행의 제목·상세주소·dateText 가 맞다", () => {
    expect(rows).toHaveLength(20);
    expect(rows[0]).toMatchObject({
      title: "2026 정선군 출연 소상공인 협약보증",
      detailUrl: "https://gwsinbo.or.kr/board/board_view.php?view_id=183&board_name=product",
      dateText: "2026-03-31 ~",
      agency: "강원신용보증재단",
    });
  });

  it("★상세 주소에 쪽 번호를 넣지 않는다 — 넣으면 같은 글이 쪽마다 다른 줄이 된다", () => {
    expect(rows.every((r) => !/[?&]page=/.test(r.detailUrl))).toBe(true);
    expect(rowsP2.every((r) => !/[?&]page=/.test(r.detailUrl))).toBe(true);
  });

  it("일반 행은 등록일을 개시형으로 넘긴다", () => {
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.dateText).toMatch(/^\d{4}-\d{2}-\d{2} ~$/);
    for (const r of rowsP2) expect(r.dateText).toMatch(/^\d{4}-\d{2}-\d{2} ~$/);
  });

  it("1쪽+2쪽을 합쳐 파싱해도 상세 열쇠 중복이 없고 40건이다", () => {
    expect(rowsP2).toHaveLength(20);
    expect(rowsP2[0]).toMatchObject({
      title: "예술인 창업 경영자금 융자지원 협약보증(지원규모 확대)",
      detailUrl: "https://gwsinbo.or.kr/board/board_view.php?view_id=159&board_name=product",
      dateText: "2025-04-03 ~",
    });
    const urls = combined.map((r) => r.detailUrl);
    expect(new Set(urls).size).toBe(urls.length);
    expect(combined).toHaveLength(40);
    expect(rowsP2[0].detailUrl).not.toBe(rows[0].detailUrl);
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
      const html = listHtml.replace("2026 정선군 출연 소상공인 협약보증", planted);
      const out = parseGwsinboList(html);
      expect(out.some((r) => r.title.includes(planted) || r.title === planted), planted).toBe(false);
      expect(out).toHaveLength(19);
      expect(isGwsinboDropTitle(planted), planted).toBe(true);
    }
  });

  it("「채용」을 통째로 버리지 않는다 — 채용 지원사업이 죽으면 안 된다", () => {
    expect(isGwsinboDropTitle("청년 채용 지원금 참여기업 모집 공고")).toBe(false);
    expect(
      parseGwsinboList(
        listHtml.replace(
          "2026 정선군 출연 소상공인 협약보증",
          "2026년 중소기업 신규직원 채용 지원사업 참여기업 모집",
        ),
      ).some((r) => r.title.includes("채용 지원사업")),
    ).toBe(true);
  });

  it("날짜는 날짜 칸에서만 집는다 — 행 전체 글자면 번호와 붙는다", () => {
    const r = rows.find((x) => x.detailUrl.includes("view_id=183"));
    expect(r?.dateText).toBe("2026-03-31 ~");
    expect(r?.dateText).not.toMatch(/40/);
    expect(r?.dateText).not.toMatch(/2,306/);
  });
});

describe("강원신용보증재단 설정", () => {
  it("쪽넘김은 GET page + board_name=product", () => {
    expect(gwsinboConfig.list.url(1)).toBe(
      "https://gwsinbo.or.kr/board/board_list.php?board_name=product&page=1",
    );
    expect(gwsinboConfig.list.url(2)).toBe(
      "https://gwsinbo.or.kr/board/board_list.php?board_name=product&page=2",
    );
    expect(gwsinboConfig.list.maxPages).toBe(2);
  });

  it("지역은 강원", () => {
    expect(gwsinboConfig.region).toBe("강원");
    expect(gwsinboConfig.id).toBe("gwsinbo");
    expect(gwsinboConfig.agency).toBe("강원신용보증재단");
    expect(gwsinboConfig.label).toBe("강원신용보증재단 협약보증");
  });

  it("서식 변경 감지가 살아 있다 — 한 쪽 20건의 절반", () => {
    expect(gwsinboConfig.expectMinRows).toBe(10);
  });
});

/**
 * ★판정기를 망가뜨려 본다 — 안 하면 위 시험들이 「그냥 통과하는 글」일 뿐이다.
 * 행 선택자를 틀리게 준 고정본을 넣었을 때 0행이어야 선택자가 실제로 그 칸을 본다는 증거다.
 */
describe("망가뜨려 보기", () => {
  it("행 선택자(hover_list)가 한 글자 틀리면 0행이다", () => {
    expect(parseGwsinboList(listHtml.replaceAll("hover_list", "hover_list-x"))).toHaveLength(0);
  });

  it("제목 칸(td.subject)이 바뀌면 한 줄도 못 읽는다", () => {
    expect(parseGwsinboList(listHtml.replaceAll('class="subject"', 'class="subject-x"'))).toHaveLength(0);
  });

  it("날짜 칸이 사라지면 날짜를 비운다(오늘 날짜를 지어내지 않는다)", () => {
    const out = parseGwsinboList(listHtml.replace(/<td>(20\d{2}-\d{2}-\d{2})<\/td>/g, "<td></td>"));
    expect(out).toHaveLength(20);
    expect(out.every((r) => r.dateText === "")).toBe(true);
  });
});
