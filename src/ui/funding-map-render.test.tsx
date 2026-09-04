import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import * as FundingMapModule from "./FundingMap";
import FundingMap, {
  FundingMapView,
  classifiedGroupItems,
  conditionRowText,
  itemKeyDown,
  nextFilters,
  shouldOpenDetail,
  sortRows,
  unclassifiedGroupItems,
  GROUP_TONE_TILE,
  type FundingMapPayload,
} from "./FundingMap";
import FundingDrawer, { isTileOverflowing, shouldShowExpandButton, tileValueClass } from "./FundingDrawer";
import { FUNDING_GROUPS, FUNDING_GROUP_META, type FundingGroup } from "../funding/funding-group";
import {
  deadlineOfAnnouncement,
  deadlineOfProduct,
  deadlineWords,
  type FundingFilters,
  type FundingItem,
  type FundingSort,
} from "../funding/funding-map";

/**
 * 그려서 재는 시험 — 글자로 파일을 뒤지지 않고 `renderToStaticMarkup` 이 뱉은 HTML 만 본다
 * (전례: `src/components/ui/__tests__/badge-render.test.tsx` · 같은 폴더 `ResultList.test.tsx`).
 *
 * ※ 이 저장소엔 jsdom·@testing-library/react 가 없다(2026-09-03 실측). 그래서 두 갈래로 나눠 잰다:
 *   ① 상태를 밖에서 바꿔 다시 그린 HTML(칩·표 전환·펼침 집합) ② 손잡이 순수 함수를 직접 불러 본다.
 *
 * ★재설계(계약 §G2, 2026-09-04 시안 3) — 카드 앞면이 「제목 + 답 네 개(2열) + 판정 한 줄」로
 *  바뀌었다. 조건 원문·「조건 펼치기」로 연 내용은 카드 안 지역 상태(useState)라 이 렌더 방식으로는
 *  **못 잰다**(이펙트·클릭이 안 돈다 — 서랍 파일의 「①-d」 시험과 같은 한계, 주석 그대로 적용).
 *  그 대신 펼침에 들어갈 글자를 만드는 규칙(`conditionRowText`)과 「어느 항목이 어느 목록에
 *  가는지」(`classifiedGroupItems`·`unclassifiedGroupItems`)는 **순수 함수로 떼어** 직접 부른다 —
 *  화면 판정 규칙은 순수 함수로, 픽셀은 렌더로(작업 지시 원칙).
 *
 * ★안 맞음 가르개(옛 `normalGroupItems`·`excludedGroupItems`)는 사라졌다(코덱스 11차 #2, W2) —
 *  이제 서버가 `items`(정상)·`excludedItems`(안 맞음)로 나눠 실어 주고 화면은 그대로 그린다.
 */

const NOW = new Date("2026-09-03T10:00:00+09:00");
const kstEnd = (ymd: string) => new Date(`${ymd}T23:59:59+09:00`);
const ALWAYS = deadlineOfProduct("상시", NOW);

function mk(over: Partial<FundingItem> & { id: string; group: FundingGroup }): FundingItem {
  return {
    kind: "announcement",
    refId: over.id.slice(2),
    title: "예시 항목",
    agency: "중소벤처기업부",
    url: "https://example.kr/a/1",
    applyUrl: "",
    targetText: "",
    amountText: "최대 5,000만원",
    amountMaxWon: 50_000_000,
    rateText: "연 1.5%",
    rateMin: 1.5,
    deadline: ALWAYS,
    where: "관악구청",
    fit: [],
    fitVerdict: "unverified",
    humanCheck: 0,
    score: 10,
    why: "입력한 조건 2개 모두 맞음",
    source: "smes24",
    isNew: false,
    ...over,
  };
}

/** 갈래마다 한 건씩(6) + grant 에 두 건 더(안 맞음 1 · 마감 임박 1) = 8건. */
const 항목8: FundingItem[] = [
  mk({
    id: "a:1",
    group: "grant",
    title: "스마트상점 기술보급사업 3차",
    amountText: "도입비 최대 70% (상한 500만원)",
    amountMaxWon: 5_000_000,
    rateText: "무상",
    rateMin: null,
    deadline: deadlineOfAnnouncement(kstEnd("2026-09-15"), "2026-08-01 ~ 2026-09-15", NOW),
    fit: [
      { label: "지역 서울", verdict: "pass", note: "" },
      { label: "업종 제조업", verdict: "pass", note: "" },
    ],
    fitVerdict: "fit",
    score: 90,
  }),
  mk({
    id: "a:2",
    group: "grant",
    title: "전북 스마트공장 구축지원",
    deadline: deadlineOfAnnouncement(kstEnd("2026-09-06"), "", NOW),
    fit: [{ label: "지역 전북 소재", verdict: "fail", note: "프로필은 서울" }],
    fitVerdict: "excluded",
    why: "지역 전북 소재라 대상 아님",
    score: 5,
  }),
  mk({
    id: "a:3",
    group: "grant",
    title: "충북 상생보험 무료 지원",
    deadline: deadlineOfAnnouncement(null, "예산 소진 시", NOW),
    fit: [{ label: "지역 충북", verdict: "fail", note: "" }],
    fitVerdict: "excluded",
    why: "지역 충북이라 대상 아님",
    score: 4,
  }),
  mk({ id: "a:4", group: "policy", title: "관악구 하반기 중소기업육성자금", fitVerdict: "fit", score: 80 }),
  mk({
    id: "p:5",
    kind: "product",
    group: "guarantee",
    title: "서울시 안심통장 4호 (마이너스통장형)",
    where: "서울신용보증재단",
    source: "manual",
    fit: [{ label: "신용점수 NICE 600↑", verdict: "unknown", note: "신용점수 미입력" }],
    fitVerdict: "unverified",
  }),
  mk({
    id: "p:6",
    kind: "product",
    group: "bank",
    title: "카카오뱅크 개인사업자 신용대출",
    where: "카카오뱅크 앱",
    source: "product-finlife-soho",
  }),
  mk({
    id: "p:7",
    kind: "product",
    group: "urgent",
    title: "미소금융 창업자금",
    where: "서민금융통합지원센터",
    source: "product-kinfa",
  }),
  mk({ id: "p:8", kind: "product", group: "invest", title: "TIPS (민간투자주도형 기술창업)", where: "창업진흥원", source: "product-tips" }),
];

/**
 * 통로가 주는 모양을 그대로 흉내 낸다 — 갈래 칸(`total`)은 **서버가 센 전체 건수**이고
 * `items` 는 그중 실어 보낸 몫이다. 시험이 items.length 로 total 을 대신하면
 * 「잘렸을 때 딱지가 줄어드는」 버그(코덱스 1차 #19)를 못 잡는다.
 */
function 자료(items: FundingItem[] = 항목8, over: Partial<FundingMapPayload> = {}): FundingMapPayload {
  const groups = FUNDING_GROUPS.map((group) => {
    const mine = items.filter((it) => it.group === group);
    const 정상 = mine.filter((it) => it.fitVerdict !== "excluded");
    const 안맞음 = mine.filter((it) => it.fitVerdict === "excluded");
    return {
      group,
      // ★안 맞음은 `items`·`total` 에 **절대** 안 섞인다(코덱스 11차 #2 · W1 계약) — 갈래마다
      //  `excludedItems` 로 따로 실려 온다(`includeExcluded:true` 일 때만). 시험 자료도 그 모양이어야
      //  「화면이 스스로 다시 가른다」는 옛 구현을 되살려도 통과하는 껍데기 시험이 되지 않는다.
      total: 정상.length,
      fit: 정상.filter((it) => it.fitVerdict === "fit").length,
      unverified: 정상.filter((it) => it.fitVerdict === "unverified").length,
      excluded: 안맞음.length,
      soon: 0,
      items: 정상,
      truncated: false,
      ...(안맞음.length > 0 ? { excludedItems: 안맞음 } : {}),
    };
  });
  return {
    groups,
    glance: { open: 8, soon: 1, grantFit: 1, grantMaxWon: 5_000_000, minRate: 1.5 },
    // bandEntry(funding-map.ts)가 정확히 미리보기 시안 문장으로 바꾸는 원문 5종.
    usedProfile: ["지역 서울", "업종 음식점/카페", "매출 1.3억", "설립일 2023-01-15", "법인 여부 개인"],
    profileGaps: ["신용점수", "기존 대출 유무"],
    unclassified: 0,
    generatedAt: "2026-09-03T01:00:00.000Z",
    ...over,
  };
}

const 기본거르개: FundingFilters = { openOnly: false, soonOnly: false, includeExcluded: false };

function 그린다(
  over: {
    data?: FundingMapPayload;
    view?: "map" | "table";
    filters?: FundingFilters;
    sort?: FundingSort;
    expanded?: Set<FundingGroup>;
    showExcluded?: Set<FundingGroup>;
    compact?: boolean;
    selectedId?: string;
    now?: Date;
    onBrowseAll?: () => void;
  } = {},
): string {
  return renderToStaticMarkup(
    <FundingMapView
      data={over.data ?? 자료()}
      view={over.view ?? "map"}
      filters={over.filters ?? 기본거르개}
      sort={over.sort ?? "rec"}
      expanded={over.expanded ?? new Set<FundingGroup>()}
      showExcluded={over.showExcluded ?? new Set<FundingGroup>()}
      selectedId={over.selectedId ?? ""}
      compact={over.compact ?? false}
      now={over.now ?? NOW}
      onOpen={() => {}}
      onView={() => {}}
      onFiltersChange={() => {}}
      onSortChange={() => {}}
      onToggleExpand={() => {}}
      onToggleExcluded={() => {}}
      onBrowseAll={over.onBrowseAll}
    />,
  );
}

/** 상태를 쥔 껍데기까지 통째로 — 로딩·오류·compact 갈래를 잰다. */
function 지도(
  over: {
    data?: FundingMapPayload | null;
    loading?: boolean;
    error?: string;
    filters?: FundingFilters;
    sort?: FundingSort;
    compact?: boolean;
    selectedId?: string;
    showExcluded?: Set<FundingGroup>;
    now?: Date;
    onOpenDetail?: (announcementId: string) => void;
    onBrowseAll?: () => void;
    onRetry?: () => void;
  } = {},
): string {
  return renderToStaticMarkup(
    <FundingMap
      data={over.data === undefined ? 자료() : over.data}
      loading={over.loading ?? false}
      error={over.error ?? ""}
      filters={over.filters ?? 기본거르개}
      sort={over.sort ?? "rec"}
      selectedId={over.selectedId ?? ""}
      compact={over.compact}
      now={over.now ?? NOW}
      onFiltersChange={() => {}}
      onSortChange={() => {}}
      onOpen={() => {}}
      onOpenDetail={over.onOpenDetail}
      onBrowseAll={over.onBrowseAll}
      onRetry={over.onRetry}
      showExcluded={over.showExcluded ?? new Set<FundingGroup>()}
      onToggleExcluded={() => {}}
    />,
  );
}

const 서랍 = (item: FundingItem | null, onOpenDetail?: (id: string) => void): string =>
  renderToStaticMarkup(<FundingDrawer item={item} onClose={() => {}} onOpenDetail={onOpenDetail} />);

