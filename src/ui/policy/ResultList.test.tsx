import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import ResultList, { deadlineMetricLabel, GroupMembers, type BrowseBundle } from "./ResultList";
import type { DiagnoseItem, Diagnosis, Row } from "./PolicyMatchScreen";

function item(over: Partial<DiagnoseItem> = {}): DiagnoseItem {
  return {
    announcementId: "a1",
    title: "서울 중소기업 지원",
    agency: "중기부",
    category: "금융",
    applyEnd: "2026-09-30T00:00:00.000Z",
    applyPeriodText: "2026-08-01 ~ 2026-09-30",
    grade: "uncertain",
    needsReview: false,
    ruleOnly: false,
    failSummary: "",
    checks: { total: 0, pass: 0, fail: 0, unknown: 0, humanCheck: 0 },
    ...over,
  };
}

const browse: BrowseBundle = {
  rows: [],
  total: 0,
  page: 1,
  q: "",
  qInput: "",
  status: "open",
  loading: false,
  refreshing: false,
  lastSyncAt: null,
  setQInput: () => {},
  submitSearch: () => {},
  setStatus: () => {},
  setPage: () => {},
};

/** 목록 통로 — 진단 묶음(「외 N건」) 구성원을 받아 올 주소. */
const ANNOUNCEMENTS = "/api/policy-match/announcements";

function renderDiagnosed(diagnosis: Diagnosis): string {
  return renderToStaticMarkup(
    <ResultList
      mode="diagnosed"
      onModeChange={() => {}}
      diagnosis={diagnosis}
      selectedId=""
      onSelect={() => {}}
      browse={browse}
      announcementsEndpoint={ANNOUNCEMENTS}
    />,
  );
}

const emptyProgress = { total: 1, done: 0, pending: 1, needsReview: 0, failed: 0 };

describe("ResultList — 미분석 표시", () => {
  it("unanalyzed 면 「아직 분석 안 됨」 뱃지를 그리고 「조건 확인 필요」는 그리지 않는다", () => {
    const html = renderDiagnosed({
      possible: [],
      uncertain: [item({ unanalyzed: true, failSummary: "" })],
      impossible: [],
      structureProgress: emptyProgress,
      analyzedCount: 0,
      candidateCount: 1,
    });
    expect(html).toContain("아직 분석 안 됨");
    expect(html).toContain("bg-wedly-bg-yellow");
    expect(html).not.toContain("조건 확인 필요");
  });

  it("읽었는데 애매한 공고는 「조건 확인 필요」를 그대로 그린다", () => {
    const html = renderDiagnosed({
      possible: [],
      uncertain: [item({ needsReview: true, unanalyzed: false, failSummary: "" })],
      impossible: [],
      structureProgress: emptyProgress,
      analyzedCount: 1,
      candidateCount: 1,
    });
    expect(html).toContain("조건 확인 필요");
    expect(html).not.toContain("아직 분석 안 됨");
  });

  it("진단 띠는 AI 가 읽은 건수와 나머지가 간이 판정임을 적는다", () => {
    const html = renderDiagnosed({
      possible: [],
      uncertain: [item({ unanalyzed: true })],
      impossible: [],
      structureProgress: emptyProgress,
      analyzedCount: 0,
      candidateCount: 3,
    });
    expect(html).toContain("후보 3건 중 0건은 AI 가 읽었습니다 — 나머지는 간이 판정이며, 공고를 열면 그 자리서 읽습니다");
    expect(html).not.toContain("나머지는 공고를 열면 분석됩니다");
  });
});

