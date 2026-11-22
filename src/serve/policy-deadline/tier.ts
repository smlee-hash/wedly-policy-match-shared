/**
 * 정책별 고객사 「맞을 확률」 단계(NO.789) — 점수·높음/보통/낮음·근거 문장·확인 항목의 갈래·확인할 곳·다음 할 일·설정값 합치기.
 * 순수 함수 묶음이다(읽기·저장·화면은 이 모듈을 부른다). 판정 규칙(맞음·확인 필요·제외)은 바꾸지 않고,
 * 이미 나온 조건별 결과(맞은 조건·확인할 것·걸림돌)로만 점수와 단계를 매긴다.
 */
import { GENERIC_TO_CHECK, INDUSTRY_SCOPE_UNKNOWN, PRE_STRUCTURE_TO_CHECK, RAW_TO_CHECK, REGION_SCOPE_UNKNOWN, type FundingFit } from "../../funding/funding-map";

export type DeadlineTier = "high" | "mid" | "low";
export const TIER_LABEL: Record<DeadlineTier, string> = { high: "높음", mid: "보통", low: "낮음" };
export const TIER_RANK: Record<DeadlineTier, number> = { high: 0, mid: 1, low: 2 };

/** 확인 항목의 묶음 — 업체 칸 채우기 · 고객 통화/공고 원문 · 참고. 걸림돌은 업체 묶음이다. */
export type CheckGroup = "company" | "notice" | "ref";
const CHECK_FIELDS = [
  "industry", "address", "foundedDate", "companyScale", "companyForm", "bizno", "revenue",
  "employees", "cert", "patent", "taxArrears", "creditScore", "loan",
] as const;
export type CheckField = (typeof CHECK_FIELDS)[number];
export type CheckKind = "fieldGap" | "scopeUnknown" | "noticeCheck" | "rawCheck" | "obstacle" | "ref";
/** 점수에 무게가 붙는 갈래 — 참고(ref)는 점수에서 뺀다. */
type WeightKind = Exclude<CheckKind, "ref">;

export interface CheckItem {
  label: string; // 원래 이름표 — 저장·같은 항목 찾기용
  what: string; // 화면에 쓰는 짧은 말
  group: CheckGroup;
  rank: number;
  field?: CheckField; // 업체 칸(기업상태표·기본정보)에서 채울 항목일 때만
  where: string; // 확인할 곳
  current?: string;
  evidence?: string;
  hint?: string;
  obstacle?: true; // 걸림돌일 때만 true — 아니면 키가 없다
}

/** 이름표 하나의 갈래(classifyCheck 의 결과) — 지금 값·힌트는 업체마다 달라 뺀다. kind 는 점수 무게를 고르는 데만 쓴다. */
export interface CheckClass extends Omit<CheckItem, "current" | "hint"> {
  kind: CheckKind;
}

export interface TierConfig {
  weights: Record<WeightKind, number>;
  highMin: number;
  midMin: number;
  referenceWords: string[];
  text: Record<TierTextKey, string>;
  fieldWhere: Record<CheckField, string>;
}
const TEXT_KEYS = ["contact", "contactAsk", "askFirst", "checkFirst", "noticeFirst", "waitStructure", "inProgress"] as const;
type TierTextKey = (typeof TEXT_KEYS)[number];
const WEIGHT_KINDS: readonly WeightKind[] = ["fieldGap", "scopeUnknown", "noticeCheck", "rawCheck", "obstacle"];

