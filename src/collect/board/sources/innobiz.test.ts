import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseHtml } from "../html";
import { pagingParamsOf, allowedHostsOf } from "../engine";
import { harvestBoardAttachments } from "../detail-fill";
import { innobizConfig, isInnobizDropTitle, parseInnobizList, stripInnobizWww } from "./innobiz";

/**
 * ★손으로 쓴 HTML 대신 **실사이트 고정본**으로 잰다.
 * 창원 사고: 지어낸 HTML 로 시험하면 선택자 오타가 그대로 통과한다.
 * 고정본: 2026-09-06 실측 지원정보 1쪽(`notice.asp?menuno=2`)·상세(`notice_view.asp?idx=8745`).
 */
const listHtml = readFileSync(join(__dirname, "../__fixtures__/innobiz-list.html"), "utf-8");
const detailHtml = readFileSync(join(__dirname, "../__fixtures__/innobiz-detail.html"), "utf-8");
const rows = parseInnobizList(listHtml);

const FIRST = {
  title: "WISET(여성과학기술인육성재단) ｜「2026년 과학기술분야 R&D 대체인력 활용 지원사업」4차 모집(~10/13(화))",
  detailUrl: "https://innobiz.or.kr/IB/news/notice_view.asp?idx=3634&menuno=2",
  dateText: "2026-09-04 ~",
  category: "인력",
  agency: "이노비즈협회",
} as const;

describe("이노비즈협회 지원정보 목록 읽기 — 실사이트 고정본", () => {
  it("1쪽 고정본 20행에서 거르개 뒤 13건이 남고 첫 행이 맞다", () => {
    // 머리줄까지 21 tr — td.title 이 있는 행만 담는다.
    expect(parseHtml(listHtml).querySelectorAll(innobizConfig.list.rowSelector)).toHaveLength(21);
    expect(parseHtml(listHtml).querySelectorAll("td.title")).toHaveLength(20);
    expect(rows).toHaveLength(13);
    expect(rows[0]).toMatchObject(FIRST);
  });

  it("머리줄(NO/구분/지원사업명/작성일)은 결과에 안 섞인다", () => {
    expect(rows.some((r) => r.title === "지원사업명")).toBe(false);
    expect(rows.every((r) => r.title.length > 4)).toBe(true);
  });

  it("작성일은 마지막 td 칸에서만 집어 개시형으로 싣는다 — 행 전체면 번호와 붙는다", () => {
    for (const r of rows) expect(r.dateText).toMatch(/^20\d{2}-\d{2}-\d{2} ~$/);
    expect(rows[0].dateText).toBe("2026-09-04 ~");
    expect(rows[0].dateText).not.toMatch(/3388/);
  });

  it("★상세 주소는 onClick 의 eDataView 번호로 조립한다 — a href 가 아예 없다", () => {
    expect(parseHtml(listHtml).querySelector("td.title")?.getAttribute("onClick")).toBe(
      "eDataView('3634')",
    );
    for (const r of rows) {
      expect(r.detailUrl).toMatch(
        /^https:\/\/innobiz\.or\.kr\/IB\/news\/notice_view\.asp\?idx=\d+&menuno=2$/,
      );
      expect(r.detailUrl).not.toMatch(/[?&]Page=/i);
    }
    expect(new Set(rows.map((r) => r.detailUrl)).size).toBe(rows.length);
  });

  it("쪽 주소는 GET Page(대문자 P) — url(1)·url(2) 가 쪽 변수만 다르다", () => {
    expect(innobizConfig.list.url(1)).toBe(
      "https://innobiz.or.kr/IB/news/notice.asp?Page=1&menuno=2&sfield=&stext=&status_s=&ste=&sty=&bct_s=&ord=0",
    );
    expect(innobizConfig.list.url(2)).toContain("Page=2");
    expect(pagingParamsOf(innobizConfig)).toEqual(["Page"]);
    expect(innobizConfig.list.maxPages).toBe(5);
  });

  it("구분 칸을 분류로 싣는다", () => {
    expect(rows[0].category).toBe("인력");
    expect(rows.some((r) => r.category === "판로&수출")).toBe(true);
    expect(rows.some((r) => r.category === "R&D")).toBe(true);
  });
});

