/**
 * 본문에서 「얼마·이자」를 규칙으로 뽑는다 — AI 0콜. 마감일 규칙(body-deadline.ts)과 같은 자리(저장 때).
 * 못 뽑으면 빈 값으로 두고 화면은 「공고 확인」이라고 정직하게 적는다(값을 지어내지 않는다).
 */
const UNIT: Record<string, number> = { 억: 100_000_000, 천만: 10_000_000, 백만: 1_000_000, 만: 10_000, 천: 1_000 };

/** 「1억 5천만원」「5,000만원」「600만 원」 → 원. 단위가 하나도 없으면 null. */
export function wonOf(text: string): number | null {
  const t = text.replace(/\s+/g, "").replace(/원$/, "");
  const re = /([\d,]+(?:\.\d+)?)(억|천만|백만|만|천)/g;
  let total = 0;
  let matched = false;
  for (const m of t.matchAll(re)) {
    const n = Number(m[1].replace(/,/g, ""));
    if (!Number.isFinite(n)) continue;
    total += n * UNIT[m[2]];
    matched = true;
  }
  return matched ? Math.round(total) : null;
}

/**
 * 앞 낱말(최대·한도…)에 「기업당」 같은 **한 곳당** 표시가 덧붙을 수 있다(「기업당 최대 5억원」).
 * 예전 규칙은 「최대 5억원」만 잡아 글자에서 「기업당」이 사라졌는데, 그 표시가 곧 「이건 사업 총
 * 규모가 아니라 한 회사가 받는 돈」이라는 증거라서 화면에도 그대로 남겨야 한다.
 */
const AMOUNT_RE =
  /(?:(1개사당|개사당|기업당|업체당|건당|점포당|인당)\s*)?(최대|한도|기업당|업체당|건당|점포당|인당|최고)[:：]?\s*([\d,.]+\s*(?:억|천만|백만|만|천)(?:\s*[\d,.]+\s*(?:천만|백만|만|천))?\s*원?)/g;
/**
 * 「N% 이내/까지/한도 지원·보조」 만 잡는다 — 닫는 낱말을 「지원|보조」로 좁힌 이유는 「이내」 하나만으로도
 * 닫혀 버리면(옛 규칙) 「대출금리 연 3.5% 이내」·「자부담 30% 이내」처럼 지원 비율이 아닌 percent 까지
 * 한도로 잡는다(2026-09-03 실측 버그). 앞에 오는 `(?<![\d.,])` 는 「3.5%」의 소수점 뒷자리 "5" 만 떼어
 * "5% 이내" 로 잘못 읽는 것을 막는 숫자 경계 — 이 자체가 소수 자릿수 지원(`(?:\.\d+)?`)과 한 쌍이다.
 */
const PERCENT_ONLY_RE = /(?<![\d.,])(\d{1,3}(?:\.\d+)?)\s*%\s*(이내|까지|한도)?\s*(지원|보조)/;
/** 자기부담·증감률처럼 지원 「한도」가 아닌 percent 앞뒤 8자 안에 있으면 그 매치를 버린다(방어 한 겹 더). */
const PERCENT_EXCLUDE_RE = /자부담|감소|이상|이하|증가/;
const PERCENT_EXCLUDE_RADIUS = 8;
/** 낱말(최대·한도 등) 없이 금액만 있는 짧은 글에서 쓰는 「숫자+단위」 훑기 — AMOUNT_RE 의 숫자 부분과 같되 앞 낱말 조건이 없다. */
const BARE_AMOUNT_RE = /[\d,.]+\s*(?:억|천만|백만|만|천)(?:\s*[\d,.]+\s*(?:천만|백만|만|천))?\s*원?/g;
/** 이 길이를 넘는 글에는 낱말 없는 금액 훑기를 적용하지 않는다 — 긴 본문엔 지원금과 무관한 숫자가 섞여 있다. */
const SHORT_TEXT_MAX = 80;

