/**
 * 자금 조달 지도 — 공고(PolicyAnnouncement)와 상시 상품(FinanceProduct)을 **한 모양**(FundingItem)으로
 * 합친 뒤 필요한 계산만 하는 순수 함수 묶음(설계 §4 · 승인 미리보기 정본). DB·AI·화면 부품을 부르지 않는다.
 *
 * 여기 있는 글자(마감 딱지·한 줄 이유)는 승인 미리보기의 `deadLabel`·`why` 와 같은 말이다 —
 * 화면 부품이 제 나름대로 다시 지어내면 지도와 표에서 같은 항목이 다르게 읽힌다.
 */
import { FUNDING_GROUPS, type FundingGroup } from "./funding-group";
import type { FitVerdict } from "../engine/recommend-score";
import { conditionLabelOf, type ConditionCheck, type ConditionVerdict } from "../engine/structure-types";

export type FundingKind = "announcement" | "product";

export interface FundingFit {
  label: string;
  verdict: ConditionVerdict;
  note: string;
}

export interface FundingDeadline {
  kind: "date" | "always" | "budget" | "text" | "closed" | "upcoming" | "unknown";
  /**
   * YYYY-MM-DD (한국시간 달력 날짜) — 단 kind:"upcoming" 만 예외로 applyStart 의 ISO 문자열 전체를
   * 담는다(접수 시작 "순간"이 정본이라 달력 날짜로 뭉개지 않는다).
   */
  date: string | null;
  text: string; // 원문 그대로 — 화면 서랍이 「언제까지」 밑에 곁들인다
  dDay: number | null; // 한국시간 달력 기준 남은 날짜. 오늘 마감이면 0, 지났으면 음수. upcoming 은 접수까지 남은 날(올림)
}

export interface FundingItem {
  id: string; // "a:<announcementId>" | "p:<productId>"
  kind: FundingKind;
  refId: string;
  group: FundingGroup;
  title: string;
  agency: string;
  url: string;
  applyUrl: string;
  targetText: string; // 대상 원문(최대 600자) — 서랍이 통로 없이 그린다
  amountText: string;
  amountMaxWon: number | null;
  rateText: string;
  rateMin: number | null;
  deadline: FundingDeadline;
  where: string;
  fit: FundingFit[];
  fitVerdict: FitVerdict;
  humanCheck: number;
  score: number;
  why: string;
  source: string;
  isNew: boolean;
  /**
   * 갈래를 못 붙여 grant 칸에 임시로 실린 줄(조립 서비스가 표시). 지도에서 빼면 누락이라
   * 싣되, 한눈에 4칸의 「안 갚아도 되는 돈」 집계에서는 뺀다 — 없는 무상 지원금을 부풀리지 않는다.
   */
  unclassified?: boolean;
  /** 같은 사업의 상시 상품 줄을 접었을 때 그 상품 id — 접힌 것이 있었다는 사실을 잃지 않는다. */
  relatedProductId?: string;
  /**
   * 같은 공고(dedupKey 동일)가 수집원 여러 곳에서 들어와 한 줄로 묶였을 때 묶인 줄 수.
   * **2 이상일 때만 싣는다** — 1이면 아예 없다(「외 0곳」 같은 뜻 없는 딱지를 안 그리게).
   */
  groupCount?: number;
  /**
   * 묶음 안의 **서로 다른 수집원 수**. 「외 N곳」 딱지는 이 값으로만 센다 —
   * 행 수(`groupCount`)로 세면 한 수집원이 같은 공고를 두 번 올린 것도 「외 1곳」이 되어
   * 없는 수집원을 지어낸다(2026-09-03 코덱스 적대 리뷰 #7). `groupCount` 와 같이 2 이상일 때만 싣는다.
   */
  groupSources?: number;
  /**
   * 묶인 공고 번호(대표가 맨 앞, 대표 고르기와 같은 차례로 최대 20개).
   * 번호는 `PolicyAnnouncement.id` 그대로다 — `relatedProductId`·browse 목록의 groupIds 와 같은 규칙.
   */
  groupIds?: string[];
  /**
   * 같은 사업인지 가리는 열쇠(`PolicyAnnouncement.dedupKey`). 공고 줄에만, 값이 있을 때만 싣는다.
   * 서랍이 이 열쇠로 `GET /api/policy-match/announcements?dedupKey=…` 를 다시 물어
   * **묶인 다른 수집본**을 보여 준다 — 없으면 묶여 사라진 줄을 열 길이 아예 없다(코덱스 #2).
   */
  dedupKey?: string;
}

export interface FundingGroupBlock {
  group: FundingGroup;
  /**
   * 이 갈래 **카드에 남는** 정상(맞음+확인 필요) 건수 = 화면 딱지에 찍히는 수.
   * 안 맞음은 아래 `excluded` 가 따로 세고(11차 #2), 「종류 미확인」은 **빠진다**(독립 검사 ③) —
   * 그 줄은 화면이 맨 아래 「종류 미확인」 블록으로 옮기므로 이 카드에 남지 않는다.
   * 그래서 갈래 `total` 의 합 + 「종류 미확인」 건수 = 조립이 내는 `totals.filtered` 다.
   */
  total: number;
  fit: number;
  unverified: number;
  excluded: number;
  soon: number;
  /**
   * 정상 항목만, 정렬 뒤 topN. 안 맞음은 절대 섞이지 않는다(11차 #2).
   * ★뒤에 이 갈래의 「종류 미확인」 줄이 **따로 잘려**(같은 정렬·같은 topN) 붙는다 — 화면이 맨 아래
   *  블록으로 옮겨 그리는 줄들이라, 세는 칸(`total`·`fit`·`unverified`·`soon`)에는 안 들어간다.
   *  그러므로 `items.length` 는 `total` 과 다를 수 있다(미확인이 있으면 더 크다).
   */
  items: FundingItem[];
  truncated: boolean;
  /**
   * 안 맞아서 뺀 항목 — **`includeExcluded:true` 일 때만 있다**(false 면 필드 자체가 없다: 응답 크기).
   * `items` 와 같은 정렬·같은 topN 으로 따로 잘린다 — 정상 항목과 한 상한을 나눠 갖지 않는다.
   * 잘려서 못 실은 것이 있는지는 `excluded`(전체 개수)와 이 배열 길이를 견줘 안다.
   */
  excludedItems?: FundingItem[];
}

/**
 * 숫자 카드 4칸. **모집단은 두 가지뿐**이고 둘 다 「지금 화면에 보여 주는 목록」이다(`glanceOf` 주석):
 * 시간 칸(open·soon)은 정상 전체, 갈래 낱말을 쓰는 칸(grantFit·grantMaxWon·minRate)은 정상에서
 * 「종류 미확인」을 뺀 것 = 갈래 카드 딱지와 같은 모집단.
 *
 * ★**칩(openOnly·soonOnly)에 따라 움직이지 않는다**(독립 검사 ①) — 조립이 칩을 거치기 전 목록으로
 *  센다. 화면 부품 주석의 계약(「숫자는 서버가 전체 자료로 센 값」)이 이것이다.
 */
export interface FundingGlance {
  /** 지금 넣을 수 있는 건수(마감 안 지남·접수 시작함). 「종류 미확인」 줄도 센다. */
  open: number;
  /** 7일 안에 마감되는 건수. 「종류 미확인」 줄도 센다. */
  soon: number;
  /**
   * 무상(grant) 갈래 건수 = **무상 갈래 카드 딱지와 같은 수**.
   * ★이름은 「맞음만(fit)」이던 옛 뜻이 남은 것이다 — 값은 정상(맞음 + 확인 필요)에서 종류 미확인을
   *  뺀 수다(독립 검사 ②). 이름 고치기는 화면과 한 커밋이어야 해 통합 단계 몫이다.
   */
  grantFit: number;
  /** 위 모집단에서 가장 큰 무상 한도(원). 아는 금액이 없으면 null — 0 으로 지어내지 않는다. */
  grantMaxWon: number | null;
  /** 위와 같은 모집단(종류 확인된 정상)에서 가장 낮은 이자(%). 아는 이자가 없으면 null. */
  minRate: number | null;
}

export interface FundingMapData {
  groups: FundingGroupBlock[];
  glance: FundingGlance;
  profileGaps: string[];
  unclassified: number;
  generatedAt: string;
  /**
   * **판정에 쓸 회사 정보가 하나도 없었는가**(코덱스 3차 #C, 2026-09-04) — 화면이 「조건을 맞춰 보지
   * 않은 목록입니다」라고 **단정해도 되는 유일한 근거**다.
   *
   * ★왜 「센 조건 수」를 버렸나: 판정 엔진은 「이 조건을 회사 정보와 실제로 견줘 봤다」를 기록하지
   *  않는다. 그래서 어떤 셈도 근사치였다 — 인증 조건은 프로필을 **읽고도** `unknown` 을 내고
   *  (`certRequired`: 보유해도 「종류 확인」), 요약에 있는 값이 어느 조건에도 안 쓰였을 수도 있다.
   *  근사치로 단정문을 만들면 계속 틀린다. 그래서 셈을 정교하게 만드는 대신 **확실히 아는 것만**
   *  말하기로 바꿨다: 회사 정보 자체가 비었으면 아무 조건도 못 맞춰 본 것이 **확실하다**.
   *
   * 판정법(`buildFundingMap`): 받은 `profile`(BusinessProfile)의 값이 전부 비어 있으면(`undefined`·
   * `null`·빈 문자열) 참. `false`·`0` 은 **채워진 값**이다.
   *
   * ★**선택 칸이다** — 이 칸이 없던 판의 통로(옛 앱 배포본)가 보낸 응답도 그대로 그려야 한다.
   *  없으면(`undefined`) 화면은 **어느 쪽도 단정하지 않는다**(모르면 말하지 않는다).
   *  그래서 읽는 자리는 전부 `=== true` 로 본다.
   */
  profileEmpty?: boolean;
}

