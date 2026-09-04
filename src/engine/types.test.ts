import { describe, it, expect } from "vitest";
import {
  ALL_SOURCES_FAILED_MESSAGE,
  announcementsOrderBy,
  attachmentKindOf,
  dedupKeyOf,
  formatPolicyDate,
  ledgerLastRunAtAfterSync,
  parseApplyPeriod,
  sourceFetchOutcome,
  syncUserMessage,
} from "./types";

describe("attachmentKindOf — 확장자 형식 판별", () => {
  it("pdf·hwp·hwpx·zip 을 가리고 나머지는 etc", () => {
    expect(attachmentKindOf("공고문.pdf")).toBe("pdf");
    expect(attachmentKindOf("공고문.PDF")).toBe("pdf");
    expect(attachmentKindOf("안내.hwp")).toBe("hwp");
    expect(attachmentKindOf("안내.hwpx")).toBe("hwpx");
    expect(attachmentKindOf("묶음.zip")).toBe("zip");
    expect(attachmentKindOf("표.xlsx")).toBe("etc");
    expect(attachmentKindOf("표.xls")).toBe("etc");
  });
  it("이름이 비면 주소의 확장자를 본다", () => {
    expect(attachmentKindOf("", "https://x.test/a.hwpx?x=1")).toBe("hwpx");
  });
});

describe("attachmentKindOf — 주소 물음표 뒤에서도 확장자를 찾는다", () => {
  it("중기중앙회 download.do 는 경로엔 확장자가 없고 saveFle 값에 .pdf 가 있다", () => {
    expect(attachmentKindOf("", "https://www.kbiz.or.kr/download.do?orgalFle=ebb699&saveFle=178822886143198980.pdf&fleDwnDs=bbsAttachFile&seq=92548")).toBe("pdf");
  });
  it("물음표 뒤 값이 URL 인코딩돼 있어도 푼다", () => {
    expect(attachmentKindOf("", "https://x.test/down?f=%EA%B3%B5%EA%B3%A0%EB%AC%B8.hwpx")).toBe("hwpx");
  });
  it("경로의 확장자가 먼저다 — 물음표 뒤 .zip 이 있어도 경로가 .pdf 면 pdf", () => {
    expect(attachmentKindOf("", "https://x.test/a.pdf?next=b.zip")).toBe("pdf");
  });
  it("어디에도 확장자가 없으면 여전히 etc", () => {
    expect(attachmentKindOf("", "https://ccei.creativekorea.or.kr/json/common/fileDown.download?uuid=2026082415")).toBe("etc");
  });
});

describe("dedupKeyOf — 출처 간 같은 공고 묶기", () => {
  it("공백·괄호·기호 차이를 무시한다", () => {
    expect(dedupKeyOf({ title: "2026년 창업도약패키지 (예비)", agency: "중소벤처기업부" }))
      .toBe(dedupKeyOf({ title: "2026년 창업도약패키지(예비)", agency: "중소벤처기업부" }));
  });
  it("기관이 다르면 다른 키", () => {
    expect(dedupKeyOf({ title: "같은 제목", agency: "A" }))
      .not.toBe(dedupKeyOf({ title: "같은 제목", agency: "B" }));
  });
});

