# P5 자동 반영 봇 구현 계획 (정책매칭 랩 프로그램 · 설계서 §6 D1·D2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (when independent ownership is available) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 패키지(`@wedly/policy-match-shared`) `main` 에 커밋이 올라가 CI 가 통과하면, 앱 3곳(ERP·일루아·랩)의 핀을 봇이 **동시에** 새 SHA 로 올려 커밋·푸시하고 Railway 가 자동 배포하게 한다. 사람이 손으로 핀을 맞추는 일(P3·P4 에서 회당 30~60분)을 없앤다.

**Architecture:** 패키지 저장소의 GitHub Actions `propagate.yml` 이 `CI` 워크플로우 성공(`workflow_run`, main) 뒤에 앱 3곳을 matrix 로 병렬 처리한다. 실제 일은 `scripts/propagate/propagate.sh`(bash) 가 하고, 잠금 파일 대조는 `scripts/propagate/verify-lock.mjs`(node) 가 한다. 앱별 차이(ERP 만 설치+설계 등록부 재생성)는 `scripts/propagate/apps.json` 이 정한다. 실패는 ERP 내부 알림 통로(`POST /api/internal/policy-lab/notify`, kind `status`)로 슬랙에 남긴다. 끄는 스위치는 저장소 변수 `PROPAGATE_ENABLED=false`, 예행연습은 `workflow_dispatch` 의 `dry_run`.

**Tech Stack:** GitHub Actions(ubuntu-latest, node 22), bash, node ESM 스크립트, npm(`npm pkg set`·`npm install --package-lock-only`·`npm ci --ignore-scripts`), 세밀 권한 PAT(`contents: write`, 앱 3저장소), vitest(패키지 CI 가 돌리는 시험으로 bash 스크립트를 가짜 저장소에서 검증).

---

## 0. 확정 사실(2026-09-07~08 실측) 과 총괄 결정

