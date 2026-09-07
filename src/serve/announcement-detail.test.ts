import { describe, expect, it, vi } from "vitest";
import {
  ANNOUNCEMENT_DETAIL_SELECT,
  defaultAttachmentHref,
  hasStoredSummary,
  readAnnouncementDetail,
  readAttachments,
  toAnnouncementDetail,
  type AnnouncementDetailRow,
} from "./announcement-detail";

describe("readAttachments — 저장된 첨부 목록 읽기(순수 파서)", () => {
  it("배열이 아니면 빈 목록", () => {
    expect(readAttachments(null, "a1")).toEqual([]);
    expect(readAttachments({ url: "x" }, "a1")).toEqual([]);
  });

  it("주소가 없거나 모양이 깨진 항목은 건너뛴다", () => {
    const out = readAttachments(["글자", null, { name: "x" }, { url: "   " }, { url: "https://a.kr/b.pdf" }], "a1");
    expect(out).toEqual([{ name: "첨부파일", url: "https://a.kr/b.pdf", kind: "pdf" }]);
  });

  it("이름이 비면 「첨부파일」, 저장된 kind 가 알려진 값이면 그대로 쓴다", () => {
    const out = readAttachments([{ url: "https://a.kr/x", name: "  공고문  ", kind: " HWP " }], "a1");
    expect(out[0]).toEqual({ name: "공고문", url: "https://a.kr/x", kind: "hwp" });
  });

  it("모르는 kind 는 이름·주소로 다시 판정한다", () => {
    const out = readAttachments([{ url: "https://a.kr/x.pdf", name: "붙임.pdf", kind: "이상한값" }], "a1");
    expect(out[0].kind).toBe("pdf");
  });

  it("★POST 첨부만 대리 통로 주소로 바꾼다 — 자리번호는 저장 배열 그대로다", () => {
    const out = readAttachments(
      [{ url: "https://a.kr/get.pdf" }, "깨진 항목", { url: "https://a.kr/down", method: "post", name: "공고문.hwp" }],
      "ann 1",
    );
    // 「깨진 항목」이 빠져도 POST 첨부의 자리번호는 2 그대로 — 밀리면 다른 파일이 내려간다.
    expect(out[1].url).toBe("/api/policy-match/announcements/ann%201/attachments/2");
    expect(out[0].url).toBe("https://a.kr/get.pdf");
  });

  it("공고 id 가 비면 POST 라도 원 주소를 쓴다", () => {
    const out = readAttachments([{ url: "https://a.kr/down", method: "POST" }], "");
    expect(out[0].url).toBe("https://a.kr/down");
  });

  it("주소 만들기를 앱이 바꿔 끼울 수 있다 — 기본은 ERP 와 같은 경로", () => {
    expect(defaultAttachmentHref("a1", 3)).toBe("/api/policy-match/announcements/a1/attachments/3");
    const out = readAttachments([{ url: "https://a.kr/down", method: "POST" }], "a1", (id, i) => `/lab/${id}/${i}`);
    expect(out[0].url).toBe("/lab/a1/0");
  });
});

describe("hasStoredSummary", () => {
  it("done·needs_review 면 읽어 둔 요약이 있다(판본은 안 본다)", () => {
    expect(hasStoredSummary({ structureStatus: "done" })).toBe(true);
    expect(hasStoredSummary({ structureStatus: "needs_review" })).toBe(true);
    expect(hasStoredSummary({ structureStatus: "pending" })).toBe(false);
    expect(hasStoredSummary({ structureStatus: "failed" })).toBe(false);
  });
});

function row(over: Partial<AnnouncementDetailRow> = {}): AnnouncementDetailRow {
  return {
    id: "a1", source: "bizinfo", title: "공고", agency: "중기부", category: "금융", region: "서울",
    summary: "개요", targetText: "대상", applyStart: new Date("2026-08-01T00:00:00Z"),
    applyEnd: new Date("2026-09-30T00:00:00Z"), applyPeriodText: "8/1~9/30",
    url: "https://a.kr/1", status: "open", attachments: [], raw: null,
    structure: null, structureStatus: "done", structuredAt: new Date("2026-09-01T00:00:00Z"),
    structureVersion: 3,
    ...over,
  };
}

