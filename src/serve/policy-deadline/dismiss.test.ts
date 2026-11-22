// 「해당 없음」(NO.789) — 담당만 누름·사유 다섯 가지·같은 (업체, 공고)는 덮어씀·되돌리기·별칭 열쇠는 본 열쇠로 저장.
// 담당 확인(isAssigned)은 진행과 같은 앱 주입이다.
import { describe, expect, it, vi } from "vitest";
import { DISMISS_BAD_BODY_MESSAGE, readDismissBody, setDeadlineDismiss, type DismissDeps } from "./dismiss";
import { DeadlineProgressError, NOT_ASSIGNED_MESSAGE, type ProgressActor, type ProgressCompany } from "./progress";
import { DISMISS_REASONS } from "./types";

const NOW = new Date("2026-11-12T01:00:00Z");
const CONSULTANT: ProgressActor = { id: "u1", name: "김컨설", email: "kim@example.com", role: "SALES_REP" };
const OTHER: ProgressActor = { id: "u2", name: "박컨설", email: "park@example.com", role: "SALES_REP" };
const ADMIN: ProgressActor = { id: "a", name: "관리자", email: "admin@example.com", role: "ADMIN" };
const COMPANY: ProgressCompany = { customerKey: "b:1", aliases: ["b:1", "p:01012345678"], companyName: "삼영식품", readConsultantIds: ["u1"] };
const BUCKET_KEY = "2026 수출바우처";

/** 시험용 담당 확인 — 관리자이거나 업체 담당 id 에 내 id 가 든 사람. */
function assigned(actor: ProgressActor, company: ProgressCompany | null): boolean {
  return actor.role === "ADMIN" || (company !== null && company.readConsultantIds.includes(actor.id));
}

function fakeDeps(over: Partial<DismissDeps> = {}) {
  return {
    readCompany: vi.fn(async (key: string): Promise<ProgressCompany | null> => (COMPANY.aliases.includes(key) ? COMPANY : null)),
    isAssigned: vi.fn(assigned),
    hasMatch: vi.fn(async () => true),
    upsertDismiss: vi.fn(async () => undefined),
    deleteDismiss: vi.fn(async () => undefined),
    ...over,
  };
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  return expect.unreachable("거절돼야 하는데 통과했다");
}