| # | 사실 | 출처 |
|---|---|---|
| F1 | 앱 3곳 `package.json` 핀은 `github:smlee-hash/wedly-policy-match-shared#<sha40>`, 잠금 파일은 `packages["node_modules/@wedly/policy-match-shared"].resolved = "git+ssh://git@github.com/smlee-hash/wedly-policy-match-shared.git#<sha40>"` + `integrity`(sha512). 3앱 모두 lockfileVersion 3 | 3앱 package-lock 대조 |
| F2 | Railway 3서비스에 GIT_CONFIG(ssh→https) 변수가 **없다**. 그런데도 `npm ci` 가 되는 이유는 npm(pacote)이 전체 SHA 핀의 GitHub 저장소는 https tarball(codeload)로 받기 때문 | ERP 변수 13개 조회 |
| F3 | ERP 설계 등록부 `scripts/design-system/registry.mjs` 306~328줄은 package.json 핀·package-lock ref·**`node_modules/.package-lock.json` 의 설치 ref** 셋이 같아야 하고, 364~372줄은 설치된 패키지 파일을 읽어 해시한다. ERP `build` 첫 단계가 `design:check` 라 등록부가 낡으면 Railway 빌드가 실패한다 | registry.mjs·package.json |
| F4 | 일루아·랩에는 설계 등록부가 없다. 잠금 파일만 갱신하면 된다 | 두 앱 scripts 조회 |
| F5 | 패키지 CI(`.github/workflows/ci.yml`, 이름 `CI`)는 push·pull_request 에 node 22 → `npm ci \|\| npm install` → typecheck → test. Actions 켜짐, 기본 워크플로우 토큰 권한 read, 시크릿·변수 **없음** | gh api |
| F6 | 앱 3저장소는 private·브랜치 보호 없음(무료 요금제라 설정 불가). 패키지 저장소는 public | gh api |
| F7 | ERP 는 `overrides`(xlsx cdn tgz·sharp·esbuild) 와 `sharp`·`puppeteer-core`·`prisma` 를 쓴다. `npm ci --ignore-scripts` 면 prisma generate·puppeteer 내려받기 없이 창고만 깐다. 패키지 자체는 빌드 단계가 없다(main=src/index.ts) | ERP package.json |
| F8 | ERP 내부 알림 통로는 `x-internal-key`(POLICY_LAB_INTERNAL_KEY) 상수시간 대조, 본문 `{kind:"feedback"\|"source-report"\|"status", title≤200, lines≤10×500, url?}` `.strict()`, 16KB 상한, 슬랙 이스케이프. 방은 서버 변수가 정한다(지금은 #wedly-업무요청방, #정책매칭 생기면 ERP 변수로 옮김) | notify/route.ts |
| F9 | 패키지 로컬 main(e7d0ed8)은 origin/main(b404b4b)보다 낡았다. 이 계획의 작업 사본은 origin/main 에서 딴 `/Users/00.logico.l/orca/wt/pkg-p5`(가지 `pipe/p5-propagate`) | git |

**총괄 결정**
1. **트리거는 `workflow_run`(CI 성공, main)** 이다. ci.yml 안에 job 을 붙이지 않는다 — CI 는 모든 가지에서 돌고, 반영은 main 에서만 돌아야 하며, 시크릿은 기본 브랜치 문맥에서만 안전하게 읽힌다.
2. **핀 갱신은 앱별로 다르다**: 일루아·랩 = `npm pkg set` + `npm install --package-lock-only`; ERP = 그 뒤 `npm ci --ignore-scripts` + `node scripts/design-system/cli.mjs generate` + **`npm run design:check`**(자기 검증 — Railway 빌드 첫 단계와 **같은 명령**. 2026-09-08 총괄 결정: 초안은 `cli.mjs check` 만 불렀는데 ERP `design:check` 는 `debt.mjs check` 까지 돌리므로 봇도 똑같이 돌려 「봇 초록·Railway 빨강」을 없앤다). 커밋 대상은 `package.json`·`package-lock.json`(+ERP `src/lib/design-system/registry.generated.json`) 뿐이다. 그 외 파일이 바뀌면 실패(무엇이 바뀌었는지 출력).
   - 같은 날 결정: `resolve` 단계가 실패하면(main 에 없는 SHA·형식 오류) 슬랙 알림은 가지 않고 GitHub 실패 메일만 남는다 — 사람이 dispatch 를 잘못 부른 경우뿐이라 그대로 둔다.
3. **순서 보호**: 새 SHA 가 현재 핀의 **후손이 아니면**(이미 더 새 핀이거나 갈래가 다르면) 그 앱은 「건너뜀」으로 끝낸다(실패 아님). 같은 SHA 면 「이미 반영」으로 건너뛴다. 이러면 workflow_run 이 순서를 어겨 와도 핀이 뒤로 가지 않는다.
4. **푸시 경합**: `git push` 거부 시 `git fetch` + `git rebase origin/main` 뒤 재시도, 최대 3회. rebase 충돌(사람이 같은 순간 핀을 손으로 바꾼 경우)은 즉시 실패.
5. **실패 알림**은 F8 통로 재사용. 패키지 저장소 시크릿 `WEDLY_NOTIFY_KEY`(=ERP POLICY_LAB_INTERNAL_KEY 값)·변수 `WEDLY_NOTIFY_URL`(ERP 주소). 알림 자체가 실패해도 워크플로우는 이미 빨간색이고 GitHub 가 실패 메일을 보낸다 — 알림 실패로 되풀이 실패를 만들지 않는다.
6. **배포 감시는 P5 범위에 넣되 뒤 단계(Task 7)** 로 둔다. **Railway 토큰은 쓰지 않는다**(2026-09-08 실측: 프로젝트 토큰은 그 환경의 **모든 변수**(운영 DB 주소·AI 열쇠 포함)를 읽을 수 있어 공개 저장소 시크릿에 두기엔 폭이 너무 넓고, CLI 계정 토큰으로는 `projectTokenCreate` 가 Not Authorized). 대신 앱 3곳이 모두 공개로 내놓는 `GET /api/build-id`(`{commitSha}`, 실측 3곳 모두 응답)를 30초마다 물어 **봇 커밋 SHA 가 나타나면 성공**, 30분 안에 안 나타나면 「배포 확인 못 함 — 빌드 실패 또는 지연」으로 같은 통로에 알린다(실패와 지연을 구분하진 못하지만 비밀값이 하나도 필요 없다).
7. **커밋 저자**: `WEDLY 정책매칭 봇 <policy-bot@wedly.kr>`. 제목 `chore(정책매칭 공용): 핀 <sha7> — <패키지 커밋 제목>`, 본문에 패키지 커밋 주소와 실행 주소.
8. **PAT**: 세밀 권한, 소유자 smlee-hash, 저장소 wedly-erp·wedly-illua-collab·wedly-policy-lab, 권한 Contents: Read and write(Metadata 자동), 만료 1년, 이름 `wedly-policy-propagate-bot`. Aside 로 발급([[github-token-rotation-via-aside]] 절차), 값은 `~/.agent-browser/propagate-pat.key`(600) 와 패키지 저장소 시크릿 `PROPAGATE_TOKEN` 에만 둔다. 채팅·문서·커밋에 값을 적지 않는다.
9. **첫 가동 순서**: 변수 `PROPAGATE_ENABLED=false` 를 **워크플로우 파일을 밀기 전에** 건다 → 밀기(CI 만 돈다) → `workflow_dispatch dry_run=true` 로 예행 → 로그 확인 → 변수 `true` → 문서 1줄 커밋으로 실제 3앱 반영 → Railway 3곳 SUCCESS 확인 = 인수 기준.
10. **하지 않는 것**: 하이브(설계 §6 D3), ERP 팝업 알림(봇 커밋은 사용자 화면 변경이 아니다), 카나리, 앱 저장소에 워크플로우 추가(PAT 에 workflow 권한을 주지 않는다).
11. **2026-09-08 독립 리뷰(Astra) 반영 — 아래 5건은 판정대로 구현했다. 초안 코드(Task 3·5)보다 실제 코드가 앞선다.**
    - **R1(P1)** 봇 시험을 `src/propagate/` → **`scripts/propagate/__tests__/`** 로 옮긴다. `package.json` 의 `files:["src",…]` 라 `src/**` 는 앱 3곳의 `node_modules` 로 들어가고, ERP `vitest.shared.config.ts`·일루아/랩 `vitest.shared-pkg.config.ts` 가 그 시험을 **배포 관문에서 돌린다**(실측) — 앱 쪽엔 `scripts/propagate/*` 가 없어 3앱 배포가 막힌다. vitest·tsconfig include 에 `scripts/**` 를 더하고, 회귀는 진짜 `npm pack --dry-run --json` 으로 잰다(`pack-excludes.test.ts`).
      · 「포장에 `*.test.*` 가 하나도 없어야 한다」는 문구는 **`scripts/`·`__tests__`·봇 시험 이름 0건**으로 좁혔다. `src/**/*.test.ts` 200여 개는 위 세 앱의 공용 꾸러미 관문이 **일부러 돌리는** 시험이라 빼면 관문이 조용히 비어 버린다(그 반대까지 같은 시험이 잰다).
    - **R2(P1)** `env -u` 로는 PAT 격리가 안 된다(같은 사용자의 부모 환경 읽기·askpass/`.git/config` 바꿔치기). **job 2단계 분리**: `prepare`(클론은 **읽기 전용 PAT `PROPAGATE_READ_TOKEN`**, 그 뒤 토큰 없는 자리에서 npm·후처리 → 산출물 artifact) → `push`(쓰기 PAT 로 새로 클론해 산출물만 얹어 커밋·푸시, npm 0회). 스크립트는 `propagate.sh <clone|prepare|push>` + 공용 `lib.sh`. `result` 에 `prepared` 추가. `resolve` 의 `if` 에 `head_repository.full_name == github.repository` 를 겹으로 더한다.
    - **R3(P2)** 동시성 그룹을 `propagate-${{ github.event_name == 'workflow_dispatch' && 'manual' || 'main' }}` 로 나눈다 — 예행이 **대기 중인 진짜 반영을 취소**하던 문제. 같은 그룹의 대기 실행은 최신 하나만 남지만 main 은 직선이라 결과가 같다.
    - **R4(P2)** `notify.sh` 종료 코드: 보냈으면 0, **설정 없음·3회 실패·본문 실패면 1**(총괄 결정 5 갱신 — 「알림은 실패를 알린다, 무시할지는 부르는 쪽이 정한다」). 워크플로우의 실패 알림만 `|| true`, 「배포 미확인 알림」은 그대로 둬 알림까지 실패하면 job 이 빨개진다.
    - **R5(P3)** `watch-deploy`: 요청별 제한을 `min(15초, 남은 시간)` 으로, 응답을 받아도 `Date.now() <= deadline` 일 때만 성공으로 센다.
12. **2026-09-08 2차 독립 리뷰(Astra) 반영 — 아래 8건도 판정대로 구현했다. 실제 코드가 이 문서의 초안보다 앞선다.**

    **위협 모델(이 회차에 확정)**: `prepare` job 에서 도는 앱 코드·의존성은 **믿을 수 없다**(실행기의 파일도 산출물도 마음대로 바꾼다). `push` job 은 산출물(artifact)을 **믿을 수 없는 입력**으로 다루고 `resolve` 의 결정(SHA)만 믿으며, 그 job 에서는 앱 코드가 한 줄도 돌지 않는다.

    | # | 무엇이 문제였나 | 어떻게 닫았나 |
    |---|---|---|
    | **F1(P1)** | `prepare` 의 「실패 알림」이 **앱 코드가 이미 돈 실행기**에서 `WEDLY_NOTIFY_KEY` 를 썼다 — 변조된 `notify.sh` 하나로 열쇠가 샌다 | 준비 job 에서 알림을 **없앴다**(시크릿은 클론 step 의 읽기 토큰 하나뿐). 대신 clone·prepare 가 **어떤 실패에서도** `meta.json{result:"failed", error:"한 줄 사유"}` 를 남기고(`lib.sh` 의 EXIT 갈고리), 산출물은 `if: always()` 로 올린다. `push` 는 `failed` 면 그 사유를 찍고 exit 1(그래서 job 이 빨개져 알림이 간다), 산출물이 없으면 exit 2 |
    | **F2(P1)** | 앱 기준 커밋의 `commitPaths` 자리가 **심볼릭 링크**(예 `registry.generated.json → ../../../.git/config`)면 밀기 단계의 `cp` 가 링크를 따라가 클론의 git 설정을 덮었다 | 덮어쓰기 전에 경로의 **모든 칸**을 `[ -L ]` 로 걷고 `git ls-files -s` 의 mode `120000` 도 본다(`core.symlinks=false` 대비). 덮어쓸 때는 `rm -f` 먼저. 밀기 단계의 모든 git 호출에 `GIT_CONFIG_COUNT` 로 `credential.helper=`·`core.hooksPath=/dev/null`·`http.proxy=`·`core.sshCommand=false` 를 눌러 둔다(+기존 `GIT_CONFIG_GLOBAL=/dev/null`·`GIT_CONFIG_NOSYSTEM=1`) |
    | **F3(P1)** | `push` 가 반영할 SHA 를 `resolve` 의 결정과 대조하지 않아, 산출물의 `meta` 와 JSON 을 함께 바꾸면 **아무 커밋으로나** 핀을 옮길 수 있었다 | `push` 가 env `PROPAGATE_SHA`(resolve 출력)·`PROPAGATE_PACKAGE_DIR`(push job 도 `fetch-depth: 0`)를 받아 ① `meta.pinTo == PROPAGATE_SHA` ② 새 클론의 `baseSha` 시점 실제 핀 == `meta.pinFrom` ③ 그 핀이 `PROPAGATE_SHA` 의 조상(패키지 저장소에서 `merge-base`)을 직접 본다. `verify-lock`·커밋 제목도 `PROPAGATE_SHA` 기준 |
    | **F4(P1)** | **허용된 파일 안의 임의 변경**이 통과했다(`package.json` 에 `postinstall`, 잠금 파일 `resolved` 를 남의 tgz 로, 모르는 꾸러미 항목 끼우기) | 새 대조기 `verify-artifact.mjs <baseDir> <artifactDir> <sha40> <commitPath...>` — ① `package.json` 은 「기준 + 핀 한 칸」과 **깊은 비교로 동일** ② `package-lock.json` 은 `packages[""].dependencies[이름]`·`packages["node_modules/이름"]` **두 자리만** 바뀐 것과 동일하고, 그 항목의 `resolved` 는 우리 저장소의 그 커밋(`git+ssh\|https` 둘 다 허용)·`integrity` 는 `sha512-` ③ 등록부는 JSON 이고 5MB 이하 ④ 목록 밖 파일·규칙 없는 파일 거부. `push` 가 `verify-lock` 뒤에 반드시 부른다. **공용 보관함이 나중에 런타임 의존을 더하면 잠금 파일에 새 항목이 생겨 봇이 안전하게 실패한다** — 그때는 사람이 손으로 올린다(README §5) |
    | **F5(P2)** | 손으로 돌린 **예행이 대기 중인 손 실제 반영을 취소**했다 | 동시성 줄을 셋으로 — `propagate-main`(자동)·`propagate-manual`(손 실제)·`propagate-dry`(손 예행) |
    | **F6(P2)** | 늦게 끝난 **옛 CI** 가 최신 커밋의 대기 실행을 밀어내, 최신 핀이 아무도 반영하지 않은 채 남았다 | `resolve` 의 `workflow_run` 갈래가 `origin/main` 끝(TIP)도 CI 를 통과했는지 `gh api …/actions/workflows/ci.yml/runs?head_sha=<TIP>&status=success` 로 묻고, 있으면 그쪽으로 올린다(없거나 물어보다 실패하면 원래 커밋 그대로 — 막지 않는다). 권한에 `actions: read` 추가 |
    | **F7(P2)** | 준비가 죽어 산출물이 없는 실패는 **아무도 알리지 않았다**(밀기 알림에 `steps.fetch.outcome == 'success'` 조건이 있었다) | F1 로 닫혔다 — 밀기 job 의 `if: failure()` 하나가 유일한 알림 지점이고, 사유는 `meta.error` 를 **파일에서 읽어 인자로** 넘긴다 |
    | **F8(P2)** | `PROPAGATE_ENABLED=false` 가 dispatch 예행까지 막아 **첫 가동 절차가 성립하지 않았다** | 그 변수는 **자동 실행만** 막고 손 실행은 허용한다(`resolve` 의 `if`). README·워크플로우 머리주석·아래 Task 6 절차에 그렇게 적었다 |

    **★F4 를 진짜 npm 으로 돌려 본 결과(2026-09-08 로컬 예행 · 첫 가동 전에 처리할 것)**
    - 정상 경로는 통과한다: 랩 저장소 사본에서 핀 `ff93e45` → `b404b4b` 를 **진짜 `npm install --package-lock-only`** 로 올리자 잠금 파일이 딱 3줄(루트 spec·`resolved`·`integrity`)만 바뀌었고 `verify-artifact: OK` 로 끝났다(dry-run, 원격 불변).
    - 그런데 **랩 저장소의 지금 잠금 파일은 npm 10.9.8 로 다시 계산하면 6개 항목이 늘어난다** — `node_modules/@tailwindcss/oxide-wasm32-wasi/node_modules/*`(묶음·선택 의존). **핀을 하나도 안 바꾸고 `npm install --package-lock-only` 만 돌려도 똑같이 늘어난다**(= 우리 핀 갱신 탓이 아니라 그 저장소의 잠금 파일이 npm 판과 어긋나 있는 것). 같은 검사에서 **ERP·일루아는 0건**이다.
    - 그대로 두면 랩 앱만 매번 「모르는 꾸러미 항목」으로 안전 실패한다. **첫 실제 반영 전에 랩 저장소에서 `npm install --package-lock-only` 결과를 사람이 한 번 커밋**해 두면 된다(이 작업 사본의 권한 밖이라 총괄에게 넘긴다). 옛 판이었다면 봇이 그 6개 항목을 **아무 말 없이 앱에 밀어 넣었을 것**이다 — 이 대조기가 그걸 드러낸 셈이다.

    시험도 함께 늘렸다: 밀기 단계만 따로 재려고 **산출물을 손으로 짓는** 시험(`writeArtifact`), `verify-artifact` 단위 시험 12건, `resolve` 셸 토막을 잘라 **가짜 `gh` 로 실제 실행**하는 시험 6건(`resolve-shell.test.ts`), 워크플로우 모양 시험 갱신.

13. **2026-09-08 3차 독립 리뷰(Astra) 3건 + 총괄 지적 F9 — 전부 채택해 그대로 구현했다.**

    | # | 무엇이 문제였나 | 어떻게 닫았나 |
    |---|---|---|
    | **G1(P1)** | 밀기 단계가 앱의 핀을 `node -p "require('./package.json')…"` 로 읽었다. node 의 `require` 는 그 이름의 파일이 없으면 **확장자를 붙여 가며 찾고 찾으면 실행한다** — 기준 커밋에 `package.json` 없이 `package.json.js` 만 있으면 **쓰기 토큰을 쥔 자리에서 앱 코드가 돈다**(2026-09-08 실측 재현) | 파일을 읽는 모든 node 호출(`lib.sh`·`propagate.sh`·`verify-lock`·`verify-artifact`·워크플로우의 apps.json)에서 `require(경로)` 를 없애고 「**읽기 전에** lstat 으로 보통 파일 확인 → readFileSync → JSON.parse」로 통일했다. 남은 `require` 는 node 내장(`node:fs`)뿐이다(`git grep -n "require(" scripts/propagate` 로 확인). 회귀 시험은 **카나리아**로 잰다 — 실행되면 표식 파일을 만드는 `package.json.js` 를 심은 앱으로 push → exit 1 이고 **표식이 안 생긴다**(옛 코드로 되돌리면 표식이 생겨 빨개진다) |
    | **G2(P2)** | 두 대조기가 「읽기 성공」과 「값」을 한 덩어리로 봐서, 파일 내용이 `null`·`false`·`0`·`""` 이면 `if (!got)`·`if (pkg)` 가 **검사를 통째로 건너뛰고** 통과했다(잠금 파일을 `0` 한 글자로 바꿔 오면 아무것도 안 보고 OK) | 읽기와 값을 나누고, 최상위가 **배열 아닌 개체**가 아니면 그 자리에서 어긋남으로 적는다. 시험은 두 대조기 × 네 값 × 파일별 + 밀기 통합 1건(원격 불변) |
    | **G3(P2)** | 늦게 온 반영을 올릴 때 **끝 커밋(TIP) 하나만** CI 통과를 물어봐서, TIP 의 CI 가 아직 안 끝났거나 빨가면 그 사이의 **통과한 중간 커밋(B)** 을 아무도 반영하지 않았다 | `resolve` 가 `SHA..TIP` 을 `git rev-list --first-parent -n 30` 으로 **최신부터 훑어** CI 성공 기록이 있는 첫 커밋을 고른다(호출 실패·0건은 다음 커밋으로, 30개를 넘거나 끝까지 못 찾으면 원래 커밋 그대로 — 승격은 막지 않는다). 셸 토막을 잘라 **가짜 `gh` 로 실제 실행**하는 시험 3건(중간 커밋 승격 · 전부 실패면 그대로 · 30개 상한 너머는 묻지 않음) |
    | **F9(총괄)** | 이 저장소는 **공개**라 Actions 산출물을 누구나 내려받는데, 그 안에 비공개 앱 3곳의 `package.json`·잠금 파일·설계 등록부가 **평문으로** 들어 있었다 | 산출물을 **봉인**한다(아래 규격). 올라가는 것은 `bundle.enc`·`key.enc` 둘뿐이고 평문·`meta.json` 은 봉인 안에 있다 |

    **F9 봉인 규격**
    - 준비: 평문 폴더를 `tar czf` → 1회용 열쇠(`openssl rand -hex 32`)로 `openssl enc -aes-256-cbc -pbkdf2` → `bundle.enc`, 그 열쇠를 **저장소 변수** `PROPAGATE_ARTIFACT_PUBKEY`(공개키 PEM · 비밀이 아니다)로 `openssl pkeyutl -encrypt -pubin -pkeyopt rsa_padding_mode:oaep` → `key.enc`.
      · 1회용 열쇠를 **hex 로** 만드는 이유: `-pass file:` 은 파일의 **첫 줄**을 비밀번호로 읽어, 날바이트(`openssl rand 32`)면 줄바꿈·NUL 에서 열쇠가 조용히 잘린다.
      · **공개키 변수가 비어 있으면 준비는 아무것도 올리지 않고 실패한다**(평문 업로드 금지). 실패 사유 `meta.json` 도 같은 봉인을 거치고, 봉인이 안 되면 올리지 않는다 → 밀기가 「산출물 없음」 exit 2 로 알린다.
    - 밀기: **시크릿** `PROPAGATE_ARTIFACT_PRIVKEY`(비밀키 PEM)를 600 임시 파일로 써서 풀고(EXIT 갈고리가 지운다) `<산출물>/plain` 에 편다. 비밀키가 없거나 짝이 아니면 exit 1. 푼 꾸러미에 심볼릭 링크가 있어도 exit 1.
    - 워크플로우: 준비 job 의 **클론·준비 두 step** 에 `vars.PROPAGATE_ARTIFACT_PUBKEY`(클론이 죽었을 때의 사유도 봉인해야 올라간다), 밀기 step 에 `secrets.PROPAGATE_ARTIFACT_PRIVKEY`. 준비 job 의 **시크릿은 여전히 클론 step 하나뿐**이다(공개키는 `vars.` 라 시크릿이 아니다).
    - **봉인은 「엿보기」만 막고 위조는 못 막는다**(공개키는 누구나 안다) — 그래서 밀기 단계는 봉인을 푼 **뒤에도** 산출물을 믿을 수 없는 입력으로 다룬다(2차 리뷰 F3·F4 의 대조가 그대로 산다).
    - **로그 점검(같은 회차)**: 두 대조기가 어긋난 값을 그대로 찍던 자리를 **이름·건수**로 바꿨다. Actions 로그도 공개라 (a) 비공개 앱의 꾸러미 목록이 새고 (b) 준비 단계에서 도는 앱 코드가 **오류문에 앱의 비밀을 실어** 공개 로그로 내보낼 수 있었다. `git show --stat`(파일 이름·줄 수만)은 그대로 둔다.
    - 열쇠 두 개는 **저장소 변수/시크릿**으로만 관리한다(값·보관 위치는 문서·커밋·채팅에 적지 않는다). 첫 가동 전에 사람이 키쌍을 만들어 공개키를 변수에, 비밀키를 시크릿에 넣는다 — 아래 Task 6 순서에 넣었다.

    시험도 함께 늘렸다: 봉인 왕복(준비→밀기)·평문 0건(올린 두 파일의 **바이트를 뒤져** 확인)·다른 비밀키·비밀키 없음·공개키 없음(업로드 폴더 비어 있음)·실패 사유 봉인 왕복·꾸러미 속 링크 거부.

## 1. 파일 구조

```
.github/workflows/propagate.yml            — 트리거·matrix·시크릿 주입·실패 알림 호출(얇게). 리뷰 뒤 prepare/push 두 job
scripts/propagate/apps.json                — 앱 3곳 정의(저장소·설치 여부·후처리 명령·커밋 대상 파일·build-id 주소)
scripts/propagate/lib.sh                   — (리뷰 R2) 세 단계가 함께 쓰는 조각(클론·가리개·apps.json 읽기·자격 잔류 검사)
scripts/propagate/propagate.sh             — clone|prepare|push 세 단계. 환경변수로만 입력
scripts/propagate/verify-lock.mjs          — package.json·package-lock 이 새 SHA 로 일치하는지 대조(exit 0/1)
scripts/propagate/verify-artifact.mjs      — (2차 리뷰 F4) 산출물이 「기준 파일 + 핀 한 줄」인지 깊은 비교로 대조
scripts/propagate/notify.sh                — ERP 내부 통로로 알림(curl). 보냈으면 0, 못 보냈으면 1(리뷰 R4)
scripts/propagate/watch-deploy.mjs         — (Task 7) 앱 공개 build-id 가 봇 커밋 SHA 로 바뀔 때까지 대기(비밀값 불필요)
scripts/propagate/__tests__/*.test.ts      — 봇 시험 9벌(propagate·verify-lock·verify-artifact·apps-json·notify·watch-deploy·workflow·workflow-shell·pack-excludes)
scripts/propagate/__tests__/yaml-run-blocks.ts — 워크플로우의 `run:` 토막·job 덩어리를 잘라 내는 조각(시험 두 벌이 함께 쓴다)
docs/superpowers/plans/2026-09-07-p5-propagate-bot.md — 이 문서
README.md                                  — 「자동 반영」 절 추가(끄는 법·예행·되돌리기)
```

★시험이 `src/` 가 아니라 **`scripts/propagate/__tests__/`** 에 있는 이유(리뷰 R1): `package.json` 의 `files` 가 `src` 를 통째로 포장해 앱 3곳의 `node_modules` 로 보내고, 세 앱이 그 폴더의 시험을 **배포 관문에서 돌린다**. 봇 시험은 `scripts/propagate/*.sh` 를 실제로 실행하므로 앱 쪽에서는 파일이 없어 죽는다 = 3앱 배포가 막힌다. 그래서 포장에서 빠지는 자리로 옮기고 vitest·tsconfig 의 include 에 `scripts/**` 를 더했다.

## 2. Task 목록

### Task 1: apps.json + 형식 시험

**Files:**
- Create: `scripts/propagate/apps.json`
- Test: `src/propagate/apps-json.test.ts`

- [ ] **Step 1: 실패 시험 작성**

```ts
// src/propagate/apps-json.test.ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const path = resolve(__dirname, "../../scripts/propagate/apps.json");

describe("scripts/propagate/apps.json", () => {
  const apps = JSON.parse(readFileSync(path, "utf8")) as Array<Record<string, unknown>>;

  it("앱 3곳(ERP·일루아·랩)을 정확히 담는다 — 설계서 §6 D1", () => {
    expect(apps.map((a) => a.repo).sort()).toEqual([
      "smlee-hash/wedly-erp",
      "smlee-hash/wedly-illua-collab",
      "smlee-hash/wedly-policy-lab",
    ]);
  });

  it("각 앱은 id·repo·install·postSteps·commitPaths 를 갖는다", () => {
    for (const a of apps) {
      expect(typeof a.id).toBe("string");
      expect(String(a.repo)).toMatch(/^smlee-hash\/[a-z0-9-]+$/);
      expect(typeof a.install).toBe("boolean");
      expect(Array.isArray(a.postSteps)).toBe(true);
      expect(Array.isArray(a.commitPaths)).toBe(true);
      expect(a.commitPaths).toEqual(expect.arrayContaining(["package.json", "package-lock.json"]));
    }
  });

  it("ERP 만 설치+설계 등록부 재생성, 나머지는 잠금 파일만", () => {
    const byId = Object.fromEntries(apps.map((a) => [a.id, a]));
    expect(byId.erp.install).toBe(true);
    expect(byId.erp.postSteps).toEqual([
      "node scripts/design-system/cli.mjs generate",
      "npm run design:check",
    ]);
    expect(byId.erp.commitPaths).toContain("src/lib/design-system/registry.generated.json");
    expect(byId.illua.install).toBe(false);
    expect(byId.illua.postSteps).toEqual([]);
    expect(byId.lab.install).toBe(false);
    expect(byId.lab.postSteps).toEqual([]);
  });
});
```

- [ ] **Step 2: 실패 확인** — `npx vitest run src/propagate/apps-json.test.ts` → FAIL (파일 없음)

- [ ] **Step 3: apps.json 작성**

```json
[
  {
    "id": "erp",
    "repo": "smlee-hash/wedly-erp",
    "install": true,
    "postSteps": [
      "node scripts/design-system/cli.mjs generate",
      "npm run design:check"
    ],
    "commitPaths": ["package.json", "package-lock.json", "src/lib/design-system/registry.generated.json"]
  },
  {
    "id": "illua",
    "repo": "smlee-hash/wedly-illua-collab",
    "install": false,
    "postSteps": [],
    "commitPaths": ["package.json", "package-lock.json"]
  },
  {
    "id": "lab",
    "repo": "smlee-hash/wedly-policy-lab",
    "install": false,
    "postSteps": [],
    "commitPaths": ["package.json", "package-lock.json"]
  }
]
```

- [ ] **Step 4: 통과 확인** — `npx vitest run src/propagate/apps-json.test.ts` → PASS

### Task 2: verify-lock.mjs + 단위 시험

**Files:**
- Create: `scripts/propagate/verify-lock.mjs`
- Test: `src/propagate/verify-lock.test.ts`

동작: 인자 `<appRoot> <sha40>`. `package.json` 의 `dependencies["@wedly/policy-match-shared"]` 가 정확히 `github:smlee-hash/wedly-policy-match-shared#<sha40>` 이고, `package-lock.json` 의 루트 `packages[""].dependencies["@wedly/policy-match-shared"]` 도 같고, `packages["node_modules/@wedly/policy-match-shared"].resolved` 가 `#<sha40>` 로 끝나며 `integrity` 가 `sha512-` 로 시작하면 exit 0. 하나라도 어긋나면 이유를 stderr 에 적고 exit 1. `--installed` 옵션이 있으면 `node_modules/.package-lock.json` 의 같은 항목도 대조한다(ERP).

- [ ] **Step 1: 실패 시험 작성**

```ts
// src/propagate/verify-lock.test.ts
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const SCRIPT = resolve(__dirname, "../../scripts/propagate/verify-lock.mjs");
const SHA = "b404b4b1f44d0ffb8213fff771a0bec090ca6257";
const OTHER = "e7d0ed8fe9428b1c720f2f5675cd29a39e99e9b1";
const SPEC = (sha: string) => `github:smlee-hash/wedly-policy-match-shared#${sha}`;
const RESOLVED = (sha: string) => `git+ssh://git@github.com/smlee-hash/wedly-policy-match-shared.git#${sha}`;

function app(opts: { pkgSha: string; lockRootSha: string; lockResolvedSha: string; integrity?: string; installedSha?: string }) {
  const root = mkdtempSync(join(tmpdir(), "verify-lock-"));
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "x", dependencies: { "@wedly/policy-match-shared": SPEC(opts.pkgSha) } }));
  writeFileSync(join(root, "package-lock.json"), JSON.stringify({
    lockfileVersion: 3,
    packages: {
      "": { dependencies: { "@wedly/policy-match-shared": SPEC(opts.lockRootSha) } },
      "node_modules/@wedly/policy-match-shared": { resolved: RESOLVED(opts.lockResolvedSha), integrity: opts.integrity ?? "sha512-abc" },
    },
  }));
  if (opts.installedSha) {
    mkdirSync(join(root, "node_modules"), { recursive: true });
    writeFileSync(join(root, "node_modules/.package-lock.json"), JSON.stringify({
      packages: { "node_modules/@wedly/policy-match-shared": { resolved: RESOLVED(opts.installedSha) } },
    }));
  }
  return root;
}

