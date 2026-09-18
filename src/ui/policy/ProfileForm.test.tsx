import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import ProfileForm from "./ProfileForm";
import type { BusinessProfile } from "../../engine/match-engine";

/**
 * 시군구 통과(리뷰 F1) — 칸은 만들지 않고, 프리필 값이 buildProfile 로 다시 실리는지 잰다.
 *
 * 이 저장소엔 jsdom·@testing-library/react 가 없다. 상태가 바뀌는 이야기는
 * `profile-form-prefill.test.tsx` 와 같은 손React 로 그린 나무를 다시 그려 잰다.
 */

const REACT_INTERNALS = (
  React as unknown as {
    __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE: { H: unknown };
  }
).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;

/** 그려 낸 나무 — 진짜 DOM 이 아니라 「무엇을 그리라고 했는가」다. */
type 마디 = { type: unknown; props: Record<string, unknown> };
type 그림 = 마디 | string | number | null | 그림[];

class 손React {
  /** 부품 한 자리(자리이름)마다의 상태 칸. 화면에서 빠지면 통째로 버린다 = 사라짐. */
  private 칸 = new Map<string, unknown[]>();
  private 이번에본 = new Set<string>();
  private 지금칸: unknown[] = [];
  private 지금자리 = 0;
  private 뿌리: React.ReactElement | null = null;
  tree: 그림 = null;

  private 살림 = {
    useState: (init: unknown) => {
      const 칸 = this.지금칸;
      const i = this.지금자리++;
      if (i >= 칸.length) 칸[i] = typeof init === "function" ? (init as () => unknown)() : init;
      const 넣기 = (다음: unknown) => {
        칸[i] = typeof 다음 === "function" ? (다음 as (앞: unknown) => unknown)(칸[i]) : 다음;
      };
      return [칸[i], 넣기];
    },
    useRef: (init: unknown) => {
      const 칸 = this.지금칸;
      const i = this.지금자리++;
      if (i >= 칸.length) 칸[i] = { current: init };
      return 칸[i];
    },
    useMemo: (fn: () => unknown) => fn(),
    useCallback: (fn: unknown) => fn,
    useEffect: () => {},
    useLayoutEffect: () => {},
  };

  render(el: React.ReactElement): 그림 {
    if (!REACT_INTERNALS || !("H" in REACT_INTERNALS)) {
      throw new Error("React 가 hook 을 꺼내 쓰는 자리를 못 찾았다 — 이 시험의 작은 살림을 손봐야 한다");
    }
    const 앞살림 = REACT_INTERNALS.H;
    REACT_INTERNALS.H = this.살림;
    try {
      this.뿌리 = el;
      this.이번에본.clear();
      this.tree = this.그리기(el, "0");
      for (const 자리 of [...this.칸.keys()]) {
        if (!this.이번에본.has(자리)) this.칸.delete(자리);
      }
      return this.tree;
    } finally {
      REACT_INTERNALS.H = 앞살림;
    }
  }

  다시그리기(): 그림 {
    if (!this.뿌리) throw new Error("먼저 render 를 부르세요");
    return this.render(this.뿌리);
  }

  private 그리기(node: unknown, 자리: string): 그림 {
    if (node === null || node === undefined || typeof node === "boolean") return null;
    if (typeof node === "string" || typeof node === "number") return node;
    if (Array.isArray(node)) return node.map((c, i) => this.그리기(c, `${자리}.${i}`));
    if (!React.isValidElement(node)) return null;

    const el = node as React.ReactElement<Record<string, unknown>>;
    if (typeof el.type === "function") {
      const 이름 = (el.type as { name?: string }).name || "익명";
      const 열쇠 = `${자리}<${이름}>`;
      this.이번에본.add(열쇠);
      let 칸 = this.칸.get(열쇠);
      if (!칸) {
        칸 = [];
        this.칸.set(열쇠, 칸);
      }
      const 앞칸 = this.지금칸;
      const 앞자리 = this.지금자리;
      this.지금칸 = 칸;
      this.지금자리 = 0;
      let 결과: unknown;
      try {
        결과 = (el.type as (p: Record<string, unknown>) => unknown)(el.props);
      } finally {
        this.지금칸 = 앞칸;
        this.지금자리 = 앞자리;
      }
      return this.그리기(결과, `${열쇠}.본문`);
    }

    const props = { ...el.props };
    props.children = this.그리기(el.props.children, `${자리}.자식`);
    return { type: el.type, props };
  }
}

function* 모든마디(node: 그림): Generator<마디> {
  if (node === null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const c of node) yield* 모든마디(c);
    return;
  }
  yield node;
  yield* 모든마디(node.props.children as 그림);
}

function 글자(node: 그림): string {
  if (node === null) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(글자).join(" ");
  return 글자(node.props.children as 그림);
}

function 칸찾기(tree: 그림, 안내문접두: string): 마디 | null {
  for (const m of 모든마디(tree)) {
    const p = m.props.placeholder;
    if (typeof p === "string" && p.startsWith(안내문접두)) return m;
  }
  return null;
}

function 단추찾기(tree: 그림, 이름: string): 마디 | null {
  for (const m of 모든마디(tree)) {
    if (m.type === "button" && 글자(m.props.children as 그림).trim() === 이름) return m;
  }
  return null;
}

