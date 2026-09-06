import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isGbsaDropTitle, parseGbsaList, gbsaConfig } from "./gbsa";

/**
 * ★손으로 쓴 HTML 대신 **실사이트 고정본**으로 잰다.
 * 지어낸 HTML 로 시험하면 선택자 오타가 그대로 통과한다(창원 사고).
 * 고정본: 2026-09-03 실측 `www.gbsa.or.kr/board/notice.do` 1·2쪽(브라우저 UA 로 받은 응답 그대로).
 */
const listHtml = readFileSync(join(__dirname, "../__fixtures__/gbsa-list.html"), "utf-8");
const listP2Html = readFileSync(join(__dirname, "../__fixtures__/gbsa-list-p2.html"), "utf-8");
const rows = parseGbsaList(listHtml);
const rowsP2 = parseGbsaList(listP2Html, 2);
const combined = [...rows, ...rowsP2];

describe("경기도경제과학진흥원 공지사항 목록 읽기 — 실사이트 고정본", () => {
  it("1쪽 10줄에서 행정공지(DROP)를 뺀 5건을 읽고 첫 행이 맞다", () => {
    expect(rows).toHaveLength(5);
    expect(rows[0]).toMatchObject({
      title:
        "2026년 창업기업 오프라인 팝업스토어 및 기획전 입점 기업 모집 공고 (성수동 일대 진행 예정)",
      detailUrl: "https://www.gbsa.or.kr/board/notice.do?nttId=11583",
      dateText: "2026-08-05 ~",
      agency: "경기도경제과학진흥원",
    });
  });

  it("★상세 주소에 쪽 번호를 넣지 않는다 — 넣으면 같은 글이 쪽마다 다른 줄이 된다", () => {
    // 고정본 href 에는 `&pageIndex=1`/`&pageIndex=2` 가 실제로 붙어 있다(그대로 쓰면 안 된다).
    expect(listHtml).toContain("pageIndex=1");
    expect(listP2Html).toContain("pageIndex=2");
    expect(combined.every((r) => !/[?&]pageIndex=/.test(r.detailUrl))).toBe(true);
    expect(combined.every((r) => !/searchCnd|searchWrd/.test(r.detailUrl))).toBe(true);
  });

  it("일반 행은 등록일을 개시형(YYYY-MM-DD ~)으로 넘긴다", () => {
    expect(combined.length).toBeGreaterThan(0);
    for (const r of combined) expect(r.dateText).toMatch(/^\d{4}-\d{2}-\d{2} ~$/);
  });

  it("1쪽+2쪽을 합쳐 파싱해도 상세 열쇠 중복이 없다", () => {
    const urls = combined.map((r) => r.detailUrl);
    expect(new Set(urls).size).toBe(urls.length);
    expect(combined).toHaveLength(12);
  });

  it("2쪽 첫 행이 1쪽과 다르다 — pageIndex= 가 진짜 먹는다", () => {
    expect(rowsP2).toHaveLength(7);
    expect(rowsP2[0]).toMatchObject({
      title: "2026년 광명형 혁신스타트업 스케일업 액셀러레이팅",
      detailUrl: "https://www.gbsa.or.kr/board/notice.do?nttId=11256",
      dateText: "2026-05-06 ~",
    });
    expect(rowsP2[0].detailUrl).not.toBe(rows[0].detailUrl);
  });

  it("DROP 거르개가 실측 행정공지를 실제로 버린다", () => {
    const titles = combined.map((r) => r.title);
    expect(titles.some((t) => t.includes("평가위원"))).toBe(false);
    expect(titles.some((t) => t.includes("공시송달"))).toBe(false);
    expect(titles.some((t) => t.includes("청렴도"))).toBe(false);
    expect(titles.some((t) => t.includes("수행사"))).toBe(false);
    expect(titles.some((t) => t.includes("컨설턴트 모집"))).toBe(false);
    expect(titles.some((t) => t.includes("영향평가 결과서"))).toBe(false);
    expect(isGbsaDropTitle("GBSA 제안서 평가위원(후보자) Pool 모집")).toBe(true);
    expect(isGbsaDropTitle("정보공개(공개, 정보부존재) 결정통지 공시송달 공고")).toBe(true);
    expect(
      isGbsaDropTitle("경기도 공직유관단체 종합청렴도 평가 관련 개인정보 제3자 제공사항 알림 공고"),
    ).toBe(true);
    expect(isGbsaDropTitle("2026 지방강소기업 육성 프로젝트 통합홍보 수행사 모집 공고")).toBe(true);
    expect(isGbsaDropTitle("경기도 규제샌드박스 컨설턴트 모집공고")).toBe(true);
    expect(
      isGbsaDropTitle("「GBSA 기업성장플러스 구축」소프트웨어사업 영향평가 결과서"),
    ).toBe(true);
  });

  it("「채용」을 통째로 버리지 않는다 — 채용 지원사업이 죽으면 안 된다", () => {
    expect(isGbsaDropTitle("청년 채용 지원금 참여기업 모집 공고")).toBe(false);
    expect(isGbsaDropTitle("2026년 중장년 인턴캠프")).toBe(false);
    // 지원사업 쪽은 살아 있어야 한다.
    expect(combined.some((r) => r.title.includes("입주기업 모집"))).toBe(true);
    expect(combined.some((r) => r.title.includes("인턴캠프"))).toBe(true);
  });

  it("날짜는 칸에서만 집는다 — 행 전체 글자면 번호·조회수와 붙는다", () => {
    const r = rows.find((x) => x.detailUrl.includes("nttId=11583"));
    expect(r?.dateText).toBe("2026-08-05 ~");
    // 번호 676 · 조회수 719 가 날짜에 섞이면 안 된다.
    expect(r?.dateText).not.toMatch(/676/);
    expect(r?.dateText).not.toMatch(/719/);
  });

  it("제목 칸이 날짜처럼 생겨도 등록일 칸을 집는다 — 「칸 단위」가 진짜로 일한다", () => {
    // 제목 칸을 통째로 날짜 모양으로 바꾼 실사이트 고정본. 제목 칸을 안 걸러내면
    // 첫 번째로 걸리는 「날짜인 칸」이 제목이 되어 등록일이 2020-01-01 로 뒤바뀐다.
    const fake = listHtml.replace(
      "2026년 창업기업 오프라인 팝업스토어 및 기획전 입점 기업 모집 공고 (성수동 일대 진행 예정)",
      "2020-01-01",
    );
    const r = parseGbsaList(fake).find((x) => x.detailUrl.includes("nttId=11583"));
    expect(r?.title).toBe("2020-01-01");
    expect(r?.dateText).toBe("2026-08-05 ~");
  });

  it("마감 딱지가 붙은 지원사업은 그대로 담는다 — 제목만 보고 버리지 않는다", () => {
    expect(combined.some((r) => r.title === "경기R&DB센터, 광교비즈니스센터 입주기업 모집 [마감]")).toBe(
      true,
    );
  });
});