function defaultConfig(): TierConfig {
  return {
    weights: { fieldGap: 8, scopeUnknown: 10, noticeCheck: 15, rawCheck: 20, obstacle: 25 },
    highMin: 90,
    midMin: 60,
    referenceWords: ["출품", "상담 방법", "생성형", "AI 표시", "접수 방법", "신청 방법", "제출 서류", "문의처"],
    text: {
      contact: "고객에게 연락해 신청 안내",
      contactAsk: "고객에게 연락해 신청 안내 · 통화 때 {what} 확인",
      askFirst: "고객에게 연락해 {what} 확인",
      checkFirst: "{what} 확인 후 연락",
      noticeFirst: "공고 원문에서 자격 먼저 확인",
      waitStructure: "공고 조건 정리 대기",
      inProgress: "업무 현황에서 진행 중",
    },
    // 기업상태표 실제 칸 이름
    fieldWhere: {
      industry: "기업상태표 › 사업자등록증 주업종",
      address: "기업상태표 › 사업장 소재지",
      foundedDate: "기업상태표 › 개업년월일",
      companyScale: "기업상태표 › 전년도(-1년) 매출·4대보험 인원수",
      companyForm: "기본정보 › 사업자번호",
      bizno: "기본정보 › 사업자번호",
      revenue: "기업상태표 › 전년도(-1년) 매출",
      employees: "기업상태표 › 4대보험 인원수",
      cert: "기업상태표 › 연구소/기업인증 보유여부",
      patent: "기업상태표 › 특허 출원이나 등록여부",
      taxArrears: "기업상태표 › 국세 체납여부",
      creditScore: "기업상태표 › 신용등급",
      loan: "기업상태표 › 정책자금 기대출",
    },
  };
}

/** 기본 설정값 — 얼려 두어 바꾸지 못한다. 바꾼 설정은 mergeTierConfig 가 새 객체로 돌려준다. */
export const DEFAULT_TIER_CONFIG: TierConfig = freezeConfig(defaultConfig());

function freezeConfig(c: TierConfig): TierConfig {
  for (const part of [c.weights, c.referenceWords, c.text, c.fieldWhere]) Object.freeze(part);
  return Object.freeze(c);
}

/* ───────── 설정값 합치기 — SystemConfig 의 JSON 이 들어온다 ───────── */

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
const isWeight = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 100;
const isPercent = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 100;
const isText = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";

/**
 * 모르는 키·잘못된 값은 버리고 맞는 값만 기본값 위에 덮는다. 늘 새 객체를 돌려준다.
 * 높음 기준이 보통 기준보다 크지 않으면 둘 다 기본값 — 점수가 높음과 보통 사이에서 겹친다.
 */
export function mergeTierConfig(raw: unknown): TierConfig {
  const c = defaultConfig();
  if (!isRecord(raw)) return c;
  const { highMin, midMin, referenceWords } = raw;
  overlay(c.weights, WEIGHT_KINDS, raw.weights, isWeight);
  overlay(c.text, TEXT_KEYS, raw.text, isText);
  overlay(c.fieldWhere, CHECK_FIELDS, raw.fieldWhere, isText);
  if (isPercent(highMin)) c.highMin = highMin;
  if (isPercent(midMin)) c.midMin = midMin;
  if (c.highMin <= c.midMin) {
    c.highMin = DEFAULT_TIER_CONFIG.highMin;
    c.midMin = DEFAULT_TIER_CONFIG.midMin;
  }
  if (Array.isArray(referenceWords) && referenceWords.length > 0 && referenceWords.every(isText)) c.referenceWords = [...referenceWords];
  return c;
}

/** target 의 각 칸을 raw 의 맞는 값으로 덮는다 — raw 가 객체가 아니거나 값이 틀리면 그 칸은 그대로. */
function overlay<K extends string, V>(target: Record<K, V>, keys: readonly K[], raw: unknown, ok: (v: unknown) => v is V): void {
  if (!isRecord(raw)) return;
  for (const k of keys) {
    const v = raw[k];
    if (ok(v)) target[k] = v;
  }
}

/* ───────── 이름표 하나의 갈래 ───────── */

const WHERE_NOTICE = "공고 원문";
const WHERE_CALL = "고객 통화로 확인";
const WHERE_AGENCY = "공고 기관 문의처";
const AGENCY_ASK = "기관 문의";
/** 원문 줄임·조건 정리 전 확인할 것의 화면 말 — 뜻을 모르니 「공고 원문 조건」으로만 부른다. */
const RAW_WHAT = "공고 원문 조건";
const EVIDENCE_MAX = 120;