/** 금액 앞을 얼마나 살피는가(글자 수) — 한 어절 남짓. */
const AMOUNT_CONTEXT_RADIUS = 8;
/** 금액 앞 8자 안에 이 낱말이 있으면 **사업 전체에 쓰는 돈**이지 기업 한 곳 한도가 아니다. */
const SCALE_WORD_RE = /총|규모|예산|조성|펀드|기금|재원|출자/;
/**
 * 「기업 한 곳당」을 뜻하는 표시.
 *
 * ★2026-09-03 코덱스 적대 리뷰로 export 했다 — 상시 상품 100억 상한(`funding-map-build.ts` 의
 *  `productAmountMaxWon`)이 같은 표지를 봐야 했기 때문이다.
 *
 * ★그 자리는 2026-09-04 코덱스 12차 #2 로 `extractAmount` 재사용으로 바뀌어(표지만 보면 구두점
 *  경계 규칙이 빠져 앞 절 표지가 뒤 금액을 살렸다) **지금 이 상수를 밖에서 쓰는 곳은 없다.**
 *  export 는 그대로 둔다 — 지우는 것은 이 회차 지시 범위 밖이다(메인 판단 몫).
 */
const PER_COMPANY_RE = /1개사당|개사당|기업당|업체당|사업자당|차주당|건당|점포당|인당/;
/** 이 값 이상(100억원)은 한 회사 한도로 보기엔 너무 커서, 한 곳당 표시가 있을 때만 인정한다. */
const PER_COMPANY_REQUIRED_WON = 10_000_000_000;
/**
 * 「기업당」류 표지를 찾는 창(글자 수) — AMOUNT_CONTEXT_RADIUS(8자, 총·규모 오판정 창)보다 넓다.
 *
 * ★5차 독립 화면 검사 지적 1(2026-09-04, screen-checker) — 「사업자당 지원한도 300억 원」이 null 이
 *  됐다. AMOUNT_RE 는 「한도」에서 매치를 시작해(「지원한도」의 「지원」은 그룹 밖) 실제 표지
 *  「사업자당」까지 거리가 10자라 8자 창 밖이었다. 표지를 찾는 이 창만 넓힌다 — SCALE_WORD_RE(총·규모
 *  판정, AMOUNT_CONTEXT_RADIUS)는 그대로 둔다. 넓히면 「총 500억원 규모에 …(10자 안쪽 어딘가)
 *  사업자당…」처럼 표지와 사업 총 규모가 한 문장에 같이 오는 극단적 사례의 오탐 폭이 넓어질 수
 *  있지만, SCALE_WORD_RE 가 먼저(8자 창으로) 규모 낱말을 잡아 버리므로 실제 위험은 낮다.
 */
const PER_COMPANY_CONTEXT_RADIUS = 16;
/**
 * 표지 창을 끊는 구두점 — 세미콜론·쉼표·마침표·가운뎃점·슬래시·콜론(반각·전각)·줄바꿈.
 *
 * ★2026-09-04 코덱스 11차 지적 8 — 16자 창이 문장·절 경계를 넘어, **앞 금액**에 붙은 표지를
 *  **뒤 금액**의 표지로 읽었다(「사업자당 5억; 전체 한도 300억원」의 300억이 기업당 한도로 저장).
 *  표지는 같은 절 안에 있을 때만 그 금액의 것이다 — 창을 마지막 구두점 뒤부터만 본다.
 *  이 때문에 「기업당, 최대 300억원」처럼 표지와 금액 사이에 쉼표가 끼면 표지를 못 찾고 버려진다 —
 *  절을 넘겨 표지를 지어내는 쪽(없는 기업당 한도를 만드는 쪽)이 더 나쁘다고 봐 감수한다.
 *
 * ★코덱스 12차 #3(2026-09-04) — 경계 문자 목록에 콜론이 없어 「사업자당 한도 5억: 한도 300억원」
 *  처럼 표지가 콜론 앞에 있는 글은 16자 창이 절을 넘어 뒤 금액을 「기업당 한도」로 읽었다.
 *  보고서·표 서식은 「항목: 값」 꼴이 흔하다 — 콜론(반각·전각)도 절을 끊는다.
 */
