// 시험 전용 — jsdom·testing-library 없이 훅이 든 화면 부품을 실제로 돌려 본다. 앱 코드는 가져가지 않는다(내보내는 곳에도 없다).
//
// 이 보관함의 시험 환경은 node 라서 DOM 이 없다. 그래서 `react` 의 훅(useState·useEffect·useRef·useMemo·useCallback)을
// 이 파일의 작은 실행기로 바꿔서 부품을 돌린다 — 부품이 그린 요소 트리를 끝까지 풀어(`HostNode`) 글자·속성을 읽고,
// 단추의 `onClick` 을 부르고, 효과(useEffect)를 실제로 돌리고, 상태가 바뀌면 다시 그린다.
//
// 쓰는 법(시험 파일 맨 위):
//   vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), ...(await import("./test-kit")).hooks }));
//   const root = mountTree(<Board … />, { opaque: [Checkbox, CustomSelect] });
//   await root.settle();                        // 읽기(fetch)·효과·다시 그리기가 가라앉을 때까지
//   await root.click(find(root.tree, …));       // 눌러 보기
//
// 한 번에 한 판만 그린다(`step()`) — 「불러오는 중」처럼 거르기를 바꾼 바로 다음 그림을 보고 싶을 때 쓴다.
import { vi } from "vitest";
import type { ReactElement, ReactNode } from "react";

export interface HostNode {
  tag: string;
  props: Record<string, unknown>;
  kids: Array<HostNode | string>;
}

type Cleanup = void | (() => void);
type Deps = readonly unknown[] | undefined;
interface EffectSlot {
  deps: Deps;
  cleanup: Cleanup;
  ran: boolean;
}
interface PendingEffect {
  slot: EffectSlot;
  run: () => Cleanup;
}

class Instance {
  slots: unknown[] = [];
  cursor = 0;
  seen = false;
  constructor(readonly root: Root) {}
}

let current: Instance | null = null;
let queue: PendingEffect[] | null = null;
let idCounter = 0;

function need(): Instance {
  if (!current) throw new Error("훅은 test-kit 의 mountTree 안에서만 부를 수 있습니다.");
  return current;
}

function slot<T>(make: () => T): T {
  const inst = need();
  const index = inst.cursor++;
  if (inst.slots.length <= index) inst.slots[index] = make();
  return inst.slots[index] as T;
}

const sameDeps = (a: Deps, b: Deps): boolean => !!a && !!b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));

function useEffect(run: () => Cleanup, deps?: Deps): void {
  const s = slot<EffectSlot>(() => ({ deps: undefined, cleanup: undefined, ran: false }));
  if (s.ran && sameDeps(s.deps, deps)) return;
  s.deps = deps;
  queue?.push({ slot: s, run });
}

export const hooks = {
  useState<T>(initial: T | (() => T)): [T, (next: T | ((previous: T) => T)) => void] {
    const inst = need();
    const s = slot(() => {
      const state: { value: T; set: (next: T | ((previous: T) => T)) => void } = {
        value: typeof initial === "function" ? (initial as () => T)() : initial,
        set: () => {},
      };
      state.set = (next) => {
        const value = typeof next === "function" ? (next as (previous: T) => T)(state.value) : next;
        if (Object.is(value, state.value)) return;
        state.value = value;
        inst.root.markDirty();
      };
      return state;
    });
    return [s.value, s.set];
  },
  useRef<T>(initial: T): { current: T } {
    return slot(() => ({ current: initial }));
  },
  useMemo<T>(factory: () => T, deps: Deps): T {
    const s = slot<{ value: T; deps: Deps; has: boolean }>(() => ({ value: undefined as T, deps: undefined, has: false }));
    if (!s.has || !sameDeps(s.deps, deps)) {
      s.value = factory();
      s.deps = deps;
      s.has = true;
    }
    return s.value;
  },
  useCallback<T>(callback: T, deps: Deps): T {
    return hooks.useMemo(() => callback, deps);
  },
  useEffect,
  useLayoutEffect: useEffect,
  useId(): string {
    return slot(() => `id-${++idCounter}`);
  },
};

export interface MountOptions {
  /** 안쪽을 풀지 않고 요소 그대로 두는 부품(ui-shared 의 Checkbox·Toast 등). 이름표 `tag` 는 그 부품 이름이다. */
  opaque?: readonly unknown[];
}

const FRAGMENT = Symbol.for("react.fragment");

