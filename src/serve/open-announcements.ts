// 추천용 공고 조회 — 열려 있고 마감이 안 지난 공고만, 60초 서버 캐시.
// status 는 12시간 동기화 때만 닫힘 처리돼 최대 12시간 낡는다 — 마감 시각을 직접 걸러
// 마감 지난 공고가 「상시」 구획으로 둔갑해 추천에 실리는 것을 막는다(적대 리뷰 3차 중요1).
import { classifyFundingGroup } from "../funding/funding-group";
import type { ServeQuery } from "./types";

export type OpenAnnouncementRow = {
  id: string;
  title: string;
  agency: string;
  region: string;
  wedlyCategory: string;
  applyStart: Date | null;
  applyEnd: Date | null;
  url: string;
  structure: unknown;
  ruleStructure: unknown;
  structureStatus: string;
  dedupKey: string;
  // ── 자금 조달 지도(2026-09-03) — 저장 때 규칙으로 채워 둔 칸. 본문(summary·targetText)은 일부러 안 읽는다:
  //    1만 행의 Text 열을 통째로 들고 오면 이 조회 하나가 서버 메모리를 먹는다.
  source: string;
  applyPeriodText: string;
  fundingGroup: string;
  amountText: string;
  amountMaxWon: bigint | null;
  rateText: string;
  rateMin: number | null;
  firstSeenAt: Date;
};

/**
 * 목록에서 읽는 칸.
 * structure·ruleStructure 둘 다 내려받는 군살은 어쩔 수 없다 — 어느 쪽을 쓸지가
 * 행별 structureStatus 로 갈려 select 로는 행마다 다르게 못 고른다.
 */
export const OPEN_ANNOUNCEMENT_SELECT = {
  id: true, title: true, agency: true, region: true, wedlyCategory: true, dedupKey: true,
  applyStart: true, applyEnd: true, url: true,
  structure: true, ruleStructure: true, structureStatus: true,
  source: true, applyPeriodText: true, firstSeenAt: true,
  fundingGroup: true, amountText: true, amountMaxWon: true, rateText: true, rateMin: true,
} as const;

// 레일을 열 때마다 공고 약 4천 건의 JSONB 를 통째로 읽던 것을 60초 안 반복 조작에서 1회로
// 줄인다(적대 리뷰 3차 중요4). 추천은 참고 정보라 60초 낡음을 허용한다.
const TTL_MS = 60_000;
let cache: { at: number; rows: OpenAnnouncementRow[] } | null = null;

/** 시험 전용 — 모듈 캐시가 시험 사이에 새지 않게 비운다. */
export function resetOpenAnnouncementsCache(): void {
  cache = null;
}

/**
 * 앱이 자기 읽기 창구를 물려 만드는 조회기.
 * 캐시는 **모듈 전역**이다(원문 그대로) — 프로세스 하나에 하나.
 */
export function makeOpenAnnouncementsLoader(q: Pick<ServeQuery, "findAnnouncements">) {
  return (now: Date) => loadOpenAnnouncements(q, now);
}

export async function loadOpenAnnouncements(
  q: Pick<ServeQuery, "findAnnouncements">,
  now: Date,
): Promise<OpenAnnouncementRow[]> {
  // 캐시 창(60초) 안에 마감 시각을 넘는 공고가 있을 수 있다 — 반환 직전에 현재 시각으로
  // 한 번 더 거른다(코덱스 리뷰 중간7: 캐시된 마감 공고가 「상시·D-0」로 새던 구멍).
  const stillOpen = (rows: OpenAnnouncementRow[]) =>
    rows.filter((r) => !r.applyEnd || r.applyEnd.getTime() > now.getTime());
  if (cache && now.getTime() - cache.at < TTL_MS) return stillOpen(cache.rows);
  const rows = await q.findAnnouncements<OpenAnnouncementRow>({
    where: { status: "open", OR: [{ applyEnd: null }, { applyEnd: { gt: now } }] },
    select: OPEN_ANNOUNCEMENT_SELECT,
  });
  // 갈래 칸이 비어 있는 옛 행(저장 규칙이 생기기 전에 들어온 것)은 여기서 붙여 준다 —
  // 지도에서 미분류로 밀려나면 사람이 「그런 돈은 없다」로 읽는다. 캐시를 채울 때 한 번만 돌아
  // 요청마다 4천 건을 다시 분류하지 않는다. (제목·기관·추천 카테고리만 본다 — 본문은 안 읽으므로
  // 저장 때(store.ts fundingFieldsOf)보다 단서가 하나 적다. 소급 통로가 본문까지 보고 칸을 채운다.)
  const filled = rows.map((r) =>
    r.fundingGroup
      ? r
      : {
          ...r,
          fundingGroup:
            classifyFundingGroup({
              title: r.title ?? "",
              agency: r.agency ?? "",
              wedlyCategory: r.wedlyCategory ?? "",
            }) ?? "",
        },
  );
  cache = { at: now.getTime(), rows: filled };
  return stillOpen(filled);
}
