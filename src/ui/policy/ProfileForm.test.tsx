import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import ProfileForm from "./ProfileForm";
import type { BusinessProfile } from "../../engine/match-engine";
import { DOCUMENT_UPLOAD_LIMITS, type DocumentPrefillResult } from "../../documents/types";

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

// ── 서류 올리기(B2) ────────────────────────────────────────────────────────
// 서류를 읽는 서버는 가짜 fetch 로 대신한다. 올린 파일은 이름·크기만 있는 가짜 파일이다.

const 서류주소 = "/api/policy-match/document-prefill";

function 서류화면(opts: { 주소?: string | null; 모드?: "attach" | "lab"; 고객찾기?: boolean } = {}): {
  받은: BusinessProfile[];
  화면: 손React;
} {
  const 받은: BusinessProfile[] = [];
  const 화면 = new 손React();
  화면.render(
    <ProfileForm
      onDiagnose={async (p) => {
        받은.push(p);
        return false;
      }}
      diagnosing={false}
      prefillEndpoint={opts.고객찾기 === false ? undefined : "/api/policy-match/prefill"}
      documentPrefillEndpoint={opts.주소 === null ? undefined : (opts.주소 ?? 서류주소)}
      documentPrefillMode={opts.모드}
    />,
  );
  return { 받은, 화면 };
}

function 가짜파일(이름: string, 크기 = 10): File {
  return { name: 이름, size: 크기 } as unknown as File;
}

function 읽은결과(p: Partial<DocumentPrefillResult> = {}): DocumentPrefillResult {
  return { fields: {}, sources: {}, conflicts: [], files: [], ...p };
}

