import { parse, TextNode, type HTMLElement } from "node-html-parser";
import iconv from "iconv-lite";

/**
 * 바이트를 문자열로. euc-kr 게시판이 많아 charset 지정을 존중한다.
 * 이미 Buffer 면 그대로 쓴다 — 매번 Buffer.from 으로 다시 감싸면 큰 본문(20MB급)에서
 * 사본이 한 겹 더 생긴다(fable 리뷰 중요4).
 */
export function decodeBody(body: ArrayBuffer | Buffer, charset: "utf-8" | "euc-kr" | undefined): string {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
  if (charset === "euc-kr") return iconv.decode(buf, "euc-kr");
  return iconv.decode(buf, "utf-8");
}

export function parseHtml(html: string): HTMLElement {
  // parseNoneClosedTags: 닫히지 않은 <tr> 원문에서 <table> 이 통째로 버려지지 않게(충남TP 고정본).
  return parse(html, { comment: false, parseNoneClosedTags: true });
}

/** 세미콜론 없이도 풀리는 HTML 옛 이름 106개(대소문자 구분). 서로 앞머리가 겹치지 않는다. */
const LEGACY_ENTITY_NAMES =
  "Aacute|Agrave|Atilde|Ccedil|Eacute|Egrave|Iacute|Igrave|Ntilde|Oacute|Ograve|Oslash|Otilde|Uacute|Ugrave|Yacute|" +
  "aacute|agrave|atilde|brvbar|ccedil|curren|divide|eacute|egrave|frac12|frac14|frac34|iacute|igrave|iquest|middot|" +
  "ntilde|oacute|ograve|oslash|otilde|plusmn|uacute|ugrave|yacute|AElig|Acirc|Aring|Ecirc|Icirc|Ocirc|THORN|Ucirc|" +
  "acirc|acute|aelig|aring|cedil|ecirc|icirc|iexcl|laquo|micro|ocirc|pound|raquo|szlig|thorn|times|ucirc|Auml|COPY|" +
  "Euml|Iuml|Ouml|QUOT|Uuml|auml|cent|copy|euml|iuml|macr|nbsp|ordf|ordm|ouml|para|quot|sect|sup1|sup2|sup3|uuml|" +
  "yuml|AMP|ETH|REG|amp|deg|eth|not|reg|shy|uml|yen|GT|LT|gt|lt";
/** 옛 이름 바로 뒤에 `=`·영문·숫자가 오는 `&` — 속성 안에서는 풀지 않을 후보. */
const LEGACY_AMP_BEFORE_WORD = new RegExp(`&(?:${LEGACY_ENTITY_NAMES})(?=[=A-Za-z0-9])`, "g");
const NAMED_REFERENCE_HEAD = /^&[A-Za-z0-9]+;/;

/** 본문 방식 풀기 — node-html-parser 가 쓰는 `he.decode(s)` 와 같다(`he` 는 직접 의존성이 아니라 이 길로 쓴다). */
const decodeAsText = (s: string): string => new TextNode(s).text;

/**
 * 속성 값의 문자 참조를 **브라우저가 속성에서 푸는 방식**으로 푼다(HTML 표준).
 * 세미콜론 없는 옛 이름(`&para`·`&not`·`&sect`…) 바로 뒤에 `=`·영문·숫자가 오면 풀지 않고,
 * 나머지는 본문과 똑같이 한 번만 푼다. 옛 이름으로 시작하는 더 긴 진짜 이름(`&notin;`)은 그 이름으로 푼다.
 */
export function decodeAttributeValue(raw: string): string {
  const keepAt: number[] = [];
  for (const m of raw.matchAll(LEGACY_AMP_BEFORE_WORD)) {
    const at = m.index ?? 0;
    const named = raw.slice(at).match(NAMED_REFERENCE_HEAD)?.[0];
    // `&이름;` 덩어리가 `;` 로 안 끝나게 풀리면 더 긴 진짜 이름이다 — 지키지 않는다.
    if (named && !decodeAsText(named).endsWith(";")) continue;
    keepAt.push(at);
  }
  const pieces: string[] = [];
  let from = 0;
  for (const at of keepAt) {
    pieces.push(raw.slice(from, at));
    from = at + 1;
  }
  pieces.push(raw.slice(from));
  return pieces.map(decodeAsText).join("&");
}

/**
 * 요소의 속성 값을 속성 방식으로 읽는다. 이름 대소문자는 가리지 않고, 같은 이름이 여럿이면 마지막이 이긴다.
 * 값이 없거나 속성이 없으면 빈 글자.
 *
 * `getAttribute` 를 안 쓰는 이유: 속성 값을 본문 방식으로 풀어 `&paramMenuId` 가 「¶mMenuId」가 된다
 * (2026-10-01 보건산업진흥원 352건·에너지기술평가원 217건 첨부 주소가 이렇게 망가졌다).
 */
export function attributeOf(el: HTMLElement, name: string): string {
  const want = name.toLowerCase();
  const attrs = el.rawAttributes;
  let raw: string | null | undefined;
  for (const key of Object.keys(attrs)) {
    if (key.toLowerCase() === want) raw = attrs[key];
  }
  return typeof raw === "string" ? decodeAttributeValue(raw) : "";
}

/** 상대 링크를 절대 주소로. 이미 절대면 그대로. */
export function absolutize(href: string, base: string): string {
  try { return new URL(href, base).toString(); } catch { return href; }
}

/**
 * 게시판 날짜 원문을 YYYY-MM-DD 로 맞춘다(E1).
 * 점·빗금·한국어 날짜를 0채움 하이픈으로. 범위 안의 여러 날짜도 각각 변환.
 * parseApplyPeriod 본체는 건드리지 않는다.
 */
export function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

export function normalizeDateText(text: string): string {
  if (!text) return text;
  const pad = (y: string, m: string, d: string) =>
    `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  return text
    .replace(/(?<![\d])(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일(?![\d])/g, (_, y, m, d) => pad(y, m, d))
    .replace(/(?<![\d])(\d{4})[-./](\d{1,2})[-./](\d{1,2})(?![\d])/g, (_, y, m, d) => pad(y, m, d));
}

export type { HTMLElement };
