#!/usr/bin/env bash
# scripts/propagate/propagate.sh — 앱 1곳의 @wedly/policy-match-shared 핀을 새 SHA 로 올려 커밋·푸시한다.
# 계획서: docs/superpowers/plans/2026-09-07-p5-propagate-bot.md (Task 3 · 2026-09-08 리뷰 R2 로 2단계 분리)
#
# 사용: propagate.sh <clone|prepare|push>     입력은 나머지 전부 환경변수로 받는다.
#
#   clone   — 앱 저장소를 클론한다. **토큰을 쥐는 자리**라 여기서는 git 말고 아무것도 돌리지 않는다.
#   prepare — 핀을 올리고 npm·앱 후처리를 돌린 뒤 **커밋 대상 파일만** 산출물 폴더에 담는다.
#             **토큰이 없는 자리**다(앱 코드가 여기서 돈다).
#   push    — 산출물을 받아 새로 깨끗하게 클론한 자리에 얹어 커밋·푸시한다.
#             다시 **토큰을 쥐는 자리**라 npm·앱 코드를 한 줄도 돌리지 않는다.
#
# 왜 나눴는지는 lib.sh 머리주석(리뷰 R2)에 적혀 있다. GitHub Actions 에서는
# clone+prepare 가 `prepare` job, push 가 `push` job 이고 그 사이는 artifact 로만 이어진다.
#
# 종료 코드: 0 = 반영했거나 일부러 건너뜀 · 1 = 실패(사람이 봐야 함) · 2 = 입력 오류.
# GITHUB_OUTPUT 이 있으면 단계마다 아래를 적는다:
#   prepare → result=<prepared|skipped-same|skipped-not-descendant>
#   push    → result=<updated|dry-run|skipped-same|skipped-not-descendant|failed> (updated 면 commit=<sha> 도)
# ★clone·prepare 는 **어떤 이유로 죽든** 산출물 폴더에 meta.json{result:"failed", error:"한 줄 사유"} 를
#   남긴다(lib.sh 의 EXIT 갈고리). 준비 job 에는 알림이 없고 — 앱 코드가 도는 자리에서 알림 열쇠를
#   쓰지 않으려고 없앴다(2026-09-08 2차 리뷰 F1) — 밀기 job 이 그 사유를 읽어 빨갛게 끝낸다.
#
# 환경변수
#   PROPAGATE_APP_ID      apps.json 의 id (erp|illua|lab)            [clone·prepare·push]
#   PROPAGATE_SHA         반영할 패키지 커밋 40자리                  [prepare·push]
#                         (push 는 이 값만 믿는다 — 산출물이 말하는 SHA 는 여기에 맞는지로만 본다)
#   PROPAGATE_SUBJECT     패키지 커밋 제목(커밋 메시지용)            [prepare → meta.json → push]
#   PROPAGATE_PACKAGE_DIR 전체 이력이 있는 패키지 저장소 경로        [prepare·push · 후손 검사]
#   PROPAGATE_OUT         산출물 폴더(기본 <workdir>/out-<앱>)       [prepare·push]
#   PROPAGATE_TOKEN       PAT(없으면 PROPAGATE_CLONE_URL 필요)       [clone·push]
#   PROPAGATE_CLONE_URL   앱 저장소 주소를 통째로 지정(시험·예행용)  [clone·push]
#   PROPAGATE_WORKDIR     클론 놓을 부모 폴더(기본 $RUNNER_TEMP)     [clone·prepare·push]
#   PROPAGATE_PACKAGE_URL·PROPAGATE_RUN_URL  커밋 본문에 적을 주소   [push]
#   PROPAGATE_DRY_RUN     1 이면 커밋만 만들고 밀지 않는다           [push]
#   PROPAGATE_MAX_PUSH_TRIES  기본 3                                 [push]
set -euo pipefail

