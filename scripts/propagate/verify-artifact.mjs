#!/usr/bin/env node
// scripts/propagate/verify-artifact.mjs — 산출물이 「기준 파일에서 핀 한 줄만 바뀐 것」인지 대조한다.
// 계획서: docs/superpowers/plans/2026-09-07-p5-propagate-bot.md (2026-09-08 2차 리뷰 F4 · P1)
//
// 사용: node verify-artifact.mjs <baseDir> <artifactDir> <sha40> <commitPath...>
// 종료 코드: 0 = 「핀 한 줄만 바뀐 것」이 맞다 · 1 = 아니다(무엇이 다른지 적는다) · 2 = 인자 오류
//
// ★왜 있나: 밀기 단계는 준비 단계가 만든 산출물을 **믿을 수 없는 입력**으로 다뤄야 한다.
//  준비 job 에서는 앱 코드(npm 스크립트·설계 등록부 생성기·그 의존성)가 돌고, 그 코드는 산출물 폴더의
//  파일을 마음대로 바꿀 수 있다. verify-lock 은 「핀이 새 SHA 인가」만 보므로,
//    · package.json 에 `"scripts": { "postinstall": "..." }` 를 더하거나
//    · package-lock 의 `resolved` 를 **남의 tgz 주소**로 바꾸거나
//    · 잠금 파일에 처음 보는 꾸러미 항목을 끼워 넣어도
//  그대로 통과해 3앱 main 에 밀리고 Railway 가 그걸 설치·실행했다. 이 대조기가 그 문을 닫는다.
//
// ★판정 방식은 「목록으로 막기」가 아니라 「기준과 같아야 한다」이다:
//  기준 파일(앱 main 의 그 커밋)에서 **우리가 바꾸기로 한 자리만** 바꾼 것을 만들어 두고,
//  산출물이 그것과 **깊은 비교로 똑같은지** 본다. 그래서 「아직 상상 못 한 방식의 변조」도 걸린다.
//
// ★알아 두기(README §5 에도 적혀 있다): 공용 보관함이 나중에 **런타임 의존을 더하면**
//  `npm install --package-lock-only` 가 잠금 파일에 새 꾸러미 항목을 만든다. 그러면 이 대조기가
//  「모르는 항목」으로 **안전하게 실패**한다 — 봇이 멋대로 남의 꾸러미를 앱에 들이지 않는다는 뜻이고,
//  그때는 사람이 한 번 보고 손으로 핀을 올린 뒤 이 규칙을 넓힐지 정한다.
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const NAME = "@wedly/policy-match-shared";
const REPO = "smlee-hash/wedly-policy-match-shared";
const MAX_REGISTRY_BYTES = 5 * 1024 * 1024; // 5MB — ERP 등록부 실측 수십 KB
const MAX_DIFF_LINES = 20; // 오류문이 로그를 뒤덮지 않게

const [baseDir, artifactDir, sha, ...commitPaths] = process.argv.slice(2);
if (!baseDir || !artifactDir || !/^[0-9a-f]{40}$/.test(sha ?? "") || commitPaths.length === 0) {
  process.stderr.write("사용법: verify-artifact.mjs <baseDir> <artifactDir> <sha40> <commitPath...>\n");
  process.exit(2);
}

const problems = [];
const expectedSpec = `github:${REPO}#${sha}`;
/** 잠금 파일의 `resolved` 로 받아 줄 모양 — 우리 저장소의 그 커밋만 */
const RESOLVED_RE = new RegExp(
  `^git\\+(ssh|https)://(git@)?github\\.com/${REPO.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\.git)?#${sha}$`,
);

const readJson = (path, label) => {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    const why = err?.code === "ENOENT" ? "파일이 없음" : String(err?.message ?? err).split("\n")[0];
    problems.push(`${label} 를 읽지 못함: ${why}`);
    return null;
  }
};

/** 폴더 안의 파일을 상대 경로로 모두 모은다(심볼릭 링크는 그 자리에서 거부) */
function listFiles(dir, prefix = "") {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = `${prefix}${entry.name}`;
    if (entry.isSymbolicLink()) {
      problems.push(`산출물에 심볼릭 링크가 있습니다: ${rel}`);
      continue;
    }
    if (entry.isDirectory()) found.push(...listFiles(join(dir, entry.name), `${rel}/`));
    else found.push(rel);
  }
  return found;
}

/** 두 값이 다른 자리를 경로와 함께 모은다(순서는 보지 않는다 — JSON 개체는 순서에 뜻이 없다) */
function collectDiffs(want, got, path, out) {
  if (out.length >= MAX_DIFF_LINES) return out;
  const kind = (v) => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v);
  if (kind(want) !== kind(got)) {
    out.push(`${path || "(뿌리)"}: 모양이 다름(${kind(want)} ↔ ${kind(got)})`);
    return out;
  }
  if (Array.isArray(want)) {
    if (want.length !== got.length) out.push(`${path}: 길이가 다름(${want.length} ↔ ${got.length})`);
    for (let i = 0; i < Math.max(want.length, got.length); i += 1) collectDiffs(want[i], got[i], `${path}[${i}]`, out);
    return out;
  }
  if (want !== null && typeof want === "object") {
    for (const key of new Set([...Object.keys(want), ...Object.keys(got)])) {
      const here = path ? `${path}.${key}` : key;
      if (!(key in want)) out.push(`${here}: 기준에 없는 칸이 산출물에 있음`);
      else if (!(key in got)) out.push(`${here}: 기준에 있는 칸이 산출물에 없음`);
      else collectDiffs(want[key], got[key], here, out);
    }
    return out;
  }
  if (want !== got) out.push(`${path}: 값이 다름(${JSON.stringify(want)} ↔ ${JSON.stringify(got)})`);
  return out;
}

