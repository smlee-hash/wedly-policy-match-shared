import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { gopaConfig, parseGopaList } from "./gopa";

/**
 * ★손으로 쓴 HTML 대신 **실사이트 고정본**으로 잰다(적대 리뷰 지적).
 * 앞서 손으로 쓴 고정본으로 시험했더니 실제 마크업과 어긋난 선택자가 그대로 통과했다 —
 * 창원은 첨부 범위를 `div.file_list_wrap` 으로 적고도 통과했는데 실제는 `<ul>` 이라
 * 첨부를 하나도 못 잡고 있었다. 고정본: 2026-09-03 실측 `/sub/apply01/list.html` 1쪽 + `?curpage=2` 2쪽.
 */
const listHtml = readFileSync(join(__dirname, "../__fixtures__/gopa-list.html"), "utf-8");
const listP2Html = readFileSync(join(__dirname, "../__fixtures__/gopa-list-p2.html"), "utf-8");
const rows = parseGopaList(listHtml);
const rowsP2 = parseGopaList(listP2Html);
const combined = parseGopaList(listHtml + listP2Html);

describe("김포산업진흥원 목록 읽기 — 실사이트 고정본", () => {
  it("1쪽 고정본에서 행 6건을 읽고 첫 행의 제목·상세주소·날짜가 맞다", () => {
    expect(rows).toHaveLength(6);
    expect(rows[0]).toMatchObject({
      title: "「김포시 에너지효율시장 조성사업」 참여기업 모집",
      detailUrl: "https://gopa.or.kr/sub/apply01/view.html?idx=113",
      dateText: "2026-08-12 ~ 2026-08-28",
    });
  });

  it("상세 주소에 쪽 번호(curpage)가 안 섞인다 — 같은 글이 쪽마다 다른 줄로 저장되면 안 된다", () => {
    for (const r of [...rows, ...rowsP2]) {
      expect(r.detailUrl).toMatch(/^https:\/\/gopa\.or\.kr\/sub\/apply01\/view\.html\?idx=\d+$/);
      expect(r.detailUrl).not.toContain("curpage");
    }
  });

  it("★신청기간이 YYYY-MM-DD ~ YYYY-MM-DD 모양이다 — em 칸에서만 읽는다", () => {
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.dateText).toMatch(/^20\d{2}-\d{2}-\d{2} ~ 20\d{2}-\d{2}-\d{2}$/);
    for (const r of rowsP2) expect(r.dateText).toMatch(/^20\d{2}-\d{2}-\d{2} ~ 20\d{2}-\d{2}-\d{2}$/);
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
      const html = listHtml.replace("「김포시 에너지효율시장 조성사업」 참여기업 모집", planted);
      const out = parseGopaList(html);
      expect(out.some((r) => r.title.includes(planted) || r.title === planted), planted).toBe(false);
      expect(out).toHaveLength(5);
    }
  });

  it("★「채용 지원사업」은 버리지 않는다 — 고용보조금은 제목에 「채용」을 쓴다", () => {
    expect(
      parseGopaList(
        listHtml.replace(
          "「김포시 에너지효율시장 조성사업」 참여기업 모집",
          "2026년 중소기업 신규직원 채용 지원사업 참여기업 모집",
        ),
      ).some((r) => r.title.includes("채용 지원사업")),
    ).toBe(true);
  });

  it("1·2쪽 고정본을 합쳐도 상세 열쇠 중복이 없다", () => {
    expect(rowsP2).toHaveLength(6);
    expect(rowsP2[0]).toMatchObject({
      title: "김포시 영세·소규모 사업장 노동자 건강검진비 지원사업(2차)",
      detailUrl: "https://gopa.or.kr/sub/apply01/view.html?idx=107",
      dateText: "2026-04-27 ~ 2026-05-08",
    });
    const urls = combined.map((r) => r.detailUrl);
    expect(new Set(urls).size).toBe(urls.length);
    expect(combined).toHaveLength(12);
    expect(rows.map((r) => r.detailUrl)).not.toEqual(rowsP2.map((r) => r.detailUrl));
  });

  it("같은 글번호는 한 쪽 안에서도 한 번만 담는다", () => {
    const ids = rows.map((r) => r.detailUrl);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("김포산업진흥원 설정", () => {
  it("쪽넘김은 GET curpage — 쪽마다 주소가 달라야 중복이 안 생긴다", () => {
    expect(gopaConfig.list.url(1)).toContain("curpage=1");
    expect(gopaConfig.list.url(2)).toContain("curpage=2");
    expect(gopaConfig.list.url(1)).not.toBe(gopaConfig.list.url(2));
    expect(gopaConfig.list.maxPages).toBe(19);
  });

  it("지역은 경기 — 지역 조건 없이 전국에 노출되면 안 된다", () => {
    expect(gopaConfig.region).toBe("경기");
  });

  it("서식 변경 감지가 살아 있다 — 1은 검사를 끈 것과 같다", () => {
    expect(gopaConfig.expectMinRows).toBeGreaterThanOrEqual(3);
  });
});

/**
 * ★판정기를 망가뜨려 본다 — 안 하면 위 시험들이 「그냥 통과하는 글」일 뿐이다.
 * 행 껍데기 이름을 바꾼 고정본을 넣었을 때 0행이어야 선택자가 실제로 그 칸을 본다는 증거다.
 */
describe("망가뜨려 보기", () => {
  it("행 껍데기 이름(list list2)이 바뀌면 한 줄도 못 읽는다", () => {
    expect(parseGopaList(listHtml.replaceAll("list list2", "list list2-x"))).toHaveLength(0);
  });

  it("제목 칸(strong)이 바뀌면 한 줄도 못 읽는다", () => {
    expect(parseGopaList(listHtml.replaceAll("<strong>", "<b>").replaceAll("</strong>", "</b>"))).toHaveLength(0);
  });

  it("신청기간 칸(em)이 사라지면 날짜를 비운다(오늘 날짜를 지어내지 않는다)", () => {
    const broken = parseGopaList(listHtml.replaceAll("<em>", "<i>").replaceAll("</em>", "</i>"));
    expect(broken).toHaveLength(6);
    expect(broken.every((r) => r.dateText === "")).toBe(true);
  });
});