/** 고칠 수 있는 걸림돌 이름표 → 화면 말·업체 칸·근거로 삼을 조건 줄 이름. */
const OBSTACLES = new Map<string, { what: string; field: CheckField; fit: string }>([
  ["체납 정리 필요", { what: "체납 정리", field: "taxArrears", fit: "세금 체납" }],
  ["요구 인증 필요", { what: "요구 인증 보유", field: "cert", fit: "인증" }],
  ["특허 필요", { what: "특허 보유", field: "patent", fit: "특허" }],
]);

/** 업체 칸 채우기 — 이름표 → 칸·화면 말·순위. */
const FIELD_GAPS: readonly { labels: readonly string[]; field: CheckField; what: string; rank: number }[] = [
  { labels: ["업종 입력"], field: "industry", what: "주업종", rank: 1 },
  { labels: ["소재지 입력", "소재지 확인", "시군구 확인"], field: "address", what: "사업장 소재지", rank: 2 },
  { labels: ["기업 규모 입력"], field: "companyScale", what: "기업 규모", rank: 3 },
  { labels: ["기업 형태 입력", "법인·개인 구분 확인"], field: "companyForm", what: "법인·개인 구분", rank: 3 },
  { labels: ["사업자 등록 여부"], field: "bizno", what: "사업자번호", rank: 3 },
  { labels: ["설립일 입력"], field: "foundedDate", what: "개업일", rank: 4 },
  { labels: ["연매출 입력", "매출 입력"], field: "revenue", what: "전년도 매출", rank: 5 },
  { labels: ["직원 수 입력"], field: "employees", what: "직원 수", rank: 5 },
  { labels: ["인증 보유 입력"], field: "cert", what: "보유 인증", rank: 6 },
  { labels: ["특허 보유 입력"], field: "patent", what: "보유 특허", rank: 6 },
  { labels: ["체납 여부 입력"], field: "taxArrears", what: "세금 체납", rank: 7 },
  { labels: ["신용점수 입력"], field: "creditScore", what: "신용점수", rank: 7 },
  { labels: ["대출 유무 입력"], field: "loan", what: "기존 대출", rank: 7 },
];

const SCOPE_RANK = new Map<string, number>([[INDUSTRY_SCOPE_UNKNOWN, 1], [REGION_SCOPE_UNKNOWN, 2]]);

/** 고객 통화로 확인 — 고객 정보로 못 가리는 요건. */
const CALL_RANK = new Map<string, number>([
  ["집적지 근처 인정 여부 확인", 2], ["예비창업자 여부", 3], ["재창업·재도전 대상 여부", 4],
  ["고용보험 가입 여부", 5], ["카드 매출 여부", 5], ["상시근로자 기준 확인", 5],
  ["R&D 수행 요건(연구소·연구 인력)", 6],
]);

function callRankOf(label: string): number | undefined {
  if (label.startsWith("대표자 ")) return 4;
  if (label.startsWith("직원 나이 조건")) return 5;
  if (label.includes("지원 이력")) return 8;
  return CALL_RANK.get(label);
}

/** 공고 원문에서 확인 — 이름표 → 순위(그 밖은 8). */
const NOTICE_RANK = new Map<string, number>([
  ["업종 제한 확인", 1], ["제외 업종 해당 여부", 1],
  ["지역 조건 확인", 2], ["지역 제한 확인", 2], ["지역 제외 조건 확인", 2],
  ["요구 인증 종류 확인", 6], ["요구 특허 종류 확인", 6],
  ["소기업 매출 기준 확인", 5],
  ["같은 사업 다른 안내 확인", 8], ["상품 안내 확인", 8],
  [AGENCY_ASK, 8],
]);

/** 근거 글은 120자(코드 포인트)를 넘으면 앞 119자 + 「…」. */
function clip(text: string): string {
  const chars = Array.from(text);
  return chars.length > EVIDENCE_MAX ? `${chars.slice(0, EVIDENCE_MAX - 1).join("")}…` : text;
}