const WINDOW_BREAK_CHARS = ";,.·/\n";
/**
 * 콜론(반각·전각)은 **조건이 붙는** 경계다 — 아래 `COLON_NEEDS_AMOUNT_RE` 를 함께 본다.
 *
 * ★코덱스 13차 #3(2026-09-04) — 콜론을 무조건 경계로 삼으니 12차 #3 이 고친 것과 **반대쪽**이
 *  깨졌다. 「사업자당 지원한도: 300억원」의 콜론은 「항목: 값」의 이음표라 앞뒤가 한 절인데,
 *  경계로 읽어 표지(「사업자당」)를 잘라 내고 300억을 버렸다(5차 지적 1 이 살린 값이 다시 죽음).
 *  가르는 잣대는 **콜론 앞에 금액 표현이 있는가**다 — 있으면 그 금액의 절이 이미 끝난 것이고
 *  (「사업자당 한도 5억: 한도 300억원」), 없으면 아직 항목 이름이 이어지는 한 절이다.
 */
const COLON_CHARS = ":：";
/** 콜론 앞(창 시작~콜론)에 이 꼴이 있으면 앞 절이 이미 금액으로 끝난 것이다 — 숫자 + 억·만·천·원. */
const COLON_NEEDS_AMOUNT_RE = /\d[\d,.]*\s*(?:억|만|천|원)/;

/**
 * 금액 앞 표지 창 — 16자, 단 **마지막 구두점 뒤부터**. `start` 는 원문에서의 시작 자리
 * (표지 구절을 amountText 에 그대로 옮겨 적는 데 쓴다 — 지적 12).
 */
function perCompanyWindowOf(text: string, amountIndex: number): { text: string; start: number } {
  const from = Math.max(0, amountIndex - PER_COMPANY_CONTEXT_RADIUS);
  const raw = text.slice(from, amountIndex);
  let cut = 0;
  for (let i = 0; i < raw.length; i++) {
    if (WINDOW_BREAK_CHARS.includes(raw[i])) cut = i + 1;
    // 콜론은 앞 절이 금액으로 끝났을 때만 경계다(13차 #3) — 「지원한도: 300억원」은 한 절이다.
    else if (COLON_CHARS.includes(raw[i]) && COLON_NEEDS_AMOUNT_RE.test(raw.slice(0, i))) cut = i + 1;
  }
  return { text: raw.slice(cut), start: from + cut };
}

/** 창 안 「기업당」류 표지가 원문에서 시작하는 자리(없으면 null). */
function perCompanyMarkerAt(text: string, amountIndex: number): number | null {
  const w = perCompanyWindowOf(text, amountIndex);
  const m = w.text.match(PER_COMPANY_RE);
  return m && m.index !== undefined ? w.start + m.index : null;
}

