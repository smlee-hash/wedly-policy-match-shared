"use client";

// 사업자 정보 입력 — 이 화면의 주인공. 여기서 넣은 값이 매칭 진단의 입력이 된다.
// 모르는 칸은 「모름」으로 두면 그 조건은 「확인 필요」로 분류된다(모름을 통과로 치지 않는다).
// 칸은 값의 모양에 맞게 받는다(2026-10-05 사장님 지시) — 글자·숫자(쉼표·단위)·날짜·단추·칩. 셀렉트는 쓰지 않는다.
import { useEffect, useRef, useState, type InputHTMLAttributes, type ReactNode } from "react";
import { isCorporationByBizno, type BusinessProfile } from "../../engine/match-engine";
import { CERT_TYPE_NAMES, deriveProfileFlags, readRegionFromAddress } from "../../engine/profile-derive";
import type { DocumentFieldKey, DocumentPrefillResult, DocumentType } from "../../documents/types";
import { formatCount, manwonToKorean, maskBizno } from "./profile-field-format";
import DocumentUploadBox, { useDocumentUpload } from "./DocumentUploadBox";
import { focusFirstUnknown } from "./unknown-focus";
import {
  applyDocumentFields,
  choiceOptionLabel,
  choiceTitle,
  fieldValueText,
  formFieldOf,
  originChipText,
  sameFieldValue,
  type DocumentChoice,
  type FormFieldKey,
} from "./document-prefill";

/**
 * 시도 — 고객 불러오기 응답의 옛 소재지(region)가 대조 엔진의 지역 사전과 같은 줄임말일 때만 쓴다
 * (match-engine 의 REGION_ALIASES). 사람은 소재지를 시도 칸으로 고르지 않고 사업장 주소로 넣는다.
 * 「전국」은 넣지 않는다 — 회사 소재지는 한 곳이라 「전국」이 성립하지 않고,
 * 고르면 지역 조건이 전부 「확인 필요」가 되어 모름과 다를 바 없었다(2026-08-22 독립 화면 검사 3번).
 */
const SIDO = [
  "서울", "부산", "대구", "인천", "광주", "대전", "울산", "세종",
  "경기", "강원", "충북", "충남", "전북", "전남", "경북", "경남", "제주",
] as const;

/** 단추 칸의 선택지 — 앞의 값이 넘기는 값이고 빈 값이 「모름」이다. */
const CORP_OPTIONS = [["", "모름"], ["yes", "법인"], ["no", "개인"]] as const;
const SCALE_OPTIONS = [
  ["", "모름"], ["소상공인", "소상공인"], ["중소기업", "중소기업"], ["중견기업", "중견기업"], ["예비창업자", "예비창업자"],
] as const;
const TAX_OPTIONS = [["", "모름"], ["no", "없음"], ["yes", "있음"]] as const;

/** 예/아니오/모름 — 빈 값이 「모름」이다. */
type Tri = "" | "yes" | "no";

// ── 화면 계약(DESIGN.md) ────────────────────────────────────────────────
// 글자 4층: 구역 소제목 16/600 · 본문 14/400(줄간 22) · 메타·도움말 12/400(줄간 18).
// 여백 계단: 4·6·8·16·24·32 만 쓴다. 버튼 모서리 10px, 주 행동 44px·보조 40px.
// 폭은 쓰는 자리에서 붙인다 — 한 글자에 w-full 과 w-72 를 같이 넣으면 어느 쪽이 이기는지
// 클래스 순서로 정해지지 않는다.
const INPUT_BASE =
  "h-10 rounded-[10px] border border-wedly-bd bg-white px-4 text-sm text-wedly-t1 " +
  "transition-colors placeholder:text-wedly-muted focus:border-wedly-accent focus:outline-none " +
  "focus:ring-2 focus:ring-wedly-accent/40 disabled:opacity-50";
const LABEL = "block text-xs leading-[18px] text-wedly-muted";
/** 주 행동 — 화면당 하나(매칭 진단). 파랑 채움 44px. */
const BTN_PRIMARY =
  "inline-flex h-11 items-center justify-center rounded-[10px] bg-wedly-accent px-6 text-sm " +
  "font-semibold text-white transition-colors hover:bg-wedly-accent/90 focus-visible:outline-none " +
  "focus-visible:ring-2 focus-visible:ring-wedly-accent focus-visible:ring-offset-2 disabled:opacity-50";
/** 보조 행동 — 테두리형 40px. */
const BTN_SECONDARY =
  "inline-flex h-10 items-center justify-center rounded-[10px] border border-wedly-bd bg-white px-4 " +
  "text-sm text-wedly-t2 transition-colors hover:bg-wedly-bg-gray focus-visible:outline-none " +
  "focus-visible:ring-2 focus-visible:ring-wedly-accent focus-visible:ring-offset-2 disabled:opacity-50";
/** 단추·칩 한 알 — 고른 것은 파랑 테두리·옅은 파랑 바탕. 키보드로 고를 수 있게 button 이다. */
const PICK_BASE =
  "inline-flex h-8 items-center rounded-lg border px-4 text-xs transition-colors " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-wedly-accent";
const PICK_ON = `${PICK_BASE} border-wedly-accent bg-wedly-bg-blue font-semibold text-wedly-accent-ink`;
const PICK_OFF = `${PICK_BASE} border-wedly-bd bg-white text-wedly-t2 hover:bg-wedly-bg-gray`;
const SECTION = "mt-6 flex flex-wrap items-baseline justify-between gap-2 text-base font-semibold leading-6 text-wedly-t1";
/** 노란 안내 상자 — 서류마다 값이 달라 고르게 할 때. 대비가 낮아 테두리를 함께 둔다(상세 화면의 노란 상자와 같다). */
const BOX_WARN = "rounded-xl border border-[var(--wedly-gold)]/30 bg-wedly-bg-yellow px-4 py-2";

interface Props {
  onDiagnose: (profile: BusinessProfile) => Promise<boolean>;
  diagnosing: boolean;
  /**
   * 기존 고객 불러오기 통로(`GET ?query=`). **안 넘기면 검색 칸도 없고, 불러오는 코드도 돌지
   * 않는다** — 랩(`wedly-policy-lab`)엔 고객 표가 아예 없어서 이 자리가 보이면 안 된다.
   */
  prefillEndpoint?: string;
  /** 지금 진단 결과의 「확인 필요」 건수. 넘기면 「모름 N칸 → 확인 필요 M건」으로 보인다(없으면 칸 수만). */
  reviewCount?: number;
  /**
   * 서류 올리기 통로(`POST` multipart). **안 넘기면 올리기 칸이 아예 없다.**
   * 서류를 읽는 서버가 없는 앱에 있지도 않은 기능을 약속하지 않는다.
   */
  documentPrefillEndpoint?: string;
  /** 서류 올리기 안내 방식 — attach(기본): 고객 자료에 붙여 둠 · lab: 저장 안 함·사진은 글자 있는 PDF로 */
  documentPrefillMode?: "attach" | "lab";
  /** 채운 칸·모름 칸 수가 바뀔 때마다 알린다 — 결과 위 「모름 N칸 → 확인 필요 M건」 띠가 이 수를 쓴다. */
  onStatusChange?: (status: ProfileFormStatus) => void;
  /** 올라가면 접혀 있어도 펴고 첫 「모름」 칸으로 초점을 준다(결과 위 띠의 「채우기」). 0 은 아직 안 누름. */
  focusUnknownNonce?: number;
}