export type FundingSort = "rec" | "dead" | "rate" | "amt";
export interface FundingFilters {
  openOnly: boolean;
  soonOnly: boolean;
  /**
   * 안 맞음(excluded)까지 실어 보낼지 — 기본 false(안 맞음은 개수만).
   *
   * ★재설계 계약 G1①(2026-09-04 시안 3) — 예전 `fitOnly`(맞는 것만 좁히기)를 없애고 이 스위치로
   *  바꿨다. 화면에서 「맞는 것만」 칩이 없어졌기 때문이다(G2).
   *
   * ★뜻이 바뀌었다(코덱스 11차 #2·#4·#5·#15·#16, 2026-09-04) — 예전엔 이 값이 `applyFilters` 의
   *  분기였다: 켜면 안 맞음이 **같은 목록에 섞여** 돌아왔다. 그러면 정상과 안 맞음이 한 topN 을
   *  나눠 갖고(정상이 잘리거나 안 맞음이 아예 안 실림), 겹친 상품 접기·갈래 집계·한눈에 4칸이
   *  스위치에 따라 전부 흔들렸다. 이제 **목록은 언제나 정상만**이고, 이 값은 「갈래마다 안 맞음
   *  풀을 `FundingGroupBlock.excludedItems` 로 따로 실어 줄지」만 가린다.
   *  통로: GET `?excluded=1` · POST `filters.includeExcluded`.
   */
  includeExcluded: boolean;
}

/** 갈래 한 칸에 실어 보내는 최대 건수 — 나머지는 「N건 전부 보기」가 아니라 표 보기로 간다. */
export const GROUP_TOP_N = 80;

const DAY_MS = 86_400_000;
const KST_OFFSET_MS = 9 * 3_600_000;

/** 한국시간 그날 00:00 을 나타내는 값(UTC 밀리초 + 9시간). 시각이 아니라 「달력 날짜」를 재려고 쓴다. */
function kstDayStart(d: Date): number {
  return Math.floor((d.getTime() + KST_OFFSET_MS) / DAY_MS) * DAY_MS;
}

