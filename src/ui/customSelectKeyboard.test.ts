import { describe, it, expect } from "vitest";
import {
  nextIndex,
  typeAheadIndex,
  appendTypeAhead,
  isTypeAheadChar,
  initialHighlight,
  typeAheadStart,
  TYPE_AHEAD_RESET_MS,
  isTypeAheadActive,
} from "./selectKeyboard";

// 실제 화면에서 쓰는 것과 같은 한글 라벨로 검증한다.
const KOREAN = [
  { label: "통합 DB 관리" },
  { label: "1차 DB 관리" },
  { label: "정산 DB" },
  { label: "통계" },
];

describe("nextIndex", () => {
  it("아래로 한 칸씩 이동한다", () => {
    expect(nextIndex(0, 4, 1)).toBe(1);
    expect(nextIndex(1, 4, 1)).toBe(2);
    expect(nextIndex(2, 4, 1)).toBe(3);
  });
  it("위로 한 칸씩 이동한다", () => {
    expect(nextIndex(3, 4, -1)).toBe(2);
    expect(nextIndex(1, 4, -1)).toBe(0);
  });
  it("끝에서 반대편으로 순환한다", () => {
    expect(nextIndex(3, 4, 1)).toBe(0);
    expect(nextIndex(0, 4, -1)).toBe(3);
  });
  it("옵션이 하나면 제자리에 머문다", () => {
    expect(nextIndex(0, 1, 1)).toBe(0);
    expect(nextIndex(0, 1, -1)).toBe(0);
  });
  it("옵션이 없으면(len 0) -1", () => {
    expect(nextIndex(-1, 0, 1)).toBe(-1);
    expect(nextIndex(0, 0, -1)).toBe(-1);
    expect(nextIndex(3, 0, 1)).toBe(-1);
  });
  it("하이라이트가 없을 때(-1) 아래는 첫 항목·위는 마지막 항목", () => {
    expect(nextIndex(-1, 4, 1)).toBe(0);
    expect(nextIndex(-1, 4, -1)).toBe(3);
  });
  it("범위를 벗어난 current도 안전하게 처리한다", () => {
    expect(nextIndex(99, 4, 1)).toBe(0);
    expect(nextIndex(99, 4, -1)).toBe(3);
  });
});

describe("typeAheadIndex", () => {
  it("한글 라벨의 첫 글자로 찾는다", () => {
    expect(typeAheadIndex(KOREAN, "통", 0)).toBe(0);
    expect(typeAheadIndex(KOREAN, "정", 0)).toBe(2);
  });
  it("한글 여러 글자로 좁혀 찾는다", () => {
    expect(typeAheadIndex(KOREAN, "통계", 0)).toBe(3);
    expect(typeAheadIndex(KOREAN, "통합", 0)).toBe(0);
  });
  it("공백이 포함된 한글 라벨도 찾는다", () => {
    expect(typeAheadIndex(KOREAN, "통합 D", 0)).toBe(0);
    expect(typeAheadIndex(KOREAN, "1차 DB", 0)).toBe(1);
  });
  it("시작 위치(from)부터 찾고 끝에 닿으면 처음으로 순환한다", () => {
    // from=1 이므로 인덱스 0의 "통합 DB 관리"는 한 바퀴 돈 뒤에 만난다.
    expect(typeAheadIndex(KOREAN, "통", 1)).toBe(3); // "통계"
    expect(typeAheadIndex(KOREAN, "통", 0)).toBe(0); // "통합 DB 관리"
    expect(typeAheadIndex(KOREAN, "정", 3)).toBe(2); // 순환해서 뒤에서 앞으로
  });
  it("대소문자를 구분하지 않는다", () => {
    const opts = [{ label: "Alpha" }, { label: "beta" }, { label: "GAMMA" }];
    expect(typeAheadIndex(opts, "a", 0)).toBe(0);
    expect(typeAheadIndex(opts, "A", 0)).toBe(0);
    expect(typeAheadIndex(opts, "B", 0)).toBe(1);
    expect(typeAheadIndex(opts, "b", 0)).toBe(1);
    expect(typeAheadIndex(opts, "gam", 0)).toBe(2);
    expect(typeAheadIndex(opts, "GaM", 0)).toBe(2);
  });
  it("'포함'이 아니라 '시작'으로만 찾는다", () => {
    expect(typeAheadIndex(KOREAN, "DB", 0)).toBe(-1); // 라벨 중간의 DB는 안 걸린다
    expect(typeAheadIndex(KOREAN, "관리", 0)).toBe(-1);
  });
  it("맞는 게 없으면 -1", () => {
    expect(typeAheadIndex(KOREAN, "없는값", 0)).toBe(-1);
    expect(typeAheadIndex(KOREAN, "z", 0)).toBe(-1);
  });
  it("빈 버퍼·빈 목록이면 -1", () => {
    expect(typeAheadIndex(KOREAN, "", 0)).toBe(-1);
    expect(typeAheadIndex([], "통", 0)).toBe(-1);
  });
  it("범위를 벗어난 from은 처음부터 찾는다", () => {
    expect(typeAheadIndex(KOREAN, "통", -1)).toBe(0);
    expect(typeAheadIndex(KOREAN, "통", 99)).toBe(0);
  });
});

