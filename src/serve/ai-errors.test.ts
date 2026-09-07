/**
 * `isBillingOrAuthError` 의 여섯 갈래를 고정한다.
 *
 * ★왜 재는가: 이 함수가 `false` 를 잘못 내면 「돈·열쇠」 탓 오류를 공고 탓으로 세어
 *  남은 공고를 전부 같은 이유로 태우고 재시도 횟수만 올린다(ERP 2026-08-23 실측 905건).
 *  반대로 `true` 를 잘못 내면 진짜 공고 오류가 예산 환불로 묻힌다.
 */
import { describe, expect, it } from "vitest";
import { isBillingOrAuthError } from "./ai-errors";

const 참_문구 = [
  "credit balance is too low",
  "authentication_error",
  "permission_error",
  "invalid x-api-key",
  "organization has been disabled",
] as const;

describe("isBillingOrAuthError — 참(돈·열쇠·권한 탓)", () => {
  for (const 문구 of 참_문구) {
    it(`문구 「${문구}」 를 품으면 참이다`, () => {
      expect(isBillingOrAuthError(new Error(`400 {"type":"error","message":"${문구}"}`))).toBe(true);
    });

    it(`문구 「${문구}」 는 대문자로 와도 참이다 — 소문자로 낮춰 잰다`, () => {
      expect(isBillingOrAuthError(new Error(문구.toUpperCase()))).toBe(true);
    });
  }

  it("status 401 이면 참이다 — 문구가 없어도", () => {
    expect(isBillingOrAuthError({ status: 401 })).toBe(true);
  });

  it("status 403 이면 참이다 — 문구가 없어도", () => {
    expect(isBillingOrAuthError({ status: 403 })).toBe(true);
  });
});

describe("isBillingOrAuthError — 거짓(그 공고 탓)", () => {
  it("보통 오류는 거짓이다", () => {
    expect(isBillingOrAuthError(new Error("공고 본문이 비어 있습니다"))).toBe(false);
  });

  it("status 500 은 거짓이다 — 서버 탓은 재시도 대상이다", () => {
    expect(isBillingOrAuthError({ status: 500 })).toBe(false);
  });

  it("문자열 '401' 은 거짓이다 — status 는 숫자로만 센다", () => {
    expect(isBillingOrAuthError({ status: "401" })).toBe(false);
  });

  it("오류가 아닌 값도 죽지 않고 거짓이다", () => {
    expect(isBillingOrAuthError(null)).toBe(false);
    expect(isBillingOrAuthError(undefined)).toBe(false);
    expect(isBillingOrAuthError("그냥 글자")).toBe(false);
  });
});
