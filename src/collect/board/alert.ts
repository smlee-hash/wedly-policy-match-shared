export interface AlertStore { get: (id: string) => Promise<number>; set: (id: string, n: number) => Promise<void> }
export interface AlertDeps { send: (text: string) => Promise<boolean>; store: { get: () => Promise<number>; set: (n: number) => Promise<void> } }

const THRESHOLD = 3;

/** 「마지막 오류」 줄에 싣는 최대 글자 수 — 넘으면 잘라 끝에 「…」를 붙인다. */
const REASON_MAX_CHARS = 300;

// 눈에 안 보이거나 비슷한 모양이 많은 글자는 소스에 그대로 쓰지 않고 글자 번호로 만든다.
const FULL_WIDTH_SPACE = String.fromCharCode(0x3000); // 전각 빈칸
const WHITE_BULLET = String.fromCharCode(0x25e6); // 속이 빈 동그라미
const WARNING_EMOJI = String.fromCharCode(0x26a0, 0xfe0f); // 경고 그림 글자

/** 구역 안 내용 줄의 머리 — `> ` + 전각 빈칸 + 속이 빈 동그라미 + 빈칸. */
const ITEM_PREFIX = `> ${FULL_WIDTH_SPACE}${WHITE_BULLET} `;

/** 슬랙 글에서 뜻이 바뀌는 세 글자(&·<·>)를 바꾼다. `&` 를 먼저 바꿔야 두 번 바뀌지 않는다. */
function escapeSlack(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** 줄바꿈·연속 빈칸을 빈칸 하나로 합쳐 한 줄로 만든다(줄이 갈라지면 `>` 없는 줄이 생긴다). */
function oneLine(s: string): string {
  return String(s).replace(/\s+/g, " ").trim();
}

/** 글자(코드 포인트) 단위로 잘라 그림 글자가 반으로 쪼개지지 않게 한다. */
function cutChars(s: string, max: number): string {
  const chars = Array.from(s);
  return chars.length > max ? `${chars.slice(0, max).join("").trimEnd()}…` : s;
}

/**
 * 게시판 수집 연속 실패 슬랙 알림 글 — WEDLY 슬랙 형식(2026-09-23 승인).
 * 모든 줄이 `>` 로 시작하고(구역 사이 빈 줄은 `>` 한 글자), 값(출처 id·오류)은 escape 한 뒤 접두를 붙인다.
 */
export function buildBoardFailureAlert(id: string, n: number, reason: string): string {
  const source = escapeSlack(oneLine(id));
  const lastError = escapeSlack(cutChars(oneLine(reason), REASON_MAX_CHARS));
  return [
    `> ${WARNING_EMOJI} *[정책매칭] 수집 실패 — ${source} 연속 ${n}회*`,
    ">",
    "> *▸ 무슨 일*",
    `${ITEM_PREFIX}출처 · ${source}`,
    `${ITEM_PREFIX}연속 실패 · ${n}회`,
    `${ITEM_PREFIX}마지막 오류 · ${lastError}`,
    ">",
    "> *▸ 사람이 할 일*",
    `${ITEM_PREFIX}자가수리도 실패했습니다 — 이 출처의 수집 설정을 사람이 점검해 주세요`,
    ">",
    `> 실패가 ${THRESHOLD}번 이어질 때 한 번 알립니다 · 한 번이라도 성공하면 다시 셉니다`,
  ].join("\n");
}

/** 연속 실패를 세고, 임계에 닿으면 1회 알린 뒤 성공 시에만 리셋. */
export async function noteFailureAndMaybeAlert(id: string, reason: string, deps: AlertDeps): Promise<void> {
  const n = Math.min(THRESHOLD, (await deps.store.get()) + 1);
  await deps.store.set(n);
  if (n < THRESHOLD) return;
  try {
    const ok = await deps.send(buildBoardFailureAlert(id, n, reason));
    if (ok) await deps.store.set(0);
  } catch {
    /* send 실패 시 THRESHOLD 유지 — 다음 실패 때 재시도 */
  }
}

/** 한 번 성공하면 실패 카운트 리셋. */
export async function noteSuccess(_id: string, deps: { store: { get: () => Promise<number>; set: (n: number) => Promise<void> } }): Promise<void> {
  await deps.store.set(0);
}