/** 폼 바깥(결과 위 띠)이 알아야 하는 칸 현황. */
export interface ProfileFormStatus {
  filledCount: number;
  total: number;
  unknownCount: number;
}

/** 이 너비 이하는 패널이 위아래로 쌓인다(시안 820px) — 진단 뒤 폼을 접어 결과를 위로 올린다. */
const STACK_MAX_PX = 820;

function numberOf(v: string): number | undefined {
  const t = v.replace(/[,\s]/g, "");
  if (!t) return undefined;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

function triOf(v: Tri): boolean | undefined {
  return v === "yes" ? true : v === "no" ? false : undefined;
}

/** 숫자(0 이상)를 칸에 넣을 글자로 — 쉼표 포함. 음수·이상한 값은 빈 글자(모름). */
function numText(n: number): string {
  return Number.isFinite(n) && n >= 0 ? formatCount(String(Math.round(n))) : "";
}

/**
 * 신용점수는 300~1000(NICE/KCB) 밖이면 진단에 담지 않는다.
 * 담지 않는 것까지는 맞지만 **조용히** 빼면 왜 그 조건이 「확인 필요」로 남았는지 알 수 없어
 * 화면에서 한 줄로 알린다.
 */
function outOfCreditRange(v: string): boolean {
  const n = numberOf(v);
  return n !== undefined && (n < 300 || n > 1000);
}

/** 신용점수 칸 → 진단에 담을 값. 300~1000 밖이면 담지 않는다(모름). */
function creditOf(v: string): number | undefined {
  const n = numberOf(v);
  return n !== undefined && n >= 300 && n <= 1000 ? Math.round(n) : undefined;
}

/**
 * 기존 고객 검색이 드는 상태 세 개 — **부모(ProfileForm)가 든다.**
 *
 * 검색 줄은 폼을 펼쳤을 때만 그린다. 그래서 상태를 그 줄의 부품 안에 두면
 * 「검색어 입력 → 접기 → 조건 수정」을 하는 순간 부품이 새로 태어나 **검색어와 안내가
 * 지워졌다**(2026-09-07 독립 리뷰 P3). ERP 원문은 부모가 들고 있어 접었다 펴도 남았다 —
 * 그 동작으로 되돌린다.
 *
 * 통로(endpoint)를 안 넘긴 앱에서는 `active: false` 와 **아무 것도 하지 않는** 불러오기만
 * 돌려준다. 검색 줄 자체를 안 그리니(아래 `prefill.active &&`) 불릴 일이 없고, 불려도
 * 첫 줄에서 그대로 돌아와 부르는 곳이 없다.
 */
interface CustomerPrefillState {
  /** 통로가 있어 검색 줄을 그릴 수 있는가 */
  active: boolean;
  query: string;
  setQuery: (v: string) => void;
  prefilling: boolean;
  prefillNote: string;
  loadCustomer: () => Promise<void>;
}

function useCustomerPrefill(
  endpoint: string | undefined,
  /** 불러온 값과, 불러올 때 쓴 검색어(사업자번호·상호 — 서류를 그 고객에 붙일 때 서버로 보내는 열쇠) */
  onLoad: (d: BusinessProfile, key: string) => void,
): CustomerPrefillState {
  const [query, setQuery] = useState("");
  const [prefilling, setPrefilling] = useState(false);
  const [prefillNote, setPrefillNote] = useState("");
  const latestLoad = useRef(0);

  /** 고객 불러오기 — 먼저 폼을 비우고, 아는 값만 채운다(모르는 칸은 「모름」으로 남는다). */
  const loadCustomer = async () => {
    if (!endpoint) return; // 통로가 없는 앱 — 검색 줄을 안 그리므로 여기까지 올 일도 없다
    const loadId = ++latestLoad.current;
    const t = query.trim();
    if (!t) {
      setPrefilling(false);
      setPrefillNote("사업자번호 또는 상호를 입력하세요");
      return;
    }
    setPrefilling(true);
    setPrefillNote("");
    try {
      const j = await fetch(`${endpoint}?query=${encodeURIComponent(t)}`).then((r) => r.json());
      if (loadId !== latestLoad.current) return;
      if (!j?.success) {
        setPrefillNote(j?.error?.message ?? "고객 정보를 불러오지 못했습니다");
        return;
      }
      const d = j.data as BusinessProfile | null;
      if (!d) {
        setPrefillNote("찾지 못했습니다 — 아래 칸을 직접 채워 주세요");
        return;
      }
      onLoad(d, t);
      setPrefillNote(`${d.companyName || t} 정보를 불러왔습니다 — 아는 값만 채웠습니다`);
    } catch {
      if (loadId === latestLoad.current) setPrefillNote("고객 정보를 불러오지 못했습니다");
    } finally {
      if (loadId === latestLoad.current) setPrefilling(false);
    }
  };

  return { active: Boolean(endpoint), query, setQuery, prefilling, prefillNote, loadCustomer };
}

/**
 * 기존 고객 검색 한 줄 — **통로가 있는 앱에서만** 그려진다(ProfileForm 이 조건부로 그린다).
 * 상태와 불러오는 코드는 부모가 든다(위 `useCustomerPrefill`) — 이 부품은 그리기만 한다.
 */
function CustomerPrefill({ prefill }: { prefill: CustomerPrefillState }) {
  const { query, setQuery, prefilling, prefillNote, loadCustomer } = prefill;

  return (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.nativeEvent.isComposing) void loadCustomer();
        }}
        placeholder="기존 고객 검색 (사업자번호 또는 상호)"
        className={`${INPUT_BASE} w-72 max-w-full`}
      />
      <button
        type="button"
        onClick={() => void loadCustomer()}
        disabled={prefilling}
        className={BTN_SECONDARY}
      >
        {prefilling ? "불러오는 중…" : "불러오기"}
      </button>
      {prefillNote && <span className="text-xs leading-[18px] text-wedly-t2">{prefillNote}</span>}
    </div>
  );
}

/**
 * 칸 하나의 덩어리 — 이름표·입력·아래 한 줄(안내·도움말·오류).
 * `data-k` 는 칸 열쇠(화면 이동·시험이 찾는다), `data-unk` 는 「모름」이라 흐리게 보이는 칸이다.
 * 글자·숫자 칸은 이름표(label)로, 단추·칩 칸은 묶음(group)으로 감싼다 — 단추 칸을 label 로 감싸면
 * 이름표를 눌렀을 때 첫 단추가 눌린다.
 */
