/**
 * 공고 제목이 「○○기업」처럼 대상 분야를 못 박은 경우만 다루는 분야 사전.
 * 본문 어디서든 뽑는 industry 조건과 달리, 여기 가족은 제목 접미사에 붙었을 때만 쓴다.
 */

export interface SectorFamily {
  family: string;
  announcementWords: string[];
  companyWords: string[];
  /** 실제로 겹치는 이웃 분야 — 여기에 걸리면 fail 대신 「원문 확인」이다(독립 리뷰 2026-09-16 지적 1·3·6). */
  relatedFamilies: string[];
}

export const SECTOR_FAMILIES: SectorFamily[] = [
  { family: "식품", announcementWords: ["식품", "농식품", "푸드테크", "외식", "밀키트", "음료"], companyWords: ["식품", "음식", "외식", "음료", "제과", "제빵", "주류", "식료품"], relatedFamilies: ["농림어업", "유통", "제약바이오"] },
  { family: "농림어업", announcementWords: ["수산", "어업", "농업", "농식품", "산림", "임업", "축산"], companyWords: ["농업", "어업", "수산", "임업", "축산", "양식업", "양식장", "작물 재배", "작물재배", "재배업"], relatedFamilies: ["식품", "유통"] },
  { family: "제약바이오", announcementWords: ["제약", "바이오", "의료기기", "의약품", "헬스케어"], companyWords: ["제약", "바이오", "의약품", "의료기기", "헬스케어", "의료", "건강기능식품"], relatedFamilies: ["식품", "뷰티", "정보통신", "유통", "농림어업"] },
  { family: "정보통신", announcementWords: ["소프트웨어", "SW", "ICT", "정보통신", "블록체인", "인공지능", "AI", "게임", "메타버스", "플랫폼"], companyWords: ["소프트웨어", "정보통신", "정보처리", "컴퓨터", "게임", "플랫폼", "앱", "IT"], relatedFamilies: ["콘텐츠", "제약바이오", "반도체전자", "교육", "유통", "자동차"] },
  { family: "콘텐츠", announcementWords: ["콘텐츠", "영상", "영화", "드라마", "방송", "웹툰", "애니메이션", "음악", "출판", "만화", "게임"], companyWords: ["콘텐츠", "영상", "영화", "방송", "출판", "만화", "음악", "광고", "게임", "애니메이션", "캐릭터", "공연"], relatedFamilies: ["정보통신", "광고인쇄"] },
  { family: "뷰티", announcementWords: ["뷰티", "화장품", "미용"], companyWords: ["화장품", "미용", "뷰티"], relatedFamilies: ["제약바이오", "유통"] },
  { family: "섬유패션", announcementWords: ["섬유", "패션", "의류"], companyWords: ["섬유", "의류", "패션", "봉제", "귀금속", "장신구"], relatedFamilies: ["유통", "광고인쇄"] },
  { family: "자동차", announcementWords: ["자동차", "모빌리티"], companyWords: ["자동차"], relatedFamilies: ["기계금속", "반도체전자", "정보통신"] },
  { family: "조선해양", announcementWords: ["조선", "해양", "선박"], companyWords: ["조선", "선박"], relatedFamilies: ["기계금속"] },
  { family: "반도체전자", announcementWords: ["반도체", "디스플레이", "전자부품"], companyWords: ["반도체", "디스플레이", "전자부품", "전자제품", "전자기기", "인쇄회로", "인쇄 회로", "회로기판"], relatedFamilies: ["정보통신", "기계금속", "자동차"] },
  { family: "기계금속", announcementWords: ["기계", "로봇", "금속", "뿌리"], companyWords: ["기계", "금속", "로봇", "절삭", "철판", "주조", "용접", "금형", "판금"], relatedFamilies: ["자동차", "조선해양", "반도체전자", "에너지환경", "건설"] },
  { family: "건설", announcementWords: ["건설", "건축", "인테리어"], companyWords: ["건설", "건축", "인테리어", "도배", "목공", "실내장식", "설비"], relatedFamilies: ["기계금속", "에너지환경"] },
  { family: "관광", announcementWords: ["관광", "여행"], companyWords: ["관광", "여행", "숙박", "호텔"], relatedFamilies: ["식품", "콘텐츠", "물류운수"] },
  { family: "유통", announcementWords: ["도소매", "유통", "소매"], companyWords: ["도매", "소매", "유통", "판매", "전자상거래"], relatedFamilies: ["식품", "섬유패션", "뷰티", "물류운수", "농림어업"] },
  { family: "광고인쇄", announcementWords: ["광고", "인쇄"], companyWords: ["광고", "인쇄", "디자인", "홍보물", "판촉물", "간판"], relatedFamilies: ["콘텐츠"] },
  { family: "에너지환경", announcementWords: ["에너지", "환경", "신재생"], companyWords: ["에너지", "환경", "태양광", "폐기물", "재활용", "발전업", "가스", "재생용", "전기판매"], relatedFamilies: ["기계금속", "건설", "유통"] },
  { family: "물류운수", announcementWords: ["물류", "운수", "운송"], companyWords: ["물류", "운수", "운송", "택배", "화물"], relatedFamilies: ["유통"] },
  { family: "교육", announcementWords: ["교육"], companyWords: ["교육", "학원"], relatedFamilies: ["정보통신", "콘텐츠"] },
  { family: "부동산임대", announcementWords: ["부동산", "임대"], companyWords: ["부동산", "임대"], relatedFamilies: ["건설"] },
];

