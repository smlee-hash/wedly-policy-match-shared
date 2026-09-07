import { describe, expect, it } from "vitest";
import React, { useState } from "react";
import ProfileForm from "./ProfileForm";

/**
 * 「기존 고객 검색어를 적고 → 폼을 접었다 → 다시 펴면 검색어·안내가 남아 있는가」를 잰다.
 *
 * ★왜 손으로 만든 작은 React 가 필요한가:
 *  이 저장소엔 jsdom·@testing-library/react 가 없다(2026-09-04 실측 — vitest 환경도 node 다).
 *  `renderToStaticMarkup` 은 **한 번 그리고 끝**이라 상태가 바뀌는 이야기를 못 잰다.
 *  그래서 React 가 hook 을 꺼내 쓰는 자리(dispatcher)에 아주 작은 살림을 끼워 넣고,
 *  부품을 직접 불러 「그린 나무」를 만든 뒤 단추를 눌러 다시 그린다.
 *  ⚠ 이 살림이 진짜 React 를 흉내 내는 지점은 딱 하나다 — **화면에서 빠진 부품은 사라지고
 *  그 상태도 함께 지워진다.** 그 규칙이 실제로 이빨을 가졌는지는 아래 「대조군」이 지킨다.
 *  (진짜 브라우저 확인은 배포본 QA 몫이다.)
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
    // React 판을 올렸는데 이 자리 이름이 바뀌면 여기서 먼저 걸린다(hook 오류보다 읽기 쉽다).
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
        if (!this.이번에본.has(자리)) this.칸.delete(자리); // 화면에서 빠진 부품 = 상태도 지워진다
      }
      return this.tree;
    } finally {
      REACT_INTERNALS.H = 앞살림;
    }
  }

  /** 단추를 누른 뒤 다시 그린다(진짜 React 는 알아서 하지만 여기선 시험이 시킨다). */
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

/** 그 나무에 실제로 보이는 글자만 모은다(class 이름 같은 속성은 안 센다). */
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

const 검색안내 = "기존 고객 검색";
const 폼 = (prefillEndpoint?: string) => (
  <ProfileForm onDiagnose={async () => true} diagnosing={false} prefillEndpoint={prefillEndpoint} />
);

// ── ① 진짜 재현 — 접었다 펴도 검색어·안내가 남는다 ──────────────────────────
describe("① 기존 고객 검색 — 접었다 펴도 적어 둔 검색어와 안내가 남는다", () => {
  it("검색어 입력 → 접기 → 조건 수정 뒤에도 그대로다(ERP 원문 동작)", () => {
    const 화면 = new 손React();
    화면.render(폼("/api/policy-match/prefill"));

    // 안내 한 줄을 띄운다 — 빈 검색으로 누르면 통신 없이 그 자리에서 안내가 뜬다.
    let tree = 누르기(화면, "불러오기");
    expect(글자(tree)).toContain("사업자번호 또는 상호를 입력하세요");

    tree = 적기(화면, 검색안내, "위들리테크");
    expect(칸찾기(tree, 검색안내)?.props.value).toBe("위들리테크");

    // 접으면 검색 줄은 화면에서 사라진다(원문과 같다 — 없어지는 건 「보이는 줄」뿐이다).
    tree = 누르기(화면, "접기");
    expect(칸찾기(tree, 검색안내), "접으면 검색 줄은 안 보인다").toBeNull();
    expect(글자(tree)).not.toContain("사업자번호 또는 상호를 입력하세요");

    // 다시 펴면 적어 둔 값과 안내가 그대로 돌아온다 ← 상태를 부모가 들 때만 참이다.
    tree = 누르기(화면, "조건 수정");
    expect(칸찾기(tree, 검색안내)?.props.value, "접었다 펴니 검색어가 지워졌다").toBe("위들리테크");
    expect(글자(tree), "접었다 펴니 안내가 지워졌다").toContain("사업자번호 또는 상호를 입력하세요");
  });

  it("통로를 안 넘긴 앱에는 검색 줄이 아예 없고, 접었다 펴도 탈이 없다", () => {
    const 화면 = new 손React();
    let tree = 화면.render(폼());
    expect(칸찾기(tree, 검색안내)).toBeNull();
    expect(글자(tree)).toContain("사업자 정보");

    tree = 누르기(화면, "접기");
    tree = 누르기(화면, "조건 수정");
    expect(칸찾기(tree, 검색안내)).toBeNull();
    expect(글자(tree)).toContain("매칭 진단");
  });
});

// ── ② 대조군 — 위 시험을 재는 자(손React)가 실제로 이빨을 가졌는가 ──────────
function 아이가든칸() {
  const [v, setV] = useState("");
  return <input value={v} placeholder="아이 칸" onChange={(e) => setV(e.target.value)} />;
}

function 접히는부모({ 아이가드는가 }: { 아이가드는가: boolean }) {
  const [open, setOpen] = useState(true);
  const [v, setV] = useState("");
  return (
    <div>
      <button type="button" onClick={() => setOpen((x) => !x)}>{open ? "접기" : "조건 수정"}</button>
      {open && (아이가드는가
        ? <아이가든칸 />
        : <input value={v} placeholder="아이 칸" onChange={(e) => setV(e.target.value)} />)}
    </div>
  );
}

describe("② 대조군 — 이 자(손React)가 「사라지면 상태도 지워진다」를 실제로 잡는다", () => {
  const 접었다펴기 = (아이가드는가: boolean) => {
    const 화면 = new 손React();
    화면.render(<접히는부모 아이가드는가={아이가드는가} />);
    적기(화면, "아이 칸", "가나다");
    expect(칸찾기(화면.tree, "아이 칸")?.props.value).toBe("가나다");
    누르기(화면, "접기");
    return 누르기(화면, "조건 수정");
  };

  it("상태를 접히는 부품 안에 두면 접었다 펴는 순간 지워진다(= 고쳐진 회귀의 모양)", () => {
    expect(칸찾기(접었다펴기(true), "아이 칸")?.props.value).toBe("");
  });

  it("상태를 부모가 들면 그대로 남는다(= 고친 뒤의 모양)", () => {
    expect(칸찾기(접었다펴기(false), "아이 칸")?.props.value).toBe("가나다");
  });
});
