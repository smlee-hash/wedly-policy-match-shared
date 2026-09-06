import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseIcsinboList, icsinboConfig, isIcsinboDropTitle } from "./icsinbo";

/**
 * ★손으로 쓴 JSON 대신 **실사이트 고정본**으로 잰다.
 * 고정본: 2026-09-03 POST `/home/board/ajax/list.do?menu_cd=000096` 응답 1·2쪽 원문
 * (`searchData=data&searchText=&currentPage=1|2`).
 */
const p1 = readFileSync(join(__dirname, "../__fixtures__/icsinbo-list.html"), "utf-8");
const p2 = readFileSync(join(__dirname, "../__fixtures__/icsinbo-list-p2.html"), "utf-8");
const rows = parseIcsinboList(p1);
const rowsP2 = parseIcsinboList(p2);

describe("인천신용보증재단 목록 읽기 — 실사이트 고정본", () => {
  it("1쪽 10건에서 채용·설문을 걸러낸 6건을 읽고 첫 행의 제목·상세주소·등록일이 맞다", () => {
    expect(rows).toHaveLength(6);
    expect(rows[0]).toMatchObject({
      title: "소상공인복합클러스터 협업-교류 공간 사용안내",
      detailUrl: "https://www.icsinbo.or.kr/home/board/brdDetail.do?menu_cd=000096&num=1466",
      dateText: "2026-08-24 ~",
    });
  });

  it("등록일만 주는 게시판이라 dateText 는 개시형이다 — 마감일을 지어내지 않는다", () => {
    expect(rows.every((r) => /^\d{4}-\d{2}-\d{2} ~$/.test(r.dateText))).toBe(true);
  });

  it("★상세 주소에 쪽 번호를 넣지 않는다 — 넣으면 같은 글이 쪽마다 다른 주소가 된다", () => {
    expect(rows.every((r) => !/[?&]currentPage=/.test(r.detailUrl))).toBe(true);
  });

  it("1쪽과 2쪽을 합쳐도 중복이 없다 — currentPage 가 안 먹으면 여기서 걸린다", () => {
    const all = [...rows, ...rowsP2];
    expect(rowsP2.length).toBeGreaterThan(0);
    expect(new Set(all.map((r) => r.detailUrl)).size).toBe(all.length);
    expect(rows.map((r) => r.detailUrl)).not.toEqual(rowsP2.map((r) => r.detailUrl));
  });

  it("DROP 거르개가 실측 제목을 실제로 버린다", () => {
    const titles = [...rows, ...rowsP2].map((r) => r.title);
    expect(titles.some((t) => t.includes("정규직원 채용"))).toBe(false);
    expect(titles.some((t) => t.includes("기간제근로자"))).toBe(false);
    expect(titles.some((t) => t.includes("설문조사"))).toBe(false);
    expect(titles.some((t) => t.includes("명칭 변경"))).toBe(false);
    expect(titles.some((t) => t.includes("평가위원"))).toBe(false);
    expect(isIcsinboDropTitle("[접수마감] 2026년 인천신용보증재단 제2차 정규직원 채용 공고")).toBe(true);
    expect(isIcsinboDropTitle("[접수마감] 2026년 제5차 기간제근로자(소공인지원매니저) 채용 공고")).toBe(true);
    expect(isIcsinboDropTitle("[사전공고] 2026년 제5차 기간제근로자(소공인지원매니저) 채용 사전공고")).toBe(true);
    expect(isIcsinboDropTitle("「인천 소상공인 사업체 패널 구축 및 조사분석 연구용역」설문조사 안내")).toBe(true);
    expect(isIcsinboDropTitle("인천신용보증재단 일부 지점 명칭 변경 안내")).toBe(true);
    expect(
      isIcsinboDropTitle("「인천 소상공인 사업체 패널 구축 및 조사분석 연구용역(2차)」 제안서 평가위원회 평가결과"),
    ).toBe(true);
    expect(
      isIcsinboDropTitle("[모집마감]「인천 소상공인 e-캠퍼스 구축 및 임차 용역」제안서 평가위원(후보자) 공개모집 공고"),
    ).toBe(true);
  });

  it("★「채용」을 통째로 버리지 않는다 — 채용 지원사업이 죽는다", () => {
    expect(isIcsinboDropTitle("청년 채용 지원금 참여기업 모집 공고")).toBe(false);
    expect(isIcsinboDropTitle("중소기업 신규직원 채용 지원사업 참여기업 모집")).toBe(false);
  });

  it("지원사업·보증 안내는 살린다", () => {
    expect(rows.some((r) => r.title.includes("하나·이음 협약보증"))).toBe(true);
    expect(rows.some((r) => r.title.includes("소상공인시장진흥자금 특별보증"))).toBe(true);
    expect(rowsP2.some((r) => r.title.includes("희망드림 특례보증"))).toBe(true);
  });

  it("num 이나 제목이 없는 줄은 버린다", () => {
    expect(
      parseIcsinboList(JSON.stringify({ brdList: [{ num: "1" }, { title: "제목만" }] })),
    ).toEqual([]);
  });

  it("JSON 이 아니거나 모양이 다르면 빈 배열 — 수집이 통째로 죽지 않는다", () => {
    expect(parseIcsinboList("<html>껍데기 목록</html>")).toEqual([]);
    expect(parseIcsinboList(JSON.stringify({}))).toEqual([]);
  });

  it("★같은 num 이 한 응답에 두 번 오면 한 줄만 남긴다", () => {
    const one = JSON.parse(p1) as { brdList: unknown[] };
    one.brdList = [one.brdList[0], one.brdList[0]];
    expect(parseIcsinboList(JSON.stringify(one))).toHaveLength(1);
  });
});