/** 끝의 「 확인」을 뗀 화면 말. */
function whatOf(label: string): string {
  return label.replace(/ 확인$/, "") || label;
}

function noticeClass(label: string, kind: "scopeUnknown" | "noticeCheck", rank: number, where: string): CheckClass {
  return { kind, label, what: whatOf(label), group: "notice", rank, where };
}

/** 원문을 그대로 줄인 확인할 것 — 참고 낱말이 들어 있으면 점수에서 빼는 참고(ref), 아니면 공고 원문 조건. */
function rawClass(label: string, config: TierConfig): CheckClass {
  const text = label.replace(RAW_TO_CHECK, "");
  const evidence = clip(text);
  if (config.referenceWords.some((w) => text.includes(w))) {
    return { kind: "ref", label, what: text, group: "ref", rank: 9, where: WHERE_NOTICE, evidence };
  }
  return { kind: "rawCheck", label, what: RAW_WHAT, group: "notice", rank: 8, where: WHERE_NOTICE, evidence };
}

/** 이름표 하나의 갈래 — 위에서부터 먼저 맞는 것. */
export function classifyCheck(label: string, config: TierConfig = DEFAULT_TIER_CONFIG): CheckClass {
  const obstacle = OBSTACLES.get(label);
  if (obstacle) {
    const { what, field } = obstacle;
    return { kind: "obstacle", label, what, group: "company", rank: 0, field, where: config.fieldWhere[field], obstacle: true };
  }
  if (RAW_TO_CHECK.test(label)) return rawClass(label, config);
  // 조건 정리 전 표시가 정리된 확인과 섞여 온 것 — 뜻을 모르니 원문 조건으로 센다.
  if (GENERIC_TO_CHECK.has(label)) return { kind: "rawCheck", label, what: RAW_WHAT, group: "notice", rank: 8, where: WHERE_NOTICE };
  const scope = SCOPE_RANK.get(label);
  if (scope !== undefined) return noticeClass(label, "scopeUnknown", scope, WHERE_NOTICE);
  const gap = FIELD_GAPS.find((g) => g.labels.includes(label));
  if (gap) {
    const { field, what, rank } = gap;
    return { kind: "fieldGap", label, what, group: "company", rank, field, where: config.fieldWhere[field] };
  }
  const call = callRankOf(label);
  if (call !== undefined) return noticeClass(label, "noticeCheck", call, WHERE_CALL);
  const where = label === AGENCY_ASK ? WHERE_AGENCY : WHERE_NOTICE;
  return noticeClass(label, "noticeCheck", NOTICE_RANK.get(label) ?? 8, where);
}

/* ───────── 한 공고 × 한 업체의 단계 ───────── */

export interface TierInput {
  verdict: string;
  fit: readonly FundingFit[];
  toCheck: readonly string[];
  obstacles?: readonly string[];
}

export interface TierResult {
  tier: DeadlineTier;
  score: number;
  reason: string;
  checkItems: CheckItem[];
  fitTotal: number;
  fitPass: number;
  /** 공고 조건을 아직 정리하지 못한 줄 — isPreStructureJudgement(읽기 쪽 isPreStructureMatch)와 같은 뜻. */
  unstructured: boolean;
}

/** 판정 줄의 두 칸 — 「판단 전」·「조건 정리 전」을 가르는 데 쓴다. */
export interface JudgementShape {
  verdict: string;
  toCheck: readonly string[];
}

/**
 * 「판단 전」 줄인가 — 확인 필요이고 확인할 것이 모두 뭉뚱그린 문구(GENERIC_TO_CHECK, 빈 목록도 해당).
 * 연락 예정의 「판단 전 포함」을 켜야 보이는 줄이다 — 요약 카드 수가 이 기준으로 센다.
 */
export function isUnjudgedJudgement(m: JudgementShape): boolean {
  return m.verdict === "unverified" && m.toCheck.every((t) => GENERIC_TO_CHECK.has(t));
}

