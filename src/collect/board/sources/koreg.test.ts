import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseHtml } from "../html";
import { isKoregDropTitle, koregConfig, parseKoregList } from "./koreg";

/**
 * ★손으로 쓴 HTML 대신 **실사이트 고정본**으로 잰다.
 * 창원 사고: 지어낸 HTML 로 시험하면 선택자 오타가 그대로 통과한다.
 * 고정본: 2026-09-03 실측 알림마당>공지사항 1·2쪽
 * (`/koreg/na/ntt/selectNttList.do?mi=1026&bbsId=1031` · `currPage=2`).
 */
const listHtml = readFileSync(join(__dirname, "../__fixtures__/koreg-list.html"), "utf-8");
const listP2Html = readFileSync(join(__dirname, "../__fixtures__/koreg-list-p2.html"), "utf-8");
const NOW = Date.parse("2026-09-03T00:00:00Z");
const rows = parseKoregList(listHtml, 1, NOW);
const rowsP2 = parseKoregList(listP2Html, 2, NOW);
const combined = parseKoregList(listHtml + listP2Html, 1, NOW);

const FIRST = {
  title: "2026년 성공 소상공인(멘토) 매칭 사업 안내(~8.31)",
  detailUrl: "https://www.koreg.or.kr/koreg/na/ntt/selectNttInfo.do?nttSn=16073&bbsId=1031&mi=1026",
  dateText: "2026-08-10 ~",
  agency: "신용보증재단중앙회",
} as const;

describe("신용보증재단중앙회 공지 목록 읽기 — 실사이트 고정본", () => {
  it("1쪽 고정본에서 DROP·중복을 뺀 2건을 읽고 첫 행의 제목·상세주소·dateText 가 맞다", () => {
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows.length).toBeLessThanOrEqual(10);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject(FIRST);
  });

  it("★상세 주소에 쪽 번호를 넣지 않는다 — 넣으면 같은 글이 쪽마다 다른 줄이 된다", () => {
    expect(rows.every((r) => !/[?&]currPage=/.test(r.detailUrl))).toBe(true);
    expect(rowsP2.every((r) => !/[?&]currPage=/.test(r.detailUrl))).toBe(true);
    expect(rows.every((r) => r.detailUrl.includes("nttSn="))).toBe(true);
  });

  it("살아남은 행은 등록일을 개시형으로 넘긴다", () => {
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.dateText).toMatch(/^\d{4}-\d{2}-\d{2} ~$/);
    expect(rowsP2.length).toBeGreaterThan(0);
    for (const r of rowsP2) expect(r.dateText).toMatch(/^\d{4}-\d{2}-\d{2} ~$/);
  });

  it("날짜는 3번째 td 칸에서만 집는다 — 행 전체 글자면 번호·조회수와 붙는다", () => {
    const r = rows.find((x) => x.detailUrl.includes("nttSn=16073"));
    expect(r?.dateText).toBe("2026-08-10 ~");
    expect(r?.dateText).not.toMatch(/433|1105|16073/);
  });

  it("1쪽+2쪽을 합쳐 파싱해도 상세 열쇠 중복이 없고 7건이다", () => {
    expect(rowsP2).toHaveLength(5);
    expect(rowsP2[0]).toMatchObject({
      title: "2026년 성공 소상공인(멘토) 매칭 사업 안내(~4.24)",
      detailUrl: "https://www.koreg.or.kr/koreg/na/ntt/selectNttInfo.do?nttSn=16008&bbsId=1031&mi=1026",
      dateText: "2026-04-06 ~",
    });
    const urls = combined.map((r) => r.detailUrl);
    expect(new Set(urls).size).toBe(urls.length);
    expect(combined).toHaveLength(7);
    expect(rows.map((r) => r.detailUrl)).not.toEqual(rowsP2.map((r) => r.detailUrl));
  });

  it("같은 글번호는 한 번만 담는다", () => {
    const urls = rows.map((r) => r.detailUrl);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it("제목 앞 대괄호에서 기관을 뽑고, 없으면 중앙회로 되돌린다", () => {
    expect(rows.some((r) => r.agency === "한국중소벤처기업유통원")).toBe(true);
    expect(rows[0].agency).toBe("신용보증재단중앙회");
  });
});