describe("ResultList — 소재지 제외 건수", () => {
  const done = { possible: [], uncertain: [], impossible: [], structureProgress: emptyProgress };

  it("분석이 다 끝나도 제외 건수는 계속 보인다", () => {
    // 다 읽힌 뒤가 이 시스템이 지향하는 상태다. 그때 「왜 그 공고가 안 보이냐」에 답할
    // 숫자가 함께 사라지면 안 된다(2026-08-24 화면 독립 검사 2번).
    const html = renderDiagnosed({ ...done, analyzedCount: 5, candidateCount: 5, droppedByRegion: 940 });
    expect(html).toContain("소재지가 맞지 않아 940건 제외");
    expect(html).not.toContain("건 분석 —");
  });

  it("아직 분석 중이면 두 줄이 가운뎃점으로 이어진다", () => {
    const html = renderDiagnosed({ ...done, analyzedCount: 4, candidateCount: 5, droppedByRegion: 940 });
    expect(html).toContain("후보 5건 중 4건은 AI 가 읽었습니다");
    expect(html).toContain("소재지가 맞지 않아 940건 제외");
  });

  it("제외가 0건이면 그 문구는 안 뜬다", () => {
    const html = renderDiagnosed({ ...done, analyzedCount: 5, candidateCount: 5, droppedByRegion: 0 });
    expect(html).not.toContain("소재지가 맞지 않아");
  });

  it("옛 응답(제외 건수 없음)이어도 화면이 깨지지 않는다", () => {
    const html = renderDiagnosed({ ...done, analyzedCount: 5, candidateCount: 5 });
    expect(html).not.toContain("소재지가 맞지 않아");
  });
});

