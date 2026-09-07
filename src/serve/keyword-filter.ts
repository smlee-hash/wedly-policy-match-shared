/** 조건 검색에서 오탐을 만드는 흔한 한국어 토막. 숫자+단위(5인·10억·3년)는 여기에 넣지 않는다. */
const STOPWORDS = new Set([
  "이상",
  "이하",
  "미만",
  "초과",
  "기업",
  "지원",
  "사업",
  "대상",
  "경우",
  "관련",
  "확인",
  "이내",
  "있음",
  "없음",
  "해당",
  "필요",
  "가능",
  "신청",
  "조건",
]);

/** 불용어를 빼고, 숫자+단위 토막은 그대로 둔다. */
export function meaningfulKeywords(keywords: string[]): string[] {
  const out: string[] = [];
  for (const raw of keywords) {
    const k = raw.trim();
    if (!k) continue;
    if (STOPWORDS.has(k) && !/\d/.test(k)) continue;
    out.push(k);
  }
  return out;
}

/** 남은 키워드가 2개 이상이면 2점 미만 제외, 1개뿐이면 1점 허용. */
export function minKeywordScore(kws: string[]): number {
  return kws.length >= 2 ? 2 : 1;
}