/** ★인증서에 www 가 없다 — www 주소는 TLS 단계에서 죽는다(2026-09-06 curl 실측). */
describe("www 치환 — www.innobiz.or.kr 은 인증서 불일치라 못 쓴다", () => {
  it("이 파일이 만드는 주소·설정에는 www 가 한 글자도 없다", () => {
    expect(stripInnobizWww("https://www.innobiz.or.kr/IB/news/notice_view.asp?idx=3634&menuno=2")).toBe(
      "https://innobiz.or.kr/IB/news/notice_view.asp?idx=3634&menuno=2",
    );
    expect(stripInnobizWww("http://www.innobiz.or.kr/")).toBe("http://innobiz.or.kr/");
    // 다른 호스트는 손대지 않는다 — 이노비즈넷(`www.innobiz.net`)은 별개 도메인이다.
    expect(stripInnobizWww("https://www.innobiz.net/index.asp")).toBe("https://www.innobiz.net/index.asp");
    expect(stripInnobizWww("https://innobiz.or.kr.evil.com/")).toBe("https://innobiz.or.kr.evil.com/");
    expect(rows.every((r) => !r.detailUrl.includes("www."))).toBe(true);
    expect(innobizConfig.baseUrl).toBe("https://innobiz.or.kr/");
    expect(allowedHostsOf(innobizConfig)).toEqual(["innobiz.or.kr"]);
  });
});

describe("이노비즈협회 상세 — 본문·첨부", () => {
  const body = parseHtml(detailHtml)
    .querySelectorAll(innobizConfig.detailContentSelector!)
    .map((el) => el.text)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  const scoped = parseHtml(detailHtml)
    .querySelectorAll(innobizConfig.attachmentsScopeSelector!)
    .map((el) => el.outerHTML)
    .join("\n");

  it("본문 상자(section.content)에서 자격조건이 든 글자를 읽는다", () => {
    expect(body).toContain("취업애로청년을 정규직으로 신규 채용한 5인 이상 중소기업");
    expect(body).toContain("참여 대상");
    expect(body.length).toBeGreaterThan(300);
  });

  it("본문 안 정적 파일이 첨부로 잡힌다 — 이 상세는 이미지뿐이라 0건이다", () => {
    // 실측 idx=8745 본문의 유일한 파일은 `/Data/BM83/…jpg` — 그림은 첨부가 아니다.
    expect(scoped).toContain("/Data/BM83/");
    expect(harvestBoardAttachments(scoped, innobizConfig.baseUrl, detailHtml, innobizConfig.charset)).toHaveLength(0);
    // 같은 자리에 pdf 가 걸리면 그대로 집힌다(다른 글들의 실측 형태).
    const withPdf = scoped.replace(/\.jpg/g, ".pdf");
    const atts = harvestBoardAttachments(withPdf, innobizConfig.baseUrl, detailHtml, innobizConfig.charset);
    expect(atts).toHaveLength(1);
    expect(atts[0].url).toContain("https://innobiz.or.kr/Data/BM83/");
    expect(atts[0].kind).toBe("pdf");
  });
});

