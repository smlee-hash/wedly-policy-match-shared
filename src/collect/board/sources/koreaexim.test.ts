import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { pagingParamsOf } from "../engine";
import { parseHtml } from "../html";
import { parseKoreaeximList, koreaeximConfig, isKoreaeximDropTitle } from "./koreaexim";

/** 고정본: 2026-09-02 `https://www.koreaexim.go.kr/HPHKBI039M01` 1·2쪽 원문(591KB·580KB). */
const p1 = readFileSync(join(__dirname, "../__fixtures__/koreaexim-list.html"), "utf-8");
const p2 = readFileSync(join(__dirname, "../__fixtures__/koreaexim-list-p2.html"), "utf-8");
const NOW = Date.parse("2026-09-02T00:00:00Z");
const rows = parseKoreaeximList(p1, 1, NOW);

describe("한국수출입은행 목록 읽기 — 실사이트 고정본", () => {
  it("1쪽 20줄에서 거르개·묵은 붙박이를 지난 12건을 읽고 첫 행이 맞다", () => {
    expect(rows).toHaveLength(12);
    expect(rows[0]).toMatchObject({
      title: "한국수출입은행 2026년 하반기 중소벤처 초혁신 성장펀드 출자사업 공고",
      detailUrl: "https://www.koreaexim.go.kr/HPHKBI039M01/115905?curPage=1",
      agency: "한국수출입은행",
    });
  });

  it("★기관을 은행으로 못 박지 않는다 — 절반이 대외경제협력기금(EDCF) 글이다", () => {
    const agencies = new Set([...rows, ...parseKoreaeximList(p2, 1, NOW)].map((r) => r.agency));
    expect(agencies.has("한국수출입은행")).toBe(true);
    expect(agencies.has("대외경제협력기금")).toBe(true);
  });

  it("1쪽과 2쪽을 합쳐도 중복이 없다 — 붙박이 공지가 모든 쪽에 반복되는데도", () => {
    const all = [...rows, ...parseKoreaeximList(p2, 1, NOW)];
    expect(new Set(all.map((r) => r.detailUrl.split("?")[0])).size).toBe(all.length);
  });
});

describe("붙박이 공지 — 등록일을 개시일로 넘기지 않는다", () => {
  it("공지 칸이 있는 줄은 날짜를 비운다", () => {
    // 실측 붙박이 10건 중 거르개를 지난 7건. 2023~2024년 글이 섞여 있어 등록일을 넘기면
    // 저장 쪽 「등록 90일」 규칙에 걸려 사이트에선 맨 위인데 우리 DB 엔 처음부터 마감으로 들어간다.
    const blank = rows.filter((r) => r.dateText === "");
    expect(blank).toHaveLength(5);
    expect(blank[0].title).toContain("초혁신 성장펀드");
  });

  it("★1년 넘게 붙어 있는 붙박이는 아예 안 담는다 — 2023년 안내문이 새 공고로 되살아나면 안 된다", () => {
    expect(rows.some((r) => r.title.includes("공급망안정화기금 소개"))).toBe(false);
    expect(rows.some((r) => r.title.includes("KOAFEC 참가 안내") && r.dateText === "")).toBe(false);
    // 기준 시각을 옮기면 판정도 따라 움직인다 — 나이를 실제로 본다는 증거.
    expect(parseKoreaeximList(p1, 1, Date.parse("2024-01-01T00:00:00Z")).length).toBeGreaterThan(rows.length);
  });

  it("일반 행(순번 칸이 있는 줄)은 등록일을 「등록일 ~」 개시형으로 싣는다", () => {
    const dated = rows.filter((r) => r.dateText !== "");
    expect(dated.length).toBeGreaterThan(0);
    expect(dated.every((r) => /^20\d{2}-\d{2}-\d{2} ~$/.test(r.dateText))).toBe(true);
    expect(dated[0].title).toContain("EDCF 아카데미");
    expect(dated[0].dateText).toBe("2026-09-01 ~");
  });
});

