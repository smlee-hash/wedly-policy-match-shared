// 프로필 vs 구조화 조건 순수 대조 — AI 없음, 저장소 접근 없음(설계서 §3, 계획 Task 4).
// 「모름」은 절대 통과로 치지 않는다 — 값이 없으면 unknown → 등급은 최고 uncertain 까지만 간다.
import { compoundFamiliesIn, maskCompounds, relatedFamiliesOf, SECTOR_FAMILIES, sectorFamiliesOfIndustry, SECTOR_FAMILY_NAMES } from "./sector";
import { SIGUNGU_TO_SIDO, sigunguSido } from "./sigungu";
import { ORG_TYPE_NAMES, profileOrgTypes } from "./target-org";
import {
  AnnouncementStructure,
  ConditionCheck,
  IndustryScope,
  MatchGrade,
  StructuredCondition,
  gradeOf,
  opFitsKey,
} from "./structure-types";

/** 진단 입력 — 무상지원금 표 칸과 대응(free-subsidy/columns.ts). 빈 값 = 모름(unknown 처리). */
export interface BusinessProfile {
  companyName?: string; bizno?: string;
  industry?: string;          // 주업종(텍스트)
  region?: string;            // 소재지 시도
  // 자치 시군구 한 곳(예: "안양시"). 사전에 있는 이름만 담는다. 중구·서구처럼 여러 시도에
  // 같은 이름이 있는 곳은 채우지 않는다(sigungu.ts 사전이 이미 뺀다).
  regionSigungu?: string;
  foundedDate?: string;       // YYYY-MM-DD
  lastYearRevenueKrw?: number;
  employeeCount?: number;
  companyScale?: string;      // 중소기업|소상공인|중견|예비창업자 …
  orgTypes?: string[];        // 기업 형태·자격(사회적기업·착한가격업소 …). ERP 는 아직 안 채운다
  taxDelinquent?: boolean;
  hasCert?: boolean; hasPatent?: boolean;
  // ── 자금 조달 지도(2026-09-03) — 상시 상품 판정에만 쓰는 두 칸.
  creditScore?: number;       // 개인 신용점수(NICE/KCB 300~1000). 사람이 입력한다 — 자동 조회하지 않는다
  hasExistingLoan?: boolean;  // 기존 사업자대출 유무. 대환 상품이 「있어야」를 요구한다
}

/* ───────── 법인/개인 판정 ─────────
 * 사업자번호 가운데 두 자리가 법인·개인을 가른다: 81·82·83·84·85·86·87·88 = 법인,
 * 01~79 = 개인(과세·면세·법인 아닌 단체). 89·90 처럼 그 밖은 **모름**으로 둔다 —
 * 지어내어 false 로 채우면 「법인만」 상품이 개인사업자에게 「가능」으로 보인다. */
export function isCorporationByBizno(bizno: string | undefined): boolean | null {
  const digits = (bizno ?? "").replace(/\D/g, "");
  if (digits.length !== 10) return null;
  const middle = Number(digits.slice(3, 5));
  if (!Number.isFinite(middle)) return null;
  if (middle >= 81 && middle <= 88) return true;
  if (middle >= 1 && middle <= 79) return false;
  return null;
}

/* ───────── 지역 표기 사전 ─────────
 * 공고는 「충청북도」, 우리 프로필은 「충북」처럼 같은 곳을 다른 이름으로 적는다.
 * 글자 포함으로만 대조하면 이 둘이 안 걸려 **자격이 되는 회사에 「안 됨」이 나온다**
 * (2026-08-22 수정). 그래서 양쪽을 표준형(줄임말)으로 바꾼 뒤 대조한다.
 * ★「전남광주」처럼 앞 두 글자가 다른 시도와 겹치는 표기가 있어 **긴 별칭부터** 맞춰 본다. */
export const REGION_ALIASES: Record<string, string[]> = {
  서울: ["서울", "서울특별시", "서울시"],
  부산: ["부산", "부산광역시"],
  대구: ["대구", "대구광역시"],
  인천: ["인천", "인천광역시"],
  광주: ["광주", "광주광역시", "전남광주"],
  대전: ["대전", "대전광역시"],
  울산: ["울산", "울산광역시"],
  세종: ["세종", "세종특별자치시"],
  경기: ["경기", "경기도"],
  강원: ["강원", "강원도", "강원특별자치도"],
  충북: ["충북", "충청북도"],
  충남: ["충남", "충청남도"],
  전북: ["전북", "전라북도", "전북특별자치도"],
  전남: ["전남", "전라남도"],
  경북: ["경북", "경상북도"],
  경남: ["경남", "경상남도"],
  제주: ["제주", "제주도", "제주특별자치도"],
};

/** 전국 대상 공고 표기 — 지역 조건을 따지지 않는다. */
const NATIONWIDE = "전국";

/** 별칭 → 표준형. 긴 것부터 본다(「전남광주」가 「전남」에 먼저 걸리면 광주가 전남이 된다). */
const ALIAS_ENTRIES: Array<[string, string]> = Object.entries(REGION_ALIASES)
  .flatMap(([canon, list]) => list.map((a) => [a.replace(/\s/g, ""), canon] as [string, string]))
  .sort((a, b) => b[0].length - a[0].length);

/** 「충청북도 청주시」·「충북」 → "충북". 사전에 없는 표기(수도권·청주시 등)는 null. */
export function canonicalRegion(value: string | undefined | null): string | null {
  const t = (value ?? "").replace(/\s/g, "");
  if (!t) return null;
  for (const [alias, canon] of ALIAS_ENTRIES) if (t.startsWith(alias)) return canon;
  return null;
}

/** 글자 안에 든 표준 시도를 **전부** 찾는다 — 「대구경북」처럼 붙여 쓴 복수 시도를
 *  canonicalRegion(startsWith)이 앞쪽만 돌려주고 뒤쪽을 삼키던 것을 막는다(적대 리뷰 치명1). */
export function sidosInText(value: string | undefined | null): string[] {
  const t = (value ?? "").replace(/\s/g, "");
  if (!t) return [];
  const found = new Set<string>();
  for (const [alias, canon] of ALIAS_ENTRIES) if (t.includes(alias)) found.add(canon);
  return [...found];
}

/** 사전이 아는 시도 수(17). 이만큼 전부 나열한 지역 칸은 어느 회사도 떨어뜨릴 수 없으므로 조건으로 만들 값이 없다. */
export const ALL_SIDO_COUNT = Object.keys(REGION_ALIASES).length;
/**
 * 시도가 이만큼 나열된 **조건**은 지역을 정한 게 아니라 전국에 가깝다 — 약한 통과로만 본다(isNationwidePass).
 * 수도권 3·영남권 5 같은 실제 권역은 넘지 않는다. 출처 지역 칸에서 조건을 **만들지 말지**는 이 값이 아니라
 * ALL_SIDO_COUNT 로 판정한다(독립 리뷰 2026-09-16: 비수도권 14곳 나열은 수도권 회사를 떨어뜨리는 실제 조건이다).
 */
export const NATIONWIDE_SIDO_COUNT = 10;
/** 조건 값 목록이 사실상 전국인지 — 「전국」이 들어 있거나 서로 다른 시도가 NATIONWIDE_SIDO_COUNT 이상. */
export function isNationwideRegionList(values: readonly unknown[]): boolean {
  const sidos = new Set<string>();
  for (const v of values) {
    const text = String(v);
    if (text.includes(NATIONWIDE)) return true;
    for (const s of sidosInText(text)) sidos.add(s);
  }
  return sidos.size >= NATIONWIDE_SIDO_COUNT;
}

/** 소재지를 「전국」으로 둔 프로필 — 어디인지 안 정한 것이라 지역 조건은 판정하지 않는다. */
function profileRegionIsNationwide(region: string): boolean {
  return region.replace(/\s/g, "").startsWith(NATIONWIDE);
}

/**
 * 소재지 문구가 그 시군구를 **낱말로** 담고 있는가 — 공백·구두점으로 나눈 토막이 이름(「영월군」)·어간(「영월」)·
 * 어간+접미사와 정확히 같을 때만. 「구미동」·「남양주시」·「강남대로」 같은 다른 낱말의 일부는 안 된다.
 */
function profileNamesSigungu(region: string, name: string): boolean {
  // 어간이 시도 별칭(「제주」)이면 어간으로는 안 본다 — 「제주 서귀포시」의 「제주」가 제주시로 읽힌다.
  const rawStem = /[시군구]$/.test(name) ? name.slice(0, -1) : "";
  const stem = rawStem && canonicalRegion(rawStem) === null ? rawStem : "";
  const same = (t: string) =>
    t === name || (stem.length >= 2 && (t === stem || (t.startsWith(stem) && t.length === stem.length + 1 && /[시군구]$/.test(t))));
  const tokens = region.split(/[\s,·ㆍ()（）[\]【】/]+/).filter(Boolean);
  if (tokens.some(same)) return true;
  // 붙여 쓴 소재지(「강원영월군」·「서울특별시강남구」)는 다른 지역 함수들처럼 공백을 지운 형태도 본다 —
  // 단 앞의 시도 별칭 하나만 떼고 **나머지가 정확히** 이름·어간이어야 한다(「남양주시」·「구미동」은 안 된다)(통합 리뷰 F4).
  const compact = region.replace(/\s/g, "");
  const alias = ALIAS_ENTRIES.find(([a]) => compact.startsWith(a))?.[0] ?? "";
  return same(compact.slice(alias.length));
}

