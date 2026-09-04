import { describe, expect, it } from "vitest";
import {
  amountWords,
  applyFilters,
  conditionVerdictWord,
  deadlineLabel,
  deadlineOfAnnouncement,
  deadlineOfProduct,
  deadlineWords,
  fitsOf,
  formatWon,
  gapParts,
  gapWords,
  glanceOf,
  groupBlocks,
  groupFooterWords,
  GROUP_TOP_N,
  isOpen,
  isSoon,
  normalizeAmountUnits,
  profileBandParts,
  profileBandWords,
  repayWords,
  sortItems,
  splitByFit,
  verdictWords,
  whereWords,
  whyOf,
  type FundingDeadline,
  type FundingFit,
  type FundingGroupBlock,
  type FundingItem,
} from "./funding-map";
import { FUNDING_GROUPS } from "./funding-group";
import type { ConditionCheck, ConditionVerdict, StructuredCondition } from "../engine/structure-types";

/** 기준 시각 = 한국시간 2026-09-03 10:00. 시험이 도는 컴퓨터의 시간대와 무관하게 같은 값이어야 한다. */
const NOW = new Date("2026-09-03T10:00:00+09:00");
/** 공고 마감일은 저장 때 한국시간 그날 23:59:59 로 들어온다(types.ts kstDay). */
const kstEnd = (ymd: string) => new Date(`${ymd}T23:59:59+09:00`);

const ALWAYS = deadlineOfProduct("상시", NOW);

function mkItem(over: Partial<FundingItem> = {}): FundingItem {
  return {
    id: "a:1",
    kind: "announcement",
    refId: "1",
    group: "grant",
    title: "예시 공고",
    agency: "중소벤처기업부",
    url: "https://example.kr/a/1",
    applyUrl: "",
    targetText: "",
    amountText: "",
    amountMaxWon: null,
    rateText: "",
    rateMin: null,
    deadline: ALWAYS,
    where: "중소벤처기업부",
    fit: [],
    fitVerdict: "unverified",
    humanCheck: 0,
    score: 50,
    why: "",
    source: "bizinfo",
    isNew: false,
    ...over,
  };
}

function mkCheck(
  key: StructuredCondition["key"],
  rawText: string,
  verdict: ConditionVerdict,
  note = "",
): ConditionCheck {
  return {
    condition: { key, op: "in", value: ["서울"], rawText, machineReadable: true },
    verdict,
    note,
  };
}

describe("마감 라벨 — 승인 미리보기 deadLabel 과 같은 글자", () => {
  it("오늘 마감·D-3·D-30 — 7일 안쪽만 임박(soon)", () => {
    const today = deadlineOfAnnouncement(kstEnd("2026-09-03"), "2026-09-01 ~ 2026-09-03", NOW);
    expect(today.kind).toBe("date");
    expect(today.dDay).toBe(0);
    expect(today.date).toBe("2026-09-03");
    expect(deadlineLabel(today)).toEqual({ text: "오늘 마감", tone: "soon" });

    const d3 = deadlineOfAnnouncement(kstEnd("2026-09-06"), "", NOW);
    expect(d3.dDay).toBe(3);
    expect(deadlineLabel(d3)).toEqual({ text: "D-3", tone: "soon" });

    const d30 = deadlineOfAnnouncement(kstEnd("2026-10-03"), "", NOW);
    expect(d30.dDay).toBe(30);
    expect(deadlineLabel(d30)).toEqual({ text: "D-30", tone: "plain" });
  });

  it("마감 지남 — 지난 날짜는 임박이 아니라 「마감 지남」이고 신청 가능이 아니다", () => {
    const past = deadlineOfAnnouncement(kstEnd("2026-09-01"), "", NOW);
    expect(past.dDay).toBe(-2);
    expect(deadlineLabel(past)).toEqual({ text: "마감 지남", tone: "plain" });
    expect(isOpen(mkItem({ deadline: past }))).toBe(false);
    expect(isSoon(mkItem({ deadline: past }))).toBe(false);
  });

  it("상시 — 상품은 마감 글자가 없으면 상시(공고는 다르다 — 「기간 미기재」 아래 참고, G3②)", () => {
    expect(deadlineOfProduct("상시", NOW).kind).toBe("always");
    expect(deadlineOfProduct("", NOW).kind).toBe("always");
    expect(deadlineLabel(deadlineOfProduct("", NOW))).toEqual({ text: "상시", tone: "always" });
  });

  it("기간 미기재 — 공고는 마감일도 기간 원문도 없으면 상시가 아니라 정직하게 「기간 미기재」로 적는다(G3② — 2026-09-03 코덱스 지적)", () => {
    const noInfo = deadlineOfAnnouncement(null, "", NOW);
    expect(noInfo.kind).toBe("unknown");
    expect(noInfo.date).toBeNull();
    expect(noInfo.dDay).toBeNull();
    expect(noInfo.text).toBe("기간 미기재");
    expect(deadlineLabel(noInfo)).toEqual({ text: "기간 미기재", tone: "plain" });
  });

  it("기간 미기재라도 접수중(status open)인 공고는 신청 가능으로 센다 — 정보가 없다고 지도에서 숨기지 않는다", () => {
    const noInfo = deadlineOfAnnouncement(null, "", NOW);
    expect(isOpen(mkItem({ deadline: noInfo }))).toBe(true);
    expect(isSoon(mkItem({ deadline: noInfo }))).toBe(false); // 언제 마감인지 몰라 임박이라 말할 수 없다
  });

  it("예산 소진 — 공고 기간 원문·상품 글자 둘 다 budget, 딱지 글자는 「예산 소진 시」", () => {
    const fromPeriod = deadlineOfAnnouncement(null, "2026-08-28 ~ 예산 소진 시", NOW);
    expect(fromPeriod.kind).toBe("budget");
    expect(fromPeriod.text).toBe("2026-08-28 ~ 예산 소진 시");
    expect(deadlineLabel(fromPeriod)).toEqual({ text: "예산 소진 시", tone: "always" });
    expect(deadlineOfProduct("예산 소진시까지", NOW).kind).toBe("budget");
    // 「상시 접수」와 「예산 소진 시 마감」이 같이 적힌 원문은 좁은 뜻(예산 소진)이 이긴다 —
    // 상시로 뭉개면 예산이 바닥난 사업을 「아무 때나 신청 가능」으로 보여 준다.
    expect(deadlineOfAnnouncement(null, "상시 접수(예산 소진 시 마감)", NOW).kind).toBe("budget");
    expect(deadlineOfProduct("상시 · 예산 소진 시 종료", NOW).kind).toBe("budget");
    expect(isOpen(mkItem({ deadline: fromPeriod }))).toBe(true);
  });

  it("남은 날짜는 시각 차이가 아니라 한국 달력 날짜 차이 — 밤에 봐도 딱지가 안 바뀐다", () => {
    // 마감일이 그날 00:00 으로 들어온 자료(출처마다 다르다): 시각으로 빼면 D-2 가 되어 하루가 사라진다.
    const midnight = deadlineOfAnnouncement(new Date("2026-09-06T00:00:00+09:00"), "", NOW);
    expect(midnight.dDay).toBe(3);
    // 밤 23:30 에 본 「내일 마감」은 0.5시간 뒤가 아니라 D-1 이다.
    const lateNight = new Date("2026-09-03T23:30:00+09:00");
    expect(deadlineOfAnnouncement(new Date("2026-09-04T00:00:00+09:00"), "", lateNight).dDay).toBe(1);
    // 한국시간 오전 8시 = 세계표준시로는 전날 밤 — 달력을 UTC 로 재면 오늘 마감이 D-1 로 밀린다.
    const kstMorning = new Date("2026-09-03T08:00:00+09:00");
    const today = deadlineOfAnnouncement(kstEnd("2026-09-03"), "", kstMorning);
    expect(today.dDay).toBe(0);
    expect(today.date).toBe("2026-09-03");
    expect(deadlineLabel(today).text).toBe("오늘 마감");
  });

  it("접수 예정(upcoming) 판정 — applyStart 가 now 보다 뒤면 올림 일수로 dDay 를 잡는다", () => {
    // NOW=2026-09-03 10:00, applyStart=2026-09-05 13:00 → 51시간(2일+3시간) 뒤 → 올림 3일
    const applyStart = new Date("2026-09-05T13:00:00+09:00");
    const upcoming = deadlineOfAnnouncement(null, "", NOW, applyStart);
    expect(upcoming.kind).toBe("upcoming");
    expect(upcoming.dDay).toBe(3);
    expect(upcoming.date).toBe(applyStart.toISOString());
    expect(upcoming.text).toBe("3일 뒤 접수");
  });

  it("접수 예정 라벨 — 「N일 뒤 접수」, tone 은 plain(soon 이 아니다)", () => {
    const applyStart = new Date("2026-09-05T13:00:00+09:00");
    const upcoming = deadlineOfAnnouncement(null, "", NOW, applyStart);
    expect(deadlineLabel(upcoming)).toEqual({ text: "3일 뒤 접수", tone: "plain" });
  });

  it("접수 예정 — isOpen·isSoon 은 둘 다 false(아직 시작 전이라 신청도 임박도 아니다)", () => {
    // NOW+26시간(올림 2일) — 임박(soon) 범위(0~7일) 안이어도 예정은 soon 이 아니다
    const applyStart = new Date("2026-09-04T12:00:00+09:00");
    const upcoming = deadlineOfAnnouncement(null, "", NOW, applyStart);
    expect(upcoming.dDay).toBe(2);
    expect(isOpen(mkItem({ deadline: upcoming }))).toBe(false);
    expect(isSoon(mkItem({ deadline: upcoming }))).toBe(false);
  });

  it("상품 글자 — YYYY-MM-DD 는 날짜, 마감·종료는 closed, 그 밖은 글자 그대로", () => {
    const dated = deadlineOfProduct("2026-09-10", NOW);
    expect(dated.kind).toBe("date");
    expect(dated.date).toBe("2026-09-10");
    expect(dated.dDay).toBe(7);
    expect(deadlineLabel(dated)).toEqual({ text: "D-7", tone: "soon" });

    const closed = deadlineOfProduct("접수 마감", NOW);
    expect(closed.kind).toBe("closed");
    expect(deadlineLabel(closed).text).toBe("마감 지남");
    expect(isOpen(mkItem({ deadline: closed }))).toBe(false);

    const text = deadlineOfProduct("운영사 추천 후 신청", NOW);
    expect(text.kind).toBe("text");
    expect(deadlineLabel(text)).toEqual({ text: "운영사 추천 후 신청", tone: "plain" });
    expect(isOpen(mkItem({ deadline: text }))).toBe(true);
  });
});

