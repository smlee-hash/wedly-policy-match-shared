"use client";

// 사업자 정보 입력 — 이 화면의 주인공. 여기서 넣은 값이 매칭 진단의 입력이 된다.
// 모르는 칸은 「모름」으로 두면 그 조건은 「확인 필요」로 분류된다(모름을 통과로 치지 않는다).
import { useState } from "react";
import type { BusinessProfile } from "../../engine/match-engine";

/**
 * 소재지 — 대조 엔진의 지역 사전과 같은 줄임말 표기를 쓴다(match-engine 의 REGION_ALIASES).
 * 「전국」은 넣지 않는다 — 회사 소재지는 한 곳이라 「전국」이 성립하지 않고,
 * 고르면 지역 조건이 전부 「확인 필요」가 되어 모름과 다를 바 없었다(2026-08-22 독립 화면 검사 3번).
 */
const SIDO = [
  "서울", "부산", "대구", "인천", "광주", "대전", "울산", "세종",
  "경기", "강원", "충북", "충남", "전북", "전남", "경북", "경남", "제주",
] as const;

const SCALES = ["중소기업", "소상공인", "중견기업", "예비창업자"] as const;

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
const INPUT = `w-full ${INPUT_BASE}`;
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

interface Props {
  onDiagnose: (profile: BusinessProfile) => Promise<boolean>;
  diagnosing: boolean;
  /**
   * 기존 고객 불러오기 통로(`GET ?query=`). **안 넘기면 검색 칸도 없고, 불러오는 코드도 돌지
   * 않는다** — 랩(`wedly-policy-lab`)엔 고객 표가 아예 없어서 이 자리가 보이면 안 된다.
   */
  prefillEndpoint?: string;
}

