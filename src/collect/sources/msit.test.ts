import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { announcementsFromMsitXml, FETCH_TIMEOUT_MS, fetchMsitAll } from "./msit";

const xmlOf = (name: string) =>
  readFileSync(join(__dirname, "__fixtures__/datago", name), "utf8").replace(/^HTTP \d+\r?\n/, "");

const sampleXml = xmlOf("msit-anno.sample.txt");
const NOW = new Date("2026-08-26T00:00:00.000Z");
const SECRET_KEY = "secret/key+plus";
const SAFETY_MAX_PAGES = 500;

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

function msitItemXml(
  over: { subject?: string; ntt?: string; pressDt?: string | null } = {},
): string {
  const ntt = over.ntt ?? "1";
  const press =
    over.pressDt === null ? "" : `<pressDt>${over.pressDt ?? "2026-08-25"}</pressDt>`;
  return `<item>
    <subject>${over.subject ?? "제목"}</subject>
    <viewUrl>https://www.msit.go.kr/bbs/view.do?nttSeqNo=${ntt}</viewUrl>
    ${press}
  </item>`;
}

function msitPageXml(
  items: string,
  totalCount?: number | null,
  extra: { pageNo?: number | string; numOfRows?: number | string } = {},
): string {
  const bits: string[] = [items];
  if (extra.numOfRows !== undefined) bits.push(`<numOfRows>${extra.numOfRows}</numOfRows>`);
  if (extra.pageNo !== undefined) bits.push(`<pageNo>${extra.pageNo}</pageNo>`);
  if (totalCount !== undefined && totalCount !== null) bits.push(`<totalCount>${totalCount}</totalCount>`);
  return `<?xml version="1.0"?><response><header><resultCode>00</resultCode></header><body><items>${bits.join("")}</items></body></response>`;
}

function tenItems(
  page: number,
  pressDt: (n: number) => string,
  perPage = 10,
): string {
  return Array.from({ length: perPage }, (_, i) => {
    const n = (page - 1) * perPage + i + 1;
    return msitItemXml({ ntt: String(n), subject: `공고${n}`, pressDt: pressDt(n) });
  }).join("");
}

function pressDtForRegression(n: number): string {
  if (n <= 290) return "2026-08-01";
  if (n <= 295) return "2026-03-16";
  if (n <= 305) return "2026-03-13";
  return "2026-03-09";
}

function pageNoOf(input: RequestInfo | URL): number {
  return Number(new URL(String(input)).searchParams.get("pageNo"));
}