describe("fitsOf — 라벨은 「조건 이름 + 원문 앞 18자」(같은 원문을 쓰는 조건이 둘이어도 구분된다)", () => {
  it("조건 이름을 앞에 붙이고 원문은 18자에서 자른다", () => {
    const fits = fitsOf([
      mkCheck("region", "서울특별시에 사업장을 둔 중소기업 및 소상공인", "pass", "프로필 지역과 일치"),
      mkCheck("industry", "제조업", "unknown"),
    ]);
    expect(fits[0].label).toBe("지역 서울특별시에 사업장을 둔 중소기업…");
    expect(fits[0].verdict).toBe("pass");
    expect(fits[0].note).toBe("프로필 지역과 일치");
    expect(fits[1].label).toBe("업종 제조업");
    expect(fits[1].note).toBe("");
  });
});

describe("whyOf — 한 줄 이유", () => {
  it("불일치가 있으면 첫 불일치를 「~라 대상 아님」으로", () => {
    const fits = fitsOf([mkCheck("region", "서울", "fail"), mkCheck("industry", "제조업", "unknown")]);
    expect(whyOf(fits, 0)).toBe("지역 서울이라 대상 아님");
  });
  it("불일치가 없고 확인 필요가 있으면 첫 확인 필요를", () => {
    const fits = fitsOf([mkCheck("region", "서울", "pass"), mkCheck("industry", "제조업", "unknown")]);
    expect(whyOf(fits, 0)).toBe("업종 제조업 확인 필요");
  });
  it("전부 맞으면 개수를, 사람이 직접 볼 조건은 뒤에 덧붙인다", () => {
    const fits = fitsOf([mkCheck("region", "서울", "pass"), mkCheck("industry", "제조업", "pass")]);
    expect(whyOf(fits, 0)).toBe("입력한 조건 2개 모두 맞음");
    expect(whyOf(fits, 3)).toBe("입력한 조건 2개 모두 맞음 · 직접 확인 조건 3건");
  });
  it("기계로 읽은 조건이 하나도 없으면 「모두 맞음」이라고 말하지 않는다", () => {
    expect(whyOf([], 0)).not.toContain("모두 맞음");
    expect(whyOf([], 2)).toContain("직접 확인 조건 2건");
  });
});

describe("정렬 4종", () => {
  const A = mkItem({
    id: "A",
    fitVerdict: "fit",
    score: 80,
    deadline: deadlineOfAnnouncement(kstEnd("2026-09-13"), "", NOW),
    amountMaxWon: 100_000_000,
    rateMin: null,
  });
  const B = mkItem({
    id: "B",
    fitVerdict: "fit",
    score: 65,
    deadline: deadlineOfAnnouncement(kstEnd("2026-09-05"), "", NOW),
    amountMaxWon: null,
    rateMin: 2.5,
  });
  const C = mkItem({ id: "C", fitVerdict: "unverified", score: 50, deadline: ALWAYS, amountMaxWon: 50_000_000, rateMin: 3 });
  const D = mkItem({
    id: "D",
    fitVerdict: "excluded",
    score: 10,
    deadline: deadlineOfAnnouncement(kstEnd("2026-09-04"), "", NOW),
    amountMaxWon: 300_000_000,
    rateMin: null,
  });
  const E = mkItem({ id: "E", fitVerdict: "fit", score: 90, deadline: deadlineOfAnnouncement(kstEnd("2026-09-01"), "", NOW) });
  const ids = (list: FundingItem[]) => list.map((x) => x.id);

  it("추천 — 맞음(fit) → 확인 필요 → 안 맞음 순, 같은 칸 안에서는 점수 높은 순", () => {
    expect(ids(sortItems([D, C, B, A, E], "rec"))).toEqual(["E", "A", "B", "C", "D"]);
  });
  it("추천 — 조건 판정이 점수를 이긴다: 점수 99 짜리 안 맞음이 점수 10 짜리 맞음보다 뒤", () => {
    const lowFit = mkItem({ id: "lowFit", fitVerdict: "fit", score: 10 });
    const highUnverified = mkItem({ id: "highUnverified", fitVerdict: "unverified", score: 95 });
    const highExcluded = mkItem({ id: "highExcluded", fitVerdict: "excluded", score: 99 });
    expect(ids(sortItems([highExcluded, highUnverified, lowFit], "rec"))).toEqual([
      "lowFit",
      "highUnverified",
      "highExcluded",
    ]);
  });
  it("추천 — 맞음도 점수도 같으면 마감 빠른 순, 상시는 뒤, 마감 지남은 맨 뒤", () => {
    const near = mkItem({ id: "near", fitVerdict: "fit", score: 50, deadline: deadlineOfAnnouncement(kstEnd("2026-09-04"), "", NOW) });
    const far = mkItem({ id: "far", fitVerdict: "fit", score: 50, deadline: deadlineOfAnnouncement(kstEnd("2026-10-04"), "", NOW) });
    const always = mkItem({ id: "always", fitVerdict: "fit", score: 50, deadline: ALWAYS });
    const past = mkItem({ id: "past", fitVerdict: "fit", score: 50, deadline: deadlineOfAnnouncement(kstEnd("2026-09-01"), "", NOW) });
    expect(ids(sortItems([always, past, far, near], "rec"))).toEqual(["near", "far", "always", "past"]);
  });
  it("마감 — 가까운 순, 상시는 뒤, 마감 지남은 맨 뒤", () => {
    expect(ids(sortItems([A, B, C, D, E], "dead"))).toEqual(["D", "B", "A", "C", "E"]);
  });
  it("이자 — 낮은 순, 모르는 것(null)은 뒤", () => {
    expect(ids(sortItems([A, B, C, D], "rate"))).toEqual(["B", "C", "A", "D"]);
  });
  it("한도 — 큰 순, 모르는 것(null)은 뒤", () => {
    expect(ids(sortItems([A, B, C, D], "amt"))).toEqual(["D", "A", "C", "B"]);
  });
  it("원본 배열을 건드리지 않는다", () => {
    const src = [D, C, B, A];
    sortItems(src, "rec");
    expect(ids(src)).toEqual(["D", "C", "B", "A"]);
  });
});

/**
 * ★재설계 계약 G1①(2026-09-04) — `fitOnly`(맞는 것만)를 없애고 `includeExcluded` 로 바꿨다.
 *  예전엔 기본이 「전부 보여주고, fitOnly 를 켜야 좁아진다」였는데, 새 기본은 거꾸로다 —
 *  **안 맞음(excluded)은 기본으로 숨고**, `includeExcluded:true` 를 켜야 다시 보인다.
 *  「맞는 것만」(fit 만 남기고 unverified 까지 빼는) 좁히기는 화면에서 아예 없어졌다(G2 — 칩 삭제).
 *
 * ★뜻이 바뀐 시험(코덱스 11차 #2·#4, 2026-09-04) — `applyFilters` 는 이제 **언제나** 안 맞음을
 *  뺀다. `includeExcluded` 는 「같은 목록에 안 맞음을 섞어 돌려준다」가 아니라 「갈래마다 안 맞음
 *  풀을 `excludedItems` 로 따로 실어 준다」는 뜻이 됐다(그래서 topN·중복 제거·집계가 안 흔들린다).
 *  섞어 돌려주던 예전 시험(「includeExcluded=true 면 안 맞음도 되살아나 전부 남는다」)은
 *  `splitByFit` 시험으로 바꿨다 — 두 풀로 나뉘는 것을 값으로 확인한다.
 */
