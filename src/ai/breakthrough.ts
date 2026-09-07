import type { TacitSnippet, TacitSourceKind } from "./tacit-types";

export const BREAKTHROUGH_VERSION = 2; // 로직/프롬프트 바뀌면 올린다 → 캐시 무효화
export const BLOCKED_CAP = 8;

export interface BreakthroughItem {
  condition: string;
  status: "미충족" | "확인필요";
  breakthrough: string; // 조건 넘는 법(근거 있을 때만 구체적)
  sources: { kind: string; ref: string }[]; // 근거 출처
  hasInternalCase: boolean; // false면 UI가 "강사 확인 필요" 강조
}

export const BREAKTHROUGH_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["items"],
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["condition", "status", "breakthrough", "sources", "hasInternalCase"],
        properties: {
          condition: { type: "string" },
          status: { type: "string", enum: ["미충족", "확인필요"] },
          breakthrough: {
            type: "string",
            description: "내부 근거(sources)가 있을 때만 구체적 해결법. 없으면 '내부 사례 없음 — 강사 확인 필요'로만.",
          },
          sources: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["kind", "ref"],
              properties: { kind: { type: "string" }, ref: { type: "string" } },
            },
          },
          hasInternalCase: { type: "boolean" },
        },
      },
    },
  },
} as const;

export interface BuildBreakthroughInput {
  policyTitle: string;
  conditions: { condition: string; status: "미충족" | "확인필요"; note?: string }[];
  snippetsByCondition: { condition: string; snippets: TacitSnippet[] }[];
}

export function buildBreakthroughUserPrompt(i: BuildBreakthroughInput): string {
  const blocks = i.conditions
    .map((c) => {
      const found = i.snippetsByCondition.find((s) => s.condition === c.condition)?.snippets ?? [];
      const ev = found.length
        ? found.map((s, n) => `  [근거${n + 1}] (${s.kind}·${s.ref}) ${s.text}`).join("\n")
        : "  (내부 근거 없음)";
      return `- 조건: ${c.condition} [${c.status}]${c.note ? ` — ${c.note}` : ""}\n${ev}`;
    })
    .join("\n\n");
  return [
    `대상 사업: ${i.policyTitle}`,
    ``,
    `아래 각 "안 되는/애매한 조건"마다, 제시된 내부 근거만을 바탕으로 "이 조건을 넘는 실무적 방법(돌파구)"을 쓰세요.`,
    `규칙:`,
    `1) 내부 근거가 있는 조건: 근거에 기반해 구체적 방법을 쓰고, 사용한 근거를 sources 에 (kind, ref)로 담고 hasInternalCase=true.`,
    `2) 내부 근거가 없는 조건: 방법을 지어내지 말 것. breakthrough 는 "내부 사례 없음 — 강사 확인 필요"로만 쓰고 sources=[] , hasInternalCase=false.`,
    `3) 근거에 없는 수치·기관명·절차를 창작하지 말 것.`,
    ``,
    `조건과 근거:`,
    blocks,
  ].join("\n");
}

export const BREAKTHROUGH_SYSTEM =
  `당신은 정부지원사업 컨설팅 실무 보조자다. 내부 자료(상담 자료실·고객 진행기록·상담 통화)에 있는 사례만을 근거로, 미충족 조건을 넘는 실무적 방법을 제시한다. 근거가 없으면 절대 지어내지 않고 "강사 확인 필요"로 넘긴다. 모든 방법은 한국어 실무 문장으로.`;

const BLOCKED: ReadonlySet<string> = new Set(["미충족", "확인필요"]);
const SOURCE_KINDS: ReadonlySet<string> = new Set(["자료실", "고객이력", "통화"]);

/** 정밀 판정 체크리스트에서 돌파구를 만들 조건만 남긴다. 0건이면 UI 는 블록 자체를 숨긴다. */
export function blockedConditionsOf(
  checklist: { condition: string; status: string; note?: string }[],
): { condition: string; status: "미충족" | "확인필요"; note?: string }[] {
  const out: { condition: string; status: "미충족" | "확인필요"; note?: string }[] = [];
  for (const c of checklist) {
    if (!BLOCKED.has(c.status)) continue;
    const row: { condition: string; status: "미충족" | "확인필요"; note?: string } = {
      condition: c.condition,
      status: c.status as "미충족" | "확인필요",
    };
    if (c.note) row.note = c.note;
    out.push(row);
  }
  return out;
}

/** 미충족을 먼저, 그다음 확인필요. AI 로 보내는 상한은 BLOCKED_CAP. */
export function pickBlockedForAi<T extends { status: "미충족" | "확인필요" }>(
  conditions: T[],
  cap = BLOCKED_CAP,
): T[] {
  const blocked = conditions.filter((c) => c.status === "미충족");
  const unsure = conditions.filter((c) => c.status === "확인필요");
  return [...blocked, ...unsure].slice(0, cap);
}

/** 8건 상한에 걸렸을 때 DetailPanel 안내. 전부 분석했으면 숨긴다. */
export function breakthroughCapNote(analyzedCount: number, totalCount: number): string | null {
  if (totalCount <= analyzedCount) return null;
  return `안 되는 조건 ${totalCount}건 중 ${analyzedCount}건을 분석했습니다`;
}

/** AI 가 보낸 sources.kind. 모르는 값은 null — 자료실로 바꿔 치지 않는다. */
export function sourceKindOf(kind: string): TacitSourceKind | null {
  return SOURCE_KINDS.has(kind) ? (kind as TacitSourceKind) : null;
}

/** 출처 뱃지 색. 모르는 kind 는 중립 회색. */
export function sourceBadgeBox(kind: string): string {
  if (kind === "자료실") return "bg-wedly-bg-blue text-wedly-accent-ink";
  if (kind === "고객이력") return "bg-wedly-bg-purple text-wedly-purple-ink";
  if (kind === "통화") return "bg-wedly-bg-green text-wedly-green-ink";
  return "bg-wedly-bg-gray text-wedly-t2";
}
