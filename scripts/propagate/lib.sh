# scripts/propagate/lib.sh — clone·prepare·push 세 단계가 함께 쓰는 조각. `source` 로만 쓴다.
# 계획서: docs/superpowers/plans/2026-09-07-p5-propagate-bot.md (Task 3·5 · 2026-09-08 리뷰 R2)
#
# ★왜 단계가 셋인가(리뷰 R2 · P1):
#   한 프로세스가 「토큰을 쥐고」 + 「앱 코드를 돌리는」 일을 같이 하면 토큰을 못 지킨다.
#   `env -u PROPAGATE_TOKEN` 으로 자식에게서 지워도 (a) 같은 사용자면 부모 프로세스의 환경을 읽을 수 있고
#   (b) 앱 코드가 `$GIT_ASKPASS` 파일이나 `.git/config` 를 바꿔 **뒤에 오는 push 에서 토큰을 가로챌** 수 있다.
#   그래서 토큰이 있는 자리에서는 앱 코드를 **한 줄도** 돌리지 않게 일을 나눴다:
#     clone   — 토큰 있음. git clone 만 한다(npm·앱 스크립트 없음).
#     prepare — 토큰 없음. npm·앱 후처리를 여기서 전부 돌리고 결과 파일만 산출물 폴더에 담는다.
#     push    — 토큰 있음. 새로 깨끗하게 클론해 산출물 파일을 얹고 커밋·푸시만 한다(npm 없음).
#   GitHub Actions 에서는 clone/prepare 가 `prepare` job, push 가 `push` job 이고
#   그 사이는 artifact 로만 이어진다 — 두 job 은 다른 실행기에서 돈다.
#
# ★bash 3.2(맥 기본)에서도 돌아야 한다 — Actions 는 ubuntu(bash 5)지만 로컬 예행은 맥이다.
#   `mapfile` 을 쓰지 않고 while read 로 배열을 읽고, 빈 배열은 `${arr[@]+"${arr[@]}"}` 로 편다
#   (`set -u` 에서 빈 배열을 그냥 `"${arr[@]}"` 로 펴면 unbound variable 로 죽는다).

# 이 파일이 정하는 값(BOT_NAME·INSTALL 등)은 **이 파일을 source 한 propagate.sh** 가 쓴다.
# 검사기(shellcheck)는 파일 하나만 보므로 「안 쓰는 변수」로 오해한다 — 그래서 파일 전체에서 SC2034 를 끈다.
# shellcheck disable=SC2034

PROPAGATE_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APPS_JSON="$PROPAGATE_LIB_DIR/apps.json"
PKG_NAME="@wedly/policy-match-shared"
PKG_REPO="smlee-hash/wedly-policy-match-shared"
BOT_NAME="WEDLY 정책매칭 봇"
BOT_EMAIL="policy-bot@wedly.kr"

ASKPASS_FILE=""
STDERR_FILE=""

# ── JSON 은 「보고 나서 읽는다」(2026-09-08 3차 리뷰 G1 · P1) ──────────────────
# ★막는 사고: 옛 판은 앱의 package.json 을 `node -p "require('./package.json')…"` 로 읽었다.
#   node 의 `require` 는 그 이름의 파일이 없으면 **확장자를 붙여 가며 찾고, 찾으면 실행한다** —
#   기준 커밋에 `package.json` 이 없고 `package.json.js` 만 있으면 그 앱 코드가
#   **쓰기 토큰을 쥔 밀기 단계에서** 돌아 버린다(2026-09-08 실측으로 재현했다).
#   그래서 이 저장소의 어떤 단계도 파일을 `require` 로 읽지 않는다:
#     ① lstat 으로 **보통 파일**인지 먼저 보고(링크·폴더·장치는 거절) ② readFileSync ③ JSON.parse.
#   검사는 **읽기 전에** 한다 — 읽고 나서 보면 이미 늦다.
# ★이 글자는 node 가 쓰는 것이라 셸이 풀면 안 된다(작은따옴표).
# shellcheck disable=SC2016
PROPAGATE_JSON_READER='
  const fs = require("node:fs");
  const readJsonFile = (file) => {
    let st = null;
    try { st = fs.lstatSync(file); } catch (e) { throw new Error(file + " 이(가) 없습니다"); }
    if (!st.isFile()) throw new Error(file + " 이(가) 보통 파일이 아닙니다(링크·폴더는 읽지 않습니다)");
    return JSON.parse(fs.readFileSync(file, "utf8"));
  };
  const readJsonObject = (file) => {
    const v = readJsonFile(file);
    if (v === null || typeof v !== "object" || Array.isArray(v)) throw new Error(file + " 의 최상위가 개체가 아닙니다");
    return v;
  };
  const fail = (err) => {
    process.stderr.write("propagate: " + String(err && err.message ? err.message : err) + "\n");
    process.exit(4);
  };