describe("필터 — openOnly·soonOnly·includeExcluded(재설계 계약 G1①, fitOnly 폐지)", () => {
  const open = mkItem({ id: "open", deadline: deadlineOfAnnouncement(kstEnd("2026-09-20"), "", NOW) });
  const soon = mkItem({ id: "soon", deadline: deadlineOfAnnouncement(kstEnd("2026-09-05"), "", NOW) });
  const always = mkItem({ id: "always", deadline: ALWAYS });
  const past = mkItem({ id: "past", deadline: deadlineOfAnnouncement(kstEnd("2026-08-30"), "", NOW) });
  const excluded = mkItem({ id: "excluded", fitVerdict: "excluded", deadline: ALWAYS });
  const unverified = mkItem({ id: "unverified", fitVerdict: "unverified", deadline: ALWAYS });
  const all = [open, soon, always, past, excluded, unverified];
  const ids = (list: FundingItem[]) => list.map((x) => x.id);
  const NONE = { openOnly: false, soonOnly: false, includeExcluded: false };

  it("기본(includeExcluded=false)은 안 맞음(excluded)만 뺀다 — 맞음·확인 필요는 남긴다", () => {
    expect(ids(applyFilters(all, NONE))).toEqual(["open", "soon", "always", "past", "unverified"]);
  });
  it("지금 신청 가능만 — 마감 지난 것만 뺀다(상시는 남는다, excluded 는 기본 규칙대로 계속 빠진다)", () => {
    expect(ids(applyFilters(all, { ...NONE, openOnly: true }))).toEqual(["open", "soon", "always", "unverified"]);
  });
  it("7일 내 마감 — 상시·먼 마감·마감 지남은 뺀다", () => {
    expect(ids(applyFilters(all, { ...NONE, soonOnly: true }))).toEqual(["soon"]);
  });
  it("includeExcluded=true 여도 applyFilters 목록에는 안 맞음이 안 섞인다 — 안 맞음은 별도 풀이다(11차 #2·#4)", () => {
    expect(ids(applyFilters(all, { ...NONE, includeExcluded: true }))).toEqual([
      "open",
      "soon",
      "always",
      "past",
      "unverified",
    ]);
  });

  it("splitByFit — 다른 필터(openOnly·soonOnly)를 먼저 걸고 나서 정상/안 맞음 두 풀로 나눈다(11차 #3)", () => {
    const excludedSoon = mkItem({
      id: "excluded-soon",
      fitVerdict: "excluded",
      deadline: deadlineOfAnnouncement(kstEnd("2026-09-05"), "", NOW),
    });
    const excludedFar = mkItem({
      id: "excluded-far",
      fitVerdict: "excluded",
      deadline: deadlineOfAnnouncement(kstEnd("2026-12-31"), "", NOW),
    });
    const pool = [soon, excludedSoon, excludedFar, unverified];

    const plain = splitByFit(pool, NONE);
    expect(ids(plain.normal)).toEqual(["soon", "unverified"]);
    expect(ids(plain.excluded)).toEqual(["excluded-soon", "excluded-far"]);

    // soonOnly 를 켜면 안 맞음 풀도 **곧 마감인 것만** 남는다 — 필터 전 개수를 세면
    // 「안 맞아서 뺀 K건」이 칩과 무관한 수가 된다(11차 #3).
    const onlySoon = splitByFit(pool, { ...NONE, soonOnly: true });
    expect(ids(onlySoon.normal)).toEqual(["soon"]);
    expect(ids(onlySoon.excluded)).toEqual(["excluded-soon"]);
  });
});

describe("한눈에 4칸", () => {
  it("신청 가능·7일 내 마감·맞는 무상 최대 금액·맞는 것(fit) 중 최저 이자(G3① — 2026-09-03 코덱스 지적, 예전엔 확인 필요도 셌다)", () => {
    const items = [
      mkItem({ id: "g1", group: "grant", fitVerdict: "fit", amountMaxWon: 50_000_000, rateMin: 4, deadline: deadlineOfAnnouncement(kstEnd("2026-09-08"), "", NOW) }),
      mkItem({ id: "g2", group: "grant", fitVerdict: "excluded", amountMaxWon: 900_000_000, deadline: ALWAYS }),
      mkItem({ id: "g3", group: "grant", fitVerdict: "fit", amountMaxWon: 30_000_000, deadline: deadlineOfAnnouncement(kstEnd("2026-08-31"), "", NOW) }),
      mkItem({ id: "p1", group: "policy", fitVerdict: "unverified", rateMin: 2.5, deadline: ALWAYS }), // 확인 필요라 이젠 최저 이자에서 빠진다
      mkItem({ id: "p2", group: "policy", fitVerdict: "excluded", rateMin: 1, deadline: ALWAYS }),
      mkItem({ id: "p3", group: "policy", fitVerdict: "fit", rateMin: 3.2, deadline: ALWAYS }),
    ];
    expect(glanceOf(items)).toEqual({
      // ★뜻이 바뀐 기대값(코덱스 11차 #16, 2026-09-04) — 예전엔 open 이 5(안 맞음 g2·p2 까지 셌다).
      //  「지금 신청 가능」은 사람이 **넣을 수 있는 건수**로 읽는 자리라 안 맞음을 세면 거짓이 된다.
      //  이제 glanceOf 가 스스로 안 맞음을 빼므로 부르는 쪽(조립·화면)이 무엇을 넘겨도 정상만 센다.
      open: 3,
      soon: 1,
      grantFit: 1,
      grantMaxWon: 50_000_000,
      minRate: 3.2, // p3(맞음)만 — p1(확인 필요·2.5)·p2(안 맞음)는 안 센다
    });
  });

  it("안 맞음(excluded)은 open·soon 에서도 빠진다 — includeExcluded 로 목록에 섞여 와도(11차 #16)", () => {
    const soonEnd = deadlineOfAnnouncement(kstEnd("2026-09-05"), "", NOW);
    const items = [
      mkItem({ id: "ok", fitVerdict: "unverified", deadline: soonEnd }),
      mkItem({ id: "no", fitVerdict: "excluded", deadline: soonEnd }),
    ];
    expect(glanceOf(items)).toMatchObject({ open: 1, soon: 1 });
  });
  it("맞는 무상도 이자 아는 것도 없으면 null — 0 으로 지어내지 않는다", () => {
    expect(glanceOf([])).toEqual({ open: 0, soon: 0, grantFit: 0, grantMaxWon: null, minRate: null });
    const onlyExcluded = [mkItem({ group: "grant", fitVerdict: "excluded", amountMaxWon: 10_000_000, rateMin: 1.5 })];
    expect(glanceOf(onlyExcluded).grantMaxWon).toBeNull();
    expect(glanceOf(onlyExcluded).minRate).toBeNull();
  });
});

describe("formatWon — 원 단위를 사람이 읽는 금액으로", () => {
  it("없음(null)은 「—」 — 0 으로 지어내지 않는다", () => {
    expect(formatWon(null)).toBe("—");
  });
  it("5,000억원 — 큰 금액을 만원으로 나눠 「5,000,000만원」이라 적으면 못 읽는다(QA 15a 지적)", () => {
    expect(formatWon(500_000_000_000)).toBe("5,000억원");
  });
  /**
   * ★기대값 변경(2026-09-03 코덱스 적대 리뷰 #4 중간) — 「소수 첫째 자리 반올림」을 버렸다.
   *   1억 4,600만원이 `Math.round(1.46*10)/10 = 1.5` 로 「1.5억원」이 되어 **없는 400만원을 만들었다**.
   *   한도는 사람이 신청 가능액으로 읽는 숫자라 부풀리면 안 된다 — 억 이상은 만원까지 정확히 적는다.
   */
  it("1억 이상은 「N억 M,MMM만원」으로 정확히 — 반올림하면 없는 한도가 생긴다", () => {
    expect(formatWon(146_000_000)).toBe("1억 4,600만원");
    expect(formatWon(150_000_000)).toBe("1억 5,000만원");
  });
  it("만원 미만 잔돈은 버린다 — 억 단위에서 원 단위까지 적으면 못 읽는다", () => {
    expect(formatWon(100_000_500)).toBe("1억원");
    expect(formatWon(105_000_000)).toBe("1억 500만원");
  });
  it("딱 떨어지면 소수점을 안 붙인다(.0 생략)", () => {
    expect(formatWon(100_000_000)).toBe("1억원");
  });
  it("1억 미만 1만 이상은 만원(정수·쉼표)", () => {
    expect(formatWon(50_000_000)).toBe("5,000만원");
  });
  it("1만 미만은 원 그대로", () => {
    expect(formatWon(5_000)).toBe("5,000원");
  });
  /**
   * ★2026-09-03 코덱스 적대 리뷰 지적 5③ — normalizeAmountUnits 가 큰 값도 formatWon 에 맡기려면
   *  formatWon 이 「만원 배수」 입력에서 반올림하지 않는다는 확인이 먼저다. 억 자리 나눗셈(Math.floor)과
   *  만원 자리 나눗셈(Math.floor) 모두 입력이 10,000 의 배수면 나머지가 없어 잘림 손실이 생기지 않는다
   *  (원 단위 테스트 200개 왕복 확인 — 스크래치패드 proto2.mjs). 그래서 이 함수를 따로 새로 만들지
   *  않고 formatWon 을 그대로 쓴다.
   */
  it("만원 배수인 큰 값은 억 단위에서도 반올림 없이 정확하다 — 새 함수를 따로 안 만들어도 되는 근거", () => {
    expect(formatWon(15_000_000_000)).toBe("150억원");
    expect(formatWon(1_050_000_000)).toBe("10억 5,000만원");
  });
});

/**
 * ★2026-09-03 독립 검사 D · 배포본 캡처 `05-table-1440.png`
 *   숫자 칸(amountMaxWon)이 없는 줄은 글자를 원문 그대로 싣는데, 원문 단위가 「17백만원」·「800천원」
 *   이라 같은 표 안에서 「최대 1,000만원」과 자릿수 감이 서로 어긋났다. 글자 안의 단위 토큰만
 *   원으로 환산해 formatWon 표기로 바꾼다 — 나머지 문장은 손대지 않는다.
 */