/** 서류 올리기에 쓸 fetch 를 붙인다 — 본문을 돌려주거나(성공·서버 실패 모두) Error 를 주면 연결이 끊긴 것처럼 던진다. */
function 서류응답붙이기(본문: unknown) {
  const fn = vi.fn(async (_url: string, _init?: { method?: string; body?: unknown }) => {
    if (본문 instanceof Error) throw 본문;
    return { json: async () => 본문 };
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

function 서류성공(data: DocumentPrefillResult) {
  return 서류응답붙이기({ success: true, data });
}

function 흘리기(화면: 손React): Promise<그림> {
  return (async () => {
    let tree = 화면.tree;
    for (let i = 0; i < 30; i++) {
      await Promise.resolve();
      tree = 화면.다시그리기();
    }
    return tree;
  })();
}

function 파일입력(tree: 그림): 마디 {
  for (const m of 모든마디(tree)) {
    if (m.type === "input" && m.props.type === "file") return m;
  }
  throw new Error("서류 고르는 칸(input type=file)이 화면에 없다");
}

function 서류고르기(화면: 손React, 파일들: File[]): Promise<그림> {
  (파일입력(화면.tree).props.onChange as (e: unknown) => void)({ target: { files: 파일들, value: "찌꺼기" } });
  return 흘리기(화면);
}

function 끌어놓기(화면: 손React, 파일들: File[]): Promise<그림> {
  for (const m of 모든마디(화면.tree)) {
    if (typeof m.props.onDrop === "function") {
      (m.props.onDrop as (e: unknown) => void)({ preventDefault() {}, dataTransfer: { files: 파일들 } });
      return 흘리기(화면);
    }
  }
  throw new Error("끌어 놓는 자리가 화면에 없다");
}

function 올린본문(fn: ReturnType<typeof 서류응답붙이기>, 번째 = 0): FormData {
  return fn.mock.calls[번째][1]?.body as FormData;
}

function 상자(tree: 그림, 열쇠: string): 마디 {
  for (const m of 모든마디(tree)) {
    if (m.props["data-conflict"] === 열쇠) return m;
  }
  throw new Error(`「${열쇠}」 고르는 상자가 화면에 없다`);
}

function 상자없음(tree: 그림, 열쇠: string): boolean {
  return ![...모든마디(tree)].some((m) => m.props["data-conflict"] === 열쇠);
}

function 상자눌린단추들(tree: 그림, 열쇠: string): string[] {
  return [...모든마디(상자(tree, 열쇠).props.children as 그림)]
    .filter((m) => m.type === "button" && m.props["aria-pressed"] === true)
    .map((m) => 글자(m.props.children as 그림).trim());
}

function 상자단추누르기(화면: 손React, 열쇠: string, 이름: string): 그림 {
  for (const m of 모든마디(상자(화면.tree, 열쇠).props.children as 그림)) {
    if (m.type === "button" && 글자(m.props.children as 그림).trim() === 이름) {
      (m.props.onClick as () => void)();
      return 화면.다시그리기();
    }
  }
  throw new Error(`「${열쇠}」 상자에 「${이름}」 단추가 없다`);
}

function 올린서류줄(tree: 그림, 이름: string): 마디 | undefined {
  return [...모든마디(tree)].find((m) => m.props["data-file"] === 이름);
}

const 기업상태표결과 = (): DocumentPrefillResult =>
  읽은결과({
    fields: {
      employeeCount: 8,
      industry: "전자부품 제조업",
      certTypes: ["벤처", "ISO"],
      lastYearRevenueKrw: 1_245_000_000,
      businessAddress: "경기 화성시",
      region: "경기",
      regionSigungu: "화성시",
    },
    sources: {
      employeeCount: { files: ["기업상태표_가상테크.xlsx"], docTypes: ["company-status"] },
      industry: { files: ["기업상태표_가상테크.xlsx"], docTypes: ["company-status"] },
      certTypes: { files: ["기업상태표_가상테크.xlsx"], docTypes: ["company-status"] },
      lastYearRevenueKrw: { files: ["기업상태표_가상테크.xlsx"], docTypes: ["company-status"] },
      businessAddress: { files: ["기업상태표_가상테크.xlsx"], docTypes: ["company-status"] },
      region: { files: ["기업상태표_가상테크.xlsx"], docTypes: ["company-status"] },
      regionSigungu: { files: ["기업상태표_가상테크.xlsx"], docTypes: ["company-status"] },
    },
    files: [
      {
        name: "기업상태표_가상테크.xlsx",
        docType: "company-status",
        status: "read",
        fields: ["employeeCount", "industry", "certTypes", "lastYearRevenueKrw", "businessAddress", "region", "regionSigungu"],
      },
    ],
  });

describe("ProfileForm — 서류 올리기 칸(드롭존)", () => {
  it("올리기 주소를 안 넘기면 올리기 칸이 아예 없다", () => {
    const { 화면 } = 서류화면({ 주소: null });
    expect([...모든마디(화면.tree)].some((m) => m.type === "input" && m.props.type === "file")).toBe(false);
    expect([...모든마디(화면.tree)].some((m) => m.props["data-k"] === "documents")).toBe(false);
    expect(글자(화면.tree)).not.toContain("서류를 올리면 칸을 채워 드려요");
  });

  it("주소가 있으면 제목·끌어 놓기 안내·여러 개 고르는 입력이 맨 위에 있다", () => {
    const { 화면 } = 서류화면();
    const 글 = 글자(화면.tree);
    expect(글).toContain("서류를 올리면 칸을 채워 드려요");
    expect(글).toContain("여기로 끌어 놓거나 눌러서 고르세요 · 여러 개 한 번에");
    const 입력 = 파일입력(화면.tree);
    expect(입력.props.multiple).toBe(true);
    expect(입력.props.accept).toBe(DOCUMENT_UPLOAD_LIMITS.acceptExtensions.join(","));
    // 맨 위 — 서류 칸이 회사 정보 칸(채운 칸 세기·상호 …)보다 앞에 그려진다.
    expect(글.indexOf("서류를 올리면")).toBeGreaterThan(-1);
    expect(글.indexOf("서류를 올리면")).toBeLessThan(글.indexOf("채운 칸"));
    expect(글.indexOf("서류를 올리면")).toBeLessThan(글.indexOf("상호"));
  });

  it("형식 카드 5개(PDF·엑셀·한글·워드·사진 + 확장자)와 제한 문구, 읽는 서류 칩 5개가 있다", () => {
    const { 화면 } = 서류화면();
    const 카드 = [...모든마디(화면.tree)].filter((m) => m.props["data-fmt"] !== undefined);
    expect(카드.map((m) => 글자(m).replace(/\s+/g, " ").trim())).toEqual([
      "PDF PDF .pdf",
      "XLS 엑셀 .xlsx .xls",
      "HWP 한글 .hwpx",
      "DOC 워드 .docx",
      "IMG 사진 .jpg .png",
    ]);
    expect(글자(화면.tree)).toContain("한 번에 10개 · 파일당 20MB · 옛 한글(.hwp)은 PDF로 저장해 올려 주세요");
    expect(글자(화면.tree)).toContain("이런 서류를 읽어요");
    const 칩 = [...모든마디(화면.tree)].filter((m) => m.props["data-kind"] !== undefined).map((m) => 글자(m).trim());
    expect(칩).toEqual(["기업상태표", "사업자등록증", "재무제표", "부가세 신고서", "고용보험 신고서"]);
  });

  it("시안 전용 「예시 서류 3개 올려 보기」 단추는 없다", () => {
    const { 화면 } = 서류화면();
    expect(글자(화면.tree)).not.toContain("예시 서류");
  });

  it("기본(attach) 모드는 고객 자료에 붙여 둔다는 안내를 보인다", () => {
    const { 화면 } = 서류화면();
    expect(글자(화면.tree)).toContain("고객을 불러온 상태면 올린 서류를 그 고객 자료에 붙여 둡니다");
    expect(글자(화면.tree)).not.toContain("서류를 저장하지 않아요");
    const 사진카드 = [...모든마디(화면.tree)].find((m) => m.props["data-fmt"] === "IMG")!;
    expect(글자(사진카드)).not.toContain("글자 있는 PDF로");
  });

  it("lab 모드는 저장하지 않는다는 안내와 사진 카드의 「글자 있는 PDF로」를 보이고 고객 자료 문구는 없다", () => {
    const { 화면 } = 서류화면({ 모드: "lab" });
    expect(글자(화면.tree)).toContain("서류를 저장하지 않아요. 사진·스캔본은 글자 있는 PDF로 올려 주세요");
    expect(글자(화면.tree)).not.toContain("그 고객 자료에 붙여 둡니다");
    const 사진카드 = [...모든마디(화면.tree)].find((m) => m.props["data-fmt"] === "IMG")!;
    expect(글자(사진카드)).toContain("글자 있는 PDF로");
    const 엑셀카드 = [...모든마디(화면.tree)].find((m) => m.props["data-fmt"] === "XLS")!;
    expect(글자(엑셀카드)).not.toContain("글자 있는 PDF로");
  });

  it("서류 칸을 넣어도 폼에는 셀렉트가 없다", () => {
    const { 화면 } = 서류화면();
    expect([...모든마디(화면.tree)].filter((m) => m.type === "select")).toEqual([]);
  });

  it("끌어 올리면 칸이 강조되고 놓으면 올린다", async () => {
    const fn = 서류성공(기업상태표결과());
    const { 화면 } = 서류화면();
    const 자리 = [...모든마디(화면.tree)].find((m) => typeof m.props.onDragOver === "function")!;
    (자리.props.onDragOver as (e: unknown) => void)({ preventDefault() {} });
    화면.다시그리기();
    const 강조 = [...모든마디(화면.tree)].find((m) => typeof m.props.onDragOver === "function")!;
    expect(String(강조.props.className)).toContain("bg-wedly-bg-blue");

    await 끌어놓기(화면, [가짜파일("기업상태표_가상테크.xlsx")]);
    expect(fn).toHaveBeenCalledTimes(1);
    const 놓은뒤 = [...모든마디(화면.tree)].find((m) => typeof m.props.onDragOver === "function")!;
    expect(String(놓은뒤.props.className)).not.toContain("bg-wedly-bg-blue");
  });
});

describe("ProfileForm — 서류를 올려 칸 채우기", () => {
  it("파일을 고르면 files 로 POST 하고, 고객을 안 불러왔으면 customerKey 는 보내지 않는다", async () => {
    const fn = 서류성공(기업상태표결과());
    const { 화면 } = 서류화면();
    await 서류고르기(화면, [가짜파일("기업상태표_가상테크.xlsx"), 가짜파일("재무제표.pdf")]);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn.mock.calls[0][0]).toBe(서류주소);
    expect(fn.mock.calls[0][1]?.method).toBe("POST");
    const 본문 = 올린본문(fn);
    expect(본문.getAll("files")).toHaveLength(2);
    expect(본문.get("customerKey")).toBeNull();
  });

  it("고객을 불러온 상태면 그 열쇠(불러온 검색어)를 함께 보낸다", async () => {
    const { 화면 } = 서류화면();
    await 고객불러오기(화면, { companyName: "위들리테크" }, "위들리테크");
    const fn = 서류성공(기업상태표결과());
    await 서류고르기(화면, [가짜파일("기업상태표_가상테크.xlsx")]);
    expect(올린본문(fn).get("customerKey")).toBe("위들리테크");
  });

  it("상호를 손으로 고치면 앞 고객 열쇠는 더 이상 보내지 않는다", async () => {
    const { 화면 } = 서류화면();
    await 고객불러오기(화면, { companyName: "위들리테크" }, "위들리테크");
    칸적기(화면, "name", "다른회사");
    const fn = 서류성공(기업상태표결과());
    await 서류고르기(화면, [가짜파일("기업상태표_가상테크.xlsx")]);
    expect(올린본문(fn).get("customerKey")).toBeNull();
  });

  it("읽은 값은 비어 있던 칸에 채우고 칸 옆에 출처 칩이 붙고 진단에도 실린다", async () => {
    서류성공(기업상태표결과());
    const { 받은, 화면 } = 서류화면();
    await 서류고르기(화면, [가짜파일("기업상태표_가상테크.xlsx")]);

    expect(칸값(화면.tree, "employees")).toBe("8");
    expect(칸값(화면.tree, "industry")).toBe("전자부품 제조업");
    expect(칸값(화면.tree, "revenue")).toBe("124,500");
    expect(칸글자(화면.tree, "revenue")).toContain("= 12억 4,500만원");
    expect(칸값(화면.tree, "address")).toBe("경기 화성시");
    expect(칸글자(화면.tree, "address")).toContain("지역 조건: 경기 · 화성시");
    expect(눌린단추들(화면.tree, "cert")).toEqual(["벤처", "ISO"]);
    // 출처 칩 — 서류 종류 이름
    for (const 열쇠 of ["employees", "industry", "revenue", "address", "cert"]) {
      expect(칸글자(화면.tree, 열쇠), `${열쇠} 칸에 출처 칩이 없다`).toContain("기업상태표");
    }
    expect(칸글자(화면.tree, "founded")).not.toContain("기업상태표");

    expect(진단하기(화면, 받은)).toMatchObject({
      employeeCount: 8,
      industry: "전자부품 제조업",
      lastYearRevenueKrw: 1_245_000_000,
      region: "경기",
      regionSigungu: "화성시",
      certTypes: ["벤처", "ISO"],
      hasCert: true,
    });
  });

  it("올린 파일 목록에 형식 표식·이름·「N칸 채움」이 보이고, 패널 아래에 요약 문구가 나온다", async () => {
    서류성공(기업상태표결과());
    const { 화면 } = 서류화면();
    expect(글자(화면.tree)).toContain("모르는 칸은");
    await 서류고르기(화면, [가짜파일("기업상태표_가상테크.xlsx")]);

    const 줄 = 올린서류줄(화면.tree, "기업상태표_가상테크.xlsx")!;
    expect(줄).toBeDefined();
    const 줄글 = 글자(줄).replace(/\s+/g, " ");
    expect(줄글).toContain("XLS");
    expect(줄글).toContain("기업상태표_가상테크.xlsx");
    expect(줄글).toContain("7칸 채움");
    // 화면 칸으로 세면 주소(세 칸)·인증이 한 칸이라 5칸: 직원 수·주업종·매출·주소·인증
    expect(글자(화면.tree)).toContain("서류 1개에서 5칸을 채웠어요. 확인하고 진단하세요");
    expect(단추찾기(화면.tree, "매칭 진단")).not.toBeNull();
  });

  it("사진이라 못 읽은 서류·모르는 서류는 상태 문구를 보이고 칸은 건드리지 않는다", async () => {
    서류성공(
      읽은결과({
        files: [
          { name: "등록증.jpg", docType: "unknown", status: "needs-text-pdf", fields: [], message: "사진이라 못 읽었어요 — 글자 있는 PDF로 올려 주세요" },
          { name: "메모.txt", docType: "unknown", status: "no-fields", fields: [] },
          { name: "옛문서.hwp", docType: "unknown", status: "unsupported", fields: [], message: "옛 한글(.hwp)은 PDF로 저장해 올려 주세요" },
        ],
      }),
    );
    const { 받은, 화면 } = 서류화면();
    await 서류고르기(화면, [가짜파일("등록증.jpg"), 가짜파일("메모.txt"), 가짜파일("옛문서.hwp")]);
    expect(글자(올린서류줄(화면.tree, "등록증.jpg")!)).toContain("사진이라 못 읽었어요");
    expect(글자(올린서류줄(화면.tree, "메모.txt")!)).toContain("모르는 서류");
    expect(글자(올린서류줄(화면.tree, "옛문서.hwp")!)).toContain("옛 한글(.hwp)은 PDF로 저장해 올려 주세요");
    // 채운 칸이 없으면 「채웠어요」 문구는 나오지 않는다
    expect(글자(화면.tree)).not.toContain("칸을 채웠어요");
    expect(진단하기(화면, 받은)).toEqual({});
  });

  it("손으로 고친 칸은 덮지 않고 「어느 값을 쓸까요?」 상자로 보여 준다", async () => {
    서류성공(기업상태표결과());
    const { 받은, 화면 } = 서류화면();
    칸적기(화면, "employees", "12");
    await 서류고르기(화면, [가짜파일("기업상태표_가상테크.xlsx")]);

    expect(칸값(화면.tree, "employees")).toBe("12"); // 손 값 그대로
    expect(칸값(화면.tree, "industry")).toBe("전자부품 제조업"); // 비어 있던 칸은 채워졌다
    expect(글자(상자(화면.tree, "employeeCount"))).toContain("직원 수 서류와 직접 넣은 값이 달라요 — 어느 값을 쓸까요?");
    expect(상자눌린단추들(화면.tree, "employeeCount")).toEqual(["12명 · 직접 넣은 값"]);
    expect(칸글자(화면.tree, "employees")).not.toContain("기업상태표"); // 손 값이라 칩이 없다
    expect(진단하기(화면, 받은).employeeCount).toBe(12);

    상자단추누르기(화면, "employeeCount", "8명 · 기업상태표");
    expect(칸값(화면.tree, "employees")).toBe("8");
    expect(상자눌린단추들(화면.tree, "employeeCount")).toEqual(["8명 · 기업상태표"]);
    expect(칸글자(화면.tree, "employees")).toContain("기업상태표");
    expect(진단하기(화면, 받은).employeeCount).toBe(8);

    상자단추누르기(화면, "employeeCount", "12명 · 직접 넣은 값");
    expect(칸값(화면.tree, "employees")).toBe("12");
    expect(칸글자(화면.tree, "employees")).not.toContain("기업상태표");
  });

  it("서류끼리 다른 칸은 노란 상자로 보이고 추천 값이 처음 골라져 있다", async () => {
    서류성공(
      읽은결과({
        fields: { employeeCount: 8 },
        sources: { employeeCount: { files: ["기업상태표.xlsx"], docTypes: ["company-status"] } },
        conflicts: [
          {
            field: "employeeCount",
            options: [
              { value: 8, files: ["기업상태표.xlsx"], docTypes: ["company-status"], year: 2026 },
              { value: 6, files: ["재무제표.pdf"], docTypes: ["financial-statement"], year: 2025 },
            ],
            recommended: 0,
          },
        ],
        files: [
          { name: "기업상태표.xlsx", docType: "company-status", status: "read", fields: ["employeeCount"] },
          { name: "재무제표.pdf", docType: "financial-statement", status: "read", fields: ["employeeCount"] },
        ],
      }),
    );
    const { 받은, 화면 } = 서류화면();
    await 서류고르기(화면, [가짜파일("기업상태표.xlsx"), 가짜파일("재무제표.pdf")]);

    expect(글자(상자(화면.tree, "employeeCount"))).toContain("직원 수 서류마다 달라요 — 어느 값을 쓸까요?");
    expect(칸값(화면.tree, "employees")).toBe("8");
    expect(상자눌린단추들(화면.tree, "employeeCount")).toEqual(["8명 · 기업상태표(2026)"]);
    expect(칸글자(화면.tree, "employees")).toContain("기업상태표");

    상자단추누르기(화면, "employeeCount", "6명 · 재무제표(2025)");
    expect(칸값(화면.tree, "employees")).toBe("6");
    expect(상자눌린단추들(화면.tree, "employeeCount")).toEqual(["6명 · 재무제표(2025)"]);
    expect(칸글자(화면.tree, "employees")).toContain("재무제표");
    expect(칸글자(화면.tree, "employees")).not.toContain("기업상태표");
    expect(진단하기(화면, 받은).employeeCount).toBe(6);
  });

  it("서류에 없는 칸·손으로 넣은 칸은 지우지 않고, 목록에서 빼도 채운 값은 그대로다", async () => {
    서류성공(기업상태표결과());
    const { 받은, 화면 } = 서류화면();
    칸적기(화면, "founded", "2019-03-20");
    칸단추누르기(화면, "tax", "없음");
    await 서류고르기(화면, [가짜파일("기업상태표_가상테크.xlsx")]);
    expect(칸값(화면.tree, "founded")).toBe("2019-03-20");
    expect(눌린단추들(화면.tree, "tax")).toEqual(["없음"]);

    // 빼기 — 목록에서만 사라진다
    const 빼기 = [...모든마디(화면.tree)].find((m) => m.props["aria-label"] === "기업상태표_가상테크.xlsx 빼기")!;
    (빼기.props.onClick as () => void)();
    화면.다시그리기();
    expect(올린서류줄(화면.tree, "기업상태표_가상테크.xlsx")).toBeUndefined();
    expect(칸값(화면.tree, "employees")).toBe("8");
    expect(진단하기(화면, 받은)).toMatchObject({ employeeCount: 8, foundedDate: "2019-03-20", taxDelinquent: false });
  });

  it("서류가 사업자번호를 주면 법인·개인 단추도 맞춘다(손으로 고른 단추는 지킨다)", async () => {
    서류성공(읽은결과({ fields: { bizno: "123-81-45678" }, sources: { bizno: { files: ["등록증.pdf"], docTypes: ["biz-registration"] } } }));
    const { 화면 } = 서류화면();
    await 서류고르기(화면, [가짜파일("등록증.pdf")]);
    expect(칸값(화면.tree, "bizno")).toBe("123-81-45678");
    expect(눌린단추들(화면.tree, "corp")).toEqual(["법인"]);
    expect(칸글자(화면.tree, "bizno")).toContain("사업자등록증");

    const 손으로 = 서류화면();
    칸단추누르기(손으로.화면, "corp", "개인");
    서류성공(읽은결과({ fields: { bizno: "123-81-45678" } }));
    await 서류고르기(손으로.화면, [가짜파일("등록증.pdf")]);
    expect(눌린단추들(손으로.화면.tree, "corp")).toEqual(["개인"]);
  });

  it("고객을 새로 불러오면 앞 서류의 출처 칩·고르는 상자·목록이 남지 않는다", async () => {
    서류성공(기업상태표결과());
    const { 화면 } = 서류화면();
    칸적기(화면, "employees", "12");
    await 서류고르기(화면, [가짜파일("기업상태표_가상테크.xlsx")]);
    expect(올린서류줄(화면.tree, "기업상태표_가상테크.xlsx")).toBeDefined();

    await 고객불러오기(화면, { companyName: "다른회사" }, "다른회사");
    expect(올린서류줄(화면.tree, "기업상태표_가상테크.xlsx")).toBeUndefined();
    expect(상자없음(화면.tree, "employeeCount")).toBe(true);
    expect(칸글자(화면.tree, "industry")).not.toContain("기업상태표");
    expect(글자(화면.tree)).not.toContain("칸을 채웠어요");
  });
});

// ── 독립 리뷰(Astra) 지적 BF2 — 늦은 응답·고객 열쇠·쓰던 번호 ─────────────────────

describe("ProfileForm — 늦게 온 서류 응답은 새 고객 칸을 덮지 않는다(BF2 ①)", () => {
  it("A 서류를 올리는 중에 B 고객을 불러오면, A 응답이 와도 B 의 직원 수 20명 그대로다", async () => {
    let 서류끝내기: (v: unknown) => void = () => {};
    let 서류신호: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init?: { signal?: AbortSignal }) => {
        if (String(url).startsWith(서류주소)) {
          서류신호 = init?.signal;
          return new Promise((resolve) => {
            서류끝내기 = resolve;
          });
        }
        return Promise.resolve({ json: async () => ({ success: true, data: { companyName: "B상사", employeeCount: 20 } }) });
      }),
    );
    const { 화면 } = 서류화면();
    let tree = await 서류고르기(화면, [가짜파일("기업상태표_가상테크.xlsx")]);
    expect(글자(tree)).toContain("서류를 읽는 중이에요"); // A 가 아직 가는 중

    적기(화면, 검색안내, "B상사");
    누르기(화면, "불러오기");
    tree = await 불러온뒤그리기(화면, "B상사");
    expect(칸값(tree, "employees")).toBe("20");
    expect(서류신호?.aborted).toBe(true); // 가던 요청을 끊었다
    expect(글자(tree)).not.toContain("서류를 읽는 중이에요"); // 새 고객 앞에서 입력도 다시 열린다

    // 끊었어도 응답이 뒤늦게 도착한 경우 — 버려야 한다
    서류끝내기({ json: async () => ({ success: true, data: 기업상태표결과() }) });
    tree = await 흘리기(화면);
    expect(칸값(tree, "employees")).toBe("20");
    expect(칸값(tree, "industry")).toBe("");
    expect(올린서류줄(tree, "기업상태표_가상테크.xlsx")).toBeUndefined();
    expect(글자(tree)).not.toContain("칸을 채웠어요");
  });
});