/**
 * ★자격·기준 금액을 「받는 돈」으로 읽지 않는다 (2026-09-03 독립 검사 A · 배포본 캡처
 *  `09-amount-is-eligibility-ceiling.png`). 「영세 소상공인 노란우산 가입지원」의 대상 원문
 *  「도내 연매출 3억원 이하 소상공인 신규가입…」에서 3억원이 한도로 저장돼 앞면이 「최대 3억원」이
 *  됐는데, 실제 지원은 월 1만원(12개월)이었다. 3억은 **받는 돈이 아니라 들어올 수 있는 문턱**이다.
 *
 *  · 금액 **뒤 6자** 안에 이하·미만·이상·초과·넘는·까지의 → 기준선을 말하는 문장이다.
 *    「까지」만으로 닫지 않는 이유: 「최대 5억원까지 지원」이 함께 죽는다(그건 진짜 한도다).
 *  · 금액 **앞 10자** 안에 매출·자본금·자산·부채·보험료·납입·가입 → 재무 요건·납입액이다.
 *  두 창을 좁게 잡은 이유는 SCALE_WORD_RE 와 같다 — 「기업당 최대 5억원(연매출 100억 이하)」처럼
 *  진짜 한도와 자격 문턱이 한 문장에 같이 오면, 넓게 보면 멀쩡한 한도까지 함께 버려진다.
 *
 * ★2026-09-03 코덱스 적대 리뷰 지적 2·3 — 위 두 창만으로는 부족했다.
 *  ① 지적 2: 「융자 지원한도 3억원 이하」·「지원한도 5억원까지의 융자금」처럼 **진짜 한도** 문장도
 *     뒤 6자에 이하·까지의 가 오면 무조건 자격 조건으로 버려졌다. 앞 10자에 한도 낱말(한도·최대·
 *     지원·융자·대출·보증 등)이 있으면, 뒤 낱말과 상관없이 한도로 봐야 한다.
 *  ② 지적 3: 「사회보험료 지원 최대 50만원」·「신규가입 지원금 최대 12만원」처럼 앞 10자에 보험료·
 *     가입·납입 같은 자격 접두어가 있어도, 그 접두어와 금액 **사이**에 최대·지원(금)·한도 같은 한도
 *     낱말이 끼어 있으면 그건 재무 요건이 아니라 실제 지급액이다.
 *
 * ★2026-09-03 코덱스 적대 리뷰 재지적 — 위 두 지적을 「금액에 더 가까운 쪽이 이긴다」로 합쳤던 것
 *  자체가 틀렸다. 「신청대상: 연매출 최대 3억원 이하 소상공인」은 「최대」가 「매출」보다 금액에 가까워
 *  옛 규칙이 한도로 오판했다(3억을 한도로 저장). 「가까운 쪽」이 아니라 **먼저 맞는 규칙이 이긴다**
 *  순서로 다시 짠다(위에서부터 처음 맞는 것이 결론):
 *   1. 뒤 6자에 비교어 **있고** 앞 10자에 자격 명사 **있음** → 자격 조건이다 — 사이에 「최대」가 끼어도
 *      그렇다(위 사례가 바로 이 경우). **단 자격 명사와 금액 사이에 「한도|한도액」이 명시돼 있으면 한도다**
 *      (7차 지적 1 — 「매출채권 지원한도 3억원 이하」의 「매출」+「이하」만 보고 명시적 한도까지 버렸다.
 *      「최대」는 이 예외에 안 넣는다 — 「연매출 최대 3억원 이하」는 여전히 자격이어야 한다).
 *   2. 뒤 비교어 **있고** 자격 명사 **없고** 앞 10자에 한도 낱말(한도·한도액·최대·최고·지원·융자·
 *      대출·보증) **있음** → 한도다(「융자 지원한도 3억원 이하」).
 *   3. 뒤 비교어 **있고** 자격 명사도 한도 낱말도 없음 → 자격 조건이다(「3억원 이하 기업」).
 *   4. 뒤 비교어 **없고** 앞 10자에 자격 명사 있음 → 그 낱말과 금액 **사이**에 한도 낱말(최대·최고·
 *      한도·까지·지원금·지원)이 있으면 한도(「사회보험료 지원 최대 50만원」), 없으면 자격 조건
 *      (「자본금 5천만원 기업」).
 *   5. 그 밖은 한도다.
 *  자격 명사는 1~5 가 **같은 사전**(재무 규모 6낱말 + 보험료·납입·가입)을 쓴다 — 7차 지적 2① 전엔
 *   1·2·3 이 재무 규모 6낱말만 봐서 「지원대상: 보험료 50만원 이하」가 규칙 2 로 흘러 한도가 됐다.
 *  「한도 낱말」 사전은 2 와 4 가 다르다 — 2 는 대출·보증 유형 공고(「지원한도·융자」)에서, 4 는 지급형
 *   공고(「지원(금)·최대·까지」)에서 실측했기 때문이다. 두 사전의 「지원」은 자격 머리말(지원대상·지원 대상·
 *   지원자격·지원 자격·지원요건·지원 요건)의 일부일 때는 세지 않는다(7차 지적 2② — 부정 전방탐색.
 *   「신청대상」도 같은 머리말 가족이지만 「지원」이 없어 애초에 안 걸린다).
 */
