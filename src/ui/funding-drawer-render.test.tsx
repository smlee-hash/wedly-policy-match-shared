import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import FundingDrawer, {
  isFocusVisible,
  isTileOverflowing,
  shouldShowExpandButton,
  tileValueClass,
} from "./FundingDrawer";
import { GROUP_TONE_TILE } from "./FundingMap";
import { FUNDING_GROUP_META, type FundingGroup } from "../funding/funding-group";
import {
  deadlineOfAnnouncement,
  deadlineOfProduct,
  deadlineWords,
  verdictWords,
  type FundingItem,
} from "../funding/funding-map";

/**
 * 서랍 전용 그려서 재는 시험(재설계 계약 §G3, 2026-09-04 시안 3) — 새 파일.
 *
 * ★기존 `funding-map-render.test.tsx`(G2 소유)의 서랍 시험은 옛 계약(라벨 「얼마/이자/언제까지/어디서」·
 *  `break-all`·기호 마크)을 잰다. 이 재설계로 그 시험들은 뜻이 어긋나 빨갛게 되는데, 그 파일은
 *  G3 가 손대지 않는다(계약 §G3 — 「깨지면 통합 단계가 고친다」). 이 새 파일이 새 계약의 정본 시험이다.
 *
 * 이 저장소엔 jsdom·@testing-library/react 가 없다(`funding-map-render.test.tsx` 실측 그대로) —
 * `renderToStaticMarkup` 로 그린 HTML 만 보고, 훅이 필요한 「눌러 본 뒤」 동작(초점·펼침)은
 * 순수 함수(`isFocusVisible`·`isTileOverflowing`·`shouldShowExpandButton`)를 직접 불러 잰다.
 */

const NOW = new Date("2026-09-04T10:00:00+09:00");
const 상시 = deadlineOfProduct("상시", NOW);

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
    deadline: 상시,
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

// 마감 3일 남음(2026-09-07) — deadlineWords 의 tone:"red" 를 만든다.
const 공고_무상 = mk({
  id: "a:1",
  group: "grant",
  title: "스마트상점 기술보급사업 3차",
  amountText: "도입비 최대 70% (상한 500만원)",
  amountMaxWon: 5_000_000,
  rateText: "무상",
  rateMin: null,
  deadline: deadlineOfAnnouncement(new Date("2026-09-07T23:59:59+09:00"), "2026-08-01 ~ 2026-09-07", NOW),
  fit: [
    { label: "지역 서울", verdict: "pass", note: "" },
    { label: "업종 제조업", verdict: "fail", note: "프로필은 도소매업" },
  ],
  fitVerdict: "excluded",
  humanCheck: 1,
  why: "업종 제조업 대상 아님",
});

// group:"bank" — 점 색이 GROUP_TONE_TILE.navy.dot(bg-wedly-navy) 뿐이라 Badge 5색과 안 겹친다.
const 상품_은행 = mk({
  id: "p:2",
  kind: "product",
  group: "bank",
  title: "케이뱅크 사장님 대출",
  agency: "케이뱅크",
  where: "케이뱅크 앱",
  amountText: "최대 3억원",
  amountMaxWon: 300_000_000,
  rateText: "연 4.2%",
  rateMin: 4.2,
  source: "product-kbank",
  fit: [{ label: "업종 요식업", verdict: "unknown", note: "업종 미입력" }],
  fitVerdict: "unverified",
});

const 공고_조건없음 = mk({
  id: "a:3",
  group: "policy",
  title: "관악구 하반기 중소기업육성자금",
  fit: [],
  fitVerdict: "unverified",
  humanCheck: 0,
});

const 상품_투자 = mk({
  id: "p:4",
  kind: "product",
  group: "invest",
  title: "TIPS (민간투자주도형 기술창업)",
  where: "창업진흥원",
  source: "product-tips",
  amountText: "최대 5억원",
  amountMaxWon: 500_000_000,
  rateText: "",
  rateMin: null,
  fit: [],
  fitVerdict: "unverified",
});

const 상품_손등록 = mk({
  id: "p:5",
  kind: "product",
  group: "guarantee",
  title: "서울시 안심통장 4호 (마이너스통장형)",
  where: "서울신용보증재단",
  source: "manual",
  targetText: "개인사업자 · 사업기간 3개월 이상",
});

const 서랍 = (item: FundingItem | null, onOpenDetail?: (id: string) => void): string =>
  renderToStaticMarkup(<FundingDrawer item={item} onClose={() => {}} onOpenDetail={onOpenDetail} now={NOW} />);

