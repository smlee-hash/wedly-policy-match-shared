#!/usr/bin/env bash
# scripts/propagate/propagate.sh — 앱 1곳의 @wedly/policy-match-shared 핀을 새 SHA 로 올려 커밋·푸시한다.
# 계획서: docs/superpowers/plans/2026-09-07-p5-propagate-bot.md (Task 3)
#
# 입력은 환경변수만 받는다(워크플로우와 시험이 같은 방식으로 부른다).
# 종료 코드: 0 = 반영했거나 일부러 건너뜀 · 1 = 실패(사람이 봐야 함) · 2 = 입력 오류.
# GITHUB_OUTPUT 이 있으면 result=<updated|skipped-same|skipped-not-descendant|dry-run> 와 commit=<sha> 를 적는다.
#
# ★토큰 다루는 방식 — 계획서 초안에서 바꾼 곳(더 안전한 쪽을 골랐다):
#   초안은 `https://x-access-token:<토큰>@github.com/...` 주소를 만들고 git 의 stderr 만 sed 로 가렸다.
#   그러면 토큰이 (a) 클론의 `.git/config` 에 그대로 저장되고, (b) `ps` 의 명령줄에 보이고,
#   (c) git 이 sed 가 못 잡는 모양으로 주소를 찍으면 로그에 샌다 — 가리개 하나에 전부 기대는 구조다.
#   그래서 **토큰을 주소에 넣지 않는다**: 주소는 `https://x-access-token@github.com/...` 로 두고
#   비밀번호는 GIT_ASKPASS 도우미가 부를 때 환경변수에서 읽어 넘긴다(도우미 파일에도 값을 적지 않는다).
#   sed 가리개는 없애지 않고 남긴다 — 부르는 쪽이 PROPAGATE_CLONE_URL 에 자격을 박아 넘긴 경우의 안전망.
#   npm·후처리 명령은 `env -u PROPAGATE_TOKEN` 으로 불러 앱 저장소 코드가 토큰을 보지 못하게 한다.
#
# ★bash 3.2(맥 기본)에서도 돌아야 한다 — Actions 는 ubuntu(bash 5)지만 로컬 예행은 맥이다.
#   그래서 `mapfile` 을 쓰지 않고 while read 로 배열을 읽고, 빈 배열은 `${arr[@]+"${arr[@]}"}` 로 편다
#   (`set -u` 에서 빈 배열을 그냥 `"${arr[@]}"` 로 펴면 unbound variable 로 죽는다).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APPS_JSON="$HERE/apps.json"
PKG_NAME="@wedly/policy-match-shared"
PKG_REPO="smlee-hash/wedly-policy-match-shared"
BOT_NAME="WEDLY 정책매칭 봇"
BOT_EMAIL="policy-bot@wedly.kr"

ASKPASS_FILE=""
STDERR_FILE=""

cleanup() {
  [ -z "$ASKPASS_FILE" ] || rm -f "$ASKPASS_FILE"
  [ -z "$STDERR_FILE" ] || rm -f "$STDERR_FILE"
  return 0
}
trap cleanup EXIT

die() { echo "propagate: $*" >&2; exit 1; }
usage() { echo "propagate: $*" >&2; exit 2; }

# GITHUB_OUTPUT 이 없어도 반드시 0 으로 끝나야 한다 —
# `[ -n "$X" ] && echo ...` 로 쓰면 변수가 없을 때 함수가 1 을 돌려주고 set -e 가 스크립트를 죽인다.
out() {
  if [ -n "${GITHUB_OUTPUT:-}" ]; then printf '%s=%s\n' "$1" "$2" >> "$GITHUB_OUTPUT"; fi
  printf 'propagate: %s=%s\n' "$1" "$2"
}

# 주소에 섞인 자격(`//사용자:비밀번호@`)을 가린다. 토큰 값 자체는 무늬로 쓰지 않는다(명령줄에 남으니까).
mask() { sed -e 's#//[^/@:]*:[^@/]*@#//***:***@#g'; }

# git 을 부르되 stderr 를 받아 가린 뒤 내보낸다(임시 파일 — 프로세스 치환은 순서가 어긋날 수 있다).
git_masked() {
  local rc=0
  git "$@" 2> "$STDERR_FILE" || rc=$?
  if [ -s "$STDERR_FILE" ]; then mask < "$STDERR_FILE" >&2; fi
  : > "$STDERR_FILE"
  return "$rc"
}