/** 갈래 카드 하나의 HTML 만 잘라 낸다 — `data-group` 표식으로 자른다. */
function 카드(html: string, group: FundingGroup): string {
  const start = html.indexOf(`data-group="${group}"`);
  expect(start, `${group} 카드가 없다`).toBeGreaterThan(-1);
  const rest = html.slice(start);
  const next = rest.slice(1).indexOf("data-group=");
  return next === -1 ? rest : rest.slice(0, next + 1);
}

/**
 * 갈래 카드의 **머리 띠만** 잘라 낸다 — 건수 딱지를 잴 때 아래 안내문("전체 250건 중 …")의
 * 숫자와 섞이면 딱지가 틀려도 시험이 통과한다(2026-09-03 탬퍼 시험에서 실제로 통과했다).
 */
function 카드머리(html: string, group: FundingGroup): string {
  const 조각 = 카드(html, group);
  const 끝 = [조각.indexOf("<ul"), 조각.indexOf("<p ")].filter((i) => i > -1).sort((a, b) => a - b)[0];
  return 끝 === undefined ? 조각 : 조각.slice(0, 끝);
}

/** 우리 쪽 가로 스크롤 상자를 찾는 열쇠 — 이름표는 화면 코드(TableScroller)와 한 글자도 달라선 안 된다. */
const SCROLLER_LABEL = 'aria-label="자금 조달 표(옆으로 밀어 더 보기)"';

