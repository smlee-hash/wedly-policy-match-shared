// 지역 기관 출처 → 그 기관의 관할 지역(NO.585, 2026-10-26).
// 지역 기관이 올린 공고는 지역 칸·지역 조건이 비어 있어도 그 지역 기업 대상인 경우가 대부분이다 — 순천시 기업지원포털이
// 다시 올린 「비즈플러스카드」가 서울 회사의 추천 위쪽에 떴다. 전국 공고는 중앙 출처(기업마당·중소벤처24 …)에 따로 있다.
// 이름은 funding/source-labels.ts 의 출처 이름을 보고 적었다. 17곳 통합(ccei)·산업단지공단(kicox)처럼 여러 지역을 맡는
// 출처와 중앙 기관은 넣지 않는다. 시군구 이름은 sigungu.ts 사전에 있는 이름만 쓴다(시험이 확인한다).

export interface SourceRegion {
  sido: string;
  sigungu?: string;
}

export const SOURCE_REGION: Readonly<Record<string, SourceRegion>> = {
  // 시도 기관
  "tp-busan": { sido: "부산" },
  "tp-chungnam": { sido: "충남" },
  ulsan: { sido: "울산" },
  "tp-daejeon": { sido: "대전" },
  jbba: { sido: "전북" },
  djbea: { sido: "대전" },
  "tp-gyeongbuk": { sido: "경북" },
  "tp-gyeongnam": { sido: "경남" },
  bizok: { sido: "인천" },
  "riia-gn": { sido: "경남" },
  "riia-jn": { sido: "전남" },
  seoultp: { sido: "서울" },
  gepa: { sido: "경북" },
  gcgf: { sido: "경기" },
  gjtp: { sido: "광주" },
  cba: { sido: "충북" },
  dgtp: { sido: "대구" },
  "tp-jeonbuk": { sido: "전북" },
  dgsinbo: { sido: "대구" },
  bssinbo: { sido: "부산" },
  gjsinbo: { sido: "광주" },
  djsinbo: { sido: "대전" },
  icsinbo: { sido: "인천" },
  ulsinbo: { sido: "울산" },
  gwsinbo: { sido: "강원" },
  sjsinbo: { sido: "세종" },
  gnsinbo: { sido: "경남" },
  jbsinbo: { sido: "전북" },
  cnsinbo: { sido: "충남" },
  cbsinbo: { sido: "충북" },
  jcgf: { sido: "제주" },
  seoulsinbo: { sido: "서울" },
  jnsinbo: { sido: "전남" },
  gbsinbo: { sido: "경북" },
  jepa: { sido: "전남" },
  jba: { sido: "제주" },
  sjtp: { sido: "세종" },
  cbtp: { sido: "충북" },
  bepa: { sido: "부산" },
  sba: { sido: "서울" },
  gtp: { sido: "경기" },
  itp: { sido: "인천" },
  jejutp: { sido: "제주" },
  gbsa: { sido: "경기" },
  gwtp: { sido: "강원" },
  "product-seoulshinbo": { sido: "서울" },
  "product-gcgf": { sido: "경기" },
  // 시군구 기관
  jica: { sido: "전북", sigungu: "전주시" },
  snip: { sido: "경기", sigungu: "성남시" },
  cwip: { sido: "경남", sigungu: "창원시" },
  hsbiz: { sido: "경기", sigungu: "화성시" },
  aca: { sido: "경기", sigungu: "안양시" },
  pipa: { sido: "경기", sigungu: "평택시" },
  bizbc: { sido: "경기", sigungu: "부천시" },
  geri: { sido: "경북", sigungu: "구미시" },
  ypa: { sido: "경기", sigungu: "용인시" },
  gopa: { sido: "경기", sigungu: "김포시" },
  cistep: { sido: "충남", sigungu: "천안시" },
  paju: { sido: "경기", sigungu: "파주시" },
  gmsbdc: { sido: "경기", sigungu: "광명시" },
  nyj: { sido: "경기", sigungu: "남양주시" },
  ptp: { sido: "경북", sigungu: "포항시" },
  ansan: { sido: "경기", sigungu: "안산시" },
  cbf: { sido: "강원", sigungu: "춘천시" },
  sida: { sido: "경기", sigungu: "시흥시" },
  gipa: { sido: "경기", sigungu: "고양시" },
  wfi: { sido: "강원", sigungu: "원주시" },
  gbia: { sido: "경남", sigungu: "김해시" },
  jbio: { sido: "경남", sigungu: "진주시" },
  pomia: { sido: "경북", sigungu: "포항시" },
  hespa: { sido: "충남", sigungu: "아산시" },
  sscf: { sido: "경기", sigungu: "수원시" },
  uesc: { sido: "경기", sigungu: "의정부시" },
  ikse: { sido: "전북", sigungu: "익산시" },
  hanam: { sido: "경기", sigungu: "하남시" },
  suncheon: { sido: "전남", sigungu: "순천시" },
};

export function sourceRegionOf(source: string | null | undefined): SourceRegion | null {
  if (!source) return null;
  return Object.prototype.hasOwnProperty.call(SOURCE_REGION, source) ? SOURCE_REGION[source] : null;
}
