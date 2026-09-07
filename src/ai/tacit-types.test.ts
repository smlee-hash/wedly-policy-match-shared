import { describe, expect, it } from "vitest";
import type { TacitSnippet, TacitSourceKind } from "./tacit-types";
import { sourceKindOf } from "./breakthrough";

/**
 * 형은 컴파일 뒤에 사라져 실행 중에는 잴 것이 없다. 그래서 **타입 검사**(`npm run typecheck`)가
 * 이 파일의 진짜 시험이다 — `@ts-expect-error` 줄이 「오류가 나야 한다」를 못 박고,
 * 오류가 안 나면 그 줄 자체가 타입 검사에서 실패한다.
 *
 * ERP 원문(`src/lib/services/policy-match/tacit-search.ts:7-13`)과 갈라지지 않게 하는 장치는
 * 두 겹이다: ① 그 파일이 이 형을 재수출한다(P4 Task B1) ② 아래 세 갈래 값이 여기 박혀 있다.
 */
describe("TacitSourceKind — 세 갈래뿐", () => {
  it("자료실·고객이력·통화만 있다", () => {
    const kinds: TacitSourceKind[] = ["자료실", "고객이력", "통화"];
    expect(kinds).toHaveLength(3);
    // 돌파구 쪽 판별 함수와 같은 목록을 본다 — 한쪽만 늘면 여기서 걸린다.
    for (const k of kinds) expect(sourceKindOf(k)).toBe(k);
    expect(sourceKindOf("웹검색")).toBeNull();
  });

  it("목록에 없는 값은 타입에서 막힌다", () => {
    // @ts-expect-error 「웹검색」은 TacitSourceKind 가 아니다
    const bad: TacitSourceKind = "웹검색";
    expect(bad).toBe("웹검색");
  });
});

describe("TacitSnippet — 칸 네 개(url 은 없어도 되고 null 도 된다)", () => {
  it("url 없이 만들 수 있고, null 도 넣을 수 있다", () => {
    const withoutUrl: TacitSnippet = { kind: "자료실", ref: "채용 우회", text: "2명 추가 채용 후 신청" };
    const withNull: TacitSnippet = { kind: "통화", ref: "2026-08-01 통화", text: "담당자 확인", url: null };
    const withUrl: TacitSnippet = { kind: "고객이력", ref: "위들리테크", text: "작년 선정", url: "https://example.com" };
    expect([withoutUrl.url, withNull.url, withUrl.url]).toEqual([undefined, null, "https://example.com"]);
  });

  it("모르는 칸은 넣을 수 없다", () => {
    // @ts-expect-error `note` 라는 칸은 없다
    const bad: TacitSnippet = { kind: "자료실", ref: "r", text: "t", note: "x" };
    expect(bad.ref).toBe("r");
  });
});
