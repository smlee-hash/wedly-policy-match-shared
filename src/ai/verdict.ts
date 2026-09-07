/**
 * 공고 1건 정밀 판정(AI) 지시문과 응답 형식 — 상세 패널에서 단추를 누를 때만 1회 부른다.
 *
 * **판정 결과는 시간이 지난다고 버리지 않는다**(2026-08-25 사장님 「한 번 요약한 자료를 매번
 * 새로 요약할 필요가 없잖아」). 캐시 열쇠에 판정을 바꿀 수 있는 것이 전부 들어 있다 —
 * 공고를 다시 읽었는지(structuredAt)·첨부가 바뀌었는지(지문)·사업자 정보·아래 판본.
 * 그중 하나라도 바뀌면 열쇠가 달라져 저절로 다시 부른다. 날짜로 또 버리면 **아무것도
 * 안 바뀌었는데 8일째에 돈을 다시 내는** 것뿐이다.
 *
 * structure.ts 와 같은 관행:
 * ① 개수 제한(`maxItems`·`minItems`)을 응답 형식에 절대 넣지 않는다(Anthropic 이 400 으로 거절).
 *    개수 제약은 설명문으로만 적는다.
 * ② additionalProperties: false 를 모든 객체 묶음에 넣는다.
 * ③ 원문에 없는 조건을 지어내지 않는다. 사업자 정보가 비어 있으면 「모름」이며 충족으로 단정하지 않는다.
 */
import type { BusinessProfile } from "../engine/match-engine";
import type { ConditionVerdict, MatchGrade } from "../engine/structure-types";

/**
 * 지시문·판정 규칙이 바뀌면 이 수를 올린다 → 저장해 둔 판정이 저절로 무효가 된다.
 * 캐시를 날짜로 버리지 않는 대신, **바뀐 게 있을 때만** 이 수로 버린다.
 */
export const VERDICT_VERSION = 1;

export const VERDICT_STATUSES = ["충족", "미충족", "확인필요"] as const;
export type VerdictStatus = (typeof VERDICT_STATUSES)[number];

export interface VerdictCheckItem {
  condition: string;  // 조건(원문에 기댄 한 줄)
  status: VerdictStatus;
  note: string;       // 왜 그렇게 봤는지 한 줄
}

export interface VerdictResult {
  grade: MatchGrade;
  explanation: string;
  checklist: VerdictCheckItem[];
}

export const VERDICT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["grade", "explanation", "checklist"],
  properties: {
    grade: {
      type: "string",
      enum: ["possible", "uncertain", "impossible"],
      description:
        "possible=자격이 맞아 신청할 수 있다, impossible=어긋나는 조건이 분명히 있다, uncertain=모르는 값이 있거나 원문만으로는 단정할 수 없다. 조금이라도 단정할 수 없으면 uncertain.",
    },
    explanation: {
      type: "string",
      description:
        "왜 그 등급인지 한국어 3~5문장. 원문의 조건과 사업자 정보를 짝지어 설명한다. 원문에 없는 조건·숫자를 지어내지 마라. 모르는 값은 「확인이 필요하다」고 적는다.",
    },
    checklist: {
      type: "array",
      description:
        "공고의 자격조건을 하나씩 판정한 목록. 개수 제한 없음. 원문에 있는 조건만 담고, 빠뜨리지 마라.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["condition", "status", "note"],
        properties: {
          condition: { type: "string", description: "조건 한 줄. 원문 표현을 살려 적는다." },
          status: {
            type: "string",
            enum: [...VERDICT_STATUSES],
            description:
              "충족=사업자 정보가 조건을 만족, 미충족=어긋남, 확인필요=사업자 정보가 없거나 원문만으로 판단 불가. 모르는 값을 충족으로 적지 마라.",
          },
          note: { type: "string", description: "그렇게 본 근거 한 줄. 없으면 빈 문자열." },
        },
      },
    },
  },
};

export const VERDICT_SYSTEM =
  "너는 정부 지원사업 공고와 사업자 정보를 대조해 신청 가능 여부를 판정하는 컨설턴트다. " +
  "원문에 없는 조건·숫자를 지어내지 말고, 사업자 정보가 비어 있는 항목은 「모름」으로 다뤄 충족으로 단정하지 마라. " +
  "조금이라도 단정할 수 없으면 uncertain 으로 판정한다. 모든 설명은 한국어로 쓴다.";

