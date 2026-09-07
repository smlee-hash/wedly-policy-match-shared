// 진단 직전 무료 사전필터 — AI 없이 확실한 마감·지역만 거른다.
// 잘못 빼면 받을 수 있는 공고가 진단에서 사라지므로 **애매하면 keep**.
// 업종·대상 원문은 여기서 보지 않는다(오탈락) — 구조화 후 기계 대조가 판단한다.
import { canonicalRegion, REGION_ALIASES } from "../engine/match-engine";

export type PrefilterDecision = "keep" | "drop-closed" | "drop-region";

export interface PrefilterAnnouncement {
  applyEnd: Date | string | null;
  region: string;
  /** 제목 머리표 `[지역]` 을 태그와 합집합으로 쓰기 위해 받는다. */
  title: string;
}

export interface PrefilterProfile {
  region?: string;
}

/**
 * 해시태그에 시도를 잔뜩 나열한 전국형 공고(기업마당 실측)와
 * 「서울·경기·인천」처럼 소수 시도 전용을 가른다.
 * 4곳 이상이면 빠진 시도가 있어도 전국 나열로 보고 keep.
 */
const EXCLUSIVE_REGION_MAX = 3;

/** 사전 별칭과 글자가 완전히 같을 때만 시도로 친다. startsWith 로 자르면 「서울부산」이 서울 전용이 된다. */
const EXACT_ALIAS = new Set(
  Object.values(REGION_ALIASES).flatMap((list) => list.map((a) => a.replace(/\s/g, ""))),
);

/**
 * 기업마당은 전남·광주 통합 지자체를 「전남광주」 한 토큰으로 붙인다.
 * match-engine 의 REGION_ALIASES 는 이걸 「광주」 하나로만 접는다(구조화 결과 대조용).
 * 사전필터가 그걸 그대로 쓰면 전남 기업에게 전남광주 공고가 통째로 빠진다.
 * 여기서만 둘 다로 펼친다 — 대조 엔진 사전은 건드리지 않는다.
 */
const PREFILTER_MULTI_REGION: Record<string, readonly string[]> = {
  전남광주: ["전남", "광주"],
};

export function prefilter(
  a: PrefilterAnnouncement,
  profile: PrefilterProfile,
  now: Date,
): PrefilterDecision {
  if (isClosed(a.applyEnd, now)) return "drop-closed";
  if (isClearlyOtherRegion(a, profile.region)) return "drop-region";
  return "keep";
}

function isClosed(applyEnd: Date | string | null, now: Date): boolean {
  if (applyEnd == null || applyEnd === "") return false;
  const t = applyEnd instanceof Date ? applyEnd.getTime() : Date.parse(String(applyEnd));
  if (!Number.isFinite(t)) return false;
  return t < now.getTime();
}

function compact(s: string): string {
  return s.replace(/\s/g, "");
}

function isNationwideText(region: string): boolean {
  const t = compact(region);
  return t.includes("전국") || t.includes("무관");
}

function profileRegionIsNationwide(region: string): boolean {
  return compact(region).startsWith("전국");
}

/**
 * 쪼개는 글자들.
 * ★기업마당이 제목 머리표에 쓰는 가운뎃점은 흔한 `·`(U+00B7)가 아니라 **한글 아래아 `ㆍ`(U+318D)**다.
 * 눈으로는 거의 같아 보이지만 다른 글자라, 이걸 빼면 `[부산ㆍ울산ㆍ경남]` 이 한 덩어리로 남아
 * 지역을 하나도 못 뽑는다 → 태그에 경남만 있으면 부산·울산 회사가 그 공고를 통째로 잃는다
 * (2026-08-24 운영 실측 16건 · 재리뷰 4번). 흔한 변형들도 함께 넣는다.
 */
const SPLIT_RE = /[,/#|~\s·ㆍ・･‧∙⋅•]+|및|와|과/;

/** 쉼표·우물정·가운뎃점으로 쪼갠 뒤 표준 시도만 모은다. 업종 토큰은 사전에 없어 빠진다. */
export function extractCanonicalRegions(region: string): string[] {
  const tokens = region.split(SPLIT_RE).map((x) => x.trim()).filter(Boolean);
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (canon: string) => {
    if (!canon || seen.has(canon)) return;
    seen.add(canon);
    out.push(canon);
  };
  for (const token of tokens) {
    const t = compact(token);
    const expanded = PREFILTER_MULTI_REGION[t];
    if (expanded) {
      for (const canon of expanded) push(canon);
      continue;
    }
    // 별칭이 아니면 시군·업종·붙은 시도 — 애매하므로 전용 목록에 넣지 않는다(잘못 빼지 않음).
    if (!EXACT_ALIAS.has(t)) continue;
    const canon = canonicalRegion(token);
    if (canon) push(canon);
  }
  return out;
}

/** 제목이 `[지역]` 으로 시작하면 그 안쪽도 시도로 본다. 태그와 합집합 — 어긋난 2건도 keep. */
function extractTitlePrefixRegions(title: string): string[] {
  const m = /^\[([^\]]+)\]/.exec((title ?? "").trimStart());
  if (!m) return [];
  return extractCanonicalRegions(m[1]);
}

function unionRegions(...lists: string[][]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const list of lists) {
    for (const r of list) {
      if (seen.has(r)) continue;
      seen.add(r);
      out.push(r);
    }
  }
  return out;
}

function isClearlyOtherRegion(a: PrefilterAnnouncement, profileRegion: string | undefined): boolean {
  const announcementRegion = a.region ?? "";
  if (!profileRegion?.trim()) return false;
  if (profileRegionIsNationwide(profileRegion)) return false;
  if (isNationwideText(announcementRegion)) return false;
  const mine = canonicalRegion(profileRegion);
  if (!mine) return false;
  // 태그만 보면 오타 하나로 공고가 사라진다. 제목 머리표와 합집합 — 비면 keep.
  const theirs = unionRegions(
    extractCanonicalRegions(announcementRegion),
    extractTitlePrefixRegions(a.title ?? ""),
  );
  if (theirs.length === 0) return false;
  if (theirs.length > EXCLUSIVE_REGION_MAX) return false;
  return !theirs.includes(mine);
}
