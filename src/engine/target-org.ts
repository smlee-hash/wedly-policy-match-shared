/**
 * 공고 제목이 자격 유형(사회적기업·착한가격업소·예비창업자 …)을 대상으로 못 박은 경우만 다루는 사전.
 * 본문의 「사회적기업과 협업」처럼 지나가는 말은 쓰지 않는다 — 제목의 대상 선언 자리만 본다.
 */

export const ORG_TYPES: Array<{ type: string; announcementWords: string[]; profileWords: string[] }> = [
  { type: "사회적기업", announcementWords: ["사회적기업", "예비사회적기업", "(예비)사회적기업"], profileWords: ["사회적기업", "예비사회적기업"] },
  { type: "사회적경제", announcementWords: ["사회적경제기업", "사회적경제조직"], profileWords: ["사회적경제"] },
  { type: "협동조합", announcementWords: ["협동조합"], profileWords: ["협동조합"] },
  { type: "마을기업", announcementWords: ["마을기업"], profileWords: ["마을기업"] },
  { type: "자활기업", announcementWords: ["자활기업"], profileWords: ["자활기업"] },
  { type: "소셜벤처", announcementWords: ["소셜벤처"], profileWords: ["소셜벤처"] },
  { type: "착한가격업소", announcementWords: ["착한가격업소", "착한가격"], profileWords: ["착한가격업소"] },
  { type: "예비창업자", announcementWords: ["예비창업자", "예비 창업자", "예비창업팀"], profileWords: ["예비창업자"] },
  { type: "대학·연구기관", announcementWords: ["대학", "연구기관", "출연연구기관", "공공기관", "지방자치단체", "기초자치단체"], profileWords: ["대학", "연구기관", "공공기관"] },
];

/** 사전이 아는 유형 이름 — AI 가 지어낸 값으로 모든 회사를 떨어뜨리지 않게 판정 전에 확인한다. */
export const ORG_TYPE_NAMES: ReadonlySet<string> = new Set(ORG_TYPES.map((o) => o.type));

/** 낱말 바로 뒤(공백 허용)에 오면 대상 선언으로 본다. */
const DECLARE_WORDS = ["모집", "지정", "공모", "선정", "대상", "참여", "신청", "육성", "지원"] as const;

function asciiWordStart(title: string, index: number, word: string): boolean {
  if (!/^[A-Za-z0-9]/.test(word)) return true;
  if (index === 0) return true;
  return !/[A-Za-z0-9]/.test(title.charAt(index - 1));
}

function endsWithOrgSuffix(word: string): boolean {
  return /(?:기업|업소|자|기관)$/.test(word);
}

/**
 * 대상 선언 자리: 낱말 바로 뒤(공백 허용)에 모집·지정·공모·선정·대상·참여·신청·육성·지원 이 오거나,
 * 낱말이 「…기업/업소/자/기관」으로 끝나고 그 뒤에 한글이 바로 이어지지 않는 경우.
 * 「사회적기업과 협업」의 「협업」은 선언 낱말이 아니다.
 */
function isTargetDeclarationPlace(title: string, index: number, word: string): boolean {
  const rest = title.slice(index + word.length);
  const trimmed = rest.replace(/^\s+/, "");
  if (DECLARE_WORDS.some((d) => trimmed.startsWith(d))) return true;
  return endsWithOrgSuffix(word) && !/^[가-힣]/.test(rest);
}

function wordAnchoredInTitle(title: string, word: string): boolean {
  let from = 0;
  while (from <= title.length - word.length) {
    const i = title.indexOf(word, from);
    if (i < 0) return false;
    if (asciiWordStart(title, i, word) && isTargetDeclarationPlace(title, i, word)) return true;
    from = i + 1;
  }
  return false;
}

/**
 * 제목에서 공고 낱말이 **대상 선언 자리**에 있을 때만 유형 이름을 모은다.
 * targetSector 와 같은 규율(앞이 영숫자면 경계 확인, 뒤에 한글이 이어지면 제외). 중복 제거.
 */
export function targetOrgsInTitle(title: string): string[] {
  const t = title ?? "";
  if (!t) return [];
  const found: string[] = [];
  for (const org of ORG_TYPES) {
    if (org.announcementWords.some((w) => wordAnchoredInTitle(t, w))) found.push(org.type);
  }
  return found;
}

/** 프로필이 준 기업 형태 문구들에서 유형 이름을 읽는다. 비었으면 빈 배열. */
export function profileOrgTypes(values: readonly string[] | undefined): string[] {
  if (!values || values.length === 0) return [];
  const found: string[] = [];
  for (const org of ORG_TYPES) {
    if (values.some((v) => org.profileWords.some((w) => v.includes(w)))) found.push(org.type);
  }
  return found;
}