describe("인천신용보증재단 설정", () => {
  it("쪽 번호는 주소가 아니라 POST 본문이 나른다 — 주소는 쪽과 무관하게 같다", () => {
    expect(icsinboConfig.list.url(1)).toBe(icsinboConfig.list.url(2));
    expect(icsinboConfig.list.url(1)).toBe(
      "https://www.icsinbo.or.kr/home/board/ajax/list.do?menu_cd=000096",
    );
    expect(icsinboConfig.list.init?.(2)).toMatchObject({ method: "POST" });
    expect(icsinboConfig.list.init!(2).body).toContain("currentPage=2");
    expect(icsinboConfig.list.init!(1).body).toContain("searchData=data");
    expect(icsinboConfig.list.init!(1).body).toContain("searchText=");
  });

  it("한 쪽 요청량 × 쪽수가 최근 글을 덮는다", () => {
    expect(icsinboConfig.list.maxPages).toBe(10);
    expect(icsinboConfig.expectMinRows).toBe(5);
  });

  it("상세 주소 호스트가 baseUrl 과 같아 허용 호스트 검사를 통과한다", () => {
    expect(new URL(rows[0].detailUrl).host).toBe(new URL(icsinboConfig.baseUrl).host);
  });

  it("지역은 인천 — 이 재단 공고의 자격 권역이다", () => {
    expect(icsinboConfig.region).toBe("인천");
    expect(icsinboConfig.id).toBe("icsinbo");
  });
});

/**
 * ★판정기를 망가뜨려 본다 — 이걸 안 하면 위 시험들이 「그냥 통과하는 글」일 뿐이다.
 * JSON 행 칸 이름을 바꿨을 때 결과가 실제로 달라지는지 확인한다.
 */
describe("망가뜨려 보기", () => {
  it("title 칸 이름이 바뀌면 한 줄도 못 읽는다", () => {
    expect(parseIcsinboList(p1.replaceAll('"title"', '"title_X"'))).toHaveLength(0);
  });

  it("행 배열 칸 이름이 바뀌면 한 줄도 못 읽는다 — 행 선택자를 틀린 것과 같다", () => {
    expect(parseIcsinboList(p1.replaceAll('"brdList"', '"brdList_X"'))).toHaveLength(0);
  });

  it("write_dt 가 사라지면 날짜를 비운다(오늘 날짜를 지어내지 않는다)", () => {
    const broken = parseIcsinboList(p1.replaceAll('"write_dt"', '"write_dt_X"'));
    expect(broken.length).toBeGreaterThan(0);
    expect(broken[0].dateText).toBe("");
  });
});