const clone = (v) => JSON.parse(JSON.stringify(v));

function reportDiffs(label, want, got) {
  const diffs = collectDiffs(want, got, "", []);
  if (!diffs.length) return;
  problems.push(
    `${label} 가 「기준 파일 + 핀 한 줄」과 다릅니다(${diffs.length}곳${diffs.length >= MAX_DIFF_LINES ? " 이상" : ""}):\n` +
      diffs.map((d) => `    · ${d}`).join("\n"),
  );
}

/** ① package.json — 핀 한 칸 말고는 기준과 똑같아야 한다 */
function checkPackageJson(rel) {
  const base = readJson(join(baseDir, rel), `기준 ${rel}`);
  const got = readJson(join(artifactDir, rel), `산출물 ${rel}`);
  if (!base || !got) return;
  if (!base.dependencies || typeof base.dependencies !== "object") {
    problems.push(`기준 ${rel} 에 dependencies 가 없습니다 — 앱 저장소가 예상과 다릅니다`);
    return;
  }
  const want = clone(base);
  want.dependencies[NAME] = expectedSpec;
  reportDiffs(`산출물 ${rel}`, want, got);
}

/** ② package-lock.json — 우리 꾸러미 두 자리 말고는 기준과 똑같아야 한다 */
function checkLockJson(rel) {
  const base = readJson(join(baseDir, rel), `기준 ${rel}`);
  const got = readJson(join(artifactDir, rel), `산출물 ${rel}`);
  if (!base || !got) return;
  const entryKey = `node_modules/${NAME}`;
  if (!base.packages?.[""]?.dependencies || typeof base.packages[""].dependencies !== "object") {
    problems.push(`기준 ${rel} 에 packages[""].dependencies 가 없습니다 — 앱 저장소가 예상과 다릅니다`);
    return;
  }
  const entry = got.packages?.[entryKey];
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    problems.push(`산출물 ${rel} 에 ${entryKey} 항목이 없습니다`);
    return;
  }
  // 이 항목은 통째로 바뀌어도 되는 유일한 자리다 — 그래서 여기만은 **내용을 직접** 본다.
  if (!RESOLVED_RE.test(String(entry.resolved ?? ""))) {
    problems.push(
      `산출물 ${rel} 의 ${entryKey}.resolved 가 우리 저장소의 그 커밋이 아닙니다: ${entry.resolved ?? "(없음)"}`,
    );
  }
  if (!String(entry.integrity ?? "").startsWith("sha512-")) {
    problems.push(`산출물 ${rel} 의 ${entryKey}.integrity 가 sha512 가 아닙니다: ${entry.integrity ?? "(없음)"}`);
  }
  const want = clone(base);
  want.packages[""].dependencies[NAME] = expectedSpec;
  want.packages[entryKey] = clone(entry); // 위에서 따로 본 자리라 비교에서 뺀다
  reportDiffs(`산출물 ${rel}`, want, got);
}

/** ③ 설계 등록부 — JSON 으로 읽히고 너무 크지 않기만 하면 된다(내용은 ERP 가 만든다) */
function checkRegistryJson(rel) {
  let text;
  try {
    text = readFileSync(join(artifactDir, rel));
  } catch (err) {
    problems.push(`산출물 ${rel} 를 읽지 못함: ${String(err?.message ?? err).split("\n")[0]}`);
    return;
  }
  if (text.length > MAX_REGISTRY_BYTES) {
    problems.push(`산출물 ${rel} 가 너무 큽니다: ${text.length} 바이트(상한 ${MAX_REGISTRY_BYTES})`);
    return;
  }
  try {
    JSON.parse(text.toString("utf8"));
  } catch (err) {
    problems.push(`산출물 ${rel} 가 JSON 이 아닙니다: ${String(err?.message ?? err).split("\n")[0]}`);
  }
}

// ④ 목록 밖 파일 거부 · 목록에 있는데 없는 파일도 거부
let present = [];
try {
  present = listFiles(artifactDir);
} catch (err) {
  problems.push(`산출물 폴더를 읽지 못함: ${String(err?.message ?? err).split("\n")[0]}`);
}
const listed = new Set(commitPaths);
const seen = new Set(present.filter((p) => p !== "meta.json"));
const unknown = [...seen].filter((p) => !listed.has(p)).sort();
if (unknown.length) problems.push(`산출물에 커밋 대상이 아닌 파일이 있습니다: ${unknown.join(", ")}`);
for (const rel of commitPaths) {
  if (!seen.has(rel)) {
    problems.push(`산출물에 커밋 대상 파일이 없습니다: ${rel}`);
    continue;
  }
  if (lstatSync(join(artifactDir, rel)).isSymbolicLink()) continue; // 위 listFiles 가 이미 적었다
  if (rel === "package.json") checkPackageJson(rel);
  else if (rel === "package-lock.json") checkLockJson(rel);
  else if (rel.endsWith("registry.generated.json")) checkRegistryJson(rel);
  else problems.push(`검증 규칙이 없는 파일입니다: ${rel} — 규칙을 먼저 정한 뒤 커밋 대상에 넣으세요`);
}

if (problems.length) {
  process.stderr.write(problems.map((p) => `verify-artifact: ${p}`).join("\n") + "\n");
  process.exit(1);
}
process.stdout.write(`verify-artifact: OK ${commitPaths.length}개 파일 — 기준에서 핀만 ${sha} 로 바뀌었습니다\n`);