/** CLAUDE.md rule#1 의 금지 목록 — 이 시험은 그려 낸 HTML 에서 잰다(파일 글자가 아니라). */
const RAW색 =
  /(?:^|["\s])(?:bg|text|border|from|to)-(?:green|amber|red|sky|blue|indigo|violet|pink|gray|slate|zinc|orange|yellow|lime|emerald|teal|cyan|rose|fuchsia)-(?:50|100|200|300|400|500|600|700|800|900)\b/;

/** 계약 낱말 규칙(전 일꾼 공통) — 기호·줄임말·내부 용어. */
// ★「원문 확인」은 목록에서 뺐다 — G1 이 만든 verdictWords([]) 의 "자동으로 잰 조건 없음 — 공고 원문 확인"
//  문장 안에 정당하게 들어 있다(이 파일은 G1 도우미를 그대로 쓰고 문구를 다시 짓지 않는다).
//  이 화면이 스스로 짓는 「값 없을 때 대체 문구」로서의 원문 확인(예: amountText || "원문 확인")만 막으면 된다 —
//  amountWords·whereWords 등 대체 도우미는 전부 다른 말(「공고에 금액 없음」·「기관 미기재」)을 쓰므로 그 갈래는
//  아래 "금지문구" 목록 밖에서 각 시험(⑩-e 등)이 실제 값으로 확인한다.
const 금지문구 = ["D-1", "D-2", "D-12", "외 2곳", "외 1곳", "미분류", "대조 기준", "맞는 것만"];
const 금지기호 = /[✓✕]/; // "?"는 물음표를 쓰는 정상 문장(예: 없음)이 있을 수 있어 별도로 다루지 않는다.

describe("자금 조달 지도 — 그려서 재기", () => {
  it("① 6갈래 카드 머리 — 이름·부제·who 한 줄이 FUNDING_GROUP_META 와 같고, 타일·워시·왼쪽 띠가 6색 서로 다르다", () => {
    const html = 그린다();
    const 본톤 = new Set<string>();
    for (const g of FUNDING_GROUPS) {
      const meta = FUNDING_GROUP_META[g];
      const 조각 = 카드(html, g);
      expect(조각, `${g} 이름`).toContain(meta.name);
      expect(조각, `${g} 부제`).toContain(meta.sub);
      expect(조각, `${g} who 한 줄`).toContain(meta.who);
      const tone = GROUP_TONE_TILE[meta.tone];
      expect(조각, `${g} 아이콘 타일`).toContain(tone.tile);
      expect(조각, `${g} 머리 워시`).toContain(tone.wash);
      expect(조각, `${g} 왼쪽 색 띠`).toContain(tone.borderL);
      본톤.add(tone.tile);
    }
    expect(본톤.size, "6갈래 타일 색이 서로 달라야 한다").toBe(6);
  });

  it("②-a 칩은 두 개뿐(맞는 것만 삭제) · 알약 라벨은 카드로 보기/표로 보기 · 오른쪽에 안내 문구", () => {
    const html = 그린다();
    expect(html, "「맞는 것만」 칩이 남아 있다").not.toContain("맞는 것만");
    expect(html).toContain('data-chip="openOnly"');
    expect(html).toContain('data-chip="soonOnly"');
    expect(html, "옛 fitOnly 칩 흔적").not.toContain('data-chip="includeExcluded"');
    expect(html).toContain("지금 신청 가능한 것만");
    expect(html).toContain("7일 안에 마감되는 것만");
    expect(html).toContain("카드로 보기");
    expect(html).toContain("표로 보기");
    expect(html, "구 라벨 잔존").not.toContain(">지도<");
    expect(html).toContain("이 사업장에 안 맞는 공고는 기본으로 뺐습니다");
  });

  it("②-b 칩이 켜져 있어도 화면은 (안 맞음 재분류 말고는) 자료를 다시 거르지 않는다 — 거르기는 서버 몫", () => {
    // a:4(관악구 하반기 중소기업육성자금, fit)는 excluded 가 아니라 그대로 남는다 — 칩은 모양만 바꾼다.
    const 켠거르개 = 그린다({ filters: { ...기본거르개, openOnly: true } });
    expect(켠거르개, "서버가 준 줄을 화면이 지우면 안 된다").toContain("관악구 하반기 중소기업육성자금");
    expect(켠거르개).toContain('data-chip="openOnly" aria-pressed="true"');
  });

  it("②-c 칩 손잡이가 누른 것만 뒤집는다(nextFilters, 제네릭)", () => {
    expect(nextFilters(기본거르개, "openOnly")).toEqual({ openOnly: true, soonOnly: false, includeExcluded: false });
    expect(nextFilters({ ...기본거르개, openOnly: true }, "openOnly").openOnly).toBe(false);
    // includeExcluded 도 같은 함수로 뒤집힌다(칩은 안 쓰지만 함수 자체는 제네릭).
    expect(nextFilters(기본거르개, "includeExcluded").includeExcluded).toBe(true);
    expect(그린다()).toContain('data-chip="soonOnly" aria-pressed="false"');
  });

  it("②-d 정렬 값이 달라도 서버가 준 차례 그대로 그린다", () => {
    const 조각 = 카드(그린다({ sort: "rate" }), "grant");
    const 자리 = ["스마트상점 기술보급사업 3차"].map((t) => 조각.indexOf(t));
    expect(자리[0], "grant 카드에 fit 항목이 있어야 한다").toBeGreaterThan(-1);
  });

  it("③ 표로 바꾸면 <table> 에 새 머리글 7개 · 정렬 머리글 4개가 버튼이다", () => {
    const html = 그린다({ view: "table", sort: "rate" });
    expect(html).toContain("<table");
    const thead = html.slice(html.indexOf("<thead"), html.indexOf("</thead>"));
    const 머리수 = (thead.match(/<th\b/g) ?? []).length;
    expect(머리수, "종류·이름·얼마까지·갚기/이자·언제까지·어디에 신청·판정").toBe(7);
    for (const h of ["종류", "이름", "얼마까지", "갚기/이자", "언제까지", "어디에 신청", "판정"]) {
      expect(thead, `머리글 ${h}`).toContain(h);
    }
    const 단추수 = (thead.match(/<button\b/g) ?? []).length;
    expect(단추수, "얼마까지·갚기/이자·언제까지·판정 4개").toBe(4);
    expect(thead, "지금 정렬 칸이 눌린 모양").toContain('aria-pressed="true"');
    expect(thead, "공용 Table 의 내부 정렬 표식이 붙으면 안 된다").not.toContain("aria-sort");
    expect(html).not.toContain('data-group="grant"');
  });

  it("③-b 표 머리글 7칸이 전부 한 줄(whitespace-nowrap) · 열 폭은 전부 최소 폭이고 합계가 51rem 이다", () => {
    const html = 그린다({ view: "table", sort: "rate" });
    const thead = html.slice(html.indexOf("<thead"), html.indexOf("</thead>"));
    const 머리칸들 = thead.split(/<th\b/).slice(1);
    expect(머리칸들.length, "머리글 7칸").toBe(7);
    for (const [i, 칸] of 머리칸들.entries()) {
      expect(칸.slice(0, 칸.indexOf("</th>")), `${i + 1}번째 머리글이 두 줄로 쪼개질 수 있다`).toContain("whitespace-nowrap");
    }
    const 폭 = 머리칸들.map((칸, i) => {
      const 앞 = 칸.slice(0, 칸.indexOf("</th>"));
      const m = /min-w-\[([\d.]+)rem\]/.exec(앞);
      expect(m, `${i + 1}번째 열에 최소 폭(min-w-[Nrem])이 없다`).not.toBeNull();
      return Number(m![1]);
    });
    expect(폭, "종류 6 · 이름 12 · 얼마까지 7 · 갚기/이자 5 · 언제까지 6 · 어디에 신청 7 · 판정 8").toEqual([6, 12, 7, 5, 6, 7, 8]);
    expect(폭.reduce((a, b) => a + b, 0), "합계 51rem(816px)").toBe(51);
    expect(html, "고정 폭 클래스가 남아 있다(w-24)").not.toMatch(/(?:^|["\s])w-24\b/);
    expect(html, "고정 폭 클래스가 남아 있다(w-36)").not.toMatch(/(?:^|["\s])w-36\b/);
  });

  it("③-b2 표는 **우리 쪽** 가로 스크롤 상자 안에 있고 공용 Table 바깥 상자를 w-fit 으로 덮어쓴다", () => {
    const html = 그린다({ view: "table", sort: "rate" });
    const i우리 = html.lastIndexOf(SCROLLER_LABEL, html.indexOf("<table"));
    expect(i우리, "우리 쪽 가로 스크롤 상자가 없다").toBeGreaterThan(-1);
    const 세겹 = html.slice(i우리, html.indexOf("<table"));
    expect(세겹, "공용 Table 바깥 상자를 w-fit 으로 안 덮어썼다").toContain('class="overflow-x-auto w-fit"');
    expect(세겹, "공용 Table 바깥 상자에 w-full 이 남아 있다").not.toMatch(/(?:^|["\s])w-full\b/);
    expect(세겹, "안쪽 상자는 공용 부품 것 그대로").toContain('class="overflow-hidden rounded-lg border');
    const i안쪽 = 세겹.indexOf("overflow-hidden");
    expect(세겹.indexOf("w-fit"), "w-fit 이 안쪽 상자보다 뒤에 있다").toBeLessThan(i안쪽);
  });

  it("③-c 표의 「얼마까지」 값 칸이 두 줄에서 끊긴다(line-clamp-2) — 이름 칸은 안 끊는다", () => {
    const html = 그린다({ view: "table", sort: "amt" });
    const tbody = html.slice(html.indexOf("<tbody"), html.indexOf("</tbody>"));
    const 첫줄 = tbody.split(/<tr\b/)[1] ?? "";
    const 칸들 = 첫줄.split(/<td\b/).slice(1);
    expect(칸들.length, "종류·이름·얼마까지·갚기/이자·언제까지·어디에 신청·판정").toBe(7);
    expect(칸들[2], "「얼마까지」 칸이 두 줄에서 안 끊긴다").toContain("line-clamp-2");
    expect(칸들[2], "어절 단위 줄바꿈").toContain("break-keep");
    expect(칸들[3], "「갚기/이자」 칸").toContain("line-clamp-2");
    expect(칸들[5], "「어디에 신청」 칸").toContain("truncate");
    expect(칸들[5], "「어디에 신청」 열이 긴 기관명 하나에 벌어진다").toContain("max-w-[11rem]");
    expect(칸들[5], "잘린 기관명 전체를 title 로 못 읽는다").toContain("title=");
    expect(칸들[1], "「이름」 칸까지 끊으면 안 된다").not.toContain("line-clamp-2");
  });

  it("③-c2 「언제까지」 딱지가 14자에서 끊기고 전체는 title · 「언제까지·어디에 신청」 열에 최대 폭이 있다", () => {
    const 긴마감 = "○ (상반기) 1월 1일 ~ 2월 10일, (하반기) 6월 1일 ~ 7월 10일 원칙";
    const 자 = 자료([{ ...항목8[0], deadline: deadlineOfProduct(긴마감, NOW) }, ...항목8.slice(1)]);
    expect(deadlineOfProduct(긴마감, NOW).kind, "이 원문은 kind:text 여야 이 시험이 뜻이 있다").toBe("text");

    const 표 = 그린다({ data: 자, view: "table" });
    const 잘린것 = deadlineWords(deadlineOfProduct(긴마감, NOW), NOW).chip;
    expect(잘린것.length, "14자+말줄임").toBeLessThanOrEqual(15);
    expect(표, "딱지 글자가 잘려야 한다").toContain(잘린것);
    expect(표, "긴 기간 원문이 딱지에 통째로 실렸다").not.toContain(`>${긴마감}<`);
    expect(표, "끊긴 글자 전체를 title 로 못 읽는다").toContain(`title="${긴마감}"`);

    const tbody = 표.slice(표.indexOf("<tbody"), 표.indexOf("</tbody>"));
    const 칸들 = (tbody.split(/<tr\b/)[1] ?? "").split(/<td\b/).slice(1);
    expect(칸들[4], "「언제까지」 열이 긴 문장 하나에 벌어진다").toContain("max-w-[9rem]");

    // 카드 앞면 딱지도 같은 상한 — 지도와 표에서 같은 항목이 다르게 읽히면 안 된다
    const 카드조각 = 카드(그린다({ data: 자 }), "grant");
    expect(카드조각).toContain(잘린것);
    expect(카드조각).toContain(`title="${긴마감}"`);
  });

  it("③-b3 가로 스크롤 상자가 글쇠로 밀리는 이름 붙은 구역이다(tabindex·role·aria-label·초점 링)", () => {
    const html = 그린다({ view: "table", sort: "rate" });
    const i = html.lastIndexOf(SCROLLER_LABEL, html.indexOf("<table"));
    expect(i, "스크롤 상자에 이름표가 없다").toBeGreaterThan(-1);
    const 여는태그 = html.slice(html.lastIndexOf("<div", i), html.indexOf(">", i) + 1);
    expect(여는태그, "글쇠로 초점을 못 받는다").toContain('tabindex="0"');
    expect(여는태그, "이름 붙은 구역이 아니다").toContain('role="region"');
    expect(여는태그, "초점 링이 없다").toContain("focus-visible:ring-2");
    expect(여는태그, "초점 링 색이 토큰이 아니다").toContain("focus-visible:ring-wedly-accent");
  });

  it("③-e 표의 「판정」 칸은 딱지 하나 + 「M/N 맞음」 — 조건 0개면 분수를 안 그린다", () => {
    const html = 그린다({ view: "table", sort: "rec" });
    const tbody = html.slice(html.indexOf("<tbody"), html.indexOf("</tbody>"));
    const 첫줄 = tbody.split(/<tr\b/)[1] ?? "";
    const 칸들 = 첫줄.split(/<td\b/).slice(1);
    const 판정 = 칸들[6];
    // a:1 = pass 2건 · fitVerdict "fit"
    expect(판정, "판정 딱지 글자").toContain("맞음");
    expect(판정, "2/2 맞음").toContain("2/2 맞음");
    expect(판정, "자릿수가 흔들리지 않게 숫자꼴").toContain("tabular-nums");
    expect(html, "조건 이름(칩)이 표에 나열되면 안 된다 — 서랍·카드 펼침이 맡는다").not.toContain("지역 서울");

    // p:6(카카오뱅크) = fit 0개, fitVerdict "unverified" → 분수 없이 딱지만
    const 조각 = 표에서_이름으로_행찾기(tbody, "카카오뱅크 개인사업자 신용대출");
    expect(조각, "확인 필요 딱지").toContain("확인 필요");
    expect(조각, "조건 0개면 분수를 안 그린다").not.toContain("0/0");
  });

  /** 종류(0)·이름(1)·얼마까지(2)·갚기/이자(3)·언제까지(4)·어디에 신청(5)·판정(6) — 기본은 판정 칸. */
  function 표에서_이름으로_행찾기(tbody: string, title: string, 칸: number = 6): string {
    const rows = tbody.split(/<tr\b/).slice(1);
    const row = rows.find((r) => r.includes(title));
    expect(row, `${title} 줄을 못 찾았다`).toBeTruthy();
    return (row ?? "").split(/<td\b/).slice(1)[칸] ?? "";
  }

  it("③-f 표의 「종류」 칸은 흰 칩+색 점(6색) — 종류 미확인 항목은 색 점 없는 칩", () => {
    const 표식 = 자료([{ ...항목8[0], unclassified: true, relatedProductId: "prod-1" }, ...항목8.slice(1)], {
      unclassified: 1,
    });
    const html = 그린다({ data: 표식, view: "table" });
    const tbody = html.slice(html.indexOf("<tbody"), html.indexOf("</tbody>"));
    const 칸들 = (tbody.split(/<tr\b/)[1] ?? "").split(/<td\b/).slice(1);
    expect(칸들[0], "종류 미확인 칩").toContain("종류 미확인");
    expect(칸들[0], "옛 「미분류」 글자는 안 남는다").not.toContain("미분류");
    expect(칸들[0], "점 없는 칩(색 톤 없음)").not.toContain(GROUP_TONE_TILE.green.dot);
    // 「상시 상품 있음」은 그대로(밴 목록에 없다) — 이름 칸에 남는다
    expect(칸들[1], "이름 칸").toContain("상시 상품 있음");

    // 일반 항목(policy 갈래 줄 — 이름으로 찾는다. 표는 갈래 차례라 grant 3건 뒤에 온다) · 0번 칸이 「종류」
    const policy종류칸 = 표에서_이름으로_행찾기(tbody, "관악구 하반기 중소기업육성자금", 0);
    expect(policy종류칸, "policy 칩엔 파랑 점").toContain(GROUP_TONE_TILE.blue.dot);
  });

  /**
   * ★코덱스 11차 #5(2026-09-04) — 표가 `showExcluded` 를 아예 안 보고 갈래 카드에서 접어 둔
   *  안 맞음까지 **전역으로** 늘어놓았다. 「기본으로 뺐습니다」라고 적어 둔 화면에서 표만
   *  안 맞는 공고를 섞어 보여 주면 두 보기가 서로 다른 자료를 말한다.
   */
  it("③-g 표 행 = 모든 갈래 items + 펼친 갈래의 excludedItems(회색·「안 맞음」 딱지) · 안 펼친 갈래의 안 맞음은 표에도 없다(11차 #5)", () => {
    const 닫힘 = 그린다({ view: "table" });
    const tb닫힘 = 닫힘.slice(닫힘.indexOf("<tbody"), 닫힘.indexOf("</tbody>"));
    expect((tb닫힘.match(/<tr\b/g) ?? []).length, "정상 6건만").toBe(6);
    expect(tb닫힘, "안 펼친 갈래의 안 맞음이 표에 전역 노출됐다").not.toContain("전북 스마트공장 구축지원");

    const 펼침 = 그린다({ view: "table", showExcluded: new Set<FundingGroup>(["grant"]) });
    const tb = 펼침.slice(펼침.indexOf("<tbody"), 펼침.indexOf("</tbody>"));
    expect((tb.match(/<tr\b/g) ?? []).length, "정상 6 + 펼친 갈래의 안 맞음 2").toBe(8);
    const 안맞음줄 = tb.split(/<tr\b/).find((r) => r.includes("전북 스마트공장 구축지원")) ?? "";
    expect(안맞음줄, "회색(옅음) 처리").toContain("opacity-70");
    expect(안맞음줄, "판정 딱지는 「안 맞음」").toContain("안 맞음");
    const 정상줄 = tb.split(/<tr\b/).find((r) => r.includes("스마트상점 기술보급사업 3차")) ?? "";
    expect(정상줄, "정상 줄은 옅지 않다").not.toContain("opacity-70");
  });

  /**
   * ★코덱스 12차 #4(2026-09-04) — 표는 갈래마다 「정상 목록 + 안 맞음 목록」을 그 차례대로 이어
   *  붙였다. 두 목록은 서버가 **각자** 정렬해 보내므로, 이어 붙이면 고른 정렬 기준이 표 전체에서
   *  깨진다(한도 큰 순인데 안 맞음 50억이 정상 1억보다 뒤에 온다). 합친 뒤 **한 번 더** 세운다.
   *  판정 규칙은 순수 함수 `sortRows` 로 떼어 직접 잰다(이 파일은 jsdom 이 없다).
   *
   * ★그 차례는 **서버 정렬기 `sortItems` 와 한 글자도 갈리면 안 된다**(2026-09-04) — 손으로 베껴 둔
   *  예전 판은 두 자리에서 갈렸다: ⓐ 마감 지난 줄(dDay 음수)을 「마감 빠른 순」 맨 위에 세웠고
   *  ⓑ 「추천순」이 점수만 봐서 안 맞음이 점수만 높으면 맞음보다 앞섰다. 아래 ①·② 가 그 두 자리다.
   */
  it("③-h sortRows — 서버 정렬기와 같은 차례(마감 지난 줄 맨 뒤 · 추천순은 판정이 점수보다 먼저)(12차 #4)", () => {
    const 큰 = mk({ id: "a:h1", group: "grant", title: "큰 한도", amountMaxWon: 10_000_000_000, score: 10, rateMin: 5, deadline: deadlineOfAnnouncement(kstEnd("2026-09-30"), "", NOW) });
    const 작은 = mk({ id: "a:h2", group: "grant", title: "작은 한도", amountMaxWon: 100_000_000, score: 30, rateMin: 1, deadline: deadlineOfAnnouncement(kstEnd("2026-09-10"), "", NOW) });
    const 안맞음 = mk({ id: "a:h3", group: "grant", title: "안 맞는 중간 한도", amountMaxWon: 5_000_000_000, score: 20, rateMin: 3, fitVerdict: "excluded", deadline: deadlineOfAnnouncement(kstEnd("2026-09-20"), "", NOW) });
    // 서버가 준 차례 = 정상 [100억, 1억] 뒤에 안 맞음 [50억]
    const 합친행 = [큰, 작은, 안맞음];

    expect(sortRows(합친행, "amt").map((r) => r.id), "한도 큰 순 — 안 맞음도 제자리에").toEqual(["a:h1", "a:h3", "a:h2"]);
    expect(sortRows(합친행, "rate").map((r) => r.id), "이자 낮은 순").toEqual(["a:h2", "a:h3", "a:h1"]);
    expect(sortRows(합친행, "dead").map((r) => r.id), "마감 가까운 순").toEqual(["a:h2", "a:h3", "a:h1"]);

    // ① 마감이 지난 줄(dDay 음수)은 「마감 빠른 순」 맨 **뒤**(서버 deadRank 와 같다) — 음수를
    //    「가장 가까운 마감」으로 읽어 맨 위에 세우면 이미 못 넣는 것이 첫 줄을 차지한다.
    const 지난 = mk({ id: "a:h5", group: "grant", title: "마감 지난 것", deadline: deadlineOfAnnouncement(kstEnd("2026-08-31"), "", NOW) });
    expect(지난.deadline.dDay, "이 줄은 실제로 마감이 지났다").toBeLessThan(0);
    expect(sortRows([...합친행, 지난], "dead").map((r) => r.id), "마감 지난 줄은 맨 뒤").toEqual(["a:h2", "a:h3", "a:h1", "a:h5"]);

    // ② 「추천순」은 맞음 → 확인 필요 → 안 맞음이 **점수보다 먼저**(서버 FIT_RANK) — 5점짜리
    //    맞음이 30점짜리 확인 필요보다 앞이고, 20점짜리 안 맞음은 맨 뒤다.
    const 맞음 = mk({ id: "a:h6", group: "grant", title: "맞음 낮은 점수", score: 5, fitVerdict: "fit", deadline: deadlineOfAnnouncement(kstEnd("2026-10-05"), "", NOW) });
    expect(sortRows([...합친행, 맞음], "rec").map((r) => r.id), "추천순 — 판정이 점수보다 먼저").toEqual(["a:h6", "a:h2", "a:h1", "a:h3"]);

    // 없는 값(null)은 어느 기준에서도 맨 뒤 — 「모르는 줄」을 앞자리에 세우지 않는다
    const 빈값 = mk({ id: "a:h4", group: "grant", title: "값 없음", amountMaxWon: null, rateMin: null, score: 0, deadline: deadlineOfProduct("상시", NOW) });
    for (const key of ["amt", "rate", "dead"] as FundingSort[]) {
      expect(sortRows([빈값, 큰], key).map((r) => r.id), key).toEqual(["a:h1", "a:h4"]);
    }
    // 다만 상시(기한 없음)는 마감 지난 줄보다 앞이다 — 아직 넣을 수 있는 것이 못 넣는 것보다 먼저.
    expect(sortRows([지난, 빈값], "dead").map((r) => r.id), "상시가 마감 지남보다 앞").toEqual(["a:h4", "a:h5"]);

    // 안정 정렬 — 값이 같으면 서버가 준 차례를 그대로 지킨다
    const 동점 = [작은, { ...안맞음, amountMaxWon: 100_000_000 }, { ...큰, amountMaxWon: 100_000_000 }];
    expect(sortRows(동점, "amt").map((r) => r.id)).toEqual(["a:h2", "a:h3", "a:h1"]);
    // 원본 배열을 건드리지 않는다(화면이 받은 자료를 제자리에서 흔들면 다시 그릴 때 차례가 달라진다)
    expect(합친행.map((r) => r.id)).toEqual(["a:h1", "a:h2", "a:h3"]);
  });

  it("③-h2 표가 실제로 다시 세워 그린다 — 한도 큰 순에서 안 맞음 50억이 정상 1억보다 위(12차 #4)", () => {
    const 큰 = mk({ id: "a:h1", group: "grant", title: "큰 한도 공고", amountMaxWon: 10_000_000_000, score: 10 });
    const 작은 = mk({ id: "a:h2", group: "grant", title: "작은 한도 공고", amountMaxWon: 100_000_000, score: 30 });
    const 안맞음 = mk({ id: "a:h3", group: "grant", title: "안 맞는 중간 한도 공고", amountMaxWon: 5_000_000_000, score: 20, fitVerdict: "excluded" });
    const 자 = 자료([큰, 작은, 안맞음]);
    const html = 그린다({ data: 자, view: "table", sort: "amt", showExcluded: new Set<FundingGroup>(["grant"]) });
    const tbody = html.slice(html.indexOf("<tbody"), html.indexOf("</tbody>"));
    const 이름들 = tbody
      .split(/<tr\b/)
      .slice(1)
      .map((r) => ["큰 한도 공고", "작은 한도 공고", "안 맞는 중간 한도 공고"].find((t) => r.includes(t)) ?? "?");
    expect(이름들).toEqual(["큰 한도 공고", "안 맞는 중간 한도 공고", "작은 한도 공고"]);
  });

  /**
   * ★코덱스 13차 #6(2026-09-04) — 표 아래 안내문이 「갈래 차례로 묶여 있고, 고른 차례는 갈래 안에서
   *  적용됩니다」였는데, 12차 #4 로 표는 **합친 뒤 전체를 다시 세워** 그린다(위 ③-h·③-h2). 화면이
   *  스스로를 잘못 설명하면 사람은 정렬이 고장 난 줄 안다.
   */
  it("③-i 표 안내문은 지금 동작대로 말한다 — 「고른 차례로 전체를 정렬」(13차 #6)", () => {
    const html = 그린다({ view: "table" });
    expect(html).toContain("표는 고른 차례로 전체를 정렬합니다");
    expect(html, "옛 문구(갈래 안에서 적용)는 지금 동작과 다르다").not.toContain("갈래 안에서 적용됩니다");
  });

  /**
   * ★코덱스 12차 #7(2026-09-04) — 갈래를 못 가른 줄이 **동시에 안 맞음**이면 임시로 얹힌 갈래
   *  (grant)의 안 맞음 목록에 그냥 섞여 보였다. 「종류 미확인」 블록은 정상 줄만 모으므로
   *  (`unclassifiedGroupItems`) 그 줄엔 어디에도 미확인 표시가 없어, 사람은 그 사업이 정말
   *  「안 갚아도 되는 돈」인 줄 안다. 안 맞음 카드·표 행에 딱지를 붙인다.
   */
  it("⑩-c2 미확인+안 맞음 줄에는 「종류 미확인」 딱지가 붙는다 — 카드·표 둘 다(12차 #7)", () => {
    const 겹침 = 자료([{ ...항목8[1], unclassified: true }]);
    const 조각 = 카드(그린다({ data: 겹침, showExcluded: new Set<FundingGroup>(["grant"]) }), "grant");
    expect(조각, "안 맞음 카드에 미확인 딱지가 없다").toContain("종류 미확인");
    // 딱지 **그 자체**만 잘라 재기 — 카드 전체를 보면 다른 흰 상자에 속아 통과한다
    const i딱지 = 조각.indexOf("종류 미확인");
    const 딱지 = 조각.slice(조각.lastIndexOf("<span", i딱지), i딱지);
    expect(딱지, "흰 칩이 아니다").toContain("bg-white");
    expect(딱지, "뜻 없는 색 점이 붙었다").not.toContain('aria-hidden="true"');

    // 표의 안 맞음 행도 같은 말을 한다(「종류」 칸이 이미 그 일을 한다 — 두 보기가 갈리지 않게 함께 잰다)
    const 표 = 그린다({ data: 겹침, view: "table", showExcluded: new Set<FundingGroup>(["grant"]) });
    const tbody = 표.slice(표.indexOf("<tbody"), 표.indexOf("</tbody>"));
    const 줄 = tbody.split(/<tr\b/).find((r) => r.includes("전북 스마트공장 구축지원")) ?? "";
    expect(줄, "표의 안 맞음 행에 미확인 표시가 없다").toContain("종류 미확인");

    // 미확인이 아닌 안 맞음 줄에는 딱지를 붙이지 않는다(뜻 없는 딱지 금지)
    const 보통 = 카드(그린다({ showExcluded: new Set<FundingGroup>(["grant"]) }), "grant");
    expect(보통, "미확인이 아닌 줄에 딱지가 붙었다").not.toContain("종류 미확인");
  });

  it("④ 항목은 눌리는 자리(role=button·tabindex)이고 Enter·Space 로 onOpen 이 불린다", () => {
    const html = 그린다();
    expect(html).toContain('role="button"');
    expect(html).toContain('tabindex="0"');

    const onOpen = vi.fn();
    const 항목 = 항목8[0];
    const ev = (key: string) => ({ key, preventDefault: vi.fn() });

    const enter = ev("Enter");
    itemKeyDown(enter as never, 항목, onOpen);
    expect(onOpen).toHaveBeenCalledWith(항목);
    expect(enter.preventDefault).toHaveBeenCalled();

    const space = ev(" ");
    itemKeyDown(space as never, 항목, onOpen);
    expect(onOpen).toHaveBeenCalledTimes(2);

    const tab = ev("Tab");
    itemKeyDown(tab as never, 항목, onOpen);
    expect(onOpen, "Tab 은 열지 않는다").toHaveBeenCalledTimes(2);
    expect(tab.preventDefault).not.toHaveBeenCalled();
  });

  it("④-b 좁은 자리(compact)의 공고는 서랍 대신 상세 화면으로 보낸다", () => {
    expect(shouldOpenDetail(항목8[0], true), "compact 공고").toBe(true);
    expect(shouldOpenDetail(항목8[4], true), "compact 라도 상품은 서랍").toBe(false);
    expect(shouldOpenDetail(항목8[0], false), "넓은 화면은 서랍이 먼저").toBe(false);
  });

  it("⑤ 카드마다 굵기 600 이상인 줄이 2개 이상(제목 + 답 값) · 아이콘이 있다", () => {
    const html = 그린다();
    for (const g of FUNDING_GROUPS) {
      const 조각 = 카드(html, g);
      const 굵은줄 = (조각.match(/font-(?:semibold|bold)/g) ?? []).length;
      expect(굵은줄, `${g} 카드가 평평하다`).toBeGreaterThanOrEqual(2);
      expect(조각, `${g} 카드에 아이콘이 없다`).toContain("<svg");
    }
  });

  it("⑥ 마감 딱지 글자는 funding-map 의 deadlineWords 와 같다 · D-N 표기가 어디에도 없다", () => {
    const html = 그린다();
    expect(html).toContain(deadlineWords(항목8[0].deadline, NOW).chip); // 내일(9월 4일) 마감 또는 N일 남음
    expect(html).toContain("상시 접수");
    expect(html, "D-N 표기가 남아 있다").not.toMatch(/\bD-\d/);

    // a:3(예산 소진 시, excluded)는 기본으로는 숨어 있다 — 안 맞아서 뺀 목록을 펼쳐야 보인다.
    const 펼침 = 그린다({ showExcluded: new Set<FundingGroup>(["grant"]) });
    expect(펼침).toContain(deadlineWords(항목8[2].deadline, NOW).chip); // 예산 소진 시 마감
  });

  it("⑦ 그려 낸 HTML 에 raw Tailwind 색이 0개다", () => {
    const 켠거르개: FundingFilters = { openOnly: true, soonOnly: true, includeExcluded: true };
    const 표식달린자료 = 자료(
      [{ ...항목8[0], unclassified: true, relatedProductId: "prod-1" }, ...항목8.slice(1)],
      { unclassified: 1 },
    );
    for (const html of [
      그린다(),
      그린다({ view: "table" }),
      그린다({ compact: true }),
      그린다({ data: 표식달린자료 }),
      그린다({ data: 표식달린자료, view: "table" }),
      그린다({ filters: { openOnly: false, soonOnly: false, includeExcluded: false }, sort: "rate" }),
      그린다({
        filters: 켠거르개,
        sort: "amt",
        expanded: new Set<FundingGroup>(FUNDING_GROUPS),
        showExcluded: new Set<FundingGroup>(["grant"]),
        selectedId: "a:1",
        onBrowseAll: () => {},
      }),
      그린다({ data: 자료([]), view: "table", filters: 켠거르개, sort: "dead", compact: true }),
      그린다({ data: 자료(항목8, { usedProfile: [], profileGaps: [] }) }),
      지도(),
      지도({ loading: true, data: null }),
      지도({ loading: true }),
      지도({ data: null, error: "불러오지 못했습니다", onRetry: () => {} }),
      서랍(항목8[4]),
      서랍(항목8[1]),
      서랍(항목8[1], () => {}),
    ]) {
      expect(html.match(RAW색)?.[0] ?? "").toBe("");
    }
  });

  it("⑦-b 낱말 규칙(기호·D-N·외 N곳·미분류·대조 기준·맞는 것만·원문 확인)이 전부 없다", () => {
    const 묶음 = 자료([
      { ...항목8[0], unclassified: true, groupCount: 3, groupSources: 3 },
      ...항목8.slice(1),
    ], { unclassified: 1 });
    for (const html of [그린다(), 그린다({ view: "table" }), 그린다({ data: 묶음 }), 그린다({ data: 묶음, view: "table" })]) {
      for (const 말 of 금지문구) expect(html, `금지 문구 "${말}" 이 남아 있다`).not.toContain(말);
      expect(html.match(금지기호)?.[0] ?? "", "✓·✕ 기호가 남아 있다").toBe("");
    }
  });

  it("⑧ 첫 로딩은 뼈대 6장 · 오류는 상태 박스 · 조건에 맞는 게 없으면 빈 상태", () => {
    const 로딩 = 지도({ data: null, loading: true });
    expect((로딩.match(/animate-pulse/g) ?? []).length).toBe(6);

    const 오류 = 지도({ data: null, error: "자금 조달 지도를 불러오지 못했습니다", onRetry: () => {} });
    expect(오류).toContain('role="alert"');
    expect(오류).toContain("자금 조달 지도를 불러오지 못했습니다");
    expect(오류).toContain(">다시 시도</button>");
    expect(지도({ data: null, error: "자금 조달 지도를 불러오지 못했습니다" }), "손잡이가 없으면 단추도 없다").not.toContain(
      ">다시 시도</button>",
    );

    const 빈 = 그린다({ data: 자료([]) });
    expect(빈).toContain("조건에 맞는 항목이 없습니다");
  });

  it("⑧-b 다시 부르는 중이라도 자료가 있으면 이전 화면을 흐리게 유지한다(뼈대는 첫 로딩만)", () => {
    const 다시부름 = 지도({ loading: true });
    expect(다시부름, "이미 본 자료가 뼈대로 바뀌면 안 된다").not.toContain("animate-pulse");
    expect(다시부름).toContain('aria-busy="true"');
    expect(다시부름).toContain("opacity-60");
    expect(다시부름).toContain("스마트상점 기술보급사업 3차");
    expect(지도(), "다 불러왔으면 흐리지 않다").not.toContain('aria-busy="true"');
  });

  it("⑨ 발 hint 에 실린 건수 / 조건에 맞는 건수 · 기준 시각", () => {
    // 8건 중 2건(a:2·a:3)은 안 맞음이라 서버가 `items` 에서 뺐다 — 발 hint 는 정상 6건을 센다.
    const 칩없음 = 그린다();
    expect(칩없음).toContain("표시 6건");
    expect(칩없음).toContain("전체 6건");
    expect(칩없음).toContain("2026-09-03 10:00");

    const 칩켬 = 그린다({
      data: 자료(항목8.filter((it) => it.fitVerdict !== "excluded")),
      filters: { ...기본거르개, openOnly: true },
    });
    expect(칩켬).toContain("표시 6건");
    expect(칩켬).toContain("조건에 맞는 6건");

    const 합계 = 그린다({ data: 자료(항목8, { totals: { all: 1204, filtered: 8 } }) });
    expect(합계).toContain("조건에 맞는 8건");
    expect(합계).toContain("전체 1,204건");
  });

  it("⑩ 갈래 아래 줄 — groupFooterWords 의 shown/excluded 글자, 「나머지 보기」는 4건 이상일 때만 · compact 는 3건 고정", () => {
    // policy 갈래는 1건뿐 · 안 맞음도 없다 — 「나머지 보기」 없이 「전부」로 보인다.
    expect(카드(그린다(), "policy")).not.toContain("나머지 보기");
    expect(카드(그린다(), "policy")).toContain("이 갈래 1건 전부");

    // 안 맞음이 안 섞인 깨끗한 4건짜리 갈래로 폴드(3건) 규칙만 잰다(grant 는 excluded 2건이 섞여 있어 부적합).
    const 네건 = [0, 1, 2, 3].map((n) =>
      mk({ id: `a:9${n}`, group: "grant", title: `무상 항목 ${n + 1}`, fitVerdict: "fit" }),
    );
    const 넷 = 자료(네건);
    const 보통 = 카드(그린다({ data: 넷 }), "grant");
    expect(보통).toContain("이 갈래 4건 중 3건만 보여 드림");
    expect(보통).toContain("나머지 보기");
    expect(보통, "접기 전에는 상위 3건만").not.toContain("무상 항목 4");

    const 펼침 = 카드(그린다({ data: 넷, expanded: new Set<FundingGroup>(["grant"]) }), "grant");
    expect(펼침).toContain("무상 항목 4");
    expect(펼침).toContain("이 갈래 4건 전부");
    expect(펼침).toContain("접기");

    const 좁게 = 카드(그린다({ data: 넷, compact: true }), "grant");
    expect(좁게, "compact 는 3건 고정이라 더 보기 단추가 없다").not.toContain("나머지 보기");

    expect(그린다()).toContain("lg:grid-cols-3");
    expect(그린다({ compact: true }), "compact 는 2열까지만").not.toContain("lg:grid-cols-3");
  });

  it("⑩-b 「안 맞아서 뺀 K건 보기」— 안 눌린 갈래는 안 보이고, showExcluded 에 있는 갈래만 회색으로 펼쳐지며 이유가 있다", () => {
    const 안눌림 = 카드(그린다(), "grant"); // grant 는 excluded 2건(a:2·a:3)
    expect(안눌림).toContain("안 맞아서 뺀 2건 보기");
    expect(안눌림, "안 눌렀으면 안 맞음 항목이 안 보인다").not.toContain("전북 스마트공장 구축지원");

    const 눌림 = 카드(그린다({ showExcluded: new Set<FundingGroup>(["grant"]) }), "grant");
    expect(눌림).toContain("뺀 것 접기");
    expect(눌림, "펼치면 안 맞음 항목이 보인다").toContain("전북 스마트공장 구축지원");
    expect(눌림).toContain("충북 상생보험 무료 지원");
    expect(눌림, "회색(옅음) 처리").toContain("opacity-70");
    expect(눌림, "안 맞는 이유 한 줄").toContain("안 맞는 이유:");
    expect(눌림).toContain("지역 전북 소재 — 프로필은 서울");

    // 다른 갈래(policy)는 showExcluded 에 없으니 펼쳐지지 않는다(집합에 없는 갈래는 숨긴다)
    const policy조각 = 카드(그린다({ showExcluded: new Set<FundingGroup>(["grant"]) }), "policy");
    expect(policy조각, "excluded 건수가 0이면 단추 자체가 없다").not.toContain("뺀 것 접기");
  });

  /**
   * ★코덱스 13차 #2(2026-09-04) — 안 맞음 카드는 참고용이라 **안 눌리게** 두었는데, 그 카드가
   *  서랍으로 가는 유일한 길이었다. 안 맞음 공고에 접힌 상시 상품(relatedProductId)·묶인 수집본·
   *  상품 신청처는 서랍에만 있어서, 「왜 안 맞는지 더 보고 싶다」는 사람이 갈 곳이 없었다.
   *  회색·딱지·이유 줄은 그대로 두고 **누를 수 있는 자리**로만 바꾼다.
   */
  it("⑩-b4 안 맞음 카드도 눌러 서랍을 연다 — role=button·tabindex·초점 링(13차 #2)", () => {
    // grant 는 안 맞음 2건뿐(정상 0건) — 정상 카드의 role=button 에 속아 통과하지 않게 한다.
    const 안맞음만 = 자료([항목8[1], 항목8[2], ...항목8.slice(3)]);
    const 조각 = 카드(그린다({ data: 안맞음만, showExcluded: new Set<FundingGroup>(["grant"]) }), "grant");
    const i = 조각.indexOf("전북 스마트공장 구축지원");
    expect(i, "안 맞음 카드가 없다").toBeGreaterThan(-1);
    const 카드조각 = 조각.slice(조각.lastIndexOf("<li", i), 조각.indexOf("</li>", i));
    expect(카드조각, "눌리는 자리가 아니다").toContain('role="button"');
    expect(카드조각, "글쇠로 초점을 못 받는다").toContain('tabindex="0"');
    expect(카드조각, "초점 링이 없다").toContain("focus-visible:ring-wedly-accent");
    expect(카드조각, "무엇이 열리는지 이름이 없다").toContain("전북 스마트공장 구축지원 자세히 보기");
    // 회색·딱지·이유 줄은 그대로(안 맞음이라는 사실이 흐려지면 안 된다)
    expect(카드조각, "회색(옅음)이 사라졌다").toContain("opacity-70");
    expect(카드조각, "「안 맞음」 딱지가 사라졌다").toContain("안 맞음");
    expect(카드조각, "「안 맞는 이유」 줄이 사라졌다").toContain("안 맞는 이유:");
  });

  /**
   * ★코덱스 11차 #1(2026-09-04) — 정상이 0건이면 갈래 칸이 통째로 숨어 「안 맞아서 뺀 K건 보기」
   *  단추까지 사라졌다. 그러면 사람은 그 갈래에 아무것도 없다고 읽는데, 실제로는 안 맞아서 뺀
   *  것이 있고 그것을 열 길이 화면에서 사라진 셈이다.
   */
  it("⑩-b2 정상 0건이어도 excluded>0 이면 갈래 카드(머리 + 아래 줄)가 남는다(11차 #1)", () => {
    // grant 는 안 맞음 2건뿐(정상 0건) · 나머지 갈래는 1건씩 그대로.
    const 안맞음만 = 자료([항목8[1], 항목8[2], ...항목8.slice(3)]);
    const 조각 = 카드(그린다({ data: 안맞음만 }), "grant");
    expect(조각, "머리(갈래 이름)가 남는다").toContain(FUNDING_GROUP_META.grant.name);
    expect(조각, "아래 줄 단추가 남는다").toContain("안 맞아서 뺀 2건 보기");
    // 아래 줄 왼쪽 글자는 도우미(groupFooterWords) 출력 그대로다 — 이 파일이 문구를 다시 짓지 않는다.
    expect(조각, "0건 문구는 「전부」가 아니라 없음 안내(메인 판정)").toContain("이 갈래에 지금 맞는 항목 없음");
    expect(조각, "카드 안쪽엔 정상이 0건이라는 안내가 그대로").toContain("지금 조건에 맞는 항목이 없습니다");
    const 펼침 = 카드(그린다({ data: 안맞음만, showExcluded: new Set<FundingGroup>(["grant"]) }), "grant");
    expect(펼침, "펼치면 안 맞음 항목을 볼 수 있다").toContain("전북 스마트공장 구축지원");

    // ★모든 갈래의 정상이 0건이어도 빈 상태가 카드(와 「뺀 항목 보기」)를 삼키면 안 된다.
    const 전부안맞음 = 자료([항목8[1], 항목8[2]]);
    const html = 그린다({ data: 전부안맞음 });
    expect(html, "빈 상태가 갈래 카드를 삼켰다").not.toContain("위 칩을 풀면 더 많은 항목이 보입니다");
    expect(html).toContain("안 맞아서 뺀 2건 보기");
    // 안 맞음까지 0건이면 그때는 빈 상태가 맞다
    expect(그린다({ data: 자료([]) }), "볼 것이 정말 없으면 빈 상태").toContain("위 칩을 풀면 더 많은 항목이 보입니다");
  });

  /**
   * ★코덱스 11차 #15(2026-09-04) — 안 맞음을 펼쳐 5줄이 그려졌는데 아래 줄은 「12건 중 3건만」
   *  이라고 적어 사람이 화면에서 세는 수와 안 맞았다. 두 수를 한 수로 **합치지 않고** 따로 말한다.
   */
  it("⑩-b3 아래 줄 개수는 그려진 줄과 맞는다 — 펼치면 「정상 N건 + 안 맞아서 뺀 K건 표시 중」(11차 #15)", () => {
    const 네건 = [0, 1, 2, 3].map((n) =>
      mk({ id: `a:9${n}`, group: "grant", title: `무상 항목 ${n + 1}`, fitVerdict: "fit" }),
    );
    const 자 = 자료([...네건, 항목8[1], 항목8[2]]); // grant 정상 4 + 안 맞음 2
    const 접힘 = 카드(그린다({ data: 자 }), "grant");
    expect(접힘, "안 맞음을 안 펼쳤으면 정상 개수만 말한다").toContain("이 갈래 4건 중 3건만 보여 드림");
    expect(접힘, "안 그려진 안 맞음을 개수에 넣으면 안 된다").not.toContain("안 맞아서 뺀 2건 표시 중");

    const 펼침 = 카드(그린다({ data: 자, showExcluded: new Set<FundingGroup>(["grant"]) }), "grant");
    expect(펼침, "정상은 접힌 3건 · 안 맞음은 펼친 2건").toContain("정상 3건 + 안 맞아서 뺀 2건 표시 중");

    const 둘다 = 카드(
      그린다({
        data: 자,
        expanded: new Set<FundingGroup>(["grant"]),
        showExcluded: new Set<FundingGroup>(["grant"]),
      }),
      "grant",
    );
    expect(둘다).toContain("정상 4건 + 안 맞아서 뺀 2건 표시 중");

    // 다른 갈래만 펼쳤을 때 — 서버는 갈래마다 excludedItems 를 다 실어 주지만 이 갈래는 안 그렸다.
    const 남만펼침 = 카드(그린다({ data: 자, showExcluded: new Set<FundingGroup>(["policy"]) }), "grant");
    expect(남만펼침, "안 그린 갈래가 개수를 세면 안 된다").not.toContain("안 맞아서 뺀 2건 표시 중");
    expect(남만펼침).toContain("이 갈래 4건 중 3건만 보여 드림");
  });

  it("⑩-b4 잘려서 못 실은 안 맞음이 있으면 「K건 중 M건 표시」로 정직하게 적는다", () => {
    const 자 = 자료(항목8);
    const 잘림: FundingMapPayload = {
      ...자,
      groups: 자.groups.map((g) =>
        g.group === "grant" ? { ...g, excluded: 5, excludedItems: (g.excludedItems ?? []).slice(0, 2) } : g,
      ),
    };
    const 조각 = 카드(그린다({ data: 잘림, showExcluded: new Set<FundingGroup>(["grant"]) }), "grant");
    expect(조각, "안 맞음 5건 중 2건만 실려 왔다").toContain("안 맞아서 뺀 5건 중 2건 표시");
  });

  it("⑩-c 순수 함수 — classifiedGroupItems·unclassifiedGroupItems(남은 재분류 규칙) · 안 맞음 가르개는 없다", () => {
    const 섞임: FundingItem[] = [
      { ...항목8[0], unclassified: true }, // 종류 미확인
      항목8[3], // fit — 정상
    ];
    expect(classifiedGroupItems(섞임).map((i) => i.id)).toEqual([항목8[3].id]);

    const blocks = 자료(섞임).groups;
    expect(unclassifiedGroupItems(blocks).map((i) => i.id)).toEqual([항목8[0].id]);

    // ★안 맞음은 화면이 **다시 가르지 않는다** — 옛 가르개를 되살리면 서버가 안 실어 준 것을
    //  못 그리면서 개수만 어긋난다(코덱스 11차 #2). 그래서 함수 자체가 없어야 한다.
    expect("normalGroupItems" in FundingMapModule, "옛 가르개가 되살아났다").toBe(false);
    expect("excludedGroupItems" in FundingMapModule, "옛 가르개가 되살아났다").toBe(false);

    // 미분류이면서 안 맞음인 줄은 서버가 `excludedItems` 로 보내므로 「종류 미확인」 블록엔 안 온다 —
    // 펼친 갈래의 안 맞음 목록에서 회색으로 보인다(안 맞는 것을 눌리는 카드로 올리지 않는다).
    const 겹침 = 자료([{ ...항목8[1], unclassified: true }]);
    expect(unclassifiedGroupItems(겹침.groups), "안 맞음은 items 에 없다").toEqual([]);
    const 조각 = 카드(그린다({ data: 겹침, showExcluded: new Set<FundingGroup>(["grant"]) }), "grant");
    expect(조각).toContain("전북 스마트공장 구축지원");
    expect(그린다({ data: 겹침 }), "안 펼쳤으면 어디에도 안 보인다").not.toContain("전북 스마트공장 구축지원");
  });

  it("⑩-d 「종류 미확인」 블록 — 갈래 카드들 아래 맨 끝에 있고 건수 딱지가 있다 · compact 는 3건 고정", () => {
    const 섞인자료 = 자료([{ ...항목8[0], unclassified: true }, ...항목8.slice(1)], { unclassified: 1 });
    const html = 그린다({ data: 섞인자료 });
    expect(html).toContain("종류 미확인 — 제목만으로는 못 가름");
    const i블록 = html.indexOf("종류 미확인 — 제목만으로는 못 가름");
    const i마지막갈래 = html.lastIndexOf('data-group="invest"');
    expect(i블록, "종류 미확인 블록이 갈래 카드들보다 뒤에 있어야 한다").toBeGreaterThan(i마지막갈래);
    // grant 카드 안에는 이제 이 항목이 없다(재분류로 빠졌다)
    expect(카드(html, "grant"), "미분류 항목이 갈래 카드에 남아 있다").not.toContain("스마트상점 기술보급사업 3차");

    const 없음 = 그린다();
    expect(없음, "미분류가 0건이면 블록 자체가 없다").not.toContain("종류 미확인");

    const 여럿 = 자료(
      [
        { ...항목8[0], id: "a:90", unclassified: true, title: "미확인 항목 A" },
        { ...항목8[0], id: "a:91", unclassified: true, title: "미확인 항목 B" },
        { ...항목8[0], id: "a:92", unclassified: true, title: "미확인 항목 C" },
        { ...항목8[0], id: "a:93", unclassified: true, title: "미확인 항목 D" },
        ...항목8.slice(1),
      ],
      { unclassified: 4 },
    );
    const 좁게 = 그린다({ data: 여럿, compact: true });
    expect(좁게, "compact 는 종류 미확인도 3건 고정").not.toContain("미확인 항목 D");
    expect(좁게).toContain("미확인 항목 C");
  });

  it("⑩-e 답 네 개(2열) — 라벨은 얼마까지/repayWords.label/언제까지/어디에 신청, 값은 도우미 함수 그대로", () => {
    const 조각 = 카드(그린다(), "grant"); // a:1 grant → repayWords.label === "갚아야 하나"
    expect(조각).toContain("얼마까지");
    expect(조각).toContain("갚아야 하나");
    expect(조각).toContain("안 갚아도 됨");
    expect(조각).toContain("언제까지");
    expect(조각).toContain("어디에 신청");
    // ★whereWords 는 `where`(실제 접수 창구)가 **먼저**다(코덱스 11차 #7 · W1) — 기관(`agency`)은
    //  창구가 비었을 때만 내려온다. a:1 은 where "관악구청" · agency "중소벤처기업부".
    expect(조각, "whereWords 가 접수 창구(where)를 먼저 읽는다").toContain("관악구청");
    const 창구없음 = 카드(그린다({ data: 자료([{ ...항목8[0], where: "" }, ...항목8.slice(1)]) }), "grant");
    expect(창구없음, "창구가 비면 기관으로 내려온다").toContain("중소벤처기업부");

    const 대출조각 = 카드(그린다(), "bank"); // p:6 카카오뱅크 → repayWords.label === "이자"
    expect(대출조각).toContain("이자");
    expect(대출조각).toContain("연 1.5%");
  });

  it("⑩-f 판정 줄 — 딱지 + verdictWords 문장 + 「조건 펼치기」 단추(aria-expanded=false 기본) · 조건 0개면 단추가 없다", () => {
    const 조각 = 카드(그린다(), "grant"); // a:1 = pass 2건
    expect(조각).toContain("조건 2개 중 2개 맞음");
    expect(조각).toContain("aria-expanded=\"false\"");
    expect(조각).toContain("조건 펼치기");
    // 펼친 내용(리스트)은 이 렌더 방식으로는 안 보인다 — 기본 상태라 실제로 없다.
    expect(조각, "정적 렌더는 항상 접힌 채로 시작한다").not.toContain("이 사업장 정보와 공고 조건을 하나씩 맞춰 본 결과");

    const 조건없음조각 = 카드(그린다(), "bank"); // p:6 = fit 0개
    expect(조건없음조각, "조건이 없으면 원문 확인 대신 자동 판정 문구").toContain("자동으로 잰 조건 없음");
    expect(조건없음조각, "조건이 없으면 펼칠 것도 없다").not.toContain("조건 펼치기");
  });

  /**
   * ★코덱스 11차 #6(2026-09-04) — 「조건 펼치기」에서 Enter·Space 를 누르면 그 글쇠 사건이 카드
   *  (`role="button"` + 손으로 이어 준 `onKeyDown`)까지 올라가 **서랍이 같이 열렸다**. 손잡이는
   *  `onKeyDown` 에서 `stopPropagation` 으로 끊는다 — 정적 렌더에는 손잡이가 안 찍히므로 여기서는
   *  「단추가 카드 안의 type=button 이다」까지만 재고, 실제 글쇠 동작은 배포 QA 몫이다.
   */
  it("⑩-f2 「조건 펼치기」 단추는 카드(role=button) 안의 type=button 이다(11차 #6 · 글쇠 동작은 브라우저 QA)", () => {
    const 조각 = 카드(그린다(), "grant");
    const i카드 = 조각.indexOf('role="button"');
    const i단추 = 조각.indexOf(">조건 펼치기<");
    expect(i카드, "카드가 눌리는 자리다").toBeGreaterThan(-1);
    expect(i단추, "단추가 카드 안에 있다(그래서 사건이 번질 수 있다)").toBeGreaterThan(i카드);
    const 단추열림 = 조각.lastIndexOf("<button", i단추);
    expect(조각.slice(단추열림, i단추)).toContain('type="button"');
  });

  it("⑩-g conditionRowText — note 있으면 「label — note」, 없으면 label만", () => {
    expect(conditionRowText({ label: "지역 서울", verdict: "pass", note: "" })).toBe("지역 서울");
    expect(conditionRowText({ label: "지역 전북 소재", verdict: "fail", note: "프로필은 서울" })).toBe(
      "지역 전북 소재 — 프로필은 서울",
    );
  });

  it("⑪ 위 띠 — profileBandWords 한 줄과 gapWords 금색 힌트 한 줄(미리보기 시안 문장과 같다)", () => {
    const html = 그린다();
    expect(html).toContain("이 사업장 정보로 판정: 서울 · 음식점/카페 · 연매출 1.3억 · 2023년 1월 설립 · 개인사업자");
    expect(html).toContain("text-wedly-gold-ink");
    expect(html).toContain("회사 정보에 신용점수·기존 대출 유무가 비어 있어 일부 조건은 「확인 필요」로 남습니다");
    expect(html, "옛 「대조 기준」 문구").not.toContain("대조 기준");
    expect(html, "옛 「대조에 쓴 정보」 문구").not.toContain("대조에 쓴 정보");

    const 빈띠 = 그린다({ data: 자료(항목8, { usedProfile: [], profileGaps: [] }) });
    expect(빈띠, "usedProfile 이 비면 위 띠 문장이 없다").not.toContain("이 사업장 정보로 판정");
    expect(빈띠, "profileGaps 가 비면 힌트가 없다").not.toContain("비어 있어 일부 조건은");
  });

  it("⑫ 한눈에 4칸 — 라벨·값이 계약 그대로(맞는 것·최대 금액 접미사 없음)", () => {
    const html = 그린다();
    expect(html).toContain("지금 신청 가능");
    expect(html).toContain("7일 안에 마감");
    expect(html).toContain("안 갚아도 되는 돈");
    expect(html, "「· 맞는 것」 접미사가 남아 있다").not.toContain("안 갚아도 되는 돈 · 맞는 것");
    expect(html).toContain("가장 낮은 이자");
    expect(html, "「· 맞는 것」 접미사가 남아 있다").not.toContain("가장 낮은 이자 · 맞는 것");
    expect(html, "1건").toContain(">1건<");
    expect(html).toContain("연 1.5%");
  });
});

describe("자금 조달 지도 서랍 — 그려서 재기", () => {
  it("① 답 네 개와 조건 체크리스트·한 줄 이유·원문 링크", () => {
    const html = 서랍(항목8[4]);
    // ★재설계(계약 §G3, 2026-09-04) — 「어디서」→「어디에 신청」(whereWords 라벨). 통합 단계에서 낱말만 맞춘다.
    for (const k of ["얼마", "이자", "언제까지", "어디에"]) expect(html).toContain(k);
    expect(html).toContain("신용점수 NICE 600↑");
    // ★재설계(계약 §G3, 2026-09-04) — 조건 딱지 낱말이 「확인 필요」→「직접 확인」으로 바뀌었고
    // (conditionVerdictWord), 옛 「한 줄 이유」(item.why) 상자는 아예 없어졌다(FundingDrawer.tsx
    // 주석: 판정 줄(verdictWords)·조건별 줄이 그 자리를 대신한다 — 기호·「원문 확인」 낱말 금지와
    // 같은 정리). 새 낱말은 funding-drawer-render.test.tsx 의 조건 목록 시험이 이미 검증한다.
    expect(html).toContain("직접 확인");
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noreferrer"');
  });

  /**
   * ★독립 검사 E(2026-09-03 · 배포본 캡처 `07-drawer-amount-truncated.png`)
   *   「얼마」 타일 하나가 다섯 줄로 늘어나 나머지 세 타일이 빈 상자처럼 보였다.
   *   네 타일 모두 두 줄에서 끊고 전체는 title 로 읽는다(카드·표의 「얼마」와 같은 규칙).
   */
  it("①-b 답 네 개 타일은 두 줄에서 끊고 전체를 title 로 읽는다 — 한 칸이 다섯 줄로 늘지 않는다", () => {
    const 긴금액 = "사전기획 최대 3개월, 238만 원(정부지원비중 85%) / 구축지도 최대 6개월, 476만 원";
    const html = 서랍({ ...항목8[4], amountText: 긴금액 });
    // 타일 값 줄의 **여는 태그만** 잡는다 — `text-wedly-value` 는 서랍에서 이 네 줄만 쓴다
    // (대상 원문·한 줄 이유와 안 섞이게).
    const 타일들 = html.match(/<p class="[^"]*text-wedly-value[^"]*"[^>]*>/g) ?? [];
    expect(타일들.length, "얼마·이자·언제까지·어디서 네 타일").toBe(4);
    for (const [i, 타일] of 타일들.entries()) {
      expect(타일, `${i + 1}번째 타일이 두 줄에서 안 끊긴다`).toContain("line-clamp-2");
      expect(타일, `${i + 1}번째 타일에 어절 줄바꿈이 없다`).toContain("break-keep");
      expect(타일, `${i + 1}번째 타일의 전체 값을 title 로 못 읽는다`).toContain("title=");
    }
    expect(html, "끊긴 금액 전체를 title 로 못 읽는다").toContain(`title="${긴금액}"`);
  });

  /**
   * ★2026-09-03 독립 화면 검사 A(배포본 실측) — 「전체 보기」로 타일 하나를 펼치면 그리드 기본값
   *  (`items-stretch`)이라 4칸 전부 같은 높이로 늘어나, 안 펼친 나머지 세 칸에 382px 빈 자리가 생겼다.
   *  `items-start` 를 주면 각 타일이 자기 내용 높이만큼만 차지해 펼친 칸만 늘어난다.
   */
  it("①-g 답 네 개 타일 그리드는 items-start — 한 칸을 펼쳐도 나머지 세 칸이 함께 안 늘어난다(독립 검사 A)", () => {
    const html = 서랍(항목8[4]);
    expect(html).toContain('class="grid grid-cols-2 items-start gap-2 lg:grid-cols-4"');
  });

  /**
   * ★2026-09-03 독립 화면 검사 C(배포본 실측) — 공백 없는 긴 값(전화번호·URL 같은 한 덩어리)은 펼쳐도
   *  `break-keep` 때문에 줄이 안 바뀌어 타일 테두리 밖으로 5px 가로로 삐져나왔다. 펼친 상태에선
   *  `break-all` 로 글자 중간에서라도 반드시 줄을 바꾼다. 판정은 순수 함수(`tileValueClass`)로 뗀다.
   */
  // ★재설계(계약 §G3, 5차 독립 검사 지적 2 — 2026-09-04) — 펼친 값의 break-all 이 어절 규칙을
  //  어겨(「한도는」「1차년도」가 글자 중간에서 끊김) break-keep + [overflow-wrap:anywhere]로 바뀌었다.
  //  같은 계약을 새 서랍 전용 시험 `funding-drawer-render.test.tsx`(G3, "tileValueClass" describe)도
  //  이미 이 값으로 검증한다 — 통합 단계에서 이 옛 시험만 같은 값으로 맞춘다.
  it("①-h tileValueClass — 펼치면 break-keep + [overflow-wrap:anywhere](어절 유지, break-all 아님), 접으면 line-clamp-2·break-keep(독립 검사 C·5차 지적 2)", () => {
    expect(tileValueClass(true)).toContain("break-keep");
    expect(tileValueClass(true)).toContain("[overflow-wrap:anywhere]");
    expect(tileValueClass(true), "글자 중간에서 끊는 break-all 은 어절 규칙 위반").not.toContain("break-all");
    expect(tileValueClass(true)).not.toContain("line-clamp-2");
    expect(tileValueClass(false)).toContain("line-clamp-2");
    expect(tileValueClass(false)).toContain("break-keep");
  });

  /**
   * ★2026-09-03 코덱스 적대 리뷰 지적 6 — 상품 한도 원문을 2줄에서 자르고 전체는 title(hover)에만
   *  뒀다. 휴대전화엔 hover 가 없고 상품엔 상세 화면이 따로 없어 원문을 볼 길이 아예 없었다.
   *
   * ★2026-09-03 코덱스 적대 리뷰 재지적 — 「60자 넘으면 단추」는 글자 수로만 판단해, 좁은 화면 2열
   *  타일에서는 60자 미만 문구도 두 줄을 넘어 잘리는데 단추가 안 떴다. `AnswerTile` 은 이제
   *  `useLayoutEffect`+`ResizeObserver` 로 값 요소의 실제 `scrollHeight > clientHeight+1` 을 재
   *  넘칠 때만 단추를 둔다(60자 규칙은 지웠다) — 판정 규칙은 `isTileOverflowing` 순수 함수로 뺐다
   *  (`FundingDrawer.tsx`).
   *
   * ★아래 두 시험이 예전과 검증 방식이 다르다(사유) — 이 파일은 이펙트를 안 돌리는
   *  `renderToStaticMarkup` 만 쓴다(파일 맨 위 주석: 이 저장소엔 jsdom·@testing-library/react 가
   *  없다, `vitest.config.ts` 의 `test.environment` 가 `"node"`·`node_modules` 미설치로 2026-09-03
   *  재확인). SSR 은 `useLayoutEffect` 를 안 돌리고 ref 도 안 붙여, **실제 넘침 판정은 이 렌더 방식
   *  으로 못 잰다** — jsdom 을 새로 설치하거나 다른 렌더 기법을 들이는 결정은 이 시험 파일만으로는
   *  하지 않는다(보고에 명시, 메인 확인 필요).
   *  ①-c 는 판정 규칙(`isTileOverflowing`)만 순수 함수로 직접 불러 잰다 — 이 파일이 이미
   *   `itemKeyDown`·`nextFilters` 를 순수 함수로 직접 부르는 것과 같은 방식이다(파일 맨 위 주석 ②).
   *  ①-d 는 렌더 쪽에서 **실제로 확인되는** 사실로 바꿨다 — 초기 정적 렌더는 이펙트가 안 돌아 값
   *   길이와 무관하게 단추가 안 뜬다. 예전 "60자 이하면 없다"와 결과는 같아 보여도 뜻이 다르다
   *   (짧아서가 아니라 SSR 이 애초에 안 재서다) — 그래서 브라우저에서 실제로 여닫히는지는 이 시험
   *   으로 증명되지 않는다(실제 클릭·hover 확인은 별도 브라우저 QA 몫).
   */
  it("①-c 넘침 판정 규칙(isTileOverflowing) — scrollHeight 가 clientHeight+1 보다 크면 넘친 것", () => {
    // 7차 지적 5 로 입력에 가로 치수(scrollWidth·clientWidth)가 더해졌다 — 이 시험은 세로 넘침만 재므로
    // 가로는 안 넘치는 값(200/200)으로 고정한다(뜻은 그대로).
    const 가로안넘침 = { scrollWidth: 200, clientWidth: 200 };
    // 코덱스 지적 예시 그대로: 48/40 은 넘침, 40/40 은 안 넘침
    expect(isTileOverflowing({ scrollHeight: 48, clientHeight: 40, ...가로안넘침 })).toBe(true);
    expect(isTileOverflowing({ scrollHeight: 40, clientHeight: 40, ...가로안넘침 })).toBe(false);
    // 오차 1px 방어 — 딱 +1 차이는 아직 넘친 것으로 안 본다
    expect(isTileOverflowing({ scrollHeight: 41, clientHeight: 40, ...가로안넘침 })).toBe(false);
    expect(isTileOverflowing({ scrollHeight: 42, clientHeight: 40, ...가로안넘침 })).toBe(true);
  });
  /**
   * ★2026-09-03 코덱스 7차 지적 5 — 넘침을 세로만 봤다. 공백 없는 긴 값(주소·URL 같은 한 덩어리)은
   *  `break-keep` 때문에 줄이 안 바뀌고 **가로로** 잘리는데(두 줄을 안 넘으니 scrollHeight 는 그대로) 단추가
   *  안 떴다. 가로(`scrollWidth > clientWidth + 1`)도 재서 **하나라도** 넘치면 넘친 것으로 본다.
   */
  it("①-e 가로만 넘쳐도(scrollWidth 가 clientWidth+1 보다 큼) 넘친 것 — 공백 없는 긴 값이 break-keep 으로 가로 잘림(7차 지적 5)", () => {
    expect(isTileOverflowing({ scrollHeight: 40, clientHeight: 40, scrollWidth: 320, clientWidth: 200 })).toBe(true);
    // 가로도 오차 1px 방어 — 딱 +1 은 아직 안 넘친 것
    expect(isTileOverflowing({ scrollHeight: 40, clientHeight: 40, scrollWidth: 201, clientWidth: 200 })).toBe(false);
    expect(isTileOverflowing({ scrollHeight: 40, clientHeight: 40, scrollWidth: 202, clientWidth: 200 })).toBe(true);
  });
  /**
   * ★2026-09-03 독립 화면 검사 B(배포본 실측: scrollHeight==clientHeight·scrollWidth==clientWidth 인데도
   *  단추가 남아 눌러도 아무 일이 없었다) — `everOverflowed`(한 번 넘친 기억)를 없앤다. 창을 넓혀 실제로
   *  더는 안 넘치면 `overflowing` 이 매번 다시 재는 `measure()` 로 스스로 false 로 되돌아오므로, 별도
   *  기억이 없어도 된다. 단추 조건은 `expanded || overflowing` 으로 단순화했다.
   *  ★접기 직후 단추가 한 프레임 사라져 초점을 잃는 문제(everOverflowed 를 만든 원래 이유)는 측정을
   *  `useLayoutEffect` 에 두는 것으로 막는다 — 화면이 그려지기 전에 동기적으로 다시 재므로, 아직 실제로
   *  넘치는 상태(대개 그렇다)라면 같은 커밋 안에서 `overflowing` 이 다시 true 로 잡혀 단추가 사라지는
   *  프레임 자체가 없다.
   *  ★기존 시험 뜻 변경(보고 명시 대상) — 예전엔 `everOverflowed:true` 단독으로도 단추가 남는 것을
   *  확인했는데, 그 동작 자체가 이번에 없앤 버그라서 그 경우를 시험에서 뺐다.
   *
   * ★2026-09-03 코덱스 적대 리뷰 반영(시그니처 변경, 보고 명시 대상) — 펼친 뒤 창을 넓히고 「접기」를
   *  누르면 `useLayoutEffect` 재측정으로 `overflowing` 이 곧바로 false 가 되는데, 그 순간 단추가 사라져
   *  (`expanded` 도 false 로 바뀐 직후라) 그 단추에 있던 키보드 초점이 문서로 튀었다. 단추가 **초점을
   *  가진 동안**은 남기도록 `focusHeld` 인자를 더했다 — 표시 조건이
   *  `expanded || overflowing || focusHeld` 로 바뀌어 기존 세 조합에도 `focusHeld: false` 를 명시한다
   *  (값 자체는 그대로, everOverflowed 처럼 영구히 남진 않고 초점을 잃는 순간 사라진다).
   */
  it("①-f 단추 표시 규칙(shouldShowExpandButton) — 펼쳤거나 지금 넘치거나 초점을 가지면 보인다 · everOverflowed 기억 없음(독립 검사 B·코덱스 리뷰 반영)", () => {
    // 한 번도 안 넘쳤고 접혀 있고 초점도 없으면 없다(정적 렌더 ①-d 와 같은 상태)
    expect(shouldShowExpandButton({ expanded: false, overflowing: false, focusHeld: false })).toBe(false);
    // 지금 넘치면 보인다
    expect(shouldShowExpandButton({ expanded: false, overflowing: true, focusHeld: false })).toBe(true);
    // 펼쳐서 제한이 풀려 넘침이 false 로 재져도 「접기」 손잡이는 남는다
    expect(shouldShowExpandButton({ expanded: true, overflowing: false, focusHeld: false })).toBe(true);
    // 넘치지 않고 접혀 있어도 단추가 초점을 갖고 있으면 남는다 — 재측정으로 넘침이 사라져도 초점을 잃지 않는다
    expect(shouldShowExpandButton({ expanded: false, overflowing: false, focusHeld: true })).toBe(true);
  });
  it("①-d 정적 렌더링(이펙트 없음)에서는 값이 길어도 「전체 보기」 단추가 없다 — 실제 넘침은 브라우저에서만 잰다(넘침 규칙 자체는 위 순수 함수 시험이 검증한다)", () => {
    const 긴한도 =
      "서민금융진흥원 창업자금 최대 7,000만원(운전자금 최대 2,000만원 포함) — 신용보증재단 특별보증 연계 상품";
    const 긴값_html = 서랍({ ...항목8[4], amountText: 긴한도 });
    expect(긴값_html, "SSR 은 useLayoutEffect 를 안 돌려 긴 값도 단추가 없다").not.toContain("전체 보기");
    const 짧은값_html = 서랍(항목8[4]);
    expect(짧은값_html, "짧은 값도 마찬가지로 단추가 없다").not.toContain("전체 보기");
  });

  it("② 항목이 없으면 아무것도 안 그린다", () => {
    expect(서랍(null)).toBe("");
  });

  it("③ 공고 서랍은 상세 화면을 품지 않고 「상세·AI 판정 열기」로 보낸다", () => {
    const 손잡이있음 = 서랍(항목8[1], () => {});
    // DetailPanel 을 품으면 그 부품의 첫 화면 글자가 함께 그려진다(체크리스트 두 벌 · 카드 안 카드).
    expect(손잡이있음, "서랍이 상세 부품을 품고 있다").not.toContain("불러오는 중");
    expect(손잡이있음).toContain("상세·AI 판정 열기");
    // 조건 체크리스트는 한 벌뿐이다
    // ★재설계(계약 §G3, 2026-09-04) — 조건 목록 안내 문장이 「이 사업자와 맞는지」→
    //  「이 사업장 정보와 공고 조건을 하나씩 맞춰 본 결과」로 바뀌었다(funding-map.ts 도 이 문구를
    //  안 지어낸다는 계약 낱말 규칙과 같다). funding-drawer-render.test.tsx 의 같은 시험과 같은 문구.
    expect((손잡이있음.match(/이 사업장 정보와 공고 조건을 하나씩 맞춰 본 결과/g) ?? []).length).toBe(1);

    const 손잡이없음 = 서랍(항목8[1]);
    expect(손잡이없음, "갈 곳이 없으면 단추를 그리지 않는다").not.toContain("상세·AI 판정 열기");
    expect(손잡이없음).toContain("전체 공고 탐색");
  });

  it("④ 상품 서랍의 출처 이름표는 접두어 붙은 실제 출처 id 를 읽는다", () => {
    expect(서랍(항목8[6]), "product-kinfa").toContain("서민금융진흥원");
    expect(서랍(항목8[5]), "product-finlife-soho").toContain("금융감독원 금융상품통합비교공시");
    expect(서랍(항목8[7]), "product-tips").toContain("TIPS");
    expect(서랍(항목8[4]), "manual 은 접두어가 없다").toContain("손 등록 명부");
    // 모르는 출처는 지어내지 않고 그대로 보여 준다
    expect(서랍({ ...항목8[6], source: "product-새출처" })).toContain("product-새출처");
    // 상품 서랍에는 공고용 단추가 없다
    expect(서랍(항목8[6], () => {})).not.toContain("상세·AI 판정 열기");
  });

  it("⑤ 묶인 공고가 2건 이상이면 「같은 공고 N건(수집원별)」 목록 자리를 그린다", () => {
    // 코덱스 #2: 묶인 다른 수집본을 열 길이 아예 없었다. 서랍이 같은 열쇠로 구성원을 다시 묻는다.
    // 정적 렌더라 useEffect 가 안 도니 **아직 못 받은 상태**가 그려진다 — 그 자리가 있는지를 잰다.
    const 묶인: FundingItem = { ...항목8[1], groupCount: 3, groupSources: 2, dedupKey: "묶음열쇠|경상북도" };
    const html = 서랍(묶인, () => {});
    expect(html).toContain("같은 공고 3건");
    expect(html).toContain("수집원별");
    expect(html, "받기 전에는 불러오는 중이라고 말한다").toContain("불러오는 중");

    // 안 묶인 줄에는 자리 자체가 없다
    expect(서랍(항목8[1], () => {}), "묶이지 않았으면 목록을 그리지 않는다").not.toContain("같은 공고");
    // 열쇠가 없으면 물을 수 없으니 그리지 않는다(묶음 표식만으로 빈 목록을 띄우지 않는다)
    expect(서랍({ ...항목8[1], groupCount: 3, groupSources: 2 }, () => {})).not.toContain("같은 공고");
  });
});