describe("appendTypeAhead", () => {
  it("시간 안에 이어 치면 버퍼에 붙는다", () => {
    expect(appendTypeAhead("통", "합", 100, 700)).toBe("통합");
    expect(appendTypeAhead("", "통", 0, 700)).toBe("통");
    expect(appendTypeAhead("al", "p", 699, 700)).toBe("alp");
  });
  it("경계값(elapsed === resetMs)은 아직 이어진다", () => {
    expect(appendTypeAhead("통", "합", 700, 700)).toBe("통합");
  });
  it("쉬는 시간이 넘으면 버퍼를 버리고 새로 시작한다", () => {
    expect(appendTypeAhead("통", "합", 701, 700)).toBe("합");
    expect(appendTypeAhead("통합", "정", 5000, 700)).toBe("정");
  });
  it("resetMs 기본값은 700ms", () => {
    expect(appendTypeAhead("통", "합", 600)).toBe("통합");
    expect(appendTypeAhead("통", "합", 800)).toBe("합");
    expect(TYPE_AHEAD_RESET_MS).toBe(700);
  });
});

describe("isTypeAheadChar", () => {
  it("한 글자(한글·영문·숫자·공백)는 타자 검색 대상", () => {
    expect(isTypeAheadChar("통")).toBe(true);
    expect(isTypeAheadChar("a")).toBe(true);
    expect(isTypeAheadChar("1")).toBe(true);
    expect(isTypeAheadChar(" ")).toBe(true);
  });
  it("기능키 이름은 대상이 아니다", () => {
    for (const k of ["Enter", "ArrowDown", "ArrowUp", "Escape", "Tab", "Home", "End", "Shift"]) {
      expect(isTypeAheadChar(k)).toBe(false);
    }
  });
});

describe("initialHighlight", () => {
  it("ArrowDown으로 열면 첫 항목", () => {
    expect(initialHighlight("first", 4, 2)).toBe(0);
  });
  it("ArrowUp으로 열면 마지막 항목", () => {
    expect(initialHighlight("last", 4, 2)).toBe(3);
  });
  it("Enter/Space로 열면 현재 선택 항목", () => {
    expect(initialHighlight("selected", 4, 2)).toBe(2);
  });
  it("선택된 게 없으면 첫 항목", () => {
    expect(initialHighlight("selected", 4, -1)).toBe(0);
    expect(initialHighlight("selected", 4, 99)).toBe(0);
  });
  it("옵션이 없으면 -1", () => {
    expect(initialHighlight("first", 0, -1)).toBe(-1);
    expect(initialHighlight("last", 0, -1)).toBe(-1);
    expect(initialHighlight("selected", 0, 0)).toBe(-1);
  });
});

