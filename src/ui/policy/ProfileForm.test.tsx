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

function 엔터로불러오기(화면: 손React): 그림 {
  const input = 칸찾기(화면.tree, 검색안내);
  if (!input) throw new Error("기존 고객 검색 칸이 화면에 없다");
  (input.props.onKeyDown as (e: { key: string; nativeEvent: { isComposing: boolean } }) => void)({
    key: "Enter",
    nativeEvent: { isComposing: false },
  });
  return 화면.다시그리기();
}

function 지연응답붙이기() {
  type 응답 = { json: () => Promise<unknown> };
  type 대기 = { resolve: (value: 응답) => void; reject: (reason?: unknown) => void };
  const 대기중 = new Map<string, 대기>();
  vi.stubGlobal("fetch", vi.fn((raw: string | URL | Request) => {
    const query = new URL(String(raw), "http://local.test").searchParams.get("query") ?? "";
    return new Promise<응답>((resolve, reject) => {
      대기중.set(query, { resolve, reject });
    });
  }));
  const 꺼내기 = (query: string): 대기 => {
    const waiting = 대기중.get(query);
    if (!waiting) throw new Error(`「${query}」 요청이 시작되지 않았다`);
    return waiting;
  };
  return {
    성공: (query: string, data: BusinessProfile | null) => {
      꺼내기(query).resolve({ json: async () => ({ success: true, data }) });
    },
    실패: (query: string) => {
      꺼내기(query).reject(new Error("synthetic network failure"));
    },
  };
}

async function 비동기흘리기(화면: 손React): Promise<그림> {
  let tree = 화면.tree;
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
    tree = 화면.다시그리기();
  }
  return tree;
}

