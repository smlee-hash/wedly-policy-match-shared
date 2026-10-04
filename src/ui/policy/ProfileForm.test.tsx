import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import ProfileForm from "./ProfileForm";
import type { BusinessProfile } from "../../engine/match-engine";

/**
 * 사업자 정보 칸 형식 — 시군구 통과(리뷰 F1)·옛 응답 → 새 칸 옮기기·칸 형식(마스크·칩·두 점수)을 잰다.
 * 칸 덩어리는 `data-k`(칸 열쇠)로 찾는다.
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

// ── 칸 단위 도우미 — 각 칸 덩어리는 data-k(칸 열쇠)를 달고 있다 ──────────────
// 열쇠: name · bizno · corp · industry · address · founded · revenue · employees · scale ·
//       tax · cert · patent · loan · nice · kcb  (모두 15칸)
function 칸덩어리(tree: 그림, 열쇠: string): 마디 {
  for (const m of 모든마디(tree)) {
    if (m.props["data-k"] === 열쇠) return m;
  }
  throw new Error(`「${열쇠}」 칸이 화면에 없다`);
}

function 칸입력(tree: 그림, 열쇠: string): 마디 {
  for (const m of 모든마디(칸덩어리(tree, 열쇠).props.children as 그림)) {
    if (m.type === "input") return m;
  }
  throw new Error(`「${열쇠}」 칸에 입력 칸이 없다`);
}

function 칸값(tree: 그림, 열쇠: string): unknown {
  return 칸입력(tree, 열쇠).props.value;
}

function 칸글자(tree: 그림, 열쇠: string): string {
  return 글자(칸덩어리(tree, 열쇠));
}

function 칸적기(화면: 손React, 열쇠: string, 값: string): 그림 {
  (칸입력(화면.tree, 열쇠).props.onChange as (e: { target: { value: string } }) => void)({ target: { value: 값 } });
  return 화면.다시그리기();
}

/** 그 칸에서 눌린(aria-pressed=true) 단추 글자들 — 단추·칩 칸의 현재 값. */
function 눌린단추들(tree: 그림, 열쇠: string): string[] {
  const out: string[] = [];
  for (const m of 모든마디(칸덩어리(tree, 열쇠).props.children as 그림)) {
    if (m.type === "button" && m.props["aria-pressed"] === true) out.push(글자(m.props.children as 그림).trim());
  }
  return out;
}

function 칸단추누르기(화면: 손React, 열쇠: string, 이름: string): 그림 {
  for (const m of 모든마디(칸덩어리(화면.tree, 열쇠).props.children as 그림)) {
    if (m.type === "button" && 글자(m.props.children as 그림).trim() === 이름) {
      (m.props.onClick as () => void)();
      return 화면.다시그리기();
    }
  }
  throw new Error(`「${열쇠}」 칸에 「${이름}」 단추가 없다`);
}

function 칸단추들(tree: 그림, 열쇠: string): 마디[] {
  return [...모든마디(칸덩어리(tree, 열쇠).props.children as 그림)].filter((m) => m.type === "button");
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

  it("사람이 사업장 주소를 고치면 앞에서 불러온 시군구가 남지 않는다", async () => {
    const { 받은, 화면 } = 진단받기();
    await 고객불러오기(화면, {
      companyName: "위들리테크",
      region: "경기",
      regionSigungu: "안양시",
    }, "위들리테크");

    // 주소 칸은 비어 있어도 불러온 소재지는 「지역 조건」에 보인다(칸 없이 값만 통과하는 것이 아니다).
    expect(칸글자(화면.tree, "address")).toContain("지역 조건: 경기 · 안양시");

    칸적기(화면, "address", "서울 중구 세종대로 110");
    const p = 진단하기(화면, 받은);
    expect(p.region).toBe("서울");
    expect(p.regionSigungu).not.toBe("안양시");
    expect("regionSigungu" in p).toBe(false); // 중구는 여러 시도에 있어 사전이 비운다
  });

  it("주소를 읽을 수 없는 글자로 고치면 앞 고객의 소재지도 함께 비워진다", async () => {
    const { 받은, 화면 } = 진단받기();
    await 고객불러오기(화면, {
      companyName: "위들리테크",
      region: "경기",
      regionSigungu: "안양시",
    }, "위들리테크");

    칸적기(화면, "address", "아직 모르겠어요");
    const p = 진단하기(화면, 받은);
    expect("region" in p).toBe(false);
    expect("regionSigungu" in p).toBe(false);
    expect("businessAddress" in p).toBe(false);
  });
});

