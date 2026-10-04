// 「채우기」 — 왼쪽 회사 정보에서 첫 「모름」 칸을 찾아 데려가고 초점을 준다.
// 모름 칸은 폼이 `data-unk="true"` 로 표시한다(흐리게 보이는 칸과 같은 표식).

/** 찾을 수 있는 것만 요구한다 — 시험이 가짜 뿌리를 넘길 수 있게 DOM 전체를 요구하지 않는다. */
interface Searchable {
  querySelector: (selector: string) => { focus: () => void; scrollIntoView: (o?: ScrollIntoViewOptions) => void } | null;
}

export const UNKNOWN_FIELD_SELECTOR = '[data-unk="true"] input, [data-unk="true"] button';

/** 첫 모름 칸으로 이동·초점. 모름 칸이 없으면 아무 일도 안 하고 false. */
export function focusFirstUnknown(root: Searchable | null): boolean {
  const target = root?.querySelector(UNKNOWN_FIELD_SELECTOR);
  if (!target) return false;
  target.scrollIntoView({ block: "center", behavior: "smooth" });
  target.focus();
  return true;
}
