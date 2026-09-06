import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseHtml } from "../html";
import { gtpConfig, isGtpDropTitle, parseGtpList } from "./gtp";

/**
 * ★손으로 쓴 HTML 대신 **실사이트 고정본**으로 잰다.
 * 지어낸 HTML 로 시험하면 선택자 오타가 그대로 통과한다(창원 사고).
 * 고정본: 2026-09-03 실측 `pms.gtp.or.kr/web/business/webBusinessList.do?page=1`·`page=2`.
 */
const listHtml = readFileSync(join(__dirname, "../__fixtures__/gtp-list.html"), "utf-8");
const listP2Html = readFileSync(join(__dirname, "../__fixtures__/gtp-list-p2.html"), "utf-8");
const rows = parseGtpList(listHtml);
const rowsP2 = parseGtpList(listP2Html);
const combined = [...rows, ...rowsP2];

describe("경기테크노파크 사업공고 목록 읽기 — 실사이트 고정본", () => {
  it("1쪽 10줄을 모두 읽고 첫 행이 맞다", () => {
    expect(rows).toHaveLength(10);
    expect(rows[0]).toMatchObject({
      title:
        "경기도형 스마트공장 종합지원 「SMATEC 2026」 경기도통합관 참가기업 및 연계 컨퍼런스 발표기업 모집 통합공고",
      detailUrl: "https://pms.gtp.or.kr/web/business/webBusinessView.do?b_idx=172323",
      dateText: "2026-09-01 ~ 2026-09-21",
      agency: "경기 테크노파크",
      category: "마케팅/판로",
    });
  });

  it("★제목은 화면에 잘려 보이는 링크 글자가 아니라 title 속성 전문이다", () => {
    // 링크 글자는 「…「SM...」 처럼 잘려 온다. 잘린 제목을 저장하면 중복 판정 열쇠가 갈려
    // 기업마당의 같은 공고와 안 묶이고, 화면에도 말줄임표가 그대로 뜬다.
    expect(listHtml).toContain("경기도형 스마트공장 종합지원 「SM...");
    for (const r of rows) expect(r.title.endsWith("...")).toBe(false);
    expect(rows[0].title.length).toBeGreaterThan(40);
  });

  it("상세 주소는 No 칸이 아니라 onclick 의 b_idx 로 조립한다", () => {
    // 첫 행의 화면 번호는 1781 인데 상세 열쇠는 172323 이다 — No 를 쓰면 전부 엉뚱한 글로 간다.
    expect(listHtml).toContain("<td>1781</td>");
    expect(rows[0].detailUrl).not.toContain("1781");
    for (const r of combined) {
      expect(r.detailUrl).toMatch(
        /^https:\/\/pms\.gtp\.or\.kr\/web\/business\/webBusinessView\.do\?b_idx=\d+$/,
      );
    }
  });

  it("★상세 주소에 쪽 번호를 넣지 않는다 — 넣으면 같은 글이 쪽마다 다른 줄이 된다", () => {
    for (const r of combined) expect(r.detailUrl).not.toMatch(/[?&]page=/);
  });

  it("접수기간은 칸(td.last)에서 읽어 YYYY-MM-DD ~ YYYY-MM-DD 로 넘긴다", () => {
    for (const r of combined) expect(r.dateText).toMatch(/^20\d{2}-\d{2}-\d{2} ~ 20\d{2}-\d{2}-\d{2}$/);
    // 행 전체 글자에서 정규식으로 찾으면 앞 칸(No 1781)과 붙어 「17812026-09-01」 이 된다.
    for (const r of combined) expect(r.dateText).not.toMatch(/\d{5}/);
  });

  it("★날짜는 접수기간 칸에서만 집는다 — 다른 칸에 날짜가 섞여도 흔들리지 않는다", () => {
    // 행 전체 글자에서 찾는 구현이면 첫 번째로 걸리는 이 가짜 날짜를 접수 시작일로 삼는다.
    const noisy = listHtml.replace("<td>1781</td>", "<td>1781 2019-01-01</td>");
    expect(parseGtpList(noisy)[0].dateText).toBe("2026-09-01 ~ 2026-09-21");
  });

  it("★「마감」 행은 아예 담지 않는다 — 날짜 없이 저장하면 90일간 「모집중」으로 되살아난다", () => {
    // 실측(2026-09-03): 4쪽부터 20쪽까지 151줄 중 112줄이 날짜 대신 「마감」 한 낱말이다.
    const closed = listHtml.replace("2026-09-01 09:00 <br>~ 2026-09-21 17:00", "마감");
    const after = parseGtpList(closed);
    expect(after).toHaveLength(9);
    expect(after.some((r) => r.detailUrl.endsWith("b_idx=172323"))).toBe(false);
  });

  it("1쪽+2쪽을 합쳐도 상세 열쇠 중복이 없다", () => {
    expect(combined).toHaveLength(20);
    const urls = combined.map((r) => r.detailUrl);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it("2쪽 첫 행이 1쪽과 다르다 — page= 가 진짜 먹는다", () => {
    expect(rowsP2[0]).toMatchObject({
      title: "2026년 연천군 경기도 주택태양광[3kW] 지원사업 공고",
      detailUrl: "https://pms.gtp.or.kr/web/business/webBusinessView.do?b_idx=172223",
      dateText: "2026-04-03 ~ 2026-12-31",
      agency: "연천군",
    });
    expect(rowsP2[0].detailUrl).not.toBe(rows[0].detailUrl);
  });

  it("★기관을 경기테크노파크로 못 박지 않는다 — 주최기관 칸이 행마다 다르다", () => {
    // 못 박으면 중복 판정 열쇠(제목+기관)가 갈려, 기업마당에 원 기관명으로 든 같은 공고와
    // 안 묶여 목록에 두 줄로 뜬다(부천 bizbc 에서 겪은 그 갈래).
    const agencies = new Set(combined.map((r) => r.agency));
    expect(agencies.size).toBeGreaterThan(1);
    expect(agencies.has("경기 테크노파크")).toBe(true);
    expect(agencies.has("중소벤처기업부")).toBe(true);
    expect(agencies.has("안산시")).toBe(true);
  });

  it("주최기관 칸이 비면 기관을 비워 넘긴다(엔진이 설정값으로 채운다)", () => {
    const blanked = listHtml.replace("<td>경기 테크노파크</td>", "<td></td>");
    expect(parseGtpList(blanked)[0].agency).toBeUndefined();
  });
});

describe("경기테크노파크 DROP 거르개 — 버릴 것만 좁게", () => {
  it("입찰·평가위원·설문·합격자는 버린다", () => {
    expect(isGtpDropTitle("2026년 ○○ 구축 용역 입찰 공고")).toBe(true);
    expect(isGtpDropTitle("2026년 기술닥터사업 평가위원 모집 공고")).toBe(true);
    expect(isGtpDropTitle("경기TP 만족도 설문조사 안내")).toBe(true);
    expect(isGtpDropTitle("2026년 창업보육센터 입주기업 선정 합격자 발표")).toBe(true);
    expect(isGtpDropTitle("우선협상대상자 선정 공고")).toBe(true);
    expect(isGtpDropTitle("2026년 경기테크노파크 신규직원 채용 공고")).toBe(true);
  });

  it("★「채용 지원사업」은 버리지 않는다 — 고용보조금은 제목에 「채용」을 쓴다", () => {
    expect(isGtpDropTitle("청년 채용 지원사업 참여기업 모집 공고")).toBe(false);
    expect(isGtpDropTitle("2026년 경기도 취업 연계 지원사업 참여기업 모집 공고")).toBe(false);
  });

  it("고정본 실측 제목 20건은 한 줄도 안 버린다 — 이 게시판은 지원사업만 올린다", () => {
    for (const r of combined) expect(isGtpDropTitle(r.title)).toBe(false);
  });

  it("거르개가 목록 읽기에 실제로 걸려 있다", () => {
    const dirty = listHtml.replace(
      'title="2026년 양평군 경기도 주택태양광[3kW] 지원사업 공고"',
      'title="2026년 경기테크노파크 시설관리 용역 입찰 공고"',
    );
    const after = parseGtpList(dirty);
    expect(after).toHaveLength(9);
    expect(after.some((r) => r.title.includes("입찰"))).toBe(false);
  });
});

describe("경기테크노파크 설정", () => {
  it("쪽넘김은 GET page — 쪽마다 주소가 달라야 중복이 안 생긴다", () => {
    expect(gtpConfig.list.url(1)).toBe(
      "https://pms.gtp.or.kr/web/business/webBusinessList.do?page=1",
    );
    expect(gtpConfig.list.url(2)).toBe(
      "https://pms.gtp.or.kr/web/business/webBusinessList.do?page=2",
    );
    expect(gtpConfig.list.maxPages).toBe(10);
  });

  it("이름·지역·기본 기관이 맞다", () => {
    expect(gtpConfig.id).toBe("gtp");
    expect(gtpConfig.label).toBe("경기테크노파크");
    expect(gtpConfig.agency).toBe("경기테크노파크");
    expect(gtpConfig.region).toBe("경기");
    expect(gtpConfig.charset).toBe("utf-8");
  });

  it("★상세 본문 선택자를 일부러 비워 둔다 — 채우면 첨부 공고문을 영영 못 읽는다", () => {
    // 실측 10건 중 2건은 본문 글자가 「신청하기」 넉 자뿐이다(공고문을 그림으로 붙인 화면).
    // 넉 자라도 저장되면 「첨부에서 본문 뽑기」가 `targetText === ""` 조건에서 그 공고를 영영 건너뛴다.
    expect(gtpConfig.detailContentSelector).toBeUndefined();
    // 대신 첨부는 반드시 수확한다 — 자격조건이 거기 있다.
    expect(gtpConfig.attachmentsScopeSelector).toBe("div.txtinfor.mb20");
  });

  it("★추측 단계를 끈다 — 추측은 「마감」 줄까지 날짜 없이 담는다", () => {
    expect(gtpConfig.skipHeuristic).toBe(true);
  });

  it("서식 변경 감지가 살아 있다 — 1은 검사를 끈 것과 같다", () => {
    expect(gtpConfig.expectMinRows).toBeGreaterThanOrEqual(2);
    expect(gtpConfig.expectMinRows).toBeLessThanOrEqual(10);
  });

  it("설정의 행 선택자가 고정본에서 실제로 10줄을 잡는다", () => {
    // 설정값이 자기 자신과 같은지만 재면 오타를 못 잡는다(적대 리뷰 지적).
    const root = parseHtml(listHtml);
    expect(root.querySelectorAll(gtpConfig.list.rowSelector)).toHaveLength(10);
  });
});

/**
 * ★판정기를 망가뜨려 본다 — 안 하면 위 시험들이 「그냥 통과하는 글」일 뿐이다.
 */
describe("망가뜨려 보기", () => {
  it("표 선택자가 한 글자 틀리면 0행이다", () => {
    expect(parseGtpList(listHtml.replaceAll('class="t01 mb20"', 'class="t01x mb20"'))).toHaveLength(0);
  });

  it("제목 칸(td.subject)이 바뀌면 한 줄도 못 읽는다", () => {
    expect(parseGtpList(listHtml.replaceAll('class="subject"', 'class="subject-x"'))).toHaveLength(0);
  });

  it("접수기간 칸(td.last)이 사라지면 전부 버린다 — 오늘 날짜를 지어내지 않는다", () => {
    expect(parseGtpList(listHtml.replaceAll('td class="last"', "td class=\"last-x\""))).toHaveLength(0);
  });

  it("onclick 번호가 사라지면 그 줄을 건너뛴다", () => {
    expect(parseGtpList(listHtml.replaceAll("fn_goView(", "fn_goViewX("))).toHaveLength(0);
  });
});