/** 사전이 아는 가족 이름 — AI 가 지어낸 값(「제약」)으로 모든 회사를 떨어뜨리지 않게 판정 전에 확인한다. */
export const SECTOR_FAMILY_NAMES: ReadonlySet<string> = new Set(SECTOR_FAMILIES.map((f) => f.family));

/**
 * 이웃 관계는 **대칭**이다 — 한쪽만 적어 두면 같은 두 분야가 제목·회사 자리에 따라 fail 과 unknown 으로
 * 갈린다(2차 독립 리뷰 지적 1). 사전에 적힌 방향을 양쪽으로 펴서 한 번만 계산한다.
 */
const NEIGHBORS: ReadonlyMap<string, ReadonlySet<string>> = (() => {
  const map = new Map<string, Set<string>>();
  for (const f of SECTOR_FAMILIES) map.set(f.family, new Set([f.family]));
  for (const f of SECTOR_FAMILIES) {
    for (const r of f.relatedFamilies) {
      map.get(f.family)?.add(r);
      map.get(r)?.add(f.family);
    }
  }
  return map;
})();

/** 주어진 가족들과 실제로 겹치는 이웃 가족 전체(자기 자신 포함, 대칭). */
export function relatedFamiliesOf(families: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const name of families) for (const n of NEIGHBORS.get(name) ?? []) out.add(n);
  return out;
}

/** 긴 낱말부터 — 「정보통신」이 짧은 낱말에 먼저 먹히지 않게. */
const ANNOUNCE_DESC: string[] = [...new Set(SECTOR_FAMILIES.flatMap((f) => f.announcementWords))].sort(
  (a, b) => b.length - a.length || a.localeCompare(b),
);

/**
 * 「분야/산업/업종」은 생략 가능. 긴 접미사(기업체·스타트업)를 앞에 둔다.
 * ★접미사 뒤에는 **경계**가 와야 한다 — 「기업지원사업」·「기업보증」처럼 낱말이 이어지면 대상 선언이 아니라
 * 사업 이름이다(독립 리뷰 2026-09-16 지적 5: 「그린바이오 기업지원사업 … 회계법인 모집」).
 */
const SUFFIX_RE = /^(?:분야|산업|업종)?\s*(?:기업체|스타트업|제조사|기업|업체|업소)(?![가-힣])/;

