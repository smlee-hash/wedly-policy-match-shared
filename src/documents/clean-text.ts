// 결과의 글자 칸(업종·규모)에서 개인정보 꼬리를 걷어 내는 거르개 — 서류 파서와 AI 읽기 결과가 같은 것을 쓴다.
//
// ★주민번호 모양(6자리-7자리, 하이픈 없는 13자리 포함)·도로명/지번 주소 모양이 있으면 그 칸을 버린다.
// ★「성명」「대표자」「주민등록번호」「주소」 같은 다음 항목 이름이 끼어 있으면 거기서 자르고 앞부분만 남긴다.
// ★모르면 지어내지 않고 null(칸을 비운다).

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

/** 업종은 짧다 — 이보다 길면 앞부분만 쓴다. */
export const INDUSTRY_MAX_CHARS = 40;

/** 규모 칸에 들어갈 수 있는 값. 이 밖의 글은 버린다. */
export const COMPANY_SCALES = ["소상공인", "중소기업", "중견기업", "예비창업자"] as const;

/** 주민번호·주소 모양이 들어 있는가. */
export function looksPersonal(text: string): boolean {
  return RRN_LIKE.test(text) || ROAD_ADDRESS.test(text) || LOT_ADDRESS.test(text);
}

/**
 * 업종 같은 글자 칸을 거른다. 다음 항목 이름(성명·대표자·주민등록번호·주소 …)에서 자르고,
 * 남은 글에 주민번호·주소 모양이 있으면 버린다. 최대 `max` 글자. 비면 null.
 */
export function cleanIndustryText(value: unknown, max: number = INDUSTRY_MAX_CHARS): string | null {
  if (typeof value !== "string") return null;
  let text = value.normalize("NFC").replace(/\s+/g, " ").trim();
  // 주민번호는 항목 이름 없이 붙어 있을 수 있어 자르기 전에 먼저 본다.
  if (RRN_LIKE.test(text)) return null;
  const label = NEXT_LABEL.exec(text);
  if (label) text = text.slice(0, label.index);
  text = text.replace(/[\s:：/,·(（-]+$/, "").trim();
  if (text === "" || looksPersonal(text)) return null;
  const chars = Array.from(text);
  if (chars.length > max) text = chars.slice(0, max).join("").replace(/[\s:：/,·(（-]+$/, "").trim();
  return text === "" ? null : text;
}

/** 규모 칸: 정해진 값(소상공인·중소기업·중견기업·예비창업자)이면 그대로, 아니면 null. */
export function cleanCompanyScale(value: unknown): (typeof COMPANY_SCALES)[number] | null {
  if (typeof value !== "string") return null;
  const text = value.normalize("NFC").replace(/\s+/g, "");
  return (COMPANY_SCALES as readonly string[]).includes(text) ? (text as (typeof COMPANY_SCALES)[number]) : null;
}
