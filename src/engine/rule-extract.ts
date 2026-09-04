/**
 * 공고 원문에서 **AI 없이** 자격 조건을 뽑는다 — 돈이 한 푼도 안 든다.
 *
 * 왜 만들었나(2026-08-25 사장님 「비용이 안 나오는 구조로 바꿔라」):
 * 예전 구조는 「공고 1,500건을 전부 AI가 읽어야 쓸 수 있다」가 전제라, 공고가 늘거나
 * 읽기 규칙 번호를 올릴 때마다 비용이 되살아났다. 실제로 이틀에 993건을 읽어 약 16만원이 나갔다.
 *
 * 실측 근거(2026-08-25, AI가 이미 읽은 400건과 대조):
 *  - 기계로 대조하는 조건의 문구가 뻔하다 — 「중소기업」 257건, 「업력 3년 이내」·「상시근로자 5인 이상」·
 *    「매출액 200억원 이하」처럼 숫자+낱말 꼴.
 *  - 이 규칙 추출기는 **AI가 찾은 조건의 92%를 같이 찾았고, 값이 같은 비율이 98%**였다.
 *
 * ★안전 원칙: 규칙은 **「불가」를 못 만든다.** 글자만 보는 추출이라 문맥을 놓칠 수 있어
 * (예: 「10인 이하 소상공인은 제외」를 직원 수 상한으로 잘못 읽는 것), 어긋난 조건은
 * 「확인 필요」로 뒤로 밀 뿐 목록에서 지우지 않는다. 판정은 `ruleGradeOf` 가 강제한다.
 */
import { canonicalRegion, sidosInText } from "./match-engine";
import {
  EXPECTED_OP,
  type ConditionCheck,
  type MatchGrade,
  type StructuredCondition,
} from "./structure-types";

/** 규칙으로 뽑은 조건임을 화면·보고에서 알아볼 수 있게 원문 앞에 붙인다. */
export const RULE_SOURCE_PREFIX = "[자동 인식]";

const NUM = String.raw`([0-9][0-9,]*)`;
/** 한 조건 문구가 걸쳐 있을 만한 길이 — 이보다 멀면 다른 문장으로 본다. */
const NEAR = 20;

function toNumber(s: string): number {
  return Number(s.replace(/,/g, ""));
}

/**
 * 「억·천만·백만·만」을 원 단위로. 단위가 없으면 그대로(원).
 * ★「만」이 빠져 있어 「매출액 5,000만원 이상」이 통째로 안 잡히던 것을 고쳤다
 * (2026-08-25 적대적 리뷰 — 실제 공고에 가장 흔한 표기다).
 */
const KRW_UNITS: Record<string, number> = {
  억: 100_000_000,
  천만: 10_000_000,
  백만: 1_000_000,
  만: 10_000,
};
/** 정규식에서 쓸 단위 목록 — 긴 것부터(「천만」이 「만」에 먼저 먹히지 않게). */
const KRW_UNIT_RE = "억|천만|백만|만";

function krw(amount: string, unit: string | undefined): number {
  return toNumber(amount) * (unit ? (KRW_UNITS[unit] ?? 1) : 1);
}

/** 원문에서 그 문구가 있던 한 토막을 잘라 사람이 확인할 수 있게 남긴다. */
function snippet(text: string, index: number, length: number): string {
  const from = Math.max(0, index - 15);
  const to = Math.min(text.length, index + length + 25);
  return `${RULE_SOURCE_PREFIX} ${text.slice(from, to).trim()}`;
}

function condition(
  key: StructuredCondition["key"],
  value: StructuredCondition["value"],
  rawText: string,
  machineReadable = true,
): StructuredCondition {
  return {
    key,
    op: EXPECTED_OP[key as keyof typeof EXPECTED_OP],
    value,
    rawText,
    machineReadable,
  };
}