// ── 재리뷰(Astra 5차) BF6 ⑧ — 상호를 바꾸면 진행 중 서류 요청도 끊는다 ──────────────

describe("ProfileForm — 상호를 직접 바꾸면 올리는 중이던 서류 응답은 버린다(BF6 ⑧)", () => {
  it("A 서류를 올리는 중에 상호를 B 로 바꾸면, A 응답이 와도 진단 입력에 A 의 사업자번호·직원 수가 없다", async () => {
    let 서류끝내기: (v: unknown) => void = () => {};
    let 서류신호: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: { signal?: AbortSignal }) => {
        서류신호 = init?.signal;
        return new Promise((resolve) => {
          서류끝내기 = resolve;
        });
      }),
    );
    const { 받은, 화면 } = 서류화면();
    let tree = await 서류고르기(화면, [가짜파일("기업상태표_가상테크.xlsx")]);
    expect(글자(tree)).toContain("서류를 읽는 중이에요"); // A 가 아직 가는 중

    tree = 칸적기(화면, "name", "B상사");
    expect(서류신호?.aborted).toBe(true); // 가던 요청을 끊었다
    expect(글자(tree)).not.toContain("서류를 읽는 중이에요"); // 입력도 다시 열린다

    // 끊었어도 응답이 뒤늦게 도착한 경우 — 버려야 한다
    서류끝내기({
      json: async () => ({
        success: true,
        data: 읽은결과({
          fields: { bizno: "123-81-45678", employeeCount: 8 },
          sources: {
            bizno: { files: ["기업상태표_가상테크.xlsx"], docTypes: ["company-status"] },
            employeeCount: { files: ["기업상태표_가상테크.xlsx"], docTypes: ["company-status"] },
          },
          files: [{ name: "기업상태표_가상테크.xlsx", docType: "company-status", status: "read", fields: ["bizno", "employeeCount"] }],
        }),
      }),
    });
    tree = await 흘리기(화면);
    expect(올린서류줄(tree, "기업상태표_가상테크.xlsx")).toBeUndefined();
    expect(글자(tree)).not.toContain("칸을 채웠어요");
    const 진단 = 진단하기(화면, 받은);
    expect(진단.companyName).toBe("B상사");
    expect(진단.bizno).toBeUndefined();
    expect(진단.employeeCount).toBeUndefined();
  });

  it("이미 올린 서류 목록은 상호를 바꾸면 비운다", async () => {
    서류성공(기업상태표결과());
    const { 화면 } = 서류화면();
    let tree = await 서류고르기(화면, [가짜파일("기업상태표_가상테크.xlsx")]);
    expect(올린서류줄(tree, "기업상태표_가상테크.xlsx")).toBeDefined();
    tree = 칸적기(화면, "name", "B상사");
    expect(올린서류줄(tree, "기업상태표_가상테크.xlsx")).toBeUndefined();
  });
});

