// 「업무 현황에 추가」(진행) — 담당만 누름·한 번만 만듦·같은 정책에 잇기·히스토리 실패는 삼킴.
// 담당 확인(isAssigned)·정책 이름 같음 판정(isSamePolicyName)은 앱이 넘기는 주입이다.
import { describe, expect, it, vi } from "vitest";
import {
  DeadlineProgressError,
  NOT_ASSIGNED_MESSAGE,
  PROGRESS_BAD_BODY_MESSAGE,
  PROGRESS_TODO,
  findLinkableTrack,
  policyNameOf,
  progressStepGroups,
  readProgressBody,
  startDeadlineProgress,
  type ProgressActor,
  type ProgressCompany,
  type ProgressDeps,
  type ProgressTrack,
} from "./progress";
import type { DeadlineBucket, StoredProgress } from "./types";

const NOW = new Date("2026-11-12T01:00:00Z");
const CONSULTANT: ProgressActor = { id: "u1", name: "김컨설", email: "kim@wedly.kr", role: "SALES_REP" };
const OTHER: ProgressActor = { id: "u2", name: "박컨설", email: "park@wedly.kr", role: "SALES_REP" };
const ADMIN: ProgressActor = { id: "a", name: "관리자", email: "admin@wedly.kr", role: "ADMIN" };

const BUCKET: DeadlineBucket = {
  bucketKey: "2026 수출바우처",
  repAnnouncementId: "ann-1",
  announcementIds: ["ann-1", "ann-2"],
  title: "  2026년 수출바우처 지원사업  ",
  agency: "중소벤처기업부",
  category: "무상지원금",
  url: "https://example.com/1",
  applyEnd: new Date("2026-11-19T05:00:00Z"),
};
const COMPANY: ProgressCompany = { customerKey: "b:1", aliases: ["b:1", "p:01012345678"], companyName: "삼영식품", readConsultantIds: ["u1"] };

/** 고유 키 충돌 — Prisma 오류 클래스 없이 code 칸만 같은 오류 객체. */
function p2002(): Error {
  return Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
}

/** 시험용 담당 확인 — 관리자이거나 업체 담당 id 에 내 id 가 든 사람. 앱이 정하는 규칙의 한 예일 뿐이다. */
function assigned(actor: ProgressActor, company: ProgressCompany | null): boolean {
  return actor.role === "ADMIN" || (company !== null && company.readConsultantIds.includes(actor.id));
}

function fakeDeps(over: Partial<ProgressDeps> = {}) {
  const deps = {
    readCompany: vi.fn(async (key: string): Promise<ProgressCompany | null> => (key === "b:1" ? COMPANY : null)),
    isAssigned: vi.fn(assigned),
    isSamePolicyName: vi.fn((a: string, b: string) => a === b),
    hasMatch: vi.fn(async () => true),
    readBucket: vi.fn(async (key: string) => (key === BUCKET.bucketKey ? BUCKET : null)),
    readProgress: vi.fn(async (): Promise<StoredProgress | null> => null),
    findTracks: vi.fn(async (): Promise<ProgressTrack[]> => []),
    createTrack: vi.fn(async () => ({ id: "t-new" })),
    appendHistory: vi.fn(async () => undefined),
    insertProgress: vi.fn(async () => undefined),
    ...over,
  };
  return deps;
}

const input = (actor = CONSULTANT, via: "web" | "slack" = "web") => ({ customerKey: "b:1", bucketKey: BUCKET.bucketKey, actor, via });