describe("ProfileForm — 기존 고객의 판정 조건을 빠짐없이 채운다(옛 응답 → 새 칸)", () => {
  it("옛 응답의 아니오 값은 새 칸으로 옮겨 채우고, 진단 입력에도 같은 값이 간다", async () => {
    const { 받은, 화면 } = 진단받기();
    await 고객불러오기(화면, {
      companyName: "위들리테크",
      companyScale: "중소기업",
      hasCert: false,
      hasPatent: false,
      creditScore: 780,
      hasExistingLoan: false,
    }, "위들리테크");

    expect(눌린단추들(화면.tree, "scale")).toEqual(["중소기업"]);
    expect(눌린단추들(화면.tree, "cert")).toEqual(["없음"]); // 인증 없음 → 「없음」 칩
    expect(칸값(화면.tree, "patent")).toBe("0"); // 특허 없음 → 0건
    expect(칸값(화면.tree, "nice")).toBe("780"); // 점수 하나만 오면 NICE 칸
    expect(칸값(화면.tree, "kcb")).toBe("");
    expect(칸값(화면.tree, "loan")).toBe("0"); // 대출 없음 → 잔액 0
    expect(진단하기(화면, 받은)).toMatchObject({
      companyScale: "중소기업",
      hasCert: false,
      hasPatent: false,
      creditScore: 780,
      hasExistingLoan: false,
    });
  });

  it("옛 응답에 인증·특허·대출이 「있음」만 오면 칸은 비우고 안내 문구를 보이되, 진단에는 옛 값이 그대로 들어간다", async () => {
    const { 받은, 화면 } = 진단받기();
    await 고객불러오기(화면, {
      companyName: "위들리테크",
      hasCert: true,
      hasPatent: true,
      hasExistingLoan: true,
    }, "위들리테크");

    expect(눌린단추들(화면.tree, "cert")).toEqual([]);
    expect(칸글자(화면.tree, "cert")).toContain("인증 있음(종류 모름)");
    expect(칸값(화면.tree, "patent")).toBe("");
    expect(칸글자(화면.tree, "patent")).toContain("특허 있음(건수 모름)");
    expect(칸값(화면.tree, "loan")).toBe("");
    expect(칸글자(화면.tree, "loan")).toContain("대출 있음(잔액 모름)");

    const p = 진단하기(화면, 받은);
    expect(p).toMatchObject({ hasCert: true, hasPatent: true, hasExistingLoan: true });
    expect("certTypes" in p).toBe(false);
    expect("patentCount" in p).toBe(false);
    expect("existingLoanBalanceManwon" in p).toBe(false);
  });

  it("안내 문구는 사람이 그 칸을 직접 채우면 사라진다", async () => {
    const { 받은, 화면 } = 진단받기();
    await 고객불러오기(화면, { companyName: "위들리테크", hasCert: true, hasPatent: true, hasExistingLoan: true }, "위들리테크");

    칸단추누르기(화면, "cert", "벤처");
    칸적기(화면, "patent", "3");
    칸적기(화면, "loan", "5000");
    expect(칸글자(화면.tree, "cert")).not.toContain("인증 있음(종류 모름)");
    expect(칸글자(화면.tree, "patent")).not.toContain("특허 있음(건수 모름)");
    expect(칸글자(화면.tree, "loan")).not.toContain("대출 있음(잔액 모름)");
    expect(진단하기(화면, 받은)).toMatchObject({
      certTypes: ["벤처"], hasCert: true, patentCount: 3, hasPatent: true,
      existingLoanBalanceManwon: 5000, hasExistingLoan: true,
    });
  });

  it("새 칸(주소·인증 종류·특허 건수·대출 잔액·두 신용점수·법인 여부)이 응답에 있으면 그대로 채운다", async () => {
    const { 받은, 화면 } = 진단받기();
    await 고객불러오기(화면, {
      companyName: "위들리테크",
      businessAddress: "경기 화성시",
      certTypes: ["벤처", "ISO"],
      patentCount: 2,
      existingLoanBalanceManwon: 5000,
      creditScoreNice: 780,
      creditScoreKcb: 720,
      isCorporation: true,
    }, "위들리테크");

    expect(칸값(화면.tree, "address")).toBe("경기 화성시");
    expect(칸글자(화면.tree, "address")).toContain("지역 조건: 경기 · 화성시");
    expect(눌린단추들(화면.tree, "cert")).toEqual(["벤처", "ISO"]);
    expect(칸값(화면.tree, "patent")).toBe("2");
    expect(칸값(화면.tree, "loan")).toBe("5,000");
    expect(칸값(화면.tree, "nice")).toBe("780");
    expect(칸값(화면.tree, "kcb")).toBe("720");
    expect(눌린단추들(화면.tree, "corp")).toEqual(["법인"]);

    expect(진단하기(화면, 받은)).toMatchObject({
      businessAddress: "경기 화성시",
      region: "경기",
      regionSigungu: "화성시",
      certTypes: ["벤처", "ISO"],
      hasCert: true,
      patentCount: 2,
      hasPatent: true,
      existingLoanBalanceManwon: 5000,
      hasExistingLoan: true,
      creditScoreNice: 780,
      creditScoreKcb: 720,
      creditScore: 720, // 두 점수 중 낮은 값
      isCorporation: true,
    });
  });

  it("옛 신용점수 하나가 오고 새 두 칸이 있으면 새 칸이 이긴다", async () => {
    const { 받은, 화면 } = 진단받기();
    await 고객불러오기(화면, { companyName: "위들리테크", creditScore: 500, creditScoreKcb: 710 }, "위들리테크");
    expect(칸값(화면.tree, "nice")).toBe("");
    expect(칸값(화면.tree, "kcb")).toBe("710");
    expect(진단하기(화면, 받은).creditScore).toBe(710);
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
      bizno: "123-81-45678",
      isCorporation: true,
      businessAddress: "경기 화성시",
      certTypes: ["벤처"],
    }, "첫회사");

    expect(눌린단추들(화면.tree, "scale")).toEqual(["소상공인"]);
    expect(칸값(화면.tree, "patent")).toBe("0");
    expect(칸값(화면.tree, "nice")).toBe("0");
    expect(칸글자(화면.tree, "nice")).toContain("300~1000 사이로 넣어 주세요");
    expect(칸값(화면.tree, "bizno")).toBe("123-81-45678");

    await 고객불러오기(화면, { companyName: "다음회사" }, "다음회사");
    expect(눌린단추들(화면.tree, "scale")).toEqual(["모름"]);
    expect(눌린단추들(화면.tree, "corp")).toEqual(["모름"]);
    expect(눌린단추들(화면.tree, "tax")).toEqual(["모름"]);
    expect(눌린단추들(화면.tree, "cert")).toEqual([]);
    expect(칸글자(화면.tree, "cert")).not.toContain("인증 있음(종류 모름)");
    for (const 열쇠 of ["bizno", "address", "patent", "loan", "nice", "kcb"]) {
      expect(칸값(화면.tree, 열쇠), `${열쇠} 칸이 앞 고객에서 남았다`).toBe("");
    }
    expect(칸글자(화면.tree, "loan")).not.toContain("대출 있음(잔액 모름)");
    const p = 진단하기(화면, 받은);
    for (const key of [
      "companyScale", "hasCert", "hasPatent", "creditScore", "hasExistingLoan",
      "certTypes", "patentCount", "existingLoanBalanceManwon", "creditScoreNice", "creditScoreKcb",
      "isCorporation", "businessAddress", "bizno", "region", "regionSigungu",
    ]) {
      expect(key in p, `${key}가 앞 고객에서 남았다`).toBe(false);
    }
  });
});