export function businessAgeYears(foundedDate: string | undefined, now: Date): number | null {
  if (!foundedDate) return null;
  const t = Date.parse(foundedDate);
  if (!Number.isFinite(t)) return null;
  return (now.getTime() - t) / (365.25 * 86_400_000);
}

/** 믿을 수 있는 회사 시군구. 사전에 있고, 시도 칸이 비었거나 그 시군구의 시도(또는 옛 시도)와 맞을 때.
 *  두 칸이 모순이면 null — 맞음 금지·pass 모두 하지 않는다(종전 동작). */
function trustedCompanySigungu(p: BusinessProfile) {
  const mineSg = p.regionSigungu ? sigunguSido(p.regionSigungu) : null;
  if (!mineSg) return null;
  const mineSet = sidosInText(p.region);
  if (mineSet.length === 0) return mineSg;
  if (mineSet.includes(mineSg.sido) || (mineSg.formerSido != null && mineSet.includes(mineSg.formerSido))) return mineSg;
  return null;
}

/**
 * 시군구 「맞음 금지」가 성립하는가. 3차 리뷰 H-1·M-1: 이 판정은 fail·pass 를 선점하지 않는다.
 * 확인 필요로 끝날 때만 얹는다.
 *
 * 참이 되려면 전부:
 *  · 믿을 수 있는 회사 시군구가 있고
 *  · region 조건의 값이 하나 이상이며 전부 사전 시군구이고
 *  · 그중 어느 것도 회사 시군구와 같지 않고
 *  · 그중 어느 것도 소재지 글자에 들어 있지 않다(본점·지점 두 곳 pass, M-1).
 */
function sigunguBlocksFit(c: StructuredCondition, p: BusinessProfile): boolean {
  const mine = trustedCompanySigungu(p);
  if (!mine || c.key !== "region" || !Array.isArray(c.value) || c.value.length === 0) return false;
  const names: string[] = [];
  for (const v of c.value) {
    if (typeof v !== "string") return false;
    const hit = sigunguSido(v);
    if (!hit) return false;
    names.push(hit.name);
  }
  if (names.some((n) => n === mine.name)) return false;
  const regionText = p.region ?? "";
  if (names.some((n) => profileNamesSigungu(regionText, n))) return false;
  return true;
}