describe("작은 도움 함수", () => {
  it("정책 이름 = 제목 앞뒤 공백 빼고 200자까지, 비면 「이름 없는 공고」", () => {
    expect(policyNameOf({ title: "  2026년 수출바우처  " })).toBe("2026년 수출바우처");
    expect(policyNameOf({ title: "가".repeat(250) })).toBe("가".repeat(200));
    expect(policyNameOf({ title: "   " })).toBe("이름 없는 공고");
  });

  it("새 정책 단계 = 「신청」 묶음의 「신청 마감」 한 칸(대기·기한) + 식별자", () => {
    const groups = progressStepGroups("2026-11-19");
    expect(groups).toHaveLength(1);
    expect(groups[0].name).toBe("신청");
    expect(groups[0].steps).toHaveLength(1);
    expect(groups[0].steps[0]).toMatchObject({ label: PROGRESS_TODO, status: "대기", due: "2026-11-19" });
    expect(groups[0].steps[0].id).toMatch(/^s-0-0-[0-9a-f]{6}$/);
    expect(progressStepGroups("")[0].steps[0].due).toBe("");
  });

  it("이을 정책 = 공고 id 가 묶음 안이거나 앱의 이름 비교가 같다고 한 첫 정책", () => {
    const tracks: ProgressTrack[] = [
      { id: "t1", customerKey: "b:1", policyName: "고용장려금", announcementId: null },
      { id: "t2", customerKey: "b:1", policyName: "다른 이름", announcementId: "ann-2" },
      { id: "t3", customerKey: "b:1", policyName: "2026년 수출바우처 지원사업", announcementId: null },
    ];
    const same = (a: string, b: string) => a === b;
    expect(findLinkableTrack(tracks, BUCKET, "2026년 수출바우처 지원사업", same)?.id).toBe("t2");
    expect(findLinkableTrack(tracks.slice(2), BUCKET, "2026년 수출바우처 지원사업", same)?.id).toBe("t3");
    expect(findLinkableTrack(tracks.slice(0, 1), BUCKET, "2026년 수출바우처 지원사업", same)).toBeNull();
  });

  it("이름 비교는 앱이 넘긴 함수를 쓴다 — 띄어쓰기를 무시하는 앱이면 다른 글자도 같은 정책", () => {
    const tracks: ProgressTrack[] = [{ id: "t1", customerKey: "b:1", policyName: "수출 바우처", announcementId: null }];
    const loose = (a: string, b: string) => a.replace(/\s/g, "") === b.replace(/\s/g, "");
    expect(findLinkableTrack(tracks, { announcementIds: [] }, "수출바우처", loose)?.id).toBe("t1");
    expect(findLinkableTrack(tracks, { announcementIds: [] }, "수출바우처", (a, b) => a === b)).toBeNull();
  });
});

describe("readProgressBody — 요청 본문", () => {
  it("업체 열쇠·묶음 열쇠가 모양에 맞으면 그대로 돌려준다(앞뒤 공백은 뺀다)", () => {
    expect(readProgressBody({ customerKey: "b:1", bucketKey: "  묶음 하나 " })).toEqual({ customerKey: "b:1", bucketKey: "묶음 하나" });
  });

  it("모양이 틀리면 400 — 문장 그대로", () => {
    for (const body of [null, "글", [], {}, { customerKey: "b:1" }, { customerKey: "x:1", bucketKey: "k" }, { customerKey: "b:1", bucketKey: "" }, { customerKey: 1, bucketKey: "k" }]) {
      try {
        readProgressBody(body);
        expect.unreachable("본문이 틀렸는데 통과했다");
      } catch (error) {
        expect(error).toBeInstanceOf(DeadlineProgressError);
        expect(error).toMatchObject({ status: 400, code: "BAD_REQUEST", message: PROGRESS_BAD_BODY_MESSAGE });
      }
    }
    expect(PROGRESS_BAD_BODY_MESSAGE).toBe("업체와 공고를 골라 주세요.");
  });
});