function kstYmd(d: Date): string {
  return new Date(d.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * 남은 날짜 = 한국 달력 날짜의 차이. 시각으로 빼면 「오늘 23:59 마감」이 오전엔 D-0, 저녁엔 D-0.02 처럼
 * 흔들려 딱지가 시간대에 따라 바뀐다(마감일은 KST 23:59:59 로 저장된다).
 */
function dDayOf(end: Date, now: Date): number {
  return Math.round((kstDayStart(end) - kstDayStart(now)) / DAY_MS);
}

const BUDGET_RE = /예산\s*소진|소진\s*시|소진시/;
const ALWAYS_RE = /상시|수시|연중|기한\s*없음|제한\s*없음/;
const CLOSED_RE = /마감|접수\s*종료|종료됨|중단/;
const YMD_RE = /(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/;

function dateDeadline(end: Date, text: string, now: Date): FundingDeadline {
  return { kind: "date", date: kstYmd(end), text: text || kstYmd(end), dDay: dDayOf(end, now) };
}

/**
 * 공고 마감. 마감일이 있으면 날짜가 정본이고, 없을 때만 기간 원문을 읽는다 —
 * 「2026-08-28 ~ 예산 소진 시」처럼 끝이 날짜가 아닌 원문이 실제로 많다(중소벤처24 접수중 1,630건 중 997건).
 *
 * applyStart(선택 4번째 인자)가 now 보다 뒤면 접수가 아직 시작하지 않은 것 — 마감이 아무리 넉넉해도
 * 「지금 신청 가능」이 아니므로 다른 판정보다 먼저 본다. 기존 3개 인자 호출은 그대로 동작한다.
 *
 * ★마감일도 기간 원문도 둘 다 없으면 "상시"가 아니라 kind:"unknown"·text:"기간 미기재" 로 정직하게
 * 적는다(G3② — 2026-09-03 코덱스 지적). 상시(always)는 "언제 신청해도 된다"는 적극적인 사실인데,
 * 정보가 아예 없는 것은 그 사실을 모르는 것이지 상시로 확인된 게 아니다 — 다만 접수중(status open)
 * 공고를 정보 없다고 지도에서 숨기면 더 나쁘므로 isOpen 은 그대로 true 로 둔다(아래 isOpen 은 kind
 * 를 안 가리고 dDay 만 보므로 이 변경만으로 이미 그렇게 동작한다). 상품(deadlineOfProduct)은 원래도
 * 「상시」가 정상값이라 이 규칙을 적용하지 않는다 — 그 함수는 그대로 둔다.
 */
export function deadlineOfAnnouncement(
  applyEnd: Date | null,
  periodText: string,
  now: Date,
  applyStart?: Date | null,
): FundingDeadline {
  if (applyStart != null && Number.isFinite(applyStart.getTime()) && applyStart.getTime() > now.getTime()) {
    const n = Math.ceil((applyStart.getTime() - now.getTime()) / DAY_MS);
    return { kind: "upcoming", date: applyStart.toISOString(), text: `${n}일 뒤 접수`, dDay: n };
  }
  const text = (periodText ?? "").replace(/\s+/g, " ").trim();
  if (applyEnd && Number.isFinite(applyEnd.getTime())) return dateDeadline(applyEnd, text, now);
  if (!text) return { kind: "unknown", date: null, text: "기간 미기재", dDay: null };
  if (BUDGET_RE.test(text)) return { kind: "budget", date: null, text, dDay: null };
  if (ALWAYS_RE.test(text)) return { kind: "always", date: null, text, dDay: null };
  return { kind: "text", date: null, text, dDay: null };
}

/**
 * 상품 마감. 상품은 대부분 「상시」라 비어 있으면 상시로 본다.
 * 「예산 소진 시」를 상시로 뭉개지 않는 이유: 화면 딱지가 달라야 사람이 서두를지 판단한다.
 */
export function deadlineOfProduct(deadlineText: string, now: Date): FundingDeadline {
  const text = (deadlineText ?? "").replace(/\s+/g, " ").trim();
  if (!text) return { kind: "always", date: null, text: "상시", dDay: null };
  if (BUDGET_RE.test(text)) return { kind: "budget", date: null, text, dDay: null };
  if (ALWAYS_RE.test(text)) return { kind: "always", date: null, text, dDay: null };
  const m = text.match(YMD_RE);
  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const da = Number(m[3]);
    const utc = Date.UTC(y, mo - 1, da);
    const probe = new Date(utc);
    const real = probe.getUTCFullYear() === y && probe.getUTCMonth() === mo - 1 && probe.getUTCDate() === da;
    // KST 그날 23:59:59 = UTC 같은 날 14:59:59 (공고 저장 규칙과 같은 자리)
    if (real) return dateDeadline(new Date(utc + 14 * 3_600_000 + 59 * 60_000 + 59_000), text, now);
  }
  if (CLOSED_RE.test(text)) return { kind: "closed", date: null, text, dDay: null };
  return { kind: "text", date: null, text, dDay: null };
}

/** 마감 딱지 — 승인 미리보기 deadLabel 과 같은 글자. soon(주황)은 7일 안쪽만. */
export function deadlineLabel(d: FundingDeadline): { text: string; tone: "soon" | "always" | "plain" } {
  if (d.kind === "upcoming") return { text: d.text, tone: "plain" }; // 「N일 뒤 접수」 — soon(임박)이 아니다
  if (d.kind === "unknown") return { text: d.text || "기간 미기재", tone: "plain" }; // G3② — 상시가 아니라 정보 없음
  if (d.kind === "closed") return { text: "마감 지남", tone: "plain" };
  if (d.kind === "budget") return { text: "예산 소진 시", tone: "always" };
  if (d.kind === "always") return { text: "상시", tone: "always" };
  if (d.dDay === null) return { text: d.text || "기간 확인", tone: "plain" };
  if (d.dDay < 0) return { text: "마감 지남", tone: "plain" };
  if (d.dDay === 0) return { text: "오늘 마감", tone: "soon" };
  return { text: `D-${d.dDay}`, tone: d.dDay <= 7 ? "soon" : "plain" };
}

const RAW_MAX = 18;

/**
 * 조건 대조 결과 → 화면 딱지.
 * 라벨에 조건 이름을 앞세우는 이유: 한 문장에서 두 조건을 뽑으면 원문이 같아 무엇을 재는 줄인지 알 수 없다
 * (structure-types.ts 의 CONDITION_LABEL 주석 — 2026-08-22 독립 재검사 1번).
 */
export function fitsOf(checks: ConditionCheck[]): FundingFit[] {
  return checks.map((c) => {
    const raw = (c.condition.rawText ?? "").replace(/\s+/g, " ").trim();
    const short = raw.length > RAW_MAX ? `${raw.slice(0, RAW_MAX)}…` : raw;
    const name = conditionLabelOf(c.condition.key);
    return { label: short ? `${name} ${short}` : name, verdict: c.verdict, note: c.note ?? "" };
  });
}

/** 「서울이라 / 제조업이라」 — 받침이 있으면 「이라」. 기계가 지은 문장이 어색하면 사람이 안 읽는다. */
function withIra(label: string): string {
  const w = label.replace(/[…\s]+$/, "");
  const last = w.charCodeAt(w.length - 1);
  const isHangul = last >= 0xac00 && last <= 0xd7a3;
  const hasBatchim = isHangul && (last - 0xac00) % 28 !== 0;
  return `${w}${hasBatchim ? "이라" : "라"}`;
}

/**
 * 한 줄 이유. 안 맞는 게 있으면 그것부터 말한다 — 사람이 알고 싶은 건 「왜 안 되는지」다.
 * 기계로 읽은 조건이 하나도 없으면 「모두 맞음」이라고 말하지 않는다(근거가 0인데 통과를 말하는 자리다).
 */
export function whyOf(fits: FundingFit[], humanCheck: number): string {
  const tail = humanCheck > 0 ? ` · 직접 확인 조건 ${humanCheck}건` : "";
  const fail = fits.find((f) => f.verdict === "fail");
  if (fail) return `${withIra(fail.label)} 대상 아님${tail}`;
  const unknown = fits.find((f) => f.verdict === "unknown");
  if (unknown) return `${unknown.label.replace(/[…\s]+$/, "")} 확인 필요${tail}`;
  if (fits.length === 0) return `기계로 읽은 조건 없음 — 원문 확인 필요${tail}`;
  return `입력한 조건 ${fits.length}개 모두 맞음${tail}`;
}

const EOK = 100_000_000;
const MAN = 10_000;

/**
 * 원 단위 금액 → 사람이 읽는 글자. 큰 금액을 만원으로만 나누면 「5,000,000만원」이 되어
 * 아무도 못 읽고 타일 안에서 두 줄로 접힌다(배포본 QA 캡처 `15a-glance-4tiles.png` 지적).
 *
 * · 1억 이상 → 「N억 M,MMM만원」(만원 자리가 0 이면 억만): 146_000_000 → "1억 4,600만원" · 500_000_000_000 → "5,000억원"
 * · 1만 이상 → 만원(정수): 50_000_000 → "5,000만원"
 * · 그 미만 → 원: 5_000 → "5,000원"
 *
 * ★억 단위를 소수 첫째 자리로 반올림하던 것을 버렸다(2026-09-03 코덱스 적대 리뷰 #4 중간):
 *  1억 4,600만원이 「1.5억원」이 되어 **없는 400만원을 만들었다**. 이 숫자는 사람이 신청 가능액으로
 *  읽는 자리라 부풀리면 안 된다 — 억 이상도 만원까지 정확히 적고, 만원 미만 잔돈만 버린다
 *  (억 단위에서 원 단위까지 적으면 도리어 못 읽는다).
 *
 * 없음(null)·이상한 값·0 이하는 「—」 — 0 을 「0원」이라 적으면 한도가 0 인 것처럼 읽힌다
 * (없는 것과 0 은 다른 사실이다).
 */
export function formatWon(n: number | null): string {
  if (n === null || !Number.isFinite(n) || n <= 0) return "—";
  if (n >= EOK) {
    const eok = Math.floor(n / EOK);
    const man = Math.floor((n % EOK) / MAN);
    const head = `${eok.toLocaleString("ko-KR")}억`;
    return man > 0 ? `${head} ${man.toLocaleString("ko-KR")}만원` : `${head}원`;
  }
  if (n >= MAN) return `${Math.round(n / MAN).toLocaleString("ko-KR")}만원`;
  return `${Math.round(n).toLocaleString("ko-KR")}원`;
}

/** 글자 안 단위 토큰 → 원. 「만」은 넣지 않는다 — 「5,000만원」은 이미 사람이 읽는 표기다. */
const TEXT_UNIT_WON: Record<string, number> = { 천만: 10_000_000, 백만: 1_000_000, 천: 1_000 };
/**
 * 「17백만원」·「800천원」·「70,000천원」 같은 단일 값, **그리고** 「10~20백만원」처럼 범위 끝에만
 * 단위가 붙는 표기를 한 정규식으로 함께 찾는다 — 범위 쪽 대안을 먼저 둬야 정규식이 “20백만원”만
 * 집어 앞의 “10”을 그대로 남기는 반쪽짜리 매치를 피한다(2026-09-03 코덱스 적대 리뷰 지적 5②:
 * 「10~20천원」이 「10~2만원」이라는 짝 안 맞는 범위가 됐다).
 *
 * ★2026-09-03 코덱스 적대 리뷰 재지적 — 갈래 전체 앞에 하나로 걸었던 `(?<![\d.,])` 가 범위까지
 *  같이 막았다. 「지원한도,10~20백만원」처럼 범위 바로 앞이 쉼표·마침표(숫자 자릿수 구분이 아니라
 *  그냥 문장 구두점)면 이 후방탐색에 걸려 범위 매치 자체가 실패하고, 뒤 숫자(「20백만원」)만 단일
 *  값으로 홀로 매치돼 「지원한도,10~2,000만원」이라는 짝 안 맞는 범위가 됐다(지적 5② 이 다른 경로로
 *  되살아난 것과 같은 모양). 이제 갈래마다 후방탐색을 따로 둔다.
 *  · 범위 쪽은 `(?<![\d.])` — 숫자 바로 뒤(다른 수의 자릿수 이어붙기)와 마침표만 막고 쉼표는 허용한다.
 *    ★7차 지적 4(2026-09-03): 위 재지적에서 `(?<!\d)` 로 마침표까지 허용했더니 「0.5~20백만원」의 「.5」가
 *    「5~20백만원」으로 부분 매치돼 「0.500~2,000만원」이 됐다(소수점 뒷자리를 떼어 없는 자릿수를 만듦 —
 *    단일 쪽이 「3.5천원」을 막는 것과 같은 이유). 마침표는 문장 구두점보다 소수점일 때가 훨씬 많다.
 *  · 단일 쪽은 `(?<![\d.,~∼-])` — 원래 숫자 경계(`[\d.,]`, 「3.5천원」의 뒷자리 5 만 떼어 「5천원」
 *    으로 읽는 것을 막음, PERCENT_ONLY_RE 와 같은 이유)에 `~∼-` 를 더한다. 범위 규칙이 통째로
 *    매치를 못 잡는(예: 만원 배수가 아니라 바뀌지 않는 등) 자리라도, 단일 규칙이 범위의 뒤쪽 절반만
 *    (「~20백만원」의 "20백만원") 홀로 집어가는 것까지 막는 마지막 방어선이다.
 *
 * ★2026-09-03 코덱스 적대 리뷰 반영 — 범위 쪽이 「10~20백만원」(끝에만 단위)은 잡지만 「10백만원~20백만원」
 *  (양쪽 다 단위)은 못 잡았다. 첫 숫자 뒤 `\s*[~∼-]\s*` 로 곧장 넘어가던 자리에 `(?:(천만|백만|천)\s*원)?`
 *  를 끼워 첫 숫자의 단위+원을 **통째로(단위 없이 「원」만 있는 경우는 계속 안 잡는다)** 선택적으로 흡수한다
 *  — 없으면(기존 「10~20백만원」) 그대로 건너뛴다. 첫 숫자 쪽 단위가 캡처되면(group 2) 콜백에서 둘째 숫자
 *  단위(group 4)와 같은지 검사해, 다르면(예: 「10천만원~20백만원」) 함부로 안 바꾼다 — 단위가 갈리는 범위를
 *  한쪽 단위로 지어내지 않는다.
 */
const TEXT_UNIT_RE =
  /(?:(?<![\d.])(\d[\d,]*)\s*(?:(천만|백만|천)\s*원)?\s*[~∼-]\s*(\d[\d,]*)\s*(천만|백만|천)\s*원|(?<![\d.,~∼-])(\d[\d,]*)\s*(천만|백만|천)\s*원)/g;

/** won 이 만원(10,000원)의 정확한 배수인가 — 아니면 formatWon 에 넘기지 않는다(반올림 방지). */
function isManMultiple(won: number): boolean {
  return Number.isFinite(won) && won > 0 && won % MAN === 0;
}

/**
 * 「만원」 단독 표기 중 1억 이상 값(만 단위 N ≥ 10,000)만 억 표기로 통일한다.
 *
 * ★2026-09-03 독립 화면 검사 E(배포본 실측 · 1억 이상인데 만원 표기인 칸 85개) — 같은 열에 「5억원」과
 *  「50,000만원」이 함께 보여 자릿수 감이 어긋났다. 10,000 미만(예: 「5,000만원」)은 이미 사람이 읽는
 *  표기라 손대지 않는다 — TEXT_UNIT_RE 와 같은 「멀쩡한 글을 안 건드린다」 원칙.
 *  범위(「10,000~20,000만원」)는 두 수 다 10,000 이상일 때만 함께 바꾼다 — 한쪽만 바꾸면 짝이 안 맞는
 *  범위가 생긴다(TEXT_UNIT_RE 범위 규칙과 같은 이유).
 *  단위 토큰이 「만」 하나뿐이라 TEXT_UNIT_WON 의 천만/백만/천 표와는 겹치지 않는다 — 그 세 단위는
 *  한글 글자가 「만원」 앞에 끼어(예: 「30백만원」의 「백만」) 숫자가 「만원」 바로 앞에 붙지 않는다.
 *
 * ★2026-09-03 코덱스 적대 리뷰 반영 — TEXT_UNIT_RE 와 같은 반쪽 매치 문제가 여기도 있었다.
 *  「10,000만원~20,000만원」(양쪽 다 「만원」)은 범위 규칙이 첫 숫자 뒤 곧장 물결표를 기대해 매치를
 *  못 잡고, 단일 규칙이 앞 「10,000만원」만 홀로 집어 「1억원」으로 바꾼 뒤 뒤 「20,000만원」은
 *  (물결표 뒤라 단일 규칙 후방탐색에 막혀) 그대로 남아 「1억원~20,000만원」이 됐다. 첫 숫자 뒤에
 *  `(?:만원)?` 을 끼워 있으면 함께 삼키고 없으면(기존 「10,000~20,000만원」) 그대로 건너뛴다 — 단위가
 *  「만」 하나뿐이라 TEXT_UNIT_RE 처럼 양쪽 단위가 다를 위험이 없어 별도 일치 검사가 필요 없다.
 */
const MAN_UNIT_RE = /(?:(?<![\d.])(\d[\d,]*)\s*(?:만원)?\s*[~∼-]\s*(\d[\d,]*)\s*만원|(?<![\d.,~∼-])(\d[\d,]*)\s*만원)/g;

/** formatWon 결과 맨 끝의 "원" 한 글자만 뗀다 — 범위 앞쪽 수를 뒤쪽과 이어 붙일 때 "원"이 한 번만 오도록. */
function stripTrailingWon(label: string): string {
  return label.endsWith("원") ? label.slice(0, -1) : label;
}

function normalizeManUnit(text: string): string {
  return text.replace(
    MAN_UNIT_RE,
    (whole, rangeA: string | undefined, rangeB: string | undefined, num: string | undefined) => {
      if (rangeA !== undefined && rangeB !== undefined) {
        const a = Number(rangeA.replace(/,/g, ""));
        const b = Number(rangeB.replace(/,/g, ""));
        if (!Number.isFinite(a) || !Number.isFinite(b) || a < 10_000 || b < 10_000) return whole;
        return `${stripTrailingWon(formatWon(a * MAN))}~${formatWon(b * MAN)}`;
      }
      const n = Number((num ?? "").replace(/,/g, ""));
      if (!Number.isFinite(n) || n < 10_000) return whole;
      return formatWon(n * MAN);
    },
  );
}

/**
 * 글자 속 금액 **단위만** 사람이 읽는 표기로 통일한다 — 문장은 그대로 둔다.
 *
 * ★2026-09-03 독립 검사 D · 배포본 캡처 `05-table-1440.png`: 숫자 칸(amountMaxWon)이 없는 줄은
 *  원문 글자를 그대로 싣는데, 원문 단위가 「17백만원」·「800천원」이라 같은 표에서 「최대 1,000만원」과
 *  자릿수 감이 어긋났다(어느 쪽이 큰지 눈으로 못 잰다). 숫자 칸이 있는 줄은 이미 `formatWon` 이
 *  통일하고 있으므로, 이 함수는 **그 나머지**를 같은 표기로 맞추는 자리다.
 *
 * ★2026-09-03 코덱스 적대 리뷰 지적 5 — 이 함수가 반올림하는 `formatWon` 을 그대로 써서 원금을
 *  바꿔 버렸다(「15천원」→「2만원」처럼 없는 5,000원이 생겼다). 두 가지로 막는다.
 *  ① 환산값이 만원의 정확한 배수일 때만 바꾼다 — 아니면 원문(`whole`)을 그대로 돌려준다.
 *  ② 범위(「10~20백만원」)는 두 수를 **같은 단위로 함께** 환산하고, 둘 다 만원 배수일 때만 통째로
 *     바꾼다 — 한쪽만 바꾸면 짝이 안 맞는 범위가 생긴다(위 지적 5②).
 *  ③ 억 단위 이상은 `formatWon` 을 그대로 쓴다 — 입력이 만원의 배수면 억 자리·만원 자리 나눗셈이
 *     전부 나머지 없이 떨어져(Math.floor 라도 손실이 없다) 반올림이 일어나지 않는다(직접 확인:
 *     `funding-map.test.ts` 의 `formatWon(15_000_000_000)` 등 — 그래서 별도 억·만 표기 함수를
 *     새로 만들지 않았다).
 *  ④ 마지막으로 「만」 단위(위 normalizeManUnit)를 한 번 더 통과시켜, 1억 넘는 만원 표기도 억으로
 *     통일한다(독립 검사 E).
 *  ⑤ 범위 양쪽 다 단위가 있으면(「10백만원~20백만원」) 첫 숫자 쪽 단위(rangeUnitA)가 둘째 숫자 단위
 *     (rangeUnitB)와 다를 때만 원문을 그대로 둔다 — 같으면(또는 첫 숫자에 단위가 없으면, 기존
 *     「10~20백만원」) 둘째 단위 하나로 함께 환산한다(코덱스 적대 리뷰 반영, TEXT_UNIT_RE 주석 참고).
 */
export function normalizeAmountUnits(text: string): string {
  const unified = (text ?? "").replace(
    TEXT_UNIT_RE,
    (
      whole,
      rangeA: string | undefined,
      rangeUnitA: string | undefined,
      rangeB: string | undefined,
      rangeUnitB: string | undefined,
      num: string | undefined,
      unit: string | undefined,
    ) => {
      if (rangeA !== undefined && rangeB !== undefined) {
        if (rangeUnitA !== undefined && rangeUnitA !== rangeUnitB) return whole;
        const unitWon = TEXT_UNIT_WON[rangeUnitB ?? ""];
        const a = Number(rangeA.replace(/,/g, ""));
        const b = Number(rangeB.replace(/,/g, ""));
        if (!unitWon || !Number.isFinite(a) || !Number.isFinite(b)) return whole;
        const wonA = a * unitWon;
        const wonB = b * unitWon;
        if (!isManMultiple(wonA) || !isManMultiple(wonB)) return whole;
        return `${(wonA / MAN).toLocaleString("ko-KR")}~${(wonB / MAN).toLocaleString("ko-KR")}만원`;
      }
      const n = Number((num ?? "").replace(/,/g, ""));
      const unitWon = TEXT_UNIT_WON[unit ?? ""];
      if (!Number.isFinite(n) || n <= 0 || !unitWon) return whole;
      const won = n * unitWon;
      if (!isManMultiple(won)) return whole;
      return formatWon(won);
    },
  );
  return normalizeManUnit(unified);
}

export function isOpen(it: FundingItem): boolean {
  if (it.deadline.kind === "closed" || it.deadline.kind === "upcoming") return false; // 예정은 아직 못 넣는다
  return it.deadline.dDay === null || it.deadline.dDay >= 0;
}

export function isSoon(it: FundingItem): boolean {
  if (it.deadline.kind === "closed" || it.deadline.kind === "upcoming") return false; // 예정은 임박이 아니다
  const d = it.deadline.dDay;
  return d !== null && d >= 0 && d <= 7;
}

/** 판정(fitVerdict)을 안 보는 칩만 — 시간(열림·임박)으로 거르는 자리. splitByFit 의 1단계. */
function passesTimeFilters(it: FundingItem, f: FundingFilters): boolean {
  if (f.openOnly && !isOpen(it)) return false;
  if (f.soonOnly && !isSoon(it)) return false;
  return true;
}

/**
 * 칩(openOnly·soonOnly)을 **먼저** 걸고, 통과한 것만 정상(맞음+확인 필요)/안 맞음 두 풀로 나눈다.
 *
 * ★차례가 뜻이다(코덱스 11차 #3, 2026-09-04) — 예전엔 안 맞음 개수를 칩 적용 **전** 전체에서 셌다.
 *  그래서 「7일 내 마감」을 켜 놓고도 「안 맞아서 뺀 320건」처럼 칩과 아무 상관 없는 수가 떴다.
 *  안 맞음도 같은 칩을 통과한 것만 센다 — 화면의 두 수가 같은 잣대에서 나와야 한다.
 */
export function splitByFit(
  items: FundingItem[],
  f: FundingFilters,
): { normal: FundingItem[]; excluded: FundingItem[] } {
  const normal: FundingItem[] = [];
  const excluded: FundingItem[] = [];
  for (const it of items) {
    if (!passesTimeFilters(it, f)) continue;
    if (it.fitVerdict === "excluded") excluded.push(it);
    else normal.push(it);
  }
  return { normal, excluded };
}

/**
 * 화면 목록에 실을 항목 = 칩을 통과한 **정상**(맞음+확인 필요)만.
 *
 * ★재설계 계약 G1①(2026-09-04) — 예전 `fitOnly`(맞는 것만 좁히기, fit 만 남기고 unverified 도 뺌)를
 * 없앴다. 맞음(fit)·확인 필요(unverified)는 항상 남는다.
 *
 * ★`includeExcluded` 분기를 없앴다(코덱스 11차 #2·#4, 2026-09-04) — 이 함수는 **언제나** 안 맞음을
 * 뺀다. 켜서 안 맞음을 섞어 돌려주면 topN·겹친 상품 접기·집계가 스위치에 따라 달라졌다.
 * 안 맞음은 `splitByFit(...).excluded` 로 따로 받아 `groupBlocks` 의 `excludedPool` 로 넘긴다.
 */
export function applyFilters(items: FundingItem[], f: FundingFilters): FundingItem[] {
  return splitByFit(items, f).normal;
}

const FIT_RANK: Record<FitVerdict, number> = { fit: 0, unverified: 1, excluded: 2 };

/** 마감 정렬 열쇠 — 가까운 마감이 앞, 상시는 그 뒤, 마감 지난 것은 맨 뒤(미리보기와 같은 차례). */
function deadRank(d: FundingDeadline): number {
  if (d.kind === "closed") return 99_999;
  if (d.dDay === null) return 9_999;
  return d.dDay < 0 ? 99_999 : d.dDay;
}

export function sortItems(items: FundingItem[], sort: FundingSort): FundingItem[] {
  const list = [...items];
  if (sort === "dead") return list.sort((a, b) => deadRank(a.deadline) - deadRank(b.deadline));
  if (sort === "rate") {
    return list.sort((a, b) => (a.rateMin ?? Number.MAX_SAFE_INTEGER) - (b.rateMin ?? Number.MAX_SAFE_INTEGER));
  }
  if (sort === "amt") return list.sort((a, b) => (b.amountMaxWon ?? -1) - (a.amountMaxWon ?? -1));
  return list.sort((a, b) => {
    const byFit = FIT_RANK[a.fitVerdict] - FIT_RANK[b.fitVerdict];
    if (byFit !== 0) return byFit;
    if (a.score !== b.score) return b.score - a.score;
    return deadRank(a.deadline) - deadRank(b.deadline);
  });
}

/**
 * ★한눈에 4칸은 **「지금 화면에 보여 주는 목록」 하나를** 센다(브라우저 독립 검사 ②, 2026-09-04).
 *
 * 배포본에서 숫자 카드 「안 갚아도 되는 돈 **0건**」이 40px 아래 갈래 카드 「안 갚아도 되는 돈
 * **6,287건**」과 나란히 떴다 — 글자는 같은데 타일은 맞음(fit)만, 갈래 카드는 그 갈래 **정상 전체**
 * (맞음 + 확인 필요)를 세고 있었다. 상담사는 그 0건을 「이 회사는 받을 게 없다」로 읽는다.
 * 「가장 낮은 이자」가 「—」인데 대출 갈래에 479건이 앉아 있던 모순도 원인이 같았다(맞음 0건 →
 * 고를 이자가 없다). 그래서 옛 「맞음만 센다」(G3①·2026-09-03)를 버리고 **갈래 카드와 같은 모집단**
 * 으로 맞췄다 — 같은 낱말이면 같은 수여야 뜻이 생긴다.
 *
 * 모집단 규칙(`groupBlocks` 의 `total` 과 **한 글자도 다르지 않게** 유지한다):
 *  ⓐ 안 맞음(excluded)은 뺀다 — 목록에도 없다(코덱스 11차 #16). 부르는 쪽이 섞어 넘겨도 이 함수가 뺀다.
 *  ⓑ 확인 필요(unverified)는 **센다** — 갈래 카드가 세고, 카드로 실제로 그려진다.
 *  ⓒ 「종류 미확인」(`unclassified`)은 **갈래 낱말을 쓰는 칸**(무상 건수·무상 최대 금액·최저 이자)에서
 *    뺀다. 화면이 그 줄을 갈래 카드에서 빼 맨 아래 전용 블록으로 옮기기 때문이다
 *    (`ui/FundingMap.tsx` 의 `classifiedGroupItems`) — 옮긴 뒤 기준으로 세야 타일이 딱지와 맞는다.
 *    반대로 「지금 신청 가능」·「7일 안에 마감」은 그 줄도 **센다** — 미확인 블록에 그려져 사람이 넣을 수
 *    있는 건수이고, 그 두 낱말은 갈래를 말하지 않는다.
 *  ⓓ 열림(isOpen)으로 **더 좁히지 않는다** — 갈래 카드 딱지는 마감이 지난 줄·접수 예정 줄도 세므로,
 *    여기서만 빼면 두 수가 다시 갈린다. 시간은 위 두 칸이 맡는다.
 *
 * ★칸 이름 `grantFit` 은 「맞음만」이던 옛 뜻이 남은 이름이다 — 값은 위 기준(정상·종류 확인됨)이다.
 *  이름을 고치면 화면(`ui/FundingMap.tsx`)과 한 커밋이어야 해서 통합 단계로 미뤘다.
 *
 * ★**칩(openOnly·soonOnly)을 거치기 전 목록**을 받는 것은 부르는 쪽 책임이다(독립 검사 ①) —
 *  `build/funding-map-build.ts` 의 `glancePool` 주석에 어느 배열인지와 근거가 있다.
 */
export function glanceOf(items: FundingItem[]): FundingGlance {
  const normal = items.filter((it) => it.fitVerdict !== "excluded");
  // 갈래 카드에 **남는** 줄 — 미확인은 화면이 맨 아래 블록으로 옮기므로 갈래 낱말을 쓰는 칸에서 뺀다(ⓒ).
  const carded = normal.filter((it) => !it.unclassified);
  const grant = carded.filter((it) => it.group === "grant");
  const amounts = grant.map((it) => it.amountMaxWon).filter((v): v is number => typeof v === "number");
  const rates = carded.map((it) => it.rateMin).filter((v): v is number => typeof v === "number");
  return {
    open: normal.filter(isOpen).length,
    soon: normal.filter(isSoon).length,
    grantFit: grant.length,
    grantMaxWon: amounts.length ? Math.max(...amounts) : null,
    minRate: rates.length ? Math.min(...rates) : null,
  };
}

export interface GroupBlockOptions {
  /** 갈래 안 차례. 화면 정렬 셀렉트가 서버로 넘어온다 — 지도·표·건수가 한 계산에서 나와야 숫자가 안 어긋난다. */
  sort?: FundingSort;
  /** 갈래 한 칸에 실을 최대 건수(1~GROUP_TOP_N). 통합 상세창 추천 탭은 3건만 쓴다. */
  topN?: number;
  /**
   * 안 맞음 풀 — 다른 칩(openOnly·soonOnly)을 **통과한** 안 맞음 항목들(`splitByFit(...).excluded`).
   * 갈래별 `excluded` 개수와 (켰을 때) `excludedItems` 를 여기서만 센다(코덱스 11차 #2·#3).
   *
   * 안 주면(예전 호출) `items` 안의 안 맞음을 그대로 센다 — 안 맞음이 섞인 목록 하나만 들고 있는
   * 호출자도 개수는 맞게 나온다. 어느 쪽이든 안 맞음 판정으로 한 번 더 걸러 쓰므로, 전체 목록을
   * 통째로 넘겨도 정상 항목이 안 맞음 개수에 섞이지 않는다.
   */
  excludedPool?: FundingItem[];
  /**
   * true 면 갈래마다 `excludedItems`(같은 정렬·같은 topN)를 싣는다. false·미지정이면 **필드 자체가
   * 없다** — 응답 크기 때문이다(안 맞음은 열어 봐야 할 때만 실어 보낸다).
   */
  includeExcluded?: boolean;
}

/**
 * 6갈래 고정 순서. 빈 갈래도 자리를 지운다 — 지도에서 칸이 사라지면 「그런 돈은 없다」로 읽힌다.
 *
 * ★`items` 에서 안 맞음을 **항상** 뺀다(코덱스 11차 #2, 2026-09-04). 안 맞음이 섞이면 정상 항목과
 * 한 topN 을 나눠 갖고(정상이 잘리거나 안 맞음이 아예 안 실림), `total`·`soon` 이 사람이 넣을 수
 * 없는 건수를 세게 된다. 안 맞음은 `excluded` 개수와 `excludedItems` 로만 나간다.
 */
export function groupBlocks(items: FundingItem[], opts: GroupBlockOptions = {}): FundingGroupBlock[] {
  const sort = opts.sort ?? "rec";
  // 상한을 넘겨 받아도 GROUP_TOP_N 을 넘기지 않는다 — 응답 크기를 부르는 쪽이 정하게 두면
  // 한 요청이 수천 건을 실어 화면이 멈춘다.
  const topN = Math.min(Math.max(Math.floor(opts.topN ?? GROUP_TOP_N) || GROUP_TOP_N, 1), GROUP_TOP_N);
  const pool = (opts.excludedPool ?? items).filter((it) => it.fitVerdict === "excluded");
  return FUNDING_GROUPS.map((group) => {
    const mine = items.filter((it) => it.group === group && it.fitVerdict !== "excluded");
    // ★셈은 **이 카드에 실제로 남는 줄**로 한다(브라우저 독립 검사 ③, 2026-09-04). 배포본에서 딱지
    //  「181건」 + 본문 「지금 조건에 맞는 항목이 없습니다」 + 발치 「이 갈래 181건 중 0건만 보여 드림」
    //  이 한 카드에 **동시에** 떴다 — 그 갈래 줄이 전부 「종류 미확인」이라 화면이 맨 아래 전용 블록으로
    //  옮겼는데(`ui/FundingMap.tsx` 의 `classifiedGroupItems`) 딱지·발치는 옮긴 것을 그대로 셌다.
    //  옮기는 규칙을 아는 것은 서버도 마찬가지(`it.unclassified`)이니 셈을 서버에서 맞춘다.
    const carded = mine.filter((it) => !it.unclassified);
    // 화면이 「종류 미확인」 블록으로 옮길 줄 — 셈에선 빠지지만 `items` 에는 **반드시 실어 보낸다**.
    // 빼면 화면이 그 줄을 어디서도 못 그린다(그 블록은 갈래 칸의 `items` 에서 모아 온다).
    const parked = mine.filter((it) => it.unclassified);
    const excludedMine = pool.filter((it) => it.group === group);
    const block: FundingGroupBlock = {
      group,
      total: carded.length,
      fit: carded.filter((it) => it.fitVerdict === "fit").length,
      unverified: carded.filter((it) => it.fitVerdict === "unverified").length,
      excluded: excludedMine.length,
      soon: carded.filter(isSoon).length,
      // 미확인 줄은 **뒤에 따로** 잘려 붙는다 — 카드와 「종류 미확인」 블록은 서로 다른 상자라 한 상한을
      // 나눠 갖지 않는다(`excludedItems` 와 같은 규칙). 한 상한을 나누면 갈래가 꽉 찬 순간 미확인 블록이
      // 조용히 비고, 섞어 세우면 미확인이 카드 앞자리를 차지한다.
      items: [...sortItems(carded, sort).slice(0, topN), ...sortItems(parked, sort).slice(0, topN)],
      truncated: carded.length > topN,
    };
    if (opts.includeExcluded) block.excludedItems = sortItems(excludedMine, sort).slice(0, topN);
    return block;
  });
}

/* ─────────────────────────────────────────────────────────────────────────
 * 낱말 도우미(재설계 계약 G1④, 2026-09-04 시안 3) — 카드·표·서랍이 마감·판정·금액·갚기 글자를
 * 저마다 다시 짓지 않고 여기 하나만 쓰게 한다. 전부 순수 함수(DB·시각 없음, `now` 는 인자로만).
 * 낱말 규칙(계약 공통): 기호(✓/?/✕)·D-N·「외 N곳」·「미분류」·「대조 기준」·「지도/표」·
 * 「맞는 것만」·「원문 확인」(→「직접 확인」+이유)·id 접두어 금지 — 이 파일이 그 규칙을 지킨다.
 * ───────────────────────────────────────────────────────────────────── */

/** "YYYY-MM-DD" → 앞자리 0 없는 { mo, da } — "9월 4일"처럼 사람이 읽는 월·일을 만드는 데만 쓴다. */
function monthDayOf(ymd: string): { mo: number; da: number } {
  return { mo: Number(ymd.slice(5, 7)), da: Number(ymd.slice(8, 10)) };
}

/** deadlineWords 의 text(원문) 표기 상한 — fitsOf 의 RAW_MAX(18)보다 좁다: 마감 줄은 한 줄에 더 많은 글자와 함께 앉는다. */
const DEADLINE_TEXT_MAX = 14;

/**
 * 마감 딱지(chip)·펼침 글자(long)·색조(tone). 카드 앞면은 chip, 서랍·표 펼침은 long 을 쓴다.
 *
 * ★`now` 를 받아 **매번 다시 계산**한다(기존 `deadlineLabel` 은 `d.dDay` 를 그대로 믿었다) — 자료가
 *  캐시되거나 화면이 열려 있는 채로 자정을 넘기면 「오늘/내일」이 실제 지금 기준으로 다시 맞아야
 *  한다. `d.date` 는 kind:"date" 면 "YYYY-MM-DD"(한국시간 달력 날짜), kind:"upcoming" 이면
 *  applyStart 의 ISO 시각 전체다(FundingDeadline 주석과 같은 규칙) — 시각까지 담긴 값이라
 *  day-bucket 없이 그대로 밀리초 차로 「N일 뒤」를 다시 잰다.
 *
 * **D-N 표기는 어디서도 만들지 않는다**(계약 낱말 규칙).
 */
export function deadlineWords(
  d: FundingDeadline,
  now: Date,
): { chip: string; long: string; tone: "red" | "green" | "plain" } {
  if (d.kind === "date") {
    if (!d.date) return { chip: d.text || "기간 확인", long: d.text || "기간 확인", tone: "plain" };
    const { mo, da } = monthDayOf(d.date);
    const day = dDayOf(new Date(d.date), now);
    if (day < 0) return { chip: "마감됨", long: "마감됨", tone: "plain" };
    if (day === 0) return { chip: "오늘 마감", long: "오늘 마감", tone: "red" };
    if (day === 1) {
      const text = `내일(${mo}월 ${da}일) 마감`;
      return { chip: text, long: text, tone: "red" };
    }
    if (day <= 7) return { chip: `${day}일 남음`, long: `${day}일 남음 (${mo}월 ${da}일 마감)`, tone: "red" };
    const text = `${mo}월 ${da}일 마감`;
    return { chip: text, long: text, tone: "plain" };
  }
  if (d.kind === "upcoming") {
    const n = d.date ? Math.ceil((new Date(d.date).getTime() - now.getTime()) / DAY_MS) : (d.dDay ?? 0);
    // ★일수가 0 이하면 이미 시작했다(코덱스 11차 #14, 2026-09-04) — 자료를 만들 때는 예정이었는데
    //  화면을 열어 둔 채 시작일이 지나면 「-1일 뒤 접수 시작」이라는 없는 말이 나왔다.
    if (n <= 0) return { chip: "접수 시작됨", long: "접수 시작됨", tone: "plain" };
    const text = `${n}일 뒤 접수 시작`;
    return { chip: text, long: text, tone: "plain" };
  }
  if (d.kind === "always") return { chip: "상시 접수", long: "상시 접수", tone: "green" };
  if (d.kind === "budget") return { chip: "예산 소진 시 마감", long: "예산 소진 시 마감", tone: "plain" };
  if (d.kind === "text") {
    const t = d.text ?? "";
    // ★long 은 전문(코덱스 11차 #13, 2026-09-04) — 자르기는 좁은 카드 앞면(chip)만의 일이다.
    //  펼침까지 14자로 자르면 「2026-09-01 ~ 예산 소진 시」 같은 마감 원문을 어디서도 못 읽는다.
    const chip = t.length > DEADLINE_TEXT_MAX ? `${t.slice(0, DEADLINE_TEXT_MAX)}…` : t;
    return { chip, long: t, tone: "plain" };
  }
  if (d.kind === "closed") return { chip: "마감됨", long: "마감됨", tone: "plain" };
  return { chip: "기간 미기재", long: "기간 미기재", tone: "plain" }; // kind === "unknown"
}

/**
 * 「어디에 신청」— 접수 창구 + (묶인 다른 수집원이 있으면 몇 곳 더 게시됐는지).
 *
 * ★`where` 가 먼저다(코덱스 11차 #7, 2026-09-04) — 상품의 `where` 는 「케이뱅크 앱」처럼 **실제로
 *  신청하는 곳**(channel)인데 이 함수가 그걸 버리고 기관(`agency`)만 적었다. 「어디에 신청」이라는
 *  질문에 창구를 안 알려 주면 그 줄은 뜻이 없다. `where` 가 비었을 때만 기관으로 내려오고,
 *  둘 다 없으면 정직하게 「기관 미기재」.
 */
export function whereWords(it: FundingItem): string {
  const base = it.where?.trim() || it.agency?.trim() || "기관 미기재";
  if (it.groupSources && it.groupSources > 1) return `${base} (${it.groupSources - 1}곳에 더 게시)`;
  return base;
}

/** 조건 대조 결과 요약 줄 — 카드 앞면·서랍이 함께 쓴다. */
export function verdictWords(fit: FundingFit[]): string {
  if (fit.length === 0) return "자동으로 잰 조건 없음 — 공고에서 직접 확인";
  const passCount = fit.filter((f) => f.verdict === "pass").length;
  const unknownCount = fit.filter((f) => f.verdict === "unknown").length;
  const failCount = fit.filter((f) => f.verdict === "fail").length;
  let text = `조건 ${fit.length}개 중 ${passCount}개 맞음 · ${unknownCount}개는 직접 확인`;
  if (failCount > 0) text += ` · ${failCount}개 안 맞음`;
  return text;
}

/** 조건 한 줄(펼침 목록)의 딱지 글자 — 기호(✓/?/✕) 대신 뜻이 통하는 낱말로. */
export function conditionVerdictWord(v: ConditionVerdict): "맞음" | "직접 확인" | "안 맞음" {
  if (v === "pass") return "맞음";
  if (v === "fail") return "안 맞음";
  return "직접 확인";
}

/** 「얼마까지」— amountText 는 이미 억·만 표기로 다듬어져 있다(extractAmount·normalizeAmountUnits). */
export function amountWords(it: FundingItem): string {
  return it.amountText?.trim() ? it.amountText : "공고에 금액 없음";
}

/**
 * 제목에 이 낱말이 있으면 「안 갚아도 되는 돈」이다 — 규칙으로 붙인 `invest` 갈래보다 강한 증거.
 *
 * ★보는 자리를 **invest 갈래 안으로** 좁혔다(코덱스 12차 #1, 2026-09-04) — 아래 repayWords 주석.
 */
const NO_REPAY_WORD_RE = /보조금|지원금|바우처/;
/**
 * 이자 칸에 **숫자 금리**가 적혀 있는지(「연 4.5%」·「4.5 %」) — 제목 낱말보다 강한 증거다.
 *
 * ★코덱스 13차 #1(2026-09-04) — 12차 #1 이 제목 낱말 규칙을 invest 갈래 안으로 좁히면서, **그 안에서**
 *  숫자 금리를 보던 검사가 함께 사라졌다. 「소상공인 지원금 연계 투자대출」에 이자가 「연 4.5%」로
 *  적혀 있어도 제목의 「지원금」 하나로 「안 갚아도 됨」이 되어, 이자를 내는 돈이 공짜 돈으로 읽혔다.
 */
const NUMERIC_RATE_RE = /\d\s*%/;

/**
 * 「갚아야 하나」— grant(무상)·invest(투자)는 상환이 없는 돈이라 이자 대신 그 사실을 말한다.
 *
 * ★차례가 뜻이다(코덱스 11차 #9, 2026-09-04) — 갈래가 `invest` 로 붙은 「보조금」 공고가
 *  「지분으로 받음」이라고 적혀 **없는 지분 양도**를 말했다. 갈래는 제목·기관으로 규칙이 붙인
 *  값이라 틀릴 수 있는데, 이자 칸의 「무상」은 그보다 강한 증거다 — 그래서 `invest` 판정보다
 *  **먼저** 본다.
 *
 * ★제목 낱말 규칙은 **invest 갈래 안에서만** 본다(코덱스 12차 #1, 2026-09-04). W2 는 이자 칸에
 *  숫자 금리(「연 4.5%」)가 있을 때만 제목 규칙을 껐는데, 「변동금리」처럼 숫자가 없는 대출은
 *  그 그물에 안 걸려 제목의 「지원금」 하나로 「안 갚아도 됨」이 됐다(갚아야 할 돈을 공짜 돈으로
 *  읽힌다). 제목 낱말이 고치려던 것은 애초에 「invest 로 잘못 붙은 보조금」 하나뿐이라, 대출·보증
 *  갈래는 이자 칸의 「무상」만 상환 면제의 증거로 삼는다.
 *
 * 차례: grant → rateText 「무상」 → invest(숫자 금리 → 제목 낱말) → 그 밖은 이자.
 */
export function repayWords(it: FundingItem): { label: string; value: string } {
  if (it.group === "grant") return { label: "갚아야 하나", value: "안 갚아도 됨" };
  const rate = it.rateText?.trim() ?? "";
  if (rate === "무상") return { label: "갚아야 하나", value: "안 갚아도 됨" };
  if (it.group === "invest") {
    // ★이자 칸의 숫자 금리가 제목 낱말보다 먼저다(코덱스 13차 #1) — 「지원금 연계 투자대출 · 연 4.5%」
    //  는 갚는 돈이다. 제목은 사업 이름이라 「연계」된 다른 사업의 낱말이 섞여 들어온다.
    if (NUMERIC_RATE_RE.test(rate)) return { label: "이자", value: rate };
    // 갈래가 틀렸을 수 있는 자리 — 제목이 「보조금·지원금·바우처」라고 말하면 지분 양도가 아니다.
    return NO_REPAY_WORD_RE.test(it.title ?? "")
      ? { label: "갚아야 하나", value: "안 갚아도 됨" }
      : { label: "갚아야 하나", value: "지분으로 받음 (상환 없음)" };
  }
  return { label: "이자", value: rate || "공고 확인" };
}

/**
 * 화면에 나가는 **건수** 표기 — 천 단위 쉼표(`2,482`). 머리 딱지·조작줄과 같은 도우미
 * (`ui/FundingMap.tsx` 의 같은 이름)를 쓰던 자리들과 아래 줄이 같은 수를 다른 모양으로 찍던 것을
 * 막는다(브라우저 독립 검사 [낮음], 2026-09-04).
 *
 * ★**일·월·연도에는 쓰지 않는다** — `2024년` 이 `2,024년` 이 된다(설립연도·마감일 자리는 날값 그대로).
 */
const 건수 = (n: number): string => n.toLocaleString("ko-KR");

/**
 * 갈래 카드 아래 줄 — 왼쪽(shown)은 몇 건을 보여 주고 있는지, 오른쪽(excluded)은 안 맞아서 뺀
 * 건수를 여는 단추 글자(없으면 null — 화면이 단추 자체를 안 그린다).
 *
 * ★`excludedShown` 을 더했다(코덱스 11차 #15, 2026-09-04) — 안 맞음을 펼친 뒤에도 「12건 중 8건만」
 *  이라고 적어 화면에 실제로 그려진 줄 수와 개수가 안 맞았다. 두 수를 한 수로 합치지 않고
 *  「정상 N건 + 안 맞아서 뺀 K건 표시 중」으로 **따로** 말한다 — 합치면 「이 갈래 몇 건인가」가
 *  다시 흐려진다.
 *
 * @param shownCount 지금 화면에 그려진 **정상** 건수(펼치기 전엔 `block.items.length`).
 * @param excludedShown 지금 화면에 그려진 **안 맞음** 건수(보통 `block.excludedItems?.length`). 0 이면 예전 문구.
 */
export function groupFooterWords(
  block: FundingGroupBlock,
  shownCount: number,
  excludedShown = 0,
): { shown: string; excluded: string | null } {
  const shown =
    excludedShown > 0
      ? `정상 ${건수(shownCount)}건 + 안 맞아서 뺀 ${건수(excludedShown)}건 표시 중`
      : block.total === 0 ? "이 갈래에 지금 맞는 항목 없음" : shownCount === block.total
        ? `이 갈래 ${건수(block.total)}건 전부`
        : `이 갈래 ${건수(block.total)}건 중 ${건수(shownCount)}건만 보여 드림`;
  const excluded = block.excluded > 0 ? `안 맞아서 뺀 ${건수(block.excluded)}건 보기` : null;
  return { shown, excluded };
}

/** profileBandWords 가 usedProfileSummary(profile-summary.ts)의 고정 접두어를 사람 말 띠로 바꾸는 표. */
function bandEntry(entry: string): string {
  const founded = entry.match(/^설립일 (\d{4})-(\d{2})-(\d{2})$/);
  if (founded) return `${founded[1]}년 ${Number(founded[2])}월 설립`;
  if (entry === "법인 여부 법인") return "법인";
  if (entry === "법인 여부 개인") return "개인사업자";
  if (entry.startsWith("지역 ")) return entry.slice(3);
  if (entry.startsWith("업종 ")) return entry.slice(3);
  if (entry.startsWith("매출 ")) return `연매출 ${entry.slice(3)}`;
  return entry; // 직원수·체납·신용점수·기존 대출 등 나머지는 그대로(사전에 없는 항목 방어적 통과)
}

/**
 * 요약 목록 → 띠에 실제로 적을 조각들. **빈 조각은 버린다**(코덱스 2차 #7, 2026-09-04).
 *
 * 왜: `bandEntry` 는 고정 접두어를 떼어 낸다 — `"지역 "`(값이 빈 채로 접두어만 남은 줄)은 `""` 가 되고,
 * `""` 는 그대로 `""` 다. 예전엔 그 빈 조각을 그대로 이어 붙여 「이 사업장 정보로 판정: 」처럼 **라벨만
 * 남은 문장**이나 `" · 부산"` 처럼 앞에 구분점이 붙은 값이 나왔다. 조각이 하나도 안 남으면 부르는 쪽은
 * 「빈 배열과 똑같이」 다룬다.
 *
 * ★**배열이 아닌 값은 전부 빈 배열로 본다**(코덱스 3차 #A2, 2026-09-04). 서버·옛 앱이 JSON 으로
 *  `"usedProfile": null` 을 보내면 예전엔 `null.map` 에서 터져 **지도 화면 전체가 안 그려졌다**.
 *  타입은 `string[]` 이지만 통로를 건너온 값이라 타입이 지켜 주지 못한다.
 */
function bandEntries(usedProfile: string[] | null | undefined): string[] {
  if (!Array.isArray(usedProfile)) return [];
  return usedProfile.map((e) => bandEntry(e).trim()).filter((e) => e !== "");
}

/**
 * 「이 사업장 정보로 판정: …」 띠 — `usedProfile`(profile-summary.ts 의 `usedProfileSummary` 결과,
 * 대조에 실제로 쓴 칸만 있는 값만) 을 사람이 읽는 문장으로 다시 쓴다. 「대조 기준」 낱말은 쓰지 않는다
 * (계약 낱말 규칙 — G3 가 이 함수로 옛 「대조에 쓴 정보: …」 안내를 통일한다).
 */
export function profileBandWords(usedProfile: string[] | null | undefined): string {
  // 적을 조각이 0개면 빈 문자열 — 이 옛 함수는 「띠 자체를 안 그린다」는 뜻으로 계속 쓰인다.
  // (새 `profileBandParts` 는 같은 자리에서 「없음 — …」을 **말하도록** 바뀌었다. 두 함수의 뜻이
  //  이 한 자리에서만 갈리므로 값을 되받아 쓰지 않고 여기서 먼저 걸러낸다.)
  // ★빈 배열뿐 아니라 **값이 비어 있을 때도** 빈 문자열이다(코덱스 2차 #7) — `[""]`·`["지역 "]`.
  const parts = bandEntries(usedProfile);
  if (parts.length === 0) return "";
  return `이 사업장 정보로 판정: ${parts.join(" · ")}`;
}

/** 「판정에 쓴 정보」 띠의 라벨 — 라벨과 값을 따로 그리는 화면(재설계 A안)이 쓴다. */
const PROFILE_BAND_LABEL = "판정에 쓴 정보";

/**
 * 판정에 쓴 정보가 하나도 없을 때의 **값** — 코덱스 5차 #1(2026-09-04).
 *
 * 예전엔 빈 문자열이라 화면이 이 구역을 통째로 안 그렸는데, 그러면 「조건을 하나도 안 맞춰 본 목록」이
 * 아무 표식 없이 맞춤 추천처럼 보였다(아래 「자동 대조 결과입니다」와 겹쳐 더 그랬다). 「무엇을
 * 입력해 달라」(할 일)와 「이 목록은 조건을 안 맞춰 본 것」(결과의 성격)은 **다른 정보**라 빈칸 힌트가
 * 대신 말해 줄 수 없다 — 그래서 이 자리가 직접 말한다.
 */
const PROFILE_BAND_NONE = "없음 — 조건을 맞춰 보지 않은 목록입니다";

/**
 * 판정 근거 띠를 **라벨과 값 두 조각으로** 돌려준다(재설계 A안 — 라벨은 단추 줄에 올리고 값만 따로 그린다).
 *
 * `value` 는 `profileBandWords` 가 만들던 문장에서 **앞머리 라벨(「이 사업장 정보로 판정: 」)만 뺀** 부분과
 * 글자 하나까지 같다 — 두 함수가 같은 값을 두 번 만들지 않도록 `profileBandWords` 가 이 함수를 쓴다.
 *
 * 쓸 정보가 하나도 없으면(`usedProfile` 이 빈 배열) `value` 는 **`PROFILE_BAND_NONE`**(「없음 — 조건을
 * 맞춰 보지 않은 목록입니다」)이다 — 빈 문자열이 아니다(코덱스 5차 #1). 그래서 값은 **늘 있고**,
 * 화면은 이 구역을 어느 자료에서도 그린다(라벨+값이 늘 차므로 「단추만 있는 빈 구역」도 사라진다).
 * 옛 한 줄 함수 `profileBandWords` 만 0개일 때 빈 문자열을 그대로 유지한다.
 * (라벨은 값이 있든 없든 늘 같은 글자다.)
 */
export function profileBandParts(usedProfile: string[] | null | undefined): { label: string; value: string } {
  // ★빈 배열과 **값이 빈 배열**(`[""]`·`["지역 "]`)을 같게 다룬다(코덱스 2차 #7, 2026-09-04) —
  //  예전엔 뒤쪽이 라벨만 남은 빈 값으로 그려졌다.
  const parts = bandEntries(usedProfile);
  return { label: PROFILE_BAND_LABEL, value: parts.length === 0 ? PROFILE_BAND_NONE : parts.join(" · ") };
}

/**
 * 머리 카드의 「판정에 쓴 정보」 구역에 **무엇을 그릴지** — 그릴 것이 없으면 `null`(구역 자체를 안 그린다).
 *
 * 세 갈래를 가른다(코덱스 3차 #C, 2026-09-04 — 신호를 `evaluatedConditions` 에서 `profileEmpty` 로 바꿨다):
 *  · 적을 조각이 있으면 → 라벨 + 그 값(지금까지와 같다).
 *  · 조각이 하나도 없고(빈 배열·빈 값·배열 아님·응답에 없음) **`profileEmpty === true`** 면
 *    → 「없음 — 조건을 맞춰 보지 않은 목록입니다」. 회사 정보 자체가 비었으면 아무 조건도 못 맞춰
 *    본 것이 **확실하다** — 이때만 단정한다.
 *  · 그 밖에는 전부 → `null`(구역을 안 그린다). 요약이 비어도 실제로는 인증·특허·기업 규모 같은
 *    값이 판정에 쓰였을 수 있어 「없음」이 거짓일 수 있고, 옛 통로는 `profileEmpty` 를 아예 안 싣는다.
 *    **모르면 아무 말도 하지 않는다.**
 */
export function profileBandOf(
  usedProfile: string[] | null | undefined,
  profileEmpty: boolean | undefined,
): { label: string; value: string } | null {
  const parts = bandEntries(usedProfile);
  if (parts.length > 0) return { label: PROFILE_BAND_LABEL, value: parts.join(" · ") };
  return profileEmpty === true ? { label: PROFILE_BAND_LABEL, value: PROFILE_BAND_NONE } : null;
}

/**
 * 회사 정보 빈 칸 힌트 — `profileGaps`(funding-map-build.ts 의 `profileGapsOf`)를 사람 말 한 줄로.
 * 배열이 아닌 값(통로가 `null` 을 보낸 경우 등)은 빈 배열과 같게 본다(코덱스 3차 #A2).
 */
export function gapWords(profileGaps: string[] | null | undefined): string {
  if (!Array.isArray(profileGaps) || profileGaps.length === 0) return "";
  return `회사 정보에 ${profileGaps.join("·")}가 비어 있어 일부 조건은 「확인 필요」로 남습니다 — 채우면 자동 판정됩니다`;
}

/**
 * 한글 받침(종성) 판정 — 마지막 글자가 한글 음절(가~힣)이고 `(코드 − 0xAC00) % 28 !== 0` 이면 받침이 있다.
 *
 * 한글 음절이 아닌 글자(영문·숫자·기호)로 끝나거나 빈 낱말이면 **받침 없음**으로 본다 —
 * 「와/를」쪽이 한국어에서 덜 어색하게 읽히는 기본값이다.
 */
function hasJongseong(word: string): boolean {
  if (!endsWithHangulSyllable(word)) return false;
  return (word.charCodeAt(word.length - 1) - 0xac00) % 28 !== 0;
}

/**
 * 마지막 글자가 한글 음절(가~힣)인가 — **조사를 붙여도 되는 이름인지**를 가른다.
 *
 * 영문·숫자·기호로 끝나는 이름에 받침 규칙을 쓰면 틀린다(「URL를」 — 「URL을」이 맞다). 발음으로
 * 받침을 맞히려 들면 낱말마다 예외가 끝없이 생기므로, `gapParts` 는 그런 이름이 섞이면 아예
 * **조사가 안 붙는 문장 모양**으로 바꾼다(코덱스 5차 #5, 2026-09-04).
 */
function endsWithHangulSyllable(word: string): boolean {
  if (word.length === 0) return false;
  const code = word.charCodeAt(word.length - 1);
  return code >= 0xac00 && code <= 0xd7a3;
}

/** 받침 있으면 「과」, 없으면 「와」 — 낱말 두 개를 잇는 자리. */
function withWaGwa(word: string): string {
  return `${word}${hasJongseong(word) ? "과" : "와"}`;
}

/** 받침 있으면 「을」, 없으면 「를」 — 목적어 자리. */
function withEulReul(word: string): string {
  return `${word}${hasJongseong(word) ? "을" : "를"}`;
}

/**
 * `gapParts` 의 **작은 라벨** — 큰 제목 「위」에 오는 한 줄(2026-09-04 승인 시안).
 *
 * ★이 앱의 지배적 짝은 「작은 라벨 위 → 큰 값 아래」다(카드 앞면 답 네 개·숫자 카드·머리 카드 위
 *  구역이 전부 그 차례). 아래 구역만 「큰 제목 → 작은 설명」으로 거꾸로였다.
 *
 * ★옛 본문(「입력하면 조건을 더 정확하게 맞춰 볼 수 있어요」)은 **없앴다** — 그 뜻이 이 라벨 한 줄로
 *  접혔다. 줄 수는 그대로 두 줄이라 카드가 길어지지 않는다. 라벨은 결과를 약속하지 않는다
 *  (「더 정확하게 맞추려면」은 조건일 뿐 판정이 반드시 난다는 말이 아니다) — 옛 본문을 약속하지 않는
 *  말로 고쳤던 코덱스 5차 #2·2차 #6 의 이유가 그대로 살아 있다.
 */
const GAP_LABEL = "더 정확하게 맞추려면";

/**
 * 회사 정보 빈 칸 힌트를 **작은 라벨(위) + 큰 제목(할 일, 아래)** 두 조각으로 돌려준다.
 * 빠진 칸이 하나도 없으면 `null` 이다 — 화면이 상자 자체를 안 그린다.
 *
 * ★2026-09-04 승인 시안 — 옛 `{ title, body }` 를 `{ label, title }` 로 뒤집었다. 화면은 `label` 을
 *  작고 옅게 위에, `title` 을 크고 굵게 아래에 그린다(머리 카드 위 구역과 같은 차례).
 * ★호환용 `body` 는 **일부러 안 남겼다**(코덱스 13차 [높음] 판단, 2026-09-04) — 이 함수를 부르는
 *  곳이 두 앱 어디에도 없고(실측 grep 0건), 두 앱이 같은 커밋을 동시에 올리며, 배포 관문이 이
 *  패키지 시험을 직접 돌린다. 남기면 아무도 안 읽는 죽은 칸만 생긴다.
 *
 * 제목은 「…를 입력해 주세요」로 **할 일을 먼저** 말한다:
 *  · 1개  → 「신용점수를 입력해 주세요」
 *  · 2개  → 「신용점수와 기존 대출 유무를 입력해 주세요」(앞 낱말은 와/과로 잇는다)
 *  · 3개+ → 「신용점수, 기존 대출 유무, 직원 수를 입력해 주세요」(쉼표로 잇고 **마지막에만** 을/를)
 *
 * ★조사는 글자로 박지 않고 **받침으로 고른다**(`hasJongseong`). 옛 `gapWords` 는 「가」가 글자에 박혀 있어
 *  받침 있는 칸 이름이 오면 「업종가 비어 있어」로 틀렸다 — 여기엔 그 결함이 없다.
 * ★한글 음절로 끝나지 않는 이름이 **하나라도** 섞이면 위 세 모양을 안 쓰고
 *  「다음 정보를 입력해 주세요 — A, B」로 바꾼다(코덱스 5차 #5). 조사가 이름이 아니라 「정보」에
 *  붙으므로 어떤 이름이 와도 늘 옳다. 지금 쓰는 칸 이름 7개는 전부 한글이라 이 갈래로 오지 않지만,
 *  타입이 `string[]` 이라 언제든 들어올 수 있다(들어오면 「URL를 입력해 주세요」가 됐다).
 */
export function gapParts(profileGaps: string[] | null | undefined): { label: string; title: string } | null {
  // ★배열이 아닌 값(`null`·없는 칸)은 빈 배열과 같게 본다(코덱스 3차 #A2, 2026-09-04) — 통로를
  //  건너온 값이라 타입이 지켜 주지 못하고, `null.length` 는 화면 전체를 죽인다.
  if (!Array.isArray(profileGaps) || profileGaps.length === 0) return null;
  if (!profileGaps.every(endsWithHangulSyllable)) {
    return { label: GAP_LABEL, title: `다음 정보를 입력해 주세요 — ${profileGaps.join(", ")}` };
  }
  const last = profileGaps[profileGaps.length - 1];
  const head =
    profileGaps.length === 1
      ? ""
      : profileGaps.length === 2
        ? `${withWaGwa(profileGaps[0])} `
        : `${profileGaps.slice(0, -1).join(", ")}, `;
  return { label: GAP_LABEL, title: `${head}${withEulReul(last)} 입력해 주세요` };
}