describe("normalizeAmountUnits — 글자 속 「백만원·천만원·천원」만 통일한다", () => {
  it("「17백만원」 → 「1,700만원」", () => {
    expect(normalizeAmountUnits("아이디어 부문 총 상금 17백만원, 사업화 부문 총 상금 30백만원")).toBe(
      "아이디어 부문 총 상금 1,700만원, 사업화 부문 총 상금 3,000만원",
    );
  });
  it("「800천원」 → 「80만원」 · 「70,000천원」 → 「7,000만원」(쉼표가 든 숫자도 읽는다)", () => {
    expect(normalizeAmountUnits("1인당 800천원 지원")).toBe("1인당 80만원 지원");
    expect(normalizeAmountUnits("한도 70,000천원")).toBe("한도 7,000만원");
  });
  it("단위가 없는 글자·「만원」·소수점이 붙은 숫자는 그대로 둔다 — 멀쩡한 글을 망가뜨리지 않는다", () => {
    expect(normalizeAmountUnits("최대 5,000만원")).toBe("최대 5,000만원");
    expect(normalizeAmountUnits("원문 확인")).toBe("원문 확인");
    // 「3.5천원」의 뒷자리 5 만 떼어 「5천원」으로 읽으면 「3.5,000원」이 된다(숫자 경계가 필요한 이유)
    expect(normalizeAmountUnits("연 3.5천원")).toBe("연 3.5천원");
  });

  /**
   * ★2026-09-03 코덱스 적대 리뷰 지적 5① — formatWon 은 만원 미만을 반올림한다(Math.round).
   *  「15천원」(=15,000원)을 그대로 formatWon 에 넘기면 Math.round(1.5)=2 라 「2만원」이 되어
   *  없는 5,000원이 생겼다. 환산값이 만원(10,000원)의 배수일 때만 바꾸고, 아니면 원문을 그대로 둔다.
   */
  it("환산값이 만원의 배수가 아니면 원문을 그대로 둔다 — 「15천원」이 「2만원」으로 반올림되지 않는다", () => {
    expect(normalizeAmountUnits("15천원")).toBe("15천원");
  });
  it("환산값이 만원의 배수면 정확히 바꾼다 — 「500천원」→「50만원」·「1,500천원」→「150만원」", () => {
    expect(normalizeAmountUnits("500천원")).toBe("50만원");
    expect(normalizeAmountUnits("1,500천원")).toBe("150만원");
  });

  /**
   * ★2026-09-03 코덱스 적대 리뷰 지적 5② — 「10~20천원」처럼 앞 숫자엔 단위가 안 붙고 범위 끝에만
   *  단위가 붙는 표기에서, 예전 정규식은 뒤 숫자(「20천원」)만 찾아 바꾸고 앞 숫자(「10」)는 그대로 둬
   *  「10~2만원」이라는 짝이 안 맞는 범위를 만들었다(코덱스 지적). 이제 범위 전체를 한 번에 찾아
   *  같은 단위로 두 수를 함께 환산하고, **둘 다** 만원 배수일 때만 통째로 바꾼다.
   */
  it("범위는 두 수를 같은 단위로 함께 바꾼다 — 「10~20백만원」→「1,000~2,000만원」", () => {
    expect(normalizeAmountUnits("10~20백만원")).toBe("1,000~2,000만원");
  });
  /**
   * ★2026-09-03 코덱스 적대 리뷰 재지적 — 범위 정규식의 부정 후방탐색 `(?<![\d.,])` 때문에
   *  「지원한도,10~20백만원」처럼 범위 바로 앞이 쉼표·마침표면 범위 매치 자체가 실패했다. 그러면
   *  뒤 숫자(「20백만원」)만 단일 금액으로 홀로 매치돼 앞 숫자(「10」)는 그대로 남고 「지원한도,
   *  10~2,000만원」이라는 짝 안 맞는 범위가 됐다(위 지적 5② 이 다른 경로로 되살아난 것과 같은 모양).
   *  범위 쪽 후방탐색은 `(?<!\d)` 로 좁혀 쉼표·마침표는 허용하고, 그 대신 단일 매치 쪽 후방탐색에
   *  `~∼-` 를 추가해 범위의 뒤쪽 절반만 단독으로 집는 것을 막는다.
   */
  it("범위 바로 앞이 쉼표여도 범위 전체를 한 번에 바꾼다 — 「지원한도,10~20백만원」→「지원한도,1,000~2,000만원」(짝 안 맞는 「10~2,000만원」이 되면 안 된다)", () => {
    expect(normalizeAmountUnits("지원한도,10~20백만원")).toBe("지원한도,1,000~2,000만원");
  });
  it("범위 바로 앞이 괄호여도(쉼표·마침표가 아니어도 원래 되던 경우) 그대로 된다 — 「(10~20백만원)」→「(1,000~2,000만원)」", () => {
    expect(normalizeAmountUnits("(10~20백만원)")).toBe("(1,000~2,000만원)");
  });
  /**
   * ★2026-09-03 코덱스 7차 지적 4 — 위 재지적에서 범위 후방탐색을 `(?<!\d)` 로 넓히며 **마침표까지 허용**해,
   *  「0.5~20백만원」의 「.5」가 「5~20백만원」으로 부분 매치돼 「0.500~2,000만원」이 됐다(소수 첫째 자리가
   *  잘려 나가 없는 자릿수가 생겼다). 범위 쪽은 `(?<![\d.])` — 쉼표(문장 구두점)는 그대로 허용하고
   *  마침표·숫자만 막는다. 「지원한도,10~20백만원」은 그대로 바뀌어야 한다(바로 위 시험).
   */
  it("「0.5~20백만원」은 그대로 둔다 — 「.5」를 「5」로 떼어 「0.500~2,000만원」이 되면 안 된다(7차 지적 4)", () => {
    expect(normalizeAmountUnits("0.5~20백만원")).toBe("0.5~20백만원");
    expect(normalizeAmountUnits("한도 0.5~20백만원 이내")).toBe("한도 0.5~20백만원 이내");
  });
  /**
   * ★설계 문서(작업 지시) 예시는 「10~20천원 → 그대로」라고 적었지만, 10,000원·20,000원은 실제로
   *  **둘 다 만원의 정확한 배수**라 위 "둘 다 만원 배수일 때만 바꾼다" 규칙을 문자 그대로 지키면
   *  오히려 바뀌는 게 맞다(반올림 없이 정확히 1~2만원). 규칙(둘 다 만원 배수)과 예시 문구가 서로
   *  어긋나 있어 **규칙 쪽을 구현**했다 — 「10~20천원 그대로」를 원하면 범위 변환 대상에서 천 단위를
   *  아예 빼는 별도 지시가 필요하다(보고에 명시).
   */
  it("「10~20천원」도 둘 다 정확히 만원 배수라(10,000·20,000원) 규칙대로 바뀐다 — 「1~2만원」(설계 예시 문구와 다름, 보고 참고)", () => {
    expect(normalizeAmountUnits("10~20천원")).toBe("1~2만원");
  });
  it("범위 중 한쪽이라도 만원 배수가 아니면 통째로 원문 그대로 둔다", () => {
    // 범위는 단위 하나를 두 수가 함께 쓴다(뒤에 「천원」이 한 번만 있다) — 15*1,000=15,000원은
    // 만원 배수가 아니다(20*1,000=20,000원은 배수라도) → 짝이 안 맞으니 범위 전체를 안 바꾼다
    expect(normalizeAmountUnits("15~20천원")).toBe("15~20천원");
  });

  /**
   * ★2026-09-03 코덱스 적대 리뷰 지적 5③ — 억 단위까지 가는 값도 formatWon 이 반올림 없이 정확함을
   *  확인했으므로(위 formatWon 시험) 따로 억·만 전용 표기 함수를 새로 안 만들고 그대로 재사용한다.
   */
  it("억 단위까지 가는 값도 정확히 바뀐다 — 「최대 1,500천만원」→「최대 150억원」·「105천만원」→「10억 5,000만원」", () => {
    expect(normalizeAmountUnits("최대 1,500천만원 지원")).toBe("최대 150억원 지원");
    expect(normalizeAmountUnits("105천만원")).toBe("10억 5,000만원");
  });
});

/**
 * ★2026-09-03 독립 화면 검사 E(배포본 실측 · 1억 이상인데 만원 표기인 칸 85개) — 같은 열에 「5억원」과
 *  「50,000만원」이 함께 보여 자릿수 감이 어긋났다. 「만」 단위 값이 1억(10,000만원) 이상이면 억 표기로
 *  통일한다 — 10,000 미만은 이미 사람이 읽는 표기(「5,000만원」)라 손대지 않는다(위 describe 와 같은
 *  「멀쩡한 글을 안 건드린다」 원칙).
 */
describe("normalizeAmountUnits — 「만」 단위가 1억 이상이면 억 표기로 통일한다(독립 검사 E)", () => {
  it("「50,000만원」→「5억원」", () => {
    expect(normalizeAmountUnits("50,000만원")).toBe("5억원");
  });
  it("「12,345만원」→「1억 2,345만원」(만원 자리가 남으면 함께 적는다)", () => {
    expect(normalizeAmountUnits("12,345만원")).toBe("1억 2,345만원");
  });
  it("「200,000만원」→「20억원」", () => {
    expect(normalizeAmountUnits("200,000만원")).toBe("20억원");
  });
  it("10,000 미만은 그대로 둔다 — 「5,000만원」은 이미 사람이 읽는 표기다", () => {
    expect(normalizeAmountUnits("최대 5,000만원")).toBe("최대 5,000만원");
  });
  it("범위는 두 수 다 1억 이상일 때만 함께 바꾼다 — 「10,000~20,000만원」→「1억~2억원」", () => {
    expect(normalizeAmountUnits("10,000~20,000만원")).toBe("1억~2억원");
  });
  it("범위 중 한쪽이라도 10,000 미만이면 통째로 원문 그대로 둔다 — 짝이 안 맞는 범위를 만들지 않는다", () => {
    expect(normalizeAmountUnits("5,000~20,000만원")).toBe("5,000~20,000만원");
  });
});