function Field({
  k, label, chip, wide, group, dim, help, helpAccent, note, error, children,
}: {
  k: string;
  label: string;
  /** 이 칸 값을 준 서류 이름(출처 칩) — 서류로 채운 칸에만 붙는다 */
  chip?: string;
  wide?: boolean;
  group?: boolean;
  /** 모름이라 흐리게 보일 칸인가 */
  dim?: boolean;
  help?: string;
  /** 도움말이 「읽은 결과」일 때(지역 조건·금액) 파랑 글자 */
  helpAccent?: boolean;
  /** 옛 응답에서 온 안내(「인증 있음(종류 모름)」) — 도움말 위에 둔다 */
  note?: string;
  error?: string;
  children: ReactNode;
}) {
  const Tag = group ? "div" : "label";
  return (
    <div data-k={k} data-unk={dim ? "true" : undefined} className={wide ? "sm:col-span-2" : undefined}>
      <Tag
        className="block"
        role={group ? "group" : undefined}
        aria-label={group ? label : undefined}
      >
        {chip ? (
          <span className="flex flex-wrap items-center gap-2">
            <span className={LABEL}>{label}</span>
            <span data-src={chip} className="rounded bg-wedly-bg-blue px-2 text-xs leading-[18px] text-wedly-accent-ink">
              {chip}
            </span>
          </span>
        ) : (
          <span className={LABEL}>{label}</span>
        )}
        {/* 「모름」 칸은 투명도로 흐리지 않는다 — 글자 대비가 4.5 아래로 떨어진다(관문 axe 2.47~3.26). 표시는 data-unk 와 「모름」 단추로만. */}
        <span className="mt-1 block">{children}</span>
      </Tag>
      {note && <span className="mt-1 block text-xs leading-[18px] text-wedly-t2">{note}</span>}
      {error ? (
        <span className="mt-1 block text-xs leading-[18px] text-wedly-red">{error}</span>
      ) : help ? (
        <span className={`mt-1 block text-xs leading-[18px] ${helpAccent ? "text-wedly-accent" : "text-wedly-muted"}`}>
          {help}
        </span>
      ) : null}
    </div>
  );
}

/**
 * 서류마다 값이 달라(또는 손으로 고친 값과 달라) 어느 값을 쓸지 묻는 노란 상자.
 * 지금 칸에 들어 있는 값과 같은 단추가 눌린 것으로 보인다 — 처음엔 추천 값이 칸에 들어가 눌려 있다.
 */
function ChoiceBox({
  choice, current, onPick,
}: {
  choice: DocumentChoice;
  /** 지금 칸에 든 값 */
  current: unknown;
  /** 순번 번째 서류 값을 쓴다. -1 은 직접 넣은 값으로 되돌린다 */
  onPick: (index: number) => void;
}) {
  const handOn = choice.hand !== undefined && sameFieldValue(choice.field, choice.hand, current);
  return (
    <div data-conflict={choice.field} className={`sm:col-span-2 ${BOX_WARN}`}>
      <span className="block text-xs font-semibold leading-[18px] text-wedly-gold-ink">{choiceTitle(choice)}</span>
      <span className="mt-1 flex flex-wrap gap-1">
        {choice.hand !== undefined && (
          <button type="button" aria-pressed={handOn} onClick={() => onPick(-1)} className={handOn ? PICK_ON : PICK_OFF}>
            {`${fieldValueText(choice.field, choice.hand)} · 직접 넣은 값`}
          </button>
        )}
        {choice.options.map((o, i) => {
          const on = !handOn && sameFieldValue(choice.field, o.value, current);
          return (
            <button
              key={i}
              type="button"
              aria-pressed={on}
              onClick={() => onPick(i)}
              className={on ? PICK_ON : PICK_OFF}
            >
              {choiceOptionLabel(choice.field, o)}
            </button>
          );
        })}
      </span>
    </div>
  );
}

/** 서류가 준 인증 종류를 칩 규칙(「없음」은 다른 종류와 함께 못 둔다 — 함께 오면 종류가 이긴다)에 맞춰 정리한다. */
function certChipsOf(list: unknown): string[] {
  const known = (Array.isArray(list) ? list : []).filter((c): c is string =>
    (CERT_TYPE_NAMES as readonly string[]).includes(c),
  );
  const named = known.filter((c, i) => c !== "없음" && known.indexOf(c) === i);
  return named.length > 0 ? named : known.includes("없음") ? ["없음"] : [];
}

/** 입력 한 줄 — 뒤에 단위(만원·명·건·점)가 붙을 수 있다. */
function InputRow({ suffix, ...input }: { suffix?: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <span className="flex items-center gap-2">
      <input {...input} className={`${INPUT_BASE} min-w-0 flex-1`} />
      {suffix && <span className="shrink-0 text-xs leading-[18px] text-wedly-muted">{suffix}</span>}
    </span>
  );
}

/** 하나만 고르는 단추 줄 — 고른 단추는 aria-pressed. 빈 값이 「모름」. */
function Segmented({
  options, value, onPick,
}: {
  options: readonly (readonly [string, string])[];
  value: string;
  onPick: (v: string) => void;
}) {
  return (
    <span className="flex flex-wrap gap-1">
      {options.map(([v, text]) => (
        <button
          key={v || "unknown"}
          type="button"
          aria-pressed={value === v}
          onClick={() => onPick(v)}
          className={value === v ? PICK_ON : PICK_OFF}
        >
          {text}
        </button>
      ))}
    </span>
  );
}

/** 여러 개 고르는 칩 줄 — 고른 칩은 aria-pressed. */
function ChipGroup({
  names, selected, onToggle,
}: {
  names: readonly string[];
  selected: readonly string[];
  onToggle: (name: string) => void;
}) {
  return (
    <span className="flex flex-wrap gap-1">
      {names.map((name) => (
        <button
          key={name}
          type="button"
          aria-pressed={selected.includes(name)}
          onClick={() => onToggle(name)}
          className={selected.includes(name) ? PICK_ON : PICK_OFF}
        >
          {name}
        </button>
      ))}
    </span>
  );
}

