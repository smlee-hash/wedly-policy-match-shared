/**
 * 게시판 쪽수 상한 장부. 마지막 쪽(maxPages)에 이 회차 신규가 있으면 그 너머에
 * 더 있을 수 있다는 신호다. 추가 요청은 만들지 않고, 엔진이 이미 받은 마지막 쪽으로만 판정한다.
 */
export const BOARD_CAP_KEY_PREFIX = "board-cap:";

export function boardCapKey(id: string): string {
  return `${BOARD_CAP_KEY_PREFIX}${id}`;
}

export interface BoardCapRecord {
  hitCap: boolean;
  lastPageNew: number;
  at: string;
  /** 이 값을 쓴 수집 회차 시작. 더 새 회차가 이미 있으면 옛 쓰기는 버린다. */
  runAt?: string;
}

export interface PageCapInfo {
  hitCap: boolean;
  lastPageNew: number;
  runAt?: string;
}

export function parseBoardCap(value: unknown): BoardCapRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.hitCap !== "boolean") return null;
  if (typeof v.lastPageNew !== "number" || !Number.isFinite(v.lastPageNew)) return null;
  if (!Number.isInteger(v.lastPageNew) || v.lastPageNew < 0) return null;
  if (v.hitCap !== (v.lastPageNew > 0)) return null;
  if (typeof v.at !== "string" || v.at.length === 0) return null;
  if (Number.isNaN(Date.parse(v.at))) return null;
  const rec: BoardCapRecord = { hitCap: v.hitCap, lastPageNew: v.lastPageNew, at: v.at };
  if (v.runAt !== undefined) {
    if (typeof v.runAt !== "string" || v.runAt.length === 0 || Number.isNaN(Date.parse(v.runAt))) return null;
    rec.runAt = v.runAt;
  }
  return rec;
}

export function boardCapMapFromCache(
  rows: Array<{ key: string; value: unknown }>,
): Map<string, BoardCapRecord> {
  const map = new Map<string, BoardCapRecord>();
  for (const row of rows) {
    if (!row.key.startsWith(BOARD_CAP_KEY_PREFIX)) continue;
    const parsed = parseBoardCap(row.value);
    if (!parsed) continue;
    map.set(row.key.slice(BOARD_CAP_KEY_PREFIX.length), parsed);
  }
  return map;
}

export async function notePageCap(
  _id: string,
  info: PageCapInfo,
  deps: {
    store: {
      set: (value: BoardCapRecord) => Promise<void>;
      get?: () => Promise<BoardCapRecord | null>;
    };
    now?: () => Date;
  },
): Promise<void> {
  try {
    const at = (deps.now ?? (() => new Date()))().toISOString();
    const runAt = info.runAt ?? at;
    if (deps.store.get) {
      const existing = await deps.store.get();
      if (existing?.runAt) {
        const existingMs = Date.parse(existing.runAt);
        const incomingMs = Date.parse(runAt);
        if (Number.isFinite(existingMs) && Number.isFinite(incomingMs) && existingMs > incomingMs) {
          return;
        }
      }
    }
    await deps.store.set({
      hitCap: info.hitCap,
      lastPageNew: info.lastPageNew,
      at,
      runAt,
    });
  } catch {
    /* 장부 쓰기 실패는 수집 회차를 막지 않는다 — alertStore 와 같은 자리 */
  }
}
