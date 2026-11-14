// 단추·카드 클래스 글자 — ERP `components/ui/Button.tsx`·`Card.tsx` 가 만드는 글자를 **그대로 적어 둔** 값과 맞는지 본다.
// ERP 원본이 바뀌면 이 값과 `classes.ts` 를 함께 고친다(어긋나면 두 앱의 단추·카드가 달라진다).
import { describe, expect, it } from "vitest";
import { bezelCoreClass, bezelShellClass, buttonClass, sectionCardClass } from "./classes";

const BUTTON_BASE =
  "inline-flex items-center justify-center rounded-wedly-btn transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-wedly-accent focus-visible:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none";
const PRIMARY = "bg-wedly-accent text-white hover:bg-wedly-accent-hover active:bg-wedly-accent-active";
const SECONDARY = "bg-white text-wedly-t1 border border-wedly-bd hover:bg-wedly-bg-gray active:bg-wedly-bg-sidebar";
const XS = "h-7 px-2 text-xs font-medium gap-1";
const SM = "h-8 px-3 text-sm font-bold gap-1.5";

describe("buttonClass — ERP Button 과 같은 글자", () => {
  it("primary·secondary × xs·sm 네 가지", () => {
    expect(buttonClass("primary", "xs")).toBe(`${BUTTON_BASE} ${PRIMARY} ${XS}`);
    expect(buttonClass("primary", "sm")).toBe(`${BUTTON_BASE} ${PRIMARY} ${SM}`);
    expect(buttonClass("secondary", "xs")).toBe(`${BUTTON_BASE} ${SECONDARY} ${XS}`);
    expect(buttonClass("secondary", "sm")).toBe(`${BUTTON_BASE} ${SECONDARY} ${SM}`);
  });

  it("덧붙인 클래스는 맨 뒤에 온다", () => {
    expect(buttonClass("primary", "xs", "ml-2")).toBe(`${BUTTON_BASE} ${PRIMARY} ${XS} ml-2`);
  });
});

const CARD_BASE = "border border-wedly-bd bg-white rounded-wedly-card shadow-wedly-resting";

describe("sectionCardClass — ERP Card variant=section 과 같은 글자", () => {
  it("여백 네 칸", () => {
    expect(sectionCardClass("none")).toBe(`${CARD_BASE} overflow-hidden p-0`);
    expect(sectionCardClass("sm")).toBe(`${CARD_BASE} p-4`);
    expect(sectionCardClass("md")).toBe(`${CARD_BASE} p-6`);
    expect(sectionCardClass("lg")).toBe(`${CARD_BASE} p-8`);
  });

  it("여백 0 의 자르기는 clip=false 로 끄고, 다른 여백에는 주지 않는다", () => {
    expect(sectionCardClass("none", undefined, false)).toBe(`${CARD_BASE} p-0`);
    expect(sectionCardClass("sm", undefined, true)).toBe(`${CARD_BASE} p-4`);
  });

  it("덧붙인 클래스는 맨 뒤에 오고, 같은 종류(여백)는 뒤의 것이 이긴다", () => {
    expect(sectionCardClass("lg", "text-center")).toBe(`${CARD_BASE} p-8 text-center`);
    expect(sectionCardClass("sm", "p-3 sm:p-4")).toBe(`${CARD_BASE} p-3 sm:p-4`);
  });
});

describe("이중 베젤 — ERP Card 기본과 같은 글자", () => {
  it("바깥 셸", () => {
    expect(bezelShellClass()).toBe("flex flex-col rounded-wedly-card border border-wedly-bd bg-wedly-bg-gray p-2 shadow-wedly-resting");
    expect(bezelShellClass("h-full")).toBe("flex flex-col rounded-wedly-card border border-wedly-bd bg-wedly-bg-gray p-2 shadow-wedly-resting h-full");
  });

  it("안쪽 흰 코어 — 여백 0 일 때만 자른다", () => {
    expect(bezelCoreClass("md")).toBe("relative flex-1 rounded-wedly-inner bg-white shadow-sm p-6");
    expect(bezelCoreClass("none")).toBe("relative flex-1 rounded-wedly-inner bg-white shadow-sm overflow-hidden p-0");
    expect(bezelCoreClass("none", false)).toBe("relative flex-1 rounded-wedly-inner bg-white shadow-sm p-0");
  });
});