function stubFetch(impl: (page: number, url: string) => string | Promise<string>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const xml = await impl(pageNoOf(url), url);
    return { ok: true, status: 200, text: async () => xml };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function leakedText(err: unknown): string {
  const parts = [String(err)];
  if (err instanceof Error) {
    parts.push(err.name, err.message, err.stack ?? "");
    const cause = (err as Error & { cause?: unknown }).cause;
    if (cause !== undefined) {
      parts.push(String(cause));
      if (cause instanceof Error) parts.push(cause.message, cause.stack ?? "");
    }
    try {
      parts.push(JSON.stringify(err));
    } catch {
      /* 순환 */
    }
  }
  return parts.join("\n");
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

  it.each([
    "<!-- <totalCount>1</totalCount> -->",
    "<![CDATA[<totalCount>1</totalCount>]]>",
    "<?probe <totalCount>1</totalCount> ?>",
  ])("주석·문자열·처리 지시 안의 건수를 쪽 정보로 읽지 않는다: %s", async (shadow) => {
    vi.stubEnv("DATA_GO_KR_API_KEY", "test-key");
    const fetchMock = stubFetch(page => msitPageXml(msitItemXml({ ntt: String(page) }), 2)
      .replace("<body>", `<body>${shadow}`));
    expect((await fetchMsitAll(NOW)).map(a => a.sourceId)).toEqual(["1", "2"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each(["<!-- </item> -->", "<note><![CDATA[</item>]]></note>"])(
    "항목 안의 닫는 태그 문자열 뒤 첨부파일도 보존한다: %s", async (literal) => {
      vi.stubEnv("DATA_GO_KR_API_KEY", "test-key");
      stubFetch(() => msitPageXml(msitItemXml().replace("</item>", `${literal}
        <files><file><fileName>안내.pdf</fileName>
        <fileUrl>https://www.msit.go.kr/file?id=1&amp;order=2</fileUrl></file></files></item>`), 1));
      const [item] = await fetchMsitAll(NOW);
      expect(item.attachments).toEqual([{ name: "안내.pdf", url: "https://www.msit.go.kr/file?id=1&order=2", kind: "pdf" }]);
    },
  );

  it("항목의 하위 필드에 있는 건수는 쪽 정보가 아니다", async () => {
    vi.stubEnv("DATA_GO_KR_API_KEY", "test-key");
    stubFetch(page => msitPageXml(msitItemXml({ ntt: String(page) }).replace("</item>", "<totalCount>1</totalCount></item>"), 2));
    expect((await fetchMsitAll(NOW)).map(a => a.sourceId)).toEqual(["1", "2"]);
  });

  it("중복된 총건수는 하나를 임의 선택하지 않는다", async () => {
    vi.stubEnv("DATA_GO_KR_API_KEY", "test-key");
    stubFetch(() => msitPageXml(msitItemXml(), 1).replace("</items>", "<totalCount>2</totalCount></items>"));
    await expect(fetchMsitAll(NOW)).rejects.toThrow();
  });

  it("숫자형 문자 참조를 제목·주소·첨부·쪽 정보에서 한 번만 해독한다", async () => {
    vi.stubEnv("DATA_GO_KR_API_KEY", "test-key");
    const item = msitItemXml({ subject: "A&#65;&#x42; &amp;bogus;" })
      .replace("?nttSeqNo=1", "?sCode=user&#38;nttSeqNo=1")
      .replace("</item>", "<files><file><fileName>안내&#46;pdf</fileName><fileUrl>https://www.msit.go.kr/file?id=1&#x26;order=2</fileUrl></file></files></item>");
    stubFetch(() => msitPageXml(item, 1, { pageNo: "&#49;", numOfRows: "&#x31;" })
      .replace("<resultCode>00</resultCode>", "<resultCode>&#48;&#48;</resultCode>")
      .replace("<totalCount>1</totalCount>", "<totalCount>&#49;</totalCount>"));
    const [a] = await fetchMsitAll(NOW);
    expect(a.title).toBe("AAB &bogus;");
    expect(a.sourceId).toBe("1");
    expect(a.url).toBe("https://www.msit.go.kr/bbs/view.do?sCode=user&nttSeqNo=1");
    expect(a.attachments).toEqual([{ name: "안내.pdf", url: "https://www.msit.go.kr/file?id=1&order=2", kind: "pdf" }]);
  });

  it.each([
    "<!-- literal <!DOCTYPE response> -->",
    "<![CDATA[literal <!DOCTYPE response> &bogus;]]>",
    "<?note literal <!ENTITY x> ?>",
  ])("비활성 DTD 문자열은 선언이 아니다: %s", async literal => {
    vi.stubEnv("DATA_GO_KR_API_KEY", "test-key");
    stubFetch(() => msitPageXml(msitItemXml(), 1).replace("<body>", `<body>${literal}`));
    expect((await fetchMsitAll(NOW)).map(a => a.sourceId)).toEqual(["1"]);
  });

  it.each(["<!DOCTYPE response>", '<!DOCTYPE response [<!ENTITY x "bad">]>'])(
    "활성 DTD는 계속 거부한다: %s", async dtd => {
      vi.stubEnv("DATA_GO_KR_API_KEY", "test-key");
      stubFetch(() => msitPageXml(msitItemXml(), 1).replace("<response>", `${dtd}<response>`));
      await expect(fetchMsitAll(NOW)).rejects.toThrow(/형식이 올바르지 않습니다/);
    },
  );

  it.each(["&bogus;", "&#0;", "&#xD800;", "&#x110000;"])(
    "정의되지 않은 이름·유효하지 않은 문자 참조를 저장하지 않는다: %s", async subject => {
      vi.stubEnv("DATA_GO_KR_API_KEY", "test-key");
      stubFetch(() => msitPageXml(msitItemXml({ subject }), 1));
      await expect(fetchMsitAll(NOW)).rejects.toThrow(/형식이 올바르지 않습니다/);
    },
  );

  it("실수신 누적이 totalCount 이상이면 다음 쪽을 안 부른다", async () => {
    vi.stubEnv("DATA_GO_KR_API_KEY", "test-key");
    const fetchMock = stubFetch((page) => {
      if (page === 1) return msitPageXml(msitItemXml({ ntt: "1" }) + msitItemXml({ ntt: "2" }), 4);
      if (page === 2) return msitPageXml(msitItemXml({ ntt: "3" }) + msitItemXml({ ntt: "4" }), 4);
      return msitPageXml(msitItemXml({ ntt: "x" }), 4);
    });
    const list = await fetchMsitAll(NOW);
    expect(list.map((a) => a.sourceId)).toEqual(["1", "2", "3", "4"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("메타가 없으면 실제 빈 쪽에서 끝낸다", async () => {
    vi.stubEnv("DATA_GO_KR_API_KEY", "test-key");
    const fetchMock = stubFetch((page) => {
      if (page === 1) return msitPageXml(msitItemXml({ ntt: "1" }));
      if (page === 2) return msitPageXml("");
      return msitPageXml(msitItemXml({ ntt: "x" }));
    });
    const list = await fetchMsitAll(NOW);
    expect(list.map((a) => a.sourceId)).toEqual(["1"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("연속 2쪽이 전부 365일 컷이면 조기 종료한다", async () => {
    vi.stubEnv("DATA_GO_KR_API_KEY", "test-key");
    const fetchMock = stubFetch((page) => {
      if (page === 1) {
        return msitPageXml(
          msitItemXml({ ntt: "a", pressDt: "2020-01-01" }) +
            msitItemXml({ ntt: "b", pressDt: "2020-01-02" }),
          10,
        );
      }
      if (page === 2) {
        return msitPageXml(
          msitItemXml({ ntt: "c", pressDt: "2020-01-03" }) +
            msitItemXml({ ntt: "d", pressDt: "2020-01-04" }),
          10,
        );
      }
      return msitPageXml(msitItemXml({ ntt: "x" }), 10);
    });
    const list = await fetchMsitAll(NOW);
    expect(list).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("같은 오래된 쪽이 반복되면 미완료다", async () => {
    vi.stubEnv("DATA_GO_KR_API_KEY", "test-key");
    const oldPage = msitPageXml(
      msitItemXml({ ntt: "a", pressDt: "2020-01-01" }) +
        msitItemXml({ ntt: "b", pressDt: "2020-01-02" }),
      10,
    );
    stubFetch(() => oldPage);
    await expect(fetchMsitAll(NOW)).rejects.toThrow(/끝나지 않았습니다/);
  });

  it("요청 100행·선언 10행으로 31쪽을 받아 300건 너머 공고를 담는다", async () => {
    vi.stubEnv("DATA_GO_KR_API_KEY", "test-key");
    const total = 310;
    const fetchMock = stubFetch((page) =>
      msitPageXml(tenItems(page, pressDtForRegression), total, { pageNo: page, numOfRows: 10 }),
    );
    const list = await fetchMsitAll(NOW);
    expect(list).toHaveLength(310);
    expect(list.map((a) => a.sourceId)).toContain("301");
    expect(list.find((a) => a.sourceId === "301")?.title).toBe("공고301");
    expect(fetchMock).toHaveBeenCalledTimes(31);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("numOfRows=100");
    expect(pageNoOf(fetchMock.mock.calls[0]?.[0] as RequestInfo)).toBe(1);
    expect(pageNoOf(fetchMock.mock.calls[30]?.[0] as RequestInfo)).toBe(31);
  });

  it("실수신은 오래된 건도 세고 결과는 365일 안만 담는다", async () => {
    vi.stubEnv("DATA_GO_KR_API_KEY", "test-key");
    const fetchMock = stubFetch((page) => {
      if (page === 1) {
        return msitPageXml(
          msitItemXml({ ntt: "1", pressDt: "2026-08-01" }) +
            msitItemXml({ ntt: "2", pressDt: "2026-08-02" }) +
            msitItemXml({ ntt: "3", pressDt: "2020-01-01" }) +
            msitItemXml({ ntt: "4", pressDt: "2020-01-02" }),
          8,
          { pageNo: 1, numOfRows: 4 },
        );
      }
      return msitPageXml(
        msitItemXml({ ntt: "5", pressDt: "2020-01-03" }) +
          msitItemXml({ ntt: "6", pressDt: "2020-01-04" }) +
          msitItemXml({ ntt: "7", pressDt: "2020-01-05" }) +
          msitItemXml({ ntt: "8", pressDt: "2020-01-06" }),
        8,
        { pageNo: 2, numOfRows: 4 },
      );
    });
    const list = await fetchMsitAll(NOW);
    expect(list.map((a) => a.sourceId)).toEqual(["1", "2"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("날짜를 모르는 항목은 남기고 오래된 쪽 컷을 막는다", async () => {
    vi.stubEnv("DATA_GO_KR_API_KEY", "test-key");
    const fetchMock = stubFetch((page) => {
      if (page === 1) {
        return msitPageXml(
          msitItemXml({ ntt: "a", pressDt: "2020-01-01" }) +
            msitItemXml({ ntt: "b", pressDt: "2020-01-02" }),
          100,
        );
      }
      if (page === 2) {
        return msitPageXml(
          msitItemXml({ ntt: "c", pressDt: "2020-01-03" }) +
            msitItemXml({ ntt: "d", pressDt: null, subject: "날짜없음" }),
          100,
        );
      }
      if (page === 3) {
        return msitPageXml(
          msitItemXml({ ntt: "e", pressDt: "2020-01-05" }) +
            msitItemXml({ ntt: "f", pressDt: "2020-01-06" }),
          100,
        );
      }
      if (page === 4) {
        return msitPageXml(
          msitItemXml({ ntt: "g", pressDt: "2020-01-07" }) +
            msitItemXml({ ntt: "h", pressDt: "2020-01-08" }),
          100,
        );
      }
      return msitPageXml(msitItemXml({ ntt: "x" }), 100);
    });
    const list = await fetchMsitAll(NOW);
    expect(list.map((a) => a.sourceId)).toEqual(["d"]);
    expect(list[0].title).toBe("날짜없음");
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("남은 건수가 있는데 빈 쪽이 오면 미완료다", async () => {
    vi.stubEnv("DATA_GO_KR_API_KEY", "test-key");
    stubFetch((page) => {
      if (page === 1) return msitPageXml(msitItemXml({ ntt: "1" }), 100);
      return msitPageXml("", 100);
    });
    await expect(fetchMsitAll(NOW)).rejects.toThrow(/끝나지 않았습니다/);
  });

  it("닫히지 않은 최신 항목이 있는 XML은 오래된 쪽 컷 전에 거부한다", async () => {
    vi.stubEnv("DATA_GO_KR_API_KEY", "test-key");
    const fetchMock = stubFetch(page => page === 1
      ? `<response><header><resultCode>00</resultCode></header><body><items>${msitItemXml({ ntt: "1" })}<item><subject>잘린 최신 공고</subject>`
      : msitPageXml(msitItemXml({ ntt: String(page), pressDt: "2020-01-01" }), 100));
    await expect(fetchMsitAll(NOW)).rejects.toThrow(/형식|끝나지 않았습니다/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("총건수가 이미 받은 고유 건수보다 작아지면 미완료다", async () => {
    vi.stubEnv("DATA_GO_KR_API_KEY", "test-key");
    const fetchMock = stubFetch(page => msitPageXml(
      [page * 2 - 1, page * 2].map(n => msitItemXml({ ntt: String(n) })).join(""),
      page === 1 ? 5 : 3,
    ));
    await expect(fetchMsitAll(NOW)).rejects.toThrow(/끝나지 않았습니다/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("비마지막 쪽이 선언한 행 수보다 적으면 오래된 쪽 컷 전에 거부한다", async () => {
    vi.stubEnv("DATA_GO_KR_API_KEY", "test-key");
    const fetchMock = stubFetch(page => msitPageXml(
      msitItemXml({ ntt: String(page), pressDt: page === 1 ? "2026-08-01" : "2020-01-01" }),
      100, { pageNo: page, numOfRows: 2 },
    ));
    await expect(fetchMsitAll(NOW)).rejects.toThrow(/끝나지 않았습니다/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("쪽 내용이 반복되면 미완료다", async () => {
    vi.stubEnv("DATA_GO_KR_API_KEY", "test-key");
    stubFetch(() =>
      msitPageXml(msitItemXml({ ntt: "1" }) + msitItemXml({ ntt: "2" }), 100),
    );
    await expect(fetchMsitAll(NOW)).rejects.toThrow(/끝나지 않았습니다/);
  });

  it("일부만 겹치는 쪽도 받은 건수로 중복 계산하지 않는다", async () => {
    vi.stubEnv("DATA_GO_KR_API_KEY", "test-key");
    stubFetch((page) => msitPageXml(
      (page === 1 ? ["1", "2"] : ["2", "3"]).map(ntt => msitItemXml({ ntt })).join(""),
      4, { pageNo: page, numOfRows: 2 },
    ));
    await expect(fetchMsitAll(NOW)).rejects.toThrow(/끝나지 않았습니다/);
  });

  it("존재하지 않는 날짜를 오래된 날짜로 바꿔 버리지 않는다", async () => {
    vi.stubEnv("DATA_GO_KR_API_KEY", "test-key");
    stubFetch(() => msitPageXml(msitItemXml({ ntt: "1", pressDt: "2020-02-30" }), 1));
    expect((await fetchMsitAll(NOW)).map(a => a.sourceId)).toEqual(["1"]);
  });

  it("웹 주소가 아닌 상세 링크는 저장용 목록에 넣지 않는다", async () => {
    vi.stubEnv("DATA_GO_KR_API_KEY", "test-key");
    stubFetch(() => msitPageXml(msitItemXml({ ntt: "1" }), 1)
      .replace(/<viewUrl>[\s\S]*?<\/viewUrl>/, "<viewUrl>javascript:alert(1)</viewUrl>"));
    await expect(fetchMsitAll(NOW)).rejects.toThrow(/끝나지 않았습니다/);
  });

  it("비정상 resultCode 원문에 키가 있어도 오류에 싣지 않는다", async () => {
    vi.stubEnv("DATA_GO_KR_API_KEY", SECRET_KEY);
    stubFetch(() => msitPageXml("", 0).replace("<resultCode>00</resultCode>", `<resultCode>${SECRET_KEY}</resultCode>`));
    const error = await fetchMsitAll(NOW).catch(e => e);
    expect(error).toBeInstanceOf(Error);
    expect(leakedText(error)).not.toContain(SECRET_KEY);
  });

  it("제목·링크가 없는 항목은 거르기 전에 미완료다", async () => {
    vi.stubEnv("DATA_GO_KR_API_KEY", "test-key");
    stubFetch(() =>
      msitPageXml(
        `<item><viewUrl>https://www.msit.go.kr/bbs/view.do?nttSeqNo=9</viewUrl><pressDt>2020-01-01</pressDt></item>`,
        1,
      ),
    );
    await expect(fetchMsitAll(NOW)).rejects.toThrow(/끝나지 않았습니다/);

    stubFetch(() =>
      msitPageXml(`<item><subject>링크없음</subject><pressDt>2026-08-01</pressDt></item>`, 1),
    );
    await expect(fetchMsitAll(NOW)).rejects.toThrow(/끝나지 않았습니다/);
  });

  it("고유 건수가 선언 총건수에 맞아도 겹친 쪽은 미완료로 남긴다", async () => {
    vi.stubEnv("DATA_GO_KR_API_KEY", "test-key");
    const fetchMock = stubFetch((page) => {
      if (page === 1) return msitPageXml(msitItemXml({ ntt: "1" }) + msitItemXml({ ntt: "2" }), 3);
      return msitPageXml(msitItemXml({ ntt: "2" }) + msitItemXml({ ntt: "3" }), 3);
    });
    await expect(fetchMsitAll(NOW)).rejects.toThrow(/끝나지 않았습니다/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("응답 봉투가 아니면 미완료로 끝내지 않고 형식 오류다", async () => {
    vi.stubEnv("DATA_GO_KR_API_KEY", "test-key");
    stubFetch(() => `<?xml version="1.0"?><response><header><resultCode>00</resultCode></header><body>oops</body></response>`);
    await expect(fetchMsitAll(NOW)).rejects.toThrow(/형식이 올바르지 않습니다/);
  });

  it("선언한 쪽 번호가 요청과 다르면 미완료다", async () => {
    vi.stubEnv("DATA_GO_KR_API_KEY", "test-key");
    stubFetch(() => msitPageXml(msitItemXml({ ntt: "1" }), 1, { pageNo: 9 }));
    await expect(fetchMsitAll(NOW)).rejects.toThrow(/끝나지 않았습니다/);
  });

  it("음수·비정수 총건수는 미완료다", async () => {
    vi.stubEnv("DATA_GO_KR_API_KEY", "test-key");
    stubFetch(() => msitPageXml(msitItemXml({ ntt: "1" }), null, { pageNo: 1 })
      .replace("</items>", "<totalCount>-1</totalCount></items>"));
    await expect(fetchMsitAll(NOW)).rejects.toThrow(/끝나지 않았습니다/);

    stubFetch(() => msitPageXml(msitItemXml({ ntt: "1" }), null)
      .replace("</items>", "<totalCount>4.5</totalCount></items>"));
    await expect(fetchMsitAll(NOW)).rejects.toThrow(/끝나지 않았습니다/);
  });

  it("총건수 태그가 비어 있으면 메타 없는 정상 빈 목록으로 보지 않는다", async () => {
    vi.stubEnv("DATA_GO_KR_API_KEY", "test-key");
    stubFetch(() => msitPageXml("", 0).replace("<totalCount>0</totalCount>", "<totalCount/>"));
    await expect(fetchMsitAll(NOW)).rejects.toThrow(/끝나지 않았습니다/);
  });

  it("쪽 항목 수가 선언 총건수보다 많으면 미완료다", async () => {
    vi.stubEnv("DATA_GO_KR_API_KEY", "test-key");
    stubFetch(() =>
      msitPageXml(msitItemXml({ ntt: "1" }) + msitItemXml({ ntt: "2" }), 1),
    );
    await expect(fetchMsitAll(NOW)).rejects.toThrow(/끝나지 않았습니다/);
  });

  it("총건수가 쪽마다 바뀌어도 실수신으로 마치면 성공이다", async () => {
    vi.stubEnv("DATA_GO_KR_API_KEY", "test-key");
    const fetchMock = stubFetch((page) => {
      if (page === 1) return msitPageXml(msitItemXml({ ntt: "1" }) + msitItemXml({ ntt: "2" }), 10);
      return msitPageXml(msitItemXml({ ntt: "3" }) + msitItemXml({ ntt: "4" }), 4);
    });
    const list = await fetchMsitAll(NOW);
    expect(list.map((a) => a.sourceId)).toEqual(["1", "2", "3", "4"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("500쪽에 닫히지 않으면 잘린 목록을 성공으로 두지 않는다", async () => {
    vi.stubEnv("DATA_GO_KR_API_KEY", "test-key");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchMock = stubFetch((page) =>
      msitPageXml(tenItems(page, () => "2026-08-01"), 10_000, { pageNo: page, numOfRows: 10 }),
    );
    await expect(fetchMsitAll(NOW)).rejects.toThrow(/끝나지 않았습니다/);
    expect(fetchMock).toHaveBeenCalledTimes(SAFETY_MAX_PAGES);
    expect(warn.mock.calls.flat().join("\n")).not.toMatch(/다음 주기/);
  }, 20_000);

  it("오류에 serviceKey 와 요청 주소를 담지 않는다", async () => {
    vi.stubEnv("DATA_GO_KR_API_KEY", SECRET_KEY);
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const err = new Error(`failed ${String(input)} ${SECRET_KEY}`);
      (err as Error & { cause?: unknown }).cause = new Error(SECRET_KEY);
      throw err;
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      await fetchMsitAll(NOW);
      throw new Error("실패해야 한다");
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toMatch(/^과기부 /);
      expect((err as Error).cause).toBeUndefined();
      const bag = leakedText(err);
      expect(bag).not.toContain(SECRET_KEY);
      expect(bag).not.toContain(encodeURIComponent(SECRET_KEY));
      expect(bag).not.toContain("serviceKey");
      expect(bag).not.toContain("apis.data.go.kr");
    }
  });

  it("HTTP 오류에도 키를 담지 않는다", async () => {
    vi.stubEnv("DATA_GO_KR_API_KEY", SECRET_KEY);
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false,
      status: 401,
      text: async () => `invalid ${SECRET_KEY}`,
    })));
    try {
      await fetchMsitAll(NOW);
      throw new Error("401 이 통과하면 안 된다");
    } catch (err) {
      expect((err as Error).message).toMatch(/호출 실패\(401\)/);
      expect(leakedText(err)).not.toContain(SECRET_KEY);
      expect(leakedText(err)).not.toContain("invalid");
    }
  });

  it("외부 호출에 30초 제한을 건다", async () => {
    vi.stubEnv("DATA_GO_KR_API_KEY", "test-key");
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const fetchMock = stubFetch(() => msitPageXml("", 0, { pageNo: 1, numOfRows: 0 }));
    await fetchMsitAll(NOW);
    expect(timeout).toHaveBeenCalledWith(FETCH_TIMEOUT_MS);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("businessAnnouncMentList"),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });
});