/**
 * 뒤집는 말. 「업력 3년 이내 기업**은 제외**」·「중소기업**이 아닌**」처럼 조건을 뒤집는 문장을
 * 그대로 읽으면 뜻이 정반대가 된다.
 *
 * 이때 **조건을 버리지 않는다** — 버리면 조건이 줄어 오히려 「전부 통과 = 가능」에 가까워진다.
 * 대신 `machineReadable: false` 로 남겨 대조기가 「원문 확인」(unknown)으로 처리하게 하고,
 * 그 결과 판정은 「확인 필요」로 내려간다. 사람이 보게 만드는 것이 안전한 방향이다.
 */
const NEGATION_RE = /제외|아닌|아니한|아니하|않는|않은|않음|불가|해당\s*없|미해당|불인정/;
/** 뒤집는 말을 찾을 범위 — 조건 문구 앞뒤로 이만큼. */
const NEGATION_WINDOW = 30;

function isNegated(text: string, index: number, length: number): boolean {
  const from = Math.max(0, index - NEGATION_WINDOW);
  const to = Math.min(text.length, index + length + NEGATION_WINDOW);
  return NEGATION_RE.test(text.slice(from, to));
}

/**
 * 업종 낱말 — 회사 프로필의 「주업종」(사업자등록증 문구)과 **글자로 겹칠 수 있는 것만** 담는다.
 * 업종은 어긋나도 대조기가 「확인 필요」로만 내리므로(match-engine: industry 불일치 = unknown)
 * 잘못 뽑혀도 공고가 목록에서 사라지지 않는다 — 지역과 달리 넉넉히 담아도 안전하다.
 * 2026-08-30 표본 150건 분석에서 업종 표현이 조각마다 6~13건으로 가장 자주 나왔다.
 */
const INDUSTRY_WORDS = [
  "제조업", "건설업", "도소매업", "도매업", "소매업", "음식점업", "숙박업", "운수업", "물류업",
  "정보통신업", "정보통신산업", "출판업", "교육서비스업", "보건업", "부동산업", "임대업",
  "농업", "임업", "어업", "축산업", "광업", "수산업", "서비스업", "지식서비스산업",
  "콘텐츠산업", "관광업", "금융업", "보험업", "예술", "스포츠", "수리업", "협회", "단체",
  "섬유", "피혁", "식품", "화장품", "바이오", "반도체", "자동차부품", "기계", "조선", "항공",
  "소프트웨어", "게임", "디자인", "인쇄", "화학", "금속", "전자부품", "의료기기", "패션", "가구",
] as const;

/**
 * 지역 문맥 낱말 — 이 낱말 **가까이**에 있는 시도만 지역 조건으로 삼는다.
 * 「접수처: 서울사무소」처럼 지나가는 지명으로 조건을 만들면, 지역 불일치가 곧 목록 제외라
 * (2026-08-30 필터 전환) 자격 있는 회사에게서 공고를 지운다.
 */
const REGION_CONTEXT_RE = /(소재|관내|도내|시내|거주|위치|본사|사업장|주소|에 있는|내\s*기업|내\s*중소기업)/g;
/** 문맥 낱말에서 이 글자 수 안에 있는 시도만 인정한다. */
const REGION_NEAR = 25;

/** 기업 규모로 인정하는 낱말 — 글자 그대로 나오는 것만. */
const SCALE_WORDS = ["중소기업", "소상공인", "중견기업", "스타트업", "예비창업자", "1인기업", "사회적기업"] as const;

interface Pattern {
  key: StructuredCondition["key"];
  re: RegExp;
  value: (m: RegExpExecArray) => StructuredCondition["value"] | null;
}

/**
 * 「미만」은 그 수를 **포함하지 않는다.** 대조기가 쓰는 비교는 `lte`(이하) 하나뿐이라,
 * 「5인 미만」을 그대로 5로 넣으면 정확히 5명인 회사가 통과해 **틀린 「가능」**이 나온다.
 * 한 칸 낮춰 담는다 — 어긋나도 `ruleGradeOf` 가 「확인 필요」로만 내리므로 안전한 방향이다.
 * (2026-08-25 코덱스 리뷰 「'미만'을 '이하'로 판정한다」)
 */
