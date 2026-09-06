import type { BoardConfig, BoardRow, FieldRule } from "../types";
import { extractBySelector } from "./selector";
import { validateRows } from "../validate";

export interface HealedRule {
  rowSelector: string;
  fields: BoardConfig["list"]["fields"];
}
export interface SelfHealResult { ok: boolean; rows?: BoardRow[]; rule?: HealedRule }

const FIELD_KEYS = new Set(["title", "detailUrl", "date", "category"]);

function sanitizeField(value: unknown): FieldRule | null {
  if (value == null) return {};
  if (typeof value !== "object" || Array.isArray(value)) return null;
  const rec = value as Record<string, unknown>;
  const out: FieldRule = {};
  if (rec.selector !== undefined) {
    if (typeof rec.selector !== "string" || rec.selector.length > 200) return null;
    out.selector = rec.selector;
  }
  if (rec.attr !== undefined) {
    if (typeof rec.attr !== "string") return null;
    out.attr = rec.attr;
  }
  return out;
}

/** 모델 응답·저장된 자가수리 규칙 공통 살균. 형식이 아니면 null. */
export function sanitizeHealedRule(value: unknown): HealedRule | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const rec = value as Record<string, unknown>;
  if (typeof rec.rowSelector !== "string" || rec.rowSelector.length === 0 || rec.rowSelector.length > 200) {
    return null;
  }
  if (!rec.fields || typeof rec.fields !== "object" || Array.isArray(rec.fields)) return null;
  const rawFields = rec.fields as Record<string, unknown>;
  for (const k of Object.keys(rawFields)) {
    if (!FIELD_KEYS.has(k)) return null;
  }
  const title = sanitizeField(rawFields.title);
  const detailUrl = sanitizeField(rawFields.detailUrl);
  const date = sanitizeField(rawFields.date);
  if (!title?.selector || !detailUrl?.selector || !detailUrl.attr || !date) return null;
  const fields: HealedRule["fields"] = { title, detailUrl, date };
  if (rawFields.category !== undefined) {
    const category = sanitizeField(rawFields.category);
    if (!category) return null;
    fields.category = category;
  }
  return { rowSelector: rec.rowSelector, fields };
}

function sliceListHtml(html: string): string {
  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<head[\s\S]*?<\/head>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");
  const idx = cleaned.search(/<table|<tbody|<ul/i);
  const start = idx >= 0 ? Math.max(0, idx - 2_000) : 0;
  return cleaned.slice(start, start + 30_000);
}

/** 모델에게 넘길 프롬프트. 목록 표 근처 30k. */
export function buildHealPrompt(html: string): string {
  return [
    "다음 게시판 목록 HTML에서 공고 목록을 뽑는 규칙을 JSON 으로만 답하라.",
    "형식: {\"rowSelector\":\"CSS\",\"fields\":{\"title\":{\"selector\":\"..\"},\"detailUrl\":{\"selector\":\"..\",\"attr\":\"href\"},\"date\":{\"selector\":\"..\"}}}",
    "설명 문장 금지, JSON 만.",
    "HTML:", sliceListHtml(html),
  ].join("\n");
}

/** ③ 깨진 게시판만 1회. askModel 은 주입(테스트·비용 격리). 검증 통과해야만 rule 반환. persist 는 등록부가 한다. */
export async function selfHeal(
  html: string,
  cfg: BoardConfig,
  ctx: { prevCount: number },
  askModel: (prompt: string) => Promise<string>,
): Promise<SelfHealResult> {
  let rule: HealedRule;
  try {
    const raw = await askModel(buildHealPrompt(html));
    const json = raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1);
    const parsed = sanitizeHealedRule(JSON.parse(json));
    if (!parsed) return { ok: false };
    rule = parsed;
  } catch (e) {
    if (e instanceof Error && e.message.includes("쿨다운")) throw e;
    return { ok: false };
  }

  const tryCfg: BoardConfig = { ...cfg, list: { ...cfg.list, rowSelector: rule.rowSelector, fields: rule.fields } };
  const rows = extractBySelector(html, tryCfg);
  const v = validateRows(rows, { expectMinRows: cfg.expectMinRows, prevCount: ctx.prevCount, allowUndated: cfg.allowUndatedRows });
  if (!v.ok) return { ok: false };
  return { ok: true, rows, rule };
}