function run(root: string, sha: string, ...extra: string[]) {
  const r = spawnSync("node", [SCRIPT, root, sha, ...extra], { encoding: "utf8" });
  return { code: r.status, err: r.stderr };
}

describe("verify-lock.mjs", () => {
  it("셋이 같은 SHA 면 0", () => {
    expect(run(app({ pkgSha: SHA, lockRootSha: SHA, lockResolvedSha: SHA }), SHA).code).toBe(0);
  });
  it("package.json 핀이 다르면 1 + 이유", () => {
    const r = run(app({ pkgSha: OTHER, lockRootSha: SHA, lockResolvedSha: SHA }), SHA);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/package\.json/);
  });
  it("잠금 파일 루트 spec 이 다르면 1", () => {
    expect(run(app({ pkgSha: SHA, lockRootSha: OTHER, lockResolvedSha: SHA }), SHA).code).toBe(1);
  });
  it("잠금 파일 resolved 가 다르면 1", () => {
    expect(run(app({ pkgSha: SHA, lockRootSha: SHA, lockResolvedSha: OTHER }), SHA).code).toBe(1);
  });
  it("integrity 가 sha512 가 아니면 1", () => {
    expect(run(app({ pkgSha: SHA, lockRootSha: SHA, lockResolvedSha: SHA, integrity: "" }), SHA).code).toBe(1);
  });
  it("--installed: 설치 잠금이 없거나 다르면 1, 같으면 0", () => {
    expect(run(app({ pkgSha: SHA, lockRootSha: SHA, lockResolvedSha: SHA }), SHA, "--installed").code).toBe(1);
    expect(run(app({ pkgSha: SHA, lockRootSha: SHA, lockResolvedSha: SHA, installedSha: OTHER }), SHA, "--installed").code).toBe(1);
    expect(run(app({ pkgSha: SHA, lockRootSha: SHA, lockResolvedSha: SHA, installedSha: SHA }), SHA, "--installed").code).toBe(0);
  });
  it("SHA 가 40자리 16진수가 아니면 2(사용법 오류)", () => {
    expect(run(app({ pkgSha: SHA, lockRootSha: SHA, lockResolvedSha: SHA }), "b404b4b").code).toBe(2);
  });
});
```

- [ ] **Step 2: 실패 확인** — `npx vitest run src/propagate/verify-lock.test.ts` → FAIL

- [ ] **Step 3: 구현**

```js
#!/usr/bin/env node
// scripts/propagate/verify-lock.mjs — 핀 갱신 뒤 package.json·package-lock(·설치 잠금)이 새 SHA 로 일치하는지 대조.
// 사용: node verify-lock.mjs <appRoot> <sha40> [--installed]
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const NAME = "@wedly/policy-match-shared";
const REPO = "smlee-hash/wedly-policy-match-shared";
const [root, sha, ...flags] = process.argv.slice(2);

