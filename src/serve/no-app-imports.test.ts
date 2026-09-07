/**
 * ★코어는 **앱을 모른다** — 이 시험이 그 경계를 지킨다.
 *
 * `src/serve/` 안에서 아래 글자가 하나라도 보이면 실패한다:
 *  - 웹 응답(`next/server`) · Prisma 클라이언트 · AI SDK
 *  - 앱 별칭 경로(`@` + `/`) — 패키지 안에서는 상대경로만 쓴다
 *
 * 왜 「보이면 실패」인가: import 만 막으면 주석·문자열로 슬쩍 되살아난 뒤 다음 사람이
 * 그것을 보고 진짜 import 를 다시 넣는다. 글자로 잡는 편이 값싸고 확실하다.
 * (찾는 글자를 여기서 **이어 붙여 만든다** — 안 그러면 이 파일이 자기 자신에게 걸린다.)
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SERVE_DIR = fileURLToPath(new URL(".", import.meta.url));
const SELF = "no-app-imports.test.ts";

const FORBIDDEN: Array<{ label: string; needle: string }> = [
  { label: "웹 응답(Next)", needle: "next" + "/server" },
  { label: "Prisma 클라이언트", needle: "@prisma" + "/client" },
  { label: "AI SDK", needle: "@anthropic" + "-ai" },
  { label: "앱 별칭 경로", needle: "@" + "/" },
];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
      continue;
    }
    if (name === SELF) continue;
    if (name.endsWith(".ts") || name.endsWith(".tsx")) out.push(full);
  }
  return out;
}

describe("판정 통로 코어의 경계", () => {
  const files = walk(SERVE_DIR);

  it("검사할 파일이 실제로 있다 — 빈 목록으로 초록이 되지 않게", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  for (const { label, needle } of FORBIDDEN) {
    it(`${label} 을(를) 부르지 않는다 — 0건`, () => {
      const hits = files
        .filter((f) => readFileSync(f, "utf8").includes(needle))
        .map((f) => f.slice(SERVE_DIR.length));
      expect(hits).toEqual([]);
    });
  }
});
