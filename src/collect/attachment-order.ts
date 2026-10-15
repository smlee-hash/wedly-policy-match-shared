// 첨부를 읽는 차례·같은 요청·사이트 공통 파일을 가리는 순수 도우미.
// `./attachment-text` 를 부르지 않는다(순환) — 형식 판정은 `./types` 의 것만 쓴다.
import { attachmentKindOf, type PolicyAttachmentKind } from "./types";

/** 이름 끝의 크기·횟수 꼬리 — `공고문.hwp (68.5K)`·`공고.pdf[1.2MB]`·`공고.pdf(다운로드 12회)`. 확장자 바로 뒤일 때만 뗀다. */
const NAME_TAIL = /(\.[A-Za-z][A-Za-z0-9]{1,4})\s*[([][^()[\]]*[)\]]\s*$/;

/**
 * 이름 끝 꼬리를 떼고 앞뒤 공백을 걷는다.
 * 왜: 수집기가 `공고문.hwp (68.5K)` 처럼 크기를 이름에 붙여 저장해, 확장자를 못 보고 etc 로 굳은 줄이 있다.
 */
export function trimAttachmentName(name: string): string {
  return name.trim().replace(NAME_TAIL, "$1");
}

// ── 이름 역할: 0 공고문 쪽 · 1 그 밖 · 2 서식 쪽 ──
// 2026-10-01 운영 실측: 한 공고의 첨부를 1개만 읽는데 형식 순서(pdf·hwpx → hwp)만 봐서
// 신청서 양식·포스터 pdf 가 공고문 hwp 보다 먼저 읽혔다. 이름으로 공고문 쪽을 먼저 읽는다.
const IMAGE_NAME = /\.(?:jpe?g|png|gif|bmp|webp|tiff?)$/i;
const ROLE0_WORDS = [
  "제안요청서",
  "제안요구서",
  "시행계획",
  "모집요강",
  "공고문",
  "안내문",
  "RFP",
  "요강",
  "공고",
  "공모",
  "안내",
  "지침",
  "사업계획(?!서)",
  "추진계획(?!서)",
];
const ROLE2_WORDS = [
  "체크리스트",
  "작성요령",
  "카드뉴스",
  "신청서",
  "동의서",
  "위임장",
  "확약서",
  "서약서",
  "포스터",
  "리플렛",
  "리플릿",
  "이미지",
  "썸네일",
  "웹자보",
  "계획서",
  "제안서",
  "매뉴얼",
  "메뉴얼",
  "서식",
  "양식",
  "각서",
  "홍보",
  "배너",
  "서류",
  "설문지",
];

/** 긴 낱말이 먼저 맞게 글자 수 내림차순(같으면 적은 차례 — 안정 정렬). 길이는 `(?!서)` 를 뺀 글자 수. */
const ROLE_WORDS: Array<{ word: string; role: 0 | 2 }> = [
  ...ROLE0_WORDS.map((word) => ({ word, role: 0 as const })),
  ...ROLE2_WORDS.map((word) => ({ word, role: 2 as const })),
].sort((a, b) => b.word.replace(/\(.*\)/, "").length - a.word.replace(/\(.*\)/, "").length);

/** 낱말마다 캡처 묶음 하나 — 정의된 묶음 번호로 역할을 찾는다. */
const ROLE_WORD_RE = new RegExp(ROLE_WORDS.map((w) => `(${w.word})`).join("|"), "gi");
const BRACKETED = /[([{<【〔［（「『《〈][^()[\]{}<>【】〔〕［］（）「」『』《》〈〉]*[)\]}>】〕］）」』》〉]/g;
const NAME_SEPARATOR = /\s*(?:및|,|&|·|ㆍ)\s*/;

/** 한 조각 안에서는 마지막 낱말, 조각끼리는 작은 역할이 이긴다. 낱말이 없으면 null. */
function roleOfText(text: string): 0 | 2 | null {
  let best: 0 | 2 | null = null;
  for (const part of text.split(NAME_SEPARATOR)) {
    let last: 0 | 2 | null = null;
    for (const m of part.matchAll(ROLE_WORD_RE)) {
      for (let g = 1; g < m.length; g++) {
        if (m[g] !== undefined) {
          last = ROLE_WORDS[g - 1].role;
          break;
        }
      }
    }
    if (last !== null) best = best === null ? last : (Math.min(best, last) as 0 | 2);
  }
  return best;
}

/**
 * 이름으로 가린 역할 — 0 공고문 쪽 · 1 그 밖 · 2 서식 쪽(그림 파일은 이름과 상관없이 2).
 * 괄호 밖 낱말을 먼저 보고, 괄호 밖에 없을 때만 괄호 안을 본다. 이름의 「+」는 띄어쓰기로 본다.
 */
export function attachmentNameRole(name: string): 0 | 1 | 2 {
  const trimmed = trimAttachmentName(name);
  if (IMAGE_NAME.test(trimmed)) return 2;
  const base = trimmed.replace(/\.[A-Za-z0-9]{1,5}$/, "").replace(/\+/g, " ");
  let outside = base;
  for (;;) {
    const next = outside.replace(BRACKETED, "");
    if (next === outside) break;
    outside = next;
  }
  return roleOfText(outside) ?? roleOfText(base) ?? 1;
}

/** 저장 형식이 etc 일 때만 꼬리 뗀 이름·주소로 다시 가린다. 그 밖은 저장 형식 그대로. */
export function effectiveAttachmentKind(a: {
  name: string;
  url: string;
  kind: PolicyAttachmentKind;
}): PolicyAttachmentKind {
  if (a.kind !== "etc") return a.kind;
  return attachmentKindOf(trimAttachmentName(a.name), a.url);
}

/**
 * 모든 글에 붙는 사이트 공통 파일인지.
 * 2026-10-01 실측: 충북기업진흥원 옆 메뉴 전자책, 수출바우처 고정 메뉴 「정산가이드」·바닥글 「관리지침」이
 * 모든 글의 첨부로 잡혔다. 2번에서 수확 범위를 좁혔지만 이미 저장된 줄에 남아 있어 읽을 때도 거른다.
 */
const EXPORTVOUCHER_COMMON_FILE_IDS = new Set([
  "FILE_000000006726376",
  "FILE_000000006769439",
  "FILE_000000007042784",
  "FILE_000000007098686",
  "FILE_000000007125962",
]);

export function isSiteCommonAttachment(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false; // 주소가 아니면 공통 파일로 보지 않는다
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  const path = u.pathname.toLowerCase();
  if (u.hostname === "cba.ne.kr" || u.hostname === "www.cba.ne.kr") return path.startsWith("/ebook/");
  if (u.hostname === "exportvoucher.com" || u.hostname === "www.exportvoucher.com") {
    return path === "/common.filedownload.do" && EXPORTVOUCHER_COMMON_FILE_IDS.has(u.searchParams.get("file_id") ?? "");
  }
  return false;
}

/** 같은 요청인지 가리는 열쇠 — 방법(기본 GET)·정규화 주소(http 는 https 로)·본문을 줄바꿈으로 잇는다. */
export function attachmentRequestKey(a: { url: string; method?: string; body?: string }): string {
  const method = a.method ? a.method.toUpperCase() : "GET";
  let target = a.url.trim();
  try {
    const u = new URL(target);
    if (u.protocol === "http:") u.protocol = "https:";
    target = u.href;
  } catch {
    /* 주소로 못 읽는 글자는 앞뒤 공백만 뗀 날 글자로 비교한다 */
  }
  return `${method}\n${target}\n${a.body ?? ""}`;
}