export function checkCondition(c: StructuredCondition, p: BusinessProfile, now: Date): ConditionCheck {
  // 시군구 「맞음 금지」(2026-09-18 실측, 총괄 확인).
  // F1 의 같은 시도 확신 fail 은 화면 4,566건 중 5건만 바꿨다 — 태그 경로(`[경북] 영천시 …`)의
  // 시군구 조건은 2026-08-30 리뷰 결정으로 machineReadable=false(확인용) 라 곧바로 unknown 이 나와
  // fail 갈래에 도달하지 않기 때문이다(626개). 자격 있는 회사를 지울 위험이 크고 효과는 5건뿐이라
  // 확신 fail 은 접는다. 회사 시군구를 알고 조건과 다르면 「맞음」만 막으면 637건(14%)이 「맞음」에서
  // 「확인 필요」로 내려간다. 목록에서 지우지는 않는다. C(대상 유형)의 「모르면 맞음 금지」와 같다.
  // 3차 리뷰 H-1·M-1: 맞음 금지를 checkCondition 맨 앞에 두면 다른 시도의 확신 fail(영월군 × 서울
  // 강남구)과 소재지 글자가 이미 그 시군구를 담은 pass(본점·지점)를 선점한다. 그래서 「확인 필요」로
  // 끝날 때만 얹는다 — pass·fail 은 건드리지 않는다.
  const blockedFit = (): ConditionCheck => ({
    condition: c,
    verdict: "unknown",
    note: "다른 시군구 전용으로 보임 — 원문 확인",
    blocksFit: true,
  });
  if (!c.machineReadable) {
    // 4차 M-2: 비교 방식(op)이 어긋나 저장 단계에서 기계대조가 꺼진 조건은
    // 엔진이 스스로 「뜻을 확정할 수 없다」고 끈 것이라 맞음 금지를 주지 않는다.
    // 이 갈래가 opFitsKey 관문보다 앞서 판정 성격을 붙이던 자리 — 비교 방식이
    // 맞을 때만 맞음 금지를 건다. 어긋나면 아래 관문으로 보낸다.
    if (opFitsKey(c.key, c.op)) {
      return sigunguBlocksFit(c, p)
        ? blockedFit()
        : { condition: c, verdict: "unknown", note: "기계로 판정할 수 없는 조건 — 원문 확인" };
    }
  }
  // 「3년 이하」인데 op 가 gte 로 오면 대조가 거꾸로 돈다 — 읽기 단계에서 이미 걸러지지만 여기서도 막는다.
  if (!opFitsKey(c.key, c.op)) {
    return { condition: c, verdict: "unknown", note: "비교 방식이 조건과 맞지 않음 — 원문 확인" };
  }
  const unknown = (why: string): ConditionCheck => ({ condition: c, verdict: "unknown", note: why });
  const pass = (): ConditionCheck => ({ condition: c, verdict: "pass", note: "" });
  const fail = (why: string): ConditionCheck => ({ condition: c, verdict: "fail", note: why });
  switch (c.key) {
    case "region": {
      if (!p.region) return unknown("소재지 미입력");
      const list = c.value as string[];
      if (list.some((r) => r.includes(NATIONWIDE))) return pass();
      if (profileRegionIsNationwide(p.region)) return unknown("소재지가 「전국」 — 지역 조건은 원문 확인");
      const mine = canonicalRegion(p.region);
      const mineTrusted = trustedCompanySigungu(p);
      // ★fail 은 「확신 있을 때만」 낸다(적대 리뷰 2026-08-30 치명1 — 추천이 fail 을 목록
      // 제외로 격상한 뒤로, 확신 없는 fail 은 자격 있는 회사에게서 공고를 영영 지운다).
      //  · 항목에서 표준 시도가 하나라도 읽히면(「부산」·「대구경북」) 사전 대조 — 미일치는 확신 fail.
      //  · 시군구 사전 이름(「영월군」·어간 「구미」)은 회사 소재지에 그 이름/어간이 있으면 pass,
      //    회사 시군구를 믿을 수 있고 그 이름이면 pass(시도 칸과 모순이면 pass 금지 — 2차 리뷰 M-1),
      //    회사 시도를 읽었는데 다르면 확신 fail(이름이 다를 때). 조건 시군구 이름이 회사
      //    시군구와 같으면 시도가 어긋나도 fail 이 아니라 확인 필요(4차 M-1 — 모순으로 지우지 않는다).
      //    같은 시도이거나 시도를 못 읽으면 원문 확인.
      //    같은 시도인데 회사 시군구가 조건과 다른 「맞음 금지」는 아래 세 unknown 출구에만 얹는다
      //    (3차 리뷰 H-1·M-1 — fail·pass 를 선점하지 않는다).
      //  · 그 밖(「수도권」)은 글자 포함으로만 대조하고, 미일치는 fail 이 아니라 「확인 필요」.
      let sawDictionary = false;
      let sameSidoSigungu = false;
      let unreadSidoSigungu = false;
      for (const r of list) {
        // 사전 시군구(「제주시」·「부산진구」처럼 시도 별칭을 품은 이름 포함)는 시도 갈래보다 먼저 본다 —
        // 시도 갈래로 가면 같은 시도의 다른 시군구 회사가 pass 가 된다(2차 리뷰 지적 3).
        const sg = sigunguSido(r);
        if (sg) {
          // ★소재지 낱말 단위로 대조한다(독립 리뷰 2026-09-16 지적 1) — 공백을 지운 부분 포함으로 보면
          //  「성남시 분당구 구미동」⊃구미, 「남양주시」⊃양주시, 「강남대로」⊃강남 처럼 다른 곳이 pass 가 된다.
          //  낱말이 정확히 같으면 시도 문구가 옛 표기(「경상북도 군위군」)여도 pass 다(2차 리뷰 지적 2).
          if (profileNamesSigungu(p.region, sg.name)) return pass();
          if (mineTrusted && mineTrusted.name === sg.name) return pass();
          const mineSet = sidosInText(p.region);
          const sidoMatches = mineSet.includes(sg.sido) || (sg.formerSido != null && mineSet.includes(sg.formerSido));
          if (mineSet.length > 0 && !sidoMatches) {
            // 4차 M-1: 조건 시군구 이름이 회사 시군구와 같으면 시도 칸이 어긋나도
            // sawDictionary(확신 fail)를 세우지 않고 확인 필요(sameSidoSigungu)로 보낸다.
            // 두 칸이 모순이면 중립으로 떨어뜨린다 — 모순을 이유로 지우지 않는다.
            // 이름이 다른 경우(영월군 × 서울 강남구)는 지금 그대로 확신 fail.
            if (p.regionSigungu ? sigunguSido(p.regionSigungu)?.name === sg.name : false) sameSidoSigungu = true;
            else sawDictionary = true;
          } else if (mineSet.length > 0) sameSidoSigungu = true;
          else unreadSidoSigungu = true;
          continue;
        }
        const theirs = sidosInText(r);
        if (theirs.length > 0 && mine) {
          sawDictionary = true;
          if (theirs.includes(mine)) return pass();
          continue;
        }
        if (p.region.includes(r) || r.includes(p.region)) return pass();
      }
      // 같은 시도·시도를 못 읽은 시군구가 하나라도 있으면 그쪽 unknown 으로 떨어진다.
      // 「다른 시도」 fail(sawDictionary)은 예전부터 그 위에 있다 — 시도를 읽은 미일치는
      // 목록에 사전 밖 값이 섞여 있어도 확신 fail 이다.
      // F1 은 sawDictionary 를 두 unknown 보다 위에 두어, ["화성시","구미시"] × 경기(시군구 모름)가
      // 구미시(다른 시도) 때문에 fail 로 바뀌었다 — 화성시는 아직 모른다. 그래서 이 순서로 되돌린다.
      // 맞음 금지는 이 세 unknown 에만 얹는다 — pass·fail·「소재지가 전국」·비교 방식 불일치는 그대로다.
      if (sameSidoSigungu) {
        return sigunguBlocksFit(c, p) ? blockedFit() : unknown("같은 시도 — 시군구는 원문 확인");
      }
      if (unreadSidoSigungu) {
        return sigunguBlocksFit(c, p) ? blockedFit() : unknown("소재지의 시도를 못 읽음 — 시군구는 원문 확인");
      }
      if (sawDictionary) return fail(`대상 지역: ${list.join("·")}`);
      return sigunguBlocksFit(c, p)
        ? blockedFit()
        : unknown(`지역 표기를 확정하지 못해 원문 확인 필요 — 대상 지역: ${list.join("·")}`);
    }
    case "industry": {
      if (!p.industry) return unknown("업종 미입력");
      const list = c.value as string[];
      // 업종은 같은 일을 다른 이름으로 적는다(「소프트웨어 개발업」 vs 「정보통신업」).
      // 글자가 안 겹친다고 「안 됨」을 내면 자격 있는 회사를 떨어뜨린다 — 확인 필요로 둔다.
      return list.some((k) => p.industry!.includes(k))
        ? pass()
        : unknown(`업종 표기가 달라 확인 필요 — 대상 업종: ${list.join("·")}`);
    }
    case "targetSector": {
      if (!p.industry) return unknown("업종 미입력");
      const list = c.value as string[];
      // 사전 밖 이름(AI 가 「제약」처럼 적은 값)으로는 아무도 떨어뜨리지 않는다(독립 리뷰 미검증 위험).
      if (list.length === 0 || !list.every((f) => SECTOR_FAMILY_NAMES.has(f))) return unknown("분야 이름을 사전에서 못 찾음 — 원문 확인");
      const fams = sectorFamiliesOfIndustry(p.industry);
      if (fams.length === 0) return unknown("업종을 분야로 못 읽음 — 원문 확인");
      if (fams.some((f) => list.includes(f))) return pass();
      // 이웃 분야(콘텐츠↔정보통신·식품↔농림어업 …)면 fail 이 아니라 원문 확인이다 — fail 은 확신 있을 때만.
      const related = relatedFamiliesOf(list);
      if (fams.some((f) => related.has(f))) return unknown(`이웃 분야라 원문 확인 — 대상 분야: ${list.join("·")}`);
      return fail(`대상 분야: ${list.join("·")}`);
    }
    case "targetOrg": {
      const list = c.value as string[];
      // 사전 밖 이름(AI 가 지어낸 값)으로는 아무도 떨어뜨리지 않는다 — 자격은 모르면 fail 이 아니다.
      if (list.length === 0 || !list.every((t) => ORG_TYPE_NAMES.has(t))) {
        return unknown("대상 유형을 사전에서 못 찾음 — 원문 확인");
      }
      const raw = p.orgTypes;
      if (raw && raw.length > 0) {
        const mine = profileOrgTypes(raw);
        // 「주식회사」처럼 사전이 모르는 형태 문구는 자격을 부정하는 근거가 아니다 — 인증 사회적기업도 법인격은
        // 주식회사다(독립 리뷰 2026-09-17 H2). targetSector 와 같은 모양으로 원문 확인에 맡긴다.
        if (mine.length === 0) return unknown("기업 형태를 유형으로 못 읽음 — 원문 확인");
        return mine.some((t) => list.includes(t)) ? pass() : fail(`대상 유형: ${list.join("·")}`);
      }
      // 프로필에 형태가 없으면 **언제나** unknown 이다 — fail 이 아니라 「맞음 금지」다.
      // 예비창업자 전용이라도 fail 을 내지 않는다: 「예비창업자 및 재창업자 … 모집」(kiria 실측)처럼 사전 밖
      // 대상이 함께 적힌 제목을 「전용」으로 오인해 재창업자를 지웠다(독립 리뷰 2026-09-17 C1 치명).
      return unknown("기업 형태 미입력 — 자격 확인 필요");
    }
    case "businessAgeMaxYears": {
      const age = businessAgeYears(p.foundedDate, now);
      if (age == null) return unknown("설립일 미입력");
      if (age < 0) return unknown("설립일 확인 — 미래 날짜로 적혀 있음");
      return age <= (c.value as number) ? pass() : fail(`업력 ${c.value}년 이하만`);
    }
    case "businessAgeMinYears": {
      const age = businessAgeYears(p.foundedDate, now);
      if (age == null) return unknown("설립일 미입력");
      if (age < 0) return unknown("설립일 확인 — 미래 날짜로 적혀 있음");
      return age >= (c.value as number) ? pass() : fail(`업력 ${c.value}년 이상만`);
    }
    case "revenueMaxKrw":
      if (p.lastYearRevenueKrw == null) return unknown("연매출 미입력");
      return p.lastYearRevenueKrw <= (c.value as number) ? pass() : fail("매출 상한 초과");
    case "revenueMinKrw":
      if (p.lastYearRevenueKrw == null) return unknown("연매출 미입력");
      return p.lastYearRevenueKrw >= (c.value as number) ? pass() : fail("매출 하한 미달");
    case "employeeMax":
      if (p.employeeCount == null) return unknown("직원 수 미입력");
      return p.employeeCount <= (c.value as number) ? pass() : fail(`직원 ${c.value}명 이하만`);
    case "employeeMin":
      if (p.employeeCount == null) return unknown("직원 수 미입력");
      return p.employeeCount >= (c.value as number) ? pass() : fail(`직원 ${c.value}명 이상만`);
    case "companyScale": {
      if (!p.companyScale) return unknown("기업 규모 미입력");
      const list = c.value as string[];
      return list.some((s) => p.companyScale!.includes(s) || s.includes(p.companyScale!)) ? pass() : fail(`대상: ${list.join("·")}`);
    }
    case "noTaxDelinquency":
      if (p.taxDelinquent == null) return unknown("체납 여부 미입력");
      return p.taxDelinquent ? fail("세금 체납 시 신청 불가") : pass();
    // 우리 칸은 「있다/없다」만 안다 — 공고가 요구하는 종류(벤처·이노비즈·직무발명 …)까지는 모른다.
    // 그래서 보유는 통과로 올리지 않고 확인 필요로 둔다. 미보유는 어떤 종류든 안 되므로 그대로 불가.
    case "certRequired":
      if (p.hasCert == null) return unknown("인증 보유 미입력");
      return p.hasCert ? unknown("공고가 요구하는 종류와 맞는지 확인") : fail("요구 인증 미보유");
    case "patentRequired":
      if (p.hasPatent == null) return unknown("특허 보유 미입력");
      return p.hasPatent ? unknown("공고가 요구하는 종류와 맞는지 확인") : fail("특허 미보유");
    // ── 자금 조달 지도(2026-09-03) — 상시 상품 조건 4종.
    case "creditScoreMin": {
      if (p.creditScore == null) return unknown("신용점수 미입력");
      return p.creditScore >= (c.value as number) ? pass() : fail(`신용점수 ${c.value} 이상 필요`);
    }
    case "creditScoreMax": {
      if (p.creditScore == null) return unknown("신용점수 미입력");
      return p.creditScore <= (c.value as number) ? pass() : fail(`신용점수 ${c.value} 이하 대상`);
    }
    case "hasExistingLoan": {
      if (p.hasExistingLoan == null) return unknown("기존 대출 유무 미입력");
      return p.hasExistingLoan === (c.value as boolean)
        ? pass()
        : fail(c.value ? "기존 대출이 있어야 함(대환)" : "기존 대출 없는 사업자만");
    }
    case "isCorporation": {
      const mine = isCorporationByBizno(p.bizno);
      if (mine === null) return unknown("사업자번호로 법인 여부를 알 수 없음");
      return mine === (c.value as boolean) ? pass() : fail(c.value ? "법인만" : "개인사업자만");
    }
    default:
      return unknown("사전에 없는 조건");
  }
}

