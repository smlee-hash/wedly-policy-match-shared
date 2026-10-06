import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import PolicyMatchScreen, { listVerdictContext, type Diagnosis } from "./PolicyMatchScreen";
import ProfileForm from "./ProfileForm";
import ResultSummaryBar from "./ResultSummaryBar";
import ResultGroupList, {
  FIRST_SHOWN, MORE_STEP, ResultRow, UNCLASSIFIED_KEY,
  deadlineChipOf, moreLineOf, sectionsOf, showMoreCount, toggleFolded, verdictPillOf,
} from "./ResultGroupList";
import ResultDrawer, { DRAWER_PANEL_CLASS, drawerKeyHandler } from "./ResultDrawer";
import { ERP_POLICY_MATCH_ENDPOINTS } from "./endpoints";
import type { FundingGroup } from "../../funding/funding-group";
import type { FundingGroupBlock, FundingItem } from "../../funding/funding-map";
import type { FundingMapPayload } from "../FundingMap";

/**
 * 화면 재구성 B4 — 묶음별 접기·펴기 목록, 행 모양, 더 보기, 상세 서랍, 820px 이하 쌓기.
 * 이 저장소엔 jsdom 이 없어 눌러 보지 못한다 — 규칙은 순수 함수로, 모양은 그려서, 배선은 소스 글자로 잰다.
 */