describe("거르개 — 버릴 것만 지정한다", () => {
  it("실측에 있던 공고 아닌 글을 버린다", () => {
    for (const t of [
      "2024년 공공기관 종합청렴도 평가 관련 개인정보 제3자 제공사항 알림",
      "한국수출입은행 해외투자통계 대국민 포털 사이트 일시중단 안내",
      "2026년 「한국의 개발협력」 원고 모집(2차)",
      "공공기관 AI 활용 국민제안 접수",
      "EDCF 중기운용방향('26~'28년)",
    ]) {
      expect(isKoreaeximDropTitle(t), t).toBe(true);
    }
  });

  it("★출자사업은 버리지 않는다 — 「수집은 넓게, 걸러내기는 회사별 매칭에서」", () => {
    for (const t of [
      "한국수출입은행 2026년 하반기 중소벤처 초혁신 성장펀드 출자사업 공고",
      "「2026년 사업타당성조사 지원사업」 모집 공고",
      "한국수출입은행 2026년 제1차 기업 맞춤형 전문컨설팅 지원사업 모집 공고",
      "2026년 한국수출입은행 스마트제조혁신컨설팅 지원사업 설명회 개최 안내",
      // ★「채용」을 통째로 버리면 고용보조금이 죽는다(cwip 에서 겪음)
      "청년 채용 지원금 참여기업 모집",
    ]) {
      expect(isKoreaeximDropTitle(t), t).toBe(false);
    }
  });
});

describe("설정", () => {
  it("쪽넘김은 curPage 다", () => {
    expect(koreaeximConfig.list.url(2)).toContain("curPage=2");
  });

  it("★상세 주소의 curPage 는 엔진이 알아서 떼어 낸다 — 안 떼면 같은 글이 쪽마다 다른 주소가 된다", () => {
    // 엔진은 url(1)·url(2) 를 비교해 「값이 달라지는 변수」를 쪽 번호로 본다.
    expect(pagingParamsOf(koreaeximConfig)).toContain("curPage");
  });

  it("상세 주소 호스트가 baseUrl 과 같다", () => {
    expect(new URL(rows[0].detailUrl).host).toBe(new URL(koreaeximConfig.baseUrl).host);
  });

  it("한 쪽이 591KB 로 무거워 얕게 둔다", () => {
    expect(koreaeximConfig.list.maxPages).toBeLessThanOrEqual(3);
  });
});

/** ★판정기를 망가뜨려 본다 — 안 하면 위 시험들이 「그냥 통과하는 글」일 뿐이다. */
describe("망가뜨려 보기", () => {
  it("행 껍데기 이름이 바뀌면 한 줄도 못 읽는다", () => {
    expect(parseKoreaeximList(p1.replaceAll("notice-list-item", "notice-list-item-x"), 1, NOW)).toHaveLength(0);
  });

  it("제목 칸(span.subject)이 바뀌면 한 줄도 못 읽는다", () => {
    expect(parseKoreaeximList(p1.replaceAll('class="subject"', 'class="subject-x"'), 1, NOW)).toHaveLength(0);
  });

  it("★공지 표시가 사라지면 붙박이가 「날짜 있음」으로 바뀐다 — 판정이 실제로 그 표시를 본다는 증거", () => {
    const broken = parseKoreaeximList(p1.replaceAll('title="공지"', 'title="공지x"'), 1, NOW);
    expect(broken.filter((r) => r.dateText === "")).toHaveLength(0);
  });

  it("작성일 칸이 사라지면 날짜를 비운다(오늘 날짜를 지어내지 않는다)", () => {
    expect(parseKoreaeximList(p1.replaceAll('title="작성일"', 'title="작성일x"'), 1, NOW).every((r) => r.dateText === "")).toBe(true);
  });
});

/** ★상세 본문·첨부 자리 — 고정본 `/HPHKBI039M01/115163` 으로 잰다. */
describe("상세 본문·첨부 자리", () => {
  const doc = parseHtml(readFileSync(join(__dirname, "../__fixtures__/koreaexim-detail.html"), "utf-8"));

  it("본문 선택자가 실제 고정본에서 공고 글을 잡는다", () => {
    const body = doc.querySelector(koreaeximConfig.detailContentSelector!);
    expect(body).not.toBeNull();
    expect(body!.text.replace(/\s+/g, " ")).toContain("사업타당성조사");
    expect(body!.querySelectorAll("script")).toHaveLength(0);
  });

  it("첨부 범위 안에 내려받기 통로가 있다", () => {
    const scope = doc.querySelector(koreaeximConfig.attachmentsScopeSelector!)!;
    const files = scope.querySelectorAll("a[href]").map((a) => a.getAttribute("href") ?? "")
      .filter((h) => h.includes("getFile"));
    expect(files.length).toBeGreaterThan(0);
  });
});
