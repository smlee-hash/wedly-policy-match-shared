import { describe, expect, it } from "vitest";
import { extractDeadlineFromText } from "./body-deadline";

const NOW = new Date("2026-09-03T00:00:00.000Z");

function iso(d: Date | null | undefined) {
  return d?.toISOString() ?? null;
}

describe("extractDeadlineFromText — 표기별 접수기간·마감", () => {
  it("2026.09.30 점 구분 시작~끝", () => {
    const r = extractDeadlineFromText("접수기간: 2026.09.01 ~ 2026.09.30", NOW);
    expect(iso(r?.applyStart)).toBe("2026-08-31T15:00:00.000Z");
    expect(iso(r?.applyEnd)).toBe("2026-09-30T14:59:59.000Z");
    expect(r?.evidence.length).toBeLessThanOrEqual(80);
    expect(r?.evidence).toContain("접수기간");
  });

  /**
   * ★수원도시재단 상세의 접수기간 라벨(2026-09-06 실측). 이 출처는 **목록에 날짜 칸이 없어**
   * 이 줄이 유일한 마감 근거다 — 라벨을 모르면 마감이 영영 안 서고 공고가 계속 「모집중」이 된다.
   */
  it("공고일정 : 2026.08.27 9시 ~ 2026.09.17 18시 (수원도시재단)", () => {
    const r = extractDeadlineFromText("공고일정 : 2026.08.27 9시 ~ 2026.09.17 18시", NOW);
    expect(iso(r?.applyStart)).toBe("2026-08-26T15:00:00.000Z");
    expect(iso(r?.applyEnd)).toBe("2026-09-17T14:59:59.000Z");
    expect(r?.evidence).toContain("공고일정");
  });

  it("2026-09-30 하이픈 구분", () => {
    const r = extractDeadlineFromText("신청기간 2026-09-01 ~ 2026-09-30", NOW);
    expect(iso(r?.applyStart)).toBe("2026-08-31T15:00:00.000Z");
    expect(iso(r?.applyEnd)).toBe("2026-09-30T14:59:59.000Z");
  });

  it("2026/09/30 빗금 구분", () => {
    const r = extractDeadlineFromText("모집기간: 2026/09/01 ~ 2026/09/30", NOW);
    expect(iso(r?.applyStart)).toBe("2026-08-31T15:00:00.000Z");
    expect(iso(r?.applyEnd)).toBe("2026-09-30T14:59:59.000Z");
  });

  it("2026년 9월 30일 한글 표기", () => {
    const r = extractDeadlineFromText("공모기간: 2026년 9월 1일 ~ 2026년 9월 30일", NOW);
    expect(iso(r?.applyStart)).toBe("2026-08-31T15:00:00.000Z");
    expect(iso(r?.applyEnd)).toBe("2026-09-30T14:59:59.000Z");
  });

  it("26.9.30 두 자리 연도 · ~ 끝만", () => {
    const r = extractDeadlineFromText("접수 기간: ~26.9.30", NOW);
    expect(r?.applyStart).toBeNull();
    expect(iso(r?.applyEnd)).toBe("2026-09-30T14:59:59.000Z");
  });

  it("9.30 연도 생략 — now 의 연도", () => {
    const r = extractDeadlineFromText("신청 기간 ~9.30", NOW);
    expect(r?.applyStart).toBeNull();
    expect(iso(r?.applyEnd)).toBe("2026-09-30T14:59:59.000Z");
  });

  it("9월 30일(화) 요일 꼬리", () => {
    const r = extractDeadlineFromText("마감 9월 30일(화)", NOW);
    expect(r?.applyStart).toBeNull();
    expect(iso(r?.applyEnd)).toBe("2026-09-30T14:59:59.000Z");
  });

  it("18:00 시각 꼬리는 무시하고 그날 KST 23:59:59", () => {
    const r = extractDeadlineFromText("신청마감 2026.09.30 18:00까지", NOW);
    expect(iso(r?.applyEnd)).toBe("2026-09-30T14:59:59.000Z");
  });

  it("연도 생략 끝일이 시작보다 앞이면 다음 해", () => {
    const r = extractDeadlineFromText("신청·접수기간: 2026.12.01 ~ 1.15", NOW);
    expect(iso(r?.applyStart)).toBe("2026-11-30T15:00:00.000Z");
    expect(iso(r?.applyEnd)).toBe("2027-01-15T14:59:59.000Z");
  });

  it("예산 소진 시까지는 끝 없음 · evidence 는 남긴다", () => {
    const r = extractDeadlineFromText("접수기간: 2026.09.01 ~ 예산 소진 시까지", NOW);
    expect(iso(r?.applyStart)).toBe("2026-08-31T15:00:00.000Z");
    expect(r?.applyEnd).toBeNull();
    expect(r?.evidence).toContain("예산 소진");
  });

  it("상시·선착순은 끝 없음 · evidence 는 남긴다", () => {
    const always = extractDeadlineFromText("접수기간: 상시", NOW);
    expect(always?.applyEnd).toBeNull();
    expect(always?.evidence).toContain("상시");
    const fifo = extractDeadlineFromText("선착순 마감", NOW);
    expect(fifo?.applyEnd).toBeNull();
    expect(fifo?.evidence).toMatch(/선착순|마감/);
  });
});

describe("extractDeadlineFromText — 무효는 null", () => {
  it("시작이 끝보다 뒤면 null", () => {
    expect(extractDeadlineFromText("접수기간: 2026.10.01 ~ 2026.09.01", NOW)).toBeNull();
  });

  it("끝이 now 보다 3년 넘게 미래면 null", () => {
    expect(extractDeadlineFromText("마감 2031.09.30", NOW)).toBeNull();
  });

  it("끝이 now 보다 2년 넘게 과거면 null", () => {
    expect(extractDeadlineFromText("기한 2023.09.01", NOW)).toBeNull();
  });

  it("기간·마감 낱말이 없으면 null", () => {
    expect(extractDeadlineFromText("지원대상은 중소기업이며 예산은 10억원입니다.", NOW)).toBeNull();
  });
});
