// 결과의 글자 칸(업종·규모)에서 개인정보 꼬리를 걷어 내는 거르개 — 서류 파서와 AI 읽기 결과가 같은 것을 쓴다.
//
// ★주민번호 모양(6자리-7자리, 하이픈 없는 13자리 포함)·도로명/지번 주소 모양이 있으면 그 칸을 버린다.
// ★「성명」「대표자」「주민등록번호」「주소」 같은 다음 항목 이름이 끼어 있으면 거기서 자르고 앞부분만 남긴다.
// ★모르면 지어내지 않고 null(칸을 비운다).
// ★묶음 전체의 사람 이름을 지우고 업종을 40자로 자르는 일은 cleanIndustryText(names) 한 곳에서만 한다 — 돌려주기 직전
//   (redact-names.ts)에 모은 이름 전체로 부른다. 앞단(파서·AI 거르개)은 screenIndustryText 로 자르지 않고 거르기만 한다.

/** 주민번호·법인등록번호 모양(13자리). 앞뒤에 다른 숫자가 붙어 있지 않을 때만 */
export const RRN_LIKE = /(?<!\d)\d{6}\s*-?\s*\d{7}(?!\d)/;
export const RRN_LIKE_GLOBAL = new RegExp(RRN_LIKE.source, "g");

/** 도로명 주소 모양: …로/길/대로 + 번지 숫자(「테헤란로 123」「중앙로3길 12」「가나길 5-1」) */
const ROAD_ADDRESS = /[가-힣]+(?:대로|로|길)(?:\s*\d+번?길)?\s*\d+(?:-\d+)?/;
/** 지번 주소 모양: …동·읍·면·리 + 번지 숫자(「역삼동 123번지」「역삼동 산 12-3번지」「역삼동 123-4」) */
const LOT_ADDRESS = /[가-힣]+(?:동|읍|면|리)\s*(?:산\s*)?\d+(?:-\d+)?\s*번지|[가-힣]+동\s*\d+-\d+/;

/** 업종 칸 뒤에 이어 붙는 다음 항목 이름 — 여기서부터는 업종이 아니다. */
const NEXT_LABEL = new RegExp(
  [
    "성\\s*명",
    "대\\s*표",
    "주\\s*민\\s*(?:[(（]\\s*[가-힣]+\\s*[)）]\\s*)?등\\s*록\\s*번\\s*호",
    "생\\s*년\\s*월\\s*일",
    "사\\s*업\\s*장\\s*(?:소\\s*재\\s*지|주\\s*소)",
    "소\\s*재\\s*지",
    "개\\s*업\\s*(?:연|년)\\s*월\\s*일",
    "(?<![가-힣A-Za-z0-9])주\\s*소(?![가-힣])",
  ].join("|"),
);

/**
 * 업종 칸 끝에 붙은 주소 꼬리가 시작하는 자리. 시도 이름만 홀로 나오면 자르지 않는다(「스포츠 경기 운영업」).
 *  - 시도 이름에 접미어가 붙은 것(「서울특별시」「경기도」「부산시」)
 *  - 시도 이름 + 공백 + 「…시·군·구」로 끝나는 낱말(「경기 화성시」「서울 강남구」)
 *  - 글 맨 앞의 시도 이름(앞에 업종이 없으니 주소 글이다). 단, 흔한 낱말과 겹치는 이름(「경기 운영업」)은 홀로 나와도 주소가 아니다.
 *  - 「…동·읍·면·리·로·길 + 숫자」 모양. 숫자 뒤에 글자가 바로 이어지면(「자동 3D」) 주소가 아니다.
 */
const SIDO_NAMES =
  "서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주|충청북|충청남|전라북|전라남|경상북|경상남";
/** 시도 이름 중 흔한 낱말과 겹치는 것 — 경기(운영업)·대전(게임)·대구(탕). 맨 앞에 홀로 나와도 업종 낱말로 둔다. */
const WORD_LIKE_SIDO = new Set(["경기", "대전", "대구"]);
const LEADING_SIDO_NAMES = SIDO_NAMES.split("|")
  .filter((name) => !WORD_LIKE_SIDO.has(name))
  .join("|");
