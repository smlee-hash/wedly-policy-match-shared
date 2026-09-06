import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseYpaList, ypaConfig } from "./ypa";

/**
 * ★손으로 쓴 HTML 대신 **실사이트 고정본**으로 잰다(적대 리뷰 지적).
 * 고정본: 2026-09-03 `https://ybs.ypa.or.kr/application.do?pageIndex=1` · `pageIndex=2`.
 */
const listHtml = readFileSync(join(__dirname, "../__fixtures__/ypa-list.html"), "utf-8");
const listP2Html = readFileSync(join(__dirname, "../__fixtures__/ypa-list-p2.html"), "utf-8");
const rows = parseYpaList(listHtml);
const rowsP2 = parseYpaList(listP2Html);
const combined = parseYpaList(listHtml + listP2Html);

describe("용인시산업진흥원 목록 읽기 — 실사이트 고정본", () => {
  it("1쪽 고정본에서 10건을 읽고 첫 행의 제목·상세주소·날짜가 맞다", () => {
    expect(rows).toHaveLength(10);
    expect(rows.length).toBeGreaterThanOrEqual(ypaConfig.expectMinRows ?? 0);
    expect(rows[0]).toMatchObject({
      title: "소공인 레벨업 특강 모집(AI 마케팅 9/29(화), 캡컷 활용 10/8(목))",
      detailUrl: "https://ybs.ypa.or.kr/poratlAppFormDtl.do?regNo=RGS_0000000000000662",
      dateText: "2026-09-02 ~ 2026-10-08",
    });
  });

  it("접수기간은 YYYY-MM-DD ~ YYYY-MM-DD 이다 — 시각은 버리고 칸(span)에서만 읽는다", () => {
    expect(rows.every((r) => /^20\d{2}-\d{2}-\d{2} ~ 20\d{2}-\d{2}-\d{2}$/.test(r.dateText))).toBe(true);
    expect(rows[1]).toMatchObject({
      title: "2026년 소공인특화지원센터 멘토링 추가 모집공고",
      detailUrl: "https://ybs.ypa.or.kr/poratlAppFormDtl.do?regNo=RGS_0000000000000661",
      dateText: "2026-09-02 ~ 2026-10-02",
    });
  });

  it("상세 주소는 onclick 의 REGNO 로 조립하고 쪽 번호가 안 섞인다", () => {
    for (const r of rows) {
      expect(r.detailUrl).toMatch(
        /^https:\/\/ybs\.ypa\.or\.kr\/poratlAppFormDtl\.do\?regNo=RGS_\d+$/,
      );
      expect(r.detailUrl).not.toMatch(/pageIndex/);
    }
  });

  it("★「채용 연계 지원」은 살아남는다 — 「채용」을 통째로 버리면 죽는다", () => {
    expect(rows.some((r) => r.title.includes("채용 연계 지원"))).toBe(true);
  });

  it("★「채용 지원사업」은 버리지 않는다 — 고용보조금은 제목에 「채용」을 쓴다", () => {
    expect(
      parseYpaList(
        listHtml.replace(
          "소공인 레벨업 특강 모집(AI 마케팅 9/29(화), 캡컷 활용 10/8(목))",
          "2026년 방위산업 중소기업 신규직원 채용 지원사업 참여기업 모집공고",
        ),
      ).some((r) => r.title.includes("채용 지원사업")),
    ).toBe(true);
  });

  it("DROP 낱말 행이 빠진다 — 입찰·설문·채용 공고·평가위원·합격자만 좁게", () => {
    const plant = (title: string) =>
      parseYpaList(
        listHtml.replace(
          "소공인 레벨업 특강 모집(AI 마케팅 9/29(화), 캡컷 활용 10/8(목))",
          title,
        ),
      );
    expect(plant("2026년 사무용품 입찰 공고").some((r) => r.title.includes("입찰"))).toBe(false);
    expect(plant("만족도 설문 조사").some((r) => r.title.includes("설문"))).toBe(false);
    expect(plant("직원 채용 공고").some((r) => r.title.includes("채용 공고"))).toBe(false);
    expect(plant("2026년 평가위원 모집").some((r) => r.title.includes("평가위원"))).toBe(false);
    expect(plant("합격자 발표").some((r) => r.title.includes("합격자"))).toBe(false);
  });

  it("1·2쪽을 합쳐도 중복이 없다", () => {
    expect(rowsP2).toHaveLength(10);
    expect(rowsP2[0].title).toBe("2026년 용인IP지원센터 운영 IP 컨설팅 통합 공고(수시 접수)");
    expect(rowsP2[0].detailUrl).toBe(
      "https://ybs.ypa.or.kr/poratlAppFormDtl.do?regNo=RGS_0000000000000575",
    );
    const ids = combined.map((r) => r.detailUrl);
    expect(new Set(ids).size).toBe(ids.length);
    expect(combined).toHaveLength(20);
    expect(rows.map((r) => r.detailUrl)).not.toEqual(rowsP2.map((r) => r.detailUrl));
  });
});

describe("용인시산업진흥원 설정", () => {
  it("쪽넘김은 GET pageIndex — 쪽마다 주소가 달라야 중복이 안 생긴다", () => {
    expect(ypaConfig.list.url(1)).toContain("pageIndex=1");
    expect(ypaConfig.list.url(2)).toContain("pageIndex=2");
    expect(ypaConfig.list.url(1)).not.toBe(ypaConfig.list.url(2));
    expect(ypaConfig.list.maxPages).toBe(20);
  });

  it("지역은 경기 — 지역 조건 없이 전국에 노출되면 안 된다", () => {
    expect(ypaConfig.region).toBe("경기");
    expect(ypaConfig.id).toBe("ypa");
    expect(ypaConfig.agency).toBe("용인시산업진흥원");
  });

  it("서식 변경 감지가 살아 있다 — 1은 검사를 끈 것과 같다", () => {
    expect(ypaConfig.expectMinRows).toBeGreaterThanOrEqual(5);
  });
});

/** ★판정기를 망가뜨려 본다 — 안 하면 위 시험들이 「그냥 통과하는 글」일 뿐이다. */
describe("망가뜨려 보기", () => {
  it("행 선택자가 틀리면 0행이다", () => {
    expect(parseYpaList(listHtml.replaceAll("boardBox", "boardBoxX"))).toHaveLength(0);
  });

  it("제목 칸(pjtit)이 바뀌면 한 줄도 못 읽는다", () => {
    expect(parseYpaList(listHtml.replaceAll("pjtit", "pjtitX"))).toHaveLength(0);
  });
});