describe("거르개 — 버릴 것만 지정한다(포상·설문·포럼·교육·시상·유공)", () => {
  it("실측 제외 제목이 빠진다", () => {
    const titles = rows.map((r) => r.title);
    expect(titles.some((t) => t.includes("유공 포상"))).toBe(false);
    expect(titles.some((t) => t.includes("모빌리티 포럼"))).toBe(false);
    expect(titles.some((t) => t.includes("우수기업 포상"))).toBe(false);
    expect(titles.some((t) => t.includes("설문조사"))).toBe(false);
    expect(titles.some((t) => t.includes("아카데미"))).toBe(false);
    expect(titles.some((t) => t.includes("재직자 교육프로그램"))).toBe(false);
    expect(isInnobizDropTitle("「지역 중소기업 AI 활용·확산 유공 포상」 후보자 모집 공고")).toBe(true);
    expect(isInnobizDropTitle("2026 물류 & 모빌리티 포럼 (사전 등록시 무료)")).toBe(true);
    expect(isInnobizDropTitle("[지식재산처] 디자인권 침해 실태 관련 설문조사 안내")).toBe(true);
    expect(isInnobizDropTitle("[유라스텍] 유라시아 아카데미 10기 수강생 모집")).toBe(true);
    expect(isInnobizDropTitle("한국폴리텍대학 성남캠퍼스 2026년 재직자 교육프로그램")).toBe(true);
    expect(isInnobizDropTitle("[지식재산처] 2026 지식재산 주간")).toBe(true);
  });

  /**
   * ★거르개를 좁혔다(2026-09-06 적대 리뷰 보통4). 옛 `상\s*선정계획` 은
   * 「스마트공장 구축 **지원대상 선정계획** 공고」처럼 기업 대상 공고까지 죽였다.
   * 그 대가로 「올해의 여성과학기술**인상** 선정계획」은 이제 통과한다 — 낱말만으로는
   * 「대상 선정」과 「수상자 선정」을 못 가른다.
   */
  it("「지원대상 선정계획」은 살린다 — 포상·시상이 앞에 붙은 것만 버린다", () => {
    expect(isInnobizDropTitle("스마트공장 구축 지원대상 선정계획 공고")).toBe(false);
    expect(isInnobizDropTitle("2026년 우수기업 포상 선정계획 공고")).toBe(true);
    expect(isInnobizDropTitle("2026년 시상 선정계획 안내")).toBe(true);
    // 알려진 한계 — 「…인상 선정계획」은 통과한다(위 주석).
    expect(isInnobizDropTitle("2026년 제26회 올해의 여성과학기술인상 선정계획 공고")).toBe(false);
  });

  it("「주간」은 실측 제목(지식재산 주간)만 버린다 — 「주간 모집」이 함께 죽으면 안 된다", () => {
    expect(isInnobizDropTitle("2026년 상반기 주간 참여기업 모집 공고")).toBe(false);
    expect(isInnobizDropTitle("[지식재산처] 2026 지식재산 주간")).toBe(true);
  });

  it("기업 대상 지원사업은 살린다 — 「모집」·「채용」을 통째로 버리지 않는다", () => {
    expect(rows.some((r) => r.title.includes("R&D사업화 유동화회사보증"))).toBe(true);
    expect(rows.some((r) => r.title.includes("일학습병행 참여기업 모집"))).toBe(true);
    expect(rows.some((r) => r.title.includes("직무발명제도 컨설팅 지원사업"))).toBe(true);
    expect(isInnobizDropTitle("[기술보증기금] 2026년 R&D사업화 유동화회사보증 발행계획 공고")).toBe(
      false,
    );
    expect(isInnobizDropTitle("[동서울대학교] 일학습병행 참여기업 모집 안내")).toBe(false);
    expect(isInnobizDropTitle("청년 채용 지원금 참여기업 모집 공고")).toBe(false);
  });
});

describe("이노비즈협회 설정", () => {
  it("id·기관·지역·글자표가 실측과 같다", () => {
    expect(innobizConfig.id).toBe("innobiz");
    expect(innobizConfig.label).toBe("이노비즈협회");
    expect(innobizConfig.agency).toBe("이노비즈협회");
    expect(innobizConfig.region).toBe("전국");
    // 고정본 머리글이 `<meta charset="utf-8">` 이다.
    expect(innobizConfig.charset).toBe("utf-8");
  });

  it("추측 단계를 끈다 — 제목이 a href 가 아니라 onClick 이라 메뉴가 공고로 저장된다", () => {
    expect(innobizConfig.skipHeuristic).toBe(true);
  });

  it("서식 변경 감지가 살아 있다 — 1은 검사를 끈 것과 같다", () => {
    expect(innobizConfig.expectMinRows).toBeGreaterThanOrEqual(2);
    expect(rows.length).toBeGreaterThanOrEqual(innobizConfig.expectMinRows!);
  });
});

/** ★판정기를 망가뜨려 본다 — 안 하면 위 시험들이 「그냥 통과하는 글」일 뿐이다. */
describe("망가뜨려 보기", () => {
  it("표 껍데기(div.table-box.notice)가 바뀌면 한 줄도 못 읽는다", () => {
    expect(parseInnobizList(listHtml.replaceAll('class="table-box notice"', 'class="table-box-x"'))).toHaveLength(
      0,
    );
  });

  it("제목 칸(td.title)이 바뀌면 한 줄도 못 읽는다", () => {
    expect(parseInnobizList(listHtml.replaceAll('class="title text-left"', 'class="title-x"'))).toHaveLength(0);
  });

  it("eDataView 이름이 바뀌면 한 줄도 못 읽는다 — 헛주소를 지어내지 않는다", () => {
    expect(parseInnobizList(listHtml.replaceAll("eDataView(", "eDataViewX("))).toHaveLength(0);
  });
});
