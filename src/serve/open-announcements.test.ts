import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadOpenAnnouncements, resetOpenAnnouncementsCache } from "./open-announcements";

const findMany = vi.fn();
const q = { findAnnouncements: (...a: unknown[]) => findMany(...a) } as never;

describe("추천용 공고 조회", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetOpenAnnouncementsCache();
    findMany.mockResolvedValue([{ id: "a1" }]);
  });

  it("status 낡음을 믿지 않는다 — 마감 시각이 지난 공고를 where 로 직접 거른다(적대 리뷰 중요1)", async () => {
    const now = new Date("2026-08-29T09:00:00Z");
    await loadOpenAnnouncements(q, now);
    const arg = findMany.mock.calls[0][0] as { where: Record<string, unknown> };
    expect(arg.where.status).toBe("open");
    expect(arg.where.OR).toEqual([{ applyEnd: null }, { applyEnd: { gt: now } }]);
  });

  it("60초 안 재호출은 캐시를 쓴다 — 조회 1회, 지나면 다시 조회", async () => {
    const t0 = new Date("2026-08-29T09:00:00Z");
    const rows1 = await loadOpenAnnouncements(q, t0);
    const rows2 = await loadOpenAnnouncements(q, new Date(t0.getTime() + 59_000));
    expect(rows2).toEqual(rows1); // 마감 재필터로 매번 새 배열 — 내용만 같으면 캐시 적중
    expect(findMany).toHaveBeenCalledTimes(1);
    await loadOpenAnnouncements(q, new Date(t0.getTime() + 61_000));
    expect(findMany).toHaveBeenCalledTimes(2);
  });

  it("캐시 창 안에서 마감을 넘긴 공고는 반환 직전에 걸러진다(코덱스 중간7)", async () => {
    const t0 = new Date("2026-08-29T09:00:00Z");
    findMany.mockResolvedValue([
      { id: "soon", applyEnd: new Date("2026-08-29T09:00:30Z") },
      { id: "later", applyEnd: new Date("2026-09-10T00:00:00Z") },
      { id: "always", applyEnd: null },
    ]);
    const first = await loadOpenAnnouncements(q, t0);
    expect(first.map((r: { id: string }) => r.id)).toEqual(["soon", "later", "always"]);
    const second = await loadOpenAnnouncements(q, new Date("2026-08-29T09:00:45Z"));
    expect(findMany).toHaveBeenCalledTimes(1); // 캐시 사용
    expect(second.map((r: { id: string }) => r.id)).toEqual(["later", "always"]); // soon 은 마감
  });

  it("지도용 칸을 함께 읽되 본문(요약·대상 원문)은 안 읽는다 — 1만 행 Text 열은 메모리를 먹는다", async () => {
    await loadOpenAnnouncements(q, new Date("2026-09-03T01:00:00Z"));
    const arg = findMany.mock.calls[0][0] as { select: Record<string, boolean> };
    for (const k of ["source", "applyPeriodText", "fundingGroup", "amountText", "amountMaxWon", "rateText", "rateMin", "firstSeenAt"]) {
      expect(arg.select[k]).toBe(true);
    }
    expect(arg.select.summary).toBeUndefined();
    expect(arg.select.targetText).toBeUndefined();
  });

  it("갈래 칸이 빈 옛 행은 제목·기관으로 그 자리에서 채운다 — 못 붙이면 빈 값 그대로", async () => {
    findMany.mockResolvedValue([
      { id: "old", title: "2026년 소상공인 정책자금 융자 공고", agency: "중소벤처기업진흥공단", wedlyCategory: "", fundingGroup: "", applyEnd: null },
      { id: "kept", title: "무엇이든", agency: "", wedlyCategory: "", fundingGroup: "invest", applyEnd: null },
      { id: "none", title: "우수기업 현판 수여식 안내", agency: "한국산업단지공단", wedlyCategory: "", fundingGroup: "", applyEnd: null },
    ]);
    const rows = await loadOpenAnnouncements(q, new Date("2026-09-03T01:00:00Z"));
    const group = (id: string) => rows.find((r: { id: string }) => r.id === id)!.fundingGroup;
    expect(group("old")).toBe("policy");
    expect(group("kept")).toBe("invest");   // 이미 있는 값은 안 건드린다
    expect(group("none")).toBe("");         // 못 붙이면 지어내지 않는다(지도가 「미분류」로 싣는다)
  });
});
