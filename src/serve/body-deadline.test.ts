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

/**
 * ★연도 없는 날짜는 글을 올린 날의 해로 읽는다(NO.585 후속, 2026-11-10 운영 실측). 지금 해로 읽으면
 * 2013-07-15 에 올라온 이노비즈 「HIT500 … 오는 7월 31일까지 모집」이 2027-07-31 마감이 되어 「지원 가능」에 남았다.
 */
describe("extractDeadlineFromText — postedAt(게시일) 기준 연도", () => {
  const LATE = new Date("2026-11-10T00:00:00.000Z");

  it("2013년 글의 「7월 31일까지」는 2013-07-31 — 지금 기준 2년보다 오래돼 null", () => {
    const posted = new Date("2013-07-14T15:00:00.000Z");
    expect(extractDeadlineFromText("3차 참여기업을 오는 7월 31일까지 모집한다", LATE, { postedAt: posted })).toBeNull();
  });

  it("작년 12월 글의 「1월 15일까지」는 올해 1월 15일(지난 마감)", () => {
    const posted = new Date("2025-12-19T15:00:00.000Z");
    const r = extractDeadlineFromText("신청마감 1월 15일까지", LATE, { postedAt: posted });
    expect(iso(r?.applyEnd)).toBe("2026-01-15T14:59:59.000Z");
  });

  it("올해 2월 글의 「1월 31일까지」는 내년으로 넘기지 않는다", () => {
    const posted = new Date("2026-02-09T15:00:00.000Z");
    const r = extractDeadlineFromText("접수마감 1월 31일까지", LATE, { postedAt: posted });
    expect(iso(r?.applyEnd)).toBe("2026-01-31T14:59:59.000Z");
  });

  it("접수기간 연도 생략 창도 게시일의 해 — 끝이 시작보다 앞이면 그다음 해", () => {
    const posted = new Date("2024-11-20T15:00:00.000Z");
    const r = extractDeadlineFromText("접수기간: 12.1 ~ 1.15", LATE, { postedAt: posted });
    expect(iso(r?.applyStart)).toBe("2024-11-30T15:00:00.000Z");
    expect(iso(r?.applyEnd)).toBe("2025-01-15T14:59:59.000Z");
  });

  it("열린 기간의 연도 생략 시작일도 게시일의 해", () => {
    const posted = new Date("2025-03-01T15:00:00.000Z");
    const r = extractDeadlineFromText("접수기간: 3.2 ~ 예산 소진 시까지", LATE, { postedAt: posted });
    expect(iso(r?.applyStart)).toBe("2025-03-01T15:00:00.000Z");
    expect(r?.applyEnd).toBeNull();
  });

  it("연도가 적힌 날짜는 게시일과 무관하게 그대로", () => {
    const posted = new Date("2013-07-14T15:00:00.000Z");
    const r = extractDeadlineFromText("마감 2026.12.31", LATE, { postedAt: posted });
    expect(iso(r?.applyEnd)).toBe("2026-12-31T14:59:59.000Z");
  });

  it("postedAt 이 없거나 잘못된 날짜면 지금처럼 now 기준 — 12월에 읽은 「1월 15일」은 다음 해", () => {
    const dec = new Date("2026-12-10T00:00:00.000Z");
    expect(iso(extractDeadlineFromText("신청마감 1월 15일", dec)?.applyEnd)).toBe("2027-01-15T14:59:59.000Z");
    expect(iso(extractDeadlineFromText("신청마감 1월 15일", dec, { postedAt: null })?.applyEnd)).toBe("2027-01-15T14:59:59.000Z");
    expect(iso(extractDeadlineFromText("신청마감 1월 15일", dec, { postedAt: new Date("x") })?.applyEnd)).toBe(
      "2027-01-15T14:59:59.000Z",
    );
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