describe("parseApplyPeriod — 신청기간 원문 → 한국시간 하루", () => {
  it("시작은 KST 00:00(UTC 전날 15:00), 끝은 KST 23:59:59(UTC 14:59:59)", () => {
    const r = parseApplyPeriod("20260801 ~ 20260930");
    expect(r.start?.toISOString()).toBe("2026-07-31T15:00:00.000Z");
    expect(r.end?.toISOString()).toBe("2026-09-30T14:59:59.000Z");
  });
  it("YYYY-MM-DD ~ YYYY-MM-DD 도 같은 KST 하루 끝", () => {
    const r = parseApplyPeriod("2026-08-01 ~ 2026-09-30");
    expect(r.start?.toISOString()).toBe("2026-07-31T15:00:00.000Z");
    expect(r.end?.toISOString()).toBe("2026-09-30T14:59:59.000Z");
  });
  it("상시·예산소진은 날짜 없음(원문 보존은 호출자 몫)", () => {
    expect(parseApplyPeriod("예산 소진시까지")).toEqual({ start: null, end: null });
  });
  it("존재하지 않는 날짜는 자동 보정하지 않고 null", () => {
    const r = parseApplyPeriod("2026-02-31 ~ 2026-09-30");
    expect(r.start).toBeNull();
    expect(r.end?.toISOString()).toBe("2026-09-30T14:59:59.000Z");
  });
  it("끝 날짜가 없으면 시작만 두고 끝은 null", () => {
    const r = parseApplyPeriod("2026-08-01 ~ 2026-02-31");
    expect(r.start?.toISOString()).toBe("2026-07-31T15:00:00.000Z");
    expect(r.end).toBeNull();
  });
  it("양쪽이 달력에 없으면 둘 다 null", () => {
    expect(parseApplyPeriod("2026-02-31 ~ 2026-04-31")).toEqual({ start: null, end: null });
  });
  it("윤년 2월 29일은 허용하고 평년은 null", () => {
    const leap = parseApplyPeriod("2024-02-29 ~ 2024-02-29");
    expect(leap.start?.toISOString()).toBe("2024-02-28T15:00:00.000Z");
    expect(leap.end?.toISOString()).toBe("2024-02-29T14:59:59.000Z");
    expect(parseApplyPeriod("2026-02-29 ~ 2026-02-29")).toEqual({ start: null, end: null });
  });
  it("화면용 날짜는 UTC가 아니라 한국 달력", () => {
    const r = parseApplyPeriod("2026-08-01 ~ 2026-09-30");
    expect(formatPolicyDate(r.start)).toBe("2026.08.01");
    expect(formatPolicyDate(r.end)).toBe("2026.09.30");
  });
});

describe("announcementsOrderBy — 정렬 분기", () => {
  it("모집중은 마감 임박순", () => {
    expect(announcementsOrderBy("open")).toEqual([
      { applyEnd: { sort: "asc", nulls: "last" } },
      { lastSeenAt: "desc" },
    ]);
  });
  it("마감·전체는 최근 수집순", () => {
    expect(announcementsOrderBy("closed")).toEqual([{ lastSeenAt: "desc" }]);
    expect(announcementsOrderBy("all")).toEqual([{ lastSeenAt: "desc" }]);
  });
});

describe("sourceFetchOutcome — 출처 실패 판정", () => {
  it("전부 실패", () => {
    expect(sourceFetchOutcome([{ error: "timeout" }])).toBe("all-failed");
  });
  it("일부 실패", () => {
    expect(sourceFetchOutcome([{ error: "down" }, { error: undefined }])).toBe("partial");
  });
  it("전부 성공", () => {
    expect(sourceFetchOutcome([{}])).toBe("ok");
  });
  it("출처 목록이 비면 전부 실패로 본다", () => {
    expect(sourceFetchOutcome([])).toBe("all-failed");
  });
});

describe("장부 되돌림 · 알림 문구", () => {
  const nowIso = "2026-08-22T03:00:00.000Z";
  it("모든 출처 실패면 이전 실행 시각을 유지한다", () => {
    expect(ledgerLastRunAtAfterSync("2026-08-01T00:00:00.000Z", [{ error: "x" }], nowIso))
      .toBe("2026-08-01T00:00:00.000Z");
  });
  it("이전 값이 없고 전부 실패면 빈 시각(다음 틱에 재시도)", () => {
    expect(ledgerLastRunAtAfterSync(undefined, [{ error: "x" }], nowIso)).toBe("");
  });
  it("일부·전부 성공이면 이번 시각을 기록한다", () => {
    expect(ledgerLastRunAtAfterSync("old", [{}], nowIso)).toBe(nowIso);
    expect(ledgerLastRunAtAfterSync("old", [{ error: "x" }, {}], nowIso)).toBe(nowIso);
  });
  it("알림 문구", () => {
    expect(syncUserMessage([{ error: "x" }])).toBe(ALL_SOURCES_FAILED_MESSAGE);
    expect(syncUserMessage([{ error: "x" }, {}])).toBe("새로 받아왔습니다 — 일부 출처 실패");
    expect(syncUserMessage([{}])).toBe("새로 받아왔습니다");
  });
});
