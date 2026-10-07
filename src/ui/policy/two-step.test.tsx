import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import PolicyMatchScreen from "./PolicyMatchScreen";
import ProfileForm from "./ProfileForm";
import ResultList from "./ResultList";
import { CompanySummaryBar, StepBar } from "./StepHeader";
import {
  PROFILE_STORAGE_KEY, bootPlanOf, clearStoredProfile, companySummaryOf, readStoredProfile, searchWithStep,
  sessionStorageOrNull, stepOfSearch, writeStoredProfile, type ProfileStorage,
} from "./step-state";
import { ERP_POLICY_MATCH_ENDPOINTS } from "./endpoints";

/**
 * 두 단계 뼈대(C1) — ① 회사 정보 → ② 매칭 결과.
 *
 * ★무엇을 못 재는가(솔직히 적어 둔다): 이 저장소엔 jsdom 이 없어(2026-09-03 실측) `renderToStaticMarkup` 은
 *  손잡이(useEffect)를 돌리지 않고, 눌러 볼 수도 없다. 그래서 세 갈래로 나눠 잰다.
 *   ① 주소·저장소 규칙은 그리지 않는 순수 함수(`step-state.ts`)로 떼어 가짜 저장소로 직접 잰다.
 *   ② 첫 그림은 그려서 잰다(전체 공고 목록·검색 칸이 없고, 통로를 부르지 않는다).
 *   ③ 단계가 넘어가는 배선(진단 성공일 때만 열기·고치기·다른 회사·새로 고침 복원·뒤로 가기)은 소스 글자로 잰다.
 *  눌러서 확인하는 일은 배포본 브라우저 QA 몫이다.
 */

