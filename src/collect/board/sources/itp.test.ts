import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isItpDropTitle, parseItpList, itpConfig } from "./itp";

/**
 * ★손으로 쓴 HTML 대신 **실사이트 고정본**으로 잰다.
 * 고정본: 2026-09-03 실측 `intro.asp?tmid=13` 1쪽(GET) · 2쪽(POST `PageNum=2`).
 */
const listHtml = readFileSync(join(__dirname, "../__fixtures__/itp-list.html"), "utf-8");
const listP2Html = readFileSync(join(__dirname, "../__fixtures__/itp-list-p2.html"), "utf-8");
const rows = parseItpList(listHtml);
const rowsP2 = parseItpList(listP2Html);
const combined = [...rows, ...rowsP2];

describe("인천테크노파크 지원사업 목록 읽기 — 실사이트 고정본", () => {
  it("1쪽 10줄에서 DROP 을 뺀 9건을 읽고 첫 행이 맞다", () => {
    expect(rows).toHaveLength(9);
    expect(rows[0]).toMatchObject({
      title: "2026년 인천창업카페 런치업데이 4강 참가자 모집 안내",
      detailUrl: "https://itp.or.kr/intro.asp?tmid=13&seq=11100",
      dateText: "2026-09-01 ~",
      category: "혁신창업센터",
    });
  });

  it("2쪽 10줄에서 DROP 3건을 뺀 7건을 읽고 첫 행이 맞다", () => {
    expect(rowsP2).toHaveLength(7);
    expect(rowsP2[0]).toMatchObject({
      title: "[인천디자인교육센터]AI 브랜드 디자인 시스템 구축(전액무료/ 재직자)",
      detailUrl: "https://itp.or.kr/intro.asp?tmid=13&seq=11075",
      dateText: "2026-08-21 ~",
    });
    expect(rowsP2[0].detailUrl).not.toBe(rows[0].detailUrl);
  });

  it("★상세 주소에 쪽 번호가 안 섞인다 — 섞이면 같은 글이 쪽마다 다른 줄이 된다", () => {
    for (const r of combined) {
      expect(r.detailUrl).toMatch(/^https:\/\/itp\.or\.kr\/intro\.asp\?tmid=13&seq=\d+$/);
      expect(r.detailUrl).not.toMatch(/PageNum|[?&]page=/i);
    }
  });

  it("의사링크 fncShow('SEQ') 에서 번호만 뽑아 주소를 조립한다 — javascript: 를 그대로 안 싣는다", () => {
    expect(combined.every((r) => !/javascript:/i.test(r.detailUrl))).toBe(true);
    expect(rows.map((r) => r.detailUrl.replace(/^.*seq=/, "")).slice(0, 3)).toEqual([
      "11100",
      "11099",
      "11096",
    ]);
  });

  it("작성일만 있는 게시판이라 등록일을 개시형(`YYYY-MM-DD ~`)으로 넘긴다", () => {
    expect(combined.length).toBeGreaterThan(0);
    for (const r of combined) expect(r.dateText).toMatch(/^\d{4}-\d{2}-\d{2} ~$/);
  });

  it("날짜는 td.idWriteDateData 칸에서만 집는다 — 행 전체 글자면 번호·조회수와 붙는다", () => {
    const r = rows.find((x) => x.detailUrl.endsWith("seq=11100"));
    expect(r?.dateText).toBe("2026-09-01 ~");
    // 행 전체 글자는 「3353 혁신창업센터 … 2026-09-01 159」라 번호(3353)·조회수(159)가 붙는다.
    expect(r?.dateText).not.toMatch(/3353/);
    expect(r?.dateText).not.toMatch(/159/);
  });

  it("1쪽+2쪽을 합쳐도 상세 열쇠 중복이 없다", () => {
    const urls = combined.map((r) => r.detailUrl);
    expect(new Set(urls).size).toBe(urls.length);
    expect(combined).toHaveLength(16);
  });

  it("DROP 거르개가 실측 「사업이 아닌 글」을 실제로 버린다", () => {
    const titles = combined.map((t) => t.title);
    expect(titles.some((t) => t.includes("개소식"))).toBe(false);
    expect(titles.some((t) => t.includes("심사 결과"))).toBe(false);
    expect(titles.some((t) => t.includes("선정기업 안내"))).toBe(false);
    expect(titles.some((t) => t.includes("선정 통지"))).toBe(false);
    expect(isItpDropTitle("[혁신기술교육센터] 인천 ICT콤플렉스 개소식 개최 안내(8/25)")).toBe(true);
    expect(isItpDropTitle("「2026 인천공공디자인 공모전」 1차 심사 결과(입상작) 발표")).toBe(true);
    expect(isItpDropTitle("2026 콘텐츠 제작 프로젝트 지원사업 최종 선정기업 안내")).toBe(true);
    expect(
      isItpDropTitle("[콘텐츠기업지원센터]2026 글로벌 실증 파트너십 지원(추가모집) 사업 과제 선정 통지"),
    ).toBe(true);
  });

  it("DROP 은 좁다 — 「모집 안내」·「채용 지원사업」·「통합공고」는 살아남는다", () => {
    expect(isItpDropTitle("2026년 인천창업카페 런치업데이 4강 참가자 모집 안내")).toBe(false);
    expect(isItpDropTitle("청년 채용 지원사업 참여기업 모집 공고")).toBe(false);
    expect(isItpDropTitle("2026년 기업지원사업 통합공고")).toBe(false);
    expect(rows.some((r) => r.title.includes("모집 안내"))).toBe(true);
    expect(rowsP2.some((r) => r.title.includes("통합공고"))).toBe(true);
    expect(rowsP2.some((r) => r.title.includes("중소기업육성자금"))).toBe(true);
  });

  it("행마다 기관을 바꾸지 않는다 — 중복 열쇠(제목|기관)가 갈리면 안 된다", () => {
    expect(combined.every((r) => r.agency === undefined)).toBe(true);
  });
});

