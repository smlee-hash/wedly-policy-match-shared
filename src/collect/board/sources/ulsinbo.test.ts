import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isUlsinboDropTitle, parseUlsinboList, ulsinboConfig } from "./ulsinbo";

/**
 * ★손으로 쓴 HTML 대신 **실사이트 고정본**으로 잰다.
 * 창원 사고: 지어낸 HTML 로 시험하면 선택자 오타가 그대로 통과한다.
 * 고정본: 2026-09-03 실측 중소기업지원자금공고 1쪽 + `?page=2`(같은 50건, href 에 page 만 붙음).
 */
const listHtml = readFileSync(join(__dirname, "../__fixtures__/ulsinbo-list.html"), "utf-8");
const listP2Html = readFileSync(join(__dirname, "../__fixtures__/ulsinbo-list-p2.html"), "utf-8");
const rows = parseUlsinboList(listHtml);
const combined = parseUlsinboList(listHtml + listP2Html);

describe("울산신용보증재단 자금공고 목록 읽기 — 실사이트 고정본", () => {
  it("1쪽 고정본에서 DROP·중복을 뺀 50건을 읽고 첫 행이 맞다", () => {
    expect(rows).toHaveLength(50);
    expect(rows[0]).toMatchObject({
      title: "2026년 울산광역시 소상공인 경영안정자금(4차)",
      detailUrl: "https://www.ulsanshinbo.co.kr/02_sinbo/?mcode=0402060000&no=122",
      dateText: "2026-09-10 ~",
      agency: "울산신용보증재단",
    });
  });

  it("★상세 주소에 쪽 번호를 넣지 않는다 — page 가 붙으면 같은 글이 두 줄이 된다", () => {
    expect(rows.every((r) => !r.detailUrl.includes("page="))).toBe(true);
    const p2 = parseUlsinboList(listP2Html);
    expect(p2).toHaveLength(50);
    expect(p2[0].detailUrl).toBe("https://www.ulsanshinbo.co.kr/02_sinbo/?mcode=0402060000&no=122");
    expect(p2.every((r) => !r.detailUrl.includes("page="))).toBe(true);
  });

  it("지원기간은 「시작 ~」 개시형이다 — 끝이 「자금소진시까지」라 마감일을 지어내지 않는다", () => {
    expect(rows.every((r) => r.dateText !== "")).toBe(true);
    for (const r of rows) expect(r.dateText).toMatch(/^\d{4}-\d{2}-\d{2} ~$/);
  });

  it("1쪽+2쪽을 합쳐 파싱해도 상세 열쇠 중복이 없고 50건이다", () => {
    const urls = combined.map((r) => r.detailUrl);
    expect(new Set(urls).size).toBe(urls.length);
    expect(combined).toHaveLength(50);
  });

  it("DROP 거르개가 실측 제목을 실제로 버린다", () => {
    const planted = parseUlsinboList(
      listHtml.replace(
        "2026년 울산광역시 소상공인 경영안정자금(4차)",
        "입찰 공고",
      ),
    );
    expect(planted.some((r) => r.title.includes("입찰"))).toBe(false);
    expect(planted).toHaveLength(49);
    expect(isUlsinboDropTitle("입찰 공고")).toBe(true);
    expect(isUlsinboDropTitle("설문 조사 안내")).toBe(true);
    expect(isUlsinboDropTitle("평가위원 모집")).toBe(true);
    expect(isUlsinboDropTitle("합격자 발표")).toBe(true);
    expect(isUlsinboDropTitle("직원 채용 공고")).toBe(true);
  });

  it("「채용」을 통째로 버리지 않는다 — 채용 지원사업은 살아남는다", () => {
    expect(
      parseUlsinboList(
        listHtml.replace(
          "2026년 울산광역시 소상공인 경영안정자금(4차)",
          "채용 지원사업 참여기업 모집",
        ),
      ).some((r) => r.title.includes("채용 지원사업")),
    ).toBe(true);
    expect(isUlsinboDropTitle("채용 지원사업 참여기업 모집")).toBe(false);
  });

  it("날짜는 지원기간 칸에서만 집는다 — 행 전체 글자면 제목·번호와 붙는다", () => {
    const r = rows.find((x) => x.detailUrl.endsWith("no=122"));
    expect(r?.dateText).toBe("2026-09-10 ~");
    expect(r?.dateText).not.toMatch(/50/);
    const polluted = listHtml.replace(
      "2026년 울산광역시 소상공인 경영안정자금(4차)",
      "2020.01.01 가짜날짜 소상공인 경영안정자금(4차)",
    );
    expect(parseUlsinboList(polluted)[0].dateText).toBe("2026-09-10 ~");
  });
});

describe("울산신용보증재단 자금공고 설정", () => {
  it("쪽넘김은 없다 — 50건이 한 쪽에 다 실리고 page 파라미터는 무시된다", () => {
    expect(ulsinboConfig.list.url(1)).toBe(
      "https://www.ulsanshinbo.co.kr/02_sinbo/?mcode=0402060000",
    );
    expect(ulsinboConfig.list.url(2)).toBe(ulsinboConfig.list.url(1));
    expect(ulsinboConfig.list.maxPages).toBe(1);
  });

  it("지역은 울산", () => {
    expect(ulsinboConfig.region).toBe("울산");
    expect(ulsinboConfig.id).toBe("ulsinbo");
  });

  it("서식 변경 감지가 살아 있다 — 1은 검사를 끈 것과 같다", () => {
    expect(ulsinboConfig.expectMinRows).toBeGreaterThanOrEqual(25);
  });

  it("★본문 선택자를 비운다 — 상세는 PDF iframe 이라 빈 본문을 채우면 첨부 공고문을 건너뛴다", () => {
    expect(ulsinboConfig.detailContentSelector).toBeUndefined();
    expect(ulsinboConfig.attachmentsScopeSelector).toBe("ul.infoBox");
  });
});

/** ★판정기를 망가뜨려 본다 — 안 하면 위 시험들이 「그냥 통과하는 글」일 뿐이다. */
describe("망가뜨려 보기", () => {
  it("행 껍데기 이름이 바뀌면 한 줄도 못 읽는다", () => {
    expect(parseUlsinboList(listHtml.replaceAll("board-text", "board-text-x"))).toHaveLength(0);
  });
});
