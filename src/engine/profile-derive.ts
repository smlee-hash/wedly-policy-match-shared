/**
 * 서류·입력으로 들어온 새 칸에서, 판정이 실제로 읽는 옛 칸을 채운다 — 순수 함수(저장·네트워크 없음).
 *
 * 새 칸: certTypes · patentCount · existingLoanBalanceManwon · creditScoreNice · creditScoreKcb · businessAddress
 * 옛 칸: hasCert · hasPatent · hasExistingLoan · creditScore · region · regionSigungu · orgTypes
 *
 * ★새 칸이 없으면 옛 칸을 **건드리지 않는다.** 옛 저장값(creditScore 하나·hasCert 만)이 그대로 살아야
 *  이미 저장된 회사 프로필의 판정이 바뀌지 않는다.
 * ★입력 객체는 바꾸지 않고 새 객체를 돌려준다.
 */
import { REGION_ALIASES, canonicalRegion, type BusinessProfile } from "./match-engine";
import { sigunguSido } from "./sigungu";

/** 인증 종류로 고를 수 있는 이름. 「없음」은 다른 종류와 함께 쓰지 않는다(함께 오면 종류가 이긴다). */
export const CERT_TYPE_NAMES = ["벤처", "이노비즈", "메인비즈", "ISO", "여성기업", "사회적기업", "기타", "없음"] as const;

/** 인증 종류 중 기업 형태(orgTypes)로도 읽히는 것. */
const CERT_AS_ORG_TYPE = ["여성기업", "사회적기업"];

const CREDIT_MIN = 300;
const CREDIT_MAX = 1000;

function nonNegative(n: number | undefined): n is number {
  return typeof n === "number" && Number.isFinite(n) && n >= 0;
}

function creditOf(n: number | undefined): number | null {
  return typeof n === "number" && Number.isFinite(n) && n >= CREDIT_MIN && n <= CREDIT_MAX ? n : null;
}

/** 우편번호(「(12345)」·「12345」)를 앞에서 뗀다. */
const POSTAL_RE = /^\(?\d{5}\)?[\s,]*/;
/** 시군구 이름 모양 — 「화성시」·「강남구」·「중구」. 사전에 있는지는 따로 본다. */
const SIGUNGU_SHAPE = /^[가-힣]{1,8}[시군구]$/;
/** 주소 앞쪽 몇 토막만 본다 — 뒤쪽은 도로명·건물명이라 시군구로 읽으면 오판한다. */
const NAME_WINDOW = 3;

export interface AddressRegion {
  region?: string;
  /** 사전(sigungu.ts)에 있는 이름만. 중구·서구처럼 사전이 뺀 곳은 비운다 */
  regionSigungu?: string;
  /** 「경기 화성시」 — 시도 + 시군구까지만. 도로명·번지·건물명은 절대 담지 않는다 */
  shortAddress?: string;
}

/**
 * 주소 앞부분에서 시도와 시군구를 읽는다. 시도는 별칭(「경기도」·「서울특별시」 …)을 표준형으로 바꾼다.
 * 시도 없이 사전에 있는 시군구로 시작하면(「화성시 …」) 시도도 사전에서 채운다.
 * 시도와 시군구가 서로 어긋나면(「서울 화성시」) 시군구는 채우지 않는다.
 */
export function readRegionFromAddress(address: string | undefined): AddressRegion {
  const text = (address ?? "").normalize("NFC").trim().replace(POSTAL_RE, "");
  const tokens = text.split(/[\s,()（）[\]]+/).filter(Boolean);
  if (tokens.length === 0) return {};

  const first = tokens[0];
  let region: string | undefined;
  let names: string[] = tokens;
  const canon = canonicalRegion(first);
  if (canon) {
    const alias = [...REGION_ALIASES[canon]].sort((a, b) => b.length - a.length).find((a) => first.startsWith(a)) ?? "";
    const left = first.slice(alias.length);
    if (left === "") {
      region = canon;
      names = tokens.slice(1);
    } else if (left.length >= 2) {
      // 붙여 쓴 표기(「경기도화성시」) — 시도 별칭을 떼고 남은 글자를 시군구 후보로 본다.
      region = canon;
      names = [left, ...tokens.slice(1)];
    }
    // 「제주시」·「광주시」처럼 시도 별칭으로 시작하는 시 이름은 시도를 여기서 정하지 않는다 — 사전이 정한다.
  }

  let regionSigungu: string | undefined;
  let sigunguText: string | undefined;
  for (const name of names.slice(0, NAME_WINDOW)) {
    const hit = sigunguSido(name);
    if (hit && (!region || hit.sido === region || hit.formerSido === region)) {
      regionSigungu = hit.name;
      sigunguText = hit.name;
      region ??= hit.sido;
      break;
    }
    if (SIGUNGU_SHAPE.test(name)) {
      sigunguText = name;
      break;
    }
  }

  if (!region) return {};
  const out: AddressRegion = { region, shortAddress: sigunguText ? `${region} ${sigunguText}` : region };
  if (regionSigungu) out.regionSigungu = regionSigungu;
  return out;
}

/** 시군구가 그 시도(또는 옛 시도)에 속하는가. 사전에 없는 이름은 가릴 수 없으니 어긋난다고 보지 않는다. */
function sigunguFitsRegion(sigungu: string, region: string): boolean {
  const hit = sigunguSido(sigungu);
  return !hit || hit.sido === region || hit.formerSido === region;
}

export function deriveProfileFlags(p: BusinessProfile): BusinessProfile {
  const out: BusinessProfile = { ...p };
  if (p.orgTypes) out.orgTypes = [...p.orgTypes];
  if (p.certTypes) out.certTypes = [...p.certTypes];

  // 인증 — 「없음」만 있으면 없음, 그 밖의 종류가 하나라도 있으면 있음. 비었으면 옛 값 유지.
  const certs = (p.certTypes ?? []).map((c) => c.trim()).filter(Boolean);
  if (certs.length > 0) {
    out.hasCert = certs.some((c) => c !== "없음");
    const orgTypes = out.orgTypes ?? [];
    for (const c of CERT_AS_ORG_TYPE) {
      if (certs.includes(c) && !orgTypes.includes(c)) orgTypes.push(c);
    }
    if (orgTypes.length > 0) out.orgTypes = orgTypes;
  }

  if (nonNegative(p.patentCount)) out.hasPatent = p.patentCount >= 1;
  if (nonNegative(p.existingLoanBalanceManwon)) out.hasExistingLoan = p.existingLoanBalanceManwon >= 1;

  const scores = [creditOf(p.creditScoreNice), creditOf(p.creditScoreKcb)].filter((s): s is number => s !== null);
  if (scores.length > 0) out.creditScore = Math.min(...scores);

  if (p.businessAddress?.trim()) {
    const read = readRegionFromAddress(p.businessAddress);
    if (read.region) {
      out.region = read.region;
      if (read.regionSigungu) out.regionSigungu = read.regionSigungu;
      else if (out.regionSigungu && !sigunguFitsRegion(out.regionSigungu, read.region)) delete out.regionSigungu;
    }
  }
  return out;
}
