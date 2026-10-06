import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ConditionCheck } from "../../engine/structure-types";
import type { PolicyAttachment } from "../../engine/types";
import type { VerdictResult } from "../../ai/verdict";
import {
  AttachmentRows, CHECK_ORIGINAL, ConditionTable, DetailActionBar, ScheduleBlock, SummaryCells, SupportTable,
  attachmentKindOf, conditionSummaryOf, countRows, mergeConditionRows, downloadAttachmentsInOrder, downloadAllMessageOf, fileNameFromDisposition, DOWNLOAD_ALL_MAX, scheduleOf,
  shortAmountOf, showsDownloadAll, summaryCellsOf,
} from "./detail-structured";

/**
 * 상세 칸 재구성(C3) — 요약 3칸 · 신청 자격 대조표 · 지원 대상·내용 표 · 접수 일정 막대 · 첨부 줄 · 아래 고정 줄.
 *
 * ★이 저장소엔 jsdom 이 없고 DetailPanel 은 공고를 불러온 뒤에야 본문을 그린다 — 그래서 ① 값 계산은 순수 함수로 직접 재고,
 *  ② 그림은 값을 받아 그리는 부품(`detail-structured.tsx`)을 `renderToStaticMarkup` 로 재고, ③ DetailPanel 의 배선·
 *  남겨야 할 자리(다른 탭·AI 판정·돌파구·판정 피드백 detail 슬롯)는 소스 글자로 잰다.
 */

