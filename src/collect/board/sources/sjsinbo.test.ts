import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isSjsinboDropTitle, parseSjsinboList, sjsinboConfig } from "./sjsinbo";

/**
 * ★손으로 쓴 HTML 대신 **실사이트 고정본**으로 잰다.
 * 창원 사고: 지어낸 HTML 로 시험하면 선택자 오타가 그대로 통과한다.
 * 고정본: 2026-09-03 실측 `https://www.sjsinbo.or.kr/sub0501/index` 1쪽
 * + `/sub0501/index/page/2` 2쪽.
 */
const listHtml = readFileSync(join(__dirname, "../__fixtures__/sjsinbo-list.html"), "utf-8");
const listP2Html = readFileSync(join(__dirname, "../__fixtures__/sjsinbo-list-p2.html"), "utf-8");
const rows = parseSjsinboList(listHtml);
const rowsP2 = parseSjsinboList(listP2Html);
const combined = parseSjsinboList(listHtml + listP2Html);

describe("세종신용보증재단 공지사항 목록 읽기 — 실사이트 고정본", () => {
  it("1쪽 고정본에서 DROP·중복을 뺀 8건을 읽고 첫 행의 제목·상세주소·날짜가 맞다", () => {
    expect(rows.length).toBeGreaterThanOrEqual(5);
    expect(rows.length).toBeLessThanOrEqual(10);
    expect(rows).toHaveLength(8);
    expect(rows[0]).toMatchObject({
      title: "2026년 9월 세종시 소상공인자금 (접수 종료)",
      detailUrl: "https://www.sjsinbo.or.kr/sub0501/view/id/1130",
      dateText: "2026-09-01 ~",
      agency: "세종신용보증재단",
    });
  });

  it("★상세 주소에 쪽 번호를 넣지 않는다 — 넣으면 같은 글이 쪽마다 다른 줄이 된다", () => {
    expect(rows.every((r) => !r.detailUrl.includes("/page/"))).toBe(true);
    expect(rowsP2.every((r) => !r.detailUrl.includes("/page/"))).toBe(true);
    expect(
      rowsP2.every((r) => /^https:\/\/www\.sjsinbo\.or\.kr\/sub0501\/view\/id\/\d+$/.test(r.detailUrl)),
    ).toBe(true);
  });

  it("일반 행은 등록일을 개시형으로 넘긴다", () => {
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.dateText).toMatch(/^\d{4}-\d{2}-\d{2} ~$/);
    const datedP2 = rowsP2.filter((r) => r.dateText !== "");
    expect(datedP2.length).toBeGreaterThan(0);
    for (const r of datedP2) expect(r.dateText).toMatch(/^\d{4}-\d{2}-\d{2} ~$/);
  });

  it("★1년 넘게 붙어 있는 붙박이는 아예 안 담는다 — 2023년 안내문이 새 공고로 되살아나면 안 된다", () => {
    expect(rowsP2.some((r) => r.detailUrl.endsWith("/id/38"))).toBe(false);
    expect(rowsP2.some((r) => r.title.includes("피해예방"))).toBe(false);
    const old = parseSjsinboList(listHtml, 1, Date.parse("2030-01-01T00:00:00Z"));
    expect(old).toHaveLength(0);
  });

  it("1쪽+2쪽을 합쳐 파싱해도 상세 열쇠 중복이 없고 14건이다", () => {
    const urls = combined.map((r) => r.detailUrl);
    expect(new Set(urls).size).toBe(urls.length);
    expect(combined).toHaveLength(14);
    const concat = [...rows, ...rowsP2];
    expect(new Set(concat.map((r) => r.detailUrl)).size).toBe(concat.length);
  });

  it("2쪽 첫 살아남은 행이 1쪽과 다르고 쪽 번호가 주소에 없다", () => {
    expect(rowsP2).toHaveLength(6);
    expect(rowsP2[0]).toMatchObject({
      title: "2026년 6월 세종시 소상공인자금 (접수 종료)",
      detailUrl: "https://www.sjsinbo.or.kr/sub0501/view/id/1076",
      dateText: "2026-05-19 ~",
    });
    expect(rowsP2[0].detailUrl).not.toBe(rows[0].detailUrl);
  });

  it("DROP 거르개가 실측 제목을 실제로 버린다", () => {
    const titles = combined.map((r) => r.title);
    expect(titles.some((t) => t.includes("질의"))).toBe(false);
    expect(titles.some((t) => t.includes("피해예방"))).toBe(false);
    expect(titles.some((t) => t.includes("개인정보"))).toBe(false);
    expect(titles.some((t) => t.includes("일시중단"))).toBe(false);
    expect(titles.some((t) => t.includes("접수재개"))).toBe(false);
    expect(isSjsinboDropTitle("2026년 세종시 소상공인자금 안내(질의&응답)")).toBe(true);
    expect(isSjsinboDropTitle("2026년 정부자금(대리대출) 안내(질의&응답)")).toBe(true);
    expect(isSjsinboDropTitle("보증브로커(작업대출) 피해예방 고객 안내문")).toBe(true);
    expect(
      isSjsinboDropTitle(
        '"2026년 세종시 출자출연기관 경영실적평가 용역 고객만족도 조사" 관련 개인정보 제3자 제공사항 알림',
      ),
    ).toBe(true);
    expect(isSjsinboDropTitle("신규보증 신청 접수재개 안내")).toBe(true);
    expect(isSjsinboDropTitle("2026년 신규보증 신청 일시중단 안내")).toBe(true);
  });

  it("「채용」을 통째로 버리지 않는다 — 채용 지원사업이 죽으면 안 된다", () => {
    expect(isSjsinboDropTitle("소상공인 채용 지원사업 참여기업 모집")).toBe(false);
    expect(isSjsinboDropTitle("직원 채용 공고")).toBe(true);
  });

  it("날짜는 작성일 칸(td.hidden2)에서만 집는다 — 행 전체 글자면 조회수와 붙는다", () => {
    const r = rows.find((x) => x.detailUrl.endsWith("/id/1130"));
    expect(r?.dateText).toBe("2026-09-01 ~");
    expect(r?.dateText).not.toMatch(/32/);
    expect(r?.dateText).not.toMatch(/1130/);
  });
});