describe("ProfileForm — 칸 형식(값 모양에 맞는 입력)", () => {
  it("셀렉트(드롭다운)가 한 칸도 없고, 단추·칩은 키보드로 고를 수 있는 button 이다", () => {
    const { 화면 } = 진단받기();
    const 모두 = [...모든마디(화면.tree)];
    expect(모두.filter((m) => m.type === "select")).toEqual([]);
    for (const 열쇠 of ["corp", "scale", "tax", "cert"]) {
      const 단추들 = 칸단추들(화면.tree, 열쇠);
      expect(단추들.length, `${열쇠} 칸에 단추가 없다`).toBeGreaterThan(0);
      for (const b of 단추들) {
        expect(b.props.type).toBe("button");
        expect(typeof b.props["aria-pressed"]).toBe("boolean");
      }
    }
  });

  it("단추 칸의 선택지가 계획서 그대로다", () => {
    const { 화면 } = 진단받기();
    const 이름들 = (열쇠: string) => 칸단추들(화면.tree, 열쇠).map((b) => 글자(b.props.children as 그림).trim());
    expect(이름들("corp")).toEqual(["모름", "법인", "개인"]);
    expect(이름들("scale")).toEqual(["모름", "소상공인", "중소기업", "중견기업", "예비창업자"]);
    expect(이름들("tax")).toEqual(["모름", "없음", "있음"]);
    expect(이름들("cert")).toEqual(["벤처", "이노비즈", "메인비즈", "ISO", "여성기업", "사회적기업", "기타", "없음"]);
  });

  it("법인·개인, 기업 규모, 체납은 단추로 고르고 진단 입력에 실린다", () => {
    const { 받은, 화면 } = 진단받기();
    expect(눌린단추들(화면.tree, "corp")).toEqual(["모름"]);
    칸단추누르기(화면, "corp", "개인");
    칸단추누르기(화면, "scale", "소상공인");
    칸단추누르기(화면, "tax", "없음");
    expect(눌린단추들(화면.tree, "corp")).toEqual(["개인"]);
    expect(진단하기(화면, 받은)).toMatchObject({ isCorporation: false, companyScale: "소상공인", taxDelinquent: false });

    칸단추누르기(화면, "corp", "모름");
    칸단추누르기(화면, "scale", "모름");
    칸단추누르기(화면, "tax", "있음");
    const p = 진단하기(화면, 받은);
    expect("isCorporation" in p).toBe(false);
    expect("companyScale" in p).toBe(false);
    expect(p.taxDelinquent).toBe(true);
  });

  it("글자 칸(상호·주업종)과 설립일이 진단 입력에 실린다", () => {
    const { 받은, 화면 } = 진단받기();
    칸적기(화면, "name", "가상테크");
    칸적기(화면, "industry", "전자부품 제조업");
    칸적기(화면, "founded", "2019-03-20");
    expect(칸입력(화면.tree, "founded").props.type).toBe("date");
    expect(진단하기(화면, 받은)).toMatchObject({ companyName: "가상테크", industry: "전자부품 제조업", foundedDate: "2019-03-20" });
  });

  it("직원 수는 숫자만 받아 명 단위로 넘기고, 특허·대출 칸은 모름 안내와 도움말을 단다", () => {
    const { 받은, 화면 } = 진단받기();
    expect(칸입력(화면.tree, "patent").props.placeholder).toBe("모름");
    expect(칸입력(화면.tree, "loan").props.placeholder).toBe("모름");
    expect(칸글자(화면.tree, "employees")).toContain("4대보험 가입 인원");
    expect(칸글자(화면.tree, "employees")).toContain("명");
    expect(칸글자(화면.tree, "patent")).toContain("없으면 0");
    expect(칸글자(화면.tree, "patent")).toContain("건");
    expect(칸글자(화면.tree, "loan")).toContain("정책자금·기업대출 합계 · 없으면 0");
    expect(칸글자(화면.tree, "loan")).toContain("만원");

    칸적기(화면, "employees", "12명");
    칸적기(화면, "patent", "0");
    칸적기(화면, "loan", "0");
    expect(칸값(화면.tree, "employees")).toBe("12");
    const p = 진단하기(화면, 받은);
    // 0 은 「없음」이다 — 모름(빈 칸)과 다르다. 판정 칸도 deriveProfileFlags 가 채운다.
    expect(p).toMatchObject({ employeeCount: 12, patentCount: 0, hasPatent: false, existingLoanBalanceManwon: 0, hasExistingLoan: false });
  });
});