const 글자 = (html: string) => html.replace(/<!-- -->/g, "");
const 폴더 = new URL(".", import.meta.url);
const 읽기 = (name: string) => readFileSync(new URL(name, 폴더), "utf8");
const RAW색 =
  /(?:^|["\s])(?:bg|text|border|from|to)-(?:green|amber|red|sky|blue|indigo|violet|pink|gray|slate|zinc|orange|yellow|lime|emerald|teal|cyan|rose|fuchsia)-(?:50|100|200|300|400|500|600|700|800|900)\b/;
const 이모지 = /\p{Extended_Pictographic}/u;

// 한국 시간 2026-10-06 12:00
const 오늘 = new Date("2026-10-06T03:00:00Z");
// 한국 시간 09.20 00:00 ~ 10.17 16:00
const 시작 = "2026-09-19T15:00:00Z";
const 마감 = "2026-10-17T07:00:00Z";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// ── 1. 요약 숫자 3칸 ─────────────────────────────────────────────────────
describe("요약 숫자 3칸 — 지원 금액 · 접수 마감 · 신청 기간", () => {
  const 셋 = () =>
    summaryCellsOf({
      supportAmountText: "최대 3억 원(평균 1.2억 원) — 공고 원문 그대로",
      applyStart: 시작,
      applyEnd: 마감,
      applyPeriodText: "",
      now: 오늘,
    });

  it("지원 금액은 앞부분만 짧게, 아래 작은 글은 「공고 원문 금액 글」", () => {
    const [금액] = 셋();
    expect(금액).toMatchObject({ label: "지원 금액", value: "최대 3억 원", sub: "공고 원문 금액 글" });
  });

  it("접수 마감은 D-n, 아래는 마감 날짜 · 신청 기간은 N일, 아래는 시작~마감", () => {
    const [, 마감칸, 기간] = 셋();
    expect(마감칸).toMatchObject({ label: "접수 마감", value: "D-11", sub: "2026.10.17", hot: false });
    expect(기간).toMatchObject({ label: "신청 기간", value: "28일", sub: "09.20 ~ 10.17" });
  });

  it("마감 7일 이내면 빨간 토큰 글자, 8일 이상이면 아니다", () => {
    const 가까움 = summaryCellsOf({
      supportAmountText: "", applyStart: 시작, applyEnd: "2026-10-10T07:00:00Z", applyPeriodText: "", now: 오늘,
    })[1];
    expect(가까움).toMatchObject({ value: "D-4", hot: true });
    const 칠일 = summaryCellsOf({
      supportAmountText: "", applyStart: 시작, applyEnd: "2026-10-13T07:00:00Z", applyPeriodText: "", now: 오늘,
    })[1];
    expect(칠일).toMatchObject({ value: "D-7", hot: true });
    const 팔일 = summaryCellsOf({
      supportAmountText: "", applyStart: 시작, applyEnd: "2026-10-14T07:00:00Z", applyPeriodText: "", now: 오늘,
    })[1];
    expect(팔일.hot).toBe(false);

    const 가까운그림 = 글자(renderToStaticMarkup(<SummaryCells cells={[가까움, 셋()[0], 셋()[2]]} />));
    expect(가까운그림).toContain("text-wedly-red-ink");
    expect(글자(renderToStaticMarkup(<SummaryCells cells={셋()} />))).not.toContain("text-wedly-red-ink");
  });

  it("오늘이 마감이면 D-DAY, 지났으면 마감", () => {
    const 오늘마감 = summaryCellsOf({
      supportAmountText: "", applyStart: null, applyEnd: "2026-10-06T07:00:00Z", applyPeriodText: "", now: 오늘,
    })[1];
    expect(오늘마감.value).toBe("D-DAY");
    const 지남 = summaryCellsOf({
      supportAmountText: "", applyStart: null, applyEnd: "2026-10-01T07:00:00Z", applyPeriodText: "", now: 오늘,
    })[1];
    expect(지남.value).toBe("마감");
    expect(지남.hot).toBe(false);
  });

  it("값이 없으면 세 칸 모두 「공고 원문 확인」", () => {
    const 빈 = summaryCellsOf({
      supportAmountText: "", applyStart: null, applyEnd: null, applyPeriodText: "", now: 오늘,
    });
    expect(빈.map((c) => c.value)).toEqual([CHECK_ORIGINAL, CHECK_ORIGINAL, CHECK_ORIGINAL]);
    expect(CHECK_ORIGINAL).toBe("공고 원문 확인");
    const html = 글자(renderToStaticMarkup(<SummaryCells cells={빈} />));
    expect(html.match(/공고 원문 확인/g)).toHaveLength(3);
    // 값이 없는 칸에는 지어낸 작은 글이 붙지 않는다
    expect(html).not.toContain("공고 원문 금액 글");
  });

  it("상시 공고의 접수 마감은 「상시」, 마감일만 있고 시작일이 없으면 신청 기간은 원문 확인", () => {
    const 상시 = summaryCellsOf({
      supportAmountText: "", applyStart: null, applyEnd: null, applyPeriodText: "상시 접수", now: 오늘,
    });
    expect(상시[1].value).toBe("상시");
    const 끝만 = summaryCellsOf({
      supportAmountText: "", applyStart: null, applyEnd: 마감, applyPeriodText: "", now: 오늘,
    });
    expect(끝만[2].value).toBe(CHECK_ORIGINAL);
  });

  it("지원 금액이 길면 16글자에서 줄이고, 쉼표·괄호 앞까지만 쓴다", () => {
    expect(shortAmountOf("가".repeat(30))).toBe(`${"가".repeat(16)}…`);
    expect(shortAmountOf("기업당 최대 5천만 원, 총 20개 사")).toBe("기업당 최대 5천만 원");
    expect(shortAmountOf("  ")).toBe("");
  });

  it("세 칸은 한 줄 grid 이다", () => {
    const html = renderToStaticMarkup(<SummaryCells cells={셋()} />);
    expect(html).toContain("grid-cols-3");
  });
});

// ── 2. 신청 자격 대조표 ──────────────────────────────────────────────────
function 기계(rawText: string, verdict: ConditionCheck["verdict"], note: string, key = "other"): ConditionCheck {
  return { condition: { key, op: "eq", value: true, rawText, machineReadable: true }, verdict, note } as unknown as ConditionCheck;
}
const AI: VerdictResult["checklist"] = [
  { condition: "업력 3년 초과 7년 이내 창업기업", status: "충족", note: "설립 2021.03" },
  { condition: "법인 또는 개인사업자", status: "충족", note: "법인" },
  { condition: "만 39세 이하 대표자 우대", status: "확인필요", note: "대표자 나이 모름" },
];
const 기계들 = [
  기계("업력 3년 초과 7년 이내 창업기업", "unknown", "설립일 모름", "businessAgeMaxYears"),
  기계("법인 또는 개인사업자", "pass", "법인", "isCorporation"),
  기계("국세·지방세 체납 기업 제외", "fail", "체납 있음", "noTaxDelinquency"),
];

describe("신청 자격 대조표 — 맞는 이유·조건 체크리스트와 AI 체크리스트를 한 표로", () => {
  it("같은 조건은 한 줄로 합치고, AI 에만 있는 조건은 덧붙인다", () => {
    const rows = mergeConditionRows(기계들, AI);
    expect(rows).toHaveLength(4); // 3 + 1(AI 에만 있는 우대 조건) — 겹친 둘은 합쳐졌다
    const 업력 = rows.find((r) => r.condition.startsWith("업력"));
    // 기계가 「확인 필요」였는데 AI 가 맞음을 말했으면 AI 판정을 쓰고, 근거는 둘을 잇는다
    expect(업력).toMatchObject({ verdict: "pass", evidence: "설립일 모름 · 설립 2021.03", label: "업력 상한" });
    // 같은 근거를 두 번 적지 않는다
    expect(rows.find((r) => r.condition === "법인 또는 개인사업자")?.evidence).toBe("법인");
    // 기계가 안 맞음이면 AI 줄이 없어도 그대로
    expect(rows.find((r) => r.condition.startsWith("국세"))).toMatchObject({ verdict: "fail", evidence: "체납 있음" });
    // AI 에만 있던 조건
    expect(rows[3]).toMatchObject({ condition: "만 39세 이하 대표자 우대", verdict: "unknown", evidence: "대표자 나이 모름", label: "" });
  });

  it("AI 가 안 맞음이라 해도 기계가 이미 맞음/안 맞음을 정한 줄은 기계 판정을 지키고 근거만 더한다", () => {
    const rows = mergeConditionRows(
      [기계("법인 또는 개인사업자", "pass", "법인")],
      [{ condition: "법인 또는 개인사업자", status: "미충족", note: "등기부 확인 필요" }],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ verdict: "pass", evidence: "법인 · 등기부 확인 필요" });
  });

  it("AI 판정이 없으면 기계 체크리스트만(진단 전·AI 안 돌린 경우)", () => {
    expect(mergeConditionRows(기계들, null)).toHaveLength(3);
    expect(mergeConditionRows(기계들, undefined)).toHaveLength(3);
    expect(mergeConditionRows([], null)).toEqual([]);
  });

  it("요약 숫자 — N개 중 N개 맞음 · N개 확인 필요 · N개 안 맞음(0개인 갈래는 말하지 않는다)", () => {
    const rows = mergeConditionRows(기계들, AI);
    expect(countRows(rows)).toEqual({ total: 4, pass: 2, fail: 1, unknown: 1 });
    expect(conditionSummaryOf(countRows(rows))).toBe("4개 중 2개 맞음 · 1개 확인 필요 · 1개 안 맞음");
    expect(conditionSummaryOf({ total: 5, pass: 4, fail: 0, unknown: 1 })).toBe("5개 중 4개 맞음 · 1개 확인 필요");
    expect(conditionSummaryOf({ total: 2, pass: 2, fail: 0, unknown: 0 })).toBe("2개 중 2개 맞음");
  });

  it("그림 — 열 이름 · 요약 · 판정 글자 · 같은 조건 한 번씩만", () => {
    const html = 글자(renderToStaticMarkup(<ConditionTable rows={mergeConditionRows(기계들, AI)} emptyNote="없음" />));
    for (const 열 of ["공고 조건", "판정", "이 회사 값 · 근거"]) expect(html).toContain(열);
    expect(html).toContain("4개 중 2개 맞음 · 1개 확인 필요 · 1개 안 맞음");
    // 판정은 색 점 + 글자를 함께
    for (const 판정 of ["맞음", "확인 필요", "안 맞음"]) expect(html).toContain(판정);
    expect(html).toContain("bg-wedly-green");
    expect(html).toContain("bg-wedly-gold-ink");
    expect(html).toContain("bg-wedly-red");
    // 같은 조건이 두 번 나오지 않는다
    expect(html.match(/업력 3년 초과 7년 이내 창업기업/g)).toHaveLength(1);
    expect(html.match(/법인 또는 개인사업자/g)).toHaveLength(1);
    // 이름표(조건 종류)가 원문 앞에 붙는다
    expect(html).toContain("업력 상한: ");
  });

  it("조건이 하나도 없으면 표 대신 안내 한 줄", () => {
    const html = 글자(renderToStaticMarkup(<ConditionTable rows={[]} emptyNote="기계로 대조할 조건이 없습니다" />));
    expect(html).toContain("기계로 대조할 조건이 없습니다");
    expect(html).not.toContain("<table");
  });
});

// ── 3. 지원 대상·내용 표 ─────────────────────────────────────────────────
describe("지원 대상·내용 표", () => {
  it("이름표 칸 | 값 칸, 줄마다 구분선, 지원 금액은 원문 그대로 전체", () => {
    const 긴글 = "지원금액: 기업당 최대 3억 원\n항목별 상한은 아래와 같다\n- 사업화 2억\n- 판로 1억";
    const html = 글자(renderToStaticMarkup(
      <SupportTable target="업력 3년 초과 7년 이내 창업기업" benefit="사업화 자금과 판로 연계" amountText={긴글} />,
    ));
    for (const 이름 of ["지원 대상", "지원 내용", "지원 금액"]) expect(html).toContain(`>${이름}<`);
    expect(html).toContain("업력 3년 초과 7년 이내 창업기업");
    expect(html).toContain("사업화 자금과 판로 연계");
    expect(html).toContain(긴글); // 줄이지 않는다
    expect(html).toContain("whitespace-pre-wrap");
    expect(html.match(/border-t border-wedly-bd/g)).toHaveLength(2); // 세 줄 사이 구분선 둘
  });

  it("값이 없는 줄은 「공고 원문 확인」", () => {
    const html = 글자(renderToStaticMarkup(<SupportTable target="" benefit="  " amountText="" />));
    expect(html.match(/공고 원문 확인/g)).toHaveLength(3);
  });
});

// ── 4. 접수 일정 ─────────────────────────────────────────────────────────
describe("접수 일정 — 막대 위에 오늘 점", () => {
  it("시작·마감이 있으면 막대: 오늘 위치 % · 「오늘 MM.DD · 마감까지 N일」", () => {
    const view = scheduleOf({ applyStart: 시작, applyEnd: 마감, applyPeriodText: "", now: 오늘 });
    expect(view).toEqual({
      kind: "bar", startText: "09.20", endText: "10.17", todayText: "오늘 10.06 · 마감까지 11일", percent: 59,
    });
    const html = 글자(renderToStaticMarkup(<ScheduleBlock view={view} />));
    expect(html).toContain("오늘 10.06 · 마감까지 11일");
    expect(html).toContain("접수 시작");
    expect(html).toContain("09.20");
    expect(html).toContain("10.17");
    expect(html).toContain("width:59%"); // 채움
    expect(html).toContain("left:59%"); // 오늘 점
    expect(html).toContain("data-today-dot");
    expect(html).toContain("평가·발표 일정은 공고 원문에서 확인하세요.");
  });

  it("시작 전이면 점은 맨 왼쪽, 마감 뒤면 맨 오른쪽 + 「접수 마감」", () => {
    const 전 = scheduleOf({ applyStart: "2026-10-20T00:00:00Z", applyEnd: "2026-10-30T00:00:00Z", applyPeriodText: "", now: 오늘 });
    expect(전).toMatchObject({ kind: "bar", percent: 0 });
    const 후 = scheduleOf({ applyStart: "2026-09-01T00:00:00Z", applyEnd: "2026-09-30T00:00:00Z", applyPeriodText: "", now: 오늘 });
    expect(후).toMatchObject({ kind: "bar", percent: 100, todayText: "오늘 10.06 · 접수 마감" });
  });

  it("상시 · 날짜 모름이면 막대 대신 한 줄, 평가·발표 안내는 그대로", () => {
    const 상시 = scheduleOf({ applyStart: null, applyEnd: null, applyPeriodText: "상시", now: 오늘 });
    expect(상시).toEqual({ kind: "line", text: "상시 접수 — 마감일이 없어요." });
    const 모름 = scheduleOf({ applyStart: null, applyEnd: null, applyPeriodText: "", now: 오늘 });
    expect(모름).toEqual({ kind: "line", text: "접수 일정은 공고 원문에서 확인하세요." });
    for (const view of [상시, 모름]) {
      const html = 글자(renderToStaticMarkup(<ScheduleBlock view={view} />));
      expect(html).not.toContain("data-schedule-bar");
      expect(html).not.toContain("data-today-dot");
      expect(html).toContain("평가·발표 일정은 공고 원문에서 확인하세요.");
    }
  });

  it("마감일만 있고 시작일이 없으면 한 줄로 마감까지 남은 날을 말한다", () => {
    const view = scheduleOf({ applyStart: null, applyEnd: 마감, applyPeriodText: "", now: 오늘 });
    expect(view).toEqual({ kind: "line", text: "마감 10.17 · 마감까지 11일" });
  });

  it("단계별 평가 일정 같은 없는 칸은 만들지 않는다", () => {
    const html = 글자(renderToStaticMarkup(
      <ScheduleBlock view={scheduleOf({ applyStart: 시작, applyEnd: 마감, applyPeriodText: "", now: 오늘 })} />,
    ));
    for (const 없는칸 of ["서류 평가", "발표 평가", "최종 선정", "자부담"]) expect(html).not.toContain(없는칸);
  });
});

// ── 5. 첨부 줄과 「첨부 모두 받기」 ──────────────────────────────────────
const 파일들: PolicyAttachment[] = [
  { name: "2026_창업도약패키지_공고.hwp", url: "https://example.org/a.hwp", kind: "hwp" },
  { name: "사업계획서_양식.PDF", url: "https://example.org/b.pdf", kind: "pdf" },
];

describe("첨부 파일 줄", () => {
  it("파일마다 확장자(대문자) · 이름 · 받기, 제목에 개수", () => {
    const html = 글자(renderToStaticMarkup(<AttachmentRows attachments={파일들} />));
    expect(html).toContain("첨부 파일");
    expect(html).toContain("2개");
    expect(html).toContain(">HWP<");
    expect(html).toContain(">PDF<");
    expect(html).toContain("2026_창업도약패키지_공고.hwp");
    expect(html).toContain("사업계획서_양식.PDF");
    expect(html.match(/>받기</g)).toHaveLength(2);
    expect(html).toContain('href="https://example.org/a.hwp"');
    // 크기 칸이 자료에 없으니 크기를 쓰지 않는다
    expect(html).not.toMatch(/\d\s?(KB|MB)/);
  });

  it("첨부가 없으면 아무것도 그리지 않는다", () => {
    expect(renderToStaticMarkup(<AttachmentRows attachments={[]} />)).toBe("");
  });

  it("종류 표시 — 이름 끝 확장자 > 분류값 > 「파일」", () => {
    expect(attachmentKindOf({ name: "양식.hwpx", url: "u", kind: "hwpx" })).toBe("HWPX");
    expect(attachmentKindOf({ name: "공고문", url: "u", kind: "zip" })).toBe("ZIP");
    expect(attachmentKindOf({ name: "공고문", url: "u", kind: "etc" })).toBe("파일");
    expect(attachmentKindOf({ name: "자료.xlsx", url: "u", kind: "etc" })).toBe("XLSX");
  });
});

describe("칸 아래 고정 줄 — 공고 원문 보기 · 첨부 모두 받기(2개 이상일 때만)", () => {
  const 모양 = { primaryClass: "PRIMARY", secondaryClass: "SECONDARY" };

  it("첨부 2개 이상이면 둘 다", () => {
    const html = 글자(renderToStaticMarkup(
      <DetailActionBar url="https://example.org/notice" attachments={파일들} urlPrimary {...모양} />,
    ));
    expect(html).toContain("공고 원문 보기");
    expect(html).toContain('href="https://example.org/notice"');
    expect(html).toContain("첨부 모두 받기");
    expect(html).toContain("sticky bottom-0");
  });

  it("첨부 1개나 0개면 「첨부 모두 받기」가 없다", () => {
    expect(showsDownloadAll(파일들)).toBe(true);
    expect(showsDownloadAll(파일들.slice(0, 1))).toBe(false);
    expect(showsDownloadAll([])).toBe(false);
    for (const 첨부 of [파일들.slice(0, 1), []]) {
      const html = 글자(renderToStaticMarkup(
        <DetailActionBar url="https://example.org/notice" attachments={첨부} urlPrimary {...모양} />,
      ));
      expect(html).toContain("공고 원문 보기");
      expect(html).not.toContain("첨부 모두 받기");
    }
  });

  it("원문 주소가 없거나 주소 모양이 아니면 원문 단추가 없고, 둘 다 없으면 줄이 없다", () => {
    const 주소없음 = 글자(renderToStaticMarkup(<DetailActionBar url="" attachments={파일들} urlPrimary {...모양} />));
    expect(주소없음).not.toContain("공고 원문 보기");
    expect(주소없음).toContain("첨부 모두 받기");
    const 위험주소 = 글자(renderToStaticMarkup(
      <DetailActionBar url="javascript:alert(1)" attachments={[]} urlPrimary {...모양} />,
    ));
    expect(위험주소).toBe("");
  });

  it("주 단추 모양은 바로 신청 단추가 없을 때만 원문 단추에 준다", () => {
    const 주 = renderToStaticMarkup(<DetailActionBar url="https://x.org/n" attachments={[]} urlPrimary {...모양} />);
    expect(주).toContain('class="PRIMARY"');
    const 보조 = renderToStaticMarkup(<DetailActionBar url="https://x.org/n" attachments={[]} urlPrimary={false} {...모양} />);
    expect(보조).toContain('class="SECONDARY"');
  });

  it("「첨부 모두 받기」는 우리 통로에서 차례로 받아 저장하고, 못 받은 것은 개수로 알린다", async () => {
    const 저장 = vi.fn();
    const 답 = (init: { ok?: boolean; type?: string; ct?: string; cd?: string; redirected?: boolean }) =>
      ({
        ok: init.ok ?? true,
        type: init.type ?? "basic",
        redirected: init.redirected ?? false,
        headers: new Headers({ "content-type": init.ct ?? "application/pdf", ...(init.cd ? { "content-disposition": init.cd } : {}) }),
        blob: async () => new Blob(["x"]),
      }) as unknown as Response;
    const 차례: string[] = [];
    const fetchFn = vi.fn(async (u: RequestInfo | URL) => {
      차례.push(String(u));
      if (String(u).endsWith("/1")) return 답({ cd: "attachment; filename*=UTF-8''%EC%8B%A0%EC%B2%AD%EC%84%9C.hwp" });
      if (String(u).endsWith("/2")) return 답({ redirected: true, ct: "text/html" });
      if (String(u).endsWith("/3")) return 답({ ok: false, ct: "application/json" });
      return 답({});
    }) as unknown as typeof fetch;
    const 여덟 = Array.from({ length: 8 }, (_, i) => ({ name: `f${i}.pdf`, url: `/api/x/attachments/${i}`, kind: "pdf" as const }));
    const r = await downloadAttachmentsInOrder(여덟, { fetchFn, save: 저장 });
    expect(차례).toHaveLength(DOWNLOAD_ALL_MAX);
    expect(차례[0]).toBe("/api/x/attachments/0");
    expect(r).toEqual({ saved: 4, failed: 2, skipped: 2 });
    expect(저장.mock.calls.map((c) => c[1])).toEqual(["f0.pdf", "신청서.hwp", "f4.pdf", "f5.pdf"]);
    expect(downloadAllMessageOf(r)).toBe("4개를 받았어요 · 4개는 위 목록의 「받기」로 받아 주세요");
    expect(downloadAllMessageOf({ saved: 2, failed: 0, skipped: 0 })).toBe("2개를 받았어요");
  });

  it("파일 이름은 Content-Disposition 에서 읽고, 없으면 null", () => {
    expect(fileNameFromDisposition(`attachment; filename="a.pdf"`)).toBe("a.pdf");
    expect(fileNameFromDisposition(null)).toBeNull();
  });
});

// ── 6. DetailPanel 배선 — 다른 탭·AI 판정·돌파구·판정 피드백 detail 슬롯은 그대로 ─────────
describe("DetailPanel — 첫 탭만 바뀌고 나머지는 남아 있다", () => {
  const 패널 = 읽기("DetailPanel.tsx");

  it("새 구역 부품을 실제로 쓴다", () => {
    for (const 부품 of [
      "<SummaryCells", "<ConditionTable", "<SupportTable", "<ScheduleBlock", "<AttachmentRows", "<DetailActionBar",
    ]) {
      expect(패널, `DetailPanel 이 ${부품} 을 안 그린다`).toContain(부품);
    }
    // 대조표는 기계 대조와 AI 체크리스트를 하나로 합쳐 받는다
    expect(패널).toContain("mergeConditionRows(match.checks, verdict?.checklist)");
  });

  it("옛 「조건 체크리스트」 구역과 AI 체크리스트 목록은 없어졌다(같은 조건이 두 번 나오지 않게)", () => {
    expect(패널).not.toContain('title="조건 체크리스트"');
    expect(패널).not.toContain("verdict.checklist.map");
    expect(패널).not.toContain("match.checks.map");
  });

  it("네 탭(매칭 결과·AI 요약·공고 정보·원공고)이 그대로 있다", () => {
    for (const 탭 of [
      '{ key: "match", label: "매칭 결과" }',
      '{ key: "summary", label: "AI 요약" }',
      '{ key: "info", label: "공고 정보" }',
      '{ key: "source", label: "원공고" }',
    ]) {
      expect(패널, `탭 ${탭} 이 없다`).toContain(탭);
    }
    for (const 조건 of ['tab === "summary"', 'tab === "info"', 'tab === "source"']) expect(패널).toContain(조건);
    expect(패널).toContain("지원대상 원문"); // 공고 정보 탭
    expect(패널).toContain("준비 서류");
  });

  it("verdictFeedback detail 슬롯 · AI 정밀 판정 · 돌파구 · 강사에게 물어보기가 그대로 있다", () => {
    expect(패널).toContain('place: "detail"');
    expect(패널).toContain("verdictFeedback && (");
    expect(패널).toContain("AI 정밀 판정");
    expect(패널).toContain("{item && !noServerAi && endpoints.verdict && (");
    expect(패널).toContain("{item && !noServerAi && endpoints.breakthrough && verdict &&");
    expect(패널).toContain("<BreakthroughSection");
    expect(패널).toContain("<AskInstructorModal");
    expect(패널).toContain("saveEndpoint={endpoints.askInstructor}");
  });

  it("고정 줄은 탭 본문 밖(어느 탭에서나)에 있고, 목록과 같은 판정을 머리 이름표로 받는다", () => {
    const 본문끝 = 패널.indexOf("<DetailActionBar");
    expect(본문끝).toBeGreaterThan(패널.indexOf('tab === "source"'));
    expect(패널).toContain("fitVerdict?: VerdictTab;");
    expect(읽기("ResultDetail.tsx")).toContain("fitVerdict={item.fitVerdict}");
  });
});

// ── 7. 지킬 것 ───────────────────────────────────────────────────────────
describe("글자·색 계약", () => {
  it("WEDLY 토큰 클래스만 — raw 색 클래스와 이모지가 없다", () => {
    const html = 글자(
      renderToStaticMarkup(
        <>
          <SummaryCells cells={summaryCellsOf({ supportAmountText: "최대 3억", applyStart: 시작, applyEnd: 마감, applyPeriodText: "", now: 오늘 })} />
          <ConditionTable rows={mergeConditionRows(기계들, AI)} emptyNote="" />
          <SupportTable target="대상" benefit="내용" amountText="금액" />
          <ScheduleBlock view={scheduleOf({ applyStart: 시작, applyEnd: 마감, applyPeriodText: "", now: 오늘 })} />
          <AttachmentRows attachments={파일들} />
          <DetailActionBar url="https://example.org/n" attachments={파일들} urlPrimary primaryClass="a" secondaryClass="b" />
        </>,
      ),
    );
    expect(html).not.toMatch(RAW색);
    expect(html).not.toMatch(이모지);
    for (const 파일 of ["detail-structured.tsx", "DetailPanel.tsx"]) {
      expect(읽기(파일), `${파일} 에 raw 색 클래스`).not.toMatch(RAW색);
    }
    // 새 부품 소스에는 시안의 ₩·⏱ 같은 기호가 없다(옛 DetailPanel 주석의 「★」는 이모지 검사 대상이 아니다).
    expect(읽기("detail-structured.tsx")).not.toMatch(이모지);
  });

  it("자료실·고객이력이라는 말은 새 부품에 없다(랩 화면에도 나가는 부품이다)", () => {
    const src = 읽기("detail-structured.tsx");
    expect(src).not.toContain("자료실");
    expect(src).not.toContain("고객이력");
  });
});

describe("결과 화면 오른쪽 칸(pane) — 칸 바닥 고정 · 이중 스크롤 없음", () => {
  const 모양 = { primaryClass: "PRIMARY", secondaryClass: "SECONDARY" };

  it("pane 모드 단추 줄은 칸 바닥으로 밀려(mt-auto) 붙고, card 모드는 카드 여백(-mb-4) 기준이다", () => {
    const pane = renderToStaticMarkup(
      <DetailActionBar url="https://example.org/notice" attachments={파일들} urlPrimary edge="pane" {...모양} />,
    );
    expect(pane).toContain("sticky bottom-0");
    expect(pane).toContain("mt-auto");
    const card = renderToStaticMarkup(
      <DetailActionBar url="https://example.org/notice" attachments={파일들} urlPrimary {...모양} />,
    );
    expect(card).toContain("-mb-4");
    expect(card).not.toContain("mt-auto");
    expect(pane).not.toContain("-mb-4");
  });

  it("pane 모드에서 보일 단추가 없어도 바닥 여백은 남긴다", () => {
    const html = renderToStaticMarkup(
      <DetailActionBar url="" attachments={[]} urlPrimary={false} edge="pane" {...모양} />,
    );
    expect(html).toContain("h-4");
  });

  it("결과 화면은 pane 으로 그리고, pane 의 탭 본문은 안쪽 높이 제한이 없다(좁은 폭 이중 스크롤 회귀)", () => {
    const detail = readFileSync(new URL("./ResultDetail.tsx", import.meta.url), "utf8");
    expect(detail).toMatch(/frame="pane"/);
    const panel = readFileSync(new URL("./DetailPanel.tsx", import.meta.url), "utf8");
    expect(panel).toMatch(/frame === "pane" \? "mt-4 space-y-6" :/);
    // 기본값은 card — ERP 협업 머리(policy-track-headers)가 같은 부품을 카드로 쓴다.
    expect(panel).toMatch(/frame = "card"/);
    const list = readFileSync(new URL("./ResultOneList.tsx", import.meta.url), "utf8");
    expect(list).toMatch(/usePaneTop\(/);
    expect(list).toMatch(/--pm-top/);
  });
});
