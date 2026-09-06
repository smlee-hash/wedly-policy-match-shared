import { parse, type HTMLElement } from "node-html-parser";
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
