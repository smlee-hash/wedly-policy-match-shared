import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseHtml } from "../html";
import { pagingParamsOf } from "../engine";
import { cbsinboConfig, isCbsinboDropTitle, parseCbsinboList } from "./cbsinbo";

/**
 * ★손으로 쓴 HTML 대신 **실사이트 고정본**으로 잰다.
 * 창원 사고: 지어낸 HTML 로 시험하면 선택자 오타가 그대로 통과한다.
 * 고정본: 2026-09-03 실측 `https://www.cbsinbo.or.kr/sub.php?code=123` 1쪽 + `page=2` 2쪽.
 */
const listHtml = readFileSync(join(__dirname, "../__fixtures__/cbsinbo-list.html"), "utf-8");
const listP2Html = readFileSync(join(__dirname, "../__fixtures__/cbsinbo-list-p2.html"), "utf-8");
const rows = parseCbsinboList(listHtml);
const rowsP2 = parseCbsinboList(listP2Html);
const combined = parseCbsinboList(listHtml + listP2Html);

describe("충북신용보증재단 공지사항 목록 읽기 — 실사이트 고정본", () => {
  it("1쪽 고정본에서 DROP·중복을 뺀 10건을 읽고 첫 행이 맞다", () => {
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows.length).toBeLessThanOrEqual(15);
    expect(rows).toHaveLength(10);
    expect(rows[0]).toMatchObject({
      title: "2026년도 충북신용보증재단 경영지도 교육생 모집 공고(7차)",
      detailUrl: "https://www.cbsinbo.or.kr/sub.php?code=123&mode=view&no=431",
      dateText: "2026-08-21 ~",
      agency: "충북신용보증재단",
    });
  });

  it("★상세 주소에 쪽 번호를 넣지 않는다 — 넣으면 같은 글이 쪽마다 다른 줄이 된다", () => {
    expect(rows.every((r) => !r.detailUrl.includes("page="))).toBe(true);
    expect(rowsP2.every((r) => !r.detailUrl.includes("page="))).toBe(true);
    expect(
      [...rows, ...rowsP2].every((r) =>
        /^https:\/\/www\.cbsinbo\.or\.kr\/sub\.php\?code=123&mode=view&no=\d+$/.test(r.detailUrl),
      ),
    ).toBe(true);
  });

  it("★1년 넘게 붙어 있는 붙박이는 아예 안 담는다 — 날짜를 비우면 90일간 되살아난다", () => {
    expect(rows.some((r) => r.detailUrl.includes("no=353"))).toBe(false);
    expect(rows.some((r) => r.detailUrl.includes("no=357"))).toBe(false);
    expect(rows.some((r) => r.detailUrl.includes("no=382"))).toBe(false);
    const old = parseCbsinboList(listHtml, 1, Date.parse("2030-01-01T00:00:00Z"));
    expect(old.some((r) => r.detailUrl.includes("no=431"))).toBe(true);
    expect(old.every((r) => r.dateText !== "")).toBe(true);
  });

  it("일반 행은 등록일을 개시형으로 넘긴다", () => {
    expect(rows.every((r) => r.dateText !== "")).toBe(true);
    for (const row of [...rows, ...rowsP2]) {
      expect(row.dateText).toMatch(/^\d{4}-\d{2}-\d{2} ~$/);
    }
  });

  it("1쪽+2쪽을 합쳐 파싱해도 상세 열쇠 중복이 없고 19건이다", () => {
    const urls = combined.map((r) => r.detailUrl);
    expect(new Set(urls).size).toBe(urls.length);
    expect(combined).toHaveLength(19);
  });

  it("2쪽 첫 살아남은 행이 1쪽과 다르고 쪽 번호가 주소에 없다", () => {
    expect(rowsP2.length).toBeGreaterThanOrEqual(2);
    expect(rowsP2.length).toBeLessThanOrEqual(15);
    expect(rowsP2).toHaveLength(9);
    expect(rowsP2[0]).toMatchObject({
      title: "2026년도 충북신용보증재단 경영지도 교육생 모집 공고(1차)",
      detailUrl: "https://www.cbsinbo.or.kr/sub.php?code=123&mode=view&no=418",
      dateText: "2026-03-16 ~",
    });
    expect(rowsP2[0].detailUrl).not.toBe(rows[0].detailUrl);
  });

  it("DROP 거르개가 실측 제목을 실제로 버린다", () => {
    const titles = combined.map((r) => r.title);
    expect(titles.some((t) => t.includes("앱 이용방법"))).toBe(false);
    expect(titles.some((t) => t.includes("디지털 소외계층"))).toBe(false);
    expect(titles.some((t) => t.includes("설문조사"))).toBe(false);
    expect(titles.some((t) => t.includes("개인정보 제3자"))).toBe(false);
    expect(titles.some((t) => t.includes("경영평가 용역"))).toBe(false);
    expect(titles.some((t) => t.includes("착한가격업소"))).toBe(false);
    expect(titles.some((t) => t.includes("우수사례 공모"))).toBe(false);
    expect(titles.some((t) => t.includes("복구 안내"))).toBe(false);
    expect(isCbsinboDropTitle("★'보증드림' 앱 이용방법 (1. 보증신청)")).toBe(true);
    expect(isCbsinboDropTitle("★디지털 소외계층(만65세이상·장애인·임산부)을 위한 보증신청 방법 안내")).toBe(true);
    expect(isCbsinboDropTitle("2026년 보증이용기업 금융실태 및 신용보증 지원 효과 설문조사 안내")).toBe(true);
    expect(isCbsinboDropTitle("2026년(2025년 실적)충청북도 출연기관 경영평가 용역 관련 개인정보 제3자 제공사항 알림")).toBe(
      true,
    );
    expect(isCbsinboDropTitle("국가정보자원관리원 화재 관련 신용보증 업무 서비스 복구 안내")).toBe(true);
    expect(isCbsinboDropTitle("충북신용보증재단과 함께하는 착한가격업소 이용 캠페인")).toBe(true);
    expect(isCbsinboDropTitle("2025년도 지역신용보증재단 보증지원 우수사례 공모 안내")).toBe(true);
  });

  it("「채용」을 통째로 버리지 않는다 — 채용 지원사업이 죽으면 안 된다", () => {
    expect(isCbsinboDropTitle("충북 소상공인 채용 지원사업 모집 공고")).toBe(false);
    expect(isCbsinboDropTitle("직원 채용 공고")).toBe(true);
  });

  it("컨설팅 수진기업 모집·육성자금 공고는 살린다", () => {
    expect(rows.some((r) => r.title.includes("Scale-Up 맞춤형 전문 컨설팅"))).toBe(true);
    expect(rows.some((r) => r.title.includes("새출발 재기지원사업"))).toBe(true);
    expect(isCbsinboDropTitle("2026년도 Scale-Up 맞춤형 전문 컨설팅 수진기업 모집 공고(3차)")).toBe(false);
    expect(isCbsinboDropTitle("2025년 충청북도 소상공인 육성자금 지원계획 변경 공고문")).toBe(false);
  });

  it("날짜는 날짜 칸에서만 집는다 — 행 전체 글자면 번호·조회수와 붙는다", () => {
    const r = rows.find((x) => x.detailUrl.includes("no=431"));
    expect(r?.dateText).toBe("2026-08-21 ~");
    expect(r?.dateText).not.toMatch(/351/);
    expect(r?.dateText).not.toMatch(/158/);
  });
});

