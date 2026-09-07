import { describe, expect, it } from "vitest";
import { extractCanonicalRegions, prefilter } from "./raw-prefilter";

const NOW = new Date("2026-08-23T12:00:00.000Z");
const SEOUL = { region: "서울" };

function a(over: { applyEnd?: Date | string | null; region?: string; title?: string } = {}) {
  return { applyEnd: new Date("2026-09-30T14:59:59.000Z"), region: "서울", title: "", ...over };
}

describe("prefilter — 마감", () => {
  it("마감이 지났으면 drop-closed", () => {
    expect(prefilter(a({ applyEnd: new Date("2026-08-22T00:00:00.000Z") }), SEOUL, NOW)).toBe("drop-closed");
  });

  it("마감이 지금과 같거나 뒤면 keep", () => {
    expect(prefilter(a({ applyEnd: NOW }), SEOUL, NOW)).toBe("keep");
    expect(prefilter(a({ applyEnd: new Date("2026-08-24T00:00:00.000Z") }), SEOUL, NOW)).toBe("keep");
  });

  it("마감일이 없으면 keep (상시·애매 — 잘못 빼지 않는다)", () => {
    expect(prefilter(a({ applyEnd: null }), SEOUL, NOW)).toBe("keep");
  });

  it("마감이 지난 타지역 공고는 지역보다 마감을 먼저 본다", () => {
    expect(
      prefilter(a({ applyEnd: new Date("2026-01-01T00:00:00.000Z"), region: "부산" }), SEOUL, NOW),
    ).toBe("drop-closed");
  });
});

describe("prefilter — 전국·무관", () => {
  it("공고 지역이 전국이면 keep", () => {
    expect(prefilter(a({ region: "전국" }), SEOUL, NOW)).toBe("keep");
    expect(prefilter(a({ region: "전국 중소기업" }), { region: "제주" }, NOW)).toBe("keep");
  });

  it("공고 지역이 무관이면 keep", () => {
    expect(prefilter(a({ region: "지역무관" }), SEOUL, NOW)).toBe("keep");
    expect(prefilter(a({ region: "소재지 무관" }), { region: "부산" }, NOW)).toBe("keep");
  });
});

describe("prefilter — 타지역", () => {
  it("명백히 다른 시도 전용이면 drop-region", () => {
    expect(prefilter(a({ region: "부산" }), SEOUL, NOW)).toBe("drop-region");
    expect(prefilter(a({ region: "부산광역시" }), { region: "서울특별시" }, NOW)).toBe("drop-region");
    expect(prefilter(a({ region: "충청남도" }), { region: "충북" }, NOW)).toBe("drop-region");
  });

  it("별칭이 같은 곳이면 keep", () => {
    expect(prefilter(a({ region: "서울특별시" }), SEOUL, NOW)).toBe("keep");
    expect(prefilter(a({ region: "#서울" }), SEOUL, NOW)).toBe("keep");
    expect(prefilter(a({ region: "충청북도" }), { region: "충북" }, NOW)).toBe("keep");
    expect(prefilter(a({ region: "충북" }), { region: "충청북도 청주시" }, NOW)).toBe("keep");
  });

  it("시·군이 붙어도 시도가 하나면 그 시도 전용이다", () => {
    expect(prefilter(a({ region: "충청북도 청주시" }), SEOUL, NOW)).toBe("drop-region");
    expect(prefilter(a({ region: "충청북도 청주시" }), { region: "충북" }, NOW)).toBe("keep");
  });

  it("대상 시도가 여러 곳이고 그 안에 프로필이 있으면 keep", () => {
    expect(prefilter(a({ region: "서울, 경기" }), SEOUL, NOW)).toBe("keep");
    expect(prefilter(a({ region: "부산·울산" }), { region: "울산" }, NOW)).toBe("keep");
  });

  it("대상 시도가 소수이고 프로필이 하나도 안 겹치면 drop-region", () => {
    expect(prefilter(a({ region: "부산, 울산" }), SEOUL, NOW)).toBe("drop-region");
    expect(prefilter(a({ region: "서울,경기,인천" }), { region: "부산" }, NOW)).toBe("drop-region");
  });
});

describe("prefilter — 애매하면 keep", () => {
  it("공고 지역이 비어 있으면 keep", () => {
    expect(prefilter(a({ region: "" }), SEOUL, NOW)).toBe("keep");
    expect(prefilter(a({ region: "   " }), SEOUL, NOW)).toBe("keep");
  });

  it("사전에 없는 표기(수도권·시군만)는 keep", () => {
    expect(prefilter(a({ region: "수도권" }), SEOUL, NOW)).toBe("keep");
    expect(prefilter(a({ region: "안양시" }), SEOUL, NOW)).toBe("keep");
  });

  it("프로필 소재지가 없으면 keep (지역으로 못 거른다)", () => {
    expect(prefilter(a({ region: "부산" }), {}, NOW)).toBe("keep");
    expect(prefilter(a({ region: "부산" }), { region: "" }, NOW)).toBe("keep");
  });

  it("프로필 소재지가 전국이면 keep", () => {
    expect(prefilter(a({ region: "부산" }), { region: "전국" }, NOW)).toBe("keep");
  });

  it("프로필 소재지가 사전 밖이면 keep", () => {
    expect(prefilter(a({ region: "부산" }), { region: "수도권" }, NOW)).toBe("keep");
  });

  it("기업마당 해시태그처럼 시도를 잔뜩 나열하면 빠진 시도가 있어도 keep (전국 나열로 본다)", () => {
    const dump =
      "경영,서울,부산,대구,인천,전남광주,대전,울산,세종,경기,강원,충북,충남,전북,경북,경남,제주,2026,해양수산부";
    expect(prefilter(a({ region: dump }), { region: "전남" }, NOW)).toBe("keep");
    expect(prefilter(a({ region: dump }), SEOUL, NOW)).toBe("keep");
  });

  it("업종·대상 텍스트만 있는 칸은 지역으로 거르지 않는다", () => {
    expect(prefilter(a({ region: "제조업,중소기업,창업" }), SEOUL, NOW)).toBe("keep");
  });

  it("시도가 붙어 쓰여 구분이 안 되면 keep (잘못 빼지 않는다)", () => {
    expect(prefilter(a({ region: "서울부산대구" }), { region: "부산" }, NOW)).toBe("keep");
    expect(prefilter(a({ region: "서울부산대구" }), SEOUL, NOW)).toBe("keep");
  });

  it("조사·공백으로 이어 쓴 복수 시도는 빼지 않는다", () => {
    expect(prefilter(a({ region: "서울및경기" }), { region: "경기" }, NOW)).toBe("keep");
    expect(prefilter(a({ region: "서울 경기" }), { region: "경기" }, NOW)).toBe("keep");
  });
});