describe("ProfileForm — 사업자번호 마스크·법인 자동", () => {
  it("숫자만 받아 000-00-00000 으로 하이픈을 넣고 10자리를 넘기지 않는다", () => {
    const { 화면 } = 진단받기();
    expect(칸입력(화면.tree, "bizno").props.placeholder).toBe("000-00-00000");
    칸적기(화면, "bizno", "12345");
    expect(칸값(화면.tree, "bizno")).toBe("123-45");
    칸적기(화면, "bizno", "abc1238145678999");
    expect(칸값(화면.tree, "bizno")).toBe("123-81-45678");
  });

  it("10자리가 되면 가운데 두 자리로 법인·개인 단추를 맞춘다", () => {
    const { 받은, 화면 } = 진단받기();
    칸적기(화면, "bizno", "1238145678"); // 81 = 법인
    expect(눌린단추들(화면.tree, "corp")).toEqual(["법인"]);
    칸적기(화면, "bizno", "1234512345"); // 45 = 개인
    expect(눌린단추들(화면.tree, "corp")).toEqual(["개인"]);
    칸적기(화면, "bizno", "1239012345"); // 90 = 번호로는 못 가림 → 모름
    expect(눌린단추들(화면.tree, "corp")).toEqual(["모름"]);

    칸적기(화면, "bizno", "1238145678");
    expect(진단하기(화면, 받은)).toMatchObject({ bizno: "123-81-45678", isCorporation: true });
  });

  it("10자리가 안 되면 법인·개인을 건드리지 않고, 진단에는 번호를 싣지 않고 안내한다", () => {
    const { 받은, 화면 } = 진단받기();
    칸단추누르기(화면, "corp", "법인");
    칸적기(화면, "bizno", "12345");
    expect(눌린단추들(화면.tree, "corp")).toEqual(["법인"]);
    expect(칸글자(화면.tree, "bizno")).toContain("10자리를 모두 넣어 주세요");
    const p = 진단하기(화면, 받은);
    expect("bizno" in p).toBe(false);
    expect(p.isCorporation).toBe(true);
  });

  it("상호를 고치면 사업자번호가 비워진다(앞 고객 번호가 실려 나가지 않게 — 기존 동작)", () => {
    const { 받은, 화면 } = 진단받기();
    칸적기(화면, "bizno", "1238145678");
    칸적기(화면, "name", "다른회사");
    expect(칸값(화면.tree, "bizno")).toBe("");
    expect("bizno" in 진단하기(화면, 받은)).toBe(false);
  });
});

