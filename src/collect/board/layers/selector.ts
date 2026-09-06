import type { HTMLElement } from "node-html-parser";
import { parseHtml, absolutize, normalizeDateText, decodeHtmlEntities } from "../html";
import type { BoardConfig, BoardRow, FieldRule } from "../types";

function pick(row: HTMLElement, rule: FieldRule | undefined, _base: string): string {
  if (!rule) return "";
  const el = rule.selector ? row.querySelector(rule.selector) : row;
  if (!el) return "";
  let val = rule.attr ? (el.getAttribute(rule.attr) ?? "") : el.text.trim();
  if (rule.attr) val = decodeHtmlEntities(val);
  if (rule.regex) {
    const m = val.slice(0, 1000).match(new RegExp(rule.regex));
    val = m ? (m[1] ?? m[0]) : "";
  }
  return val;
}

/** ① 설정 규칙: rowSelector 로 행을, fields 로 각 값을 뽑는다. */
export function extractBySelector(html: string, cfg: BoardConfig): BoardRow[] {
  const root = parseHtml(html);
  const rows = root.querySelectorAll(cfg.list.rowSelector);
  const out: BoardRow[] = [];
  for (const row of rows) {
    const title = pick(row, cfg.list.fields.title, cfg.baseUrl);
    const rawLink = pick(row, cfg.list.fields.detailUrl, cfg.baseUrl);
    const dateText = normalizeDateText(pick(row, cfg.list.fields.date, cfg.baseUrl));
    const category = cfg.list.fields.category ? pick(row, cfg.list.fields.category, cfg.baseUrl) : undefined;
    if (!title && !rawLink) continue;
    out.push({ title, detailUrl: rawLink ? absolutize(rawLink, cfg.baseUrl) : "", dateText, category });
  }
  return out;
}
