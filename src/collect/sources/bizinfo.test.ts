import { afterEach, describe, expect, it, vi } from "vitest";
import sample from "./__fixtures__/bizinfo-sample.json";
import { safeAttachmentUrl } from "../attachment-text";
import {
  extractBizinfoItems,
  fetchBizinfoAll,
  keepIdentifiable,
  normalizeBizinfoItem,
} from "./bizinfo";

describe("기업마당 어댑터", () => {
  it("실응답 표본에서 공고 목록을 꺼낸다", () => {
    const items = extractBizinfoItems(sample);
    expect(items.length).toBeGreaterThan(0);
  });
  it("한 건을 공통 모양으로 바꾼다 — 지원대상 원문이 비지 않는다", () => {
    const a = normalizeBizinfoItem(extractBizinfoItems(sample)[0]);
    expect(a.source).toBe("bizinfo");
    expect(a.sourceId).not.toBe("");
    expect(a.title).not.toBe("");
    expect(a.targetText).not.toBe(""); // ★자격조건 원문 확보가 이 어댑터의 존재 이유
    expect(a.url).toMatch(/^https?:\/\//);
  });
  it("HTML 엔티티를 실문자로 바꾼다", () => {
    const a = normalizeBizinfoItem({
      pblancId: "P1",
      pblancNm: "A &amp; B &lt;C&gt; &quot;D&#39;s&quot;&nbsp;E",
      pblancUrl: "https://example.test/a",
      bsnsSumryCn: "<p>R&amp;D</p>",
      trgetNm: "foo",
    });
    expect(a.title).toBe("A & B <C> \"D's\" E");
    expect(a.summary).toBe("R&D");
    expect(a.targetText).toBe("foo");
    const withTarget = normalizeBizinfoItem({
      pblancId: "P2",
      pblancUrl: "https://example.test/b",
      trgetNm: "A&amp;B&nbsp;&lt;C&gt;",
    });
    expect(withTarget.targetText).toBe("A&B <C>");
  });
  it("표본 사업개요의 &nbsp;·&amp; 도 해제된다", () => {
    const a = normalizeBizinfoItem(extractBizinfoItems(sample)[0]);
    expect(a.summary).toContain("R&D");
    expect(a.summary).not.toContain("&amp;");
    expect(a.summary).not.toContain("&nbsp;");
  });
  it("표본 첨부는 원본 파일명·fileDown 절대주소·형식이다", () => {
    const a = normalizeBizinfoItem(extractBizinfoItems(sample)[0]);
    expect(a.attachments).toEqual([
      {
        name: "공고 2026년 예비오션스타 모집 공고문.hwp",
        url: "https://www.bizinfo.go.kr/cmm/fms/fileDown.do?atchFileId=FILE_000000000770191&fileSn=0",
        kind: "hwp",
      },
    ]);
  });
  it("print 와 일반 첨부를 합치고 getImageFile 도 fileDown 으로 바꾼다", () => {
    const a = normalizeBizinfoItem(extractBizinfoItems(sample)[1]);
    expect(a.attachments.map((x) => x.name)).toEqual(["공고문.pdf", "신청서류 및 매뉴얼.hwp"]);
    expect(a.attachments.map((x) => x.kind)).toEqual(["pdf", "hwp"]);
    expect(a.attachments.every((x) => x.url.includes("fileDown.do"))).toBe(true);
    expect(a.attachments.every((x) => x.url.startsWith("https://www.bizinfo.go.kr"))).toBe(true);
  });
  it("남의 서버 절대주소는 기업마당 주소로 둔갑시키지 않고 그대로 남긴다 — 막는 것은 내려받기 관문", () => {
    const a = normalizeBizinfoItem({
      pblancId: "P9",
      pblancUrl: "https://www.bizinfo.go.kr/1",
      flpthNm: "https://evil.example.com/a.pdf@/cmm/fms/fileDown.do?atchFileId=FILE_C&fileSn=0",
      fileNm: "가짜.pdf@진짜.pdf",
    });
    expect(a.attachments.map((x) => x.url)).toEqual([
      "https://evil.example.com/a.pdf",
      "https://www.bizinfo.go.kr/cmm/fms/fileDown.do?atchFileId=FILE_C&fileSn=0",
    ]);
    // 원문은 그대로 보존하고(설계 §3-1), 실제로 부를지는 내려받기 관문이 정한다.
    expect(safeAttachmentUrl(a.attachments[0].url)).toBeNull();
    expect(safeAttachmentUrl(a.attachments[1].url)).toBe(a.attachments[1].url);
  });

  it("@ 로 이어진 첨부를 이름·주소 짝으로 나눈다", () => {
    const a = normalizeBizinfoItem({
      pblancId: "P1",
      pblancUrl: "https://x.test/1",
      printFlpthNm: "https://www.bizinfo.go.kr/cmm/fms/getImageFile.do?atchFileId=FILE_A&fileSn=0",
      printFileNm: "공고문.pdf",
      flpthNm: "/cmm/fms/fileDown.do?atchFileId=FILE_B&fileSn=0@/cmm/fms/fileDown.do?atchFileId=FILE_B&fileSn=1",
      fileNm: "신청.hwp@포스터.zip",
    });
    expect(a.attachments).toEqual([
      {
        name: "공고문.pdf",
        url: "https://www.bizinfo.go.kr/cmm/fms/fileDown.do?atchFileId=FILE_A&fileSn=0",
        kind: "pdf",
      },
      {
        name: "신청.hwp",
        url: "https://www.bizinfo.go.kr/cmm/fms/fileDown.do?atchFileId=FILE_B&fileSn=0",
        kind: "hwp",
      },
      {
        name: "포스터.zip",
        url: "https://www.bizinfo.go.kr/cmm/fms/fileDown.do?atchFileId=FILE_B&fileSn=1",
        kind: "zip",
      },
    ]);
  });
  it("파일명이 없으면 주소의 마지막 조각을 이름으로 쓴다", () => {
    const a = normalizeBizinfoItem({
      pblancId: "P1",
      pblancUrl: "https://x.test/1",
      printFlpthNm: "https://www.bizinfo.go.kr/cmm/fms/getImageFile.do?atchFileId=FILE_A&fileSn=0",
    });
    expect(a.attachments).toHaveLength(1);
    expect(a.attachments[0].name).toBe("fileDown.do");
    expect(a.attachments[0].url).toContain("fileDown.do");
    expect(a.attachments[0].kind).toBe("etc");
  });
  it("같은 주소가 print 와 일반에 겹치면 한 번만 남긴다", () => {
    const url = "https://www.bizinfo.go.kr/cmm/fms/fileDown.do?atchFileId=FILE_A&fileSn=0";
    const a = normalizeBizinfoItem({
      pblancId: "P1",
      pblancUrl: "https://x.test/1",
      printFlpthNm: url,
      printFileNm: "공고문.pdf",
      flpthNm: url,
      fileNm: "공고문.pdf",
    });
    expect(a.attachments).toHaveLength(1);
    expect(a.attachments[0].name).toBe("공고문.pdf");
  });
  it("공고번호·링크가 둘 다 빈 항목은 거르고 수를 남긴다", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const kept = keepIdentifiable([
      normalizeBizinfoItem({ pblancId: "P1", pblancUrl: "https://x.test/1" }),
      normalizeBizinfoItem({ pblancNm: "빈 것" }),
      normalizeBizinfoItem({ pblancId: "  ", pblancUrl: "" }),
    ]);
    expect(kept).toHaveLength(1);
    expect(kept[0].sourceId).toBe("P1");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("2건"));
    warn.mockRestore();
  });
  it("링크만 있으면 공고번호 대신 링크로 남긴다", () => {
    const kept = keepIdentifiable([
      normalizeBizinfoItem({ pblancUrl: "https://x.test/only" }),
    ]);
    expect(kept).toHaveLength(1);
    expect(kept[0].sourceId).toBe("https://x.test/only");
  });
  it("존재하지 않는 날짜는 날짜만 비우고 원문 기간은 남긴다", () => {
    const a = normalizeBizinfoItem({
      pblancId: "P1",
      reqstBeginEndDe: "2026-02-31 ~ 2026-09-30",
      pblancUrl: "https://x.test/1",
    });
    expect(a.applyStart).toBeNull();
    expect(a.applyEnd?.toISOString()).toBe("2026-09-30T14:59:59.000Z");
    expect(a.applyPeriodText).toBe("2026-02-31 ~ 2026-09-30");
  });
});

describe("기업마당 호출", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("수집 결과에서 공고번호·링크 둘 다 빈 항목을 빼고 한 번에 수를 남긴다", async () => {
    vi.stubEnv("BIZINFO_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        jsonArray: [
          { pblancNm: "빈 것" },
          { pblancId: "P1", pblancUrl: "https://x.test/1" },
        ],
      }),
      text: async () => "",
    }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const list = await fetchBizinfoAll();
    expect(list).toHaveLength(1);
    expect(list[0].sourceId).toBe("P1");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("1건"));
  });

  it("외부 호출에 30초 제한을 건다", async () => {
    vi.stubEnv("BIZINFO_API_KEY", "test-key");
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ jsonArray: [] }),
      text: async () => "",
    });
    vi.stubGlobal("fetch", fetchMock);
    await fetchBizinfoAll();
    expect(timeout).toHaveBeenCalledWith(30_000);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("bizinfoApi.do"),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });
});