# ── 1. 입력 검사 ────────────────────────────────────────────────────────────
APP_ID="${PROPAGATE_APP_ID:-}"
SHA="${PROPAGATE_SHA:-}"
[[ "$SHA" =~ ^[0-9a-f]{40}$ ]] || usage "PROPAGATE_SHA 는 40자리 SHA 여야 합니다 (받은 값: '${SHA}')"
[ -n "$APP_ID" ] || usage "PROPAGATE_APP_ID 가 비었습니다"
[ -d "${PROPAGATE_PACKAGE_DIR:-}" ] || usage "PROPAGATE_PACKAGE_DIR(패키지 저장소 경로) 가 필요합니다"

app_field() {
  node -e '
    const apps = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    const a = apps.find((x) => x.id === process.argv[2]);
    if (!a) process.exit(3);
    const v = a[process.argv[3]];
    // 배열은 한 줄에 하나씩 — 빈 배열이면 아무것도 안 찍히므로 while read 가 0개를 읽는다
    if (Array.isArray(v)) { for (const item of v) process.stdout.write(String(item) + "\n"); }
    else process.stdout.write(String(v) + "\n");
  ' "$APPS_JSON" "$APP_ID" "$1"
}

REPO="$(app_field repo)" || usage "apps.json 에 없는 앱입니다: ${APP_ID} (쓸 수 있는 값은 apps.json 을 보세요)"
INSTALL="$(app_field install)"

POST_STEPS=()
while IFS= read -r LINE; do
  [ -n "$LINE" ] || continue
  POST_STEPS+=("$LINE")
done < <(app_field postSteps)

COMMIT_PATHS=()
while IFS= read -r LINE; do
  [ -n "$LINE" ] || continue
  COMMIT_PATHS+=("$LINE")
done < <(app_field commitPaths)
[ "${#COMMIT_PATHS[@]}" -gt 0 ] || die "[$APP_ID] apps.json 의 commitPaths 가 비었습니다"

# ── 2. 클론 ────────────────────────────────────────────────────────────────
WORK_PARENT="${PROPAGATE_WORKDIR:-${RUNNER_TEMP:-$(mktemp -d)}}"
mkdir -p "$WORK_PARENT"
STDERR_FILE="$(mktemp "${TMPDIR:-/tmp}/propagate-stderr.XXXXXX")"

CLONE_URL="${PROPAGATE_CLONE_URL:-}"
if [ -z "$CLONE_URL" ]; then
  [ -n "${PROPAGATE_TOKEN:-}" ] || usage "PROPAGATE_TOKEN 또는 PROPAGATE_CLONE_URL 이 필요합니다"
  # 토큰은 주소에 넣지 않는다. 사용자 이름만 넣고 비밀번호는 아래 도우미가 넘긴다.
  CLONE_URL="https://x-access-token@github.com/${REPO}.git"
  ASKPASS_FILE="$(mktemp "${TMPDIR:-/tmp}/propagate-askpass.XXXXXX")"
  cat > "$ASKPASS_FILE" <<'ASKPASS'
#!/usr/bin/env bash
# 토큰 값은 이 파일에 적지 않는다 — 부를 때 환경변수에서 읽어 git 에게만 넘긴다.
printf '%s\n' "${PROPAGATE_TOKEN:-}"
ASKPASS
  chmod 700 "$ASKPASS_FILE"
  export PROPAGATE_TOKEN GIT_ASKPASS="$ASKPASS_FILE"
fi
export GIT_TERMINAL_PROMPT=0  # 자격이 없을 때 실행기가 입력을 기다리며 멈추지 않게

WORK="$WORK_PARENT/$APP_ID"
rm -rf "$WORK"
echo "propagate[$APP_ID]: ${REPO} 클론 (main, depth 50)"
git_masked clone -q --depth 50 --single-branch --branch main "$CLONE_URL" "$WORK" \
  || die "[$APP_ID] 클론 실패 — 위 오류를 보세요(주소·토큰은 가려서 찍습니다)"
cd "$WORK"
git config user.name "$BOT_NAME"
git config user.email "$BOT_EMAIL"

# ── 3. 현재 핀 읽기 ─────────────────────────────────────────────────────────
CURRENT_SPEC="$(node -p "require('./package.json').dependencies['$PKG_NAME'] || ''")" \
  || die "[$APP_ID] package.json 을 읽지 못했습니다 — 앱 저장소가 예상과 다릅니다"
