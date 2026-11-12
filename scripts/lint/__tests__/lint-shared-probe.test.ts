// 공용 린트 꾸러미(@wedly/eslint-plugin)의 규칙이 이 꾸러미의 린트 설정에서 정말 도는지 확인한다 — NO.700 「공용 묶음에 넣은 규칙이 모든 앱·공용 화면에서 돌아감(앱별 확인)」.
// probe 는 이 저장소의 진짜 eslint.config.mjs 로 규칙마다 일부러 틀린 글을 린트하고, 걸린 규칙이 꾸러미의 규칙 객체 그 자체인지까지 본다.
// 설정에서 묶음(wedly.preset)을 빼거나 같은 wedly 키로 베낀 사본 규칙을 등록하면 이 시험이 실패한다. npm test 가 린트 다음에 돌린다.
// src/ 에 두지 않는다 — src/** 는 앱 3곳의 node_modules 로 포장돼 앱 관문이 돌리는데, 거기엔 이 저장소의 eslint.config.mjs 가 없고
// node_modules/ 아래는 ESLint 기본 무시라 반드시 실패한다(2026-11-11 NO.700 리뷰 P1 · pack-excludes.test.ts 가 다시 새지 않는지 잰다).
import { describe, it, expect } from "vitest";
import path from "node:path";
import { ESLint } from "eslint";
import { probe } from "@wedly/eslint-plugin/probe";

const ROOT = path.resolve(__dirname, "../../..");

describe("공용 린트 꾸러미가 정책 매칭 공용 꾸러미(policy-match-shared) 린트 설정에 연결돼 있다", () => {
  it("규칙 여섯 개가 모두 꾸러미의 규칙으로 오류가 된다", async () => {
    const results = await probe(new ESLint({ cwd: ROOT }), {
      cwd: ROOT,
      code: "src/_lint_probe.ts",
      test: "src/_lint_probe.test.ts",
    });
    expect(results.map((r) => ({ rule: r.rule, caught: r.caught, copy: r.copy, ignored: r.ignored, error: r.error }))).toEqual(
      ["require-disable-reason", "require-disable-expiry", "no-shared-deep-import", "no-double-cast", "no-weak-assertion", "no-console"].map((rule) => ({
        rule,
        caught: true,
        copy: false,
        ignored: false,
        error: null,
      })),
    );
  });
});
