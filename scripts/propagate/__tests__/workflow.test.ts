import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * `.github/workflows/propagate.yml` 의 「지켜야 하는 모양」 시험 — 2026-09-08 리뷰(R2·R3·R4).
 *
 * ★왜 이 시험이 있나: 워크플로우는 여기서 실행해 볼 수 없다(GitHub 안에서만 돈다).
 *  그런데 이 파일이 어긋나면 **토큰이 앱 코드 옆으로 돌아오거나, 예행이 진짜 반영을 취소하거나,
 *  아무도 모르게 초록으로 끝난다.** 그래서 리뷰가 세운 규칙 다섯 가지만 파일에서 직접 잰다:
 *   ① `run:` 안에 `${{ }}` 가 하나도 없다(스크립트 인젝션)
 *   ② 밀기 job 은 npm 을 부르지 않는다(토큰 옆에서 앱 코드가 돌지 않는다)
 *   ③ 쓰기 토큰·읽기 토큰이 각각 한 자리에서만 쓰인다
 *   ④ 알림 호출 세 자리의 `|| true` 가 규칙대로다(실패 알림만 무시, 배포 미확인은 무시하지 않음)
 *   ⑤ 동시성 줄이 손 실행과 자동 반영을 갈라 세운다
 *
 * ★글자만 세지 않도록: `run:` 토막은 **들여쓰기를 따라 실제로 잘라 내어** 그 안만 본다.
 *  주석이나 `env:` 에 있는 `${{ }}` 는 규칙 위반이 아니므로 그것까지 세면 늘 빨간 시험이 된다.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const FILE = resolve(HERE, "../../../.github/workflows/propagate.yml");
const YAML = readFileSync(FILE, "utf8");

/** `run:` 값(한 줄짜리와 `|` 블록 둘 다)을 들여쓰기로 잘라 낸다 */
function runBlocks(text: string): string[] {
  const lines = text.split("\n");
  const blocks: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const m = /^(\s*)run:\s*(.*)$/.exec(lines[i]);
    if (!m) continue;
    const indent = m[1].length;
    const rest = m[2].trim();
    if (rest && !/^[|>][-+]?$/.test(rest)) {
      blocks.push(rest);
      continue;
    }
    const body: string[] = [];
    for (let j = i + 1; j < lines.length; j += 1) {
      const line = lines[j];
      if (line.trim() === "") {
        body.push("");
        continue;
      }
      if (line.length - line.trimStart().length <= indent) break;
      body.push(line);
    }
    blocks.push(body.join("\n"));
  }
  return blocks;
}

/** `  <이름>:` 로 시작하는 job 한 덩어리를 잘라 낸다 */
function jobSection(name: string): string {
  const start = YAML.indexOf(`\n  ${name}:\n`);
  expect(start, `job 을 찾지 못했습니다: ${name}`).toBeGreaterThan(0);
  const after = YAML.slice(start + 1);
  const next = after.slice(1).search(/\n {2}[a-z_]+:\n/);
  return next === -1 ? after : after.slice(0, next + 1);
}

const BLOCKS = runBlocks(YAML);

describe(".github/workflows/propagate.yml", () => {
  it("잘라 낸 `run:` 토막이 실제로 여러 개다 — 아래 시험들이 빈 목록을 재지 않게", () => {
    expect(BLOCKS.length).toBeGreaterThanOrEqual(6);
    expect(BLOCKS.join("\n")).toContain("propagate.sh push");
  });

  it("`run:` 안에는 `${{ }}` 가 하나도 없다 — 커밋 제목 같은 남의 글자가 명령이 되지 않게", () => {
    const bad = BLOCKS.filter((b) => b.includes("${{"));
    expect(bad).toEqual([]);
  });

  it("밀기(push) job 은 npm 을 부르지 않는다 — 토큰을 쥔 자리에서 앱 코드가 돌지 않는다", () => {
    const push = jobSection("push");
    const npmCalls = runBlocks(push).filter((b) => /(^|\s)npm\s/.test(b));
    expect(npmCalls).toEqual([]);
    // 반대로 준비 job 은 npm 을 쓰는 자리다(위 판정이 「어디서든 npm 이 없다」가 아니라는 확인)
    expect(jobSection("prepare")).toContain("propagate.sh prepare");
  });

  it("읽기 토큰은 클론 단계에서, 쓰기 토큰은 밀기 단계에서만 쓰인다", () => {
    const readTokenUses = YAML.match(/secrets\.PROPAGATE_READ_TOKEN/g) ?? [];
    const writeTokenUses = YAML.match(/secrets\.PROPAGATE_TOKEN(?![A-Z_])/g) ?? [];
    expect(readTokenUses).toHaveLength(1);
    expect(writeTokenUses).toHaveLength(1);
    expect(jobSection("prepare")).toContain("secrets.PROPAGATE_READ_TOKEN");
    expect(jobSection("prepare")).not.toContain("secrets.PROPAGATE_TOKEN\n");
    expect(jobSection("push")).toContain("secrets.PROPAGATE_TOKEN");
  });

  it("알림 호출: 실패 알림만 `|| true`, 「배포 확인 못 함」은 무시하지 않는다", () => {
    const notifyBlocks = BLOCKS.filter((b) => b.includes("notify.sh"));
    expect(notifyBlocks).toHaveLength(3);
    const unconfirmed = notifyBlocks.filter((b) => b.includes("배포 확인 못 함"));
    const failures = notifyBlocks.filter((b) => !b.includes("배포 확인 못 함"));
    expect(unconfirmed).toHaveLength(1);
    expect(unconfirmed[0]).not.toContain("|| true");
    expect(failures).toHaveLength(2);
    for (const b of failures) expect(b).toContain("|| true");
  });

  it("동시성: 손으로 돌린 예행은 자동 반영과 다른 줄에 선다 — 예행이 진짜 반영을 취소하지 않게", () => {
    expect(YAML).toContain(
      "group: propagate-${{ github.event_name == 'workflow_dispatch' && 'manual' || 'main' }}",
    );
    expect(YAML).toContain("cancel-in-progress: false");
  });

  it("남의 복제본에서 온 CI 실행으로는 돌지 않는다", () => {
    expect(jobSection("resolve")).toContain(
      "github.event.workflow_run.head_repository.full_name == github.repository",
    );
  });

  it("기본 토큰 권한은 읽기뿐이다", () => {
    expect(YAML).toMatch(/^permissions:\n {2}contents: read$/m);
  });
});