function nameOf(type: unknown): string {
  const t = type as { displayName?: string; name?: string; render?: { name?: string }; type?: { name?: string } };
  return t.displayName || t.name || t.render?.name || t.type?.name || "Component";
}

class Root {
  tree: HostNode = { tag: "#root", props: {}, kids: [] };
  renders = 0;
  private dirty = false;
  private instances = new Map<string, Instance>();
  private opaque: ReadonlySet<unknown>;

  constructor(
    private element: ReactNode,
    options: MountOptions,
  ) {
    this.opaque = new Set(options.opaque ?? []);
    this.draw();
  }

  markDirty(): void {
    this.dirty = true;
  }

  get isDirty(): boolean {
    return this.dirty;
  }

  /** 새 요소(바뀐 props)로 다시 그린다. */
  update(element: ReactNode): void {
    this.element = element;
    this.draw();
  }

  /** 상태가 바뀌어 있으면 한 판만 다시 그린다. 그렸으면 true. */
  step(): boolean {
    if (!this.dirty) return false;
    this.draw();
    return true;
  }

  /** 읽기(fetch)·효과·다시 그리기가 가라앉을 때까지 기다린다. */
  async settle(): Promise<void> {
    let quiet = 0;
    for (let round = 0; round < 40 && quiet < 2; round++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      let worked = false;
      while (this.dirty) {
        this.step();
        worked = true;
      }
      quiet = worked ? 0 : quiet + 1;
    }
  }

  /** 화면이 받은 함수(onClick·onChange·onOpen 등)를 부르고 가라앉을 때까지 기다린다. */
  async act(run: () => unknown): Promise<void> {
    await run();
    await this.settle();
  }

  /** 함수만 부르고 상태가 바뀐 **첫 판**만 그린다(기다리지 않는다) — 「거르기를 바꾼 첫 화면」을 볼 때. */
  async actFirstFrame(run: () => unknown): Promise<void> {
    await run();
    for (let i = 0; i < 10; i++) await Promise.resolve();
    this.step();
  }

  /** 단추를 누른다 — onClick 을 부르고 가라앉을 때까지 기다린다. */
  async click(node: HostNode | undefined): Promise<void> {
    await this.act(() => clickHandler(node));
  }

  async clickFirstFrame(node: HostNode | undefined): Promise<void> {
    await this.actFirstFrame(() => clickHandler(node));
  }

  unmount(): void {
    for (const inst of this.instances.values()) cleanupAll(inst);
    this.instances.clear();
  }

  private draw(): void {
    this.dirty = false;
    this.renders += 1;
    const effects: PendingEffect[] = [];
    queue = effects;
    for (const inst of this.instances.values()) inst.seen = false;
    try {
      this.tree = { tag: "#root", props: {}, kids: this.expand(this.element, "r") };
    } finally {
      queue = null;
    }
    for (const [path, inst] of this.instances) {
      if (inst.seen) continue;
      cleanupAll(inst);
      this.instances.delete(path);
    }
    for (const { slot: s } of effects) if (s.ran && typeof s.cleanup === "function") s.cleanup();
    for (const effect of effects) {
      effect.slot.cleanup = effect.run();
      effect.slot.ran = true;
    }
  }

  private instance(path: string): Instance {
    let inst = this.instances.get(path);
    if (!inst) {
      inst = new Instance(this);
      this.instances.set(path, inst);
    }
    inst.seen = true;
    inst.cursor = 0;
    return inst;
  }

  private call(path: string, render: () => ReactNode): ReactNode {
    const inst = this.instance(path);
    const previous = current;
    current = inst;
    try {
      return render();
    } finally {
      current = previous;
    }
  }

  private expand(node: ReactNode, path: string): Array<HostNode | string> {
    if (node === null || node === undefined || typeof node === "boolean") return [];
    if (typeof node === "string" || typeof node === "number") return [String(node)];
    if (Array.isArray(node)) return node.flatMap((child, i) => this.expand(child as ReactNode, `${path}.${i}`));
    const element = node as ReactElement<Record<string, unknown>>;
    const { type, props } = element;
    const here = `${path}/${typeof type === "string" ? type : nameOf(type)}${element.key === null ? "" : `#${element.key}`}`;
    const { children, ...rest } = props;
    const kind: unknown = type;
    if (kind === FRAGMENT) return this.expand(children as ReactNode, here);
    if (typeof type === "string") return [{ tag: type, props: rest, kids: this.expand(children as ReactNode, here) }];
    if (this.opaque.has(type)) return [{ tag: nameOf(type), props, kids: [] }];
    if (typeof type === "function") {
      return this.expand(this.call(here, () => (type as (p: Record<string, unknown>) => ReactNode)(props)), here);
    }
    const boxed = type as { $$typeof?: symbol; render?: (p: unknown, ref: unknown) => ReactNode; type?: unknown };
    if (boxed.$$typeof === Symbol.for("react.forward_ref") && boxed.render) {
      const render = boxed.render;
      return this.expand(this.call(here, () => render(props, null)), here);
    }
    if (boxed.$$typeof === Symbol.for("react.memo") && boxed.type) {
      return this.expand({ ...element, type: boxed.type } as ReactElement, path);
    }
    throw new Error(`test-kit 이 풀 수 없는 요소 종류입니다: ${nameOf(type)}`);
  }
}