describe("자금 조달 지도 서랍(재설계 §G3) — 서랍 머리", () => {
  it("갈래 딱지(흰 칩+색 점)·종류(공고/상시 상품)·마감 딱지가 그려진다", () => {
    const html = 서랍(공고_무상);
    // 갈래 딱지 — 이름과 tone 점 색이 함께 있다(grant → green, 다른 요소와 안 겹치는 조합은 아래 은행 시험에서 확실히 잰다).
    expect(html).toContain(FUNDING_GROUP_META.grant.name);
    expect(html).toContain(GROUP_TONE_TILE.green.dot);
    // 종류 — 공고
    expect(html).toContain(">공고<");
    expect(html).not.toContain(">상시 상품<");
    // 마감 딱지 — deadlineWords 와 같은 글자, 3일 남음이라 tone:red
    const dead = deadlineWords(공고_무상.deadline, NOW);
    expect(dead.tone).toBe("red");
    expect(html).toContain(dead.chip);
    expect(html).toContain("text-wedly-red-ink");
  });

  it("상품은 종류가 「상시 상품」이고, 갈래 점 색이 다른 요소와 안 겹치는 navy(bank)로 확인된다", () => {
    const html = 서랍(상품_은행);
    expect(html).toContain(">상시 상품<");
    expect(html).not.toContain(">공고<");
    expect(html).toContain(FUNDING_GROUP_META.bank.name);
    // bank(navy) 점 색은 Badge 5색(blue/green/red/yellow/purple) 어디에도 없다 —
    // 이 값이 뜨면 반드시 갈래 딱지의 점이다(조건 딱지·판정 딱지와 안 헷갈린다).
    expect(GROUP_TONE_TILE.navy.dot).toBe("bg-wedly-navy");
    expect(html).toContain("bg-wedly-navy");
  });

  it("상시 접수(deadline kind:always)는 마감 딱지가 초록(tone:green)", () => {
    const html = 서랍(상품_은행); // 기본 deadline = 상시
    const dead = deadlineWords(상품_은행.deadline, NOW);
    expect(dead.tone).toBe("green");
    expect(html).toContain(dead.chip);
    expect(html).toContain("text-wedly-green-ink");
  });
});

describe("자금 조달 지도 서랍(재설계 §G3) — 답 네 개 타일", () => {
  it("얼마까지 · 이자 · 언제까지 · 어디에 신청 라벨로 답한다(대출류)", () => {
    const html = 서랍(상품_은행);
    for (const label of ["얼마까지", "이자", "언제까지", "어디에 신청"]) expect(html).toContain(label);
    expect(html, "옛 라벨은 남지 않는다").not.toContain(">얼마<");
    expect(html, "옛 라벨은 남지 않는다").not.toContain(">어디서<");
    expect(html).toContain("최대 3억원"); // amountWords
    expect(html).toContain("연 4.2%"); // repayWords(대출류).value = rateText
    expect(html).toContain("케이뱅크 앱"); // whereWords
  });

  it("grant 는 「갚아야 하나 — 안 갚아도 됨」으로 답한다(이자 낱말이 아니다)", () => {
    const html = 서랍(공고_무상);
    expect(html).toContain("갚아야 하나");
    expect(html).toContain("안 갚아도 됨");
    expect(html).not.toContain(">이자<");
  });

  it("invest 는 「갚아야 하나 — 지분으로 받음 (상환 없음)」으로 답한다", () => {
    const html = 서랍(상품_투자);
    expect(html).toContain("갚아야 하나");
    expect(html).toContain("지분으로 받음 (상환 없음)");
  });

  it("금액 원문이 없으면 「공고에 금액 없음」이라고 정직하게 말한다(원문 확인으로 얼버무리지 않는다)", () => {
    const html = 서랍({ ...공고_조건없음, amountText: "" });
    expect(html).toContain("공고에 금액 없음");
  });

  it("네 타일 모두 두 줄에서 끊고 전체는 title 로 읽는다(한 칸이 안 늘어난다)", () => {
    const 긴금액 = "사전기획 최대 3개월, 238만 원(정부지원비중 85%) / 구축지도 최대 6개월, 476만 원";
    const html = 서랍({ ...상품_은행, amountText: 긴금액 });
    const 타일들 = html.match(/<p class="[^"]*text-wedly-value[^"]*"[^>]*>/g) ?? [];
    expect(타일들.length, "얼마까지·이자·언제까지·어디에 신청 네 타일").toBe(4);
    for (const [i, 타일] of 타일들.entries()) {
      expect(타일, `${i + 1}번째 타일이 두 줄에서 안 끊긴다`).toContain("line-clamp-2");
      expect(타일, `${i + 1}번째 타일에 title 이 없다`).toContain("title=");
    }
    expect(html).toContain(`title="${긴금액}"`);
    expect(html).toContain('class="grid grid-cols-2 items-start gap-2 lg:grid-cols-4"');
  });

  it("정적 렌더(이펙트 없음)에서는 값이 길어도 「전체 보기」 단추가 없다", () => {
    const 긴한도 = "서민금융진흥원 창업자금 최대 7,000만원(운전자금 최대 2,000만원 포함) — 신용보증재단 특별보증 연계 상품";
    expect(서랍({ ...상품_은행, amountText: 긴한도 })).not.toContain("전체 보기");
  });
});