describe("세종신용보증재단 설정", () => {
  it("쪽넘김은 경로형 /index/page/{n} — 1쪽은 파라미터 없고 쿼리스트링 ?page= 이 아니다", () => {
    expect(sjsinboConfig.list.url(1)).toBe("https://www.sjsinbo.or.kr/sub0501/index");
    expect(sjsinboConfig.list.url(2)).toBe("https://www.sjsinbo.or.kr/sub0501/index/page/2");
    expect(sjsinboConfig.list.url(2)).not.toContain("?page=");
    expect(sjsinboConfig.list.url(1)).not.toBe(sjsinboConfig.list.url(2));
    expect(sjsinboConfig.list.maxPages).toBe(10);
  });

  it("지역은 세종", () => {
    expect(sjsinboConfig.region).toBe("세종");
    expect(sjsinboConfig.id).toBe("sjsinbo");
    expect(sjsinboConfig.agency).toBe("세종신용보증재단");
    expect(sjsinboConfig.label).toBe("세종신용보증재단");
  });

  it("서식 변경 감지가 살아 있다 — 1은 검사를 끈 것과 같다", () => {
    expect(sjsinboConfig.expectMinRows).toBeGreaterThanOrEqual(5);
  });

  it("★본문·첨부 선택자가 실측 상세와 같다", () => {
    expect(sjsinboConfig.detailContentSelector).toBe("table.board_view td.content");
    expect(sjsinboConfig.attachmentsScopeSelector).toBe("div.board_downloader");
  });
});

/**
 * ★판정기를 망가뜨려 본다 — 안 하면 위 시험들이 「그냥 통과하는 글」일 뿐이다.
 * 행 껍데기 이름을 바꾼 고정본을 넣었을 때 0행이어야 선택자가 실제로 그 칸을 본다는 증거다.
 */
describe("망가뜨려 보기", () => {
  it("행 선택자가 한 글자 틀리면 0행이다", () => {
    expect(parseSjsinboList(listHtml.replaceAll("tbl_board", "tbl_board-x"))).toHaveLength(0);
  });

  it("제목 칸(td.left)이 바뀌면 한 줄도 못 읽는다", () => {
    expect(parseSjsinboList(listHtml.replaceAll("left ", "left-x "))).toHaveLength(0);
  });

  it("작성일 칸이 사라지면 날짜를 비운다(오늘 날짜를 지어내지 않는다)", () => {
    const broken = parseSjsinboList(listHtml.replaceAll("hidden2", "hidden2-x"));
    expect(broken.length).toBeGreaterThan(0);
    expect(broken.every((r) => r.dateText === "")).toBe(true);
  });
});