const ELIGIBILITY_TAIL_RADIUS = 6;
const ELIGIBILITY_TAIL_RE = /이하|미만|이상|초과|넘는|까지의/;
const ELIGIBILITY_HEAD_RADIUS = 10;
/** 규칙 1~5 공통 「자격 명사」— 재무 규모 6낱말 + 보험료·납입·가입(7차 지적 2① 로 1·2·3 도 같은 사전을 쓴다). */
const ELIGIBILITY_NOUN_RE = /매출액|매출|자본금|총자산|자산|부채|보험료|납입|가입/g;
/**
 * 규칙 2 의 「한도 낱말」— 대출·보증 유형 공고에서 실측(「지원한도」「융자」).
 * 「지원」 뒤에 (공백)대상·자격·요건이 이어지면 자격 머리말의 일부라 세지 않는다(7차 지적 2② — 「지원대상: 보험료
 * 50만원 이하」의 「지원」이 한도 낱말로 세어졌다). 「지원 최대 50만원」의 「지원」은 뒤에 그 낱말이 안 오므로 그대로 센다.
 */
const LIMIT_WITH_TAIL_RE = /한도액|한도|최대|최고|지원(?!\s*(?:대상|자격|요건))|융자|대출|보증/g;
/** 규칙 1 의 예외 — 자격 명사와 금액 **사이**에 이 낱말이 명시돼 있으면 한도다(7차 지적 1). 「최대」는 일부러 뺐다. */
const LIMIT_EXPLICIT_BETWEEN_RE = /한도액|한도/;
/** 규칙 4 에서 자격 명사와 금액 **사이**에 낀 한도 낱말 — 지급형 공고에서 실측(「지원(금)」「최대」「까지」). 「지원」의 머리말 제외는 위와 같다. */
const LIMIT_BETWEEN_RE = /최대|최고|한도|까지|지원금|지원(?!\s*(?:대상|자격|요건))/g;

/** re(g 플래그)가 s 안에서 매치하는 **가장 늦은(=금액에 가장 가까운)** 매치의 [시작,끝]. 없으면 null. */
function lastMatchOfAny(re: RegExp, s: string): { start: number; end: number } | null {
  let last: { start: number; end: number } | null = null;
  for (const m of s.matchAll(re)) {
    if (m.index === undefined) continue;
    if (last === null || m.index > last.start) last = { start: m.index, end: m.index + m[0].length };
  }
  return last;
}

/**
 * 이 금액 표현이 자격·기준 금액인가 — 위 규칙 1~5 를 순서대로(먼저 맞는 것이 결론) 본다.
 */
