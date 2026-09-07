/**
 * `.github/workflows/*.yml` 에서 `run:` 토막과 job 덩어리를 잘라 내는 조각.
 * `workflow.test.ts`(모양 검사)와 `resolve-shell.test.ts`(그 토막을 **실제로 실행**)가 함께 쓴다.
 *
 * ★글자 대조가 아니라 「들여쓰기를 따라 실제로 잘라 내기」인 이유: 주석이나 `env:` 에 있는 글자를
 *  `run:` 안의 것으로 잘못 세면 시험이 늘 빨갛거나 늘 초록이 된다.
 */

/** `run:` 값(한 줄짜리와 `|` 블록 둘 다)을 들여쓰기로 잘라 낸다 */
export function runBlocks(text: string): string[] {
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

/** `  <이름>:` 로 시작하는 job 한 덩어리를 잘라 낸다(없으면 빈 문자열) */
export function jobSection(yaml: string, name: string): string {
  const start = yaml.indexOf(`\n  ${name}:\n`);
  if (start < 0) return "";
  const after = yaml.slice(start + 1);
  const next = after.slice(1).search(/\n {2}[a-z_]+:\n/);
  return next === -1 ? after : after.slice(0, next + 1);
}