describe("typeAheadStart", () => {
  it("첫 글자는 다음 항목부터 찾아 같은 글자 연타 시 후보를 순환한다", () => {
    expect(typeAheadStart("통", 0, 4)).toBe(1);
    expect(typeAheadStart("통", 3, 4)).toBe(0);
  });
  it("이어 치는 중이면 현재 항목부터 찾는다", () => {
    expect(typeAheadStart("통합", 0, 4)).toBe(0);
    expect(typeAheadStart("통합 D", 2, 4)).toBe(2);
  });
  it("하이라이트가 없으면 처음부터", () => {
    expect(typeAheadStart("통", -1, 4)).toBe(0);
    expect(typeAheadStart("통합", -1, 4)).toBe(0);
  });
  it("옵션이 없으면 -1", () => {
    expect(typeAheadStart("통", 0, 0)).toBe(-1);
  });
});

// 실제 키 입력 흐름을 helper 조합으로 재현한다(컴포넌트가 이 순서대로 호출한다).
describe("타자 검색 시나리오 (helper 조합)", () => {
  it("'통' → '합' 이어치면 '통합 DB 관리'로 간다", () => {
    let buffer = "";
    let highlight = -1;

    buffer = appendTypeAhead(buffer, "통", 0, TYPE_AHEAD_RESET_MS);
    highlight = typeAheadIndex(KOREAN, buffer, typeAheadStart(buffer, highlight, KOREAN.length));
    expect(highlight).toBe(0); // "통합 DB 관리"

    buffer = appendTypeAhead(buffer, "합", 120, TYPE_AHEAD_RESET_MS);
    expect(buffer).toBe("통합");
    highlight = typeAheadIndex(KOREAN, buffer, typeAheadStart(buffer, highlight, KOREAN.length));
    expect(highlight).toBe(0);
  });

  it("'통' 연타는 '통'으로 시작하는 항목들을 순환한다", () => {
    let buffer = "";
    let highlight = -1;

    buffer = appendTypeAhead(buffer, "통", 0, TYPE_AHEAD_RESET_MS);
    highlight = typeAheadIndex(KOREAN, buffer, typeAheadStart(buffer, highlight, KOREAN.length));
    expect(highlight).toBe(0); // "통합 DB 관리"

    // 800ms 쉬고 다시 '통' → 버퍼 초기화 후 다음 후보로
    buffer = appendTypeAhead(buffer, "통", 800, TYPE_AHEAD_RESET_MS);
    expect(buffer).toBe("통");
    highlight = typeAheadIndex(KOREAN, buffer, typeAheadStart(buffer, highlight, KOREAN.length));
    expect(highlight).toBe(3); // "통계"

    buffer = appendTypeAhead(buffer, "통", 800, TYPE_AHEAD_RESET_MS);
    highlight = typeAheadIndex(KOREAN, buffer, typeAheadStart(buffer, highlight, KOREAN.length));
    expect(highlight).toBe(0); // 다시 "통합 DB 관리"
  });

  it("맞는 항목이 없으면 하이라이트는 그대로 둔다(-1 반환)", () => {
    const buffer = appendTypeAhead("", "z", 0, TYPE_AHEAD_RESET_MS);
    expect(typeAheadIndex(KOREAN, buffer, typeAheadStart(buffer, 2, KOREAN.length))).toBe(-1);
  });
});

// 글자를 한 번 치면 버퍼가 영영 '있음'으로 남아 스페이스가 선택 대신 글자 입력으로 먹히던 문제(코드리뷰 M2).
describe("isTypeAheadActive — 타자 검색 버퍼 만료", () => {
  it("버퍼가 비었으면 꺼짐(스페이스 = 선택)", () => {
    expect(isTypeAheadActive("", 0)).toBe(false);
  });
  it("친 직후에는 켜짐(스페이스 = 라벨의 공백)", () => {
    expect(isTypeAheadActive("통합", 100)).toBe(true);
  });
  it("만료 시간이 지나면 꺼짐 — 스페이스로 다시 선택할 수 있다", () => {
    expect(isTypeAheadActive("통합", 701)).toBe(false);
    expect(isTypeAheadActive("통합", 700)).toBe(true); // 경계 포함
  });
});