describe("setDeadlineDismiss — 해당 없음 남기기", () => {
  it("담당이 사유를 고르면 그 (업체, 공고)에 사유·누가·언제를 남긴다", async () => {
    const deps = fakeDeps();
    const result = await setDeadlineDismiss({ customerKey: "b:1", bucketKey: BUCKET_KEY, reason: "이미 신청함", actor: CONSULTANT }, NOW, deps);
    expect(result).toEqual({ dismissed: { reason: "이미 신청함", byName: "김컨설", at: NOW.toISOString() } });
    expect(deps.isAssigned).toHaveBeenCalledWith(CONSULTANT, COMPANY);
    expect(deps.hasMatch).toHaveBeenCalledWith("b:1", BUCKET_KEY);
    expect(deps.upsertDismiss).toHaveBeenCalledWith({
      customerKey: "b:1", bucketKey: BUCKET_KEY, reason: "이미 신청함", byUserId: "u1", byName: "김컨설", createdAt: NOW,
    });
    expect(deps.deleteDismiss).not.toHaveBeenCalled();
  });

  it("같은 업체의 다른 열쇠(별칭)로 눌러도 업체 본 열쇠로 남긴다", async () => {
    const deps = fakeDeps();
    await setDeadlineDismiss({ customerKey: "p:01012345678", bucketKey: BUCKET_KEY, reason: "기타", actor: ADMIN }, NOW, deps);
    expect(deps.hasMatch).toHaveBeenCalledWith("b:1", BUCKET_KEY);
    expect(deps.upsertDismiss).toHaveBeenCalledWith(expect.objectContaining({ customerKey: "b:1", reason: "기타", byUserId: "a", byName: "관리자" }));
  });

  it("사유 null = 되돌리기 — 줄을 지우고, 판정 줄이 없어졌어도 되돌린다", async () => {
    const deps = fakeDeps({ hasMatch: vi.fn(async () => false) });
    const result = await setDeadlineDismiss({ customerKey: "p:01012345678", bucketKey: BUCKET_KEY, reason: null, actor: CONSULTANT }, NOW, deps);
    expect(result).toEqual({ dismissed: null });
    expect(deps.deleteDismiss).toHaveBeenCalledWith("b:1", BUCKET_KEY);
    expect(deps.upsertDismiss).not.toHaveBeenCalled();
  });

  it("담당이 아니면 403 — 없는 업체도 같은 403(있는지조차 알리지 않는다), 아무것도 쓰지 않는다", async () => {
    for (const customerKey of ["b:1", "b:999"]) {
      const deps = fakeDeps();
      const error = await rejection(setDeadlineDismiss({ customerKey, bucketKey: BUCKET_KEY, reason: "기타", actor: OTHER }, NOW, deps));
      expect(error).toBeInstanceOf(DeadlineProgressError);
      expect(error).toMatchObject({ status: 403, code: "FORBIDDEN", message: NOT_ASSIGNED_MESSAGE });
      expect(deps.upsertDismiss).not.toHaveBeenCalled();
      expect(deps.deleteDismiss).not.toHaveBeenCalled();
    }
  });

  it("담당 확인을 통과했는데 업체가 없으면 404 「업체를 찾지 못했습니다.」 — 되돌리기도 같다", async () => {
    for (const reason of ["기타", null] as const) {
      const deps = fakeDeps();
      const error = await rejection(setDeadlineDismiss({ customerKey: "b:999", bucketKey: BUCKET_KEY, reason, actor: ADMIN }, NOW, deps));
      expect(error).toMatchObject({ status: 404, code: "NOT_FOUND", message: "업체를 찾지 못했습니다." });
      expect(deps.upsertDismiss).not.toHaveBeenCalled();
      expect(deps.deleteDismiss).not.toHaveBeenCalled();
    }
  });

  it("그 업체에 맞는 공고가 아니면 404 「이 업체에 맞는 공고가 아닙니다.」 — 쓰지 않는다", async () => {
    const deps = fakeDeps({ hasMatch: vi.fn(async () => false) });
    const error = await rejection(setDeadlineDismiss({ customerKey: "b:1", bucketKey: BUCKET_KEY, reason: "자격이 안 됨", actor: CONSULTANT }, NOW, deps));
    expect(error).toMatchObject({ status: 404, code: "NOT_FOUND", message: "이 업체에 맞는 공고가 아닙니다." });
    expect(deps.upsertDismiss).not.toHaveBeenCalled();
  });

  it("isAssigned 가 Promise 를 돌려줘도 기다린다", async () => {
    const deps = fakeDeps({ isAssigned: vi.fn(async () => false) });
    const error = await rejection(setDeadlineDismiss({ customerKey: "b:1", bucketKey: BUCKET_KEY, reason: "기타", actor: CONSULTANT }, NOW, deps));
    expect(error).toMatchObject({ status: 403 });
  });
});

describe("readDismissBody — 요청 본문", () => {
  it("업체·공고·사유가 맞으면 그대로(공고 열쇠 앞뒤 공백은 뺀다) · 사유 null 은 되돌리기", () => {
    for (const reason of DISMISS_REASONS) {
      expect(readDismissBody({ customerKey: "b:1", bucketKey: "  묶음 하나 ", reason })).toEqual({ customerKey: "b:1", bucketKey: "묶음 하나", reason });
    }
    expect(readDismissBody({ customerKey: "p:01012345678", bucketKey: "k", reason: null })).toEqual({ customerKey: "p:01012345678", bucketKey: "k", reason: null });
  });

  it("모양이 틀리면 400 — 사유 키가 없거나 다섯 가지 밖이면 거절", () => {
    const bodies: unknown[] = [
      null, "글", [], {},
      { customerKey: "b:1", bucketKey: "k" },
      { customerKey: "b:1", bucketKey: "k", reason: "모름" },
      { customerKey: "b:1", bucketKey: "k", reason: "" },
      { customerKey: "b:1", bucketKey: "k", reason: 1 },
      { customerKey: "x:1", bucketKey: "k", reason: "기타" },
      { customerKey: "b:1", bucketKey: "", reason: "기타" },
      { customerKey: "b:1", bucketKey: "k".repeat(301), reason: "기타" },
    ];
    for (const body of bodies) {
      try {
        readDismissBody(body);
        expect.unreachable("본문이 틀렸는데 통과했다");
      } catch (error) {
        expect(error).toBeInstanceOf(DeadlineProgressError);
        expect(error).toMatchObject({ status: 400, code: "BAD_REQUEST", message: DISMISS_BAD_BODY_MESSAGE });
      }
    }
    expect(DISMISS_BAD_BODY_MESSAGE).toBe("업체·공고·사유를 골라 주세요.");
  });
});
