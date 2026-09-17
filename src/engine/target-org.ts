/**
 * 공고 제목이 자격 유형(사회적기업·착한가격업소·예비창업자 …)을 대상으로 못 박은 경우만 다루는 사전.
 * 본문의 「사회적기업과 협업」처럼 지나가는 말은 쓰지 않는다 — 제목의 대상 선언 자리만 본다.
 *
 * ★「대학·연구기관·공공기관·지방자치단체」는 사전에서 뺐다(독립 리뷰 2026-09-17 M1·H1) — 이 낱말들은
 *  수요자가 아니라 **발주처·협업처**로 더 자주 쓰여(「기술개발제품 공공기관 실증지원」은 중소기업 대상)
 *  통짜로 두면 기업 대상 공고가 자격형으로 뒤바뀐다. 같은 저장소가 iris.ts 에서 이미 좁혔던 낱말이다.
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
];

/** 사전이 아는 유형 이름 — AI 가 지어낸 값으로 모든 회사를 떨어뜨리지 않게 판정 전에 확인한다. */
export const ORG_TYPE_NAMES: ReadonlySet<string> = new Set(ORG_TYPES.map((o) => o.type));

/** 낱말 뒤(나열 구분자·조사만 지나)에 오면 대상 선언으로 본다. */
const DECLARE_WORDS = ["모집", "지정", "공모", "선정", "대상", "참여", "신청", "육성", "지원"] as const;

/** 「신규모집」·「추가 모집」·「2차 공모」처럼 선언 낱말 앞에 붙는 수식. */
const DECLARE_PREFIXED_RE = new RegExp(`^(?:신규|추가|재|상시|수시|통합|긴급|연장|정기|\\d+차|[1-9]차)?\\s*(?:${DECLARE_WORDS.join("|")})`);

/** 나열 건너뛰기에 쓰는 전체 공고 낱말(긴 것 먼저 — 「예비사회적기업」이 「사회적기업」보다 앞). */
const ALL_ANNOUNCE_WORDS: string[] = [...new Set(ORG_TYPES.flatMap((o) => o.announcementWords))].sort(
  (a, b) => b.length - a.length,
);

function asciiWordStart(title: string, index: number, word: string): boolean {
  if (!/^[A-Za-z0-9]/.test(word)) return true;
  if (index === 0) return true;
  return !/[A-Za-z0-9]/.test(title.charAt(index - 1));
}

/**
 * 낱말과 선언 낱말 사이에 올 수 있는 것 — 나열 구분자와 조사뿐이다.
 * 「사회적기업·협동조합·마을기업 지원사업 모집」에서 가운데 항목도 대상으로 읽히게 한다(독립 리뷰 M2).
 * 다른 말(「설립 전 교육」·「실증지원」)이 끼면 대상 선언이 아니다(H1).
 */
const BRIDGE_RE = /^(?:\s|[·ㆍ,、\/]|및|과|와|의|을|를|은|는|이|가|등|\(예비\))*/;

/**
 * 대상 선언 자리: 낱말 뒤에 나열 구분자·조사만 지나 **선언 낱말**(모집·지정·공모·선정·대상·참여·신청·육성·지원)이
 * 오는 자리만 인정한다. 접미사(…기업/업소/자/기관)만으로는 인정하지 않는다 —
 * 「기술개발제품 공공기관 실증지원」·「마을기업 설립 전 교육」처럼 그 낱말이 대상이 아닌 제목이 실제로 있다
 * (독립 리뷰 2026-09-17 H1, fixture 4건).
 */
/**
 * 그 낱말이 **대상이 아님**을 드러내는 뒷말 — 이 말이 가까이 오면 자격형으로 보지 않는다.
 * 실측(독립 리뷰 2026-09-17 H1): 「마을기업 설립 전(입문) 교육」은 아직 마을기업이 아닌 사람이 대상이고,
 * 「공공기관 실증지원」·「공공기관 제안 협업 과제」는 그 기관이 발주처다(그 유형은 사전에서 뺐다).
 */
const NOT_TARGET_AFTER = /^[\s(（[]*(설립\s*전|설립전|입문|전환|희망|되기\s*위|준비\s*단계|실증|납품|제안|협업|공동|연계|협력)/;

function endsWithOrgSuffix(word: string): boolean {
  return /(?:기업|업소|자|기관)$/.test(word);
}

function isTargetDeclarationPlace(title: string, index: number, word: string): boolean {
  const first = title.slice(index + word.length);
  if (NOT_TARGET_AFTER.test(first)) return false;
  // ① 나열이면 다음 사전 낱말들을 건너뛰며 선언 낱말을 찾는다(가운데 항목 구제 — 독립 리뷰 M2).
  let rest = first;
  for (let i = 0; i < 8; i++) {
    const bridge = BRIDGE_RE.exec(rest)?.[0] ?? "";
    const body = rest.slice(bridge.length);
    if (DECLARE_PREFIXED_RE.test(body)) return true;
    const next = ALL_ANNOUNCE_WORDS.find((w) => body.startsWith(w));
    if (!next || bridge.length === 0) break;
    rest = body.slice(next.length);
  }
  // ② 낱말이 「…기업/업소/자/기관」으로 끝나고 뒤에 한글이 바로 이어지지 않으면 대상 선언으로 본다
  //    (「사회적기업 사업개발비 지원사업」처럼 사업 이름이 먼저 오는 제목이 흔하다). ①의 부정 문맥이 먼저 막는다.
  return endsWithOrgSuffix(word) && !/^[가-힣]/.test(first);
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
