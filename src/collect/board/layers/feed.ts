import type { BoardRow } from "../types";
import { normalizeDateText, decodeHtmlEntities } from "../html";

function tagValue(block: string, name: string): string {
  const pair = block.match(new RegExp(`<${name}\\b([^>]*)>([\\s\\S]*?)</${name}>`, "i"));
  if (pair) {
    const inner = pair[2].replace(/<!\[CDATA\[|\]\]>/g, "").trim();
    if (inner) return decodeHtmlEntities(inner);
    const href = pair[1].match(/\bhref\s*=\s*["']([^"']+)["']/i);
    if (href) return decodeHtmlEntities(href[1]);
  }
  const self = block.match(new RegExp(`<${name}\\b([^>]*)/?>`, "i"));
  if (self) {
    const href = self[1].match(/\bhref\s*=\s*["']([^"']+)["']/i);
    if (href) return decodeHtmlEntities(href[1]);
  }
  return "";
}

/** RSS/Atom item 을 정규식으로 분해(의존성 없이). map 은 태그 이름. */
export function extractFromRss(xml: string, map: { title: string; link: string; date: string; category?: string }): BoardRow[] {
  const items = xml.match(/<item[\s\S]*?<\/item>/gi) ?? xml.match(/<entry[\s\S]*?<\/entry>/gi) ?? [];
  const tag = (block: string, name: string) => tagValue(block, name);
  return items.map((b) => ({
    title: tag(b, map.title),
    detailUrl: tag(b, map.link),
    dateText: normalizeDateText(tag(b, map.date)),
    category: map.category ? tag(b, map.category) : undefined,
  })).filter((r) => r.title || r.detailUrl);
}

function atPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), obj);
}

/** 화면이 뒤에서 부르는 JSON 배열을 행으로. itemPath 는 배열 위치, map 은 키 이름. */
export function extractFromJson(text: string, itemPath: string, map: { title: string; link: string; date: string; category?: string }): BoardRow[] {
  const parsed = JSON.parse(text);
  const arr = atPath(parsed, itemPath);
  if (!Array.isArray(arr)) return [];
  return arr.map((it) => {
    const rec = it as Record<string, unknown>;
    return {
      title: String(rec[map.title] ?? ""),
      detailUrl: String(rec[map.link] ?? ""),
      dateText: normalizeDateText(String(rec[map.date] ?? "")),
      category: map.category ? String(rec[map.category] ?? "") : undefined,
    };
  }).filter((r) => r.title || r.detailUrl);
}