PROPAGATE_HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# 검사기에게 어느 파일을 읽는지 알려 준다. `-x` 없이 부르면 따라 읽지 못하므로 그 안내(SC1091)는 끈다.
# shellcheck source=./lib.sh
# shellcheck disable=SC1091
. "$PROPAGATE_HERE/lib.sh"

STEP="${1:-}"
APP_ID="${PROPAGATE_APP_ID:-}"

# ── clone ───────────────────────────────────────────────────────────────────
run_clone() {
  # 클론이 실패해도 준비 job 은 「사유가 담긴 meta.json」을 올린다(2차 리뷰 F1) —
  # 알림은 밀기 job 한 곳에서만 보내므로, 그 job 이 읽을 것이 여기서부터 있어야 한다.
  WORK_PARENT="$(work_parent)"
  FAIL_META_DIR="$(out_dir)"
  load_app
  WORK="$WORK_PARENT/$APP_ID"
  clone_app "$WORK"
  # 여기서부터 이 폴더는 앱 코드(npm·후처리)가 만지는 자리다 — 자격을 남기지 않는다.
  disarm_credentials "$WORK"
  echo "propagate[$APP_ID]: 클론 완료 — $(git -C "$WORK" rev-parse HEAD) ($WORK)"
}

# ── prepare ─────────────────────────────────────────────────────────────────
# 산출물 폴더에 meta.json 과 commitPaths 파일들을 담는다. 커밋·푸시는 하지 않는다.
write_meta() { write_meta_file "$OUT/meta.json" "$1"; }