const RAW색 =
  /(?:^|["\s])(?:bg|text|border|from|to)-(?:green|amber|red|sky|blue|indigo|violet|pink|gray|slate|zinc|orange|yellow|lime|emerald|teal|cyan|rose|fuchsia)-(?:50|100|200|300|400|500|600|700|800|900)\b/;
// 금지 글자를 파일에 그대로 적지 않고 이어 붙여 만든다(다른 시험의 RAW색 대조군과 같은 이유).
const 직접색 = new RegExp([`${"#"}[0-9a-f]{3,8}\\b`, `rgb${"\\("}`, `\\[${"#"}`].join("|"), "i");

/** 그려 낸 HTML 의 글자 사이 주석(<!-- -->)을 걷어 낸다 — 「후보 {n}건」처럼 나뉜 글자를 이어 읽으려고. */
const 글자 = (html: string) => html.replace(/<!-- -->/g, "");

/** 오늘로부터 n일 뒤의 한국 달력 날짜(YYYY-MM-DD). */
function ymd(n: number): string {
  return new Date(Date.now() + n * 86_400_000 + 9 * 3_600_000).toISOString().slice(0, 10);
}

function fItem(over: Partial<FundingItem> & { refId: string }): FundingItem {
  return {
    id: `a:${over.refId}`,
    kind: "announcement",
    group: "grant",
    title: `공고 ${over.refId}`,
    agency: "경기테크노파크",
    url: "https://example.kr/a",
    applyUrl: "",
    targetText: "",
    amountText: "최대 3,000만원",
    amountMaxWon: 30_000_000,
    rateText: "",
    rateMin: null,
    deadline: { kind: "date", date: ymd(20), text: "", dDay: 20 },
    where: "",
    fit: [],
    fitVerdict: "fit",
    humanCheck: 0,
    score: 0,
    why: "",
    source: "smes24",
    isNew: false,
    ...over,
  };
}

function block(group: FundingGroupBlock["group"], items: FundingItem[], over: Partial<FundingGroupBlock> = {}): FundingGroupBlock {
  const normal = items.filter((i) => !i.unclassified);
  return {
    group,
    total: normal.length,
    fit: normal.filter((i) => i.fitVerdict === "fit").length,
    unverified: normal.filter((i) => i.fitVerdict === "unverified").length,
    excluded: 0,
    soon: 0,
    items,
    truncated: false,
    ...over,
  };
}

const grantItems = (n: number) =>
  Array.from({ length: n }, (_, i) =>
    fItem({ refId: `g${i + 1}`, title: `지원 공고 ${i + 1}`, fitVerdict: i === 1 ? "unverified" : "fit" }),
  );

const 자료 = (): FundingMapPayload => ({
  groups: [
    block("grant", grantItems(7), { total: 3120 }),
    block("policy", [fItem({ refId: "p1", group: "policy", title: "신성장기반자금", kind: "product" })]),
    block("guarantee", []),
    block("bank", [fItem({ refId: "b1", group: "bank", title: "운전자금 대출" })]),
  ],
  glance: { open: 4, soon: 1, grantFit: 3, grantMaxWon: 30_000_000, minRate: null },
  profileGaps: [],
  unclassified: 0,
  generatedAt: "2026-10-05T00:00:00.000Z",
});

type ListProps = Parameters<typeof ResultGroupList>[0];
const 목록props = (over: Partial<ListProps> = {}): ListProps => ({
  data: 자료(),
  loading: false,
  error: "",
  onRetry: () => {},
  diagnosis: null,
  selectedKey: "",
  onOpen: () => {},
  showExcluded: new Set<FundingGroup>(),
  onToggleExcluded: () => {},
  onBrowseAll: () => {},
  ...over,
});
const 목록그림 = (over: Partial<ListProps> = {}) => renderToStaticMarkup(<ResultGroupList {...목록props(over)} />);

describe("행 한 줄의 낱말 — 판정 알약·마감", () => {
  it("판정 알약: 맞음 / 확인 필요 / 안 맞음, 색은 토큰만", () => {
    expect(verdictPillOf("fit").label).toBe("맞음");
    expect(verdictPillOf("unverified").label).toBe("확인 필요");
    expect(verdictPillOf("excluded").label).toBe("안 맞음");
    for (const v of ["fit", "unverified", "excluded"] as const) {
      expect(verdictPillOf(v).className).not.toMatch(RAW색);
      expect(verdictPillOf(v).className).toContain("wedly-");
    }
  });

  it("마감: 7일 안이면 강조, 그보다 멀거나 상시면 강조 안 함", () => {
    const soon = deadlineChipOf(fItem({ refId: "x", deadline: { kind: "date", date: ymd(3), text: "", dDay: 3 } }));
    expect(soon.hot).toBe(true);
    expect(soon.text).toBe("3일 남음");
    const today = deadlineChipOf(fItem({ refId: "x", deadline: { kind: "date", date: ymd(0), text: "", dDay: 0 } }));
    expect(today).toEqual({ text: "오늘 마감", hot: true });
    expect(deadlineChipOf(fItem({ refId: "x" })).hot).toBe(false); // 20일 뒤
    const always = deadlineChipOf(fItem({ refId: "x", deadline: { kind: "always", date: null, text: "상시", dDay: null } }));
    expect(always.hot).toBe(false);
  });
});

describe("묶음 바닥 줄·접기·더 보기 규칙", () => {
  it("「이 묶음 N건 중 M건 보임 — 더 보기」 글자", () => {
    expect(moreLineOf(3120, 5, true)).toBe("이 묶음 3,120건 중 5건 보임 — 더 보기");
  });
  it("더 보여 줄 줄이 없는데 건수가 모자라면 건수만, 다 보이면 줄 자체가 없다", () => {
    expect(moreLineOf(10, 3, false)).toBe("이 묶음 10건 중 3건 보임");
    expect(moreLineOf(3, 3, false)).toBeNull();
  });
  it("처음 5건, 더 보기를 누를 때마다 10건씩 늘어난다", () => {
    expect(FIRST_SHOWN).toBe(5);
    expect(MORE_STEP).toBe(10);
    expect(showMoreCount(undefined)).toBe(15);
    expect(showMoreCount(15)).toBe(25);
  });
  it("접기·펴기는 짝으로 뒤집히고 원래 집합은 안 바뀐다", () => {
    const a = new Set<string>();
    const b = toggleFolded(a, "grant");
    expect([...b]).toEqual(["grant"]);
    expect(a.size).toBe(0);
    expect(toggleFolded(b, "grant").size).toBe(0);
  });
});

describe("sectionsOf — 지도 자료 → 그릴 칸", () => {
  it("줄이 있는 갈래만, 서버가 센 건수 그대로", () => {
    const s = sectionsOf(자료());
    expect(s.map((x) => x.key)).toEqual(["grant", "policy", "bank"]);
    expect(s[0].total).toBe(3120);
    expect(s[0].items).toHaveLength(7);
    expect(s[0].name).toBe("안 갚아도 되는 돈");
  });
  it("종류 미확인 줄은 맨 끝 따로 칸으로 모은다", () => {
    const d = 자료();
    d.groups[0].items.push(fItem({ refId: "u1", unclassified: true, title: "설명회 안내" }));
    const s = sectionsOf(d);
    const 끝 = s[s.length - 1];
    expect(끝.key).toBe(UNCLASSIFIED_KEY);
    expect(끝.items.map((i) => i.refId)).toEqual(["u1"]);
    expect(s[0].items.some((i) => i.unclassified)).toBe(false);
  });
  it("자료가 없으면 빈 칸 목록", () => {
    expect(sectionsOf(null)).toEqual([]);
  });
});

describe("묶음별 목록(ResultGroupList) — 그려 보기", () => {
  it("묶음 머리: 이름·건수·한 줄 설명·접기·펴기, 펼친 채 시작(aria-expanded=true)", () => {
    const html = 목록그림();
    for (const 이름 of ["안 갚아도 되는 돈", "싸게 빌리는 돈", "은행에서 바로"]) expect(html).toContain(이름);
    expect(html).not.toContain("보증 받아 빌리는 돈"); // 줄이 없는 묶음은 안 그린다
    expect(html).toContain("3,120건 · 보조금 · 지원사업 · 바우처");
    expect(html).toContain("접기·펴기");
    expect(html.match(/aria-expanded="true"/g)).toHaveLength(3);
    expect(html).not.toContain('aria-expanded="false"');
  });

  it("묶음마다 처음 5건만, 바닥 줄에 「이 묶음 3,120건 중 5건 보임 — 더 보기」", () => {
    const html = 글자(목록그림());
    expect(html.match(/data-row="a:g\d+"/g)).toHaveLength(FIRST_SHOWN);
    expect(html).toContain("이 묶음 3,120건 중 5건 보임 — 더 보기");
    // 한 줄짜리 묶음은 바닥 줄이 없다
    expect(html).not.toContain("이 묶음 1건 중");
  });

  it("행 모양: 판정 알약 · 공고명 · 기관 · 최대 금액 · 조건 한 줄 · 마감 · 자세히", () => {
    const html = renderToStaticMarkup(
      <ResultRow
        item={fItem({ refId: "r1", title: "시제품 제작 지원", fitVerdict: "unverified", deadline: { kind: "date", date: ymd(2), text: "", dDay: 2 } })}
        selected={false}
        onOpen={() => {}}
      />,
    );
    expect(html).toContain("확인 필요");
    expect(html).toContain("시제품 제작 지원");
    expect(html).toContain("경기테크노파크");
    expect(html).toContain("최대 3,000만원");
    expect(html).toContain("자동으로 잰 조건 없음"); // 조건 한 줄(fit 이 비면 그 사실을 말한다)
    expect(html).toContain("2일 남음");
    expect(html).toContain("bg-wedly-bg-red"); // 7일 안 마감은 강조
    expect(html).toContain("자세히 →");
    expect(html).toContain("<button"); // 키보드로 열 수 있다
  });

  it("고른 줄만 강조(aria-current)", () => {
    expect(목록그림({ selectedKey: "a:g2" }).match(/aria-current="true"/g)).toHaveLength(1);
    expect(목록그림()).not.toContain("aria-current");
  });

  it("행을 누르면 부모의 열기 손잡이가 그 줄을 받는다(소스 배선)", () => {
    const src = readFileSync(new URL("ResultGroupList.tsx", import.meta.url), "utf8");
    expect(src).toContain("onClick={() => onOpen(item)}");
  });

  it("820px 이하 한 줄 쌓기: 기본은 3칸 쌓기·공고명 맨 윗줄, 821px 부터 5칸", () => {
    const html = 목록그림();
    expect(html).toContain("grid-cols-[auto_1fr_auto]");
    expect(html).toContain("min-[821px]:grid-cols-[auto_minmax(0,1fr)_150px_110px_72px]");
    expect(html).toContain("col-span-full order-first");
    expect(html).toContain("min-[821px]:order-none");
    // 좁은 화면에서는 「자세히」·조건 한 줄·「접기·펴기」 글자를 숨긴다
    expect(html).toMatch(/class="hidden[^"]*min-\[821px\]:inline"[^>]*>자세히 →/);
    expect(html).toMatch(/class="[^"]*hidden[^"]*min-\[821px\]:block"/);
  });

  it("안 맞아서 뺀 줄: 접힌 채면 「보기」 단추, 펼치면 안 맞음 알약과 「접기」", () => {
    const d = 자료();
    d.groups[0] = block("grant", grantItems(2), {
      excluded: 4,
      excludedItems: [fItem({ refId: "x1", title: "안 맞는 공고", fitVerdict: "excluded" })],
    });
    const 접힘 = 목록그림({ data: d });
    expect(접힘).toContain("안 맞아서 뺀 4건 보기");
    expect(접힘).not.toContain("안 맞는 공고");
    const 펼침 = 목록그림({ data: d, showExcluded: new Set<FundingGroup>(["grant"]) });
    expect(펼침).toContain("안 맞아서 뺀 4건 접기");
    expect(펼침).toContain("안 맞는 공고");
    expect(펼침).toContain("안 맞음");
  });

  it("진단 안내 띠(AI 가 읽은 수·소재지로 뺀 수)와 「전체 공고 탐색」 단추가 이 목록에 있다", () => {
    const diagnosis: Diagnosis = {
      possible: [], uncertain: [], impossible: [],
      structureProgress: { total: 0, done: 0, pending: 0, needsReview: 0, failed: 0 },
      candidateCount: 10, analyzedCount: 4, droppedByRegion: 3,
    };
    const html = 글자(목록그림({ diagnosis }));
    expect(html).toContain("후보 10건 중 4건은 AI 가 읽었습니다");
    expect(html).toContain("소재지가 맞지 않아 3건 제외");
    expect(html).toContain("전체 공고 탐색");
  });

  it("자료 없음·불러오는 중·실패·거른 뒤 빔 — 각각 알맞은 안내", () => {
    expect(목록그림({ data: null })).toContain("불러오는 중…");
    const 실패 = 목록그림({ data: null, error: "자금 조달 지도를 불러오지 못했습니다" });
    expect(실패).toContain("자금 조달 지도를 불러오지 못했습니다");
    expect(실패).toContain("다시 시도");
    const 빔 = 목록그림({ data: { ...자료(), groups: [] } });
    expect(빔).toContain("조건에 맞는 공고가 없습니다");
  });

  it("옛 자료가 남아 있어도 새로 받기가 실패했으면 목록 위에 오류 띠와 「다시 시도」가 보인다(BF2 ⑥)", () => {
    const html = 글자(목록그림({ error: "서버가 바빠요" }));
    expect(html).toContain('data-error-band="stale"');
    expect(html).toContain("서버가 바빠요");
    expect(html).toContain("다시 시도");
    expect(html).toContain('data-group="grant"'); // 옛 목록은 그대로 보인다
    expect(html.indexOf("data-error-band")).toBeLessThan(html.indexOf('data-group="grant"')); // 목록 위
    // 지도 기본 문구가 오면 목록 말로 바꿔 보인다
    expect(글자(목록그림({ error: "자금 조달 지도를 불러오지 못했습니다" }))).toContain("목록을 새로 받지 못했어요");
    // 오류가 없으면 띠도 없다
    expect(목록그림()).not.toContain("data-error-band");
    // 단추는 부모의 다시 시도에 이어진다
    const src = readFileSync(new URL("ResultGroupList.tsx", import.meta.url), "utf8");
    expect(src.match(/onClick=\{onRetry\}/g)).toHaveLength(2);
  });

  it("색은 토큰만 쓴다", () => {
    const html = 목록그림({ selectedKey: "a:g1" });
    expect(html).not.toMatch(RAW색);
    expect(html).not.toMatch(직접색);
  });
});

describe("상세 서랍(ResultDrawer) — 열고 닫기", () => {
  const 서랍 = (open: boolean) =>
    renderToStaticMarkup(
      <ResultDrawer open={open} title="시제품 제작 지원" onClose={() => {}}>
        <p>상세 내용</p>
      </ResultDrawer>,
    );

  it("닫혀 있으면 아무것도 안 그린다", () => {
    expect(서랍(false)).toBe("");
  });

  it("열리면 창(dialog)·공고 이름·닫기 단추·어두운 바탕·안의 내용이 있다", () => {
    const html = 서랍(true);
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-label="시제품 제작 지원"');
    expect(html).toContain("<h2");
    expect(html).toContain("시제품 제작 지원");
    expect(html).toMatch(/<button[^>]*>닫기<\/button>/);
    expect(html).toContain('data-drawer="backdrop"');
    expect(html).toContain("상세 내용");
  });

  it("820px 이하는 아래에서 올라오는 창, 821px 부터는 오른쪽 서랍", () => {
    const html = 서랍(true);
    // 기본(좁은 화면): 아래에 붙고 위쪽 모서리만 둥글다
    expect(html).toContain("items-end");
    expect(DRAWER_PANEL_CLASS).toContain("rounded-t-2xl");
    expect(DRAWER_PANEL_CLASS).toContain("max-h-[85vh]");
    expect(DRAWER_PANEL_CLASS).toContain("max-[820px]:slide-in-from-bottom");
    // 넓은 화면: 오른쪽에 붙은 440px 서랍
    expect(html).toContain("min-[821px]:items-stretch");
    expect(DRAWER_PANEL_CLASS).toContain("min-[821px]:w-[440px]");
    expect(DRAWER_PANEL_CLASS).toContain("min-[821px]:slide-in-from-right");
    expect(DRAWER_PANEL_CLASS).toContain("min-[821px]:h-full");
    expect(html).toContain("min-[821px]:w-[440px]");
  });

  it("Esc 를 누르면 닫는다 — 다른 키는 아무 일도 안 한다", () => {
    const onClose = vi.fn();
    const onKey = drawerKeyHandler(onClose);
    onKey({ key: "Enter" });
    onKey({ key: "Tab" });
    onKey({ key: "a" });
    expect(onClose).not.toHaveBeenCalled();
    onKey({ key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("배선: Esc 는 문서에 걸었다가 닫히면 걷고, 바깥(바탕)과 닫기 단추가 모두 onClose 를 부른다", () => {
    const src = readFileSync(new URL("ResultDrawer.tsx", import.meta.url), "utf8");
    expect(src).toContain('document.addEventListener("keydown", onKey)');
    expect(src).toContain('document.removeEventListener("keydown", onKey)');
    expect(src).toContain("if (!open) return;"); // 닫혀 있을 땐 키를 듣지 않는다
    expect(src.match(/onClick=\{onClose\}/g)).toHaveLength(2); // 바탕 + 닫기 단추
  });

  it("색은 토큰만 쓴다", () => {
    const html = 서랍(true);
    expect(html).not.toMatch(RAW색);
    expect(html).not.toMatch(직접색);
  });
});

describe("화면 배선 — 행 → 서랍", () => {
  const 화면글 = readFileSync(new URL("PolicyMatchScreen.tsx", import.meta.url), "utf8");

  it("처음에는 서랍이 닫혀 있다(그려진 화면에 서랍 틀이 없다)", () => {
    const html = renderToStaticMarkup(<PolicyMatchScreen endpoints={ERP_POLICY_MATCH_ENDPOINTS} />);
    expect(html).not.toContain('data-area="detail-drawer"');
  });

  it("서랍은 진단 판일 때만 열리고, 닫는 손잡이는 상태를 거짓으로 돌린다", () => {
    expect(화면글).toContain('open={drawerOpen && step === "result"}');
    expect(화면글).toContain("onClose={closeDrawer}");
    expect(화면글).toContain("const closeDrawer = useCallback(() => setDrawerOpen(false), []);");
  });

  it("공고 행은 상세 서랍을 열고, 상시 상품 행은 기존 항목 서랍을 연다", () => {
    expect(화면글).toMatch(/item\.kind === "announcement"\) \{\s*setSelectedId\(item\.refId\);\s*setDrawerOpen\(true\);/);
    expect(화면글).toContain('dispatchMapUi({ type: "open", item })');
    expect(화면글).toContain("onOpen={openRow}");
  });

  it("회사 정보로 돌아가거나 새로 진단하면 서랍은 닫힌다", () => {
    expect(화면글).toMatch(/const goCompany = useCallback\(\(\) => \{\s*setStep\("company"\);\s*setDrawerOpen\(false\);/);
    expect(화면글).toContain("onEdit={goCompany}");
    expect(화면글).toMatch(/setSelectedId\(first\?\.announcementId \?\? ""\);\s*setDrawerOpen\(false\);/);
  });

  it("지도 서랍의 「상세·AI 판정 열기」는 목록 판으로 건너가 상세 서랍을 연다", () => {
    expect(화면글).toMatch(
      /openDetailFromMap = useCallback\(\(announcementId: string\) => \{\s*dispatchMapUi\(\{ type: "detail" \}\);\s*setSelectedId\(announcementId\);\s*setDrawerOpen\(true\);/,
    );
  });
});

/**
 * ★옮긴 자리 목록 — 화면을 새로 짜면서 기존 기능이 하나라도 빠지지 않도록, 기능마다
 *  「이 이름의 단추/영역이 화면에 있다」를 고정한다. 한 줄이라도 지우려면 이 표를 먼저 고쳐야 한다.
 *  (진단 이후의 자리는 정적 그림으로 못 닿아서 그 부품을 직접 그리거나 소스 글자로 잰다.)
 */
describe("옮긴 자리 목록 — 기존 기능이 새 자리에 그대로 있다", () => {
  const 화면글 = readFileSync(new URL("PolicyMatchScreen.tsx", import.meta.url), "utf8");
  const 서랍범위 = 화면글.slice(화면글.indexOf("<ResultDrawer"), 화면글.indexOf("</ResultDrawer>"));
  const 처음화면 = renderToStaticMarkup(<PolicyMatchScreen endpoints={ERP_POLICY_MATCH_ENDPOINTS} />);

  it("서랍 안에 DetailPanel 이 있고 통로·오류 문구·피드백 조각·회차를 그대로 받는다", () => {
    expect(서랍범위).toContain("<DetailPanel");
    for (const 줄 of [
      "endpoints={endpoints}",
      "parseError={features?.parseError}",
      "verdictFeedback={verdictFeedback}",
      "announcementId={selectedId}",
      "profile={profile}",
      "profileNonce={profileNonce}",
      "item={selectedItem}",
      "serverStructurizes={features?.serverStructurizes ?? true}",
    ]) {
      expect(서랍범위, `서랍 안 DetailPanel 에 ${줄} 이 없다`).toContain(줄);
    }
  });

  it("정밀 판정(verdict)·돌파구·자료실 질문 단추는 DetailPanel 이 통로 조건과 함께 그린다", () => {
    const src = readFileSync(new URL("DetailPanel.tsx", import.meta.url), "utf8");
    expect(src).toContain("AI 정밀 판정");
    expect(src).toContain("{item && !noServerAi && endpoints.verdict && (");
    expect(src).toContain("{item && !noServerAi && endpoints.breakthrough && verdict &&");
    expect(src).toContain("saveEndpoint={endpoints.askInstructor}");
  });

  it("피드백: 서랍의 상세 · 지도 카드 · 결과 목록 행 세 자리 모두에 같은 조각이 배선돼 있다", () => {
    // 옛 「전체 공고 탐색」 목록(ResultList)의 자리는 없어졌다 — 그 자리가 쓰던 조각은 결과 목록 행이 이어받는다.
    expect(서랍범위).toContain("verdictFeedback={verdictFeedback}");
    expect(화면글).toContain("renderCardFooter={mapCardFooter}");
    expect(화면글).toContain("renderRowFooter={rowFooter}");
  });

  it("진단→목록 전환 시 행 피드백 호출: 조각을 받은 앱은 공고 줄마다 place:card 로 부르고, 못 받은 앱은 줄만 그린다(BF2 ⑤)", () => {
    // 그리기: 공고 줄(g1~g5·b1)마다 조각이 줄 아래에 붙고, 상품 줄(p1)에는 안 붙는다
    const 호출: string[] = [];
    const html = 글자(
      목록그림({
        renderRowFooter: (줄) => {
          호출.push(줄.refId);
          return <span data-fb={줄.refId}>맞음·틀림</span>;
        },
      }),
    );
    expect(호출).toEqual(["g1", "g2", "g3", "g4", "g5", "b1"]);
    expect(html).toContain('data-fb="g1"');
    expect(html).not.toContain('data-fb="p1"');
    expect(html.indexOf('data-row="a:g1"')).toBeLessThan(html.indexOf('data-fb="g1"'));
    expect(html).toContain('data-row-wrap="a:g1"');
    // 조각을 안 받은 앱은 마디를 하나도 더하지 않는다
    expect(목록그림()).not.toContain("data-row-wrap");

    // 넘기는 자료: 예전 목록 카드와 같은 자리 이름
    const 자료줄 = 자료().groups[0].items[0];
    expect(listVerdictContext(자료줄, { byId: new Map(), profile: { employeeCount: 3 } })).toEqual({
      announcementId: "g1",
      title: "지원 공고 1",
      item: null,
      aiVerdict: null,
      profile: { employeeCount: 3 },
      place: "card",
    });

    // 배선: 목록 판이 조각을 이어 받고, 조각 만드는 자리가 listVerdictContext 를 쓴다
    const 목록범위 = 화면글.slice(화면글.indexOf("<ResultGroupList"), 화면글.indexOf("/>", 화면글.indexOf("<ResultGroupList")));
    expect(목록범위).toContain("renderRowFooter={rowFooter}");
    expect(화면글).toContain("verdictFeedback(listVerdictContext(item, { byId: diagnoseById, profile }))");
  });

  it("자금 조달 지도: 「한눈에」 보기 단추와 FundingMap·지도 서랍이 있다", () => {
    const 줄 = renderToStaticMarkup(
      <ResultSummaryBar
        data={자료()} tab="all" onTab={() => {}} unknownCount={0} onFill={() => {}} view="list" onView={() => {}}
        query="" onQuery={() => {}} nowOnly={false} onNowOnly={() => {}} sort="rec" onSort={() => {}}
      />,
    );
    expect(줄).toContain("한눈에");
    expect(줄).toContain("목록");
    expect(화면글).toContain("<FundingMap");
    expect(화면글).toContain('showsMap("diagnosed", mapUi.view)');
    expect(화면글).toContain("<FundingDrawer");
    expect(화면글).toContain("aiVerdictAvailable={!!endpoints.verdict}");
  });

  it("출처 목록(SourceDirectoryPanel): 통로를 넘긴 앱에만 「수집원 현황」 판이 있고 앱의 조각이 그대로 전해진다", () => {
    expect(처음화면).toContain("수집원 현황");
    expect(화면글).toContain("{endpoints.sources && (");
    for (const 줄 of [
      "endpoint={endpoints.sources}",
      "onExport={features?.exportSources}",
      "actions={slots?.sourcesActions}",
      "header={slots?.sourcesHeader}",
      'trailingPaddingClass={features?.sourcesTrailingPaddingClass ?? ""}',
    ]) {
      expect(화면글, `출처 목록에 ${줄} 이 안 전해진다`).toContain(줄);
    }
  });

  it("지금 새로 받아오기(sync): 전체 공고 목록이 없어져 화면에서 단추도 배선도 없어졌다", () => {
    // 두 단계 개편(2026-10-05 사장님 승인) — 회사 없이 전체 공고를 둘러보는 판이 없어졌다. endpoints.sync 타입은 남는다.
    expect(처음화면).not.toContain("지금 새로 받아오기");
    expect(화면글).not.toContain("onManualSync");
    expect(화면글).not.toContain("endpoints.sync");
  });

  it("공고 탐색(browse): 없어졌다 — 처음 화면에 검색 칸·수집 시각 줄·목록이 없고, 돌아가는 길도 없다", () => {
    expect(처음화면).not.toContain("공고명·기관·지원대상 검색");
    expect(처음화면).not.toContain("아직 수집 전");
    expect(처음화면).not.toContain("조건에 맞는 공고가 없습니다");
    expect(화면글).not.toContain("endpoints.announcements");
    expect(화면글).not.toContain("onBrowseAll=");
    // 돌아가는 길을 안 넘기면 목록은 그 단추를 안 그린다 / 넘기면(다른 앱이 쓰면) 그린다(대조군)
    expect(목록그림({ onBrowseAll: undefined })).not.toContain("전체 공고 탐색");
    expect(목록그림()).toContain("전체 공고 탐색");
  });

  it("회사 정보 쪽: 고객 불러오기·서류 올리기·매칭 결과 보기가 본문 가운데 넓은 폼에 있다", () => {
    expect(처음화면).toContain('data-area="company-panel"');
    expect(처음화면).toContain("기존 고객 검색");
    expect(처음화면).toContain("서류를 올리면 칸을 채워 드려요");
    expect(처음화면).toContain("매칭 결과 보기 →");
    expect(화면글).toContain("prefillEndpoint={endpoints.prefill}");
    expect(화면글).toContain("documentPrefillEndpoint={endpoints.documentPrefill}");
    expect(화면글).toContain("documentPrefillMode={features?.documentPrefillMode}");
  });

  it("slots·features 확장점이 모두 화면 글에서 쓰인다", () => {
    for (const 이름 of [
      "slots?.verdictFeedback", "slots?.sourcesActions", "slots?.sourcesHeader",
      "features?.serverStructurizes", "features?.parseError", "features?.exportSources",
      "features?.sourcesTrailingPaddingClass", "features?.documentPrefillMode",
    ]) {
      expect(화면글, `${이름} 이 화면에서 안 쓰인다`).toContain(이름);
    }
  });

  it("요약 탭·모름 띠·도구 줄은 결과 위에 그대로 있다", () => {
    expect(화면글).toContain("<ResultSummaryBar");
    // 폼은 ① 회사 정보에 있다 — 「채우기」는 그리로 돌아가(goCompany) 첫 모름 칸으로 초점을 준다.
    expect(화면글).toMatch(/onFill=\{\(\) => \{\s*goCompany\(\);[^}]*setFillNonce\(\(n\) => n \+ 1\);\s*\}\}/);
  });

  it("회사 정보 쪽에는 드롭다운(select)이 없다 — 정렬 select 는 결과 도구 줄에만", () => {
    const 폼 = renderToStaticMarkup(
      <ProfileForm
        onDiagnose={async () => true}
        diagnosing={false}
        prefillEndpoint="/api/policy-match/prefill"
        documentPrefillEndpoint="/api/policy-match/document-prefill"
      />,
    );
    expect(폼).not.toContain("<select");
    expect(readFileSync(new URL("ProfileForm.tsx", import.meta.url), "utf8")).not.toContain("<select");
    expect(readFileSync(new URL("ResultSummaryBar.tsx", import.meta.url), "utf8")).toContain("<select");
  });
});

describe("바뀐 파일에는 시안 파일(_ref)을 가져다 쓰지 않는다", () => {
  it("새 부품 셋의 import 줄에 _ref 가 없다", () => {
    for (const 이름 of ["ResultGroupList.tsx", "ResultDrawer.tsx", "PolicyMatchScreen.tsx"]) {
      const src = readFileSync(new URL(이름, import.meta.url), "utf8");
      const imports = src.split("\n").filter((l) => /^\s*(import|export)\b.*\bfrom\b/.test(l));
      expect(imports.some((l) => l.includes("_ref")), `${이름} 가 _ref 를 가져온다`).toBe(false);
    }
  });
});
