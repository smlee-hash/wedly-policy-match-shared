import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { jobSection as sliceJob, runBlocks } from "./yaml-run-blocks";

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

/** `  <이름>:` 로 시작하는 job 한 덩어리 — 못 찾으면 그 자리에서 빨갛게 */
function jobSection(name: string): string {
  const section = sliceJob(YAML, name);
  expect(section, `job 을 찾지 못했습니다: ${name}`).not.toBe("");
  return section;
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
    // 2차 리뷰 F1·F7: 알림 지점은 **밀기 job 두 곳뿐**이다(실패 알림 · 배포 미확인 알림).
    expect(notifyBlocks).toHaveLength(2);
    const unconfirmed = notifyBlocks.filter((b) => b.includes("배포 확인 못 함"));
    const failures = notifyBlocks.filter((b) => !b.includes("배포 확인 못 함"));
    expect(unconfirmed).toHaveLength(1);
    expect(unconfirmed[0]).not.toContain("|| true");
    expect(failures).toHaveLength(1);
    for (const b of failures) expect(b).toContain("|| true");
  });

  it("알림은 밀기 job 에만 있다 — 앱 코드가 도는 준비 job 은 알림 열쇠를 만지지 않는다", () => {
    // 2차 리뷰 F1(P1): 준비 job 의 실행기는 앱 코드가 이미 한 번 돈 자리다. 거기서 `notify.sh` 를
    // 부르면 **변조된 notify.sh 하나로 WEDLY_NOTIFY_KEY 가 샌다.** 그래서 준비 job 에는
    // 클론 step 의 읽기 토큰 말고 어떤 시크릿도 없어야 한다.
    const prepare = jobSection("prepare");
    expect(prepare).not.toContain("notify.sh");
    expect(prepare.match(/secrets\./g) ?? []).toEqual(["secrets."]); // 딱 하나 = 읽기 토큰
    expect(prepare).toContain("secrets.PROPAGATE_READ_TOKEN");
    expect(jobSection("push")).toContain("notify.sh");
  });

  it("실패 알림 조건은 `failure()` 하나 — 산출물을 못 받은 실패도 알린다", () => {
    // 2차 리뷰 F7: 옛 판은 `failure() && steps.fetch.outcome == 'success'` 라, 준비가 죽어
    // 산출물이 없는 실패는 **아무도 알리지 않았다**(준비 job 의 알림을 F1 이 없앴으므로).
    const push = jobSection("push");
    expect(push).not.toContain("steps.fetch.outcome");
    expect(push).toMatch(/- name: 실패 알림\n\s+if: failure\(\)\n/);
  });

  it("산출물은 실패해도 올린다 — 밀기 job 이 사유를 읽을 수 있어야 한다", () => {
    const prepare = jobSection("prepare");
    expect(prepare).toMatch(/- name: 산출물 올리기[^\n]*\n\s+if: always\(\)\n/);
  });

  it("실패 사유는 파일에서 읽어 인자로 넘긴다 — 워크플로우 보간으로 셸에 붙이지 않는다", () => {
    const reason = BLOCKS.find((b) => b.includes("notify.sh") && b.includes("meta.json"));
    expect(reason, "실패 알림이 meta.json 을 읽지 않습니다").toBeTruthy();
    // 봉인을 푼 자리(F9) — 여기가 어긋나면 사유 없는 알림만 간다
    expect(reason).toContain('"$PROPAGATE_OUT/plain/meta.json"');
    expect(reason).toContain('"$REASON"');
  });

  it("동시성: 자동 반영·손 실제·손 예행이 각각 다른 줄에 선다 — 예행이 진짜 반영을 취소하지 않게", () => {
    // 2차 리뷰 F5: 옛 판은 손 실행을 한 줄(`manual`)에 몰아, **예행 하나가 대기 중인 손 실제 반영을**
    // 밀어냈다. 예행은 아무것도 밀지 않으니 취소돼도 무해하지만, 진짜 반영이 취소되면 앱이 뒤처진다.
    expect(YAML).toContain(
      "group: propagate-${{ github.event_name == 'workflow_dispatch' && (inputs.dry_run && 'dry' || 'manual') || 'main' }}",
    );
    expect(YAML).toContain("cancel-in-progress: false");
  });

  it("밀기 job 은 resolve 가 정한 SHA 와 패키지 이력을 받는다 — 산출물을 그대로 믿지 않는다", () => {
    // 2차 리뷰 F3: 밀기 단계가 「어디서 어디로」를 스스로 확인하려면 이 둘이 있어야 한다.
    const push = jobSection("push");
    expect(push).toContain("PROPAGATE_SHA: ${{ needs.resolve.outputs.sha }}");
    expect(push).toContain("PROPAGATE_PACKAGE_DIR: ${{ github.workspace }}");
    // 후손 검사를 하려면 이력이 있어야 한다(fetch-depth: 1 이면 merge-base 가 늘 실패한다)
    expect(push).toMatch(/uses: actions\/checkout@v4[\s\S]*?fetch-depth: 0/);
  });

  it("남의 복제본에서 온 CI 실행으로는 돌지 않는다", () => {
    expect(jobSection("resolve")).toContain(
      "github.event.workflow_run.head_repository.full_name == github.repository",
    );
  });

  it("끄는 변수는 자동 실행만 막는다 — 손으로 돌리는 것은 꺼져 있어도 된다", () => {
    // 2차 리뷰 F8: 첫 가동 절차가 「끄고 → 밀고 → 예행으로 확인 → 켠다」라, 꺼진 동안 예행까지
    // 막히면 그 절차가 성립하지 않는다. 꺼 둔 동안 사람이 손으로 한 앱을 맞출 수도 있어야 한다.
    const resolve = jobSection("resolve");
    expect(resolve).toContain(
      "(github.event_name == 'workflow_dispatch' || vars.PROPAGATE_ENABLED != 'false')",
    );
    // 옛 판(자동·손 가리지 않고 막던 모양)이 남아 있지 않다
    expect(resolve).not.toMatch(/if: >-\n\s+vars\.PROPAGATE_ENABLED != 'false' &&/);
  });

  it("산출물 봉인: 준비는 공개키(변수), 밀기는 비밀키(시크릿) — 열쇠가 자리를 바꾸지 않는다", () => {
    // 2026-09-08 총괄 결정 F9: 공개 저장소의 artifact 는 누구나 받는다. 준비 job 은 비공개 앱 파일을
    // 공개키로 봉인해 올리고, 밀기 job 만 비밀키로 푼다. 공개키가 시크릿 자리로 가거나(쓸데없이 감춤)
    // 비밀키가 준비 job 으로 가면(앱 코드 옆에 두면) F9 가 무너진다.
    const prepare = jobSection("prepare");
    const push = jobSection("push");
    expect(prepare).toContain("PROPAGATE_ARTIFACT_PUBKEY: ${{ vars.PROPAGATE_ARTIFACT_PUBKEY }}");
    expect(prepare).not.toContain("PROPAGATE_ARTIFACT_PRIVKEY");
    expect(push).toContain("PROPAGATE_ARTIFACT_PRIVKEY: ${{ secrets.PROPAGATE_ARTIFACT_PRIVKEY }}");
    expect(push).not.toContain("PROPAGATE_ARTIFACT_PUBKEY");
    // 준비 job 의 시크릿은 여전히 클론 step 의 읽기 토큰 하나뿐이다(공개키는 `vars.` 라 여기 안 센다)
    expect(prepare.match(/secrets\./g) ?? []).toEqual(["secrets."]);
    // 봉인은 준비가 죽었을 때도 필요하다 — 클론 step 에도 공개키가 있어야 사유가 담긴 산출물이 올라간다
    expect(prepare).toMatch(/- name: 앱 저장소 클론[\s\S]*?PROPAGATE_ARTIFACT_PUBKEY[\s\S]*?- name: 핀 갱신 준비/);
  });

  it("기본 토큰 권한은 읽기뿐이다 — 최신 커밋 승격을 물어보려고 actions 읽기만 더한다", () => {
    // 2차 리뷰 F6: `gh api …/actions/workflows/ci.yml/runs` 를 부르려면 actions: read 가 있어야 한다.
    expect(YAML).toMatch(/^permissions:\n {2}contents: read\n[^\n]*\n {2}actions: read$/m);
    expect(jobSection("resolve")).toContain("GH_TOKEN: ${{ github.token }}");
  });
});
