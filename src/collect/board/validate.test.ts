import { describe, it, expect } from "vitest";
import { DATE_RE, validateRows } from "./validate";
import type { BoardRow } from "./types";

const good: BoardRow[] = Array.from({ length: 12 }, (_, i) => ({
  title: `2026년 지원사업 공고 ${i}`, detailUrl: `https://a.kr/v?id=${i}`, dateText: "2026-08-01",
}));

describe("validateRows", () => {
  it("정상 목록은 통과", () => {
    expect(validateRows(good, { expectMinRows: 5, prevCount: 12 }).ok).toBe(true);
  });
  it("allowUndated 를 켜면 날짜 없는 행뿐인 쪽도 통과 — 중소벤처24 「예산 소진시까지」 997건(2026-09-03)", () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({ title: `상시 접수 공고 ${i}`, detailUrl: `https://a.test/view/${i}`, dateText: "" }));
    expect(validateRows(rows as never, { prevCount: 0 }).ok).toBe(false);
    expect(validateRows(rows as never, { prevCount: 0, allowUndated: true }).ok).toBe(true);
  });

  it("행 0개는 실패(표식 소실)", () => {
    expect(validateRows([], { expectMinRows: 5, prevCount: 12 }).ok).toBe(false);
  });
  it("직전 대비 절반 미만이면 실패(급락)", () => {
    expect(validateRows(good.slice(0, 4), { expectMinRows: 1, prevCount: 12 }).ok).toBe(false);
  });
  it("제목이 머리글(공지·목록·검색)뿐이면 실패", () => {
    const junk = good.map((r) => ({ ...r, title: "공지사항" }));
    expect(validateRows(junk, { expectMinRows: 5, prevCount: 12 }).ok).toBe(false);
  });
  it("링크가 상세 주소 모양이 아니면 실패", () => {
    const noLink = good.map((r) => ({ ...r, detailUrl: "" }));
    expect(validateRows(noLink, { expectMinRows: 5, prevCount: 12 }).ok).toBe(false);
  });
  it("날짜가 하나도 실제 날짜가 아니면 실패", () => {
    const noDate = good.map((r) => ({ ...r, dateText: "번호" }));
    expect(validateRows(noDate, { expectMinRows: 5, prevCount: 12 }).ok).toBe(false);
  });
  it("첫 수집(prevCount 0)은 급락 검사를 건너뛴다", () => {
    expect(validateRows(good, { expectMinRows: 5, prevCount: 0 }).ok).toBe(true);
  });
  it("비어있지 않은 상세주소 고유값 비율이 절반 미만이면 실패(퇴화)", () => {
    const same = good.map((r) => ({ ...r, detailUrl: "https://a.kr/#gonggoView" }));
    expect(validateRows(same, { expectMinRows: 5, prevCount: 12 }).ok).toBe(false);
  });
  it("제목 60% 관문은 올림이라 정확히 절반 머리글은 실패", () => {
    const rows: BoardRow[] = [
      { title: "2026년 지원사업 공고 하나", detailUrl: "https://a.kr/v?id=1", dateText: "2026-08-01" },
      { title: "2026년 지원사업 공고 둘", detailUrl: "https://a.kr/v?id=2", dateText: "2026-08-01" },
      { title: "공지사항", detailUrl: "https://a.kr/v?id=3", dateText: "2026-08-01" },
      { title: "공지사항", detailUrl: "https://a.kr/v?id=4", dateText: "2026-08-01" },
    ];
    expect(validateRows(rows, { expectMinRows: 1, prevCount: 0 }).ok).toBe(false);
  });
  it("상세주소 고유값 비율이 정확히 절반이면 통과(경계)", () => {
    const rows: BoardRow[] = Array.from({ length: 4 }, (_, i) => ({
      title: `2026년 지원사업 공고 ${i}`,
      detailUrl: `https://a.kr/v?id=${i % 2}`,
      dateText: "2026-08-01",
    }));
    expect(validateRows(rows, { expectMinRows: 1, prevCount: 0 }).ok).toBe(true);
  });
  it("달력 밖 날짜(2026-99-99)는 날짜로 치지 않는다", () => {
    const rows = good.map((r) => ({ ...r, dateText: "2026-99-99" }));
    expect(validateRows(rows, { expectMinRows: 5, prevCount: 0 }).ok).toBe(false);
  });
  it("DATE_RE 는 2026/08/14 전체를 매치하고 일을 1로 자르지 않는다", () => {
    expect("2026/08/14".match(DATE_RE)?.[0]).toBe("2026/08/14");
  });
  it("DATE_RE 는 달력 밖 2026-99-99 를 거부한다", () => {
    expect(DATE_RE.test("2026-99-99")).toBe(false);
  });
  it("DATE_RE 는 한 자리 월 2026.5.22 를 매치한다", () => {
    expect("2026.5.22".match(DATE_RE)?.[0]).toBe("2026.5.22");
  });
  it("날짜 있는 행이 30% 올림 미만이면 실패", () => {
    const rows: BoardRow[] = Array.from({ length: 10 }, (_, i) => ({
      title: `2026년 지원사업 공고 ${i}`,
      detailUrl: `https://a.kr/v?id=${i}`,
      dateText: i < 2 ? "2026-08-01" : "번호",
    }));
    expect(validateRows(rows, { expectMinRows: 1, prevCount: 0 }).ok).toBe(false);
    const enough = rows.map((r, i) => ({ ...r, dateText: i < 3 ? "2026-08-01" : "번호" }));
    expect(validateRows(enough, { expectMinRows: 1, prevCount: 0 }).ok).toBe(true);
  });
});