/**
 * 「조건 정리 전」 줄인가 — 판단 전이거나, 확인 필요이고 확인할 것에 「공고 원문 확인(조건 정리 전)」이 있다
 * (AI 정리 전 공고에 규칙 추출 확인이 섞인 줄). 점수와 상관없이 낮음·맨 뒤 접기·「공고 조건 정리 대기」.
 * 「자격 조건 원문 확인」이 다른 확인과 섞인 줄은 정리된 공고라 해당하지 않는다.
 */
export function isPreStructureJudgement(m: JudgementShape): boolean {
  return isUnjudgedJudgement(m) || (m.verdict === "unverified" && m.toCheck.includes(PRE_STRUCTURE_TO_CHECK));
}

/** 업체 칸의 지금 값·피드백 힌트를 넘겨주는 함수 — 모르면 undefined. */
export type FieldInfo = (field: CheckField) => { current?: string; hint?: string } | undefined;

/** 조건 줄 이름 → 순위. 줄 이름은 「이름」이나 「이름 원문 줄임」 꼴이다(그 밖은 8). */
const FIT_NAME_RANK: readonly (readonly [string, number])[] = [
  ["업종", 1], ["대상 분야", 1], ["지역", 2],
  ["기업 규모", 3], ["대상 유형", 3], ["법인 여부", 3],
  ["업력 상한", 4], ["업력 하한", 4],
  ["연매출 상한", 5], ["연매출 하한", 5], ["직원 수 상한", 5], ["직원 수 하한", 5],
  ["인증", 6], ["특허", 6],
  ["세금 체납", 7], ["신용점수 하한", 7], ["신용점수 상한", 7], ["기존 대출", 7], ["기존 보증", 7],
];

function hasName(label: string, name: string): boolean {
  return label === name || label.startsWith(`${name} `);
}

function fitRankOf(label: string): number {
  return FIT_NAME_RANK.find(([name]) => hasName(label, name))?.[1] ?? 8;
}

/** 근거 한 줄 — 「이름: 메모」(메모가 비면 이름만). */
function evidenceLine(f: FundingFit): string {
  return clip(f.note ? `${f.label}: ${f.note}` : f.label);
}

/**
 * 근거 문장. 원문 줄임은 원문 그대로(classifyCheck 가 준다). 걸림돌은 관련 조건 줄(안 맞음 먼저, 없으면 모름),
 * 그 밖의 공고 확인은 같은 순위의 「모름」 줄 첫 번째. 업체 칸 항목에는 붙이지 않는다.
 */
function evidenceOf(c: CheckClass, fit: readonly FundingFit[]): string | undefined {
  if (c.evidence !== undefined) return c.evidence;
  const name = c.obstacle ? OBSTACLES.get(c.label)?.fit : undefined;
  if (name !== undefined) {
    const line = (v: FundingFit["verdict"]) => fit.find((f) => f.verdict === v && hasName(f.label, name));
    const found = line("fail") ?? line("unknown");
    return found ? evidenceLine(found) : undefined;
  }
  if (c.group !== "notice") return undefined;
  const found = fit.find((f) => f.verdict === "unknown" && fitRankOf(f.label) === c.rank);
  return found ? evidenceLine(found) : undefined;
}

/** 갈래 → 화면 항목. 값이 없는 선택 칸은 키를 만들지 않는다. */
function itemOf(c: CheckClass, fit: readonly FundingFit[], fieldInfo: FieldInfo | undefined): CheckItem {
  const item: CheckItem = { label: c.label, what: c.what, group: c.group, rank: c.rank, where: c.where };
  if (c.obstacle) item.obstacle = true;
  const evidence = evidenceOf(c, fit);
  if (evidence !== undefined) item.evidence = evidence;
  if (c.field === undefined) return item;
  item.field = c.field;
  const info = fieldInfo?.(c.field);
  const current = info?.current ?? (c.label.endsWith(" 입력") ? "비어 있음" : undefined);
  if (current !== undefined) item.current = current;
  if (info?.hint !== undefined) item.hint = info.hint;
  return item;
}

