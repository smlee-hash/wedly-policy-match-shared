import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { pagingParamsOf } from "../engine";
import { bepaConfig, isBepaDropTitle, parseBepaList } from "./bepa";

/**
 * ★손으로 쓴 HTML 대신 **실사이트 고정본**으로 잰다.
 * 창원 사고: 지어낸 HTML 로 시험하면 선택자 오타가 그대로 통과한다.
 * 고정본: 2026-09-03 실측 지역기업(no=1505) 1·2쪽 (`/kor/view.do?no=1505` · `&pageIndex=2`).
 */
const listHtml = readFileSync(join(__dirname, "../__fixtures__/bepa-list.html"), "utf-8");
const listP2Html = readFileSync(join(__dirname, "../__fixtures__/bepa-list-p2.html"), "utf-8");
const rows = parseBepaList(listHtml);
const rowsP2 = parseBepaList(listP2Html);
const combined = parseBepaList(listHtml + listP2Html);

describe("부산경제진흥원 지원사업안내 목록 읽기 — 실사이트 고정본", () => {
  it("1쪽 10줄에서 거르개를 지난 8건을 읽고 첫 행이 맞다", () => {
    expect(rows.length).toBeGreaterThanOrEqual(5);
    expect(rows.length).toBeLessThanOrEqual(10);
    expect(rows).toHaveLength(8);
    expect(rows[0]).toMatchObject({
      title: "2026 BEF 해외 무역사절기업 개별수출 지원사업 참여기업 모집",
      detailUrl: "https://bepa.kr/kor/view.do?no=1505&idx=19442&view=view",
      dateText: "2026-08-25 ~",
      agency: "부산경제진흥원",
    });
  });

  it("★상세 주소에 pageIndex·state·items 를 넣지 않는다 — 넣으면 같은 글이 쪽마다 다른 줄이 된다", () => {
    for (const r of [...rows, ...rowsP2, ...combined]) {
      expect(r.detailUrl).toMatch(/^https:\/\/bepa\.kr\/kor\/view\.do\?no=\d+&idx=\d+&view=view$/);
      expect(r.detailUrl).not.toMatch(/pageIndex/);
      expect(r.detailUrl).not.toMatch(/[?&]state=/);
      expect(r.detailUrl).not.toMatch(/[?&]items=/);
    }
  });

  it("등록일은 개시형 YYYY-MM-DD ~ 이다 — 마감일이 없다", () => {
    expect(rows.every((r) => /^20\d{2}-\d{2}-\d{2} ~$/.test(r.dateText))).toBe(true);
    expect(rowsP2.every((r) => /^20\d{2}-\d{2}-\d{2} ~$/.test(r.dateText))).toBe(true);
  });

  it("날짜는 td.date 칸에서만 집는다 — 행 전체 글자면 번호·조회수와 붙는다", () => {
    const r = rows.find((x) => x.detailUrl.includes("idx=19442"));
    expect(r?.dateText).toBe("2026-08-25 ~");
    expect(r?.dateText).not.toMatch(/2979/);
    expect(r?.dateText).not.toMatch(/957/);
  });

  it("1쪽과 2쪽을 합쳐도 중복이 없고 17건이다", () => {
    expect(rowsP2).toHaveLength(9);
    expect(rowsP2[0]).toMatchObject({
      title: "「2026 BEF 온실가스 감축활동 지원사업」 참여기업 모집공고",
      detailUrl: "https://bepa.kr/kor/view.do?no=1505&idx=19284&view=view",
      dateText: "2026-07-13 ~",
    });
    const urls = combined.map((r) => r.detailUrl);
    expect(new Set(urls).size).toBe(urls.length);
    expect(combined).toHaveLength(17);
    expect(rows.map((r) => r.detailUrl)).not.toEqual(rowsP2.map((r) => r.detailUrl));
  });

  it("DROP 거르개가 실측 제목을 실제로 버린다", () => {
    const titles = combined.map((r) => r.title);
    expect(titles.some((t) => t.includes("평가위원"))).toBe(false);
    expect(titles.some((t) => t.includes("CES 2027"))).toBe(false);
    expect(isBepaDropTitle("「CES 2027 부산관」 조성 및 운영 대행 용역 제안서 평가위원 후보자 신청 공고")).toBe(
      true,
    );
    expect(
      isBepaDropTitle(
        "부산 중소기업 외부사업 인증실적 확보를 위한 컨설팅 제안서 평가위원(후보자) 등록 신청 공고",
      ),
    ).toBe(true);
    expect(isBepaDropTitle("「 2026년 현장 라이브커머스 운영」용역 입찰 공고")).toBe(true);
    expect(isBepaDropTitle("2026년 청년정장 대여서비스 드림옷장 하반기 임시직 채용공고")).toBe(true);
    expect(
      isBepaDropTitle("2026년 청년 정장대여서비스 「드림옷장」사업하반기 임시직 최종합격자 공고"),
    ).toBe(true);
    expect(isBepaDropTitle("제4회 부산 개항 150주년 연속포럼 개최 알림")).toBe(true);
    expect(isBepaDropTitle("「부산경제진흥원 금고 지정」 재공고")).toBe(true);
    expect(isBepaDropTitle("공무원 및 공공기관 사칭 대리구매 사기범죄 주의")).toBe(true);
  });

  it("「채용」을 통째로 버리지 않는다 — 채용 지원사업은 고용보조금이다", () => {
    expect(isBepaDropTitle("청년 채용 지원금 참여기업 모집")).toBe(false);
    expect(isBepaDropTitle("직원 채용 공고")).toBe(true);
    expect(
      parseBepaList(
        listHtml.replace(
          "2026 BEF 해외 무역사절기업 개별수출 지원사업 참여기업 모집",
          "2026년 방위산업 중소기업 신규직원 채용 지원사업 참여기업 모집공고",
        ),
      ).some((r) => r.title.includes("채용 지원사업")),
    ).toBe(true);
  });

  it("제목 끝의 폭 없는 공백을 잘라낸다", () => {
    const r = rows.find((x) => x.detailUrl.includes("idx=19291"));
    expect(r?.title).toBe("「2026 BEF 창업·벤처기업 R&D 과제 지원사업」참여기업 모집공고");
    expect(r?.title).not.toMatch(/\u200b/);
  });

  it("★1년 넘게 붙어 있는 붙박이는 아예 안 담는다 — 날짜를 비우면 90일간 되살아난다", () => {
    const aged = listHtml.replace(">2979</td>", ">공지</td>").replace(">2026-08-25<", ">2024-01-01<");
    const old = parseBepaList(aged, 1, Date.parse("2026-09-03T00:00:00Z"));
    expect(old.some((r) => r.detailUrl.includes("idx=19442"))).toBe(false);
    const recentPinned = listHtml.replace(">2979</td>", ">공지</td>");
    const kept = parseBepaList(recentPinned, 1, Date.parse("2026-09-03T00:00:00Z"));
    const row = kept.find((r) => r.detailUrl.includes("idx=19442"));
    expect(row).toBeDefined();
    expect(row!.dateText).toBe("");
  });
});