describe("거르개 — 버릴 것만 지정한다", () => {
  it("DROP 낱말 행이 빠진다 — 알림톡·실태조사·GBSI·우수사례 공모·선정결과·서비스 중단", () => {
    const titles = combined.map((r) => r.title);
    expect(titles.some((t) => t.includes("알림톡"))).toBe(false);
    expect(titles.some((t) => t.includes("실태조사"))).toBe(false);
    expect(titles.some((t) => t.includes("GBSI"))).toBe(false);
    expect(titles.some((t) => t.includes("우수사례 공모"))).toBe(false);
    expect(titles.some((t) => t.includes("선정결과"))).toBe(false);
    expect(titles.some((t) => t.includes("서비스 중단"))).toBe(false);
    expect(titles.some((t) => t.includes("업무제안 공모"))).toBe(false);
    expect(titles.some((t) => t.includes("제안요청"))).toBe(false);
    expect(titles.some((t) => t.includes("홈페이지 사전 중단"))).toBe(false);
    expect(isKoregDropTitle("위기징후 소상공인 알림톡 발송('26.7월 기준)")).toBe(true);
    expect(isKoregDropTitle("2026년 보증이용기업 금융실태 및 신용보증 지원 효과 조사 실시 및 협조요청")).toBe(true);
    expect(isKoregDropTitle("2026년 2분기 보증기업 경기실사지수(GBSI) 조사 실시 및 협조 요청")).toBe(true);
    expect(isKoregDropTitle("2026년도 지역신용보증재단 보증지원 우수사례 공모 안내")).toBe(true);
    expect(isKoregDropTitle("성공 소상공인(멘토) 매칭 사업 지원대상 선정결과 안내")).toBe(true);
    expect(isKoregDropTitle("홈페이지 서비스 중단 사전안내")).toBe(true);
    expect(isKoregDropTitle("정보시스템 통합유지보수 사업 제안요청 설명회 개최 안내")).toBe(true);
    expect(isKoregDropTitle("2026년 신용보증재단중앙회 특별 업무제안 공모 안내")).toBe(true);
  });

  it("「채용」을 통째로 버리지 않는다 — 채용 지원사업이 죽으면 안 된다", () => {
    expect(isKoregDropTitle("소상공인 채용 지원사업 참여기업 모집")).toBe(false);
    expect(isKoregDropTitle("직원 채용 공고")).toBe(true);
    expect(
      parseKoregList(
        listHtml.replace(
          "2026년 성공 소상공인(멘토) 매칭 사업 안내(~8.31)",
          "2026년 중소기업 신규직원 채용 지원사업 참여기업 모집",
        ),
        1,
        NOW,
      ).some((r) => r.title.includes("채용 지원사업")),
    ).toBe(true);
  });

  it("지원사업·매칭 안내는 살린다", () => {
    expect(rows.some((r) => r.title.includes("매칭 사업 안내"))).toBe(true);
    expect(rows.some((r) => r.title.includes("물류 서비스 지원사업"))).toBe(true);
    expect(isKoregDropTitle("2026년 성공 소상공인(멘토) 매칭 사업 안내(~8.31)")).toBe(false);
    expect(isKoregDropTitle("[한국중소벤처기업유통원] 소상공인 물류 서비스 지원사업 신청 안내(~8.3)")).toBe(
      false,
    );
  });
});

describe("붙박이 공지 — 1년 넘은 것은 담지 않는다", () => {
  it("기준 시각을 2030년으로 옮기면 2026-08-10 붙박이가 빠진다", () => {
    const pinned = listHtml.replace(
      /<td class="BD_tm_none">\s*433\s*<\/td>/,
      '<td class="BD_tm_none">공지</td>',
    );
    const old = parseKoregList(pinned, 1, Date.parse("2030-01-01T00:00:00Z"));
    expect(old.some((r) => r.detailUrl.includes("nttSn=16073"))).toBe(false);
    expect(old).toHaveLength(1);
  });
});

describe("신용보증재단중앙회 공지 설정", () => {
  it("쪽넘김은 GET currPage + mi=1026 + bbsId=1031 — POST 본문이 아니다", () => {
    expect(koregConfig.list.url(1)).toBe(
      "https://www.koreg.or.kr/koreg/na/ntt/selectNttList.do?mi=1026&bbsId=1031&currPage=1",
    );
    expect(koregConfig.list.url(2)).toBe(
      "https://www.koreg.or.kr/koreg/na/ntt/selectNttList.do?mi=1026&bbsId=1031&currPage=2",
    );
    expect(koregConfig.list.url(1)).not.toBe(koregConfig.list.url(2));
    expect(koregConfig.list.init).toBeUndefined();
    expect(koregConfig.list.maxPages).toBe(8);
  });

  it("지역은 전국 — 중앙회 공지 자리다", () => {
    expect(koregConfig.region).toBe("전국");
    expect(koregConfig.id).toBe("koreg");
    expect(koregConfig.agency).toBe("신용보증재단중앙회");
    expect(koregConfig.label).toBe("신용보증재단중앙회 공지");
  });

  it("서식 변경 감지가 살아 있다 — DROP 뒤 1쪽 실측이 2건이라 절반(5)로 두면 거짓 실패한다", () => {
    expect(koregConfig.expectMinRows).toBeGreaterThanOrEqual(2);
    expect(koregConfig.expectMinRows).toBe(2);
  });

  it("행 선택자가 1쪽 고정본에서 실제 10줄을 잡는다", () => {
    expect(parseHtml(listHtml).querySelectorAll(koregConfig.list.rowSelector)).toHaveLength(10);
  });

  it("상세 본문·첨부 자리가 실측 선택자다", () => {
    expect(koregConfig.detailContentSelector).toBe("div.bbsV_cont");
    expect(koregConfig.attachmentsScopeSelector).toBe("div.bbsV_atchmnfl");
  });
});

/**
 * ★판정기를 망가뜨려 본다 — 안 하면 위 시험들이 「그냥 통과하는 글」일 뿐이다.
 * 행 껍데기 이름을 바꾼 고정본을 넣었을 때 0행이어야 선택자가 실제로 그 칸을 본다는 증거다.
 */
describe("망가뜨려 보기", () => {
  it("행 선택자가 한 글자 틀리면 0행이다", () => {
    expect(parseKoregList(listHtml.replaceAll("bbs_ListA", "bbs_ListA-x"), 1, NOW)).toHaveLength(0);
  });

  it("제목 칸(a.nttInfoBtn)이 바뀌면 한 줄도 못 읽는다", () => {
    expect(parseKoregList(listHtml.replaceAll("nttInfoBtn", "nttInfoBtn-x"), 1, NOW)).toHaveLength(0);
  });

  it("등록일 칸을 비우면 날짜를 비운다(오늘 날짜를 지어내지 않는다)", () => {
    const broken = parseKoregList(listHtml.replaceAll("<td>2026.08.10</td>", "<td></td>"), 1, NOW);
    expect(broken.length).toBeGreaterThan(0);
    const first = broken.find((r) => r.detailUrl.includes("nttSn=16073"));
    expect(first?.dateText).toBe("");
  });
});