function clickHandler(node: HostNode | undefined): unknown {
  if (!node) throw new Error("누를 대상이 화면에 있어야 합니다.");
  const handler = node.props.onClick as ((event: unknown) => unknown) | undefined;
  if (typeof handler !== "function") throw new Error(`「${node.tag}」에 onClick 이 없습니다.`);
  return handler({ preventDefault() {}, stopPropagation() {} });
}

function cleanupAll(inst: Instance): void {
  for (const s of inst.slots) {
    const effect = s as Partial<EffectSlot>;
    if (effect && typeof effect === "object" && "ran" in effect && effect.ran && typeof effect.cleanup === "function") effect.cleanup();
  }
}

export type { Root };
export function mountTree(element: ReactNode, options: MountOptions = {}): Root {
  return new Root(element, options);
}

// ── 트리 읽기 도우미 ─────────────────────────────────────────────

export function textOf(node: HostNode | string | ReadonlyArray<HostNode | string>): string {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(textOf).join("");
  return (node as HostNode).kids.map(textOf).join("");
}

export function findAll(node: HostNode, test: (node: HostNode) => boolean): HostNode[] {
  const found: HostNode[] = test(node) ? [node] : [];
  for (const kid of node.kids) if (typeof kid !== "string") found.push(...findAll(kid, test));
  return found;
}

export function find(node: HostNode, test: (node: HostNode) => boolean): HostNode | undefined {
  return findAll(node, test)[0];
}

export const byTag = (node: HostNode, tag: string): HostNode[] => findAll(node, (n) => n.tag === tag);

/** 글자가 맞는 단추들 — 문자열이면 앞뒤 공백을 뗀 글자가 같은 것, 정규식이면 맞는 것. */
export function buttonsWith(node: HostNode, text: string | RegExp): HostNode[] {
  return byTag(node, "button").filter((b) => (typeof text === "string" ? textOf(b).trim() === text : text.test(textOf(b))));
}

export const propOf = (node: HostNode | undefined, name: string): unknown => node?.props[name];

/** 표(table)의 머리 글자들 — `th` 마다 한 칸. */
export const headsOf = (table: HostNode): string[] => byTag(table, "th").map((th) => textOf(th).trim());

/** 표에서 업체(글자가 든 줄)의 칸을 머리 글자로 찾는다. */
export function cellOf(table: HostNode, rowText: string, head: string): HostNode | null {
  const index = headsOf(table).indexOf(head);
  const body = byTag(table, "tbody")[0];
  const tr = body ? byTag(body, "tr").find((row) => textOf(row).includes(rowText)) : undefined;
  return index < 0 || !tr ? null : byTag(tr, "td")[index] ?? null;
}

// ── 브라우저 흉내 ────────────────────────────────────────────────

/** `window`(주소·history·타이머)와 `document` 를 시험용으로 바꾼다. 시험이 끝나면 `vi.unstubAllGlobals()`. */
export function stubBrowser(search = "", pathname = "/policy-companies", hash = ""): {
  replaceState: ReturnType<typeof vi.fn>;
  location: { search: string; pathname: string; hash: string };
} {
  const location = { search, pathname, hash };
  // 진짜 브라우저처럼 replaceState 가 주소를 바꾼다 — 화면이 바뀐 주소를 다시 읽어도 맞게.
  const replaceState = vi.fn((_state: unknown, _title: string, url: string) => {
    const next = new URL(url, "http://localhost");
    location.pathname = next.pathname;
    location.search = next.search;
    location.hash = next.hash;
  });
  vi.stubGlobal("window", { location, history: { state: null, replaceState }, setTimeout, clearTimeout });
  vi.stubGlobal("document", { getElementById: () => null });
  return { replaceState, location };
}

export const jsonResponse = (value: unknown, status = 200): Response =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
