import type { BoardConfig } from "./types";

/**
 * 직전 **같은 설정으로 성공한 목록 수집** 건수.
 * 복구로 만져진 열린 공고 합계는 급락 비교에 쓰지 않는다.
 */
export const COLLECTION_BASELINE_KEY_PREFIX = "board-collection-baseline:";
export const COLLECTION_BASELINE_VERSION = 1;
/** 기존 열린 공고 창과 같은 26시간. 이보다 오래됐거나 미래면 기준값으로 쓰지 않는다. */
export const COLLECTION_BASELINE_TTL_MS = 26 * 3600 * 1000;

export function collectionBaselineKey(id: string): string {
  return `${COLLECTION_BASELINE_KEY_PREFIX}${id}`;
}

export interface CollectionBaselineRecord {
  v: number;
  source: string;
  count: number;
  observedAt: string;
  signature: string;
}

function sampleUrl(fn: ((page: number) => string) | undefined, page: number): string | null {
  if (typeof fn !== "function") return null;
  try {
    const url = fn(page);
    return typeof url === "string" && url.length > 0 ? url : null;
  } catch {
    return null;
  }
}

/** 키 순서를 고정한다. 함수·bigint 은 넣지 않는다(번들 런타임마다 toString 이 갈린다). */
function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  const t = typeof value;
  if (t === "string" || t === "boolean") return JSON.stringify(value);
  if (t === "number") return Number.isFinite(value) ? JSON.stringify(value) : "null";
  if (t !== "object") return "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const rec = value as Record<string, unknown>;
  const keys = Object.keys(rec).filter((k) => rec[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(rec[k])}`).join(",")}}`;
}

function signaturePayload(cfg: BoardConfig): unknown {
  return {
    allowUndatedRows: !!cfg.allowUndatedRows,
    allowedHosts: [...(cfg.allowedHosts ?? [])].sort(),
    baseUrl: cfg.baseUrl,
    charset: cfg.charset ?? "utf-8",
    dropUrlParams: [...(cfg.dropUrlParams ?? [])].sort(),
    emptyStreakStop: cfg.emptyStreakStop ?? 2,
    expectMinRows: cfg.expectMinRows ?? null,
    feed: cfg.feed
      ? {
          itemPath: cfg.feed.itemPath ?? null,
          kind: cfg.feed.kind,
          map: cfg.feed.map,
          url1: sampleUrl(cfg.feed.url, 1),
          url2: sampleUrl(cfg.feed.url, 2),
        }
      : null,
    hasCreateListSession: typeof cfg.createListSession === "function",
    hasCustomParse: typeof cfg.customParse === "function",
    hasListInit: typeof cfg.list.init === "function",
    hasValidationParse: typeof cfg.validationParse === "function",
    id: cfg.id,
    keepPagingParamsInDetail: !!cfg.keepPagingParamsInDetail,
    list: {
      fields: cfg.list.fields,
      maxPages: cfg.list.maxPages,
      rowSelector: cfg.list.rowSelector,
      url1: sampleUrl(cfg.list.url, 1),
      url2: sampleUrl(cfg.list.url, 2),
    },
    skipHeuristic: !!cfg.skipHeuristic,
  };
}

export function collectionBaselineSignature(cfg: BoardConfig): string {
  return canonicalJson(signaturePayload(cfg));
}

export function parseCollectionBaseline(
  value: unknown,
  expected: { source: string; signature: string; now: number },
): CollectionBaselineRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (v.v !== COLLECTION_BASELINE_VERSION) return null;
  if (typeof v.source !== "string" || v.source.length === 0 || v.source !== expected.source) return null;
  if (typeof v.signature !== "string" || v.signature.length === 0 || v.signature !== expected.signature) return null;
  if (typeof v.count !== "number" || !Number.isSafeInteger(v.count) || v.count < 0) return null;
  if (typeof v.observedAt !== "string" || v.observedAt.length === 0) return null;
  const observedMs = Date.parse(v.observedAt);
  if (!Number.isFinite(observedMs)) return null;
  if (observedMs > expected.now) return null;
  if (expected.now - observedMs >= COLLECTION_BASELINE_TTL_MS) return null;
  return {
    v: COLLECTION_BASELINE_VERSION,
    source: v.source,
    count: v.count,
    observedAt: v.observedAt,
    signature: v.signature,
  };
}

export async function readCollectionBaselineCount(
  cfg: BoardConfig,
  get: (key: string) => Promise<unknown>,
  now = Date.now(),
): Promise<number> {
  try {
    const parsed = parseCollectionBaseline(await get(collectionBaselineKey(cfg.id)), {
      source: cfg.id,
      signature: collectionBaselineSignature(cfg),
      now,
    });
    return parsed ? parsed.count : 0;
  } catch {
    return 0;
  }
}

export async function saveCollectionBaseline(
  cfg: BoardConfig,
  count: number,
  set: (key: string, value: unknown) => Promise<void>,
  now = Date.now(),
): Promise<void> {
  try {
    if (!Number.isSafeInteger(count) || count < 0) return;
    const record: CollectionBaselineRecord = {
      v: COLLECTION_BASELINE_VERSION,
      source: cfg.id,
      count,
      observedAt: new Date(now).toISOString(),
      signature: collectionBaselineSignature(cfg),
    };
    await set(collectionBaselineKey(cfg.id), record);
  } catch {
    console.warn(`[policy-board] 수집 기준값 저장 실패 ${cfg.id}`);
  }
}