function browseRow(over: Partial<Row> & Pick<Row, "id" | "dedupKey">): Row {
  return {
    source: "ulsan",
    title: "울산 기업지원 공고",
    agency: "울산테크노파크",
    category: "기술지원",
    region: "울산",
    summary: "",
    targetText: "",
    applyStart: null,
    applyEnd: null,
    applyPeriodText: "",
    url: "",
    status: "open",
    firstSeenAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

describe("ResultList — browse 서버 묶음 표시", () => {
  function renderBrowse(rows: Row[], selectedId = "") {
    return renderToStaticMarkup(
      <ResultList
        mode="browse"
        onModeChange={() => {}}
        diagnosis={null}
        selectedId={selectedId}
        onSelect={() => {}}
        browse={{ ...browse, total: rows.length, rows }}
        announcementsEndpoint={ANNOUNCEMENTS}
      />,
    );
  }

  it("groupCount≥2 면 「외 N건」 펼침 버튼을 그린다", () => {
    const html = renderBrowse([browseRow({ id: "a", dedupKey: "k", groupCount: 3, groupIds: ["a", "b", "c"] })]);
    expect(html).toContain("외 2건");
    // 카드가 div[role=button] 이고 그 안의 「외 N건」은 진짜 button 이다
    expect(html).toContain('role="button"');
  });

  it("groupCount 1(또는 없음)이면 알약이 없다", () => {
    const html = renderBrowse([browseRow({ id: "a", dedupKey: "k" })]);
    expect(html).not.toContain("외 ");
  });

  it("숨은 구성원이 선택돼 있으면 대표 카드가 강조된다", () => {
    const html = renderBrowse(
      [browseRow({ id: "a", dedupKey: "k", groupCount: 2, groupIds: ["a", "b"] })],
      "b",
    );
    expect(html).toContain("border-wedly-accent bg-wedly-bg-blue/40");
  });
});

describe("GroupMembers — 펼친 하위 목록", () => {
  it("대표를 뺀 구성원을 각각 누를 수 있는 버튼으로 그린다", () => {
    const html = renderToStaticMarkup(
      <GroupMembers
        repId="a"
        members={[
          browseRow({ id: "a", dedupKey: "k", category: "기술지원" }),
          browseRow({ id: "b", dedupKey: "k", category: "사업화지원" }),
        ]}
        selectedId=""
        onSelect={() => {}}
      />,
    );
    expect(html).not.toContain("기술지원"); // 대표(a)는 하위 목록에 안 나온다
    expect(html).toContain("사업화지원");
    expect(html).toContain("<button");
  });
});

describe("ResultList — 간이 판정(AI 없이 규칙으로 본 것)", () => {
  it("ruleOnly 면 「간이 판정」을 그리고 다른 뱃지는 안 그린다", () => {
    const html = renderDiagnosed({
      possible: [item({ ruleOnly: true, needsReview: false, grade: "possible" })],
      uncertain: [],
      impossible: [],
      structureProgress: emptyProgress,
      analyzedCount: 0,
      candidateCount: 1,
    });
    expect(html).toContain("간이 판정");
    expect(html).not.toContain("조건 확인 필요");
    expect(html).not.toContain("아직 분석 안 됨");
  });

  it("AI 가 읽어 애매한 공고는 그대로 「조건 확인 필요」", () => {
    const html = renderDiagnosed({
      possible: [],
      uncertain: [item({ needsReview: true })],
      impossible: [],
      structureProgress: emptyProgress,
      analyzedCount: 1,
      candidateCount: 1,
    });
    expect(html).toContain("조건 확인 필요");
    expect(html).not.toContain("간이 판정");
  });
});

describe("출처 이름표 — 기관 정식 명칭으로 통일(독립 검사 4차)", () => {
  function labelOf(source: string): string {
    return renderToStaticMarkup(
      <GroupMembers
        repId="rep"
        members={[browseRow({ id: "rep", dedupKey: "k" }), browseRow({ id: "m", dedupKey: "k", source })]}
        selectedId=""
        onSelect={() => {}}
      />,
    );
  }
  it("서울TP 는 다른 테크노파크와 같은 규칙으로 적는다(로마자 줄임말 금지)", () => {
    const html = labelOf("seoultp");
    expect(html).toContain("서울테크노파크");
    expect(html).not.toContain("서울TP");
  });
  it("경기신보·경북경제진흥원·보건산업진흥원도 정식 명칭", () => {
    expect(labelOf("gcgf")).toContain("경기신용보증재단");
    expect(labelOf("gepa")).toContain("경상북도경제진흥원");
    expect(labelOf("khidi")).toContain("한국보건산업진흥원");
  });
  it("원시 id 가 그대로 새지 않는다", () => {
    for (const s of ["seoultp", "gepa", "khidi", "gcgf", "smartfactory"]) {
      expect(labelOf(s)).not.toContain(`>${s}<`);
    }
  });
});

describe("deadlineMetricLabel — 상세창 「마감」 칸(독립 검사 4차: 라벨과 값이 반대말이던 문제)", () => {
  it("마감일이 없으면 시작일을 그대로 쓰지 않는다(5차에서 문구는 「확인 필요」로)", () => {
    expect(deadlineMetricLabel(null, "2026-08-10 ~").label).not.toContain("2026-08-10");
  });
  it("마감일이 있으면 D-day 를 그대로 쓴다", () => {
    const end = new Date(Date.now() + 5 * 24 * 3600 * 1000).toISOString();
    expect(deadlineMetricLabel(end, "").label).toBe("D-5");
  });
  it("지난 마감은 「마감」", () => {
    expect(deadlineMetricLabel("2026-01-01T00:00:00.000Z", "").label).toBe("마감");
  });
});

describe("deadlineMetricLabel — 마감 상태·모름 구분(독립 검사 5차)", () => {
  it("마감일을 못 읽었으면 「없다」가 아니라 「확인 필요」", () => {
    expect(deadlineMetricLabel(null, "2026-08-10 ~").label).toBe("확인 필요");
  });
  it("마감일이 없어도 이미 닫힌 공고는 「마감」이라고 말한다", () => {
    expect(deadlineMetricLabel(null, "예산 소진시까지", "closed").label).toBe("마감");
  });
  it("마감 칸 값은 알약을 쓰지 않는다(상자 배경과 같은 색이라 안 보이고 8px 밀린다)", () => {
    expect(deadlineMetricLabel(null, "", "closed").className).not.toContain("rounded-full");
    expect(deadlineMetricLabel(null, "", "closed").className).not.toContain("px-2");
  });
});