run_prepare() {
  WORK_PARENT="$(work_parent)"
  OUT="$(out_dir)"
  # shellcheck disable=SC2034  # lib.sh 의 EXIT 갈고리가 읽는다(검사기는 파일 하나만 본다)
  FAIL_META_DIR="$OUT"
  SHA="${PROPAGATE_SHA:-}"
  [[ "$SHA" =~ ^[0-9a-f]{40}$ ]] || usage "PROPAGATE_SHA 는 40자리 SHA 여야 합니다 (받은 값: '${SHA}')"
  load_app
  [ -d "${PROPAGATE_PACKAGE_DIR:-}" ] || usage "PROPAGATE_PACKAGE_DIR(패키지 저장소 경로) 가 필요합니다"

  WORK="$WORK_PARENT/$APP_ID"
  [ -d "$WORK/.git" ] || usage "[$APP_ID] 클론이 없습니다: ${WORK} — 먼저 'propagate.sh clone' 을 돌리세요"
  rm -rf "$OUT"
  mkdir -p "$OUT"
  cd "$WORK"

  # prepare 가 본 앱 main 의 커밋 — push 는 **이 자리 위에** 봇 커밋을 얹는다.
  BASE_SHA="$(git rev-parse HEAD)"
  read_current_pin

  if [ "$CURRENT" = "$SHA" ]; then
    echo "propagate[$APP_ID]: 이미 ${SHA} — 건너뜀"
    write_meta skipped-same
    out result skipped-same
    exit 0
  fi
  if ! git -C "$PROPAGATE_PACKAGE_DIR" cat-file -e "${CURRENT}^{commit}" 2>/dev/null; then
    echo "propagate[$APP_ID]: 현재 핀 ${CURRENT:0:7} 을 패키지 저장소에서 찾지 못함 — 뒤로 가지 않으려고 건너뜀" >&2
    write_meta skipped-not-descendant
    out result skipped-not-descendant
    exit 0
  fi
  if ! git -C "$PROPAGATE_PACKAGE_DIR" merge-base --is-ancestor "$CURRENT" "$SHA" 2>/dev/null; then
    echo "propagate[$APP_ID]: 현재 핀 ${CURRENT:0:7} 이 새 SHA ${SHA:0:7} 의 조상이 아님 — 뒤로 가지 않으려고 건너뜀" >&2
    write_meta skipped-not-descendant
    out result skipped-not-descendant
    exit 0
  fi

  echo "propagate[$APP_ID]: 핀 ${CURRENT:0:7} → ${SHA:0:7}"
  npm pkg set "dependencies.${PKG_NAME}=github:${PKG_REPO}#${SHA}" \
    || die "[$APP_ID] 핀 쓰기(npm pkg set) 실패"
  npm install --package-lock-only --ignore-scripts --no-audit --no-fund \
    || die "[$APP_ID] 잠금 파일 갱신(npm install --package-lock-only) 실패 — 새 SHA 를 아직 GitHub 에서 받을 수 없거나(밀기 전) 네트워크·인증 문제입니다"

  VERIFY_FLAGS=()
  if [ "$INSTALL" = "true" ]; then
    npm ci --ignore-scripts --no-audit --no-fund \
      || die "[$APP_ID] 설치(npm ci) 실패 — 잠금 파일과 창고가 맞지 않거나 내려받기가 막혔습니다"
    VERIFY_FLAGS=(--installed)
  fi

  for STEP_CMD in ${POST_STEPS[@]+"${POST_STEPS[@]}"}; do
    echo "propagate[$APP_ID]: $STEP_CMD"
    bash -c "$STEP_CMD" || die "[$APP_ID] 후처리 실패: $STEP_CMD"
  done

  node "$PROPAGATE_HERE/verify-lock.mjs" . "$SHA" ${VERIFY_FLAGS[@]+"${VERIFY_FLAGS[@]}"} \
    || die "[$APP_ID] 핀·잠금 파일이 어긋납니다(위 verify-lock 줄 참고) — 밀지 않았습니다"

  # 커밋 대상 밖 변경 검사 — `.gitignore` 에 걸린 파일(node_modules 등)은 애초에 나오지 않는다.
  path_allowed() {
    local candidate="$1" p
    for p in ${COMMIT_PATHS[@]+"${COMMIT_PATHS[@]}"}; do
      if [ "$p" = "$candidate" ]; then return 0; fi
    done
    return 1
  }
  STRAY=""
  while IFS= read -r -d '' ENTRY; do
    ENTRY_PATH="${ENTRY:3}"
    if ! path_allowed "$ENTRY_PATH"; then STRAY="${STRAY}${ENTRY_PATH}"$'\n'; fi
    # 이름 바뀜(R)·복사(C) 는 `XY <새 이름>\0<원래 이름>\0` 로 두 칸을 쓴다(2026-09-08 실측) — 둘 다 본다
    case "${ENTRY:0:2}" in
      R*|C*)
        if IFS= read -r -d '' ENTRY_ORIG; then
          if ! path_allowed "$ENTRY_ORIG"; then STRAY="${STRAY}${ENTRY_ORIG}"$'\n'; fi
        fi
        ;;
    esac
  done < <(git status --porcelain=v1 -z --untracked-files=all)
  [ -z "$STRAY" ] || die "[$APP_ID] 커밋 대상 밖 파일이 바뀌었습니다:"$'\n'"$STRAY"

  # 커밋할 파일을 산출물 폴더로 — 여기서 없는 파일은 후처리가 만들지 못한 것이다.
  for P in ${COMMIT_PATHS[@]+"${COMMIT_PATHS[@]}"}; do
    [ -f "$P" ] || die "[$APP_ID] 커밋할 파일이 없습니다: ${P} — 후처리가 그 파일을 만들지 못했습니다"
    mkdir -p "$OUT/$(dirname "$P")"
    cp "$P" "$OUT/$P"
  done
  write_meta prepared
  echo "propagate[$APP_ID]: 산출물 준비 완료 — $OUT (기준 커밋 ${BASE_SHA:0:7})"
  out result prepared
}

# ── push ────────────────────────────────────────────────────────────────────
# 산출물 meta.json 의 칸 하나를 읽는다. 산출물은 **믿을 수 없는 입력**이라
# `require` 로 열지 않고(3차 리뷰 G1) 보통 파일인지 먼저 본 뒤 읽으며, 최상위가 개체가 아니면 실패한다.
meta_field() {
  node -e "$PROPAGATE_JSON_READER"'
    try {
      const meta = readJsonObject(process.argv[1]);
      const v = meta[process.argv[2]];
      process.stdout.write(v === undefined || v === null ? "" : String(v));
    } catch (err) { fail(err); }
  ' "$META" "$1"
}