if (!root || !/^[0-9a-f]{40}$/.test(sha ?? "")) {
  process.stderr.write("사용법: verify-lock.mjs <appRoot> <sha40> [--installed]\n");
  process.exit(2);
}

const problems = [];
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
const expectedSpec = `github:${REPO}#${sha}`;

const pkg = readJson(join(root, "package.json"));
const pin = pkg.dependencies?.[NAME];
if (pin !== expectedSpec) problems.push(`package.json 핀이 다름: ${pin ?? "(없음)"}`);

const lock = readJson(join(root, "package-lock.json"));
const rootSpec = lock.packages?.[""]?.dependencies?.[NAME];
if (rootSpec !== expectedSpec) problems.push(`package-lock 루트 spec 이 다름: ${rootSpec ?? "(없음)"}`);
const entry = lock.packages?.[`node_modules/${NAME}`] ?? {};
if (!String(entry.resolved ?? "").endsWith(`#${sha}`)) problems.push(`package-lock resolved 가 다름: ${entry.resolved ?? "(없음)"}`);
if (!String(entry.integrity ?? "").startsWith("sha512-")) problems.push(`package-lock integrity 없음/형식 다름: ${entry.integrity ?? "(없음)"}`);

if (flags.includes("--installed")) {
  const installedPath = join(root, "node_modules/.package-lock.json");
  if (!existsSync(installedPath)) problems.push("node_modules/.package-lock.json 없음 — 설치가 안 됐다");
  else {
    const inst = readJson(installedPath).packages?.[`node_modules/${NAME}`]?.resolved ?? "";
    if (!inst.endsWith(`#${sha}`)) problems.push(`설치 잠금 resolved 가 다름: ${inst || "(없음)"}`);
  }
}

if (problems.length) {
  process.stderr.write(problems.map((p) => `verify-lock: ${p}`).join("\n") + "\n");
  process.exit(1);
}
process.stdout.write(`verify-lock: OK ${sha}\n`);
```

- [ ] **Step 4: 통과 확인** — `npx vitest run src/propagate/verify-lock.test.ts` → PASS (7)

### Task 3: propagate.sh + 가짜 저장소 시험

> **★리뷰 뒤 2단계로 바뀜(2026-09-08 · 총괄 결정 11 R2) — 실제 구조는 코드를 보세요.** 아래 초안은 한 프로세스가 클론·핀 갱신·푸시를 모두 하던 판이다. 지금은 `propagate.sh <clone|prepare|push>` 셋으로 나뉘고 공용 조각은 `scripts/propagate/lib.sh` 에 있다. 시험도 `scripts/propagate/__tests__/propagate.test.ts` 로 옮겨 새 흐름으로 다시 짰다(기존 11건 동작은 그대로 유지).

**Files:**
- Create: `scripts/propagate/propagate.sh`
- Test: `src/propagate/propagate.test.ts`

**입력(환경변수만)** — 워크플로우와 시험이 같은 방식으로 부른다:

| 변수 | 뜻 |
|---|---|
| `PROPAGATE_APP_ID` | apps.json 의 id (`erp`/`illua`/`lab`) |
| `PROPAGATE_SHA` | 새 패키지 SHA(40자리) |
| `PROPAGATE_SUBJECT` | 패키지 커밋 제목(커밋 메시지용) |
| `PROPAGATE_PACKAGE_URL` | 패키지 커밋 주소(본문용) |
| `PROPAGATE_RUN_URL` | Actions 실행 주소(본문용) |
| `PROPAGATE_PACKAGE_DIR` | 전체 이력이 있는 패키지 저장소 경로(후손 검사용) |
| `PROPAGATE_TOKEN` | PAT (비어 있으면 `PROPAGATE_CLONE_URL` 그대로 사용 — 시험용) |
| `PROPAGATE_CLONE_URL` | (선택) 앱 저장소 주소를 통째로 지정. 없으면 `https://x-access-token:${PROPAGATE_TOKEN}@github.com/<repo>.git` |
| `PROPAGATE_DRY_RUN` | `1` 이면 푸시 안 함(diff stat 출력) |
| `PROPAGATE_WORKDIR` | 클론 놓을 부모 폴더(기본 `$RUNNER_TEMP` 또는 `mktemp -d`) |
| `PROPAGATE_MAX_PUSH_TRIES` | 기본 3 |
| `GITHUB_OUTPUT` | 있으면 `result=<updated|skipped-same|skipped-not-descendant|dry-run>` `commit=<sha>` 기록 |

**동작(순서 고정):**
1. 입력 검사(SHA 40자리, id 가 apps.json 에 있음). 실패 exit 2.
2. `git clone --depth 50 --single-branch --branch main <url> <workdir>/<id>`; 토큰이 주소·로그에 안 남게 `set +x` 유지, 주소는 출력하지 않는다.
3. 현재 핀 읽기: `node -p "require('./package.json').dependencies['@wedly/policy-match-shared']"` → `#` 뒤 40자리. 형식이 아니면 실패 exit 1(「핀 형식이 다름 — 사람이 봐야 함」).
4. 같은 SHA 면 `result=skipped-same` exit 0. 아니면 `git -C $PROPAGATE_PACKAGE_DIR merge-base --is-ancestor <현재핀> <새SHA>` 로 후손 검사; 아니면 `result=skipped-not-descendant` exit 0(경고 출력).
5. `npm pkg set "dependencies.@wedly/policy-match-shared=github:smlee-hash/wedly-policy-match-shared#<sha>"` → `npm install --package-lock-only --ignore-scripts --no-audit --no-fund`.
6. apps.json `install` 이 true 면 `npm ci --ignore-scripts --no-audit --no-fund`; 이어 `postSteps` 를 순서대로 `bash -c`.
7. `node scripts/propagate/verify-lock.mjs . <sha> [--installed]`(install 앱만 `--installed`).
8. `git status --porcelain` 에서 `commitPaths` 밖의 변경(추적 파일 변경만 — 미추적은 `node_modules` 등이라 무시하되 `.gitignore` 에 없는 미추적 파일이 생기면 실패)이 있으면 실패 exit 1 하고 목록 출력.
9. 커밋: 저자/커미터 `WEDLY 정책매칭 봇 <policy-bot@wedly.kr>`, 제목 `chore(정책매칭 공용): 핀 <sha7> — <subject>`, 본문 `패키지 커밋: <url>\n자동 반영 실행: <run url>\n(propagate.yml 이 만든 커밋 — 손으로 되돌리지 말고 패키지 쪽을 revert 한다)`.
10. dry run 이면 `git show --stat HEAD` 출력, `result=dry-run` exit 0.
11. 푸시: 최대 N회 `git push origin HEAD:main`; 거부되면 `git fetch origin main && git rebase origin/main`; rebase 충돌이면 `git rebase --abort` 후 exit 1. 성공하면 `result=updated commit=<sha>`.