describe("인천테크노파크 설정", () => {
  it("쪽넘김은 POST 본문 PageNum — 주소는 쪽과 무관하게 같다", () => {
    expect(itpConfig.list.url(1)).toBe("https://itp.or.kr/intro.asp?tmid=13");
    expect(itpConfig.list.url(2)).toBe("https://itp.or.kr/intro.asp?tmid=13");
    const p1 = itpConfig.list.init!(1);
    const p2 = itpConfig.list.init!(2);
    expect(p1.method).toBe("POST");
    expect(p1.headers?.["Content-Type"]).toBe("application/x-www-form-urlencoded");
    expect(new URLSearchParams(p1.body!).get("PageNum")).toBe("1");
    expect(new URLSearchParams(p2.body!).get("PageNum")).toBe("2");
    // 게시판 식별 hidden 값이 빠지면 서버가 1쪽으로 되돌린다(frmSearch 실측).
    expect(new URLSearchParams(p1.body!).get("tmid")).toBe("13");
    expect(new URLSearchParams(p1.body!).get("bid")).toBe("1");
    expect(new URLSearchParams(p1.body!).get("PageShowSize")).toBe("10");
    expect(p1.body).not.toBe(p2.body);
  });

  it("기본값이 맞다", () => {
    expect(itpConfig.id).toBe("itp");
    expect(itpConfig.label).toBe("인천테크노파크");
    expect(itpConfig.agency).toBe("인천테크노파크");
    expect(itpConfig.region).toBe("인천");
    expect(itpConfig.charset).toBe("utf-8");
    expect(itpConfig.baseUrl).toBe("https://itp.or.kr/");
    expect(itpConfig.list.maxPages).toBe(10);
  });

  it("서식 변경 감지가 살아 있다 — 1은 검사를 끈 것과 같다", () => {
    expect(itpConfig.expectMinRows).toBeGreaterThanOrEqual(2);
    // 한 쪽 10건의 절반. 1쪽 실측 9건이라 여유가 있다.
    expect(itpConfig.expectMinRows).toBe(5);
  });

  it("행에 첨부 링크가 없어도 heuristic 추측 단계는 막는다 — 의사링크를 공고로 저장하면 안 된다", () => {
    expect(itpConfig.skipHeuristic).toBe(true);
  });

  it("상세 본문·첨부 칸은 실측 선택자로 못 박는다", () => {
    expect(itpConfig.detailContentSelector).toBe("div.editor");
    /**
     * ★2026-09-03 고침 — 첨부는 본문 상자 **밖** `dl.view > dd.vdd` 에 있다.
     * 옛 범위(`div.editor` 하나)로는 실측 첨부가 0건이었다(`detail-fill.test.ts` 의 고정본 시험이 잰다).
     */
    expect(itpConfig.attachmentsScopeSelector).toBe("div.editor, dl.view dd.vdd");
  });
});

/**
 * ★판정기를 망가뜨려 본다 — 안 하면 위 시험들이 「그냥 통과하는 글」일 뿐이다.
 */
describe("망가뜨려 보기", () => {
  it("행 선택자가 한 글자 틀리면 0행이다", () => {
    expect(parseItpList(listHtml.replaceAll('class="list fixed"', 'class="listx fixed"'))).toHaveLength(0);
  });

  it("제목 칸(td.subject)이 바뀌면 한 줄도 못 읽는다", () => {
    expect(parseItpList(listHtml.replaceAll('class="subject"', 'class="subject-x"'))).toHaveLength(0);
  });

  it("의사링크 함수 이름이 바뀌면 한 줄도 못 읽는다 — 주소를 지어내지 않는다", () => {
    expect(parseItpList(listHtml.replaceAll("fncShow(", "fncShowX("))).toHaveLength(0);
  });

  it("작성일 칸이 사라지면 날짜를 비운다(오늘 날짜를 지어내지 않는다)", () => {
    const broken = parseItpList(listHtml.replaceAll("idWriteDateData", "idWriteDateData-x"));
    expect(broken).toHaveLength(9);
    expect(broken.every((r) => r.dateText === "")).toBe(true);
  });
});