# 산출물 파일을 덮어쓸 자리가 **정말 그 자리인지** 본다(2026-09-08 2차 리뷰 F2 · P1).
#
# ★막는 사고: 앱 기준 커밋이 `src/lib/design-system/registry.generated.json` 을
#  `../../../.git/config` 를 가리키는 **심볼릭 링크**로 담고 있으면, 그 자리에 파일을 쓰는 순간
#  링크를 따라가 클론의 `.git/config` 가 덮인다 — 그 다음 git 호출에 남의 설정(자격 도우미·
#  `url.insteadOf`)이 얹혀 **토큰이 남의 서버로 나갈 수 있다.**
#
# ★두 겹으로 본다:
#  ① 파일 시스템: 경로를 `a`, `a/b`, `a/b/c` 로 하나씩 걸으며 `[ -L ]` 로 링크를 찾는다.
#     마지막 칸은 이미 있다면 **보통 파일**이어야 하고, 중간 칸은 **폴더**여야 한다.
#  ② git 색인: `git ls-files -s -- <경로>` 의 mode 가 `120000`(=심볼릭 링크)이면 거부.
#     `core.symlinks=false` 인 클론에서는 링크가 **평범한 글자 파일**로 풀려 ①이 못 잡는다.
assert_plain_commit_path() {
  local rel="$1" acc="" rest="$1" part mode
  case "$rel" in
    # `.*` 가 `.git/…`·`..`·`../…` 를 모두 잡는다. 나머지는 경로 **가운데**의 `..` 를 잡는 것.
    ""|/*|.*|*/../*|*/..) die "[$APP_ID] 커밋 대상 경로가 이상합니다: '${rel}' — 밀지 않았습니다" ;;
  esac
  while [ -n "$rest" ]; do
    part="${rest%%/*}"
    if [ "$part" = "$rest" ]; then rest=""; else rest="${rest#*/}"; fi
    [ -n "$part" ] || die "[$APP_ID] 커밋 대상 경로가 이상합니다: '${rel}' — 밀지 않았습니다"
    if [ -z "$acc" ]; then acc="$part"; else acc="$acc/$part"; fi

    if [ -L "$acc" ]; then
      die "[$APP_ID] 커밋 대상 경로에 심볼릭 링크가 있습니다: ${acc} — 밀지 않았습니다"
    fi
    if [ -n "$rest" ]; then
      if [ -e "$acc" ] && [ ! -d "$acc" ]; then
        die "[$APP_ID] 커밋 대상 경로의 중간이 폴더가 아닙니다: ${acc} — 밀지 않았습니다"
      fi
    elif [ -e "$acc" ] && [ ! -f "$acc" ]; then
      die "[$APP_ID] 커밋 대상이 보통 파일이 아닙니다: ${acc} — 밀지 않았습니다"
    fi

    # git 이 그 칸을 링크로 기록해 뒀는가(경로가 정확히 그것인 항목만 본다)
    mode="$(git ls-files -s -- "$acc" 2>/dev/null | awk -F'\t' -v p="$acc" '$2 == p { split($1, a, " "); print a[1]; exit }')"
    if [ "$mode" = "120000" ]; then
      die "[$APP_ID] 기준 커밋이 그 자리를 심볼릭 링크로 담고 있습니다: ${acc} — 밀지 않았습니다"
    fi
  done
}

checkout_base() {
  if git checkout -q --detach "$BASE_SHA" 2>/dev/null; then return 0; fi
  if [ "$(git rev-parse --is-shallow-repository)" = "true" ]; then
    echo "propagate[$APP_ID]: ${BASE_SHA:0:7} 이 얕은 클론에 없습니다 — 더 깊이 받습니다" >&2
    git_masked fetch -q --deepen=200 origin main || true
    if git checkout -q --detach "$BASE_SHA" 2>/dev/null; then return 0; fi
  fi
  die "[$APP_ID] 준비 단계가 본 커밋 ${BASE_SHA:0:7} 을 앱 저장소에서 찾지 못했습니다 — main 이 되감겼거나 강제 푸시가 있었습니다"
}