'

# ── 실패도 산출물로 남긴다(2026-09-08 2차 리뷰 F1) ────────────────────────────
# 옛 판에서는 준비 job 이 실패하면 **그 job 이 직접** 슬랙 알림을 보냈다. 그 자리는 앱 코드가
# 이미 한 번 돈 실행기라 `notify.sh` 도, 그것이 읽는 열쇠도 앱 코드가 바꿔 놓을 수 있었다
# (= 변조한 notify.sh 로 WEDLY_NOTIFY_KEY 를 빼돌리는 길). 그래서 준비 job 에서 알림을 **없앴다.**
# 대신 준비 단계가 어떤 이유로 죽든 산출물 폴더에 `meta.json {result:"failed", error:"<한 줄 사유>"}`
# 를 남기고, 밀기 job 이 그것을 읽어 빨갛게 끝내며 **알림은 밀기 job 한 곳에서만** 보낸다.
FAIL_META_DIR=""   # 비어 있지 않으면 「0 이 아닌 종료 = meta.json(failed) 남기기」
LAST_ERROR=""      # die·usage 가 남긴 사람이 읽을 사유(한 줄로 줄여 meta 에 넣는다)

# meta.json 한 장을 쓴다. 인자: <파일> <result> [<error>]
# 값은 전부 환경(APP_ID·BASE_SHA·CURRENT·SHA)에서 가져오되 아직 없는 값은 빈 문자열로 둔다 —
# 실패는 어느 줄에서든 날 수 있어서, 「그때까지 알아낸 것」만 담긴다.
write_meta_file() {
  node -e '
    const [file, app, result, error, baseSha, pinFrom, pinTo, subject] = process.argv.slice(1);
    const meta = { app, result, baseSha, pinFrom, pinTo, subject };
    // 여러 줄 사유는 한 줄로 접는다 — 알림 한 줄(500자)에 그대로 들어가야 한다.
    if (result === "failed") meta.error = (error || "알 수 없는 오류").replace(/\s+/g, " ").trim().slice(0, 400);
    require("node:fs").writeFileSync(file, JSON.stringify(meta, null, 2) + "\n");
  ' "$1" "${APP_ID:-}" "$2" "${3:-}" "${BASE_SHA:-}" "${CURRENT:-}" "${SHA:-}" "${PROPAGATE_SUBJECT:-}"
}

# shellcheck disable=SC2329  # 아래 `trap on_exit EXIT` 이 부른다 — shellcheck 는 trap 안을 못 본다
cleanup() {
  [ -z "$ASKPASS_FILE" ] || rm -f "$ASKPASS_FILE"
  [ -z "$STDERR_FILE" ] || rm -f "$STDERR_FILE"
  return 0
}

# shellcheck disable=SC2329  # trap 이 부른다
on_exit() {
  local rc=$?
  if [ "$rc" -ne 0 ] && [ -n "$FAIL_META_DIR" ]; then
    mkdir -p "$FAIL_META_DIR" 2>/dev/null || true
    write_meta_file "$FAIL_META_DIR/meta.json" failed \
      "${LAST_ERROR:-알 수 없는 오류(종료 코드 ${rc}) — 준비 단계 실행 로그를 보세요}" 2>/dev/null || true
  fi
  cleanup
  # `return` 은 종료 코드를 바꾸지 않는다(bash 3.2·5 실측) — 죽은 이유가 그대로 밖으로 나간다.
  return 0
}
trap on_exit EXIT

