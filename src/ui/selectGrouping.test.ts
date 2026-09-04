import { describe, it, expect } from "vitest";
import { planGroupedOptions, splitGroupHeader } from "./selectGrouping";

describe("planGroupedOptions", () => {
  it("그룹이 연속이면 그룹마다 헤더 1회 + 원래 인덱스로 옵션을 낸다", () => {
    const rows = planGroupedOptions([
      { group: "계약정보" }, { group: "계약정보" }, { group: "정산정보" },
    ]);
    expect(rows).toEqual([
      { kind: "header", label: "계약정보" },
      { kind: "option", index: 0 },
      { kind: "option", index: 1 },
      { kind: "header", label: "정산정보" },
      { kind: "option", index: 2 },
    ]);
  });

  it("같은 그룹이 비연속으로 다시 나와도 헤더는 한 번만 낸다(중복 key 방지)", () => {
    const rows = planGroupedOptions([
      { group: "계약정보" }, { group: "정산정보" }, { group: "환불정보" }, { group: "계약정보" },
    ]);
    const headers = rows.filter((r) => r.kind === "header").map((r) => (r as { label: string }).label);
    expect(headers).toEqual(["계약정보", "정산정보", "환불정보"]); // 계약정보 두 번 아님
    // 두 번째 계약정보(index 3) 옵션은 살아 있어야 한다(헤더만 생략).
    expect(rows).toContainEqual({ kind: "option", index: 3 });
  });

  it("그룹 없는 옵션은 헤더 없이 옵션만 낸다", () => {
    const rows = planGroupedOptions([{}, { group: "계약정보" }, {}]);
    expect(rows).toEqual([
      { kind: "option", index: 0 },
      { kind: "header", label: "계약정보" },
      { kind: "option", index: 1 },
      { kind: "option", index: 2 },
    ]);
  });
});

describe("splitGroupHeader", () => {
  it("'메인 | 서브'를 메인 섹션·서브 탭으로 나눈다", () => {
    expect(splitGroupHeader("경정청구 | 계약정보")).toEqual({ main: "경정청구", sub: "계약정보" });
  });

  it("' | '가 없으면 null(다른 드롭다운은 종전대로 한 덩어리 헤더)", () => {
    expect(splitGroupHeader("계약정보")).toBeNull();
    expect(splitGroupHeader("기타(설정값)")).toBeNull();
  });

  it("서브에 '|'가 더 있어도 첫 ' | '에서만 나눈다", () => {
    expect(splitGroupHeader("경정청구 | 계약 | 정보")).toEqual({ main: "경정청구", sub: "계약 | 정보" });
  });

  it("한쪽이 비면 null(깨진 라벨 방어)", () => {
    expect(splitGroupHeader(" | 계약정보")).toBeNull();
    expect(splitGroupHeader("경정청구 | ")).toBeNull();
  });
});