- [ ] **Step 1: 실패 시험 작성** — 가짜 원격(bare)·가짜 패키지 저장소·가짜 `npm`(PATH 앞에 shim) 으로 시나리오 7개

```ts
// src/propagate/propagate.test.ts
import { describe, expect, it, beforeEach } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const SCRIPT = resolve(__dirname, "../../scripts/propagate/propagate.sh");
const REPO = "smlee-hash/wedly-policy-match-shared";
const SPEC = (sha: string) => `github:${REPO}#${sha}`;
const RESOLVED = (sha: string) => `git+ssh://git@github.com/${REPO}.git#${sha}`;

function sh(cmd: string, cwd: string, env: NodeJS.ProcessEnv = {}) {
  const r = spawnSync("bash", ["-c", cmd], { cwd, encoding: "utf8", env: { ...process.env, ...env } });
  if (r.status !== 0) throw new Error(`${cmd}\n${r.stdout}\n${r.stderr}`);
  return r.stdout.trim();
}

/** 가짜 패키지 저장소: c1 → c2 → c3 (main), 갈래 x1(c1 에서 딴 것) */
function fakePackage(tmp: string) {
  const dir = join(tmp, "pkg");
  mkdirSync(dir);
  sh("git init -q -b main && git config user.email t@t && git config user.name t", dir);
  const commit = (n: string) => { writeFileSync(join(dir, "f.txt"), n); sh(`git add . && git commit -qm "${n}"`, dir); return sh("git rev-parse HEAD", dir); };
  const c1 = commit("c1"), c2 = commit("c2"), c3 = commit("c3");
  sh(`git checkout -q -b side ${c1}`, dir); const x1 = commit("x1"); sh("git checkout -q main", dir);
  return { dir, c1, c2, c3, x1 };
}

/** 가짜 앱: package.json·package-lock 핀 = pinSha, bare 원격 포함 */
function fakeApp(tmp: string, id: string, pinSha: string, extra?: (work: string) => void) {
  const work = join(tmp, `${id}-seed`); mkdirSync(work);
  writeFileSync(join(work, "package.json"), JSON.stringify({ name: id, dependencies: { "@wedly/policy-match-shared": SPEC(pinSha) } }, null, 2) + "\n");
  writeFileSync(join(work, "package-lock.json"), JSON.stringify({ lockfileVersion: 3, packages: { "": { dependencies: { "@wedly/policy-match-shared": SPEC(pinSha) } }, [`node_modules/@wedly/policy-match-shared`]: { resolved: RESOLVED(pinSha), integrity: "sha512-seed" } } }, null, 2) + "\n");
  writeFileSync(join(work, ".gitignore"), "node_modules\n");
  extra?.(work);
  sh("git init -q -b main && git config user.email t@t && git config user.name t && git add . && git commit -qm seed", work);
  const bare = join(tmp, `${id}.git`);
  sh(`git clone -q --bare ${work} ${bare}`, tmp);
  return { work, bare };
}

/** 가짜 npm: pkg set 은 package.json 을 실제로 고치고, install 은 잠금 파일을 새 SHA 로 고친다. ci 는 설치 잠금을 쓴다 */
function fakeNpm(tmp: string) {
  const bin = join(tmp, "bin"); mkdirSync(bin);
  const npm = join(bin, "npm");
  writeFileSync(npm, `#!/usr/bin/env bash
set -e
log="$FAKE_NPM_LOG"; echo "npm $*" >> "$log"
case "$1" in
  pkg) node -e '
    const fs=require("fs"); const [k,v]=process.argv[1].split("="); const p=JSON.parse(fs.readFileSync("package.json","utf8"));
    const keys=k.split("."); p[keys[0]][keys.slice(1).join(".")]=v; fs.writeFileSync("package.json", JSON.stringify(p,null,2)+"\\n");' "$3" ;;
  install) node -e '
    const fs=require("fs"); const p=JSON.parse(fs.readFileSync("package.json","utf8")); const spec=p.dependencies["@wedly/policy-match-shared"]; const sha=spec.split("#")[1];
    const l=JSON.parse(fs.readFileSync("package-lock.json","utf8")); l.packages[""].dependencies["@wedly/policy-match-shared"]=spec;
    l.packages["node_modules/@wedly/policy-match-shared"]={resolved:"git+ssh://git@github.com/smlee-hash/wedly-policy-match-shared.git#"+sha,integrity:"sha512-"+sha.slice(0,8)};
    fs.writeFileSync("package-lock.json", JSON.stringify(l,null,2)+"\\n");' ;;
  ci) node -e '
    const fs=require("fs"); const l=JSON.parse(fs.readFileSync("package-lock.json","utf8")); fs.mkdirSync("node_modules",{recursive:true});
    fs.writeFileSync("node_modules/.package-lock.json", JSON.stringify({packages:{"node_modules/@wedly/policy-match-shared":l.packages["node_modules/@wedly/policy-match-shared"]}}));' ;;
  *) echo "fake npm: unknown $1" >&2; exit 9 ;;
esac`);
  chmodSync(npm, 0o755);
  return bin;
}

