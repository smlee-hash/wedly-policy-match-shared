import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import * as FundingMapModule from "./FundingMap";
import FundingMap, {
  FundingMapView,
  cardFooterOf,
  classifiedGroupItems,
  conditionRowText,
  itemKeyDown,
  nextFilters,
  shouldOpenDetail,
  sortRows,
  tableRowsOf,
  unclassifiedGroupItems,
  GROUP_TONE_TILE,
  type FundingCardFooter,
  type FundingMapPayload,
} from "./FundingMap";
import FundingDrawer, { isTileOverflowing, shouldShowExpandButton, tileValueClass } from "./FundingDrawer";
import { FUNDING_GROUPS, FUNDING_GROUP_META, type FundingGroup } from "../funding/funding-group";
import {
  deadlineOfAnnouncement,
  deadlineOfProduct,
  deadlineWords,
  gapParts,
  profileBandParts,
  type FundingFilters,
  type FundingItem,
  type FundingSort,
} from "../funding/funding-map";
import type { ReactNode } from "react";

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
 *
 * ★세는 칸(`total`·`fit`·`unverified`)에서 「종류 미확인」을 뺀다(독립 검사 ③ 통합, 2026-09-04).
 *  서버 `groupBlocks` 가 이제 **카드에 남는 줄**만 세고(`carded`) 미확인 줄은 `items` 에만 실어
 *  보낸다 — 여기서 미확인까지 세면 이 도우미가 **서버가 낼 수 없는 응답**을 만든다.
 *
 *  그게 왜 위험한가: 미확인 1건뿐인 갈래에서 옛 셈은 `total:1`·`items:[그 줄]` 을 냈고, 화면은
 *  그 줄을 맨 아래 블록으로 옮기므로 딱지 「1건」 + 본문 「지금 조건에 맞는 항목이 없습니다」 +
 *  발치 「이 갈래 1건 중 0건만 보여 드림」이 한 카드에 동시에 뜬다 — 바로 독립 검사 ③ 이 배포본에서
 *  본 그 화면이다. 즉 옛 도우미는 **버그를 재현하는 자료로 화면을 시험**하고 있었고, 서버 셈을
 *  옛것으로 되돌려도 이 파일 시험은 하나도 안 깨졌다(껍데기).
 *
 *  `items` 는 정상 **전부**(미확인 포함)를 그대로 싣는다 — 서버도 그렇고, 빼면 「종류 미확인」
 *  블록이 모아 올 곳이 없어진다(`unclassifiedGroupItems` 가 갈래 칸 `items` 에서 모은다).
 */
