import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { announcementsFromMsitXml, fetchMsitAll } from "./msit";

const xmlOf = (name: string) =>
  readFileSync(join(__dirname, "__fixtures__/datago", name), "utf8").replace(/^HTTP \d+\r?\n/, "");

const sampleXml = xmlOf("msit-anno.sample.txt");
const NOW = new Date("2026-08-26T00:00:00.000Z");

const FIRST_URL =
  "https://www.msit.go.kr/bbs/view.do?sCode=user&mId=311&mPid=121&bbsSeqNo=100&nttSeqNo=3186863";

const FIRST_ATTACHMENTS = [
  {
    name: "1. 2026년도 하반기 방송통신정책연구 신규지원 대상과제 공고문.hwp",
    url: "https://www.msit.go.kr/ssm/file/fileDown.do?atchFileNo=54866&fileOrd=1",
    kind: "hwp" as const,
  },
  {
    name: "1. 2026년도 하반기 방송통신정책연구 신규지원 대상과제 공고문.odt",
    url: "https://www.msit.go.kr/ssm/file/fileDown.do?atchFileNo=54866&fileOrd=2",
    kind: "etc" as const,
  },
  {
    name: "1. 2026년도 하반기 방송통신정책연구 신규지원 대상과제 공고문.hwpx",
    url: "https://www.msit.go.kr/ssm/file/fileDown.do?atchFileNo=54866&fileOrd=3",
    kind: "hwpx" as const,
  },
  {
    name: "2. 2026년도 하반기 방송통신정책연구 신규지원 대상과제 RFP.hwpx",
    url: "https://www.msit.go.kr/ssm/file/fileDown.do?atchFileNo=54866&fileOrd=4",
    kind: "hwpx" as const,
  },
  {
    name: "2. 2026년도 하반기 방송통신정책연구 신규지원 대상과제 RFP.odt",
    url: "https://www.msit.go.kr/ssm/file/fileDown.do?atchFileNo=54866&fileOrd=5",
    kind: "etc" as const,
  },
  {
    name: "2. 2026년도 하반기 방송통신정책연구 신규지원 대상과제 RFP.hwp",
    url: "https://www.msit.go.kr/ssm/file/fileDown.do?atchFileNo=54866&fileOrd=6",
    kind: "hwp" as const,
  },
  {
    name: "3. 신청서식.zip",
    url: "https://www.msit.go.kr/ssm/file/fileDown.do?atchFileNo=54866&fileOrd=7",
    kind: "zip" as const,
  },
  {
    name: "4. 국가연구개발혁신법 및 주요 부속 규정.zip",
    url: "https://www.msit.go.kr/ssm/file/fileDown.do?atchFileNo=54866&fileOrd=8",
    kind: "zip" as const,
  },
  {
    name: "5. IRIS 전산접수 매뉴얼.zip",
    url: "https://www.msit.go.kr/ssm/file/fileDown.do?atchFileNo=54866&fileOrd=9",
    kind: "zip" as const,
  },
];

describe("과기부 정규화 — 고정본", () => {
  it("제목·상세주소·첨부가 고정본 정확값이다", () => {
    const list = announcementsFromMsitXml(sampleXml, NOW);
    expect(list.length).toBeGreaterThanOrEqual(1);
    const a = list[0];
    expect(a.source).toBe("msit");
    expect(a.sourceId).toBe("3186863");
    expect(a.title).toBe("2026년도 하반기 방송통신정책연구 신규지원 대상과제 공고");
    expect(a.url).toBe(FIRST_URL);
    expect(a.agency).toBe("과학기술정보통신부");
    expect(a.category).toBe("R&D");
    expect(a.applyStart).toBeNull();
    expect(a.applyEnd).toBeNull();
    expect(a.applyPeriodText).toBe("");
    expect(a.targetText).toBe("");
    expect(a.attachments).toEqual(FIRST_ATTACHMENTS);
    expect((a.raw as { deptName: string }).deptName).toBe("정보통신정책총괄과");
    expect((a.raw as { pressDt: string }).pressDt).toBe("2026-08-25");
  });

  it("nttSeqNo 가 없으면 viewUrl 전체를 sourceId 로 쓴다", () => {
    const xml = `<?xml version="1.0"?><response><header><resultCode>00</resultCode></header><body><items>
      <item>
        <subject>번호없는공고</subject>
        <viewUrl>https://www.msit.go.kr/bbs/view.do?sCode=user</viewUrl>
        <deptName>기획과</deptName>
        <pressDt>2026-08-01</pressDt>
      </item>
    </items></body></response>`;
    const list = announcementsFromMsitXml(xml, NOW);
    expect(list).toHaveLength(1);
    expect(list[0].sourceId).toBe("https://www.msit.go.kr/bbs/view.do?sCode=user");
    expect(list[0].url).toBe("https://www.msit.go.kr/bbs/view.do?sCode=user");
  });
});