export interface MatchResult { grade: MatchGrade; checks: ConditionCheck[]; humanCheck: string[] }

/* ───────── 정밀 맞음 안전장치(2026-09-24 사장님 지시 「정확도 100%」) ─────────
 * 「맞음(fit)」·「신청 가능(possible)」은 **모든 자격이 확인된 공고에만** 준다. 조건 목록이 비었거나
 * 모자라도 공고 자체가 가르는 경우를 막는다 — 9/23 재측정에서 「대전 팁스타운」이 전남 회사에,
 * 「[강원] 청년창업자금」이 충남 회사에, 예비창업자 공고가 2024년 설립 회사에 「맞음」으로 떴다.
 * 여기 걸리면 목록에서 지우지 않고 「확인 필요」로 내린다(fail 을 만들지 않는다 — 제목 낱말만으로
 * 떨어뜨리면 「대전·충남 공동」 같은 공고를 잘못 지운다).
 */
/** 사전에서 겹쳐 뺀 시군구 이름(같은 이름이 여러 시도에 있다). 「맞음」 검사에서만 쓴다 — 판정(fail)에는 안 쓴다. */
const AMBIGUOUS_SIGUNGU = ["중구", "동구", "서구", "남구", "북구", "강서구", "광주시", "고성군"];

function isHangul(ch: string | undefined): boolean {
  if (!ch) return false;
  const code = ch.charCodeAt(0);
  return code >= 0xac00 && code <= 0xd7a3;
}

/**
 * 글 안의 시·군·구 이름 — 사전 이름(경계 기준) + 겹친 이름(경계 기준) + 붙여 쓴 「서울특별시광진구」의 뒷부분.
 * 「맞음」 안전장치 전용(2026-09-24 정밀 맞음, 리뷰 review-116b747b·7898081a·8c467476).
 */
export function subRegionNamesIn(text: string): string[] {
  const names = new Set<string>();
  for (const name of [...Object.keys(SIGUNGU_TO_SIDO), ...AMBIGUOUS_SIGUNGU]) {
    let from = 0;
    while (from <= text.length - name.length) {
      const i = text.indexOf(name, from);
      if (i < 0) break;
      const before = text.slice(0, i);
      const after = text.slice(i + name.length);
      // 왼쪽: 한글이 아니거나 시도 이름 바로 뒤(「서울특별시광진구」). 오른쪽: 한글이 아니거나 조사·「소재」류
      // (「광진구에 소재한」 — 리뷰 review-059ee0f4). 「강남구」 안의 「남구」, 「중구청」은 잡지 않는다.
      const leftOk = !isHangul(before.slice(-1)) || ALIAS_ENTRIES.some(([a]) => before.endsWith(a));
      const rightOk = !isHangul(after[0]) || /^(?:에서|에|의|은|는|이|가|을|를|과|와|으로|로|소재|지역|내|관내)/.test(after);
      if (leftOk && rightOk) { names.add(name); break; }
      from = i + 1;
    }
  }
  // 약칭(「수원 관내」의 수원) — 낱말 단위로 사전 어간을 본다(리뷰 review-afe4e27f).
  for (const token of text.split(/[^가-힣]+/)) {
    const bare = token.replace(/(?:에서|에|의|은|는|이|가|을|를|과|와|으로|로|소재|지역|관내|내)$/, "");
    if (bare.length < 2 || /[시군구]$/.test(bare)) continue;
    const hit = sigunguSido(bare);
    if (hit) names.add(hit.name);
  }
  return [...names];
}

/** 회사 시군구 이름(사전 이름 우선, 겹친 이름은 입력 그대로). */
function companySigunguName(p: BusinessProfile | undefined): string | null {
  const raw = (p?.regionSigungu ?? "").replace(/\s/g, "");
  if (!raw) return null;
  return sigunguSido(raw)?.name ?? raw;
}

/**
 * 지역 조건이 「통과」여도 조건 값에 시·군·구가 적혀 있으면, 회사 시군구가 그 이름 중 하나일 때만
 * 「맞음」의 근거가 된다. 판정(pass/fail)은 바꾸지 않는다 — 맞음만 막는다.
 */
/**
 * 조건 하나가 「맞음」의 근거가 될 만큼 확정인가(판정은 바꾸지 않는다 — 2026-09-24 정밀 맞음, 리뷰 6회).
 * 지역·업종·규모는 판정이 글자 포함으로 넓게 통과시키므로, 「맞음」에서는 더 엄격히 본다.
 */
