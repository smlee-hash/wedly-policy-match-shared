import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isPajuDropTitle, parsePajuList, pajuConfig } from "./paju";

/**
 * ★손으로 쓴 HTML 대신 **실사이트 고정본**으로 잰다(적대 리뷰 지적).
 * 창원 사고: 지어낸 HTML 로 시험하면 선택자 오타가 그대로 통과한다.
 * 고정본: 2026-09-03 실측 `BD_board.list.do?bbsCd=9052` 1·2쪽.
 */
const listHtml = readFileSync(join(__dirname, "../__fixtures__/paju-list.html"), "utf-8");
const listP2Html = readFileSync(join(__dirname, "../__fixtures__/paju-list-p2.html"), "utf-8");
const NOW = Date.parse("2026-09-03T00:00:00Z");
const rows = parsePajuList(listHtml, 1, NOW);
const p2 = parsePajuList(listP2Html, 2, NOW);
const combined = [...rows, ...p2];

describe("파주시 기업지원 공고 목록 읽기 — 실사이트 고정본", () => {
  it("1쪽 고정본에서 10건을 읽고 첫 행의 제목·상세주소·날짜가 맞다", () => {
    expect(rows).toHaveLength(10);
    expect(rows[0]).toMatchObject({
      title: "2027년 기업환경 개선사업(노동·작업환경, 소방시설) 수요조사 안내",
      detailUrl: "https://www.paju.go.kr/user/board/BD_board.view.do?bbsCd=9052&seq=20260821174932745",
      dateText: "2026-08-21 ~",
      agency: "파주시",
    });
  });

  it("등록일은 개시형 YYYY-MM-DD ~ 이다 — 마감일이 없다", () => {
    expect(rows.every((r) => /^20\d{2}-\d{2}-\d{2} ~$/.test(r.dateText))).toBe(true);
    expect(rows[1]).toMatchObject({
      title: "2026년 경기(북부)스마트공장 확산포럼 개최 안내",
      detailUrl: "https://www.paju.go.kr/user/board/BD_board.view.do?bbsCd=9052&seq=20260720114106352",
      dateText: "2026-07-20 ~",
    });
  });

  it("상세 주소는 seq 만 조립한다 — 쪽 번호가 섞이면 같은 글이 쪽마다 다른 줄이 된다", () => {
    for (const r of combined) {
      expect(r.detailUrl).toMatch(
        /^https:\/\/www\.paju\.go\.kr\/user\/board\/BD_board\.view\.do\?bbsCd=9052&seq=\d+$/,
      );
      expect(r.detailUrl).not.toMatch(/q_currPage|javascript:/i);
    }
  });

  it("2쪽 고정본은 1쪽과 다른 10건이다 — q_currPage 가 진짜 먹는다", () => {
    expect(p2).toHaveLength(10);
    expect(p2[0]).toMatchObject({
      title: "2026년 파주시 우수 공예품 개발 지원사업 공고",
      detailUrl: "https://www.paju.go.kr/user/board/BD_board.view.do?bbsCd=9052&seq=20260417110438791",
      dateText: "2026-04-17 ~",
    });
    expect(rows.map((r) => r.detailUrl)).not.toEqual(p2.map((r) => r.detailUrl));
  });

  it("1쪽과 2쪽을 합쳐도 중복이 없다", () => {
    const urls = combined.map((r) => r.detailUrl);
    expect(new Set(urls).size).toBe(urls.length);
    expect(combined).toHaveLength(20);
  });

  it("같은 글번호는 한 쪽 안에서도 한 번만 담는다", () => {
    const ids = rows.map((r) => r.detailUrl);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("거르개 — 버릴 것만 지정한다", () => {
  it("DROP 낱말 행이 빠진다 — 입찰·평가위원·채용 공고", () => {
    const planted = listHtml.replace(
      "2027년 기업환경 개선사업(노동·작업환경, 소방시설) 수요조사 안내",
      "2026년 사무용품 구매 입찰 공고",
    );
    expect(parsePajuList(planted, 1, NOW).some((r) => r.title.includes("입찰"))).toBe(false);
    expect(parsePajuList(planted, 1, NOW)).toHaveLength(9);

    const staff = listHtml.replace(
      "2026년 경기(북부)스마트공장 확산포럼 개최 안내",
      "2026년 평가위원 모집",
    );
    expect(parsePajuList(staff, 1, NOW).some((r) => r.title.includes("평가위원"))).toBe(false);

    const hire = listHtml.replace(
      "2026년 제조로봇 도입지원[도입·실증 및 고도화지원(2차)] 참가기업 모집",
      "기업지원과 직원 채용 공고",
    );
    expect(parsePajuList(hire, 1, NOW).some((r) => r.title.includes("채용 공고"))).toBe(false);
  });

  it("★「채용 지원사업」은 버리지 않는다 — 고용보조금은 제목에 「채용」을 쓴다", () => {
    expect(
      parsePajuList(
        listHtml.replace(
          "2027년 기업환경 개선사업(노동·작업환경, 소방시설) 수요조사 안내",
          "2026년 방위산업 중소기업 신규직원 채용 지원사업 참여기업 모집공고",
        ),
        1,
        NOW,
      ).some((r) => r.title.includes("채용 지원사업")),
    ).toBe(true);
    expect(isPajuDropTitle("청년 채용 지원금 참여기업 모집")).toBe(false);
    expect(isPajuDropTitle("기업지원과 직원 채용 공고")).toBe(true);
    expect(isPajuDropTitle("2026년 평가위원 모집")).toBe(true);
    expect(isPajuDropTitle("합격자 발표")).toBe(true);
  });

  it("★1년 넘게 붙어 있는 붙박이는 아예 안 담는다 — 날짜를 비우면 90일간 되살아난다", () => {
    const oldPinned = listHtml
      .replace('<td class="cell-no">249</td>', '<td class="cell-no">공지</td>')
      .replace("2026/08/21", "2023/01/01");
    const parsed = parsePajuList(oldPinned, 1, NOW);
    expect(parsed.some((r) => r.detailUrl.includes("seq=20260821174932745"))).toBe(false);
    expect(parsed).toHaveLength(9);
    // 기준 시각을 옮기면 판정도 따라 움직인다 — 나이를 실제로 본다는 증거.
    expect(
      parsePajuList(oldPinned, 1, Date.parse("2023-06-01T00:00:00Z")).some((r) =>
        r.detailUrl.includes("seq=20260821174932745"),
      ),
    ).toBe(true);
  });
});

describe("파주시 기업지원 공고 설정", () => {
  it("쪽넘김은 GET q_currPage — 쪽마다 주소가 달라야 중복이 안 생긴다", () => {
    expect(pajuConfig.list.url(1)).toContain("q_currPage=1");
    expect(pajuConfig.list.url(2)).toContain("q_currPage=2");
    expect(pajuConfig.list.url(1)).not.toBe(pajuConfig.list.url(2));
    expect(pajuConfig.list.url(1)).toContain("bbsCd=9052");
    expect(pajuConfig.list.maxPages).toBe(10);
  });

  it("지역은 경기 — 지역 조건 없이 전국에 노출되면 안 된다", () => {
    expect(pajuConfig.region).toBe("경기");
    expect(pajuConfig.id).toBe("paju");
    expect(pajuConfig.agency).toBe("파주시");
  });

  it("서식 변경 감지가 살아 있다 — 1은 검사를 끈 것과 같다", () => {
    expect(pajuConfig.expectMinRows).toBeGreaterThanOrEqual(5);
  });
});

/** ★판정기를 망가뜨려 본다 — 안 하면 위 시험들이 「그냥 통과하는 글」일 뿐이다. */
describe("망가뜨려 보기", () => {
  it("행 선택자(table tbody tr)가 바뀌면 한 줄도 못 읽는다", () => {
    expect(parsePajuList(listHtml.replaceAll("<tbody>", "<tbody-x>"), 1, NOW)).toHaveLength(0);
  });

  it("제목 칸(td.cell-subject)이 바뀌면 한 줄도 못 읽는다", () => {
    expect(parsePajuList(listHtml.replaceAll("cell-subject", "cell-subject-x"), 1, NOW)).toHaveLength(
      0,
    );
  });

  it("등록일 칸을 비우면 날짜를 지어내지 않는다", () => {
    const blank = listHtml.replace("2026/08/21", "");
    const first = parsePajuList(blank, 1, NOW)[0];
    expect(first.title).toContain("기업환경 개선사업");
    expect(first.dateText).toBe("");
  });
});