describe("과기부 resultCode 오류", () => {
  it("resultCode 가 00 이 아니면 던진다", () => {
    const xml = `<?xml version="1.0"?><response><header>
      <resultCode>99</resultCode><resultMsg>SERVICE ERROR</resultMsg>
    </header><body><items></items></body></response>`;
    expect(() => announcementsFromMsitXml(xml)).toThrow(/99/);
  });
});

describe("과기부 빈 items", () => {
  it("resultCode 00 이고 items 가 비면 빈 목록이다", () => {
    const xml = `<?xml version="1.0"?><response><header>
      <resultCode>00</resultCode><resultMsg>NORMAL_CODE</resultMsg>
    </header><body><items>
      <numOfRows>0</numOfRows><pageNo>1</pageNo><totalCount>0</totalCount>
    </items></body></response>`;
    expect(announcementsFromMsitXml(xml)).toEqual([]);
  });
});

function msitItemXml(over: { subject?: string; ntt?: string; pressDt?: string } = {}): string {
  const ntt = over.ntt ?? "1";
  return `<item>
    <subject>${over.subject ?? "제목"}</subject>
    <viewUrl>https://www.msit.go.kr/bbs/view.do?nttSeqNo=${ntt}</viewUrl>
    <pressDt>${over.pressDt ?? "2026-08-25"}</pressDt>
  </item>`;
}

function msitPageXml(items: string, totalCount: number): string {
  return `<?xml version="1.0"?><response><header><resultCode>00</resultCode></header><body><items>${items}<totalCount>${totalCount}</totalCount></items></body></response>`;
}

describe("과기부 pressDt 365일 컷", () => {
  it("최근 365일 이전 게시물은 담지 않고 applyEnd 는 null 이다", () => {
    const xml = msitPageXml(
      msitItemXml({ ntt: "old", pressDt: "2025-08-25" }) +
        msitItemXml({ ntt: "keep", pressDt: "2025-08-26" }),
      2,
    );
    const list = announcementsFromMsitXml(xml, NOW);
    expect(list.map((a) => a.sourceId)).toEqual(["keep"]);
    expect(list[0].applyEnd).toBeNull();
  });
});

describe("과기부 호출", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("실수신 누적이 totalCount 이상이면 다음 쪽을 안 부른다", async () => {
    vi.stubEnv("DATA_GO_KR_API_KEY", "test-key");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        text: async () =>
          msitPageXml(msitItemXml({ ntt: "1" }) + msitItemXml({ ntt: "2" }), 4),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () =>
          msitPageXml(msitItemXml({ ntt: "3" }) + msitItemXml({ ntt: "4" }), 4),
      })
      .mockResolvedValue({
        ok: true,
        text: async () => msitPageXml(msitItemXml({ ntt: "x" }), 4),
      });
    vi.stubGlobal("fetch", fetchMock);
    const list = await fetchMsitAll(NOW);
    expect(list.map((a) => a.sourceId)).toEqual(["1", "2", "3", "4"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("빈 쪽이면 끝이다", async () => {
    vi.stubEnv("DATA_GO_KR_API_KEY", "test-key");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        text: async () => msitPageXml(msitItemXml({ ntt: "1" }), 100),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => msitPageXml("", 100),
      })
      .mockResolvedValue({
        ok: true,
        text: async () => msitPageXml(msitItemXml({ ntt: "x" }), 100),
      });
    vi.stubGlobal("fetch", fetchMock);
    const list = await fetchMsitAll(NOW);
    expect(list).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("연속 2쪽이 전부 365일 컷이면 조기 종료한다", async () => {
    vi.stubEnv("DATA_GO_KR_API_KEY", "test-key");
    const oldPage = msitPageXml(
      msitItemXml({ ntt: "a", pressDt: "2020-01-01" }) +
        msitItemXml({ ntt: "b", pressDt: "2020-01-02" }),
      10,
    );
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, text: async () => oldPage })
      .mockResolvedValueOnce({ ok: true, text: async () => oldPage })
      .mockResolvedValue({ ok: true, text: async () => msitItemXml({ ntt: "x" }) });
    vi.stubGlobal("fetch", fetchMock);
    const list = await fetchMsitAll(NOW);
    expect(list).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