describe("prefilter — 전남광주 통합 토큰·제목 머리표", () => {
  const JN_GW = a({
    region: "전남광주",
    title: "[전남광주] 목포시 착한가격업소 지원",
  });

  it("소재지 전남 + 제목 [전남광주] + 태그 전남광주 → keep", () => {
    expect(prefilter(JN_GW, { region: "전남" }, NOW)).toBe("keep");
  });

  it("소재지 광주 + 같은 공고 → keep", () => {
    expect(prefilter(JN_GW, { region: "광주" }, NOW)).toBe("keep");
  });

  it("소재지 서울 + 같은 공고 → drop-region", () => {
    expect(prefilter(JN_GW, SEOUL, NOW)).toBe("drop-region");
  });

  it("제목 머리표 [경기] 인데 태그는 충북이면 경기 회사에 keep (합집합)", () => {
    expect(
      prefilter(a({ region: "충북", title: "[경기] 시범사업 공고" }), { region: "경기" }, NOW),
    ).toBe("keep");
  });

  it("머리표 없는 공고는 태그만으로 판정한다", () => {
    expect(prefilter(a({ region: "부산", title: "부산 중소기업 지원" }), SEOUL, NOW)).toBe("drop-region");
    expect(prefilter(a({ region: "서울", title: "서울 중소기업 지원" }), SEOUL, NOW)).toBe("keep");
    // 본문에 「경기」가 있어도 머리표가 없으면 태그(충북)만 본다.
    expect(
      prefilter(a({ region: "충북", title: "경기 시범사업 공고" }), { region: "경기" }, NOW),
    ).toBe("drop-region");
  });
});

describe("제목 머리표의 한글 가운뎃점(ㆍ)", () => {
  // 기업마당이 쓰는 가운뎃점은 흔한 「·」(U+00B7)가 아니라 한글 아래아 「ㆍ」(U+318D)다.
  // 이걸 못 쪼개면 [부산ㆍ울산ㆍ경남] 이 한 덩어리로 남아 태그(경남)만 남고,
  // 부산·울산 회사가 그 공고를 통째로 잃는다(2026-08-24 운영 실측 16건 · 재리뷰 4번).
  const DONGNAM = a({
    region: "기술,경남,2026,정보보호클러스터,경상남도",
    title: "[부산ㆍ울산ㆍ경남] 2026년 동남 정보보호클러스터 보안 테스팅 지원사업 공고",
  });

  it("부산 회사에게 keep", () => {
    expect(prefilter(DONGNAM, { region: "부산" }, NOW)).toBe("keep");
  });

  it("울산 회사에게 keep", () => {
    expect(prefilter(DONGNAM, { region: "울산" }, NOW)).toBe("keep");
  });

  it("경남 회사에게 keep", () => {
    expect(prefilter(DONGNAM, { region: "경남" }, NOW)).toBe("keep");
  });

  it("서울 회사에게는 drop-region — 거르기 자체는 살아 있다", () => {
    expect(prefilter(DONGNAM, SEOUL, NOW)).toBe("drop-region");
  });

  it("머리표에서 시도 둘을 뽑는다", () => {
    expect(extractCanonicalRegions("대구ㆍ경북")).toEqual(["대구", "경북"]);
  });
});

describe("시도를 여럿 나열한 공고는 전국형으로 본다", () => {
  // EXCLUSIVE_REGION_MAX(=3)를 올리면 이 시험이 깨져야 한다 —
  // 상수를 100 으로 올려도 아무 시험이 안 깨지던 자리를 메운다(재리뷰 덤).
  const FOUR = a({ region: "서울,부산,대구,인천", title: "전국 시범사업 공고" });

  it("네 곳 나열은 어느 지역 회사에게든 keep", () => {
    for (const region of ["서울", "제주", "강원", "전남"]) {
      expect(prefilter(FOUR, { region }, NOW)).toBe("keep");
    }
  });

  it("세 곳 나열은 그 안에 없는 회사에게 drop-region", () => {
    const THREE = a({ region: "서울,부산,대구", title: "수도권·영남 시범사업" });
    expect(prefilter(THREE, { region: "제주" }, NOW)).toBe("drop-region");
  });
});