die() { LAST_ERROR="$*"; echo "propagate: $*" >&2; exit 1; }
usage() { LAST_ERROR="$*"; echo "propagate: $*" >&2; exit 2; }

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

app_field() {
  node -e "$PROPAGATE_JSON_READER"'
    try {
      // 우리 저장소의 apps.json 도 같은 길로 읽는다 — 「어떤 파일도 require 로 열지 않는다」를 한 규칙으로.
      const apps = readJsonFile(process.argv[1]);
      if (!Array.isArray(apps)) throw new Error(process.argv[1] + " 이(가) 앱 목록(배열)이 아닙니다");
      const a = apps.find((x) => x && typeof x === "object" && x.id === process.argv[2]);
      if (!a) process.exit(3);
      const v = a[process.argv[3]];
      // 배열은 한 줄에 하나씩 — 빈 배열이면 아무것도 안 찍히므로 while read 가 0개를 읽는다
      if (Array.isArray(v)) { for (const item of v) process.stdout.write(String(item) + "\n"); }
      else process.stdout.write(String(v) + "\n");
    } catch (err) { fail(err); }
  ' "$APPS_JSON" "$APP_ID" "$1"
}

# apps.json 에서 이 앱의 정의를 읽어 REPO·INSTALL·POST_STEPS·COMMIT_PATHS 를 채운다.
load_app() {
  [ -n "${APP_ID:-}" ] || usage "PROPAGATE_APP_ID 가 비었습니다"
  REPO="$(app_field repo)" || usage "apps.json 에 없는 앱이거나 apps.json 을 읽지 못했습니다: ${APP_ID} (쓸 수 있는 값은 apps.json 을 보세요)"
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
}

# 클론·푸시가 함께 쓰는 작업 폴더의 부모.
# ★단계마다 **한 번만** 부르고 그 값을 `WORK_PARENT` 에 담아 쓴다 — 아무 설정도 없을 때 이 함수는
#  `mktemp -d` 로 새 폴더를 만들므로, 두 번 부르면 클론과 산출물이 서로 다른 자리에 앉는다.
work_parent() {
  local parent="${PROPAGATE_WORKDIR:-${RUNNER_TEMP:-}}"
  if [ -z "$parent" ]; then parent="$(mktemp -d)"; fi
  mkdir -p "$parent"
  printf '%s' "$parent"
}

# 산출물 폴더(prepare 가 담고 push 가 읽는다)
out_dir() {
  if [ -n "${PROPAGATE_OUT:-}" ]; then printf '%s' "$PROPAGATE_OUT"; return 0; fi
  printf '%s/out-%s' "${WORK_PARENT:-$(work_parent)}" "$APP_ID"
}

# 토큰으로 클론할 준비 — 토큰을 **주소에 넣지 않는다.**
#   주소에 넣으면 (a) 클론의 `.git/config` 에 그대로 저장되고 (b) `ps` 의 명령줄에 보이고
#   (c) git 이 가리개(sed)가 못 잡는 모양으로 주소를 찍으면 로그에 샌다.
#   그래서 주소는 `https://x-access-token@github.com/...` 로 두고 비밀번호는 GIT_ASKPASS 도우미가
#   부를 때 환경변수에서 읽어 git 에게만 넘긴다(도우미 파일에도 값을 적지 않는다).
prepare_clone_url() {
  CLONE_URL="${PROPAGATE_CLONE_URL:-}"
  USING_TOKEN=0
  if [ -z "$CLONE_URL" ]; then
    [ -n "${PROPAGATE_TOKEN:-}" ] || usage "PROPAGATE_TOKEN 또는 PROPAGATE_CLONE_URL 이 필요합니다"
    CLONE_URL="https://x-access-token@github.com/${REPO}.git"
    USING_TOKEN=1
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
}

