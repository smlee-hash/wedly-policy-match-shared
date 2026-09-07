import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import PolicyMatchScreen from "./PolicyMatchScreen";
import ProfileForm from "./ProfileForm";
import ResultList, { type BrowseBundle } from "./ResultList";
import DetailPanel, { AskInstructorModal, BreakthroughPrompt } from "./DetailPanel";
import SourceDirectoryPanel, { SourceDirectoryTable, type DirectoryRow } from "./SourceDirectoryPanel";
import { Modal } from "./Modal";
import { ERP_POLICY_MATCH_ENDPOINTS, type PolicyMatchEndpoints, type VerdictFeedbackContext } from "./endpoints";
import type { DiagnoseItem, Diagnosis } from "./PolicyMatchScreen";

/**
 * 「앱마다 다른 것은 전부 인자로 받는다」를 **그려서** 잰다(P4 계획서 Task A2 Step 4).
 *
 * ★무엇을 못 재는가(솔직히 적어 둔다): 이 저장소엔 jsdom 이 없어(2026-09-03 실측)
 *  `renderToStaticMarkup` 한 번뿐이라 **손잡이(useEffect)가 돌지 않는다.** 그래서
 *  「공고를 골라 상세가 그려진 뒤」에만 보이는 자리(AI 판정 단추·돌파구 구역·상세 머리의
 *  판정 피드백)는 여기서 화면째로 재지 못한다. 대신 그 자리에 들어가는 **조각 부품**을
 *  따로 그려서 재고, 화면째 확인은 배포본 브라우저 QA 몫으로 남긴다.
 */