async function 안내기다리기(화면: 손React, 안내: string): Promise<그림> {
  for (let i = 0; i < 20; i++) {
    await Promise.resolve();
    const tree = 화면.다시그리기();
    if (글자(tree).includes(안내)) return tree;
  }
  throw new Error(`안내를 기다렸지만 나오지 않았다: ${안내}`);
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

describe("ProfileForm — 기존 고객의 판정 조건을 빠짐없이 채운다", () => {
  it("기업 규모·인증·특허·신용점수·기존 대출을 화면과 진단 입력에 보존한다", async () => {
    const { 받은, 화면 } = 진단받기();
    await 고객불러오기(화면, {
      companyName: "위들리테크",
      companyScale: "중소기업",
      hasCert: false,
      hasPatent: true,
      creditScore: 780,
      hasExistingLoan: false,
    }, "위들리테크");

    expect(선택칸찾기(화면.tree, "기업 규모")?.props.value).toBe("중소기업");
    expect(선택칸찾기(화면.tree, "기업인증 보유")?.props.value).toBe("no");
    expect(선택칸찾기(화면.tree, "특허 보유")?.props.value).toBe("yes");
    expect(칸찾기(화면.tree, "300~1000")?.props.value).toBe("780");
    expect(선택칸찾기(화면.tree, "기존 대출")?.props.value).toBe("no");
    expect(진단하기(화면, 받은)).toMatchObject({
      companyScale: "중소기업",
      hasCert: false,
      hasPatent: true,
      creditScore: 780,
      hasExistingLoan: false,
    });
  });

  it("숫자 0도 화면에 그대로 채우고, 다음 고객에게 없는 값은 모두 모름으로 비운다", async () => {
    const { 받은, 화면 } = 진단받기();
    await 고객불러오기(화면, {
      companyName: "첫회사",
      companyScale: "소상공인",
      hasCert: true,
      hasPatent: false,
      creditScore: 0,
      hasExistingLoan: true,
    }, "첫회사");

    expect(선택칸찾기(화면.tree, "기업 규모")?.props.value).toBe("소상공인");
    expect(선택칸찾기(화면.tree, "기업인증 보유")?.props.value).toBe("yes");
    expect(선택칸찾기(화면.tree, "특허 보유")?.props.value).toBe("no");
    expect(칸찾기(화면.tree, "300~1000")?.props.value).toBe("0");
    expect(선택칸찾기(화면.tree, "기존 대출")?.props.value).toBe("yes");

    await 고객불러오기(화면, { companyName: "다음회사" }, "다음회사");
    expect(선택칸찾기(화면.tree, "기업 규모")?.props.value).toBe("");
    expect(선택칸찾기(화면.tree, "기업인증 보유")?.props.value).toBe("");
    expect(선택칸찾기(화면.tree, "특허 보유")?.props.value).toBe("");
    expect(칸찾기(화면.tree, "300~1000")?.props.value).toBe("");
    expect(선택칸찾기(화면.tree, "기존 대출")?.props.value).toBe("");
    const p = 진단하기(화면, 받은);
    for (const key of ["companyScale", "hasCert", "hasPatent", "creditScore", "hasExistingLoan"]) {
      expect(key in p, `${key}가 앞 고객에서 남았다`).toBe(false);
    }
  });
});

describe("ProfileForm — 가장 최근 고객 검색만 반영한다", () => {
  it("B가 먼저 끝나고 A가 늦게 끝나도 B 고객의 값이 남는다", async () => {
    const 요청 = 지연응답붙이기();
    const { 받은, 화면 } = 진단받기();
    적기(화면, 검색안내, "A회사");
    누르기(화면, "불러오기");
    적기(화면, 검색안내, "B회사");
    엔터로불러오기(화면);

    요청.성공("B회사", { companyName: "B회사", companyScale: "소상공인", hasCert: false });
    await 안내기다리기(화면, "B회사 정보를 불러왔습니다");
    요청.성공("A회사", { companyName: "A회사", companyScale: "중소기업", hasCert: true });
    await 비동기흘리기(화면);

    expect(진단하기(화면, 받은)).toMatchObject({
      companyName: "B회사",
      companyScale: "소상공인",
      hasCert: false,
    });
  });

  it("A의 늦은 오류가 B의 대기 표시를 끝내거나 오류 안내로 바꾸지 않는다", async () => {
    const 요청 = 지연응답붙이기();
    const { 받은, 화면 } = 진단받기();
    적기(화면, 검색안내, "A회사");
    누르기(화면, "불러오기");
    적기(화면, 검색안내, "B회사");
    엔터로불러오기(화면);

    요청.실패("A회사");
    let tree = await 비동기흘리기(화면);
    expect(글자(tree)).toContain("불러오는 중…");
    expect(글자(tree)).not.toContain("고객 정보를 불러오지 못했습니다");

    요청.성공("B회사", { companyName: "B회사", hasPatent: false });
    tree = await 안내기다리기(화면, "B회사 정보를 불러왔습니다");
    expect(글자(tree)).not.toContain("불러오는 중…");
    expect(진단하기(화면, 받은)).toMatchObject({ companyName: "B회사", hasPatent: false });
  });

  it("최신 B를 찾지 못했으면 늦은 A 성공을 무시하고 찾지 못함을 유지한다", async () => {
    const 요청 = 지연응답붙이기();
    const { 받은, 화면 } = 진단받기();
    적기(화면, 검색안내, "A회사");
    누르기(화면, "불러오기");
    적기(화면, 검색안내, "B회사");
    엔터로불러오기(화면);

    요청.성공("B회사", null);
    await 안내기다리기(화면, "찾지 못했습니다");
    요청.성공("A회사", { companyName: "A회사", companyScale: "중소기업" });
    const tree = await 비동기흘리기(화면);
    expect(글자(tree)).toContain("찾지 못했습니다");
    const p = 진단하기(화면, 받은);
    expect(p.companyName).toBeUndefined();
    expect(p.companyScale).toBeUndefined();
  });

  it("최신 검색어가 비었으면 늦은 A 성공을 무시하고 입력 안내를 유지한다", async () => {
    const 요청 = 지연응답붙이기();
    const { 받은, 화면 } = 진단받기();
    적기(화면, 검색안내, "A회사");
    누르기(화면, "불러오기");
    적기(화면, 검색안내, "");
    let tree = 엔터로불러오기(화면);
    expect(글자(tree)).toContain("사업자번호 또는 상호를 입력하세요");
    expect(글자(tree)).not.toContain("불러오는 중…");

    요청.성공("A회사", { companyName: "A회사", companyScale: "중소기업" });
    tree = await 비동기흘리기(화면);
    expect(글자(tree)).toContain("사업자번호 또는 상호를 입력하세요");
    const p = 진단하기(화면, 받은);
    expect(p.companyName).toBeUndefined();
    expect(p.companyScale).toBeUndefined();
  });
});
