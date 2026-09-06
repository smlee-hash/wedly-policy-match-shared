// 보조금24(gov24 serviceList) 어댑터.
// 호출: GET api.odcloud.kr/api/gov24/v3/serviceList?page=n&perPage=100&serviceKey=DATA_GO_KR_API_KEY
// 응답 칸(2026-08-26 실측 고정본): data[], 서비스ID, 서비스명, 소관기관명, 지원대상,
//   **선정기준**, 사용자구분, 상세조회URL, 신청기한, 서비스목적요약, 서비스분야. matchCount 10,957.
//   ⚠️ `선정기준` 은 2026-09-01 부터 담을지 말지 판정의 절반을 맡는다(isBusinessRelevant).
//   이 칸이 사라지면 통과 건수가 조용히 줄고, sync 의 「절반 미만이면 닫기 건너뜀」이 발동해
//   알아채기 어렵다 — 고정본으로 칸 존재를 시험이 지킨다(적대 리뷰 사소).
import { parseApplyPeriod, type NormalizedAnnouncement } from "../types";

const BASE = "https://api.odcloud.kr/api/gov24/v3/serviceList";
const PAGE_UNIT = 100;
const ABSOLUTE_MAX_PAGES = 130;
export const FETCH_TIMEOUT_MS = 30_000;

export function bojo24PageCap(matchCount: number): number {
  return Math.min(ABSOLUTE_MAX_PAGES, Math.ceil(matchCount / PAGE_UNIT) + 2);
}

type Raw = Record<string, unknown>;
const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");

export function extractBojo24Items(json: unknown): Raw[] {
  if (json && typeof json === "object" && Array.isArray((json as Raw).data)) {
    return (json as Raw).data as Raw[];
  }
  throw new Error("보조금24 응답에 data 배열이 없습니다");
}

