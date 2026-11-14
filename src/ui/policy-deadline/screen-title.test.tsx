// 본문 제목 없음 — 실제 React 로 서버 쪽에서 한 번 그려 본다(훅 실행기 없이). 화면 이름(제목)은 앱 위 띠가 그린다.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import PolicyCompaniesScreen from "./PolicyCompaniesScreen";
import { DEADLINE_ENDPOINTS } from "./endpoints";

const MINE_LINE = "정책마다 맞는 내 담당 고객사를 묶어 보고, 연락할 업체를 마감 순서로 봅니다.";
const ALL_LINE = "정책마다 맞는 고객사를 묶어 보고, 연락할 업체를 마감 순서로 봅니다. 모든 고객사가 보입니다.";

describe("PolicyCompaniesScreen 본문에는 화면 제목이 없다", () => {
  const html = renderToStaticMarkup(<PolicyCompaniesScreen endpoints={DEADLINE_ENDPOINTS} />);

  it("h1 이 하나도 없고 「정책별 고객사·연락 예정」 제목 글자도 없다", () => {
    expect(html).not.toContain("<h1");
    expect(html).not.toContain("정책별 고객사·연락 예정");
    expect(html.match(/<h2/g)).toHaveLength(2);
  });

  it("맨 위는 설명 한 줄이고, 그 아래에 카드 두 장과 탭 둘이 온다", () => {
    expect(html.startsWith(`<div class="min-w-0"><p class="mb-3.5 text-wedly-sub text-wedly-t2">${MINE_LINE}</p><section aria-label="요약 카드"`)).toBe(true);
    const tabs = [...html.matchAll(/<button[^>]*role="tab"[^>]*>([^<]*)<\/button>/g)].map((match) => match[1]);
    expect(tabs).toEqual(["정책별 고객사", "연락 예정 업체"]);
  });

  it("모든 고객사가 보이는 앱(seesAll)은 설명 한 줄이 다르다", () => {
    const all = renderToStaticMarkup(<PolicyCompaniesScreen endpoints={DEADLINE_ENDPOINTS} seesAll />);
    expect(all).toContain(ALL_LINE);
    expect(all).not.toContain(MINE_LINE);
  });

  it("scopeToggle 이 켜진 첫 그림에는 「담당: 내 담당·전체」 단추가 있고, 꺼진 앱에는 없다", () => {
    const toggled = renderToStaticMarkup(<PolicyCompaniesScreen endpoints={DEADLINE_ENDPOINTS} scopeToggle />);
    expect(toggled).toContain('aria-label="담당"');
    expect(html).not.toContain('aria-label="담당"');
  });
});
