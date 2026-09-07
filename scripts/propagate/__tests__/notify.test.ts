import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";

/**
 * `scripts/propagate/notify.sh` 시험 — 계획서 Task 4(설계서 §6 D1·D2).
 *
 * ★이 조각이 하는 일: 자동 반영이 실패했을 때 ERP 내부 통로로 슬랙 알림을 부탁한다.
 *  (`POST {ERP주소}/api/internal/policy-lab/notify`, 헤더 `x-internal-key`, 본문 kind=status)
 *
 * ★계획서는 「curl 한 줄이라 단위 시험은 두지 않는다」고 했지만 시험을 뒀다. 이유:
 *  이 조각은 **실패해도 항상 exit 0** 이라, 본문 모양이 어긋나면 ERP 가 400 으로 되돌려도
 *  아무도 모른 채 알림만 영원히 사라진다. ERP 통로는 `.strict()` 스키마라 칸 하나만 틀려도 거절한다
 *  (2026-09-08 실측 — ERP `src/app/api/internal/policy-lab/notify/route.ts`:
 *   `kind` 3가지 · `title` 1~200자 · `lines` 10줄×500자 · `url` 은 http/https 만,
 *   모르는 칸이 하나라도 있으면 400).
 *  그래서 「보냈다고 찍혔나」가 아니라 **실제로 나간 주소·헤더·본문**을 재고, 재시도와 종료 코드도 잰다.
 *
 * ★재는 방식: 진짜 스크립트를 돌리되 `curl` 만 PATH 앞의 shim 으로 바꾼다(네트워크 없음).
 *  shim 은 받은 인자를 그대로 적어 두고, 미리 정해 준 http 코드를 차례대로 돌려준다.
 *  재시도 간격은 `WEDLY_NOTIFY_RETRY_SLEEP=0` 으로 줄인다(기본값 30초는 마지막 시험이 지킨다).
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(HERE, "../notify.sh");

/** 시험에서만 쓰는 가짜 열쇠 — 진짜 열쇠는 이 저장소 어디에도 적지 않는다. */
const FAKE_KEY = "test-key-NEVER-A-REAL-SECRET-9f2a";
const ERP = "https://erp.example.test";

/** 호출 사이 구분자(RS, 0x1e) — curl 인자에는 나올 수 없는 글자 */
const CALL_SEP = "\u001e";

/**
 * 가짜 curl: 인자를 남기고, `FAKE_CURL_CODES`(공백으로 나눈 목록)의 n번째 코드를 돌려준다.
 * `boom` 이면 진짜 curl 이 연결 실패했을 때처럼 stdout 에 `000`, stderr 에 오류, 종료 코드 7.
 */
function fakeCurl(tmp: string) {
  const bin = join(tmp, "bin");
  mkdirSync(bin, { recursive: true });
  const curl = join(bin, "curl");
  writeFileSync(
    curl,
    [
      "#!/usr/bin/env bash",
      "set -u",
      `{ for a in "$@"; do printf '%s\\0' "$a"; done; printf '\\036'; } >> "$FAKE_CURL_ARGS"`,
      `n=$(( $(cat "$FAKE_CURL_COUNT") + 1 ))`,
      `printf '%s' "$n" > "$FAKE_CURL_COUNT"`,
      `code="$(printf '%s\\n' $FAKE_CURL_CODES | sed -n "$n"p)"`,
      `[ -n "$code" ] || code=200`,
      `if [ "$code" = "boom" ]; then`,
      `  printf '000'`,
      `  echo "curl: (7) Failed to connect to host" >&2`,
      `  exit 7`,
      `fi`,
      `printf '%s' "$code"`,
      "",
    ].join("\n"),
  );
  chmodSync(curl, 0o755);
  return bin;
}

interface RunOpts {
  args: string[];
  env?: Record<string, string>;
  /** 차례대로 돌려줄 http 코드. `boom` = 연결 실패 */
  codes?: string[];
}