function exclusiveMax(n: number, word: string, step = 1): number {
  return word === "미만" ? Math.max(0, n - step) : n;
}

/**
 * 숫자 조건들. 각 정규식은 「낱말 … 숫자 … 방향」 꼴이고, 낱말과 숫자가 NEAR 글자 안에 있어야 한다.
 * 방향(이내/이상)을 반드시 요구해 「업력 3년차 기업」 같은 서술을 조건으로 오해하지 않는다.
 * 방향 낱말은 마지막 묶음으로 잡아 「미만」과 「이하」를 갈라 본다.
 */
const PATTERNS: Pattern[] = [
  {
    key: "businessAgeMaxYears",
    re: new RegExp(String.raw`(?:업력|창업)[^.。\n]{0,${NEAR}}?${NUM}\s*년\s*(이내|미만|이하)`),
    value: (m) => exclusiveMax(toNumber(m[1]), m[2]),
  },
  {
    key: "businessAgeMinYears",
    re: new RegExp(String.raw`(?:업력|창업)[^.。\n]{0,${NEAR}}?${NUM}\s*년\s*이상`),
    value: (m) => toNumber(m[1]),
  },
  {
    key: "employeeMin",
    re: new RegExp(String.raw`(?:상시\s*)?(?:근로자|종업원|임직원)[^.。\n]{0,${NEAR}}?${NUM}\s*[인명]\s*이상`),
    value: (m) => toNumber(m[1]),
  },
  {
    key: "employeeMax",
    re: new RegExp(String.raw`(?:상시\s*)?(?:근로자|종업원|임직원)[^.。\n]{0,${NEAR}}?${NUM}\s*[인명]\s*(이하|미만)`),
    value: (m) => exclusiveMax(toNumber(m[1]), m[2]),
  },
  {
    key: "revenueMaxKrw",
    re: new RegExp(String.raw`매출액?[^.。\n]{0,${NEAR}}?${NUM}\s*(${KRW_UNIT_RE})?\s*원\s*(이하|미만)`),
    value: (m) => exclusiveMax(krw(m[1], m[2]), m[3]),
  },
  {
    key: "revenueMinKrw",
    re: new RegExp(String.raw`매출액?[^.。\n]{0,${NEAR}}?${NUM}\s*(${KRW_UNIT_RE})?\s*원\s*이상`),
    value: (m) => krw(m[1], m[2]),
  },
];

/**
 * 공고 원문에서 조건을 뽑는다. AI 를 부르지 않으므로 몇 번을 돌려도 공짜다.
 * 지역은 여기서 뽑지 않는다 — 이미 무료 사전필터(raw-prefilter)가 하고 있다.
 */
