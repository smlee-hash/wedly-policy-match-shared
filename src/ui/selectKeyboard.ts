// 드롭다운(CustomSelect·CustomMultiSelect) 키보드 조작의 순수 로직.
// DOM·React에 의존하지 않아 단위 테스트로 검증한다.
// 두 컴포넌트가 이 파일만 import 해서 쓰고, 같은 로직을 각자 복사하지 않는다.

/** 이동 방향: 1 = 아래(다음), -1 = 위(이전) */
export type MoveDirection = 1 | -1;

/** typeAheadIndex가 필요로 하는 최소 형태 — 라벨만 있으면 된다. */
export interface LabeledOption {
  label: string;
}

/** 타자 검색 버퍼가 비워지는 기본 시간(ms). */
export const TYPE_AHEAD_RESET_MS = 700;

/**
 * 하이라이트를 dir 방향으로 한 칸 옮긴 인덱스(끝에서 반대편으로 순환).
 * 옵션이 없으면(-1) 하이라이트할 것이 없다는 뜻으로 -1.
 * current가 범위 밖(예: 아직 하이라이트 없음 = -1)이면 방향에 따라 처음/끝에서 시작한다.
 */
export function nextIndex(current: number, len: number, dir: MoveDirection): number {
  if (len <= 0) return -1;
  if (!Number.isInteger(current) || current < 0 || current >= len) {
    return dir === 1 ? 0 : len - 1;
  }
  return (current + dir + len) % len;
}

/**
 * 라벨이 buffer로 "시작하는" 첫 옵션의 인덱스. from부터 찾고 끝에 닿으면 처음으로 돌아온다.
 * 대소문자는 구분하지 않는다(toLowerCase). 한글은 그대로 비교되므로 그대로 동작한다.
 * 못 찾으면 -1.
 */
export function typeAheadIndex(
  options: readonly LabeledOption[],
  buffer: string,
  from: number,
): number {
  const len = options.length;
  if (len === 0 || buffer === "") return -1;
  const needle = buffer.toLowerCase();
  const start = !Number.isInteger(from) || from < 0 || from >= len ? 0 : from;
  for (let step = 0; step < len; step++) {
    const idx = (start + step) % len;
    const label = options[idx]?.label ?? "";
    if (label.toLowerCase().startsWith(needle)) return idx;
  }
  return -1;
}

/**
 * 타자 검색 버퍼에 글자 한 개를 이어 붙인다.
 * 마지막 입력 후 resetMs를 넘겨 쉬었으면(elapsedMs > resetMs) 이전 버퍼를 버리고 새로 시작한다.
 */
export function appendTypeAhead(
  prev: string,
  char: string,
  elapsedMs: number,
  resetMs: number = TYPE_AHEAD_RESET_MS,
): string {
  if (elapsedMs > resetMs) return char;
  return prev + char;
}

/**
 * 타자 검색에 쓸 "찍히는 글자" 인지. key가 한 글자면 인쇄 가능한 문자로 본다
 * (Enter·ArrowDown 등은 이름이 길어 걸러진다). keyCode는 쓰지 않는다 — 한글이 깨진다.
 */
export function isTypeAheadChar(key: string): boolean {
  return key.length === 1;
}

/** 목록을 열 때 어디를 하이라이트할지. */
export type OpenIntent = "first" | "last" | "selected";

/**
 * 목록을 열 때의 시작 하이라이트 인덱스.
 * ArrowDown = 첫 항목, ArrowUp = 마지막 항목, 그 외(Enter·Space) = 현재 선택 항목(없으면 첫 항목).
 */
export function initialHighlight(intent: OpenIntent, len: number, selectedIndex: number): number {
  if (len <= 0) return -1;
  if (intent === "first") return 0;
  if (intent === "last") return len - 1;
  return selectedIndex >= 0 && selectedIndex < len ? selectedIndex : 0;
}

/**
 * 타자 검색을 시작할 위치.
 * 버퍼가 첫 글자면 "다음" 항목부터 찾아 같은 글자를 연타할 때 후보를 순환하게 하고,
 * 이어 치는 중이면 현재 항목부터 찾아 방금 맞춘 항목이 계속 유지되게 한다.
 */
export function typeAheadStart(buffer: string, current: number, len: number): number {
  if (len <= 0) return -1;
  if (buffer.length <= 1) return nextIndex(current, len, 1);
  return current >= 0 && current < len ? current : 0;
}

/** 타자 검색 버퍼가 아직 살아 있는가(마지막 입력 뒤 resetMs 안).
 *  이게 없으면 글자를 한 번 친 뒤로는 버퍼가 영영 '있음'으로 남아
 *  스페이스가 선택 대신 계속 글자 입력으로 먹혀 선택이 안 된다(코드리뷰 M2). */
export function isTypeAheadActive(buffer: string, elapsedMs: number, resetMs: number = TYPE_AHEAD_RESET_MS): boolean {
  return buffer.length > 0 && elapsedMs <= resetMs;
}
