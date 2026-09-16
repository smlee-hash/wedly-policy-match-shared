/**
 * 공고 구조에 **지역 조건·대상 분야를 보태는** 한 곳. 추천·진단·AI판정 세 통로가 이것만 쓴다.
 *
 * 왜 함수로 뽑았나(2026-09-01): 추천 통로에만 넣었더니 진단·AI판정은 그대로여서
 * 같은 공고가 화면마다 다르게 판정됐다(fable 리뷰 중요2 — CLAUDE.md 규칙 8 「한 곳만 고치고
 * 나머지를 빠뜨렸다」). 세 통로가 이 함수를 부르게 해서 갈래가 생기지 않게 한다.
 *
 * ★보태는 자리가 둘이고 **안전 기준이 서로 다르다** — 섞으면 사고가 난다(실측 재현).
 *  ① 제목 앞머리 `[광역] 시군구` — 기관 광역과 교차검증을 거치므로 믿을 만하다.
 *     **광역(또는 시군구 사전에 있는 이름)으로 읽히는 조건이 없을 때** 보탠다.
 *     이미 `["영월군"]` 처럼 사전이 아는 시군구가 있으면 그 조건이 다른 시도를 떨어뜨리므로
 *     제목에서 같은 이름을 한 번 더 붙이지 않는다. 사전에 없는 표기(중구·수도권)만
 *     예전처럼 제목 광역을 보탠다.
 *  ② 출처가 준 지역 칸 — **믿을 수 없다.** 실측하면 홍보 낱말 뭉치라
 *     「기술,창업,서울,부산,대구,…,제주」처럼 전 시도가 나열된다. 이미 정확한 지역 조건이 있는
 *     공고 옆에 이걸 보태면 조건 하나만 pass 해도 「맞음」이 되어
 *     **구미시 전용 사업이 서울 회사에게, 「전국」 가드가 걸린 공고가 아무에게나** 떴다.
 *     그래서 ②는 **지역 조건이 하나도 없을 때만** 쓴다.
 *
 * 대상 분야(targetSector)도 여기서 보탠다. 제목이 「○○기업」처럼 분야를 못 박았고
 * 구조에 그 키가 없을 때만. 세 통로가 이 함수만 쓰므로 갈래가 생기지 않는다.
 */
import { ALL_SIDO_COUNT, sidosInText } from "./match-engine";
import { titleRegionConditions, titleSectorCondition } from "./rule-extract";
import { sigunguSido } from "./sigungu";
import type { AnnouncementStructure, StructuredCondition } from "./structure-types";

/** 출처가 준 지역 칸을 조건으로. 「전국」이 섞였거나 시도를 못 읽으면 만들지 않는다. */
export function synthesizedRegionCondition(regionText: string): StructuredCondition | null {
  if (regionText.includes("전국")) return null;
  // sidosInText — 「대구경북」처럼 붙여 쓴 표기에서 뒤 시도가 삼켜지지 않게(적대 리뷰 치명1).
  const sidos = sidosInText(regionText);
  // 열린 공고 455건이 지역 칸에 17개 시도를 전부 나열한다(ERP JUNK_REGION 실측). 전부면 「전국」과 같이
  // 조건을 만들지 않는다. 그 아래(비수도권 14곳 등)는 일부 회사를 떨어뜨리는 실제 조건이므로 그대로 만든다 —
  // 약한 통과 문턱(NATIONWIDE_SIDO_COUNT)은 isNationwidePass 가 따로 본다(독립 리뷰 2026-09-16 지적 1).
  if (sidos.length === 0 || sidos.length >= ALL_SIDO_COUNT) return null;
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
 * 구조에 지역·대상 분야 조건을 보탠 새 구조를 준다(원본은 안 건드린다).
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
      (Array.isArray(c.value) ? c.value : []).some(
        (v) => sidosInText(String(v)).length > 0 || sigunguSido(String(v)) != null,
      ),
  );

  let out = s;
  if (!hasSidoRegion) {
    // ① 제목 앞머리는 어디서나 안전하다 — 기관 교차검증을 거친 「그 광역 전용」 신호다.
    const fromTitle = titleRegionConditions(row.title ?? "", row.agency ?? "").filter((c) => c.machineReadable);
    if (fromTitle.length > 0) {
      out = { ...s, conditions: [...s.conditions, ...fromTitle] };
    } else if (opts.regionFieldFallback && regionConds.length === 0) {
      // ② 지역 칸은 켠 곳에서만, 그것도 지역 조건이 하나도 없을 때만.
      const synth = synthesizedRegionCondition((row.region ?? "").trim());
      if (synth) out = { ...s, conditions: [...s.conditions, synth] };
    }
  }

  if (!out.conditions.some((c) => c.key === "targetSector")) {
    const sector = titleSectorCondition(row.title ?? "");
    if (sector) out = { ...out, conditions: [...out.conditions, sector] };
  }
  return out;
}
