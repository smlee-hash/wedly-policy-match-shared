import { describe, expect, it } from "vitest";
import { SIGUNGU_FORMER_SIDO, SIGUNGU_TO_SIDO, sigunguInTitle, sigunguSido } from "./sigungu";

describe("SIGUNGU_TO_SIDO — 동명이구·별칭 충돌은 빼고 2026 구역을 담는다", () => {
  it("중구·동구·서구·남구·북구·강서구·고성군·광주시는 사전에 없다", () => {
    for (const name of ["중구", "동구", "서구", "남구", "북구", "강서구", "고성군", "광주시"]) {
      expect(SIGUNGU_TO_SIDO[name]).toBeUndefined();
    }
  });

  it("군위군은 대구, 제주시·서귀포시는 제주", () => {
    expect(SIGUNGU_TO_SIDO["군위군"]).toBe("대구");
    expect(SIGUNGU_TO_SIDO["제주시"]).toBe("제주");
    expect(SIGUNGU_TO_SIDO["서귀포시"]).toBe("제주");
  });

  it("비자치구는 넣지 않는다", () => {
    expect(SIGUNGU_TO_SIDO["장안구"]).toBeUndefined();
    expect(SIGUNGU_TO_SIDO["진해구"]).toBeUndefined();
  });
});

describe("sigunguSido — 접미사 이름 또는 유일한 어간만, 부분 포함은 안 준다", () => {
  it("영월군·영월·구미·포천시(공백)는 값을 준다", () => {
    expect(sigunguSido("영월군")).toEqual({ name: "영월군", sido: "강원" });
    expect(sigunguSido("영월")).toEqual({ name: "영월군", sido: "강원" });
    expect(sigunguSido("구미")).toEqual({ name: "구미시", sido: "경북" });
    expect(sigunguSido("포천시 ")).toEqual({ name: "포천시", sido: "경기" });
  });

  it("고성·중구·광주·영월군청은 null", () => {
    expect(sigunguSido("고성")).toBeNull();
    expect(sigunguSido("중구")).toBeNull();
    expect(sigunguSido("광주")).toBeNull();
    expect(sigunguSido("영월군청")).toBeNull();
  });
});

describe("sigunguInTitle — 접미사 이름만, 한글이 이어지면 안 잡는다", () => {
  it("영월군 제목에서 강원 영월군을 찾는다", () => {
    expect(sigunguInTitle("2026년 3차 영월군 청년 창업육성 지원사업 수정 공고")).toEqual([
      { name: "영월군", sido: "강원" },
    ]);
  });

  it("김해시체육회처럼 한글이 바로 이어지면 잡지 않는다", () => {
    expect(sigunguInTitle("김해시체육회 2026년 생활체육 공고")).toEqual([]);
  });

  it("구두점으로 이어 쓴 부안군·김제시를 둘 다 찾는다", () => {
    expect(sigunguInTitle("[전북] 부안군ㆍ김제시 2026년 공동 지원사업 공고")).toEqual([
      { name: "부안군", sido: "전북" },
      { name: "김제시", sido: "전북" },
    ]);
  });
});

describe("F-5: 옛 소속 표는 사전 이름·표준 시도만 담는다", () => {
  it("열쇠가 사전에 있고 값이 표준 시도다", () => {
    for (const [name, sido] of Object.entries(SIGUNGU_FORMER_SIDO)) {
      expect(SIGUNGU_TO_SIDO[name]).toBeDefined();
      expect(["서울","부산","대구","인천","광주","대전","울산","세종","경기","강원","충북","충남","전북","전남","경북","경남","제주"]).toContain(sido);
    }
    expect(sigunguSido("군위군")?.formerSido).toBe("경북");
    expect(sigunguSido("영월군")?.formerSido).toBeUndefined();
  });
});