export default function ProfileForm({
  onDiagnose, diagnosing, prefillEndpoint, reviewCount, documentPrefillEndpoint, documentPrefillMode,
  onStatusChange, focusUnknownNonce,
}: Props) {
  const [open, setOpen] = useState(true);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const [companyName, setCompanyName] = useState("");
  const [bizno, setBizno] = useState(""); // 하이픈 들어간 모양(000-00-00000)으로 든다
  const [isCorp, setIsCorp] = useState<Tri>(""); // yes=법인 · no=개인
  const [industry, setIndustry] = useState("");
  const [businessAddress, setBusinessAddress] = useState("");
  // 불러온 고객의 옛 소재지(시도·시군구). 칸은 없고 값만 통과시킨다(리뷰 F1) — 사람이 주소를 고치면 비운다.
  // 주소가 있으면 진단 직전에 deriveProfileFlags 가 주소에서 읽은 값으로 덮는다.
  const [region, setRegion] = useState("");
  const [regionSigungu, setRegionSigungu] = useState<string>("");
  const [foundedDate, setFoundedDate] = useState("");
  const [revenueManwon, setRevenueManwon] = useState("");
  const [employeeCount, setEmployeeCount] = useState("");
  const [companyScale, setCompanyScale] = useState("");
  const [taxDelinquent, setTaxDelinquent] = useState<Tri>("");
  const [certTypes, setCertTypes] = useState<string[]>([]);
  const [patentCount, setPatentCount] = useState("");
  // ── 자금 조달 지도(2026-09-03) — 상시 대출·보증 상품 판정에 쓰는 칸들.
  // 사람이 직접 넣는다(자동 조회하지 않는다). 비우면 그 조건만 「확인 필요」로 남는다.
  const [loanManwon, setLoanManwon] = useState("");
  const [creditNice, setCreditNice] = useState("");
  const [creditKcb, setCreditKcb] = useState("");
  // 옛 응답에 「있음」만 오고 종류·건수·잔액을 모를 때의 옛 값. 칸은 비워 두고 안내만 보인다.
  // 진단에는 옛 값이 그대로 간다(deriveProfileFlags: 새 칸이 비면 옛 값을 유지한다).
  const [legacyHasCert, setLegacyHasCert] = useState<boolean | undefined>(undefined);
  const [legacyHasPatent, setLegacyHasPatent] = useState<boolean | undefined>(undefined);
  const [legacyHasLoan, setLegacyHasLoan] = useState<boolean | undefined>(undefined);

  // ── 서류 올리기 — 읽은 값은 비어 있는 칸에만 채우고, 사람이 손으로 고친 칸은 덮지 않는다.
  const touchedRef = useRef<Set<DocumentFieldKey>>(new Set()); // 손으로 고친 칸 — 다시 렌더할 일이 없어 ref
  const [origins, setOrigins] = useState<Partial<Record<DocumentFieldKey, DocumentType[]>>>({}); // 칸 옆 출처 칩
  const [choices, setChoices] = useState<DocumentChoice[]>([]); // 어느 값을 쓸지 묻는 노란 상자
  const [docFilled, setDocFilled] = useState<FormFieldKey[]>([]); // 서류로 채운 화면 칸(아래 「M칸」)
  const [docFileCount, setDocFileCount] = useState(0); // 칸을 채워 준 서류 수(아래 「N개」)
  const [customerKey, setCustomerKey] = useState(""); // 고객을 불러온 상태의 검색어 — 서류를 그 고객에 붙이는 열쇠
  const loadedBiznoRef = useRef(""); // 불러온 고객의 사업자번호(숫자만) — 이 번호에서 벗어나면 다른 회사라 열쇠를 비운다
  const applyDocumentsRef = useRef<(r: DocumentPrefillResult) => void>(() => {});
  /**
   * 사업자번호 칸에 값을 넣는 **단 하나의 길** — 직접 입력·서류 적용·고르는 상자가 모두 여기로 온다.
   * 불러온 고객의 번호와 달라지면 다른 회사이므로 서류를 그 고객 자료에 붙이는 열쇠를 비운다.
   */
  const setBiznoValue = (masked: string) => {
    setBizno(masked);
    if (masked.replace(/\D/g, "") !== loadedBiznoRef.current) setCustomerKey("");
  };
  const doc = useDocumentUpload({
    endpoint: documentPrefillEndpoint,
    // 칸 값이 불러온 번호에서 벗어나 있으면 열쇠를 싣지 않는다 — 어느 길로 바뀌었든 올리는 순간에도 한 번 더 막는다.
    customerKey: bizno.replace(/\D/g, "") === loadedBiznoRef.current ? customerKey : "",
    onResult: (r) => applyDocumentsRef.current(r), // 올리는 사이 칸이 바뀌어도 가장 최근 칸 값으로 합친다
  });

  const dropOrigin = (...keys: DocumentFieldKey[]) =>
    setOrigins((prev) => {
      if (!keys.some((k) => k in prev)) return prev;
      const rest = { ...prev };
      for (const k of keys) delete rest[k];
      return rest;
    });
  /** 사람이 이 칸을 직접 고쳤다 — 서류가 덮어쓰지 못하게 표시하고, 서류 출처 칩은 뗀다. */
  const hand = (...keys: DocumentFieldKey[]) => {
    for (const k of keys) touchedRef.current.add(k);
    dropOrigin(...keys);
  };

  const biznoDigits = bizno.replace(/\D/g, "");
  const revenueNum = numberOf(revenueManwon);
  const employeeNum = numberOf(employeeCount);
  const patentNum = numberOf(patentCount);
  const loanNum = numberOf(loanManwon);
  const niceScore = creditOf(creditNice);
  const kcbScore = creditOf(creditKcb);

  // 주소 → 지역 조건. 주소를 못 읽으면 불러온 옛 소재지(있다면)를 보인다.
  const addressRead = readRegionFromAddress(businessAddress);
  const regionText = addressRead.shortAddress
    ? addressRead.shortAddress.replace(" ", " · ")
    : !businessAddress.trim() && region
      ? [region, regionSigungu].filter(Boolean).join(" · ")
      : "";

  /** 칸마다 「채웠나」 — 15칸. 범위 밖 신용점수·10자리가 안 되는 사업자번호는 진단에 안 담기므로 안 센다. */
  const filled = [
    companyName.trim() !== "",
    biznoDigits.length === 10,
    isCorp !== "",
    industry.trim() !== "",
    regionText !== "",
    foundedDate !== "",
    revenueNum !== undefined,
    employeeNum !== undefined,
    companyScale !== "",
    taxDelinquent !== "",
    certTypes.length > 0 || legacyHasCert !== undefined,
    patentNum !== undefined || legacyHasPatent !== undefined,
    loanNum !== undefined || legacyHasLoan !== undefined,
    niceScore !== undefined,
    kcbScore !== undefined,
  ];
  const filledCount = filled.filter(Boolean).length;
  const unknownCount = filled.length - filledCount;

  /** 화면 값 → 진단 입력. 빈 칸은 아예 담지 않는다(담으면 「모름」이 「충족」으로 둔갑한다). */
  const buildProfile = (): BusinessProfile => {
    const p: BusinessProfile = {};
    if (companyName.trim()) p.companyName = companyName.trim();
    if (biznoDigits.length === 10) p.bizno = bizno; // 10자리가 안 되면 담지 않는다(칸 아래에서 알린다)
    const corp = triOf(isCorp);
    if (corp !== undefined) p.isCorporation = corp;
    if (industry.trim()) p.industry = industry.trim();
    // 주소는 시도+시군구까지만 싣는다(도로명·번지는 진단에 필요 없고 담지 않는 것이 약속이다).
    if (addressRead.shortAddress) p.businessAddress = addressRead.shortAddress;
    if (region) p.region = region;
    if (regionSigungu.trim()) p.regionSigungu = regionSigungu.trim();
    if (foundedDate) p.foundedDate = foundedDate;
    if (revenueNum !== undefined) p.lastYearRevenueKrw = Math.round(revenueNum * 10_000); // 만원 → 원
    if (employeeNum !== undefined) p.employeeCount = Math.floor(employeeNum);
    if (companyScale) p.companyScale = companyScale;
    const tax = triOf(taxDelinquent);
    if (tax !== undefined) p.taxDelinquent = tax;
    if (certTypes.length > 0) p.certTypes = [...certTypes];
    else if (legacyHasCert !== undefined) p.hasCert = legacyHasCert;
    if (patentNum !== undefined) p.patentCount = Math.floor(patentNum);
    else if (legacyHasPatent !== undefined) p.hasPatent = legacyHasPatent;
    if (loanNum !== undefined) p.existingLoanBalanceManwon = Math.round(loanNum);
    else if (legacyHasLoan !== undefined) p.hasExistingLoan = legacyHasLoan;
    // 신용점수는 300~1000 안의 값만 담는다 — 밖의 값을 담으면 상품 판정이 엉뚱해진다.
    if (niceScore !== undefined) p.creditScoreNice = niceScore;
    if (kcbScore !== undefined) p.creditScoreKcb = kcbScore;
    return p;
  };

  /**
   * 서류 값과 맞대어 볼 현재 칸 — 진단용 값(buildProfile)에 **사람이 쓰던 원문**을 되살려 얹는다.
   * 10자리를 못 채운 사업자번호·읽지 못한 주소는 진단에는 안 담기지만, 서류가 와서 덮어쓰면 쓰던 글자가 날아간다.
   */
  const buildProfileWithRaw = (): BusinessProfile => {
    const p = buildProfile();
    if (biznoDigits.length > 0 && biznoDigits.length < 10) p.bizno = bizno;
    if (businessAddress.trim() && !p.businessAddress) p.businessAddress = businessAddress.trim();
    return p;
  };

  /**
   * 모든 칸을 비운다(= 전부 「모름」).
   * 새 고객을 불러올 때 먼저 비우지 않으면 **앞 고객의 값이 남아** 엉뚱한 회사 조건으로 진단된다
   * (2026-08-22 리뷰 9번).
   */
  const clearFields = () => {
    setCompanyName("");
    setBizno("");
    setIsCorp("");
    setIndustry("");
    setBusinessAddress("");
    setRegion("");
    setRegionSigungu("");
    setFoundedDate("");
    setRevenueManwon("");
    setEmployeeCount("");
    setCompanyScale("");
    setTaxDelinquent("");
    setCertTypes([]);
    setPatentCount("");
    setLoanManwon("");
    setCreditNice("");
    setCreditKcb("");
    setLegacyHasCert(undefined);
    setLegacyHasPatent(undefined);
    setLegacyHasLoan(undefined);
    // 서류 쪽 흔적도 함께 비운다 — 앞 고객 서류의 출처 칩·고르는 상자·목록이 남으면 안 된다.
    touchedRef.current.clear();
    setOrigins({});
    setChoices([]);
    setDocFilled([]);
    setDocFileCount(0);
    setCustomerKey("");
    loadedBiznoRef.current = "";
    doc.reset(); // 올리는 중이던 앞 고객 서류는 끊고, 늦게 오는 답은 버린다
  };

  /** 서류가 준 값 하나를 그 칸에 넣는다(칸 형식 규칙은 손으로 넣을 때와 같다). */
  const writeDocField = (key: DocumentFieldKey, value: unknown) => {
    switch (key) {
      case "bizno": {
        const masked = maskBizno(String(value));
        setBiznoValue(masked);
        // 번호가 법인·개인을 가른다 — 손으로 고른 법인·개인이 있으면 그것을 지킨다.
        const byBizno = isCorporationByBizno(masked);
        if (byBizno !== null && !touchedRef.current.has("isCorporation")) setIsCorp(byBizno ? "yes" : "no");
        return;
      }
      case "industry":
        setIndustry(String(value));
        return;
      case "businessAddress":
        setBusinessAddress(String(value));
        setRegion(""); // 주소 글자가 시도·시군구를 정한다 — 옛 소재지는 비운다
        setRegionSigungu("");
        return;
      case "region":
        if ((SIDO as readonly string[]).includes(String(value))) setRegion(String(value));
        return;
      case "regionSigungu":
        setRegionSigungu(String(value));
        return;
      case "foundedDate":
        setFoundedDate(String(value));
        return;
      case "lastYearRevenueKrw":
        setRevenueManwon(numText(Number(value) / 10_000));
        return;
      case "employeeCount":
        setEmployeeCount(numText(Number(value)));
        return;
      case "companyScale": {
        const scale = value === "중견" ? "중견기업" : String(value); // 엔진 표기와 단추 이름의 차이
        if (SCALE_OPTIONS.some(([v]) => v === scale)) setCompanyScale(scale);
        return;
      }
      case "isCorporation":
        setIsCorp(value ? "yes" : "no");
        return;
      case "taxDelinquent":
        setTaxDelinquent(value ? "yes" : "no");
        return;
      case "certTypes":
        setCertTypes(certChipsOf(value));
        setLegacyHasCert(undefined);
        return;
      case "hasCert": // 서류가 「없음」을 분명히 말할 때만 온다
        if (value === false) setCertTypes(["없음"]);
        else setLegacyHasCert(true);
        return;
      case "patentCount":
        setPatentCount(numText(Number(value)));
        setLegacyHasPatent(undefined);
        return;
      case "hasPatent":
        if (value === false) setPatentCount("0");
        else setLegacyHasPatent(true);
        return;
    }
  };

  /** 서버가 읽어 온 결과를 칸에 합친다 — 합치는 규칙은 applyDocumentFields(순수 함수)가 정한다. */
  const applyDocuments = (result: DocumentPrefillResult) => {
    const out = applyDocumentFields(buildProfileWithRaw(), result, touchedRef.current);
    const filled = new Set(out.filled);
    for (const key of out.filled) {
      // 주소·종류·건수가 같이 오면 그쪽이 시도·시군구·있음·없음을 정한다.
      if ((key === "region" || key === "regionSigungu") && filled.has("businessAddress")) continue;
      if (key === "hasCert" && filled.has("certTypes")) continue;
      if (key === "hasPatent" && filled.has("patentCount")) continue;
      writeDocField(key, out.next[key]);
    }
    setOrigins((prev) => ({ ...prev, ...out.origins }));
    // 이번 서류가 다시 말한 칸의 앞 상자는 새 상자로 바꾼다.
    const mentioned = new Set(Object.keys(result.fields));
    setChoices((prev) => [...prev.filter((c) => !mentioned.has(c.field)), ...out.choices]);
    setDocFilled((prev) => Array.from(new Set([...prev, ...out.filled.map(formFieldOf)])));
    setDocFileCount((n) => n + result.files.filter((f) => f.status === "read" || f.status === "read-by-ai").length);
  };
  applyDocumentsRef.current = applyDocuments;

  /** 노란 상자에서 값을 골랐다 — 그 값을 칸에 넣고, 고른 서류를 출처로 한다(-1 은 직접 넣은 값). */
  const pickChoice = (choice: DocumentChoice, index: number) => {
    if (index < 0 || !choice.options[index]) {
      if (choice.hand !== undefined) writeDocField(choice.field, choice.hand);
      hand(choice.field);
      return;
    }
    const option = choice.options[index];
    writeDocField(choice.field, option.value);
    hand(choice.field); // 사람이 정했다 — 다음 서류가 덮지 않는다
    setOrigins((prev) => ({ ...prev, [choice.field]: [...option.docTypes] }));
  };

  /**
   * 불러온 고객 값을 칸에 채운다 — 먼저 전부 비우고, 아는 값만(모르는 칸은 「모름」으로 남는다).
   * 옛 응답(인증·특허·대출이 예/아니오, 신용점수 하나)은 새 칸으로 옮긴다. 새 칸이 응답에 있으면 그대로 채운다.
   */
  const applyCustomer = (d: BusinessProfile, key: string) => {
    setOpen(true);
    clearFields(); // 앞 고객 값이 남아 섞이지 않게 먼저 비운다
    setCustomerKey(key); // 이제부터 올리는 서류는 이 고객 자료에 붙는다(ERP·컨설턴트 앱)
    loadedBiznoRef.current = d.bizno ? maskBizno(d.bizno).replace(/\D/g, "") : ""; // 칸에 들어가는 모양(최대 10자리)과 같게 맞춘다
    if (d.companyName) setCompanyName(d.companyName);
    // 법인 여부 — 사업자번호가 가르면 그것이 이긴다(엔진의 corporationOf 와 같은 순서).
    let corp: Tri = "";
    if (d.bizno) {
      const masked = maskBizno(d.bizno);
      setBizno(masked);
      const byBizno = isCorporationByBizno(masked);
      if (byBizno !== null) corp = byBizno ? "yes" : "no";
    }
    if (corp === "" && typeof d.isCorporation === "boolean") corp = d.isCorporation ? "yes" : "no";
    if (corp !== "") setIsCorp(corp);
    if (d.industry) setIndustry(d.industry);
    if (d.businessAddress) setBusinessAddress(d.businessAddress);
    // 사전에 없는 표기가 오면 쓰지 않는다 — 있는 표기일 때만 넣는다.
    if (d.region && (SIDO as readonly string[]).includes(d.region)) setRegion(d.region);
    // 칸은 만들지 않고 값만 통과시킨다(리뷰 F1). 없으면 비운다 — 앞 고객 값이 남으면 안 된다.
    setRegionSigungu(typeof d.regionSigungu === "string" ? d.regionSigungu : "");
    if (d.foundedDate) setFoundedDate(d.foundedDate);
    if (typeof d.lastYearRevenueKrw === "number") setRevenueManwon(numText(d.lastYearRevenueKrw / 10_000));
    if (typeof d.employeeCount === "number") setEmployeeCount(numText(d.employeeCount));
    if (d.companyScale) setCompanyScale(d.companyScale);
    if (typeof d.taxDelinquent === "boolean") setTaxDelinquent(d.taxDelinquent ? "yes" : "no");

    // 보유 인증 — 종류가 오면 칩으로. 「없음」은 다른 종류와 함께 오면 종류가 이긴다(deriveProfileFlags 와 같다).
    const known = (Array.isArray(d.certTypes) ? d.certTypes : []).filter((c) =>
      (CERT_TYPE_NAMES as readonly string[]).includes(c),
    );
    const named = known.filter((c, i) => c !== "없음" && known.indexOf(c) === i);
    if (named.length > 0) setCertTypes(named);
    else if (known.includes("없음")) setCertTypes(["없음"]);
    else if (d.hasCert === false) setCertTypes(["없음"]);
    else if (d.hasCert === true) setLegacyHasCert(true); // 종류를 모른다 — 칩은 비우고 안내만

    if (typeof d.patentCount === "number") setPatentCount(numText(d.patentCount));
    else if (d.hasPatent === false) setPatentCount("0");
    else if (d.hasPatent === true) setLegacyHasPatent(true);

    if (typeof d.existingLoanBalanceManwon === "number") setLoanManwon(numText(d.existingLoanBalanceManwon));
    else if (d.hasExistingLoan === false) setLoanManwon("0");
    else if (d.hasExistingLoan === true) setLegacyHasLoan(true);

    // 신용점수 — 새 두 칸이 하나라도 있으면 그대로. 옛 점수 하나만 오면 NICE 칸에 둔다.
    const hasNewScore = typeof d.creditScoreNice === "number" || typeof d.creditScoreKcb === "number";
    if (typeof d.creditScoreNice === "number") setCreditNice(String(d.creditScoreNice));
    if (typeof d.creditScoreKcb === "number") setCreditKcb(String(d.creditScoreKcb));
    if (!hasNewScore && typeof d.creditScore === "number") setCreditNice(String(d.creditScore));
  };

  // 검색 상태는 여기(부모)서 든다 — 폼을 접으면 아래 검색 줄은 사라지지만 검색어·안내는 남는다.
  const prefill = useCustomerPrefill(prefillEndpoint, applyCustomer);

  /** 진단·자금 지도에 넘기기 직전에 deriveProfileFlags 를 거친다 — 엔진이 읽는 칸(hasCert·hasPatent·creditScore·region …)이 채워진다. */
  const runDiagnose = async () => {
    const ok = await onDiagnose(deriveProfileFlags(buildProfile()));
    // 쌓이는 좁은 화면에서만 접는다 — 넓은 화면은 패널이 왼쪽에 서 있어 접을 이유가 없다.
    // 창이 없는 곳(서버 그리기·시험)은 예전처럼 접는다. 「조건 수정」으로 다시 편다.
    const stacked = typeof window === "undefined" || window.innerWidth <= STACK_MAX_PX;
    if (ok && stacked) setOpen(false);
  };

  // 칸 현황을 바깥에 알린다 — 부모가 같은 수로 띠를 그린다.
  useEffect(() => {
    onStatusChange?.({ filledCount, total: filled.length, unknownCount });
  }, [onStatusChange, filledCount, filled.length, unknownCount]);

  // 「채우기」 — 접혀 있으면 펴고, 칸이 그려진 다음 첫 모름 칸으로 간다(펴는 렌더 뒤에 다시 이 효과가 돈다).
  const pendingFocus = useRef(false);
  useEffect(() => {
    if (!focusUnknownNonce) return;
    pendingFocus.current = true;
    setOpen(true);
  }, [focusUnknownNonce]);
  useEffect(() => {
    if (!pendingFocus.current || !open) return;
    pendingFocus.current = false;
    focusFirstUnknown(rootRef.current);
  });

  const toggleCert = (name: string) => {
    hand("certTypes", "hasCert");
    setLegacyHasCert(undefined); // 사람이 직접 고르면 옛 안내는 거둔다
    setCertTypes((prev) => {
      if (name === "없음") return prev.includes("없음") ? [] : ["없음"]; // 「없음」은 나머지를 끈다
      const rest = prev.filter((c) => c !== "없음"); // 다른 칩은 「없음」을 끈다
      return rest.includes(name) ? rest.filter((c) => c !== name) : [...rest, name];
    });
  };

  const summary = [
    companyName.trim(),
    regionText.replace(" · ", " "),
    industry.trim(),
    foundedDate ? `설립 ${foundedDate}` : "",
    employeeCount ? `${employeeCount}명` : "",
  ].filter(Boolean).join(" · ");

  // 서류로 채운 칸의 출처 칩 글자 — 서류 종류 이름. 손으로 고치면 칩이 떨어진다.
  const chipOf = (form: FormFieldKey): string | undefined => {
    for (const k of Object.keys(origins) as DocumentFieldKey[]) {
      if (formFieldOf(k) !== form) continue;
      const text = originChipText(origins[k]);
      if (text) return text;
    }
    return undefined;
  };
  // 그 칸의 「서류마다 달라요」 노란 상자 — 칸 아래 전폭으로 끼운다.
  const nowProfile = buildProfileWithRaw(); // 쓰던 원문이 있는 칸은 「직접 넣은 값」 단추가 눌린 것으로 보인다
  const choiceFor = (form: FormFieldKey) => {
    const c = choices.find((x) => formFieldOf(x.field) === form);
    return c ? <ChoiceBox choice={c} current={nowProfile[c.field]} onPick={(i) => pickChoice(c, i)} /> : null;
  };
  const docFilledCount = docFilled.length;

  return (
    // 넓은 화면(>820px)에서는 왼쪽 고정 패널이다 — 뿌리가 화면 높이를 넘지 않게 하고, 칸 묶음만 안쪽에서
    // 스크롤하며(아래 body), 매칭 진단 단추는 스크롤 밖 바닥(footer)에 붙여 둔다. 좁은 화면은 그냥 쌓인다.
    <div
      ref={rootRef}
      className="flex flex-col rounded-2xl border border-wedly-bd bg-white shadow-sm min-[821px]:max-h-[calc(100vh-2rem)]"
    >
      <div className="flex flex-wrap items-center gap-2 p-4">
        <span className="text-base font-semibold leading-6 text-wedly-t1">사업자 정보</span>
        <span className="text-xs leading-[18px] text-wedly-muted">
          입력하면 자격이 맞는 지원정책을 찾아 드립니다
        </span>
        <button type="button" onClick={() => setOpen((v) => !v)} className={`ml-auto ${BTN_SECONDARY}`}>
          {open ? "접기" : "조건 수정"}
        </button>
      </div>

      {!open && (
        // 접힌 상태에서도 바로 다시 돌릴 수 있어야 한다 — 공고 읽기가 진행 중이면 결과가 늘어난다.
        // 요약은 조용한 회색 층 한 줄(상세의 회색 층과 같은 언어), 다시 진단은 보조 버튼.
        <div className="flex flex-wrap items-center gap-4 px-4 pb-4">
          {summary && (
            <div className="min-w-0 flex-1 truncate rounded-xl bg-wedly-bg-gray px-4 py-2 text-sm leading-[22px] text-wedly-t2">
              {summary}
            </div>
          )}
          <button
            type="button"
            onClick={() => void runDiagnose()}
            disabled={diagnosing}
            className={BTN_SECONDARY}
          >
            {diagnosing ? "진단 중…" : "다시 진단"}
          </button>
        </div>
      )}

      {open && (
        <>
          {/* 칸 묶음 — 길면 이 안에서만 스크롤한다(바닥 진단 단추는 밖) */}
          <div data-panel="body" className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
          {/* 서류 올리기 — 통로(documentPrefillEndpoint)를 안 넘긴 앱에는 이 칸이 아예 없다. 맨 위에 둔다. */}
          {documentPrefillEndpoint && (
            <DocumentUploadBox
              files={doc.files}
              busy={doc.busy}
              error={doc.error}
              attached={doc.attached}
              attachNote={doc.attachNote}
              mode={documentPrefillMode}
              onPick={(picked) => void doc.upload(picked)}
              onRemove={doc.remove}
            />
          )}

          {/* 통로를 안 넘긴 앱(랩)에는 이 줄이 아예 없다 — 있지도 않은 고객 표를 약속하지 않는다. */}
          {prefill.active && <CustomerPrefill prefill={prefill} />}

          {/* 구역 소제목 — 첫 구역 오른쪽에 채운 칸 수와 모름 칸 수를 보인다 */}
          <div className={SECTION}>
            <span>기본</span>
            <span className="text-xs font-normal leading-[18px] text-wedly-muted">
              {`채운 칸 ${filledCount} / ${filled.length}`}
            </span>
          </div>
          <p className="mt-1 text-xs leading-[18px] text-wedly-muted">
            {reviewCount === undefined
              ? `모름 ${unknownCount}칸`
              : `모름 ${unknownCount}칸 → 확인 필요 ${formatCount(String(reviewCount))}건`}
          </p>

          {/* 칸 사이 가로·세로 16 */}
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field k="name" label="상호" wide>
              <InputRow
                value={companyName}
                onChange={(e) => {
                  setCompanyName(e.target.value);
                  // 상호만 다른 회사로 고치면 **앞 고객의 번호가 그대로 실려 나간다**.
                  // 손으로 고치는 순간 사업자번호를 비운다 — 불러오기로는 다시 채워진다
                  // (2026-08-22 독립 화면 검사 5번).
                  setBizno("");
                  dropOrigin("bizno");
                  setCustomerKey(""); // 다른 회사로 고쳤으니 서류를 앞 고객 자료에 붙이지 않는다
                  doc.reset(); // 올리는 중이던 서류는 끊고 늦게 오는 답은 버린다. 올린 파일 목록도 비운다(고객을 새로 불러올 때와 같은 길)
                }}
                placeholder="예: 가상테크"
              />
            </Field>
            <Field
              k="bizno"
              label="사업자번호"
              chip={chipOf("bizno")}
              error={
                biznoDigits.length > 0 && biznoDigits.length < 10
                  ? "10자리를 모두 넣어 주세요 — 지금은 모름으로 처리됩니다"
                  : undefined
              }
            >
              <InputRow
                inputMode="numeric"
                maxLength={12}
                value={bizno}
                onChange={(e) => {
                  const masked = maskBizno(e.target.value);
                  setBiznoValue(masked); // 불러온 번호에서 벗어나면 열쇠도 비운다(서류가 번호를 바꿀 때와 같은 길)
                  hand("bizno");
                  // 10자리가 되면 번호 가운데 두 자리로 법인·개인을 맞춘다(못 가르면 모름).
                  if (masked.replace(/\D/g, "").length === 10) {
                    const byBizno = isCorporationByBizno(masked);
                    setIsCorp(byBizno === null ? "" : byBizno ? "yes" : "no");
                    dropOrigin("isCorporation"); // 번호가 맞춘 값이라 서류 출처가 아니다
                  }
                }}
                placeholder="000-00-00000"
              />
            </Field>
            {choiceFor("bizno")}
            <Field k="corp" label="법인·개인" chip={chipOf("corp")} group dim={isCorp === ""} help="사업자번호를 넣으면 자동">
              <Segmented
                options={CORP_OPTIONS}
                value={isCorp}
                onPick={(v) => {
                  setIsCorp(v as Tri);
                  hand("isCorporation");
                }}
              />
            </Field>
            {choiceFor("corp")}
            <Field k="industry" label="주업종" chip={chipOf("industry")} wide>
              <InputRow
                value={industry}
                onChange={(e) => {
                  setIndustry(e.target.value);
                  hand("industry");
                }}
                placeholder="예: 전자부품 제조업"
              />
            </Field>
            {choiceFor("industry")}
            <Field
              k="address"
              label="사업장 주소"
              chip={chipOf("address")}
              wide
              help={regionText ? `지역 조건: ${regionText}` : "주소를 넣으면 시도·시군구를 읽어 지역 조건에 씁니다"}
              helpAccent={regionText !== ""}
            >
              <InputRow
                value={businessAddress}
                onChange={(e) => {
                  setBusinessAddress(e.target.value);
                  // 사람이 주소를 직접 고치면 불러온 옛 소재지와 어긋난다 — 비운다(리뷰 F1).
                  setRegion("");
                  setRegionSigungu("");
                  hand("businessAddress", "region", "regionSigungu");
                }}
                placeholder="예: 경기 화성시 동탄대로 000"
              />
            </Field>
            {choiceFor("address")}
            <Field k="founded" label="설립일(개업일)" chip={chipOf("founded")}>
              <InputRow
                type="date"
                value={foundedDate}
                onChange={(e) => {
                  setFoundedDate(e.target.value);
                  hand("foundedDate");
                }}
              />
            </Field>
            {choiceFor("founded")}
          </div>

          <div className={SECTION}>
            <span>규모</span>
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field
              k="revenue"
              label="작년 연매출"
              chip={chipOf("revenue")}
              help={revenueNum !== undefined ? `= ${manwonToKorean(revenueNum)}` : "세금 신고 매출 기준"}
              helpAccent={revenueNum !== undefined}
            >
              <InputRow
                inputMode="numeric"
                value={revenueManwon}
                onChange={(e) => {
                  setRevenueManwon(formatCount(e.target.value));
                  hand("lastYearRevenueKrw");
                }}
                placeholder="예: 120,000"
                suffix="만원"
              />
            </Field>
            {choiceFor("revenue")}
            <Field k="employees" label="직원 수" chip={chipOf("employees")} help="4대보험 가입 인원">
              <InputRow
                inputMode="numeric"
                value={employeeCount}
                onChange={(e) => {
                  setEmployeeCount(formatCount(e.target.value));
                  hand("employeeCount");
                }}
                placeholder="예: 8"
                suffix="명"
              />
            </Field>
            {choiceFor("employees")}
            <Field k="scale" label="기업 규모" chip={chipOf("scale")} wide group dim={companyScale === ""}>
              <Segmented
                options={SCALE_OPTIONS}
                value={companyScale}
                onPick={(v) => {
                  setCompanyScale(v);
                  hand("companyScale");
                }}
              />
            </Field>
            {choiceFor("scale")}
          </div>

          <div className={SECTION}>
            <span>체납·인증·대출 · 모르면 비워 두세요</span>
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field k="tax" label="세금·4대보험 체납" chip={chipOf("tax")} wide group dim={taxDelinquent === ""}>
              <Segmented
                options={TAX_OPTIONS}
                value={taxDelinquent}
                onPick={(v) => {
                  setTaxDelinquent(v as Tri);
                  hand("taxDelinquent");
                }}
              />
            </Field>
            {choiceFor("tax")}
            <Field
              k="cert"
              label="보유 인증 (여러 개 고르기)"
              chip={chipOf("cert")}
              wide
              group
              dim={certTypes.length === 0}
              note={legacyHasCert ? "인증 있음(종류 모름)" : undefined}
            >
              <ChipGroup names={CERT_TYPE_NAMES} selected={certTypes} onToggle={toggleCert} />
            </Field>
            {choiceFor("cert")}
            <Field
              k="patent"
              label="특허·지재권"
              chip={chipOf("patent")}
              dim={patentCount === ""}
              note={legacyHasPatent ? "특허 있음(건수 모름)" : undefined}
              help="없으면 0"
            >
              <InputRow
                inputMode="numeric"
                value={patentCount}
                onChange={(e) => {
                  setPatentCount(formatCount(e.target.value));
                  setLegacyHasPatent(undefined);
                  hand("patentCount", "hasPatent");
                }}
                placeholder="모름"
                suffix="건"
              />
            </Field>
            {choiceFor("patent")}
            <Field
              k="loan"
              label="기존 대출 잔액"
              dim={loanManwon === ""}
              note={legacyHasLoan ? "대출 있음(잔액 모름)" : undefined}
              help="정책자금·기업대출 합계 · 없으면 0"
            >
              <InputRow
                inputMode="numeric"
                value={loanManwon}
                onChange={(e) => {
                  setLoanManwon(formatCount(e.target.value));
                  setLegacyHasLoan(undefined);
                }}
                placeholder="모름"
                suffix="만원"
              />
            </Field>
            <Field
              k="nice"
              label="신용점수 NICE"
              dim={niceScore === undefined}
              error={outOfCreditRange(creditNice) ? "300~1000 사이로 넣어 주세요 — 지금은 모름으로 처리됩니다" : undefined}
            >
              <InputRow
                inputMode="numeric"
                maxLength={4}
                value={creditNice}
                onChange={(e) => setCreditNice(e.target.value.replace(/\D/g, "").slice(0, 4))}
                placeholder="300~1000"
                suffix="점"
              />
            </Field>
            <Field
              k="kcb"
              label="신용점수 KCB"
              dim={kcbScore === undefined}
              error={outOfCreditRange(creditKcb) ? "300~1000 사이로 넣어 주세요 — 지금은 모름으로 처리됩니다" : undefined}
            >
              <InputRow
                inputMode="numeric"
                maxLength={4}
                value={creditKcb}
                onChange={(e) => setCreditKcb(e.target.value.replace(/\D/g, "").slice(0, 4))}
                placeholder="300~1000"
                suffix="점"
              />
            </Field>
          </div>

          </div>

          {/* 바닥 고정 — 칸 묶음이 스크롤돼도 주 행동은 늘 보인다 */}
          <div data-panel="footer" className="flex shrink-0 flex-wrap items-center gap-4 border-t border-wedly-bd p-4">
            <button
              type="button"
              onClick={() => void runDiagnose()}
              disabled={diagnosing}
              className={BTN_PRIMARY}
            >
              {diagnosing ? "진단 중…" : "매칭 진단"}
            </button>
            {docFileCount > 0 && docFilledCount > 0 ? (
              // 서류로 칸을 채웠으면 확인하고 진단하라고 알린다 — 채운 값은 틀릴 수 있어 사람이 한 번 본다.
              <span className="text-xs font-semibold leading-[18px] text-wedly-t1">
                {`서류 ${docFileCount}개에서 ${docFilledCount}칸을 채웠어요. 확인하고 진단하세요`}
              </span>
            ) : (
              <span className="text-xs leading-[18px] text-wedly-muted">
                모르는 칸은 &lsquo;모름&rsquo;으로 두세요 — 그 조건은 &lsquo;확인 필요&rsquo;로 분류됩니다
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