describe("부산경제진흥원 설정", () => {
  it("두 쪽씩 한 바퀴 돈 뒤 각 게시판의 3쪽부터 이어 읽는다", () => {
    expect(bepaConfig.list.url(11)).toBe("https://bepa.kr/kor/view.do?no=1505&pageIndex=3");
    expect(bepaConfig.list.url(20)).toBe("https://bepa.kr/kor/view.do?no=1670&pageIndex=4");
    expect(new Set(Array.from({ length: 100 }, (_, i) => bepaConfig.list.url(i + 1))).size).toBe(100);
  });
  it("쪽넘김은 GET pageIndex · 지원사업안내 5판을 훑고 공지(1508)는 안 붙인다", () => {
    expect(bepaConfig.list.url(1)).toBe("https://bepa.kr/kor/view.do?no=1505&pageIndex=1");
    expect(bepaConfig.list.url(2)).toBe("https://bepa.kr/kor/view.do?no=1505&pageIndex=2");
    expect(bepaConfig.list.url(3)).toBe("https://bepa.kr/kor/view.do?no=1502&pageIndex=1");
    expect(bepaConfig.list.url(10)).toBe("https://bepa.kr/kor/view.do?no=1670&pageIndex=2");
    expect(bepaConfig.list.maxPages).toBe(10);
    for (let p = 1; p <= 10; p++) {
      expect(bepaConfig.list.url(p)).not.toContain("no=1508");
    }
  });

  it("★url(1)·url(2) 가 달라지는 변수는 pageIndex 뿐이다 — no 가 바뀌면 엔진이 상세에서 게시판 번호를 떼어 낸다", () => {
    expect(pagingParamsOf(bepaConfig)).toEqual(["pageIndex"]);
    expect(pagingParamsOf(bepaConfig)).not.toContain("no");
  });

  it("지역은 부산 — 지역 조건 없이 전국에 노출되면 안 된다", () => {
    expect(bepaConfig.region).toBe("부산");
    expect(bepaConfig.id).toBe("bepa");
    expect(bepaConfig.agency).toBe("부산경제진흥원");
    expect(bepaConfig.charset).toBe("utf-8");
  });

  it("서식 변경 감지가 살아 있다 — 1은 검사를 끈 것과 같다", () => {
    expect(bepaConfig.expectMinRows).toBeGreaterThanOrEqual(5);
  });

  it("상세 본문·첨부 칸을 실측 선택자로 박는다", () => {
    expect(bepaConfig.detailContentSelector).toBe("dd.cont");
    expect(bepaConfig.attachmentsScopeSelector).toBe("dd.file-item");
  });
});

/** ★판정기를 망가뜨려 본다 — 안 하면 위 시험들이 「그냥 통과하는 글」일 뿐이다. */
describe("망가뜨려 보기", () => {
  it("행 껍데기 이름이 바뀌면 한 줄도 못 읽는다", () => {
    expect(parseBepaList(listHtml.replaceAll("skin_01", "skin_01-x"))).toHaveLength(0);
  });

  it("제목 칸(td.title)이 바뀌면 한 줄도 못 읽는다", () => {
    expect(parseBepaList(listHtml.replaceAll('class="title"', 'class="title-x"'))).toHaveLength(0);
  });

  it("작성일 칸이 사라지면 날짜를 비운다(오늘 날짜를 지어내지 않는다)", () => {
    expect(
      parseBepaList(listHtml.replaceAll('class="date"', 'class="date-x"')).every(
        (r) => r.dateText === "",
      ),
    ).toBe(true);
  });
});