function 누르기(화면: 손React, 이름: string): 그림 {
  const b = 단추찾기(화면.tree, 이름);
  if (!b) throw new Error(`「${이름}」 단추가 화면에 없다`);
  (b.props.onClick as () => void)();
  return 화면.다시그리기();
}

function 적기(화면: 손React, 안내문접두: string, 값: string): 그림 {
  const input = 칸찾기(화면.tree, 안내문접두);
  if (!input) throw new Error(`「${안내문접두}」 칸이 화면에 없다`);
  (input.props.onChange as (e: { target: { value: string } }) => void)({ target: { value: 값 } });
  return 화면.다시그리기();
}

function 선택칸찾기(tree: 그림, 이름: string): 마디 | null {
  for (const m of 모든마디(tree)) {
    if (m.type !== "label") continue;
    const kids = m.props.children as 그림;
    let 표기 = "";
    let select: 마디 | null = null;
    for (const c of 모든마디(kids)) {
      if (c.type === "span" && 표기 === "") 표기 = 글자(c).trim();
      if (c.type === "select") select = c;
    }
    if (표기 === 이름 && select) return select;
  }
  return null;
}

function 고르기(화면: 손React, 이름: string, 값: string): 그림 {
  const s = 선택칸찾기(화면.tree, 이름);
  if (!s) throw new Error(`「${이름}」 선택칸이 화면에 없다`);
  (s.props.onChange as (e: { target: { value: string } }) => void)({ target: { value: 값 } });
  return 화면.다시그리기();
}

const 검색안내 = "기존 고객 검색";

function 프리필붙이기(data: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ json: async () => ({ success: true, data }) })),
  );
}

async function 불러온뒤그리기(화면: 손React, 상호: string): Promise<그림> {
  const 안내 = `${상호} 정보를 불러왔습니다`;
  for (let i = 0; i < 20; i++) {
    await Promise.resolve();
    const tree = 화면.다시그리기();
    if (글자(tree).includes(안내)) return tree;
  }
  throw new Error(`고객을 불러오지 못했다: ${글자(화면.tree)}`);
}

async function 고객불러오기(화면: 손React, data: BusinessProfile, 검색어: string) {
  프리필붙이기(data);
  if (!칸찾기(화면.tree, 검색안내)) 누르기(화면, "조건 수정");
  적기(화면, 검색안내, 검색어);
  누르기(화면, "불러오기");
  await 불러온뒤그리기(화면, data.companyName || 검색어);
}

function 진단받기(): { 받은: BusinessProfile[]; 화면: 손React } {
  const 받은: BusinessProfile[] = [];
  const 화면 = new 손React();
  화면.render(
    <ProfileForm
      onDiagnose={async (p) => {
        받은.push(p);
        return false;
      }}
      diagnosing={false}
      prefillEndpoint="/api/policy-match/prefill"
    />,
  );
  return { 받은, 화면 };
}

function 진단하기(화면: 손React, 받은: BusinessProfile[]): BusinessProfile {
  const 앞 = 받은.length;
  누르기(화면, "매칭 진단");
  if (받은.length !== 앞 + 1) throw new Error("매칭 진단이 프로필을 넘기지 않았다");
  return 받은[받은.length - 1];
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ProfileForm — 시군구는 칸 없이 통과시킨다(리뷰 F1)", () => {
  it("프리필 응답에 regionSigungu 가 있으면 buildProfile 결과에 그대로 실린다", async () => {
    const { 받은, 화면 } = 진단받기();
    await 고객불러오기(화면, {
      companyName: "위들리테크",
      region: "경기",
      regionSigungu: "안양시",
    }, "위들리테크");

    const p = 진단하기(화면, 받은);
    expect(p.regionSigungu).toBe("안양시");
    expect(p.region).toBe("경기");
  });

  it("프리필에 regionSigungu 가 없으면 실리지 않는다", async () => {
    const { 받은, 화면 } = 진단받기();
    await 고객불러오기(화면, {
      companyName: "위들리테크",
      region: "경기",
    }, "위들리테크");

    const p = 진단하기(화면, 받은);
    expect(p.regionSigungu).toBeUndefined();
    expect("regionSigungu" in p).toBe(false);
    expect(p.region).toBe("경기");
  });

  it("다른 고객을 불러와 값이 없으면 앞 고객 값이 남지 않는다", async () => {
    const { 받은, 화면 } = 진단받기();
    await 고객불러오기(화면, {
      companyName: "위들리테크",
      region: "경기",
      regionSigungu: "안양시",
    }, "위들리테크");
    expect(진단하기(화면, 받은).regionSigungu).toBe("안양시");

    await 고객불러오기(화면, {
      companyName: "다른회사",
      region: "서울",
    }, "다른회사");
    const p = 진단하기(화면, 받은);
    expect(p.companyName).toBe("다른회사");
    expect(p.region).toBe("서울");
    expect(p.regionSigungu).toBeUndefined();
    expect("regionSigungu" in p).toBe(false);
  });

  it("사람이 소재지를 바꾸면 시군구가 비워진다", async () => {
    const { 받은, 화면 } = 진단받기();
    await 고객불러오기(화면, {
      companyName: "위들리테크",
      region: "경기",
      regionSigungu: "안양시",
    }, "위들리테크");

    고르기(화면, "소재지", "서울");
    const p = 진단하기(화면, 받은);
    expect(p.region).toBe("서울");
    expect(p.regionSigungu).toBeUndefined();
    expect("regionSigungu" in p).toBe(false);
  });
});
