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

/**
 * 업종 칸 끝에 붙은 주소 꼬리가 시작하는 자리 — 시도 이름(「서울」「경기도」「서울특별시」)이나
 * 「…동·읍·면·리·로·길 + 숫자」 모양. 숫자 뒤에 글자가 바로 이어지면(「자동 3D」) 주소가 아니다.
 */
const SIDO_NAMES =
  "서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주|충청북|충청남|전라북|전라남|경상북|경상남";
const ADDRESS_TAIL = new RegExp(
  [
    `(?<![가-힣])(?:${SIDO_NAMES})(?:특별자치시|특별자치도|특별시|광역시|도|시)?(?![가-힣])`,
    "[가-힣]+(?:동|읍|면|리|로|길)\\s*(?:산\\s*)?\\d+(?:-\\d+)?(?:번지|번길)?(?![0-9A-Za-z가-힣])",
  ].join("|"),
);

/** 이름 꼬리 판별용 — 흔한 성씨. 마지막 낱말이 이 글자로 시작하는 한글 2~4자면 이름 후보다. */
const SURNAMES = new Set(
  Array.from(
    "김이박최정강조윤장임한오서신권황안송류유전홍고문양손배백허남심노하곽성차주우구민진나지엄채원천방공현함변염여추도소석선설마길연위표명기반왕금옥육인맹제모탁국어은편용예봉경사부",
  ),
);

/** 업종 꼬리말 — 이것으로 끝나는 낱말은 이름 후보여도 업종이다(「공사」「임대」「소매」). */
const INDUSTRY_TAILS = [
  "업", "점", "제조", "개발", "서비스", "판매", "도매", "소매", "통신", "공사", "설비", "가공", "수리", "임대", "중개",
  "교육", "컨설팅", "운송", "음식", "식당", "한식", "양식", "중식", "일식", "장비", "조경", "인쇄", "출판", "광고",
  "디자인", "유통", "무역", "건설", "제작", "관리", "용역", "대행", "숙박", "의료", "미용", "세탁", "학원", "김치",
  "이벤트", "공급", "생산", "시공", "설계", "설치", "정비", "보관", "물류", "택배", "배송", "배달", "부품", "용품",
  "상품", "제품", "기기", "기계", "기구", "연구", "상담", "지원", "시설", "사업", "기술", "정보", "전자", "전기",
  "금속", "금융", "부동산", "소프트웨어", "시스템", "솔루션", "플랫폼", "쇼핑몰", "마케팅", "인력", "사무", "운영",
  "제공", "재배", "사육", "식품", "의류", "문구", "문화", "주류", "플라스틱",
];

/** 업종은 짧다 — 이보다 길면 앞부분만 쓴다. */
export const INDUSTRY_MAX_CHARS = 40;

/** 규모 칸에 들어갈 수 있는 값. 이 밖의 글은 버린다. */
export const COMPANY_SCALES = ["소상공인", "중소기업", "중견기업", "예비창업자"] as const;

/** 주민번호·주소 모양이 들어 있는가. */
export function looksPersonal(text: string): boolean {
  return RRN_LIKE.test(text) || ROAD_ADDRESS.test(text) || LOT_ADDRESS.test(text);
}

const TRAILING_MARKS = /[\s:：/,·(（-]+$/;

/** 마지막 낱말이 사람 이름 모양(성씨로 시작하는 한글 2~4자, 업종 꼬리말로 끝나지 않음)이면 그 낱말을 뺀다. */
function dropNameTail(text: string): string {
  const at = text.lastIndexOf(" ") + 1; // 공백은 한 칸으로 맞춰져 있다
  const word = text.slice(at);
  if (!/^[가-힣]{2,4}$/.test(word) || !SURNAMES.has(word[0])) return text;
  if (INDUSTRY_TAILS.some((tail) => word.endsWith(tail))) return text;
  return text.slice(0, at).replace(TRAILING_MARKS, "").trim();
}

/**
 * 업종 같은 글자 칸을 거른다. 다음 항목 이름(성명·대표자·주민등록번호·주소 …)에서 자르고,
 * 남은 글에 주민번호·주소 모양이 있으면 버린다. 번지 없는 주소 꼬리(시도 이름·「역삼동 123」)는
 * 그 자리에서 자르고, 끝에 이름처럼 보이는 낱말이 붙었으면 뺀다. 최대 `max` 글자. 비면 null.
 */
export function cleanIndustryText(value: unknown, max: number = INDUSTRY_MAX_CHARS): string | null {
  if (typeof value !== "string") return null;
  // 업종은 40자만 남으니 앞 500자만 본다 — 아주 긴 글에서 주소 모양 찾기가 오래 걸리지 않게(결과에 뒤쪽 글은 들어가지 않는다).
  let text = value.normalize("NFC").slice(0, 500).replace(/\s+/g, " ").trim();
  // 주민번호는 항목 이름 없이 붙어 있을 수 있어 자르기 전에 먼저 본다.
  if (RRN_LIKE.test(text)) return null;
  const label = NEXT_LABEL.exec(text);
  if (label) text = text.slice(0, label.index);
  text = text.replace(TRAILING_MARKS, "").trim();
  if (text === "" || looksPersonal(text)) return null;
  const address = ADDRESS_TAIL.exec(text);
  if (address) text = text.slice(0, address.index).replace(TRAILING_MARKS, "").trim();
  text = dropNameTail(text);
  if (text === "") return null;
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