describe("자금 조달 지도 서랍(재설계 §G3) — tileValueClass(5차 독립 검사 지적 2)", () => {
  it("펼치면 break-keep + [overflow-wrap:anywhere](어절 유지, break-all 아님)", () => {
    expect(tileValueClass(true)).toContain("break-keep");
    expect(tileValueClass(true)).toContain("[overflow-wrap:anywhere]");
    expect(tileValueClass(true), "글자 중간에서 끊는 break-all 은 어절 규칙 위반").not.toContain("break-all");
  });

  it("접으면 예전과 같이 line-clamp-2 · break-keep", () => {
    expect(tileValueClass(false)).toContain("line-clamp-2");
    expect(tileValueClass(false)).toContain("break-keep");
    expect(tileValueClass(false)).not.toContain("overflow-wrap");
  });
});

describe("자금 조달 지도 서랍(재설계 §G3) — isFocusVisible(코덱스 10차 지적 3 잔여)", () => {
  it("키보드 초점(:focus-visible)이면 유지한다", () => {
    expect(isFocusVisible({ matches: (s) => s === ":focus-visible" })).toBe(true);
  });

  it("마우스 클릭 초점(:focus-visible 아님)이면 유지하지 않는다", () => {
    expect(isFocusVisible({ matches: () => false })).toBe(false);
  });

  it("구형 환경이라 못 재면(matches 예외) 예전처럼 유지한다", () => {
    expect(
      isFocusVisible({
        matches: () => {
          throw new Error(":focus-visible 미지원");
        },
      }),
    ).toBe(true);
  });
});

describe("자금 조달 지도 서랍(재설계 §G3) — 넘침·단추 규칙(변경 없음, 회귀 확인용)", () => {
  it("isTileOverflowing — 세로나 가로 중 하나라도 넘치면 넘친 것(오차 1px 방어)", () => {
    expect(isTileOverflowing({ scrollHeight: 48, clientHeight: 40, scrollWidth: 200, clientWidth: 200 })).toBe(true);
    expect(isTileOverflowing({ scrollHeight: 40, clientHeight: 40, scrollWidth: 200, clientWidth: 200 })).toBe(false);
    expect(isTileOverflowing({ scrollHeight: 41, clientHeight: 40, scrollWidth: 200, clientWidth: 200 })).toBe(false);
    expect(isTileOverflowing({ scrollHeight: 40, clientHeight: 40, scrollWidth: 320, clientWidth: 200 })).toBe(true);
  });

  it("shouldShowExpandButton — 펼쳤거나 지금 넘치거나 초점을 가지면 보인다", () => {
    expect(shouldShowExpandButton({ expanded: false, overflowing: false, focusHeld: false })).toBe(false);
    expect(shouldShowExpandButton({ expanded: false, overflowing: true, focusHeld: false })).toBe(true);
    expect(shouldShowExpandButton({ expanded: true, overflowing: false, focusHeld: false })).toBe(true);
    expect(shouldShowExpandButton({ expanded: false, overflowing: false, focusHeld: true })).toBe(true);
  });
});

describe("자금 조달 지도 서랍(재설계 §G3) — 조건 목록", () => {
  it("안내 문장 + 판정 줄(verdictWords) + 조건별 [딱지] label — note(기호 없음)", () => {
    const html = 서랍(공고_무상);
    expect(html).toContain("이 사업장 정보와 공고 조건을 하나씩 맞춰 본 결과");
    expect(html).toContain(verdictWords(공고_무상.fit));
    expect(html).toContain("맞음");
    expect(html).toContain("안 맞음");
    expect(html).toContain("업종 제조업 — 프로필은 도소매업"); // label — note
    expect(html).toContain("지역 서울");
    // 기호 금지
    for (const 기호 of ["✓", "✕"]) expect(html, `기호 ${기호} 가 남아 있다`).not.toContain(기호);
  });

  it("직접 확인(unknown) 조건은 「직접 확인」 낱말로 — ?, unknown 같은 내부값이 새지 않는다", () => {
    const html = 서랍(상품_은행);
    expect(html).toContain("직접 확인");
    expect(html).toContain("업종 요식업 — 업종 미입력");
  });

  it("조건이 0개면 목록 없이 verdictWords 의 안내 문장만 남는다", () => {
    const html = 서랍(공고_조건없음);
    expect(html).toContain(verdictWords([]));
    expect(html, "옛 대체 문구가 남지 않는다").not.toContain("기계로 읽은 조건이 없습니다");
  });

  it("사람이 직접 확인할 조건이 있으면 안내가 남는다", () => {
    const html = 서랍(공고_무상);
    expect(html).toContain("사람이 직접 확인할 조건 1건은 기계가 판정하지 않았습니다");
  });
});