const ADDRESS_TAIL = new RegExp(
  [
    `(?<![가-힣])(?:${SIDO_NAMES})(?:특별자치시|특별자치도|특별시|광역시|도|시)(?![가-힣])`,
    `(?<![가-힣])(?:${SIDO_NAMES})\\s+[가-힣]{1,5}(?:시|군|구)(?![가-힣])`,
    `^(?:${LEADING_SIDO_NAMES})(?![가-힣])`,
    "[가-힣]+(?:동|읍|면|리|로|길)\\s*(?:산\\s*)?\\d+(?:-\\d+)?(?:번지|번길)?(?![0-9A-Za-z가-힣])",
  ].join("|"),
);

/** 업종은 짧다 — 사람 이름을 다 지운 뒤 맨 마지막에 이 길이로 자른다. */
export const INDUSTRY_MAX_CHARS = 40;
/**
 * 앞단(서류 파서·AI 거르개)의 업종 글자 상한. 앞단은 사람 이름을 아직 다 모르므로 40자로 자르지 않는다 —
 * 자르면 끝에 이름 조각(「김지」)이 남아 뒤에서 못 지운다. 이보다 길면 자르지 않고 칸을 버린다.
 */
export const INDUSTRY_STAGE_MAX_CHARS = 200;
/** 글에서 주소·항목 이름을 찾을 때 보는 앞쪽 글자 수 — 아주 긴 글에서 찾기가 오래 걸리지 않게. */
const INDUSTRY_SCAN_CHARS = 500;

/** 규모 칸에 들어갈 수 있는 값. 이 밖의 글은 버린다. */
export const COMPANY_SCALES = ["소상공인", "중소기업", "중견기업", "예비창업자"] as const;

/** 주민번호·주소 모양이 들어 있는가. */
export function looksPersonal(text: string): boolean {
  return RRN_LIKE.test(text) || ROAD_ADDRESS.test(text) || LOT_ADDRESS.test(text);
}

/** 글 끝에 남는 구분표(공백·쌍점·빗금·쉼표·가운뎃점·마침표·여는 괄호·붙임표). */
const TRAILING_MARKS = /[\s:：/,;·.。(（-]+$/;
const LEADING_MARKS = /^[\s:：/,;·.。)）-]+/;

/* ───────── 서류 속 사람 이름 ───────── */

/** 이름 자리에 적히는 직함·말머리 — 이름으로 모으지 않는다. */
const NOT_NAMES = new Set(["대표", "대표자", "대표이사", "공동대표", "각자대표", "사내이사", "이사", "사업자", "개인", "법인", "본인"]);
/** 한 번에 받는 이름 수 — 터무니없이 많이 와도 지우기 식이 커지지 않게(서류 10개 묶음의 이름이 다 들어갈 만큼). */
export const PERSON_NAMES_MAX = 1000;

/** 서류 라벨(대표자·성명)에서 읽는 이름: 공백을 뺀 한글 2~6자. */
const LABEL_NAME = /^[가-힣]{2,6}$/;
/** AI 가 알려 준 이름: 글자로 시작하고 글자·공백·점·붙임표·작은따옴표만(영문·한글 모두). 공백을 정리한 뒤 1~40자. */
const AI_NAME = /^\p{L}[\p{L}\p{M} .'’-]*$/u;
const AI_NAME_MAX_CHARS = 40;
/** 값 줄이 비었는지 가를 때 — 글자나 숫자가 하나라도 있으면 의미 있는 줄이다(쌍점·붙임표만 있는 줄은 아니다). */
const MEANINGFUL = /[\p{L}\p{N}]/u;

/** 이름이 같은지 보는 열쇠 — 공백·대소문자를 무시한다. */
function nameKey(name: string): string {
  return name.replace(/\s+/g, "").toLowerCase();
}

/** 서류 라벨 이름 하나를 다듬는다: 공백을 빼고 한글 2~6자이며 직함이 아니면 그 이름, 아니면 null. */
function cleanPersonName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.normalize("NFC").replace(/\s+/g, "");
  return LABEL_NAME.test(name) && !NOT_NAMES.has(name) ? name : null;
}

