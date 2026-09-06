import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isKiatDropTitle, parseKiatList, kiatConfig } from "./kiat";

/**
 * ★손으로 쓴 HTML 대신 **실사이트 고정본**으로 잰다.
 * 창원 사고: 지어낸 HTML 로 시험하면 선택자 오타가 그대로 통과한다.
 * 고정본: 2026-09-03 실측 `boardContentsListAjax.do`(board_id=90) 1·2쪽 응답 그대로.
 */
const listHtml = readFileSync(join(__dirname, "../__fixtures__/kiat-list.html"), "utf-8");
const listP2Html = readFileSync(join(__dirname, "../__fixtures__/kiat-list-p2.html"), "utf-8");
const rows = parseKiatList(listHtml);
const rowsP2 = parseKiatList(listP2Html);
const combined = [...rows, ...rowsP2];

const MENU = "b159c9dac684471b87256f1e25404f5e";
const view = (id: string) =>
  `https://www.kiat.or.kr/front/board/boardContentsView.do?contents_id=${id}&board_id=90&MenuId=${MENU}&mode=W`;

describe("한국산업기술진흥원(KIAT) 사업공고 목록 읽기 — 실사이트 고정본", () => {
  it("1쪽 15줄을 읽고 첫 행이 맞다", () => {
    expect(rows).toHaveLength(15);
    expect(rows[0]).toMatchObject({
      title: "2026년도 자동차부품 순환경제 혁신 인프라 구축 사업 시행계획 공고",
      detailUrl: view("86e5fd4913e24657a19181b81fac350c"),
      dateText: "2026-08-28 ~ 2026-09-28",
      agency: "한국산업기술진흥원",
    });
  });

  it("★상세 주소는 contentsView 의 32자리 열쇠로 조립하고 쪽 번호를 넣지 않는다", () => {
    for (const r of combined) {
      expect(r.detailUrl).toMatch(
        /^https:\/\/www\.kiat\.or\.kr\/front\/board\/boardContentsView\.do\?contents_id=[a-f0-9]{32}&board_id=90&MenuId=[a-f0-9]{32}&mode=W$/,
      );
      // 쪽 번호가 섞이면 같은 글이 쪽마다 다른 줄로 저장된다.
      expect(r.detailUrl).not.toMatch(/miv_pageNo|[?&]page=/);
    }
    // 2쪽으로 파싱해도 열쇠가 달라지지 않는다.
    expect(parseKiatList(listHtml, 2)[0].detailUrl).toBe(rows[0].detailUrl);
  });

  it("접수기간 칸에서 「시작 ~ 끝」을 만든다 — 15/15 전부", () => {
    expect(rows).toHaveLength(15);
    for (const r of rows) expect(r.dateText).toMatch(/^\d{4}-\d{2}-\d{2} ~ \d{4}-\d{2}-\d{2}$/);
  });

  it("공고일이 접수 시작일보다 뒤인 행도 접수기간을 그대로 쓴다 — 공고일로 바꿔치지 않는다", () => {
    // 실측: 「국가첨단전략산업 소부장 … 수정 공고」는 공고일 2026-08-21, 접수 2026-07-23~2026-09-18.
    const r = rows.find((x) => x.detailUrl.includes("d39706d203fc4030871cc35c243ed881"));
    expect(r?.dateText).toBe("2026-07-23 ~ 2026-09-18");
  });

  it("1쪽+2쪽을 합쳐 파싱해도 상세 열쇠 중복이 없다", () => {
    expect(combined).toHaveLength(30);
    const urls = combined.map((r) => r.detailUrl);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it("2쪽 첫 행이 1쪽과 다르다 — miv_pageNo 가 진짜 먹는다", () => {
    expect(rowsP2[0]).toMatchObject({
      title: "2026년 첨단분야 인턴십 지원사업 3차 공고",
      detailUrl: view("a01dea628353413dbf7da67285ad26b2"),
      dateText: "2026-07-15 ~ 2026-08-12",
    });
    expect(rowsP2[0].detailUrl).not.toBe(rows[0].detailUrl);
  });

  it("날짜는 접수기간 칸에서만 집는다 — 번호·조회수와 붙지 않는다", () => {
    // 행 전체 글자에서 찾으면 번호 「2598」이 날짜 앞에 붙어 「25982026-08-28」이 된다(hsbiz 실측 함정).
    expect(rows[0].dateText).toBe("2026-08-28 ~ 2026-09-28");
    expect(rows[0].dateText).not.toMatch(/2598/);
    expect(combined.every((r) => !/\d{5}/.test(r.dateText))).toBe(true);
  });
});

describe("지원사업이 아닌 글 거르개", () => {
  it("입찰·평가위원·합격자·직원 채용 공고를 버린다", () => {
    expect(isKiatDropTitle("2026년 KIAT 사옥 통합경비 용역 입찰 공고")).toBe(true);
    expect(isKiatDropTitle("2026년도 산업기술혁신사업 평가위원 모집 공고")).toBe(true);
    expect(isKiatDropTitle("2026년 상반기 신규 직원 채용 공고")).toBe(true);
    expect(isKiatDropTitle("2026년도 체험형 인턴 최종 합격자 발표")).toBe(true);
    expect(isKiatDropTitle("기술나눔 사업 만족도 설문조사 안내")).toBe(true);
  });

  it("★「채용」을 통째로 버리지 않는다 — 채용 지원사업이 죽으면 안 된다", () => {
    expect(isKiatDropTitle("청년 채용 지원사업 참여기업 모집 공고")).toBe(false);
    expect(isKiatDropTitle("2026년 첨단분야 인턴십 지원사업 3차 공고")).toBe(false);
    // 「수요조사」는 설문이 아니다 — 기업이 실제로 신청하는 사전 수요조사다.
    expect(isKiatDropTitle("제조 AX 설비 구축지원 사업 수요조사(수정)")).toBe(false);
    expect(rowsP2.some((r) => r.title.includes("인턴십"))).toBe(true);
    expect(combined.some((r) => r.title.includes("수요조사") || r.title.includes("수요 조사"))).toBe(true);
  });

  it("고정본 30건은 하나도 안 버린다 — 실제 KIAT 목록엔 버릴 글이 없다(2026-09-03 실측)", () => {
    expect(combined.map((r) => r.title).filter(isKiatDropTitle)).toEqual([]);
  });

  it("★거르개가 parse 에 실제로 물려 있다 — 고정본 제목 한 줄을 평가위원 글로 바꾸면 그 줄이 빠진다", () => {
    const mutated = listHtml.replace(
      "산업융합 기획형 규제샌드박스 후보사업자 모집 공고",
      "산업융합 기획형 규제샌드박스 평가위원 모집 공고",
    );
    expect(mutated).not.toBe(listHtml);
    const got = parseKiatList(mutated);
    expect(got).toHaveLength(14);
    expect(got.some((r) => r.title.includes("평가위원"))).toBe(false);
  });
});

describe("한국산업기술진흥원 설정", () => {
  it("목록은 POST AJAX 통로 — 주소는 쪽과 무관하고 쪽 번호는 본문이 나른다", () => {
    expect(kiatConfig.list.url(1)).toBe("https://www.kiat.or.kr/front/board/boardContentsListAjax.do");
    expect(kiatConfig.list.url(3)).toBe(kiatConfig.list.url(1));
    const init1 = kiatConfig.list.init?.(1);
    const init3 = kiatConfig.list.init?.(3);
    expect(init1?.method).toBe("POST");
    expect(init1?.headers?.["Content-Type"]).toMatch(/application\/x-www-form-urlencoded/);
    expect(init1?.body).toContain("miv_pageNo=1");
    expect(init3?.body).toContain("miv_pageNo=3");
    // 게시판·메뉴 열쇠가 빠지면 서버가 다른 게시판을 준다.
    expect(init1?.body).toContain("board_id=90");
    expect(init1?.body).toContain(`MenuId=${MENU}`);
    expect(kiatConfig.list.maxPages).toBe(10);
  });

  it("기관·지역·열쇠", () => {
    expect(kiatConfig.id).toBe("kiat");
    expect(kiatConfig.agency).toBe("한국산업기술진흥원");
    expect(kiatConfig.region).toBe("전국");
    expect(kiatConfig.charset).toBe("utf-8");
  });

  it("★첨부 호스트 k-pass.kr 을 명부에 적는다 — 안 적으면 공고문 첨부가 통째로 차단된다", () => {
    // 실측: 상세 3건 중 2건의 첨부가 https://k-pass.kr/cmm/ifsFileDown.do 로 나간다.
    expect(kiatConfig.allowedHosts).toContain("k-pass.kr");
  });

  it("상세 본문·첨부 범위 선택자가 실측값이다", () => {
    expect(kiatConfig.detailContentSelector).toBe("div.viewTypeA_contents");
    expect(kiatConfig.attachmentsScopeSelector).toBe("div.view_area");
  });

  it("서식 변경 감지가 살아 있다 — 1은 검사를 끈 것과 같다", () => {
    expect(kiatConfig.expectMinRows).toBeGreaterThanOrEqual(2);
    expect(kiatConfig.expectMinRows).toBeLessThanOrEqual(15);
  });
});

/**
 * ★판정기를 망가뜨려 본다 — 안 하면 위 시험들이 「그냥 통과하는 글」일 뿐이다.
 */
describe("망가뜨려 보기", () => {
  it("행 선택자가 한 글자 틀리면 0행이다", () => {
    expect(parseKiatList(listHtml.replaceAll("listTypeA", "listTypeA-x"))).toHaveLength(0);
  });

  it("제목 칸(td_title)이 바뀌면 한 줄도 못 읽는다", () => {
    expect(parseKiatList(listHtml.replaceAll("td_title", "td_title-x"))).toHaveLength(0);
  });

  it("상세 열쇠를 부르는 함수 이름이 바뀌면 한 줄도 못 읽는다 — 주소를 지어내지 않는다", () => {
    expect(parseKiatList(listHtml.replaceAll("contentsView(", "contentsViewX("))).toHaveLength(0);
  });

  it("접수기간 칸이 사라지면 공고일 개시형으로 물러난다(오늘 날짜를 지어내지 않는다)", () => {
    const got = parseKiatList(listHtml.replaceAll("td_app_term", "td_app_term-x"));
    expect(got).toHaveLength(15);
    expect(got[0].dateText).toBe("2026-08-28 ~");
    for (const r of got) expect(r.dateText).toMatch(/^\d{4}-\d{2}-\d{2} ~$/);
  });

  it("공고일 칸까지 사라지면 날짜를 비운다 — 지어내지 않는다", () => {
    const got = parseKiatList(
      listHtml.replaceAll("td_app_term", "td_app_term-x").replaceAll("td_reg_date", "td_reg_date-x"),
    );
    expect(got).toHaveLength(15);
    expect(got.every((r) => r.dateText === "")).toBe(true);
  });

  it("접수기간이 없고 공고일이 1년 넘은 줄은 담지 않는다 — 붙박이가 새로 「모집중」이 되는 것을 막는다", () => {
    const noTerm = listHtml.replaceAll("td_app_term", "td_app_term-x");
    const twoYearsLater = Date.parse("2028-09-03T00:00:00Z");
    expect(parseKiatList(noTerm, 1, twoYearsLater)).toHaveLength(0);
    // 접수기간이 있는 줄은 오래돼도 그대로 담는다 — 마감일이 있어 저절로 닫힌다.
    expect(parseKiatList(listHtml, 1, twoYearsLater)).toHaveLength(15);
  });
});