function 자료(items: FundingItem[] = 항목8, over: Partial<FundingMapPayload> = {}): FundingMapPayload {
  const groups = FUNDING_GROUPS.map((group) => {
    const mine = items.filter((it) => it.group === group);
    const 정상 = mine.filter((it) => it.fitVerdict !== "excluded");
    const 안맞음 = mine.filter((it) => it.fitVerdict === "excluded");
    // 갈래 카드에 **남는** 줄 — 미확인은 화면이 맨 아래 블록으로 옮기므로 세는 칸에서 빠진다.
    const 카드에남는 = 정상.filter((it) => !it.unclassified);
    return {
      group,
      // ★안 맞음은 `items`·`total` 에 **절대** 안 섞인다(코덱스 11차 #2 · W1 계약) — 갈래마다
      //  `excludedItems` 로 따로 실려 온다(`includeExcluded:true` 일 때만). 시험 자료도 그 모양이어야
      //  「화면이 스스로 다시 가른다」는 옛 구현을 되살려도 통과하는 껍데기 시험이 되지 않는다.
      total: 카드에남는.length,
      fit: 카드에남는.filter((it) => it.fitVerdict === "fit").length,
      unverified: 카드에남는.filter((it) => it.fitVerdict === "unverified").length,
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
    // 단정문의 유일한 근거(코덱스 3차 #C) — 이 기본 자료는 **회사 정보가 있는** 회사다.
    profileEmpty: false,
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
    unclassifiedExpanded?: boolean;
    showExcluded?: Set<FundingGroup>;
    compact?: boolean;
    selectedId?: string;
    now?: Date;
    headerAction?: ReactNode;
    onBrowseAll?: () => void;
    /** 카드 바닥 앱 조각(랩의 판정 피드백) — 안 주면 undefined 그대로 FundingMapView 에 간다. */
    renderCardFooter?: FundingCardFooter;
  } = {},
): string {
  return renderToStaticMarkup(
    <FundingMapView
      data={over.data ?? 자료()}
      view={over.view ?? "map"}
      filters={over.filters ?? 기본거르개}
      sort={over.sort ?? "rec"}
      expanded={over.expanded ?? new Set<FundingGroup>()}
      unclassifiedExpanded={over.unclassifiedExpanded ?? false}
      showExcluded={over.showExcluded ?? new Set<FundingGroup>()}
      selectedId={over.selectedId ?? ""}
      compact={over.compact ?? false}
      now={over.now ?? NOW}
      headerAction={over.headerAction}
      renderCardFooter={over.renderCardFooter}
      onOpen={() => {}}
      onView={() => {}}
      onFiltersChange={() => {}}
      onSortChange={() => {}}
      onToggleExpand={() => {}}
      onToggleUnclassified={() => {}}
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

/**
 * 머리 카드(판정 근거 + 빈칸 힌트)만 잘라 낸다 — 바로 아래 「한눈에 4칸」 격자 앞에서 끊는다.
 * 카드 밖(갈래 카드·표)의 글자와 섞이면 「카드 안에 있다」를 재는 시험이 껍데기가 된다.
 */
function 머리카드(html: string): string {
  const start = html.indexOf('class="rounded-xl border border-wedly-bd bg-white');
  expect(start, "머리 카드가 없다").toBeGreaterThan(-1);
  // ★끝은 「한눈에 4칸」 **또는 그 위 캡션** 중 먼저 오는 것이다(2026-09-05 재검사 지적 3) — 캡션이
  //  머리 카드와 4칸 사이에 생겨, 격자만 보고 자르면 캡션 한 줄이 머리 카드 안으로 딸려 들어온다
  //  (⑭ 「아래 구역이 두 줄」 시험이 3 을 세며 실제로 걸렸다).
  const 격자 = html.indexOf('class="grid gap-4 grid-cols-2', start);
  const 캡션글 = html.indexOf("전체 자료 기준 — 아래 칩·정렬과 무관합니다", start);
  expect(격자, "머리 카드 다음의 「한눈에 4칸」을 못 찾았다").toBeGreaterThan(start);
  expect(캡션글, "「한눈에 4칸」 위 캡션을 못 찾았다").toBeGreaterThan(start);
  // 캡션은 **여는 태그부터** 잘라야 한다 — 글자에서만 자르면 `<p class=…>` 만 카드 안에 남는다.
  const 캡션 = html.lastIndexOf("<p ", 캡션글);
  expect(캡션, "캡션의 여는 태그를 못 찾았다").toBeGreaterThan(start);
  const end = Math.min(격자, 캡션);
  return html.slice(start, end);
}

/**
 * 표식(`mark`)이 든 요소의 **여는 태그 한 개**만 잘라 낸다 — 클래스를 잴 때 옆 요소의 클래스가
 * 섞여 들어오면 높이가 틀려도 시험이 통과한다(2026-09-03 탬퍼 시험의 교훈, `카드머리`와 같은 이유).
 */
function 조각(html: string, mark: string, tag: string): string {
  const i = html.indexOf(mark);
  expect(i, `${mark} 를 못 찾았다`).toBeGreaterThan(-1);
  const 열림 = html.lastIndexOf(tag, i);
  expect(열림, `${mark} 앞의 ${tag} 를 못 찾았다`).toBeGreaterThan(-1);
  const 닫힘 = html.indexOf(">", 열림);
  expect(닫힘, `${tag} 가 안 닫힌다`).toBeGreaterThan(열림);
  return html.slice(열림, 닫힘 + 1);
}

/**
 * 열 수를 정하는 클래스 중 **뷰포트 문턱**만 골라낸다(`sm:grid-cols-2` 등).
 *
 * ★왜 낱개로 쪼개나: `@2xl:grid-cols-2`(컨테이너) 안에 `xl:grid-cols`(뷰포트로 보이는 조각)가
 *  들어 있다. 통짜 문자열로 찾으면 컨테이너 문턱을 뷰포트 문턱으로 **오인**한다 — 이 시험을
 *  처음 돌렸을 때 실제로 그렇게 걸렸다(2026-09-04).
 */
function 뷰포트열(태그: string): string[] {
  return 클래스(태그)
    .split(/\s+/)
    .filter((c) => /^(?:sm|md|lg|xl|2xl|3xl):grid-cols-/.test(c));
}

/**
 * 어떤 여는 태그의 **바로 위 부모** 여는 태그를 잘라 낸다 — 컨테이너 선언이 「격자의 조상」에
 * 있는지 재는 데 쓴다. `조각` 은 **첫** 표식을 찾으므로 조상을 찾는 데 못 쓴다(문서 맨 앞의
 * 뿌리 `<div>` 가 잡힌다 — 2026-09-04 이 시험이 스스로 잡았다).
 */
function 부모(html: string, 자식태그: string): string {
  const i = html.indexOf(자식태그);
  expect(i, "자식 태그를 못 찾았다").toBeGreaterThan(-1);
  const 앞 = html.slice(0, i);
  const 시작 = 앞.lastIndexOf("<div");
  expect(시작, "부모 <div> 가 없다").toBeGreaterThan(-1);
  return 앞.slice(시작, 앞.indexOf(">", 시작) + 1);
}

/**
 * 항목 카드 하나(`<li>…</li>`)만 잘라 낸다 — 「답 격자가 컨테이너 상자 **안**에 있는지」를 재려면
 * 카드 경계로 잘라야 한다. ItemCard 의 `<li>` 안에는 다른 `<li>` 가 없어 첫 `</li>` 가 그 끝이다.
 */
function 항목카드(html: string): string {
  const i = html.indexOf("@container cursor-pointer");
  expect(i, "항목 카드(컨테이너 선언이 붙은 상자)가 없다").toBeGreaterThan(-1);
  const 시작 = html.lastIndexOf("<li", i);
  const 끝 = html.indexOf("</li>", i);
  expect(시작, "항목 카드의 <li> 가 없다").toBeGreaterThan(-1);
  expect(끝, "항목 카드의 </li> 가 없다").toBeGreaterThan(시작);
  return html.slice(시작, 끝 + 5);
}

/** 여는 태그에서 `class="…"` 값만 뽑는다 — 태그 두 개의 클래스가 같은지 재는 데 쓴다. */
function 클래스(태그: string): string {
  const m = /class="([^"]*)"/.exec(태그);
  expect(m, `클래스가 없다: ${태그}`).not.toBeNull();
  return m![1];
}

/**
 * ③ 조작줄만 잘라 낸다 — `data-controls` 표식에서 시작해 **바로 다음 덩어리**(카드 격자·표·빈 상태)
 * 앞에서 끊는다. 줄 밖 글자(카드 안 11px·발 안내 11px)가 섞이면 「이 줄 글자가 한 층인지」를
 * 재는 시험이 껍데기가 된다(2026-09-03 탬퍼 시험의 교훈).
 */
function 조작줄(html: string): string {
  const i = html.indexOf('data-controls="funding-map"');
  expect(i, "조작줄 표식이 없다").toBeGreaterThan(-1);
  const 시작 = html.lastIndexOf("<div", i);
  expect(시작, "조작줄 여는 태그를 못 찾았다").toBeGreaterThan(-1);
  const 끝후보 = [
    html.indexOf('class="@container flex flex-col gap-4"', i), // 카드 보기
    html.indexOf('class="flex flex-col gap-1.5"', i), // 표 보기
    html.indexOf("조건에 맞는 항목이 없습니다", i), // 빈 상태
  ].filter((x) => x > -1);
  expect(끝후보.length, "조작줄 다음 덩어리를 못 찾았다 — 잘라 내는 자리가 틀렸다").toBeGreaterThan(0);
  return html.slice(시작, Math.min(...끝후보));
}

/** 갈래 카드 하나의 HTML 만 잘라 낸다 — `data-group` 표식으로 자른다. */
function 카드(html: string, group: FundingGroup): string {
  const start = html.indexOf(`data-group="${group}"`);
  expect(start, `${group} 카드가 없다`).toBeGreaterThan(-1);
  const rest = html.slice(start);
  const next = rest.slice(1).indexOf("data-group=");
  return next === -1 ? rest : rest.slice(0, next + 1);
}

/**
 * 「종류 미확인」 블록 **하나만** 잘라 낸다 — 딱지·발치 글자를 잴 때 갈래 카드나 발 hint 의 건수가
 * 섞여 들어오면 「이 상자가 몇 건이라 적었나」를 재는 시험이 껍데기가 된다(`카드` 와 같은 이유).
 */
/**
 * 어떤 요소의 **부모 여는 태그 위치**를 돌려준다 — 브라우저 `el.parentElement` 와 같은 뜻이다.
 *
 * ★왜 진짜 DOM 을 안 쓰나(2026-09-05 실측): 이 저장소엔 jsdom·happy-dom·linkedom 이 **하나도**
 *  없고, 그것은 실수가 아니라 결정이다 — `vitest.config.ts` 가 「ERP 와 같은 `node` 환경을 쓴다,
 *  환경을 바꾸면 옮겨온 시험이 ERP 에서 다르게 돈다」고 적어 두었고 ERP `node_modules` 에도
 *  없다. 그래서 부품을 새로 들이는 대신, `renderToStaticMarkup` 이 뱉는 **닫힘이 맞는 마크업**
 *  위를 여는/닫는 태그로 걸어가며 여는 태그 자리를 쌓아 부모를 찾는다.
 *
 * ★글자 차례(`indexOf` 비교)로 재던 옛 방식과 다른 점: 차례는 「캡션이 격자 **앞**에 있다」까지만
 *  말한다. 캡션을 격자 바깥 형제로 빼내도 차례는 그대로라 통과한다 — 그런데 그렇게 되면 뿌리의
 *  `gap-4`(16px)가 `mb-2`(8px)에 더해져 간격이 24px 이 된다. 부모가 같은지 재야 그걸 잡는다.
 */
function 부모위치(html: string, 자식위치: number): number {
  const 빈태그 = new Set(["br", "hr", "img", "input", "meta", "link", "source", "area", "base", "col", "embed", "track", "wbr"]);
  const 스택: number[] = [];
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b[^>]*?(\/?)>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    if (m.index === 자식위치) return 스택.length === 0 ? -1 : 스택[스택.length - 1];
    if (m.index > 자식위치) break;
    const 닫힘 = m[1] === "/";
    const 이름 = m[2].toLowerCase();
    const 스스로닫음 = m[3] === "/";
    if (닫힘) 스택.pop();
    else if (!스스로닫음 && !빈태그.has(이름)) 스택.push(m.index);
  }
  expect.fail(`위치 ${자식위치} 에서 여는 태그를 못 찾았다`);
}

function 미확인블록(html: string): string {
  const i = html.indexOf("종류 미확인 — 제목만으로는 못 가름");
  expect(i, "「종류 미확인」 블록이 없다").toBeGreaterThan(-1);
  const 시작 = html.lastIndexOf("<section", i);
  const 끝 = html.indexOf("</section>", i);
  expect(시작, "블록의 <section> 이 없다").toBeGreaterThan(-1);
  expect(끝, "블록의 </section> 이 없다").toBeGreaterThan(시작);
  return html.slice(시작, 끝 + 10);
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

  /**
   * ★2026-09-04 승인 시안 — 오른쪽 끝 회색 문장(「이 사업장에 안 맞는 공고는 기본으로 뺐습니다」)을
   *  **지웠다**. 같은 사실을 갈래 카드마다 있는 「안 맞아서 뺀 N건 보기」 단추가 이미 알리면서
   *  **누를 수 있게** 한다(`funding-map.ts` 의 `groupFooterWords` → `excluded`,
   *  `FundingMap.tsx` 가 `BTN_SM` 단추로 그린다). 뺀 것이 없으면 그 단추는 안 뜨는데
   *  회색 문장만 늘 떠 있었다 — 「빈 상태 문구는 다음 행동을 함께 적는다」에 어긋난다.
   */
  it("②-a 칩은 두 개뿐(맞는 것만 삭제) · 알약 라벨은 카드로 보기/표로 보기 · 오른쪽 회색 안내 문장은 없다", () => {
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
    expect(html, "지운 회색 안내 문장이 되살아났다").not.toContain("이 사업장에 안 맞는 공고는 기본으로 뺐습니다");
    expect(html, "문장을 줄여서 남기지도 옮기지도 않는다").not.toContain("기본으로 뺐습니다");
    // 같은 사실을 말하는 **누를 수 있는** 단추는 그대로 있다(뺀 것이 있는 갈래에만)
    expect(html, "대신 알리는 단추가 사라졌다").toContain("안 맞아서 뺀");
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
   * ★코덱스 11차 #5(2026-09-04) — 표가 안 맞음을 **전역으로** 늘어놓아, 「기본으로 뺐습니다」라고
   *  적어 둔 화면에서 표만 안 맞는 공고를 섞어 보여 줬다.
   * ★코덱스 14차 [높음](2026-09-04) — 그 고침이 표를 **갈래별 펼치기(`showExcluded`)** 에 묶었는데,
   *  표 위 손잡이는 `filters.includeExcluded` 만 뒤집는다. 그래서 표에서 손잡이를 눌러 서버가
   *  안 맞음을 실어 보내도 행이 하나도 안 늘었다. 표는 **스위치 하나**만 본다(`tableRowsOf`).
   */
  it("③-g 표 행 = 모든 갈래 items + 스위치가 켜졌을 때 모든 갈래의 excludedItems(회색·「안 맞음」 딱지)(14차 [높음])", () => {
    const 닫힘 = 그린다({ view: "table" });
    const tb닫힘 = 닫힘.slice(닫힘.indexOf("<tbody"), 닫힘.indexOf("</tbody>"));
    expect((tb닫힘.match(/<tr\b/g) ?? []).length, "정상 6건만").toBe(6);
    expect(tb닫힘, "스위치가 꺼졌는데 안 맞음이 표에 노출됐다").not.toContain("전북 스마트공장 구축지원");

    const 켜짐 = 그린다({ view: "table", filters: { ...기본거르개, includeExcluded: true } });
    const tb = 켜짐.slice(켜짐.indexOf("<tbody"), 켜짐.indexOf("</tbody>"));
    expect((tb.match(/<tr\b/g) ?? []).length, "정상 6 + 안 맞음 2").toBe(8);
    const 안맞음줄 = tb.split(/<tr\b/).find((r) => r.includes("전북 스마트공장 구축지원")) ?? "";
    expect(안맞음줄, "회색(옅음) 처리").toContain("opacity-70");
    expect(안맞음줄, "판정 딱지는 「안 맞음」").toContain("안 맞음");
    const 정상줄 = tb.split(/<tr\b/).find((r) => r.includes("스마트상점 기술보급사업 3차")) ?? "";
    expect(정상줄, "정상 줄은 옅지 않다").not.toContain("opacity-70");

    // ★그린 화면으로도 잰다 — 갈래별 펼치기만 켜 두면(스위치는 꺼짐) 표는 늘지 않는다.
    const 펼치기만 = 그린다({ view: "table", showExcluded: new Set<FundingGroup>(["grant"]) });
    const tb펼치기 = 펼치기만.slice(펼치기만.indexOf("<tbody"), 펼치기만.indexOf("</tbody>"));
    expect((tb펼치기.match(/<tr\b/g) ?? []).length, "표가 카드 보기의 갈래별 펼치기를 따라갔다").toBe(6);
  });

  /**
   * ★코덱스 14차 [높음](2026-09-04) — 이 버그가 시험 21파일을 그대로 통과한 이유는 행 만들기가
   *  화면 안 `useMemo` 에 묻혀 있어 밖에서 잴 수 없었기 때문이다. 순수 함수로 떼어 직접 잰다.
   */
  it("③-g2 tableRowsOf — 표는 스위치 하나만 본다(갈래별 펼치기와 무관 · 정상 0건이어도 안 맞음이 뜬다)(14차 [높음])", () => {
    const 자 = 자료();
    const 안맞음이름 = ["전북 스마트공장 구축지원", "충북 상생보험 무료 지원"];

    // ① 꺼짐 → 안 맞음 행 0
    const 꺼짐 = tableRowsOf(자.groups, { includeExcluded: false, sort: "rec" });
    expect(꺼짐.filter((r) => r.fitVerdict === "excluded"), "꺼졌는데 안 맞음이 섞였다").toEqual([]);
    expect(꺼짐.length, "정상 6건").toBe(6);

    // ② 켜짐 → **모든** 갈래의 안 맞음이 들어온다(`showExcluded` 라는 개념 자체가 인자에 없다)
    const 켜짐 = tableRowsOf(자.groups, { includeExcluded: true, sort: "rec" });
    expect(켜짐.length, "정상 6 + 안 맞음 2").toBe(8);
    expect(켜짐.filter((r) => r.fitVerdict === "excluded").map((r) => r.title).sort()).toEqual([...안맞음이름].sort());

    // ③ 정상 0건 · 안 맞음 2건 → 행이 **2개**(빈 표가 아니다) — 손잡이는 눌렸는데 빈 표가 남던 자리
    const 안맞음만 = 자료([항목8[1], 항목8[2]]);
    expect(안맞음만.groups.reduce((s, g) => s + g.items.length, 0), "이 자료엔 정상이 0건이다").toBe(0);
    expect(tableRowsOf(안맞음만.groups, { includeExcluded: false, sort: "rec" }).length, "꺼짐이면 빈 표가 맞다").toBe(0);
    expect(tableRowsOf(안맞음만.groups, { includeExcluded: true, sort: "rec" }).length, "켰는데 빈 표가 남았다").toBe(2);

    // ④ 여러 갈래에 흩어져 있어도 한 갈래만 나오지 않는다 — 「한 갈래만 펼친 뒤 표로 옮기기」의 자리
    const 흩어짐 = 자료([항목8[1], { ...항목8[3], fitVerdict: "excluded" as const }, 항목8[5]]);
    const 흩켜짐 = tableRowsOf(흩어짐.groups, { includeExcluded: true, sort: "rec" });
    expect(흩켜짐.filter((r) => r.fitVerdict === "excluded").map((r) => r.group).sort(), "한 갈래 것만 실렸다").toEqual([
      "grant",
      "policy",
    ]);

    // ⑤ 서버가 안 실어 준 갈래(`excludedItems` 없음)를 켜도 터지지 않는다 — 개수만 있고 목록이 없다
    const 목록없음 = 자료();
    목록없음.groups = 목록없음.groups.map((g) => ({ ...g, excludedItems: undefined }));
    expect(tableRowsOf(목록없음.groups, { includeExcluded: true, sort: "rec" }).length, "없는 목록을 억지로 만들었다").toBe(6);

    // ⑥ 합친 뒤 다시 세운다(`sortRows` 와 같은 차례) · 원본 배열은 안 건드린다
    const 앞차례 = 자.groups.flatMap((g) => g.items.map((i) => i.id));
    expect(tableRowsOf(자.groups, { includeExcluded: true, sort: "amt" }).map((r) => r.id)).toEqual(
      sortRows(자.groups.flatMap((g) => [...g.items, ...(g.excludedItems ?? [])]), "amt").map((r) => r.id),
    );
    expect(자.groups.flatMap((g) => g.items.map((i) => i.id)), "원본 차례가 흔들렸다").toEqual(앞차례);
  });

  /**
   * ★코덱스 14차 [높음](2026-09-04) — 손잡이 건수(N)와 실제로 늘어나는 행 수가 뜻이 맞는지.
   *  N 은 갈래들의 `excluded` 합, 곧 **뺀 것이 몇 건 있는지**다. 서버는 갈래마다 `excludedItems` 를
   *  topN 까지만 실으므로(`groupBlocks`) 잘린 만큼은 켜도 행이 덜 는다 — 그때 실제로 그려진 줄 수는
   *  발 hint 의 「표시 N건」이 말한다(정상 목록의 `total`·`items` 와 같은 관계). 스위치가 꺼져 있으면
   *  `excludedItems` 자체가 안 실려 와 화면은 「실어 줄 수 있는 건수」를 알 길이 없다.
   */
  it("③-g3 손잡이 건수 = 뺀 것 전체 · 실제로 그려진 줄 수는 발 hint 가 말한다(14차 [높음])", () => {
    // 잘리지 않은 보통 자료: 손잡이 2건 = 늘어난 행 2줄 = 발 hint 6→8
    const 꺼짐 = 그린다({ view: "table" });
    expect(꺼짐, "꺼졌을 때 표시 건수").toContain("표시 6건");
    const 켜짐 = 그린다({ view: "table", filters: { ...기본거르개, includeExcluded: true } });
    // ★손잡이는 이제 건수를 **약속하지 않는다**(지적 ⑦) — 몇 건이 실제로 보이는지는 발 hint 만 말한다.
    expect(켜짐, "손잡이").toContain("안 맞는 공고도 보기");
    expect(켜짐, "켜면 실려 온 만큼 늘어 8건").toContain("표시 8건");

    // 서버가 잘라 실은 자료(excluded 5건인데 excludedItems 는 1건) — 손잡이는 전체(5건)를 말하고,
    // 발 hint 는 실제로 그려진 줄(6+1=7건)을 말한다. 두 수가 서로 다른 것을 세는 것이 **의도**다.
    const 잘림 = 자료();
    잘림.groups = 잘림.groups.map((g) =>
      g.group === "grant" ? { ...g, excluded: 5, excludedItems: (g.excludedItems ?? []).slice(0, 1) } : g,
    );
    const 잘림켜짐 = 그린다({ data: 잘림, view: "table", filters: { ...기본거르개, includeExcluded: true } });
    // ★잘려 실린 자료에서도 손잡이는 수를 말하지 않는다 — 예전엔 「(5건)」이라 약속하고 1줄만 늘렸다.
    expect(잘림켜짐, "손잡이").toContain("안 맞는 공고도 보기");
    expect(잘림켜짐, "손잡이가 다시 못 지킬 약속(5건)을 한다").not.toContain("안 맞는 공고도 보기 (5건)");
    expect(잘림켜짐, "발 hint 는 실제로 그려진 줄 수를 말한다").toContain("표시 7건");
    const tb = 잘림켜짐.slice(잘림켜짐.indexOf("<tbody"), 잘림켜짐.indexOf("</tbody>"));
    expect((tb.match(/<tr\b/g) ?? []).length, "그려진 줄 수와 발 hint 가 어긋난다").toBe(7);
  });

  /**
   * ★코덱스 14차 [높음](2026-09-04) 회귀 — 카드 보기의 갈래별 펼치기는 **예전 그대로**다.
   *  표를 스위치로 옮기면서 카드까지 스위치를 따르게 만들면, 한 갈래만 펼쳤는데 여섯 갈래가
   *  전부 열린다.
   */
  it("③-g4 카드 보기는 갈래별 펼치기 그대로 — 스위치만 켜도 카드는 안 열린다(14차 [높음] 회귀)", () => {
    const 스위치만 = 그린다({ view: "map", filters: { ...기본거르개, includeExcluded: true } });
    expect(카드(스위치만, "grant"), "스위치만 켰는데 카드가 열렸다").not.toContain("전북 스마트공장 구축지원");
    expect(스위치만, "카드 보기인데 표시 건수가 안 맞음까지 셌다").toContain("표시 6건");

    const 펼침 = 그린다({ view: "map", showExcluded: new Set<FundingGroup>(["grant"]) });
    expect(카드(펼침, "grant"), "펼친 갈래가 안 열렸다").toContain("전북 스마트공장 구축지원");
    expect(펼침, "펼친 만큼 표시 건수가 는다").toContain("표시 8건");
    // 다른 갈래는 그대로 닫혀 있다(전역으로 열리지 않는다)
    expect(카드(펼침, "policy"), "안 펼친 갈래까지 열렸다").not.toContain("안 맞음");
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
    const html = 그린다({ data: 자, view: "table", sort: "amt", filters: { ...기본거르개, includeExcluded: true } });
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
    const 표 = 그린다({ data: 겹침, view: "table", filters: { ...기본거르개, includeExcluded: true } });
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
      그린다({ data: 표식달린자료, view: "table", filters: 켠거르개 }),
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

    // ★캡션 시험은 아래 「⑯ 네 칸 캡션」에 따로 있다.
    // ★열 규칙은 이제 컨테이너 기준이다(지적 ⑥) — 자세한 것은 아래 「⑮ 좁은 레일」 시험이 잰다.
    expect(그린다()).toContain("@min-[1496px]:grid-cols-3");
    expect(그린다({ compact: true }), "compact 는 2열까지만").not.toContain("@min-[1496px]:grid-cols-3");
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

  /**
   * ★2026-09-05 재검사 지적 2 — 「종류 미확인」 상자가 **같은 화면에서 다른 잣대로** 세고 있었다.
   *  ⓐ 딱지가 실려 온 배열 길이(`items.length`)라, 서버가 834건을 세고 80건만 실어 보낸 화면이
   *     「80건」이라고 적었다(갈래 카드 딱지는 `block.total` = 서버가 센 전체 건수다).
   *  ⓑ 실려 온 80줄이 그대로 다 그려져 **접는 길도, 나머지를 세는 길도** 없었다.
   *  ⓒ 못 가른 줄의 「갚아야 하나」가 갈래 기본값을 타고 「안 갚아도 됨」이라 **단정**했다 —
   *     「사업설명회」·「선정결과 공고」처럼 돈이 아닌 줄까지 공짜 돈처럼 읽혔다.
   */
  it("⑩-d2 「종류 미확인」 딱지는 서버가 센 전체 건수 · 발치·「나머지 보기」는 갈래 카드와 같은 말(재검사 지적 2)", () => {
    // 실려 온 줄은 3건인데 서버가 센 전체는 834건인 화면 — 옛 코드는 여기서 「3건」이라 적었다.
    const 잘린자료 = 자료(
      [
        { ...항목8[0], id: "a:90", unclassified: true, title: "미확인 항목 A" },
        { ...항목8[0], id: "a:91", unclassified: true, title: "미확인 항목 B" },
        { ...항목8[0], id: "a:92", unclassified: true, title: "미확인 항목 C" },
        ...항목8.slice(1),
      ],
      { unclassified: 834 },
    );
    const 블록 = 미확인블록(그린다({ data: 잘린자료 }));
    // ⓐ 딱지 = total(834). items.length(3)이 아니다.
    expect(블록, "딱지가 서버가 센 전체 건수가 아니다").toContain("834건");
    expect(블록, "딱지가 실려 온 배열 길이(3건)로 되돌아갔다").not.toContain(">3건<");
    // ⓑ 발치 — 실려 온 3건 < 전체 834건이라 「중 N건만」 갈래
    expect(블록).toContain("종류 미확인 834건 중 3건만 보여 드림");
    // 실려 온 것이 3건뿐이면 더 펼칠 것이 없어 손잡이를 안 그린다(갈래 카드와 같은 규칙)
    expect(블록, "펼칠 줄이 없는데 손잡이가 있다").not.toContain("나머지 보기");

    // ★`total` 이 그린 줄보다 **작은 역전**(옛 통로는 이 칸을 안 실어 0 이 된다·배포 교체 창)에서
    //  딱지와 발치가 **같은 수**를 쓰고, 눈에 보이는 것보다 적게 적지 않는다(코덱스 2차 반려 2).
    for (const 역전 of [0, 2]) {
      const 뒤집힌 = 미확인블록(
        그린다({
          data: 자료(
            [
              { ...항목8[0], id: "a:90", unclassified: true, title: "미확인 항목 A" },
              { ...항목8[0], id: "a:91", unclassified: true, title: "미확인 항목 B" },
              { ...항목8[0], id: "a:92", unclassified: true, title: "미확인 항목 C" },
              ...항목8.slice(1),
            ],
            { unclassified: 역전 },
          ),
        }),
      );
      expect(뒤집힌, `total=${역전} 인데 딱지가 3건이 아니다`).toContain(">3건<");
      expect(뒤집힌, `total=${역전} 인데 발치가 본 것보다 적게 적었다`).toContain("종류 미확인 3건 전부");
      expect(뒤집힌, "역전인데 옛 수가 그대로 새어 나왔다").not.toContain(`>${역전}건<`);
    }
  });

  it("⑩-d3 「종류 미확인」 나머지 보기 — 접힘 3줄 ↔ 펼침 전부, compact 는 손잡이 없음(재검사 지적 2)", () => {
    const 다섯 = 자료(
      [
        { ...항목8[0], id: "a:90", unclassified: true, title: "미확인 항목 A" },
        { ...항목8[0], id: "a:91", unclassified: true, title: "미확인 항목 B" },
        { ...항목8[0], id: "a:92", unclassified: true, title: "미확인 항목 C" },
        { ...항목8[0], id: "a:93", unclassified: true, title: "미확인 항목 D" },
        { ...항목8[0], id: "a:94", unclassified: true, title: "미확인 항목 E" },
        ...항목8.slice(1),
      ],
      { unclassified: 5 },
    );
    // 항목 하나가 제목을 **두 번** 낸다(카드 글자 + `aria-label`) — 손잡이 이름 쪽만 센다.
    const 줄수 = (블록: string) => (블록.match(/미확인 항목 [A-E] 자세히 보기/g) ?? []).length;

    // 접힘 — 상위 3건만 + 「나머지 보기」
    const 접힘 = 미확인블록(그린다({ data: 다섯 }));
    expect(줄수(접힘), "접힘이 3줄이 아니다").toBe(3);
    expect(접힘).toContain("종류 미확인 5건 중 3건만 보여 드림");
    expect(접힘).toContain("나머지 보기");
    expect(접힘, "접힘인데 「접기」가 있다").not.toContain(">접기<");

    // 펼침 — 전부 + 「접기」
    const 펼침 = 미확인블록(그린다({ data: 다섯, unclassifiedExpanded: true }));
    expect(줄수(펼침), "펼쳤는데 줄이 안 늘었다").toBe(5);
    expect(펼침).toContain("미확인 항목 E");
    expect(펼침).toContain("종류 미확인 5건 전부");
    expect(펼침).toContain("접기");
    expect(펼침, "펼쳤는데 「나머지 보기」가 남았다").not.toContain("나머지 보기");

    // 다시 접으면 원복 — 같은 자료·같은 글자
    expect(미확인블록(그린다({ data: 다섯, unclassifiedExpanded: false }))).toBe(접힘);

    // compact(좁은 상세창 레일) — 3건 고정이라 손잡이가 없다(갈래 카드와 같은 규칙)
    const 좁게 = 미확인블록(그린다({ data: 다섯, compact: true }));
    expect(줄수(좁게), "compact 가 3줄 고정이 아니다").toBe(3);
    expect(좁게, "compact 에 손잡이가 있다").not.toContain("나머지 보기");
    expect(좁게, "compact 에 손잡이가 있다").not.toContain(">접기<");
    // compact 도 발치 문장 자체는 그린다 — 「몇 건 중 몇 건인지」는 좁아도 알아야 한다
    expect(좁게).toContain("종류 미확인 5건 중 3건만 보여 드림");

    // ★펼침 상태는 **갈래 펼침과 별개**다 — 갈래를 펼쳐도 미확인 블록은 접힌 채다
    const 갈래만펼침 = 미확인블록(그린다({ data: 다섯, expanded: new Set<FundingGroup>(FUNDING_GROUPS) }));
    expect(줄수(갈래만펼침), "갈래 펼침이 미확인 블록까지 펼쳤다 — 두 상태가 섞였다").toBe(3);
  });

  it("⑩-d4 못 가른 줄의 「갚아야 하나」는 단정하지 않는다 — 카드·표 둘 다 「종류 확인 필요」(재검사 지적 2)", () => {
    // grant 갈래(=「안 갚아도 됨」이 기본값)로 붙었지만 종류를 못 가른 줄
    // 이자 칸이 **비어 있는** 줄 — 적힌 것이 없을 때만 「종류 확인 필요」다(2차 반려 3).
    const 못가름 = 자료(
      [{ ...항목8[0], unclassified: true, title: "2026년 사업설명회 개최 안내", rateText: "", rateMin: null }, ...항목8.slice(1)],
      { unclassified: 1 },
    );
    const 블록 = 미확인블록(그린다({ data: 못가름 }));
    expect(블록, "카드가 「종류 확인 필요」로 적지 않는다").toContain("종류 확인 필요");
    expect(블록, "못 가른 줄을 「안 갚아도 됨」이라고 단정한다").not.toContain("안 갚아도 됨");

    // 표 보기도 같은 도우미(repayWords)를 쓴다 — 한쪽만 고치면 표에서 단정이 살아남는다
    const 표 = 그린다({ data: 못가름, view: "table" });
    expect(표, "표가 「종류 확인 필요」로 적지 않는다").toContain("종류 확인 필요");

    // ★단 **공고에 이자가 적혀 있으면 그것이 먼저다**(코덱스 반려 2) — 아는 값을 확인 필요로
    //  덮으면 화면이 가진 사실을 버린다.
    const 이자있음 = 자료(
      [{ ...항목8[0], unclassified: true, title: "종류 미상 대출", rateText: "연 2.5%" }, ...항목8.slice(1)],
      { unclassified: 1 },
    );
    const 이자블록 = 미확인블록(그린다({ data: 이자있음 }));
    expect(이자블록, "아는 이자를 「확인 필요」로 덮었다").toContain("연 2.5%");
    expect(이자블록, "이자를 알면서 「종류 확인 필요」라 적었다").not.toContain("종류 확인 필요");

    // ★원문이 「무상」이라 적었으면 그것도 사실이다(2차 반려 3) — 갈래 추측이 아니라 자료다.
    const 무상 = 자료(
      [{ ...항목8[0], unclassified: true, title: "종류 미상 지원사업", rateText: "무상 지원" }, ...항목8.slice(1)],
      { unclassified: 1 },
    );
    const 무상블록 = 미확인블록(그린다({ data: 무상 }));
    expect(무상블록, "원문의 무상을 「확인 필요」로 덮었다").toContain("안 갚아도 됨");
    expect(무상블록).not.toContain("종류 확인 필요");
  });

  /**
   * ★코덱스 반려 3(2026-09-05) — 발 hint 의 「표시 N건」이 갈래 칸 `items` 를 통째로 셌다.
   *  미확인 줄은 그 배열에 실려 오지만 **갈래 카드가 안 그리고** 맨 아래 블록이 접어서 3줄만
   *  그린다 — 그래서 5건이 실려 온 화면이 3줄만 보이는데 「표시 5건」이라 적었다. 갈래 카드
   *  발치가 `shown.length`(그려진 수)로 세는 규칙과 어긋난 자리다.
   */
  it("⑩-d5 발치 「표시 N건」은 실제로 그려진 줄만 센다 — 미확인 접힘 3 / 펼침 5(반려 3)", () => {
    const 다섯 = 자료(
      [
        { ...항목8[0], id: "a:90", unclassified: true, title: "미확인 항목 A" },
        { ...항목8[0], id: "a:91", unclassified: true, title: "미확인 항목 B" },
        { ...항목8[0], id: "a:92", unclassified: true, title: "미확인 항목 C" },
        { ...항목8[0], id: "a:93", unclassified: true, title: "미확인 항목 D" },
        { ...항목8[0], id: "a:94", unclassified: true, title: "미확인 항목 E" },
        ...항목8.slice(1),
      ],
      { unclassified: 5 },
    );
    const 표시수 = (html: string): number => {
      const m = /표시 ([\d,]+)건/.exec(html);
      expect(m, "발치 「표시 N건」을 못 찾았다").not.toBeNull();
      return Number(m![1].replace(/,/g, ""));
    };
    // 갈래 카드에 남는 정상 줄(미확인 5건은 빠진다) — 기준선
    const 갈래몫 = 표시수(그린다({ data: 자료(항목8.slice(1)) }));

    const 접힘 = 표시수(그린다({ data: 다섯 }));
    const 펼침 = 표시수(그린다({ data: 다섯, unclassifiedExpanded: true }));
    expect(접힘, "접혀서 3줄만 그렸는데 5를 셌다").toBe(갈래몫 + 3);
    expect(펼침, "펼쳐서 5줄을 그렸는데 안 늘었다").toBe(갈래몫 + 5);
    // compact 도 3줄 고정이라 접힘과 같다
    expect(표시수(그린다({ data: 다섯, compact: true })), "compact 가 그려진 수를 안 센다").toBe(갈래몫 + 3);
  });

  /**
   * ★코덱스 반려 3 후속(2026-09-05) — 갈래 카드도 접히면 상위 3건만 그리는데 발치 「표시 N건」의
   *  **갈래 몫만** 실려 온 줄을 통째로 셌다. 한 줄 안에 규칙이 둘이면(갈래는 실려 온 수, 미확인은
   *  그려진 수) 그 수가 무엇을 뜻하는지 아무도 못 말한다. 이제 갈래 카드 발치 `shown.length` ·
   *  「종류 미확인」 블록 · 이 발치 **세 자리가 한 규칙**을 쓴다.
   */
  it("⑩-d5b 발치 「표시 N건」의 갈래 몫도 그려진 수 — 정상 5건 접힘 3 / 펼침 5(반려 3 후속)", () => {
    // grant 갈래 하나에만 정상 5건 — 다른 갈래는 0건이라 이 수가 곧 갈래 몫이다
    const 다섯 = 자료([
      mk({ id: "a:80", group: "grant", title: "무상 항목 1", fitVerdict: "fit" }),
      mk({ id: "a:81", group: "grant", title: "무상 항목 2", fitVerdict: "fit" }),
      mk({ id: "a:82", group: "grant", title: "무상 항목 3", fitVerdict: "unverified" }),
      mk({ id: "a:83", group: "grant", title: "무상 항목 4", fitVerdict: "unverified" }),
      mk({ id: "a:84", group: "grant", title: "무상 항목 5", fitVerdict: "unverified" }),
    ]);
    const 표시수 = (html: string): number => {
      const m = /표시 ([\d,]+)건/.exec(html);
      expect(m, "발치 「표시 N건」을 못 찾았다").not.toBeNull();
      return Number(m![1].replace(/,/g, ""));
    };

    const 접힘html = 그린다({ data: 다섯 });
    expect(표시수(접힘html), "접혀서 3줄만 그렸는데 5를 셌다").toBe(3);
    // 화면과 대조 — 발치가 말하는 수와 실제로 그려진 카드 줄 수가 같아야 한다
    expect((접힘html.match(/무상 항목 \d 자세히 보기/g) ?? []).length, "발치 수와 그려진 줄 수가 다르다").toBe(3);

    const 펼침html = 그린다({ data: 다섯, expanded: new Set<FundingGroup>(["grant"]) });
    expect(표시수(펼침html), "펼쳐서 5줄을 그렸는데 안 늘었다").toBe(5);
    expect((펼침html.match(/무상 항목 \d 자세히 보기/g) ?? []).length).toBe(5);

    // compact 는 3건 고정이라 접힘과 같다
    expect(표시수(그린다({ data: 다섯, compact: true })), "compact 가 그려진 수를 안 센다").toBe(3);
    // 펼친 갈래만 늘어난다 — 다른 갈래를 펼쳐도 grant 는 접힌 채다
    expect(표시수(그린다({ data: 다섯, expanded: new Set<FundingGroup>(["policy"]) })), "안 펼친 갈래가 늘었다").toBe(3);
  });

  /**
   * ★코덱스 반려 4(2026-09-05) — 새 props 두 개를 **필수**로 두면 이 부품을 직접 그리는 옛
   *  부르는 쪽이 그대로 깨진다. 선택값으로 두되, 손잡이가 없으면 「나머지 보기」 링크 자체를
   *  안 그린다 — 눌러도 아무 일 없는 죽은 링크를 그리는 것이 더 나쁘다.
   */
  it("⑩-d6 펼침 손잡이가 없으면 「나머지 보기」를 안 그린다 — props 는 선택값(반려 4)", () => {
    const 다섯 = 자료(
      [
        { ...항목8[0], id: "a:90", unclassified: true, title: "미확인 항목 A" },
        { ...항목8[0], id: "a:91", unclassified: true, title: "미확인 항목 B" },
        { ...항목8[0], id: "a:92", unclassified: true, title: "미확인 항목 C" },
        { ...항목8[0], id: "a:93", unclassified: true, title: "미확인 항목 D" },
        ...항목8.slice(1),
      ],
      { unclassified: 4 },
    );
    // 두 props 를 **아예 안 넘기고** 그린다(옛 부르는 쪽과 같은 모양)
    const 손잡이없음 = renderToStaticMarkup(
      <FundingMapView
        data={다섯}
        view="map"
        filters={기본거르개}
        sort="rec"
        expanded={new Set<FundingGroup>()}
        showExcluded={new Set<FundingGroup>()}
        selectedId=""
        compact={false}
        now={NOW}
        onOpen={() => {}}
        onView={() => {}}
        onFiltersChange={() => {}}
        onSortChange={() => {}}
        onToggleExpand={() => {}}
        onToggleExcluded={() => {}}
      />,
    );
    const 블록 = 미확인블록(손잡이없음);
    expect(블록, "손잡이가 없는데 죽은 링크를 그렸다").not.toContain("나머지 보기");
    // ★손잡이가 없으면 **접지도 않는다**(2차 반려 1) — 펼칠 길을 안 주면서 접으면 실려 온 줄을
    //  영영 못 보게 만든다. 옛 동작(다 그리기) 그대로다.
    const 줄수 = (블록: string) => (블록.match(/미확인 항목 [A-E] 자세히 보기/g) ?? []).length;
    expect(줄수(블록), "손잡이가 없는데 접어서 줄을 감췄다").toBe(4);
    expect(블록, "다 그렸는데 「중 …건만」이라 적었다").toContain("종류 미확인 4건 전부");

    // compact 만은 예외 — 좁은 레일은 손잡이가 없어도 3줄이다(자리가 없다)
    const 좁게 = renderToStaticMarkup(
      <FundingMapView
        data={다섯}
        view="map"
        filters={기본거르개}
        sort="rec"
        expanded={new Set<FundingGroup>()}
        showExcluded={new Set<FundingGroup>()}
        selectedId=""
        compact
        now={NOW}
        onOpen={() => {}}
        onView={() => {}}
        onFiltersChange={() => {}}
        onSortChange={() => {}}
        onToggleExpand={() => {}}
        onToggleExcluded={() => {}}
      />,
    );
    expect(줄수(미확인블록(좁게)), "compact 가 3줄 고정이 아니다").toBe(3);

    // 손잡이를 주면 접히고 링크가 돌아온다(같은 자료·같은 상태)
    const 손잡이있음 = 미확인블록(그린다({ data: 다섯 }));
    expect(손잡이있음, "손잡이를 줬는데 링크가 없다").toContain("나머지 보기");
    expect(줄수(손잡이있음), "손잡이를 줬는데 안 접혔다").toBe(3);
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


  /**
   * ★2026-09-04 승인 시안 ② — 정본 여백 계단은 4·6·8·16·24·32 이고 「카드 사이 16」이 기본이다.
   *  옛 값 12px(`gap-3`)·10px(`gap-2.5`)는 계단에 **없는 값**이었다. 세 자리만 바꾼다 —
   *  카드 **안쪽** 여백(`gap-2.5`)은 그대로다.
   */
  it("⑫ 세로 간격 — 덩어리·숫자 카드·갈래 카드 세 곳이 16px(gap-4)이다", () => {
    const html = 그린다();
    // 바깥 묶음은 **뿌리 요소**다 — 카드 보기 안쪽에도 `flex flex-col gap-3` 이 하나 더 있고
    // 그건 이번 승인 범위가 아니라, 문서 전체에서 없다고 재면 안 된다.
    expect(html.startsWith('<div class="flex flex-col gap-4">'), "바깥 묶음(덩어리 사이)").toBe(true);
    expect(html, "숫자 카드 그리드").toContain('class="grid gap-4 grid-cols-2');
    expect(html, "갈래 카드 그리드").toContain('class="grid gap-4 grid-cols-1 @min-[992px]:grid-cols-2');

    expect(html.startsWith('<div class="flex flex-col gap-3">'), "옛 덩어리 간격 12px 가 남았다").toBe(false);
    expect(html, "옛 숫자 카드 간격 10px 가 남았다").not.toContain('class="grid gap-2.5 grid-cols-2');
    expect(html, "옛 갈래 카드 간격 12px 가 남았다").not.toContain('class="grid gap-3 grid-cols-1 @min-[992px]:grid-cols-2');

    // 카드 **안쪽** 여백은 손대지 않았다 — 머리 카드 두 구역의 아이콘/글 사이가 그대로 10px
    expect(머리카드(html), "카드 안쪽 여백까지 건드렸다").toContain("gap-2.5");
  });

  /**
   * ★코덱스 13차 #3·#4 — 16px 규칙이 **두 자리에서만** 깨져 있었다.
   *  ⓐ 갈래 카드 격자와 「종류 미확인」 블록을 묶는 **바깥 상자**가 `gap-3` 로 남아, 화면 마지막
   *     경계에서만 12px 이었다. ⓑ 로딩 **뼈대** 격자도 `gap-3` 라, 자료가 도착하는 순간 칸 간격이
   *     4px 벌어져 열이 움직였다.
   */
  it("⑫-b 마지막 경계와 로딩 뼈대도 16px(gap-4)이다", () => {
    const html = 그린다();
    // ⓐ 카드 보기 안쪽 묶음 — 갈래 격자 바로 앞의 여는 태그를 잘라 본다
    const 안쪽 = 조각(html, 'class="grid gap-4 grid-cols-1 @min-[992px]:grid-cols-2', "<div");
    const 바깥 = 조각(html.slice(0, html.indexOf(안쪽)), "flex flex-col gap", "<div");
    expect(바깥, "갈래 격자·「종류 미확인」을 묶는 바깥 상자가 16px 이 아니다").toContain("flex flex-col gap-4");
    expect(html, "마지막 경계 12px 가 남았다").not.toContain('flex flex-col gap-3"><div class="grid gap-4 grid-cols-1');

    // ⓑ 로딩 뼈대 격자
    const 뼈대 = 지도({ data: null, loading: true });
    expect(뼈대, "뼈대가 실제 격자와 같은 16px 이 아니다").toContain('class="grid gap-4 grid-cols-1 @min-[992px]:grid-cols-2');
    expect(뼈대, "뼈대에 옛 12px 가 남았다").not.toContain('class="grid gap-3 grid-cols-1 @min-[992px]:grid-cols-2');
  });

  /**
   * ★2026-09-04 승인 시안 ③ — 조작줄 네 부품 높이가 알약 30 · 칩 26 · 셀렉트 42 · 단추 26 으로
   *  제각각이라 한 줄 안에서 서로 떠 보였다. 넷 다 정본 계단 `h-9`(36px)로 맞춘다.
   *  높이를 못 박았으니 글자는 `items-center` 로 **직접** 세로 가운데에 둔다(브라우저 기본 금지).
   */
  it("⑬ 조작줄 네 부품이 전부 h-9(36px)이고 글자가 세로 가운데다", () => {
    const html = 그린다({ onBrowseAll: () => {} });

    // ⓐ 알약 — 공용 부품 트랙에 className 이 합쳐진다(부품 파일은 안 고쳤다)
    const 알약 = 조각(html, "카드로 보기", "<div");
    expect(알약, "알약 트랙이 36px 이 아니다").toContain("h-9");
    // ★HTML 로 나갈 때 `&`·`>` 가 `&amp;`·`&gt;` 로 새어 적힌다 — 브라우저가 읽는 클래스 값은
    //  `[&>button]:…` 그대로다. 그려 낸 글자를 재는 시험이라 새어 적힌 모양으로 잰다.
    expect(알약, "안쪽 단추 글자가 브라우저 기본 정렬에 맡겨졌다").toContain(
      "[&amp;&gt;button]:inline-flex [&amp;&gt;button]:items-center",
    );
    expect(알약, "공용 부품 트랙 모양이 사라졌다").toContain("rounded-full bg-wedly-bg-sidebar");

    // ⓑ 칩 둘
    for (const key of ["openOnly", "soonOnly"]) {
      const 칩 = 조각(html, `data-chip="${key}"`, "<button");
      expect(칩, `${key} 칩이 36px 이 아니다`).toContain("h-9");
      expect(칩, `${key} 칩 글자가 세로 가운데가 아니다`).toContain("inline-flex h-9 items-center");
      expect(칩, `${key} 칩에 옛 py-1 이 남았다`).not.toContain("py-1");
    }

    // ⓒ 셀렉트 — 부품 **기본**은 그대로 두고 이 자리에서만 높이를 준다
    const 셀렉트 = 조각(html, 'id="funding-map-sort"', "<button");
    expect(셀렉트, "셀렉트가 36px 이 아니다").toContain("h-9");
    expect(셀렉트, "셀렉트 글자가 세로 가운데가 아니다").toContain("items-center");
    expect(셀렉트, "옛 42px 짜리 위아래 여백이 남았다").not.toContain("py-2.5");

    // ⓓ 「전체 공고 탐색」 단추 — 36px 은 **이 자리에서만** 준다(공유 상수 BTN_SM 은 26px 그대로).
    const 단추 = 조각(html, ">전체 공고 탐색<", "<button");
    expect(단추, "단추가 36px 이 아니다").toContain("h-9");
    expect(단추, "단추 글자가 세로 가운데가 아니다").toContain("items-center");

    // ⓔ 「정렬」 라벨도 36px 줄 안에서 세로 가운데
    const 라벨 = 조각(html, ">정렬<", "<label");
    expect(라벨, "정렬 라벨이 36px 줄에 안 맞는다").toContain("inline-flex min-h-9 items-center");
  });

  /**
   * ★코덱스 13차 #2 — 조작줄 단추 높이를 맞추려고 **공유 상수 `BTN_SM` 자체**를 26→36px 로
   *  키웠더니, 조작줄과 상관없는 갈래 카드 발치의 「안 맞아서 뺀 N건 보기」까지 커져
   *  **뺀 것이 있는 갈래 카드만** 발치가 10px 높아졌다(옆 카드와 아래 정렬이 어긋난다).
   *  상수는 26px(`py-1`)로 되돌리고 36px 은 조작줄 그 자리에서만 준다.
   */
  it("⑬-b 공유 상수 BTN_SM 은 26px 그대로 — 조작줄 밖 단추는 안 커진다", () => {
    const html = 그린다({ onBrowseAll: () => {} });

    // ⓐ 갈래 카드 발치의 「안 맞아서 뺀 N건 보기」 — 26px(py-1), h-9 아님
    const 뺀것단추 = 조각(html, "안 맞아서 뺀", "<button");
    expect(뺀것단추, "갈래 카드 단추가 26px(py-1)이 아니다").toContain("py-1");
    expect(뺀것단추, "공유 상수가 다시 36px 로 커졌다 — 옆 카드와 아래 정렬이 어긋난다").not.toContain("h-9");

    // ⓑ 빈 상태의 「칩 모두 풀기」도 같은 상수 — 함께 26px 이어야 한다
    const 빈상태 = 그린다({ data: 자료([]), filters: { ...기본거르개, openOnly: true } });
    const 풀기 = 조각(빈상태, ">칩 모두 풀기<", "<button");
    expect(풀기, "「칩 모두 풀기」가 26px 이 아니다").toContain("py-1");
    expect(풀기, "공유 상수가 다시 36px 로 커졌다").not.toContain("h-9");

    // ⓒ 오류의 「다시 시도」도 마찬가지
    const 다시 = 조각(지도({ data: null, error: "통로가 응답하지 않습니다", onRetry: () => {} }), ">다시 시도<", "<button");
    expect(다시, "「다시 시도」가 26px 이 아니다").toContain("py-1");
    expect(다시, "공유 상수가 다시 36px 로 커졌다").not.toContain("h-9");
  });

  /**
   * ★코덱스 13차 #1 — 오른쪽 회색 안내 문장을 지우면서 「뺀 공고가 있다」는 사실을 갈래 카드의
   *  단추에만 맡겼는데, **표 보기에는 갈래 카드가 안 그려진다.** 그래서 표에서는 뺀 공고가 있어도
   *  그 존재도, 여는 법도 알 수 없었다. 표 보기 전용 여는 손잡이를 조작줄에 둔다.
   *  ※ 「맞는 것만」 칩을 되살리는 게 아니다 — 이건 **여는** 한 방향 손잡이다.
   */
  it("⑭ 표 보기 — 뺀 것이 있을 때만 「안 맞는 공고도 보기」 손잡이가 뜬다", () => {
    // ⓐ 표 보기 + 뺀 것 있음(기본 자료의 grant 에 안 맞음 2건) → 칩 두 개 **오른쪽**에 뜬다
    const 표 = 그린다({ view: "table" });
    expect(표, "표 보기인데 여는 손잡이가 없다").toContain('data-excluded-toggle="table"');
    expect(표, "손잡이 문구").toContain("안 맞는 공고도 보기");
    expect(표.indexOf('data-excluded-toggle'), "손잡이가 칩 두 개 오른쪽이 아니다").toBeGreaterThan(
      표.indexOf('data-chip="soonOnly"'),
    );

    // ⓑ 모양은 칩과 같은 꼴 — 꺼짐은 CHIP_BASE, 켜짐은 CHIP_ON
    const 꺼짐 = 조각(표, 'data-excluded-toggle', "<button");
    expect(꺼짐, "칩과 같은 꼴이 아니다").toContain("inline-flex h-9 items-center rounded-full");
    expect(꺼짐, "꺼졌는데 켜진 모양이다").not.toContain("bg-wedly-bg-blue");
    expect(꺼짐).toContain('aria-pressed="false"');
    const 켜짐 = 조각(그린다({ view: "table", filters: { ...기본거르개, includeExcluded: true } }), 'data-excluded-toggle', "<button");
    expect(켜짐, "켜졌는데 CHIP_ON 이 안 붙었다").toContain("border-wedly-accent bg-wedly-bg-blue");
    expect(켜짐).toContain('aria-pressed="true"');

    // ⓒ 표 보기 + 뺀 것 0 → 아무것도 안 그린다(없는 일을 알리지 않는다)
    const 뺀것없음 = 자료(항목8.filter((it) => it.fitVerdict !== "excluded"));
    expect(그린다({ view: "table", data: 뺀것없음 }), "뺀 것이 0인데 손잡이가 떴다").not.toContain("data-excluded-toggle");
    expect(그린다({ view: "table", data: 뺀것없음 }), "뺀 것이 0인데 문구가 떴다").not.toContain("안 맞는 공고도 보기");

    // ⓓ 카드 보기에는 안 그린다 — 갈래마다 단추가 있어 같은 말이 두 번 된다
    expect(그린다({ view: "map" }), "카드 보기에도 손잡이가 그려졌다").not.toContain("data-excluded-toggle");
    expect(그린다({ view: "map" }), "카드 보기에도 문구가 그려졌다").not.toContain("안 맞는 공고도 보기");

    // ⓔ 누르면 includeExcluded 만 뒤집힌다(클릭은 못 재므로 손잡이가 부르는 순수 함수를 직접 본다)
    expect(nextFilters({ ...기본거르개, openOnly: true }, "includeExcluded")).toEqual({
      openOnly: true,
      soonOnly: false,
      includeExcluded: true,
    });
    expect(nextFilters({ ...기본거르개, includeExcluded: true }, "includeExcluded").includeExcluded).toBe(false);
  });

  /**
   * ★2026-09-04 승인 시안 ④ — 머리 카드 아래 구역이 「큰 제목 → 작은 설명」이라 위 구역
   *  (「작은 라벨 → 큰 값」)과 거꾸로였다. 아래 구역만 위 구역 차례로 맞춘다.
   *  줄 수는 그대로 **두 줄**이다 — 옛 본문 한 줄이 새 라벨로 접혔다.
   */
  it("⑭ 머리 카드 아래 구역이 「작은 라벨 → 큰 제목」 차례다 — 옛 본문 문장은 없다", () => {
    const 힌트 = gapParts(자료().profileGaps)!;
    const 카드 = 머리카드(그린다());

    const i라벨 = 카드.indexOf(힌트.label);
    const i제목 = 카드.indexOf(힌트.title);
    expect(i라벨, "라벨이 없다").toBeGreaterThan(-1);
    expect(i제목, "제목이 라벨보다 위에 있다(차례가 거꾸로다)").toBeGreaterThan(i라벨);

    // 라벨은 작고 옅게(hint·muted), 제목은 크고 굵게(sub·600·t1) — 위 구역과 같은 짝
    expect(카드).toContain(
      `<p class="min-w-0 break-keep text-wedly-hint text-wedly-muted">${힌트.label}</p>`,
    );
    expect(카드).toContain(
      `<p class="min-w-0 break-keep text-wedly-sub font-semibold text-wedly-t1">${힌트.title}</p>`,
    );

    // 옛 본문 한 줄은 사라졌다 — 카드가 세 줄로 길어지면 안 된다
    expect(카드, "옛 본문 문장이 남아 있다").not.toContain("입력하면 조건을 더 정확하게 맞춰 볼 수 있어요");
    expect(카드, "옛 본문 자리(hint·t2)가 남아 있다").not.toContain(
      'class="min-w-0 break-keep text-wedly-hint text-wedly-t2"',
    );
    // 아래 구역은 여전히 두 줄이다(금색 타일 뒤 <p> 가 정확히 둘)
    const 아래 = 카드.slice(카드.indexOf("bg-wedly-gold"));
    expect((아래.match(/<p /g) ?? []).length, "아래 구역 줄 수가 둘이 아니다").toBe(2);
  });

  /**
   * ★재설계 A안(2026-09-04 승인 시안) — 회색 띠 한 줄 + 금색 맨 글자 한 줄이 **흰 카드 하나**가 됐다.
   *  구역마다 아이콘 타일 1개와 굵기 600 한 줄을 두고, 사이를 구분선으로 가른다
   *  (「카드 안쪽도 위계」 자가 확인 ㉠㉡). 문장은 `profileBandParts`·`gapParts` 가 만들고
   *  이 화면은 그리기만 한다 — 그래서 시험도 글자를 손으로 베끼지 않고 두 함수를 그대로 부른다.
   */
  it("⑪ 머리 카드 — 판정 근거(라벨+값)와 빈칸 힌트(제목+본문)를 흰 카드 하나에 담는다(A안)", () => {
    const html = 그린다();
    const 이자료 = 자료();
    const 띠 = profileBandParts(이자료.usedProfile ?? []);
    const 힌트 = gapParts(이자료.profileGaps);
    expect(힌트, "이 시험 자료엔 빈 칸이 2개다").not.toBeNull();

    const 카드 = 머리카드(html);
    expect(카드, "라벨 줄").toContain(띠.label);
    expect(카드, "판정에 쓴 값").toContain(띠.value);
    expect(띠.value, "미리보기 시안과 같은 문장").toBe(
      "서울 · 음식점/카페 · 연매출 1.3억 · 2023년 1월 설립 · 개인사업자",
    );
    expect(카드, "빈칸 힌트 제목(할 일)").toContain(힌트!.title);
    expect(카드, "빈칸 힌트 라벨").toContain(힌트!.label);

    // 카드 골격 — 흰 바탕·테두리·둥근 모서리·층 그림자 + 두 구역을 가르는 선
    expect(카드).toContain("bg-white");
    expect(카드).toContain("border border-wedly-bd");
    expect(카드).toContain("rounded-xl");
    expect(카드).toContain("shadow-[0_1px_2px_rgba(10,34,68,0.05),0_6px_18px_rgba(10,34,68,0.08)]");
    expect(카드, "두 구역 사이 구분선").toContain("border-t border-wedly-bd/60");

    // 아이콘 타일 2개(파랑=판정 근거 · 금색=빈칸 힌트) — 아이콘 0개면 「카드 안쪽도 위계」 미달
    expect(카드).toContain("h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-wedly-accent");
    expect(카드).toContain("h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-wedly-gold");
    expect((카드.match(/<svg/g) ?? []).length, "구역마다 심볼 1개").toBe(2);
    // 금색 타일 심볼만 남색이다 — 금색 위 흰 글리프는 대비 2.1 미달
    expect(카드).toContain("text-wedly-navy");

    // 굵기 600 줄 2개(판정 값 · 힌트 제목) — 카드당 1개 이하면 미완
    expect((카드.match(/font-semibold/g) ?? []).length, "굵기 600 줄이 모자란다").toBe(2);

    // 옛 모양·옛 낱말은 안 남는다
    expect(카드, "옛 회색 띠 한 줄이 남아 있다").not.toContain("bg-wedly-bg-gray");
    expect(html, "옛 gapWords 문장").not.toContain("비어 있어 일부 조건은");
    expect(html, "옛 한 줄 띠 문장").not.toContain("이 사업장 정보로 판정");
    expect(html, "옛 「대조 기준」 문구").not.toContain("대조 기준");
    expect(html, "옛 「대조에 쓴 정보」 문구").not.toContain("대조에 쓴 정보");

    // ★코덱스 5차 #1 — 회사 정보가 통째로 빈 회사는 카드를 그린다(값이 「없음 — …」이라 라벨+값이 찬다).
    const 빈띠 = 그린다({ data: 자료(항목8, { usedProfile: [], profileGaps: [], profileEmpty: true }) });
    expect(빈띠, "쓸 정보 0개인데 머리 카드가 사라졌다").toContain(띠.label);
    expect(빈띠, "빈 칸이 없으니 「입력해 주세요」는 안 나온다").not.toContain("입력해 주세요");
  });

  /**
   * ★코덱스 5차 #1·#4(2026-09-04) — 「조건을 안 맞춰 봤다」는 사실을 **머리 카드 위 구역이** 말한다.
   *  예전엔 `usedProfile` 이 빈 배열이면 값이 빈 문자열이라 이 구역을 통째로 안 그렸고, 그래서
   *  ⓐ 조건을 하나도 안 맞춘 목록이 맞춤 추천처럼 보였고 ⓑ 손잡이만 덩그러니 남은 빈 구역이 생겼다.
   */
  it("⑪-d 회사 정보 자체가 비면 위 구역이 「조건을 맞춰 보지 않은 목록」이라고 말한다 — 빈 구역이 아니다", () => {
    const 없음 = profileBandParts([]);
    const 손잡이 = (
      <button type="button" data-probe="refresh">
        다시 추천
      </button>
    );
    const 카드 = 머리카드(
      그린다({ data: 자료(항목8, { usedProfile: [], profileEmpty: true }), headerAction: 손잡이 }),
    );

    expect(카드, "라벨 줄이 없다").toContain(없음.label);
    expect(카드, "값이 비어 구역이 안 그려졌다").toContain(없음.value);
    expect(없음.value).toBe("없음 — 조건을 맞춰 보지 않은 목록입니다");

    // ④ 단추만 있는 빈 구역이 아니다 — 라벨·값·손잡이가 한 구역에 함께 있고 차례도 그대로다
    const i라벨 = 카드.indexOf(없음.label);
    const i손잡이 = 카드.indexOf('data-probe="refresh"');
    const i값 = 카드.indexOf(없음.value);
    expect(i라벨, "라벨이 없다").toBeGreaterThan(-1);
    expect(i손잡이, "손잡이가 라벨보다 앞에 있다").toBeGreaterThan(i라벨);
    expect(i값, "값이 손잡이 위로 올라갔다").toBeGreaterThan(i손잡이);
    expect(카드, "손잡이만 오른쪽 끝에 둔 빈 구역이 남아 있다").not.toContain('class="flex justify-end p-3"');

    // 파랑 아이콘 타일·굵기 600 한 줄은 이 자리에서도 그대로다(「카드 안쪽도 위계」 ㉠㉡)
    expect(카드).toContain("h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-wedly-accent");
    expect((카드.match(/font-semibold/g) ?? []).length, "굵기 600 줄이 모자란다").toBeGreaterThanOrEqual(1);
  });

  /**
   * ★코덱스 3차 #C(2026-09-04) — 요약이 없어도(옛 통로) 회사 정보가 비었다는 사실은 확실히 알 수 있다.
   *  「요약이 없다」는 아무것도 말해 주지 않는다 — 단정의 근거는 `profileEmpty` 하나다.
   */
  it("⑪-e usedProfile 칸이 없어도 profileEmpty 가 거짓이면 판정 근거 구역을 안 그린다", () => {
    const 없는칸 = 자료(항목8, { profileGaps: [] });
    delete (없는칸 as { usedProfile?: string[] }).usedProfile;
    expect(없는칸.usedProfile, "이 시험은 칸이 아예 없는 자료를 잰다").toBeUndefined();
    expect(없는칸.profileEmpty, "이 회사는 정보가 있다").toBe(false);

    const html = 그린다({ data: 없는칸 });
    expect(html, "모르는 사실을 단정한다").not.toContain("조건을 맞춰 보지 않은 목록입니다");
    expect(html, "적을 것이 없는데 라벨만 남았다").not.toContain(profileBandParts([]).label);
    expect(html.indexOf('class="rounded-xl border border-wedly-bd bg-white'), "머리 카드가 통째로 안 그려져야 한다").toBe(-1);
    expect(html, "지도 자체는 그대로 그린다").toContain("안 갚아도 되는 돈");

    // 회사 정보가 통째로 비었으면 요약 칸이 없어도 라벨+「없음」을 그린다 — 그건 확실히 안다
    const 정보없음 = 자료(항목8, { profileGaps: [], profileEmpty: true });
    delete (정보없음 as { usedProfile?: string[] }).usedProfile;
    expect(그린다({ data: 정보없음 })).toContain("없음 — 조건을 맞춰 보지 않은 목록입니다");
  });

  /**
   * ★뿌리 원인(코덱스 3차 #3·#6) — `usedProfileSummary` 는 `companyScale`·`hasCert`·`hasPatent` 를
   *  요약하지 않는다. 그 셋만 채운 회사는 요약이 빈 배열인데, 그 자리에서 「조건을 맞춰 보지 않은
   *  목록」이라 말하면 거짓이다. 판정 엔진이 「견줘 봤다」를 기록하지 않으므로 그 반대도 단정 못 한다
   *  — 그래서 화면은 **아무 말도 하지 않는다**(띠도, 단정도 없다).
   */
  it("⑪-f 요약이 비었지만 회사 정보는 있으면 띠도 단정도 없다(3차 #C)", () => {
    const html = 그린다({ data: 자료(항목8, { usedProfile: [], profileGaps: [], profileEmpty: false }) });
    expect(html, "모르는데 「안 맞춰 봤다」고 말한다").not.toContain("조건을 맞춰 보지 않은 목록입니다");
    expect(html, "적을 것이 없는데 「없음」 라벨만 남았다").not.toContain(profileBandParts([]).label);
    expect(html, "지도는 그대로 그린다").toContain("안 갚아도 되는 돈");
  });

  it("⑪-g profileEmpty 가 응답에 없으면(옛 통로) 어느 쪽도 단정하지 않는다", () => {
    const 옛통로 = 자료(항목8, { usedProfile: [], profileGaps: [] });
    delete (옛통로 as { profileEmpty?: boolean }).profileEmpty;
    expect(옛통로.profileEmpty).toBeUndefined();

    const html = 그린다({ data: 옛통로 });
    expect(html, "모르는데 「안 맞춰 봤다」고 단정한다").not.toContain("조건을 맞춰 보지 않은 목록입니다");
    expect(html).not.toContain(profileBandParts([]).label);
  });

  /**
   * ★코덱스 3차 #A2(2026-09-04) — 서버·옛 앱이 JSON 으로 `"usedProfile": null` 을 보내면 예전엔
   *  `null.map` 에서 터져 **지도 화면 전체가 안 그려졌다**(빈 화면). `profileGaps` 도 같은 위험이었다.
   */
  it("⑪-h usedProfile·profileGaps 가 null 이어도 지도가 그려진다(3차 #A2)", () => {
    const 널자료 = 자료(항목8, {});
    (널자료 as unknown as Record<string, unknown>).usedProfile = null;
    (널자료 as unknown as Record<string, unknown>).profileGaps = null;

    let html = "";
    expect(() => {
      html = 그린다({ data: 널자료 });
    }, "null 하나에 화면 전체가 죽는다").not.toThrow();
    expect(html, "지도가 안 그려졌다").toContain("안 갚아도 되는 돈");
    expect(html, "모르는데 단정한다").not.toContain("조건을 맞춰 보지 않은 목록입니다");
    expect(html, "빈 칸이 뭔지 모르는데 입력하라고 시킨다").not.toContain("입력해 주세요");
  });

  /**
   * ★단추 하나가 한 줄을 통째로 쓰던 빈 줄을 없앤 자리(A안) — 손잡이는 라벨 줄 오른쪽 끝에 앉는다.
   *  그래서 「라벨 → 손잡이 → 값」 차례여야 하고, 손잡이가 없으면 아무것도 안 그려야 한다.
   */
  it("⑪-b headerAction 은 머리 카드 라벨 줄 오른쪽 끝에 앉는다 — 단추만 있는 빈 줄이 아니다(A안)", () => {
    const 카드 = 머리카드(
      그린다({
        headerAction: (
          <button type="button" data-probe="refresh">
            다시 추천
          </button>
        ),
      }),
    );
    const i라벨 = 카드.indexOf("판정에 쓴 정보");
    const i손잡이 = 카드.indexOf('data-probe="refresh"');
    const i값 = 카드.indexOf("서울 · 음식점/카페");
    expect(i손잡이, "손잡이가 머리 카드 안에 없다").toBeGreaterThan(-1);
    expect(i손잡이, "손잡이가 라벨보다 앞에 있다").toBeGreaterThan(i라벨);
    expect(i값, "손잡이가 값 줄 아래로 내려갔다 — 라벨과 같은 줄이어야 한다").toBeGreaterThan(i손잡이);
    expect(카드, "라벨과 손잡이를 양 끝으로 미는 줄이 없다").toContain("items-center justify-between");

    expect(머리카드(그린다()), "손잡이를 안 넘겼는데 뭔가 그려졌다").not.toContain("data-probe");
  });

  /**
   * ★금색은 아이콘 타일까지만 — 흰 바탕 위 금색 글자는 대비 2.0 미달이라 본문에 못 쓴다
   *  (상태 박스 v3 와 같은 규칙). 예전 빈칸 힌트는 `text-wedly-gold-ink` 맨 글자 한 줄이었다.
   */
  it("⑪-c 그려 낸 HTML 에 금색 글자 클래스가 0개다 — 금색은 타일까지만(A안)", () => {
    for (const html of [
      그린다(),
      그린다({ compact: true }),
      그린다({ data: 자료(항목8, { profileGaps: ["신용점수"] }) }),
      그린다({ data: 자료(항목8, { usedProfile: [], profileGaps: [] }) }),
      그린다({ view: "table" }),
      지도(),
    ]) {
      expect(html, "금색 글자 클래스가 남아 있다").not.toContain("text-wedly-gold");
    }
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

  /**
   * ★⑫-b 「가장 낮은 이자」 **값** — 2026-09-05 브라우저 재검사. 배포본 타일이 「연 0%」로 떴다.
   *  하한 미기재를 0 으로 저장한 은행 상품이 최솟값을 이긴 것이 뿌리이고(조립이 그 0 을 미상으로
   *  되돌렸다), 화면에는 **진짜 무이자**(0)를 「연 0%」가 아니라 「무이자」로 그리는 몫이 남는다.
   *  StatCard 는 라벨 바로 뒤에 값을 그리므로 그 한 칸만 떼어 재고 — 목록에 있는 다른 「연 N%」
   *  글자가 섞이지 않는다.
   */
  it("⑫-b 「가장 낮은 이자」 값 — 0 은 「무이자」·양수는 「연 N%」·없으면 「—」(2026-09-05 재검사)", () => {
    const 이자칸 = (minRate: number | null): string => {
      const html = 그린다({
        data: 자료(항목8, { glance: { open: 8, soon: 1, grantFit: 1, grantMaxWon: 5_000_000, minRate } }),
      });
      const m = html.match(/가장 낮은 이자<\/p><p[^>]*>([^<]*)</);
      expect(m, "타일 라벨 뒤 값 칸을 못 찾았다").not.toBeNull();
      return m![1];
    };
    expect(이자칸(0), "0 은 「모른다」가 아니라 무이자다 — 「연 0%」로 그리면 미기재가 무이자로 둔갑한다").toBe("무이자");
    expect(이자칸(0.8)).toBe("연 0.8%");
    expect(이자칸(null), "아는 이자가 없으면 0 으로 지어내지 않는다").toBe("—");
  });

  /**
   * ★독립 검사 지적 ⑥(2026-09-04 배포본 실측) — 뷰포트 1280 에서 상세창 레일 폭이 **480px** 인데
   *  갈래 카드 격자가 `sm:grid-cols-2`(뷰포트 640px)를 써서 그 레일 안에서도 2열이 켜졌다.
   *  줄임표로 잘린 글자가 **32곳**이고 전부 폭 89px 였다 — 「앞면에서 답 네 개를 읽는다」는
   *  이 개편의 목적이 무너졌다. 열 수를 **감싸는 상자의 실제 폭**(컨테이너)으로 옮긴다.
   *
   * ★이 시험이 잴 수 있는 것과 못 하는 것(정직하게):
   *  이 저장소엔 jsdom 이 없어 `renderToStaticMarkup` 이 뱉은 **글자**만 본다 — 실제 픽셀 폭은
   *  브라우저 QA 몫이다. 그래서 「89px 이 아니다」를 직접 재는 대신, **89px 를 만든 원인**을 잰다:
   *   ⓐ 맨 처음(가장 좁을 때)이 1열인가 ⓑ 2·3열이 **컨테이너** 문턱에만 걸려 있나
   *   ⓒ 뷰포트 문턱(`sm:`·`lg:` 류)이 격자에서 완전히 사라졌나 ⓓ 컨테이너 선언이 격자의 조상에 있나
   *  네 가지가 다 참이면 480px 레일에서 2열이 켜질 길이 없다(컨테이너 문턱 42rem = 672px > 480px).
   */
  it("⑮ 좁은 레일에서 1열 — 갈래 카드·답 네 개 열 수를 컨테이너가 정한다(지적 ⑥)", () => {
    const html = 그린다();
    const 격자 = 조각(html, 'class="grid gap-4 grid-cols-1', "<div");

    // ⓐ 가장 좁을 때는 1열 — 480px 레일이 여기 든다
    expect(격자, "가장 좁을 때가 1열이 아니다").toContain("grid-cols-1");

    // ⓑ 2·3열은 컨테이너 문턱(`@`)에만 걸려 있다 — 임의 값이라 문턱 숫자가 곧 폭이다(992·1496).
    //   그 두 숫자가 왜 992·1496 인지는 아래 「⑮-c 열 문턱 산수」 시험이 따로 잰다.
    expect(격자, "2열 컨테이너 문턱이 없다").toContain("@min-[992px]:grid-cols-2");
    expect(격자, "3열 컨테이너 문턱이 없다").toContain("@min-[1496px]:grid-cols-3");

    // ⓒ ★핵심 회귀 방어 — 뷰포트 문턱이 열 수를 정하는 자리에 **하나도** 없어야 한다.
    //   `sm:grid-cols-2` 가 되살아나면 480px 레일이 다시 2열이 되고 답이 89px 로 잘린다.
    expect(뷰포트열(격자), "갈래 격자가 뷰포트 문턱으로 되돌아갔다 — 480px 레일에서 다시 2열이 된다").toEqual([]);

    // ⓓ 컨테이너 선언은 격자의 **조상**에 있다 — 컨테이너는 자기 자신을 못 잰다
    expect(격자, "격자 자신에 @container 를 달면 자기 폭을 못 재 문턱이 영원히 안 켜진다").not.toContain("@container");
    const 조상 = 부모(html, 격자);
    expect(조상, "격자를 감싸는 상자에 @container 가 없다 — 문턱이 아무 때도 안 켜진다").toContain("@container");
    expect(조상, "「종류 미확인」까지 묶는 16px 상자가 아니다").toContain("flex flex-col gap-4");

    // ⓔ compact(좁은 상세창 레일)는 2열까지 — 레일에서 3열은 무조건 잘린다
    const 좁게 = 조각(그린다({ compact: true }), 'class="grid gap-4 grid-cols-1', "<div");
    expect(좁게, "compact 에 3열이 남았다").not.toContain("@min-[1496px]:grid-cols-3");
    expect(좁게, "compact 도 2열까지는 쓴다").toContain("@min-[992px]:grid-cols-2");

    // ⓕ 로딩 뼈대도 **같은 글자·같은 조상** — 안 그러면 자료가 도착하는 순간 열 수가 바뀐다
    const 뼈대 = 지도({ data: null, loading: true });
    const 뼈대격자 = 조각(뼈대, 'class="grid gap-4 grid-cols-1', "<div");
    expect(클래스(뼈대격자), "뼈대 열 규칙이 실제 격자와 다르다 — 자료가 도착할 때 열이 움직인다").toBe(클래스(격자));
    expect(부모(뼈대, 뼈대격자), "뼈대에 컨테이너 조상이 없다 — 뼈대만 영원히 1열이 된다").toContain("@container");
  });

  it("⑮-b 카드 안 「답 네 개」도 컨테이너 기준 — 좁으면 1열, 448px 넘으면 2열(지적 ⑥)", () => {
    const html = 그린다();
    const 답격자 = 조각(html, 'class="mt-2 grid grid-cols-1', "<dl");

    // ⓐ 좁을 때 1열 · 2열은 컨테이너 문턱(@md = 28rem = 448px)에만 걸려 있다
    expect(답격자, "가장 좁을 때가 1열이 아니다").toContain("grid-cols-1");
    expect(답격자, "2열 컨테이너 문턱이 없다").toContain("@md:grid-cols-2");
    expect(답격자, "여백이 바뀌었다").toContain("gap-x-3.5 gap-y-1.5");

    // ⓑ ★옛 모양 — 아무 문턱 없이 처음부터 2열이면 89px 이 그대로 돌아온다
    expect(html, "답 네 개가 문턱 없이 처음부터 2열이다").not.toContain('class="mt-2 grid grid-cols-2');
    expect(뷰포트열(답격자), "답 격자가 뷰포트 문턱을 쓴다 — 카드 폭이 아니라 창 폭으로 갈린다").toEqual([]);

    // ⓒ 컨테이너 선언은 **항목 카드**에 있다 — 답 격자의 가장 가까운 조상이어야 카드 폭을 잰다
    const 카드 = 항목카드(html);
    const 카드상자 = 조각(카드, "@container cursor-pointer", "<div");
    expect(카드상자, "항목 카드에 @container 가 없다 — 답 격자가 잴 상자가 없다").toContain("@container");
    expect(카드상자, "컨테이너가 항목 카드 상자가 아니다").toContain("rounded-[10px]");
    expect(카드, "답 격자가 이 카드 안에 없다").toContain(클래스(답격자));
    expect(카드.indexOf("@container"), "컨테이너가 답 격자보다 뒤에 열린다 — 조상이 아니다").toBeLessThan(
      카드.indexOf('class="mt-2 grid grid-cols-1'),
    );
    expect(답격자, "답 격자 자신에 @container 를 달면 자기 폭을 못 잰다").not.toContain("@container");

    // ⓓ 좁은 레일(compact)에서도 같은 규칙이다 — 「어느 앱·어느 자리」를 묻지 않는다
    expect(조각(그린다({ compact: true }), 'class="mt-2 grid grid-cols-1', "<dl")).toBe(답격자);
  });

  /**
   * ★2026-09-05 재검사 지적 1 — 열 문턱이 **답 네 개와 따로 놀았다**. 옛 값 `@2xl`(672)·`@7xl`(1280)은
   *  「갈래 카드가 이 정도면 두세 칸 놓을 만하다」는 눈대중이라, 창 1280~1347·1636~1851 에서
   *  갈래는 열이 늘고 그 안 답은 448px 을 못 채워 **세로로 쌓였다**. 열을 늘린 대가로 답이
   *  무너지는 폭 구간이 생긴 것이다.
   *
   *  그래서 문턱을 눈대중이 아니라 **산수**로 못 박는다:
   *    갈래 카드 폭 = (상자 − 열 사이 16px×(열−1)) / 열
   *    항목 안쪽    = 갈래 카드 − 40 (갈래 `p-2` 8×2 + 항목 `px-3` 12×2)
   *    답이 2열이려면 항목 안쪽 ≥ 448(FACT_GRID `@md`) → 상자 ≥ 열×(448+40) + 16×(열−1)
   *    2열: 2×488+16 = 992 · 3열: 3×488+32 = 1496
   *
   * ★이 시험은 **FACT_GRID 를 같이 본다** — 답 격자 문턱을 448 아닌 값으로 바꾸면 필요한 상자 폭이
   *  달라지므로 이 시험이 **함께 깨져야** 한다. 한쪽만 고치고 지나가면 지적 1 이 그대로 되살아난다.
   *
   * ★이 시험의 한계(정직하게): **실제 CSS 문턱은 조판 결과가 아니라 클래스 글자로 잰다** — 호스트가
   *  `@md` 계단 값이나 루트 글자 크기(rem)를 바꾸면 클래스 글자는 그대로라 이 시험이 못 잡는다.
   *  실제 조판은 2026-09-05 에 `tailwindcss` 4.2.1 `compile()` 로 따로 확인했다:
   *  `@md` = 28rem = 448px · `@min-[992px]` → `@container (width >= 992px)`.
   */
  it("⑮-c 갈래 열 문턱은 답 네 개(448px)가 2열을 지키는 최소 폭이다 — 992·1496(재검사 지적 1)", () => {
    const html = 그린다();

    // ⓐ 답 격자 문턱을 **화면에서** 읽는다 — 여기가 바뀌면 아래 산수의 입력이 바뀐다.
    const 답격자 = 클래스(조각(html, 'class="mt-2 grid grid-cols-1', "<dl"));
    expect(답격자, "답 격자 2열 문턱이 @md(28rem=448px)가 아니다 — 갈래 열 문턱 산수의 전제가 무너졌다")
      .toContain("@md:grid-cols-2");
    const 답2열문턱 = 448; // @md = 28rem = 448px (Tailwind v4 컨테이너 계단)

    // ⓑ 갈래 격자 문턱을 **화면에서** 읽는다 — 상수를 직접 부르지 않고 그려진 글자에서 뽑는다.
    const 갈래격자 = 클래스(조각(html, 'class="grid gap-4 grid-cols-1', "<div"));
    const 문턱: Record<number, number> = {};
    for (const m of 갈래격자.matchAll(/@min-\[(\d+)px\]:grid-cols-(\d)/g)) {
      문턱[Number(m[2])] = Number(m[1]);
    }
    expect(Object.keys(문턱).sort(), "2·3열 임의 값 문턱을 못 찾았다").toEqual(["2", "3"]);

    // ⓒ 산수 — 열 n 이 켜지려면 상자 ≥ n×(답2열문턱 + 40) + 16×(n−1)
    const 최소폭 = (열: number) => 열 * (답2열문턱 + 40) + 16 * (열 - 1);
    expect(최소폭(2), "2열 최소 폭 산수가 992 가 아니다").toBe(992);
    expect(최소폭(3), "3열 최소 폭 산수가 1496 이 아니다").toBe(1496);
    expect(문턱[2], "2열 문턱이 답을 2열로 지킬 만큼 넓지 않다 — 그 폭에서 답이 세로로 쌓인다")
      .toBeGreaterThanOrEqual(최소폭(2));
    expect(문턱[3], "3열 문턱이 답을 2열로 지킬 만큼 넓지 않다 — 그 폭에서 답이 세로로 쌓인다")
      .toBeGreaterThanOrEqual(최소폭(3));

    // ⓓ ★회귀 방어 — 옛 눈대중 값(672·1280)이 되살아나면 지적 1 의 폭 구간이 그대로 돌아온다.
    expect(갈래격자, "옛 2열 문턱 @2xl(672px)이 되살아났다").not.toContain("@2xl:grid-cols-2");
    expect(갈래격자, "옛 3열 문턱 @7xl(1280px)이 되살아났다").not.toContain("@7xl:grid-cols-3");
  });

  /**
   * ★2026-09-05 재검사 지적 3 — 「한눈에 네 칸」과 칩이 **서로 다른 말**을 했다. 칩
   *  「7일 안에 마감되는 것만」을 켜면 네 칸의 「안 갚아도 되는 돈 1,619건」은 그대로인데 100px 아래
   *  갈래 카드는 「90건」이 된다. 네 칸이 칩을 안 따르는 것은 **고의**이므로(앞선 지적으로 그렇게
   *  고쳤다) 숫자는 그대로 두고 **「그렇다」는 말만** 화면에 적는다(승인 시안 §3 A안).
   */
  it("⑰ 네 칸 위 캡션 「전체 자료 기준」 — 첫 타일보다 앞·같은 부모 안(재검사 지적 3)", () => {
    const html = 그린다();
    const 캡션 = '<p class="mb-2 break-keep text-wedly-hint text-wedly-muted">전체 자료 기준 — 아래 칩·정렬과 무관합니다</p>';
    expect(html, "네 칸 캡션이 없다").toContain(캡션);

    // ⓐ 차례 — 캡션이 네 칸 격자(그리고 첫 타일)보다 **앞**이다. 아래에 붙으면 각주로 읽힌다.
    const i캡션 = html.indexOf(캡션);
    const i격자 = html.indexOf('class="grid gap-4 grid-cols-2');
    const i첫타일 = html.indexOf("지금 신청 가능");
    expect(i격자, "네 칸 격자를 못 찾았다").toBeGreaterThan(-1);
    expect(i캡션, "캡션이 네 칸 격자보다 뒤에 있다").toBeLessThan(i격자);
    expect(i캡션, "캡션이 첫 타일보다 뒤에 있다").toBeLessThan(i첫타일);

    // ⓑ ★간격 — 뿌리가 `flex flex-col gap-4`(16px)라, 캡션을 낱개 칸으로 두면 `mb-2`(8px)가 그
    //   16px 위에 **더해져** 24px 이 된다(승인 시안은 8px). 그래서 「앞에 있다」로는 부족하고
    //   **같은 부모 안에** 있어야 한다 — 브라우저의 `캡션.parentElement === 격자.parentElement`
    //   와 같은 것을 마크업 위에서 잰다(위 `부모위치` 주석에 진짜 DOM 을 못 쓰는 이유).
    const i격자태그 = html.lastIndexOf("<div", i격자);
    const 캡션부모 = 부모위치(html, i캡션);
    const 격자부모 = 부모위치(html, i격자태그);
    expect(캡션부모, "캡션에 부모가 없다").toBeGreaterThan(-1);
    expect(캡션부모, "캡션과 네 칸의 부모가 다르다 — 8px 이 24px 이 된다").toBe(격자부모);
    // 그 공통 부모는 뿌리(`flex flex-col gap-4`)가 **아니어야** 한다 — 뿌리면 간격이 다시 더해진다
    expect(부모위치(html, 캡션부모), "캡션·네 칸을 묶는 상자가 없이 뿌리에 바로 붙었다").toBeGreaterThan(-1);
    const 묶는상자 = html.slice(캡션부모, html.indexOf(">", 캡션부모) + 1);
    expect(묶는상자, "묶는 상자가 스스로 간격을 만든다 — 8px 이 또 벌어진다").not.toContain("gap-");

    // ⓒ compact(좁은 상세창 레일)도 같은 줄 — 같은 부품이라 자동으로 따라온다
    expect(그린다({ compact: true }), "compact 레일에 캡션이 없다").toContain(캡션);
  });

  /**
   * ★독립 검사 지적 ④(2026-09-04) — 높이는 36px 로 맞췄는데 **글자 크기가 3종**이었다:
   *  알약 13/600 · 칩 11/400 · 셀렉트 14/400 · 「정렬」 라벨 11/400. 한 줄 안에서 크기가 다르면
   *  크기가 「중요도」를 거짓말한다. 조작줄 안 글자를 알약이 이미 쓰는 층(`text-wedly-sub` 13px)
   *  **하나로** 모은다 — 알약의 선택된 칸이 굵기 600 인 것은 그 부품의 **상태 표시**라 그대로 둔다.
   */
  it("⑯ 조작줄 글자가 한 층(13px)이다 — 굵기(상태 표시)는 그대로(지적 ④)", () => {
    for (const opt of [{ onBrowseAll: () => {} }, { onBrowseAll: () => {}, view: "table" as const }]) {
      const 줄 = 조작줄(그린다(opt));

      // ⓐ 이 줄에 나타나는 WEDLY 글자 층이 **정확히 한 종류**다
      const 층 = [...new Set(줄.match(/\btext-wedly-(?:page|section|value|sub|hint|label|tablehead)\b/g) ?? [])].sort();
      expect(층, "조작줄 글자 층이 하나가 아니다").toEqual(["text-wedly-sub"]);

      // ⓑ 정본 계단 밖의 옛 크기(text-sm 14px 등)도 남아 있지 않다
      expect(줄.match(/\btext-(?:xs|sm|base|lg|xl|2xl|3xl)\b/g) ?? [], "조작줄에 정본 밖 글자 크기가 남았다").toEqual([]);
    }

    const html = 그린다({ onBrowseAll: () => {} });

    // ⓒ 알약 — 선택된 칸만 굵기 600, 안 선택된 칸은 400. 크기는 둘 다 같은 층이다
    const 선택된칸 = 조각(html, ">카드로 보기<", "<button");
    const 안된칸 = 조각(html, ">표로 보기<", "<button");
    expect(선택된칸, "선택된 칸 층이 바뀌었다").toContain("text-wedly-sub");
    expect(선택된칸, "선택 상태 표시(굵기 600)가 사라졌다").toContain("font-semibold");
    expect(안된칸, "안 선택된 칸 층이 다르다").toContain("text-wedly-sub");
    expect(안된칸, "안 선택된 칸까지 굵어졌다 — 상태 표시가 뜻을 잃는다").not.toContain("font-semibold");
    // ★알약 **트랙**(공용 부품 겉 상자)에서 굵기를 덮어쓰면 안쪽 단추 클래스는 그대로인 채
    //  상태 표시만 죽는다 — 안쪽만 재면 이 조작을 못 잡는다(2026-09-04 망가뜨리기 시험에서 실제로
    //  한 번 놓쳤다). 그래서 트랙에 굵기 지정이 **하나도** 없는 것까지 잰다.
    const 알약트랙 = 조각(html, ">카드로 보기<", "<div");
    expect(알약트랙.match(/font-[\w!-]+/g) ?? [], "조작줄이 알약의 굵기를 덮어썼다 — 선택 상태 표시가 죽는다").toEqual([]);

    // ⓓ 자리마다 못 박기 — 어느 하나가 옛 크기로 돌아가면 여기서 걸린다
    for (const [이름, 표식, 태그] of [
      ["openOnly 칩", 'data-chip="openOnly"', "<button"],
      ["soonOnly 칩", 'data-chip="soonOnly"', "<button"],
      ["셀렉트", 'id="funding-map-sort"', "<button"],
      ["「정렬」 라벨", ">정렬<", "<label"],
      ["「전체 공고 탐색」", ">전체 공고 탐색<", "<button"],
    ] as const) {
      const 자리 = 조각(html, 표식, 태그);
      expect(자리, `${이름} 이 13px 층이 아니다`).toContain("text-wedly-sub");
      expect(자리, `${이름} 에 11px(text-wedly-hint)가 남았다`).not.toContain("text-wedly-hint");
      expect(자리, `${이름} 에 14px(text-sm)가 남았다`).not.toContain("text-sm");
    }
    const 손잡이 = 조각(그린다({ view: "table" }), "data-excluded-toggle", "<button");
    expect(손잡이, "표 보기 여는 손잡이가 13px 층이 아니다").toContain("text-wedly-sub");

    // ⓔ ★조작줄 **밖**은 안 건드렸다 — 11px 층은 카드 안·발 안내에 그대로 살아 있다
    expect(html, "11px 층이 화면에서 통째로 사라졌다 — 조작줄만 손보기로 했다").toContain("text-wedly-hint");
    expect(조각(html, "안 맞아서 뺀", "<button"), "조작줄 밖 단추 글자까지 커졌다").toContain("text-wedly-hint");
  });

  /**
   * ★독립 검사 지적 ⑦(2026-09-04) — 「안 맞는 공고도 보기 (4,962건)」을 눌러도 18줄만 늘었다.
   *  서버가 갈래마다 상위 몇 건만 싣기 때문인데, 단추는 4,962건을 **약속**하고 18줄을 줬다.
   *  지킬 수 없는 약속은 하지 않는다 — 손잡이 글자에서 건수를 뺀다.
   */
  it("⑰ 표 보기 여는 손잡이 글자에 숫자가 없다 — 갈래 카드의 진짜 전체 수는 그대로(지적 ⑦)", () => {
    const 표 = 그린다({ view: "table" });
    const i = 표.indexOf('data-excluded-toggle="table"');
    expect(i, "여는 손잡이가 없다").toBeGreaterThan(-1);
    // 손잡이 단추의 **글자만** 뽑는다(여는 태그 다음 `>` 부터 `</button>` 까지)
    const 열림닫힘 = 표.indexOf(">", i);
    const 글자 = 표.slice(열림닫힘 + 1, 표.indexOf("</button>", 열림닫힘));
    expect(글자.trim(), "손잡이 문구가 바뀌었다").toBe("안 맞는 공고도 보기");
    expect(/\d/.test(글자), `손잡이가 못 지킬 건수를 약속한다: ${글자}`).toBe(false);
    // 예전 문구(건수 괄호)가 어떤 자료에서도 안 돌아온다
    for (const opt of [
      { view: "table" as const },
      { view: "table" as const, filters: { ...기본거르개, includeExcluded: true } },
    ]) {
      expect(그린다(opt), "건수 괄호가 돌아왔다").not.toMatch(/안 맞는 공고도 보기 \(/);
    }

    // ★갈래 카드의 「안 맞아서 뺀 N건 보기」는 **그대로 둔다** — 그건 그 갈래의 진짜 전체 수이고,
    //  펼친 뒤 발치가 「N건 중 M건 표시」로 잘림을 정확히 말한다.
    const 카드단추 = 조각(그린다(), "안 맞아서 뺀", "<button");
    expect(카드단추, "갈래 카드 단추가 사라졌다").toContain("<button");
    expect(그린다(), "갈래 카드의 진짜 전체 수까지 지웠다").toContain("안 맞아서 뺀 2건 보기");
  });

  /**
   * ★독립 검사 지적 ③ 을 **화면에서** 못 박는다(통합 단계, 2026-09-04).
   *
   * 서버 쪽 셈은 `funding-map.test.ts`·`funding-map-build.test.ts` 가 이미 잰다. 여기서 재는 것은
   * 「그 셈이 카드 한 장에서 **세 자리 모두** 같은 말을 하는가」다 — 배포본에서 사람이 본 것은
   * 딱지 「181건」 + 본문 「지금 조건에 맞는 항목이 없습니다」 + 발치 「이 갈래 181건 중 0건만
   * 보여 드림」이 **한 카드에 동시에** 뜬 화면이었다. 세 자리가 서로 다른 목록을 세고 있었다.
   *
   * ★이 시험이 있어야 하는 이유(껍데기 방지): 시험 자료 도우미(`자료`)가 미확인까지 세던 동안
   *  이 파일 73개 시험은 **하나도** 그 어긋남을 안 잡았다(2026-09-04 통합 단계에서 실측 —
   *  도우미를 고쳐도 깨지는 시험이 0건이었다). 도우미가 옛 셈으로 되돌아가면 여기서 걸린다.
   */
  it("⑱ 미확인만 있는 갈래 — 딱지·본문·발치가 한 목소리로 0을 말한다(지적 ③ 통합)", () => {
    // grant 갈래의 정상 줄(a:1) 하나를 「종류 미확인」으로 만든다 → 그 갈래엔 카드에 남을 줄이 없다.
    const 자 = 자료([{ ...항목8[0], unclassified: true }, ...항목8.slice(1)], { unclassified: 1 });
    const grant = 자.groups.find((g) => g.group === "grant")!;

    // ⓐ 통로 모양부터 — 세는 칸은 0, 그러나 줄은 실려 있다(빼면 화면이 아예 못 그린다)
    expect(grant.total, "도우미가 옮겨 갈 줄을 세고 있다 — 서버는 그런 응답을 안 낸다").toBe(0);
    expect(grant.fit + grant.unverified, "세는 칸에 미확인이 남았다").toBe(0);
    expect(grant.items.map((x) => x.id), "옮겨 갈 줄이 items 에서 빠졌다").toEqual(["a:1"]);

    // ⓑ 화면 세 자리가 같은 말을 한다
    const 조각카드 = 카드(그린다({ data: 자 }), "grant");
    expect(조각카드, "딱지가 0건이 아니다").toContain(">0건<");
    expect(조각카드, "본문이 「없습니다」라고 말하지 않는다").toContain("지금 조건에 맞는 항목이 없습니다");
    expect(조각카드, "발치가 「없음」이라고 말하지 않는다").toContain("이 갈래에 지금 맞는 항목 없음");

    // ⓒ ★배포본에서 본 모순이 안 돌아온다 — 딱지에 수가 있는데 본문은 비어 있는 그 모양
    expect(조각카드, "딱지가 옮겨 간 줄을 세고 있다").not.toContain(">1건<");
    expect(조각카드, "발치가 옮겨 간 줄을 세고 있다 — 「N건 중 0건」이 그 버그의 모양이다").not.toMatch(
      /이 갈래 \d[\d,]*건 중 0건만 보여 드림/,
    );

    // ⓓ 줄이 사라진 것이 아니다 — 맨 아래 「종류 미확인」 블록으로 옮겨졌다
    const html = 그린다({ data: 자 });
    expect(html, "옮긴 줄이 어디에도 없다").toContain("스마트상점 기술보급사업 3차");
    expect(html.indexOf("스마트상점 기술보급사업 3차"), "옮긴 줄이 갈래 카드 안에 남았다").toBeGreaterThan(
      html.lastIndexOf('data-group="invest"'),
    );
  });
});

/**
 * P4 — 지도 카드 바닥 앱 조각(`renderCardFooter`). 랩(`wedly-policy-lab`)이 「이 판정은 맞음·틀림·
 * 애매」를 여기로 끼운다(승인 시안 344~393줄). ERP·일루아는 이 인자를 안 넘기므로 ★기존 시험
 * 전부가(위 describe 블록) 이 인자 없이 그대로 돈다는 사실 자체가 「인자 없을 때 불변」의 증거다.
 */
describe("자금 조달 지도 — renderCardFooter(카드 바닥 앱 조각)", () => {
  const 공고1 = mk({ id: "a:20", group: "grant", title: "renderCardFooter 공고 하나" });
  const 공고2 = mk({ id: "a:21", group: "policy", title: "renderCardFooter 공고 둘" });
  const 상품1 = mk({ id: "p:20", kind: "product", group: "guarantee", title: "renderCardFooter 상품 하나" });
  const 항목들 = [공고1, 공고2, 상품1];

  /** 제목의 aria-label 로 그 항목 카드의 <li>…</li> 만 잘라 낸다(`항목카드` 는 첫 카드만 잡는다). */
  const 카드셀 = (html: string, title: string): string => {
    const mark = `aria-label="${title} 자세히 보기"`;
    const i = html.indexOf(mark);
    expect(i, `${title} 카드를 못 찾았다`).toBeGreaterThan(-1);
    const 시작 = html.lastIndexOf("<li", i);
    const 끝 = html.indexOf("</li>", i);
    expect(시작, "카드의 <li> 가 없다").toBeGreaterThan(-1);
    expect(끝, "카드의 </li> 가 없다").toBeGreaterThan(시작);
    return html.slice(시작, 끝 + 5);
  };

  it("① 안 주면(undefined) 카드 바닥 마디가 하나도 안 늘어난다 — ERP·일루아 불변", () => {
    const html = 그린다({ data: 자료(항목들) });
    expect(html).not.toContain('data-card-footer="funding"');
    // 대조군 — 카드 자체는 여전히 그려진다(빈 자료라 통과하는 시험이 아니다).
    expect(html).toContain(공고1.title);
    expect(html).toContain(상품1.title);
  });

  it("② 공고 카드마다 한 번씩 불리고, 반환한 조각이 그 카드 안에 있다", () => {
    const 불린것: FundingItem[] = [];
    const html = 그린다({
      data: 자료(항목들),
      renderCardFooter: (item) => {
        불린것.push(item);
        return <span>판정피드백:{item.title}</span>;
      },
    });

    expect(불린것.map((it) => it.id).sort()).toEqual([공고1.id, 공고2.id].sort());

    const 공고1카드 = 카드셀(html, 공고1.title);
    expect(공고1카드).toContain('data-card-footer="funding"');
    expect(공고1카드).toContain(`판정피드백:${공고1.title}`);

    const 공고2카드 = 카드셀(html, 공고2.title);
    expect(공고2카드).toContain('data-card-footer="funding"');
    expect(공고2카드).toContain(`판정피드백:${공고2.title}`);
  });

  it("③ 상품 카드에는 안 불린다(0회) — refId 가 상품 id 라 공고 번호 자리에 못 넣는다(cardFooterOf)", () => {
    const 불린것: FundingItem[] = [];
    const html = 그린다({
      data: 자료(항목들),
      renderCardFooter: (item) => {
        불린것.push(item);
        return <span>판정피드백:{item.title}</span>;
      },
    });
    expect(불린것.some((it) => it.id === 상품1.id), "상품 카드에도 콜백이 불렸다").toBe(false);

    const 상품카드 = 카드셀(html, 상품1.title);
    expect(상품카드).not.toContain('data-card-footer="funding"');
    expect(상품카드).not.toContain("판정피드백");
  });

  it("④ 콜백이 null·undefined·false 를 돌려주면 바닥 마디 자체를 안 그린다 — 빈 점선 한 줄 방지", () => {
    for (const v of [null, undefined, false] as const) {
      const html = 그린다({ data: 자료(항목들), renderCardFooter: () => v });
      const 공고1카드 = 카드셀(html, 공고1.title);
      expect(공고1카드, `render 가 ${String(v)} 를 돌려줬는데도 바닥 마디가 생겼다`).not.toContain(
        'data-card-footer="funding"',
      );
    }
  });

  it("⑤ 표 보기(view=table)에는 절대 안 그린다 — 승인 시안의 단추는 카드 안에만 있다", () => {
    const html = 그린다({
      data: 자료(항목들),
      view: "table",
      renderCardFooter: () => <span>판정피드백</span>,
    });
    expect(html).not.toContain('data-card-footer="funding"');
    expect(html).not.toContain("판정피드백");
  });

  it("cardFooterOf 순수 함수 — render 없으면 공고여도 null, 상품엔 render 를 아예 안 부른다", () => {
    expect(cardFooterOf(공고1, undefined)).toBeNull();

    const render = vi.fn((it: FundingItem) => <span>{it.title}</span>);
    expect(cardFooterOf(상품1, render)).toBeNull();
    expect(render).not.toHaveBeenCalled();

    const node = cardFooterOf(공고1, render);
    expect(render).toHaveBeenCalledTimes(1);
    expect(render).toHaveBeenCalledWith(공고1);
    expect(node).not.toBeNull();
  });

  it("cardFooterOf 순수 함수 — render 가 null·undefined·false 를 돌려주면 한 가지 값(null)로 모은다", () => {
    expect(cardFooterOf(공고1, () => null)).toBeNull();
    expect(cardFooterOf(공고1, () => undefined)).toBeNull();
    expect(cardFooterOf(공고1, () => false)).toBeNull();
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
