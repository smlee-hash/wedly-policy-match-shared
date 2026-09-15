import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CustomSelectListbox } from "./CustomSelect";

/**
 * 열린 목록(`ul[role=listbox]`)을 그려서 재는 시험.
 *
 * ★왜 이 시험이 있나 (2026-09-15 컨설팅 업무 현황 「사유」 칸):
 *  이 목록은 `document.body` 로 포털된다. Radix 모달이 열려 있으면 body 가 `pointer-events: none`
 *  이라 목록이 그 값을 상속해 **보이지만 누를 수 없는** 상태가 된다(운영 화면 `elementFromPoint`
 *  실측 — 클릭이 목록을 통과해 아래 모달 본문에 떨어졌다). 그래서 목록 자신에게
 *  `pointer-events: auto` 를 박아 두는데, 이 값이 사라지면 같은 결함이 그대로 돌아온다.
 *
 *  이 저장소엔 jsdom 이 없어(`vitest.config.ts` 머리주석) 실제 맞히기(hit-test)까지는 못 재고,
 *  실제로 그린 `ul` 의 인라인 style 에 그 값이 **있는지**만 잰다. 눌러서 고르는 것 자체는
 *  배포본 브라우저 QA 가 맡는다(같은 날 보고서).
 */

const 자리 = { placement: "down" as const, top: 120, left: 40, width: 320, maxHeight: 240 };

function ul속성(html: string, 이름: string): string {
  const i = html.indexOf("<ul");
  expect(i, "목록(ul)이 없다").toBeGreaterThan(-1);
  const m = new RegExp(`${이름}="([^"]*)"`).exec(html.slice(i));
  expect(m, `목록에 ${이름} 이 없다`).not.toBeNull();
  return m![1];
}

describe("CustomSelectListbox — 포털된 목록은 모달 아래에서도 눌린다", () => {
  const html = renderToStaticMarkup(
    <CustomSelectListbox menuRef={null} id="m" pos={자리}>
      <li role="option">추천순</li>
    </CustomSelectListbox>,
  );

  it("ul 자신에게 pointer-events:auto 가 박혀 있다 — body 의 none 을 상속하지 않는다", () => {
    expect(ul속성(html, "style")).toContain("pointer-events:auto");
  });

  it("고정 위치·폭·높이는 그대로다(기본 불변)", () => {
    const style = ul속성(html, "style");
    expect(style).toContain("position:fixed");
    expect(style).toContain("top:120px");
    expect(style).toContain("left:40px");
    expect(style).toContain("width:320px");
    expect(style).toContain("max-height:240px");
    expect(ul속성(html, "role")).toBe("listbox");
    expect(ul속성(html, "class")).toContain("z-[100]");
  });

  it("위로 펼칠 때는 top 대신 bottom 을 쓴다", () => {
    const up = renderToStaticMarkup(
      <CustomSelectListbox menuRef={null} id="m" pos={{ ...자리, placement: "up", bottom: 30 }}>
        <li role="option">추천순</li>
      </CustomSelectListbox>,
    );
    const style = ul속성(up, "style");
    expect(style).toContain("bottom:30px");
    expect(style).not.toContain("top:");
  });
});