describe("자금 조달 지도 서랍(재설계 §G3) — 낱말 규칙(기호·D-N·미분류·외 N곳 금지)", () => {
  it("D-N 표기가 없다", () => {
    const html = 서랍(공고_무상);
    expect(html).not.toMatch(/D-\d/);
  });

  it("「미분류」 낱말이 없다(unclassified 항목도)", () => {
    const html = 서랍({ ...공고_조건없음, unclassified: true });
    expect(html).not.toContain("미분류");
  });

  it("묶인 다른 수집원이 있어도 「외 N곳」이 아니라 「N곳에 더 게시」로 말한다", () => {
    const html = 서랍({ ...공고_무상, groupSources: 3, groupCount: 3, dedupKey: "묶음열쇠|서울" });
    expect(html).not.toMatch(/외 \d+곳/);
    expect(html).toContain("2곳에 더 게시");
  });

  it("raw Tailwind 색이 없다", () => {
    const html = 서랍({ ...상품_은행, groupCount: 3, groupSources: 2, dedupKey: "k" });
    expect(html).not.toMatch(
      /(bg|text|border|from|to)-(green|amber|red|sky|blue|indigo|violet|pink|gray|slate|zinc|orange|yellow|lime|emerald|teal|cyan|rose|fuchsia)-(50|100|200|300|400|500|600|700|800|900)/,
    );
  });
});

describe("자금 조달 지도 서랍(재설계 §G3) — 유지되는 기능(원문 링크·상세 열기·출처 이름)", () => {
  it("항목이 없으면 아무것도 안 그린다", () => {
    expect(서랍(null)).toBe("");
  });

  it("공고 서랍은 상세 화면을 품지 않고 「상세·AI 판정 열기」로 보낸다(손잡이가 있을 때만)", () => {
    const 손잡이있음 = 서랍(공고_무상, () => {});
    expect(손잡이있음).toContain("상세·AI 판정 열기");
    expect((손잡이있음.match(/이 사업장 정보와 공고 조건을 하나씩 맞춰 본 결과/g) ?? []).length).toBe(1);

    const 손잡이없음 = 서랍(공고_무상);
    expect(손잡이없음, "갈 곳이 없으면 단추를 그리지 않는다").not.toContain("상세·AI 판정 열기");
    expect(손잡이없음).toContain("전체 공고 탐색");
  });

  it("원문·신청처 링크는 새 창으로 연다", () => {
    const html = 서랍(공고_무상);
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noreferrer"');
    expect(html).toContain("원문 열기");
  });

  it("상품 서랍은 출처 이름표 · 대상 원문을 보여 준다(접두어 붙은 실제 출처 id)", () => {
    expect(서랍(상품_은행)).toContain("케이뱅크");
    expect(서랍(상품_투자), "product-tips").toContain("TIPS");
    expect(서랍(상품_손등록), "manual 은 접두어가 없다").toContain("손 등록 명부");
    expect(서랍(상품_손등록)).toContain("개인사업자 · 사업기간 3개월 이상"); // 대상 원문
    expect(서랍({ ...상품_은행, source: "product-새출처" }), "모르는 출처는 지어내지 않는다").toContain(
      "product-새출처",
    );
    expect(서랍(상품_은행, () => {}), "상품 서랍에는 공고용 단추가 없다").not.toContain("상세·AI 판정 열기");
  });

  it("묶인 공고가 2건 이상이면 「같은 공고 N건(수집원별)」 자리를 그린다", () => {
    const 묶인 = { ...공고_무상, groupCount: 3, groupSources: 2, dedupKey: "묶음열쇠|서울" };
    const html = 서랍(묶인, () => {});
    expect(html).toContain("같은 공고 3건");
    expect(html).toContain("수집원별");
    expect(html, "받기 전에는 불러오는 중이라고 말한다").toContain("불러오는 중");
    expect(서랍(공고_무상, () => {}), "안 묶였으면 자리 자체가 없다").not.toContain("같은 공고");
  });
});
