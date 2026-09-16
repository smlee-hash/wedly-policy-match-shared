/**
 * 공고 제목이 「○○기업」처럼 대상 분야를 못 박은 경우만 다루는 분야 사전.
 * 본문 어디서든 뽑는 industry 조건과 달리, 여기 가족은 제목 접미사에 붙었을 때만 쓴다.
 */

export const SECTOR_FAMILIES: Array<{ family: string; announcementWords: string[]; companyWords: string[] }> = [
  { family: "식품", announcementWords: ["식품", "농식품", "푸드테크", "외식", "밀키트", "음료"], companyWords: ["식품", "음식", "외식", "음료", "제과", "제빵", "주류"] },
  { family: "농림어업", announcementWords: ["수산", "어업", "농업", "산림", "임업", "축산"], companyWords: ["농업", "어업", "수산", "임업", "축산", "양식"] },
  { family: "제약바이오", announcementWords: ["제약", "바이오", "의료기기", "의약품", "헬스케어"], companyWords: ["제약", "바이오", "의약품", "의료기기", "헬스케어", "의료"] },
  { family: "정보통신", announcementWords: ["소프트웨어", "SW", "ICT", "정보통신", "블록체인", "인공지능", "AI", "게임", "메타버스", "플랫폼"], companyWords: ["소프트웨어", "정보통신", "정보처리", "컴퓨터", "게임", "플랫폼", "앱", "IT"] },
  { family: "콘텐츠", announcementWords: ["콘텐츠", "영상", "영화", "드라마", "방송", "웹툰", "애니메이션", "음악", "출판", "만화"], companyWords: ["콘텐츠", "영상", "영화", "방송", "출판", "만화", "음악", "광고"] },
  { family: "뷰티", announcementWords: ["뷰티", "화장품", "미용"], companyWords: ["화장품", "미용", "뷰티"] },
  { family: "섬유패션", announcementWords: ["섬유", "패션", "의류"], companyWords: ["섬유", "의류", "패션", "봉제"] },
  { family: "자동차", announcementWords: ["자동차", "모빌리티"], companyWords: ["자동차"] },
  { family: "조선해양", announcementWords: ["조선", "해양", "선박"], companyWords: ["조선", "선박"] },
  { family: "반도체전자", announcementWords: ["반도체", "전자", "디스플레이"], companyWords: ["반도체", "전자", "디스플레이"] },
  { family: "기계금속", announcementWords: ["기계", "로봇", "금속", "뿌리"], companyWords: ["기계", "금속", "로봇", "절삭", "가공", "철판", "주조", "용접"] },
  { family: "건설", announcementWords: ["건설", "건축", "인테리어"], companyWords: ["건설", "건축", "인테리어", "도배", "목공", "실내장식"] },
  { family: "관광", announcementWords: ["관광", "여행"], companyWords: ["관광", "여행", "숙박", "호텔"] },
  { family: "유통", announcementWords: ["도소매", "유통", "소매"], companyWords: ["도매", "소매", "유통", "판매"] },
  { family: "광고인쇄", announcementWords: ["광고", "인쇄", "디자인"], companyWords: ["광고", "인쇄", "디자인", "홍보물", "판촉물", "간판"] },
  { family: "에너지환경", announcementWords: ["에너지", "환경", "신재생"], companyWords: ["에너지", "환경", "태양광"] },
  { family: "물류운수", announcementWords: ["물류", "운수", "운송"], companyWords: ["물류", "운수", "운송", "택배", "화물"] },
  { family: "교육", announcementWords: ["교육"], companyWords: ["교육", "학원"] },
  { family: "부동산임대", announcementWords: ["부동산", "임대"], companyWords: ["부동산", "임대"] },
];

/** 긴 낱말부터 — 「정보통신」이 짧은 낱말에 먼저 먹히지 않게. */
const ANNOUNCE_DESC: string[] = [...new Set(SECTOR_FAMILIES.flatMap((f) => f.announcementWords))].sort(
  (a, b) => b.length - a.length || a.localeCompare(b),
);

/** 「분야/산업/업종」은 생략 가능. 긴 접미사(기업체·스타트업)를 앞에 둔다. */
const SUFFIX_RE = /^(?:분야|산업|업종)?\s*(?:기업체|스타트업|제조사|기업|업체|업소)/;

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
export function sectorFamiliesOfIndustry(industry: string): string[] {
  const t = industry ?? "";
  if (!t.trim()) return [];
  const found: string[] = [];
  for (const fam of SECTOR_FAMILIES) {
    if (fam.companyWords.some((w) => t.includes(w))) found.push(fam.family);
  }
  return found;
}
