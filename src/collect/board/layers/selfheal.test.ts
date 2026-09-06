import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { selfHeal, buildHealPrompt, sanitizeHealedRule } from "./selfheal";
import type { BoardConfig } from "../types";

const HTML = `<ul><li class="row"><a href="/v/9">2026 지원사업 재도출 공고</a><time>2026-08-10</time></li></ul>`;
const cfg = { id: "t", label: "테", agency: "A", region: "부산", baseUrl: "https://d.kr/", list: {} } as unknown as BoardConfig;

const GOOD_RULE = {
  rowSelector: "li.row",
  fields: { title: { selector: "a" }, detailUrl: { selector: "a", attr: "href" }, date: { selector: "time" } },
};

describe("selfHeal", () => {
  it("모델이 준 규칙으로 재추출하고, 검증 통과 시 rule 을 돌려준다", async () => {
    const askModel = async () => JSON.stringify(GOOD_RULE);
    const r = await selfHeal(HTML, cfg, { prevCount: 0 }, askModel);
    expect(r.ok).toBe(true);
    expect(r.rows?.[0].title).toContain("재도출");
    expect(r.rule?.rowSelector).toBe("li.row");
  });
  it("모델 규칙이 검증 실패면 persist 하지 않는다(ok=false)", async () => {
    const askModel = async () => JSON.stringify({ rowSelector: "nope", fields: { title: {}, detailUrl: {}, date: {} } });
    const r = await selfHeal(HTML, cfg, { prevCount: 0 }, askModel);
    expect(r.ok).toBe(false);
    expect(r.rule).toBeUndefined();
  });
  it("askModel 에 프롬프트를 주입해 1회 호출한다", async () => {
    const askModel = vi.fn(async (_prompt: string) => JSON.stringify(GOOD_RULE));
    await selfHeal(HTML, cfg, { prevCount: 0 }, askModel);
    expect(askModel).toHaveBeenCalledOnce();
    expect(askModel.mock.calls[0][0]).toBe(buildHealPrompt(HTML));
  });
  it("askModel 의 쿨다운 throw 는 삼키지 않는다", async () => {
    await expect(selfHeal(HTML, cfg, { prevCount: 0 }, async () => {
      throw new Error("자가수리 쿨다운 24시간 이내");
    })).rejects.toThrow(/쿨다운/);
  });
  it("sanitize 를 통과하지 못한 모델 규칙은 버린다", async () => {
    const askModel = async () => JSON.stringify({
      ...GOOD_RULE,
      fields: { ...GOOD_RULE.fields, onclick: { selector: "script" } },
    });
    const r = await selfHeal(HTML, cfg, { prevCount: 0 }, askModel);
    expect(r.ok).toBe(false);
    expect(r.rule).toBeUndefined();
  });
});

describe("sanitizeHealedRule", () => {
  it("허용 필드와 200자 이내 selector 만 통과한다", () => {
    const ok = sanitizeHealedRule(GOOD_RULE);
    expect(ok?.rowSelector).toBe("li.row");
    expect(sanitizeHealedRule({
      rowSelector: "a".repeat(201),
      fields: GOOD_RULE.fields,
    })).toBeNull();
    expect(sanitizeHealedRule({
      rowSelector: "li.row",
      fields: { ...GOOD_RULE.fields, extra: { selector: "b" } },
    })).toBeNull();
    expect(sanitizeHealedRule({
      rowSelector: "li.row",
      fields: { title: { selector: "a".repeat(201) }, detailUrl: { selector: "a" }, date: {} },
    })).toBeNull();
    expect(sanitizeHealedRule({
      rowSelector: "li.row",
      fields: { title: { selector: "a" }, detailUrl: { selector: "a", regex: "x".repeat(201) }, date: {} },
    })).toBeNull();
  });

  it("title·detailUrl 이 빈 규칙이면 거부한다", () => {
    expect(sanitizeHealedRule({
      rowSelector: "li.row",
      fields: { title: {}, detailUrl: {}, date: {} },
    })).toBeNull();
  });

  it("healed 규칙의 regex 는 제거한다", () => {
    const ok = sanitizeHealedRule({
      rowSelector: "li.row",
      fields: {
        title: { selector: "a", regex: "(.*)+" },
        detailUrl: { selector: "a", attr: "href", regex: ".*" },
        date: { selector: "time", regex: "\\d+" },
      },
    });
    expect(ok).not.toBeNull();
    expect(ok?.fields.title.regex).toBeUndefined();
    expect(ok?.fields.detailUrl.regex).toBeUndefined();
    expect(ok?.fields.date?.regex).toBeUndefined();
  });
});

describe("buildHealPrompt", () => {
  it("부산 고정본 프롬프트에 목록 표가 들어간다", () => {
    const html = readFileSync(join(__dirname, "../__fixtures__/tp-busan-list.html"), "utf-8");
    const prompt = buildHealPrompt(html);
    expect(prompt.includes("bdListTbl") || prompt.includes("기술수요조사")).toBe(true);
  });
});