describe("붙박이 공지 처리", () => {
  // 번호 칸을 「공지」로 바꾼 실사이트 고정본 — 이 게시판은 붙박이 표식이 주석 처리돼 있어
  // 지금 1쪽엔 붙박이가 없다. 표식이 살아났을 때를 대비한 갈래를 실제로 재 본다.
  const pinnedHtml = listHtml.replace("676", "공지");

  it("붙박이 행은 등록일을 개시일로 넘기지 않는다(빈 값)", () => {
    const r = parseGbsaList(pinnedHtml, 1, Date.parse("2026-09-03T00:00:00Z")).find((x) =>
      x.detailUrl.includes("nttId=11583"),
    );
    expect(r?.dateText).toBe("");
  });

  it("1년 넘게 붙어 있는 붙박이는 아예 담지 않는다", () => {
    const late = parseGbsaList(pinnedHtml, 1, Date.parse("2027-09-03T00:00:00Z"));
    expect(late.some((x) => x.detailUrl.includes("nttId=11583"))).toBe(false);
    // 일반 행은 그대로 남는다 — 붙박이만 버린다.
    expect(late.some((x) => x.detailUrl.includes("nttId=11572"))).toBe(true);
  });
});

describe("경기도경제과학진흥원 설정", () => {
  it("쪽넘김은 GET pageIndex", () => {
    expect(gbsaConfig.list.url(1)).toBe("https://www.gbsa.or.kr/board/notice.do?pageIndex=1");
    expect(gbsaConfig.list.url(2)).toBe("https://www.gbsa.or.kr/board/notice.do?pageIndex=2");
    expect(gbsaConfig.list.maxPages).toBe(10);
  });

  it("지역은 경기", () => {
    expect(gbsaConfig.id).toBe("gbsa");
    expect(gbsaConfig.region).toBe("경기");
    expect(gbsaConfig.agency).toBe("경기도경제과학진흥원");
    expect(gbsaConfig.label).toBe("경기도경제과학진흥원");
  });

  it("서식 변경 감지가 살아 있다 — 1은 검사를 끈 것과 같다", () => {
    expect(gbsaConfig.expectMinRows).toBeGreaterThanOrEqual(2);
    expect(gbsaConfig.expectMinRows).toBeLessThanOrEqual(rows.length);
  });

  it("설정한 본문 선택자가 실제 상세에 있는 칸이다", () => {
    expect(gbsaConfig.detailContentSelector).toBe("div#bbs_cn");
  });
});

/**
 * ★판정기를 망가뜨려 본다 — 안 하면 위 시험들이 「그냥 통과하는 글」일 뿐이다.
 */
describe("망가뜨려 보기", () => {
  it("행 선택자가 한 글자 틀리면 0행이다", () => {
    expect(parseGbsaList(listHtml.replaceAll("bbs-list", "bbs-list-x"))).toHaveLength(0);
    expect(parseGbsaList(listHtml.replaceAll("tbl-basic", "tbl-basic-x"))).toHaveLength(0);
  });

  it("제목 칸(td.align_left)이 바뀌면 한 줄도 못 읽는다", () => {
    expect(parseGbsaList(listHtml.replaceAll('class="align_left"', 'class="align_left-x"'))).toHaveLength(
      0,
    );
  });

  it("상세 번호(nttId)가 사라지면 한 줄도 담지 않는다", () => {
    expect(parseGbsaList(listHtml.replaceAll("nttId=", "nttIdX="))).toHaveLength(0);
  });

  it("등록일 칸이 비면 날짜를 지어내지 않고 빈 값으로 둔다", () => {
    const noDate = parseGbsaList(listHtml.replace(/20\d\d-\d\d-\d\d/g, ""));
    expect(noDate).toHaveLength(5);
    expect(noDate.every((r) => r.dateText === "")).toBe(true);
  });
});