export interface VerdictPromptInput {
  title: string;
  agency: string;
  category: string;
  applyPeriodText: string;
  targetText: string;
  summary: string;
  benefitSummary: string;
  supportAmountText: string;
  conditions: { rawText: string; machineReadable: boolean }[];
  humanCheck: string[];
  structureIncomplete: boolean; // 구조화가 덜 끝난 공고(needs_review) — 조건이 빠졌을 수 있다
  profile: BusinessProfile;
  machine: { grade: MatchGrade; checks: { rawText: string; verdict: ConditionVerdict; note: string }[] };
  attachmentText?: string;
}

const VERDICT_LABEL: Record<ConditionVerdict, string> = {
  pass: "충족",
  fail: "미충족",
  unknown: "확인필요",
};

/** 사업자 정보 — 아는 값만 적고, 빈 칸은 「모름」이라고 분명히 밝힌다. */
export function profileLines(p: BusinessProfile): string[] {
  const rows: Array<[string, string]> = [
    ["상호", p.companyName ?? ""],
    ["사업자번호", p.bizno ?? ""],
    ["주업종", p.industry ?? ""],
    ["소재지", p.region ?? ""],
    ["설립일", p.foundedDate ?? ""],
    ["작년 연매출", p.lastYearRevenueKrw == null ? "" : `${p.lastYearRevenueKrw.toLocaleString("ko-KR")}원`],
    ["상시 근로자 수", p.employeeCount == null ? "" : `${p.employeeCount}명`],
    ["기업 규모", p.companyScale ?? ""],
    ["세금 체납", p.taxDelinquent == null ? "" : p.taxDelinquent ? "체납 있음" : "체납 없음"],
    ["인증 보유", p.hasCert == null ? "" : p.hasCert ? "보유" : "미보유"],
    ["특허 보유", p.hasPatent == null ? "" : p.hasPatent ? "보유" : "미보유"],
  ];
  return rows.map(([label, value]) => `- ${label}: ${value || "모름"}`);
}

export function buildVerdictUserPrompt(input: VerdictPromptInput): string {
  const parts = [
    "아래 공고 하나에 대해, 이 사업자가 신청할 수 있는지 판정하라.",
    "",
    "[공고]",
    `제목: ${input.title}`,
    `주관기관: ${input.agency || "(없음)"}`,
    `분야: ${input.category || "(없음)"}`,
    `신청기간: ${input.applyPeriodText || "(없음)"}`,
    `혜택 요약: ${input.benefitSummary || "(없음)"}`,
    `지원금액: ${input.supportAmountText || "(없음)"}`,
    "",
    "지원대상 원문:",
    input.targetText || "(없음)",
    "",
    "사업개요:",
    input.summary || "(없음)",
    ...(input.attachmentText?.trim()
      ? ["", "첨부 원문(발췌):", input.attachmentText.trim()]
      : []),
    "",
    "[구조화된 자격조건]",
    input.conditions.length
      ? input.conditions.map((c) => `- ${c.rawText}${c.machineReadable ? "" : " (기계 판정 불가)"}`).join("\n")
      : "- (없음)",
    "",
    "[사람이 직접 확인해야 하는 조건]",
    input.humanCheck.length ? input.humanCheck.map((h) => `- ${h}`).join("\n") : "- (없음)",
    "",
    "[사업자 정보] — 「모름」은 값이 없다는 뜻이다. 충족으로 단정하지 마라.",
    ...profileLines(input.profile),
    "",
    "[기계 대조 결과] — 참고용. 원문과 어긋나면 원문을 따르되, 왜 다른지 설명에 적어라.",
    `기계 등급: ${input.machine.grade}`,
    input.machine.checks.length
      ? input.machine.checks.map((c) => `- [${VERDICT_LABEL[c.verdict]}] ${c.rawText}${c.note ? ` — ${c.note}` : ""}`).join("\n")
      : "- (대조한 조건 없음)",
  ];
  if (input.structureIncomplete) {
    parts.push(
      "",
      "※ 이 공고는 자격조건 정리가 덜 끝났다(빠진 조건이 있을 수 있다). 원문을 근거로 판단하고, 확실하지 않으면 uncertain 으로 판정하라.",
    );
  }
  parts.push(
    "",
    "규칙:",
    "- 원문에 없는 조건·숫자·지역·업종을 지어내지 마라.",
    "- 사업자 정보가 「모름」인 항목은 checklist 에서 확인필요로 적는다.",
    "- 어긋나는 조건이 하나라도 분명하면 impossible.",
    "- explanation 은 한국어 3~5문장.",
  );
  return parts.join("\n");
}