function isEligibilityAmount(text: string, at: number, length: number): boolean {
  const before = text.slice(Math.max(0, at - ELIGIBILITY_HEAD_RADIUS), at);
  const end = at + length;
  const tailHasComparator = ELIGIBILITY_TAIL_RE.test(text.slice(end, end + ELIGIBILITY_TAIL_RADIUS));
  // 금액에 가장 가까운 자격 명사 — 규칙 1·4 는 그 낱말이 끝난 자리부터 금액까지(사이)만 다시 본다.
  const noun = lastMatchOfAny(ELIGIBILITY_NOUN_RE, before);

  if (tailHasComparator) {
    // 규칙 1 — 자격 명사가 있으면 「최대」가 사이에 껴도 자격 조건이다. 단 사이에 「한도|한도액」이 명시돼
    //   있으면(「매출채권 지원한도 3억원 이하」) 한도다 — 7차 지적 1.
    if (noun !== null) return !LIMIT_EXPLICIT_BETWEEN_RE.test(before.slice(noun.end));
    // 규칙 2 — 자격 명사는 없고 한도 낱말만 있으면 한도다.
    if (lastMatchOfAny(LIMIT_WITH_TAIL_RE, before) !== null) return false;
    // 규칙 3 — 둘 다 없으면 자격 조건이다.
    return true;
  }

  // 규칙 4·5 — 뒤에 비교어가 없다. 자격 명사가 없으면 곧장 한도(규칙 5).
  if (noun === null) return false;
  // 자격 명사와 금액 사이(그 낱말이 끝난 자리부터)에 한도 낱말이 있으면 한도, 없으면 자격 조건.
  return lastMatchOfAny(LIMIT_BETWEEN_RE, before.slice(noun.end)) === null;
}

/**
 * 이 금액 표현을 「기업 한 곳이 받는 한도」로 인정할지 — 금액 **앞 8자**만 본다.
 *
 * 2026-09-03 운영 실측: 지도의 「안 갚아도 되는 돈 · 최대」가 500억원으로 떴다. 공고 본문의
 * 「총 500억원 규모」·「예산 300억원」·「펀드 조성 1,000억원」 같은 **사업 총 규모**가 「최대 N원」
 * 규칙에 걸려 기업 한 곳의 한도로 저장된 것이다. 두 겹으로 막는다.
 *  ① 앞 8자에 총·규모·예산·조성·펀드·기금·재원·출자 가 있으면 버린다(그 표현만 버리고 다음 후보로 간다).
 *  ② 100억원 이상은 「기업당·업체당·건당…」이 앞에 있을 때만 인정한다 — 없으면 버린다.
 * 창을 8자로 좁게 잡은 이유: 「총 500억원 규모로 기업당 최대 5억원 지원」처럼 총 규모와 진짜 한도가
 * 한 문장에 같이 오는 글에서, 넓게 보면 멀쩡한 「기업당 최대 5억원」까지 함께 버려진다.
 */
function isPerCompanyLimit(
  text: string,
  amountIndex: number,
  amountLength: number,
  won: number,
  headHasPerCompany: boolean,
): boolean {
  // ③ 자격·기준 금액(연매출 3억원 이하…)은 어떤 규칙에서도 한도 후보가 아니다 — 독립 검사 A.
  if (isEligibilityAmount(text, amountIndex, amountLength)) return false;
  const before = text.slice(Math.max(0, amountIndex - AMOUNT_CONTEXT_RADIUS), amountIndex);
  if (SCALE_WORD_RE.test(before)) return false;
  if (won >= PER_COMPANY_REQUIRED_WON && !headHasPerCompany) {
    // 표지(「기업당」류)는 더 넓은 창(PER_COMPANY_CONTEXT_RADIUS)에서 한 번 더 찾는다 —
    // 5차 독립 검사 지적 1. `before`(8자, SCALE_WORD_RE 판정용)를 그대로 재검사하지 않는 이유는
    // AMOUNT_CONTEXT_RADIUS 를 건드리지 않기 위해서다(계약: 「AMOUNT_CONTEXT_RADIUS 자체는 그대로」).
    // ★창은 마지막 구두점 뒤부터만 본다(11차 지적 8) — perCompanyWindowOf 가 그 규칙을 갖는다.
    if (perCompanyMarkerAt(text, amountIndex) === null) return false;
  }
  return true;
}

/**
 * 글자(amountText)와 숫자 상한(amountMaxWon)은 **같은 표현**을 가리킨다(G3③ — 2026-09-03 코덱스
 * 지적). 예전엔 amountText 가 원문에 먼저 나온 표현을 그대로 두고 amountMaxWon 만 가장 큰 값을
 * 골랐는데, 「운전자금 최대 1억원, 시설자금 최대 5억원」처럼 자금 종류별로 한도가 갈리는 공고에서는
 * 화면 글자(1억)와 정렬·필터 숫자(5억)가 서로 다른 항목을 가리키는 것처럼 보였다 — amountText 는
 * 이제 언제나 **최댓값을 낳은 표현 그대로** 적는다.
 */