describe("ProfileForm — 작년 연매출은 쉼표·만원·「= N억 M만원」", () => {
  it("숫자만 받아 쉼표를 넣고 아래에 읽은 금액을 보인다", () => {
    const { 화면 } = 진단받기();
    expect(칸글자(화면.tree, "revenue")).toContain("만원");
    expect(칸글자(화면.tree, "revenue")).toContain("세금 신고 매출 기준");

    칸적기(화면, "revenue", "124500");
    expect(칸값(화면.tree, "revenue")).toBe("124,500");
    expect(칸글자(화면.tree, "revenue")).toContain("= 12억 4,500만원");

    칸적기(화면, "revenue", "50000");
    expect(칸글자(화면.tree, "revenue")).toContain("= 5억원");

    칸적기(화면, "revenue", "3000");
    expect(칸글자(화면.tree, "revenue")).toContain("= 3,000만원");

    칸적기(화면, "revenue", "");
    expect(칸글자(화면.tree, "revenue")).toContain("세금 신고 매출 기준");
    expect(칸글자(화면.tree, "revenue")).not.toContain("=");
  });

  it("진단에는 만원 × 10,000 을 원으로 싣는다", () => {
    const { 받은, 화면 } = 진단받기();
    칸적기(화면, "revenue", "124,500");
    expect(진단하기(화면, 받은).lastYearRevenueKrw).toBe(1_245_000_000);
    칸적기(화면, "revenue", "0");
    expect(진단하기(화면, 받은).lastYearRevenueKrw).toBe(0);
    칸적기(화면, "revenue", "");
    expect("lastYearRevenueKrw" in 진단하기(화면, 받은)).toBe(false);
  });
});

