/**
 * 수집원 현황 — 명부·건수·회차 장부를 한 화면 값으로 합친다.
 * ERP `api/policy-match/sources` 라우트의 **순수 부분 원문**이다(읽기는 앱이 한다).
 */
import { boardCapMapFromCache } from "../funding/board/page-cap";
import { resolveDirectory, type ResolvedDirectoryEntry } from "../funding/source-directory";

/** 회차 장부에 실리는 수집원 한 줄 — 이 화면이 실제로 읽는 칸만. */
export type SourceRunReport = {
  name: string;
  saved?: number | null;
  error?: string | null;
};

/** JsonCache `policy-match-sync-ledger` 의 값 — 이 화면이 실제로 읽는 칸만. */
export type SyncLedgerValue = {
  lastReport?: { ranAt?: string | null; startedAt?: string | null; perSource?: unknown } | null;
  cycle?: { perSource?: unknown } | null;
  lastTailAt?: unknown;
} | null;

export type SourcesEntry = ResolvedDirectoryEntry & {
  count: number;
  lastSaved: number | null;
  lastError: string | null;
};

export type SourcesSummary = {
  connected: number;
  waiting: number;
  candidate: number;
  blocked: number;
  error: number;
  excluded: number;
  lastRanAt: string | null;
  lastTailAt: string | null;
};

/**
 * 공고 표와 상시 상품 표의 건수를 합친다.
 * 두 표를 더한다(id 는 겹치지 않게 정해 두지만, 겹쳐도 덮지 않고 합치는 편이 정직하다).
 */
export function mergeSourceCounts(
  announcementCounts: Array<{ source: string; count: number }>,
  productCounts: Array<{ source: string; count: number }>,
): Map<string, number> {
  const countBy = new Map<string, number>(announcementCounts.map((c) => [c.source, c.count]));
  for (const p of productCounts) countBy.set(p.source, (countBy.get(p.source) ?? 0) + p.count);
  return countBy;
}

export function buildSourcesSummary(input: {
  /** 이번 회차가 도는 수집원 이름 — `collectSourceNames()` 결과. */
  names: string[];
  countBy: Map<string, number>;
  ledgerValue: SyncLedgerValue;
  capRows: Array<{ key: string; value: unknown }>;
  capsUnknown: boolean;
}): { entries: SourcesEntry[]; summary: SourcesSummary } {
  const { names, countBy, ledgerValue, capRows, capsUnknown } = input;
  const report = ledgerValue?.lastReport;
  // 장부가 손상돼 배열이 아니어도 500 대신 빈 값으로(적대 리뷰 사소 1).
  const perList = Array.isArray(report?.perSource) ? (report.perSource as unknown[]) : [];
  // ★진행 중인 회차(이어하기)의 결과가 가장 새 사실이다. 완주한 lastReport 만 읽으면,
  //  SIDA 단계가 실패한 채로 배포가 끊겼을 때 그 실패가 회차 장부에 이미 적혔는데도
  //  다음 컨테이너가 회차를 완주할 때까지 현황판이 옛 회차의 「연결됨」을 계속 보여 준다.
  const cycleList = Array.isArray(ledgerValue?.cycle?.perSource) ? (ledgerValue.cycle.perSource as unknown[]) : [];
  const named = (p: unknown): p is SourceRunReport =>
    !!p && typeof p === "object" && typeof (p as { name?: unknown }).name === "string";
  const perSource = new Map<string, SourceRunReport>(
    perList.filter(named).map((p) => [p.name, p]),
  );
  for (const p of cycleList.filter(named)) perSource.set(p.name, p); // 같은 이름이면 진행 중 회차가 이긴다
  const caps = boardCapMapFromCache(capRows);
  // ★이번 회차 목록(SOURCES)에 없는 출처(requiresProxy 라 빠진 대전신보 등)에는 옛 회차의
  //  오류·건수를 붙이지 않는다 — 안 붙이면 명부 상태(대기)는 맞는데 비고가 옛 오류로 가려진다.
  const inRun = new Set(names);

  const entries: SourcesEntry[] = resolveDirectory(names, caps, {
    // ★회차가 **시작한** 시각으로 잰다. 한 회차가 배포에 끊겨 여러 번에 나눠 돌게 되면서
    //  `ranAt`(마지막 재개 시각)으로 재면, 09시에 쪽수 상한에 걸린 게시판의 경고가
    //  15시 재개 때 「그 뒤에 다시 돌았다」로 오인돼 조용히 사라진다.
    ranAt: report?.startedAt ?? report?.ranAt ?? null,
    capsUnknown,
    // ★회차 장부를 판정에 넘긴다 — 「연결됨」인데 0건·오류인 줄이 초록으로 보이던 것(2026-09-04 실측 3곳)을
    //  패키지가 error 로 덮는다. 랩 앱도 같은 함수를 쓰므로 판정 규칙은 여기 말고 명부에 있다.
    runs: new Map(
      [...perSource].filter(([name]) => inRun.has(name)).map(([name, p]) => [name, { saved: p.saved ?? null, error: p.error ?? null }]),
    ),
  }).map((e) => ({
    ...e,
    count: e.id ? (countBy.get(e.id) ?? 0) : 0,
    lastSaved: e.id && inRun.has(e.id) ? (perSource.get(e.id)?.saved ?? null) : null,
    lastError: e.id && inRun.has(e.id) ? (perSource.get(e.id)?.error ?? null) : null,
  }));
  const countOf = (s: string) => entries.filter((e) => e.status === s).length;
  const summary: SourcesSummary = {
    connected: countOf("connected"),
    waiting: countOf("waiting"),
    candidate: countOf("candidate"),
    blocked: countOf("blocked"),
    error: countOf("error"),
    excluded: countOf("excluded"),
    lastRanAt: report?.ranAt ?? null,
    // 꼬리(본문·첨부 채움)는 이제 회차와 따로 10분 틱마다 돈다 — 회차 시각으로는 그 진행이 안 보인다.
    // 장부가 손상돼도 500 이 되지 않게 글자일 때만 싣는다.
    lastTailAt: typeof ledgerValue?.lastTailAt === "string" ? ledgerValue.lastTailAt : null,
  };
  return { entries, summary };
}
