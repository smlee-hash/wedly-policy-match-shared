import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isKeitiDropCategory, isKeitiDropTitle, parseKeitiList, keitiConfig } from "./keiti";

/**
 * ★손으로 쓴 HTML 대신 **실사이트 고정본**으로 잰다.
 * 창원 사고: 지어낸 HTML 로 시험하면 선택자 오타가 그대로 통과한다.
 * 고정본: 2026-09-03 실측 `List.do?cbIdx=277`(공지/공고 전체) 1·2쪽.
 */
const listHtml = readFileSync(join(__dirname, "../__fixtures__/keiti-list.html"), "utf-8");
const listP2Html = readFileSync(join(__dirname, "../__fixtures__/keiti-list-p2.html"), "utf-8");
const rows = parseKeitiList(listHtml);
const rowsP2 = parseKeitiList(listP2Html);
const combined = [...rows, ...rowsP2];

describe("한국환경산업기술원 공지/공고 목록 읽기 — 실사이트 고정본", () => {
  it("1쪽 10줄에서 DROP 을 뺀 3건을 읽고 첫 행이 맞다", () => {
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      title: "제42회 ESG ON 세미나 개최 안내('26.9.16.(수), 15:00 ~ 16:30)",
      detailUrl: "https://www.keiti.re.kr/site/keiti/ex/board/View.do?cbIdx=277&bcIdx=40954",
      dateText: "2026-09-01 ~",
      agency: "한국환경산업기술원",
    });
  });

  it("★상세 주소에 쪽 번호를 넣지 않는다 — 넣으면 같은 글이 쪽마다 다른 줄이 된다", () => {
    expect(combined.every((r) => !/[?&]pageIndex=/.test(r.detailUrl))).toBe(true);
    expect(combined.every((r) => /^https:\/\/www\.keiti\.re\.kr\/site\/keiti\/ex\/board\/View\.do\?cbIdx=277&bcIdx=\d+$/.test(r.detailUrl))).toBe(true);
  });

  it("일반 행은 등록일을 개시형으로 넘긴다", () => {
    expect(rows.length).toBeGreaterThan(0);
    for (const r of combined) expect(r.dateText).toMatch(/^\d{4}-\d{2}-\d{2} ~$/);
  });

  it("1쪽+2쪽을 합쳐 파싱해도 상세 열쇠 중복이 없다", () => {
    const urls = combined.map((r) => r.detailUrl);
    expect(new Set(urls).size).toBe(urls.length);
    expect(combined).toHaveLength(5);
  });

  it("2쪽 첫 행이 1쪽과 다르다 — pageIndex= 가 진짜 먹는다", () => {
    expect(rowsP2).toHaveLength(2);
    expect(rowsP2[0]).toMatchObject({
      title: "2026년 재활용환경성평가 일반교육(2차) 교육생 모집 안내",
      detailUrl: "https://www.keiti.re.kr/site/keiti/ex/board/View.do?cbIdx=277&bcIdx=40915",
      dateText: "2026-08-21 ~",
    });
    expect(rowsP2[0].detailUrl).not.toBe(rows[0].detailUrl);
  });

  it("칸 딱지가 입찰·채용·공시송달인 행은 통째로 버린다 — 실측 70건이 모두 조달·기관 내부 글", () => {
    expect(isKeitiDropCategory("입찰")).toBe(true);
    expect(isKeitiDropCategory("채용")).toBe(true);
    expect(isKeitiDropCategory("공시송달")).toBe(true);
    expect(isKeitiDropCategory("공지")).toBe(false);
    // 1쪽 10줄 중 5줄이 입찰 딱지였다 — 한 줄도 안 남아야 한다.
    expect(combined.some((r) => r.title.includes("기술평가결과"))).toBe(false);
  });

  it("DROP 거르개가 실측 제목을 실제로 버린다", () => {
    const titles = combined.map((r) => r.title);
    expect(titles.some((t) => t.includes("신청내용 공고"))).toBe(false);
    expect(titles.some((t) => t.includes("국민평가단"))).toBe(false);
    expect(titles.some((t) => t.includes("행사취소"))).toBe(false);
    expect(titles.some((t) => t.includes("개인정보 제3자"))).toBe(false);
    expect(isKeitiDropTitle("신기술인증 및 기술검증 신청내용 공고 [금호건설(주)]")).toBe(true);
    expect(isKeitiDropTitle("[기술평가결과]지속가능성 공시 적용 사례 연구 용역 기술평가 결과 알림")).toBe(true);
    expect(isKeitiDropTitle("「2026 기후에너지환경창업대전」 국민평가단 모집 안내")).toBe(true);
    expect(isKeitiDropTitle("중소기업기술마켓 카드뉴스 제 4호(7월호, 26.7.30)")).toBe(true);
    expect(isKeitiDropTitle("2026년 환경영향평가사 제28회 필기시험 원서접수 안내")).toBe(true);
  });

  it("★기업이 신청하는 글은 남긴다 — 지원사업·참여기업 모집·교육생 모집·시상 공모", () => {
    expect(isKeitiDropTitle("2026년도 제8차 미래환경산업육성융자(온실가스배출저감설비자금) 지원사업 공고")).toBe(false);
    expect(isKeitiDropTitle("UNFCCC COP31 한국홍보관 부대행사 및 기술전시ㆍ홍보 참여기업 모집 공고")).toBe(false);
    expect(isKeitiDropTitle("「2026년 녹색자산유동화증권 이차보전 지원사업」(신보5차) 공고")).toBe(false);
    expect(combined.some((r) => r.title.includes("녹색금융 우수기업 시상"))).toBe(true);
    expect(combined.some((r) => r.title.includes("교육생 모집"))).toBe(true);
  });

  it("「채용」을 통째로 버리지 않는다 — 채용 지원사업이 죽으면 안 된다", () => {
    expect(isKeitiDropTitle("청년 채용 지원금 참여기업 모집 공고")).toBe(false);
    expect(isKeitiDropTitle("2026년도 제2차 한국환경산업기술원 신규직원 채용 공고")).toBe(false);
  });

  it("날짜는 span.date 칸에서만 집는다 — 행 전체 글자면 딱지·제목과 붙는다", () => {
    const r = rows.find((x) => x.detailUrl.includes("bcIdx=40921"));
    expect(r?.dateText).toBe("2026-08-24 ~");
    expect(r?.dateText).not.toMatch(/공지/);
    expect(r?.dateText).not.toMatch(/시상/);
  });
});

