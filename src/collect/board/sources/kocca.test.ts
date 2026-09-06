import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseHtml } from "../html";
import { isKoccaDropTitle, parseKoccaList, koccaConfig } from "./kocca";

/**
 * ★손으로 쓴 HTML 대신 **실사이트 고정본**으로 잰다.
 * 창원 사고: 지어낸 HTML 로 시험하면 선택자 오타가 그대로 통과한다.
 * 고정본: 2026-09-03 실측 지원공고 전체(진행중) 1쪽
 * (`/kocca/pims/list.do?menuNo=204104`, 총 5건 · 2쪽 없음).
 */
const listHtml = readFileSync(join(__dirname, "../__fixtures__/kocca-list.html"), "utf-8");
const rows = parseKoccaList(listHtml);

describe("한국콘텐츠진흥원 지원사업공고 목록 읽기 — 실사이트 고정본", () => {
  it("1쪽 고정본에서 DROP·중복을 뺀 5건을 읽고 첫 행이 맞다", () => {
    expect(rows).toHaveLength(5);
    expect(rows.length).toBeGreaterThanOrEqual(koccaConfig.expectMinRows ?? 0);
    expect(rows.length).toBeLessThanOrEqual(10);
    expect(rows[0]).toMatchObject({
      title: "2027 콘텐츠 아메리카 한국공동관 및 쇼케이스 참가기업 모집공고",
      detailUrl: "https://www.kocca.kr/kocca/pims/view.do?intcNo=326D00085009&menuNo=204104",
      dateText: "2026-08-31 ~ 2026-09-21",
      agency: "한국콘텐츠진흥원",
    });
  });

  it("★상세 주소에 pageIndex·category·search 를 넣지 않는다 — 쪽마다 같은 글이 다른 줄로 저장된다", () => {
    expect(
      rows.every((r) => /^https:\/\/www\.kocca\.kr\/kocca\/pims\/view\.do\?intcNo=[A-Za-z0-9]+&menuNo=204104$/.test(r.detailUrl)),
    ).toBe(true);
    expect(rows.every((r) => !r.detailUrl.includes("pageIndex"))).toBe(true);
    expect(rows.every((r) => !r.detailUrl.includes("category="))).toBe(true);
    expect(rows.every((r) => !r.detailUrl.includes("search"))).toBe(true);
  });

  it("같은 쪽 안에서도 상세 열쇠 중복이 없다", () => {
    const urls = rows.map((r) => r.detailUrl);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it("접수기간은 td[data-label=접수기간] 칸에서만 집는다 — 공고일 칸으로 떨어지면 안 된다", () => {
    // 세 번째 행 ATF: 공고일 26.08.24, 접수 26.08.25~26.09.08. 공고일을 집으면 시작이 하루 앞당겨진다.
    const atf = rows.find((x) => x.title.includes("ATF"));
    expect(atf?.dateText).toBe("2026-08-25 ~ 2026-09-08");
    expect(atf?.dateText).not.toContain("2026-08-24");
    // 상시공고: 공고일 26.04.23, 접수 26.04.27~26.12.31.
    const always = rows.find((x) => x.title.includes("글로벌게임허브센터"));
    expect(always?.dateText).toBe("2026-04-27 ~ 2026-12-31");
  });

  it("날짜는 칸 단위로만 집는다 — 행 전체 글자면 조회수와 붙는다", () => {
    const r = rows.find((x) => x.detailUrl.includes("intcNo=326D00085009"));
    expect(r?.dateText).toBe("2026-08-31 ~ 2026-09-21");
    expect(r?.dateText).not.toMatch(/971/);
  });

  it("접수기간은 시작 ~ 끝 둘 다 넘긴다 — 등록일만 주는 개시형이 아니다", () => {
    expect(rows.every((r) => /^20\d{2}-\d{2}-\d{2} ~ 20\d{2}-\d{2}-\d{2}$/.test(r.dateText))).toBe(true);
  });

  it("DROP 거르개가 입찰·설문·평가위원·합격자·채용 공고를 버린다", () => {
    expect(isKoccaDropTitle("2026년 콘텐츠 용역 입찰 공고")).toBe(true);
    expect(isKoccaDropTitle("고객만족도 설문 조사 안내")).toBe(true);
    expect(isKoccaDropTitle("지원사업 평가위원 모집 공고")).toBe(true);
    expect(isKoccaDropTitle("2026년 지원사업 선정 합격자 발표")).toBe(true);
    expect(isKoccaDropTitle("한국콘텐츠진흥원 직원 채용 공고")).toBe(true);
    const planted = parseKoccaList(
      listHtml.replace(
        "2027 콘텐츠 아메리카 한국공동관 및 쇼케이스 참가기업 모집공고",
        "2026년 콘텐츠 용역 입찰 공고",
      ),
    );
    expect(planted.some((r) => r.title.includes("입찰"))).toBe(false);
    expect(planted).toHaveLength(4);
  });

  it("「채용」을 통째로 버리지 않는다 — 채용 지원사업은 살아남는다", () => {
    expect(isKoccaDropTitle("콘텐츠 기업 채용 지원사업 참여기업 모집")).toBe(false);
    expect(rows.some((r) => r.title.includes("강사 Pool"))).toBe(true);
  });
});

describe("한국콘텐츠진흥원 설정", () => {
  it("쪽넘김은 GET pageIndex · 지원공고(menuNo=204104) 판만 붙인다", () => {
    expect(koccaConfig.list.url(1)).toBe(
      "https://www.kocca.kr/kocca/pims/list.do?menuNo=204104&pageIndex=1",
    );
    expect(koccaConfig.list.url(2)).toBe(
      "https://www.kocca.kr/kocca/pims/list.do?menuNo=204104&pageIndex=2",
    );
    expect(koccaConfig.list.url(2)).not.toContain("category=4");
    expect(koccaConfig.list.maxPages).toBe(15);
  });

  it("지역은 전국 — 콘텐츠 지원사업은 전국 기업이 신청한다", () => {
    expect(koccaConfig.region).toBe("전국");
    expect(koccaConfig.id).toBe("kocca");
    expect(koccaConfig.agency).toBe("한국콘텐츠진흥원");
  });

  it("서식 변경 감지가 살아 있다 — 1은 검사를 끈 것과 같다", () => {
    expect(koccaConfig.expectMinRows).toBeGreaterThanOrEqual(2);
  });

  it("상세 본문은 board_cont — 자격조건이 그 칸에 있다", () => {
    expect(koccaConfig.detailContentSelector).toBe("div.board_cont");
    // 공고 파일은 pms.kocca.kr JS 팝업이라 HTML 링크가 없고,
    // 화면 하단 정책자료.zip 은 사이트 공용이라 상세 전체에서 수확하면 오염된다.
    expect(koccaConfig.attachmentsScopeSelector).toBe("div.board_cont");
  });
});

/**
 * ★판정기를 망가뜨려 본다 — 안 하면 위 시험들이 「그냥 통과하는 글」일 뿐이다.
 */
describe("망가뜨려 보기", () => {
  it("행 선택자가 틀리면 0행이다", () => {
    const broken = koccaConfig.list.rowSelector.replace("board_list01", "board_list01-x");
    expect(parseHtml(listHtml).querySelectorAll(broken)).toHaveLength(0);
    expect(parseKoccaList(listHtml.replaceAll("board_list01", "board_list01-x"))).toHaveLength(0);
  });

  it("제목 칸 data-label 이 바뀌면 한 줄도 못 읽는다", () => {
    expect(parseKoccaList(listHtml.replaceAll('data-label="제목"', 'data-label="제목-x"'))).toHaveLength(0);
  });
});