function numberOf(v: string): number | undefined {
  const t = v.replace(/[,\s]/g, "");
  if (!t) return undefined;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

function triOf(v: Tri): boolean | undefined {
  return v === "yes" ? true : v === "no" ? false : undefined;
}

/** 적어 넣었는데 숫자로 못 읽는 값 — 조용히 「모름」으로 넘기면 왜 결과가 다른지 알 수 없다. */
function unreadableNumber(v: string): boolean {
  return v.trim() !== "" && numberOf(v) === undefined;
}

/**
 * 신용점수는 300~1000(NICE/KCB) 밖이면 진단에 담지 않는다.
 * 담지 않는 것까지는 맞지만 **조용히** 빼면 왜 그 조건이 「확인 필요」로 남았는지 알 수 없어
 * 화면에서 한 줄로 알린다(숫자로 못 읽는 값과 같은 대접).
 */
function outOfCreditRange(v: string): boolean {
  const n = numberOf(v);
  return n !== undefined && (n < 300 || n > 1000);
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
  onLoad: (d: BusinessProfile) => void,
): CustomerPrefillState {
  const [query, setQuery] = useState("");
  const [prefilling, setPrefilling] = useState(false);
  const [prefillNote, setPrefillNote] = useState("");

  /** 고객 불러오기 — 먼저 폼을 비우고, 아는 값만 채운다(모르는 칸은 「모름」으로 남는다). */
  const loadCustomer = async () => {
    if (!endpoint) return; // 통로가 없는 앱 — 검색 줄을 안 그리므로 여기까지 올 일도 없다
    const t = query.trim();
    if (!t) {
      setPrefillNote("사업자번호 또는 상호를 입력하세요");
      return;
    }
    setPrefilling(true);
    setPrefillNote("");
    try {
      const j = await fetch(`${endpoint}?query=${encodeURIComponent(t)}`).then((r) => r.json());
      if (!j?.success) {
        setPrefillNote(j?.error?.message ?? "고객 정보를 불러오지 못했습니다");
        return;
      }
      const d = j.data as BusinessProfile | null;
      if (!d) {
        setPrefillNote("찾지 못했습니다 — 아래 칸을 직접 채워 주세요");
        return;
      }
      onLoad(d);
      setPrefillNote(`${d.companyName || t} 정보를 불러왔습니다 — 아는 값만 채웠습니다`);
    } catch {
      setPrefillNote("고객 정보를 불러오지 못했습니다");
    } finally {
      setPrefilling(false);
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

export default function ProfileForm({ onDiagnose, diagnosing, prefillEndpoint }: Props) {
  const [open, setOpen] = useState(true);

  const [companyName, setCompanyName] = useState("");
  const [bizno, setBizno] = useState("");
  const [industry, setIndustry] = useState("");
  const [region, setRegion] = useState("");
  const [foundedDate, setFoundedDate] = useState("");
  const [revenueManwon, setRevenueManwon] = useState("");
  const [employeeCount, setEmployeeCount] = useState("");
  const [companyScale, setCompanyScale] = useState("");
  const [taxDelinquent, setTaxDelinquent] = useState<Tri>("");
  const [hasCert, setHasCert] = useState<Tri>("");
  const [hasPatent, setHasPatent] = useState<Tri>("");
  // ── 자금 조달 지도(2026-09-03) — 상시 대출·보증 상품 판정에만 쓰는 두 칸.
  // 사람이 직접 넣는다(자동 조회하지 않는다). 비우면 그 조건만 「확인 필요」로 남는다.
  const [creditScore, setCreditScore] = useState("");
  const [hasExistingLoan, setHasExistingLoan] = useState<Tri>("");

  /** 화면 값 → 진단 입력. 빈 칸은 아예 담지 않는다(담으면 「모름」이 「충족」으로 둔갑한다). */
  const buildProfile = (): BusinessProfile => {
    const p: BusinessProfile = {};
    if (companyName.trim()) p.companyName = companyName.trim();
    if (bizno.trim()) p.bizno = bizno.trim();
    if (industry.trim()) p.industry = industry.trim();
    if (region) p.region = region;
    if (foundedDate) p.foundedDate = foundedDate;
    const manwon = numberOf(revenueManwon);
    if (manwon !== undefined) p.lastYearRevenueKrw = Math.round(manwon * 10_000); // 만원 → 원
    const employees = numberOf(employeeCount);
    if (employees !== undefined) p.employeeCount = Math.floor(employees);
    if (companyScale) p.companyScale = companyScale;
    const tax = triOf(taxDelinquent);
    if (tax !== undefined) p.taxDelinquent = tax;
    const cert = triOf(hasCert);
    if (cert !== undefined) p.hasCert = cert;
    const patent = triOf(hasPatent);
    if (patent !== undefined) p.hasPatent = patent;
    // 신용점수는 300~1000 안의 값만 담는다 — 밖의 값을 담으면 상품 판정이 엉뚱해진다.
    const credit = numberOf(creditScore);
    if (credit !== undefined && credit >= 300 && credit <= 1000) p.creditScore = Math.round(credit);
    const loan = triOf(hasExistingLoan);
    if (loan !== undefined) p.hasExistingLoan = loan;
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
    setIndustry("");
    setRegion("");
    setFoundedDate("");
    setRevenueManwon("");
    setEmployeeCount("");
    setCompanyScale("");
    setTaxDelinquent("");
    setHasCert("");
    setHasPatent("");
    setCreditScore("");
    setHasExistingLoan("");
  };

  /** 불러온 고객 값을 칸에 채운다 — 먼저 전부 비우고, 아는 값만(모르는 칸은 「모름」으로 남는다). */
  const applyCustomer = (d: BusinessProfile) => {
    setOpen(true);
    clearFields(); // 앞 고객 값이 남아 섞이지 않게 먼저 비운다
    if (d.companyName) setCompanyName(d.companyName);
    if (d.bizno) setBizno(d.bizno);
    if (d.industry) setIndustry(d.industry);
    // 사전에 없는 표기가 오면 선택칸이 빈 채로 남는다 — 있는 표기일 때만 넣는다.
    if (d.region && (SIDO as readonly string[]).includes(d.region)) setRegion(d.region);
    if (d.foundedDate) setFoundedDate(d.foundedDate);
    if (typeof d.lastYearRevenueKrw === "number") {
      setRevenueManwon(String(Math.round(d.lastYearRevenueKrw / 10_000)));
    }
    if (typeof d.employeeCount === "number") setEmployeeCount(String(d.employeeCount));
    if (typeof d.taxDelinquent === "boolean") setTaxDelinquent(d.taxDelinquent ? "yes" : "no");
  };

  // 검색 상태는 여기(부모)서 든다 — 폼을 접으면 아래 검색 줄은 사라지지만 검색어·안내는 남는다.
  const prefill = useCustomerPrefill(prefillEndpoint, applyCustomer);

  const runDiagnose = async () => {
    const ok = await onDiagnose(buildProfile());
    if (ok) setOpen(false); // 결과를 넓게 보라고 접는다 — 「조건 수정」으로 다시 편다
  };

  const summary = [
    companyName.trim(),
    region,
    industry.trim(),
    foundedDate ? `설립 ${foundedDate}` : "",
    employeeCount ? `${employeeCount}명` : "",
  ].filter(Boolean).join(" · ");

  return (
    <div className="rounded-2xl border border-wedly-bd bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
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
        <div className="mt-4 flex flex-wrap items-center gap-4">
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
          {/* 통로를 안 넘긴 앱(랩)에는 이 줄이 아예 없다 — 있지도 않은 고객 표를 약속하지 않는다. */}
          {prefill.active && <CustomerPrefill prefill={prefill} />}

          {/* 칸 사이 가로·세로 16 */}
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <label className="block">
              <span className={LABEL}>상호</span>
              <input
                value={companyName}
                onChange={(e) => {
                  setCompanyName(e.target.value);
                  // 사업자번호는 화면에 없는 값이라, 상호만 다른 회사로 고치면 **앞 고객의 번호가
                  // 그대로 실려 나간다**. 손으로 고치는 순간 비운다 — 불러오기로는 다시 채워진다
                  // (2026-08-22 독립 화면 검사 5번).
                  setBizno("");
                }}
                placeholder="예: 위들리테크"
                className={`mt-1 ${INPUT}`}
              />
            </label>
            <label className="block">
              <span className={LABEL}>주업종</span>
              <input
                value={industry}
                onChange={(e) => setIndustry(e.target.value)}
                placeholder="예: 전자부품 제조업"
                className={`mt-1 ${INPUT}`}
              />
            </label>
            <label className="block">
              <span className={LABEL}>소재지</span>
              <select
                value={region}
                onChange={(e) => setRegion(e.target.value)}
                className={`mt-1 ${INPUT}`}
              >
                <option value="">모름</option>
                {SIDO.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <label className="block">
              <span className={LABEL}>설립일</span>
              <input
                type="date"
                value={foundedDate}
                onChange={(e) => setFoundedDate(e.target.value)}
                className={`mt-1 ${INPUT}`}
              />
            </label>
            <label className="block">
              <span className={LABEL}>작년 연매출 (만원)</span>
              <input
                inputMode="numeric"
                value={revenueManwon}
                onChange={(e) => setRevenueManwon(e.target.value)}
                placeholder="예: 50000 = 5억"
                className={`mt-1 ${INPUT}`}
              />
              {unreadableNumber(revenueManwon) && (
                <span className="mt-1 block text-xs leading-[18px] text-wedly-red">숫자만 넣어 주세요 — 지금은 모름으로 처리됩니다</span>
              )}
            </label>
            <label className="block">
              <span className={LABEL}>직원 수 (명)</span>
              <input
                inputMode="numeric"
                value={employeeCount}
                onChange={(e) => setEmployeeCount(e.target.value)}
                placeholder="예: 12"
                className={`mt-1 ${INPUT}`}
              />
              {unreadableNumber(employeeCount) && (
                <span className="mt-1 block text-xs leading-[18px] text-wedly-red">숫자만 넣어 주세요 — 지금은 모름으로 처리됩니다</span>
              )}
            </label>
            <label className="block">
              <span className={LABEL}>기업 규모</span>
              <select
                value={companyScale}
                onChange={(e) => setCompanyScale(e.target.value)}
                className={`mt-1 ${INPUT}`}
              >
                <option value="">모름</option>
                {SCALES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <label className="block">
              <span className={LABEL}>세금 체납</span>
              <select
                value={taxDelinquent}
                onChange={(e) => setTaxDelinquent(e.target.value as Tri)}
                className={`mt-1 ${INPUT}`}
              >
                <option value="no">없음</option>
                <option value="yes">있음</option>
                <option value="">모름</option>
              </select>
            </label>
            <label className="block">
              <span className={LABEL}>기업인증 보유</span>
              <select
                value={hasCert}
                onChange={(e) => setHasCert(e.target.value as Tri)}
                className={`mt-1 ${INPUT}`}
              >
                <option value="">모름</option>
                <option value="yes">예</option>
                <option value="no">아니오</option>
              </select>
            </label>
            <label className="block">
              <span className={LABEL}>특허 보유</span>
              <select
                value={hasPatent}
                onChange={(e) => setHasPatent(e.target.value as Tri)}
                className={`mt-1 ${INPUT}`}
              >
                <option value="">모름</option>
                <option value="yes">예</option>
                <option value="no">아니오</option>
              </select>
            </label>
            {/* 아래 두 칸은 은행·보증 상시 상품 판정에 쓴다 — 비워도 진단은 그대로 돈다 */}
            <label className="block">
              <span className={LABEL}>신용점수(NICE/KCB)</span>
              <input
                inputMode="numeric"
                value={creditScore}
                onChange={(e) => setCreditScore(e.target.value)}
                placeholder="300~1000 · 선택"
                className={`mt-1 ${INPUT}`}
              />
              {unreadableNumber(creditScore) ? (
                <span className="mt-1 block text-xs leading-[18px] text-wedly-red">숫자만 넣어 주세요 — 지금은 모름으로 처리됩니다</span>
              ) : outOfCreditRange(creditScore) ? (
                <span className="mt-1 block text-xs leading-[18px] text-wedly-red">300~1000 사이로 넣어 주세요 — 지금은 모름으로 처리됩니다</span>
              ) : null}
            </label>
            <label className="block">
              <span className={LABEL}>기존 대출</span>
              <select
                value={hasExistingLoan}
                onChange={(e) => setHasExistingLoan(e.target.value as Tri)}
                className={`mt-1 ${INPUT}`}
              >
                <option value="">모름</option>
                <option value="yes">예</option>
                <option value="no">아니오</option>
              </select>
            </label>
          </div>

          {/* 두 칸 도움말 — 빈칸이 진단을 막지 않는다는 것을 그 자리에서 알린다 */}
          <p className="mt-2 text-xs leading-[18px] text-wedly-muted">
            신용점수·기존 대출을 비워 두면 그 조건은 &lsquo;확인 필요&rsquo;로 남고 판정은 막지 않습니다
          </p>

          {/* 구역 사이 24 — 입력 칸 묶음과 주 행동을 떼어 놓는다 */}
          <div className="mt-6 flex flex-wrap items-center gap-4">
            <button
              type="button"
              onClick={() => void runDiagnose()}
              disabled={diagnosing}
              className={BTN_PRIMARY}
            >
              {diagnosing ? "진단 중…" : "매칭 진단"}
            </button>
            <span className="text-xs leading-[18px] text-wedly-muted">
              모르는 칸은 &lsquo;모름&rsquo;으로 두세요 — 그 조건은 &lsquo;확인 필요&rsquo;로 분류됩니다
            </span>
          </div>
        </>
      )}
    </div>
  );
}