export function extractConditions(text: string): StructuredCondition[] {
  const t = (text ?? "").replace(/[ \t ]+/g, " ");
  if (!t.trim()) return [];
  const out: StructuredCondition[] = [];

  for (const p of PATTERNS) {
    const m = p.re.exec(t);
    if (!m || m.index < 0) continue;
    const v = p.value(m);
    if (v == null) continue;
    const ok = !isNegated(t, m.index, m[0].length);
    out.push(condition(p.key, v, snippet(t, m.index, m[0].length), ok));
  }

  // 세금 체납 — 「체납」이 나오면 체납이 없어야 한다는 요구로 본다.
  const tax = /체납/.exec(t);
  if (tax) out.push(condition("noTaxDelinquency", true, snippet(t, tax.index, 2)));

  // 기업 규모 — 글자 그대로 나온 것만 모은다.
  const scales = SCALE_WORDS.filter((w) => t.includes(w));
  if (scales.length > 0) {
    const at = t.indexOf(scales[0]);
    const ok = !scales.some((w) => isNegated(t, t.indexOf(w), w.length));
    out.push(condition("companyScale", [...scales], snippet(t, at, scales[0].length), ok));
  }

  // 업종 — 글자로 나온 업종 낱말을 모은다. 어긋나도 「확인 필요」라 안전하다(위 사전 주석).
  const inds = INDUSTRY_WORDS.filter((w) => t.includes(w));
  if (inds.length > 0) {
    const at = t.indexOf(inds[0]);
    // 「제조업 제외」처럼 부정문 안에 있으면 기계 대조에서 빼고 사람 확인으로 넘긴다.
    const ok = !inds.some((w) => isNegated(t, t.indexOf(w), w.length));
    out.push(condition("industry", [...inds], snippet(t, at, inds[0].length), ok));
  }

  // 지역 — **문맥 낱말 가까이**의 시도만. 지나가는 지명으로 조건을 만들면 제외 사고가 난다.
  const sidos = new Set<string>();
  let firstAt = -1;
  for (const m of t.matchAll(REGION_CONTEXT_RE)) {
    const from = Math.max(0, m.index - REGION_NEAR);
    const to = Math.min(t.length, m.index + m[0].length + REGION_NEAR);
    const window = t.slice(from, to);
    for (const sido of sidosInText(window)) {
      if (!sidos.has(sido) && firstAt < 0) firstAt = m.index;
      sidos.add(sido);
    }
  }
  if (sidos.size > 0 && firstAt >= 0) {
    const ok = !isNegated(t, firstAt, 4);
    out.push(condition("region", [...sidos], snippet(t, firstAt, 4), ok));
  }

  return out;
}

/**
 * 규칙으로 뽑은 조건의 판정 — **언제나 「확인 필요」다.**
 *
 * 왜 「가능」도 못 내게 막았나(2026-08-25 적대적 리뷰, 실제 실행으로 6건 재현):
 * 「불가」만 막고 「가능」을 열어 두었더니, 규칙이 **조건을 못 뽑은 공고**가 오히려
 * 「가능성 있음」으로 올라갔다. 「중소기업」·「체납」은 거의 모든 공고에 나오는 낱말이라
 * 그 둘만 잡히고 진짜 자격 조건을 놓치면 전부 통과로 읽힌다. 실제 재현 예:
 *   · "업력 3년 이내 기업은 신청할 수 없습니다" → 업력 2년 회사가 「가능」
 *   · "여성기업 확인서를 보유한 중소기업" → 남성 대표 회사가 「가능」
 *   · "매출액 5,000만원 이상" → 「만원」 단위를 못 읽어 조건이 통째로 빠짐
 * 영업이 이 목록을 보고 고객에게 연락하므로, **틀린 「가능」은 틀린 「불가」만큼 나쁘다.**
 *
 * 대신 뽑은 조건은 그대로 실어 보낸다 — 화면이 「조건 3개 중 2개 통과」처럼 보여 줘
 * 어느 것부터 열어 볼지 고르는 데 쓴다. 목록에서 지우는 일은 여전히 없다.
 */
export function ruleGradeOf(_checks: ConditionCheck[]): MatchGrade {
  return "uncertain";
}

/**
 * 「[광역] 시군구 …」 정형 제목의 **앞머리만** 본다.
 * 제목 아무 데서나 지명을 찾으면 「여수엑스포항」에서 「포항」이 잡히는 부분문자열 사고가 난다
 * (2026-08-31 실측). 대괄호 직후 첫 낱말로 좁히면 그 사고가 원천 차단된다.
 */
const TITLE_TAG_RE = /^\s*\[([^\]]{1,12})\]\s*(\S+)/;