describe("ProfileForm — 사업장 주소 → 지역 조건", () => {
  it("주소를 넣으면 아래에 「지역 조건: 시도 · 시군구」를 보인다", () => {
    const { 화면 } = 진단받기();
    expect(칸글자(화면.tree, "address")).toContain("주소를 넣으면 시도·시군구를 읽어 지역 조건에 씁니다");
    칸적기(화면, "address", "경기 화성시 동탄대로 000");
    expect(칸글자(화면.tree, "address")).toContain("지역 조건: 경기 · 화성시");
    칸적기(화면, "address", "서울특별시 강남구 테헤란로 1");
    expect(칸글자(화면.tree, "address")).toContain("지역 조건: 서울 · 강남구");
  });

  it("못 읽는 글자면 기본 도움말로 돌아간다", () => {
    const { 화면 } = 진단받기();
    칸적기(화면, "address", "경기 화성시");
    칸적기(화면, "address", "주소 미정");
    expect(칸글자(화면.tree, "address")).toContain("주소를 넣으면 시도·시군구를 읽어 지역 조건에 씁니다");
    expect(칸글자(화면.tree, "address")).not.toContain("지역 조건:");
  });

  it("진단에는 시도·시군구까지만 싣고(도로명·번지는 뺀다) 지역 칸은 deriveProfileFlags 가 채운다", () => {
    const { 받은, 화면 } = 진단받기();
    칸적기(화면, "address", "경기 화성시 동탄대로 000");
    const p = 진단하기(화면, 받은);
    expect(p.businessAddress).toBe("경기 화성시");
    expect(p.region).toBe("경기");
    expect(p.regionSigungu).toBe("화성시");
  });
});

describe("ProfileForm — 보유 인증 칩(여러 개 · 「없음」은 배타)", () => {
  it("여러 개를 고를 수 있다", () => {
    const { 화면 } = 진단받기();
    칸단추누르기(화면, "cert", "벤처");
    칸단추누르기(화면, "cert", "ISO");
    expect(눌린단추들(화면.tree, "cert")).toEqual(["벤처", "ISO"]);
    칸단추누르기(화면, "cert", "벤처"); // 다시 누르면 끈다
    expect(눌린단추들(화면.tree, "cert")).toEqual(["ISO"]);
  });

  it("「없음」을 누르면 나머지가 꺼지고, 다른 칩을 누르면 「없음」이 꺼진다", () => {
    const { 받은, 화면 } = 진단받기();
    칸단추누르기(화면, "cert", "벤처");
    칸단추누르기(화면, "cert", "이노비즈");
    칸단추누르기(화면, "cert", "없음");
    expect(눌린단추들(화면.tree, "cert")).toEqual(["없음"]);
    expect(진단하기(화면, 받은)).toMatchObject({ certTypes: ["없음"], hasCert: false });

    칸단추누르기(화면, "cert", "여성기업");
    expect(눌린단추들(화면.tree, "cert")).toEqual(["여성기업"]);
    const p = 진단하기(화면, 받은);
    expect(p).toMatchObject({ certTypes: ["여성기업"], hasCert: true });
    expect(p.orgTypes).toContain("여성기업"); // deriveProfileFlags 가 기업 형태로도 옮긴다

    칸단추누르기(화면, "cert", "없음");
    칸단추누르기(화면, "cert", "없음"); // 다시 누르면 꺼져 모름으로 돌아간다
    expect(눌린단추들(화면.tree, "cert")).toEqual([]);
    expect("certTypes" in 진단하기(화면, 받은)).toBe(false);
  });
});