describe("ProfileForm — 다른 사업자번호로 바꾸면 서류를 그 고객에 붙이지 않는다(BF2 ②)", () => {
  it("고객 A 를 불러온 뒤 번호를 456-81-67890 으로 바꾸면 업로드에 customerKey 가 없다", async () => {
    const { 화면 } = 서류화면();
    await 고객불러오기(화면, { companyName: "위들리테크", bizno: "123-81-45678" }, "위들리테크");
    칸적기(화면, "bizno", "456-81-67890");
    const fn = 서류성공(기업상태표결과());
    await 서류고르기(화면, [가짜파일("기업상태표_가상테크.xlsx")]);
    expect(올린본문(fn).get("customerKey")).toBeNull();
  });

  it("불러온 번호와 같은 번호를 다시 넣으면 열쇠는 그대로 보낸다", async () => {
    const { 화면 } = 서류화면();
    await 고객불러오기(화면, { companyName: "위들리테크", bizno: "123-81-45678" }, "위들리테크");
    칸적기(화면, "bizno", "123-81-45678");
    const fn = 서류성공(기업상태표결과());
    await 서류고르기(화면, [가짜파일("기업상태표_가상테크.xlsx")]);
    expect(올린본문(fn).get("customerKey")).toBe("위들리테크");
  });

  it("번호를 쓰다 만 중간 글자(123)도 불러온 번호와 달라 열쇠를 비운다", async () => {
    const { 화면 } = 서류화면();
    await 고객불러오기(화면, { companyName: "위들리테크", bizno: "123-81-45678" }, "위들리테크");
    칸적기(화면, "bizno", "123");
    const fn = 서류성공(기업상태표결과());
    await 서류고르기(화면, [가짜파일("기업상태표_가상테크.xlsx")]);
    expect(올린본문(fn).get("customerKey")).toBeNull();
  });
});