function readMatchCount(json: unknown): number | null {
  if (!json || typeof json !== "object") return null;
  const v = (json as Raw).matchCount;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * 원본이 붙인 사용자구분 표시. **이것만 믿으면 샌다** — 2026-09-01 원본 10,968건 전량 실측에서
 * 두루누리(사회보험사각지대해소)·혁신 소상공인 창업지원·소규모사업장 근로자 건강상담이
 * 전부 「개인」으로 표시돼 버려지고 있었다.
 */
export function isBusinessAudience(item: Raw): boolean {
  const t = s(item["사용자구분"]);
  return t.includes("소상공인") || t.includes("법인/시설/단체");
}

/**
 * 사업주(고용주·법인·개인사업자)가 신청 주체일 수 있음을 드러내는 말.
 *
 * `사업장(?!가입자)` — 「국민연금 사업장가입자였던 자」처럼 **배경**을 가리키는 자리가 흔하다(적대 리뷰 ⑥).
 * `사업자등록(?!\s*여부)` — 「사업자등록 여부 무관」 같은 부정문에서 자주 나온다.
 */
const EMPLOYER_SIGNAL =
  /사업주|사업장(?!가입자)|고용주|중소기업|중견기업|소기업|소상공인|소공인|자영업|개인사업자|법인사업자|사업자등록(?!\s*여부)|창업|벤처기업|스타트업|제조업|공장|기업부설|상시\s*근로자|근로자를\s*고용/;

/**
 * 1차산업 사업주(농·어·임업). 개인사업자이지만 사업주다 — 사장님 2026-09-01 결정으로 포함.
 *
 * `어가`·`어선`·`농가` 는 앞뒤를 막았다 — 안 막으면 「만들**어가**는」·「되**어선**」·「귀**농가**구」에
 * 걸려 순수 복지 공고가 담긴다(적대 리뷰 ⑤ 실측: 「행복 돌봄 지원」·「아이 돌봄 서비스」).
 */
const PRIMARY_SIGNAL =
  /농업인|어업인|임업인|축산업|영농|영어조합|양식업|귀농|귀어|귀산|(?<![가-힣])(?:농가|어가|어선)(?![가-힣])|농어업|농어촌|어촌|농촌|산촌|수산업경영인|산림경영|농업경영체|어업경영체/;

/**
 * 서비스「명」이 이러면 개인복지로 본다. 단 **지원대상·선정기준에 강한 사업주 신호가 없을 때만**이다.
 *
 * 왜 조건부인가(적대 리뷰 ④ 실측): 이름만 보고 잘랐더니 「소상공인 임차료(월세) 지원」·
 * 「지역화폐 가맹점 결제수수료 지원」·「소상공인 재해위로금」·「장기요양기관 운영 사업주 처우개선비」가
 * 전부 버려졌다. 지원대상에 「관내 소상공인 사업자」라고 대놓고 적혀 있는데도 이름의 '월세'·'지역화폐'가
 * 이겼다. 이 커밋의 전제가 「원본 표시를 못 믿는다」인데, 구멍이 바로 그 모집단에 뚫려 있었다.
 * 「고용장려금」류를 죽이지 않도록 `장려금` 이 아니라 `자녀장려금` 처럼 좁게 적는다.
 */
const PERSONAL_WELFARE =
  /장학|한부모|노숙인|기초연금|기초생활|긴급복지|아동수당|보육료|양육비|자녀장려금|난임|치매|예방접종|의료급여|주거급여|월세|전세자금|장애인\s*연금|참전|보훈|상병수당|실업급여|구직급여|국가유공|재해위로금|진폐|지역화폐|상품권/;

/**
 * 이름이 개인복지로 보여도 이게 지원대상·선정기준에 있으면 사업주 공고로 본다.
 * **좁게 적는다** — 「사업을 영위하는 가구」처럼 복지 공고에도 흔한 표현을 넣었더니
 * 「근로·자녀장려금」(가구 대상 세제 혜택)이 통과했다. 신청 주체를 못 박는 말만 남긴다.
 */
const STRONG_EMPLOYER =
  /소상공인|소공인|사업주|중소기업|중견기업|자영업|개인사업자|법인사업자|사업자등록증/;

/**
 * 사업주에게 필요한 공고인가. 원본 표시 **또는** 글자 신호로 판정한다.
 *
 * 넓게 담는 쪽이 옳다 — 잘못 버리면 그 회사는 자기 공고를 영영 못 본다
 * (사장님 2026-09-01 「단 1건도 놓치면 안 된다」).
 * ⚠️ 다만 **뒤에서 「기업용/개인용」을 다시 거르는 관문은 없다**(적대 리뷰 ⑦ — 추천·진단은
 * 조건 대조만 한다). 그래서 여기서 새는 것은 그대로 고객 화면에 뜬다고 보고 신호를 좁게 잡는다.
 */
export function isBusinessRelevant(item: Raw): boolean {
  if (isBusinessAudience(item)) return true;
  const name = s(item["서비스명"]);
  const body = `${s(item["지원대상"])} ${s(item["선정기준"])}`;
  if (PERSONAL_WELFARE.test(name) && !STRONG_EMPLOYER.test(body)) return false;
  const text = `${name} ${body}`;
  return EMPLOYER_SIGNAL.test(text) || PRIMARY_SIGNAL.test(text);
}

/**
 * 소관기관이 지자체면 그 이름을 지역 칸에 싣는다.
 *
 * 왜(적대 리뷰 ⑧ · 운영 실측): 보조금24는 지역 칸을 안 준다. 그대로 두니 열린 3,056건이 전부
 * `region=""` 이고 **그중 1,733건이 시·군·구 소관**이었다. 지역 조건이 하나도 없으니
 * 「안동시 축사관리용 CCTV 지원」이 서울 회사에게 「맞음」으로 뜨고, 반대로 공고 목록의
 * 지역 필터에서는 통째로 사라진다. 소관기관명을 실어 두면 하류의 `sidosInText` 가 광역을 읽어
 * 그 광역 밖 회사를 걸러 낸다(시군구까지 좁히는 것은 사전이 없어 아직 못 한다 — 별도 과제).
 *
 * 중앙부처(고용노동부·중소벤처기업부 등)는 전국이므로 빈 값으로 둔다.
 */
const LOCAL_GOV_TAIL = /(?:특별시|광역시|특별자치시|특별자치도|[가-힣]{2,}도|[가-힣]{2,}시|[가-힣]{2,}군|[가-힣]{2,}구)$/;

export function regionFromAgency(agency: string): string {
  const a = agency.trim();
  if (!a) return "";
  const last = a.split(/\s+/).pop() ?? "";
  return LOCAL_GOV_TAIL.test(last) ? a : "";
}

export function normalizeBojo24Item(item: Raw): NormalizedAnnouncement {
  const periodText = s(item["신청기한"]);
  const { start, end } = parseApplyPeriod(periodText);
  const link = s(item["상세조회URL"]);
  const target = s(item["지원대상"]);
  const criteria = s(item["선정기준"]);
  return {
    source: "bojo24",
    sourceId: s(item["서비스ID"]) || link,
    title: s(item["서비스명"]),
    agency: s(item["소관기관명"]),
    category: s(item["서비스분야"]),
    region: regionFromAgency(s(item["소관기관명"])),
    summary: s(item["서비스목적요약"]),
    targetText: criteria ? `${target}\n[선정기준]\n${criteria}` : target,
    applyStart: start,
    applyEnd: end,
    applyPeriodText: periodText,
    url: link,
    attachments: [],
    raw: item,
  };
}

/** 공고번호·링크가 둘 다 비면 저장하지 않는다. 거른 수는 로그로 남긴다. */
export function keepIdentifiable(list: NormalizedAnnouncement[]): NormalizedAnnouncement[] {
  const kept = list.filter((a) => a.sourceId || a.url);
  const dropped = list.length - kept.length;
  if (dropped > 0) {
    console.warn(`[policy-match] 보조금24 식별불가 ${dropped}건 제외 (공고번호·링크 둘 다 없음)`);
  }
  return kept;
}

export function announcementsFromBojo24Json(json: unknown): NormalizedAnnouncement[] {
  const items = extractBojo24Items(json);
  const kept = items.filter(isBusinessRelevant);
  const dropped = items.length - kept.length;
  if (dropped > 0) {
    console.warn(`[policy-match] 보조금24 사업주 무관 제외 ${dropped}건 (사업주·농어임업 신호 없음)`);
  }
  return keepIdentifiable(kept.map(normalizeBojo24Item));
}

export async function fetchBojo24All(): Promise<NormalizedAnnouncement[]> {
  const key = process.env.DATA_GO_KR_API_KEY;
  if (!key) throw new Error("DATA_GO_KR_API_KEY 없음");
  const pages: Raw[] = [];
  let matchCount: number | null = null;
  let pageCap = ABSOLUTE_MAX_PAGES;
  for (let page = 1; page <= pageCap; page++) {
    const res = await fetch(
      `${BASE}?page=${page}&perPage=${PAGE_UNIT}&serviceKey=${encodeURIComponent(key)}`,
      { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) },
    );
    if (!res.ok) {
      throw new Error(`보조금24 호출 실패(${res.status}) ${(await res.text().catch(() => "")).slice(0, 200)}`);
    }
    const json: unknown = await res.json();
    const items = extractBojo24Items(json);
    if (matchCount == null) {
      matchCount = readMatchCount(json);
      if (matchCount != null) pageCap = bojo24PageCap(matchCount);
    }
    pages.push(...items);
    if (items.length < PAGE_UNIT) break;
  }
  if (matchCount != null && pages.length < matchCount * 0.9) {
    throw new Error(`보조금24 부분 수집: ${pages.length}/${matchCount} (90% 미만)`);
  }
  return announcementsFromBojo24Json({ data: pages });
}