const RAW색 =
  /(?:^|["\s])(?:bg|text|border|from|to)-(?:green|amber|red|sky|blue|indigo|violet|pink|gray|slate|zinc|orange|yellow|lime|emerald|teal|cyan|rose|fuchsia)-(?:50|100|200|300|400|500|600|700|800|900)\b/;

/** 그려 낸 HTML 의 글자 사이 주석(<!-- -->)을 걷어 낸다. */
const 글자 = (html: string) => html.replace(/<!-- -->/g, "");

const 화면글 = readFileSync(new URL("PolicyMatchScreen.tsx", import.meta.url), "utf8");

/** 가짜 sessionStorage — 읽기·쓰기·지우기 각각을 터뜨릴 수 있다(막힌 브라우저 흉내). */
function 가짜저장소(
  처음: Record<string, string> = {},
  터뜨리기: Array<"get" | "set" | "remove"> = [],
): ProfileStorage & { 값: Map<string, string> } {
  const 값 = new Map(Object.entries(처음));
  return {
    값,
    getItem: (k) => {
      if (터뜨리기.includes("get")) throw new Error("접근 막힘");
      return 값.get(k) ?? null;
    },
    setItem: (k, v) => {
      if (터뜨리기.includes("set")) throw new Error("가득 참");
      값.set(k, v);
    },
    removeItem: (k) => {
      if (터뜨리기.includes("remove")) throw new Error("접근 막힘");
      값.delete(k);
    },
  };
}

/** 함수 하나의 몸통 — 시작 글자부터 끝 글자 앞까지. */
function 몸통(src: string, 시작: string, 끝: string): string {
  const start = src.indexOf(시작);
  expect(start, `${시작} 이 화면 글에 없다`).toBeGreaterThan(-1);
  const end = src.indexOf(끝, start);
  expect(end, `${끝} 이 ${시작} 뒤에 없다`).toBeGreaterThan(start);
  return src.slice(start, end);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── 주소 쿼리 ───────────────────────────────────────────────────────────
describe("주소 쿼리 — step=result 만 읽고 쓰며 다른 쿼리는 보존한다", () => {
  it("step=result 만 결과 단계이고 나머지는 모두 회사 정보 단계다", () => {
    expect(stepOfSearch("")).toBe("company");
    expect(stepOfSearch("?step=result")).toBe("result");
    expect(stepOfSearch("?a=1&step=result")).toBe("result");
    expect(stepOfSearch("?step=company")).toBe("company");
    expect(stepOfSearch("?step=")).toBe("company");
    expect(stepOfSearch("?step=RESULT")).toBe("company");
  });

  it("결과로 쓸 때 다른 쿼리를 그대로 두고, 회사 정보로 쓸 때는 step 만 뗀다", () => {
    expect(searchWithStep("", "result")).toBe("?step=result");
    expect(searchWithStep("?a=1", "result")).toBe("?a=1&step=result");
    expect(searchWithStep("?step=result", "result")).toBe("?step=result"); // 두 번 쌓지 않는다
    expect(searchWithStep("?a=1&step=result", "company")).toBe("?a=1");
    expect(searchWithStep("?step=result", "company")).toBe(""); // 비면 물음표도 없다
    expect(searchWithStep("?q=%EA%B0%80&tab=2", "result")).toBe("?q=%EA%B0%80&tab=2&step=result");
  });
});

// ── 저장소 ──────────────────────────────────────────────────────────────
describe("회사 정보 저장 — sessionStorage 키 wedly-policy-match:profile:v1", () => {
  const 프로필 = { companyName: "가상테크", employeeCount: 14, isCorporation: true, certTypes: ["벤처기업"] };

  it("열쇠 이름이 정해진 그대로다", () => {
    expect(PROFILE_STORAGE_KEY).toBe("wedly-policy-match:profile:v1");
  });

  it("쓴 값을 그대로 읽고, 지우면 없어진다", () => {
    const s = 가짜저장소();
    writeStoredProfile(s, 프로필);
    expect(s.값.has(PROFILE_STORAGE_KEY)).toBe(true);
    expect(readStoredProfile(s)).toEqual(프로필);
    clearStoredProfile(s);
    expect(s.값.has(PROFILE_STORAGE_KEY)).toBe(false);
    expect(readStoredProfile(s)).toBeNull();
  });

  it("값이 없거나 깨졌으면 null — 글이 깨짐·배열·null·숫자·안쪽 객체·무한대", () => {
    expect(readStoredProfile(가짜저장소())).toBeNull();
    for (const 깨진 of ["{깨짐", "[]", "null", "12", '"글"', '{"employeeCount":{"안":1}}', '{"certTypes":[1,2]}', ""]) {
      expect(readStoredProfile(가짜저장소({ [PROFILE_STORAGE_KEY]: 깨진 })), `깨진 값 ${깨진}`).toBeNull();
    }
  });

  it("저장소 접근이 막혀도(읽기·쓰기·지우기) 터지지 않는다", () => {
    expect(readStoredProfile(null)).toBeNull();
    expect(readStoredProfile(가짜저장소({ [PROFILE_STORAGE_KEY]: JSON.stringify(프로필) }, ["get"]))).toBeNull();
    expect(() => writeStoredProfile(가짜저장소({}, ["set"]), 프로필)).not.toThrow();
    expect(() => writeStoredProfile(null, 프로필)).not.toThrow();
    expect(() => clearStoredProfile(가짜저장소({}, ["remove"]))).not.toThrow();
    expect(() => clearStoredProfile(null)).not.toThrow();
  });

  it("창이 없는 곳(서버 그리기·시험)에서는 저장소가 null 이다", () => {
    expect(sessionStorageOrNull()).toBeNull();
  });
});

// ── 첫 진입 계획 ────────────────────────────────────────────────────────
describe("첫 진입 — step=result + 저장된 프로필이면 진단을 다시 부르고, 아니면 회사 정보", () => {
  const 저장 = { [PROFILE_STORAGE_KEY]: JSON.stringify({ companyName: "가상테크", employeeCount: 14 }) };

  it("결과 주소 + 멀쩡한 저장값 → 그 값으로 진단을 다시 돌린다", () => {
    expect(bootPlanOf("?step=result", 가짜저장소(저장))).toEqual({
      kind: "rediagnose",
      profile: { companyName: "가상테크", employeeCount: 14 },
    });
    expect(bootPlanOf("?a=1&step=result", 가짜저장소(저장)).kind).toBe("rediagnose");
  });

  it("저장값이 깨졌거나 비었거나 저장소가 없으면 회사 정보 단계", () => {
    expect(bootPlanOf("?step=result", 가짜저장소({ [PROFILE_STORAGE_KEY]: "{깨짐" }))).toEqual({ kind: "company" });
    expect(bootPlanOf("?step=result", 가짜저장소())).toEqual({ kind: "company" });
    expect(bootPlanOf("?step=result", null)).toEqual({ kind: "company" });
    expect(bootPlanOf("?step=result", 가짜저장소(저장, ["get"]))).toEqual({ kind: "company" });
  });

  it("첫 진입 주소(step 없음)는 저장값이 있어도 회사 정보 단계 — 진단을 부르지 않는다", () => {
    expect(bootPlanOf("", 가짜저장소(저장))).toEqual({ kind: "company" });
    expect(bootPlanOf("?a=1", 가짜저장소(저장))).toEqual({ kind: "company" });
  });
});

// ── 회사 요약 줄 ────────────────────────────────────────────────────────
describe("결과 머리의 회사 요약 — 있는 값만", () => {
  it("상호·법인/개인·소재지·설립 연월·매출·직원 수를 순서대로", () => {
    const s = companySummaryOf({
      companyName: "가상테크", isCorporation: true, businessAddress: "서울 강남구",
      foundedDate: "2021-03-15", lastYearRevenueKrw: 1_240_000_000, employeeCount: 14,
    });
    expect(s.name).toBe("가상테크");
    expect(s.chips).toHaveLength(5);
    expect(s.chips.slice(0, 3)).toEqual(["법인", "서울 강남구", "설립 2021.03"]);
    expect(s.chips[3]).toContain("매출 12억");
    expect(s.chips[4]).toBe("직원 14명");
  });

  it("없는 값은 아예 안 만든다(빈 칩·「모름」 글자 없음)", () => {
    expect(companySummaryOf({})).toEqual({ name: "", chips: [] });
    expect(companySummaryOf({ companyName: "가상테크" })).toEqual({ name: "가상테크", chips: [] });
    // 소재지는 주소가 없으면 시도·시군구로
    expect(companySummaryOf({ region: "경기", regionSigungu: "화성시" }).chips).toEqual(["경기 화성시"]);
    // 직원 0명은 값이다
    expect(companySummaryOf({ employeeCount: 0 }).chips).toEqual(["직원 0명"]);
  });

  it("법인/개인은 사업자번호가 가르면 그것이 이긴다", () => {
    expect(companySummaryOf({ bizno: "123-81-12345" }).chips).toEqual(["법인"]);
    expect(companySummaryOf({ bizno: "123-12-12345", isCorporation: true }).chips).toEqual(["개인"]);
  });
});

// ── 첫 그림 ─────────────────────────────────────────────────────────────
describe("첫 렌더 — ① 회사 정보. 전체 공고 목록이 없고 announcements 주소를 부르지 않는다", () => {
  const 처음 = () => 글자(renderToStaticMarkup(<PolicyMatchScreen endpoints={ERP_POLICY_MATCH_ENDPOINTS} />));

  it("전체 공고 목록·검색 칸·수집 시각 줄이 없다", () => {
    const html = 처음();
    expect(html).not.toContain("공고명·기관·지원대상 검색");
    expect(html).not.toContain("아직 수집 전");
    expect(html).not.toContain("조건에 맞는 공고가 없습니다");
    expect(html).not.toContain("전체 공고");
    expect(html).not.toContain("지금 새로 받아오기");
  });

  it("그리는 동안 어떤 통로도 부르지 않는다(announcements 포함)", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    renderToStaticMarkup(<PolicyMatchScreen endpoints={ERP_POLICY_MATCH_ENDPOINTS} />);
    expect(fetchSpy).not.toHaveBeenCalled();
    // 효과가 안 도는 그리기라 위 검사만으론 약하다 — 화면 글에 그 주소를 부르는 줄이 아예 없는지도 본다.
    expect(화면글).not.toContain("endpoints.announcements");
    expect(화면글).not.toMatch(/^import ResultList\b/m);
    expect(화면글).not.toContain("<ResultList");
  });

  it("단계 표시·제목·안내·불러오기·채운 칸 수·주 단추가 시안대로 있다", () => {
    const html = 처음();
    expect(html).toContain('data-area="step-bar"');
    expect(html).toContain("회사 정보");
    expect(html).toContain("매칭 결과");
    expect(html).toContain("어떤 회사의 지원정책을 찾을까요?");
    expect(html).toContain("아는 칸만 채워도 됩니다. 모르는 칸은 결과에서 「확인 필요」로 따로 모아 보여 드려요.");
    expect(html).toContain("기존 고객 검색"); // 고객 불러오기
    expect(html).toContain("15칸 중 0칸 채움 — 채울수록 「확인 필요」가 줄어요");
    expect(html).toContain("매칭 결과 보기 →");
    expect(html).toMatch(/data-area="company-panel"[^>]*class="[^"]*max-w-\[880px\]/);
  });

  it("결과 단계 부품은 아직 없다 — 요약 줄·고치기·다른 회사·요약 탭", () => {
    const html = 처음();
    expect(html).not.toContain('data-area="results"');
    expect(html).not.toContain("회사 정보 고치기");
    expect(html).not.toContain("다른 회사");
    expect(html).not.toContain("지금 신청 가능한 것만");
  });

  it("세 앱 공통 — 고객 표가 없는 랩 통로에서도 터지지 않고 불러오기 칸만 없다", () => {
    const { prefill: _p, documentPrefill: _d, ...랩통로 } = ERP_POLICY_MATCH_ENDPOINTS;
    const html = 글자(renderToStaticMarkup(<PolicyMatchScreen endpoints={랩통로} />));
    expect(html).toContain("매칭 결과 보기 →");
    expect(html).not.toContain("기존 고객 검색");
  });

  it("raw 색 0건 — 화면·단계 표시·요약 줄·넓은 폼", () => {
    for (const html of [
      처음(),
      renderToStaticMarkup(<StepBar step="company" />),
      renderToStaticMarkup(<StepBar step="result" />),
      renderToStaticMarkup(
        <CompanySummaryBar profile={{ companyName: "가상테크" }} unknownCount={6} onEdit={() => {}} onOther={() => {}} />,
      ),
    ]) {
      expect(html.length).toBeGreaterThan(80);
      expect(html).not.toMatch(RAW색);
    }
  });
});

describe("단계 표시·요약 줄 부품", () => {
  it("회사 정보 단계: 1 이 지금 단계이고 체크가 없다 / 결과 단계: 1 이 ✓ 로 바뀐다", () => {
    const a = 글자(renderToStaticMarkup(<StepBar step="company" />));
    expect(a).not.toContain("✓");
    expect(a.match(/aria-current="step"/g)).toHaveLength(1);
    const b = 글자(renderToStaticMarkup(<StepBar step="result" />));
    expect(b).toContain("✓");
    expect(b.match(/aria-current="step"/g)).toHaveLength(1);
    expect(b.indexOf("aria-current")).toBeGreaterThan(b.indexOf("회사 정보"));
  });

  it("단계 이름 글자는 흐린 글자(muted)를 쓰지 않는다 — 단계 표시는 연파랑 화면 바닥 위라 muted 는 대비 4.22 로 기준 4.5 미달(10/7 axe 실측)", () => {
    for (const step of ["company", "result"] as const) {
      const html = renderToStaticMarkup(<StepBar step={step} />);
      const labels = [...html.matchAll(/<span class="([^"]*)">(회사 정보|매칭 결과)<\/span>/g)];
      expect(labels).toHaveLength(2);
      for (const [, cls] of labels) expect(cls).not.toContain("text-wedly-muted");
    }
  });

  it("요약 줄: 상호·값 칩·모름 N칸·두 단추", () => {
    const html = 글자(
      renderToStaticMarkup(
        <CompanySummaryBar
          profile={{ companyName: "가상테크", isCorporation: true, employeeCount: 14 }}
          unknownCount={6}
          onEdit={() => {}}
          onOther={() => {}}
        />,
      ),
    );
    for (const t of ["가상테크", "법인", "직원 14명", "모름 6칸", "← 회사 정보 고치기", "다른 회사"]) {
      expect(html, t).toContain(t);
    }
    expect(html.match(/<button/g)).toHaveLength(2);
  });

  it("모름 칸 수를 모르면(폼이 아직 안 알림) 그 칩을 안 그린다", () => {
    const html = renderToStaticMarkup(
      <CompanySummaryBar profile={{}} unknownCount={null} onEdit={() => {}} onOther={() => {}} />,
    );
    expect(html).not.toContain("모름");
    expect(html).toContain("회사 정보 고치기"); // 단추는 그대로
  });
});

// ── ProfileForm 의 layout ───────────────────────────────────────────────
describe("ProfileForm layout — wide 는 ① 단계용, 기본 side 는 다른 사용처 그대로", () => {
  const 폼 = (props: Partial<Parameters<typeof ProfileForm>[0]> = {}) =>
    글자(
      renderToStaticMarkup(
        <ProfileForm
          onDiagnose={async () => true}
          diagnosing={false}
          prefillEndpoint="/api/policy-match/prefill"
          documentPrefillEndpoint="/api/policy-match/document-prefill"
          {...props}
        />,
      ),
    );

  it("wide: 고객 불러오기가 서류 올리기보다 위, 바닥은 「N칸 채움」과 「매칭 결과 보기 →」", () => {
    const html = 폼({ layout: "wide" });
    expect(html).toContain('data-layout="wide"');
    expect(html.indexOf("기존 고객 검색")).toBeGreaterThan(-1);
    expect(html.indexOf("기존 고객 검색")).toBeLessThan(html.indexOf("서류를 올리면 칸을 채워 드려요"));
    expect(html).toContain("15칸 중 0칸 채움 — 채울수록 「확인 필요」가 줄어요");
    expect(html).toContain("매칭 결과 보기 →");
    expect(html).not.toContain("매칭 진단");
    expect(html).not.toContain("조건 수정");
    expect(html).not.toContain("overflow-y-auto"); // 안쪽 스크롤 없음 — 본문이 넓게 펼쳐진다
  });

  it("wide: 진단 중이면 단추 글자가 바뀌고 눌리지 않는다", () => {
    const html = 폼({ layout: "wide", diagnosing: true });
    expect(html).toContain("진단 중…");
    expect(html).not.toContain("매칭 결과 보기 →");
  });

  it("wide 도 기존 칸·서류 올리기 칸·모름 표식은 그대로 있다", () => {
    const html = 폼({ layout: "wide" });
    for (const t of ["상호", "사업자번호", "사업장 주소", "작년 연매출", "직원 수", "신용점수 NICE", "서류를 올리면 칸을 채워 드려요"]) {
      expect(html, t).toContain(t);
    }
    expect(html).toContain('data-unk="true"');
  });

  it("기본(side): 예전 그대로 — 서류 올리기가 먼저, 바닥 단추는 「매칭 진단」", () => {
    const html = 폼();
    expect(html).toContain('data-layout="side"');
    expect(html.indexOf("서류를 올리면 칸을 채워 드려요")).toBeLessThan(html.indexOf("기존 고객 검색"));
    expect(html).toContain("매칭 진단");
    expect(html).not.toContain("매칭 결과 보기 →");
    expect(html).toContain("overflow-y-auto");
  });
});

// ── 배선 — 소스 글자로 잰다 ────────────────────────────────────────────
describe("배선 — 단계는 진단 성공일 때만 열리고, 고치기·다른 회사·복원·뒤로 가기가 이어져 있다", () => {
  it("첫 상태는 회사 정보이고, 옛 browse 상태·경로는 화면에 없다", () => {
    expect(화면글).toContain('useState<Step>("company")');
    for (const 없어야 of ["setMode(", "browseAll", "changeMode", "const load = useCallback", "reloadNonce", "submitSearch"]) {
      expect(화면글, `${없어야} 가 아직 화면에 남아 있다`).not.toContain(없어야);
    }
  });

  it("진단 단추의 길(runDiagnose)은 성공한 뒤에만 결과 단계를 열고 저장·주소를 쓴다", () => {
    const body = 몸통(화면글, "const runDiagnose", "}, [endpoints.diagnose");
    const 실패끝 = body.indexOf("return false");
    expect(실패끝).toBeGreaterThan(-1);
    for (const 줄 of ['setStep("result")', "writeStoredProfile(profileStore(), p)", 'writeStepToAddress("result", "push")']) {
      expect(body, `${줄} 이 runDiagnose 에 없다`).toContain(줄);
      expect(body.indexOf(줄), `${줄} 이 실패 처리보다 앞에 있다`).toBeGreaterThan(실패끝);
    }
    expect(body.match(/setStep\("result"\)/g)).toHaveLength(1);
    // 실패 두 갈래(서버 거절·통신 실패)는 단계를 안 만진다
    const catchPart = body.slice(body.indexOf("} catch"));
    expect(catchPart).not.toContain("setStep(");
    expect(화면글).toContain("onDiagnose={runDiagnose}");
  });

  it("주소가 이미 결과 단계면 다시 쌓지 않고, 주소는 다른 쿼리를 보존하는 함수로만 쓴다", () => {
    const body = 몸통(화면글, "const runDiagnose", "}, [endpoints.diagnose");
    expect(body).toContain('stepOfSearch(window.location.search) !== "result"');
    const writer = 몸통(화면글, "function writeStepToAddress", "\n}\n");
    expect(writer).toContain("searchWithStep(search, step)");
    expect(writer).toContain("window.history.pushState(");
    expect(writer).toContain("window.history.replaceState(");
    expect(writer).toContain("typeof window === \"undefined\""); // 서버 그리기에서는 아무것도 안 한다
  });

  it("「회사 정보 고치기」는 단계만 되돌리고 입력값·결과·저장값을 비우지 않는다", () => {
    const body = 몸통(화면글, "const goCompany", "}, []);");
    expect(body).toContain('setStep("company")');
    // 주소는 쌓는다(push) — replace 로 덮으면 고친 뒤 다시 결과를 보고 뒤로 가기를 눌렀을 때 회사 정보 화면이 두 번 연속 나온다(C2).
    expect(body).toContain('writeStepToAddress("company", "push")');
    expect(body).not.toContain('writeStepToAddress("company", "replace")');
    for (const 비우기 of ["setDiagnosis(null)", "clearStoredProfile", "setFormKey", "setProfile(", "setFundingData(null)"]) {
      expect(body, `고치기가 ${비우기} 를 한다`).not.toContain(비우기);
    }
    expect(화면글).toContain("onEdit={goCompany}");
  });

  it("폼은 단계를 오가도 계속 그려 숨기기만 한다 — 그래야 입력값이 남는다", () => {
    expect(화면글).toMatch(/data-area="company-panel"\s+className=\{step === "company" \? "[^"]*max-w-\[880px\][^"]*" : "hidden"\}/);
    expect(화면글).not.toMatch(/step === "company" && \(\s*<ProfileForm/);
    expect(화면글).toContain('layout="wide"');
    expect(화면글).toContain("key={formKey}");
  });

  it("「다른 회사」는 입력값·sessionStorage·결과를 모두 비우고 회사 정보로 간다", () => {
    const body = 몸통(화면글, "const resetCompany", "}, [profileStore]);");
    // 고른 줄·탭·쪽은 결과 목록(ResultOneList)이 쥐고 진단 회차 `key` 로 새로 만들어지므로 여기서 따로 비우지 않는다(C2).
    for (const 줄 of [
      "clearStoredProfile(profileStore())", "setRestoredProfile(null)", "setFormKey((k) => k + 1)",
      "setProfile({})", "setProfileNonce(0)", "setDiagnosis(null)", "setFundingData(null)", "setCountData(null)",
      'setResultQuery("")', 'setAskedQuery("")', 'setStep("company")', 'writeStepToAddress("company", "replace")',
    ]) {
      expect(body, `다른 회사가 ${줄} 를 안 한다`).toContain(줄);
    }
    expect(화면글).toContain("onOther={resetCompany}");
  });

  it("새로 고침 복원 — 첫 그림 뒤 한 번 bootPlanOf 로 읽고, 되살릴 값이 없으면 주소를 회사 정보로 맞춘다", () => {
    const body = 몸통(화면글, "const booted = useRef(false)", "}, [rediagnose, profileStore]);");
    expect(body).toContain("bootPlanOf(window.location.search, profileStore())");
    // 옛 이름 없는 저장값(사용자 구분 없음)은 시작할 때 지운다 — 다른 사람 고객이 되살아나지 않게(리뷰 P1)
    expect(body.indexOf("dropUnscopedProfile(sessionStorageOrNull())")).toBeGreaterThan(-1);
    expect(body.indexOf("dropUnscopedProfile(sessionStorageOrNull())")).toBeLessThan(body.indexOf("bootPlanOf("));
    expect(body).toContain("setRestoredProfile(plan.profile)");
    expect(body).toContain("rediagnose(plan.profile)");
    expect(body).toContain('writeStepToAddress("company", "replace")');
    // 되살린 값은 넓은 폼이 한 번 칸에 채운다
    expect(화면글).toContain("initialProfile={restoredProfile}");
    // 그리는 중에는 창·저장소를 읽지 않는다(서버 그리기와 첫 그림이 같아야 한다)
    expect(화면글).not.toMatch(/useState<Step>\(\s*(?:\(\)\s*=>\s*)?stepOfSearch/);
  });

  it("복원 진단이 실패하면 회사 정보로 돌아가고 주소에서 step 을 뗀다", () => {
    const body = 몸통(화면글, "const rediagnose", "}, [runDiagnose, profileStore]);");
    expect(body).toContain("void runDiagnose(p).then((ok) => {");
    expect(body).toContain('setStep("company")');
    // 복원 진단이 실패(권한 없음 포함)하면 되살린 입력값·저장값도 지운다 — 남이 본 고객이 칸에 남지 않게(리뷰 P1)
    for (const 줄 of ["clearStoredProfile(profileStore())", "setRestoredProfile(null)", "setFormKey((k) => k + 1)"]) {
      expect(body, `복원 실패가 ${줄} 를 안 한다`).toContain(줄);
    }
    expect(body).toContain('writeStepToAddress("company", "replace")');
  });

  it("뒤로·앞으로 가기(popstate) — 주소의 step 을 따라가고, 닫을 때 걷는다", () => {
    expect(화면글).toContain('window.addEventListener("popstate", onPop)');
    expect(화면글).toContain('window.removeEventListener("popstate", onPop)');
    const body = 몸통(화면글, "const onPop = () => {", 'window.addEventListener("popstate"');
    expect(body).toContain('stepOfSearch(window.location.search) === "company"');
    expect(body).toContain('setStep("company")');
    expect(body).toContain("readStoredProfile(profileStore())");
  });

  it("전체 공고 둘러보기로 돌아가는 길이 없다 — 결과 본문은 목록 하나(ResultOneList)이고 지도 전환·묶음 목록은 안 쓴다", () => {
    expect(화면글).not.toContain("onBrowseAll=");
    expect(화면글).toContain("<ResultOneList");
    expect(화면글).not.toMatch(/<FundingMap[\s/>]/);
    expect(화면글).not.toContain("<ResultGroupList");
  });

  it("진단을 새로 돌리면 결과 목록을 새로 만든다 — 진단 회차(profileNonce)를 key 로 준다", () => {
    expect(화면글).toMatch(/<ResultOneList\s+key=\{profileNonce\}/);
  });

  it("ResultList·endpoints.announcements 는 지우지 않았다(일루아·앱이 쓴다)", () => {
    expect(typeof ResultList).toBe("function");
    expect(readFileSync(new URL("ResultList.tsx", import.meta.url), "utf8")).toContain("export default function ResultList");
    expect(readFileSync(new URL("endpoints.ts", import.meta.url), "utf8")).toContain("announcements: string;");
    expect(readFileSync(new URL("index.ts", import.meta.url), "utf8")).toContain("ResultList");
  });
});