run_push() {
  load_app
  WORK_PARENT="$(work_parent)"
  OUT="$(out_dir)"
  META="$OUT/meta.json"
  [ -f "$META" ] || usage "[$APP_ID] 산출물이 없습니다: ${META} — 준비 단계의 artifact 를 내려받았는지 보세요"

  META_APP="$(meta_field app)" || die "[$APP_ID] 산출물 meta.json 을 읽지 못했습니다: $META"
  [ "$META_APP" = "$APP_ID" ] || die "[$APP_ID] 산출물이 다른 앱 것입니다: '${META_APP}'"
  RESULT="$(meta_field result)"
  case "$RESULT" in
    prepared) ;;
    skipped-same|skipped-not-descendant)
      echo "propagate[$APP_ID]: 준비 단계가 ${RESULT} 로 끝났습니다 — 밀 것이 없습니다"
      out result "$RESULT"
      exit 0
      ;;
    # 준비 단계가 죽었다(2차 리뷰 F1). 준비 job 은 알림을 보내지 않으므로 **여기서 빨갛게 끝내야**
    # 사람이 안다 — 이 job 의 「실패 알림」이 유일한 알림 지점이고, 그 문구에 이 사유가 들어간다.
    failed)
      out result failed
      die "[$APP_ID] 준비 단계가 실패했습니다: $(meta_field error)"
      ;;
    *) die "[$APP_ID] 산출물의 result 를 모르겠습니다: '${RESULT}'" ;;
  esac

  BASE_SHA="$(meta_field baseSha)"
  PIN_TO="$(meta_field pinTo)"
  PIN_FROM="$(meta_field pinFrom)"
  SUBJECT="$(meta_field subject)"
  [[ "$BASE_SHA" =~ ^[0-9a-f]{40}$ ]] || die "[$APP_ID] 산출물의 baseSha 가 40자리 SHA 가 아닙니다: '${BASE_SHA}'"
  [[ "$PIN_TO" =~ ^[0-9a-f]{40}$ ]] || die "[$APP_ID] 산출물의 pinTo 가 40자리 SHA 가 아닙니다: '${PIN_TO}'"
  [[ "$PIN_FROM" =~ ^[0-9a-f]{40}$ ]] || die "[$APP_ID] 산출물의 pinFrom 이 40자리 SHA 가 아닙니다: '${PIN_FROM}'"
  [ -n "$SUBJECT" ] || SUBJECT="(제목 없음)"

  # ★산출물이 말하는 SHA 를 그대로 믿지 않는다(2026-09-08 2차 리뷰 F3 · P1).
  #  산출물은 앱 코드가 돈 실행기에서 온 **믿을 수 없는 입력**이다. 이 자리가 믿는 것은
  #  `resolve` 가 정한 `PROPAGATE_SHA` 하나뿐이고, 산출물은 거기에 맞는지로만 판정한다.
  SHA="${PROPAGATE_SHA:-}"
  [[ "$SHA" =~ ^[0-9a-f]{40}$ ]] || usage "PROPAGATE_SHA(resolve 가 정한 커밋) 가 40자리 SHA 여야 합니다 (받은 값: '${SHA}')"
  [ -d "${PROPAGATE_PACKAGE_DIR:-}" ] || usage "PROPAGATE_PACKAGE_DIR(패키지 저장소 경로) 가 필요합니다 — 핀이 앞으로만 가는지 여기서 다시 봅니다"
  [ "$PIN_TO" = "$SHA" ] \
    || die "[$APP_ID] 산출물이 다른 커밋을 가리킵니다: 산출물 ${PIN_TO:0:7} ≠ 이번 반영 ${SHA:0:7} — 밀지 않았습니다"

  # 실행기의 전역·시스템 git 설정도 믿지 않는다(리뷰 R2) — 이 자리는 토큰을 쥐고 있다.
  export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
  # 그리고 **저장소 설정도** 눌러 둔다(2차 리뷰 F2). 이 자리에서 도는 git 은 남이 심어 둘 수 있는
  # 자격 도우미·갈고리·대리 서버·ssh 명령을 하나도 쓰지 않아야 한다.
  #   credential.helper=  (빈 값 = 지금까지 쌓인 도우미 목록을 초기화) · core.hooksPath=/dev/null
  #   http.proxy=         (대리 서버로 토큰이 새 나가지 않게)        · core.sshCommand=false(늘 실패)
  # ★로컬 경로 원격에서도 안전하다: git 은 자기가 띄우는 upload-pack·receive-pack 에게
  #   `GIT_CONFIG_COUNT` 를 물려주지 않는다(local_repo_env). 그래서 시험의 서버 쪽 갈고리는 그대로 돈다.
  export GIT_CONFIG_COUNT=4
  export GIT_CONFIG_KEY_0="credential.helper" GIT_CONFIG_VALUE_0=""
  export GIT_CONFIG_KEY_1="core.hooksPath" GIT_CONFIG_VALUE_1="/dev/null"
  export GIT_CONFIG_KEY_2="http.proxy" GIT_CONFIG_VALUE_2=""
  export GIT_CONFIG_KEY_3="core.sshCommand" GIT_CONFIG_VALUE_3="false"

  WORK="$WORK_PARENT/push-$APP_ID"
  clone_app "$WORK"
  cd "$WORK"
  git config user.name "$BOT_NAME"
  git config user.email "$BOT_EMAIL"
  checkout_base

  # 기준 커밋 **그 자리의 실제 핀**을 읽어 산출물이 말한 pinFrom 과 맞춰 본다(2차 리뷰 F3).
  # 산출물이 「어디서 어디로」를 스스로 정하지 못하게 하는 자리다.
  read_current_pin
  [ "$CURRENT" = "$PIN_FROM" ] \
    || die "[$APP_ID] 기준 커밋의 핀이 산출물과 다릅니다: 저장소 ${CURRENT:0:7} ≠ 산출물 ${PIN_FROM:0:7} — 밀지 않았습니다"
  if ! git -C "$PROPAGATE_PACKAGE_DIR" merge-base --is-ancestor "$PIN_FROM" "$SHA" 2>/dev/null; then
    die "[$APP_ID] 지금 핀 ${PIN_FROM:0:7} 이 이번 커밋 ${SHA:0:7} 의 조상이 아닙니다 — 핀이 뒤로 갈 수 있어 밀지 않았습니다"
  fi

  # 산출물을 얹기 **전에** 기준 파일을 따로 뜬다 — verify-artifact 가 「기준 + 핀 한 줄」과 대조한다.
  BASE_FILES="$WORK_PARENT/base-$APP_ID"
  rm -rf "$BASE_FILES"
  mkdir -p "$BASE_FILES"
  for P in ${COMMIT_PATHS[@]+"${COMMIT_PATHS[@]}"}; do
    if git cat-file -e "HEAD:$P" 2>/dev/null; then
      mkdir -p "$BASE_FILES/$(dirname "$P")"
      git show "HEAD:$P" > "$BASE_FILES/$P"
    fi
  done

  for P in ${COMMIT_PATHS[@]+"${COMMIT_PATHS[@]}"}; do
    [ -f "$OUT/$P" ] || die "[$APP_ID] 산출물에 파일이 없습니다: ${P}"
    assert_plain_commit_path "$P"
    mkdir -p "$(dirname "$P")"
    # `rm -f` 먼저: 그 자리가 심볼릭 링크면 `cp` 가 **링크를 따라가** 엉뚱한 파일을 덮어쓴다.
    # (위 검사가 이미 링크를 막지만, 덮어쓰기 자체도 링크를 따라가지 않게 해 둔다.)
    rm -f "$P"
    cp "$OUT/$P" "$P"
  done

  # 대조 기준은 산출물의 pinTo 가 아니라 **resolve 가 정한 SHA** 다.
  node "$PROPAGATE_HERE/verify-lock.mjs" . "$SHA" \
    || die "[$APP_ID] 산출물의 핀·잠금 파일이 어긋납니다(위 verify-lock 줄 참고) — 밀지 않았습니다"

  # verify-lock 은 「핀이 새 SHA 인가」만 본다. 허용된 파일 **안의 임의 변경**(postinstall 끼워 넣기,
  # resolved 를 남의 주소로 바꾸기, 잠금 파일에 모르는 꾸러미 더하기)은 이 대조기가 막는다(2차 리뷰 F4).
  node "$PROPAGATE_HERE/verify-artifact.mjs" "$BASE_FILES" "$OUT" "$SHA" ${COMMIT_PATHS[@]+"${COMMIT_PATHS[@]}"} \
    || die "[$APP_ID] 산출물이 「기준 파일에서 핀만 바뀐 것」이 아닙니다(위 verify-artifact 줄 참고) — 밀지 않았습니다"

  git add -- ${COMMIT_PATHS[@]+"${COMMIT_PATHS[@]}"} \
    || die "[$APP_ID] 커밋할 파일을 담지 못했습니다: ${COMMIT_PATHS[*]}"
  if git diff --cached --quiet; then
    die "[$APP_ID] 바뀐 것이 없습니다(핀은 바뀌었는데 diff 가 비어 있음)"
  fi
  git commit -q -m "chore(정책매칭 공용): 핀 ${SHA:0:7} — ${SUBJECT}" -m "패키지 커밋: ${PROPAGATE_PACKAGE_URL:-}