# 클론한 자리에 자격이 남지 않았는지 본다(리뷰 R2).
# 남아 있으면 **다음 단계가 그 자격을 쥐게 되므로** 즉시 실패한다.
assert_no_credentials() {
  local dir="$1" config="$1/.git/config"
  if [ -f "$config" ]; then
    if [ -n "${PROPAGATE_TOKEN:-}" ] && grep -qF -- "$PROPAGATE_TOKEN" "$config"; then
      die "[$APP_ID] 클론의 .git/config 에 토큰이 남았습니다 — 밀지 않았습니다"
    fi
    if grep -qE '://[^/@[:space:]]*:[^@/[:space:]]*@' "$config"; then
      die "[$APP_ID] 클론의 .git/config 주소에 자격이 섞여 있습니다 — 밀지 않았습니다"
    fi
  fi
  [ ! -f "$dir/.git/credentials" ] || die "[$APP_ID] 클론에 .git/credentials 가 생겼습니다 — 밀지 않았습니다"
}

# 앱 저장소를 <dir> 에 새로 클론한다(main, depth 50).
clone_app() {
  local dir="$1"
  STDERR_FILE="$(mktemp "${TMPDIR:-/tmp}/propagate-stderr.XXXXXX")"
  prepare_clone_url
  rm -rf "$dir"
  echo "propagate[$APP_ID]: ${REPO} 클론 (main, depth 50)"
  git_masked clone -q --depth 50 --single-branch --branch main "$CLONE_URL" "$dir" \
    || die "[$APP_ID] 클론 실패 — 위 오류를 보세요(주소·토큰은 가려서 찍습니다)"
  assert_no_credentials "$dir"
}

# 이 클론을 **앱 코드에게 넘기기 전에** 자격을 걷어낸다(clone 단계 전용 · 리뷰 R2).
#   - GIT_ASKPASS 도우미 파일을 지우고 환경변수도 푼다(뒤에 오는 앱 코드가 그 파일을 바꿔치기 못 하게)
#   - 원격 주소에서 사용자 이름까지 지운다 — 준비 단계는 이 클론으로 아무 데도 접속하지 않는다
# push 단계는 이것을 부르지 않는다: 같은 프로세스가 곧바로 밀어야 하므로 자격이 필요하다.
disarm_credentials() {
  local dir="$1"
  if [ "${USING_TOKEN:-0}" = "1" ]; then
    git -C "$dir" remote set-url origin "https://github.com/${REPO}.git"
  fi
  if [ -n "$ASKPASS_FILE" ]; then
    rm -f "$ASKPASS_FILE"
    ASKPASS_FILE=""
  fi
  unset GIT_ASKPASS
  assert_no_credentials "$dir"
}

# 현재 핀(`github:<repo>#<sha40>`)을 읽어 CURRENT_SPEC·CURRENT 에 채운다.
read_current_pin() {
  # ★`require('./package.json')` 를 쓰지 않는다(3차 리뷰 G1) — 위 PROPAGATE_JSON_READER 주석 참고.
  #  이 함수는 **밀기 단계**(쓰기 토큰을 쥔 자리)에서도 불린다. 여기서 앱 파일이 한 줄이라도 실행되면
  #  토큰을 지키려고 job 을 둘로 나눈 것이 통째로 무의미해진다.
  CURRENT_SPEC="$(node -e "$PROPAGATE_JSON_READER"'
    try {
      const pkg = readJsonObject(process.argv[1]);
      const deps = pkg.dependencies;
      const spec = deps && typeof deps === "object" && !Array.isArray(deps) ? deps[process.argv[2]] : "";
      process.stdout.write(typeof spec === "string" ? spec : "");
    } catch (err) { fail(err); }
  ' "package.json" "$PKG_NAME")" \
    || die "[$APP_ID] package.json 을 읽지 못했습니다 — 앱 저장소가 예상과 다릅니다"
  CURRENT="${CURRENT_SPEC##*#}"
  if [ "$CURRENT_SPEC" = "github:${PKG_REPO}#${CURRENT}" ] && [[ "$CURRENT" =~ ^[0-9a-f]{40}$ ]]; then
    return 0
  fi
  die "[$APP_ID] 현재 핀 형식이 예상과 다릅니다: '${CURRENT_SPEC}' — 사람이 봐야 합니다"
}