/**
 * ★2026-09-03 코덱스 적대 리뷰 반영 — 위 범위 규칙(MAN_UNIT_RE·TEXT_UNIT_RE)은 「10,000~20,000만원」
 *  처럼 단위가 **끝에 한 번만** 붙는 꼴만 다뤘다. 「10,000만원~20,000만원」처럼 **양쪽 다** 단위를 쓰면
 *  앞 숫자+단위(「10,000만원」)가 먼저 단독 값으로 매치돼 「1억원」으로 바뀌고, 그 뒤 「~20,000만원」은
 *  (앞이 물결표라 단독 매치 후방탐색에 걸려) 손대지 못한 채 남아 「1억원~20,000만원」이라는 반쪽짜리
 *  결과가 됐다. 이제 `N만원~M만원`(TEXT_UNIT_RE 는 `N천만원~M천만원` 등) 꼴을 범위 규칙이 먼저 통째로
 *  잡아 두 수를 함께 처리한다 — 나머지 판단(둘 다 10,000 이상일 때만 환산)은 기존 규칙과 같다.
 */
describe("normalizeAmountUnits — 양쪽에 단위를 쓴 범위도 한 번에 바꾼다(코덱스 리뷰 반영)", () => {
  it("「10,000만원~20,000만원」→「1억~2억원」(양쪽 단위, 둘 다 1억 이상)", () => {
    expect(normalizeAmountUnits("10,000만원~20,000만원")).toBe("1억~2억원");
  });
  it("양쪽 단위라도 한쪽이 10,000 미만이면 원문 그대로 둔다 — 「5,000만원~20,000만원」", () => {
    expect(normalizeAmountUnits("5,000만원~20,000만원")).toBe("5,000만원~20,000만원");
  });
  it("TEXT_UNIT_RE(천만·백만·천)도 양쪽 단위를 함께 잡는다 — 「10백만원~20백만원」→「1,000~2,000만원」(「10~20백만원」과 같은 결과)", () => {
    expect(normalizeAmountUnits("10백만원~20백만원")).toBe("1,000~2,000만원");
  });
  it("양쪽 단위가 서로 다르면 함부로 안 바꾼다 — 「10천만원~20백만원」은 원문 그대로 둔다(짝이 안 맞는 단위를 지어내지 않는다)", () => {
    expect(normalizeAmountUnits("10천만원~20백만원")).toBe("10천만원~20백만원");
  });
});

describe("갈래별 묶음", () => {
  it("6갈래 고정 순서로 항상 6칸 — 빈 갈래도 자리를 지킨다", () => {
    expect(groupBlocks([]).map((b) => b.group)).toEqual([...FUNDING_GROUPS]);
    expect(groupBlocks([]).every((b) => b.total === 0 && b.items.length === 0 && !b.truncated)).toBe(true);
  });

  it("81건이면 total=81 · 실린 항목 80건 · truncated=true", () => {
    const many = Array.from({ length: 81 }, (_, i) =>
      mkItem({ id: `g${i}`, group: "grant", score: i, fitVerdict: "fit" }),
    );
    const grant = groupBlocks(many)[0];
    expect(grant.group).toBe("grant");
    expect(grant.total).toBe(81);
    expect(grant.items).toHaveLength(GROUP_TOP_N);
    expect(grant.truncated).toBe(true);
    // 잘라 내기 전에 추천 정렬 — 점수 높은 것이 남는다
    expect(grant.items[0].score).toBe(80);
    expect(grant.items.some((x) => x.score === 0)).toBe(false);
  });

  /**
   * ★뜻이 바뀐 시험(코덱스 11차 #2, 2026-09-04) — `items` 는 이제 **언제나 정상(fit·unverified)만**
   *  이다. 예전엔 안 맞음이 섞여 와 `total` 이 3(안 맞음 1건 포함)이었는데, 그러면 정상과 안 맞음이
   *  한 topN 을 나눠 갖고 「이 갈래 N건」이 안 맞음까지 세게 된다. 안 맞음은 `excluded` 개수와
   *  (켰을 때) `excludedItems` 로만 나간다.
   */
  it("갈래마다 맞음·확인 필요·안 맞음·7일 내 마감 건수를 센다 — total 은 정상만(11차 #2)", () => {
    const soonDeadline = deadlineOfAnnouncement(kstEnd("2026-09-04"), "", NOW);
    const items = [
      mkItem({ id: "1", group: "policy", fitVerdict: "fit", deadline: soonDeadline }),
      mkItem({ id: "2", group: "policy", fitVerdict: "unverified" }),
      mkItem({ id: "3", group: "policy", fitVerdict: "excluded" }),
      mkItem({ id: "4", group: "bank", fitVerdict: "fit" }),
    ];
    const blocks = groupBlocks(items);
    const policy = blocks.find((b) => b.group === "policy")!;
    expect(policy).toMatchObject({ total: 2, fit: 1, unverified: 1, excluded: 1, soon: 1, truncated: false });
    expect(policy.items.map((x) => x.id)).toEqual(["1", "2"]);
    expect(blocks.find((b) => b.group === "bank")!.total).toBe(1);
  });

  /**
   * ★재설계 계약(코덱스 11차 #2·#4, 2026-09-04) — 안 맞음은 **별도 풀**(`excludedPool`)로 들어와
   *  갈래마다 따로 topN 으로 잘린다. 그래서 정상 항목이 안 맞음에 밀려 잘리지 않고, 안 맞음이
   *  응답에서 통째로 사라지지도 않는다(예전 `allItems` 는 개수만 세는 자리였다).
   */
  it("정상 3·안 맞음 1(topN 3) — items 는 정상 3건, excludedItems 는 안 맞음 1건(11차 #2)", () => {
    const normal = [
      mkItem({ id: "n1", group: "policy", fitVerdict: "fit", score: 9 }),
      mkItem({ id: "n2", group: "policy", fitVerdict: "fit", score: 8 }),
      mkItem({ id: "n3", group: "policy", fitVerdict: "unverified", score: 7 }),
    ];
    const excludedPool = [mkItem({ id: "x1", group: "policy", fitVerdict: "excluded" })];
    const block = groupBlocks(normal, { topN: 3, excludedPool, includeExcluded: true }).find(
      (b) => b.group === "policy",
    )!;
    expect(block.items.map((x) => x.id)).toEqual(["n1", "n2", "n3"]);
    expect(block.excludedItems?.map((x) => x.id)).toEqual(["x1"]);
    expect(block.excluded).toBe(1);
    expect(block.total).toBe(3);
    expect(block.truncated).toBe(false);
  });

  it("includeExcluded 를 안 켜면 excludedItems 필드 자체가 없다 — 응답 크기(11차 #2)", () => {
    const excludedPool = [mkItem({ id: "x1", group: "policy", fitVerdict: "excluded" })];
    const block = groupBlocks([mkItem({ id: "n1", group: "policy", fitVerdict: "fit" })], { excludedPool }).find(
      (b) => b.group === "policy",
    )!;
    expect(block.excluded).toBe(1);
    expect("excludedItems" in block).toBe(false);
  });

  it("excludedItems 도 같은 정렬·같은 topN 으로 잘린다 — 잘렸다는 사실은 excluded 개수가 말한다", () => {
    const excludedPool = Array.from({ length: 5 }, (_, i) =>
      mkItem({ id: `x${i}`, group: "grant", fitVerdict: "excluded", score: i }),
    );
    const block = groupBlocks([], { topN: 2, excludedPool, includeExcluded: true }).find((b) => b.group === "grant")!;
    expect(block.excluded).toBe(5);
    expect(block.excludedItems?.map((x) => x.score)).toEqual([4, 3]); // 추천순 — 점수 높은 것이 앞
  });

  it("excludedPool 을 안 주면 items 자체에서 excluded 를 센다(예전 호출과 같은 동작)", () => {
    const items = [
      mkItem({ id: "1", group: "grant", fitVerdict: "excluded" }),
      mkItem({ id: "2", group: "grant", fitVerdict: "fit" }),
    ];
    expect(groupBlocks(items).find((b) => b.group === "grant")!.excluded).toBe(1);
  });
});

/**
 * ★재설계 계약 G1④(2026-09-04) — 카드·표·서랍이 전부 이 도우미만 쓴다. now 를 받아 dDay 를
 * `d.date` 로부터 **다시 계산**한다(예전 deadlineLabel 은 now 가 없었다) — 자료가 캐시돼 시간이
 * 흘러도(예: 어제 만든 자료를 오늘 다시 그릴 때) 「오늘/내일」이 실제 지금 기준으로 맞게 나오도록.
 * 그래서 아래 시험은 전부 dDay 필드를 null 로 비워 두고 date+now 만으로 계산됨을 확인한다.
 * **D-N 표기는 어디에도 없어야 한다**(계약 낱말 규칙).
 */
