/**
 * 첨부 글자 조각을 출처·종류와 함께 모아 글자 상한 안에서 붙인다.
 *
 * 완성 문자열에 정규식을 대지 않는다. 본문 조각만 세고, 뒤 표식이 앞 본문을
 * 밀어내면 그 앞 파일에도 잘림 표식을 남긴다. 반복은 파일 수를 넘지 않는다.
 */

export type PieceKind = "heading" | "body" | "preview" | "unverified" | "fail" | "blocked" | "skipped";

export type TextPiece = {
  kind: PieceKind;
  text: string;
};

export type RenderBlock = {
  name: string;
  pieces: TextPiece[];
};

export type RenderedAttachments = {
  text: string;
  /** 최종 문자열에 실제로 남은 정상 본문 조각(잘린 꼬리·표식·미리보기 제외). */
  retainedBodies: string[];
  bodyTextChars: number;
  truncatedNames: string[];
};

const INNER = "\n";
const BLOCK = "\n\n";

export function truncatedMarker(name: string): string {
  return `[첨부 잘림: ${name}]`;
}

type FragKind = PieceKind | "truncated" | "sep";

type Frag = {
  name: string;
  kind: FragKind;
  text: string;
};

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

/** 상한에서 자를 때 이모지 한가운데를 남기지 않는다. */
export function sliceUtf16(text: string, max: number): string {
  if (max >= text.length) return text;
  if (max <= 0) return "";
  let take = text.slice(0, max);
  const last = take.charCodeAt(take.length - 1);
  if (isHighSurrogate(last)) take = take.slice(0, -1);
  return take;
}

function bodyLen(block: RenderBlock): number {
  let n = 0;
  for (const p of block.pieces) if (p.kind === "body") n += p.text.length;
  return n;
}

function cloneBlocks(blocks: RenderBlock[]): RenderBlock[] {
  return blocks.map((b) => ({
    name: b.name,
    pieces: b.pieces.map((p) => ({ kind: p.kind, text: p.text })),
  }));
}

function assemble(blocks: RenderBlock[], truncated: ReadonlySet<number>): Frag[] {
  const out: Frag[] = [];
  const emit = (frags: Frag[]) => {
    const parts = frags.filter((f) => f.text.length > 0);
    if (parts.length === 0) return;
    if (out.length > 0) out.push({ name: "", kind: "sep", text: BLOCK });
    parts.forEach((p, i) => {
      if (i > 0) out.push({ name: p.name, kind: "sep", text: INNER });
      out.push(p);
    });
  };

  for (const [index, b] of blocks.entries()) {
    emit(b.pieces.map((p) => ({ name: b.name, kind: p.kind, text: p.text })));
    if (truncated.has(index)) {
      emit([{ name: b.name, kind: "truncated", text: truncatedMarker(b.name) }]);
    }
  }
  return out;
}

function totalLen(frags: Frag[]): number {
  let n = 0;
  for (const f of frags) n += f.text.length;
  return n;
}

function shrinkFromEnd(blocks: RenderBlock[], amount: number): number {
  let left = amount;
  if (left <= 0) return 0;
  for (let bi = blocks.length - 1; bi >= 0 && left > 0; bi--) {
    const pieces = blocks[bi].pieces;
    for (let pi = pieces.length - 1; pi >= 0 && left > 0; pi--) {
      const p = pieces[pi];
      if ((p.kind !== "body" && p.kind !== "preview") || p.text.length === 0) continue;
      const take = Math.min(p.text.length, left);
      const next = sliceUtf16(p.text, p.text.length - take);
      left -= p.text.length - next.length;
      p.text = next;
    }
  }
  return amount - left;
}

function truncatedInOrder(blocks: RenderBlock[], truncated: ReadonlySet<number>): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const [index, b] of blocks.entries()) {
    if (!truncated.has(index) || seen.has(b.name)) continue;
    seen.add(b.name);
    names.push(b.name);
  }
  return names;
}

function finish(frags: Frag[], cap: number, truncatedNames: string[]): RenderedAttachments {
  const limit = Math.max(0, cap);
  // 표시조차 온전히 넣을 수 없으면 성공 머리글만 저장하지 않는다.
  if (totalLen(frags) > limit && frags.some(f => f.kind === "heading")) {
    return { text: "", retainedBodies: [], bodyTextChars: 0, truncatedNames };
  }
  let left = limit;
  let out = "";
  const retainedBodies: string[] = [];
  for (const f of frags) {
    if (left <= 0) break;
    const take = sliceUtf16(f.text, left);
    if (!take) {
      if (f.text.length > 0 && isHighSurrogate(f.text.charCodeAt(0))) {
        // 한 단위도 못 넣으면 그만둔다 — 반쪽을 내보내지 않는다.
        break;
      }
      continue;
    }
    out += take;
    left -= take.length;
    if (f.kind === "body" && take.length > 0) retainedBodies.push(take);
  }
  let bodyTextChars = 0;
  for (const b of retainedBodies) bodyTextChars += b.length;
  return { text: out, retainedBodies, bodyTextChars, truncatedNames };
}

/**
 * 표식·머리글은 남기고 본문·미리보기 꼬리부터 줄인다.
 * 본문이 줄어든 파일마다 잘림 표식을 추가하며, 반복은 블록 수 + 2 로 묶는다.
 */
export function renderAttachmentBlocks(blocks: RenderBlock[], cap: number): RenderedAttachments {
  const work = cloneBlocks(blocks);
  const originalBody = work.map((b) => bodyLen(b));
  const truncated = new Set<number>();
  const maxPass = work.length + 2;

  for (let pass = 0; pass < maxPass; pass++) {
    const frags = assemble(work, truncated);
    const len = totalLen(frags);
    if (len <= cap) return finish(frags, cap, truncatedInOrder(work, truncated));

    const removed = shrinkFromEnd(work, len - cap);
    let grew = false;
    for (let i = 0; i < work.length; i++) {
      if (originalBody[i] > 0 && bodyLen(work[i]) < originalBody[i] && !truncated.has(i)) {
        truncated.add(i);
        grew = true;
      }
    }
    if (removed === 0 && !grew) {
      return finish(frags, cap, truncatedInOrder(work, truncated));
    }
  }

  return finish(assemble(work, truncated), cap, truncatedInOrder(work, truncated));
}