describe("ProfileForm — 번호가 바뀌는 모든 길에서 고객 열쇠를 비운다(BF3 ②)", () => {
  const 다른번호서류 = () =>
    읽은결과({
      fields: { bizno: "456-81-67890" },
      sources: { bizno: { files: ["등록증.pdf"], docTypes: ["biz-registration"] } },
    });

  it("서류 응답이 다른 번호를 칸에 채우면 다음 업로드에는 customerKey 가 없다", async () => {
    const { 화면 } = 서류화면();
    await 고객불러오기(화면, { companyName: "위들리테크", bizno: "123-81-45678" }, "위들리테크");
    const fn = 서류성공(다른번호서류());
    await 서류고르기(화면, [가짜파일("등록증.pdf")]);
    expect(올린본문(fn, 0).get("customerKey")).toBe("위들리테크"); // 올리는 시점엔 아직 같은 고객이다
    expect(칸값(화면.tree, "bizno")).toBe("456-81-67890");
    await 서류고르기(화면, [가짜파일("등록증.pdf")]);
    expect(올린본문(fn, 1).get("customerKey")).toBeNull();
  });

  it("서류 응답의 번호가 불러온 번호와 같으면 열쇠를 그대로 보낸다", async () => {
    const { 화면 } = 서류화면();
    await 고객불러오기(화면, { companyName: "위들리테크", bizno: "123-81-45678" }, "위들리테크");
    const fn = 서류성공(읽은결과({ fields: { bizno: "123-81-45678" } }));
    await 서류고르기(화면, [가짜파일("등록증.pdf")]);
    await 서류고르기(화면, [가짜파일("등록증.pdf")]);
    expect(올린본문(fn, 1).get("customerKey")).toBe("위들리테크");
  });

  it("고르는 상자에서 다른 번호를 고르면 다음 업로드에는 customerKey 가 없다", async () => {
    const { 화면 } = 서류화면();
    await 고객불러오기(화면, { companyName: "위들리테크", bizno: "123-81-45678" }, "위들리테크");
    칸적기(화면, "bizno", "123-81-45678"); // 같은 번호를 손으로 다시 넣었다 — 열쇠는 그대로, 손으로 만진 칸이 된다
    const fn = 서류성공(다른번호서류());
    await 서류고르기(화면, [가짜파일("등록증.pdf")]);
    expect(칸값(화면.tree, "bizno")).toBe("123-81-45678"); // 손 값은 덮이지 않고 고르는 상자가 뜬다
    상자단추누르기(화면, "bizno", "456-81-67890 · 사업자등록증");
    expect(칸값(화면.tree, "bizno")).toBe("456-81-67890");
    await 서류고르기(화면, [가짜파일("등록증.pdf")]);
    expect(올린본문(fn, 1).get("customerKey")).toBeNull();
  });
});