describe("deadlineWords — 마감 딱지/펼침 글자(재설계 계약 G1④)", () => {
  const NOW2 = new Date("2026-09-03T10:00:00+09:00");

  it("마감 지난 날짜(dDay<0) — 「마감됨」(plain)", () => {
    expect(deadlineWords({ kind: "date", date: "2026-08-30", text: "", dDay: null }, NOW2)).toEqual({
      chip: "마감됨",
      long: "마감됨",
      tone: "plain",
    });
  });
  it("오늘 마감(dDay=0) — 「오늘 마감」(red)", () => {
    expect(deadlineWords({ kind: "date", date: "2026-09-03", text: "", dDay: null }, NOW2)).toEqual({
      chip: "오늘 마감",
      long: "오늘 마감",
      tone: "red",
    });
  });
  it("내일(dDay=1) — 「내일(M월 D일) 마감」(red), 달·날 앞자리 0 없이", () => {
    expect(deadlineWords({ kind: "date", date: "2026-09-04", text: "", dDay: null }, NOW2)).toEqual({
      chip: "내일(9월 4일) 마감",
      long: "내일(9월 4일) 마감",
      tone: "red",
    });
  });
  it("2~7일 남음 — chip 은 짧게, long 은 날짜를 곁들인다(red)", () => {
    expect(deadlineWords({ kind: "date", date: "2026-09-06", text: "", dDay: null }, NOW2)).toEqual({
      chip: "3일 남음",
      long: "3일 남음 (9월 6일 마감)",
      tone: "red",
    });
  });
  it("8일 이상 — 「M월 D일 마감」만(plain, 남은 날수 없음)", () => {
    expect(deadlineWords({ kind: "date", date: "2026-09-11", text: "", dDay: null }, NOW2)).toEqual({
      chip: "9월 11일 마감",
      long: "9월 11일 마감",
      tone: "plain",
    });
  });
  it("upcoming — 「N일 뒤 접수 시작」(plain), date 의 ISO 시각으로 다시 잰다", () => {
    // NOW2(2026-09-03T01:00:00Z 와 같음) 로부터 정확히 5일 23시간 뒤 → 올림해 6일
    expect(
      deadlineWords({ kind: "upcoming", date: "2026-09-09T00:00:00.000Z", text: "", dDay: null }, NOW2),
    ).toEqual({ chip: "6일 뒤 접수 시작", long: "6일 뒤 접수 시작", tone: "plain" });
  });
  /**
   * ★코덱스 11차 #14(2026-09-04) — 자료를 만들 때는 접수 예정(upcoming)이었지만 화면을 열어 둔
   *  채 시작일이 지나면 일수가 0·음수가 되어 「-1일 뒤 접수 시작」이라는 없는 말이 나왔다.
   *  0 이하는 이미 시작한 것이니 그대로 「접수 시작됨」이라고 적는다.
   */
  it("upcoming 인데 시작일이 지났으면(일수 ≤0) 「접수 시작됨」 — 「-1일 뒤 접수 시작」 금지(11차 #14)", () => {
    expect(
      deadlineWords({ kind: "upcoming", date: "2026-09-02T00:00:00.000Z", text: "", dDay: null }, NOW2),
    ).toEqual({ chip: "접수 시작됨", long: "접수 시작됨", tone: "plain" });
    // 딱 지금(일수 0)도 「접수 시작됨」 — 「0일 뒤」는 사람이 지은 말이 아니다
    expect(deadlineWords({ kind: "upcoming", date: NOW2.toISOString(), text: "", dDay: null }, NOW2)).toEqual({
      chip: "접수 시작됨",
      long: "접수 시작됨",
      tone: "plain",
    });
    // date 가 없어 dDay 만 남은 자료도 같다
    expect(deadlineWords({ kind: "upcoming", date: null, text: "", dDay: -3 }, NOW2).chip).toBe("접수 시작됨");
  });
  it("always — 「상시 접수」(green)", () => {
    expect(deadlineWords({ kind: "always", date: null, text: "상시", dDay: null }, NOW2)).toEqual({
      chip: "상시 접수",
      long: "상시 접수",
      tone: "green",
    });
  });
  it("budget — 「예산 소진 시 마감」(plain)", () => {
    expect(deadlineWords({ kind: "budget", date: null, text: "예산 소진 시", dDay: null }, NOW2)).toEqual({
      chip: "예산 소진 시 마감",
      long: "예산 소진 시 마감",
      tone: "plain",
    });
  });
  it("text(14자 이하) — 원문 그대로(plain)", () => {
    expect(deadlineWords({ kind: "text", date: null, text: "매주 화요일 접수", dDay: null }, NOW2)).toEqual({
      chip: "매주 화요일 접수",
      long: "매주 화요일 접수",
      tone: "plain",
    });
  });
  /**
   * ★뜻이 바뀐 시험(코덱스 11차 #13, 2026-09-04) — `long`(서랍·표 펼침)까지 14자로 자르면
   *  「2026-09-01 ~ 예산 소진 시」 같은 마감 원문이 어디서도 전문을 못 읽는 값이 된다.
   *  자르기는 좁은 자리(카드 앞면 chip)만의 일이다.
   */
  it("text(14자 초과) — chip 만 14자로 자르고 long 은 전문(11차 #13)", () => {
    expect(
      deadlineWords({ kind: "text", date: null, text: "ABCDEFGHIJKLMNOPQRSTUVWXYZ", dDay: null }, NOW2),
    ).toEqual({ chip: "ABCDEFGHIJKLMN…", long: "ABCDEFGHIJKLMNOPQRSTUVWXYZ", tone: "plain" });
  });
  it("closed — 「마감됨」(plain)", () => {
    expect(deadlineWords({ kind: "closed", date: null, text: "접수 종료", dDay: null }, NOW2)).toEqual({
      chip: "마감됨",
      long: "마감됨",
      tone: "plain",
    });
  });
  it("unknown — 「기간 미기재」(plain)", () => {
    expect(deadlineWords({ kind: "unknown", date: null, text: "기간 미기재", dDay: null }, NOW2)).toEqual({
      chip: "기간 미기재",
      long: "기간 미기재",
      tone: "plain",
    });
  });
  it("D-N 표기가 어디에도 없다(낱말 규칙)", () => {
    const cases: FundingDeadline[] = [
      { kind: "date", date: "2026-08-30", text: "", dDay: null },
      { kind: "date", date: "2026-09-06", text: "", dDay: null },
      { kind: "date", date: "2026-09-11", text: "", dDay: null },
    ];
    for (const d of cases) {
      const w = deadlineWords(d, NOW2);
      expect(w.chip).not.toMatch(/D-\d/);
      expect(w.long).not.toMatch(/D-\d/);
    }
  });
});

describe("whereWords — 어디에 신청", () => {
  it("agency 그대로, groupSources 2 이상이면 「(N-1곳에 더 게시)」를 덧붙인다", () => {
    expect(whereWords(mkItem({ agency: "서울시청", where: "" }))).toBe("서울시청");
    expect(whereWords(mkItem({ agency: "서울시청", where: "", groupSources: 3 }))).toBe("서울시청 (2곳에 더 게시)");
  });
  it("groupSources 가 1 이하면 덧붙이지 않는다", () => {
    expect(whereWords(mkItem({ agency: "서울시청", where: "", groupSources: 1 }))).toBe("서울시청");
  });
  it("agency 가 비어 있으면(공백뿐이어도) 「기관 미기재」", () => {
    expect(whereWords(mkItem({ agency: "", where: "" }))).toBe("기관 미기재");
    expect(whereWords(mkItem({ agency: "  ", where: " " }))).toBe("기관 미기재");
  });
  /**
   * ★코덱스 11차 #7(2026-09-04) — `where`(상품은 「케이뱅크 앱」 같은 **접수 창구**)를 버리고
   *  `agency`(기관)만 적어서, 「어디에 신청」이 실제 신청하는 곳을 안 알려 줬다. where 가 있으면
   *  그것이 먼저다 — 없을 때만 기관으로 내려온다.
   */
  it("where(접수 창구)가 있으면 그것을 먼저 쓴다 — 없을 때만 agency(11차 #7)", () => {
    expect(whereWords(mkItem({ where: "케이뱅크 앱", agency: "케이뱅크" }))).toBe("케이뱅크 앱");
    expect(whereWords(mkItem({ where: "  ", agency: "케이뱅크" }))).toBe("케이뱅크");
    expect(whereWords(mkItem({ where: "케이뱅크 앱", agency: "케이뱅크", groupSources: 2 }))).toBe(
      "케이뱅크 앱 (1곳에 더 게시)",
    );
  });
});

describe("verdictWords — 조건 대조 요약 줄", () => {
  it("조건이 없으면 「자동으로 잰 조건 없음 — 공고에서 직접 확인」", () => {
    expect(verdictWords([])).toBe("자동으로 잰 조건 없음 — 공고에서 직접 확인");
  });
  it("맞음·확인 필요만 있으면 안 맞음 문구는 안 붙는다", () => {
    const fit: FundingFit[] = [
      { label: "지역 서울", verdict: "pass", note: "" },
      { label: "업종 카페", verdict: "unknown", note: "" },
    ];
    expect(verdictWords(fit)).toBe("조건 2개 중 1개 맞음 · 1개는 직접 확인");
  });
  it("안 맞음이 섞이면 뒤에 덧붙인다", () => {
    const fit: FundingFit[] = [
      { label: "지역 서울", verdict: "pass", note: "" },
      { label: "업종 카페", verdict: "unknown", note: "" },
      { label: "업력 3년", verdict: "fail", note: "" },
    ];
    expect(verdictWords(fit)).toBe("조건 3개 중 1개 맞음 · 1개는 직접 확인 · 1개 안 맞음");
  });
});

describe("conditionVerdictWord — 조건 한 줄 딱지", () => {
  it("pass→맞음 · fail→안 맞음 · unknown→직접 확인", () => {
    expect(conditionVerdictWord("pass")).toBe("맞음");
    expect(conditionVerdictWord("fail")).toBe("안 맞음");
    expect(conditionVerdictWord("unknown")).toBe("직접 확인");
  });
});