describe("ProfileForm — 신용점수 NICE / KCB 두 칸", () => {
  it("두 칸 모두 300~1000 점 칸이고 4자리까지 받는다", () => {
    const { 화면 } = 진단받기();
    for (const 열쇠 of ["nice", "kcb"]) {
      expect(칸입력(화면.tree, 열쇠).props.placeholder).toBe("300~1000");
      expect(칸입력(화면.tree, 열쇠).props.maxLength).toBe(4);
      expect(칸글자(화면.tree, 열쇠)).toContain("점");
    }
    expect(칸글자(화면.tree, "nice")).toContain("NICE");
    expect(칸글자(화면.tree, "kcb")).toContain("KCB");
  });

  it("두 점수를 넣으면 낮은 값으로 진단을 요청한다", () => {
    const { 받은, 화면 } = 진단받기();
    칸적기(화면, "nice", "780");
    칸적기(화면, "kcb", "720");
    expect(진단하기(화면, 받은)).toMatchObject({ creditScoreNice: 780, creditScoreKcb: 720, creditScore: 720 });
    칸적기(화면, "nice", "650");
    expect(진단하기(화면, 받은)).toMatchObject({ creditScoreNice: 650, creditScoreKcb: 720, creditScore: 650 });
  });

  it("한 칸만 넣으면 그 값이 진단 점수가 된다", () => {
    const { 받은, 화면 } = 진단받기();
    칸적기(화면, "kcb", "800");
    const p = 진단하기(화면, 받은);
    expect(p).toMatchObject({ creditScoreKcb: 800, creditScore: 800 });
    expect("creditScoreNice" in p).toBe(false);
  });

  it("300~1000 밖의 값은 진단에 싣지 않고 그 자리에서 알린다", () => {
    const { 받은, 화면 } = 진단받기();
    칸적기(화면, "nice", "1200");
    칸적기(화면, "kcb", "250");
    expect(칸글자(화면.tree, "nice")).toContain("300~1000 사이로 넣어 주세요 — 지금은 모름으로 처리됩니다");
    expect(칸글자(화면.tree, "kcb")).toContain("300~1000 사이로 넣어 주세요 — 지금은 모름으로 처리됩니다");
    const p = 진단하기(화면, 받은);
    for (const key of ["creditScoreNice", "creditScoreKcb", "creditScore"]) {
      expect(key in p, `${key}가 범위 밖인데 실렸다`).toBe(false);
    }
  });
});

describe("ProfileForm — 채운 칸 세기·모름 안내·흐리게(unk) 표시", () => {
  it("처음엔 15칸 모두 모름이다", () => {
    const { 화면 } = 진단받기();
    expect(글자(화면.tree)).toContain("채운 칸 0 / 15");
    expect(글자(화면.tree)).toContain("모름 15칸");
  });

  it("칸을 채울수록 세는 수가 바뀐다 — 단추·칩·0 도 채운 것으로 센다", () => {
    const { 화면 } = 진단받기();
    칸적기(화면, "name", "가상테크");
    expect(글자(화면.tree)).toContain("채운 칸 1 / 15");
    칸단추누르기(화면, "tax", "없음");
    칸단추누르기(화면, "cert", "없음");
    칸적기(화면, "patent", "0");
    expect(글자(화면.tree)).toContain("채운 칸 4 / 15");
    expect(글자(화면.tree)).toContain("모름 11칸");
    칸적기(화면, "nice", "1200"); // 범위 밖은 모름으로 처리되니 채운 칸이 아니다
    expect(글자(화면.tree)).toContain("채운 칸 4 / 15");
  });

  it("확인 필요 건수를 받으면 「모름 N칸 → 확인 필요 M건」으로 보인다", () => {
    const 화면 = new 손React();
    화면.render(<ProfileForm onDiagnose={async () => false} diagnosing={false} reviewCount={1284} />);
    expect(글자(화면.tree)).toContain("모름 15칸 → 확인 필요 1,284건");
    const 없을때 = 진단받기().화면;
    expect(글자(없을때.tree)).not.toContain("확인 필요 ");
  });

  it("모름 상태인 단추·점수 칸은 흐리게 표시하고, 채우면 풀린다", () => {
    const { 화면 } = 진단받기();
    expect(칸덩어리(화면.tree, "tax").props["data-unk"]).toBe("true");
    expect(칸덩어리(화면.tree, "nice").props["data-unk"]).toBe("true");
    칸단추누르기(화면, "tax", "없음");
    칸적기(화면, "nice", "780");
    expect(칸덩어리(화면.tree, "tax").props["data-unk"]).toBeUndefined();
    expect(칸덩어리(화면.tree, "nice").props["data-unk"]).toBeUndefined();
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