자동 반영 실행: ${PROPAGATE_RUN_URL:-}
(propagate.yml 이 만든 커밋 — 손으로 되돌리지 말고 패키지 쪽을 revert 한다)" \
    || die "[$APP_ID] 커밋 실패"

  if [ "${PROPAGATE_DRY_RUN:-0}" = "1" ]; then
    echo "propagate[$APP_ID]: DRY RUN — 푸시하지 않음"
    git --no-pager show --stat --format='%H %s' HEAD
    out result dry-run
    exit 0
  fi

  TRIES="${PROPAGATE_MAX_PUSH_TRIES:-3}"
  I=1
  while [ "$I" -le "$TRIES" ]; do
    if git_masked push -q origin HEAD:main; then
      out result updated
      out commit "$(git rev-parse HEAD)"
      echo "propagate[$APP_ID]: 푸시 완료 (${I}회차)"
      exit 0
    fi
    echo "propagate[$APP_ID]: 푸시 거부 (${I}/${TRIES}) — origin/main 위로 다시 얹습니다" >&2
    # 원격 추적 가지를 확실히 갱신하려고 refspec 을 명시한다(`git fetch origin main` 만으로는 git 판에 따라 안 옮겨진다)
    git_masked fetch -q origin "+refs/heads/main:refs/remotes/origin/main" \
      || die "[$APP_ID] fetch 실패 — 위 오류를 보세요"
    if ! git rebase -q origin/main; then
      git rebase --abort || true
      die "[$APP_ID] rebase 충돌 — 사람이 같은 파일을 같은 순간에 바꿨습니다. 손으로 핀을 맞춘 뒤 다시 돌리세요"
    fi
    I=$((I + 1))
  done
  die "[$APP_ID] ${TRIES}회 시도 후 푸시 실패"
}

case "$STEP" in
  clone) run_clone ;;
  prepare) run_prepare ;;
  push) run_push ;;
  "") usage "단계를 지정하세요: propagate.sh <clone|prepare|push>" ;;
  *) usage "모르는 단계입니다: '${STEP}' (clone|prepare|push 중 하나)" ;;
esac