describe("amountWords — 얼마까지", () => {
  it("amountText 있으면 그대로(이미 억·만 표기)", () => {
    expect(amountWords(mkItem({ amountText: "최대 5억원" }))).toBe("최대 5억원");
  });
  it("없으면 「공고에 금액 없음」", () => {
    expect(amountWords(mkItem({ amountText: "" }))).toBe("공고에 금액 없음");
  });
});

describe("repayWords — 갚기/이자", () => {
  it("grant → 「갚아야 하나」/「안 갚아도 됨」", () => {
    expect(repayWords(mkItem({ group: "grant" }))).toEqual({ label: "갚아야 하나", value: "안 갚아도 됨" });
  });
  it("invest → 「갚아야 하나」/「지분으로 받음 (상환 없음)」", () => {
    expect(repayWords(mkItem({ group: "invest" }))).toEqual({
      label: "갚아야 하나",
      value: "지분으로 받음 (상환 없음)",
    });
  });
  it("그 외 갈래 → 「이자」/rateText(없으면 「공고 확인」)", () => {
    expect(repayWords(mkItem({ group: "policy", rateText: "연 2.5%" }))).toEqual({ label: "이자", value: "연 2.5%" });
    expect(repayWords(mkItem({ group: "bank", rateText: "" }))).toEqual({ label: "이자", value: "공고 확인" });
  });
  /**
   * ★코덱스 11차 #9(2026-09-04) — 갈래가 invest 로 붙은 「보조금」 공고가 「지분으로 받음」이라고
   *  적혀 **없는 지분 양도**를 말했다. 갈래는 규칙으로 붙인 값이라 틀릴 수 있고, 「무상」·「보조금」
   *  같은 말은 그보다 강한 증거다 — 그래서 invest 판정보다 **먼저** 본다.
   */
  it("rateText 가 「무상」이면 갈래가 invest 여도 「안 갚아도 됨」(11차 #9)", () => {
    expect(repayWords(mkItem({ group: "invest", rateText: "무상" }))).toEqual({
      label: "갚아야 하나",
      value: "안 갚아도 됨",
    });
  });
  it("제목에 보조금·지원금·바우처가 있으면 「안 갚아도 됨」(11차 #9)", () => {
    for (const title of ["청년창업 보조금 지원사업", "고용유지 지원금 공고", "수출 바우처 모집"]) {
      expect(repayWords(mkItem({ group: "invest", title })).value).toBe("안 갚아도 됨");
    }
  });
  /**
   * ★제목 규칙은 **숫자 금리 앞에서 물러난다**(W2, 2026-09-04) — 「소상공인 지원금 연계 대출」처럼
   *  제목에 「지원금」이 들어간 **대출** 상품이 「안 갚아도 됨」으로 적히면 갚아야 할 돈을 공짜 돈으로
   *  읽힌다. rateText 에 숫자 금리(예: 「연 4.5%」)가 있으면 그것이 제목 낱말보다 강한 증거다.
   *
   * ★뜻이 바뀐 시험(12차 #1, 2026-09-04) — 기대값은 그대로 통과하지만 **통과하는 이유**가 달라졌다.
   *  예전엔 「숫자 금리가 제목 낱말을 이긴다」였고, 지금은 「제목 낱말을 invest 갈래에서만 본다」라
   *  policy·bank 줄이 애초에 제목 규칙을 안 거친다. 남겨 두는 이유는 이 조합(숫자 금리 + 제목에
   *  지원금이 든 대출)이 12차 #1 의 원 신고 사례라 회귀 감시로 계속 쓸모가 있기 때문이다.
   */
  it("rateText 에 숫자 금리가 있으면 제목의 보조금·지원금·바우처 규칙을 건너뛰고 「이자」", () => {
    expect(repayWords(mkItem({ group: "policy", title: "소상공인 지원금 연계 대출", rateText: "연 4.5%" }))).toEqual({
      label: "이자",
      value: "연 4.5%",
    });
    // 띄어쓴 표기(「4.5 %」)도 숫자 금리다
    expect(repayWords(mkItem({ group: "bank", title: "청년 바우처 연계 대출", rateText: "연 3 %" })).label).toBe("이자");
    // 갈래가 grant 면 여전히 「안 갚아도 됨」이 먼저다(숫자 금리보다 위)
    expect(repayWords(mkItem({ group: "grant", title: "지원금", rateText: "연 4.5%" })).value).toBe("안 갚아도 됨");
    // 숫자 없는 금리 문구(「무상」)는 그대로 안 갚아도 됨
    expect(repayWords(mkItem({ group: "invest", title: "수출 바우처 모집", rateText: "무상" })).value).toBe(
      "안 갚아도 됨",
    );
  });
  /**
   * ★코덱스 12차 #1(2026-09-04) — 제목 낱말 규칙은 **invest 갈래에서만** 본다. W2 는 숫자 금리
   *  (「연 4.5%」)만 막았는데, 「변동금리」처럼 숫자가 없는 대출은 그 그물에 안 걸려 제목의
   *  「지원금」 하나로 「안 갚아도 됨」이 됐다 — 갚아야 할 돈을 공짜 돈으로 읽힌다. 대출·보증
   *  갈래(policy·guarantee·bank·urgent)에서 상환을 면제하는 증거는 이자 칸의 「무상」뿐이다.
   */
  it("숫자 없는 금리 문구라도 대출 갈래는 제목 낱말로 「안 갚아도 됨」이 되지 않는다(12차 #1)", () => {
    expect(repayWords(mkItem({ group: "policy", title: "소상공인 지원금 연계 대출", rateText: "변동금리" }))).toEqual({
      label: "이자",
      value: "변동금리",
    });
    // 이자 칸이 비어도 마찬가지 — 제목만으로 상환을 면제하지 않는다
    expect(repayWords(mkItem({ group: "guarantee", title: "청년 바우처 연계 보증", rateText: "" }))).toEqual({
      label: "이자",
      value: "공고 확인",
    });
  });
  it("invest 는 제목 낱말 규칙을 그대로 쓴다 — 「민간투자 연계 사업화 보조금」(12차 #1)", () => {
    expect(repayWords(mkItem({ group: "invest", title: "민간투자 연계 사업화 보조금", rateText: "" }))).toEqual({
      label: "갚아야 하나",
      value: "안 갚아도 됨",
    });
  });
  it("무상·보조금 표시가 없는 invest 는 그대로 「지분으로 받음」", () => {
    expect(repayWords(mkItem({ group: "invest", title: "스케일업 팁스 투자", rateText: "" })).value).toBe(
      "지분으로 받음 (상환 없음)",
    );
  });
  /**
   * ★코덱스 13차 #1(2026-09-04) — 제목 낱말 규칙을 invest 갈래 안으로 좁힌 뒤(12차 #1), **그 안에서는**
   *  제목이 이자 칸의 숫자 금리를 다시 이겼다. 「소상공인 지원금 연계 투자대출」에 이자가 「연 4.5%」로
   *  적혀 있는데도 「안 갚아도 됨」이 되어, 이자를 내는 돈이 공짜 돈으로 읽혔다. 숫자 금리는 제목
   *  낱말보다 강한 증거다 — invest 분기 **안에서** 먼저 본다.
   */
  it("invest 갈래도 이자 칸에 숫자 금리가 있으면 제목 낱말보다 「이자」가 먼저다(13차 #1)", () => {
    expect(
      repayWords(mkItem({ group: "invest", title: "소상공인 지원금 연계 투자대출", rateText: "연 4.5%" })),
    ).toEqual({ label: "이자", value: "연 4.5%" });
    // 이자 칸이 비면 예전 그대로 — 제목이 「보조금」이라고 말하면 지분 양도가 아니다
    expect(repayWords(mkItem({ group: "invest", title: "민간투자 연계 사업화 보조금", rateText: "" }))).toEqual({
      label: "갚아야 하나",
      value: "안 갚아도 됨",
    });
  });
});

describe("groupFooterWords — 갈래 아래 줄(보여준 개수·안 맞아서 뺀 개수)", () => {
  const block: FundingGroupBlock = {
    group: "grant",
    total: 12,
    fit: 5,
    unverified: 4,
    excluded: 3,
    soon: 2,
    items: [],
    truncated: false,
  };
  it("보여준 것이 전체보다 적으면 「N건 중 M건만 보여 드림」", () => {
    expect(groupFooterWords(block, 8)).toEqual({
      shown: "이 갈래 12건 중 8건만 보여 드림",
      excluded: "안 맞아서 뺀 3건 보기",
    });
  });
  it("전부 보여줬으면 「N건 전부」", () => {
    expect(groupFooterWords(block, 12).shown).toBe("이 갈래 12건 전부");
  });
  it("excluded 가 0건이면 null(단추 자체를 안 그린다)", () => {
    expect(groupFooterWords({ ...block, excluded: 0 }, 12).excluded).toBeNull();
  });
  /**
   * ★코덱스 11차 #15(2026-09-04) — 안 맞음을 펼친 뒤에도 「12건 중 8건만」이라고 적어, 화면에 실제로
   *  그려진 줄 수(정상 8 + 안 맞음 3 = 11)와 개수가 안 맞았다. 셋째 인자(펼쳐 보여 준 안 맞음 건수)를
   *  주면 두 수를 **따로** 말한다 — 정상 건수와 안 맞음 건수를 한 수로 합치면 「이 갈래 몇 건인가」가
   *  다시 흐려진다. shownCount 는 **정상만**의 건수다(안 맞음은 excludedShown 으로 따로).
   */
  it("펼친 안 맞음이 있으면 「정상 N건 + 안 맞아서 뺀 K건 표시 중」(11차 #15)", () => {
    expect(groupFooterWords(block, 8, 3).shown).toBe("정상 8건 + 안 맞아서 뺀 3건 표시 중");
    // 단추 글자는 그대로 「전체 안 맞음 개수」다 — 펼친 뒤에도 몇 건이 있는지가 사실이다
    expect(groupFooterWords(block, 8, 3).excluded).toBe("안 맞아서 뺀 3건 보기");
  });
  it("excludedShown 이 0이거나 안 주면 예전 문구 그대로", () => {
    expect(groupFooterWords(block, 8, 0).shown).toBe("이 갈래 12건 중 8건만 보여 드림");
    expect(groupFooterWords(block, 12, 0).shown).toBe("이 갈래 12건 전부");
    expect(groupFooterWords(block, 8).shown).toBe("이 갈래 12건 중 8건만 보여 드림");
  });
});