describe("충북신용보증재단 설정", () => {
  it("쪽넘김은 GET page — 1쪽과 2쪽 주소가 다르고 page 가 쪽 번호다", () => {
    expect(cbsinboConfig.list.url(1)).toBe("https://www.cbsinbo.or.kr/sub.php?code=123&page=1");
    expect(cbsinboConfig.list.url(2)).toBe("https://www.cbsinbo.or.kr/sub.php?code=123&page=2");
    expect(cbsinboConfig.list.url(1)).not.toBe(cbsinboConfig.list.url(2));
    expect(pagingParamsOf(cbsinboConfig)).toContain("page");
    expect(cbsinboConfig.list.maxPages).toBe(8);
  });

  it("지역은 충북", () => {
    expect(cbsinboConfig.region).toBe("충북");
    expect(cbsinboConfig.id).toBe("cbsinbo");
    expect(cbsinboConfig.agency).toBe("충북신용보증재단");
  });

  it("서식 변경 감지가 살아 있다 — 1은 검사를 끈 것과 같다", () => {
    expect(cbsinboConfig.expectMinRows).toBeGreaterThanOrEqual(2);
  });

  it("★본문 선택자를 비운다 — 상세 view_con 은 「첨부파일 참고」뿐이라 채우면 첨부 공고문을 건너뛴다", () => {
    expect(cbsinboConfig.detailContentSelector).toBeUndefined();
    expect(cbsinboConfig.attachmentsScopeSelector).toBe("div.t_file");
  });

  it("목록 행에 첨부 파일 링크가 섞이므로 heuristic 을 끈다", () => {
    expect(cbsinboConfig.skipHeuristic).toBe(true);
  });
});

/**
 * ★판정기를 망가뜨려 본다 — 안 하면 위 시험들이 「그냥 통과하는 글」일 뿐이다.
 */
describe("망가뜨려 보기", () => {
  it("행 선택자가 한 글자 틀리면 0행이다", () => {
    const broken = cbsinboConfig.list.rowSelector.replace("table_board_basic", "table_board_basic-x");
    expect(parseHtml(listHtml).querySelectorAll(broken)).toHaveLength(0);
    expect(parseCbsinboList(listHtml.replaceAll("table_board_basic", "table_board_basic-x"))).toHaveLength(0);
  });

  it("제목 칸(td.td_left)이 바뀌면 한 줄도 못 읽는다", () => {
    expect(parseCbsinboList(listHtml.replaceAll('class="td_left"', 'class="td_left-x"'))).toHaveLength(0);
  });

  it("작성일 칸이 비면 날짜를 비운다(오늘 날짜를 지어내지 않는다)", () => {
    const blanked = listHtml.replaceAll(/\d{4}-\d{2}-\d{2}/g, "");
    const parsed = parseCbsinboList(blanked);
    expect(parsed.length).toBeGreaterThan(0);
    expect(parsed.every((r) => r.dateText === "")).toBe(true);
  });
});