export function extractAmount(text: string): { amountText: string; amountMaxWon: number | null } {
  let best: { text: string; won: number } | null = null;
  for (const m of text.matchAll(AMOUNT_RE)) {
    const won = wonOf(m[3]);
    if (won === null) continue;
    const head = m[1] ? `${m[1]} ${m[2]}` : m[2];
    const at = (m.index ?? 0) + m[0].lastIndexOf(m[3]);
    const headHasPerCompany = PER_COMPANY_RE.test(head);
    if (!isPerCompanyLimit(text, at, m[3].length, won, headHasPerCompany)) continue;
    // ★표지가 창 안에 있으면 글자를 **표지 구절부터** 적는다(11차 지적 12) — 「사업자당 지원한도
    //  300억 원」이 「한도 300억원」이 되어, 사업 전체 한도인지 한 곳당 한도인지가 글자에서 사라졌다.
    //  낱말 자리(head)에 이미 표지가 잡힌 글(「기업당 최대 5억원」)은 예전 그대로 — 두 번 안 적는다.
    const markerAt = headHasPerCompany ? null : perCompanyMarkerAt(text, at);
    const prefix = markerAt === null ? head : text.slice(markerAt, at).replace(/\s+/g, " ").trim();
    const label = `${prefix} ${m[3].replace(/\s+/g, "").replace(/원?$/, "원")}`;
    if (!best || won > best.won) best = { text: label, won };
  }
  if (best) return { amountText: best.text, amountMaxWon: best.won };

  const p = text.match(PERCENT_ONLY_RE);
  if (p && p.index !== undefined) {
    const start = Math.max(0, p.index - PERCENT_EXCLUDE_RADIUS);
    const end = Math.min(text.length, p.index + p[0].length + PERCENT_EXCLUDE_RADIUS);
    if (!PERCENT_EXCLUDE_RE.test(text.slice(start, end))) {
      return { amountText: p[0].replace(/\s+/g, " ").trim(), amountMaxWon: null };
    }
  }

  // ★2026-09-03 코덱스 적대 리뷰 지적 4 — 예전엔 글 **전체**에 이하·미만·이상·초과가 하나라도 있으면
  //   낱말 없는 훑기를 통째로 껐다. 「업력 3년 이상 기업에 사업화 자금 5천만원 지원」처럼 그 낱말이
  //   금액과 무관한 자리(업력 요건)에 있어도 5천만원까지 함께 못 찾았다. 이제 글 전체를 보지 않고
  //   **후보 금액마다** isPerCompanyLimit(→ isEligibilityAmount)의 앞뒤 창만으로 거른다 — 아래
  //   isPerCompanyLimit 호출이 곧 그 검사다.
  if (text.length <= SHORT_TEXT_MAX) {
    let maxWon: number | null = null;
    for (const m of text.matchAll(BARE_AMOUNT_RE)) {
      const won = wonOf(m[0]);
      if (won === null) continue;
      // 낱말 없는 훑기에도 같은 잣대를 댄다 — 여기를 안 막으면 「총 500억원 규모」 같은 짧은 글이
      // 위에서 버려지고도 이 갈래로 되살아난다(같은 사고의 뒷문).
      if (!isPerCompanyLimit(text, m.index ?? 0, m[0].length, won, false)) continue;
      if (maxWon === null || won > maxWon) maxWon = won;
    }
    if (maxWon !== null) return { amountText: text.trim(), amountMaxWon: maxWon };
  }

  return { amountText: "", amountMaxWon: null };
}