describe("profileBandWords — 「이 사업장 정보로 판정」 띠(재설계 계약 G1④)", () => {
  it("있는 값만 순서대로 이어 붙인다 — 지역/업종은 낱말만, 매출은 「연매출」로, 설립은 「YYYY년 M월 설립」, 법인 여부는 「개인사업자/법인」", () => {
    const out = profileBandWords(["지역 서울", "업종 음식점/카페", "매출 1.3억", "설립일 2023-01-01", "법인 여부 개인"]);
    expect(out).toBe("이 사업장 정보로 판정: 서울 · 음식점/카페 · 연매출 1.3억 · 2023년 1월 설립 · 개인사업자");
  });
  it("법인이면 「법인」", () => {
    expect(profileBandWords(["법인 여부 법인"])).toBe("이 사업장 정보로 판정: 법인");
  });
  it("「대조 기준」 낱말은 어디에도 안 쓴다(낱말 규칙)", () => {
    expect(profileBandWords(["지역 서울"])).not.toContain("대조 기준");
  });
  it("빈 배열이면 빈 문자열 — 화면이 띠 자체를 안 그리게", () => {
    expect(profileBandWords([])).toBe("");
  });
});

describe("gapWords — 회사 정보 빈 칸 힌트(재설계 계약 G1④)", () => {
  it("비어 있으면 빈 문자열", () => {
    expect(gapWords([])).toBe("");
  });
  it("있으면 「회사 정보에 …가 비어 있어…」 — 항목은 가운뎃점(·)으로 잇는다", () => {
    expect(gapWords(["신용점수", "기존 대출 유무", "직원 수"])).toBe(
      "회사 정보에 신용점수·기존 대출 유무·직원 수가 비어 있어 일부 조건은 「확인 필요」로 남습니다 — 채우면 자동 판정됩니다",
    );
  });
});

/**
 * ★재설계 A안(2026-09-04 승인 시안) — 위 띠는 「라벨 + 값」, 빈칸 힌트는 「제목(할 일) + 본문」
 *  두 조각으로 나뉜다. 옛 한 줄 함수(`profileBandWords`·`gapWords`)는 부르는 화면이 아직 있어
 *  그대로 남아 있고(위 describe 두 개가 계속 잰다), 여기서는 **새 두 함수만** 잰다.
 */
describe("profileBandParts — 판정 근거 띠를 라벨과 값 두 조각으로(A안)", () => {
  it("라벨은 늘 「판정에 쓴 정보」, 값은 옛 문장에서 앞머리 라벨만 뺀 부분", () => {
    const parts = profileBandParts([
      "지역 서울",
      "업종 음식점/카페",
      "매출 1.3억",
      "설립일 2023-01-01",
      "법인 여부 개인",
    ]);
    expect(parts.label).toBe("판정에 쓴 정보");
    expect(parts.value).toBe("서울 · 음식점/카페 · 연매출 1.3억 · 2023년 1월 설립 · 개인사업자");
  });

  it("값에는 라벨도 콜론도 섞이지 않는다 — 화면이 두 조각을 따로 그리기 때문", () => {
    const parts = profileBandParts(["법인 여부 법인"]);
    expect(parts.value).toBe("법인");
    expect(parts.value).not.toContain("판정에 쓴 정보");
    expect(parts.value).not.toContain("이 사업장 정보로 판정");
    expect(parts.value).not.toContain(":");
  });

  it("빈 배열이면 값이 빈 문자열 — 옛 profileBandWords 가 빈 문자열이던 것과 같은 뜻(라벨은 그대로)", () => {
    expect(profileBandParts([])).toEqual({ label: "판정에 쓴 정보", value: "" });
    expect(profileBandWords([])).toBe("");
  });

  it("옛 한 줄 함수 = 이 함수의 값에 옛 앞머리만 붙인 것 — 두 벌로 갈라지지 않는다", () => {
    const 입력들: string[][] = [
      [],
      ["지역 서울"],
      ["법인 여부 법인"],
      ["지역 전북", "직원수 10명"],
      ["지역 서울", "업종 음식점/카페", "매출 1.3억", "설립일 2023-01-01", "법인 여부 개인"],
    ];
    for (const used of 입력들) {
      const { value } = profileBandParts(used);
      expect(profileBandWords(used)).toBe(value === "" ? "" : `이 사업장 정보로 판정: ${value}`);
    }
  });
});

describe("gapParts — 빠진 칸 힌트를 「할 일 제목 + 본문」으로(A안)", () => {
  /** 본문은 입력과 무관하게 늘 같은 한 줄이다. */
  const 본문 = "입력하면 「확인 필요」 조건이 자동으로 판정됩니다";

  it("빠진 칸 0개면 null — 화면이 상자 자체를 안 그린다", () => {
    expect(gapParts([])).toBeNull();
  });

  it("1개 — 받침 없는 낱말은 「를」", () => {
    expect(gapParts(["신용점수"])).toEqual({ title: "신용점수를 입력해 주세요", body: 본문 });
    expect(gapParts(["기존 대출 유무"])?.title).toBe("기존 대출 유무를 입력해 주세요");
    expect(gapParts(["직원 수"])?.title).toBe("직원 수를 입력해 주세요");
    expect(gapParts(["소재지"])?.title).toBe("소재지를 입력해 주세요");
  });

  /**
   * ★옛 `gapWords` 는 조사 「가」가 글자에 박혀 있어 받침 있는 칸 이름이 오면 「업종가 비어 있어」로
   *  틀린다(실측). 새 함수는 받침을 보고 「을/를」을 고르므로 그 결함이 없다.
   */
  it("1개 — 받침 있는 낱말은 「을」(옛 gapWords 의 「업종가」 결함이 없다)", () => {
    expect(gapParts(["업종"])?.title).toBe("업종을 입력해 주세요");
    expect(gapParts(["설립일"])?.title).toBe("설립일을 입력해 주세요");
    expect(gapParts(["연매출"])?.title).toBe("연매출을 입력해 주세요");
    expect(gapParts(["업종"])?.title).not.toContain("업종를");
    expect(gapParts(["업종"])?.title).not.toContain("업종가");
  });

  it("2개 — 앞 낱말은 받침대로 「와/과」, 마지막만 「을/를」", () => {
    expect(gapParts(["신용점수", "기존 대출 유무"])?.title).toBe("신용점수와 기존 대출 유무를 입력해 주세요");
    expect(gapParts(["업종", "연매출"])?.title).toBe("업종과 연매출을 입력해 주세요");
    expect(gapParts(["업종", "직원 수"])?.title).toBe("업종과 직원 수를 입력해 주세요");
    expect(gapParts(["소재지", "업종"])?.title).toBe("소재지와 업종을 입력해 주세요");
  });

  it("3개 이상 — 쉼표로 잇고 마지막에만 「을/를」", () => {
    expect(gapParts(["신용점수", "기존 대출 유무", "직원 수"])?.title).toBe(
      "신용점수, 기존 대출 유무, 직원 수를 입력해 주세요",
    );
    expect(gapParts(["소재지", "직원 수", "업종"])?.title).toBe("소재지, 직원 수, 업종을 입력해 주세요");
    // profileGapsOf(funding-map-build.ts) 가 낼 수 있는 최대 — 7칸 전부 빈 회사
    expect(
      gapParts(["신용점수", "기존 대출 유무", "소재지", "업종", "설립일", "연매출", "직원 수"])?.title,
    ).toBe("신용점수, 기존 대출 유무, 소재지, 업종, 설립일, 연매출, 직원 수를 입력해 주세요");
  });

  it("3개 이상은 가운뎃점(·)이 아니라 쉼표로 잇는다 — 옛 한 줄 힌트와 다른 규칙", () => {
    const title = gapParts(["신용점수", "기존 대출 유무", "직원 수"])?.title ?? "";
    expect(title).not.toContain("·");
    expect(title.split(", ")).toHaveLength(3);
  });

  it("한글 음절이 아닌 글자로 끝나면 받침 없음으로 본다(영문·숫자)", () => {
    expect(gapParts(["ROE"])?.title).toBe("ROE를 입력해 주세요");
    expect(gapParts(["ROE", "매출 2024"])?.title).toBe("ROE와 매출 2024를 입력해 주세요");
  });

  it("본문은 늘 같은 한 줄이고, 제목엔 사정 설명(「비어 있어」)이 없다 — 할 일만 말한다", () => {
    expect(gapParts(["신용점수"])?.body).toBe(본문);
    expect(gapParts(["업종", "연매출"])?.body).toBe(본문);
    expect(gapParts(["신용점수", "기존 대출 유무", "직원 수"])?.body).toBe(본문);
    expect(gapParts(["업종", "연매출"])?.title).not.toContain("비어 있어");
    expect(gapParts(["업종", "연매출"])?.title).toMatch(/입력해 주세요$/);
  });
});