function asciiWordStart(title: string, index: number, word: string): boolean {
  if (!/^[A-Za-z0-9]/.test(word)) return true;
  if (index === 0) return true;
  return !/[A-Za-z0-9]/.test(title.charAt(index - 1));
}

/** 낱말 바로 뒤의 다른 공고 낱말(「식품외식」)은 건너뛰고, 그 다음이 대상 접미사인지 본다. */
function skipStackedAnnouncementWords(rest: string): string {
  let cur = rest;
  for (;;) {
    const space = /^\s*/.exec(cur)?.[0].length ?? 0;
    const body = cur.slice(space);
    const hit = ANNOUNCE_DESC.find((w) => body.startsWith(w));
    if (!hit) return cur;
    cur = body.slice(hit.length);
  }
}

function isTitleAnchored(rest: string): boolean {
  return SUFFIX_RE.test(skipStackedAnnouncementWords(rest));
}

function wordAnchoredInTitle(title: string, word: string): boolean {
  let from = 0;
  while (from <= title.length - word.length) {
    const i = title.indexOf(word, from);
    if (i < 0) return false;
    if (asciiWordStart(title, i, word) && isTitleAnchored(title.slice(i + word.length))) return true;
    from = i + 1;
  }
  return false;
}

/**
 * 제목에서 「공고 낱말 + (분야|산업|업종)? + 기업|업체|…」처럼 **바로 뒤에 대상 접미사**가
 * 붙은 자리만 가족 이름으로 모은다. 「산림분야 오픈이노베이션 참여기업」처럼 사이에 다른 말이
 * 있으면 잡지 않는다. 수출·여성·청년·벤처·강소·유망·중소기업은 사전에 없어 안 잡힌다.
 */
export function sectorFamiliesInTitle(title: string): string[] {
  const t = title ?? "";
  if (!t) return [];
  const found: string[] = [];
  for (const fam of SECTOR_FAMILIES) {
    if (fam.announcementWords.some((w) => wordAnchoredInTitle(t, w))) found.push(fam.family);
  }
  return found;
}

/**
 * 회사 업종 문구에 회사 낱말이 들어 있는 가족들. 「제조업」·「서비스업」만 있으면 빈 배열
 * (너무 넓어서 분야로 못 읽는다).
 */
/**
 * 회사 낱말보다 긴 합성어 — 이 안의 짧은 낱말은 다른 가족의 근거가 아니다(통합 리뷰 F1·F2·D1·D2).
 * 「인쇄회로기판」의 「인쇄」는 광고인쇄가 아니고, 「서양식 음식점」의 「양식(업)」은 농림어업이 아니다.
 * 대조는 **합성어를 지운 글**로만 한다. 합성어 자체가 어느 가족의 회사 낱말이면(「인쇄회로」→반도체전자)
 * 그 낱말만 원문으로 본다 — 그래야 합성어의 제 가족이 사라지지 않는다.
 */
const COMPOUND_MASK = ["인쇄회로", "인쇄 회로", "비금속", "서양식", "한식양식", "일식양식", "일양식", "중식양식"];

/** 합성어를 공백으로 바꾼 글. 분야 가족 대조에만 쓴다 — industry 조건은 fail 을 못 내므로 가림이 진짜 pass 만 잃는다(통합 3차 리뷰 §4). */
export function maskCompounds(text: string): string {
  return COMPOUND_MASK.reduce((t, c) => t.split(c).join(" "), text ?? "");
}

export function sectorFamiliesOfIndustry(industry: string): string[] {
  const raw = industry ?? "";
  if (!raw.trim()) return [];
  const masked = maskCompounds(raw);
  const found: string[] = [];
  for (const fam of SECTOR_FAMILIES) {
    const hit = fam.companyWords.some((w) => (COMPOUND_MASK.includes(w) ? raw.includes(w) : masked.includes(w)));
    if (hit) found.push(fam.family);
  }
  return found;
}