CURRENT="${CURRENT_SPEC##*#}"
if [ "$CURRENT_SPEC" = "github:${PKG_REPO}#${CURRENT}" ] && [[ "$CURRENT" =~ ^[0-9a-f]{40}$ ]]; then
  :
else
  die "[$APP_ID] 현재 핀 형식이 예상과 다릅니다: '${CURRENT_SPEC}' — 사람이 봐야 합니다"
fi

# ── 4. 같은 SHA·후손 검사(핀이 뒤로 가지 않게) ──────────────────────────────
if [ "$CURRENT" = "$SHA" ]; then
  echo "propagate[$APP_ID]: 이미 ${SHA} — 건너뜀"
  out result skipped-same
  exit 0
fi
if ! git -C "$PROPAGATE_PACKAGE_DIR" cat-file -e "${CURRENT}^{commit}" 2>/dev/null; then
  echo "propagate[$APP_ID]: 현재 핀 ${CURRENT:0:7} 을 패키지 저장소에서 찾지 못함 — 뒤로 가지 않으려고 건너뜀" >&2
  out result skipped-not-descendant
  exit 0
fi
if ! git -C "$PROPAGATE_PACKAGE_DIR" merge-base --is-ancestor "$CURRENT" "$SHA" 2>/dev/null; then
  echo "propagate[$APP_ID]: 현재 핀 ${CURRENT:0:7} 이 새 SHA ${SHA:0:7} 의 조상이 아님 — 뒤로 가지 않으려고 건너뜀" >&2
  out result skipped-not-descendant
  exit 0
fi

# ── 5. 핀 갱신 ─────────────────────────────────────────────────────────────
echo "propagate[$APP_ID]: 핀 ${CURRENT:0:7} → ${SHA:0:7}"
env -u PROPAGATE_TOKEN npm pkg set "dependencies.${PKG_NAME}=github:${PKG_REPO}#${SHA}" \
  || die "[$APP_ID] 핀 쓰기(npm pkg set) 실패"
env -u PROPAGATE_TOKEN npm install --package-lock-only --ignore-scripts --no-audit --no-fund \
  || die "[$APP_ID] 잠금 파일 갱신(npm install --package-lock-only) 실패 — 새 SHA 를 아직 GitHub 에서 받을 수 없거나(밀기 전) 네트워크·인증 문제입니다"

VERIFY_FLAGS=()
if [ "$INSTALL" = "true" ]; then
  env -u PROPAGATE_TOKEN npm ci --ignore-scripts --no-audit --no-fund \
    || die "[$APP_ID] 설치(npm ci) 실패 — 잠금 파일과 창고가 맞지 않거나 내려받기가 막혔습니다"
  VERIFY_FLAGS=(--installed)
fi

for STEP in ${POST_STEPS[@]+"${POST_STEPS[@]}"}; do
  echo "propagate[$APP_ID]: $STEP"
  env -u PROPAGATE_TOKEN bash -c "$STEP" || die "[$APP_ID] 후처리 실패: $STEP"
done

node "$HERE/verify-lock.mjs" . "$SHA" ${VERIFY_FLAGS[@]+"${VERIFY_FLAGS[@]}"} \
  || die "[$APP_ID] 핀·잠금 파일이 어긋납니다(위 verify-lock 줄 참고) — 밀지 않았습니다"

# ── 6. 커밋 대상 밖 변경 검사 ───────────────────────────────────────────────
# `.gitignore` 에 걸린 파일(node_modules 등)은 애초에 나오지 않는다. 나오는 것만 본다.
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

# ── 7. 커밋 ────────────────────────────────────────────────────────────────
# 없는 파일이 commitPaths 에 있으면 git 은 128 로 죽는다 — 규격(0/1/2)대로 1 로 바꾸고 무엇이 없는지 알린다.
# (실제로 나는 경우: ERP 후처리가 설계 등록부를 못 만들었는데 verify-lock 은 등록부를 보지 않는다)
git add -- ${COMMIT_PATHS[@]+"${COMMIT_PATHS[@]}"} \
  || die "[$APP_ID] 커밋할 파일을 담지 못했습니다 — apps.json 의 commitPaths 중 없는 파일이 있습니다: ${COMMIT_PATHS[*]}"
if git diff --cached --quiet; then
  die "[$APP_ID] 바뀐 것이 없습니다(핀은 바뀌었는데 diff 가 비어 있음)"
fi
SUBJECT="${PROPAGATE_SUBJECT:-(제목 없음)}"
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

# ── 8. 푸시(경합하면 origin/main 위로 다시 얹어 재시도) ─────────────────────
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