describe("한국환경산업기술원 설정", () => {
  it("쪽넘김은 GET pageIndex + cbIdx=277", () => {
    expect(keitiConfig.list.url(1)).toBe(
      "https://www.keiti.re.kr/site/keiti/ex/board/List.do?cbIdx=277&pageIndex=1",
    );
    expect(keitiConfig.list.url(2)).toBe(
      "https://www.keiti.re.kr/site/keiti/ex/board/List.do?cbIdx=277&pageIndex=2",
    );
    expect(keitiConfig.list.maxPages).toBe(12);
  });

  it("지역은 전국", () => {
    expect(keitiConfig.region).toBe("전국");
    expect(keitiConfig.id).toBe("keiti");
    expect(keitiConfig.agency).toBe("한국환경산업기술원");
    expect(keitiConfig.charset).toBe("utf-8");
  });

  it("★상세 본문 선택자를 안 적는다 — 본문이 붙임 안내 한 줄이라 첨부 길을 막으면 안 된다", () => {
    expect(keitiConfig.detailContentSelector).toBeUndefined();
    expect(keitiConfig.attachmentsScopeSelector).toBe("div.info");
  });

  it("추측 단계는 끈다 — 켜면 거르개를 지나친 입찰·채용 글이 그대로 저장된다", () => {
    expect(keitiConfig.skipHeuristic).toBe(true);
  });

  it("서식 변경 감지가 살아 있다 — 1쪽 실측 3건이라 2로 둔다", () => {
    expect(keitiConfig.expectMinRows).toBe(2);
    expect(rows.length).toBeGreaterThanOrEqual(keitiConfig.expectMinRows!);
  });
});

/**
 * ★판정기를 망가뜨려 본다 — 안 하면 위 시험들이 「그냥 통과하는 글」일 뿐이다.
 */
describe("망가뜨려 보기", () => {
  it("행 선택자가 한 글자 틀리면 0행이다", () => {
    expect(parseKeitiList(listHtml.replaceAll('class="list col5"', 'class="list col5-x"'))).toHaveLength(0);
  });

  it("제목 칸(span.subject)이 바뀌면 한 줄도 못 읽는다", () => {
    expect(parseKeitiList(listHtml.replaceAll('class="subject"', 'class="subject-x"'))).toHaveLength(0);
  });

  it("상세 링크가 사라지면 한 줄도 안 담는다(제목만 저장하지 않는다)", () => {
    expect(parseKeitiList(listHtml.replaceAll("bcIdx=", "bcIdy="))).toHaveLength(0);
  });

  it("등록일 칸이 사라지면 날짜를 비운다(오늘 날짜를 지어내지 않는다)", () => {
    const broken = parseKeitiList(listHtml.replaceAll('<span class="date">', '<span class="date-x">'));
    expect(broken.length).toBeGreaterThan(0);
    expect(broken.every((r) => r.dateText === "")).toBe(true);
  });

  it("딱지 칸을 「입찰」로 바꾸면 남는 줄이 0이다 — 거르개가 진짜로 그 칸을 읽는다", () => {
    const flipped = listHtml.replace(/(<span class="cateName">\s*)공지(<\/span>)/g, "$1입찰$2");
    expect(flipped).not.toBe(listHtml);
    expect(parseKeitiList(flipped)).toHaveLength(0);
  });
});