/** AI 이름 하나를 다듬는다: 공백을 정리해 1~40자 글자면 그대로(영문·한글·공백·점), 직함이거나 다른 글자가 섞이면 null. */
function cleanAiPersonName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.normalize("NFC").replace(/\s+/g, " ").trim();
  if (Array.from(name).length > AI_NAME_MAX_CHARS || !AI_NAME.test(name)) return null;
  return NOT_NAMES.has(name.replace(/\s/g, "")) ? null : name;
}

function cleanNameList(values: unknown, clean: (value: unknown) => string | null): string[] {
  if (!Array.isArray(values)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of values.slice(0, PERSON_NAMES_MAX)) {
    const name = clean(v);
    if (name && !seen.has(nameKey(name))) {
      seen.add(nameKey(name));
      out.push(name);
    }
  }
  return out;
}

/** 서류 라벨에서 읽은 이름 목록을 다듬는다 — 이름 모양이 아닌 값은 버리고 중복은 한 번만. */
export function cleanPersonNames(values: unknown): string[] {
  return cleanNameList(values, cleanPersonName);
}

/** aiReader 가 알려 준 이름 목록을 다듬는다 — 라벨 이름보다 느슨하게(영문·공백·점·긴 한글도) 받는다. */
export function cleanAiPersonNames(values: unknown): string[] {
  return cleanNameList(values, cleanAiPersonName);
}

/** 이미 다듬은 이름 목록들을 하나로 합친다 — 공백·대소문자 차이는 같은 이름으로 보고 한 번만. */
export function uniquePersonNames(names: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of names) {
    const key = typeof name === "string" ? nameKey(name) : "";
    if (key === "" || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
    if (out.length >= PERSON_NAMES_MAX) break;
  }
  return out;
}

/**
 * 「대표자」「성명」 항목의 값 글에서 이름을 꺼낸다. 라벨 뒤 쌍점·빈 줄을 건너 첫 의미 있는 줄만 보고,
 * 쉼표·빗금으로 나뉜 조각마다(공백을 뺀 전체 / 첫 낱말)을 이름 모양인지 본다.
 * 이 이름은 업종에서 지우는 데만 쓰고 결과에는 넣지 않는다.
 */
export function personNamesIn(text: string): string[] {
  const line =
    text
      .normalize("NFC")
      .split(/\r\n|\r|\n/)
      .map((l) => l.replace(/^[\s:：]+/, ""))
      .find((l) => MEANINGFUL.test(l)) ?? "";
  const found: string[] = [];
  for (const piece of line.slice(0, 60).split(/[,/·、]/).slice(0, 3)) {
    const spaced = piece.trim();
    found.push(spaced, spaced.split(/[\s()（）]/)[0]);
  }
  return cleanPersonNames(found);
}

/**
 * 이름들을 글에서 찾는 식 — 글자 사이 공백은 있어도 되고, 대소문자는 가리지 않고, 긴 이름을 먼저 찾는다.
 * 이름은 앞서 다듬은 목록이어야 한다. 이름이 없으면 null.
 */
export function personNameRegex(names: readonly string[]): RegExp | null {
  const parts = uniquePersonNames(names)
    .map((name) => Array.from(name.replace(/\s+/g, "")))
    .filter((chars) => chars.length > 0)
    .sort((a, b) => b.length - a.length);
  if (parts.length === 0) return null;
  const escape = (c: string) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(parts.map((chars) => chars.map(escape).join("\\s*")).join("|"), "gi");
}

