import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { pagingParamsOf } from "../engine";
import { isKeitDropTitle, parseKeitList, keitConfig } from "./keit";

/**
 * ★손으로 쓴 자료 대신 **실사이트 고정본**으로 잰다(창원 사고: 지어낸 자료로 재면 오타가 그대로 통과).
 * 고정본: 2026-09-03 실측 `retrieveSprtBsnsAncmListJson.do` 에 `bsnsYy=&pageIndex=1|2` 로 받은 응답 그대로.
 */
const listJson = readFileSync(join(__dirname, "../__fixtures__/keit-list.json"), "utf-8");
const listP2Json = readFileSync(join(__dirname, "../__fixtures__/keit-list-p2.json"), "utf-8");
const rows = parseKeitList(listJson);
const rowsP2 = parseKeitList(listP2Json, 2);
const combined = [...rows, ...rowsP2];

describe("KEIT 지원사업공고 목록 읽기 — 실사이트 고정본", () => {
  it("1쪽 15줄에서 DROP 1건을 뺀 14건을 읽고 첫 행이 맞다", () => {
    expect(JSON.parse(listJson).list).toHaveLength(15);
    expect(rows).toHaveLength(14);
    expect(rows[0]).toEqual({
      title: "2026년도 지식서비스산업기술개발사업(서비스핵심기술개발) 신규지원 대상과제 공고",
      detailUrl:
        "https://itech.keit.re.kr/bsnsancm/retrieveSprtBsnsAncmDetail.do?ancmId=I22056&bsnsYy=2026",
      dateText: "2026-05-29 ~ 2026-06-29",
      category: "",
    });
  });

  it("접수기간은 시작·끝 **칸을 따로** 읽는다 — 한 덩어리 글자에서 정규식으로 찾지 않는다", () => {
    // 붙여 읽으면 「20260529 20260629」가 「202605292026…」로 깨진다. 칸 단위라 그런 자리가 없다.
    for (const r of rows) expect(r.dateText).toMatch(/^\d{4}-\d{2}-\d{2} ~ \d{4}-\d{2}-\d{2}$/);
    const machine = rows.find((r) => r.detailUrl.includes("ancmId=I21435"));
    // 공고일(2026-04-30)이 아니라 접수 시작일(2026-05-11)이 개시일이다.
    expect(machine?.dateText).toBe("2026-05-11 ~ 2026-05-29");
    expect(machine?.dateText).not.toMatch(/2026-04-30/);
  });

  it("★상세 주소에 쪽 번호가 섞이지 않고 사업연도는 살아 있다", () => {
    // pageIndex 가 섞이면 같은 공고가 쪽마다 다른 줄로 저장된다. bsnsYy 가 빠지면 상세가 안 열린다.
    for (const r of combined) {
      expect(r.detailUrl).not.toMatch(/pageIndex/);
      expect(r.detailUrl).toMatch(/[?&]ancmId=[A-Z]\d+&bsnsYy=20\d{2}$/);
    }
  });

  it("엔진이 떼어 낼 쪽 변수는 pageIndex 하나뿐이다 — bsnsYy 는 건드리면 안 된다", () => {
    const paging = pagingParamsOf(keitConfig);
    expect(paging).toEqual(["pageIndex"]);
    expect(paging).not.toContain("bsnsYy");
  });

  it("제목의 겹공백을 하나로 정리한다", () => {
    const r = rows.find((x) => x.detailUrl.includes("ancmId=A00619"));
    expect(r?.title).toBe("2024년도 시험인증산업경쟁력및신뢰성제고사업 신규지원 대상과제 공고");
  });

  it("DROP 거르개가 실측 제목을 실제로 버린다 — 「의향조사」 1건", () => {
    expect(JSON.parse(listJson).list.some((r: { ancmTl: string }) => r.ancmTl.includes("의향조사"))).toBe(true);
    expect(rows.some((r) => r.title.includes("의향조사"))).toBe(false);
    expect(
      isKeitDropTitle("2025년도 첨단 디스플레이 국가연구플랫폼 구축 사업 기획을 위한 지역 수요 의향조사"),
    ).toBe(true);
    expect(isKeitDropTitle("2026년도 ○○기술개발사업 신규과제 수요조사 공고")).toBe(true);
  });

  it("버릴 것만 좁게 버린다 — 「공모」·「채용」·「재공고」는 살린다", () => {
    expect(isKeitDropTitle("2023년도 지역맞춤형 재난안전 문제해결 기술개발 지원 신규과제 공모")).toBe(false);
    expect(isKeitDropTitle("청년 채용 지원금 참여기업 모집 공고")).toBe(false);
    expect(isKeitDropTitle("2023년도 소재부품기술개발사업(패키지형) 신규지원 대상과제 재공고")).toBe(false);
    expect(rowsP2.some((r) => r.title.includes("재공고"))).toBe(true);
  });

  it("1쪽+2쪽을 합쳐도 상세 열쇠 중복이 없다", () => {
    expect(rowsP2).toHaveLength(15);
    expect(combined).toHaveLength(29);
    const urls = combined.map((r) => r.detailUrl);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it("2쪽 첫 행이 1쪽과 다르다 — pageIndex 가 진짜 먹는다", () => {
    expect(rowsP2[0]).toMatchObject({
      title: "2023년도 소재부품기술개발사업(패키지형) 신규지원 대상과제 공고",
      detailUrl:
        "https://itech.keit.re.kr/bsnsancm/retrieveSprtBsnsAncmDetail.do?ancmId=A00603&bsnsYy=2023",
      dateText: "2023-08-03 ~ 2023-09-01",
    });
    expect(rowsP2[0].detailUrl).not.toBe(rows[0].detailUrl);
  });

  it("제목이 같아도 공고 번호가 다르면 둘 다 살린다", () => {
    // 실측: 2쪽에 「2023년도 소재부품기술개발사업(패키지형) 신규지원 대상과제 공고」가 A00603·A00591 두 건.
    const same = rowsP2.filter((r) => r.title === "2023년도 소재부품기술개발사업(패키지형) 신규지원 대상과제 공고");
    expect(same).toHaveLength(2);
    expect(same[0].detailUrl).not.toBe(same[1].detailUrl);
  });
});

describe("KEIT 설정", () => {
  it("쪽넘김은 POST 본문 pageIndex 이고 해는 비워 전 연도를 한 줄로 받는다", () => {
    // 해를 지정하면 목록이 연도별로 갈려 2026년이 3건뿐이다(실측). 빈 값이면 1,238건 한 줄.
    expect(keitConfig.list.url(1)).toBe(
      "https://itech.keit.re.kr/bsnsancm/retrieveSprtBsnsAncmListJson.do",
    );
    expect(keitConfig.list.url(2)).toBe(keitConfig.list.url(1));
    expect(keitConfig.list.init?.(1)).toEqual({
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "bsnsYy=&pageIndex=1",
    });
    expect(keitConfig.list.init?.(2)?.body).toBe("bsnsYy=&pageIndex=2");
    expect(keitConfig.list.maxPages).toBe(5);
  });

  it("기관·지역·글자표", () => {
    expect(keitConfig.id).toBe("keit");
    expect(keitConfig.agency).toBe("한국산업기술기획평가원");
    expect(keitConfig.region).toBe("전국");
    expect(keitConfig.charset).toBe("utf-8");
  });

  it("서식 변경 감지가 살아 있다 — 1은 검사를 끈 것과 같다", () => {
    expect(keitConfig.expectMinRows).toBeGreaterThanOrEqual(2);
    expect(rows.length).toBeGreaterThanOrEqual(keitConfig.expectMinRows!);
  });

  it("JSON 목록이라 heuristic 추측 단계를 끈다 — 오류 화면이 오면 쓰레기만 남는다", () => {
    expect(keitConfig.skipHeuristic).toBe(true);
  });

  it("상세 본문 선택자는 공고문 본문(div.report)만 가리킨다", () => {
    expect(keitConfig.detailContentSelector).toBe("div.report");
    expect(keitConfig.attachmentsScopeSelector).toBe("table#table-response");
  });
});

/**
 * ★판정기를 망가뜨려 본다 — 안 하면 위 시험들이 「그냥 통과하는 글」일 뿐이다.
 */
describe("망가뜨려 보기", () => {
  it("행 목록 열쇠(list)가 바뀌면 0행이다", () => {
    expect(parseKeitList(listJson.replaceAll('"list":', '"list-x":'))).toHaveLength(0);
  });

  it("제목 칸(ancmTl)이 바뀌면 한 줄도 못 읽는다", () => {
    expect(parseKeitList(listJson.replaceAll('"ancmTl":', '"ancmTl-x":'))).toHaveLength(0);
  });

  it("공고 번호 칸(ancmId)이 바뀌면 상세 주소를 못 만들어 0행이다", () => {
    expect(parseKeitList(listJson.replaceAll('"ancmId":', '"ancmId-x":'))).toHaveLength(0);
  });

  it("접수기간 칸이 사라지면 공고일을 개시형으로 넘긴다(날짜를 지어내지 않는다)", () => {
    const broken = parseKeitList(
      listJson.replaceAll('"minRcveStrDe":', '"minRcveStrDe-x":').replaceAll('"maxRcveEndDe":', '"maxRcveEndDe-x":'),
    );
    expect(broken).toHaveLength(14);
    expect(broken[0].dateText).toBe("2026-05-29 ~");
    for (const r of broken) expect(r.dateText).toMatch(/^\d{4}-\d{2}-\d{2} ~$/);
  });

  it("JSON 이 아니면(오류 화면 등) 0행 — 껍데기를 공고로 저장하지 않는다", () => {
    expect(parseKeitList("<html><body>서비스 점검 중</body></html>")).toHaveLength(0);
    expect(parseKeitList("")).toHaveLength(0);
  });
});
