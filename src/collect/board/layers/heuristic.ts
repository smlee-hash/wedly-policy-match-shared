import type { HTMLElement } from "node-html-parser";
import { parseHtml, absolutize, normalizeDateText } from "../html";
import type { BoardRow } from "../types";
import { DATE_RE } from "../validate";

const HEURISTIC_MAX_NODES = 50_000;
const DATE_RANGE_RE = new RegExp(`${DATE_RE.source}\\s*~\\s*${DATE_RE.source}`);

type GroupCand = { nodes: HTMLElement[]; dated: number };

function isBetterGroup(cand: GroupCand, best: GroupCand | null): boolean {
  if (!best) return true;
  const candHalf = cand.dated * 2 >= cand.nodes.length;
  const bestHalf = best.dated * 2 >= best.nodes.length;
  if (candHalf !== bestHalf) return candHalf;
  return cand.nodes.length > best.nodes.length;
}

/** 가장 많이 반복되는 (부모, 자식태그) 묶음을 목록으로 본다. 날짜 밀도 우선. */
function findRepeatedGroup(root: HTMLElement): HTMLElement[] {
  let best: GroupCand | null = null;
  const stack: HTMLElement[] = [root];
  let visited = 0;
  while (stack.length > 0 && visited < HEURISTIC_MAX_NODES) {
    const el = stack.pop()!;
    visited += 1;
    const byTag = new Map<string, HTMLElement[]>();
    for (const c of el.childNodes as unknown as HTMLElement[]) {
      if (!c.tagName) continue;
      const arr = byTag.get(c.tagName) ?? [];
      arr.push(c); byTag.set(c.tagName, arr);
    }
    for (const arr of byTag.values()) {
      const withLink = arr.filter((n) => n.querySelector("a[href]"));
      if (withLink.length < 3) continue;
      const dated = withLink.filter((n) => DATE_RE.test(n.text)).length;
      const cand: GroupCand = { nodes: withLink, dated };
      if (isBetterGroup(cand, best)) best = cand;
    }
    for (const c of el.childNodes as unknown as HTMLElement[]) {
      if (c.tagName) stack.push(c);
    }
  }
  return best?.nodes ?? [];
}

/** 행에서 텍스트가 가장 긴 링크 = 제목+상세, 날짜 정규식 토큰 = 날짜. */
function rowToBoardRow(row: HTMLElement, base: string): BoardRow | null {
  const links = row.querySelectorAll("a[href]").filter((a) => a.getAttribute("href"));
  if (links.length === 0) return null;
  const titleLink = links.reduce((a, b) => (b.text.trim().length > a.text.trim().length ? b : a));
  const title = titleLink.text.trim();
  if (title.length < 4) return null;
  const range = row.text.match(DATE_RANGE_RE);
  const m = range ?? row.text.match(DATE_RE);
  return {
    title,
    detailUrl: absolutize(titleLink.getAttribute("href") ?? "", base),
    dateText: normalizeDateText(m ? m[0] : ""),
  };
}

/** ② 설정 없이 구조·뜻만으로 목록을 뽑는다. */
export function extractByHeuristic(html: string, base: string): BoardRow[] {
  const root = parseHtml(html);
  const group = findRepeatedGroup(root);
  const out: BoardRow[] = [];
  for (const row of group) { const r = rowToBoardRow(row, base); if (r) out.push(r); }
  return out;
}
