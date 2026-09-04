import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import CustomSelect from "./CustomSelect";

/**
 * 그려서 재는 시험 — `CustomSelect` 의 **여는 단추 클래스**만 본다.
 *
 * ★왜 이 시험이 있나 (2026-09-04 자금 조달 지도 조작줄):
 *  조작줄에서 이 부품만 42px 이라 혼자 컸다. 그런데 **이 부품을 ERP 43개 화면과 일루아 2개 화면이
 *  쓴다(실측)** — 부품 기본 높이를 36px 로 내리면 그 화면들이 전부 함께 바뀌는데 그건 승인된
 *  범위가 아니다. 그래서 기본은 그대로 두고 `controlClassName` 이라는 **바깥에서 안쪽 단추에
 *  클래스를 주는 길**만 냈다. 이 시험은 그 두 가지를 함께 못 박는다:
 *   ① 값을 안 주면 클래스가 **글자 하나 안 바뀐다**(다른 45개 화면 불변)
 *   ② 값을 주면 옛 값(`py-2.5`)을 **확실히 이긴다**(문자열 이어붙이기로는 못 이긴다)
 *
 *  부품 전체를 정본 높이(`h-9`)로 수렴시키는 일은 **별도 승인이 필요한 후속**이다.
 */

/** 손대기 전(2026-09-04) 여는 단추의 클래스 — 한 글자라도 달라지면 45개 화면이 함께 바뀐 것이다. */
const 옛클래스 =
  "w-full text-left appearance-none px-3 py-2.5 pr-8 text-sm border border-wedly-bd rounded-xl " +
  "bg-white focus:outline-none focus:ring-2 focus:ring-wedly-accent/30 focus:border-wedly-accent " +
  "transition-colors cursor-pointer hover:border-wedly-accent/50 text-wedly-t1";

const 보기 = [
  { value: "rec", label: "추천순" },
  { value: "deadline", label: "마감 임박순" },
];

/** 여는 단추의 `class="…"` 값만 뽑는다. */
function 단추클래스(html: string): string {
  const i = html.indexOf("<button");
  expect(i, "여는 단추가 없다").toBeGreaterThan(-1);
  const m = /class="([^"]*)"/.exec(html.slice(i));
  expect(m, "여는 단추에 클래스가 없다").not.toBeNull();
  return m![1];
}

function 그린다(props: Partial<React.ComponentProps<typeof CustomSelect>> = {}): string {
  return renderToStaticMarkup(
    <CustomSelect value="rec" onChange={() => {}} options={보기} {...props} />,
  );
}

describe("CustomSelect — 안쪽 단추에 클래스를 주는 길(controlClassName)", () => {
  it("기본값(값을 안 줌)은 손대기 전과 클래스가 한 글자도 다르지 않다 — 다른 45개 화면 불변", () => {
    expect(단추클래스(그린다())).toBe(옛클래스);
  });

  it("기본 렌더에는 h-9 가 안 붙는다 — 부품 기본 높이는 그대로 42px(py-2.5)다", () => {
    const cls = 단추클래스(그린다());
    expect(cls, "부품 기본 높이가 바뀌었다").not.toContain("h-9");
    expect(cls, "옛 위아래 여백이 사라졌다").toContain("py-2.5");
  });

  it("controlClassName 을 주면 안쪽 단추에 붙고, 옛 py-2.5 를 확실히 이긴다", () => {
    const cls = 단추클래스(그린다({ controlClassName: "flex h-9 items-center py-0" }));
    expect(cls, "높이가 안 붙었다").toContain("h-9");
    expect(cls, "글자 세로 가운데 정렬이 안 붙었다").toContain("items-center");
    // ★문자열을 이어붙이기만 하면 어느 쪽이 이길지는 클래스 차례가 아니라 Tailwind 가 만든 CSS
    //  차례가 정한다 — 그래서 합치기 도구가 옛 값을 **지워** 줘야 한다.
    expect(cls, "옛 py-2.5 가 안 지워져 높이가 안 맞는다").not.toContain("py-2.5");
    // 나머지 겉모습(테두리·모서리·글자 크기)은 그대로다
    for (const 그대로 of ["border-wedly-bd", "rounded-xl", "text-sm", "pr-8", "px-3"]) {
      expect(cls, `${그대로} 가 사라졌다`).toContain(그대로);
    }
  });

  /**
   * ★독립 검사 지적 ④(2026-09-04) — 조작줄 글자 크기가 3종이었다(알약 13 · 칩 11 · **셀렉트 14** ·
   *  라벨 11). 셀렉트만 부품 기본 `text-sm`(14px)이라 혼자 컸다.
   *
   *  높이와 **같은 길**(`controlClassName`)로 크기도 줄 수 있는지가 관건이었다. 이 저장소의
   *  `cn`(`@wedly/ui-shared/src/ui/cn.ts`)은 WEDLY 글자 여섯 층을 「글자 크기」 무리로 등록해 두어서,
   *  `text-wedly-sub` 가 들어오면 합치기 도구가 `text-sm` 을 **지운다**. 등록이 없으면 도구가
   *  `text-...` 를 전부 「글자 색」으로 보고 **둘 다 내보내** 어느 쪽이 이길지는 Tailwind 가 만든
   *  CSS 차례가 정한다(= 조용히 안 먹는다). 그래서 「지워졌는지」를 직접 잰다.
   */
  it("controlClassName 으로 글자 크기도 먹는다 — 부품 기본 text-sm 이 실제로 지워진다", () => {
    const cls = 단추클래스(그린다({ controlClassName: "flex h-9 items-center py-0 text-wedly-sub" }));
    expect(cls, "13px 층이 안 붙었다").toContain("text-wedly-sub");
    expect(cls, "부품 기본 14px(text-sm)이 안 지워졌다 — 두 크기가 함께 나가 조용히 안 먹는다").not.toContain("text-sm");
    // 높이·정렬은 함께 먹고, 겉모습 나머지는 그대로다
    expect(cls, "높이가 안 붙었다").toContain("h-9");
    for (const 그대로 of ["border-wedly-bd", "rounded-xl", "pr-8", "px-3", "text-wedly-t1"]) {
      expect(cls, `${그대로} 가 사라졌다`).toContain(그대로);
    }
  });

  it("★기본값 불변 — 값을 안 주면 글자 크기가 여전히 14px 이다(다른 45개 화면)", () => {
    const 기본 = 단추클래스(그린다());
    expect(기본, "부품 기본 글자 크기가 13px 로 내려갔다 — ERP 43·일루아 2 화면이 함께 바뀐다").toContain("text-sm");
    expect(기본, "부품 기본에 13px 층이 새어 들어갔다").not.toContain("text-wedly-sub");
    // 어떤 이름으로 불러도 기본은 같다 — `className` 은 겉 div 로만 가므로 안쪽 크기를 못 바꾼다
    expect(단추클래스(그린다({ className: "text-wedly-sub" })), "className 이 안쪽 글자 크기를 바꿨다").toBe(기본);
  });

  it("className 은 겉 div 로만 간다 — 두 길이 서로 섞이지 않는다", () => {
    const html = 그린다({ className: "min-w-[8.5rem]", controlClassName: "h-9" });
    const 겉 = html.slice(0, html.indexOf("<button"));
    expect(겉, "겉 div 에 className 이 안 갔다").toContain("min-w-[8.5rem]");
    expect(겉, "controlClassName 이 겉 div 로 샜다").not.toContain("h-9");
    expect(단추클래스(html), "className 이 안쪽 단추로 샜다").not.toContain("min-w-[8.5rem]");
  });
});