describe("ProfileForm — 쓰다 만 사업자번호는 서류가 덮지 않는다(BF2 ③)", () => {
  it("번호 123 을 넣은 뒤 서류가 987-81-12345 를 주면 칸은 123 그대로, 고르는 상자가 뜬다", async () => {
    서류성공(
      읽은결과({
        fields: { bizno: "987-81-12345" },
        sources: { bizno: { files: ["등록증.pdf"], docTypes: ["biz-registration"] } },
      }),
    );
    const { 받은, 화면 } = 서류화면();
    칸적기(화면, "bizno", "123");
    const 법인단추전 = 눌린단추들(화면.tree, "corp");
    await 서류고르기(화면, [가짜파일("등록증.pdf")]);

    expect(칸값(화면.tree, "bizno")).toBe("123");
    expect(글자(상자(화면.tree, "bizno"))).toContain("사업자번호 서류와 직접 넣은 값이 달라요 — 어느 값을 쓸까요?");
    expect(상자눌린단추들(화면.tree, "bizno")).toEqual(["123 · 직접 넣은 값"]);
    expect(눌린단추들(화면.tree, "corp")).toEqual(법인단추전); // 서류 번호가 법인·개인을 바꾸지 않았다
    expect(진단하기(화면, 받은).bizno).toBeUndefined(); // 10자리가 안 되면 진단에는 여전히 안 담긴다

    상자단추누르기(화면, "bizno", "987-81-12345 · 사업자등록증");
    expect(칸값(화면.tree, "bizno")).toBe("987-81-12345");
  });

  it("번호 칸을 지웠다면 빈 칸이라 서류 번호로 채운다", async () => {
    서류성공(읽은결과({ fields: { bizno: "987-81-12345" } }));
    const { 화면 } = 서류화면();
    칸적기(화면, "bizno", "123");
    칸적기(화면, "bizno", "");
    await 서류고르기(화면, [가짜파일("등록증.pdf")]);
    expect(칸값(화면.tree, "bizno")).toBe("987-81-12345");
    expect(상자없음(화면.tree, "bizno")).toBe(true);
  });
});