/** 이름을 지운 자리에 남은 구분표(빈 괄호·겹친 빗금·앞뒤 쉼표)를 정리한다. */
function tidyAfterRemoval(text: string): string {
  return text
    .replace(/[(（]\s*[)）]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/([/,;·])(?:\s*[/,;·])+/g, "$1")
    .replace(LEADING_MARKS, "")
    .replace(TRAILING_MARKS, "")
    .trim();
}

/**
 * 길이를 자르지 않고 업종 글을 거른다: 알려 준 사람 이름(`names`)은 글 어디에 있든 지우고(공백·대소문자 무시),
 * 다음 항목 이름(성명·대표자·주민등록번호·주소 …)에서 자르고, 남은 글에 주민번호·주소 모양이 있으면 버린다.
 * 번지 없는 주소 꼬리(「경기 화성시」·「역삼동 123」)는 그 자리에서 자른다. 이름을 글자 모양으로 짐작해
 * 지우지는 않는다(「농업 / 양봉」을 지키려고). 비면 null.
 */
function scrubIndustry(value: unknown, names: readonly string[]): string | null {
  if (typeof value !== "string") return null;
  let text = value.normalize("NFC").slice(0, INDUSTRY_SCAN_CHARS).replace(/\s+/g, " ").trim();
  // 주민번호는 항목 이름 없이 붙어 있을 수 있어 자르기 전에 먼저 본다.
  if (RRN_LIKE.test(text)) return null;
  const remover = personNameRegex(names);
  if (remover) text = tidyAfterRemoval(text.replace(remover, " "));
  const label = NEXT_LABEL.exec(text);
  if (label) text = text.slice(0, label.index);
  text = text.replace(TRAILING_MARKS, "").trim();
  if (text === "" || looksPersonal(text)) return null;
  const address = ADDRESS_TAIL.exec(text);
  if (address) text = text.slice(0, address.index).replace(TRAILING_MARKS, "").trim();
  return text === "" ? null : text;
}

/**
 * 업종 글을 거르고 이름을 지운 **뒤에** 최대 `max` 글자로 자른다(끝 구분표도 정리). 비면 null.
 * 서류 묶음의 사람 이름을 다 모은 마지막 한 곳(redactKnownNames)이 부르는 거르개다.
 */
export function cleanIndustryText(
  value: unknown,
  max: number = INDUSTRY_MAX_CHARS,
  names: readonly string[] = [],
): string | null {
  const text = scrubIndustry(value, names);
  if (text === null) return null;
  const chars = Array.from(text);
  const cut = chars.length > max ? chars.slice(0, max).join("").replace(TRAILING_MARKS, "").trim() : text;
  return cut === "" ? null : cut;
}

/**
 * 앞단(서류 파서·AI 읽기 거르개)용 업종 거르개 — 다음 항목 이름·주민번호·주소를 거른다.
 * `names` 는 그 서류 하나가 이미 아는 이름뿐이다(파서가 자기 서류의 대표자 이름을 넘긴다). 묶음 전체의 이름은 아직 모르니
 * 40자로 자르지 않는다 — 길이는 `INDUSTRY_STAGE_MAX_CHARS` 보다 길면 자르지 않고 칸을 버린다. 묶음 전체의 이름 지우기와
 * 40자 자르기는 돌려주기 직전 한 곳(cleanIndustryText)에서 한다.
 */
export function screenIndustryText(value: unknown, names: readonly string[] = []): string | null {
  const text = scrubIndustry(value, names);
  return text !== null && Array.from(text).length <= INDUSTRY_STAGE_MAX_CHARS ? text : null;
}

/** 규모 칸: 정해진 값(소상공인·중소기업·중견기업·예비창업자)이면 그대로, 아니면 null. */
export function cleanCompanyScale(value: unknown): (typeof COMPANY_SCALES)[number] | null {
  if (typeof value !== "string") return null;
  const text = value.normalize("NFC").replace(/\s+/g, "");
  return (COMPANY_SCALES as readonly string[]).includes(text) ? (text as (typeof COMPANY_SCALES)[number]) : null;
}