function runPropagate(tmp: string, env: Record<string, string>) {
  const log = join(tmp, "npm.log"); writeFileSync(log, "");
  const r = spawnSync("bash", [SCRIPT], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${fakeNpm(tmp)}:${process.env.PATH}`,
      FAKE_NPM_LOG: log,
      PROPAGATE_WORKDIR: join(tmp, "work"),
      PROPAGATE_SUBJECT: "feat: 시험 커밋",
      PROPAGATE_PACKAGE_URL: "https://example.test/pkg/commit",
      PROPAGATE_RUN_URL: "https://example.test/run/1",
      PROPAGATE_TOKEN: "",
      GITHUB_OUTPUT: join(tmp, "out.txt"),
      ...env,
    },
  });
  const out = (() => { try { return readFileSync(join(tmp, "out.txt"), "utf8"); } catch { return ""; } })();
  return { code: r.status, stdout: r.stdout, stderr: r.stderr, out, npmLog: readFileSync(log, "utf8") };
}

describe("propagate.sh", () => {
  let tmp: string; let pkg: ReturnType<typeof fakePackage>;
  beforeEach(() => { tmp = mkdtempSync(join(tmp

dir(), "propagate-")); mkdirSync(join(tmp, "work")); pkg = fakePackage(tmp); });

  it("잠금 파일만 쓰는 앱(lab): 핀 갱신 → 커밋 → 푸시, 커밋 저자는 봇", () => {
    const app = fakeApp(tmp, "lab", pkg.c1);
    const r = runPropagate(tmp, { PROPAGATE_APP_ID: "lab", PROPAGATE_SHA: pkg.c3, PROPAGATE_PACKAGE_DIR: pkg.dir, PROPAGATE_CLONE_URL: app.bare });
    expect(r.code, r.stderr).toBe(0);
    expect(r.out).toContain("result=updated");
    const subject = sh("git log -1 --format=%s main", app.bare);
    expect(subject).toBe(`chore(정책매칭 공용): 핀 ${pkg.c3.slice(0, 7)} — feat: 시험 커밋`);
    expect(sh("git log -1 --format=%an <%ae> main", app.bare)).toBe("WEDLY 정책매칭 봇 <policy-bot@wedly.kr>");
    expect(sh("git show main:package.json", app.bare)).toContain(SPEC(pkg.c3));
    expect(sh("git show main:package-lock.json", app.bare)).toContain(RESOLVED(pkg.c3));
    expect(r.npmLog).not.toMatch(/^npm ci/m);
  });

  it("설치 앱(erp): npm ci 와 후처리(postSteps)를 돌리고 등록부 파일까지 커밋한다", () => {
    const app = fakeApp(tmp, "erp", pkg.c1, (w) => {
      mkdirSync(join(w, "scripts/design-system"), { recursive: true });
      mkdirSync(join(w, "src/lib/design-system"), { recursive: true });
      writeFileSync(join(w, "src/lib/design-system/registry.generated.json"), "{\"pin\":\"old\"}\n");
      // 가짜 cli.mjs: generate 는 등록부에 현재 핀을 쓰고, check 는 그것이 package.json 핀과 같은지 본다
      writeFileSync(join(w, "scripts/design-system/cli.mjs"), `
        import { readFileSync, writeFileSync } from "node:fs";
        const cmd = process.argv[2];
        const pin = JSON.parse(readFileSync("package.json","utf8")).dependencies["@wedly/policy-match-shared"];
        if (cmd === "generate") writeFileSync("src/lib/design-system/registry.generated.json", JSON.stringify({ pin }) + "\\n");
        else if (cmd === "check") { if (JSON.parse(readFileSync("src/lib/design-system/registry.generated.json","utf8")).pin !== pin) { console.error("stale"); process.exit(1); } }
        else process.exit(2);
      `);
    });
    const r = runPropagate(tmp, { PROPAGATE_APP_ID: "erp", PROPAGATE_SHA: pkg.c3, PROPAGATE_PACKAGE_DIR: pkg.dir, PROPAGATE_CLONE_URL: app.bare });
    expect(r.code, r.stderr).toBe(0);
    expect(r.npmLog).toMatch(/^npm ci --ignore-scripts/m);
    expect(sh("git show main:src/lib/design-system/registry.generated.json", app.bare)).toContain(pkg.c3);
    expect(sh("git show --stat --format= main", app.bare)).toMatch(/registry\.generated\.json/);
  });

  it("같은 SHA 면 skipped-same, 커밋 없음", () => {
    const app = fakeApp(tmp, "lab", pkg.c3);
    const before = sh("git rev-parse main", app.bare);
    const r = runPropagate(tmp, { PROPAGATE_APP_ID: "lab", PROPAGATE_SHA: pkg.c3, PROPAGATE_PACKAGE_DIR: pkg.dir, PROPAGATE_CLONE_URL: app.bare });
    expect(r.code).toBe(0);
    expect(r.out).toContain("result=skipped-same");
    expect(sh("git rev-parse main", app.bare)).toBe(before);
  });

  it("현재 핀이 더 새 것(새 SHA 가 후손이 아님)이면 skipped-not-descendant", () => {
    const app = fakeApp(tmp, "lab", pkg.c3);
    const r = runPropagate(tmp, { PROPAGATE_APP_ID: "lab", PROPAGATE_SHA: pkg.c2, PROPAGATE_PACKAGE_DIR: pkg.dir, PROPAGATE_CLONE_URL: app.bare });
    expect(r.code).toBe(0);
    expect(r.out).toContain("result=skipped-not-descendant");
    expect(sh("git show main:package.json", app.bare)).toContain(SPEC(pkg.c3));
  });

  it("dry run: 커밋은 만들되 푸시하지 않는다", () => {
    const app = fakeApp(tmp, "lab", pkg.c1);
    const before = sh("git rev-parse main", app.bare);
    const r = runPropagate(tmp, { PROPAGATE_APP_ID: "lab", PROPAGATE_SHA: pkg.c3, PROPAGATE_PACKAGE_DIR: pkg.dir, PROPAGATE_CLONE_URL: app.bare, PROPAGATE_DRY_RUN: "1" });
    expect(r.code, r.stderr).toBe(0);
    expect(r.out).toContain("result=dry-run");
    expect(r.stdout).toMatch(/package-lock\.json/);
    expect(sh("git rev-parse main", app.bare)).toBe(before);
  });

  it("푸시 경합: 사람이 먼저 밀어 거부되면 rebase 뒤 재시도해 성공한다", () => {
    const app = fakeApp(tmp, "lab", pkg.c1);
    // 클론 뒤·푸시 전 사이에 남이 미는 상황을 가짜 git 훅으로 흉내: bare 의 pre-receive 가 첫 푸시만 거부하며 그 사이 다른 커밋을 만든다
    const other = join(tmp, "other"); sh(`git clone -q ${app.bare} ${other}`, tmp);
    writeFileSync(join(tmp, "race.sh"), `#!/usr/bin/env bash
set -e
flag="${tmp}/raced"
if [ ! -f "$flag" ]; then
  touch "$flag"
  (cd ${other} && git config user.email h@t && git config user.name h && echo x >> README.md && git add . && git commit -qm "사람 커밋" && git push -q origin HEAD:main) >/dev/null 2>&1 || true
  echo "simulated race" >&2; exit 1
fi
exit 0`);
    chmodSync(join(tmp, "race.sh"), 0o755);
    // 첫 푸시를 거부하는 pre-receive: 다만 위 훅 안에서 다른 클론이 미는 푸시도 이 훅을 타므로 flag 로 한 번만 거부
    mkdirSync(join(app.bare, "hooks"), { recursive: true });
    writeFileSync(join(app.bare, "hooks/pre-receive"), `#!/usr/bin/env bash\nexec ${join(tmp, "race.sh")}\n`);
    chmodSync(join(app.bare, "hooks/pre-receive"), 0o755);
    const r = runPropagate(tmp, { PROPAGATE_APP_ID: "lab", PROPAGATE_SHA: pkg.c3, PROPAGATE_PACKAGE_DIR: pkg.dir, PROPAGATE_CLONE_URL: app.bare });
    expect(r.code, r.stderr).toBe(0);
    expect(r.out).toContain("result=updated");
    const log = sh("git log --format=%s main", app.bare);
    expect(log.split("\n")[0]).toMatch(/^chore\(정책매칭 공용\)/);
    expect(log).toContain("사람 커밋");
  });

  it("commitPaths 밖 파일이 바뀌면 실패하고 목록을 알린다", () => {
    const app = fakeApp(tmp, "erp", pkg.c1, (w) => {
      mkdirSync(join(w, "scripts/design-system"), { recursive: true });
      mkdirSync(join(w, "src/lib/design-system"), { recursive: true });
      writeFileSync(join(w, "src/lib/design-system/registry.generated.json"), "{}\n");
      writeFileSync(join(w, "stray.txt"), "a\n");
      writeFileSync(join(w, "scripts/design-system/cli.mjs"), `import { writeFileSync } from "node:fs"; writeFileSync("stray.txt", "b\\n");`);
    });
    const r = runPropagate(tmp, { PROPAGATE_APP_ID: "erp", PROPAGATE_SHA: pkg.c3, PROPAGATE_PACKAGE_DIR: pkg.dir, PROPAGATE_CLONE_URL: app.bare });
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/stray\.txt/);
  });

  it("입력 오류(SHA 형식·모르는 앱)는 2", () => {
    expect(runPropagate(tmp, { PROPAGATE_APP_ID: "lab", PROPAGATE_SHA: "abc", PROPAGATE_PACKAGE_DIR: pkg.dir, PROPAGATE_CLONE_URL: "x" }).code).toBe(2);
    expect(runPropagate(tmp, { PROPAGATE_APP_ID: "hive", PROPAGATE_SHA: pkg.c3, PROPAGATE_PACKAGE_DIR: pkg.dir, PROPAGATE_CLONE_URL: "x" }).code).toBe(2);
  });
});
```

(주의: 위 `beforeEach` 줄의 `tmp\n\ndir()` 는 문서 줄바꿈 사고다 — 실제 파일에는 `tmpdir()` 로 붙여 쓴다.)

- [ ] **Step 2: 실패 확인** — `npx vitest run src/propagate/propagate.test.ts` → FAIL (스크립트 없음)

- [ ] **Step 3: propagate.sh 구현**

```bash
#!/usr/bin/env bash
# scripts/propagate/propagate.sh — 앱 1곳의 @wedly/policy-match-shared 핀을 새 SHA 로 올려 커밋·푸시한다.
# 입력은 환경변수만(계획서 Task 3 표). 토큰은 절대 출력하지 않는다(set -x 금지).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APPS_JSON="$HERE/apps.json"
PKG_NAME="@wedly/policy-match-shared"
PKG_REPO="smlee-hash/wedly-policy-match-shared"
BOT_NAME="WEDLY 정책매칭 봇"
BOT_EMAIL="policy-bot@wedly.kr"

die()  { echo "propagate: $*" >&2; exit 1; }
usage(){ echo "propagate: $*" >&2; exit 2; }
out()  { [ -n "${GITHUB_OUTPUT:-}" ] && echo "$1=$2" >> "$GITHUB_OUTPUT"; echo "propagate: $1=$2"; }

APP_ID="${PROPAGATE_APP_ID:-}"; SHA="${PROPAGATE_SHA:-}"
[[ "$SHA" =~ ^[0-9a-f]{40}$ ]] || usage "PROPAGATE_SHA 는 40자리 SHA 여야 합니다"
[ -n "$APP_ID" ] || usage "PROPAGATE_APP_ID 가 비었습니다"
[ -d "${PROPAGATE_PACKAGE_DIR:-}" ] || usage "PROPAGATE_PACKAGE_DIR(패키지 저장소) 가 필요합니다"