const SUBSIDY_RE = /(?:이자|금리)\s*(?:최대\s*)?([\d.]+)\s*%\s*(?:p\s*)?(?:이차보전|보전|지원|감면)/;
const FEE_RE = /보증료\s*(?:연\s*)?([\d.]+)\s*%/;
/** g 플래그 — 「운전자금 연 4.5%, 시설자금 연 2.0%」처럼 자금 종류별로 금리가 여러 번 나오는 글을 전부 훑는다. */
const RATE_RE = /(?:연|금리)\s*([\d.]+)\s*%(?:\s*[~∼-]\s*([\d.]+)\s*%)?/g;
/** 「보증료 연 0.6%, 대출금리 연 3.5% 이내」처럼 보증료와 대출금리가 함께 있을 때만 보는 좁은 규칙. */
const LOAN_RATE_WITH_FEE_RE = /대출\s*금리\s*(?:연\s*)?([\d.]+)\s*%(?:\s*[~∼-]\s*([\d.]+)\s*%)?/;

/**
 * 보는 순서가 뜻이다 — 좁은 뜻을 먼저 본다.
 * ① 이차보전(이자 지원)은 내가 내는 금리가 아니라 나라가 깎아 주는 폭이라 rateMin 을 비운다.
 * ② 보증료는 대출 금리가 아니다 — 「보증료 연 0.6%」를 RATE_RE 가 먼저 집으면 0.6% 짜리 대출로 둔갑하므로
 *    반드시 FEE_RE 를 RATE_RE 보다 앞에서 본다(설계본 코드 순서를 여기서 바로잡음).
 * ③ 「보증료 연 0.6%, 대출금리 연 3.5% 이내」처럼 보증료와 대출금리가 한 문장에 함께 있으면 실제로
 *    돈을 빌리는 금리는 대출금리 쪽이다 — 보증료만 보고 「보증료 연 0.6%」로 적으면 3.5% 짜리 대출이
 *    통째로 숨는다. 보증료 문구가 없을 때(대출금리만 있을 때)는 그대로 RATE_RE 로 내려간다.
 * ④ 「운전자금 연 4.5%, 시설자금 연 2.0%」처럼 자금 종류별로 금리가 여러 번 나오면(RATE_RE 갈래만
 *    해당 — 위 세 갈래는 원래도 한 번만 본다) rateText 와 rateMin(정렬·필터용 숫자)은 **같은 표현**을
 *    가리킨다(G3③ — 2026-09-03 코덱스 지적, 예전엔 rateText 가 첫 표현이라 rateMin 이 가리키는
 *    표현과 달랐다) — 전체 중 **최솟값을 낳은 표현**을 그대로 rateText 로 적는다.
 */
export function extractRate(text: string): { rateText: string; rateMin: number | null } {
  const s = text.match(SUBSIDY_RE);
  if (s) return { rateText: `이자 ${s[1]}%p 지원`, rateMin: null };
  const f = text.match(FEE_RE);
  if (f) {
    const loan = text.match(LOAN_RATE_WITH_FEE_RE);
    if (loan) {
      const min = Number(loan[1]);
      const tail = loan[2] ? `~${loan[2]}%` : "";
      return { rateText: `연 ${loan[1]}%${tail}`, rateMin: Number.isFinite(min) ? min : null };
    }
    return { rateText: `보증료 연 ${f[1]}%`, rateMin: null };
  }
  const matches = [...text.matchAll(RATE_RE)];
  if (matches.length > 0) {
    let min = Infinity;
    let winner = matches[0];
    for (const m of matches) {
      for (const g of [m[1], m[2]]) {
        if (g === undefined) continue;
        const n = Number(g);
        if (Number.isFinite(n) && n < min) {
          min = n;
          winner = m;
        }
      }
    }
    const tail = winner[2] ? `~${winner[2]}%` : "";
    return { rateText: `연 ${winner[1]}%${tail}`, rateMin: Number.isFinite(min) ? min : null };
  }
  return { rateText: "", rateMin: null };
}