/** 지역 원문에 남아도 되는 말(지역 이름을 지운 뒤). */
const REGION_FILLER = new Set([
  "소재", "소재한", "소재지", "위치한", "관내", "내", "지역", "지역의", "기업", "업체", "사업장", "본사", "주소지", "주사무소",
  "사업자", "중소기업", "소상공인", "에", "의", "을", "를", "이", "가", "은", "는", "둔", "있는", "두고", "및", "또는", "등",
  "전국", "도", "시", "군", "구", "특별시", "광역시", "특별자치시", "특별자치도",
]);
function regionRawTextIsPlain(raw: string): boolean {
  if (!raw.trim()) return true;
  let t = raw;
  // 시군구는 약칭(「구미」)으로도 적히므로 끝 글자(시·군·구)를 뗀 어간도 지운다.
  const names = subRegionNamesIn(raw).flatMap((n) => [n, n.replace(/[시군구]$/, "")]).filter((n) => n.length >= 2);
  for (const n of [...names, ...sidoWordsIn(raw)].sort((x, y) => y.length - x.length)) t = t.split(n).join(" ");
  const words = t.split(/[\s,·ㆍ()（）\[\]/:："'「」]+/).filter((w) => w.length > 0);
  return words.every((w) => REGION_FILLER.has(w));
}
function sidoWordsIn(raw: string): string[] {
  return (raw.match(/(?:서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충청북|충청남|충북|충남|전라북|전라남|전북|전남|경상북|경상남|경북|경남|제주)(?:특별자치도|특별자치시|특별시|광역시|도)?/g) ?? []);
}

export function conditionPassIsFitGrade(check: ConditionCheck, p: BusinessProfile | undefined): boolean {
  if (check.verdict !== "pass") return true;
  const key = check.condition.key;
  if (key === "industry") {
    // 조건 낱말이 회사 업종에서 **낱말 첫머리**로 나와야 한다 — 「비금속」 속 「금속」은 아니다.
    const mine = p?.industry ?? "";
    return (check.condition.value as unknown[]).map(String).some((k) => wordStartIn(mine, k));
  }
  if (key === "companyScale") {
    // 회사 규모가 조건 값과 **정확히** 같아야 한다 — 「중소기업」 ⊃ 「소기업」 글자 포함은 아니다.
    const mine = (p?.companyScale ?? "").replace(/\s/g, "");
    return (check.condition.value as unknown[]).map((v) => String(v).replace(/\s/g, "")).includes(mine);
  }
  if (key !== "region") return true;
  // 원문이 지역 이름과 허용된 말(소재·관내·기업 …)로만 이뤄져야 한다 — 「수원시 제외」·「수원시 외 지역」·「지원
  // 대상이 아님」처럼 빼는 말은 모양이 끝없이 많아 금지 목록으로는 못 막았다(15·16차 리뷰).
  if (!regionRawTextIsPlain(check.condition.rawText ?? "")) return false;
  // 원문에 시군구(약칭 포함)가 있으면 회사 시군구가 그중 하나여야 한다 — 값이 시도로 축약돼도(리뷰 review-afe4e27f).
  const rawNames = subRegionNamesIn(check.condition.rawText ?? "");
  if (rawNames.length > 0) {
    const mineSg = companySigunguName(p);
    if (!mineSg || !rawNames.includes(mineSg) || rawNames.length > 1) return false;
  }
  return regionPassIsFitGrade(check, p);
}

export function regionPassIsFitGrade(check: ConditionCheck, p: BusinessProfile | undefined): boolean {
  if (check.condition.key !== "region" || check.verdict !== "pass") return true;
  const mineSido = canonicalRegion(p?.region);
  const mineSg = companySigunguName(p);
  // ★허용 목록(2026-09-24, 리뷰 5회 끝) — 값이 아래 모양으로 **정확히** 떨어질 때만 「맞음」 근거로 쓴다.
  //  「전국」 한 낱말 · 시도 이름 하나 · 시군구 이름(약칭 포함) 하나 · 「시도+시군구」 하나.
  //  자유 문장(「전국(단, 서울 제외)」·「중구와 부산 강서구」·「○○시 관내」)은 글자 규칙으로 뜻을 확정할 수
  //  없어 「확인 필요」로 둔다 — 판정(pass/fail)은 그대로라 목록에서 빠지지 않는다.
  for (const v of (check.condition.value as unknown[]).map(String)) {
    const t = v.replace(/\s/g, "");
    if (t === NATIONWIDE) return true;
    const exactSido = ALIAS_ENTRIES.find(([a]) => a === t)?.[1];
    if (exactSido) {
      if (exactSido === mineSido) return true;
      continue;
    }
    const sg = sigunguSido(t);
    if (sg) {
      if (mineSg && sg.name === mineSg && (!mineSido || sg.sido === mineSido || sg.formerSido === mineSido)) return true;
      continue;
    }
    const alias = ALIAS_ENTRIES.find(([a]) => t.startsWith(a) && t.length > a.length);
    if (alias) {
      const rest = t.slice(alias[0].length);
      const name = sigunguSido(rest)?.name ?? (AMBIGUOUS_SIGUNGU.includes(rest) ? rest : null);
      if (name && mineSg && name === mineSg && alias[1] === mineSido) return true;
    }
  }
  return false;
}

export type StrictFitContext = {
  /** 공고 제목(상품명). */
  title?: string;
  /** 대조한 회사 정보. */
  profile?: BusinessProfile;
  /** 사람이 직접 확인해야 하는 조건 수(글을 모를 때 — 상품의 기계 못 읽는 조건 등). */
  humanCheck?: number;
  /** 사람이 직접 확인해야 하는 조건 글. 주면 결격 사항·지원내용 안내는 빼고 자격 관련만 센다(2026-09-24 사장님 결정). */
  humanCheckTexts?: string[];
  /**
   * 조건이 규칙 추출로만 뽑혔는가(AI 정리 미완료). 규칙 추출은 원문 조각을 잘못 잘라 엉뚱한 조건을
   * 「통과」로 만든다(9/23: 광고회사에 「치매의료기술연구개발」, 영등포 회사에 「광진구 사업장」 공고).
   */
  ruleOnly?: boolean;
  /**
   * 공고(지원사업)면 true — 「맞음」에 AI 의 업종 범위 판단을 요구한다. 제목 글자 규칙만으로는 한국어 표현
   * (조사·합성어·「○○업을 위한」)을 끝까지 못 막아 리뷰마다 새 구멍이 났다(1~11차). 금융상품은 쓰지 않는다.
   */
  requireIndustryScope?: boolean;
  /** AI 가 답한 업종 범위(없으면 옛 정리분 — 모름). */
  industryScope?: IndustryScope;
  /** 조건 대조 결과 — 업종 조건이 구체 분야로 맞았는지 본다. */
  checks?: ConditionCheck[];
};

/**
 * 지원사업 공고가 아닌 글 — 결과 발표·평가위원·매각·입찰·구인·초빙·설문·사칭 주의 안내.
 * 「채용」은 고용지원금 공고(「청년 채용 장려금」)도 써서 구인 글 모양만 막는다.
 */
const NON_PROGRAM =
  /선정\s*결과|결과\s*(?:공고|발표|안내)|합격자|최종\s*선정자|평가\s*위원|심사\s*위원|매각|입찰|낙찰|(?:직원|신규|경력|정규직|계약직)\s*채용|채용\s*공고|초빙|설문\s*조사|스팸|사칭/;

/** 기존 사업자는 대상이 아닌 공고 — 예비·재창업자 전용. */
const PRE_FOUNDER_ONLY = /예비\s*창업|재\s*창업|재도전/;

/**
 * 거의 모든 회사가 해당 없는 결격 사항(휴·폐업·허위신청·체납·중복지원·사치향락업 …) — 「맞음」을 막지 않고
 * 「신청 전 확인」으로 보인다(2026-09-24 사장님 결정: 결격 사항은 표시만).
 */
/** 어떤 공고의 대상도 될 수 없는 결격(부정·사행·중복수혜 …) — 문장에 있기만 하면 결격이다. */
const MORAL_DISQUALIFIER =
  /허위|부정한\s*방법|부정\s*수급|이해\s*관계|중복\s*(?:지원|수혜|신청)|불건전|사행|유흥|제재|참여\s*제한|적정하지\s*않다고|지원\s*결정\s*후|관외\s*이전|환수|보증\s*심사\s*규정|사치|향락|투기|퇴폐|무신고|횡령|영업\s*정지|행정\s*처분|결격|사회적\s*물의/;
/**
 * 지원 대상이 **될 수도 있는** 상태(폐업 지원·신용불량 기업 경영정상화·회생기업 …). 같은 조각에 빼는 말
 * (제외·불가·배제)이 있을 때만 결격으로 본다(6차 리뷰 — 제목만으로는 그런 공고를 다 못 알아본다).
 */
const STATE_DISQUALIFIER = /휴\s*[·ㆍ.,]?\s*폐업|폐업|휴업|체납|부도|신용\s*불량|연체|채무\s*불이행|파산|회생/;
const EXCLUDING_WORD = /제외|불가|배제/;
const GENERIC_DISQUALIFIER = new RegExp(`${MORAL_DISQUALIFIER.source}|${STATE_DISQUALIFIER.source}`);
/** 「상장기업」은 빼는 말(제외·불가)이 같은 조각에 있을 때만 결격이다 — 「코스닥 상장 기업」이 대상일 수 있다. */
const LISTED = /상장\s*(?:기업|법인|회사)/;
/**
 * 공고 자체가 결격 낱말을 대상으로 삼는 경우(폐업 지원·재기·채무조정·회생) — 그 공고에서는 결격 낱말이
 * 자격이다. 이런 제목이면 사람 확인 항목을 하나도 결격으로 빼지 않는다(2차 리뷰 2026-09-24).
 */
const DISTRESS_PROGRAM = /폐업|휴업|사업\s*정리|재기|재도전|재창업|희망\s*리턴|채무\s*조정|신용\s*회복|회생|파산|연체|부도|체납|원상\s*복구|점포\s*철거/;
/** 지원 내용·서류·절차 안내 — 자격이 아니다. */
const ADMIN_NOTE = /지원\s*내용|지원\s*규모|지원\s*금액|지원\s*한도|제출\s*서류|구비\s*서류|신청\s*방법|접수\s*방법|문의|개인정보|수집\s*·?\s*이용\s*동의|신청서|서식/;
/**
 * 결격·안내 낱말을 지운 뒤 **남아도 되는 말**(허용 목록). 남은 낱말이 전부 이것들로만 이뤄져야 결격 문장이다.
 * 자격 신호를 금지 목록으로 모으면 「중소기업만」·「소상공인」·「코스닥」처럼 목록 밖 말이 계속 샜다
 * (독립 리뷰 1~3차, 2026-09-24). 모르는 말이 하나라도 남으면 자격 문장으로 보고 「맞음」을 막는다.
 */
/**
 * 운영 AI 정리 공고의 결격 문장 19종(휴·폐업·부도·허위·체납 …)에서 결격 낱말을 지우고 남는 낱말만 — 낱말
 * **통째로** 맞아야 한다. 조각을 이어 붙이게 두면 「시」+「내」=「시내」, 「이력」+「있는」처럼 자격 말이 샌다(5차 리뷰).
 */
const FILLER_WORDS = new Set([
  "현재", "기업", "업체", "기업의", "기업이", "기업인", "기업은", "업체는", "중인", "중", "상태", "상태의", "상태인",
  "인", "경우", "또는", "나", "및", "등", "등이", "으로", "방법으로", "신청한", "국세", "지방세", "제외", "지원제외",
  "대표자", "자", "자인", "은", "는", "이", "가", "의", "불가", "배제",
]);
const ADMIN_FILLER_WORDS = new Set(["자세한", "세부", "상세", "공고문", "참조"]);
function onlyFiller(rest: string, admin: boolean): boolean {
  const words = rest.split(/[\s·ㆍ.,:：/※*'"「」『』~\-]+/).filter((w) => w.length > 0);
  return words.every((w) => FILLER_WORDS.has(w) || (admin && ADMIN_FILLER_WORDS.has(w)));
}
/**
 * 사람 확인 항목 중 **자격을 가르는 것**. 문장을 조각(괄호·쉼표·쌍반점·줄)으로 나눠, **모든 조각이**
 * 결격 낱말(체납·휴폐업·부정수급 …) 또는 지원내용·서류 안내 낱말 + 허용된 연결어로만 이뤄졌을 때만
 * 「맞음」을 막지 않는다. 문장 끝 모양(「경우」·「불가」·「한하여 신청」)으로는 가르지 않는다. 애매하면 막는다.
 */
export function substantiveHumanChecks(texts: readonly string[], title = ""): string[] {
  if (DISTRESS_PROGRAM.test(title)) return texts.filter((t) => t.trim().length > 0);
  return texts.filter((t) => {
    const s = t.trim();
    if (!s) return false;
    // 문장 전체에서 결격 낱말과 안내 문구가 섞였으면 괄호로 나눠도 빼는 말이 어디에 붙었는지 모른다(14차 리뷰).
    if (ADMIN_NOTE.test(s) && (MORAL_DISQUALIFIER.test(s) || STATE_DISQUALIFIER.test(s) || LISTED.test(s))) return true;
    const parts = s.split(/[()（）\[\],，;；\n]+/).map((x) => x.trim()).filter((x) => x.length > 0);
    return !parts.every((part) => {
      const body = part.replace(/지원\s*대상\s*에서\s*(?:제외|배제)/g, "제외");
      // 상태 낱말은 **하나만**, 빼는 말과 함께, 다른 결격과 섞이지 않았을 때만 결격이다 — 「신용불량 기업 중 휴업
      // 기업 제외」처럼 제외가 다른 상태에 붙으면 앞 상태(자격)까지 지워진다(8차 리뷰).
      // 대상이 **될 수 있는** 말(상태·상장)은 조각 안에 하나뿐이고, 빼는 말과 함께이며, 다른 결격과 섞이지 않았을
      // 때만 결격이다 — 「신용불량 기업 중 상장기업 제외」처럼 둘이면 제외가 어디에 붙는지 몰라 막는다(8·9차 리뷰).
      const states = body.match(new RegExp(STATE_DISQUALIFIER.source, "g")) ?? [];
      const listedHits = body.match(new RegExp(LISTED.source, "g")) ?? [];
      const moral = MORAL_DISQUALIFIER.test(body);
      const targetable = states.length + listedHits.length;
      // 안내 문구가 같은 조각에 있으면 빼는 말이 안내에 붙었을 수 있다 — 「회생 중인 기업 중 개인정보 수집·이용
      // 동의 불가 기업 제외」(12차 리뷰).
      const targetableCounts = targetable === 1 && EXCLUDING_WORD.test(body) && !moral && !ADMIN_NOTE.test(body);
      if (targetable > 0 && !targetableCounts) return false;
      // 결격 낱말과 안내 문구가 한 조각에 섞이면 빼는 말이 어디에 붙었는지 모른다 — 「영업 정지 중인 기업 중
      // 개인정보 수집·이용 동의 불가 기업 제외」(13차 리뷰).
      if (moral && ADMIN_NOTE.test(body)) return false;
      const stateCounts = targetableCounts && states.length === 1;
      const generic = moral || targetableCounts;
      const admin = ADMIN_NOTE.test(body);
      if (!generic && !admin) return false;
      // 상태 낱말(신용불량 …)은 빼는 말과 함께일 때만 결격이므로 그때만 지운다 — 안내 조각(「지원내용: 신용불량
      // 상태인 기업」)에서 조건 없이 지우면 자격이 샌다(7차 리뷰).
      let rest = body.replace(new RegExp(MORAL_DISQUALIFIER.source, "g"), " ");
      if (stateCounts) rest = rest.replace(new RegExp(STATE_DISQUALIFIER.source, "g"), " ");
      if (targetableCounts && listedHits.length === 1) rest = rest.replace(new RegExp(LISTED.source, "g"), " ");
      rest = rest.replace(new RegExp(ADMIN_NOTE.source, "g"), " ");
      // 대상을 좁히는 말이 남으면 자격 문장이다 — 연결어 조각(「한」+「하여」)으로 흩어져 새지 않게 먼저 본다(4차 리뷰).
      if (/한\s*하여|한\s*함|한정|에\s*한|만\s|만$|전용|대상|이상|이하|초과|미만|\d/.test(rest)) return false;
      return onlyFiller(rest, admin && /지원\s*내용/.test(body));
    });
  });
}

/**
 * 「맞음」 전용 제목 분야 낱말(2026-09-24 사장님 「업종이랑 전혀 관련 없는 걸 막아야」).
 * 판정용 분야 사전(sector.ts — 안 맞음을 낼 수 있다)과 따로 둔다 — 여기는 맞음만 막는다.
 * 교육·환경·유통·광고처럼 일반 공고에도 흔한 낱말은 넣지 않는다(「작업환경 개선」을 막지 않게).
 */
const TITLE_DOMAINS: Array<readonly [string, RegExp]> = [
  ["제약바이오", /의료|치매|바이오|제약|의약|헬스케어|신약|백신|진단기기|의료기기/],
  ["정보통신", /정보\s*통신|정보\s*기술|빅\s*데이터|소프트웨어|(?<![A-Za-z])SW(?![A-Za-z])|(?<![A-Za-z])IT(?![A-Za-z])|ICT|인공지능|(?<![A-Za-z])AI(?![A-Za-z])|블록체인|메타버스|클라우드|사이버\s*보안|정보보호/],
  ["반도체전자", /반도체|디스플레이|전자부품/],
  ["기계금속", /로봇|금속|뿌리\s*산업|소부장|소재\s*·?\s*부품|기계\s*산업/],
  ["에너지환경", /에너지|신재생|탄소\s*중립|수소|이차\s*전지|배터리/],
  ["자동차", /자동차|모빌리티|전기차/],
  ["조선해양", /조선|선박|해양/],
  ["콘텐츠", /콘텐츠|영상|영화|웹툰|애니메이션|게임|음악|출판|방송/],
  ["식품", /식품|푸드|외식|밀키트/],
  ["농림어업", /농업|어업|수산|축산|임업|산림|스마트\s*팜/],
  ["뷰티", /화장품|뷰티/],
  ["섬유패션", /섬유|패션|의류/],
  ["관광", /관광|여행/],
  ["건설", /건설|건축/],
  ["물류운수", /물류|운송|운수/],
];

/**
 * 판정용 분야 사전의 낱말도 **전부** 제목 분야로 읽는다 — 「맞음」 전용 목록만 보면 「음료 제조업 전용」이,
 * 흔한 낱말을 빼면 「교육업 전용」·「기계 제조업 전용」이 샜다(6·7차 리뷰). 대신 지원 **수단**으로 굳은 합성어만
 * 가린다(작업환경 개선·임대료 지원 …). 가림 목록에 없는 쓰임은 분야로 읽혀 「맞음」이 줄어드는 쪽으로 틀린다.
 * 영문 약어는 글자 경계가 필요해 TITLE_DOMAINS 가 맡는다.
 */
const TITLE_MEANS_MASK = [
  "작업환경", "작업 환경", "근무환경", "근무 환경", "경영환경", "경영 환경", "근로환경", "창업환경", "창업 환경",
  "임대료", "임차료", "교육훈련", "직무교육", "창업교육", "경영교육", "교육비", "광고비", "온라인 광고", "온라인광고",
  "판로", "판매망", "판매 촉진", "판매촉진", "홍보물", "기계설비", "설비 도입", "설비도입", "시설 설비", "디자인 개발",
  "플랫폼 입점", "전자상거래 입점",
];
/** 「업」으로 끝나도 업종이 아닌 말. */
const NOT_INDUSTRY_WORD =
  /(?:기업|사업|창업|산업|작업|영업|협업|직업|실업|졸업|분업|수업|개업|폐업|휴업|취업|학업|과업|잔업|스타트업)$|^(?:업|조업|성업)$/;

function titleWordsOf(f: (typeof SECTOR_FAMILIES)[number]): string[] {
  return [...f.announcementWords, ...f.companyWords].filter((w) => !/^[A-Za-z]+$/.test(w));
}

/**
 * AI 업종 범위 판단으로 맞음을 가른다. all 이면 통과. restricted 면 업종 조건이 **구체 분야**(사전이 아는 분야 —
 * 「제조업」처럼 넓은 말은 아님)로만 적혔고 그 조건이 맞음 수준으로 통과했으며 그 분야가 회사 업종과 이어질 때만.
 * 그 밖(모름·옛 정리분)은 막는다.
 */
function industryScopeBlock(ctx: StrictFitContext): string | null {
  // 업종 제한 공고는 회사 업종 글과 조건 글을 맞대는 것으로는 확정이 안 된다 — 「식품 포장용기 제조업」·「음ㆍ식료품
  // 및 담배 가공기계 제조업」처럼 글자가 겹쳐도 다른 업종이 계속 나왔다(12~16차 리뷰). 업종 제한이 있으면 항상
  // 사람이 확인한다(정확도 우선 — 대상 업체도 「확인 필요」로 내려가는 손해를 감수한다).
  if (ctx.industryScope === "restricted") return "업종 제한 공고 — 회사 업종 자격은 사람이 확인";
  if (ctx.industryScope !== "all") return "업종 제한 여부를 아직 확인하지 못함";
  // 제한 없음이라면서 업종 조건이 있으면 AI 답이 서로 어긋난다 — 믿지 않는다.
  if ((ctx.checks ?? []).some((c) => c.condition.key === "industry")) return "업종 범위 답과 업종 조건이 어긋남";
  return null;
}

/** 업종 낱말 뒤에 붙어도 되는 꼬리 — 없거나 업종을 뜻하는 말만. */
const INDUSTRY_TAIL =
  /^(?:|업|업체|업종|산업|기업|분야|제조|제조업|가공업|도매업|소매업|도소매업|판매업|유통업|서비스|서비스업|생산업|개발업|공급업|[A-Za-z0-9]*)$/;

function wordStartIn(text: string, word: string): boolean {
  const latinStart = /^[A-Za-z]/.test(word);
  const latinEnd = /[A-Za-z]$/.test(word);
  let i = text.indexOf(word);
  while (i >= 0) {
    const before = text[i - 1] ?? "";
    // 낱말 뒤 **같은 구절 전체**(쉼표·괄호·「및」 전까지)가 업종 꼬리여야 한다 — 「식품 포장용기 제조업」의
    // 「포장용기」처럼 공백 뒤 설명이 업종을 바꾸면 아니다(15차 리뷰).
    const clause = text.slice(i + word.length).split(/[,·ㆍ()/]|\s및\s/)[0];
    const tailWords = clause.split(/\s+/);
    const rest = tailWords[0] ?? "";
    const restOk = tailWords.slice(1).every((w) => w === "" || INDUSTRY_TAIL.test(w));
    // 앞: 한글·(영문으로 시작하면) 영문이 붙지 않음. 뒤: 영문으로 끝나면 영문이 붙지 않고, 한글이 붙으면 업종 꼬리
    // (업·제조업·산업 …)만 — 「식품가공기계」의 「식품」, 「CREDIT」의 「IT」는 아니다(13·14차 리뷰).
    const okBefore = !isHangul(before) && !(latinStart && /[A-Za-z]/.test(before));
    const okAfter = !(latinEnd && /^[A-Za-z]/.test(rest)) && INDUSTRY_TAIL.test(rest);
    if (okBefore && okAfter && restOk) return true;
    i = text.indexOf(word, i + 1);
  }
  return false;
}

/** 막을 이유(사람 말 한 줄) 또는 null. */
export function strictFitBlock(ctx: StrictFitContext): string | null {
  if (ctx.humanCheckTexts) {
    if (substantiveHumanChecks(ctx.humanCheckTexts, ctx.title ?? "").length > 0) return "자격 관련 사람 확인 조건이 있음";
  }
  if ((ctx.humanCheck ?? 0) > 0) return "사람이 직접 확인할 조건이 있음";
  if (ctx.ruleOnly) return "조건이 아직 AI 로 정리되지 않음";
  if (ctx.requireIndustryScope) {
    const block = industryScopeBlock(ctx);
    if (block) return block;
  }
  const title = ctx.title ?? "";
  if (!title) return null;
  if (NON_PROGRAM.test(title)) return "지원사업 공고가 아닌 글";
  // 제목의 지역 — 시군구 이름을 먼저 떼고 시도를 읽는다(「광주시」가 광주광역시로 읽히지 않게).
  // 여러 지역이 적혔거나 「제외」가 있으면 글자로 뜻을 확정할 수 없어 막는다(리뷰 review-641bb9db).
  const titleSigungu = subRegionNamesIn(title);
  const titleSidos = sidosInText(titleSigungu.reduce((t, n) => t.split(n).join(" "), title));
  if (titleSidos.length + titleSigungu.length > 0) {
    if (/제외/.test(title)) return "제목에 제외 지역이 있음";
    if (titleSidos.length > 1 || titleSigungu.length > 1) return "제목에 여러 지역이 있음";
  }
  if (titleSidos.length === 1) {
    const mine = canonicalRegion(ctx.profile?.region);
    if (!mine) return "제목에 지역이 있는데 회사 소재지를 모름";
    if (titleSidos[0] !== mine) return "제목의 지역이 회사 소재지와 다름";
  }
  // 시군구도 같은 규율 — 「창원시 벤처투자」가 양산 회사에, 「용인시 반도체」가 부천 회사에 떴다(9/23 재측정).
  if (titleSigungu.length === 1) {
    const mineSg = companySigunguName(ctx.profile);
    if (!mineSg) return "제목에 시군구가 있는데 회사 시군구를 모름";
    if (titleSigungu[0] !== mineSg) return "제목의 시군구가 회사와 다름";
  }
  if (PRE_FOUNDER_ONLY.test(title) && ctx.profile?.companyScale !== "예비창업자") {
    return "예비·재창업자 대상 공고";
  }
  // 업종 무관 차단 — 제목이 분야를 적었으면 회사 업종이 그 분야(이웃 포함)여야 「맞음」이다.
  const compounds = compoundFamiliesIn(title);
  if (compounds.unknown.length > 0) return "제목의 분야를 읽지 못함";
  // 뒤에 업종 표시(업·제조·기관 …)가 붙으면 수단이 아니라 대상이다 — 「기계설비 제조업」·「교육훈련기관」(8차 리뷰).
  // 수단 표현(개선·지원·도입 …)이 **바로 뒤에** 올 때만 가린다 — 업종 표시 목록으로 예외를 두면 「대행업」·
  // 「서비스업」·「유지보수업」이 계속 샜다(9차 리뷰). 모르는 쓰임은 분야로 읽혀 맞음이 줄어드는 쪽으로 틀린다.
  const masked = TITLE_MEANS_MASK.reduce(
    (t, m) => t.replace(new RegExp(`${m}(?=\\s*(?:개선|지원|비용|비|도입|구축|확충|활용|개척|확대|진출|조성)(?:사업|을|를|이|및)?(?![가-힣]))`, "g"), " "),
    maskCompounds(title),
  );
  // 제목이 적은 「○○업」(보험업·법률서비스업 …)은 사전에 없어도 대상 업종이다 — 회사 업종 글에 그 말이 없으면
  // 맞음 금지. 사전 분야로만 보면 사전 밖 업종이 전부 샜다(10차 리뷰). 기업·사업·창업 같은 말은 업종이 아니다.
  // 합성어 가림 전 글에서 뽑는다(「귀금속제조업」이 「제조업」으로 줄지 않게), 조사가 붙어도(「보험업을」) 뽑는다(11차 리뷰).
  const meansMasked = TITLE_MEANS_MASK.reduce(
    (t, m) => t.replace(new RegExp(`${m}(?=\\s*(?:개선|지원|비용|비|도입|구축|확충|활용|개척|확대|진출|조성)(?:사업|을|를|이|및)?(?![가-힣]))`, "g"), " "),
    title,
  );
  const industryWords = (meansMasked.match(
    /[가-힣]+?(?:업종|업체|업)(?=$|[^가-힣]|(?:을|를|이|가|은|는|의|에|과|와|도|으로|로|에서|만)(?:$|[^가-힣]))/g,
  ) ?? [])
    .map((w) => w.replace(/(?:업종|업체)$/, "업"))
    .filter((w) => !NOT_INDUSTRY_WORD.test(w));
  if (industryWords.length > 0) {
    const mineText = (ctx.profile?.industry ?? "").replace(/\s+/g, "");
    if (!mineText) return "제목에 업종이 있는데 회사 업종을 모름";
    if (industryWords.some((w) => !mineText.includes(w))) return "제목의 업종이 회사 업종과 다름";
  }
  const domains = [
    ...new Set([
      ...TITLE_DOMAINS.filter(([, re]) => re.test(masked)).map(([f]) => f),
      ...SECTOR_FAMILIES.filter((f) => titleWordsOf(f).some((w) => masked.includes(w))).map((f) => f.family),
      ...compounds.families,
    ]),
  ];
  if (domains.length > 0) {
    const mine = sectorFamiliesOfIndustry(ctx.profile?.industry ?? "");
    if (mine.length === 0) return "제목에 분야가 있는데 회사 업종을 분야로 못 읽음";
    // 적힌 분야가 **모두** 회사 업종과 이어져야 한다 — 하나만 맞아도 통과시키면 「식품제조업 전용 홍보영상」이
    // 「영상」 하나로 광고회사에 맞음이 된다(독립 리뷰 review-1b329d8d). 업종 조건으로 분야를 면제하는 규칙은
    // 선택지 중 무엇이 맞았는지 모르는 탓에 구멍이 계속 나서 없앴다(4차 리뷰) — 대상 업체가 「확인 필요」로
    // 내려가는 손해는 정확도 우선(사장님 「정확도 100%」)으로 감수한다.
    const unrelated = domains.filter((d) => !mine.some((f) => relatedFamiliesOf([d]).has(f)));
    if (unrelated.length > 0) return "회사 업종과 관련 없는 분야의 공고";
  }
  return null;
}

export function matchAnnouncement(
  s: AnnouncementStructure,
  p: BusinessProfile,
  now = new Date(),
  opts: { title?: string } = {},
): MatchResult {
  const checks = s.conditions.map((c) => checkCondition(c, p, now));
  // humanCheck 는 칩으로 개수를 보이고, 「신청 가능」은 막는다(정밀 맞음 — 사람이 확인할 게 남았다).
  let grade = gradeOf(checks);
  if (
    grade === "possible"
    && (checks.some((c) => c.blocksFit || !conditionPassIsFitGrade(c, p))
      || strictFitBlock({
        title: opts.title, profile: p, humanCheckTexts: s.humanCheck,
        requireIndustryScope: true, industryScope: s.industryScope, checks,
      }))
  ) {
    grade = "uncertain";
  }
  return { grade, checks, humanCheck: s.humanCheck };
}

/* ───────── 저장된 구조화 JSON → 대조 가능한 모양 (통로 두 곳이 같은 해석을 쓰게) ─────────
 * 저장된 값은 AI 산출물이라 모양이 어긋날 수 있다. 어긋난 조건을 **조용히 버리면**
 * 「못 받는 공고」가 「받을 수 있음」으로 둔갑한다 — 그래서 못 읽은 조건은 반드시
 * humanCheck(사람 확인 필요)로 옮겨 등급이 애매 아래로 못 내려가게 한다. */

export const UNREADABLE_STRUCTURE_NOTE = "구조화 결과를 읽지 못했습니다 — 공고 원문을 직접 확인하세요";

const OPS: readonly string[] = ["in", "lte", "gte", "eq"];

/** key 와 value 모양이 안 맞으면 기계대조 금지(structurize 의 저장 규칙과 같은 판단). */
function valueFitsKey(key: string, value: unknown): boolean {
  switch (key) {
    case "region":
    case "industry":
    case "targetSector":
    case "targetOrg":
    case "companyScale":
      return Array.isArray(value) && value.every((v) => typeof v === "string");
    case "businessAgeMaxYears":
    case "businessAgeMinYears":
    case "revenueMaxKrw":
    case "revenueMinKrw":
    case "employeeMax":
    case "employeeMin":
    case "creditScoreMin":
    case "creditScoreMax":
      return typeof value === "number" && Number.isFinite(value);
    case "noTaxDelinquency":
    case "certRequired":
    case "patentRequired":
    case "hasExistingLoan":
    case "isCorporation":
      return typeof value === "boolean";
    default:
      return false; // other 를 포함한 사전 밖 조건
  }
}

function readCondition(raw: unknown): StructuredCondition | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const key = typeof o.key === "string" ? o.key : "";
  const op = typeof o.op === "string" && OPS.includes(o.op) ? o.op : "";
  const rawText = typeof o.rawText === "string" ? o.rawText.trim() : "";
  if (!key || !op || !rawText) return null;
  const value = o.value;
  const usable =
    Array.isArray(value) || typeof value === "number" || typeof value === "boolean" ? value : null;
  if (usable === null) return null;
  return {
    key: key as StructuredCondition["key"],
    op: op as StructuredCondition["op"],
    value: usable as StructuredCondition["value"],
    rawText,
    // 값 모양이나 비교 방식이 어긋나면 대조하지 않는다 — 대조하면 판정이 아니라 오류·뒤집힘이 된다.
    machineReadable: o.machineReadable === true && valueFitsKey(key, usable) && opFitsKey(key, op),
  };
}

export function readStoredStructure(raw: unknown): AnnouncementStructure {
  const s: AnnouncementStructure = {
    benefitSummary: "",
    supportAmountText: "",
    aiSummary: { purpose: "", target: "", scale: "", scaleItems: [] },
    conditions: [],
    humanCheck: [],
    documents: [],
    verified: false,
  };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    s.humanCheck = [UNREADABLE_STRUCTURE_NOTE];
    return s;
  }
  const o = raw as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  s.benefitSummary = str(o.benefitSummary);
  s.supportAmountText = str(o.supportAmountText);
  const ai = o.aiSummary && typeof o.aiSummary === "object" ? (o.aiSummary as Record<string, unknown>) : {};
  s.aiSummary = {
    purpose: str(ai.purpose),
    target: str(ai.target),
    scale: str(ai.scale),
    scaleItems: Array.isArray(ai.scaleItems)
      ? ai.scaleItems.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean)
      : [],
  };
  s.documents = Array.isArray(o.documents) ? o.documents.filter((d): d is string => typeof d === "string") : [];
  s.verified = o.verified === true;
  if (o.industryScope === "all" || o.industryScope === "restricted" || o.industryScope === "unknown") {
    s.industryScope = o.industryScope;
  }

  const human: string[] = Array.isArray(o.humanCheck)
    ? o.humanCheck.filter((h): h is string => typeof h === "string" && h.trim() !== "")
    : [];
  if (!Array.isArray(o.conditions)) {
    human.push(UNREADABLE_STRUCTURE_NOTE);
  } else {
    for (const c of o.conditions) {
      const parsed = readCondition(c);
      if (parsed) {
        s.conditions.push(parsed);
        // 비교 방식이 뒤집힌 조건은 「대조 안 함」에 그치지 않고 사람 확인 목록에도 올린다
        // — 체크리스트의 물음표만으로는 등급이 「가능」으로 남을 수 있다.
        if (!opFitsKey(parsed.key, parsed.op)) human.push(parsed.rawText);
        continue;
      }
      const text = c && typeof c === "object" ? (c as { rawText?: unknown }).rawText : undefined;
      human.push(typeof text === "string" && text.trim() ? text.trim() : UNREADABLE_STRUCTURE_NOTE);
    }
  }
  s.humanCheck = [...new Set(human)];
  return s;
}

/* ───────── 바깥에서 들어온 값 → BusinessProfile (통로 두 곳이 같은 해석을 쓰게) ─────────
 * 판정 안전 원칙: 모르는 값은 undefined 로 남긴다. 억지로 0·false 로 채우면
 * 「모름」이 「충족」으로 둔갑해 고객에게 틀린 안내가 나간다. */

function textOf(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t || undefined;
}

/** 숫자 또는 숫자 문자열("1,000,000")만 받는다. 음수·NaN·글자는 모름. */
function numberOf(v: unknown): number | undefined {
  const n =
    typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v.replace(/[,\s]/g, "")) : Number.NaN;
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/** 참/거짓만 받는다 — "예"·"아니오" 같은 표기 해석은 값을 만드는 쪽(불러오기)에서 끝낸다. */
function boolOf(v: unknown): boolean | undefined {
  return typeof v === "boolean" ? v : undefined;
}

/** 문자열 배열이면 그대로, 문자열이면 한 칸 배열. 빈 값·공백은 모름. */
function stringListOf(v: unknown): string[] | undefined {
  if (Array.isArray(v)) {
    const list = v.filter((x): x is string => typeof x === "string").map((s) => s.trim()).filter(Boolean);
    return list.length > 0 ? list : undefined;
  }
  const t = textOf(v);
  return t !== undefined ? [t] : undefined;
}

export function parseBusinessProfile(raw: unknown): BusinessProfile {
  if (!raw || typeof raw !== "object") return {};
  const o = raw as Record<string, unknown>;
  const p: BusinessProfile = {};
  const setText = (
    k: "companyName" | "bizno" | "industry" | "region" | "regionSigungu" | "foundedDate" | "companyScale",
  ) => {
    const v = textOf(o[k]);
    if (v !== undefined) p[k] = v;
  };
  setText("companyName");
  setText("bizno");
  setText("industry");
  setText("region");
  setText("regionSigungu");
  setText("foundedDate");
  setText("companyScale");
  const orgTypes = stringListOf(o.orgTypes);
  if (orgTypes !== undefined) p.orgTypes = orgTypes;
  const revenue = numberOf(o.lastYearRevenueKrw);
  if (revenue !== undefined) p.lastYearRevenueKrw = revenue;
  const employees = numberOf(o.employeeCount);
  if (employees !== undefined) p.employeeCount = employees;
  const tax = boolOf(o.taxDelinquent);
  if (tax !== undefined) p.taxDelinquent = tax;
  const cert = boolOf(o.hasCert);
  if (cert !== undefined) p.hasCert = cert;
  const patent = boolOf(o.hasPatent);
  if (patent !== undefined) p.hasPatent = patent;
  // ── 자금 조달 지도(2026-09-03) — 신용점수·기존 대출.
  // 신용점수는 300~1000 밖이면 잘못 들어온 값이라 버린다(등급 850 을 점수로 적는 실수 등).
  const credit = numberOf(o.creditScore);
  if (credit !== undefined && credit >= 300 && credit <= 1000) p.creditScore = credit;
  // 화면 라디오가 "yes"/"no" 로 보내는 자리가 있어 두 표기만 추가로 읽는다.
  const loan =
    boolOf(o.hasExistingLoan) ??
    (o.hasExistingLoan === "yes" ? true : o.hasExistingLoan === "no" ? false : undefined);
  if (loan !== undefined) p.hasExistingLoan = loan;
  return p;
}
