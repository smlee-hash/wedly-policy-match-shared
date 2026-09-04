// 그룹 소제목이 있는 드롭다운의 렌더 순서를 정하는 순수 함수.
// - 그룹 라벨마다 헤더를 한 번만 낸다(같은 라벨이 목록에서 흩어져 나와도 중복 헤더·중복 React key 없음).
// - 옵션은 넘어온 순서·인덱스 그대로 낸다 — 키보드 이동·하이라이트가 배열 인덱스에 묶여 있어 재정렬하지 않는다.
export type GroupedRow =
  | { kind: "header"; label: string }
  | { kind: "option"; index: number };

export function planGroupedOptions(options: { group?: string }[]): GroupedRow[] {
  const rows: GroupedRow[] = [];
  const seen = new Set<string>();
  options.forEach((option, index) => {
    if (option.group && !seen.has(option.group)) {
      seen.add(option.group);
      rows.push({ kind: "header", label: option.group });
    }
    rows.push({ kind: "option", index });
  });
  return rows;
}

// 그룹 소제목이 "메인 | 서브" 꼴이면 두 층으로 나눈다(메인 섹션 = 분야, 서브 = 그 안의 탭).
// 화면에서 크기·색으로 위계를 보여주기 위함. " | "가 없으면 null → 헤더를 종전대로 한 덩어리로 그린다(다른 드롭다운 불변).
export function splitGroupHeader(label: string): { main: string; sub: string } | null {
  const sep = label.indexOf(" | ");
  if (sep < 0) return null;
  const main = label.slice(0, sep);
  const sub = label.slice(sep + 3);
  if (!main || !sub) return null;
  return { main, sub };
}
