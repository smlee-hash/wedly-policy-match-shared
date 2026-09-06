import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  announcementsFromKstartupXml,
  decodeXml,
  fetchKstartupAll,
  keepIdentifiable,
  normalizeKstartupItem,
  splitXmlItems,
  xmlColsByName,
} from "./kstartup";

const xmlOf = (name: string) =>
  readFileSync(join(__dirname, "__fixtures__/datago", name), "utf8").replace(/^HTTP \d+\r?\n/, "");

const sampleXml = xmlOf("kstartup-anno.sample.txt");

describe("K-Startup XML col-name 유틸", () => {
  it("item 단위로 분해한다", () => {
    expect(splitXmlItems(sampleXml)).toHaveLength(3);
  });
  it("col name 정규식으로 칸을 꺼내고 엔티티를 푼다", () => {
    const cols = xmlColsByName(`<col name="a">1</col><col name="b">x&amp;y</col>`);
    expect(cols).toEqual({ a: "1", b: "x&y" });
  });
});

describe("K-Startup 정규화 — 고정본", () => {
  it("공고명·접수기간 Date 가 고정본과 맞다", () => {
    const cols = xmlColsByName(splitXmlItems(sampleXml)[0]);
    const a = normalizeKstartupItem(cols);
    expect(a.source).toBe("kstartup");
    expect(a.sourceId).toBe("179004");
    expect(a.title).toBe("2026년 한국지역난방공사 창업·벤처기업 지원사업 참여기업 모집");
    expect(a.agency).toBe("한국청년기업가정신재단");
    expect(a.applyStart?.toISOString()).toBe("2026-08-18T15:00:00.000Z"); // 20260819 KST 00:00
    expect(a.applyEnd?.toISOString()).toBe("2026-08-28T14:59:59.000Z"); // 20260828 KST 23:59:59
    expect(a.url).toBe("https://www.k-startup.go.kr/web/contents/bizpbanc-ongoing.do?schM=view&pbancSn=179004");
    expect((a.raw as { applyUrl: string }).applyUrl).toBe("");
    expect(a.targetText).toBe(`${cols.aply_trgt_ctnt}\n[제외대상]\n${cols.aply_excl_trgt_ctnt}`);
  });
  it("제외대상이 비면 지원대상만 둔다", () => {
    const a = normalizeKstartupItem({
      pbanc_sn: "1",
      biz_pbanc_nm: "t",
      detl_pg_url: "https://k.test/1",
      aply_trgt_ctnt: "창업 3년 이내",
      aply_excl_trgt_ctnt: "  ",
    });
    expect(a.targetText).toBe("창업 3년 이내");
  });
  it("시작·끝 날짜를 각각 파싱해 한쪽만 있어도 그쪽은 채운다", () => {
    const startOnly = normalizeKstartupItem({
      pbanc_sn: "1",
      detl_pg_url: "https://k.test/1",
      pbanc_rcpt_bgng_dt: "20260801",
    });
    expect(startOnly.applyStart?.toISOString()).toBe("2026-07-31T15:00:00.000Z");
    expect(startOnly.applyEnd).toBeNull();
    const endOnly = normalizeKstartupItem({
      pbanc_sn: "2",
      detl_pg_url: "https://k.test/2",
      pbanc_rcpt_end_dt: "20260831",
    });
    expect(endOnly.applyStart).toBeNull();
    expect(endOnly.applyEnd?.toISOString()).toBe("2026-08-31T14:59:59.000Z");
  });
  it("biz_aply_url 은 raw.applyUrl 로 보존한다", () => {
    const a = normalizeKstartupItem({
      pbanc_sn: "1",
      biz_pbanc_nm: "t",
      detl_pg_url: "https://k.test/1",
      biz_aply_url: "https://apply.test/form",
      pbanc_rcpt_bgng_dt: "20260801",
      pbanc_rcpt_end_dt: "20260831",
      rcrt_prgs_yn: "Y",
    });
    expect((a.raw as { applyUrl: string }).applyUrl).toBe("https://apply.test/form");
  });
});

describe("K-Startup 모집 아님 제외", () => {
  it("rcrt_prgs_yn 이 Y 가 아니면 뺀다", () => {
    const xml = [
      `<item><col name="rcrt_prgs_yn">N</col><col name="biz_pbanc_nm">닫힌공고</col><col name="pbanc_sn">1</col><col name="detl_pg_url">https://x.test/1</col></item>`,
      `<item><col name="rcrt_prgs_yn">Y</col><col name="biz_pbanc_nm">열린공고</col><col name="pbanc_sn">2</col><col name="detl_pg_url">https://x.test/2</col></item>`,
      `<item><col name="rcrt_prgs_yn"></col><col name="biz_pbanc_nm">빈값</col><col name="pbanc_sn">3</col><col name="detl_pg_url">https://x.test/3</col></item>`,
    ].join("");
    const list = announcementsFromKstartupXml(xml);
    expect(list).toHaveLength(1);
    expect(list[0].title).toBe("열린공고");
    expect(list[0].sourceId).toBe("2");
  });
});

describe("K-Startup XML 엔티티", () => {
  it("이름 엔티티를 숫자 엔티티보다 먼저 풀어 이중 해독하지 않고, 번호점 밖은 fromCodePoint 로 붙인다", () => {
    expect(decodeXml("&#38;lt;")).toBe("&lt;");
    expect(decodeXml("&amp;lt;")).toBe("&lt;");
    expect(decodeXml("&#x1F980;")).toBe("\u{1F980}");
    expect(decodeXml("&#xD;&#xA;")).toBe("\r\n");
  });
});