describe("ProfileForm — 서류 올리기 실패·제한 안내", () => {
  it("서버가 실패를 알리면 서버 안내 문구를 그대로 보이고 칸은 건드리지 않는다", async () => {
    서류응답붙이기({ success: false, error: { code: "READ_FAILED", message: "서류를 읽는 서버가 쉬고 있어요. 조금 뒤에 다시 올려 주세요" } });
    const { 받은, 화면 } = 서류화면();
    const tree = await 서류고르기(화면, [가짜파일("기업상태표_가상테크.xlsx")]);
    expect(글자(tree)).toContain("서류를 읽는 서버가 쉬고 있어요. 조금 뒤에 다시 올려 주세요");
    const 알림 = [...모든마디(tree)].find((m) => m.props.role === "alert")!;
    expect(글자(알림)).toContain("서류를 읽는 서버가 쉬고 있어요");
    expect(올린서류줄(tree, "기업상태표_가상테크.xlsx")).toBeUndefined();
    expect(글자(tree)).not.toContain("서류를 읽는 중이에요"); // 끝났으니 올리는 중 표시는 사라진다
    expect(진단하기(화면, 받은)).toEqual({});
  });

  it("서버 문구가 비어 있거나 응답이 이상하면 쉬운 기본 안내를 보인다", async () => {
    서류응답붙이기({ success: false, error: { code: "X", message: "" } });
    const { 화면 } = 서류화면();
    let tree = await 서류고르기(화면, [가짜파일("a.pdf")]);
    expect(글자(tree)).toContain("서류를 읽지 못했어요 — 잠시 뒤 다시 올려 주세요");

    서류응답붙이기(null);
    tree = await 서류고르기(화면, [가짜파일("a.pdf")]);
    expect(글자(tree)).toContain("서류를 읽지 못했어요 — 잠시 뒤 다시 올려 주세요");
  });

  it("연결이 끊기면 쉬운 말로 알린다", async () => {
    서류응답붙이기(new Error("synthetic network failure"));
    const { 화면 } = 서류화면();
    const tree = await 서류고르기(화면, [가짜파일("a.pdf")]);
    expect(글자(tree)).toContain("서류를 올리지 못했어요 — 연결을 확인하고 다시 올려 주세요");
  });

  it("올리는 동안 「읽는 중」을 보이고 입력을 막는다", async () => {
    let 끝내기: (v: unknown) => void = () => {};
    const fn = vi.fn(
      () =>
        new Promise((resolve) => {
          끝내기 = resolve;
        }),
    );
    vi.stubGlobal("fetch", fn);
    const { 화면 } = 서류화면();
    (파일입력(화면.tree).props.onChange as (e: unknown) => void)({ target: { files: [가짜파일("a.pdf")], value: "" } });
    let tree = 화면.다시그리기();
    expect(글자(tree)).toContain("서류를 읽는 중이에요");
    expect(파일입력(tree).props.disabled).toBe(true);

    끝내기({ json: async () => ({ success: true, data: 읽은결과() }) });
    tree = await 흘리기(화면);
    expect(글자(tree)).not.toContain("서류를 읽는 중이에요");
    expect(파일입력(tree).props.disabled).toBe(false);
  });

  it("한 번에 10개를 넘게 고르면 서버에 보내지 않고 쉬운 말로 막는다", async () => {
    const fn = 서류성공(읽은결과());
    const { 화면 } = 서류화면();
    const 열한개 = Array.from({ length: 11 }, (_, i) => 가짜파일(`서류${i}.pdf`));
    const tree = await 서류고르기(화면, 열한개);
    expect(fn).not.toHaveBeenCalled();
    expect(글자(tree)).toContain("한 번에 10개까지 올릴 수 있어요");
    expect(글자(tree)).toContain("11개");
    expect([...모든마디(tree)].some((m) => m.props.role === "alert")).toBe(true);
  });

  it("파일 하나가 20MB 를 넘으면 서버에 보내지 않고 그 파일 이름과 함께 알린다", async () => {
    const fn = 서류성공(읽은결과());
    const { 화면 } = 서류화면();
    const tree = await 서류고르기(화면, [가짜파일("작은.pdf"), 가짜파일("큰파일.pdf", 21 * 1024 * 1024)]);
    expect(fn).not.toHaveBeenCalled();
    expect(글자(tree)).toContain("큰파일.pdf");
    expect(글자(tree)).toContain("20MB");
  });

  it("제한 안내는 다음에 제대로 올리면 사라진다", async () => {
    서류성공(읽은결과());
    const { 화면 } = 서류화면();
    let tree = await 서류고르기(화면, [가짜파일("큰파일.pdf", 21 * 1024 * 1024)]);
    expect([...모든마디(tree)].some((m) => m.props.role === "alert")).toBe(true);
    tree = await 서류고르기(화면, [가짜파일("a.pdf")]);
    expect([...모든마디(tree)].some((m) => m.props.role === "alert")).toBe(false);
  });

  it("고른 파일이 없으면 아무 일도 하지 않는다", async () => {
    const fn = 서류성공(읽은결과());
    const { 화면 } = 서류화면();
    await 서류고르기(화면, []);
    expect(fn).not.toHaveBeenCalled();
  });
});
