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

/**
 * 그 자격을 **새로 받으려는** 기업이 대상이거나, 그 낱말이 대상이 아님을 드러내는 뒷말.
 * 낱말 바로 뒤(나열 구분자만 지나)에 이것이 오면 자격 조건을 만들지 않는다.
 *  · 모집·지정·공모·선정·신규 — 「착한가격업소 신규모집」·「예비사회적기업 지정 공모」는 아직 그 자격이
 *    아닌 기업이 신청한다(독립 리뷰 2026-09-17 M-B, fixture 실측).
 *  · 설립·창업·양성·입문·전환·희망·되기 위 — 「마을기업 설립 전 교육」·「사회적기업 창업지원사업 창업팀 모집」(H1·M-C).
 *  · 실증·납품·제안·협업·공동·연계·협력 — 그 기관이 발주처·협업처인 제목(H1).
 */
const NOT_TARGET_AFTER =
  /^(?:모집|지정|공모|신규|설립|창업|양성|입문|전환|희망|되기\s*위|준비\s*단계|실증|납품|제안|협업|공동|연계|협력)/;

/** 나열 구분자만 건너뛴다 — 조사(을·를·이·가)는 건너뛰지 않는다(독립 리뷰 H-A: 「사회적기업을 지원하는 …」). */
// 「등」은 나열 끝맺음이거나 「등과/등와」일 때만 다리로 센다(4차 리뷰 F-2).
const LIST_BRIDGE_RE = /^(?:[\s·ㆍ,、\/]|및|등(?=[\s·ㆍ,、\/]|$)|과\s|와\s)+/;

/**
 * 「… 등을 지원하는」·「… 등과의 협업」처럼 나열 뒤에 조사가 붙으면 진짜 대상은 뒤에 있다(4차 F-2·5차 4).
 * 구분자·문자열 끝이 아닌 글자가 「등」 뒤에 오면 전부 조사로 본다.
 */
const ENUM_PARTICLE_AFTER = /^\s*등[^\s·ㆍ,、/]/;

/** 나열 건너뛰기에 쓰는 전체 공고 낱말(긴 것 먼저 — 「예비사회적기업」이 「사회적기업」보다 앞). */
const ALL_ANNOUNCE_WORDS: string[] = [...new Set(ORG_TYPES.flatMap((o) => o.announcementWords))].sort(
  (a, b) => b.length - a.length,
);

function asciiWordStart(title: string, index: number, word: string): boolean {
  if (!/^[A-Za-z0-9]/.test(word)) return true;
  if (index === 0) return true;
  return !/[A-Za-z0-9]/.test(title.charAt(index - 1));
}

/** 자격 이름의 끝맺음 — 조합·벤처·조직·팀도 자격 이름이다(3차 리뷰 M-3: 협동조합·소셜벤처가 단독으로 못 잡히던 자리). */
/**
 * 사전에 없어도 **자격·조직 이름**으로 읽히는 말 — 나열의 다음 항목인지 가르는 데만 쓴다.
 * 「기업·업소·센터」는 일반 낱말(중소기업·유망기업·창업지원센터)이라 넣지 않는다 — 넣으면 「사회적기업 및 중소기업
 * 상생협력」 같은 일반 공고가 자격형으로 뒤바뀐다(독립 리뷰 2026-09-17 6차 F2). 「자」도 사람이라 넣지 않는다.
 */
const ORG_LIKE_NEXT = /^[가-힣]{2,12}(?:회사|조합|조직|단체|법인)(?![가-힣])/;

function endsWithOrgSuffix(word: string): boolean {
  return /(?:기업|업소|자|기관|조합|벤처|조직|팀)$/.test(word);
}

/** 낱말 바로 뒤가 문서 종류뿐이면(「예비사회적기업 공고」) 사업 이름이 없어 대상 선언으로 보기 어렵다(3차 리뷰 M-2). */
const BARE_DOCUMENT_AFTER = /^(?:공고|안내|계획|알림|공지|공모전)(?:\s|$|[()\[\]（）「」])/;

/**
 * 대상 선언 자리: 낱말(또는 그 낱말이 낀 나열)이 「…기업/업소/자/기관」으로 끝나고, 나열을 지난 뒤
 * 한글이 바로 이어지지 않으며, 부정 문맥이 없을 때만 인정한다.
 * 선언 낱말(모집·지원 …)을 근거로 삼던 갈래는 없앴다 — 조사 하나로 「사회적기업을 지원하는 중간지원조직 모집」이
 * 대상으로 뒤바뀌었다(독립 리뷰 2026-09-17 H-A 회귀).
 */
/**
 * 「예비창업자」는 공고가 **주는** 자격이 아니라 지금 상태다 — 「예비창업자 모집·양성과정·창업교육」의 대상은
 * 그대로 예비창업자다. 그래서 「되려는 기업」 부정 문맥(모집·지정·공모·신규·설립·창업·양성 …)을 적용하지 않고,
 * 발주처·협업처 낱말만 본다(독립 리뷰 2026-09-17 7차 M-2).
 */
const COUNTERPARTY_AFTER = /^(?:실증|납품|제안|협업|공동|연계|협력)/;
const STATE_TYPE_WORDS = new Set(["예비창업자", "예비 창업자", "예비창업팀"]);

function isTargetDeclarationPlace(title: string, index: number, word: string): boolean {
  // ★상태형 예외는 **앞에 나열 다리가 없을 때만** 준다 — 「유치사업자 및 예비창업자 모집」처럼 왼쪽에 공동 대상이
  //  있으면 그 대상이 진짜 주인공이라 종전 부정 문맥을 그대로 쓴다(독립 리뷰 2026-09-17 8차 ①, khidi 실측).
  const listedAfterOther = /(?:및|과|와|[·ㆍ,、/])\s*$/.test(title.slice(0, index));
  const negative = STATE_TYPE_WORDS.has(word) && !listedAfterOther ? COUNTERPARTY_AFTER : NOT_TARGET_AFTER;
  let rest = title.slice(index + word.length);
  let suffixSeen = endsWithOrgSuffix(word);
  for (let i = 0; i < 8; i++) {
    const bridge = LIST_BRIDGE_RE.exec(rest)?.[0] ?? "";
    const body = rest.slice(bridge.length);
    if (ENUM_PARTICLE_AFTER.test(rest)) return false;
    if (negative.test(body) || BARE_DOCUMENT_AFTER.test(body)) return false;
    const next = ALL_ANNOUNCE_WORDS.find((w) => body.startsWith(w));
    if (!next) {
      // 나열이 끝났다 — 이어지는 글자가 한글이면 조사·용언이 붙은 것이라 대상 선언이 아니다.
      if (bridge.length === 0 && /^[가-힣]/.test(rest)) return false;
      // 「및·과·와」 뒤에는 **단체 이름**이 와야 나열이다. 사전에 없어도 「…회사·조합·조직·단체·법인·기업」이면
      // 나열로 보고(「마을기업 및 농어촌공동체회사 …」·「사회적기업 및 사회적협동조합 …」 실측), 그 밖이면
      // 조사였다고 본다(「사회적기업과 함께하는 …」·「예비창업자 및 재창업자를 위한 …」). 5차 리뷰 3.
      if (/[및과와·ㆍ,、/]/.test(bridge) && !ORG_LIKE_NEXT.test(body)) return false;
      return suffixSeen;
    }
    if (endsWithOrgSuffix(next)) suffixSeen = true;
    rest = body.slice(next.length);
  }
  return false;
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