/** 근거 글 — 앞머리(맞은 조건 수) · 꼬리(확인할 것). 참고 항목은 꼬리에 세지 않는다. */
function reasonOf(fitTotal: number, fitPass: number, counted: readonly CheckItem[]): string {
  const head = fitTotal === 0 ? "" : fitPass === fitTotal ? `조건 ${fitTotal}개 모두 맞음` : `조건 ${fitTotal}개 중 ${fitPass}개 맞음`;
  const [first, ...rest] = counted;
  const tail = !first ? "" : rest.length === 0 ? `${first.what}만 확인` : `${first.what} 외 ${rest.length}개 확인`;
  return [head, tail].filter((s) => s !== "").join(" · ") || "확인할 것 없음";
}

/**
 * 한 공고 × 한 업체의 단계. 조건 정리 전이거나 조건이 맞지 않으면 점수 0·낮음.
 * 점수 = 100 − 확인 항목(참고 뺀)의 갈래별 무게 합(0~100). 높음은 맞은 조건이 하나라도 있어야 한다.
 */
export function tierOf(input: TierInput, config: TierConfig = DEFAULT_TIER_CONFIG, fieldInfo?: FieldInfo): TierResult {
  const fitTotal = input.fit.length;
  const fitPass = input.fit.filter((f) => f.verdict === "pass").length;
  const unstructured = isPreStructureJudgement(input);
  const lowOf = (reason: string): TierResult => ({ tier: "low", score: 0, reason, checkItems: [], fitTotal, fitPass, unstructured });
  if (unstructured) return lowOf("공고 조건을 아직 정리하지 않음");
  if (input.verdict !== "fit" && input.verdict !== "unverified") return lowOf("조건이 맞지 않음");

  // 같은 이름표는 한 번만(먼저 나온 것), rank 순 — 같은 rank 는 들어온 순서 그대로(sort 는 안정 정렬).
  const labels = [...new Set([...input.toCheck, ...(input.obstacles ?? [])])];
  const classes = labels.map((l) => classifyCheck(l, config)).sort((a, b) => a.rank - b.rank);
  const checkItems = classes.map((c) => itemOf(c, input.fit, fieldInfo));
  const counted = checkItems.filter((c) => c.group !== "ref");
  const weight = classes.reduce((sum, c) => (c.kind === "ref" ? sum : sum + config.weights[c.kind]), 0);
  const score = Math.round(Math.min(100, Math.max(0, 100 - weight)));
  const tier = score >= config.highMin && fitPass > 0 ? "high" : score >= config.midMin ? "mid" : "low";
  return { tier, score, reason: reasonOf(fitTotal, fitPass, counted), checkItems, fitTotal, fitPass, unstructured };
}

/** 문구의 {what} 자리를 채운다. */
function fill(template: string, what: string): string {
  return template.split("{what}").join(what);
}

/**
 * 다음 할 일 한 줄 — 위에서부터 먼저 맞는 것(참고 항목은 셈에서 뺀다).
 * 진행 중 → 조건 정리 대기 → 확인할 것 없음 → 높음이고 업체 칸뿐이면 연락하며 확인 → 원문 줄임이면 공고 원문 먼저
 * → 고객 통화로 풀리면 연락해서 확인 → 그 밖은 확인 후 연락.
 */
export function nextActionOf(
  x: { tier: DeadlineTier; checkItems: readonly CheckItem[]; unstructured: boolean; inProgress: boolean },
  config: TierConfig = DEFAULT_TIER_CONFIG,
): string {
  const { text } = config;
  if (x.inProgress) return text.inProgress;
  if (x.unstructured) return text.waitStructure;
  const items = x.checkItems.filter((c) => c.group !== "ref");
  const [first] = items;
  if (!first) return text.contact;
  if (x.tier === "high" && items.every((c) => c.group === "company" && !c.obstacle)) return fill(text.contactAsk, first.what);
  if (first.what === RAW_WHAT) return text.noticeFirst;
  if (first.where === WHERE_CALL) return fill(text.askFirst, first.what);
  return fill(text.checkFirst, first.what);
}