/** CLAUDE.md rule#1 의 금지 목록 — 그려 낸 HTML 에서 잰다(파일 글자가 아니라). */
const RAW색 =
  /(?:^|["\s])(?:bg|text|border|from|to)-(?:green|amber|red|sky|blue|indigo|violet|pink|gray|slate|zinc|orange|yellow|lime|emerald|teal|cyan|rose|fuchsia)-(?:50|100|200|300|400|500|600|700|800|900)\b/;

/** 랩(`wedly-policy-lab`) 이 넘길 통로 — 사내 전용 다섯(verdict 는 있고 나머지)은 빠진다. */
const LAB_ENDPOINTS: PolicyMatchEndpoints = {
  fundingMap: "/api/policy-match/funding-map",
  announcements: "/api/policy-match/announcements",
  announcement: (id, o) => `/api/policy-match/announcements/${encodeURIComponent(id)}${o?.noAi ? "?noAi=1" : ""}`,
  diagnose: "/api/policy-match/diagnose",
  sources: "/api/policy-match/sources",
  verdict: "/api/policy-match/verdict",
  // breakthrough·askInstructor·sync·prefill 없음 — 랩엔 자료실도, 고객 표도, 수집기도 없다.
};

const browse: BrowseBundle = {
  rows: [], total: 0, page: 1, q: "", qInput: "", status: "open",
  loading: false, refreshing: false, lastSyncAt: null,
  setQInput: () => {}, submitSearch: () => {}, setStatus: () => {}, setPage: () => {},
};

function item(over: Partial<DiagnoseItem> = {}): DiagnoseItem {
  return {
    announcementId: "a1",
    title: "서울 중소기업 지원",
    agency: "중기부",
    category: "금융",
    applyEnd: "2026-09-30T00:00:00.000Z",
    applyPeriodText: "2026-08-01 ~ 2026-09-30",
    grade: "possible",
    needsReview: false,
    ruleOnly: false,
    failSummary: "",
    checks: { total: 2, pass: 2, fail: 0, unknown: 0, humanCheck: 1 },
    ...over,
  };
}

const diagnosis = (items: DiagnoseItem[]): Diagnosis => ({
  possible: items,
  uncertain: [],
  impossible: [],
  structureProgress: { total: items.length, done: items.length, pending: 0, needsReview: 0, failed: 0 },
  analyzedCount: items.length,
  candidateCount: items.length,
});

function renderList(props: Partial<Parameters<typeof ResultList>[0]> = {}): string {
  return renderToStaticMarkup(
    <ResultList
      mode="browse"
      onModeChange={() => {}}
      diagnosis={null}
      selectedId=""
      onSelect={() => {}}
      browse={browse}
      announcementsEndpoint="/api/policy-match/announcements"
      {...props}
    />,
  );
}

const directoryRow = (over: Partial<DirectoryRow> = {}): DirectoryRow => ({
  label: "부산테크노파크", url: "https://www.btp.or.kr", status: "connected", note: "",
  count: 36, lastSaved: 36, lastError: null, id: "tp-busan", ...over,
});

// ── ① 「지금 새로 받아오기」 — 수집기가 있는 앱에만 ─────────────────────────
describe("① 수집 통로가 없으면 「지금 새로 받아오기」 단추가 없다", () => {
  it("onManualSync 를 안 주면 그 글자가 화면에 한 번도 안 나온다", () => {
    expect(renderList()).not.toContain("지금 새로 받아오기");
  });

  it("대조군 — 주면 단추가 그려진다(안 그러면 이 시험은 아무것도 못 잡는다)", () => {
    const html = renderList({ onManualSync: () => {} });
    expect(html).toContain("지금 새로 받아오기");
    expect(html).toContain("<button");
  });

  it("화면째로 봐도 같다 — 랩 통로로 그린 전체 화면엔 그 글자가 없다", () => {
    const lab = renderToStaticMarkup(<PolicyMatchScreen endpoints={LAB_ENDPOINTS} />);
    const erp = renderToStaticMarkup(<PolicyMatchScreen endpoints={ERP_POLICY_MATCH_ENDPOINTS} />);
    expect(lab).not.toContain("지금 새로 받아오기");
    expect(erp).toContain("지금 새로 받아오기");
  });
});

// ── ② 기존 고객 검색 — 고객 표가 있는 앱에만 ───────────────────────────────
describe("② 고객 불러오기 통로가 없으면 검색 칸이 없다", () => {
  it("prefillEndpoint 를 안 주면 검색 칸도 「불러오기」 단추도 안 그린다", () => {
    const html = renderToStaticMarkup(<ProfileForm onDiagnose={async () => true} diagnosing={false} />);
    expect(html).not.toContain("기존 고객 검색");
    expect(html).not.toContain("불러오기");
    // 나머지 입력 칸은 그대로 있다 — 없어지는 것은 고객 검색 한 줄뿐이다.
    expect(html).toContain("사업자 정보");
    expect(html).toContain("매칭 진단");
  });

  it("대조군 — 주면 검색 칸이 그려진다", () => {
    const html = renderToStaticMarkup(
      <ProfileForm onDiagnose={async () => true} diagnosing={false} prefillEndpoint="/api/policy-match/prefill" />,
    );
    expect(html).toContain("기존 고객 검색");
    expect(html).toContain("불러오기");
  });

  it("화면째로 봐도 같다", () => {
    expect(renderToStaticMarkup(<PolicyMatchScreen endpoints={LAB_ENDPOINTS} />)).not.toContain("기존 고객 검색");
    expect(renderToStaticMarkup(<PolicyMatchScreen endpoints={ERP_POLICY_MATCH_ENDPOINTS} />)).toContain("기존 고객 검색");
  });
});

// ── ③ 판정 피드백 조각 — 카드마다 한 번, place:"card" ──────────────────────
describe("③ 판정 피드백 조각은 카드마다 한 번 불리고 자리를 알려 준다", () => {
  it("카드 두 장이면 두 번 불리고, 넘어온 값이 그 카드의 것이다", () => {
    const calls: VerdictFeedbackContext[] = [];
    const items = [item({ announcementId: "a1", title: "첫째 공고" }), item({ announcementId: "a2", title: "둘째 공고" })];
    const profile = { region: "서울", industry: "제조업" };
    const html = renderList({
      mode: "diagnosed",
      diagnosis: diagnosis(items),
      profile,
      verdictFeedback: (ctx) => {
        calls.push(ctx);
        return <span>판정 피드백</span>;
      },
    });

    expect(calls).toHaveLength(2);
    expect(calls.map((c) => c.announcementId)).toEqual(["a1", "a2"]);
    expect(calls.map((c) => c.title)).toEqual(["첫째 공고", "둘째 공고"]);
    for (const c of calls) {
      expect(c.place).toBe("card");
      expect(c.aiVerdict, "목록에는 AI 판정이 아직 없다").toBeNull();
      expect(c.profile).toBe(profile);
    }
    expect(calls[0].item).toBe(items[0]);
    expect(html.match(/판정 피드백/g)).toHaveLength(2);
  });

  it("조각을 안 주면 한 번도 안 불리고 아무것도 안 그린다(ERP)", () => {
    const html = renderList({ mode: "diagnosed", diagnosis: diagnosis([item()]) });
    expect(html).not.toContain("판정 피드백");
    expect(html).toContain("서울 중소기업 지원"); // 카드 자체는 그대로 있다
  });
});

// ── ④ 자료실 전제 문구 — 그 통로가 있는 앱에만 ─────────────────────────────
describe("④ 자료실 통로가 없으면 「자료실」이라는 말이 화면에 안 나온다", () => {
  const modalProps = {
    policyTitle: "청년창업 지원",
    category: "금융",
    condition: "고용보험 피보험자 5인 이상",
    onClose: () => {},
  };

  it("강사 문의 창 — saveEndpoint 가 없으면 저장 단추도, 자료실을 전제한 안내도 없다", () => {
    const html = renderToStaticMarkup(<AskInstructorModal {...modalProps} />);
    expect(html).not.toContain("자료실");
    // 복사해서 쓰는 평문은 그대로 남는다 — 없어지는 것은 사내 저장 갈래뿐이다.
    expect(html).toContain("카카오톡용 복사");
    expect(html).toContain("카카오톡에 붙여넣을 평문입니다.");
  });

  it("대조군 — saveEndpoint 를 주면 저장 단추와 안내가 돌아온다", () => {
    const html = renderToStaticMarkup(
      <AskInstructorModal {...modalProps} saveEndpoint="/api/policy-match/ask-instructor" />,
    );
    expect(html).toContain("자료실에 질문 저장");
    expect(html).toContain("자료실에도 같은 내용으로 질문 카드를 남길 수 있습니다.");
  });

  it("돌파구 안내 구역은 「우리 자료실·고객이력」을 전제한다 — 그래서 통로가 있을 때만 그린다", () => {
    // 이 글자가 사는 곳은 이 부품 하나다(상세는 endpoints.breakthrough 가 있을 때만 이걸 그린다).
    const html = renderToStaticMarkup(<BreakthroughPrompt summary="미충족 1건" onRun={() => {}} />);
    expect(html).toContain("우리 자료실·고객이력에서 넘는 방법을 찾아봅니다");
    expect(html).toContain("돌파구 찾기");
  });

  it("랩 통로로 그린 화면·상세에는 「자료실」이 한 번도 안 나온다", () => {
    // ※ 손잡이가 안 도는 자리(공고를 고른 뒤의 상세 본문)까지는 여기서 못 잰다 — 위 머리주석 참고.
    for (const html of [
      renderToStaticMarkup(<PolicyMatchScreen endpoints={LAB_ENDPOINTS} />),
      renderToStaticMarkup(<DetailPanel endpoints={LAB_ENDPOINTS} announcementId="" mode="browse" profile={{}} profileNonce={0} item={null} hasDiagnosis={false} />),
      renderToStaticMarkup(<DetailPanel endpoints={LAB_ENDPOINTS} announcementId="a1" mode="diagnosed" profile={{}} profileNonce={1} item={item()} hasDiagnosis />),
    ]) {
      expect(html).not.toContain("자료실");
      expect(html).not.toContain("고객이력");
    }
  });
});

/**
 * 손잡이가 안 도는 자리는 **그려서** 못 잰다. 그 자리만 「배선을 읽어」 감시한다 —
 * 그리는 시험을 대신하지는 못하지만, 통로 조건을 지우는 흔한 회귀는 여기서 걸린다.
 * (배포본에서 실제로 눌러 보는 확인은 브라우저 QA 몫이다.)
 */
describe("④-감시선 — 통로 조건이 코드에서 사라지면 걸린다", () => {
  const 폴더 = new URL(".", import.meta.url);
  const 읽기 = (name: string) => readFileSync(new URL(name, 폴더), "utf8");

  it("자료실·고객이력이라는 말은 DetailPanel 밖으로 안 나간다", () => {
    // ※ `endpoints.ts` 는 그리는 파일이 아니라 계약 파일이라 뺀다 — 「이 통로가 없으면
    //    자료실 문구를 안 그린다」를 주석으로 설명하는 자리다.
    for (const name of [
      "PolicyMatchScreen.tsx", "ProfileForm.tsx", "ResultList.tsx",
      "SourceDirectoryPanel.tsx", "Modal.tsx",
      "detail-poll.ts", "ask-instructor-text.ts",
    ]) {
      const src = 읽기(name);
      expect(src, `${name} 에 자료실 전제 문구가 생겼다`).not.toContain("자료실");
      expect(src, `${name} 에 고객이력 전제 문구가 생겼다`).not.toContain("고객이력");
    }
    // 대조군 — 그 말이 사는 곳은 실제로 여기다(아무 데도 없으면 위 시험은 공허하다).
    expect(읽기("DetailPanel.tsx")).toContain("자료실");
  });

  it("AI 판정·돌파구·자료실 저장은 각자 통로에 묶여 있다", () => {
    const src = 읽기("DetailPanel.tsx");
    expect(src, "AI 판정 단추가 통로 조건 없이 그려진다").toContain("endpoints.verdict && (");
    expect(src, "돌파구 구역이 통로 조건 없이 그려진다").toContain("endpoints.breakthrough && verdict &&");
    expect(src, "강사 문의 창에 저장 통로를 안 넘긴다").toContain("saveEndpoint={endpoints.askInstructor}");
  });
});

// ── ⑤ raw Tailwind 색 0건 — 다섯 부품을 그려서 잰다 ─────────────────────────
describe("⑤ 그려 낸 HTML 에 raw Tailwind 색이 하나도 없다(WEDLY 토큰만)", () => {
  const 화면들: Array<[string, string]> = [
    ["PolicyMatchScreen(ERP 통로)", renderToStaticMarkup(<PolicyMatchScreen endpoints={ERP_POLICY_MATCH_ENDPOINTS} />)],
    ["PolicyMatchScreen(랩 통로)", renderToStaticMarkup(<PolicyMatchScreen endpoints={LAB_ENDPOINTS} />)],
    ["ProfileForm", renderToStaticMarkup(
      <ProfileForm onDiagnose={async () => true} diagnosing={false} prefillEndpoint="/api/policy-match/prefill" />,
    )],
    ["ResultList(진단)", renderList({
      mode: "diagnosed",
      diagnosis: diagnosis([
        item({ needsReview: true, grade: "possible" }),
        item({ announcementId: "a2", ruleOnly: true, grade: "possible" }),
        item({ announcementId: "a3", unanalyzed: true, grade: "possible" }),
      ]),
      onManualSync: () => {},
    })],
    ["ResultList(탐색)", renderList({ onManualSync: () => {} })],
    ["DetailPanel(빈 상태)", renderToStaticMarkup(
      <DetailPanel endpoints={ERP_POLICY_MATCH_ENDPOINTS} announcementId="" mode="browse" profile={{}} profileNonce={0} item={null} hasDiagnosis={false} />,
    )],
    ["SourceDirectoryPanel(접힘)", renderToStaticMarkup(
      <SourceDirectoryPanel endpoint="/api/policy-match/sources" onExport={async () => {}} trailingPaddingClass="pr-14" />,
    )],
    ["SourceDirectoryTable", renderToStaticMarkup(
      <SourceDirectoryTable entries={[
        directoryRow(),
        directoryRow({ label: "전북테크노파크", status: "waiting", note: "국내 IP 로만 열림", lastSaved: null }),
        directoryRow({ label: "한국산업기술진흥원", status: "error", lastError: "목록 행 0개" }),
        directoryRow({ label: "훈련과정 API", status: "excluded", note: "공고가 아니라 카탈로그" }),
        directoryRow({ label: "상한 도달", hitCap: true, lastSaved: 1234 }),
      ]} />,
    )],
    ["Modal", renderToStaticMarkup(
      <Modal open onClose={() => {}} title="제목" description="설명" footer={<button type="button">확인</button>}>
        <p>내용</p>
      </Modal>,
    )],
    ["AskInstructorModal", renderToStaticMarkup(
      <AskInstructorModal policyTitle="청년창업 지원" category="금융" condition="업력 3년 이하" onClose={() => {}} saveEndpoint="/api/policy-match/ask-instructor" />,
    )],
    ["BreakthroughPrompt", renderToStaticMarkup(<BreakthroughPrompt summary="미충족 1건 · 확인필요 2건" onRun={() => {}} />)],
  ];

  it("대조군 — 이 자(RAW색)가 실제로 금지 색을 잡는다", () => {
    // ★금지 색을 **글자 그대로** 적지 않고 이어 붙여 만든다 — 그대로 적으면 CLAUDE.md rule#1 의
    //  「raw 색 찾기」 grep 이 이 시험 파일을 진짜 위반으로 잡아 남의 완료 관문을 막는다.
    const 금지 = `class="bg-${"green"}-50 text-${"red"}-600"`;
    expect(금지).toMatch(RAW색);
    expect('class="bg-wedly-bg-green text-wedly-red"').not.toMatch(RAW색);
  });

  for (const [이름, html] of 화면들) {
    it(`${이름} — raw 색 0건`, () => {
      expect(html.length, "그린 것이 없으면 이 시험은 아무것도 못 잡는다").toBeGreaterThan(80);
      expect(html).not.toMatch(RAW색);
    });
  }
});

// ── 엑셀 단추도 같은 규칙 — 앱이 저장을 대신해 줄 때만 그린다 ────────────────
describe("엑셀 내려받기는 앱이 저장을 맡을 때만 그린다", () => {
  it("펼친 표(SourceDirectoryTable)는 단추와 무관하게 그대로 그려진다", () => {
    const html = renderToStaticMarkup(<SourceDirectoryTable entries={[directoryRow()]} />);
    expect(html).toContain("부산테크노파크");
    expect(html).not.toContain("엑셀 내려받기");
  });
});