describe("startDeadlineProgress", () => {
  it("담당이 누르면 정책 진행을 만들고(할 일 「신청 마감」·기한 = 마감일) 히스토리·진행 줄을 남긴다", async () => {
    const deps = fakeDeps();
    const result = await startDeadlineProgress(input(), NOW, deps);
    expect(result).toEqual({
      created: true, trackCreated: true, trackId: "t-new", policyName: "2026년 수출바우처 지원사업", companyName: "삼영식품",
      todo: PROGRESS_TODO, due: "2026-11-19", progress: { byName: "김컨설", via: "web", at: NOW.toISOString() },
    });
    expect(deps.isAssigned).toHaveBeenCalledWith(CONSULTANT, COMPANY);
    expect(deps.findTracks).toHaveBeenCalledWith(["b:1", "p:01012345678"]);
    expect(deps.createTrack).toHaveBeenCalledWith({
      customerKey: "b:1", policyName: "2026년 수출바우처 지원사업", announcementId: "ann-1", assignee: "kim@wedly.kr",
      startedAt: NOW, stepGroups: progressStepGroups("2026-11-19"), companyName: "삼영식품",
    });
    expect(deps.appendHistory).toHaveBeenCalledWith(
      "b:1",
      "[진행 정책] 「2026년 수출바우처 지원사업」 진행을 시작했습니다. (정책별 고객사에서 시작) · 담당 kim@wedly.kr",
      "김컨설",
    );
    expect(deps.insertProgress).toHaveBeenCalledWith({
      customerKey: "b:1", bucketKey: BUCKET.bucketKey, trackId: "t-new", byUserId: "u1", byName: "김컨설", via: "web", createdAt: NOW,
    });
  });

  it("슬랙에서 누르면 히스토리에 「정책별 고객사 · 슬랙에서 시작」", async () => {
    const appendHistory = vi.fn<ProgressDeps["appendHistory"]>(async () => undefined);
    const result = await startDeadlineProgress(input(CONSULTANT, "slack"), NOW, fakeDeps({ appendHistory }));
    expect(result.progress.via).toBe("slack");
    expect(appendHistory.mock.calls[0][1]).toContain("(정책별 고객사 · 슬랙에서 시작)");
  });

  it("담당이 아니면 403 — 아무것도 만들지 않는다", async () => {
    const deps = fakeDeps();
    await expect(startDeadlineProgress(input(OTHER), NOW, deps)).rejects.toMatchObject({ status: 403, code: "FORBIDDEN", message: NOT_ASSIGNED_MESSAGE });
    expect(NOT_ASSIGNED_MESSAGE).toBe("이 업체 담당자만 누를 수 있습니다.");
    expect(deps.createTrack).not.toHaveBeenCalled();
    expect(deps.insertProgress).not.toHaveBeenCalled();
  });

  it("담당 확인은 앱이 넘긴 함수가 정한다 — 항상 거짓이면 관리자도 막힌다", async () => {
    const deps = fakeDeps({ isAssigned: vi.fn(() => false) });
    await expect(startDeadlineProgress(input(ADMIN), NOW, deps)).rejects.toMatchObject({ status: 403, message: NOT_ASSIGNED_MESSAGE });
  });

  it("담당 확인이 비동기여도 기다린다", async () => {
    const deps = fakeDeps({ isAssigned: vi.fn(async () => true) });
    const result = await startDeadlineProgress(input(OTHER), NOW, deps);
    expect(result.created).toBe(true);
  });

  it("없는 업체 — 담당이 아니면 403(있는지 알리지 않음), 통과시키는 사람이면 404", async () => {
    const missing = { ...input(), customerKey: "b:999" };
    await expect(startDeadlineProgress(missing, NOW, fakeDeps())).rejects.toMatchObject({ status: 403, message: NOT_ASSIGNED_MESSAGE });
    await expect(startDeadlineProgress({ ...missing, actor: ADMIN }, NOW, fakeDeps()))
      .rejects.toMatchObject({ status: 404, code: "NOT_FOUND", message: "업체를 찾지 못했습니다." });
  });

  it("관리자는 담당이 아니어도 누를 수 있다", async () => {
    const result = await startDeadlineProgress(input(ADMIN), NOW, fakeDeps());
    expect(result.created).toBe(true);
  });

  it("이미 누가 진행했으면 그 진행을 돌려주고 새로 만들지 않는다", async () => {
    const existing: StoredProgress = {
      customerKey: "b:1", bucketKey: BUCKET.bucketKey, trackId: "t-old", byUserId: "u2", byName: "박컨설", via: "slack", createdAt: new Date("2026-11-11T00:00:00Z"),
    };
    const deps = fakeDeps({ readProgress: vi.fn(async () => existing) });
    const result = await startDeadlineProgress(input(), NOW, deps);
    expect(result).toEqual({
      created: false, trackCreated: false, trackId: "t-old", policyName: "2026년 수출바우처 지원사업", companyName: "삼영식품",
      todo: PROGRESS_TODO, due: "2026-11-19", progress: { byName: "박컨설", via: "slack", at: "2026-11-11T00:00:00.000Z" },
    });
    expect(deps.createTrack).not.toHaveBeenCalled();
    expect(deps.insertProgress).not.toHaveBeenCalled();
  });

  it("판정 줄이 없거나 묶음이 없으면 404", async () => {
    await expect(startDeadlineProgress(input(), NOW, fakeDeps({ hasMatch: vi.fn(async () => false) })))
      .rejects.toMatchObject({ status: 404, message: "이 업체에 맞는 공고가 아닙니다." });
    await expect(startDeadlineProgress(input(), NOW, fakeDeps({ readBucket: vi.fn(async () => null) })))
      .rejects.toMatchObject({ status: 404, message: "공고를 찾지 못했습니다." });
  });

  it("같은 공고·이름의 정책이 다른 별칭 열쇠에 있으면 그것에 잇는다 — 정책은 고치지 않고 히스토리도 안 남긴다", async () => {
    const deps = fakeDeps({
      findTracks: vi.fn(async () => [{ id: "t-alias", customerKey: "p:01012345678", policyName: "옛 이름", announcementId: "ann-2" }]),
    });
    const result = await startDeadlineProgress(input(), NOW, deps);
    expect(result).toMatchObject({ created: true, trackCreated: false, trackId: "t-alias" });
    expect(deps.createTrack).not.toHaveBeenCalled();
    expect(deps.appendHistory).not.toHaveBeenCalled();
    expect(deps.insertProgress).toHaveBeenCalledWith(expect.objectContaining({ trackId: "t-alias" }));
  });

  it("정책 이름이 같은지는 앱이 넘긴 비교로 본다 — 같다고 하면 잇고, 아니라고 하면 새로 만든다", async () => {
    const track: ProgressTrack = { id: "t-name", customerKey: "b:1", policyName: "수출바우처", announcementId: null };
    const linked = fakeDeps({ findTracks: vi.fn(async () => [track]), isSamePolicyName: vi.fn(() => true) });
    expect(await startDeadlineProgress(input(), NOW, linked)).toMatchObject({ trackCreated: false, trackId: "t-name" });
    expect(linked.isSamePolicyName).toHaveBeenCalledWith("수출바우처", "2026년 수출바우처 지원사업");

    const separate = fakeDeps({ findTracks: vi.fn(async () => [track]), isSamePolicyName: vi.fn(() => false) });
    expect(await startDeadlineProgress(input(), NOW, separate)).toMatchObject({ trackCreated: true, trackId: "t-new" });
  });

  it("상시 공고는 기한 없이(\"\"), 대표 공고 id 가 비면 null", async () => {
    const always = { ...BUCKET, applyEnd: null, repAnnouncementId: "" };
    const deps = fakeDeps({ readBucket: vi.fn(async () => always) });
    const result = await startDeadlineProgress(input(), NOW, deps);
    expect(result.due).toBe("");
    expect(deps.createTrack).toHaveBeenCalledWith(expect.objectContaining({ announcementId: null, stepGroups: progressStepGroups("") }));
  });

  it("정책 만들기가 겹쳐 P2002 면 다시 읽어 잇는다, 그래도 없으면 그 오류", async () => {
    const findTracks = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: "t-race", customerKey: "b:1", policyName: "2026년 수출바우처 지원사업", announcementId: null }]);
    const deps = fakeDeps({ findTracks, createTrack: vi.fn(async () => { throw p2002(); }) });
    const result = await startDeadlineProgress(input(), NOW, deps);
    expect(result).toMatchObject({ trackCreated: false, trackId: "t-race" });

    const stuck = fakeDeps({ createTrack: vi.fn(async () => { throw p2002(); }) });
    await expect(startDeadlineProgress(input(), NOW, stuck)).rejects.toMatchObject({ code: "P2002" });
    expect(stuck.insertProgress).not.toHaveBeenCalled();
  });

  it("P2002 가 아닌 정책 만들기 오류는 그대로 던진다", async () => {
    const deps = fakeDeps({ createTrack: vi.fn(async () => { throw new Error("DB 끊김"); }) });
    await expect(startDeadlineProgress(input(), NOW, deps)).rejects.toThrow("DB 끊김");
    expect(deps.findTracks).toHaveBeenCalledTimes(1);
  });

  it("히스토리 실패는 삼키고 진행은 성공", async () => {
    const deps = fakeDeps({ appendHistory: vi.fn(async () => { throw new Error("히스토리 실패"); }) });
    const result = await startDeadlineProgress(input(), NOW, deps);
    expect(result.created).toBe(true);
    expect(deps.insertProgress).toHaveBeenCalled();
  });

  it("두 사람이 동시에 눌러 진행 줄이 겹치면(P2002) 먼저 남긴 줄을 돌려준다", async () => {
    const first: StoredProgress = {
      customerKey: "b:1", bucketKey: BUCKET.bucketKey, trackId: "t-first", byUserId: "u2", byName: "박컨설", via: "web", createdAt: new Date("2026-11-12T00:59:00Z"),
    };
    const readProgress = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(first);
    const deps = fakeDeps({ readProgress, insertProgress: vi.fn(async () => { throw p2002(); }) });
    const result = await startDeadlineProgress(input(), NOW, deps);
    expect(result).toMatchObject({ created: false, trackCreated: true, trackId: "t-first", progress: { byName: "박컨설", via: "web", at: "2026-11-12T00:59:00.000Z" } });

    const gone = fakeDeps({ insertProgress: vi.fn(async () => { throw p2002(); }) });
    await expect(startDeadlineProgress(input(), NOW, gone)).rejects.toMatchObject({ code: "P2002" });
  });

  it("거절은 DeadlineProgressError", async () => {
    await expect(startDeadlineProgress(input(OTHER), NOW, fakeDeps())).rejects.toBeInstanceOf(DeadlineProgressError);
  });
});
