/**
 * 공고 구조에 **지역 조건을 보태는** 한 곳. 추천·진단·AI판정 세 통로가 이것만 쓴다.
 *
 * 왜 함수로 뽑았나(2026-09-01): 추천 통로에만 넣었더니 진단·AI판정은 그대로여서
 * 같은 공고가 화면마다 다르게 판정됐다(fable 리뷰 중요2 — CLAUDE.md 규칙 8 「한 곳만 고치고
 * 나머지를 빠뜨렸다」). 세 통로가 이 함수를 부르게 해서 갈래가 생기지 않게 한다.
 *
 * ★보태는 자리가 둘이고 **안전 기준이 서로 다르다** — 섞으면 사고가 난다(실측 재현).
 *  ① 제목 앞머리 `[광역] 시군구` — 기관 광역과 교차검증을 거치므로 믿을 만하다.
 *     **광역으로 읽히는 조건이 없을 때** 보탠다. AI 가 읽은 공고는 지역이 `["포천시"]` 처럼
 *     시군구만인 경우가 있는데, checkCondition 은 시군구를 광역으로 못 바꿔 fail 이 아니라
 *     unknown 을 내서, 나머지가 통과해 **포천시 전용 공고가 인천 회사에게 「조건 충족」**으로 떴다.
 *  ② 출처가 준 지역 칸 — **믿을 수 없다.** 실측하면 홍보 낱말 뭉치라
 *     「기술,창업,서울,부산,대구,…,제주」처럼 전 시도가 나열된다. 이미 정확한 지역 조건이 있는
 *     공고 옆에 이걸 보태면 조건 하나만 pass 해도 「맞음」이 되어
 *     **구미시 전용 사업이 서울 회사에게, 「전국」 가드가 걸린 공고가 아무에게나** 떴다.
 *     그래서 ②는 **지역 조건이 하나도 없을 때만** 쓴다.
 */
import { sidosInText } from "./match-engine";
import { titleRegionConditions } from "./rule-extract";
import type { AnnouncementStructure, StructuredCondition } from "./structure-types";

/** 출처가 준 지역 칸을 조건으로. 「전국」이 섞였거나 시도를 못 읽으면 만들지 않는다. */
export function synthesizedRegionCondition(regionText: string): StructuredCondition | null {
  if (regionText.includes("전국")) return null;
  // sidosInText — 「대구경북」처럼 붙여 쓴 표기에서 뒤 시도가 삼켜지지 않게(적대 리뷰 치명1).
  const sidos = sidosInText(regionText);
  if (sidos.length === 0) return null;
  return { key: "region", op: "in", value: sidos, rawText: `[공고 지역 칸] ${regionText}`, machineReadable: true };
}

export interface RegionSource {
  title: string;
  agency: string;
  /** 출처가 준 지역 칸. 없으면 빈 문자열. */
  region: string;
}

export interface RegionAugmentOptions {
  /**
   * 출처 지역 칸(②)까지 쓸지. **기본은 안 쓴다.**
   *
   * 추천 목록만 켠다 — 거기선 「지역이 안 맞는 공고를 빼는」 안전망으로 예전부터 쓰던 것이고,
   * 조건이 하나도 없는 공고가 지역만으로 「맞음」이 되는 성질을 이미 안고 있다.
   * **진단·AI판정에서는 끈다**: 이 두 곳은 조건이 전부 통과해야 「가능」을 주는데,
   * 구조가 비었거나 깨진 공고에 지역 조건 하나만 붙으면 **「가능」으로 잘못 승격**된다
   * (2026-09-01 실측: 구조가 깨진 공고가 「애매」에서 「가능」으로 올라가 시험이 깨졌다).
   */
  regionFieldFallback?: boolean;
}

/**
 * 구조에 지역 조건을 보탠 새 구조를 준다(원본은 안 건드린다).
 * 보탤 게 없으면 받은 것을 그대로 돌려준다.
 */
export function withRegionConditions(
  s: AnnouncementStructure,
  row: RegionSource,
  opts: RegionAugmentOptions = {},
): AnnouncementStructure {
  const regionConds = s.conditions.filter((c) => c.key === "region");
  const hasSidoRegion = regionConds.some(
    (c) =>
      c.machineReadable &&
      (Array.isArray(c.value) ? c.value : []).some((v) => sidosInText(String(v)).length > 0),
  );
  if (hasSidoRegion) return s;

  // ① 제목 앞머리는 어디서나 안전하다 — 기관 교차검증을 거친 「그 광역 전용」 신호다.
  const fromTitle = titleRegionConditions(row.title ?? "", row.agency ?? "").filter((c) => c.machineReadable);
  if (fromTitle.length > 0) return { ...s, conditions: [...s.conditions, ...fromTitle] };

  // ② 지역 칸은 켠 곳에서만, 그것도 지역 조건이 하나도 없을 때만.
  if (opts.regionFieldFallback && regionConds.length === 0) {
    const synth = synthesizedRegionCondition((row.region ?? "").trim());
    if (synth) return { ...s, conditions: [...s.conditions, synth] };
  }
  return s;
}