const GATEKEEPER_XML = `<?xml version="1.0" encoding="UTF-8"?>
<OpenAPI_ServiceResponse>
<cmmMsgHeader>
  <errMsg>SERVICE ERROR</errMsg>
  <returnAuthMsg>인증키 오류</returnAuthMsg>
  <returnReasonCode>04</returnReasonCode>
</cmmMsgHeader>
</OpenAPI_ServiceResponse>`;

function kstartupPageXml(opts: {
  matchCount?: number | null;
  items: { yn: string; sn: string }[];
}): string {
  const items = opts.items
    .map(
      (i) =>
        `<item><col name="rcrt_prgs_yn">${i.yn}</col><col name="biz_pbanc_nm">t${i.sn}</col><col name="pbanc_sn">${i.sn}</col><col name="detl_pg_url">https://x.test/${i.sn}</col></item>`,
    )
    .join("");
  const mc = opts.matchCount == null ? "" : `<matchCount>${opts.matchCount}</matchCount>`;
  return `<results><data>${items}</data>${mc}</results>`;
}

function kstartupFullPage(yn: string, page: number, matchCount = 29875): string {
  const items = Array.from({ length: 100 }, (_, i) => ({ yn, sn: `${page}-${i}` }));
  return kstartupPageXml({ matchCount, items });
}

describe("K-Startup 깨진 XML", () => {
  it("문지기 오류 XML 과 item 0개·matchCount 없음은 던진다", () => {
    expect(() => announcementsFromKstartupXml(GATEKEEPER_XML)).toThrow(/문지기/);
    expect(() => announcementsFromKstartupXml("")).toThrow();
    expect(() => announcementsFromKstartupXml("<not-xml")).toThrow();
    expect(() => announcementsFromKstartupXml("<item><col name=\"a\">열린 태그")).toThrow();
    expect(splitXmlItems("<item><col name=\"x\">")).toEqual([]);
  });
  it("item 0개여도 matchCount 0 이면 빈 목록이다", () => {
    expect(announcementsFromKstartupXml(kstartupPageXml({ matchCount: 0, items: [] }))).toEqual([]);
  });
});

describe("K-Startup keepIdentifiable", () => {
  it("공고번호·링크가 둘 다 빈 항목은 거른다", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const kept = keepIdentifiable([
      normalizeKstartupItem({ pbanc_sn: "P1", detl_pg_url: "https://x.test/1" }),
      normalizeKstartupItem({ biz_pbanc_nm: "빈 것" }),
    ]);
    expect(kept).toHaveLength(1);
    expect(kept[0].sourceId).toBe("P1");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("1건"));
    warn.mockRestore();
  });
});

describe("K-Startup 호출", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("열쇠가 없으면 던진다", async () => {
    vi.stubEnv("DATA_GO_KR_API_KEY", "");
    await expect(fetchKstartupAll()).rejects.toThrow("DATA_GO_KR_API_KEY 없음");
  });

  it("HTTP 200 문지기 오류 XML 은 던진다", async () => {
    vi.stubEnv("DATA_GO_KR_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      text: async () => GATEKEEPER_XML,
    }));
    await expect(fetchKstartupAll()).rejects.toThrow(/문지기/);
  });

  it("item 0개이고 matchCount 도 없으면 던진다", async () => {
    vi.stubEnv("DATA_GO_KR_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      text: async () => "<results><data></data></results>",
    }));
    await expect(fetchKstartupAll()).rejects.toThrow(/matchCount/);
  });

  it("오류 응답은 상태코드와 본문 일부를 담아 던진다", async () => {
    vi.stubEnv("DATA_GO_KR_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "SERVICE ERROR body",
    }));
    await expect(fetchKstartupAll()).rejects.toThrow(/500/);
    await expect(fetchKstartupAll()).rejects.toThrow(/SERVICE ERROR/);
  });

  it("연속 2쪽에서 모집중 0건이면 조기 종료하고 상한 경고는 안 남긴다", async () => {
    vi.stubEnv("DATA_GO_KR_API_KEY", "test-key");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, text: async () => kstartupFullPage("Y", 1) })
      .mockResolvedValueOnce({ ok: true, text: async () => kstartupFullPage("N", 2) })
      .mockResolvedValueOnce({ ok: true, text: async () => kstartupFullPage("N", 3) })
      .mockResolvedValue({ ok: true, text: async () => kstartupFullPage("N", 99) });
    vi.stubGlobal("fetch", fetchMock);
    const list = await fetchKstartupAll();
    expect(list).toHaveLength(100);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(warn.mock.calls.some((c) => String(c[0]).includes("상한"))).toBe(false);
    warn.mockRestore();
  });

  it("60쪽을 다 쓰면 상한 경고를 남긴다", async () => {
    vi.stubEnv("DATA_GO_KR_API_KEY", "test-key");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn().mockImplementation((_url: string) => {
      const u = new URL(_url);
      const page = Number(u.searchParams.get("page") || "1");
      return Promise.resolve({ ok: true, text: async () => kstartupFullPage("Y", page) });
    }));
    const list = await fetchKstartupAll();
    expect(list).toHaveLength(6000);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("60쪽 상한"));
    warn.mockRestore();
  });
});