app_field() { node -e '
  const apps = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  const a = apps.find((x) => x.id === process.argv[2]);
  if (!a) process.exit(3);
  const v = a[process.argv[3]];
  process.stdout.write(Array.isArray(v) ? v.join("\n") : String(v));
' "$APPS_JSON" "$APP_ID" "$1" || usage "apps.json 에 없는 앱: $APP_ID"; }

REPO="$(app_field repo)"; INSTALL="$(app_field install)"
mapfile -t POST_STEPS < <(app_field postSteps); mapfile -t COMMIT_PATHS < <(app_field commitPaths)
# 빈 배열이면 mapfile 이 빈 문자열 1개를 만든다 — 걷어낸다
POST_STEPS=("${POST_STEPS[@]/#/}"); [ "${#POST_STEPS[@]}" = 1 ] && [ -z "${POST_STEPS[0]}" ] && POST_STEPS=()

CLONE_URL="${PROPAGATE_CLONE_URL:-}"
if [ -z "$CLONE_URL" ]; then
  [ -n "${PROPAGATE_TOKEN:-}" ] || usage "PROPAGATE_TOKEN 또는 PROPAGATE_CLONE_URL 이 필요합니다"
  CLONE_URL="https://x-access-token:${PROPAGATE_TOKEN}@github.com/${REPO}.git"
fi
WORK_PARENT="${PROPAGATE_WORKDIR:-${RUNNER_TEMP:-$(mktemp -d)}}"; mkdir -p "$WORK_PARENT"
WORK="$WORK_PARENT/$APP_ID"; rm -rf "$WORK"
echo "propagate[$APP_ID]: clone $REPO (main, depth 50)"
git clone -q --depth 50 --single-branch --branch main "$CLONE_URL" "$WORK" 2> >(sed 's#x-access-token:[^@]*@#x-access-token:***@#' >&2)
cd "$WORK"
git config user.name "$BOT_NAME"; git config user.email "$BOT_EMAIL"

CURRENT_SPEC="$(node -p "require('./package.json').dependencies['$PKG_NAME'] || ''")"
CURRENT="${CURRENT_SPEC##*#}"
[[ "$CURRENT_SPEC" == "github:${PKG_REPO}#"* && "$CURRENT" =~ ^[0-9a-f]{40}$ ]] \
  || die "[$APP_ID] 현재 핀 형식이 예상과 다릅니다: '${CURRENT_SPEC}' — 사람이 봐야 합니다"

if [ "$CURRENT" = "$SHA" ]; then echo "propagate[$APP_ID]: 이미 $SHA — 건너뜀"; out result skipped-same; exit 0; fi
if ! git -C "$PROPAGATE_PACKAGE_DIR" merge-base --is-ancestor "$CURRENT" "$SHA" 2>/dev/null; then
  echo "propagate[$APP_ID]: 현재 핀 ${CURRENT:0:7} 이 새 SHA ${SHA:0:7} 의 조상이 아님 — 뒤로 가지 않으려고 건너뜀" >&2
  out result skipped-not-descendant; exit 0
fi

echo "propagate[$APP_ID]: 핀 ${CURRENT:0:7} → ${SHA:0:7}"
npm pkg set "dependencies.${PKG_NAME}=github:${PKG_REPO}#${SHA}"
npm install --package-lock-only --ignore-scripts --no-audit --no-fund
VERIFY_FLAGS=()
if [ "$INSTALL" = "true" ]; then npm ci --ignore-scripts --no-audit --no-fund; VERIFY_FLAGS=(--installed); fi
for step in "${POST_STEPS[@]}"; do echo "propagate[$APP_ID]: $step"; bash -c "$step"; done
node "$HERE/verify-lock.mjs" . "$SHA" "${VERIFY_FLAGS[@]}"

# 커밋 대상 밖 변경(추적 파일 수정·삭제 + .gitignore 밖 미추적)이 있으면 실패
ALLOWED="$(printf '%s\n' "${COMMIT_PATHS[@]}")"
STRAY="$(git status --porcelain --untracked-files=all | awk '{print $2}' | grep -vxF -f <(echo "$ALLOWED") || true)"
[ -z "$STRAY" ] || die "[$APP_ID] 커밋 대상 밖 파일이 바뀌었습니다:"$'\n'"$STRAY"

git add -- "${COMMIT_PATHS[@]}"
git diff --cached --quiet && die "[$APP_ID] 바뀐 것이 없습니다(핀은 바뀌었는데 diff 가 비어 있음)"
SUBJECT="${PROPAGATE_SUBJECT:-(제목 없음)}"
git commit -q -m "chore(정책매칭 공용): 핀 ${SHA:0:7} — ${SUBJECT}" -m "패키지 커밋: ${PROPAGATE_PACKAGE_URL:-}
자동 반영 실행: ${PROPAGATE_RUN_URL:-}
(propagate.yml 이 만든 커밋 — 손으로 되돌리지 말고 패키지 쪽을 revert 한다)"

if [ "${PROPAGATE_DRY_RUN:-0}" = "1" ]; then
  echo "propagate[$APP_ID]: DRY RUN — 푸시하지 않음"; git show --stat --format='%H %s' HEAD; out result dry-run; exit 0
fi

TRIES="${PROPAGATE_MAX_PUSH_TRIES:-3}"
for i in $(seq 1 "$TRIES"); do
  if git push -q origin HEAD:main 2> >(sed 's#x-access-token:[^@]*@#x-access-token:***@#' >&2); then
    out result updated; out commit "$(git rev-parse HEAD)"; echo "propagate[$APP_ID]: 푸시 완료 (${i}회차)"; exit 0
  fi
  echo "propagate[$APP_ID]: 푸시 거부 (${i}/${TRIES}) — origin/main 위로 다시 얹음" >&2
  git fetch -q origin main
  git rebase -q origin/main || { git rebase --abort || true; die "[$APP_ID] rebase 충돌 — 사람이 같은 파일을 바꿨습니다"; }
done
die "[$APP_ID] ${TRIES}회 시도 후 푸시 실패"
```

- [ ] **Step 4: 통과 확인** — `npx vitest run src/propagate/propagate.test.ts` → PASS (8). 실패하는 시나리오는 스크립트를 고친다(시험을 약하게 만들지 않는다).

- [ ] **Step 5: 실제 앱으로 로컬 예행** — 랩 저장소 클론 URL 을 로컬 경로로 주고 dry run(가짜 npm 없이 **진짜 npm**):

```bash
cd /Users/00.logico.l/orca/wt/pkg-p5
PROPAGATE_APP_ID=lab PROPAGATE_SHA=$(git rev-parse origin/main) PROPAGATE_PACKAGE_DIR=$PWD \
PROPAGATE_CLONE_URL=/Users/00.logico.l/orca/wedly-policy-lab PROPAGATE_DRY_RUN=1 PROPAGATE_WORKDIR=$(mktemp -d) \
PROPAGATE_SUBJECT=예행 bash scripts/propagate/propagate.sh
```
기대: 「이미 … 건너뜀」(핀이 이미 origin/main). 새 SHA 예행은 이 계획을 커밋한 뒤 그 SHA 로 다시 돌려 `result=dry-run` 과 잠금 파일 diff(`resolved`·`integrity` 두 줄)를 확인한다.

### Task 4: notify.sh (실패 알림)

**Files:**
- Create: `scripts/propagate/notify.sh`

입력: `WEDLY_NOTIFY_URL`(ERP 주소, 예 `https://wedly-erp-production.up.railway.app`), `WEDLY_NOTIFY_KEY`, 인자 `<title> <url> <line...>`. 둘 중 하나라도 비면 「알림 설정 없음」만 찍고 exit 0. 3회 재시도(30초 간격 — ERP 배포창 대비), 마지막까지 실패해도 exit 0(알림 실패로 봇을 다시 빨갛게 만들지 않는다). 응답 본문은 코드만 찍는다.

```bash
#!/usr/bin/env bash
# scripts/propagate/notify.sh <title> <url> [line...] — ERP 내부 통로(kind=status)로 슬랙 알림. 항상 exit 0.
set -uo pipefail
TITLE="${1:-}"; URL="${2:-}"; shift 2 || true
if [ -z "${WEDLY_NOTIFY_URL:-}" ] || [ -z "${WEDLY_NOTIFY_KEY:-}" ]; then echo "notify: 설정 없음(WEDLY_NOTIFY_URL/KEY) — 건너뜀"; exit 0; fi
BODY="$(node -e '
  const [title, url, ...lines] = process.argv.slice(1);
  const body = { kind: "status", title: title.slice(0, 200), lines: lines.slice(0, 10).map((l) => l.slice(0, 500)) };
  if (/^https?:\/\//.test(url)) body.url = url.slice(0, 2000);
  process.stdout.write(JSON.stringify(body));
' "$TITLE" "$URL" "$@")"
for i in 1 2 3; do
  code="$(curl -sS -o /dev/null -w '%{http_code}' -m 20 -X POST "${WEDLY_NOTIFY_URL%/}/api/internal/policy-lab/notify" \
    -H 'content-type: application/json' -H "x-internal-key: ${WEDLY_NOTIFY_KEY}" --data "$BODY" || echo 000)"
  case "$code" in 200) echo "notify: 보냄"; exit 0;; esac
  echo "notify: 실패 http=$code (${i}/3)"; [ "$i" -lt 3 ] && sleep 30
done
echo "notify: 3회 실패 — GitHub 실패 메일이 대신 남는다"; exit 0
```

시험: 단위 시험은 두지 않는다(curl 한 줄). 예행연습(Task 6)에서 일부러 잘못된 열쇠로 한 번 불러 401 로그를 확인하고, 실제 열쇠로 한 번 불러 슬랙 글이 오는지 본다.

### Task 5: propagate.yml

> **★리뷰 뒤 2단계 job 으로 바뀜(2026-09-08 · 총괄 결정 11 R2·R3·R4) — 실제 구조는 파일을 보세요.** 아래 초안은 `propagate` job 하나가 시크릿을 쥔 채 앱 코드까지 돌리던 판이다. 지금은 `prepare`(읽기 전용 PAT·40분) → artifact → `push`(쓰기 PAT·65분)이고, 동시성 그룹이 손 실행/자동 반영으로 갈라져 있으며 알림 단계의 `|| true` 규칙이 다르다.

**Files:**
- Create: `.github/workflows/propagate.yml`

```yaml
# 3앱 자동 반영 봇 — 설계서 §6 D1·D2, 계획서 docs/superpowers/plans/2026-09-07-p5-propagate-bot.md
#
# 언제 도나: CI 워크플로우가 main 에서 성공했을 때(workflow_run). 손으로는 workflow_dispatch(dry_run 기본 켜짐).
# 끄기: 저장소 변수 PROPAGATE_ENABLED=false.
# 시크릿: PROPAGATE_TOKEN(세밀 PAT, 앱 3저장소 contents:write) · WEDLY_NOTIFY_KEY(ERP 내부 알림 열쇠)
# 변수:  PROPAGATE_ENABLED · WEDLY_NOTIFY_URL(ERP 주소)
name: Propagate

on:
  workflow_run:
    workflows: [CI]
    types: [completed]
    branches: [main]
  workflow_dispatch:
    inputs:
      dry_run:
        description: "예행연습(푸시 안 함)"
        type: boolean
        default: true
      sha:
        description: "반영할 패키지 SHA(비우면 main 끝)"
        type: string
        default: ""

concurrency:
  group: propagate-main
  cancel-in-progress: false

permissions:
  contents: read

jobs:
  resolve:
    if: >-
      vars.PROPAGATE_ENABLED != 'false' &&
      (github.event_name == 'workflow_dispatch' || github.event.workflow_run.conclusion == 'success')
    runs-on: ubuntu-latest
    outputs:
      sha: ${{ steps.pick.outputs.sha }}
      subject: ${{ steps.pick.outputs.subject }}
      dry_run: ${{ steps.pick.outputs.dry_run }}
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - id: pick
        shell: bash
        run: |
          set -euo pipefail
          if [ "${{ github.event_name }}" = "workflow_dispatch" ]; then
            SHA="${{ inputs.sha }}"; [ -n "$SHA" ] || SHA="$(git rev-parse origin/main)"
            DRY="${{ inputs.dry_run }}"
          else
            SHA="${{ github.event.workflow_run.head_sha }}"; DRY="false"
          fi
          git merge-base --is-ancestor "$SHA" origin/main || { echo "SHA 가 main 에 없음: $SHA" >&2; exit 1; }
          echo "sha=$SHA" >> "$GITHUB_OUTPUT"
          echo "subject=$(git log -1 --format=%s "$SHA")" >> "$GITHUB_OUTPUT"
          echo "dry_run=$DRY" >> "$GITHUB_OUTPUT"

  propagate:
    needs: resolve
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        app: [erp, illua, lab]
    env:
      # ssh 주소를 https 로 — 실행기에는 ssh 열쇠가 없다(F2: 보통은 tarball 로 받지만 안전망)
      GIT_CONFIG_COUNT: "1"
      GIT_CONFIG_KEY_0: url.https://github.com/.insteadOf
      GIT_CONFIG_VALUE_0: ssh://git@github.com/
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
      - name: 핀 반영 (${{ matrix.app }})
        id: run
        shell: bash
        env:
          PROPAGATE_APP_ID: ${{ matrix.app }}
          PROPAGATE_SHA: ${{ needs.resolve.outputs.sha }}
          PROPAGATE_SUBJECT: ${{ needs.resolve.outputs.subject }}
          PROPAGATE_PACKAGE_URL: ${{ github.server_url }}/${{ github.repository }}/commit/${{ needs.resolve.outputs.sha }}
          PROPAGATE_RUN_URL: ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}
          PROPAGATE_PACKAGE_DIR: ${{ github.workspace }}
          PROPAGATE_TOKEN: ${{ secrets.PROPAGATE_TOKEN }}
          PROPAGATE_DRY_RUN: ${{ needs.resolve.outputs.dry_run == 'true' && '1' || '0' }}
        run: bash scripts/propagate/propagate.sh
      - name: 실패 알림
        if: failure()
        shell: bash
        env:
          WEDLY_NOTIFY_URL: ${{ vars.WEDLY_NOTIFY_URL }}
          WEDLY_NOTIFY_KEY: ${{ secrets.WEDLY_NOTIFY_KEY }}
        run: >-
          bash scripts/propagate/notify.sh
          "정책매칭 공용 자동 반영 실패: ${{ matrix.app }}"
          "${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}"
          "패키지 SHA ${{ needs.resolve.outputs.sha }}"
          "${{ needs.resolve.outputs.subject }}"
          "앱 저장소 main 은 바뀌지 않았습니다(옛 핀 그대로). 실행 로그를 보고 사람이 핀을 맞추거나 다시 돌리세요."
```

검증: `npx --yes action-validator .github/workflows/propagate.yml`(있으면) 또는 `node -e "require('js-yaml')"` 가 없으니 `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/propagate.yml'))"` 로 문법만 확인. 실제 검증은 Task 6 의 dispatch 예행이다.

### Task 6: README 절 + 시크릿·변수 등록 + 첫 가동

**Files:**
- Modify: `README.md` (「자동 반영 봇」 절 추가)
- 저장소 설정(코드 아님): 변수 `PROPAGATE_ENABLED`, `WEDLY_NOTIFY_URL`; 시크릿 `PROPAGATE_READ_TOKEN`(읽기 전용 · 클론용 · 리뷰 R2), `PROPAGATE_TOKEN`(쓰기 · 밀기용), `WEDLY_NOTIFY_KEY`

README 절 내용: 언제 도나 / 끄기(`gh variable set PROPAGATE_ENABLED -b false -R smlee-hash/wedly-policy-match-shared`) / 예행(`gh workflow run Propagate -R … -f dry_run=true`) / 되돌리기(패키지 `git revert` 1개 → 봇이 다시 3앱에 퍼뜨림) / 봇 커밋을 손으로 고치지 말 것 / PAT 만료일(발급 +1년)과 재발급 절차 메모 위치(`[[github-token-rotation-via-aside]]`).

순서(총괄 결정 9):
- [ ] 1. `gh variable set PROPAGATE_ENABLED -b false -R smlee-hash/wedly-policy-match-shared` (워크플로우 밀기 전)
      · **이 변수는 자동 실행만 막는다**(2차 리뷰 F8) — 아래 6번의 손 예행은 꺼져 있어도 돈다
- [ ] 2. `gh variable set WEDLY_NOTIFY_URL -b https://wedly-erp-production.up.railway.app -R …`
- [ ] 3. `gh secret set WEDLY_NOTIFY_KEY -R … < ~/.agent-browser/lab-internal-key.key` (값을 화면에 찍지 않는다)
- [ ] 4. PAT 발급(Aside · 총괄 결정 8) → `gh secret set PROPAGATE_TOKEN -R … < ~/.agent-browser/propagate-pat.key`
- [ ] 4-2. **산출물 봉인 열쇠쌍**(총괄 결정 13 · F9): 사람이 RSA 2048 키쌍을 만들어
      **공개키는 저장소 변수** `PROPAGATE_ARTIFACT_PUBKEY`(PEM 텍스트), **비밀키는 시크릿**
      `PROPAGATE_ARTIFACT_PRIVKEY` 에 넣는다. 공개키 변수가 비어 있으면 준비 job 이
      **아무것도 올리지 않고 실패**하므로 이 단계를 건너뛰면 봇이 한 발도 못 간다
- [ ] 5. 패키지 커밋·푸시(가지 → main 병합) → CI 초록 확인, Propagate 는 변수 때문에 건너뜀 확인
- [ ] 6. `gh workflow run Propagate -R … -f dry_run=true` → 3 job 모두 `result=dry-run` 과 diff stat(잠금 파일 2줄 · ERP 는 등록부 포함) 확인. ERP job 의 `npm ci` 소요 시간 기록
- [ ] 7. `gh variable set PROPAGATE_ENABLED -b true`
- [ ] 8. 인수 시험: 패키지 README 한 줄 커밋(문서만) → CI → Propagate → 앱 3곳 main 에 봇 커밋 3개 → Railway 3서비스 SUCCESS(`env -u RAILWAY_TOKEN npx railway status --json` 또는 각 앱 `/api/build-id` 가 봇 커밋 SHA 를 돌려주는지)
- [ ] 9. 실패 알림 실증: dispatch 로 `sha` 에 main 에 없는 SHA 를 주면 resolve 가 실패 → 이건 propagate job 이 아니라 알림이 안 간다. 대신 일부러 `PROPAGATE_TOKEN` 을 잠깐 잘못된 값으로 바꿔 dispatch(dry_run=false 로 하되 클론 단계에서 실패) → 슬랙 글 확인 → 시크릿 복구. (조심: 되돌리는 것을 잊지 않는다 — 8단계 인수 시험은 **복구 뒤** 한 번 더 dispatch dry_run 으로 초록 확인)

### Task 7: (뒤 단계) 배포 확인 — 공개 build-id 대기 (총괄 결정 6)

**Files:**
- Create: `scripts/propagate/watch-deploy.mjs`
- Modify: `scripts/propagate/apps.json` (앱마다 `buildIdUrl` 추가 — ERP `https://wedly-erp-production.up.railway.app/api/build-id`, 일루아 `https://wedly-illua-collab-production.up.railway.app/api/build-id`, 랩 `https://wedly-policy-lab-production.up.railway.app/api/build-id`) + `apps-json.test.ts` 에 형식 시험 1건
- Modify: `.github/workflows/propagate.yml` — propagate job 의 마지막 단계로 「배포 확인」(`if: steps.run.outputs.result == 'updated'`), 실패해도 job 은 초록(`continue-on-error: true`)이되 알림은 보낸다

동작(`node scripts/propagate/watch-deploy.mjs <buildIdUrl> <commitSha> [timeoutSec=1800] [intervalSec=30]`): URL 을 30초마다 GET(타임아웃 15초, 오류는 무시하고 계속) 해 `commitSha` 가 인자와 같아지면 「배포 확인」 exit 0. 시간 안에 안 되면 exit 3 + 마지막으로 본 SHA 를 stderr 에 적는다. 인자 오류 exit 2. `fetch` 는 전역(node 22)을 쓰되 시험을 위해 `globalThis.fetch` 를 갈아끼울 수 있게 모듈 상단에서 참조하지 않고 호출 시점에 읽는다.

워크플로우 단계:
```yaml
      - name: 배포 확인 (${{ matrix.app }})
        if: steps.run.outputs.result == 'updated'
        id: watch
        continue-on-error: true
        shell: bash
        env:
          APP_ID: ${{ matrix.app }}
          COMMIT: ${{ steps.run.outputs.commit }}
        run: |
          URL="$(node -e 'const a=require("./scripts/propagate/apps.json").find(x=>x.id===process.env.APP_ID);process.stdout.write(a.buildIdUrl)')"
          node scripts/propagate/watch-deploy.mjs "$URL" "$COMMIT" 1800 30
      - name: 배포 미확인 알림
        if: steps.watch.outcome == 'failure'
        shell: bash
        env:
          WEDLY_NOTIFY_URL: ${{ vars.WEDLY_NOTIFY_URL }}
          WEDLY_NOTIFY_KEY: ${{ secrets.WEDLY_NOTIFY_KEY }}
          APP_ID: ${{ matrix.app }}
          COMMIT: ${{ steps.run.outputs.commit }}
          RUN_URL: ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}
        run: >-
          bash scripts/propagate/notify.sh
          "정책매칭 공용 반영 뒤 배포 확인 못 함: $APP_ID"
          "$RUN_URL"
          "봇 커밋 $COMMIT 이 30분 안에 배포본에 나타나지 않았습니다."
          "Railway 빌드 실패이거나 지연입니다 — Railway 화면에서 확인하세요. 실패면 옛 배포가 그대로 살아 있습니다."
```

시험 `src/propagate/watch-deploy.test.ts`(가짜 fetch 주입, 간격 0.01초): ① 첫 응답 옛 SHA → 둘째 새 SHA 면 exit 0, ② 계속 옛 SHA 면 시간 초과 exit 3 + stderr 에 마지막 SHA, ③ 네트워크 오류(reject)·비정상 JSON 은 무시하고 계속하다 새 SHA 오면 0, ④ 인자 부족 exit 2. 스크립트를 자식 프로세스로 돌리는 대신 `watch-deploy.mjs` 가 `export async function waitForCommit(url, sha, {timeoutMs, intervalMs, fetchImpl})` 를 내보내고 `import.meta.url` 이 main 일 때만 CLI 로 동작하게 해 시험이 함수를 직접 부른다.

ERP 배포는 보통 15분 안팎(관문 시험 + 빌드), 일루아·랩은 5~8분 — 30분 상한이면 충분하다(2026-09-07 실측).

## 3. 검증·리뷰·완료 기준

| 단계 | 기준 |
|---|---|
| 단위 시험 | `npm test` 전량 초록(기존 + propagate 3파일). `npm run typecheck` 초록 |
| 예행 | dispatch dry_run 3 job 초록, ERP job 에서 `npm ci` 와 `generate`·`check` 가 돌고 등록부 diff 가 핀 줄만 바뀜 |
| 인수 | 문서 커밋 1개로 앱 3곳에 봇 커밋 3개 + Railway 3 SUCCESS + 각 앱 `/api/build-id`(있는 앱) 가 새 커밋 |
| 독립 리뷰 | 인증(PAT)·3앱 main 푸시 = 핵심 규모 → Astra 리뷰 1회(`codex-review.sh`, 패키지 작업 사본 기준 origin/main) |
| 안전망 실증 | 잘못된 토큰으로 실패 알림 1회 슬랙 도착 확인 · `PROPAGATE_ENABLED=false` 로 dispatch 가 건너뛰는 것 확인 |
| 기록 | 메모리 `policy-lab-program-2026-09-05` 에 P5 결과·PAT 만료일·끄는 법 · 이 계획서에 실측 시간 |

## 4. 위험과 대비

- **ERP `npm ci` 가 Actions 에서 실패**(네이티브 모듈·overrides tgz 내려받기): 로그를 보고 `--ignore-scripts` 유지한 채 원인을 고친다. 정 안 되면 ERP 만 `install:false` 로 두고 등록부는 「사람이 재생성」으로 낮추되 이는 총괄 결정 사항이라 계획서에 적고 보고한다.
- **앱 잠금 파일이 실행기 npm 판과 어긋남**(2026-09-08 실측 — 랩 6건·ERP 0건·일루아 0건): 봇은 `verify-artifact` 로 안전하게 멈춘다. 사람이 그 앱에서 `npm install --package-lock-only` 한 번을 커밋해 정리한 뒤 다시 돌린다. 실행기는 node 22의 npm 을 쓰므로, 앱 잠금 파일을 사람이 손볼 때도 같은 판으로 맞추는 것이 좋다.
- **`npm install --package-lock-only` 가 `resolved` 를 `git+https` 로 적어 3앱 잠금 파일 형식이 달라짐**: verify-lock 은 `#sha` 접미만 본다. Railway 는 두 형식 다 받는다(pacote). 형식이 바뀌면 README 에 적는다.
- **Actions 가 봇 커밋으로 앱 저장소 워크플로우를 부르지 않음**: 앱 3곳엔 `.github/workflows` 가 없거나 무관하다(Railway 가 GitHub App 으로 push 를 본다). PAT 푸시도 Railway 배포를 일으킨다 — 인수 시험이 증명한다.
- **workflow_run 이 fork/PR 에서 오는 경우**: `branches: [main]` + `conclusion == success` 로 막는다. public 저장소라 PR 은 누구나 열 수 있지만, `workflow_run` 은 기본 브랜치의 워크플로우 파일로 돌고 시크릿은 PR 문맥에 안 나간다. 그래도 `resolve` 가 SHA 가 main 의 조상인지 다시 확인한다.