describe("toAnnouncementDetail — 응답 모양", () => {
  it("날짜는 ISO 글자로, structure 는 없으면 null", () => {
    const d = toAnnouncementDetail(row());
    expect(d.applyStart).toBe("2026-08-01T00:00:00.000Z");
    expect(d.applyEnd).toBe("2026-09-30T00:00:00.000Z");
    expect(d.structuredAt).toBe("2026-09-01T00:00:00.000Z");
    expect(d.structure).toBeNull();
  });

  it("날짜 칸이 비면 null 그대로", () => {
    const d = toAnnouncementDetail(row({ applyStart: null, applyEnd: null, structuredAt: null }));
    expect([d.applyStart, d.applyEnd, d.structuredAt]).toEqual([null, null, null]);
  });

  it("★응답에 structureVersion·raw 를 싣지 않는다 — 원문 응답 칸 그대로", () => {
    const keys = Object.keys(toAnnouncementDetail(row())).sort();
    expect(keys).toEqual([
      "agency", "applyEnd", "applyMethod", "applyPeriodText", "applyStart", "attachments",
      "category", "contact", "id", "receiptSiteUrl", "region", "source", "status",
      "structure", "structureStatus", "structuredAt", "summary", "targetText", "title", "url",
    ]);
  });

  it("원 응답에서 신청방법·문의처·접수사이트를 뽑고 HTML 태그·문자표는 글자로 푼다", () => {
    const d = toAnnouncementDetail(row({
      raw: { reqstMthPapersCn: "<p>온라인&nbsp;신청</p>", refrncNm: "1234", rceptEngnHmpgUrl: "https://x.kr" },
    }));
    expect(d.applyMethod).toBe("온라인 신청");
    expect(d.contact).toBe("1234");
    expect(d.receiptSiteUrl).toBe("https://x.kr");
  });

  it("한 겹 안쪽까지만 찾는다 — 더 깊으면 못 찾아도 지어내지 않는다", () => {
    expect(toAnnouncementDetail(row({ raw: { item: { refrncNm: "안쪽" } } })).contact).toBe("안쪽");
    expect(toAnnouncementDetail(row({ raw: { a: { b: { refrncNm: "더 안쪽" } } } })).contact).toBe("");
  });

  it("접수사이트는 후보를 순서대로 본다 — 기업마당 먼저, 없으면 고용24", () => {
    expect(toAnnouncementDetail(row({ raw: { applyUrl: "https://work.kr" } })).receiptSiteUrl).toBe("https://work.kr");
  });
});

describe("readAnnouncementDetail — 한 번에 읽기", () => {
  const q = (r: unknown) => ({ findAnnouncement: vi.fn(async () => r) }) as never;

  it("id 가 비면 조회도 안 하고 not_found", async () => {
    const spy = vi.fn();
    const res = await readAnnouncementDetail({ findAnnouncement: spy } as never, "   ");
    expect(res.status).toBe("not_found");
    expect(spy).not.toHaveBeenCalled();
  });

  it("행이 없으면 not_found", async () => {
    expect((await readAnnouncementDetail(q(null), "a1")).status).toBe("not_found");
  });

  it("행이 있으면 상세 칸으로 — 읽는 칸은 상수 그대로", async () => {
    const findAnnouncement = vi.fn(async () => row());
    const res = await readAnnouncementDetail({ findAnnouncement } as never, " a1 ");
    expect(res.status).toBe("ok");
    if (res.status !== "ok") return;
    expect(res.data.id).toBe("a1");
    expect(findAnnouncement.mock.calls[0]).toEqual(["a1", ANNOUNCEMENT_DETAIL_SELECT]);
  });
});
