#!/usr/bin/env node
// scripts/propagate/verify-lock.mjs — 핀 갱신 뒤 package.json·package-lock(·설치 잠금)이 새 SHA 로 일치하는지 대조.
// 사용: node verify-lock.mjs <appRoot> <sha40> [--installed]
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";

const NAME = "@wedly/policy-match-shared";
const REPO = "smlee-hash/wedly-policy-match-shared";
const [root, sha, ...flags] = process.argv.slice(2);

if (!root || !/^[0-9a-f]{40}$/.test(sha ?? "")) {
  process.stderr.write("사용법: verify-lock.mjs <appRoot> <sha40> [--installed]\n");
  process.exit(2);
}

const problems = [];
const expectedSpec = `github:${REPO}#${sha}`;

/**
 * 파일을 못 읽거나 JSON 이 깨졌으면 **던지지 않고** 「이유」로 적는다.
 * 왜: 이 대조기는 봇의 마지막 관문이라 실패가 Actions 로그로만 남는다. 여기서 그냥 던지면
 * 사람은 node stack 만 보고 무엇을 고쳐야 할지 모른다 — 다른 어긋남과 같은 말투로 적어 준다.
 *
 * ★읽기 **전에** 그 자리가 보통 파일인지 본다(2026-09-08 3차 리뷰 G1): 링크·폴더·장치는 열지 않는다.
 *  이 대조기는 앱 저장소와 산출물의 파일을 읽는데, 둘 다 우리가 만든 것이 아니다.
 *  (`require` 는 이 저장소 어디서도 파일을 읽는 데 쓰지 않는다 — 그러면 `package.json.js` 가 실행된다.)
 */
const kindOf = (v) => (v === null ? "null" : Array.isArray(v) ? "배열" : typeof v);

const readJson = (p, label) => {
  let value;
  try {
    const st = lstatSync(p);
    if (!st.isFile()) throw Object.assign(new Error("보통 파일이 아님(링크·폴더는 읽지 않습니다)"), { code: "ENOTFILE" });
    value = JSON.parse(readFileSync(p, "utf8"));
  } catch (err) {
    const why = err?.code === "ENOENT" ? "파일이 없음" : String(err?.message ?? err).split("\n")[0];
    problems.push(`${label} 를 읽지 못함: ${why}`);
    return null;
  }
  // ★「읽기 성공」과 「값이 쓸 만한가」는 다른 이야기다(2026-09-08 3차 리뷰 G2 · P2).
  //  옛 판은 읽기만 성공하면 그 값을 그대로 돌려줬고, 부르는 쪽은 `if (pkg)` 로 감쌌다.
  //  그래서 파일 내용이 `null`·`false`·`0`·`""` 이면 **검사를 통째로 건너뛰고 조용히 통과**했다
  //  (= 잠금 파일을 `0` 한 글자로 바꿔 오면 대조기가 아무것도 안 보고 OK 를 찍었다).
  //  이제는 최상위가 「배열 아닌 개체」가 아니면 그 자리에서 어긋남으로 적는다.
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    problems.push(`${label} 의 최상위가 개체가 아님: ${kindOf(value)}`);
    return null;
  }
  return value;
};

const pkg = readJson(join(root, "package.json"), "package.json");
if (pkg) {
  const pin = pkg.dependencies?.[NAME];
  if (pin !== expectedSpec) problems.push(`package.json 핀이 다름: ${pin ?? "(없음)"}`);
}

const lock = readJson(join(root, "package-lock.json"), "package-lock.json");
if (lock) {
  const rootSpec = lock.packages?.[""]?.dependencies?.[NAME];
  if (rootSpec !== expectedSpec) problems.push(`package-lock 루트 spec 이 다름: ${rootSpec ?? "(없음)"}`);
  const entry = lock.packages?.[`node_modules/${NAME}`] ?? {};
  if (!String(entry.resolved ?? "").endsWith(`#${sha}`)) problems.push(`package-lock resolved 가 다름: ${entry.resolved ?? "(없음)"}`);
  if (!String(entry.integrity ?? "").startsWith("sha512-")) problems.push(`package-lock integrity 없음/형식 다름: ${entry.integrity ?? "(없음)"}`);
}

if (flags.includes("--installed")) {
  const installedPath = join(root, "node_modules/.package-lock.json");
  if (!existsSync(installedPath)) problems.push("node_modules/.package-lock.json 없음 — 설치가 안 됐다");
  else {
    const inst = readJson(installedPath, "node_modules/.package-lock.json");
    if (inst) {
      const resolved = String(inst.packages?.[`node_modules/${NAME}`]?.resolved ?? "");
      if (!resolved.endsWith(`#${sha}`)) problems.push(`설치 잠금 resolved 가 다름: ${resolved || "(없음)"}`);
    }
  }
}

if (problems.length) {
  process.stderr.write(problems.map((p) => `verify-lock: ${p}`).join("\n") + "\n");
  process.exit(1);
}
process.stdout.write(`verify-lock: OK ${sha}\n`);
