#!/usr/bin/env bash
# scripts/propagate/notify.sh <제목> <주소> [줄...] — 자동 반영 실패를 슬랙에 알린다.
# 계획서: docs/superpowers/plans/2026-09-07-p5-propagate-bot.md (Task 4)
#
# 어디로 보내나: ERP 내부 통로 `POST {WEDLY_NOTIFY_URL}/api/internal/policy-lab/notify`
#   헤더 `x-internal-key: {WEDLY_NOTIFY_KEY}` · 본문 `{kind:"status", title, lines[, url]}`.
#   실제 슬랙 발송은 ERP 가 한다(이 저장소는 슬랙 토큰을 갖지 않는다). 방은 ERP 서버 변수가 정한다.
#
# ★종료 코드는 언제나 0 이다. 알림이 안 갔다고 워크플로우를 한 번 더 빨갛게 만들지 않는다 —
#  실패한 실행은 이미 빨간색이고 GitHub 가 실패 메일을 보낸다(계획서 총괄 결정 5).
# ★설정(주소·열쇠) 둘 중 하나라도 없으면 아무것도 하지 않고 「설정 없음」만 찍는다.
#   그래서 시크릿을 아직 안 넣은 저장소에서도 워크플로우가 이 단계 때문에 깨지지 않는다.
# ★열쇠는 화면에 찍지 않는다(`set -x` 금지). curl 도 헤더를 되찍지 않게 `-o /dev/null` 로 몸통을 버리고
#   http 코드만 받는다.
set -uo pipefail

NOTIFY_PATH="/api/internal/policy-lab/notify"
TRIES=3
# 계획서 규격: 30초 간격 3회(ERP 배포창 동안 502·503 이 나는 것을 넘기려는 값).
# 시험만 0 으로 줄인다 — 시험이 60초를 자게 두면 아무도 그 시험을 돌리지 않는다.
RETRY_SLEEP="${WEDLY_NOTIFY_RETRY_SLEEP:-30}"
# 제목이 비면 ERP 가 400(`title` 은 1자 이상)으로 거절하고, 이 스크립트는 항상 0 이라
# 알림만 조용히 사라진다. 그래서 빈 제목은 여기서 메운다.
DEFAULT_TITLE="정책매칭 공용 자동 반영 알림"

TITLE="${1:-}"
URL="${2:-}"
# `shift 2` 는 인자가 2개 미만이면 실패하고 **인자를 그대로 남긴다** — 그러면 제목이 줄에 한 번 더 들어간다
# (2026-09-08 bash 3.2 실측). 그래서 개수를 보고 나눈다.
if [ "$#" -gt 2 ]; then shift 2; else set --; fi

if [ -z "${WEDLY_NOTIFY_URL:-}" ] || [ -z "${WEDLY_NOTIFY_KEY:-}" ]; then
  echo "notify: 설정 없음(WEDLY_NOTIFY_URL·WEDLY_NOTIFY_KEY) — 알림을 건너뜁니다"
  exit 0
fi

# 본문은 node 가 만든다 — 글자 수 자르기와 JSON 이스케이프를 셸에서 하면 반드시 어긋난다.
# ERP 통로는 `.strict()` 라 모르는 칸이 하나만 있어도 400 이다: kind·title·lines(·url) 만 넣는다.
BODY="$(
  NOTIFY_DEFAULT_TITLE="$DEFAULT_TITLE" node -e '
    const [title, url, ...lines] = process.argv.slice(1);
    const body = {
      kind: "status",
      title: (title || process.env.NOTIFY_DEFAULT_TITLE || "알림").slice(0, 200),
      lines: lines.filter((l) => l !== "").slice(0, 10).map((l) => l.slice(0, 500)),
    };
    // ERP 는 http/https 주소만 받는다(javascript: 같은 것은 거절) — 아니면 아예 넣지 않는다.
    if (/^https?:\/\//.test(url)) body.url = url.slice(0, 2000);
    process.stdout.write(JSON.stringify(body));
  ' "$TITLE" "$URL" ${@+"$@"}
)" || {
  echo "notify: 알림 본문을 만들지 못했습니다 — 알림을 건너뜁니다" >&2
  exit 0
}

ENDPOINT="${WEDLY_NOTIFY_URL%/}${NOTIFY_PATH}"
I=1
while [ "$I" -le "$TRIES" ]; do
  # 연결 자체가 안 되면 curl 은 `000` 을 찍고 0 이 아닌 코드로 끝난다 — 둘 다 실패로 본다.
  CODE="$(
    curl -sS -o /dev/null -w '%{http_code}' -m 20 -X POST "$ENDPOINT" \
      -H 'content-type: application/json' \
      -H "x-internal-key: ${WEDLY_NOTIFY_KEY}" \
      --data "$BODY" || true
  )"
  CODE="${CODE:-000}"
  if [ "$CODE" = "200" ]; then
    echo "notify: 보냈습니다 (${I}회차)"
    exit 0
  fi
  echo "notify: 실패 http=${CODE} (${I}/${TRIES})"
  if [ "$I" -lt "$TRIES" ]; then sleep "$RETRY_SLEEP"; fi
  I=$((I + 1))
done

echo "notify: ${TRIES}회 모두 실패 — 이 실행은 이미 빨간색이고 GitHub 가 실패 메일을 보냅니다"
exit 0