/**
 * 제목 앞머리에서 지역을 읽는다.
 *
 * 왜 필요한가(2026-08-31 실측): 저장된 지역 조건 833건이 전부 광역 단위였고 시군구는 0건이었다.
 * 시군구 전용 공고 656건 중 **471건은 본문에 「소재·관내」 문구가 없어 조건이 하나도 안 붙어**,
 * 기업규모·업종만 맞으면 전국 누구에게나 「조건 충족」으로 떴다
 * (예: 「[경남] 진주시 해외지사화」가 서울 중소기업에게 「충족」).
 *
 * 광역은 **판정용**, 시군구는 **확인용**(machineReadable=false)이다 — 시군구명이 지역 제한이
 * 아닌 공고(「[경기] 성남시 창업센터 입주기업 모집」은 전국 기업이 신청 가능)가 있어
 * 시군구로 fail 을 내면 자격 있는 회사에게서 공고를 지운다(2026-08-30 fable 리뷰 치명1과 같은 사고).
 * 실제 거르기는 광역 조건이 하고, 시군구는 화면에 「○○시 대상으로 보임」으로 보여만 준다.
 *
 * 사전(226개 시군구 이름)을 두지 않는 이유: 광역 접두사가 문맥을 보장하므로
 * 동명이구(중구·서구가 6개 광역시에 중복, 고성군이 강원·경남에 중복) 함정이 생기지 않는다.
 * 사전은 행정구역이 개편될 때마다 낡는다.
 */
export function titleRegionConditions(title: string, agency: string): StructuredCondition[] {
  const m = TITLE_TAG_RE.exec(title ?? "");
  if (!m) return [];
  // 대괄호가 광역일 때만 — 「[무료/선착순] 대구 …」 같은 민간 태그에서 「대구」가
  // '구'로 끝난다는 이유로 시군구로 잡히던 것을 막는다(실측).
  //
  // ★태그도 **여러 광역**을 담을 수 있다. 실제 운영 태그에 「[전남광주]」가 있고(158건),
  // canonicalRegion 은 맨 앞 하나만 줘서 「광주」만 남기고 「전남」을 버렸다 —
  // 그러면 「[전남광주] 여수시」 공고가 region:["광주"] 로 저장돼
  // **여수시(전남) 회사가 자기 지역 공고에서 fail 로 제외**된다(2026-09-01 fable 리뷰 치명, 실측 재현).
  // 둘 다 담으면 checkCondition 이 list.some 으로 OR 대조해 전남·광주 회사 모두 통과한다.
  const tagSidos = sidosInText(m[1]);
  if (tagSidos.length === 0) return [];

  const heads = m[2].split(/[ㆍ·,/]/).filter(Boolean);
  // 광역명이 '구'로 끝나는 경우(대구)를 시군구로 착각하지 않게 canonicalRegion 으로 걸러낸다.
  const gugun = heads.filter(
    (x) => /(시|군|구)$/.test(x) && x.length >= 2 && x.length <= 6 && !canonicalRegion(x),
  );
  // 이어 쓴 것 중 하나라도 시군구가 아니면 정형이 아니다 — 통째로 포기한다(추측 금지).
  if (gugun.length === 0 || gugun.length !== heads.length) return [];

  const out: StructuredCondition[] = [];
  // ★기관에서 광역이 읽히는데 제목과 어긋나면 **판정용 조건을 만들지 않는다.**
  // 실측: 「[경남] 하남시 …」인데 기관은 경기도(하남시는 경기 소속)인 행이 있다.
  // 어긋난 값으로 fail 을 내면 경기 하남시 회사가 자기 공고를 영영 못 본다.
  //
  // 기관에서 광역을 뽑을 땐 **여러 개**를 본다(canonicalRegion 은 맨 앞 하나만 준다).
  // 「전남광주통합특별시」는 전남·광주 둘 다인데 앞 하나만 보면 「광주」가 나와,
  // 제목 [전남] 인 여수·목포·강진 공고 7건이 어긋남으로 잘못 걸렸다(2026-09-01 실측).
  // 태그·기관 둘 다 여러 값일 수 있으므로 **하나라도 겹치면** 같은 지역으로 본다.
  const agSidos = sidosInText(agency);
  if (agSidos.length === 0 || tagSidos.some((s) => agSidos.includes(s))) {
    out.push(condition("region", tagSidos, `${RULE_SOURCE_PREFIX} ${title.slice(0, 40)}`));
  }
  out.push(
    condition("region", gugun, `${RULE_SOURCE_PREFIX} ${gugun.join("ㆍ")} 대상으로 보임 — 원문 확인`, false),
  );
  return out;
}