function runNotify(tmp: string, opts: RunOpts) {
  const stamp = Math.random().toString(36).slice(2);
  const argsFile = join(tmp, `curl-args-${stamp}.bin`);
  const countFile = join(tmp, `curl-count-${stamp}.txt`);
  writeFileSync(argsFile, "");
  writeFileSync(countFile, "0");
  const r = spawnSync("bash", [SCRIPT, ...opts.args], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${fakeCurl(tmp)}:${process.env.PATH}`,
      FAKE_CURL_ARGS: argsFile,
      FAKE_CURL_COUNT: countFile,
      FAKE_CURL_CODES: (opts.codes ?? ["200"]).join(" "),
      WEDLY_NOTIFY_URL: ERP,
      WEDLY_NOTIFY_KEY: FAKE_KEY,
      WEDLY_NOTIFY_RETRY_SLEEP: "0",
      ...opts.env,
    },
  });
  // 호출별 인자 목록으로 되돌린다
  const calls = readFileSync(argsFile, "utf8")
    .split(CALL_SEP)
    .filter((chunk) => chunk.length > 0)
    .map((chunk) => chunk.split("\0").filter((a) => a.length > 0));
  return { code: r.status, stdout: r.stdout, stderr: r.stderr, calls };
}

/** curl 인자에서 `--data` 다음 값을 꺼낸다 */
function bodyOf(call: string[]) {
  const i = call.indexOf("--data");
  expect(i, `--data 인자가 없습니다: ${call.join(" ")}`).toBeGreaterThanOrEqual(0);
  return JSON.parse(call[i + 1]) as Record<string, unknown>;
}

/** curl 인자에서 `-H` 로 넘긴 헤더를 전부 꺼낸다 */
function headersOf(call: string[]) {
  return call.filter((a, i) => i > 0 && call[i - 1] === "-H");
}

describe("notify.sh", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "notify-"));
  });

  it("실행할 수 있는 파일로 있다", () => {
    expect(existsSync(SCRIPT)).toBe(true);
  });

  it("설정(WEDLY_NOTIFY_URL/KEY)이 없으면 부르지 않고 0 으로 끝난다", () => {
    const 빠진경우: Record<string, string>[] = [
      { WEDLY_NOTIFY_URL: "" },
      { WEDLY_NOTIFY_KEY: "" },
      { WEDLY_NOTIFY_URL: "", WEDLY_NOTIFY_KEY: "" },
    ];
    for (const missing of 빠진경우) {
      const r = runNotify(tmp, { args: ["제목", "https://example.test/run/1", "줄1"], env: missing });
      expect(r.code).toBe(0);
      expect(r.stdout).toContain("설정 없음");
      expect(r.calls).toHaveLength(0);
    }
  });

  it("ERP 내부 통로 주소·헤더·본문 규격대로 한 번 보낸다", () => {
    const r = runNotify(tmp, {
      args: [
        "정책매칭 공용 자동 반영 실패: erp",
        "https://example.test/run/1",
        "패키지 SHA abc",
        "손으로 핀을 맞추세요",
      ],
    });
    expect(r.code, r.stderr).toBe(0);
    expect(r.calls).toHaveLength(1);
    const call = r.calls[0];
    expect(call).toContain(`${ERP}/api/internal/policy-lab/notify`);
    expect(call).toContain("POST");
    expect(headersOf(call)).toEqual(["content-type: application/json", `x-internal-key: ${FAKE_KEY}`]);
    expect(bodyOf(call)).toEqual({
      kind: "status",
      title: "정책매칭 공용 자동 반영 실패: erp",
      lines: ["패키지 SHA abc", "손으로 핀을 맞추세요"],
      url: "https://example.test/run/1",
    });
    expect(r.stdout).toMatch(/보냈습니다/);
  });

  it("ERP 주소 끝의 `/` 를 겹치지 않게 다듬는다", () => {
    const r = runNotify(tmp, {
      args: ["제목", "https://example.test/run/1"],
      env: { WEDLY_NOTIFY_URL: `${ERP}/` },
    });
    expect(r.calls[0]).toContain(`${ERP}/api/internal/policy-lab/notify`);
  });

  it("http/https 가 아닌 주소는 본문에 넣지 않는다 — ERP 가 거절하는 칸이다", () => {
    const r = runNotify(tmp, { args: ["제목", "javascript:alert(1)", "줄1"] });
    expect(r.code).toBe(0);
    const body = bodyOf(r.calls[0]);
    expect(body).not.toHaveProperty("url");
    expect(body.lines).toEqual(["줄1"]);
  });

  it("제목 200자·줄 10개·줄당 500자로 잘라 보낸다 — ERP 스키마 상한", () => {
    const lines = Array.from({ length: 14 }, (_, i) => `${i}`.padEnd(600, "x"));
    const r = runNotify(tmp, { args: ["가".repeat(300), "https://example.test/run/1", ...lines] });
    const body = bodyOf(r.calls[0]) as { title: string; lines: string[] };
    expect(body.title).toHaveLength(200);
    expect(body.lines).toHaveLength(10);
    expect(body.lines.every((l) => l.length === 500)).toBe(true);
  });

  it("제목이 비면 기본 제목을 넣는다 — 빈 제목은 ERP 가 400 으로 거절한다", () => {
    const r = runNotify(tmp, { args: ["", "https://example.test/run/1", "줄1"] });
    const body = bodyOf(r.calls[0]) as { title: string };
    expect(body.title.length).toBeGreaterThan(0);
  });

  it("줄 없이 제목·주소만 줘도 보낸다(줄은 빈 배열)", () => {
    const r = runNotify(tmp, { args: ["제목만", "https://example.test/run/1"] });
    expect(r.code, r.stderr).toBe(0);
    expect(bodyOf(r.calls[0])).toEqual({
      kind: "status",
      title: "제목만",
      lines: [],
      url: "https://example.test/run/1",
    });
  });

  it("제목 하나만 줘도 그 제목이 줄로 되풀이되지 않는다", () => {
    // `shift 2` 는 인자가 모자라면 실패하면서 인자를 **그대로 남긴다**(bash 3.2 실측).
    // 계획서 초안(`shift 2 || true`)을 그대로 쓰면 제목이 lines 에 한 번 더 들어간다.
    const r = runNotify(tmp, { args: ["제목 하나뿐"] });
    expect(r.code, r.stderr).toBe(0);
    expect(bodyOf(r.calls[0])).toEqual({ kind: "status", title: "제목 하나뿐", lines: [] });
  });

  it("실패하면 3회까지 다시 보내고, 도중에 200 이 오면 거기서 멈춘다", () => {
    const r = runNotify(tmp, { args: ["제목", "https://example.test/run/1"], codes: ["503", "200", "200"] });
    expect(r.code).toBe(0);
    expect(r.calls).toHaveLength(2);
    expect(r.stdout).toContain("http=503");
    expect(r.stdout).toMatch(/보냈습니다/);
  });

  it("3회 모두 실패해도 0 으로 끝난다 — 알림 실패로 봇을 다시 빨갛게 만들지 않는다", () => {
    const r = runNotify(tmp, { args: ["제목", "https://example.test/run/1"], codes: ["401", "401", "401"] });
    expect(r.code).toBe(0);
    expect(r.calls).toHaveLength(3);
    expect(r.stdout).toContain("http=401");
    expect(r.stdout).toMatch(/3회/);
  });

  it("연결 자체가 안 돼도(curl 종료 코드 7) 3회 시도하고 0 으로 끝난다", () => {
    const r = runNotify(tmp, { args: ["제목", "https://example.test/run/1"], codes: ["boom", "boom", "boom"] });
    expect(r.code).toBe(0);
    expect(r.calls).toHaveLength(3);
    expect(r.stdout).toContain("http=000");
  });

  it("내부 열쇠를 화면(stdout·stderr)에 찍지 않는다", () => {
    const r = runNotify(tmp, { args: ["제목", "https://example.test/run/1"], codes: ["401", "401", "401"] });
    // ★먼저 「진짜로 열쇠를 쥐고 돌았다」를 확인한다 — 스크립트가 없어서 아무것도 안 한 것도
    //  「열쇠가 안 찍혔다」는 통과하기 때문이다(Task 2 에서 겪은 거짓 통과).
    expect(r.code, r.stderr).toBe(0);
    expect(r.calls).toHaveLength(3);
    expect(r.calls[0].join(" ")).toContain(FAKE_KEY);
    expect(r.stdout).not.toContain(FAKE_KEY);
    expect(r.stderr).not.toContain(FAKE_KEY);
  });

  it("재시도 간격 기본값은 30초다(시험만 0 으로 줄인다)", () => {
    expect(readFileSync(SCRIPT, "utf8")).toMatch(/WEDLY_NOTIFY_RETRY_SLEEP:-30/);
  });
});
