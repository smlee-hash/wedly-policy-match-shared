import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { BOARD_SOURCES } from "../registry";
import type { PolicyAttachmentRequest } from "../types";

/**
 * 게시판 첨부 갈고리(`detailAttachments`)를 상세 화면 고정본에 바로 대 본다(2026-10-16).
 * 읽기 흐름(첨부 목록 다시 읽기·상세 채움)을 거치지 않으므로, 갈고리 하나가 틀리면 그 고정본 이름으로 바로 드러난다.
 * 고정본·기대 목록은 attachment-list.test.ts 와 같은 것(__fixtures__/attachments/, 만든 방법은 그 README)이다.
 */

const DIR = join(__dirname, "..", "__fixtures__", "attachments");
const read = (name: string): string => readFileSync(join(DIR, name), "utf8");
const EXPECTED = JSON.parse(read("expected.json")) as Record<string, PolicyAttachmentRequest[]>;

/** 이번에 갈고리를 다는 게시판 — 공용 수확기가 못 잡는 단추(자바스크립트 내려받기·POST·확장자 없는 주소)를 쓴다. */
const NEW_HOOKS = [
  "bizok", "dgtp", "innobiz", "jica", "cistep", "dgsinbo", "gbsinbo", "djsinbo", "sjsinbo", "jbsinbo",
  "jnsinbo", "jba", "bepa", "kidp", "kita", "ansan", "motie", "cbf", "kodma", "kicox",
];
/** 이미 갈고리가 있던 게시판. */
const OLD_HOOKS = ["hrdk", "kocca-finance", "kofic", "mof", "mois", "molit", "snip", "wbiz"];

/** 고정본 첫 줄 `<!-- 주소 -->` = 그 화면의 상세 주소(우리가 붙인 것 — 화면 원문에는 없다). */
function urlOf(html: string): string {
  const m = html.match(/^<!--\s*(\S+)\s*-->/);
  if (!m) throw new Error("고정본 첫 줄에 상세 주소가 없다");
  return m[1];
}

const sourceOf = (key: string): string => key.replace(/-\d+$/, "");
const KEYS = Object.keys(EXPECTED)
  .filter((key) => NEW_HOOKS.includes(sourceOf(key)))
  .sort();

describe("게시판 첨부 갈고리 — 상세 고정본에 바로 대 보기", () => {
  it("갈고리를 다는 20곳 모두 고정본이 있다", () => {
    expect([...new Set(KEYS.map(sourceOf))].sort()).toEqual([...NEW_HOOKS].sort());
  });

  /**
   * 갈고리는 화면 전체(`pageHtml`)만 본다 — 몇몇 게시판은 수확 범위 선택자가 첨부 상자를 못 잡아서다(세종신보 등).
   * 그래서 수확 범위(`html`)는 일부러 비워 넘긴다.
   */
  it.each(KEYS)("%s", (key) => {
    const cfg = BOARD_SOURCES.find((c) => c.id === sourceOf(key));
    const hook = cfg?.detailAttachments;
    if (!cfg || !hook) throw new Error(`${sourceOf(key)} 에 첨부 갈고리가 없다`);
    const page = read(`${key}.html`);
    const got = hook({ html: "", pageHtml: page, detailUrl: urlOf(page), baseUrl: cfg.baseUrl });
    expect(got).toEqual(EXPECTED[key]);
  });

  it("첨부 상자가 없는 화면이면 던지지 않고 빈 목록", () => {
    const page = "<html><body><div id=\"content\">본문만 있고 첨부 상자가 없다</div></body></html>";
    for (const id of NEW_HOOKS) {
      const cfg = BOARD_SOURCES.find((c) => c.id === id);
      const hook = cfg?.detailAttachments;
      if (!cfg || !hook) throw new Error(`${id} 에 첨부 갈고리가 없다`);
      expect(hook({ html: "", pageHtml: page, detailUrl: cfg.baseUrl, baseUrl: cfg.baseUrl }), id).toEqual([]);
    }
  });

  it("동기 갈고리가 있는 게시판 = 기존 8곳 + 이번 20곳", () => {
    const ids = BOARD_SOURCES.filter((c) => c.detailAttachments).map((c) => c.id).sort();
    expect(ids).toEqual([...OLD_HOOKS, ...NEW_HOOKS].sort());
  });
});
